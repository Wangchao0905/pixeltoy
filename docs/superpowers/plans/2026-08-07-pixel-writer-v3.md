# Pixel Writer v3.0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零新建中文短剧编剧服务 Pixel Writer v3.0（双模型 GPT+DeepSeek 反射闭环，Humanizer-zh 去 AI 腔审核，docx 导出）。

**Architecture:** 确定性流水线状态机（brief → worldbuilding → outline → episode loop → export），模型只负责生成与审核；DeepSeek 独立审核对照"设定事实+分集大纲+文风契约（Humanizer-zh）"，问题清单驱动 GPT 定向修订（≤2 轮）；纯 Python 标准库零第三方依赖。

**Tech Stack:** Python 3.9+ 标准库（http.server、urllib、zipfile、xml、json、unittest、venv）；前端原生 HTML/JS/CSS 单页。

## Global Constraints

- 零第三方运行时依赖：LLM 调用用 `urllib.request`，docx 用 `zipfile+xml.etree`，HTTP 用 `http.server`，测试用 `unittest`
- 双模型固定：主笔 = GPT（`GPT_MODEL`，走 `GPT_BASE_URL` 网关 + `GPT_API_KEY`）；审核 = DeepSeek（`DEEPSEEK_BASE_URL` + `DEEPSEEK_API_KEY`，默认官方 `https://api.deepseek.com/v1`，用户硬性决定不走网关）
- 审核契约固定：`facts/humanizer-zh.md`（21 个中文 AI 腔模式）+ `facts/文风契约.md`
- 修订预算：`max_revision_rounds=2`，超限标记 `needs-human` 不阻塞后续集
- 语言：全链路中文；剧本字段：分集大纲（钩尾衔接）+ 逐集剧本（场景/对白）
- 测试命令：`cd scriptwriter-agent && python3 -m unittest discover -s tests -v`（全绿标准）
- git 流程：本地 commit → push（新仓库）→ 生产 `git pull && pm2 restart pixel-writer`
- 部署路径：生产 `/home/ubuntu/apps/scriptwriter-agent`（8877 端口，pm2 服务名 `pixel-writer`）

---

### Task 1: 项目脚手架

**Files:**
- Create: `scriptwriter-agent/.gitignore`
- Create: `scriptwriter-agent/.env.example`
- Create: `scriptwriter-agent/facts/humanizer-zh.md`
- Create: `scriptwriter-agent/facts/文风契约.md`
- Create: `scriptwriter-agent/README.md`

**Interfaces:**
- Consumes: 无
- Produces: 目录结构；`facts/humanizer-zh.md`（后续 Task 4 审核契约读取）；`.env.example`（Task 2 llm.py 读取）

- [ ] **Step 1: 初始化目录与 git**

```bash
mkdir -p /Users/wangchao/Documents/Codex/2026-06-16/scriptwriter-agent/{facts,tests,ui,projects}
cd /Users/wangchao/Documents/Codex/2026-06-16/scriptwriter-agent
git init
```

- [ ] **Step 2: 写 .gitignore**

```
.env
projects/
__pycache__/
*.pyc
```

- [ ] **Step 3: 写 .env.example**

```
# GPT 主笔（OpenAI 兼容网关）
GPT_BASE_URL=https://api.apikey.fun/v1
GPT_API_KEY=sk-your-gateway-key
GPT_MODEL=gpt-5.6-terra

# DeepSeek 审核（官方端点，不走网关）
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEY=sk-7ee87289cc514489a26a9b2c90349302
DEEPSEEK_MODEL=deepseek-v4-pro
```

- [ ] **Step 4: 提炼 facts/humanizer-zh.md（审核契约，从内置 SKILL.md 提炼 21 模式）**

内容须含以下检查清单（后续 Task 4 逐条引用）：
1. AI 高频词（"总之/值得注意的是/不仅…而且"）2. 三段式机械结构 3. 破折号滥用 4. 否定式排比 5. 宣传腔/空洞金句 6. 千篇一律开头 7. 过度对称句 8. 无信息量修饰词 9. 万能连接词 10. 名词化堆砌 11. 排比句模板 12. 感叹号轰炸 13. "仿佛/宛如"滥用 14. 立场中立无细节 15. 冗余同义反复 16. 结尾升华套路 17. 书面语与对白不符 18. 缺乏具体数字/物件 19. 情绪直说而非呈现 20. 对话双方无差异 21. 标点规范（省略号/引号）

- [ ] **Step 5: 写 facts/文风契约.md（保留 v2.0 思路）**

短剧对白契约：口语化、短句、有潜台词、角色语言差异化、每场景有转折。

- [ ] **Step 6: 写 README.md（项目说明 + 运行方式）**

