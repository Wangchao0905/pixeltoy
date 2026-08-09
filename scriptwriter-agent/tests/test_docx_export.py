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

class TestV41Format(unittest.TestCase):
    def test_delivery_format_short_drama(self):
        """v4.1 交付格式：△动作行、'角色：对白'、'集-场 地点'、场景人物清单、人物简介。"""
        state = ProjectState(project_id="fmt", stage="export")
        state.idea = {"goal": "铁拳俏保姆", "raw": "格斗冠军应聘亿万富翁保姆"}
        state.artifacts["worldbuilding"] = {"characters": [
            {"name": "卡米拉", "persona": "格斗冠军", "motivation": "还债"},
            {"name": "伊森", "persona": "瘫痪霸总", "motivation": "求死"},
        ]}
        state.artifacts["episodes"] = {"1": {"scenes": [
            {"location": "豪宅前院", "beats": [
                {"speaker": "", "line": "", "action": "卡米拉气喘吁吁跑到门口"},
                {"speaker": "詹姆斯", "line": "你迟到了。"},
            ]},
        ]}}
        path = "/tmp/pw-fmt.docx"
        export_docx(state, path)
        z = zipfile.ZipFile(path)
        xml = z.read("word/document.xml").decode("utf-8")
        self.assertIn("铁拳俏保姆", xml)
        self.assertIn("人物简介", xml)
        self.assertIn("卡米拉", xml)
        self.assertIn("剧本正文", xml)
        self.assertIn("1-1 豪宅前院", xml, "场景号应为 集-场 格式")
        self.assertIn("人物：詹姆斯", xml, "场景应有人物清单")
        self.assertIn("△卡米拉气喘吁吁跑到门口", xml, "动作行应带 △ 前缀")
        self.assertIn("詹姆斯：你迟到了。", xml, "对白应为 角色：台词")
        self.assertNotIn("evaluation", xml, "不应导出原始 JSON 审核记录")
        self.assertNotIn("hook", xml, "参考格式无 hook 标注行")
