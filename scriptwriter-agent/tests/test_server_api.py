import unittest
import json
import os
import threading
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from server import make_handler
from engine import ProjectState

class FakeEngine:
    def __init__(self):
        self.state = {"project_id": "p1", "stage": "export"}
    def run_brief(self, idea): return self.state
    def run_worldbuilding(self, state): return state
    def run_outline(self, state, n): return state
    def run_episode_loop(self, state, outline): return {"status": "approved"}
    def export_docx(self, path): return path

class SuccessfulEngine:
    """/api/start 全链路成功的假引擎：规范化大纲 2 集，循环无越界。"""
    def __init__(self):
        self.state = ProjectState(project_id="p1", stage="brief", current_episode=1)
        self.state.artifacts["outline"] = {"episodes": [{"index": 1, "hook": "h"}, {"index": 2, "hook": "h"}]}
    def run_brief(self, idea): return self.state
    def run_worldbuilding(self, state): return state
    def run_outline(self, state, n): return state
    def run_episode_loop(self, state, outline):
        state.current_episode += 1
        return {"status": "approved"}

class FailingOutlineEngine:
    """run_outline 抛业务错误（模型输出非法），应返回结构化 500 而非裸 HTML。"""
    def __init__(self):
        self.state = {"project_id": "p1", "stage": "brief"}
    def run_brief(self, idea): return self.state
    def run_worldbuilding(self, state): return state
    def run_outline(self, state, n):
        raise ValueError("模型输出不是合法 JSON，已重试仍失败")
    def run_episode_loop(self, state, outline): return {"status": "approved"}

class TestRoutes(unittest.TestCase):
    def test_project_route_registered(self):
        handler_cls = make_handler(FakeEngine())
        # 通过构造请求验证路由存在
        self.assertTrue(hasattr(handler_cls, "do_GET"))
        self.assertTrue(hasattr(handler_cls, "do_POST"))

    def test_static_ui_route(self):
        handler_cls = make_handler(lambda: None)
        # 直接访问 STATIC_FILES：未实现时抛 AttributeError 使测试失败（避免 getattr 默认值掩盖缺失）
        self.assertIn("index.html", handler_cls.STATIC_FILES)

