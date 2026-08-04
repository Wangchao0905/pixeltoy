const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

// Legacy person-asset channel. Canvas state is not always persisted, so
// remember the last-used channel id and fall back to a sane default.
const LAST_CHANNEL_ID_KEY = "pixelToys.lastChannelId";
const DEFAULT_CHANNEL_ID = "81";
const LAST_PROJECT_ID_KEY = "pixelToys.canvasProjectId";
const CANVAS_AGENT_DEFAULT_MODEL = "claude-opus-5";
const CANVAS_AGENT_MODELS = new Set(["claude-opus-5", "gpt-5.6-sol", "grok-4.5"]);
const CANVAS_AGENT_MAX_ATTACHMENTS = 8;

function rememberedChannelId() {
  try {
    return (localStorage.getItem(LAST_CHANNEL_ID_KEY) || "").trim() || DEFAULT_CHANNEL_ID;
  } catch {
    return DEFAULT_CHANNEL_ID;
  }
}

function rememberedProjectId() {
  try {
    return (localStorage.getItem(LAST_PROJECT_ID_KEY) || "").trim();
  } catch {
    return "";
  }
}


function defaultLivenessLibraryState() {
  return {
    name: "人物素材组",
    description: "",
    channelId: rememberedChannelId(),
    groupId: "",
    groupType: "aigc",
    status: "idle",
    assetName: "portrait.jpg",
    assetUrl: "",
    localAssetUrl: "",
    publicAssetReady: false,
    assets: [],
    hiddenAssetUrls: [],
    error: "",
    collapsed: false,
  };
}

function isStaleLivenessVerificationError(message = "") {
  return /真人核验超时|核验超时|重新创建链接/.test(String(message || ""));
}

function normalizeLivenessLibraryState(library = {}) {
  const normalized = {
    ...defaultLivenessLibraryState(),
    ...library,
    assets: Array.isArray(library.assets) ? library.assets.filter(Boolean) : [],
    hiddenAssetUrls: Array.isArray(library.hiddenAssetUrls) ? library.hiddenAssetUrls.filter(Boolean) : [],
  };
  if (normalized.groupId && isStaleLivenessVerificationError(normalized.error)) {
    normalized.status = normalized.status === "failed" ? "active" : normalized.status;
    normalized.error = "";
  }
  return normalized;
}

function projectVideoCanvasId(project = {}) {
  let config = {};
  try {
    config = JSON.parse(project?.contents?.config || "{}");
  } catch {
    config = {};
  }
  return String(project?.videoConfigStatus?.videoCanvasId || config.videoCanvasId || config.canvasProjectId || "").trim();
}

function syncCanvasUrl(projectId = "", canvasId = "") {
  const params = new URLSearchParams(window.location.search);
  let changed = false;
  if (projectId && params.get("project") !== projectId) {
    params.set("project", projectId);
    changed = true;
  } else if (!projectId && params.has("project")) {
    params.delete("project");
    changed = true;
  }
  if (canvasId && params.get("canvas") !== canvasId) {
    params.set("canvas", canvasId);
    changed = true;
  } else if (!canvasId && params.has("canvas")) {
    params.delete("canvas");
    changed = true;
  }
  if (changed) {
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }
}

const params = new URLSearchParams(window.location.search);
const initialProjectId = params.get("project") || "";
const initialCanvasId = params.get("canvas") || "";
const initialCanvasBootstrap = params.get("bootstrap") === "1";
let sharedAssetLibraryRequest = null;
let sharedAssetLibraryRequestKey = "";
let sharedAssetLibrarySearchTimer = null;
const canvasState = {
  selectedId: initialProjectId,
  canvasId: initialCanvasId,
  project: null,
  nodes: [],
  connections: [],
  assets: [],
  nextNodeId: 1,
  menuPoint: { x: 0, y: 0 },
  drag: null,
  resize: null,
  selectedNodeIds: new Set(),
  marquee: null,
  connectDrag: null,
  pendingConnection: null,
  connectionMenu: null,
  nodeMenu: null,
  assetMenu: null,
  ignoreNextConnectionMenuClick: false,
  ignoreNextBlankClick: false,
  mentionMenu: null,
  pollTimers: new Map(),
  arkPersonPollTimers: new Map(),
  viewport: { x: 0, y: 0, scale: 1 },
  viewportPan: null,
  viewportPanFrame: 0,
  sharedAssetLibrary: {
    assets: [],
    search: "",
    loaded: false,
    open: false,
  },
  livenessLibrary: defaultLivenessLibraryState(),
  livenessRefreshTimer: null,
  livenessSubmitting: false,
  pendingLivenessSubmitAfterVerification: false,
  activeVideoNodeId: "",
  stateUpdatedAt: "",
  hydrating: true,
  saveTimer: null,
  viewportMoveTimer: null,
  dragFrame: 0,
  layoutChanged: false,
  magnetEnabled: true,
  marqueeFrame: 0,
  connectionFrame: 0,
  hotspotFrame: 0,
  hotspotPoint: null,
  canvasDragOverActive: false,
  gestureScaleStart: 1,
  gestureLastScale: 1,
  gestureWheelBlockUntil: 0,
  canvasAgentModel: CANVAS_AGENT_DEFAULT_MODEL,
  canvasAgentMessages: [],
  canvasAgentActivities: [],
  canvasAgentAttachments: [],
  canvasAgentController: null,
  canvasAgentSending: false,
};

const VIDEO_NODE_DEFAULTS = {
  model: "seedance-2-0",
  ratio: "16:9",
  duration: "5",
  resolution: "720p",
  generateAudio: true,
  frameControl: "reference",
  firstFrameAssetId: "",
  lastFrameAssetId: "",
};

const PERSON_REFERENCE_MODEL = "seedance-2-0-person-reference";
const LIVENESS_MODEL = "seedance-2-0-liveness-face";
// 海外火山(BytePlus ModelArk)通道:选它这次生成走 ap-southeast 区,底层同 Seedance 2.0。
const BYTEPLUS_MODEL = "seedance-2-0-byteplus";
const ARK_PERSON_VERIFY_URL = "https://console.volcengine.com/ark/region:ark+cn-beijing/experience/vision?modelId=doubao-seedance-2-0-260128";
const ARK_PERSON_TARGET_MODELS = new Set([
  "seedance-2-0",
  "seedance-2-0-fast",
  "seedance-2-0-mini",
]);
const LEGACY_MODEL_MIGRATIONS = {
  [LIVENESS_MODEL]: PERSON_REFERENCE_MODEL,
};
const VIDEO_MODEL_LABELS = {
  "seedance-2-0": "Seedance 2.0",
  "seedance-2-0-fast": "Seedance 2.0 Fast",
  "seedance-2-0-mini": "Seedance 2.0 Mini",
  [PERSON_REFERENCE_MODEL]: "Seedance 2.0 · 人物参考",
  [BYTEPLUS_MODEL]: "Seedance 2.0(海外火山)",
};
// 海外火山(BytePlus)会对生成的音频做内容审核,判定敏感就整段失败。命中这个错误时自动关音频重试一次。
// 同时匹配 BytePlus 原文与服务端翻译后的中文提示(server 会把该错误归一化成"…音频被海外火山判定含敏感…")。
const OUTPUT_AUDIO_SENSITIVE_RE = /output audio.*(sensitive|敏感)|OutputAudioSensitiveContentDetected|音频[^。]*敏感/i;
// 记录本次会话里已因音频敏感自动重试过的视频节点,避免无限重试。
const audioRetriedVideoNodes = new Set();
// 画布可拖拽上传的文件类型:图片 + 视频。视频会在服务端抽首帧作为参考图。
const CANVAS_UPLOAD_ACCEPT_RE = /\.(png|jpe?g|webp|mp4|mov|webm|m4v)$/i;
const CANVAS_VIDEO_FILE_RE = /\.(mp4|mov|webm|m4v)$/i;
const VIDEO_PREVIEW_RATIOS = {
  "9:16": "9 / 16",
  "16:9": "16 / 9",
  "3:4": "3 / 4",
  "4:3": "4 / 3",
  "1:1": "1 / 1",
  "21:9": "21 / 9",
  adaptive: "9 / 16",
};
const VIDEO_PREVIEW_WIDTHS = Object.freeze({
  "9:16": 196,
  "16:9": 420,
  "3:4": 240,
  "4:3": 390,
  "1:1": 300,
  "21:9": 500,
  adaptive: 196,
});
const CANVAS_NODE_RATIO_DIMENSIONS = Object.freeze({
  "9:16": { width: 9, height: 16, preferredWidth: 420 },
  "16:9": { width: 16, height: 9, preferredWidth: 620 },
  "3:4": { width: 3, height: 4, preferredWidth: 460 },
  "4:3": { width: 4, height: 3, preferredWidth: 580 },
  "1:1": { width: 1, height: 1, preferredWidth: 520 },
  "21:9": { width: 21, height: 9, preferredWidth: 700 },
  adaptive: { width: 9, height: 16, preferredWidth: 520 },
});
const IMAGE_NODE_DEFAULTS = {
  model: "gpt-image-2",
  ratio: "16:9",
  resolution: "1k",
};
// 视频编辑器外壳以桌面端 16:9 布局为基准固定尺寸；所选比例只影响槽内画面。
const VIDEO_EDITOR_DEFAULT_WIDTH = 620;
const VIDEO_EDITOR_DEFAULT_HEIGHT = 650;
const CANVAS_MIN_SCALE = 0.02;
const CANVAS_SNAP_DISTANCE = 16;
const CANVAS_ZOOM_SPEED = 0.0048;
const ASSET_NODE_DEFAULT_WIDTH = 400;
const ASSET_NODE_DEFAULT_HEIGHT = 280;
const ASSET_NODE_MIN_WIDTH = 96;
const ASSET_NODE_MAX_WIDTH = 640;
const ASSET_NODE_MIN_HEIGHT = 64;
const ASSET_NODE_MAX_HEIGHT = 560;
const VIDEO_NODE_DEFAULT_WIDTH = VIDEO_EDITOR_DEFAULT_WIDTH;
const VIDEO_NODE_DEFAULT_HEIGHT = VIDEO_EDITOR_DEFAULT_HEIGHT;
const VIDEO_NODE_MIN_WIDTH = 420;
const VIDEO_NODE_MAX_WIDTH = 1400;
const VIDEO_NODE_MIN_HEIGHT = 420;
const VIDEO_NODE_MAX_HEIGHT = 1400;
const IMAGE_NODE_DEFAULT_WIDTH = 480;
const IMAGE_NODE_DEFAULT_HEIGHT = 620;
const IMAGE_NODE_MIN_WIDTH = 360;
const IMAGE_NODE_MAX_WIDTH = 1200;
const IMAGE_NODE_MIN_HEIGHT = 420;
const IMAGE_NODE_MAX_HEIGHT = 1400;
const RATIO_LAYOUT_CHROME_HEIGHT = { image: 430, video: 300 };
const API_DEFAULT_TIMEOUT_MS = 45_000;
const VIDEO_SUBMIT_TIMEOUT_MS = 150_000;
const VIDEO_SUBMIT_STALE_MS = 2 * 60_000;
// 视频/图片生成结果统一的下载按钮图标（悬停节点时显示）。
const DOWNLOAD_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 11 5 5 5-5"></path><path d="M5 21h14"></path></svg>';
const CAMERA_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h3l1.5-2h7L17 7.5h3A1.5 1.5 0 0 1 21.5 9v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"></path><circle cx="12" cy="13.5" r="3.5"></circle></svg>';

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const node = qs("#canvasToast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.add("hidden"), 2600);
}

// A cancelled timeout does not cancel an already-running fetch. Keep a
// per-node generation token so late responses from an older generation can
// never restore its video or tail frame.
const videoGenerationTokens = new Map();

function beginVideoGeneration(nodeId) {
  const token = Symbol(`video-generation:${nodeId}`);
  videoGenerationTokens.set(nodeId, token);
  return token;
}

function ensureVideoGenerationToken(nodeId) {
  let token = videoGenerationTokens.get(nodeId);
  if (!token) token = beginVideoGeneration(nodeId);
  return token;
}

function videoOperationIsCurrent(nodeId, options = {}) {
  const { generationToken = null, taskId = "" } = options;
  if (generationToken && videoGenerationTokens.get(nodeId) !== generationToken) return false;
  if (taskId) {
    const node = canvasState.nodes.find((item) => item.id === nodeId);
    if (node?.taskId && node.taskId !== taskId) return false;
  }
  return true;
}

function clearVideoPoll(nodeId) {
  const timer = canvasState.pollTimers.get(nodeId);
  if (timer) clearTimeout(timer);
  canvasState.pollTimers.delete(nodeId);
}

// After a segment's video completes, its tail frame is still being extracted
// server-side (download + ffmpeg) for a few more seconds. Status polling has
// already stopped by then, so the "尾帧已就绪" update would otherwise only show
// after a manual page refresh. Do a few bounded, delayed project re-syncs to
// pick up the tail frame automatically, then stop.
function scheduleTailFrameSync(nodeId, attempt = 0, generationToken = ensureVideoGenerationToken(nodeId)) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (
    !node ||
    node.kind !== "video" ||
    node.tailFrameReady ||
    attempt >= 4 ||
    !videoOperationIsCurrent(nodeId, { generationToken, taskId: node.taskId || "" })
  ) return;
  const timer = setTimeout(async () => {
    if (!videoOperationIsCurrent(nodeId, { generationToken, taskId: node.taskId || "" })) return;
    try {
      if (canvasState.selectedId) {
        await loadProject(canvasState.selectedId, {
          preserveSelection: true,
          silent: true,
          videoGeneration: { nodeId, generationToken },
        });
      }
    } catch {}
    if (!videoOperationIsCurrent(nodeId, { generationToken, taskId: node.taskId || "" })) return;
    const fresh = canvasState.nodes.find((item) => item.id === nodeId);
    if (fresh && fresh.kind === "video" && !fresh.tailFrameReady) {
      scheduleTailFrameSync(nodeId, attempt + 1, generationToken);
    }
  }, videoPollDelay(5000));
  canvasState.pollTimers.set(nodeId, timer);
}

function canvasStorageProjectId() {
  return canvasState.canvasId || canvasState.selectedId || "standalone";
}

function stripBlobUrlsFromAsset(asset = {}) {
  // blob: 地址是本地临时预览,只在本次会话有效。上传未完成就保存/刷新时,别把它落库,
  // 否则重新加载后是死链。清掉后该素材恢复成"无预览",上传完成后会被公网地址覆盖。
  const isBlob = (v) => typeof v === "string" && v.startsWith("blob:");
  if (!isBlob(asset.url) && !isBlob(asset.previewUrl) && !isBlob(asset.videoUrl)) return asset;
  const next = { ...asset };
  if (isBlob(next.url)) next.url = next.publicUrl || "";
  if (isBlob(next.previewUrl)) next.previewUrl = "";
  if (isBlob(next.videoUrl)) next.videoUrl = next.publicUrl || "";
  return next;
}

function serializableCanvasState() {
  return {
    projectId: canvasStorageProjectId(),
    baseUpdatedAt: canvasState.stateUpdatedAt,
    nextNodeId: canvasState.nextNodeId,
    viewport: canvasState.viewport,
    assets: canvasState.assets.map(stripBlobUrlsFromAsset),
    nodes: canvasState.nodes,
    connections: canvasState.connections,
    livenessLibrary: canvasState.livenessLibrary,
  };
}

function createCanvasProjectId() {
  return `canvas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let standalonePromotionPromise = null;

function shouldPromoteStandaloneCanvas(force = false) {
  return !canvasState.selectedId
    && !canvasState.canvasId
    && !initialCanvasId
    && (force || canvasState.assets.length > 0 || canvasState.nodes.length > 0);
}

async function promoteStandaloneCanvas({ force = false } = {}) {
  if (!shouldPromoteStandaloneCanvas(force)) return false;
  if (standalonePromotionPromise) return standalonePromotionPromise;
  const projectId = createCanvasProjectId();
  const payload = { ...serializableCanvasState(), projectId, name: "Untitled" };
  standalonePromotionPromise = api("/api/canvas/state", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((data) => {
    canvasState.canvasId = projectId;
    canvasState.stateUpdatedAt = data.state?.updatedAt || canvasState.stateUpdatedAt;
    localStorage.setItem(LAST_PROJECT_ID_KEY, projectId);
    localStorage.setItem("pixelToys.lastBlankCanvasId", projectId);
    syncCanvasUrl("", projectId);
    return true;
  }).finally(() => {
    standalonePromotionPromise = null;
  });
  return standalonePromotionPromise;
}

function stripDataUrlFromAsset(asset = {}) {
  const next = { ...asset };
  if (/^data:image\//i.test(String(next.url || ""))) {
    next.url = next.publicUrl || next.public_url || next.previewUrl || next.preview_url || "";
  }
  if (/^data:image\//i.test(String(next.previewUrl || ""))) {
    next.previewUrl = next.localUrl || next.publicUrl || next.url || "";
  }
  return next;
}

function hasPendingCanvasAssetUploads() {
  return canvasState.assets.some((asset) => asset?.uploading && [asset.url, asset.previewUrl, asset.videoUrl]
    .some((value) => typeof value === "string" && value.startsWith("blob:")));
}

function scheduleCanvasSave() {
  if (canvasState.hydrating) return;
  clearTimeout(canvasState.saveTimer);
  // Do not let a pending local preview overwrite a completed upload with an empty URL.
  if (hasPendingCanvasAssetUploads()) return;
  canvasState.saveTimer = setTimeout(() => {
    promoteStandaloneCanvas().then(() => api("/api/canvas/state", {
      method: "POST",
      body: JSON.stringify(serializableCanvasState()),
    })).then((data) => {
      canvasState.stateUpdatedAt = data.state?.updatedAt || canvasState.stateUpdatedAt;
    }).catch((error) => console.warn("canvas save failed", error));
  }, 600);
}

function flushCanvasSave() {
  if (canvasState.hydrating) return;
  clearTimeout(canvasState.saveTimer);
  if (hasPendingCanvasAssetUploads()) return;
  const payload = JSON.stringify(serializableCanvasState());
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/canvas/state", new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch("/api/canvas/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

function normalizeRestoredNode(node = {}) {
  const kind = ["image", "video", "asset"].includes(node.kind) ? node.kind : "image";
  const restoredSettings = { ...(node.settings || {}) };
  if (restoredSettings.model && LEGACY_MODEL_MIGRATIONS[restoredSettings.model]) {
    restoredSettings.model = LEGACY_MODEL_MIGRATIONS[restoredSettings.model];
  }
  const restored = {
    id: node.id || `node_${Date.now()}_${canvasState.nextNodeId++}`,
    kind,
    x: Number(node.x) || 80,
    y: Number(node.y) || 80,
    assets: Array.isArray(node.assets) ? node.assets.filter(Boolean) : [],
    prompt: node.prompt || "",
    source: node.source || "",
    projectShotName: node.projectShotName || node.shotName || "",
    videoPromptMode: node.videoPromptMode || "",
    storyboardRefs: Array.isArray(node.storyboardRefs) ? node.storyboardRefs.filter(Boolean) : [],
    storyboardGuidance: node.storyboardGuidance || null,
    referenceKitId: node.referenceKitId || "",
    referenceKitName: node.referenceKitName || "",
    referenceKitVersion: Number(node.referenceKitVersion || 0) || 0,
    referenceKitSnapshot: node.referenceKitSnapshot || null,
  };
  if (kind === "asset") {
    const legacyDefaultSize = Number(node.width) === 224 && Number(node.height) === 148;
    restored.width = legacyDefaultSize
      ? ASSET_NODE_DEFAULT_WIDTH
      : clampAssetNodeDimension(node.width, ASSET_NODE_MIN_WIDTH, ASSET_NODE_MAX_WIDTH, ASSET_NODE_DEFAULT_WIDTH);
    restored.height = legacyDefaultSize
      ? ASSET_NODE_DEFAULT_HEIGHT
      : clampAssetNodeDimension(node.height, ASSET_NODE_MIN_HEIGHT, ASSET_NODE_MAX_HEIGHT, ASSET_NODE_DEFAULT_HEIGHT);
  }
  if (kind === "image") {
    const imageSettings = { ...IMAGE_NODE_DEFAULTS, ...restoredSettings };
    // 恢复:早期版本服务端没持久化 imageUrl,轮询 reload 会把内存里的 imageUrl 清空,
    // 只剩 status=completed + taskId。画布出图文件名固定为 canvas-image-<taskId>.png,
    // 据此从 taskId 重建 imageUrl,恢复已损坏节点的预览(不影响生成中的节点)。
    const recoveredImageUrl =
      node.imageUrl || (node.status === "completed" && node.taskId ? `/public-assets/canvas-image-${node.taskId}.png` : "");
    Object.assign(restored, {
      width: clampNodeDimension(node.width, IMAGE_NODE_MIN_WIDTH, IMAGE_NODE_MAX_WIDTH, IMAGE_NODE_DEFAULT_WIDTH),
      height: clampNodeDimension(node.height, IMAGE_NODE_MIN_HEIGHT, IMAGE_NODE_MAX_HEIGHT, IMAGE_NODE_DEFAULT_HEIGHT),
      settings: imageSettings,
      ratioLayoutRatio: node.ratioManualSize === true ? imageSettings.ratio : "",
      ratioManualSize: node.ratioManualSize === true,
      status: recoveredImageUrl ? "completed" : node.status || "idle",
      statusMessage: node.statusMessage || "",
      imageUrl: recoveredImageUrl,
      generatedAssetId: node.generatedAssetId || "",
      taskId: node.taskId || "",
    });
  }
  if (kind === "video") {
    const legacyDefaultSize = Number(node.width) === 780 && Number(node.height) === 780;
    const hasTask = !!node.taskId;
    const submittedAt = node.submittedAt || "";
    const submittedAtMs = Date.parse(submittedAt || "");
    const staleSubmitting =
      node.status === "running" &&
      !node.videoUrl &&
      !node.taskId &&
      /提交\s*Seedance|正在提交/i.test(String(node.statusMessage || "")) &&
      (!submittedAtMs || Date.now() - submittedAtMs > VIDEO_SUBMIT_STALE_MS);
    const rawStatus = String(node.status || "").toLowerCase();
    const activeStatus = ["running", "queued", "pending"].includes(rawStatus);
    const restoredStatus = staleSubmitting
      ? "failed"
      : activeStatus
        ? rawStatus
        : node.videoUrl
          ? "completed"
          : rawStatus || "idle";
    const restoredProgress = restoredStatus === "running"
      ? null
      : Number.isFinite(Number(node.progress))
        ? Number(node.progress)
        : null;
    Object.assign(restored, {
      width: clampNodeDimension(legacyDefaultSize ? VIDEO_NODE_DEFAULT_WIDTH : node.width, VIDEO_NODE_MIN_WIDTH, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_DEFAULT_WIDTH),
      height: clampNodeDimension(legacyDefaultSize ? VIDEO_NODE_DEFAULT_HEIGHT : node.height, VIDEO_NODE_MIN_HEIGHT, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_DEFAULT_HEIGHT),
      settings: { ...VIDEO_NODE_DEFAULTS, ...restoredSettings },
      ratioLayoutRatio: node.ratioManualSize === true ? (restoredSettings.ratio || VIDEO_NODE_DEFAULTS.ratio) : "",
      ratioManualSize: node.ratioManualSize === true,
      liveness: { name: "真人A", description: "", status: "idle", assetUrl: "", ...(node.liveness || {}) },
      status: restoredStatus,
      statusMessage: staleSubmitting
        ? "提交视频任务超时：没有拿到 taskId，请重新生成"
        : node.status === "running" && !node.videoUrl ? node.statusMessage || "任务已提交，等待接口返回结果" : node.statusMessage || "",
      // A server refresh can briefly return the previous URL while the new
      // generation is running. Never render that stale media as the result.
      videoUrl: activeStatus ? "" : node.videoUrl || "",
      taskId: hasTask ? node.taskId || "" : "",
      taskProvider: hasTask ? node.taskProvider || "" : "",
      videoPreviewVersion: node.videoPreviewVersion || "",
      progress: restoredProgress,
      submittedAt,
      startFrameUrl: node.startFrameUrl || "",
      tailFrameSourceNodeId: node.tailFrameSourceNodeId || "",
      tailFrameSourceName: node.tailFrameSourceName || "",
      tailFrameReady: node.tailFrameReady === true,
      tailFrameUrl: node.tailFrameUrl || "",
      tailFrameLocalFile: node.tailFrameLocalFile || "",
      tailFrameFileUrl: node.tailFrameFileUrl || "",
      tailFrameMessage: node.tailFrameMessage || "",
    });
  }
  return restored;
}

function restoreCanvasState(saved = null) {
  if (!saved || typeof saved !== "object") return false;
  canvasState.stateUpdatedAt = String(saved.updatedAt || "");
  canvasState.assets = Array.isArray(saved.assets) ? saved.assets.filter((asset) => asset?.id && asset?.url) : [];
  canvasState.nodes = Array.isArray(saved.nodes) ? saved.nodes.map(normalizeRestoredNode) : [];
  canvasState.layoutChanged = repairVideoNodeOverlaps(canvasState.nodes);
  const nodeIds = new Set(canvasState.nodes.map((node) => node.id));
  canvasState.connections = Array.isArray(saved.connections)
    ? saved.connections.filter((connection) => nodeIds.has(connection.from) && nodeIds.has(connection.to))
    : [];
  canvasState.nextNodeId = Math.max(Number(saved.nextNodeId || 1), canvasState.nodes.length + 1, 1);
  if (saved.viewport && typeof saved.viewport === "object") {
    canvasState.viewport = {
      x: Number(saved.viewport.x) || 0,
      y: Number(saved.viewport.y) || 0,
      scale: clampCanvasScale(Number(saved.viewport.scale) || 1),
    };
  }
  if (saved.livenessLibrary && typeof saved.livenessLibrary === "object") {
    canvasState.livenessLibrary = normalizeLivenessLibraryState({
      ...canvasState.livenessLibrary,
      ...saved.livenessLibrary,
      assets: Array.isArray(saved.livenessLibrary.assets) ? saved.livenessLibrary.assets.filter(Boolean) : [],
    });
  }
  return true;
}

async function api(path, options = {}) {
  const timeoutMs = Number(options.timeoutMs || API_DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      ...options,
      cache: "no-store",
      signal: options.signal || controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`请求超时：${path}。服务器未在 ${Math.round(timeoutMs / 1000)} 秒内返回，请稍后重试。`);
    }
    throw new Error(`请求没有到达服务器：${path}。请确认当前是 https://pixeltoy.cn 页面、已登录，并刷新后重试。`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function sharedLibraryAssetToCanvasAsset(asset = {}) {
  const url = asset.url || asset.publicUrl || asset.public_url || asset.localUrl || asset.local_url || asset.previewUrl || "";
  const imageGenerationAsset = asset.source === "image-generation" || asset.aiGenerated === true;
  return stripDataUrlFromAsset({
    id: `library_${asset.id}`,
    name: asset.name || "素材库图片",
    type: asset.type || "Library",
    url,
    previewUrl: libraryPreviewUrl({
      ...asset,
      previewUrl: asset.previewUrl || asset.preview_url || asset.localUrl || asset.local_url || url,
    }, 480),
    // 保留素材库的各类地址，认证服务端会在旧 HTTP、HTTPS 和本地镜像之间择优。
    publicUrl: asset.publicUrl || asset.public_url || "",
    localUrl: asset.localUrl || asset.local_url || "",
    // 素材库进入独立画布后始终保留独立来源,避免后续拖拽触发工作流自动认证。
    source: "shared-asset-library",
    librarySource: asset.source || "",
    description: asset.description || asset.prompt || asset.visual || asset.evidence || asset.metadata?.description || "",
    prompt: asset.prompt || asset.description || asset.visual || asset.evidence || asset.metadata?.description || "",
    ratio: asset.ratio || "",
    resolution: asset.resolution || "",
    assetStylePreset: asset.assetStylePreset || (imageGenerationAsset ? "photoreal" : ""),
    assetStyleLabel: asset.assetStyleLabel || (imageGenerationAsset ? "AI 写实" : ""),
    generationMode: asset.generationMode || (imageGenerationAsset ? "ai-generated" : ""),
    verificationType: asset.verificationType || (imageGenerationAsset ? "ai-generated" : ""),
    manifestType: asset.manifestType || asset.assetType || "",
    aiGenerated: asset.aiGenerated === true,
    libraryAssetId: asset.id || "",
  });
}

function isImageGeneratedLibraryAsset(asset = {}) {
  if (asset.scope === "team" || asset.source === "team-project") return true;
  const source = `${asset.source || ""} ${asset.generationMode || ""} ${asset.metadata?.tool || ""}`;
  const type = String(asset.type || "").toLowerCase();
  if (/video|mp4|mov|webm/.test(type)) return false;
  return /image-generation|canvas-image|gpt[-_ ]?image|image generation/i.test(source) || asset.aiGenerated === true;
}

function isCanvasLibraryImageAsset(asset = {}) {
  const type = `${asset.type || ""} ${asset.source || ""}`.toLowerCase();
  if (/video|mp4|mov|webm/.test(type)) return false;
  return Boolean(asset.url || asset.publicUrl || asset.localUrl || asset.previewUrl);
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

function renderHtmlInBatches(node, items, renderItem, { batchSize = 24, onComplete = null } = {}) {
  if (!node) return;
  const token = (Number(node.dataset.renderToken) || 0) + 1;
  node.dataset.renderToken = String(token);
  node.innerHTML = "";
  let index = 0;
  const append = () => {
    if (node.dataset.renderToken !== String(token)) return;
    const end = Math.min(items.length, index + batchSize);
    if (end > index) node.insertAdjacentHTML("beforeend", items.slice(index, end).map(renderItem).join(""));
    index = end;
    if (index < items.length) requestAnimationFrame(append);
    else onComplete?.();
  };
  append();
}

function renderSharedAssetLibrary() {
  const list = qs("#canvasAssetLibraryList");
  if (!list) return;
  const assets = canvasState.sharedAssetLibrary.assets || [];
  if (!assets.length) {
    list.innerHTML = `<div class="canvas-asset-library-empty">素材库暂无图片</div>`;
    return;
  }
  renderHtmlInBatches(list, assets, (asset) => {
        const id = escapeHtml(asset.id || "");
        const name = escapeHtml(asset.name || "未命名素材");
        const preview = escapeHtml(libraryPreviewUrl(asset, 360));
        const metaSource = asset.scope === "team" ? "团队共享" : isImageGeneratedLibraryAsset(asset) ? "Image 生成" : asset.source || "素材";
        const meta = escapeHtml([metaSource, asset.metadata?.sourceProjectName || "", asset.ratio, asset.resolution].filter(Boolean).join(" · "));
        return `<article class="canvas-asset-library-card" draggable="true" data-shared-library-id="${id}">
          <button class="canvas-asset-library-card-preview" type="button" data-shared-library-preview="${id}" aria-label="选择${name}加入画布">
            <img src="${preview}" alt="${name}" loading="lazy" decoding="async" />
          </button>
          <div><strong>${name}</strong><span>${meta}</span></div>
          <div class="canvas-asset-library-card-actions">
            <button class="primary" type="button" data-shared-library-use="${id}">加入画布</button>
          </div>
        </article>`;
  });
}

async function loadSharedAssetLibrary({ search = canvasState.sharedAssetLibrary.search, silent = false } = {}) {
  const nextSearch = String(search || "");
  if (sharedAssetLibraryRequest && sharedAssetLibraryRequestKey === nextSearch) return sharedAssetLibraryRequest;
  canvasState.sharedAssetLibrary.search = nextSearch;
  const request = (async () => {
    const requestParams = new URLSearchParams();
    requestParams.set("limit", "500");
    if (nextSearch) requestParams.set("search", nextSearch);
    const data = await api(`/api/asset-library?${requestParams}`);
    if (canvasState.sharedAssetLibrary.search !== nextSearch) return canvasState.sharedAssetLibrary.assets;
    canvasState.sharedAssetLibrary.assets = (Array.isArray(data.assets) ? data.assets : []).filter(isCanvasLibraryImageAsset);
    canvasState.sharedAssetLibrary.loaded = true;
    renderSharedAssetLibrary();
    if (!silent) toast(`素材库已加载 ${canvasState.sharedAssetLibrary.assets.length} 个资产`);
    return canvasState.sharedAssetLibrary.assets;
  })();
  sharedAssetLibraryRequest = request;
  sharedAssetLibraryRequestKey = nextSearch;
  try {
    return await request;
  } finally {
    if (sharedAssetLibraryRequest === request) {
      sharedAssetLibraryRequest = null;
      sharedAssetLibraryRequestKey = "";
    }
  }
}

function addSharedLibraryAsset(asset = {}, { node = true, point = null, silent = false } = {}) {
  const converted = sharedLibraryAssetToCanvasAsset(asset);
  if (!converted.id || !converted.url) return toast("素材库图片地址不可用");
  addAssets([converted]);
  if (node) {
    addAssetNodeAt(converted.id, point || nextAvailableAssetNodePoint(), { silent: true });
  }
  if (!silent) toast(`已将「${asset.name || "素材"}」加入画布`);
}

function openSharedAssetLibraryFromMenu() {
  hideContextMenu();
  toggleSharedAssetLibrary(true);
}

function toggleSharedAssetLibrary(open = !canvasState.sharedAssetLibrary.open) {
  canvasState.sharedAssetLibrary.open = !!open;
  const panel = qs("#sharedAssetLibraryPanel");
  const toggle = qs("#assetLibraryToggle");
  panel?.classList.toggle("hidden", !canvasState.sharedAssetLibrary.open);
  toggle?.setAttribute("aria-expanded", canvasState.sharedAssetLibrary.open ? "true" : "false");
  if (canvasState.sharedAssetLibrary.open && !canvasState.sharedAssetLibrary.loaded) {
    loadSharedAssetLibrary({ silent: true }).catch((error) => toast(error.message));
  }
}

function clearLibraryAssetDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("libraryAssetId")) return;
  params.delete("libraryAssetId");
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function bindSharedAssetLibraryControls() {
  qs("#canvasAssetLibraryRefresh")?.addEventListener("click", () => loadSharedAssetLibrary().catch((error) => toast(error.message)));
  qs("#canvasAssetLibrarySearch")?.addEventListener("input", (event) => {
    clearTimeout(sharedAssetLibrarySearchTimer);
    sharedAssetLibrarySearchTimer = setTimeout(() => {
      loadSharedAssetLibrary({ search: event.currentTarget.value, silent: true }).catch((error) => toast(error.message));
    }, 180);
  });
  qs("#canvasAssetLibraryList")?.addEventListener("click", (event) => {
    const useId = event.target.closest("[data-shared-library-use]")?.dataset.sharedLibraryUse;
    const previewId = event.target.closest("[data-shared-library-preview]")?.dataset.sharedLibraryPreview;
    const assetId = useId || previewId;
    if (!assetId) return;
    const asset = canvasState.sharedAssetLibrary.assets.find((item) => item.id === assetId);
    if (asset) addSharedLibraryAsset(asset);
  });
  qs("#canvasAssetLibraryList")?.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-shared-library-id]");
    if (!card || !event.dataTransfer) return;
    const assetId = card.dataset.sharedLibraryId || "";
    if (!assetId) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-pixel-toys-shared-asset-id", assetId);
    event.dataTransfer.setData("application/json", JSON.stringify({ type: "pixel-toys-shared-asset", assetId }));
    card.classList.add("is-dragging");
  });
  qs("#canvasAssetLibraryList")?.addEventListener("dragend", (event) => {
    event.target.closest("[data-shared-library-id]")?.classList.remove("is-dragging");
  });
}

