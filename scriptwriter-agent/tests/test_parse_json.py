"""C1/C2 修复测试：模型输出 JSON 容错（_parse_json_block）+ 分集大纲规范化（_normalize_outline/run_outline）。"""
import json
import unittest
from engine import PixelWriterEngine, ProjectState

class ConstLLM:
    def __init__(self, text):
        self.text = text
    def chat(self, messages, **kw):
        return self.text

class TestParseJsonBlock(unittest.TestCase):
    def test_no_brace_returns_none(self):
        # 无 { 起点：不得切片崩溃，返回 None
        self.assertIsNone(PixelWriterEngine._parse_json_block("no json here at all"))
        self.assertIsNone(PixelWriterEngine._parse_json_block(""))
        self.assertIsNone(PixelWriterEngine._parse_json_block(None))
        self.assertIsNone(PixelWriterEngine._parse_json_block(42))

    def test_invalid_json_returns_none(self):
        self.assertIsNone(PixelWriterEngine._parse_json_block("{not json"))
        self.assertIsNone(PixelWriterEngine._parse_json_block("{\"a\": }"))

    def test_valid_json_parsed(self):
        self.assertEqual(PixelWriterEngine._parse_json_block('{"a": 1}'), {"a": 1})

    def test_markdown_fence_tolerated(self):
        text = '```json\n{"b": 2}\n```'
        self.assertEqual(PixelWriterEngine._parse_json_block(text), {"b": 2})

    def test_multiple_blocks_take_first(self):
        text = 'prefix {"first": 1} tail {"second": 2}'
        self.assertEqual(PixelWriterEngine._parse_json_block(text), {"first": 1})

    def test_trailing_noise_tolerated(self):
        self.assertEqual(PixelWriterEngine._parse_json_block('{"c": 3} some trailing words'),
                         {"c": 3})

    def test_non_dict_output_returns_none(self):
        # 数组/标量不是对象契约，返回 None 让调用方兜底
        self.assertIsNone(PixelWriterEngine._parse_json_block("[1, 2, 3]"))

class TestOutlineNormalization(unittest.TestCase):
    def _engine(self, text):
        return PixelWriterEngine(ConstLLM(text), ConstLLM('{"pass":true}'), state_dir="/tmp/pw-parse-test")

    def _state(self, pid="o1"):
        state = ProjectState(project_id=pid, stage="worldbuilding")
        state.artifacts["worldbuilding"] = {"characters": []}
        return state

    def test_episodes_truncated_and_reindexed(self):
        raw = {"episodes": [{"index": 99, "hook": "h1", "cliffhanger": "c1", "events": [1]},
                            {"hook": "h2", "cliffhanger": "c2", "events": [2]},
                            {"hook": "h3", "cliffhanger": "c3", "events": [3]},
                            {"hook": "h4", "cliffhanger": "c4", "events": [4]},
                            {"hook": "h5", "cliffhanger": "c5", "events": [5]}]}
        engine = self._engine('{"episodes": ' + json.dumps(raw["episodes"]) + '}')
        state = engine.run_outline(self._state(), 3)
        eps = state.artifacts["outline"]["episodes"]
        self.assertEqual(len(eps), 3)                       # 只取前 3 集
        self.assertEqual([e["index"] for e in eps], [1, 2, 3])  # index 重写为 1..N
        self.assertNotIn("truncated", state.artifacts["outline"])

    def test_insufficient_episodes_truncated_and_marked(self):
        raw = [{"index": 1, "hook": "h1", "cliffhanger": "c1"}, {"hook": "h2", "cliffhanger": "c2"}]
        engine = self._engine('{"episodes": ' + json.dumps(raw) + '}')
        state = engine.run_outline(self._state(), 3)
        outline = state.artifacts["outline"]
        self.assertEqual(len(outline["episodes"]), 2)
        self.assertTrue(outline["truncated"])
        self.assertIn("不足", outline["note"])

    def test_missing_hook_cliffhanger_filled_empty(self):
        engine = self._engine('{"episodes": [{"index": 1}]}')
        state = engine.run_outline(self._state(), 1)
        ep = state.artifacts["outline"]["episodes"][0]
        self.assertEqual(ep["hook"], "")
        self.assertEqual(ep["cliffhanger"], "")
        self.assertEqual(ep["events"], [])

    def test_invalid_outline_json_raises_valueerror(self):
        engine = self._engine("不是 JSON")
        with self.assertRaises(ValueError) as ctx:
            engine.run_outline(self._state(), 1)
        self.assertIn("合法 JSON", str(ctx.exception))

    def test_missing_episodes_raises_valueerror(self):
        engine = self._engine('{"episodes": []}')
        with self.assertRaises(ValueError) as ctx:
            engine.run_outline(self._state(), 1)
        self.assertIn("分集大纲", str(ctx.exception))

    def test_invalid_worldbuilding_json_raises_valueerror(self):
        engine = self._engine("不是 JSON")
        state = ProjectState(project_id="o2", stage="brief")
        state.idea = {"target": "主角", "goal": "测试", "conflict": "障碍",
                      "constraints": [], "raw": "测试创意"}
        with self.assertRaises(ValueError) as ctx:
            engine.run_worldbuilding(state)
        self.assertIn("合法 JSON", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