class TestTraversalProtection(unittest.TestCase):
    """路径遍历防护：../ 穿越必须返回 404，不得泄露 projects/ 之外的文件内容。"""

    PROJECT_STATE = {"project_id": "secret", "stage": "brief", "idea": {},
                     "artifacts": {}, "evaluation": {},
                     "budget": {"max_revision_rounds": 2}, "current_episode": 0}

    def setUp(self):
        # 在项目根（CWD）放置越界目标文件，验证穿越请求无法读到它们
        self._tmp_json = "tmp_traversal_secret.json"
        self._tmp_docx = "tmp_traversal_secret.docx"
        with open(self._tmp_json, "w", encoding="utf-8") as f:
            f.write(json.dumps(self.PROJECT_STATE))
        with open(self._tmp_docx, "w", encoding="utf-8") as f:
            f.write("TRAVERSAL-SECRET")
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(lambda: None))
        self._srv = srv
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self._base = f"http://127.0.0.1:{srv.server_address[1]}"

    def tearDown(self):
        self._srv.shutdown()
        self._srv.server_close()
        os.remove(self._tmp_json)
        os.remove(self._tmp_docx)

    def test_api_project_traversal_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self._base + "/api/project?project_id=../tmp_traversal_secret")
        self.assertEqual(ctx.exception.code, 404)
        body = ctx.exception.read().decode("utf-8")
        self.assertEqual(json.loads(body)["error"], "invalid project id")
        self.assertNotIn("secret", body)

    def test_docx_download_traversal_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self._base + "/projects/../tmp_traversal_secret.docx")
        self.assertEqual(ctx.exception.code, 404)
        body = ctx.exception.read().decode("utf-8")
        self.assertNotIn("TRAVERSAL-SECRET", body)

    def test_export_traversal_rejected(self):
        body = json.dumps({"project_id": "../tmp_traversal_secret"}).encode("utf-8")
        req = urllib.request.Request(self._base + "/api/export", data=body, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 404)
        resp_body = ctx.exception.read().decode("utf-8")
        self.assertEqual(json.loads(resp_body)["error"], "invalid project id")
        self.assertNotIn("secret", resp_body)

    def test_normal_path_still_works(self):
        # 正常不存在的项目仍返回 project not found（非 invalid project id）
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self._base + "/api/project?project_id=missing")
        self.assertEqual(ctx.exception.code, 404)
        body = json.loads(ctx.exception.read().decode("utf-8"))
        self.assertEqual(body["error"], "project not found")

    def test_safe_project_path_rejects_traversal(self):
        from server import _safe_project_path
        # 各种非法/越界输入一律返回 None
        for bad in ("../secret", "..", ".", "%2e%2e%2fsecret", "a/b", "a\\b", ""):
            self.assertIsNone(_safe_project_path(bad, ".json"), bad)
        # 合法 id 落在 projects/ 内
        ok = _safe_project_path("p1", ".json")
        self.assertEqual(os.path.realpath(ok), os.path.realpath(os.path.join("projects", "p1.json")))

    def test_encoded_traversal_rejected(self):
        # 百分号编码的 ../ 同样被拒，不泄露文件内容
        for path in ("/projects/%2e%2e/tmp_traversal_secret.docx",
                     "/api/project?project_id=%2e%2e%2ftmp_traversal_secret"):
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(self._base + path)
            self.assertEqual(ctx.exception.code, 404, path)
            body = ctx.exception.read().decode("utf-8")
            self.assertEqual(json.loads(body)["error"], "invalid project id", path)

    def test_post_invalid_json_returns_400(self):
        # 非法 JSON body → 400 结构化错误，不 500
        req = urllib.request.Request(self._base + "/api/start", data=b"{broken", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)
        body = json.loads(ctx.exception.read().decode("utf-8"))
        self.assertEqual(body["error"], "invalid JSON body")

    def test_post_invalid_episode_count_returns_400(self):
        # episode_count 非数字 → 400，而非 int() 崩溃成 500
        payload = json.dumps({"idea": "测试", "episode_count": "abc"}).encode("utf-8")
        req = urllib.request.Request(self._base + "/api/start", data=payload, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)
        body = json.loads(ctx.exception.read().decode("utf-8"))
        self.assertEqual(body["error"], "invalid episode_count")

    def test_export_success_returns_relative_file(self):
        # /api/export 成功时 file 字段必须是 /projects/<id>.docx，不得泄露服务器绝对路径
        os.makedirs("projects", exist_ok=True)  # 干净 clone 下 projects/ 可能不存在
        pid = "export_test_p1"
        json_path = os.path.join("projects", f"{pid}.json")
        state = {"project_id": pid, "stage": "export", "idea": {"goal": "测试剧本"},
                 "artifacts": {}, "evaluation": {},
                 "budget": {"max_revision_rounds": 2}, "current_episode": 0}
        with open(json_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(state))
        try:
            body = json.dumps({"project_id": pid}).encode("utf-8")
            req = urllib.request.Request(self._base + "/api/export", data=body, method="POST")
            with urllib.request.urlopen(req) as r:
                self.assertEqual(r.status, 200)
                resp = json.loads(r.read().decode("utf-8"))
            self.assertEqual(resp["file"], f"/projects/{pid}.docx")
            self.assertTrue(resp["file"].startswith("/projects/"))
            self.assertNotIn(os.path.realpath("projects"), resp["file"])
            # docx 确实写到了 projects/ 内
            self.assertTrue(os.path.exists(os.path.join("projects", f"{pid}.docx")))
        finally:
            for p in (json_path, os.path.join("projects", f"{pid}.docx")):
                if os.path.exists(p):
                    os.remove(p)

