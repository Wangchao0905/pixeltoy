"""Task 4: 审核修订闭环测试（FakeReviewer 模拟 DeepSeek，不真实调用模型）。"""
import json
import unittest
from engine import PixelWriterEngine, ProjectState, normalize_idea

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

    def test_localize_actions_converts_english_prose(self):
        # 剧情中文化：英文 action/location → 中文（对白 line 不动）
        writer = FakeWriter([json.dumps({"items": [
            {"key": "loc:0", "zh": "月亮花店门口"},
            {"key": "act:0:0", "zh": "她靠在花店橱窗边"},
        ]}, ensure_ascii=False)])
        engine = PixelWriterEngine(writer, ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-loc", stage="episode")
        state.artifacts["episodes"] = {"1": {"scenes": [{
            "location": "Outside Moonflower House, late afternoon",
            "beats": [{"speaker": "Luna", "line": "My tummy hurts.", "action": "She leans against the window."}],
        }]}}
        converted = engine.localize_actions(state)
        scene = state.artifacts["episodes"]["1"]["scenes"][0]
        self.assertGreaterEqual(converted, 2, "应转换 location + action 两处")
        self.assertEqual(scene["location"], "月亮花店门口")
        self.assertEqual(scene["beats"][0]["action"], "她靠在花店橱窗边")
        self.assertEqual(scene["beats"][0]["line"], "My tummy hurts.", "对白语言不得被改动")

    def test_localize_skips_chinese_content(self):
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-loc2", stage="episode")
        state.artifacts["episodes"] = {"1": {"scenes": [{"location": "月亮花店门口", "beats": [{"speaker": "Luna", "line": "肚子疼", "action": "她靠在橱窗边。"}]}]}}
        converted = engine.localize_actions(state)
        self.assertEqual(converted, 0, "纯中文内容不应触发转换")

    def test_generate_episode_auto_localizes_english_prose(self):
        # 生成时自动强制中文化：模型输出英文 action/location → 保存前自动转换（对白不动）
        writer = FakeWriter([
            json.dumps({"scenes": [
                {"location": "Outside Moonflower House, late afternoon",
                 "beats": [{"speaker": "Luna", "line": "Excuse me, little one.", "action": "Dorian slows on the sidewalk."}]}
            ]}, ensure_ascii=False),
            json.dumps({"items": [
                {"key": "loc:0", "zh": "月亮花店门口，午后"},
                {"key": "act:0:0", "zh": "Dorian 在花店旁放慢脚步"},
            ]}, ensure_ascii=False),
        ])
        engine = PixelWriterEngine(writer, ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-auto", stage="episode")
        state.current_episode = 1
        idea = normalize_idea("小美为救母亲进入豪门，却身世成谜")
        idea["episode_duration_seconds"] = 60
        idea["dialogue_language"] = "en"
        state.idea = idea
        state.artifacts["worldbuilding"] = {"characters": [{"name": "小美"}], "world_rules": []}
        state.artifacts["outline"] = {"episodes": [{"index": 1, "episode_title": "第1集", "hook": "开场冲突", "events": ["相遇"], "cliffhanger": "悬念"}]}
        engine.generate_episode(state)
        scene = state.artifacts["episodes"]["1"]["scenes"][0]
        self.assertEqual(scene["location"], "月亮花店门口，午后", "生成后 location 必须被自动转为中文")
        self.assertEqual(scene["beats"][0]["action"], "Dorian 在花店旁放慢脚步", "生成后 action 必须被自动转为中文")
        self.assertEqual(scene["beats"][0]["line"], "Excuse me, little one.", "对白语言不得被改动")

    def test_pass_string_false_not_truthy(self):
        # DeepSeek 返回 "pass":"false"（字符串）：必须走修订 → 3 次未通过 → needs-human，不得 approved
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(PASS_STR_FALSE), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t3", stage="episode")
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "needs-human")
        self.assertIs(result["verdict"]["pass"], False)  # 规范化后是布尔 False

class TestDialogueLanguage(unittest.TestCase):
    """对白语言选择：英文时生成/审核/修订全部按英语母语者语境本土化。"""

    def _make_state(self, lang=None):
        state = ProjectState(project_id="t-dl", stage="episode")
        state.artifacts["worldbuilding"] = {"characters": []}
        state.idea["episode_duration_seconds"] = 60
        if lang:
            state.idea["dialogue_language"] = lang
        return state

    def test_en_prompt_localizes_dialogue(self):
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        prompt = engine._prompt_episode(self._make_state("en"), {"index": 1, "events": []})
        self.assertIn("对白语言", prompt)
        self.assertIn("本土化", prompt)
        self.assertIn("不得直译", prompt)
        self.assertIn("俚语", prompt)
        # 语言范围：只有对白是英文，剧情/动作/场景恒中文
        self.assertIn("只有对白（line 字段）使用英文", prompt)
        self.assertIn("动作描述（action）及一切剧情描述一律使用中文", prompt)

    def test_zh_prompt_keeps_contract(self):
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        prompt = engine._prompt_episode(self._make_state(), {"index": 1, "events": []})
        self.assertIn("对白语言：中文", prompt)
        self.assertIn("对白契约", prompt)

    def test_en_review_checks_english_naturalness(self):
        reviewer = FakeReviewer([ACCEPT])
        engine = PixelWriterEngine(ConstLLM("{}"), reviewer, state_dir="/tmp/pw-test")
        engine.review_episode(self._make_state("en"), {"scenes": []})
        review_prompt = reviewer.calls[-1][0]["content"]
        self.assertIn("英语母语者", review_prompt)
        self.assertIn("翻译腔", review_prompt)

    def test_en_revise_keeps_english(self):
        writer = FakeWriter(["{}"])
        engine = PixelWriterEngine(writer, ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        engine.revise_episode(self._make_state("en"), {"scenes": []}, [{"severity": "high", "mode": 1, "quote": "x", "fix": "y"}])
        revise_prompt = writer.calls[-1][0]["content"]
        self.assertIn("保持英文", revise_prompt)
        self.assertIn("不得翻译腔", revise_prompt)

class TestDurationTemplate(unittest.TestCase):
    """时长驱动的单集结构模板：30-45s 快节奏 / 60s 双节拍 / 90-120s 双转折。"""

    def _engine(self):
        return PixelWriterEngine(ConstLLM("{}"), ConstLLM(ACCEPT), state_dir="/tmp/pw-test")

    def test_template_levels(self):
        engine = self._engine()
        self.assertIn("45 秒内快节奏", engine._structure_template(30))
        self.assertIn("60 秒双节拍", engine._structure_template(60))
        self.assertIn("90-120 秒双转折", engine._structure_template(120))
        self.assertIn("开场即冲突", engine._structure_template(None))

    def test_outline_embeds_template(self):
        engine = self._engine()
        state = ProjectState(project_id="t-dur", stage="outline")
        state.idea["episode_duration_seconds"] = 60
        state.artifacts["worldbuilding"] = {"characters": []}
        prompt = engine._prompt_outline(state, 3)
        self.assertIn("60 秒双节拍", prompt)

    def test_episode_embeds_template(self):
        engine = self._engine()
        state = ProjectState(project_id="t-dur2", stage="episode")
        state.idea["episode_duration_seconds"] = 120
        state.artifacts["worldbuilding"] = {"characters": []}
        prompt = engine._prompt_episode(state, {"index": 1, "events": []})
        self.assertIn("双转折", prompt)
        self.assertIn("7-10 个节拍", prompt)

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