bindSharedAssetLibraryControls();

function typeLabel(type) {
  const value = String(type || "").toLowerCase();
  if (value.includes("character")) return "人物";
  if (value.includes("scene")) return "场景";
  if (value.includes("storyboard")) return "故事板";
  if (value.includes("insert")) return "插入";
  if (value.includes("prop")) return "道具";
  return type || "资产";
}

function isPhotorealAsset(asset = {}) {
  const preset = String(asset.assetStylePreset || asset.stylePreset || "").toLowerCase();
  const label = String(asset.assetStyleLabel || asset.styleLabel || "");
  return preset === "photoreal" || /超写实|photoreal|photo-real|hyperreal|hyper-real/i.test(label);
}

function normalizeArkAutoCertificationStyle(value = "") {
  const aliases = {
    "3d": "cg_3d",
    "3d_cg": "cg_3d",
    three_d: "cg_3d",
    photoreal_3d: "cg_3d",
  };
  const key = String(value || "").trim().toLowerCase();
  return aliases[key] || key;
}

function isWorkflowArkAutoCertificationAsset(asset = {}) {
  const source = String(asset.source || "").trim().toLowerCase();
  const projectId = String(asset.projectId || asset.sourceProjectId || "").trim();
  const workflowSource = asset.workflowAsset === true
    || ["project", "workflow", "project-reuse"].includes(source)
    || !!projectId;
  const preset = normalizeArkAutoCertificationStyle(asset.assetStylePreset || asset.stylePreset || "");
  return workflowSource && preset === "photoreal";
}

function isArkPersonReferenceAsset(asset = {}) {
  const rawType = String(asset.manifestType || asset.assetType || asset.type || "").trim();
  if (!isAiGeneratedPhotorealAsset(asset)) return false;
  return !(rawType && /scene|environment|location|场景|环境|prop|object|item|道具|insert|插入/i.test(rawType));
}

function isAiGeneratedPhotorealAsset(asset = {}) {
  if (!isPhotorealAsset(asset)) return false;
  if (asset.aiGenerated === true || asset.verificationType === "ai-generated") return true;
  const source = `${asset.source || ""} ${asset.generationMode || ""}`;
  return /canvas-image|image-generation|ai[-_ ]?generated|gpt[-_ ]?image/i.test(source);
}

function isArkPersonCertificationEligible(asset = {}) {
  if (!asset || isVideoAsset(asset)) return false;
  return isArkPersonReferenceAsset(asset);
}

function isAutoArkPersonAsset(asset = {}) {
  const status = String(asset?.arkPersonAsset?.status || "").toLowerCase();
  if (!asset || isVideoAsset(asset) || asset.uploading || status === "processing" || isArkVirtualPersonCertified(asset)) return false;
  return isWorkflowArkAutoCertificationAsset(asset)
    && isArkPersonReferenceAsset(asset);
}

function arkPersonAssetUrl(asset = {}) {
  if (asset?.arkPersonAsset?.enabled !== true) return "";
  const url = String(asset.arkPersonAsset.assetUrl || "").trim();
  return /^asset:\/\//i.test(url) ? url : "";
}

function arkPersonAssetReadyUrl(asset = {}) {
  const status = String(asset?.arkPersonAsset?.status || "").toLowerCase();
  return status === "active" ? arkPersonAssetUrl(asset) : "";
}

function isArkVirtualPersonCertified(asset = {}) {
  const status = String(asset?.arkPersonAsset?.status || "").toLowerCase();
  return status === "active" && arkPersonAssetUrl(asset);
}

function openArkPersonVerification() {
  const popup = window.open(ARK_PERSON_VERIFY_URL, "_blank");
  if (!popup) {
    toast("浏览器阻止了方舟素材库窗口，请允许弹窗后重试");
    return false;
  }
  toast("请在方舟录入并激活私域人物素材；返回后在视频节点绑定 asset:// 地址");
  return true;
}

function isArkPersonTargetVideoNode(node = {}) {
  const model = node?.settings?.model || VIDEO_NODE_DEFAULTS.model;
  return ARK_PERSON_TARGET_MODELS.has(model);
}