class TestPostStart(unittest.TestCase):
    def setUp(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(SuccessfulEngine))
        self._srv = srv
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self._base = f"http://127.0.0.1:{srv.server_address[1]}"

    def tearDown(self):
        self._srv.shutdown()
        self._srv.server_close()

    def test_start_success_full_flow(self):
        # 规范化大纲 2 集 → 循环按实际集数推进，无 IndexError，200 + stage=export
        payload = json.dumps({"idea": "测试", "episode_count": 2}).encode("utf-8")
        req = urllib.request.Request(self._base + "/api/start", data=payload, method="POST")
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.status, 200)
            resp = json.loads(r.read().decode("utf-8"))
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["state"]["project_id"], "p1")
        self.assertEqual(resp["state"]["stage"], "export")

    def test_start_records_episode_duration_seconds(self):
        payload = json.dumps({"idea": "测试", "episode_count": 2, "episode_duration_seconds": 90}).encode("utf-8")
        req = urllib.request.Request(self._base + "/api/start", data=payload, method="POST")
        with urllib.request.urlopen(req) as r:
            resp = json.loads(r.read().decode("utf-8"))
        self.assertEqual(resp["state"]["idea"]["episode_duration_seconds"], 90)

    def test_start_stepwise_stops_after_first_episode(self):
        # 逐集模式：只推进第 1 集，不直接完成
        payload = json.dumps({"idea": "测试", "episode_count": 2, "stepwise": True}).encode("utf-8")
        req = urllib.request.Request(self._base + "/api/start", data=payload, method="POST")
        with urllib.request.urlopen(req) as r:
            resp = json.loads(r.read().decode("utf-8"))
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["state"]["current_episode"], 2, "stepwise 只应推进 1 集")
        self.assertNotEqual(resp["state"]["stage"], "export", "stepwise 不应直接完成")

    def test_continue_progresses_next_episode_then_done(self):
        # 手工落盘一个进行中的项目（假引擎不写盘），再调 /api/continue 逐集推进
        os.makedirs("projects", exist_ok=True)
        state = ProjectState(project_id="p2", stage="episode", current_episode=1)
        state.artifacts["outline"] = {"episodes": [{"index": 1, "hook": "h"}, {"index": 2, "hook": "h"}]}
        with open(os.path.join("projects", "p2.json"), "w", encoding="utf-8") as f:
            f.write(state.to_json())
        try:
            body = json.dumps({"project_id": "p2"}).encode("utf-8")
            req = urllib.request.Request(self._base + "/api/continue", data=body, method="POST")
            with urllib.request.urlopen(req) as r:
                self.assertEqual(r.status, 200)
                resp = json.loads(r.read().decode("utf-8"))
            self.assertTrue(resp["ok"])
            self.assertEqual(resp["state"]["current_episode"], 2)
            self.assertFalse(resp["done"])
            # 模拟真实引擎 run_episode_loop 落盘：把返回 state 写回磁盘
            with open(os.path.join("projects", "p2.json"), "w", encoding="utf-8") as f:
                f.write(ProjectState.from_json(json.dumps(resp["state"])).to_json())
            req2 = urllib.request.Request(self._base + "/api/continue", data=body, method="POST")
            with urllib.request.urlopen(req2) as r:
                resp2 = json.loads(r.read().decode("utf-8"))
            self.assertTrue(resp2["done"])
            self.assertEqual(resp2["state"]["stage"], "export")
        finally:
            for p in ("projects/p2.json", "projects/p1.json"):
                if os.path.exists(p):
                    os.remove(p)

    def test_continue_retry_episode(self):
        # /api/continue 带 episode 参数：回退到指定集重试，清除该集旧产物与审核记录
        os.makedirs("projects", exist_ok=True)
        state = ProjectState(project_id="p2b", stage="episode", current_episode=3)
        state.artifacts["outline"] = {"episodes": [{"index": 1, "hook": "h"}, {"index": 2, "hook": "h"}, {"index": 3, "hook": "h"}]}
        state.artifacts["episodes"] = {"1": {"scenes": []}, "2": {"scenes": []}, "3": {"scenes": []}}
        state.evaluation = {"1": {"pass": True}, "2": {"pass": False}, "3": {"pass": True}}
        with open(os.path.join("projects", "p2b.json"), "w", encoding="utf-8") as f:
            f.write(state.to_json())
        try:
            body = json.dumps({"project_id": "p2b", "episode": 2}).encode("utf-8")
            req = urllib.request.Request(self._base + "/api/continue", data=body, method="POST")
            with urllib.request.urlopen(req) as r:
                self.assertEqual(r.status, 200)
                resp = json.loads(r.read().decode("utf-8"))
            self.assertTrue(resp["ok"])
            self.assertNotIn("2", resp["state"].get("artifacts", {}).get("episodes", {}), "重试集旧产物必须被清除")
            self.assertNotIn("2", resp["state"].get("evaluation", {}), "重试集旧审核记录必须被清除")
            self.assertIn("3", resp["state"].get("artifacts", {}).get("episodes", {}), "后续已生成集必须保留")
        finally:
            for p in ("projects/p2b.json",):
                if os.path.exists(p):
                    os.remove(p)

    def test_continue_project_not_found(self):
        body = json.dumps({"project_id": "no_such"}).encode("utf-8")
        req = urllib.request.Request(self._base + "/api/continue", data=body, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 404)

    def test_projects_lists_history(self):
        # 落盘两个项目后 /api/projects 应返回摘要列表
        os.makedirs("projects", exist_ok=True)
        for pid in ("phist1", "phist2"):
            state = ProjectState(project_id=pid, stage="episode", current_episode=2)
            state.artifacts["outline"] = {"episodes": [{"index": 1, "hook": "h"}, {"index": 2, "hook": "h"}]}
            with open(os.path.join("projects", f"{pid}.json"), "w", encoding="utf-8") as f:
                f.write(state.to_json())
        try:
            req = urllib.request.Request(self._base + "/api/projects")
            with urllib.request.urlopen(req) as r:
                resp = json.loads(r.read().decode("utf-8"))
            self.assertTrue(resp["ok"])
            ids = [item["project_id"] for item in resp["projects"]]
            self.assertIn("phist1", ids)
            self.assertIn("phist2", ids)
            entry = next(item for item in resp["projects"] if item["project_id"] == "phist1")
            self.assertEqual(entry["total_episodes"], 2)
            self.assertEqual(entry["current_episode"], 2)
        finally:
            for p in ("projects/phist1.json", "projects/phist2.json"):
                if os.path.exists(p):
                    os.remove(p)

    def test_start_records_dialogue_language(self):
        payload = json.dumps({"idea": "测试", "episode_count": 1, "dialogue_language": "en"}).encode("utf-8")
        req = urllib.request.Request(self._base + "/api/start", data=payload, method="POST")
        with urllib.request.urlopen(req) as r:
            resp = json.loads(r.read().decode("utf-8"))
        self.assertEqual(resp["state"]["idea"]["dialogue_language"], "en")
        payload_zh = json.dumps({"idea": "测试", "episode_count": 1, "dialogue_language": "zh"}).encode("utf-8")
        req_zh = urllib.request.Request(self._base + "/api/start", data=payload_zh, method="POST")
        with urllib.request.urlopen(req_zh) as r:
            resp_zh = json.loads(r.read().decode("utf-8"))
        self.assertEqual(resp_zh["state"]["idea"]["dialogue_language"], "zh")

    def test_start_engine_error_returns_structured_500(self):
        # run_outline 抛 ValueError（模型输出非法）→ 结构化 500 JSON，而非 500 裸 HTML
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(FailingOutlineEngine))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        try:
            payload = json.dumps({"idea": "测试", "episode_count": 1}).encode("utf-8")
            req = urllib.request.Request(base + "/api/start", data=payload, method="POST")
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req)
            self.assertEqual(ctx.exception.code, 500)
            body = json.loads(ctx.exception.read().decode("utf-8"))
            self.assertEqual(body["ok"], False)
            self.assertIn("合法 JSON", body["error"])
        finally:
            srv.shutdown()
            srv.server_close()
