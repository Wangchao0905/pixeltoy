const SESSION_STORAGE_KEY = "pixeltale.story-forge-session";
const PENDING_MODE_KEY = "pixeltale.story-forge-pending-mode";
const PENDING_NOTICE_KEY = "pixeltale.story-forge-pending-notice";

function createSessionId() {
  const querySession = typeof location !== "undefined" ? new URLSearchParams(location.search).get("session") : "";
  if (/^[A-Za-z0-9_-]{16,128}$/.test(querySession || "")) {
    try { localStorage.setItem(SESSION_STORAGE_KEY, querySession); } catch { /* memory-only session */ }
    return querySession;
  }
  const existing = (() => {
    try { return localStorage.getItem(SESSION_STORAGE_KEY) || ""; } catch { return ""; }
  })();
  if (/^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  const generated = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(SESSION_STORAGE_KEY, generated); } catch { /* memory-only session */ }
  return generated;
}

const sessionId = createSessionId();
const ACTIVE_RUN_KEY = `pixeltale.story-forge-active-run:${sessionId}`;
const SESSION_SNAPSHOT_KEY = `pixeltale.story-forge-snapshot:${sessionId}`;

function loadActiveRun() {
  try {
    const value = JSON.parse(sessionStorage.getItem(ACTIVE_RUN_KEY) || "null");
    return value?.jobId && value?.stage ? value : null;
  } catch {
    return null;
  }
}

function persistActiveRun(run) {
  state.activeRun = run;
  try {
    if (run) sessionStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(run));
    else sessionStorage.removeItem(ACTIVE_RUN_KEY);
  } catch {
    // The in-memory state is enough for the current page when storage is unavailable.
  }
}

let backgroundRunMonitor = "";

function pendingMode() {
  try {
    const mode = sessionStorage.getItem(PENDING_MODE_KEY);
    sessionStorage.removeItem(PENDING_MODE_KEY);
    return mode === "long" ? "long" : "tk";
  } catch {
    return "tk";
  }
}

function consumePendingNewNotice() {
  try {
    const notice = sessionStorage.getItem(PENDING_NOTICE_KEY) || "";
    if (notice) sessionStorage.removeItem(PENDING_NOTICE_KEY);
    return notice;
  } catch {
    return "";
  }
}

function createEmptyAgent(mode = "tk") {
  return {
    mode: mode === "long" ? "long_form_drama" : mode === "cn" ? "cn_short_drama" : "tk_short_drama",
    stage: "brief",
    artifacts: [],
    approvedArtifactIds: [],
    input: {},
    routes: {},
    modelOptions: [],
  };
}

const initialMode = pendingMode();
const state = {
  mode: initialMode,
  stage: "brief",
  approved: new Set(),
  busy: false,
  revising: false,
  documentBusy: false,
  toastTimer: null,
  lastError: "",
  documentError: "",
  activeRun: loadActiveRun(),
  runPhase: "",
  dnaFilter: "all",
  impactChoices: {},
  pendingHumanOverride: "",
  pendingRerun: null,
  pendingCrossStageRepair: null,
  historyDeletePending: null,
  agent: createEmptyAgent(initialMode),
  routes: { orchestration: "gpt-5.6-terra", continuity: "gemini-3.1-pro", hooks: "deepseek-v4-pro", dialogueReview: "claude-sonnet-5", consistency: "gpt-5.6-luna" },
  input: {
    platform: "TikTok / TikTok Series",
    audience: "18-34 · English-speaking audience",
    audienceGender: "all",
    episodeScale: "24 episodes",
    duration: "60-90 sec",
    episodeCount: 24,
    durationValue: 60,
    durationUnit: "sec",
    openingImpactSeconds: 3,
    openingPromise: "mainline_promise",
    hookCadence: "every_episode",
    dialogueMode: "localized_english",
    handoffScope: "confirmed_versioned",
    marketRegion: "north_america",
    marketCountry: "united_states",
    localizationNote: "",
    stageOptions: {},
    stageGuidance: {},
    storyTitle: "",
    idea: "",
  },
};

function persistSessionSnapshot() {
  try {
    sessionStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify({
      agent: state.agent,
      stage: state.stage,
      input: state.input,
      routes: state.routes,
      approvedArtifactIds: [...state.approved],
    }));
  } catch {
    // 当前页面仍可继续使用，下一次刷新将由服务端状态恢复。
  }
}

function restoreSessionSnapshot() {
  try {
    const snapshot = JSON.parse(sessionStorage.getItem(SESSION_SNAPSHOT_KEY) || "null");
    if (!snapshot?.agent || typeof snapshot.agent !== "object") return false;
    updateAgentState(snapshot.agent);
    if (stageOrder.includes(snapshot.stage)) state.stage = snapshot.stage;
    state.input = { ...state.input, ...(snapshot.input || {}) };
    state.routes = { ...state.routes, ...(snapshot.routes || {}) };
    state.approved = new Set(snapshot.approvedArtifactIds || state.agent.approvedArtifactIds || []);
    return true;
  } catch {
    return false;
  }
}

const modelMeta = {
  "gpt-5.6-terra": { name: "GPT 5.6 Terra", provider: "chatgpt", role: "总编排 / 结构", detail: "任务拆解、结构约束与最终复核" },
  "gpt-5.6-sol": { name: "GPT 5.6 Sol", provider: "chatgpt", role: "总编排 / 结构", detail: "任务拆解、结构约束与最终复核" },
  "gpt-5.6-luna": { name: "GPT 5.6 Luna", provider: "chatgpt", role: "总编排 / 结构", detail: "任务拆解、结构约束与最终复核" },
  "claude-opus-5": { name: "Claude Opus 5", provider: "claude", role: "故事圣经 / 连续性", detail: "人物、世界规则、长剧弧线与伏笔连续性" },
  "claude-sonnet-5": { name: "Claude Sonnet 5", provider: "claude", role: "故事圣经 / 连续性", detail: "人物、世界规则、长剧弧线与伏笔连续性" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", provider: "claude", role: "故事圣经 / 连续性", detail: "人物、世界规则、长剧弧线与伏笔连续性" },
  "deepseek-v4-pro": { name: "DeepSeek V4 Pro", provider: "deepseek", role: "TK 钩子 / 受众对抗", detail: "开头暴击、反转、探索欲与目标受众追更动力" },
  "gemini-3.1-pro": { name: "Gemini 3.1 Pro", provider: "gemini", role: "故事圣经 / 连续性", detail: "人物、世界规则、长剧弧线与伏笔连续性" },
};

const stageOrder = ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue", "handoff"];
const productionStageTotal = stageOrder.length - 1;
const UNIT_STAGES = new Set(["arc", "scenes"]);
const FAST_REVIEW_STAGES = new Set(["brief", "proposal", "characters", "dialogue"]);

function requiredReviewSeatsFor(stage = state.stage, reviewContent = {}, artifact = null) {
  const stored = Number(reviewContent?.reviewPolicy?.requiredSeats);
  if (stored === 1 || stored === 2) return stored;
  return FAST_REVIEW_STAGES.has(stage) && !artifact?.revision ? 1 : 2;
}

// 2026-08-10 用户规则：不管哪个阶段，评分必须达标才能进入下一步。
// 达标 = 综合 quality ≥ 75 且所有已评分维度 ≥ 75（未评分维度不算拦截）。
function scoresMeetGate(reviewContent = {}) {
  const quality = Number(reviewContent.quality);
  if (!Number.isFinite(quality) || quality < 90) return false;
  const dims = reviewContent.dimensions || {};
  return Object.values(dims).every((entry) => {
    const value = Number(entry && typeof entry === "object" ? entry.average : entry);
    return !Number.isFinite(value) || value >= 75;
  });
}

function reviewModeLabelFor(stage = state.stage, reviewContent = {}, artifact = null) {
  return requiredReviewSeatsFor(stage, reviewContent, artifact) === 1 ? "单席快速审读" : "双席审读";
}

function reviewOpinionLabelFor(stage = state.stage, reviewContent = {}, artifact = null) {
  return requiredReviewSeatsFor(stage, reviewContent, artifact) === 1 ? "单席审读意见" : "双席审读意见";
}

function productionStepNumber(stage = workflowStage()) {
  return Math.min(productionStageTotal, Math.max(1, stageIndex(stage) + 1));
}

function productionProgressLabel(stage = workflowStage()) {
  return `${String(productionStepNumber(stage)).padStart(2, "0")} / ${String(productionStageTotal).padStart(2, "0")}`;
}

const stageMeta = {
  brief: { kicker: "01 / BRIEF", title: "故事架构", task: "建立故事架构", copy: "确认平台、受众和单集节奏，先建立可执行的故事架构。" },
  title: { kicker: "02 / TITLE", title: "选择剧名", task: "确定故事的第一张名片", copy: "根据剧本 DNA、目标市场和发行属性生成 4 个英文正式片名，中文释义仅供创作者参考。" },
  proposal: { kicker: "03 / PROPOSAL", title: "故事提案", task: "给出可追更的核心命题", copy: "检查冲突、人物欲望和每集继续观看的理由。" },
  characters: { kicker: "04 / CHARACTERS", title: "人物与世界", task: "锁定人物关系和世界规则", copy: "让角色的选择推动剧情，而不是让设定替角色行动。" },
  arc: { kicker: "05 / ARC", title: "分集与章节", task: "把主线拆成可拍的推进", copy: "短剧优先检查钩子与反转，长剧优先检查因果与人物弧线。" },
  scenes: { kicker: "06 / SCENES", title: "场景与镜头", task: "把剧情变成可执行的镜头意图", copy: "确认人物、场景、道具和镜头目的，为视觉资产输出建立依据。" },
  dialogue: { kicker: "07 / DIALOGUE", title: "对白本土化", task: "把对白说得像人物会说的话", copy: "中文保留剧情意图，英文对白根据人物、场景和受众口语化改写。" },
  handoff: { kicker: "08 / EXPORT", title: "导出正式文件", task: "生成可交付的剧本资产", copy: "正式剧本 DOCX 读取已确认的分集剧情、场景镜头和英文对白，并与视觉资产文档分别导出。" },
};
const marketCatalog = [
  ["north_america", "united_states", "美国"], ["north_america", "canada", "加拿大"],
  ["europe", "united_kingdom", "英国"], ["europe", "germany", "德国"], ["europe", "france", "法国"],
  ["latin_america", "mexico", "墨西哥"], ["latin_america", "brazil", "巴西"],
  ["east_asia", "japan", "日本"], ["east_asia", "south_korea", "韩国"], ["east_asia", "CN", "中国大陆"],
  ["southeast_asia", "indonesia", "印度尼西亚"], ["southeast_asia", "philippines", "菲律宾"], ["southeast_asia", "thailand", "泰国"],
  ["mena", "saudi_arabia", "沙特阿拉伯"], ["mena", "united_arab_emirates", "阿联酋"],
];
const marketRegionLabels = {
  north_america: "北美", europe: "欧洲", latin_america: "拉丁美洲", east_asia: "东亚", southeast_asia: "东南亚", mena: "中东及北非",
};
const legacyInspirationPool = [
  { keyword: "身份悬疑", kind: "题材", source: "Netflix", x: 10, y: 18, r: -8, duration: 51, delay: -12 },
  { keyword: "末日生存", kind: "题材", source: "Netflix", x: 34, y: 9, r: 4, duration: 64, delay: -30 },
  { keyword: "家族权斗", kind: "题材", source: "HBO", x: 64, y: 15, r: 8, duration: 58, delay: -7 },
  { keyword: "青春暗黑", kind: "题材", source: "HBO", x: 86, y: 25, r: -5, duration: 73, delay: -42 },
  { keyword: "高概念谜案", kind: "题材", source: "Netflix", x: 16, y: 31, r: -4, duration: 57, delay: -18 },
  { keyword: "神秘小镇", kind: "题材", source: "Netflix", x: 51, y: 24, r: 6, duration: 70, delay: -46 },
  { keyword: "罪案追踪", kind: "题材", source: "Sony TV", x: 74, y: 36, r: -6, duration: 63, delay: -27 },
  { keyword: "超自然", kind: "题材", source: "HBO", x: 23, y: 53, r: 3, duration: 75, delay: -59 },
  { keyword: "反杀翻盘", kind: "爽点", source: "Netflix", x: 12, y: 46, r: 6, duration: 67, delay: -21 },
  { keyword: "真相揭露", kind: "爽点", source: "HBO", x: 36, y: 34, r: -3, duration: 47, delay: -9 },
  { keyword: "越级打脸", kind: "爽点", source: "Sony TV", x: 67, y: 40, r: 7, duration: 62, delay: -37 },
  { keyword: "禁忌拉扯", kind: "爽点", source: "HBO", x: 86, y: 53, r: -7, duration: 55, delay: -18 },
  { keyword: "复仇清算", kind: "爽点", source: "Sony TV", x: 49, y: 49, r: -5, duration: 59, delay: -34 },
  { keyword: "阶层逆袭", kind: "爽点", source: "Netflix", x: 76, y: 64, r: 4, duration: 72, delay: -63 },
  { keyword: "秘密曝光", kind: "爽点", source: "HBO", x: 9, y: 66, r: -7, duration: 52, delay: -11 },
  { keyword: "情感失控", kind: "爽点", source: "Netflix", x: 55, y: 63, r: 7, duration: 68, delay: -51 },
  { keyword: "一眼设定", kind: "爆火基因", source: "Netflix", x: 5, y: 75, r: -4, duration: 71, delay: -55 },
  { keyword: "角色上头", kind: "爆火基因", source: "HBO", x: 28, y: 63, r: 5, duration: 49, delay: -28 },
  { keyword: "视觉记忆", kind: "爆火基因", source: "Netflix", x: 60, y: 72, r: -6, duration: 76, delay: -14 },
  { keyword: "社交梗点", kind: "爆火基因", source: "Sony TV", x: 82, y: 81, r: 3, duration: 60, delay: -48 },
  { keyword: "CP上头", kind: "爆火基因", source: "Netflix", x: 40, y: 20, r: -6, duration: 61, delay: -72 },
  { keyword: "反差人设", kind: "爆火基因", source: "HBO", x: 93, y: 43, r: 5, duration: 74, delay: -39 },
  { keyword: "名场面", kind: "爆火基因", source: "Sony TV", x: 8, y: 87, r: -3, duration: 54, delay: -22 },
  { keyword: "世界观钩子", kind: "爆火基因", source: "Netflix", x: 64, y: 92, r: 6, duration: 77, delay: -58 },
  { keyword: "倒计时", kind: "叙事逻辑", source: "Netflix", x: 20, y: 92, r: -2, duration: 69, delay: -32 },
  { keyword: "线索递进", kind: "叙事逻辑", source: "Sony TV", x: 44, y: 86, r: 6, duration: 53, delay: -4 },
  { keyword: "误导再翻", kind: "叙事逻辑", source: "HBO", x: 72, y: 91, r: -7, duration: 63, delay: -24 },
  { keyword: "代价升级", kind: "叙事逻辑", source: "HBO", x: 94, y: 69, r: 5, duration: 78, delay: -61 },
  { keyword: "双线并进", kind: "叙事逻辑", source: "Netflix", x: 35, y: 76, r: -5, duration: 66, delay: -16 },
  { keyword: "悬念续燃", kind: "叙事逻辑", source: "Sony TV", x: 90, y: 94, r: 4, duration: 73, delay: -44 },
  { keyword: "信息错位", kind: "叙事逻辑", source: "HBO", x: 17, y: 42, r: 7, duration: 56, delay: -67 },
  { keyword: "终局回收", kind: "叙事逻辑", source: "Netflix", x: 48, y: 96, r: -6, duration: 79, delay: -31 },
  { keyword: "职场权谋", kind: "题材", source: "HBO", x: 8, y: 5, r: -4, duration: 82, delay: -19 },
  { keyword: "法律惊案", kind: "题材", source: "Sony TV", x: 31, y: 7, r: 3, duration: 74, delay: -41 },
  { keyword: "科技惊悚", kind: "题材", source: "Netflix", x: 55, y: 5, r: -2, duration: 88, delay: -64 },
  { keyword: "宫廷复仇", kind: "题材", source: "HBO", x: 78, y: 8, r: 4, duration: 76, delay: -26 },
  { keyword: "都市爱情", kind: "题材", source: "Sony TV", x: 93, y: 17, r: -3, duration: 83, delay: -56 },
  { keyword: "历史秘闻", kind: "题材", source: "Netflix", x: 47, y: 30, r: 5, duration: 71, delay: -35 },
  { keyword: "绝地翻盘", kind: "爽点", source: "Netflix", x: 7, y: 37, r: 4, duration: 85, delay: -23 },
  { keyword: "身份曝光", kind: "爽点", source: "HBO", x: 29, y: 45, r: -4, duration: 72, delay: -47 },
  { keyword: "权力反噬", kind: "爽点", source: "Sony TV", x: 70, y: 28, r: 3, duration: 81, delay: -15 },
  { keyword: "旧爱重逢", kind: "爽点", source: "Netflix", x: 94, y: 35, r: -5, duration: 77, delay: -52 },
  { keyword: "逆风破局", kind: "爽点", source: "HBO", x: 31, y: 58, r: 5, duration: 89, delay: -31 },
  { keyword: "致命交易", kind: "爽点", source: "Sony TV", x: 71, y: 51, r: -3, duration: 73, delay: -62 },
  { keyword: "情绪共鸣", kind: "爆火基因", source: "Netflix", x: 11, y: 59, r: -4, duration: 84, delay: -28 },
  { keyword: "反转名场", kind: "爆火基因", source: "HBO", x: 40, y: 38, r: 4, duration: 78, delay: -43 },
  { keyword: "设定代入", kind: "爆火基因", source: "Sony TV", x: 61, y: 59, r: -5, duration: 86, delay: -12 },
  { keyword: "反派魅力", kind: "爆火基因", source: "Netflix", x: 91, y: 61, r: 3, duration: 75, delay: -48 },
  { keyword: "金句传播", kind: "爆火基因", source: "HBO", x: 10, y: 79, r: 5, duration: 90, delay: -38 },
  { keyword: "追更惯性", kind: "爆火基因", source: "Netflix", x: 53, y: 80, r: -3, duration: 79, delay: -57 },
  { keyword: "伏笔回收", kind: "叙事逻辑", source: "HBO", x: 28, y: 69, r: 4, duration: 87, delay: -21 },
  { keyword: "多线交汇", kind: "叙事逻辑", source: "Sony TV", x: 73, y: 76, r: -4, duration: 76, delay: -45 },
  { keyword: "视角反转", kind: "叙事逻辑", source: "Netflix", x: 92, y: 87, r: 3, duration: 82, delay: -29 },
  { keyword: "秘密递交", kind: "叙事逻辑", source: "HBO", x: 36, y: 93, r: -5, duration: 91, delay: -55 },
  { keyword: "关系重组", kind: "叙事逻辑", source: "Sony TV", x: 61, y: 96, r: 4, duration: 74, delay: -16 },
  { keyword: "真相代价", kind: "叙事逻辑", source: "Netflix", x: 79, y: 96, r: -3, duration: 88, delay: -66 },
  { keyword: "失势继承人", kind: "主角身份", source: "角色原型", x: 18, y: 14, r: 3, duration: 77, delay: -34 },
  { keyword: "隐姓天才", kind: "主角身份", source: "角色原型", x: 80, y: 19, r: -4, duration: 84, delay: -59 },
  { keyword: "单亲母亲", kind: "主角身份", source: "角色原型", x: 11, y: 50, r: 5, duration: 72, delay: -20 },
  { keyword: "复仇新娘", kind: "主角身份", source: "角色原型", x: 90, y: 48, r: -3, duration: 89, delay: -49 },
  { keyword: "破产千金", kind: "主角身份", source: "角色原型", x: 21, y: 84, r: 4, duration: 80, delay: -27 },
  { keyword: "失忆警探", kind: "主角身份", source: "角色原型", x: 44, y: 70, r: -5, duration: 86, delay: -61 },
  { keyword: "卧底律师", kind: "主角身份", source: "角色原型", x: 67, y: 86, r: 3, duration: 75, delay: -18 },
  { keyword: "叛逃公主", kind: "主角身份", source: "角色原型", x: 95, y: 72, r: -4, duration: 92, delay: -53 },
];

const inspirationPool = [
  { keyword: "身份谜案", kind: "题材", source: "Netflix" }, { keyword: "密室权斗", kind: "题材", source: "HBO" },
  { keyword: "末日倒计时", kind: "题材", source: "Netflix" }, { keyword: "禁忌关系", kind: "题材", source: "HBO" },
  { keyword: "家族暗战", kind: "题材", source: "Sony Pictures TV" }, { keyword: "科技失控", kind: "题材", source: "Netflix" },
  { keyword: "罪案追踪", kind: "题材", source: "Sony Pictures TV" }, { keyword: "神秘小镇", kind: "题材", source: "Netflix" },
  { keyword: "法律惊案", kind: "题材", source: "Sony Pictures TV" }, { keyword: "职场博弈", kind: "题材", source: "HBO" },
  { keyword: "超自然信号", kind: "题材", source: "Netflix" }, { keyword: "继承争夺", kind: "题材", source: "HBO" },
  { keyword: "反杀翻盘", kind: "爽点", source: "Netflix" }, { keyword: "身份揭露", kind: "爽点", source: "HBO" },
  { keyword: "越级反击", kind: "爽点", source: "Sony Pictures TV" }, { keyword: "权力反噬", kind: "爽点", source: "HBO" },
  { keyword: "复仇清算", kind: "爽点", source: "Sony Pictures TV" }, { keyword: "旧爱重逢", kind: "爽点", source: "Netflix" },
  { keyword: "禁忌拉扯", kind: "爽点", source: "HBO" }, { keyword: "代价升级", kind: "爽点", source: "Netflix" },
  { keyword: "关系倒戈", kind: "爽点", source: "HBO" }, { keyword: "真相反转", kind: "爽点", source: "Netflix" },
  { keyword: "致命交易", kind: "爽点", source: "Sony Pictures TV" }, { keyword: "绝地破局", kind: "爽点", source: "Netflix" },
  { keyword: "一眼设定", kind: "爆火基因", source: "Netflix" }, { keyword: "反差主角", kind: "爆火基因", source: "HBO" },
  { keyword: "视觉符号", kind: "爆火基因", source: "Netflix" }, { keyword: "名场面", kind: "爆火基因", source: "Sony Pictures TV" },
  { keyword: "CP张力", kind: "爆火基因", source: "Netflix" }, { keyword: "金句传播", kind: "爆火基因", source: "HBO" },
  { keyword: "反派魅力", kind: "爆火基因", source: "Netflix" }, { keyword: "社交梗点", kind: "爆火基因", source: "Sony Pictures TV" },
  { keyword: "情绪共振", kind: "爆火基因", source: "HBO" }, { keyword: "世界观钩子", kind: "爆火基因", source: "Netflix" },
  { keyword: "开场暴击", kind: "叙事逻辑", source: "TK DNA" }, { keyword: "集尾悬问", kind: "叙事逻辑", source: "TK DNA" },
  { keyword: "线索递进", kind: "叙事逻辑", source: "Netflix" }, { keyword: "信息错位", kind: "叙事逻辑", source: "HBO" },
  { keyword: "误导再翻", kind: "叙事逻辑", source: "Netflix" }, { keyword: "双线并进", kind: "叙事逻辑", source: "Sony Pictures TV" },
  { keyword: "倒计时", kind: "叙事逻辑", source: "Netflix" }, { keyword: "伏笔回收", kind: "叙事逻辑", source: "HBO" },
  { keyword: "视角反转", kind: "叙事逻辑", source: "Netflix" }, { keyword: "关系重组", kind: "叙事逻辑", source: "Sony Pictures TV" },
  { keyword: "失忆警探", kind: "主角身份", source: "角色原型" }, { keyword: "隐姓天才", kind: "主角身份", source: "角色原型" },
  { keyword: "叛逃公主", kind: "主角身份", source: "角色原型" }, { keyword: "破产继承人", kind: "主角身份", source: "角色原型" },
  { keyword: "卧底律师", kind: "主角身份", source: "角色原型" }, { keyword: "单亲母亲", kind: "主角身份", source: "角色原型" },
  { keyword: "复仇新娘", kind: "主角身份", source: "角色原型" }, { keyword: "伪装医生", kind: "主角身份", source: "角色原型" },
  { keyword: "失势继承人", kind: "主角身份", source: "角色原型" }, { keyword: "被追凶者", kind: "主角身份", source: "角色原型" },
  { keyword: "冷面调查员", kind: "主角身份", source: "角色原型" }, { keyword: "反派继承人", kind: "主角身份", source: "角色原型" },
  { keyword: "先婚后爱", kind: "情绪关系", source: "国内短剧" }, { keyword: "破镜重圆", kind: "情绪关系", source: "国内短剧" },
  { keyword: "契约关系", kind: "情绪关系", source: "海外短剧" }, { keyword: "隐秘暧昧", kind: "情绪关系", source: "海外短剧" },
  { keyword: "宿命纠缠", kind: "情绪关系", source: "影视母题" }, { keyword: "亲情救赎", kind: "情绪关系", source: "国内短剧" },
  { keyword: "师徒羁绊", kind: "情绪关系", source: "影视母题" }, { keyword: "友情背叛", kind: "情绪关系", source: "海外短剧" },
  { keyword: "身份错位", kind: "冲突机制", source: "国内短剧" }, { keyword: "先抑后扬", kind: "冲突机制", source: "短剧结构" },
  { keyword: "危机倒逼", kind: "冲突机制", source: "短剧结构" }, { keyword: "公开审判", kind: "冲突机制", source: "海外短剧" },
  { keyword: "资源争夺", kind: "冲突机制", source: "影视母题" }, { keyword: "时间循环", kind: "冲突机制", source: "类型钩子" },
  { keyword: "困局突围", kind: "冲突机制", source: "短剧结构" }, { keyword: "证据博弈", kind: "冲突机制", source: "罪案类型" },
  { keyword: "豪门名利场", kind: "世界设定", source: "国内短剧" }, { keyword: "乡村逆袭", kind: "世界设定", source: "国内短剧" },
  { keyword: "娱乐圈生存", kind: "世界设定", source: "国内短剧" }, { keyword: "职场高压", kind: "世界设定", source: "海外短剧" },
  { keyword: "古风权谋", kind: "世界设定", source: "国内短剧" }, { keyword: "赛博都市", kind: "世界设定", source: "海外短剧" },
  { keyword: "末世封锁", kind: "世界设定", source: "类型设定" }, { keyword: "校园规则", kind: "世界设定", source: "海外短剧" },
  { keyword: "霓虹夜色", kind: "视觉风格", source: "视觉参考" }, { keyword: "冷白悬疑", kind: "视觉风格", source: "视觉参考" },
  { keyword: "高饱和甜感", kind: "视觉风格", source: "视觉参考" }, { keyword: "复古胶片", kind: "视觉风格", source: "影视美学" },
  { keyword: "东方极简", kind: "视觉风格", source: "影视美学" }, { keyword: "都市奢华", kind: "视觉风格", source: "视觉参考" },
  { keyword: "暗黑童话", kind: "视觉风格", source: "影视美学" }, { keyword: "纪实手持", kind: "视觉风格", source: "影视语法" },
  { keyword: "先秦乱世", kind: "时代", source: "历史语境" }, { keyword: "大唐盛世", kind: "时代", source: "历史语境" },
  { keyword: "民国旧上海", kind: "时代", source: "历史语境" }, { keyword: "抗战年代", kind: "时代", source: "历史语境" },
  { keyword: "改革开放", kind: "时代", source: "现实语境" }, { keyword: "千禧年代", kind: "时代", source: "怀旧语境" },
  { keyword: "当代都市", kind: "时代", source: "现实语境" }, { keyword: "近未来社会", kind: "时代", source: "类型设定" },
  { keyword: "末日之后", kind: "时代", source: "类型设定" }, { keyword: "赛博未来", kind: "时代", source: "类型设定" },
];

const dnaAudienceRecommendations = {
  male: new Set(["密室权斗", "末日倒计时", "科技失控", "罪案追踪", "法律惊案", "职场博弈", "反杀翻盘", "越级反击", "权力反噬", "致命交易", "一眼设定", "视觉符号", "反派魅力", "世界观钩子", "线索递进", "信息错位", "双线并进", "倒计时", "失忆警探", "隐姓天才", "卧底律师", "公开审判", "资源争夺", "证据博弈", "赛博都市", "末世封锁", "冷白悬疑", "霓虹夜色", "纪实手持", "先秦乱世", "抗战年代", "近未来社会", "末日之后", "赛博未来"]),
  female: new Set(["身份谜案", "禁忌关系", "家族暗战", "神秘小镇", "继承争夺", "身份揭露", "复仇清算", "旧爱重逢", "禁忌拉扯", "关系倒戈", "CP张力", "金句传播", "情绪共振", "集尾悬问", "误导再翻", "视角反转", "关系重组", "叛逃公主", "单亲母亲", "复仇新娘", "破产继承人", "先婚后爱", "破镜重圆", "契约关系", "隐秘暧昧", "亲情救赎", "豪门名利场", "娱乐圈生存", "高饱和甜感", "都市奢华", "大唐盛世", "民国旧上海", "千禧年代", "当代都市", "近未来社会"]),
};

const audienceDnaRecommendations = {
  male: new Set([
    "末日生存", "高概念谜案", "罪案追踪", "职场权谋", "科技惊悚", "法律惊案",
    "反杀翻盘", "越级打脸", "权力反噬", "绝地翻盘", "逆风破局", "致命交易",
    "一眼设定", "视觉记忆", "世界观钩子", "反派魅力", "设定代入",
    "倒计时", "线索递进", "双线并进", "信息错位", "伏笔回收", "多线交汇",
    "隐姓天才", "失忆警探", "卧底律师",
  ]),
  female: new Set([
    "身份悬疑", "家族权斗", "青春暗黑", "都市爱情", "宫廷复仇", "神秘小镇",
    "真相揭露", "禁忌拉扯", "复仇清算", "身份曝光", "旧爱重逢", "情感失控",
    "角色上头", "CP上头", "社交梗点", "反差人设", "情绪共鸣", "金句传播", "追更惯性",
    "误导再翻", "悬念续燃", "视角反转", "关系重组", "秘密递交",
    "失势继承人", "单亲母亲", "复仇新娘", "破产千金", "叛逃公主",
  ]),
};

const audienceGenderLabels = { all: "全部受众", male: "男性受众", female: "女性受众" };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function agentApiPath(suffix = "") {
  return `/api/pixeltale${suffix}`;
}

function agentRequestHeaders() {
  return { "Content-Type": "application/json", "X-PixelTale-Session": sessionId };
}

function modeValue() {
  if (state.mode === "long") return "long_form_drama";
  if (state.mode === "cn") return "cn_short_drama";
  return "tk_short_drama";
}

function modeLabel() {
  if (state.mode === "tk") return "TK SHORT DRAMA";
  if (state.mode === "cn") return "国内短剧";
  return "LONG-FORM DRAMA";
}

function currentMeta() {
  return stageMeta[state.stage] || stageMeta.brief;
}

function stageIndex(stage = state.stage) {
  return stageOrder.indexOf(stage);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("is-visible"), 2400);
}