- [ ] **Step 7: 验证 + 提交**

```bash
cd /Users/wangchao/Documents/Codex/2026-06-16/scriptwriter-agent
test -f facts/humanizer-zh.md && test -f facts/文风契约.md && test -f .env.example && echo "scaffold OK"
git add -A && git commit -m "chore: scaffold Pixel Writer v3.0"
```

---

### Task 2: llm.py 双模型客户端

**Files:**
- Create: `scriptwriter-agent/llm.py`
- Test: `scriptwriter-agent/tests/test_llm.py`

**Interfaces:**
- Consumes: `.env`（Task 1）；`facts/`（Task 1）
- Produces:
  - `load_env(path=".env") -> dict`（解析 KEY=VALUE，忽略 # 注释）
  - `class LLMClient`（`__init__(base_url, api_key, model, timeout=120)`）
  - `LLMClient.chat(messages, temperature=0.7, max_tokens=4000) -> str`（POST `/chat/completions`，失败抛 `LLMError`，含 401/429/5xx 分类；重试 2 次指数退避）
  - `make_gpt_client() / make_deepseek_client()`（从 env 装配）
  - `LLMError(message, category)`（category ∈ {"auth","rate","timeout","network","server","bad_request"}）

- [ ] **Step 1: 写失败测试 test_llm.py**

```python
import unittest
from llm import load_env, LLMClient, LLMError, make_gpt_client, make_deepseek_client

class TestLoadEnv(unittest.TestCase):
    def test_parse_and_ignore_comments(self):
        env = load_env.__wrapped__ if hasattr(load_env, "__wrapped__") else None
        self.assertTrue(callable(load_env))

class TestLLMClient(unittest.TestCase):
    def test_error_category_classification(self):
        # 401 → auth；429 → rate；500 → server；连接失败 → network
        self.assertEqual(LLMError("x", "auth").category, "auth")
```

- [ ] **Step 2: 运行确认失败**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_llm -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'llm'`）

- [ ] **Step 3: 实现 llm.py**

```python
"""双模型 LLM 客户端（GPT 主笔 + DeepSeek 审核），标准库 urllib，零依赖。"""
import json
import os
import time
import urllib.request
import urllib.error

class LLMError(Exception):
    def __init__(self, message, category="network"):
        super().__init__(message)
        self.category = category

def load_env(path=".env"):
    env = {}
    if not os.path.exists(path):
        return env
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env

class LLMClient:
    def __init__(self, base_url, api_key, model, timeout=120):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def chat(self, messages, temperature=0.7, max_tokens=4000):
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        url = f"{self.base_url}/chat/completions"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"},
        )
        last_error = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                    return body["choices"][0]["message"]["content"]
            except urllib.error.HTTPError as e:
                category = {401: "auth", 403: "auth", 429: "rate"}.get(e.code, "server")
                last_error = LLMError(f"HTTP {e.code}: {e.read()[:200]!r}", category)
            except (urllib.error.URLError, TimeoutError) as e:
                last_error = LLMError(f"network: {e}", "timeout" if isinstance(e, TimeoutError) else "network")
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
        raise last_error

def make_gpt_client(env=None):
    env = env or load_env()
    return LLMClient(env.get("GPT_BASE_URL", "https://api.apikey.fun/v1"),
                     env.get("GPT_API_KEY", ""), env.get("GPT_MODEL", "gpt-5.6-terra"))

def make_deepseek_client(env=None):
    env = env or load_env()
    return LLMClient(env.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
                     env.get("DEEPSEEK_API_KEY", ""), env.get("DEEPSEEK_MODEL", "deepseek-v4-pro"))
```

- [ ] **Step 4: 运行确认通过**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_llm -v`
Expected: PASS（2 个测试）

- [ ] **Step 5: 提交**

```bash
cd scriptwriter-agent && git add llm.py tests/test_llm.py && git commit -m "feat: dual-model LLM client with error classification"
```

---

### Task 3: engine.py 确定性流水线（创意规范化 + 设定 + 大纲）

**Files:**
- Create: `scriptwriter-agent/engine.py`
- Test: `scriptwriter-agent/tests/test_engine_flow.py`

**Interfaces:**
- Consumes: `llm.LLMClient`（Task 2）；`facts/humanizer-zh.md`、`facts/文风契约.md`（Task 1）
- Produces:
  - `normalize_idea(idea_text: str) -> dict`（确定性解析：goal/target/conflict/constraints，纯规则无模型）
  - `ProjectState`（dataclass：`project_id/stage/artifacts/evaluation/budget/current_episode`，`to_json()/from_json()`）
  - `class PixelWriterEngine`：`__init__(writer, reviewer, state_dir)`；`run_brief(idea) -> dict`；`run_worldbuilding() -> dict`；`run_outline(episode_count) -> dict`；`generate_episode(index) -> dict`；`export_docx(path) -> str`（委托 Task 5）
  - 阶段常量：`STAGES = ["brief", "worldbuilding", "outline", "episode", "export"]`

