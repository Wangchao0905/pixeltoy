const DEFAULT_ASSET_ANALYZER_MODEL = "claude-opus-4-8";
const WORKSPACE_LAYOUT_VERSION = "green-flow-v5-no-map";
const WORKSPACE_SCALE_KEY = `pixelToys.workspaceScale.${WORKSPACE_LAYOUT_VERSION}`;
const STUDIO_TAB_KEY = `pixelToys.activeStudioTab.${WORKSPACE_LAYOUT_VERSION}`;
const INITIAL_PROJECT_ID = new URLSearchParams(window.location.search).get("project") || "";
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
let initialProjectHandled = false;
let teamProgressOpenToken = null;

function imageExploreStorageKey(user = null) {
  const identity = user?.id || user?.username || "anonymous";
  return `${IMAGE_EXPLORE_HISTORY_KEY}.${identity}`;
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
  return ["assets", "storyboards", "video", "logs"].includes(tab) ? tab : "assets";
}

function readImageExploreHistory(user = null) {
  try {
    const value = JSON.parse(localStorage.getItem(imageExploreStorageKey(user)) || "[]");
    return Array.isArray(value)
      ? value
        .filter((item) => (item?.status === "completed" && item?.url) || (item?.status === "failed" && item?.message))
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
  exploreProjectSearch: "",
  exploreCanvasFilter: "all",
  exploreScopeFilter: "all",
  blankCanvases: [],
  imageStudio: {
    history: readImageExploreHistory(),
    prompt: "",
    ratio: "16:9",
    resolution: "1k",
    count: 1,
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
  assetEditDrafts: new Map(),
  activeAssetEditName: "",
  selectedAssetId: "",
  assetPromptDrafts: new Map(),
  assetInspectorOpen: false,
  manualAssetType: "",
  manualAssetDraft: { label: "", description: "", evidence: "", quality: "1k", references: [] },
  shouldFocusManualAsset: false,
  selectedAssetIds: new Set(),
  optimisticAssetJobs: new Map(),
  dialogueLanguage: localStorage.getItem("pixelToys.dialogueLanguage") || "en",
  workspaceScale: initialWorkspaceScale(),
  assetUploadTargetId: "",
  referenceKitEditingId: "",
  referenceKitDraft: null,
  hydrating: false,
  uiBusy: {
    assetExtracting: false,
    projectCreating: false,
  },
  loadProjectToken: null,
  activeWindowZ: Number(localStorage.getItem(layoutStorageKey(WINDOW_Z_KEY)) || 20),
  activeStudioTab: "assets",
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

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
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
  const adminLink = $("#adminLink");
  const exploreAdminLink = $("#exploreAdminLink");
  const exploreTeamButton = $("#exploreTeamButton");
  const exploreRefresh = $("#exploreRefresh");
  const exploreAccount = $("#exploreAccount");
  const canvasCard = $(".canvas-entry-card");
  if (!label) return;
  try {
    const data = await api("/api/auth/me");
    state.authUser = data.user || null;
    restoreWorkspacePreferences(state.authUser);
    clearLegacyLayoutPreferences();
    state.imageStudio.history = readImageExploreHistory(state.authUser);
    renderImageExploreView();
    const authDisplayName = data.user?.role === "admin"
      ? data.user?.username || "superadmin"
      : data.user?.displayName || data.user?.username || "";
    label.textContent = authDisplayName;
    if (exploreLabel) exploreLabel.textContent = authDisplayName;
    adminLink?.classList.toggle("hidden", data.user?.role !== "admin");
    exploreAdminLink?.classList.toggle("hidden", data.user?.role !== "admin");
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
    renderImageExploreView();
    label.textContent = "";
    if (exploreLabel) exploreLabel.textContent = "";
    adminLink?.classList.add("hidden");
    exploreAdminLink?.classList.add("hidden");
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
  $("#exploreHome")?.classList.toggle("hidden", !state.exploreEnabled);
  $("#projectHome").classList.toggle("hidden", state.exploreEnabled);
  $("#studioShell").classList.add("hidden");
  document.body.classList.remove("is-studio");
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
  $("#studioShell").classList.remove("hidden");
  document.body.classList.add("is-studio");
  document.body.classList.toggle("is-explore-ui", state.exploreEnabled);
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
    chatcut: null,
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
    chatcut: status.chatcut || state.project.chatcut,
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
  state.assetEditDrafts.clear();
  state.activeAssetEditName = "";
  state.selectedAssetId = "";
  state.assetPromptDrafts.clear();
  state.assetInspectorOpen = false;
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
  // 保留“生成中”项在内存状态里(否则重生成/重试期间卡片会凭空消失);只把已完成/失败写入 localStorage。
  const trimmed = state.imageStudio.history
    .filter((item) => item?.status === "running" || (item?.status === "completed" && item.url) || (item?.status === "failed" && item.message))
    .slice(0, 24);
  state.imageStudio.history = trimmed;
  localStorage.setItem(
    imageExploreStorageKey(state.authUser),
    JSON.stringify(trimmed.filter((item) => (item.status === "completed" && item.url) || (item.status === "failed" && item.message))),
  );
}

function beginImageExploreGeneration() {
  state.imageStudio.activeGenerations = Math.max(0, Number(state.imageStudio.activeGenerations) || 0) + 1;
  state.imageStudio.generating = true;
}

function endImageExploreGeneration() {
  state.imageStudio.activeGenerations = Math.max(0, (Number(state.imageStudio.activeGenerations) || 0) - 1);
  state.imageStudio.generating = state.imageStudio.activeGenerations > 0;
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
        <button type="button" data-image-remove="${id}" title="移除" aria-label="移除失败结果">×</button>
      </div>
    </article>`;
  }
  return `<article class="image-explore-card">
    <div class="image-explore-card-preview" data-image-preview="${id}" role="button" tabindex="0" aria-label="打开大图">
      <img src="${escapeAttr(item.url)}" alt="${prompt}" loading="lazy" decoding="async" />
      <button type="button" class="image-explore-regen" data-image-regenerate="${id}" title="重新生成" aria-label="重新生成">↻</button>
      <button type="button" data-image-remove="${id}" title="移除" aria-label="移除生成结果">×</button>
    </div>
  </article>`;
}

function renderImageExploreReferences() {
  const node = $("#imageExploreReferenceList");
  if (!node) return;
  node.innerHTML = state.imageStudio.references
    .map(
      (reference) => `<span class="image-explore-reference${reference.uploading ? " is-uploading" : ""}" title="${escapeAttr(reference.name)}" aria-busy="${reference.uploading ? "true" : "false"}">
        <img src="${escapeAttr(reference.previewUrl || reference.url)}" alt="" />
        ${reference.uploading ? `<span class="image-explore-reference-loading" aria-label="上传中"></span>` : ""}
        <button type="button" data-image-reference-remove="${escapeAttr(reference.id)}" aria-label="移除参考图">×</button>
      </span>`,
    )
    .join("");
}

function renderImageExploreGallery() {
  const gallery = $("#imageExploreGallery");
  const empty = $("#imageExploreEmpty");
  if (!gallery || !empty) return;
  gallery.innerHTML = state.imageStudio.history.map(imageExploreHistoryItemHtml).join("");
  empty.classList.toggle("hidden", state.imageStudio.history.length > 0);
}

function renderImageExploreView() {
  const view = $("#imageExploreView");
  if (!view) return;
  $("#imageExplorePrompt").value = state.imageStudio.prompt;
  $("#imageExploreRatio").value = state.imageStudio.ratio;
  $("#imageExploreResolution").value = state.imageStudio.resolution;
  $("#imageExploreCount").textContent = String(state.imageStudio.count);
  const referencesUploading = Number(state.imageStudio.referencesUploading) || 0;
  const activeGenerations = Number(state.imageStudio.activeGenerations) || 0;
  $("#imageExploreGenerate").disabled = referencesUploading > 0;
  $("#imageExploreStatus").textContent = referencesUploading
    ? `参考图上传中（${referencesUploading}）`
    : activeGenerations > 0
      ? `生成中（${activeGenerations}）`
      : "";
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
  state.exploreView = ["image", "library"].includes(view) ? view : "canvas";
  $(".canvas-home")?.classList.toggle("hidden", state.exploreView !== "canvas");
  $("#imageExploreView")?.classList.toggle("hidden", state.exploreView !== "image");
  $("#assetLibraryView")?.classList.toggle("hidden", state.exploreView !== "library");
  $$(".explore-topbar nav > button").forEach((button) => {
    const active = button.dataset.exploreTool === "image-generation"
      ? state.exploreView === "image"
      : button.dataset.exploreTool === "asset-library"
        ? state.exploreView === "library"
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

function showExploreCanvasHome() {
  setExploreView("canvas");
  renderExploreHome();
}

function replaceImageExploreHistoryItem(id, patch = {}) {
  state.imageStudio.history = state.imageStudio.history.map((item) => (item.id === id ? { ...item, ...patch } : item));
  renderImageExploreView();
}

async function pollImageExploreGeneration(taskId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const data = await api(`/api/canvas/image-generations/${encodeURIComponent(taskId)}`);
    const result = data.result || {};
    if (result.status === "completed" || result.status === "failed") return result;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("生成超时，请稍后查看或重试");
}

async function runImageExploreGeneration(item) {
  try {
    const data = await api("/api/canvas/image-generation", {
      method: "POST",
      body: JSON.stringify({
        prompt: item.prompt,
        ratio: item.ratio,
        resolution: item.resolution,
        model: item.model || "gpt-image-2",
        referenceImages: Array.isArray(item.referenceImages) ? item.referenceImages : [],
      }),
    });
    const taskId = data.result?.taskId;
    if (!taskId) throw new Error("图片任务没有返回 ID");
    const result = await pollImageExploreGeneration(taskId);
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

async function submitImageExploreGeneration(event) {
  event?.preventDefault();
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
          body: JSON.stringify({ name: file.name || "image-reference", dataUrl }),
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
  persistImageExploreHistory();
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
  requestAnimationFrame(updateWorkspaceSize);
}

function setStudioTab(tab, { persist = true } = {}) {
  const nextTab = studioTabExists(tab) ? tab : "assets";
  const modeMap = { storyboards: "storyboard", assets: "assets", video: "video", logs: "assets" };
  state.activeStudioTab = nextTab;
  if (persist) localStorage.setItem(layoutStorageKey(STUDIO_TAB_KEY, state.authUser), nextTab);
  $$("[data-studio-tab]").forEach((button) => {
    const active = button.dataset.studioTab === nextTab;
    button.classList.toggle("is-active", active);
    if (button.getAttribute("role") === "tab") button.setAttribute("aria-selected", active ? "true" : "false");
  });
  setWorkspaceMode(modeMap[nextTab] || nextTab, { persist });
}

function isAssetExtracting() {
  return !!state.uiBusy.assetExtracting || !!state.uiBusy.projectCreating;
}

function flowStepClass(done, active, blocked = false) {
  if (blocked) return "warn";
  if (active) return "active";
  if (done) return "ok";
  return "";
}

function renderStudioFlowStatus(data = state.project) {
  const node = $("#studioFlowStatus");
  if (!node) return;
  if (!data?.project) {
    node.innerHTML = "";
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
  const assetRunning = data.assetJob?.status === "running" || (data.jobs || []).some((job) => job?.status === "running" && /asset|image/i.test(job.type || job.command || ""));
  const storyboardSlots = data.storyboardSlots || [];
  const boardReady = storyboardSlots.filter((slot) => slot.status === "ready").length;
  const boardRunning = data.storyboardJob?.status === "running";
  const config = data.videoConfigStatus || {};
  const videoProgress = data.videoProgress || {};
  const videoTotal = videoProgress.total || videoProgress.items?.length || 0;
  const videoDone = videoProgress.completed || 0;
  const videoRunning = !!videoProgress.running;
  const steps = [
    {
      label: "剧本",
      value: scriptReady ? "已载入" : "待输入",
      done: scriptReady,
      active: !scriptReady,
    },
    {
      label: "资产解析",
      value: extracting ? "解析中" : manifestConfirmed ? "已确认" : manifestReady ? "待确认" : "待提取",
      done: manifestConfirmed,
      active: extracting || (scriptReady && !manifestConfirmed),
      blocked: !extracting && manifestReady && !manifestConfirmed,
    },
    {
      label: "资产图",
      value: assetTotal ? `${assetReady}/${assetTotal}` : "待生成",
      done: !!assetTotal && assetReady >= assetTotal,
      active: assetRunning,
    },
    {
      label: "故事板",
      value: storyboardSlots.length ? `${boardReady}/${storyboardSlots.length}` : "可选",
      done: !!storyboardSlots.length && boardReady >= storyboardSlots.length,
      active: boardRunning,
    },
    {
      label: "视频配置",
      value: config.ready ? "可提交" : config.exists ? "需补齐" : "待生成",
      done: !!config.ready,
      active: manifestConfirmed && !config.ready,
      blocked: !!config.exists && !config.ready,
    },
    {
      label: "视频片段",
      value: videoTotal ? `${videoDone}/${videoTotal}` : "待开始",
      done: !!videoTotal && videoDone >= videoTotal,
      active: videoRunning,
    },
  ];
  node.innerHTML = steps
    .map(
      (step) => `
        <button class="studio-flow-step ${flowStepClass(step.done, step.active, step.blocked)}" type="button" data-flow-tab="${step.label === "故事板" ? "storyboards" : step.label === "视频片段" || step.label === "视频配置" ? "video" : "assets"}">
          <span>${escapeHtml(step.label)}</span>
          <strong>${escapeHtml(step.value)}</strong>
        </button>
      `,
    )
    .join("");
  node.querySelectorAll("[data-flow-tab]").forEach((button) => {
    button.addEventListener("click", () => setStudioTab(button.dataset.flowTab || "assets"));
  });
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
}

function hydrateConfigInputs(configText) {
  try {
    const config = JSON.parse(configText);
    $("#configGroup").value = config.groupName || "";
    $("#configModel").value = normalizeVideoModelName(config.modelName);
    $("#configResolution").value = config.settings?.resolution || "480p";
    $("#configRatio").value = config.settings?.ratio || "9:16";
    $("#configPromptMode").value = config.settings?.promptMode || (config.settings?.enableStoryboards ? "production_board" : "production_board");
  } catch {
    $("#configGroup").value = "";
    $("#configModel").value = "seedance-2-0-fast";
    $("#configResolution").value = "480p";
    $("#configRatio").value = "9:16";
    $("#configPromptMode").value = "production_board";
  }
}

function assetDraft(assetName) {
  return state.assetEditDrafts.get(assetName) || { open: false, value: "", references: [] };
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

function renderAssetInspector() {
  const inspector = $("#assetInspector");
  if (!inspector) return;
  const assetName = state.selectedAssetId;
  const item = assetPromptItem(assetName);
  const asset = assetForName(assetName);
  const visible = state.activeWorkspaceMode === "assets" && !!assetName && !!item && state.assetInspectorOpen;
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

function setAssetDraft(assetName, patch) {
  const draft = { ...assetDraft(assetName), ...patch };
  draft.references = [...new Set(draft.references || [])].filter(Boolean);
  state.assetEditDrafts.set(assetName, draft);
  return draft;
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

function refreshReferencePreview(form, references) {
  const node = form.querySelector(".asset-reference-list");
  if (node) node.innerHTML = referenceChipsHtml(references);
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

function renderAssetManifest(manifest) {
  const overview = $("#assetManifestOverview");
  const status = $("#assetManifestStatus");
  const extractBtn = $("#extractAssetsBtn");
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

  if (extractBtn) {
    extractBtn.disabled = extracting;
    extractBtn.textContent = extracting ? "生成中..." : "生成分镜草稿";
  }
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

  const manifestItemHtml = (item) => {
    const shouldGenerate = item.generate !== false;
    const label = item.label || item.id;
    return `
      <span class="manifest-name ${shouldGenerate ? "" : "is-skipped"}" data-manifest-asset-id="${escapeAttr(item.id)}">
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
      <div class="manifest-name-list">
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

function addReferenceToActiveEdit(referenceName) {
  if (addReferenceToManualAsset(referenceName)) return;
  if (!state.activeAssetEditName) return toast("先打开一张资产图的修改框");
  if (state.activeAssetEditName === referenceName) return toast("不能把当前正在修改的图作为自己的参考图");
  const draft = setAssetDraft(state.activeAssetEditName, {
    open: true,
    references: [...(assetDraft(state.activeAssetEditName).references || []), referenceName],
  });
  const activeForm = document.querySelector(`.asset-edit-form[data-asset-name="${CSS.escape(state.activeAssetEditName)}"]`);
  if (activeForm) refreshReferencePreview(activeForm, draft.references);
  toast(`已加入参考图：${referenceName}`);
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
  const openDrafts = [...state.assetEditDrafts.entries()]
    .filter(([, draft]) => draft && draft.open)
    .map(([name]) => name)
    .sort()
    .join(",");
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
  return `${state.project?.loading ? "L" : ""}#${sel}#${openDrafts}#${parts.join(";")}`;
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

  const referenceAssets = assets || [];
  const buildAssetCard = (slot) => {
    const asset = slot.asset;
    const assetName = slot.id || asset?.assetName || "";
    const isGenerating = isActiveJobTarget(activeTargets, assetName, asset?.assetName, asset?.name);
    const displaySlot = isGenerating ? { ...slot, isGenerating: true, statusLabel: "生成中" } : slot;
    const isStaleAfterFailure = !!asset && !!slot.staleAsset;
    const isReused = !!slot.reused || !!asset?.reused;
    const isSelected = state.selectedAssetIds.has(assetName);
    const canGenerateAsset = !(slot.skipped || slot.status === "skipped");
    const editDraft = asset ? assetDraft(asset.assetName) : { open: false, value: "", references: [] };
    const flagged = flaggedByLabel.get(slot.label || assetName) || flaggedByLabel.get(assetName);
    const card = document.createElement("article");
    card.className = `asset-card asset-slot ${asset ? "has-asset" : "is-missing"} ${slot.skipped || slot.status === "skipped" ? "is-skipped" : ""} ${slot.failed && !asset ? "is-failed" : ""} ${isStaleAfterFailure ? "has-stale-asset" : ""} ${isGenerating ? "is-node-running" : ""} ${isSelected ? "is-selected" : ""} ${editDraft.open ? "is-editing" : ""} ${flagged ? "is-flagged" : ""}`;
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
        ${
          asset
            ? `<a class="asset-tool asset-download" href="${downloadUrl}" download="${escapeAttr(asset.name || `${asset.assetName}.png`)}" aria-label="下载 ${escapeAttr(asset.assetName)}" title="下载">
          <span aria-hidden="true">↓</span>
        </a>`
            : ""
        }
        <button class="asset-tool asset-regenerate" type="button" ${canGenerateAsset ? "" : "disabled"} aria-label="${asset ? "重新生成" : "生成"} ${escapeAttr(assetName)}" title="${canGenerateAsset ? (asset ? "重新生成" : "生成") : "已设为不生成，点击右侧开关可恢复生成"}">
          <span aria-hidden="true">${asset ? "↻" : "+"}</span>
        </button>
        <button class="asset-tool asset-skip-toggle ${canGenerateAsset ? "is-on" : "is-off"}" type="button" data-asset-skip="${escapeAttr(assetName)}" aria-label="${canGenerateAsset ? "设为不生成" : "设为生成"} ${escapeAttr(assetName)}" title="${canGenerateAsset ? "点击排除：不生成这个资产" : "已排除，点击重新加入生成"}">
          <span aria-hidden="true">${canGenerateAsset ? "−" : "+"}</span>
        </button>
        ${
          asset
            ? `${isReused ? "" : `<button class="asset-tool asset-edit-toggle" type="button" aria-label="修改 ${escapeAttr(asset.assetName)}" title="修改">
          <span aria-hidden="true">✎</span>
        </button>`}
        <button class="asset-tool asset-reference" type="button" aria-label="将 ${escapeAttr(asset.assetName)} 设为当前修改参考图" title="设为参考">
          <span aria-hidden="true">@</span>
        </button>
        ${isReused ? "" : `<button class="asset-tool asset-delete" type="button" aria-label="删除 ${escapeAttr(asset.assetName)}" title="删除">
          <span aria-hidden="true">×</span>
        </button>`}`
            : ""
        }
      </div>
      <div class="caption">
        <strong>${renderNodeBeacon(isGenerating, `正在生成 ${assetName}`)}${escapeHtml(slot.label || assetName)}</strong>
        <span class="asset-slot-status ${assetSlotStatusClass(displaySlot)}">${escapeHtml(assetSlotStatusLabel(displaySlot))}</span>
        ${isStaleAfterFailure ? `<span class="asset-slot-status warn">上次修改失败，可重新生成</span>` : ""}
        ${isReused ? `<span class="asset-slot-status ok">${escapeHtml(assetReuseLabel(slot, asset))}</span>` : ""}
      </div>
      ${
        asset && !isReused
          ? `<form class="asset-edit-form${editDraft.open ? "" : " hidden"}" data-asset-name="${escapeAttr(asset.assetName)}">
        <label class="asset-reference-picker">
          <span>参考图</span>
          <select>
            <option value="">选择已有资产图</option>
            ${referenceOptionsHtml(referenceAssets, asset.assetName)}
          </select>
        </label>
        <div class="asset-reference-list">${referenceChipsHtml(editDraft.references || [])}</div>
        <textarea rows="3" placeholder="输入修改要求，例如：把警长制服改成深棕色夹克，保留白底四视图和同一人物身份">${escapeHtml(editDraft.value)}</textarea>
        <div class="asset-edit-actions">
          <button class="ghost small asset-edit-cancel" type="button">取消</button>
          <button class="primary small" type="submit">修改</button>
        </div>
      </form>`
          : ""
      }
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
      const editToggle = card.querySelector(".asset-edit-toggle");
      if (editToggle) editToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const form = card.querySelector(".asset-edit-form");
        if (!form) return;
        const shouldOpen = form.classList.contains("hidden");
        $$(".asset-edit-form:not(.hidden)").forEach((openForm) => {
          if (openForm === form) return;
          openForm.classList.add("hidden");
          openForm.closest(".asset-card")?.classList.remove("is-editing");
          const otherAssetName = openForm.dataset.assetName || "";
          if (otherAssetName) setAssetDraft(otherAssetName, { open: false });
        });
        form.classList.toggle("hidden", !shouldOpen);
        const draft = setAssetDraft(asset.assetName, { open: shouldOpen });
        card.classList.toggle("is-editing", shouldOpen);
        if (shouldOpen) {
          state.activeAssetEditName = asset.assetName;
          applyAssetBoundStyle(asset);
        }
        else if (state.activeAssetEditName === asset.assetName) state.activeAssetEditName = "";
        if (draft.open) form.querySelector("textarea").focus();
        requestAnimationFrame(updateWorkspaceSize);
      });
      card.querySelector(".asset-reference").addEventListener("click", (event) => {
        event.stopPropagation();
        addReferenceToActiveEdit(asset.assetName);
      });
      const deleteButton = card.querySelector(".asset-delete");
      if (deleteButton) {
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteAsset(asset.assetName).catch((error) => toast(error.message));
        });
      }
      const editCancel = card.querySelector(".asset-edit-cancel");
      if (editCancel) editCancel.addEventListener("click", (event) => {
        event.stopPropagation();
        state.assetEditDrafts.delete(asset.assetName);
        if (state.activeAssetEditName === asset.assetName) state.activeAssetEditName = "";
        card.querySelector(".asset-edit-form textarea").value = "";
        card.querySelector(".asset-edit-form").classList.add("hidden");
        card.classList.remove("is-editing");
      });
      const editForm = card.querySelector(".asset-edit-form");
      if (editForm) editForm.addEventListener("click", (event) => event.stopPropagation());
      const editSelect = card.querySelector(".asset-edit-form select");
      if (editSelect) editSelect.addEventListener("change", (event) => {
        event.stopPropagation();
        const form = card.querySelector(".asset-edit-form");
        const draft = setAssetDraft(asset.assetName, {
          open: true,
          references: mergeSelectedReference(form.querySelector("select"), assetDraft(asset.assetName).references || []),
        });
        refreshReferencePreview(form, draft.references);
        form.querySelector("select").value = "";
      });
      const editTextarea = card.querySelector(".asset-edit-form textarea");
      if (editTextarea) editTextarea.addEventListener("input", (event) => {
        setAssetDraft(asset.assetName, { open: true, value: event.currentTarget.value });
      });
      if (editForm) editForm.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const form = event.currentTarget;
        const instruction = form.querySelector("textarea").value.trim();
        const references = mergeSelectedReference(form.querySelector("select"), assetDraft(asset.assetName).references || []);
        setAssetDraft(asset.assetName, { open: false, references });
        refreshReferencePreview(form, references);
        form.classList.add("hidden");
        card.classList.remove("is-editing");
        if (state.activeAssetEditName === asset.assetName) state.activeAssetEditName = "";
        requestAnimationFrame(updateWorkspaceSize);
        editAsset(asset.assetName, instruction, references).catch((error) => toast(error.message));
      });
      card.addEventListener("dblclick", (event) => {
        event.preventDefault();
        openLightbox(asset);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (state.activeWorkspaceMode === "assets") selectAssetForInspector(assetName);
          else toggleAssetSelection(assetName);
        }
      });
    }
    card.addEventListener("click", (event) => {
      if (event.target.closest(".asset-tools, .asset-edit-form, a, button, select, textarea, input, label")) return;
      applyAssetBoundStyle(assetForName(assetName));
      if (asset && state.activeWorkspaceMode === "assets") selectAssetForInspector(assetName);
      else toggleAssetSelection(assetName);
    });
    return card;
  };

  // Per-card signature mirrors assetRenderSignature's per-slot fields plus this
  // card's own selected/edit-open state, so a single change (e.g. clicking
  // generate) only rebuilds that one card and leaves sibling <img> untouched.
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
      asset ? (assetDraft(asset.assetName).open ? 1 : 0) : 0,
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
  state.assetEditDrafts.delete(assetName);
  if (state.activeAssetEditName === assetName) state.activeAssetEditName = "";
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