function assetReferenceUrl(asset = {}) {
  const arkPersonUrl = arkPersonAssetReadyUrl(asset);
  if (arkPersonUrl) return arkPersonUrl;
  const publicUrl = asset.publicUrl || asset.public_url || "";
  const localUrl = asset.localUrl || asset.local_url || "";
  const rawUrl = asset.url || "";
  if (isPhotorealAsset(asset)) return publicUrl || localUrl || rawUrl || asset.previewUrl || "";
  if (/^asset:\/\//i.test(rawUrl)) return publicUrl || localUrl || asset.previewUrl || "";
  return publicUrl || localUrl || rawUrl || asset.previewUrl || "";
}

function videoSubmitCapableAsset(asset = {}) {
  const arkPersonUrl = arkPersonAssetReadyUrl(asset);
  if (arkPersonUrl) return arkPersonUrl;
  const referenceUrl = assetReferenceUrl(asset);
  return referenceUrl;
}

function assetValidationLabel(asset = {}) {
  if (arkPersonAssetUrl(asset)) return "虚拟人像已认证";
  if (!isPhotorealAsset(asset)) return "";
  if (isAiGeneratedPhotorealAsset(asset)) return "AI 生成写实";
  const status = String(asset.validationStatus || "").toLowerCase();
  if (status === "failed") return "写实图来源异常";
  return "写实参考图";
}

function stagePoint(clientX, clientY) {
  const rect = qs("#blankCanvas").getBoundingClientRect();
  const viewport = canvasState.viewport;
  return {
    x: (clientX - rect.left - viewport.x) / viewport.scale,
    y: (clientY - rect.top - viewport.y) / viewport.scale,
  };
}

function screenPoint(clientX, clientY) {
  const rect = qs("#blankCanvas").getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function clampCanvasScale(value) {
  const numeric = Number(value);
  return Math.max(CANVAS_MIN_SCALE, Number.isFinite(numeric) ? numeric : 1);
}

function applyCanvasViewport() {
  const { x, y, scale } = canvasState.viewport;
  const transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${scale})`;
  const nodes = qs("#canvasNodes");
  const links = qs("#canvasLinks");
  const linksGroup = qs("#canvasLinksContent");
  if (nodes) nodes.style.transform = transform;
  if (links) links.style.transform = "none";
  if (linksGroup) {
    linksGroup.setAttribute("transform", `translate(${Math.round(x)} ${Math.round(y)}) scale(${scale})`);
  }
  const readout = qs("#canvasZoomReadout");
  if (readout) readout.textContent = `${Math.round(scale * 100)}%`;
}

function markCanvasViewportMoving() {
  const canvas = qs("#blankCanvas");
  canvas?.classList.add("is-viewport-moving");
  clearTimeout(canvasState.viewportMoveTimer);
  canvasState.viewportMoveTimer = setTimeout(() => {
    canvas?.classList.remove("is-viewport-moving");
  }, 180);
}

function zoomCanvasAt(clientX, clientY, nextScale) {
  const viewport = canvasState.viewport;
  const scale = clampCanvasScale(nextScale);
  if (Math.abs(scale - viewport.scale) < 0.0001) return;
  const pointer = screenPoint(clientX, clientY);
  const worldX = (pointer.x - viewport.x) / viewport.scale;
  const worldY = (pointer.y - viewport.y) / viewport.scale;
  viewport.x = pointer.x - worldX * scale;
  viewport.y = pointer.y - worldY * scale;
  viewport.scale = scale;
  markCanvasViewportMoving();
  applyCanvasViewport();
  scheduleCanvasSave();
}

function clampNodePosition(node) {
  node.x = Number.isFinite(Number(node.x)) ? Number(node.x) : 80;
  node.y = Number.isFinite(Number(node.y)) ? Number(node.y) : 80;
}

function nodeLayoutBounds(node = {}) {
  const size = node.kind === "video"
    ? videoNodeSize(node)
    : node.kind === "asset"
      ? assetNodeSize(node)
      : { width: clampNodeDimension(node.width, 240, 720, 360), height: 420 };
  return {
    left: Number(node.x) || 0,
    top: Number(node.y) || 0,
    right: (Number(node.x) || 0) + size.width,
    bottom: (Number(node.y) || 0) + size.height,
  };
}

function moveVideoNodeAwayFromOverlaps(node, existingNodes = []) {
  if (!node || node.kind !== "video") return false;
  const gap = 36;
  let changed = false;
  let attempts = 0;
  while (attempts < existingNodes.length + 2) {
    const bounds = nodeLayoutBounds(node);
    const blockers = existingNodes
      .filter((other) => other && other.id !== node.id)
      .map((other) => ({ node: other, bounds: nodeLayoutBounds(other) }))
      .filter(({ bounds: other }) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top);
    if (!blockers.length) break;
    node.y = Math.max(node.y, ...blockers.map(({ bounds: other }) => other.bottom + gap));
    changed = true;
    attempts += 1;
  }
  return changed;
}

function repairVideoNodeOverlaps(nodes = []) {
  let changed = false;
  const placed = [];
  for (const node of nodes) {
    if (node?.kind === "video" && moveVideoNodeAwayFromOverlaps(node, placed)) changed = true;
    placed.push(node);
  }
  return changed;
}

function clampAssetNodeDimension(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampNodeDimension(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function assetNodeSize(node = {}) {
  const legacyDefaultSize = Number(node?.width) === 224 && Number(node?.height) === 148;
  const width = clampAssetNodeDimension(node?.width, ASSET_NODE_MIN_WIDTH, ASSET_NODE_MAX_WIDTH, ASSET_NODE_DEFAULT_WIDTH);
  const height = clampAssetNodeDimension(node?.height, ASSET_NODE_MIN_HEIGHT, ASSET_NODE_MAX_HEIGHT, ASSET_NODE_DEFAULT_HEIGHT);
  return {
    width: legacyDefaultSize ? ASSET_NODE_DEFAULT_WIDTH : width,
    height: legacyDefaultSize ? ASSET_NODE_DEFAULT_HEIGHT : height,
  };
}

function panCanvasBy(deltaX, deltaY) {
  canvasState.viewport.x -= deltaX;
  canvasState.viewport.y -= deltaY;
  markCanvasViewportMoving();
  applyCanvasViewport();
  scheduleCanvasSave();
}

function startCanvasPan(event) {
  if (event.button !== 1) return;
  if (event.target.closest("select, input, textarea, button, a, [contenteditable='true'], #sharedAssetLibraryPanel")) return;
  const canvas = qs("#blankCanvas");
  if (!canvas) return;
  event.preventDefault();
  event.stopPropagation();
  const viewport = canvasState.viewport;
  canvasState.viewportPan = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    originX: viewport.x,
    originY: viewport.y,
  };
  canvas.classList.add("is-middle-panning");
  canvas.setPointerCapture?.(event.pointerId);
  markCanvasViewportMoving();
}

function applyCanvasPanFrame() {
  canvasState.viewportPanFrame = 0;
  const pan = canvasState.viewportPan;
  if (!pan) return;
  canvasState.viewport.x = pan.originX + (pan.currentX - pan.startX);
  canvasState.viewport.y = pan.originY + (pan.currentY - pan.startY);
  applyCanvasViewport();
}

function updateCanvasPan(event) {
  const pan = canvasState.viewportPan;
  if (!pan || (pan.pointerId != null && event.pointerId !== pan.pointerId)) return;
  event.preventDefault();
  pan.currentX = event.clientX;
  pan.currentY = event.clientY;
  markCanvasViewportMoving();
  if (!canvasState.viewportPanFrame) {
    canvasState.viewportPanFrame = requestAnimationFrame(applyCanvasPanFrame);
  }
}

function endCanvasPan(event = {}) {
  const pan = canvasState.viewportPan;
  if (!pan || (pan.pointerId != null && event.pointerId != null && event.pointerId !== pan.pointerId)) return;
  if (Number.isFinite(event.clientX)) pan.currentX = event.clientX;
  if (Number.isFinite(event.clientY)) pan.currentY = event.clientY;
  if (canvasState.viewportPanFrame) {
    cancelAnimationFrame(canvasState.viewportPanFrame);
    canvasState.viewportPanFrame = 0;
    applyCanvasPanFrame();
  }
  const canvas = qs("#blankCanvas");
  if (pan.pointerId != null) canvas?.releasePointerCapture?.(pan.pointerId);
  canvas?.classList.remove("is-middle-panning");
  canvasState.viewportPan = null;
  scheduleCanvasSave();
}

function canvasInteractionIsActive() {
  return !!(canvasState.drag || canvasState.resize || canvasState.marquee || canvasState.viewportPan);
}

function setStudioBackLink() {
  const href = "/";
  const link = qs("#canvasStudioBack");
  const brand = qs(".canvas-brand");
  if (link) link.href = href;
  if (brand) brand.href = href;
}

function renderProjectTitle() {
  setStudioBackLink();
  const contextName = qs("#canvasAgentContextName");
  if (contextName) {
    contextName.textContent = canvasState.project?.title || canvasState.project?.episodeSlug || (canvasState.canvasId ? "独立画布" : "未命名画布");
  }
}

function projectAssets() {
  const data = canvasState.project || {};
  const manifestItems = new Map(
    (Array.isArray(data.assetManifest?.items) ? data.assetManifest.items : [])
      .map((item) => [item?.id || item?.name, item])
      .filter(([id]) => id),
  );
  return [
    ...(data.assets || []).filter((asset) => asset.manifestType !== "Storyboard"),
    ...(data.storyboards || []),
  ].map((asset) => {
    const id = asset.assetName || asset.name;
    const manifestItem = manifestItems.get(id) || {};
    const description = asset.description
      || asset.prompt
      || asset.assetDescription
      || asset.visual
      || asset.evidence
      || asset.metadata?.description
      || manifestItem.description
      || manifestItem.visual
      || manifestItem.evidence
      || "";
    return {
      id,
      name: id,
      type: asset.manifestType || asset.type || manifestItem.type || "",
      url: asset.url,
      previewUrl: asset.previewUrl || "",
      description,
      prompt: asset.prompt
        || asset.description
        || asset.assetDescription
        || asset.visual
        || asset.evidence
        || asset.metadata?.description
        || manifestItem.description
        || manifestItem.visual
        || manifestItem.evidence
        || "",
      assetStylePreset: asset.assetStylePreset || "",
      assetStyleLabel: asset.assetStyleLabel || "",
      generationMode: asset.generationMode || "",
      verificationType: asset.verificationType || "",
      aiGenerated: asset.aiGenerated === true,
      source: "project",
      projectId: canvasState.selectedId || "",
    };
  });
}

function refreshCanvasProjectAssetMetadata() {
  if (!canvasState.project || !canvasState.assets.length) return false;
  const metadataById = new Map(projectAssets().map((asset) => [asset.id, asset]));
  let changed = false;
  canvasState.assets = canvasState.assets.map((asset) => {
    const projectAsset = metadataById.get(asset.id);
    if (!projectAsset) return asset;
    const description = projectAsset.description || asset.description || asset.prompt || "";
    const prompt = projectAsset.prompt || asset.prompt || asset.description || "";
    if (description === asset.description && prompt === asset.prompt) return asset;
    changed = true;
    return { ...asset, description, prompt };
  });
  return changed;
}

function addAssets(assets) {
  const byId = new Map(canvasState.assets.map((asset) => [asset.id, asset]));
  for (const asset of assets) {
    if (!asset?.id || !asset?.url) continue;
    byId.set(asset.id, stripDataUrlFromAsset({ ...(byId.get(asset.id) || {}), ...asset }));
  }
  canvasState.assets = [...byId.values()];
  scheduleCanvasSave();
}

function assetPreviewUrl(asset = {}) {
  return asset.previewUrl || asset.preview_url || asset.localUrl || asset.local_url || (String(asset.url || "").startsWith("asset://") ? "" : asset.url) || "";
}

// 画布预览专用:把同源 /media、/public-assets 图片 URL 加上 ?thumb=<宽>,让服务端返回小缩略图,
// 解决"大图 2-3MB 冷加载慢"。仅用于展示 <img>;下载和生视频参考仍用原图(不经此函数)。
// data:/blob:/asset:// 和跨域 URL 原样返回。
function thumbUrl(url, width = 480) {
  const raw = String(url || "").trim();
  if (!raw || /^(data:|blob:|asset:\/\/)/i.test(raw)) return raw;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return raw;
    if (u.pathname !== "/media" && !u.pathname.startsWith("/public-assets/")) return raw;
    u.searchParams.set("thumb", String(width));
    return `${u.pathname}${u.search}`;
  } catch {
    return raw;
  }
}

function thumbnailFallbackUrl(url) {
  const raw = String(url || "").trim();
  if (!raw || /^(data:|blob:|asset:\/\/)/i.test(raw)) return raw;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return raw;
    if (u.pathname !== "/media" && !u.pathname.startsWith("/public-assets/")) return raw;
    u.searchParams.delete("thumb");
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return raw;
  }
}

function setThumbnailImageSource(image, sourceUrl, width = 480) {
  const source = String(sourceUrl || "").trim();
  if (image.dataset.thumbnailSource === source) return image.getAttribute("src") || "";
  const src = thumbUrl(source, width);
  const fallback = thumbnailFallbackUrl(source);
  image.dataset.thumbnailSource = source;
  if (fallback && fallback !== src) image.dataset.thumbnailFallback = fallback;
  else delete image.dataset.thumbnailFallback;
  delete image.dataset.thumbnailFallbackApplied;
  image.src = src;
  return src;
}

function handleThumbnailImageError(event) {
  const image = event.target;
  if (!image || image.tagName !== "IMG") return;
  const fallback = image.dataset.thumbnailFallback || "";
  if (!fallback || image.dataset.thumbnailFallbackApplied === "true") return;
  image.dataset.thumbnailFallbackApplied = "true";
  image.src = fallback;
}

document.addEventListener("error", handleThumbnailImageError, true);

function isVideoAsset(asset = {}) {
  return asset.mediaType === "video" || !!asset.videoUrl || CANVAS_VIDEO_FILE_RE.test(String(asset.url || asset.name || ""));
}

function assetVideoUrl(asset = {}) {
  return asset.videoUrl || (CANVAS_VIDEO_FILE_RE.test(String(asset.url || "")) ? asset.url : "");
}

// 视频素材缩略图:用 <video preload="metadata"> 让浏览器渲染首帧,无需服务端抽帧。
function assetThumbnailHtml(asset, { controls = false } = {}) {
  if (isVideoAsset(asset)) {
    const vurl = assetVideoUrl(asset);
    if (vurl) return `<video src="${escapeHtml(vurl)}" preload="metadata" muted playsinline${controls ? " controls" : ""}></video>`;
  }
  const previewUrl = assetPreviewUrl(asset);
  const thumbnailUrl = thumbUrl(previewUrl, 240);
  const fallbackUrl = thumbnailFallbackUrl(previewUrl);
  const fallbackAttr = fallbackUrl && fallbackUrl !== thumbnailUrl
    ? ` data-thumbnail-fallback="${escapeHtml(fallbackUrl)}"`
    : "";
  return previewUrl
    ? `<img src="${escapeHtml(thumbnailUrl)}" data-thumbnail-source="${escapeHtml(previewUrl)}"${fallbackAttr} alt="${escapeHtml(asset.name || "")}" loading="lazy" decoding="async" />`
    : `<div class="node-asset-placeholder">asset</div>`;
}

function nodeTitle(kind) {
  if (kind === "asset") return "图片";
  return kind === "video" ? "Video Generator" : "Image Generator";
}

function createNode(kind, point = canvasState.menuPoint, options = {}) {
  const createPoint = { x: point?.x || 0, y: point?.y || 0 };
  const initialSettings = options.settings && typeof options.settings === "object" ? options.settings : {};
  const node = {
    id: options.id || `node_${Date.now()}_${canvasState.nextNodeId++}`,
    kind,
    x: createPoint.x,
    y: createPoint.y,
    assets: Array.isArray(options.assets) ? options.assets.filter(Boolean) : [],
    prompt: options.prompt || "",
    ...(kind === "asset" ? { width: ASSET_NODE_DEFAULT_WIDTH, height: ASSET_NODE_DEFAULT_HEIGHT } : {}),
    ...(kind === "image" ? { width: IMAGE_NODE_DEFAULT_WIDTH, height: IMAGE_NODE_DEFAULT_HEIGHT, ratioLayoutRatio: "", ratioManualSize: false, settings: { ...IMAGE_NODE_DEFAULTS, ...initialSettings }, status: "idle", statusMessage: "", imageUrl: "", taskId: "" } : {}),
    ...(kind === "video" ? { width: VIDEO_NODE_DEFAULT_WIDTH, height: VIDEO_NODE_DEFAULT_HEIGHT, ratioLayoutRatio: "", ratioManualSize: false, settings: { ...VIDEO_NODE_DEFAULTS, ...initialSettings }, liveness: { name: "真人A", description: "", status: "idle", assetUrl: "" }, status: "idle", statusMessage: "", videoUrl: "", taskId: "", taskProvider: "" } : {}),
  };
  clampNodePosition(node);
  if (kind === "video" && moveVideoNodeAwayFromOverlaps(node, canvasState.nodes)) {
    canvasState.layoutChanged = true;
  }
  canvasState.nodes.push(node);
  if (kind === "video" || kind === "image") canvasState.activeVideoNodeId = node.id;
  if (options.render !== false) renderNodes();
  scheduleCanvasSave();
  hideContextMenu();
  hideConnectionMenu();
  if (!options.silent) toast(`${nodeTitle(kind)} 已创建`);
  return node;
}

function duplicateVideoNode(nodeId) {
  const source = canvasState.nodes.find((node) => node.id === nodeId && node.kind === "video");
  if (!source) return null;
  const copy = createNode("video", {
    x: (Number(source.x) || 0) + 36,
    y: (Number(source.y) || 0) + 36,
  }, {
    render: false,
    silent: true,
    prompt: source.prompt || "",
    assets: [...(source.assets || [])],
    settings: { ...(source.settings || {}) },
  });
  copy.width = source.width;
  copy.height = source.height;
  copy.ratioLayoutRatio = source.ratioLayoutRatio || "";
  copy.ratioManualSize = source.ratioManualSize === true;
  copy.videoPromptMode = source.videoPromptMode || "";
  copy.storyboardRefs = [...(source.storyboardRefs || [])];
  copy.storyboardGuidance = source.storyboardGuidance || null;
  copy.referenceKitId = source.referenceKitId || "";
  copy.referenceKitName = source.referenceKitName || "";
  copy.referenceKitVersion = Number(source.referenceKitVersion || 0) || 0;
  copy.referenceKitSnapshot = source.referenceKitSnapshot || null;
  copy.liveness = source.liveness
    ? { ...source.liveness, status: "idle", error: "" }
    : copy.liveness;
  for (const connection of canvasState.connections.filter((item) => item.from === source.id || item.to === source.id)) {
    const nextConnection = {
      from: connection.from === source.id ? copy.id : connection.from,
      to: connection.to === source.id ? copy.id : connection.to,
    };
    if (
      nextConnection.from !== nextConnection.to
      && !canvasState.connections.some((item) => item.from === nextConnection.from && item.to === nextConnection.to)
    ) {
      canvasState.connections.push(nextConnection);
    }
  }
  setSelectedNodes([copy.id]);
  canvasState.activeVideoNodeId = copy.id;
  hideNodeContextMenu();
  renderNodes();
  renderLinks();
  scheduleCanvasSave();
  toast("已复制视频模块，连线和提示词已保留");
  return copy;
}

function removeNode(nodeId) {
  clearVideoPoll(nodeId);
  if (canvasState.activeVideoNodeId === nodeId) canvasState.activeVideoNodeId = "";
  canvasState.selectedNodeIds.delete(nodeId);
  canvasState.nodes = canvasState.nodes.filter((node) => node.id !== nodeId);
  canvasState.connections = canvasState.connections.filter((connection) => connection.from !== nodeId && connection.to !== nodeId);
  renderNodes();
  scheduleCanvasSave();
}

function syncSelectionClasses() {
  qsa(".canvas-node").forEach((element) => {
    element.classList.toggle("is-selected", canvasState.selectedNodeIds.has(element.dataset.nodeId));
  });
}

function setSelectedNodes(nodeIds = []) {
  const validIds = new Set(canvasState.nodes.map((node) => node.id));
  canvasState.selectedNodeIds = new Set(nodeIds.filter((id) => validIds.has(id)));
  syncSelectionClasses();
}

function clearNodeSelection() {
  setSelectedNodes([]);
}

function selectSingleNode(nodeId) {
  setSelectedNodes([nodeId]);
}

function toggleNodeSelection(nodeId) {
  const next = new Set(canvasState.selectedNodeIds);
  if (next.has(nodeId)) next.delete(nodeId);
  else next.add(nodeId);
  setSelectedNodes([...next]);
}

function positionNodeElement(element, node) {
  if (!element || !node) return;
  element.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
}

function refreshNodeConnectionClasses(nodeId) {
  const element = qs(`[data-node-id="${nodeId}"]`);
  if (!element) return false;
  element.classList.toggle("has-input-link", canvasState.connections.some((connection) => connection.to === nodeId));
  element.classList.toggle("has-output-link", canvasState.connections.some((connection) => connection.from === nodeId));
  element.classList.toggle("is-selected", canvasState.selectedNodeIds.has(nodeId));
  return true;
}

function refreshConnectedNodeElements(...nodeIds) {
  for (const nodeId of new Set(nodeIds.filter(Boolean))) {
    const node = canvasState.nodes.find((item) => item.id === nodeId);
    if (!node) continue;
    if (node.kind === "video") refreshVideoNodeElement(nodeId);
    else refreshNodeConnectionClasses(nodeId);
  }
}

function removeSelectedNodes() {
  const ids = [...canvasState.selectedNodeIds].filter((id) => canvasState.nodes.some((node) => node.id === id));
  if (!ids.length) return false;
  ids.forEach((id) => clearVideoPoll(id));
  if (ids.includes(canvasState.activeVideoNodeId)) canvasState.activeVideoNodeId = "";
  const selected = new Set(ids);
  canvasState.nodes = canvasState.nodes.filter((node) => !selected.has(node.id));
  canvasState.connections = canvasState.connections.filter((connection) => !selected.has(connection.from) && !selected.has(connection.to));
  canvasState.selectedNodeIds.clear();
  renderNodes();
  scheduleCanvasSave();
  toast(`已删除 ${ids.length} 个模块`);
  return true;
}

function removeConnection(index) {
  if (index < 0 || index >= canvasState.connections.length) return;
  canvasState.connections.splice(index, 1);
  renderNodes();
  scheduleCanvasSave();
  toast("已删除连接线");
}

function addAssetToNode(nodeId, assetId) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const asset = canvasState.assets.find((item) => item.id === assetId);
  if (!node || !asset) return;
  if (!node.assets.includes(assetId)) node.assets.push(assetId);
  renderNodes();
  scheduleCanvasSave();
  autoCertifyCanvasGeneratedAsset(asset);
}

function dataTransferTypes(dataTransfer) {
  return Array.from(dataTransfer?.types || []);
}

function dataTransferHasType(dataTransfer, type) {
  return dataTransferTypes(dataTransfer).includes(type);
}

function canvasDragHasPayload(dataTransfer) {
  if (!dataTransfer) return false;
  const types = new Set(dataTransferTypes(dataTransfer));
  // "Files" 是浏览器在拖拽本地文件时放进 types 的标准标记,且在 dragover 阶段就存在——
  // Safari 出于安全在 dragover 时不暴露 dataTransfer.items(为空),只能靠这个标记判断。
  if (types.has("Files")) return true;
  if (
    types.has("application/x-pixel-toys-asset-id") ||
    types.has("application/x-pixel-toys-shared-asset-id") ||
    types.has("application/json") ||
    types.has("text/plain") ||
    types.has("text/uri-list")
  ) {
    return true;
  }
  return Array.from(dataTransfer.items || []).some((item) => item.kind === "file");
}

function setCanvasAssetDragOver(active) {
  if (canvasState.canvasDragOverActive === active) return;
  canvasState.canvasDragOverActive = active;
  qs("#blankCanvas")?.classList.toggle("is-asset-drag-over", active);
}

function assetIdFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return "";
  const direct = dataTransfer.getData("application/x-pixel-toys-asset-id");
  if (direct) return direct;
  try {
    const payload = JSON.parse(dataTransfer.getData("application/json") || "{}");
    if (payload?.type === "pixel-toys-asset" && payload.assetId) return payload.assetId;
  } catch {}
  const plain = dataTransfer.getData("text/plain");
  if (plain && canvasState.assets.some((asset) => asset.id === plain)) return plain;
  const uri = dataTransfer.getData("text/uri-list");
  if (uri) {
    const match = canvasState.assets.find((asset) => asset.url === uri);
    if (match) return match.id;
  }
  return "";
}

function sharedAssetIdFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return "";
  const direct = dataTransfer.getData("application/x-pixel-toys-shared-asset-id");
  if (direct) return direct;
  try {
    const payload = JSON.parse(dataTransfer.getData("application/json") || "{}");
    if (payload?.type === "pixel-toys-shared-asset" && payload.assetId) return payload.assetId;
  } catch {}
  return "";
}

function updateNode(nodeId, patch) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  Object.assign(node, patch);
  scheduleCanvasSave();
}

function upstreamAssetsForNode(node) {
  if (!node || !["video", "image"].includes(node.kind)) return [];
  const upstreamIds = canvasState.connections
    .filter((connection) => connection.to === node.id)
    .map((connection) => connection.from);
  const assetIds = [];
  for (const sourceId of upstreamIds) {
    const sourceNode = canvasState.nodes.find((item) => item.id === sourceId);
    if (!sourceNode) continue;
    for (const assetId of sourceNode.assets || []) {
      if (!assetIds.includes(assetId)) assetIds.push(assetId);
    }
  }
  return assetIds;
}

function upstreamTailFrameForVideoNode(node) {
  if (!node || node.kind !== "video") return null;
  const upstreamIds = canvasState.connections
    .filter((connection) => connection.to === node.id)
    .map((connection) => connection.from);
  for (const sourceId of upstreamIds) {
    const sourceNode = canvasState.nodes.find((item) => item.id === sourceId);
    if (sourceNode?.kind === "video" && sourceNode.tailFrameReady && sourceNode.tailFrameUrl) return sourceNode;
  }
  if (node.startFrameUrl || node.tailFrameSourceNodeId || node.tailFrameSourceName) {
    return {
      id: node.tailFrameSourceNodeId || "",
      kind: "video",
      tailFrameReady: !!node.startFrameUrl,
      tailFrameUrl: node.startFrameUrl || "",
      tailFrameFileUrl: "",
      tailFrameSourceName: node.tailFrameSourceName || "",
    };
  }
  return null;
}

function missingUpstreamTailFrameForVideoNode(node) {
  if (!node || node.kind !== "video") return null;
  const upstreamIds = canvasState.connections
    .filter((connection) => connection.to === node.id)
    .map((connection) => connection.from);
  for (const sourceId of upstreamIds) {
    const sourceNode = canvasState.nodes.find((item) => item.id === sourceId);
    if (sourceNode?.kind !== "video") continue;
    if (sourceNode.tailFrameReady && sourceNode.tailFrameUrl) continue;
    return sourceNode;
  }
  if (node.tailFrameSourceName && !node.startFrameUrl) {
    return { name: node.tailFrameSourceName };
  }
  return null;
}

function effectiveNodeAssetIds(node) {
  return [...new Set([...(node?.assets || []), ...upstreamAssetsForNode(node)])];
}

function selectedFrameAssetsForVideoNode(node) {
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node?.settings || {}) };
  if (settings.frameControl !== "first_last") return { first: null, last: null };
  return {
    first: canvasState.assets.find((asset) => asset.id === settings.firstFrameAssetId) || null,
    last: canvasState.assets.find((asset) => asset.id === settings.lastFrameAssetId) || null,
  };
}

function referenceAssetsForVideoNode(node) {
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node?.settings || {}) };
  const frameAssets = selectedFrameAssetsForVideoNode(node);
  const frameIds = new Set([frameAssets.first?.id, frameAssets.last?.id].filter(Boolean));
  const mentionOffset = settings.frameControl === "first_last" ? 2 : 0;
  const generatedAssetId = node?.kind === "image" ? node.generatedAssetId : "";
  return effectiveNodeAssetIds(node)
    .filter((assetId) => !frameIds.has(assetId) && assetId !== generatedAssetId)
    .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
    .filter(Boolean)
    .map((asset, index) => ({
      ...asset,
      referenceUrl: assetPreviewUrl(asset) || assetReferenceUrl(asset) || asset.url || "",
      mention: `@图片${index + mentionOffset + 1}`,
      index: index + mentionOffset + 1,
    }));
}

function addAssetNode(assetId) {
  addAssetNodeAt(assetId, nextAvailableAssetNodePoint());
}

function nodeLayoutSize(node = {}) {
  if (node.kind === "asset") return assetNodeSize(node);
  if (node.kind === "video") {
    return {
      width: Number(node.width) || VIDEO_NODE_DEFAULT_WIDTH,
      height: Number(node.height) || VIDEO_NODE_DEFAULT_HEIGHT,
    };
  }
  if (node.kind === "image") {
    return {
      width: Number(node.width) || IMAGE_NODE_DEFAULT_WIDTH,
      height: Number(node.height) || IMAGE_NODE_DEFAULT_HEIGHT,
    };
  }
  return { width: ASSET_NODE_DEFAULT_WIDTH, height: ASSET_NODE_DEFAULT_HEIGHT };
}

function nextAvailableAssetNodePoint() {
  const scale = Math.max(CANVAS_MIN_SCALE, Number(canvasState.viewport.scale) || 1);
  const originX = Math.max(48, (-Number(canvasState.viewport.x || 0) / scale) + 48);
  const originY = Math.max(48, (-Number(canvasState.viewport.y || 0) / scale) + 48);
  const gap = 48;
  const width = ASSET_NODE_DEFAULT_WIDTH;
  const height = ASSET_NODE_DEFAULT_HEIGHT;
  const existing = canvasState.nodes.map((node) => {
    const size = nodeLayoutSize(node);
    return { x: Number(node.x) || 0, y: Number(node.y) || 0, width: size.width, height: size.height };
  });
  const overlaps = (x, y, rect) =>
    x < rect.x + rect.width + gap && x + width + gap > rect.x && y < rect.y + rect.height + gap && y + height + gap > rect.y;
  for (let row = 0; row < 40; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const point = { x: originX + column * (width + gap), y: originY + row * (height + gap) };
      if (!existing.some((rect) => overlaps(point.x, point.y, rect))) return point;
    }
  }
  return {
    x: originX + (canvasState.nodes.length % 4) * (width + gap),
    y: originY + Math.floor(canvasState.nodes.length / 4) * (height + gap),
  };
}

function addAssetNodeAt(assetId, point, options = {}) {
  const asset = canvasState.assets.find((item) => item.id === assetId);
  if (!asset) return;
  if (/^asset:\/\//i.test(asset.url || "") && !assetPreviewUrl(asset)) {
    if (!options.silent) toast("这个 asset:// 素材没有预览图，active 后再加入画布更清晰");
    return null;
  }
  const node = createNode("asset", point, { render: false, silent: true });
  if (!node.assets.includes(assetId)) node.assets.push(assetId);
  if (options.render !== false) renderNodes({ preserveExisting: true });
  scheduleCanvasSave();
  if (options.autoCertify === true) autoCertifyCanvasGeneratedAsset(asset);
  if (!options.silent) toast("图片已添加到画布");
  return node;
}

function addAssetNodesToCanvas(assets = []) {
  const existingAssetIds = new Set(
    canvasState.nodes.flatMap((node) => node.kind === "asset" ? node.assets || [] : []),
  );
  let added = 0;
  for (const asset of assets) {
    if (!asset?.id || existingAssetIds.has(asset.id)) continue;
    const node = addAssetNodeAt(asset.id, nextAvailableAssetNodePoint(), { silent: true, render: false });
    if (node) {
      existingAssetIds.add(asset.id);
      added += 1;
    }
  }
  if (added) renderNodes({ preserveExisting: true });
  return added;
}

function renderNodeAssets(node) {
  if (node.kind !== "video") {
    return referenceAssetsForVideoNode(node)
      .map(
        (asset) => `
          <button class="node-asset-chip from-upstream ${isPhotorealAsset(asset) ? "is-photoreal" : ""} ${isVideoAsset(asset) ? "is-video" : ""}" type="button" data-insert-reference="${escapeHtml(asset.mention)}" title="插入 ${escapeHtml(asset.mention)} · ${escapeHtml(asset.name)}">
            ${assetThumbnailHtml(asset, { controls: true })}
            <span><b>${escapeHtml(asset.mention)}</b>${escapeHtml(asset.name)}</span>
          </button>
        `,
      )
      .join("");
  }
  const upstreamIds = new Set(upstreamAssetsForNode(node));
  const references = referenceAssetsForVideoNode(node);
  const referenceKitBanner = node.referenceKitId
    ? `<div class="reference-kit-node-banner"><strong>KIT</strong><span>${escapeHtml(node.referenceKitName || node.referenceKitId)}${node.referenceKitVersion ? ` · v${node.referenceKitVersion}` : ""}</span></div>`
    : "";
  const frameAssets = selectedFrameAssetsForVideoNode(node);
  const frameChips = [
    ["首帧", frameAssets.first],
    ["尾帧", frameAssets.last],
  ]
    .filter(([, asset]) => !!asset)
      .map(([label, asset]) => `
      <article class="node-asset-chip frame-control-chip" title="${escapeHtml(label)}：${escapeHtml(asset.name)}">
        ${assetThumbnailHtml(asset)}
        <span><b>${escapeHtml(label)}</b>${escapeHtml(asset.name)}</span>
      </article>
    `)
    .join("");
  const usesProductionBoard = node.videoPromptMode === "production_board" || (Array.isArray(node.storyboardRefs) && node.storyboardRefs.length > 0);
  const upstreamTailFrame = usesProductionBoard || frameAssets.first || frameAssets.last ? null : upstreamTailFrameForVideoNode(node);
  const tailFrameChip = upstreamTailFrame?.tailFrameUrl
    ? `
      <article class="node-asset-chip tail-frame-chip" title="上一段尾帧会作为本段 first_frame 首帧">
        <img src="${escapeHtml(upstreamTailFrame.tailFrameUrl)}" alt="上一段尾帧" loading="lazy" decoding="async" />
        <span><b>首帧</b>${escapeHtml(upstreamTailFrame.tailFrameSourceName || "上一段尾帧")}</span>
      </article>
    `
    : "";
  if (!references.length) return `${referenceKitBanner}${frameChips}${tailFrameChip}`;
  const chips = references
    .map(
      (asset) => `
        <button class="node-asset-chip ${upstreamIds.has(asset.id) ? "from-upstream" : ""} ${isPhotorealAsset(asset) ? "is-photoreal" : ""} ${isVideoAsset(asset) ? "is-video" : ""}" type="button" data-insert-reference="${escapeHtml(asset.mention)}" title="插入 ${escapeHtml(asset.mention)} · ${escapeHtml(asset.name)}">
          ${assetThumbnailHtml(asset)}
          <span><b>${escapeHtml(asset.mention)}</b>${escapeHtml(asset.name)}${/storyboard|production board|分镜/i.test(`${asset.type || ""} ${asset.name || ""}`) ? " · Production Board" : ""}${assetValidationLabel(asset) ? ` · ${escapeHtml(assetValidationLabel(asset))}` : ""}</span>
        </button>
      `,
    )
    .join("");
  return `${referenceKitBanner}${frameChips}${tailFrameChip}${chips}`;
}

function mentionTriggerForTextarea(textarea, options = {}) {
  const caret = textarea.selectionStart ?? 0;
  const before = textarea.value.slice(0, caret);
  const atIndex = Math.max(before.lastIndexOf("@"), before.lastIndexOf("＠"));
  if (atIndex < 0) {
    if (!options.openAll) return null;
    return { start: caret, end: caret, query: "" };
  }
  let query = before.slice(atIndex + 1);
  if (/[\n\r@＠]/.test(query)) return null;
  if (/\s/.test(query)) {
    if (!options.openAll) return null;
    query = "";
  }
  return {
    start: atIndex,
    end: caret,
    query,
  };
}

function hidePromptMentionMenu() {
  canvasState.mentionMenu = null;
  const menu = qs("#promptMentionMenu");
  if (menu) menu.classList.add("hidden");
}

function filteredMentionReferences(node, query = "") {
  const cleanQuery = String(query || "").trim().toLowerCase();
  const refs = referenceAssetsForVideoNode(node);
  if (!cleanQuery) return refs;
  return refs.filter((ref) => {
    const haystack = `${ref.mention} ${ref.name || ""} ${typeLabel(ref.type || "")}`.toLowerCase();
    return haystack.includes(cleanQuery);
  });
}

function placePromptMentionMenu(textarea, node) {
  const menu = qs("#promptMentionMenu");
  const canvasRect = qs("#blankCanvas").getBoundingClientRect();
  const nodeElement = node?.id ? qs(`[data-node-id="${node.id}"]`) : null;
  const rect = (nodeElement || textarea).getBoundingClientRect();
  const width = menu.offsetWidth || 168;
  const height = Math.min(menu.offsetHeight || 240, canvasRect.height - 24);
  const preferredLeft = rect.right - canvasRect.left + 10;
  const fallbackLeft = rect.left - canvasRect.left - width - 10;
  const hasRightSpace = preferredLeft + width + 12 <= canvasRect.width;
  const left = Math.min(Math.max(12, hasRightSpace ? preferredLeft : fallbackLeft), Math.max(12, canvasRect.width - width - 12));
  const top = Math.min(Math.max(12, rect.top - canvasRect.top), Math.max(12, canvasRect.height - height - 12));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function renderPromptMentionMenu() {
  const state = canvasState.mentionMenu;
  const menu = qs("#promptMentionMenu");
  if (!state || !menu) return;
  const refs = state.refs || [];
  if (!refs.length) {
    menu.innerHTML = `<div class="prompt-mention-empty">${state.emptyMessage || "先连接图片到视频模块"}</div>`;
    return;
  }
  menu.innerHTML = refs
    .map(
      (ref, index) => `
        <button class="${index === state.activeIndex ? "active" : ""}" type="button" data-mention-index="${index}" role="option" aria-selected="${index === state.activeIndex ? "true" : "false"}">
          <img src="${escapeHtml(thumbUrl(ref.referenceUrl || ref.url || "", 240))}" alt="${escapeHtml(ref.name)}" loading="lazy" decoding="async" />
          <span>
            <strong>${escapeHtml(ref.mention)}</strong>
            <small>${escapeHtml(ref.name || `参考图 ${ref.index}`)}</small>
          </span>
        </button>
      `,
    )
    .join("");
  menu.querySelectorAll("[data-mention-index]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => insertPromptMention(Number(button.dataset.mentionIndex || 0)));
  });
}

function updatePromptMentionMenu(textarea, node, options = {}) {
  if (!textarea || !node || !["video", "image"].includes(node.kind)) return hidePromptMentionMenu();
  const trigger = mentionTriggerForTextarea(textarea, options);
  if (!trigger) return hidePromptMentionMenu();
  const refs = filteredMentionReferences(node, trigger.query);
  canvasState.mentionMenu = {
    nodeId: node.id,
    textarea,
    triggerStart: trigger.start,
    triggerEnd: trigger.end,
    refs,
    activeIndex: 0,
    emptyMessage: referenceAssetsForVideoNode(node).length ? "没有匹配的图片引用" : "先连接图片到生成模块",
  };
  const menu = qs("#promptMentionMenu");
  menu.classList.remove("hidden");
  renderPromptMentionMenu();
  placePromptMentionMenu(textarea, node);
}

function insertPromptMention(index = 0) {
  const state = canvasState.mentionMenu;
  if (!state) return;
  const ref = state.refs?.[index];
  if (!ref) return;
  const textarea = state.textarea;
  const node = canvasState.nodes.find((item) => item.id === state.nodeId);
  if (!textarea || !node) return hidePromptMentionMenu();
  const value = textarea.value;
  const replacement = `${ref.mention} `;
  const nextValue = `${value.slice(0, state.triggerStart)}${replacement}${value.slice(state.triggerEnd)}`;
  const caret = state.triggerStart + replacement.length;
  textarea.value = nextValue;
  textarea.setSelectionRange(caret, caret);
  updateNode(node.id, { prompt: nextValue });
  textarea.focus();
  hidePromptMentionMenu();
}

function insertTextIntoPrompt(nodeId, text) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const textarea = qs(`[data-node-id="${nodeId}"] .node-prompt`);
  if (!node || !textarea || !text) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  const insertion = `${prefix}${text} ${suffix}`;
  const nextValue = `${before}${insertion}${after}`;
  const caret = before.length + insertion.length;
  textarea.value = nextValue;
  textarea.setSelectionRange(caret, caret);
  textarea.focus();
  updateNode(node.id, { prompt: nextValue });
}

function movePromptMentionSelection(delta) {
  const state = canvasState.mentionMenu;
  if (!state?.refs?.length) return;
  state.activeIndex = (state.activeIndex + delta + state.refs.length) % state.refs.length;
  renderPromptMentionMenu();
}

function bindPromptMentionMenu(textarea, node) {
  const refresh = () => updatePromptMentionMenu(textarea, node);
  const openAll = () => updatePromptMentionMenu(textarea, node, { openAll: true });
  textarea.addEventListener("input", refresh);
  textarea.addEventListener("click", () => {
    const caret = textarea.selectionStart ?? 0;
    const value = textarea.value || "";
    if (value[caret - 1] === "@" || value[caret - 1] === "＠" || value[caret] === "@" || value[caret] === "＠") {
      openAll();
      return;
    }
    refresh();
  });
  textarea.addEventListener("keyup", (event) => {
    if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) return;
    updatePromptMentionMenu(textarea, node, { openAll: event.key === "@" || event.key === "＠" });
  });
  textarea.addEventListener("keydown", (event) => {
    if (!canvasState.mentionMenu || canvasState.mentionMenu.nodeId !== node.id) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      movePromptMentionSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      movePromptMentionSelection(-1);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertPromptMention(canvasState.mentionMenu.activeIndex || 0);
    } else if (event.key === "Escape") {
      event.preventDefault();
      hidePromptMentionMenu();
    }
  });
}

function primaryAssetForNode(node) {
  const assetId = node?.kind === "image"
    ? node.generatedAssetId || node.assets?.[0] || ""
    : node?.assets?.[0] || "";
  return canvasState.assets.find((asset) => asset.id === assetId) || null;
}

function videoProgressValue(node) {
  return normalizeVideoProgress(node?.progress) ?? 0;
}

function hasRealVideoProgress(node) {
  return normalizeVideoProgress(node?.progress) !== null;
}

function videoModelLabel(node) {
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node?.settings || {}) };
  const model = String(settings.model || VIDEO_NODE_DEFAULTS.model).trim();
  return VIDEO_MODEL_LABELS[model] || model || VIDEO_MODEL_LABELS[VIDEO_NODE_DEFAULTS.model];
}

function videoPollDelay(base = 5000) {
  return base + Math.floor(Math.random() * 900);
}

function setActiveVideoNode(nodeId = "") {
  const cleanId = String(nodeId || "");
  if (canvasState.activeVideoNodeId === cleanId) return;
  canvasState.activeVideoNodeId = cleanId;
  qsa(".video-node, .image-node").forEach((element) => {
    element.classList.toggle("is-composer-open", !!cleanId && element.dataset.nodeId === cleanId);
    const node = canvasState.nodes.find((item) => item.id === element.dataset.nodeId);
    if (node?.kind === "image") syncImageNodeDimensions(element, node);
    if (node?.kind === "video") syncVideoNodeDimensions(element, node);
  });
  // 展开/收起会改节点尺寸(带 ~140ms CSS 过渡),端口随之移动;跟帧重画连线,
  // 否则连线停在过渡前的旧端口位置,与展开状态脱节。
  followLinksThroughResize();
}

// 在节点尺寸过渡期间持续重画连线,让连线端点始终贴住移动中的端口。
function followLinksThroughResize(duration = 240) {
  if (canvasState.linkFollowUntil && canvasState.linkFollowActive) {
    canvasState.linkFollowUntil = performance.now() + duration;
    return;
  }
  canvasState.linkFollowUntil = performance.now() + duration;
  canvasState.linkFollowActive = true;
  const step = () => {
    renderLinks();
    if (performance.now() < canvasState.linkFollowUntil) {
      requestAnimationFrame(step);
    } else {
      canvasState.linkFollowActive = false;
    }
  };
  requestAnimationFrame(step);
}

function normalizeVideoProgress(value, max = 100) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(typeof value === "string" ? value.trim().replace(/%$/, "") : value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(max, Math.round(numeric)));
}

function friendlyVideoError(message = "") {
  const raw = String(message || "").trim();
  const requestId = raw.match(/Request id:\s*([A-Za-z0-9]+)/i)?.[1] || "";
  if (/real person|PrivacyInformation|InputImageSensitiveContentDetected|隐私|真人|真实人物/i.test(raw)) {
    return {
      title: "参考图被平台拒绝",
      detail: "这张图片虽然由 AI 生成，但平台仍按画面内容识别为真人或隐私参考；客户端标记不会改变审核结果。请改用非人脸/风格化角色，或平台认可的可信 AI 产物，不会自动启动传统真人认证。",
      meta: requestId ? `Request ID: ${requestId}` : "",
    };
  }
  if (/copyright|copyright\s+restriction|版权限制|著作权|原创化改写/i.test(raw)) {
    return {
      title: "触发版权限制",
      detail: "视频接口认为该镜头可能接近受版权保护内容。请对人物、组织、世界观术语、作品名或品牌化设定做原创化改写后重试。",
      meta: requestId ? `Request ID: ${requestId}` : "",
    };
  }
  if (/token|unauthor|forbidden|鉴权|密钥/i.test(raw)) {
    return {
      title: "接口鉴权失败",
      detail: "请检查视频生成 API Key 或服务配置。",
      meta: raw,
    };
  }
  return {
    title: "生成失败",
    detail: raw || "请检查接口配置后重试。",
    meta: "",
  };
}

function videoDownloadName(node) {
  const raw = String(node?.projectShotName || node?.shotName || node?.id || "pixel-toys-video").trim();
  const name = raw.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "pixel-toys-video";
  return /\.mp4$/i.test(name) ? name : `${name}.mp4`;
}

function videoDownloadHref(node) {
  // 下载图标与播放器原生菜单共用同一地址，避免代理或强制下载参数改变传输路径。
  return String(node?.videoUrl || "").trim();
}

function videoPreviewSrc(node) {
  const raw = String(node?.videoUrl || "").trim();
  const version = String(node?.videoPreviewVersion || node?.taskId || "").trim();
  if (!raw || !version || /^(?:blob|data):/i.test(raw)) return raw;
  try {
    const url = new URL(raw, window.location.origin);
    url.searchParams.set("canvasVideoGeneration", version);
    return url.href;
  } catch {
    return `${raw}${raw.includes("?") ? "&" : "?"}canvasVideoGeneration=${encodeURIComponent(version)}`;
  }
}

function renderVideoPreview(node) {
  if (node.kind !== "video") return "生成结果预览";
  // A refresh can briefly rehydrate the previous media URL while a new task
  // is already running. The running state must win over any stale URL.
  if (node.status === "running") {
    const progress = videoProgressValue(node);
    const hasProgress = hasRealVideoProgress(node);
    const progressWidth = hasProgress ? progress : 24;
    const modelLabel = videoModelLabel(node);
    return `
      <div class="video-node-status generation-status" aria-label="${hasProgress ? `生成中 ${progress}%` : "生成中"}">
        <div class="generation-status-row">
          <strong>生成中</strong>
          <em>${hasProgress ? `${progress}%` : ""}</em>
        </div>
        <div class="generation-progress-track${hasProgress ? "" : " is-indeterminate"}" aria-hidden="true"><i style="width: ${progressWidth}%"></i></div>
        <span class="generation-model-label">${escapeHtml(modelLabel)}</span>
      </div>
    `;
  }
  if (node.videoUrl) {
    const downloadHref = videoDownloadHref(node);
    const previewSrc = videoPreviewSrc(node);
    const captureBusy = node.tailFrameCaptureStatus === "capturing";
    const captureTailFrame = node.status === "completed"
      ? `<button class="video-capture-tail-button" type="button" data-capture-tail-frame aria-label="截取当前视频尾帧" title="${captureBusy ? "正在截取尾帧" : "截取当前视频尾帧"}"${captureBusy ? " disabled aria-busy=\"true\"" : ""}>${CAMERA_ICON_SVG}</button>`
      : "";
    const tailFrameStatus = captureBusy
      ? `<span class="video-tail-frame-status is-capturing" role="status">正在截取尾帧…</span>`
      : node.tailFrameCaptureStatus === "failed" && node.tailFrameCaptureMessage
        ? `<span class="video-tail-frame-status is-failed" role="status">${escapeHtml(node.tailFrameCaptureMessage)}</span>`
        : "";
    return `
      <video src="${escapeHtml(previewSrc)}" controls playsinline preload="metadata"${node.tailFrameUrl ? ` poster="${escapeHtml(node.tailFrameUrl)}"` : ""}></video>
      <div class="video-media-actions" aria-label="视频操作">
        <a class="media-download-button" href="${escapeHtml(downloadHref)}" download="${escapeHtml(videoDownloadName(node))}" aria-label="下载生成视频">${DOWNLOAD_ICON_SVG}<span>下载</span></a>
        ${captureTailFrame}
      </div>
      ${tailFrameStatus}
    `;
  }
  if (node.status === "failed") {
    const error = friendlyVideoError(node.statusMessage);
    return `
      <div class="video-node-status failed">
        <strong>${escapeHtml(error.title)}</strong>
        <span>${escapeHtml(error.detail)}</span>
        ${error.meta ? `<em>${escapeHtml(error.meta)}</em>` : ""}
      </div>
    `;
  }
  return "生成结果预览";
}

function nodePrompt(node) {
  return compactNodeText(node.prompt);
}

function projectEpisodeIdFromCanvasStorage() {
  const raw = canvasStorageProjectId();
  return raw.includes("::video::") ? raw.split("::video::")[0] : raw;
}

function isProjectVideoNode(node = {}) {
  return node.kind === "video" && /^video_E\d+_V\d+/i.test(node.id || "") && (node.projectShotName || node.tailFrameSourceName || canvasState.selectedId);
}

function shotNameFromProjectVideoNode(node = {}) {
  if (node.projectShotName) return node.projectShotName;
  const safe = String(node.id || "").replace(/^video_/, "");
  const suffix = safe.match(/_[a-z0-9]{4,10}$/i)?.[0] || "";
  return suffix ? safe.slice(0, -suffix.length) : "";
}

function compactNodeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isLivenessVideoNode(node) {
  return (node?.settings?.model || VIDEO_NODE_DEFAULTS.model) === LIVENESS_MODEL;
}

function isPersonReferenceVideoNode(node) {
  return (node?.settings?.model || VIDEO_NODE_DEFAULTS.model) === PERSON_REFERENCE_MODEL;
}

function syncVideoResolutionOptions(element, node, settings = {}) {
  const select = element?.querySelector('select[data-node-field="resolution"]');
  if (!select) return;
  const model = settings.model || VIDEO_NODE_DEFAULTS.model;
  const isFastOrMini = /(?:fast|mini)/i.test(model);
  const supports1080p = !isFastOrMini;
  const supports4k = model === "seedance-2-0";
  const supported = new Set(["480p", "720p"]);
  if (supports1080p) supported.add("1080p");
  if (supports4k) supported.add("4k");
  let value = String(settings.resolution || VIDEO_NODE_DEFAULTS.resolution).toLowerCase();
  if (!supported.has(value)) {
    value = "720p";
    node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), resolution: value };
  }
  select.querySelectorAll("option").forEach((option) => {
    const enabled = supported.has(String(option.value).toLowerCase());
    option.disabled = !enabled;
    option.hidden = !enabled;
    option.title = enabled ? "" : "当前模型不支持此分辨率";
  });
  select.value = value;
}

function videoModeSummary(node) {
  const frameAssets = selectedFrameAssetsForVideoNode(node);
  if (frameAssets.first || frameAssets.last) return "首尾帧模式：使用指定首帧和尾帧，另可连接普通参考图。";
  const referenceCount = effectiveNodeAssetIds(node).length + (node?.startFrameUrl ? 1 : 0);
  if (referenceCount) return `参考图生视频模式：已连接 ${referenceCount} 个参考输入。`;
  return "文生视频模式：无需图片连接，可直接用提示词生成。";
}

function syncVideoNodeShell(element, node) {
  if (!element || node?.kind !== "video") return;
  syncVideoNodeDimensions(element, node);
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) };
  syncVideoResolutionOptions(element, node, settings);
  const effectiveSettings = { ...settings, ...(node.settings || {}) };
  element.dataset.videoStatus = node.status || "idle";
  element.dataset.videoRatio = effectiveSettings.ratio || VIDEO_NODE_DEFAULTS.ratio;
  element.dataset.videoModel = effectiveSettings.model || VIDEO_NODE_DEFAULTS.model;
  const modelLabel = VIDEO_MODEL_LABELS[effectiveSettings.model] || effectiveSettings.model || "Seedance";
  const audioLabel = effectiveSettings.generateAudio === false ? "无音效" : "音效";
  const summary = `${modelLabel} · ${effectiveSettings.ratio || "9:16"} · ${effectiveSettings.resolution || "720p"} · ${effectiveSettings.duration || 5}s · ${audioLabel}`;
  const kind = element.querySelector(".video-titlebar .node-kind");
  if (kind) kind.textContent = "视频生成";
  const title = element.querySelector(".video-titlebar h2");
  if (title) title.textContent = modelLabel;
  const preview = element.querySelector(".video-preview-frame");
  if (preview) preview.setAttribute("title", summary);
  const previewSlot = element.querySelector(".video-preview-slot");
  if (previewSlot) previewSlot.style.setProperty("--video-preview-ratio", VIDEO_PREVIEW_RATIOS[effectiveSettings.ratio] || VIDEO_PREVIEW_RATIOS[VIDEO_NODE_DEFAULTS.ratio]);
  const flowSummary = element.querySelector(".node-flow-summary");
  if (flowSummary) flowSummary.textContent = videoModeSummary(node);
}

function ratioSizedNodeDimensions(node = {}, kind = "video") {
  const isImage = kind === "image";
  if (kind === "video") {
    const settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) };
    const ratio = settings.ratio || VIDEO_NODE_DEFAULTS.ratio;
    const ratioSize = CANVAS_NODE_RATIO_DIMENSIONS[ratio] || CANVAS_NODE_RATIO_DIMENSIONS[VIDEO_NODE_DEFAULTS.ratio];
    const layoutRatio = ratio;
    const hasManualSize = node.ratioManualSize === true && node.ratioLayoutRatio === layoutRatio && Number.isFinite(Number(node.width)) && Number.isFinite(Number(node.height));
    if (hasManualSize) {
      return {
        width: clampNodeDimension(node.width, VIDEO_NODE_MIN_WIDTH, VIDEO_NODE_MAX_WIDTH, VIDEO_EDITOR_DEFAULT_WIDTH),
        height: clampNodeDimension(node.height, VIDEO_NODE_MIN_HEIGHT, VIDEO_NODE_MAX_HEIGHT, VIDEO_EDITOR_DEFAULT_HEIGHT),
      };
    }
    const width = clampNodeDimension(VIDEO_EDITOR_DEFAULT_WIDTH, VIDEO_NODE_MIN_WIDTH, VIDEO_NODE_MAX_WIDTH, VIDEO_EDITOR_DEFAULT_WIDTH);
    const previewWidth = Math.min(Math.round(width * 0.68), VIDEO_PREVIEW_WIDTHS[ratio] || VIDEO_PREVIEW_WIDTHS[VIDEO_NODE_DEFAULTS.ratio]);
    const previewHeight = Math.round(previewWidth * ratioSize.height / ratioSize.width);
    return {
      width,
      // The prompt composer has a fixed height; only the media area grows with
      // the selected ratio so portrait shots do not leave horizontal shots
      // with a large empty tail.
      height: clampNodeDimension(previewHeight + 386, VIDEO_NODE_MIN_HEIGHT, VIDEO_NODE_MAX_HEIGHT, VIDEO_EDITOR_DEFAULT_HEIGHT),
      previewWidth,
      previewHeight,
    };
  }
  const settings = { ...IMAGE_NODE_DEFAULTS, ...(node.settings || {}) };
  const ratio = settings.ratio || IMAGE_NODE_DEFAULTS.ratio;
  const ratioSize = CANVAS_NODE_RATIO_DIMENSIONS[ratio] || CANVAS_NODE_RATIO_DIMENSIONS[IMAGE_NODE_DEFAULTS.ratio];
  const minWidth = isImage ? IMAGE_NODE_MIN_WIDTH : VIDEO_NODE_MIN_WIDTH;
  const maxWidth = isImage ? IMAGE_NODE_MAX_WIDTH : VIDEO_NODE_MAX_WIDTH;
  const minHeight = isImage ? IMAGE_NODE_MIN_HEIGHT : VIDEO_NODE_MIN_HEIGHT;
  const maxHeight = isImage ? IMAGE_NODE_MAX_HEIGHT : VIDEO_NODE_MAX_HEIGHT;
  const fallbackWidth = isImage ? IMAGE_NODE_DEFAULT_WIDTH : VIDEO_NODE_DEFAULT_WIDTH;
  const fallbackHeight = isImage ? IMAGE_NODE_DEFAULT_HEIGHT : VIDEO_NODE_DEFAULT_HEIGHT;
  const hasManualSize = node.ratioManualSize === true && node.ratioLayoutRatio === ratio && Number.isFinite(Number(node.width)) && Number.isFinite(Number(node.height));
  if (hasManualSize) {
    return {
      width: clampNodeDimension(node.width, minWidth, maxWidth, fallbackWidth),
      height: clampNodeDimension(node.height, minHeight, maxHeight, fallbackHeight),
    };
  }
  const width = clampNodeDimension(ratioSize.preferredWidth, minWidth, maxWidth, fallbackWidth);
  const previewHeight = Math.round(width * ratioSize.height / ratioSize.width);
  return {
    width,
    height: clampNodeDimension(previewHeight + RATIO_LAYOUT_CHROME_HEIGHT[kind], minHeight, maxHeight, fallbackHeight),
  };
}

function syncImageNodeDimensions(element, node) {
  if (!element || node?.kind !== "image") return;
  const size = ratioSizedNodeDimensions(node, "image");
  const isOpen = canvasState.activeVideoNodeId === node.id;
  node.width = size.width;
  node.height = size.height;
  node.ratioLayoutRatio = node.settings?.ratio || IMAGE_NODE_DEFAULTS.ratio;
  // 只有展开时才用 ratio 尺寸的内联宽高;收起时清空内联宽度,交回 CSS 的收起卡片尺寸
  // (.image-node:not(.is-composer-open){width:300px}),否则空的收起节点会被撑成 620px 巨框。
  element.style.width = isOpen ? `${size.width}px` : "";
  element.style.height = isOpen ? `${size.height}px` : "auto";
  element.style.setProperty("--image-node-width", `${size.width}px`);
  element.style.setProperty("--image-node-height", isOpen ? `${size.height}px` : "auto");
}

function videoNodeSize(node = {}) {
  return ratioSizedNodeDimensions(node, "video");
}

function syncVideoNodeDimensions(element, node) {
  if (!element || node?.kind !== "video") return;
  const size = ratioSizedNodeDimensions(node, "video");
  const layoutRatio = node.settings?.ratio || VIDEO_NODE_DEFAULTS.ratio;
  const isManuallySized = node.ratioManualSize === true && node.ratioLayoutRatio === layoutRatio;
  if (!isManuallySized && node.ratioLayoutRatio && node.ratioLayoutRatio !== layoutRatio) node.ratioManualSize = false;
  node.width = size.width;
  node.height = size.height;
  node.ratioLayoutRatio = layoutRatio;
  element.classList.toggle("is-manually-sized", isManuallySized);
  element.style.setProperty("--video-node-width", `${size.width}px`);
  element.style.setProperty("--video-node-height", `${size.height}px`);
}

function videoNodePayload(node, { forceNoAudio = false } = {}) {
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) };
  const frameAssets = selectedFrameAssetsForVideoNode(node);
  const frameAssetIds = new Set([frameAssets.first?.id, frameAssets.last?.id].filter(Boolean));
  const assetIds = effectiveNodeAssetIds(node).filter((assetId) => !frameAssetIds.has(assetId));
  const usesProductionBoard = node.videoPromptMode === "production_board" || (Array.isArray(node.storyboardRefs) && node.storyboardRefs.length > 0);
  const upstreamTailFrame = usesProductionBoard || settings.frameControl === "first_last" ? null : upstreamTailFrameForVideoNode(node);
  const assets = assetIds
    .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
    .filter(Boolean)
    .filter((asset) => !!videoSubmitCapableAsset(asset))
    .map((asset) => {
      const photoreal = isPhotorealAsset(asset);
      return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        url: videoSubmitCapableAsset(asset),
        previewUrl: asset.previewUrl || "",
        publicUrl: asset.publicUrl || "",
        assetUrl: photoreal ? asset.assetUrl || "" : "",
        arkPersonAsset: asset.arkPersonAsset?.enabled === true
          ? { ...asset.arkPersonAsset }
          : undefined,
        assetStylePreset: asset.assetStylePreset || "",
        assetStyleLabel: asset.assetStyleLabel || "",
        generationMode: asset.generationMode || "",
        aiGenerated: asset.aiGenerated === true,
        verificationType: asset.verificationType || "",
        validationStatus: asset.validationStatus || "",
        source: asset.source,
      };
    });
  const modelMode = settings.model === LIVENESS_MODEL ? PERSON_REFERENCE_MODEL : settings.model;
  return {
    projectId: canvasState.selectedId || "",
    nodeId: node.id,
    source: node.source || "",
    projectShotName: node.projectShotName || "",
    prompt: nodePrompt(node),
    model: modelMode === PERSON_REFERENCE_MODEL || modelMode === BYTEPLUS_MODEL ? "seedance-2-0" : modelMode,
    modelMode,
    ratio: settings.ratio,
    duration: Number(settings.duration || VIDEO_NODE_DEFAULTS.duration),
    resolution: settings.resolution,
    generateAudio: forceNoAudio ? false : settings.generateAudio !== false,
    frameControl: settings.frameControl,
    firstFrameUrl: frameAssets.first ? videoSubmitCapableAsset(frameAssets.first) : "",
    lastFrameUrl: frameAssets.last ? videoSubmitCapableAsset(frameAssets.last) : "",
    startFrameUrl: settings.frameControl === "first_last" ? "" : upstreamTailFrame?.tailFrameFileUrl || upstreamTailFrame?.tailFrameUrl || node.startFrameUrl || "",
    tailFrameSourceNodeId: upstreamTailFrame?.id || "",
    videoPromptMode: usesProductionBoard ? "production_board" : "prompt",
    storyboardRefs: Array.isArray(node.storyboardRefs) ? node.storyboardRefs : [],
    storyboardGuidance: node.storyboardGuidance || null,
    livenessGroupId: node.liveness?.groupId || "",
    livenessAssetUrl: node.liveness?.assetUrl || "",
    assets,
  };
}

function validateVideoNode(nodeId, { silent = false } = {}) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node || node.kind !== "video") return false;
  const block = (message) => {
    if (!silent) {
      updateVideoNodeStatus(nodeId, {
        status: "failed",
        statusMessage: message,
        progress: 100,
      });
      toast(message);
    }
    return false;
  };
  const payload = videoNodePayload(node);
  const usesProductionBoard = node.videoPromptMode === "production_board" || (Array.isArray(node.storyboardRefs) && node.storyboardRefs.length > 0);
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) };
  const frameAssets = selectedFrameAssetsForVideoNode(node);
  const missingTailFrame = usesProductionBoard || settings.frameControl === "first_last" ? null : missingUpstreamTailFrameForVideoNode(node);
  if (missingTailFrame) {
    return block(`等待上一段尾帧：${missingTailFrame.name || missingTailFrame.id || "上一段视频"}`);
  }
  if (settings.frameControl === "first_last" && (!frameAssets.first || !frameAssets.last || !payload.firstFrameUrl || !payload.lastFrameUrl)) {
    return block("首尾帧模式必须选择可提交的首帧和尾帧图片");
  }
  if (isArkPersonTargetVideoNode(node)) {
    const invalidArkAssets = effectiveNodeAssetIds(node)
      .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
      .filter((asset) => asset?.arkPersonAsset?.enabled === true && !arkPersonAssetUrl(asset));
    if (invalidArkAssets.length) return block(`方舟私域人物素材未绑定有效 asset://：${invalidArkAssets.map((asset) => asset.name || asset.id).join("、")}`);
    const unreadyPersonAssets = effectiveNodeAssetIds(node)
      .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
      .filter((asset) => isArkPersonReferenceAsset(asset) && !isArkVirtualPersonCertified(asset));
    if (unreadyPersonAssets.length) {
      return block(`真人/角色参考图必须先完成方舟私域虚拟人像认证并达到 active（asset://）：${unreadyPersonAssets.map((asset) => asset.name || asset.id).join("、")}`);
    }
  }
  if (isLivenessVideoNode(node) && !node.liveness?.groupId) {
    return block("请先创建并完成真人核验");
  }
  if (isLivenessVideoNode(node) && !node.liveness?.assetUrl) {
    return block("请先绑定或刷新真人素材 asset://");
  }
  if (!payload.prompt) {
    return block("请先填写视频提示词");
  }
  if (!silent) {
    const referenceText = payload.assets.length ? `，引用 ${payload.assets.length} 张参考图` : "";
    toast(`${payload.model} / ${payload.ratio} / ${payload.duration}s${referenceText}`);
  }
  return true;
}

