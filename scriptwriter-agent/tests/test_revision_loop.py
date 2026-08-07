"""Task 4: 审核修订闭环测试（FakeReviewer 模拟 DeepSeek，不真实调用模型）。"""
import unittest
from engine import PixelWriterEngine, ProjectState

class FakeWriter:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def chat(self, messages, **kw):
        self.calls.append(messages)
        return self.responses.pop(0)

class FakeReviewer:
    def __init__(self, verdicts):
        self.verdicts = list(verdicts)
        self.calls = []

    def chat(self, messages, **kw):
        self.calls.append(messages)
        return self.verdicts.pop(0)

REJECT = '{"pass":false,"score":55,"dimensions":{"human_tone":40,"plot":60,"dialogue":50},"issues":[{"severity":"high","mode":1,"quote":"总之","fix":"删掉开场总结"}]}'
ACCEPT = '{"pass":true,"score":82,"dimensions":{"human_tone":85,"plot":80,"dialogue":82},"issues":[]}'
# 反例 1：模型把 pass 输出成字符串 "false"（truthy bug）；反例 2：pass=true 但 human_tone<70
PASS_STR_FALSE = '{"pass":"false","score":80,"dimensions":{"human_tone":85,"plot":80,"dialogue":82},"issues":[]}'
PASS_TRUE_LOW_TONE = '{"pass":true,"score":70,"dimensions":{"human_tone":40,"plot":85,"dialogue":75},"issues":[]}'
# 反例 3：human_tone 是字符串 "40"（类型不达标），门槛同样必须否决
PASS_TRUE_STR_TONE = '{"pass":true,"score":70,"dimensions":{"human_tone":"40","plot":85,"dialogue":75},"issues":[]}'

class ConstLLM:
    """始终返回同一文本的假模型，供多轮循环反复调用。"""
    def __init__(self, text):
        self.text = text
    def chat(self, messages, **kw):
        return self.text

class TestRevisionLoop(unittest.TestCase):
    def test_revision_loop_max_two_rounds(self):
        # 3 次 REJECT → 2 轮修订 + 终审；writer 调用 = 1 初始生成 + 2 修订 = 3 次
        engine = PixelWriterEngine(FakeWriter(["{}", "{}", "{}"]), FakeReviewer([REJECT, REJECT, REJECT]), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t1", stage="episode")
        state.artifacts["worldbuilding"] = {"characters": []}
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "needs-human")
        self.assertLessEqual(len(engine.reviewer.calls), 3)  # 2 轮修订 + 终审

    def test_pass_stops_loop(self):
        engine = PixelWriterEngine(FakeWriter(["{}"]), FakeReviewer([ACCEPT]), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t2", stage="episode")
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "approved")

    def test_pass_string_false_not_truthy(self):
        # DeepSeek 返回 "pass":"false"（字符串）：必须走修订 → 3 次未通过 → needs-human，不得 approved
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(PASS_STR_FALSE), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t3", stage="episode")
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "needs-human")
        self.assertIs(result["verdict"]["pass"], False)  # 规范化后是布尔 False

    def test_human_tone_below_70_forces_needs_human(self):
        # pass=true 但 human_tone=40 < 70：代码级强制门必须否决，最终 needs-human
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(PASS_TRUE_LOW_TONE), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t4", stage="episode")
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "needs-human")
        self.assertIs(result["verdict"]["pass"], False)  # 强制改为 False

    def test_human_tone_string_score_forces_needs_human(self):
        # human_tone 输出为字符串 "40"：强制比较后同样否决，不得 approved
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(PASS_TRUE_STR_TONE), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t5", stage="episode")
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "needs-human")
        self.assertIs(result["verdict"]["pass"], False)
