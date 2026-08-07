import unittest, zipfile, os, tempfile
from docx_export import export_docx
from engine import ProjectState

class TestDocxExport(unittest.TestCase):
    def test_docx_is_valid_zip_with_document_xml(self):
        state = ProjectState(project_id="d1", stage="export")
        state.artifacts = {"worldbuilding": {"characters": [{"name": "林晓"}]},
                           "outline": {"episodes": [{"index": 1, "hook": "开门见血"}]},
                           "episodes": {"1": {"scenes": [{"location": "拳场", "beats": [{"speaker": "林晓", "line": "我妹妹的命，我来挣。", "action": "握拳"}]}]}}}
        path = os.path.join(tempfile.mkdtemp(), "out.docx")
        export_docx(state, path)
        self.assertTrue(zipfile.is_zipfile(path))
        with zipfile.ZipFile(path) as z:
            self.assertIn("word/document.xml", z.namelist())
            xml = z.read("word/document.xml").decode("utf-8")
        self.assertIn("林晓", xml)
        self.assertIn("我妹妹的命", xml)

    def test_docx_export_skips_none_episode_with_placeholder(self):
        # 生成失败待人工处理的集（episodes[idx] = None）导出为占位文本而非崩溃
        state = ProjectState(project_id="d2", stage="export")
        state.artifacts = {"worldbuilding": {}, "outline": {"episodes": [{"index": 1}]},
                           "episodes": {"1": None}}
        path = os.path.join(tempfile.mkdtemp(), "out.docx")
        export_docx(state, path)
        self.assertTrue(zipfile.is_zipfile(path))
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8")
        self.assertIn("待人工处理", xml)