function syncVideoModelForReferences(node) {
  return false;
}

function setVideoAssetSelectOptions(select, assets, selectedId, placeholder) {
  if (!select) return;
  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...assets.map((asset) => `<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name || asset.id)}</option>`),
  ].join("");
  select.value = assets.some((asset) => asset.id === selectedId) ? selectedId : "";
}

function syncArkVideoControls(element, node) {
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) };
  const active = isArkPersonTargetVideoNode(node);
  const frameControl = element.querySelector("[data-frame-control]");
  const framePanel = element.querySelector("[data-first-last-frame-panel]");
  const personPanel = element.querySelector("[data-ark-person-panel]");
  frameControl?.classList.toggle("hidden", !active);
  personPanel?.classList.toggle("hidden", !active);
  if (!active) {
    framePanel?.classList.add("hidden");
    return;
  }

  const references = effectiveNodeAssetIds(node)
    .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
    .filter(Boolean);
  const frameAssets = references.filter((asset) => !!videoSubmitCapableAsset(asset));
  const frameModeSelect = frameControl?.querySelector("select");
  if (frameModeSelect) {
    frameModeSelect.value = settings.frameControl;
    frameModeSelect.addEventListener("change", () => {
      node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), frameControl: frameModeSelect.value };
      renderNodes();
      scheduleCanvasSave();
    });
  }

  const firstLastActive = settings.frameControl === "first_last";
  framePanel?.classList.toggle("hidden", !firstLastActive);
  if (firstLastActive) {
    const firstSelect = framePanel?.querySelector("[data-first-frame-select]");
    const lastSelect = framePanel?.querySelector("[data-last-frame-select]");
    setVideoAssetSelectOptions(firstSelect, frameAssets, settings.firstFrameAssetId, "选择首帧");
    setVideoAssetSelectOptions(lastSelect, frameAssets, settings.lastFrameAssetId, "选择尾帧");
    firstSelect?.addEventListener("change", () => {
      node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), firstFrameAssetId: firstSelect.value };
      renderNodes();
      scheduleCanvasSave();
    });
    lastSelect?.addEventListener("change", () => {
      node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), lastFrameAssetId: lastSelect.value };
      renderNodes();
      scheduleCanvasSave();
    });
  }

  const assetSelect = personPanel?.querySelector("[data-ark-person-asset-select]");
  const assetUrlInput = personPanel?.querySelector("[data-ark-person-asset-url]");
  const status = personPanel?.querySelector("[data-ark-person-status]");
  const syncSelectedAsset = () => {
    const asset = references.find((item) => item.id === assetSelect?.value) || null;
    if (assetUrlInput) assetUrlInput.value = asset?.arkPersonAsset?.assetUrl || "";
    if (status) status.textContent = asset
      ? arkPersonAssetUrl(asset) ? "已认证私域虚拟人像" : "未认证"
      : "未选择素材";
  };
  setVideoAssetSelectOptions(assetSelect, references, references[0]?.id || "", "选择连接素材");
  syncSelectedAsset();
  assetSelect?.addEventListener("change", syncSelectedAsset);
  personPanel?.querySelector("[data-ark-person-action='bind']")?.addEventListener("click", () => {
    const asset = references.find((item) => item.id === assetSelect?.value);
    const assetUrl = String(assetUrlInput?.value || "").trim();
    if (!asset) return toast("请先选择要绑定的连接素材");
    if (!/^asset:\/\//i.test(assetUrl)) return toast("请输入方舟入库后获得的 asset:// 素材地址");
    asset.arkPersonAsset = {
      enabled: true,
      assetUrl,
      assetId: assetUrl.replace(/^asset:\/\//i, ""),
      boundAt: new Date().toISOString(),
      error: "",
    };
    renderNodes();
    scheduleCanvasSave();
  });
  personPanel?.querySelector("[data-ark-person-action='clear']")?.addEventListener("click", () => {
    const asset = references.find((item) => item.id === assetSelect?.value);
    if (!asset) return;
    asset.arkPersonAsset = { enabled: false, assetUrl: "", assetId: "", boundAt: "", error: "" };
    renderNodes();
    scheduleCanvasSave();
  });
}

function livenessStatusText(node) {
  const status = node.liveness?.status || "idle";
  if (node.liveness?.assetUrl) return `已绑定 ${node.liveness.assetUrl}`;
  if (node.liveness?.groupId) return `已创建 ${node.liveness.groupId}`;
  if (status === "pending") return "等待真人核验";
  if (status === "failed") return node.liveness?.error || "核验失败";
  return "未创建";
}

function syncLivenessPanel(element, node) {
  const panel = element.querySelector("[data-liveness-panel]");
  if (!panel) return;
  const active = isLivenessVideoNode(node);
  panel.classList.toggle("hidden", !active);
  if (!active) return;
  const status = panel.querySelector("[data-liveness-status]");
  if (status) status.textContent = livenessStatusText(node);
  const nameInput = panel.querySelector("[data-liveness-field='name']");
  const descriptionInput = panel.querySelector("[data-liveness-field='description']");
  const channelInput = panel.querySelector("[data-liveness-field='channelId']");
  const assetInput = panel.querySelector("[data-liveness-field='assetUrl']");
  if (nameInput) {
    nameInput.value = node.liveness?.name || "真人A";
    nameInput.addEventListener("input", () => {
      node.liveness = { ...(node.liveness || {}), name: nameInput.value };
      scheduleCanvasSave();
    });
  }
  if (descriptionInput) {
    descriptionInput.value = node.liveness?.description || "";
    descriptionInput.addEventListener("input", () => {
      node.liveness = { ...(node.liveness || {}), description: descriptionInput.value };
      scheduleCanvasSave();
    });
  }
  if (channelInput) {
    const remembered = node.liveness?.channelId || rememberedChannelId();
    channelInput.value = remembered;
    // Pre-filled from memory/default: write it back so the generate request
    // carries the channel even if the user never re-types it.
    if (remembered && !node.liveness?.channelId) {
      node.liveness = { ...(node.liveness || {}), channelId: remembered };
    }
    channelInput.addEventListener("input", () => {
      const value = channelInput.value.trim();
      node.liveness = { ...(node.liveness || {}), channelId: value };
      try {
        if (value) localStorage.setItem(LAST_CHANNEL_ID_KEY, value);
      } catch {}
      scheduleCanvasSave();
    });
  }
  if (assetInput) {
    assetInput.value = node.liveness?.assetUrl || "";
    assetInput.addEventListener("input", () => {
      node.liveness = { ...(node.liveness || {}), assetUrl: assetInput.value };
      scheduleCanvasSave();
    });
  }
  const assetButton = panel.querySelector("[data-liveness-action='asset']");
  if (assetButton) {
    assetButton.textContent = node.liveness?.assetUrl ? "刷新素材" : "绑定/刷新素材";
    assetButton.addEventListener("click", () => bindLivenessAsset(node.id).catch((error) => markLivenessFailed(node.id, error.message)));
  }
  const button = panel.querySelector("[data-liveness-action='verify']");
  if (button) {
    button.textContent = node.liveness?.groupId ? "更换素材组" : "创建素材组";
    button.addEventListener("click", () => startLivenessVerification(node.id).catch((error) => markLivenessFailed(node.id, error.message)));
  }
}

function markLivenessFailed(nodeId, message) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  node.liveness = { ...(node.liveness || {}), status: "failed", error: message || "核验失败" };
  renderNodes();
  scheduleCanvasSave();
  toast(message || "核验失败");
}

async function bindLivenessAsset(nodeId) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  const groupId = compactNodeText(node.liveness?.groupId || "");
  if (!groupId) return toast("请先创建并完成真人核验");
  node.liveness = { ...(node.liveness || {}), status: "pending", error: "" };
  renderNodes();
  scheduleCanvasSave();
  const data = await api("/api/canvas/person-asset", {
    method: "POST",
    body: JSON.stringify({
      groupId,
      url: node.liveness?.assetUrl || "",
      name: node.liveness?.name || "真人A",
    }),
  });
  const result = data.result || {};
  node.liveness = {
    ...(node.liveness || {}),
    status: result.status === "active" || result.assetUrl ? "active" : result.status || "pending",
    assetUrl: result.assetUrl || node.liveness?.assetUrl || "",
    assetVirtualId: result.virtualId || node.liveness?.assetVirtualId || "",
    error: result.status === "missing" ? result.message || "真人素材组内还没有 active 图片素材" : "",
  };
  renderNodes();
  scheduleCanvasSave();
  toast(result.message || (node.liveness.assetUrl ? "真人素材已绑定" : "真人素材待激活"));
}

async function startLivenessVerification(nodeId) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  const name = compactNodeText(node.liveness?.name || "真人A");
  if (!name) return toast("请填写真人模型名称");
  node.liveness = { ...(node.liveness || {}), name, status: "pending", error: "" };
  renderNodes();
  scheduleCanvasSave();
  const data = await api("/api/canvas/liveness-face-session", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: node.liveness?.description || "",
      channelId: node.liveness?.channelId || "",
    }),
  });
  const session = data.result || {};
  if (!session.h5_link) throw new Error("真人核验链接为空");
  const popup = window.open(session.h5_link, "pixel-toys-liveness-face", "width=480,height=720");
  if (!popup) throw new Error("浏览器阻止了核验窗口，请允许弹窗后重试");
  toast("请在弹窗中完成真人核验");
  const timeout = window.setTimeout(() => {
    window.removeEventListener("message", listener);
    const target = canvasState.nodes.find((item) => item.id === nodeId);
    if (target?.liveness?.groupId) {
      target.liveness = { ...(target.liveness || {}), status: "active", error: "" };
      renderNodes();
      scheduleCanvasSave();
      toast("未完成新核验，已保留现有素材组");
    } else {
      markLivenessFailed(nodeId, "真人核验超时，请重新创建链接");
    }
    try {
      popup.close();
    } catch {}
  }, 130000);
  const listener = (event) => {
    const result = event.data;
    if (!result || result.type !== "gravitex-asset-validate-result") return;
    window.clearTimeout(timeout);
    window.removeEventListener("message", listener);
    const target = canvasState.nodes.find((item) => item.id === nodeId);
    if (!target) return;
    if (result.ok) {
      target.liveness = {
        ...(target.liveness || {}),
        status: "active",
        groupId: result.group_id || "",
        groupType: result.group_type || "liveness_face",
        channelId: result.channel_id || "",
        assetUrl: "",
        error: "",
      };
      renderNodes();
      scheduleCanvasSave();
      toast("真人模型已创建");
    } else {
      markLivenessFailed(nodeId, result.error || "真人核验失败");
    }
  };
  window.addEventListener("message", listener);
}

function livenessLibraryStatusText() {
  const library = canvasState.livenessLibrary;
  const activeAssets = (library.assets || []).filter((asset) => asset.status === "active" && asset.assetUrl);
  if (library.groupId) {
    if (activeAssets.length) return `可用素材 ${activeAssets.length} 个`;
    if (/^asset:\/\//i.test(library.assetUrl || "")) return "已绑定人物素材";
    if (/^https:\/\//i.test(library.assetUrl || "")) return "素材组已创建，待提交素材";
    if (library.localAssetUrl && !library.assetUrl) return "素材组已创建，缺公网地址";
    if (library.error && !isStaleLivenessVerificationError(library.error)) return library.error;
    return `已创建 ${library.groupId}`;
  }
  if (library.error) return library.error;
  if (library.localAssetUrl && !library.assetUrl) return "已保存本地素材，缺公网地址";
  if (library.status === "pending") return "正在创建素材组";
  return "未创建";
}

function syncLivenessLibraryPanel() {
  const panel = qs("#livenessLibraryPanel");
  if (!panel) return;
  const library = canvasState.livenessLibrary;
  const status = panel.querySelector("[data-liveness-library-status]");
  if (status) status.textContent = livenessLibraryStatusText();
  const group = panel.querySelector("[data-liveness-library-group]");
  if (group) group.textContent = library.groupId || "未创建";
  const verifyButton = panel.querySelector("[data-liveness-library-action='verify']");
  if (verifyButton) verifyButton.textContent = library.groupId ? "更换素材组" : "创建素材组";
  const publicStatus = panel.querySelector("[data-liveness-public-status]");
  if (publicStatus) {
    if (library.assetUrl && /^https:\/\//i.test(library.assetUrl)) {
      publicStatus.textContent = "已获得素材组可用 HTTPS 地址";
      publicStatus.dataset.state = "ready";
    } else if (library.assetUrl && /^asset:\/\//i.test(library.assetUrl)) {
      publicStatus.textContent = "已是素材组 asset:// 素材";
      publicStatus.dataset.state = "ready";
    } else if (library.localAssetUrl) {
      publicStatus.textContent = "只有本地预览地址，还不能提交素材组";
      publicStatus.dataset.state = "blocked";
    } else {
      publicStatus.textContent = "等待选择图片或粘贴 HTTPS 地址";
      publicStatus.dataset.state = "idle";
    }
  }
  const localLink = panel.querySelector("[data-liveness-local-asset]");
  if (localLink) {
    localLink.classList.toggle("hidden", !library.localAssetUrl);
    localLink.href = library.localAssetUrl || "#";
    localLink.textContent = library.localAssetUrl ? `本地预览：${library.localAssetUrl}` : "";
  }
  const submitButton = panel.querySelector("[data-liveness-library-action='asset']");
  if (submitButton) submitButton.disabled = !!library.localAssetUrl && !/^https:\/\//i.test(library.assetUrl || "") && !/^asset:\/\//i.test(library.assetUrl || "");
  panel.querySelectorAll("[data-liveness-library-field]").forEach((field) => {
    const key = field.dataset.livenessLibraryField;
    field.value = library[key] || "";
  });
  renderLivenessAssetList();
}

function setLivenessLibraryPatch(patch = {}) {
  canvasState.livenessLibrary = normalizeLivenessLibraryState({
    ...canvasState.livenessLibrary,
    ...patch,
  });
  syncLivenessLibraryPanel();
  qsa("[data-video-liveness-library]").forEach((section) => {
    const element = section.closest(".canvas-node.video-node");
    const node = canvasState.nodes.find((item) => item.id === element?.dataset?.nodeId);
    if (node) syncInlineLivenessLibrary(element, node);
  });
  scheduleCanvasSave();
}

function normalizeLivenessAsset(raw = {}) {
  const assetUrl = raw.assetUrl || raw.asset_url || "";
  const previewUrl = raw.previewUrl || raw.preview_url || raw.url || "";
  const virtualId = raw.virtualId || raw.virtual_id || raw.id || "";
  const errorMessage = raw.errorMessage || raw.error_message || raw.error_msg || "";
  return {
    virtualId,
    assetUrl,
    previewUrl,
    groupId: raw.groupId || raw.group_id || canvasState.livenessLibrary.groupId || "",
    name: raw.name || raw.filename || raw.fileName || raw.assetName || virtualId || assetUrl || "真人素材",
    type: raw.assetType || raw.asset_type || "Image",
    status: raw.status || "",
    errorMessage,
  };
}

function livenessAssetMergeKey(asset = {}) {
  const groupId = compactNodeText(asset.groupId || canvasState.livenessLibrary.groupId || "");
  const name = compactNodeText(asset.name || canvasState.livenessLibrary.assetName || "").toLowerCase();
  const type = compactNodeText(asset.type || "Image").toLowerCase();
  if (groupId && name) return `${groupId}:${type}:${name}`;
  return asset.assetUrl || asset.virtualId || asset.previewUrl || "";
}

function mergeLivenessAsset(existing = {}, incoming = {}) {
  const next = { ...existing, ...incoming };
  if (!incoming.previewUrl && existing.previewUrl) next.previewUrl = existing.previewUrl;
  if (!incoming.assetUrl && existing.assetUrl) next.assetUrl = existing.assetUrl;
  if (!incoming.virtualId && existing.virtualId) next.virtualId = existing.virtualId;
  if (!incoming.errorMessage && existing.errorMessage) next.errorMessage = existing.errorMessage;
  if (String(existing.status || "").toLowerCase() === "active" && String(incoming.status || "").toLowerCase() !== "active") {
    next.status = existing.status;
  }
  return next;
}

function livenessAssetErrorText(asset = {}) {
  const raw = compactNodeText(asset.errorMessage || "");
  if (!raw) return "";
  if (/FaceMismatch|Face consistency verification failed/i.test(raw)) return "人脸与当前素材组核验人不一致";
  return raw;
}

function upsertLivenessAssets(assets = []) {
  const hidden = new Set(canvasState.livenessLibrary.hiddenAssetUrls || []);
  const byKey = new Map();
  for (const asset of canvasState.livenessLibrary.assets || []) {
    const normalized = normalizeLivenessAsset(asset);
    if (hidden.has(normalized.assetUrl || normalized.virtualId || normalized.previewUrl)) continue;
    const key = livenessAssetMergeKey(normalized);
    if (key) byKey.set(key, mergeLivenessAsset(byKey.get(key) || {}, normalized));
  }
  for (const asset of assets.map(normalizeLivenessAsset)) {
    if (hidden.has(asset.assetUrl || asset.virtualId || asset.previewUrl)) continue;
    const key = livenessAssetMergeKey(asset);
    if (!key) continue;
    byKey.set(key, mergeLivenessAsset(byKey.get(key) || {}, asset));
  }
  setLivenessLibraryPatch({ assets: [...byKey.values()], error: "" });
}

function syncCanvasAssetsFromLivenessAssets(assets = []) {
  if (!assets.length) return;
  const byId = new Map(canvasState.assets.map((asset) => [asset.id, asset]));
  for (const livenessAsset of assets.map(normalizeLivenessAsset)) {
    const match = [...byId.values()].find((asset) => {
      const sameGroup = !asset.groupId || !livenessAsset.groupId || asset.groupId === livenessAsset.groupId;
      const sameName = compactNodeText(asset.name || "").toLowerCase() === compactNodeText(livenessAsset.name || "").toLowerCase();
      const samePublic = asset.publicUrl && livenessAsset.previewUrl && asset.publicUrl === livenessAsset.previewUrl;
      return sameGroup && (sameName || samePublic);
    });
    if (!match) continue;
    byId.set(match.id, {
      ...match,
      assetUrl: livenessAsset.assetUrl || match.assetUrl || "",
      virtualId: livenessAsset.virtualId || match.virtualId || "",
      groupId: livenessAsset.groupId || match.groupId || "",
      validationStatus: livenessAsset.status || match.validationStatus || "",
      validationError: livenessAsset.errorMessage || "",
    });
  }
  canvasState.assets = [...byId.values()];
}

function removeLivenessAssetRecord(asset = {}) {
  const normalized = normalizeLivenessAsset(asset);
  const hideKey = normalized.assetUrl || normalized.virtualId || normalized.previewUrl;
  const hiddenAssetUrls = hideKey ? [...new Set([...(canvasState.livenessLibrary.hiddenAssetUrls || []), hideKey])] : canvasState.livenessLibrary.hiddenAssetUrls || [];
  const removeKey = livenessAssetMergeKey(normalized);
  const assets = (canvasState.livenessLibrary.assets || []).filter((item) => livenessAssetMergeKey(normalizeLivenessAsset(item)) !== removeKey);
  setLivenessLibraryPatch({ assets, hiddenAssetUrls, status: assets.length ? canvasState.livenessLibrary.status : "active", error: "" });
  toast("已移除失败记录");
}

function addLivenessAssetToCanvas(asset) {
  const normalized = normalizeLivenessAsset(asset);
  if (!normalized.assetUrl) return toast("这个素材还没有 asset://，请先刷新到 active");
  const id = `liveness_${normalized.virtualId || normalized.assetUrl}`;
  addAssets([
    {
      id,
      name: normalized.name || "真人素材",
      type: "liveness_face",
      url: normalized.assetUrl,
      previewUrl: normalized.previewUrl,
      source: "gravitex",
    },
  ]);
  addAssetNodesToCanvas([canvasState.assets.find((item) => item.id === id)]);
  toast("已加入画布，可连接到视频模块");
  return id;
}

function livenessPendingAssetFromPublicAsset(publicAsset = {}, file = {}) {
  return normalizeLivenessAsset({
    virtualId: `pending_${publicAsset.fileName || Date.now()}`,
    assetUrl: "",
    previewUrl: publicAsset.localUrl || publicAsset.url || "",
    name: file.name || publicAsset.fileName || "待提交人像",
    type: "Image",
    status: publicAsset.url ? "ready" : "local",
  });
}

async function prepareLivenessFileUpload(file, { nodeId = "", autoSubmit = true } = {}) {
  if (!file) return;
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) && !/^image\/(png|jpeg|jpg|webp)$/i.test(file.type || "")) {
    toast("请选择 PNG / JPG / WEBP 人像照片");
    return;
  }
  setLivenessLibraryPatch({
    assetName: file.name || "portrait.jpg",
    status: "pending",
    error: "",
  });
  toggleLivenessLibraryPanel(true);
  const dataUrl = await fileToDataUrl(file);
  const data = await api("/api/canvas/public-assets", {
    method: "POST",
    body: JSON.stringify({
      name: file.name || "portrait.jpg",
      dataUrl,
    }),
  });
  const publicAsset = data.result || {};
  const patch = {
    assetName: file.name || "portrait.jpg",
    assetUrl: publicAsset.url || "",
    localAssetUrl: publicAsset.localUrl || "",
    publicAssetReady: !!publicAsset.publicReady,
    status: publicAsset.publicReady ? "ready" : "local",
    error: publicAsset.publicReady ? "" : publicAsset.message || "已保存本地素材，但还缺少公网 HTTPS 地址。",
  };
  upsertLivenessAssets([livenessPendingAssetFromPublicAsset(publicAsset, file)]);
  setLivenessLibraryPatch(patch);
  if (!publicAsset.url) {
    toast("图片已上传到本地；还需要公网 HTTPS 地址才能提交素材组");
    return;
  }
  if (!canvasState.livenessLibrary.groupId) {
    toast("已获得素材地址，请先创建人物素材组");
    return;
  }
  if (autoSubmit) {
    await submitLivenessLibraryAsset({ nodeId });
  } else {
    toast("已获得素材地址，点击提交素材");
  }
}

function useLivenessAssetForVideo(nodeId, asset) {
  const assetId = addLivenessAssetToCanvas(asset);
  const target = canvasState.nodes.find((node) => node.id === nodeId && node.kind === "video");
  const canvasAsset = canvasState.assets.find((item) => item.id === assetId);
  if (!target || !canvasAsset) return;
  const point = {
    x: target.x - 300,
    y: target.y + 84 + upstreamAssetsForNode(target).length * 32,
  };
  let source = canvasState.nodes.find((node) => node.kind === "asset" && node.assets?.includes(assetId));
  if (!source) source = addAssetNodeAt(assetId, point, { silent: true });
  if (source && !canvasState.connections.some((connection) => connection.from === source.id && connection.to === target.id)) {
    canvasState.connections.push({ from: source.id, to: target.id });
  }
  renderNodes();
  scheduleCanvasSave();
  toast("已使用该人物素材作为视频参考");
}

function renderLivenessAssetList() {
  const list = qs("#livenessAssetList");
  if (!list) return;
  const assets = canvasState.livenessLibrary.assets || [];
  const html = !assets.length
    ? `<div class="liveness-empty">创建人物素材组后，提交公网 HTTPS 图片 URL；素材 active 后会显示 asset://。</div>`
    : assets
    .map((asset, index) => {
      const status = String(asset.status || "").toLowerCase();
      const active = status === "active" && asset.assetUrl;
      const failed = status === "failed";
      const buttonText = active ? "加入画布" : failed ? "移除记录" : status === "ready" ? "提交素材" : "刷新状态";
      const errorText = livenessAssetErrorText(asset);
      return `
        <article class="liveness-asset-card">
          ${asset.previewUrl ? `<img src="${escapeHtml(asset.previewUrl)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async" />` : `<div class="liveness-asset-placeholder">asset</div>`}
          <div>
            <strong>${escapeHtml(asset.name || `人物素材 ${index + 1}`)}</strong>
            <span data-state="${escapeHtml(status || "pending")}">${escapeHtml(asset.status || "pending")}</span>
            ${asset.assetUrl ? `<small>${escapeHtml(asset.assetUrl)}</small>` : ""}
            ${errorText ? `<small class="liveness-asset-error">${escapeHtml(errorText)}</small>` : ""}
          </div>
          <button type="button" data-liveness-asset-action="${active ? "add" : failed ? "remove" : status === "ready" ? "submit" : "refresh"}" data-liveness-asset-index="${index}">${buttonText}</button>
        </article>
      `;
    })
    .join("");
  // 内容不变则跳过重建，避免轮询反复销毁人物素材 <img>
  if (list._livHtml === html) return;
  list._livHtml = html;
  list.innerHTML = html;
  if (!assets.length) return;
  list.querySelectorAll("[data-liveness-asset-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const asset = assets[Number(button.dataset.livenessAssetIndex || 0)];
      const action = button.dataset.livenessAssetAction;
      if (action === "add") return addLivenessAssetToCanvas(asset);
      if (action === "remove") return removeLivenessAssetRecord(asset);
      if (action === "submit") {
        return submitLivenessLibraryAsset().catch((error) => {
          setLivenessLibraryPatch({ status: "failed", error: error.message });
          toast(error.message);
        });
      }
      return refreshLivenessLibraryAssets().catch((error) => toast(error.message));
    });
  });
}

function renderInlineLivenessAssetList(node) {
  const assets = canvasState.livenessLibrary.assets || [];
  if (!assets.length) {
    return `<div class="video-liveness-empty">暂无可用人物素材</div>`;
  }
  return assets
    .map((asset, index) => {
      const status = String(asset.status || "").toLowerCase();
      const active = status === "active" && asset.assetUrl;
      const errorText = livenessAssetErrorText(asset);
      return `
        <article class="video-liveness-card">
          ${asset.previewUrl ? `<img src="${escapeHtml(asset.previewUrl)}" alt="${escapeHtml(asset.name)}" loading="lazy" decoding="async" />` : `<div class="video-liveness-placeholder">asset</div>`}
          <div>
            <strong>${escapeHtml(asset.name || `人物素材 ${index + 1}`)}</strong>
            <span data-state="${escapeHtml(status || "pending")}">${active ? "可用" : escapeHtml(asset.status || "pending")}</span>
            ${errorText ? `<small>${escapeHtml(errorText)}</small>` : ""}
          </div>
          <button type="button" data-liveness-use-asset="${index}" ${active ? "" : "disabled"}>使用</button>
        </article>
      `;
    })
    .join("");
}

function syncInlineLivenessLibrary(element, node) {
  const section = element.querySelector("[data-video-liveness-library]");
  if (!section || node?.kind !== "video") return;
  const active = isPersonReferenceVideoNode(node) || isLivenessVideoNode(node);
  section.classList.toggle("hidden", !active);
  if (!active) return;
  const collapsed = !!canvasState.livenessLibrary.collapsed;
  section.classList.toggle("collapsed", collapsed);
  const body = section.querySelector("[data-liveness-library-body]");
  if (body) body.classList.toggle("hidden", collapsed);
  const toggleLabel = section.querySelector("[data-liveness-library-toggle-label]");
  if (toggleLabel) toggleLabel.textContent = collapsed ? "展开人物素材库" : "收起人物素材库";
  const list = section.querySelector("[data-video-liveness-list]");
  if (list) {
    const inlineHtml = renderInlineLivenessAssetList(node);
    // 内容不变则跳过重建，避免轮询反复销毁内联人物素材 <img>
    if (list._inlineLivHtml !== inlineHtml) {
      list._inlineLivHtml = inlineHtml;
      list.innerHTML = inlineHtml;
      list.querySelectorAll("[data-liveness-use-asset]").forEach((button) => {
        button.addEventListener("click", () => useLivenessAssetForVideo(node.id, canvasState.livenessLibrary.assets[Number(button.dataset.livenessUseAsset || 0)]));
      });
    }
  }
  section.querySelector("[data-liveness-library-action='toggle-inline']")?.addEventListener("click", () => {
    setLivenessLibraryPatch({ collapsed: !canvasState.livenessLibrary.collapsed });
    renderNodes();
  });
  section.querySelector("[data-liveness-library-action='settings']")?.addEventListener("click", () => toggleLivenessLibraryPanel(true));
  section.querySelector("[data-liveness-library-action='refresh']")?.addEventListener("click", () => {
    refreshLivenessLibraryAssets().catch((error) => toast(error.message));
  });
  section.querySelector("[data-liveness-library-upload]")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    prepareLivenessFileUpload(file, { nodeId: node.id }).catch((error) => {
      setLivenessLibraryPatch({ status: "failed", error: error.message });
      toast(error.message);
    });
  });
}

async function startLivenessLibraryVerification() {
  const library = canvasState.livenessLibrary;
  const name = compactNodeText(library.name || "人物素材组");
  if (!name) return toast("请填写素材组名称");
  setLivenessLibraryPatch({ name, status: "pending", error: "" });
  const data = await api("/api/canvas/person-asset-group", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: library.description || "",
      channelId: library.channelId || "",
    }),
  });
  const result = data.result || {};
  setLivenessLibraryPatch({
    status: "active",
    groupId: result.group_id || result.groupId || "",
    groupType: result.group_type || result.groupType || "aigc",
    channelId: result.channel_id || result.channelId || library.channelId || "",
    error: "",
  });
  toast("人物素材组已创建");
}

async function submitLivenessLibraryAsset(options = {}) {
  if (canvasState.livenessSubmitting) {
    toast("素材正在提交，请稍等");
    return;
  }
  const library = canvasState.livenessLibrary;
  const groupId = compactNodeText(library.groupId || "");
  if (!groupId) return toast("请先创建或填写人物素材组 ID");
  const url = compactNodeText(library.assetUrl || "");
  if (!url) return toast("请填写公网 HTTPS 素材 URL 或 asset://");
  if (!/^https:\/\//i.test(url) && !/^asset:\/\//i.test(url)) {
    return toast("人物素材只能使用公网 HTTPS URL 或 asset://");
  }
  const existing = (library.assets || []).find((asset) => {
    const sameGroup = !asset.groupId || asset.groupId === groupId;
    const sameName = compactNodeText(asset.name || "").toLowerCase() === compactNodeText(library.assetName || library.name || "").toLowerCase();
    const hasSubmittedAsset = /^asset:\/\//i.test(asset.assetUrl || "");
    return sameGroup && sameName && hasSubmittedAsset;
  });
  if (existing && String(existing.status || "").toLowerCase() !== "failed") {
    toast("素材已提交，正在刷新状态");
    await refreshLivenessLibraryAssets({ silent: true });
    scheduleLivenessAssetRefresh();
    return;
  }
  canvasState.livenessSubmitting = true;
  try {
    setLivenessLibraryPatch({ status: "pending", error: "" });
    const data = await api("/api/canvas/person-asset", {
      method: "POST",
      body: JSON.stringify({
        groupId,
        url,
        name: library.assetName || library.name || "人物素材",
      }),
    });
    const result = data.result || {};
    upsertLivenessAssets([result]);
    if (result.assetUrl && String(result.status || "").toLowerCase() === "active") {
      if (options.nodeId) useLivenessAssetForVideo(options.nodeId, result);
      else addLivenessAssetToCanvas(result);
    }
    setLivenessLibraryPatch({ status: result.status || "pending", error: result.status === "missing" ? result.message || "" : "" });
    if (String(result.status || "").toLowerCase() !== "active") scheduleLivenessAssetRefresh();
    toast(result.message || "人物素材已提交");
  } finally {
    canvasState.livenessSubmitting = false;
  }
}

function scheduleLivenessAssetRefresh() {
  clearTimeout(canvasState.livenessRefreshTimer);
  canvasState.livenessRefreshTimer = setTimeout(() => {
    refreshLivenessLibraryAssets({ silent: true }).catch((error) => toast(error.message));
  }, 6000);
}

async function refreshLivenessLibraryAssets({ silent = false } = {}) {
  const groupId = compactNodeText(canvasState.livenessLibrary.groupId || "");
  if (!groupId) return toast("请先创建或填写人物素材组 ID");
  setLivenessLibraryPatch({ status: "pending", error: "" });
  const data = await api(`/api/canvas/person-assets?groupId=${encodeURIComponent(groupId)}`);
  const result = data.result || {};
  upsertLivenessAssets(result.assets || []);
  syncCanvasAssetsFromLivenessAssets(result.assets || []);
  const hasActive = result.assets?.some((asset) => String(asset.status || "").toLowerCase() === "active");
  const hasPending = result.assets?.some((asset) => ["pending", "running", "processing"].includes(String(asset.status || "").toLowerCase()));
  setLivenessLibraryPatch({ status: hasActive ? "active" : "pending", error: "" });
  if (hasPending && !hasActive) scheduleLivenessAssetRefresh();
  if (!silent) toast(result.assets?.length ? `已刷新 ${result.assets.length} 个素材` : "素材组内还没有素材");
}

async function ensurePhotorealReferencesReady(nodes = []) {
  const referencedAssetIds = new Set();
  for (const node of nodes) {
    for (const asset of referenceAssetsForVideoNode(node).filter(isPhotorealAsset)) {
      referencedAssetIds.add(asset.id);
    }
  }
  const pending = [...referencedAssetIds]
    .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
    .filter((asset) => asset && !videoSubmitCapableAsset(asset));
  return { checked: referencedAssetIds.size, pending: pending.length, skipped: 0 };
}

function toggleLivenessLibraryPanel(open = undefined) {
  const panel = qs("#livenessLibraryPanel");
  if (!panel) return;
  const shouldOpen = open === undefined ? panel.classList.contains("hidden") : open;
  panel.classList.toggle("hidden", !shouldOpen);
  if (shouldOpen) syncLivenessLibraryPanel();
}

