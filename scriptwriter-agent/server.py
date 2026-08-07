"""Pixel Writer API：http.server 零依赖。--port 8877 --no-browser"""
import argparse
import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from engine import PixelWriterEngine, ProjectState
from llm import make_gpt_client, make_deepseek_client, load_env
from docx_export import export_docx

# 基于本文件位置解析路径，避免依赖进程 cwd（pm2 的 exec cwd 可能不在项目目录）。
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECTS_DIR = os.path.join(BASE_DIR, "projects")
ENV_PATH = os.path.join(BASE_DIR, ".env")

def _safe_project_path(pid, suffix):
    """把 project_id 解析为 projects/ 目录内的安全路径；越界/非法则返回 None。"""
    pid = urllib.parse.unquote(pid or "")
    if not pid or "/" in pid or "\\" in pid or pid in (".", ".."):
        return None
    base = os.path.realpath(PROJECTS_DIR)
    target = os.path.realpath(os.path.join(PROJECTS_DIR, pid + suffix))
    if os.path.commonpath([base, target]) != base:
        return None
    return target

def make_handler(engine_factory):
    class Handler(BaseHTTPRequestHandler):
        engine = None
        STATIC_FILES = {"index.html": os.path.join(BASE_DIR, "ui", "index.html")}

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _serve_static(self, name):
            # 静态文件兜底路由：文件不存在时返回 404 JSON，避免抛异常
            path = self.STATIC_FILES.get(name)
            if not path or not os.path.exists(path):
                self._json(404, {"ok": False, "error": "not found"})
                return
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/api/project":
                qs = urllib.parse.parse_qs(parsed.query)
                pid = qs.get("project_id", [""])[0]
                path = _safe_project_path(pid, ".json")
                if path is None:
                    self._json(404, {"ok": False, "error": "invalid project id"})
                    return
                if os.path.exists(path):
                    try:
                        with open(path, encoding="utf-8") as f:
                            state = ProjectState.from_json(f.read())
                    except Exception:
                        # 状态文件损坏：结构化 500 而非裸 HTML
                        self._json(500, {"ok": False, "error": "corrupt project state"})
                        return
                    self._json(200, {"ok": True, "state": json.loads(state.to_json())})
                else:
                    self._json(404, {"ok": False, "error": "project not found"})
            elif parsed.path.startswith("/projects/") and parsed.path.endswith(".docx"):
                pid = parsed.path[len("/projects/"):-len(".docx")]
                file_path = _safe_project_path(pid, ".docx")
                if file_path is None:
                    self._json(404, {"ok": False, "error": "invalid project id"})
                    return
                if os.path.exists(file_path):
                    with open(file_path, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    self._json(404, {"ok": False, "error": "file not found"})
            elif parsed.path in ("/", "/index.html"):
                # 静态页面路由放在 API 路由之后，避免遮蔽 /api/ 与 /projects/ 前缀
                self._serve_static("index.html")
            else:
                self._json(404, {"ok": False, "error": "not found"})

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            try:
                length = int(self.headers.get("Content-Length", 0) or 0)
            except ValueError:
                self._json(400, {"ok": False, "error": "invalid Content-Length"})
                return
            if length < 0:
                self._json(400, {"ok": False, "error": "invalid Content-Length"})
                return
            body = {}
            if length:
                try:
                    body = json.loads(self.rfile.read(length).decode("utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                    self._json(400, {"ok": False, "error": "invalid JSON body"})
                    return
            if not isinstance(body, dict):
                self._json(400, {"ok": False, "error": "invalid JSON body"})
                return
            try:
                if parsed.path == "/api/start":
                    try:
                        episode_count = int(body.get("episode_count", 3))
                    except (TypeError, ValueError):
                        self._json(400, {"ok": False, "error": "invalid episode_count"})
                        return
                    if episode_count < 1:
                        self._json(400, {"ok": False, "error": "invalid episode_count"})
                        return
                    engine = engine_factory()
                    state = engine.run_brief(body.get("idea", ""))
                    engine.run_worldbuilding(state)
                    engine.run_outline(state, episode_count)
                    # 以规范化后的大纲实际集数为界推进，模型输出不足时不再越界
                    episodes = state.artifacts["outline"]["episodes"]
                    while state.current_episode <= len(episodes):
                        outline = episodes[state.current_episode - 1]
                        engine.run_episode_loop(state, outline)
                    state.stage = "export"
                    self._json(200, {"ok": True, "state": json.loads(state.to_json())})
                elif parsed.path == "/api/export":
                    pid = body.get("project_id", "")
                    path = _safe_project_path(pid, ".json")
                    if path is None:
                        self._json(404, {"ok": False, "error": "invalid project id"})
                        return
                    if not os.path.exists(path):
                        self._json(404, {"ok": False, "error": "project not found"})
                        return
                    with open(path, encoding="utf-8") as f:
                        state = ProjectState.from_json(f.read())
                    docx_out = _safe_project_path(pid, ".docx")
                    export_docx(state, docx_out)
                    # 写盘路径走 _safe_project_path 校验，响应 file 显式拼相对 URL（与 GET 下载路由一致，不泄漏绝对路径）
                    self._json(200, {"ok": True, "file": f"/projects/{pid}.docx"})
                else:
                    self._json(404, {"ok": False, "error": "not found"})
            except Exception as e:
                # 引擎业务错误（如模型输出非法 JSON）也返回结构化 JSON，绝不回 500 裸 HTML
                self._json(500, {"ok": False, "error": f"internal error: {type(e).__name__}: {e}"})

        def log_message(self, *args):
            pass  # 静默访问日志
    return Handler

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8877)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    def engine_factory():
        from llm import load_env
        env = load_env(ENV_PATH)
        return PixelWriterEngine(make_gpt_client(env), make_deepseek_client(env), state_dir=PROJECTS_DIR)

    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(engine_factory))
    print(f"Pixel Writer API on :{args.port}")
    server.serve_forever()

if __name__ == "__main__":
    main()
