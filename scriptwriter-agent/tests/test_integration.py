"""Task 8 全链路集成冒烟：Fake LLM（ScriptedLLM）跑通 创意→世界设定→分集大纲→逐集剧本（含审核闭环）→docx 导出。"""
import unittest
from engine import PixelWriterEngine, ProjectState
from docx_export import export_docx
import os, tempfile, zipfile

class ScriptedLLM:
    """按 prompt 关键字返回脚本化输出，模拟双模型。"""
    def __init__(self): self.outputs = {"worldbuilding": '{"characters":[{"name":"林晓"}],"world":{"rules":[]},"ending_invariants":[]}', "outline": '{"episodes":[{"index":1,"hook":"h","cliffhanger":"c","events":[]}]}', "episode": '{"scenes":[{"location":"拳场","beats":[{"speaker":"林晓","line":"我妹妹的命，我来挣。","action":"握拳"}]}]}', "review_ok": '{"pass":true,"score":82,"dimensions":{"human_tone":85,"plot":80,"dialogue":82},"issues":[]}'}
    def chat(self, messages, **kw):
        # 路由关键字与 engine.py 实际 prompt 对齐：episode 提示词尾部拼接的文风契约含"审核"字样，
        # 故"写第"（episode 独有）必须优先于 review；"审核本集"仅 review prompt 含，revise 提示词以"问题清单"识别。
        text = messages[0]["content"]
        if "写第" in text: return self.outputs["episode"]
        if "审核本集" in text: return self.outputs["review_ok"]  # reviewer
        if "问题清单" in text: return self.outputs["episode"]    # revise：定向修订后仍为剧本结构
        if "分集大纲" in text or "episodes" in text: return self.outputs["outline"]
        return self.outputs["worldbuilding"]

class TestIntegration(unittest.TestCase):
    def test_full_flow_to_docx(self):
        llm = ScriptedLLM()
        engine = PixelWriterEngine(llm, llm, state_dir=tempfile.mkdtemp())
        state = engine.run_brief("林晓为救患癌妹妹闯入地下拳场，但警方卧底盯上了她")
        engine.run_worldbuilding(state)
        engine.run_outline(state, 1)
        for _ in range(1):
            outline = state.artifacts["outline"]["episodes"][state.current_episode - 1]
            engine.run_episode_loop(state, outline)
        path = os.path.join(tempfile.mkdtemp(), "out.docx")
        export_docx(state, path)
        self.assertTrue(zipfile.is_zipfile(path))
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8")
        self.assertIn("林晓", xml)
        self.assertIn("我妹妹的命", xml)