function syncRunningVideoPreview(preview, node) {
  if (!preview || node?.status !== "running") return false;
  const status = preview.querySelector(".generation-status");
  if (!status) return false;
  const progress = videoProgressValue(node);
  const hasProgress = hasRealVideoProgress(node);
  const progressLabel = status.querySelector(".generation-status-row em");
  if (progressLabel) progressLabel.textContent = hasProgress ? `${progress}%` : "";
  const progressFill = status.querySelector(".generation-progress-track i");
  if (progressFill) progressFill.style.width = `${hasProgress ? progress : 24}%`;
  const progressTrack = status.querySelector(".generation-progress-track");
  if (progressTrack) progressTrack.classList.toggle("is-indeterminate", !hasProgress);
  const modelLabel = status.querySelector(".generation-model-label");
  if (modelLabel) modelLabel.textContent = videoModelLabel(node);
  status.setAttribute("aria-label", hasProgress ? `生成中 ${progress}%` : "生成中");
  return true;
}

function activateVideoPreview(preview) {
  const video = preview?.querySelector("video");
  if (!video || !video.src) return;
  // A canvas refresh should leave completed media paused. The user can start
  // playback from the native controls without losing the current canvas state.
  video.autoplay = false;
  video.removeAttribute("autoplay");
  video.muted = false;
  video.loop = false;
  video.preload = "metadata";
}

function bindVideoPreviewActions(preview, nodeId) {
  const capture = preview?.querySelector("[data-capture-tail-frame]");
  if (!capture || capture.dataset.bound === "true") return;
  capture.dataset.bound = "true";
  capture.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    captureVideoTailFrame(nodeId, capture).catch((error) => toast(error.message));
  });
}

function videoTailFrameAssetName(node) {
  const raw = String(node?.projectShotName || node?.shotName || node?.id || "视频").trim();
  const safe = raw.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "视频";
  return `${safe}-尾帧.png`;
}

async function captureVideoTailFrame(nodeId, button) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node || node.kind !== "video" || node.status !== "completed" || !node.videoUrl) {
    throw new Error("只有已完成的视频可以截取尾帧");
  }
  const existing = canvasState.assets.find(
    (asset) => asset.source === "video-tail-frame" && asset.sourceVideoNodeId === node.id && asset.sourceVideoTaskId === (node.taskId || ""),
  );
  if (existing) {
    const existingNode = canvasState.nodes.find((item) => item.kind === "asset" && item.assets?.includes(existing.id));
    if (!existingNode) {
      const element = qs(`[data-node-id="${node.id}"]`);
      const width = element?.offsetWidth || node.width || VIDEO_NODE_DEFAULT_WIDTH;
      addAssetNodeAt(existing.id, { x: node.x + width + 88, y: node.y }, { silent: true });
    }
    toast("该视频尾帧已在画布素材中");
    return existing;
  }
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  updateVideoNodeStatus(node.id, {
    tailFrameCaptureStatus: "capturing",
    tailFrameCaptureMessage: "",
  }, { persist: false });
  try {
    const data = await api("/api/canvas/tail-frame", {
      method: "POST",
      timeoutMs: 120_000,
      body: JSON.stringify({
        projectId: canvasStorageProjectId(),
        nodeId: node.id,
        videoUrl: node.videoUrl,
        tailFrameUrl: node.tailFrameUrl || "",
      }),
    });
    const saved = data.result || {};
    const frameUrl = String(saved.tailFrameUrl || saved.tail_frame_url || node.tailFrameUrl || "").trim();
    if (!frameUrl) throw new Error(saved.message || "尾帧截取失败，视频未返回可用画面");
    updateVideoNodeStatus(node.id, {
      tailFrameReady: saved.ready === true || !!frameUrl || node.tailFrameReady === true,
      videoUrl: saved.videoUrl || node.videoUrl || "",
      videoLocalFile: saved.videoLocalFile || node.videoLocalFile || "",
      tailFrameUrl: frameUrl,
      tailFrameLocalFile: saved.tailFrameLocalFile || node.tailFrameLocalFile || "",
      tailFrameFileUrl: saved.tailFrameFileUrl || node.tailFrameFileUrl || "",
      tailFrameMessage: saved.message || "",
      tailFrameCaptureStatus: "ready",
      tailFrameCaptureMessage: "",
    }, { persist: false });
    const asset = {
      id: `video_tail_${node.id}_${node.taskId || Date.now()}`,
      name: videoTailFrameAssetName(node),
      type: "Video Tail Frame",
      mediaType: "image",
      url: frameUrl,
      previewUrl: frameUrl,
      localUrl: /^\//.test(frameUrl) ? frameUrl : "",
      source: "video-tail-frame",
      sourceVideoNodeId: node.id,
      sourceVideoTaskId: node.taskId || "",
      generatedAt: new Date().toISOString(),
    };
    addAssets([asset]);
    const element = qs(`[data-node-id="${node.id}"]`);
    const width = element?.offsetWidth || node.width || VIDEO_NODE_DEFAULT_WIDTH;
    addAssetNodeAt(asset.id, { x: node.x + width + 88, y: node.y }, { silent: true });
    toast("已截取尾帧并添加到画布");
    return asset;
  } catch (error) {
    updateVideoNodeStatus(node.id, {
      tailFrameCaptureStatus: "failed",
      tailFrameCaptureMessage: error.message || "尾帧截取失败",
    }, { persist: false });
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

function refreshVideoNodeElement(nodeId) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const element = qs(`[data-node-id="${nodeId}"]`);
  if (!node || node.kind !== "video" || !element) return false;
  positionNodeElement(element, node);
  syncVideoNodeDimensions(element, node);
  element.dataset.videoStatus = node.status || "idle";
  element.dataset.videoRatio = node.settings?.ratio || VIDEO_NODE_DEFAULTS.ratio;
  element.dataset.videoModel = node.settings?.model || VIDEO_NODE_DEFAULTS.model;
  element.classList.toggle("has-input-link", canvasState.connections.some((connection) => connection.to === node.id));
  element.classList.toggle("has-output-link", canvasState.connections.some((connection) => connection.from === node.id));
  element.classList.toggle("is-composer-open", canvasState.activeVideoNodeId === node.id);
  element.classList.toggle("is-selected", canvasState.selectedNodeIds.has(node.id));
  const preview = element.querySelector(".video-preview-slot");
  if (preview) {
    preview.style.setProperty("--video-preview-ratio", VIDEO_PREVIEW_RATIOS[node.settings?.ratio] || VIDEO_PREVIEW_RATIOS[VIDEO_NODE_DEFAULTS.ratio]);
    // Only rebuild the preview DOM when its content actually changes. Otherwise
    // a completed <video> gets destroyed/recreated on every 5s status poll,
    // which makes the preview flicker in and out.
    const previewSig = JSON.stringify({
      kind: node.kind,
      generationStatusVersion: 2,
      videoUrl: node.videoUrl || "",
      // Some project providers keep the same media URL across generations.
      // The task identity must still force the player to adopt the new result.
      taskId: node.taskId || "",
      videoPreviewVersion: node.videoPreviewVersion || "",
      status: node.status || "",
      tailFrameUrl: node.tailFrameUrl || "",
      tailFrameCaptureStatus: node.tailFrameCaptureStatus || "",
      tailFrameCaptureMessage: node.tailFrameCaptureMessage || "",
    });
    const runningPreviewSynced = syncRunningVideoPreview(preview, node);
    if (!runningPreviewSynced && preview.dataset.previewSig !== previewSig) {
      preview.dataset.previewSig = previewSig;
      preview.innerHTML = renderVideoPreview(node);
      activateVideoPreview(preview);
    }
    bindVideoPreviewActions(preview, node.id);
    if (runningPreviewSynced) preview.dataset.previewSig = previewSig;
  }
  const kind = element.querySelector(".video-titlebar .node-kind");
  if (kind) kind.textContent = "视频生成";
  const frame = element.querySelector(".video-preview-frame");
  if (frame) {
    const settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) };
    const modelLabel = VIDEO_MODEL_LABELS[settings.model] || settings.model || "Seedance";
    const audioLabel = settings.generateAudio === false ? "无音效" : "音效";
    frame.setAttribute("title", `${modelLabel} · ${settings.ratio || "9:16"} · ${settings.resolution || "720p"} · ${settings.duration || 5}s · ${audioLabel}`);
  }
  const summary = element.querySelector(".node-flow-summary");
  if (summary) summary.textContent = videoModeSummary(node);
  const assets = element.querySelector(".node-assets");
  if (assets) {
    // Only rebuild the reference chips when their content actually changes.
    // Otherwise the (multi-MB) reference <img> elements get destroyed and
    // recreated on every 5s refresh and never finish loading — which is why
    // the thumbnails kept failing to show up right away.
    const assetsHtml = renderNodeAssets(node);
    if (assets._assetsHtml !== assetsHtml) {
      assets._assetsHtml = assetsHtml;
      assets.innerHTML = assetsHtml;
      assets.querySelectorAll("[data-insert-reference]").forEach((button) => {
        button.addEventListener("click", () => insertTextIntoPrompt(node.id, button.dataset.insertReference || ""));
      });
    }
  }
  const generate = element.querySelector("[data-video-action='generate']");
  if (generate) {
    generate.disabled = node.status === "running";
    generate.textContent = node.status === "running" ? "生成中" : "生成视频";
  }
  return true;
}

function updateVideoNodeStatus(nodeId, patch, options = {}) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  Object.assign(node, patch);
  if (!refreshVideoNodeElement(nodeId)) renderNodes();
  if (options.persist !== false) scheduleCanvasSave();
}

async function persistNodeTailFrame(nodeId, result = {}, generationToken = ensureVideoGenerationToken(nodeId)) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const expectedTaskId = node?.taskId || result.taskId || "";
  if (!node || !videoOperationIsCurrent(nodeId, { generationToken, taskId: expectedTaskId })) return null;
  // 只针对尾帧模式:故事板 / Production Board 模式不抽尾帧、不做首尾帧连续
  const usesProductionBoard = node.videoPromptMode === "production_board" || (Array.isArray(node.storyboardRefs) && node.storyboardRefs.length > 0);
  if (usesProductionBoard) return null;
  const tailFrameUrl = String(result.tailFrameUrl || result.tail_frame_url || "").trim();
  const videoUrl = String(result.videoUrl || node.videoUrl || "").trim();
  // 只要有 videoUrl 就调接口:provider 没返回尾帧URL时,由服务端 ffmpeg 从视频抽尾帧
  if (!tailFrameUrl && !videoUrl) return null;
  // 海外(BytePlus/新加坡)视频:国内服务器跨境下载 ~8KB/s,尾帧提取物理上做不了,直接跳过不报错。
  // 视频本身用远程 URL 正常播放;仅无法做海报缩略图与多段首尾帧接龙。
  const isOverseasVideo = node.taskProvider === "byteplus" || /(?:^|[.\/])ap-southeast|bytepluses\.com/i.test(videoUrl);
  if (isOverseasVideo && !tailFrameUrl) {
    if (!videoOperationIsCurrent(nodeId, { generationToken, taskId: expectedTaskId })) return null;
    updateVideoNodeStatus(nodeId, {
      tailFrameReady: false,
      videoUrl: node.videoUrl || videoUrl,
      tailFrameMessage: "海外通道视频,已跳过尾帧提取(不影响播放,暂不支持接龙)",
    });
    return null;
  }
  try {
    const data = await api("/api/canvas/tail-frame", {
      method: "POST",
      body: JSON.stringify({
        projectId: canvasStorageProjectId(),
        nodeId,
        videoUrl,
        tailFrameUrl,
      }),
    });
    if (!videoOperationIsCurrent(nodeId, { generationToken, taskId: expectedTaskId })) return null;
    const saved = data.result || {};
    updateVideoNodeStatus(nodeId, {
      tailFrameReady: saved.ready === true,
      videoUrl: saved.videoUrl || node.videoUrl || videoUrl,
      videoLocalFile: saved.videoLocalFile || node.videoLocalFile || "",
      tailFrameUrl: saved.tailFrameUrl || tailFrameUrl,
      tailFrameFileUrl: saved.tailFrameFileUrl || "",
      tailFrameMessage: saved.message || "",
    });
    return saved;
  } catch (error) {
    if (!videoOperationIsCurrent(nodeId, { generationToken, taskId: expectedTaskId })) return null;
    updateVideoNodeStatus(nodeId, {
      tailFrameReady: false,
      tailFrameUrl,
      tailFrameMessage: error.message || "尾帧保存失败",
    });
    return null;
  }
}

function markVideoNodeFailed(nodeId, message, options = {}) {
  if (!videoOperationIsCurrent(nodeId, options)) return false;
  clearVideoPoll(nodeId);
  // 海外火山音频审核拦截:若本节点开着音频且还没自动重试过,自动关音频重试一次,而不是直接判失败。
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const audioWasOn = node && (node.settings?.generateAudio !== false);
  if (
    node &&
    OUTPUT_AUDIO_SENSITIVE_RE.test(String(message || "")) &&
    audioWasOn &&
    !audioRetriedVideoNodes.has(nodeId)
  ) {
    audioRetriedVideoNodes.add(nodeId);
    const retryToken = beginVideoGeneration(nodeId);
    updateVideoNodeStatus(nodeId, {
      status: "running",
      statusMessage: "音频被审核拦截,正在关闭音频重试…",
      progress: null,
    });
    toast("生成的音频被海外火山判定敏感,已自动关闭音频重新生成");
    generateVideoNode(nodeId, { forceNoAudio: true, generationToken: retryToken }).catch((error) =>
      markVideoNodeFailed(nodeId, error.message || "关音频重试失败", { generationToken: retryToken }),
    );
    return true;
  }
  updateVideoNodeStatus(nodeId, {
    status: "failed",
    statusMessage: message || "视频生成失败",
    progress: 100,
  });
  toast(message || "视频生成失败");
  return true;
}

// ---- 图片生成节点（gpt-image-2 通道） ----
function assetReferenceUrlById(assetId) {
  const asset = canvasState.assets.find((item) => item.id === assetId);
  if (!asset) return "";
  return assetReferenceUrl(asset);
}

async function persistBlobImageReferenceAsset(assetId) {
  const asset = canvasState.assets.find((item) => item.id === assetId);
  const referenceUrl = assetReferenceUrl(asset);
  if (!asset || !/^blob:/i.test(referenceUrl)) return referenceUrl;
  let blob;
  try {
    const response = await fetch(referenceUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch (error) {
    throw new Error(`临时参考图读取失败：${error.message || "请重新上传"}`);
  }
  const dataUrl = await fileToDataUrl(blob);
  const data = await api("/api/canvas/public-assets", {
    method: "POST",
    body: JSON.stringify({ name: asset.name || "reference-image.png", dataUrl }),
  });
  const publicAsset = data.result || {};
  const previewUrl = publicAsset.localUrl || publicAsset.url || "";
  const stableUrl = publicAsset.url || publicAsset.localUrl || "";
  if (!stableUrl) throw new Error("临时参考图保存失败：未返回可用地址");
  const updated = {
    ...asset,
    url: stableUrl,
    previewUrl,
    publicUrl: publicAsset.url || "",
    localUrl: publicAsset.localUrl || "",
    uploading: false,
    uploadFailed: false,
    uploadMessage: "",
  };
  addAssets([updated]);
  renderNodes();
  return assetReferenceUrl(updated);
}

function imageReferenceAssetsForGeneration(node) {
  const references = referenceAssetsForVideoNode(node);
  const mentionNumbers = [...String(node?.prompt || "").matchAll(/[@＠]图片\s*(\d+)/gi)].map((match) => Number(match[1]));
  const uniqueMentionNumbers = [...new Set(mentionNumbers.filter((value) => Number.isInteger(value) && value > 0))];
  if (!uniqueMentionNumbers.length) return { references, missing: [] };
  const available = new Set(references.map((reference) => reference.index));
  const selected = references.filter((reference) => uniqueMentionNumbers.includes(reference.index));
  const missing = uniqueMentionNumbers.filter((value) => !available.has(value));
  return { references: selected, missing };
}

function imageDownloadName(node) {
  const base = String(node?.id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 8) || "result";
  return `pixel-toy-image-${base}.png`;
}

// 复用预览用的同源版本化 URL（?v= 已被服务端标为 immutable 强缓存），配合 <a download>
// 让浏览器直接从缓存另存，无需再走 download=1 的 no-store 重新拉取（下载即时）。
function imageDownloadHref(node) {
  return String(node?.imageUrl || "").trim();
}

function imagePreviewSig(node) {
  const asset = primaryAssetForNode(node);
  return JSON.stringify([
    node.imageUrl || "",
    node.status || "",
    node.statusMessage || "",
    asset?.arkPersonAsset?.status || "",
    asset?.arkPersonAsset?.assetId || "",
    asset?.arkPersonAsset?.assetUrl || "",
  ]);
}

function renderImagePreview(node) {
  const status = String(node.status || "idle");
  if (status === "running") {
    return `<div class="image-preview-state running generation-status" aria-label="图片生成处理中">
      <div class="generation-status-row"><strong>图片生成</strong><em>处理中</em></div>
      <div class="generation-progress-track" aria-hidden="true"><i style="width: 24%"></i></div>
      <span class="generation-status-message">${escapeHtml(node.statusMessage || "任务已提交，等待接口进度")}</span>
    </div>`;
  }
  if (node.imageUrl) {
    const asset = primaryAssetForNode(node);
    const certificationStatus = String(asset?.arkPersonAsset?.status || "").toLowerCase();
    const certificationBadge = isArkVirtualPersonCertified(asset)
      ? `<span class="ark-virtual-person-badge image-preview-certification-badge" data-certification-state="active" title="方舟私域虚拟人像已认证" aria-label="方舟私域虚拟人像已认证">✓</span>`
      : certificationStatus === "processing"
        ? `<span class="ark-virtual-person-badge image-preview-certification-badge is-processing" data-certification-state="processing" title="方舟私域虚拟人像认证中" aria-label="方舟私域虚拟人像认证中">…</span>`
        : "";
    const downloadHref = imageDownloadHref(node);
    return certificationBadge +
      `<img class="image-preview-img" draggable="false" src="${escapeHtml(thumbUrl(node.imageUrl, 640))}" alt="生成结果" loading="lazy" decoding="async" />` +
      `<div class="media-action-cluster">` +
        `<button type="button" class="media-download-button media-regen-button" data-image-action="regenerate" aria-label="重新生成" title="重新生成">↻<span>重新生成</span></button>` +
        (downloadHref
          ? `<a class="media-download-button" href="${escapeHtml(downloadHref)}" download="${escapeHtml(imageDownloadName(node))}" aria-label="下载生成图片">${DOWNLOAD_ICON_SVG}<span>下载</span></a>`
          : "") +
      `</div>`;
  }
  if (status === "failed") {
    return `<div class="image-preview-state failed"><strong>生成失败</strong><span>${escapeHtml(node.statusMessage || "请重试")}</span></div>`;
  }
  return `<div class="image-preview-state">生成结果预览</div>`;
}

// 给图片节点缩略图里的「重新生成」按钮绑定点击(preview.innerHTML 每次重建后都要重绑)。
function bindImageRegenButton(slotEl, nodeId) {
  slotEl?.querySelector("[data-image-action='regenerate']")?.addEventListener("click", (event) => {
    event.stopPropagation();
    generateImageNode(nodeId).catch((error) => markImageNodeFailed(nodeId, error.message));
  });
}

function updateImageNodeStatus(nodeId, patch, options = {}) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  Object.assign(node, patch);
  if (!refreshImageNodeElement(nodeId)) renderNodes();
  if (options.persist !== false) scheduleCanvasSave();
}

function markImageNodeFailed(nodeId, message) {
  clearVideoPoll(nodeId);
  updateImageNodeStatus(nodeId, { status: "failed", statusMessage: message || "出图失败" });
  toast(message || "出图失败");
}

function refreshImageNodeElement(nodeId) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const element = qs(`[data-node-id="${nodeId}"]`);
  if (!node || node.kind !== "image" || !element) return false;
  positionNodeElement(element, node);
  syncImageNodeDimensions(element, node);
  element.classList.toggle("has-input-link", canvasState.connections.some((connection) => connection.to === node.id));
  element.classList.toggle("has-output-link", canvasState.connections.some((connection) => connection.from === node.id));
  element.classList.toggle("is-composer-open", canvasState.activeVideoNodeId === node.id);
  element.classList.toggle("is-selected", canvasState.selectedNodeIds.has(node.id));
  const preview = element.querySelector(".image-preview-slot");
  if (preview) {
    preview.style.setProperty("--image-preview-ratio", VIDEO_PREVIEW_RATIOS[node.settings?.ratio] || "16 / 9");
    const sig = imagePreviewSig(node);
    if (preview.dataset.previewSig !== sig) {
      preview.dataset.previewSig = sig;
      preview.innerHTML = renderImagePreview(node);
      bindImageRegenButton(preview, node.id);
    }
  }
  const assets = element.querySelector(".node-assets");
  if (assets) {
    const assetsHtml = renderNodeAssets(node);
    if (assets._assetsHtml !== assetsHtml) {
      assets._assetsHtml = assetsHtml;
      assets.innerHTML = assetsHtml;
      assets.querySelectorAll("[data-insert-reference]").forEach((button) => {
        button.addEventListener("click", () => insertTextIntoPrompt(node.id, button.dataset.insertReference || ""));
      });
    }
  }
  const summary = element.querySelector(".node-flow-summary");
  if (summary) summary.textContent = upstreamSummary(node);
  const generate = element.querySelector("[data-image-action='generate']");
  if (generate) {
    generate.disabled = node.status === "running";
    generate.textContent = node.status === "running" ? "生成中" : "生成图片";
  }
  return true;
}

async function pollImageNode(nodeId, taskId) {
  if (!taskId) return;
  clearVideoPoll(nodeId);
  const tick = async () => {
    try {
      const data = await api(`/api/canvas/image-generations/${encodeURIComponent(taskId)}`);
      const result = data.result || {};
      const status = String(result.status || "").toLowerCase();
      if (status === "completed" && result.url) {
        clearVideoPoll(nodeId);
        const assetId = `canvas_gen_${Date.now()}`;
        addAssets([{
          id: assetId,
          name: "画布出图",
          type: "Generated",
          url: result.url,
          previewUrl: result.url,
          publicUrl: result.url,
          localUrl: result.url,
          source: "canvas-image",
          generationMode: "ai-generated",
          aiGenerated: true,
          verificationType: "ai-generated",
          assetStylePreset: "photoreal",
          assetStyleLabel: "AI 写实",
          validationStatus: "ai-generated",
        }]);
        updateImageNodeStatus(nodeId, { status: "completed", statusMessage: "生成完成", imageUrl: result.url, generatedAssetId: assetId, assets: [assetId] });
        refreshConnectedNodeElements(nodeId);
        renderLinks();
        toast("画布出图完成");
        return;
      }
      if (status === "failed") {
        markImageNodeFailed(nodeId, result.message || "出图失败");
        return;
      }
      const timer = setTimeout(tick, videoPollDelay(4000));
      canvasState.pollTimers.set(nodeId, timer);
    } catch (error) {
      markImageNodeFailed(nodeId, error.message);
    }
  };
  const timer = setTimeout(tick, videoPollDelay(2500));
  canvasState.pollTimers.set(nodeId, timer);
}

async function generateImageNode(nodeId) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node || node.kind !== "image") return;
  const prompt = (node.prompt || "").trim();
  if (!prompt) return toast("请先填写图片描述");
  const settings = { ...IMAGE_NODE_DEFAULTS, ...(node.settings || {}) };
  const selection = imageReferenceAssetsForGeneration(node);
  if (selection.missing.length) return toast(`提示词中的 @图片${selection.missing.join("、@图片")} 没有对应的已连接参考图`);
  const referenceImages = (await Promise.all(selection.references.map((reference) => persistBlobImageReferenceAsset(reference.id)))).filter(Boolean);
  if (selection.references.length && referenceImages.length !== selection.references.length) {
    return toast("部分参考图无法读取，请重新上传或导入后再生成");
  }
  clearVideoPoll(nodeId);
  updateImageNodeStatus(nodeId, { status: "running", statusMessage: "正在提交出图任务", imageUrl: "" });
  try {
    const data = await api("/api/canvas/image-generation", {
      method: "POST",
      body: JSON.stringify({ prompt, imageModel: settings.model, ratio: settings.ratio, resolution: settings.resolution, referenceImages }),
    });
    const taskId = data.result?.taskId || "";
    if (!taskId) throw new Error("提交出图任务失败：未拿到 taskId");
    updateImageNodeStatus(nodeId, { taskId, statusMessage: "生成中" });
    pollImageNode(nodeId, taskId);
  } catch (error) {
    markImageNodeFailed(nodeId, error.message);
  }
}

function projectVideoNodeIsActive(node = {}) {
  if (!isProjectVideoNode(node)) return false;
  const status = String(node.status || "").toLowerCase();
  return status === "running" || status === "queued" || status === "pending";
}

async function pollProjectVideoNode(nodeId, generationToken = ensureVideoGenerationToken(nodeId)) {
  if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
  clearVideoPoll(nodeId);
  let attempts = 0;
  const tick = async () => {
    try {
      if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
      const selectedId = canvasState.selectedId;
      if (!selectedId) return;
      await loadProject(selectedId, {
        preserveSelection: true,
        silent: true,
        videoGeneration: { nodeId, generationToken },
      });
      if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
      const next = canvasState.nodes.find((item) => item.id === nodeId);
      if (!projectVideoNodeIsActive(next)) return;
      attempts += 1;
      const delay = attempts < 6 ? 2500 : 5000;
      const timer = setTimeout(tick, videoPollDelay(delay));
      canvasState.pollTimers.set(nodeId, timer);
    } catch (error) {
      const node = canvasState.nodes.find((item) => item.id === nodeId);
      if (!videoOperationIsCurrent(nodeId, { generationToken }) || !projectVideoNodeIsActive(node)) return;
      const timer = setTimeout(tick, videoPollDelay(5000));
      canvasState.pollTimers.set(nodeId, timer);
    }
  };
  const timer = setTimeout(tick, videoPollDelay(2500));
  canvasState.pollTimers.set(nodeId, timer);
}

function applyVideoGenerationResult(nodeId, result = {}, options = {}) {
  const generationToken = options.generationToken || ensureVideoGenerationToken(nodeId);
  const expectedTaskId = options.expectedTaskId || "";
  if (
    !videoOperationIsCurrent(nodeId, { generationToken, taskId: expectedTaskId }) ||
    (expectedTaskId && result.taskId && result.taskId !== expectedTaskId)
  ) return true;
  const status = String(result.status || "").toLowerCase();
  const nextProgress = normalizeVideoProgress(result.progress, 99);
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const resolvedTaskId = result.taskId || expectedTaskId || node?.taskId || "";
  if (result.videoUrl || status === "completed") {
    clearVideoPoll(nodeId);
    audioRetriedVideoNodes.delete(nodeId);
    updateVideoNodeStatus(nodeId, {
      status: "completed",
      statusMessage: result.message || "生成完成",
      videoUrl: result.videoUrl || node?.videoUrl || "",
      // Even when the provider reuses the same URL, identify this generation
      // so the preview element is rebuilt instead of reusing the old video.
      videoPreviewVersion: result.videoPreviewVersion || node?.videoPreviewVersion || resolvedTaskId || `video-generation-${Date.now().toString(36)}`,
      taskId: resolvedTaskId,
      taskProvider: result.provider || node?.taskProvider || "",
      progress: 100,
    });
    persistNodeTailFrame(nodeId, result, generationToken);
    toast("视频已生成");
    scheduleTailFrameSync(nodeId, 0, generationToken);
    return true;
  }
  if (status === "failed") {
    markVideoNodeFailed(nodeId, result.message || "Seedance 任务失败", { generationToken, taskId: expectedTaskId });
    return true;
  }
  const taskChanged = !!result.taskId && result.taskId !== node?.taskId;
  updateVideoNodeStatus(nodeId, {
    status: "running",
    statusMessage: result.message || result.statusLabel || "生成中",
    taskId: result.taskId || "",
    taskProvider: result.provider || "",
    progress: nextProgress,
  }, {
    persist: taskChanged,
  });
  return false;
}

async function pollVideoNode(nodeId, taskId, provider = "", generationToken = ensureVideoGenerationToken(nodeId)) {
  if (!taskId || !videoOperationIsCurrent(nodeId, { generationToken, taskId })) return;
  clearVideoPoll(nodeId);
  const tick = async () => {
    try {
      if (!videoOperationIsCurrent(nodeId, { generationToken, taskId })) return;
      const providerQuery = provider ? `?provider=${encodeURIComponent(provider)}` : "";
      const data = await api(`/api/canvas/video-generations/${encodeURIComponent(taskId)}${providerQuery}`);
      if (!videoOperationIsCurrent(nodeId, { generationToken, taskId })) return;
      const done = applyVideoGenerationResult(nodeId, data.result || {}, { generationToken, expectedTaskId: taskId });
      if (!done) {
        if (!videoOperationIsCurrent(nodeId, { generationToken, taskId })) return;
        const timer = setTimeout(tick, videoPollDelay(5000));
        canvasState.pollTimers.set(nodeId, timer);
      }
    } catch (error) {
      markVideoNodeFailed(nodeId, error.message, { generationToken, taskId });
    }
  };
  const timer = setTimeout(tick, videoPollDelay(2500));
  canvasState.pollTimers.set(nodeId, timer);
}

function resumeVideoPolls() {
  for (const node of canvasState.nodes) {
    if (node.kind !== "video") continue;
    const status = String(node.status || "").toLowerCase();
    if (!["running", "queued", "pending"].includes(status)) continue;
    if (canvasState.pollTimers.has(node.id)) continue;
    if (isProjectVideoNode(node) && shotNameFromProjectVideoNode(node)) {
      pollProjectVideoNode(node.id, ensureVideoGenerationToken(node.id));
      continue;
    }
    if (node.taskId) pollVideoNode(node.id, node.taskId, node.taskProvider || "", ensureVideoGenerationToken(node.id));
  }
}

async function generateVideoNode(nodeId, options = {}) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node || node.kind !== "video") return;
  const generationToken = options.generationToken || beginVideoGeneration(nodeId);
  if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
  const videoPreviewVersion = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // Invalidate the previous poll immediately, before any async reference
  // preparation, so its in-flight response cannot win this regeneration.
  clearVideoPoll(nodeId);
  // 手动发起(非音频重试)时,清掉旧的重试标记,让本轮可以重新尝试带音频。
  if (!options.forceNoAudio) audioRetriedVideoNodes.delete(nodeId);
  const projectShotName = shotNameFromProjectVideoNode(node);
  if (isProjectVideoNode(node) && projectShotName) {
    updateVideoNodeStatus(nodeId, {
      status: "running",
      statusMessage: "正在通过项目队列提交 Seedance 任务",
      videoUrl: "",
      taskId: "",
      taskProvider: "",
      videoPreviewVersion,
      progress: null,
      tailFrameReady: false,
      tailFrameUrl: "",
      tailFrameLocalFile: "",
      tailFrameFileUrl: "",
      tailFrameMessage: "",
      submittedAt: new Date().toISOString(),
    });
    try {
      const data = await api("/api/canvas/project-video-generate", {
        method: "POST",
        timeoutMs: VIDEO_SUBMIT_TIMEOUT_MS,
        body: JSON.stringify({
          projectId: projectEpisodeIdFromCanvasStorage(),
          shotName: projectShotName,
          forceRegenerate: true,
        }),
      });
      if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
      await loadProject(canvasState.selectedId, {
        preserveSelection: true,
        videoGeneration: { nodeId, generationToken },
      });
      if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
      const result = data.result?.result || data.result || {};
      const latestNode = canvasState.nodes.find((item) => item.id === nodeId);
      if (projectVideoNodeIsActive(latestNode)) pollProjectVideoNode(nodeId, generationToken);
      toast(result.message || "项目片段已提交，状态已同步");
    } catch (error) {
      markVideoNodeFailed(nodeId, error.message || "项目片段生成失败", { generationToken });
    }
    return;
  }
  if (syncVideoModelForReferences(node)) renderNodes();
  const readiness = await ensurePhotorealReferencesReady([node]);
  if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
  if (readiness.pending) {
    renderNodes();
    scheduleCanvasSave();
    return toast(`还有 ${readiness.pending} 个超写实素材未 active，等素材库处理完成后再生成`);
  }
  if (!validateVideoNode(nodeId)) return;
  clearVideoPoll(nodeId);
  updateVideoNodeStatus(nodeId, {
    status: "running",
    statusMessage: "正在提交 Seedance 任务",
    videoUrl: "",
    taskId: "",
    taskProvider: "",
    videoPreviewVersion,
    progress: null,
    tailFrameReady: false,
    tailFrameUrl: "",
    tailFrameLocalFile: "",
    tailFrameFileUrl: "",
    tailFrameMessage: "",
    submittedAt: new Date().toISOString(),
  });
  try {
    const data = await api("/api/canvas/video-generations", {
      method: "POST",
      timeoutMs: VIDEO_SUBMIT_TIMEOUT_MS,
      body: JSON.stringify(videoNodePayload(node, { forceNoAudio: !!options.forceNoAudio })),
    });
    const result = data.result || {};
    if (!videoOperationIsCurrent(nodeId, { generationToken })) return;
    if (!result.videoUrl && String(result.status || "").toLowerCase() !== "completed" && !result.taskId) {
      markVideoNodeFailed(nodeId, result.message || "视频接口没有返回 taskId，请重试", { generationToken });
      return;
    }
    const done = applyVideoGenerationResult(nodeId, result, { generationToken });
    if (!done && result.taskId) await pollVideoNode(nodeId, result.taskId, result.provider || "", generationToken);
  } catch (error) {
    markVideoNodeFailed(nodeId, error.message || "视频提交失败", { generationToken });
  }
}

