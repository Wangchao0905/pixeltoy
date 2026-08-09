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
    s.idea = {"dialogue_language": "zh"}  # 不设时长：共识/容错测试关注审核合并逻辑
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

PASS_LONG_DIALOGUE = ('{"pass":true,"score":85,"dimensions":{"human_tone":85,"hook":85,"plot":80,"dialogue":82,"continuity":88},'
                      '"issues":[]}')


class TestDurationHardGate(unittest.TestCase):
    def _state(self, duration=90):
        s = make_state()
        s.idea["episode_duration_seconds"] = duration
        return s

    def test_oversize_episode_forced_fail(self):
        """90 秒目标，但对白巨长（估算远超 126 秒）→ 代码级强制不通过并注入 high issue。"""
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = SeqLLM([PASS_LONG_DIALOGUE])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects")
        episode = {"scenes": [
            {"location": "A", "beats": [{"speaker": "林晚", "line": "床前明月光" * 200},
                                        {"speaker": "林晚", "line": "疑是地上霜" * 200}]}
        ]}
        verdict = eng.review_episode(self._state(), episode)
        self.assertFalse(verdict["pass"], "超时长必须被代码级否决")
        self.assertTrue(any("超出目标" in (i.get("fix") or "") for i in verdict["issues"]))

    def test_under_size_episode_forced_fail(self):
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = SeqLLM([PASS_LONG_DIALOGUE])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects")
        episode = {"scenes": [{"location": "A", "beats": [{"speaker": "林晚", "line": "走"}]}]}
        verdict = eng.review_episode(self._state(), episode)
        self.assertFalse(verdict["pass"], "过短也必须被代码级否决")

    def test_on_target_pass(self):
        writer = SeqLLM(['{"scenes":[]}'])
        reviewer_a = SeqLLM([PASS_A])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects")
        # 90 秒目标：4 个节拍、每拍对白 ~60 字 → 估算 ≈ 4*15+2 ≈ 62 秒，落在 54-126 区间内
        episode = {"scenes": [
            {"location": "A", "beats": [
                {"speaker": "林晚", "line": "这一条对白是用于时长估算的测试内容填充物" * 3},
                {"speaker": "林晚", "line": "这一条对白是用于时长估算的测试内容填充物" * 3},
                {"speaker": "林晚", "line": "这一条对白是用于时长估算的测试内容填充物" * 3},
                {"speaker": "林晚", "line": "这一条对白是用于时长估算的测试内容填充物" * 3},
            ]}
        ]}
        verdict = eng.review_episode(self._state(), episode)
        self.assertTrue(verdict["pass"])


if __name__ == "__main__":
    unittest.main()

class TestDurationAutoTrim(unittest.TestCase):
    LONG_DRAFT = {"scenes": [{"location": "天台", "beats": [
        {"speaker": "林晚", "line": "一长段对白是用于测试时长超限时自动精简的填充内容" * 18, "action": "她叹气"},
    ]}]}
    # 4 拍 × ~35 字 → 估算 ≈ 4*8.75+2 ≈ 37 秒，落在 60 秒目标（36-84）区间内
    TRIMMED = {"scenes": [{"location": "天台", "beats": [
        {"speaker": "林晚", "line": "我们别再等了，车快开了，这批货再不走今晚就要烂在仓库里，耽误了谁负责"}, {"speaker": "林晚", "line": "可这单子还没交接完，走不了啊，得先把账对清楚才行，不然回头说不清"},
        {"speaker": "林晚", "line": "那就把单子交给老陈，他明天一早来拿，账目回头再核对一遍就是"}, {"speaker": "林晚", "line": "好，我这就去打电话给他交代清楚，让他七点前过来接货点货"},
        {"speaker": "林晚", "line": "那我先去把货搬到门口，你打完电话就下来搭把手"},
    ]}]}

    def test_oversize_draft_auto_trimmed_before_review(self):
        writer = SeqLLM([json.dumps(self.LONG_DRAFT, ensure_ascii=False),
                         json.dumps(self.TRIMMED, ensure_ascii=False)])
        reviewer_a = SeqLLM([PASS_A])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects")
        state = make_state()
        state.idea["episode_duration_seconds"] = 60
        result = eng.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "approved", "自动精简后应正常过审")
        self.assertEqual(len(writer.calls), 2, "主笔被调用两次：生成 + 时长精简修订")

    def test_oversize_draft_trim_fails_still_reviewed(self):
        # 自检修订未精简（仍超长）→ 进审核被否决 → 修订轮 → needs-human（不抛异常）
        writer = SeqLLM([json.dumps(self.LONG_DRAFT, ensure_ascii=False),
                         json.dumps(self.LONG_DRAFT, ensure_ascii=False),
                         json.dumps(self.LONG_DRAFT, ensure_ascii=False),
                         json.dumps(self.LONG_DRAFT, ensure_ascii=False)])
        reviewer_a = SeqLLM([FAIL_A, FAIL_A, FAIL_A])
        eng = PixelWriterEngine(writer, reviewer_a, state_dir="projects")
        state = make_state()
        state.idea["episode_duration_seconds"] = 60
        result = eng.run_episode_loop(state, {"index": 1, "events": []})
        self.assertIn(result["status"], ("needs-human", "approved"))
if __name__ == "__main__":
    unittest.main()
