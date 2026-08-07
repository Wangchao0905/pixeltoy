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
        wb = self._parse_json_block(content)
        if not isinstance(wb, dict):
            raise ValueError("模型输出不是合法 JSON，已重试仍失败")
        state.artifacts["worldbuilding"] = wb
        state.stage = "outline"
        self._save(state)
        return state

    def run_outline(self, state, episode_count):
        prompt = self._prompt_outline(state, episode_count)
        # 30+ 集的大纲一次输出会超出固定 4000；按集数放大输出预算（每集约 200 tokens，封顶 12000）。
        content = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=max(4_000, min(12_000, episode_count * 200)))
        outline = self._parse_json_block(content)
        if not isinstance(outline, dict):
            raise ValueError("模型输出不是合法 JSON，已重试仍失败")
        self._normalize_outline(outline, episode_count)
        state.artifacts["outline"] = outline
        state.stage = "episode"
        state.current_episode = 1
        self._save(state)
        return state

    @staticmethod
    def _normalize_outline(outline, episode_count):
        """规范化分集大纲：按模型输出顺序取前 episode_count 集，每集 index 重写为 1..N，
        与 current_episode 推进保持一致；缺失 hook/cliffhanger 给空串兜底。
        模型输出集数不足时截断并标注 truncated，流水线据此停止生成剩余集而非越界。"""
        raw = outline.get("episodes")
        if not isinstance(raw, list) or not raw:
            raise ValueError("模型未生成有效的分集大纲")
        episodes = [dict(e) for e in raw[:episode_count]]
        for i, ep in enumerate(episodes):
            ep["index"] = i + 1
            ep.setdefault("hook", "")
            ep.setdefault("cliffhanger", "")
            ep.setdefault("events", [])
        outline["episodes"] = episodes
        if len(raw) < episode_count:
            outline["truncated"] = True
            outline["note"] = f"模型仅输出 {len(raw)} 集，不足 {episode_count} 集，已停止生成剩余集"

    def generate_episode(self, state):
        idx = state.current_episode
        outline = state.artifacts["outline"]["episodes"][idx - 1]
        prompt = self._prompt_episode(state, outline)
        content = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000)
        episode = self._parse_json_block(content)
        if not isinstance(episode, dict):
            raise ValueError("模型输出不是合法 JSON，已重试仍失败")
        state.artifacts.setdefault("episodes", {})[str(idx)] = episode
        state.current_episode = idx + 1
        self._save(state)
        return state

    def review_episode(self, state, episode):
        """DeepSeek 审核单集，返回审核契约 dict（Humanizer-zh 门槛：human_tone<70 必须 pass=false）。"""
        humanizer = self.facts["humanizer-zh.md"]
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        prompt = f"""你是短剧审核编辑。对照【设定事实】【Humanizer-zh 中文 AI 腔清单】审核本集。
设定：{wb[:800]}
本集：{json.dumps(episode, ensure_ascii=False)[:2000]}
AI 腔清单：{humanizer[:1200] if humanizer else '中文 AI 腔 21 模式'}

输出 JSON：{{"pass":bool,"score":0-100,"dimensions":{{"human_tone":0-100,"plot":0-100,"dialogue":0-100}},"issues":[{{"severity":"high|medium","mode":1-21,"quote":"原文","fix":"改写建议"}}]}}
规则：AI 腔分数<70 必须 pass=false；情节断裂/对白与设定冲突必须 high issue。"""
        content = self.reviewer.chat([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=2000)
        verdict = self._parse_json_block(content)
        if not isinstance(verdict, dict):
            return None
        # 强制门：pass 必须严格为布尔 True 才视为通过（字符串 "false" 不再 truthy）
        verdict["pass"] = verdict.get("pass") is True
        # 代码级 Humanizer-zh 门槛：human_tone < 70 强制不通过，不依赖 prompt 软约束；
        # 分数为字符串（如 "40"）时也强制比较，缺失/非法按不达标处理（保守方向）
        dims = verdict.get("dimensions")
        if isinstance(dims, dict):
            human_tone = dims.get("human_tone")
            try:
                low_tone = float(human_tone) < 70
            except (TypeError, ValueError):
                low_tone = True
            if low_tone:
                verdict["pass"] = False
        return verdict

    def revise_episode(self, state, episode, issues):
        """GPT 按审核问题清单定向修订本集，只改问题涉及处，保持其余不变。"""
        prompt = f"""按问题清单定向修订本集，只改问题涉及处，保持其余不变。输出与原结构相同的 JSON 剧本。
问题清单：{json.dumps(issues, ensure_ascii=False)}
本集：{json.dumps(episode, ensure_ascii=False)}"""
        content = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000)
        return self._parse_json_block(content)

    def run_episode_loop(self, state, outline):
        """单集生成 + 审核修订闭环：最多 MAX_REVISION_ROUNDS 轮修订，超限置 needs-human 不阻塞后续集。

        verdict 同时记录到 state.evaluation[str(index)]，供导出/UI 展示审核记录。
        """
        rounds = 0
        prompt = self._prompt_episode(state, outline)
        episode = self._parse_json_block(self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000))
        idx = outline.get("index", state.current_episode)
        verdict = None
        status = "needs-human"
        if not isinstance(episode, dict):
            # 初稿不是合法 JSON：不阻塞流水线，记 needs-human 交人工处理
            state.evaluation[str(idx)] = {"pass": False, "score": 0, "dimensions": {},
                                          "issues": [{"severity": "high", "mode": 0, "quote": "", "fix": "模型输出非法 JSON"}]}
            state.artifacts.setdefault("episodes", {})[str(idx)] = None
            state.current_episode = max(state.current_episode, idx + 1)
            self._save(state)
            return {"status": status, "episode": None, "verdict": None, "rounds": 0}
        while rounds <= MAX_REVISION_ROUNDS:
            verdict = self.review_episode(state, episode)
            state.evaluation[str(idx)] = verdict  # 审核记录落盘，便于 Task 5 附录/UI 展示
            if verdict is None:
                # 审核输出无法解析：视为未通过；已到最后轮则 needs-human，否则尝试修订
                if rounds >= MAX_REVISION_ROUNDS:
                    status = "needs-human"
                    break
                revised = self.revise_episode(state, episode, [])
                if not isinstance(revised, dict):
                    status = "needs-human"
                    break
                episode = revised
                rounds += 1
                continue
            if verdict.get("pass"):
                status = "approved"
                break
            if rounds >= MAX_REVISION_ROUNDS:
                status = "needs-human"
                break
            revised = self.revise_episode(state, episode, verdict.get("issues", []))
            if not isinstance(revised, dict):
                status = "needs-human"
                break
            episode = revised
            rounds += 1
        state.artifacts.setdefault("episodes", {})[str(idx)] = episode
        state.current_episode = max(state.current_episode, idx + 1)
        self._save(state)
        return {"status": status, "episode": episode, "verdict": verdict, "rounds": rounds}

    # --- 提示词构造（确定性模板，模型只负责内容）---
    def _prompt_worldbuilding(self, state):
        i = state.idea
        duration_note = f"每集目标时长约 {i['episode_duration_seconds']} 秒。" if i.get("episode_duration_seconds") else ""
        return f"""你是中文短剧编剧。基于创意生成世界设定，输出 JSON：
{{"characters":[{{"name":"","persona":"","motivation":""}}],
 "world":{{"rules":[],"tone":""}},
 "ending_invariants":[]}}
创意：{i['raw']}
约束：人物动机必须可解释；结局不变量必须明确。{duration_note}"""

    def _prompt_outline(self, state, episode_count):
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        duration_note = f"每集目标时长约 {state.idea['episode_duration_seconds']} 秒，事件量必须匹配该时长。" if state.idea.get("episode_duration_seconds") else ""
        return f"""基于设定生成 {episode_count} 集分集大纲，输出 JSON：
{{"episodes":[{{"index":1,"hook":"","cliffhanger":"","events":[]}}]}}
要求：每集以钩子开头、以悬念收尾，事件链因果衔接。
{duration_note}
设定：{wb}"""

    def _prompt_episode(self, state, outline):
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        contract = self.facts["文风契约.md"]
        duration_note = f"本集目标时长约 {state.idea['episode_duration_seconds']} 秒；场景数、动作节拍和对白量必须匹配该时长。" if state.idea.get("episode_duration_seconds") else ""
        return f"""写第 {outline['index']} 集剧本，输出 JSON：
{{"scenes":[{{"location":"","beats":[{{"speaker":"","line":"","action":""}}]}}]}}
事件：{json.dumps(outline, ensure_ascii=False)}
设定：{wb}
{duration_note}
对白契约：{contract[:500] if contract else '口语化、短句、有潜台词'}"""

    @staticmethod
    def _parse_json_block(text):
        """从模型输出提取首个 JSON 对象（容忍 markdown 代码围栏与前后杂讯）。

        无 `{` 起点、JSON 非法或首个对象不是 dict 时返回 None，由调用方决定兜底
        （抛 ValueError 或按 needs-human 处理），绝不切片崩溃。
        """
        if not isinstance(text, str):
            return None
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-z]*\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        start = text.find("{")
        if start == -1:
            return None
        # 从每个 `{` 起点 raw_decode，取首个完整闭合的 JSON 对象（容忍多块/尾随文本）
        decoder = json.JSONDecoder()
        pos = start
        while pos != -1:
            try:
                obj, _ = decoder.raw_decode(text, pos)
                return obj if isinstance(obj, dict) else None
            except json.JSONDecodeError:
                pos = text.find("{", pos + 1)
        return None