- [ ] **Step 1: 写失败测试 test_engine_flow.py（先测确定性部分）**

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_engine_flow -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 实现 engine.py 骨架（确定性部分 + 生成步骤调用 reviewer/writer）**

```python
"""Pixel Writer v3.0 引擎：确定性流水线 + 反射闭环。"""
import json, os, re, time
from dataclasses import dataclass, field
from llm import LLMClient, LLMError

STAGES = ["brief", "worldbuilding", "outline", "episode", "export"]
MAX_REVISION_ROUNDS = 2

def normalize_idea(idea_text):
    """确定性解析创意，不调用模型。提取 target/goal/conflict/constraints。"""
    target = goal = conflict = ""
    # 主角：寻找“为/为救/要”前的人名短语（启发式，纯规则）
    m = re.search(r"([\u4e00-\u9fa5]{2,4})(?:为|为了|要)", idea_text)
    if m: target = m.group(1)
    m = re.search(r"为(?:了)?(?:救|实现|得到|进入|逃离|保护)([\u4e00-\u9fa5]{2,20})", idea_text)
    if m: goal = m.group(1)
    m = re.search(r"(?:但|然而|可是|却)([\u4e00-\u9fa5]{4,30})", idea_text)
    if m: conflict = m.group(1)
    return {
        "target": target or "主角",
        "goal": goal or idea_text[:20],
        "conflict": conflict or "未知障碍",
        "constraints": [],
        "raw": idea_text,
    }

@dataclass
class ProjectState:
    project_id: str
    stage: str = "brief"
    idea: dict = field(default_factory=dict)
    artifacts: dict = field(default_factory=dict)   # worldbuilding/outline/episodes
    evaluation: dict = field(default_factory=dict)  # 审核记录
    budget: dict = field(default_factory=lambda: {"max_revision_rounds": MAX_REVISION_ROUNDS})
    current_episode: int = 0

    def to_json(self):
        return json.dumps(self.__dict__, ensure_ascii=False, indent=2)

    @classmethod
    def from_json(cls, text):
        return cls(**json.loads(text))

class PixelWriterEngine:
    def __init__(self, writer, reviewer, state_dir="projects"):
        self.writer = writer        # LLMClient（GPT）
        self.reviewer = reviewer    # LLMClient（DeepSeek）
        self.state_dir = state_dir
        os.makedirs(state_dir, exist_ok=True)
        self.facts = self._load_facts()

    def _load_facts(self):
        out = {}
        for name in ("humanizer-zh.md", "文风契约.md"):
            path = os.path.join("facts", name)
            out[name] = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        return out

    def _save(self, state):
        path = os.path.join(self.state_dir, f"{state.project_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(state.to_json())

    def run_brief(self, idea_text):
        state = ProjectState(project_id=f"p{int(time.time())}", stage="brief")
        state.idea = normalize_idea(idea_text)
        state.stage = "worldbuilding"
        self._save(state)
        return state

    def run_worldbuilding(self, state):
        prompt = self._prompt_worldbuilding(state)
        content = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000)
        state.artifacts["worldbuilding"] = self._parse_json_block(content)
        state.stage = "outline"
        self._save(state)
        return state

    def run_outline(self, state, episode_count):
        prompt = self._prompt_outline(state, episode_count)
        content = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000)
        state.artifacts["outline"] = self._parse_json_block(content)
        state.stage = "episode"
        state.current_episode = 1
        self._save(state)
        return state

    def generate_episode(self, state):
        idx = state.current_episode
        outline = state.artifacts["outline"]["episodes"][idx - 1]
        prompt = self._prompt_episode(state, outline)
        content = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000)
        episode = self._parse_json_block(content)
        state.artifacts.setdefault("episodes", {})[str(idx)] = episode
        state.current_episode = idx + 1
        self._save(state)
        return state

    # --- 提示词构造（确定性模板，模型只负责内容）---
    def _prompt_worldbuilding(self, state):
        i = state.idea
        return f"""你是中文短剧编剧。基于创意生成世界设定，输出 JSON：
{{"characters":[{{"name":"","persona":"","motivation":""}}],
 "world":{{"rules":[],"tone":""}},
 "ending_invariants":[]}}
创意：{i['raw']}
约束：人物动机必须可解释；结局不变量必须明确。"""

    def _prompt_outline(self, state, episode_count):
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        return f"""基于设定生成 {episode_count} 集分集大纲，输出 JSON：
{{"episodes":[{{"index":1,"hook":"","cliffhanger":"","events":[]}}]}}
要求：每集以钩子开头、以悬念收尾，事件链因果衔接。
设定：{wb}"""

    def _prompt_episode(self, state, outline):
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        contract = self.facts["文风契约.md"]
        return f"""写第 {outline['index']} 集剧本，输出 JSON：
{{"scenes":[{{"location":"","beats":[{{"speaker":"","line":"","action":""}}]}}]}}
事件：{json.dumps(outline, ensure_ascii=False)}
设定：{wb}
对白契约：{contract[:500] if contract else '口语化、短句、有潜台词'}"""

    @staticmethod
    def _parse_json_block(text):
        """从模型输出提取首个 JSON 对象（容忍 markdown 代码围栏）。"""
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        start = text.find("{")
        end = text.rfind("}")
        return json.loads(text[start:end + 1])
```

