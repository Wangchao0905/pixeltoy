const DEFAULT_ASSET_ANALYZER_MODEL = "claude-opus-4-8";
const WORKSPACE_LAYOUT_VERSION = "green-flow-v5-no-map";
const WORKSPACE_SCALE_KEY = `pixelToys.workspaceScale.${WORKSPACE_LAYOUT_VERSION}`;
const STUDIO_TAB_KEY = `pixelToys.activeStudioTab.${WORKSPACE_LAYOUT_VERSION}`;
const INITIAL_PROJECT_ID = new URLSearchParams(window.location.search).get("project") || "";
const WORKFLOW_PREVIEW_MODE = new URLSearchParams(window.location.search).get("preview") === "workflow";
const WORKSPACE_MODE_KEY = "pixelToys.workspaceMode";
const WORKSPACE_MODE_MIGRATION_KEY = "pixelToys.workspaceModeMigration.v2";
const WINDOW_Z_KEY = "pixelToys.windowZ";
const initialWorkspaceMode = "image";
const WORKSPACE_DESIGN_WIDTH = 1840;
const WORKSPACE_DESIGN_HEIGHT = 1160;
const FIXED_WORKSPACE_LAYOUT = true;
const IMAGE_EXPLORE_RATIO_VALUES = Object.freeze(["16:9", "4:3", "3:2", "21:9", "1:1", "4:5", "3:4", "2:3", "9:16"]);
const PROJECT_REFRESH_ACTIVE_MS = 2000;
const PROJECT_REFRESH_IDLE_MS = 30000;
const PROJECT_REFRESH_HIDDEN_MS = 15000;
const PROJECT_REFRESH_RETRY_MS = 5000;
const IMAGE_EXPLORE_HISTORY_KEY = "pixelToys.imageExploreHistory.v1";
const IMAGE_EXPLORE_STORYBOARD_HISTORY_KEY = "pixelToys.imageStoryboardHistory.v1";
const IMAGE_EXPLORE_STORYBOARD_RECOVERY_KEY = "pixelToys.imageStoryboardRecovery.v1";
const IMAGE_EXPLORE_POLL_INTERVAL_MS = 1200;
const IMAGE_EXPLORE_POLL_MAX_ATTEMPTS = 3000;
const IMAGE_EXPLORE_STORYBOARD_RECOVERY_LOOKBACK_MS = 36 * 60 * 60 * 1000;
let initialProjectHandled = false;
let teamProgressOpenToken = null;

function imageExploreStorageKey(user = null) {
  const identity = user?.id || user?.username || "anonymous";
  return `${IMAGE_EXPLORE_HISTORY_KEY}.${identity}`;
}

function imageExploreStoryboardStorageKey(user = null) {
  const identity = user?.id || user?.username || "anonymous";
  return `${IMAGE_EXPLORE_STORYBOARD_HISTORY_KEY}.${identity}`;
}

function imageExploreStoryboardRecoveryStorageKey(user = null) {
  const identity = user?.id || user?.username || "anonymous";
  return `${IMAGE_EXPLORE_STORYBOARD_RECOVERY_KEY}.${identity}`;
}

function layoutStorageKey(key, user = null) {
  const identity = String(user?.id || user?.username || "anonymous")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_") || "anonymous";
  return `${key}.${identity}`;
}

function normalizeStoredWorkspaceMode(value) {
  const mode = String(value || "").trim();
  return ["script", "image", "shots", "storyboard", "video", "assets"].includes(mode) ? mode : "image";
}

function normalizeStoredStudioTab(value) {
  const tab = String(value || "").trim();
  return ["assets", "storyboards", "shots", "video", "logs"].includes(tab) ? tab : "assets";
}

function readImageExploreHistory(user = null) {
  try {
    const value = JSON.parse(localStorage.getItem(imageExploreStorageKey(user)) || "[]");
    return Array.isArray(value)
      ? value
        .filter((item) => (item?.status === "running" && item?.taskId) || (item?.status === "completed" && item?.url) || (item?.status === "failed" && item?.message))
        .slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

function readImageExploreStoryboardHistory(user = null) {
  try {
    const value = JSON.parse(localStorage.getItem(imageExploreStoryboardStorageKey(user)) || "[]");
    return Array.isArray(value)
      ? value
        .filter((item) => (item?.status === "running" && item?.taskId) || (item?.status === "completed" && item?.url) || (item?.status === "failed" && item?.message))
        .slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

function automaticWorkspaceScale() {
  const width = window.innerWidth || 1440;
  if (width <= 900) return 1;
  return Math.max(0.62, Math.min(1, Math.round(((width - 72) / WORKSPACE_DESIGN_WIDTH) * 100) / 100));
}

function initialWorkspaceScale(user = null) {
  const saved = Number(localStorage.getItem(layoutStorageKey(WORKSPACE_SCALE_KEY, user)));
  return Number.isFinite(saved) && saved > 0 ? saved : automaticWorkspaceScale();
}

function normalizeAssetAnalyzerModel(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_ASSET_ANALYZER_MODEL;
  const lower = raw.toLowerCase();
  if (lower === "claude-code-4.8" || lower === "claude code 4.8" || lower === "claude opus 4.8") {
    return DEFAULT_ASSET_ANALYZER_MODEL;
  }
  return raw;
}

const state = {
  projects: [],
  selectedId: "",
  project: null,
  authUser: null,
  team: null,
  teamInvite: null,
  teamPanelOpen: false,
  teamResources: [],
  teamResourceType: "asset-image",
  teamResourcePanelOpen: false,
  ui: { exploreEnabled: false },
  exploreEnabled: false,
  exploreView: "canvas",
  // attachments: 待发送的资产图（从资产库或本地拖入），发出后并入该条 user 消息
  superPixel: { model: "claude-opus-5", mode: "ask", messages: [], scriptText: "", scriptName: "", sending: false, controller: null, attachments: [] },
  exploreProjectSearch: "",
  exploreCanvasFilter: "all",
  exploreScopeFilter: "all",
  blankCanvases: [],
  imageStudio: {
    history: readImageExploreHistory(),
    storyboardHistory: readImageExploreStoryboardHistory(),
    prompt: "",
    model: "gpt-image-2",
    ratio: "16:9",
    resolution: "1k",
    count: 1,
    storyboardMode: false,
    storyboardCount: 1,
    storyboardGenerating: false,
    storyboardActiveBatchId: "",
    references: [],
    referencesUploading: 0,
    activeGenerations: 0,
    generating: false,
  },
  assetLibrary: {
    assets: [],
    search: "",
    loaded: false,
    workflowExpanded: false,
  },
  activeWorkspaceMode: initialWorkspaceMode,
  activeJobId: "",
  assetAnalyzerModel: normalizeAssetAnalyzerModel(localStorage.getItem("pixelToys.assetAnalyzerModel")),
  assetStylePreset: localStorage.getItem("pixelToys.assetStylePreset") || "cg_3d",
  assetStyleCustom: localStorage.getItem("pixelToys.assetStyleCustom") || "",
  selectedAssetId: "",
  assetPromptDrafts: new Map(),
  assetInspectorOpen: false,
  selectedVideoShotName: "",
  videoPromptDrafts: new Map(),
  videoPromptInspectorOpen: false,
  manualAssetType: "",
  manualAssetDraft: { label: "", description: "", evidence: "", quality: "1k", references: [] },
  shouldFocusManualAsset: false,
  selectedAssetIds: new Set(),
  optimisticAssetJobs: new Map(),
  dialogueLanguage: localStorage.getItem("pixelToys.dialogueLanguage") || "en",
  assumeEnglishDialogue: localStorage.getItem("pixelToys.assumeEnglishDialogue") === "1",
  workspaceScale: initialWorkspaceScale(),
  assetUploadTargetId: "",
  referenceKitEditingId: "",
  referenceKitDraft: null,
  hydrating: false,
  uiBusy: {
    assetExtracting: false,
    draftGenerating: false,
    projectCreating: false,
  },
  loadProjectToken: null,
  activeWindowZ: Number(localStorage.getItem(layoutStorageKey(WINDOW_Z_KEY)) || 20),
  activeStudioTab: "assets",
  modernStudio: { shotIndex: 0, copyTab: "story", detailsOpen: false },
};
localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);

const WINDOW_LAYOUT_VERSION = `studio-${WORKSPACE_LAYOUT_VERSION}`;
const DEFAULT_WINDOWS = {
  script: { left: 24, top: 24, width: 430, height: 620 },
  manifest: { left: 478, top: 24, width: 420, height: 620 },
  assets: { left: 922, top: 24, width: 560, height: 780 },
  video: { left: 1506, top: 24, width: 310, height: 620 },
  storyboards: { left: 24, top: 672, width: 874, height: 420 },
};
const ASSET_STYLE_PRESETS = {
  photoreal: {
    label: "超写实",
    cue: "真实摄影、真人电影质感、自然材质和真实镜头",
  },
  cg_3d: {
    label: "3D 渲染 / CG 质感",
    cue: "3D渲染风格的游戏人物角色，后续按资产细节描述执行",
  },
  pixar_3d: {
    label: "皮克斯 / 迪士尼 3D",
    cue: "温润圆润、富有情感的合家欢 3D 质感",
  },
  ghibli_miyazaki: {
    label: "宫崎骏 / 吉卜力",
    cue: "手绘水彩、自然光、怀旧治愈的 2D 动画质感",
  },
  retro_american_cel: {
    label: "复古美式赛璐璐",
    cue: "80s-90s 卡通、粗描边、复古印刷颗粒",
  },
  american_bold_toon: {
    label: "美式粗线条",
    cue: "3D卡通渲染、赛璐璐阴影、粗线条角色、科技蓝点缀、非写实",
  },
  modern_anime_cel: {
    label: "日式动漫赛璐璐",
    cue: "现代 TV 动画、干净线稿、二分阴影和高光",
  },
  american_painterly: {
    label: "美式厚涂插画",
    cue: "游戏原画、厚笔触、电影光影和史诗氛围",
  },
  claymation: {
    label: "定格动画 / 黏土",
    cue: "手工黏土、微缩布景、触感材质和轻微瑕疵",
  },
  chinese_ink: {
    label: "水墨 / 国风",
    cue: "留白、写意、宣纸纹理和流动墨韵",
  },
  pixel_art: {
    label: "复古像素",
    cue: "8-bit / 16-bit 游戏感、有限调色板和清晰像素网格",
  },
  custom: {
    label: "自定义",
    cue: "完全按自定义风格补充执行",
  },
};

const VIDEO_MODEL_OPTIONS = {
  "seedance-2-0": "Seedance 2.0",
  "seedance-2-0-fast": "Seedance 2.0 Fast",
  "seedance-2-0-mini": "Seedance 2.0 Mini",
  "seedance-2-0-person-reference": "Seedance 2.0 人物素材参考",
  "seedance-2-0-byteplus": "Seedance 2.0（海外火山）",
};

function mergeCanvasAssetState(existing = {}, incoming = {}) {
  const existingActive = String(existing.validationStatus || "").toLowerCase() === "active" && /^asset:\/\//i.test(existing.assetUrl || "");
  const incomingActive = String(incoming.validationStatus || "").toLowerCase() === "active" && /^asset:\/\//i.test(incoming.assetUrl || "");
  if (existingActive && !incomingActive) {
    return {
      ...incoming,
      assetUrl: existing.assetUrl || incoming.assetUrl,
      publicUrl: existing.publicUrl || incoming.publicUrl,
      virtualId: existing.virtualId || incoming.virtualId,
      validationStatus: existing.validationStatus,
      validationError: existing.validationError || "",
      groupId: existing.groupId || incoming.groupId,
    };
  }
  return { ...existing, ...incoming };
}

function normalizeVideoModelName(value) {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return "seedance-2-0-fast";
  if (VIDEO_MODEL_OPTIONS[raw]) return raw;
  if (/person|人物|真人|liveness/.test(lower)) return "seedance-2-0-person-reference";
  if (/fast|快速/.test(lower)) return "seedance-2-0-fast";
  return "seedance-2-0";
}

function videoModelLabel(value) {
  const normalized = normalizeVideoModelName(value);
  return VIDEO_MODEL_OPTIONS[normalized] || VIDEO_MODEL_OPTIONS["seedance-2-0"];
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.add("hidden"), 3200);
}

async function withStudioButtonFeedback(button, action) {
  if (!(button instanceof HTMLElement) || !document.body.classList.contains("is-studio")) return action();
  if (button.dataset.studioFeedbackBusy === "true") return undefined;
  const wasDisabled = button.disabled;
  button.dataset.studioFeedbackBusy = "true";
  button.classList.remove("is-complete", "is-error");
  button.classList.add("is-working");
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    const result = await action();
    button.classList.add("is-complete");
    clearTimeout(button._studioFeedbackTimer);
    button._studioFeedbackTimer = setTimeout(() => button.classList.remove("is-complete"), 720);
    return result;
  } catch (error) {
    button.classList.add("is-error");
    clearTimeout(button._studioFeedbackTimer);
    button._studioFeedbackTimer = setTimeout(() => button.classList.remove("is-error"), 1200);
    throw error;
  } finally {
    button.disabled = wasDisabled;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-working");
    delete button.dataset.studioFeedbackBusy;
  }
}

function bindStudioButtonFeedback() {
  const press = (target) => {
    const button = target?.closest?.("button, [role='button'], .upload-pill");
    if (!button || !document.body.classList.contains("is-studio") || button.matches(":disabled, [aria-disabled='true']")) return;
    button.classList.add("is-pressed");
    clearTimeout(button._studioPressTimer);
    button._studioPressTimer = setTimeout(() => button.classList.remove("is-pressed"), 150);
  };
  document.addEventListener("pointerdown", (event) => press(event.target), true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") press(event.target);
  }, true);
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    const detail = error?.name === "AbortError" ? "请求超时" : error?.message || "网络连接失败";
    throw new Error(`${path} 请求失败：${detail}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`${path} 返回了无效响应（HTTP ${res.status}）`);
  }
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error || data.message || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function clearLegacyLayoutPreferences() {
  for (const key of [WORKSPACE_MODE_KEY, WORKSPACE_MODE_MIGRATION_KEY, WORKSPACE_SCALE_KEY, STUDIO_TAB_KEY, WINDOW_Z_KEY]) {
    localStorage.removeItem(key);
  }
}

function restoreWorkspacePreferences(user = null) {
  const savedMode = localStorage.getItem(layoutStorageKey(WORKSPACE_MODE_KEY, user));
  const savedTab = localStorage.getItem(layoutStorageKey(STUDIO_TAB_KEY, user));
  const savedWindowZ = Number(localStorage.getItem(layoutStorageKey(WINDOW_Z_KEY, user)) || 20);
  state.activeWorkspaceMode = normalizeStoredWorkspaceMode(savedMode);
  state.activeStudioTab = normalizeStoredStudioTab(savedTab);
  state.workspaceScale = initialWorkspaceScale(user);
  state.activeWindowZ = Number.isFinite(savedWindowZ) ? savedWindowZ : 20;
}

async function syncAuthUser() {
  const label = $("#authUserLabel");
  const exploreLabel = $("#exploreAuthUserLabel");
  const exploreLoginLink = $("#exploreLoginLink");
  const adminLink = $("#adminLink");
  const exploreAdminLink = $("#exploreAdminLink");
  const exploreTeamButton = $("#exploreTeamButton");
  const exploreRefresh = $("#exploreRefresh");
  const exploreAccount = $("#exploreAccount");
  const canvasCard = $(".canvas-entry-card");
  // Super Pixel 仍在开发中，入口仅对管理员开放
  const superPixelEntry = $('[data-explore-tool="super-pixel"]');
  if (!label) return;
  try {
    const data = await api("/api/auth/me");
    state.authUser = data.user || null;
    restoreWorkspacePreferences(state.authUser);
    clearLegacyLayoutPreferences();
    state.imageStudio.history = readImageExploreHistory(state.authUser);
    state.imageStudio.storyboardHistory = readImageExploreStoryboardHistory(state.authUser);
    renderImageExploreView();
    recoverImageExploreStoryboards().catch(() => {});
    resumeImageExploreGenerations().catch(() => {});
    const authDisplayName = data.user?.role === "admin"
      ? data.user?.username || "superadmin"
      : data.user?.displayName || data.user?.username || "";
    label.textContent = authDisplayName;
    if (exploreLabel) exploreLabel.textContent = authDisplayName;
    adminLink?.classList.toggle("hidden", data.user?.role !== "admin");
    exploreLoginLink?.classList.toggle("hidden", !!data.user);
    exploreAdminLink?.classList.toggle("hidden", data.user?.role !== "admin");
    superPixelEntry?.classList.toggle("hidden", data.user?.role !== "admin");
    exploreTeamButton?.classList.toggle("hidden", !data.user);
    exploreRefresh?.classList.toggle("hidden", !data.user);
    exploreAccount?.classList.toggle("hidden", !data.user);
    canvasCard?.classList.toggle("hidden", !data.user?.canvasEnabled);
    if (data.user?.canvasEnabled) loadBlankCanvasList().catch(() => {});
    loadTeam().catch((error) => toast(error.message));
  } catch {
    state.authUser = null;
    restoreWorkspacePreferences(null);
    clearLegacyLayoutPreferences();
    state.imageStudio.history = readImageExploreHistory();
    state.imageStudio.storyboardHistory = readImageExploreStoryboardHistory();
    renderImageExploreView();
    label.textContent = "";
    if (exploreLabel) exploreLabel.textContent = "";
    exploreLoginLink?.classList.remove("hidden");
    adminLink?.classList.add("hidden");
    exploreAdminLink?.classList.add("hidden");
    superPixelEntry?.classList.add("hidden");
    exploreTeamButton?.classList.add("hidden");
    exploreRefresh?.classList.add("hidden");
    exploreAccount?.classList.add("hidden");
    canvasCard?.classList.add("hidden");
    state.team = null;
    renderTeamPanel();
  }
}

async function loadTeam() {
  const data = await api("/api/team");
  state.team = data.team || null;
  if (!state.team) state.teamInvite = null;
  renderTeamPanel();
  $("#teamResourceButton")?.classList.toggle("hidden", !state.team || !state.selectedId);
  if (!state.team) {
    state.teamResourcePanelOpen = false;
    state.teamResources = [];
    renderTeamResourcePanel();
  }
  return state.team;
}

function teamRoleLabel(role = "") {
  return role === "owner" ? "Owner" : "Member";
}

function teamInviteExpiryLabel(iso = "") {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return `有效至 ${new Date(time).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

const TEAM_PROGRESS_STAGES = [
  { id: "script", label: "剧本" },
  { id: "assets", label: "资产" },
  { id: "storyboard", label: "故事板" },
  { id: "video", label: "视频" },
];

function normalizeTeamProgressStage(stage = "") {
  const normalized = String(stage || "");
  return ["script", "assets", "storyboard", "video", "complete"].includes(normalized) ? normalized : "script";
}

function teamProgressWorkspaceMode(stage = "") {
  const normalized = normalizeTeamProgressStage(stage);
  if (normalized === "assets") return "assets";
  if (normalized === "storyboard") return "storyboard";
  if (normalized === "video" || normalized === "complete") return "video";
  return "script";
}

function teamProjectProgressHtml(project = {}) {
  const stage = normalizeTeamProgressStage(project.progress?.stage);
  const currentIndex = stage === "complete" ? TEAM_PROGRESS_STAGES.length : TEAM_PROGRESS_STAGES.findIndex((item) => item.id === stage);
  const counts = project.counts || {};
  const stageLabel = stage === "complete" ? "完成" : TEAM_PROGRESS_STAGES.find((item) => item.id === stage)?.label || "剧本";
  const rail = TEAM_PROGRESS_STAGES.map((item, index) => {
    const stateClass = index < currentIndex || stage === "complete" ? "is-complete" : index === currentIndex ? "is-current" : "is-pending";
    const currentAttribute = stateClass === "is-current" ? ` aria-current="step"` : "";
    return `<span class="${stateClass}"${currentAttribute}>${escapeHtml(item.label)}</span>`;
  }).join("");
  const attention = String(project.progress?.attention || "").trim();
  const editor = project.progress?.lastModifiedByUsername || "-";
  const updated = blankCanvasTimeLabel(project.progress?.lastModifiedAt || project.updatedAt || "") || "刚刚";
  return `<button class="team-progress-item" type="button" data-team-open-project="${escapeAttr(project.id)}" data-team-stage="${escapeAttr(stage)}">
    <span class="team-progress-heading"><strong>${escapeHtml(displayProjectTitle(project))}</strong><small>${escapeHtml(stageLabel)}</small></span>
    <span class="team-progress-rail" aria-label="项目进度">${rail}</span>
    <span class="team-progress-counts">资产 ${Number(counts.assets || 0)}/${Number(counts.plannedAssets || 0)} · 故事板 ${Number(counts.storyboards || 0)}/${Number(counts.plannedStoryboards || 0)} · 视频 ${Number(counts.rawClips || 0)}/${Number(counts.plannedShots || 0)}</span>
    ${attention ? `<span class="team-progress-attention">${escapeHtml(attention)}</span>` : ""}
    <span class="team-progress-editor">${escapeHtml(editor)} · ${escapeHtml(updated)}</span>
  </button>`;
}

function renderTeamPanel() {
  const panel = $("#teamPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !state.teamPanelOpen);
  const empty = $("#teamEmptyState");
  const memberState = $("#teamMemberState");
  empty?.classList.toggle("hidden", !!state.team);
  memberState?.classList.toggle("hidden", !state.team);
  if (!state.team) {
    $("#teamPanelTitle").textContent = "Team";
    return;
  }

  const owner = state.team.role === "owner";
  $("#teamPanelTitle").textContent = state.team.name || "Team";
  $("#teamSummary").innerHTML = `
    <div class="team-summary-row">
      <span class="scope-badge is-team">${escapeHtml(teamRoleLabel(state.team.role))}</span>
      <span>${state.team.members?.length || 0} members</span>
    </div>`;

  const teamProjects = state.projects.filter((project) => project.scope === "team" && project.teamId === state.team.id);
  $("#teamProjectProgress").innerHTML = teamProjects.length
    ? teamProjects
        .slice(0, 6)
        .map((project) => teamProjectProgressHtml(project))
        .join("")
    : `<span class="team-panel-empty">No team projects</span>`;

  $("#teamMemberList").innerHTML = (state.team.members || [])
    .map(
      (member) => `<div class="team-member-row">
        <span><strong>${escapeHtml(member.displayName || member.username || member.userId)}</strong><small>${escapeHtml(teamRoleLabel(member.role))}</small></span>
        ${
          owner && member.userId !== state.authUser?.id
            ? `<span class="team-member-actions">
                <button type="button" data-team-transfer="${escapeAttr(member.userId)}" title="转移团队">⇄</button>
                <button type="button" data-team-remove="${escapeAttr(member.userId)}" title="移出团队">×</button>
              </span>`
            : ""
        }
      </div>`,
    )
    .join("");

  $("#teamOwnerControls").innerHTML = owner
    ? `<div class="team-invite-controls">
        <button class="ghost small" type="button" data-team-generate-invite>生成 7 天邀请码</button>
        ${state.teamInvite?.code ? `<code>${escapeHtml(state.teamInvite.code)}</code><span>${escapeHtml(teamInviteExpiryLabel(state.teamInvite.expiresAt) || state.teamInvite.expiresAt)}</span>` : ""}
        ${state.team.inviteExpiresAt || state.teamInvite ? `<button type="button" data-team-revoke-invite>停用邀请码</button>` : ""}
      </div>`
    : "";
  $("#leaveTeamButton")?.classList.toggle("hidden", owner);
}

async function createTeam(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = new FormData(form).get("name")?.toString().trim() || "";
  const data = await api("/api/team", { method: "POST", body: JSON.stringify({ name }) });
  state.team = data.team || null;
  form.reset();
  await loadProjects(false);
  renderTeamPanel();
  toast("团队已创建");
}

async function joinTeam(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const code = new FormData(form).get("code")?.toString().trim() || "";
  const data = await api("/api/team/join", { method: "POST", body: JSON.stringify({ code }) });
  state.team = data.team || null;
  form.reset();
  await loadProjects(false);
  if (userHasCanvasPermission()) await loadBlankCanvasList();
  renderTeamPanel();
  toast("已加入团队");
}

async function leaveTeam() {
  if (!window.confirm("退出团队后将立即失去团队项目访问权，是否继续？")) return;
  await api("/api/team/leave", { method: "POST", body: JSON.stringify({}) });
  state.team = null;
  state.teamInvite = null;
  state.exploreScopeFilter = "all";
  await loadProjects(false);
  if (userHasCanvasPermission()) await loadBlankCanvasList();
  renderTeamPanel();
  toast("已退出团队");
}

async function generateTeamInvite() {
  const data = await api("/api/team/invite", { method: "POST", body: JSON.stringify({}) });
  state.teamInvite = data.invite || null;
  if (state.team) state.team.inviteExpiresAt = data.invite?.expiresAt || "";
  renderTeamPanel();
}

async function revokeTeamInvite() {
  await api("/api/team/invite", { method: "DELETE" });
  state.teamInvite = null;
  if (state.team) state.team.inviteExpiresAt = "";
  renderTeamPanel();
}

async function removeTeamMember(userId) {
  if (!window.confirm("将该成员移出团队？")) return;
  const data = await api(`/api/team/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  state.team = data.team || state.team;
  renderTeamPanel();
}

async function transferTeamOwnership(userId) {
  if (!window.confirm("确认将团队所有权转移给该成员？")) return;
  const data = await api("/api/team/transfer", { method: "POST", body: JSON.stringify({ userId }) });
  state.team = data.team || state.team;
  state.teamInvite = null;
  renderTeamPanel();
}

function teamReferenceStatusLabel(status = "") {
  if (status === "new-version") return "New version";
  if (status === "source-unavailable") return "Source unavailable";
  return "Current";
}

function renderTeamResourcePanel() {
  const panel = $("#teamResourcePanel");
  const list = $("#teamResourceList");
  if (!panel || !list) return;
  const visible = !!state.team && !!state.selectedId && state.teamResourcePanelOpen;
  panel.classList.toggle("hidden", !visible);
  $("#teamResourceButton")?.classList.toggle("hidden", !state.team || !state.selectedId);
  $$('[data-team-resource-type]').forEach((button) => button.classList.toggle("is-active", button.dataset.teamResourceType === state.teamResourceType));
  if (!visible) return;

  const references = state.project?.teamReferences || [];
  const referenceHtml = references.length
    ? `<div class="team-reference-current">${references
        .map(
          (reference) => `<article>
            <div>
              <strong>${escapeHtml(reference.snapshot?.label || reference.sourceResourceId)}</strong>
              <span>${escapeHtml(reference.snapshot?.sourceProjectName || reference.sourceProjectId)}</span>
            </div>
            <span class="team-reference-status ${escapeAttr(reference.status || "current")}">${escapeHtml(teamReferenceStatusLabel(reference.status))}</span>
            ${reference.status === "new-version" ? `<button type="button" data-team-reference-update="${escapeAttr(reference.id)}">Update</button>` : ""}
          </article>`,
        )
        .join("")}</div>`
    : "";
  const resourceHtml = state.teamResources.length
    ? state.teamResources
        .map(
          (resource, index) => `<article class="team-resource-row">
            ${resource.previewUrl ? `<img src="${escapeAttr(resource.previewUrl)}" alt="" loading="lazy" />` : `<span class="team-resource-shot">▤</span>`}
            <div><strong>${escapeHtml(resource.label)}</strong><span>${escapeHtml(resource.sourceProjectName || "")}</span></div>
            <button type="button" data-team-resource-index="${index}">Reference</button>
          </article>`,
        )
        .join("")
    : `<span class="team-panel-empty">No team resources</span>`;
  list.innerHTML = `${referenceHtml}${resourceHtml}`;
}

async function loadTeamResources(type = "asset-image") {
  state.teamResourceType = type;
  const data = await api(`/api/team/resources?type=${encodeURIComponent(type)}`);
  state.teamResources = data.resources || [];
  renderTeamResourcePanel();
}

async function referenceTeamResource(resource) {
  if (!state.selectedId || !resource) return;
  const data = await api(`/api/project/${state.selectedId}/references`, {
    method: "POST",
    body: JSON.stringify({
      sourceProjectId: resource.sourceProjectId,
      sourceResourceType: resource.sourceResourceType,
      sourceResourceId: resource.sourceResourceId,
    }),
  });
  setProjectState(data);
  renderWorkspace();
  toast("已引用团队资源");
}

async function updateTeamReference(referenceId) {
  if (!state.selectedId) return;
  const data = await api(`/api/project/${state.selectedId}/references/${encodeURIComponent(referenceId)}/update`, { method: "POST" });
  setProjectState(data);
  renderWorkspace();
  toast("引用已更新");
}

function userHasCanvasPermission() {
  return !!state.authUser?.canvasEnabled;
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  window.location.href = "/auth.html";
}

function openChangePasswordDialog() {
  const dialog = $("#changePasswordDialog");
  const form = $("#changePasswordForm");
  const message = $("#changePasswordMessage");
  if (!dialog || !form) return;
  form.reset();
  if (message) message.textContent = "";
  dialog.showModal();
}

function syncPersonalCenter() {
  const user = state.authUser || {};
  const displayName = user.role === "admin" ? user.username || "superadmin" : user.displayName || user.username || "";
  if ($("#personalCenterName")) $("#personalCenterName").textContent = displayName;
  if ($("#personalCenterUsername")) $("#personalCenterUsername").textContent = user.username ? `用户名：${user.username}` : "";
  if ($("#personalCenterRole")) $("#personalCenterRole").textContent = user.role === "admin" ? "管理员账户" : "普通账户";
}

function openPersonalCenter() {
  const dialog = $("#personalCenterDialog");
  if (!dialog) return;
  syncPersonalCenter();
  dialog.showModal();
}

function closePersonalCenter() {
  $("#personalCenterDialog")?.close();
}

function closeChangePasswordDialog() {
  $("#changePasswordDialog")?.close();
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $("#changePasswordMessage");
  const submit = form.querySelector('button[type="submit"]');
  const currentPassword = form.currentPassword.value;
  const newPassword = form.newPassword.value;
  const confirmPassword = form.confirmPassword.value;
  if (newPassword !== confirmPassword) {
    if (message) message.textContent = "两次输入的新密码不一致";
    return;
  }
  if (submit) submit.disabled = true;
  if (message) message.textContent = "正在保存...";
  try {
    await api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (message) message.textContent = "密码已修改";
    toast("密码已修改");
    setTimeout(() => closeChangePasswordDialog(), 500);
  } catch (error) {
    if (message) message.textContent = error.message || "修改失败";
  } finally {
    if (submit) submit.disabled = false;
  }
}

function fmtBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = value;
  let i = 0;
  while (n > 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

// 分镜(视频提示词)可编辑表格:把 seedance 提示词文档按镜头拆成行,每行一个可编辑的提示词。
// 编辑只回写 #seedanceText(后备存储,保存/生成视频配置仍读它),保留文档其余部分(标题/生成来源)。
let seedanceShotPieces = null;

function parseSeedanceShotPieces(md) {
  const parts = String(md || "").split(/\n(?=##\s+)/);
  return parts.map((content) => {
    const heading = content.match(/^##\s+(.+?)\s*(?:\n|$)/);
    const id = heading ? heading[1].trim() : "";
    const isShot =
      !!id &&
      (/v\d+/i.test(id) ||
        (/(?:参考资产|参考映射)[:：]/.test(content) && /(?:推荐时长|时长|duration)/i.test(content)));
    if (!isShot) return { type: "text", content };
    const duration = (content.match(/推荐时长[:：]\s*([0-9]+)/) || [])[1] || "";
    const refs = ((content.match(/参考资产[:：]\s*(.+)/) || [])[1] || "").trim();
    const fence = content.match(/```text\s*\n([\s\S]*?)\n```/);
    return { type: "shot", id, duration, refs, prompt: fence ? fence[1] : content, hasFence: !!fence, content };
  });
}

function serializeSeedanceShotPieces(pieces) {
  return (pieces || []).map((p) => p.content).join("\n");
}

function applyShotPromptEdit(piece, nextPrompt) {
  piece.prompt = nextPrompt;
  if (piece.hasFence) {
    piece.content = piece.content.replace(/```text\s*\n[\s\S]*?\n```/, "```text\n" + nextPrompt + "\n```");
  } else {
    piece.content = piece.content.replace(/(^##\s+.+?\n)[\s\S]*/, `$1${nextPrompt}`);
  }
}

function renderShotsTable() {
  const container = document.querySelector("#shotsTable");
  if (!container) return;
  const raw = document.querySelector("#seedanceText")?.value || "";
  seedanceShotPieces = parseSeedanceShotPieces(raw);
  const shots = seedanceShotPieces.filter((p) => p.type === "shot");
  if (!shots.length) {
    container.innerHTML = `<div class="shots-empty">还没有分镜。请先到「剧本」点「生成分镜草稿」,分镜会按镜头逐条显示在这里。</div>`;
    return;
  }
  const rows = seedanceShotPieces
    .map((p, index) => {
      if (p.type !== "shot") return "";
      const kitShot = (state.project?.referenceKitShots || []).find((shot) => shot.name === p.id || shot.id === p.id);
      const kit = kitShot?.referenceKitId ? (state.project?.referenceKits || []).find((item) => item.id === kitShot.referenceKitId) : null;
      return `<div class="shot-row">
        <div class="shot-cell shot-meta">
          <strong>${escapeHtml(p.id)}</strong>
          ${p.duration ? `<span class="shot-dur">${escapeHtml(p.duration)}s</span>` : ""}
          ${p.refs ? `<span class="shot-refs">参考：${escapeHtml(p.refs)}</span>` : ""}
          ${kit ? `<span class="shot-reference-kit">KIT · ${escapeHtml(kit.name)} v${kitShot.referenceKitVersion || kit.version}</span>` : ""}
        </div>
        <textarea class="shot-prompt editor" data-shot-index="${index}" rows="7" aria-label="镜头 ${escapeAttr(p.id)} 视频提示词">${escapeHtml(p.prompt)}</textarea>
      </div>`;
    })
    .join("");
  container.innerHTML = `<div class="shots-table-inner"><div class="shots-table-hint">共 ${shots.length} 个镜头,可逐条修改提示词,确认后点「生成视频配置」。</div>${rows}</div>`;
  container.querySelectorAll("textarea[data-shot-index]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const idx = Number(textarea.dataset.shotIndex);
      const piece = seedanceShotPieces[idx];
      if (!piece) return;
      applyShotPromptEdit(piece, textarea.value);
      const backing = document.querySelector("#seedanceText");
      if (backing) backing.value = serializeSeedanceShotPieces(seedanceShotPieces);
    });
  });
}

function shortPath(value) {
  if (!value) return "";
  const parts = value.split("/");
  return parts.length > 5 ? `.../${parts.slice(-5).join("/")}` : value;
}

function shortUuid(value) {
  if (!value) return "";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function displayProjectTitle(project = {}) {
  const seriesTitle = project.seriesTitle || project.title || project.scriptTitle || "未命名项目";
  const episodeTitle = project.episodeLabel || project.episodeCode || project.episodeSlug || "";
  return project.displayTitle || [seriesTitle, episodeTitle].filter(Boolean).join(" / ");
}

function projectNeedsDisplayName(project = {}) {
  const title = String(project.title || project.seriesTitle || "").trim();
  return !title || title === "项目名称未设置" || title === "未命名项目";
}

function workspaceLayoutKey() {
  return layoutStorageKey(`pixelToys.windowLayout.${WINDOW_LAYOUT_VERSION}.${state.selectedId || "default"}`, state.authUser);
}

function readWindowLayout() {
  try {
    return JSON.parse(localStorage.getItem(workspaceLayoutKey()) || "{}");
  } catch {
    return {};
  }
}

function writeWindowLayout(layout) {
  localStorage.setItem(workspaceLayoutKey(), JSON.stringify(layout));
}

function hydrateWorkspaceItems() {
  $$("#workspace .draggable-window").forEach((element) => {
    element.classList.add("workspace-item");
    if (element.dataset.windowId === "storyboards") {
      element.classList.remove("hidden");
      element.removeAttribute("aria-hidden");
    }
  });
}

function workspaceBaseSize(workspace) {
  const viewport = $("#workspaceViewport");
  const rect = viewport?.getBoundingClientRect() || workspace.getBoundingClientRect();
  return {
    width: Math.max(WORKSPACE_DESIGN_WIDTH, Math.round((rect.width || window.innerWidth) / Math.max(0.5, state.workspaceScale))),
    height: Math.max(WORKSPACE_DESIGN_HEIGHT, Math.round((rect.height || window.innerHeight) / Math.max(0.5, state.workspaceScale))),
  };
}

function updateWorkspaceSize() {
  const workspace = $("#workspace");
  if (!workspace || $("#workspaceViewport")?.classList.contains("hidden") || window.matchMedia("(max-width: 900px)").matches) return;
  if (FIXED_WORKSPACE_LAYOUT) {
    workspace.style.width = "";
    workspace.style.height = "";
    workspace.style.setProperty("--workspace-scale", "1");
    return;
  }
  const base = workspaceBaseSize(workspace);
  let maxRight = base.width;
  let maxBottom = base.height;
  $$(".workspace-item").forEach((element) => {
    if (element.classList.contains("hidden")) return;
    maxRight = Math.max(maxRight, element.offsetLeft + element.offsetWidth + 96);
    maxBottom = Math.max(maxBottom, element.offsetTop + element.offsetHeight + 120);
  });
  workspace.style.width = `${Math.ceil(maxRight)}px`;
  workspace.style.height = `${Math.ceil(maxBottom)}px`;
  workspace.style.setProperty("--workspace-scale", String(state.workspaceScale));
}

function clampWindowRect(rect, workspace, element) {
  const padding = 28;
  const maxWidth = element?.dataset?.windowId === "relation" ? 1900 : Math.max(520, workspace.offsetWidth - padding * 2);
  const maxHeight = element?.dataset?.windowId === "relation" ? 760 : Math.max(320, workspace.offsetHeight - padding * 2);
  const width = Math.max(320, Math.min(maxWidth, rect.width || element.offsetWidth || 520));
  const height = Math.max(220, Math.min(maxHeight, rect.height || element.offsetHeight || 260));
  return {
    left: Math.max(padding, rect.left ?? element.offsetLeft),
    top: Math.max(padding, rect.top ?? element.offsetTop),
    width,
    height,
  };
}

function applyWindowLayout() {
  const workspace = $("#workspace");
  if (!workspace || window.matchMedia("(max-width: 900px)").matches) {
    $$(".workspace-item").forEach((element) => {
      element.style.left = "";
      element.style.top = "";
      element.style.width = "";
      element.style.height = "";
      element.style.zIndex = "";
    });
    return;
  }
  if (FIXED_WORKSPACE_LAYOUT) {
    state.workspaceScale = 1;
    workspace.style.setProperty("--workspace-scale", "1");
    const zoomLabel = $("#zoomLabel");
    if (zoomLabel) zoomLabel.textContent = "固定";
    $$(".workspace-item").forEach((element) => {
      element.style.left = "";
      element.style.top = "";
      element.style.width = "";
      element.style.height = "";
      element.style.zIndex = "";
    });
    updateWorkspaceSize();
    return;
  }
  workspace.style.setProperty("--workspace-scale", String(state.workspaceScale));
  $("#zoomLabel").textContent = `${Math.round(state.workspaceScale * 100)}%`;
  const layout = readWindowLayout();
  $$(".workspace-item").forEach((element) => {
    const id = element.dataset.windowId;
    const fallback = DEFAULT_WINDOWS[id] || { left: 40, top: 40, width: 520, height: 360 };
    const rect = clampWindowRect({ ...fallback, ...(layout[id] || {}) }, workspace, element);
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    element.style.zIndex = String(layout[id]?.z || element.style.zIndex || 1);
  });
  updateWorkspaceSize();
}

function saveWindowRect(element) {
  const id = element.dataset.windowId;
  const workspace = $("#workspace");
  if (!id || !workspace || window.matchMedia("(max-width: 900px)").matches) return;
  const layout = readWindowLayout();
  layout[id] = {
    left: element.offsetLeft,
    top: element.offsetTop,
    width: element.offsetWidth,
    height: element.offsetHeight,
    z: Number(element.style.zIndex || 1),
  };
  writeWindowLayout(layout);
  updateWorkspaceSize();
}

function bringWindowForward(element) {
  state.activeWindowZ += 1;
  localStorage.setItem(layoutStorageKey(WINDOW_Z_KEY, state.authUser), String(state.activeWindowZ));
  element.style.zIndex = String(state.activeWindowZ);
}

function resetWindowLayout(element) {
  const id = element?.dataset?.windowId || "";
  const layout = readWindowLayout();
  if (id) delete layout[id];
  else Object.keys(layout).forEach((key) => delete layout[key]);
  writeWindowLayout(layout);
  requestAnimationFrame(() => {
    applyWindowLayout();
    updateWorkspaceSize();
  });
}

function clampWorkspaceScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.9;
  return Math.max(0.55, Math.min(1.25, Math.round(n * 100) / 100));
}

function setWorkspaceScale(value, options = {}) {
  const viewport = $("#workspaceViewport");
  const oldScale = state.workspaceScale || 1;
  const nextScale = clampWorkspaceScale(value);
  let anchor = null;
  if (viewport && options.anchorEvent && oldScale > 0 && !window.matchMedia("(max-width: 900px)").matches) {
    const rect = viewport.getBoundingClientRect();
    const pointerX = options.anchorEvent.clientX - rect.left;
    const pointerY = options.anchorEvent.clientY - rect.top;
    anchor = {
      x: Math.max(0, Math.min(rect.width, pointerX)),
      y: Math.max(0, Math.min(rect.height, pointerY)),
      worldX: (viewport.scrollLeft + pointerX) / oldScale,
      worldY: (viewport.scrollTop + pointerY) / oldScale,
    };
  }
  state.workspaceScale = nextScale;
  localStorage.setItem(layoutStorageKey(WORKSPACE_SCALE_KEY, state.authUser), String(state.workspaceScale));
  requestAnimationFrame(() => {
    applyWindowLayout();
    if (anchor && viewport) {
      viewport.scrollLeft = Math.max(0, anchor.worldX * state.workspaceScale - anchor.x);
      viewport.scrollTop = Math.max(0, anchor.worldY * state.workspaceScale - anchor.y);
    }
  });
}

function fitWorkspaceScale() {
  const viewport = $("#workspaceViewport");
  if (!viewport) return setWorkspaceScale(0.9);
  const target = Math.min(1, (viewport.clientWidth - 56) / WORKSPACE_DESIGN_WIDTH);
  setWorkspaceScale(target);
}

function initWindowDragging() {
  if (FIXED_WORKSPACE_LAYOUT) return;
  if (window.matchMedia("(max-width: 900px)").matches) return;
  $$(".workspace-item").forEach((element) => {
    if (element.dataset.boundWindow === "1") return;
    element.dataset.boundWindow = "1";
    const canResize = element.dataset.windowId !== "relation";
    if (canResize && !element.querySelector(".window-resize-handle")) {
      const handle = document.createElement("span");
      handle.className = "window-resize-handle";
      handle.setAttribute("aria-hidden", "true");
      element.appendChild(handle);
    }
    const startDrag = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target.closest("button,input,textarea,select,a,label,.asset-card,.gallery,.segment-progress,.relation-canvas,.window-resize-handle")) return;
      const head = event.target.closest(".section-head");
      if (!head || !element.contains(head)) return;
      event.preventDefault();
      bringWindowForward(element);
      const scale = state.workspaceScale || 1;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = element.offsetLeft;
      const startTop = element.offsetTop;
      element.classList.add("dragging");
      const move = (moveEvent) => {
        element.style.left = `${Math.max(20, startLeft + (moveEvent.clientX - startX) / scale)}px`;
        element.style.top = `${Math.max(20, startTop + (moveEvent.clientY - startY) / scale)}px`;
        updateWorkspaceSize();
      };
      const stop = () => {
        element.classList.remove("dragging");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        saveWindowRect(element);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
    };
    const startResize = (event) => {
      if (!canResize) return;
      if (!event.target.closest(".window-resize-handle")) return;
      event.preventDefault();
      event.stopPropagation();
      const workspace = $("#workspace");
      if (!workspace) return;
      bringWindowForward(element);
      const scale = state.workspaceScale || 1;
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = element.offsetWidth;
      const startHeight = element.offsetHeight;
      element.classList.add("resizing");
      const move = (moveEvent) => {
        const maxWidth = Math.max(520, workspace.offsetWidth - element.offsetLeft - 36);
        const maxHeight = Math.max(320, workspace.offsetHeight - element.offsetTop - 36);
        element.style.width = `${Math.min(maxWidth, Math.max(320, startWidth + (moveEvent.clientX - startX) / scale))}px`;
        element.style.height = `${Math.min(maxHeight, Math.max(220, startHeight + (moveEvent.clientY - startY) / scale))}px`;
        updateWorkspaceSize();
      };
      const stop = () => {
        element.classList.remove("resizing");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        saveWindowRect(element);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
    };
    element.addEventListener("pointerdown", startDrag);
    element.addEventListener("pointerdown", startResize);
    element.addEventListener("pointerdown", () => bringWindowForward(element));
  });
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function readScriptUpload(file) {
  if (!file) throw new Error("请选择剧本文件");
  if (!/\.(md|txt|docx)$/i.test(file.name)) throw new Error("剧本仅支持 MD、TXT 或 DOCX 格式");
  const isDocx = /\.docx$/i.test(file.name);
  const text = isDocx
    ? (
        await api("/api/extract-script", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, contentBase64: await fileBase64(file) }),
        })
      ).text
    : await file.text();
  if (!String(text || "").trim()) throw new Error("剧本文件没有可读取的正文");
  return { isDocx, text: String(text) };
}

async function applyScriptUpload(file, { textareaSelector, nameSelector, titleSelector = "", requireSave = false, label = "剧本" } = {}) {
  const textarea = $(textareaSelector);
  if (!textarea) throw new Error("找不到剧本编辑框");
  const { isDocx, text } = await readScriptUpload(file);
  textarea.value = text;
  const name = $(nameSelector);
  if (name) name.textContent = file.name;
  const title = titleSelector ? $(titleSelector) : null;
  if (title && !title.value) title.value = file.name.replace(/\.(md|txt|docx)$/i, "");
  toast(isDocx ? `DOCX ${label}已提取${requireSave ? "，请点击保存" : ""}` : `${label}已载入${requireSave ? "，请点击保存" : ""}`);
}

const referenceUploadConcurrency = 2;
const referenceMaxDimension = 2048;
const referenceMaxBytesBeforeCompression = 2 * 1024 * 1024;

function blobDataUrl(blob) {
  return fileBase64(blob).then((base64) => `data:${blob.type || "image/webp"};base64,${base64}`);
}

async function prepareImageReferenceDataUrl(file) {
  if (!file) throw new Error("参考图文件无效");
  let bitmap = null;
  let fallbackUrl = "";
  try {
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        bitmap = null;
      }
    }
    if (!bitmap) {
      fallbackUrl = URL.createObjectURL(file);
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("读取参考图失败"));
        image.src = fallbackUrl;
      });
    }
    const width = Number(bitmap.width || bitmap.naturalWidth || 0);
    const height = Number(bitmap.height || bitmap.naturalHeight || 0);
    const scale = Math.min(1, referenceMaxDimension / Math.max(width, height, 1));
    const shouldCompress = file.size > referenceMaxBytesBeforeCompression || scale < 1;
    if (!shouldCompress || !width || !height) return `data:${file.type || "image/png"};base64,${await fileBase64(file)}`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return `data:${file.type || "image/png"};base64,${await fileBase64(file)}`;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    if (!compressed || compressed.size >= file.size) {
      return `data:${file.type || "image/png"};base64,${await fileBase64(file)}`;
    }
    return blobDataUrl(compressed);
  } finally {
    if (typeof bitmap?.close === "function") bitmap.close();
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
  }
}

async function runReferenceUploadWorkers(references, files, worker) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(referenceUploadConcurrency, references.length) },
    async () => {
      while (nextIndex < references.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(references[index], files[index]);
      }
    },
  );
  await Promise.all(workers.map((worker) => worker()));
}

function showProjectHome() {
  state.modernStudio.detailsOpen = false;
  $("#exploreHome")?.classList.toggle("hidden", !state.exploreEnabled);
  $("#projectHome").classList.toggle("hidden", state.exploreEnabled);
  $("#studioShell").classList.add("hidden");
  $("#studioModernShell")?.classList.add("hidden");
  document.body.classList.remove("is-studio");
  document.body.classList.remove("is-studio-modern");
  document.body.classList.toggle("is-explore-ui", state.exploreEnabled);
  if (state.exploreEnabled) {
    state.exploreView = "canvas";
    renderExploreHome();
    setupExploreVideoPlayback();
    if (state.authUser) loadBlankCanvasList().catch(() => {});
  } else if (!$(".canvas-entry-card")?.classList.contains("hidden")) {
    loadBlankCanvasList().catch(() => {});
  }
}

function setupExploreVideoPlayback() {
  const videos = [...($(".video-showcase-six")?.querySelectorAll("video[data-video-src], video[src]") || [])];
  if (!videos.length) return;
  const activate = (video) => {
    if (video.dataset.playbackBound !== "1") {
      video.dataset.playbackBound = "1";
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      const play = () => video.play().catch(() => {});
      video.addEventListener("loadeddata", play);
      video.addEventListener("canplay", play);
    }
    if (video.dataset.videoLoaded !== "1") {
      const source = video.dataset.videoSrc || video.getAttribute("src");
      if (!source) return;
      if (!video.getAttribute("src")) video.src = source;
      video.dataset.videoLoaded = "1";
      video.load();
    }
    video.play().catch(() => {});
  };
  const queueVideo = (video, delayMs = 0) => {
    if (video.dataset.videoLoaded === "1" || video.dataset.videoQueued === "1") return;
    video.dataset.videoQueued = "1";
    window.setTimeout(() => {
      video.dataset.videoQueued = "";
      activate(video);
    }, delayMs);
  };
  const delayForVideo = (video) => {
    const index = videos.indexOf(video);
    return index < 2 ? 0 : (index - 1) * 900;
  };
  if (typeof IntersectionObserver === "function") {
    let observer = window._pixelToysExploreVideoObserver;
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          queueVideo(entry.target, delayForVideo(entry.target));
          observer.unobserve(entry.target);
        }
      }, { rootMargin: "80px 0px", threshold: 0.01 });
      window._pixelToysExploreVideoObserver = observer;
    }
    for (const video of videos) {
      if (video.dataset.videoLoaded === "1") activate(video);
      else observer.observe(video);
    }
    return;
  }
  for (const video of videos) queueVideo(video, delayForVideo(video));
}

// 独立画布列表：加载 + 渲染（名称 / 更新时间 / 打开 / 删除）。
function blankCanvasTimeLabel(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString();
}

async function loadBlankCanvasList() {
  const node = $("#blankCanvasList");
  const data = await api("/api/canvas/blank-list");
  const canvases = data.canvases || [];
  state.blankCanvases = canvases;
  renderExploreCanvasLibrary();
  if (!node) return;
  const newTile = `
    <button class="blank-canvas-new" type="button" data-canvas-new aria-label="新建项目">
      <span class="blank-canvas-new-plus">+</span>
      <span class="blank-canvas-new-label">新建项目</span>
    </button>`;
  const cards = canvases
    .map(
      (item) => `
      <div class="blank-canvas-card" data-canvas-id="${escapeAttr(item.id)}">
        <div class="blank-canvas-cover" data-canvas-open="${escapeAttr(item.id)}" role="button" tabindex="0" aria-label="打开 ${escapeAttr(item.name)}">
          ${item.cover ? `<img src="${escapeAttr(item.cover)}" alt="" loading="lazy" decoding="async" />` : `<span class="blank-canvas-cover-empty">${item.nodeCount || 0} 个节点</span>`}
          ${item.canDelete ? `<button class="blank-canvas-del" type="button" data-canvas-delete="${escapeAttr(item.id)}" aria-label="删除" title="删除">✕</button>` : ""}
        </div>
        <div class="blank-canvas-caption">
          <strong data-canvas-title="${escapeAttr(item.id)}" title="双击重命名">${escapeHtml(item.name)}</strong>
          <span>${item.scope === "team" ? "Team" : "Personal"} · 编辑于 ${escapeHtml(blankCanvasTimeLabel(item.updatedAt) || "刚刚")}</span>
        </div>
      </div>`,
    )
    .join("");
  node.innerHTML = newTile + cards;
  node.querySelector("[data-canvas-new]")?.addEventListener("click", () => openBlankCanvasProject());
  node.querySelectorAll("[data-canvas-open]").forEach((cover) => {
    const open = () => {
      window.location.href = `/canvas.html?canvas=${encodeURIComponent(cover.dataset.canvasOpen)}`;
    };
    cover.addEventListener("click", open);
    cover.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
  node.querySelectorAll("[data-canvas-delete]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = button.dataset.canvasDelete;
      if (!confirm("删除这个画布项目？此操作不可恢复。")) return;
      try {
        await api("/api/canvas/blank-delete", { method: "POST", body: JSON.stringify({ projectId: id }) });
        toast("已删除");
        loadBlankCanvasList().catch(() => {});
      } catch (error) {
        toast(error.message);
      }
    });
  });
  node.querySelectorAll("[data-canvas-title]").forEach((strong) => {
    strong.addEventListener("dblclick", () => startRenameBlankCanvas(strong, strong.dataset.canvasTitle));
  });
}

function startRenameBlankCanvas(strongEl, id) {
  const current = strongEl.textContent || "";
  const input = document.createElement("input");
  input.className = "blank-canvas-rename-input";
  input.value = current;
  input.maxLength = 60;
  strongEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim() && input.value.trim() !== current) {
      try {
        await api("/api/canvas/blank-rename", { method: "POST", body: JSON.stringify({ projectId: id, name: input.value.trim() }) });
        toast("已重命名");
      } catch (error) {
        toast(error.message);
      }
    }
    loadBlankCanvasList().catch(() => {});
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") commit(true);
    else if (event.key === "Escape") commit(false);
  });
  input.addEventListener("blur", () => commit(true));
}

function syncProjectUrl(id = state.selectedId, { replace = true } = {}) {
  const url = new URL(window.location.href);
  const nextId = String(id || "").trim();
  if (nextId) url.searchParams.set("project", nextId);
  else url.searchParams.delete("project");
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history[replace ? "replaceState" : "pushState"]({ projectId: nextId }, "", next);
}

function showStudio() {
  closeProjectModal();
  $("#exploreHome")?.classList.add("hidden");
  $("#projectHome").classList.add("hidden");
  $("#studioShell").classList.toggle("hidden", !state.modernStudio.detailsOpen);
  $("#studioModernShell")?.classList.toggle("hidden", state.modernStudio.detailsOpen);
  document.body.classList.add("is-studio");
  document.body.classList.add("is-studio-modern");
  document.body.classList.toggle("is-explore-ui", state.exploreEnabled);
}

function workflowPreviewState() {
  const assetManifest = {
    confirmed: true,
    dialogueLanguage: "en",
    items: [
      { id: "LIN_XIA", type: "Character", label: "林夏", usage: "主角，站台入口" },
      { id: "RED_CASE", type: "Prop", label: "红色手提箱", usage: "SC 02" },
      { id: "NIGHT_PLATFORM", type: "Scene", label: "夜间站台", usage: "SC 01 - 06" },
      { id: "TRAIN_LIGHTS", type: "Insert", label: "列车灯光", usage: "SC 03" },
    ],
  };
  const assetSlots = [
    { id: "LIN_XIA", type: "Character", label: "林夏", status: "ready", statusLabel: "已就绪", generated: true, missing: false, failed: false },
    { id: "RED_CASE", type: "Prop", label: "红色手提箱", status: "missing", statusLabel: "缺失", generated: false, missing: true, failed: false },
    { id: "NIGHT_PLATFORM", type: "Scene", label: "夜间站台", status: "ready", statusLabel: "已就绪", generated: true, missing: false, failed: false },
    { id: "TRAIN_LIGHTS", type: "Insert", label: "列车灯光", status: "missing", statusLabel: "缺失", generated: false, missing: true, failed: false },
  ];
  const project = {
    id: "preview-workflow",
    title: "两夜车站",
    episodeSlug: "e01",
    model: "Seedance 2.0",
    counts: { parsedAssets: 4, assets: 2, rawClips: 2 },
  };
  return {
    ok: true,
    loading: false,
    runtime: {},
    project,
    contents: {
      script: "夜班站台即将关闭。林夏握着一把红色手提箱，站在雨幕中。远处的末班车亮起尾灯，另一个人从站台另一端奔来。",
      storyboard: "",
      assetManifest: JSON.stringify(assetManifest),
      assetPrompts: "",
      seedancePrompts: "",
      config: "",
    },
    assetManifest,
    assets: [],
    assetSlots,
    storyboards: [],
    storyboardSlots: [
      { id: "SC_01", label: "SC 01 / 车站入口", status: "ready", statusLabel: "ready" },
      { id: "SC_02", label: "SC 02 / 红色手提箱", status: "missing", statusLabel: "missing prop" },
      { id: "SC_03", label: "SC 03 / 列车灯光", status: "queued", statusLabel: "queued" },
      { id: "SC_04", label: "SC 04 / 追逐开始", status: "draft", statusLabel: "draft" },
      { id: "SC_05", label: "SC 05 / 月台对峙", status: "ready", statusLabel: "asset locked" },
      { id: "SC_06", label: "SC 06 / 远景收束", status: "ready", statusLabel: "ready" },
    ],
    referenceKits: [],
    referenceKitShots: [],
    teamReferences: [],
    videos: [],
    videoProgress: { total: 6, completed: 2, running: true, items: [] },
    videoConfigStatus: { exists: true, ready: false },
    finalCut: null,
    jobs: [],
    summary: null,
  };
}

function showWorkflowPreview() {
  state.exploreEnabled = false;
  state.selectedId = "";
  state.activeWorkspaceMode = "script";
  state.activeStudioTab = "assets";
  state.project = workflowPreviewState();
  showStudio();
  renderWorkspace();
  setWorkflowFocus("script", { persist: false });
}

function openProjectModal() {
  const modal = $("#projectCreateModal");
  modal.classList.remove("hidden");
  requestAnimationFrame(() => document.querySelector("input[name='projectName']")?.focus());
}

function closeProjectModal() {
  $("#projectCreateModal")?.classList.add("hidden");
  const status = $("#projectCreateStatus");
  if (status) status.textContent = "";
  state.uiBusy.projectCreating = false;
}

function projectDialogueLanguageFrom(data) {
  const value =
    data?.dialogueLanguage ||
    data?.assetManifest?.dialogueLanguage ||
    data?.assetManifest?.production?.dialogueLanguage ||
    data?.videoConfigStatus?.dialogueLanguage ||
    "";
  if (value === "zh" || value === "中文" || value === "cn") return "zh";
  if (value === "en" || value === "英文") return "en";
  return "";
}

function setProjectState(data) {
  state.project = data;
  const dialogueLanguage = projectDialogueLanguageFrom(data);
  if (dialogueLanguage) {
    state.dialogueLanguage = dialogueLanguage;
    localStorage.setItem("pixelToys.dialogueLanguage", dialogueLanguage);
  }
  updateGenerationCanvasLinks();
}

function projectShellStateFromSummary(summary = {}) {
  return {
    ok: true,
    loading: true,
    runtime: {},
    project: summary,
    contents: {
      script: "",
      storyboard: "",
      assetManifest: "",
      assetPrompts: "",
      seedancePrompts: "",
      config: "",
    },
    assetManifest: null,
    assets: [],
    assetSlots: [],
    storyboards: [],
    storyboardSlots: [],
    referenceKits: [],
    referenceKitShots: [],
    teamReferences: [],
    videos: [],
    videoProgress: { total: 0, completed: 0, items: [] },
    videoConfigStatus: {},
    finalCut: null,
    jobs: [],
    summary: null,
  };
}

function mergeProjectStatus(status = {}) {
  if (!state.project?.project) return;
  state.project = {
    ...state.project,
    project: {
      ...state.project.project,
      ...(status.project || {}),
      counts: {
        ...(state.project.project.counts || {}),
        ...(status.project?.counts || {}),
      },
    },
    videoProgress: status.videoProgress || state.project.videoProgress,
    videoConfigStatus: status.videoConfigStatus || state.project.videoConfigStatus,
    assetJob: status.assetJob || state.project.assetJob,
    storyboardJob: status.storyboardJob || state.project.storyboardJob,
    videoJob: status.videoJob || state.project.videoJob,
    finalCut: status.finalCut || state.project.finalCut,
    jobs: Array.isArray(status.jobs) ? status.jobs : state.project.jobs,
    assetManifest: status.assetManifest !== undefined ? status.assetManifest : state.project.assetManifest,
    assets: status.assets !== undefined ? status.assets : state.project.assets,
    assetSlots: status.assetSlots !== undefined ? status.assetSlots : state.project.assetSlots,
    storyboards: status.storyboards !== undefined ? status.storyboards : state.project.storyboards,
    storyboardSlots: status.storyboardSlots !== undefined ? status.storyboardSlots : state.project.storyboardSlots,
    referenceKits: status.referenceKits !== undefined ? status.referenceKits : state.project.referenceKits,
    referenceKitShots: status.referenceKitShots !== undefined ? status.referenceKitShots : state.project.referenceKitShots,
    teamReferences: status.teamReferences !== undefined ? status.teamReferences : state.project.teamReferences,
    runtime: status.runtime || state.project.runtime,
  };
}

function videoProgressHasActiveWork(progress = {}) {
  if (!progress) return false;
  if (progress.running || progress.queued || progress.queue?.running) return true;
  const items = Array.isArray(progress.items) ? progress.items : [];
  return items.some((item) => {
    const status = String(item?.status || "").toLowerCase();
    const statusCode = item?.statusCode;
    const label = String(item?.label || "");
    return (
      status === "running" ||
      status === "queued" ||
      statusCode === 1 ||
      statusCode === 0 ||
      /生成中|排队|等待接口进度|等待上一段|等待前序|正在下载|抽取尾帧|尾帧/.test(label)
    );
  });
}

function projectHasRunningWork(data = state.project) {
  if (state.uiBusy.assetExtracting || state.uiBusy.projectCreating) return true;
  if (!data) return false;
  const jobs = [
    data.assetJob,
    data.storyboardJob,
    data.videoJob,
    data.videoProgress?.job,
    ...(Array.isArray(data.jobs) ? data.jobs : []),
  ].filter(Boolean);
  return videoProgressHasActiveWork(data.videoProgress) || jobs.some((job) => job?.status === "running");
}

function updateGenerationCanvasLinks() {
  const button = $("#studioCanvasButton");
  if (!button) return;
  button.disabled = !state.selectedId;
  button.title = state.selectedId ? "打开当前项目画布" : "请先打开一个项目";
}

function openCurrentCanvas() {
  if (!state.selectedId) return toast("请先打开一个项目");
  window.location.href = canvasProjectHref();
}

function createBlankCanvasId() {
  return `canvas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function openBlankCanvasProject() {
  const canvasName = "Untitled";
  const canvasId = createBlankCanvasId();
  try {
    await api("/api/canvas/state", {
      method: "POST",
      body: JSON.stringify({
        projectId: canvasId,
        name: canvasName,
        nextNodeId: 1,
        viewport: { x: 0, y: 0, scale: 1 },
        assets: [],
        nodes: [],
        connections: [],
      }),
    });
    localStorage.setItem("pixelToys.lastBlankCanvasId", canvasId);
    window.location.href = `/canvas.html?canvas=${encodeURIComponent(canvasId)}`;
  } catch (error) {
    toast(error.message);
  }
}

function openProjectFromState(data) {
  const id = data?.project?.id || "";
  if (!id) throw new Error("项目创建成功，但没有返回项目 ID");
  state.selectedId = id;
  initialProjectHandled = true;
  localStorage.setItem("pixelToys.canvasProjectId", id);
  syncProjectUrl(id);
  updateGenerationCanvasLinks();
  setProjectState(data);
  reconcileOptimisticAssetJobs(data);
  renderWorkspace();
  renderProjectList();
  showStudio();
}

function resetProjectScopedUiState() {
  state.activeJobId = "";
  state.referenceKitEditingId = "";
  state.referenceKitDraft = null;
  state.selectedAssetId = "";
  state.assetPromptDrafts.clear();
  state.assetInspectorOpen = false;
  state.selectedVideoShotName = "";
  state.videoPromptDrafts.clear();
  state.videoPromptInspectorOpen = false;
  state.manualAssetType = "";
  state.manualAssetDraft = { label: "", description: "", evidence: "", quality: "1k", references: [] };
  state.shouldFocusManualAsset = false;
  state.selectedAssetIds.clear();
  state.optimisticAssetJobs.clear();
  state.assetUploadTargetId = "";
}

async function loadProjects(keepSelection = true) {
  let data;
  try {
    data = await api("/api/projects");
  } catch (error) {
    // 首页公开访问时，项目列表仍保持私有；空列表不应把用户送回登录页。
    if (error.status !== 401) throw error;
    state.authUser = null;
    state.projects = [];
    state.exploreEnabled = true;
    state.ui = { ...state.ui, exploreEnabled: true };
    renderProjectList();
    renderExploreHome();
    showProjectHome();
    return;
  }
  state.ui = data.ui || {};
  state.exploreEnabled = PixelToysWorkspaceShell.shouldEnableExplore({
    serverEnabled: state.ui.exploreEnabled,
    search: window.location.search,
  });
  state.projects = data.projects || [];
  renderTeamPanel();
  renderProjectList();
  renderExploreHome();
  if (!INITIAL_PROJECT_ID && !state.selectedId) showProjectHome();
  if (!initialProjectHandled && INITIAL_PROJECT_ID && state.projects.some((project) => project.id === INITIAL_PROJECT_ID)) {
    initialProjectHandled = true;
    await loadProject(INITIAL_PROJECT_ID, { openStudio: true });
    return;
  }
  if (INITIAL_PROJECT_ID && !initialProjectHandled) {
    // ?project 指向的项目不存在:撤销初始的同步进控制台,回到首页。
    showProjectHome();
  }
  if (keepSelection && state.selectedId && state.projects.some((project) => project.id === state.selectedId)) {
    await loadProject(state.selectedId, { openStudio: false });
  }
}

async function loadProject(id, { openStudio = true, rescheduleRefresh = true } = {}) {
  const projectChanged = state.selectedId && state.selectedId !== id;
  if (projectChanged) resetProjectScopedUiState();
  state.selectedId = id;
  $("#teamResourceButton")?.classList.toggle("hidden", !state.team || !id);
  const summary = state.projects.find((project) => project.id === id);
  initialProjectHandled = true;
  localStorage.setItem("pixelToys.canvasProjectId", id);
  syncProjectUrl(id);
  updateGenerationCanvasLinks();
  const token = Symbol(id);
  state.loadProjectToken = token;
  if (summary) {
    setProjectState(projectShellStateFromSummary(summary));
    renderProjectList();
    renderWorkspace();
    if (openStudio) showStudio();
  }
  const data = await api(`/api/project/${id}`);
  if (state.loadProjectToken !== token || state.selectedId !== id) return;
  setProjectState(data);
  reconcileOptimisticAssetJobs(data);
  renderProjectList();
  renderWorkspace();
  updateGenerationCanvasLinks();
  if (openStudio) showStudio();
  if (rescheduleRefresh) scheduleProjectRefresh();
}

function renderProjectList() {
  const node = $("#projectList");
  node.innerHTML = "";
  const count = state.projects.length;
  $("#projectCount").textContent = count ? `${count} 个项目` : "暂无项目";
  if (!state.projects.length) {
    node.innerHTML = `
      <div class="empty-projects">
        <strong>还没有项目</strong>
        <span>新建一个项目后，它会显示在这里。</span>
      </div>
    `;
    return;
  }
  for (const project of state.projects) {
    const card = document.createElement("article");
    const title = displayProjectTitle(project);
    card.className = `project-card${project.id === state.selectedId ? " active" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `打开项目 ${title}`);
    card.innerHTML = `
      <div class="project-card-top">
        <div class="project-card-title">
          <strong>${escapeHtml(title)}</strong>
          <span>点击进入制作页</span>
        </div>
        ${project.canDelete ? `<button class="project-delete" type="button" aria-label="删除 ${escapeAttr(title)}" title="删除项目">删除</button>` : ""}
      </div>
      <span class="project-meta">
        <span class="pill">${escapeHtml(project.episodeSlug)}</span>
        <span class="pill">${project.counts.parsedAssets || 0} parsed</span>
        <span class="pill">${project.counts.assets} images</span>
        <span class="pill">${project.counts.rawClips} clips</span>
      </span>
    `;
    card.addEventListener("click", () => loadProject(project.id).catch((error) => toast(error.message)));
    card.addEventListener("keydown", (event) => {
      if (event.target.closest?.(".project-delete")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      loadProject(project.id).catch((error) => toast(error.message));
    });
    const deleteButton = card.querySelector(".project-delete");
    if (deleteButton) {
      deleteButton.addEventListener("keydown", (event) => event.stopPropagation());
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteProject(project).catch((error) => toast(error.message));
      });
    }
    node.appendChild(card);
  }
}

function filteredExploreProjects() {
  const query = String(state.exploreProjectSearch || "").trim().toLowerCase();
  return state.projects.filter((project) => {
    if (state.exploreScopeFilter !== "all" && project.scope !== state.exploreScopeFilter) return false;
    if (!query) return true;
    return [project.displayName, project.title, project.episodeSlug].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function scopeBadgeHtml(scope = "personal") {
  return `<span class="scope-badge ${scope === "team" ? "is-team" : "is-personal"}">${scope === "team" ? "Team" : "Personal"}</span>`;
}

function projectProgressLabel(project = {}) {
  const progress = project.progress || {};
  const parts = [progress.stage || "script", progress.lastModifiedByUsername || "", blankCanvasTimeLabel(progress.lastModifiedAt || project.updatedAt || "")].filter(Boolean);
  return parts.join(" · ");
}

function projectScopeActionsHtml(project = {}) {
  if (project.scope === "personal" && state.team) {
    return `<button type="button" data-project-team="${escapeAttr(project.id)}" title="加入团队">⇧</button>`;
  }
  if (project.scope === "team") {
    return `<button type="button" data-project-duplicate-personal="${escapeAttr(project.id)}" title="复制为个人项目">⧉</button>`;
  }
  return "";
}

function blankCanvasScopeActionsHtml(item = {}) {
  if (item.scope === "personal" && state.team) {
    return `<button type="button" data-canvas-team="${escapeAttr(item.id)}" title="加入团队">⇧</button>`;
  }
  if (item.scope === "team") {
    return `<button type="button" data-canvas-duplicate-personal="${escapeAttr(item.id)}" title="复制为个人画布">⧉</button>`;
  }
  return "";
}

function bindExploreCanvasImageFallbacks(node) {
  node.querySelectorAll(".explore-canvas-preview img").forEach((image) => {
    const removeBrokenImage = () => image.remove();
    if (image.complete && image.naturalWidth === 0) removeBrokenImage();
    else image.addEventListener("error", removeBrokenImage, { once: true });
  });
}

function renderExploreCanvasLibrary() {
  const node = $("#exploreCanvasGrid");
  if (!node) return;
  const projects = filteredExploreProjects();
  const filter = state.exploreCanvasFilter || "all";
  const showQuickStart = state.exploreScopeFilter !== "team" && filter !== "productions";
  const showCanvases = filter !== "productions";
  const showProductions = filter !== "quick-start";
  const quickStartCards = showQuickStart
    ? `<button class="explore-canvas-card explore-canvas-create" type="button" data-explore-canvas-new>
        <span class="explore-canvas-preview"><span class="explore-canvas-plus">＋</span></span>
        <strong>Create new canvas</strong>
        <small>Quick Start</small>
      </button>
      <button class="explore-canvas-card explore-production-create" type="button" data-explore-new-project>
        <span class="explore-canvas-preview"><span class="explore-canvas-plus">▤</span></span>
        <strong>New production</strong>
        <small>Script workflow</small>
      </button>`
    : "";
  const blankCanvasCards = showCanvases
    ? state.blankCanvases
        .filter((item) => state.exploreScopeFilter === "all" || item.scope === state.exploreScopeFilter)
        .map(
          (item) => `
            <article class="explore-canvas-card">
              <button class="explore-canvas-card-open" type="button" data-explore-canvas="${escapeAttr(item.id)}">
                <span class="explore-canvas-preview">
                  <span class="explore-canvas-node-count">${item.nodeCount || 0} nodes</span>
                  ${item.cover ? `<img src="${escapeAttr(item.cover)}" alt="" loading="lazy" decoding="async" />` : ""}
                </span>
                <strong>${escapeHtml(item.name || "Untitled")}</strong>
                <small>${escapeHtml(blankCanvasTimeLabel(item.updatedAt) || "刚刚")}</small>
              </button>
              <div class="explore-card-meta">${scopeBadgeHtml(item.scope)}<span>${escapeHtml(item.progress?.lastModifiedByUsername || "")}</span></div>
              <div class="explore-card-actions">
                ${blankCanvasScopeActionsHtml(item)}
                ${item.canDelete ? `<button class="explore-card-delete" type="button" data-canvas-delete-home="${escapeAttr(item.id)}" aria-label="删除画布" title="删除画布">×</button>` : ""}
              </div>
            </article>`,
        )
        .join("")
    : "";
  const productionCards = showProductions
    ? projects
        .map(
          (project) => `
            <article class="explore-canvas-card">
              <button class="explore-canvas-card-open" type="button" data-explore-project="${escapeAttr(project.id)}">
                <span class="explore-canvas-preview explore-production-preview">
                  <img src="/infinity-3d.png" alt="" loading="lazy" />
                  <span>${escapeHtml(project.episodeSlug || "Production")}</span>
                </span>
                <strong>${escapeHtml(displayProjectTitle(project))}</strong>
                <small>${escapeHtml(projectProgressLabel(project))}</small>
              </button>
              <div class="explore-card-meta">${scopeBadgeHtml(project.scope)}<span>${project.counts?.assets || 0} assets · ${project.counts?.rawClips || 0} clips</span></div>
              <div class="explore-card-actions">
                ${projectScopeActionsHtml(project)}
                ${project.canDelete ? `<button class="explore-card-delete" type="button" data-project-delete-home="${escapeAttr(project.id)}" aria-label="删除项目" title="删除项目">×</button>` : ""}
              </div>
            </article>`,
        )
        .join("")
    : "";
  node.innerHTML = `${quickStartCards}${blankCanvasCards}${productionCards}`;
  if (!node.children.length) node.innerHTML = `<span class="explore-canvas-empty">No canvases</span>`;
  bindExploreCanvasImageFallbacks(node);
}

function centerExploreActiveNav() {
  const nav = document.querySelector(".explore-topbar nav");
  const active = nav?.querySelector(".is-active");
  if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
  nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
}

function renderExploreHome() {
  $$("[data-explore-filter]").forEach((button) => {
    const active = button.dataset.exploreFilter === state.exploreCanvasFilter;
    button.classList.toggle("is-active", active);
    if (button.getAttribute("role") === "tab") button.setAttribute("aria-selected", active ? "true" : "false");
  });
  $$('[data-explore-scope]').forEach((button) => {
    const active = button.dataset.exploreScope === state.exploreScopeFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  $("[data-explore-primary-canvas]")?.classList.toggle("is-active", state.exploreCanvasFilter !== "productions");
  renderExploreCanvasLibrary();
  setExploreView(state.exploreView);
  requestAnimationFrame(centerExploreActiveNav);
}

async function moveProjectToTeam(projectId) {
  if (!window.confirm("加入团队后不能直接转回个人项目，是否继续？")) return;
  await api(`/api/project/${projectId}/team`, { method: "POST", body: JSON.stringify({}) });
  await loadProjects(false);
  renderTeamPanel();
  toast("项目已加入团队");
}

async function duplicateProjectAsPersonal(projectId) {
  const data = await api(`/api/project/${projectId}/duplicate-personal`, { method: "POST", body: JSON.stringify({}) });
  await loadProjects(false);
  if (data.project?.id) await loadProject(data.project.id);
  toast("已创建个人副本");
}

async function moveBlankCanvasToTeam(projectId) {
  if (!window.confirm("加入团队后不能直接转回个人画布，是否继续？")) return;
  await api("/api/canvas/blank-team", { method: "POST", body: JSON.stringify({ projectId }) });
  await loadBlankCanvasList();
  toast("画布已加入团队");
}

async function duplicateBlankCanvasAsPersonal(projectId) {
  const data = await api("/api/canvas/blank-duplicate-personal", { method: "POST", body: JSON.stringify({ projectId }) });
  await loadBlankCanvasList();
  if (data.canvas?.id) window.location.href = `/canvas.html?canvas=${encodeURIComponent(data.canvas.id)}`;
}

async function deleteBlankCanvasFromHome(projectId) {
  if (!window.confirm("删除这个画布项目？此操作不可恢复。")) return;
  await api("/api/canvas/blank-delete", { method: "POST", body: JSON.stringify({ projectId }) });
  await loadBlankCanvasList();
  toast("已删除");
}

function persistImageExploreHistory() {
  // 运行中的任务必须持久化 taskId,刷新后才能继续轮询而不是重新发起请求。
  const trimmed = state.imageStudio.history
    .filter((item) => item?.status === "running" || (item?.status === "completed" && item.url) || (item?.status === "failed" && item.message))
    .slice(0, 24);
  state.imageStudio.history = trimmed;
  localStorage.setItem(
    imageExploreStorageKey(state.authUser),
    JSON.stringify(trimmed.filter((item) => (item.status === "running" && item.taskId) || item.status === "completed" || item.status === "failed")),
  );
}

function persistImageExploreStoryboardHistory() {
  const trimmed = state.imageStudio.storyboardHistory
    .filter((item) => item?.status === "running" || (item?.status === "completed" && item.url) || (item?.status === "failed" && item.message))
    .slice(0, 24);
  state.imageStudio.storyboardHistory = trimmed;
  localStorage.setItem(
    imageExploreStoryboardStorageKey(state.authUser),
    JSON.stringify(trimmed.filter((item) => (item.status === "running" && item.taskId) || item.status === "completed" || item.status === "failed")),
  );
}

function readImageExploreStoryboardRecovery(user = null) {
  try {
    const value = JSON.parse(localStorage.getItem(imageExploreStoryboardRecoveryStorageKey(user)) || "[]");
    return new Set(Array.isArray(value) ? value.filter(Boolean).slice(0, 200) : []);
  } catch {
    return new Set();
  }
}

function persistImageExploreStoryboardRecovery(taskIds, user = state.authUser) {
  localStorage.setItem(
    imageExploreStoryboardRecoveryStorageKey(user),
    JSON.stringify([...taskIds].filter(Boolean).slice(-200)),
  );
}

function isRecoverableImageStoryboardAsset(asset = {}) {
  const taskId = String(asset.metadata?.taskId || "").trim();
  const text = `${asset.name || ""} ${asset.prompt || ""}`;
  return asset.source === "image-generation"
    && /^[a-z0-9-]{16,80}$/i.test(taskId)
    && /九宫格|故事板|分镜|storyboard/i.test(text);
}

function imageExploreStoryboardItemFromAsset(asset = {}) {
  const taskId = String(asset.metadata?.taskId || "").trim();
  const prompt = String(asset.prompt || asset.name || "已恢复故事板").trim();
  const sequence = prompt.match(/第\s*(\d+)\s*\/\s*(\d+)\s*张/);
  const boardIndex = sequence ? Number(sequence[1]) : 1;
  const totalBoards = sequence ? Number(sequence[2]) : 1;
  const timeRange = prompt.match(/(?:时长|时间范围)[：:\s]*([0-9]+-[0-9]+s)/i)?.[1] || "0-15s";
  const summary = prompt.match(/本张剧情摘要[：:]\s*([^。]+。?)/)?.[1] || "已恢复生成结果，原图已保留";
  const url = asset.localUrl || asset.previewUrl || asset.url || "";
  return {
    id: `storyboard-recovered-${taskId}`,
    taskId,
    status: "completed",
    url,
    previewUrl: url,
    prompt,
    ratio: asset.ratio || "16:9",
    resolution: asset.resolution || "1k",
    boardCount: totalBoards,
    totalBoards,
    source: "image-storyboard-recovery",
    createdAt: asset.createdAt || new Date().toISOString(),
    board: {
      index: boardIndex,
      timeRange,
      summary,
      panels: [],
    },
  };
}

async function recoverImageExploreStoryboards() {
  if (!state.authUser) return;
  const data = await api("/api/asset-library?limit=100");
  const cutoff = Date.now() - IMAGE_EXPLORE_STORYBOARD_RECOVERY_LOOKBACK_MS;
  const recoveryIds = readImageExploreStoryboardRecovery(state.authUser);
  const existingTaskIds = new Set(
    state.imageStudio.storyboardHistory.map((item) => String(item?.taskId || "")).filter(Boolean),
  );
  const recovered = [];
  for (const asset of Array.isArray(data.assets) ? data.assets : []) {
    if (!isRecoverableImageStoryboardAsset(asset)) continue;
    const createdAt = Date.parse(asset.createdAt || "");
    if (Number.isFinite(createdAt) && createdAt < cutoff) continue;
    const taskId = String(asset.metadata.taskId);
    if (existingTaskIds.has(taskId) || recoveryIds.has(taskId)) {
      recoveryIds.add(taskId);
      continue;
    }
    const item = imageExploreStoryboardItemFromAsset(asset);
    if (!item.url) continue;
    state.imageStudio.storyboardHistory.unshift(item);
    existingTaskIds.add(taskId);
    recoveryIds.add(taskId);
    recovered.push(item);
  }
  state.imageStudio.storyboardHistory = state.imageStudio.storyboardHistory.slice(0, 24);
  persistImageExploreStoryboardRecovery(recoveryIds);
  if (!recovered.length) return;
  persistImageExploreStoryboardHistory();
  renderImageExploreView();
  toast(`已恢复 ${recovered.length} 张故事板`);
}

function beginImageExploreGeneration() {
  state.imageStudio.activeGenerations = Math.max(0, Number(state.imageStudio.activeGenerations) || 0) + 1;
  state.imageStudio.generating = true;
}

function endImageExploreGeneration() {
  state.imageStudio.activeGenerations = Math.max(0, (Number(state.imageStudio.activeGenerations) || 0) - 1);
  state.imageStudio.generating = state.imageStudio.activeGenerations > 0;
}

function imageExploreLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function imageExploreReferenceButtonHtml(id) {
  return `<button type="button" class="image-explore-reference-action" data-image-reference-add="${escapeAttr(id)}" title="作为参考图" aria-label="作为参考图">作为参考图</button>`;
}

function imageExploreHistoryItemHtml(item = {}) {
  const id = escapeAttr(item.id || "");
  const prompt = escapeHtml(String(item.prompt || "未命名图片").slice(0, 120));
  if (item.status === "running") {
    return `<article class="image-explore-card is-running">
      <div class="image-explore-card-preview"><span class="image-explore-loader"></span><strong>生成中</strong></div>
    </article>`;
  }
  if (item.status === "failed") {
    return `<article class="image-explore-card is-failed">
      <div class="image-explore-card-preview">
        <strong>生成失败</strong>
        <small>${escapeHtml(item.message || "请重试")}</small>
        <button type="button" data-image-history-remove="${id}" title="移除" aria-label="移除失败结果">×</button>
      </div>
    </article>`;
  }
  return `<article class="image-explore-card">
    <div class="image-explore-card-preview" data-image-preview="${id}" role="button" tabindex="0" aria-label="打开大图">
      <img src="${escapeAttr(libraryPreviewUrl(item, 480))}" alt="${prompt}" loading="lazy" decoding="async" />
      <button type="button" class="image-explore-regen" data-image-regenerate="${id}" title="重新生成" aria-label="重新生成">↻</button>
      ${imageExploreReferenceButtonHtml(id)}
      <button type="button" data-image-history-remove="${id}" title="移除" aria-label="移除生成结果">×</button>
    </div>
  </article>`;
}

function imageExploreStoryboardDialogueText(dialogue = {}) {
  if (typeof dialogue === "string") return imageExploreLine(dialogue) || "无对白";
  const speaker = imageExploreLine(dialogue.speaker || dialogue.name || "");
  const text = imageExploreLine(dialogue.text || dialogue.dialogue || "");
  if (!speaker && !text) return "无对白";
  return speaker && text ? `${speaker}：${text}` : speaker || text;
}

function imageExploreStoryboardHistoryItemHtml(item = {}) {
  const id = escapeAttr(item.id || "");
  const board = item.board || {};
  const boardIndex = Number(board.index || item.index || 1);
  const totalBoards = Number(item.totalBoards || item.boardCount || 1);
  const boardLabel = `故事板 ${boardIndex}/${totalBoards}`;
  const prompt = escapeHtml(String(item.prompt || board.summary || boardLabel).slice(0, 160));
  if (item.status === "running" || item.status === "planning") {
    return `<article class="image-explore-card image-explore-storyboard-card is-running">
      <div class="image-explore-card-preview image-explore-storyboard-preview"><span class="image-explore-loader"></span><strong>${item.status === "planning" ? "规划中" : "生成中"}</strong><small>${escapeHtml(item.message || (item.taskId ? "后台生成中，可刷新查看" : boardLabel))}</small></div>
    </article>`;
  }
  if (item.status === "failed") {
    return `<article class="image-explore-card image-explore-storyboard-card is-failed">
      <div class="image-explore-card-preview image-explore-storyboard-preview">
        <strong>${escapeHtml(boardLabel)}失败</strong>
        <small>${escapeHtml(item.message || "请重试")}</small>
        <button type="button" class="image-explore-regen" data-image-regenerate="${id}" title="重新生成" aria-label="重新生成">↻</button>
        <button type="button" data-storyboard-remove="${id}" title="移除" aria-label="移除失败结果">×</button>
      </div>
    </article>`;
  }
  const panels = Array.isArray(board.panels) ? board.panels : [];
  const panelDetails = panels.map((panel, index) => `<article class="image-explore-storyboard-panel">
    <strong>${escapeHtml(String(panel.panel || index + 1).padStart(2, "0"))} · ${escapeHtml(panel.time || "")}</strong>
    <span>${escapeHtml(panel.plot || "")}</span>
    <small>镜头：${escapeHtml(panel.cameraMovement || panel.shot || "未指定")}<br />光影：${escapeHtml(panel.lighting || "未指定")}<br />对白：${escapeHtml(imageExploreStoryboardDialogueText(panel.dialogue))}</small>
  </article>`).join("");
  return `<article class="image-explore-card image-explore-storyboard-card">
    <div class="image-explore-card-preview image-explore-storyboard-preview" data-image-preview="${id}" role="button" tabindex="0" aria-label="打开${escapeAttr(boardLabel)}">
      <img src="${escapeAttr(libraryPreviewUrl(item, 480))}" alt="${prompt}" loading="lazy" decoding="async" />
      <button type="button" class="image-explore-regen" data-image-regenerate="${id}" title="重新生成" aria-label="重新生成">↻</button>
      ${imageExploreReferenceButtonHtml(id)}
      <button type="button" data-storyboard-remove="${id}" title="移除" aria-label="移除生成结果">×</button>
    </div>
    <div class="image-explore-storyboard-caption">
      <strong>${escapeHtml(boardLabel)} · 3×3</strong>
      <span>${escapeHtml(board.timeRange || "0-15s")} · 每张 15 秒</span>
      <p>${escapeHtml(board.summary || "")}</p>
      <details class="image-explore-storyboard-details">
        <summary>查看 9 格分镜</summary>
        <div class="image-explore-storyboard-panels">${panelDetails}</div>
        <small class="image-explore-storyboard-continuity-detail">入：${escapeHtml(board.continuityIn || "起始状态")}<br />出：${escapeHtml(board.continuityOut || "本张结尾状态")}</small>
      </details>
    </div>
  </article>`;
}

function renderImageExploreReferences() {
  const node = $("#imageExploreReferenceList");
  if (!node) return;
  node.innerHTML = state.imageStudio.references
    .map(
      (reference) => `<span class="image-explore-reference${reference.uploading ? " is-uploading" : ""}" title="${escapeAttr(reference.name)}" aria-busy="${reference.uploading ? "true" : "false"}">
        <img src="${escapeAttr(libraryPreviewUrl(reference, 240))}" alt="" loading="lazy" decoding="async" />
        ${reference.uploading ? `<span class="image-explore-reference-loading" aria-label="上传中"></span>` : ""}
        <button type="button" data-image-reference-remove="${escapeAttr(reference.id)}" aria-label="移除参考图">×</button>
      </span>`,
    )
    .join("");
}

function addImageExploreReferenceFromResult(item = {}) {
  const imageUrl = String(item.url || "").trim();
  if (!imageUrl) return;
  const existing = state.imageStudio.references.find((reference) => (reference.localUrl || reference.url) === imageUrl);
  if (existing) {
    $("#imageExplorePrompt")?.focus();
    toast("这张图片已经是参考图");
    return;
  }
  if (state.imageStudio.references.length >= 4) {
    toast("最多添加 4 张参考图");
    return;
  }
  state.imageStudio.references.push({
    id: `generated-reference-${item.id || Date.now()}`,
    name: item.historyKind === "storyboard" ? "故事板生成图" : "生成图片",
    url: imageUrl,
    localUrl: imageUrl,
    previewUrl: imageUrl,
    uploading: false,
    generated: true,
  });
  renderImageExploreView();
  $("#imageExplorePrompt")?.focus();
  toast("已添加为参考图");
}

function renderImageExploreGallery() {
  const gallery = $("#imageExploreGallery");
  const empty = $("#imageExploreEmpty");
  if (!gallery || !empty) return;
  const items = [
    ...state.imageStudio.history.map((item) => ({ ...item, historyKind: "image" })),
    ...state.imageStudio.storyboardHistory.map((item) => ({ ...item, historyKind: "storyboard" })),
  ].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  gallery.innerHTML = items.map((item) => item.historyKind === "storyboard" ? imageExploreStoryboardHistoryItemHtml(item) : imageExploreHistoryItemHtml(item)).join("");
  empty.classList.toggle("hidden", items.length > 0);
}

function renderImageExploreView() {
  const view = $("#imageExploreView");
  if (!view) return;
  $("#imageExplorePrompt").value = state.imageStudio.prompt;
  $("#imageExploreModel").value = state.imageStudio.model || "gpt-image-2";
  $("#imageExploreRatio").value = state.imageStudio.ratio;
  $("#imageExploreResolution").value = state.imageStudio.resolution;
  $("#imageExploreCount").textContent = String(state.imageStudio.count);
  const storyboardToggle = $("#imageExploreStoryboardToggle");
  const storyboardOptions = $("#imageExploreStoryboardOptions");
  const storyboardMode = state.imageStudio.storyboardMode === true;
  const promptInput = $("#imageExplorePrompt");
  if (promptInput) promptInput.placeholder = storyboardMode ? "输入故事或情节，生成连续九宫格故事板" : "Describe the scene you imagine";
  if (storyboardToggle) {
    storyboardToggle.classList.toggle("is-active", storyboardMode);
    storyboardToggle.setAttribute("aria-expanded", storyboardMode ? "true" : "false");
  }
  storyboardOptions?.classList.toggle("hidden", !storyboardMode);
  if ($("#imageExploreStoryboardCount")) $("#imageExploreStoryboardCount").value = String(state.imageStudio.storyboardCount);
  $("#imageExploreImageCountControl")?.classList.toggle("hidden", storyboardMode);
  const referencesUploading = Number(state.imageStudio.referencesUploading) || 0;
  const activeGenerations = Number(state.imageStudio.activeGenerations) || 0;
  const storyboardBatchItems = state.imageStudio.storyboardActiveBatchId
    ? state.imageStudio.storyboardHistory.filter((item) => item.batchId === state.imageStudio.storyboardActiveBatchId)
    : [];
  const storyboardCompletedCount = storyboardBatchItems.filter((item) => item.status === "completed").length;
  const storyboardFailedCount = storyboardBatchItems.filter((item) => item.status === "failed").length;
  const storyboardTotal = storyboardBatchItems.length || state.imageStudio.storyboardCount;
  const storyboardProgress = storyboardFailedCount
    ? `完成 ${storyboardCompletedCount}/${storyboardTotal}，失败 ${storyboardFailedCount}`
    : `${storyboardCompletedCount}/${storyboardTotal}`;
  $("#imageExploreGenerate").disabled = referencesUploading > 0 || state.imageStudio.storyboardGenerating;
  $("#imageExploreStatus").textContent = referencesUploading
    ? `参考图上传中（${referencesUploading}）`
    : state.imageStudio.storyboardGenerating
      ? `故事板生成中（${storyboardProgress}）`
      : activeGenerations > 0
        ? `生成中（${activeGenerations}）`
      : "";
  $("#imageExploreGenerate").innerHTML = storyboardMode ? '生成故事板 <span aria-hidden="true">↗</span>' : '生成图片 <span aria-hidden="true">↗</span>';
  renderImageExploreReferences();
  renderImageExploreGallery();
}

function libraryPreviewUrl(asset = {}, width = 360) {
  const raw = String(asset.previewUrl || asset.url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, window.location.origin);
    const localPreview = parsed.origin === window.location.origin
      && (parsed.pathname.startsWith("/public-assets/") || parsed.pathname === "/media");
    if (!localPreview) return raw;
    parsed.searchParams.set("thumb", String(Math.max(160, Math.min(720, Number(width) || 360))));
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

function assetLibraryCardHtml(asset, { workflow = false } = {}) {
  const id = escapeAttr(asset.id || "");
  const name = escapeHtml(asset.name || "未命名素材");
  const preview = escapeAttr(libraryPreviewUrl(asset, workflow ? 320 : 360));
  const meta = [asset.source === "image-generation" ? "Image 生成" : asset.source || "素材", asset.ratio, asset.resolution].filter(Boolean).join(" · ");
  if (workflow) {
    return `<article class="workflow-asset-library-card">
      <img src="${preview}" alt="${name}" loading="lazy" />
      <div><strong>${name}</strong><span>${escapeHtml(meta)}</span></div>
      <div class="workflow-asset-library-card-actions">
        <button type="button" class="ghost small" data-workflow-library-use="${id}">替换选中</button>
        <button type="button" class="primary small" data-workflow-library-add="${id}">添加资产</button>
      </div>
    </article>`;
  }
  return `<article class="asset-library-card">
    <button type="button" class="asset-library-card-preview" data-asset-library-preview="${id}" aria-label="打开${name}">
      <img src="${preview}" alt="${name}" loading="lazy" />
    </button>
    <div class="asset-library-card-body"><strong>${name}</strong><span>${escapeHtml(meta)}</span></div>
    <div class="asset-library-card-actions">
      <a class="ghost small" href="/canvas.html?libraryAssetId=${id}">打开画布</a>
      <button type="button" class="ghost small" data-asset-library-remove="${id}">移除</button>
    </div>
  </article>`;
}

function renderAssetLibraryView() {
  const gallery = $("#assetLibraryGallery");
  const empty = $("#assetLibraryEmpty");
  if (!gallery || !empty) return;
  gallery.innerHTML = state.assetLibrary.assets.map((asset) => assetLibraryCardHtml(asset)).join("");
  empty.classList.toggle("hidden", state.assetLibrary.assets.length > 0);
}

function renderWorkflowAssetLibrary() {
  const panel = $("#workflowAssetLibrary");
  const list = $("#workflowAssetLibraryList");
  if (!panel || !list) return;
  panel.classList.toggle("hidden", state.activeWorkspaceMode !== "assets");
  // 素材库网格默认收起,只留标题+「展开」按钮,避免霸占资产图视图;展开后才渲染网格。
  const expanded = state.assetLibrary.workflowExpanded === true;
  const toggle = $("#workflowAssetLibraryToggle");
  if (toggle) {
    toggle.textContent = expanded ? "收起" : "展开";
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
  const search = $("#workflowAssetLibrarySearch");
  if (search) search.classList.toggle("hidden", !expanded);
  list.classList.toggle("hidden", !expanded);
  if (!expanded) {
    list.innerHTML = "";
    return;
  }
  const visible = state.assetLibrary.assets.filter((asset) => {
    const query = String(state.assetLibrary.search || "").trim().toLowerCase();
    return !query || `${asset.name || ""} ${asset.prompt || ""}`.toLowerCase().includes(query);
  });
  list.innerHTML = visible.length
    ? visible.map((asset) => assetLibraryCardHtml(asset, { workflow: true })).join("")
    : `<div class="asset-empty-state">素材库暂无可用图片</div>`;
}

async function loadAssetLibrary({ search = state.assetLibrary.search, silent = false } = {}) {
  state.assetLibrary.search = String(search || "");
  const params = new URLSearchParams();
  if (state.assetLibrary.search) params.set("search", state.assetLibrary.search);
  const data = await api(`/api/asset-library${params.toString() ? `?${params}` : ""}`);
  state.assetLibrary.assets = Array.isArray(data.assets) ? data.assets : [];
  state.assetLibrary.loaded = true;
  renderAssetLibraryView();
  renderWorkflowAssetLibrary();
  if (!silent) toast(`素材库已加载 ${state.assetLibrary.assets.length} 个资产`);
  return state.assetLibrary.assets;
}

async function removeAssetLibraryAsset(id) {
  if (!id || !window.confirm("从素材库移除这张图片？不会删除已经导入项目的副本。")) return;
  await api(`/api/asset-library/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.assetLibrary.assets = state.assetLibrary.assets.filter((asset) => asset.id !== id);
  renderAssetLibraryView();
  renderWorkflowAssetLibrary();
}

async function importWorkflowLibraryAsset(libraryId, { add = false } = {}) {
  if (!state.selectedId) return toast("请先打开一个项目");
  const body = { libraryId };
  if (!add) {
    body.assetId = $("#assetUploadTarget")?.value || state.assetUploadTargetId || "";
    if (!body.assetId) return toast("请先选择要替换的资产槽位");
  }
  const data = await api(`/api/project/${encodeURIComponent(state.selectedId)}/asset-import-library`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  setProjectState(data.state);
  renderWorkspace();
  toast(data.result?.message || (add ? "素材已添加到项目" : "素材已替换项目资产"));
}

function openAssetLibraryPreview(id) {
  const asset = state.assetLibrary.assets.find((item) => item.id === id);
  if (!asset?.url) return;
  openImageExplorePreview({
    id: asset.id,
    url: asset.url,
    prompt: asset.name || "素材库图片",
    ratio: asset.ratio,
    resolution: asset.resolution,
  });
}

function setExploreView(view = "canvas") {
  state.exploreView = ["image", "library", "superpixel"].includes(view) ? view : "canvas";
  $(".canvas-home")?.classList.toggle("hidden", state.exploreView !== "canvas");
  $("#imageExploreView")?.classList.toggle("hidden", state.exploreView !== "image");
  $("#assetLibraryView")?.classList.toggle("hidden", state.exploreView !== "library");
  $("#superPixelView")?.classList.toggle("hidden", state.exploreView !== "superpixel");
  $$(".explore-topbar nav > button").forEach((button) => {
    const active = button.dataset.exploreTool === "image-generation"
      ? state.exploreView === "image"
      : button.dataset.exploreTool === "asset-library"
        ? state.exploreView === "library"
      : button.dataset.exploreTool === "super-pixel"
        ? state.exploreView === "superpixel"
      : button.dataset.exploreFilter
        ? state.exploreView === "canvas" && state.exploreCanvasFilter === button.dataset.exploreFilter
        : button.dataset.explorePrimaryCanvas !== undefined
          ? state.exploreView === "canvas" && state.exploreCanvasFilter !== "productions"
          : false;
    button.classList.toggle("is-active", active);
  });
  renderImageExploreView();
  renderAssetLibraryView();
  if (state.exploreView === "library" && !state.assetLibrary.loaded) loadAssetLibrary({ silent: true }).catch((error) => toast(error.message));
  requestAnimationFrame(centerExploreActiveNav);
}

function showExploreImageTool() {
  setExploreView("image");
}

function showExploreAssetLibrary() {
  setExploreView("library");
}

function showExploreSuperPixel() {
  setExploreView("superpixel");
}

function renderSuperPixelMessages() {
  const container = $("#superPixelMessages");
  if (!container) return;
  container.textContent = "";
  container.classList.toggle("hidden", !state.superPixel.messages.length);
  for (const message of state.superPixel.messages) {
    const bubble = document.createElement("div");
    bubble.className = `super-pixel-message is-${message.role}`;
    // 带图的消息：先渲染缩略图，再渲染文字
    if (Array.isArray(message.images) && message.images.length) {
      const strip = document.createElement("div");
      strip.className = "super-pixel-message-images";
      for (const image of message.images) {
        const img = document.createElement("img");
        img.src = image.preview || image.url;
        img.alt = image.name || "资产图";
        img.loading = "lazy";
        strip.appendChild(img);
      }
      bubble.appendChild(strip);
    }
    const textNode = document.createElement("div");
    textNode.className = "super-pixel-message-text";
    textNode.textContent = message.content || (message.pending ? "..." : "");
    bubble.appendChild(textNode);
    container.appendChild(bubble);
  }
  container.scrollTop = container.scrollHeight;
}

async function readSuperPixelStream(response, onDelta) {
  if (!response.body) throw new Error("模型未返回流式内容");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = JSON.parse(line.slice(5).trim());
      if (payload.error) throw new Error(payload.error);
      if (payload.delta) onDelta(payload.delta);
    }
  }
}

const SUPER_PIXEL_MAX_ATTACHMENTS = 8;

function renderSuperPixelAttachments() {
  const tray = $("#superPixelAttachments");
  if (!tray) return;
  const items = state.superPixel.attachments;
  tray.textContent = "";
  tray.classList.toggle("hidden", !items.length);
  items.forEach((image, index) => {
    const chip = document.createElement("div");
    chip.className = "super-pixel-attachment";
    const img = document.createElement("img");
    img.src = image.preview || image.url;
    img.alt = image.name || "资产图";
    chip.appendChild(img);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "super-pixel-attachment-remove";
    remove.setAttribute("aria-label", `移除 ${image.name || "资产图"}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.superPixel.attachments.splice(index, 1);
      renderSuperPixelAttachments();
    });
    chip.appendChild(remove);
    tray.appendChild(chip);
  });
}

const SUPER_PIXEL_IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp)$/i;
const SUPER_PIXEL_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

// 本地文件拖入/选择：转 data URL 直接进附件盘，服务端会落成公开资产再发给模型
async function addSuperPixelLocalFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  let added = 0;
  const skipped = [];
  for (const file of files) {
    if (!SUPER_PIXEL_IMAGE_TYPES.test(file.type)) {
      skipped.push(`${file.name}（仅支持 PNG/JPG/WebP）`);
      continue;
    }
    if (file.size > SUPER_PIXEL_MAX_IMAGE_BYTES) {
      skipped.push(`${file.name}（超过 8MB）`);
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (addSuperPixelAttachment({ url: dataUrl, preview: dataUrl, name: file.name })) added += 1;
    } catch (error) {
      skipped.push(`${file.name}（${error.message}）`);
    }
  }
  if (added) renderSuperPixelAttachments();
  if (skipped.length) toast(`已跳过：${skipped.slice(0, 3).join("；")}`);
}

function addSuperPixelAttachment(image) {
  if (!image?.url) return false;
  const items = state.superPixel.attachments;
  if (items.length >= SUPER_PIXEL_MAX_ATTACHMENTS) {
    toast(`单条消息最多 ${SUPER_PIXEL_MAX_ATTACHMENTS} 张图`);
    return false;
  }
  if (items.some((item) => item.url === image.url)) return false;
  items.push(image);
  return true;
}

// 把一条消息转成接口要的 content：无图=字符串，有图=多模态数组
function superPixelMessagePayload(message) {
  const images = Array.isArray(message.images) ? message.images : [];
  if (!images.length) return { role: message.role, content: message.content };
  const parts = [];
  if (message.content) parts.push({ type: "text", text: message.content });
  for (const image of images) parts.push({ type: "image_url", image_url: { url: image.url } });
  return { role: message.role, content: parts };
}

async function submitSuperPixelChat(prompt) {
  const text = String(prompt || "").trim();
  const images = state.superPixel.attachments.slice();
  // 只拖了图没打字也允许发，补一句默认问法
  if (!text && !images.length) return;
  if (state.superPixel.sending) return;
  if (state.superPixel.mode !== "ask") return toast("Agent 模式暂未开放");
  const assistant = { role: "assistant", content: "", pending: true };
  state.superPixel.messages.push(
    { role: "user", content: text || "看看这些图，给我创作建议。", images },
    assistant,
  );
  state.superPixel.attachments = [];
  renderSuperPixelAttachments();
  state.superPixel.sending = true;
  state.superPixel.controller = new AbortController();
  renderSuperPixelMessages();
  try {
    const response = await fetch("/api/super-pixel/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: state.superPixel.model,
        mode: state.superPixel.mode,
        scriptText: state.superPixel.scriptText,
        messages: state.superPixel.messages
          .map(superPixelMessagePayload)
          .filter((item) => (Array.isArray(item.content) ? item.content.length : item.content)),
      }),
      signal: state.superPixel.controller.signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    await readSuperPixelStream(response, (delta) => {
      assistant.content += delta;
      assistant.pending = false;
      renderSuperPixelMessages();
    });
    assistant.pending = false;
  } catch (error) {
    if (error?.name !== "AbortError") assistant.content = `请求失败：${error.message || "网络错误"}`;
    assistant.pending = false;
  } finally {
    state.superPixel.sending = false;
    state.superPixel.controller = null;
    renderSuperPixelMessages();
  }
}

function bindSuperPixel() {
  const input = $("#superPixelInput");
  const form = $("#superPixelComposer");
  if (input) {
    const autoGrow = () => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    };
    input.addEventListener("input", autoGrow);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });
  }
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input?.value.trim()) return;
    const prompt = input.value;
    input.value = "";
    input.style.height = "auto";
    submitSuperPixelChat(prompt);
  });
  $("#superPixelModel")?.addEventListener("change", (event) => {
    state.superPixel.model = event.target.value;
  });
  $("#superPixelMode")?.addEventListener("change", (event) => {
    state.superPixel.mode = event.target.value;
  });
  const scriptUpload = $("#superPixelScriptUpload");
  $("#superPixelAttach")?.addEventListener("click", () => scriptUpload?.click());
  scriptUpload?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await readScriptUpload(file);
      state.superPixel.scriptText = result.text;
      state.superPixel.scriptName = file.name;
      $("#superPixelScriptLabel").textContent = file.name;
      toast(result.isDocx ? "DOCX 剧本已提取" : "剧本已载入");
    } catch (error) {
      toast(error.message);
    } finally {
      event.target.value = "";
    }
  });
  const imageUpload = $("#superPixelImageUpload");
  $("#superPixelImagePick")?.addEventListener("click", () => imageUpload?.click());
  imageUpload?.addEventListener("change", async (event) => {
    await addSuperPixelLocalFiles(event.target.files);
    event.target.value = "";
  });
  // 整个 composer 作为拖放区：本地图片文件直接拖进来
  const composer = $(".super-pixel-composer");
  if (composer) {
    const isFileDrag = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
    composer.addEventListener("dragover", (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      composer.classList.add("is-dragover");
    });
    composer.addEventListener("dragleave", (event) => {
      if (!composer.contains(event.relatedTarget)) composer.classList.remove("is-dragover");
    });
    composer.addEventListener("drop", async (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      composer.classList.remove("is-dragover");
      await addSuperPixelLocalFiles(event.dataTransfer.files);
    });
  }
  // 截图直接粘贴
  input?.addEventListener("paste", async (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    await addSuperPixelLocalFiles(files);
  });
  $$("[data-super-pixel-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (!input) return;
      input.value = chip.dataset.superPixelChip;
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
  });
}

function showExploreCanvasHome() {
  setExploreView("canvas");
  renderExploreHome();
}

function replaceImageExploreHistoryItem(id, patch = {}) {
  state.imageStudio.history = state.imageStudio.history.map((item) => (item.id === id ? { ...item, ...patch } : item));
  renderImageExploreView();
}

function replaceImageExploreStoryboardHistoryItem(id, patch = {}) {
  state.imageStudio.storyboardHistory = state.imageStudio.storyboardHistory.map((item) => (item.id === id ? { ...item, ...patch } : item));
  renderImageExploreView();
}

async function pollImageExploreGeneration(taskId) {
  for (let attempt = 0; attempt < IMAGE_EXPLORE_POLL_MAX_ATTEMPTS; attempt += 1) {
    const data = await api(`/api/canvas/image-generations/${encodeURIComponent(taskId)}`, { cache: "no-store" });
    const result = data.result || {};
    if (result.status === "completed" || result.status === "failed") return result;
    await new Promise((resolve) => setTimeout(resolve, IMAGE_EXPLORE_POLL_INTERVAL_MS));
  }
  return { status: "running", taskId, timedOut: true, message: "任务仍在后台生成，请稍后刷新查看" };
}

async function runImageExploreGeneration(item) {
  try {
    let taskId = String(item.taskId || "").trim();
    if (!taskId) {
      const data = await api("/api/canvas/image-generation", {
        method: "POST",
        body: JSON.stringify({
          prompt: item.prompt,
          ratio: item.ratio,
          resolution: item.resolution,
          imageModel: item.model || "gpt-image-2",
          referenceImages: Array.isArray(item.referenceImages) ? item.referenceImages : [],
        }),
      });
      taskId = data.result?.taskId;
    }
    if (!taskId) throw new Error("图片任务没有返回 ID");
    replaceImageExploreHistoryItem(item.id, { taskId, status: "running", message: "生成中" });
    persistImageExploreHistory();
    const result = await pollImageExploreGeneration(taskId);
    if (result.timedOut) {
      replaceImageExploreHistoryItem(item.id, { status: "running", message: result.message });
      persistImageExploreHistory();
      return;
    }
    if (result.status !== "completed" || !result.url) throw new Error(result.message || "图片生成失败");
    replaceImageExploreHistoryItem(item.id, {
      status: "completed",
      url: result.url,
      message: "",
      source: "image-generation",
      generationMode: "ai-generated",
      aiGenerated: true,
      verificationType: "ai-generated",
      assetStylePreset: "photoreal",
      assetStyleLabel: "AI 写实",
      libraryAssetId: result.libraryAssetId || "",
    });
    loadAssetLibrary({ silent: true }).catch(() => {});
  } catch (error) {
    replaceImageExploreHistoryItem(item.id, { status: "failed", message: error.message });
  }
}

async function runImageExploreStoryboardGeneration(item) {
  try {
    let taskId = String(item.taskId || "").trim();
    if (!taskId) {
      const data = await api("/api/canvas/image-generation", {
        method: "POST",
        body: JSON.stringify({
          prompt: item.prompt,
          ratio: "16:9",
          resolution: item.resolution,
          imageModel: item.model || "gpt-image-2",
          referenceImages: Array.isArray(item.referenceImages) ? item.referenceImages : [],
        }),
      });
      taskId = data.result?.taskId;
    }
    if (!taskId) throw new Error("故事板图片任务没有返回 ID");
    replaceImageExploreStoryboardHistoryItem(item.id, { taskId, status: "running", message: "生成中" });
    persistImageExploreStoryboardHistory();
    const result = await pollImageExploreGeneration(taskId);
    if (result.timedOut) {
      replaceImageExploreStoryboardHistoryItem(item.id, { status: "running", message: result.message });
      persistImageExploreStoryboardHistory();
      return;
    }
    if (result.status !== "completed" || !result.url) throw new Error(result.message || "故事板图片生成失败");
    replaceImageExploreStoryboardHistoryItem(item.id, {
      status: "completed",
      url: result.url,
      message: "",
      source: "image-storyboard",
      generationMode: "ai-generated",
      aiGenerated: true,
      verificationType: "ai-generated",
      assetStylePreset: "photoreal",
      assetStyleLabel: "AI 写实",
      libraryAssetId: result.libraryAssetId || "",
    });
    loadAssetLibrary({ silent: true }).catch(() => {});
  } catch (error) {
    replaceImageExploreStoryboardHistoryItem(item.id, { status: "failed", message: error.message });
  }
}

async function resumeImageExploreGenerations() {
  const imageItems = state.imageStudio.history.filter((item) => item?.status === "running" && item.taskId);
  const storyboardItems = state.imageStudio.storyboardHistory.filter((item) => item?.status === "running" && item.taskId);
  const pending = [...imageItems, ...storyboardItems];
  if (!pending.length) return;
  state.imageStudio.activeGenerations = pending.length;
  state.imageStudio.generating = true;
  state.imageStudio.storyboardGenerating = storyboardItems.length > 0;
  state.imageStudio.storyboardActiveBatchId = storyboardItems[0]?.batchId || "";
  renderImageExploreView();
  try {
    await Promise.all([
      ...imageItems.map((item) => runImageExploreGeneration(item)),
      ...storyboardItems.map((item) => runImageExploreStoryboardGeneration(item)),
    ]);
  } finally {
    state.imageStudio.activeGenerations = 0;
    state.imageStudio.generating = false;
    state.imageStudio.storyboardGenerating = false;
    state.imageStudio.storyboardActiveBatchId = "";
    persistImageExploreHistory();
    persistImageExploreStoryboardHistory();
    renderImageExploreView();
  }
}

async function planAndGenerateImageExploreStoryboardBatch({ batchId, items, prompt, boardCount, referenceImages }) {
  const planData = await api("/api/canvas/image-storyboard-plan", {
    method: "POST",
    body: JSON.stringify({ prompt, boardCount, referenceImageCount: referenceImages.length, referenceImages }),
  });
  const boards = Array.isArray(planData.result?.boards) ? planData.result.boards : [];
  if (boards.length !== boardCount) throw new Error("故事板规划返回数量不正确，请重试");
  const plannedItems = boards.map((board, index) => ({
    ...items[index],
    status: "running",
    prompt: board.imagePrompt,
    board,
    index: board.index || index + 1,
  }));
  const plannedById = new Map(plannedItems.map((item) => [item.id, item]));
  state.imageStudio.storyboardHistory = state.imageStudio.storyboardHistory.map((item) => plannedById.get(item.id) || item);
  renderImageExploreView();
  await Promise.all(plannedItems.map((item) => runImageExploreStoryboardGeneration(item)));
}

async function retryImageExploreStoryboardBatch(failedItem) {
  const batchId = String(failedItem?.batchId || "").trim();
  const batchItems = state.imageStudio.storyboardHistory.filter((item) => item.batchId === batchId);
  const prompt = String(failedItem?.storyPrompt || batchItems[0]?.storyPrompt || "").trim();
  const boardCount = Math.max(1, Math.min(4, Number(failedItem?.totalBoards || failedItem?.boardCount || batchItems.length) || 1));
  if (!batchId || !prompt || !batchItems.length) {
    toast("缺少故事内容，请重新填写故事后生成");
    return;
  }
  if (state.imageStudio.storyboardGenerating) return;
  const generationReferences = Array.isArray(failedItem.referenceImages) ? failedItem.referenceImages : [];
  const plannerReferences = state.imageStudio.references
    .filter((reference) => !reference.uploading)
    .map((reference) => reference.url || reference.localUrl)
    .filter(Boolean);
  const referenceImages = plannerReferences.length ? plannerReferences : generationReferences;
  const resetItems = batchItems.map((item) => ({
    ...item,
    status: "planning",
    taskId: "",
    prompt: "",
    url: "",
    message: "",
    board: { index: item.index || item.board?.index || 1 },
  }));
  const resetById = new Map(resetItems.map((item) => [item.id, item]));
  state.imageStudio.storyboardHistory = state.imageStudio.storyboardHistory.map((item) => resetById.get(item.id) || item);
  state.imageStudio.storyboardActiveBatchId = batchId;
  state.imageStudio.storyboardGenerating = true;
  beginImageExploreGeneration();
  renderImageExploreView();
  try {
    await planAndGenerateImageExploreStoryboardBatch({ batchId, items: resetItems, prompt, boardCount, referenceImages });
  } catch (error) {
    state.imageStudio.storyboardHistory = state.imageStudio.storyboardHistory.map((item) => (
      item.batchId === batchId && item.status === "planning"
        ? { ...item, status: "failed", message: error.message || "故事板规划失败" }
        : item
    ));
    toast(error.message || "故事板重新生成失败");
  } finally {
    endImageExploreGeneration();
    state.imageStudio.storyboardGenerating = false;
    state.imageStudio.storyboardActiveBatchId = "";
    persistImageExploreStoryboardHistory();
    renderImageExploreView();
  }
}

async function submitImageExploreStoryboard(event) {
  event?.preventDefault();
  const prompt = String(state.imageStudio.prompt || "").trim();
  if (!prompt) {
    toast("请先填写故事或情节");
    $("#imageExplorePrompt")?.focus();
    return;
  }
  if (state.imageStudio.referencesUploading > 0) return;
  const boardCount = Math.max(1, Math.min(4, Number(state.imageStudio.storyboardCount) || 1));
  const referenceImages = state.imageStudio.references
    .filter((reference) => !reference.uploading)
    .map((reference) => reference.localUrl || reference.url)
    .filter(Boolean);
  const plannerReferenceImages = state.imageStudio.references
    .filter((reference) => !reference.uploading)
    .map((reference) => reference.url || reference.localUrl)
    .filter(Boolean);
  const model = state.imageStudio.model || "gpt-image-2";
  const batchId = `storyboard-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  const items = Array.from({ length: boardCount }, (_, index) => ({
    id: `storyboard-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    status: "planning",
    prompt: "",
    storyPrompt: prompt,
    ratio: "16:9",
    resolution: state.imageStudio.resolution,
    model,
    referenceImages,
    board: { index: index + 1 },
    boardCount,
    totalBoards: boardCount,
    batchId,
    index: index + 1,
    url: "",
    createdAt,
  }));
  state.imageStudio.storyboardCount = boardCount;
  state.imageStudio.storyboardActiveBatchId = batchId;
  state.imageStudio.storyboardGenerating = true;
  state.imageStudio.storyboardHistory = [...items, ...state.imageStudio.storyboardHistory].slice(0, 24);
  beginImageExploreGeneration();
  renderImageExploreView();
  try {
    await planAndGenerateImageExploreStoryboardBatch({
      batchId,
      items,
      prompt,
      boardCount,
      referenceImages: plannerReferenceImages,
    });
  } catch (error) {
    state.imageStudio.storyboardHistory = state.imageStudio.storyboardHistory.map((item) => (
      item.batchId === batchId && item.status === "planning"
        ? { ...item, status: "failed", message: error.message || "故事板规划失败" }
        : item
    ));
    renderImageExploreView();
    throw error;
  } finally {
    endImageExploreGeneration();
    state.imageStudio.storyboardGenerating = false;
    state.imageStudio.storyboardActiveBatchId = "";
    persistImageExploreStoryboardHistory();
    renderImageExploreView();
  }
}

async function submitImageExploreGeneration(event) {
  event?.preventDefault();
  if (state.imageStudio.storyboardMode === true) return submitImageExploreStoryboard(event);
  const prompt = String(state.imageStudio.prompt || "").trim();
  if (!prompt) {
    toast("请先填写图片描述");
    $("#imageExplorePrompt")?.focus();
    return;
  }
  if (state.imageStudio.referencesUploading > 0) return;
  beginImageExploreGeneration();
  const count = Math.max(1, Math.min(4, Number(state.imageStudio.count) || 1));
  const referenceImages = state.imageStudio.references
    .filter((reference) => !reference.uploading)
    .map((reference) => reference.localUrl || reference.url)
    .filter(Boolean);
  const model = state.imageStudio.model || "gpt-image-2";
  const items = Array.from({ length: count }, (_, index) => ({
    id: `image-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    status: "running",
    prompt,
    ratio: state.imageStudio.ratio,
    resolution: state.imageStudio.resolution,
    model,
    referenceImages,
    url: "",
    createdAt: new Date().toISOString(),
  }));
  state.imageStudio.history = [...items, ...state.imageStudio.history].slice(0, 24);
  renderImageExploreView();
  try {
    await Promise.all(items.map((item) => runImageExploreGeneration(item)));
  } finally {
    endImageExploreGeneration();
    persistImageExploreHistory();
    renderImageExploreView();
  }
}

async function uploadImageExploreReferences(event) {
  const input = event.currentTarget;
  const files = [...(input.files || [])].slice(0, 4 - state.imageStudio.references.length);
  if (!files.length) return;
  const references = files.map((file, index) => ({
    id: `reference-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name || "参考图",
    url: "",
    localUrl: "",
    previewUrl: URL.createObjectURL(file),
    uploading: true,
  }));
  state.imageStudio.references.push(...references);
  state.imageStudio.referencesUploading += references.length;
  renderImageExploreView();
  const errors = [];
  try {
    await runReferenceUploadWorkers(references, files, async (reference, file) => {
      try {
        const dataUrl = await prepareImageReferenceDataUrl(file);
        const data = await api("/api/canvas/public-assets", {
          method: "POST",
          body: JSON.stringify({ name: file.name || "image-reference", dataUrl, localOnly: true }),
        });
        const result = data.result || {};
        const localUrl = result.localUrl || result.url;
        if (!localUrl) throw new Error(`${file.name || "参考图"} 上传失败`);
        const current = state.imageStudio.references.find((item) => item.id === reference.id);
        if (!current) return;
        const previousPreviewUrl = current.previewUrl;
        Object.assign(current, {
          url: localUrl,
          localUrl: result.localUrl || localUrl,
          previewUrl: result.localUrl || result.url || localUrl,
          uploading: false,
        });
        if (previousPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(previousPreviewUrl);
        renderImageExploreView();
      } catch (error) {
        const current = state.imageStudio.references.find((item) => item.id === reference.id);
        if (current?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(current.previewUrl);
        state.imageStudio.references = state.imageStudio.references.filter((item) => item.id !== reference.id);
        errors.push(error.message || `${file.name || "参考图"} 上传失败`);
      } finally {
        state.imageStudio.referencesUploading = Math.max(0, state.imageStudio.referencesUploading - 1);
        renderImageExploreView();
      }
    });
  } finally {
    input.value = "";
    renderImageExploreView();
  }
  if (errors.length) toast(errors[0]);
}

function clearImageExploreHistory() {
  state.imageStudio.history = [];
  state.imageStudio.storyboardHistory = [];
  persistImageExploreHistory();
  persistImageExploreStoryboardHistory();
  renderImageExploreView();
}

async function openExploreTool(tool) {
  if (tool === "image-generation") {
    showExploreImageTool();
    return;
  }
  if (tool === "asset-library") {
    showExploreAssetLibrary();
    return;
  }
  if (tool === "super-pixel") {
    // 开发中功能：非管理员即使绕过隐藏的入口也不放行
    if (state.authUser?.role !== "admin") return;
    showExploreSuperPixel();
    return;
  }
  const mode = PixelToysWorkspaceShell.workspaceModeForTool(tool);
  const projectId = state.selectedId || state.projects[0]?.id || "";
  if (!projectId) {
    openProjectModal();
    return;
  }
  await loadProject(projectId, { openStudio: true });
  setWorkspaceMode(mode);
}

async function openTeamProgressProject(projectId, stage) {
  const token = Symbol(projectId);
  teamProgressOpenToken = token;
  await loadProject(projectId, { openStudio: true });
  if (teamProgressOpenToken !== token || state.selectedId !== projectId) return;
  setWorkspaceMode(teamProgressWorkspaceMode(stage));
  state.teamPanelOpen = false;
  renderTeamPanel();
}

function studioTabExists(tab) {
  return !!document.querySelector(`[data-studio-panel="${CSS.escape(String(tab || ""))}"]`);
}

function setWorkspaceMode(mode, { persist = true } = {}) {
  const nextMode = PixelToysWorkspaceShell.normalizeWorkspaceMode(mode);
  state.activeWorkspaceMode = nextMode;
  document.body.dataset.studioFocus = studioWorkflowFocusFromMode(nextMode);
  if (persist) localStorage.setItem(layoutStorageKey(WORKSPACE_MODE_KEY, state.authUser), nextMode);
  $$("[data-workspace-mode-button]").forEach((button) => {
    const active = button.dataset.workspaceModeButton === nextMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  $$("[data-workspace-mode]").forEach((panel) => {
    const modes = String(panel.dataset.workspaceMode || "").split(/\s+/).filter(Boolean);
    const active = modes.includes(nextMode);
    panel.classList.toggle("is-active", active);
    panel.toggleAttribute("hidden", !active);
    if (active && modes.includes("image") && modes.includes("assets")) panel.dataset.assetWorkspaceView = nextMode;
  });
  state.activeStudioTab = nextMode === "storyboard" ? "storyboards" : nextMode === "image" ? "assets" : nextMode;
  renderAssetInspector();
  if (nextMode === "assets" && state.assetLibrary.workflowExpanded && !state.assetLibrary.loaded) {
    loadAssetLibrary({ silent: true }).catch((error) => toast(error.message));
  }
  if (nextMode === "shots") renderShotsTable();
  if (state.project?.project) renderStudioFlowStatus(state.project);
  updateStudioPrimaryRun();
  requestAnimationFrame(updateWorkspaceSize);
}

function setStudioTab(tab, { persist = true } = {}) {
  const nextTab = studioTabExists(tab) ? tab : "assets";
  const modeMap = { storyboards: "storyboard", assets: "assets", shots: "shots", video: "video", logs: "assets" };
  state.activeStudioTab = nextTab;
  if (persist) localStorage.setItem(layoutStorageKey(STUDIO_TAB_KEY, state.authUser), nextTab);
  $$("[data-studio-tab]").forEach((button) => {
    const active = button.dataset.studioTab === nextTab;
    button.classList.toggle("is-active", active);
    if (button.getAttribute("role") === "tab") button.setAttribute("aria-selected", active ? "true" : "false");
  });
  setWorkspaceMode(modeMap[nextTab] || nextTab, { persist });
}

function studioWorkflowFocusFromMode(mode = state.activeWorkspaceMode) {
  if (mode === "image" || mode === "assets") return "assets";
  if (mode === "storyboard") return "board";
  if (mode === "shots") return "shots";
  if (mode === "video") return "video";
  return "script";
}

function setWorkflowFocus(focus, { persist = true } = {}) {
  const key = String(focus || "").trim();
  const modeMap = {
    script: "script",
    assets: "assets",
    board: "storyboard",
    storyboard: "storyboard",
    shots: "shots",
    video: "video",
    cut: "video",
  };
  const tabMap = {
    assets: "assets",
    board: "storyboards",
    storyboard: "storyboards",
    shots: "shots",
    video: "video",
    cut: "video",
  };
  if (tabMap[key]) state.activeStudioTab = tabMap[key];
  setWorkspaceMode(modeMap[key] || "script", { persist });
}

function isAssetExtracting() {
  return !!state.uiBusy.assetExtracting || !!state.uiBusy.projectCreating;
}

function isDraftGenerating() {
  return !!state.uiBusy.draftGenerating;
}

function flowStepClass(done, active, blocked = false, running = false, focused = false) {
  const classes = [];
  if (blocked) classes.push("warn");
  else if (done) classes.push("ok");
  if (active) classes.push("active");
  if (running) classes.push("is-running");
  if (focused) classes.push("is-focused");
  return classes.join(" ");
}

function finalCutOutputReady(finalCut) {
  return !!finalCut?.output?.url;
}

function activeStudioRun(data = state.project, steps = []) {
  const runningSteps = steps.filter((step) => step.running);
  if (!runningSteps.length) return null;
  const focusedKey = studioWorkflowFocusFromMode();
  const step = runningSteps.find((item) => item.key === focusedKey) || runningSteps[0];
  const progress = data?.videoProgress || {};
  const runningVideo = (progress.items || []).find((item) => item.status === "running") || (progress.items || []).find((item) => item.status === "queued");
  const detailByStep = {
    script: isDraftGenerating()
      ? "模型正在编排镜头、对白和视频提示词"
      : `${step.value || "生成中"}`,
    assets: isAssetExtracting()
      ? "正在读取剧本并识别资产"
      : `${step.value || "生成中"}`,
    board: `${step.value || "生成中"}`,
    video: runningVideo
      ? `${runningVideo.name || "视频片段"}${Number.isFinite(Number(runningVideo.progress)) ? ` · ${Math.round(Number(runningVideo.progress))}%` : " · 已提交"}`
      : `${progress.completed || 0}/${progress.total || 0} 个片段`,
    cut: data?.finalCut?.message || "正在组装成片",
  };
  const labelByStep = { script: "分镜草稿", assets: "资产", board: "故事板", video: "视频", cut: "成片" };
  return {
    key: step.key,
    label: labelByStep[step.key] || step.label,
    detail: detailByStep[step.key] || step.value || "运行中",
    count: runningSteps.length,
  };
}

function isReadyForNextStoryGuidance(data = state.project) {
  const config = data?.videoConfigStatus || {};
  const progress = data?.videoProgress || {};
  return (
    config.workflowGuide === "next_story" &&
    config.ready === true &&
    !isDraftGenerating() &&
    !videoProgressHasActiveWork(progress) &&
    !(Number(progress.total || 0) > 0)
  );
}

function studioFlowSignature(steps = [], activeRun = null) {
  return JSON.stringify({
    active: activeRun ? [activeRun.key, activeRun.detail, activeRun.count] : null,
    steps: steps.map((step) => [step.key, step.value, step.done ? 1 : 0, step.active ? 1 : 0, step.blocked ? 1 : 0, step.running ? 1 : 0, step.focused ? 1 : 0, Number(step.ratio || 0).toFixed(3)]),
  });
}

function renderStudioFlowStatus(data = state.project) {
  const node = $("#studioFlowStatus");
  if (!node) return;
  const progress = $("#studioFlowProgress");
  if (!data?.project) {
    node.innerHTML = "";
    if (progress) progress.textContent = "00 / 06";
    updateStudioPrimaryRun(null);
    renderStudioContext(null, []);
    renderStudioQueue(null);
    return;
  }
  const scriptReady = !!String(data.contents?.script || "").trim();
  const manifest = data.assetManifest || null;
  const extracting = isAssetExtracting();
  const manifestReady = !!manifest?.items?.length;
  const manifestConfirmed = !!manifest?.confirmed;
  const assetSlots = mergeSlotsWithScannedAssets(data.assetSlots || buildAssetSlots(manifest, data.assets || []), data.assets || []);
  const assetTotal = assetSlots.filter((slot) => !slot.skipped && slot.status !== "skipped").length;
  const assetReady = assetSlots.filter((slot) => !slot.skipped && slot.status !== "skipped" && slot.status === "ready").length;
  const assetRunning = ["running", "queued"].includes(String(data.assetJob?.status || "").toLowerCase()) || (data.jobs || []).some((job) => ["running", "queued"].includes(String(job?.status || "").toLowerCase()) && /asset|image/i.test(job.type || job.command || ""));
  const storyboardSlots = data.storyboardSlots || [];
  const boardReady = storyboardSlots.filter((slot) => slot.status === "ready").length;
  const boardRunning = ["running", "queued"].includes(String(data.storyboardJob?.status || "").toLowerCase());
  const config = data.videoConfigStatus || {};
  const videoProgress = data.videoProgress || {};
  const videoTotal = videoProgress.total || videoProgress.items?.length || 0;
  const videoDone = videoProgress.completed || 0;
  const videoRunning = videoProgressHasActiveWork(videoProgress);
  const cutReady = finalCutOutputReady(data.finalCut);
  const cutRunning = !!data.finalCut?.running;
  const cutFailed = !!data.finalCut?.error;
  const readyForNextStory = isReadyForNextStoryGuidance(data);
  const focus = readyForNextStory ? "script" : studioWorkflowFocusFromMode();
  // 进度比例(0..1)——状态栏动效按真实进度走;busy=正在干活但份数未知→用不定量流动条。
  const frac = (ready, total) => (total > 0 ? Math.max(0, Math.min(1, ready / total)) : 0);
  const steps = [
    {
      key: "script",
      label: "SCRIPT",
      value: isDraftGenerating() ? "drafting" : scriptReady ? "ready" : "empty",
      done: scriptReady,
      focused: focus === "script",
      running: isDraftGenerating(),
      ratio: scriptReady ? 1 : 0,
      busy: isDraftGenerating(),
    },
    {
      key: "assets",
      label: "ASSETS",
      value: extracting ? "parsing" : manifestConfirmed ? `${assetReady}/${assetTotal || "0"} ready` : manifestReady ? "confirm" : "missing",
      done: manifestConfirmed && (!assetTotal || assetReady >= assetTotal),
      focused: focus === "assets",
      running: extracting || assetRunning,
      blocked: !extracting && manifestReady && !manifestConfirmed,
      // 解析阶段份数未知→流动;出图阶段按 已生成/总数 真实进度。
      ratio: extracting ? null : manifestReady ? (assetTotal ? frac(assetReady, assetTotal) : manifestConfirmed ? 1 : 0) : 0,
      busy: extracting || (assetRunning && !assetTotal),
    },
    {
      key: "board",
      label: "BOARD",
      value: storyboardSlots.length ? `${boardReady}/${storyboardSlots.length}` : "optional",
      done: !!storyboardSlots.length && boardReady >= storyboardSlots.length,
      focused: focus === "board",
      running: boardRunning,
      ratio: storyboardSlots.length ? frac(boardReady, storyboardSlots.length) : 0,
      busy: boardRunning && !storyboardSlots.length,
    },
    {
      key: "shots",
      label: "SHOTS",
      value: config.ready ? "ready" : config.exists ? "draft" : "draft",
      done: !!config.ready,
      focused: focus === "shots",
      running: false,
      blocked: !!config.exists && !config.ready,
      ratio: config.ready ? 1 : 0,
      busy: false,
    },
    {
      key: "video",
      label: "VIDEO",
      value: videoTotal ? `${videoDone}/${videoTotal}` : "queued",
      done: !!videoTotal && videoDone >= videoTotal,
      focused: focus === "video",
      running: videoRunning,
      // 视频片段按 完成/总数 真实进度推进。
      ratio: videoTotal ? frac(videoDone, videoTotal) : 0,
      busy: videoRunning && !videoTotal,
    },
    {
      key: "cut",
      label: "CUT",
      value: cutReady ? "ready" : cutRunning ? "assembling" : cutFailed ? "failed" : "locked",
      done: cutReady,
      focused: focus === "cut",
      running: cutRunning,
      blocked: cutFailed,
      // 剪辑合成无份数→流动动效。
      ratio: cutReady ? 1 : 0,
      busy: cutRunning,
    },
  ];
  if (readyForNextStory) {
    steps.forEach((step) => {
      step.value = "未启动";
      step.done = false;
      step.running = false;
      step.blocked = false;
      step.ratio = 0;
      step.busy = false;
      step.focused = step.key === "script";
    });
  }
  const hasRunningStep = steps.some((step) => step.running);
  steps.forEach((step) => {
    step.active = step.running || (!hasRunningStep && step.focused);
  });
  const activeRun = activeStudioRun(data, steps);
  const signature = studioFlowSignature(steps, activeRun);
  if (node.dataset.flowSig !== signature) {
    node.dataset.flowSig = signature;
    node.innerHTML = steps
      .map(
        (step) => {
        // 状态栏进度条状态:done=满绿静止;determinate=按真实比例填充(平滑推进);
        // indeterminate=正在干活但份数未知,用流动条;idle=空。
        const progressState = step.done
          ? "done"
          : step.running && step.ratio > 0
            ? "determinate"
            : step.running || step.busy
              ? "indeterminate"
            : step.ratio > 0
              ? "determinate"
              : "idle";
        const ratio = Math.max(0, Math.min(1, step.done ? 1 : step.ratio || 0));
        return [
          '<button class="studio-flow-step ' + flowStepClass(step.done, step.active, step.blocked, step.running, step.focused) + '" type="button" data-workflow-focus="' + step.key + '" data-progress-state="' + progressState + '" style="--flow-ratio:' + ratio.toFixed(3) + '">',
          '<i class="studio-flow-dot" aria-hidden="true"></i>',
          '<span>' + escapeHtml(step.label) + '</span>',
          '<strong>' + escapeHtml(step.value) + '</strong>',
          '<i class="studio-flow-fill" aria-hidden="true"></i>',
          '</button>',
        ].join("");
        },
      )
      .join("");
    node.querySelectorAll("[data-workflow-focus]").forEach((button) => {
      button.addEventListener("click", () => setWorkflowFocus(button.dataset.workflowFocus || "script"));
    });
  }
  if (progress) {
    const activeIndex = Math.max(0, steps.findIndex((step) => step.active));
    progress.textContent = activeRun
      ? `LIVE · ${activeRun.label} · ${activeRun.detail}${activeRun.count > 1 ? ` · +${activeRun.count - 1}` : ""}`
      : `${String(activeIndex + 1).padStart(2, "0")} / 06`;
    progress.classList.toggle("is-live", !!activeRun);
    progress.setAttribute("aria-live", activeRun ? "polite" : "off");
  }
  renderStudioContext(data, steps, activeRun);
  renderStudioQueue(data);
  renderStudioActionStates(data, activeRun);
}

function studioContextMode() {
  const mode = state.activeWorkspaceMode || "assets";
  return mode === "image" ? "assets" : mode;
}

function renderStudioContext(data, steps, activeRun = null) {
  const title = $("#studioContextTitle");
  const copy = $("#studioContextCopy");
  const stage = $("#studioContextStage");
  const status = $("#studioContextStatus");
  const downstream = $("#studioContextDownstream");
  const action = $("#studioContextOpen");
  if (!title || !copy || !stage || !status || !downstream || !action) return;
  if (!data?.project) {
    title.textContent = "当前工作区";
    copy.textContent = "加载项目后显示当前流程状态。";
    stage.textContent = "等待项目";
    status.textContent = "未开始";
    downstream.textContent = "等待输入";
    action.disabled = true;
    return;
  }
  if (activeRun) {
    title.textContent = `LIVE / ${activeRun.label}`;
    copy.textContent = activeRun.detail;
    stage.textContent = activeRun.label;
    status.textContent = "进行中";
    downstream.textContent = activeRun.count > 1 ? `另有 ${activeRun.count - 1} 项任务` : "完成后自动刷新";
    action.disabled = WORKFLOW_PREVIEW_MODE;
    action.textContent = `查看 ${activeRun.label}`;
    action.dataset.workflowFocus = activeRun.key;
    updateStudioPrimaryRun(data);
    return;
  }
  if (isReadyForNextStoryGuidance(data)) {
    title.textContent = "CONTEXT / NEW STORY";
    copy.textContent = "本轮视频配置已保留，工作流已归位，等待下一段剧情。";
    stage.textContent = "SCRIPT";
    status.textContent = "未启动";
    downstream.textContent = "输入新的剧情";
    action.disabled = WORKFLOW_PREVIEW_MODE;
    action.textContent = "查看 SCRIPT";
    action.dataset.workflowFocus = "script";
    updateStudioPrimaryRun(data);
    return;
  }
  const mode = studioContextMode();
  const labels = {
    script: ["SCRIPT", "剧本输入与分镜草稿准备"],
    assets: ["ASSETS", "资产解析与参考图"],
    storyboard: ["BOARD", "Production Board 连续性"],
    shots: ["SHOTS", "镜头提示词与视频配置"],
    video: ["VIDEO", "视频片段队列"],
  };
  const [label, description] = labels[mode] || labels.assets;
  const stepKey = { script: "script", assets: "assets", image: "assets", storyboard: "board", shots: "shots", video: "video" }[mode] || "assets";
  const step = steps.find((item) => item.key === stepKey) || steps[0];
  const project = data.project;
  const counts = project.counts || {};
  const nextMap = {
    script: `资产解析 · ${counts.parsedAssets || 0} 项`,
    assets: `故事板 · ${(data.storyboardSlots || []).length || 0} 张`,
    storyboard: `视频配置 · ${data.videoConfigStatus?.ready ? "可提交" : "待生成"}`,
    shots: `视频片段 · ${data.videoProgress?.total || 0} 个`,
    video: `成片 · ${finalCutOutputReady(data.finalCut) ? "可查看" : "等待片段"}`,
  };
  title.textContent = `CONTEXT / ${label}`;
  copy.textContent = description;
  stage.textContent = label;
  status.textContent = step?.value || "待开始";
  downstream.textContent = nextMap[mode] || "等待输入";
  action.disabled = WORKFLOW_PREVIEW_MODE;
  action.textContent = `查看 ${label}`;
  action.dataset.workflowFocus = stepKey;
  updateStudioPrimaryRun(data);
}

function studioPrimaryActionForMode(mode = state.activeWorkspaceMode, data = state.project) {
  if (mode === "script") {
    return { label: "Run: 生成分镜草稿", selector: "", focus: "script" };
  }
  if (mode === "image" || mode === "assets") {
    return { label: "Run: 生成资产", selector: "[data-job='assets']", focus: "assets" };
  }
  if (mode === "storyboard") {
    return { label: "Run: 生成故事板", selector: "[data-job='storyboards']", focus: "board" };
  }
  if (mode === "shots") {
    return { label: "Run: 生成视频配置", selector: "#buildConfigBtn", focus: "shots" };
  }
  if (mode === "video") {
    return finalCutOutputReady(data?.finalCut)
      ? { label: "Run: 组装成片", selector: "#assembleFinalCutBtn", focus: "video" }
      : { label: "Run: 视频生成", selector: "#generateAllSegments", focus: "video" };
  }
  return { label: "Run: 当前步骤", selector: "", focus: studioWorkflowFocusFromMode(mode) };
}

function updateStudioPrimaryRun(data = state.project) {
  const button = $("#studioPrimaryRun");
  if (!button) return;
  const action = studioPrimaryActionForMode(state.activeWorkspaceMode, data);
  button.textContent = action.label;
  button.dataset.workflowFocus = action.focus || "script";
  button.dataset.targetSelector = action.selector || "";
  button.disabled = WORKFLOW_PREVIEW_MODE || !data?.project;
}

function setStudioTaskButtonState(button, running, label) {
  if (!button || button.dataset.studioFeedbackBusy === "true") return;
  if (running) {
    if (button.dataset.studioTaskRunning !== "true") {
      button.dataset.studioTaskLabel = button.textContent || "";
      button.dataset.studioTaskDisabled = button.disabled ? "true" : "false";
    }
    button.dataset.studioTaskRunning = "true";
    button.textContent = label;
    button.disabled = true;
    button.classList.add("is-task-running");
    button.setAttribute("aria-busy", "true");
    return;
  }
  if (button.dataset.studioTaskRunning !== "true") return;
  button.textContent = button.dataset.studioTaskLabel || button.textContent;
  button.disabled = button.dataset.studioTaskDisabled === "true";
  button.classList.remove("is-task-running");
  button.removeAttribute("aria-busy");
  delete button.dataset.studioTaskRunning;
  delete button.dataset.studioTaskLabel;
  delete button.dataset.studioTaskDisabled;
}

function renderStudioActionStates(data = state.project, activeRun = null) {
  const assetRunning = isAssetExtracting() || ["running", "queued"].includes(String(data?.assetJob?.status || "").toLowerCase());
  const boardRunning = ["running", "queued"].includes(String(data?.storyboardJob?.status || "").toLowerCase());
  const videoProgress = data?.videoProgress || {};
  const videoRunning = videoProgressHasActiveWork(videoProgress);
  const videoLabel = `视频生成中 ${videoProgress.completed || 0}/${videoProgress.total || 0}`;
  setStudioTaskButtonState(document.querySelector("[data-job='assets']"), assetRunning, isAssetExtracting() ? "资产解析中" : "资产生成中");
  setStudioTaskButtonState(document.querySelector("[data-job='storyboards']"), boardRunning, "故事板生成中");
  setStudioTaskButtonState($("#generateAllSegments"), videoRunning, videoLabel);
  setStudioTaskButtonState($("#studioPrimaryRun"), !!activeRun, activeRun ? `运行中 · ${activeRun.label}` : "");
}

async function runStudioPrimaryAction() {
  const button = $("#studioPrimaryRun");
  if (!button || button.disabled) return;
  const focus = button.dataset.workflowFocus || studioWorkflowFocusFromMode();
  const selector = button.dataset.targetSelector || "";
  setWorkflowFocus(focus);
  if (focus === "script") {
    return generateDraft();
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const target = selector ? document.querySelector(selector) : null;
  if (!target || target.disabled) throw new Error("当前步骤还没有可执行动作");
  if (selector === "[data-job='assets']") return startJob("assets");
  if (selector === "[data-job='storyboards']") return startJob("storyboards");
  if (selector === "#buildConfigBtn") return buildConfig();
  if (selector === "#generateAllSegments") return generateAllVideoSegments();
  if (selector === "#assembleFinalCutBtn") return assembleFinalCut();
  throw new Error("当前步骤还没有可执行动作");
}

function renderStudioQueue(data) {
  const bar = $("#studioQueueBar");
  const list = $("#studioQueueItems");
  const summary = $("#studioQueueSummary");
  const progressTrack = $("#studioQueueProgress");
  const progressFill = $("#studioQueueProgressFill");
  if (!bar || !list || !summary || !progressTrack || !progressFill) return;

  const resetState = () => {
    bar.classList.remove("is-idle", "is-active", "is-error");
    progressFill.classList.remove("is-indeterminate", "is-error");
    progressTrack.classList.remove("is-error");
  };
  const renderState = ({ items = [], text = "", pct = 0, active = false, indeterminate = false, failed = false }) => {
    resetState();
    list.innerHTML = items.map((item) => item.html).join("");
    list.style.display = items.length ? "flex" : "none";
    summary.textContent = text;
    summary.style.visibility = text ? "visible" : "hidden";
    progressFill.style.width = `${indeterminate ? 30 : pct}%`;
    progressTrack.style.opacity = active || failed ? "1" : "0";
    if (failed) {
      bar.classList.add("is-error");
      progressFill.classList.add("is-error");
      progressTrack.classList.add("is-error");
    } else if (active) {
      bar.classList.add("is-active");
      if (indeterminate) progressFill.classList.add("is-indeterminate");
    } else {
      bar.classList.add("is-idle");
    }
  };

  if (!data?.project) {
    renderState({});
    return;
  }
  const items = [];
  const addJob = (label, job) => {
    if (!job || !["running", "queued", "failed"].includes(String(job.status || "").toLowerCase())) return;
    const status = String(job.status).toLowerCase();
    const statusLabel = status === "running" ? "进行中" : status === "queued" ? "排队" : "失败 / 重试";
    items.push({
      status,
      html: `<span class="studio-queue-item ${status === "failed" ? "is-error" : ""}"><strong>${escapeHtml(label)}</strong><span>${statusLabel}</span></span>`,
    });
  };
  addJob("资产图", data.assetJob);
  addJob("故事板", data.storyboardJob);
  addJob("视频", data.videoJob || data.videoProgress?.job);
  const progress = data.videoProgress || {};
  const progressIsActive = videoProgressHasActiveWork(progress);
  const total = Number(progress.total) > 0 ? Number(progress.total) : 0;
  const completed = total > 0 ? Math.max(0, Math.min(total, Number(progress.completed) || 0)) : 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (completed / total) * 100)) : 0;
  if (progressIsActive) {
    items.push({
      status: "running",
      html: `<span class="studio-queue-item"><strong>片段 ${total > 0 ? `${completed}/${total}` : "进行中"}</strong><span>生成中</span></span>`,
    });
  }
  const hasActiveJob = progressIsActive || items.some((item) => ["running", "queued"].includes(item.status));
  const allFailed = items.length > 0 && items.every((item) => item.status === "failed");
  // 失败态优先于进度态判断:视频任务失败但已有部分片段时(total>0),
  // 必须显示失败而不是继续渲染蓝色进度条。
  if (allFailed) {
    renderState({ items, text: `${items.length} 项失败`, failed: true });
  } else if (total > 0) {
    renderState({ items, text: `${completed}/${total} 片段`, pct, active: true });
  } else if (hasActiveJob) {
    renderState({ items, text: "进行中", active: true, indeterminate: true });
  } else {
    renderState({});
  }
}

function compactJobLog(job) {
  const text = String(job?.logs || "").trim();
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const value = line.trim();
      if (!value || value === "{" || value === "}" || value === "[" || value === "]") return false;
      if (/^"[^"]+"\s*:/.test(value)) return false;
      if (/^["']?(out|url|path|file|stdout|stderr|projectDir|workdir)["']?\s*:/i.test(value)) return false;
      if (/\/Users\/|\/var\/|\\/.test(value)) return false;
      return true;
    })
    .slice(-5)
    .map((line) => line.trim().replace(/[",]+$/g, "").slice(0, 180))
    .join("\n");
}

function renderStudioLogs(data = state.project) {
  const node = $("#studioLogContent");
  if (!node) return;
  if (!data?.project) {
    node.innerHTML = `<div class="studio-log-empty">暂无项目日志。</div>`;
    return;
  }
  const logs = [
    { title: "资产图", job: data.assetJob },
    { title: "Production Board", job: data.storyboardJob },
    { title: "视频", job: data.videoJob || data.videoProgress?.job },
  ].filter((item) => item.job);
  if (!logs.length) {
    node.innerHTML = `<div class="studio-log-empty">当前项目还没有运行日志。</div>`;
    return;
  }
  node.innerHTML = logs
    .map((item) => {
      const log = compactJobLog(item.job);
      return `
        <article class="studio-log-card">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span class="pill ${item.job.status === "running" ? "active" : item.job.status === "complete" ? "ok" : item.job.status === "failed" ? "warn" : ""}">${escapeHtml(statusText(item.job.status))}</span>
          </div>
          ${log ? `<pre>${escapeHtml(log)}</pre>` : `<p>暂无详细日志。</p>`}
        </article>
      `;
    })
    .join("");
}

async function deleteProject(project) {
  const title = project.title || project.episodeSlug || "该项目";
  const confirmed = window.confirm(`确定删除“${title}”吗？项目文件会从本机移除。`);
  if (!confirmed) return;
  const deletingCurrent = state.selectedId === project.id;
  await api(`/api/project/${project.id}`, { method: "DELETE" });
  if (deletingCurrent) {
    state.selectedId = "";
    state.project = null;
    localStorage.removeItem("pixelToys.canvasProjectId");
    syncProjectUrl("");
    updateGenerationCanvasLinks();
    renderWorkspace();
    showProjectHome();
  }
  await loadProjects(false);
  toast("项目已删除");
}

async function saveProjectDisplayName(event) {
  event.preventDefault();
  if (!state.selectedId) return;
  const input = $("#projectDisplayNameInput");
  const displayName = input?.value.trim() || "";
  if (!displayName) return toast("请输入项目名称");
  const submit = event.currentTarget.querySelector("button[type='submit']");
  const original = submit?.textContent || "保存名称";
  try {
    if (submit) {
      submit.disabled = true;
      submit.textContent = "保存中";
    }
    const data = await api(`/api/project/${state.selectedId}/display-name`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
    setProjectState(data);
    renderWorkspace();
    await loadProjects(false);
    toast("项目名称已保存");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = original;
    }
  }
}

function renderWorkspace() {
  const data = state.project;
  const hasProject = !!data?.project;
  $("#emptyState").classList.toggle("hidden", hasProject);
  $("#workspaceViewport").classList.toggle("hidden", !hasProject);
  if (!hasProject) {
    renderStudioFlowStatus(null);
    renderStudioLogs(null);
    return;
  }

  state.hydrating = true;
  const project = data.project;
  $("#projectTitle").textContent = displayProjectTitle(project);
  const nameForm = $("#projectDisplayNameForm");
  const nameInput = $("#projectDisplayNameInput");
  if (nameForm && nameInput) {
    const needsName = projectNeedsDisplayName(project);
    nameForm.classList.toggle("hidden", !needsName);
    nameInput.value = needsName ? "" : project.title || project.seriesTitle || "";
  }
  $("#statusPills").innerHTML = `
    <span class="pill">${project.counts.parsedAssets || 0} 解析</span>
    <span class="pill">${project.counts.assets} 图片</span>
    <span class="pill">${project.counts.rawClips} 片段</span>
    <span class="pill">${project.model || "模型未记录"}</span>
  `;

  $("#scriptPath").textContent = "";
  $("#storyboardPath").textContent = "";
  $("#assetPromptsPath").textContent = "";
  $("#seedancePath").textContent = "";
  $("#configPath").textContent = "";
  $("#scriptText").value = data.contents.script || "";
  { const el = $("#assetDescriptionText"); if (el) el.value = data.contents.assetDescription || ""; }
  $("#storyboardText").value = data.contents.storyboard || "";
  $("#assetManifestText").value = data.contents.assetManifest || "";
  $("#assetPromptsText").value = data.contents.assetPrompts || "";
  $("#seedanceText").value = data.contents.seedancePrompts || "";
  renderShotsTable();
  $("#configText").value = data.contents.config || "";
  const analyzerModel = state.assetAnalyzerModel || data.runtime?.assetAnalyzerModel || "claude-opus-4-8";
  const analyzerInput = document.querySelector(`input[name='assetAnalyzerModel'][value='${CSS.escape(analyzerModel)}']`);
  if (analyzerInput) {
    analyzerInput.checked = true;
  }
  const dialogueInput = document.querySelector(`input[name='draftDialogueLanguage'][value='${CSS.escape(state.dialogueLanguage)}']`);
  if (dialogueInput) dialogueInput.checked = true;
  const assumeEnglishInput = $("#draftAssumeEnglishDialogue");
  if (assumeEnglishInput) assumeEnglishInput.checked = state.assumeEnglishDialogue === true;
  hydrateConfigInputs(data.contents.config || "");
  renderAssetStyleControls();
  renderAssetManifest(data.assetManifest || null);
  renderAssetUploadTargets(data.assetManifest || null, data.assets || []);
  renderAssets(data.assetSlots || buildAssetSlots(data.assetManifest || null, data.assets || []), data.assets || [], data.jobs || data.assetJob);
  renderAssetInspector();
  renderTeamResourcePanel();
  renderReferenceKits(data);
  renderStoryboardUploadTargets(data.storyboardSlots || [], data.storyboards || []);
  renderStoryboards(data.storyboardSlots || [], data.storyboards || [], data.jobs || data.storyboardJob);
  renderAssetJob(data.assetJob, data.runtime || {});
  renderStoryboardJob(data.storyboardJob);
  renderVideoConfigStatus(data.videoConfigStatus || {});
  renderVideoProgress(data.videoProgress || { total: 0, completed: 0, items: [] });
  renderFinalCut(data.finalCut || null);
  renderStudioFlowStatus(data);
  renderStudioLogs(data);
  hydrateWorkspaceItems();
  initWindowDragging();
  requestAnimationFrame(applyWindowLayout);
  setWorkspaceMode(state.activeWorkspaceMode, { persist: false });
  state.hydrating = false;
  renderModernStudio(data);
}

function modernStatusLabel(status = "") {
  const labels = { complete: "已完成", running: "生成中", queued: "排队中", failed: "失败", waiting: "待生成", ready: "待确认" };
  return labels[String(status || "").toLowerCase()] || "待生成";
}

function modernShotRecords(data = state.project) {
  const config = videoConfigDataFromProject();
  const configShots = Array.isArray(config?.shots) ? config.shots : [];
  const progress = Array.isArray(data?.videoProgress?.items) ? data.videoProgress.items : [];
  const byName = new Map(progress.map((item) => [item.name, item]));
  const names = [...new Set([...configShots.map((shot) => shot.name), ...progress.map((item) => item.name)].filter(Boolean))];
  return names.map((name, index) => {
    const shot = configShots.find((item) => item.name === name) || {};
    const item = byName.get(name) || {};
    return {
      name,
      number: index + 1,
      duration: shot.duration || item.duration || "-",
      status: item.status || (shot.prompt ? "waiting" : "ready"),
      progress: Number(item.progress || 0),
      prompt: shotPromptText(shot) || shot.prompt || "",
      story: shot.story || shot.plot || shot.production?.action || shot.production?.visual || "",
      dialogue: shot.dialogue || shot.production?.dialogue || "",
      voice: shot.voice || shot.production?.voice || shot.production?.os || "",
      assets: Array.isArray(shot.assets) ? shot.assets : [],
      model: videoModelLabel(videoModelForShot(shot)),
      file: item.file || item.url || "",
      storyboardRefs: item.storyboardRefs || shot.storyboardRefs || [],
    };
  });
}

function modernMediaForShot(data, shot, index, kind) {
  const list = kind === "storyboard" ? (data?.storyboards || data?.storyboardSlots || []) : (data?.videoProgress?.items || []);
  const record = list.find((item) => item?.name === shot?.name) || list[index] || {};
  const asset = record?.asset || record;
  return asset?.url || asset?.file || asset?.output?.url || "";
}

function renderModernStudio(data = state.project) {
  const root = $("#studioModernShell");
  if (!root || !data?.project) return;
  const project = data.project;
  const title = displayProjectTitle(project);
  const progress = data.videoProgress || {};
  const shots = modernShotRecords(data);
  const total = shots.length || Number(progress.total || 0);
  const completed = shots.filter((shot) => shot.status === "complete").length || Number(progress.completed || 0);
  const running = shots.filter((shot) => ["running", "queued"].includes(shot.status)).length;
  const selectedIndex = Math.max(0, Math.min(state.modernStudio.shotIndex, Math.max(0, shots.length - 1)));
  state.modernStudio.shotIndex = selectedIndex;
  const selected = shots[selectedIndex] || null;
  const ratio = videoConfigDataFromProject()?.settings?.ratio || "9:16";
  const pct = total ? Math.round((completed / total) * 100) : 0;
  $("#modernProjectTitle").textContent = title;
  $("#modernProjectMeta").textContent = `${project.episodeSlug || "当前项目"} · ${data.assets?.length || 0} 个资产 · ${total || 0} 个镜头`;
  $("#modernProjectCrumb").textContent = title;
  $("#modernEpisodeCrumb").textContent = String(project.episodeSlug || "制作台").toUpperCase();
  $("#modernEpisodeKicker").textContent = String(project.episodeSlug || "CURRENT EPISODE").toUpperCase();
  $("#modernRatioBadge").textContent = ratio;
  $("#modernEpisodeTitle").textContent = title;
  $("#modernEpisodeCopy").textContent = project.description || "从资产文档、故事板到视频 Take，当前项目的全部状态在这里集中管理。";
  $("#modernShotCount").textContent = total;
  $("#modernCompletedCount").textContent = `${pct}%`;
  $("#modernSeriesProgress").style.width = `${pct}%`;
  $("#modernSeriesProgressLabel").textContent = `${pct}%`;
  $("#modernQueueLabel").textContent = `队列 ${running}`;
  $("#modernBatchDetail").textContent = total ? `${Math.max(0, total - completed)} 个镜头待处理` : "等待生成视频配置";
  $("#modernSequenceSummary").textContent = total ? `${completed}/${total} 完成${running ? ` · ${running} 运行中` : ""}` : "暂无镜头";
  const manifest = data.assetManifest || {};
  $("#modernAssetStep").textContent = manifest.confirmed ? `${manifest.items?.length || data.assets?.length || 0} 个资产已确认` : (manifest.items?.length ? "待确认分类" : "等待解析");
  $("#modernBoardStep").textContent = data.storyboards?.length ? `${data.storyboards.length} 个故事板已生成` : "等待生成";
  $("#modernVideoStep").textContent = data.videoConfigStatus?.ready ? `${total} 个镜头已配置` : "等待配置";
  $("#modernCutStep").textContent = data.finalCut?.url ? "成片已组装" : "等待片段";
  $("#modernKitShot").textContent = selected ? `镜头 ${String(selected.number).padStart(2, "0")}` : "当前镜头";
  $("#modernKitNames").textContent = selected?.assets?.length ? selected.assets.join(" · ") : "等待故事板分配";
  $("#modernKitStatus").textContent = selected?.assets?.length ? "已引用" : "待确认";
  renderModernEpisodes(project, pct, total, completed);
  renderModernShotRail(shots, selectedIndex);
  renderModernSelectedShot(data, selected, selectedIndex);
}

function renderModernEpisodes(project, percent, total, completed) {
  const node = $("#modernEpisodeList");
  if (!node) return;
  const label = project.episodeSlug || "当前项目";
  node.innerHTML = `<button class="modern-episode-row is-active ${completed === total && total ? "is-complete" : ""}" type="button" aria-current="page"><span>01</span><div><strong>${escapeHtml(label)}</strong><small>${total ? `${completed} / ${total} 镜完成` : "等待流程启动"}</small></div><i></i></button>`;
}

function renderModernShotRail(shots, selectedIndex) {
  const node = $("#modernShotRail");
  if (!node) return;
  if (!shots.length) {
    node.innerHTML = '<div class="modern-empty-preview">生成视频配置后，镜头会出现在这里。</div>';
    return;
  }
  node.innerHTML = shots.map((shot, index) => `
    <button class="modern-shot-card ${index === selectedIndex ? "is-active" : ""} is-${escapeAttr(shot.status)}" type="button" data-modern-shot-index="${index}" role="option" aria-selected="${index === selectedIndex}">
      <span>${String(shot.number).padStart(2, "0")}</span><div><strong>${escapeHtml(shot.name)}</strong><small>${escapeHtml(modernStatusLabel(shot.status))} · ${escapeHtml(String(shot.duration))}s</small></div>
    </button>`).join("");
  node.querySelectorAll("[data-modern-shot-index]").forEach((button) => button.addEventListener("click", () => {
    state.modernStudio.shotIndex = Number(button.dataset.modernShotIndex) || 0;
    renderModernStudio(state.project);
  }));
}

function modernCopyValue(data, shot, tab) {
  if (!shot) return "";
  if (tab === "prompt") return shot.prompt || "";
  if (tab === "dialogue") return shot.dialogue || shot.voice || shot.prompt || data?.contents?.seedancePrompts || "对白 / OS 尚未生成。";
  return shot.story || shot.description || shot.prompt || data?.contents?.script || "剧情尚未生成。";
}

function renderModernSelectedShot(data, shot, index) {
  const number = shot ? String(shot.number).padStart(2, "0") : "--";
  $("#modernSelectedShotNumber").textContent = number;
  $("#modernSelectedShotTitle").textContent = shot?.name || "未选择镜头";
  $("#modernSelectedShotMeta").textContent = shot ? `${shot.duration}s · ${shot.model || "模型未配置"} · ${shot.assets.length} 个引用资产` : "先生成分镜草稿或视频配置";
  $("#modernShotAction").textContent = shot ? "打开详细编辑" : "打开详细编辑";
  const status = modernStatusLabel(shot?.status);
  $("#modernStoryStatus").textContent = shot?.prompt ? "已生成" : "待确认";
  $("#modernStillStatus").textContent = shot?.storyboardRefs?.length ? "已确认" : "待生成";
  $("#modernMotionStatus").textContent = status;
  $("#modernMotionStatus").className = `is-${shot?.status || "waiting"}`;
  $("#modernStillLineage").className = shot?.storyboardRefs?.length ? "is-done" : "";
  $("#modernMotionLineage").className = shot?.status === "complete" ? "is-done" : "";
  const activeTab = state.modernStudio.copyTab;
  $$('[data-modern-copy-tab]').forEach((button) => button.classList.toggle("is-active", button.dataset.modernCopyTab === activeTab));
  $("#modernCopyLabel").textContent = activeTab === "prompt" ? "视频提示词" : activeTab === "dialogue" ? "对白 / OS" : "剧情";
  const copy = modernCopyValue(data, shot, activeTab);
  if (document.activeElement !== $("#modernShotCopy")) $("#modernShotCopy").value = copy;
  $("#modernCopyCount").textContent = `${copy.length} 字`;
  $("#modernShotSize").textContent = shot ? "由分镜模型决定" : "-";
  $("#modernShotLens").textContent = shot ? "引用分镜提示词" : "-";
  $("#modernShotMotion").textContent = shot ? "引用分镜提示词" : "-";
  const stillUrl = modernMediaForShot(data, shot, index, "storyboard");
  const videoUrl = modernMediaForShot(data, shot, index, "video");
  const still = $("#modernStillPreview");
  still.src = stillUrl;
  still.classList.toggle("hidden", !stillUrl);
  $("#modernStillBadge").textContent = stillUrl ? "STORYBOARD" : "待生成";
  const poster = $("#modernVideoPoster");
  poster.src = videoUrl ? videoUrl : stillUrl;
  poster.classList.toggle("hidden", !videoUrl && !stillUrl);
  const video = $("#modernVideoPreview");
  video.classList.toggle("hidden", !videoUrl);
  if (videoUrl && video.src !== new URL(videoUrl, window.location.href).href) video.src = videoUrl;
  $("#modernVideoModel").textContent = shot?.model || "模型未配置";
  $("#modernVideoResolution").textContent = videoConfigDataFromProject()?.settings?.ratio || "9:16";
  $("#modernVideoProgress span").style.width = `${Math.max(0, Math.min(100, shot?.progress || 0))}%`;
  $("#modernReferenceStrip").innerHTML = `<span>实际引用资产</span><b>${escapeHtml(shot?.assets?.join(" · ") || "生成后显示")}</b>`;
}

function hydrateConfigInputs(configText) {
  try {
    const config = JSON.parse(configText);
    const settings = config.settings || {};
    const hasProductionBoardConfig = settings.storyboardWorkflowExplicit === true
      || (
        settings.promptMode === "production_board"
        && ((Array.isArray(config.storyboardPlans) && config.storyboardPlans.length > 0)
          || (Array.isArray(config.storyboardReferences) && config.storyboardReferences.length > 0))
      );
    $("#configGroup").value = config.groupName || "";
    $("#configModel").value = normalizeVideoModelName(config.modelName);
    $("#configResolution").value = settings.resolution || "480p";
    $("#configRatio").value = settings.ratio || "9:16";
    $("#configPromptMode").value = hasProductionBoardConfig ? "production_board" : "prompt";
  } catch {
    $("#configGroup").value = "";
    $("#configModel").value = "seedance-2-0-fast";
    $("#configResolution").value = "480p";
    $("#configRatio").value = "9:16";
    $("#configPromptMode").value = "prompt";
  }
}

function assetPromptItem(assetName = "") {
  return (state.project?.assetManifest?.items || []).find((item) => item.id === assetName) || null;
}

function assetPromptDraft(assetName) {
  return state.assetPromptDrafts.get(assetName) || null;
}

function effectiveAssetPrompt(assetName) {
  return String(assetPromptItem(assetName)?.textToImagePrompt || "");
}

function ensureAssetPromptDraft(assetName) {
  const existing = assetPromptDraft(assetName);
  if (existing) return existing;
  const original = effectiveAssetPrompt(assetName);
  const draft = { original, value: original, dirty: false };
  state.assetPromptDrafts.set(assetName, draft);
  return draft;
}

function selectAssetForInspector(assetName) {
  if (!assetName) return;
  state.selectedAssetId = assetName;
  state.assetInspectorOpen = true;
  state.selectedAssetIds = new Set([assetName]);
  ensureAssetPromptDraft(assetName);
  renderAssetsFromState();
  renderAssetInspector();
}

function assetPromptInspectorWorkspace() {
  // 工作流的“资产图”模块内部状态是 image；assets 则是资产库视图。
  return state.activeWorkspaceMode === "assets" || state.activeWorkspaceMode === "image";
}

function renderAssetInspector() {
  const inspector = $("#assetInspector");
  if (!inspector) return;
  const assetName = state.selectedAssetId;
  const item = assetPromptItem(assetName);
  const asset = assetForName(assetName);
  const visible = assetPromptInspectorWorkspace() && !!assetName && !!item && state.assetInspectorOpen;
  inspector.classList.toggle("hidden", !visible);
  if (!visible) return;
  const draft = ensureAssetPromptDraft(assetName);
  $("#assetInspectorName").textContent = item.label || assetName;
  $("#assetInspectorMeta").textContent = `${assetTypeLabel(item.type)} · ${asset?.assetStyleLabel || state.assetStylePreset} · ${$("#assetQuality")?.value || "1k"}`;
  const input = $("#assetInspectorPrompt");
  if (document.activeElement !== input) input.value = draft.value;
  $("#assetInspectorDraftStatus").textContent = draft.dirty ? "未保存修改" : "已保存";
  $("#assetInspectorPromptCount").textContent = `${draft.value.length} / 4000`;
  $("#assetInspectorPolicy").textContent = [item.usage, item.note, "风格锁由当前项目资产风格控制。"].filter(Boolean).join("\n");
}

async function saveAssetPrompt() {
  const assetName = state.selectedAssetId;
  const draft = assetPromptDraft(assetName);
  if (!state.selectedId || !assetName || !draft) return;
  const prompt = draft.value.trim();
  if (!prompt) return toast("提示词不能为空");
  const data = await api(`/api/project/${state.selectedId}/asset-prompt`, {
    method: "POST",
    body: JSON.stringify({ assetName, prompt }),
  });
  setProjectState(data.state);
  state.assetPromptDrafts.set(assetName, { original: prompt, value: prompt, dirty: false });
  renderAssetsFromState();
  renderAssetInspector();
  toast("提示词已保存，未启动生成");
}

async function regenerateSelectedAssetFromInspector() {
  const assetName = state.selectedAssetId;
  const draft = assetPromptDraft(assetName);
  if (!assetName || !draft) return;
  if (draft.dirty) await saveAssetPrompt();
  const confirmed = window.confirm(`重新生成“${assetName}”？这会使用额度。`);
  if (!confirmed) return;
  await regenerateAsset(assetName, { force: true });
}

function videoPromptShot(shotName = "") {
  return (videoConfigDataFromProject()?.shots || []).find((shot) => shot.name === shotName) || null;
}

function videoModelForShot(shot = {}, config = videoConfigDataFromProject()) {
  return normalizeVideoModelName(shot.modelOverride || shot.modelName || config?.modelName || "");
}

function videoPromptDraft(shotName = "") {
  return state.videoPromptDrafts.get(shotName) || null;
}

function ensureVideoPromptDraft(shotName = "") {
  const existing = videoPromptDraft(shotName);
  if (existing) return existing;
  const original = shotPromptText(videoPromptShot(shotName) || {});
  const draft = { original, value: original, dirty: false };
  state.videoPromptDrafts.set(shotName, draft);
  return draft;
}

function selectVideoForInspector(shotName = "") {
  if (!videoPromptShot(shotName)) return;
  state.selectedVideoShotName = shotName;
  state.videoPromptInspectorOpen = true;
  ensureVideoPromptDraft(shotName);
  renderVideoPromptInspector();
}

function renderVideoPromptInspector() {
  const inspector = $("#videoPromptInspector");
  if (!inspector) return;
  const shotName = state.selectedVideoShotName;
  const shot = videoPromptShot(shotName);
  const progressItem = (state.project?.videoProgress?.items || []).find((item) => item.name === shotName) || {};
  const visible = state.activeWorkspaceMode === "video" && state.videoPromptInspectorOpen && !!shot;
  inspector.classList.toggle("hidden", !visible);
  if (!visible) return;
  const draft = ensureVideoPromptDraft(shotName);
  const failed = progressItem.status === "failed";
  $("#videoPromptInspectorName").textContent = shotName;
  $("#videoPromptInspectorMeta").textContent = `${shot.duration || "-"}s · ${videoModelLabel(videoModelForShot(shot))}`;
  const modelInput = $("#videoPromptInspectorModel");
  modelInput.value = videoModelForShot(shot);
  modelInput.disabled = !failed;
  const input = $("#videoPromptInspectorPrompt");
  if (document.activeElement !== input) input.value = draft.value;
  $("#videoPromptInspectorDraftStatus").textContent = draft.dirty ? "未保存修改" : "已保存";
  $("#videoPromptInspectorPromptCount").textContent = `${draft.value.length} / 8000`;
  $("#videoPromptInspectorFailure").textContent = progressItem.failedReason || "仅会重试当前失败片段，已完成的片段不会被改动。";
  $("#regenerateVideoFromInspector").disabled = !failed;
}

async function saveVideoPrompt() {
  const shotName = state.selectedVideoShotName;
  const draft = videoPromptDraft(shotName);
  if (!state.selectedId || !shotName || !draft) return;
  const prompt = draft.value.trim();
  if (!prompt) return toast("提示词不能为空");
  const data = await api(`/api/project/${state.selectedId}/video-prompt`, {
    method: "POST",
    body: JSON.stringify({ shotName, prompt }),
  });
  setProjectState(data.state);
  state.videoPromptDrafts.set(shotName, { original: prompt, value: prompt, dirty: false });
  renderWorkspace();
  renderVideoPromptInspector();
  toast("视频提示词已保存，未提交生成");
}

async function saveVideoRetryModel() {
  const shotName = state.selectedVideoShotName;
  const shot = videoPromptShot(shotName);
  const input = $("#videoPromptInspectorModel");
  if (!state.selectedId || !shotName || !shot || !input) return false;
  const modelName = normalizeVideoModelName(input.value);
  if (modelName === videoModelForShot(shot)) return false;
  const data = await api(`/api/project/${state.selectedId}/video-model`, {
    method: "POST",
    body: JSON.stringify({ shotName, modelName }),
  });
  setProjectState(data.state);
  renderWorkspace();
  renderVideoPromptInspector();
  return true;
}

async function regenerateSelectedVideoFromInspector() {
  const shotName = state.selectedVideoShotName;
  const draft = videoPromptDraft(shotName);
  if (!shotName || !draft) return;
  const progressItem = (state.project?.videoProgress?.items || []).find((item) => item.name === shotName);
  if (progressItem?.status !== "failed") throw new Error("仅生成失败的片段可以切换模型重试");
  const confirmed = window.confirm(`重新提交“${shotName}”？这会消耗额度。`);
  if (!confirmed) return;
  if (draft.dirty) await saveVideoPrompt();
  await saveVideoRetryModel();
  await generateVideoSegment(shotName, { forceRegenerate: true });
}

function referenceOptionsHtml(assets, currentName) {
  return assets
    .filter((asset) => asset.assetName !== currentName)
    .map((asset) => `<option value="${escapeAttr(asset.assetName)}">${escapeHtml(asset.assetName)}</option>`)
    .join("");
}

function referenceChipsHtml(references) {
  if (!references?.length) return `<span class="muted">未选择参考图</span>`;
  return references.map((name) => `<span class="ref-chip">@${escapeHtml(name)}</span>`).join("");
}

function mergeSelectedReference(select, references = []) {
  const selected = select?.value || "";
  return [...new Set([...(references || []), selected].filter(Boolean))];
}

function assetTypeLabel(type) {
  const map = {
    Character: "人物",
    Scene: "场景",
    Prop: "道具",
    Insert: "插入",
    Storyboard: "Production Board",
    character: "人物",
    scene: "场景",
    prop: "道具",
    insert: "插入",
    storyboard: "Production Board",
  };
  return map[type] || type || "资产";
}

function normalizeAssetStylePreset(value) {
  const aliases = {
    three_d: "cg_3d",
    photoreal_3d: "cg_3d",
    american_retro: "retro_american_cel",
    american_bold_line: "american_bold_toon",
    美式粗线条: "american_bold_toon",
    cel: "modern_anime_cel",
    pixar_like: "pixar_3d",
  };
  const key = aliases[value] || value;
  return ASSET_STYLE_PRESETS[key] ? key : "photoreal";
}

function assetStyleState() {
  const preset = normalizeAssetStylePreset(state.assetStylePreset);
  const custom = String(state.assetStyleCustom || "").trim();
  return {
    preset,
    custom,
    label: ASSET_STYLE_PRESETS[preset].label,
    cue: ASSET_STYLE_PRESETS[preset].cue,
  };
}

function assetStylePayload() {
  const style = assetStyleState();
  return {
    assetStylePreset: style.preset,
    assetStyleCustom: style.custom,
    assetStyleReferenceEnabled: $("#assetStyleReferenceEnabled")?.checked !== false,
  };
}

function assetForName(assetName = "") {
  const clean = String(assetName || "");
  return (state.project?.assets || []).find((asset) => asset.assetName === clean || asset.name === clean) || null;
}

function boundStyleForAsset(asset = null) {
  const preset = normalizeAssetStylePreset(asset?.assetStylePreset || "");
  if (!asset?.assetStylePreset && !asset?.assetStyleLabel) return null;
  return {
    preset,
    custom: "",
  };
}

function applyAssetBoundStyle(asset = null) {
  const bound = boundStyleForAsset(asset);
  if (!bound) return false;
  state.assetStylePreset = bound.preset;
  state.assetStyleCustom = bound.custom;
  localStorage.setItem("pixelToys.assetStylePreset", bound.preset);
  localStorage.setItem("pixelToys.assetStyleCustom", bound.custom);
  renderAssetStyleControls();
  return true;
}

function stylePayloadForAsset(assetName = "") {
  const bound = boundStyleForAsset(assetForName(assetName));
  if (!bound) return assetStylePayload();
  return {
    assetStylePreset: bound.preset,
    assetStyleCustom: bound.custom,
    assetStyleReferenceEnabled: $("#assetStyleReferenceEnabled")?.checked !== false,
  };
}

function renderAssetStyleControls() {
  const presetInput = $("#assetStylePreset");
  const customInput = $("#assetStyleCustom");
  const preview = $("#assetStylePreview");
  const refName = $("#assetStyleReferenceName");
  const refToggle = $("#assetStyleReferenceEnabled");
  const removeButton = $("#assetStyleReferenceRemove");
  if (!presetInput || !customInput || !preview) return;
  const style = assetStyleState();
  const styleReference = state.project?.assetStyleReference || {};
  const styleReferenceAsset = styleReference.asset || null;
  presetInput.value = style.preset;
  customInput.value = style.custom;
  if (refName) refName.textContent = styleReferenceAsset ? styleReference.originalFilename || styleReferenceAsset.name || "已上传风格参考" : "未上传";
  if (refToggle) {
    refToggle.checked = styleReference.enabled !== false && !!styleReferenceAsset;
    refToggle.disabled = !styleReferenceAsset;
  }
  if (removeButton) removeButton.disabled = !styleReferenceAsset;
  preview.innerHTML = `
    <span class="style-chip">${escapeHtml(style.label)}</span>
    <span>${escapeHtml(style.cue)}</span>
    ${style.custom ? `<strong>${escapeHtml(style.custom)}</strong>` : ""}
    ${styleReferenceAsset ? `<span class="style-chip ${styleReference.enabled ? "ok" : "muted"}">风格参考图：${styleReference.enabled ? "启用" : "停用"}</span>` : ""}
    ${styleReferenceAsset ? `<span>只借线条、色彩、渲染质感和光影，不借人物/场景内容。</span>` : ""}
  `;
}

function persistAssetStyleFromControls() {
  const preset = normalizeAssetStylePreset($("#assetStylePreset")?.value || state.assetStylePreset);
  const custom = String($("#assetStyleCustom")?.value || "").trim();
  state.assetStylePreset = preset;
  state.assetStyleCustom = custom;
  localStorage.setItem("pixelToys.assetStylePreset", preset);
  localStorage.setItem("pixelToys.assetStyleCustom", custom);
  renderAssetStyleControls();
}

function renderAssetUploadTargets(manifest, assets) {
  const form = $("#assetUploadForm");
  const select = $("#assetUploadTarget");
  const button = $("#assetUploadButton");
  if (!form || !select || !button) return;
  const previousTarget = state.assetUploadTargetId || select.value || "";
  const items = manifest?.items || [];
  const existing = new Set((assets || []).map((asset) => asset.assetName));
  select.innerHTML = "";
  if (!items.length) {
    select.innerHTML = `<option value="">暂无可绑定的解析资产</option>`;
    state.assetUploadTargetId = "";
    renderAssetUploadMode();
    return;
  }
  const ordered = [...items].sort((a, b) => {
    const aExists = existing.has(a.id);
    const bExists = existing.has(b.id);
    if (aExists !== bExists) return Number(aExists) - Number(bExists);
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  select.innerHTML = ordered
    .map((item) => {
      const exists = existing.has(item.id);
      const label = `${exists ? "已生成，可替换" : "待上传"} · ${assetTypeLabel(item.type)} · ${item.label || item.id}`;
      return `<option value="${escapeAttr(item.id)}" data-exists="${exists ? "1" : "0"}" data-label="${escapeAttr(item.label || item.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  const firstMissing = ordered.find((item) => !existing.has(item.id));
  const targetStillExists = previousTarget && ordered.some((item) => item.id === previousTarget);
  select.value = targetStillExists ? previousTarget : firstMissing?.id || ordered[0]?.id || "";
  state.assetUploadTargetId = select.value || "";
  renderAssetUploadMode();
}

function assetUploadMode() {
  return $("#assetUploadMode")?.value === "bind" ? "bind" : "local";
}

function renderAssetUploadMode() {
  const mode = assetUploadMode();
  const bindMode = mode === "bind";
  $("#assetUploadLocalNameField")?.classList.toggle("hidden", bindMode);
  $("#assetUploadLocalTypeField")?.classList.toggle("hidden", bindMode);
  $("#assetUploadTargetField")?.classList.toggle("hidden", !bindMode);
  updateAssetUploadHint();
}

function updateAssetUploadHint() {
  const select = $("#assetUploadTarget");
  const button = $("#assetUploadButton");
  const hint = $("#assetUploadHint");
  if (!select || !button || !hint) return;
  const mode = assetUploadMode();
  const file = $("#assetUploadFile")?.files?.[0] || null;
  if (mode === "local") {
    const label = $("#assetUploadLabel")?.value.trim() || "";
    button.textContent = "添加本地资产";
    button.disabled = !label;
    hint.textContent = label
      ? `将以“${label}”创建项目资产并保存上传图片，可直接作为视频参考图使用。`
      : "填写资产名称后，上传图片会作为项目资产保存并可直接被视频引用。";
    return;
  }
  const assetId = select.value || "";
  const option = select.selectedOptions?.[0];
  const exists = option?.dataset?.exists === "1";
  button.textContent = exists ? "替换上传" : "绑定上传";
  button.disabled = !assetId;
  if (!assetId) {
    hint.textContent = "上传后使用资产解析名称保存。";
    return;
  }
  const original = file?.name ? `，忽略原文件名：${file.name}` : "";
  hint.textContent = `${exists ? "替换" : "绑定"}目标：${assetId}。保存时使用资产解析名称，扩展名按图片内容自动识别${original}`;
}

function renderStoryboardUploadTargets(slots, storyboards) {
  const form = $("#storyboardUploadForm");
  const select = $("#storyboardUploadTarget");
  const button = $("#storyboardUploadButton");
  if (!form || !select || !button) return;
  const items = slots || [];
  const existing = new Set((storyboards || []).map((asset) => asset.assetName));
  form.classList.toggle("hidden", !items.length);
  select.innerHTML = "";
  if (!items.length) {
    select.innerHTML = `<option value="">暂无 Production Board 槽位</option>`;
    button.disabled = true;
    return;
  }
  const ordered = [...items].sort((a, b) => {
    const aExists = existing.has(a.id);
    const bExists = existing.has(b.id);
    if (aExists !== bExists) return Number(aExists) - Number(bExists);
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  select.innerHTML = ordered
    .map((item) => {
      const exists = existing.has(item.id);
      const label = `${exists ? "已存在" : "待上传"} · ${item.label || item.id}`;
      return `<option value="${escapeAttr(item.id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  const firstMissing = ordered.find((item) => !existing.has(item.id));
  select.value = firstMissing?.id || ordered[0]?.id || "";
  button.disabled = !select.value;
}

function assetManifestRenderSignature(manifest, { extracting = false } = {}) {
  return JSON.stringify({
    extracting,
    confirmed: !!manifest?.confirmed,
    coverage: manifest?.coverage
      ? [manifest.coverage.checkedAt || "", manifest.coverage.ok ? 1 : 0, ...(manifest.coverage.added || []).map((item) => item.id || item.label || "")]
      : [],
    flagged: (manifest?.audit?.flagged || []).map((item) => [item.id || "", item.label || "", item.suspectType || item.to || ""]),
    items: (manifest?.items || []).map((item) => [item.id || "", item.label || "", item.type || "", item.generate === false ? 0 : 1]),
    manualType: state.manualAssetType || "",
  });
}

function renderAssetManifest(manifest) {
  const overview = $("#assetManifestOverview");
  const status = $("#assetManifestStatus");
  const confirmBtn = $("#confirmAssetManifestBtn");
  const draftBtn = $("#draftBtn");
  const generateAssetBtn = document.querySelector("[data-job='assets']");
  const items = manifest?.items || [];
  const confirmed = !!manifest?.confirmed;
  const extracting = isAssetExtracting();
  const counts = manifest?.counts || {};
  const characters = items.filter((item) => item.type === "Character");
  const scenes = items.filter((item) => item.type === "Scene");
  const props = items.filter((item) => item.type === "Prop" || item.type === "Insert");
  const coverageAdded = Array.isArray(manifest?.coverage?.added) ? manifest.coverage.added : [];
  const coverageLabel = manifest?.coverage?.checkedAt
    ? manifest.coverage.ok
      ? coverageAdded.length
        ? `覆盖校验补充 ${coverageAdded.length} 个`
        : "覆盖校验通过"
      : "覆盖校验未完成"
    : "待覆盖校验";

  if (draftBtn) {
    draftBtn.disabled = extracting;
    draftBtn.textContent = extracting ? "解析中..." : "资产提取";
  }
  if (confirmBtn) confirmBtn.disabled = extracting || !items.length || confirmed;
  if (generateAssetBtn) {
    // 提取后即可生成：只要解析出资产(items)就点亮，不再要求单独"确认"（确认门槛已按需求去掉，提取时自动确认）。
    const canGenerate = !!items.length;
    generateAssetBtn.disabled = extracting || !canGenerate;
    generateAssetBtn.title = extracting ? "资产解析运行中" : canGenerate ? "生成资产图" : "请先提取资产";
  }
  const signature = assetManifestRenderSignature(manifest, { extracting });
  if (overview.dataset.manifestSig === signature && overview.childElementCount > 0) return;
  overview.dataset.manifestSig = signature;

  const manifestItemHtml = (item) => {
    const shouldGenerate = item.generate !== false;
    const label = item.label || item.id;
    return `
      <span
        class="manifest-name ${shouldGenerate ? "" : "is-skipped"}"
        data-manifest-asset-id="${escapeAttr(item.id)}"
        data-manifest-asset-type="${escapeAttr(item.type)}"
        draggable="true"
      >
        <span class="manifest-name-label">${escapeHtml(label)}</span>
        <button
          class="manifest-generate-toggle ${shouldGenerate ? "is-on" : "is-off"}"
          type="button"
          data-manifest-toggle-generate="${escapeAttr(item.id)}"
          aria-pressed="${shouldGenerate ? "true" : "false"}"
          title="${shouldGenerate ? "点击设为不生成" : "点击设为生成"}"
        >${shouldGenerate ? "生成" : "不生成"}</button>
      </span>
    `;
  };

  const groupHtml = (title, list, emptyText, type) => `
    <section class="manifest-group">
      <h3>
        <span>${title}</span>
        <button class="manifest-add-btn" type="button" data-manual-asset-type="${escapeAttr(type)}" aria-label="添加${escapeAttr(title)}" title="添加${escapeAttr(title)}"></button>
      </h3>
      <div class="manifest-name-list" data-manifest-drop-type="${escapeAttr(type)}">
        ${
          list.length
            ? list.map(manifestItemHtml).join("")
            : `<span class="manifest-empty">${emptyText}</span>`
        }
      </div>
    </section>
  `;

  if (extracting) {
    status.textContent = "资产解析运行中，正在读取剧本并提取人物、场景、道具。";
    overview.innerHTML = `
      <div class="asset-manifest-running">
        <span class="running-dot"></span>
        <div>
          <strong>正在解析资产</strong>
          <p>模型正在从剧本里识别人物、场景、道具和插入镜头，完成后会自动刷新结果。</p>
        </div>
      </div>
      <div class="asset-manifest-grid">
        ${groupHtml("人物", characters, "等待解析人物", "Character")}
        ${groupHtml("场景", scenes, "等待解析场景", "Scene")}
        ${groupHtml("道具/插入", props, "等待解析道具", "Prop")}
      </div>
    `;
    return;
  }

  if (!items.length) {
    status.textContent = "先提取剧本中的人物和场景。";
    overview.innerHTML = `
      <div class="asset-manifest-summary">
        <span class="pill">暂无资产解析</span>
      </div>
      <div class="asset-manifest-grid">
        ${groupHtml("人物", [], "未提取到人物", "Character")}
        ${groupHtml("场景", [], "未提取到场景", "Scene")}
        ${groupHtml("道具/插入", [], "未提取到道具", "Prop")}
      </div>
      ${manualAssetFormHtml()}
    `;
    bindManualAssetControls(overview, manifest);
    return;
  }

  status.textContent = confirmed
    ? `已确认 / 人物 ${characters.length} / 场景 ${scenes.length} / ${coverageLabel}`
    : `待确认 / 人物 ${characters.length} / 场景 ${scenes.length} / ${coverageLabel}`;
  overview.innerHTML = `
    <div class="asset-manifest-summary">
      <span class="pill ${confirmed ? "ok" : "warn"}">${confirmed ? "已确认" : "待确认"}</span>
      <span class="pill">人物 ${characters.length || counts.characters || 0}</span>
      <span class="pill">场景 ${scenes.length || counts.scenes || 0}</span>
      <span class="pill ${manifest?.coverage?.ok ? "ok" : "warn"}">${escapeHtml(coverageLabel)}</span>
    </div>
    ${
      coverageAdded.length
        ? `<div class="asset-coverage-added">
            <strong>自动补漏</strong>
            ${coverageAdded.map((item) => `<span class="manifest-name">${escapeHtml(item.label || item.id)}</span>`).join("")}
          </div>`
        : ""
    }
    <div class="asset-manifest-grid">
      ${groupHtml("人物", characters, "未提取到人物", "Character")}
      ${groupHtml("场景", scenes, "未提取到场景", "Scene")}
      ${groupHtml("道具/插入", props, "未提取到道具", "Prop")}
    </div>
    ${manualAssetFormHtml()}
  `;
  bindManualAssetControls(overview, manifest);
}

function bindManualAssetControls(root, manifest) {
  root.querySelectorAll("[data-manifest-asset-id]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      const assetId = card.dataset.manifestAssetId;
      if (!assetId || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", assetId);
      event.dataTransfer.setData("application/x-pixel-toys-asset-type", card.dataset.manifestAssetType || "");
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
  });
  root.querySelectorAll("[data-manifest-drop-type]").forEach((dropzone) => {
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      dropzone.classList.add("is-dragover");
    });
    dropzone.addEventListener("dragleave", (event) => {
      if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("is-dragover");
    });
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
      if (!event.dataTransfer) return;
      const assetId = event.dataTransfer.getData("text/plain");
      const sourceCard = [...root.querySelectorAll("[data-manifest-asset-id]")].find(
        (card) => card.dataset.manifestAssetId === assetId,
      );
      const sourceType =
        event.dataTransfer.getData("application/x-pixel-toys-asset-type") || sourceCard?.dataset.manifestAssetType;
      const targetType = dropzone.dataset.manifestDropType;
      if (!assetId || !targetType || sourceType === targetType) return;
      reclassifyAsset(assetId, targetType).catch((error) => toast(error.message));
    });
  });
  root.querySelectorAll("[data-manifest-toggle-generate]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleManifestAssetGeneration(button.dataset.manifestToggleGenerate).catch((error) => toast(error.message));
    });
  });
  root.querySelectorAll("[data-manual-asset-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.manualAssetType = button.dataset.manualAssetType || "Prop";
      state.shouldFocusManualAsset = true;
      renderAssetManifest(state.project?.assetManifest || manifest);
    });
  });
  const cancel = root.querySelector("#manualAssetCancel");
  if (cancel) {
    cancel.addEventListener("click", () => {
      state.manualAssetType = "";
      state.manualAssetDraft = { label: "", description: "", evidence: "", quality: "1k", references: [] };
      renderAssetManifest(state.project?.assetManifest || manifest);
    });
  }
  const manualForm = root.querySelector("#manualAssetForm");
  if (manualForm) {
    manualForm.addEventListener("input", persistManualAssetDraft);
    manualForm.addEventListener("change", persistManualAssetDraft);
    manualForm.addEventListener("submit", (event) => addManualAsset(event).catch((error) => toast(error.message)));
    manualForm.elements.referenceSelect?.addEventListener("change", () => {
      persistManualAssetDraft({ currentTarget: manualForm });
      const draft = setManualAssetDraft({
        references: mergeSelectedReference(manualForm.elements.referenceSelect, state.manualAssetDraft.references || []),
      });
      refreshManualReferencePreview(manualForm, draft.references);
      manualForm.elements.referenceSelect.value = "";
    });
    if (state.shouldFocusManualAsset) {
      state.shouldFocusManualAsset = false;
      requestAnimationFrame(() => manualForm.elements.label?.focus());
    }
  }
}

function manualAssetFormHtml() {
  if (!state.manualAssetType) return "";
  const type = state.manualAssetType;
  const title = type === "Character" ? "添加人物" : type === "Scene" ? "添加场景" : "添加道具/插入";
  const draft = state.manualAssetDraft || {};
  const quality = draft.quality || "1k";
  const references = Array.isArray(draft.references) ? draft.references : [];
  const referenceAssets = state.project?.assets || [];
  return `
    <form id="manualAssetForm" class="manual-asset-form">
      <div class="manual-asset-form-head">
        <strong>${escapeHtml(title)}</strong>
        <button id="manualAssetCancel" class="ghost tiny" type="button">取消</button>
      </div>
      <input name="label" type="text" placeholder="资产名称，例如 Mercy Cain / 西部酒馆内景 / 蓝色能量刃" autocomplete="off" value="${escapeAttr(draft.label || "")}" />
      <textarea name="description" placeholder="描述它在剧本中的样子、服装/空间/材质/状态。系统会把这段描述和剧本内容一起生成英文生图提示词，并自动绑定相关分镜。">${escapeHtml(draft.description || "")}</textarea>
      <textarea name="evidence" placeholder="关联剧本内容，可粘贴一句原文或剧情依据。留空时系统会尝试从剧本中自动查找。">${escapeHtml(draft.evidence || "")}</textarea>
      <label class="asset-reference-picker manual-reference-picker">
        <span>参考图</span>
        <select name="referenceSelect">
          <option value="">选择已有资产图</option>
          ${referenceOptionsHtml(referenceAssets, "")}
        </select>
      </label>
      <div class="asset-reference-list manual-reference-list">${referenceChipsHtml(references)}</div>
      <label class="quality-pill manual-quality">
        <span>画质</span>
        <select name="quality">
          <option value="1k" ${quality === "1k" ? "selected" : ""}>1K</option>
          <option value="2k" ${quality === "2k" ? "selected" : ""}>2K</option>
          <option value="4k" ${quality === "4k" ? "selected" : ""}>4K</option>
        </select>
      </label>
      <button class="primary" type="submit">生成并绑定</button>
    </form>
  `;
}

function persistManualAssetDraft(event) {
  const form = event.currentTarget;
  const previous = state.manualAssetDraft || {};
  state.manualAssetDraft = {
    label: form.elements.label?.value || "",
    description: form.elements.description?.value || "",
    evidence: form.elements.evidence?.value || "",
    quality: form.elements.quality?.value || "1k",
    references: Array.isArray(previous.references) ? previous.references : [],
  };
}

function setManualAssetDraft(patch) {
  const previous = state.manualAssetDraft || {};
  const draft = { ...previous, ...patch };
  draft.references = [...new Set(draft.references || [])].filter(Boolean);
  state.manualAssetDraft = draft;
  return draft;
}

function refreshManualReferencePreview(form, references) {
  const node = form?.querySelector(".manual-reference-list");
  if (node) node.innerHTML = referenceChipsHtml(references);
}

function addReferenceToManualAsset(referenceName) {
  if (!state.manualAssetType) return false;
  const draft = setManualAssetDraft({
    references: [...(state.manualAssetDraft.references || []), referenceName],
  });
  const form = $("#manualAssetForm");
  if (form) refreshManualReferencePreview(form, draft.references);
  toast(`已加入新增资产参考图：${referenceName}`);
  return true;
}

async function addManualAsset(event) {
  event.preventDefault();
  if (!state.selectedId) return;
  const form = event.currentTarget;
  const label = form.elements.label?.value?.trim() || "";
  const description = form.elements.description?.value?.trim() || "";
  const evidence = form.elements.evidence?.value?.trim() || "";
  const quality = form.elements.quality?.value || "1k";
  const referenceAssetNames = [...new Set(mergeSelectedReference(form.elements.referenceSelect, state.manualAssetDraft.references || []))].filter(Boolean);
  if (!label) return toast("请填写资产名称");
  if (!description) return toast("请填写资产描述");
  const assetAnalyzerModel = document.querySelector("input[name='assetAnalyzerModel']:checked")?.value || state.assetAnalyzerModel || "claude-opus-4-8";
  state.assetAnalyzerModel = normalizeAssetAnalyzerModel(assetAnalyzerModel);
  localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);
  await saveFileQuiet("script");
  await saveFileQuiet("seedancePrompts");
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.disabled = true;
  toast("正在添加资产并启动生成");
  try {
    const data = await api(`/api/project/${state.selectedId}/asset-manual`, {
      method: "POST",
      body: JSON.stringify({
        type: state.manualAssetType || "Prop",
        label,
        description,
        evidence,
        quality,
        referenceAssetNames,
        assetAnalyzerModel: state.assetAnalyzerModel,
        generate: true,
        ...assetStylePayload(),
      }),
    });
    if (data.job?.id) state.activeJobId = data.job.id;
    setProjectState(data.state);
    state.manualAssetType = "";
    state.manualAssetDraft = { label: "", description: "", evidence: "", quality: "1k", references: [] };
    renderWorkspace();
    const bound = data.result?.binding?.boundShots || [];
    toast(bound.length ? `已添加并绑定 ${bound.length} 个片段，资产图生成已启动` : "已添加资产，资产图生成已启动");
  } finally {
    if (submit) submit.disabled = false;
  }
}

function buildAssetSlots(manifest, assets) {
  const byName = new Map((assets || []).map((asset) => [asset.assetName, asset]));
  return (manifest?.items || []).map((item) => {
    const asset = byName.get(item.id) || null;
    const skipped = item.generate === false && !asset;
    return {
      id: item.id,
      type: item.type,
      label: item.label,
      usage: item.usage || "",
      generate: item.generate !== false,
      skipped: item.generate === false,
      status: asset ? "ready" : skipped ? "skipped" : "missing",
      statusLabel: asset ? "已就绪" : skipped ? "不生成" : "缺失",
      generated: !!asset,
      missing: !asset && !skipped,
      failed: false,
      asset,
    };
  });
}

function slotsFromScannedAssets(assets = []) {
  return (assets || []).map((asset) => ({
    id: asset.assetName,
    type: asset.manifestType || asset.type || "Asset",
    label: asset.assetName,
    usage: asset.usage || "",
    status: "ready",
    statusLabel: "已就绪",
    generated: true,
    missing: false,
    failed: false,
    asset,
  }));
}

function mergeSlotsWithScannedAssets(slots = [], assets = []) {
  const merged = [...(slots || [])];
  const seen = new Set(merged.map((slot) => slot.id || slot.asset?.assetName).filter(Boolean));
  for (const slot of slotsFromScannedAssets(assets)) {
    if (seen.has(slot.id)) continue;
    merged.push(slot);
    seen.add(slot.id);
  }
  return merged;
}

function assetSlotStatusLabel(slot) {
  if (slot?.isGenerating) return "生成中";
  if (slot.statusLabel) return slot.statusLabel;
  if (slot.status === "ready") return "已就绪";
  if (slot.status === "skipped" || slot.skipped) return "不生成";
  if (slot.status === "failed") return "失败";
  return "缺失";
}

function assetReuseLabel(slot, asset) {
  if (!slot?.reused && !asset?.reused) return "";
  const source = asset?.sourceEpisodeSlug || slot?.sourceEpisodeSlug || "";
  return source ? `复用自 ${source}` : "复用已有资产";
}

function assetSlotStatusClass(slot) {
  if (slot?.isGenerating) return "active";
  if (slot.status === "ready") return "ok";
  if (slot.status === "skipped" || slot.skipped) return "skip";
  if (slot.status === "failed") return "warn";
  return "missing";
}

function assetNamesForRange(range, slots = []) {
  const slotList = Array.isArray(slots) ? slots : [];
  const allowed = (slot) => !slot.skipped && slot.status !== "skipped";
  const byId = new Map(slotList.map((slot) => [slot.id, slot]));
  if (range === "selected") {
    return [...state.selectedAssetIds].filter((name) => allowed(byId.get(name) || {}));
  }
  if (range === "failed") return slotList.filter((slot) => allowed(slot) && slot.failed).map((slot) => slot.id).filter(Boolean);
  if (range === "all") return slotList.filter(allowed).map((slot) => slot.id).filter(Boolean);
  return slotList.filter((slot) => allowed(slot) && (slot.missing || slot.status === "failed")).map((slot) => slot.id).filter(Boolean);
}

function storyboardSlotRangeLabel(slot) {
  const start = Number.isFinite(Number(slot.startSecond)) ? Number(slot.startSecond) : 0;
  const fallbackEnd = start + (Number(slot.duration) || 15);
  const end = Number.isFinite(Number(slot.endSecond)) ? Number(slot.endSecond) : fallbackEnd;
  return `${start}-${end}s`;
}

function normalizeJobTargetName(value) {
  return String(value || "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase();
}

function assetNameFromJobCommand(command = "") {
  const match = String(command || "").match(/--asset-name\s+(.+?)(?:\s+--|$)/);
  return (match?.[1] || "").trim();
}

function liveTargetsForJob(job) {
  const targets = [];
  if (job?.status !== "running") return targets;
  const parsed = parseAssetJobLog(job.logs || "");
  const current = parsed.current || "";
  if (current) targets.push(current);
  const commandTarget = assetNameFromJobCommand(job.command);
  if (commandTarget) targets.push(commandTarget);
  const targetNames = Array.isArray(job.targetAssetNames) ? job.targetAssetNames.filter(Boolean) : [];
  if (targetNames.length) targets.push(...targetNames);
  return targets;
}

function activeJobTargets(jobs) {
  const targets = new Set();
  for (const [name, info] of [...state.optimisticAssetJobs.entries()]) {
    if (!info?.startedAt || Date.now() - info.startedAt < 1000 * 20) {
      const normalized = normalizeJobTargetName(name);
      if (normalized) targets.add(normalized);
    } else {
      state.optimisticAssetJobs.delete(name);
    }
  }
  const jobList = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
  for (const job of jobList) {
    for (const name of liveTargetsForJob(job)) {
      const target = normalizeJobTargetName(name);
      if (target) targets.add(target);
    }
  }
  return targets;
}

function reconcileOptimisticAssetJobs(data) {
  const runningTargets = new Set();
  for (const job of [data?.assetJob, data?.storyboardJob, ...(data?.jobs || [])]) {
    for (const name of liveTargetsForJob(job)) {
      const normalized = normalizeJobTargetName(name);
      if (normalized) runningTargets.add(normalized);
    }
  }
  for (const name of [...state.optimisticAssetJobs.keys()]) {
    if (!runningTargets.has(normalizeJobTargetName(name))) state.optimisticAssetJobs.delete(name);
  }
}

function isActiveJobTarget(targets, ...names) {
  if (!targets?.size) return false;
  return names.some((name) => {
    const normalized = normalizeJobTargetName(name);
    return normalized && targets.has(normalized);
  });
}

function renderNodeBeacon(active, label = "生成中") {
  return active ? `<span class="node-beacon" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"></span>` : "";
}

function toggleAssetSelection(assetName) {
  if (!assetName) return;
  if (state.selectedAssetIds.has(assetName)) state.selectedAssetIds.delete(assetName);
  else state.selectedAssetIds.add(assetName);
  renderWorkspace();
}

// Finds the nearest scrollable ancestor so we can preserve scroll position
// across a gallery rebuild (otherwise innerHTML teardown resets it to top).
function getScrollableAncestor(node) {
  let el = node?.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

// Signature of everything that affects the rendered asset DOM. When it is
// unchanged between polls (the common case), we skip the rebuild entirely so
// scroll position and in-flight <img> loads are preserved. Deliberately
// excludes edit-draft text so typing never forces a rebuild / focus loss.
// Keyed per-card reconciliation. Reuses existing DOM nodes when a card's
// signature is unchanged (leaving its already-loaded <img>/<video> alive), so a
// single-card change never tears down and re-fetches the whole grid.
// specs: [{ key, sig }] in target order. build(spec) must return an element.
function reconcileKeyedCards(container, specs, build) {
  const existing = new Map();
  for (const child of Array.from(container.children)) {
    const key = child.dataset.cardKey;
    if (key !== undefined) existing.set(key, child);
  }
  const ordered = [];
  for (const spec of specs) {
    const key = String(spec.key);
    const sig = String(spec.sig);
    const prev = existing.get(key);
    if (prev && prev.dataset.cardSig === sig) {
      existing.delete(key);
      ordered.push(prev);
      continue;
    }
    const card = build(spec);
    card.dataset.cardKey = key;
    card.dataset.cardSig = sig;
    if (prev) existing.delete(key);
    ordered.push(card);
  }
  // Remove cards whose keys disappeared.
  for (const stale of existing.values()) stale.remove();
  // Place the ordered nodes; only nodes out of position trigger a DOM move.
  for (let i = 0; i < ordered.length; i++) {
    const node = ordered[i];
    if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
  }
  // Drop any trailing extras (e.g. old placeholder markup).
  while (container.children.length > ordered.length) container.lastElementChild.remove();
}

function assetRenderSignature(slotList, activeTargets) {
  const sel = [...state.selectedAssetIds].sort().join(",");
  const parts = slotList.map((slot) => {
    const asset = slot.asset;
    const gen = isActiveJobTarget(activeTargets, slot.id || asset?.assetName, asset?.assetName, asset?.name) ? 1 : 0;
    return [
      slot.id || asset?.assetName || "",
      slot.status || "",
      slot.skipped || slot.status === "skipped" ? 1 : 0,
      slot.reused || asset?.reused ? 1 : 0,
      slot.staleAsset ? 1 : 0,
      slot.failed ? 1 : 0,
      asset?.url || "",
      asset?.assetName || "",
      gen,
    ].join("|");
  });
  return `${state.project?.loading ? "L" : ""}#${sel}#${parts.join(";")}`;
}

function projectHasAssetSurface(slots = [], assets = []) {
  return !!((slots || []).length || (assets || []).length);
}

function assetGalleryHidden(hidden) {
  const node = $("#assetGallery");
  if (!node) return;
  node.classList.toggle("hidden", hidden);
  if (hidden) {
    node.dataset.renderSig = "";
    node.innerHTML = "";
  }
}

function assetJobStatusHidden(hidden) {
  const node = $("#assetJobStatus");
  if (!node) return;
  node.classList.toggle("hidden", hidden);
  if (hidden) node.innerHTML = "";
}

const REFERENCE_KIT_ROLE_LABELS = {
  character: "角色",
  scene: "场景",
  props: "道具",
  style: "风格",
  storyboard: "故事板",
};

function referenceKitRoleForAsset(asset = {}) {
  const text = `${asset.manifestType || ""} ${asset.type || ""} ${asset.assetName || asset.name || ""}`.toLowerCase();
  if (/storyboard|production board|故事板|分镜|^sb\d/.test(text)) return "storyboard";
  if (/character|人物|角色|^c\d/.test(text)) return "character";
  if (/scene|场景|^s\d/.test(text)) return "scene";
  if (/prop|道具|^p\d/.test(text)) return "props";
  return "";
}

function referenceKitCatalog(data = {}) {
  const catalog = {
    character: [],
    scene: [],
    props: [],
    style: [],
    storyboard: [],
  };
  const assets = [...(data.assets || []), ...(data.storyboards || [])];
  for (const asset of assets) {
    const id = String(asset.assetName || asset.name || "").trim();
    const role = referenceKitRoleForAsset(asset);
    if (!id || !role || catalog[role].some((item) => item.id === id)) continue;
    catalog[role].push({ id, label: asset.label || asset.assetLabel || asset.assetName || asset.name || id });
  }
  const styleReference = data.assetStyleReference;
  if (styleReference?.url || styleReference?.assetName) {
    const id = String(styleReference.assetName || "asset_style_reference").trim();
    catalog.style.push({ id, label: styleReference.label || "当前风格参考" });
  }
  return catalog;
}

function referenceKitDraftFromKit(kit = {}, copy = false) {
  return {
    id: copy ? "" : kit.id || "",
    name: copy ? `${kit.name || "Reference Kit"} 副本` : kit.name || "",
    roles: Object.fromEntries(Object.keys(REFERENCE_KIT_ROLE_LABELS).map((role) => [role, [...(kit.roles?.[role] || [])]])),
    policy: {
      identityLock: kit.policy?.identityLock !== false,
      sceneLock: kit.policy?.sceneLock !== false,
      wardrobeLock: kit.policy?.wardrobeLock !== false,
      styleLock: kit.policy?.styleLock !== false,
    },
  };
}

function renderReferenceKits(data = state.project) {
  const panel = $("#referenceKitPanel");
  if (!panel) return;
  const kits = Array.isArray(data?.referenceKits) ? data.referenceKits : [];
  const shots = Array.isArray(data?.referenceKitShots) ? data.referenceKitShots : [];
  const catalog = referenceKitCatalog(data || {});
  const editing = !!state.referenceKitDraft;
  const draft = state.referenceKitDraft || referenceKitDraftFromKit({}, false);
  const form = panel.querySelector("#referenceKitForm");
  if (form) {
    form.classList.toggle("hidden", !editing);
    if (editing) {
      form.querySelector("[name='kitName']").value = draft.name || "";
      form.querySelector("[name='kitId']").value = draft.id || "";
      for (const role of Object.keys(REFERENCE_KIT_ROLE_LABELS)) {
        const selected = new Set(draft.roles?.[role] || []);
        const options = [...(catalog[role] || [])];
        for (const selectedId of selected) {
          if (!options.some((item) => item.id === selectedId)) options.push({ id: selectedId, label: `${selectedId} · 已保存引用` });
        }
        const target = form.querySelector(`[data-reference-kit-options='${role}']`);
        target.innerHTML = options.length
          ? options.map((item) => `<label class="reference-kit-option"><input type="checkbox" data-reference-kit-role="${role}" value="${escapeAttr(item.id)}" ${selected.has(item.id) ? "checked" : ""} /><span>${escapeHtml(item.label)}</span></label>`).join("")
          : `<span class="reference-kit-empty">暂无可选${REFERENCE_KIT_ROLE_LABELS[role]}</span>`;
      }
      for (const key of ["identityLock", "sceneLock", "wardrobeLock", "styleLock"]) {
        const input = form.querySelector(`[name='${key}']`);
        if (input) input.checked = draft.policy?.[key] !== false;
      }
    }
  }
  const list = panel.querySelector("#referenceKitList");
  if (!list) return;
  if (!kits.length) {
    list.innerHTML = `<div class="reference-kit-empty-state">还没有 Reference Kit</div>`;
    return;
  }
  list.innerHTML = kits.map((kit) => {
    const boundShots = shots.filter((shot) => shot.referenceKitId === kit.id);
    const roleSummary = Object.entries(REFERENCE_KIT_ROLE_LABELS)
      .filter(([role]) => (kit.roles?.[role] || []).length)
      .map(([role, label]) => `<span>${label} ${(kit.roles?.[role] || []).length}</span>`)
      .join("");
    const shotOptions = shots.length
      ? `<select data-reference-kit-shot aria-label="选择 Shot"><option value="">选择 Shot</option>${shots.map((shot) => `<option value="${escapeAttr(shot.name)}">${escapeHtml(shot.name)}${shot.referenceKitId === kit.id ? " · 已绑定" : ""}</option>`).join("")}</select><button type="button" class="ghost small" data-reference-kit-action="bind" data-reference-kit-id="${escapeAttr(kit.id)}">绑定</button>`
      : `<span class="reference-kit-empty">生成视频配置后可绑定 Shot</span>`;
    return `<article class="reference-kit-card" data-reference-kit-id="${escapeAttr(kit.id)}">
      <div class="reference-kit-card-head"><div><strong>${escapeHtml(kit.name)}</strong><span>v${Number(kit.version || 1)}</span></div><div class="reference-kit-card-actions"><button type="button" class="icon-button" title="编辑" aria-label="编辑 ${escapeAttr(kit.name)}" data-reference-kit-action="edit" data-reference-kit-id="${escapeAttr(kit.id)}">✎</button><button type="button" class="icon-button" title="复制" aria-label="复制 ${escapeAttr(kit.name)}" data-reference-kit-action="copy" data-reference-kit-id="${escapeAttr(kit.id)}">⧉</button><button type="button" class="icon-button danger" title="删除" aria-label="删除 ${escapeAttr(kit.name)}" data-reference-kit-action="delete" data-reference-kit-id="${escapeAttr(kit.id)}">×</button></div></div>
      <div class="reference-kit-role-summary">${roleSummary || "未选择引用"}</div>
      <div class="reference-kit-bind-row">${shotOptions}</div>
      ${boundShots.length ? `<div class="reference-kit-bound-shots">已绑定：${boundShots.map((shot) => `<span>${escapeHtml(shot.name)} v${shot.referenceKitVersion || kit.version}</span>`).join("")}</div>` : ""}
    </article>`;
  }).join("");
}

function openReferenceKitEditor(kit = null, copy = false) {
  state.referenceKitEditingId = copy ? "" : kit?.id || "";
  state.referenceKitDraft = referenceKitDraftFromKit(kit || {}, copy);
  renderReferenceKits();
  $("#referenceKitForm [name='kitName']")?.focus();
}

function closeReferenceKitEditor() {
  state.referenceKitEditingId = "";
  state.referenceKitDraft = null;
  renderReferenceKits();
}

async function saveReferenceKit(event) {
  event.preventDefault();
  if (!state.selectedId) return;
  const form = event.currentTarget;
  const roles = Object.fromEntries(Object.keys(REFERENCE_KIT_ROLE_LABELS).map((role) => [role, [...form.querySelectorAll(`[data-reference-kit-role='${role}']:checked`)].map((input) => input.value)]));
  const policy = Object.fromEntries(["identityLock", "sceneLock", "wardrobeLock", "styleLock"].map((key) => [key, !!form.querySelector(`[name='${key}']`)?.checked]));
  const data = await api(`/api/project/${state.selectedId}/reference-kits`, {
    method: "POST",
    body: JSON.stringify({ id: form.querySelector("[name='kitId']")?.value || "", name: form.querySelector("[name='kitName']")?.value || "", roles, policy }),
  });
  state.referenceKitDraft = null;
  state.referenceKitEditingId = "";
  setProjectState(data);
  renderWorkspace();
  toast("Reference Kit 已保存");
}

async function bindReferenceKit(kitId, shotName) {
  if (!state.selectedId || !kitId || !shotName) return toast("请选择要绑定的 Shot");
  const data = await api(`/api/project/${state.selectedId}/reference-kits/${encodeURIComponent(kitId)}/bind`, {
    method: "POST",
    body: JSON.stringify({ shotName }),
  });
  setProjectState(data);
  renderWorkspace();
  toast("Reference Kit 已绑定到 Shot");
}

async function deleteReferenceKit(kitId) {
  if (!state.selectedId || !kitId || !window.confirm("删除这个 Reference Kit？已绑定 Shot 会解除 Kit 绑定，但保留手动引用。")) return;
  const data = await api(`/api/project/${state.selectedId}/reference-kits/${encodeURIComponent(kitId)}`, { method: "DELETE" });
  state.referenceKitDraft = null;
  setProjectState(data);
  renderWorkspace();
  toast("Reference Kit 已删除");
}


async function reclassifyAsset(assetId, targetType) {
  const manifest = JSON.parse(JSON.stringify(state.project?.assetManifest || {}));
  const item = (manifest.items || []).find((entry) => entry.id === assetId);
  if (!item) throw new Error("找不到待确认资产");
  if (item.type === targetType) return;
  item.type = targetType;
  try {
    const data = await api(`/api/project/${state.selectedId}/asset-manifest`, {
      method: "POST",
      body: JSON.stringify({ manifest, confirm: false }),
    });
    setProjectState(data);
    renderWorkspace();
    toast(`已将“${item.label || assetId}”移至${assetTypeLabel(targetType)}`);
  } catch (error) {
    renderWorkspace();
    throw error;
  }
}

const ASSET_CLASSIFICATION_GROUPS = [
  ["Character", "人物"],
  ["Scene", "场景"],
  ["Prop", "道具"],
  ["Insert", "插入"],
];

function ensureAssetClassificationGroups(node) {
  let root = node.querySelector(".asset-reclassify-groups");
  if (root) return root;
  node.innerHTML = "";
  root = document.createElement("div");
  root.className = "asset-reclassify-groups";
  for (const [type, label] of ASSET_CLASSIFICATION_GROUPS) {
    const section = document.createElement("section");
    section.className = "asset-reclassify-group";
    section.innerHTML = `<h3>${label}</h3><div class="asset-reclassify-dropzone" data-asset-drop-type="${type}"></div>`;
    const dropzone = section.querySelector(".asset-reclassify-dropzone");
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      dropzone.classList.add("is-dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
      const assetId = event.dataTransfer.getData("text/plain");
      if (assetId) reclassifyAsset(assetId, type).catch((error) => toast(error.message));
    });
    root.appendChild(section);
  }
  node.appendChild(root);
  return root;
}

function renderAssets(slots, assets = [], jobs = null) {
  const slotList = mergeSlotsWithScannedAssets(slots || [], assets || []);
  const activeTargets = activeJobTargets(jobs);
  const manifest = state.project?.assetManifest || null;
  const pendingClassification = !!manifest?.items?.length && !manifest.confirmed;
  const flaggedByLabel = new Map((manifest?.audit?.flagged || []).map((item) => [item.label, item]));
  const node = $("#assetGallery");
  const hasAssetSurface = projectHasAssetSurface(slotList, assets);
  assetGalleryHidden(!hasAssetSurface);
  if (!hasAssetSurface) return;
  const classificationSignature = pendingClassification
    ? `${manifest.items.map((item) => `${item.id}:${item.type}`).join(",")}#${[...flaggedByLabel.keys()].join(",")}`
    : "confirmed";
  const signature = `${assetRenderSignature(slotList, activeTargets)}#${classificationSignature}`;
  // Nothing visible changed since the last render: skip the teardown so the
  // 2s poll loop stops resetting scroll and re-fetching every <img>.
  if (node.dataset.renderSig === signature && node.childElementCount > 0) return;
  const scroller = getScrollableAncestor(node);
  const prevScroll = scroller ? scroller.scrollTop : 0;
  const readyCount = slotList.filter((slot) => slot.status === "ready").length;
  const skippedCount = slotList.filter((slot) => slot.skipped || slot.status === "skipped").length;
  const missingCount = slotList.filter((slot) => slot.status !== "ready" && slot.status !== "skipped" && !slot.skipped).length;
  $("#assetCount").textContent = slotList.length
    ? `${readyCount}/${slotList.length} ready · ${missingCount} missing${skippedCount ? ` · ${skippedCount} skipped` : ""}`
    : `${assets.length} files`;
  node.dataset.renderSig = signature;
  if (!slotList.length) {
    // 骨架/加载阶段(loadProject 先渲染的 shell)assetSlots 为空，别显示"没有资产图"的误导文案，改为加载中。
    node.innerHTML = state.project?.loading ? `<div class="asset-empty-state">正在加载资产…</div>` : "";
    return;
  }

  const buildAssetCard = (slot) => {
    const asset = slot.asset;
    const assetName = slot.id || asset?.assetName || "";
    const isGenerating = isActiveJobTarget(activeTargets, assetName, asset?.assetName, asset?.name);
    const displaySlot = isGenerating ? { ...slot, isGenerating: true, statusLabel: "生成中" } : slot;
    const isStaleAfterFailure = !!asset && !!slot.staleAsset;
    const isReused = !!slot.reused || !!asset?.reused;
    const isSelected = state.selectedAssetIds.has(assetName);
    const canGenerateAsset = !(slot.skipped || slot.status === "skipped");
    const flagged = flaggedByLabel.get(slot.label || assetName) || flaggedByLabel.get(assetName);
    const card = document.createElement("article");
    card.className = `asset-card asset-slot ${asset ? "has-asset" : "is-missing"} ${slot.skipped || slot.status === "skipped" ? "is-skipped" : ""} ${slot.failed && !asset ? "is-failed" : ""} ${isStaleAfterFailure ? "has-stale-asset" : ""} ${isGenerating ? "is-node-running" : ""} ${isSelected ? "is-selected" : ""} ${flagged ? "is-flagged" : ""}`;
    card.draggable = pendingClassification;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", isSelected ? "true" : "false");
    card.setAttribute("aria-label", asset ? `选择资产 ${asset.assetName}` : `选择资产 ${assetName}`);
    if (asset) {
      card.title = "点击选择，双击放大预览";
    }
    if (flagged) card.title = `AI建议可能是${assetTypeLabel(flagged.suspectType || flagged.to)}，请核对`;
    const downloadUrl = asset ? `${asset.url}${asset.url.includes("?") ? "&" : "?"}download=1` : "";
    card.innerHTML = `
      ${
        asset
          ? `<div class="asset-card-media"><img src="${asset.url}" alt="${asset.assetName}" loading="lazy" /></div>
            ${isReused ? `<div class="asset-failure-ribbon">复用已有资产</div>` : ""}`
          : `<div class="asset-missing-preview">
              <strong>${escapeHtml(slot.label || assetName)}</strong>
              <span>${escapeHtml(assetTypeLabel(slot.type))} · ${escapeHtml(assetSlotStatusLabel(displaySlot))}</span>
            </div>`
      }
      <div class="asset-tools" aria-label="资产图操作">
        ${asset
          ? `<a class="asset-tool asset-download" href="${downloadUrl}" download="${escapeAttr(asset.name || `${asset.assetName}.png`)}" aria-label="下载 ${escapeAttr(asset.assetName)}" title="下载">
          <span aria-hidden="true">↓</span>
        </a>
        <button class="asset-tool asset-regenerate" type="button" aria-label="重新生成 ${escapeAttr(assetName)}" title="重新生成">
          <span aria-hidden="true">↻</span>
        </button>
        <button class="asset-tool asset-delete" type="button" aria-label="删除 ${escapeAttr(asset.assetName)}" title="删除">
          <span aria-hidden="true">×</span>
        </button>`
          : `<button class="asset-tool asset-regenerate" type="button" ${canGenerateAsset ? "" : "disabled"} aria-label="${canGenerateAsset ? "生成" : "已设为不生成"} ${escapeAttr(assetName)}" title="${canGenerateAsset ? "生成" : "已设为不生成，点击右侧开关可恢复生成"}">
          <span aria-hidden="true">+</span>
        </button>
        <button class="asset-tool asset-skip-toggle ${canGenerateAsset ? "is-on" : "is-off"}" type="button" data-asset-skip="${escapeAttr(assetName)}" aria-label="${canGenerateAsset ? "设为不生成" : "设为生成"} ${escapeAttr(assetName)}" title="${canGenerateAsset ? "点击排除：不生成这个资产" : "已排除，点击重新加入生成"}">
          <span aria-hidden="true">${canGenerateAsset ? "−" : "+"}</span>
        </button>`}
      </div>
      <div class="caption">
        <strong>${renderNodeBeacon(isGenerating, `正在生成 ${assetName}`)}${escapeHtml(slot.label || assetName)}</strong>
        <span class="asset-slot-status ${assetSlotStatusClass(displaySlot)}">${escapeHtml(assetSlotStatusLabel(displaySlot))}</span>
        ${isStaleAfterFailure ? `<span class="asset-slot-status warn">上次修改失败，可重新生成</span>` : ""}
        ${isReused ? `<span class="asset-slot-status ok">${escapeHtml(assetReuseLabel(slot, asset))}</span>` : ""}
      </div>
    `;
    if (pendingClassification) {
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", assetName);
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    }
    const download = card.querySelector(".asset-download");
    if (download) download.addEventListener("click", (event) => event.stopPropagation());
    card.querySelector(".asset-regenerate").addEventListener("click", (event) => {
      event.stopPropagation();
      if (!canGenerateAsset) return toast("这个资产已设为不生成，点击右侧开关可恢复生成");
      regenerateAsset(assetName, { force: !!asset }).catch((error) => toast(error.message));
    });
    card.querySelector(".asset-skip-toggle")?.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleManifestAssetGeneration(assetName).catch((error) => toast(error.message));
    });
    if (asset) {
      const deleteButton = card.querySelector(".asset-delete");
      if (deleteButton) {
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteAsset(asset.assetName).catch((error) => toast(error.message));
        });
      }
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        openLightbox(asset);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (assetPromptInspectorWorkspace()) selectAssetForInspector(assetName);
          else toggleAssetSelection(assetName);
        }
      });
    }
    card.addEventListener("click", (event) => {
      if (event.target.closest(".asset-tools, a, button, select, textarea, input, label")) return;
      applyAssetBoundStyle(assetForName(assetName));
      if (asset && assetPromptInspectorWorkspace()) selectAssetForInspector(assetName);
      else toggleAssetSelection(assetName);
    });
    return card;
  };

  // Per-card signature mirrors assetRenderSignature's per-slot fields, so a
  // single change (e.g. clicking generate) only rebuilds that card.
  const specs = slotList.map((slot) => {
    const asset = slot.asset;
    const name = slot.id || asset?.assetName || "";
    const gen = isActiveJobTarget(activeTargets, name, asset?.assetName, asset?.name) ? 1 : 0;
    const flagged = flaggedByLabel.get(slot.label || name) || flaggedByLabel.get(name);
    const sig = [
      name,
      slot.status || "",
      slot.skipped || slot.status === "skipped" ? 1 : 0,
      slot.reused || asset?.reused ? 1 : 0,
      slot.staleAsset ? 1 : 0,
      slot.failed ? 1 : 0,
      asset?.url || "",
      asset?.assetName || "",
      gen,
      flagged ? `${flagged.currentType || flagged.type}:${flagged.suspectType || flagged.to}` : "",
      state.selectedAssetIds.has(name) ? 1 : 0,
    ].join("|");
    return { key: name, sig, slot };
  });
  if (pendingClassification) {
    const root = ensureAssetClassificationGroups(node);
    for (const [type] of ASSET_CLASSIFICATION_GROUPS) {
      const group = root.querySelector(`[data-asset-drop-type="${type}"]`);
      const groupSpecs = specs.filter((spec) => spec.slot.type === type);
      reconcileKeyedCards(group, groupSpecs, (spec) => buildAssetCard(spec.slot));
    }
  } else {
    if (node.querySelector(".asset-reclassify-groups")) node.innerHTML = "";
    reconcileKeyedCards(node, specs, (spec) => buildAssetCard(spec.slot));
  }
  // Restore the pre-rebuild scroll position so a poll-driven re-render never
  // yanks the user back to the top. rAF pass covers post-layout reflow.
  if (scroller && prevScroll) {
    scroller.scrollTop = prevScroll;
    requestAnimationFrame(() => {
      scroller.scrollTop = prevScroll;
    });
  }
}

function renderStoryboards(slots, storyboards = [], jobs = null) {
  const node = $("#storyboardGridGallery");
  const count = $("#storyboardGridCount");
  if (!node || !count) return;
  const slotList = slots || [];
  const activeTargets = activeJobTargets(jobs);
  const readyCount = slotList.filter((slot) => slot.status === "ready").length;
  const missingCount = slotList.filter((slot) => slot.status !== "ready").length;
  count.textContent = slotList.length ? `${readyCount}/${slotList.length} ready · ${missingCount} missing` : `${storyboards.length} files`;
  // Skip the teardown when nothing changed, so poll-driven refreshes don't keep
  // destroying/recreating the storyboard <img> thumbnails (flicker / re-load).
  const sbSig = JSON.stringify(slotList.map((slot) => {
    const a = slot.asset;
    return [
      slot.id || a?.assetName || "",
      slot.status || "",
      a?.url || "",
      isActiveJobTarget(activeTargets, slot.id || a?.assetName, a?.assetName, a?.name) ? 1 : 0,
      slot.label || "",
    ];
  }));
  if (node.dataset.sbSig === sbSig && node.childElementCount > 0) return;
  const scroller = getScrollableAncestor(node);
  const prevScroll = scroller ? scroller.scrollTop : 0;
  node.dataset.sbSig = sbSig;
  if (!slotList.length) {
    node.innerHTML = `<div class="pill">等待资产解析</div>`;
    return;
  }
  const buildStoryboardCard = (slot) => {
    const asset = slot.asset;
    const storyboardName = slot.id || asset?.assetName || "";
    const isGenerating = isActiveJobTarget(activeTargets, storyboardName, asset?.assetName, asset?.name);
    const rangeLabel = storyboardSlotRangeLabel(slot);
    const card = document.createElement("article");
    card.className = `asset-card storyboard-card asset-slot ${asset ? "has-asset" : "is-missing"} ${isGenerating ? "is-node-running" : ""}`;
    if (asset) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `放大预览 ${asset.assetName}`);
    }
    const downloadUrl = asset ? `${asset.url}${asset.url.includes("?") ? "&" : "?"}download=1` : "";
    card.innerHTML = `
      ${
        asset
          ? `<img src="${asset.url}" alt="${asset.assetName}" loading="lazy" />`
          : `<div class="asset-missing-preview storyboard-missing-preview">
              <strong>${escapeHtml(slot.label || storyboardName)}</strong>
              <span>${escapeHtml(rangeLabel)} · ${escapeHtml(assetSlotStatusLabel(slot))}</span>
            </div>`
      }
      <div class="asset-tools" aria-label="Production Board 操作">
        ${
          asset
            ? `<a class="asset-tool asset-download" href="${downloadUrl}" download="${escapeAttr(asset.name || `${asset.assetName}.png`)}" aria-label="下载 ${escapeAttr(asset.assetName)}" title="下载">
          <span aria-hidden="true">↓</span>
        </a>`
            : ""
        }
        <button class="asset-tool storyboard-regenerate" type="button" aria-label="${asset ? "重新生成" : "生成"} ${escapeAttr(storyboardName)}" title="${asset ? "重新生成" : "生成"}">
          <span aria-hidden="true">${asset ? "↻" : "+"}</span>
        </button>
      </div>
      <div class="caption">
        <strong>${renderNodeBeacon(isGenerating, `正在生成 ${storyboardName}`)}${escapeHtml(slot.label || storyboardName)}</strong>
        <span class="asset-slot-status ${assetSlotStatusClass(slot)}">${escapeHtml(assetSlotStatusLabel(slot))}</span>
        <small>${escapeHtml(rangeLabel)}</small>
      </div>
    `;
    const download = card.querySelector(".asset-download");
    if (download) download.addEventListener("click", (event) => event.stopPropagation());
    const regenerate = card.querySelector(".storyboard-regenerate");
    if (regenerate) {
      regenerate.addEventListener("click", (event) => {
        event.stopPropagation();
        regenerateStoryboard(storyboardName, { force: !!asset }).catch((error) => toast(error.message));
      });
    }
    if (asset) {
      card.addEventListener("click", () => openLightbox(asset));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          openLightbox(asset);
        }
      });
    }
    return card;
  };

  const specs = slotList.map((slot) => {
    const a = slot.asset;
    const name = slot.id || a?.assetName || "";
    const gen = isActiveJobTarget(activeTargets, name, a?.assetName, a?.name) ? 1 : 0;
    const sig = [name, slot.status || "", a?.url || "", gen, slot.label || ""].join("|");
    return { key: name, sig, slot };
  });
  reconcileKeyedCards(node, specs, (spec) => buildStoryboardCard(spec.slot));
  // 恢复重建前的滚动位置（同步 + rAF），避免轮询重建把故事板页面弹回顶部。
  if (scroller && prevScroll) {
    scroller.scrollTop = prevScroll;
    requestAnimationFrame(() => {
      scroller.scrollTop = prevScroll;
    });
  }
}

function relationStatusClass(status) {
  if (["ready", "confirmed", "generated", "complete"].includes(status)) return "ok";
  if (status === "skipped") return "";
  if (["missing", "failed", "canceled", "pending"].includes(status)) return "warn";
  if (status === "running") return "active";
  return "";
}

function relationLaneNodes(canvas, key) {
  return canvas?.lanes?.find((lane) => lane.key === key)?.nodes || [];
}

function relationShotLabel(name, index = 0) {
  const match = String(name || "").match(/(?:^|_)(V\d{2,3})/i);
  return match ? match[1].toUpperCase() : `V${String(index + 1).padStart(3, "0")}`;
}

function relationGroupStatus(nodes) {
  if (!nodes?.length) return "waiting";
  if (nodes.some((item) => ["missing", "failed", "canceled"].includes(item.status))) return "missing";
  if (nodes.some((item) => item.status === "running")) return "running";
  if (nodes.some((item) => item.status === "pending")) return "pending";
  if (nodes.every((item) => ["ready", "confirmed", "generated", "complete"].includes(item.status))) return "ready";
  return "waiting";
}

function relationGroupMeta(nodes, fallback = "0") {
  if (!nodes?.length) return fallback;
  const ready = nodes.filter((item) => ["ready", "confirmed", "generated", "complete"].includes(item.status)).length;
  return `${ready}/${nodes.length} 已就绪`;
}

function relationMapNodeHtml(item) {
  const statusClass = relationStatusClass(item.status);
  const style = `left:${Math.round(item.x)}px;top:${Math.round(item.y)}px;width:${Math.round(item.w)}px;`;
  const displayLabel = item.displayLabel || item.matchCode || item.label || item.name || item.id;
  const detail = item.detail || item.meta || item.statusLabel || "";
  const meta = detail ? `<small>${escapeHtml(detail)}</small>` : "";
  const title = [
    item.title || item.name || item.label,
    item.matchCode,
    item.statusLabel,
    item.source,
    item.file,
    item.issue,
    item.usedBy?.length ? `引用片段：${item.usedBy.join("，")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const progress =
    item.kind === "shot" &&
    item.progress !== null &&
    item.progress !== undefined &&
    item.progress !== "" &&
    Number.isFinite(Number(item.progress))
      ? `<span class="relation-node-progress" style="width:${Math.max(0, Math.min(100, Number(item.progress)))}%;"></span>`
      : "";
  return `
    <article class="relation-map-node ${item.kind || ""} ${item.type || ""} ${statusClass}" style="${style}" title="${escapeAttr(title)}">
      ${progress}
      <span class="relation-node-dot"></span>
      <strong>${escapeHtml(displayLabel)}</strong>
      ${meta}
    </article>
  `;
}

function relationEdgePath(from, to, type = "") {
  const fromBeforeTo = from.x <= to.x;
  const x1 = fromBeforeTo ? from.x + from.w : from.x;
  const y1 = from.y + Math.max(18, Math.min(32, (from.h || 56) / 2));
  const x2 = fromBeforeTo ? to.x : to.x + to.w;
  const y2 = to.y + Math.max(18, Math.min(32, (to.h || 56) / 2));
  const bend = Math.max(42, Math.min(170, Math.abs(x2 - x1) / 2));
  if (type === "sequence" && Math.abs(x2 - x1) < 120) {
    const offset = 26 + Math.min(44, Math.abs(y2 - y1) / 3);
    return `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 + offset} ${y2}, ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} C ${x1 + (fromBeforeTo ? bend : -bend)} ${y1}, ${x2 - (fromBeforeTo ? bend : -bend)} ${y2}, ${x2} ${y2}`;
}

function relationShortName(value, max = 18) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(4, max - 4))}...`;
}

function relationNodeDetail(item) {
  if (item.kind === "shot") {
    const refs = Array.isArray(item.refs) ? item.refs.length : 0;
    const missing = Array.isArray(item.refs) ? item.refs.filter((ref) => ref.missing).length : 0;
    if (missing) return `${item.statusLabel || "待处理"} · ${missing}/${refs} 引用缺失`;
    return `${item.statusLabel || "待处理"} · ${refs} 引用 · ${item.duration || "-"}s`;
  }
  if (item.kind === "asset") {
    const refs = Number(item.references || 0);
    if (item.issue) return `${item.statusLabel || ""} · ${item.issue}`.replace(/^ · /, "");
    return `${item.statusLabel || ""} · ${refs ? `${refs} 次引用` : "未被引用"}`.replace(/^ · /, "");
  }
  return item.meta || item.statusLabel || "";
}

function relationDisplayLabel(item, index = 0) {
  if (item.kind === "shot") return relationShotLabel(item.name || item.label, index);
  if (item.kind === "asset" && item.matchCode) return item.matchCode;
  return item.label || item.name || item.id;
}

function relationFallbackEdges(mapNodes) {
  const byId = new Map(mapNodes.map((item) => [item.id, item]));
  const edges = [];
  const maybe = (from, to, type = "flow") => {
    if (byId.has(from) && byId.has(to)) edges.push({ from, to, type, status: "ok" });
  };
  maybe("script", "storyboard");
  maybe("script", "manifest");
  maybe("storyboard", "storyboard-grid");
  const shots = mapNodes.filter((item) => item.kind === "shot");
  shots.slice(0, -1).forEach((shot, index) => maybe(shot.id, shots[index + 1].id, "sequence"));
  shots.forEach((shot) => maybe(shot.id, "clips", "output"));
  return edges;
}

function renderRelationshipCanvas(canvas) {
  const node = $("#relationCanvas");
  const summary = $("#relationSummary");
  const stats = $("#relationStats");
  if (!node || !summary || !stats) return;

  if (!canvas?.lanes?.length) {
    summary.textContent = "生成分镜草稿和资产解析后显示节点关系。";
    stats.innerHTML = "";
    node.innerHTML = `<div class="relation-empty-map">暂无节点关系</div>`;
    return;
  }

  const issues = canvas.issues || [];
  summary.textContent = issues.length ? issues.slice(0, 2).join(" / ") : "节点依赖清晰，资产、片段和输出关系正常。";
  stats.innerHTML = `
    <span class="pill">${canvas.summary?.generatedAssets || 0}/${canvas.summary?.assets || 0} 资产图</span>
    <span class="pill">${canvas.summary?.completedShots || 0}/${canvas.summary?.shots || 0} 视频片段</span>
    <span class="pill ${issues.length ? "warn" : "ok"}">${issues.length ? `${issues.length} 个问题` : "关系清晰"}</span>
  `;

  const storyboardLane = relationLaneNodes(canvas, "storyboards");
  const laneDefs = [
    { key: "source", title: "输入", x: 30, w: 132 },
    ...(storyboardLane.length ? [{ key: "storyboards", title: "Production Board", x: 210, w: 190 }] : []),
    { key: "characters", title: "人物资产", x: storyboardLane.length ? 402 : 230, w: 158 },
    { key: "scenes", title: "场景资产", x: storyboardLane.length ? 610 : 432, w: 158 },
    { key: "props", title: "道具/插入", x: storyboardLane.length ? 818 : 634, w: 158 },
    { key: "shots", title: "视频片段", x: storyboardLane.length ? 1044 : 858, w: 132 },
    { key: "outputs", title: "输出", x: storyboardLane.length ? 1228 : 1028, w: 132 },
  ];
  const rowGap = 66;
  const laneTop = 68;
  const mapNodes = [];
  const laneLabels = [];

  laneDefs.forEach((lane) => {
    const nodes = relationLaneNodes(canvas, lane.key);
    if (!nodes.length && lane.key !== "props") return;
    laneLabels.push(`<span class="relation-lane-label" style="left:${lane.x}px;top:24px;width:${lane.w}px;">${escapeHtml(lane.title)}</span>`);
    nodes.forEach((item, index) => {
      const missingRefs = item.kind === "shot" ? (item.refs || []).filter((ref) => ref.missing).length : 0;
      const status = missingRefs ? "missing" : item.status;
      mapNodes.push({
        ...item,
        id: item.id || `${lane.key}:${item.name || item.label || index}`,
        displayLabel: relationDisplayLabel(item, index),
        detail: relationNodeDetail(item),
        status,
        x: lane.x,
        y: laneTop + index * rowGap,
        w: lane.w,
        h: 54,
      });
    });
  });

  const byId = new Map(mapNodes.map((item) => [item.id, item]));
  const rawEdges = Array.isArray(canvas.edges) && canvas.edges.length ? canvas.edges : relationFallbackEdges(mapNodes);
  const edges = rawEdges.filter((edge) => byId.has(edge.from) && byId.has(edge.to));
  const mapWidth = Math.max(1400, Math.max(...laneDefs.map((lane) => lane.x + lane.w)) + 36);
  const maxNodeBottom = mapNodes.reduce((max, item) => Math.max(max, item.y + (item.h || 54)), 0);
  const mapHeight = Math.max(360, maxNodeBottom + 44);

  const edgeHtml = edges
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return "";
      const warn = edge.status === "warn" || relationStatusClass(from.status) === "warn" || relationStatusClass(to.status) === "warn";
      const active = edge.status === "active" || relationStatusClass(from.status) === "active" || relationStatusClass(to.status) === "active";
      return `<path class="relation-map-edge ${edge.type || ""} ${warn ? "warn" : ""} ${active ? "active" : ""}" d="${relationEdgePath(from, to, edge.type)}"><title>${escapeHtml(edge.title || edge.label || "")}</title></path>`;
    })
    .join("");

  const continuity = (canvas.continuity || []).filter((item) => item.sharedScene || item.useStoryboard);
  const continuityHtml = continuity.length
    ? `
      <div class="relation-map-note">
        <strong>同场景切镜</strong>
        <div>
          ${continuity
            .slice(0, 6)
            .map(
              (item) => `
                <span class="continuity-chip ${item.useStoryboard || item.useTailFrame && item.tailFrameReady ? "ok" : ""}">
                  ${escapeHtml(item.from.replace(/^.*?(V\d+).*$/i, "$1"))} 到 ${escapeHtml(item.to.replace(/^.*?(V\d+).*$/i, "$1"))}
                  ${item.useStoryboard ? "Production Board" : item.useTailFrame ? (item.tailFrameReady ? "尾帧已就绪" : "等待尾帧") : "默认切镜"}
                </span>
              `,
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  node.innerHTML = `
    <div class="relation-map-wrap">
      <div class="relation-map" style="width:${mapWidth}px;height:${mapHeight}px;">
        <svg class="relation-map-edges" viewBox="0 0 ${mapWidth} ${mapHeight}" aria-hidden="true">
          ${edgeHtml}
        </svg>
        ${laneLabels.join("")}
        ${mapNodes.map(relationMapNodeHtml).join("")}
      </div>
    </div>
    ${continuityHtml}
  `;
}

async function deleteAsset(assetName) {
  if (!state.selectedId || !assetName) return;
  const confirmed = window.confirm(`删除资产图“${assetName}”？会从当前资产库移除；需要时可重新添加或上传。`);
  if (!confirmed) return;
  const data = await api(`/api/project/${state.selectedId}/asset-delete`, {
    method: "POST",
    body: JSON.stringify({ assetName }),
  });
  setProjectState(data.state);
  state.selectedAssetIds.delete(assetName);
  state.assetPromptDrafts.delete(assetName);
  if (state.selectedAssetId === assetName) {
    state.selectedAssetId = "";
    state.assetInspectorOpen = false;
  }
  renderWorkspace();
  toast(`已删除资产：${assetName}`);
}

// Light-weight renders for the assets / storyboard galleries only, pulling from
// the current project state — same call shape as renderWorkspace and the poll
// loop. Used by generate/regenerate so a single click doesn't trigger the full
// renderWorkspace pass (which re-runs setStudioTab/applyWindowLayout and yanks
// the studio scroll back to the top, plus re-renders a dozen unrelated panels).
function renderAssetsFromState() {
  const data = state.project;
  if (!data?.project) return;
  renderAssets(data.assetSlots || buildAssetSlots(data.assetManifest || null, data.assets || []), data.assets || [], data.jobs || data.assetJob);
  renderAssetInspector();
}

function renderStoryboardsFromState() {
  const data = state.project;
  if (!data?.project) return;
  renderStoryboards(data.storyboardSlots || [], data.storyboards || [], data.jobs || data.storyboardJob);
}

async function regenerateAsset(assetName, options = {}) {
  if (!state.selectedId) return;
  const jobType = assetName ? "asset-regenerate" : options.force ? "asset-regenerate" : "assets";
  if (assetName) state.optimisticAssetJobs.set(assetName, { startedAt: Date.now(), type: jobType });
  renderAssetsFromState();
  const data = await api(`/api/project/${state.selectedId}/job`, {
    method: "POST",
    body: JSON.stringify({
      type: jobType,
      assetName,
      assetRange: jobType === "assets" ? "selected" : undefined,
      assetNames: jobType === "assets" && assetName ? [assetName] : undefined,
      quality: $("#assetQuality")?.value || "1k",
      ...stylePayloadForAsset(assetName),
    }),
  });
  state.activeJobId = data.job.id;
  toast(`${options.force ? "已提交重新生成" : "已提交生成"}：${assetName}`);
  scheduleProjectRefresh({ immediate: true });
}

async function regenerateStoryboard(storyboardName, { force = false } = {}) {
  if (!state.selectedId || !storyboardName) return;
  await saveFileQuiet("storyboard");
  await saveFileQuiet("seedancePrompts");
  state.optimisticAssetJobs.set(storyboardName, { startedAt: Date.now(), type: force ? "storyboard-regenerate" : "storyboards" });
  renderStoryboardsFromState();
  const body = {
    type: force ? "storyboard-regenerate" : "storyboards",
    quality: $("#assetQuality")?.value || "1k",
    dialogueLanguage: state.dialogueLanguage,
  };
  if (force) {
    body.storyboardName = storyboardName;
  } else {
    body.storyboardRange = "selected";
    body.storyboardNames = [storyboardName];
  }
  const data = await api(`/api/project/${state.selectedId}/job`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  state.activeJobId = data.job.id;
  toast(`${force ? "已提交重新生成" : "已提交生成"}：${storyboardName}`);
  scheduleProjectRefresh({ immediate: true });
}

function statusText(status) {
  const map = {
    running: "运行中",
    queued: "排队中",
    complete: "已完成",
    failed: "失败",
    interrupted: "已中断",
    canceled: "已取消",
    cancelled: "已取消",
  };
  return map[status] || status || "未开始";
}

function jobStatusClass(job, hasFailures = false) {
  if (!job) return "";
  if (job.status === "running") return "active";
  if (job.status === "complete" && !hasFailures) return "ok";
  if (["failed", "interrupted", "canceled", "cancelled"].includes(job.status) || hasFailures) return "warn";
  return "";
}

function jobFailureLine(job) {
  const reason = String(job?.failureReason || "").trim();
  return reason ? `<div class="status-row"><span class="pill warn">${escapeHtml(reason)}</span></div>` : "";
}

function parseAssetJobLog(log) {
  const text = String(log || "");
  const summary = {
    planned: "",
    current: "",
    generated: 0,
    skipped: 0,
    failed: 0,
  };
  const plannedMatch = text.match(/planned assets:\s*([^\n]+)/i);
  if (plannedMatch) summary.planned = plannedMatch[1].trim();
  const activeMatches = [...text.matchAll(/\b(?:generating|editing)\s+(.+?)\s+\(\d+x\d+\)\s+->/gi)];
  if (activeMatches.length) summary.current = activeMatches[activeMatches.length - 1][1].trim();
  summary.generated = (text.match(/\b(?:generated|edited)\s+.+?\s+->/gi) || []).length;
  summary.skipped = (text.match(/\bskipping existing\s+/gi) || []).length;
  summary.failed = (text.match(/\bfailed\s+.+?:/gi) || []).length;
  return summary;
}

function renderAssetJob(job) {
  const node = $("#assetJobStatus");
  const data = state.project || {};
  const slots = data.assetSlots || buildAssetSlots(data.assetManifest || null, data.assets || []);
  const hasAssetSurface = projectHasAssetSurface(slots, data.assets || []);
  assetJobStatusHidden(!hasAssetSurface);
  if (!hasAssetSurface) return;
  if (!job) {
    node.innerHTML = "";
    return;
  }
  const log = (job.logs || "").trim();
  const parsed = parseAssetJobLog(log);
  const hasAssetFailures = parsed.failed > 0;
  const jobStatusLabel = job.status === "complete" && hasAssetFailures ? "部分失败" : statusText(job.status);
  const failureLine = jobFailureLine(job);
  const progressLine =
    parsed.planned || parsed.current || parsed.generated || parsed.skipped || parsed.failed
      ? `<div class="status-row asset-progress-row">
          ${parsed.planned ? `<span class="pill">计划：${escapeHtml(parsed.planned)}</span>` : ""}
          ${parsed.current && job.status === "running" ? `<span class="pill ok">当前：${escapeHtml(parsed.current)}</span>` : ""}
          ${parsed.generated ? `<span class="pill ok">已生成 ${parsed.generated}</span>` : ""}
          ${parsed.skipped ? `<span class="pill">已复用 ${parsed.skipped}</span>` : ""}
          ${parsed.failed ? `<span class="pill warn">失败 ${parsed.failed}</span>` : ""}
        </div>`
      : "";
  node.innerHTML = `
    <div class="status-row">
      <span class="pill ${jobStatusClass(job, hasAssetFailures)}">资产图：${jobStatusLabel}</span>
      ${job.assetStyleLabel ? `<span class="pill">风格：${escapeHtml(job.assetStyleLabel)}</span>` : ""}
      ${job.assetStyleReferenceEnabled ? `<span class="pill ok">风格参考图已启用</span>` : ""}
    </div>
    ${failureLine}
    ${progressLine}
  `;
}

function renderStoryboardJob(job) {
  const node = $("#storyboardJobStatus");
  if (!node) return;
  if (!job) {
    node.innerHTML = `
      <div class="status-row"><span class="pill">Production Board：未开始</span></div>
    `;
    return;
  }
  const log = (job.logs || "").trim();
  const parsed = parseAssetJobLog(log);
  const hasFailures = parsed.failed > 0;
  const jobStatusLabel = job.status === "complete" && hasFailures ? "部分失败" : statusText(job.status);
  const failureLine = jobFailureLine(job);
  const progressLine =
    parsed.planned || parsed.current || parsed.generated || parsed.skipped || parsed.failed
      ? `<div class="status-row asset-progress-row">
          ${parsed.planned ? `<span class="pill">计划：${escapeHtml(parsed.planned)}</span>` : ""}
          ${parsed.current && job.status === "running" ? `<span class="pill ok">当前：${escapeHtml(parsed.current)}</span>` : ""}
          ${parsed.generated ? `<span class="pill ok">已生成 ${parsed.generated}</span>` : ""}
          ${parsed.skipped ? `<span class="pill">已复用 ${parsed.skipped}</span>` : ""}
          ${parsed.failed ? `<span class="pill warn">失败 ${parsed.failed}</span>` : ""}
        </div>`
      : "";
  node.innerHTML = `
    <div class="status-row">
      <span class="pill ${jobStatusClass(job, hasFailures)}">Production Board：${jobStatusLabel}</span>
      <span class="pill">9:16 竖版 · 2 列分镜格</span>
    </div>
    ${failureLine}
    ${progressLine}
  `;
}

function renderVideoConfigStatus(config) {
  const node = $("#videoConfigStatus");
  const label = $("#videoConfigLabel");
  const mainGenerateButton = $("#generateAllSegments");
  const hasBlockingMissing = Array.isArray(config.missing) && config.missing.length > 0;
  const canGenerate = !!config.exists && config.ready !== false && !hasBlockingMissing;
  if (mainGenerateButton) mainGenerateButton.disabled = !canGenerate;
  label.textContent = config.exists
    ? `${videoModelLabel(config.modelName)} / ${config.resolution || "-"} / ${config.ratio || "-"}`
    : "Seedance 2.0 / 操作台直接生成";
  if (!config.exists) {
    node.innerHTML = `<div class="status-row"><span class="pill">未生成配置</span><span class="muted">先在上方生成或刷新视频配置。</span></div>`;
    return;
  }
  const missing = config.missing?.length ? config.missing.map((item) => `<span class="pill warn">${escapeHtml(item)}</span>`).join("") : `<span class="pill ok">可直接生成视频</span>`;
  node.innerHTML = `
    <div class="status-grid">
      <div>
        <span>生成入口</span>
        <strong>操作台</strong>
        <div class="canvas-actions">
          <button class="mini-action primary" type="button" data-generate-all-segments-inline ${canGenerate ? "" : "disabled"}>${canGenerate ? "视频生成" : "先补齐参考图"}</button>
        </div>
      </div>
      <div>
        <span>配置分组</span>
        <strong>${escapeHtml(config.groupName || "-")}</strong>
      </div>
      <div>
        <span>片段</span>
        <strong>${config.shots || 0} / ${config.totalDuration || 0}s</strong>
      </div>
      <div>
        <span>资产</span>
        <strong>${config.assets || 0}</strong>
      </div>
      <div>
        <span>生成模式</span>
        <strong>${config.promptMode === "production_board" || config.enableStoryboards ? "Production Board" : "提示词 + 同场景尾帧"}</strong>
      </div>
    </div>
    <div class="status-row">${missing}</div>
  `;
  node.querySelector("[data-generate-all-segments-inline]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => generateAllVideoSegments()).catch((error) => toast(error.message));
  });
}

function setLightboxMode(mode = "default") {
  const imageOnly = mode === "image";
  document.body.classList.toggle("image-lightbox-open", imageOnly);
  $("#imageLightbox")?.classList.toggle("image-only-preview", imageOnly);
}

function openLightbox(asset) {
  setLightboxMode("image");
  const video = $("#lightboxVideo");
  video.pause();
  video.removeAttribute("src");
  video.classList.add("hidden");
  $("#lightboxImage").classList.remove("hidden");
  $("#lightboxImage").src = asset.url;
  $("#lightboxImage").alt = asset.assetName;
  $("#lightboxTitle").textContent = asset.assetName;
  $("#lightboxMeta").textContent = `${asset.type} / ${fmtBytes(asset.size)}`;
  setLightboxPrompt(asset.prompt || asset.description || "");
  setLightboxDownload(asset.url, asset.name || `${asset.assetName || "asset"}.png`);
  $("#imageLightbox").classList.remove("hidden");
}

function setLightboxPrompt(prompt = "") {
  const node = $("#lightboxPrompt");
  if (!node) return;
  const text = String(prompt || "").trim();
  node.textContent = text;
  node.classList.toggle("hidden", !text);
}

function setLightboxDownload(url = "", fileName = "download") {
  const downloads = [$("#lightboxDownload"), $("#lightboxDownloadControl")].filter(Boolean);
  if (!downloads.length) return;
  const cleanUrl = String(url || "").trim();
  downloads.forEach((download) => download.classList.toggle("hidden", !cleanUrl));
  if (!cleanUrl) {
    downloads.forEach((download) => {
      download.removeAttribute("href");
      download.removeAttribute("download");
    });
    return;
  }
  let downloadUrl = cleanUrl;
  try {
    const parsed = new URL(cleanUrl, window.location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.searchParams.set("download", "1");
      downloadUrl = parsed.href;
    }
  } catch {
    // 保留无法解析的 data/blob URL，避免破坏原始资源地址。
  }
  downloads.forEach((download) => {
    download.href = downloadUrl;
    download.download = fileName || "download";
  });
}

function openImageExplorePreview(item = {}) {
  const url = String(item.url || "").trim();
  if (!url) return;
  setLightboxMode("image");
  const image = $("#lightboxImage");
  const video = $("#lightboxVideo");
  video.pause();
  video.removeAttribute("src");
  video.classList.add("hidden");
  image.classList.remove("hidden");
  image.src = url;
  image.alt = item.prompt || "生成图片";
  $("#lightboxTitle").textContent = "生成图片";
  $("#lightboxMeta").textContent = [item.ratio, String(item.resolution || "").toUpperCase()].filter(Boolean).join(" / ");
  setLightboxPrompt(item.prompt || "");
  const suffix = String(item.id || Date.now()).replace(/[^a-z0-9_-]/gi, "").slice(-24) || "image";
  setLightboxDownload(url, `pixel-toy-${suffix}.png`);
  $("#imageLightbox").classList.remove("hidden");
}

function openVideoPreview(item) {
  const file = item?.file || {};
  if (!file.url) return toast("这个片段还没有本地视频文件");
  setLightboxMode("video");
  const image = $("#lightboxImage");
  const video = $("#lightboxVideo");
  image.removeAttribute("src");
  image.classList.add("hidden");
  video.src = file.url;
  video.classList.remove("hidden");
  video.load();
  $("#lightboxTitle").textContent = item.name || file.name || "视频片段";
  $("#lightboxMeta").textContent = `${file.name || file.rel || "mp4"}${file.size ? ` / ${fmtBytes(file.size)}` : ""}`;
  setLightboxPrompt("");
  setLightboxDownload(file.url, file.name || item.name || "pixel-toy-video.mp4");
  $("#imageLightbox").classList.remove("hidden");
}

function closeLightbox() {
  setLightboxMode("default");
  $("#imageLightbox").classList.add("hidden");
  $("#lightboxImage").removeAttribute("src");
  const video = $("#lightboxVideo");
  video.pause();
  video.removeAttribute("src");
  video.load();
  setLightboxPrompt("");
  setLightboxDownload();
}

function hasOpenManualAssetDraft() {
  return !!state.manualAssetType;
}

function progressClass(status) {
  if (status === "complete") return "ok";
  if (status === "failed") return "warn";
  if (status === "running") return "active";
  if (status === "queued") return "active";
  if (status === "canceled") return "warn";
  return "";
}

function canvasProjectHref() {
  if (!state.selectedId) return "/canvas.html";
  const canvasId = state.project?.videoConfigStatus?.videoCanvasId || videoConfigDataFromProject()?.videoCanvasId || "";
  const params = new URLSearchParams({ project: state.selectedId });
  if (canvasId) params.set("canvas", canvasId);
  return `/canvas.html?${params.toString()}`;
}

function currentVideoCanvasId(projectState = state.project) {
  return projectState?.videoConfigStatus?.videoCanvasId || videoConfigDataFromProject(projectState)?.videoCanvasId || state.selectedId || "standalone";
}

function canvasAssetFromProjectAsset(asset = {}) {
  const id = asset.assetName || asset.name || "";
  return {
    id,
    name: id,
    type: asset.manifestType || asset.type || "",
    url: asset.url || "",
    previewUrl: asset.previewUrl || "",
    assetStylePreset: asset.assetStylePreset || "",
    assetStyleLabel: asset.assetStyleLabel || "",
    generationMode: asset.generationMode || "",
    source: "project",
  };
}

function currentCanvasAssetsFromProject() {
  const data = state.project || {};
  return [
    ...(data.assets || []).filter((asset) => asset.manifestType !== "Storyboard"),
    ...(data.storyboards || []),
  ].map(canvasAssetFromProjectAsset).filter((asset) => asset.id && asset.url);
}

function shotPromptText(shot = {}) {
  return String(shot.videoPrompt || shot.prompt || shot.description || shot.name || "").trim();
}

function promptHasStoryContent(prompt = "") {
  return /(?:剧情动作|核心画面|剧情与镜头|剧情)[：:]/.test(String(prompt || ""));
}

function stableHash(value = "") {
  let hash = 5381;
  for (const char of String(value || "")) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

function safeCanvasSlug(value = "", fallback = "node") {
  const clean = String(value || fallback)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return clean || fallback;
}

function storyboardCanvasNodeId(assetName = "") {
  return `storyboard_${safeCanvasSlug(assetName || "production_board", "production_board")}_${stableHash(assetName || "production_board")}`;
}

function storyboardNodeFromAsset(asset = {}, index = 0) {
  const id = asset.id || asset.assetName || asset.name || "";
  return {
    id: storyboardCanvasNodeId(id || index),
    kind: "asset",
    source: "project-storyboard",
    projectShotName: "",
    videoPromptMode: "production_board",
    x: -360,
    y: 120 + index * 340,
    assets: [id].filter(Boolean),
    prompt: "",
  };
}

function videoConfigDataFromProject(projectState = state.project) {
  try {
    return JSON.parse(projectState?.contents?.config || "{}");
  } catch {
    return {};
  }
}

function videoShotsForCanvas(projectState = state.project) {
  const configData = videoConfigDataFromProject(projectState);
  const progressItems = projectState?.videoProgress?.items || [];
  const progressByName = new Map(progressItems.map((item) => [item.name, item]));
  const configShots = Array.isArray(configData.shots) ? configData.shots : [];
  const shots = configShots.length ? configShots : progressItems;
  return shots.map((shot, index) => ({
    ...(progressByName.get(shot.name) || {}),
    ...shot,
    index: shot.index || progressByName.get(shot.name)?.index || index + 1,
  }));
}

function videoNodeFromShot(shot = {}, index = 0, config = {}) {
  const duration = Math.max(4, Math.min(15, Math.round(Number(shot.duration || 5))));
  const safeName = String(shot.name || `shot_${index + 1}`).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);
  const usesProductionBoard = config.promptMode === "production_board" || config.enableStoryboards === true || shot.videoPromptMode === "production_board";
  return {
    id: `video_${safeName || "shot"}_${stableHash(shot.name || index)}`,
    kind: "video",
    source: "project-console",
    projectShotName: shot.name || "",
    x: 120 + (index % 3) * 560,
    y: 120 + Math.floor(index / 3) * 620,
    assets: [
      ...(Array.isArray(shot.refs) ? shot.refs.filter(Boolean) : []),
      ...(usesProductionBoard && Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs.filter(Boolean) : []),
    ],
    prompt: shotPromptText(shot),
    settings: {
      model: videoModelForShot(shot, config),
      ratio: config.ratio || "9:16",
      duration: String(duration),
      resolution: config.resolution || "720p",
      generateAudio: true,
    },
    liveness: { name: "人物素材组", description: "", status: "idle", assetUrl: "" },
    status: "idle",
    statusMessage: "",
    videoUrl: "",
    taskId: "",
    taskProvider: "",
    progress: null,
    startFrameUrl: usesProductionBoard ? "" : shot.startFrameUrl || "",
    tailFrameSourceName: usesProductionBoard ? "" : shot.tailFrameSource || "",
    videoPromptMode: usesProductionBoard ? "production_board" : "prompt",
    storyboardRefs: Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs.filter(Boolean) : [],
    storyboardGuidance: shot.storyboardGuidance || null,
  };
}

function canvasStatusFromProgressItem(item = {}) {
  const status = String(item.status || "").toLowerCase();
  if (status === "complete" || status === "completed") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  return "idle";
}

function mergeProjectProgressIntoCanvasNode(previousNode = {}, node = {}, shot = {}) {
  const nextStatus = canvasStatusFromProgressItem(shot);
  const hasProjectStatus = nextStatus !== "idle" || shot.statusCode !== null && shot.statusCode !== undefined;
  const fileUrl = shot.file?.url || "";
  const completedVideoUrl = nextStatus === "completed" ? fileUrl || shot.videoUrl || previousNode.videoUrl || "" : "";
  const usesProductionBoard = node.videoPromptMode === "production_board" || (Array.isArray(node.storyboardRefs) && node.storyboardRefs.length > 0);
  return {
    ...previousNode,
    ...node,
    prompt: promptHasStoryContent(previousNode.prompt) ? previousNode.prompt : node.prompt,
    status: hasProjectStatus ? nextStatus : previousNode.status || node.status,
    statusMessage: hasProjectStatus ? shot.label || shot.failedReason || "" : previousNode.statusMessage || node.statusMessage,
    videoUrl: completedVideoUrl || (hasProjectStatus && nextStatus !== "completed" ? "" : previousNode.videoUrl || node.videoUrl),
    taskId: shot.taskId || (hasProjectStatus && (nextStatus === "running" || nextStatus === "queued") ? previousNode.taskId || node.taskId : previousNode.taskId || node.taskId),
    taskProvider: shot.provider || previousNode.taskProvider || node.taskProvider,
    progress: hasProjectStatus && shot.progress !== null && shot.progress !== undefined ? shot.progress : previousNode.progress ?? node.progress,
    startFrameUrl: usesProductionBoard ? "" : shot.startFrameUrl || node.startFrameUrl || previousNode.startFrameUrl || "",
    tailFrameSourceName: usesProductionBoard ? "" : node.tailFrameSourceName || previousNode.tailFrameSourceName || "",
    videoPromptMode: node.videoPromptMode || previousNode.videoPromptMode || "",
    storyboardRefs: Array.isArray(node.storyboardRefs) && node.storyboardRefs.length ? node.storyboardRefs : previousNode.storyboardRefs || [],
    storyboardGuidance: node.storyboardGuidance || previousNode.storyboardGuidance || null,
    tailFrameReady: hasProjectStatus ? shot.tailFrameReady === true : previousNode.tailFrameReady,
    tailFrameUrl: shot.tailFrameUrl || previousNode.tailFrameUrl || "",
    tailFrameLocalFile: shot.tailFrameLocalFile || previousNode.tailFrameLocalFile || "",
    tailFrameFileUrl: shot.tailFrameUrl || previousNode.tailFrameFileUrl || "",
    tailFrameMessage: hasProjectStatus && shot.tailFrameReady ? "尾帧已就绪" : previousNode.tailFrameMessage || "",
  };
}

function isBlockingCanvasVideoConfigMissing(item = "") {
  const text = String(item || "").trim();
  if (!text) return false;
  return !/(?:缺少资产图|缺少参考图|引用了未生成资产)/.test(text);
}

function assertCanvasVideoRefsReady(projectState, selectedShots = []) {
  const config = projectState?.videoConfigStatus || {};
  const missing = Array.isArray(config.missing) ? config.missing : [];
  const blockingMissing = missing.filter(isBlockingCanvasVideoConfigMissing);
  if ((!config.ready && !missing.length) || blockingMissing.length) {
    throw new Error(`视频配置还不能生成：${blockingMissing.length ? blockingMissing.join("、") : "请先生成视频配置"}`);
  }
}

async function sendSegmentsToCanvas({ shotName = "", openCanvas = false, silent = false } = {}) {
  if (!state.selectedId) return toast("请先打开一个项目");
  const projectState = state.project || (await api(`/api/project/${state.selectedId}`));
  const config = projectState.videoConfigStatus || {};
  const shots = videoShotsForCanvas(projectState);
  const selectedShots = shotName ? shots.filter((shot) => shot.name === shotName) : shots;
  if (!selectedShots.length) return toast("没有可发送的视频片段，请先生成视频配置");
  const assets = currentCanvasAssetsFromProject();
  assertCanvasVideoRefsReady(projectState, selectedShots);
  const usesProductionBoard = config.promptMode === "production_board" || config.enableStoryboards === true;
  const canvasId = currentVideoCanvasId(projectState);
  const saved = await api(`/api/canvas/state?projectId=${encodeURIComponent(canvasId)}`);
  const previous = saved.state && typeof saved.state === "object" ? saved.state : {};
  const previousNodes = Array.isArray(previous.nodes) ? previous.nodes.filter((node) => node?.id) : [];
  const previousAssets = Array.isArray(previous.assets) ? previous.assets.filter((asset) => asset?.id && asset?.url) : [];
  const assetById = new Map(previousAssets.map((asset) => [asset.id, asset]));
  assets.forEach((asset) => assetById.set(asset.id, mergeCanvasAssetState(assetById.get(asset.id) || {}, asset)));
  const nodeById = new Map(previousNodes.map((node) => [node.id, node]));
  if (usesProductionBoard) {
    assets
      .filter((asset) => /storyboard|production board|分镜/i.test(`${asset.type || ""} ${asset.name || ""}`))
      .forEach((asset, index) => {
        const node = storyboardNodeFromAsset(asset, index);
        nodeById.set(node.id, { ...(nodeById.get(node.id) || {}), ...node });
      });
  }
  const allShots = videoShotsForCanvas(projectState);
  const nodeIdByShotName = new Map();
  allShots.forEach((shot, index) => {
    const node = videoNodeFromShot(shot, shot.index ? Number(shot.index) - 1 : index, config);
    if (shot.name) nodeIdByShotName.set(shot.name, node.id);
  });
  selectedShots.forEach((shot, index) => {
    const node = videoNodeFromShot(shot, shot.index ? Number(shot.index) - 1 : index, config);
    const previousNode = nodeById.get(node.id) || {};
    nodeById.set(node.id, mergeProjectProgressIntoCanvasNode(previousNode, node, shot));
  });
  const nodes = [...nodeById.values()];
  const connectionKeys = new Set();
  const connections = [];
  const pushConnection = (connection) => {
    const from = String(connection?.from || "").trim();
    const to = String(connection?.to || "").trim();
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    if (connectionKeys.has(key)) return;
    connectionKeys.add(key);
    connections.push({ from, to });
  };
  (Array.isArray(previous.connections) ? previous.connections : []).forEach((connection) => {
    if (usesProductionBoard) {
      const fromNode = nodeById.get(String(connection?.from || "").trim());
      const toNode = nodeById.get(String(connection?.to || "").trim());
      if (fromNode?.kind === "video" && toNode?.kind === "video") return;
    }
    pushConnection(connection);
  });
  allShots.forEach((shot) => {
    if (usesProductionBoard) {
      const to = nodeIdByShotName.get(shot.name);
      (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : []).forEach((ref) => {
        pushConnection({ from: storyboardCanvasNodeId(ref), to });
      });
      return;
    }
    if (shot.useTailFrame !== true || !shot.tailFrameSource) return;
    pushConnection({ from: nodeIdByShotName.get(shot.tailFrameSource), to: nodeIdByShotName.get(shot.name) });
  });
  const nextState = {
    ...previous,
    projectId: canvasId,
    nextNodeId: Math.max(Number(previous.nextNodeId || 1), nodes.length + 1),
    viewport: previous.viewport || { x: 0, y: 0, scale: 1 },
    assets: [...assetById.values()],
    nodes,
    connections,
  };
  await api("/api/canvas/state", { method: "POST", body: JSON.stringify(nextState) });
  if (!silent) toast(shotName ? "已发送该片段到画布" : `已发送 ${selectedShots.length} 个片段到画布`);
  if (openCanvas) window.location.href = canvasProjectHref();
}

async function generateVideoSegment(shotName = "", { forceRegenerate = false } = {}) {
  if (!state.selectedId) return toast("请先打开一个项目");
  const cleanShotName = String(shotName || "").trim();
  if (!cleanShotName) return toast("缺少视频片段");
  if (userHasCanvasPermission()) {
    await sendSegmentsToCanvas({ shotName: cleanShotName, openCanvas: false, silent: true });
  }
  toast(userHasCanvasPermission() ? "已发送到画布并提交视频生成，留在操作台等待结果" : "已提交视频生成，留在操作台等待结果");
  const data = await api(`/api/project/${state.selectedId}/video-generate`, {
    method: "POST",
    body: JSON.stringify({ shotName: cleanShotName, forceRegenerate }),
  });
  setProjectState(data.state);
  renderWorkspace();
  setStudioTab("video", { persist: false });
  scheduleProjectRefresh();
}

async function generateAllVideoSegments() {
  if (!state.selectedId) return toast("请先打开一个项目");
  const configStatus = state.project?.videoConfigStatus || {};
  if (!configStatus.exists || configStatus.ready === false || (Array.isArray(configStatus.missing) && configStatus.missing.length)) {
    const missing = Array.isArray(configStatus.missing) && configStatus.missing.length ? `：${configStatus.missing.join("、")}` : "，请先生成视频配置";
    return toast(`批量视频未启动，参考图验证未通过${missing}`);
  }
  if (userHasCanvasPermission()) {
    await sendSegmentsToCanvas({ openCanvas: false, silent: true });
  }
  toast(userHasCanvasPermission() ? "已发送全部片段到画布，正在启动顺序生成队列" : "正在启动顺序生成队列");
  const data = await api(`/api/project/${state.selectedId}/video-generate-all`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  setProjectState(data.state);
  renderWorkspace();
  setStudioTab("video", { persist: false });
  scheduleProjectRefresh();
  toast(data.result?.message || `批量生成队列已启动：${data.result?.completed || 0}/${data.result?.total || 0}`);
}

function renderFinalCut(finalCut = null) {
  const fc = finalCut || state.project?.finalCut || {};
  const statusEl = $("#finalCutStatus");
  const previewEl = $("#finalCutPreview");
  const btn = $("#assembleFinalCutBtn");
  if (!statusEl || !previewEl) return;
  const running = !!fc.running;
  if (btn) {
    btn.disabled = running;
    btn.classList.add("primary");
    btn.classList.remove("ghost");
    btn.textContent = running ? "组装中…" : fc.output ? "重新组装" : "组装成片";
  }
  if (fc.error) {
    statusEl.innerHTML = `<span class="pill warn">组装失败</span><span>${escapeHtml(fc.error)}</span>`;
  } else if (running) {
    statusEl.innerHTML = `<span class="pill active">组装中 ${Number(fc.progress) || 0}%</span><span>${escapeHtml(fc.message || "")}</span>`;
  } else if (fc.output) {
    statusEl.innerHTML = `<span class="pill ok">成片就绪</span><span>${escapeHtml(fc.message || "已生成完整成片")}</span>`;
  } else {
    statusEl.innerHTML = `<span class="pill">未组装</span><span>先生成全部片段，再组装成片。</span>`;
  }
  // 预览用签名守卫，避免轮询反复重建 <video> 导致重载/闪烁
  const sig = JSON.stringify([fc.output?.url || "", fc.output?.updatedAt || ""]);
  if (previewEl.dataset.fcSig !== sig) {
    previewEl.dataset.fcSig = sig;
    previewEl.innerHTML = fc.output
      ? `<div class="final-cut-video">
           <video src="${escapeHtml(fc.output.url)}" controls playsinline preload="metadata"></video>
           <a class="video-download-button" href="${escapeHtml(fc.output.downloadUrl || fc.output.url)}" download title="下载成片" aria-label="下载成片">
             <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>
           </a>
         </div>`
      : `<div class="final-cut-placeholder" role="img" aria-label="尚未生成成片，先生成全部视频片段，再组装成片">
           <svg viewBox="0 0 24 24" aria-hidden="true">
             <rect x="5" y="3" width="14" height="18" rx="2"></rect>
             <path d="m10 9 5 3-5 3V9Z"></path>
           </svg>
           <span>先生成全部视频片段，再组装成片</span>
         </div>`;
  }
}

async function assembleFinalCut() {
  if (!state.selectedId) throw new Error("请先打开一个项目");
  const data = await api(`/api/project/${state.selectedId}/assemble-final-cut`, { method: "POST", body: JSON.stringify({}) });
  toast(data.result?.message || "已开始组装成片");
  if (data.state) setProjectState(data.state);
  renderWorkspace();
  scheduleProjectRefresh();
}

function renderVideoProgress(progress) {
  const total = progress.total || progress.items?.length || 0;
  const completed = progress.completed || 0;
  const config = videoConfigDataFromProject();
  const usesProductionBoard = config.settings?.promptMode === "production_board" || config.settings?.enableStoryboards === true || config.promptMode === "production_board" || config.enableStoryboards === true;
  const activeItem = (progress.items || []).find((item) => item.status === "running") || (progress.items || []).find((item) => item.status === "queued");
  const activeName = progress.queue?.currentShotName || activeItem?.name || "";
  const queueNotice = ["blocked", "failed"].includes(String(progress.queue?.status || "").toLowerCase())
    ? progress.queue?.error || progress.queue?.message || ""
    : "";
  const statusLabel = queueNotice || (progress.running
    ? activeName
      ? `生成中：${activeName}`
      : "生成中"
    : progress.queued
      ? activeName
        ? `排队中：${activeName}`
        : "排队中"
      : statusText(progress.jobStatus) || "待生成");
  const node = $("#videoProgressList");
  const videoSig = JSON.stringify({
    total,
    statusLabel,
    running: progress.running ? 1 : 0,
    completed,
    queueStatus: progress.queue?.status || "",
    queueError: progress.queue?.error || "",
    queueMessage: progress.queue?.message || "",
    items: (progress.items || []).map((it) => [
      it.index, it.name, it.status, it.label, it.progress,
      it.file ? 1 : 0, it.taskId || "", it.tailFrameReady ? 1 : 0,
      it.failedReason || "", (it.refs || []).length, (it.storyboardRefs || []).length,
    ]),
  });
  // Skip the teardown when nothing changed so the 2s poll loop stops thrashing.
  if (node.dataset.renderSig === videoSig && node.childElementCount > 0) return;
  $("#videoProgressSummary").innerHTML = total
    ? `
      <div>
        <strong>${completed}/${total}</strong>
        <span>片段完成</span>
      </div>
      <div class="mini-meter"><i style="width:${Math.round((completed / total) * 100)}%"></i></div>
      <span class="video-progress-state ${progress.running ? "is-running" : queueNotice ? "is-error" : progress.queued ? "is-queued" : "is-idle"}" aria-label="${escapeAttr(statusLabel)}"></span>
    `
    : `<div class="pill">先生成视频配置后显示片段进度</div>`;

  // Preserve scroll across the rebuild (restored synchronously below so the
  // jump to top never paints), matching the asset gallery fix.
  const scroller = getScrollableAncestor(node);
  const prevScroll = scroller ? scroller.scrollTop : 0;
  node.dataset.renderSig = videoSig;
  node.innerHTML = "";
  if (!total) return;
  for (const rawItem of progress.items || []) {
    const item = { ...rawItem };
    const card = document.createElement("article");
    const stateName = ["running", "queued", "complete", "failed", "waiting"].includes(item.status) ? item.status : "waiting";
    const stateLabel = item.label || statusText(item.status);
    card.className = `segment-card ${progressClass(item.status)} segment-state-${stateName}`;
    const hasProgress =
      item.progress !== null &&
      item.progress !== undefined &&
      item.progress !== "" &&
      Number.isFinite(Number(item.progress));
    const progressWidth = hasProgress ? Math.max(0, Math.min(100, Number(item.progress))) : 0;
    // 已生成片段的预览入口统一收敛到下方主操作按钮(见 action),这里不再重复放「预览」字样。
    const segmentIsComplete = item.status === "complete" && !!item.file;
    const lastJob = item.lastJobStatus && item.status !== "running" ? `<span>${statusText(item.lastJobStatus)}</span>` : "";
    const taskMeta = item.taskId
      ? `<span class="segment-task-id" title="${escapeAttr(item.taskId)}">任务 ${escapeHtml(shortUuid(item.taskId))}</span>`
      : item.status === "running"
        ? `<span class="segment-task-id muted">等待任务号</span>`
        : "";
    const tailFrameMeta =
      usesProductionBoard && (item.storyboardRefs || []).length
        ? `<span class="segment-task-id ok">Production Board</span>`
        : item.status === "complete" && item.tailFrameReady
          ? `<span class="segment-task-id ok">尾帧就绪</span>`
          : item.status === "running" && /尾帧|下载|抽取/.test(String(item.label || ""))
            ? `<span class="segment-task-id active">尾帧处理中</span>`
          : item.status === "queued"
            ? `<span class="segment-task-id active">等待前序完成</span>`
            : "";
    const failureReason =
      item.status === "failed" && item.failedReason
        ? `<div class="segment-error" title="${escapeAttr(item.failedReason)}">${escapeHtml(item.failedReason)}</div>`
        : "";
    const stateIndicator = `<span class="segment-status-indicator" role="img" aria-label="${escapeAttr(stateLabel)}"></span>`;
    const action = item.status === "running" || item.status === "queued"
      ? `<button class="segment-state-button" type="button" disabled aria-label="${escapeAttr(stateLabel)}"><span aria-hidden="true"></span></button>`
      : segmentIsComplete
        ? `<button class="primary small" type="button" data-segment-preview="${escapeAttr(item.name)}">预览</button>`
        : item.status === "failed"
          ? `<button class="ghost small" type="button" data-segment-edit-prompt="${escapeAttr(item.name)}">修改提示词</button>`
        : `<button class="primary small" type="button" data-segment-generate="${escapeAttr(item.name)}">生成</button>`;
    card.innerHTML = `
      <div class="segment-top">
        <span class="segment-index">${renderNodeBeacon(item.status === "running", `正在生成 ${item.name}`)}V${String(item.index).padStart(2, "0")}</span>
        ${stateIndicator}
      </div>
      <div class="segment-meta">
        <span>${item.duration || "-"}s</span>
        <span>${(item.refs || []).length} refs</span>
      </div>
      </div>
      ${failureReason}
      <div class="meter ${item.status === "running" && !hasProgress ? "indeterminate" : ""}">
        <i style="width:${progressWidth}%"></i>
      </div>
      <div class="segment-actions">
        ${action}
      </div>
    `;
    card.querySelector("[data-segment-generate]")?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      withStudioButtonFeedback(button, () => generateVideoSegment(item.name)).catch((error) => {
        toast(error.message);
        if (state.selectedId) loadProject(state.selectedId, { openStudio: false }).catch(() => {});
      });
    });
    card.querySelector("[data-segment-preview]")?.addEventListener("click", () => openVideoPreview(item));
    card.querySelector("[data-segment-edit-prompt]")?.addEventListener("click", () => selectVideoForInspector(item.name));
    node.appendChild(card);
  }
  renderVideoPromptInspector();
  if (scroller && prevScroll) {
    scroller.scrollTop = prevScroll;
    requestAnimationFrame(() => {
      scroller.scrollTop = prevScroll;
    });
  }
}

async function saveFile(key) {
  const map = {
    script: "#scriptText",
    assetDescription: "#assetDescriptionText",
    storyboard: "#storyboardText",
    assetManifest: "#assetManifestText",
    assetPrompts: "#assetPromptsText",
    seedancePrompts: "#seedanceText",
    config: "#configText",
  };
  await api(`/api/project/${state.selectedId}/file`, {
    method: "POST",
    body: JSON.stringify({ key, content: $(map[key]).value }),
  });
  // 保存剧情(剧本)时顺带保存「资产描述」——两个框同在剧本面板,避免用户以为一起存了却丢失。
  if (key === "script") {
    const assetDescEl = $("#assetDescriptionText");
    if (assetDescEl) {
      await api(`/api/project/${state.selectedId}/file`, {
        method: "POST",
        body: JSON.stringify({ key: "assetDescription", content: assetDescEl.value }),
      });
    }
  }
  toast("已保存");
  await loadProject(state.selectedId, { openStudio: false });
}

async function saveFileQuiet(key) {
  const map = {
    script: "#scriptText",
    storyboard: "#storyboardText",
    assetManifest: "#assetManifestText",
    assetPrompts: "#assetPromptsText",
    seedancePrompts: "#seedanceText",
    config: "#configText",
  };
  await api(`/api/project/${state.selectedId}/file`, {
    method: "POST",
    body: JSON.stringify({ key, content: $(map[key]).value }),
  });
}

async function saveAssetManifest({ confirm = false } = {}) {
  if (!state.selectedId) return;
  let manifest;
  try {
    manifest = JSON.parse($("#assetManifestText").value || "{}");
  } catch {
    throw new Error("资产解析 JSON 格式不正确");
  }
  const data = await api(`/api/project/${state.selectedId}/asset-manifest`, {
    method: "POST",
    body: JSON.stringify({ manifest, confirm }),
  });
  setProjectState(data);
  renderWorkspace();
  toast(confirm ? "资产解析已确认，资产提示词已同步" : "资产解析已保存，资产提示词已同步");
}

async function toggleManifestAssetGeneration(assetId) {
  if (!state.selectedId) return;
  const id = String(assetId || "").trim();
  if (!id) return;
  const manifest = JSON.parse(JSON.stringify(state.project?.assetManifest || {}));
  if (!Array.isArray(manifest.items)) throw new Error("还没有资产解析结果");
  const item = manifest.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`找不到资产：${id}`);
  item.generate = item.generate === false;
  if (!item.generate) state.selectedAssetIds.delete(id);
  $("#assetManifestText").value = JSON.stringify(manifest, null, 2);
  const data = await api(`/api/project/${state.selectedId}/asset-manifest`, {
    method: "POST",
    body: JSON.stringify({ manifest, confirm: false }),
  });
  setProjectState(data);
  renderAssetsFromState();
  renderAssetManifest(state.project?.assetManifest || null);
  toast(item.generate ? "已加入生成队列" : "已设为不生成");
}

async function extractAssets() {
  if (!state.selectedId) return;
  // 关键:先捕获两个输入框的当前值,再做 setWorkspaceMode/saveFile/renderWorkspace。
  // 否则 renderWorkspace 会用已存内容(可能为空或旧值)重刷输入框,冲掉用户刚粘贴、尚未保存的资产描述,
  // 导致"资产文本消失"、且提取退回用剧本(只出剧本里的人物、丢场景)。
  const capturedScriptText = $("#scriptText")?.value || "";
  const capturedAssetDescriptionText = $("#assetDescriptionText")?.value || "";
  // 资产提取是独立入口:无论用户此前停留在哪个工作区,提交和刷新后都留在资产解析面板。
  setWorkspaceMode("assets");
  const assetAnalyzerModel = document.querySelector("input[name='assetAnalyzerModel']:checked")?.value || state.assetAnalyzerModel || "claude-opus-4-8";
  state.assetAnalyzerModel = normalizeAssetAnalyzerModel(assetAnalyzerModel);
  localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);
  await saveFileQuiet("script");
  state.uiBusy.assetExtracting = true;
  renderWorkspace();
  toast("正在提取人物和场景");
  try {
    const data = await api(`/api/project/${state.selectedId}/asset-extract`, {
      method: "POST",
      body: JSON.stringify({
        scriptText: capturedScriptText,
        assetDescriptionText: capturedAssetDescriptionText,
        assetAnalyzerModel: state.assetAnalyzerModel,
        dialogueLanguage: state.dialogueLanguage,
      }),
    });
    setProjectState(data.state);
    const extracted = data.result?.extracted || {};
    toast(`已提取人物 ${extracted.characters?.length || 0} 个，场景 ${extracted.scenes?.length || 0} 个`);
  } finally {
    state.uiBusy.assetExtracting = false;
    setWorkspaceMode("assets");
    renderWorkspace();
  }
}

async function uploadBoundAsset(event) {
  event.preventDefault();
  if (!state.selectedId) return;
  const file = $("#assetUploadFile")?.files?.[0];
  if (!file) return toast("请选择资产图文件");
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return toast("只支持 PNG / JPG / WEBP");
  const mode = assetUploadMode();
  const target = $("#assetUploadTarget")?.value || "";
  const label = $("#assetUploadLabel")?.value.trim() || "";
  if (mode === "bind" && !target) return toast("请选择要绑定的资产");
  if (mode === "local" && !label) return toast("请填写资产名称");
  const data = await api(`/api/project/${state.selectedId}/${mode === "local" ? "asset-upload-local" : "asset-upload"}`, {
    method: "POST",
    body: JSON.stringify({
      ...(mode === "local" ? { label, type: $("#assetUploadType")?.value || "Prop" } : { assetId: target }),
      filename: file.name,
      contentBase64: await fileBase64(file),
    }),
  });
  setProjectState(data.state);
  if (mode === "bind") state.assetUploadTargetId = target;
  if (mode === "local") $("#assetUploadLabel").value = "";
  $("#assetUploadFile").value = "";
  $("#assetUploadName").textContent = "PNG / JPG / WEBP";
  renderWorkspace();
  toast(data.result?.message || (mode === "local" ? "本地资产已添加" : "资产图已绑定"));
}

async function uploadAssetStyleReference(event) {
  const file = event.target.files?.[0];
  if (!file || !state.selectedId) return;
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
    event.target.value = "";
    return toast("只支持 PNG / JPG / WEBP");
  }
  const data = await api(`/api/project/${state.selectedId}/asset-style-reference`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      contentBase64: await fileBase64(file),
      enabled: true,
    }),
  });
  setProjectState(data.state);
  event.target.value = "";
  renderWorkspace();
  toast(data.result?.message || "资产风格参考图已上传");
}

async function setAssetStyleReferenceEnabled(enabled) {
  if (!state.selectedId) return;
  const data = await api(`/api/project/${state.selectedId}/asset-style-reference`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
  setProjectState(data.state);
  renderWorkspace();
  toast(data.result?.message || (enabled ? "已启用资产风格参考图" : "已停用资产风格参考图"));
}

async function removeAssetStyleReference() {
  if (!state.selectedId) return;
  const data = await api(`/api/project/${state.selectedId}/asset-style-reference`, {
    method: "POST",
    body: JSON.stringify({ remove: true }),
  });
  setProjectState(data.state);
  renderWorkspace();
  toast(data.result?.message || "已移除资产风格参考图");
}

async function uploadStoryboardAsset(event) {
  event.preventDefault();
  if (!state.selectedId) return;
  const target = $("#storyboardUploadTarget")?.value || "";
  const file = $("#storyboardUploadFile")?.files?.[0];
  if (!target) return toast("请选择要绑定的 Production Board");
  if (!file) return toast("请选择 Production Board 图片文件");
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return toast("只支持 PNG / JPG / WEBP");
  const data = await api(`/api/project/${state.selectedId}/storyboard-upload`, {
    method: "POST",
    body: JSON.stringify({
      storyboardId: target,
      filename: file.name,
      contentBase64: await fileBase64(file),
    }),
  });
  setProjectState(data.state);
  $("#storyboardUploadFile").value = "";
  $("#storyboardUploadName").textContent = "PNG / JPG / WEBP";
  renderWorkspace();
  toast(data.result?.message || "Production Board 已绑定");
}

async function startJob(type) {
  if (type === "assets" || type === "assets-dry-run") {
    if (type === "assets" && !(state.project?.assetManifest?.items?.length)) {
      return toast("请先提取资产，再生成资产图");
    }
  }
  if (type === "storyboards" || type === "storyboards-dry-run") {
    await saveFileQuiet("storyboard");
    await saveFileQuiet("seedancePrompts");
  }
  const body = { type };
  if (type === "assets" || type === "assets-dry-run") {
    body.quality = $("#assetQuality").value;
    body.assetRange = $("#assetGenerateRange")?.value || "missing";
    Object.assign(body, assetStylePayload());
    if (body.assetRange === "selected") {
      body.assetNames = [...state.selectedAssetIds];
      if (!body.assetNames.length) return toast("请先勾选要生成的资产");
    }
    const optimisticTargets = body.assetRange === "selected"
      ? body.assetNames
      : assetNamesForRange(body.assetRange, state.project?.assetSlots || []);
    if (type === "assets" && !optimisticTargets.length) return toast("没有需要生成的资产");
    optimisticTargets.forEach((name) => {
      state.optimisticAssetJobs.set(name, { startedAt: Date.now(), type });
    });
    renderAssetsFromState();
  }
  if (type === "storyboards" || type === "storyboards-dry-run") {
    body.quality = $("#assetQuality")?.value || "1k";
    body.storyboardRange = $("#storyboardGenerateRange")?.value || "missing";
    body.dialogueLanguage = state.dialogueLanguage;
  }
  const data = await api(`/api/project/${state.selectedId}/job`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  state.activeJobId = data.job.id;
  toast("任务已启动");
  scheduleProjectRefresh({ immediate: true });
}

async function generateDraft() {
  if (!state.selectedId) throw new Error("请先打开一个项目");
  if (isDraftGenerating()) return;
  const dialogueLanguage = document.querySelector("input[name='draftDialogueLanguage']:checked")?.value || "en";
  const assetAnalyzerModel = document.querySelector("input[name='assetAnalyzerModel']:checked")?.value || "claude-opus-4-8";
  state.assetAnalyzerModel = normalizeAssetAnalyzerModel(assetAnalyzerModel);
  localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);
  state.uiBusy.draftGenerating = true;
  renderWorkspace();
  toast("正在生成分镜草稿");
  try {
    await saveFileQuiet("script");
    const data = await api(`/api/project/${state.selectedId}/draft`, {
      method: "POST",
      body: JSON.stringify({ dialogueLanguage, assetAnalyzerModel: state.assetAnalyzerModel }),
    });
    setProjectState(data.state);
    toast("分镜和提示词草稿已生成");
  } finally {
    state.uiBusy.draftGenerating = false;
    renderWorkspace();
  }
}

async function changeDialogueLanguage(targetLanguage) {
  if (!state.selectedId || state.hydrating) return;
  const previous = state.dialogueLanguage;
  state.dialogueLanguage = targetLanguage === "zh" ? "zh" : "en";
  localStorage.setItem("pixelToys.dialogueLanguage", state.dialogueLanguage);
  const assetAnalyzerModel = document.querySelector("input[name='assetAnalyzerModel']:checked")?.value || state.assetAnalyzerModel || "claude-opus-4-8";
  state.assetAnalyzerModel = normalizeAssetAnalyzerModel(assetAnalyzerModel);
  localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);
  const scriptText = $("#scriptText").value;
  toast(state.dialogueLanguage === "zh" ? "正在转换为中文对白" : "正在转换为英文对白");
  try {
    const data = await api(`/api/project/${state.selectedId}/dialogue-language`, {
      method: "POST",
      body: JSON.stringify({
        targetLanguage: state.dialogueLanguage,
        scriptText,
        assetAnalyzerModel: state.assetAnalyzerModel,
        assumeEnglish: state.assumeEnglishDialogue === true,
      }),
    });
    setProjectState(data.state);
    $("#scriptText").value = data.state?.contents?.script || scriptText;
    renderWorkspace();
    if (data.result?.skipped) {
      toast(data.result.skipReason === "manual" ? "剧本已标记为英文对白,跳过翻译" : "检测到剧本已是英文对白,跳过翻译");
    } else {
      toast(`已转换 ${data.result?.count || 0} 段对白`);
    }
  } catch (error) {
    state.dialogueLanguage = previous;
    localStorage.setItem("pixelToys.dialogueLanguage", previous);
    const previousInput = document.querySelector(`input[name='draftDialogueLanguage'][value='${CSS.escape(previous)}']`);
    if (previousInput) previousInput.checked = true;
    if (error.status === 422) {
      toast("已阻止,未改动");
      return;
    }
    throw error;
  }
}

async function buildConfig() {
  const button = $("#buildConfigBtn");
  const originalLabel = button?.textContent || "生成视频配置";
  if (button) {
    button.disabled = true;
    button.textContent = "生成中...";
  }
  try {
    await refreshVideoConfig({ silent: false });
    setWorkflowFocus("script");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function refreshVideoConfig({ silent } = { silent: false }) {
  await saveFileQuiet("seedancePrompts");
  const project = state.project?.project || {};
  const assetAnalyzerModel = document.querySelector("input[name='assetAnalyzerModel']:checked")?.value || state.assetAnalyzerModel || "claude-opus-4-8";
  state.assetAnalyzerModel = normalizeAssetAnalyzerModel(assetAnalyzerModel);
  localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);
  const data = await api(`/api/project/${state.selectedId}/config`, {
    method: "POST",
    body: JSON.stringify({
      groupName: $("#configGroup").value.trim(),
      modelName: normalizeVideoModelName($("#configModel").value || project.model),
      resolution: $("#configResolution").value || "480p",
      ratio: $("#configRatio").value || "9:16",
      promptMode: $("#configPromptMode")?.value || "prompt",
      assetAnalyzerModel: state.assetAnalyzerModel,
      dialogueLanguage: state.dialogueLanguage,
      enableStoryboards: ($("#configPromptMode")?.value || "prompt") === "production_board",
      tailFrameContinuity: ($("#configPromptMode")?.value || "prompt") !== "production_board",
    }),
  });
  setProjectState(data.state);
  renderWorkspace();
  if (!silent) {
    const status = data.state?.videoConfigStatus;
    toast(status?.ready ? "视频配置已生成，可提交" : `视频配置已生成，但还缺：${(status?.missing || []).join("、")}`);
  }
}

function renderSeriesPreflightResult(result = {}) {
  const target = $("#seriesPreflightResult");
  if (!target) return;
  const bible = result.seriesBible || {};
  const list = (items = []) => items.length ? items.map((item) => `<li>${escapeHtml(item.name)}</li>`).join("") : "<li>未识别</li>";
  target.classList.remove("hidden");
  target.innerHTML = `
    <div class="series-preflight-head">
      <strong>${escapeHtml(result.title || "短剧预检")}</strong>
      <span>${escapeHtml(result.summary || "")}</span>
    </div>
    <div class="series-preflight-grid">
      <section>
        <h3>角色</h3>
        <ul>${list(bible.characters || [])}</ul>
      </section>
      <section>
        <h3>场景</h3>
        <ul>${list(bible.locations || [])}</ul>
      </section>
      <section>
        <h3>道具</h3>
        <ul>${list(bible.props || [])}</ul>
      </section>
    </div>
    <p>${escapeHtml(result.executionPlan?.nextStep || "预检只生成结构草案，不触发资产图或视频生成。")}</p>
  `;
}

async function runSeriesPreflight() {
  const formNode = $("#projectForm");
  const button = $("#seriesPreflightButton");
  const status = $("#projectCreateStatus");
  if (!formNode || !button) return;
  const originalLabel = button.textContent;
  const form = new FormData(formNode);
  const payload = Object.fromEntries(form.entries());
  try {
    button.disabled = true;
    button.textContent = "预检中...";
    if (status) status.textContent = "正在拆解短剧结构和核心资产候选，不会触发生图或视频生成。";
    const data = await api("/api/series-preflight", { method: "POST", body: JSON.stringify(payload) });
    renderSeriesPreflightResult(data.result || {});
    toast("短剧预检完成");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
    if (status) status.textContent = "";
  }
}

function bind() {
  bindStudioButtonFeedback();
  $("#refreshProjects").addEventListener("click", () => loadProjects(false).catch((error) => toast(error.message)));
  $("#logoutButton")?.addEventListener("click", () => logout().catch((error) => toast(error.message)));
  $("#changePasswordButton")?.addEventListener("click", openChangePasswordDialog);
  $("#changePasswordForm")?.addEventListener("submit", (event) => submitPasswordChange(event).catch((error) => toast(error.message)));
  document.querySelector("[data-close-password]")?.addEventListener("click", closeChangePasswordDialog);
  $("#openNewProject").addEventListener("click", openProjectModal);
  $("#exploreHome")?.addEventListener("click", (event) => {
    const scope = event.target.closest("[data-explore-scope]")?.dataset.exploreScope;
    if (scope) {
      state.exploreScopeFilter = scope;
      state.exploreCanvasFilter = "all";
      renderExploreHome();
      return;
    }
    const projectTeamId = event.target.closest("[data-project-team]")?.dataset.projectTeam;
    if (projectTeamId) return moveProjectToTeam(projectTeamId).catch((error) => toast(error.message));
    const projectDuplicateId = event.target.closest("[data-project-duplicate-personal]")?.dataset.projectDuplicatePersonal;
    if (projectDuplicateId) return duplicateProjectAsPersonal(projectDuplicateId).catch((error) => toast(error.message));
    const projectDeleteId = event.target.closest("[data-project-delete-home]")?.dataset.projectDeleteHome;
    if (projectDeleteId) {
      const project = state.projects.find((item) => item.id === projectDeleteId);
      if (!project) return;
      return deleteProject(project).catch((error) => toast(error.message));
    }
    const canvasTeamId = event.target.closest("[data-canvas-team]")?.dataset.canvasTeam;
    if (canvasTeamId) return moveBlankCanvasToTeam(canvasTeamId).catch((error) => toast(error.message));
    const canvasDuplicateId = event.target.closest("[data-canvas-duplicate-personal]")?.dataset.canvasDuplicatePersonal;
    if (canvasDuplicateId) return duplicateBlankCanvasAsPersonal(canvasDuplicateId).catch((error) => toast(error.message));
    const canvasDeleteId = event.target.closest("[data-canvas-delete-home]")?.dataset.canvasDeleteHome;
    if (canvasDeleteId) return deleteBlankCanvasFromHome(canvasDeleteId).catch((error) => toast(error.message));
    const tool = event.target.closest("[data-explore-tool]")?.dataset.exploreTool;
    if (tool) return openExploreTool(tool).catch((error) => toast(error.message));
    if (event.target.closest("[data-explore-canvas-home]")) {
      state.exploreCanvasFilter = "all";
      state.exploreScopeFilter = "all";
      showExploreCanvasHome();
      return;
    }
    const filter = event.target.closest("[data-explore-filter]")?.dataset.exploreFilter;
    if (filter) {
      state.exploreCanvasFilter = filter;
      showExploreCanvasHome();
      return;
    }
    const canvasId = event.target.closest("[data-explore-canvas]")?.dataset.exploreCanvas;
    if (canvasId) {
      window.location.href = `/canvas.html?canvas=${encodeURIComponent(canvasId)}`;
      return;
    }
    const projectId = event.target.closest("[data-explore-project]")?.dataset.exploreProject;
    if (projectId) return loadProject(projectId).catch((error) => toast(error.message));
    if (event.target.closest("[data-explore-new-project]")) return openProjectModal();
    if (event.target.closest("[data-explore-canvas-new]")) return openBlankCanvasProject();
  });
  bindSuperPixel();
  $("#exploreRefresh")?.addEventListener("click", () => loadProjects(false).catch((error) => toast(error.message)));
  $("#exploreAccount")?.addEventListener("click", openPersonalCenter);
  $("[data-close-personal-center]")?.addEventListener("click", closePersonalCenter);
  $("#personalCenterPasswordButton")?.addEventListener("click", () => {
    closePersonalCenter();
    openChangePasswordDialog();
  });
  $("#personalCenterLogoutButton")?.addEventListener("click", () => logout().catch((error) => toast(error.message)));
  $("#exploreTeamButton")?.addEventListener("click", () => {
    state.teamPanelOpen = !state.teamPanelOpen;
    renderTeamPanel();
  });
  $("#closeTeamPanel")?.addEventListener("click", () => {
    state.teamPanelOpen = false;
    renderTeamPanel();
  });
  $("#teamCreateForm")?.addEventListener("submit", (event) => createTeam(event).catch((error) => toast(error.message)));
  $("#teamJoinForm")?.addEventListener("submit", (event) => joinTeam(event).catch((error) => toast(error.message)));
  $("#leaveTeamButton")?.addEventListener("click", () => leaveTeam().catch((error) => toast(error.message)));
  $("#teamPanel")?.addEventListener("click", (event) => {
    const projectButton = event.target.closest("[data-team-open-project]");
    if (projectButton) {
      return openTeamProgressProject(projectButton.dataset.teamOpenProject, projectButton.dataset.teamStage).catch((error) => toast(error.message));
    }
    if (event.target.closest("[data-team-generate-invite]")) return generateTeamInvite().catch((error) => toast(error.message));
    if (event.target.closest("[data-team-revoke-invite]")) return revokeTeamInvite().catch((error) => toast(error.message));
    const removeId = event.target.closest("[data-team-remove]")?.dataset.teamRemove;
    if (removeId) return removeTeamMember(removeId).catch((error) => toast(error.message));
    const transferId = event.target.closest("[data-team-transfer]")?.dataset.teamTransfer;
    if (transferId) return transferTeamOwnership(transferId).catch((error) => toast(error.message));
  });
  $("#teamResourceButton")?.addEventListener("click", () => {
    state.teamResourcePanelOpen = !state.teamResourcePanelOpen;
    if (state.teamResourcePanelOpen && !state.teamResources.length) {
      loadTeamResources(state.teamResourceType).catch((error) => toast(error.message));
    } else {
      renderTeamResourcePanel();
    }
  });
  $("#teamResourcePanel")?.addEventListener("click", (event) => {
    const type = event.target.closest("[data-team-resource-type]")?.dataset.teamResourceType;
    if (type) return loadTeamResources(type).catch((error) => toast(error.message));
    const indexRaw = event.target.closest("[data-team-resource-index]")?.dataset.teamResourceIndex;
    if (indexRaw !== undefined) return referenceTeamResource(state.teamResources[Number(indexRaw)]).catch((error) => toast(error.message));
    const referenceId = event.target.closest("[data-team-reference-update]")?.dataset.teamReferenceUpdate;
    if (referenceId) return updateTeamReference(referenceId).catch((error) => toast(error.message));
  });
  $("#exploreProjectSearch")?.addEventListener("input", (event) => {
    state.exploreProjectSearch = event.currentTarget.value;
    renderExploreHome();
  });
  $("#imageExploreComposer")?.addEventListener("submit", (event) => submitImageExploreGeneration(event).catch((error) => toast(error.message)));
  $("#imageExplorePrompt")?.addEventListener("input", (event) => {
    state.imageStudio.prompt = event.currentTarget.value;
  });
  $("#imageExploreModel")?.addEventListener("change", (event) => {
    state.imageStudio.model = event.currentTarget.value || "gpt-image-2";
  });
  $("#imageExploreStoryboardToggle")?.addEventListener("click", () => {
    state.imageStudio.storyboardMode = !state.imageStudio.storyboardMode;
    renderImageExploreView();
  });
  $("#imageExploreStoryboardCount")?.addEventListener("change", (event) => {
    state.imageStudio.storyboardCount = Math.max(1, Math.min(4, Number(event.currentTarget.value) || 1));
    renderImageExploreView();
  });
  $("#imageExploreReference")?.addEventListener("change", (event) => uploadImageExploreReferences(event).catch((error) => toast(error.message)));
  $("#imageExploreClear")?.addEventListener("click", clearImageExploreHistory);
  $("#imageExploreCountDown")?.addEventListener("click", () => {
    state.imageStudio.count = Math.max(1, state.imageStudio.count - 1);
    renderImageExploreView();
  });
  $("#imageExploreCountUp")?.addEventListener("click", () => {
    state.imageStudio.count = Math.min(4, state.imageStudio.count + 1);
    renderImageExploreView();
  });
  $("#imageExploreView")?.addEventListener("click", (event) => {
    const referenceAddId = event.target.closest("[data-image-reference-add]")?.dataset.imageReferenceAdd;
    if (referenceAddId) {
      const item = state.imageStudio.history.find((entry) => entry.id === referenceAddId)
        || state.imageStudio.storyboardHistory.find((entry) => entry.id === referenceAddId);
      if (item?.status === "completed") addImageExploreReferenceFromResult(item);
      return;
    }
    const referenceId = event.target.closest("[data-image-reference-remove]")?.dataset.imageReferenceRemove;
    if (referenceId) {
      const reference = state.imageStudio.references.find((item) => item.id === referenceId);
      if (reference?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(reference.previewUrl);
      state.imageStudio.references = state.imageStudio.references.filter((reference) => reference.id !== referenceId);
      renderImageExploreView();
      return;
    }
    const storyboardRemoveId = event.target.closest("[data-storyboard-remove]")?.dataset.storyboardRemove;
    if (storyboardRemoveId) {
      const removed = state.imageStudio.storyboardHistory.find((item) => item.id === storyboardRemoveId);
      if (removed?.taskId) {
        const recoveryIds = readImageExploreStoryboardRecovery(state.authUser);
        recoveryIds.add(removed.taskId);
        persistImageExploreStoryboardRecovery(recoveryIds);
      }
      state.imageStudio.storyboardHistory = state.imageStudio.storyboardHistory.filter((item) => item.id !== storyboardRemoveId);
      persistImageExploreStoryboardHistory();
      renderImageExploreView();
      return;
    }
    const imageId = event.target.closest("[data-image-history-remove]")?.dataset.imageHistoryRemove;
    if (imageId) {
      state.imageStudio.history = state.imageStudio.history.filter((item) => item.id !== imageId);
      persistImageExploreHistory();
      renderImageExploreView();
      return;
    }
    const regenerateId = event.target.closest("[data-image-regenerate]")?.dataset.imageRegenerate;
    if (regenerateId) {
      if (state.imageStudio.referencesUploading > 0) { toast("参考图上传中，请稍候"); return; }
      const target = state.imageStudio.history.find((entry) => entry.id === regenerateId);
      const storyboardTarget = state.imageStudio.storyboardHistory.find((entry) => entry.id === regenerateId);
      if (storyboardTarget) {
        if (!String(storyboardTarget.prompt || "").trim()) {
          retryImageExploreStoryboardBatch(storyboardTarget);
          return;
        }
        beginImageExploreGeneration();
        state.imageStudio.storyboardGenerating = true;
        replaceImageExploreStoryboardHistoryItem(storyboardTarget.id, { status: "running", taskId: "", message: "" });
        const fallbackReferences = state.imageStudio.references
          .filter((reference) => !reference.uploading)
          .map((reference) => reference.localUrl || reference.url)
          .filter(Boolean);
        runImageExploreStoryboardGeneration({
          ...storyboardTarget,
          model: storyboardTarget.model || state.imageStudio.model || "gpt-image-2",
          referenceImages: Array.isArray(storyboardTarget.referenceImages) ? storyboardTarget.referenceImages : fallbackReferences,
        }).finally(() => {
          endImageExploreGeneration();
          state.imageStudio.storyboardGenerating = false;
          persistImageExploreStoryboardHistory();
          renderImageExploreView();
        });
        return;
      }
      if (!target) return;
      beginImageExploreGeneration();
      replaceImageExploreHistoryItem(target.id, { status: "running", taskId: "", message: "" });
      renderImageExploreView();
      const fallbackReferences = state.imageStudio.references
        .filter((reference) => !reference.uploading)
        .map((reference) => reference.localUrl || reference.url)
        .filter(Boolean);
      runImageExploreGeneration({
        ...target,
        model: target.model || state.imageStudio.model || "gpt-image-2",
        referenceImages: Array.isArray(target.referenceImages) ? target.referenceImages : fallbackReferences,
      }).finally(() => {
        endImageExploreGeneration();
        persistImageExploreHistory();
        renderImageExploreView();
      });
      return;
    }
    const previewId = event.target.closest("[data-image-preview]")?.dataset.imagePreview;
    if (previewId) {
      const item = state.imageStudio.history.find((entry) => entry.id === previewId)
        || state.imageStudio.storyboardHistory.find((entry) => entry.id === previewId);
      if (item?.status === "completed") openImageExplorePreview(item);
    }
  });
  $("#imageExploreView")?.addEventListener("keydown", (event) => {
    const preview = event.target.closest?.("[data-image-preview]");
    if (!preview || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const item = state.imageStudio.history.find((entry) => entry.id === preview.dataset.imagePreview)
      || state.imageStudio.storyboardHistory.find((entry) => entry.id === preview.dataset.imagePreview);
    if (item?.status === "completed") openImageExplorePreview(item);
  });
  $("#assetLibraryRefresh")?.addEventListener("click", () => loadAssetLibrary().catch((error) => toast(error.message)));
  $("#assetLibrarySearch")?.addEventListener("input", (event) => {
    loadAssetLibrary({ search: event.currentTarget.value, silent: true }).catch((error) => toast(error.message));
  });
  $("#assetLibraryGallery")?.addEventListener("click", (event) => {
    const removeId = event.target.closest("[data-asset-library-remove]")?.dataset.assetLibraryRemove;
    if (removeId) return removeAssetLibraryAsset(removeId).catch((error) => toast(error.message));
    const previewId = event.target.closest("[data-asset-library-preview]")?.dataset.assetLibraryPreview;
    if (previewId) openAssetLibraryPreview(previewId);
  });
  $("#workflowAssetLibraryToggle")?.addEventListener("click", () => {
    state.assetLibrary.workflowExpanded = !state.assetLibrary.workflowExpanded;
    if (state.assetLibrary.workflowExpanded && !state.assetLibrary.loaded) {
      loadAssetLibrary({ silent: true }).catch((error) => toast(error.message));
    } else {
      renderWorkflowAssetLibrary();
    }
  });
  $("#workflowAssetLibraryRefresh")?.addEventListener("click", () => loadAssetLibrary().catch((error) => toast(error.message)));
  $("#workflowAssetLibrarySearch")?.addEventListener("input", (event) => {
    loadAssetLibrary({ search: event.currentTarget.value, silent: true }).catch((error) => toast(error.message));
  });
  $("#workflowAssetLibraryList")?.addEventListener("click", (event) => {
    const useId = event.target.closest("[data-workflow-library-use]")?.dataset.workflowLibraryUse;
    if (useId) return importWorkflowLibraryAsset(useId).catch((error) => toast(error.message));
    const addId = event.target.closest("[data-workflow-library-add]")?.dataset.workflowLibraryAdd;
    if (addId) return importWorkflowLibraryAsset(addId, { add: true }).catch((error) => toast(error.message));
  });
  $("#imageExploreResolution")?.addEventListener("change", (event) => {
    state.imageStudio.resolution = event.currentTarget.value || "1k";
  });
  $("#imageExploreRatio")?.addEventListener("change", (event) => {
    state.imageStudio.ratio = event.currentTarget.value || "16:9";
  });
  $("#openBlankCanvasProject")?.addEventListener("click", () => openBlankCanvasProject());
  $("#studioNewProject")?.addEventListener("click", openProjectModal);
  $("#studioCanvasButton")?.addEventListener("click", openCurrentCanvas);
  $("#closeProjectModal").addEventListener("click", closeProjectModal);
  $("#seriesPreflightButton")?.addEventListener("click", () => runSeriesPreflight());
  $("#projectCreateModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeProjectModal();
  });
  const goBackToProjects = () => {
    syncProjectUrl("");
    showProjectHome();
    loadProjects(false).catch((error) => toast(error.message));
  };
  $("#backToProjects").addEventListener("click", goBackToProjects);
  $("#studioModernOverviewButton")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = false;
    showStudio();
    renderModernStudio(state.project);
  });
  $("#modernBrandButton")?.addEventListener("click", goBackToProjects);
  $("#modernDetailsButton")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode(state.activeWorkspaceMode || "assets");
  });
  $("#modernQueueButton")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("video");
  });
  $("#modernVisualBibleButton")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("assets");
    toast("已打开详细编辑中的资产与风格设置");
  });
  $("#modernKitButton")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("assets");
    $("#referenceKitPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#modernBatchAction")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("video");
    $("#generateAllSegments")?.click();
  });
  $$('[data-modern-focus]').forEach((button) => button.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode(button.dataset.modernFocus === "assets" ? "assets" : button.dataset.modernFocus);
  }));
  $$('[data-modern-copy-tab]').forEach((button) => button.addEventListener("click", () => {
    state.modernStudio.copyTab = button.dataset.modernCopyTab || "story";
    renderModernStudio(state.project);
  }));
  $("#modernShotCopy")?.addEventListener("input", (event) => {
    $("#modernCopyCount").textContent = `${event.currentTarget.value.length} 字`;
  });
  $("#modernSaveCopy")?.addEventListener("click", () => {
    const target = state.modernStudio.copyTab === "prompt" ? "videoPromptInspectorPrompt" : "scriptText";
    const legacy = $(target);
    if (legacy) legacy.value = $("#modernShotCopy").value;
    toast("修改已暂存；详细编辑中可提交到当前流程");
  });
  $("#modernShotAction")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("video");
  });
  $("#modernStillEdit")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("storyboard");
  });
  $("#modernStillGenerate")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("storyboard");
    $("[data-job='storyboards']")?.click();
  });
  $("#modernVideoEdit")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("video");
  });
  $("#modernVideoGenerate")?.addEventListener("click", () => {
    state.modernStudio.detailsOpen = true;
    showStudio();
    setWorkspaceMode("video");
    $("#generateAllSegments")?.click();
  });
  $("#studioCommandButton")?.addEventListener("click", () => toast("命令面板会在下一阶段接入；当前可直接点击流程节点聚焦步骤"));
  $("#studioPrimaryRun")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => runStudioPrimaryAction()).catch((error) => toast(error.message));
  });
  $("#studioProjectsButton")?.addEventListener("click", goBackToProjects);
  $("#projectDisplayNameForm")?.addEventListener("submit", (event) => saveProjectDisplayName(event).catch((error) => toast(error.message)));
  $$("[data-studio-tab]").forEach((button) => {
    button.addEventListener("click", () => setStudioTab(button.dataset.studioTab || "assets"));
  });
  $$("[data-workspace-mode-button]").forEach((button) => {
    button.addEventListener("click", () => setWorkspaceMode(button.dataset.workspaceModeButton || "assets"));
  });
  $("#assetInspectorPrompt")?.addEventListener("input", (event) => {
    const assetName = state.selectedAssetId;
    if (!assetName) return;
    const draft = ensureAssetPromptDraft(assetName);
    draft.value = event.currentTarget.value;
    draft.dirty = draft.value !== draft.original;
    renderAssetInspector();
  });
  $("#closeAssetInspector")?.addEventListener("click", () => {
    state.assetInspectorOpen = false;
    renderAssetInspector();
  });
  $("#restoreAssetPrompt")?.addEventListener("click", () => {
    const draft = assetPromptDraft(state.selectedAssetId);
    if (!draft) return;
    draft.value = draft.original;
    draft.dirty = false;
    renderAssetInspector();
  });
  $("#saveAssetPrompt")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => saveAssetPrompt()).catch((error) => toast(error.message));
  });
  $("#regenerateAssetFromInspector")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => regenerateSelectedAssetFromInspector()).catch((error) => toast(error.message));
  });
  $("#videoPromptInspectorPrompt")?.addEventListener("input", (event) => {
    const shotName = state.selectedVideoShotName;
    if (!shotName) return;
    const draft = ensureVideoPromptDraft(shotName);
    draft.value = event.currentTarget.value;
    draft.dirty = draft.value !== draft.original;
    renderVideoPromptInspector();
  });
  $("#closeVideoPromptInspector")?.addEventListener("click", () => {
    state.videoPromptInspectorOpen = false;
    renderVideoPromptInspector();
  });
  $("#restoreVideoPrompt")?.addEventListener("click", () => {
    const draft = videoPromptDraft(state.selectedVideoShotName);
    if (!draft) return;
    draft.value = draft.original;
    draft.dirty = false;
    renderVideoPromptInspector();
  });
  $("#saveVideoPrompt")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => saveVideoPrompt()).catch((error) => toast(error.message));
  });
  $("#regenerateVideoFromInspector")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => regenerateSelectedVideoFromInspector()).catch((error) => toast(error.message));
  });
  $("#refreshState").addEventListener("click", () => {
    if (!state.selectedId) return toast("请先打开一个项目");
    loadProject(state.selectedId, { openStudio: false }).catch((error) => toast(error.message));
  });
  $("#generateAllSegments")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => generateAllVideoSegments()).catch((error) => toast(error.message));
  });
  $("#assembleFinalCutBtn")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => assembleFinalCut()).catch((error) => toast(error.message));
  });
  $("#zoomOut").addEventListener("click", () => setWorkspaceScale(state.workspaceScale - 0.08));
  $("#zoomIn").addEventListener("click", () => setWorkspaceScale(state.workspaceScale + 0.08));
  $("#zoomFit").addEventListener("click", fitWorkspaceScale);
  $("#resetLayout").addEventListener("click", () => {
    resetWindowLayout();
    toast("工作台布局已重置");
  });
  $("#studioContextOpen")?.addEventListener("click", (event) => setWorkflowFocus(event.currentTarget.dataset.workflowFocus || studioWorkflowFocusFromMode()));
  $("#scriptUpload").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await applyScriptUpload(file, {
        textareaSelector: "textarea[name='scriptText']",
        nameSelector: "#scriptUploadName",
        titleSelector: "input[name='title']",
      });
    } catch (error) {
      toast(error.message);
      event.target.value = "";
    }
  });
  $("#workflowScriptUpload").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await applyScriptUpload(file, {
        textareaSelector: "#scriptText",
        nameSelector: "#workflowScriptUploadName",
        requireSave: true,
      });
    } catch (error) {
      toast(error.message);
      event.target.value = "";
    }
  });
  $("#assetDescriptionUpload")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await applyScriptUpload(file, {
        textareaSelector: "#assetDescriptionText",
        nameSelector: "#assetDescriptionUploadName",
        requireSave: true,
        label: "资产文档",
      });
    } catch (error) {
      toast(error.message);
      event.target.value = "";
    }
  });
  $("#assetUploadFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    $("#assetUploadName").textContent = file ? file.name : "PNG / JPG / WEBP";
    state.assetUploadTargetId = $("#assetUploadTarget")?.value || "";
    updateAssetUploadHint();
  });
  $("#assetUploadMode")?.addEventListener("change", () => renderAssetUploadMode());
  $("#assetUploadLabel")?.addEventListener("input", () => updateAssetUploadHint());
  $("#newReferenceKit")?.addEventListener("click", () => openReferenceKitEditor());
  $("#referenceKitCancel")?.addEventListener("click", closeReferenceKitEditor);
  $("#referenceKitForm")?.addEventListener("submit", (event) => saveReferenceKit(event).catch((error) => toast(error.message)));
  $("#referenceKitPanel")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-reference-kit-action]");
    if (!action) return;
    const kitId = action.dataset.referenceKitId || "";
    const kit = (state.project?.referenceKits || []).find((item) => item.id === kitId);
    if (action.dataset.referenceKitAction === "edit") openReferenceKitEditor(kit);
    else if (action.dataset.referenceKitAction === "copy") openReferenceKitEditor(kit, true);
    else if (action.dataset.referenceKitAction === "delete") deleteReferenceKit(kitId).catch((error) => toast(error.message));
    else if (action.dataset.referenceKitAction === "bind") {
      const card = action.closest("[data-reference-kit-id]");
      bindReferenceKit(kitId, card?.querySelector("[data-reference-kit-shot]")?.value || "").catch((error) => toast(error.message));
    }
  });
  $("#assetStyleReferenceFile")?.addEventListener("change", (event) => uploadAssetStyleReference(event).catch((error) => toast(error.message)));
  $("#assetStyleReferenceEnabled")?.addEventListener("change", (event) => setAssetStyleReferenceEnabled(event.target.checked).catch((error) => toast(error.message)));
  $("#assetStyleReferenceRemove")?.addEventListener("click", () => removeAssetStyleReference().catch((error) => toast(error.message)));
  $("#assetUploadTarget").addEventListener("change", (event) => {
    state.assetUploadTargetId = event.target.value || "";
    updateAssetUploadHint();
  });
  $("#assetUploadForm").addEventListener("submit", (event) => uploadBoundAsset(event).catch((error) => toast(error.message)));
  $("#storyboardUploadFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    $("#storyboardUploadName").textContent = file ? file.name : "PNG / JPG / WEBP";
  });
  $("#storyboardUploadForm").addEventListener("submit", (event) => uploadStoryboardAsset(event).catch((error) => toast(error.message)));
  $("#refreshStoryboards").addEventListener("click", () => loadProject(state.selectedId, { openStudio: false }).catch((error) => toast(error.message)));
  $("#closeLightbox").addEventListener("click", closeLightbox);
  $("#imageLightbox").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.teamPanelOpen) {
      state.teamPanelOpen = false;
      renderTeamPanel();
    } else if (event.key === "Escape" && !$("#imageLightbox").classList.contains("hidden")) closeLightbox();
    else if (event.key === "Escape" && !$("#projectCreateModal").classList.contains("hidden")) closeProjectModal();
  });
  $("#projectForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formNode = event.currentTarget;
    const submitButton = formNode.querySelector("button[type='submit']");
    const originalLabel = submitButton?.textContent || "创建制作台";
    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "创建中...";
      }
      state.uiBusy.projectCreating = true;
      toast("正在创建制作台");
      const form = new FormData(formNode);
      const payload = Object.fromEntries(form.entries());
      payload.assetAnalyzerModel = state.assetAnalyzerModel;
      payload.dialogueLanguage = state.dialogueLanguage;
      payload.autoDraft = false;
      const createStatus = $("#projectCreateStatus");
      if (createStatus) createStatus.textContent = "正在创建项目目录和制作台。";
      const data = await api("/api/projects", { method: "POST", body: JSON.stringify(payload) });
      toast("项目已创建，可在制作台继续生成草稿和提取资产");
      closeProjectModal();
      openProjectFromState(data);
      loadProjects(false).catch((error) => toast(error.message));
    } catch (error) {
      toast(error.message);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
      const createStatus = $("#projectCreateStatus");
      if (createStatus) createStatus.textContent = "";
      state.uiBusy.projectCreating = false;
    }
  });
  $$("[data-save]").forEach((button) => {
    button.addEventListener("click", () => {
      withStudioButtonFeedback(button, () => saveFile(button.dataset.save)).catch((error) => toast(error.message));
    });
  });
  $$("[data-job]").forEach((button) => {
    button.addEventListener("click", () =>
      withStudioButtonFeedback(button, () => startJob(button.dataset.job)).catch(async (error) => {
        toast(error.message);
        if (state.selectedId) await loadProject(state.selectedId, { openStudio: false }).catch(() => {});
      }),
    );
  });
  $$("input[name='assetAnalyzerModel']").forEach((input) => {
    input.addEventListener("change", () => {
      state.assetAnalyzerModel = normalizeAssetAnalyzerModel(input.value);
      localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);
    });
  });
  $("#assetStylePreset")?.addEventListener("change", persistAssetStyleFromControls);
  $("#assetStyleCustom")?.addEventListener("input", persistAssetStyleFromControls);
  $$("input[name='draftDialogueLanguage']").forEach((input) => {
    input.addEventListener("change", () => changeDialogueLanguage(input.value).catch((error) => toast(error.message)));
  });
  $("#draftAssumeEnglishDialogue")?.addEventListener("change", (event) => {
    state.assumeEnglishDialogue = event.currentTarget.checked === true;
    localStorage.setItem("pixelToys.assumeEnglishDialogue", state.assumeEnglishDialogue ? "1" : "0");
    // 勾选后若当前正是英文对白,立即用跳过逻辑重跑一次(不调用模型),把状态坐实。
    if (state.assumeEnglishDialogue && state.dialogueLanguage === "en" && state.selectedId && !state.hydrating) {
      changeDialogueLanguage("en").catch((error) => toast(error.message));
    }
  });
  $("#draftBtn")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => extractAssets()).catch((error) => toast(error.message));
  });
  $("#confirmAssetManifestBtn")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => saveAssetManifest({ confirm: true })).catch((error) => toast(error.message));
  });
  $("#buildConfigBtn")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    withStudioButtonFeedback(button, () => buildConfig()).catch((error) => toast(error.message));
  });
  ["configPromptMode", "configRatio", "configResolution", "configModel"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => refreshVideoConfig({ silent: true }).catch((error) => toast(error.message)));
  });
}

bind();
if (WORKFLOW_PREVIEW_MODE) {
  showWorkflowPreview();
} else {
  if (!INITIAL_PROJECT_ID && PixelToysWorkspaceShell.shouldEnableExplore({ serverEnabled: true, search: window.location.search })) {
    state.exploreEnabled = true;
    showProjectHome();
  }
  syncAuthUser();
  // 若 URL 指定了项目(从画布"制作台"进来),同步直接进控制台外壳,避免异步加载期间
  // 先闪一下项目列表首页。项目数据稍后由 loadProjects→loadProject 填充;若该项目不存在,
  // loadProjects 内会回退到首页。
  if (INITIAL_PROJECT_ID) showStudio();
  loadProjects().catch((error) => toast(error.message));
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.exploreEnabled) setupExploreVideoPlayback();
});
window.addEventListener("resize", () => {
  clearTimeout(window._pixelToysLayoutTimer);
  window._pixelToysLayoutTimer = setTimeout(applyWindowLayout, 150);
});
async function refreshSelectedProjectStatus() {
  if (window._pixelToysRefreshInFlight) return false;
  if (document.hidden) return false;
  if (!state.selectedId || $("#studioShell").classList.contains("hidden")) return false;
  if (hasOpenManualAssetDraft()) return false;
  window._pixelToysRefreshInFlight = true;
  try {
    const status = await api(`/api/project/${state.selectedId}/status`);
    mergeProjectStatus(status);
    renderProjectList();
    renderVideoConfigStatus(state.project?.videoConfigStatus || {});
    renderVideoProgress(state.project?.videoProgress || { total: 0, completed: 0, items: [] });
    renderFinalCut(state.project?.finalCut || null);
    renderStudioLogs(state.project);
    // 轮询里也刷新资产图库(renderAssets 有签名守卫,内容没变不会重建),让生成好的资产图不必手动刷新就显示。
    // /status 现在也返回 assetManifest/assets/assetSlots,故可轻量重绘。
    renderAssetManifest(state.project?.assetManifest || null);
    renderAssets(
      state.project?.assetSlots || buildAssetSlots(state.project?.assetManifest || null, state.project?.assets || []),
      state.project?.assets || [],
      state.project?.jobs || state.project?.assetJob,
    );
    renderAssetInspector();
    renderAssetJob(state.project?.assetJob, state.project?.runtime || {});
    // 故事板同样在轮询里刷新(renderStoryboards 有签名守卫,不会闪),让 Production Board 生成完不必手动刷新就显示。
    renderStoryboardUploadTargets(state.project?.storyboardSlots || [], state.project?.storyboards || []);
    renderStoryboards(
      state.project?.storyboardSlots || [],
      state.project?.storyboards || [],
      state.project?.jobs || state.project?.storyboardJob,
    );
    renderStoryboardJob(state.project?.storyboardJob);
    renderStudioFlowStatus(state.project);
    renderModernStudio(state.project);
    return true;
  } catch (error) {
    console.warn("Project refresh failed:", error);
    return false;
  } finally {
    window._pixelToysRefreshInFlight = false;
  }
}

function scheduleProjectRefresh({ immediate = false } = {}) {
  clearTimeout(window._pixelToysRefreshTimer);
  if (immediate && !document.hidden) {
    refreshSelectedProjectStatus().finally(() => scheduleProjectRefresh());
    return;
  }
  const delay = document.hidden
    ? PROJECT_REFRESH_HIDDEN_MS
    : projectHasRunningWork()
      ? PROJECT_REFRESH_ACTIVE_MS
      : PROJECT_REFRESH_IDLE_MS;
  window._pixelToysRefreshTimer = setTimeout(() => {
    refreshSelectedProjectStatus().finally(() => scheduleProjectRefresh());
  }, delay);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleProjectRefresh({ immediate: true });
});
scheduleProjectRefresh();
