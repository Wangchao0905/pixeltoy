import unittest
import tempfile, os
from engine import normalize_idea, PixelWriterEngine, ProjectState, STAGES

class TestNormalizeIdea(unittest.TestCase):
    def test_parses_goal_conflict(self):
        idea = "主角林晓为救患癌妹妹闯入地下拳场，隐瞒身份，但警方卧底盯上了她"
        r = normalize_idea(idea)
        self.assertIn("林晓", r["target"])
        self.assertIn("地下拳场", r["goal"])
        self.assertIn("卧底", r["conflict"])

    def test_stages_ordered(self):
        self.assertEqual(STAGES[0], "brief")
        self.assertEqual(STAGES[-1], "export")

class TestProjectState(unittest.TestCase):
    def test_roundtrip(self):
        s = ProjectState(project_id="p1", stage="brief")
        s2 = ProjectState.from_json(s.to_json())
        self.assertEqual(s2.project_id, "p1")