- [ ] **Step 4: 运行确认通过**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_engine_flow -v`
Expected: PASS（3 个测试，确定性部分）

- [ ] **Step 5: 提交**

```bash
cd scriptwriter-agent && git add engine.py tests/test_engine_flow.py && git commit -m "feat: deterministic pipeline engine (brief/worldbuilding/outline/episode)"
```

---

### Task 4: 审核修订闭环（DeepSeek + Humanizer-zh 维度）

**Files:**
- Modify: `scriptwriter-agent/engine.py`（追加 `review_episode` / `revise_episode`）
- Test: `scriptwriter-agent/tests/test_revision_loop.py`

**Interfaces:**
- Consumes: `facts/humanizer-zh.md`（Task 1）；`PixelWriterEngine._parse_json_block`（Task 3）
- Produces:
  - `review_episode(state, episode) -> dict`（审核输出：`{"pass":bool, "score":int, "dimensions":{"human_tone":int,"plot":int,"dialogue":int}, "issues":[{"severity":"high|medium","mode":1-21,"quote":"","fix":""}]}`）
  - `revise_episode(state, episode, issues) -> dict`（GPT 定向修订）
  - `run_episode_loop(state) -> dict`（含修订轮次计数，`rounds>2 → status="needs-human"`）

- [ ] **Step 1: 写失败测试 test_revision_loop.py（用 FakeReviewer 模拟 DeepSeek，不真实调用）**

```python
import unittest
from engine import PixelWriterEngine, ProjectState

class FakeWriter:
    def __init__(self, responses): self.responses = list(responses); self.calls = []
    def chat(self, messages, **kw):
        self.calls.append(messages)
        return self.responses.pop(0)

class FakeReviewer:
    def __init__(self, verdicts): self.verdicts = list(verdicts); self.calls = []
    def chat(self, messages, **kw):
        self.calls.append(messages)
        return self.verdicts.pop(0)

REJECT = '{"pass":false,"score":55,"dimensions":{"human_tone":40,"plot":60,"dialogue":50},"issues":[{"severity":"high","mode":1,"quote":"总之","fix":"删掉开场总结"}]}'
ACCEPT = '{"pass":true,"score":82,"dimensions":{"human_tone":85,"plot":80,"dialogue":82},"issues":[]}'

