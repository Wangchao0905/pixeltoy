const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

// Legacy person-asset channel. Canvas state is not always persisted, so
// remember the last-used channel id and fall back to a sane default.
const LAST_CHANNEL_ID_KEY = "pixelToys.lastChannelId";
const DEFAULT_CHANNEL_ID = "81";

function rememberedChannelId() {
  try {
    return (localStorage.getItem(LAST_CHANNEL_ID_KEY) || "").trim() || DEFAULT_CHANNEL_ID;
  } catch {
    return DEFAULT_CHANNEL_ID;
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
const canvasState = {
  projects: [],
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
  assetMenu: null,
  ignoreNextConnectionMenuClick: false,
  ignoreNextBlankClick: false,
  mentionMenu: null,
  pollTimers: new Map(),
  viewport: { x: 0, y: 0, scale: 1 },
  livenessLibrary: defaultLivenessLibraryState(),
  livenessRefreshTimer: null,
  livenessSubmitting: false,
  pendingLivenessSubmitAfterVerification: false,
  activeVideoNodeId: "",
  hydrating: true,
  saveTimer: null,
  viewportMoveTimer: null,
  dragFrame: 0,
  layoutChanged: false,
  marqueeFrame: 0,
  connectionFrame: 0,
  hotspotFrame: 0,
  hotspotPoint: null,
  canvasDragOverActive: false,
  gestureScaleStart: 1,
  gestureLastScale: 1,
  gestureWheelBlockUntil: 0,
};

const VIDEO_NODE_DEFAULTS = {
  model: "seedance-2-0",
  ratio: "9:16",
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
  PERSON_REFERENCE_MODEL,
]);
const LEGACY_MODEL_MIGRATIONS = {
  [LIVENESS_MODEL]: PERSON_REFERENCE_MODEL,
};
const VIDEO_MODEL_LABELS = {
  "seedance-2-0": "文生视频 · Seedance 2.0",
  "seedance-2-0-fast": "文生视频 · Seedance 2.0 Fast",
  "seedance-2-0-mini": "文生视频 · Seedance 2.0 Mini",
  [PERSON_REFERENCE_MODEL]: "参考图/人物参考 · Seedance 2.0",
  [BYTEPLUS_MODEL]: "文生视频 · Seedance 2.0(海外火山)",
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
const IMAGE_NODE_DEFAULTS = {
  ratio: "16:9",
  resolution: "1k",
};
const CANVAS_MIN_SCALE = 0.02;
const CANVAS_ZOOM_SPEED = 0.0048;
const ASSET_NODE_DEFAULT_WIDTH = 300;
const ASSET_NODE_DEFAULT_HEIGHT = 200;
const ASSET_NODE_MIN_WIDTH = 96;
const ASSET_NODE_MAX_WIDTH = 520;
const ASSET_NODE_MIN_HEIGHT = 64;
const ASSET_NODE_MAX_HEIGHT = 420;
const VIDEO_NODE_DEFAULT_WIDTH = 780;
const VIDEO_NODE_DEFAULT_HEIGHT = 780;
const VIDEO_NODE_MIN_WIDTH = 420;
const VIDEO_NODE_MAX_WIDTH = 1400;
const VIDEO_NODE_MIN_HEIGHT = 420;
const VIDEO_NODE_MAX_HEIGHT = 1400;
const API_DEFAULT_TIMEOUT_MS = 45_000;
const VIDEO_SUBMIT_TIMEOUT_MS = 150_000;
const VIDEO_SUBMIT_STALE_MS = 2 * 60_000;

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
function scheduleTailFrameSync(nodeId, attempt = 0) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node || node.kind !== "video" || node.tailFrameReady || attempt >= 4) return;
  const timer = setTimeout(async () => {
    try {
      if (canvasState.selectedId) {
        await loadProject(canvasState.selectedId, { preserveSelection: true, silent: true });
      }
    } catch {}
    const fresh = canvasState.nodes.find((item) => item.id === nodeId);
    if (fresh && fresh.kind === "video" && !fresh.tailFrameReady) {
      scheduleTailFrameSync(nodeId, attempt + 1);
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
    nextNodeId: canvasState.nextNodeId,
    viewport: canvasState.viewport,
    assets: canvasState.assets.map(stripBlobUrlsFromAsset),
    nodes: canvasState.nodes,
    connections: canvasState.connections,
    livenessLibrary: canvasState.livenessLibrary,
  };
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

function scheduleCanvasSave() {
  if (canvasState.hydrating) return;
  clearTimeout(canvasState.saveTimer);
  canvasState.saveTimer = setTimeout(() => {
    api("/api/canvas/state", {
      method: "POST",
      body: JSON.stringify(serializableCanvasState()),
    }).catch((error) => console.warn("canvas save failed", error));
  }, 600);
}

function flushCanvasSave() {
  if (canvasState.hydrating) return;
  clearTimeout(canvasState.saveTimer);
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
  if (kind === "video") {
    const hasTask = !!node.taskId;
    const submittedAt = node.submittedAt || "";
    const submittedAtMs = Date.parse(submittedAt || "");
    const staleSubmitting =
      node.status === "running" &&
      !node.videoUrl &&
      !node.taskId &&
      /提交\s*Seedance|正在提交/i.test(String(node.statusMessage || "")) &&
      (!submittedAtMs || Date.now() - submittedAtMs > VIDEO_SUBMIT_STALE_MS);
    const restoredStatus = node.videoUrl ? "completed" : staleSubmitting ? "failed" : node.status || "idle";
    const restoredProgress = restoredStatus === "running"
      ? null
      : Number.isFinite(Number(node.progress))
        ? Number(node.progress)
        : null;
    Object.assign(restored, {
      width: clampNodeDimension(node.width, VIDEO_NODE_MIN_WIDTH, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_DEFAULT_WIDTH),
      height: clampNodeDimension(node.height, VIDEO_NODE_MIN_HEIGHT, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_DEFAULT_HEIGHT),
      settings: { ...VIDEO_NODE_DEFAULTS, ...restoredSettings },
      liveness: { name: "真人A", description: "", status: "idle", assetUrl: "", ...(node.liveness || {}) },
      status: restoredStatus,
      statusMessage: staleSubmitting
        ? "提交视频任务超时：没有拿到 taskId，请重新生成"
        : node.status === "running" && !node.videoUrl ? node.statusMessage || "任务已提交，等待接口返回结果" : node.statusMessage || "",
      videoUrl: node.videoUrl || "",
      taskId: hasTask ? node.taskId || "" : "",
      taskProvider: hasTask ? node.taskProvider || "" : "",
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

function displayProjectTitle(project = {}) {
  const seriesTitle = project.seriesTitle || project.title || project.scriptTitle || "未命名项目";
  const episodeTitle = project.episodeLabel || project.episodeCode || project.episodeSlug || "";
  return project.displayTitle || [seriesTitle, episodeTitle].filter(Boolean).join(" / ");
}

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

function isAiGeneratedPhotorealAsset(asset = {}) {
  if (!isPhotorealAsset(asset)) return false;
  if (asset.aiGenerated === true || asset.verificationType === "ai-generated") return true;
  const source = `${asset.source || ""} ${asset.generationMode || ""}`;
  return /canvas-image|image-generation|ai[-_ ]?generated|gpt[-_ ]?image/i.test(source);
}

function arkPersonAssetUrl(asset = {}) {
  if (asset?.arkPersonAsset?.enabled !== true) return "";
  const url = String(asset.arkPersonAsset.assetUrl || "").trim();
  return /^asset:\/\//i.test(url) ? url : "";
}

function openArkPersonVerification() {
  const popup = window.open(ARK_PERSON_VERIFY_URL, "_blank");
  if (!popup) {
    toast("浏览器阻止了方舟认证窗口，请允许弹窗后重试");
    return false;
  }
  toast("请在方舟完成真人认证并录入素材；返回后在视频节点绑定 asset:// 地址");
  return true;
}

function isArkPersonTargetVideoNode(node = {}) {
  const model = node?.settings?.model || VIDEO_NODE_DEFAULTS.model;
  return model === PERSON_REFERENCE_MODEL;
}

function assetReferenceUrl(asset = {}) {
  const arkPersonUrl = arkPersonAssetUrl(asset);
  if (arkPersonUrl) return arkPersonUrl;
  const publicUrl = asset.publicUrl || asset.public_url || "";
  const rawUrl = asset.url || "";
  if (isPhotorealAsset(asset)) return publicUrl || rawUrl || asset.previewUrl || asset.localUrl || "";
  if (/^asset:\/\//i.test(rawUrl)) return publicUrl || asset.previewUrl || "";
  return publicUrl || rawUrl || asset.previewUrl || "";
}

function videoSubmitCapableAsset(asset = {}) {
  const arkPersonUrl = arkPersonAssetUrl(asset);
  if (arkPersonUrl) return arkPersonUrl;
  const referenceUrl = assetReferenceUrl(asset);
  return referenceUrl;
}

function assetValidationLabel(asset = {}) {
  if (arkPersonAssetUrl(asset)) return "方舟已绑定";
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
  if (nodes) nodes.style.transform = transform;
  if (links) links.style.transform = transform;
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

function setStudioBackLink() {
  const link = qs("#canvasStudioBack");
  link.href = canvasState.selectedId ? `/?project=${encodeURIComponent(canvasState.selectedId)}` : "/";
}

function renderProjectSelect() {
  const select = qs("#canvasProjectSelect");
  const projectOptions = canvasState.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(displayProjectTitle(project))}</option>`).join("");
  select.innerHTML = `<option value="">单独使用</option>${projectOptions}`;
  select.value = canvasState.selectedId || "";
}

function renderProjectTitle() {
  setStudioBackLink();
}

function projectAssets() {
  const data = canvasState.project || {};
  return [
    ...(data.assets || []).filter((asset) => asset.manifestType !== "Storyboard"),
    ...(data.storyboards || []),
  ].map((asset) => ({
    id: asset.assetName || asset.name,
    name: asset.assetName || asset.name,
    type: asset.manifestType || asset.type || "",
    url: asset.url,
    previewUrl: asset.previewUrl || "",
    assetStylePreset: asset.assetStylePreset || "",
    assetStyleLabel: asset.assetStyleLabel || "",
    generationMode: asset.generationMode || "",
    source: "project",
  }));
}

function addAssets(assets) {
  const byId = new Map(canvasState.assets.map((asset) => [asset.id, asset]));
  for (const asset of assets) {
    if (!asset?.id || !asset?.url) continue;
    byId.set(asset.id, stripDataUrlFromAsset({ ...(byId.get(asset.id) || {}), ...asset }));
  }
  canvasState.assets = [...byId.values()];
  renderAssetTray();
  scheduleCanvasSave();
}

function assetPreviewUrl(asset = {}) {
  return asset.previewUrl || asset.preview_url || asset.localUrl || asset.local_url || (String(asset.url || "").startsWith("asset://") ? "" : asset.url) || "";
}

function isVideoAsset(asset = {}) {
  return asset.mediaType === "video" || !!asset.videoUrl || CANVAS_VIDEO_FILE_RE.test(String(asset.url || asset.name || ""));
}

function assetVideoUrl(asset = {}) {
  return asset.videoUrl || (CANVAS_VIDEO_FILE_RE.test(String(asset.url || "")) ? asset.url : "");
}

// 视频素材缩略图:用 <video preload="metadata"> 让浏览器渲染首帧,无需服务端抽帧。
// tray 里不加 controls(不干扰拖拽);节点内加 controls 以便播放。
function assetThumbnailHtml(asset, { controls = false } = {}) {
  if (isVideoAsset(asset)) {
    const vurl = assetVideoUrl(asset);
    if (vurl) return `<video src="${escapeHtml(vurl)}" preload="metadata" muted playsinline${controls ? " controls" : ""}></video>`;
  }
  const previewUrl = assetPreviewUrl(asset);
  return previewUrl
    ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(asset.name || "")}" loading="lazy" decoding="async" />`
    : `<div class="tray-asset-placeholder">asset</div>`;
}

function assetCard(asset) {
  const validationLabel = assetValidationLabel(asset);
  const uploadBadge = asset.uploading
    ? `<span class="asset-upload-badge">上传中…</span>`
    : asset.uploadFailed
      ? `<span class="asset-upload-badge is-failed">上传失败</span>`
      : "";
  return `
    <article class="tray-asset ${isPhotorealAsset(asset) ? "is-photoreal" : ""} ${isVideoAsset(asset) ? "is-video" : ""} ${asset.uploading ? "is-uploading" : ""}" draggable="true" data-asset-id="${escapeHtml(asset.id)}" data-validation="${escapeHtml(asset.validationStatus || "")}">
      ${assetThumbnailHtml(asset)}
      ${uploadBadge}
      <strong>${escapeHtml(asset.name)}</strong>
      <span>${escapeHtml([typeLabel(asset.type), asset.assetStyleLabel, validationLabel].filter(Boolean).join(" · "))}</span>
    </article>
  `;
}

function renderAssetTray() {
  const count = canvasState.assets.length;
  qs("#assetTrayCount").textContent = String(count);
  const list = qs("#assetTrayList");
  const html = count
    ? canvasState.assets.map(assetCard).join("")
    : `<div class="tray-empty">上传或导入资产后显示在这里</div>`;
  // Skip rebuild when unchanged so poll-driven refreshes don't keep recreating
  // the tray <img> thumbnails (which never finish loading otherwise).
  if (list._trayHtml === html) return;
  list._trayHtml = html;
  list.innerHTML = html;
  qsa(".tray-asset").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      const assetId = card.dataset.assetId || "";
      const asset = canvasState.assets.find((item) => item.id === assetId);
      event.dataTransfer.setData("application/x-pixel-toys-asset-id", assetId);
      event.dataTransfer.setData("application/json", JSON.stringify({ type: "pixel-toys-asset", assetId }));
      event.dataTransfer.setData("text/plain", assetId);
      if (asset?.url) event.dataTransfer.setData("text/uri-list", asset.url);
      event.dataTransfer.effectAllowed = "copy";
    });
    card.addEventListener("dblclick", () => addAssetNode(card.dataset.assetId));
  });
}

function nodeTitle(kind) {
  if (kind === "asset") return "图片";
  return kind === "video" ? "Video Generator" : "Image Generator";
}

function createNode(kind, point = canvasState.menuPoint, options = {}) {
  const createPoint = { x: point?.x || 0, y: point?.y || 0 };
  const node = {
    id: `node_${Date.now()}_${canvasState.nextNodeId++}`,
    kind,
    x: createPoint.x,
    y: createPoint.y,
    assets: [],
    prompt: "",
    ...(kind === "asset" ? { width: ASSET_NODE_DEFAULT_WIDTH, height: ASSET_NODE_DEFAULT_HEIGHT } : {}),
    ...(kind === "image" ? { settings: { ...IMAGE_NODE_DEFAULTS }, status: "idle", statusMessage: "", imageUrl: "", taskId: "" } : {}),
    ...(kind === "video" ? { width: VIDEO_NODE_DEFAULT_WIDTH, height: VIDEO_NODE_DEFAULT_HEIGHT, settings: { ...VIDEO_NODE_DEFAULTS }, liveness: { name: "真人A", description: "", status: "idle", assetUrl: "" }, status: "idle", statusMessage: "", videoUrl: "", taskId: "", taskProvider: "" } : {}),
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
  return effectiveNodeAssetIds(node)
    .filter((assetId) => !frameIds.has(assetId))
    .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
    .filter(Boolean)
    .map((asset, index) => ({
      ...asset,
      mention: `@图片${index + mentionOffset + 1}`,
      index: index + mentionOffset + 1,
    }));
}

function addAssetNode(assetId) {
  addAssetNodeAt(assetId, {
    x: 120 + (canvasState.nodes.length % 3) * 48,
    y: 120 + (canvasState.nodes.length % 4) * 44,
  });
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
  renderNodes();
  scheduleCanvasSave();
  if (!options.silent) toast("图片已添加到画布");
  return node;
}

function renderNodeAssets(node) {
  if (node.kind !== "video") {
    return effectiveNodeAssetIds(node)
      .map((assetId) => canvasState.assets.find((asset) => asset.id === assetId))
      .filter(Boolean)
      .map(
        (asset) => `
          <article class="node-asset-chip ${isVideoAsset(asset) ? "is-video" : ""}" title="${escapeHtml(asset.name)}">
            ${assetThumbnailHtml(asset, { controls: true })}
            <span>${escapeHtml(asset.name)}</span>
          </article>
        `,
      )
      .join("");
  }
  const upstreamIds = new Set(upstreamAssetsForNode(node));
  const references = referenceAssetsForVideoNode(node);
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
  if (!references.length) return `${frameChips}${tailFrameChip}`;
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
  return `${frameChips}${tailFrameChip}${chips}`;
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
          <img src="${ref.url}" alt="${escapeHtml(ref.name)}" loading="lazy" decoding="async" />
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
  if (!textarea || !node || node.kind !== "video") return hidePromptMentionMenu();
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
    emptyMessage: referenceAssetsForVideoNode(node).length ? "没有匹配的图片引用" : "先连接图片到视频模块",
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

function insertTextIntoVideoPrompt(nodeId, text) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const textarea = qs(`[data-node-id="${nodeId}"] .video-prompt`);
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
  const assetId = node?.assets?.[0] || "";
  return canvasState.assets.find((asset) => asset.id === assetId) || null;
}

function videoProgressValue(node) {
  return normalizeVideoProgress(node?.progress) ?? 0;
}

function hasRealVideoProgress(node) {
  return normalizeVideoProgress(node?.progress) !== null;
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
  });
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
  if (/XLUO.*(?:网页登录|登录态|Token无效)|(?:网页登录|登录态).*XLUO|xluo-user\.token/i.test(raw)) {
    return {
      title: "XLUO 登录态未配置",
      detail: "XLUO 视频生成接口需要网页登录 token，不接受普通 sk-* API Key。请在服务端配置 XLUO_SESSION_TOKEN 后重启；没有 XLUO 登录态时，普通文本生成可切换到火山方舟。",
      meta: requestId ? `Request ID: ${requestId}` : raw,
    };
  }
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
  const raw = String(node?.videoUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    return `/api/canvas/video-download?url=${encodeURIComponent(raw)}&name=${encodeURIComponent(videoDownloadName(node))}`;
  }
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin && url.pathname === "/media") {
      url.searchParams.set("download", "1");
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return raw;
  }
  return raw;
}

function videoResultStatusLabel(node) {
  return compactNodeText(node?.statusMessage || "生成完成")
    .replace(/[，,；;]?\s*尾帧已就绪/g, "")
    .trim() || "生成完成";
}

function renderVideoPreview(node) {
  if (node.kind !== "video") return "生成结果预览";
  if (node.videoUrl) {
    const downloadHref = videoDownloadHref(node);
    return `
      <video src="${escapeHtml(node.videoUrl)}" controls playsinline preload="none"${node.tailFrameUrl ? ` poster="${escapeHtml(node.tailFrameUrl)}"` : ""}></video>
      <div class="video-result-captions">
        <span class="video-result-caption">${escapeHtml(videoResultStatusLabel(node))}</span>
        ${!node.tailFrameReady && node.tailFrameMessage ? `<span class="video-result-caption is-secondary">${escapeHtml(node.tailFrameMessage)}</span>` : ""}
      </div>
      <a class="video-download-button" href="${escapeHtml(downloadHref)}" download="${escapeHtml(videoDownloadName(node))}" aria-label="下载生成视频">下载</a>
    `;
  }
  if (node.status === "running") {
    const progress = videoProgressValue(node);
    const hasProgress = hasRealVideoProgress(node);
    return `
      <div class="video-node-status">
        <div class="video-tetris-rain" aria-hidden="true">
          <span class="video-tetris-piece shape-i piece-cyan" style="--x: 12%; --delay: -0.1s; --duration: 3.1s;"><i></i><i></i><i></i><i></i></span>
          <span class="video-tetris-piece shape-o piece-yellow" style="--x: 28%; --delay: -1.3s; --duration: 3.8s;"><i></i><i></i><i></i><i></i></span>
          <span class="video-tetris-piece shape-t piece-violet" style="--x: 45%; --delay: -0.8s; --duration: 3.4s;"><i></i><i></i><i></i><i></i></span>
          <span class="video-tetris-piece shape-l piece-green" style="--x: 64%; --delay: -2s; --duration: 4.1s;"><i></i><i></i><i></i><i></i></span>
          <span class="video-tetris-piece shape-s piece-pink" style="--x: 82%; --delay: -1.7s; --duration: 3.6s;"><i></i><i></i><i></i><i></i></span>
          <span class="video-tetris-piece shape-t piece-cyan" style="--x: 72%; --delay: -0.35s; --duration: 4.4s;"><i></i><i></i><i></i><i></i></span>
        </div>
        <div class="video-tetris-status" aria-label="${hasProgress ? `画面正在拼装 ${progress}%` : "画面正在拼装"}">
          <strong>画面正在拼装</strong>
          <em>${hasProgress ? `${progress}%` : "等待进度"}</em>
        </div>
      </div>
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
  element.dataset.videoStatus = node.status || "idle";
  element.dataset.videoRatio = settings.ratio || VIDEO_NODE_DEFAULTS.ratio;
  element.dataset.videoModel = settings.model || VIDEO_NODE_DEFAULTS.model;
  const modelLabel = VIDEO_MODEL_LABELS[settings.model] || settings.model || "Seedance";
  const audioLabel = settings.generateAudio === false ? "无音效" : "音效";
  const summary = `${modelLabel} · ${settings.ratio || "9:16"} · ${settings.resolution || "720p"} · ${settings.duration || 5}s · ${audioLabel}`;
  const kind = element.querySelector(".video-titlebar .node-kind");
  if (kind) kind.textContent = "Video Generation";
  const title = element.querySelector(".video-titlebar h2");
  if (title) title.textContent = modelLabel;
  const preview = element.querySelector(".video-preview-frame");
  if (preview) preview.setAttribute("title", summary);
  const previewSlot = element.querySelector(".video-preview-slot");
  if (previewSlot) previewSlot.style.setProperty("--video-preview-ratio", VIDEO_PREVIEW_RATIOS[settings.ratio] || VIDEO_PREVIEW_RATIOS[VIDEO_NODE_DEFAULTS.ratio]);
  const flowSummary = element.querySelector(".node-flow-summary");
  if (flowSummary) flowSummary.textContent = videoModeSummary(node);
}

function videoNodeSize(node = {}) {
  return {
    width: clampNodeDimension(node.width, VIDEO_NODE_MIN_WIDTH, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_DEFAULT_WIDTH),
    height: clampNodeDimension(node.height, VIDEO_NODE_MIN_HEIGHT, VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_DEFAULT_HEIGHT),
  };
}

function syncVideoNodeDimensions(element, node) {
  if (!element || node?.kind !== "video") return;
  const size = videoNodeSize(node);
  node.width = size.width;
  node.height = size.height;
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
    if (invalidArkAssets.length) return block(`方舟真人素材未绑定有效 asset://：${invalidArkAssets.map((asset) => asset.name || asset.id).join("、")}`);
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
      ? arkPersonAssetUrl(asset) ? "已绑定方舟素材" : "未绑定"
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
  qs("#assetTray")?.classList.remove("collapsed");
  toast("已加入画布资产，可连接到视频模块");
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
  const status = preview.querySelector(".video-tetris-status");
  if (!status) return false;
  const progress = videoProgressValue(node);
  const hasProgress = hasRealVideoProgress(node);
  const progressLabel = status.querySelector("em");
  if (progressLabel) progressLabel.textContent = hasProgress ? `${progress}%` : "等待进度";
  status.setAttribute("aria-label", hasProgress ? `画面正在拼装 ${progress}%` : "画面正在拼装");
  return true;
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
      videoUrl: node.videoUrl || "",
      status: node.status || "",
      statusMessage: node.status === "completed" ? node.statusMessage || "" : "",
      tailFrameMessage: node.status === "completed" && !node.tailFrameReady ? node.tailFrameMessage || "" : "",
    });
    const runningPreviewSynced = syncRunningVideoPreview(preview, node);
    if (!runningPreviewSynced && preview.dataset.previewSig !== previewSig) {
      preview.dataset.previewSig = previewSig;
      preview.innerHTML = renderVideoPreview(node);
    }
    if (runningPreviewSynced) preview.dataset.previewSig = previewSig;
  }
  const kind = element.querySelector(".video-titlebar .node-kind");
  if (kind) kind.textContent = "Video Generation";
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
        button.addEventListener("click", () => insertTextIntoVideoPrompt(node.id, button.dataset.insertReference || ""));
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

async function persistNodeTailFrame(nodeId, result = {}) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
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
    updateVideoNodeStatus(nodeId, {
      tailFrameReady: false,
      tailFrameUrl,
      tailFrameMessage: error.message || "尾帧保存失败",
    });
    return null;
  }
}

