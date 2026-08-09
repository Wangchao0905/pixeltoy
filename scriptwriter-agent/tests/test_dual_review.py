"""Task: 三模型双审核共识 + 修订轮换测试（不真实调用模型）。

双审核：DeepSeek（席 A）+ Gemini（席 B）并行独立审核，共识合并。
- 双过 → pass=True（分数取平均）
- 一过一不过 → pass=False（按未通过方 + 合并双方问题）
- 双不过 → pass=False（问题合并去重，一次修订解决两边）
修订轮换：round_no>=1 且 reviewer_b 存在 → 修订改用第二模型。
"""
import json
import unittest
from engine import PixelWriterEngine, ProjectState

class SeqLLM:
    """按调用顺序返回预设文本的假模型，记录每次调用的 messages。"""
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def chat(self, messages, **kw):
        self.calls.append(messages)
        return self.responses.pop(0)

PASS_A = '{"pass":true,"score":80,"dimensions":{"human_tone":82,"hook":80,"plot":78,"dialogue":80,"continuity":85},"issues":[]}'
PASS_B = '{"pass":true,"score":90,"dimensions":{"human_tone":88,"hook":92,"plot":86,"dialogue":88,"continuity":90},"issues":[]}'
FAIL_A = ('{"pass":false,"score":50,"dimensions":{"human_tone":55,"hook":40,"plot":60,"dialogue":58,"continuity":70},'
          '"issues":[{"severity":"high","mode":1,"quote":"总之","fix":"删掉总结"}]}')
FAIL_B = ('{"pass":false,"score":45,"dimensions":{"human_tone":50,"hook":35,"plot":62,"dialogue":60,"continuity":68},'
          '"issues":[{"severity":"high","mode":1,"quote":"总之","fix":"删掉总结"},'
          '{"severity":"medium","mode":5,"quote":"突然","fix":"改为因果衔接"}]}')


def make_state():
    s = ProjectState(project_id="d1", stage="episode", current_episode=1)
    s.idea = {"dialogue_language": "zh", "episode_duration_seconds": 90}
    s.artifacts["worldbuilding"] = {"characters": {"林晚": {"role": "主角"}}}
    s.artifacts["episodes"] = {"1": {"scenes": [{"location": "天台", "beats": [{"speaker": "林晚", "line": "总之我们走吧"}]}]}}
    return s


class TestDualReviewConsensus(unittest.TestCase):
    def _engine(self, a_resp, b_resp):
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = SeqLLM(list(a_resp))
        reviewer_b = SeqLLM(list(b_resp))
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects", reviewer_b=reviewer_b)
        return eng, reviewer_a, reviewer_b

    def test_both_pass_average_score(self):
        eng, a, b = self._engine([PASS_A], [PASS_B])
        verdict = eng.review_episode(make_state(), {"scenes": []})
        self.assertTrue(verdict["pass"])
        self.assertEqual(verdict["score"], 85)  # (80+90)/2

    def test_disagreement_conservative(self):
        eng, a, b = self._engine([PASS_A], [FAIL_B])
        verdict = eng.review_episode(make_state(), {"scenes": []})
        self.assertFalse(verdict["pass"])
        self.assertEqual(len(verdict["issues"]), 2, "应合并双方问题（通过方无问题）")

    def test_both_fail_merge_dedup(self):
        eng, a, b = self._engine([FAIL_A], [FAIL_B])
        verdict = eng.review_episode(make_state(), {"scenes": []})
        self.assertFalse(verdict["pass"])
        self.assertEqual(len(verdict["issues"]), 2, "重复的'总之'应去重，共 2 条")
        quotes = {i["quote"] for i in verdict["issues"]}
        self.assertEqual(quotes, {"总之", "突然"})

    def test_reviewer_b_absent_falls_back_to_single(self):
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = SeqLLM([PASS_A])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects")
        verdict = eng.review_episode(make_state(), {"scenes": []})
        self.assertTrue(verdict["pass"])
        self.assertEqual(verdict["score"], 80)


class TestRevisionRotation(unittest.TestCase):
    def test_round_two_uses_reviewer_b(self):
        """round_no=1 时应改用 reviewer_b（Gemini）修订，而非主笔 GPT。"""
        writer = SeqLLM(['{"scenes":[{"location":"天台","beats":[{"speaker":"林晚","line":"你好"}]}]}'])
        reviewer_a = SeqLLM([PASS_A])  # 首轮审核通过，无修订
        reviewer_b = SeqLLM(['{"scenes":[{"location":"天台","beats":[{"speaker":"林晚","line":"你好"}]}]}'])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects", reviewer_b=reviewer_b)
        state = make_state()
        ep = state.artifacts["episodes"]["1"]
        revised = eng.revise_episode(state, ep, [{"severity": "high", "quote": "你好", "fix": "改"}], round_no=1)
        self.assertIsNotNone(revised)
        self.assertEqual(len(reviewer_b.calls), 1, "第二轮修订必须由 reviewer_b 执行")
        self.assertEqual(len(writer.calls), 0, "第二轮修订不得再使用主笔 GPT")
        self.assertIn("定向修订", reviewer_b.calls[0][0]["content"])

    def test_round_zero_uses_writer(self):
        writer = SeqLLM(['{"scenes":[{"location":"天台","beats":[{"speaker":"林晚","line":"你好"}]}]}'])
        reviewer_a = SeqLLM([PASS_A])
        reviewer_b = SeqLLM([])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects", reviewer_b=reviewer_b)
        state = make_state()
        ep = state.artifacts["episodes"]["1"]
        eng.revise_episode(state, ep, [{"severity": "high", "quote": "你好", "fix": "改"}], round_no=0)
        self.assertEqual(len(writer.calls), 1, "首轮修订必须由主笔 GPT 执行")
        self.assertEqual(len(reviewer_b.calls), 0)


if __name__ == "__main__":
    unittest.main()

class ExplodingReviewer:
    """审核席调用抛异常（网关 401 等）——必须容错降级，不传播异常。"""
    def chat(self, messages, **kw):
        raise Exception("HTTP 401: Invalid token")


class TestReviewFaultTolerance(unittest.TestCase):
    def test_seat_b_failure_degrades_to_seat_a(self):
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = SeqLLM([PASS_A])
        reviewer_b = ExplodingReviewer()
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects", reviewer_b=reviewer_b)
        verdict = eng.review_episode(make_state(), {"scenes": []})
        self.assertTrue(verdict["pass"], "席 B 故障时应降级用席 A 结果")
        self.assertEqual(verdict["score"], 80)

    def test_seat_a_failure_degrades_to_seat_b(self):
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = ExplodingReviewer()
        reviewer_b = SeqLLM([PASS_B])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects", reviewer_b=reviewer_b)
        verdict = eng.review_episode(make_state(), {"scenes": []})
        self.assertTrue(verdict["pass"])
        self.assertEqual(verdict["score"], 90)

    def test_both_fail_returns_none(self):
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = ExplodingReviewer()
        reviewer_b = ExplodingReviewer()
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects", reviewer_b=reviewer_b)
        verdict = eng.review_episode(make_state(), {"scenes": []})
        self.assertIsNone(verdict, "两席全故障返回 None，由上游按'审核失败'处理而非抛异常")


if __name__ == "__main__":
    unittest.main()