function userFacingError(error) {
  const message = String(error?.message || "运行失败，请重试").trim();
  if (/\b504\b|Gateway Timeout/i.test(message)) {
    return "服务响应窗口已超时，当前输入已保留。请立即重试；若持续发生，系统会记录模型回退轨迹供排查。";
  }
  if (/API Key|未配置|未接入|provider/i.test(message)) {
    return `${message} 请打开“创作分工”，确认对应模型已接入后再试。`;
  }
  if (/核心冲突|创作规格需要/i.test(message)) {
    return "请在“创作想法”中写清主角、目标和阻碍，再点击“生成故事架构”。";
  }
  if (/超时|网络|请求失败|HTTP \d{3}|fetch/i.test(message)) {
    return `${message} 当前输入已保留，可以稍后重试。`;
  }
  return message;
}

async function request(suffix, options = {}) {
  const { timeoutMs = 0, ...requestOptions } = options;
  const controller = timeoutMs > 0 && typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  let payload;
  try {
    response = await fetch(agentApiPath(suffix), {
      ...requestOptions,
      ...(controller ? { signal: controller.signal } : {}),
      headers: { ...agentRequestHeaders(), ...(requestOptions.headers || {}) },
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (controller?.signal.aborted) throw error;
      payload = {};
    }
  } catch (error) {
    if (controller?.signal.aborted) {
      const timeoutError = new Error(`项目状态读取超时（${Math.round(timeoutMs / 1000)} 秒）`);
      timeoutError.code = "PIXELTALE_STATE_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || `请求失败：${response.status}`);
    error.code = payload.code || `HTTP_${response.status}`;
    throw error;
  }
  return payload;
}

function historyDate(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function renderCreativeHistory(entries = []) {
  const list = $("#historyList");
  const summary = $("#historySummary");
  if (!list || !summary) return;
  state.historyEntries = entries;
  summary.textContent = `${entries.length} 个已保存会话`;
  if (!entries.length) {
    list.innerHTML = `<div class="history-empty"><span class="history-empty-mark">+</span><strong>还没有创作历史</strong><p>完成故事架构或保存创作想法后，会话会自动出现在这里。</p></div>`;
    return;
  }
  list.innerHTML = entries.map((entry) => {
    const current = entry.isCurrent;
    const idea = entry.ideaExcerpt || "尚未写入创作想法";
    const statusClass = entry.status === "已导出" ? "is-exported" : entry.status === "制作中" ? "is-active" : "";
    return `<article class="history-item${current ? " is-current" : ""}"><div class="history-item-head"><div class="history-item-title"><span class="history-status ${statusClass}">${escapeHtml(entry.status || "已保存")}</span>${current ? `<span class="history-current">当前会话</span>` : ""}<h3>${escapeHtml(entry.title || "未命名剧集")}</h3><p>${escapeHtml(idea)}</p></div><time datetime="${escapeHtml(entry.updatedAt || "")}">${escapeHtml(historyDate(entry.updatedAt))}</time></div><div class="history-item-meta"><span>${escapeHtml(entry.mode || "TK 短剧")}</span><span>${escapeHtml(entry.stageLabel || "故事架构")}</span><span>已确认 ${escapeHtml(entry.progressLabel || "0 / 7")}</span><span>${escapeHtml(`${entry.artifactCount || 0} 个产物`)}</span></div><button type="button" class="history-open" data-history-open="${escapeHtml(entry.sessionId)}">${current ? "继续当前创作" : "继续创作"}<span aria-hidden="true">↗</span></button></article>`;
  }).join("");
  list.querySelectorAll(".history-item").forEach((item, index) => {
    const entry = entries[index];
    const open = item.querySelector(".history-open");
    if (!entry || !open) return;
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-delete";
    remove.dataset.historyDelete = entry.sessionId;
    remove.dataset.historyTitle = entry.title || "未命名剧集";
    remove.textContent = "删除项目";
    open.replaceWith(actions);
    actions.append(open, remove);
    if (state.historyDeletePending?.sessionId !== entry.sessionId) return;
    const confirmation = document.createElement("div");
    confirmation.className = "history-delete-confirm";
    const copy = document.createElement("span");
    copy.textContent = "确定删除“" + (entry.title || "未命名剧集") + "”？项目产物也会一并移除。";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "history-delete-confirm-button";
    confirm.dataset.historyDeleteConfirm = entry.sessionId;
    confirm.textContent = "确认删除";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "history-delete-cancel";
    cancel.dataset.historyDeleteCancel = entry.sessionId;
    cancel.textContent = "取消";
    confirmation.append(copy, confirm, cancel);
    item.append(confirmation);
  });
}

function requestHistoryDelete(targetSessionId, title = "") {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(targetSessionId || ""))) return;
  state.historyDeletePending = { sessionId: targetSessionId, title: title || "未命名剧集" };
  renderCreativeHistory(state.historyEntries || []);
}

async function deleteHistorySession(targetSessionId, title = "") {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(targetSessionId || ""))) return;
  state.historyDeletePending = null;
  try {
    await request(`/history/${encodeURIComponent(targetSessionId)}`, { method: "DELETE" });
    showToast("项目已删除");
    if (targetSessionId === sessionId) {
      startNewDraft();
      return;
    }
    await loadCreativeHistory();
  } catch (error) {
    showToast(userFacingError(error));
  }
}

async function loadCreativeHistory() {
  const list = $("#historyList");
  const summary = $("#historySummary");
  if (!list || !summary) return;
  list.innerHTML = `<div class="history-loading"><i></i><span>正在读取已保存会话</span></div>`;
  summary.textContent = "正在读取";
  try {
    const payload = await request("/history");
    renderCreativeHistory(Array.isArray(payload.history) ? payload.history : []);
  } catch (error) {
    summary.textContent = "读取失败";
    list.innerHTML = `<div class="history-error"><strong>创作历史暂时无法读取</strong><p>${escapeHtml(error.message || "请稍后重试")}</p><button type="button" class="history-retry" data-history-retry>重新读取</button></div>`;
  }
}

function openHistoryDialog() {
  const dialog = $("#historyDialog");
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  void loadCreativeHistory();
}

function resumeHistorySession(nextSessionId) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(nextSessionId || ""))) return;
  const currentSession = new URLSearchParams(window.location.search).get("session");
  if (nextSessionId === currentSession) {
    // 2026-08-10：当前会话点「继续当前创作」——URL 相同，assign 不会触发跳转（没反应）。
    // 强制刷新以恢复服务端最新状态（stage 从 API 恢复，停在当前阶段）。
    window.location.reload();
    return;
  }
  const target = new URL(window.location.href);
  target.searchParams.set("session", nextSessionId);
  target.hash = "brief";
  window.location.assign(target.toString());
}

function fileNameFromContentDisposition(value, fallback = "PixelTale_正式剧本.docx") {
  const encoded = String(value || "").match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* use ASCII fallback */ }
  }
  const ascii = String(value || "").match(/filename="?([^";]+)"?/i)?.[1];
  return ascii && !/^_+(?:\.docx)?$/i.test(ascii) ? ascii : fallback;
}

async function fetchScriptDocument() {
  const response = await fetch(agentApiPath("/script/download"), { headers: agentRequestHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `剧本下载失败：${response.status}`);
  }
  return {
    blob: await response.blob(),
    fileName: fileNameFromContentDisposition(response.headers.get("Content-Disposition"), state.agent?.scriptDocument?.fileName),
  };
}

async function fetchVisualAssetDocument() {
  const response = await fetch(agentApiPath("/visual-assets/download"), { headers: agentRequestHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `视觉资产下载失败：${response.status}`);
  }
  return {
    blob: await response.blob(),
    fileName: fileNameFromContentDisposition(response.headers.get("Content-Disposition"), state.agent?.visualAssetDocument?.fileName || "PixelTale_视觉资产.docx"),
  };
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadScriptDocument() {
  const { blob, fileName } = await fetchScriptDocument();
  triggerBlobDownload(blob, fileName);
}

async function downloadVisualAssetDocument() {
  const { blob, fileName } = await fetchVisualAssetDocument();
  triggerBlobDownload(blob, fileName);
}

async function saveScriptDocument(folderNameOverride) {
  if (!window.showDirectoryPicker || !window.isSecureContext) {
    await downloadScriptDocument();
    showToast("当前浏览器不支持本地文件夹保存，已下载 DOCX");
    return;
  }
  const { blob, fileName } = await fetchScriptDocument();
  const root = await window.showDirectoryPicker({ mode: "readwrite" });
  const folderName = folderNameOverride ?? $("#scriptFolderName")?.value.trim();
  const targetDir = folderName
    ? await root.getDirectoryHandle(folderName, { create: true })
    : root;
  const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
  showToast(folderName ? `已保存到新建文件夹“${folderName}”` : "已保存到所选文件夹");
}

async function runDocumentAction(action) {
  const folderName = $("#scriptFolderName")?.value.trim();
  state.documentBusy = true;
  state.documentError = "";
  renderStage();
  try {
    await action(folderName);
  } catch (error) {
    if (error.name === "AbortError") {
      showToast("已取消文件夹选择");
    } else {
      state.documentError = error.message || "DOCX 操作失败，请重试";
      showToast(state.documentError);
    }
  } finally {
    state.documentBusy = false;
    renderStage();
  }
}

function updateAgentState(agent) {
  if (!agent || typeof agent !== "object") return;
  state.agent = agent;
  if (agent.mode === "long_form_drama") state.mode = "long"; else if (agent.mode === "cn_short_drama") state.mode = "cn"; else state.mode = "tk";
  state.stage = agent.stage === "script" ? "handoff" : agent.stage || "brief";
  const legacySeatDefaults = { seat_a: "gpt-5.6-terra", seat_b: "claude-opus-5", seat_c: "claude-haiku-4-5" };
  const migratedRoutes = Object.fromEntries(Object.entries(agent.routes || {}).map(([key, value]) => [key, value === "deepseek-v4-pro" ? (legacySeatDefaults[key] || "claude-haiku-4-5") : value]));
  state.routes = { ...state.routes, ...migratedRoutes };
  state.input = { ...state.input, ...(agent.input || {}) };
  state.approved = new Set(agent.approvedArtifactIds || []);
  syncRoutingModelOptions(agent.modelOptions || []);
  persistSessionSnapshot();
}

function modelInfo(id) {
  const fallback = { name: id, provider: id.startsWith("claude-") ? "claude" : id.startsWith("deepseek-") ? "deepseek" : id.startsWith("grok-") ? "grok" : "chatgpt", role: "创作模型", detail: "由独立 PixelTale API 接入与路由" };
  return modelMeta[id] || fallback;
}

function syncRoutingModelOptions(options) {
  if (!Array.isArray(options) || !options.length) return;
  const groups = { chatgpt: [], claude: [], gemini: [] };
  options.forEach((option) => {
    if (groups[option?.provider]) groups[option.provider].push(option);
  });
  const labels = { chatgpt: "GPT", claude: "Claude", gemini: "Gemini" };
  $$('[data-route]').forEach((select) => {
    const selected = state.routes[select.dataset.route] || select.value;
    select.innerHTML = Object.entries(groups).map(([provider, entries]) => entries.length
      ? `<optgroup label="${labels[provider]}">${entries.map((entry) => `<option value="${escapeHtml(entry.id)}"${entry.configured ? "" : " disabled"}>${escapeHtml(modelInfo(entry.id).name)}${entry.configured ? "" : "（未接入）"}</option>`).join("")}</optgroup>`
      : "").join("");
    if ([...select.options].some((option) => option.value === selected && !option.disabled)) select.value = selected;
  });
}

function artifactForStage(stage) {
  const artifacts = state.agent?.artifacts || [];
  // 2026-08-10：同一版本可能同时存在「内容产物」(needs_review/approved，含 lines/units)
  // 与「审核产物」(failed，content 只有审核记录无内容)。同版本必须优先取内容产物，
  // 否则 dialogue 等阶段会渲染成空项目。
  const statusRank = { approved: 3, needs_review: 2, complete: 2, processing: 1, pending: 1, failed: 0 };
  return artifacts
    .filter((item) => item.stage === stage && item.type === `pixeltale_${stage}`)
    .filter((item) => stage !== "title" || (Array.isArray(item.content?.candidates) && item.content.candidates.length === 4 && item.content.candidates.every((candidate) => candidate?.title_en)))
    .sort((a, b) => {
      const versionDelta = Number(a.version || 0) - Number(b.version || 0);
      if (versionDelta !== 0) return versionDelta;
      return (statusRank[a.status] ?? 0) - (statusRank[b.status] ?? 0);
    })
    .at(-1) || null;
}

function latestRunForStage(stage) {
  return (state.agent?.runs || [])
    .filter((run) => run.stage === stage)
    .sort((left, right) => Date.parse(left.completedAt || left.startedAt || 0) - Date.parse(right.completedAt || right.startedAt || 0))
    .at(-1) || null;
}

function stageRunSummary(stage) {
  const run = latestRunForStage(stage);
  if (!run) return "";
  if (run.status === "failed") return "上一轮运行失败 · 可以重试";
  if (run.status === "running") return "正在运行 · 请稍候";
  const artifact = artifactForStage(stage);
  const issueCount = reviewIssueGroups(reviewForArtifact(artifact)?.content || {}).length;
  if (run.revision) {
    return run.status === "needs_review"
      ? "本轮修订已执行 · 仍有 " + issueCount + " 类问题待关闭"
      : "本轮修订已完成 · 等待确认";
  }
  return run.status === "needs_review"
    ? "本轮生成已完成 · " + issueCount + " 类问题待修订"
    : "本轮生成已完成 · 等待确认";
}

function unitStageProgress(stage) {
  if (![
    "arc",
    "scenes",
  ].includes(stage)) return null;
  const progress = state.agent?.stageProgress?.[stage] || {};
  const total = Number(progress.totalUnits || state.input.episodeCount || 0);
  const locked = Array.isArray(progress.lockedUnits) ? progress.lockedUnits : [];
  // 已生成集优先读后端 generatedUnits；存量 stageProgress（部署前数据）没有该字段时，
  // 从 batches（非 running 批次覆盖的集）回退计算，否则黄段会一直为 0。
  let generated;
  if (Array.isArray(progress.generatedUnits) && progress.generatedUnits.length) {
    generated = progress.generatedUnits;
  } else {
    const seen = new Set(
      (Array.isArray(progress.batches) ? progress.batches : [])
        .filter((entry) => entry?.status !== "running")
        .flatMap((entry) => (Array.isArray(entry?.units) ? entry.units : [])),
    );
    generated = [...seen].sort((a, b) => a - b);
  }
  if (!generated.length) generated = locked;
  const pending = Array.isArray(progress.pendingUnits) ? progress.pendingUnits : [...Array(total)].map((_, index) => index + 1).filter((number) => !locked.includes(number));
  const current = Array.isArray(progress.currentBatch) ? progress.currentBatch : [];
  return { total, locked, generated, pending, current, complete: !!total && locked.length >= total };
}

function unitStageScopeInput(stage) {
  const progress = unitStageProgress(stage);
  if (!progress) return "";
  const raw = String(state.input.revisionUnitNumbers || "").trim();
  const scope = raw.split(/[\s,，、；;]+/u).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0 && (!progress.total || item <= progress.total));
  return [...new Set(scope)].join(",");
}

function collectUnitStageScope(stage) {
  if (![
    "arc",
    "scenes",
  ].includes(stage)) return [];
  const raw = String($("#unitScopeInput")?.value ?? state.input.revisionUnitNumbers ?? "").trim();
  const progress = unitStageProgress(stage);
  const scope = raw.split(/[\s,，、；;]+/u).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0 && (!progress?.total || item <= progress.total));
  state.input.revisionUnitNumbers = [...new Set(scope)].join(",");
  return [...new Set(scope)];
}

async function handleEditUnitClick(btn, stage) {
  const input = document.getElementById("unitEditInput");
  const unit = Number(input?.value || 0);
  if (!Number.isInteger(unit) || unit <= 0) { alert("请输入有效的集号"); return; }
  const res = await fetch("/api/pixeltale", agentRequestHeaders());
  const data = await res.json().catch(() => ({}));
  const agent = data.agent;
  const unitContent = agent?.artifacts?.find((a) => a.stage === stage)?.content?.units?.[unit] || agent?.artifacts?.find((a) => a.stage === stage)?.content?.[String(unit)];
  if (!unitContent && !agent) { alert("请先加载项目"); return; }
  const body = unitContent && typeof unitContent === "object" ? JSON.stringify(unitContent, null, 2) : String(unitContent || "");
  const edited = prompt(`编辑第 ${unit} 集内容（JSON，仅 ${stage} 阶段）：`, body);
  if (edited === null) return;
  let patchedUnit;
  try { patchedUnit = JSON.parse(edited); } catch { alert("JSON 格式错误，未保存"); return; }
  try {
    const save = await fetch("/api/pixeltale/unit/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, unit, patchedUnit, ifMatch: Number(agent?.stageProgress?.[stage]?.version || 0) }),
    });
    const result = await save.json().catch(() => ({}));
    if (!save.ok) { alert(result.error || "保存失败"); return; }
    alert(`第 ${unit} 集已保存并标记为「人工定稿」，自动流程不会再覆盖。`);
    await refreshPixelTaleState();
  } catch (error) {
    alert("网络错误，请重试");
  }
}

