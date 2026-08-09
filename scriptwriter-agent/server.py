"""Pixel Writer API：http.server 零依赖。--port 8877 --no-browser"""
import argparse
import json
import os
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from engine import PixelWriterEngine, ProjectState
from llm import make_gpt_client, make_deepseek_client, load_env
from docx_export import export_docx

# 同一项目并发写盘防护：/api/continue、/api/fix-issue 是长任务（分钟级），
# 前端连续点击会并发请求 → 同时 load/写同一 state 文件互相覆盖。
# 用 set + lock 保证同一 project_id 同时只有一个写任务在跑。
_busy_projects = set()
_busy_lock = threading.Lock()


def _claim_project(pid):
    """登记项目为处理中；已处理中返回 False（调用方应返回 409）。"""
    with _busy_lock:
        if pid in _busy_projects:
            return False
        _busy_projects.add(pid)
        return True


def _release_project(pid):
    with _busy_lock:
        _busy_projects.discard(pid)

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
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/api/projects":
                # 创作历史：列出 projects/ 下的项目摘要（按最近更新排序）
                items = []
                try:
                    if os.path.isdir(PROJECTS_DIR):
                        for name in os.listdir(PROJECTS_DIR):
                            if not name.endswith(".json"):
                                continue
                            path = os.path.join(PROJECTS_DIR, name)
                            try:
                                with open(path, encoding="utf-8") as f:
                                    state = ProjectState.from_json(f.read())
                            except Exception:
                                continue
                            episodes = state.artifacts.get("outline", {}).get("episodes", []) if isinstance(state.artifacts, dict) else []
                            total = len(episodes) if isinstance(episodes, list) else 0
                            items.append({
                                "project_id": state.project_id,
                                "stage": state.stage,
                                "current_episode": state.current_episode,
                                "total_episodes": total,
                                "mtime": os.path.getmtime(path),
                                "idea": (state.idea or {}).get("raw", "")[:60] if isinstance(state.idea, dict) else "",
                                "dialogue_language": (state.idea or {}).get("dialogue_language", "zh") if isinstance(state.idea, dict) else "zh",
                            })
                except Exception:
                    items = []
                items.sort(key=lambda item: item.get("mtime") or 0, reverse=True)
                self._json(200, {"ok": True, "projects": items})
            elif parsed.path == "/api/project":
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
                    raw_duration = body.get("episode_duration_seconds")
                    if raw_duration in (None, "", 0):
                        episode_duration_seconds = None
                    else:
                        try:
                            episode_duration_seconds = int(raw_duration)
                        except (TypeError, ValueError):
                            self._json(400, {"ok": False, "error": "invalid episode_duration_seconds"})
                            return
                        if not 30 <= episode_duration_seconds <= 120:
                            self._json(400, {"ok": False, "error": "invalid episode_duration_seconds"})
                            return
                    dialogue_language = "en" if body.get("dialogue_language") == "en" else "zh"
                    engine = engine_factory()
                    state = engine.run_brief(body.get("idea", ""))
                    idea_box = state.setdefault("idea", {}) if isinstance(state, dict) else getattr(state, "idea", None)
                    if idea_box is not None:
                        if episode_duration_seconds is not None:
                            idea_box["episode_duration_seconds"] = episode_duration_seconds
                        idea_box["dialogue_language"] = dialogue_language
                    engine.run_worldbuilding(state)
                    engine.run_outline(state, episode_count)
                    # 以规范化后的大纲实际集数为界推进，模型输出不足时不再越界
                    episodes = state.artifacts["outline"]["episodes"]
                    stepwise = body.get("stepwise") is True
                    if stepwise:
                        # 逐集模式：先生成第 1 集，返回等待"生成下一集"
                        if state.current_episode <= len(episodes):
                            engine.run_episode_loop(state, episodes[state.current_episode - 1])
                    else:
                        while state.current_episode <= len(episodes):
                            outline = episodes[state.current_episode - 1]
                            engine.run_episode_loop(state, outline)
                        state.stage = "export"
                    self._json(200, {"ok": True, "state": json.loads(state.to_json())})
                elif parsed.path == "/api/continue":
                    # 逐集推进：从磁盘恢复 state，生成下一集；全部完成后置 export。
                    # 复用 run_episode_loop（单集 + 审核修订闭环 + 自带落盘）。
                    pid = body.get("project_id", "")
                    path = _safe_project_path(pid, ".json")
                    if path is None or not os.path.exists(path):
                        self._json(404, {"ok": False, "error": "project not found"})
                        return
                    if not _claim_project(pid):
                        self._json(409, {"ok": False, "error": "该创作任务正在处理中，请等待完成后重试。"})
                        return
                    try:
                        with open(path, encoding="utf-8") as f:
                            state = ProjectState.from_json(f.read())
                    except Exception:
                        _release_project(pid)
                        self._json(500, {"ok": False, "error": "corrupt project state"})
                        return
                    engine = engine_factory()
                    episodes = state.artifacts.get("outline", {}).get("episodes", [])
                    # 重试指定集：回退 current_episode 并清除该集旧产物/审核记录，
                    # 再走同一生成审核闭环（用于"待处理/需人工处理"集重新生成）。
                    retry_ep = body.get("episode")
                    if retry_ep is not None:
                        try:
                            retry_ep = int(retry_ep)
                        except (TypeError, ValueError):
                            retry_ep = 0
                        if 1 <= retry_ep <= len(episodes):
                            state.current_episode = retry_ep
                            state.artifacts.setdefault("episodes", {}).pop(str(retry_ep), None)
                            if isinstance(state.evaluation, dict):
                                state.evaluation.pop(str(retry_ep), None)
                            state.stage = "episode"
                    if state.current_episode > len(episodes) or state.stage == "export":
                        state.stage = "export"
                        _release_project(pid)
                        self._json(200, {"ok": True, "done": True, "state": json.loads(state.to_json())})
                        return
                    outline = episodes[state.current_episode - 1]
                    try:
                        engine.run_episode_loop(state, outline)
                    except Exception as exc:
                        # 生成/审核异常必须落日志并返回 JSON 错误，否则 UI 会
                        # 收到 500 HTML 而提示"服务返回了无法读取的内容"，无法诊断。
                        import traceback
                        traceback.print_exc()
                        _release_project(pid)
                        self._json(500, {"ok": False, "error": f"生成第 {state.current_episode} 集失败：{type(exc).__name__}: {exc}"})
                        return
                    done = state.current_episode > len(episodes)
                    if done:
                        state.stage = "export"
                        # run_episode_loop 已落盘；此处仅补写 stage=export（测试假引擎可能无 _save）
                        getattr(engine, "_save", lambda s: None)(state)
                    _release_project(pid)
                    self._json(200, {"ok": True, "done": done, "state": json.loads(state.to_json())})
                elif parsed.path == "/api/localize":
                    # 剧情中文化：把已生成集的 action/location 转为中文（对白 line 不动）
                    pid = body.get("project_id", "")
                    path = _safe_project_path(pid, ".json")
                    if path is None or not os.path.exists(path):
                        self._json(404, {"ok": False, "error": "project not found"})
                        return
                    try:
                        with open(path, encoding="utf-8") as f:
                            state = ProjectState.from_json(f.read())
                    except Exception:
                        self._json(500, {"ok": False, "error": "corrupt project state"})
                        return
                    engine = engine_factory()
                    converted = engine.localize_actions(state)
                    self._json(200, {"ok": True, "converted": converted, "state": json.loads(state.to_json())})
                elif parsed.path == "/api/fix-issue":
                    # 单条问题定向修复：只把这一条 issue 交给 GPT 修订（quote 命中处），
                    # 其余 scene/beat 逐字不变（diff 约束 + 越界合并回滚），修完重新审核本集。
                    pid = body.get("project_id", "")
                    path = _safe_project_path(pid, ".json")
                    if path is None or not os.path.exists(path):
                        self._json(404, {"ok": False, "error": "project not found"})
                        return
                    if not _claim_project(pid):
                        self._json(409, {"ok": False, "error": "该创作任务正在处理中，请等待完成后重试。"})
                        return
                    try:
                        with open(path, encoding="utf-8") as f:
                            state = ProjectState.from_json(f.read())
                    except Exception:
                        _release_project(pid)
                        self._json(500, {"ok": False, "error": "corrupt project state"})
                        return
                    try:
                        ep_no = int(body.get("episode", 0))
                    except (TypeError, ValueError):
                        _release_project(pid)
                        self._json(400, {"ok": False, "error": "invalid episode"})
                        return
                    issue = body.get("issue")
                    if not isinstance(issue, dict):
                        _release_project(pid)
                        self._json(400, {"ok": False, "error": "missing issue"})
                        return
                    episodes_map = state.artifacts.setdefault("episodes", {})
                    episode = episodes_map.get(str(ep_no))
                    if not isinstance(episode, dict):
                        _release_project(pid)
                        self._json(404, {"ok": False, "error": "episode not found"})
                        return
                    engine = engine_factory()
                    try:
                        revised = engine.revise_episode(state, episode, [issue])
                    except Exception as exc:
                        import traceback
                        traceback.print_exc()
                        _release_project(pid)
                        self._json(500, {"ok": False, "error": f"定向修复失败：{type(exc).__name__}: {exc}"})
                        return
                    if not isinstance(revised, dict):
                        _release_project(pid)
                        self._json(422, {"ok": False, "error": "模型修订输出无法解析，请重试"})
                        return
                    if not engine._revision_respects_scope(episode, revised, [issue]):
                        merged = engine._merge_revision(episode, revised, [issue])
                        if merged is None:
                            _release_project(pid)
                            self._json(422, {"ok": False, "error": "修订越界且无法安全合并，请改用重新生成本集"})
                            return
                    else:
                        merged = revised
                    episodes_map[str(ep_no)] = merged
                    # 止损回滚：修复后若未通过且新问题数 >= 修复前问题数（越改越多），
                    # 自动恢复修复前版本与审核记录，避免"修一条出三条"。
                    old_eval = state.evaluation.get(str(ep_no)) if isinstance(state.evaluation, dict) else None
                    old_issues = (old_eval or {}).get("issues", []) if isinstance(old_eval, dict) else []
                    old_issue_count = len(old_issues)
                    try:
                        verdict = engine.review_episode(state, merged)
                    except Exception as exc:
                        import traceback
                        traceback.print_exc()
                        verdict = None
                    if verdict is None:
                        verdict = {"pass": False, "score": 0, "dimensions": {},
                                   "issues": [{"severity": "high", "mode": 0, "quote": "", "fix": "审核输出无法解析，请重试"}]}
                    new_issues = verdict.get("issues", []) if isinstance(verdict, dict) else []
                    if not isinstance(state.evaluation, dict):
                        state.evaluation = {}
                    if not verdict.get("pass") and len(new_issues) >= old_issue_count and old_issue_count > 0:
                        # 越改越多：回滚
                        episodes_map[str(ep_no)] = episode
                        state.evaluation[str(ep_no)] = old_eval if isinstance(old_eval, dict) else verdict
                        getattr(engine, "_save", lambda s: None)(state)
                        _release_project(pid)
                        self._json(200, {"ok": True, "status": "rolled-back",
                                         "verdict": state.evaluation[str(ep_no)],
                                         "state": json.loads(state.to_json())})
                        return
                    state.evaluation[str(ep_no)] = verdict
                    getattr(engine, "_save", lambda s: None)(state)
                    _release_project(pid)
                    status = "approved" if verdict.get("pass") else "needs-human"
                    self._json(200, {"ok": True, "status": status, "verdict": verdict, "state": json.loads(state.to_json())})
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
        from llm import load_env, make_gpt_client, make_deepseek_client, make_gemini_client
        env = load_env(ENV_PATH)
        # 三模型：GPT 主笔/修订 + DeepSeek 审核 + Gemini 争议仲裁（仅审核未过时复核一次）
        return PixelWriterEngine(make_gpt_client(env), make_deepseek_client(env),
                                 state_dir=PROJECTS_DIR,
                                 reviewer_b=make_gemini_client(env) if env.get("GEMINI_API_KEY") else None)

    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(engine_factory))
    print(f"Pixel Writer API on :{args.port}")
    server.serve_forever()

if __name__ == "__main__":
    main()