async function batchGenerateVideoNodes() {
  const nodes = canvasState.nodes.filter((node) => node.kind === "video" && node.status !== "running" && nodePrompt(node));
  if (!nodes.length) return toast("没有可批量生成的视频模块");
  const readiness = await ensurePhotorealReferencesReady(nodes);
  if (readiness.pending) {
    renderNodes();
    scheduleCanvasSave();
    return toast(`还有 ${readiness.pending} 个超写实素材未 active，等素材库处理完成后再批量生成`);
  }
  let started = 0;
  for (const node of nodes) {
    syncVideoModelForReferences(node);
    if (!validateVideoNode(node.id, { silent: true })) continue;
    started += 1;
    generateVideoNode(node.id).catch((error) => markVideoNodeFailed(node.id, error.message));
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  renderNodes();
  scheduleCanvasSave();
  toast(started ? `已提交 ${started} 个视频生成任务` : "没有通过校验的视频模块；请先验证超写实素材");
}

function syncImageModelControls(element, settings = {}) {
  const hidden = settings.model === "grok-imagine-image";
  element.querySelectorAll('[data-node-field="ratio"], [data-node-field="resolution"]').forEach((field) => {
    field.closest("label")?.toggleAttribute("hidden", hidden);
  });
}

function syncNodeControls(element, node) {
  if (node.kind === "asset") return;
  const prompt = element.querySelector(".node-prompt");
  if (prompt) {
    prompt.value = node.prompt || "";
    prompt.addEventListener("input", () => updateNode(node.id, { prompt: prompt.value }));
  }
  if (node.kind === "image") {
    const settings = { ...IMAGE_NODE_DEFAULTS, ...(node.settings || {}) };
    syncImageModelControls(element, settings);
    if (prompt) bindPromptMentionMenu(prompt, node);
    element.querySelectorAll("[data-node-field]").forEach((field) => {
      const key = field.dataset.nodeField;
      field.value = settings[key] ?? "";
      field.addEventListener("change", () => {
        if (key === "ratio") {
          node.ratioLayoutRatio = "";
          node.ratioManualSize = false;
        }
        node.settings = { ...IMAGE_NODE_DEFAULTS, ...(node.settings || {}), [key]: field.value };
        syncImageModelControls(element, node.settings);
        if (key === "ratio") {
          if (!refreshImageNodeElement(node.id)) renderNodes();
          renderLinks();
        }
        scheduleCanvasSave();
      });
    });
    const generate = element.querySelector("[data-image-action='generate']");
    if (generate) {
      generate.disabled = node.status === "running";
      generate.textContent = node.status === "running" ? "生成中" : "生成图片";
      generate.addEventListener("click", () => generateImageNode(node.id).catch((error) => markImageNodeFailed(node.id, error.message)));
    }
    return;
  }
  if (node.kind !== "video") return;
  const settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) };
  if (prompt) bindPromptMentionMenu(prompt, node);
  syncVideoNodeShell(element, node);
  element.querySelectorAll("[data-node-field]").forEach((field) => {
    const key = field.dataset.nodeField;
    if (field.type === "checkbox") {
      field.checked = settings[key] !== false;
      field.addEventListener("change", () => {
        node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), [key]: field.checked };
        syncVideoNodeShell(element, node);
        scheduleCanvasSave();
      });
      return;
    }
    if (field.type === "range") {
      const label = element.querySelector("[data-duration-label]");
      const updateDurationLabel = () => {
        if (label) label.textContent = `${field.value}s`;
      };
      field.value = settings[key] ?? VIDEO_NODE_DEFAULTS.duration;
      updateDurationLabel();
      field.addEventListener("input", () => {
        node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), [key]: field.value };
        updateDurationLabel();
        syncVideoNodeShell(element, node);
        scheduleCanvasSave();
      });
      return;
    }
    field.value = settings[key] ?? "";
    field.addEventListener("change", () => {
      if (key === "ratio") {
        node.ratioLayoutRatio = "";
        node.ratioManualSize = false;
      }
      node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), [key]: field.value };
      syncVideoNodeShell(element, node);
      if (key === "model") renderNodes();
      else if (key === "ratio") renderLinks();
      scheduleCanvasSave();
    });
  });
  syncVideoResolutionOptions(element, node, { ...settings, ...(node.settings || {}) });
  const durationField = element.querySelector('input[data-node-field="duration"]');
  element.querySelectorAll("[data-duration-step]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!durationField) return;
      const next = Math.max(4, Math.min(15, Number(durationField.value || VIDEO_NODE_DEFAULTS.duration) + Number(button.dataset.durationStep || 0)));
      durationField.value = String(next);
      durationField.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
  const settingsToggle = element.querySelector('[data-video-action="toggle-settings"]');
  if (settingsToggle) {
    settingsToggle.addEventListener("click", () => {
      const strip = element.querySelector(".video-settings-strip");
      const expanded = strip?.classList.toggle("is-expanded") || false;
      settingsToggle.setAttribute("aria-expanded", String(expanded));
    });
  }
  const validate = element.querySelector("[data-video-action='validate']");
  if (validate) validate.addEventListener("click", () => validateVideoNode(node.id));
  const generate = element.querySelector("[data-video-action='generate']");
  if (generate) {
    generate.disabled = node.status === "running";
    generate.textContent = node.status === "running" ? "生成中" : "生成视频";
    generate.addEventListener("click", () => generateVideoNode(node.id).catch((error) => markVideoNodeFailed(node.id, error.message)));
  }
  syncArkVideoControls(element, node);
}

function upstreamSummary(node) {
  if (!node || node.kind !== "video") return "输出到视频节点后，图片资产会作为视频参考图。";
  const sources = canvasState.connections
    .filter((connection) => connection.to === node.id)
    .map((connection) => canvasState.nodes.find((item) => item.id === connection.from))
    .filter(Boolean);
  const upstreamTailFrame = upstreamTailFrameForVideoNode(node);
  if (upstreamTailFrame?.tailFrameUrl) {
    const assetCount = upstreamAssetsForNode(node).length;
    const imageText = assetCount ? `，另有 ${assetCount} 张参考图` : "";
    return `首帧来自上一段尾帧${imageText}。`;
  }
  if (!sources.length) return "等待图片连接。";
  const assetCount = upstreamAssetsForNode(node).length;
  return `已连接 ${sources.length} 张图片，自动引用 ${assetCount} 张参考图。`;
}

function syncAssetNodeElement(element, node) {
  if (!element || node?.kind !== "asset") return false;
  const size = assetNodeSize(node);
  node.width = size.width;
  node.height = size.height;
  element.style.setProperty("--asset-node-width", `${size.width}px`);
  element.style.setProperty("--asset-node-height", `${size.height}px`);
  const asset = primaryAssetForNode(node);
  const certificationBadge = element.querySelector(".ark-virtual-person-badge");
  const certificationStatus = String(asset?.arkPersonAsset?.status || "").toLowerCase();
  const certificationActive = isArkVirtualPersonCertified(asset);
  if (certificationBadge) {
    certificationBadge.hidden = !certificationActive && certificationStatus !== "processing";
    certificationBadge.dataset.certificationState = certificationActive ? "active" : certificationStatus;
    certificationBadge.textContent = certificationActive ? "✓" : "…";
    certificationBadge.title = certificationActive ? "方舟私域虚拟人像已认证" : "方舟私域虚拟人像认证中";
    certificationBadge.setAttribute("aria-label", certificationBadge.title);
  }
  element.classList.toggle("is-ark-virtual-person-certified", certificationActive);
  const visual = element.querySelector(".asset-node-image, .asset-node-file");
  const previewUrl = assetPreviewUrl(asset || {});
  const videoUrl = asset ? assetVideoUrl(asset) : "";
  if (asset && isVideoAsset(asset) && videoUrl) {
    const video = visual?.tagName === "VIDEO" ? visual : document.createElement("video");
    if (video !== visual) {
      if (visual) visual.replaceWith(video);
      else element.insertBefore(video, element.querySelector(".asset-node-caption"));
    }
    video.className = "asset-node-image";
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("draggable", "false");
    if (video.getAttribute("src") !== videoUrl) {
      video.setAttribute("src", videoUrl);
      video.addEventListener("loadeddata", renderLinks, { once: true });
    }
    element.classList.remove("asset-node-without-preview");
  } else if (asset && previewUrl) {
    const img = visual?.tagName === "IMG" ? visual : document.createElement("img");
    if (img !== visual) {
      if (visual) visual.replaceWith(img);
      else element.insertBefore(img, element.querySelector(".asset-node-caption"));
    }
    // 画布节点由 Pointer Events 拖动;原生图片拖拽会抢走事件并生成参考图副本。
    img.setAttribute("draggable", "false");
    img.alt = asset.name || "";
    img.loading = "lazy";
    img.decoding = "async";
    const previousSrc = img.getAttribute("src");
    const nextSrc = setThumbnailImageSource(img, previewUrl, 640);
    if (previousSrc !== nextSrc) {
      img.addEventListener("load", renderLinks, { once: true });
    }
    if (img.complete) queueMicrotask(renderLinks);
    element.classList.remove("asset-node-without-preview");
  } else {
    if (visual?.classList.contains("asset-node-file")) {
      visual.querySelector("strong").textContent = "引用素材";
      visual.querySelector("span").textContent = "无预览图";
    } else {
      visual?.remove();
      const placeholder = document.createElement("div");
      placeholder.className = "asset-node-file";
      placeholder.innerHTML = `<strong>引用素材</strong><span>无预览图</span>`;
      element.insertBefore(placeholder, element.querySelector(".asset-node-caption"));
    }
    element.classList.add("asset-node-without-preview");
  }
  const caption = element.querySelector(".asset-node-caption");
  if (caption) {
    const captionText = asset?.description || asset?.prompt || asset?.name || "图片资产";
    caption.textContent = captionText;
    caption.title = captionText;
  }
  return true;
}

function renderNodes({ preserveExisting = false } = {}) {
  // 后台轮询不能在交互中销毁节点 DOM,否则拖动目标会被替换成新节点而跳位/复制。
  preserveExisting = preserveExisting || canvasInteractionIsActive();
  const wrap = qs("#canvasNodes");
  qs("#canvasHint").classList.toggle("hidden", canvasState.nodes.length > 0);
  // 结构签名：节点(含位置、资产节点的预览)、连接、选中、激活态。结构未变时不做
  // 全量销毁重建——否则轮询里的 loadProject 会反复炸掉所有 <video>/<img>(闪烁、
  // 重新加载、打断播放、清空正在输入的 prompt）。结构未变只做增量内容刷新。
  const structSig = JSON.stringify({
    nodes: canvasState.nodes.map((n) => {
      if (n.kind === "asset") {
        const a = primaryAssetForNode(n);
        const size = assetNodeSize(n);
        return [
          n.id,
          n.kind,
          Math.round(n.x || 0),
          Math.round(n.y || 0),
          size.width,
          size.height,
          assetPreviewUrl(a || {}) || "",
          a?.name || "",
          a?.description || a?.prompt || "",
          a?.arkPersonAsset?.status || "",
          a?.arkPersonAsset?.assetUrl || "",
        ];
      }
      return [n.id, n.kind, Math.round(n.x || 0), Math.round(n.y || 0)];
    }),
    conns: canvasState.connections.map((c) => [c.from, c.to]),
    sel: [...canvasState.selectedNodeIds].sort(),
    active: canvasState.activeVideoNodeId || "",
  });
  if (wrap._structSig === structSig && wrap.childElementCount === canvasState.nodes.length && canvasState.nodes.length > 0) {
    for (const node of canvasState.nodes) {
      if (node.kind === "video") refreshVideoNodeElement(node.id);
      else if (node.kind === "image") refreshImageNodeElement(node.id);
    }
    return;
  }
  wrap._structSig = structSig;
  const existingElements = preserveExisting
    ? new Map(qsa("#canvasNodes > .canvas-node").map((element) => [element.dataset.nodeId, element]))
    : new Map();
  if (!preserveExisting) {
    wrap.innerHTML = "";
    nodeResizeObserver?.disconnect();
  } else {
    const nodeIds = new Set(canvasState.nodes.map((node) => node.id));
    for (const element of existingElements.values()) {
      if (!nodeIds.has(element.dataset.nodeId)) {
        nodeResizeObserver?.unobserve(element);
        element.remove();
      }
    }
  }
  for (const node of canvasState.nodes) {
    const existingElement = existingElements.get(node.id);
    if (existingElement) {
      positionNodeElement(existingElement, node);
      if (node.kind === "asset") syncAssetNodeElement(existingElement, node);
      refreshNodeConnectionClasses(node.id);
      nodeResizeObserver?.observe(existingElement);
      continue;
    }
    if (node.kind === "video") syncVideoModelForReferences(node);
    const template = qs(node.kind === "video" ? "#videoNodeTemplate" : node.kind === "asset" ? "#assetNodeTemplate" : "#imageNodeTemplate");
    const element = template.content.firstElementChild.cloneNode(true);
    element.dataset.nodeId = node.id;
    element.classList.toggle("has-input-link", canvasState.connections.some((connection) => connection.to === node.id));
    element.classList.toggle("has-output-link", canvasState.connections.some((connection) => connection.from === node.id));
    element.classList.toggle("is-composer-open", (node.kind === "video" || node.kind === "image") && canvasState.activeVideoNodeId === node.id);
    element.classList.toggle("is-selected", canvasState.selectedNodeIds.has(node.id));
    if (node.kind === "video") syncVideoNodeDimensions(element, node);
    if (node.kind === "image") syncImageNodeDimensions(element, node);
    positionNodeElement(element, node);
    if (node.kind === "image" && node.width && canvasState.activeVideoNodeId === node.id) element.style.width = `${node.width}px`;
    if (node.kind === "asset") {
      syncAssetNodeElement(element, node);
      element.addEventListener("contextmenu", (event) => showAssetContextMenu(event, node.id));
    } else {
      element.querySelector(".node-flow-summary").textContent = upstreamSummary(node);
      element.querySelector(".node-assets").innerHTML = renderNodeAssets(node);
      element.querySelectorAll("[data-insert-reference]").forEach((button) => {
        button.addEventListener("click", () => insertTextIntoPrompt(node.id, button.dataset.insertReference || ""));
      });
    }
    if (node.kind === "video") {
      element.addEventListener("contextmenu", (event) => showNodeContextMenu(event, node.id));
    }
    const preview = element.querySelector(".video-preview-slot");
    if (preview) {
      preview.innerHTML = renderVideoPreview(node);
      activateVideoPreview(preview);
      bindVideoPreviewActions(preview, node.id);
    }
    const imagePreview = element.querySelector(".image-preview-slot");
    if (imagePreview && node.kind === "image") {
      imagePreview.addEventListener("contextmenu", (event) => showAssetContextMenu(event, node.id));
      imagePreview.style.setProperty("--image-preview-ratio", VIDEO_PREVIEW_RATIOS[node.settings?.ratio] || "16 / 9");
      imagePreview.dataset.previewSig = imagePreviewSig(node);
      imagePreview.innerHTML = renderImagePreview(node);
      bindImageRegenButton(imagePreview, node.id);
    }
    syncNodeControls(element, node);
    syncInlineLivenessLibrary(element, node);
    element.querySelector(".node-close").addEventListener("click", () => removeNode(node.id));
    element.addEventListener("pointerdown", (event) => startNodeDrag(event, node.id));
    element.querySelectorAll(".node-port").forEach((port) => {
      port.addEventListener("pointerdown", (event) => startConnectionDrag(event, node.id, port.dataset.port));
      port.addEventListener("pointerup", (event) => finishConnectionDrag(event, node.id, port.dataset.port));
    });
    element.querySelectorAll("[data-resize-handle]").forEach((resizeHandle) => {
      resizeHandle.addEventListener("pointerdown", (event) => startNodeResize(event, node.id, resizeHandle.dataset.resizeCorner || "bottom-right"));
    });
    const dropzone = element.querySelector(".node-dropzone") ||
      (node.kind === "image" ? element.querySelector(".image-composer") :
        node.kind === "video" ? element.querySelector(".video-composer") : null);
    if (dropzone) {
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("is-over");
      });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-over"));
      dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-over");
        addAssetToNode(node.id, assetIdFromDataTransfer(event.dataTransfer));
      });
    }
    wrap.appendChild(element);
    nodeResizeObserver?.observe(element);
  }
  renderLinks();
}

let linksFrameHandle = 0;
function scheduleRenderLinks() {
  if (linksFrameHandle) return;
  linksFrameHandle = requestAnimationFrame(() => {
    linksFrameHandle = 0;
    renderLinks();
  });
}

// 节点尺寸稳定后重画连线:刷新后首帧节点高度/图片尚未测量,端口 top:50% 会落在
// 顶部,连线端点因此贴在图片最上方;等 ResizeObserver 报告真实尺寸(图片加载完、
// 布局落定、展开收起)再重画,端点即回到端口中点。缓存命中的图片不触发 load 事件,
// 这条路径同样能兜住。
const nodeResizeObserver = typeof ResizeObserver !== "undefined"
  ? new ResizeObserver(() => scheduleRenderLinks())
  : null;

function renderLinks() {
  const svg = qs("#canvasLinks");
  const content = qs("#canvasLinksContent") || svg;
  content.innerHTML = "";
  const paths = [];
  canvasState.connections.forEach((connection, index) => {
    const source = canvasState.nodes.find((node) => node.id === connection.from);
    const target = canvasState.nodes.find((node) => node.id === connection.to);
    if (!source || !target) return;
    paths.push(connectionPath(source, target, index));
  });
  if (canvasState.connectDrag) paths.push(draftConnectionPath());
  if (canvasState.pendingConnection) paths.push(pendingConnectionPath());
  if (canvasState.drag?.snapGuides?.x != null) {
    paths.push(`<line class="snap-guide" x1="${canvasState.drag.snapGuides.x}" x2="${canvasState.drag.snapGuides.x}" y1="-100000" y2="100000" />`);
  }
  if (canvasState.drag?.snapGuides?.y != null) {
    paths.push(`<line class="snap-guide" x1="-100000" x2="100000" y1="${canvasState.drag.snapGuides.y}" y2="${canvasState.drag.snapGuides.y}" />`);
  }
  content.innerHTML = paths.join("");
}

function handleConnectionCutPointerDown(event) {
  const cut = event.target.closest(".connection-cut");
  if (!cut) return;
  event.preventDefault();
  event.stopPropagation();
  removeConnection(Number(cut.dataset.connectionIndex ?? -1));
}

function isSelectionModifier(event) {
  return !!(event.shiftKey || event.metaKey || event.ctrlKey);
}

function isVideoNodeDragSurface(event, node) {
  if (node?.kind !== "video") return true;
  // 生成视频节点的整个窗口都是拖拽面;端口和缩放手柄由各自的交互处理。
  return !event.target.closest(".node-port, [data-resize-handle]");
}

function nodeBounds(node) {
  const element = node?.id ? qs(`[data-node-id="${node.id}"]`) : null;
  const width = element?.offsetWidth || nodeWidth(node);
  const height = element?.offsetHeight || (node?.kind === "video" ? 260 : node?.kind === "asset" ? 190 : 420);
  return {
    left: node.x,
    top: node.y,
    right: node.x + width,
    bottom: node.y + height,
  };
}

function snapNodePosition(node, drag) {
  if (!canvasState.magnetEnabled || !node || !drag) {
    return { x: node?.x || 0, y: node?.y || 0, xGuide: null, yGuide: null };
  }
  const moving = nodeBounds(node);
  const width = moving.right - moving.left;
  const height = moving.bottom - moving.top;
  const selected = new Set(drag.nodeIds || []);
  const candidates = canvasState.nodes
    .filter((other) => other && other.id !== node.id && !selected.has(other.id))
    .map((other) => ({ node: other, bounds: nodeBounds(other) }));
  let xMatch = { value: moving.left, guide: null, distance: Infinity };
  let yMatch = { value: moving.top, guide: null, distance: Infinity };
  for (const { bounds } of candidates) {
    const xOptions = [
      { value: bounds.left, guide: bounds.left },
      { value: bounds.left + (bounds.right - bounds.left - width) / 2, guide: (bounds.left + bounds.right) / 2 },
      { value: bounds.right - width, guide: bounds.right },
    ];
    const yOptions = [
      { value: bounds.top, guide: bounds.top },
      { value: bounds.top + (bounds.bottom - bounds.top - height) / 2, guide: (bounds.top + bounds.bottom) / 2 },
      { value: bounds.bottom - height, guide: bounds.bottom },
    ];
    for (const option of xOptions) {
      const distance = Math.abs(moving.left - option.value);
      if (distance <= CANVAS_SNAP_DISTANCE && distance < xMatch.distance) xMatch = { ...option, distance };
    }
    for (const option of yOptions) {
      const distance = Math.abs(moving.top - option.value);
      if (distance <= CANVAS_SNAP_DISTANCE && distance < yMatch.distance) yMatch = { ...option, distance };
    }
  }
  return {
    x: xMatch.distance < Infinity ? xMatch.value : moving.left,
    y: yMatch.distance < Infinity ? yMatch.value : moving.top,
    xGuide: xMatch.distance < Infinity ? xMatch.guide : null,
    yGuide: yMatch.distance < Infinity ? yMatch.guide : null,
  };
}