function markVideoNodeFailed(nodeId, message) {
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
    updateVideoNodeStatus(nodeId, {
      status: "running",
      statusMessage: "音频被审核拦截,正在关闭音频重试…",
      progress: null,
    });
    toast("生成的音频被海外火山判定敏感,已自动关闭音频重新生成");
    generateVideoNode(nodeId, { forceNoAudio: true }).catch((error) =>
      markVideoNodeFailed(nodeId, error.message || "关音频重试失败"),
    );
    return;
  }
  updateVideoNodeStatus(nodeId, {
    status: "failed",
    statusMessage: message || "视频生成失败",
    progress: 100,
  });
  toast(message || "视频生成失败");
}

// ---- 图片生成节点（gpt-image-2 通道） ----
function assetReferenceUrlById(assetId) {
  const asset = canvasState.assets.find((item) => item.id === assetId);
  if (!asset) return "";
  return asset.publicUrl || asset.url || asset.localUrl || asset.previewUrl || "";
}

function imagePreviewSig(node) {
  return JSON.stringify([node.imageUrl || "", node.status || "", node.statusMessage || ""]);
}

function renderImagePreview(node) {
  const status = String(node.status || "idle");
  if (status === "running") {
    return `<div class="image-preview-state running"><span class="node-spinner"></span><span>${escapeHtml(node.statusMessage || "生成中")}</span></div>`;
  }
  if (node.imageUrl) {
    return `<img class="image-preview-img" src="${escapeHtml(node.imageUrl)}" alt="生成结果" loading="lazy" decoding="async" />`;
  }
  if (status === "failed") {
    return `<div class="image-preview-state failed"><strong>生成失败</strong><span>${escapeHtml(node.statusMessage || "请重试")}</span></div>`;
  }
  return `<div class="image-preview-state">生成结果预览</div>`;
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
    }
  }
  const assets = element.querySelector(".node-assets");
  if (assets) {
    const assetsHtml = renderNodeAssets(node);
    if (assets._assetsHtml !== assetsHtml) {
      assets._assetsHtml = assetsHtml;
      assets.innerHTML = assetsHtml;
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
  const refIds = [...new Set([...upstreamAssetsForNode(node), ...(node.assets || [])])].filter((id) => id && id !== node.generatedAssetId);
  const referenceImages = refIds.map(assetReferenceUrlById).filter(Boolean);
  clearVideoPoll(nodeId);
  updateImageNodeStatus(nodeId, { status: "running", statusMessage: "正在提交出图任务", imageUrl: "" });
  try {
    const data = await api("/api/canvas/image-generation", {
      method: "POST",
      body: JSON.stringify({ prompt, ratio: settings.ratio, resolution: settings.resolution, referenceImages }),
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

async function pollProjectVideoNode(nodeId) {
  clearVideoPoll(nodeId);
  let attempts = 0;
  const tick = async () => {
    try {
      const selectedId = canvasState.selectedId;
      if (!selectedId) return;
      await loadProject(selectedId, { preserveSelection: true, silent: true });
      const next = canvasState.nodes.find((item) => item.id === nodeId);
      if (!projectVideoNodeIsActive(next)) return;
      attempts += 1;
      const delay = attempts < 6 ? 2500 : 5000;
      const timer = setTimeout(tick, videoPollDelay(delay));
      canvasState.pollTimers.set(nodeId, timer);
    } catch (error) {
      const node = canvasState.nodes.find((item) => item.id === nodeId);
      if (!projectVideoNodeIsActive(node)) return;
      const timer = setTimeout(tick, videoPollDelay(5000));
      canvasState.pollTimers.set(nodeId, timer);
    }
  };
  const timer = setTimeout(tick, videoPollDelay(2500));
  canvasState.pollTimers.set(nodeId, timer);
}

function applyVideoGenerationResult(nodeId, result = {}) {
  const status = String(result.status || "").toLowerCase();
  const nextProgress = normalizeVideoProgress(result.progress, 99);
  if (result.videoUrl || status === "completed") {
    clearVideoPoll(nodeId);
    audioRetriedVideoNodes.delete(nodeId);
    updateVideoNodeStatus(nodeId, {
      status: "completed",
      statusMessage: result.message || "生成完成",
      videoUrl: result.videoUrl || "",
      taskId: result.taskId || "",
      taskProvider: result.provider || "",
      progress: 100,
    });
    persistNodeTailFrame(nodeId, result);
    toast("视频已生成");
    scheduleTailFrameSync(nodeId);
    return true;
  }
  if (status === "failed") {
    markVideoNodeFailed(nodeId, result.message || "Seedance 任务失败");
    return true;
  }
  const node = canvasState.nodes.find((item) => item.id === nodeId);
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

async function pollVideoNode(nodeId, taskId, provider = "") {
  if (!taskId) return;
  clearVideoPoll(nodeId);
  const tick = async () => {
    try {
      const providerQuery = provider ? `?provider=${encodeURIComponent(provider)}` : "";
      const data = await api(`/api/canvas/video-generations/${encodeURIComponent(taskId)}${providerQuery}`);
      const done = applyVideoGenerationResult(nodeId, data.result || {});
      if (!done) {
        const timer = setTimeout(tick, videoPollDelay(5000));
        canvasState.pollTimers.set(nodeId, timer);
      }
    } catch (error) {
      markVideoNodeFailed(nodeId, error.message);
    }
  };
  const timer = setTimeout(tick, videoPollDelay(2500));
  canvasState.pollTimers.set(nodeId, timer);
}

async function generateVideoNode(nodeId, options = {}) {
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node || node.kind !== "video") return;
  // 手动发起(非音频重试)时,清掉旧的重试标记,让本轮可以重新尝试带音频。
  if (!options.forceNoAudio) audioRetriedVideoNodes.delete(nodeId);
  const projectShotName = shotNameFromProjectVideoNode(node);
  if (isProjectVideoNode(node) && projectShotName) {
    clearVideoPoll(nodeId);
    updateVideoNodeStatus(nodeId, {
      status: "running",
      statusMessage: "正在通过项目队列提交 Seedance 任务",
      videoUrl: "",
      taskId: "",
      taskProvider: "",
      progress: null,
      submittedAt: new Date().toISOString(),
    });
    try {
      const data = await api("/api/canvas/project-video-generate", {
        method: "POST",
        timeoutMs: VIDEO_SUBMIT_TIMEOUT_MS,
        body: JSON.stringify({
          projectId: projectEpisodeIdFromCanvasStorage(),
          shotName: projectShotName,
        }),
      });
      await loadProject(canvasState.selectedId, { preserveSelection: true });
      const result = data.result?.result || data.result || {};
      const latestNode = canvasState.nodes.find((item) => item.id === nodeId);
      if (projectVideoNodeIsActive(latestNode)) pollProjectVideoNode(nodeId);
      toast(result.message || "项目片段已提交，状态已同步");
    } catch (error) {
      markVideoNodeFailed(nodeId, error.message || "项目片段生成失败");
    }
    return;
  }
  if (syncVideoModelForReferences(node)) renderNodes();
  const readiness = await ensurePhotorealReferencesReady([node]);
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
    progress: null,
    submittedAt: new Date().toISOString(),
  });
  try {
    const data = await api("/api/canvas/video-generations", {
      method: "POST",
      timeoutMs: VIDEO_SUBMIT_TIMEOUT_MS,
      body: JSON.stringify(videoNodePayload(node, { forceNoAudio: !!options.forceNoAudio })),
    });
    const result = data.result || {};
    if (!result.videoUrl && String(result.status || "").toLowerCase() !== "completed" && !result.taskId) {
      markVideoNodeFailed(nodeId, result.message || "视频接口没有返回 taskId，请重试");
      return;
    }
    const done = applyVideoGenerationResult(nodeId, result);
    if (!done && result.taskId) await pollVideoNode(nodeId, result.taskId, result.provider || "");
  } catch (error) {
    markVideoNodeFailed(nodeId, error.message || "视频提交失败");
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

function syncNodeControls(element, node) {
  if (node.kind === "asset") return;
  const prompt = element.querySelector(".node-prompt");
  if (prompt) {
    prompt.value = node.prompt || "";
    prompt.addEventListener("input", () => updateNode(node.id, { prompt: prompt.value }));
  }
  if (node.kind === "image") {
    const settings = { ...IMAGE_NODE_DEFAULTS, ...(node.settings || {}) };
    element.querySelectorAll("[data-node-field]").forEach((field) => {
      const key = field.dataset.nodeField;
      field.value = settings[key] ?? "";
      field.addEventListener("change", () => {
        node.settings = { ...IMAGE_NODE_DEFAULTS, ...(node.settings || {}), [key]: field.value };
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
      node.settings = { ...VIDEO_NODE_DEFAULTS, ...(node.settings || {}), [key]: field.value };
      syncVideoNodeShell(element, node);
      if (key === "model") renderNodes();
      scheduleCanvasSave();
    });
  });
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

function renderNodes() {
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
        return [n.id, n.kind, Math.round(n.x || 0), Math.round(n.y || 0), size.width, size.height, assetPreviewUrl(a || {}) || "", a?.name || ""];
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
  wrap.innerHTML = "";
  for (const node of canvasState.nodes) {
    if (node.kind === "video") syncVideoModelForReferences(node);
    const template = qs(node.kind === "video" ? "#videoNodeTemplate" : node.kind === "asset" ? "#assetNodeTemplate" : "#imageNodeTemplate");
    const element = template.content.firstElementChild.cloneNode(true);
    element.dataset.nodeId = node.id;
    element.classList.toggle("has-input-link", canvasState.connections.some((connection) => connection.to === node.id));
    element.classList.toggle("has-output-link", canvasState.connections.some((connection) => connection.from === node.id));
    element.classList.toggle("is-composer-open", (node.kind === "video" || node.kind === "image") && canvasState.activeVideoNodeId === node.id);
    element.classList.toggle("is-selected", canvasState.selectedNodeIds.has(node.id));
    if (node.kind === "video") syncVideoNodeDimensions(element, node);
    positionNodeElement(element, node);
    if (node.kind === "image" && node.width) element.style.width = `${node.width}px`;
    if (node.kind === "asset") {
      const size = assetNodeSize(node);
      node.width = size.width;
      node.height = size.height;
      element.style.setProperty("--asset-node-width", `${size.width}px`);
      element.style.setProperty("--asset-node-height", `${size.height}px`);
      const asset = primaryAssetForNode(node);
      const img = element.querySelector(".asset-node-image");
      const previewUrl = assetPreviewUrl(asset || {});
      const videoUrl = asset ? assetVideoUrl(asset) : "";
      if (img && asset && isVideoAsset(asset) && videoUrl) {
        // 视频素材:用 <video> 替换模板里的 <img>,否则 mp4 塞进 img.src 会显示破图。
        const video = document.createElement("video");
        video.className = "asset-node-image";
        video.src = videoUrl;
        video.controls = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("draggable", "false");
        video.addEventListener("loadeddata", renderLinks, { once: true });
        img.replaceWith(video);
      } else if (img && asset && previewUrl) {
        img.src = previewUrl;
        img.alt = asset.name || "";
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("load", renderLinks, { once: true });
        if (img.complete) queueMicrotask(renderLinks);
      } else if (img) {
        img.remove();
        element.classList.add("asset-node-without-preview");
        const placeholder = document.createElement("div");
        placeholder.className = "asset-node-file";
        placeholder.innerHTML = `<strong>引用素材</strong><span>无预览图</span>`;
        element.insertBefore(placeholder, element.querySelector(".asset-node-caption"));
      }
      const caption = element.querySelector(".asset-node-caption");
      if (caption) caption.textContent = asset?.name || "图片资产";
      element.addEventListener("contextmenu", (event) => showAssetContextMenu(event, node.id));
    } else {
      element.querySelector(".node-flow-summary").textContent = upstreamSummary(node);
      element.querySelector(".node-assets").innerHTML = renderNodeAssets(node);
      element.querySelectorAll("[data-insert-reference]").forEach((button) => {
        button.addEventListener("click", () => insertTextIntoVideoPrompt(node.id, button.dataset.insertReference || ""));
      });
    }
    const preview = element.querySelector(".video-preview-slot");
    if (preview) {
      preview.innerHTML = renderVideoPreview(node);
      if (node.kind === "video") {
        preview.addEventListener("click", (event) => {
          event.stopPropagation();
          if (isSelectionModifier(event)) toggleNodeSelection(node.id);
          else selectSingleNode(node.id);
          setActiveVideoNode(node.id);
        });
      }
    }
    const imagePreview = element.querySelector(".image-preview-slot");
    if (imagePreview && node.kind === "image") {
      imagePreview.style.setProperty("--image-preview-ratio", VIDEO_PREVIEW_RATIOS[node.settings?.ratio] || "16 / 9");
      imagePreview.dataset.previewSig = imagePreviewSig(node);
      imagePreview.innerHTML = renderImagePreview(node);
      imagePreview.addEventListener("click", (event) => {
        event.stopPropagation();
        if (isSelectionModifier(event)) toggleNodeSelection(node.id);
        else selectSingleNode(node.id);
        setActiveVideoNode(node.id);
      });
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
    const dropzone = element.querySelector(".node-dropzone");
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
      if (node.kind === "video") {
        dropzone.addEventListener("click", () => {
          qs("#assetTray")?.classList.remove("collapsed");
          toast("从 Assets 拖入参考素材");
        });
      }
    }
    wrap.appendChild(element);
  }
  renderLinks();
}

function renderLinks() {
  const svg = qs("#canvasLinks");
  svg.innerHTML = "";
  const paths = [];
  canvasState.connections.forEach((connection, index) => {
    const source = canvasState.nodes.find((node) => node.id === connection.from);
    const target = canvasState.nodes.find((node) => node.id === connection.to);
    if (!source || !target) return;
    paths.push(connectionPath(source, target, index));
  });
  if (canvasState.connectDrag) paths.push(draftConnectionPath());
  if (canvasState.pendingConnection) paths.push(pendingConnectionPath());
  svg.innerHTML = paths.join("");
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

function rectsIntersect(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function startNodeDrag(event, nodeId) {
  if (event.button !== 0 || event.target.closest("textarea, input, select, button, video, a, [contenteditable='true']")) return;
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  if (isSelectionModifier(event)) {
    toggleNodeSelection(nodeId);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (!canvasState.selectedNodeIds.has(nodeId)) selectSingleNode(nodeId);
  if (["video", "image"].includes(node.kind)) setActiveVideoNode(nodeId);
  const point = stagePoint(event.clientX, event.clientY);
  const selectedIds = canvasState.selectedNodeIds.has(nodeId) ? [...canvasState.selectedNodeIds] : [nodeId];
  canvasState.drag = {
    nodeId,
    nodeIds: selectedIds,
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
  for (const origin of drag.origins || []) {
    const node = canvasState.nodes.find((item) => item.id === origin.id);
    if (!node) continue;
    node.x = origin.x + deltaX;
    node.y = origin.y + deltaY;
    clampNodePosition(node);
    const element = qs(`[data-node-id="${node.id}"]`);
    positionNodeElement(element, node);
  }
  renderLinks();
}

function updateNodeDrag(event) {
  if (!canvasState.drag) return;
  canvasState.drag.current = stagePoint(event.clientX, event.clientY);
  if (!canvasState.dragFrame) canvasState.dragFrame = requestAnimationFrame(applyNodeDragFrame);
}

function endNodeDrag() {
  if (canvasState.dragFrame) {
    cancelAnimationFrame(canvasState.dragFrame);
    applyNodeDragFrame();
  }
  if (canvasState.drag) scheduleCanvasSave();
  canvasState.drag = null;
}

// 节点拖拽缩放：视频节点支持四角独立调整宽高，素材/图片保留右下角缩放行为。
function startNodeResize(event, nodeId, corner = "bottom-right") {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const node = canvasState.nodes.find((item) => item.id === nodeId);
  const element = qs(`[data-node-id="${nodeId}"]`);
  if (!node || !element) return;
  const size = node.kind === "video" ? videoNodeSize(node) : {
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

function updateNodeResize(event) {
  const resize = canvasState.resize;
  if (!resize) return;
  const node = canvasState.nodes.find((item) => item.id === resize.nodeId);
  const element = qs(`[data-node-id="${resize.nodeId}"]`);
  if (!node || !element) return;
  const dx = (event.clientX - resize.startX) / (resize.scale || 1);
  const dy = (event.clientY - resize.startY) / (resize.scale || 1);
  const corner = resize.corner || "bottom-right";
  const horizontal = corner.includes("left") ? -1 : 1;
  const vertical = corner.includes("top") ? -1 : 1;
  if (node.kind === "video") {
    const width = Math.max(VIDEO_NODE_MIN_WIDTH, Math.min(VIDEO_NODE_MAX_WIDTH, Math.round(resize.startWidth + horizontal * dx)));
    const height = Math.max(VIDEO_NODE_MIN_HEIGHT, Math.min(VIDEO_NODE_MAX_HEIGHT, Math.round(resize.startHeight + vertical * dy)));
    node.width = width;
    node.height = height;
    if (corner.includes("left")) node.x = resize.startNodeX + resize.startWidth - width;
    if (corner.includes("top")) node.y = resize.startNodeY + resize.startHeight - height;
    syncVideoNodeDimensions(element, node);
    positionNodeElement(element, node);
    renderLinks();
    return;
  }
  const isAsset = node.kind === "asset";
  const minWidth = isAsset ? ASSET_NODE_MIN_WIDTH : 240;
  const maxWidth = isAsset ? ASSET_NODE_MAX_WIDTH : 720;
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(resize.startWidth + dx)));
  node.width = width;
  element.style.width = `${width}px`;
  if (isAsset) {
    const height = Math.max(ASSET_NODE_MIN_HEIGHT, Math.min(ASSET_NODE_MAX_HEIGHT, Math.round(resize.startHeight + dx * (resize.aspectRatio || ASSET_NODE_DEFAULT_HEIGHT / ASSET_NODE_DEFAULT_WIDTH))));
    node.height = height;
    element.style.setProperty("--asset-node-width", `${width}px`);
    element.style.setProperty("--asset-node-height", `${height}px`);
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
  if (event.target.closest(".canvas-node, #assetTray, #contextMenu, #assetContextMenu, #connectionMenu, #promptMentionMenu, button, input, select, textarea")) return;
  event.preventDefault();
  hideContextMenu();
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
  // 图片/视频节点：优先测量实际端口按钮位置，这样收起/展开改变高度时连线与剪刀仍精确对齐。
  const portEl = element?.querySelector(port === "input" ? ".node-port.input-port" : ".node-port.output-port");
  if (portEl) {
    const rect = portEl.getBoundingClientRect();
    if (rect.width || rect.height) return stagePoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  const height = element?.offsetHeight || (node.kind === "asset" ? 190 : node.kind === "video" ? 510 : 430);
  const y = node.y + (node.kind === "video" && port === "input" ? 158 : 74);
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

function bezierPath(from, to, className = "active-link") {
  const { d } = bezierGeometry(from, to);
  return `<path class="${className}" d="${d}" />`;
}

function connectionPath(source, target, index) {
  const { d, mid } = bezierGeometry(nodePortPoint(source, "output"), nodePortPoint(target, "input"));
  return `
    <g class="connection-link" data-connection-index="${index}">
      <path class="connection-hitbox" d="${d}" />
      <path class="active-link" d="${d}" />
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
  return bezierPath(nodePortPoint(source, "output"), canvasState.connectDrag.to, "draft-link");
}

function pendingConnectionPath() {
  const source = canvasState.nodes.find((node) => node.id === canvasState.pendingConnection.from);
  if (!source) return "";
  return bezierPath(nodePortPoint(source, "output"), canvasState.pendingConnection.to, "pending-link");
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
  const width = menu.offsetWidth || 340;
  const height = menu.offsetHeight || 120;
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

function createVideoFromConnectionMenu() {
  const pending = canvasState.connectionMenu;
  if (!pending) return;
  const source = canvasState.nodes.find((node) => node.id === pending.from);
  if (!source) return hideConnectionMenu();
  const videoNode = createNode("video", pending.point, { render: false, silent: true });
  if (!canvasState.connections.some((connection) => connection.from === source.id && connection.to === videoNode.id)) {
    canvasState.connections.push({ from: source.id, to: videoNode.id });
  }
  hideConnectionMenu();
  renderNodes();
  scheduleCanvasSave();
  toast("已创建视频模块，并连接当前图片");
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
  if (event.target.closest(".canvas-node.asset-node")) return;
  event.preventDefault();
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

function hideContextMenu() {
  qs("#contextMenu").classList.add("hidden");
}

function showAssetContextMenu(event, nodeId) {
  event.preventDefault();
  event.stopPropagation();
  hideContextMenu();
  hideConnectionMenu();
  const node = canvasState.nodes.find((item) => item.id === nodeId && item.kind === "asset");
  const asset = primaryAssetForNode(node);
  if (!node || !asset) return;
  canvasState.assetMenu = { nodeId, assetId: asset.id };
  const menu = qs("#assetContextMenu");
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
  renderAssetTray();
  renderNodes();
  scheduleCanvasSave();
  toast("已标记为 AI 生成写实图，可直接作为所有视频模型的参考图");
}

function saveAssetFromContextMenu() {
  const asset = assetFromAssetMenu();
  hideAssetContextMenu();
  if (!asset) return;
  addAssets([asset]);
  qs("#assetTray")?.classList.remove("collapsed");
  toast("已保存到画布资产");
}

function handleCanvasWheel(event) {
  if (event.target.closest("select, input, textarea, button, #contextMenu, #assetTray")) return;
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
  if (event.target.closest("select, input, textarea, button, #contextMenu, #assetTray")) return;
  event.preventDefault();
  canvasState.gestureScaleStart = canvasState.viewport.scale;
  canvasState.gestureLastScale = 1;
}

function handleCanvasGestureChange(event) {
  if (event.target.closest("select, input, textarea, button, #contextMenu, #assetTray")) return;
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
  qs("#assetTray").classList.remove("collapsed");
  toast(`已添加 ${jobs.length} 个素材,上传中…`);
  // 后台并行上传,完成一个换一个的地址
  await Promise.all(jobs.map(async (job) => {
    try {
      const asset = job.isVideo
        ? await uploadLocalVideoAsset(job.file, job.index, job.id)
        : await uploadLocalImageAsset(job.file, job.index, job.id);
      if (asset) {
        addAssets([asset]); // 同 id 原地合并,换成公网地址、清 uploading 标记
        renderNodes();      // 刷新节点里已引用该素材的缩略图
      } else {
        markAssetUploadFailed(job.id, "上传返回为空");
      }
    } catch (error) {
      markAssetUploadFailed(job.id, error.message);
      toast(`「${job.file.name}」上传失败:${error.message}`);
    } finally {
      URL.revokeObjectURL(job.blobUrl);
    }
  }));
}

function markAssetUploadFailed(id, message = "") {
  const asset = canvasState.assets.find((item) => item.id === id);
  if (!asset) return;
  asset.uploading = false;
  asset.uploadFailed = true;
  asset.uploadMessage = message;
  renderAssetTray();
  renderNodes();
}

function handleCanvasDragOver(event) {
  if (event.target.closest(".canvas-node, #assetTray, #contextMenu")) return;
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
  if (event.target.closest(".canvas-node, #assetTray, #contextMenu")) return;
  const assetId = assetIdFromDataTransfer(event.dataTransfer);
  const point = stagePoint(event.clientX, event.clientY);
  const allFiles = Array.from(event.dataTransfer.files || []);
  const files = allFiles.filter((file) => CANVAS_UPLOAD_ACCEPT_RE.test(file.name));
  if (!assetId && !files.length) {
    // 之前这里静默 return,拖了没反应。现在:确实拖进来了文件但格式不支持时给出明确提示。
    if (allFiles.length) toast("不支持的文件类型,画布仅支持 PNG / JPG / WEBP 图片或 MP4 / MOV / WEBM 视频");
    return;
  }
  event.preventDefault();
  setCanvasAssetDragOver(false);
  if (assetId && canvasState.assets.some((asset) => asset.id === assetId)) {
    addAssetNodeAt(assetId, point);
    return;
  }
  if (files.length) createNodesForFiles(files, point).catch((error) => toast(error.message));
}

function importProjectAssets() {
  if (!canvasState.selectedId || !canvasState.project) return toast("当前是单独画布，不会导入项目资产");
  const assets = projectAssets();
  if (!assets.length) return toast("当前项目还没有可导入资产");
  addAssets(assets);
  qs("#assetTray").classList.remove("collapsed");
  scheduleCanvasSave();
  toast(`已导入 ${assets.length} 个项目资产`);
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
  qs("#assetTray").classList.remove("collapsed");
  if (!options.silent) toast(`已上传 ${assets.length} 个资产到画布`);
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

async function loadProjects() {
  const data = await api("/api/projects");
  canvasState.projects = data.projects || [];
  renderProjectSelect();
}

async function loadProject(id = canvasState.selectedId, options = {}) {
  canvasState.hydrating = true;
  const previousSelection = options.preserveSelection ? [...canvasState.selectedNodeIds] : [];
  if (!options.preserveSelection) clearNodeSelection();
  if (!id) {
    canvasState.project = null;
    canvasState.selectedId = "";
    canvasState.canvasId = options.useUrlCanvas ? initialCanvasId || "" : "";
    syncCanvasUrl("", canvasState.canvasId);
    const saved = await api(`/api/canvas/state?projectId=${encodeURIComponent(canvasStorageProjectId())}`);
    if (!restoreCanvasState(saved.state)) {
      canvasState.nodes = [];
      canvasState.connections = [];
      canvasState.assets = [];
      canvasState.layoutChanged = false;
      canvasState.viewport = { x: 0, y: 0, scale: 1 };
      canvasState.livenessLibrary = defaultLivenessLibraryState();
    }
    renderProjectTitle();
    renderAssetTray();
    syncLivenessLibraryPanel();
    applyCanvasViewport();
    renderNodes();
    const repairedLayout = canvasState.layoutChanged;
    canvasState.layoutChanged = false;
    canvasState.hydrating = false;
    if (repairedLayout) scheduleCanvasSave();
    return;
  }
  canvasState.selectedId = id;
  const urlCanvasId = new URLSearchParams(window.location.search).get("canvas") || "";
  localStorage.setItem("pixelToys.canvasProjectId", id);
  canvasState.project = await api(`/api/project/${id}`);
  const currentCanvasId = projectVideoCanvasId(canvasState.project);
  canvasState.canvasId = currentCanvasId || urlCanvasId || "";
  syncCanvasUrl(id, canvasState.canvasId);
  renderProjectTitle();
  const saved = await api(`/api/canvas/state?projectId=${encodeURIComponent(canvasStorageProjectId())}`);
  if (!restoreCanvasState(saved.state)) {
    canvasState.nodes = [];
    canvasState.connections = [];
    canvasState.assets = [];
    canvasState.layoutChanged = false;
    canvasState.viewport = { x: 0, y: 0, scale: 1 };
    canvasState.livenessLibrary = defaultLivenessLibraryState();
  }
  renderAssetTray();
  syncLivenessLibraryPanel();
  applyCanvasViewport();
  renderNodes();
  if (options.preserveSelection) setSelectedNodes(previousSelection);
  const repairedLayout = canvasState.layoutChanged;
  canvasState.layoutChanged = false;
  canvasState.hydrating = false;
  if (repairedLayout) scheduleCanvasSave();
}

async function boot() {
  await loadProjects();
  await loadProject(canvasState.selectedId, { useUrlCanvas: true });
}

qs("#blankCanvas").addEventListener("contextmenu", showContextMenu);
qs("#blankCanvas").addEventListener("wheel", handleCanvasWheel, { passive: false });
qs("#blankCanvas").addEventListener("gesturestart", handleCanvasGestureStart, { passive: false });
qs("#blankCanvas").addEventListener("gesturechange", handleCanvasGestureChange, { passive: false });
qs("#blankCanvas").addEventListener("gestureend", handleCanvasGestureEnd, { passive: false });
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
document.addEventListener("click", (event) => {
  const clickedCanvasChrome = event.target.closest?.("#assetTray, #contextMenu, #assetContextMenu, #connectionMenu, #promptMentionMenu");
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
  if (event.target.closest?.("input, textarea, select, [contenteditable='true'], #contextMenu, #assetContextMenu, #connectionMenu, #promptMentionMenu")) return;
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

qs("[data-connection-create='video']").addEventListener("click", createVideoFromConnectionMenu);

qs("[data-asset-action='mark-ai-photoreal']")?.addEventListener("click", markAssetAsAiPhotoreal);
qs("[data-asset-action='save']")?.addEventListener("click", saveAssetFromContextMenu);

qs("#canvasProjectSelect").addEventListener("change", (event) => {
  for (const node of canvasState.nodes) clearVideoPoll(node.id);
  canvasState.canvasId = "";
  loadProject(event.target.value).catch((error) => toast(error.message));
});

qs("#autoImportAssets").addEventListener("click", importProjectAssets);
qs("#batchGenerateVideos")?.addEventListener("click", () => {
  batchGenerateVideoNodes().catch((error) => toast(error.message));
});
qs("#canvasAssetUpload").addEventListener("change", (event) => {
  uploadLocalAssets(event.target.files || []).catch((error) => toast(error.message));
  event.target.value = "";
});

qs("#assetTrayToggle").addEventListener("click", () => {
  qs("#assetTray").classList.toggle("collapsed");
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
  renderAssetTray();
  applyCanvasViewport();
  renderNodes();
  scheduleCanvasSave();
  toast("画布已清空");
});

boot().catch((error) => toast(error.message));