async function editAsset(assetName, editInstruction, referenceAssetNames = []) {
  if (!state.selectedId) return;
  if (!editInstruction) return toast("请先输入修改要求");
  if (assetName) state.optimisticAssetJobs.set(assetName, { startedAt: Date.now(), type: "asset-edit" });
  renderWorkspace();
  const data = await api(`/api/project/${state.selectedId}/job`, {
    method: "POST",
    body: JSON.stringify({
      type: "asset-edit",
      assetName,
      editInstruction,
      referenceAssetNames,
      quality: $("#assetQuality")?.value || "1k",
      ...stylePayloadForAsset(assetName),
    }),
  });
  state.activeJobId = data.job.id;
  toast(`已提交修改：${assetName}`);
  await loadProject(state.selectedId, { openStudio: false });
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
  node.querySelector("[data-generate-all-segments-inline]")?.addEventListener("click", () => {
    generateAllVideoSegments().catch((error) => toast(error.message));
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

function hasOpenAssetEditDraft() {
  return [...state.assetEditDrafts.values()].some((draft) => draft.open);
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
      model: normalizeVideoModelName(config.modelName),
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

async function generateVideoSegment(shotName = "") {
  if (!state.selectedId) return toast("请先打开一个项目");
  const cleanShotName = String(shotName || "").trim();
  if (!cleanShotName) return toast("缺少视频片段");
  if (userHasCanvasPermission()) {
    await sendSegmentsToCanvas({ shotName: cleanShotName, openCanvas: false, silent: true });
  }
  toast(userHasCanvasPermission() ? "已发送到画布并提交视频生成，留在操作台等待结果" : "已提交视频生成，留在操作台等待结果");
  const data = await api(`/api/project/${state.selectedId}/video-generate`, {
    method: "POST",
    body: JSON.stringify({ shotName: cleanShotName }),
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
      : "";
  }
  renderChatcut(state.project?.chatcut || null);
}

async function assembleFinalCut() {
  if (!state.selectedId) return toast("请先打开一个项目");
  try {
    const data = await api(`/api/project/${state.selectedId}/assemble-final-cut`, { method: "POST", body: JSON.stringify({}) });
    toast(data.result?.message || "已开始组装成片");
    if (data.state) setProjectState(data.state);
    renderWorkspace();
    scheduleProjectRefresh();
  } catch (error) {
    toast(error.message);
  }
}

function renderChatcut(chatcut = null) {
  const data = chatcut || {};
  const statusEl = $("#chatcutStatus");
  const progressEl = $("#chatcutProgress");
  const editButton = $("#chatcutEditBtn");
  const openButton = $("#openChatcutFileBtn");
  if (!statusEl) return;
  const diagnosis = data.diagnosis || {};
  const queue = data.queue || {};
  const queueStatus = queue.status || "";
  const queueActive = ["queued", "running"].includes(queueStatus);
  const queueFailed = queueStatus === "failed";
  const outputReady = !!data.export?.url;
  const stateKey = queueFailed ? "failed" : queueActive ? queueStatus : outputReady ? "complete" : "idle";
  const statusLabel = queueActive
    ? queue.label || (queueStatus === "running" ? "剪辑中" : "排队中")
    : queueFailed
      ? "剪辑失败"
      : outputReady
        ? "剪辑完成"
        : data.packageExists
          ? data.label || "制作包已准备"
          : "等待素材准备";
  const statusDetail = queueActive
    ? queueStatus === "running"
      ? "服务器进程运行中"
      : "等待服务器进程"
    : queueFailed
      ? queue.error || data.error || "服务器剪辑失败"
      : outputReady
        ? "本地成片已就绪"
        : data.packageExists
          ? "制作包已就绪"
          : diagnosis.reason || "生成全部视频片段后即可开始剪辑";
  statusEl.className = `chatcut-status chatcut-status-${stateKey}`;
  statusEl.innerHTML = `<span class="chatcut-status-dot" aria-hidden="true"></span><span class="chatcut-status-label">${escapeHtml(statusLabel)}</span><span class="chatcut-status-detail">${escapeHtml(statusDetail)}</span>`;
  if (progressEl) {
    progressEl.hidden = !queueActive;
    progressEl.className = `chatcut-progress${queueActive ? " is-active" : ""}`;
    progressEl.setAttribute("aria-label", queueActive ? statusDetail : "");
    progressEl.innerHTML = queueActive ? '<span class="chatcut-progress-track"><span class="chatcut-progress-bar"></span></span>' : "";
  }
  if (editButton) {
    editButton.disabled = queueActive;
    editButton.textContent = queueStatus === "running" ? "剪辑中" : "剪辑";
  }
  if (openButton) {
    openButton.classList.toggle("hidden", !outputReady);
    if (outputReady) {
      openButton.href = data.export.url;
      openButton.removeAttribute("aria-disabled");
    } else {
      openButton.removeAttribute("href");
      openButton.setAttribute("aria-disabled", "true");
    }
  }
}

async function startChatcutEditing() {
  if (!state.selectedId) return toast("请先打开一个项目");
  try {
    const data = await api(`/api/project/${state.selectedId}/chatcut/automate`, { method: "POST", body: JSON.stringify({}) });
    if (data.state) setProjectState(data.state);
    renderWorkspace();
    toast(data.result?.reason || "已开始 ChatCut 剪辑");
  } catch (error) {
    toast(error.message);
  }
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
    card.querySelector("[data-segment-generate]")?.addEventListener("click", () => {
      generateVideoSegment(item.name).catch((error) => {
        toast(error.message);
        if (state.selectedId) loadProject(state.selectedId, { openStudio: false }).catch(() => {});
      });
    });
    card.querySelector("[data-segment-preview]")?.addEventListener("click", () => openVideoPreview(item));
    node.appendChild(card);
  }
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
  const dialogueLanguage = document.querySelector("input[name='draftDialogueLanguage']:checked")?.value || "en";
  const assetAnalyzerModel = document.querySelector("input[name='assetAnalyzerModel']:checked")?.value || "claude-opus-4-8";
  state.assetAnalyzerModel = normalizeAssetAnalyzerModel(assetAnalyzerModel);
  localStorage.setItem("pixelToys.assetAnalyzerModel", state.assetAnalyzerModel);
  await saveFileQuiet("script");
  state.uiBusy.assetExtracting = true;
  renderWorkspace();
  toast("正在生成分镜草稿并解析资产");
  try {
    const data = await api(`/api/project/${state.selectedId}/draft`, {
      method: "POST",
      body: JSON.stringify({ dialogueLanguage, assetAnalyzerModel: state.assetAnalyzerModel }),
    });
    setProjectState(data.state);
    toast("资产解析、分镜和提示词草稿已生成，请先确认解析结果");
  } finally {
    state.uiBusy.assetExtracting = false;
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
      }),
    });
    setProjectState(data.state);
    $("#scriptText").value = data.state?.contents?.script || scriptText;
    renderWorkspace();
    toast(`已转换 ${data.result?.count || 0} 段对白`);
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
  await refreshVideoConfig({ silent: false });
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
    const referenceId = event.target.closest("[data-image-reference-remove]")?.dataset.imageReferenceRemove;
    if (referenceId) {
      const reference = state.imageStudio.references.find((item) => item.id === referenceId);
      if (reference?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(reference.previewUrl);
      state.imageStudio.references = state.imageStudio.references.filter((reference) => reference.id !== referenceId);
      renderImageExploreView();
      return;
    }
    const imageId = event.target.closest("[data-image-remove]")?.dataset.imageRemove;
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
      if (!target) return;
      beginImageExploreGeneration();
      replaceImageExploreHistoryItem(target.id, { status: "running", message: "" });
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
      const item = state.imageStudio.history.find((entry) => entry.id === previewId);
      if (item?.status === "completed") openImageExplorePreview(item);
    }
  });
  $("#imageExploreView")?.addEventListener("keydown", (event) => {
    const preview = event.target.closest?.("[data-image-preview]");
    if (!preview || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const item = state.imageStudio.history.find((entry) => entry.id === preview.dataset.imagePreview);
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
  $("#saveAssetPrompt")?.addEventListener("click", () => saveAssetPrompt().catch((error) => toast(error.message)));
  $("#regenerateAssetFromInspector")?.addEventListener("click", () => regenerateSelectedAssetFromInspector().catch((error) => toast(error.message)));
  $("#refreshState").addEventListener("click", () => {
    if (!state.selectedId) return toast("请先打开一个项目");
    loadProject(state.selectedId, { openStudio: false }).catch((error) => toast(error.message));
  });
  $("#generateAllSegments")?.addEventListener("click", () => {
    generateAllVideoSegments().catch((error) => toast(error.message));
  });
  $("#assembleFinalCutBtn")?.addEventListener("click", () => {
    assembleFinalCut();
  });
  $("#chatcutEditBtn")?.addEventListener("click", () => startChatcutEditing());
  $("#zoomOut").addEventListener("click", () => setWorkspaceScale(state.workspaceScale - 0.08));
  $("#zoomIn").addEventListener("click", () => setWorkspaceScale(state.workspaceScale + 0.08));
  $("#zoomFit").addEventListener("click", fitWorkspaceScale);
  $("#resetLayout").addEventListener("click", () => {
    resetWindowLayout();
    toast("工作台布局已重置");
  });
  $("#scriptUpload").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const isDocx = /\.docx$/i.test(file.name);
      const text = isDocx
        ? (
            await api("/api/extract-script", {
              method: "POST",
              body: JSON.stringify({ filename: file.name, contentBase64: await fileBase64(file) }),
            })
          ).text
        : await file.text();
      document.querySelector("textarea[name='scriptText']").value = text;
      $("#scriptUploadName").textContent = file.name;
      if (!document.querySelector("input[name='title']").value) {
        document.querySelector("input[name='title']").value = file.name.replace(/\.(md|txt|docx)$/i, "");
      }
      toast(isDocx ? "DOCX 剧本已提取" : "剧本已载入");
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
    button.addEventListener("click", () => saveFile(button.dataset.save).catch((error) => toast(error.message)));
  });
  $$("[data-job]").forEach((button) => {
    button.addEventListener("click", () =>
      startJob(button.dataset.job).catch(async (error) => {
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
  $("#draftBtn")?.addEventListener("click", () => extractAssets().catch((error) => toast(error.message)));
  $("#extractAssetsBtn")?.addEventListener("click", () => generateDraft().catch((error) => toast(error.message)));
  $("#confirmAssetManifestBtn")?.addEventListener("click", () => saveAssetManifest({ confirm: true }).catch((error) => toast(error.message)));
  $("#buildConfigBtn")?.addEventListener("click", () => buildConfig().catch((error) => toast(error.message)));
  ["configPromptMode", "configRatio", "configResolution", "configModel"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => refreshVideoConfig({ silent: true }).catch((error) => toast(error.message)));
  });
}

bind();
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
  if (hasOpenAssetEditDraft() || hasOpenManualAssetDraft()) return false;
  window._pixelToysRefreshInFlight = true;
  try {
    const status = await api(`/api/project/${state.selectedId}/status`);
    mergeProjectStatus(status);
    renderProjectList();
    renderVideoConfigStatus(state.project?.videoConfigStatus || {});
    renderVideoProgress(state.project?.videoProgress || { total: 0, completed: 0, items: [] });
    renderFinalCut(state.project?.finalCut || null);
    renderStudioFlowStatus(state.project);
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