async function handleFixUnitClick(btn) {
  const stage = btn.dataset.stage;
  const unit = Number(btn.dataset.unit);
  let issue;
  try { issue = JSON.parse(btn.dataset.issue); } catch { return; }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "修复中…";
  try {
    const res = await fetch("/api/pixeltale/unit/fix-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, unit, issue }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || "修复失败，请重试"); return; }
    if (data.status === "approved") alert(`第 ${unit} 集该问题已修复，审核通过并已锁定。`);
    else if (data.status === "rolled-back") alert(`第 ${unit} 集修复未改善，已自动恢复原版本。`);
    else alert(`第 ${unit} 集已修订，但仍有未解决问题。`);
    await refreshPixelTaleState();
  } catch (error) {
    alert("网络错误，请重试");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function refreshPixelTaleState() {
  try {
    const res = await fetch("/api/pixeltale", agentRequestHeaders());
    const data = await res.json();
    if (data.ok && data.agent) { state.agent = data.agent; renderApp(); }
  } catch { /* 静默 */ }
}

// 待修改集清单：聚合最新审核 issues 按集号分组（已锁定集除外）
function unitFixSummary(stage) {
  const progress = unitStageProgress(stage) || {};
  const lockedSet = new Set(Array.isArray(progress.locked) ? progress.locked.map(Number) : []);
  const artifact = artifactForStage(stage);
  const review = reviewForArtifact(artifact);
  const issues = Array.isArray(review?.content?.issues) ? review.content.issues : [];
  const byUnit = new Map();
  for (const issue of issues) {
    const unit = Number(issue.unit);
    if (!Number.isInteger(unit) || unit <= 0 || lockedSet.has(unit)) continue;
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit).push(issue);
  }
  return [...byUnit.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([unit, list]) => {
      const high = list.filter((item) => item.severity === "high").length;
      const tags = [...new Set(list.map((item) => item.tag || item.criterion_id || "审核意见"))].slice(0, 3).join("、");
      return { unit, list, high, tags, issue: list[0] };
    });
}

function renderUnitStageProgress(stage) {
  const progress = unitStageProgress(stage);
  if (!progress) return "";
  const current = progress.current.length ? `当前批次：第 ${progress.current.join("、")} 集` : progress.complete ? "全部集已锁定" : "等待开始下一批";
  const generatedCount = progress.generated.length;
  const lockedCount = progress.locked.length;
  const pendingCount = progress.pending.length;
  const generatedPct = progress.total ? Math.min(100, Math.round(generatedCount / progress.total * 100)) : 0;
  const lockedPct = progress.total ? Math.min(100, Math.round(lockedCount / progress.total * 100)) : 0;
  const pinned = Array.isArray(progress.pinned) ? progress.pinned : [];
  const dirty = Array.isArray(progress.dirty) ? progress.dirty : [];
  const status = generatedCount ? `已生成 ${generatedCount} 集 · 已锁定 ${lockedCount} 集` : `已锁定 ${lockedCount} 集`;
  const pinnedBadge = pinned.length ? `<em class="lock-badge is-pinned" title="人工编辑过的集，自动流程不会覆盖">✍ 人工定稿 ${pinned.length}</em>` : "";
  const dirtyBadge = dirty.length ? `<em class="lock-badge is-dirty" title="依赖已变更，需人工复核">⚠ 依赖已变 ${dirty.length}</em>` : "";
  const pending = pendingCount ? `未锁定 ${pendingCount} 集` : "没有待处理集";
  const fixUnits = unitFixSummary(stage);
  const unitFixListHtml = fixUnits.length
    ? `<div class="unit-fix-list"><div class="unit-fix-head"><i></i>待修改集（审核未通过 · 可逐集修复）</div>${fixUnits.map((entry) => {
        const fixable = Number.isInteger(Number(entry.unit)) && entry.unit > 0 && !!entry.issue.fieldPath;
        return `<div class="unit-fix-row"><strong>第 ${entry.unit} 集</strong><span>${entry.list.length} 个问题${entry.high ? ` · 高优先级 ${entry.high}` : ""}${entry.tags ? `：${escapeHtml(entry.tags)}` : ""}</span>${fixable ? `<button type="button" class="fix-unit-btn" data-fix-unit data-stage="${escapeHtml(stage)}" data-unit="${Number(entry.unit)}" data-issue='${escapeHtml(JSON.stringify({ unit: Number(entry.unit), field_path: entry.issue.fieldPath, tag: entry.issue.tag || "", feedback: entry.issue.feedback || "", fix: entry.issue.fix || "" }))}'>修复该集</button>` : ""}</div>`;
      }).join("")}</div>`
    : "";
  return `<section class="unit-stage-progress" aria-label="集级生成进度"><div class="unit-stage-progress-head"><div><span class="card-label"><i></i>EPISODE ISOLATION</span><strong>${escapeHtml(status)} <small>/ ${progress.total || "-"} 集</small></strong>${pinnedBadge}${dirtyBadge}</div><span>${escapeHtml(current)}</span></div><div class="unit-stage-progress-track" title="绿=已锁定 · 黄=已生成待审核 · 灰=未生成"><i class="is-generated" style="width:${generatedPct}%"></i><i class="is-locked" style="width:${lockedPct}%"></i></div><div class="unit-stage-progress-foot"><span>${escapeHtml(pending)} · 后台自动分批</span><label for="unitScopeInput">指定修订集数 <input id="unitScopeInput" type="text" value="${escapeHtml(unitStageScopeInput(stage))}" placeholder="留空：处理全部未锁定集" inputmode="numeric" autocomplete="off" /></label><label for="unitEditInput">人工编辑集号 <input id="unitEditInput" type="text" value="${escapeHtml(state.unitEditTarget || "")}" placeholder="输入集号后点编辑" inputmode="numeric" autocomplete="off" /></label><button type="button" class="edit-unit-btn" data-edit-unit>编辑该集</button></div>${unitFixListHtml}<small>未关闭项只会重跑对应批次；只有出现无法由阶段契约自动裁决的创作取舍时，才需要你选择方案。已锁定集不会再次提交。</small></section>`;
}

function reviewForArtifact(artifact) {
  if (!artifact?.reviewId) return null;
  return (state.agent?.artifacts || []).find((item) => item.id === artifact.reviewId) || null;
}

// 人工放行前的审核依据摘要：让创作者基于分数/问题统计/修订状态做决定，
// 而不是盲目跳过质量门。
function buildHumanOverrideBrief(reviewContent = {}) {
  const lines = [];
  const score = reviewContent.score;
  if (Number.isFinite(score)) lines.push(`• 质量分：${Math.round(score)} / 100`);
  const dims = reviewContent.dimensions || {};
  const dimLabels = { structure: "结构", plot: "剧情", design: "设计", logic: "逻辑" };
  const dimLine = Object.entries(dims)
    .filter(([key]) => dimLabels[key])
    .map(([key, value]) => {
      const score = Number(typeof value === "number" ? value : value?.score);
      return Number.isFinite(score) ? `${dimLabels[key]} ${Math.round(score)}` : "";
    })
    .filter(Boolean)
    .join(" · ");
  if (dimLine) lines.push(`• 分项：${dimLine}`);
  const issueArrays = ["mandatoryIssues", "commonIssues", "reviewIssues"].filter((key) => Array.isArray(reviewContent[key]));
  const issues = issueArrays.flatMap((key) => reviewContent[key]);
  const pendingClosures = Array.isArray(reviewContent.revision?.closure?.items)
    ? reviewContent.revision.closure.items.filter((item) => item.status !== "resolved")
    : [];
  const counts = {};
  for (const item of [...issues, ...pendingClosures]) counts[item.severity] = (counts[item.severity] || 0) + 1;
  const sevLabels = { high: "严重", medium: "中等", low: "轻微" };
  const sevLine = Object.entries(counts).filter(([sev]) => sevLabels[sev]).map(([sev, n]) => `${sevLabels[sev]} ${n}`).join(" · ");
  if (sevLine) lines.push(`• 未解决问题：${sevLine}`);
  if (pendingClosures.length) lines.push(`• 修订：${pendingClosures.length} 项未关闭`);
  const failures = Array.isArray(reviewContent.technicalFailures) ? reviewContent.technicalFailures : [];
  const independenceUnavailable = failures.find((item) => item?.status === "independence_unavailable");
  if (independenceUnavailable) lines.push(`• 审核标注：${independenceUnavailable.message || "当前仅一个可用模型通道，本次为非独立复核。"}`);
  const stalled = failures.find((item) => item?.status === "stalled" || item?.status === "budget_exhausted");
  if (stalled) lines.push(`• 状态：${stalled.message || "自动修订未收敛，仅重跑未通过批次"}`);
  return lines.length ? lines.join("\n") : "（无评分数据，请自行核对当前版本）";
}

function approvedStageCount() {
  const artifacts = state.agent?.artifacts || [];
  return stageOrder.slice(0, -1).filter((stage) => artifacts.some((item) => item.stage === stage && state.approved.has(item.id))).length;
}

function handoffReady() {
  return approvedStageCount() === productionStageTotal;
}

function workflowStage() {
  const approved = new Set(state.approved);
  return stageOrder.slice(0, -1).find((stage) => {
    const artifact = artifactForStage(stage);
    return !artifact || !approved.has(artifact.id);
  }) || "handoff";
}

function latestConsensusReview() {
  const current = artifactForStage(state.stage);
  if (current) return reviewForArtifact(current);
  for (const stage of [...stageOrder].reverse()) {
    const artifact = artifactForStage(stage);
    const review = reviewForArtifact(artifact);
    if (review?.content?.quality !== undefined || review?.content?.reviewCompletion !== undefined) return review;
  }
  return null;
}

function consensusMetrics() {
  const review = latestConsensusReview();
  const content = review?.content || {};
  const interactionCompletion = Math.round((approvedStageCount() / productionStageTotal) * 100);
  const rawReviewCompletion = content.reviewCompletion;
  const reviewCompletion = rawReviewCompletion === null || rawReviewCompletion === undefined || rawReviewCompletion === ""
    ? null
    : Number.isFinite(Number(rawReviewCompletion)) ? Number(rawReviewCompletion) : null;
  const rawAgreement = content.agreement;
  const agreement = rawAgreement === null || rawAgreement === undefined || rawAgreement === "" ? null : Number(rawAgreement);
  const rawQuality = content.quality;
  const quality = rawQuality === null || rawQuality === undefined || rawQuality === "" ? null : Number(rawQuality);
  const index = Number.isFinite(quality) ? Math.max(0, Math.min(100, Math.round(quality))) : null;
  const quorum = content.quorum || {};
  return { index, agreement, quality: Number.isFinite(quality) ? quality : null, reviewCompletion, interactionCompletion, completedReviews: Number(quorum.completedSeats ?? quorum.completed ?? 0), requiredReviews: Number(quorum.required || 3), quorumMet: quorum.met === true, releaseReady: content.pass === true, content };
}

function renderConsensusMeter() {
  const metrics = consensusMetrics();
  const score = document.querySelector("#consensusScore");
  const value = document.querySelector("#consensusValue");
  const fill = document.querySelector("#consensusFill");
  const label = document.querySelector("#consensusLabel");
  const agreement = document.querySelector("#consensusAgreement");
  const reviewCompletion = document.querySelector("#consensusReviewCompletion");
  const interactionCompletion = document.querySelector("#consensusQuality");
  if (!score || !value || !fill || !label || !agreement || !reviewCompletion || !interactionCompletion) return;
  const decision = metrics.content?.decision || {};
  const tone = metrics.quality === null ? "等待质量评分" : metrics.quality >= 90 ? "质量良好" : metrics.quality >= 75 ? "质量可接受" : "需要修订";
  score.textContent = decision.kind === "approve" ? "通过" : decision.kind === "revise" ? "修订" : decision.kind === "needs_decision" ? "决定" : decision.kind === "rerun" ? "重试" : "—";
  value.textContent = decision.title || `质量分 · ${tone}`;
  const advisoryGate = reviewAdvisoryGate(metrics.content);
  const disagreements = Array.isArray(metrics.content?.disagreements) ? metrics.content.disagreements : [];
  const consensusNote = metrics.releaseReady && disagreements.length ? ` · 部分共识（${disagreements.length} 席有分歧已记录）` : "";
  const releaseState = decision.summary || (!metrics.quorumMet ? "审核未完成" : metrics.releaseReady ? "可确认" : advisoryGate.blockingPending.length ? "等待人工决定" : "等待裁判决定");
  const technicalFailures = Array.isArray(metrics.content?.technicalFailures) ? metrics.content.technicalFailures : [];
  const ruleBlocked = technicalFailures.find((failure) => failure.status === "rule_blocked");
  label.textContent = ruleBlocked
    ? "系统裁判 · 规则校验未通过（未达基础标准）· 本次审核未执行"
    : metrics.quality !== null
      ? `系统裁判 · ${releaseState}${consensusNote}`
      : "主笔完成后启动规则校验与双席审读";
  fill.style.setProperty("--consensus-width", `${metrics.quality ?? 0}%`);
  fill.parentElement?.classList.toggle("is-live", metrics.quality !== null);
  agreement.textContent = metrics.agreement === null ? "未评分" : `${metrics.agreement}%`;
  reviewCompletion.textContent = metrics.reviewCompletion === null ? "未执行" : `${metrics.reviewCompletion}%`;
  interactionCompletion.textContent = metrics.quality === null ? "未评分" : `${metrics.quality}%`;
}

function stageStatus(stage) {
  if (stage === "handoff") return handoffReady() ? "可导出" : "待解锁";
  const artifact = artifactForStage(stage);
  if (artifact && state.approved.has(artifact.id)) return "已确认";
  if (stage === workflowStage()) {
    if (!artifact) return "下一步";
    const unitProgress = unitStageProgress(stage);
    if (unitProgress && !unitProgress.complete) return "待继续";
    if (stage === "title" && artifact.status === "ready" && !state.input.storyTitle) return "待选择";
    return artifact.status === "ready" ? "待确认" : "需修订";
  }
  return stageIndex(stage) < stageIndex(workflowStage()) ? "可查看" : "待解锁";
}

function stageAccessible(stage) {
  return stageStatus(stage) !== "待解锁";
}

function navigateToStage(stage) {
  if (!stageOrder.includes(stage)) return;
  state.stage = stage;
  state.lastError = "";
  renderStage();
}

function technicalReviewState(reviewContent = {}) {
  const quorum = reviewContent.quorum || {};
  const feedbacks = Array.isArray(reviewContent.feedbacks) ? reviewContent.feedbacks : [];
  const failures = Array.isArray(reviewContent.technicalFailures) ? reviewContent.technicalFailures : [];
  const failedSeats = feedbacks.filter((item) => item.status === "failed");
  const completedSeats = Number(quorum.completedSeats ?? quorum.completed ?? feedbacks.filter((item) => item.status === "completed").length);
  const stalled = reviewContent.stalled === true || reviewContent.status === "stalled";
  const budgetExhausted = reviewContent.budget_exhausted === true || reviewContent.status === "budget_exhausted";
  const notConfigured = [...failedSeats, ...failures].some((item) => item.failureReason === "not_configured");
  return { blocked: completedSeats < Number(quorum.required || 3) || quorum.degraded === true || notConfigured || failures.length > 0 || failedSeats.length > 0 || stalled || budgetExhausted, failedSeats, failures, degraded: quorum.degraded === true, stalled, budgetExhausted };
}

function nextStepMeta() {
  const flowStage = workflowStage();
  const flowMeta = stageMeta[flowStage];
  if (state.activeRun?.stage === flowStage) {
    return {
      kind: "busy",
      title: `${flowMeta.title}正在后台运行`,
      copy: "任务仍在独立编剧 API 后台执行。页面不会重复提交，完成后会自动同步结果。",
      flowStage,
    };
  }
  if (state.busy) {
    if (flowStage === "title") return { kind: "busy", title: "正在生成 4 个英文剧名", copy: "由总编排中指定的单个模型生成，完成后直接进入人工选择，不执行交叉审核。", flowStage };
    return { kind: "busy", title: "正在执行当前阶段", copy: "主笔生成内容；规则校验和双席审读提交证据；系统裁判随后给出唯一决定。", flowStage };
  }
  if (state.pendingCrossStageRepair?.stage === state.stage) {
    const repairMeta = stageMeta[state.stage] || stageMeta.brief;
    const sourceMeta = stageMeta[state.pendingCrossStageRepair.sourceStage] || stageMeta[flowStage] || stageMeta.brief;
    return {
      kind: "cross-stage-repair",
      stage: state.stage,
      title: `处理${repairMeta.title}跨阶段问题`,
      copy: `当前问题由“${sourceMeta.title}”审核发现，但归属于本阶段。重新生成${repairMeta.title}会建立新版本，并重新审核下游内容。`,
      label: `重新生成${repairMeta.title} →`,
      flowStage,
    };
  }
  if (state.stage !== flowStage) {
    return {
      kind: "return",
      title: `返回步骤 ${String(stageIndex(flowStage) + 1).padStart(2, "0")} · ${flowMeta.title}`,
      copy: `你正在查看已确认的“${currentMeta().title}”。生产主线仍停在“${flowMeta.title}”。`,
      label: `返回当前步骤 · ${flowMeta.title}`,
      flowStage,
    };
  }
  if (flowStage === "handoff") {
    return {
      kind: "handoff",
      title: "生成正式交付文件",
      copy: "七个创作阶段都已确认。点击后生成正式剧本、视觉资产文档和版本化导出包。",
      label: "生成正式文件 →",
      flowStage,
    };
  }
  const artifact = artifactForStage(flowStage);
  if (!artifact) {
    const brief = flowStage === "brief";
    const titleStage = flowStage === "title";
    return {
      kind: "run",
      stage: flowStage,
      title: brief ? "生成故事架构" : titleStage ? "生成 4 个剧名候选" : `生成${flowMeta.title}`,
      copy: brief ? "填好平台、节奏和核心冲突后，生成并复核故事架构；确认后进入剧名选择。" : titleStage ? "根据剧本 DNA、投放市场和发行平台生成 4 个英文剧名，并附中文释义。" : `完成${flowMeta.title}，生成结果通过复核后，下一步是确认本阶段。`,
      label: brief ? "生成故事架构 →" : titleStage ? "生成 4 个剧名 →" : `生成${flowMeta.title} →`,
      flowStage,
    };
  }
  const reviewContent = reviewForArtifact(artifact)?.content || {};
  const technicalState = technicalReviewState(reviewContent);
  if (technicalState.blocked && reviewForArtifact(artifact) && !creativeReviewDecisionGroups(reviewContent).length) {
    return {
      kind: "run",
      stage: flowStage,
      title: `${flowMeta.title}技术未完成`,
      copy: "审核尚未具备有效技术结果。请重新提交当前阶段，完成审核后再判断质量与修订意见。",
      label: `重新提交${flowMeta.title}并审核 →`,
      flowStage,
    };
  }
  const refereeDecision = reviewContent.decision || {};
  const creativeDecisions = creativeReviewDecisionGroups(reviewContent);
  if (refereeDecision.kind === "needs_decision" && creativeDecisions.length) {
    return {
      kind: "human-override",
      stage: flowStage,
      title: `${flowMeta.title}需要决定`,
      copy: refereeDecision.summary || "请选择一个创作方案，系统会记录取舍后继续。",
      label: "选择方案并继续 →",
      flowStage,
    };
  }
  if (refereeDecision.kind === "retry_failed" || (refereeDecision.kind === "needs_decision" && UNIT_STAGES.has(flowStage))) {
    const retryUnits = Array.isArray(reviewContent.retryUnits) && reviewContent.retryUnits.length
      ? reviewContent.retryUnits
      : unitStageProgress(flowStage)?.pending || [];
    return {
      kind: "retry-failed",
      stage: flowStage,
      unitNumbers: retryUnits,
      title: "只重跑未通过批次",
      copy: refereeDecision.summary || "仅处理未锁定且未通过的批次；已锁定集不会再次提交。",
      label: retryUnits.length ? `重跑第 ${retryUnits.join("、")} 集 →` : "重跑未通过批次 →",
      flowStage,
    };
  }
  if (refereeDecision.kind === "revise") {
    const ruleBlocked = (Array.isArray(reviewContent.technicalFailures) ? reviewContent.technicalFailures : [])
      .find((failure) => failure.status === "rule_blocked");
    // 2026-08-11：评分达标（≥75）时不应强制修订，给人工放行出口
    if (!ruleBlocked && scoresMeetGate(reviewContent)) {
      return {
        kind: "human-override",
        stage: flowStage,
        title: `${flowMeta.title}评分已达标`,
        copy: `质量分 ${Math.round(Number(reviewContent.quality))} 达标（≥75）。系统建议定向修订，但你也可以接受当前版本继续。`,
        label: "接受当前版本并继续（评分已达标）",
        flowStage,
      };
    }
    return {
      kind: "auto-revise",
      stage: flowStage,
      ruleBlocked: !!ruleBlocked,
      title: ruleBlocked ? `${flowMeta.title}未达基础标准` : `${flowMeta.title}需要定向修订`,
      copy: ruleBlocked
        ? "本次生成命中代码级校验规则（未达基础标准），审核未执行、无质量评分。请调整内容后重跑本阶段；或使用右下角「接受当前版本并继续」人工放行。"
        : refereeDecision.summary || "系统裁判已给出唯一的定向修订清单。",
      label: ruleBlocked ? "重新生成本阶段 →" : "执行定向修订 →",
      flowStage,
    };
  }
  if (refereeDecision.kind === "rerun") {
    const techState = technicalReviewState(reviewContent);
    const failedSeats = techState.failedSeats;
    const techFailuresOnly = failedSeats.length > 0 && failedSeats.every((seat) => seat.failureReason === "network_error" || seat.failureReason === "timeout" || seat.failureReason === "api_error");
    const degradedOnly = techState.degraded === true && failedSeats.length === 0;
    const qualityMet = scoresMeetGate(reviewContent);
    if ((techFailuresOnly || degradedOnly) && qualityMet) {
      const failedNames = [...new Set(failedSeats.map((seat) => modelMeta[seat.model || seat.actualModel]?.name || seat.model || seat.actualModel || "审读席"))].join("、");
      return {
        kind: "human-override",
        stage: flowStage,
        title: `${flowMeta.title}评分已达标`,
        copy: `另一审读席（${failedNames}）网络调用失败，当前质量分 ${Math.round(Number(reviewContent.quality))} 已达标（≥75）。接受当前版本并继续，或重新审核。`,
        label: "接受当前版本并继续（评分已达标）",
        flowStage,
      };
    }
    return {
      kind: "run",
      stage: flowStage,
      title: `${flowMeta.title}审核未完成`,
      copy: refereeDecision.summary || "请重新完成本阶段审核。",
      label: `重新审核${flowMeta.title} →`,
      flowStage,
    };
  }
  const advisoryGate = reviewAdvisoryGate(reviewContent);
  if (advisoryGate.blockingPending.length) {
    return {
      kind: "review-advisories",
      stage: flowStage,
      title: `${flowMeta.title}有待裁决意见`,
      copy: `请先处理 ${advisoryGate.blockingPending.length} 条高影响意见，再确认本阶段。已采纳的普通建议会在裁决完成后再执行。`,
      label: "处理待裁决意见 →",
      flowStage,
    };
  }
  if (advisoryGate.accepted.length) {
    return {
      kind: "auto-revise",
      stage: flowStage,
      title: `${flowMeta.title}需要执行已采纳修订`,
      copy: `已有 ${advisoryGate.accepted.length} 条建议被采纳。一次点击会自动处理全部问题，并重新提交规则校验、双席审读和系统裁判。`,
      label: "一键修订并复审 →",
      flowStage,
    };
  }
  const decisionRequired = creativeReviewDecisionGroups(reviewContent);
  if (decisionRequired.length) {
    return {
      kind: "human-override",
      stage: flowStage,
      title: `${flowMeta.title}需要决定`,
      copy: `请查看“需要决定”中的 ${decisionRequired.length} 项，选择创作方案后再继续。`,
      label: "选择方案并继续 →",
      flowStage,
    };
  }
  if (artifact.status === "ready") {
    const unitProgress = unitStageProgress(flowStage);
    if (unitProgress && !unitProgress.complete) {
      const nextUnits = unitProgress.pending.slice(0, 5);
      return {
        kind: "run",
        stage: flowStage,
        title: `处理剩余${flowMeta.title}`,
        copy: `当前有 ${unitProgress.pending.length} 集尚未锁定。点击一次后后台会自动处理全部未锁定集，已锁定内容不会再次提交。`,
        label: "一键处理剩余集 →",
        flowStage,
      };
    }
    const nextStage = stageOrder[stageIndex(flowStage) + 1] || "handoff";
    const nextLabel = stageMeta[nextStage]?.title || "导出";
    if (flowStage === "title" && !state.input.storyTitle) {
      return {
        kind: "approve",
        artifactId: artifact.id,
        disabled: true,
        title: "选择一个剧名",
        copy: "先从 4 个风格各异的候选中选定一个，确认后进入故事提案。",
        label: "选择后进入故事提案 →",
        flowStage,
      };
    }
    return {
      kind: "approve",
      artifactId: artifact.id,
      title: `确认${flowMeta.title}`,
      copy: flowStage === "title" ? `确认所选英文剧名后自动进入“${nextLabel}”，中文释义不会写入正式片名。` : `复核已通过。确认后自动进入“${nextLabel}”，已确认版本不会被覆盖。`,
      label: `确认并进入${nextLabel} →`,
      flowStage,
    };
  }
  if (!reviewIssueGroups(reviewContent).length) {
    return {
      kind: "run",
      stage: flowStage,
      title: `${flowMeta.title}审核未完成`,
      copy: "本轮没有形成可执行的强制修订清单。重新生成当前阶段并重新审核，评分分歧和参考建议不会自动改稿。",
      label: `重新生成${flowMeta.title}并审核 →`,
      flowStage,
    };
  }
  return {
    kind: "auto-revise",
    stage: flowStage,
    title: `${flowMeta.title}需要修订`,
    copy: "下方“必须处理”是唯一执行清单。一次点击会合并全部问题，并只执行一轮定向改稿与复审。",
    label: "一键修订并复审 →",
    flowStage,
  };
}

function renderInlineHumanOverrideForm(stage) {
  const artifact = (state.agent?.artifacts || []).find((item) => item.stage === stage);
  const review = reviewForArtifact(artifact);
  const creativeDecision = creativeReviewDecisionGroups(review?.content || {})[0];
  const choiceId = state.impactChoices[review?.id || `${stage}-decision`] || "option_1";
  const choiceIndex = Number(choiceId.replace("option_", "")) - 1;
  const choice = creativeDecision?.decisionOptions?.[choiceIndex] || creativeDecision?.decisionOptions?.[0] || "";
  const unitNote = UNIT_STAGES.has(stage) ? "未锁定集会在确认后锁定；已锁定集不会被改动。" : "会保留当前版本，并将本次取舍写入创作历史。";
  return `<form class="inline-decision-form" data-human-override-form>
    <span class="card-label"><i></i>CREATOR DECISION</span>
    <strong>以当前版本继续</strong>
    <p>自动修订已停止，不会再自动重复改稿。请在页面内查看依据、写下取舍理由后再确认。</p>
    ${choice ? `<small class="inline-decision-choice">当前选择：${escapeHtml(choice)}</small>` : ""}
    <pre class="inline-decision-evidence">${escapeHtml(buildHumanOverrideBrief(review?.content || {}))}</pre>
    <label>请简要记录本次取舍理由<span class="optional">可选</span><textarea data-human-override-reason maxlength="600" placeholder="例如：当前版本符合核心创作目标，接受已知取舍后继续推进。"></textarea></label>
    <small>${escapeHtml(unitNote)}</small>
    <div class="inline-decision-actions"><button class="stage-primary" data-flow-action="confirm-human-override" data-human-override-stage="${escapeHtml(stage)}" type="button">确认记录并继续 →</button><button class="text-button" data-flow-action="cancel-human-override" type="button">暂不继续</button></div>
  </form>`;
}

function renderInlineRerunConfirmation(pending) {
  const title = stageMeta[pending.stage]?.title || "当前阶段";
  return `<section class="inline-decision-form inline-rerun-confirmation" aria-label="重新生成确认">
    <span class="card-label"><i></i>NEW VERSION</span>
    <strong>重新生成${escapeHtml(title)}</strong>
    <p>当前阶段已有确认版本。重新生成会建立新版本，后续已确认内容需要重新核对。</p>
    <div class="inline-decision-actions"><button class="stage-primary" data-flow-action="confirm-rerun" type="button">创建新版本 →</button><button class="text-button" data-flow-action="cancel-rerun" type="button">保留当前版本</button></div>
  </section>`;
}

function renderAgentTaskAction(action) {
  if (state.pendingHumanOverride) return renderInlineHumanOverrideForm(state.pendingHumanOverride);
  if (state.pendingRerun) return renderInlineRerunConfirmation(state.pendingRerun);
  const disabled = state.busy || action.disabled;
  const guidedClass = !disabled && action.kind !== "busy" ? " is-next-action" : "";
  if (action.kind === "run") {
    const id = action.stage === "brief" ? "runBrief" : "agentRunStage";
    return `<button id="${id}" class="stage-primary agent-task-primary${guidedClass}" data-flow-action="run" data-run-stage="${escapeHtml(action.stage)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "cross-stage-repair") {
    return `<button class="stage-primary agent-task-primary${guidedClass}" data-flow-action="run" data-run-stage="${escapeHtml(action.stage)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "auto-revise") {
    return `<button class="stage-primary agent-task-primary${guidedClass}" data-flow-action="auto-revise" data-auto-revise="${escapeHtml(action.stage)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "retry-failed") {
    return `<button class="stage-primary agent-task-primary${guidedClass}" data-flow-action="retry-failed" data-retry-stage="${escapeHtml(action.stage)}" data-retry-units="${escapeHtml((action.unitNumbers || []).join(","))}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "human-override") {
    const inline = (action.label || "").includes("评分已达标") ? " decision-override-btn" : "";
    return `<button class="stage-primary agent-task-primary${guidedClass}${inline}" data-flow-action="human-override" data-human-override="${escapeHtml(action.stage)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "review-advisories") {
    return `<button class="stage-primary agent-task-primary${guidedClass}" data-flow-action="review-advisories" data-review-stage="${escapeHtml(action.stage)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "approve") {
    return `<button class="stage-primary agent-task-primary${guidedClass}" data-flow-action="approve" data-approve-artifact="${escapeHtml(action.artifactId)}" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "handoff") {
    return `<button id="confirmHandoff" class="stage-primary agent-task-primary${guidedClass}" data-flow-action="handoff" type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  if (action.kind === "return") {
    return `<button class="stage-secondary agent-task-primary${guidedClass}" data-flow-action="return" data-return-current type="button" ${disabled ? "disabled" : ""}>${escapeHtml(action.label)}</button>`;
  }
  return action.kind === "busy" ? `<span class="agent-task-busy" role="status">处理中 · 请稍候</span>` : "";
}

function renderShellState() {
  const action = nextStepMeta();
  const flowStage = workflowStage();
  $("#modeLabel").textContent = modeLabel();
  $("#agentTaskTitle").textContent = action.title;
  $("#agentTaskCopy").textContent = state.lastError || action.copy;
  $("#agentTaskCopy").setAttribute("role", state.lastError ? "alert" : "status");
  $("#agentTaskAction").innerHTML = renderAgentTaskAction(action);
  bindAgentTaskAction();
  $("#flowStepCounter").textContent = productionProgressLabel(flowStage);
  const runSummary = stageRunSummary(flowStage);
  $("#agentStatus").textContent = state.busy
    ? "PixelTale 正在生成并复核..."
    : action.kind === "busy"
      ? "后台运行中 · 自动同步"
    : state.lastError
      ? "本次运行失败"
      : action.kind === "approve"
        ? "等待确认"
        : action.kind === "handoff"
          ? "等待导出"
          : action.kind === "return"
            ? "正在查看已确认版本"
            : action.kind === "auto-revise"
              ? runSummary || "等待执行修订"
              : action.kind === "review-advisories"
                ? "等待人工裁决"
                : action.kind === "run"
                  ? runSummary || "等待生成"
                  : runSummary || "等待输入";
  $("#approvedCount").textContent = `${String(approvedStageCount()).padStart(2, "0")} / ${String(productionStageTotal).padStart(2, "0")}`;
  $("#progressBar").style.width = `${Math.round((approvedStageCount() / productionStageTotal) * 100)}%`;
  renderConsensusMeter();
  $$(".mode-button").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  $$(".mode-button").forEach((button) => { button.disabled = state.busy || state.revising; });
  $$(".stage-link").forEach((button) => {
    const name = button.dataset.stage;
    const artifact = artifactForStage(name);
    const status = stageStatus(name);
    const locked = status !== "已确认" && !stageAccessible(name);
    button.classList.toggle("is-active", name === state.stage);
    button.classList.toggle("is-done", !!artifact && state.approved.has(artifact.id));
    button.classList.toggle("is-next-stage", name === flowStage && status !== "已确认");
    button.classList.toggle("is-locked", locked);
    // 2026-08-11：所有阶段始终可点击查看
    button.disabled = false;
    button.onclick = () => navigateToStage(name);
    button.title = locked ? `完成“${stageMeta[flowStage]?.title || "当前阶段"}”后解锁` : name === flowStage ? `下一步：${stageMeta[name]?.title || name}` : `查看“${stageMeta[name]?.title || name}”`;
    button.setAttribute("aria-label", `${stageMeta[name]?.title || name}${name === flowStage && status !== "已确认" ? "，下一步" : ""}`);
    const statusNode = button.querySelector(".stage-status");
    if (statusNode) statusNode.textContent = status;
    if (name === state.stage) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    button.querySelector("i")?.setAttribute("aria-label", artifact && state.approved.has(artifact.id) ? "已确认" : "未确认");
  });
  renderModelTeam();
  const ready = handoffReady();
  $$('[data-open-stage="handoff"]').forEach((button) => { button.disabled = !ready; });
  $("#handoffSummary").textContent = ready ? "全部阶段已确认 · 可生成正式剧本与视觉资产 DOCX" : "完成全部阶段确认后生成正式文件";
}

function renderModelTeam() {
  const options = Array.isArray(state.agent?.modelOptions) ? state.agent.modelOptions : [];
  const seatDefaults = [
    { seatId: "seat_a", role: "structure_causality", requiredModel: "gpt-5.6-terra" },
    { seatId: "seat_b", role: "character_continuity", requiredModel: "gpt-5.6-sol" },
  ];
  const status = state.agent?.providerStatus || {};
  const currentArtifact = artifactForStage(state.stage);
  const primaryExecution = currentArtifact?.primaryExecution || {};
  const currentReview = reviewForArtifact(currentArtifact);
  const reviewFeedbacks = Array.isArray(currentReview?.content?.feedbacks) ? currentReview.content.feedbacks : [];
  const storedReviewPolicy = currentReview?.content?.reviewPolicy || {};
  const requiredReviewSeats = requiredReviewSeatsFor(state.stage, storedReviewPolicy, currentArtifact);
  const activeSeats = seatDefaults.slice(0, requiredReviewSeats);
  const roleLabels = { structure_causality: "结构与因果审查", character_continuity: "人物与连续性审查", audience_pacing_visual: "受众节奏与视觉审查" };
  const roleDescriptions = { seat_a: "阶段契约 · 因果链 · 时间线自洽", seat_b: "人物动机 · 关系演进 · 世界规则 · 视觉设计" };
  const phases = [
    { id: "authoring", label: "主笔生成" },
    { id: "validating", label: "规则校验" },
    { id: "reviewing", label: requiredReviewSeats === 1 ? "单席快速审读" : "双席审读" },
    { id: "refereeing", label: "系统裁判决定" },
  ];
  const currentPhaseIndex = phases.findIndex((phase) => phase.id === state.runPhase);
  const completedPhaseIndex = currentPhaseIndex >= 0 ? currentPhaseIndex - 1 : currentReview ? phases.length - 1 : -1;
  const phaseRail = `<div class="phase-rail" aria-label="阶段进度">${phases.map((phase, index) => {
    const isCurrent = phase.id === state.runPhase;
    const isComplete = index <= completedPhaseIndex;
    const phaseClass = isCurrent ? "is-current is-live" : isComplete ? "is-complete" : "is-pending";
    return `<span class="phase-step ${phaseClass}"><i>${isComplete ? "✓" : String(index + 1).padStart(2, "0")}</i><b>${phase.label}</b></span>${index < phases.length - 1 ? "<em aria-hidden=\"true\">→</em>" : ""}`;
  }).join("")}</div>`;
  const failureReasons = { timeout: "请求超时", network_error: "网络错误", empty_response: "空响应", invalid_json: "返回格式错误", schema_error: "数据结构错误", not_configured: "模型未配置" };
  const reviewTeam = activeSeats.map((seat, index) => {
    const matched = reviewFeedbacks.find((entry) => entry?.seatId === seat.seatId)
      || (reviewFeedbacks[index]?.seatId ? null : reviewFeedbacks[index]);
    return matched ? { ...seat, ...matched } : { ...seat, status: "pending" };
  });
  $("#modelTeamCards")?.parentElement?.querySelector(".phase-rail")?.remove();
  $("#modelTeamCards")?.insertAdjacentHTML("beforebegin", phaseRail);
  $("#modelTeamCards").className = `model-team-cards${state.runPhase === "authoring" || state.runPhase === "reviewing" ? " is-breathing" : ""}`;
  const authorCard = `<div class="model-card is-primary" aria-label="主笔执行状态"><i></i><span><strong>主笔</strong><small>完整产物 · 只负责写作</small></span><em>${escapeHtml(primaryExecution.actualModel ? "已完成" : state.runPhase === "authoring" ? "执行中" : "待执行")}</em></div>`;
  $("#modelTeamCards").innerHTML = authorCard + reviewTeam.map((entry) => {
    const modelId = entry.actualModel || entry.requiredModel || "";
    const meta = modelInfo(modelId);
    const provider = entry.provider || meta.provider;
    const configured = entry.status === "failed" ? false : (entry.configured ?? true) && status[provider]?.configured !== false;
    const lane = roleLabels[entry.role] || roleLabels[seatDefaults.find((seat) => seat.seatId === entry.seatId)?.role] || "独立交叉审查";
    const stateLabel = entry.status === "failed"
      ? `未返回 · 技术未完成 · ${failureReasons[entry.failureReason] || entry.failureReason || "调用失败"}`
      : !configured
        ? "审核未接入"
        : entry.status === "completed"
        ? entry.pass ? "已完成" : "已完成 · 需修订"
        : currentReview
          ? "待复审"
          : "待审核";
    const scoreLabel = entry.status === "failed" ? "—" : entry.status === "completed" && entry.score !== null && entry.score !== undefined ? `${entry.score} 分` : "—";
    const fallbackLabel = entry.actualModel && entry.requiredModel && entry.actualModel !== entry.requiredModel ? " · 已启用备用模型" : "";
    const seatId = entry.seatId || activeSeats.find((seat) => seat.role === entry.role)?.seatId || "";
    const reviewMode = requiredReviewSeats === 1 ? "规则校验后快速审读" : "阶段职责 · 独立交叉审查";
    return `<button class="model-card ${provider === "chatgpt" ? "is-primary" : provider === "claude" ? "is-reviewer" : ""}" type="button" data-model-detail="${escapeHtml(seatId)}" title="${escapeHtml(lane)}"><i></i><span><strong>${escapeHtml(lane)}</strong><small>${escapeHtml(roleDescriptions[seatId] || reviewMode)}${fallbackLabel}</small></span><em>${escapeHtml(scoreLabel)}<br>${escapeHtml(stateLabel)}</em></button>`;
  }).join("");
  $("#modelTeamCards")?.parentElement?.querySelector(".model-team-degraded")?.remove();
  if (currentReview?.content?.quorum?.degraded) {
    // Use the backend's message: it names the seats that actually collided. Which
    // pair collapses depends on which provider channel failed, so any hardcoded
    // seat pair here goes stale the moment the roster changes.
    const degradedNote = (currentReview.content.technicalFailures || []).find((item) => item?.status === "degraded")?.message
      || `${reviewModeLabelFor(state.stage, currentReview.content, currentArtifact)}不成立：有席位兜底到了同一模型`;
    $("#modelTeamCards").insertAdjacentHTML("beforebegin", `<p class="model-team-degraded">${escapeHtml(degradedNote)}</p>`);
  }
  $$('[data-fix-unit]').forEach((button) => button.addEventListener("click", () => {
    handleFixUnitClick(button);
  }));
  $$('[data-edit-unit]').forEach((button) => button.addEventListener("click", () => {
    handleEditUnitClick(button, stage);
  }));
  $$('[data-model-detail]').forEach((button) => button.addEventListener("click", () => {
    const lane = roleLabels[activeSeats.find((seat) => seat.seatId === button.dataset.modelDetail)?.role] || "独立交叉审查";
    showToast(`${lane} · ${button.querySelector("em")?.textContent?.replace("\n", " · ") || "待审核"}`);
  }));
}

function collectBriefInput() {
  syncBriefRanges();
  syncCreativeControls();
  syncMarketControls();
  const audienceGender = $("#audienceGender")?.value || state.input.audienceGender || "all";
  state.input = {
    ...state.input,
    platform: $("#platform")?.value || state.input.platform,
    audience: audienceGender,
    audienceGender,
    idea: $("#idea")?.value || "",
  };
  return state.input;
}

function marketCountryLabel(country = state.input.marketCountry) {
  return marketCatalog.find((item) => item[1] === country)?.[2] || "美国";
}

function marketCountryOptions(region, selected) {
  return marketCatalog
    .filter(([itemRegion]) => itemRegion === region)
    .map(([, value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}

function syncMarketControls() {
  const region = $("#marketRegion")?.value || state.input.marketRegion || "north_america";
  const country = $("#marketCountry")?.value || state.input.marketCountry || "united_states";
  state.input.marketRegion = region;
  state.input.marketCountry = country;
  state.input.localizationNote = $("#localizationNote")?.value.trim() || state.input.localizationNote || "";
}

function updateMarketCountryList() {
  const region = $("#marketRegion")?.value || "north_america";
  const countrySelect = $("#marketCountry");
  if (!countrySelect) return;
  const existingCountry = countrySelect.value;
  const countries = marketCatalog.filter(([itemRegion]) => itemRegion === region);
  const nextCountry = countries.some(([, value]) => value === existingCountry) ? existingCountry : countries[0]?.[1] || "united_states";
  countrySelect.innerHTML = marketCountryOptions(region, nextCountry);
  state.input.marketRegion = region;
  state.input.marketCountry = nextCountry;
}

function setDnaFilter(filter = "all") {
  state.dnaFilter = filter;
  $$('[data-dna-filter]').forEach((button) => {
    const active = button.dataset.dnaFilter === filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$('[data-dna-tag]').forEach((tag) => {
    tag.classList.toggle("is-filtered-out", filter !== "all" && tag.dataset.dnaKind !== filter);
  });
}

function toggleDnaWindow(open) {
  const windowNode = $("#dnaWindow");
  if (!windowNode) return;
  const nextOpen = typeof open === "boolean" ? open : windowNode.hidden;
  $$('[data-dna-toggle]').forEach((button) => button.setAttribute("aria-expanded", String(nextOpen)));
  if (nextOpen) {
    windowNode.hidden = false;
    requestAnimationFrame(() => windowNode.classList.add("is-open"));
    return;
  }
  windowNode.classList.remove("is-open");
  window.setTimeout(() => {
    if (!windowNode.classList.contains("is-open")) windowNode.hidden = true;
  }, 280);
}

function renderInspirationPool() {
  const audienceGender = audienceGenderLabels[state.input.audienceGender] ? state.input.audienceGender : "all";
  const recommended = dnaAudienceRecommendations[audienceGender] || new Set();
  const categories = ["all", ...[...new Set(inspirationPool.map((item) => item.kind))]];
  const filterLabels = { all: "全部", "题材": "题材", "爽点": "爽点", "爆火基因": "爆点", "叙事逻辑": "叙事", "主角身份": "主角", "情绪关系": "关系", "冲突机制": "冲突", "世界设定": "世界", "视觉风格": "视觉", "时代": "时代" };
  const filters = categories.map((category) => `<button type="button" class="dna-filter${state.dnaFilter === category ? " is-active" : ""}" data-dna-filter="${escapeHtml(category)}" role="tab" aria-selected="${state.dnaFilter === category}">${escapeHtml(filterLabels[category] || category)}</button>`).join("");
  const tags = inspirationPool.map((item, index) => `<button class="dna-tag${recommended.has(item.keyword) ? " is-recommended" : ""}${state.dnaFilter !== "all" && state.dnaFilter !== item.kind ? " is-filtered-out" : ""}" type="button" data-inspiration="${escapeHtml(item.keyword)}" data-dna-tag data-dna-kind="${escapeHtml(item.kind)}" title="添加“${escapeHtml(item.keyword)}”到创作想法"><span>${escapeHtml(item.keyword)}</span><small>${escapeHtml(item.kind)}</small></button>`).join("");
  const recommendation = audienceGender === "all" ? "受众推荐待命" : `${audienceGenderLabels[audienceGender]} · ${recommended.size} 个高亮标签`;
  return `<section class="dna-module" aria-labelledby="dnaLauncherTitle"><button type="button" class="dna-launcher" data-dna-toggle aria-expanded="false" aria-controls="dnaWindow"><span class="dna-launcher-orb" aria-hidden="true"><i></i><b></b><em></em></span><span class="dna-launcher-copy"><span class="card-label"><i></i>STORY DNA</span><strong id="dnaLauncherTitle">打开灵感 DNA</strong><small>${inspirationPool.length} 个标签 · ${escapeHtml(recommendation)}</small></span><span class="dna-launcher-arrow" aria-hidden="true">↗</span></button><div id="dnaWindow" class="dna-window" hidden><div class="dna-window-head"><div><span class="card-label"><i></i>NEURAL FIELD</span><h3>思维模式</h3><p>题材、爽点、爆点、叙事与主角身份的连接场。</p></div><button type="button" class="dna-close" data-dna-toggle aria-expanded="false" aria-controls="dnaWindow" title="收起灵感 DNA">×</button></div><div class="dna-filter-strip" role="tablist" aria-label="DNA 标签分类">${filters}</div><div class="dna-field" data-dna-field><div class="dna-tag-layer" role="list">${tags}</div></div><div class="dna-window-foot"><span>NETFLIX · HBO · SONY PICTURES TV</span><span>SELECT TAG TO ADD</span></div></div></section>`;
}

function addInspirationToIdea(keyword) {
  const field = $("#idea");
  if (!field || !keyword) return;
  const prefix = "灵感关键词：";
  const current = field.value.trim();
  const terms = current.startsWith(prefix) ? current.slice(prefix.length).split(/[、，,]/).map((item) => item.trim()).filter(Boolean) : [];
  if (terms.includes(keyword)) {
    showToast(`“${keyword}”已经在创作想法中`);
    return;
  }
  const idea = current && !current.startsWith(prefix) ? `${current}\n\n${prefix}${keyword}` : `${prefix}${[...terms, keyword].join("、")}`;
  field.value = idea;
  state.input.idea = idea;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  showToast(`已加入灵感关键词：${keyword}`);
}

function creativeControlOptions() {
  return state.mode === "long"
    ? {
      openingPromise: [["mainline_promise", "主线承诺"], ["character_crisis", "人物危机"], ["world_mystery", "世界谜题"]],
      hookCadence: [["every_episode", "每章转折"], ["double_hook", "每章双转折"], ["key_unit", "关键章钩子"]],
    }
    : {
      openingPromise: [],
      hookCadence: [["every_episode", "每集强钩子"], ["double_hook", "每集双钩"], ["key_unit", "关键集钩子"]],
    };
}

function selectOptions(options, selected) {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function creativeControlValues() {
  const options = creativeControlOptions();
  const impact = Math.min(5, Math.max(0, Number(state.input.openingImpactSeconds) || 3));
  const openingPromise = state.input.openingPromise || options.openingPromise[0]?.[0] || "mainline_promise";
  const hookCadence = state.input.hookCadence || options.hookCadence[0][0];
  const dialogueMode = state.input.dialogueMode || "localized_english";
  const handoffScope = state.input.handoffScope || "confirmed_versioned";
  return { impact, openingPromise, hookCadence, dialogueMode, handoffScope, options };
}

function syncCreativeControls() {
  const values = creativeControlValues();
  const impactRange = $("#openingImpactRange");
  const openingPromise = $("#openingPromise");
  const hookCadence = $("#hookCadence");
  const dialogueMode = $("#dialogueMode");
  const handoffScope = $("#handoffScope");
  const nextImpact = Number(impactRange?.value ?? values.impact);
  state.input.openingImpactSeconds = Number.isFinite(nextImpact) ? Math.min(5, Math.max(0, nextImpact)) : values.impact;
  if (openingPromise) state.input.openingPromise = openingPromise.value;
  if (hookCadence) state.input.hookCadence = hookCadence.value;
  if (dialogueMode) state.input.dialogueMode = dialogueMode.value;
  if (handoffScope) state.input.handoffScope = handoffScope.value;
  if (impactRange) impactRange.value = String(state.input.openingImpactSeconds);
  $("#openingImpactValue")?.replaceChildren(document.createTextNode(`0-${state.input.openingImpactSeconds}s`));
}

async function persistCreativeSettings() {
  try {
    const payload = await request("/settings", {
      method: "POST",
      body: JSON.stringify({ mode: modeValue(), routes: state.routes, input: state.input }),
    });
    updateAgentState(payload.agent);
    $("#saveStatus").innerHTML = "<i></i>已保存";
  } catch (error) {
    showToast(`参数保存失败：${error.message}`);
  }
}

function briefRangeConfig() {
  return state.mode === "long"
    ? { episode: { min: 4, max: 24, step: 1, fallback: 8, unit: "章" }, duration: { min: 5, max: 60, step: 1, fallback: 10, unit: "分钟" } }
    : { episode: { min: 3, max: 60, step: 1, fallback: 24, unit: "集" }, duration: { min: 15, max: 180, step: 5, fallback: 60, unit: "秒" } };
}

function briefRangeValues() {
  const config = briefRangeConfig();
  const episodeCount = Math.min(config.episode.max, Math.max(config.episode.min, Number(state.input.episodeCount) || config.episode.fallback));
  const durationValue = Math.min(config.duration.max, Math.max(config.duration.min, Number(state.input.durationValue) || config.duration.fallback));
  return { config, episodeCount, durationValue };
}

function syncBriefRanges() {
  const { config, episodeCount, durationValue } = briefRangeValues();
  const episodeRange = $("#episodeScaleRange");
  const durationRange = $("#durationRange");
  const nextEpisodeCount = Number(episodeRange?.value || episodeCount);
  const nextDurationValue = Number(durationRange?.value || durationValue);
  state.input.episodeCount = nextEpisodeCount;
  state.input.durationValue = nextDurationValue;
  state.input.durationUnit = state.mode === "long" ? "min" : "sec";
  state.input.episodeScale = `${nextEpisodeCount} ${state.mode === "long" ? "chapters" : "episodes"}`;
  state.input.duration = `${nextDurationValue} ${state.mode === "long" ? "min" : "sec"}`;
  if (episodeRange) {
    episodeRange.min = config.episode.min;
    episodeRange.max = config.episode.max;
    episodeRange.step = config.episode.step;
    episodeRange.value = String(nextEpisodeCount);
  }
  if (durationRange) {
    durationRange.min = config.duration.min;
    durationRange.max = config.duration.max;
    durationRange.step = config.duration.step;
    durationRange.value = String(nextDurationValue);
  }
  $("#episodeScaleValue").textContent = `${nextEpisodeCount} ${config.episode.unit}`;
  $("#durationValue").textContent = `${nextDurationValue} ${config.duration.unit}`;
  $("#episodeScaleMin").textContent = `${config.episode.min} ${config.episode.unit}`;
  $("#episodeScaleMax").textContent = `${config.episode.max} ${config.episode.unit}`;
  $("#durationMin").textContent = `${config.duration.min} ${config.duration.unit}`;
  $("#durationMax").textContent = `${config.duration.max} ${config.duration.unit}`;
}

function renderCreativeControls() {
  const long = state.mode === "long";
  const { impact, openingPromise, hookCadence, dialogueMode, handoffScope, options } = creativeControlValues();
  const opening = long
    ? `<label class="control-label" for="openingPromise">${long ? "开场承诺" : "开头暴击"}</label><select id="openingPromise" data-creative-control>${selectOptions(options.openingPromise, openingPromise)}</select>`
    : `<div class="control-heading"><label for="openingImpactRange">开头暴击窗口</label><output id="openingImpactValue" for="openingImpactRange">0-${impact}s</output></div><input id="openingImpactRange" class="control-range" type="range" min="0" max="5" step="1" value="${impact}" /><div class="control-scale"><span>0s</span><span>5s</span></div>`;
  return `<section class="metric-stack creative-controls" aria-label="可调整创作参数">
    <div class="metric-card control-card accent">${opening}</div>
    <div class="metric-card control-card lime"><label class="control-label" for="hookCadence">${long ? "章节推进" : "每集钩子"}</label><select id="hookCadence" data-creative-control>${selectOptions(options.hookCadence, hookCadence)}</select></div>
    <div class="metric-card control-card"><label class="control-label" for="dialogueMode">对白策略</label><select id="dialogueMode" data-creative-control>${selectOptions([["zh_story_zh_localized_dialogue", "中文口语化本土化"], ["localized_english", "英文口语化本土化"], ["localized_english_sharp", "英文强口语 / 强冲突"], ["localized_english_subtle", "英文克制 / 低解释"]], dialogueMode)}</select></div>
    <div class="metric-card control-card"><label class="control-label" for="handoffScope">输出范围</label><select id="handoffScope" data-creative-control>${selectOptions([["confirmed_versioned", "剧本"], ["script_and_assets", "剧本 + 视觉资产"]], handoffScope)}</select></div>
  </section>`;
}

function renderBriefArtifact() {
  const artifact = artifactForStage("brief");
  if (!artifact) return "";
  const review = reviewForArtifact(artifact);
  const reviewContent = review?.content || {};
  const passed = artifact.status === "ready" && reviewContent.pass !== false;
  const status = passed ? "已生成 · 复核通过 · 待确认" : review ? "已生成 · 复核未通过" : "已生成 · 等待复核";
  const reviewMode = reviewModeLabelFor("brief", reviewContent, artifact);
  const reviewPanel = review ? renderReviewPanel(reviewContent, { passed, stage: "brief" }) : `<div class="review-summary"><strong>正在等待复核结果</strong><p>${reviewMode}完成后，这里会显示完整问题清单。</p></div>`;
  return `<section class="artifact-card live-artifact brief-result" aria-labelledby="briefResultTitle"><div class="stage-kicker"><span class="card-label"><i></i>STORY ARCHITECTURE</span><span class="artifact-meta">v${escapeHtml(artifact.version)} · ${escapeHtml(status)}</span></div><h3 id="briefResultTitle">故事架构生成结果</h3><div class="structured-content">${renderValue(artifact.content)}</div>${reviewPanel}</section>`;
}

function renderBrief() {
  const long = state.mode === "long";
  const idea = state.input.idea || "";
  const audienceGender = audienceGenderLabels[state.input.audienceGender] ? state.input.audienceGender : "all";
  const { config, episodeCount, durationValue } = briefRangeValues();
  const marketRegion = state.input.marketRegion || "north_america";
  const marketCountry = state.input.marketCountry || "united_states";
  const platform = state.input.platform || "TikTok / TikTok Series";
  return `
    <div class="content-grid">
      <section class="form-panel">
        <h3>故事架构</h3>
        <div class="form-row"><div class="field"><label for="platform">发布平台</label><select id="platform">${["抖音 / 国内短视频","TikTok / TikTok Series","YouTube Shorts","Web drama"].map((p) => `<option value="${p}" ${platform === p ? "selected" : ""}>${p}</option>`).join("")}</select></div><div class="field"><label for="audienceGender">目标受众</label><select id="audienceGender" aria-label="目标受众"><option value="all" ${audienceGender === "all" ? "selected" : ""}>全部</option><option value="male" ${audienceGender === "male" ? "selected" : ""}>男性</option><option value="female" ${audienceGender === "female" ? "selected" : ""}>女性</option></select></div></div>
        <div class="market-panel"><div class="market-panel-head"><span class="card-label"><i></i>MARKET LOCALIZATION</span><strong>投放市场决定人名、地名与社会语境</strong></div><div class="form-row"><div class="field"><label for="marketRegion">受众地区</label><select id="marketRegion">${selectOptions(Object.entries(marketRegionLabels), marketRegion)}</select></div><div class="field"><label for="marketCountry">投放国家 / 地区</label><select id="marketCountry">${marketCountryOptions(marketRegion, marketCountry)}</select></div></div><div class="field"><label for="localizationNote">本土化补充 <span class="optional">可选</span></label><input id="localizationNote" value="${escapeHtml(state.input.localizationNote || "")}" placeholder="例如：芝加哥蓝领社区、伦敦金融区或曼谷大学校园" /></div></div>
        <div class="form-row"><div class="field slider-field"><div class="slider-label"><label for="episodeScaleRange">${long ? "章节数量" : "计划集数"}</label><output id="episodeScaleValue" for="episodeScaleRange">${episodeCount} ${config.episode.unit}</output></div><input id="episodeScaleRange" type="range" min="${config.episode.min}" max="${config.episode.max}" step="${config.episode.step}" value="${episodeCount}" /><div class="slider-scale"><span id="episodeScaleMin">${config.episode.min} ${config.episode.unit}</span><span id="episodeScaleMax">${config.episode.max} ${config.episode.unit}</span></div></div><div class="field slider-field"><div class="slider-label"><label for="durationRange">${long ? "单章时长" : "单集时长"}</label><output id="durationValue" for="durationRange">${durationValue} ${config.duration.unit}</output></div><input id="durationRange" type="range" min="${config.duration.min}" max="${config.duration.max}" step="${config.duration.step}" value="${durationValue}" /><div class="slider-scale"><span id="durationMin">${config.duration.min} ${config.duration.unit}</span><span id="durationMax">${config.duration.max} ${config.duration.unit}</span></div></div></div>
        <div class="field"><label for="idea">创作想法 <span aria-hidden="true">*</span></label><textarea id="idea" placeholder="用中文写下主角、欲望和核心冲突">${escapeHtml(idea)}</textarea><p class="small-note">中文描述剧情；英文对白会在对白阶段完成口语化本土化，不做逐句直译。</p></div>
        <div id="briefError" class="error-message ${state.lastError ? "is-visible" : ""}" role="alert">${escapeHtml(state.lastError || "先写下一个可识别的冲突，PixelTale 才能建立故事架构。")}</div>
      </section>
      ${renderCreativeControls()}
    </div>
    ${renderBriefArtifact()}
    ${renderInspirationPool()}`;
}

const fieldLabelMap = {
  title_zh: "剧名",
  title_en: "英文正式剧名",
  explanation_zh: "中文释义",
  logline_zh: "一句话梗概",
  core_conflict_zh: "核心冲突",
  viewer_question_zh: "观众悬念",
  episode_promise_zh: "单集承诺",
  mode_rules: "模式规则",
  candidates: "剧名候选",
  style_zh: "风格标签",
  tone_zh: "语气与气质",
  reason_zh: "命名理由",
  naming_gene_zh: "命名基因",
  selection_note_zh: "选择建议",
  premise_zh: "核心命题",
  protagonist_goal_zh: "主角目标",
  antagonistic_force_zh: "对抗力量",
  season_or_series_engine_zh: "持续推进引擎",
  first_impact_zh: "开头暴击",
  episode_hook_zh: "集尾钩子",
  reversal: "反转",
  characters: "人物",
  relationships: "人物关系",
  world_rules: "世界规则",
  id: "编号",
  name_zh: "角色名",
  name_en: "英文名",
  role: "角色定位",
  desire_zh: "欲望",
  fear_zh: "恐惧",
  secret_zh: "秘密",
  arc_zh: "人物弧线",
  voice_rules_en: "声线规则",
  visual_profile: "视觉设定",
  gender: "性别",
  age_phase: "年龄阶段",
  body: "体型",
  hair_color: "发型与发色",
  facial_features: "面部特征",
  eye_color: "瞳色",
  costume_accessories: "服装配饰",
  palette: "识别色",
  posture: "姿态气质",
  prompt_zh: "中文生成提示词",
  from: "关系起点",
  to: "关系终点",
  dynamic_zh: "关系变化",
  unit: "单位",
  units: "分集 / 章节",
  number: "序号",
  promise_zh: "本集承诺",
  impact_zh: "开头冲击",
  causal_turn_zh: "因果转折",
  hook_zh: "集尾强钩子",
  cliffhanger_question_zh: "悬念问题",
  payoff_zh: "推进与回收",
  arc_summary_zh: "整体推进",
  scenes: "场景",
  unit_number: "集 / 章编号",
  purpose_zh: "场景目的",
  location_zh: "地点",
  action_zh: "动作推进",
  visual_intent_zh: "画面意图",
  recurring: "是否重复出现",
  aliases: "别名",
  indoor_outdoor: "室内外",
  lighting: "光线",
  materials: "材质",
  layout: "空间布局",
  atmosphere: "氛围",
  props: "道具",
  description_zh: "描述",
  appearance: "外观",
  size: "尺寸",
  texture: "质感",
  shot_plan: "镜头计划",
  shot_id: "镜头编号",
  type: "类型",
  duration_seconds: "时长（秒）",
  dialogue_refs: "对白引用",
  lines: "对白",
  scene_id: "场景编号",
  speaker: "说话人",
  intent_zh: "剧情意图",
  dialogue_en: "英文对白",
  subtext_zh: "潜台词",
  delivery_en: "表演提示",
  localization_checks: "本土化检查",
  script_summary_zh: "剧本主线",
  episodes: "完整剧本分集",
  opening_impact_zh: "开头暴击",
  plot_summary_zh: "本集剧情",
  time_zh: "时间",
  conflict_zh: "场面冲突",
  choice_zh: "人物选择",
  result_zh: "选择结果",
  turn_zh: "因果转折",
  impact_zh: "开头冲击",
  causal_turn_zh: "因果转折",
  reversal_zh: "反转",
  hook_zh: "集尾钩子",
  cliffhanger_question_zh: "悬念问题",
  payoff_zh: "回收",
  rhythm_signals: "节奏信号",
  consistency_notes: "一致性说明",
};

function fieldLabel(key) {
  const raw = String(key || "");
  if (fieldLabelMap[raw]) return fieldLabelMap[raw];
  return raw.replace(/_(?:zh|en)$/i, "").replaceAll("_", " ");
}

function renderValue(value, depth = 0) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return `<span class="value-text">${escapeHtml(value)}</span>`;
  if (Array.isArray(value)) return `<ul class="structured-list">${value.map((item) => `<li>${renderValue(item, depth + 1)}</li>`).join("")}</ul>`;
  if (depth > 4) return `<span class="value-text">${escapeHtml(JSON.stringify(value))}</span>`;
  return `<dl class="structured-data">${Object.entries(value).map(([key, item]) => `<div><dt>${escapeHtml(fieldLabel(key))}</dt><dd>${renderValue(item, depth + 1)}</dd></div>`).join("")}</dl>`;
}

function advisoryItemId(kind, item = {}, index = 0) {
  const source = item.id || item.criterionId || item.criterion_id || item.tag || item.dimension || item.model || index;
  return `advisory_${kind}_${String(source).toLowerCase().replace(/[\s：:，,。.!?！？；;]/g, "") || index}`;
}

const reviewConflictGuidance = {
  structure: {
    title: "先核对故事骨架是否兑现本阶段承诺",
    recommendation: "优先保留主线承诺更明确、信息推进更有层次、且不会提前消耗后续悬念的版本。",
    checks: ["核对开场是否建立了本阶段承诺", "核对每个转折是否改变主角的选择空间", "核对新增内容是否属于当前阶段，而不是提前写后续资产"],
    decision: "证据同等时，选择新增设定更少、因果链更清楚、后续更容易执行的版本。",
  },
  plot: {
    title: "先核对人物行动与剧情推进",
    recommendation: "优先保留由主角主动选择推动、并且同时产生代价或新问题的剧情版本，不以情绪描述替代事件推进。",
    checks: ["核对主角目标是否具体可执行", "核对阻力是否迫使主角做出选择", "核对选择是否带来可验证的结果、代价或新悬念"],
    decision: "不要按评分高低直接取舍；选择能让下一步继续推进、且不依赖额外解释的因果链。",
  },
  design: {
    title: "先核对发行属性与受众适配",
    recommendation: "优先保留符合目标市场、受众方向和当前剧作模式的设计；TK 短剧要优先保证开头冲击与追更钩子。",
    checks: ["核对内容是否符合已选市场的人名、地名和社会语境", "核对节奏是否符合 TK 短剧或普通长剧模式", "核对设计是否服务冲突与人物，而不是只增加风格包装"],
    decision: "若两版质量接近，选择更符合发行属性、能被后续场景和对白阶段直接落地的版本。",
  },
  logic: {
    title: "先核对事实、因果和已确认规则",
    recommendation: "优先保留证据闭合、前后不矛盾、并且不新增未经确认设定的版本。",
    checks: ["列出触发事件、人物行动和结果之间的因果链", "核对是否违反已确认的人物、世界或市场规则", "标出仍缺证据的前提，不要用解释性台词掩盖缺口"],
    decision: "出现硬冲突时，以已确认上下文和用户规格为最高优先级，再处理模型之间的评分差异。",
  },
};

function conflictGuidanceFor(dimension = "logic", scores = []) {
  const base = reviewConflictGuidance[dimension] || reviewConflictGuidance.logic;
  const numericScores = Array.isArray(scores) ? scores.map(Number).filter(Number.isFinite) : [];
  const spread = numericScores.length > 1 ? Math.max(...numericScores) - Math.min(...numericScores) : 0;
  return {
    ...base,
    scoreHint: spread ? `当前模型评分相差 ${spread} 分，先核对证据，不要直接按平均分拍板。` : "当前评分证据不足，先核对审核依据再决定。",
  };
}

function reviewAdvisoryItems(reviewContent = {}) {
  const makeUniqueIds = (items, kind) => {
    const seen = new Map();
    return items.map((item, index) => {
      const baseId = item.id || advisoryItemId(kind, item, index);
      const occurrence = seen.get(baseId) || 0;
      seen.set(baseId, occurrence + 1);
      return { ...item, id: occurrence ? `${baseId}_${occurrence + 1}` : baseId };
    });
  };
  const independentIssues = makeUniqueIds((Array.isArray(reviewContent.independentIssues) ? reviewContent.independentIssues : []).map((item, index) => ({
    ...item,
    kind: "issue",
    severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "medium",
    suggestions: Array.isArray(item.suggestions) ? item.suggestions.filter(Boolean) : [],
    evidence: Array.isArray(item.evidence) ? item.evidence.filter(Boolean) : [],
  })), "issue");
  const conflicts = makeUniqueIds((Array.isArray(reviewContent.conflicts) ? reviewContent.conflicts : []).map((item, index) => ({
    ...item,
    kind: "conflict",
    severity: "medium",
    suggestions: item.suggestion ? [item.suggestion] : [],
    evidence: Array.isArray(item.scores) && item.scores.length ? [`模型评分：${item.scores.join(" / ")}`] : [],
    guidance: item.guidance || conflictGuidanceFor(item.dimension, item.scores),
  })), "conflict");
  const failedReviews = makeUniqueIds((Array.isArray(reviewContent.advisories?.failedReviews) ? reviewContent.advisories.failedReviews : []).map((item, index) => ({
    ...item,
    kind: "failed",
    severity: "low",
    suggestions: [],
    evidence: [item.message || "审核模型未返回审核意见"],
  })), "failed");
  return [...independentIssues, ...conflicts, ...failedReviews];
}

function reviewAdvisoryGate(reviewContent = {}) {
  const items = reviewAdvisoryItems(reviewContent);
  const decisions = new Map((Array.isArray(reviewContent.advisoryDecisions) ? reviewContent.advisoryDecisions : []).filter((item) => item?.id).map((item) => [item.id, item]));
  const accepted = items.filter((item) => decisions.get(item.id)?.status === "accepted");
  const blockingPending = items.filter((item) => {
    const decision = decisions.get(item.id);
    // Conflicts get no special case. An undecided score disagreement is resolved
    // automatically by the backend and must not gate confirmation; it blocks only
    // when the creator explicitly marked it for review. Mirrors the same rule in
    // server/pixeltale-agent.js — keep both in sync.
    return decision?.status === "needs_human_review";
  });
  return { items, decisions, accepted, blockingPending };
}

function isMandatoryReviewIssue(item = {}) {
  // Mirrors the backend rule: two independent models, OR the dimension owner
  // alone at high confidence (only one seat is qualified to judge its own
  // dimension, so requiring a second vote would disable that dimension).
  return item.severity === "high" && (Number(item.modelCount) >= 2 || item.ownerHighConfidence === true);
}

function reviewItemKey(item = {}) {
  return String(item.criterionId || item.criterion_id || item.id || item.tag || "").toLowerCase().replace(/[\s：:，,。.!?！？；;]/g, "") || "review-item";
}

function reviewGateIssues(reviewContent = {}) {
  const dimensionLabels = { structure: "结构", plot: "剧情", design: "设计", logic: "逻辑" };
  const dimensions = reviewContent.dimensions || {};
  const issues = Object.entries(dimensions).flatMap(([key, entry]) => {
    const score = Number(entry && typeof entry === "object" ? entry.average ?? entry.score : entry);
    if (!Number.isFinite(score) || score >= 75) return [];
    return [{
      id: `dimension_floor_${key}`,
      criterionId: `DIMENSION_FLOOR_${key.toUpperCase()}`,
      tag: `维度未达最低线：${dimensionLabels[key] || key}`,
      severity: "high",
      dimension: key,
      modelCount: Number(reviewContent.reviewPolicy?.requiredSeats) || 2,
      suggestions: [`${dimensionLabels[key] || key}维度平均分 ${Math.round(score)} < 75，需提升后重新审核`],
      evidence: entry && typeof entry === "object" && entry.feedback ? [entry.feedback] : [],
    }];
  });
  const quality = Number(reviewContent.quality ?? reviewContent.score);
  if (Number.isFinite(quality) && quality < 80) {
    issues.push({
      id: "quality_floor",
      criterionId: "QUALITY_FLOOR",
      tag: "整体质量未达最低线",
      severity: "high",
      dimension: "logic",
      modelCount: Number(reviewContent.reviewPolicy?.requiredSeats) || 2,
      suggestions: [`整体质量分 ${Math.round(quality)} < 80，需提升后重新审核`],
      evidence: [],
    });
  }
  return issues;
}

function mergeReviewItems(items = []) {
  const groups = new Map();
  const severityRank = { high: 0, medium: 1, low: 2 };
  items.forEach((item) => {
    const key = reviewItemKey(item);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...item,
        suggestions: [...new Set(Array.isArray(item.suggestions) ? item.suggestions.filter(Boolean) : [])].slice(0, 6),
        evidence: [...new Set(Array.isArray(item.evidence) ? item.evidence.filter(Boolean) : [])].slice(0, 6),
        models: [...new Set(Array.isArray(item.models) ? item.models.filter(Boolean) : [])],
      });
      return;
    }
    current.severity = (severityRank[item.severity] ?? 1) < (severityRank[current.severity] ?? 1) ? item.severity : current.severity;
    current.modelCount = Math.max(Number(current.modelCount) || 0, Number(item.modelCount) || 0);
    current.models = [...new Set([...current.models, ...(Array.isArray(item.models) ? item.models : [])].filter(Boolean))];
    current.suggestions = [...new Set([...current.suggestions, ...(Array.isArray(item.suggestions) ? item.suggestions : [])].filter(Boolean))].slice(0, 6);
    current.evidence = [...new Set([...current.evidence, ...(Array.isArray(item.evidence) ? item.evidence : [])].filter(Boolean))].slice(0, 6);
    current.requiresCreatorDecision = current.requiresCreatorDecision || item.requiresCreatorDecision === true;
    current.decisionOptions = [...new Set([...(Array.isArray(current.decisionOptions) ? current.decisionOptions : []), ...(Array.isArray(item.decisionOptions) ? item.decisionOptions : [])].filter(Boolean))].slice(0, 2);
    current.targetStage = current.targetStage || item.targetStage || "";
    current.targetStages = [...new Set([...(Array.isArray(current.targetStages) ? current.targetStages : []), ...(Array.isArray(item.targetStages) ? item.targetStages : []), ...(item.targetStage ? [item.targetStage] : [])].filter(Boolean))];
    current.relatedStage = current.relatedStage || item.relatedStage || "";
    current.acceptedByHuman = current.acceptedByHuman || item.acceptedByHuman;
  });
  return [...groups.values()];
}

function reviewIssueGroups(reviewContent = {}) {
  const advisoryGate = reviewAdvisoryGate(reviewContent);
  const acceptedAdvisories = advisoryGate.accepted
    .filter((item) => item.kind !== "failed")
    .map((item) => ({
      ...item,
      criterionId: item.criterionId || `ADVISORY_${item.id}`,
      tag: item.tag || `${item.dimension || "logic"} 建议已采纳`,
      modelCount: Number(item.modelCount) || 1,
      acceptedByHuman: true,
      suggestions: [...(Array.isArray(item.suggestions) ? item.suggestions : []), advisoryGate.decisions.get(item.id)?.reason].filter(Boolean),
    }));
  const pendingClosures = !creativeReviewDecisionGroups(reviewContent).length && Array.isArray(reviewContent.revision?.closure?.items)
    ? reviewContent.revision.closure.items.filter((item) => item.status !== "resolved").map((item) => ({
      ...item,
      tag: item.tag || "未关闭修订项",
      dimension: item.dimension || "logic",
      severity: item.severity || "medium",
      modelCount: Number(item.modelCount) || 2,
      models: item.models || [],
      suggestions: Array.isArray(item.remainingFix) && item.remainingFix.length ? item.remainingFix : [item.acceptance || "按原修订合同补齐并重新复审"],
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
    }))
    : [];
  const mandatoryIssues = Array.isArray(reviewContent.mandatoryIssues) && reviewContent.mandatoryIssues.length
    ? reviewContent.mandatoryIssues
    : (Array.isArray(reviewContent.commonIssues) ? reviewContent.commonIssues.filter(isMandatoryReviewIssue) : (Array.isArray(reviewContent.reviewIssues) ? reviewContent.reviewIssues.filter(isMandatoryReviewIssue) : []));
  const gateIssues = reviewGateIssues(reviewContent);
  const decisionIssues = reviewContent.decision?.kind === "revise" && Array.isArray(reviewContent.decision.items)
    ? reviewContent.decision.items
    : [];
  return mergeReviewItems([...pendingClosures, ...mandatoryIssues, ...gateIssues, ...decisionIssues, ...acceptedAdvisories]);
}

function reviewDecisionGroups(reviewContent = {}) {
  const structured = Array.isArray(reviewContent.decisionRequiredIssues) ? reviewContent.decisionRequiredIssues : [];
  const fallback = reviewContent.decision?.kind === "needs_decision" && Array.isArray(reviewContent.decision.items)
    ? reviewContent.decision.items
    : [];
  return mergeReviewItems([...structured, ...fallback]);
}

function creativeReviewDecisionGroups(reviewContent = {}) {
  return reviewDecisionGroups(reviewContent).filter((item) => item.requiresCreatorDecision === true && Array.isArray(item.decisionOptions) && item.decisionOptions.length >= 2);
}

function impactTargetsForStage(stage = state.stage) {
  const targets = {
    brief: ["故事承诺", "人物目标", "后续提案"],
    proposal: ["主角选择", "冲突升级", "分集主线"],
    characters: ["人物动机", "关系推进", "世界规则"],
    arc: ["人物关系", "后续分集", "终局回收"],
    scenes: ["场景目的", "镜头重点", "视觉资产"],
    dialogue: ["人物声线", "冲突表达", "正式剧本"],
  };
  return targets[stage] || ["当前产物", "下一阶段", "正式交付"];
}

function renderDecisionImpactWorkbench(reviewContent = {}, { stage = state.stage, reviewId = "" } = {}) {
  const decision = reviewContent.decision || {};
  const decisionIssues = creativeReviewDecisionGroups(reviewContent);
  const visible = decisionIssues.length > 0;
  if (!visible) return "";

  const workbenchId = reviewId || `${stage}-decision`;
  const selected = state.impactChoices[workbenchId] || "option_1";
  const focus = decisionIssues[0] || decision.items?.[0] || {};
  const title = focus.tag || focus.message || "当前取舍";
  const summary = focus.message || decision.summary || "先比较不同选择对已确认内容与下一阶段的影响，再执行唯一下一步。";
  const choices = focus.decisionOptions.slice(0, 2).map((option, index) => ({ id: `option_${index + 1}`, title: option, copy: "将此取舍写入创作历史，并按该方向继续。", state: `方案 ${index === 0 ? "A" : "B"}` }));
  const targets = impactTargetsForStage(stage);
  const outcomeCopy = {
    option_1: "下一步会以方案 A 为准，并记录选择理由。",
    option_2: "下一步会以方案 B 为准，并记录选择理由。",
  };
  const choiceMarkup = choices.map((choice, index) => `<button type="button" class="impact-choice${selected === choice.id ? " is-selected" : ""}" data-impact-choice="${choice.id}" data-impact-workbench="${escapeHtml(workbenchId)}" aria-pressed="${selected === choice.id}"><span class="impact-choice-number">0${index + 1}</span><span><strong>${escapeHtml(choice.title)}</strong><small>${escapeHtml(choice.copy)}</small></span><em>${escapeHtml(choice.state)}</em></button>`).join("");
  const impactMarkup = targets.map((target, index) => `<div class="impact-connection is-active" style="--impact-delay:${index * 70}ms"><span aria-hidden="true">→</span><article><small>后续影响 ${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtml(target)}</strong><p>会按当前选择同步取舍记录。</p></article></div>`).join("");
  return `<section class="decision-impact-workbench" aria-labelledby="impactWorkbenchTitle"><div class="impact-workbench-head"><div><span class="card-label"><i></i>DECISION IMPACT</span><h3 id="impactWorkbenchTitle">选择如何处理「${escapeHtml(title)}」</h3><p>${escapeHtml(summary)}</p></div><button type="button" class="text-button impact-evidence-button" data-impact-evidence aria-controls="reviewEvidence">查看依据</button></div><div class="impact-workbench-grid"><div class="impact-options" role="group" aria-label="处理路径">${choiceMarkup}</div><div class="impact-map" aria-live="polite"><div class="impact-map-origin"><small>当前选择</small><strong>${escapeHtml(choices.find((item) => item.id === selected)?.title || choices[0].title)}</strong><p>${escapeHtml(outcomeCopy[selected] || outcomeCopy.option_1)}</p></div><div class="impact-map-links">${impactMarkup}</div></div><aside class="impact-explainer"><span>为什么重要</span><strong>影响在执行前可见</strong><p>只在真实创作取舍出现时提供 A/B 选择。</p><small>选择路径 · 影响预览 · 执行确认</small></aside></div></section>`;
}

function reviewRecommendationGroups(reviewContent = {}) {
  const commonIssues = Array.isArray(reviewContent.recommendedIssues) && reviewContent.recommendedIssues.length
    ? reviewContent.recommendedIssues
    : (Array.isArray(reviewContent.commonIssues) ? reviewContent.commonIssues.filter((item) => Number(item.modelCount) >= 2 && !isMandatoryReviewIssue(item)) : []);
  return mergeReviewItems(commonIssues);
}

function renderAdvisoryCards(items = [], advisoryGate = {}, reviewId = "") {
  const decisions = advisoryGate.decisions || new Map();
  return items.map((item) => {
    const decision = decisions.get(item.id);
    const status = decision?.status || "pending";
    const source = item.kind === "conflict"
      ? `${Array.isArray(item.models) && item.models.length ? item.models.map((model, index) => `${model}${item.scores?.[index] !== undefined ? ` ${item.scores[index]}分` : ""}`).join(" / ") : "模型"} · 一致度 ${item.agreement ?? "-"}%`
      : item.kind === "failed"
        ? `${item.model || item.provider || "审核模型"} · 调用失败`
        : `${Array.isArray(item.models) && item.models.length ? item.models.join(" / ") : "单模型意见"}`;
    const statusLabel = status === "accepted" ? "已采纳 · 等待修订" : status === "ignored" ? "已忽略 · 已记录理由" : status === "needs_human_review" ? "待人工裁决" : item.kind === "failed" ? "审核未完成" : "待处理";
    const guidance = item.kind === "conflict" ? item.guidance || conflictGuidanceFor(item.dimension, item.scores) : null;
    const guidancePanel = guidance
      ? `<div class="review-advisory-guidance"><div class="review-advisory-guidance-title"><strong>审核建议</strong><span>${escapeHtml(guidance.title)}</span></div><p>${escapeHtml(guidance.recommendation)}</p><strong>核对指引</strong><ol>${guidance.checks.map((check) => `<li>${escapeHtml(check)}</li>`).join("")}</ol><p class="review-advisory-decision"><strong>决策规则</strong>${escapeHtml(guidance.decision)} ${escapeHtml(guidance.scoreHint)}</p></div>`
      : item.kind !== "failed" && item.suggestions?.length
        ? `<div class="review-advisory-guidance"><strong>审核建议</strong><ul>${item.suggestions.map((suggestion) => `<li>${escapeHtml(suggestion)}</li>`).join("")}</ul></div>`
        : "";
    const actions = ["pending", "needs_human_review"].includes(status) && item.kind !== "failed"
      ? `<div class="review-advisory-actions"><input type="text" data-advisory-reason placeholder="${item.kind === "conflict" ? "补充裁决依据或修改边界（必填）" : "保留当前版本时填写理由"}" aria-label="${escapeHtml(item.tag || item.dimension || "审核建议")}处理说明"${item.kind === "conflict" ? " required" : ""}><button type="button" class="stage-secondary" data-advisory-decision="accepted" data-advisory-requires-reason="${item.kind === "conflict" ? "true" : "false"}" data-review-id="${escapeHtml(reviewId)}" data-advisory-id="${escapeHtml(item.id)}">${item.kind === "conflict" ? "按此方向修订" : "采纳并修订"}</button><button type="button" class="text-button" data-advisory-decision="ignored" data-review-id="${escapeHtml(reviewId)}" data-advisory-requires-reason="false" data-advisory-id="${escapeHtml(item.id)}">保留当前版本</button></div>`
      : "";
    return `<article class="review-advisory-item is-${escapeHtml(status)}" data-advisory-item="${escapeHtml(item.id)}"><div class="review-advisory-top"><div><span class="review-advisory-kind">${escapeHtml(item.kind === "conflict" ? "评分分歧" : item.kind === "failed" ? "运行状态" : "单模型建议")}</span><strong>${escapeHtml(item.tag || item.dimension || item.model || "审核建议")}</strong></div><em>${escapeHtml(statusLabel)}</em></div><p class="review-advisory-source">${escapeHtml(source)}</p>${guidancePanel}${item.evidence?.length ? `<details><summary>查看证据</summary><ul>${item.evidence.map((evidence) => `<li>${escapeHtml(evidence)}</li>`).join("")}</ul></details>` : ""}${decision?.reason ? `<p class="review-advisory-decision-note">处理说明：${escapeHtml(decision.reason)}</p>` : ""}${actions}</article>`;
  }).join("");
}

function pulseUnitsForArtifact(artifact) {
  const content = artifact?.content || {};
  const source = Array.isArray(content.units)
    ? content.units
    : Array.isArray(content.episodes)
      ? content.episodes
      : Array.isArray(content.scenes)
        ? content.scenes
        : [];
  return source
    .map((unit, index) => ({ ...unit, pulseNumber: Number(unit?.number ?? unit?.unit_number ?? unit?.episode_number ?? index + 1) }))
    .filter((unit) => Number.isInteger(unit.pulseNumber) && unit.pulseNumber > 0 && unit.pulseNumber <= 30)
    .sort((left, right) => left.pulseNumber - right.pulseNumber);
}

function pulseText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("；");
  if (value && typeof value === "object") return value.title_zh || value.summary_zh || value.text_zh || "";
  return value == null ? "" : String(value);
}

function pulseSignalValue(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  }
  return null;
}

function rhythmSignalForUnit(unit) {
  const source = Array.isArray(unit?.rhythm_signals) ? unit.rhythm_signals[0] : unit?.rhythm_signals;
  if (!source || typeof source !== "object") return null;
  return {
    tension: pulseSignalValue(source, ["tension", "tension_score", "tension_zh_score"]),
    emotion: pulseSignalValue(source, ["emotion", "emotion_score", "emotional_intensity"]),
    highlight: pulseSignalValue(source, ["highlight", "highlight_score", "impact"]),
  };
}

function pulseEventsForUnit(unit) {
  return [
    ["hook", "钩子", pulseText(unit?.hook_zh || unit?.cliffhanger_question_zh)],
    ["reversal", "反转", pulseText(unit?.reversal_zh || unit?.causal_turn_zh)],
    ["payoff", "回收", pulseText(unit?.payoff_zh)],
    ["highlight", "高光", pulseText(unit?.impact_zh || unit?.highlight_zh)],
  ].filter(([, , detail]) => detail);
}

function renderPulseNode(number, type, label, detail) {
  return `<button type="button" class="pulse-node is-${type}" data-pulse-node data-pulse-episode="${number}" data-pulse-type="${escapeHtml(type)}" data-pulse-label="${escapeHtml(label)}" data-pulse-detail="${escapeHtml(detail)}" aria-label="第 ${number} 集 ${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

function renderStoryPulse(artifact) {
  const units = pulseUnitsForArtifact(artifact);
  if (!units.length) {
    return `<section class="story-pulse is-empty" aria-labelledby="storyPulseTitle"><div class="story-pulse-head"><div><span class="card-label"><i></i>STORY PULSE</span><h3 id="storyPulseTitle">剧情脉冲</h3></div><span class="story-pulse-range">01—30 集</span></div><div class="story-pulse-empty"><strong>尚未生成剧情脉冲</strong><p>生成分集产物后，这里会显示钩子、反转与回收节点。</p></div></section>`;
  }
  const unitByNumber = new Map(units.map((unit) => [unit.pulseNumber, unit]));
  const tracks = [["hook", "钩子"], ["reversal", "反转"], ["payoff", "回收"], ["highlight", "高光"]];
  const axis = Array.from({ length: 30 }, (_, index) => `<span>${String(index + 1).padStart(2, "0")}</span>`).join("");
  const trackMarkup = tracks.map(([type, label]) => {
    const cells = Array.from({ length: 30 }, (_, index) => {
      const number = index + 1;
      const unit = unitByNumber.get(number);
      const event = unit ? pulseEventsForUnit(unit).find(([eventType]) => eventType === type) : null;
      return `<span class="pulse-cell">${event ? renderPulseNode(number, event[0], event[1], event[2]) : ""}</span>`;
    }).join("");
    return `<div class="pulse-track"><strong>${label}</strong><div class="pulse-track-grid">${cells}</div></div>`;
  }).join("");
  const signals = units.map((unit) => ({ number: unit.pulseNumber, ...rhythmSignalForUnit(unit) })).filter((item) => item.tension !== null || item.emotion !== null || item.highlight !== null);
  const signalKey = signals.some((item) => item.tension !== null) ? "tension" : signals.some((item) => item.emotion !== null) ? "emotion" : signals.some((item) => item.highlight !== null) ? "highlight" : "";
  const linePoints = signalKey
    ? signals.filter((item) => item[signalKey] !== null).map((item) => `${24 + ((item.number - 1) / 29) * 952},${134 - (item[signalKey] / 100) * 100}`).join(" ")
    : "";
  const curve = linePoints ? `<svg class="pulse-curve" viewBox="0 0 1000 160" role="img" aria-label="剧情${signalKey === "tension" ? "张力" : signalKey === "emotion" ? "情绪" : "高光"}曲线"><line x1="24" y1="134" x2="976" y2="134" /><polyline points="${linePoints}" /><g>${signals.filter((item) => item[signalKey] !== null).map((item) => `<circle cx="${24 + ((item.number - 1) / 29) * 952}" cy="${134 - (item[signalKey] / 100) * 100}" r="3.5"><title>第 ${item.number} 集 · ${item[signalKey]}</title></circle>`).join("")}</g></svg>` : `<div class="pulse-no-curve">等待 rhythm_signals 数值；当前先显示真实的剧情节点。</div>`;
  return `<section class="story-pulse" aria-labelledby="storyPulseTitle"><div class="story-pulse-head"><div><span class="card-label"><i></i>STORY PULSE</span><h3 id="storyPulseTitle">剧情脉冲</h3><p>用一条时间轴看见每集的推进、悬念和回收。</p></div><span class="story-pulse-range">01—30 集</span></div><div class="pulse-chart"><div class="pulse-chart-label">${signalKey ? `${signalKey === "tension" ? "张力" : signalKey === "emotion" ? "情绪" : "高光"}曲线` : "剧情节点"}</div>${curve}<div class="pulse-axis">${axis}</div>${trackMarkup}</div><aside id="pulseInspector" class="pulse-inspector" aria-live="polite"><span class="card-label"><i></i>NODE INSPECTOR</span><strong data-pulse-inspector-title>选择一个节点</strong><p data-pulse-inspector-copy>点击钩子、反转、回收或高光节点，在固定检视区查看证据。</p><small data-pulse-inspector-meta>尚未选择 · 已载入 ${units.length} 集</small></aside></section>`;
}

function scoreFromDimension(value) {
  const candidate = typeof value === "number" ? value : value?.average ?? value?.score;
  const score = Number(candidate);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
}

function renderReviewScoreBars(reviewContent = {}) {
  const labels = { structure: "结构", plot: "剧情", design: "设计", logic: "逻辑" };
  const dimensions = reviewContent.dimensions || {};
  const rows = Object.entries(labels).map(([key, label]) => {
    const score = scoreFromDimension(dimensions[key]);
    const status = score === null ? "未评分" : score >= 75 ? "达标" : "低于门槛";
    return `<div class="review-score-row is-${score === null ? "unmeasured" : score >= 75 ? "pass" : "needs-review"}"><span class="review-score-label">${label}</span><div class="review-score-track" aria-label="${label}${score === null ? "未评分" : `${score} 分`}"><i style="width:${score === null ? 0 : score}%"></i><b style="left:75%"></b></div><strong>${score === null ? "—" : score}</strong><em>${status}</em></div>`;
  }).join("");
  return `<section class="review-score-bars" aria-labelledby="reviewScoreTitle"><div class="review-score-head"><div><span class="card-label"><i></i>QUALITY GATE</span><h3 id="reviewScoreTitle">多维评分</h3></div><span class="review-score-threshold">评分门槛 75</span></div><div class="review-score-list">${rows}</div><p class="review-score-note">未评分表示该维度没有有效测量，不等同于 0 分。</p></section>`;
}

function renderReviewPanel(reviewContent = {}, { passed = false, stage = state.stage, reviewId = "", showDecisionWorkbench = true } = {}) {
  const decision = reviewContent.decision || {
    kind: passed ? "approve" : "rerun",
    owner: "系统裁判",
    title: passed ? "通过" : "审核未完成",
    summary: passed ? "当前阶段可以确认。" : "等待有效审核结果。",
    items: [],
  };
  const mandatory = mergeReviewItems([...(Array.isArray(reviewContent.mandatoryIssues) ? reviewContent.mandatoryIssues : []), ...reviewGateIssues(reviewContent)]);
  const decisions = reviewDecisionGroups(reviewContent);
  const optional = mergeReviewItems([...(Array.isArray(reviewContent.recommendedIssues) ? reviewContent.recommendedIssues : []), ...(Array.isArray(reviewContent.independentIssues) ? reviewContent.independentIssues : [])]);
  const adjudications = Array.isArray(reviewContent.adjudications) ? reviewContent.adjudications : [];
  const feedbacks = Array.isArray(reviewContent.feedbacks) ? reviewContent.feedbacks : [];
  const reviewMode = reviewModeLabelFor(stage, reviewContent, artifactForStage(stage));
  const reviewOpinion = reviewOpinionLabelFor(stage, reviewContent, artifactForStage(stage));
  const technicalFailures = [...(Array.isArray(reviewContent.technicalFailures) ? reviewContent.technicalFailures : []), ...feedbacks.filter((item) => item.status === "failed")];
  const technical = technicalReviewState(reviewContent);
  const reasonLabels = { timeout: "请求超时", network_error: "网络错误", empty_response: "空响应", invalid_json: "返回格式错误", schema_error: "数据结构错误", not_configured: "模型未配置", stalled: "自动修订未收敛（同一问题连续出现）", new_high_risk: "修订引入新的高风险问题", budget_exhausted: "自动修订超出预算" };
  const issueMarkup = (items, empty) => items.length ? `<div class="review-issue-list">${items.map((item, index) => { const fixable = Number.isInteger(Number(item.unit)) && Number(item.unit) > 0 && !!item.fieldPath && (stage === "arc" || stage === "scenes"); const crossStage = item.targetStage && item.targetStage !== stage; const targetStage = crossStage ? `<small class="review-issue-target">修正归属：${escapeHtml(stageMeta[item.targetStage]?.title || item.targetStage)}；当前页不直接改写此问题</small>` : ""; const crossStageAction = crossStage && stageAccessible(item.targetStage) ? `<button type="button" class="stage-secondary cross-stage-repair-btn" data-cross-stage-open data-cross-stage="${escapeHtml(item.targetStage)}" data-cross-stage-source="${escapeHtml(stage)}">前往${escapeHtml(stageMeta[item.targetStage]?.title || item.targetStage)}处理 →</button>` : ""; return `<article class="review-issue review-issue-${escapeHtml(item.severity || "medium")}"><div class="review-issue-head"><span class="review-issue-index">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.tag || item.code || "审核意见")}</strong><span class="review-issue-severity">${escapeHtml(item.severity || "medium")}</span>${fixable ? `<button type="button" class="fix-unit-btn" data-fix-unit data-stage="${escapeHtml(stage)}" data-unit="${Number(item.unit)}" data-issue='${escapeHtml(JSON.stringify({ unit: Number(item.unit), field_path: item.fieldPath, tag: item.tag || "", feedback: item.feedback || "", fix: item.fix || "" }))}'>修复此集</button>` : ""}</div>${targetStage}${crossStageAction}${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}${Array.isArray(item.suggestions) && item.suggestions.length ? `<ul>${item.suggestions.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : item.fix ? `<p>${escapeHtml(item.fix)}</p>` : ""}</article>`; }).join("")}</div>` : `<p class="review-empty">${empty}</p>`;
  const adjudicationMarkup = adjudications.length ? `<div class="review-issue-list">${adjudications.map((item) => `<article class="review-adjudication"><strong>${escapeHtml(item.dimension || "未标注维度")}</strong><p>分歧度 ${escapeHtml(String(item.agreement ?? "—"))}% · 席位评分 ${escapeHtml((item.scores || []).join(" / "))}</p><p>证据来源：${escapeHtml((item.seats || []).join("、") || "审核席位")}</p><p>裁决依据：${escapeHtml(item.adjudication?.basis || "按证据强度与阶段契约自动裁决")}</p></article>`).join("")}</div>` : `<p class="review-empty">当前没有评分分歧，${reviewOpinion}可直接汇总。</p>`;
  const failureMarkup = technicalFailures.length ? `<div class="review-issue-list">${technicalFailures.map((item) => `<article class="review-technical-failure"><strong>${escapeHtml(item.seatId || "未标识席位")}</strong><p>未返回 · 技术未完成 · ${escapeHtml(reasonLabels[item.failureReason] || item.failureReason || item.message || "调用失败")}</p></article>`).join("")}</div>` : `<p class="review-empty">${reviewMode}未发现技术失败。</p>`;
  const degradedFlag = technical.degraded
    ? (technicalFailures.find((item) => item?.status === "degraded")?.message || `${reviewMode}不成立：有席位兜底到了同一模型`)
    : "";
  const technicalFlags = [degradedFlag, technical.stalled ? "自动修订已停止：stalled" : "", technical.budgetExhausted ? "自动修订已停止：budget_exhausted" : ""].filter(Boolean);
  const scoresMet = scoresMeetGate(reviewContent);
  const ruleBlockedOverride = technicalFailures.some((item) => item?.status === "rule_blocked") && !creativeReviewDecisionGroups(reviewContent).length
    ? `<button class="stage-primary agent-task-primary is-next-action" data-flow-action="human-override" data-human-override="${escapeHtml(stage)}" type="button">接受当前版本并继续</button><p class="review-technical-flags">规则拦截已阻断自动审核：只有你确认接受当前内容才能进入下一阶段。</p>`
    : "";
  // 2026-08-10：必修项存在时，审核证据区提供人工放行出口（不在右侧 rail 与唯一按钮并排）。
  // 评分达标但必修项反复不收敛时，用户可确认接受当前版本继续进入下一步。
  const mandatoryOverride = !ruleBlockedOverride && (mandatory.length || decisions.length) && !technical.blocked && scoresMet
    ? `<button class="stage-primary agent-task-primary review-zone-override" data-flow-action="human-override" data-human-override="${escapeHtml(stage)}" type="button">接受当前版本并继续</button><p class="review-technical-flags">存在必修项：可执行定向修订，或确认接受当前版本继续进入下一步（审核依据随版本保留）。</p>`
    : "";
  const decisionItems = reviewDecisionGroups(reviewContent);
  // 2026-08-10：把「执行定向修订」直接放到系统裁判决定卡上（用户在内容区先看到它，
  // 不再依赖右侧 rail 的下一步按钮才能发起修订）。
  const decisionRuleBlocked = (Array.isArray(reviewContent.technicalFailures) ? reviewContent.technicalFailures : [])
    .some((item) => item?.status === "rule_blocked");
  const decisionReviseButton = decision.kind === "revise" && !decisionRuleBlocked
    ? `<button type="button" class="stage-primary agent-task-primary is-next-action decision-revise-btn" data-flow-action="auto-revise" data-auto-revise="${escapeHtml(stage)}">执行定向修订 →</button>`
    : "";
  // 2026-08-10：决策卡放行出口——任何未通过状态（revise/rerun/needs_decision）都常显，
  // 不依赖具体字段（必修项可能在 mandatoryIssues / decision.items / pendingClosures 任一来源）。
  // 2026-08-10：评分必须达标才允许放行（低分只能修订/重跑）。
  const decisionOverride = decision.kind && decision.kind !== "approve" && !decisionRuleBlocked && scoresMet
    ? state.pendingHumanOverride === stage
      ? renderInlineHumanOverrideForm(stage)
      : `<button type="button" class="stage-secondary decision-override-btn" data-flow-action="human-override" data-human-override="${escapeHtml(stage)}">接受当前版本并继续</button>`
    : "";
  // 2026-08-10：重新生成当前阶段（runCurrentStage，用最新生成 prompt 覆盖重跑）。
  // 非通过的任何状态都可重跑——低分时用户可放弃当前版本重新生成。
  const regenerateButton = decision.kind && decision.kind !== "approve" && !passed
    ? `<button type="button" class="stage-secondary decision-regenerate-btn" data-flow-action="run" data-run-stage="${escapeHtml(stage)}">重新生成当前阶段 →</button>`
    : "";
  // 2026-08-10：needs_decision（跨阶段取舍，如场景名单与对白发言人不一致）时，
  // 在决定卡上直接给"选择方案并继续"，不再让用户误点"定向修订"（后者会被
  // REVISION_CONTRACT_EMPTY 拒绝）。
  const creativeDecisions = creativeReviewDecisionGroups(reviewContent);
  const decisionChoiceButton = decision.kind === "needs_decision" && creativeDecisions.length
    ? `<button type="button" class="stage-primary agent-task-primary is-next-action decision-revise-btn" data-flow-action="human-override" data-human-override="${escapeHtml(stage)}">选择方案并继续 →</button>`
    : "";
  const decisionCard = `<section class="review-decision-card is-${escapeHtml(decision.kind || "rerun")}"><span>系统裁判</span><div><h3>${escapeHtml(decision.title || "等待决定")}</h3><p>${escapeHtml(decision.summary || "等待审核结果")}</p></div>${decisionItems.length ? `<ol>${decisionItems.slice(0, 3).map((item) => `<li>${escapeHtml(item.tag || item.message || "待处理事项")}</li>`).join("")}</ol>` : ""}${decisionChoiceButton || decisionReviseButton}${decisionOverride}${regenerateButton}</section>`;
  return `<div class="review-summary ${passed ? "is-passed" : "is-needs-review"}">${decisionCard}${renderReviewScoreBars(reviewContent)}${showDecisionWorkbench ? renderDecisionImpactWorkbench(reviewContent, { stage, reviewId }) : ""}<details id="reviewEvidence" class="review-evidence"><summary>查看审核依据与可选建议</summary><section class="review-zone review-zone-mandatory"><h3>必须处理</h3>${issueMarkup(mandatory, "当前没有必须处理项。")}${mandatoryOverride}</section><section class="review-zone review-zone-decision"><h3>需要决定</h3>${issueMarkup(decisions, "当前没有需要决定项。")}</section><section class="review-zone review-zone-optional"><h3>可选优化</h3>${issueMarkup(optional, "当前没有可选优化项。")}</section><section class="review-zone review-zone-adjudication"><h3>系统记录</h3>${adjudicationMarkup}${failureMarkup}${ruleBlockedOverride}${technicalFlags.length ? `<p class="review-technical-flags">${technicalFlags.map((flag) => escapeHtml(flag)).join(" · ")}</p>` : ""}</section></details></div>`;
}

function renderTitleStage() {
  const artifact = artifactForStage("title");
  const isCnShortDrama = state.mode === "cn";
  const releaseLanguage = isCnShortDrama ? "中文" : "英文";
  const releaseLabel = isCnShortDrama ? "CHINESE RELEASE TITLE · 4 OPTIONS" : "ENGLISH RELEASE TITLE · 4 OPTIONS";
  const selectionHeading = isCnShortDrama ? "选一个最适合这部剧的正式剧名" : "选一个最适合这部剧的英文片名";
  const selectionCopy = isCnShortDrama ? "正式发行使用中文剧名。命名信息用于创作者快速比较。" : "正式发行只使用英文片名。中文释义和命名信息用于创作者快速比较。";
  const selectionNote = isCnShortDrama ? "每个候选均为独立片名短语，不使用剧情摘要句。重新生成会建立新版本，并避开已有候选。" : "中文释义只供创作者对照，不会写入后续正式标题。重新生成会建立新版本，并避开已有候选。";
  if (!artifact) {
    return `<section class="artifact-card empty-artifact"><span class="card-label"><i></i>WAITING FOR RUN</span><h3>先生成 4 个${releaseLanguage}候选剧名</h3><p>系统会读取剧本 DNA、发行平台和目标市场，用一个指定模型生成 4 个命名基因不同的${releaseLanguage}片名。</p></section>`;
  }
  const candidates = Array.isArray(artifact.content?.candidates) ? artifact.content.candidates : [];
  const selectedTitle = state.input.storyTitle || "";
  const options = candidates.map((candidate, index) => {
    const title = String(candidate?.title_en || candidate?.title_zh || "");
    const selected = title === selectedTitle;
    const namingGene = candidate?.naming_gene_zh || "命名基因未标注";
    const style = candidate?.style_zh || "风格未标注";
    const tone = candidate?.tone_zh || "语气未标注";
    const reason = candidate?.reason_zh || "暂无命名依据";
    return `<button class="title-option${selected ? " is-selected" : ""}" type="button" role="radio" aria-checked="${selected}" aria-label="选择${releaseLanguage}片名 ${escapeHtml(title)}" data-title-choice="${escapeHtml(title)}"><span class="title-option-top"><span class="title-option-number">0${index + 1}</span><span class="title-option-gene">${escapeHtml(namingGene)}</span></span><span class="title-option-body"><strong${isCnShortDrama ? "" : " lang=\"en\""}>${escapeHtml(title)}</strong><span class="title-option-translation">${isCnShortDrama ? "命名释义" : "中文释义"} · ${escapeHtml(candidate?.explanation_zh || "仅供创作者参考")}</span><span class="title-option-meta"><em>${escapeHtml(style)}</em><em>${escapeHtml(tone)}</em></span><span class="title-option-reason">${escapeHtml(reason)}</span></span><i aria-hidden="true"></i></button>`;
  }).join("");
  const approved = state.approved.has(artifact.id);
  const statusLabel = approved ? "本阶段已确认" : "单模型生成完成 · 等待人工选择";
  const regenerate = approved ? "" : `<button class="stage-secondary title-regenerate" type="button" data-regenerate-title${state.busy ? " disabled" : ""}>重新生成 4 个</button>`;
  const inlineStatus = approved ? "已确认版本" : selectedTitle ? "已选择 · 请在右侧确认后进入故事提案" : "等待选择剧名 · 确认入口在右侧";
  return `<section class="title-picker" aria-labelledby="titlePickerHeading"><div class="title-picker-head"><div class="title-picker-title-block"><span class="title-picker-label">${releaseLabel}</span><h3 id="titlePickerHeading">${selectionHeading}</h3><p>${selectionCopy}</p></div><div class="title-picker-actions"><span class="title-selection-status">${selectedTitle ? `已选：${escapeHtml(selectedTitle)}` : "尚未选择"}</span>${regenerate}</div></div><div class="title-options" role="radiogroup" aria-labelledby="titlePickerHeading">${options}</div><p class="title-picker-note">${selectionNote}</p><div class="card-footer"><small>${escapeHtml(statusLabel)} · 不进入交叉审核 · ${escapeHtml(inlineStatus)}</small></div></section>`;
}

function renderCreationTrace(artifact, reviewContent = {}) {
  const primary = artifact?.primaryExecution || {};
  const reviewers = Array.isArray(reviewContent.feedbacks) ? reviewContent.feedbacks : [];
  const decision = reviewContent.decision || {};
  if (!primary.actualModel && !reviewers.length && !decision.kind) return "";
  const reviewerRows = reviewers.map((reviewer) => `<li><strong>${escapeHtml(reviewer.role || "交叉审核席位")}</strong><span>${escapeHtml(reviewer.model || reviewer.provider || "未返回")}${reviewer.status === "completed" ? " · 已完成" : " · 未完成"}</span></li>`).join("");
  return `<details class="review-reference-panel creation-trace"><summary><span>执行依据 · 主笔 / 规则校验 / 双席审读 / 系统裁判</span><em>${escapeHtml(decision.title || "等待裁判")}</em></summary><div class="creation-trace-block"><strong>主笔</strong><ul><li><strong>${escapeHtml(primary.role || "主笔")}</strong><span>${escapeHtml(primary.actualModel || "未返回")}</span></li></ul></div><div class="creation-trace-block"><strong>系统裁判</strong><p>${escapeHtml(decision.summary || "等待规则校验与双席审读完成")}</p></div>${reviewerRows ? `<div class="creation-trace-block"><strong>审读依据</strong><ul>${reviewerRows}</ul></div>` : ""}</details>`;
}

function renderStageTaskCard(stage = state.stage, reviewContent = {}) {
  const meta = stageMeta[stage] || stageMeta.brief;
  const artifact = artifactForStage(stage);
  const decision = reviewContent.decision || {};
  const owner = stage === "handoff" ? "交付编排器" : stage === "title" ? "创作者" : "主笔";
  const input = stage === "brief"
    ? "创作想法、市场与节奏参数"
    : stage === "handoff"
      ? "已确认的七项剧作资产"
      : "已确认阶段摘要 + 当前创作规格";
  const output = stage === "handoff" ? "正式剧本与资产文件" : meta.title;
  const acceptance = stage === "title"
    ? "选择一个正式剧名"
    : stage === "handoff"
      ? "七项资产均已确认"
      : "规则校验完成，双席证据已由系统裁判汇总";
  const status = decision.title || (artifact ? (state.approved.has(artifact.id) ? "已确认" : "等待裁判决定") : "等待开始");
  return `<section class="stage-task-card" aria-label="阶段执行说明"><div class="stage-task-head"><span class="card-label"><i></i>EXECUTION CARD</span><strong>${escapeHtml(status)}</strong></div><dl class="stage-task-grid"><div><dt>阶段目标</dt><dd>${escapeHtml(meta.task)}</dd></div><div><dt>责任人</dt><dd>${escapeHtml(owner)}</dd></div><div><dt>输入</dt><dd>${escapeHtml(input)}</dd></div><div><dt>产出</dt><dd>${escapeHtml(output)}</dd></div><div><dt>完成条件</dt><dd>${escapeHtml(acceptance)}</dd></div></dl></section>`;
}

function renderStageCockpit(stage = state.stage, reviewContent = {}) {
  const meta = stageMeta[stage] || stageMeta.brief;
  const artifact = artifactForStage(stage);
  const flowStage = workflowStage();
  const action = nextStepMeta();
  const review = reviewForArtifact(artifact)?.content || reviewContent;
  const unitProgress = unitStageProgress(stage);
  const stageNumber = String(stageIndex(stage) + 1).padStart(2, "0");
  const isCurrent = stage === flowStage;
  const isApproved = !!artifact && state.approved.has(artifact.id);
  const reviewLabel = isApproved
    ? "已确认"
    : review?.pass === true
      ? "已完成"
      : state.busy && isCurrent
        ? "执行中"
        : artifact
          ? "待裁判"
          : "待执行";
  const unitLabel = unitProgress
    ? `已锁定 ${unitProgress.locked.length} / ${unitProgress.total || "-"} 集`
    : artifact
      ? "已生成当前阶段产物"
      : "等待本阶段输入";
  const decisionLabel = isApproved
    ? "已锁定"
    : action.kind === "needs_decision" || action.kind === "human-override"
      ? "等待取舍"
      : action.kind === "auto-revise"
        ? "等待修订"
        : action.kind === "approve"
          ? "等待确认"
          : "等待结果";
  const runCopy = state.busy && isCurrent
    ? "PixelTale 正在执行，进度会自动同步。"
    : isCurrent
      ? (stageRunSummary(stage) || action.copy)
      : `当前正在查看已完成阶段；主线下一步是「${stageMeta[flowStage]?.title || "导出交付"}」。`;
  return `<section class="stage-cockpit${state.busy && isCurrent ? " is-running" : ""}" aria-label="当前阶段工作台">
    <div class="stage-cockpit-summary">
      <span class="stage-cockpit-number">${stageNumber}</span>
      <div><h2>${escapeHtml(meta.title)}</h2><p>${escapeHtml(meta.task)}</p></div>
      <button type="button" class="stage-cockpit-jump" data-scroll-agent-task>查看执行轨道</button>
    </div>
    <div class="stage-cockpit-context"><span>${isCurrent ? "当前阶段" : "已查看阶段"} · ${escapeHtml(unitLabel)}</span><strong>下一步：${escapeHtml(action.title)}</strong></div>
    <div class="execution-rail" aria-label="执行进度">
      <article class="execution-rail-step ${artifact ? "is-complete" : isCurrent ? "is-current" : ""}"><span>01</span><div><strong>生成</strong></div><em>${artifact ? "已完成" : isCurrent ? "执行中" : "等待"}</em></article>
      <article class="execution-rail-step ${review?.pass === true || isApproved ? "is-complete" : artifact && isCurrent ? "is-current" : ""}"><span>02</span><div><strong>校验</strong></div><em>${escapeHtml(reviewLabel)}</em></article>
      <article class="execution-rail-step ${isApproved ? "is-complete" : artifact && isCurrent ? "is-current" : ""}"><span>03</span><div><strong>决定</strong></div><em>${escapeHtml(decisionLabel)}</em></article>
    </div>
    <p class="stage-cockpit-status" role="status">${escapeHtml(runCopy)}</p>
  </section>`;
}

function renderArtifactStage() {
  const artifact = artifactForStage(state.stage);
  if (!artifact) {
    return `${renderUnitStageProgress(state.stage)}<section class="artifact-card empty-artifact"><span class="card-label"><i></i>WAITING FOR RUN</span><h3>本阶段尚未有服务端产物</h3><p>完成上一阶段确认后，这里会生成当前阶段的结构化产物，并返回编排与复核结果。</p></section>`;
  }
  const review = reviewForArtifact(artifact);
  const reviewContent = review?.content || {};
  const approved = state.approved.has(artifact.id);
  const unitProgress = unitStageProgress(state.stage);
  const unitComplete = !unitProgress || unitProgress.complete;
  const advisoryGate = reviewAdvisoryGate(reviewContent);
  const blockingItems = reviewIssueGroups(reviewContent);
  const reviewPassed = approved || (unitComplete && reviewContent.pass && !advisoryGate.accepted.length && !advisoryGate.blockingPending.length);
  const reviewLabel = approved ? "本阶段已确认" : reviewPassed ? "审核通过 · 等待确认" : advisoryGate.blockingPending.length ? "待人工裁决 · 处理右侧意见" : advisoryGate.accepted.length ? "已有采纳意见 · 已并入必修清单" : blockingItems.length ? `待处理 ${blockingItems.length} 类必修项` : "审核未完成 · 需要重新提交";
  const decisionWorkbench = review ? renderDecisionImpactWorkbench(reviewContent, { stage: state.stage, reviewId: review.id }) : "";
  const reviewPanel = review
    ? !unitComplete && reviewContent.pass
      ? `<div class="review-summary is-passed"><strong>当前产物已通过，正在等待整季完成</strong><p>已锁定 ${unitProgress.locked.length} / ${unitProgress.total} 集。点击右侧“一键处理剩余集”，后台会自动完成生成、审核和必要修订，后续请求不会包含已锁定集正文。</p></div>`
      : renderReviewPanel(reviewContent, { passed: reviewPassed, stage: state.stage, reviewId: review.id, showDecisionWorkbench: false })
    : `<div class="review-summary"><strong>正在等待复核结果</strong><p>当前批次完成后，这里会显示审核与锁定状态。</p></div>`;
  const inlineStatus = approved ? "已确认版本" : !unitComplete ? `已锁定 ${unitProgress.locked.length} / ${unitProgress.total} 集 · 继续生成` : reviewPassed ? "审核通过 · 请在右侧确认" : advisoryGate.blockingPending.length ? "待人工裁决 · 请处理右侧意见" : blockingItems.length ? "待定向修订 · 请使用右侧唯一按钮" : "需要重新提交当前阶段";
  const primaryAction = renderAgentTaskAction(nextStepMeta());
  return `${state.stage === "arc" ? renderStoryPulse(artifact) : ""}${renderUnitStageProgress(state.stage)}${decisionWorkbench}<section class="artifact-card live-artifact"><div class="artifact-card-head"><span class="card-label"><i></i>${escapeHtml(artifact.type)}</span><span class="artifact-meta">v${escapeHtml(artifact.version)} · ${escapeHtml(artifact.status)}</span></div><details class="stage-artifact-details"><summary><span>查看完整阶段产物</span><em>${escapeHtml(inlineStatus)}</em></summary><div class="structured-content">${renderValue(artifact.content)}</div></details><div class="card-footer"><small>${escapeHtml(reviewLabel)} · ${escapeHtml(inlineStatus)}</small></div>${renderCreationTrace(artifact, reviewContent)}${reviewPanel}${primaryAction ? `<div class="artifact-primary-action">${primaryAction}</div>` : ""}</section>`;
}

// 2026-08-10：检测 arc 代号/非中文标题（供导出页提示修正）
function arcBadTitleCount() {
  const artifact = artifactForStage("arc");
  const units = Array.isArray(artifact?.content?.units) ? artifact.content.units : [];
  return units.filter((u) => {
    const t = String((u && u.title_zh) || "").trim();
    return !t || !/[\u4e00-\u9fff]/.test(t);
  }).length;
}

function renderHandoff() {
  const ready = handoffReady();
  const latest = state.agent?.handoffs?.at(-1);
  const scriptDocument = latest?.scriptDocument || state.agent?.scriptDocument;
  const visualAssetDocument = state.agent?.visualAssetDocument;
  const visualAssetAction = visualAssetDocument?.status === "ready"
    ? `<button type="button" class="stage-primary visual-asset-download" data-download-visual-assets ${state.documentBusy ? "disabled" : ""}>下载视觉资产 DOCX <span aria-hidden="true">↓</span></button>`
    : visualAssetDocument?.status === "failed"
      ? `<span class="visual-asset-error">视觉资产文档生成失败：${escapeHtml(visualAssetDocument.error || "请重新导出")}</span>`
      : "";
  const scriptReady = scriptDocument?.status === "ready";
  const scriptStatus = !ready
    ? "等待全剧确认"
    : scriptReady
      ? "已生成 · 可保存 / 下载"
      : scriptDocument?.status === "failed"
        ? "生成失败"
        : "等待生成";
  const scriptError = state.documentError || (scriptDocument?.status === "failed" ? scriptDocument.error : "");
  const scriptFileName = scriptDocument?.fileName || "导出后生成正式剧本 DOCX";
  const badTitles = arcBadTitleCount();
  const fixTitlesButton = badTitles
    ? `<div class="handoff-title-fix"><span>检测到 ${badTitles} 集标题为代号/非中文，导出前建议修正</span><button type="button" class="tool-button" data-arc-fix-titles>修正标题（代号→中文）</button></div>`
    : "";
  // 2026-08-10：生成入口直接放到导出页（不再要求用户去右侧下一步卡找"生成正式文件"）。
  const documentActions = scriptReady
    ? `<div class="document-delivery-actions"><button type="button" class="stage-primary" data-download-script ${state.documentBusy ? "disabled" : ""}>下载剧本 DOCX <span aria-hidden="true">↓</span></button><button type="button" class="stage-secondary" data-save-script ${state.documentBusy ? "disabled" : ""}>选择文件夹并保存</button></div>`
    : ready
      ? `<button type="button" class="handoff-generate-btn" data-flow-action="handoff" ${state.documentBusy ? "disabled" : ""}>生成正式文件 <span aria-hidden="true">→</span></button>`
      : "";
  return `${fixTitlesButton}<p class="stage-intro handoff-intro">${ready ? "所有阶段都已确认。现在可以生成严格按参考格式排版的正式剧本 DOCX、视觉资产 DOCX 和版本化导出包，不覆盖既有文件。" : "先确认故事架构、剧名、提案、人物与世界、分集剧情、场景镜头和对白，完成后即可导出逐集正式剧本。"}</p><div class="handoff-grid"><div class="handoff-tile"><strong>正式剧本</strong><span>${ready ? "每集场次编号 · 人物 · △动作 · 对白" : "等待全剧确认"}</span></div><div class="handoff-tile"><strong>结构资产</strong><span>${ready ? "人物 / 关系 / 世界规则" : "等待阶段确认"}</span></div><div class="handoff-tile"><strong>视觉资产</strong><span>${ready ? "人物 / 场景 / 道具 DOCX" : "等待全剧确认"}</span></div></div>${latest ? `<section class="artifact-card"><span class="card-label"><i></i>LAST EXPORT</span><h3>${escapeHtml(latest.id)}</h3><p>导出包已建立：${escapeHtml(latest.packageFile || "版本化文件")}</p>${visualAssetAction ? `<div class="visual-asset-download-row">${visualAssetAction}</div>` : ""}</section>` : ""}<section class="document-delivery" aria-labelledby="scriptDocumentTitle"><div class="document-delivery-head"><div><span class="card-label"><i></i>FORMAL DELIVERABLE</span><h3 id="scriptDocumentTitle">正式剧本 DOCX</h3></div><span class="document-status ${scriptReady ? "is-ready" : scriptDocument?.status === "failed" ? "is-error" : ""}">${scriptStatus}</span></div><p class="document-file-name">${escapeHtml(scriptFileName)}</p>${scriptReady ? `<label class="script-folder-field" for="scriptFolderName"><span>本地新建文件夹名称（可选）</span><input id="scriptFolderName" type="text" placeholder="留空则保存到所选文件夹" autocomplete="off" /></label>` : ""}${scriptError ? `<p class="document-error" role="alert">${escapeHtml(scriptError)}</p>` : ""}${documentActions}</section><section class="document-delivery visual-asset-delivery" aria-labelledby="visualAssetTitle"><div class="document-delivery-head"><div><span class="card-label"><i></i>VISUAL DELIVERABLE</span><h3 id="visualAssetTitle">视觉资产 DOCX</h3></div><span class="document-status ${visualAssetDocument?.status === "ready" ? "is-ready" : visualAssetDocument?.status === "failed" ? "is-error" : ""}">${visualAssetDocument?.status === "ready" ? "已生成 · 可下载" : visualAssetDocument?.status === "failed" ? "生成失败" : ready ? "等待生成（生成正式文件时一起产出）" : "等待全剧确认"}</span></div><p class="document-file-name">${escapeHtml(visualAssetDocument?.fileName || "导出后生成视觉资产 DOCX")}</p>${visualAssetDocument?.status === "failed" ? `<p class="document-error" role="alert">${escapeHtml(visualAssetDocument.error || "生成失败")}</p>` : ""}${visualAssetDocument?.status === "ready" ? `<div class="document-delivery-actions"><button type="button" class="stage-primary" data-download-visual-assets ${state.documentBusy ? "disabled" : ""}>下载视觉资产 DOCX <span aria-hidden="true">↓</span></button></div>` : ""}</section>`;
}

// 依据与风险：动态显示当前审核的实际分歧（不再只显示静态标准文案）
function renderRiskNote() {
  const note = document.querySelector("#riskNote");
  const count = document.querySelector(".risk-count");
  if (!note) return;
  const review = latestConsensusReview();
  const content = review?.content || {};
  const feedbacks = (Array.isArray(content.feedbacks) ? content.feedbacks : [])
    .filter((item) => item.status === "completed" || item.pass !== undefined);
  const disagreements = Array.isArray(content.disagreements) ? content.disagreements : [];
  const ruleBlocked = (Array.isArray(content.technicalFailures) ? content.technicalFailures : [])
    .find((item) => item.status === "rule_blocked");
  const seatLabel = (item) => {
    const name = modelMeta[item.actualModel || item.model]?.name || item.actualModel || item.model || "审读席";
    const pass = item.pass === true;
    const score = Number.isFinite(Number(item.score)) ? `（${Math.round(Number(item.score))} 分）` : "";
    const issues = (Array.isArray(item.mandatoryIssues) ? item.mandatoryIssues : [])
      .map((i) => i.tag || i.criterion_id).filter(Boolean).slice(0, 3).join("、");
    return `${name} ${pass ? "通过" : "要求修订"}${score}${issues ? `：${issues}` : ""}`;
  };
  let html = "";
  let riskCount = 0;
  if (ruleBlocked) {
    const findings = (Array.isArray(content.ruleFindings) ? content.ruleFindings : [])
      .filter((item) => item.severity === "high" || !item.severity)
      .slice(0, 3).map((item) => item.message || item.code || "内容未达基础标准");
    const findingText = findings.length ? findings.join("；") : "内容未达基础标准";
    html = `<span class="risk-dot"></span><span>规则校验未通过：${escapeHtml(findingText)}。本次审核未执行；可重新生成本阶段，或在下方「审核依据」中点「接受当前版本并继续」人工放行。</span>`;
    riskCount = findings.length || 1;
  } else if (feedbacks.length === 0) {
    html = `<span class="risk-dot"></span><span>钩子必须在集尾留下一个未回答的问题。</span>`;
  } else if (disagreements.length) {
    html = `<span class="risk-dot"></span><span>双席审读存在分歧：${feedbacks.map(seatLabel).join("；")}。分歧已按共识机制自动裁决（评分分歧与裁决依据见下方「审核依据」）；需要创作者决定的取舍才会出现「选择方案」入口。</span>`;
    riskCount = feedbacks.length;
  } else {
    const agreed = feedbacks.every((item) => item.pass === true);
    const score = Number.isFinite(Number(content.quality)) ? content.quality : content.score;
    const scoreTxt = Number.isFinite(Number(score)) ? `（质量分 ${Math.round(Number(score))}）` : "";
    html = `<span class="risk-dot"></span><span>双席审读意见一致：${agreed ? `通过${scoreTxt}，确认后进入下一阶段` : `要求修订${scoreTxt}，按右侧修订清单处理`}。</span>`;
    riskCount = 1;
  }
  note.innerHTML = html;
  if (count) count.textContent = String(riskCount);
}

function renderStage() {
  const flowStage = workflowStage();
  const renderer = state.stage === "brief" ? renderBrief : state.stage === "title" ? renderTitleStage : state.stage === "handoff" ? renderHandoff : renderArtifactStage;
  const currentArtifact = artifactForStage(state.stage);
  const currentReview = reviewForArtifact(currentArtifact)?.content || {};
  $("#stageContent").innerHTML = `<div class="workflow-guide" aria-label="阶段导航"><div><span class="eyebrow">STORY MAP</span><strong>当前阶段 ${productionProgressLabel(workflowStage())}</strong></div><div class="workflow-route"><span>当前</span><b>${escapeHtml(stageMeta[workflowStage()]?.title || "交接")}</b><i>→</i><span>下一步</span><b>${escapeHtml(stageMeta[stageOrder[stageIndex(workflowStage()) + 1]]?.title || "完成交接")}</b></div></div>${renderStageCockpit(state.stage, currentReview)}${renderer()}`;
  bindStageActions();
  renderShellState();
  renderRiskNote();
  persistSessionSnapshot();
}

const RUN_POLL_INTERVAL_MS = 2_000;
const RUN_POLL_TIMEOUT_MS = 4 * 60 * 1_000;
const RUN_BACKGROUND_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const PIXELTALE_STATE_TIMEOUT_MS = 10_000;
const PIXELTALE_STATE_RETRY_LIMIT = 3;
let hydrationRequest = null;

async function waitForRunJob(jobId, { timeoutMs = RUN_POLL_TIMEOUT_MS } = {}) {
  if (!jobId) throw new Error("服务未返回运行任务号，请重新生成当前阶段");
  const deadline = Number.isFinite(timeoutMs) ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
    try {
      const job = (await request(`/run-jobs/${encodeURIComponent(jobId)}`)).job;
      consecutiveFailures = 0;
      if (job?.status === "running") {
        state.runPhase = job.phase || "";
        renderModelTeam();
      }
      if (job?.status === "completed") {
        state.runPhase = "";
        renderModelTeam();
        return job.result;
      }
      if (job?.status === "failed") {
        state.runPhase = "";
        renderModelTeam();
        const terminalError = new Error(job.error || "本次运行失败");
        terminalError.terminal = true;
        terminalError.code = job.errorCode || "RUN_FAILED";
        terminalError.recoverable = terminalError.code === "RUN_INTERRUPTED";
        throw terminalError;
      }
      // 2026-08-10：服务重启会把在跑任务标为 interrupted。立即结束监控并清除
      // 残留 activeRun（而不是轮询 4 分钟），让用户马上可以重新提交当前阶段。
      if (job?.status === "interrupted") {
        state.runPhase = "";
        renderModelTeam();
        const interrupted = new Error(job.error || "服务重启中断了本次运行，请重新提交当前阶段");
        interrupted.terminal = true;
        interrupted.code = "RUN_INTERRUPTED";
        interrupted.recoverable = true;
        throw interrupted;
      }
    } catch (error) {
      if (error?.terminal) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 5) throw error;
    }
  }
  return { status: "detached", jobId };
}

async function monitorBackgroundRun(run) {
  if (!run?.jobId || backgroundRunMonitor === run.jobId) return;
  backgroundRunMonitor = run.jobId;
  try {
    const result = await waitForRunJob(run.jobId, { timeoutMs: RUN_BACKGROUND_TIMEOUT_MS });
    if (result?.status === "detached") {
      state.runPhase = "";
      renderModelTeam();
      if (state.activeRun?.jobId === run.jobId) {
        persistActiveRun(null);
        state.lastError = "后台任务超过 6 小时仍未返回，输入和已完成产物已保留；只有单集连续生成失败时才需要人工介入。";
        showToast(state.lastError);
        renderStage();
      }
      return;
    }
    if (state.activeRun?.jobId !== run.jobId) return;
    persistActiveRun(null);
    if (!result?.state) {
      state.runPhase = "";
      state.lastError = "";
      showToast("后台任务已结束，当前项目状态保持不变");
      renderStage();
      return;
    }
    updateAgentState(result?.state);
    state.stage = run.stage;
    state.lastError = "";
    showToast(result?.status === "needs_review" ? "后台运行完成，已同步审核结果" : "后台运行完成，已同步当前阶段");
    renderStage();
  } catch (error) {
    state.runPhase = "";
    renderModelTeam();
    if (state.activeRun?.jobId !== run.jobId) return;
    // 任何监控失败都清除残留 activeRun：terminal（服务重启/失败）与网络类
    // 失败（waitForRunJob 连续 5 次轮询抛错）都会让界面永久停在 busy 且无按钮。
    // 清掉后用户可重新提交；后台若仍在运行，服务端有中断恢复/幂等兜底。
    persistActiveRun(null);
    state.lastError = userFacingError(error);
    showToast(state.lastError);
    renderStage();
  } finally {
    if (backgroundRunMonitor === run.jobId) backgroundRunMonitor = "";
  }
}

async function runCurrentStage(stage = state.stage, { revisionPlan = "", override = false } = {}) {
  if (stage === "brief") collectBriefInput();
  if (stage === "title") state.input.storyTitle = "";
  const unitNumbers = collectUnitStageScope(stage);
  state.lastError = "";
  state.busy = true;
  renderStage();
  try {
    let payload;
    let recoveryAttempted = false;
    let overrideRetried = override;
    while (!payload) {
      let accepted;
      try {
        accepted = await request("/runs", { method: "POST", body: JSON.stringify({ stage, mode: modeValue(), input: state.input, routes: state.routes, revisionPlan, unitNumbers, override: overrideRetried || undefined }) });
      } catch (requestError) {
        // 已确认阶段重跑：后端要求 override 显式确认（会使下游已确认内容失效）。
        if (requestError?.code === "STAGE_RERUN_REQUIRES_OVERRIDE" && !overrideRetried) {
          state.pendingRerun = { stage, revisionPlan };
          return { pendingConfirmation: true };
        }
        throw requestError;
      }
      persistActiveRun({ jobId: accepted.job?.jobId, stage });
      try {
        const result = await waitForRunJob(accepted.job?.jobId);
        if (result?.status === "detached") {
          state.busy = false;
          state.runPhase = "";
          renderModelTeam();
          showToast("前台等待窗口已结束，任务仍在后台运行；完成后会自动同步，请勿重复提交。");
          void monitorBackgroundRun({ jobId: accepted.job?.jobId, stage });
          return { detached: true };
        }
        payload = { result };
      } catch (error) {
        if (error?.code === "STAGE_RERUN_REQUIRES_OVERRIDE" && !overrideRetried) {
          persistActiveRun(null);
          state.pendingRerun = { stage, revisionPlan };
          return { pendingConfirmation: true };
        }
        if (!recoveryAttempted && error?.recoverable) {
          recoveryAttempted = true;
          showToast("检测到服务重启，正在使用已保存输入恢复当前阶段…");
          continue;
        }
        throw error;
      }
    }
    persistActiveRun(null);
    updateAgentState(payload.result?.state);
    const resultStage = payload.result?.state?.stage;
    const autoApproved = payload.result?.status === "completed" && stage !== "title" && resultStage && resultStage !== stage;
    if (autoApproved) {
      // 自动放行：多数通过 + 意见一致≥90% → 后端已推进阶段，保留推进并提示
      state.stage = resultStage;
      showToast("审核通过，已自动进入下一阶段");
    } else {
      // The run response may contain the last approved stage; keep the stage the user just ran visible.
      state.stage = stage;
      state.lastError = payload.result?.status === "failed" ? (payload.result.errors || []).map((item) => item.message).join("；") : "";
      if (state.lastError) throw new Error(state.lastError);
      const revision = payload.result?.revision;
      const resultArtifact = artifactForStage(stage);
      const reviewMode = reviewModeLabelFor(stage, reviewForArtifact(resultArtifact)?.content || {}, resultArtifact);
      showToast(stage === "title" && payload.result?.status === "completed"
        ? "已由指定模型生成 4 个英文剧名，可选择或重新生成"
        : payload.result?.status === "needs_review"
        ? (revision ? "交叉修订已执行，但仍有问题未通过逐项关闭" : `已生成，但${reviewMode}存在共识问题或意见冲突`)
        : (revision ? "交叉修订已逐项复审关闭，等待确认" : `已生成并完成${reviewMode}，等待确认`));
    }
    if (state.pendingCrossStageRepair?.stage === stage) state.pendingCrossStageRepair = null;
    return { result: payload.result };
  } catch (error) {
    if (error?.terminal) {
      persistActiveRun(null);
    } else if (state.activeRun?.jobId) {
      // Non-terminal failure (network blip / poll timeout): the server job may
      // still be alive. Keep it as the active run and switch to background
      // monitoring so a manual retry cannot start a competing job whose later
      // writer would clobber the original result.
      const run = state.activeRun;
      if (!state.revising) {
        state.busy = false;
        renderStage();
      }
      void monitorBackgroundRun(run);
      state.lastError = userFacingError(error);
      showToast(`${state.lastError} 任务仍在后台运行，完成后会自动同步，请勿重复提交。`);
      return { failed: true, detached: true };
    }
    state.lastError = userFacingError(error);
    showToast(state.lastError);
    return { failed: true };
  } finally {
    // A multi-pass auto revision keeps busy across its own runCurrentStage
    // calls; only the outermost flow may release the buttons.
    if (!state.revising) {
      state.busy = false;
      renderStage();
    }
  }
}

async function runAutoRevision(stage = state.stage) {
  // 2026-08-10：修订轮数上限——同阶段会话内超过 3 轮仍未收敛，强制转人工放行，
  // 避免无限'修订 → 复审 → 再修订'。放行/确认后计数清除。
  const revisionKey = `pixeltale.revision-rounds:${stage}`;
  let revisionRounds = 0;
  try { revisionRounds = Number(sessionStorage.getItem(revisionKey) || 0); } catch { /* storage unavailable */ }
  if (revisionRounds >= 3) {
    // 2026-08-10 用户规则：评分必须达标才能进入下一步——修订达上限仍不达标时，
    // 不放行低分，提示重新生成当前阶段（或先处理跨阶段必修项）。
    state.lastError = `本阶段已自动修订 ${revisionRounds} 轮仍未达标；请重新生成当前阶段，或先前往必修项归属的阶段处理。评分达标后才能进入下一步。`;
    showToast(state.lastError);
    renderStage();
    return;
  }
  // Multi-pass revision must stay busy across every inner runCurrentStage
  // (whose finally releases buttons). The revising flag defers that release
  // to here so the user cannot click into a competing run between passes.
  state.revising = true;
  state.busy = true;
  state.lastError = "";
  renderStage();
  try {
    try {
      const payload = await request("");
      updateAgentState(payload.agent);
    } catch (error) {
      state.lastError = userFacingError(error);
      showToast(state.lastError);
      return;
    }
  state.stage = stage;
  const artifact = artifactForStage(stage);
  const review = reviewForArtifact(artifact);
  const content = review?.content || {};
  const issues = reviewIssueGroups(content);
  if (!artifact || !issues.length) {
    // 2026-08-10：服务端最新版本若已通过（旧界面残留的修订点击会先刷新 state 到这里），
    // 直接提示确认，绝不重新生成——这是'反反复复修改很多轮'的根源。
    if (artifact && content.pass === true && (content.decision?.kind === "approve" || Number(content.quality) >= 75)) {
      showToast("当前版本已通过审核，请点击「确认进入下一步」完成确认（无需修订）");
      state.lastError = "";
      renderStage();
      return;
    }
    showToast("服务端最新状态没有可执行清单，正在重新生成并审核当前阶段");
    await runCurrentStage(stage);
    return;
  }
  const crossStageIssues = issues.filter((issue) => issue.targetStage && issue.targetStage !== stage);
  if (crossStageIssues.length) {
    // 2026-08-10：跨阶段问题不再强制拦截（目标阶段可能已确认、无修订入口 → 死路）。
    // 提示存在跨阶段项，但允许在当前阶段按修订指引与已确认上游统一，或人工放行。
    const targets = [...new Set(crossStageIssues.map((issue) => stageMeta[issue.targetStage]?.title || issue.targetStage))];
    showToast(`当前清单包含跨阶段问题（${crossStageIssues.length} 项，属于${targets.join("、")}）：可在该阶段处理，或在本阶段修订后人工放行；仍将执行本阶段修订。`);
  }
  const maxPasses = 1;
  const buildPlan = (items, pass) => [
    `这是第 ${pass} 轮自动修订。请一次性解决当前阶段的全部复核问题；保留没有问题的内容，不要只修复其中一项。`,
    ...items.map((issue, index) => {
      const evidence = Array.isArray(issue.evidence) && issue.evidence.length ? `证据：${issue.evidence.join("；")}` : "";
      const fixes = Array.isArray(issue.suggestions) && issue.suggestions.length ? issue.suggestions.join("；") : "请根据问题证据提出具体修订";
      return `${index + 1}. ${issue.tag || "待修订项"}（${issue.severity || "medium"}）：${fixes}${evidence ? `；${evidence}` : ""}`;
    }),
  ].join("\n");

  // 跨阶段项不发给当前阶段修订 writer（归属其他阶段），保留在清单供人工处理
  let currentIssues = issues.filter((issue) => !issue.targetStage || issue.targetStage === stage);
  // 2026-08-10：若必修项全部归属其他阶段（本阶段修订关不掉它们），直接提示放行，
  // 不做空计划修订（否则'修订 → 复审仍不通过 → 再修订'空转）。
  if (!currentIssues.length && crossStageIssues.length) {
    showToast(`必修项均归属其他阶段（${[...new Set(crossStageIssues.map((issue) => stageMeta[issue.targetStage]?.title || issue.targetStage))].join("、")}），当前阶段修订无法关闭；请前往处理，或点「接受当前版本并继续」人工放行`);
    state.lastError = "";
    renderStage();
    return;
  }
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    showToast(`正在执行第 ${pass} / ${maxPasses} 轮修订与复审 · ${currentIssues.length} 类问题`);
    const outcome = await runCurrentStage(stage, { revisionPlan: buildPlan(currentIssues, pass) });
    // 2026-08-10：本轮修订已执行，会话内计数 +1（超上限后强制转人工放行）。
    revisionRounds += 1;
    try { sessionStorage.setItem(revisionKey, String(revisionRounds)); } catch { /* storage unavailable */ }
    if (outcome?.detached || state.lastError) return;

    const revisedArtifact = artifactForStage(stage);
    const revisedReview = reviewForArtifact(revisedArtifact);
    const remainingIssues = reviewIssueGroups(revisedReview?.content || {});
    if (revisedArtifact?.status === "ready" || revisedReview?.content?.pass === true) {
      showToast(pass === 1 ? "修订已完成并通过复审，等待确认进入下一步" : `已自动完成 ${pass} 轮修订并通过复审，等待确认进入下一步`);
      return;
    }
    if (pass === maxPasses) {
      showToast(`已完成 ${maxPasses} 轮修订，仍有 ${remainingIssues.length} 类问题待确认；请查看清单后再决定`);
      return;
    }
    currentIssues = remainingIssues;
  }
  } finally {
    state.revising = false;
    state.busy = false;
    renderStage();
  }
}

async function decideAdvisory(reviewId, advisoryId, status, reason = "", requiresReason = false) {
  if ((status === "ignored" || (status === "accepted" && requiresReason)) && !reason.trim()) {
    showToast(status === "accepted" ? "按此方向修订前，请填写裁决依据或修改边界" : "保留当前版本必须填写理由");
    return;
  }
  state.busy = true;
  state.lastError = "";
  renderStage();
  try {
    const payload = await request(`/reviews/${encodeURIComponent(reviewId)}/advisories/${encodeURIComponent(advisoryId)}`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    });
    updateAgentState(payload.result?.state);
    showToast(status === "accepted" ? "建议已采纳，下一步将执行定向修订" : "已保留当前版本，并记录处理理由");
  } catch (error) {
    state.lastError = userFacingError(error);
    showToast(state.lastError);
  } finally {
    state.busy = false;
    renderStage();
  }
}

async function approveArtifact(artifactId, { humanOverride = false, humanOverrideReason = "" } = {}) {
  const requiredStage = workflowStage();
  const artifact = (state.agent?.artifacts || []).find((item) => item.id === artifactId);
  if (!artifact || artifact.stage !== requiredStage) {
    state.stage = requiredStage;
    state.lastError = "";
    renderStage();
    showToast(`请先完成“${stageMeta[requiredStage]?.title || "当前阶段"}”`);
    return;
  }
  state.busy = true;
  state.lastError = "";
  renderShellState();
  try {
    const payload = await request(`/artifacts/${encodeURIComponent(artifactId)}/approve`, { method: "POST", body: JSON.stringify({ selectedTitle: state.input.storyTitle || "", humanOverride, humanOverrideReason: humanOverride ? humanOverrideReason || "用户人工放行：接受当前版本继续" : "" }) });
    updateAgentState(payload.result?.state);
    showToast(humanOverride ? "已人工放行并确认，进入下一阶段" : "本阶段已确认，进入下一阶段");
  } catch (error) {
    state.lastError = userFacingError(error);
    showToast(state.lastError);
  } finally {
    state.busy = false;
    renderStage();
  }
}

async function createHandoff() {
  state.busy = true;
  state.lastError = "";
  state.documentError = "";
  renderStage();
  try {
    const payload = await request("/handoff", { method: "POST", body: "{}" });
    updateAgentState(payload.result?.state);
    showToast("已生成正式剧本与视觉资产文件");
  } catch (error) {
    state.lastError = userFacingError(error);
    showToast(state.lastError);
  } finally {
    state.busy = false;
    renderStage();
  }
}

function syncAgentState({ silent = false } = {}) {
  if (hydrationRequest) return hydrationRequest;
  hydrationRequest = (async () => {
    let payload = null;
    let lastError = null;
    for (let attempt = 1; attempt <= PIXELTALE_STATE_RETRY_LIMIT; attempt++) {
      try {
        payload = await request("", { timeoutMs: PIXELTALE_STATE_TIMEOUT_MS });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < PIXELTALE_STATE_RETRY_LIMIT) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
    }
    if (!payload?.agent) throw lastError || new Error("服务未返回当前项目");
    updateAgentState(payload.agent);
    state.lastError = "";
    renderStage();
    if (!silent) showToast("已同步独立编剧会话");
    const pendingNew = consumePendingNewNotice();
    if (pendingNew) showToast(pendingNew);
  })().catch((error) => {
    if (!silent) {
      state.lastError = userFacingError(error);
      renderStage();
      showToast(state.lastError);
    }
  }).finally(() => {
    hydrationRequest = null;
  });
  return hydrationRequest;
}

function openRoutingDialog() {
  const dialog = $("#routingDialog");
  $$('[data-route]').forEach((select) => { select.value = state.routes[select.dataset.route]; });
  dialog.showModal();
}

async function saveRouting(event) {
  event.preventDefault();
  $$('[data-route]').forEach((select) => { state.routes[select.dataset.route] = select.value; });
  try {
    const payload = await request("/settings", { method: "POST", body: JSON.stringify({ mode: modeValue(), routes: state.routes, input: state.input }) });
    updateAgentState(payload.agent);
  } catch (error) {
    showToast(userFacingError(error));
    return;
  }
  $("#routingSaved").textContent = "已保存";
  $("#routingDialog").close("save");
  renderShellState();
  showToast("创作分工已保存到 PixelTale");
}

function bindAgentTaskAction() {
  // 2026-08-10：内容区（stageContent）内的动作按钮（系统裁判决定卡上的定向修订、
  // 导出页的生成正式文件）也需要响应点击——它们不在右侧 #agentTaskAction 内。
  // 只处理内容区实际出现的动作，避免与右侧绑定重复触发。
  $$("[data-arc-fix-titles]").forEach((button) => button.addEventListener("click", async () => {
    const original = button.textContent;
    button.disabled = true; button.textContent = "修正中…";
    try {
      const res = await fetch(agentApiPath("/arc/fix-titles"), { method: "POST", headers: { "Content-Type": "application/json", ...agentRequestHeaders() }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || "标题修正失败，请重试"); return; }
      alert(`已修正 ${data.fixed || 0} 集标题${data.flagged ? `，剩余 ${data.flagged} 集待处理` : ""}`);
      await refreshPixelTaleState();
    } catch (error) { alert("网络错误，请重试"); } finally { button.disabled = false; button.textContent = original; }
  }));
function handleConfirmHumanOverride(button) {
  const reasonField = $("[data-human-override-reason]");
  // 2026-08-11：评分达标时理由非必填（文案含"评分已达标"即跳过校验）
  const requiresReason = reasonField?.hasAttribute("required") !== false;
  if (requiresReason && !reasonField?.reportValidity()) return;
  const stage = button.dataset.humanOverrideStage || state.pendingHumanOverride || state.stage;
  const artifact = (state.agent?.artifacts || []).find((item) => item.stage === stage);
  const review = reviewForArtifact(artifact);
  const creativeDecision = creativeReviewDecisionGroups(review?.content || {})[0];
  const choiceId = state.impactChoices[review?.id || `${stage}-decision`] || "option_1";
  const choice = creativeDecision?.decisionOptions?.[Number(choiceId.replace("option_", "")) - 1] || creativeDecision?.decisionOptions?.[0] || "";
  state.pendingHumanOverride = "";
  // 2026-08-10：人工放行后清除本阶段修订轮数计数（重新计）。
  try { sessionStorage.removeItem(`pixeltale.revision-rounds:${stage}`); } catch { /* storage unavailable */ }
  void approveArtifact(artifact?.id, { humanOverride: true, humanOverrideReason: `${choice ? `选择：${choice}\n` : ""}${reasonField.value.trim()}` });
}

  $$("#stageContent [data-flow-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.flowAction;
      if (action === "handoff") { void createHandoff(); return; }
      if (action === "auto-revise") { void runAutoRevision(button.dataset.autoRevise || state.stage); return; }
      if (action === "human-override") {
        const overrideStage = button.dataset.humanOverride || state.stage;
        if (button.classList.contains("decision-override-btn")) {
          // 2026-08-10：决策卡放行按钮点击 → 在按钮位置就地渲染确认表单（页面内，不用浏览器弹窗）。
          state.pendingHumanOverride = overrideStage;
          renderStage();
          requestAnimationFrame(() => $('[data-human-override-reason]')?.focus());
          return;
        }
        state.pendingHumanOverride = overrideStage;
        renderAgentTask();
        requestAnimationFrame(() => $('[data-human-override-reason]')?.focus());
      }
      if (action === "confirm-human-override") {
        handleConfirmHumanOverride(button);
        return;
      }
      if (action === "cancel-human-override") {
        state.pendingHumanOverride = "";
        renderShellState();
        return;
      }
    });
  });
  $$("#agentTaskAction [data-flow-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.flowAction;
    if (action === "run") {
      const stage = button.dataset.runStage || state.stage;
      if (stage === "brief" && !$("#idea")?.value.trim()) {
        state.lastError = "请在“创作想法”中写清主角、目标和阻碍，再点击“生成故事架构”。";
        $("#briefError").textContent = state.lastError;
        $("#briefError")?.classList.add("is-visible");
        $("#idea")?.focus();
        showToast(state.lastError);
        return;
      }
      void runCurrentStage(stage);
      return;
    }
    if (action === "auto-revise") {
      void runAutoRevision(button.dataset.autoRevise || state.stage);
      return;
    }
    if (action === "retry-failed") {
      const stage = button.dataset.retryStage || state.stage;
      state.input.revisionUnitNumbers = button.dataset.retryUnits || "";
      void runAutoRevision(stage);
      return;
    }
    if (action === "human-override") {
      const stage = button.dataset.humanOverride || state.stage;
      state.pendingHumanOverride = stage;
      renderShellState();
      requestAnimationFrame(() => $('[data-human-override-reason]')?.focus());
      return;
    }
    if (action === "confirm-human-override") {
      handleConfirmHumanOverride(button);
      return;
    }
    if (action === "cancel-human-override") {
      state.pendingHumanOverride = "";
      renderShellState();
      return;
    }
    if (action === "confirm-rerun") {
      const pending = state.pendingRerun;
      if (!pending) return;
      state.pendingRerun = null;
      void runCurrentStage(pending.stage, { revisionPlan: pending.revisionPlan, override: true });
      return;
    }
    if (action === "cancel-rerun") {
      state.pendingRerun = null;
      renderShellState();
      return;
    }
    if (action === "review-advisories") {
      document.querySelector(".review-advisories")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.querySelector(".review-advisory-item button")?.focus();
      return;
    }
    if (action === "approve") {
      void approveArtifact(button.dataset.approveArtifact);
      return;
    }
    if (action === "handoff") {
      void createHandoff();
      return;
    }
    if (action === "return") {
      state.stage = workflowStage();
      state.lastError = "";
      renderStage();
    }
    });
  });
}

