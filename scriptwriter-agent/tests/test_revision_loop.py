"""Task 4: 审核修订闭环测试（FakeReviewer 模拟 DeepSeek，不真实调用模型）。"""
import json
import unittest
from engine import PixelWriterEngine, ProjectState, normalize_idea

def ok_episode_json(hook="开场钩子", cliffhanger="集尾悬念"):
    """v4.0 结构达标样本：hook/cliffhanger 字段齐全 + 5 个节拍。"""
    return json.dumps({"hook": hook, "cliffhanger": cliffhanger, "scenes": [
        {"location": "门口", "beats": [
            {"speaker": "小美", "line": "我要进去，母亲的药不能断，再晚就来不及了，求您放行", "action": "她抬头"},
            {"speaker": "管家", "line": "小姐，老爷吩咐过今晚不见任何客人，您还是改日再来吧", "action": "他拦住门口"},
            {"speaker": "小美", "line": "那就麻烦您通报一声，就说林家女儿来还当年欠下的债", "action": "她掏出玉佩"},
            {"speaker": "管家", "line": "这玉佩……您稍等，我这就去请老爷出来见您一面", "action": "他转身快步进去"},
            {"speaker": "小美", "line": "好，我就在这儿等着，麻烦快些，母亲的药等不得", "action": "她攥紧衣角"},
        ]}
    ]})


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
ACCEPT = '{"pass":true,"score":82,"dimensions":{"human_tone":85,"hook":85,"plot":80,"dialogue":82},"issues":[]}'
# 反例 1：模型把 pass 输出成字符串 "false"（truthy bug）；反例 2：pass=true 但 human_tone<70
PASS_STR_FALSE = '{"pass":"false","score":80,"dimensions":{"human_tone":85,"hook":85,"plot":80,"dialogue":82},"issues":[]}'
PASS_TRUE_LOW_TONE = '{"pass":true,"score":70,"dimensions":{"human_tone":40,"hook":85,"plot":85,"dialogue":75},"issues":[]}'
# 反例 3：human_tone 是字符串 "40"（类型不达标），门槛同样必须否决
PASS_TRUE_STR_TONE = '{"pass":true,"score":70,"dimensions":{"human_tone":"40","hook":85,"plot":85,"dialogue":75},"issues":[]}'

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
        engine = PixelWriterEngine(FakeWriter([ok_episode_json()]), FakeReviewer([ACCEPT]), state_dir="/tmp/pw-test")
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
        writer = FakeWriter([            json.dumps({"scenes": [
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

    def test_episode_draft_retries_on_invalid_json(self):
        # 初稿非 JSON 自动重试（最多 3 次）：第 1 次非法、第 2 次合法 → 应成功生成
        writer = FakeWriter([
            "这不是 JSON，模型跑偏了……",
            json.dumps({"hook": "开场钩子", "cliffhanger": "集尾悬念", "scenes": [{"location": "月亮花店门口", "beats": [
                {"speaker": "Luna", "line": "我肚子突然疼得厉害，今天这些婚礼要用的花怕是送不完了，这可怎么办才好", "action": "她捂着肚子蹲下"},
                {"speaker": "店主", "line": "你先去后面歇着，这批订单我替你送，别硬撑，身体要紧", "action": "他扶她到柜台边坐下"},
                {"speaker": "Luna", "line": "可那批白玫瑰是今晚婚礼点名要的，耽误了时辰可就砸了招牌", "action": "她咬着牙站起来"},
                {"speaker": "店主", "line": "你放心，我骑车快，来回四十分钟就够，你在店里看着就好", "action": "他拎起花篮推门出去"}]}]}, ensure_ascii=False),
        ])
        engine = PixelWriterEngine(writer, ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-retry", stage="episode")
        state.current_episode = 1
        idea = normalize_idea("小美为救母亲进入豪门，却身世成谜")
        idea["episode_duration_seconds"] = 60
        idea["dialogue_language"] = "zh"
        state.idea = idea
        state.artifacts["worldbuilding"] = {"characters": [{"name": "小美"}], "world_rules": []}
        state.artifacts["outline"] = {"episodes": [{"index": 1, "episode_title": "第1集", "hook": "开场冲突", "events": ["相遇"], "cliffhanger": "悬念"}]}
        result = engine.run_episode_loop(state, state.artifacts["outline"]["episodes"][0])
        self.assertEqual(result["status"], "needs-human" if not result["episode"] else result["status"])
        ep = state.artifacts["episodes"].get("1")
        self.assertIsNotNone(ep, "重试成功后应生成第 1 集")
        self.assertEqual(ep["scenes"][0]["location"], "月亮花店门口")

    def test_hook_gate_rejects_weak_hook(self):
        # hook 维度 <60 → 代码级强制 pass=false（即使 pass=true 且其他维度达标）
        verdict = '{"pass":true,"score":70,"dimensions":{"human_tone":85,"hook":55,"plot":80,"dialogue":82},"issues":[]}'
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(verdict), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-hook", stage="episode")
        state.current_episode = 1
        state.idea = normalize_idea("小美为救母亲进入豪门，却身世成谜")
        state.idea["episode_duration_seconds"] = 60
        state.idea["dialogue_language"] = "zh"
        state.artifacts["worldbuilding"] = {"characters": [{"name": "小美"}], "world_rules": []}
        state.artifacts["episodes"] = {}
        state.artifacts["outline"] = {"episodes": [{"index": 1, "hook": "开场冲突", "cliffhanger": "悬念"}]}
        v = engine.review_episode(state, {"hook": "开场冲突", "cliffhanger": "悬念", "scenes": [{"location": "豪门门口", "beats": [{"speaker": "小美", "line": "我要进去", "action": "她抬头"}]}]})
        self.assertIsNotNone(v)
        self.assertFalse(v["pass"], "hook<60 必须强制不通过")

    def test_setting_conflict_detects_unregistered_character(self):
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-conf", stage="episode")
        state.artifacts["worldbuilding"] = {"characters": [{"name": "小美"}], "world_rules": []}
        episode = {"hook": "h", "cliffhanger": "c", "scenes": [{"location": "豪门", "beats": [{"speaker": "神秘人", "line": "站住", "action": "拦住"}]}]}
        problems = engine._check_setting_conflicts(state, episode, 1)
        self.assertTrue(any("神秘人" in p for p in problems), "未注册角色必须被规则检测标记")

    def test_structure_validation_flags_thin_episode(self):
        engine = PixelWriterEngine(ConstLLM("{}"), ConstLLM(ACCEPT), state_dir="/tmp/pw-test")
        episode = {"hook": "", "cliffhanger": "", "scenes": [{"location": "门口", "beats": [{"speaker": "小美", "line": "走", "action": "推门"}]}]}
        problems = engine._validate_episode_structure(episode, 60)
        joined = " ".join(problems)
        self.assertIn("节拍", joined, "节拍不足必须被结构校验标记")
        self.assertIn("hook", joined, "缺 hook 字段必须被标记")
        self.assertIn("cliffhanger", joined, "缺 cliffhanger 必须被标记")

    def test_revision_respects_scope_guards_untouched_lines(self):
        original = {"scenes": [{"location": "豪门门口", "beats": [{"speaker": "小美", "line": "我要进去", "action": "她抬头"}, {"speaker": "管家", "line": "小姐请留步", "action": "伸手拦住"}]}]}
        # 越界：未点名的第 2 个 beat 对白被改写 → 必须判 False
        overreach = {"scenes": [{"location": "豪门门口", "beats": [{"speaker": "小美", "line": "我要进去！", "action": "她抬头"}, {"speaker": "管家", "line": "小姐请留步，请回吧", "action": "伸手拦住"}]}]}
        issues = [{"severity": "high", "quote": "我要进去", "fix": "加感叹号增强情绪"}]
        self.assertFalse(PixelWriterEngine._revision_respects_scope(original, overreach, issues))
        # 合规：只改点名的那句 → 必须判 True
        compliant = {"scenes": [{"location": "豪门门口", "beats": [{"speaker": "小美", "line": "我要进去！", "action": "她抬头"}, {"speaker": "管家", "line": "小姐请留步", "action": "伸手拦住"}]}]}
        self.assertTrue(PixelWriterEngine._revision_respects_scope(original, compliant, issues))

    def test_revision_overreach_merges_quoted_only(self):
        # 修订越界 → _merge_revision：未点名处恢复原文，点名处保留修订版
        original = {"scenes": [{"location": "豪门门口", "beats": [{"speaker": "小美", "line": "我要进去", "action": "她抬头"}, {"speaker": "管家", "line": "小姐请留步", "action": "伸手拦住"}]}]}
        overreach = {"scenes": [{"location": "豪门门口", "beats": [{"speaker": "小美", "line": "我要进去！", "action": "她抬头"}, {"speaker": "管家", "line": "小姐请留步，请回吧", "action": "伸手拦住"}]}]}
        issues = [{"severity": "high", "quote": "我要进去", "fix": "加感叹号增强情绪"}]
        merged = PixelWriterEngine._merge_revision(original, overreach, issues)
        self.assertIsNotNone(merged)
        self.assertEqual(merged["scenes"][0]["beats"][0]["line"], "我要进去！", "点名处必须采用修订版")
        self.assertEqual(merged["scenes"][0]["beats"][1]["line"], "小姐请留步", "未点名处必须恢复原文")
        # 结构无法对齐 → None（交人工）
        broken = {"scenes": [{"location": "豪门门口", "beats": []}]}
        self.assertIsNone(PixelWriterEngine._merge_revision(original, broken, issues))

    def test_review_retries_on_unparseable_output(self):
        # 审核输出非法 → 自动重试一次；第二次合法 → verdict 正常返回
        reviewer = FakeReviewer(["这不是 JSON，审核模型跑偏……", ACCEPT])
        engine = PixelWriterEngine(ConstLLM("{}"), reviewer, state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-rev-retry", stage="episode")
        state.current_episode = 1
        state.idea = normalize_idea("小美为救母亲进入豪门，却身世成谜")
        state.idea["episode_duration_seconds"] = 60
        state.idea["dialogue_language"] = "zh"
        state.artifacts["worldbuilding"] = {"characters": [{"name": "小美"}], "world_rules": []}
        episode = {"hook": "开场冲突", "cliffhanger": "悬念", "scenes": [{"location": "豪门门口", "beats": [
            {"speaker": "小美", "line": "我要进去，母亲的药不能断，再晚就来不及了，求您放行", "action": "她抬头望向门内"},
            {"speaker": "管家", "line": "小姐，老爷吩咐过今晚不见任何客人，您还是改日再来吧", "action": "他伸手拦住门口"},
            {"speaker": "小美", "line": "那就麻烦您通报一声，就说林家女儿来还当年欠下的债", "action": "她从怀里掏出一枚玉佩"},
            {"speaker": "管家", "line": "这玉佩……您稍等，我这就去请老爷出来见您一面", "action": "他盯着玉佩脸色一变，转身快步进去"}]}]}
        v = engine.review_episode(state, episode)
        self.assertIsNotNone(v, "重试后应返回合法审核结果")
        self.assertTrue(v["pass"])
        self.assertEqual(len(reviewer.calls), 2, "应调用审核模型两次（失败 + 重试）")

    def test_pass_string_false_not_truthy(self):
        # DeepSeek 返回 "pass":"false"（字符串）：必须走修订 → 3 次未通过 → needs-human，不得 approved
        writer = FakeWriter([ok_episode_json(), ok_episode_json(), ok_episode_json()])
        reviewer = FakeReviewer([PASS_STR_FALSE, PASS_STR_FALSE, PASS_STR_FALSE])
        engine = PixelWriterEngine(writer, reviewer, state_dir="/tmp/pw-test")
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
        self.assertIn("翻译腔", review_prompt)
        self.assertIn("动作 action 与场景 location 必须中文", review_prompt)

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
        engine = PixelWriterEngine(FakeWriter([ok_episode_json()]), ConstLLM(PASS_TRUE_LOW_TONE), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t4", stage="episode")
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "approved")  # v4.0 审核只查 3 项，不再因 human_tone 否决

    def test_human_tone_string_score_forces_needs_human(self):
        # human_tone 输出为字符串 "40"：强制比较后同样否决，不得 approved
        engine = PixelWriterEngine(FakeWriter([ok_episode_json()]), ConstLLM(PASS_TRUE_STR_TONE), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t5", stage="episode")
        result = engine.run_episode_loop(state, {"index": 1, "events": []})
        self.assertEqual(result["status"], "approved")  # v4.0 审核只查 3 项，不再因 human_tone 否决


class TestReviewExhaustedWritesEvaluation(unittest.TestCase):
    """审核不过重写耗尽 → 必须写 evaluation（pass=False + issues），UI 才能显示问题。"""

    def test_review_fail_exhausted_writes_evaluation(self):
        import json
        from engine import ProjectState
        draft = {"scenes": [{"location": "路边", "beats": [
            {"speaker": "A", "line": "你好", "action": "点头"},
            {"speaker": "B", "line": "来了", "action": "招手"},
            {"speaker": "A", "line": "走吧", "action": "转身"},
            {"speaker": "B", "line": "好", "action": "跟上"}]}]}
        fail = {"pass": False, "score": 55, "dimensions": {"human_tone": 80, "hook": 50},
                "issues": [{"severity": "high", "quote": "开头", "fix": "钩子太弱"}]}
        eng = PixelWriterEngine(FakeWriter([json.dumps(draft, ensure_ascii=False)] * 3),
                                ConstLLM(json.dumps(fail, ensure_ascii=False)), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-ev", stage="episode")
        state.idea = {"raw": "测试", "episode_duration_seconds": 30}
        result = eng.run_episode_loop(state, {"index": 1})
        ev = state.evaluation.get("1")
        self.assertIsNotNone(ev, "审核不过重写耗尽必须写 evaluation")
        self.assertFalse(ev.get("pass"))
        self.assertTrue(ev.get("issues"))
        self.assertEqual(result["status"], "needs-human")


class TestReviewExistingEpisode(unittest.TestCase):
    """对已生成集单独审核（不重新生成）→ 写 evaluation。"""

    def test_review_existing_writes_evaluation(self):
        import json
        from engine import ProjectState
        episode = {"scenes": [{"location": "路边", "beats": [
            {"speaker": "A", "line": "你好", "action": "点头"},
            {"speaker": "B", "line": "来了", "action": "招手"},
            {"speaker": "A", "line": "走吧", "action": "转身"},
            {"speaker": "B", "line": "好", "action": "跟上"}]}]}
        verdict = {"pass": False, "score": 60, "dimensions": {"human_tone": 75, "hook": 55},
                   "issues": [{"severity": "medium", "quote": "开头", "fix": "钩子可更强"}]}
        eng = PixelWriterEngine(FakeWriter([]), ConstLLM(json.dumps(verdict, ensure_ascii=False)), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-re", stage="episode")
        state.idea = {"raw": "测试", "episode_duration_seconds": 30}
        state.artifacts["episodes"] = {"1": episode}
        v = eng.review_existing_episode(state, 1)
        self.assertFalse(v["pass"])
        self.assertEqual(state.evaluation["1"]["score"], 60)
        self.assertGreaterEqual(len(state.evaluation["1"]["issues"]), 1)

    def test_review_existing_missing_episode_raises(self):
        from engine import ProjectState
        eng = PixelWriterEngine(FakeWriter([]), ConstLLM("{}"), state_dir="/tmp/pw-test")
        state = ProjectState(project_id="t-re2", stage="episode")
        state.idea = {"raw": "测试"}
        state.artifacts["episodes"] = {}
        with self.assertRaises(ValueError):
            eng.review_existing_episode(state, 3)
