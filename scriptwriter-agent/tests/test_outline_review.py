# -*- coding: utf-8 -*-
"""大纲质量审核测试：review_outline 通过/不通过/重写/仍不过记录。"""
import json
import unittest

from engine import PixelWriterEngine, ProjectState


def _outline(ep_count=3):
    return {"episodes": [
        {"index": i, "hook": f"钩{i}", "cliffhanger": f"悬念{i}",
         "events": [f"事件{i}a", f"事件{i}b"]}
        for i in range(1, ep_count + 1)
    ]}


def _state():
    s = ProjectState(project_id="t-outline-review", stage="brief")
    s.idea = {"raw": "小美复仇", "episode_duration_seconds": 60}
    s.artifacts["worldbuilding"] = {"characters": [{"name": "小美"}],
                                    "ending_invariants": ["小美复仇成功"]}
    return s


class ConstReviewer:
    def __init__(self, verdicts):
        self.verdicts = list(verdicts)
        self.calls = 0

    def chat(self, messages, **kw):
        self.calls += 1
        v = self.verdicts[min(self.calls - 1, len(self.verdicts) - 1)]
        return json.dumps(v, ensure_ascii=False)


class WriterOK:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = 0

    def chat(self, messages, **kw):
        self.calls += 1
        return self.outputs[min(self.calls - 1, len(self.outputs) - 1)]


def _engine(writer, reviewer):
    return PixelWriterEngine(writer, reviewer, state_dir="/tmp/pw-outline-test")


class TestOutlineReview(unittest.TestCase):
    def test_review_pass_uses_first_draft(self):
        eng = _engine(WriterOK([json.dumps(_outline(), ensure_ascii=False)]),
                      ConstReviewer([{"pass": True, "score": 88, "dimensions": {"consistency": 90, "ending": 85, "pacing": 80}, "issues": []}]))
        state = _state()
        eng.run_outline(state, 3)
        self.assertEqual(eng.writer.calls, 1, "审核通过不应重写")
        self.assertTrue(state.artifacts["outline_review"]["pass"])

    def test_review_fail_triggers_rewrite(self):
        fail = {"pass": False, "score": 40, "dimensions": {"consistency": 30, "ending": 45, "pacing": 60},
                "issues": [{"severity": "high", "quote": "第2集", "fix": "主角隐身，偏离主线"}]}
        ok = {"pass": True, "score": 90, "dimensions": {"consistency": 92, "ending": 88, "pacing": 85}, "issues": []}
        eng = _engine(WriterOK([json.dumps(_outline(), ensure_ascii=False),
                                json.dumps(_outline(), ensure_ascii=False)]),
                      ConstReviewer([fail, ok]))
        state = _state()
        eng.run_outline(state, 3)
        self.assertEqual(eng.writer.calls, 2, "审核不通过应重写一次")
        self.assertEqual(eng.reviewer.calls, 2)
        self.assertTrue(state.artifacts["outline_review"]["pass"])

    def test_rewrite_still_fails_marks_review(self):
        fail = {"pass": False, "score": 30, "dimensions": {"consistency": 25, "ending": 30, "pacing": 40},
                "issues": [{"severity": "high", "quote": "第1集", "fix": "偏离结局不变量"}]}
        eng = _engine(WriterOK([json.dumps(_outline(), ensure_ascii=False)] * 3),
                      ConstReviewer([fail, fail, fail]))
        state = _state()
        eng.run_outline(state, 3)
        self.assertEqual(eng.writer.calls, 3, "重写最多 2 次（初稿 + 2）")
        self.assertFalse(state.artifacts["outline_review"]["pass"])
        self.assertGreaterEqual(len(state.artifacts["outline_review"]["issues"]), 1)

    def test_review_exception_treated_as_pass(self):
        class Boom:
            def chat(self, messages, **kw):
                raise RuntimeError("timeout")

        eng = _engine(WriterOK([json.dumps(_outline(), ensure_ascii=False)]), Boom())
        state = _state()
        eng.run_outline(state, 3)
        self.assertTrue(state.artifacts["outline_review"]["pass"])
        self.assertIn("warning", state.artifacts["outline_review"])

    def test_invalid_json_retries_then_raises(self):
        eng = _engine(WriterOK(["不是 JSON"] * 3), ConstReviewer([{"pass": True}]))
        state = _state()
        with self.assertRaises(ValueError) as ctx:
            eng.run_outline(state, 3)
        self.assertIn("合法 JSON", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
