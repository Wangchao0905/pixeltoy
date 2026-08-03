const SESSION_STORAGE_KEY = "pixeltale.story-forge-session";
const PENDING_MODE_KEY = "pixeltale.story-forge-pending-mode";
const PENDING_NOTICE_KEY = "pixeltale.story-forge-pending-notice";

function createSessionId() {
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

function pendingMode() {
  try {
    const mode = sessionStorage.getItem(PENDING_MODE_KEY);
    sessionStorage.removeItem(PENDING_MODE_KEY);
    return mode === "long" ? "long" : "tk";
  } catch {
    return "tk";
  }
}

const state = {
  mode: pendingMode(),
  stage: "brief",
  approved: new Set(),
  busy: false,
  documentBusy: false,
  toastTimer: null,
  lastError: "",
  documentError: "",
  agent: null,
  routes: { orchestration: "gpt-5.6-terra", continuity: "claude-opus-5", hooks: "grok-4.5", dialogueReview: "claude-sonnet-5", consistency: "gpt-5.6-luna" },
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

const modelMeta = {
  "gpt-5.6-terra": { name: "GPT 5.6 Terra", provider: "chatgpt", role: "总编排 / 结构", detail: "任务拆解、结构约束与最终复核" },
  "gpt-5.6-sol": { name: "GPT 5.6 Sol", provider: "chatgpt", role: "总编排 / 结构", detail: "任务拆解、结构约束与最终复核" },
  "gpt-5.6-luna": { name: "GPT 5.6 Luna", provider: "chatgpt", role: "总编排 / 结构", detail: "任务拆解、结构约束与最终复核" },
  "claude-opus-5": { name: "Claude Opus 5", provider: "claude", role: "故事圣经 / 连续性", detail: "人物、世界规则、长剧弧线与伏笔连续性" },
  "claude-sonnet-5": { name: "Claude Sonnet 5", provider: "claude", role: "故事圣经 / 连续性", detail: "人物、世界规则、长剧弧线与伏笔连续性" },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", provider: "claude", role: "故事圣经 / 连续性", detail: "人物、世界规则、长剧弧线与伏笔连续性" },
  "grok-4.5": { name: "Grok 4.5", provider: "grok", role: "TK 钩子 / 口语化", detail: "开头暴击、反转、探索欲与英文对白口语化" },
};

const stageOrder = ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue", "handoff"];
const stageMeta = {
  brief: { kicker: "01 / BRIEF", title: "故事架构", task: "建立故事架构", copy: "确认平台、受众和单集节奏，先建立可执行的故事架构。" },
  title: { kicker: "02 / TITLE", title: "选择剧名", task: "确定故事的第一张名片", copy: "根据故事架构生成 5 个风格各异的候选名，选定后才进入故事提案。" },
  proposal: { kicker: "03 / PROPOSAL", title: "故事提案", task: "给出可追更的核心命题", copy: "检查冲突、人物欲望和每集继续观看的理由。" },
  characters: { kicker: "04 / CHARACTERS", title: "人物与世界", task: "锁定人物关系和世界规则", copy: "让角色的选择推动剧情，而不是让设定替角色行动。" },
  arc: { kicker: "05 / ARC", title: "分集与章节", task: "把主线拆成可拍的推进", copy: "短剧优先检查钩子与反转，长剧优先检查因果与人物弧线。" },
  scenes: { kicker: "06 / SCENES", title: "场景与镜头", task: "把剧情变成可执行的镜头意图", copy: "确认人物、场景、道具和镜头目的，为视觉资产输出建立依据。" },
  dialogue: { kicker: "07 / DIALOGUE", title: "对白本土化", task: "把对白说得像人物会说的话", copy: "中文保留剧情意图，英文对白根据人物、场景和受众口语化改写。" },
  handoff: { kicker: "08 / EXPORT", title: "导出正式文件", task: "生成可交付的剧本资产", copy: "确认后的结构化产物会生成正式剧本 DOCX 和视觉资产 DOCX。" },
};
const marketCatalog = [
  ["north_america", "united_states", "美国"], ["north_america", "canada", "加拿大"],
  ["europe", "united_kingdom", "英国"], ["europe", "germany", "德国"], ["europe", "france", "法国"],
  ["latin_america", "mexico", "墨西哥"], ["latin_america", "brazil", "巴西"],
  ["east_asia", "japan", "日本"], ["east_asia", "south_korea", "韩国"],
  ["southeast_asia", "indonesia", "印度尼西亚"], ["southeast_asia", "philippines", "菲律宾"], ["southeast_asia", "thailand", "泰国"],
  ["mena", "saudi_arabia", "沙特阿拉伯"], ["mena", "united_arab_emirates", "阿联酋"],
];
const marketRegionLabels = {
  north_america: "北美", europe: "欧洲", latin_america: "拉丁美洲", east_asia: "东亚", southeast_asia: "东南亚", mena: "中东及北非",
};
const inspirationPool = [
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
  return state.mode === "long" ? "long_form_drama" : "tk_short_drama";
}

function modeLabel() {
  return state.mode === "tk" ? "TK SHORT DRAMA" : "LONG-FORM DRAMA";
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
  const response = await fetch(agentApiPath(suffix), {
    ...options,
    headers: { ...agentRequestHeaders(), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || `请求失败：${response.status}`);
  return payload;
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
  state.agent = agent || null;
  if (!agent) return;
  state.mode = agent.mode === "long_form_drama" ? "long" : "tk";
  state.stage = agent.stage || "brief";
  state.routes = { ...state.routes, ...(agent.routes || {}) };
  state.input = { ...state.input, ...(agent.input || {}) };
  state.approved = new Set(agent.approvedArtifactIds || []);
}

function artifactForStage(stage) {
  const artifacts = state.agent?.artifacts || [];
  return artifacts
    .filter((item) => item.stage === stage && item.type === `pixeltale_${stage}`)
    .sort((a, b) => Number(a.version || 0) - Number(b.version || 0))
    .at(-1) || null;
}

function reviewForArtifact(artifact) {
  if (!artifact?.reviewId) return null;
  return (state.agent?.artifacts || []).find((item) => item.id === artifact.reviewId) || null;
}

function approvedStageCount() {
  const artifacts = state.agent?.artifacts || [];
  return stageOrder.slice(0, -1).filter((stage) => artifacts.some((item) => item.stage === stage && state.approved.has(item.id))).length;
}

function handoffReady() {
  return approvedStageCount() === stageOrder.length - 1;
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
    if (review?.content?.consensusIndex !== undefined) return review;
  }
  return null;
}

function consensusMetrics() {
  const review = latestConsensusReview();
  const content = review?.content || {};
  const interactionCompletion = Math.round((approvedStageCount() / (stageOrder.length - 1)) * 100);
  const reviewCompletion = Number(content.reviewCompletion || 0);
  const agreement = Number(content.agreement || 0);
  const quality = Number(content.quality || 0);
  const index = review
    ? Math.max(0, Math.min(100, Math.round(agreement * 0.45 + quality * 0.25 + reviewCompletion * 0.15 + interactionCompletion * 0.15)))
    : 0;
  return { index, agreement, quality, reviewCompletion, interactionCompletion, content };
}

function renderConsensusMeter() {
  const metrics = consensusMetrics();
  const score = document.querySelector("#consensusScore");
  const value = document.querySelector("#consensusValue");
  const fill = document.querySelector("#consensusFill");
  const label = document.querySelector("#consensusLabel");
  const agreement = document.querySelector("#consensusAgreement");
  const reviewCompletion = document.querySelector("#consensusReviewCompletion");
  const interactionCompletion = document.querySelector("#consensusInteractionCompletion");
  if (!score || !value || !fill || !label || !agreement || !reviewCompletion || !interactionCompletion) return;
  const tone = metrics.index >= 90 ? "高度一致" : metrics.index >= 75 ? "可继续审查" : metrics.index > 0 ? "存在分歧" : "等待三模型反馈";
  score.textContent = `${metrics.index}%`;
  value.textContent = `指数 · ${tone}`;
  label.textContent = metrics.index > 0 ? "三模型意见聚合" : "完成当前阶段后启动交叉审查";
  fill.style.setProperty("--consensus-width", `${metrics.index}%`);
  fill.parentElement?.classList.toggle("is-live", metrics.index > 0);
  agreement.textContent = `${metrics.agreement}%`;
  reviewCompletion.textContent = `${metrics.reviewCompletion}%`;
  interactionCompletion.textContent = `${metrics.interactionCompletion}%`;
}

function stageStatus(stage) {
  if (stage === "handoff") return handoffReady() ? "可导出" : "待解锁";
  const artifact = artifactForStage(stage);
  if (artifact && state.approved.has(artifact.id)) return "已确认";
  if (stage === workflowStage()) {
    if (!artifact) return "下一步";
    if (stage === "title" && artifact.status === "ready" && !state.input.storyTitle) return "待选择";
    return artifact.status === "ready" ? "待确认" : "需修订";
  }
  return stageIndex(stage) < stageIndex(workflowStage()) ? "可查看" : "待解锁";
}

function stageAccessible(stage) {
  return stageStatus(stage) !== "待解锁";
}

function nextStepMeta() {
  const flowStage = workflowStage();
  const flowMeta = stageMeta[flowStage];
  if (state.busy) {
    return { kind: "busy", title: "正在生成并进行三模型交叉审核", copy: "三份独立意见完成聚合后，会显示一致性指数和修改建议。", flowStage };
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
      title: brief ? "生成故事架构" : titleStage ? "生成 5 个剧名候选" : `生成${flowMeta.title}`,
      copy: brief ? "填好平台、节奏和核心冲突后，生成并复核故事架构；确认后进入剧名选择。" : titleStage ? "根据故事架构生成 5 个风格各异的剧名，并逐个说明命名理由。" : `完成${flowMeta.title}，生成结果通过复核后，下一步是确认本阶段。`,
      label: brief ? "生成故事架构 →" : titleStage ? "生成 5 个剧名 →" : `生成${flowMeta.title} →`,
      flowStage,
    };
  }
  if (artifact.status === "ready") {
    const nextStage = stageOrder[stageIndex(flowStage) + 1] || "handoff";
    const nextLabel = stageMeta[nextStage]?.title || "导出";
    if (flowStage === "title" && !state.input.storyTitle) {
      return {
        kind: "approve",
        artifactId: artifact.id,
        disabled: true,
        title: "选择一个剧名",
        copy: "先从 5 个风格各异的候选中选定一个，确认后进入故事提案。",
        label: "选择后进入故事提案 →",
        flowStage,
      };
    }
    return {
      kind: "approve",
      artifactId: artifact.id,
      title: `确认${flowMeta.title}`,
      copy: `复核已通过。确认后自动进入“${nextLabel}”，已确认版本不会被覆盖。`,
      label: `确认并进入${nextLabel} →`,
      flowStage,
    };
  }
  return {
    kind: "auto-revise",
    stage: flowStage,
    title: `${flowMeta.title}需要修订`,
    copy: "三模型已经汇总全部问题。点击唯一的下一步按钮，本阶段主创会按问题合同定向修订，三模型随后逐项复审关闭。",
    label: "执行交叉修订并复审 →",
    flowStage,
  };
}

function renderNextStep() {
  const action = nextStepMeta();
  const disabled = state.busy || action.disabled;
  const guidedClass = !disabled && action.kind !== "busy" ? " is-next-action" : "";
  const actionCopy = state.lastError
    ? `生成失败：${state.lastError} 当前输入已保留，修改后可以重新生成。`
    : action.copy;
  let button = "";
  if (action.kind === "run") {
    const target = action.stage === "brief" ? " id=\"runBrief\"" : ` data-run-stage=\"${action.stage}\"`;
    button = `<button${target} class="stage-primary${guidedClass}" data-flow-action="run" type="button" ${disabled ? "disabled" : ""}>${action.label}</button>`;
  } else if (action.kind === "auto-revise") {
    button = `<button class="stage-primary${guidedClass}" data-flow-action="auto-revise" data-auto-revise="${escapeHtml(action.stage)}" type="button" ${disabled ? "disabled" : ""}>${action.label}</button>`;
  } else if (action.kind === "approve") {
    button = `<button class="stage-primary${guidedClass}" type="button" data-flow-action="approve" data-approve-artifact="${escapeHtml(action.artifactId)}" ${disabled ? "disabled" : ""}>${action.label}</button>`;
  } else if (action.kind === "handoff") {
    button = `<button id="confirmHandoff" class="stage-primary${guidedClass}" data-flow-action="handoff" type="button" ${disabled ? "disabled" : ""}>${action.label}</button>`;
  } else if (action.kind === "return") {
    button = `<button class="stage-secondary${guidedClass}" data-flow-action="return" type="button" data-return-current>${action.label}</button>`;
  } else if (action.kind === "busy") {
    button = `<span class="next-step-busy">处理中 · 请稍候</span>`;
  }
  return `<section class="next-step-card${action.kind !== "busy" ? " is-guided" : " is-busy"}" data-next-kind="${action.kind}" aria-label="下一步"><div class="next-step-copy"><span class="card-label"><i></i>NEXT ACTION</span><strong>${escapeHtml(action.title)}</strong><p>${escapeHtml(actionCopy)}</p>${state.lastError ? `<p class="next-step-error" role="alert">错误已保留在当前步骤，修订后可再次提交。</p>` : ""}</div>${button}</section>`;
}

function renderShellState() {
  const action = nextStepMeta();
  const flowStage = workflowStage();
  $("#modeLabel").textContent = modeLabel();
  $("#agentTaskTitle").textContent = action.title;
  $("#agentTaskCopy").textContent = state.lastError || action.copy;
  $("#agentTaskCopy").setAttribute("role", state.lastError ? "alert" : "status");
  $("#flowStepCounter").textContent = `${String(stageIndex(flowStage) + 1).padStart(2, "0")} / ${stageOrder.length}`;
  $("#agentStatus").textContent = state.busy
    ? "PixelTale 正在生成并复核..."
    : state.lastError
      ? "本次运行失败"
      : action.kind === "approve"
        ? "等待确认"
        : action.kind === "handoff"
          ? "等待导出"
          : action.kind === "return"
            ? "正在查看已确认版本"
            : "等待输入";
  $("#approvedCount").textContent = `${approvedStageCount()} / ${stageOrder.length - 1}`;
  $("#progressBar").style.width = `${Math.round((approvedStageCount() / (stageOrder.length - 1)) * 100)}%`;
  renderConsensusMeter();
  $$(".mode-button").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  $$(".stage-link").forEach((button) => {
    const name = button.dataset.stage;
    const artifact = artifactForStage(name);
    const status = stageStatus(name);
    const locked = !stageAccessible(name);
    button.classList.toggle("is-active", name === state.stage);
    button.classList.toggle("is-done", !!artifact && state.approved.has(artifact.id));
    button.classList.toggle("is-next-stage", name === flowStage && status !== "已确认");
    button.classList.toggle("is-locked", locked);
    button.disabled = locked;
    button.title = locked ? `完成“${stageMeta[flowStage]?.title || "当前阶段"}”后解锁` : name === flowStage ? `下一步：${stageMeta[name]?.title || name}` : `查看“${stageMeta[name]?.title || name}”`;
    button.setAttribute("aria-label", `${stageMeta[name]?.title || name}${name === flowStage && status !== "已确认" ? "，下一步" : ""}`);
    const statusNode = button.querySelector(".stage-status");
    if (statusNode) statusNode.textContent = status;
    if (name === state.stage) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    button.querySelector("i")?.setAttribute("aria-label", artifact && state.approved.has(artifact.id) ? "已确认" : "未确认");
  });
  const liveMarketCountry = $("#marketCountry")?.value || state.input.marketCountry;
  const context = ["独立编剧 Agent", state.mode === "tk" ? "TK 短剧" : "普通长剧", `市场 · ${marketCountryLabel(liveMarketCountry)}`, "English Dialogue", state.mode === "tk" ? "9:16" : "16:9"];
  $("#contextChips").innerHTML = context.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  renderModelTeam();
  const ready = handoffReady();
  $$('[data-open-stage="handoff"]').forEach((button) => { button.disabled = !ready; });
  $("#handoffSummary").textContent = ready ? "全部阶段已确认 · 可生成正式剧本与视觉资产 DOCX" : "完成全部阶段确认后生成正式文件";
}

function activeRouteForStage() {
  const route = state.routes;
  if (state.stage === "characters" || (state.stage === "arc" && state.mode === "long")) return { primary: route.continuity, reviewer: route.orchestration, consistency: route.consistency };
  if (state.stage === "arc" || state.stage === "dialogue") return { primary: route.hooks, reviewer: route.dialogueReview, consistency: route.consistency };
  return { primary: route.orchestration, reviewer: route.continuity, consistency: route.consistency };
}

function renderModelTeam() {
  const route = activeRouteForStage();
  const unique = [route.primary, route.reviewer, route.consistency, "gpt-5.6-terra", "claude-opus-5", "grok-4.5"].filter((id, index, list) => list.indexOf(id) === index).slice(0, 3);
  const status = state.agent?.providerStatus || {};
  $("#modelTeamCards").innerHTML = unique.map((id) => {
    const meta = modelMeta[id];
    const primary = id === route.primary;
    const reviewer = id === route.reviewer && !primary;
    const configured = status[meta.provider]?.configured;
    const consistency = id === route.consistency && !primary && !reviewer;
    const lane = primary ? "交叉审核反馈" : reviewer ? "互审一致性" : consistency ? "一致性审查" : "候补交叉模型";
    const stateLabel = configured ? (primary ? "反馈" : reviewer ? "对抗审核" : consistency ? "第三审查" : "候补") : "待接入";
    return `<button class="model-card ${primary ? "is-primary" : reviewer ? "is-reviewer" : ""}" type="button" data-model-detail="${id}" title="${lane}：${meta.name}"><i></i><span><strong>${meta.name}</strong><small>${lane} · ${meta.role}</small></span><em>${stateLabel}</em></button>`;
  }).join("");
  $$('[data-model-detail]').forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.modelDetail;
    const statusText = status[modelMeta[id].provider]?.configured ? "已接入" : "待接入";
    showToast(`${modelMeta[id].name}：${modelMeta[id].detail} · ${statusText}`);
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

function renderInspirationPool() {
  const audienceGender = audienceGenderLabels[state.input.audienceGender] ? state.input.audienceGender : "all";
  const recommended = audienceDnaRecommendations[audienceGender] || new Set();
  const nodes = inspirationPool.map((item) => `<button class="inspiration-node${recommended.has(item.keyword) ? " is-recommended" : ""}" type="button" data-inspiration="${escapeHtml(item.keyword)}" style="--node-x:${item.x}%;--node-y:${item.y}%;--node-r:${item.r}deg" title="添加“${escapeHtml(item.keyword)}”到创作想法"><span>${escapeHtml(item.keyword)}</span><small>${escapeHtml(item.kind)} · ${escapeHtml(item.source)}</small></button>`).join("");
  const recommendation = audienceGender === "all" ? "选择受众方向后推荐标签会高亮" : `${audienceGenderLabels[audienceGender]} · ${recommended.size} 个 DNA 推荐`;
  return `<section class="inspiration-pool" aria-labelledby="inspirationPoolTitle"><div class="inspiration-pool-head"><div><span class="card-label"><i></i>STORY DNA</span><h3 id="inspirationPoolTitle">灵感池</h3><p>近五年热剧的题材、爽点、爆火基因、叙事逻辑与主角身份，点击即可加入创作想法。</p></div><div class="inspiration-meta"><span class="inspiration-period">2021—2026</span><span class="inspiration-recommendation${audienceGender === "all" ? "" : " is-active"}"><i></i>${recommendation}</span></div></div><div class="inspiration-orbit" role="list">${nodes}<span class="inspiration-core" aria-hidden="true"><i></i><strong>STORY<br />DNA</strong><small>可点击采样</small></span></div><div class="inspiration-footer"><span>Netflix · HBO · Sony Pictures TV · DNA 提炼</span><span>不复制具体作品</span></div></section>`;
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
    <div class="metric-card control-card"><label class="control-label" for="dialogueMode">对白策略</label><select id="dialogueMode" data-creative-control>${selectOptions([["localized_english", "英文口语化本土化"], ["localized_english_sharp", "英文强口语 / 强冲突"], ["localized_english_subtle", "英文克制 / 低解释"]], dialogueMode)}</select></div>
    <div class="metric-card control-card"><label class="control-label" for="handoffScope">输出范围</label><select id="handoffScope" data-creative-control>${selectOptions([["confirmed_versioned", "已确认 · 版本化"], ["confirmed_with_reviews", "已确认 + 复核记录"], ["script_and_assets", "剧本 + 视觉资产"]], handoffScope)}</select></div>
  </section>`;
}

function renderBriefArtifact() {
  const artifact = artifactForStage("brief");
  if (!artifact) return "";
  const review = reviewForArtifact(artifact);
  const reviewContent = review?.content || {};
  const passed = artifact.status === "ready" && reviewContent.pass !== false;
  const status = passed ? "已生成 · 复核通过 · 待确认" : review ? "已生成 · 复核未通过" : "已生成 · 等待复核";
  const reviewPanel = review ? renderReviewPanel(reviewContent, { passed, stage: "brief" }) : `<div class="review-summary"><strong>正在等待复核结果</strong><p>三模型复核完成后，这里会显示完整问题清单。</p></div>`;
  return `<section class="artifact-card live-artifact brief-result" aria-labelledby="briefResultTitle"><div class="stage-kicker"><span class="card-label"><i></i>STORY ARCHITECTURE</span><span class="artifact-meta">v${escapeHtml(artifact.version)} · ${escapeHtml(status)}</span></div><h3 id="briefResultTitle">故事架构生成结果</h3><div class="structured-content">${renderValue(artifact.content)}</div>${reviewPanel}</section>`;
}

function renderBrief() {
  const long = state.mode === "long";
  const idea = state.input.idea || "";
  const audienceGender = audienceGenderLabels[state.input.audienceGender] ? state.input.audienceGender : "all";
  const { config, episodeCount, durationValue } = briefRangeValues();
  const marketRegion = state.input.marketRegion || "north_america";
  const marketCountry = state.input.marketCountry || "united_states";
  return `
    <div class="stage-kicker"><span class="eyebrow">${currentMeta().kicker}</span><span class="artifact-meta">独立会话 · ${state.agent ? "已连接" : "准备开始"}</span></div>
    <h2>${currentMeta().title}</h2>
    <p class="stage-intro">${long ? "先锁定主线、人物弧线和章节尺度，再把故事拆成可持续推进的长剧结构。" : "先锁定平台节奏和追更机制，再把一句想法变成一集接一集的故事。"}</p>
    <div class="content-grid">
      <section class="form-panel">
        <h3>故事架构</h3>
        <div class="form-row"><div class="field"><label for="platform">发布平台</label><select id="platform"><option>TikTok / TikTok Series</option><option>YouTube Shorts</option><option>Web drama</option></select></div><div class="field"><label for="audienceGender">目标受众</label><select id="audienceGender" aria-label="目标受众"><option value="all" ${audienceGender === "all" ? "selected" : ""}>全部</option><option value="male" ${audienceGender === "male" ? "selected" : ""}>男性</option><option value="female" ${audienceGender === "female" ? "selected" : ""}>女性</option></select></div></div>
        <div class="market-panel"><div class="market-panel-head"><span class="card-label"><i></i>MARKET LOCALIZATION</span><strong>投放市场决定人名、地名与社会语境</strong></div><div class="form-row"><div class="field"><label for="marketRegion">受众地区</label><select id="marketRegion">${selectOptions(Object.entries(marketRegionLabels), marketRegion)}</select></div><div class="field"><label for="marketCountry">投放国家 / 地区</label><select id="marketCountry">${marketCountryOptions(marketRegion, marketCountry)}</select></div></div><div class="field"><label for="localizationNote">本土化补充 <span class="optional">可选</span></label><input id="localizationNote" value="${escapeHtml(state.input.localizationNote || "")}" placeholder="例如：芝加哥蓝领社区、伦敦金融区或曼谷大学校园" /></div></div>
        <div class="form-row"><div class="field slider-field"><div class="slider-label"><label for="episodeScaleRange">${long ? "章节数量" : "计划集数"}</label><output id="episodeScaleValue" for="episodeScaleRange">${episodeCount} ${config.episode.unit}</output></div><input id="episodeScaleRange" type="range" min="${config.episode.min}" max="${config.episode.max}" step="${config.episode.step}" value="${episodeCount}" /><div class="slider-scale"><span id="episodeScaleMin">${config.episode.min} ${config.episode.unit}</span><span id="episodeScaleMax">${config.episode.max} ${config.episode.unit}</span></div></div><div class="field slider-field"><div class="slider-label"><label for="durationRange">${long ? "单章时长" : "单集时长"}</label><output id="durationValue" for="durationRange">${durationValue} ${config.duration.unit}</output></div><input id="durationRange" type="range" min="${config.duration.min}" max="${config.duration.max}" step="${config.duration.step}" value="${durationValue}" /><div class="slider-scale"><span id="durationMin">${config.duration.min} ${config.duration.unit}</span><span id="durationMax">${config.duration.max} ${config.duration.unit}</span></div></div></div>
        <div class="field"><label for="idea">创作想法 <span aria-hidden="true">*</span></label><textarea id="idea" placeholder="用中文写下主角、欲望和核心冲突">${escapeHtml(idea)}</textarea><p class="small-note">中文描述剧情；英文对白会在对白阶段完成口语化本土化，不做逐句直译。</p></div>
        <div id="briefError" class="error-message ${state.lastError ? "is-visible" : ""}" role="alert">${escapeHtml(state.lastError || "先写下一个可识别的冲突，PixelTale 才能建立故事架构。")}</div>
      </section>
      ${renderCreativeControls()}
    </div>
    ${renderBriefArtifact()}
    ${renderInspirationPool()}
    ${renderNextStep()}`;
}

const fieldLabelMap = {
  title_zh: "剧名",
  logline_zh: "一句话梗概",
  core_conflict_zh: "核心冲突",
  viewer_question_zh: "观众悬念",
  episode_promise_zh: "单集承诺",
  mode_rules: "模式规则",
  candidates: "剧名候选",
  style_zh: "风格标签",
  tone_zh: "语气与气质",
  reason_zh: "命名理由",
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
  voice_rules_en: "英文声线规则",
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

function reviewIssueGroups(reviewContent = {}) {
  if (Array.isArray(reviewContent.reviewIssues) && reviewContent.reviewIssues.length) return reviewContent.reviewIssues;
  return (Array.isArray(reviewContent.required_changes) ? reviewContent.required_changes : [])
    .map((item) => ({ tag: "待修订项", dimension: "logic", severity: "medium", modelCount: 0, models: [], suggestions: [String(item || "")], evidence: [] }))
    .filter((item) => item.suggestions[0]);
}

function renderReviewPanel(reviewContent = {}, { passed = false, stage = state.stage } = {}) {
  const revision = reviewContent.revision || null;
  const closure = revision?.closure;
  const closurePanel = closure?.required ? `<section class="revision-closure ${closure.allResolved ? "is-resolved" : "is-open"}"><div class="revision-closure-head"><div><span class="card-label"><i></i>REVISION CLOSURE</span><strong>${closure.allResolved ? "本轮修订已逐项关闭" : "本轮修订仍有未关闭项"}</strong><p>责任方：${escapeHtml(revision?.owner || "本阶段主创")}。每项均由三模型复审，不以重新生成替代验收。</p></div><span>${escapeHtml(`${closure.items.filter((item) => item.status === "resolved").length} / ${closure.items.length}`)}</span></div><div class="revision-closure-list">${closure.items.map((item) => `<article class="revision-closure-item is-${escapeHtml(item.status || "unresolved")}"><div><b>${escapeHtml(item.id)}</b><strong>${escapeHtml(item.tag)}</strong></div><em>${escapeHtml(item.status === "resolved" ? "已关闭" : item.status === "partial" ? "部分完成" : "未关闭")}</em>${item.remainingFix?.length ? `<p>${escapeHtml(item.remainingFix.join("；"))}</p>` : `<p>${escapeHtml(item.acceptance || "已满足修订验收条件")}</p>`}</article>`).join("")}</div></section>` : "";
  if (passed) return `<div class="review-summary is-passed"><strong>复核通过，可以确认并进入下一步</strong><p>三模型已完成全量检查，当前版本可以继续确认。</p>${closurePanel}</div>`;
  const issues = reviewIssueGroups(reviewContent);
  const issueList = issues.length
    ? `<div class="review-issue-list">${issues.map((issue, index) => {
      const source = Number(issue.modelCount) >= 2 ? `${issue.modelCount} 个模型共同指出` : issue.models?.length ? `${issue.models.length} 个模型指出` : "审核清单";
      const suggestions = (Array.isArray(issue.suggestions) ? issue.suggestions : []).filter(Boolean);
      const evidence = (Array.isArray(issue.evidence) ? issue.evidence : []).filter(Boolean);
      return `<article class="review-issue review-issue-${escapeHtml(issue.severity || "medium")}"><div class="review-issue-head"><span class="review-issue-index">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(issue.tag || "待修订项")}</strong><span class="review-issue-severity">${escapeHtml(issue.severity || "medium")} · ${escapeHtml(source)}</span></div>${suggestions.length ? `<ul>${suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}${evidence.length ? `<details><summary>查看问题证据</summary><ul>${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}</article>`;
    }).join("")}</div>`
    : `<p class="review-empty">审核模型没有返回结构化问题，请按复核结果重新提交。</p>`;
  const countLabel = issues.length ? `已汇总 ${issues.length} 项问题` : "等待完整问题清单";
  return `<div class="review-summary is-needs-review"><div class="review-summary-head"><div><strong>复核未通过，需要一次性修订</strong><p>三模型已完成全量检查，下面是本次版本的完整问题清单；修订后会重新执行完整复核。</p></div><span class="review-issue-count">${escapeHtml(countLabel)}</span></div>${closurePanel}${issueList}<p class="review-panel-note">统一操作入口位于下方“下一步”。修订版本会绑定本清单，复审必须逐项给出关闭结论。</p></div>`;
}

function renderTitleStage() {
  const meta = currentMeta();
  const artifact = artifactForStage("title");
  if (!artifact) {
    return `<div class="stage-kicker"><span class="eyebrow">${meta.kicker}</span><span class="artifact-meta">尚未生成</span></div><h2>${meta.title}</h2><p class="stage-intro">${meta.copy}</p><section class="artifact-card empty-artifact"><span class="card-label"><i></i>WAITING FOR RUN</span><h3>先生成 5 个候选剧名</h3><p>故事架构确认后，系统会根据你的描述生成 5 个方向不同的中文剧名，并说明每个名称的气质与理由。</p></section>${renderNextStep()}`;
  }
  const candidates = Array.isArray(artifact.content?.candidates) ? artifact.content.candidates : [];
  const selectedTitle = state.input.storyTitle || "";
  const review = reviewForArtifact(artifact);
  const reviewContent = review?.content || {};
  const options = candidates.map((candidate, index) => {
    const title = String(candidate?.title_zh || "");
    const selected = title === selectedTitle;
    return `<button class="title-option${selected ? " is-selected" : ""}" type="button" role="radio" aria-checked="${selected}" data-title-choice="${escapeHtml(title)}"><span class="title-option-number">0${index + 1}</span><span class="title-option-body"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(candidate?.style_zh || "风格未标注")} · ${escapeHtml(candidate?.tone_zh || "")}</small><p>${escapeHtml(candidate?.reason_zh || "")}</p></span><i aria-hidden="true"></i></button>`;
  }).join("");
  const reviewLabel = state.approved.has(artifact.id) ? "本阶段已确认" : reviewContent.pass ? "互审一致性通过 · 等待选择" : `交叉审核反馈：${(reviewContent.required_changes || []).join("；") || "需要继续检查"}`;
  const reviewPanel = review ? renderReviewPanel(reviewContent, { passed: state.approved.has(artifact.id) || reviewContent.pass, stage: "title" }) : `<div class="review-summary"><strong>正在等待复核结果</strong><p>三模型复核完成后，这里会显示完整问题清单。</p></div>`;
  return `<div class="stage-kicker"><span class="eyebrow">${meta.kicker}</span><span class="artifact-meta">v${escapeHtml(artifact.version)} · ${escapeHtml(artifact.status)}</span></div><h2>${meta.title}</h2><p class="stage-intro">${meta.copy}</p><section class="title-picker" aria-labelledby="titlePickerHeading"><div class="title-picker-head"><div><span class="card-label"><i></i>TITLE OPTIONS</span><h3 id="titlePickerHeading">选一个最适合这部剧的名字</h3></div><span class="title-selection-status">${selectedTitle ? `已选：${escapeHtml(selectedTitle)}` : "尚未选择"}</span></div><div class="title-options" role="radiogroup" aria-labelledby="titlePickerHeading">${options}</div><p class="title-picker-note">5 个候选分别强调悬疑、传播、诗意、人物命运和极简记忆点。选定后会作为后续提案与正式剧本的统一剧名。</p><div class="card-footer"><small>${escapeHtml(reviewLabel)}</small>${state.approved.has(artifact.id) ? `<span class="review-button is-disabled">已确认版本</span>` : `<span class="review-button is-disabled">${selectedTitle ? "可确认" : "等待选择"}</span>`}</div></section>${reviewPanel}${renderNextStep()}`;
}

function renderArtifactStage() {
  const meta = currentMeta();
  const artifact = artifactForStage(state.stage);
  if (!artifact) {
    return `<div class="stage-kicker"><span class="eyebrow">${meta.kicker}</span><span class="artifact-meta">尚未生成</span></div><h2>${meta.title}</h2><p class="stage-intro">${meta.copy}</p><section class="artifact-card empty-artifact"><span class="card-label"><i></i>WAITING FOR RUN</span><h3>本阶段尚未有服务端产物</h3><p>完成上一阶段确认后，这里会生成当前阶段的结构化产物，并返回编排与复核结果。</p></section>${renderNextStep()}`;
  }
  const review = reviewForArtifact(artifact);
  const reviewContent = review?.content || {};
  const approved = state.approved.has(artifact.id);
  const reviewLabel = approved ? "本阶段已确认" : reviewContent.pass ? "互审一致性通过 · 等待确认" : "交叉审核已汇总完整修订清单";
  const reviewPanel = review ? renderReviewPanel(reviewContent, { passed: approved || reviewContent.pass, stage: state.stage }) : `<div class="review-summary"><strong>正在等待复核结果</strong><p>三模型复核完成后，这里会显示完整问题清单。</p></div>`;
  return `<div class="stage-kicker"><span class="eyebrow">${meta.kicker}</span><span class="artifact-meta">v${escapeHtml(artifact.version)} · ${escapeHtml(artifact.status)} · PixelTale 输出</span></div><h2>${meta.title}</h2><p class="stage-intro">${meta.copy}</p><section class="artifact-card live-artifact"><span class="card-label"><i></i>${escapeHtml(artifact.type)}</span><div class="structured-content">${renderValue(artifact.content)}</div><div class="card-footer"><small>${escapeHtml(reviewLabel)}</small>${approved ? `<span class="review-button is-disabled">已确认版本</span>` : `<span class="review-button is-disabled">${reviewContent.pass ? "等待确认" : "待修订"}</span>`}</div>${reviewPanel}</section>${renderNextStep()}`;
}

function renderHandoff() {
  const ready = handoffReady();
  const latest = state.agent?.handoffs?.at(-1);
  const scriptDocument = latest?.scriptDocument || state.agent?.scriptDocument;
  const visualAssetDocument = state.agent?.visualAssetDocument;
  const visualAssetAction = visualAssetDocument?.status === "ready"
    ? `<a class="stage-primary visual-asset-download" href="${agentApiPath("/visual-assets/download")}" download>下载视觉资产 DOCX ↗</a>`
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
  const documentActions = scriptReady
    ? `<div class="document-delivery-actions"><button type="button" class="stage-primary" data-download-script ${state.documentBusy ? "disabled" : ""}>下载剧本 DOCX <span aria-hidden="true">↓</span></button><button type="button" class="stage-secondary" data-save-script ${state.documentBusy ? "disabled" : ""}>选择文件夹并保存</button></div>`
    : "";
  return `<div class="stage-kicker"><span class="eyebrow">${currentMeta().kicker}</span><span class="artifact-meta">${ready ? "READY" : "LOCKED"}</span></div><h2>${currentMeta().title}</h2><p class="stage-intro">${ready ? "所有阶段都已确认。现在可以生成正式剧本 DOCX、视觉资产 DOCX 和版本化导出包，不覆盖既有文件。" : "先确认故事架构、剧名、提案、人物与世界、分集结构、场景镜头和英文对白，完成后即可导出。"}</p><div class="handoff-grid"><div class="handoff-tile"><strong>正式剧本</strong><span>${ready ? "中文剧情 + English Dialogue" : "等待阶段确认"}</span></div><div class="handoff-tile"><strong>结构资产</strong><span>${ready ? "人物 / 关系 / 世界规则" : "等待人物与世界"}</span></div><div class="handoff-tile"><strong>视觉资产</strong><span>${ready ? "人物 / 场景 / 道具 DOCX" : "等待全剧确认"}</span></div></div>${latest ? `<section class="artifact-card"><span class="card-label"><i></i>LAST EXPORT</span><h3>${escapeHtml(latest.id)}</h3><p>导出包已建立：${escapeHtml(latest.packageFile || "版本化文件")}</p>${visualAssetAction ? `<div class="visual-asset-download-row">${visualAssetAction}</div>` : ""}</section>` : ""}<section class="document-delivery" aria-labelledby="scriptDocumentTitle"><div class="document-delivery-head"><div><span class="card-label"><i></i>FORMAL DELIVERABLE</span><h3 id="scriptDocumentTitle">正式剧本 DOCX</h3></div><span class="document-status ${scriptReady ? "is-ready" : scriptDocument?.status === "failed" ? "is-error" : ""}">${scriptStatus}</span></div><p class="document-file-name">${escapeHtml(scriptFileName)}</p>${scriptReady ? `<label class="script-folder-field" for="scriptFolderName"><span>本地新建文件夹名称（可选）</span><input id="scriptFolderName" type="text" placeholder="留空则保存到所选文件夹" autocomplete="off" /></label>` : ""}${scriptError ? `<p class="document-error" role="alert">${escapeHtml(scriptError)}</p>` : ""}${documentActions}</section>${renderNextStep()}`;
}

function renderStage() {
  const renderer = state.stage === "brief" ? renderBrief : state.stage === "title" ? renderTitleStage : state.stage === "handoff" ? renderHandoff : renderArtifactStage;
  $("#stageContent").innerHTML = `<div class="workflow-guide" aria-label="生产流程"><div><span class="eyebrow">PRODUCTION FLOW</span><strong>步骤 ${String(stageIndex(workflowStage()) + 1).padStart(2, "0")} / ${stageOrder.length}</strong></div><div class="workflow-route"><span>当前</span><b>${escapeHtml(stageMeta[workflowStage()]?.title || "交接")}</b><i>→</i><span>完成后</span><b>${escapeHtml(stageMeta[stageOrder[stageIndex(workflowStage()) + 1]]?.title || "完成交接")}</b></div></div>${renderer()}`;
  bindStageActions();
  renderShellState();
}

async function runCurrentStage(stage = state.stage, { revisionPlan = "" } = {}) {
  if (stage === "brief") collectBriefInput();
  if (stage === "title") state.input.storyTitle = "";
  state.lastError = "";
  state.busy = true;
  renderStage();
  try {
    const payload = await request("/runs", { method: "POST", body: JSON.stringify({ stage, mode: modeValue(), input: state.input, routes: state.routes, revisionPlan }) });
    updateAgentState(payload.result?.state);
    state.lastError = payload.result?.status === "failed" ? (payload.result.errors || []).map((item) => item.message).join("；") : "";
    if (state.lastError) throw new Error(state.lastError);
    const revision = payload.result?.revision;
    showToast(payload.result?.status === "needs_review"
      ? (revision ? "交叉修订已执行，但仍有问题未通过逐项关闭" : "已生成，但三模型审核存在共识问题或意见冲突")
      : (revision ? "交叉修订已逐项复审关闭，等待确认" : "已生成并完成三模型交叉审核，等待确认"));
  } catch (error) {
    state.lastError = userFacingError(error);
    showToast(state.lastError);
  } finally {
    state.busy = false;
    renderStage();
  }
}

async function runAutoRevision(stage = state.stage) {
  const artifact = artifactForStage(stage);
  const review = reviewForArtifact(artifact);
  const content = review?.content || {};
  const issues = reviewIssueGroups(content);
  if (!artifact || !issues.length) {
    showToast("当前没有可执行的完整修订清单");
    return;
  }
  const plan = [
    "请一次性修订当前阶段的全部复核问题。保留没有问题的内容，不要只修复其中一项。",
    ...issues.map((issue, index) => {
      const evidence = Array.isArray(issue.evidence) && issue.evidence.length ? `证据：${issue.evidence.join("；")}` : "";
      const fixes = Array.isArray(issue.suggestions) && issue.suggestions.length ? issue.suggestions.join("；") : "请根据问题证据提出具体修订";
      return `${index + 1}. ${issue.tag || "待修订项"}（${issue.severity || "medium"}）：${fixes}${evidence ? `；${evidence}` : ""}`;
    }),
  ].join("\n");
  showToast(`已锁定 ${issues.length} 项问题，正在执行定向修订与逐项复审`);
  await runCurrentStage(stage, { revisionPlan: plan });
}

async function approveArtifact(artifactId) {
  state.busy = true;
  state.lastError = "";
  renderShellState();
  try {
    const payload = await request(`/artifacts/${encodeURIComponent(artifactId)}/approve`, { method: "POST", body: JSON.stringify({ selectedTitle: state.input.storyTitle || "" }) });
    updateAgentState(payload.result?.state);
    showToast("本阶段已确认，进入下一阶段");
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

async function syncAgentState({ silent = false } = {}) {
  try {
    const payload = await request("");
    updateAgentState(payload.agent);
    state.lastError = "";
    renderStage();
    if (!silent) showToast("已同步独立编剧会话");
  } catch (error) {
    state.lastError = userFacingError(error);
    if (!silent) showToast(state.lastError);
  }
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

function bindStageActions() {
  $("#runBrief")?.addEventListener("click", () => {
    if (!$("#idea")?.value.trim()) {
      state.lastError = "请在“创作想法”中写清主角、目标和阻碍，再点击“生成故事架构”。";
      $("#briefError").textContent = state.lastError;
      $("#briefError")?.classList.add("is-visible");
      $("#idea")?.focus();
      showToast(state.lastError);
      return;
    }
    runCurrentStage("brief");
  });
  $$('[data-run-stage]').forEach((button) => button.addEventListener("click", () => runCurrentStage(button.dataset.runStage)));
  $$('[data-auto-revise]').forEach((button) => button.addEventListener("click", () => runAutoRevision(button.dataset.autoRevise || state.stage)));
  $$('[data-approve-artifact]').forEach((button) => button.addEventListener("click", () => approveArtifact(button.dataset.approveArtifact)));
  $$('[data-title-choice]').forEach((button) => button.addEventListener("click", () => {
    if (state.approved.has(artifactForStage("title")?.id)) return;
    state.input.storyTitle = button.dataset.titleChoice || "";
    renderStage();
  }));
  $("#confirmHandoff")?.addEventListener("click", createHandoff);
  $("[data-download-script]")?.addEventListener("click", () => void runDocumentAction(downloadScriptDocument));
  $("[data-save-script]")?.addEventListener("click", () => void runDocumentAction(saveScriptDocument));
  $$('[data-return-current]').forEach((button) => button.addEventListener("click", () => {
    state.stage = workflowStage();
    state.lastError = "";
    renderStage();
  }));
  $("#episodeScaleRange")?.addEventListener("input", syncBriefRanges);
  $("#durationRange")?.addEventListener("input", syncBriefRanges);
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
  $$('[data-inspiration]').forEach((button) => button.addEventListener("click", () => addInspirationToIdea(button.dataset.inspiration || "")));
  if (state.stage === "brief") syncBriefRanges();
  if (state.stage === "brief") syncCreativeControls();
}

$$('[data-mode]').forEach((button) => button.addEventListener("click", async () => {
  state.mode = button.dataset.mode;
  state.input.episodeCount = state.mode === "long" ? 8 : 24;
  state.input.durationValue = state.mode === "long" ? 10 : 60;
  state.input.durationUnit = state.mode === "long" ? "min" : "sec";
  state.input.episodeScale = state.mode === "long" ? "8 chapters" : "24 episodes";
  state.input.duration = state.mode === "long" ? "10 min" : "60 sec";
  state.input.openingImpactSeconds = 3;
  state.input.openingPromise = "mainline_promise";
  state.input.hookCadence = state.mode === "long" ? "every_episode" : "every_episode";
  renderStage();
  try {
    const payload = await request("/settings", { method: "POST", body: JSON.stringify({ mode: modeValue(), routes: state.routes, input: state.input }) });
    updateAgentState(payload.agent);
    renderStage();
  } catch (error) { showToast(userFacingError(error)); }
}));

$$('[data-stage]').forEach((button) => button.addEventListener("click", () => {
  if (!stageAccessible(button.dataset.stage)) {
    showToast(`请先完成“${stageMeta[workflowStage()]?.title || "当前阶段"}”`);
    return;
  }
  state.stage = button.dataset.stage;
  state.lastError = "";
  renderStage();
}));

$("#openModelRouting").addEventListener("click", openRoutingDialog);
$("#openModelRoutingSide").addEventListener("click", openRoutingDialog);
$("#saveRouting").addEventListener("click", saveRouting);
$("#editContext").addEventListener("click", () => { state.stage = "brief"; renderStage(); $("#idea")?.focus(); });
$("#agentMenu").addEventListener("click", () => showToast("Agent 状态独立保存于 Story Forge 会话"));
function startNewDraft() {
  try {
    sessionStorage.setItem(PENDING_MODE_KEY, state.mode);
    sessionStorage.setItem(PENDING_NOTICE_KEY, "已创建新的剧集会话，请从故事架构开始。");
    const freshSession = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_STORAGE_KEY, freshSession);
  } catch {
    // A fresh in-memory session will still be created after reload.
  }
  window.location.reload();
}

$("#newDraft").addEventListener("click", startNewDraft);
$$('[data-open-stage]').forEach((button) => button.addEventListener("click", () => {
  const target = button.dataset.openStage;
  if (!stageAccessible(target)) return showToast(`请先完成“${stageMeta[workflowStage()]?.title || "当前阶段"}”`);
  state.stage = target;
  renderStage();
}));

renderStage();
syncAgentState({ silent: true });
try {
  const notice = sessionStorage.getItem(PENDING_NOTICE_KEY);
  if (notice) {
    sessionStorage.removeItem(PENDING_NOTICE_KEY);
    showToast(notice);
  }
} catch {
  // Ignore storage restrictions; the new session is still usable.
}
