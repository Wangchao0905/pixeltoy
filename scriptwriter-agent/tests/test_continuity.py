"""连续性引导与多维度审核测试：
- _continuity_ledger 确定性提取跨集状态（角色/地点/悬念）
- _prompt_episode 注入前情提要（第 N 集 prompt 必须含前 N-1 集结尾与待兑现悬念）
- review 契约含 continuity 维度，且 continuity<70 代码级否决（缺失宽松兼容）
"""
import unittest
from engine import PixelWriterEngine, ProjectState, MAX_REVISION_ROUNDS


def make_state(episodes=None, outline=None):
    state = ProjectState(project_id="ct", stage="episode", current_episode=2)
    state.artifacts["worldbuilding"] = {"characters": [{"name": "林晓"}]}
    state.artifacts["episodes"] = episodes or {}
    state.artifacts["outline"] = {
        "episodes": outline or [
            {"index": 1, "hook": "开场暴击", "cliffhanger": "门后站着失踪的父亲"},
            {"index": 2, "hook": "追问", "cliffhanger": "父亲手上戴着同样的戒指"},
            {"index": 3, "hook": "追查", "cliffhanger": "线索指向地下拳场"},
        ]
    }
    return state


EP1 = {"scenes": [
    {"location": "出租屋", "beats": [
        {"speaker": "林晓", "line": "我妹妹的命，我来挣。", "action": "握拳"},
        {"speaker": "阿凯", "line": "那笔钱不是这么来的。", "action": "摇头"},
    ]},
    {"location": "医院走廊", "beats": [
        {"speaker": "医生", "line": "明早手术，还差八码。", "action": ""},
    ]},
]}
EP2 = {"scenes": [
    {"location": "地下拳场", "beats": [
        {"speaker": "林晓", "line": "有人见过我父亲。", "action": "环顾"},
    ]},
]}


class TestContinuityLedger(unittest.TestCase):
    def test_ledger_extracts_characters_locations_and_hooks(self):
        state = make_state({"1": EP1, "2": EP2})
        cont = PixelWriterEngine(None, None)._continuity_ledger(state, 3)
        # 角色最后出现集：林晓 EP1+EP2 → 2；阿凯/医生只 EP1 → 1
        self.assertEqual(cont["characters"].get("林晓"), 2)
        self.assertEqual(cont["characters"].get("阿凯"), 1)
        self.assertEqual(cont["locations"].get("出租屋"), 1)
        self.assertEqual(cont["locations"].get("地下拳场"), 2)
        # 待兑现悬念：第 3 集及以后
        self.assertEqual(len(cont["open_hooks"]), 1)
        self.assertIn("地下拳场", cont["open_hooks"][0])
        # 上集（第 2 集）结尾对白
        self.assertIn("有人见过我父亲", "\n".join(cont["previous_episode_end"]))
        # 上集悬念（第 2 集 cliffhanger）
        self.assertIn("同样的戒指", cont["previous_cliffhanger"])

    def test_ledger_first_episode_has_no_previous(self):
        state = make_state({"1": EP1}, outline=[{"index": 1, "hook": "h", "cliffhanger": "c1"}])
        cont = PixelWriterEngine(None, None)._continuity_ledger(state, 1)
        self.assertEqual(cont["previous_episode_end"], [])
        self.assertEqual(cont["previous_cliffhanger"], "")
        self.assertEqual(len(cont["open_hooks"]), 1)


class TestEpisodePromptContinuity(unittest.TestCase):
    def test_second_episode_prompt_contains_previous_end_and_hooks(self):
        state = make_state({"1": EP1})
        engine = PixelWriterEngine(None, None)
        prompt = engine._prompt_episode(state, {"index": 2, "hook": "追问", "cliffhanger": "c2", "events": []})
        self.assertIn("前情提要", prompt)
        self.assertIn("明早手术，还差八码", prompt)          # 第 1 集最后场景结尾
        self.assertIn("门后站着失踪的父亲", prompt)          # 第 1 集悬念 → 第 2 集待兑现
        self.assertIn("跨集状态", prompt)
        self.assertIn("地下拳场", prompt)                    # 第 3 集悬念也在清单
        self.assertIn("衔接上集结尾", prompt)

    def test_first_episode_prompt_has_no_previous(self):
        state = make_state()
        engine = PixelWriterEngine(None, None)
        prompt = engine._prompt_episode(state, {"index": 1, "hook": "h", "cliffhanger": "c1", "events": []})
        self.assertIn("首集", prompt)
        self.assertNotIn("前情提要", prompt)


class TestReviewContinuityGate(unittest.TestCase):
    """review 强制门：continuity<70 必须否决；缺失宽松兼容（旧审核输出）。"""

    class FakeReviewer:
        def __init__(self, verdict):
            self.verdict = verdict

        def chat(self, messages, **kw):
            return self.verdict

    def _review(self, verdict):
        state = make_state({"1": EP1})
        engine = PixelWriterEngine(None, self.FakeReviewer(verdict))
        return engine.review_episode(state, EP2)

    def test_continuity_below_70_forces_reject(self):
        v = self._review('{"pass":true,"score":70,"dimensions":{"human_tone":90,"plot":80,"dialogue":85,"continuity":60},"issues":[]}')
        self.assertFalse(v["pass"], "continuity=60 必须否决")

    def test_continuity_ok_passes(self):
        v = self._review('{"pass":true,"score":85,"dimensions":{"human_tone":90,"hook":85,"plot":80,"dialogue":85,"continuity":85},"issues":[]}')
        self.assertTrue(v["pass"])

    def test_continuity_missing_is_lenient(self):
        # 旧审核输出无 continuity 维度：不否决（兼容）
        v = self._review('{"pass":true,"score":85,"dimensions":{"human_tone":90,"hook":85,"plot":80,"dialogue":85},"issues":[]}')
        self.assertTrue(v["pass"])

    def test_review_prompt_requests_continuity_dimension(self):
        state = make_state({"1": EP1})
        engine = PixelWriterEngine(None, self.FakeReviewer('{"pass":true}'))
        engine.review_episode(state, EP2)
        prompt = engine.reviewer.calls[0] if hasattr(engine.reviewer, "calls") else None
        # 直接断言 prompt 构造（用记录 calls 的替身）
        class Recorder:
            def __init__(self):
                self.calls = []

            def chat(self, messages, **kw):
                self.calls.append(messages[0]["content"])
                return '{"pass":true}'

        engine2 = PixelWriterEngine(None, Recorder())
        engine2.review_episode(state, EP2)
        prompt = engine2.reviewer.calls[0]
        self.assertIn("continuity", prompt)
        self.assertIn("前情提要", prompt)
        self.assertIn("待兑现悬念", prompt)


if __name__ == "__main__":
    unittest.main()