function bindDecisionImpactWorkbench() {
  $$('[data-impact-choice]').forEach((button) => button.addEventListener("click", () => {
    const workbenchId = button.dataset.impactWorkbench;
    const choice = button.dataset.impactChoice;
    if (!workbenchId || !choice) return;
    state.impactChoices[workbenchId] = choice;
    renderStage();
    const labels = { revise: "已聚焦到定向修订路径", keep: "已聚焦到保留当前版本路径", evidence: "已聚焦到核对依据路径" };
    showToast(`${labels[choice] || "已更新处理路径"}；右侧唯一操作不会被自动触发。`);
  }));
  $$('[data-impact-evidence]').forEach((button) => button.addEventListener("click", () => {
    const evidence = $("#reviewEvidence");
    if (!evidence) return;
    evidence.open = true;
    evidence.scrollIntoView({ behavior: "smooth", block: "nearest" });
    evidence.querySelector("summary")?.focus({ preventScroll: true });
  }));
}

function bindStageActions() {
  $$('[data-cross-stage-open]').forEach((button) => button.addEventListener("click", () => {
    const targetStage = button.dataset.crossStageOpen || button.dataset.crossStage;
    if (!targetStage || !stageAccessible(targetStage)) {
      showToast(`“${stageMeta[targetStage]?.title || targetStage || "归属阶段"}”当前不可访问`);
      return;
    }
    state.pendingCrossStageRepair = { stage: targetStage, sourceStage: button.dataset.crossStageSource || state.stage };
    state.stage = targetStage;
    state.lastError = "";
    renderStage();
    requestAnimationFrame(() => $(".agent-task")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }));
  $$('[data-pulse-node]').forEach((button) => button.addEventListener("click", () => {
    const inspector = document.querySelector("#pulseInspector");
    if (!inspector) return;
    $$('[data-pulse-node]').forEach((node) => node.classList.toggle("is-selected", node === button));
    const episode = button.dataset.pulseEpisode || "—";
    const label = button.dataset.pulseLabel || "剧情节点";
    const detail = button.dataset.pulseDetail || "暂无字段证据";
    inspector.querySelector("[data-pulse-inspector-title]").textContent = `第 ${episode} 集 · ${label}`;
    inspector.querySelector("[data-pulse-inspector-copy]").textContent = detail;
    inspector.querySelector("[data-pulse-inspector-meta]").textContent = `节点类型 · ${label} · 来自分集字段`;
  }));
  $$('[data-scroll-agent-task]').forEach((button) => button.addEventListener("click", () => {
    const target = $(".agent-task");
    target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    target?.querySelector("button")?.focus({ preventScroll: true });
  }));
  $$('[data-title-choice]').forEach((button) => button.addEventListener("click", () => {
    if (state.approved.has(artifactForStage("title")?.id)) return;
    state.input.storyTitle = button.dataset.titleChoice || "";
    renderStage();
  }));
  $("[data-regenerate-title]")?.addEventListener("click", () => runCurrentStage("title"));
  $("[data-download-script]")?.addEventListener("click", () => void runDocumentAction(downloadScriptDocument));
  $("[data-download-visual-assets]")?.addEventListener("click", () => void runDocumentAction(downloadVisualAssetDocument));
  $("[data-save-script]")?.addEventListener("click", () => void runDocumentAction(saveScriptDocument));
  $("#episodeScaleRange")?.addEventListener("input", syncBriefRanges);
  $("#durationRange")?.addEventListener("input", syncBriefRanges);
  $("#idea")?.addEventListener("input", () => { state.input.idea = $("#idea")?.value || ""; });
  $("#marketRegion")?.addEventListener("change", () => { updateMarketCountryList(); syncMarketControls(); renderShellState(); void persistCreativeSettings(); });
  $("#marketCountry")?.addEventListener("change", () => { syncMarketControls(); renderShellState(); void persistCreativeSettings(); });
  $("#localizationNote")?.addEventListener("change", () => { syncMarketControls(); renderShellState(); void persistCreativeSettings(); });
  $("#audienceGender")?.addEventListener("change", () => {
    collectBriefInput();
    state.input.audienceGender = $("#audienceGender")?.value || "all";
    state.input.audience = state.input.audienceGender;
    renderStage();
    void persistCreativeSettings();
  });
  $("#openingImpactRange")?.addEventListener("input", syncCreativeControls);
  $("#openingImpactRange")?.addEventListener("change", () => { syncCreativeControls(); void persistCreativeSettings(); });
  $$('[data-creative-control]').forEach((control) => control.addEventListener("change", () => { syncCreativeControls(); void persistCreativeSettings(); }));
  $$('[data-dna-toggle]').forEach((button) => button.addEventListener("click", () => toggleDnaWindow()));
  $$('[data-dna-filter]').forEach((button) => button.addEventListener("click", () => setDnaFilter(button.dataset.dnaFilter || "all")));
  $$('[data-inspiration]').forEach((button) => button.addEventListener("click", () => addInspirationToIdea(button.dataset.inspiration || "")));
  $$('[data-advisory-decision]').forEach((button) => button.addEventListener("click", () => {
    const card = button.closest("[data-advisory-item]");
    const reason = card?.querySelector("[data-advisory-reason]")?.value || "";
    void decideAdvisory(button.dataset.reviewId, button.dataset.advisoryId, button.dataset.advisoryDecision, reason, button.dataset.advisoryRequiresReason === "true");
  }));
  bindDecisionImpactWorkbench();
  if (state.stage === "brief") syncBriefRanges();
  if (state.stage === "brief") syncCreativeControls();
}

$$('[data-mode]').forEach((button) => button.addEventListener("click", async () => {
  if (state.busy || state.revising) return;
  if (state.stage === "brief") collectBriefInput();
  const previousMode = state.mode;
  state.mode = button.dataset.mode;
  state.input.episodeCount = state.mode === "long" ? 8 : 24;
  state.input.openingImpactSeconds = 3;
  state.input.openingPromise = "mainline_promise";
  state.input.hookCadence = "every_episode";
  // 模式切换必须联动本土化参数：发布平台 / 投放市场 / 对白策略 / 单集时长。
  // 国内短剧 → 抖音、中国大陆、中文口语化；TK 短剧 → TikTok、北美/美国、英文口语化；
  // 普通长剧 → Web drama、中国大陆、中文口语化、10 分钟级。
  const MODE_LOCALIZATION = {
    cn: { platform: "抖音 / 国内短视频", region: "east_asia", country: "CN", dialogueMode: "zh_story_zh_localized_dialogue", durationValue: 120, durationUnit: "sec" },
    tk: { platform: "TikTok / TikTok Series", region: "north_america", country: "united_states", dialogueMode: "localized_english", durationValue: 60, durationUnit: "sec" },
    long: { platform: "Web drama", region: "east_asia", country: "CN", dialogueMode: "zh_story_zh_localized_dialogue", durationValue: 10, durationUnit: "min" },
  };
  const loc = MODE_LOCALIZATION[state.mode] || MODE_LOCALIZATION.tk;
  state.input.platform = loc.platform;
  state.input.marketRegion = loc.region;
  state.input.marketCountry = loc.country;
  state.input.dialogueMode = loc.dialogueMode;
  state.input.durationValue = loc.durationValue;
  state.input.durationUnit = loc.durationUnit;
  state.input.duration = `${loc.durationValue} ${loc.durationUnit}`;
  state.input.episodeScale = state.mode === "long" ? "8 chapters" : "24 episodes";
  state.input.localizationNote = "";
  renderStage();
  if (typeof updateMarketCountryList === "function") updateMarketCountryList();
  try {
    const payload = await request("/settings", { method: "POST", body: JSON.stringify({ mode: modeValue(), routes: state.routes, input: state.input }) });
    updateAgentState(payload.agent);
    renderStage();
  } catch (error) {
    state.mode = previousMode;
    renderStage();
    showToast(userFacingError(error));
  }
}));

$("#openModelRouting").addEventListener("click", openRoutingDialog);
$("#openModelRoutingSide").addEventListener("click", openRoutingDialog);
$("#saveRouting").addEventListener("click", saveRouting);
$("#openHistory")?.addEventListener("click", openHistoryDialog);
$("#refreshHistory")?.addEventListener("click", () => void loadCreativeHistory());
$("#historyList")?.addEventListener("click", (event) => {
  const retry = event.target.closest("[data-history-retry]");
  if (retry) {
    void loadCreativeHistory();
    return;
  }
  const open = event.target.closest("[data-history-open]");
  if (open) resumeHistorySession(open.dataset.historyOpen);
  const remove = event.target.closest("[data-history-delete]");
  if (remove) {
    requestHistoryDelete(remove.dataset.historyDelete, remove.dataset.historyTitle);
    return;
  }
  const cancel = event.target.closest("[data-history-delete-cancel]");
  if (cancel) {
    state.historyDeletePending = null;
    renderCreativeHistory(state.historyEntries || []);
    return;
  }
  const confirm = event.target.closest("[data-history-delete-confirm]");
  if (confirm) void deleteHistorySession(confirm.dataset.historyDeleteConfirm);
});
$("#agentMenu").addEventListener("click", () => showToast("Agent 状态独立保存于 Story Forge 会话"));
function startNewDraft() {
  let freshSession;
  try {
    sessionStorage.setItem(PENDING_MODE_KEY, state.mode);
    sessionStorage.setItem(PENDING_NOTICE_KEY, "已创建新的剧集会话，请从故事架构开始。");
    freshSession = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_STORAGE_KEY, freshSession);
  } catch {
    // A fresh in-memory session will still be created after reload.
    freshSession = freshSession || `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  const target = new URL(window.location.href);
  target.searchParams.set("session", freshSession);
  target.hash = "brief";
  window.location.assign(target.toString());
}

$("#newDraft").addEventListener("click", startNewDraft);
$$('[data-open-stage]').forEach((button) => button.addEventListener("click", () => {
  const target = button.dataset.openStage;
  if (!stageAccessible(target)) return showToast(`请先完成“${stageMeta[workflowStage()]?.title || "当前阶段"}”`);
  state.stage = target;
  renderStage();
}));

const restoredSession = restoreSessionSnapshot();
renderStage();
syncAgentState({ silent: true }).finally(() => {
  if (state.activeRun) void monitorBackgroundRun(state.activeRun);
});