function rectsIntersect(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function startNodeDrag(event, nodeId) {
  if (event.button !== 0 || event.target.closest("textarea, input, select, button, a, [contenteditable='true']")) return;
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  if (!isVideoNodeDragSurface(event, node)) return;
  if (isSelectionModifier(event)) {
    toggleNodeSelection(nodeId);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (!canvasState.selectedNodeIds.has(nodeId)) selectSingleNode(nodeId);
  // 不在拖动开始时展开视频/图片节点:展开由 endNodeDrag 的无位移判断处理,
  // 否则拖动一开始节点就展开、尺寸突变,端口位移导致连线端点乱跳。拖动中节点尺寸恒定、
  // 连线随节点位置刚性移动(applyNodeDragFrame 每帧 renderLinks)。
  const point = stagePoint(event.clientX, event.clientY);
  const selectedIds = canvasState.selectedNodeIds.has(nodeId) ? [...canvasState.selectedNodeIds] : [nodeId];
  canvasState.drag = {
    nodeId,
    nodeIds: selectedIds,
    pointerId: event.pointerId,
    start: point,
    current: point,
    origins: selectedIds.map((id) => {
      const item = canvasState.nodes.find((candidate) => candidate.id === id);
      return { id, x: item?.x || 0, y: item?.y || 0 };
    }),
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function applyNodeDragFrame() {
  canvasState.dragFrame = 0;
  const drag = canvasState.drag;
  if (!drag) return;
  const point = drag.current || drag.start;
  const deltaX = point.x - drag.start.x;
  const deltaY = point.y - drag.start.y;
  const primaryOrigin = drag.origins?.find((origin) => origin.id === drag.nodeId);
  const primary = canvasState.nodes.find((item) => item.id === drag.nodeId);
  const rawPrimary = primaryOrigin && primary ? { ...primary, x: primaryOrigin.x + deltaX, y: primaryOrigin.y + deltaY } : null;
  const snapped = rawPrimary ? snapNodePosition(rawPrimary, drag) : { x: 0, y: 0, xGuide: null, yGuide: null };
  drag.snapGuides = { x: snapped.xGuide, y: snapped.yGuide };
  const snapOffsetX = rawPrimary ? snapped.x - rawPrimary.x : 0;
  const snapOffsetY = rawPrimary ? snapped.y - rawPrimary.y : 0;
  for (const origin of drag.origins || []) {
    const node = canvasState.nodes.find((item) => item.id === origin.id);
    if (!node) continue;
    node.x = origin.x + deltaX + snapOffsetX;
    node.y = origin.y + deltaY + snapOffsetY;
    clampNodePosition(node);
    const element = qs(`[data-node-id="${node.id}"]`);
    positionNodeElement(element, node);
  }
  renderLinks();
}

function updateNodeDrag(event) {
  const drag = canvasState.drag;
  if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
  drag.current = stagePoint(event.clientX, event.clientY);
  if (!canvasState.dragFrame) canvasState.dragFrame = requestAnimationFrame(applyNodeDragFrame);
}

function endNodeDrag(event = {}) {
  if (canvasState.drag && canvasState.drag.pointerId != null && event.pointerId != null && event.pointerId !== canvasState.drag.pointerId) return;
  if (canvasState.dragFrame) {
    cancelAnimationFrame(canvasState.dragFrame);
    applyNodeDragFrame();
  }
  const drag = canvasState.drag;
  canvasState.drag = null;
  if (!drag) return;
  renderLinks();
  // 判定点击 vs 拖动:位移很小 = 点击 → 展开视频/图片节点(不在 pointerdown 展开,避免拖动时
  // 节点突然展开导致连线端点乱跳;展开只在"点击松手且没拖动"时发生)。真正拖动过才存布局。
  const moved =
    drag.current && (Math.abs(drag.current.x - drag.start.x) > 4 || Math.abs(drag.current.y - drag.start.y) > 4);
  if (moved) {
    scheduleCanvasSave();
    return;
  }
  const node = canvasState.nodes.find((item) => item.id === drag.nodeId);
  if (node && (node.kind === "video" || node.kind === "image")) setActiveVideoNode(drag.nodeId);
}

// 节点拖拽缩放：视频节点支持四角独立调整宽高，素材/图片保留右下角缩放行为。
function startNodeResize(event, nodeId, corner = "bottom-right") {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const element = qs(`[data-node-id="${nodeId}"]`);
  if (!node || !element) return;
  const size = {
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
  canvasState.resize = {
    nodeId,
    corner,
    startX: event.clientX,
    startY: event.clientY,
    startNodeX: node.x,
    startNodeY: node.y,
    startWidth: size.width,
    startHeight: size.height,
    aspectRatio: size.height / Math.max(1, size.width),
    scale: canvasState.viewport?.scale || 1,
  };
  element.classList.add("is-resizing");
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function proportionalVideoResizeDimensions(resize, dx, dy) {
  const corner = resize.corner || "bottom-right";
  const horizontal = corner.includes("left") ? -1 : 1;
  const vertical = corner.includes("top") ? -1 : 1;
  const widthScale = (resize.startWidth + horizontal * dx) / Math.max(1, resize.startWidth);
  const heightScale = (resize.startHeight + vertical * dy) / Math.max(1, resize.startHeight);
  const requestedScale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
  const minScale = Math.max(VIDEO_NODE_MIN_WIDTH / resize.startWidth, VIDEO_NODE_MIN_HEIGHT / resize.startHeight);
  const maxScale = Math.min(VIDEO_NODE_MAX_WIDTH / resize.startWidth, VIDEO_NODE_MAX_HEIGHT / resize.startHeight);
  const scale = Math.max(minScale, Math.min(maxScale, requestedScale));
  return {
    width: Math.round(resize.startWidth * scale),
    height: Math.round(resize.startHeight * scale),
  };
}

function updateNodeResize(event) {
  const resize = canvasState.resize;
  if (!resize) return;
  const node = canvasState.nodes.find((item) => item.id === resize.nodeId);
  const element = qs(`[data-node-id="${resize.nodeId}"]`);
  if (!node || !element) return;
  const dx = (event.clientX - resize.startX) / (resize.scale || 1);
  const dy = (event.clientY - resize.startY) / (resize.scale || 1);
  const corner = resize.corner || "bottom-right";
  if (node.kind === "video") {
    const { width, height } = proportionalVideoResizeDimensions(resize, dx, dy);
    node.width = width;
    node.height = height;
    node.ratioManualSize = true;
    if (corner.includes("left")) node.x = resize.startNodeX + resize.startWidth - width;
    if (corner.includes("top")) node.y = resize.startNodeY + resize.startHeight - height;
    syncVideoNodeDimensions(element, node);
    positionNodeElement(element, node);
    renderLinks();
    return;
  }
  const isAsset = node.kind === "asset";
  const isImage = node.kind === "image";
  const minWidth = isAsset ? ASSET_NODE_MIN_WIDTH : isImage ? IMAGE_NODE_MIN_WIDTH : 240;
  const maxWidth = isAsset ? ASSET_NODE_MAX_WIDTH : isImage ? IMAGE_NODE_MAX_WIDTH : 720;
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(resize.startWidth + dx)));
  node.width = width;
  element.style.width = `${width}px`;
  if (isAsset || isImage) {
    const minHeight = isAsset ? ASSET_NODE_MIN_HEIGHT : IMAGE_NODE_MIN_HEIGHT;
    const maxHeight = isAsset ? ASSET_NODE_MAX_HEIGHT : IMAGE_NODE_MAX_HEIGHT;
    const height = Math.max(minHeight, Math.min(maxHeight, Math.round(resize.startHeight + dx * (resize.aspectRatio || ASSET_NODE_DEFAULT_HEIGHT / ASSET_NODE_DEFAULT_WIDTH))));
    node.height = height;
    if (isAsset) {
      element.style.setProperty("--asset-node-width", `${width}px`);
      element.style.setProperty("--asset-node-height", `${height}px`);
    } else {
      node.ratioLayoutRatio = node.settings?.ratio || IMAGE_NODE_DEFAULTS.ratio;
      node.ratioManualSize = true;
      element.style.setProperty("--image-node-width", `${width}px`);
      element.style.setProperty("--image-node-height", `${height}px`);
    }
  }
  renderLinks();
}

function endNodeResize() {
  if (!canvasState.resize) return;
  const element = qs(`[data-node-id="${canvasState.resize.nodeId}"]`);
  element?.classList.remove("is-resizing");
  canvasState.resize = null;
  scheduleCanvasSave();
}

function marqueeRectFromPoints(start, current) {
  return {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    right: Math.max(start.x, current.x),
    bottom: Math.max(start.y, current.y),
  };
}

function updateMarqueeElement() {
  const marquee = qs("#selectionMarquee");
  if (!marquee || !canvasState.marquee) return;
  const { startScreen, currentScreen } = canvasState.marquee;
  const rect = marqueeRectFromPoints(startScreen, currentScreen);
  marquee.style.left = `${rect.left}px`;
  marquee.style.top = `${rect.top}px`;
  marquee.style.width = `${Math.max(1, rect.right - rect.left)}px`;
  marquee.style.height = `${Math.max(1, rect.bottom - rect.top)}px`;
  marquee.classList.remove("hidden");
}

function hideSelectionMarquee() {
  const marquee = qs("#selectionMarquee");
  if (marquee) marquee.classList.add("hidden");
}

function updateMarqueeSelection() {
  if (!canvasState.marquee) return;
  const rect = marqueeRectFromPoints(canvasState.marquee.startStage, canvasState.marquee.currentStage);
  const selected = canvasState.nodes.filter((node) => rectsIntersect(rect, nodeBounds(node))).map((node) => node.id);
  const next = canvasState.marquee.additive ? [...new Set([...canvasState.marquee.initialSelection, ...selected])] : selected;
  setSelectedNodes(next);
}

function startSelectionMarquee(event) {
  if (event.button !== 0) return;
  if (event.target.closest(".canvas-node, #contextMenu, #nodeContextMenu, #assetContextMenu, #connectionMenu, #promptMentionMenu, #sharedAssetLibraryPanel, button, input, select, textarea")) return;
  event.preventDefault();
  hideContextMenu();
  hideNodeContextMenu();
  hideAssetContextMenu();
  hideConnectionMenu();
  const startScreen = screenPoint(event.clientX, event.clientY);
  const startStage = stagePoint(event.clientX, event.clientY);
  canvasState.marquee = {
    startScreen,
    currentScreen: startScreen,
    startStage,
    currentStage: startStage,
    additive: isSelectionModifier(event),
    initialSelection: [...canvasState.selectedNodeIds],
  };
  if (!canvasState.marquee.additive) clearNodeSelection();
  updateMarqueeElement();
  qs("#blankCanvas").setPointerCapture?.(event.pointerId);
}

function applySelectionMarqueeFrame() {
  canvasState.marqueeFrame = 0;
  if (!canvasState.marquee) return;
  updateMarqueeElement();
  updateMarqueeSelection();
}

function updateSelectionMarquee(event) {
  if (!canvasState.marquee) return;
  canvasState.marquee.currentScreen = screenPoint(event.clientX, event.clientY);
  canvasState.marquee.currentStage = stagePoint(event.clientX, event.clientY);
  if (!canvasState.marqueeFrame) canvasState.marqueeFrame = requestAnimationFrame(applySelectionMarqueeFrame);
}

function endSelectionMarquee() {
  if (!canvasState.marquee) return;
  if (canvasState.marqueeFrame) {
    cancelAnimationFrame(canvasState.marqueeFrame);
    applySelectionMarqueeFrame();
  } else {
    updateMarqueeSelection();
  }
  canvasState.marquee = null;
  canvasState.ignoreNextBlankClick = true;
  hideSelectionMarquee();
}

function nodeWidth(node) {
  const element = node?.id ? qs(`[data-node-id="${node.id}"]`) : null;
  return element?.offsetWidth || (node?.kind === "video" ? 520 : node?.kind === "asset" ? assetNodeSize(node).width : 360);
}

function syncVideoNodePortPosition(element) {
  if (!element?.classList.contains("video-node")) return;
  const preview = element.querySelector(".video-preview-slot");
  const elementRect = element.getBoundingClientRect();
  const previewRect = preview?.getBoundingClientRect();
  if (!previewRect?.width || !previewRect?.height || !elementRect.width || !elementRect.height) {
    element.style.removeProperty("--video-port-y");
    element.style.removeProperty("--video-port-left");
    element.style.removeProperty("--video-port-right");
    return;
  }
  const scaleX = elementRect.width / Math.max(1, element.offsetWidth);
  const scaleY = elementRect.height / Math.max(1, element.offsetHeight);
  const unscaleX = (value) => value / Math.max(scaleX, 0.0001);
  const unscaleY = (value) => value / Math.max(scaleY, 0.0001);
  element.style.setProperty("--video-port-y", `${unscaleY(previewRect.top - elementRect.top + previewRect.height / 2)}px`);
  element.style.setProperty("--video-port-left", `${unscaleX(previewRect.left - elementRect.left)}px`);
  element.style.setProperty("--video-port-right", `${unscaleX(previewRect.right - elementRect.left)}px`);
}

function nodePortPoint(node, port) {
  if (!node) return { x: 0, y: 0 };
  const width = nodeWidth(node);
  const element = node?.id ? qs(`[data-node-id="${node.id}"]`) : null;
  if (node.kind === "asset") {
    const visual = element?.querySelector(".asset-node-image, .asset-node-file");
    if (visual) {
      const rect = visual.getBoundingClientRect();
      return stagePoint(rect.right, rect.top + rect.height / 2);
    }
    const size = assetNodeSize(node);
    return { x: node.x + size.width, y: node.y + size.height / 2 };
  }
  if (node.kind === "video") {
    syncVideoNodePortPosition(element);
    const preview = element?.querySelector(".video-preview-slot");
    const rect = preview?.getBoundingClientRect();
    if (rect?.width && rect?.height) {
      return stagePoint(port === "input" ? rect.left : rect.right, rect.top + rect.height / 2);
    }
  }
  // 图片/视频节点：优先测量实际端口按钮位置，这样收起/展开改变高度时连线与剪刀仍精确对齐。
  const portEl = element?.querySelector(port === "input" ? ".node-port.input-port" : ".node-port.output-port");
  if (portEl) {
    const rect = portEl.getBoundingClientRect();
    if (rect.width || rect.height) return stagePoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  const height = element?.offsetHeight || (node.kind === "asset" ? 190 : node.kind === "video" ? 510 : 430);
  const y = node.y + height / 2;
  if (port === "input") return { x: node.x - 1, y };
  return { x: node.x + width + 1, y };
}

function bezierGeometry(from, to) {
  const distance = Math.max(80, Math.abs(to.x - from.x) * 0.48);
  const d = `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
  const t = 0.5;
  const x =
    Math.pow(1 - t, 3) * from.x +
    3 * Math.pow(1 - t, 2) * t * (from.x + distance) +
    3 * (1 - t) * Math.pow(t, 2) * (to.x - distance) +
    Math.pow(t, 3) * to.x;
  const y =
    Math.pow(1 - t, 3) * from.y +
    3 * Math.pow(1 - t, 2) * t * from.y +
    3 * (1 - t) * Math.pow(t, 2) * to.y +
    Math.pow(t, 3) * to.y;
  return { d, mid: { x, y } };
}

function connectionToneFor(source) {
  if (source?.kind === "video") return "video-link";
  if (source?.kind === "image" || source?.kind === "asset") return "image-link";
  return "";
}

function typedBezierPath(from, to, className, tone) {
  const { d } = bezierGeometry(from, to);
  const classes = [className, tone].filter(Boolean).join(" ");
  return `<path class="${classes}" d="${d}" />`;
}

function connectionPath(source, target, index) {
  const { d, mid } = bezierGeometry(nodePortPoint(source, "output"), nodePortPoint(target, "input"));
  const tone = connectionToneFor(source);
  return `
    <g class="connection-link" data-connection-index="${index}">
      <path class="connection-hitbox" d="${d}" />
      <path class="active-link ${tone}" d="${d}" />
      <g class="connection-cut" data-connection-cut="${index}" data-connection-index="${index}" transform="translate(${mid.x} ${mid.y})">
        <circle r="13"></circle>
        <text x="0" y="0" text-anchor="middle" dominant-baseline="central">✂</text>
      </g>
    </g>
  `;
}

function draftConnectionPath() {
  const source = canvasState.nodes.find((node) => node.id === canvasState.connectDrag.from);
  if (!source) return "";
  return typedBezierPath(nodePortPoint(source, "output"), canvasState.connectDrag.to, "draft-link", connectionToneFor(source));
}

function pendingConnectionPath() {
  const source = canvasState.nodes.find((node) => node.id === canvasState.pendingConnection.from);
  if (!source) return "";
  return typedBezierPath(nodePortPoint(source, "output"), canvasState.pendingConnection.to, "pending-link", connectionToneFor(source));
}

function startConnectionDrag(event, nodeId, port) {
  if (event.button !== 0 || port !== "output") return;
  const source = canvasState.nodes.find((node) => node.id === nodeId);
  if (!source || !["image", "asset", "video"].includes(source.kind)) return toast("只有图片、素材或视频模块可以输出连接");
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
  hideConnectionMenu();
  canvasState.pendingConnection = null;
  const start = stagePoint(event.clientX, event.clientY);
  canvasState.connectDrag = {
    from: nodeId,
    start,
    to: start,
  };
  renderLinks();
}

function applyConnectionDragFrame() {
  canvasState.connectionFrame = 0;
  if (!canvasState.connectDrag) return;
  renderLinks();
}

function updateConnectionDrag(event) {
  if (!canvasState.connectDrag) return;
  canvasState.connectDrag.to = stagePoint(event.clientX, event.clientY);
  if (!canvasState.connectionFrame) canvasState.connectionFrame = requestAnimationFrame(applyConnectionDragFrame);
}

function applyAssetConnectorHotspotsFrame() {
  canvasState.hotspotFrame = 0;
  const point = canvasState.hotspotPoint;
  if (!point || canvasState.connectDrag) return;
  qsa(".asset-node").forEach((node) => {
    const visual = node.querySelector(".asset-node-image, .asset-node-file") || node;
    const rect = visual.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const hot =
      point.x >= rect.right - 20 &&
      point.x <= rect.right + 34 &&
      point.y >= centerY - 34 &&
      point.y <= centerY + 34;
    node.classList.toggle("is-connector-hot", hot);
  });
}

function updateAssetConnectorHotspots(event) {
  if (canvasState.connectDrag) return;
  canvasState.hotspotPoint = { x: event.clientX, y: event.clientY };
  if (!canvasState.hotspotFrame) canvasState.hotspotFrame = requestAnimationFrame(applyAssetConnectorHotspotsFrame);
}

function clearAssetConnectorHotspots(event) {
  if (event.relatedTarget && qs("#blankCanvas").contains(event.relatedTarget)) return;
  if (canvasState.hotspotFrame) {
    cancelAnimationFrame(canvasState.hotspotFrame);
    canvasState.hotspotFrame = 0;
  }
  canvasState.hotspotPoint = null;
  qsa(".asset-node.is-connector-hot").forEach((node) => node.classList.remove("is-connector-hot"));
}

function connectNodes(source, target) {
  const valid = ["image", "asset", "video"].includes(source?.kind)
    && ["video", "image"].includes(target?.kind)
    && source.id !== target.id
    && !(source.kind === "video" && target.kind === "image");
  if (!valid) return false;
  const exists = canvasState.connections.some((connection) => connection.from === source.id && connection.to === target.id);
  if (!exists) canvasState.connections.push({ from: source.id, to: target.id });
  hideConnectionMenu();
  refreshConnectedNodeElements(source.id, target.id);
  renderLinks();
  scheduleCanvasSave();
  toast(target.kind === "image" ? "已连接：图片将作为出图参考图" : source.kind === "video" ? "已连接：上一段尾帧将作为下一段起始帧" : "已连接：图片将作为参考图传给视频节点");
  return true;
}

function videoNodeAtEvent(event) {
  const element = event?.target?.closest?.(".canvas-node.video-node") || document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".canvas-node.video-node");
  if (!element?.dataset?.nodeId) return null;
  return canvasState.nodes.find((node) => node.id === element.dataset.nodeId && node.kind === "video") || null;
}

function finishConnectionDrag(event, nodeId, port) {
  if (!canvasState.connectDrag) return;
  event.preventDefault();
  event.stopPropagation();
  canvasState.connectDrag.to = stagePoint(event.clientX, event.clientY);
  if (canvasState.connectionFrame) {
    cancelAnimationFrame(canvasState.connectionFrame);
    canvasState.connectionFrame = 0;
  }
  const drag = canvasState.connectDrag;
  const source = canvasState.nodes.find((node) => node.id === canvasState.connectDrag.from);
  const target = canvasState.nodes.find((node) => node.id === nodeId);
  canvasState.connectDrag = null;
  const valid = port === "input" && connectNodes(source, target);
  if (valid) return;
  if (shouldShowConnectionMenu(drag, event)) return showConnectionMenu(drag, event);
  renderLinks();
  return toast("请从图片或视频输出口连接到视频节点输入口");
}

function connectionDragDistance(drag) {
  if (!drag?.start || !drag?.to) return 0;
  return Math.hypot(drag.to.x - drag.start.x, drag.to.y - drag.start.y);
}

function shouldShowConnectionMenu(drag, event) {
  if (!drag || connectionDragDistance(drag) < 32) return false;
  if (event?.target?.closest?.(".canvas-node.video-node .input-port")) return false;
  if (videoNodeAtEvent(event)) return false;
  const source = canvasState.nodes.find((node) => node.id === drag.from);
  return ["image", "asset"].includes(source?.kind);
}

function placeCanvasMenu(menu, clientX, clientY) {
  const canvasRect = qs("#blankCanvas").getBoundingClientRect();
  const point = screenPoint(clientX, clientY);
  // 画布锚定弹窗随 zoom 自适应缩放,始终与节点大小成比例(0.7–1.6 夹逼,防过大/过小)。
  const scale = Math.max(0.7, Math.min(1.6, Number(canvasState.viewport?.scale) || 1));
  menu.style.transformOrigin = "0 0";
  menu.style.transform = scale === 1 ? "" : `scale(${scale})`;
  // offsetWidth/Height 是未缩放的布局尺寸,乘以 scale 得到实际视觉尺寸再做边界收敛。
  const width = (menu.offsetWidth || 340) * scale;
  const height = (menu.offsetHeight || 120) * scale;
  const left = Math.min(Math.max(12, point.x + 10), Math.max(12, canvasRect.width - width - 12));
  const top = Math.min(Math.max(12, point.y - 18), Math.max(12, canvasRect.height - height - 12));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function showConnectionMenu(drag, event) {
  const menu = qs("#connectionMenu");
  const point = event ? stagePoint(event.clientX, event.clientY) : drag.to;
  canvasState.connectionMenu = { from: drag.from, point };
  canvasState.pendingConnection = { from: drag.from, to: point };
  canvasState.ignoreNextConnectionMenuClick = true;
  menu.classList.remove("hidden");
  if (event) placeCanvasMenu(menu, event.clientX, event.clientY);
  renderLinks();
}

function hideConnectionMenu() {
  canvasState.connectionMenu = null;
  canvasState.pendingConnection = null;
  canvasState.ignoreNextConnectionMenuClick = false;
  qs("#connectionMenu")?.classList.add("hidden");
  renderLinks();
}

function createNodeFromConnectionMenu(kind, successMessage) {
  const pending = canvasState.connectionMenu;
  if (!pending) return;
  const source = canvasState.nodes.find((node) => node.id === pending.from);
  if (!source) return hideConnectionMenu();
  const targetNode = createNode(kind, pending.point, {
    render: false,
    silent: true,
    settings: kind === "video" ? { ratio: VIDEO_NODE_DEFAULTS.ratio } : {},
  });
  if (!canvasState.connections.some((connection) => connection.from === source.id && connection.to === targetNode.id)) {
    canvasState.connections.push({ from: source.id, to: targetNode.id });
  }
  hideConnectionMenu();
  renderNodes();
  scheduleCanvasSave();
  toast(successMessage);
}

function createVideoFromConnectionMenu() {
  createNodeFromConnectionMenu("video", "已创建视频模块，并连接当前图片");
}

function createImageFromConnectionMenu() {
  createNodeFromConnectionMenu("image", "已创建图片生成模块，并连接当前图片");
}

function cancelConnectionDrag(event) {
  if (!canvasState.connectDrag) return;
  canvasState.connectDrag.to = stagePoint(event.clientX, event.clientY);
  if (canvasState.connectionFrame) {
    cancelAnimationFrame(canvasState.connectionFrame);
    canvasState.connectionFrame = 0;
  }
  const drag = canvasState.connectDrag;
  const source = canvasState.nodes.find((node) => node.id === drag.from);
  const target = videoNodeAtEvent(event);
  canvasState.connectDrag = null;
  if (connectNodes(source, target)) return;
  if (shouldShowConnectionMenu(drag, event)) return showConnectionMenu(drag, event);
  renderLinks();
}

function showContextMenu(event) {
  if (event.target.closest(".canvas-node, .image-preview-slot, #sharedAssetLibraryPanel, #contextMenu, #nodeContextMenu, #assetContextMenu")) return;
  event.preventDefault();
  hideNodeContextMenu();
  hideAssetContextMenu();
  hideConnectionMenu();
  const menu = qs("#contextMenu");
  const stage = stagePoint(event.clientX, event.clientY);
  const screen = screenPoint(event.clientX, event.clientY);
  canvasState.menuPoint = stage;
  menu.style.left = `${screen.x}px`;
  menu.style.top = `${screen.y}px`;
  menu.classList.remove("hidden");
}

function showNodeContextMenu(event, nodeId) {
  if (event.target.closest("textarea, input, select, button, [contenteditable='true']")) return;
  const node = canvasState.nodes.find((item) => item.id === nodeId && item.kind === "video");
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
  hideAssetContextMenu();
  hideConnectionMenu();
  canvasState.nodeMenu = { nodeId };
  const menu = qs("#nodeContextMenu");
  menu.classList.remove("hidden");
  placeCanvasMenu(menu, event.clientX, event.clientY);
}

function hideNodeContextMenu() {
  canvasState.nodeMenu = null;
  qs("#nodeContextMenu")?.classList.add("hidden");
}

function hideContextMenu() {
  qs("#contextMenu").classList.add("hidden");
}

function showAssetContextMenu(event, nodeId) {
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
  hideNodeContextMenu();
  hideConnectionMenu();
  const node = canvasState.nodes.find((item) => item.id === nodeId && (item.kind === "asset" || item.kind === "image"));
  const asset = primaryAssetForNode(node);
  if (!node || !asset) return;
  canvasState.assetMenu = { nodeId, assetId: asset.id };
  const menu = qs("#assetContextMenu");
  const certifyButton = menu.querySelector("[data-asset-action='certify-ark-virtual-person']");
  const certificationStatus = String(asset.arkPersonAsset?.status || "").toLowerCase();
  const certificationActive = isArkVirtualPersonCertified(asset);
  const certificationState = certificationActive
    ? "active"
    : certificationStatus === "processing"
      ? "processing"
      : isVideoAsset(asset)
        ? "unsupported"
        : isArkPersonCertificationEligible(asset)
          ? "idle"
          : "unsupported";
  if (certifyButton) {
    const label = certifyButton.querySelector("strong");
    if (label) {
      label.textContent = certificationActive
        ? "已认证为私域虚拟人像"
        : certificationStatus === "processing"
          ? "继续查询认证状态"
          : "认证为私域虚拟人像";
    }
    // 只有视频素材真正不可认证；图片即使资格不足也保持可点击，点击后给出明确原因，
    // 避免按钮看起来存在但完全没有反馈。
    const videoAsset = isVideoAsset(asset);
    certifyButton.disabled = videoAsset;
    certifyButton.setAttribute("aria-disabled", videoAsset ? "true" : "false");
    certifyButton.dataset.certificationState = certificationState;
    certifyButton.setAttribute("aria-busy", certificationStatus === "processing" ? "true" : "false");
  }
  menu.classList.remove("hidden");
  placeCanvasMenu(menu, event.clientX, event.clientY);
}

function hideAssetContextMenu() {
  canvasState.assetMenu = null;
  qs("#assetContextMenu")?.classList.add("hidden");
}

function assetFromAssetMenu() {
  const assetId = canvasState.assetMenu?.assetId || "";
  return canvasState.assets.find((asset) => asset.id === assetId) || null;
}

function markAssetAsAiPhotoreal() {
  const asset = assetFromAssetMenu();
  hideAssetContextMenu();
  if (!asset) return;
  Object.assign(asset, {
    assetStylePreset: "photoreal",
    assetStyleLabel: "AI 写实",
    generationMode: "ai-generated",
    aiGenerated: true,
    verificationType: "ai-generated",
    validationStatus: "ai-generated",
    validationError: "",
  });
  renderNodes();
  scheduleCanvasSave();
  toast("已标记为 AI 生成写实图，可直接作为所有视频模型的参考图");
}

function applyArkVirtualPersonResult(asset, result = {}) {
  if (!asset) return;
  const status = String(result.status || "processing").toLowerCase();
  const assetId = String(result.assetId || asset.arkPersonAsset?.assetId || "").trim();
  const active = status === "active" && !!assetId;
  asset.arkPersonAsset = {
    enabled: active,
    assetId,
    assetUrl: active ? String(result.assetUrl || `asset://${assetId}`) : "",
    groupId: String(result.groupId || asset.arkPersonAsset?.groupId || ""),
    status,
    boundAt: active ? new Date().toISOString() : "",
    error: String(result.error || ""),
  };
  if (result.publicUrl) asset.publicUrl = result.publicUrl;
  renderNodes();
  scheduleCanvasSave();
}

function resumeArkVirtualPersonPolls() {
  for (const asset of canvasState.assets) {
    const status = String(asset?.arkPersonAsset?.status || "").toLowerCase();
    if (status === "processing" && asset?.arkPersonAsset?.assetId) pollArkVirtualPersonAsset(asset);
  }
}

function pollArkVirtualPersonAsset(asset, attempt = 0) {
  const arkAssetId = String(asset?.arkPersonAsset?.assetId || "").trim();
  if (!asset || !arkAssetId) return;
  const previousTimer = canvasState.arkPersonPollTimers.get(asset.id);
  if (previousTimer) clearTimeout(previousTimer);
  const timer = setTimeout(async () => {
    canvasState.arkPersonPollTimers.delete(asset.id);
    try {
      const data = await api(`/api/canvas/ark-virtual-person?assetId=${encodeURIComponent(arkAssetId)}`);
      const result = data.result || {};
      applyArkVirtualPersonResult(asset, result);
      if (result.status === "active") {
        toast("私域虚拟人像认证完成，已可用于 Seedance 2.0 / Fast / Mini");
        return;
      }
      if (result.status === "failed") {
        toast(result.error || "私域虚拟人像认证失败");
        return;
      }
      if (attempt < 59) pollArkVirtualPersonAsset(asset, attempt + 1);
      else toast("方舟仍在处理该虚拟人像，可稍后右键继续查询");
    } catch (error) {
      asset.arkPersonAsset = { ...(asset.arkPersonAsset || {}), enabled: false, status: "failed", assetUrl: "", error: error.message };
      renderNodes();
      scheduleCanvasSave();
      toast(error.message);
    }
  }, attempt === 0 ? 1600 : 3000);
  canvasState.arkPersonPollTimers.set(asset.id, timer);
  return timer;
}

async function certifyArkVirtualPersonAsset(asset, options = {}) {
  const manualCertification = options.manualCertification === true;
  if (!asset || isVideoAsset(asset)) return;
  if (!manualCertification && !isArkPersonCertificationEligible(asset)) {
    return toast("当前素材未识别为 AI 生成人物图片，认证未提交；请先使用人物素材或标记为 AI 写实图");
  }
  if (manualCertification && !isArkPersonCertificationEligible(asset)) {
    Object.assign(asset, {
      assetStylePreset: "photoreal",
      assetStyleLabel: "AI 写实",
      generationMode: "ai-generated",
      aiGenerated: true,
      verificationType: "ai-generated",
      validationStatus: "ai-generated",
      validationError: "",
    });
  }
  if (isArkVirtualPersonCertified(asset)) return;
  if (asset.arkPersonAsset?.assetId && asset.arkPersonAsset?.status === "processing") {
    toast("正在继续查询方舟认证状态");
    pollArkVirtualPersonAsset(asset);
    return;
  }
  asset.arkPersonAsset = { enabled: false, assetId: "", assetUrl: "", status: "processing", boundAt: "", error: "" };
  renderNodes();
  scheduleCanvasSave();
  try {
    const data = await api("/api/canvas/ark-virtual-person", {
      method: "POST",
      body: JSON.stringify({
        asset: {
          id: asset.id,
          name: asset.name,
          url: asset.url,
          previewUrl: asset.previewUrl,
          publicUrl: asset.publicUrl,
          localUrl: asset.localUrl,
          mediaType: asset.mediaType,
          type: asset.type,
          manifestType: asset.manifestType,
          assetType: asset.assetType,
          assetStylePreset: asset.assetStylePreset,
          assetStyleLabel: asset.assetStyleLabel,
          generationMode: asset.generationMode,
          source: asset.source,
          aiGenerated: asset.aiGenerated === true,
          verificationType: asset.verificationType,
          manualCertification,
        },
      }),
    });
    const result = data.result || {};
    applyArkVirtualPersonResult(asset, result);
    if (result.status === "active") {
      toast("私域虚拟人像认证完成，已可用于 Seedance 2.0 / Fast / Mini");
    } else {
      toast(options.automatic ? "素材已自动提交方舟私域虚拟人像认证" : "已提交方舟私域虚拟人像认证");
      pollArkVirtualPersonAsset(asset);
    }
  } catch (error) {
    asset.arkPersonAsset = { enabled: false, assetId: "", assetUrl: "", status: "failed", boundAt: "", error: error.message };
    renderNodes();
    scheduleCanvasSave();
    toast(error.message);
  }
}

function autoCertifyCanvasGeneratedAsset(asset) {
  if (!isAutoArkPersonAsset(asset)) return;
  certifyArkVirtualPersonAsset(asset, { automatic: true });
}

async function certifyArkVirtualPersonFromMenu() {
  const asset = assetFromAssetMenu();
  if (!asset) {
    hideAssetContextMenu();
    toast("未找到当前图片素材，请重新右键点击图片");
    return;
  }
  hideAssetContextMenu();
  return certifyArkVirtualPersonAsset(asset, { manualCertification: true });
}

function saveAssetFromContextMenu() {
  const asset = assetFromAssetMenu();
  hideAssetContextMenu();
  if (!asset) return;
  addAssets([asset]);
  toast("已保存到画布资产");
}

function handleCanvasWheel(event) {
  if (event.target.closest("select, input, textarea, button, #contextMenu, #sharedAssetLibraryPanel")) return;
  event.preventDefault();
  if ((event.ctrlKey || event.metaKey) && Date.now() < canvasState.gestureWheelBlockUntil) return;
  if (!event.ctrlKey && !event.metaKey) {
    panCanvasBy(event.deltaX, event.deltaY);
    return;
  }
  const normalizedDelta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  const factor = Math.exp(-normalizedDelta * CANVAS_ZOOM_SPEED);
  zoomCanvasAt(event.clientX, event.clientY, canvasState.viewport.scale * factor);
}

function canvasGesturePoint(event) {
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = qs("#blankCanvas").getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function handleCanvasGestureStart(event) {
  if (event.target.closest("select, input, textarea, button, #contextMenu, #sharedAssetLibraryPanel")) return;
  event.preventDefault();
  canvasState.gestureScaleStart = canvasState.viewport.scale;
  canvasState.gestureLastScale = 1;
}

function handleCanvasGestureChange(event) {
  if (event.target.closest("select, input, textarea, button, #contextMenu, #sharedAssetLibraryPanel")) return;
  event.preventDefault();
  const point = canvasGesturePoint(event);
  const rawScale = Math.max(0.05, Number(event.scale || 1));
  canvasState.gestureLastScale = rawScale;
  zoomCanvasAt(point.x, point.y, canvasState.gestureScaleStart * rawScale);
  canvasState.gestureWheelBlockUntil = Date.now() + 320;
}

function handleCanvasGestureEnd(event) {
  event?.preventDefault?.();
  canvasState.gestureScaleStart = canvasState.viewport.scale;
  canvasState.gestureLastScale = 1;
  canvasState.gestureWheelBlockUntil = Date.now() + 120;
}

async function createNodesForFiles(files, point) {
  // 乐观显示:先用本地 blob 预览把素材+节点秒画出来,上传在后台并行跑,完成后把地址换成公网的。
  const valid = Array.from(files).filter((file) => CANVAS_UPLOAD_ACCEPT_RE.test(file.name));
  const skipped = Array.from(files).length - valid.length;
  if (!valid.length) {
    return toast(skipped ? "不支持的文件类型:仅 PNG / JPG / WEBP / MP4 / MOV / WEBM" : "请选择要上传的素材");
  }
  const stamp = Date.now();
  const jobs = valid.map((file, index) => {
    const isVideo = CANVAS_VIDEO_FILE_RE.test(file.name);
    const id = `${isVideo ? "localvid" : "local"}_${stamp}_${index}_${file.name}`;
    const blobUrl = URL.createObjectURL(file);
    const placeholder = isVideo
      ? { id, name: file.name, type: "Uploaded", mediaType: "video", url: blobUrl, videoUrl: blobUrl, previewUrl: "", source: "local", uploading: true }
      : { id, name: file.name, type: "Uploaded", url: blobUrl, previewUrl: blobUrl, source: "local", uploading: true };
    return { file, index, id, isVideo, blobUrl, placeholder };
  });
  // 一次性把占位素材+节点画出来(0 延迟)
  addAssets(jobs.map((job) => job.placeholder));
  jobs.forEach((job, i) => addAssetNodeAt(job.id, { x: point.x + i * 34, y: point.y + i * 34 }, { silent: true }));
  toast(`已添加 ${jobs.length} 个素材,上传中…`);
  // 后台并行上传,完成一个换一个的地址
  await Promise.all(jobs.map(async (job) => {
    try {
      const asset = job.isVideo
        ? await uploadLocalVideoAsset(job.file, job.index, job.id)
        : await uploadLocalImageAsset(job.file, job.index, job.id);
      if (asset) {
        addAssets([asset]); // 同 id 原地合并,换成公网地址、清 uploading 标记
        renderNodes({ preserveExisting: true }); // 原地更新节点里的素材地址,不重建其他节点
        URL.revokeObjectURL(job.blobUrl);
      } else {
        markAssetUploadFailed(job.id, "上传返回为空");
      }
    } catch (error) {
      markAssetUploadFailed(job.id, error.message);
      toast(`「${job.file.name}」上传失败:${error.message}`);
    }
  }));
}

function markAssetUploadFailed(id, message = "") {
  const asset = canvasState.assets.find((item) => item.id === id);
  if (!asset) return;
  asset.uploading = false;
  asset.uploadFailed = true;
  asset.uploadMessage = message;
  renderNodes({ preserveExisting: true });
}

function handleCanvasDragOver(event) {
  if (event.target.closest(".canvas-node, #contextMenu, #sharedAssetLibraryPanel")) return;
  if (!canvasDragHasPayload(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setCanvasAssetDragOver(true);
}

function handleCanvasDragLeave(event) {
  if (event.relatedTarget && qs("#blankCanvas").contains(event.relatedTarget)) return;
  setCanvasAssetDragOver(false);
}

function handleCanvasDrop(event) {
  if (event.target.closest(".canvas-node, #contextMenu, #sharedAssetLibraryPanel")) return;
  const sharedAssetId = sharedAssetIdFromDataTransfer(event.dataTransfer);
  const assetId = assetIdFromDataTransfer(event.dataTransfer);
  const point = stagePoint(event.clientX, event.clientY);
  const allFiles = Array.from(event.dataTransfer.files || []);
  const files = allFiles.filter((file) => CANVAS_UPLOAD_ACCEPT_RE.test(file.name));
  if (!sharedAssetId && !assetId && !files.length) {
    // 之前这里静默 return,拖了没反应。现在:确实拖进来了文件但格式不支持时给出明确提示。
    if (allFiles.length) toast("不支持的文件类型,画布仅支持 PNG / JPG / WEBP 图片或 MP4 / MOV / WEBM 视频");
    return;
  }
  event.preventDefault();
  setCanvasAssetDragOver(false);
  if (sharedAssetId) {
    const asset = canvasState.sharedAssetLibrary.assets.find((item) => item.id === sharedAssetId);
    if (asset) {
      addSharedLibraryAsset(asset, { point });
      return;
    }
  }
  if (assetId && canvasState.assets.some((asset) => asset.id === assetId)) {
    addAssetNodeAt(assetId, point, { autoCertify: true });
    return;
  }
  if (files.length) createNodesForFiles(files, point).catch((error) => toast(error.message));
}

function importProjectAssets() {
  if (!canvasState.selectedId || !canvasState.project) return toast("当前是单独画布，不会导入项目资产");
  const assets = projectAssets();
  if (!assets.length) return toast("当前项目还没有可导入资产");
  addAssets(assets);
  const added = addAssetNodesToCanvas(assets);
  scheduleCanvasSave();
  toast(`已导入 ${assets.length} 个项目资产，新增 ${added} 个素材节点`);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function uploadLocalAssets(files, options = {}) {
  const assets = [];
  let skipped = 0;
  for (const file of files) {
    const isVideo = CANVAS_VIDEO_FILE_RE.test(file.name);
    if (!isVideo && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      skipped += 1;
      continue;
    }
    try {
      const asset = isVideo
        ? await uploadLocalVideoAsset(file, assets.length)
        : await uploadLocalImageAsset(file, assets.length);
      if (asset) assets.push(asset);
    } catch (error) {
      toast(`「${file.name}」上传失败：${error.message}`);
    }
  }
  if (!assets.length) {
    return toast(skipped ? "不支持的文件类型:仅 PNG / JPG / WEBP / MP4 / MOV / WEBM" : "请选择要上传的素材");
  }
  addAssets(assets);
  const added = addAssetNodesToCanvas(assets);
  if (!options.silent) toast(`已上传 ${assets.length} 个资产到画布，新增 ${added} 个素材节点`);
}

async function uploadLocalImageAsset(file, index, presetId = "") {
  const dataUrl = await fileToDataUrl(file);
  const data = await api("/api/canvas/public-assets", {
    method: "POST",
    body: JSON.stringify({ name: file.name, dataUrl }),
  });
  const publicAsset = data.result || {};
  const previewUrl = publicAsset.localUrl || publicAsset.url || "";
  const referenceUrl = publicAsset.url || publicAsset.localUrl || previewUrl;
  if (!previewUrl && !referenceUrl) return null;
  return {
    id: presetId || `local_${Date.now()}_${index}_${file.name}`,
    name: file.name,
    type: "Uploaded",
    url: referenceUrl,
    previewUrl,
    publicUrl: publicAsset.url || "",
    localUrl: publicAsset.localUrl || "",
    source: "local",
    uploading: false,
  };
}

// 视频上传:服务端落盘视频 + ffmpeg 抽首帧。抽出的帧作为参考图(url/previewUrl),
// 这样视频素材天然复用现有图片参考渲染与图生视频链路;videoUrl 单独存,供播放层用。
async function uploadLocalVideoAsset(file, index, presetId = "") {
  if (file.size > 60 * 1024 * 1024) throw new Error("视频超过 60MB,请压缩后再拖入");
  const dataUrl = await fileToDataUrl(file);
  const data = await api("/api/canvas/video-assets", {
    method: "POST",
    body: JSON.stringify({ name: file.name, dataUrl }),
  });
  const result = data.result || {};
  const publicUrl = result.publicUrl || "";
  const playUrl = result.videoUrl || publicUrl;
  if (!playUrl && !publicUrl) return null;
  return {
    id: presetId || `localvid_${Date.now()}_${index}_${file.name}`,
    name: file.name,
    type: "Uploaded",
    mediaType: "video",
    // 参考图解析走 publicUrl/url;这里都填公网地址,视频才能被远端模型抓取当参考。
    url: publicUrl || playUrl,
    previewUrl: "",
    videoUrl: result.videoUrl || publicUrl,
    publicUrl,
    localUrl: result.videoLocalUrl || "",
    source: "local",
    publicReady: !!result.publicReady,
    uploadMessage: result.message || "",
    uploading: false,
  };
}

function restoreAndRenderCanvasState(saved = null, { preserveSelection = false, previousSelection = [] } = {}) {
  if (!restoreCanvasState(saved?.state)) {
    canvasState.nodes = [];
    canvasState.connections = [];
    canvasState.assets = [];
    canvasState.layoutChanged = false;
    canvasState.viewport = { x: 0, y: 0, scale: 1 };
    canvasState.livenessLibrary = defaultLivenessLibraryState();
  }
  syncLivenessLibraryPanel();
  applyCanvasViewport();
  renderNodes();
  if (preserveSelection) setSelectedNodes(previousSelection);
  const repairedLayout = canvasState.layoutChanged;
  canvasState.layoutChanged = false;
  return repairedLayout;
}

async function loadProject(id = canvasState.selectedId, options = {}) {
  // 拖拽/缩放进行中时跳过后台轮询刷新:否则(尤其生成中每几秒轮询一次)loadProject 会用服务端
  // 数据替换节点并触发 renderNodes 全量重建,把正在拖的节点销毁重建 → 内部布局乱跳/尺寸重排。
  // 拖拽/缩放结束后 pointerup 会再触发刷新,不会漏更新。用户主动切项目不会与拖拽同时发生。
  if (canvasInteractionIsActive() && options.silent) return;
  const videoGeneration = options.videoGeneration || null;
  const videoLoadIsCurrent = () =>
    !videoGeneration || videoOperationIsCurrent(videoGeneration.nodeId, { generationToken: videoGeneration.generationToken });
  if (!videoLoadIsCurrent()) return false;
  canvasState.hydrating = true;
  const previousSelection = options.preserveSelection ? [...canvasState.selectedNodeIds] : [];
  if (!options.preserveSelection) clearNodeSelection();
  if (!id) {
    canvasState.project = null;
    canvasState.selectedId = "";
    canvasState.canvasId = options.useUrlCanvas ? initialCanvasId || "" : "";
    syncCanvasUrl("", canvasState.canvasId);
    const saved = await api(`/api/canvas/state?projectId=${encodeURIComponent(canvasStorageProjectId())}`);
    if (!videoLoadIsCurrent()) {
      canvasState.hydrating = false;
      return false;
    }
    if (canvasInteractionIsActive() && options.silent) {
      canvasState.hydrating = false;
      return false;
    }
    if (!saved?.state && canvasState.canvasId && !initialCanvasBootstrap) {
      canvasState.hydrating = false;
      throw new Error("找不到该画布的保存状态，可能是旧链接或状态已被移除");
    }
    const restored = restoreCanvasState(saved.state);
    if (!restored) {
      canvasState.nodes = [];
      canvasState.connections = [];
      canvasState.assets = [];
      canvasState.layoutChanged = false;
      canvasState.viewport = { x: 0, y: 0, scale: 1 };
      canvasState.livenessLibrary = defaultLivenessLibraryState();
      if (initialCanvasBootstrap && canvasState.canvasId) {
        api("/api/canvas/state", {
          method: "POST",
          body: JSON.stringify({
            projectId: canvasState.canvasId,
            name: "Untitled",
            nextNodeId: 1,
            viewport: { x: 0, y: 0, scale: 1 },
            assets: [],
            nodes: [],
            connections: [],
          }),
        }).then((data) => {
          canvasState.stateUpdatedAt = data.state?.updatedAt || canvasState.stateUpdatedAt;
        }).catch((error) => toast(error.message));
        params.delete("bootstrap");
        const query = params.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      }
    }
    renderProjectTitle();
    syncLivenessLibraryPanel();
    applyCanvasViewport();
    renderNodes();
    resumeArkVirtualPersonPolls();
    const repairedLayout = canvasState.layoutChanged;
    canvasState.layoutChanged = false;
    canvasState.hydrating = false;
    if (repairedLayout) scheduleCanvasSave();
    resumeVideoPolls();
    return;
  }
  canvasState.selectedId = id;
  const urlCanvasId = new URLSearchParams(window.location.search).get("canvas") || "";
  localStorage.setItem("pixelToys.canvasProjectId", id);
  const projectRequest = api(`/api/project/${id}`);
  const preloadedCanvasRequest = urlCanvasId
    ? api(`/api/canvas/state?projectId=${encodeURIComponent(urlCanvasId)}`).catch(() => null)
    : null;
  let preloadedCanvas = null;
  let preloadedCanvasRendered = false;
  const preloadedCanvasReady = preloadedCanvasRequest
    ? preloadedCanvasRequest.then((saved) => {
      preloadedCanvas = saved;
      return saved;
    })
    : Promise.resolve(null);
  if (preloadedCanvasRequest) {
    preloadedCanvasReady.then((saved) => {
      if (saved && videoLoadIsCurrent() && !(canvasInteractionIsActive() && options.silent)) {
        // The canvas state is independent of the full project payload. Render it as
        // soon as it arrives while the server finishes scanning project assets/videos.
        canvasState.canvasId = urlCanvasId;
        syncCanvasUrl(id, urlCanvasId);
        renderProjectTitle();
        const repairedLayout = restoreAndRenderCanvasState(saved, {
          preserveSelection: options.preserveSelection,
          previousSelection,
        });
        preloadedCanvasRendered = true;
        if (repairedLayout) scheduleCanvasSave();
      }
    }).catch(() => {});
  }
  const project = await projectRequest;
  if (!videoLoadIsCurrent()) {
    canvasState.hydrating = false;
    return false;
  }
  if (canvasInteractionIsActive() && options.silent) {
    canvasState.hydrating = false;
    return false;
  }
  canvasState.project = project;
  const currentCanvasId = projectVideoCanvasId(canvasState.project);
  canvasState.canvasId = currentCanvasId || urlCanvasId || "";
  syncCanvasUrl(id, canvasState.canvasId);
  renderProjectTitle();
  const usablePreloadedCanvas = urlCanvasId === canvasState.canvasId ? await preloadedCanvasReady : null;
  const saved = usablePreloadedCanvas || await api(`/api/canvas/state?projectId=${encodeURIComponent(canvasStorageProjectId())}`);
  if (!videoLoadIsCurrent()) {
    canvasState.hydrating = false;
    return false;
  }
  if (canvasInteractionIsActive() && options.silent) {
    canvasState.hydrating = false;
    return false;
  }
  if (!saved?.state && canvasState.canvasId) {
    canvasState.hydrating = false;
    throw new Error("找不到该画布的保存状态，可能是旧链接或状态已被移除");
  }
  const repairedLayout = preloadedCanvasRendered && usablePreloadedCanvas
    ? false
    : restoreAndRenderCanvasState(saved, {
        preserveSelection: options.preserveSelection,
        previousSelection,
      });
  // Existing canvas states predate manifest descriptions. Hydrate metadata in
  // place so captions update without importing new nodes or changing layout.
  const metadataChanged = refreshCanvasProjectAssetMetadata();
  if (metadataChanged) renderNodes({ preserveExisting: true });
  resumeArkVirtualPersonPolls();
  canvasState.hydrating = false;
  if (repairedLayout || metadataChanged) scheduleCanvasSave();
  resumeVideoPolls();
}

async function boot() {
  try {
    await loadProject(canvasState.selectedId, { useUrlCanvas: true });
  } catch (error) {
    canvasState.hydrating = false;
    renderProjectTitle();
    toast(`画布状态加载失败：${error.message || "请刷新后重试"}`);
    return;
  }
  const libraryAssetId = new URLSearchParams(window.location.search).get("libraryAssetId") || "";
  if (!canvasState.selectedId && !canvasState.canvasId && (libraryAssetId || canvasState.assets.length || canvasState.nodes.length)) {
    try {
      await promoteStandaloneCanvas({ force: !!libraryAssetId });
    } catch (error) {
      toast(error.message);
    }
  }
  if (libraryAssetId) {
    try {
      const data = await api(`/api/asset-library/${encodeURIComponent(libraryAssetId)}`);
      // The deep-link asset is still added to the canvas, but it must not
      // replace the library list. Keeping the full list makes the initial
      // deep-link view behave like a normal library view after import.
      await loadSharedAssetLibrary({ silent: true });
      if (data.asset) {
        addSharedLibraryAsset(data.asset);
        // This is a one-time deep link. Leaving it in the URL reopens the
        // large library panel on every refresh and hides the canvas result.
        clearLibraryAssetDeepLink();
      }
      toggleSharedAssetLibrary(true);
    } catch (error) {
      toast(error.message);
    }
  }
}

function canvasAgentCanvasSnapshot() {
  return {
    name: canvasState.project?.title || canvasState.project?.episodeSlug || (canvasState.canvasId ? "独立画布" : "未命名画布"),
    projectId: canvasState.selectedId || "",
    canvasId: canvasState.canvasId || canvasStorageProjectId(),
    selectedNodeIds: [...canvasState.selectedNodeIds],
    assets: canvasState.assets.slice(0, 300).map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      mediaType: asset.mediaType || "image",
      description: asset.description || asset.prompt || "",
      hasImage: Boolean(assetPreviewUrl(asset) || asset.url || asset.publicUrl || asset.localUrl),
    })),
    nodes: canvasState.nodes.slice(0, 100).map((node) => ({
      id: node.id,
      kind: node.kind,
      x: node.x,
      y: node.y,
      prompt: node.prompt || "",
      settings: node.settings || {},
      assets: Array.isArray(node.assets) ? node.assets : [],
      status: node.status || "idle",
    })),
    connections: canvasState.connections.slice(0, 300),
  };
}

function canvasAgentSetStatus(message, busy = canvasState.canvasAgentSending) {
  const status = qs("#canvasAgentStatus");
  const footer = qs(".canvas-agent-panel-footer");
  if (status) status.textContent = message;
  footer?.classList.toggle("is-busy", Boolean(busy));
}

function canvasAgentReferenceForNode(nodeId) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  if (node.kind === "asset") {
    const asset = primaryAssetForNode(node);
    const url = asset?.url || asset?.publicUrl || asset?.localUrl || assetPreviewUrl(asset || {});
    if (!url) return null;
    return { url, preview: assetPreviewUrl(asset || {}) || url, name: asset.name || "画布图片", source: "canvas-asset" };
  }
  if (node.kind === "image" && node.imageUrl) {
    return { url: node.imageUrl, preview: node.imageUrl, name: `图片模块 ${node.id}`, source: "canvas-generated" };
  }
  return null;
}

function beginCanvasAgentNodeDrag(event, nodeId) {
  const reference = canvasAgentReferenceForNode(nodeId);
  if (!reference || !event.dataTransfer) return;
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "copy";
  const payload = { type: "pixel-toys-canvas-agent-image", image: reference };
  event.dataTransfer.setData("application/x-pixel-toys-canvas-agent-image", JSON.stringify(reference));
  event.dataTransfer.setData("application/json", JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", reference.url);
  event.currentTarget.classList.add("is-agent-dragging");
}

function endCanvasAgentNodeDrag(event) {
  event.currentTarget?.classList.remove("is-agent-dragging");
}

function canvasAgentReferenceForAsset(asset, fallbackSource = "canvas-asset") {
  const url = asset?.url || asset?.publicUrl || asset?.localUrl || assetPreviewUrl(asset || {});
  if (!url || isVideoAsset(asset)) return null;
  return { url, preview: assetPreviewUrl(asset || {}) || url, name: asset.name || "画布图片", source: asset.source || fallbackSource };
}

function canvasAgentReferenceFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return null;
  try {
    const raw = dataTransfer.getData("application/x-pixel-toys-canvas-agent-image");
    if (raw) return JSON.parse(raw);
  } catch {}
  try {
    const payload = JSON.parse(dataTransfer.getData("application/json") || "{}");
    if (payload?.type === "pixel-toys-canvas-agent-image") return payload.image || null;
    if (payload?.type === "pixel-toys-asset" && payload.assetId) {
      const asset = canvasState.assets.find((item) => item.id === payload.assetId);
      return asset ? canvasAgentReferenceForAsset(asset) : null;
    }
    if (payload?.type === "pixel-toys-shared-asset" && payload.assetId) {
      const asset = canvasState.sharedAssetLibrary.assets.find((item) => item.id === payload.assetId);
      return asset ? canvasAgentReferenceForAsset(asset, "asset-library") : null;
    }
  } catch {}
  const assetId = dataTransfer.getData("application/x-pixel-toys-asset-id");
  if (assetId) {
    const asset = canvasState.assets.find((item) => item.id === assetId);
    if (asset) return canvasAgentReferenceForAsset(asset);
  }
  const sharedId = dataTransfer.getData("application/x-pixel-toys-shared-asset-id");
  if (sharedId) {
    const asset = canvasState.sharedAssetLibrary.assets.find((item) => item.id === sharedId);
    if (asset) return canvasAgentReferenceForAsset(asset, "asset-library");
  }
  const url = String(dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain") || "").split(/\r?\n/)[0].trim();
  return /^https?:\/\//i.test(url) || /^\/public-assets\//.test(url) || /^\/media\?/.test(url)
    ? { url, preview: url, name: "拖入的图片", source: "conversation" }
    : null;
}

function addCanvasAgentAttachment(image, options = {}) {
  const url = String(image?.url || "").trim();
  const preview = String(image?.preview || image?.previewUrl || url).trim();
  if ((!url && !preview) || isVideoAsset(image)) return false;
  if (canvasState.canvasAgentAttachments.length >= CANVAS_AGENT_MAX_ATTACHMENTS) {
    toast(`Canvas Agent 单次最多引用 ${CANVAS_AGENT_MAX_ATTACHMENTS} 张图片`);
    return false;
  }
  if (url && canvasState.canvasAgentAttachments.some((item) => item.url === url)) return false;
  const id = String(image?.id || options.id || `canvas_agent_ref_${Date.now()}_${canvasState.canvasAgentAttachments.length}`);
  if (canvasState.canvasAgentAttachments.some((item) => item.id === id)) return false;
  canvasState.canvasAgentAttachments.push({
    id,
    url,
    preview,
    name: String(image.name || "未命名图片").trim() || "未命名图片",
    source: String(image.source || "conversation").trim() || "conversation",
    uploading: image.uploading === true,
    uploadError: String(image.uploadError || "").trim(),
  });
  renderCanvasAgentAttachments();
  if (!options.silent) canvasAgentSetStatus(`已添加参考图：${image.name || "图片"}`, false);
  return true;
}

function renderCanvasAgentAttachments() {
  const tray = qs("#canvasAgentAttachments");
  if (!tray) return;
  tray.replaceChildren();
  canvasState.canvasAgentAttachments.forEach((image, index) => {
    const chip = document.createElement("div");
    chip.className = "canvas-agent-attachment";
    chip.dataset.uploading = image.uploading ? "true" : "false";
    chip.dataset.error = image.uploadError ? "true" : "false";
    chip.title = image.uploadError || (image.uploading ? "正在上传参考图" : image.name);
    const preview = document.createElement("img");
    preview.src = image.preview || image.url;
    preview.alt = image.name;
    preview.loading = "eager";
    preview.decoding = "async";
    const label = document.createElement("span");
    label.textContent = image.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `移除 ${image.name}`);
    remove.title = `移除 ${image.name}`;
    remove.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>`;
    remove.addEventListener("click", () => {
      if (/^blob:/i.test(image.preview || "")) URL.revokeObjectURL(image.preview);
      canvasState.canvasAgentAttachments.splice(index, 1);
      renderCanvasAgentAttachments();
    });
    chip.append(preview, label, remove);
    tray.appendChild(chip);
  });
}

async function uploadCanvasAgentImages(files) {
  const list = [...(files || [])].filter((file) => /^image\/(png|jpeg|jpg|webp)$/i.test(file.type));
  if (!list.length) return;
  const jobs = [];
  for (const file of list) {
    if (file.size > 8 * 1024 * 1024) {
      toast(`「${file.name}」超过 8MB，已跳过`);
      continue;
    }
    const previewUrl = URL.createObjectURL(file);
    const attachment = {
      id: `canvas_agent_upload_${Date.now()}_${jobs.length}`,
      url: "",
      preview: previewUrl,
      name: file.name,
      source: "local",
      uploading: true,
      uploadError: "",
    };
    if (canvasState.canvasAgentAttachments.length >= CANVAS_AGENT_MAX_ATTACHMENTS) {
      URL.revokeObjectURL(previewUrl);
      toast(`Canvas Agent 单次最多引用 ${CANVAS_AGENT_MAX_ATTACHMENTS} 张图片`);
      break;
    }
    canvasState.canvasAgentAttachments.push(attachment);
    jobs.push({ file, attachment, previewUrl });
  }
  if (!jobs.length) return;
  renderCanvasAgentAttachments();
  canvasAgentSetStatus(`正在上传 ${jobs.length} 张参考图…`, true);
  await Promise.all(jobs.map(async ({ file, attachment, previewUrl }) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      const data = await api("/api/canvas/public-assets", {
        method: "POST",
        body: JSON.stringify({ name: file.name, dataUrl, localOnly: true }),
      });
      const result = data.result || {};
      const url = result.url || result.publicUrl || result.localUrl || "";
      if (!url) throw new Error("上传没有返回图片地址");
      attachment.url = url;
      attachment.preview = result.localUrl || url;
      attachment.uploading = false;
      if (attachment.preview !== previewUrl) URL.revokeObjectURL(previewUrl);
    } catch (error) {
      attachment.uploading = false;
      attachment.uploadError = error.message || "上传失败";
      toast(`「${file.name}」上传失败：${attachment.uploadError}`);
    } finally {
      renderCanvasAgentAttachments();
    }
  }));
  const failed = canvasState.canvasAgentAttachments.filter((item) => item.uploadError).length;
  canvasAgentSetStatus(failed ? `${failed} 张参考图上传失败，请移除后重试` : "就绪，可操作当前画布", false);
}

function canvasAgentConversationImages() {
  const images = [];
  const seen = new Set();
  const add = (image) => {
    const url = String(image?.url || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({
      url,
      name: String(image.name || "未命名图片").trim() || "未命名图片",
      source: String(image.source || "conversation").trim() || "conversation",
    });
  };
  for (const message of canvasState.canvasAgentMessages) (message.images || []).forEach(add);
  canvasState.canvasAgentAttachments.forEach(add);
  return images.slice(0, CANVAS_AGENT_MAX_ATTACHMENTS);
}

function canvasAgentMessagePayload(message) {
  if (!message || !["user", "assistant"].includes(message.role)) return null;
  const images = Array.isArray(message.images) ? message.images : [];
  if (!images.length) return { role: message.role, content: message.content || "" };
  const parts = [];
  if (message.content) parts.push({ type: "text", text: message.content });
  images.forEach((image) => {
    if (image?.url) parts.push({ type: "image_url", image_url: { url: image.url } });
  });
  return { role: message.role, content: parts };
}

function ensureCanvasAgentReferenceAsset(handle) {
  const match = String(handle || "").match(/^image_(\d+)$/i);
  const image = match ? canvasAgentConversationImages()[Number(match[1]) - 1] : null;
  if (!image?.url) return "";
  const existing = canvasState.assets.find((asset) => asset.source === "canvas-agent-reference" && asset.url === image.url);
  if (existing) return existing.id;
  const asset = {
    id: `agent_ref_${match[1]}_${Date.now().toString(36)}`,
    name: image.name || `参考图 ${match[1]}`,
    type: "Reference",
    url: image.url,
    previewUrl: image.preview || image.url,
    publicUrl: /^https:\/\//i.test(image.url) ? image.url : "",
    source: "canvas-agent-reference",
    aiGenerated: false,
  };
  addAssets([asset]);
  return asset.id;
}

function canvasAgentReferenceAssetIds(handles = []) {
  return (Array.isArray(handles) ? handles : []).map(ensureCanvasAgentReferenceAsset).filter(Boolean);
}

function renderCanvasAgentThread() {
  const thread = qs("#canvasAgentThread");
  if (!thread) return;
  const messages = canvasState.canvasAgentMessages;
  const activities = canvasState.canvasAgentActivities;
  if (!messages.length && !activities.length) {
    if (!thread.querySelector(".canvas-agent-empty")) {
      thread.innerHTML = `<div class="canvas-agent-empty"><strong>把下一步交给 Agent</strong><p>描述节点、连线或提示词的目标，Agent 会直接操作当前画布。</p></div>`;
    }
    return;
  }
  const list = document.createElement("div");
  list.className = "canvas-agent-message-list";
  messages.forEach((message, index) => {
    const bubble = document.createElement("div");
    bubble.className = `canvas-agent-message ${message.role === "user" ? "user" : "assistant"}`;
    if (canvasState.canvasAgentSending && index === messages.length - 1 && message.role === "assistant") {
      bubble.classList.add("is-streaming");
    }
    if (message.content) bubble.appendChild(document.createTextNode(message.content));
    if (message.images?.length) {
      const imageRow = document.createElement("div");
      imageRow.className = "canvas-agent-message-images";
      message.images.forEach((image) => {
        const img = document.createElement("img");
        img.src = image.preview || image.url;
        img.alt = image.name || "参考图";
        imageRow.appendChild(img);
      });
      bubble.appendChild(imageRow);
    }
    if (!message.content && !message.images?.length && message.role === "assistant") bubble.textContent = "正在处理…";
    list.appendChild(bubble);
  });
  activities.slice(-24).forEach((activity) => {
    const note = document.createElement("div");
    note.className = "canvas-agent-action-note";
    note.textContent = activity;
    list.appendChild(note);
  });
  thread.replaceChildren(list);
  requestAnimationFrame(() => {
    thread.scrollTop = thread.scrollHeight;
  });
}

function canvasAgentActionLabel(action = {}) {
  if (action.type === "create_node") return `已创建${action.node?.kind === "video" ? "视频" : action.node?.kind === "asset" ? "资产" : "图片"}模块`;
  if (action.type === "update_node") return "已更新模块配置和提示词";
  if (action.type === "delete_node") return "已删除模块及其连接";
  if (action.type === "connect_nodes") return "已建立模块连接";
  if (action.type === "disconnect_nodes") return "已断开模块连接";
  return "已执行画布动作";
}

function syncCanvasAgentNodeControls(node) {
  const element = node ? qs(`[data-node-id="${CSS.escape(node.id)}"]`) : null;
  if (!element || node.kind === "asset") return;
  const prompt = element.querySelector(".node-prompt");
  if (prompt) prompt.value = node.prompt || "";
  const settings = node.kind === "video"
    ? { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}) }
    : { ...IMAGE_NODE_DEFAULTS, ...(node.settings || {}) };
  element.querySelectorAll("[data-node-field]").forEach((field) => {
    const key = field.dataset.nodeField;
    if (field.type === "checkbox") field.checked = settings[key] !== false;
    else field.value = settings[key] ?? "";
  });
  if (node.kind === "image") syncImageModelControls(element, settings);
  else syncVideoNodeShell(element, node);
}

function applyCanvasAgentAction(action = {}) {
  if (!action || typeof action !== "object") return false;
  if (action.type === "create_node") {
    const source = action.node || {};
    if (!source.id || !["image", "video", "asset"].includes(source.kind)) return false;
    if (canvasState.nodes.some((node) => node.id === source.id)) return false;
    const assetIds = Array.isArray(source.assets)
      ? source.assets.filter((assetId) => canvasState.assets.some((asset) => asset.id === assetId))
      : [];
    const referenceAssetIds = canvasAgentReferenceAssetIds(source.referenceImages);
    createNode(source.kind, { x: Number(source.x) || 80, y: Number(source.y) || 80 }, {
      id: source.id,
      prompt: source.prompt || "",
      assets: [...new Set([...assetIds, ...referenceAssetIds])],
      settings: source.settings || {},
      render: false,
      silent: true,
    });
    renderNodes();
    renderLinks();
    scheduleCanvasSave();
  } else if (action.type === "update_node") {
    const node = canvasState.nodes.find((item) => item.id === action.nodeId);
    if (!node) return false;
    const patch = action.patch && typeof action.patch === "object" ? action.patch : {};
    if (Number.isFinite(Number(patch.x))) node.x = Number(patch.x);
    if (Number.isFinite(Number(patch.y))) node.y = Number(patch.y);
    if (typeof patch.prompt === "string" && node.kind !== "asset") node.prompt = patch.prompt;
    if (patch.settings && typeof patch.settings === "object" && node.kind !== "asset") {
      const defaults = node.kind === "video" ? VIDEO_NODE_DEFAULTS : IMAGE_NODE_DEFAULTS;
      node.settings = { ...defaults, ...(node.settings || {}), ...patch.settings };
    }
    if (Array.isArray(patch.assets)) {
      node.assets = patch.assets.filter((assetId) => canvasState.assets.some((asset) => asset.id === assetId));
    }
    if (Array.isArray(patch.referenceImages)) {
      node.assets = [...new Set([...(node.assets || []), ...canvasAgentReferenceAssetIds(patch.referenceImages)])];
    }
    clampNodePosition(node);
    syncCanvasAgentNodeControls(node);
    renderNodes();
    renderLinks();
    scheduleCanvasSave();
  } else if (action.type === "delete_node") {
    if (!canvasState.nodes.some((node) => node.id === action.nodeId)) return false;
    removeNode(action.nodeId);
  } else if (action.type === "connect_nodes") {
    const source = canvasState.nodes.find((node) => node.id === action.from);
    const target = canvasState.nodes.find((node) => node.id === action.to);
    if (!source || !target || !connectNodes(source, target)) return false;
  } else if (action.type === "disconnect_nodes") {
    const index = canvasState.connections.findIndex((connection) => connection.from === action.from && connection.to === action.to);
    if (index < 0) return false;
    removeConnection(index);
  } else {
    return false;
  }
  canvasState.canvasAgentActivities.push(canvasAgentActionLabel(action));
  canvasState.canvasAgentActivities = canvasState.canvasAgentActivities.slice(-24);
  renderCanvasAgentThread();
  return true;
}

async function readCanvasAgentStream(response, onEvent) {
  if (!response.ok) {
    const raw = await response.text();
    let message = `Canvas Agent 请求失败（HTTP ${response.status}）`;
    try {
      const data = JSON.parse(raw);
      message = data.message || message;
    } catch {}
    throw new Error(message);
  }
  if (!response.body) throw new Error("Canvas Agent 没有返回流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const processLine = (line) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.error) throw new Error(payload.error);
    onEvent(payload);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      pending += decoder.decode();
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    lines.forEach(processLine);
  }
  if (pending) processLine(pending);
}

function setCanvasAgentSending(sending) {
  canvasState.canvasAgentSending = Boolean(sending);
  const input = qs("#canvasAgentInput");
  const button = qs("#canvasAgentSend");
  if (input) input.disabled = canvasState.canvasAgentSending;
  if (button) {
    button.classList.toggle("is-stop", canvasState.canvasAgentSending);
    button.setAttribute("aria-label", canvasState.canvasAgentSending ? "停止" : "发送");
    button.title = canvasState.canvasAgentSending ? "停止当前请求" : "发送";
    button.innerHTML = canvasState.canvasAgentSending
      ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" /></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 4 16 8-16 8 3.1-7.1L14 12l-6.9-.9L4 4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>`;
  }
  canvasAgentSetStatus(canvasState.canvasAgentSending ? "Agent 正在执行…" : "就绪，可操作当前画布", canvasState.canvasAgentSending);
  renderCanvasAgentThread();
}

async function submitCanvasAgentMessage(prompt) {
  if (canvasState.canvasAgentSending) {
    canvasState.canvasAgentController?.abort();
    return;
  }
  const text = String(prompt || "").trim();
  const pending = canvasState.canvasAgentAttachments.filter((item) => item.uploading);
  if (pending.length) {
    canvasAgentSetStatus("参考图仍在上传，请稍候", true);
    toast("参考图仍在上传，请稍候");
    return;
  }
  const failed = canvasState.canvasAgentAttachments.filter((item) => item.uploadError);
  if (failed.length) {
    canvasAgentSetStatus("有参考图上传失败，请移除后重试", false);
    toast("有参考图上传失败，请移除后重试");
    return;
  }
  const images = canvasState.canvasAgentAttachments.filter((item) => item.url);
  if (!text && !images.length) return;
  const model = CANVAS_AGENT_MODELS.has(canvasState.canvasAgentModel) ? canvasState.canvasAgentModel : CANVAS_AGENT_DEFAULT_MODEL;
  const userMessage = { role: "user", content: text, images };
  const requestMessages = [...canvasState.canvasAgentMessages, userMessage].map(canvasAgentMessagePayload).filter(Boolean);
  const assistant = { role: "assistant", content: "" };
  canvasState.canvasAgentMessages.push(userMessage, assistant);
  canvasState.canvasAgentAttachments = [];
  renderCanvasAgentAttachments();
  canvasState.canvasAgentActivities = [];
  const input = qs("#canvasAgentInput");
  if (input) input.value = "";
  setCanvasAgentSending(true);
  const controller = new AbortController();
  canvasState.canvasAgentController = controller;
  try {
    const response = await fetch("/api/canvas/agent/chat", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model,
        messages: requestMessages,
        conversationImages: canvasAgentConversationImages(),
        canvasContext: canvasAgentCanvasSnapshot(),
        projectId: canvasState.selectedId || "",
      }),
      signal: controller.signal,
    });
    await readCanvasAgentStream(response, (payload) => {
      if (payload.delta) {
        assistant.content += payload.delta;
        renderCanvasAgentThread();
      }
      if (payload.toolStart?.name) canvasAgentSetStatus(`Agent 正在执行：${payload.toolStart.name}`, true);
      if (payload.canvasAction) applyCanvasAgentAction(payload.canvasAction);
      if (payload.toolResult?.error) canvasAgentSetStatus(payload.toolResult.summary || "动作未执行", true);
    });
    if (!assistant.content) assistant.content = "已完成画布操作。";
  } catch (error) {
    if (error?.name === "AbortError") {
      if (!assistant.content) assistant.content = "已停止当前请求。";
    } else {
      assistant.content = assistant.content ? `${assistant.content}\n\n${error.message}` : error.message;
      canvasAgentSetStatus(error.message, false);
    }
  } finally {
    canvasState.canvasAgentController = null;
    setCanvasAgentSending(false);
  }
}

function setCanvasAgentOpen(open) {
  const toggle = qs("#canvasAgentToggle");
  const panel = qs("#canvasAgentPanel");
  if (!toggle || !panel) return;
  const isOpen = Boolean(open);
  panel.setAttribute("aria-hidden", String(!isOpen));
  panel.toggleAttribute("inert", !isOpen);
  panel.inert = !isOpen;
  toggle.setAttribute("aria-expanded", String(isOpen));
  toggle.setAttribute("aria-label", isOpen ? "收起 Canvas Agent" : "打开 Canvas Agent");
  if (isOpen) requestAnimationFrame(() => qs("#canvasAgentInput")?.focus());
}

qs("#canvasAgentToggle")?.addEventListener("click", () => {
  const panel = qs("#canvasAgentPanel");
  setCanvasAgentOpen(panel?.getAttribute("aria-hidden") !== "false");
});
qs("#canvasAgentClose")?.addEventListener("click", () => setCanvasAgentOpen(false));
qs("#canvasAgentModel")?.addEventListener("change", (event) => {
  const value = event.currentTarget.value;
  if (CANVAS_AGENT_MODELS.has(value)) canvasState.canvasAgentModel = value;
});
qs("#canvasAgentComposer")?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitCanvasAgentMessage(qs("#canvasAgentInput")?.value || "").catch((error) => canvasAgentSetStatus(error.message, false));
});
qs("#canvasAgentImagePick")?.addEventListener("click", () => qs("#canvasAgentImageUpload")?.click());
qs("#canvasAgentImageUpload")?.addEventListener("change", async (event) => {
  await uploadCanvasAgentImages(event.currentTarget.files);
  event.currentTarget.value = "";
});
const canvasAgentComposer = qs("#canvasAgentComposer");
if (canvasAgentComposer) {
  const isImageDrag = (event) => {
    const types = [...(event.dataTransfer?.types || [])];
    return types.includes("Files")
      || types.includes("application/x-pixel-toys-canvas-agent-image")
      || types.includes("application/x-pixel-toys-asset-id")
      || types.includes("application/x-pixel-toys-shared-asset-id")
      || types.includes("application/json");
  };
  canvasAgentComposer.addEventListener("dragover", (event) => {
    if (!isImageDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    canvasAgentComposer.classList.add("is-dragover");
  });
  canvasAgentComposer.addEventListener("dragleave", (event) => {
    if (!canvasAgentComposer.contains(event.relatedTarget)) canvasAgentComposer.classList.remove("is-dragover");
  });
  canvasAgentComposer.addEventListener("drop", async (event) => {
    if (!isImageDrag(event)) return;
    event.preventDefault();
    canvasAgentComposer.classList.remove("is-dragover");
    if (event.dataTransfer.files?.length) {
      await uploadCanvasAgentImages(event.dataTransfer.files);
      return;
    }
    const reference = canvasAgentReferenceFromDataTransfer(event.dataTransfer);
    if (reference) addCanvasAgentAttachment(reference);
  });
}
qs("#canvasAgentInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitCanvasAgentMessage(event.currentTarget.value).catch((error) => canvasAgentSetStatus(error.message, false));
  }
});
qsa("[data-canvas-agent-suggestion]").forEach((button) => {
  button.addEventListener("click", () => submitCanvasAgentMessage(button.dataset.canvasAgentSuggestion || "").catch((error) => canvasAgentSetStatus(error.message, false)));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && qs("#canvasAgentPanel")?.getAttribute("aria-hidden") === "false") {
    setCanvasAgentOpen(false);
  }
});

