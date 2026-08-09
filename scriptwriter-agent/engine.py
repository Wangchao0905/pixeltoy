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
    def __init__(self, writer, reviewer, state_dir="projects", reviewer_b=None):
        self.writer = writer        # LLMClient（GPT，主笔 + 首轮修订）
        self.reviewer = reviewer    # LLMClient（DeepSeek，审核席 A）
        self.reviewer_b = reviewer_b  # LLMClient（Gemini，审核席 B 独立复核 + 第二轮修订，可 None）
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
        # 代码级强制剧情中文化：动作/场景描述必须中文（对白按设定语言），
        # 不依赖模型自觉——生成后自动检测并转换英文 action/location。
        self._localize_episode(episode)
        state.artifacts.setdefault("episodes", {})[str(idx)] = episode
        state.current_episode = idx + 1
        self._save(state)
        return state

    def _continuity_ledger(self, state, idx):
        """确定性跨集状态簿：写第 idx 集时，汇总前 1..idx-1 集的实际内容与待兑现悬念。

        用于：
        1) 前情提要（上集结尾对白 + 上集悬念）
        2) 跨集状态（角色/地点最后出现集——角色状态延续与伏笔回收的依据）
        3) 待兑现悬念（分集大纲中本集及以后的 cliffhanger，引导伏笔推进）
        """
        episodes = state.artifacts.get("episodes", {}) or {}
        chars = {}
        locations = {}
        for i in range(1, idx):
            ep = episodes.get(str(i))
            if not isinstance(ep, dict):
                continue
            for scene in ep.get("scenes", []) or []:
                loc = scene.get("location")
                if loc:
                    locations[loc] = max(locations.get(loc, 0), i)
                for beat in scene.get("beats", []) or []:
                    sp = beat.get("speaker")
                    if sp:
                        chars[sp] = max(chars.get(sp, 0), i)
        outline_eps = state.artifacts.get("outline", {}).get("episodes", []) or []
        open_hooks = [
            f"第{e.get('index')}集悬念（待兑现）：{e.get('cliffhanger', '')}"
            for e in outline_eps
            if e.get("index") and int(e["index"]) >= idx and e.get("cliffhanger")
        ]
        prev = episodes.get(str(idx - 1))
        prev_end = []
        if isinstance(prev, dict):
            scenes = prev.get("scenes", []) or []
            for beat in (scenes[-1].get("beats", []) if scenes else [])[:4]:
                if beat.get("line"):
                    prev_end.append(f"{beat.get('speaker', '')}：{beat['line']}")
        return {
            "characters": chars,
            "locations": locations,
            "open_hooks": open_hooks,
            "previous_episode_end": prev_end,
            "previous_cliffhanger": next(
                (e.get("cliffhanger", "") for e in outline_eps if e.get("index") == idx - 1), ""
            ),
        }

    def review_episode(self, state, episode):
        """单审核 + 争议仲裁：DeepSeek 正常审核；仅当未通过时 Gemini 复核一次。

        仲裁规则（极简）：
        - DeepSeek 通过 → 直接用（不调 Gemini，省一半调用）。
        - DeepSeek 未通过 → Gemini 独立复核：
          · Gemini 也认为未通过 → 合并两份问题清单，一次修订解决两边。
          · Gemini 认为通过（分歧=可能误判）→ 放行，除非存在代码级硬门槛
            （时长超标 issue 的 mode==0，或 Gemini 自身维度未过代码级门槛）。
        - 任一席调用异常（网关 401/超时）→ 降级用另一席结果，绝不导致整集失败。
        """
        try:
            verdict_a = self._review_once(self.reviewer, state, episode)
        except Exception:
            verdict_a = None
        if verdict_a is None:
            if self.reviewer_b:
                try:
                    return self._review_once(self.reviewer_b, state, episode)
                except Exception:
                    return None
            return None
        if verdict_a.get("pass"):
            return verdict_a  # 通过：不调用仲裁席
        if not self.reviewer_b:
            return verdict_a  # 无仲裁席：维持 DeepSeek 判定
        try:
            verdict_b = self._review_once(self.reviewer_b, state, episode)
        except Exception:
            verdict_b = None
        if verdict_b is None:
            return verdict_a  # 仲裁失败：维持 DeepSeek 判定
        if verdict_b.get("pass"):
            # 分歧：Gemini 认为没问题 → 放行，除非有不可仲裁的硬门槛
            a_hard = [i for i in verdict_a.get("issues", []) if i.get("mode") == 0]
            dims_ok = self._dims_pass(verdict_b)
            target = state.idea.get("episode_duration_seconds") if isinstance(state.idea, dict) else None
            dur_ok, _ = self._duration_check(episode, target)
            if not a_hard and dims_ok and dur_ok:
                return verdict_b  # 采纳仲裁（Gemini 判定通过）
        # 一致未通过：合并去重问题清单（一次修订解决两边）
        merged_issues = list(verdict_a.get("issues", []))
        for i in verdict_b.get("issues", []):
            if i not in merged_issues:
                merged_issues.append(i)
        verdict_a["issues"] = merged_issues[:12]
        verdict_a["pass"] = False
        verdict_a["score"] = min(verdict_a.get("score", 0) or 0, verdict_b.get("score", 0) or 0)
        return verdict_a

    @staticmethod
    def _dims_pass(verdict):
        """代码级维度门槛（与 _review_once 一致）：hook<60、human_tone<70 判定不通过。"""
        dims = verdict.get("dimensions")
        if not isinstance(dims, dict):
            return True  # 无维度数据不追加否决（仲裁侧宽松）
        for dim, strict in (("human_tone", True), ("hook", True)):
            try:
                low = float(dims.get(dim)) < (60 if dim == "hook" else 70)
            except (TypeError, ValueError):
                low = strict
            if low:
                return False
        return True

    def _duration_check(self, episode, duration_seconds):
        """零模型时长估算：对白≈4字/秒、动作节拍≈3秒、场景切换≈2秒。
        返回 (ok, est_seconds)：目标 60%-140% 区间内为合规。"""
        if not duration_seconds:
            return True, None
        est = 0.0
        for scene in episode.get("scenes", []) or []:
            est += 2.0
            for beat in scene.get("beats", []) or []:
                est += max(1.0, len(beat.get("line", "") or "") / 4.0)
                if beat.get("action"):
                    est += 3.0
        lo, hi = duration_seconds * 0.6, duration_seconds * 1.4
        return lo <= est <= hi, est

    def _review_once(self, client, state, episode):
        """单个审核器的完整审核（prompt + 解析重试 + 代码级强制门）。

        多维度：human_tone（Humanizer-zh 去 AI 腔）、hook（开场钩/集尾悬念/反转强度）、
        plot、dialogue、continuity（与前集衔接 / 角色状态延续 / 悬念推进）。
        human_tone<70、continuity<70 或 hook<60 必须 pass=false（代码级门槛）。
        """
        humanizer = self.facts["humanizer-zh.md"]
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        idx = state.current_episode if state.current_episode else 1
        cont = self._continuity_ledger(state, idx)
        prev_part = "\n".join(cont["previous_episode_end"]) if cont["previous_episode_end"] else "（首集，无前集）"
        prev_hook = cont["previous_cliffhanger"]
        ledger_part = (
            f"角色最后出现集：{json.dumps(cont['characters'], ensure_ascii=False)}；"
            f"地点：{json.dumps(cont['locations'], ensure_ascii=False)}"
        )
        hooks_part = "\n".join(cont["open_hooks"]) if cont["open_hooks"] else "（无待兑现悬念）"
        # 代码级规则检测：设定冲突 + 结构模板校验（确定性，不依赖模型自觉）
        setting_conflicts = self._check_setting_conflicts(state, episode, idx)
        structure_notes = self._validate_episode_structure(episode, state.idea.get("episode_duration_seconds") if isinstance(state.idea, dict) else None)
        conflict_part = "\n".join(setting_conflicts) if setting_conflicts else "（无）"
        structure_part = "\n".join(structure_notes) if structure_notes else "（结构达标）"
        dialogue_lang = state.idea.get("dialogue_language") or "zh"
        if dialogue_lang == "en":
            dialogue_check = (
                "dialogue 维度额外检查：只有对白（line）应为符合英语母语者语境与表达方式的自然英文"
                "（无中文式英语、俚语/省略符合人物身份与文化语境、不翻译腔）；"
                "存在明显翻译腔或中式英语必须 high issue。"
                "动作（action）与场景（location）应使用中文，若写成英文视为剧情描述语言错误，需 high issue。"
            )
            ai_check = "对白按英文自然度审核（human_tone 指英文表达的自然度，不套用中文 AI 腔规则）"
        else:
            dialogue_check = "对白需口语化、短句、有潜台词、符合人物声线。"
            ai_check = "对照【Humanizer-zh 中文 AI 腔清单】检查中文表达"
        prompt = f"""你是短剧审核编辑。对照【设定事实】【前情提要】【跨集状态】【规则检测】【结构校验】审核本集。
{dialogue_check}
{ai_check}
hook 维度：评估开场钩子（首句/前三秒是否暴击或异常）、集尾悬念（cliffhanger 是否制造追更欲）、反转强度（如有反转是否够狠且逻辑成立）。短剧留存完全依赖钩子，hook<60 必须 pass=false。
设定：{wb[:800]}
前情提要（上集结尾，本集开头必须承接）：{prev_part[:400]}
上集悬念：{prev_hook[:200] if prev_hook else "（无）"}
跨集状态：{ledger_part[:400]}
待兑现悬念：{hooks_part[:400]}
【规则冲突检测（代码级，必须逐条处理，确认属实后给 high issue 并写 fix）】{conflict_part}
【结构模板校验（代码级）】{structure_part}
本集：{json.dumps(episode, ensure_ascii=False)[:2000]}
AI 腔清单：{humanizer[:1200] if humanizer else '中文 AI 腔 21 模式'}

输出 JSON：{{"pass":bool,"score":0-100,"dimensions":{{"human_tone":0-100,"hook":0-100,"plot":0-100,"dialogue":0-100,"continuity":0-100}},"issues":[{{"severity":"high|medium","mode":1-21,"quote":"原文","fix":"改写建议"}}]}}
规则：AI 腔分数<70 必须 pass=false；hook<60（开场无钩/集尾无悬念/无反转且平淡）必须 pass=false；continuity<70（本集开头未衔接上集结尾/角色状态矛盾/悬念未推进）必须 pass=false；情节断裂/对白与设定冲突必须 high issue。"""
        content = client.chat([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=4000)
        verdict = self._parse_json_block(content)
        if not isinstance(verdict, dict):
            # 审核输出无法解析（hook/规则冲突/结构校验使 prompt 与输出变长，
            # 2000 token 预算下 DeepSeek 易截断）→ 重试一次，仍失败返回 None
            content = client.chat([{"role": "user", "content": prompt}], temperature=0.2, max_tokens=4000)
            verdict = self._parse_json_block(content)
        if not isinstance(verdict, dict):
            return None
        # 强制门：pass 必须严格为布尔 True 才视为通过（字符串 "false" 不再 truthy）
        verdict["pass"] = verdict.get("pass") is True
        # 代码级多维度门槛：human_tone<70、continuity<70、hook<60 强制不通过，不依赖 prompt 软约束。
        # human_tone/hook 缺失/非法按不达标（保守否决）；continuity 缺失按宽松处理（兼容旧审核输出/旧数据）。
        dims = verdict.get("dimensions")
        if isinstance(dims, dict):
            for dim, strict in (("human_tone", True), ("hook", True), ("continuity", False)):
                try:
                    low = float(dims.get(dim)) < (60 if dim == "hook" else 70)
                except (TypeError, ValueError):
                    low = strict
                if low:
                    verdict["pass"] = False
        # 时长硬门槛（代码级）：估算时长超出目标 60%-140% 区间 → 强制不通过。
        target = state.idea.get("episode_duration_seconds") if isinstance(state.idea, dict) else None
        ok_dur, est = self._duration_check(episode, target)
        if not ok_dur:
            verdict["pass"] = False
            issues = verdict.setdefault("issues", [])
            issue = {
                "severity": "high", "mode": 0, "quote": "",
                "fix": (f"估算时长约 {int(est)} 秒，超出目标 {target} 秒的 60%-140% 区间。"
                        f"需精简（删减节拍/缩短对白）或补足内容，使单集时长贴合目标。"),
            }
            if issue not in issues:
                issues.append(issue)
        return verdict

    def revise_episode(self, state, episode, issues, round_no=0):
        """按审核问题清单定向修订本集，只改问题涉及处，保持其余不变。

        round_no 保留兼容（统一由主笔 GPT 修订，不做模型轮换——简化流程）。
        """
        client = self.writer
        dialogue_lang = state.idea.get("dialogue_language") or "zh"
        lang_note = "对白保持英文，并按英语母语者的语境与表达方式修订（不得改为中文，不得翻译腔）。" if dialogue_lang == "en" else "对白保持中文口语化风格。"
        prompt = f"""按问题清单定向修订本集，只改问题涉及处，保持其余不变。输出与原结构相同的 JSON 剧本。
{lang_note}
铁律：未被问题清单点名的场景、节拍、对白、动作一律一字不改（包括 speaker/line/action/location 的顺序与措辞）；
只允许：① 修改清单中 quote 命中的原文；② 为结构类问题（节拍不足/时长过短/缺 hook/cliffhanger）增补或精简内容。
问题清单：{json.dumps(issues, ensure_ascii=False)}
本集：{json.dumps(episode, ensure_ascii=False)}"""
        content = client.chat([{"role": "user", "content": prompt}], max_tokens=4000)
        return self._parse_json_block(content)

    @staticmethod
    def _revision_respects_scope(original, revised, issues):
        """修订后 diff 检查：未被问题清单点名（quote 命中）的 scene/beat 必须逐字不变。

        结构类问题（quote 为空、fix 含“节拍/时长/结构/hook/cliffhanger”）放行结构调整；
        其余段落若被模型顺手改动（重写未点名对白/动作/场景），判定修订越界。
        """
        if not isinstance(revised, dict):
            return False
        quoted = {str(issue.get("quote", "")).strip() for issue in (issues or []) if isinstance(issue, dict) and issue.get("quote")}
        structural = any(
            not str(issue.get("quote", "")).strip()
            and any(k in str(issue.get("fix", "")) for k in ("节拍", "时长", "结构", "hook", "cliffhanger"))
            for issue in (issues or []) if isinstance(issue, dict)
        )
        orig_scenes = original.get("scenes", []) or []
        rev_scenes = revised.get("scenes", []) or []
        if structural:
            # 结构类修订允许增删节拍，但仍不允许改动未点名段落的措辞
            for o in orig_scenes:
                for ob in o.get("beats", []) or []:
                    found = False
                    for r in rev_scenes:
                        for rb in r.get("beats", []) or []:
                            if rb.get("speaker") == ob.get("speaker") and rb.get("line") == ob.get("line"):
                                found = True
                                break
                        if found:
                            break
                    if not found and ob.get("line", "").strip() not in quoted:
                        return False
            return True
        if len(orig_scenes) != len(rev_scenes):
            return False
        for si, (o, r) in enumerate(zip(orig_scenes, rev_scenes)):
            ov = o.get("location", "")
            if ov != r.get("location", "") and ov.strip() not in quoted:
                return False
            ob, rb = o.get("beats", []) or [], r.get("beats", []) or []
            if len(ob) != len(rb):
                return False
            for bi, (ob_, rb_) in enumerate(zip(ob, rb)):
                for field in ("speaker", "line", "action"):
                    val = ob_.get(field, "")
                    if val != rb_.get(field, "") and val.strip() not in quoted:
                        return False
        return True

    @staticmethod
    def _merge_revision(original, revised, issues):
        """修订越界合并：未被点名的段落恢复原文措辞，被点名（quote 命中）的段落
        采用修订版。结构无法逐位对齐（场景/节拍数变化且非结构类问题）返回 None，
        由调用方交人工处理。"""
        if not isinstance(revised, dict):
            return None
        quoted = {str(issue.get("quote", "")).strip() for issue in (issues or []) if isinstance(issue, dict) and issue.get("quote")}
        structural = any(
            not str(issue.get("quote", "")).strip()
            and any(k in str(issue.get("fix", "")) for k in ("节拍", "时长", "结构", "hook", "cliffhanger"))
            for issue in (issues or []) if isinstance(issue, dict)
        )
        orig_scenes = original.get("scenes", []) or []
        rev_scenes = revised.get("scenes", []) or []
        if structural:
            # 结构类问题允许修订版结构调整：直接采用修订版（diff 检查已保证未点名对白保留）
            return json.loads(json.dumps(revised))
        if len(orig_scenes) != len(rev_scenes):
            return None
        merged = json.loads(json.dumps(original))
        for si, (os_, rs) in enumerate(zip(orig_scenes, rev_scenes)):
            ov = os_.get("location", "")
            if ov != rs.get("location", "") and ov.strip() in quoted:
                merged["scenes"][si]["location"] = rs.get("location", "")
            ob, rb = os_.get("beats", []) or [], rs.get("beats", []) or []
            if len(ob) != len(rb):
                return None
            for bi, (ob_, rb_) in enumerate(zip(ob, rb)):
                for field in ("speaker", "line", "action"):
                    val = ob_.get(field, "")
                    if val != rb_.get(field, "") and val.strip() in quoted:
                        merged["scenes"][si]["beats"][bi][field] = rb_.get(field, "")
        return merged

    def run_episode_loop(self, state, outline):
        """单集生成 + 审核修订闭环：最多 MAX_REVISION_ROUNDS 轮修订，超限置 needs-human 不阻塞后续集。

        verdict 同时记录到 state.evaluation[str(index)]，供导出/UI 展示审核记录。
        """
        rounds = 0
        prompt = self._prompt_episode(state, outline)
        episode = None
        raw_output = ""
        # 初稿非 JSON 时重试 2 次：第二集起 prompt 更长（前情+跨集状态+悬念），
        # 模型可能在 max_tokens 截断处输出不完整 JSON——重试通常能成功。
        for attempt in range(3):
            raw_output = self.writer.chat([{"role": "user", "content": prompt}], max_tokens=4000)
            episode = self._parse_json_block(raw_output)
            if isinstance(episode, dict):
                break
        idx = outline.get("index", state.current_episode)
        verdict = None
        status = "needs-human"
        if not isinstance(episode, dict):
            # 初稿重试 3 次仍不是合法 JSON：不阻塞流水线，记 needs-human 交人工处理
            state.evaluation[str(idx)] = {"pass": False, "score": 0, "dimensions": {},
                                          "issues": [{"severity": "high", "mode": 0, "quote": str(raw_output)[:200], "fix": "模型输出非法 JSON，已重试 3 次"}]}
            state.artifacts.setdefault("episodes", {})[str(idx)] = None
            state.current_episode = max(state.current_episode, idx + 1)
            self._save(state)
            return {"status": status, "episode": None, "verdict": None, "rounds": 0}
        # 生成后立即时长自检：超限先自动精简/补足，避免"生成长集→审核否决"的无效往返。
        target = state.idea.get("episode_duration_seconds") if isinstance(state.idea, dict) else None
        if target:
            ok_dur, est = self._duration_check(episode, target)
            if not ok_dur:
                direction = "压缩（删减冗余节拍/缩短对白），只保留核心冲突与钩子" if est > target else "补足内容（增加节拍/充实对白）"
                duration_issue = {"severity": "high", "mode": 0, "quote": "",
                                  "fix": (f"估算时长约 {int(est)} 秒，目标 {target} 秒，需{direction}，"
                                          f"使估算时长落在 {int(target*0.6)}-{int(target*1.4)} 秒区间。"
                                          f"这是本次修订唯一要解决的问题，其余内容一律不改。")}
                revised = self.revise_episode(state, episode, [duration_issue], round_no=rounds)
                if isinstance(revised, dict):
                    if self._revision_respects_scope(episode, revised, [duration_issue]):
                        merged = revised
                    else:
                        # 结构类修订（时长精简必然删旧对白/节拍）：merge 直接采用修订版
                        merged = self._merge_revision(episode, revised, [duration_issue])
                    if merged is not None:
                        episode = merged
                # 修订后仍超限：继续进审核，审核同样会否决并给出精简建议（可人工"修复此条"）
        while rounds <= MAX_REVISION_ROUNDS:
            verdict = self.review_episode(state, episode)
            if verdict is None:
                # 审核输出无法解析：写结构化失败记录（避免 evaluation 落 null，
                # UI 显示"待处理"而非可读的失败原因），并尝试修订后复审
                state.evaluation[str(idx)] = {"pass": False, "score": 0, "dimensions": {},
                                              "issues": [{"severity": "high", "mode": 0, "quote": "", "fix": "审核输出无法解析，已重试仍失败"}]}
            else:
                state.evaluation[str(idx)] = verdict  # 审核记录落盘，便于 Task 5 附录/UI 展示
            if verdict is None:
                # 审核输出无法解析：视为未通过；已到最后轮则 needs-human，否则尝试修订
                if rounds >= MAX_REVISION_ROUNDS:
                    status = "needs-human"
                    break
                revised = self.revise_episode(state, episode, [], round_no=rounds)
                if not isinstance(revised, dict) or not self._revision_respects_scope(episode, revised, []):
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
            revised = self.revise_episode(state, episode, verdict.get("issues", []), round_no=rounds)
            if not isinstance(revised, dict):
                status = "needs-human"
                break
            # diff 约束：未被点名段落被模型顺手改写 → 合并回滚（未点名处恢复原文，
            # 点名处用修订版），继续进入下一轮审核——不再直接交人工（初稿修订常需
            # 顺滑衔接，全量拒绝会造成死循环）。merge 失败才交人工。
            if not self._revision_respects_scope(episode, revised, verdict.get("issues", [])):
                merged = self._merge_revision(episode, revised, verdict.get("issues", []))
                if merged is None:
                    status = "needs-human"
                    state.evaluation[str(idx)] = {"pass": False, "score": 0, "dimensions": {},
                                                  "issues": [{"severity": "high", "mode": 0, "quote": "", "fix": "修订越界且无法合并，已交人工处理"}]}
                    break
                revised = merged
            episode = revised
            rounds += 1
        state.artifacts.setdefault("episodes", {})[str(idx)] = episode
        state.current_episode = max(state.current_episode, idx + 1)
        self._save(state)
        return {"status": status, "episode": episode, "verdict": verdict, "rounds": rounds}

    @staticmethod
    def _has_cjk(text):
        return any("\u4e00" <= ch <= "\u9fff" for ch in (text or ""))

    def _localize_episode(self, episode):
        """把单集剧本的动作/场景描述转为中文（对白 line 不动）。
        供生成后自动强制与"剧情中文化"共用：英文对白模式下，
        动作/场景描述保持中文是代码级约束，不依赖模型自觉。"""
        if not episode or not isinstance(episode, dict):
            return 0
        scenes = episode.get("scenes") or []
        pending = []
        for si, scene in enumerate(scenes):
            loc = scene.get("location", "")
            if loc and not self._has_cjk(loc):
                pending.append({"key": f"loc:{si}", "text": loc})
            for bi, beat in enumerate(scene.get("beats") or []):
                action = beat.get("action", "")
                if action and not self._has_cjk(action):
                    pending.append({"key": f"act:{si}:{bi}", "text": action})
        if not pending:
            return 0
        try:
            result = self.writer.chat([
                {"role": "system", "content": "你是中文短剧编剧。把每条 text（英文动作描述或场景地点）翻译成自然、简洁的中文短剧描述：动作以'他/她'开头的短句，地点用中文场所名。不要照抄占位内容，必须把每条 text 完整翻译成中文填进 zh。只输出 JSON：{\"items\":[{\"key\":\"...\",\"zh\":\"翻译结果\"}]}"},
                {"role": "user", "content": json.dumps(pending, ensure_ascii=False)},
            ], temperature=0.3, max_tokens=2000)
            parsed = self._parse_json_block(result)
            items = parsed.get("items", []) if isinstance(parsed, dict) else []
        except Exception:
            return 0
        mapping = {item.get("key", ""): item.get("zh", "") for item in items if item.get("key") and item.get("zh")}
        converted = 0
        for si, scene in enumerate(scenes):
            loc_zh = mapping.get(f"loc:{si}")
            if loc_zh:
                scene["location"] = loc_zh
                converted += 1
            for bi, beat in enumerate(scene.get("beats") or []):
                act_zh = mapping.get(f"act:{si}:{bi}")
                if act_zh and beat.get("action"):
                    beat["action"] = act_zh
                    converted += 1
        return converted

    def localize_actions(self, state):
        """把已生成集的 action/location 转为中文（对白 line 不动）。
        供"剧情中文化"使用：英文对白模式下，动作/场景描述保持中文。"""
        episodes = state.artifacts.get("episodes", {})
        converted = 0
        for ep in episodes.values():
            converted += self._localize_episode(ep)
        self._save(state)
        return converted

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

    def _structure_template(self, seconds):
        """按时长区间返回单集结构模板（借鉴时长分层设计：30-60s 快节奏单冲突，
        90-120s 双转折；长剧另有三幕由 PixTale 侧承载）。"""
        if not seconds:
            return "每集：开场即冲突，快节奏推进，结尾留钩子。"
        if seconds <= 45:
            return (
                "单集结构模板（45 秒内快节奏）：开场即冲突 → 一次小转折 → 危机升级 → 钩子收尾；"
                "建议 2-3 个场景、4-5 个动作/对白节拍，对白短促直给。"
            )
        if seconds <= 75:
            return (
                "单集结构模板（60 秒双节拍）：冲突建立 → 升级 → 意外发现 → 代价逼近 → 钩子收尾；"
                "建议 3-4 个场景、5-7 个节拍，对白含潜台词。"
            )
        return (
            "单集结构模板（90-120 秒双转折）：冲突建立 → 小胜利 → 反转 → 危机 → 被迫选择 → 钩子收尾；"
            "建议 4-6 个场景、7-10 个节拍，允许一段关系或细节刻画。"
        )

    def _prompt_outline(self, state, episode_count):
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        duration_note = self._structure_template(state.idea.get("episode_duration_seconds"))
        return f"""基于设定生成 {episode_count} 集分集大纲，输出 JSON：
{{"episodes":[{{"index":1,"hook":"","cliffhanger":"","events":[]}}]}}
要求：每集以钩子开头、以悬念收尾，事件链因果衔接。
{duration_note}
设定：{wb}"""

    def _prompt_episode(self, state, outline):
        wb = json.dumps(state.artifacts.get("worldbuilding", {}), ensure_ascii=False)
        contract = self.facts["文风契约.md"]
        idx = outline["index"]
        cont = self._continuity_ledger(state, idx)
        prev_part = (
            f"\n前情提要（第 {idx - 1} 集结尾，本集开头必须承接）：\n"
            + "\n".join(cont["previous_episode_end"])
            + (f"\n上集悬念：{cont['previous_cliffhanger']}" if cont["previous_cliffhanger"] else "")
            if idx > 1
            else "\n（首集：开场即立人物与冲突）"
        )
        ledger_part = f"\n跨集状态：角色最后出现集 {json.dumps(cont['characters'], ensure_ascii=False)}；地点 {json.dumps(cont['locations'], ensure_ascii=False)}"
        hooks_part = (
            "\n待兑现悬念（本集及以后必须兑现或推进）：\n" + "\n".join(cont["open_hooks"])
            if cont["open_hooks"]
            else ""
        )
        duration_note = (f"本集目标时长约 {state.idea['episode_duration_seconds']} 秒。"
                         if state.idea.get("episode_duration_seconds") else "")
        if state.idea.get("episode_duration_seconds"):
            target = state.idea["episode_duration_seconds"]
            # 节拍预算：对白≈4字/秒、动作节拍≈3秒/个、场景切换≈2秒/个
            beat_budget = max(4, int((target * 0.9) / 5))
            line_budget = int(target * 4 * 0.75)
            duration_note += (
                f"时长预算（必须遵守，代码级审核）：按估算模型（对白 4 字/秒、动作节拍 3 秒、场景切换 2 秒），"
                f"全集估算时长必须落在 {int(target*0.6)}-{int(target*1.4)} 秒区间。"
                f"参考预算：约 {beat_budget} 个节拍、对白总量约 {line_budget} 字——超出上限会被审核直接否决，需精简；不足则需补足内容。"
            )
        duration_note += self._structure_template(state.idea.get("episode_duration_seconds"))
        dialogue_lang = state.idea.get("dialogue_language") or "zh"
        if dialogue_lang == "en":
            dialogue_rule = (
                "对白语言：只有对白（line 字段）使用英文，并按英语母语者的语境与表达方式进行本土化设计——"
                "使用自然口语化的英语（俚语、省略、情绪化用语、真实对话节奏），贴合人物身份与场景文化语境，"
                "不得直译中文思路、不得出现中文式英语；潜台词按英语表达习惯呈现，语气词按英文习惯（如 well/come on/you know 等，仅在自然处使用）。"
                "场景位置（location）、动作描述（action）及一切剧情描述一律使用中文，不得因对白为英文而写成英文。"
            )
        else:
            dialogue_rule = f"对白语言：中文。对白契约：{contract[:500] if contract else '口语化、短句、有潜台词'}"
        return f"""写第 {idx} 集剧本，输出 JSON：
{{"hook":"","cliffhanger":"","scenes":[{{"location":"","beats":[{{"speaker":"","line":"","action":""}}]}}]}}
事件：{json.dumps(outline, ensure_ascii=False)}
设定：{wb}
{prev_part}
{ledger_part}
{hooks_part}
{duration_note}
{dialogue_rule}
要求：本集开头衔接上集结尾；角色状态/地点延续跨集状态；按待兑现悬念推进伏笔，不提前草草了结。
hook 字段写开场钩子（前三秒的暴击/异常/悬念，1 句）；cliffhanger 字段写集尾追更钩（1 句，为下集留悬念）。"""

    def _check_setting_conflicts(self, state, episode, idx):
        """跨集设定冲突规则检测（零模型，确定性）。

        1) 角色注册：beats 的 speaker 必须已注册（worldbuilding.characters 或前集出现过），
           未注册的新人物会被标记——新人必须是有意引入（后续可人工确认）。
        2) 世界规则否定词：world_rules 含“禁止/不能/无法”等否定规则时，若本集正文直接出现
           规则对象关键词，标记为疑似违背。
        返回问题清单（str 列表），由审核注入处理。
        """
        problems = []
        wb = state.artifacts.get("worldbuilding", {}) or {}
        known = {c.get("name", "") for c in wb.get("characters", []) or [] if isinstance(c, dict)}
        for i in range(1, idx):
            ep = (state.artifacts.get("episodes", {}) or {}).get(str(i))
            if not ep or not isinstance(ep, dict):
                continue
            for scene in ep.get("scenes", []) or []:
                for beat in scene.get("beats", []) or []:
                    if beat.get("speaker"):
                        known.add(beat["speaker"])
        spoken = {beat.get("speaker") for scene in episode.get("scenes", []) or [] for beat in scene.get("beats", []) or [] if beat.get("speaker")}
        for name in spoken:
            if name and name not in known and "旁白" not in name:
                problems.append(f"角色「{name}」未在设定与前期剧本注册（新人物需在人物设定补充说明）。")
        body_text = json.dumps(episode, ensure_ascii=False)
        for rule in wb.get("world_rules", []) or []:
            if not isinstance(rule, str):
                continue
            for neg in ("禁止", "不能", "无法", "永远不会", "绝对不"):
                if neg in rule:
                    subject = rule.split(neg)[0].strip()[-12:]
                    if subject and subject in body_text:
                        problems.append(f"世界规则「{rule[:40]}」疑似被本集违背（检测到关键对象「{subject}」）。")
                    break
        return problems

    def _validate_episode_structure(self, episode, duration_seconds):
        """产出后结构模板校验（确定性，零模型）。

        节拍数下限（单薄检测）、估算时长区间（对白≈4字/秒、动作≈3秒、场景切换≈2秒）、
        hook/cliffhanger 字段是否齐全。开场钩强度与集尾悬念质量由审核 hook 维度评判。
        """
        problems = []
        scenes = episode.get("scenes", []) or []
        total_beats = 0
        est_seconds = 0.0
        for scene in scenes:
            est_seconds += 2.0
            for beat in scene.get("beats", []) or []:
                total_beats += 1
                est_seconds += max(1.0, len(beat.get("line", "") or "") / 4.0)
                if beat.get("action"):
                    est_seconds += 3.0
        if total_beats < 4:
            problems.append(f"全集仅 {total_beats} 个节拍，结构单薄（短剧单集至少 4-6 个节拍）。")
        if duration_seconds:
            lo, hi = duration_seconds * 0.6, duration_seconds * 1.4
            if est_seconds < lo:
                problems.append(f"估算时长约 {int(est_seconds)} 秒，明显短于目标 {duration_seconds} 秒（内容不足）。")
            elif est_seconds > hi:
                problems.append(f"估算时长约 {int(est_seconds)} 秒，超出目标 {duration_seconds} 秒（需精简或拆集）。")
        if not (episode.get("hook") or "").strip():
            problems.append("缺少 hook 字段：前三秒必须有暴击/异常/悬念。")
        if not (episode.get("cliffhanger") or "").strip():
            problems.append("缺少 cliffhanger 字段：集尾必须留下追更钩子。")
        return problems

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