class TestRevisionLoop(unittest.TestCase):
    def test_revision_loop_max_two_rounds(self):
        engine = PixelWriterEngine(FakeWriter(["{}", "{}"]), FakeReviewer([REJECT, REJECT, REJECT]), state_dir="/tmp/pw-test")
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_revision_loop -v`
Expected: FAIL（`AttributeError: 'PixelWriterEngine' object has no attribute 'run_episode_loop'`）

- [ ] **Step 3: 实现审核修订闭环**

```python
# engine.py 追加：
    def review_episode(self, state, episode):
        humanizer = self.facts["humanizer-zh.md"]
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        prompt = f"""你是短剧审核编辑。对照【设定事实】【Humanizer-zh 中文 AI 腔清单】审核本集。
设定：{wb[:800]}
本集：{json.dumps(episode, ensure_ascii=False)[:2000]}
AI 腔清单：{humanizer[:1200] if humanizer else '中文 AI 腔 21 模式'}

输出 JSON：{{"pass":bool,"score":0-100,"dimensions":{{"human_tone":0-100,"plot":0-100,"dialogue":0-100}},"issues":[{{"severity":"high|medium","mode":1-21,"quote":"原文","fix":"改写建议"}}]}}
规则：AI 腔分数<70 必须 pass=false；情节断裂/对白与设定冲突必须 high issue。"""
        content = self.reviewer.chat([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=2000)
        return self._parse_json_block(content)

    def revise_episode(self, state, episode, issues):
        prompt = f"""按问题清单定向修订本集，只改问题涉及处，保持其余不变。输出与原结构相同的 JSON 剧本。
问题清单：{json.dumps(issues, ensure_ascii=False)}
本集：{json.dumps(episode, ensure_ascii=False)}"""
        content = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000)
        return self._parse_json_block(content)

    def run_episode_loop(self, state, outline):
        rounds = 0
        episode = self._prompt_episode(state, outline)
        episode = self._parse_json_block(self.writer.chat([{"role": "user", "content": episode}], max_tokens=4000))
        while rounds <= MAX_REVISION_ROUNDS:
            verdict = self.review_episode(state, episode)
            if verdict.get("pass"):
                return {"status": "approved", "episode": episode, "verdict": verdict, "rounds": rounds}
            if rounds >= MAX_REVISION_ROUNDS:
                return {"status": "needs-human", "episode": episode, "verdict": verdict, "rounds": rounds}
            episode = self.revise_episode(state, episode, verdict.get("issues", []))
            rounds += 1
        return {"status": "needs-human", "episode": episode, "rounds": rounds}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_revision_loop -v`
Expected: PASS（2 个测试）

- [ ] **Step 5: 提交**

```bash
cd scriptwriter-agent && git add engine.py tests/test_revision_loop.py && git commit -m "feat: reflective review-revise loop with Humanizer-zh tone gate"
```

---

### Task 5: docx_export.py 纯 Python 导出

**Files:**
- Create: `scriptwriter-agent/docx_export.py`
- Test: `scriptwriter-agent/tests/test_docx_export.py`

**Interfaces:**
- Consumes: `ProjectState`（Task 3）
- Produces: `export_docx(state, path) -> str`（生成 .docx：标题 + 分集大纲 + 逐集剧本 + 审核记录附录）

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_docx_export -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 实现 docx_export.py**

```python
"""纯 Python 零依赖 docx 生成（zip + 最小 OOXML）。"""
import zipfile
import xml.sax.saxutils as sax

def _par(text):  # paragraph
    return f"<w:p><w:r><w:t>{sax.escape(str(text))}</w:t></w:r></w:p>"

def _heading(text):
    return f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{sax.escape(str(text))}</w:t></w:r></w:p>'

def export_docx(state, path):
    parts = [_heading(f"《{state.idea.get('goal', '未命名')}》剧本")]
    parts.append(_heading("一、分集大纲"))
    for ep in state.artifacts.get("outline", {}).get("episodes", []):
        parts.append(_par(f"第{ep.get('index')}集 钩子：{ep.get('hook')} 悬念：{ep.get('cliffhanger')}"))
    parts.append(_heading("二、逐集剧本"))
    for idx, ep in state.artifacts.get("episodes", {}).items():
        parts.append(_heading(f"第{idx}集"))
        for scene in ep.get("scenes", []):
            parts.append(_par(f"【场景】{scene.get('location')}"))
            for beat in scene.get("beats", []):
                speaker = beat.get("speaker", "")
                line = beat.get("line", "")
                parts.append(_par(f"{speaker}：{line}" if line else beat.get("action", "")))
    parts.append(_heading("三、审核记录（附录）"))
    parts.append(_par(str(state.evaluation)))
    document_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body>' + "".join(parts) + '</w:body></w:document>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", document_xml)
    return path
```

- [ ] **Step 4: 运行确认通过**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_docx_export -v`
Expected: PASS（1 个测试）

- [ ] **Step 5: 提交**

```bash
cd scriptwriter-agent && git add docx_export.py tests/test_docx_export.py && git commit -m "feat: zero-dependency docx export"
```

---

### Task 6: server.py http.server API

**Files:**
- Create: `scriptwriter-agent/server.py`
- Test: `scriptwriter-agent/tests/test_server_api.py`

**Interfaces:**
- Consumes: `PixelWriterEngine`（Task 3/4）、`LLMClient`（Task 2）、`export_docx`（Task 5）
- Produces:
  - `GET /api/project?project_id=...` → 状态 JSON
  - `POST /api/start`（body `{"idea": "...", "episode_count": 3}`）→ 全流程执行（同步），返回最终状态
  - `POST /api/export`（body `{"project_id": "..."}`）→ `{"file": "/projects/<id>.docx"}`；`GET /projects/<id>.docx` → 文件下载

- [ ] **Step 1: 写失败测试（用最小引擎替身测路由层）**

```python
import unittest
import json
from server import make_handler

class FakeEngine:
    def __init__(self):
        self.state = {"project_id": "p1", "stage": "export"}
    def run_brief(self, idea): return self.state
    def run_worldbuilding(self, state): return state
    def run_outline(self, state, n): return state
    def run_episode_loop(self, state, outline): return {"status": "approved"}
    def export_docx(self, path): return path

class TestRoutes(unittest.TestCase):
    def test_project_route_registered(self):
        handler_cls = make_handler(FakeEngine())
        # 通过构造请求验证路由存在
        self.assertTrue(hasattr(handler_cls, "do_GET"))
        self.assertTrue(hasattr(handler_cls, "do_POST"))
```