qs("#blankCanvas").addEventListener("contextmenu", showContextMenu);
qs("#blankCanvas").addEventListener("wheel", handleCanvasWheel, { passive: false });
qs("#blankCanvas").addEventListener("gesturestart", handleCanvasGestureStart, { passive: false });
qs("#blankCanvas").addEventListener("gesturechange", handleCanvasGestureChange, { passive: false });
qs("#blankCanvas").addEventListener("gestureend", handleCanvasGestureEnd, { passive: false });
qs("#blankCanvas").addEventListener("pointerdown", startCanvasPan);
qs("#blankCanvas").addEventListener("pointerdown", startSelectionMarquee);
qs("#blankCanvas").addEventListener("dragover", handleCanvasDragOver);
qs("#blankCanvas").addEventListener("dragleave", handleCanvasDragLeave);
qs("#blankCanvas").addEventListener("drop", handleCanvasDrop);
qs("#blankCanvas").addEventListener("pointermove", updateAssetConnectorHotspots);
qs("#blankCanvas").addEventListener("pointerleave", clearAssetConnectorHotspots);
qs("#canvasLinks").addEventListener("pointerdown", handleConnectionCutPointerDown);
document.addEventListener("pointermove", updateNodeDrag);
document.addEventListener("pointermove", updateSelectionMarquee);
document.addEventListener("pointermove", updateNodeResize);
document.addEventListener("pointermove", updateConnectionDrag);
document.addEventListener("pointerup", endNodeDrag);
document.addEventListener("pointerup", endNodeResize);
document.addEventListener("pointerup", endSelectionMarquee);
document.addEventListener("pointerup", cancelConnectionDrag);
document.addEventListener("pointermove", updateCanvasPan);
document.addEventListener("pointerup", endCanvasPan);
document.addEventListener("pointercancel", endCanvasPan);
document.addEventListener("click", (event) => {
  const clickedCanvasChrome = event.target.closest?.("#contextMenu, #nodeContextMenu, #assetContextMenu, #connectionMenu, #promptMentionMenu, #sharedAssetLibraryPanel, #assetLibraryToggle");
  const clickedBlankCanvas = !clickedCanvasChrome && (event.target === qs("#blankCanvas") || (event.target.closest?.("#blankCanvas") && !event.target.closest?.(".canvas-node")));
  if (clickedBlankCanvas) {
    if (canvasState.ignoreNextBlankClick) {
      canvasState.ignoreNextBlankClick = false;
    } else {
      clearNodeSelection();
    }
    setActiveVideoNode("");
  }
  if (!event.target.closest("#contextMenu")) hideContextMenu();
  if (!event.target.closest("#nodeContextMenu")) hideNodeContextMenu();
  if (!event.target.closest("#assetContextMenu")) hideAssetContextMenu();
  if (!event.target.closest("#promptMentionMenu") && !event.target.closest(".video-prompt")) hidePromptMentionMenu();
  if (canvasState.ignoreNextConnectionMenuClick) {
    canvasState.ignoreNextConnectionMenuClick = false;
    return;
  }
  if (!event.target.closest("#connectionMenu")) hideConnectionMenu();
});

document.addEventListener("keydown", (event) => {
  if (!["Delete", "Backspace"].includes(event.key)) return;
  if (event.target.closest?.("input, textarea, select, [contenteditable='true'], #contextMenu, #nodeContextMenu, #assetContextMenu, #connectionMenu, #promptMentionMenu")) return;
  if (removeSelectedNodes()) event.preventDefault();
});

qsa("[data-create-node]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    createNode(button.dataset.createNode, { ...canvasState.menuPoint });
  });
});

qs("[data-menu-action='import-assets']").addEventListener("click", () => {
  hideContextMenu();
  importProjectAssets();
});

qs("[data-menu-action='open-asset-library']")?.addEventListener("click", openSharedAssetLibraryFromMenu);

qs("[data-node-action='duplicate-video']")?.addEventListener("click", () => {
  duplicateVideoNode(canvasState.nodeMenu?.nodeId || "");
});

qs("[data-connection-create='image']")?.addEventListener("click", createImageFromConnectionMenu);
qs("[data-connection-create='video']")?.addEventListener("click", createVideoFromConnectionMenu);

qs("[data-asset-action='mark-ai-photoreal']")?.addEventListener("click", markAssetAsAiPhotoreal);
qs("[data-asset-action='certify-ark-virtual-person']")?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  certifyArkVirtualPersonFromMenu().catch((error) => toast(error.message));
});
qs("[data-asset-action='save']")?.addEventListener("click", saveAssetFromContextMenu);

qs("#autoImportAssets").addEventListener("click", importProjectAssets);
qs("#batchGenerateVideos")?.addEventListener("click", () => {
  batchGenerateVideoNodes().catch((error) => toast(error.message));
});
qs("#canvasAssetUpload").addEventListener("change", (event) => {
  uploadLocalAssets(event.target.files || []).catch((error) => toast(error.message));
  event.target.value = "";
});

qs("#livenessLibraryToggle")?.addEventListener("click", () => toggleLivenessLibraryPanel());
qs("#livenessLibraryClose")?.addEventListener("click", () => toggleLivenessLibraryPanel(false));
qs("#livenessLibraryFileUpload")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  prepareLivenessFileUpload(file).catch((error) => {
    setLivenessLibraryPatch({ status: "failed", error: error.message });
    toast(error.message);
  });
});
qsa("[data-liveness-library-field]").forEach((field) => {
  field.addEventListener("input", () => {
    const key = field.dataset.livenessLibraryField;
    const patch = { [key]: field.value, error: "" };
    if (key === "assetUrl") {
      patch.publicAssetReady = /^https:\/\//i.test(field.value) || /^asset:\/\//i.test(field.value);
      if (patch.publicAssetReady) patch.localAssetUrl = "";
    }
    setLivenessLibraryPatch(patch);
  });
});
qs("[data-liveness-library-action='verify']")?.addEventListener("click", () => {
  startLivenessLibraryVerification().catch((error) => {
    setLivenessLibraryPatch({ status: "failed", error: error.message });
    toast(error.message);
  });
});
qs("[data-liveness-library-action='asset']")?.addEventListener("click", () => {
  submitLivenessLibraryAsset().catch((error) => {
    setLivenessLibraryPatch({ status: "failed", error: error.message });
    toast(error.message);
  });
});
qs("[data-liveness-library-action='refresh']")?.addEventListener("click", () => {
  refreshLivenessLibraryAssets().catch((error) => {
    setLivenessLibraryPatch({ status: "failed", error: error.message });
    toast(error.message);
  });
});

window.addEventListener("pagehide", flushCanvasSave);

qs("#canvasClear").addEventListener("click", () => {
  for (const node of canvasState.nodes) clearVideoPoll(node.id);
  canvasState.nodes = [];
  canvasState.connections = [];
  canvasState.assets = [];
  canvasState.selectedNodeIds.clear();
  canvasState.viewport = { x: 0, y: 0, scale: 1 };
  applyCanvasViewport();
  renderNodes();
  scheduleCanvasSave();
  toast("画布已清空");
});

boot().catch((error) => toast(error.message));