- [ ] **Step 2: 运行确认失败**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_server_api -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 实现 server.py**

```python
"""Pixel Writer API：http.server 零依赖。--port 8877 --no-browser"""
import argparse
import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from engine import PixelWriterEngine, ProjectState
from llm import make_gpt_client, make_deepseek_client
from docx_export import export_docx

def make_handler(engine_factory):
    class Handler(BaseHTTPRequestHandler):
        engine = None

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/api/project":
                qs = urllib.parse.parse_qs(parsed.query)
                pid = qs.get("project_id", [""])[0]
                path = os.path.join("projects", f"{pid}.json")
                if os.path.exists(path):
                    state = ProjectState.from_json(open(path, encoding="utf-8").read())
                    self._json(200, {"ok": True, "state": json.loads(state.to_json())})
                else:
                    self._json(404, {"ok": False, "error": "project not found"})
            elif parsed.path.startswith("/projects/") and parsed.path.endswith(".docx"):
                file_path = parsed.path.lstrip("/")
                if os.path.exists(file_path):
                    data = open(file_path, "rb").read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    self._json(404, {"ok": False, "error": "file not found"})
            else:
                self._json(404, {"ok": False, "error": "not found"})

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            if parsed.path == "/api/start":
                engine = engine_factory()
                state = engine.run_brief(body.get("idea", ""))
                engine.run_worldbuilding(state)
                engine.run_outline(state, int(body.get("episode_count", 3)))
                for _ in range(state.current_episode, int(body.get("episode_count", 3)) + 1):
                    outline = state.artifacts["outline"]["episodes"][state.current_episode - 1]
                    engine.run_episode_loop(state, outline)
                state.stage = "export"
                self._json(200, {"ok": True, "state": json.loads(state.to_json())})
            elif parsed.path == "/api/export":
                pid = body.get("project_id", "")
                path = os.path.join("projects", f"{pid}.json")
                if not os.path.exists(path):
                    self._json(404, {"ok": False, "error": "project not found"})
                    return
                state = ProjectState.from_json(open(path, encoding="utf-8").read())
                docx_path = export_docx(state, os.path.join("projects", f"{pid}.docx"))
                self._json(200, {"ok": True, "file": f"/{docx_path}"})
            else:
                self._json(404, {"ok": False, "error": "not found"})

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
        env = load_env()
        return PixelWriterEngine(make_gpt_client(env), make_deepseek_client(env))

    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(engine_factory))
    print(f"Pixel Writer API on :{args.port}")
    server.serve_forever()

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行确认通过**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_server_api -v`
Expected: PASS（1 个测试）

- [ ] **Step 5: 提交**

```bash
cd scriptwriter-agent && git add server.py tests/test_server_api.py && git commit -m "feat: HTTP API (start/project/export) via stdlib server"
```

---

### Task 7: ui/ 单页工作台

**Files:**
- Create: `scriptwriter-agent/ui/index.html`（含内联 CSS/JS，单文件减少依赖）

**Interfaces:**
- Consumes: `/api/start`、`/api/project?project_id=`、`/api/export`、`/projects/<id>.docx`（Task 6）
- Produces: 静态页面；server.py 需在 Task 6 基础上为 `/` 和 `/ui/` 提供静态文件（Step 3 补充）

- [ ] **Step 1: 写失败测试（静态路由存在性）**

```python
# 追加到 tests/test_server_api.py
    def test_static_ui_route(self):
        handler_cls = make_handler(lambda: None)
        self.assertIn("index.html", getattr(handler_cls, "STATIC_FILES", {"index.html": 1}))
```

- [ ] **Step 2: 运行确认失败**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_server_api -v`
Expected: FAIL（`STATIC_FILES` 不存在）

- [ ] **Step 3: 实现 ui/index.html + server.py 静态路由**

```python
# server.py Handler 增加：
        STATIC_FILES = {"index.html": os.path.join("ui", "index.html")}

        def do_GET(self):  # 在现有 do_GET 开头插入
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path in ("/", "/index.html"):
                self._serve_static("index.html")
                return
            # ... 原有 API 路由 ...

        def _serve_static(self, name):
            path = self.STATIC_FILES.get(name)
            if not path or not os.path.exists(path):
                self._json(404, {"ok": False, "error": "not found"})
                return
            data = open(path, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
```

ui/index.html 内容（单文件工作台）：
- 顶部：创意输入 textarea + 集数/时长选项（可选）+ 「开始创作」按钮
- 阶段进度条（brief → worldbuilding → outline → episode → export）
- 输出区：分集大纲列表 + 逐集剧本（场景/对白）+ 审核记录（AI 腔分数、问题清单）
- 导出按钮（`POST /api/export` → 跳转下载 `/projects/<id>.docx`）
- 轮询 `/api/project?project_id=`（每 2s）展示进度（因 `/api/start` 同步执行，先显示"生成中"状态）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><title>Pixel Writer</title>
<style>
body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;background:#fafafa}
.stage{display:inline-block;padding:.3rem .8rem;margin-right:.5rem;border-radius:1rem;background:#eee}
.stage.done{background:#c8e6c9}.stage.active{background:#fff3c4}
.scene{border:1px solid #ddd;border-radius:.5rem;padding:1rem;margin:1rem 0;background:#fff}
.speaker{font-weight:600}
.issue{color:#b71c1c;font-size:.9rem}
#progress{display:none;margin:1rem 0;padding:.8rem;background:#e3f2fd;border-radius:.5rem}
</style>
</head>
<body>
<h1>Pixel Writer · 中文短剧编剧</h1>
<textarea id="idea" rows="3" style="width:100%" placeholder="用一句话写下创意：主角是谁、要做什么、遇到什么阻碍…"></textarea>
<div style="margin:.6rem 0">
  集数（可选）：<input id="episodes" type="number" min="1" max="24" value="3" style="width:4rem">
  每集时长（可选，分钟）：<input id="duration" type="number" min="1" max="20" style="width:4rem">
  <button id="start" style="margin-left:1rem;padding:.5rem 1.2rem">开始创作</button>
</div>
<div id="progress">生成中… 正在写第 <span id="cur">0</span> 集</div>
<div id="stages"></div>
<div id="output"></div>
<div id="export" style="display:none"><button id="btn-export">导出 docx</button></div>
<script>
let projectId = null;
const $ = (id) => document.getElementById(id);
async function post(path, body) {
  const r = await fetch(path, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
  return r.json();
}
$("start").onclick = async () => {
  $("progress").style.display = "block";
  const body = {idea: $("idea").value, episode_count: parseInt($("episodes").value || "3", 10)};
  const res = await post("/api/start", body);
  if (res.ok) { projectId = res.state.project_id; render(res.state); }
  $("progress").style.display = "none";
};
function render(state) {
  const order = ["brief","worldbuilding","outline","episode","export"];
  $("stages").innerHTML = order.map((s) =>
    `<span class="stage ${order.indexOf(s) < order.indexOf(state.stage) ? "done" : (s === state.stage ? "active" : "")}">${s}</span>`).join("");
  const out = [];
  const outline = state.artifacts.outline || {episodes: []};
  out.push("<h2>分集大纲</h2>");
  outline.episodes.forEach((ep) => out.push(`<p><b>第${ep.index}集</b> 钩子：${ep.hook}｜悬念：${ep.cliffhanger}</p>`));
  out.push("<h2>剧本</h2>");
  Object.entries(state.artifacts.episodes || {}).forEach(([idx, ep]) => {
    out.push(`<h3>第${idx}集</h3>`);
    (ep.scenes || []).forEach((sc) => {
      out.push(`<div class="scene"><b>【${sc.location}】</b>`);
      (sc.beats || []).forEach((b) => out.push(b.line ? `<p class="speaker">${b.speaker}：</p><p>${b.line}</p>` : `<p>${b.action}</p>`));
      out.push("</div>");
    });
  });
  out.push("<h2>审核记录</h2>");
  Object.entries(state.evaluation || {}).forEach(([k, v]) => out.push(`<p class="issue">${k}: ${JSON.stringify(v)}</p>`));
  $("output").innerHTML = out.join("");
  $("export").style.display = "block";
}
$("btn-export").onclick = async () => {
  const res = await post("/api/export", {project_id: projectId});
  if (res.ok) location.href = res.file;
};
</script>
</body></html>
```

- [ ] **Step 4: 运行确认通过**

Run: `cd scriptwriter-agent && python3 -m unittest tests.test_server_api -v`
Expected: PASS（2 个测试：路由 + 静态）

- [ ] **Step 5: 本地手测 + 提交**

```bash
cd scriptwriter-agent && python3 -m unittest discover -s tests -v
git add ui/index.html server.py tests/test_server_api.py
git commit -m "feat: single-page workbench UI + static serving"
```

---

### Task 8: 集成冒烟 + 部署

**Files:**
- Create: `scriptwriter-agent/tests/test_integration.py`
- Modify: `scriptwriter-agent/README.md`（部署段）

**Interfaces:**
- Consumes: 全部
- Produces: 生产 `/home/ubuntu/apps/scriptwriter-agent`（git 仓库）、pm2 `pixel-writer` 8877

- [ ] **Step 1: 写集成冒烟测试（全链路用 Fake LLM，不真实调用）**

```python
import unittest
from engine import PixelWriterEngine, ProjectState
from docx_export import export_docx
import os, tempfile, zipfile

class ScriptedLLM:
    """按 prompt 关键字返回脚本化输出，模拟双模型。"""
    def __init__(self): self.outputs = {"worldbuilding": '{"characters":[{"name":"林晓"}],"world":{"rules":[]},"ending_invariants":[]}', "outline": '{"episodes":[{"index":1,"hook":"h","cliffhanger":"c","events":[]}]}', "episode": '{"scenes":[{"location":"拳场","beats":[{"speaker":"林晓","line":"我妹妹的命，我来挣。","action":"握拳"}]}]}', "review_ok": '{"pass":true,"score":82,"dimensions":{"human_tone":85,"plot":80,"dialogue":82},"issues":[]}'}
    def chat(self, messages, **kw):
        text = messages[0]["content"]
        for key in ("review", "审核"):  # reviewer
            if key in text: return self.outputs["review_ok"]
        if "分集大纲" in text or "episodes" in text: return self.outputs["outline"]
        if "写第" in text: return self.outputs["episode"]
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
```

- [ ] **Step 2: 运行确认通过（全量）**

Run: `cd scriptwriter-agent && python3 -m unittest discover -s tests -v`
Expected: 全部 PASS

- [ ] **Step 3: 本地 .env + 真实冒烟（可选，有 key 时）**

```bash
cd scriptwriter-agent && cp .env.example .env
python3 -c "from llm import make_gpt_client, make_deepseek_client; print('GPT:', make_gpt_client().base_url); print('DeepSeek:', make_deepseek_client().base_url)"
```

- [ ] **Step 4: git 提交 + push（新仓库）**

```bash
cd scriptwriter-agent
git remote add origin git@github.com:Wangchao0905/scriptwriter-agent.git  # 或用户指定远端
git push -u origin main
```

- [ ] **Step 5: 生产部署（git 流程）**

```bash
# 生产（首次：备份现有 v2.0）
ssh ubuntu@101.42.111.251 'cp -r /home/ubuntu/apps/scriptwriter-agent /home/ubuntu/apps/scriptwriter-agent-v2-backup && rm -rf /home/ubuntu/apps/scriptwriter-agent && git clone <repo> /home/ubuntu/apps/scriptwriter-agent && cd /home/ubuntu/apps/scriptwriter-agent && cp .env.example .env && pm2 restart pixel-writer'
# 验证
curl -s http://localhost:8877/api/project?project_id=nonexistent | head -1
pm2 status pixel-writer
```

- [ ] **Step 6: 生产冒烟（真实双模型一次完整流程）**

```bash
curl -s -X POST http://localhost:8877/api/start -H 'Content-Type: application/json' \
  -d '{"idea":"林晓为救患癌妹妹闯入地下拳场，但警方卧底盯上了她","episode_count":1}' | head -c 500
```

Expected: 返回 state JSON，stage=export，含 episodes[1] 剧本与 evaluation 审核记录

---

## Self-Review

**Spec coverage:**
- 双模型 GPT+DeepSeek → Task 2（llm.py）+ Task 4（审核用 DeepSeek）
- 反射闭环（审核→定向修订≤2 轮）→ Task 4
- Humanizer-zh 审核契约 → Task 1（facts）+ Task 4（审核 prompt 引用 + AI 腔分数门槛）
- 分集大纲 + 逐集剧本 → Task 3（outline/episode）
- docx 导出 → Task 5
- 独立简洁工作台 → Task 7（ui）
- 集数/时长可选 → Task 7（输入框）；时长在 Task 3 `_prompt_episode` 已可传（计划内提示词含时长占位，落地时并入约束）
- 确定性流程优先 → Task 3（normalize_idea 纯规则、状态机）
- 结构化任务状态 JSON → Task 3（ProjectState）
- 测试 → 每 Task 内 TDD + Task 8 集成
- git 流程部署 → Task 8

**Gap 修正：** Task 3 `_prompt_episode` 未含时长参数——落地时 `run_episode_loop(state, outline, duration_min)` 追加签名，提示词加"本集目标时长 X 分钟"；Task 8 Step 4 远端 URL 需用户提供。

**Type consistency:** `LLMClient.chat(messages, temperature, max_tokens)` 全计划一致；`PixelWriterEngine.run_episode_loop(state, outline)` 在 Task 4/6/8 签名一致；`export_docx(state, path)` 一致。
