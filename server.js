const http = require("node:http");
const dns = require("node:dns");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { collectReferencedAssetNames, classifyReferenceAssets, evaluateReferenceReadiness, runWithConcurrency, runWithDependencies } = require("./scripts/video-ref-prep.js");
const { analyzeSeriesPreflight } = require("./scripts/series-preflight.js");
const { createTeamStore } = require("./server/team-store.js");
const { canAccessResource, canDeleteResource, resourceScope } = require("./server/team-access.js");
const { createReference, referenceStatus, updateReference, copyReferenceFileSnapshot } = require("./server/team-references.js");
const {
  bindReferenceKitToShot,
  normalizeReferenceKit,
  unbindReferenceKitFromShot,
} = require("./server/reference-kits.js");
const { buildTeamProjectProgressFacts, calculateTeamProjectProgress, selectVideoConfigRecord } = require("./server/team-progress.js");
const { createAssetLibrary } = require("./server/asset-library.js");
const { SEEDANCE_DIRECTOR_SYSTEM_ZH, sanitizeSeedanceDesign, hasCompleteSeedanceDesign } = require("./server/seedance-director.js");
const { ensureThumbnail } = require("./server/thumbnailer.js");

// Keep outbound provider requests reliable on hosts with broken IPv6 routing.
// ipv4first alone is insufficient: Node 20+ enables Happy Eyeballs (autoSelectFamily),
// so undici races IPv4/IPv6 concurrently and a dead IPv6 route (ETIMEDOUT) poisons the
// attempt regardless of DNS order. Disabling autoSelectFamily forces strict IPv4-first
// sequential connects, so provider fetch() calls (storyboard/asset/image models) succeed.
dns.setDefaultResultOrder("ipv4first");
if (typeof net.setDefaultAutoSelectFamily === "function") net.setDefaultAutoSelectFamily(false);

const APP_ROOT = process.cwd();
const HOME = os.homedir();
const PORT = Number(process.env.PORT || 4317);
const ASSET_GENERATOR_SCRIPT = path.join(APP_ROOT, "scripts/run_asset_generation.js");
const IMAGE_GEN_SKILL_URL = "https://apikey.fun/install/skill/image-gen";
const IMAGE_GEN_SKILL_SCRIPT_CANDIDATES = [
  process.env.PIXEL_TOYS_IMAGE_GEN_SCRIPT,
  path.join(APP_ROOT, "scripts/vendor/image-gen.js"),
  path.join(HOME, ".agents/skills/image-gen/scripts/node/image-gen.js"),
  path.join(HOME, ".codex/skills/image-gen/scripts/node/image-gen.js"),
].filter(Boolean);
const IMAGE_GEN_SKILL_SCRIPT = IMAGE_GEN_SKILL_SCRIPT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || IMAGE_GEN_SKILL_SCRIPT_CANDIDATES[0];
const DEFAULT_PROJECT_ROOT = path.join(APP_ROOT, "projects");
const SHORT_DRAMA_ROOT = path.join(HOME, "Documents/Codex/ShortDramaProjects");
const CODEX_DOCUMENTS_ROOT = path.join(HOME, "Documents/Codex");
const VIDEO_PROMPTS_DIR = "05_video_prompts";
const VIDEO_ASSET_UPLOAD_DIR = "07_video_asset_uploads";
const VIDEO_TASK_DIR = "08_video_task_nodes";
const IMAGE_API_KEY_ENV_NAMES = [
  "PIXEL_TOYS_IMAGE_API_KEY",
  "IMAGE_GEN_API_KEY",
  "APIKEY_FUN_API_KEY",
  "APIKEYFUN_API_KEY",
  "ASSET_ANALYZER_API_KEY",
  "STORYBOARD_API_KEY",
  "OPENAI_API_KEY",
];
const VIDEO_API_KEY_ENV_NAMES = [
  "VOLC_ARK_API_KEY",
  "ARK_API_KEY",
  "PIXEL_TOYS_VIDEO_API_KEY",
  "GRAVITEX_API_KEY",
  "GRAVITEXAI_API_KEY",
  "SEEDANCE_API_KEY",
];
const ARK_VIDEO_API_KEY_ENV_NAMES = [
  "VOLC_ARK_API_KEY",
  "ARK_API_KEY",
  "PIXEL_TOYS_VIDEO_API_KEY",
  "GRAVITEX_API_KEY",
  "GRAVITEXAI_API_KEY",
  "SEEDANCE_API_KEY",
];
const GRAVITEX_VIDEO_API_KEY_ENV_NAMES = [
  "GRAVITEX_API_KEY",
  "GRAVITEXAI_API_KEY",
  "SEEDANCE_API_KEY",
  "PIXEL_TOYS_VIDEO_API_KEY",
];
const BYTEPLUS_ARK_VIDEO_API_KEY_ENV_NAMES = [
  "BYTEPLUS_ARK_API_KEY",
  "BYTEPLUS_API_KEY",
];
// 火山方舟(Ark)官方视频网关。Gravitex 使用独立的 Seedance 网关。
// BytePlus ModelArk 是 Ark 的国际版(ap-southeast 区),API 结构与火山中国区一致,仅 base URL / key / 模型 ID 前缀不同(dreamina- vs doubao-)。
const DEFAULT_VOLC_ARK_VIDEO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_BYTEPLUS_ARK_VIDEO_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const DEFAULT_GRAVITEX_VIDEO_BASE_URL = "https://api.gravitex.ai/v1";
const VIDEO_API_LOG_PATH = path.join(APP_ROOT, ".pixel-toys-video-api.log");
const VIDEO_API_REQUEST_TIMEOUT_MS = Math.max(10_000, Number(process.env.VIDEO_API_REQUEST_TIMEOUT_MS || 120_000));
const PROJECT_VIDEO_RANGE_CHUNK_BYTES = Math.max(64 * 1024, Number(process.env.PROJECT_VIDEO_RANGE_CHUNK_BYTES || 128 * 1024));
const PROJECT_VIDEO_RANGE_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.PROJECT_VIDEO_RANGE_CONCURRENCY || 16)));
const CANVAS_STATE_DIR = path.join(APP_ROOT, ".pixel-toys-canvas-states");
const CANVAS_PUBLIC_ASSET_DIR = path.join(APP_ROOT, ".pixel-toys-public-assets");
const HIDDEN_SCENE_REFERENCE_DIR = path.join(APP_ROOT, ".pixel-toys-hidden-scene-references");
const CANVAS_VIDEO_DEFAULT_WIDTH = 780;
const CANVAS_VIDEO_DEFAULT_HEIGHT = 780;
const CANVAS_VIDEO_MIN_WIDTH = 420;
const CANVAS_VIDEO_MAX_WIDTH = 1400;
const CANVAS_VIDEO_MIN_HEIGHT = 420;
const CANVAS_VIDEO_MAX_HEIGHT = 1400;
const AUTH_USERS_PATH = path.join(APP_ROOT, ".pixel-toys-users.json");
const AUTH_SESSIONS_PATH = path.join(APP_ROOT, ".pixel-toys-sessions.json");
const AUTH_USAGE_PATH = path.join(APP_ROOT, ".pixel-toys-usage.json");
const TEAM_STORE_PATH = path.join(APP_ROOT, ".pixel-toys-teams.json");
const ASSET_LIBRARY_PATH = path.join(APP_ROOT, ".pixel-toys-asset-library.json");
const teamStore = createTeamStore({ filePath: TEAM_STORE_PATH });
const assetLibrary = createAssetLibrary({ filePath: ASSET_LIBRARY_PATH });
const AUTH_COOKIE_NAME = "pixel_toys_session";
const AUTH_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const DEFAULT_DAILY_VIDEO_LIMIT = 10;
const DEFAULT_CONCURRENT_VIDEO_LIMIT = 2;
const STORYBOARD_IMAGE_CONCURRENCY = (() => {
  const parsed = Number.parseInt(process.env.PIXEL_TOYS_STORYBOARD_CONCURRENCY || "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 3;
})();
const ACTIVE_VIDEO_TASK_TTL_MS = 1000 * 60 * 60 * 6;
const DEFAULT_SEEDANCE_MODEL_MAP = {
  "seedance-2-0": "doubao-seedance-2-0-260128",
  "seedance-2-0-fast": "doubao-seedance-2-0-fast-260128",
  "seedance-2-0-mini": "doubao-seedance-2-0-mini-260615",
};
// BytePlus ModelArk(国际版)模型 ID:dreamina- 前缀,可用 env 覆盖。
const DEFAULT_BYTEPLUS_SEEDANCE_MODEL_MAP = {
  "seedance-2-0": "dreamina-seedance-2-0-260128",
  "seedance-2-0-fast": "dreamina-seedance-2-0-260128",
  "seedance-2-0-mini": "dreamina-seedance-2-0-260128",
};
const SEEDANCE_MAX_IMAGE_REFERENCES = 9;
// 标准 2.0 / Fast / Mini 绑定方舟私域人物素材后使用 Ark asset:// 契约。
// 未绑定素材时保持当前视频通道；人物参考模型继续使用自己的独立链路。
const ARK_PERSON_TARGET_MODELS = new Set([
  "seedance-2-0",
  "seedance-2-0-fast",
  "seedance-2-0-mini",
]);
const DEFAULT_VIDEO_CONFIG_MODEL = "seedance-2-0-fast";
const FALLBACK_ASSET_ANALYZER_MODEL = "claude-opus-4-8";
const FALLBACK_STORYBOARD_MODEL = "gpt-5.6-sol"; // storyboard 用独立的 STORYBOARD_API_KEY(GPT 组);analyzer 才用 Claude key
const ASSET_ANALYZER_MODEL_ALIASES = {
  "Claude Code 4.8": "claude-opus-4-8",
  "claude code 4.8": "claude-opus-4-8",
  "claude-code-4.8": "claude-opus-4-8",
  "Claude Opus 4.8": "claude-opus-4-8",
  "claude opus 4.8": "claude-opus-4-8",
  "claude-opus-4-8": "claude-opus-4-8",
  "GPT 5.5 Thinking": "gpt-5.5-thinking",
  "gpt 5.5 thinking": "gpt-5.5-thinking",
  "gpt-5.5-thinking": "gpt-5.5-thinking",
  "gpt-5.5": "gpt-5.5-thinking",
};
const STORYBOARD_MODEL_ALIASES = {
  "GPT 5.5 Thinking": "gpt-5.5-thinking",
  "gpt 5.5 thinking": "gpt-5.5-thinking",
  "gpt-5.5-thinking": "gpt-5.5-thinking",
  "Claude Code 4.8": "claude-opus-4-8",
  "claude code 4.8": "claude-opus-4-8",
  "claude-code-4.8": "claude-opus-4-8",
  "Claude Opus 4.8": "claude-opus-4-8",
  "claude opus 4.8": "claude-opus-4-8",
  "claude-opus-4-8": "claude-opus-4-8",
};
const IMAGE_SIZE_BY_QUALITY_16_9 = {
  "1k": "1280x720",
  "2k": "2048x1152",
  "4k": "3840x2160",
};
const DEFAULT_IMAGE_SIZE_16_9 = IMAGE_SIZE_BY_QUALITY_16_9["1k"];
// Production Board 整张为 9:16 竖版(和最终竖屏视频一致),九格面板同样是竖版构图。
const IMAGE_SIZE_BY_QUALITY_9_16 = {
  "1k": "720x1280",
  "2k": "1152x2048",
  "4k": "2160x3840",
};
const DEFAULT_IMAGE_SIZE_9_16 = IMAGE_SIZE_BY_QUALITY_9_16["1k"];
let imageApiKeyLoadedFrom = "";
let runtimeAssetAnalyzerApiKey = "";
let runtimeAssetAnalyzerKeySource = "";
const jobs = new Map();
const jobChildren = new Map();
const projectVideoQueues = new Map();
let superPixelFetch = (...args) => fetch(...args);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
};

function send(res, status, data, headers = {}) {
  if (res.headersSent) return; // 防止响应已发后二次写头(ERR_HTTP_HEADERS_SENT)
  if (Buffer.isBuffer(data)) {
    res.writeHead(status, headers);
    res.end(data);
    return;
  }
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function fail(res, status, message, detail = undefined) {
  send(res, status, { ok: false, message, detail });
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function authCookie(value, options = {}) {
  const maxAge = Math.max(0, Math.floor((options.maxAgeMs ?? AUTH_SESSION_MAX_AGE_MS) / 1000));
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(value || "")}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production" && process.env.PIXEL_TOYS_SECURE_COOKIE !== "false") parts.push("Secure");
  return parts.join("; ");
}

function normalizeUsername(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function invitationCodes() {
  return compactLine(readLocalEnvValue("PIXEL_TOYS_INVITE_CODES") || process.env.PIXEL_TOYS_INVITE_CODES || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

function invitationCodeMatches(a = "", b = "") {
  const left = Buffer.from(String(a || "").trim());
  const right = Buffer.from(String(b || "").trim());
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function matchingInvitationCode(value = "") {
  const incoming = String(value || "").trim();
  if (!incoming) return "";
  return invitationCodes().find((code) => invitationCodeMatches(code, incoming)) || "";
}

function invitationCodeUsed(code = "", users = readAuthUsers().users) {
  return users.some((user) => invitationCodeMatches(user.inviteCode || "", code));
}

function updateLocalEnvValue(name, value) {
  const filePath = path.join(APP_ROOT, ".env.local");
  const nextLine = `${name}=${String(value || "")}`;
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  let replaced = false;
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(=.*)$/);
    if (!match || match[2] !== name) return line;
    replaced = true;
    return nextLine;
  });
  if (!replaced) nextLines.push(nextLine);
  fs.writeFileSync(filePath, `${nextLines.filter((line, index) => line || index < nextLines.length - 1).join("\n")}\n`, { mode: 0o600 });
  process.env[name] = String(value || "");
}

function configuredEnv(names = []) {
  return names.some((name) => !!compactLine(readLocalEnvValue(name) || process.env[name] || ""));
}

function verifyInvitationCode(value = "", users = readAuthUsers().users) {
  const code = matchingInvitationCode(value);
  return !!code && !invitationCodeUsed(code, users);
}

const SUPER_ADMIN_USERNAME = "superadmin";

function adminUsernames() {
  const configured = compactLine(readLocalEnvValue("PIXEL_TOYS_ADMIN_USERNAMES") || process.env.PIXEL_TOYS_ADMIN_USERNAMES || "")
    .split(",")
    .map(normalizeUsername)
    .filter(Boolean);
  return [...new Set([SUPER_ADMIN_USERNAME, ...configured])];
}

function computedUserRole(user = {}) {
  if (!user?.id) return "user";
  if (adminUsernames().includes(normalizeUsername(user.username))) return "admin";
  return "user";
}

function isAdminUser(user = {}) {
  return computedUserRole(user) === "admin";
}

// 画布权限：管理员始终可用；普通用户需被管理员显式开启 canvasEnabled。
function userCanUseCanvas(user = {}) {
  return isAdminUser(user) || user?.canvasEnabled === true;
}

function teamMembershipForUser(userId = "") {
  const team = teamStore.teamForUser(userId);
  if (!team) return null;
  const member = team.members.find((item) => item.userId === userId);
  return member ? { teamId: team.id, role: member.role, team } : null;
}

function currentTeamSummary(user = {}) {
  const membership = teamMembershipForUser(user.id);
  if (!membership) return null;
  const users = new Map(readAuthUsers().users.map((item) => [item.id, item]));
  return {
    id: membership.team.id,
    name: membership.team.name,
    role: membership.role,
    ownerUserId: membership.team.ownerUserId,
    members: membership.team.members.map((member) => ({
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      username: users.get(member.userId)?.username || member.userId,
      displayName: users.get(member.userId)?.displayName || users.get(member.userId)?.username || member.userId,
    })),
    inviteExpiresAt: membership.role === "owner" ? membership.team.invite?.expiresAt || "" : "",
  };
}

function assertCurrentTeamMembership(user = {}) {
  const membership = teamMembershipForUser(user.id);
  if (!membership) {
    const error = new Error("请先创建或加入团队");
    error.statusCode = 409;
    throw error;
  }
  return membership;
}

function publicUser(user = {}) {
  const membership = teamMembershipForUser(user.id);
  return {
    id: user.id || "",
    username: user.username || "",
    displayName: user.displayName || user.username || "",
    avatarUrl: user.avatarUrl || "",
    role: computedUserRole(user),
    disabled: !!user.disabled,
    canvasEnabled: userCanUseCanvas(user),
    teamId: membership?.teamId || "",
    teamRole: membership?.role || "",
    dailyVideoLimit: Number.isFinite(Number(user.dailyVideoLimit)) ? Number(user.dailyVideoLimit) : null,
    concurrentVideoLimit: Number.isFinite(Number(user.concurrentVideoLimit)) ? Number(user.concurrentVideoLimit) : null,
    createdAt: user.createdAt || "",
    lastLoginAt: user.lastLoginAt || "",
  };
}

function readAuthUsers() {
  const data = readJsonFile(AUTH_USERS_PATH, { users: [] });
  return { users: Array.isArray(data.users) ? data.users : [] };
}

function writeAuthUsers(data) {
  writeJsonFile(AUTH_USERS_PATH, { users: Array.isArray(data.users) ? data.users : [] });
}

function saveUserProfile(userId, body = {}) {
  const store = readAuthUsers();
  const user = store.users.find((item) => item.id === userId);
  if (!user) throw new Error("用户不存在");

  if (typeof body.displayName === "string") {
    user.displayName = compactLine(body.displayName).slice(0, 80) || user.username;
  }

  const avatarDataUrl = String(body.avatarDataUrl || "");
  if (avatarDataUrl) {
    const decoded = decodeDataImageUrl(avatarDataUrl);
    const detectedExtension = detectImageExtension(decoded?.buffer);
    if (!decoded || !detectedExtension) throw new Error("个人头像只支持 PNG、JPG、WEBP");
    if (decoded.buffer.length > 2 * 1024 * 1024) throw new Error("个人头像不能超过 2MB");
    user.avatarUrl = persistDecodedPublicAsset({ ...decoded, ext: detectedExtension }, `avatar-${user.id}`);
    user.avatarUpdatedAt = new Date().toISOString();
  }

  user.updatedAt = new Date().toISOString();
  writeAuthUsers(store);
  return publicUser(user);
}

function readAuthSessions() {
  const data = readJsonFile(AUTH_SESSIONS_PATH, { sessions: [] });
  const now = Date.now();
  const sessions = Array.isArray(data.sessions)
    ? data.sessions.filter((session) => session?.id && session?.userId && Date.parse(session.expiresAt || "") > now)
    : [];
  if (sessions.length !== data.sessions?.length) writeJsonFile(AUTH_SESSIONS_PATH, { sessions });
  return { sessions };
}

function writeAuthSessions(data) {
  writeJsonFile(AUTH_SESSIONS_PATH, { sessions: Array.isArray(data.sessions) ? data.sessions : [] });
}

function isLocalRequest(req) {
  const address = compactLine(req.socket?.remoteAddress || "");
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function isAuthorizedMcpRequest(req) {
  if (!isLocalRequest(req)) return false;
  const configured = compactLine(readLocalEnvValue("PIXEL_TOYS_MCP_TOKEN") || process.env.PIXEL_TOYS_MCP_TOKEN || "");
  if (!configured) return false;
  const header = compactLine(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = compactLine(match?.[1] || "");
  if (!token || token.length !== configured.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(configured));
}

function mcpAuthUser() {
  return {
    id: "mcp-agent",
    username: SUPER_ADMIN_USERNAME,
    displayName: "MCP Agent",
    canvasEnabled: true,
    dailyVideoLimit: 0,
    concurrentVideoLimit: 0,
  };
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const iterations = 210000;
  const digest = "sha256";
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, digest).toString("base64url");
  return `pbkdf2:${digest}:${iterations}:${salt}:${hash}`;
}

function verifyPassword(password, stored = "") {
  const parts = String(stored || "").split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2") return false;
  const [, digest, iterationsRaw, salt, expected] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations < 100000) return false;
  const actual = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, digest).toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function createAuthSession(userId) {
  const store = readAuthSessions();
  const now = new Date();
  const session = {
    id: crypto.randomBytes(32).toString("base64url"),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTH_SESSION_MAX_AGE_MS).toISOString(),
  };
  store.sessions.push(session);
  writeAuthSessions(store);
  return session;
}

function currentUserFromRequest(req) {
  if (isAuthorizedMcpRequest(req)) return mcpAuthUser();
  const sessionId = parseCookies(req.headers.cookie || "")[AUTH_COOKIE_NAME];
  if (!sessionId) return null;
  const sessions = readAuthSessions().sessions;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  const user = readAuthUsers().users.find((item) => item.id === session.userId);
  if (user?.disabled) return null;
  return user || null;
}

function videoLimitEnvNumber(name, fallback) {
  const value = Number(readLocalEnvValue(name) || process.env[name] || fallback);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function dailyVideoLimit() {
  return videoLimitEnvNumber("PIXEL_TOYS_DAILY_VIDEO_LIMIT", DEFAULT_DAILY_VIDEO_LIMIT);
}

function concurrentVideoLimit() {
  return videoLimitEnvNumber("PIXEL_TOYS_CONCURRENT_VIDEO_LIMIT", DEFAULT_CONCURRENT_VIDEO_LIMIT);
}

function numericUserLimit(user, key, fallback) {
  const value = Number(user?.[key]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function dailyVideoLimitForUser(user) {
  return numericUserLimit(user, "dailyVideoLimit", dailyVideoLimit());
}

function concurrentVideoLimitForUser(user) {
  return numericUserLimit(user, "concurrentVideoLimit", concurrentVideoLimit());
}

function currentUsageDay() {
  return new Date().toISOString().slice(0, 10);
}

function readAuthUsage() {
  const data = readJsonFile(AUTH_USAGE_PATH, { days: {} });
  return { days: data.days && typeof data.days === "object" ? data.days : {} };
}

function writeAuthUsage(data) {
  writeJsonFile(AUTH_USAGE_PATH, { days: data.days && typeof data.days === "object" ? data.days : {} });
}

function userDailyVideoCount(userId, day = currentUsageDay()) {
  const usage = readAuthUsage();
  return Number(usage.days?.[day]?.[userId]?.videoTasks || 0);
}

function recordUserVideoTask(user, meta = {}) {
  if (!user?.id) return;
  const day = currentUsageDay();
  const usage = readAuthUsage();
  usage.days[day] = usage.days[day] && typeof usage.days[day] === "object" ? usage.days[day] : {};
  const entry = usage.days[day][user.id] && typeof usage.days[day][user.id] === "object" ? usage.days[day][user.id] : {};
  entry.videoTasks = Number(entry.videoTasks || 0) + 1;
  entry.updatedAt = new Date().toISOString();
  entry.lastTask = {
    kind: compactLine(meta.kind || "video").slice(0, 40),
    projectId: compactLine(meta.projectId || "").slice(0, 260),
    shotName: compactLine(meta.shotName || "").slice(0, 260),
    nodeId: compactLine(meta.nodeId || "").slice(0, 120),
    taskId: compactLine(meta.taskId || "").slice(0, 260),
    provider: compactLine(meta.provider || "").slice(0, 80),
  };
  const activeTaskId = compactLine(meta.taskId || "");
  if (activeTaskId && meta.completed !== true) {
    entry.activeVideoTasks = Array.isArray(entry.activeVideoTasks) ? entry.activeVideoTasks : [];
    entry.activeVideoTasks = entry.activeVideoTasks.filter((task) => compactLine(task.taskId || "") !== activeTaskId);
    entry.activeVideoTasks.push({
      ...entry.lastTask,
      taskId: activeTaskId,
      startedAt: new Date().toISOString(),
    });
  }
  usage.days[day][user.id] = entry;
  writeAuthUsage(usage);
}

function activeVideoTasksForUser(userId, day = currentUsageDay()) {
  const usage = readAuthUsage();
  const entry = usage.days?.[day]?.[userId] || {};
  const now = Date.now();
  const active = (Array.isArray(entry.activeVideoTasks) ? entry.activeVideoTasks : []).filter((task) => {
    const startedAt = Date.parse(task.startedAt || "") || 0;
    return compactLine(task.taskId || "") && (!startedAt || now - startedAt < ACTIVE_VIDEO_TASK_TTL_MS);
  });
  if (active.length !== (entry.activeVideoTasks || []).length) {
    entry.activeVideoTasks = active;
    usage.days[day][userId] = entry;
    writeAuthUsage(usage);
  }
  return active;
}

function runningVideoCountForUser(userId) {
  if (!userId) return 0;
  return activeVideoTasksForUser(userId).length;
}

function markUserVideoTaskFinished(user, taskId = "") {
  const cleanTaskId = compactLine(taskId || "");
  if (!user?.id || !cleanTaskId) return;
  const usage = readAuthUsage();
  let changed = false;
  for (const entry of Object.values(usage.days || {})) {
    const userEntry = entry?.[user.id];
    if (!userEntry || !Array.isArray(userEntry.activeVideoTasks)) continue;
    const next = userEntry.activeVideoTasks.filter((task) => compactLine(task.taskId || "") !== cleanTaskId);
    if (next.length !== userEntry.activeVideoTasks.length) {
      userEntry.activeVideoTasks = next;
      userEntry.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeAuthUsage(usage);
}

function assertUserCanSubmitVideoTask(req, taskCount = 1) {
  if (process.env.PIXEL_TOYS_AUTH_DISABLED === "1") {
    return { user: null, dailyLimit: 0, concurrentLimit: 0, currentDaily: 0, running: 0 };
  }
  const user = currentUserFromRequest(req);
  if (!user) throw new Error("请先登录");
  const dailyLimit = dailyVideoLimitForUser(user);
  const concurrentLimit = concurrentVideoLimitForUser(user);
  const currentDaily = userDailyVideoCount(user.id);
  // Admins have no daily cap — they manage the studio and need to run full
  // episode queues past the per-user daily limit.
  const admin = isAdminUser(user);
  if (!admin && dailyLimit > 0 && currentDaily + taskCount > dailyLimit) {
    throw new Error(`今日视频生成额度已达上限：${currentDaily}/${dailyLimit}`);
  }
  const running = runningVideoCountForUser(user.id);
  if (concurrentLimit > 0 && running >= concurrentLimit) {
    throw new Error(`当前运行中视频任务已达上限：${running}/${concurrentLimit}，请等待任务完成后再提交`);
  }
  return { user, dailyLimit, concurrentLimit, currentDaily, running };
}

function isAuthApiPath(pathname = "") {
  return (
    pathname === "/api/auth/me" ||
    pathname === "/api/auth/register" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/password" ||
    pathname === "/api/auth/profile"
  );
}

function isAdminApiPath(pathname = "") {
  return pathname === "/api/admin/summary" || pathname.startsWith("/api/admin/");
}

function isPublicStaticPath(pathname = "") {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/app.js" ||
    pathname === "/workspace-shell.js" ||
    pathname === "/auth.html" ||
    pathname === "/auth.js" ||
    pathname === "/styles.css" ||
    pathname === "/infinity-3d.png" ||
    pathname === "/pixel-infinity-logo.png" ||
    pathname === "/pixel-toys-logo.png" ||
    pathname === "/pixel-toy-symbol.png" ||
    pathname === "/logo11-source.png" ||
    pathname.startsWith("/fonts/")
  );
}

function isStandaloneImageGenerationApiPath(pathname = "") {
  return pathname === "/api/canvas/image-generation" || /^\/api\/canvas\/image-generations\/[^/]+$/.test(pathname);
}

function requireAuth(req, res, url) {
  if (process.env.PIXEL_TOYS_AUTH_DISABLED === "1") return true;
  if (isAuthorizedMcpRequest(req)) return true;
  if (isAuthApiPath(url.pathname) || isPublicStaticPath(url.pathname)) return true;
  if (url.pathname === "/admin.html" || isAdminApiPath(url.pathname)) {
    const user = currentUserFromRequest(req);
    if (!user) {
      if (url.pathname.startsWith("/api/")) fail(res, 401, "请先登录");
      else redirect(res, `/auth.html?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
      return false;
    }
    if (!isAdminUser(user)) {
      fail(res, 403, "需要管理员权限");
      return false;
    }
    return true;
  }
  if (isStandaloneImageGenerationApiPath(url.pathname)) {
    if (!currentUserFromRequest(req)) {
      fail(res, 401, "请先登录");
      return false;
    }
    return true;
  }
  if (url.pathname === "/canvas.html" || url.pathname.startsWith("/api/canvas/")) {
    const user = currentUserFromRequest(req);
    if (!user) {
      if (url.pathname.startsWith("/api/")) fail(res, 401, "请先登录");
      else redirect(res, `/auth.html?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
      return false;
    }
    if (!userCanUseCanvas(user)) {
      if (url.pathname.startsWith("/api/")) fail(res, 403, "未开启画布权限，请联系管理员");
      else redirect(res, "/");
      return false;
    }
    return true;
  }
  if (url.pathname.startsWith("/api/")) {
    if (currentUserFromRequest(req)) return true;
    fail(res, 401, "请先登录");
    return false;
  }
  // 首页是公开的创作入口；项目、画布和生成 API 仍在上面的鉴权分支中保护。
  if (url.pathname === "/" || url.pathname === "/index.html") return true;
  return true;
}

async function handleAuthApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = currentUserFromRequest(req);
    return send(res, 200, { ok: true, user: user ? publicUser(user) : null });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readBody(req);
    const username = normalizeUsername(body.username || "");
    const password = String(body.password || "");
    const displayName = compactLine(body.displayName || username).slice(0, 80);
    const inviteCode = compactLine(body.inviteCode || body.invitationCode || "");
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) throw new Error("用户名需为 3-32 位小写字母、数字、下划线或短横线");
    if (password.length < 8) throw new Error("密码至少 8 位");
    const store = readAuthUsers();
    if (!verifyInvitationCode(inviteCode, store.users)) throw new Error("邀请码不正确、已使用或注册暂未开放");
    if (store.users.some((user) => user.username === username)) throw new Error("用户名已存在");
    const user = {
      id: `user_${crypto.randomBytes(12).toString("base64url")}`,
      username,
      displayName: displayName || username,
      role: "user",
      inviteCode,
      disabled: false,
      passwordHash: passwordHash(password),
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    store.users.push(user);
    writeAuthUsers(store);
    const session = createAuthSession(user.id);
    return send(res, 200, { ok: true, user: publicUser(user) }, { "Set-Cookie": authCookie(session.id) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const username = normalizeUsername(body.username || "");
    const password = String(body.password || "");
    const store = readAuthUsers();
    const user = store.users.find((item) => item.username === username);
    if (!user || !verifyPassword(password, user.passwordHash)) throw new Error("用户名或密码不正确");
    if (user.disabled) throw new Error("账号已停用，请联系管理员");
    user.lastLoginAt = new Date().toISOString();
    writeAuthUsers(store);
    const session = createAuthSession(user.id);
    return send(res, 200, { ok: true, user: publicUser(user) }, { "Set-Cookie": authCookie(session.id) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const sessionId = parseCookies(req.headers.cookie || "")[AUTH_COOKIE_NAME];
    if (sessionId) {
      const store = readAuthSessions();
      store.sessions = store.sessions.filter((session) => session.id !== sessionId);
      writeAuthSessions(store);
    }
    return send(res, 200, { ok: true }, { "Set-Cookie": authCookie("", { maxAgeMs: 0 }) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/password") {
    const currentUser = currentUserFromRequest(req);
    if (!currentUser) return fail(res, 401, "请先登录");
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (!verifyPassword(currentPassword, currentUser.passwordHash)) throw new Error("当前密码不正确");
    if (newPassword.length < 8) throw new Error("新密码至少 8 位");
    if (currentPassword === newPassword) throw new Error("新密码不能和当前密码相同");
    const store = readAuthUsers();
    const user = store.users.find((item) => item.id === currentUser.id);
    if (!user) throw new Error("用户不存在");
    user.passwordHash = passwordHash(newPassword);
    user.updatedAt = new Date().toISOString();
    writeAuthUsers(store);
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/profile") {
    const currentUser = currentUserFromRequest(req);
    if (!currentUser) return fail(res, 401, "请先登录");
    const user = saveUserProfile(currentUser.id, await readBody(req));
    return send(res, 200, { ok: true, user });
  }
  return fail(res, 404, "not found");
}

function redactSecretText(value = "") {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED_SK]")
    .replace(/ark-[A-Za-z0-9-]+/g, "[REDACTED_ARK_KEY]");
}

function appendVideoApiLog(entry = {}) {
  const safeEntry = JSON.parse(redactSecretText(JSON.stringify({ at: new Date().toISOString(), ...entry })));
  try {
    fs.appendFileSync(VIDEO_API_LOG_PATH, `${JSON.stringify(safeEntry)}\n`);
  } catch {
    // Logging must never break generation flow.
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = VIDEO_API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`视频网关请求超时（${Math.round(timeoutMs / 1000)} 秒）：${url}`);
      timeoutError.code = "VIDEO_API_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 80 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`invalid JSON: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function encodeId(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeId(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function decodeIdSafe(value) {
  try {
    return decodeId(value);
  } catch {
    return "";
  }
}

function safeSlug(value, fallback = "untitled") {
  const slug = String(value || "")
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function safeAssetSlug(value, fallback = "ASSET") {
  const slug = String(value || "")
    .trim()
    .replace(/['"]/g, "")
    .replace(/^(外景|内景|EXT\.?|INT\.?|INTERIOR|EXTERIOR)\s*[·.:-]?\s*/i, "")
    .replace(/\b(?:morning|night|day|dawn|dusk|evening|afternoon)\b/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

const ASSET_TYPE_META = {
  Character: {
    prefix: "C",
    suffix: "CHARACTER_SHEET",
    folder: "characters",
    scanType: "character",
    usage: "人物身份、脸、服装、体型和表演参考，不作为场景",
  },
  Scene: {
    prefix: "S",
    suffix: "WIDE_ESTABLISHING",
    folder: "scenes",
    scanType: "scene",
    usage: "场景、空间结构、光线和环境氛围参考，不作为人物或道具",
  },
  Prop: {
    prefix: "P",
    suffix: "PROP_REF",
    folder: "props",
    scanType: "prop",
    usage: "道具外观、材质和三视图参考，不扩展成场景",
  },
  Insert: {
    prefix: "I",
    suffix: "INSERT_REF",
    folder: "props",
    scanType: "insert",
    usage: "证据细节或插入镜头参考，不扩展成主场景",
  },
  Storyboard: {
    prefix: "SB",
    suffix: "PRODUCTION_BOARD",
    folder: "storyboards",
    scanType: "storyboard",
    usage:
      "Production Board 唯一视频参考：包含由正式人物、场景和道具资产生成的 9:16 竖版 3×3 九格镜头画面；直接承载身份、场景、动作、镜头节奏和剪辑出口",
  },
};

const PRODUCTION_BOARD_MAX_SECONDS = 15;
const STORYBOARD_MAX_SECONDS = PRODUCTION_BOARD_MAX_SECONDS;
// 一张 Production Board 讲一个完整的 ≤15 秒剧情单元;整张板是 9:16 竖版,固定 3×3 九格布局。
// 每一格都是竖版镜头构图:首格建立空间,末格保留剪辑出口,其余格连续推进人物、动作和反应。
const STORYBOARD_MIN_PANELS = 9;
const STORYBOARD_MAX_PANELS = 9;
const STORYBOARD_BOARD_COLUMNS = 3;
// 固定九格的 3 行布局;保留计算函数以兼容已持久化的历史面板数据。
function storyboardBoardRows(panelCount) {
  return Math.ceil(Math.max(STORYBOARD_MIN_PANELS, Math.min(STORYBOARD_MAX_PANELS, panelCount)) / STORYBOARD_BOARD_COLUMNS);
}
const VIDEO_MIN_SECONDS = 4;
const VIDEO_MAX_SECONDS = 15;
const VIDEO_MIN_EPISODE_SECONDS = 70;
const VIDEO_MAX_EPISODE_SECONDS = 90;
const VIDEO_DEFAULT_EPISODE_SECONDS = 75;
const VIDEO_TARGET_SECONDS = VIDEO_DEFAULT_EPISODE_SECONDS;

function normalizeAssetType(type, fallback = "Prop") {
  const raw = compactLine(type || "");
  if (/^character$/i.test(raw) || /^人物/.test(raw) || /^character\b/i.test(raw)) return "Character";
  if (/^scene$/i.test(raw) || /^场景/.test(raw) || /^environment\b/i.test(raw)) return "Scene";
  if (/^storyboards?$/i.test(raw) || /^九宫格/.test(raw) || /^故事[板版]/.test(raw) || /^分镜/.test(raw)) return "Storyboard";
  if (/^insert$/i.test(raw) || /^插入/.test(raw)) return "Insert";
  if (/^prop$/i.test(raw) || /^道具/.test(raw)) return "Prop";
  if (/^characters?$/i.test(raw)) return "Character";
  if (/^scenes?$/i.test(raw)) return "Scene";
  if (/^storyboards?$/i.test(raw)) return "Storyboard";
  if (/^props?$/i.test(raw)) return "Prop";
  return fallback;
}

function assetMeta(type) {
  return ASSET_TYPE_META[normalizeAssetType(type)] || ASSET_TYPE_META.Prop;
}

function assetUsageForType(type) {
  return assetMeta(type).usage;
}

function assetScanTypeForType(type) {
  return assetMeta(type).scanType;
}

function assetFolderForType(type) {
  return assetMeta(type).folder;
}

function inferAssetTypeFromName(name) {
  const base = path.basename(String(name || "")).replace(/\.(png|jpe?g|webp)$/i, "");
  if (/_CHARACTER_SHEET$/i.test(base)) return "Character";
  if (/_WIDE_ESTABLISHING$/i.test(base)) return "Scene";
  if (/_NINE_GRID_STORYBOARD$/i.test(base) || /_PRODUCTION_BOARD$/i.test(base)) return "Storyboard";
  if (/_INSERT_REF$/i.test(base)) return "Insert";
  if (/_PROP_REF$/i.test(base)) return "Prop";
  if (/^C\d{3}_/i.test(base)) return "Character";
  if (/^S\d{3}_/i.test(base)) return "Scene";
  if (/^SB\d{3}_/i.test(base)) return "Storyboard";
  if (/^I\d{3}_/i.test(base)) return "Insert";
  if (/^P\d{3}_/i.test(base)) return "Prop";
  return "";
}

function inferAssetTypeFromFolder(folderOrFile) {
  const folder = path.basename(String(folderOrFile || ""));
  if (/^characters?$/i.test(folder)) return "Character";
  if (/^scenes?$/i.test(folder)) return "Scene";
  if (/^storyboards?$/i.test(folder)) return "Storyboard";
  if (/^props?$/i.test(folder)) return "Prop";
  const parent = path.basename(path.dirname(String(folderOrFile || "")));
  if (/^characters?$/i.test(parent)) return "Character";
  if (/^scenes?$/i.test(parent)) return "Scene";
  if (/^storyboards?$/i.test(parent)) return "Storyboard";
  if (/^props?$/i.test(parent)) return "Prop";
  return "";
}

function resolveAssetIdentity({ declaredType = "", assetName = "", filePath = "" } = {}) {
  const declared = declaredType ? normalizeAssetType(declaredType, "") : "";
  const fromName = inferAssetTypeFromName(assetName || filePath);
  const fromFolder = inferAssetTypeFromFolder(filePath);
  const type = declared || (fromFolder === "Prop" && fromName === "Insert" ? "Insert" : fromName || fromFolder) || "Prop";
  const conflicts = [];
  if (declared && fromName && declared !== fromName) conflicts.push(`清单类型 ${declared} 与文件名类型 ${fromName} 不一致`);
  if (declared && fromFolder && declared !== fromFolder && !(fromFolder === "Prop" && declared === "Insert")) {
    conflicts.push(`清单类型 ${declared} 与文件夹类型 ${fromFolder} 不一致`);
  }
  if (fromName && fromFolder && fromName !== fromFolder && !(fromFolder === "Prop" && fromName === "Insert")) {
    conflicts.push(`文件名类型 ${fromName} 与文件夹类型 ${fromFolder} 不一致`);
  }
  return {
    type,
    scanType: assetScanTypeForType(type),
    folder: assetFolderForType(type),
    usage: assetUsageForType(type),
    inferred: { declared, fromName, fromFolder },
    valid: conflicts.length === 0,
    conflicts,
  };
}

function absMaybe(root, maybePath) {
  if (!maybePath) return "";
  return path.isAbsolute(maybePath) ? maybePath : path.join(root, maybePath);
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function allowedPath(filePath) {
  const resolved = path.resolve(filePath);
  return (
    isInside(APP_ROOT, resolved) ||
    isInside(SHORT_DRAMA_ROOT, resolved) ||
    isInside(CODEX_DOCUMENTS_ROOT, resolved)
  );
}

function readText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function canvasStateFileForProject(projectId = "") {
  const id = compactLine(projectId || "standalone") || "standalone";
  const digest = crypto.createHash("sha256").update(id).digest("hex").slice(0, 32);
  return path.join(CANVAS_STATE_DIR, `${digest}.json`);
}

function isStaleLivenessVerificationError(message = "") {
  return /真人核验超时|核验超时|重新创建链接/.test(String(message || ""));
}

function isDataImageUrl(value = "") {
  return /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(String(value || ""));
}

function clampCanvasAssetDimension(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function sanitizeCanvasState(body = {}) {
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const connections = Array.isArray(body.connections) ? body.connections : [];
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const viewport = body.viewport && typeof body.viewport === "object" ? body.viewport : {};
  const rawLivenessLibrary = body.livenessLibrary && typeof body.livenessLibrary === "object" ? body.livenessLibrary : null;
  const livenessGroupId = rawLivenessLibrary
    ? compactLine(rawLivenessLibrary.groupId || rawLivenessLibrary.group_id || "").slice(0, 160)
    : "";
  const livenessError = rawLivenessLibrary ? compactLine(rawLivenessLibrary.error || "").slice(0, 1000) : "";
  const livenessStatus = rawLivenessLibrary
    ? compactLine(rawLivenessLibrary.status || (livenessGroupId ? "active" : "idle")).slice(0, 40)
    : "";
  const normalizedLivenessStatus = livenessGroupId && livenessStatus === "failed" && isStaleLivenessVerificationError(livenessError)
    ? "active"
    : livenessStatus;
  const normalizedLivenessError = livenessGroupId && isStaleLivenessVerificationError(livenessError) ? "" : livenessError;
  return repairCanvasAssetReferences({
    version: 1,
    updatedAt: new Date().toISOString(),
    projectId: compactLine(body.projectId || "standalone"),
    name: compactLine(body.name || body.title || "").slice(0, 120),
    ownerUserId: compactLine(body.ownerUserId || "").slice(0, 120),
    scope: body.scope === "team" && compactLine(body.teamId || "") ? "team" : "personal",
    teamId: compactLine(body.teamId || "").slice(0, 120),
    lastModifiedByUserId: compactLine(body.lastModifiedByUserId || "").slice(0, 120),
    lastModifiedByUsername: compactLine(body.lastModifiedByUsername || "").slice(0, 120),
    nextNodeId: Math.max(1, Math.min(1000000, Math.round(Number(body.nextNodeId || 1)))),
    viewport: {
      x: Number.isFinite(Number(viewport.x)) ? Number(viewport.x) : 0,
      y: Number.isFinite(Number(viewport.y)) ? Number(viewport.y) : 0,
      scale: Number.isFinite(Number(viewport.scale)) ? Math.max(0.45, Math.min(1.8, Number(viewport.scale))) : 1,
    },
    assets: assets
      .filter((asset) => asset && typeof asset === "object")
      .slice(0, 300)
      .map((asset) => ({
        id: compactLine(asset.id).slice(0, 260),
        name: compactLine(asset.name).slice(0, 260),
        type: compactLine(asset.type).slice(0, 80),
        mediaType: compactLine(asset.mediaType).slice(0, 40),
        url: isDataImageUrl(asset.url) ? "" : String(asset.url || "").slice(0, 12000),
        previewUrl: isDataImageUrl(asset.previewUrl || asset.preview_url) ? "" : String(asset.previewUrl || asset.preview_url || "").slice(0, 12000),
        localUrl: compactLine(asset.localUrl || asset.local_url || "").slice(0, 12000),
        publicUrl: compactLine(asset.publicUrl || asset.public_url || "").slice(0, 12000),
        assetUrl: compactLine(asset.assetUrl || asset.asset_url || "").slice(0, 12000),
        virtualId: compactLine(asset.virtualId || asset.virtual_id || "").slice(0, 160),
        groupId: compactLine(asset.groupId || asset.group_id || "").slice(0, 160),
        libraryName: compactLine(asset.libraryName || asset.library_name || "").slice(0, 160),
        validationStatus: compactLine(asset.validationStatus || asset.validation_status || "").slice(0, 40),
        validationError: compactLine(asset.validationError || asset.validation_error || "").slice(0, 1000),
        assetStylePreset: compactLine(asset.assetStylePreset || asset.asset_style_preset || asset.stylePreset || "").slice(0, 80),
        assetStyleLabel: compactLine(asset.assetStyleLabel || asset.asset_style_label || asset.styleLabel || "").slice(0, 120),
        generationMode: compactLine(asset.generationMode || asset.generation_mode || "").slice(0, 80),
        aiGenerated: asset.aiGenerated === true,
        verificationType: compactLine(asset.verificationType || asset.verification_type || "").slice(0, 40),
        source: compactLine(asset.source).slice(0, 40),
        sourceVideoNodeId: compactLine(asset.sourceVideoNodeId || "").slice(0, 120),
        sourceVideoTaskId: compactLine(asset.sourceVideoTaskId || "").slice(0, 260),
        generatedAt: compactLine(asset.generatedAt || "").slice(0, 80),
        arkPersonAsset: asset.arkPersonAsset && typeof asset.arkPersonAsset === "object"
          ? {
              enabled: asset.arkPersonAsset.enabled === true,
              assetId: compactLine(asset.arkPersonAsset.assetId || "").slice(0, 200),
              assetUrl: /^asset:\/\//i.test(compactLine(asset.arkPersonAsset.assetUrl || ""))
                ? compactLine(asset.arkPersonAsset.assetUrl).slice(0, 260)
                : "",
              groupId: compactLine(asset.arkPersonAsset.groupId || "").slice(0, 200),
              status: compactLine(asset.arkPersonAsset.status || "").slice(0, 40),
              boundAt: compactLine(asset.arkPersonAsset.boundAt || "").slice(0, 80),
              error: compactLine(asset.arkPersonAsset.error || "").slice(0, 1000),
            }
          : undefined,
      }))
      .filter((asset) => asset.id && (asset.url || asset.previewUrl || asset.localUrl || asset.publicUrl || asset.assetUrl)),
    nodes: nodes
      .filter((node) => node && typeof node === "object")
      .slice(0, 200)
      .map((node) => ({
        id: compactLine(node.id).slice(0, 120),
        kind: ["image", "video", "asset"].includes(node.kind) ? node.kind : "image",
        source: compactLine(node.source || "").slice(0, 60),
        projectShotName: compactLine(node.projectShotName || node.shotName || "").slice(0, 260),
        videoPromptMode: compactLine(node.videoPromptMode || "").slice(0, 40),
        storyboardRefs: Array.isArray(node.storyboardRefs) ? node.storyboardRefs.map(compactLine).filter(Boolean).slice(0, 12) : [],
        storyboardGuidance: node.storyboardGuidance && typeof node.storyboardGuidance === "object" ? node.storyboardGuidance : undefined,
        x: Number.isFinite(Number(node.x)) ? Number(node.x) : 80,
        y: Number.isFinite(Number(node.y)) ? Number(node.y) : 80,
        width: node.kind === "asset"
          ? clampCanvasAssetDimension(node.width, 96, 520, 300)
          : node.kind === "image"
            ? clampCanvasAssetDimension(node.width, 240, 720, 360)
            : node.kind === "video"
              ? clampCanvasAssetDimension(node.width, CANVAS_VIDEO_MIN_WIDTH, CANVAS_VIDEO_MAX_WIDTH, CANVAS_VIDEO_DEFAULT_WIDTH)
              : undefined,
        height: node.kind === "asset"
          ? clampCanvasAssetDimension(node.height, 64, 420, 200)
          : node.kind === "video"
            ? clampCanvasAssetDimension(node.height, CANVAS_VIDEO_MIN_HEIGHT, CANVAS_VIDEO_MAX_HEIGHT, CANVAS_VIDEO_DEFAULT_HEIGHT)
            : undefined,
        // 持久化图片/视频节点的手动缩放标记,否则 reload 后 ratioSizedNodeDimensions 判 hasManualSize 失败,
        // 会用 ratio 预设尺寸覆盖用户拖动后的宽高(表现为"缩放被重置")。
        ratioManualSize: node.ratioManualSize === true,
        ratioLayoutRatio: compactLine(node.ratioLayoutRatio || "").slice(0, 16),
        assets: Array.isArray(node.assets) ? node.assets.map(compactLine).filter(Boolean).slice(0, 20) : [],
        prompt: String(node.prompt || "").slice(0, 20000),
        settings: node.settings && typeof node.settings === "object" ? node.settings : undefined,
        liveness: node.liveness && typeof node.liveness === "object" ? node.liveness : undefined,
        status: compactLine(node.status).slice(0, 40),
        statusMessage: String(node.statusMessage || "").slice(0, 2000),
        videoUrl: String(node.videoUrl || "").slice(0, 12000),
        // 图片节点的生成结果:必须持久化,否则刷新后 imageUrl 丢失→预览只剩占位符(无预览图)。
        imageUrl: String(node.imageUrl || "").slice(0, 12000),
        generatedAssetId: compactLine(node.generatedAssetId || "").slice(0, 120),
        videoLocalFile: compactLine(node.videoLocalFile || "").slice(0, 12000),
        taskId: compactLine(node.taskId).slice(0, 260),
        taskProvider: compactLine(node.taskProvider).slice(0, 80),
        submittedAt: compactLine(node.submittedAt || "").slice(0, 80),
        progress: node.progress === null ? null : Number.isFinite(Number(node.progress)) ? Number(node.progress) : undefined,
        startFrameUrl: String(node.startFrameUrl || "").slice(0, 12000),
        tailFrameSourceNodeId: compactLine(node.tailFrameSourceNodeId || "").slice(0, 120),
        tailFrameSourceName: compactLine(node.tailFrameSourceName || "").slice(0, 260),
        tailFrameReady: node.tailFrameReady === true,
        tailFrameUrl: String(node.tailFrameUrl || "").slice(0, 12000),
        tailFrameLocalFile: compactLine(node.tailFrameLocalFile || "").slice(0, 12000),
        tailFrameFileUrl: compactLine(node.tailFrameFileUrl || "").slice(0, 12000),
        tailFrameMessage: String(node.tailFrameMessage || "").slice(0, 2000),
      }))
      .filter((node) => node.id),
    connections: connections
      .filter((connection) => connection && typeof connection === "object")
      .slice(0, 400)
      .map((connection) => ({
        from: compactLine(connection.from).slice(0, 120),
        to: compactLine(connection.to).slice(0, 120),
      }))
      .filter((connection) => connection.from && connection.to),
    livenessLibrary:
      rawLivenessLibrary
        ? {
            name: compactLine(rawLivenessLibrary.name || "真人A").slice(0, 80),
            description: compactLine(rawLivenessLibrary.description || "").slice(0, 240),
            channelId: compactLine(rawLivenessLibrary.channelId || rawLivenessLibrary.channel_id || "").slice(0, 40),
            groupId: livenessGroupId,
            groupType: compactLine(rawLivenessLibrary.groupType || rawLivenessLibrary.group_type || "liveness_face").slice(0, 40),
            status: normalizedLivenessStatus,
            assetName: compactLine(rawLivenessLibrary.assetName || "portrait.jpg").slice(0, 80),
            assetUrl: compactLine(rawLivenessLibrary.assetUrl || rawLivenessLibrary.asset_url || "").slice(0, 12000),
            localAssetUrl: compactLine(rawLivenessLibrary.localAssetUrl || rawLivenessLibrary.local_asset_url || "").slice(0, 12000),
            publicAssetReady: rawLivenessLibrary.publicAssetReady === true,
            error: normalizedLivenessError,
            hiddenAssetUrls: Array.isArray(rawLivenessLibrary.hiddenAssetUrls)
              ? rawLivenessLibrary.hiddenAssetUrls.map(compactLine).filter(Boolean).slice(0, 200)
              : [],
            assets: Array.isArray(rawLivenessLibrary.assets)
              ? rawLivenessLibrary.assets
                  .filter((asset) => asset && typeof asset === "object")
                  .slice(0, 100)
                  .map((asset) => ({
                    virtualId: compactLine(asset.virtualId || asset.virtual_id || asset.id || "").slice(0, 160),
                    assetUrl: compactLine(asset.assetUrl || asset.asset_url || "").slice(0, 12000),
                    previewUrl: compactLine(asset.previewUrl || asset.preview_url || asset.url || "").slice(0, 12000),
                    groupId: compactLine(asset.groupId || asset.group_id || "").slice(0, 160),
                    name: compactLine(asset.name || asset.filename || "真人素材").slice(0, 160),
                    type: compactLine(asset.type || asset.assetType || asset.asset_type || "Image").slice(0, 40),
                    status: compactLine(asset.status || "").slice(0, 40),
                  }))
                  .filter((asset) => asset.assetUrl || asset.virtualId || asset.previewUrl)
              : [],
          }
        : undefined,
  }).state;
}

function canvasReferenceAssetKey(value = "") {
  const raw = compactLine(value);
  if (!raw) return "";
  const localName = raw.match(/^(?:local|localvid)_\d+_\d+_(.+)$/i)?.[1] || raw;
  let fileName = localName;
  try {
    fileName = path.basename(decodeURIComponent(new URL(localName, "http://localhost").pathname || ""));
  } catch {
    fileName = path.basename(localName);
  }
  return fileName
    .replace(/^[a-f0-9]{16}-/i, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// 上传完成后会保留原节点的 local_* ID；极少数历史保存会让该 ID 与资产列表脱节。
// 仅在文件身份唯一命中时修复，不能猜测或把同名素材错误连接到一起。
function repairCanvasAssetReferences(state = {}) {
  const assets = Array.isArray(state.assets) ? state.assets : [];
  const knownIds = new Set(assets.map((asset) => compactLine(asset?.id)).filter(Boolean));
  const candidatesByKey = new Map();
  for (const asset of assets) {
    const id = compactLine(asset?.id);
    if (!id) continue;
    const keys = new Set([
      asset.name,
      asset.url,
      asset.previewUrl || asset.preview_url,
      asset.localUrl || asset.local_url,
      asset.publicUrl || asset.public_url,
      id,
    ].map(canvasReferenceAssetKey).filter(Boolean));
    for (const key of keys) {
      const matches = candidatesByKey.get(key) || new Set();
      matches.add(id);
      candidatesByKey.set(key, matches);
    }
  }
  const resolveAssetId = (value = "") => {
    const id = compactLine(value);
    if (!id || knownIds.has(id)) return id;
    const matches = candidatesByKey.get(canvasReferenceAssetKey(id));
    return matches?.size === 1 ? [...matches][0] : id;
  };
  let changed = false;
  const nodes = (Array.isArray(state.nodes) ? state.nodes : []).map((node) => {
    if (!node || typeof node !== "object") return node;
    const assetsBefore = Array.isArray(node.assets) ? node.assets : [];
    const repairedAssets = [...new Set(assetsBefore.map(resolveAssetId))];
    const generatedAssetId = resolveAssetId(node.generatedAssetId || "");
    const settings = node.settings && typeof node.settings === "object" ? node.settings : null;
    const repairedSettings = settings
      ? {
          ...settings,
          firstFrameAssetId: resolveAssetId(settings.firstFrameAssetId || ""),
          lastFrameAssetId: resolveAssetId(settings.lastFrameAssetId || ""),
        }
      : settings;
    const nodeChanged =
      JSON.stringify(assetsBefore) !== JSON.stringify(repairedAssets) ||
      generatedAssetId !== compactLine(node.generatedAssetId || "") ||
      (settings && (
        repairedSettings.firstFrameAssetId !== compactLine(settings.firstFrameAssetId || "") ||
        repairedSettings.lastFrameAssetId !== compactLine(settings.lastFrameAssetId || "")
      ));
    if (!nodeChanged) return node;
    changed = true;
    return {
      ...node,
      assets: repairedAssets,
      generatedAssetId,
      ...(repairedSettings ? { settings: repairedSettings } : {}),
    };
  });
  return changed ? { state: { ...state, nodes }, changed: true } : { state, changed: false };
}

function validLocalCanvasVideoFile(value = "") {
  const file = path.resolve(compactLine(value));
  if (!file || !allowedPath(file) || !/\.(mp4|mov|webm)$/i.test(file)) return "";
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 1024 ? file : "";
  } catch {
    return "";
  }
}

function localCanvasVideoFileForNode(node = {}) {
  const candidates = [];
  for (const value of [node.videoLocalFile, node.videoUrl]) {
    const raw = compactLine(value);
    if (!raw) continue;
    candidates.push(localMediaPathFromUrl(raw), localFilePathFromUrl(raw));
    if (path.isAbsolute(raw)) candidates.push(raw);
  }
  const nodeId = safeSlug(node.id || "", "");
  if (nodeId) candidates.push(path.join(APP_ROOT, "09_tail_frames", `${nodeId}_src.mp4`));
  for (const candidate of candidates) {
    const file = validLocalCanvasVideoFile(candidate);
    if (file) return file;
  }
  return "";
}

function localCanvasVideoUrlForNode(node = {}) {
  const file = localCanvasVideoFileForNode(node);
  return file ? `/media?path=${encodeURIComponent(file)}` : "";
}

function persistMigratedCanvasDataUrl(dataUrl = "", asset = {}, index = 0) {
  const decoded = decodeDataImageUrl(dataUrl);
  if (!decoded) return "";
  return persistDecodedPublicAsset(decoded, asset.name || asset.id || `canvas-asset-${index + 1}`);
}

function persistDecodedPublicAsset(decoded, name = "canvas-asset") {
  if (!decoded?.buffer?.length || !decoded.ext) return "";
  const rawName = compactLine(name || "canvas-asset");
  const cleanName = safeSlug(path.basename(rawName, path.extname(rawName)) || "canvas-asset", "canvas-asset");
  const digest = crypto.createHash("sha256").update(decoded.buffer).digest("hex").slice(0, 16);
  const fileName = `${digest}-${cleanName}${decoded.ext}`;
  fs.mkdirSync(CANVAS_PUBLIC_ASSET_DIR, { recursive: true });
  const file = path.join(CANVAS_PUBLIC_ASSET_DIR, fileName);
  if (!fs.existsSync(file)) fs.writeFileSync(file, decoded.buffer);
  return `/public-assets/${encodeURIComponent(fileName)}`;
}

function migrateCanvasStateDataUrls(state = {}) {
  if (!state || typeof state !== "object") return { state, changed: false };
  let changed = false;
  const migrateAsset = (asset = {}, index = 0) => {
    if (!asset || typeof asset !== "object") return asset;
    const next = { ...asset };
    const dataUrl = isDataImageUrl(next.url) ? next.url : isDataImageUrl(next.previewUrl || next.preview_url) ? next.previewUrl || next.preview_url : "";
    if (!dataUrl) return next;
    const localUrl = persistMigratedCanvasDataUrl(dataUrl, next, index);
    if (!localUrl) return next;
    if (isDataImageUrl(next.url)) next.url = next.publicUrl || next.public_url || localUrl;
    if (isDataImageUrl(next.previewUrl || next.preview_url)) {
      next.previewUrl = localUrl;
      delete next.preview_url;
    }
    if (!next.previewUrl) next.previewUrl = localUrl;
    next.localUrl = next.localUrl || next.local_url || localUrl;
    delete next.local_url;
    changed = true;
    return next;
  };
  const nextState = { ...state };
  if (Array.isArray(state.assets)) {
    nextState.assets = state.assets.map(migrateAsset);
  }
  if (Array.isArray(state.nodes)) {
    const stateSavedAt = Date.parse(state.updatedAt || state.savedAt || "") || 0;
    nextState.nodes = state.nodes.map((node) => {
      if (!node || typeof node !== "object" || node.kind !== "video") return node;
      const next = { ...node };
      const recoveredVideoFile = localCanvasVideoFileForNode(next);
      const recoveredVideoUrl = localCanvasVideoUrlForNode(next);
      if (recoveredVideoUrl && next.videoUrl !== recoveredVideoUrl) {
        next.videoUrl = recoveredVideoUrl;
        next.videoLocalFile = recoveredVideoFile;
        next.status = "completed";
        next.progress = 100;
        next.statusMessage = "已恢复本地归档视频";
        changed = true;
      }
      if (next.videoUrl && next.status === "running") {
        next.status = "completed";
        next.statusMessage = next.statusMessage || "生成完成";
        next.progress = 100;
        changed = true;
      } else if (
        next.status === "running" &&
        compactLine(next.taskProvider || "").toLowerCase() === "gravitex" &&
        Number(next.progress) === 50
      ) {
        next.progress = null;
        changed = true;
      }
      const staleSubmitting =
        next.status === "running" &&
        !compactLine(next.taskId || "") &&
        !compactLine(next.videoUrl || "") &&
        /提交\s*Seedance|正在提交/i.test(compactLine(next.statusMessage || "")) &&
        (!stateSavedAt || Date.now() - stateSavedAt > 60 * 1000);
      if (staleSubmitting) {
        next.status = "idle";
        next.statusMessage = isAssetLibraryTimeoutMessage(next.statusMessage)
          ? "素材库请求超时，视频任务未提交；可稍后重试"
          : "上次提交未拿到 taskId，已停止；可重新生成";
        next.progress = 0;
        next.taskId = "";
        next.taskProvider = "";
        changed = true;
      }
      return next;
    });
  }
  if (state.livenessLibrary && typeof state.livenessLibrary === "object") {
    const library = { ...state.livenessLibrary };
    if (isDataImageUrl(library.assetUrl || library.asset_url)) {
      const localUrl = persistMigratedCanvasDataUrl(library.assetUrl || library.asset_url, { name: library.assetName || "liveness-asset" }, 0);
      if (localUrl) {
        library.assetUrl = library.publicUrl || "";
        library.localAssetUrl = library.localAssetUrl || localUrl;
        delete library.asset_url;
        changed = true;
      }
    }
    if (Array.isArray(library.assets)) {
      library.assets = library.assets.map(migrateAsset);
    }
    nextState.livenessLibrary = library;
  }
  const repaired = repairCanvasAssetReferences(nextState);
  return { state: repaired.state, changed: changed || repaired.changed };
}

function readCanvasState(projectId = "") {
  const file = canvasStateFileForProject(projectId);
  if (!fs.existsSync(file)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const migrated = migrateCanvasStateDataUrls(state);
    if (migrated.changed) fs.writeFileSync(file, JSON.stringify(sanitizeCanvasState(migrated.state), null, 2));
    return migrated.state;
  } catch {
    return null;
  }
}

function canvasStatesForEpisodeRoot(episodeRoot = "") {
  const root = path.resolve(episodeRoot || "");
  if (!root || !fs.existsSync(CANVAS_STATE_DIR)) return [];
  const states = [];
  for (const file of fs.readdirSync(CANVAS_STATE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(CANVAS_STATE_DIR, file), "utf8"));
      const canvasEpisodeRoot = episodeRootFromCanvasProjectId(state.projectId || "");
      if (canvasEpisodeRoot && path.resolve(canvasEpisodeRoot) === root) states.push(state);
    } catch {
      // Ignore malformed canvas state files.
    }
  }
  return states.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function canvasVideoFallbackForShot(episodeRoot = "", shotName = "") {
  const cleanShotName = compactLine(shotName || "");
  if (!cleanShotName) return null;
  for (const state of canvasStatesForEpisodeRoot(episodeRoot)) {
    const node = (Array.isArray(state.nodes) ? state.nodes : []).find((item) => {
      if (!item || item.kind !== "video") return false;
      return compactLine(item.projectShotName || item.shotName || "") === cleanShotName;
    });
    if (!node) continue;
    const settings = node.settings && typeof node.settings === "object" ? node.settings : {};
    const assetsById = new Map((Array.isArray(state.assets) ? state.assets : []).filter((asset) => asset?.id).map((asset) => [asset.id, asset]));
    const assets = (Array.isArray(node.assets) ? node.assets : [])
      .map((assetId) => assetsById.get(assetId))
      .filter(Boolean)
      .map((asset) => ({
        ...asset,
        name: compactLine(asset.name || asset.id || ""),
        assetName: compactLine(asset.assetName || asset.name || asset.id || ""),
        publicUrl: compactLine(asset.publicUrl || asset.public_url || asset.url || ""),
        localAssetUrl: compactLine(asset.localAssetUrl || asset.localUrl || asset.local_url || ""),
        assetUrl: compactLine(asset.assetUrl || asset.asset_url || ""),
        validationStatus: compactLine(asset.validationStatus || ""),
      }));
    const shot = {
      name: cleanShotName,
      prompt: String(node.prompt || "").trim(),
      videoPrompt: String(node.prompt || "").trim(),
      refs: (Array.isArray(node.assets) ? node.assets : []).filter(Boolean),
      duration: normalizeSeedanceDuration(settings.duration || 5),
      useTailFrame: !!node.startFrameUrl || !!node.tailFrameSourceName,
      tailFrameSource: compactLine(node.tailFrameSourceName || ""),
      videoPromptMode: compactLine(node.videoPromptMode || ""),
    };
    const config = {
      episodeRoot,
      videoCanvasId: state.projectId || "",
      canvasProjectId: state.projectId || "",
      modelName: normalizeVideoConfigModelName(settings.model || DEFAULT_VIDEO_CONFIG_MODEL),
      settings: {
        ratio: settings.ratio || "9:16",
        resolution: settings.resolution || "720p",
        enableSound: settings.generateAudio === false ? "off" : "on",
        videoCanvasId: state.projectId || "",
      },
      assets,
      shots: [shot],
    };
    return { state, node, shot, config };
  }
  return null;
}

function persistCanvasState(state) {
  const file = canvasStateFileForProject(state.projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return state;
}

function writeCanvasState(body = {}, user = null) {
  const migrated = migrateCanvasStateDataUrls(body);
  const incoming = sanitizeCanvasState(migrated.state);
  const previous = readCanvasState(incoming.projectId) || null;
  const baseUpdatedAt = compactLine(body.baseUpdatedAt || "");
  const preserveMissingNodes = !!(
    previous &&
    baseUpdatedAt &&
    previous.updatedAt &&
    baseUpdatedAt !== previous.updatedAt
  );
  const standaloneCanvas = !episodeRootFromCanvasProjectId(incoming.projectId) && incoming.projectId !== "standalone";
  if (standaloneCanvas && user?.id) {
    if (previous && !userCanAccessCanvasState(user, previous)) {
      const error = new Error("canvas not found");
      error.statusCode = 404;
      throw error;
    }
    incoming.ownerUserId = previous?.ownerUserId || user.id;
    incoming.scope = previous ? canvasScopeRecord(previous).scope : "personal";
    incoming.teamId = previous ? canvasScopeRecord(previous).teamId : "";
    incoming.lastModifiedByUserId = user.id;
    incoming.lastModifiedByUsername = user.username || "";
  }
  const state = mergeCanvasStateForWrite(previous, incoming, { preserveMissingNodes });
  return persistCanvasState(state);
}

// 列出"独立画布"（不绑定剧本项目的画布），按 owner 隔离。
function blankCanvasCover(state = {}) {
  const nodes = Array.isArray(state.nodes) ? state.nodes : [];
  for (const node of nodes) {
    if (node && node.kind === "image" && node.imageUrl && !isDataImageUrl(node.imageUrl)) return String(node.imageUrl);
  }
  const assets = Array.isArray(state.assets) ? state.assets : [];
  for (const asset of assets) {
    const url = asset.previewUrl || asset.publicUrl || asset.url || asset.localUrl || "";
    if (url && !isDataImageUrl(url)) return String(url);
  }
  return "";
}

// 项目卡封面提速:把封面原图 URL 改写成本地小缩略图(几十 KB webp),根治"打开项目页首屏加载 2-3MB 原图很慢"。
// 仅当本地有对应文件时才改写(公网 TOS 图按文件名回映本地镜像;/media 图直接加 thumb),否则原样返回,绝不制造 404。
function coverThumbUrl(cover = "", width = 360) {
  const url = String(cover || "");
  if (!url || isDataImageUrl(url)) return url;
  try {
    // /media?path=<abs> —— 本地文件,直接挂 thumb 参数(端点已支持,失败自动回退原图)。
    if (url.startsWith("/media?") || url.includes("/media?path=")) {
      return url.includes("thumb=") ? url : `${url}${url.includes("?") ? "&" : "?"}thumb=${width}`;
    }
    // 公网/本地 public-assets:按 basename 找本地镜像;有才改写成本地 thumb 端点。
    const m = url.match(/public-assets\/([^/?#]+)/);
    if (m && m[1]) {
      const fileName = decodeURIComponent(m[1]);
      if (fs.existsSync(path.join(CANVAS_PUBLIC_ASSET_DIR, fileName))) {
        return `/public-assets/${encodeURIComponent(fileName)}?thumb=${width}`;
      }
    }
  } catch {
    // 任何异常都退回原图,保证封面始终可显示
  }
  return url;
}

// 资产图页面提速:下发画布 state 时,把每个资产/图片节点的 previewUrl 改写成本地小缩略图。
// 只动"下发副本"的 previewUrl,不改存储、不改 url(生成/放大/下载仍用全清原图)。宽 640 兼顾清晰与体积。
function canvasStateWithThumbPreviews(state = {}) {
  if (!state || typeof state !== "object") return state;
  const out = { ...state };
  if (Array.isArray(state.assets)) {
    out.assets = state.assets.map((a) => {
      if (!a || typeof a !== "object" || !a.previewUrl) return a;
      const thumb = coverThumbUrl(a.previewUrl, 640);
      return thumb === a.previewUrl ? a : { ...a, previewUrl: thumb };
    });
  }
  if (Array.isArray(state.nodes)) {
    out.nodes = state.nodes.map((n) => {
      if (!n || typeof n !== "object" || n.kind !== "image" || !n.previewUrl) return n;
      const thumb = coverThumbUrl(n.previewUrl, 640);
      return thumb === n.previewUrl ? n : { ...n, previewUrl: thumb };
    });
  }
  return out;
}

function canvasScopeRecord(state = {}) {
  return {
    ownerUserId: compactLine(state.ownerUserId || ""),
    scope: state.scope === "team" && state.teamId ? "team" : "personal",
    teamId: compactLine(state.teamId || ""),
  };
}

function userCanAccessCanvasState(user = {}, state = {}) {
  return canAccessResource({
    user,
    record: canvasScopeRecord(state),
    membershipForUser: membershipRecordForUser,
  });
}

function userCanDeleteCanvasState(user = {}, state = {}) {
  return canDeleteResource({
    user,
    record: canvasScopeRecord(state),
    membershipForUser: membershipRecordForUser,
  });
}

function blankCanvasSummary(state = {}, user = {}) {
  const scope = canvasScopeRecord(state);
  return {
    id: compactLine(state.projectId || ""),
    name: compactLine(state.name || "") || "未命名画布",
    updatedAt: state.updatedAt || "",
    nodeCount: Array.isArray(state.nodes) ? state.nodes.length : 0,
    cover: coverThumbUrl(blankCanvasCover(state)),
    scope: scope.scope,
    teamId: scope.teamId,
    canDelete: userCanDeleteCanvasState(user, state),
    progress: {
      lastModifiedByUserId: compactLine(state.lastModifiedByUserId || state.ownerUserId || ""),
      lastModifiedByUsername: compactLine(state.lastModifiedByUsername || ""),
      lastModifiedAt: state.updatedAt || "",
    },
  };
}

function listBlankCanvases(user = {}) {
  if (!fs.existsSync(CANVAS_STATE_DIR)) return [];
  const list = [];
  for (const file of fs.readdirSync(CANVAS_STATE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const state = JSON.parse(fs.readFileSync(path.join(CANVAS_STATE_DIR, file), "utf8"));
      const pid = compactLine(state.projectId || "");
      if (!pid || pid === "standalone" || episodeRootFromCanvasProjectId(pid)) continue;
      if (!userCanAccessCanvasState(user, state)) continue;
      list.push(blankCanvasSummary(state, user));
    } catch {
      // ignore malformed
    }
  }
  return list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function renameBlankCanvas(projectId = "", name = "", user = {}) {
  const pid = compactLine(projectId || "");
  if (!pid || pid === "standalone" || episodeRootFromCanvasProjectId(pid)) throw new Error("不能重命名该画布");
  const file = canvasStateFileForProject(pid);
  if (!fs.existsSync(file)) throw new Error("画布不存在");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!userCanAccessCanvasState(user, state)) throw new Error("无权重命名该画布");
  state.name = compactLine(name || "").slice(0, 120) || "未命名画布";
  state.updatedAt = new Date().toISOString();
  state.lastModifiedByUserId = user.id || state.lastModifiedByUserId || "";
  state.lastModifiedByUsername = user.username || state.lastModifiedByUsername || "";
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return { ok: true, id: pid, name: state.name };
}

function deleteBlankCanvas(projectId = "", user = {}) {
  const pid = compactLine(projectId || "");
  if (!pid || pid === "standalone" || episodeRootFromCanvasProjectId(pid)) throw new Error("不能删除该画布");
  const file = canvasStateFileForProject(pid);
  if (fs.existsSync(file)) {
    try {
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!userCanDeleteCanvasState(user, state)) {
        const error = new Error("canvas not found");
        error.statusCode = 404;
        throw error;
      }
    } catch (error) {
      if (error?.statusCode) throw error;
    }
    fs.unlinkSync(file);
  }
  return { ok: true, id: pid };
}

function duplicateBlankCanvasAsPersonal(state, user) {
  return writeCanvasState({
    ...state,
    projectId: `canvas_${crypto.randomUUID()}`,
    name: `${compactLine(state.name || "未命名画布")} - 个人副本`,
    ownerUserId: user.id,
    scope: "personal",
    teamId: "",
    lastModifiedByUserId: user.id,
    lastModifiedByUsername: user.username || "",
  }, user);
}

function syncCanvasStateFromProjectSnapshots(projectId = "") {
  const episodeRoot = episodeRootFromCanvasProjectId(projectId);
  if (!episodeRoot) return null;
  const configRecord = readVideoConfig(episodeRoot);
  const config = { ...(configRecord?.data || {}), episodeRoot };
  clearResolvedVideoReferenceFailures(episodeRoot, config, currentRunNamespace(episodeRoot, config));
  const shots = Array.isArray(config.shots) ? config.shots : [];
  if (!shots.length) return readCanvasState(projectId);
  syncProjectShotsToCanvasState(episodeRoot, config, shots);
  return readCanvasState(projectId);
}

function mergeCanvasAssetState(existing = {}, incoming = {}) {
  const existingActive = String(existing.validationStatus || "").toLowerCase() === "active" && /^asset:\/\//i.test(existing.assetUrl || "");
  const incomingActive = String(incoming.validationStatus || "").toLowerCase() === "active" && /^asset:\/\//i.test(incoming.assetUrl || "");
  const existingReferenceUrl = compactLine(existing.publicUrl || existing.public_url || existing.url || existing.previewUrl || existing.preview_url || existing.localUrl || existing.local_url || "");
  const incomingReferenceUrl = compactLine(incoming.publicUrl || incoming.public_url || incoming.url || incoming.previewUrl || incoming.preview_url || incoming.localUrl || incoming.local_url || "");
  // A browser may save a local blob preview after it has been stripped for persistence.
  // That empty record is stale when this asset ID already has an uploaded URL; retaining
  // the stable URLs keeps connected image nodes from submitting zero reference images.
  if (existingReferenceUrl && !incomingReferenceUrl) {
    return {
      ...existing,
      ...incoming,
      url: existing.url || existing.publicUrl || existing.localUrl || "",
      previewUrl: existing.previewUrl || existing.localUrl || existing.publicUrl || existing.url || "",
      publicUrl: existing.publicUrl || existing.public_url || "",
      localUrl: existing.localUrl || existing.local_url || "",
      uploading: false,
      uploadFailed: false,
      uploadMessage: "",
    };
  }
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

function isStaleVideoFailureMessage(message = "") {
  return /content\[\d+\]\.image_url|素材库验证未完成|InputImageSensitiveContentDetected|PrivacyInformation|隐私信息/i.test(String(message || ""));
}

function isAssetLibraryTimeoutMessage(message = "") {
  return /\/v1\/assets|素材库|VIDEO_API_TIMEOUT|请求超时|网关请求超时/i.test(String(message || ""));
}

function mergeCanvasStateForWrite(previous, incoming, options = {}) {
  if (!previous || !incoming) return incoming;
  const preserveMissingNodes = options.preserveMissingNodes === true;
  const previousAssets = new Map((previous.assets || []).map((asset) => [asset.id, asset]));
  const incomingReferenceKeys = new Set();
  for (const node of Array.isArray(incoming.nodes) ? incoming.nodes : []) {
    for (const id of Array.isArray(node?.assets) ? node.assets : []) {
      const key = canvasReferenceAssetKey(id);
      if (key) incomingReferenceKeys.add(key);
    }
    for (const id of [node?.generatedAssetId, node?.settings?.firstFrameAssetId, node?.settings?.lastFrameAssetId]) {
      const key = canvasReferenceAssetKey(id);
      if (key) incomingReferenceKeys.add(key);
    }
  }
  const assets = (incoming.assets || []).map((asset) => {
    const existing = previousAssets.get(asset.id);
    if (!existing) return asset;
    const merged = mergeCanvasAssetState(existing, asset);
    return {
      ...merged,
      assetStylePreset: merged.assetStylePreset || asset.assetStylePreset || existing.assetStylePreset || "",
      assetStyleLabel: merged.assetStyleLabel || asset.assetStyleLabel || existing.assetStyleLabel || "",
    };
  });
  const knownAssetIds = new Set(assets.map((asset) => compactLine(asset?.id)).filter(Boolean));
  for (const asset of previousAssets.values()) {
    const id = compactLine(asset?.id);
    if (!id || knownAssetIds.has(id)) continue;
    const keys = [asset.id, asset.name, asset.url, asset.previewUrl, asset.localUrl, asset.publicUrl]
      .map(canvasReferenceAssetKey)
      .filter(Boolean);
    if (!keys.some((key) => incomingReferenceKeys.has(key))) continue;
    assets.push(asset);
    knownAssetIds.add(id);
  }
  const previousNodes = new Map((previous.nodes || []).map((node) => [node.id, node]));
  const mergeCanvasVideoNodeState = (existing = {}, node = {}) => {
    const existingTaskId = compactLine(existing.taskId || "");
    const nodeTaskId = compactLine(node.taskId || "");
    const existingSubmittedAt = Date.parse(existing.submittedAt || "") || 0;
    const nodeSubmittedAt = Date.parse(node.submittedAt || "") || 0;
    const submittedGenerationChanged = !!(existingSubmittedAt && nodeSubmittedAt && existingSubmittedAt !== nodeSubmittedAt);
    const taskGenerationChanged = !!(existingTaskId && nodeTaskId && existingTaskId !== nodeTaskId);
    let generationSource = null;
    if (submittedGenerationChanged) {
      generationSource = nodeSubmittedAt > existingSubmittedAt ? node : existing;
    } else if (taskGenerationChanged) {
      generationSource = preserveMissingNodes ? existing : node;
    } else if (nodeSubmittedAt && !existingSubmittedAt) {
      generationSource = node;
    } else if (existingSubmittedAt && !nodeSubmittedAt && preserveMissingNodes) {
      generationSource = existing;
    }
    if (generationSource) {
      const generationHasTail = generationSource.tailFrameReady === true && (generationSource.tailFrameUrl || generationSource.tailFrameLocalFile || generationSource.tailFrameFileUrl);
      return {
        status: generationSource.status || "idle",
        statusMessage: generationHasTail ? generationSource.statusMessage || "视频已生成，尾帧已就绪" : generationSource.statusMessage || "",
        taskId: generationSource.taskId || "",
        taskProvider: generationSource.taskProvider || "",
        submittedAt: generationSource.submittedAt || "",
        progress: generationSource.progress ?? null,
        videoUrl: generationSource.videoUrl || "",
        videoLocalFile: generationSource.videoLocalFile || "",
        startFrameUrl: generationSource.startFrameUrl || "",
        tailFrameSourceNodeId: generationSource.tailFrameSourceNodeId || "",
        tailFrameSourceName: generationSource.tailFrameSourceName || "",
        tailFrameReady: generationHasTail === true,
        tailFrameUrl: generationHasTail ? generationSource.tailFrameUrl || "" : "",
        tailFrameLocalFile: generationHasTail ? generationSource.tailFrameLocalFile || "" : "",
        tailFrameFileUrl: generationHasTail ? generationSource.tailFrameFileUrl || "" : "",
        tailFrameMessage: generationHasTail ? "" : generationSource.tailFrameMessage || "",
      };
    }
    const existingHasTail = existing.tailFrameReady === true && (existing.tailFrameUrl || existing.tailFrameLocalFile || existing.tailFrameFileUrl);
    const nodeHasTail = node.tailFrameReady === true && (node.tailFrameUrl || node.tailFrameLocalFile || node.tailFrameFileUrl);
    const tailSource = existingHasTail ? existing : nodeHasTail ? node : {};
    const existingCompleted = (existing.status === "completed" || existing.videoUrl) && existing.videoUrl;
    const nodeCompleted = (node.status === "completed" || node.videoUrl) && node.videoUrl;
    const completedSource = existingCompleted ? existing : nodeCompleted ? node : {};
    return {
      status: completedSource.status || node.status || existing.status || "idle",
      statusMessage:
        tailSource.tailFrameReady === true
          ? completedSource.statusMessage || tailSource.statusMessage || "视频已生成，尾帧已就绪"
          : completedSource.statusMessage || node.statusMessage || existing.statusMessage || "",
      taskId: completedSource.taskId || node.taskId || existing.taskId || "",
      taskProvider: completedSource.taskProvider || node.taskProvider || existing.taskProvider || "",
      submittedAt: completedSource.submittedAt || node.submittedAt || existing.submittedAt || "",
      progress: completedSource.progress ?? node.progress ?? existing.progress ?? null,
      videoUrl: completedSource.videoUrl || node.videoUrl || existing.videoUrl || "",
      videoLocalFile: completedSource.videoLocalFile || node.videoLocalFile || existing.videoLocalFile || "",
      startFrameUrl: node.startFrameUrl || existing.startFrameUrl || "",
      tailFrameSourceNodeId: node.tailFrameSourceNodeId || existing.tailFrameSourceNodeId || "",
      tailFrameSourceName: node.tailFrameSourceName || existing.tailFrameSourceName || "",
      tailFrameReady: tailSource.tailFrameReady === true ? true : node.tailFrameReady === true || existing.tailFrameReady === true,
      tailFrameUrl: tailSource.tailFrameUrl || node.tailFrameUrl || existing.tailFrameUrl || "",
      tailFrameLocalFile: tailSource.tailFrameLocalFile || node.tailFrameLocalFile || existing.tailFrameLocalFile || "",
      tailFrameFileUrl: tailSource.tailFrameFileUrl || node.tailFrameFileUrl || existing.tailFrameFileUrl || "",
      tailFrameMessage: tailSource.tailFrameReady === true ? "" : node.tailFrameMessage || existing.tailFrameMessage || "",
    };
  };
  const nodes = (incoming.nodes || []).map((node) => {
    const existing = previousNodes.get(node.id);
    const incomingFakeSubmitting =
      node?.kind === "video" &&
      node.status === "running" &&
      !compactLine(node.taskId || "") &&
      !compactLine(node.videoUrl || "") &&
      /提交\s*Seedance|正在提交/i.test(compactLine(node.statusMessage || ""));
    if (!existing) return node;
    const incomingSubmissionIsNewer =
      (Date.parse(node.submittedAt || "") || 0) > (Date.parse(existing.submittedAt || "") || 0);
    if (incomingFakeSubmitting && !incomingSubmissionIsNewer && existing.status === "failed" && existing.statusMessage) {
      return existing;
    }
    const incomingStaleFailure = node.status === "failed" && isStaleVideoFailureMessage(node.statusMessage);
    const existingClearedFailure = existing.status !== "failed" && isStaleVideoFailureMessage(node.statusMessage);
    if (incomingStaleFailure && existingClearedFailure) {
      const videoState = mergeCanvasVideoNodeState(existing, node);
      return {
        ...node,
        source: existing.source || node.source || "",
        projectShotName: existing.projectShotName || node.projectShotName || "",
        videoPromptMode: existing.videoPromptMode || node.videoPromptMode || "",
        storyboardRefs: Array.isArray(node.storyboardRefs) && node.storyboardRefs.length ? node.storyboardRefs : existing.storyboardRefs || [],
        storyboardGuidance: node.storyboardGuidance || existing.storyboardGuidance || undefined,
        prompt: promptHasStoryContent(existing.prompt) && !promptHasStoryContent(node.prompt) ? existing.prompt : node.prompt,
        ...videoState,
      };
    }
    if (["running", "completed"].includes(existing.status) && node.status !== existing.status && existing.taskId) {
      const videoState = mergeCanvasVideoNodeState(existing, node);
      return {
        ...node,
        source: existing.source || node.source || "",
        projectShotName: existing.projectShotName || node.projectShotName || "",
        videoPromptMode: existing.videoPromptMode || node.videoPromptMode || "",
        storyboardRefs: Array.isArray(node.storyboardRefs) && node.storyboardRefs.length ? node.storyboardRefs : existing.storyboardRefs || [],
        storyboardGuidance: node.storyboardGuidance || existing.storyboardGuidance || undefined,
        prompt: promptHasStoryContent(existing.prompt) && !promptHasStoryContent(node.prompt) ? existing.prompt : node.prompt,
        ...videoState,
      };
    }
    const videoState = node.kind === "video" ? mergeCanvasVideoNodeState(existing, node) : {};
    return {
      ...node,
      source: existing.source || node.source || "",
      projectShotName: existing.projectShotName || node.projectShotName || "",
      videoPromptMode: existing.videoPromptMode || node.videoPromptMode || "",
      storyboardRefs: Array.isArray(node.storyboardRefs) && node.storyboardRefs.length ? node.storyboardRefs : existing.storyboardRefs || [],
      storyboardGuidance: node.storyboardGuidance || existing.storyboardGuidance || undefined,
      prompt: promptHasStoryContent(existing.prompt) && !promptHasStoryContent(node.prompt) ? existing.prompt : node.prompt,
      ...videoState,
    };
  });
  if (preserveMissingNodes) {
    const knownNodeIds = new Set(nodes.map((node) => compactLine(node?.id)).filter(Boolean));
    for (const node of previousNodes.values()) {
      const id = compactLine(node?.id);
      if (!id || knownNodeIds.has(id)) continue;
      nodes.push(node);
      knownNodeIds.add(id);
    }
    const referencedAssetKeys = new Set();
    for (const node of nodes) {
      for (const id of Array.isArray(node?.assets) ? node.assets : []) {
        const key = canvasReferenceAssetKey(id);
        if (key) referencedAssetKeys.add(key);
      }
      for (const id of [node?.generatedAssetId, node?.settings?.firstFrameAssetId, node?.settings?.lastFrameAssetId]) {
        const key = canvasReferenceAssetKey(id);
        if (key) referencedAssetKeys.add(key);
      }
    }
    for (const asset of previousAssets.values()) {
      const id = compactLine(asset?.id);
      if (!id || knownAssetIds.has(id)) continue;
      const keys = [asset.id, asset.name, asset.url, asset.previewUrl, asset.localUrl, asset.publicUrl]
        .map(canvasReferenceAssetKey)
        .filter(Boolean);
      if (!keys.some((key) => referencedAssetKeys.has(key))) continue;
      assets.push(asset);
      knownAssetIds.add(id);
    }
  }
  const connections = Array.isArray(incoming.connections) ? [...incoming.connections] : [];
  if (preserveMissingNodes) {
    const knownConnections = new Set(connections.map((connection) => `${connection?.from || ""}:${connection?.to || ""}`));
    const knownNodeIds = new Set(nodes.map((node) => compactLine(node?.id)).filter(Boolean));
    for (const connection of Array.isArray(previous.connections) ? previous.connections : []) {
      const from = compactLine(connection?.from);
      const to = compactLine(connection?.to);
      const key = `${from}:${to}`;
      if (!from || !to || !knownNodeIds.has(from) || !knownNodeIds.has(to) || knownConnections.has(key)) continue;
      connections.push({ from, to });
      knownConnections.add(key);
    }
  }
  return repairCanvasAssetReferences({
    ...incoming,
    name: incoming.name || previous.name || "",
    ownerUserId: incoming.ownerUserId || previous.ownerUserId || "",
    assets,
    nodes,
    connections,
  }).state;
}

function stripSeedancePromptRules(markdown) {
  const text = String(markdown || "");
  if (!text.trim()) return "";
  return text
    .replace(/\n?##\s*提示词规则\s*\n[\s\S]*?(?=\n##\s+|$)/, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
    if (IMAGE_API_KEY_ENV_NAMES.includes(match[1])) imageApiKeyLoadedFrom = path.basename(filePath);
  }
}

function readLocalEnvValue(name) {
  for (const filePath of [path.join(APP_ROOT, ".env.local"), path.join(APP_ROOT, ".env")]) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || match[1] !== name) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  return "";
}

function loadCodexAuthEnv() {
  if (imageApiKey()) return;
  const authPath = path.join(HOME, ".codex/auth.json");
  if (!fs.existsSync(authPath)) return;
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const key = auth.OPENAI_API_KEY || auth.openai_api_key || auth.apiKey;
    if (key && typeof key === "string") {
      process.env.OPENAI_API_KEY = key;
      imageApiKeyLoadedFrom = "Codex auth";
    }
  } catch {
    // Ignore malformed auth files; the UI will show the missing-key state.
  }
}

function loadLocalEnv() {
  for (const file of [path.join(APP_ROOT, ".env.local"), path.join(APP_ROOT, ".env")]) loadLocalEnvFile(file);
  loadCodexAuthEnv();
}

loadLocalEnv();

function imageApiKey() {
  for (const name of IMAGE_API_KEY_ENV_NAMES) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function imageApiKeySource() {
  if (imageApiKeyLoadedFrom) return imageApiKeyLoadedFrom;
  for (const name of IMAGE_API_KEY_ENV_NAMES) {
    if (process.env[name]) return name;
  }
  return "";
}

function videoApiKeyNamesForProvider(provider = canvasVideoProvider()) {
  if (provider === "gravitex") return GRAVITEX_VIDEO_API_KEY_ENV_NAMES;
  if (provider === "byteplus") return BYTEPLUS_ARK_VIDEO_API_KEY_ENV_NAMES;
  return ARK_VIDEO_API_KEY_ENV_NAMES;
}

function videoApiKey(provider = canvasVideoProvider()) {
  for (const name of videoApiKeyNamesForProvider(provider)) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function videoApiKeySource(provider = canvasVideoProvider()) {
  for (const name of videoApiKeyNamesForProvider(provider)) {
    if (process.env[name]) return name;
  }
  return "";
}

function normalizeCanvasVideoProvider(value) {
  const raw = compactLine(value || "").toLowerCase();
  if (["gravitex", "gravitex-ai", "gravitexai", "seedance", "seedance-2", "seedance-2-0"].includes(raw)) return "gravitex";
  if (["byteplus", "byteplus-ark", "byteplus-modelark", "modelark", "ark-intl", "ark-international"].includes(raw)) return "byteplus";
  if (["ark", "volc", "volcengine", "volcengine-ark", "bytedance-ark"].includes(raw)) return "ark";
  return "ark";
}

function canvasVideoProvider() {
  return normalizeCanvasVideoProvider(process.env.CANVAS_VIDEO_PROVIDER || process.env.VIDEO_PROVIDER || "ark");
}

function canvasVideoProviderForBody(body = {}) {
  const modelMode = compactLine(body.modelMode || body.model || "");
  // 显式选择「海外火山」模型选项时,本次生成走 BytePlus ModelArk(ap-southeast 区),优先于全局默认与自动路由。
  if (/^seedance-2-0-byteplus$/i.test(modelMode)) return "byteplus";
  const sourceAssets = Array.isArray(body.assets) ? body.assets : [];
  if (isArkPersonTargetModel(modelMode) && sourceAssets.some((asset) => asset?.arkPersonAsset?.enabled === true)) return "ark";
  // 走配置的 provider(CANVAS_VIDEO_PROVIDER,默认 ark 火山方舟)。
  const configuredProvider = canvasVideoProvider();
  return configuredProvider;
}

function volcArkVideoBaseUrl() {
  return (
    process.env.VOLC_ARK_BASE_URL ||
    process.env.ARK_BASE_URL ||
    DEFAULT_VOLC_ARK_VIDEO_BASE_URL
  ).replace(/\/+$/, "");
}

function bytePlusArkVideoBaseUrl() {
  return (
    process.env.BYTEPLUS_ARK_BASE_URL ||
    process.env.BYTEPLUS_BASE_URL ||
    DEFAULT_BYTEPLUS_ARK_VIDEO_BASE_URL
  ).replace(/\/+$/, "");
}

function gravitexVideoBaseUrl() {
  return (process.env.GRAVITEX_VIDEO_BASE_URL || process.env.GRAVITEX_BASE_URL || DEFAULT_GRAVITEX_VIDEO_BASE_URL).replace(/\/+$/, "");
}

function canvasVideoBaseUrl() {
  const provider = canvasVideoProvider();
  if (provider === "gravitex") return gravitexVideoBaseUrl();
  if (provider === "byteplus") return bytePlusArkVideoBaseUrl();
  return volcArkVideoBaseUrl();
}

function runtimeStatus() {
  return {
    imageApiKeyConfigured: !!imageApiKey(),
    imageApiKeySource: imageApiKeySource(),
    videoApiKeyConfigured: !!videoApiKey(),
    videoApiKeySource: videoApiKeySource(),
    videoProvider:
      canvasVideoProvider() === "gravitex" ? "Gravitex Seedance 2.0" : canvasVideoProvider() === "byteplus" ? "BytePlus ModelArk Seedance" : "Volcengine Ark Seedance",
    videoBaseUrl: canvasVideoBaseUrl(),
    assetAnalyzerModel: defaultAssetAnalyzerModel(),
    assetAnalyzerAvailable: !!assetAnalyzerApiKey(),
    assetAnalyzerKeySource: assetAnalyzerKeySource(),
    storyboardAvailable: !!storyboardApiKey(),
    imageSkill: "APIKEY.FUN image-gen",
    imageSkillUrl: IMAGE_GEN_SKILL_URL,
    imageSkillScript: IMAGE_GEN_SKILL_SCRIPT,
    imageSkillInstalled: fs.existsSync(IMAGE_GEN_SKILL_SCRIPT),
  };
}

function uiRuntimeConfig() {
  return {
    // Explore 首页现在是默认入口；设置为 0 才回退到旧版项目首页。
    exploreEnabled: process.env.PIXEL_TOYS_EXPLORE_UI !== "0",
  };
}

function defaultAssetAnalyzerModel() {
  return process.env.ASSET_ANALYZER_MODEL || FALLBACK_ASSET_ANALYZER_MODEL;
}

function assetAuditModel(value) {
  return compactLine(value || process.env.ASSET_AUDIT_MODEL || "claude-haiku-4-5");
}

function normalizeAssetAnalyzerModel(value) {
  const raw = compactLine(value || defaultAssetAnalyzerModel());
  if (/^(rules|local|本地规则)$/i.test(raw)) return "rules";
  return ASSET_ANALYZER_MODEL_ALIASES[raw] || raw;
}

function defaultStoryboardModel() {
  return process.env.STORYBOARD_MODEL || FALLBACK_STORYBOARD_MODEL;
}

const SUPER_PIXEL_MAX_IMAGES_PER_MESSAGE = 8;
const SUPER_PIXEL_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPER_PIXEL_CLAUDE_MODELS = new Set(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);
const SUPER_PIXEL_GPT_MODELS = new Set(["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]);

function superPixelModelConfig(model) {
  if (SUPER_PIXEL_CLAUDE_MODELS.has(model)) {
    return { apiKey: assetAnalyzerApiKey(), kind: "asset" };
  }
  if (SUPER_PIXEL_GPT_MODELS.has(model)) {
    return { apiKey: compactLine(process.env.STORYBOARD_API_KEY || ""), kind: "storyboard" };
  }
  return null;
}

function truncateSuperPixelScript(text, maxLength = 24000) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  const headLength = Math.floor(maxLength * 0.75);
  const tailLength = maxLength - headLength;
  return `${value.slice(0, headLength)}\n\n[剧本过长，中间内容已截断]\n\n${value.slice(-tailLength)}`;
}

function normalizeStoryboardModel(value) {
  const raw = compactLine(value);
  if (/^(rules|local|本地规则)$/i.test(raw)) return "rules";
  return STORYBOARD_MODEL_ALIASES[raw] || raw || defaultStoryboardModel();
}

function openAiCompatBaseUrl(kind = "asset") {
  if (kind === "storyboard") {
    return (process.env.STORYBOARD_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.apikey.fun/v1").replace(/\/+$/, "");
  }
  return (process.env.ASSET_ANALYZER_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.apikey.fun/v1").replace(/\/+$/, "");
}

function openAiCompatUrl(pathname, kind = "asset") {
  const base = openAiCompatBaseUrl(kind);
  const pathWithSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (base.endsWith("/v1") && pathWithSlash.startsWith("/v1/")) return `${base}${pathWithSlash.slice(3)}`;
  return `${base}${pathWithSlash}`;
}

function assetAnalyzerApiKey() {
  if (runtimeAssetAnalyzerApiKey) return runtimeAssetAnalyzerApiKey;
  return process.env.ASSET_ANALYZER_API_KEY || imageApiKey();
}

function assetAnalyzerKeySource() {
  if (runtimeAssetAnalyzerApiKey) return runtimeAssetAnalyzerKeySource || "临时会话";
  if (process.env.ASSET_ANALYZER_API_KEY) return "ASSET_ANALYZER_API_KEY";
  return imageApiKeySource();
}

function assetAnalyzerTimeoutMs() {
  // Opus 解析整本剧本常需 1-3 分钟,60 秒太短会超时回退到本地粗规则(导致人物/场景乱、台词碎片被当人物)
  return Math.max(5000, Number(process.env.ASSET_ANALYZER_TIMEOUT_MS || 240000));
}

async function fetchAssetAnalyzer(url, options = {}) {
  const timeoutMs = assetAnalyzerTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`资产解析模型请求超时（${Math.round(timeoutMs / 1000)} 秒）：${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function storyboardApiKey() {
  return process.env.STORYBOARD_API_KEY || assetAnalyzerApiKey();
}

function storyboardKeySource() {
  if (process.env.STORYBOARD_API_KEY) return "STORYBOARD_API_KEY";
  return assetAnalyzerKeySource();
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, String(content || ""), "utf8");
}

function sha1Text(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseDocxDocumentXml(xml) {
  const paragraphs = [];
  const paragraphRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  const tokenRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  for (const [paragraph] of xml.matchAll(paragraphRe)) {
    const style = paragraph.match(/<w:pStyle\b[^>]*\b(?:w:val|val)\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const headingLevel = style.match(/^(?:heading|标题)\s*([1-3])$/i)?.[1] || "";
    let text = "";
    for (const token of paragraph.matchAll(tokenRe)) {
      if (token[0].startsWith("<w:tab")) {
        text += "\t";
      } else if (token[0].startsWith("<w:br")) {
        text += "\n";
      } else {
        text += decodeXmlText(token[1]);
      }
    }
    const paragraphText = text.trimEnd();
    paragraphs.push(
      headingLevel && paragraphText.trim()
        ? "#".repeat(Number(headingLevel)) + " " + paragraphText.trim()
        : paragraphText,
    );
  }
  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractDocxText(buffer, filename = "script.docx") {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-docx-"));
  const filePath = path.join(tempDir, safeSlug(filename.replace(/\.docx$/i, ""), "script") + ".docx");
  try {
    fs.writeFileSync(filePath, buffer);
    try {
      return execFileSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", filePath], {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60000,
      }).trim();
    } catch {
      const xml = execFileSync("/usr/bin/unzip", ["-p", filePath, "word/document.xml"], {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60000,
      });
      return parseDocxDocumentXml(xml);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractUploadedScript(body) {
  const filename = String(body.filename || "");
  const ext = path.extname(filename).toLowerCase();
  if (ext !== ".docx") throw new Error("only .docx extraction is supported here");
  const contentBase64 = String(body.contentBase64 || "");
  if (!contentBase64) throw new Error("missing docx content");
  const buffer = Buffer.from(contentBase64, "base64");
  if (!buffer.length) throw new Error("empty docx file");
  const text = extractDocxText(buffer, filename);
  if (!text.trim()) throw new Error("no readable text found in docx");
  return text;
}

function listDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true });
}

function walkFiles(dir, predicate, depth = 4) {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of listDir(dir)) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, predicate, depth - 1));
    if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function firstFile(dir, predicate) {
  const files = walkFiles(dir, predicate, 2).sort();
  return files[0] || "";
}

function episodeSlug(episodeRoot) {
  return path.basename(episodeRoot);
}

function episodeCode(slug) {
  const match = String(slug || "").match(/e(\d{1,3})/i);
  if (match) return `E${match[1].padStart(2, "0")}`;
  return safeSlug(slug, "E01").toUpperCase();
}

function projectDirForEpisode(episodeRoot) {
  const marker = `${path.sep}outputs${path.sep}`;
  const at = episodeRoot.indexOf(marker);
  return at === -1 ? path.dirname(episodeRoot) : episodeRoot.slice(0, at);
}

function projectDisplayName(episodeRoot) {
  const name = path.basename(projectDirForEpisode(episodeRoot));
  return compactLine(name.replace(/[_-]+/g, " ")) || "未命名项目";
}

function isGenericProjectDisplayName(value) {
  const name = compactLine(value || "").replace(/[_-]+/g, " ");
  return !name || /^(?:untitled(?: project)?(?:\s+\d{8,})?|video settings test|pixel toys)$/i.test(name);
}

function cleanProjectDisplayTitle(value) {
  const title = compactLine(value || "").replace(/^#\s*/, "");
  if (!title) return "";
  if (isGenericDraftTitle(title)) return "";
  if (/^shot\s+\d+\b/i.test(title)) return "";
  if (/^e\d{1,3}$/i.test(title)) return "";
  if (/^\s*[-*]\s+/.test(title)) return "";
  return title;
}

function persistProjectDisplayName(episodeRoot, displayName) {
  const clean = cleanProjectDisplayTitle(displayName);
  if (!clean) return readWorkflowState(episodeRoot);
  const previous = readWorkflowState(episodeRoot);
  return writeWorkflowState(episodeRoot, {
    ...previous,
    displayName: clean,
    projectDisplayName: clean,
    displayNameUpdatedAt: new Date().toISOString(),
  });
}

function projectDisplayNameForSummary(episodeRoot, { scriptTitle = "", manifest = null } = {}) {
  const slug = episodeSlug(episodeRoot);
  const workflow = readWorkflowState(episodeRoot);
  const persisted = cleanProjectDisplayTitle(workflow.displayName || workflow.projectDisplayName || "");
  if (persisted) return persisted;
  const folderName = projectDisplayName(episodeRoot);
  if (!isGenericProjectDisplayName(folderName)) return folderName;
  const manifestTitle = cleanProjectDisplayTitle(manifest?.title || "");
  if (manifestTitle && manifestTitle.toLowerCase() !== slug.toLowerCase() && manifestTitle.toLowerCase() !== episodeCode(slug).toLowerCase()) return manifestTitle;
  return "项目名称未设置";
}

function persistProjectOwner(episodeRoot, user = {}) {
  if (!user?.id) return readWorkflowState(episodeRoot);
  const previous = readWorkflowState(episodeRoot);
  if (previous.ownerUserId) return previous;
  return writeWorkflowState(episodeRoot, {
    ...previous,
    ownerUserId: user.id,
    ownerUsername: user.username || "",
    ownerAssignedAt: new Date().toISOString(),
  });
}

function projectOwner(episodeRoot) {
  const workflow = readWorkflowState(episodeRoot);
  return {
    ownerUserId: compactLine(workflow.ownerUserId || workflow.projectOwnerUserId || ""),
    ownerUsername: normalizeUsername(workflow.ownerUsername || workflow.projectOwnerUsername || ""),
  };
}

function userOwnsProject(user = {}, episodeRoot = "") {
  if (!user?.id) return false;
  const owner = projectOwner(episodeRoot);
  if (owner.ownerUserId) return owner.ownerUserId === user.id;
  if (owner.ownerUsername) return owner.ownerUsername === normalizeUsername(user.username);
  return false;
}

function projectScopeRecord(episodeRoot) {
  const workflow = readWorkflowState(episodeRoot);
  const owner = projectOwner(episodeRoot);
  return {
    ownerUserId: owner.ownerUserId,
    scope: workflow.scope === "team" && workflow.teamId ? "team" : "personal",
    teamId: compactLine(workflow.teamId || ""),
  };
}

function membershipRecordForUser(userId = "") {
  const membership = teamMembershipForUser(userId);
  return membership ? { teamId: membership.teamId, role: membership.role } : null;
}

function userCanAccessProject(user = {}, episodeRoot = "") {
  return canAccessResource({
    user,
    record: projectScopeRecord(episodeRoot),
    membershipForUser: membershipRecordForUser,
  });
}

function userCanDeleteProject(user = {}, episodeRoot = "") {
  return canDeleteResource({
    user,
    record: projectScopeRecord(episodeRoot),
    membershipForUser: membershipRecordForUser,
  });
}

function assertUserCanAccessProject(req, episodeRoot) {
  const user = currentUserFromRequest(req);
  if (!user) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }
  if (!userCanAccessProject(user, episodeRoot)) {
    const error = new Error("project not found");
    error.statusCode = 404;
    throw error;
  }
  return user;
}

function assertUserCanDeleteProject(req, episodeRoot) {
  const user = currentUserFromRequest(req);
  if (!user) {
    const error = new Error("请先登录");
    error.statusCode = 401;
    throw error;
  }
  if (!userCanDeleteProject(user, episodeRoot)) {
    const error = new Error("project not found");
    error.statusCode = 404;
    throw error;
  }
  return user;
}

function uniqueProjectDir(baseDir) {
  const resolvedBase = path.resolve(baseDir);
  if (!fs.existsSync(resolvedBase)) return resolvedBase;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  for (let index = 1; index <= 100; index += 1) {
    const suffix = index === 1 ? stamp : `${stamp}_${index}`;
    const candidate = `${resolvedBase}_${suffix}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${resolvedBase}_${stamp}_${crypto.randomUUID().slice(0, 8)}`;
}

function duplicateTeamProjectAsPersonal(episodeRoot, user) {
  const sourceProjectDir = projectDirForEpisode(episodeRoot);
  const targetProjectDir = uniqueProjectDir(`${sourceProjectDir}_personal_copy`);
  try {
    fs.cpSync(sourceProjectDir, targetProjectDir, { recursive: true, errorOnExist: true });
    const relativeEpisodeRoot = path.relative(sourceProjectDir, episodeRoot);
    const copiedEpisodeRoot = path.join(targetProjectDir, relativeEpisodeRoot);
    const copiedWorkflow = readWorkflowState(copiedEpisodeRoot);
    const timestamp = new Date().toISOString();
    writeWorkflowState(copiedEpisodeRoot, {
      ...copiedWorkflow,
      ownerUserId: user.id,
      ownerUsername: user.username,
      ownerAssignedAt: timestamp,
      scope: "personal",
      teamId: "",
      scopeChangedAt: timestamp,
      scopeChangedByUserId: user.id,
      lastModifiedByUserId: user.id,
      lastModifiedByUsername: user.username,
      lastModifiedAt: timestamp,
    });
    return copiedEpisodeRoot;
  } catch (error) {
    if (fs.existsSync(targetProjectDir)) fs.rmSync(targetProjectDir, { recursive: true, force: true });
    throw error;
  }
}

function uniqueEpisodeSlug(projectDir, slug) {
  const cleanSlug = safeSlug(slug || "e01", "e01");
  const outputsDir = path.join(projectDir, "outputs");
  const episodeRoot = path.join(outputsDir, cleanSlug);
  if (!fs.existsSync(episodeRoot)) return cleanSlug;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  for (let index = 1; index <= 100; index += 1) {
    const suffix = index === 1 ? stamp : `${stamp}_${index}`;
    const candidate = `${cleanSlug}_${suffix}`;
    if (!fs.existsSync(path.join(outputsDir, candidate))) return candidate;
  }
  return `${cleanSlug}_${stamp}_${crypto.randomUUID().slice(0, 8)}`;
}

function createEpisodeWorkspace(projectDir, slug, title = "") {
  const cleanSlug = safeSlug(slug || "e01", "e01");
  const episodeRoot = path.join(projectDir, "outputs", cleanSlug);
  const workDir = path.join(projectDir, "work", `${cleanSlug}_video_generation`);
  const dirs = [
    path.join(episodeRoot, "01_script"),
    path.join(episodeRoot, "02_storyboard"),
    path.join(episodeRoot, "03_asset_prompts"),
    path.join(episodeRoot, "04_assets", "characters"),
    path.join(episodeRoot, "04_assets", "scenes"),
    path.join(episodeRoot, "04_assets", "props"),
    path.join(episodeRoot, "04_assets", "storyboards"),
    path.join(episodeRoot, VIDEO_PROMPTS_DIR),
    path.join(episodeRoot, "06_videos", "raw"),
    path.join(episodeRoot, VIDEO_ASSET_UPLOAD_DIR),
    path.join(episodeRoot, VIDEO_TASK_DIR),
    path.join(episodeRoot, "09_tail_frames"),
    path.join(episodeRoot, "10_tail_frame_uploads"),
    workDir,
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

  const projectTitle = cleanProjectDisplayTitle(title) || cleanSlug;
  const scriptPath = path.join(episodeRoot, "01_script", `${cleanSlug}_script.md`);
  const storyboardPath = path.join(episodeRoot, "02_storyboard", `${cleanSlug}_storyboard.md`);
  const assetManifestPath = path.join(episodeRoot, "03_asset_prompts", `${cleanSlug}_asset_manifest.json`);
  const assetPromptsPath = path.join(episodeRoot, "03_asset_prompts", `${cleanSlug}_asset_prompts.md`);
  const seedancePromptsPath = path.join(episodeRoot, VIDEO_PROMPTS_DIR, `${cleanSlug}_seedance_prompts.md`);
  const configPath = path.join(workDir, `${cleanSlug}_skill_config.json`);

  if (!fs.existsSync(scriptPath)) writeText(scriptPath, `# ${projectTitle}\n\n`);
  if (!fs.existsSync(storyboardPath)) writeText(storyboardPath, `# ${projectTitle} 分镜设计\n\n`);
  if (!fs.existsSync(assetManifestPath)) {
    writeText(
      assetManifestPath,
      `${JSON.stringify(
        {
          title: projectTitle,
          episodeSlug: cleanSlug,
          confirmed: false,
          items: [],
        },
        null,
        2,
      )}\n`,
    );
  }
  if (!fs.existsSync(assetPromptsPath)) writeText(assetPromptsPath, `# ${projectTitle} 资产提示词\n\n`);
  if (!fs.existsSync(seedancePromptsPath)) writeText(seedancePromptsPath, `# ${projectTitle} Seedance 视频提示词\n\n`);
  if (!fs.existsSync(configPath)) {
    writeText(
      configPath,
      `${JSON.stringify(
        {
          groupName: defaultGroupName(episodeRoot),
          promptsPath: path.relative(episodeRoot, seedancePromptsPath),
          modelName: DEFAULT_VIDEO_CONFIG_MODEL,
          modelAliases: [DEFAULT_VIDEO_CONFIG_MODEL],
          dialogueLanguage: "en",
          settings: {
            ratio: "9:16",
            resolution: "480p",
            dialogueLanguage: "en",
            enableSound: "on",
            count: 1,
            search_enabled: 0,
            autoCompliance: 1,
            tailFrameContinuity: true,
            enableStoryboards: false,
            promptMode: "prompt",
            storyboardWorkflowExplicit: false,
            storyboardDisablesTailFrameContinuity: false,
            modeType: "image2video",
          },
          assets: [],
          storyboardPlans: [],
          storyboardReferences: [],
          shots: [],
          missingAssets: [],
          rejectedAssets: [],
          referenceWarnings: [],
          configReady: false,
        },
        null,
        2,
      )}\n`,
    );
  }
  return { episodeRoot, workDir };
}

function protectedDeletePath(target) {
  const resolved = path.resolve(target);
  return [
    APP_ROOT,
    HOME,
    path.join(HOME, "Documents"),
    path.join(HOME, "Documents/Codex"),
    DEFAULT_PROJECT_ROOT,
    SHORT_DRAMA_ROOT,
    path.join(APP_ROOT, "outputs"),
    path.join(APP_ROOT, "projects"),
  ].some((dir) => path.resolve(dir) === resolved);
}

function projectDeleteTarget(episodeRoot) {
  const resolvedEpisode = path.resolve(episodeRoot);
  const projectDir = path.resolve(projectDirForEpisode(resolvedEpisode));
  const outputsDir = path.join(projectDir, "outputs");
  let target = resolvedEpisode;
  if (fs.existsSync(outputsDir) && isInside(outputsDir, resolvedEpisode) && !protectedDeletePath(projectDir)) {
    const episodes = listDir(outputsDir)
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.resolve(outputsDir, entry.name));
    if (episodes.length <= 1 && episodes[0] === resolvedEpisode) target = projectDir;
  }
  if (!allowedPath(target) || protectedDeletePath(target)) throw new Error("删除目标不安全，已取消");
  return target;
}

function deleteProjectFiles(episodeRoot) {
  const resolvedEpisode = path.resolve(episodeRoot);
  for (const job of [...jobs.values()].filter((item) => item.episodeRoot === resolvedEpisode && item.status === "running")) {
    try {
      cancelJob(resolvedEpisode, job.id);
    } catch {
      // 删除项目时尽量停止相关任务，停止失败不阻塞后续安全删除判断。
    }
  }
  const target = projectDeleteTarget(resolvedEpisode);
  const removed = [target];
  if (target === resolvedEpisode) {
    const workDir = workDirForEpisode(resolvedEpisode);
    if (fs.existsSync(workDir) && allowedPath(workDir) && !protectedDeletePath(workDir)) removed.push(workDir);
  }
  for (const dir of removed) fs.rmSync(dir, { recursive: true, force: true });
  for (const [id, job] of jobs.entries()) {
    if (job.episodeRoot === resolvedEpisode) jobs.delete(id);
  }
  return { removed };
}

function defaultPaths(episodeRoot) {
  const slug = episodeSlug(episodeRoot);
  return {
    script: path.join(episodeRoot, "01_script", `${slug}_script.md`),
    storyboard: path.join(episodeRoot, "02_storyboard", `${slug}_storyboard.md`),
    modelShotPlan: path.join(episodeRoot, "02_storyboard", `${slug}_model_shot_plan.json`),
    assetManifest: path.join(episodeRoot, "03_asset_prompts", `${slug}_asset_manifest.json`),
    assetPrompts: path.join(episodeRoot, "03_asset_prompts", `${slug}_asset_prompts.md`),
    seedancePrompts: path.join(episodeRoot, VIDEO_PROMPTS_DIR, `${slug}_seedance_prompts.md`),
    config: path.join(projectDirForEpisode(episodeRoot), "work", `${slug}_video_generation`, `${slug}_skill_config.json`),
  };
}

const MODEL_SHOT_PLAN_VERSION = 1;

function writeStoryboardModelPlan(episodeRoot, { model, script, dialogueLanguage, shots } = {}) {
  const path = defaultPaths(episodeRoot).modelShotPlan;
  const plannedShots = (Array.isArray(shots) ? shots : []).map((shot) => ({
    id: compactLine(shot?.id),
    title: compactLine(shot?.title),
    beat: compactLine(shot?.beat),
    duration: clampShotDuration(shot?.duration || 8),
    refs: [...new Set((Array.isArray(shot?.refs) ? shot.refs : []).map(compactLine).filter(Boolean))],
    dialogues: Array.isArray(shot?.dialogues) ? shot.dialogues : [],
    design: sanitizeSeedanceDesign(shot?.videoDesign),
  }));
  if (!plannedShots.length || plannedShots.some((shot) => !shot.id || !shot.beat || !shot.refs.length || !hasCompleteSeedanceDesign(shot.design))) {
    throw new Error("视频分镜模型返回的导演设计不完整，未写入草稿，请重新生成分镜草稿。");
  }
  writeText(
    path,
    `${JSON.stringify(
      {
        version: MODEL_SHOT_PLAN_VERSION,
        source: "storyboard_model",
        model: compactLine(model),
        scriptFingerprint: sha1Text(script),
        dialogueLanguage: dialogueLanguage === "zh" ? "zh" : "en",
        createdAt: new Date().toISOString(),
        shots: plannedShots,
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

function readStoryboardModelPlan(episodeRoot) {
  const path = defaultPaths(episodeRoot).modelShotPlan;
  try {
    const plan = JSON.parse(readText(path));
    if (plan?.version !== MODEL_SHOT_PLAN_VERSION || plan?.source !== "storyboard_model" || !Array.isArray(plan?.shots)) return null;
    return plan;
  } catch {
    return null;
  }
}

// 视频配置只能使用生成分镜草稿时模型确定的对白语言。前端状态可能来自另一项目或
// 上一次会话；只要剧本指纹仍匹配，就不能让它把有效的导演设计误判为过期。
function modelPlanDialogueLanguageForConfig(modelPlan, script, requestedLanguage) {
  const requested = normalizeDialogueLanguage(requestedLanguage, "en");
  if (!modelPlan || modelPlan.scriptFingerprint !== sha1Text(script)) return requested;
  return normalizeDialogueLanguage(modelPlan.dialogueLanguage, requested);
}

function modelShotPlanNeedsRefresh(plan, script) {
  return !plan || plan.scriptFingerprint !== sha1Text(script);
}

// 视频配置修复只需要补齐模型导演计划。重建完整草稿会重置后续流程状态，
// 也会让一次临时失败错误地阻断配置保存。
async function buildModelShotPlanForConfig(episodeRoot, { script, dialogueLanguage } = {}) {
  const videoScript = compactLine(script);
  if (!videoScript) throw new Error("剧本为空，无法生成模型导演设计。");
  const manifest = normalizeAssetManifest(readAssetManifest(episodeRoot)?.data || {});
  const assets = manifestItemsToAssets(manifest);
  if (!assets.length) throw new Error("请先完成「资产提取」，再生成视频配置");

  const rawBeats = scriptBeatCandidates(videoScript);
  const continuityBeats = consolidateContinuousBeats(rawBeats);
  const targetShotCount = preferredShotCount(videoScript, continuityBeats);
  const normalizedDialogueLanguage = dialogueLanguage === "zh" ? "zh" : "en";
  const beats = fitBeatsToCountWithoutDuplicateTranslation(continuityBeats, targetShotCount, {
    dialogueLanguage: normalizedDialogueLanguage,
  });
  const durationPlan = planEpisodeDuration({ shotCount: beats.length || targetShotCount, beats });
  const result = await callStoryboardModel({
    script: videoScript,
    assets,
    dialogueLanguage: normalizedDialogueLanguage,
    modelName: undefined,
    targetShotCount,
    code: episodeCode(episodeSlug(episodeRoot)),
    beats,
    durationPlan,
  });
  if (!result.ok) {
    throw new Error(`视频分镜模型不可用或返回不完整设计，请重试。${result.reason || "未知失败"}`);
  }
  if (!result.shots?.length) throw new Error("视频分镜模型没有返回可用镜头");
  // 指纹必须用未压缩的 script:writeStoryboardModelPlan 只把这个参数用于
  // sha1Text(script),而三处校验(modelShotPlanNeedsRefresh /
  // modelPlanDialogueLanguageForConfig / modelShotPlanForConfig)都拿原始 script 算。
  // 这里若传 compactLine 过的 videoScript,剧本一带换行指纹就永不相等,
  // needsRefresh 恒为 true —— 表现为「生成视频配置」白跑 160 秒模型后必抛
  // 「模型导演设计生成失败」,从来不可能成功。模型调用仍用压缩版 videoScript。
  writeStoryboardModelPlan(episodeRoot, {
    model: result.model,
    script,
    dialogueLanguage: normalizedDialogueLanguage,
    shots: result.shots,
  });
  return readStoryboardModelPlan(episodeRoot);
}

async function ensureModelShotPlanForConfig(episodeRoot, { script, dialogueLanguage } = {}) {
  let plan = readStoryboardModelPlan(episodeRoot);
  if (!modelShotPlanNeedsRefresh(plan, script)) return plan;
  await buildModelShotPlanForConfig(episodeRoot, { script, dialogueLanguage });
  plan = readStoryboardModelPlan(episodeRoot);
  if (modelShotPlanNeedsRefresh(plan, script)) {
    throw new Error("模型导演设计生成失败，请稍后重新提交视频配置。");
  }
  return plan;
}

function modelShotPlanForConfig({ episodeRoot, modelPlan = readStoryboardModelPlan(episodeRoot), script, dialogueLanguage, assets, videoStylePreset } = {}) {
  const plan = modelPlan;
  const currentScriptFingerprint = sha1Text(script);
  if (!plan || plan.scriptFingerprint !== currentScriptFingerprint || plan.dialogueLanguage !== dialogueLanguage) {
    throw new Error("模型导演设计缺失或已过期，请重新生成分镜草稿后再生成视频配置。");
  }
  const assetLookup = assetLookupFromAssets(assets);
  const invalidShots = [];
  const shots = plan.shots.map((plannedShot, index) => {
    const videoDesign = sanitizeSeedanceDesign(plannedShot?.design);
    const refs = (Array.isArray(plannedShot?.refs) ? plannedShot.refs : []).map(compactLine).filter(Boolean);
    const missingRefs = refs.filter((ref) => !assetLookup.has(ref));
    if (!plannedShot?.id || !plannedShot?.beat || !refs.length || missingRefs.length || !hasCompleteSeedanceDesign(videoDesign)) {
      invalidShots.push(plannedShot?.id || `镜头${index + 1}`);
      return null;
    }
    return {
      name: compactLine(plannedShot.id),
      promptSection: compactLine(plannedShot.id),
      duration: clampShotDuration(plannedShot.duration || 8),
      videoStylePreset,
      refs,
      sceneRef: sceneRefForShotRefs(refs, assetLookup),
      beat: compactLine(plannedShot.beat),
      title: compactLine(plannedShot.title || plannedShot.beat),
      dialogues: Array.isArray(plannedShot.dialogues) ? plannedShot.dialogues : [],
      dialogueLanguage,
      videoDesign,
      assetLookup,
      x: 120 + (index % 3) * 460,
      y: 620 + Math.floor(index / 3) * 320,
    };
  });
  if (invalidShots.length || shots.some((shot) => !shot)) {
    throw new Error(`模型导演设计引用的资产或镜头无效：${invalidShots.join("、")}。请重新生成分镜草稿。`);
  }
  return { model: compactLine(plan.model), shots };
}

function workDirForEpisode(episodeRoot) {
  const slug = episodeSlug(episodeRoot);
  return path.join(projectDirForEpisode(episodeRoot), "work", `${slug}_video_generation`);
}

function jobsDirForEpisode(episodeRoot) {
  return path.join(workDirForEpisode(episodeRoot), "pixel_toys_jobs");
}

function normalizeRunNamespace(value) {
  return compactLine(value || "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 80);
}

function createRunNamespace(prefix = "run") {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return normalizeRunNamespace(`${prefix}_${stamp}_${crypto.randomUUID().slice(0, 8)}`);
}

function configRunNamespace(config = {}) {
  return normalizeRunNamespace(config.runNamespace || config.pipelineRunId || config.canvasCreatedAt || "");
}

function currentRunNamespace(episodeRoot, configData = null) {
  const config = configData || readVideoConfig(episodeRoot)?.data || {};
  const configNamespace = configRunNamespace(config);
  if (configNamespace && configHasCurrentIsolationFingerprint(episodeRoot, config)) return configNamespace;
  const workflow = ensureWorkflowNamespace(episodeRoot, "resolve current workflow namespace");
  return workflow.currentNamespace || "";
}

function runNamespaceMatches(job, runNamespace) {
  const current = normalizeRunNamespace(runNamespace);
  if (!current) return true;
  return normalizeRunNamespace(job?.runNamespace || job?.pipelineRunId || "") === current;
}

function assetJobTypes() {
  return new Set(["assets", "assets-dry-run", "asset-regenerate", "asset-regenerate-dry-run", "asset-edit", "asset-edit-dry-run", "storyboards", "storyboards-dry-run", "storyboard-regenerate", "storyboard-regenerate-dry-run"]);
}

function runningWorkflowJobs(episodeRoot) {
  const resolvedEpisode = path.resolve(episodeRoot);
  return [...jobs.values()].filter((job) => job.episodeRoot === resolvedEpisode && job.status === "running");
}

function runningBlockingWorkflowJobs(episodeRoot) {
  const assetTypes = assetJobTypes();
  return runningWorkflowJobs(episodeRoot).filter((job) => assetTypes.has(job.type));
}

function assertNoBlockingWorkflowJobs(episodeRoot, actionLabel = "重建流程") {
  const running = runningBlockingWorkflowJobs(episodeRoot);
  if (!running.length) return;
  const names = running.map((job) => `${job.type}${job.targetAssetNames?.length ? `(${job.targetAssetNames.join(", ")})` : ""}`).join("、");
  throw new Error(`${actionLabel}会重置当前工作流，但仍有任务运行中：${names}。请等待任务完成或先取消任务。`);
}

function runNamespaceStartMs(runNamespace) {
  const match = normalizeRunNamespace(runNamespace).match(/_(\d{14})_/);
  if (!match) return 0;
  const raw = match[1];
  const time = Date.parse(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`);
  return Number.isFinite(time) ? time : 0;
}

function workflowStatePath(episodeRoot) {
  return path.join(workDirForEpisode(episodeRoot), "pixel_toys_workflow.json");
}

function readWorkflowState(episodeRoot) {
  const file = workflowStatePath(episodeRoot);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeWorkflowState(episodeRoot, state) {
  const file = workflowStatePath(episodeRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

function projectReferenceKits(workflow = {}) {
  return (Array.isArray(workflow.referenceKits) ? workflow.referenceKits : [])
    .map((kit) => normalizeReferenceKit(kit, { now: kit?.updatedAt || kit?.createdAt || new Date().toISOString() }))
    .filter((kit) => kit.id);
}

function projectReferenceKitShots(config = {}) {
  return (Array.isArray(config.shots) ? config.shots : [])
    .map((shot, index) => ({
      id: compactLine(shot?.name || shot?.id || `shot_${index + 1}`),
      name: compactLine(shot?.name || shot?.id || `shot_${index + 1}`),
      title: compactLine(shot?.title || shot?.description || shot?.name || `镜头 ${index + 1}`),
      duration: Number(shot?.duration || 0) || 0,
      refs: Array.isArray(shot?.refs) ? shot.refs.filter(Boolean) : [],
      storyboardRefs: Array.isArray(shot?.storyboardRefs) ? shot.storyboardRefs.filter(Boolean) : [],
      referenceKitId: compactLine(shot?.referenceKitId || ""),
      referenceKitVersion: Number(shot?.referenceKitVersion || 0) || 0,
    }))
    .filter((shot) => shot.name);
}

function projectReferenceKitState(workflow = {}, config = {}) {
  return {
    referenceKits: projectReferenceKits(workflow),
    referenceKitShots: projectReferenceKitShots(config),
  };
}

function projectIsolationFingerprint(episodeRoot, scriptText = null) {
  const script =
    typeof scriptText === "string"
      ? scriptText
      : readText(defaultPaths(episodeRoot).script) || readText(findProjectFile(episodeRoot, "script"));
  return {
    projectRoot: path.resolve(episodeRoot),
    episodeSlug: episodeSlug(episodeRoot),
    scriptDigest: sha1Text(cleanScriptForDraft(script || "")),
  };
}

function configIsolationFingerprint(config = {}) {
  if (config.isolationFingerprint && typeof config.isolationFingerprint === "object") return config.isolationFingerprint;
  return {
    projectRoot: config.episodeRoot ? path.resolve(config.episodeRoot) : "",
    episodeSlug: config.episodeSlug || "",
    scriptDigest: config.sourceScriptDigest || "",
  };
}

function isolationFingerprintsMatch(episodeRoot, config = {}) {
  const expected = projectIsolationFingerprint(episodeRoot);
  const actual = configIsolationFingerprint(config);
  if (actual.projectRoot && path.resolve(actual.projectRoot) !== expected.projectRoot) return false;
  if (actual.episodeSlug && actual.episodeSlug !== expected.episodeSlug) return false;
  if (actual.scriptDigest && actual.scriptDigest !== expected.scriptDigest) return false;
  return true;
}

function configHasCurrentIsolationFingerprint(episodeRoot, config = {}) {
  const expected = projectIsolationFingerprint(episodeRoot);
  const actual = configIsolationFingerprint(config);
  return (
    actual.projectRoot &&
    path.resolve(actual.projectRoot) === expected.projectRoot &&
    actual.episodeSlug === expected.episodeSlug &&
    actual.scriptDigest === expected.scriptDigest
  );
}

function isolationMetadataFor(episodeRoot, workflow = null) {
  const state = workflow || ensureWorkflowNamespace(episodeRoot, "isolation metadata");
  const fingerprint = state.fingerprint || projectIsolationFingerprint(episodeRoot);
  return {
    episodeRoot,
    episodeSlug: episodeSlug(episodeRoot),
    sourceScriptDigest: fingerprint.scriptDigest,
    isolationFingerprint: fingerprint,
    runNamespace: state.currentNamespace,
    runNamespaceCreatedAt: state.createdAt || new Date().toISOString(),
    isolationVersion: 2,
  };
}

function rotateWorkflowNamespace(episodeRoot, reason = "new workflow") {
  const namespace = createRunNamespace("pt");
  const previous = readWorkflowState(episodeRoot);
  const fingerprint = projectIsolationFingerprint(episodeRoot);
  const state = {
    ...previous,
    isolationVersion: 2,
    currentNamespace: namespace,
    createdAt: new Date().toISOString(),
    reason,
    fingerprint,
    previousNamespaces: [
      ...(Array.isArray(previous.previousNamespaces) ? previous.previousNamespaces : []),
      ...(previous.currentNamespace ? [{ namespace: previous.currentNamespace, endedAt: new Date().toISOString(), reason }] : []),
    ].slice(-20),
  };
  return writeWorkflowState(episodeRoot, state);
}

function ensureWorkflowNamespace(episodeRoot, reason = "ensure workflow isolation") {
  const current = readWorkflowState(episodeRoot);
  if (normalizeRunNamespace(current.currentNamespace) && configHasCurrentIsolationFingerprint(episodeRoot, { isolationFingerprint: current.fingerprint || {} })) {
    return current;
  }
  return rotateWorkflowNamespace(episodeRoot, reason);
}

function archiveCurrentWorkflowArtifacts(episodeRoot, reason = "workflow reset", options = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveRoot = path.join(episodeRoot, "06_videos", "workflow_archive", stamp);
  const roots = [
    path.join(episodeRoot, "06_videos", "raw"),
    path.join(episodeRoot, VIDEO_ASSET_UPLOAD_DIR),
    path.join(episodeRoot, VIDEO_TASK_DIR),
    path.join(episodeRoot, "09_tail_frames"),
    path.join(episodeRoot, "10_tail_frame_uploads"),
    path.join(workDirForEpisode(episodeRoot), "single_shot_configs"),
  ];
  if (options.includeJobs) roots.push(jobsDirForEpisode(episodeRoot));
  const archived = {};
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = walkFiles(root, (file) => fs.statSync(file).isFile(), 2);
    for (const file of files) {
      const rel = path.relative(episodeRoot, file).replace(/^(\.\.[/\\])+/, "");
      const target = path.join(archiveRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.renameSync(file, target);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        fs.copyFileSync(file, target);
        fs.unlinkSync(file);
      }
      const key = path.relative(episodeRoot, root) || path.basename(root);
      archived[key] = (archived[key] || 0) + 1;
    }
  }
  const note = {
    reason,
    archivedAt: new Date().toISOString(),
    archived,
  };
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, "workflow_archive.json"), `${JSON.stringify(note, null, 2)}\n`, "utf8");
  return { archiveDir: archiveRoot, archived, stamp };
}

function resetWorkflowForContentChange(episodeRoot, reason = "content changed") {
  assertNoBlockingWorkflowJobs(episodeRoot, "重置工作流");
  for (const [id, job] of jobs.entries()) {
    if (job.episodeRoot !== path.resolve(episodeRoot) || job.status !== "running") continue;
    const child = jobChildren.get(id);
    if (child && !child.killed) child.kill("SIGTERM");
    jobChildren.delete(id);
    job.status = "canceled";
    job.finishedAt = new Date().toISOString();
    job.failureReason = job.failureReason || "流程已重置，旧任务已隔离";
    try {
      appendJobLog(job, "\n流程已重置，旧任务已取消并隔离。\n");
    } catch {
      persistJob(job);
    }
  }
  let archive = null;
  try {
    archive = archiveCurrentWorkflowArtifacts(episodeRoot, reason, { includeJobs: true });
  } catch {
    archive = null;
  }
  const workflow = rotateWorkflowNamespace(episodeRoot, reason);
  for (const [id, job] of jobs.entries()) {
    if (job.episodeRoot === path.resolve(episodeRoot)) jobs.delete(id);
  }
  return { workflow, archive };
}

function scriptDigestFromText(text) {
  return sha1Text(cleanScriptForDraft(text || ""));
}

// 覆写剧本前把当前内容存进 01_script/.script_history/,便于事故回滚。best-effort,失败不阻断主流程。
function backupScriptBeforeOverwrite(episodeRoot, scriptText, tag = "overwrite") {
  try {
    const text = String(scriptText || "");
    if (!text.trim()) return null;
    const dir = path.join(episodeRoot, "01_script", ".script_history");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${episodeSlug(episodeRoot)}_script.${stamp}.${tag}.md`);
    writeText(file, text);
    return file;
  } catch (error) {
    console.error(`[scriptBackup] 备份失败(不阻断):${error?.message || error}`);
    return null;
  }
}

function writeScriptWithWorkflowIsolation(episodeRoot, scriptText, reason = "script changed") {
  const file = findProjectFile(episodeRoot, "script");
  const before = readText(file);
  writeText(file, scriptText || "");
  if (scriptDigestFromText(before) !== scriptDigestFromText(scriptText || "")) {
    return { file, changed: true, ...resetWorkflowForContentChange(episodeRoot, reason) };
  }
  return { file, changed: false, workflow: ensureWorkflowNamespace(episodeRoot, reason), archive: null };
}

// 「资产描述」独立输入:与剧情剧本分开存放,只用于资产解析(人物/场景/道具),不参与剧情节拍/分镜。
// 专用文件名,避免与 01_script 里的剧本 .md 冲突(findProjectFile 的 script 走 defaults 优先,不会误取)。
function assetDescriptionPath(episodeRoot) {
  return path.join(episodeRoot, "01_script", `${episodeSlug(episodeRoot)}_asset_description.md`);
}

function readAssetDescription(episodeRoot) {
  const file = assetDescriptionPath(episodeRoot);
  return fs.existsSync(file) ? readText(file) : "";
}

function writeAssetDescription(episodeRoot, text) {
  const file = assetDescriptionPath(episodeRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeText(file, typeof text === "string" ? text : "");
  return file;
}

function currentRunStartMs(episodeRoot, configData = null) {
  const config = configData || readVideoConfig(episodeRoot)?.data || {};
  const currentNamespace = currentRunNamespace(episodeRoot, config);
  if (configRunNamespace(config) === currentNamespace && configHasCurrentIsolationFingerprint(episodeRoot, config)) {
    const configured = Date.parse(config.runNamespaceCreatedAt || config.canvasCreatedAt || "");
    if (Number.isFinite(configured)) return configured;
  }
  const state = readWorkflowState(episodeRoot);
  const workflowCreated = Date.parse(state.createdAt || "");
  if (Number.isFinite(workflowCreated)) return workflowCreated;
  return runNamespaceStartMs(currentNamespace);
}

function withoutLegacyVideoCanvasFields(config = {}) {
  if (!config || typeof config !== "object") return {};
  const clean = { ...config };
  for (const key of ["project" + "Uuid", "project" + "Url", "autoCreatedProject" + "Uuid", "replacedProject" + "Uuid"]) delete clean[key];
  return clean;
}

function ensureVideoConfigIsolation(episodeRoot, configRecord = null) {
  const record = configRecord || readVideoConfig(episodeRoot);
  if (!record?.file || !record?.data || typeof record.data !== "object") return record;
  const workflow = ensureWorkflowNamespace(episodeRoot, "migrate legacy project into isolated workflow");
  const currentNamespace = normalizeRunNamespace(record.data.runNamespace || "");
  if (currentNamespace && currentNamespace === workflow.currentNamespace && configHasCurrentIsolationFingerprint(episodeRoot, record.data)) return record;
  const migratedFromNamespace = currentNamespace;
  const data = {
    ...withoutLegacyVideoCanvasFields(record.data),
    groupName: isolatedDefaultGroupName(episodeRoot, workflow.currentNamespace),
    ...isolationMetadataFor(episodeRoot, workflow),
    legacyIsolationMigratedAt: new Date().toISOString(),
    migratedFromNamespace,
    isolatedFromLegacy: true,
  };
  writeText(record.file, `${JSON.stringify(data, null, 2)}\n`);
  return { ...record, data };
}

function persistJob(job) {
  if (!job.metaPath) return;
  fs.mkdirSync(path.dirname(job.metaPath), { recursive: true });
  const { metaPath, logPath, ...serializable } = job;
  fs.writeFileSync(metaPath, `${JSON.stringify({ ...serializable, logPath }, null, 2)}\n`, "utf8");
}

function markInterruptedPersistedJob(job) {
  const failureReason =
    job.failureReason ||
    "任务已中断：本地服务或生图子进程在完成前退出，没有生成输出文件。请直接重新生成该故事板。";
  const next = {
    ...job,
    status: "interrupted",
    exitCode: job.exitCode == null ? -1 : job.exitCode,
    finishedAt: job.finishedAt || new Date().toISOString(),
    failureReason,
  };
  if (next.metaPath) {
    try {
      persistJob(next);
    } catch {
      // 状态合并不能因为旧任务文件不可写而阻塞项目页面。
    }
  }
  return next;
}

function readPersistedJobs(episodeRoot, options = {}) {
  const dir = jobsDirForEpisode(episodeRoot);
  const runNamespace = normalizeRunNamespace(options.runNamespace || "");
  if (!fs.existsSync(dir)) return [];
  return listDir(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      try {
        const job = JSON.parse(fs.readFileSync(file, "utf8"));
        const logPath = job.logPath || file.replace(/\.json$/, ".log");
        return {
          ...job,
          logs: fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").slice(-240000) : job.logs || "",
          metaPath: file,
          logPath,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((job) => runNamespaceMatches(job, runNamespace));
}

function isPhotorealAssetStyle(style) {
  return !style?.preset || style.preset === "photoreal";
}

function assetPolicyLines(type, style = null) {
  const photoreal = isPhotorealAssetStyle(style);
  const common = [
    photoreal
      ? "使用超写实真人电影质感；只有选择“超写实”风格时才启用真人摄影、真实皮肤、毛孔、皱纹等写实质感要求。"
      : `严格使用当前选择的资产风格：${style?.label || "当前风格"}；只按该风格输出，不套用其他渲染器规则。`,
    "不要添加水印、标志、随机文字或装饰性平面设计元素。",
  ];
  if (type === "Character") {
    return [
      "最终图片必须是 16:9。",
      "只能使用纯白背景。",
      "一张身份表图片内必须包含全身正面、全身侧面、全身背面和一个半身特写。",
      photoreal
        ? "必须使用超写实真人渲染，包含真实皮肤纹理、可见毛孔、皱纹、轻微瑕疵、毛发细节、眼睛细节、服装面料纹理和自然人体比例。"
        : "必须按当前选择的风格表现人物身份、脸、发型、服装、体型和材质。",
      "使用与当前风格匹配的高级中性棚拍/展示光；不要动作姿势，不要戏剧化场景背景，不要添加剧本没有明确要求的道具。",
      ...common,
    ];
  }
  if (type === "Scene") {
    return [
      "最终图片必须是 16:9。",
      "创建全景/大全景环境建立图，不要近景裁切。",
      "画面中绝对不要人物、角色剪影、群众或任何可见人形。",
      "展示完整空间关系，包含前景、中景、背景，并保留后续角色生成可用的空间。",
      "不要使用纯白背景。",
      photoreal ? "使用超写实电影场景照质感。" : "按当前选择的风格建立环境，空间层次必须完整。",
      ...common,
    ];
  }
  if (type === "Prop") {
    return [
      "最终图片必须是 16:9。",
      "只能使用纯白背景。",
      "创建道具三视图参考图：正面、侧面、背面必须在同一张图中清晰展示。",
      photoreal
        ? "道具主体必须完整、干净、实拍感强，三视图必须是同一个道具，不得变成三个不同物件。"
        : "道具主体必须完整、干净、风格一致，三视图必须是同一个道具，不得变成三个不同物件。",
      "如果需要可读文字，只允许使用剧本中明确出现的文字，禁止额外可读文字。",
      ...common,
    ];
  }
  return [
    "最终图片必须是 16:9。",
    photoreal
      ? "创建法医细节或微距插入镜头参考图，细节必须清晰可见且符合物理真实。"
      : "创建清晰的插入镜头/证据细节参考图，细节必须符合当前选择的风格。",
    "如果需要可读文字，只允许使用剧本中明确出现的文字，禁止额外可读文字。",
    ...common,
  ];
}

function assetGlobalPolicy(style = null) {
  const photoreal = isPhotorealAssetStyle(style);
  return `## 控制台强制资产要求

- 人物资产必须是 16:9 纯白背景身份表，包含全身正面、全身侧面、全身背面和一个半身特写。
- 人物质感：${photoreal ? "当前选择为超写实，启用真人电影质感、真实皮肤纹理、毛孔、皱纹、毛发、眼睛、服装面料和自然人体比例。" : `当前选择为${style?.label || "当前风格"}，必须只按该风格表现人物身份、服装、材质和外观差异。`}
- 场景资产必须是 16:9 无人物全景/大全景环境图，不能有人影或角色剪影，空间信息必须完整。
- 场景质感：${photoreal ? "当前选择为超写实，启用电影场景照与真实空间材质。" : `当前选择为${style?.label || "当前风格"}，必须按该风格建立场景。`}
- 道具 Prop 资产必须是 16:9 纯白背景三视图，包含同一道具的正面、侧面、背面。
- 插入 Insert 资产保持证据特写/微距细节，不套用道具三视图规则。
`;
}

function stripConsoleAssetRequirementBlocks(markdown) {
  return String(markdown || "")
    .replace(/\n*## 控制台强制资产要求\n[\s\S]*?(?=\n## (?!控制台强制资产要求)|$)/g, "\n")
    .replace(/\n*## Console-Enforced Asset Requirements\n[\s\S]*?(?=\n## |$)/gi, "\n")
    .replace(/\n+控制台强制要求：\n(?:- [^\n]*\n?)+/g, "")
    .replace(/\n+Console-enforced requirements:\n(?:- [^\n]*\n?)+/gi, "");
}

function normalizeLegacyAssetHardRules(markdown, style = null) {
  const photoreal = isPhotorealAssetStyle(style);
  const characterRule = photoreal
    ? "- 人物质感：当前选择为超写实，使用真人电影质感、真实皮肤纹理、毛孔、皱纹、毛发、眼睛、服装面料和自然人体比例。"
    : `- 人物质感：当前选择为${style?.label || "当前风格"}，只按该风格表现人物身份、服装、材质和外观差异。`;
  const sceneRule = photoreal
    ? "- 场景质感：当前选择为超写实，使用电影场景照与真实空间材质，空间信息完整，保留可用于后续角色生成的留白。"
    : `- 场景质感：当前选择为${style?.label || "当前风格"}，只按该风格建立场景，空间信息完整，保留可用于后续角色生成的留白。`;
  return String(markdown || "")
    .replace(/- 人物质感：除非剧本明确要求其他风格，一律使用超写实真人电影质感[^\n]*/g, characterRule)
    .replace(/- 场景质感：除非剧本明确要求其他风格，一律使用超写实电影场景照[^\n]*/g, sceneRule)
    .replace(
      /- 人物参考图必须是 16:9、纯白背景、全身三视图加半身特写、超写实真人皮肤细节。/g,
      "- 人物参考图必须是 16:9、纯白背景、全身三视图加半身特写；最终画风由资产风格选择控制。",
    )
    .replace(
      /- 场景参考图必须是 16:9 无人物全景\/大全景环境图。/g,
      "- 场景参考图必须是 16:9 无人物全景/大全景环境图；最终画风由资产风格选择控制。",
    );
}

function enforcedAssetPromptsPath(episodeRoot, style = null) {
  const source = findProjectFile(episodeRoot, "assetPrompts");
  if (!fs.existsSync(source)) throw new Error("asset prompts file is missing");
  const slug = episodeSlug(episodeRoot);
  const out = path.join(projectDirForEpisode(episodeRoot), "work", `${slug}_video_generation`, `${slug}_asset_prompts.enforced.md`);
  const markdown = normalizeLegacyAssetHardRules(stripConsoleAssetRequirementBlocks(fs.readFileSync(source, "utf8")), style);
  const headingRe = /^## New (Character|Scene|Prop|Insert) Asset:\s+[^\n]+\s*$/gm;
  const matches = [...markdown.matchAll(headingRe)];
  const globalPolicy = assetGlobalPolicy(style);

  let result = markdown.replace(/^(# .+?\n)/, `$1\n${globalPolicy}\n`);
  if (!matches.length) {
    writeText(out, result);
    return out;
  }

  result = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const start = match.index;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    const section = markdown.slice(start, end).trimEnd();
    result += markdown.slice(cursor, start);
    const lines = assetPolicyLines(match[1], style).map((line) => `- ${line}`).join("\n");
    result += `${section}\n\n控制台强制要求：\n${lines}`;
    result += "\n\n";
    cursor = end;
  }
  result += markdown.slice(cursor);
  if (!result.includes("## 控制台强制资产要求")) {
    result = result.replace(/^(# .+?\n)/, `$1\n${globalPolicy}\n`);
  }
  writeText(out, result.trimEnd() + "\n");
  return out;
}

function findProjectFile(episodeRoot, kind) {
  const defaults = defaultPaths(episodeRoot);
  if (fs.existsSync(defaults[kind])) return defaults[kind];
  const folders = {
    script: "01_script",
    storyboard: "02_storyboard",
    assetManifest: "03_asset_prompts",
    assetPrompts: "03_asset_prompts",
    seedancePrompts: VIDEO_PROMPTS_DIR,
  };
  if (kind === "assetManifest") {
    const found = firstFile(path.join(episodeRoot, folders[kind]), (file) => /asset_manifest\.json$/i.test(file));
    return found || defaults[kind];
  }
  if (folders[kind]) {
    // 排除 01_script 里的资产描述文件——它与剧本同目录,字母序在 _script.md 之前,
    // 剧本文件缺失时会被 firstFile 误取成剧本(症状:资产描述"变成剧本")。
    const found = firstFile(path.join(episodeRoot, folders[kind]), (file) => (file.endsWith(".md") || file.endsWith(".txt")) && !/_asset_description\.md$/i.test(file));
    if (found) return found;
    return defaults[kind];
  }
  if (kind === "config") return locateConfig(episodeRoot) || defaults.config;
  return defaults[kind];
}

function hasAnyExistingChild(root, children) {
  return children.some((child) => fs.existsSync(path.join(root, child)));
}

function isEpisodeOutputRoot(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  if (!allowedPath(dir)) return false;
  if (
    hasAnyExistingChild(dir, [
      "01_script",
      "02_storyboard",
      "03_asset_prompts",
      "04_assets",
      VIDEO_PROMPTS_DIR,
      "06_videos",
      VIDEO_TASK_DIR,
    ])
  ) {
    return true;
  }
  return (
    firstFile(dir, (file) => /(?:asset_manifest\.json|asset_prompts\.md|seedance_prompts\.md|storyboard\.md|script\.md)$/i.test(path.basename(file))) ||
    locateConfig(dir)
  )
    ? true
    : false;
}

function locateConfig(episodeRoot, options = {}) {
  const slug = episodeSlug(episodeRoot);
  const code = episodeCode(slug).toLowerCase();
  const projectDir = projectDirForEpisode(episodeRoot);
  const candidates = [
    path.join(episodeRoot, "pipeline.json"),
    path.join(episodeRoot, "video_pipeline.json"),
    path.join(projectDir, "work", `${slug}_video_generation`),
    path.join(projectDir, "work", `${code}_video_generation`),
    path.join(APP_ROOT, "work", `${slug}_video_generation`),
    path.join(APP_ROOT, "work", `${code}_video_generation`),
    path.join(projectDir, "work"),
    path.join(APP_ROOT, "work"),
  ];
  const files = [];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) files.push(candidate);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      files.push(
        ...walkFiles(
          candidate,
          (file) =>
            !file.split(path.sep).includes("single_shot_configs") &&
            /(_pipeline_config(?:\.template)?|_skill_config|pipeline)\.json$/i.test(path.basename(file)),
          1,
        ),
      );
    }
  }
  return selectVideoConfigRecord(files, {
    episodeRoot,
    allowEmptyShots: options.allowEmptyShots === true,
  })?.file || "";
}

function mediaItem(file, episodeRoot = "") {
  const stat = fs.statSync(file);
  const version = `${Math.round(stat.mtimeMs)}-${stat.size}-${stat.ino || 0}`;
  return {
    name: path.basename(file),
    path: file,
    url: `/media?path=${encodeURIComponent(file)}&v=${encodeURIComponent(version)}`,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    rel: episodeRoot ? path.relative(episodeRoot, file) : file,
  };
}

function isAssetMedia(media) {
  return !!media?.path && /\.(png|jpe?g|webp)$/i.test(media.path) && fs.existsSync(media.path);
}

function promptMetaForAsset(episodeRoot, assetName) {
  const file = path.join(episodeRoot, "04_assets", "generation_logs", `${assetName}.prompt.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function assetGeneratedByPixelToys(episodeRoot, asset) {
  if (!isAssetMedia(asset)) return false;
  const meta = promptMetaForAsset(episodeRoot, asset.assetName);
  if (meta?.updatedAt) return true;
  const logsDir = path.join(episodeRoot, "04_assets", "generation_logs");
  const jsonLog = path.join(logsDir, `${asset.assetName}.json`);
  return fs.existsSync(jsonLog);
}

function recentlyCanceledAssetJobs(episodeRoot, options = {}) {
  const sinceMs = Number(options.sinceMs || 0);
  const maxAgeMs = Number(options.maxAgeMs || 15 * 60 * 1000);
  const assetTypes = assetJobTypes();
  return readPersistedJobs(episodeRoot)
    .filter((job) => assetTypes.has(job.type) && ["canceled", "cancelled", "interrupted"].includes(job.status))
    .filter((job) => {
      const finishedAt = Date.parse(job.finishedAt || job.startedAt || "");
      if (!Number.isFinite(finishedAt)) return false;
      if (!sinceMs) return true;
      return finishedAt >= sinceMs - maxAgeMs && finishedAt <= sinceMs + maxAgeMs;
    });
}

function recoverableAssetNamesFromRecentJobs(episodeRoot, options = {}) {
  const names = new Set();
  for (const job of recentlyCanceledAssetJobs(episodeRoot, options)) {
    for (const name of job.targetAssetNames || []) {
      const clean = compactLine(name);
      if (clean) names.add(clean);
    }
    const commandTarget = assetNameFromJobCommand(job.command);
    if (commandTarget) names.add(commandTarget);
    for (const match of String(job.logs || "").matchAll(/\b(?:generated|edited)\s+(.+?)\s+->/gi)) {
      const clean = compactLine(match[1]);
      if (clean) names.add(clean);
    }
  }
  return names;
}

function assetLabelCandidates(value = "") {
  const raw = compactLine(value);
  const strip = (input) => compactLine(input)
    .replace(/^[A-Z]{1,2}\d{3}_/i, "")
    .replace(/_(CHARACTER_SHEET|WIDE_ESTABLISHING|PROP_REF|INSERT_REF|PRODUCTION_BOARD)(?=$|\s)/gi, "")
    .replace(/\b(CHARACTER_SHEET|WIDE_ESTABLISHING|PROP_REF|INSERT_REF|PRODUCTION_BOARD)\b/gi, "");
  const parts = raw.split(/\s+/).flatMap((part) => [part, strip(part)]);
  const withoutPrefix = strip(raw);
  return [...new Set([raw, withoutPrefix, ...parts, sameProjectAssetKey(raw), sameProjectAssetKey(withoutPrefix), ...parts.map(sameProjectAssetKey)].map(compactLine).filter(Boolean))];
}

function assetNameSimilarityScore(a = "", b = "") {
  const aa = sameProjectAssetKey(a).replace(/_/g, "");
  const bb = sameProjectAssetKey(b).replace(/_/g, "");
  if (!aa || !bb) return 0;
  if (aa === bb) return 100;
  if (aa.includes(bb) || bb.includes(aa)) return Math.min(aa.length, bb.length) >= 3 ? 80 : 0;
  const grams = (text) => {
    const chars = [...text];
    if (chars.length <= 2) return new Set([text]);
    const out = new Set();
    for (let i = 0; i < chars.length - 1; i += 1) out.add(`${chars[i]}${chars[i + 1]}`);
    return out;
  };
  const aGrams = grams(aa);
  const bGrams = grams(bb);
  const overlap = [...aGrams].filter((item) => bGrams.has(item)).length;
  return Math.round((overlap * 2 * 100) / (aGrams.size + bGrams.size || 1));
}

function recoverableAssetNameForManifestItem(asset, manifestItems = [], recoverableNames = new Set()) {
  if (!asset || !manifestItems.length || !recoverableNames.has(asset.assetName)) return "";
  const assetType = normalizeAssetType(asset.manifestType || asset.type || "", "");
  if (!assetType) return "";
  if (assetType === "Scene" && isGenericFallbackSceneLabel(asset.assetName)) return "";
  const assetKeys = assetLabelCandidates(asset.assetName);
  let best = null;
  for (const item of manifestItems) {
    if (asset.assetName === item.id) return item.id;
    if (normalizeAssetType(item.type || "", "") !== assetType) continue;
    const itemKeys = assetLabelCandidates(`${item.id} ${item.label || ""}`);
    let score = 0;
    for (const a of assetKeys) {
      for (const b of itemKeys) {
        if (!a || !b) continue;
        if (a === b) score = Math.max(score, 100);
        else if (a.includes(b) || b.includes(a)) score = Math.max(score, Math.min(a.length, b.length) >= 3 ? 70 : 0);
        else score = Math.max(score, assetNameSimilarityScore(a, b));
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { id: item.id, score };
  }
  return best && best.score >= 55 ? best.id : "";
}

function manifestAssetNameSet(manifest = null) {
  const normalized = normalizeAssetManifest(manifest || {});
  return new Set((normalized.items || []).map((item) => item.id).filter(Boolean));
}

function currentConfigAssetNameSet(configData = null, { includeStoryboards = false } = {}) {
  const names = new Set();
  for (const asset of Array.isArray(configData?.assets) ? configData.assets : []) {
    const name = compactLine(asset?.name || asset);
    if (name) names.add(name);
  }
  if (includeStoryboards) {
    for (const asset of Array.isArray(configData?.storyboardReferences) ? configData.storyboardReferences : []) {
      const name = compactLine(asset?.name || asset);
      if (name) names.add(name);
    }
  }
  return names;
}

function currentAssetNameSet({ manifest = null, plannedAssetNames = [], configData = null, includeStoryboards = false } = {}) {
  const names = manifestAssetNameSet(manifest);
  const manifestIsSourceOfTruth = names.size > 0;
  if (!manifestIsSourceOfTruth) {
    for (const name of plannedAssetNames || []) {
      const clean = compactLine(name);
      if (clean) names.add(clean);
    }
  }
  if (!manifestIsSourceOfTruth || includeStoryboards) {
    for (const name of currentConfigAssetNameSet(configData, { includeStoryboards })) {
      const type = inferAssetTypeFromName(name);
      if (!manifestIsSourceOfTruth || (includeStoryboards && type === "Storyboard")) names.add(name);
    }
  }
  return names;
}

function scanAssets(episodeRoot) {
  const base = path.join(episodeRoot, "04_assets");
  const groups = [
    ["characters", "Character"],
    ["scenes", "Scene"],
    ["storyboards", "Storyboard"],
    ["props", ""],
  ];
  const all = [];
  for (const [folder, declaredType] of groups) {
    const dir = path.join(base, folder);
    for (const file of walkFiles(dir, (item) => /\.(png|jpg|jpeg|webp)$/i.test(item), 2).sort()) {
      const item = mediaItem(file, episodeRoot);
      item.assetName = path.basename(file).replace(/\.(png|jpg|jpeg|webp)$/i, "");
      const identity = resolveAssetIdentity({ declaredType, assetName: item.assetName, filePath: file });
      item.manifestType = identity.type;
      item.type = identity.scanType;
      item.usage = identity.usage;
      item.assetIdentity = identity;
      item.invalid = !identity.valid;
      item.conflicts = identity.conflicts;
      const promptMeta = promptMetaForAsset(episodeRoot, item.assetName) || {};
      item.assetStylePreset = compactLine(promptMeta.assetStylePreset || "");
      item.assetStyleLabel = compactLine(promptMeta.assetStyleLabel || "");
      item.generationMode = compactLine(promptMeta.mode || "");
      all.push(item);
    }
  }
  return all;
}

function teamResourceDescriptor({ teamId, episodeRoot, type, resource }) {
  const sourceResourceId = compactLine(resource.id || resource.assetName || resource.name || "");
  if (!sourceResourceId) return null;
  const sourceFile = type === "shot" ? "" : compactLine(resource.path || resource.file || "");
  const versionPayload = type === "shot"
    ? {
        id: sourceResourceId,
        name: compactLine(resource.name || ""),
        prompt: String(resource.prompt || resource.videoPrompt || ""),
        refs: Array.isArray(resource.refs) ? resource.refs.map(compactLine).filter(Boolean) : [],
        duration: Number(resource.duration || 0),
      }
    : {
        id: sourceResourceId,
        assetName: compactLine(resource.assetName || resource.name || ""),
        name: compactLine(resource.name || ""),
        size: Number(resource.size || 0),
        updatedAt: resource.updatedAt || "",
      };
  return {
    sourceTeamId: teamId,
    sourceProjectId: encodeId(episodeRoot),
    sourceProjectName: projectDisplayNameForSummary(episodeRoot),
    sourceResourceType: type,
    sourceResourceId,
    label: compactLine(resource.label || resource.assetName || resource.name || sourceResourceId),
    previewUrl: type === "shot" ? "" : String(resource.url || resource.previewUrl || ""),
    versionPayload,
    sourceFile,
  };
}

function teamSharedAssetId(teamId, episodeRoot, asset = {}) {
  const identity = [teamId, encodeId(episodeRoot), asset.rel || asset.path || asset.assetName || asset.name || ""]
    .map((value) => compactLine(value))
    .join("\u001f");
  return `team_asset_${crypto.createHash("sha1").update(identity).digest("hex").slice(0, 24)}`;
}

function shareProjectAssetsWithTeam(episodeRoot, teamId, ownerUserId) {
  const cleanTeamId = compactLine(teamId);
  const cleanOwnerUserId = compactLine(ownerUserId);
  if (!cleanTeamId || !cleanOwnerUserId) return 0;
  const projectId = encodeId(episodeRoot);
  const projectName = projectDisplayNameForSummary(episodeRoot);
  const records = [];
  for (const asset of scanAssets(episodeRoot)) {
    if (!asset?.path || asset.manifestType === "Storyboard" || !fs.existsSync(asset.path) || !isAssetMedia(asset)) continue;
    const promptMeta = promptMetaForAsset(episodeRoot, asset.assetName) || {};
    const type = normalizeAssetType(asset.manifestType || asset.type || "Prop", "Prop");
    const sourceUrl = compactLine(asset.url || `/media?path=${encodeURIComponent(asset.path)}`);
    records.push({
      id: teamSharedAssetId(cleanTeamId, episodeRoot, asset),
      ownerUserId: cleanOwnerUserId,
      teamId: cleanTeamId,
      name: compactLine(asset.assetName || asset.name || "未命名资产"),
      type,
      url: sourceUrl,
      previewUrl: sourceUrl,
      localUrl: sourceUrl,
      source: "team-project",
      prompt: compactLine(promptMeta.prompt || promptMeta.description || ""),
      ratio: compactLine(promptMeta.ratio || ""),
      resolution: compactLine(promptMeta.resolution || ""),
      metadata: {
        sourceProjectId: projectId,
        sourceProjectName: projectName,
        sourceResourceType: "asset-image",
        sourceResourceId: compactLine(asset.assetName || asset.name || ""),
      },
    });
  }
  return assetLibrary.upsertMany(records, { userId: cleanOwnerUserId }).length;
}

function syncTeamAssetLibraryForUser(user = {}) {
  const membership = teamMembershipForUser(user.id);
  if (!membership) return 0;
  let shared = 0;
  for (const episodeRoot of scanEpisodeRoots()) {
    const scope = projectScopeRecord(episodeRoot);
    if (scope.scope !== "team" || scope.teamId !== membership.teamId) continue;
    const ownerUserId = projectOwner(episodeRoot).ownerUserId;
    if (!ownerUserId) continue;
    shared += shareProjectAssetsWithTeam(episodeRoot, membership.teamId, ownerUserId);
  }
  return shared;
}

function teamResourceCatalog(user = {}, typeFilter = "") {
  const membership = teamMembershipForUser(user.id);
  if (!membership) return [];
  const requestedType = compactLine(typeFilter || "");
  const resources = [];
  for (const episodeRoot of scanEpisodeRoots()) {
    const scope = projectScopeRecord(episodeRoot);
    if (scope.scope !== "team" || scope.teamId !== membership.teamId) continue;
    const assets = scanAssets(episodeRoot);
    if (!requestedType || requestedType === "asset-image") {
      for (const asset of assets.filter((item) => item.manifestType !== "Storyboard")) {
        const descriptor = teamResourceDescriptor({ teamId: membership.teamId, episodeRoot, type: "asset-image", resource: asset });
        if (descriptor) resources.push(descriptor);
      }
    }
    if (!requestedType || requestedType === "storyboard") {
      for (const asset of assets.filter((item) => item.manifestType === "Storyboard")) {
        const descriptor = teamResourceDescriptor({ teamId: membership.teamId, episodeRoot, type: "storyboard", resource: asset });
        if (descriptor) resources.push(descriptor);
      }
    }
    if (!requestedType || requestedType === "shot") {
      const shots = readVideoConfig(episodeRoot)?.data?.shots || [];
      for (const shot of shots) {
        const descriptor = teamResourceDescriptor({ teamId: membership.teamId, episodeRoot, type: "shot", resource: shot });
        if (descriptor) resources.push(descriptor);
      }
    }
  }
  return resources;
}

function publicTeamResourceDescriptor(descriptor = {}) {
  const { sourceFile, versionPayload, ...publicDescriptor } = descriptor;
  return publicDescriptor;
}

function findTeamResourceDescriptor(user, { sourceProjectId, sourceResourceType, sourceResourceId }) {
  return teamResourceCatalog(user, sourceResourceType).find(
    (descriptor) =>
      descriptor.sourceProjectId === sourceProjectId &&
      descriptor.sourceResourceType === sourceResourceType &&
      descriptor.sourceResourceId === sourceResourceId,
  ) || null;
}

function copyReferenceImageSnapshot(destinationEpisodeRoot, descriptor, referenceId) {
  const sourceFile = path.resolve(descriptor.sourceFile || "");
  if (!sourceFile || !allowedPath(sourceFile)) {
    const error = new Error("来源资源文件不可用");
    error.statusCode = 409;
    throw error;
  }
  const destinationDir = path.join(workDirForEpisode(destinationEpisodeRoot), "team_references");
  const copied = copyReferenceFileSnapshot({ sourceFile, destinationDir, referenceId });
  return {
    copiedFile: copied.copiedFile,
    url: `/media?path=${encodeURIComponent(copied.copiedFile)}`,
  };
}

function snapshotForTeamResource(destinationEpisodeRoot, descriptor, referenceId) {
  const base = {
    id: descriptor.sourceResourceId,
    label: descriptor.label,
    sourceProjectName: descriptor.sourceProjectName,
    sourceResourceType: descriptor.sourceResourceType,
  };
  if (descriptor.sourceResourceType === "shot") return { ...base, ...descriptor.versionPayload };
  const copied = copyReferenceImageSnapshot(destinationEpisodeRoot, descriptor, referenceId);
  return { ...base, url: copied.url, copiedFile: copied.copiedFile };
}

function publicTeamReference(reference = {}) {
  const snapshot = reference.snapshot && typeof reference.snapshot === "object" ? { ...reference.snapshot } : {};
  delete snapshot.copiedFile;
  return { ...reference, snapshot };
}

function teamReferencesForUser(episodeRoot, user = {}) {
  const references = Array.isArray(readWorkflowState(episodeRoot).teamReferences) ? readWorkflowState(episodeRoot).teamReferences : [];
  const catalog = teamResourceCatalog(user);
  return references.map((reference) => {
    const current = catalog.find(
      (descriptor) =>
        descriptor.sourceProjectId === reference.sourceProjectId &&
        descriptor.sourceResourceType === reference.sourceResourceType &&
        descriptor.sourceResourceId === reference.sourceResourceId,
    );
    return publicTeamReference({ ...reference, status: referenceStatus(reference, current?.versionPayload || null) });
  });
}

function filterAssetsForCurrentWorkflow(assets = [], options = {}) {
  const allowedNames = currentAssetNameSet(options);
  const minModifiedAt = Number(options.minModifiedAt || 0);
  const includeStoryboards = options.includeStoryboards === true;
  const manifestItems = normalizeAssetManifest(options.manifest || {}).items || [];
  const recoverableNames = minModifiedAt ? recoverableAssetNamesFromRecentJobs(options.episodeRoot || "", { sinceMs: minModifiedAt }) : new Set();
  return (assets || []).filter((asset) => {
    if (!includeStoryboards && asset.manifestType === "Storyboard") return false;
    const recoveredName = recoverableAssetNameForManifestItem(asset, manifestItems, recoverableNames);
    const nameAllowed = allowedNames.size ? allowedNames.has(asset.assetName) || allowedNames.has(recoveredName) : true;
    if (!nameAllowed) return false;
    // The run-start time cutoff is only a fallback scoping for when there is no
    // manifest allow-list. With a manifest, name membership already scopes
    // assets to the current run, so a run/config reset must not orphan valid
    // assets merely because their files predate the new run namespace (which is
    // what produced the recurring "缺少有效参考资产 / 找不到素材"). Downstream
    // dedup in projectProductionAssetsForState keeps the freshest file per name.
    if (!allowedNames.size && minModifiedAt && mediaModifiedAt(asset) < minModifiedAt && !recoveredName) return false;
    return true;
  });
}

function currentStoryboardAssetsForWorkflow(assets = [], options = {}) {
  const allowedNames = new Set(
    [
      ...(options.plannedStoryboardNames || []),
      ...(Array.isArray(options.configData?.storyboardReferences) ? options.configData.storyboardReferences.map((asset) => asset?.name || asset) : []),
    ]
      .map(compactLine)
      .filter(Boolean),
  );
  const minModifiedAt = Number(options.minModifiedAt || 0);
  return (assets || []).filter((asset) => {
    if (asset.manifestType !== "Storyboard") return false;
    if (allowedNames.size && !allowedNames.has(asset.assetName)) return false;
    if (minModifiedAt && mediaModifiedAt(asset) < minModifiedAt) return false;
    return allowedNames.size || !minModifiedAt || mediaModifiedAt(asset) >= minModifiedAt;
  });
}

function projectEpisodeRoots(episodeRoot) {
  const outputsDir = path.join(projectDirForEpisode(episodeRoot), "outputs");
  if (!fs.existsSync(outputsDir)) return [episodeRoot];
  return listDir(outputsDir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outputsDir, entry.name))
    .filter((dir) => isEpisodeOutputRoot(dir))
    .sort();
}

function sameProjectAssetKey(value) {
  return normalizeAssetMatchText(String(value || "").replace(/^[A-Z]{1,2}\d{3}_/i, "").replace(/_(CHARACTER_SHEET|WIDE_ESTABLISHING|PROP_REF|INSERT_REF)$/i, ""));
}

function projectAssetMatchScore(asset, item) {
  if (!asset || !item) return 0;
  if (normalizeAssetType(asset.manifestType || asset.type || "", "") !== normalizeAssetType(item.type || "", "")) return 0;
  if (
    normalizeAssetType(item.type || "", "") === "Scene" &&
    (isGenericFallbackSceneLabel(asset.assetName) || isGenericFallbackSceneLabel(asset.label || asset.assetLabel))
  ) {
    return 0;
  }
  if (asset.assetName === item.id) return 100;
  if (asset.matchCode && item.matchCode && asset.matchCode === item.matchCode) return 90;
  const labelScore = assetMatchScore(
    {
      type: normalizeAssetType(asset.manifestType || asset.type || "", "Prop"),
      label: asset.label || asset.assetLabel || asset.assetName,
      name: asset.assetName,
      evidence: asset.evidence || "",
    },
    item,
  );
  const assetKey = sameProjectAssetKey(`${asset.assetName} ${asset.assetLabel || asset.label || ""}`);
  const itemKey = sameProjectAssetKey(`${item.id || ""} ${item.label || ""}`);
  let score = labelScore;
  if (assetKey && itemKey && assetKey === itemKey) score += 18;
  if (assetKey && itemKey && (assetKey.includes(itemKey) || itemKey.includes(assetKey))) score += 8;
  return score;
}

function projectReusableAssetsForManifest(episodeRoot, manifest, options = {}) {
  const normalized = normalizeAssetManifest(manifest || {});
  const items = normalized.items || [];
  if (!items.length) return [];
  const currentAssets = filterAssetsForCurrentWorkflow(scanAssets(episodeRoot), {
    manifest: normalized,
    plannedAssetNames: options.plannedAssetNames || [],
    configData: options.configData || null,
    minModifiedAt: options.minModifiedAt || 0,
  });
  const currentNames = new Set(currentAssets.map((asset) => asset.assetName));
  const results = [];
  const usedPaths = new Set();
  const otherEpisodes = projectEpisodeRoots(episodeRoot).filter((root) => path.resolve(root) !== path.resolve(episodeRoot));
  for (const item of items) {
    if (currentNames.has(item.id)) continue;
    let best = null;
    for (const root of otherEpisodes) {
      const otherManifest = normalizeAssetManifest(readAssetManifest(root)?.data || {});
      const otherItemsById = new Map((otherManifest.items || []).map((entry) => [entry.id, entry]));
      for (const asset of scanAssets(root).filter((entry) => entry.manifestType !== "Storyboard")) {
        const otherItem = otherItemsById.get(asset.assetName) || {};
        const enriched = {
          ...asset,
          label: otherItem.label || asset.assetName,
          assetLabel: otherItem.label || "",
          matchCode: otherItem.matchCode || "",
          evidence: otherItem.evidence || "",
        };
        const score = projectAssetMatchScore(enriched, item);
        if (score <= 0) continue;
        if (!best || score > best.score || (score === best.score && mediaModifiedAt(enriched) > mediaModifiedAt(best.asset))) {
          best = { asset: enriched, sourceEpisodeRoot: root, score };
        }
      }
    }
    if (!best || best.score < 12 || usedPaths.has(best.asset.path)) continue;
    usedPaths.add(best.asset.path);
    const reused = {
      ...best.asset,
      assetName: item.id,
      displayAssetName: item.id,
      originalAssetName: best.asset.assetName,
      sourceEpisodeSlug: episodeSlug(best.sourceEpisodeRoot),
      sourceEpisodeRoot: best.sourceEpisodeRoot,
      source: "project-reuse",
      reused: true,
      reuseScore: best.score,
      rel: path.relative(episodeRoot, best.asset.path),
    };
    results.push(reused);
  }
  return results;
}

function projectProductionAssetsForState(episodeRoot, manifest = null, options = {}) {
  const normalizedManifest = normalizeAssetManifest(manifest || {});
  const manifestNames = manifestAssetNameSet(normalizedManifest);
  const localAssets = filterAssetsForCurrentWorkflow(scanAssets(episodeRoot), {
    manifest: normalizedManifest,
    episodeRoot,
    plannedAssetNames: options.plannedAssetNames || [],
    configData: options.configData || null,
    minModifiedAt: options.minModifiedAt || 0,
  });
  const reusableAssets = manifest && options.includeReusableAssets === true ? projectReusableAssetsForManifest(episodeRoot, manifest, options) : [];
  const recoverableNames = options.minModifiedAt ? recoverableAssetNamesFromRecentJobs(episodeRoot, { sinceMs: options.minModifiedAt }) : new Set();
  const byName = new Map();
  const priorityByName = new Map();
  for (const asset of [...reusableAssets, ...localAssets]) {
    const recoveredName = recoverableAssetNameForManifestItem(asset, normalizedManifest.items || [], recoverableNames);
    const finalAsset = recoveredName && recoveredName !== asset.assetName
      ? {
          ...asset,
          assetName: recoveredName,
          displayAssetName: recoveredName,
          originalAssetName: asset.assetName,
          recoveredFromInterruptedWorkflow: true,
          source: asset.source || "file",
        }
      : asset;
    const isExactCurrentAsset =
      manifestNames.has(finalAsset.assetName) &&
      asset.assetName === finalAsset.assetName &&
      !finalAsset.reused &&
      !finalAsset.recoveredFromInterruptedWorkflow;
    const priority = isExactCurrentAsset ? 40 : finalAsset.recoveredFromInterruptedWorkflow ? 30 : finalAsset.reused ? 20 : 10;
    const previous = byName.get(finalAsset.assetName);
    const previousPriority = priorityByName.get(finalAsset.assetName) || 0;
    if (
      !previous ||
      priority > previousPriority ||
      (priority === previousPriority && mediaModifiedAt(finalAsset) >= mediaModifiedAt(previous))
    ) {
      byName.set(finalAsset.assetName, finalAsset);
      priorityByName.set(finalAsset.assetName, priority);
    }
  }
  return [...byName.values()];
}

const HIDDEN_SCENE_REFERENCE_CATALOG = [
  {
    id: "dark-forest-fog",
    url: "https://picsum.photos/id/1036/1280/720",
    keywords: ["forest", "woods", "fog", "mist", "rain", "trees", "wild", "nature", "森林", "树林", "雾", "雨", "荒野"],
    description: "misty forest depth, soft natural haze, layered foreground and background",
  },
  {
    id: "storm-ocean-cliff",
    url: "https://picsum.photos/id/1018/1280/720",
    keywords: ["ocean", "sea", "cliff", "storm", "water", "coast", "island", "underwater", "深海", "海", "海底", "悬崖", "水"],
    description: "wide coastal/oceanic natural photography, deep blue atmosphere, large-scale space",
  },
  {
    id: "canyon-desert-wide",
    url: "https://picsum.photos/id/1015/1280/720",
    keywords: ["desert", "canyon", "sand", "wasteland", "valley", "dry", "荒漠", "沙漠", "峡谷", "废土", "岩石"],
    description: "sunlit desert canyon, strong geological forms, cinematic warm contrast",
  },
  {
    id: "mountain-cold-wide",
    url: "https://picsum.photos/id/1016/1280/720",
    keywords: ["mountain", "snow", "ice", "cold", "peak", "highland", "winter", "山", "雪", "冰", "寒冷", "高地"],
    description: "cold mountain landscape, crisp distant layers, natural epic scale",
  },
  {
    id: "noir-city-night",
    url: "https://picsum.photos/id/96/1280/720",
    keywords: ["city", "street", "night", "neon", "rain", "alley", "urban", "城市", "街道", "夜", "霓虹", "雨夜", "巷"],
    description: "night urban photography, hard contrast, practical light sources, noir mood",
  },
  {
    id: "industrial-interior",
    url: "https://picsum.photos/id/1076/1280/720",
    keywords: ["factory", "industrial", "corridor", "metal", "warehouse", "lab", "facility", "工厂", "工业", "走廊", "仓库", "实验室"],
    description: "industrial interior spatial reference, hard surfaces, directional practical lighting",
  },
  {
    id: "warm-room-window",
    url: "https://picsum.photos/id/1050/1280/720",
    keywords: ["room", "home", "interior", "window", "bedroom", "apartment", "warm", "房间", "室内", "窗", "卧室", "公寓", "暖光"],
    description: "warm natural-window interior photography, domestic realism, soft shadows",
  },
  {
    id: "gothic-stone-architecture",
    url: "https://picsum.photos/id/1043/1280/720",
    keywords: ["castle", "palace", "cathedral", "temple", "stone", "gothic", "ancient", "royal", "城堡", "宫殿", "神殿", "石", "古老", "王宫"],
    description: "stone architectural atmosphere, gothic massing, cinematic depth and scale",
  },
  {
    id: "subterranean-cave",
    url: "https://picsum.photos/id/38/1280/720",
    keywords: ["cave", "underground", "abyss", "tunnel", "mine", "dark", "subterranean", "洞穴", "地下", "深渊", "隧道", "矿井"],
    description: "dark cavern-like natural space, low-key lighting, deep shadow pockets",
  },
  {
    id: "open-field-golden-hour",
    url: "https://picsum.photos/id/10/1280/720",
    keywords: ["field", "grass", "plain", "sunset", "golden", "meadow", "village", "田野", "草地", "黄昏", "村庄", "平原"],
    description: "open landscape at golden hour, broad readable horizon, pastoral realism",
  },
];

function hiddenSceneReferenceDir(episodeRoot) {
  return path.join(HIDDEN_SCENE_REFERENCE_DIR, crypto.createHash("sha1").update(path.resolve(episodeRoot)).digest("hex").slice(0, 16));
}

function sceneReferenceSearchText(item = {}) {
  return [item.id, item.label, item.type, item.usage, item.evidence, item.visual, item.textToImagePrompt, item.prompt]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hiddenSceneReferenceScore(item = {}, candidate = {}) {
  const haystack = sceneReferenceSearchText(item);
  let score = 0;
  for (const keyword of candidate.keywords || []) {
    const key = String(keyword || "").toLowerCase();
    if (key && haystack.includes(key)) score += key.length > 1 ? 4 : 1;
  }
  if (/night|dark|noir|shadow|夜|黑暗|阴影|深渊/.test(haystack) && /night|dark|abyss|noir|subterranean/i.test(`${candidate.id} ${candidate.description}`)) score += 3;
  if (/palace|royal|temple|castle|gothic|宫殿|王宫|神殿|城堡/.test(haystack) && /architecture|gothic|stone/i.test(`${candidate.id} ${candidate.description}`)) score += 4;
  if (/ocean|sea|underwater|deep|海|深海|海底|水/.test(haystack) && /ocean|coastal|blue/i.test(`${candidate.id} ${candidate.description}`)) score += 5;
  return score;
}

function selectHiddenSceneReference(item = {}) {
  let best = HIDDEN_SCENE_REFERENCE_CATALOG[0];
  let bestScore = -1;
  for (const candidate of HIDDEN_SCENE_REFERENCE_CATALOG) {
    const score = hiddenSceneReferenceScore(item, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

async function downloadHiddenSceneReference(candidate, target) {
  if (fs.existsSync(target) && fs.statSync(target).size > 1000) return target;
  const response = await fetch(candidate.url, {
    redirect: "follow",
    headers: { "User-Agent": "PixelToys/1.0 hidden scene reference cache" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/^image\/(?:jpeg|jpg|png|webp)/i.test(contentType)) throw new Error(`unexpected content-type ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1000) throw new Error("downloaded image is too small");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  return target;
}

async function buildHiddenSceneReferenceMap(episodeRoot, manifest, targetAssetNames = [], assetStyle = null) {
  if (!isPhotorealAssetStyle(assetStyle)) return null;
  const normalized = normalizeAssetManifest(manifest || {});
  const wanted = new Set((targetAssetNames || []).map(compactLine).filter(Boolean));
  const sceneItems = (normalized.items || []).filter((item) => {
    if (normalizeAssetType(item.type, "") !== "Scene") return false;
    if (item.generate === false) return false;
    if (wanted.size && !wanted.has(item.id)) return false;
    return true;
  });
  if (!sceneItems.length) return null;
  const dir = hiddenSceneReferenceDir(episodeRoot);
  const assets = {};
  const selections = [];
  for (const item of sceneItems) {
    const selected = selectHiddenSceneReference(item);
    const target = path.join(dir, `${selected.id}.jpg`);
    try {
      await downloadHiddenSceneReference(selected, target);
      assets[item.id] = {
        references: [target],
        source: "system-hidden-scene-color-reference",
        mode: "color-grade-only",
        catalogId: selected.id,
        description: `${selected.description}; use only palette, color grade, exposure, contrast, shadow density, atmosphere tone, and broad lighting mood`,
      };
      selections.push({ assetName: item.id, catalogId: selected.id, description: selected.description, path: target });
    } catch (error) {
      console.warn(`Hidden scene reference skipped for ${item.id}: ${error.message}`);
    }
  }
  if (!Object.keys(assets).length) return null;
  const mapPath = path.join(dir, `asset-reference-map-${crypto.createHash("sha1").update(JSON.stringify(assets)).digest("hex").slice(0, 12)}.json`);
  writeText(mapPath, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), assets }, null, 2)}\n`);
  return { mapPath, selections };
}

function assetManifestItemCount(episodeRoot) {
  const manifest = readAssetManifest(episodeRoot)?.data;
  return Array.isArray(manifest?.items) ? manifest.items.length : 0;
}

function deleteAssetImage(episodeRoot, body = {}) {
  const assetName = compactLine(body.assetName || "");
  if (!assetName) throw new Error("缺少要删除的资产图名称");
  const manifest = readAssetManifest(episodeRoot)?.data || {};
  const runStart = currentRunStartMs(episodeRoot);
  const allAssets = scanAssets(episodeRoot);
  const asset =
    filterAssetsForCurrentWorkflow(allAssets, { manifest, minModifiedAt: runStart }).find((item) => item.assetName === assetName) ||
    currentStoryboardAssetsForWorkflow(allAssets, {
      configData: readVideoConfig(episodeRoot)?.data || null,
      minModifiedAt: runStart,
    }).find((item) => item.assetName === assetName);
  if (!asset) throw new Error(`找不到资产图：${assetName}`);
  if (!allowedPath(asset.path)) throw new Error("资产路径不允许删除");
  fs.rmSync(asset.path, { force: true });
  const logsDir = path.join(episodeRoot, "04_assets", "generation_logs");
  for (const suffix of [".prompt.json", ".json", ".failed.json"]) {
    const logFile = path.join(logsDir, `${assetName}${suffix}`);
    if (allowedPath(logFile) && fs.existsSync(logFile)) fs.rmSync(logFile, { force: true });
  }
  const rawManifest = readAssetManifest(episodeRoot)?.data;
  let removedFromManifest = false;
  if (rawManifest?.items?.length) {
    const nextItems = rawManifest.items.filter((item) => item.id !== assetName);
    removedFromManifest = nextItems.length !== rawManifest.items.length;
    if (removedFromManifest) {
      writeAssetManifest(episodeRoot, { ...rawManifest, items: nextItems });
    }
  }
  return { assetName, deleted: true, removedFromManifest };
}

function clearAssetFailureLogs(episodeRoot, assetNames = []) {
  const logsDir = path.join(episodeRoot, "04_assets", "generation_logs");
  for (const rawName of assetNames || []) {
    const assetName = compactLine(rawName);
    if (!assetName) continue;
    const failedFile = path.join(logsDir, `${assetName}.failed.json`);
    if (allowedPath(failedFile) && fs.existsSync(failedFile)) fs.rmSync(failedFile, { force: true });
  }
}

function clearAssetGeneratedMetadata(episodeRoot, assetNames = []) {
  const logsDir = path.join(episodeRoot, "04_assets", "generation_logs");
  for (const rawName of assetNames || []) {
    const assetName = compactLine(rawName);
    if (!assetName) continue;
    for (const suffix of [".failed.json", ".json", ".prompt.json"]) {
      const file = path.join(logsDir, `${assetName}${suffix}`);
      if (allowedPath(file) && fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
  }
}

function assetNameFromJobCommand(command = "") {
  const match = String(command || "").match(/--asset-name\s+(.+?)(?:\s+--|$)/);
  return compactLine(match?.[1] || "");
}

function activeAssetTargetsFromJobs(localJobs = []) {
  const targets = new Set();
  for (const job of localJobs || []) {
    if (job?.status !== "running") continue;
    if (
      ![
        "assets",
        "assets-dry-run",
        "asset-regenerate",
        "asset-regenerate-dry-run",
        "asset-edit",
        "asset-edit-dry-run",
        "storyboards",
        "storyboards-dry-run",
        "storyboard-regenerate",
        "storyboard-regenerate-dry-run",
      ].includes(job.type)
    ) {
      continue;
    }
    for (const name of job.targetAssetNames || []) {
      const clean = compactLine(name);
      if (clean) targets.add(clean);
    }
    const commandTarget = assetNameFromJobCommand(job.command);
    if (commandTarget) targets.add(commandTarget);
    const activeMatches = [...String(job.logs || "").matchAll(/\b(?:generating|editing)\s+(.+?)\s+\(\d+x\d+\)\s+->/gi)];
    const current = compactLine(activeMatches.at(-1)?.[1] || "");
    if (current) targets.add(current);
  }
  return targets;
}

function failedAssetNames(episodeRoot, options = {}) {
  const runNamespace = currentRunNamespace(episodeRoot);
  const minFailedAt = Number(options.minFailedAt || 0);
  const logsDir = path.join(episodeRoot, "04_assets", "generation_logs");
  const allowedNames = currentAssetNameSet(options);
  const currentAssets = Array.isArray(options.assets)
    ? options.assets
    : filterAssetsForCurrentWorkflow(scanAssets(episodeRoot), {
        ...options,
        minModifiedAt: options.minModifiedAt || 0,
      });
  const byName = new Map(currentAssets.map((asset) => [asset.assetName, asset]));
  const failed = new Set();
  for (const file of walkFiles(logsDir, (item) => /\.failed\.json$/i.test(item), 1)) {
    const name = path.basename(file).replace(/\.failed\.json$/i, "");
    if (!name) continue;
    if (allowedNames.size && !allowedNames.has(name)) continue;
    let failedAt = Date.parse(fs.statSync(file).mtime.toISOString());
    let failedRunNamespace = "";
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      failedAt = Date.parse(parsed.failedAt || "") || failedAt;
      failedRunNamespace = normalizeRunNamespace(parsed.runNamespace || parsed.pipelineRunId || "");
    } catch {
      // 旧失败文件可能不是完整 JSON，继续使用文件修改时间。
    }
    if (runNamespace && failedRunNamespace && failedRunNamespace !== runNamespace) continue;
    if (minFailedAt && Number.isFinite(failedAt) && failedAt < minFailedAt) continue;
    const assetUpdatedAt = Date.parse(byName.get(name)?.updatedAt || "");
    if (!Number.isFinite(assetUpdatedAt) || assetUpdatedAt <= failedAt) failed.add(name);
  }
  const seenJobs = new Set();
  for (const job of [...readPersistedJobs(episodeRoot, { runNamespace }), ...jobs.values().filter((item) => runNamespaceMatches(item, runNamespace))]) {
    if (!job || seenJobs.has(job.id) || job.episodeRoot !== episodeRoot || job.status !== "failed") continue;
    seenJobs.add(job.id);
    if (!["asset-edit", "asset-regenerate", "asset-edit-dry-run", "asset-regenerate-dry-run"].includes(job.type)) continue;
    const name = assetNameFromJobCommand(job.command);
    if (!name) continue;
    if (allowedNames.size && !allowedNames.has(name)) continue;
    const failedAt = Date.parse(job.finishedAt || job.startedAt || "");
    if (minFailedAt && Number.isFinite(failedAt) && failedAt < minFailedAt) continue;
    const assetUpdatedAt = Date.parse(byName.get(name)?.updatedAt || "");
    if (!Number.isFinite(failedAt) || !Number.isFinite(assetUpdatedAt) || assetUpdatedAt <= failedAt) failed.add(name);
  }
  return failed;
}

// 从 image-gen 写入的 .failed.json 的 error 文本里抽出结构化错误：
// 错误码、上游 HTTP 状态、上游 message。error 形如 "<NAME> image-gen failed:\n{ ...json... }"。
function parseImageGenFailure(rawError) {
  const text = String(rawError || "");
  const detail = { code: "", message: "", status: 0, upstreamCode: "", upstreamMessage: "" };
  const braceAt = text.indexOf("{");
  let parsed = null;
  if (braceAt >= 0) {
    try {
      parsed = JSON.parse(text.slice(braceAt));
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    const candidates = [...text.matchAll(/\{\s*"ok"\s*:\s*false[\s\S]*?\n\}/g)].map((match) => match[0]);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      try {
        parsed = JSON.parse(candidates[index]);
        break;
      } catch {
        // Try the previous candidate.
      }
    }
  }
  if (parsed) {
    detail.code = compactLine(parsed.code || "");
    detail.message = compactLine(parsed.message || "");
    detail.status = Number(parsed.detail?.status) || 0;
    const body = parsed.detail?.body;
    if (typeof body === "string" && body.trim().startsWith("{")) {
      try {
        const inner = JSON.parse(body);
        detail.upstreamCode = compactLine(inner.error?.code || inner.code || "");
        detail.upstreamMessage = compactLine(inner.error?.message || inner.message || "");
      } catch {
        detail.upstreamMessage = compactLine(body).slice(0, 200);
      }
    } else if (body && typeof body === "object") {
      detail.upstreamCode = compactLine(body.error?.code || body.code || "");
      detail.upstreamMessage = compactLine(body.error?.message || body.message || "");
    }
  }
  if (!detail.message && !detail.code) {
    detail.message = compactLine(text.slice(0, 200));
  }
  if (!detail.status && /status"?\s*:\s*(\d{3})/.test(text)) {
    detail.status = Number(text.match(/status"?\s*:\s*(\d{3})/)?.[1]) || 0;
  }
  return detail;
}

// 把结构化错误归类，给出可操作建议（区分"等网关恢复"和"改 prompt"两类完全不同的处置）。
function classifyImageGenFailure(detail) {
  const haystack = `${detail.code} ${detail.message} ${detail.upstreamCode} ${detail.upstreamMessage}`.toLowerCase();
  const status = detail.status;
  if (/no available account|no available channel|无可用账号|无可用渠道/.test(haystack) || status === 503) {
    return { category: "gateway", advice: "上游网关暂时没有可用账号/容量（与 prompt 内容无关），稍后重试即可，不要改 prompt。" };
  }
  if ([502, 504, 522, 523, 524].includes(status)) {
    return { category: "gateway-timeout", advice: "api.apikey.fun 上游网关/源站超时（与 prompt 审核无关）。工具会保留失败记录，稍后重试；若连续出现，优先降低故事板复杂度或分辨率。" };
  }
  if (/moderat|safety|content[_\s-]?polic|violat|blocked|rejected|prohibited|审核|敏感|违规|违禁|内容策略/.test(haystack)) {
    return { category: "moderation", advice: "触发内容审核：需要安全化 prompt（去掉武器/血迹/暴力等高风险词）后再重试，重试原 prompt 无意义。" };
  }
  if (/api_stream_error|unexpected eof|no_image_result|no image result|stream|did not return image|未返回图像|没有收到图片结果|流结束|流中断|流式/.test(haystack)) {
    return { category: "stream", advice: "上游流式响应中断，工具会自动重试；若最终仍失败，直接重试该资产即可，不需要修改 prompt。" };
  }
  if (/network_error|fetch failed|network failed|接口请求网络失败|网络失败/.test(haystack)) {
    return { category: "gateway-network", advice: "到 api.apikey.fun 的网络请求失败（与 prompt 内容无关），稍后自动重试或继续从失败资产重跑。" };
  }
  if (/modulenotfounderror.*no module named ['"]?pil|no module named ['"]?pil|python pillow/i.test(haystack)) {
    return { category: "server-dependency", advice: "服务器缺少 Python Pillow，Production Board 后处理无法执行；部署新版后会跳过增强后处理并保留已生成图片。" };
  }
  if (/rate.?limit|too many request|频繁|限流|限频/.test(haystack) || status === 429) {
    return { category: "ratelimit", advice: "触发上游限流，降低并发/稍后重试。" };
  }
  if (/size must contain|total pixels|invalid.*size|尺寸|像素/.test(haystack) || status === 400) {
    return { category: "config", advice: "生图尺寸不符合上游限制，请使用 1280x720、2048x1152 或 3840x2160 后重新生成。" };
  }
  if (/unauthor|invalid.*key|forbidden|鉴权|密钥|未授权/.test(haystack) || status === 401 || status === 403) {
    return { category: "auth", advice: "鉴权失败：检查 OPENAI_API_KEY（apikey.fun 网关）是否有效。" };
  }
  if (/timeout|timed out|524|超时/.test(haystack)) {
    return { category: "gateway-timeout", advice: "上游超时，稍后重试或降低单图分辨率。" };
  }
  return { category: "unknown", advice: "未归类错误，查看完整 .failed.json 原文。" };
}

// 收集本次 job 运行期间（failedAt >= sinceISO）产生的资产失败详情。
// sinceISO 用 job.startedAt 过滤，避免把历史遗留的 .failed.json 算到本次任务头上。
function jobAssetFailures(episodeRoot, sinceISO = "", options = {}) {
  const logsDir = path.join(episodeRoot, "04_assets", "generation_logs");
  const since = sinceISO ? Date.parse(sinceISO) : 0;
  const runNamespace = normalizeRunNamespace(options.runNamespace || "");
  const targetNames = new Set((options.targetAssetNames || []).map(compactLine).filter(Boolean));
  return walkFiles(logsDir, (file) => /\.failed\.json$/i.test(file), 1)
    .map((file) => {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        return null;
      }
      const name = data.name || path.basename(file).replace(/\.failed\.json$/i, "");
      if (targetNames.size && !targetNames.has(name)) return null;
      const failedRunNamespace = normalizeRunNamespace(data.runNamespace || data.pipelineRunId || "");
      if (runNamespace && failedRunNamespace && failedRunNamespace !== runNamespace) return null;
      const failedAtMs = Date.parse(data.failedAt || "");
      if (since && Number.isFinite(failedAtMs) && failedAtMs < since) return null;
      const detail = parseImageGenFailure(data.error);
      const klass = classifyImageGenFailure(detail);
      return {
        name,
        type: data.type || "",
        failedAt: data.failedAt || "",
        code: detail.code,
        status: detail.status,
        upstreamCode: detail.upstreamCode,
        upstreamMessage: detail.upstreamMessage || detail.message,
        category: klass.category,
        advice: klass.advice,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.failedAt).localeCompare(String(b.failedAt)));
}

// job 结束（失败）时把磁盘上的真实失败原因回填进 job：写人类可读摘要到 log，并挂结构化字段。
function enrichJobWithAssetFailures(job) {
  if (!job || !job.episodeRoot) return;
  const failures = jobAssetFailures(job.episodeRoot, job.startedAt, {
    runNamespace: job.runNamespace,
    targetAssetNames: job.targetAssetNames || [],
  });
  if (!failures.length) return;
  job.failureDetails = failures;
  const byCategory = failures.reduce((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f.name);
    return acc;
  }, {});
  const summaryLines = [
    "",
    "—— 失败原因汇总（由控制台从 generation_logs 回填）——",
    ...Object.entries(byCategory).map(([cat, names]) => {
      const advice = failures.find((f) => f.category === cat)?.advice || "";
      return `[${cat}] ${names.length} 个：${names.join(", ")}\n  → ${advice}`;
    }),
  ];
  const sample = failures[0];
  if (sample) {
    summaryLines.push(
      `示例 ${sample.name}：code=${sample.code || "?"} status=${sample.status || "?"} upstream=${sample.upstreamMessage || "?"}`,
    );
  }
  job.failureReason = compactLine(summaryLines.filter((l) => l && !l.startsWith("——") && l.trim()).slice(0, 1)[0] || "");
  appendJobLog(job, `${summaryLines.join("\n")}\n`);
}

function assetSlotsForState(episodeRoot, manifest, assets = scanAssets(episodeRoot), options = {}) {
  const normalized = normalizeAssetManifest(manifest || {});
  const byName = new Map(assets.map((asset) => [asset.assetName, asset]));
  const failed = failedAssetNames(episodeRoot, {
    manifest: normalized,
    assets,
    minFailedAt: options.minFailedAt || 0,
    minModifiedAt: options.minModifiedAt || options.minFailedAt || 0,
  });
  return (normalized.items || []).map((item) => {
    const asset = byName.get(item.id) || null;
    const exists = !!asset;
    const hasFailure = failed.has(item.id);
    const skipped = item.generate === false && !exists;
    const status = skipped ? "skipped" : exists ? "ready" : hasFailure ? "failed" : "missing";
    return {
      id: item.id,
      type: item.type,
      label: item.label,
      usage: item.usage || "",
      generate: item.generate !== false,
      skipped: item.generate === false,
      status,
      statusLabel: exists ? (asset.reused ? "已生成（复用）" : "已生成") : skipped ? "不生成" : hasFailure ? "失败，可重新生成" : "缺失",
      source: exists ? asset.source || "file" : "",
      reused: !!asset?.reused,
      generated: exists,
      missing: !exists && !skipped,
      failed: hasFailure && !skipped,
      staleAsset: exists && hasFailure,
      asset,
    };
  });
}

function clampStoryboardDuration(value, fallback = 10) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(180, Math.round(n)));
}

function storyboardSecond(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function storyboardTimeRangeLabel(startSecond, endSecond) {
  return `${storyboardSecond(startSecond)}-${storyboardSecond(endSecond)}s`;
}

// 电影语言弧线的各步骤:role 文本 + 该格的动作/构图计划。格数自适应时从中挑选,
// 首格恒为 establish(建立)、末格恒为 cut(切点/交接),中间按格数补齐。
const STORYBOARD_ARC_STEPS = {
  establish: {
    role: "establishment: lock location geography, axis, major entrances/exits",
    actionArrow: "entry paths and screen direction establish the spatial axis",
    cameraFrame: "wide establishing composition with a clear horizon and axis",
  },
  blocking: {
    role: "blocking: place characters/props and define eye lines",
    actionArrow: "actor direction, breath, pause, and emotional flow are clear in the staging",
    cameraFrame: "shot scale, lens direction, and safe action area are clear in the composition",
  },
  action: {
    role: "action vector: mark the primary movement direction and camera framing",
    actionArrow: "the primary movement direction and its endpoint are clear in the staging",
    cameraFrame: "shot scale, lens direction, and safe action area are clear in the composition",
  },
  pivot: {
    role: "pivot: show the central action or turning point and the strongest movement arc",
    actionArrow: "the strongest movement arc of the turning point reads in the performance",
    cameraFrame: "the turning-point composition makes the shot scale and lens direction clear",
  },
  reaction: {
    role: "reaction: hold the consequence, counter-shot, or emotional response",
    actionArrow: "the emotional response, eyeline, and any counter-movement read in the performance",
    cameraFrame: "an insert or close-up composition isolates the reaction or controlled detail",
  },
  cut: {
    role: "cut point: end on a clean edit point and continuity handoff",
    actionArrow: "the final exit path or stillness before the cut is clear",
    cameraFrame: "a clean exit composition supports the transition or cut",
  },
};
// 格数 → 弧线步骤序列。固定 3×3 九格;首建立、末切点固定,中间依次推进调度、动作、转折和反应。
const STORYBOARD_ARC_TEMPLATES = {
  9: ["establish", "blocking", "action", "pivot", "reaction", "action", "pivot", "reaction", "cut"],
};
// 标准 3×3 九格。beatCount 只影响每格承载的剧情句子，不改变版式。
function storyboardArcRoleKeys(beatCount) {
  const n = Number(beatCount) <= STORYBOARD_MIN_PANELS ? STORYBOARD_MIN_PANELS : STORYBOARD_MAX_PANELS;
  return STORYBOARD_ARC_TEMPLATES[n] || STORYBOARD_ARC_TEMPLATES[STORYBOARD_MAX_PANELS];
}

function storyboardSegmentForSecond(segments, second) {
  if (!segments.length) return null;
  return (
    segments.find((segment) => {
      const start = Number(segment.startSecond || 0);
      const end = Number(segment.endSecond || start + (segment.duration || 0));
      return second >= start && second < end;
    }) || segments[segments.length - 1]
  );
}

function readableStoryboardText(value) {
  return compactLine(String(value || "").replace(/^E\d+_V\d+_?/i, "").replace(/_/g, " "));
}

function readableBeatText(value) {
  return compactLine(String(value || "").replace(/•\s*对白(?:[（(][^）)]*[）)])?\s*[：:]\s*◦?\s*/g, ""));
}

function stripStoryboardDialogueForVisual(value) {
  let text = String(value || "");
  text = stripExplicitInlineDialogues(text);
  text = text.replace(/•\s*对白(?:[（(][^）)]*[）)])?\s*[：:]\s*/gi, " ");
  text = text.replace(/[“"][^”"\n]{1,240}[”"]/g, " ");
  text = text.replace(/[‘'][^’'\n]{1,240}[’']/g, " ");
  text = text.replace(/[（(]\s*[A-Za-z][^()（）]{1,180}\s*[）)]/g, " ");
  text = text.replace(/\b[A-Z][A-Z .'\-]{1,32}\s*[：:]\s*[^。！？!?]{1,180}/g, " ");
  return compactLine(text);
}

function storyboardBeatUnits(segment = {}) {
  const beat = stripStoryboardDialogueForVisual(readableStoryboardText(segment.beat || ""));
  return beat
    .split(/(?<=[。！？!?])\s+|(?<=[。！？!?])|(?:\s+\/\s+)/)
    .map(compactLine)
    .filter((item) => item.length >= 4);
}

function storyboardPanelSourceText(segment = {}, localIndex = 0, localCount = 1) {
  const title = readableStoryboardText(segment.title || segment.key || "");
  const beat = stripStoryboardDialogueForVisual(readableStoryboardText(segment.beat || ""));
  const pollutedBeat =
    /提示词\s*\d|角色设定|character sheet|三视图|full body three view|pure white background|纯白背景/i.test(beat);
  const beatUnits = pollutedBeat ? [] : storyboardBeatUnits(segment);
  if (beatUnits.length) {
    // 把本段落的句子按它占用的面板数均分成连续块,第 localIndex 块给本面板:
    // 每句只进一个面板(不重复),所有句子都被某个面板覆盖(不断点)。
    const total = beatUnits.length;
    const count = Math.max(1, localCount);
    const idx = Math.max(0, Math.min(localIndex, count - 1));
    const start = Math.floor((idx * total) / count);
    const end = Math.max(start + 1, Math.floor(((idx + 1) * total) / count));
    return compactLine(beatUnits.slice(start, end).join(" "));
  }
  if (beat && !pollutedBeat) return beat;
  if (title && !/^V\d+$/i.test(title)) return title;
  return title || "Visualize this story beat with clear blocking.";
}

function normalizeDialogueItems(value, dialogueLanguage = "en") {
  const source = Array.isArray(value) ? value : [];
  const language = normalizeDialogueLanguage(dialogueLanguage, "en");
  return source
    .map((item) => {
      if (typeof item === "string") {
        const text = compactLine(item);
        const speakerMatch = text.match(/^([^：:]{1,32})[：:]\s*(.+)$/);
        const spoken = normalizeDialogueForLanguage(speakerMatch?.[2] || text, language);
        if (!spoken) return null;
        return {
          speaker: compactLine(speakerMatch?.[1] || ""),
          text: spoken,
        };
      }
      if (!item || typeof item !== "object") return null;
      const rawText = compactLine(item.text || item.line || item.dialogue || "");
      const spoken = normalizeDialogueForLanguage(rawText, language);
      if (!spoken) return null;
      return {
        speaker: compactLine(item.speaker || item.character || item.name || ""),
        text: spoken,
      };
    })
    .filter((item) => item?.text)
    .slice(0, 6);
}

// 合并模型对白与剧本对白:优先保留模型台词内容,但说话人以剧本(带 speaker)为准回填。
// - 模型行已带 speaker 的,保留;
// - 模型行缺 speaker 的,先按台词包含关系匹配,必要时由同序本镜对白兜底;
// - appendMissing 只补入目标语言的剧本对白。
function backfillDialogueSpeakers(
  modelItems = [],
  beatDialogues = [],
  { appendMissing = true, positional = false, dialogueLanguage = "en" } = {},
) {
  const model = Array.isArray(modelItems) ? modelItems.filter((item) => item?.text) : [];
  const script = Array.isArray(beatDialogues) ? beatDialogues.filter((item) => item?.text) : [];
  if (!model.length) {
    return script
      .map((item) => ({ ...item, text: normalizeDialogueForLanguage(item.text, dialogueLanguage) }))
      .filter((item) => item.text)
      .slice(0, 4);
  }
  const filled = model.map((item, index) => {
    if (item.speaker) return item;
    const hit = script.find(
      (s) => s.speaker && (s.text.includes(item.text) || item.text.includes(s.text)),
    );
    if (hit) return { speaker: hit.speaker, text: item.text };
    const positionalHit = positional && script[index]?.speaker ? script[index] : null;
    return positionalHit ? { speaker: positionalHit.speaker, text: item.text } : item;
  });
  // 模型完全没提到、但剧本里有的对白(且带 speaker)补进来,避免漏台词。
  // appendMissing=false 时只补 speaker、不追加(用于全剧本 map:否则会把别的 shot 台词灌进来)。
  if (appendMissing) {
    for (const s of script) {
      if (!s.speaker) continue;
      const text = normalizeDialogueForLanguage(s.text, dialogueLanguage);
      if (!text) continue;
      if (filled.some((d) => d.text.includes(text) || text.includes(d.text))) continue;
      filled.push({ speaker: s.speaker, text });
    }
  }
  return filled.slice(0, 4);
}

// 全剧本 speaker 地图:从脚本提取所有角色台词(无上限),用于 config 阶段为模型对白补 speaker。
// 必须覆盖 dialoguesForText 的全部四种格式(否则标准剧本格式C/项目符号D的项目会拿到空 map):
//  ① parseSpeakerDialogues — 说话人独占行、台词在下(标准剧本格式)
//  ② explicitInlineDialogues — 「◦名字：台词」项目符号格式
//  ③ inlineColonDialogues — 密集内联「名字：台词」(竹编式)、多行冒号
//  ④ quotedDialoguesForText — 引号包裹台词
// 区别于 dialoguesForText:这里处理全文、不设 slice 上限,覆盖跨节拍全部台词。
function buildScriptSpeakerMap(script, dialogueLanguage = "zh") {
  const source = String(script || "");
  const lang = normalizeDialogueLanguage(dialogueLanguage, "en");
  const out = [];
  const push = (block) => {
    if (!block?.speaker || !block?.text) return;
    const bilingual = splitBilingualDialogue(block.text);
    const spoken = lang === "zh" ? bilingual.zh || block.text : bilingual.en || block.text;
    if (spoken && !out.some((d) => d.speaker === block.speaker && d.text === spoken)) out.push({ speaker: block.speaker, text: spoken });
  };
  for (const block of extractDialogueBlocks(stripExplicitInlineDialogues(source))) push(block); // 用底层提取器,绕过 parseSpeakerDialogues 的 12 条上限
  for (const block of explicitInlineDialogues(source)) push(block);
  for (const block of inlineColonDialogues(source, lang, { limit: Infinity })) push(block);
  for (const block of quotedDialoguesForText(source, lang)) push(block);
  return out;
}

// 从 seedance section body 提取「对白：」行内容,拆分并去掉模型可能自加的「名字：」前缀,返回纯台词字符串数组。
// 之所以直接读对白行而不用 dialoguesForText(beat),是因为 beat 在 config 阶段可能是设计块(不含台词)。
function parseSectionDialogueTexts(sectionBody = "") {
  const match = String(sectionBody).match(/^[ \t]*对白\s*[：:]\s*(.+)/m);
  if (!match) return [];
  const line = compactLine(match[1]);
  if (!line || /^（无|无台词|—|无对白/i.test(line)) return [];
  return line
    .split(/\s*\/\s*/)
    .map((seg) => {
      // 去掉模型可能自加的「名字：台词」前缀,只留台词文本
      const inner = seg.replace(/^[^：:]{2,8}[：:]/, "").trim();
      return compactLine(inner || seg);
    })
    .filter(Boolean);
}

// config 阶段的 shot 对白解析:优先从 section body 的对白行取台词文本,再用剧本 speakerMap 匹配说话人。
// beat 是 fallback(当 section 没有对白行时用 dialoguesForText(beat))。
function dialoguesForShotWithSpeakers(beat, sectionBody, speakerMap, dialogueLanguage) {
  const texts = parseSectionDialogueTexts(sectionBody);
  if (texts.length) {
    const items = texts.slice(0, 4).map((text) => ({ speaker: "", text }));
    // appendMissing=false:只给本 shot 的模型台词补 speaker,不把全剧本其他台词灌进来。
    return backfillDialogueSpeakers(items, speakerMap, { appendMissing: false, positional: false, dialogueLanguage });
  }
  // fallback:直接从剧本 beat 提取(beat 可能是真实剧本节拍)
  return dialoguesForText(beat, dialogueLanguage);
}

function dialogueItemsForSegment(segment = {}) {
  const existing = normalizeDialogueItems(segment.dialogues || segment.dialogueLines || [], segment.dialogueLanguage || "en");
  if (existing.length) return existing;
  return normalizeDialogueItems(dialoguesForText(`${segment.beat || ""} ${segment.title || ""}`, segment.dialogueLanguage || "en"), segment.dialogueLanguage || "en");
}

function normalizeDialogueLanguage(value, fallback = "en") {
  if (value === "zh" || value === "中文" || value === "cn") return "zh";
  if (value === "en" || value === "英文") return "en";
  return fallback === "zh" ? "zh" : "en";
}

function projectDialogueLanguage(episodeRoot, fallback = "en") {
  const config = readVideoConfig(episodeRoot)?.data;
  const manifest = readAssetManifest(episodeRoot)?.data;
  const storyboardText = readText(findProjectFile(episodeRoot, "storyboard"));
  const seedanceText = readText(findProjectFile(episodeRoot, "seedancePrompts"));
  const configured =
    config?.dialogueLanguage ||
    config?.settings?.dialogueLanguage ||
    manifest?.dialogueLanguage ||
    manifest?.production?.dialogueLanguage ||
    (/中文对白/.test(storyboardText) || /中文对白/.test(seedanceText) ? "zh" : /英文对白/.test(storyboardText) || /英文对白/.test(seedanceText) ? "en" : "");
  return normalizeDialogueLanguage(configured, fallback);
}

function persistProjectDialogueLanguage(episodeRoot, dialogueLanguage) {
  const normalized = normalizeDialogueLanguage(dialogueLanguage, "en");
  const manifestRecord = readAssetManifest(episodeRoot);
  if (manifestRecord?.data) {
    writeAssetManifest(episodeRoot, {
      ...manifestRecord.data,
      dialogueLanguage: normalized,
      production: {
        ...(manifestRecord.data.production || {}),
        dialogueLanguage: normalized,
      },
    });
  }
  const configRecord = readVideoConfig(episodeRoot);
  if (configRecord?.file && configRecord?.data) {
    const next = {
      ...configRecord.data,
      dialogueLanguage: normalized,
      settings: {
        ...(configRecord.data.settings || {}),
        dialogueLanguage: normalized,
      },
    };
    writeText(configRecord.file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return normalized;
}

function resetVideoCanvasBindingForNewDraft(episodeRoot) {
  const reset = resetWorkflowForContentChange(episodeRoot, "new draft rebuilt from script");
  const workflow = reset.workflow;
  const configRecord = readVideoConfig(episodeRoot);
  if (configRecord?.file && configRecord?.data) {
    const next = {
      ...configRecord.data,
      groupName: isolatedDefaultGroupName(episodeRoot, workflow.currentNamespace),
      ...isolationMetadataFor(episodeRoot, workflow),
      shots: [],
      assets: [],
      storyboardReferences: [],
      storyboardPlans: [],
      workflowGuide: {
        phase: "draft_ready",
        updatedAt: new Date().toISOString(),
      },
    };
    writeText(configRecord.file, `${JSON.stringify(next, null, 2)}\n`);
  }
  return reset;
}

function assetManifestIdentityMap(manifest = {}) {
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  return new Map(
    items
      .map((item) => {
        const id = compactLine(item?.id || item?.name || "");
        const type = normalizeAssetType(item?.type || inferAssetTypeFromName(id), "Prop");
        return id ? [id, type] : null;
      })
      .filter(Boolean),
  );
}

function assetManifestIdentityChanged(previous = {}, next = {}) {
  const before = assetManifestIdentityMap(previous);
  const after = assetManifestIdentityMap(next);
  if (!before.size) return false;
  if (before.size !== after.size) return true;
  for (const [id, type] of before) {
    if (after.get(id) !== type) return true;
  }
  return false;
}

function hasUnboundVideoDerivatives(episodeRoot, manifest = {}) {
  const promptText = readText(findProjectFile(episodeRoot, "seedancePrompts"));
  const hasPromptShots = parsePromptSections(promptText).some(isShotPromptSection);
  const config = readVideoConfig(episodeRoot, { allowEmptyShots: true })?.data || {};
  const hasConfigShots = Array.isArray(config.shots) && config.shots.length > 0;
  if (!hasPromptShots && !hasConfigShots) return false;
  const productionAssets = projectProductionAssetsForState(episodeRoot, normalizeAssetManifest(manifest));
  return !productionAssets.some((asset) => !asset.invalid && !(asset.conflicts || []).length);
}

function moveWorkflowArtifactToArchive(episodeRoot, source, archiveRoot) {
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) return "";
  const rel = path.relative(episodeRoot, source).replace(/^(\.\.[/\\])+/, "");
  if (!rel || rel.startsWith("..")) return "";
  const target = path.join(archiveRoot, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
  return target;
}

function invalidateDerivedVideoArtifactsForAssetManifestChange(episodeRoot, previous = {}, next = {}) {
  const reason = "asset manifest identities changed";
  const reset = resetWorkflowForContentChange(episodeRoot, reason);
  const archiveRoot = reset.archive?.archiveDir || path.join(episodeRoot, "06_videos", "workflow_archive", new Date().toISOString().replace(/[:.]/g, "-"));
  const defaults = defaultPaths(episodeRoot);
  const staleFiles = [
    findProjectFile(episodeRoot, "storyboard"),
    defaults.storyboard,
    findProjectFile(episodeRoot, "seedancePrompts"),
    defaults.seedancePrompts,
  ];
  const archived = [...new Set(staleFiles)].map((file) => moveWorkflowArtifactToArchive(episodeRoot, file, archiveRoot)).filter(Boolean);
  const workflow = reset.workflow;
  const configRecord = readVideoConfig(episodeRoot, { allowEmptyShots: true });
  if (configRecord?.file && configRecord?.data) {
    const nextConfig = {
      ...configRecord.data,
      groupName: isolatedDefaultGroupName(episodeRoot, workflow.currentNamespace),
      ...isolationMetadataFor(episodeRoot, workflow),
      promptsPath: "",
      shots: [],
      assets: [],
      storyboardReferences: [],
      storyboardPlans: [],
      missingAssets: [],
      rejectedAssets: [],
      referenceWarnings: ["资产清单的 ID 或类型已变更；旧分镜和视频提示词已归档，需在资产图生成后重新建立视频配置。"],
      configReady: false,
      tailFrameAssets: {},
      videoCanvasId: createVideoCanvasId(episodeRoot),
      videoCanvasCreatedAt: new Date().toISOString(),
    };
    writeText(configRecord.file, `${JSON.stringify(nextConfig, null, 2)}\n`);
  }
  writeText(
    path.join(archiveRoot, "asset_manifest_change.json"),
    `${JSON.stringify(
      {
        reason,
        invalidatedAt: new Date().toISOString(),
        previous: [...assetManifestIdentityMap(previous)],
        next: [...assetManifestIdentityMap(next)],
        archived: archived.map((file) => path.relative(episodeRoot, file)),
      },
      null,
      2,
    )}\n`,
  );
  return { reset, archiveDir: archiveRoot, archived };
}

// 在一块 panelCount 格的板里,把 count 句对白铺到"中间格"(尽量避开首建立格和末切点格),
// 返回的索引一律落在 [0, panelCount-1],不会溢出到不存在的格(否则台词会被悄悄丢掉)。
function dialoguePanelSlots(count, panelCount = STORYBOARD_MAX_PANELS) {
  const n = Math.max(STORYBOARD_MIN_PANELS, Math.min(STORYBOARD_MAX_PANELS, panelCount));
  const need = Math.max(1, Math.min(count, n));
  const interior = [];
  for (let i = 1; i < n - 1; i += 1) interior.push(i);
  const pool = interior.length >= need ? interior : Array.from({ length: n }, (_, i) => i);
  if (need === 1) return [pool[Math.floor((pool.length - 1) / 2)]];
  const slots = [];
  for (let i = 0; i < need; i += 1) {
    slots.push(pool[Math.round((i * (pool.length - 1)) / (need - 1))]);
  }
  return [...new Set(slots)];
}

function panelDialogueForSegment(segment = {}, panelIndex = 0, panelCount = STORYBOARD_MAX_PANELS) {
  const dialogues = dialogueItemsForSegment(segment);
  if (!dialogues.length) return null;
  const slots = dialoguePanelSlots(dialogues.length, panelCount);
  const dialogueIndex = slots.indexOf(panelIndex);
  if (dialogueIndex < 0) return null;
  const item = dialogues[dialogueIndex];
  return {
    speaker: item.speaker || "角色",
    text: item.text,
    role: "本面板说出这句对白；嘴型、表情、眼神和动作必须与该句同步",
    caption: `${item.speaker ? `${item.speaker}: ` : ""}${item.text}`,
  };
}

function storyboardProductionTabForPanel(roleKey = "", details = {}) {
  const role = compactLine(roleKey || "action");
  const presets = {
    establish: {
      camera: "locked / slow push-in; establish screen axis",
      shot: "extreme wide establish",
      lens: "24mm, deep focus",
      lighting: "motivated location depth",
      emotion: "anticipation / orientation",
    },
    blocking: {
      camera: "measured dolly / static; keep eyelines",
      shot: "medium-wide staging",
      lens: "35mm natural perspective",
      lighting: "motivated key separation",
      emotion: "controlled tension / intent",
    },
    action: {
      camera: "track / pan with movement to endpoint",
      shot: "dynamic medium",
      lens: "40mm action lens",
      lighting: "directional light; retain prop detail",
      emotion: "urgency / momentum",
    },
    pivot: {
      camera: "deliberate push-in / pivot on change",
      shot: "medium-close turning point",
      lens: "50mm selective focus",
      lighting: "contrast rises on change",
      emotion: "revelation / change",
    },
    reaction: {
      camera: "hold eyeline; restrained micro push-in",
      shot: "close-up / detail reaction",
      lens: "85mm portrait",
      lighting: "controlled key / eye light / falloff",
      emotion: "consequence / recognition",
    },
    cut: {
      camera: "stable hold for a clean cut handoff",
      shot: "medium exit / resolved detail",
      lens: "50mm continuity",
      lighting: "preserve established light",
      emotion: "suspense / release / question",
    },
  };
  const preset = presets[role] || presets.action;
  const dialogue = details.dialogue?.text
    ? `${compactLine(details.dialogue.speaker || "Character")}: \"${details.dialogue.text}\"`
    : "No spoken dialogue; play the silent reaction, breath, pause, or listening beat.";
  return {
    visual: compactLine(details.description || details.title || "Render the scripted story beat with the bound production assets."),
    camera: compactLine(details.camera || preset.camera),
    shot: compactLine(details.shot || preset.shot),
    lens: compactLine(details.lens || preset.lens),
    lighting: compactLine(details.lighting || preset.lighting),
    emotion: compactLine(details.emotion || preset.emotion),
    dialogue,
    action: compactLine(details.action || "Stage the performed action with a clear direction and endpoint."),
    continuity: compactLine(details.continuity || "Preserve axis, eyeline, movement direction, and prop state."),
  };
}

// 一块 Production Board = 一个完整的 ≤15 秒剧情单元。统一固定为竖版 3×3 九格，
// 首格恒为建立、末格恒为切点/交接，中间七格推进站位、动作、转折和反应。
// options.prevBoardTail:上一块板收尾格的描述;若提供,本板首格显式要求"与上一块板的最后一格保持一致"(跨板续接)。
function storyboardPanelPlanForGroup(group, options = {}) {
  const segments = Array.isArray(group?.segments) ? group.segments : [];
  const groupStart = storyboardSecond(group?.startSecond || 0);
  const duration = Math.max(1, storyboardSecond(group?.duration || STORYBOARD_MAX_SECONDS));
  const beatUnitCount = segments.reduce((acc, seg) => acc + storyboardBeatUnits(seg).length, 0);
  const roleKeys = storyboardArcRoleKeys(beatUnitCount || STORYBOARD_MIN_PANELS);
  const panelCount = roleKeys.length;
  const panelDuration = duration / panelCount;
  const prevTail = compactLine(options.prevBoardTail || "");
  const panelSegments = roleKeys.map((key, index) => {
    const startSecond = storyboardSecond(groupStart + panelDuration * index);
    const endSecond = storyboardSecond(index === panelCount - 1 ? groupStart + duration : groupStart + panelDuration * (index + 1));
    const mid = startSecond + (endSecond - startSecond) / 2;
    return storyboardSegmentForSecond(segments, mid) || {};
  });
  return roleKeys.map((key, index) => {
    const step = STORYBOARD_ARC_STEPS[key];
    const role = step.role;
    const isFirst = index === 0;
    const isLast = index === panelCount - 1;
    const startSecond = storyboardSecond(groupStart + panelDuration * index);
    const endSecond = storyboardSecond(isLast ? groupStart + duration : groupStart + panelDuration * (index + 1));
    const segment = panelSegments[index];
    const sameSegmentPanels = panelSegments.reduce((acc, seg, i) => (seg === segment ? acc.concat(i) : acc), []);
    const localCount = sameSegmentPanels.length || 1;
    const localIndex = Math.max(0, sameSegmentPanels.indexOf(index));
    const shotNames = [...new Set((segment.sourceShotNames || [segment.key]).map(compactLine).filter(Boolean))];
    const sourceText = storyboardPanelSourceText(segment, localIndex, localCount);
    const dialogue = panelDialogueForSegment(segment, index, panelCount);
    const description = compactLine(`${role}: ${sourceText}`);
    // 跨板续接:本板首格若有上一块板的收尾状态,必须与之一致(同一画面/朝向/站位),等价于尾帧首帧。
    const continuityExit = isLast
      ? "this exact frame is the opening frame of the next board; keep a clean cut point and preserve screen direction, scene geography, prop state, and eyeline"
      : "preserve spatial axis, eyeline, prop position, and movement direction for the next panel";
    const continuityEntry =
      isFirst && prevTail
        ? `MATCH the previous board's final frame: same location, camera direction, character blocking, prop state and eyeline as [${prevTail.slice(0, 160)}]; treat this as the continuous first frame.`
        : "";
    return {
      panel: index + 1,
      label: `P${index + 1}`,
      role: key,
      startSecond,
      endSecond,
      duration: storyboardSecond(endSecond - startSecond),
      timeRange: storyboardTimeRangeLabel(startSecond, endSecond),
      sourceShotNames: shotNames,
      title: compactLine(segment.title || segment.key || `Panel ${index + 1}`),
      description,
      refs: Array.isArray(segment.refs) ? segment.refs.map(compactLine).filter(Boolean) : [],
      actionArrow: step.actionArrow,
      cameraFrame: step.cameraFrame,
      continuityExit,
      ...(continuityEntry ? { continuityEntry } : {}),
      dialogue,
      production: storyboardProductionTabForPanel(key, {
        title: segment.title || segment.key,
        description,
        dialogue,
        action: step.actionArrow,
        camera: step.cameraFrame,
        continuity: [continuityEntry, continuityExit].filter(Boolean).join(" "),
      }),
      assetAnchors: Array.isArray(segment.refs) ? segment.refs.map(compactLine).filter(Boolean) : [],
      videoUse: `${role}. Use the numbered panel's composition, blocking, camera direction, shot rhythm, and cut point; its bound production-asset identity and visual style are baked into this Production Board.`,
    };
  });
}

function defaultStoryboardPanels() {
  return storyboardPanelPlanForGroup({
    startSecond: 0,
    duration: STORYBOARD_MAX_SECONDS,
    segments: [
      {
        key: "FULL_EPISODE",
        title: "Full episode opening storyboard",
        beat: "Waiting for script, storyboard, or video prompt timing.",
        duration: STORYBOARD_MAX_SECONDS,
        startSecond: 0,
        endSecond: STORYBOARD_MAX_SECONDS,
        sourceShotNames: [],
        refs: [],
      },
    ],
  });
}

function storyboardSegmentsFromShots(shots = [], dialogueLanguage = "en") {
  let cursor = 0;
  const projectLanguage = normalizeDialogueLanguage(dialogueLanguage, "en");
  return (Array.isArray(shots) ? shots : [])
    .map((shot, index) => {
      const duration = clampStoryboardDuration(shot?.duration, 10);
      const name = compactLine(shot?.name || shot?.id || `V${String(index + 1).padStart(3, "0")}`);
      const dialogueItems = normalizeDialogueItems(
        Array.isArray(shot?.dialogues) && shot.dialogues.length ? shot.dialogues : shot?.dialogueLines || [],
        projectLanguage,
      );
      const segment = {
        key: name,
        title: compactLine(shot?.title || shot?.promptSection || name || `剧情段 ${index + 1}`),
        beat: compactLine(shot?.beat || shot?.purpose || shot?.prompt || ""),
        duration,
        startSecond: cursor,
        endSecond: cursor + duration,
        sourceShotNames: [name].filter(Boolean),
        refs: Array.isArray(shot?.refs) ? shot.refs.map(compactLine).filter(Boolean) : [],
        sceneRef: compactLine(shot?.sceneRef || ""),
        dialogues: dialogueItems,
        dialogueLanguage: projectLanguage,
      };
      cursor += duration;
      return segment;
    })
    .filter((segment) => segment.key || segment.title || segment.beat);
}

function storyboardSegmentsFromSeedancePrompts(episodeRoot, dialogueLanguage = "en") {
  const promptPath = findProjectFile(episodeRoot, "seedancePrompts");
  const promptMarkdown = stripSeedancePromptRules(readText(promptPath));
  const sections = parsePromptSections(promptMarkdown).filter(isShotPromptSection);
  let cursor = 0;
  return sections.map((section, index) => {
    const duration = clampStoryboardDuration(section.body.match(/(?:推荐时长|duration|时长)[:：]?\s*(\d+)/i)?.[1], 10);
    const title =
      compactLine(section.body.match(/核心画面[:：]\s*([^\n。]+)/)?.[1]) ||
      compactLine(section.body.match(/分镜目标[:：]\s*([^\n。]+)/)?.[1]) ||
      compactLine(section.name);
    const refsLine = compactLine(section.body.match(/参考资产[:：]\s*([^\n]+)/)?.[1] || "");
    const refs = refsLine
      .split(/\s*,\s*/)
      .map(compactLine)
      .filter(Boolean);
    const name = compactLine(section.name || `V${String(index + 1).padStart(3, "0")}`);
    const bodyWithoutFences = section.body.replace(/```[\s\S]*?```/g, " ");
    const dialogues = normalizeDialogueItems(dialoguesForText(section.body, dialogueLanguage), dialogueLanguage);
    const segment = {
      key: name,
      title: title || name || `剧情段 ${index + 1}`,
      beat: compactLine(bodyWithoutFences.slice(0, 600)),
      duration,
      startSecond: cursor,
      endSecond: cursor + duration,
      sourceShotNames: [name].filter(Boolean),
      refs,
      sceneRef: refs.find((ref) => inferAssetTypeFromName(ref) === "Scene") || "",
      dialogues,
      dialogueLanguage,
    };
    cursor += duration;
    return segment;
  });
}

function storyboardSegmentsFromStoryboardMarkdown(episodeRoot, dialogueLanguage = "en") {
  const markdown = readText(findProjectFile(episodeRoot, "storyboard"));
  const tableSegments = [];
  let tableCursor = 0;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    if (/^\|\s*-+/.test(trimmed) || /\|\s*ID\s*\|/i.test(trimmed)) continue;
    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => compactLine(cell.replace(/\\\|/g, "|")));
    if (cells.length < 5) continue;
    const [nameCell, durationCell, titleCell, refsCell, beatCell] = cells;
    const name = compactLine(nameCell);
    if (!/^E\d+_V\d+|^V\d+/i.test(name)) continue;
    const duration = clampStoryboardDuration(durationCell.match(/\d+/)?.[0], 10);
    const refs = refsCell
      .split(/\s*,\s*/)
      .map(compactLine)
      .filter(Boolean);
    const segment = {
      key: name,
      title: readableStoryboardText(titleCell || name),
      beat: compactLine(beatCell || titleCell || name),
      duration,
      startSecond: tableCursor,
      endSecond: tableCursor + duration,
      sourceShotNames: [name],
      refs,
      sceneRef: refs.find((ref) => inferAssetTypeFromName(ref) === "Scene") || "",
      dialogues: normalizeDialogueItems(dialoguesForText(beatCell || titleCell || name, dialogueLanguage), dialogueLanguage),
      dialogueLanguage,
    };
    tableCursor += duration;
    tableSegments.push(segment);
  }
  if (tableSegments.length) return tableSegments;

  const sections = [...String(markdown || "").matchAll(/^###\s+(.+?)\s*$/gm)];
  let cursor = 0;
  return sections.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < sections.length ? sections[index + 1].index : markdown.length;
    const body = markdown.slice(start, end);
    const duration = clampStoryboardDuration(body.match(/(?:时长|推荐时长|duration)[:：]\s*(\d+)/i)?.[1], 10);
    const name = compactLine(match[1] || `V${String(index + 1).padStart(3, "0")}`);
    const title = compactLine(body.match(/(?:标题|分镜目标)[:：]\s*([^\n]+)/)?.[1]) || name;
    const segment = {
      key: name,
      title,
      beat: compactLine(body.match(/(?:剧本依据|分镜目标)[:：]\s*([^\n]+)/)?.[1] || body.slice(0, 500)),
      duration,
      startSecond: cursor,
      endSecond: cursor + duration,
      sourceShotNames: [name].filter(Boolean),
      refs: [],
      sceneRef: "",
      dialogues: normalizeDialogueItems(dialoguesForText(body, dialogueLanguage), dialogueLanguage),
      dialogueLanguage,
    };
    cursor += duration;
    return segment;
  });
}

function fallbackStoryboardSegmentsFromScript(episodeRoot, dialogueLanguage = "en") {
  const script = scriptForVideoBeats(readText(findProjectFile(episodeRoot, "script")));
  if (!script.trim()) return [];
  const rawBeats = scriptBeatCandidates(script);
  const continuityBeats = consolidateContinuousBeats(rawBeats);
  const targetShotCount = preferredShotCount(script, continuityBeats);
  const beats = fitBeatsToCountWithoutDuplicateTranslation(continuityBeats, targetShotCount, { dialogueLanguage });
  const durationPlan = planEpisodeDuration({ shotCount: beats.length || targetShotCount, beats });
  let cursor = 0;
  return beats.map((beat, index) => {
    const duration = clampStoryboardDuration(durationPlan.durations[index], 10);
    const name = `V${String(index + 1).padStart(3, "0")}_${safeAssetSlug(beatTitle(beat, index), "BEAT").slice(0, 28)}`;
    const segment = {
      key: name,
      title: beatTitle(beat, index),
      beat,
      duration,
      startSecond: cursor,
      endSecond: cursor + duration,
      sourceShotNames: [name],
      refs: [],
      sceneRef: "",
      dialogues: normalizeDialogueItems(dialoguesForText(beat, dialogueLanguage), dialogueLanguage),
      dialogueLanguage,
    };
    cursor += duration;
    return segment;
  });
}

function storyboardSegmentsForEpisode(episodeRoot, configData = null) {
  const dialogueLanguage = normalizeDialogueLanguage(configData?.dialogueLanguage || configData?.settings?.dialogueLanguage || projectDialogueLanguage(episodeRoot), "en");
  const fromConfig = storyboardSegmentsFromShots(configData?.shots || [], dialogueLanguage);
  if (fromConfig.length) return fromConfig;
  const fromStoryboard = storyboardSegmentsFromStoryboardMarkdown(episodeRoot, dialogueLanguage);
  if (fromStoryboard.length) return fromStoryboard;
  const fromSeedance = storyboardSegmentsFromSeedancePrompts(episodeRoot, dialogueLanguage);
  if (fromSeedance.length) return fromSeedance;
  return fallbackStoryboardSegmentsFromScript(episodeRoot, dialogueLanguage);
}

function splitStoryboardSegment(segment) {
  const duration = clampStoryboardDuration(segment.duration, 10);
  if (duration <= PRODUCTION_BOARD_MAX_SECONDS) return [{ ...segment, duration, partIndex: 1, partCount: 1 }];
  const parts = [];
  let remaining = duration;
  let offset = 0;
  const partCount = Math.ceil(duration / PRODUCTION_BOARD_MAX_SECONDS);
  // 把该段落的剧情句子与对白按 part 数切开,每个 part 只承载自己的部分,
  // 避免多个 Production Board 逐字重复展示同一段剧情。
  const beatUnits = storyboardBeatUnits(segment);
  const dialogues = Array.isArray(segment.dialogues) ? segment.dialogues : [];
  const sliceByPart = (arr, i) => {
    const start = Math.floor((i * arr.length) / partCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * arr.length) / partCount));
    return arr.slice(start, end);
  };
  for (let partIndex = 1; remaining > 0; partIndex += 1) {
    const partDuration = Math.min(PRODUCTION_BOARD_MAX_SECONDS, remaining);
    const i = partIndex - 1;
    const partBeat = beatUnits.length ? sliceByPart(beatUnits, i).join(" ") : "";
    parts.push({
      ...segment,
      beat: partBeat || segment.beat,
      dialogues: dialogues.length ? sliceByPart(dialogues, i) : segment.dialogues,
      key: `${segment.key}_P${partIndex}`,
      title: `${segment.title} ${partIndex}/${partCount}`,
      duration: partDuration,
      startSecond: (segment.startSecond || 0) + offset,
      endSecond: (segment.startSecond || 0) + offset + partDuration,
      partIndex,
      partCount,
      forceOwnStoryboard: true,
    });
    offset += partDuration;
    remaining -= partDuration;
  }
  return parts;
}

function productionBoardGroupKey(segment) {
  const refs = Array.isArray(segment?.refs) ? segment.refs.map(compactLine).filter(Boolean) : [];
  const scene = compactLine(segment?.sceneRef || refs.find((ref) => inferAssetTypeFromName(ref) === "Scene") || "");
  const characters = refs.filter((ref) => inferAssetTypeFromName(ref) === "Character").sort().join("+");
  const props = refs.filter((ref) => ["Prop", "Insert"].includes(inferAssetTypeFromName(ref))).sort().join("+");
  return [scene || "NO_SCENE", characters || "NO_CHARACTER", props || "NO_PROP"].join("|");
}

function storyboardGroupsForSegments(segments) {
  const groups = [];
  let current = null;
  const flush = () => {
    if (current?.segments?.length) groups.push(current);
    current = null;
  };
  for (const part of segments.flatMap(splitStoryboardSegment)) {
    const groupKey = productionBoardGroupKey(part);
    if (!current || part.forceOwnStoryboard || current.groupKey !== groupKey || current.duration + part.duration > PRODUCTION_BOARD_MAX_SECONDS) {
      flush();
      current = {
        segments: [],
        duration: 0,
        startSecond: part.startSecond || 0,
        endSecond: part.endSecond || part.duration,
        groupKey,
      };
    }
    current.segments.push(part);
    current.duration += part.duration;
    current.endSecond = part.endSecond || current.startSecond + current.duration;
    if (part.forceOwnStoryboard || current.duration >= PRODUCTION_BOARD_MAX_SECONDS) flush();
  }
  flush();
  return groups;
}

// 从故事板文件名中解析它覆盖的镜头 stem 集合(稳定键),如
// "SB006_E01_V006_TO_E01_V007_PRODUCTION_BOARD" -> ["E01_V006","E01_V007"]。
// 用于按镜头集合(而非字面文件名)匹配磁盘故事板与当前分组 slot,避免重分组导致的名字漂移断链。
function storyboardShotStemsFromName(assetName = "") {
  const text = String(assetName || "");
  const stems = text.match(/E\d+_V\d+/gi) || [];
  const bareStems = (text.match(/(?:^|_)V\d+/gi) || []).map((s) => s.replace(/^_/, ""));
  return [...new Set([...stems, ...bareStems].map((s) => s.toUpperCase()))];
}

// 为当前 slot 在候选故事板资产里找最佳匹配:精确同名优先;否则按镜头集合(sourceShotNames)匹配。
// 返回 { asset, coverage: "full"|"partial"|null };partial 表示旧板只覆盖了当前 slot 的部分镜头。
function matchStoryboardAssetForSlot(slot, storyboardAssets = [], usedNames = new Set()) {
  const exact = storyboardAssets.find((a) => a.assetName === slot.id && !usedNames.has(a.assetName));
  if (exact) return { asset: exact, coverage: "full" };
  const wanted = new Set((slot.sourceShotNames || []).flatMap((s) => {
    const stem = shotStemFromName(s).toUpperCase();
    const bare = stem.match(/(V\d+)$/i)?.[1]?.toUpperCase() || "";
    return [stem, bare].filter(Boolean);
  }));
  if (!wanted.size) return { asset: null, coverage: null };
  let best = null;
  for (const asset of storyboardAssets) {
    if (usedNames.has(asset.assetName)) continue;
    const stems = storyboardShotStemsFromName(asset.assetName);
    if (!stems.length) continue;
    const overlap = stems.filter((s) => wanted.has(s));
    if (!overlap.length) continue;
    const coversAll = [...wanted].every((s) => stems.includes(s)) && stems.every((s) => wanted.has(s));
    const score = overlap.length + (coversAll ? 100 : 0);
    if (!best || score > best.score) best = { asset, coverage: coversAll ? "full" : "partial", score };
  }
  return best ? { asset: best.asset, coverage: best.coverage } : { asset: null, coverage: null };
}

function storyboardSlotNameForGroup(group, index) {
  const first = group.segments[0] || {};
  const last = group.segments[group.segments.length - 1] || first;
  const firstName = shotStemFromName(first.key || first.sourceShotNames?.[0] || `V${String(index + 1).padStart(3, "0")}`);
  const lastName = shotStemFromName(last.key || last.sourceShotNames?.[0] || firstName);
  const range = firstName && lastName && firstName !== lastName ? `${firstName}_TO_${lastName}` : firstName;
  return typedAssetName("Storyboard", index + 1, range || `BEAT_${index + 1}`);
}

function productionBoardReferenceGuide() {
  return "视频制作中将此 Production Board 作为唯一 storyboard_reference：读取其 9:16 竖版面板中已锁定的人物身份、场景、道具、构图、站位、镜头方向、动作节奏和剪辑出口；视频提交不再附带单独资产图。";
}

function storyboardSlotsForState(episodeRoot, manifest = null, assets = scanAssets(episodeRoot), options = {}) {
  const storyboardAssets = (assets || []).filter((asset) => asset.manifestType === "Storyboard");
  const byName = new Map(storyboardAssets.map((asset) => [asset.assetName, asset]));
  // 兜底:直接扫描磁盘上的 Production Board 文件,凡文件名与当前 slot 名精确一致的都认作该 slot 已生成。
  // slot 名已编码镜头区间+序号,精确同名即当前板,不会误配旧分组的板;这样可避免工作流隔离/config 名单滞后
  // (runNamespace 漂移)把刚生成好的分镜板误判成"缺失"。
  for (const asset of scanAssets(episodeRoot)) {
    if (asset.manifestType === "Storyboard" && asset.assetName && !byName.has(asset.assetName)) {
      byName.set(asset.assetName, asset);
    }
  }
  const segments = Array.isArray(options.segments) ? options.segments : storyboardSegmentsForEpisode(episodeRoot, options.configData || null);
  const groups = storyboardGroupsForSegments(segments);
  const baseSlots = groups.length
    ? groups.map((group, index) => {
        const id = storyboardSlotNameForGroup(group, index);
        const titles = group.segments.map((segment) => segment.title || segment.key).filter(Boolean);
        const shotNames = [...new Set(group.segments.flatMap((segment) => segment.sourceShotNames || [segment.key]).map(compactLine).filter(Boolean))];
        const refs = [...new Set(group.segments.flatMap((segment) => segment.refs || []).map(compactLine).filter(Boolean))];
        const sceneRefs = [...new Set(group.segments.map((segment) => segment.sceneRef).filter(Boolean))];
        const panels = storyboardPanelPlanForGroup(group);
        const visualSummary =
          panels
            .map((panel) => stripStoryboardDialogueForVisual(String(panel.description || "").replace(/^P\d+\s+[^:：]+[:：]\s*/i, "")))
            .find((text) => text && !/^P\d\b/i.test(text)) ||
          stripStoryboardDialogueForVisual(group.segments.map((segment) => segment.beat || segment.title || segment.key).filter(Boolean).join(" / ")) ||
          titles.join(" / ");
        return {
          id,
          type: "Storyboard",
          label: `SEQ ${String(index + 1).padStart(2, "0")} · ${Math.round(group.duration)}秒 Production Board`,
          usage: assetUsageForType("Storyboard"),
          duration: Math.round(group.duration),
          maxDuration: PRODUCTION_BOARD_MAX_SECONDS,
          startSecond: Math.round(group.startSecond || 0),
          endSecond: Math.round(group.endSecond || (group.startSecond || 0) + group.duration),
          sourceShotNames: shotNames,
          sourceSceneId: sceneRefs[0] || "",
          sourceSceneLabel: "",
          refs,
          beatSummary: visualSummary.slice(0, 240),
          panels,
          videoReferenceGuide: productionBoardReferenceGuide(),
        };
      })
    : [
        {
          id: typedAssetName("Storyboard", 1, `SEQ_0_TO_${PRODUCTION_BOARD_MAX_SECONDS}_SECONDS`),
          type: "Storyboard",
          label: `首个 0-${PRODUCTION_BOARD_MAX_SECONDS} 秒 Production Board`,
          usage: assetUsageForType("Storyboard"),
          duration: PRODUCTION_BOARD_MAX_SECONDS,
          maxDuration: PRODUCTION_BOARD_MAX_SECONDS,
          startSecond: 0,
          endSecond: PRODUCTION_BOARD_MAX_SECONDS,
          sourceShotNames: [],
          sourceSceneId: "",
          sourceSceneLabel: "",
          refs: [],
          beatSummary: "等待剧本分镜和时长",
          panels: defaultStoryboardPanels(),
          videoReferenceGuide: productionBoardReferenceGuide(),
        },
      ];
  const storyboardCandidates = [...byName.values()];
  const usedStoryboardNames = new Set();
  const slots = baseSlots.map((slot) => {
    // 先精确同名,再按镜头集合(稳定键)匹配磁盘上的旧板,避免重分组后名字漂移导致"缺失/断连"。
    const { asset, coverage } = matchStoryboardAssetForSlot(slot, storyboardCandidates, usedStoryboardNames);
    if (asset) usedStoryboardNames.add(asset.assetName);
    const exists = !!asset;
    const partial = exists && coverage === "partial";
    return {
      ...slot,
      status: exists ? "ready" : "missing",
      statusLabel: exists ? (partial ? "已就绪（部分覆盖）" : "已就绪") : "缺失",
      coverage: coverage || "",
      partialCoverage: partial,
      coverageHint: partial ? "此故事板仅覆盖当前分镜的部分镜头，建议重新生成以完整覆盖。" : "",
      source: exists ? "file" : "",
      generated: exists,
      missing: !exists,
      asset,
    };
  });
  for (const asset of storyboardAssets) {
    if (usedStoryboardNames.has(asset.assetName)) continue;
    if (slots.some((slot) => slot.id === asset.assetName)) continue;
    slots.push({
      id: asset.assetName,
      type: "Storyboard",
      label: asset.assetName,
      usage: asset.usage || assetUsageForType("Storyboard"),
      sourceSceneId: "",
      sourceSceneLabel: "手动上传",
      refs: [],
      beatSummary: "未匹配当前剧情拆解的故事版文件",
      panels: defaultStoryboardPanels(),
      videoReferenceGuide: productionBoardReferenceGuide(),
      status: "ready",
      statusLabel: "已就绪",
      source: "file",
      generated: true,
      missing: false,
      asset,
    });
  }
  return slots;
}

function productionBoardReferenceImagesForSlots(episodeRoot, slots = []) {
  const wanted = new Set(
    (Array.isArray(slots) ? slots : [])
      .flatMap((slot) => (Array.isArray(slot.refs) ? slot.refs : []))
      .map(compactLine)
      .filter(Boolean),
  );
  if (!wanted.size) return [];
  const manifest = readAssetManifest(episodeRoot)?.data;
  const runStart = currentRunStartMs(episodeRoot);
  return projectProductionAssetsForState(episodeRoot, manifest, { minModifiedAt: runStart })
    .filter((asset) => {
      const filePath = asset.path || asset.file || "";
      return asset.manifestType !== "Storyboard" && wanted.has(asset.assetName) && filePath && fs.existsSync(filePath);
    })
    .sort((a, b) => {
      const order = { Character: 0, Scene: 1, Prop: 2, Insert: 3 };
      return (order[a.manifestType] ?? 9) - (order[b.manifestType] ?? 9) || a.assetName.localeCompare(b.assetName);
    })
    .slice(0, 8)
    .map((asset) => asset.path || asset.file);
}

function resolveReferenceAssets(episodeRoot, names) {
  const requested = [...new Set((Array.isArray(names) ? names : []).map(compactLine).filter(Boolean))].slice(0, 4);
  if (!requested.length) return [];
  const assets = projectProductionAssetsForState(episodeRoot, readAssetManifest(episodeRoot)?.data, {
    minModifiedAt: currentRunStartMs(episodeRoot),
  });
  const byName = new Map(assets.map((asset) => [asset.assetName, asset]));
  return requested.map((name) => {
    const asset = byName.get(name);
    if (!asset) throw new Error(`找不到参考资产图：${name}`);
    if (!allowedPath(asset.path)) throw new Error(`参考资产路径不允许访问：${name}`);
    return asset;
  });
}

function manifestTypeForAssetName(manifest, name) {
  const item = (manifest?.items || []).find((entry) => entry.id === name);
  return item ? normalizeAssetType(item.type, "") : "";
}

function assetRecordFromMedia(asset, manifest = null, index = 0) {
  const manifestType = manifestTypeForAssetName(manifest, asset.assetName);
  const item = (manifest?.items || []).find((entry) => entry.id === asset.assetName);
  const identity = resolveAssetIdentity({ declaredType: manifestType || asset.manifestType, assetName: asset.assetName, filePath: asset.path });
  if (!identity.valid) return null;
  return {
    name: asset.assetName,
    label: item?.label || asset.assetName,
    matchCode: item?.matchCode || assetMatchCode(identity.type, asset.assetName, index + 1),
    evidence: item?.evidence || "",
    visual: item?.visual || "",
      file: asset.reused ? asset.path : asset.rel,
    type: "image",
    manifestType: identity.type,
    use: identity.usage,
    x: 80 + (index % 4) * 360,
    y: 120 + Math.floor(index / 4) * 260,
  };
}

function assetLibraryBindingFromAsset(asset = {}) {
  const name = compactLine(asset.name || asset.assetName || asset.id || "");
  const assetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
  const status = compactLine(asset.validationStatus || asset.validation_status || asset.status || "");
  if (!name || !/^asset:\/\//i.test(assetUrl) || status.toLowerCase() !== "active") return null;
  return {
    name,
    assetUrl,
    publicUrl: compactLine(asset.publicUrl || asset.public_url || ""),
    virtualId: compactLine(asset.virtualId || asset.virtual_id || ""),
    groupId: compactLine(asset.groupId || asset.group_id || ""),
    validationStatus: "active",
    validationError: "",
    validationMessage: compactLine(asset.validationMessage || asset.message || "素材已 active"),
  };
}

function collectHistoricalAssetLibraryBindings(episodeRoot, previousConfig = {}) {
  const bindings = new Map();
  const remember = (asset) => {
    const binding = assetLibraryBindingFromAsset(asset);
    if (binding && !bindings.has(binding.name)) bindings.set(binding.name, binding);
  };
  for (const asset of Array.isArray(previousConfig.assets) ? previousConfig.assets : []) remember(asset);
  if (fs.existsSync(CANVAS_STATE_DIR)) {
    for (const file of fs.readdirSync(CANVAS_STATE_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const state = JSON.parse(fs.readFileSync(path.join(CANVAS_STATE_DIR, file), "utf8"));
        const canvasEpisodeRoot = episodeRootFromCanvasProjectId(state.projectId || "");
        if (canvasEpisodeRoot && path.resolve(canvasEpisodeRoot) !== path.resolve(episodeRoot)) continue;
        for (const asset of Array.isArray(state.assets) ? state.assets : []) remember(asset);
      } catch {
        // Ignore one bad canvas state; the config can still be built from local files.
      }
    }
  }
  return bindings;
}

function applyAssetLibraryBindingsToRecords(records = [], bindings = new Map()) {
  return records.map((record) => {
    const binding = bindings.get(compactLine(record.name || record.assetName || record.id || ""));
    if (!binding) return record;
    return {
      ...record,
      publicUrl: record.publicUrl || binding.publicUrl || "",
      assetUrl: binding.assetUrl,
      virtualId: binding.virtualId || record.virtualId || "",
      groupId: binding.groupId || record.groupId || "",
      validationStatus: "active",
      validationError: "",
      validationMessage: binding.validationMessage || "素材已 active",
    };
  });
}

function assetModelForRefs(assetRecord, manifest = null) {
  const item = (manifest?.items || []).find((entry) => entry.id === assetRecord.name);
  return {
    type: assetRecord.manifestType || inferAssetTypeFromName(assetRecord.name) || "Prop",
    name: assetRecord.name,
    label: item?.label || assetRecord.name,
    matchCode: item?.matchCode || assetRecord.matchCode || assetMatchCode(assetRecord.manifestType, assetRecord.name),
    evidence: item?.evidence || "",
    visual: item?.visual || "",
  };
}

function assetFolderForManifestType(type) {
  return assetFolderForType(type);
}

function safeManifestAssetId(id) {
  const clean = compactLine(id);
  if (!clean) throw new Error("缺少资产 ID");
  if (/[\\/]/.test(clean) || clean.includes("..")) throw new Error("资产 ID 不能包含路径符号");
  if (Buffer.byteLength(clean, "utf8") > 180) throw new Error("资产 ID 过长");
  return clean;
}

function detectImageExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return ".jpg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  return "";
}

function decodeUploadedImage(body) {
  const raw = String(body.contentBase64 || "");
  const content = raw.includes(",") ? raw.split(",").pop() : raw;
  if (!content) throw new Error("缺少上传图片内容");
  const buffer = Buffer.from(content, "base64");
  if (!buffer.length) throw new Error("上传图片为空");
  const detected = detectImageExtension(buffer);
  if (!detected) throw new Error("只支持 PNG、JPG、WEBP 资产图");
  const filenameExt = path.extname(String(body.filename || "")).toLowerCase();
  if (filenameExt && ![".png", ".jpg", ".jpeg", ".webp"].includes(filenameExt)) throw new Error("只支持 PNG、JPG、WEBP 资产图");
  return { buffer, ext: detected };
}

const UPLOAD_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

function removeFileIfAllowed(file, removed = []) {
  if (!file || !allowedPath(file) || !fs.existsSync(file)) return removed;
  fs.rmSync(file, { force: true });
  removed.push(file);
  return removed;
}

function removeExistingBoundAssetFiles(episodeRoot, { assetId, dir, target, existingAsset, manifestNames = new Set() } = {}) {
  const removed = [];
  const assetBase = path.join(episodeRoot, "04_assets");
  for (const oldExt of UPLOAD_IMAGE_EXTENSIONS) {
    removeFileIfAllowed(path.join(dir, `${assetId}${oldExt}`), removed);
  }
  const existingPath = existingAsset?.path || "";
  if (existingPath && isInside(assetBase, existingPath) && path.resolve(existingPath) !== path.resolve(target)) {
    const existingName = path.basename(existingPath).replace(/\.(png|jpg|jpeg|webp)$/i, "");
    if (existingAsset.recoveredFromInterruptedWorkflow || !manifestNames.has(existingName)) {
      removeFileIfAllowed(existingPath, removed);
    }
  }
  return [...new Set(removed)];
}

function assetStyleReferenceDir(episodeRoot) {
  return path.join(episodeRoot, "04_assets", "style_reference");
}

function assetStyleReferenceMetaPath(episodeRoot) {
  return path.join(assetStyleReferenceDir(episodeRoot), "asset_style_reference.json");
}

function assetStyleReferenceFile(episodeRoot) {
  const dir = assetStyleReferenceDir(episodeRoot);
  return walkFiles(dir, (file) => /^asset_style_reference\.(png|jpg|jpeg|webp)$/i.test(path.basename(file)), 1)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function readAssetStyleReferenceMeta(episodeRoot) {
  const file = assetStyleReferenceMetaPath(episodeRoot);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeAssetStyleReferenceMeta(episodeRoot, meta) {
  const file = assetStyleReferenceMetaPath(episodeRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return meta;
}

function readAssetStyleReference(episodeRoot) {
  const file = assetStyleReferenceFile(episodeRoot);
  const meta = readAssetStyleReferenceMeta(episodeRoot);
  const enabled = meta.enabled !== false && !!file;
  const asset = file
    ? {
        ...mediaItem(file, episodeRoot),
        assetName: "asset_style_reference",
        manifestType: "StyleReference",
        type: "style-reference",
        usage: "资产图生成阶段的画风参考，只用于线条、色彩、渲染质感和光影，不作为人物/场景/道具内容参考",
      }
    : null;
  return {
    enabled,
    uploadedAt: meta.uploadedAt || "",
    originalFilename: meta.originalFilename || "",
    asset,
  };
}

function updateAssetStyleReference(episodeRoot, body = {}) {
  const dir = assetStyleReferenceDir(episodeRoot);
  if (!isInside(path.join(episodeRoot, "04_assets"), dir)) throw new Error("风格参考图保存路径不安全");
  fs.mkdirSync(dir, { recursive: true });
  if (body.remove === true) {
    for (const file of walkFiles(dir, (item) => /^asset_style_reference\.(png|jpg|jpeg|webp)$/i.test(path.basename(item)) || path.basename(item) === "asset_style_reference.json", 1)) {
      fs.rmSync(file, { force: true });
    }
    return { removed: true, styleReference: readAssetStyleReference(episodeRoot), message: "已移除资产风格参考图" };
  }
  const existing = assetStyleReferenceFile(episodeRoot);
  if (body.enabled != null && !body.contentBase64) {
    if (!existing) throw new Error("请先上传资产风格参考图");
    writeAssetStyleReferenceMeta(episodeRoot, {
      ...readAssetStyleReferenceMeta(episodeRoot),
      enabled: body.enabled !== false,
      updatedAt: new Date().toISOString(),
    });
    return { updated: true, styleReference: readAssetStyleReference(episodeRoot), message: body.enabled === false ? "已停用资产风格参考图" : "已启用资产风格参考图" };
  }
  const { buffer, ext } = decodeUploadedImage(body);
  const target = path.join(dir, `asset_style_reference${ext}`);
  if (!isInside(path.join(episodeRoot, "04_assets"), target)) throw new Error("风格参考图保存路径不安全");
  for (const oldExt of [".png", ".jpg", ".jpeg", ".webp"]) {
    const oldFile = path.join(dir, `asset_style_reference${oldExt}`);
    if (oldFile !== target && fs.existsSync(oldFile)) fs.rmSync(oldFile, { force: true });
  }
  fs.writeFileSync(target, buffer);
  writeAssetStyleReferenceMeta(episodeRoot, {
    enabled: body.enabled !== false,
    uploadedAt: new Date().toISOString(),
    originalFilename: path.basename(String(body.filename || "")),
  });
  return { uploaded: true, styleReference: readAssetStyleReference(episodeRoot), message: "资产风格参考图已上传并启用" };
}

function uploadBoundAsset(episodeRoot, body = {}) {
  const assetId = safeManifestAssetId(body.assetId);
  const manifest = readAssetManifest(episodeRoot)?.data;
  const normalized = normalizeAssetManifest(manifest || {});
  const item = normalized.items.find((entry) => entry.id === assetId);
  if (!item) throw new Error(`资产解析中找不到：${assetId}`);
  const { buffer, ext } = decodeUploadedImage(body);
  const folder = assetFolderForManifestType(item.type);
  const dir = path.join(episodeRoot, "04_assets", folder);
  const target = path.join(dir, `${assetId}${ext}`);
  if (!isInside(path.join(episodeRoot, "04_assets"), target)) throw new Error("资产保存路径不安全");
  const identity = resolveAssetIdentity({ declaredType: item.type, assetName: assetId, filePath: target });
  if (!identity.valid) throw new Error(`上传资产类型冲突：${assetId}（${identity.conflicts.join("；")}）`);
  const existingAsset = projectProductionAssetsForState(episodeRoot, normalized, { minModifiedAt: currentRunStartMs(episodeRoot) }).find((asset) => asset.assetName === assetId);
  const originalFilename = path.basename(String(body.filename || ""));
  fs.mkdirSync(dir, { recursive: true });
  const removedFiles = removeExistingBoundAssetFiles(episodeRoot, {
    assetId,
    dir,
    target,
    existingAsset,
    manifestNames: manifestAssetNameSet(normalized),
  });
  fs.writeFileSync(target, buffer);
  const now = new Date();
  fs.utimesSync(target, now, now);
  clearAssetGeneratedMetadata(episodeRoot, [assetId]);
  const asset = mediaItem(target, episodeRoot);
  asset.assetName = assetId;
  asset.manifestType = identity.type;
  asset.type = identity.scanType;
  asset.usage = identity.usage;
  asset.assetIdentity = identity;
  return {
    asset,
    manifestItem: item,
    replaced: !!existingAsset,
    savedAs: path.basename(target),
    ignoredFilename: originalFilename,
    removedFiles: removedFiles.map((file) => path.relative(episodeRoot, file)),
    message: `${existingAsset ? "已替换" : "已绑定"}上传资产：${assetId}（保存为 ${path.basename(target)}）`,
  };
}

function uploadStoryboardAsset(episodeRoot, body = {}) {
  const storyboardId = safeManifestAssetId(body.storyboardId || body.assetId);
  const manifest = readAssetManifest(episodeRoot)?.data || {};
  const config = readVideoConfig(episodeRoot)?.data || null;
  const runStart = currentRunStartMs(episodeRoot, config);
  const storyboardAssets = currentStoryboardAssetsForWorkflow(scanAssets(episodeRoot), { configData: config, minModifiedAt: runStart });
  const slots = storyboardSlotsForState(episodeRoot, manifest, storyboardAssets, { configData: config });
  const slot = slots.find((entry) => entry.id === storyboardId);
  if (!slot) throw new Error(`故事版槽位不存在：${storyboardId}`);
  const { buffer, ext } = decodeUploadedImage(body);
  const dir = path.join(episodeRoot, "04_assets", assetFolderForType("Storyboard"));
  const target = path.join(dir, `${storyboardId}${ext}`);
  if (!isInside(path.join(episodeRoot, "04_assets"), target)) throw new Error("故事版保存路径不安全");
  fs.mkdirSync(dir, { recursive: true });
  for (const oldExt of [".png", ".jpg", ".jpeg", ".webp"]) {
    const oldFile = path.join(dir, `${storyboardId}${oldExt}`);
    if (oldFile !== target && fs.existsSync(oldFile)) fs.rmSync(oldFile);
  }
  fs.writeFileSync(target, buffer);
  const asset = mediaItem(target, episodeRoot);
  asset.assetName = storyboardId;
  const identity = resolveAssetIdentity({ declaredType: "Storyboard", assetName: storyboardId, filePath: target });
  if (!identity.valid) throw new Error(`上传故事版类型冲突：${storyboardId}（${identity.conflicts.join("；")}）`);
  asset.manifestType = identity.type;
  asset.type = identity.scanType;
  asset.usage = identity.usage;
  asset.assetIdentity = identity;
  return {
    asset,
    storyboardSlot: slot,
    message: `已绑定 Production Board：${storyboardId}`,
  };
}

function manualAssetType(value) {
  const type = normalizeAssetType(value || "Prop", "Prop");
  if (!["Character", "Scene", "Prop", "Insert"].includes(type)) throw new Error("资产类型不正确");
  return type;
}

function relatedShotScoreForManualAsset(shot, asset) {
  const text = `${shot.title || ""} ${shot.beat || ""} ${shot.purpose || ""} ${shot.prompt || ""}`;
  const hay = normalizeAssetMatchText(text);
  const terms = assetMatchTokens(`${asset.label} ${asset.evidence} ${asset.visual}`).filter((term) => term.length >= 2);
  let score = 0;
  for (const term of terms) {
    if (hay.includes(term)) score += term.length >= 4 ? 3 : 1;
  }
  if (textMentionsAsset(text, asset)) score += 6;
  const keywordScore = assetKeywordScore(text, asset, {});
  if (keywordScore > 0) score += Math.min(10, keywordScore);
  return score;
}

function bindManualAssetToConfig(episodeRoot, asset) {
  const configRecord = readVideoConfig(episodeRoot);
  if (!configRecord?.file || !configRecord?.data || !Array.isArray(configRecord.data.shots)) {
    return { updated: false, boundShots: [], reason: "视频配置尚未生成" };
  }
  const config = configRecord.data;
  let changed = false;
  const boundShots = [];
  config.shots = config.shots.map((shot) => {
    const score = relatedShotScoreForManualAsset(shot, asset);
    if (score < 4) return shot;
    const refs = Array.isArray(shot.refs) ? [...shot.refs] : [];
    if (refs.includes(asset.name)) return shot;
    const type = asset.type;
    let nextRefs = refs;
    if (type === "Scene") {
      const existingSceneIndex = refs.findIndex((ref) => inferAssetTypeFromName(ref) === "Scene");
      if (existingSceneIndex >= 0) nextRefs = refs.map((ref, index) => (index === existingSceneIndex ? asset.name : ref));
      else nextRefs = [asset.name, ...refs];
      shot.sceneRef = asset.name;
    } else {
      nextRefs = [...refs, asset.name];
    }
    changed = true;
    boundShots.push(shot.name || shot.id || shot.title || "");
    return {
      ...shot,
      refs: [...new Set(nextRefs)].slice(0, 8),
      manualAssetBindings: [
        ...(Array.isArray(shot.manualAssetBindings) ? shot.manualAssetBindings : []),
        {
          asset: asset.name,
          type: asset.type,
          label: asset.label,
          reason: "手动新增资产自动绑定",
        },
      ],
    };
  });
  if (changed) writeText(configRecord.file, `${JSON.stringify(config, null, 2)}\n`);
  return { updated: changed, boundShots: boundShots.filter(Boolean) };
}

function addManualAsset(episodeRoot, body = {}) {
  const type = manualAssetType(body.type);
  const label = compactLine(body.label || body.name || "");
  const description = compactLine(body.description || "");
  const evidence = compactLine(body.evidence || body.scriptEvidence || "");
  const referenceAssetNames = [...new Set((Array.isArray(body.referenceAssetNames) ? body.referenceAssetNames : []).map(compactLine).filter(Boolean))].slice(0, 4);
  if (!label) throw new Error("请填写资产名称");
  if (!description) throw new Error("请填写资产描述");
  if (referenceAssetNames.length) resolveReferenceAssets(episodeRoot, referenceAssetNames);
  const rawManifest = readAssetManifest(episodeRoot)?.data || {};
  const manifest = normalizeAssetManifest(rawManifest);
  const script = cleanScriptForDraft(readText(findProjectFile(episodeRoot, "script")));
  const worldProfile = manifest.worldProfile || inferWorldProfile(script);
  const existingAssets = manifestItemsToAssets(manifest);
  if (assetExistsByLabel(existingAssets, label, type)) throw new Error(`资产解析中已经存在：${label}`);
  const nextIndex = (manifest.items || []).filter((item) => item.type === type).length + 1;
  const id = typedAssetName(type, nextIndex, label);
  const manualAsset = {
    type,
    name: id,
    label,
    evidence: evidence || evidenceForTerm(script, label) || `用户手动补充：${description}`,
    visual: description,
    worldProfile,
    analyzerSource: "manual",
    analyzerNote: referenceAssetNames.length
      ? `用户手动添加，已自动绑定相关分镜片段；参考图：${referenceAssetNames.join("、")}`
      : "用户手动添加，已自动绑定相关分镜片段",
    referenceAssetNames,
    generate: body.generate !== false,
  };
  const assets = [...existingAssets, manualAsset];
  const nextManifest = assetManifestFromAssets({
    title: manifest.title || titleFromScript(script, episodeSlug(episodeRoot)),
    script,
    worldProfile,
    assets,
    analyzerResult: manifest.analyzer || { ok: false, model: body.assetAnalyzerModel || "", reason: "" },
    modelName: body.assetAnalyzerModel || manifest.analyzer?.model,
    coverage: {
      ...(manifest.coverage || {}),
      checkedAt: new Date().toISOString(),
      model: manifest.coverage?.model || body.assetAnalyzerModel || manifest.analyzer?.model || "",
      ok: true,
      reason: "",
      summary: "用户手动补充资产并自动绑定相关分镜片段",
      added: [
        ...(Array.isArray(manifest.coverage?.added) ? manifest.coverage.added : []),
        {
          id,
          type,
          label,
          evidence: manualAsset.evidence,
        },
      ],
    },
  });
  const shouldConfirm = body.confirm !== false;
  nextManifest.confirmed = shouldConfirm;
  nextManifest.confirmedAt = shouldConfirm ? manifest.confirmedAt || new Date().toISOString() : "";
  const normalized = writeAssetManifest(episodeRoot, nextManifest);
  const binding = shouldConfirm
    ? bindManualAssetToConfig(episodeRoot, manualAsset)
    : { updated: false, boundShots: [], reason: "资产分类尚未确认" };
  return {
    asset: normalized.items.find((item) => item.id === id),
    binding,
    manifest: normalized,
  };
}

function uploadLocalAsset(episodeRoot, body = {}) {
  const type = manualAssetType(body.type);
  const label = compactLine(body.label || body.name || "");
  if (!label) throw new Error("请填写资产名称");

  // Validate the image before changing the asset manifest, so an invalid upload
  // never leaves an unusable reference slot behind.
  decodeUploadedImage(body);
  const created = addManualAsset(episodeRoot, {
    type,
    label,
    description: compactLine(body.description || `本地上传的${type}资产图`),
    evidence: compactLine(body.evidence || "用户本地上传"),
    generate: false,
    confirm: body.confirm !== false,
  });
  const upload = uploadBoundAsset(episodeRoot, {
    assetId: created.asset.id,
    filename: body.filename,
    contentBase64: body.contentBase64,
  });
  return {
    asset: created.asset,
    manifest: created.manifest,
    binding: created.binding,
    upload,
    message: created.manifest.confirmed
      ? `已添加本地资产：${created.asset.label}，可直接作为视频参考图使用`
      : `已上传资产图：${created.asset.label}，请确认分类后继续`,
  };
}

function scanVideos(episodeRoot, options = {}) {
  const videoRoot = path.join(episodeRoot, "06_videos");
  const rawDir = path.join(videoRoot, "raw");
  const minModifiedAt = Number(options.minModifiedAt || 0);
  const isCurrentEnough = (file) => {
    if (!minModifiedAt) return true;
    try {
      return fs.statSync(file).mtimeMs >= minModifiedAt;
    } catch {
      return false;
    }
  };
  const raw = walkFiles(rawDir, (file) => /\.(mp4|mov)$/i.test(file), 1)
    .filter(isCurrentEnough)
    .sort()
    .map((file) => mediaItem(file, episodeRoot));
  const contactSheets = listDir(videoRoot)
    .filter((entry) => entry.isFile() && /contact.*\.(jpg|jpeg|png|webp)$/i.test(entry.name))
    .filter((entry) => isCurrentEnough(path.join(videoRoot, entry.name)))
    .map((entry) => mediaItem(path.join(videoRoot, entry.name), episodeRoot))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { raw, roughCuts: [], contactSheets };
}

function scanTailFrames(episodeRoot) {
  return walkFiles(path.join(episodeRoot, "09_tail_frames"), (file) => /\.(png|jpg|jpeg|webp)$/i.test(file), 1)
    .sort()
    .map((file) => mediaItem(file, episodeRoot));
}

function readSummary(episodeRoot, options = {}) {
  const nodeDir = path.join(episodeRoot, VIDEO_TASK_DIR);
  const runNamespace = normalizeRunNamespace(options.runNamespace || "");
  const summary = walkFiles(nodeDir, (file) => /summary\.json$/i.test(file), 1)
    .filter((file) => {
      if (!runNamespace) return true;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return normalizeRunNamespace(parsed.runNamespace || parsed.pipelineRunId || "") === runNamespace;
      } catch {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!summary) return null;
  try {
    return { file: summary, data: JSON.parse(fs.readFileSync(summary, "utf8")) };
  } catch {
    return { file: summary, data: null };
  }
}

function readVideoConfig(episodeRoot, options = {}) {
  const configPath = locateConfig(episodeRoot, options);
  if (!configPath) return null;
  try {
    return { file: configPath, data: JSON.parse(fs.readFileSync(configPath, "utf8")) };
  } catch {
    return { file: configPath, data: null };
  }
}

function writeVideoConfigRecord(record, data) {
  if (!record?.file) return data;
  writeText(record.file, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function defaultProjectCanvasId(episodeRoot) {
  return encodeId(episodeRoot);
}

function createVideoCanvasId(episodeRoot, stamp = "") {
  const cleanStamp = compactLine(stamp || new Date().toISOString().replace(/[:.]/g, "-"));
  return `${defaultProjectCanvasId(episodeRoot)}::video::${cleanStamp}`;
}

function videoCanvasIdForConfig(episodeRoot, config = {}) {
  return (
    compactLine(config.videoCanvasId || config.canvasProjectId || config.settings?.videoCanvasId || config.settings?.canvasProjectId || "") ||
    defaultProjectCanvasId(episodeRoot)
  );
}

function episodeRootFromCanvasProjectId(projectId = "") {
  const clean = compactLine(projectId || "");
  const encoded = clean.includes("::video::") ? clean.split("::video::")[0] : clean;
  const decoded = decodeIdSafe(encoded);
  if (!decoded) return "";
  const episodeRoot = path.resolve(decoded);
  if (!allowedPath(episodeRoot) || !fs.existsSync(episodeRoot)) return "";
  return episodeRoot;
}

function isProjectVideoNodeId(value = "") {
  return /^video_E\d+_V\d+/i.test(compactLine(value || ""));
}

function safeProjectVideoNodeName(name = "", index = 0) {
  return String(name || `shot_${index + 1}`)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
}

function resolveProjectShotNameFromCanvasNodeId(nodeId = "", shots = [], config = {}, episodeRoot = "") {
  const cleanNodeId = compactLine(nodeId || "");
  if (!cleanNodeId || !Array.isArray(shots) || !shots.length) return "";
  const canvasConfig = { ...config, episodeRoot };
  for (const [index, shot] of shots.entries()) {
    if (canvasNodeFromConfigShot(shot, index, canvasConfig).id === cleanNodeId) return shot.name || "";
  }
  const withoutPrefix = cleanNodeId.replace(/^video_/, "");
  const withoutHash = withoutPrefix.replace(/_[a-z0-9]{4,10}$/i, "");
  for (const [index, shot] of shots.entries()) {
    if (safeProjectVideoNodeName(shot.name, index) === withoutHash) return shot.name || "";
  }
  const stem = withoutHash.match(/^(E\d+_V\d+)/i)?.[1] || "";
  if (stem) {
    const matched = shots.find((shot) => String(shot.name || "").startsWith(stem));
    if (matched?.name) return matched.name;
  }
  return "";
}

function resolveCanvasProjectVideoRequest(body = {}) {
  const projectId = compactLine(body.projectId || body.canvasProjectId || "");
  const episodeRoot = episodeRootFromCanvasProjectId(projectId);
  const nodeId = compactLine(body.nodeId || body.id || "");
  const explicitShotName = compactLine(body.shotName || body.projectShotName || "");
  const source = compactLine(body.source || "");
  const hasProjectMarker = !!explicitShotName || source === "project-console" || isProjectVideoNodeId(nodeId);
  if (!episodeRoot || !hasProjectMarker) return { project: false, episodeRoot: episodeRoot || "", shotName: "" };

  const config = readVideoConfig(episodeRoot)?.data || {};
  const shots = Array.isArray(config.shots) ? config.shots : [];
  const shotNames = new Set(shots.map((shot) => compactLine(shot?.name || "")).filter(Boolean));
  if (explicitShotName && shotNames.has(explicitShotName)) {
    return { project: true, episodeRoot, shotName: explicitShotName, config };
  }
  const fallback = explicitShotName ? canvasVideoFallbackForShot(episodeRoot, explicitShotName) : null;
  if (fallback?.shot?.name) {
    return { project: true, episodeRoot, shotName: fallback.shot.name, config: fallback.config, fallbackFromCanvas: true };
  }

  const projectIds = [
    projectId,
    videoCanvasIdForConfig(episodeRoot, config),
    defaultProjectCanvasId(episodeRoot),
  ].filter((id, index, ids) => id && ids.indexOf(id) === index);
  for (const id of projectIds) {
    const state = readCanvasState(id);
    const node = Array.isArray(state?.nodes) ? state.nodes.find((item) => item?.id === nodeId) : null;
    const nodeShotName = compactLine(node?.projectShotName || node?.shotName || "");
    if (nodeShotName && shotNames.has(nodeShotName)) {
      return { project: true, episodeRoot, shotName: nodeShotName, config };
    }
    if (nodeShotName) {
      const nodeFallback = canvasVideoFallbackForShot(episodeRoot, nodeShotName);
      if (nodeFallback?.shot?.name) {
        return { project: true, episodeRoot, shotName: nodeFallback.shot.name, config: nodeFallback.config, fallbackFromCanvas: true };
      }
    }
  }

  const nodeShotName = resolveProjectShotNameFromCanvasNodeId(nodeId, shots, config, episodeRoot);
  if (nodeShotName && shotNames.has(nodeShotName)) {
    return { project: true, episodeRoot, shotName: nodeShotName, config };
  }

  return {
    project: true,
    episodeRoot,
    shotName: "",
    config,
    error: explicitShotName
      ? `这是项目视频片段请求，但视频配置中找不到片段：${explicitShotName}`
      : "这是项目视频片段节点，但无法解析片段名。已拦截普通画布提交，避免绕过尾帧和素材库校验。",
  };
}

function archiveEpisodeFiles(episodeRoot, archiveRoot, entries = []) {
  const archived = {};
  const archive = (key, dir, predicate) => {
    archived[key] = 0;
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      if (!fs.statSync(full).isFile()) continue;
      if (!predicate(file, full)) continue;
      const rel = path.relative(episodeRoot, full).replace(/^(\.\.[/\\])+/, "");
      const target = path.join(archiveRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.renameSync(full, target);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        fs.copyFileSync(full, target);
        fs.unlinkSync(full);
      }
      archived[key] += 1;
    }
  };
  for (const entry of entries) archive(entry.key, entry.dir, entry.predicate);
  return archived;
}

function resetCanvasVideoNodesForProjectConfig(episodeRoot, config = {}) {
  const projectId = videoCanvasIdForConfig(episodeRoot, config);
  const state = readCanvasState(projectId);
  if (!state || !Array.isArray(state.nodes)) return { reset: 0 };
  const shots = Array.isArray(config.shots) ? config.shots : [];
  const currentVideoNodeIds = new Set(shots.map((shot, index) => canvasNodeFromConfigShot(shot, index, config).id));
  let reset = 0;
  const nodes = state.nodes.map((node) => {
    if (!node || node.kind !== "video") return node;
    const shouldReset = currentVideoNodeIds.has(node.id) || node.source === "project-console" || /^video_E\d+_V\d+/i.test(node.id || "");
    if (!shouldReset) return node;
    reset += 1;
    return {
      ...node,
      status: "idle",
      statusMessage: "",
      videoUrl: "",
      taskId: "",
      taskProvider: "",
      progress: null,
      tailFrameReady: false,
      tailFrameUrl: "",
      tailFrameLocalFile: "",
      tailFrameFileUrl: "",
      tailFrameMessage: "",
    };
  });
  const clean = sanitizeCanvasState({ ...state, nodes });
  const file = canvasStateFileForProject(clean.projectId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clean, null, 2));
  return { reset };
}

function resetVideoGenerationStateForNewConfig(episodeRoot, config = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  config.videoCanvasId = createVideoCanvasId(episodeRoot, stamp);
  config.videoCanvasCreatedAt = new Date().toISOString();
  const archiveRoot = path.join(episodeRoot, "06_videos", "config_reset_archive", stamp);
  const archived = archiveEpisodeFiles(episodeRoot, archiveRoot, [
    { key: "rawVideos", dir: path.join(episodeRoot, "06_videos", "raw"), predicate: (file) => /\.(mp4|mov)$/i.test(file) },
    { key: "taskSnapshots", dir: path.join(episodeRoot, VIDEO_TASK_DIR), predicate: (file) => /\.(json|txt)$/i.test(file) },
    { key: "tailFrames", dir: path.join(episodeRoot, "09_tail_frames"), predicate: (file) => /\.(png|jpe?g|webp)$/i.test(file) },
    { key: "tailUploads", dir: path.join(episodeRoot, "10_tail_frame_uploads"), predicate: (file) => /\.json$/i.test(file) },
    { key: "singleConfigs", dir: path.join(workDirForEpisode(episodeRoot), "single_shot_configs"), predicate: (file) => /\.json$/i.test(file) },
  ]);
  const canvas = resetCanvasVideoNodesForProjectConfig(episodeRoot, config);
  return {
    stamp,
    archiveDir: archiveRoot,
    archived,
    canvas,
  };
}

function shotStemFromName(name) {
  const match = String(name || "").match(/^(E\d+_V\d+)/i);
  return match ? match[1] : String(name || "");
}

function canvasNodeNameForShotName(name) {
  return `${shotStemFromName(name)}_VIDEO`;
}

function mediaModifiedAt(media) {
  if (!media?.path || !fs.existsSync(media.path)) return 0;
  try {
    return fs.statSync(media.path).mtimeMs;
  } catch {
    return 0;
  }
}

function matchVideoForShot(rawVideos, shotName, options = {}) {
  const stem = shotStemFromName(shotName);
  const canvasName = canvasNodeNameForShotName(shotName);
  const minModifiedAt = Number(options.minModifiedAt || 0);
  const isCurrentEnough = (video) => (minModifiedAt > 0 ? mediaModifiedAt(video) >= minModifiedAt : true);
  const targetName = String(shotName || "");
  const exact = rawVideos.find((video) => {
    const videoStem = path.basename(video.name || "", path.extname(video.name || ""));
    return (videoStem === targetName || videoStem === canvasName) && isCurrentEnough(video);
  });
  if (exact) return exact;
  if (!options.allowStemFallback) return null;
  return (
    rawVideos.find((video) => {
      if (!video.name.includes(stem)) return false;
      return isCurrentEnough(video);
    }) || null
  );
}

function snapshotLocalVideoForShot(episodeRoot, snapshot = null) {
  const localRel = compactLine(snapshot?.localFile || "");
  if (!localRel) return null;
  const localFile = path.join(episodeRoot, localRel);
  if (!fs.existsSync(localFile) || !fs.statSync(localFile).isFile()) return null;
  if (!/\.(mp4|mov)$/i.test(localFile)) return null;
  return mediaItem(localFile, episodeRoot);
}

function progressPercentFromResult(result = {}, statusCode = 1) {
  if (statusCode === 2) return 100;
  if (statusCode === 3) return Number.isFinite(Number(result.progress)) ? Math.max(0, Math.min(100, Number(result.progress))) : null;
  const progress = normalizeProgressValue(result.progress);
  return progress === null || progress <= 0 ? null : Math.min(99, progress);
}

function localVideoFromSnapshot(episodeRoot, snapshot = null) {
  const localRel = compactLine(snapshot?.localFile || "");
  if (!localRel) return null;
  const localFile = path.join(episodeRoot, localRel);
  if (!fs.existsSync(localFile) || !fs.statSync(localFile).isFile()) return null;
  return mediaItem(localFile, episodeRoot);
}

function existingTailFrameForShot(episodeRoot, shotName) {
  const stem = shotStemFromName(shotName);
  const candidates = [
    tailFrameFileForShot(episodeRoot, shotName, "png"),
    path.join(episodeRoot, "09_tail_frames", `${safeSlug(stem, "shot")}_tail.png`),
    path.join(episodeRoot, "09_tail_frames", `${stem}_tail.png`),
  ];
  for (const file of candidates) {
    if (file && fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 1024) {
      return mediaItem(file, episodeRoot);
    }
  }
  const fallback = scanTailFrames(episodeRoot).find((frame) => frame.name.includes(stem));
  return fallback || null;
}

function projectVideoFinalizingMessage(tailFrame = {}, localFile = "", options = {}) {
  if (options.tailFrameRequired === false) return localFile ? "生成完成，已保存本地视频" : "视频已生成，正在下载";
  if (tailFrame?.ready) return "生成完成，尾帧已就绪";
  if (localFile) return `视频已生成，正在下载并抽取尾帧${tailFrame?.message ? `；${tailFrame.message}` : ""}`;
  return "视频已生成，正在下载并抽取尾帧";
}

function projectVideoShotNeedsFinalization(snapshot = null) {
  return !!snapshot?.videoUrl && snapshot.statusCode === 2 && snapshot.complete !== true;
}

async function finalizeExistingProjectVideoShot(episodeRoot, shotName, snapshot = {}, runNamespace = "") {
  const videoUrl = compactLine(snapshot.videoUrl || "");
  if (!videoUrl) return { finalized: false };
  const config = readVideoConfig(episodeRoot)?.data || {};
  const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName);
  const tailFrameRequired = !isProductionBoardMode(config, shot);
  const localFile = await downloadProjectVideoResult(episodeRoot, shotName, videoUrl);
  const tailFrame = await persistProjectTailFrame(
    episodeRoot,
    shotName,
    {
      videoUrl,
      tailFrameUrl: snapshot.tailFrameUrl || "",
      taskId: snapshot.taskId || "",
      provider: snapshot.provider || "",
    },
    localFile,
  );
  writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
    runNamespace,
    provider: snapshot.provider || "",
    urls: [videoUrl],
    taskInfo: {
      taskId: snapshot.taskId || "",
      provider: snapshot.provider || "",
        status: 2,
        progressPercent: 100,
        failedReason: "",
        message: projectVideoFinalizingMessage(tailFrame, localFile, { tailFrameRequired }),
        videoUrl,
        tailFrameUrl: tailFrame.url || snapshot.tailFrameUrl || "",
        tailFrameLocalFile: tailFrame.localFile || "",
        tailFrameReady: tailFrame.ready,
        tailFrameRequired,
        tailFrameSource: tailFrame.source || "",
        tailFrameMessage: tailFrame.message || "",
        localFile: localFile ? path.relative(episodeRoot, localFile) : "",
      updatedAt: new Date().toISOString(),
    },
  });
  return { finalized: tailFrameRequired ? tailFrame.ready === true : true, localFile, tailFrame };
}

async function refreshExistingProjectVideoTask(episodeRoot, shotName, snapshot = {}, runNamespace = "") {
  const taskId = compactLine(snapshot.taskId || "");
  const provider = compactLine(snapshot.provider || "");
  if (!taskId || snapshot.statusCode !== 1) return { reused: false };
  const result = await getCanvasVideoGeneration(taskId, provider);
  updateProjectVideoSnapshotFromResult(episodeRoot, shotName, result, runNamespace);
  const resultVideoUrl = videoUrlFrom(result.videoUrl || "");
  if (result.status === "completed" && resultVideoUrl) {
    await finalizeExistingProjectVideoShot(episodeRoot, shotName, {
      taskId: result.taskId || taskId,
      provider: result.provider || provider,
      videoUrl: resultVideoUrl || snapshot.videoUrl || "",
      tailFrameUrl: result.tailFrameUrl || snapshot.tailFrameUrl || "",
      statusCode: 2,
      complete: false,
    }, runNamespace);
  }
  return { reused: true, result };
}

function archiveFileIfExists(file, archiveRoot, episodeRoot) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const rel = path.relative(episodeRoot, file).replace(/^(\.\.[/\\])+/, "");
  const target = path.join(archiveRoot, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(file, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    fs.copyFileSync(file, target);
    fs.unlinkSync(file);
  }
  return true;
}

function archiveShotVideoArtifactsForRegeneration(episodeRoot, shotName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveRoot = path.join(episodeRoot, "06_videos", "shot_regenerate_archive", stamp);
  const rawVideo = path.join(episodeRoot, "06_videos", "raw", `${safeSlug(shotName, "shot")}.mp4`);
  const rawMov = path.join(episodeRoot, "06_videos", "raw", `${safeSlug(shotName, "shot")}.mov`);
  const tailPng = tailFrameFileForShot(episodeRoot, shotName, "png");
  const snapshot = videoTaskSnapshotPath(episodeRoot, shotName);
  const archived = {
    rawVideo: archiveFileIfExists(rawVideo, archiveRoot, episodeRoot),
    rawMov: archiveFileIfExists(rawMov, archiveRoot, episodeRoot),
    tailFrame: archiveFileIfExists(tailPng, archiveRoot, episodeRoot),
    snapshot: archiveFileIfExists(snapshot, archiveRoot, episodeRoot),
  };
  return { archiveRoot, archived };
}

function videoTaskSnapshotPath(episodeRoot, shotName) {
  const nodeDir = path.join(episodeRoot, VIDEO_TASK_DIR);
  const canvasName = canvasNodeNameForShotName(shotName);
  const canvasFile = path.join(nodeDir, `${canvasName}.json`);
  if (fs.existsSync(canvasFile)) return canvasFile;
  return path.join(nodeDir, `${shotName}.json`);
}

function readVideoTaskSnapshot(episodeRoot, shotName) {
  const snapshot = videoTaskSnapshotPath(episodeRoot, shotName);
  if (!fs.existsSync(snapshot)) return null;
  try {
    return { file: snapshot, data: JSON.parse(fs.readFileSync(snapshot, "utf8")) };
  } catch {
    return null;
  }
}

function configuredRawVideos(episodeRoot, videos = null, configData = null) {
  const rawVideos = videos?.raw || scanVideos(episodeRoot).raw;
  const config = configData || readVideoConfig(episodeRoot)?.data || {};
  const shots = Array.isArray(config.shots) ? config.shots : [];
  if (!shots.length) return rawVideos;
  const picked = [];
  const seen = new Set();
  for (const shot of shots) {
    const video = matchVideoForShot(rawVideos, shot.name, { allowStemFallback: false });
    if (video && !seen.has(video.path)) {
      picked.push(video);
      seen.add(video.path);
    }
  }
  return picked;
}

function snapshotStatusForShot(episodeRoot, shotName, options = {}) {
  const runNamespace = normalizeRunNamespace(options.runNamespace || "");
  const minModifiedAt = Number(options.minModifiedAt || 0);
  const snapshot = videoTaskSnapshotPath(episodeRoot, shotName);
  if (!fs.existsSync(snapshot)) return null;
  try {
    if (minModifiedAt && fs.statSync(snapshot).mtimeMs < minModifiedAt) return null;
    const node = JSON.parse(fs.readFileSync(snapshot, "utf8"));
    if (runNamespace && normalizeRunNamespace(node.runNamespace || node.pipelineRunId || "") !== runNamespace) return null;
    const taskInfo = node.data?.taskInfo || {};
    const urls = Array.isArray(node.data?.url) ? node.data.url : [];
    const updatedAt = taskInfo.updatedAt || node.updatedAt || "";
    const provider = taskInfo.provider || node.provider || "";
    const rawVideoUrl = taskInfo.videoUrl || urls.find((item) => isLikelyVideoUrl(item)) || "";
    const invalidVideoUrl = invalidVideoUrlReason(taskInfo.videoUrl || "");
    const rawProgress = Number.isFinite(Number(taskInfo.progressPercent)) ? Number(taskInfo.progressPercent) : null;
    const isLegacyGravitexPlaceholder =
      taskInfo.status === 1 &&
      rawProgress === 50 &&
      compactLine(provider).toLowerCase() === "gravitex" &&
      /^任务生成中|任务排队中|生成中$/i.test(compactLine(taskInfo.message || ""));
    const staleSubmitting =
      taskInfo.status === 1 &&
      !taskInfo.taskId &&
      updatedAt &&
      Date.now() - Date.parse(updatedAt) > 2 * 60 * 1000;
    const staleSubmittingReason = staleSubmitting
      ? isAssetLibraryTimeoutMessage(taskInfo.message || taskInfo.failedReason || "")
        ? "素材库请求超时，视频任务未提交；可稍后重试"
        : "提交视频任务超时：没有拿到 taskId，请重试"
      : "";
    const tailFrameRequired = taskInfo.tailFrameRequired !== false;
    const recoveredTailFrame = existingTailFrameForShot(episodeRoot, shotName);
    const taskTailFrameReady = taskInfo.tailFrameReady === true || !!recoveredTailFrame;
    const taskTailFrameUrl = taskInfo.tailFrameUrl || recoveredTailFrame?.url || "";
    const taskTailFrameLocalFile = taskInfo.tailFrameLocalFile || recoveredTailFrame?.rel || "";
    return {
      statusCode: taskInfo.status ?? null,
      statusRaw: taskInfo.statusRaw || "",
      progress: isLegacyGravitexPlaceholder ? null : rawProgress,
      failedReason: staleSubmittingReason || invalidVideoUrl || taskInfo.failedReason || "",
      message: taskInfo.message || "",
      taskId: taskInfo.taskId || "",
      provider,
      videoUrl: videoUrlFrom(rawVideoUrl),
      localFile: taskInfo.localFile || "",
      tailFrameReady: taskTailFrameReady,
      tailFrameRequired,
      tailFrameUrl: taskTailFrameUrl,
      tailFrameLocalFile: taskTailFrameLocalFile,
      tailFrameSource: taskInfo.tailFrameSource || "",
      urlCount: urls.length,
      complete: taskInfo.status === 2 && (!tailFrameRequired || taskTailFrameReady),
      failed: staleSubmitting || !!invalidVideoUrl || !!taskInfo.failedReason || taskInfo.status === 3,
    };
  } catch {
    return null;
  }
}

const projectVideoFinalizations = new Set();
const projectVideoStatusRefreshes = new Set();

function canvasVideoStatusCode(node = {}) {
  const status = compactLine(node.status || "").toLowerCase();
  if (invalidVideoUrlReason(node.videoUrl || "")) return 3;
  if (videoUrlFrom(node.videoUrl || "") || status === "completed" || status === "complete") return 2;
  if (status === "failed" || status === "error") return 3;
  if (status === "queued") return 0;
  if (node.taskId || status === "running" || status === "pending") return 1;
  return null;
}

function projectVideoNeedsFinalization(episodeRoot, shotName, videoUrl = "") {
  const snapshot = readVideoTaskSnapshot(episodeRoot, shotName)?.data || {};
  const taskInfo = snapshot.data?.taskInfo || {};
  const config = readVideoConfig(episodeRoot)?.data || {};
  const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName);
  const tailFrameRequired = taskInfo.tailFrameRequired !== undefined ? taskInfo.tailFrameRequired !== false : !isProductionBoardMode(config, shot);
  const localRel = compactLine(taskInfo.localFile || "");
  const tailRel = compactLine(taskInfo.tailFrameLocalFile || "");
  const localReady = localRel && fs.existsSync(path.join(episodeRoot, localRel));
  const tailReady = taskInfo.tailFrameReady === true && tailRel && fs.existsSync(path.join(episodeRoot, tailRel));
  return !!videoUrl && (!localReady || (tailFrameRequired && !tailReady));
}

function scheduleProjectVideoFinalization(episodeRoot, shotName, node = {}, runNamespace = "") {
  const videoUrl = compactLine(node.videoUrl || "");
  if (!projectVideoNeedsFinalization(episodeRoot, shotName, videoUrl)) return;
  const key = `${path.resolve(episodeRoot)}::${shotName}`;
  if (projectVideoFinalizations.has(key)) return;
  projectVideoFinalizations.add(key);
  (async () => {
    try {
      const localFile = await downloadProjectVideoResult(episodeRoot, shotName, videoUrl);
      const tailFrame = await persistProjectTailFrame(episodeRoot, shotName, { videoUrl, tailFrameUrl: node.tailFrameUrl || "" }, localFile);
      const config = readVideoConfig(episodeRoot)?.data || {};
      const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName);
      const tailFrameRequired = !isProductionBoardMode(config, shot);
      writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
        runNamespace,
        provider: node.taskProvider || "",
        urls: [videoUrl],
        taskInfo: {
          taskId: node.taskId || "",
          provider: node.taskProvider || "",
          status: 2,
          progressPercent: 100,
          failedReason: "",
          message: projectVideoFinalizingMessage(tailFrame, localFile, { tailFrameRequired }),
          videoUrl,
          tailFrameUrl: tailFrame.url || node.tailFrameUrl || "",
          tailFrameLocalFile: tailFrame.localFile || "",
          tailFrameReady: tailFrame.ready,
          tailFrameRequired,
          tailFrameSource: tailFrame.source || "",
          tailFrameMessage: tailFrame.message || "",
          localFile: localFile ? path.relative(episodeRoot, localFile) : "",
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
        runNamespace,
        provider: node.taskProvider || "",
        urls: [videoUrl],
        taskInfo: {
          taskId: node.taskId || "",
          provider: node.taskProvider || "",
          status: 2,
          progressPercent: 100,
          failedReason: "",
          message: `生成完成；本地下载/尾帧处理稍后重试：${compactLine(error.message)}`,
          videoUrl,
          updatedAt: new Date().toISOString(),
        },
      });
    } finally {
      projectVideoFinalizations.delete(key);
      maybeAutoAssembleFinalCut(episodeRoot);
    }
  })();
}

function scheduleProjectVideoStatusRefresh(episodeRoot, shotName, snapshot = {}, runNamespace = "") {
  const taskId = compactLine(snapshot.taskId || "");
  const provider = compactLine(snapshot.provider || "");
  if (!taskId || snapshot.statusCode !== 1) return;
  const key = `${path.resolve(episodeRoot)}::${shotName}::${taskId}`;
  if (projectVideoStatusRefreshes.has(key)) return;
  projectVideoStatusRefreshes.add(key);
  (async () => {
    try {
      const result = await getCanvasVideoGeneration(taskId, provider);
      updateProjectVideoSnapshotFromResult(episodeRoot, shotName, result, runNamespace);
      const resultVideoUrl = videoUrlFrom(result.videoUrl || "");
      if (result.status === "completed" && resultVideoUrl) {
        scheduleProjectVideoFinalization(
          episodeRoot,
          shotName,
          {
            taskId: result.taskId || taskId,
            taskProvider: result.provider || provider,
            videoUrl: resultVideoUrl,
            tailFrameUrl: result.tailFrameUrl || "",
          },
          runNamespace,
        );
      }
    } catch {
      // 读取项目状态不应因为一次任务查询失败而阻塞前端；下一次刷新会再尝试。
    } finally {
      setTimeout(() => projectVideoStatusRefreshes.delete(key), 4500);
    }
  })();
}

function reconcileProjectVideoStateFromCanvas(episodeRoot, config = {}, runNamespace = "") {
  const projectId = videoCanvasIdForConfig(episodeRoot, config);
  const state = readCanvasState(projectId);
  const shots = Array.isArray(config.shots) ? config.shots : [];
  if (!state || !Array.isArray(state.nodes) || !shots.length) return;
  const nodesById = new Map(state.nodes.filter((node) => node?.id && node.kind === "video").map((node) => [node.id, node]));
  for (const [index, shot] of shots.entries()) {
    const nodeId = canvasNodeFromConfigShot(shot, index, config).id;
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const statusCode = canvasVideoStatusCode(node);
    if (statusCode === null || statusCode === undefined) continue;
    const existing = readVideoTaskSnapshot(episodeRoot, shot.name)?.data || {};
    const taskInfo = existing.data?.taskInfo || {};
    if (taskInfo.status === 2 && statusCode !== 2) {
      syncCanvasVideoNodeFromSnapshot(episodeRoot, shot.name, {
        runNamespace,
        provider: taskInfo.provider || existing.provider || "",
        urls: taskInfo.videoUrl ? [taskInfo.videoUrl] : Array.isArray(existing.data?.url) ? existing.data.url : [],
        taskInfo: {
          ...taskInfo,
          status: 2,
          progressPercent: 100,
          failedReason: "",
          message: taskInfo.message || "生成完成",
          updatedAt: new Date().toISOString(),
        },
      });
      continue;
    }
    const rawVideoUrl = compactLine(node.videoUrl || taskInfo.videoUrl || "");
    const videoUrl = videoUrlFrom(rawVideoUrl);
    const invalidNodeVideoUrl = invalidVideoUrlReason(rawVideoUrl);
    const nodeTaskId = compactLine(node.taskId || "");
    const nodeMessage = compactLine(node.statusMessage || "");
    const ignoreSubmitPlaceholder =
      statusCode === 1 &&
      !nodeTaskId &&
      !videoUrl &&
      /^正在提交|提交中|sending|submitting/i.test(nodeMessage);
    if (ignoreSubmitPlaceholder) continue;
    if (statusCode === 3 && isAssetActivationWaitFailure(nodeMessage) && shotPhotorealReferencesAreActive(config, shot)) {
      syncCanvasVideoNodeFromSnapshot(episodeRoot, shot.name, {
        runNamespace,
        taskInfo: {
          clearStatus: true,
          status: null,
          progressPercent: 0,
          failedReason: "",
          message: "素材已 active，待生成",
          taskId: "",
          provider: "",
          videoUrl: "",
          tailFrameUrl: "",
          tailFrameLocalFile: "",
          tailFrameReady: false,
          tailFrameMessage: "",
          localFile: "",
          updatedAt: new Date().toISOString(),
        },
      });
      continue;
    }
    if (statusCode === 2 && !videoUrl) continue;
    const progressPercent = statusCode === 2
      ? 100
      : statusCode === 3
        ? 100
        : normalizeProgressValue(node.progress, taskInfo.progressPercent);
    const shouldWrite =
      taskInfo.status !== statusCode ||
      (videoUrl && taskInfo.videoUrl !== videoUrl) ||
      compactLine(taskInfo.taskId || "") !== compactLine(node.taskId || taskInfo.taskId || "") ||
      (progressPercent !== null && Number(taskInfo.progressPercent ?? -1) !== progressPercent);
    if (shouldWrite) {
      writeProjectVideoTaskSnapshot(episodeRoot, shot.name, {
        runNamespace,
        provider: node.taskProvider || taskInfo.provider || "",
        urls: videoUrl ? [videoUrl] : Array.isArray(existing.data?.url) ? existing.data.url : [],
        taskInfo: {
          ...taskInfo,
          taskId: nodeTaskId || taskInfo.taskId || "",
          provider: node.taskProvider || taskInfo.provider || "",
          status: statusCode,
          progressPercent: progressPercent === null ? undefined : progressPercent,
          failedReason: statusCode === 3 ? invalidNodeVideoUrl || node.statusMessage || taskInfo.failedReason || "视频生成失败" : "",
          message: statusCode === 2 ? taskInfo.message || "生成完成，正在同步到项目" : invalidNodeVideoUrl || node.statusMessage || taskInfo.message || "",
          videoUrl,
          tailFrameUrl: node.tailFrameUrl || taskInfo.tailFrameUrl || "",
          tailFrameLocalFile: node.tailFrameLocalFile || taskInfo.tailFrameLocalFile || "",
          tailFrameReady: node.tailFrameReady === true || taskInfo.tailFrameReady === true,
          tailFrameMessage: node.tailFrameMessage || taskInfo.tailFrameMessage || "",
          updatedAt: new Date().toISOString(),
        },
      });
    }
    if (statusCode === 2) scheduleProjectVideoFinalization(episodeRoot, shot.name, { ...node, videoUrl }, runNamespace);
  }
}

function writeVideoTaskSnapshot(episodeRoot, shotName, patch = {}) {
  const cleanShotName = compactLine(shotName);
  if (!cleanShotName) throw new Error("缺少片段名称");
  const nodeDir = path.join(episodeRoot, VIDEO_TASK_DIR);
  fs.mkdirSync(nodeDir, { recursive: true });
  const file = path.join(nodeDir, `${cleanShotName}.json`);
  let previous = {};
  if (fs.existsSync(file)) {
    try {
      previous = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      previous = {};
    }
  }
  const previousTaskInfo = previous.data?.taskInfo || {};
  const config = readVideoConfig(episodeRoot)?.data || {};
  const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === cleanShotName);
  const inferredTailFrameRequired = !isProductionBoardMode(config, shot);
  const nextTaskInfo = {
    ...previousTaskInfo,
    ...(patch.taskInfo || {}),
  };
  if (patch.taskInfo?.tailFrameRequired === undefined) nextTaskInfo.tailFrameRequired = inferredTailFrameRequired;
  const nextUrls = Array.isArray(patch.urls)
    ? patch.urls
    : Array.isArray(previous.data?.url)
      ? previous.data.url
      : [];
  const snapshot = {
    ...previous,
    id: cleanShotName,
    kind: "video",
    source: "project-console",
    updatedAt: new Date().toISOString(),
    runNamespace: normalizeRunNamespace(patch.runNamespace || previous.runNamespace || currentRunNamespace(episodeRoot)),
    provider: patch.provider || previous.provider || "",
    data: {
      ...(previous.data || {}),
      taskInfo: nextTaskInfo,
      url: nextUrls,
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

function syncCanvasVideoNodeFromSnapshot(episodeRoot, shotName, patch = {}) {
  const config = readVideoConfig(episodeRoot)?.data || {};
  const shots = Array.isArray(config.shots) ? config.shots : [];
  const shotIndex = shots.findIndex((item) => item.name === shotName);
  const shot = shotIndex >= 0 ? shots[shotIndex] : { name: shotName };
  const nodeId = canvasNodeFromConfigShot(shot, Math.max(0, shotIndex), config).id;
  const projectId = videoCanvasIdForConfig(episodeRoot, config);
  const state = readCanvasState(projectId);
  if (!state || !Array.isArray(state.nodes)) return null;
  const nodeIndex = state.nodes.findIndex((node) => node.id === nodeId);
  if (nodeIndex < 0) return null;
  const taskInfo = patch.taskInfo || {};
  const statusCode = taskInfo.status;
  const status =
    taskInfo.clearStatus === true
      ? "idle"
      : statusCode === 2
      ? "completed"
      : statusCode === 3
        ? "failed"
        : statusCode === 1
          ? "running"
          : statusCode === 0
            ? "queued"
            : state.nodes[nodeIndex].status || "idle";
  const hasProgressPatch = Number.isFinite(Number(taskInfo.progressPercent));
  const nextNode = {
    ...state.nodes[nodeIndex],
    status,
    statusMessage: taskInfo.clearStatus === true ? taskInfo.message || "" : taskInfo.message || taskInfo.failedReason || state.nodes[nodeIndex].statusMessage || "",
    taskId: taskInfo.taskId || (statusCode === 1 || statusCode === 0 ? "" : state.nodes[nodeIndex].taskId || ""),
    taskProvider: taskInfo.provider || patch.provider || (statusCode === 1 || statusCode === 0 ? "" : state.nodes[nodeIndex].taskProvider || ""),
    progress: hasProgressPatch ? Number(taskInfo.progressPercent) : statusCode === 1 ? null : statusCode === 0 ? 0 : state.nodes[nodeIndex].progress,
    videoUrl: videoUrlFrom(taskInfo.videoUrl || "") || (statusCode === 1 || statusCode === 0 || statusCode === 3 ? "" : videoUrlFrom(state.nodes[nodeIndex].videoUrl || "")),
    tailFrameReady: taskInfo.tailFrameReady === true ? true : statusCode === 1 || statusCode === 0 ? false : state.nodes[nodeIndex].tailFrameReady,
    tailFrameUrl: taskInfo.tailFrameUrl || (statusCode === 1 || statusCode === 0 ? "" : state.nodes[nodeIndex].tailFrameUrl || ""),
    tailFrameLocalFile: taskInfo.tailFrameLocalFile || (statusCode === 1 || statusCode === 0 ? "" : state.nodes[nodeIndex].tailFrameLocalFile || ""),
    tailFrameMessage: taskInfo.tailFrameMessage || (statusCode === 1 || statusCode === 0 ? "" : state.nodes[nodeIndex].tailFrameMessage || ""),
  };
  state.nodes[nodeIndex] = nextNode;
  return writeCanvasState(state);
}

function writeProjectVideoTaskSnapshot(episodeRoot, shotName, patch = {}) {
  const snapshot = writeVideoTaskSnapshot(episodeRoot, shotName, patch);
  syncCanvasVideoNodeFromSnapshot(episodeRoot, shotName, patch);
  return snapshot;
}

function videoTaskStatusCode(status = "") {
  const clean = compactLine(status).toLowerCase();
  if (clean === "completed" || clean === "complete" || clean === "success") return 2;
  if (clean === "failed" || clean === "error" || clean === "cancelled" || clean === "canceled") return 3;
  return 1;
}

function latestJobForTypes(localJobs, types) {
  const allowed = new Set(types);
  return localJobs.find((job) => allowed.has(job.type)) || null;
}

function latestVisibleAssetJob(localJobs) {
  return latestJobForTypes(
    localJobs.filter((job) => {
      if (!["assets", "asset-regenerate", "asset-edit"].includes(job.type)) return false;
      const targets = Array.isArray(job.targetAssetNames) ? job.targetAssetNames.filter(Boolean) : [];
      if (job.status === "interrupted" && !targets.length) return false;
      return true;
    }),
    ["assets", "asset-regenerate", "asset-edit"],
  );
}

function jobFailureReason(job) {
  const log = String(job?.logs || "").trim();
  if (!log) return "";
  const lines = log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [...lines].reverse().filter((line) => {
    if (/^\[upload\]/i.test(line)) return false;
    if (/^\d{4}-\d{2}-\d{2}T/.test(line) && !/failed|error|失败|错误|审核|fetch/i.test(line)) return false;
    return /创建生成任务失败|API Request Error|Command failed|fetch failed|failed|error|失败|错误|审核|版权|限制|timed out|算力不足|平台规则/i.test(line);
  });
  const explicitReason = candidates.find((line) => /创建生成任务失败|算力不足|平台规则|审核|版权|限制|failed|error|失败|错误/i.test(line));
  if (explicitReason) {
    return explicitReason
      .replace(/Command failed:\s*\/\S+\s+/i, "命令失败：")
      .replace(/\/Users\/\S+/g, "[local-path]")
      .slice(0, 220);
  }
  const latestUpload = [...lines].reverse().find((line) => /:\s*uploading (?:asset|tail frame)/i.test(line));
  const uploadName = latestUpload ? latestUpload.replace(/^\S+\s+/, "").replace(/:\s*uploading (?:asset|tail frame).*$/i, "") : "";
  if (/fetch failed/i.test(log) && uploadName) return `${uploadName}：上传参考资产到视频接口失败（fetch failed）`;
  if (/local asset file missing/i.test(log)) return "本地参考资产文件缺失，无法提交视频生成";
  let reason = candidates[0] || lines.slice(-1)[0] || "";
  reason = reason
    .replace(/Command failed:\s*\/\S+\s+/i, "命令失败：")
    .replace(/\/Users\/\S+/g, "[local-path]");
  return compactLine(reason).slice(0, 220);
}

function mergeJobs(episodeRoot, options = {}) {
  const runNamespace = normalizeRunNamespace(options.runNamespace || "");
  const live = [...jobs.values()].filter((job) => job.episodeRoot === episodeRoot && runNamespaceMatches(job, runNamespace));
  const byId = new Map();
  for (const job of readPersistedJobs(episodeRoot, { runNamespace })) {
    const isLive = live.some((item) => item.id === job.id);
    const interrupted = job.status === "running" && !isLive;
    byId.set(job.id, interrupted ? markInterruptedPersistedJob(job) : job);
  }
  for (const job of live) byId.set(job.id, job);
  return [...byId.values()].sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
}

function jobSummary(job) {
  if (!job) return null;
  const log = String(job.logs || "").trim();
  // failureDetails/failureReason 在新版 job 里已持久化；历史 job 没有，按需从磁盘回填。
  let failureDetails = Array.isArray(job.failureDetails) ? job.failureDetails : null;
  const hasStaleFailureDetails =
    failureDetails?.some((item) => item?.category === "unknown" || !Number(item?.status || 0));
  let staleFailureDetailsCleared = false;
  if ((!failureDetails || hasStaleFailureDetails) && (job.status === "failed" || job.status === "interrupted") && job.episodeRoot) {
    try {
      const found = jobAssetFailures(job.episodeRoot, job.startedAt, {
        runNamespace: job.runNamespace,
        targetAssetNames: job.targetAssetNames || [],
      });
      if (found.length) {
        failureDetails = found;
      } else {
        failureDetails = null;
        staleFailureDetailsCleared = !!hasStaleFailureDetails;
      }
    } catch {
      failureDetails = null;
    }
  }
  const shouldShowFailureReason = ["failed", "interrupted", "canceled", "cancelled"].includes(job.status);
  const storedFailureReason = staleFailureDetailsCleared ? "" : compactLine(job.failureReason || "");
  const failureDetailsReason = failureDetails?.length
    ? `[${failureDetails[0].category}] ${failureDetails.length} 个：${failureDetails.map((item) => item.name).join(", ")} → ${failureDetails[0].advice}`
    : "";
  const inferredFailureReason = shouldShowFailureReason && !staleFailureDetailsCleared ? jobFailureReason(job) : "";
  const staleUploadReason =
    /fetch failed|上传参考资产|upload/i.test(storedFailureReason) &&
    /创建生成任务失败|算力不足|平台规则|审核|版权|限制/i.test(log);
  const failureReason = shouldShowFailureReason
    ? staleUploadReason
      ? inferredFailureReason || storedFailureReason
      : failureDetailsReason || storedFailureReason || inferredFailureReason
    : "";
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    command: job.command,
    shotName: job.shotName || job.targetShotName || "",
    assetStylePreset: job.assetStylePreset,
    assetStyleLabel: job.assetStyleLabel,
    assetStyleReferenceEnabled: !!job.assetStyleReferenceEnabled,
    assetStyleReferenceName: job.assetStyleReferenceName || "",
    targetAssetNames: Array.isArray(job.targetAssetNames) ? job.targetAssetNames : [],
    failureReason,
    failureDetails: failureDetails || [],
    logs: log.slice(-12000),
    lastLine: log.split(/\r?\n/).filter(Boolean).slice(-1)[0] || "",
  };
}

function isShotPromptSection(section) {
  const name = compactLine(section?.name || "");
  const body = String(section?.body || "");
  if (/^[A-Z]\d+_V\d+/i.test(name) || /^V\d+/i.test(name)) return true;
  return /(?:参考映射|参考资产)[:：]/.test(body) && /(?:推荐时长|duration|时长)[:：]?\s*\d+/i.test(body);
}

function defaultGroupName(episodeRoot) {
  const projectName = safeSlug(path.basename(projectDirForEpisode(episodeRoot)), "PROJECT").toUpperCase();
  const episodeName = safeSlug(episodeSlug(episodeRoot), episodeCode(episodeSlug(episodeRoot))).toUpperCase();
  return `${projectName}_${episodeName}_VIDEO_GENERATION`.slice(0, 96);
}

function configReadiness(episodeRoot, configData = null) {
  const config = configData || readVideoConfig(episodeRoot)?.data || null;
  const dialogueLanguage = projectDialogueLanguage(episodeRoot, "en");
  const runStart = currentRunStartMs(episodeRoot, config);
  const missing = [];
  if (!config) {
    const currentAssets = projectProductionAssetsForState(episodeRoot, readAssetManifest(episodeRoot)?.data, { minModifiedAt: runStart });
    const currentStoryboards = currentStoryboardAssetsForWorkflow(scanAssets(episodeRoot), { minModifiedAt: runStart });
    return {
      exists: false,
      ready: false,
      missing: ["视频配置尚未生成"],
      groupName: "",
      modelName: "",
      resolution: "",
      ratio: "",
      assets: currentAssets.length,
      storyboards: currentStoryboards.length,
      canvasAssets: currentAssets.length + currentStoryboards.length,
      shots: 0,
      totalDuration: 0,
      dialogueLanguage,
      enableStoryboards: false,
      promptMode: "prompt",
      tailFrameContinuity: true,
      workflowGuide: "",
    };
  }
  const assets = Array.isArray(config.assets) ? config.assets : [];
  const promptMode = config.settings?.promptMode || (config.settings?.enableStoryboards === true ? "production_board" : "prompt");
  const storyboardOnlyReferences = promptMode === "production_board";
  const productionAssets = assets.filter((asset) => asset.manifestType !== "Storyboard");
  const storyboards = Array.isArray(config.storyboardReferences) ? config.storyboardReferences : [];
  const shots = Array.isArray(config.shots) ? config.shots : [];
  const assetNames = new Set(productionAssets.map((asset) => compactLine(asset.name || asset.assetName || "")).filter(Boolean));
  const allAssetNames = new Set(assets.map((asset) => compactLine(asset.name || asset.assetName || "")).filter(Boolean));
  // 兜底:config.assets 名单可能滞后于 shot.storyboardRefs(故事板重分组后名字变化)。把磁盘上真实存在的
  // 故事板文件名并入允许集合,避免"图已在磁盘、引用也对"却因名单滞后被误报"N 个片段引用了未生成资产"。
  if (episodeRoot) {
    for (const asset of scanAssets(episodeRoot)) {
      if (asset.manifestType === "Storyboard" && asset.assetName) allAssetNames.add(asset.assetName);
    }
  }
  if (!storyboardOnlyReferences && !productionAssets.length) missing.push("缺少资产图");
  if (!shots.length) missing.push("缺少视频片段");
  // 仅当缺失资产被某片段(refs/storyboardRefs)真正引用时才锁定生成;未被引用的死资产不阻塞。
  // 片段引用了未生成资产另有 shotsWithMissingRefs 精准兜底。
  const shotReferencedAssetNames = new Set();
  for (const shot of shots) {
    const references = storyboardOnlyReferences
      ? (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [])
      : (Array.isArray(shot.refs) ? shot.refs : []);
    for (const reference of references) { const clean = compactLine(reference); if (clean) shotReferencedAssetNames.add(clean); }
  }
  for (const name of Array.isArray(config.missingAssets) ? config.missingAssets : []) {
    const clean = compactLine(name);
    if (clean && shotReferencedAssetNames.has(clean)) missing.push(`缺少资产图：${clean}`);
  }
  if (promptMode === "production_board" && !storyboards.length) missing.push("缺少 Production Board");
  if (promptMode === "production_board") {
    const storyboardShotsWithoutRefs = shots.filter((shot) => !Array.isArray(shot.storyboardRefs) || !shot.storyboardRefs.length);
    if (storyboardShotsWithoutRefs.length) missing.push(`${storyboardShotsWithoutRefs.length} 个片段缺少 Production Board 绑定`);
  }
  const shotsWithoutRefs = shots.filter((shot) => {
    const references = storyboardOnlyReferences
      ? (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [])
      : (Array.isArray(shot.refs) ? shot.refs : []);
    return !references.length;
  });
  if (shotsWithoutRefs.length) missing.push(`${shotsWithoutRefs.length} 个片段缺少参考图`);
  const shotsWithMissingRefs = shots
    .map((shot) => ({
      name: shot.name,
      missingRefs: (storyboardOnlyReferences
        ? (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [])
        : (Array.isArray(shot.refs) ? shot.refs : []))
        .map(compactLine)
        .filter((ref) => ref && !(storyboardOnlyReferences ? allAssetNames : assetNames).has(ref)),
      missingStoryboardRefs: [],
    }))
    .filter((item) => item.missingRefs.length || item.missingStoryboardRefs.length);
  if (shotsWithMissingRefs.length) missing.push(`${shotsWithMissingRefs.length} 个片段引用了未生成资产`);
  return {
    exists: true,
    ready: missing.length === 0,
    missing,
    groupName: config.groupName || "",
    modelName: config.modelName || "",
    videoCanvasId: videoCanvasIdForConfig(episodeRoot, config),
    videoCanvasCreatedAt: config.videoCanvasCreatedAt || "",
    resolution: config.settings?.resolution || "",
    ratio: config.settings?.ratio || "",
    assets: productionAssets.length,
    canvasAssets: assets.length,
    storyboards: storyboards.length,
    shots: shots.length,
    totalDuration: shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0),
    dialogueLanguage: config.dialogueLanguage || config.settings?.dialogueLanguage || dialogueLanguage,
    enableStoryboards: config.settings?.enableStoryboards === true,
    promptMode,
    tailFrameContinuity: config.settings?.tailFrameContinuity !== false,
    workflowGuide: compactLine(config.workflowGuide?.phase || ""),
  };
}

function isGenericGroupName(groupName, episodeRoot) {
  const slug = safeSlug(episodeSlug(episodeRoot), "e01");
  const code = episodeCode(slug);
  const value = String(groupName || "");
  return [
    `${slug}_VIDEO_GENERATION`,
    `${slug}_VIDEO_GENERATION_FAST`,
    `${code}_VIDEO_GENERATION`,
    `${code}_VIDEO_GENERATION_FAST`,
  ].some((name) => name.toLowerCase() === value.toLowerCase());
}

function isolatedDefaultGroupName(episodeRoot, runNamespace = "") {
  const base = defaultGroupName(episodeRoot);
  const suffix = normalizeRunNamespace(runNamespace).slice(-8).toUpperCase();
  return suffix ? `${base}_${suffix}`.slice(0, 96) : base;
}

function isAssetActivationWaitFailure(message = "") {
  const clean = compactLine(message);
  return /(?:等待\s*active|待\s*active|active\s*后|进入素材库|素材库验证未完成|素材已提交|素材仍在处理中|素材.*处理中|尾帧.*active|等待上一段尾帧|等待前序片段完成)/i.test(clean);
}

function shotPhotorealReferencesAreActive(config = {}, shot = {}) {
  const refs = projectShotUsableVideoReferenceAssets("", config, shot).filter(isArkPersonReferenceAsset);
  if (!refs.length) return true;
  return refs.every((asset) => {
    const status = compactLine(asset.validationStatus || asset.status || "").toLowerCase();
    const assetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
    return status === "active" && /^asset:\/\//i.test(assetUrl);
  });
}

function shotTailFrameAssetIsActive(config = {}, shot = {}) {
  if (isProductionBoardMode(config, shot) || shot?.useTailFrame !== true || !shot.tailFrameSource) return true;
  const id = `${compactLine(shot.name || "shot")}_START_FRAME`;
  const asset = config.tailFrameAssets?.[id] || null;
  if (!asset) return false;
  const status = compactLine(asset.status || asset.validationStatus || "").toLowerCase();
  const assetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
  return status === "active" && /^asset:\/\//i.test(assetUrl);
}

function resolvedAssetActivationFailure(config = {}, shot = {}, snapshot = null) {
  if (!snapshot?.failed) return false;
  if (!isAssetActivationWaitFailure(`${snapshot.failedReason || ""} ${snapshot.message || ""}`)) return false;
  return shotPhotorealReferencesAreActive(config, shot) && shotTailFrameAssetIsActive(config, shot);
}

function snapshotIsAssetActivationWait(snapshot = null) {
  if (!snapshot) return false;
  return isAssetActivationWaitFailure(`${snapshot.failedReason || ""} ${snapshot.message || ""}`);
}

function clearResolvedAssetActivationFailures(episodeRoot, config = {}, runNamespace = "") {
  const shots = Array.isArray(config.shots) ? config.shots : [];
  let cleared = 0;
  for (const shot of shots) {
    const snapshot = snapshotStatusForShot(episodeRoot, shot.name, { runNamespace });
    if (!resolvedAssetActivationFailure(config, shot, snapshot)) continue;
    writeProjectVideoTaskSnapshot(episodeRoot, shot.name, {
      runNamespace,
      taskInfo: {
        clearStatus: true,
        status: null,
        progressPercent: 0,
        failedReason: "",
        message: "素材已 active，待生成",
        taskId: "",
        provider: "",
        videoUrl: "",
        tailFrameUrl: "",
        tailFrameLocalFile: "",
        tailFrameReady: false,
        tailFrameMessage: "",
        localFile: "",
        updatedAt: new Date().toISOString(),
      },
    });
    cleared += 1;
  }
  return cleared;
}

function markProjectVideoShotWaiting(episodeRoot, shotName, message = "等待素材库 active 后再提交视频", options = {}) {
  const config = readVideoConfig(episodeRoot)?.data || {};
  const runNamespace = currentRunNamespace(episodeRoot, config);
  return writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
    runNamespace,
    taskInfo: {
      status: 0,
      statusRaw: compactLine(options.statusRaw || "waiting_asset_active"),
      progressPercent: 0,
      failedReason: "",
      message,
      taskId: "",
      provider: "",
      videoUrl: "",
      tailFrameUrl: "",
      tailFrameLocalFile: "",
      tailFrameReady: false,
      tailFrameMessage: "",
      localFile: "",
      updatedAt: new Date().toISOString(),
    },
  });
}

function migrateAssetActivationFailuresToQueued(episodeRoot, config = {}, runNamespace = "") {
  const shots = Array.isArray(config.shots) ? config.shots : [];
  let migrated = 0;
  for (const shot of shots) {
    const snapshot = snapshotStatusForShot(episodeRoot, shot.name, { runNamespace });
    if (!snapshot?.failed || !snapshotIsAssetActivationWait(snapshot)) continue;
    markProjectVideoShotWaiting(episodeRoot, shot.name, snapshot.failedReason || snapshot.message || "等待素材库 active 后再提交视频");
    migrated += 1;
  }
  return migrated;
}

function migrateInvalidVideoUrlsToFailed(episodeRoot, config = {}, runNamespace = "") {
  const shots = Array.isArray(config.shots) ? config.shots : [];
  let migrated = 0;
  for (const shot of shots) {
    const snapshot = readVideoTaskSnapshot(episodeRoot, shot.name);
    const taskInfo = snapshot?.data?.data?.taskInfo || {};
    const reason = invalidVideoUrlReason(taskInfo.videoUrl || "");
    if (!reason) continue;
    writeProjectVideoTaskSnapshot(episodeRoot, shot.name, {
      runNamespace,
      provider: taskInfo.provider || snapshot.data.provider || "",
      urls: [],
      taskInfo: {
        ...taskInfo,
        status: 3,
        statusRaw: taskInfo.statusRaw || "failed",
        progressPercent: 100,
        failedReason: reason,
        message: reason,
        videoUrl: "",
        tailFrameUrl: "",
        tailFrameLocalFile: "",
        tailFrameReady: false,
        tailFrameMessage: "",
        localFile: "",
        updatedAt: new Date().toISOString(),
      },
    });
    migrated += 1;
  }
  return migrated;
}

function isMissingVideoReferenceFailure(message = "") {
  return /缺少(?:可用|可提交)?参考资产图|缺少可用参考资产图|缺少可提交的参考资产图|请先生成或导入资产图/i.test(compactLine(message));
}

function videoReferenceRecoveryCandidates(episodeRoot, config = {}) {
  const candidates = new Map();
  const remember = (shot, shotConfig) => {
    const name = compactLine(shot?.name || "");
    if (!name || candidates.has(name)) return;
    candidates.set(name, { shot, config: { ...(shotConfig || config || {}), episodeRoot } });
  };
  for (const shot of Array.isArray(config.shots) ? config.shots : []) remember(shot, config);
  for (const state of canvasStatesForEpisodeRoot(episodeRoot)) {
    for (const node of Array.isArray(state.nodes) ? state.nodes : []) {
      if (node?.kind !== "video") continue;
      const shotName = compactLine(node.projectShotName || node.shotName || "");
      if (!shotName || candidates.has(shotName)) continue;
      const fallback = canvasVideoFallbackForShot(episodeRoot, shotName);
      if (fallback?.shot && fallback?.config) remember(fallback.shot, fallback.config);
    }
  }
  return [...candidates.values()];
}

function clearResolvedVideoReferenceFailures(episodeRoot, config = {}, runNamespace = "") {
  let cleared = 0;
  for (const candidate of videoReferenceRecoveryCandidates(episodeRoot, config)) {
    const shot = candidate.shot || {};
    const shotConfig = candidate.config || {};
    const snapshot = readVideoTaskSnapshot(episodeRoot, shot.name);
    const taskInfo = snapshot?.data?.data?.taskInfo || {};
    if (Number(taskInfo.status) !== 3) continue;
    if (!isMissingVideoReferenceFailure(`${taskInfo.failedReason || ""} ${taskInfo.message || ""}`)) continue;
    if (!projectShotUsableVideoReferenceAssets(episodeRoot, shotConfig, shot).length) continue;
    writeProjectVideoTaskSnapshot(episodeRoot, shot.name, {
      runNamespace: snapshot?.data?.runNamespace || runNamespace,
      urls: [],
      taskInfo: {
        clearStatus: true,
        status: null,
        statusRaw: "",
        progressPercent: 0,
        failedReason: "",
        message: "参考资产已恢复，待生成",
        taskId: "",
        provider: "",
        videoUrl: "",
        tailFrameUrl: "",
        tailFrameLocalFile: "",
        tailFrameReady: false,
        tailFrameMessage: "",
        localFile: "",
        updatedAt: new Date().toISOString(),
      },
    });
    cleared += 1;
  }
  return cleared;
}

function videoProgress(episodeRoot, localJobs, videos) {
  const config = readVideoConfig(episodeRoot);
  const configData = config?.data || {};
  const runNamespace = currentRunNamespace(episodeRoot, configData);
  const runStartedAt = runNamespaceStartMs(runNamespace);
  const shots = Array.isArray(configData.shots) ? configData.shots : [];
  const rawVideos = videos.raw || [];
  const items = shots.map((shot, index) => {
    let snapshot = snapshotStatusForShot(episodeRoot, shot.name, { runNamespace, minModifiedAt: runStartedAt });
    if (snapshot?.failed && snapshotIsAssetActivationWait(snapshot)) {
      markProjectVideoShotWaiting(episodeRoot, shot.name, snapshot.failedReason || snapshot.message || "等待素材库 active 后再提交视频");
      snapshot = snapshotStatusForShot(episodeRoot, shot.name, { runNamespace, minModifiedAt: runStartedAt });
    }
    if (resolvedAssetActivationFailure(configData, shot, snapshot)) {
      writeProjectVideoTaskSnapshot(episodeRoot, shot.name, {
        runNamespace,
        taskInfo: {
          clearStatus: true,
          status: null,
          progressPercent: 0,
          failedReason: "",
          message: "素材已 active，待生成",
          taskId: "",
          provider: "",
          videoUrl: "",
          tailFrameUrl: "",
          tailFrameLocalFile: "",
          tailFrameReady: false,
          tailFrameMessage: "",
          localFile: "",
          updatedAt: new Date().toISOString(),
        },
      });
      snapshot = snapshotStatusForShot(episodeRoot, shot.name, { runNamespace, minModifiedAt: runStartedAt });
    }
    let status = "waiting";
    let progress = 0;
    let label = "待生成";
    let source = "";
    const completedLocal = snapshot?.complete ? localVideoFromSnapshot(episodeRoot, snapshot) : null;
    const staleLocal = completedLocal ? null : matchVideoForShot(rawVideos, shot.name, { allowStemFallback: true });
    if (snapshot?.failed) {
      status = "failed";
      progress = Math.max(0, Math.min(100, Number(snapshot.progress ?? 0)));
      label = snapshot.failedReason || "生成失败";
      source = "snapshot";
    } else if (snapshot?.complete) {
      status = "complete";
      progress = 100;
      label = completedLocal ? "已完成" : "已完成，等待下载";
      source = "snapshot";
    } else if (snapshot?.statusCode === 2 && snapshot.videoUrl) {
      status = "running";
      progress = 99;
      label = snapshot.message || (isProductionBoardMode(configData, shot) ? "视频已生成，正在下载" : "视频已生成，正在下载并抽取尾帧");
      source = "snapshot";
      scheduleProjectVideoFinalization(
        episodeRoot,
        shot.name,
        {
          taskId: snapshot.taskId || "",
          taskProvider: snapshot.provider || "",
          videoUrl: snapshot.videoUrl || "",
          tailFrameUrl: snapshot.tailFrameUrl || "",
        },
        runNamespace,
      );
    } else if (snapshot?.statusCode === 1) {
      status = "running";
      progress =
        snapshot.progress !== null && snapshot.progress !== undefined && snapshot.progress !== "" && Number.isFinite(Number(snapshot.progress))
          ? Math.max(1, Math.min(99, Number(snapshot.progress)))
          : null;
      label = progress === null ? "生成中，等待接口进度" : `生成中 ${progress}%`;
      source = "snapshot";
      scheduleProjectVideoStatusRefresh(episodeRoot, shot.name, snapshot, runNamespace);
    } else if (snapshot?.statusCode === 0) {
      status = "queued";
      progress = 0;
      label = snapshot.message || "排队中";
      source = "snapshot";
    }
    return {
      index: index + 1,
      name: shot.name,
      duration: Number(shot.duration || 0),
      refs: shot.refs || [],
      storyboardRefs: Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [],
      status,
      progress,
      label,
      file: completedLocal,
      staleFile: completedLocal ? null : staleLocal,
      source,
      jobId: "",
      lastJobId: "",
      lastJobStatus: "",
      taskId: snapshot?.taskId || "",
      statusCode: snapshot?.statusCode ?? null,
      tailFrameReady: snapshot?.tailFrameReady === true,
      tailFrameUrl: snapshot?.tailFrameUrl || "",
      tailFrameLocalFile: snapshot?.tailFrameLocalFile || "",
      failedReason: status === "failed" ? snapshot?.failedReason || "" : "",
    };
  });
  return {
    total: shots.length,
    completed: items.filter((item) => item.status === "complete").length,
    running: items.some((item) => item.status === "running"),
    queued: items.some((item) => item.status === "queued"),
    jobStatus: "",
    items,
  };
}

function relationshipAssetType(type, name = "") {
  const value = String(type || "").toLowerCase();
  const assetName = String(name || "");
  if (value.includes("character") || value === "character" || /^C\d+/i.test(assetName)) return "character";
  if (value.includes("scene") || value === "scene" || /^S\d+/i.test(assetName)) return "scene";
  if (value.includes("storyboard") || value === "storyboard" || /^SB\d+/i.test(assetName)) return "storyboard";
  if (value.includes("insert") || value === "insert" || /^I\d+/i.test(assetName)) return "insert";
  if (value.includes("prop") || value === "prop" || /^P\d+/i.test(assetName)) return "prop";
  return "prop";
}

function relationshipStatusLabel(status) {
  const labels = {
    ready: "已就绪",
    confirmed: "已确认",
    pending: "待确认",
    generated: "已生成",
    skipped: "不生成",
    missing: "缺失",
    complete: "已完成",
    running: "生成中",
    failed: "失败",
    canceled: "已取消",
    waiting: "等待",
  };
  return labels[status] || status || "未知";
}

function buildRelationshipCanvas({ episodeRoot, files, assetManifest, assets, productionAssets = null, videos, progress, config, activeAssetTargets = new Set() }) {
  const configData = config?.data || {};
  const storyboardsVisible = configData.settings?.enableStoryboards === true;
  const manifestItems = Array.isArray(assetManifest?.items) ? assetManifest.items : [];
  const configAssets = Array.isArray(configData.assets) ? configData.assets : [];
  const storyboardReferences = storyboardsVisible && Array.isArray(configData.storyboardReferences) ? configData.storyboardReferences : [];
  const shots = Array.isArray(configData.shots) ? configData.shots : [];
  const progressByName = new Map((progress?.items || []).map((item) => [item.name, item]));
  const visibleLocalAssets = storyboardsVisible
    ? [
        ...(productionAssets || (assets || []).filter((asset) => asset.manifestType !== "Storyboard")),
        ...(assets || []).filter((asset) => asset.manifestType === "Storyboard"),
      ]
    : productionAssets || (assets || []).filter((asset) => asset.manifestType !== "Storyboard");
  const actualByName = new Map(visibleLocalAssets.map((asset) => [asset.assetName, asset]));
  const configAssetByName = new Map(configAssets.map((asset) => [asset.name, asset]));
  const storyboardByName = new Map(storyboardReferences.map((asset) => [asset.name, asset]));
  const manifestByName = new Map(manifestItems.map((item) => [item.id, item]));
  const assetNames = [];
  const pushAssetName = (name) => {
    const clean = compactLine(name);
    if (clean && !assetNames.includes(clean)) assetNames.push(clean);
  };
  manifestItems.forEach((item) => pushAssetName(item.id));
  configAssets.forEach((asset) => pushAssetName(asset.name));
  storyboardReferences.forEach((asset) => pushAssetName(asset.name));
  visibleLocalAssets.forEach((asset) => pushAssetName(asset.assetName));

  const assetTypeForName = (name) => {
    const manifestItem = manifestByName.get(name);
    const configAsset = configAssetByName.get(name);
    const storyboardAsset = storyboardByName.get(name);
    const actual = actualByName.get(name);
    return relationshipAssetType(manifestItem?.type || storyboardAsset?.type || actual?.type || configAsset?.use || "", name);
  };
  const matchCodeForName = (name, typeHint = "", index = 0) => {
    const manifestItem = manifestByName.get(name);
    const configAsset = configAssetByName.get(name);
    const storyboardAsset = storyboardByName.get(name);
    return manifestItem?.matchCode || configAsset?.matchCode || storyboardAsset?.matchCode || assetMatchCode(typeHint || assetTypeForName(name), name, index);
  };
  const sourceLabelForName = (name) => {
    const sources = [];
    if (manifestByName.has(name)) sources.push("资产解析");
    if (configAssetByName.has(name)) sources.push("视频配置");
    if (storyboardsVisible && storyboardByName.has(name)) sources.push("故事版配置");
    if (actualByName.has(name)) sources.push(actualByName.get(name)?.reused ? "项目复用资产" : "本地文件");
    return sources.join(" / ") || "仅被片段引用";
  };

  const refCounts = new Map();
  const refShots = new Map();
  const missingRefs = new Set();
  for (const shot of shots) {
    for (const ref of [...(Array.isArray(shot.refs) ? shot.refs : []), ...(Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [])]) {
      const name = compactLine(ref);
      if (!name) continue;
      refCounts.set(name, (refCounts.get(name) || 0) + 1);
      if (!refShots.has(name)) refShots.set(name, []);
      refShots.get(name).push(shot.name);
      if (!assetNames.includes(name)) {
        pushAssetName(name);
        missingRefs.add(name);
      } else if (!actualByName.has(name) && !manifestByName.has(name) && !configAssetByName.has(name)) {
        missingRefs.add(name);
      }
    }
  }

  const nodesByType = {
    character: [],
    scene: [],
    storyboard: [],
    prop: [],
    insert: [],
  };
  for (const name of assetNames) {
    const manifestItem = manifestByName.get(name);
    const configAsset = configAssetByName.get(name);
    const storyboardAsset = storyboardByName.get(name);
    const actual = actualByName.get(name);
    const type = assetTypeForName(name);
    const matchCode = matchCodeForName(name, type, assetNames.indexOf(name) + 1);
    const generated = !!actual;
    const running = activeAssetTargets.has(name);
    const skipped = manifestItem?.generate === false && !generated;
    const missing = !skipped && (missingRefs.has(name) || !generated);
    const references = refCounts.get(name) || 0;
    const nodeStatus = running ? "running" : generated ? "generated" : skipped ? "skipped" : "missing";
    const metaParts = [matchCode, relationshipStatusLabel(nodeStatus)];
    if (references) metaParts.push(`${references} 次引用`);
    else metaParts.push("未被片段引用");
    nodesByType[type].push({
      id: `asset:${name}`,
      kind: "asset",
      name,
      label: manifestItem?.label || name,
      matchCode,
      title: name,
      meta: metaParts.join(" · "),
      type,
      status: nodeStatus,
      statusLabel: relationshipStatusLabel(nodeStatus),
      thumbnail: actual?.url || "",
      file: actual?.rel || configAsset?.file || storyboardAsset?.file || "",
      source: sourceLabelForName(name),
      usedBy: refShots.get(name) || [],
      references,
      issue: running ? "" : skipped ? "已设为不生成" : missing && !generated ? "缺少实际资产图" : !references ? "当前视频配置未引用" : "",
    });
  }
  Object.values(nodesByType).forEach((list) => {
    list.sort((a, b) => {
      const aReferenced = Number((a.references || 0) > 0);
      const bReferenced = Number((b.references || 0) > 0);
      if (aReferenced !== bReferenced) return bReferenced - aReferenced;
      const aMissing = Number(a.status === "missing");
      const bMissing = Number(b.status === "missing");
      if (aMissing !== bMissing) return bMissing - aMissing;
      return a.name.localeCompare(b.name);
    });
  });

  const sourceNodes = [
    {
      id: "script",
      kind: "source",
      label: "剧本",
      title: path.basename(files.script || "script"),
      status: fs.existsSync(files.script || "") ? "ready" : "missing",
      statusLabel: relationshipStatusLabel(fs.existsSync(files.script || "") ? "ready" : "missing"),
      meta: "故事输入",
    },
    ...(storyboardsVisible
      ? [
          {
            id: "storyboard",
            kind: "source",
            label: "分镜",
            title: path.basename(files.storyboard || "storyboard"),
            status: fs.existsSync(files.storyboard || "") ? "ready" : "missing",
            statusLabel: relationshipStatusLabel(fs.existsSync(files.storyboard || "") ? "ready" : "missing"),
            meta: "镜头拆分",
          },
          {
            id: "storyboard-grid",
            kind: "source",
            label: "制作板",
            title: `${nodesByType.storyboard.filter((item) => item.status === "generated").length} 个故事版`,
            status: nodesByType.storyboard.some((item) => item.status === "generated") ? "ready" : "missing",
            statusLabel: relationshipStatusLabel(nodesByType.storyboard.some((item) => item.status === "generated") ? "ready" : "missing"),
            meta: "9:16 镜头格与资产绑定",
          },
        ]
      : []),
    {
      id: "manifest",
      kind: "source",
      label: "资产解析",
      title: assetManifest?.title || path.basename(files.assetManifest || "asset_manifest"),
      status: assetManifest?.confirmed ? "confirmed" : manifestItems.length ? "pending" : "missing",
      statusLabel: relationshipStatusLabel(assetManifest?.confirmed ? "confirmed" : manifestItems.length ? "pending" : "missing"),
      meta: `${manifestItems.length} 个资产`,
    },
  ];

  const shotNodes = shots.map((shot, index) => {
    const item = progressByName.get(shot.name) || {};
    const refs = (Array.isArray(shot.refs) ? shot.refs : []).map((ref) => ({
      name: ref,
      missing: !actualByName.has(ref) && manifestByName.get(ref)?.generate !== false,
      skipped: !actualByName.has(ref) && manifestByName.get(ref)?.generate === false,
      type: assetTypeForName(ref),
      matchCode: matchCodeForName(ref, assetTypeForName(ref)),
      id: `asset:${ref}`,
    }));
    const storyboardRefDetails = (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : []).map((ref) => ({
      name: ref,
      missing: !actualByName.has(ref),
      type: "storyboard",
      matchCode: matchCodeForName(ref, "Storyboard"),
      id: `asset:${ref}`,
    }));
    const sceneRefs = refs.filter((ref) => ref.type === "scene").map((ref) => ref.name);
    return {
      id: `shot:${shot.name}`,
      kind: "shot",
      index: index + 1,
      name: shot.name,
      label: shot.name,
      title: shot.promptSection || shot.name,
      duration: Number(shot.duration || 0),
      refs,
      sceneRefs,
      status: item.status || "waiting",
      statusLabel: item.label || relationshipStatusLabel(item.status || "waiting"),
      progress: item.progress || 0,
      hasClip: !!item.file,
      clipUrl: item.file?.url || "",
      storyboardRefs: Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [],
      storyboardRefDetails,
      storyboardControl: Array.isArray(shot.storyboardRefs) && shot.storyboardRefs.length ? "启用 Production Board 控制层" : "",
      issue: refs.some((ref) => ref.missing || ref.skipped) ? "存在缺失或不生成的参考图" : !refs.length ? "缺少参考图" : "",
    };
  });

  const tailFrames = scanTailFrames(episodeRoot);
  const continuity = shotNodes.slice(1).map((shot, index) => {
    const previous = shotNodes[index];
    const rawShot = shots[index + 1] || {};
    const rawPrevious = shots[index] || {};
    const sharedScene =
      shot.sceneRefs.find((ref) => previous.sceneRefs.includes(ref)) ||
      (shotsShareSceneContinuity(rawShot, rawPrevious, configAssetByName) ? rawShot.sceneRef || shot.sceneRefs[0] || "" : "");
    return {
      from: previous.name,
      to: shot.name,
      sharedScene,
      useTailFrame: rawShot.useTailFrame === true,
      useStoryboard: Array.isArray(rawShot.storyboardRefs) && rawShot.storyboardRefs.length > 0,
      storyboardRefs: Array.isArray(rawShot.storyboardRefs) ? rawShot.storyboardRefs : [],
      tailFrameSource: rawShot.tailFrameSource || "",
      tailFrameReady: tailFrames.some((frame) => frame.name.includes(shotStemFromName(previous.name))),
    };
  });

  const outputNodes = [
    {
      id: "clips",
      kind: "output",
      label: "生成片段",
      title: `${videos.raw?.length || 0} 个片段`,
      status: videos.raw?.length ? "ready" : "waiting",
      statusLabel: videos.raw?.length ? "已生成" : "未生成",
      meta: `${progress?.completed || 0}/${progress?.total || shotNodes.length || 0} 完成`,
    },
  ];

  const issues = [];
  if (!manifestItems.length) issues.push("还没有资产解析");
  else if (!assetManifest.confirmed) issues.push("资产解析尚未确认");
  const missingAssetCount = assetNames.filter((name) => manifestByName.get(name)?.generate !== false && !actualByName.has(name)).length;
  if (missingAssetCount) issues.push(`${missingAssetCount} 个资产图缺失`);
  const shotsWithoutRefs = shotNodes.filter((shot) => !shot.refs.length).length;
  if (shotsWithoutRefs) issues.push(`${shotsWithoutRefs} 个视频片段缺少参考图`);
  const shotsWithMissingRefs = shotNodes.filter((shot) => shot.refs.some((ref) => ref.missing)).length;
  if (shotsWithMissingRefs) issues.push(`${shotsWithMissingRefs} 个视频片段引用了缺失资产`);

  const edges = [];
  const knownNodeIds = new Set([
    ...sourceNodes.map((node) => node.id),
    ...Object.values(nodesByType).flat().map((node) => node.id),
    ...shotNodes.map((node) => node.id),
    ...outputNodes.map((node) => node.id),
  ]);
  const addEdge = ({ from, to, type = "flow", status = "ok", label = "", title = "" }) => {
    if (!from || !to || !knownNodeIds.has(from) || !knownNodeIds.has(to)) return;
    edges.push({
      id: `${from}->${to}->${type}->${edges.length}`,
      from,
      to,
      type,
      status,
      label,
      title,
    });
  };
  const edgeStatusForShot = (shot, warn = false) => {
    if (warn) return "warn";
    if (shot.status === "running") return "active";
    if (["failed", "canceled", "missing"].includes(shot.status)) return "warn";
    return "ok";
  };
  addEdge({ from: "script", to: "manifest", type: "flow", status: sourceNodes.find((node) => node.id === "manifest")?.status === "missing" ? "warn" : "ok" });
  if (storyboardsVisible) {
    addEdge({ from: "script", to: "storyboard", type: "flow", status: sourceNodes.find((node) => node.id === "storyboard")?.status === "missing" ? "warn" : "ok" });
    addEdge({ from: "storyboard", to: "storyboard-grid", type: "flow", status: sourceNodes.find((node) => node.id === "storyboard-grid")?.status === "missing" ? "warn" : "ok" });
  }
  for (const assetNode of Object.values(nodesByType).flat()) {
    if (storyboardsVisible && assetNode.type === "storyboard") {
      addEdge({
        from: "storyboard-grid",
        to: assetNode.id,
        type: "storyboard",
        status: assetNode.status === "missing" ? "warn" : "ok",
        label: assetNode.matchCode,
        title: assetNode.title,
      });
      continue;
    }
    if (assetNode.type === "storyboard") continue;
    addEdge({
      from: "manifest",
      to: assetNode.id,
      type: assetNode.type,
      status: assetNode.status === "missing" ? "warn" : "ok",
      label: assetNode.matchCode,
      title: assetNode.title,
    });
  }
  for (const shot of shotNodes) {
    if (storyboardsVisible) {
      for (const ref of shot.storyboardRefDetails || []) {
        addEdge({
          from: ref.id,
          to: shot.id,
          type: "storyboard",
          status: edgeStatusForShot(shot, ref.missing),
          label: ref.matchCode,
          title: `${ref.name} -> ${shot.name}`,
        });
      }
    }
    for (const ref of shot.refs || []) {
      addEdge({
        from: ref.id,
        to: shot.id,
        type: ref.type,
        status: edgeStatusForShot(shot, ref.missing || ref.skipped),
        label: ref.matchCode,
        title: `${ref.name} -> ${shot.name}`,
      });
    }
    addEdge({
      from: shot.id,
      to: "clips",
      type: "output",
      status: edgeStatusForShot(shot, !shot.hasClip && shot.status === "complete"),
      title: shot.hasClip ? "已生成本地片段" : shot.statusLabel,
    });
  }
  for (let index = 0; index < shotNodes.length - 1; index += 1) {
    const current = shotNodes[index];
    const next = shotNodes[index + 1];
    const continuityItem = continuity[index] || {};
    addEdge({
      from: current.id,
      to: next.id,
      type: "sequence",
      status: current.status === "running" || next.status === "running" ? "active" : continuityItem.sharedScene && !continuityItem.useStoryboard && !continuityItem.useTailFrame ? "warn" : "ok",
      label: storyboardsVisible && continuityItem.useStoryboard ? "故事版" : continuityItem.useTailFrame ? "尾帧" : "",
      title: continuityItem.sharedScene ? `同场景：${continuityItem.sharedScene}` : "片段顺序",
    });
  }

  const lanes = [
    { key: "source", title: "剧本与解析", nodes: sourceNodes },
    ...(storyboardsVisible ? [{ key: "storyboards", title: "Production Board", nodes: nodesByType.storyboard }] : []),
    { key: "characters", title: "人物", nodes: nodesByType.character },
    { key: "scenes", title: "场景", nodes: nodesByType.scene },
    { key: "props", title: "道具与插入", nodes: [...nodesByType.prop, ...nodesByType.insert] },
    { key: "shots", title: "视频片段", nodes: shotNodes },
    { key: "outputs", title: "输出", nodes: outputNodes },
  ];

  return {
    title: `${projectSummary(episodeRoot).episodeCode} 制作关系`,
    summary: {
      assets: assetNames.length,
      generatedAssets: assetNames.filter((name) => actualByName.has(name)).length,
      shots: shotNodes.length,
      completedShots: progress?.completed || 0,
      issues: issues.length,
    },
    lanes,
    continuity,
    edges,
    issues,
  };
}

function projectSummary(episodeRoot) {
  const slug = episodeSlug(episodeRoot);
  const workflow = readWorkflowState(episodeRoot);
  const scopeRecord = projectScopeRecord(episodeRoot);
  const scriptPath = findProjectFile(episodeRoot, "script");
  const episodeLabel = episodeCode(slug);
  const manifest = readAssetManifest(episodeRoot)?.data;
  const scriptTitle = readText(scriptPath).split(/\r?\n/).find((line) => line.trim().replace(/^#\s*/, "")) || "";
  const cleanScriptTitle = cleanProjectDisplayTitle(scriptTitle);
  const seriesTitle = projectDisplayNameForSummary(episodeRoot, { scriptTitle: cleanScriptTitle, manifest });
  const parsedAssets = Array.isArray(manifest?.items) ? manifest.items.length : 0;
  const configRecord = ensureVideoConfigIsolation(episodeRoot);
  const runNamespace = currentRunNamespace(episodeRoot, configRecord?.data);
  const runStart = currentRunStartMs(episodeRoot, configRecord?.data);
  const plannedAssetNames = parseAssetsFromPromptNames(readText(findProjectFile(episodeRoot, "assetPrompts")));
  const assets = projectProductionAssetsForState(episodeRoot, manifest, {
    plannedAssetNames,
    configData: configRecord?.data,
    minModifiedAt: runStart,
  });
  const videos = scanVideos(episodeRoot, { minModifiedAt: runStart });
  const rawClips = configuredRawVideos(episodeRoot, videos, configRecord?.data).length;
  const summary = readSummary(episodeRoot, { runNamespace });
  return {
    id: encodeId(episodeRoot),
    title: seriesTitle,
    seriesTitle,
    episodeLabel,
    displayTitle: `${seriesTitle} / ${episodeLabel}`,
    scriptTitle: cleanScriptTitle || scriptTitle.trim().replace(/^#\s*/, ""),
    episodeSlug: slug,
    episodeCode: episodeLabel,
    episodeRoot,
    projectDir: projectDirForEpisode(episodeRoot),
    scope: scopeRecord.scope,
    teamId: scopeRecord.teamId,
    progress: {
      stage: compactLine(workflow.currentStage || workflow.stage || "script"),
      lastModifiedByUserId: compactLine(workflow.lastModifiedByUserId || workflow.ownerUserId || ""),
      lastModifiedByUsername: compactLine(workflow.lastModifiedByUsername || workflow.ownerUsername || ""),
      lastModifiedAt: workflow.lastModifiedAt || fs.statSync(episodeRoot).mtime.toISOString(),
    },
    counts: {
      assets: assets.length,
      parsedAssets,
      rawClips,
    },
    runNamespace,
    isolated: !!runNamespace,
    model: summary?.data?.modelName || summary?.data?.model || "",
    updatedAt: fs.statSync(episodeRoot).mtime.toISOString(),
  };
}

function lightweightProjectSummary(episodeRoot) {
  const slug = episodeSlug(episodeRoot);
  const episodeLabel = episodeCode(slug);
  const manifest = readAssetManifest(episodeRoot)?.data;
  const workflow = readWorkflowState(episodeRoot);
  const scopeRecord = projectScopeRecord(episodeRoot);
  const runNamespace = normalizeRunNamespace(workflow.currentNamespace || "");
  const scriptPath = findProjectFile(episodeRoot, "script");
  const scriptText = readText(scriptPath);
  const scriptTitle = scriptText.split(/\r?\n/).find((line) => line.trim().replace(/^#\s*/, "")) || "";
  const cleanScriptTitle = cleanProjectDisplayTitle(scriptTitle);
  const seriesTitle = projectDisplayNameForSummary(episodeRoot, { scriptTitle: cleanScriptTitle, manifest });
  const manifestItems = normalizeAssetManifest(manifest || {}).items || [];
  const parsedAssets = manifestItems.length;
  const configData = readVideoConfig(episodeRoot, { allowEmptyShots: true })?.data || {};
  const scannedAssets = scanAssets(episodeRoot);
  const storyboardCount = scannedAssets.filter((asset) => asset.manifestType === "Storyboard").length;
  const rawVideoFiles = walkFiles(path.join(episodeRoot, "06_videos", "raw"), (file) => /\.(mp4|mov)$/i.test(file), 1).sort();
  const rawClipCount = rawVideoFiles.length;
  const finalCutFile = finalCutOutputFile(episodeRoot);
  const previewAsset = scannedAssets.find((asset) => asset.path && fs.existsSync(asset.path)) || null;
  const previewAssetMedia = previewAsset ? mediaItem(previewAsset.path, episodeRoot) : null;
  const videoPreviewFile = fs.existsSync(finalCutFile) && fs.statSync(finalCutFile).isFile()
    ? finalCutFile
    : rawVideoFiles[0] || "";
  const previewFile = videoPreviewFile || previewAsset?.path || "";
  const previewMedia = previewFile ? mediaItem(previewFile, episodeRoot) : null;
  const progressFacts = buildTeamProjectProgressFacts({
    episodeRoot,
    scriptText,
    manifestItems,
    scannedAssets,
    configData,
    generatedStoryboards: storyboardCount,
    generatedClips: rawClipCount,
  });
  const teamProgress = calculateTeamProjectProgress(progressFacts);
  return {
    id: encodeId(episodeRoot),
    title: seriesTitle,
    seriesTitle,
    episodeLabel,
    displayTitle: `${seriesTitle} / ${episodeLabel}`,
    scriptTitle: cleanScriptTitle || scriptTitle.trim().replace(/^#\s*/, ""),
    episodeSlug: slug,
    episodeCode: episodeLabel,
    episodeRoot,
    projectDir: projectDirForEpisode(episodeRoot),
    scope: scopeRecord.scope,
    teamId: scopeRecord.teamId,
    progress: {
      stage: teamProgress.stage,
      attention: teamProgress.attention,
      lastModifiedByUserId: compactLine(workflow.lastModifiedByUserId || workflow.ownerUserId || ""),
      lastModifiedByUsername: compactLine(workflow.lastModifiedByUsername || workflow.ownerUsername || ""),
      lastModifiedAt: workflow.lastModifiedAt || fs.statSync(episodeRoot).mtime.toISOString(),
    },
    counts: {
      assets: progressFacts.generatedAssets,
      parsedAssets,
      rawClips: rawClipCount,
      scriptReady: progressFacts.scriptReady,
      plannedAssets: progressFacts.plannedAssets,
      plannedStoryboards: progressFacts.plannedStoryboards,
      storyboards: storyboardCount,
      plannedShots: progressFacts.plannedShots,
    },
    preview: previewMedia
      ? {
          type: /\.(mp4|mov|webm|m4v)$/i.test(previewMedia.name) ? "video" : "image",
          url: /\.(mp4|mov|webm|m4v)$/i.test(previewMedia.name) ? previewMedia.url : coverThumbUrl(previewMedia.url, 480),
          posterUrl: previewAssetMedia ? coverThumbUrl(previewAssetMedia.url, 480) : "",
          name: previewMedia.name,
          size: previewMedia.size,
          updatedAt: previewMedia.updatedAt,
        }
      : null,
    runNamespace,
    isolated: !!runNamespace,
    model: "",
    updatedAt: fs.statSync(episodeRoot).mtime.toISOString(),
    lightweight: true,
  };
}

function scanEpisodeRoots() {
  const roots = new Set();
  const addIfEpisode = (dir) => {
    const full = path.resolve(dir);
    if (isEpisodeOutputRoot(full)) roots.add(full);
  };
  for (const parent of [path.join(APP_ROOT, "outputs"), path.join(APP_ROOT, "projects"), SHORT_DRAMA_ROOT]) {
    if (!fs.existsSync(parent)) continue;
    if (path.basename(parent) === "outputs") {
      for (const entry of listDir(parent)) {
        const full = path.join(parent, entry.name);
        if (entry.isDirectory()) addIfEpisode(full);
      }
      continue;
    }
    for (const project of listDir(parent)) {
      const outputs = path.join(parent, project.name, "outputs");
      if (!project.isDirectory() || !fs.existsSync(outputs)) continue;
      for (const episode of listDir(outputs)) {
        const full = path.join(outputs, episode.name);
        if (episode.isDirectory()) addIfEpisode(full);
      }
    }
  }
  const codexRoot = CODEX_DOCUMENTS_ROOT;
  if (fs.existsSync(codexRoot)) {
    const scanOutputsDirs = (dir, depth = 4) => {
      if (depth < 0 || !fs.existsSync(dir)) return;
      for (const entry of listDir(dir)) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.name === "outputs") {
          for (const episode of listDir(full)) {
            if (episode.isDirectory()) addIfEpisode(path.join(full, episode.name));
          }
          continue;
        }
        scanOutputsDirs(full, depth - 1);
      }
    };
    scanOutputsDirs(codexRoot, 5);
  }
  return [...roots].filter((root) => fs.existsSync(root)).sort();
}

function episodeRootForFile(filePath) {
  const file = path.resolve(filePath || "");
  return scanEpisodeRoots().find((episodeRoot) => isInside(episodeRoot, file) || isInside(workDirForEpisode(episodeRoot), file)) || "";
}

// ===== 成片组装器（阶段 D）：各 shot 本地 mp4 → 归一化 1080x1920/24fps/h264+aac → 硬切拼成 rough_cut.mp4 =====
const FINAL_CUT_DIR = "11_final_cut";
const FINAL_CUT_TARGET = { w: 1080, h: 1920, fps: 24 };
const finalCutJobs = new Map();
function finalCutJobKey(episodeRoot) {
  return path.resolve(episodeRoot);
}
function finalCutOutputFile(episodeRoot) {
  return path.join(episodeRoot, FINAL_CUT_DIR, "rough_cut.mp4");
}
function ffprobeClipHasAudio(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 20000 });
    return /audio/.test(out);
  } catch {
    return false;
  }
}
function ffprobeReadable(file) {
  try {
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { stdio: ["ignore", "ignore", "ignore"], timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}
function runFfmpegAssembly(args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      reject(new Error("ffmpeg 超时"));
    }, timeoutMs);
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(compactLine(err).slice(-400) || `ffmpeg exit ${code}`));
    });
  });
}
function collectFinalCutClips(episodeRoot, config) {
  const shots = Array.isArray(config?.shots) ? config.shots : [];
  const runNamespace = currentRunNamespace(episodeRoot, config);
  const clips = [];
  const missing = [];
  for (const shot of shots) {
    const name = compactLine(shot?.name || "");
    if (!name) continue;
    const snap = snapshotStatusForShot(episodeRoot, name, { runNamespace });
    const media = snap ? localVideoFromSnapshot(episodeRoot, snap) : null;
    if (media?.path && fs.existsSync(media.path)) clips.push({ name, file: media.path });
    else missing.push(name);
  }
  return { clips, missing, total: shots.length };
}
function finalCutStatus(episodeRoot) {
  const job = finalCutJobs.get(finalCutJobKey(episodeRoot)) || null;
  const out = finalCutOutputFile(episodeRoot);
  const exists = fs.existsSync(out) && fs.statSync(out).isFile();
  let output = null;
  if (exists) {
    const stat = fs.statSync(out);
    output = {
      url: `/media?path=${encodeURIComponent(out)}&v=${Math.round(stat.mtimeMs)}`,
      downloadUrl: `/media?path=${encodeURIComponent(out)}&v=${Math.round(stat.mtimeMs)}&download=1`,
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
    };
  }
  return {
    running: !!job?.running,
    status: job?.running ? "running" : job?.status || (exists ? "ready" : "idle"),
    progress: job?.progress || (exists && !job?.running ? 100 : 0),
    message: job?.message || "",
    error: job?.error || "",
    total: job?.total || 0,
    done: job?.done || 0,
    output,
  };
}
async function runFinalCutAssembly(episodeRoot, job) {
  const tmpDir = path.join(episodeRoot, FINAL_CUT_DIR, ".tmp");
  try {
    const config = readVideoConfig(episodeRoot)?.data || {};
    const { clips, missing } = collectFinalCutClips(episodeRoot, config);
    if (!clips.length) throw new Error("没有可组装的已完成片段");
    if (missing.length) throw new Error(`以下片段尚未完成，无法组装：${missing.join("、")}`);
    job.total = clips.length;
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const normFilter = `scale=${FINAL_CUT_TARGET.w}:${FINAL_CUT_TARGET.h}:force_original_aspect_ratio=decrease,pad=${FINAL_CUT_TARGET.w}:${FINAL_CUT_TARGET.h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${FINAL_CUT_TARGET.fps},format=yuv420p,setsar=1`;
    const normFiles = [];
    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      job.done = i;
      job.progress = Math.round((i / (clips.length + 1)) * 100);
      job.message = `归一化 ${i + 1}/${clips.length}：${clip.name}`;
      if (!ffprobeReadable(clip.file)) throw new Error(`片段无法读取：${clip.name}`);
      const target = path.join(tmpDir, `norm_${String(i).padStart(3, "0")}.mp4`);
      const hasAudio = ffprobeClipHasAudio(clip.file);
      const args = hasAudio
        ? ["-y", "-i", clip.file, "-vf", normFilter, "-r", String(FINAL_CUT_TARGET.fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target]
        : ["-y", "-i", clip.file, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-vf", normFilter, "-r", String(FINAL_CUT_TARGET.fps), "-map", "0:v:0", "-map", "1:a:0", "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target];
      await runFfmpegAssembly(args);
      normFiles.push(target);
    }
    job.message = "拼接成片…";
    job.progress = Math.round((clips.length / (clips.length + 1)) * 100);
    const listFile = path.join(tmpDir, "concat_list.txt");
    fs.writeFileSync(listFile, `${normFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")}\n`);
    const out = finalCutOutputFile(episodeRoot);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (fs.existsSync(out)) {
      const archive = path.join(episodeRoot, FINAL_CUT_DIR, "archive");
      fs.mkdirSync(archive, { recursive: true });
      try {
        fs.renameSync(out, path.join(archive, `rough_cut_${Date.now()}.mp4`));
      } catch {}
    }
    await runFfmpegAssembly(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out]);
    if (!fs.existsSync(out) || fs.statSync(out).size < 1024) throw new Error("成片输出为空，拼接失败");
    job.done = clips.length;
    job.progress = 100;
    job.status = "ready";
    job.message = `成片已生成（${clips.length} 段）`;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    job.running = false;
    job.finishedAt = new Date().toISOString();
  }
}
function startFinalCutAssembly(episodeRoot) {
  const key = finalCutJobKey(episodeRoot);
  const existing = finalCutJobs.get(key);
  if (existing?.running) return { running: true, message: "成片组装进行中，请稍候" };
  const config = readVideoConfig(episodeRoot)?.data || {};
  const { clips, missing } = collectFinalCutClips(episodeRoot, config);
  if (!clips.length) throw new Error("没有可组装的已完成片段，请先生成视频片段");
  if (missing.length) throw new Error(`以下片段尚未完成，无法组装：${missing.join("、")}`);
  const job = { running: true, status: "running", progress: 0, done: 0, total: clips.length, message: "准备组装…", error: "", startedAt: new Date().toISOString() };
  finalCutJobs.set(key, job);
  runFinalCutAssembly(episodeRoot, job).catch((error) => {
    job.running = false;
    job.status = "failed";
    job.error = compactLine(error?.message || "成片组装失败");
    job.message = job.error;
  });
  return { running: true, total: clips.length, message: "已开始组装成片" };
}

// 自动成片:全部片段就绪后自动触发组装,无需手动点击。用"片段集签名"(名字+mtime)守卫,
// 同一套片段只自动拼一次;某片段重生成(签名变化)才自动重拼;已在组装或成片已比片段新则跳过。
const autoFinalCutSignatures = new Map();
function finalCutClipMtime(file) {
  try {
    return Math.round(fs.statSync(file).mtimeMs);
  } catch {
    return 0;
  }
}
function maybeAutoAssembleFinalCut(episodeRoot) {
  try {
    const config = readVideoConfig(episodeRoot)?.data || {};
    const { clips, missing, total } = collectFinalCutClips(episodeRoot, config);
    if (!total || missing.length || clips.length !== total) return; // 尚未全部完成
    const key = finalCutJobKey(episodeRoot);
    if (finalCutJobs.get(key)?.running) return; // 正在组装
    const signature = clips
      .map((clip) => `${clip.name}:${finalCutClipMtime(clip.file)}`)
      .sort()
      .join("|");
    if (autoFinalCutSignatures.get(key) === signature) return; // 这套片段已自动拼过
    autoFinalCutSignatures.set(key, signature);
    const out = finalCutOutputFile(episodeRoot);
    const outMtime = fs.existsSync(out) ? finalCutClipMtime(out) : 0;
    const newestClip = clips.reduce((max, clip) => Math.max(max, finalCutClipMtime(clip.file)), 0);
    if (outMtime && outMtime >= newestClip) return; // 现有成片已比所有片段新,无需重拼
    startFinalCutAssembly(episodeRoot);
  } catch {
    // 自动组装为尽力而为,失败不影响主流程;用户仍可手动点「组装成片」
  }
}

function fullProjectState(episodeRoot) {
  if (!allowedPath(episodeRoot) || !fs.existsSync(episodeRoot)) throw new Error("project not found");
  const workflow = readWorkflowState(episodeRoot);
  const configRecord = ensureVideoConfigIsolation(episodeRoot);
  const runNamespace = currentRunNamespace(episodeRoot, configRecord?.data);
  reconcileProjectVideoStateFromCanvas(episodeRoot, configRecord?.data || {}, runNamespace);
  migrateInvalidVideoUrlsToFailed(episodeRoot, configRecord?.data || {}, runNamespace);
  migrateAssetActivationFailuresToQueued(episodeRoot, configRecord?.data || {}, runNamespace);
  clearResolvedVideoReferenceFailures(episodeRoot, configRecord?.data || {}, runNamespace);
  clearResolvedAssetActivationFailures(episodeRoot, configRecord?.data || {}, runNamespace);
  recoverProjectVideoQueueIfNeeded(episodeRoot, configRecord?.data || {});
  maybeAutoAssembleFinalCut(episodeRoot);
  const runStart = currentRunStartMs(episodeRoot, configRecord?.data);
  const files = {
    script: findProjectFile(episodeRoot, "script"),
    storyboard: findProjectFile(episodeRoot, "storyboard"),
    assetManifest: findProjectFile(episodeRoot, "assetManifest"),
    assetPrompts: findProjectFile(episodeRoot, "assetPrompts"),
    seedancePrompts: findProjectFile(episodeRoot, "seedancePrompts"),
    config: findProjectFile(episodeRoot, "config"),
  };
  const localJobs = mergeJobs(episodeRoot, { runNamespace });
  const activeAssetTargets = activeAssetTargetsFromJobs(localJobs);
  const videos = scanVideos(episodeRoot, { minModifiedAt: runStart });
  const progress = videoProgress(episodeRoot, localJobs, videos);
  const videoQueue = projectVideoQueues.get(projectVideoQueueKey(episodeRoot)) || null;
  if (videoQueue && (videoQueue.running || videoQueue.status === "preparing" || videoQueue.status === "failed" || videoQueue.status === "blocked")) {
    if (videoQueue.running) progress.running = true;
    progress.queue = {
      id: videoQueue.id,
      running: !!videoQueue.running,
      status: videoQueue.status || (videoQueue.running ? "running" : ""),
      message: videoQueue.message || "",
      error: videoQueue.error || "",
      stuck: Array.isArray(videoQueue.stuck) ? videoQueue.stuck : [],
      total: videoQueue.total || 0,
      completed: videoQueue.completed || 0,
      currentShotName: videoQueue.currentShotName || "",
      startedAt: videoQueue.startedAt || "",
      updatedAt: videoQueue.updatedAt || "",
    };
  }
  progress.completed = progress.items.filter((item) => item.status === "complete").length;
  const config = ensureVideoConfigIsolation(episodeRoot, configRecord);
  if (Array.isArray(config?.data?.shots) && config.data.shots.length) {
    syncProjectShotsToCanvasState(episodeRoot, config.data, config.data.shots);
  }
  const assetManifest = readAssetManifest(episodeRoot);
  const normalizedAssetManifest = assetManifest?.data ? normalizeAssetManifest(assetManifest.data) : null;
  const plannedAssetNames = parseAssetsFromPromptNames(readText(files.assetPrompts));
  const allAssets = scanAssets(episodeRoot);
  const productionAssets = projectProductionAssetsForState(episodeRoot, normalizedAssetManifest, {
    plannedAssetNames,
    configData: config?.data,
    minModifiedAt: runStart,
  });
  const storyboardAssets = currentStoryboardAssetsForWorkflow(allAssets, {
    configData: config?.data,
    minModifiedAt: runStart,
  });
  const currentAssetsForCanvas = [...productionAssets, ...storyboardAssets];
  const visibleAssets = productionAssets;
  const assetSlots = normalizedAssetManifest ? assetSlotsForState(episodeRoot, normalizedAssetManifest, visibleAssets, { minFailedAt: runStart, minModifiedAt: runStart }) : [];
  const storyboardSlots = storyboardSlotsForState(episodeRoot, normalizedAssetManifest || null, storyboardAssets, { configData: config?.data });
  const dialogueLanguage = projectDialogueLanguage(episodeRoot, "en");
  const referenceKitState = projectReferenceKitState(workflow, config?.data || {});
  return {
    ok: true,
    runtime: runtimeStatus(),
    dialogueLanguage,
    isolation: {
      runNamespace,
      runStartedAt: runStart ? new Date(runStart).toISOString() : "",
      mode: runNamespace ? "isolated-current-workflow" : "legacy",
    },
    project: projectSummary(episodeRoot),
    teamReferences: Array.isArray(workflow.teamReferences) ? workflow.teamReferences.map(publicTeamReference) : [],
    ...referenceKitState,
    files,
    contents: {
      script: readText(files.script),
      assetDescription: readAssetDescription(episodeRoot),
      storyboard: readText(files.storyboard),
      assetManifest: readText(files.assetManifest),
      assetPrompts: readText(files.assetPrompts),
      seedancePrompts: seedancePromptsTextForState(episodeRoot, files.seedancePrompts, config?.data),
      config: readText(files.config),
    },
    assetManifest: normalizedAssetManifest,
    assets: visibleAssets,
    assetSlots,
    assetStyleReference: readAssetStyleReference(episodeRoot),
    storyboards: storyboardAssets,
    storyboardSlots,
    videos,
    videoProgress: progress,
    relationshipCanvas: buildRelationshipCanvas({
      episodeRoot,
      files,
      assetManifest: normalizedAssetManifest,
      assets: currentAssetsForCanvas,
      productionAssets,
      videos,
      progress,
      config,
      activeAssetTargets,
    }),
    videoConfigStatus: configReadiness(episodeRoot, config?.data),
    assetJob: jobSummary(latestVisibleAssetJob(localJobs)),
    storyboardJob: jobSummary(latestJobForTypes(localJobs, ["storyboards", "storyboard-regenerate"])),
    videoJob: jobSummary(latestJobForTypes(localJobs, ["video"])),
    tailFrames: scanTailFrames(episodeRoot),
    finalCut: finalCutStatus(episodeRoot),
    summary: readSummary(episodeRoot, { runNamespace }),
    jobs: localJobs.map(jobSummary),
  };
}

function projectStatusSnapshot(episodeRoot) {
  if (!allowedPath(episodeRoot) || !fs.existsSync(episodeRoot)) throw new Error("project not found");
  const workflow = readWorkflowState(episodeRoot);
  const configRecord = ensureVideoConfigIsolation(episodeRoot);
  // 状态轮询是制作台保持进度的主路径。队列本体在内存中,服务重启后只能依靠
  // 持久化的 video_task_nodes/*.json 恢复,否则前端会永远停在 queued_local。
  recoverProjectVideoQueueIfNeeded(episodeRoot, configRecord?.data || {});
  const runNamespace = currentRunNamespace(episodeRoot, configRecord?.data);
  const runStart = currentRunStartMs(episodeRoot, configRecord?.data);
  const localJobs = mergeJobs(episodeRoot, { runNamespace });
  const videos = scanVideos(episodeRoot, { minModifiedAt: runStart });
  const progress = videoProgress(episodeRoot, localJobs, videos);
  const videoQueue = projectVideoQueues.get(projectVideoQueueKey(episodeRoot)) || null;
  if (videoQueue && (videoQueue.running || videoQueue.status === "preparing" || videoQueue.status === "failed" || videoQueue.status === "blocked")) {
    if (videoQueue.running) progress.running = true;
    progress.queue = {
      id: videoQueue.id,
      running: !!videoQueue.running,
      status: videoQueue.status || (videoQueue.running ? "running" : ""),
      message: videoQueue.message || "",
      error: videoQueue.error || "",
      stuck: Array.isArray(videoQueue.stuck) ? videoQueue.stuck : [],
      total: videoQueue.total || 0,
      completed: videoQueue.completed || 0,
      currentShotName: videoQueue.currentShotName || "",
      startedAt: videoQueue.startedAt || "",
      updatedAt: videoQueue.updatedAt || "",
    };
  }
  progress.completed = progress.items.filter((item) => item.status === "complete").length;
  const config = ensureVideoConfigIsolation(episodeRoot, configRecord);
  // 轮询也带上资产清单/资产/资产槽 + 故事板/故事板槽,让生成完的资产图与 Production Board 不必手动刷新就显示。
  const assetManifestRec = readAssetManifest(episodeRoot);
  const normalizedAssetManifest = assetManifestRec?.data ? normalizeAssetManifest(assetManifestRec.data) : null;
  const plannedAssetNames = parseAssetsFromPromptNames(readText(findProjectFile(episodeRoot, "assetPrompts")));
  const productionAssets = projectProductionAssetsForState(episodeRoot, normalizedAssetManifest, {
    plannedAssetNames,
    configData: config?.data,
    minModifiedAt: runStart,
  });
  const assetSlots = normalizedAssetManifest
    ? assetSlotsForState(episodeRoot, normalizedAssetManifest, productionAssets, { minFailedAt: runStart, minModifiedAt: runStart })
    : [];
  // 故事板也带上,让 Production Board 生成完不必手动刷新就在轮询里更新(前端 renderStoryboards 有签名守卫,不会闪)。
  const storyboardAssets = currentStoryboardAssetsForWorkflow(scanAssets(episodeRoot), {
    configData: config?.data,
    minModifiedAt: runStart,
  });
  const storyboardSlots = storyboardSlotsForState(episodeRoot, normalizedAssetManifest || null, storyboardAssets, {
    configData: config?.data,
  });
  const referenceKitState = projectReferenceKitState(workflow, config?.data || {});
  return {
    ok: true,
    runtime: runtimeStatus(),
    project: lightweightProjectSummary(episodeRoot),
    teamReferences: Array.isArray(workflow.teamReferences) ? workflow.teamReferences.map(publicTeamReference) : [],
    ...referenceKitState,
    videoProgress: progress,
    videoConfigStatus: configReadiness(episodeRoot, config?.data),
    assetJob: jobSummary(latestVisibleAssetJob(localJobs)),
    storyboardJob: jobSummary(latestJobForTypes(localJobs, ["storyboards", "storyboard-regenerate"])),
    videoJob: jobSummary(latestJobForTypes(localJobs, ["video"])),
    finalCut: finalCutStatus(episodeRoot),
    jobs: localJobs.map(jobSummary),
    assetManifest: normalizedAssetManifest,
    assets: productionAssets,
    assetSlots,
    storyboards: storyboardAssets,
    storyboardSlots,
    updatedAt: fs.statSync(episodeRoot).mtime.toISOString(),
  };
}

function fullProjectStateForUser(episodeRoot, user) {
  return { ...fullProjectState(episodeRoot), teamReferences: teamReferencesForUser(episodeRoot, user) };
}

function projectStatusSnapshotForUser(episodeRoot, user) {
  return { ...projectStatusSnapshot(episodeRoot), teamReferences: teamReferencesForUser(episodeRoot, user) };
}

function parseSpeakerDialogues(script) {
  return extractDialogueBlocks(script)
    .map((block) => ({ speaker: block.speaker, text: block.text }))
    .slice(0, 12);
}

function isSceneHeadingLine(value) {
  const line = compactLine(value);
  return (
    /^\[场景\d+\]/.test(line) ||
    /^\d+(?:\s*[-－]\s*\d+)?\s+[^，。！？\n]{2,50}\s*[-－]\s*(?:外|内|外景|内景|夜|日|晨|晚)(?:\b|$)/i.test(line) ||
    /^(外景|内景)\s*[·.:-]/i.test(line) ||
    /^(EXT\.?|INT\.?|EXTERIOR|INTERIOR)\b/i.test(line)
  );
}

function isNonCharacterHeading(value) {
  const line = compactLine(value);
  if (!line) return true;
  if (isSceneHeadingLine(line)) return true;
  if (/^#/.test(line)) return true;
  if (/^第.+集/.test(line)) return true;
  if (/^【.*】$/.test(line)) return true;
  if (/^(切黑|黑场|完|剧终)$/i.test(line)) return true;
  if (/^(CUT|FADE|TITLE|MONTAGE|END|BLACK|DISSOLVE|SMASH CUT|MATCH CUT)\b/i.test(line)) return true;
  return false;
}

function isProductionFieldLabel(value) {
  return /^(画面|灯光|对白|音效|镜头|演技提示|视觉特效|动漫感特效|特效化妆|建筑场景|服饰细节|动作|声音|场景|时间|地点)$/i.test(
    normalizeProductionFieldName(value),
  );
}

function normalizeProductionFieldName(value) {
  return compactLine(value)
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[：:].*$/g, "")
    .replace(/^[◦•\-\s]+/, "")
    .trim();
}

function productionFieldLine(value) {
  const line = compactLine(value);
  const match = line.match(/^•\s*([^：:]{1,28}?)(?:[（(][^）)]{1,32}[）)])?\s*[：:]\s*(.*)$/);
  if (!match) return null;
  const name = normalizeProductionFieldName(match[1]);
  if (!isProductionFieldLabel(name)) return null;
  return { name, body: compactLine(match[2] || "") };
}

function hasProductionField(value, names) {
  const wanted = new Set(names.map(normalizeProductionFieldName));
  return String(value || "")
    .split(/(?=•\s*[^：:]{1,28}(?:[（(][^）)]{1,32}[）)])?\s*[：:])/)
    .some((part) => {
      const field = productionFieldLine(part);
      return field && wanted.has(field.name);
    });
}

// 密集单段剧本:对白内联在旁白里(名字：台词），用 △/句号分隔、不换行。逐行/项目符号/引号三个提取器都吃不下,
// 这里按「名字：台词」切:名字须过 isValidCharacterLabel(排除旁白/场景/道具误判),台词取到下一个 名字：/△/换行/段末。
function inlineColonDialogues(source, dialogueLanguage = "en", { limit = 8 } = {}) {
  const text = String(source || "");
  const language = normalizeDialogueLanguage(dialogueLanguage, "en");
  const nameToken = "(?:[一-龥·]{2,8}|[A-Z][A-Za-z .'\\-]{1,32})";
  // 说话人后可带一段括注舞台提示再接冒号,如「周桂兰（摸摸小宝的头，笑了）：」。
  // 括注在冒号前、不进入 speaker 捕获组;lookahead 同样识别,避免上一句台词把带括注的说话人吞掉。
  const paren = "(?:[（(][^）)]{0,24}[）)])?";
  const re = new RegExp(
    `(${nameToken})${paren}\\s*[：:]\\s*([^：:\\n△]{1,140}?)(?=${nameToken}${paren}\\s*[：:]|[△\\n]|$)`,
    "g",
  );
  const out = [];
  for (const match of text.matchAll(re)) {
    const before = text[(match.index || 0) - 1];
    // 说话人前须为句子边界(段首/句末标点/△),避免把台词内部出现的「…名字：」误当新说话人。
    if (before && !/[\s。！？!?、，,；;：:）)”"』」△]/.test(before)) continue;
    const speaker = cleanSpeakerCue(match[1]);
    if (!speaker || !isValidCharacterLabel(speaker)) continue;
    // 元信息/分镜设计字段(字段名：值)会伪装成对白,一律排除。两类:
    // ① 剧本头/元信息:内外人物、参考资产、推荐时长、画幅、时间地点等;
    // ② seedance 分镜设计块字段:剧情动作、光线、调色、画面、环境、声音、表演、构图、材质、节奏、运镜、景别、景深、机位、氛围、色调、镜头运动、特效等。
    if (
      /^(内|外|画外)?(人物|旁白|字幕|备注|参考资产|推荐时长|时长|时间|地点|场景|画幅|景别|机位|镜号|集数|第[一二三四五六七八九十百\d]+集)$/.test(speaker) ||
      /^(剧情动作|动作|表演|画面|环境|声音|音效|光线|调色|色调|构图|材质|质感|节奏|运镜|镜头运动|镜头|景别|景深|氛围|特效|视效|服饰|服装|道具|色彩|布光|机位|摄影|画幅)$/.test(speaker)
    )
      continue;
    const bilingual = splitBilingualDialogue(compactLine(match[2]));
    const spoken = language === "zh" ? bilingual.zh || compactLine(match[2]) : bilingual.en || compactLine(match[2]);
    if (spoken) out.push({ speaker, text: spoken });
  }
  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

function explicitInlineDialogues(source) {
  const text = String(source || "");
  const dialogues = [];
  const pattern = /◦\s*([^：:\n]{1,32})\s*[：:]\s*([\s\S]*?)(?=(?:\s*◦\s*[^：:\n]{1,32}\s*[：:])|(?:\s*•\s*[^：:]{1,28}(?:[（(][^）)]{1,32}[）)])?\s*[：:])|$)/g;
  for (const match of text.matchAll(pattern)) {
    const speaker = cleanSpeakerCue(match[1]);
    const line = compactLine(match[2]);
    if (!speaker || !line || !isValidCharacterLabel(speaker) && !/^ZERO$/i.test(speaker)) continue;
    dialogues.push({ speaker, text: line });
  }
  return dialogues;
}

function stripExplicitInlineDialogues(value) {
  return String(value || "").replace(
    /◦\s*[^：:\n]{1,32}\s*[：:]\s*[\s\S]*?(?=(?:\s*◦\s*[^：:\n]{1,32}\s*[：:])|(?:\s*•\s*[^：:]{1,28}(?:[（(][^）)]{1,32}[）)])?\s*[：:])|$)/g,
    " ",
  );
}

function isEnglishSpeakerCue(value) {
  const line = compactLine(value).replace(/（.*?）/g, "").trim();
  if (isNonCharacterHeading(line)) return false;
  if (!/^[A-Z][A-Z .'\-()]{2,32}$/.test(line)) return false;
  return !/^(Same|Good|What|No|Then|Unless|Listen|People)$/i.test(line);
}

function isParentheticalSpeakerCue(value) {
  const line = compactLine(value);
  const match = line.match(/^([A-Za-z][A-Za-z .'\-]{1,32}|[一-龥·]{2,12})\s*[（(]([^）)]{1,24})[）)]$/);
  if (!match) return false;
  if (isNonCharacterHeading(match[1])) return false;
  return /冷|笑|怒|哭|喊|低声|高声|戏谑|嘲讽|绝情|挑衅|得意|冰冷|焦急|惊恐|温柔|轻声|低哑|whisper|shout|cold|angry|soft|mock/i.test(match[2]);
}

function isChineseSpeakerCue(lines, index) {
  const raw = compactLine(lines[index]).replace(/（.*?）/g, "").trim();
  if (isNonCharacterHeading(raw)) return false;
  if (!/^[一-龥·]{2,10}$/.test(raw)) return false;
  if (/[，。！？：；、]/.test(raw)) return false;
  if (/^(切黑|黑场|电话挂断|照片|手机|文件夹|牧场|农场|学校|清晨|夜晚|白天)$/.test(raw)) return false;
  let next = "";
  for (let j = index + 1; j < lines.length; j += 1) {
    next = compactLine(lines[j]);
    if (next) break;
  }
  if (!next || isNonCharacterHeading(next) || isEnglishSpeakerCue(next)) return false;
  return /[，。！？：；、"'“”A-Za-z]/.test(next) || next.length >= 4;
}

function isSpeakerCueLine(lines, index) {
  const line = compactLine(lines[index]);
  return isEnglishSpeakerCue(line) || isParentheticalSpeakerCue(line) || isChineseSpeakerCue(lines, index);
}

function isParentheticalLine(value) {
  const line = compactLine(value);
  return /^[(（].*[)）]$/.test(line);
}

function cleanSpeakerCue(value) {
  return compactLine(value).replace(/\s*\(.*?\)\s*/g, "").replace(/（.*?）/g, "").trim();
}

function isActionLineAfterDialogue(value, speaker = "") {
  const line = compactLine(value);
  if (!line || /[：:]/.test(line) || /^["“]/.test(line)) return false;
  if (/^(?:话音落下|说完|语毕|下一秒|随后|随即|紧接着|与此同时|镜头|画面|切到)/i.test(line)) return true;
  const actionVerbs =
    "轻笑|俯身|凑近|拂过|伸手|推下|推开|拉起|走到|走向|跪|站|注视|凝视|转身|抬头|抬手|低头|后退|逼近|冲向|扑向|倒下|坠落|落下|紧随其后|踩着|押着";
  if (new RegExp(`^(?:${actionVerbs})`).test(line)) return true;
  const characterPrefix = line.match(/^([A-Za-z][A-Za-z .'\-]{1,32}|[一-龥·]{2,12})\s+/)?.[1] || "";
  if (!characterPrefix) return false;
  const cleanSpeaker = cleanSpeakerCue(speaker);
  if (cleanSpeaker && characterPrefix === cleanSpeaker && !new RegExp(actionVerbs).test(line)) return false;
  return new RegExp(`\\s(?:${actionVerbs})`).test(line);
}

function extractDialogueBlocks(script) {
  const lines = String(script || "").split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!isSpeakerCueLine(lines, i)) continue;
    const speaker = cleanSpeakerCue(lines[i]);
    const lineIndexes = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = compactLine(lines[j]);
      if (!line) break;
      if (isSceneHeadingLine(line) || isSpeakerCueLine(lines, j)) break;
      if (/^(CUT|FADE|TITLE|MONTAGE|END|BLACK|DISSOLVE|SMASH CUT|MATCH CUT)\b/i.test(line)) break;
      // 结构边界:场景卡/人物卡〔…〕【…】、镜头号(数字｜/数字|,全角或半角竖线)、markdown 引用式对白(>)。
      // 缺这些边界时,一个被误判的说话人会把整段正文吞成一个"对白块"→ 翻译时整篇被替换(整篇变英文事故根因)。
      if (/^[〔【]/.test(line) || /^\d+\s*[｜|]/.test(line) || /^>/.test(compactLine(lines[j]))) break;
      if (isParentheticalLine(line)) continue;
      if (lineIndexes.length && isActionLineAfterDialogue(line, speaker)) break;
      lineIndexes.push(j);
    }
    if (lineIndexes.length) {
      blocks.push({
        id: blocks.length,
        speaker,
        lineIndexes,
        indent: String(lines[lineIndexes[0]] || "").match(/^\s*/)?.[0] || "",
        text: lineIndexes.map((index) => compactLine(lines[index])).join("\n"),
      });
    }
  }
  return blocks;
}

function blockquoteDialogueBlocks(source, dialogueLanguage = "en") {
  const lines = String(source || "").split(/\r?\n/);
  const language = normalizeDialogueLanguage(dialogueLanguage, "en");
  const blocks = [];
  const linePattern = /^(\s*>\s*)([A-Za-z][A-Za-z .'\-]{1,32}|[一-龥·]{1,8})(\s*[（(][^）)]{0,24}[）)])?(\s*[：:])\s*(.*)$/;
  const addBlock = (lineIndex, speaker, text, prefix) => {
    const bilingual = splitBilingualDialogue(compactLine(text));
    const spoken = language === "zh" ? bilingual.zh || compactLine(text) : bilingual.en || compactLine(text);
    const validSpeaker = isValidCharacterLabel(speaker) || (/^[一-龥·]$/.test(speaker) && !isNonCharacterHeading(speaker));
    if (spoken && validSpeaker) {
      blocks.push({ id: blocks.length, speaker, text: spoken, lineIndexes: [lineIndex], prefix, blockquote: true });
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(linePattern);
    if (!match) continue;
    const speaker = cleanSpeakerCue(match[2]);
    const prefix = `${match[1]}${match[2]}${match[3] || ""}${match[4]}`;
    if (match[5].trim()) {
      addBlock(i, speaker, match[5], prefix);
      continue;
    }
    const next = lines[i + 1]?.match(/^(\s*>\s*)(.+)$/);
    if (next && !next[2].match(linePattern)) addBlock(i + 1, speaker, next[2], next[1]);
  }
  return blocks;
}

function blockquoteDialogues(source, dialogueLanguage = "en") {
  return blockquoteDialogueBlocks(source, dialogueLanguage).map(({ speaker, text }) => ({ speaker, text }));
}

function applyDialogueTranslations(script, blocks, translations) {
  const lines = String(script || "").split(/\r?\n/);
  const byId = new Map(translations.map((item) => [Number(item.id), compactLine(item.text)]));
  for (const block of [...blocks].reverse()) {
    const translated = byId.get(block.id);
    if (!translated) continue;
    const replacement = String(translated)
      .split(/\r?\n/)
      .map((line) => `${block.indent}${compactLine(line)}`)
      .filter((line) => line.trim());
    if (!replacement.length) continue;
    lines.splice(block.lineIndexes[0], block.lineIndexes.length, ...replacement);
  }
  return lines.join("\n");
}

function applyDialogueAndBlockquoteTranslations(script, blocks, blockquoteBlocks, translations) {
  const lines = String(script || "").split(/\r?\n/);
  const byId = new Map(translations.map((item) => [Number(item.id), compactLine(item.text)]));
  const allBlocks = [...blocks, ...blockquoteBlocks].sort((a, b) => b.lineIndexes[0] - a.lineIndexes[0]);
  for (const block of allBlocks) {
    const translated = byId.get(block.id);
    if (!translated) continue;
    if (block.blockquote) {
      lines[block.lineIndexes[0]] = `${block.prefix}${translated}`;
      continue;
    }
    const replacement = translated.split(/\r?\n/).map((line) => `${block.indent}${compactLine(line)}`).filter((line) => line.trim());
    if (replacement.length) lines.splice(block.lineIndexes[0], block.lineIndexes.length, ...replacement);
  }
  return lines.join("\n");
}

function dialogueTranslationSystemPrompt(targetLanguage) {
  const target = targetLanguage === "zh" ? "Chinese" : "English";
  return `You translate screenplay dialogue only. Output strict JSON only.

Rules:
- Translate every item.text into natural ${target} dialogue.
- Do not translate speaker names because they are not included.
- Do not add quotation marks, speaker labels, explanations, markdown, or notes.
- Preserve story meaning, tone, subtext, and short-drama performance rhythm.
- Keep line breaks only when truly useful.

Output schema:
{
  "translations": [
    { "id": 0, "text": "translated dialogue" }
  ]
}`;
}

async function translateDialogueBlocks(blocks, targetLanguage, modelName) {
  if (!blocks.length) return { ok: true, model: "", translations: [] };
  const apiKey = assetAnalyzerApiKey();
  const model = normalizeAssetAnalyzerModel(modelName);
  if (!apiKey) throw new Error("缺少资产解析/对白转换 API Key，无法自动切换剧本对白。");
  const payload = {
    targetLanguage: targetLanguage === "zh" ? "zh" : "en",
    dialogues: blocks.map((block) => ({ id: block.id, speaker: block.speaker, text: block.text })),
  };
  const requestBody = (withJsonMode) => ({
    model,
    temperature: 0.2,
    ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: dialogueTranslationSystemPrompt(targetLanguage) },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });
  const post = (withJsonMode) =>
    fetch(openAiCompatUrl("/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(withJsonMode)),
    });
  let response = await post(true);
  let raw = await response.text();
  if (!response.ok && response.status === 400 && /response_format|json_object/i.test(raw)) {
    response = await post(false);
    raw = await response.text();
  }
  if (!response.ok) throw new Error(`对白转换模型返回 HTTP ${response.status}: ${raw.slice(0, 600)}`);
  const data = JSON.parse(raw);
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(stripJsonFence(content));
  const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
  return { ok: true, model, translations };
}

// 熔断护栏:检测"对白块疑似误吞了非对白正文"。对白块本不该含场景卡〔〕/【】、镜头号(数字｜)、或跨越过多行。
// 命中任一条即判定不安全 → 上层中止写回,绝不用误译结果覆盖剧本(这是整篇变英文事故的直接护栏)。
function dialogueBlocksLookSafe(script, blocks) {
  const lines = String(script || "").split(/\r?\n/);
  const nonEmpty = lines.filter((l) => compactLine(l)).length || 1;
  let replaced = 0;
  for (const block of blocks || []) {
    for (const idx of block.lineIndexes || []) {
      const line = compactLine(lines[idx]);
      replaced += 1;
      // 对白块里混进了场景卡/人物卡/镜头号 → 一定是吞过界了。
      if (/^[〔【]/.test(line) || /^\d+\s*[｜|]/.test(line)) {
        return { safe: false, reason: `对白块#${block.id}(${block.speaker})误吞了非对白行:${line.slice(0, 24)}` };
      }
    }
    // 单个对白块跨越 >6 行几乎必是误吞(正常对白极少连续超过几行)。
    if ((block.lineIndexes || []).length > 6) {
      return { safe: false, reason: `对白块#${block.id}(${block.speaker})跨越${block.lineIndexes.length}行,疑似误吞整段正文` };
    }
  }
  // 单次翻译替换过半正文 → 不该发生。
  if (replaced / nonEmpty > 0.5) {
    return { safe: false, reason: `本次将替换 ${replaced}/${nonEmpty} 行(>50%),疑似格式误判` };
  }
  return { safe: true, reason: "" };
}

// 对白块是否已全部为英文(不含 CJK 汉字)。用于 target=en 时跳过翻译:
// 剧本本来就是英文对白,再喂给模型只会浪费调用且可能把好台词改坏。
function dialogueBlocksAreAllEnglish(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!list.length) return false; // 没提取到对白 → 不做"已英文"判断,交给正常流程。
  return list.every((block) => !/[一-鿿]/.test(String(block?.text || "")));
}

async function convertScriptDialogueLanguage(script, targetLanguage, modelName, options = {}) {
  const blocks = extractDialogueBlocks(script);
  const guard = dialogueBlocksLookSafe(script, blocks);
  if (!guard.safe) {
    // 中止:不翻译、不改动剧本。上层据 aborted 返回错误提示,原文原样返回。
    return { model: null, count: blocks.length, script, aborted: true, abortReason: guard.reason };
  }
  const blockquoteBlocks = blockquoteDialogueBlocks(script, targetLanguage).map((block, index) => ({
    ...block,
    id: blocks.length + index,
  }));
  // 开关:target=英文 且(用户手动声明已是英文 或 自动检测对白已全英文)→ 跳过模型,原样返回。
  if (targetLanguage === "en") {
    const allBlocks = [...blocks, ...blockquoteBlocks];
    const assumeEnglish = options.assumeEnglish === true;
    if ((assumeEnglish || dialogueBlocksAreAllEnglish(allBlocks)) && allBlocks.length) {
      return {
        model: null,
        count: allBlocks.length,
        script,
        skipped: true,
        skipReason: assumeEnglish ? "manual" : "detected-english",
      };
    }
  }
  const result = await translateDialogueBlocks([...blocks, ...blockquoteBlocks], targetLanguage, modelName);
  return {
    model: result.model,
    count: blocks.length + blockquoteBlocks.length,
    script: applyDialogueAndBlockquoteTranslations(script, blocks, blockquoteBlocks, result.translations),
  };
}

function storyboardDialogueLanguageSystemPrompt(targetLanguage) {
  const target = targetLanguage === "zh" ? "Chinese" : "English";
  return `You rewrite short-drama shot dialogue into ${target}. Output strict JSON only.

Rules:
- Rewrite every item.text into natural ${target} dialogue a character speaks on screen.
- If the text is already natural ${target}, keep it unchanged.
- Preserve story meaning, speaker intent, tone, subtext and short-drama rhythm.
- Do not translate or change item.speaker. Do not add quotes, labels, markdown or notes.

Output schema:
{
  "translations": [
    { "id": 0, "text": "rewritten dialogue" }
  ]
}`;
}

// 用视频分镜模型(gpt-5.6-sol)把每个镜头的对白改写成所选语言;只改对白,失败原样返回,不中断配置构建。
async function localizeShotDialoguesWithStoryboardModel(shots, targetLanguage) {
  const list = Array.isArray(shots) ? shots : [];
  const language = targetLanguage === "zh" ? "zh" : "en";
  const items = [];
  list.forEach((shot, shotIndex) => {
    const dialogues = Array.isArray(shot?.dialogues) ? shot.dialogues : [];
    dialogues.forEach((line, lineIndex) => {
      const text = compactLine(typeof line === "string" ? line : line?.text || "");
      if (text) items.push({ id: items.length, shotIndex, lineIndex, text });
    });
  });
  if (!items.length) return list;
  const apiKey = storyboardApiKey();
  if (!apiKey) return list;
  const model = normalizeStoryboardModel(undefined);
  const payload = { targetLanguage: language, dialogues: items.map((item) => ({ id: item.id, text: item.text })) };
  const requestBody = (withJsonMode) => ({
    model,
    temperature: 0.2,
    ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: storyboardDialogueLanguageSystemPrompt(language) },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });
  try {
    const post = (withJsonMode) =>
      fetch(openAiCompatUrl("/v1/chat/completions", "storyboard"), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody(withJsonMode)),
      });
    let response = await post(true);
    let raw = await response.text();
    if (!response.ok && response.status === 400 && /response_format|json_object/i.test(raw)) {
      response = await post(false);
      raw = await response.text();
    }
    if (!response.ok) return list;
    const parsed = JSON.parse(stripJsonFence(JSON.parse(raw).choices?.[0]?.message?.content || ""));
    const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
    const byId = new Map(translations.map((entry) => [Number(entry.id), compactLine(entry.text || "")]));
    const cloned = list.map((shot) => ({ ...shot, dialogues: Array.isArray(shot?.dialogues) ? shot.dialogues.slice() : shot?.dialogues }));
    for (const item of items) {
      const next = byId.get(item.id);
      if (!next) continue;
      const original = cloned[item.shotIndex].dialogues[item.lineIndex];
      cloned[item.shotIndex].dialogues[item.lineIndex] =
        typeof original === "string" ? next : { ...original, text: next };
    }
    return cloned;
  } catch {
    return list;
  }
}

function pushUnique(list, value) {
  const clean = compactLine(value);
  if (clean && !list.some((item) => item.toLowerCase() === clean.toLowerCase())) list.push(clean);
}

function lineWithContext(lines, index, maxLines = 3) {
  return lines.slice(index, Math.min(lines.length, index + maxLines)).map(compactLine).filter(Boolean).join(" / ");
}

function inferWorldProfile(script) {
  const westernNameSignals = /(?:Sheriff|Deputy|Dr\.|Doctor|Officer|Agent|Mr\.|Mrs\.|Ms\.|Cole|Mercer|Voss|Hale|Peterson|Hendricks|Ethan|Kane|Mercy|Cain|Ezekiel|Crowe|Toby|Finch|Jericho|Vale|Hank|Dead Psalm|Bleeding Horse|伊森·凯恩|科尔|默瑟|梅瑟|沃斯|海尔|彼得森|亨德里克斯)/i.test(script);
  const englishDialogueSignals = (script.match(/[“"]?[A-Z][A-Za-z’' ,.!?]+[?!][^”"\n]*[”"]?/g) || []).length >= 1;
  const foreignSetting = westernNameSignals || englishDialogueSignals || /PROJECT\s+GRAYLIGHT|Sheriff|Deputy|State vet|American western|美国西部|western gothic/i.test(script);
  const futuristic = /2103|Ω|Omega|基因|生物装甲|能量刃|未来|新港市/i.test(script);
  const subway = /地铁|车厢|隧道|列车/i.test(script);
  const ruralUs = /Sheriff|Deputy|牧场|农场|cattle|cow|Peterson|Dead Psalm|Bleeding Horse|American western|美国西部|荒原|酒馆|蒸汽火车/i.test(script);
  const settingParts = [];
  if (foreignSetting) settingParts.push("overseas Western / North American story world");
  if (futuristic) settingParts.push("near-future sci-fi realism");
  if (subway) settingParts.push("futuristic overseas metro system");
  if (ruralUs) settingParts.push("rural American small-town setting");
  return {
    foreignSetting,
    futuristic,
    subway,
    ruralUs,
    settingPrompt: settingParts.join(", ") || "screenplay-specific story world",
    humanCastingPrompt: foreignSetting
      ? "Casting must match an overseas Western / North American production: Western or ethnically diverse non-Chinese faces, natural international casting, no default Chinese or East Asian facial features unless the screenplay explicitly states that ethnicity."
      : "Casting must follow the screenplay context exactly; do not default to any unrelated ethnicity.",
    sceneLocalePrompt: foreignSetting
      ? "The environment must read as overseas / non-Chinese: avoid Chinese signage, Chinese advertisements, Chinese metro design defaults, Chinese license plates, or East Asian urban visual defaults unless explicitly written in the screenplay."
      : "The environment must follow the screenplay location exactly; do not add unrelated regional visual defaults.",
  };
}

function deriveNarrativeLocations(script) {
  const locations = [];
  const hasMetroLocation = /地铁|车厢|隧道|列车/i.test(script);
  for (const match of String(script || "").matchAll(/(?:字幕\s*[（(]?\s*地点条\s*[）)]?|地点|场景)\s*[：:]\s*([^\r\n]+)/g)) {
    let label = compactLine(match[1])
      .replace(/\d{3,4}年.*$/, "")
      .replace(/[。；;，,]+$/g, "")
      .replace(/[·.]/g, " ")
      .trim();
    if (/(?:西藏|藏地(?:扎西岗|雪坡|神山|寺庙|高原)|扎西岗)/.test(label) && /神山|寺庙|雪坡|经幡/.test(script)) label = "藏地扎西岗雪坡神山寺庙";
    if (label && !isGenericGroupCharacterLabel(label) && !isActionPhraseCharacterLabel(label)) pushUnique(locations, label);
  }
  if (/Dead Psalm/i.test(script)) {
    pushUnique(locations, "美国西部小镇 Dead Psalm 夜晚");
  }
  if (/The Bleeding Horse/i.test(script)) {
    pushUnique(locations, "The Bleeding Horse 西部酒馆内景");
  }
  if (/黑色蒸汽火车|蒸汽火车|教会的金属十字架|荒原/i.test(script)) {
    pushUnique(locations, "美国西部荒原黑色蒸汽火车");
  }
  if (/(?:新港市[\s\S]{0,80}(?:地铁|车厢|隧道|列车)|(?:地铁|车厢|隧道|列车)[\s\S]{0,80}新港市)/i.test(script)) {
    pushUnique(locations, "2103年新港市地铁列车车厢与隧道");
  }
  if (hasMetroLocation && /暗紫色|频闪|电流爆破|车身剧烈震颤/i.test(script)) {
    pushUnique(locations, "暗紫色应急灯下震颤的地铁车厢");
  }
  if (hasMetroLocation && /狼藉|血腥味|铁锈味|杂物散落|人间炼狱/i.test(script)) {
    pushUnique(locations, "灾变后狼藉血腥的地铁车厢");
  }
  if (/Peterson[\s\S]{0,80}(牧场|农场|围栏|cattle|cow|deadstock)|(牧场|农场|围栏|cattle|cow|deadstock)[\s\S]{0,80}Peterson/i.test(script)) {
    pushUnique(locations, "Peterson农场牧场围栏清晨");
  }
  if (/巡逻车|patrol car/i.test(script)) {
    pushUnique(locations, "警长巡逻车内");
  }
  if (/学校|school/i.test(script)) {
    pushUnique(locations, "小镇学校方向");
  }
  if (/(?:西藏|藏地(?:扎西岗|雪坡|神山|寺庙|高原)|扎西岗|神山|金顶寺庙|五彩经幡|向阳雪坡)/.test(script)) {
    pushUnique(locations, "藏地扎西岗雪坡神山寺庙");
  }
  if (/空旷雪原土路|雪原土路|骑旧自行车沿空旷雪原|倒地空转的自行车/.test(script)) {
    pushUnique(locations, "空旷雪原回家土路");
  }
  return locations;
}

function cleanSceneHeadingLabel(value) {
  return compactLine(value)
    .replace(/^\[场景\d+\]\s*/, "")
    .replace(/^[-:：·\s]+/, "")
    .replace(/\s*•[\s\S]*$/, "")
    .replace(/\s+/g, " ")
    .slice(0, 90)
    .trim();
}

function sceneLabelKey(value) {
  return compactLine(value).replace(/[·\s"“”'’-]+/g, "").toLowerCase();
}

function isGenericFallbackSceneLabel(value) {
  const key = sceneLabelKey(value);
  return key === "主场景环境建立图" || key === "主场景" || key === "mainscene" || key === "defaultscene" || key === "fallbackscene";
}

function sceneLabelCore(value) {
  return sceneLabelKey(value)
    .replace(/^(外景|内景|ext\.?|int\.?|exterior|interior)/i, "")
    .replace(/^\d{3,4}年/, "")
    .replace(/(清晨|早晨|上午|下午|傍晚|黄昏|夜晚|深夜|黎明|日落|日出|白天|夜间|暴雨夜|雨夜|morning|afternoon|evening|night|dawn|dusk)$/i, "")
    .replace(/(清晨|早晨|上午|下午|傍晚|黄昏|夜晚|深夜|黎明|日落|日出|白天|夜间|morning|afternoon|evening|night|dawn|dusk)$/i, "")
    .replace(/^(警长|副警长)/, "")
    .replace(/内$/, "");
}

function sceneLabelsOverlap(a, b) {
  const aKey = sceneLabelCore(a);
  const bKey = sceneLabelCore(b);
  if (!aKey || !bKey) return false;
  if (aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey)) return true;
  for (const term of ["巡逻车", "农场", "牧场", "围栏", "地铁", "车厢", "隧道", "学校", "实验室", "办公室", "咖啡店", "小巷", "街头", "总部", "虚空", "裂缝", "藏地", "扎西岗", "神山", "寺庙", "雪坡", "雪原", "土路", "经幡"]) {
    if (aKey.includes(term) && bKey.includes(term)) return true;
  }
  return false;
}

function sceneContinuityKey(value) {
  const core = sceneLabelCore(value)
    .replace(/^林念初的/, "")
    .replace(/某城市/g, "城市")
    .replace(/[\d_]+/g, "");
  const terms = ["咖啡店", "晚风", "城市街头", "小巷", "秩序局总部", "总部", "时空裂缝", "虚空", "裂缝", "农场", "牧场", "围栏", "巡逻车", "学校", "地铁", "车厢", "隧道"];
  const hits = terms.filter((term) => core.includes(term));
  return hits.length ? hits.join("|") : core;
}

function sceneLabelsSameForContinuity(a, b) {
  const aKey = sceneContinuityKey(a);
  const bKey = sceneContinuityKey(b);
  if (!aKey || !bKey) return false;
  if (aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey)) return true;
  return aKey.split("|").some((token) => token.length >= 2 && bKey.split("|").includes(token));
}

function extractBracketSceneHeadings(script) {
  const headings = [];
  const pattern = /\[场景\d+\]\s*([^•\r\n\[]+)/g;
  for (const match of String(script || "").matchAll(pattern)) {
    const heading = cleanSceneHeadingLabel(match[1]);
    if (heading) pushUnique(headings, heading);
  }
  for (const match of String(script || "").matchAll(/【场景】\s*([^\r\n]+)/g)) {
    const heading = cleanSceneHeadingLabel(match[1]).replace(/[·.]/g, " ").replace(/\s+/g, " ");
    if (heading) pushUnique(headings, heading);
  }
  return headings;
}

function parseLocations(script) {
  const lines = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const locations = [];
  for (const heading of extractBracketSceneHeadings(script)) pushUnique(locations, heading);
  for (const line of lines) {
    if (isSceneHeadingLine(line)) {
      const heading = cleanSceneHeadingLabel(line).replace(/[·.]/g, " ").replace(/\s+/g, " ").slice(0, 90);
      if (heading) pushUnique(locations, heading);
    }
  }
  for (const location of deriveNarrativeLocations(script)) pushUnique(locations, location);
  const unique = [];
  for (const location of locations) {
    if (isGenericFallbackSceneLabel(location)) continue;
    const key = sceneLabelKey(location);
    if (!key) continue;
    if (unique.some((item) => sceneLabelsOverlap(item, location))) continue;
    unique.push(location);
  }
  return unique.slice(0, 10);
}

function cleanCharacterName(name) {
  return compactLine(name)
    .replace(/^[◦•\-\s]+/, "")
    .replace(/^\d{1,3}\s*岁(?:的)?/, "")
    .replace(/（.*?）/g, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/[：:].*$/g, "")
    .replace(/(身着|穿着|站在|靠在|拿着|捏着|攥着|猛然|本能|咬牙|低声|抬手|背靠|望着|看着).*$/g, "")
    .replace(/[：:，,。.!?！？]+$/g, "")
    .trim();
}

function isGenericGroupCharacterLabel(value) {
  const name = cleanCharacterName(value);
  if (!name) return true;
  if (/^(?:群|一群|几名|几个|多名|众多|所有|坡下几个|远处几个|一个|两个|三名)?(?:孩子|小孩|儿童|村民|群众|路人|围观者|乘客|游客|学生|士兵|工作人员|人们|众人|同伴)(?:们)?$/i.test(name)) return true;
  if (/^(?:他们|她们|它们|大家|人群|群众|路人|围观者|同伴们|孩子们|小孩们|村民们|乘客们|游客们|学生们)$/.test(name)) return true;
  if (/们/.test(name) && !/[A-Za-z]|·|Ω|战甲|怪物|巨兽|畸变|异化/.test(name)) return true;
  return false;
}

function isActionPhraseCharacterLabel(value) {
  const name = cleanCharacterName(value);
  if (!name) return true;
  if (/Ω|战甲|装甲|怪物|巨兽|神兽|雪狮|畸变|异化|生命体|实体/.test(name)) return false;
  if (/^(?:镜界|冻结现象|时间冻结|现实吞噬|黑日)$/.test(name)) return true;
  if (/^(?:画面|音效|运镜|色彩|作用|字幕|地点条|镜头|声音|对白)$/.test(name)) return true;
  if (/(?:茫然|抬头|低头|回头|看他|看她|看着|望着|注视|喊|喃喃|气声|做鬼脸|转身|继续|玩|独自|坐着|画画|擦汗|停住|眯眼|骑|狂奔|腿软|倒地|连滚带爬|消失|凝固|裹住|翻过|定格|闪过|不见|响起|发出|出现|陷入|靠近|远去|切黑|跳切|运镜|音效|色彩|作用)/.test(name)) return true;
  if (/[，。！？；、]/.test(name)) return true;
  return false;
}

function isLikelyLocationOrTimeLabel(value) {
  const line = compactLine(value);
  if (!line) return true;
  if (isSceneHeadingLine(line)) return true;
  if (/\d{3,4}年\s*[·\-]/.test(line) || /年\s*[·\-]/.test(line)) return true;
  return /(外景|内景|地点条|地点|场景|环境|农场|牧场|围栏|巡逻车|车厢|隧道|地铁|列车|学校|总部|办公室|实验室|走廊|房间|厨房|街道|小巷|咖啡店|吧台|裂缝|虚空|城市|藏地|扎西岗|神山|寺庙|雪坡|雪原|土路|经幡|山顶|荒原|清晨|早晨|上午|下午|傍晚|黄昏|夜晚|深夜|黎明|日落|日出|暴雨夜)/.test(line);
}

function isNonVisualAudioCueLabel(value) {
  const label = compactLine(value).replace(/\s+/g, "");
  if (!label) return false;
  if (/^(?:女声|男声|童声|老人声|旁白|画外音|内心独白|声音|音效|环境音|通讯声)$/.test(label)) return true;
  if (/^(?:耳麦|通讯|无线电|对讲机)[·.\-]?(?:失真|杂音|电流声)$/.test(label)) return true;
  return false;
}

function isValidCharacterLabel(value) {
  const name = cleanCharacterName(value);
  if (!name || isProductionFieldLabel(name) || isLikelyLocationOrTimeLabel(name)) return false;
  if (isNonVisualAudioCueLabel(name)) return false;
  if (isGenericGroupCharacterLabel(name) || isActionPhraseCharacterLabel(name)) return false;
  if (/[\d\[\]：:]/.test(name)) return false;
  if (/年|月|日|清晨|早晨|上午|下午|傍晚|黄昏|夜|暴雨|咖啡店|总部|街头|小巷|虚空|裂缝|场景|地点|环境|画面|镜头|灯光|音效|建筑|神山|寺庙|雪坡|雪原|土路|经幡|画册|自行车|照片|文件|书页|道具/.test(name)) return false;
  if (name.length > 28 && /[\u4e00-\u9fff]/.test(name)) return false;
  if (/^(执行官|目标|建议|无|这是什么|天呐|不可能)$/.test(name)) return false;
  if (/(特效|表情|眼神|灯光|镜头|画面|音效|心跳|咖啡|暴雨|裂缝|制服|光芒|空间|数据|粒子|伤口|手指|胸口|耳根|瞳孔|嘴角|气|手掌|面部|下颌|视线|生命体征)/.test(name)) return false;
  if (/^[A-Z][A-Z0-9 .'\-]{1,32}$/.test(name)) return true;
  if (/^[A-Z][A-Za-z0-9 .'\-]{1,40}$/.test(name) && (/\s/.test(name) || /^(Sheriff|Deputy|Dr\.?|Doctor|Agent|Officer|Mr\.?|Mrs\.?|Ms\.?)\b/.test(name))) return true;
  if (/^[A-Z][a-z][A-Za-z'\-]{1,24}$/.test(name) && !/^(Same|Good|What|Then|Unless|Listen|People|Population|Church|Railroad|Before|Mostly|Relax)$/i.test(name)) return true;
  return /^[一-龥·]{2,8}$/.test(name);
}

function isVoiceOnlyCharacterName(name, script) {
  const clean = compactLine(name);
  if (!clean) return true;
  if (/^ZERO$/i.test(clean) && /ZERO[：:（(][\s\S]{0,80}(耳内|信号|通讯|系统|生命体征|心率|坐标|AI|电子)/i.test(script)) return true;
  return false;
}

function normalizeCharacterDisplayName(name) {
  const clean = cleanCharacterName(name);
  const match = clean.match(/^(SHERIFF|DEPUTY|DR\.?|DOCTOR|AGENT|OFFICER|MR\.?|MRS\.?|MS\.?)\s+(.+)$/);
  if (!match) return clean;
  const titleMap = {
    SHERIFF: "Sheriff",
    DEPUTY: "Deputy",
    DR: "Dr.",
    DOCTOR: "Doctor",
    AGENT: "Agent",
    OFFICER: "Officer",
    MR: "Mr.",
    MRS: "Mrs.",
    MS: "Ms.",
  };
  const key = match[1].replace(/\.$/, "");
  return `${titleMap[key] || match[1]} ${match[2].trim()}`;
}

function preferredCharacterNames(candidates) {
  const cleaned = [...candidates]
    .map(cleanCharacterName)
    .map(normalizeCharacterDisplayName)
    .filter(Boolean)
    .filter((name) => !/V\.O\.|O\.S\./i.test(name))
    .filter((name) => !isNonCharacterHeading(name))
    .filter(isValidCharacterLabel)
    .filter((name) => !/[，。！？；、]/.test(name))
    .filter((name) => !/(瞬间|接连|突然|发出|陷入|扑向|退缩|尖叫|嘶吼|慌乱|骚动)$/.test(name))
    .filter((name) => !/^(乘客们|众人|更多怪物|多名乘客|正常乘客)$/.test(name))
    .filter((name) => !/^(INT|EXT|CUT|FADE|TITLE|MONTAGE|Same|Good|What|No|Then|Unless|Listen|People)$/i.test(name));

  const unique = [];
  for (const name of cleaned) {
    if (!unique.some((item) => item.toLowerCase() === name.toLowerCase())) unique.push(name);
  }

  return unique
    .filter((name) => {
      const upper = name.toUpperCase();
      const last = upper.split(/\s+/).filter(Boolean).at(-1);
      if (/Ω|OMEGA|战甲|ARMOR|异化|畸变|怪物/.test(name)) return true;
      if (!last || upper.includes(" ")) return true;
      return !unique.some((other) => {
        const otherUpper = other.toUpperCase();
        return otherUpper !== upper && otherUpper.split(/\s+/).includes(last) && otherUpper.length > upper.length;
      });
    })
    .slice(0, 6)
    .map((name) => name.replace(/\s+/g, " "));
}

function characterAliasMap(script) {
  const aliases = new Map();
  const add = (alias, full) => {
    const cleanAlias = cleanCharacterName(alias).toUpperCase();
    const cleanFull = cleanCharacterName(full).replace(/\s+/g, " ");
      if (cleanAlias && cleanFull && cleanAlias !== cleanFull.toUpperCase()) aliases.set(cleanAlias, cleanFull);
  };
  for (const block of extractManualAssetPromptBlocks(script).filter((item) => item.type === "Character")) {
    const parts = block.label.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      add(parts[0], block.label);
      add(parts.at(-1), block.label);
    }
  }
  for (const match of script.matchAll(/\b(Sheriff|Deputy|Dr\.|Doctor|Agent|Officer|Mr\.|Mrs\.|Ms\.)\s+([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)?)\b/g)) {
    const title = match[1].replace(/\.$/, "");
    const names = match[2].trim().split(/\s+/).filter(Boolean);
    const full = `${title} ${names.join(" ")}`;
    add(match[2], full);
    add(names.at(-1), full);
  }
  for (const match of script.matchAll(/\b(Sheriff|Deputy|Dr\.|Doctor|Agent|Officer|Mr\.|Mrs\.|Ms\.)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\b/g)) {
    const title = match[1].replace(/\.$/, "");
    const names = match[2].trim().split(/\s+/).filter(Boolean);
    const full = `${title} ${names.join(" ")}`;
    add(match[2], full);
    add(names.at(-1), full);
  }
  return aliases;
}

function applyCharacterAliases(names, script) {
  const aliases = characterAliasMap(script);
  const expanded = names.map((name) => aliases.get(cleanCharacterName(name).toUpperCase()) || name);
  const unique = [];
  for (const name of expanded) {
    if (!unique.some((item) => item.toLowerCase() === name.toLowerCase())) unique.push(name);
  }
  return unique;
}

function characterNameFromProfileHeading(line = "") {
  const clean = compactLine(line);
  if (!clean || clean.length > 60) return "";
  if (/[：:，,。.!?！？]/.test(clean)) return "";
  if (/^(?:第\d+集|SHOT\b|SCENE\b|画面|运镜|音效|色彩|字幕|地点条|作用|对白|旁白)$/i.test(clean)) return "";
  const chineseThenEnglish = clean.match(/^([\u4e00-\u9fff][\u4e00-\u9fff·]{1,12})\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3}$/);
  if (chineseThenEnglish) return cleanCharacterName(chineseThenEnglish[1]);
  const chineseOnly = clean.match(/^([\u4e00-\u9fff][\u4e00-\u9fff·]{1,12})$/);
  if (chineseOnly) return cleanCharacterName(chineseOnly[1]);
  const englishOnly = clean.match(/^([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})$/);
  if (englishOnly) return cleanCharacterName(englishOnly[1]);
  return "";
}

function isCharacterProfileDescription(line = "") {
  const text = compactLine(line);
  if (!text) return false;
  return /(?:人类|男性|女性|拟人化|狼人|狐狸|负责人|博士|科学家|杀手|赏金猎人|狙击手|队长|冠军|专家|情报贩子|老千|指挥官|创始人|反派|主角|男主|女主|银发|短发|长发|服装|身材|毛发|机械|改造|能力者|冷峻|危险|残忍|优雅|暴躁)/.test(text);
}

function extractCharacterProfileNames(script) {
  const lines = String(script || "").split(/\r?\n/);
  const names = [];
  for (let index = 0; index < Math.min(lines.length, 140); index += 1) {
    const line = compactLine(lines[index]);
    if (!line) continue;
    if (/^(?:第\s*\d+\s*集|SHOT\s*\d+|[-═]{5,})/i.test(line)) break;
    const name = characterNameFromProfileHeading(line);
    if (!name || !isValidCharacterLabel(name)) continue;
    const next = lines.slice(index + 1, index + 4).map(compactLine).find(Boolean) || "";
    if (!isCharacterProfileDescription(next)) continue;
    pushUnique(names, name);
  }
  return names;
}

function labelFromManualAssetHeading(heading) {
  const clean = compactLine(heading)
    .replace(/^\d+\s*[.、)]\s*/, "")
    .replace(/^[-#\s]+/, "")
    .replace(/\s+/g, " ");
  const englishName = clean.match(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})\s*$/);
  if (englishName) return englishName[1].trim();
  return clean.replace(/^(主角|反派|少年|小骗子|搭档|角色|人物|场景|道具)\s*/, "").slice(0, 42);
}

function manualAssetTypeFromText(value) {
  const text = compactLine(value);
  if (/场景|环境|地点|全景|大全景|空镜|无人物|没有人物|scene|environment|location|establishing|wide shot|wide establishing|no people|without people|interior|exterior/i.test(text)) return "Scene";
  if (/镜界|冻结现象|时间冻结|现实吞噬|超自然力场|异界存在|视觉签名|黑日|symbol|phenomenon|force field|supernatural|anomaly/i.test(text)) return "Insert";
  if (/插入|证据|微距|特写|法医|insert|close.?up|macro|forensic|evidence/i.test(text)) return "Insert";
  if (/道具|物件|物体|三视图道具|prop|object|item|turnaround|front view|side view|back view/i.test(text) && !/人物|角色|character|face|hair|skin|portrait|full.?body/i.test(text)) return "Prop";
  if (/角色|人物|主角|反派|搭档|全身三视图|半身特写|脸|发型|头发|服装|肤色|身材|修女|牧师|少年|character|body.*view|full.?body|character sheet|same character identity|face|hair|skin|clothing|outfit|costume|portrait/i.test(text)) return "Character";
  return "Prop";
}

function englishPromptFromManualPrompt(value, assetType, label) {
  const source = englishCue(value, "");
  const chunks = String(source || "")
    .replace(/[，；。]/g, ",")
    .replace(/[：]/g, ":")
    .split(/[,\n]+/)
    .map((part) => compactLine(part))
    .filter((part) => /[A-Za-z0-9]/.test(part))
    .filter((part) => !/[\u4e00-\u9fff]/.test(part))
    .filter((part) => !/^[-–—]+$/.test(part));
  const deduped = [];
  for (const chunk of chunks) {
    if (!deduped.some((item) => item.toLowerCase() === chunk.toLowerCase())) deduped.push(chunk);
  }
  const base = deduped.join(", ") || `screenplay-provided visual direction for ${label}`;
  const typeRule =
    assetType === "Scene"
      ? "16:9 landscape frame, wide establishing environment reference, no people, no human silhouettes, final rendering style controlled by the selected asset style"
      : assetType === "Prop"
        ? "16:9 landscape frame, pure white background, front view, side view, back view, same prop three-view reference sheet, final rendering style controlled by the selected asset style"
        : assetType === "Insert"
          ? "16:9 landscape frame, insert-shot evidence detail, clear centered subject, final rendering style controlled by the selected asset style"
          : "16:9 landscape frame, pure white background, full body three-view character sheet, front view, side view, back view, half-body close-up portrait, same character identity across all views, final rendering style controlled by the selected asset style";
  const negative =
    assetType === "Scene"
      ? "Negative constraints: no people, no crowds, no human silhouettes, no readable random text, no watermark, no unrelated style override."
      : "Negative constraints: no watermark, no random text, no extra people, no unrelated props, no unrelated style override, no default Chinese or East Asian face unless explicitly required.";
  return `Text-to-image task: Generate one production-grade ${assetType.toLowerCase()} reference asset for "${label}". ${base}. Required specification: ${typeRule}. ${negative}`.trim();
}

function extractManualAssetPromptBlocks(script) {
  const source = String(script || "");
  const headingRe = /(?:^|\n)\s*(\d+)[.、)]\s*([^\n]{2,90})\n+提示词\s*\d*\s*[：:]\s*([^\n]*)\n+/g;
  const matches = [...source.matchAll(headingRe)];
  const blocks = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    let body = source.slice(start, end);
    const separatorAt = body.search(/\n\s*(?:⸻|---|夜晚，|清晨，|外景|内景|EXT\.?|INT\.?)/i);
    if (separatorAt >= 0) body = body.slice(0, separatorAt);
    const label = labelFromManualAssetHeading(match[2]);
    const type = manualAssetTypeFromText(`${match[2]} ${match[3]} ${body}`);
    const prompt = compactLine(body);
    if (!label || prompt.length < 80) continue;
    blocks.push({
      type,
      label,
      heading: compactLine(match[2]),
      descriptor: compactLine(match[3]),
      prompt,
      textToImagePrompt: englishPromptFromManualPrompt(prompt, type, label),
    });
  }
  return blocks;
}

function stripStructuredMarkdownHeading(value = "") {
  return compactLine(value).replace(/^#{1,6}\s+/, "");
}

function structuredAssetType(value = "") {
  const heading = stripStructuredMarkdownHeading(value)
    .replace(/[【】\[\]]/g, "")
    .replace(/^[◆◇]\s*/u, "")
    .replace(/^(?:第\s*)?(?:[一二三四五六七八九十百]+|\d+)\s*[、.．)）]\s*/, "")
    .replace(/[：:]\s*$/, "")
    .toLowerCase();
  if (/^(?:人物|角色)\s*(?:卡|段|card|section)(?:\s+characters?)?/i.test(heading) || /^(?:人物|角色)\s+characters?\b/i.test(heading)) return "Character";
  if (/^(?:场景|环境|地点)\s*(?:卡|段|card|section)(?:\s+scenes?)?/i.test(heading) || /^(?:场景|环境|地点)\s+(?:scenes?|environment|locations?)\b/i.test(heading)) return "Scene";
  if (/^(?:道具|物件|物体)\s*(?:卡|段|card|section)(?:\s+props?|objects?)?/i.test(heading) || /^(?:道具|物件|物体)\s+(?:props?|objects?)\b/i.test(heading)) return "Prop";
  if (/^(?:插入|细节|特写)\s*(?:卡|段|card|section)(?:\s+inserts?|details?)?/i.test(heading) || /^(?:插入|细节|特写)\s+(?:inserts?|details?)\b/i.test(heading)) return "Insert";
  if (/^(?:(?:主要|核心|主角|配角(?:与|及)?单元)?(?:人物|角色))(?:设定|列表|清单)?$|^(?:character|characters)$/.test(heading)) return "Character";
  if (/^(?:(?:主要|核心|关键)?(?:场景|环境|地点))(?:设定|列表|清单)?$|^(?:scene|scenes|environment|location)$/.test(heading)) return "Scene";
  if (/^(?:(?:主要|核心|关键)?(?:道具|物件|物体))(?:设定|列表|清单)?$|^(?:prop|props|object|objects)$/.test(heading)) return "Prop";
  if (/^(?:(?:关键)?(?:插入|细节|特写))(?:设定|列表|清单)?$|^(?:insert|inserts|detail|details)$/.test(heading)) return "Insert";
  return "";
}

function isStructuredAssetCardHeading(value = "") {
  const heading = stripStructuredMarkdownHeading(value)
    .replace(/[【】\[\]]/g, "")
    .replace(/^[◆◇]\s*/u, "");
  return !!structuredAssetType(heading) && /(?:卡|card)(?=\s|$)/i.test(heading);
}

function structuredAssetLabel(type, description = "") {
  let label = stripStructuredMarkdownHeading(description)
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩㊀㊁㊂㊃㊄㊅㊆㊇㊈㊉⒜-⒵]\s*/u, "")
    .replace(/^\d+\s*[.)、]\s*/, "")
    .replace(/^(?:名称|名字|资产名|描述|设定)\s*[：:]\s*/i, "")
    .replace(/^[-•*]\s*/, "");
  if (label.includes("：") || label.includes(":")) label = label.split(/[：:]/)[0];
  label = label.split(/[，,。；;]/)[0].replace(/[（(].*$/, "").trim();
  if (type === "Character") label = label.replace(/^(?:人物|角色|主角|男主|女主|反派)\s*/, "");
  if (type === "Scene") label = label.replace(/^(?:场景|环境|地点)\s*/, "");
  if (type === "Prop") label = label.replace(/^(?:道具|物件|物体)\s*/, "");
  if (type === "Insert") label = label.replace(/^(?:插入|细节|特写)\s*/, "");
  label = compactLine(label).slice(0, 42);
  if (!label || !isModelAssetLabelUsable(label)) return "";
  if (type === "Character" && (isLikelyLocationOrTimeLabel(label) || isNonVisualAudioCueLabel(label))) return "";
  if (type === "Scene" && /^(?:无人物|空景|环境)$/i.test(label)) return "";
  if ((type === "Prop" || type === "Insert") && /^(?:道具|物件|细节|特写)$/i.test(label)) return "";
  return label;
}

function isStructuredAssetMetadataLine(rawLine = "") {
  const line = compactLine(rawLine)
    .replace(/^[-•*]\s*/, "")
    .replace(/^[①-⑳㊀-㊉⒜-⒵]\s*/u, "");
  return /^(?:描述|视觉|外观|身份|身份标签|设定|造型|年龄|体型|脸部|发型|服装|气质|空间|氛围|灯光|材质|纹理|结构|用途|特征|构图|时间|天气|色彩|标志物|生理线|配色|一致性锚点|全局画风锚|一句话|中文提示词|EN prompt|English prompt|关键变体|关键元素|光线氛围|定位|核心美学|调色板逻辑|使用备注|备注)\s*(?:[：:]|$)/i.test(line);
}

function isStructuredAssetFieldLine(rawLine = "") {
  const source = String(rawLine || "");
  const sourceLine = compactLine(source);
  const line = sourceLine.replace(/^[-•*]\s*/, "");
  const match = line.match(/^([^：:]{1,80})\s*[：:]\s*(.+)$/);
  if (!match) return false;
  // 现有中文资产档用“- 名称：描述”表示条目；“•字段：值”仍是字段快路径。
  if (/^[-*]\s*/.test(sourceLine)) return false;
  const fieldName = compactLine(match[1]);
  const baseFieldName = fieldName.replace(/^(.*?)\s*(?:\([\s\S]*\)|（[\s\S]*）)$/u, "$1").trim();
  const fieldWords = baseFieldName.split(/\s+/).filter(Boolean);
  if (
    /^#{1,6}\s+/.test(sourceLine) ||
    isStructuredAssetMarkerLine(line) ||
    /^[A-Za-z]{1,4}\d{1,4}\s*(?=[：:]|$)/u.test(fieldName) ||
    /^[\d]+\s*[.)、．）:：]\s*$/u.test(fieldName)
  ) {
    return false;
  }
  return (
    [...baseFieldName].length <= 30 &&
    fieldWords.length <= 4 &&
    !/[.!?。！？,，、;；]/.test(baseFieldName) &&
    /^[\p{L}\p{Script=Han}][\p{L}\p{Script=Han}· _-]*$/u.test(baseFieldName)
  );
}

function structuredSectionAssetEntry(type, rawLine = "") {
  if (/^·\s*/.test(rawLine)) return null;
  const isBullet = /^[-•*]\s*/.test(rawLine);
  const line = compactLine(rawLine).replace(/^[-•*]\s*/, "");
  if (!line) return null;
  if (/^[═━─—]{3,}$/.test(line)) return null;
  // 描述字段不是新的资产条目，例如“外观：…”、“灯光：…”应归入前一资产的 visual。
  if (isStructuredAssetMetadataLine(line)) return null;
  // 冒号结构的短标签是字段，不因语言或是否使用项目符号而成为新资产。
  if (isStructuredAssetFieldLine(rawLine)) return null;

  const label = structuredAssetLabel(type, line);
  if (!label) return null;
  const hasExplicitAssetMarker = /^(?:[A-Z]{1,4}\d{1,4})(?:\s|$)/i.test(label) || isStructuredAssetMarkerLine(line);
  const hasDescriptorPunctuation = /[，,。；;]/.test(line);
  const hasParentheticalIdentity = /^[^：:，,。；;]{1,42}[（(][^（）()]{1,80}[）)](?:\s*[：:—-].*)?$/.test(line);
  // 冒号前出现逗号/句号时通常是上一条资产的描述内部字段（如“封存白昼的祭刀，……半柄残刃：……”），
  // 不能把它误作新的“名称：描述”条目。
  const hasNameDescription = /^[^：:，,。；;]{1,42}[：:]\s*.+$/.test(line);
  const characterName = /^[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·.' /-]{0,24}$/u.test(label);
  const sceneName = /[·・]|(?:场|厅|殿|楼|塔|城|市|街|巷|区|域|站|口|谷|渊|窟|室|庄|院|寺|府|地|台|营|阁|海|山|河|桥|船|车|港|原|林|房|顶)$/.test(label);
  const propName = /[\/／]|(?:刀|剑|刃|印|环|纹|符|器|物|具|石|玉|链|钥匙|枪|书|卷|镜|盒|灯|冠|甲|鼎|图|牌|令|血|尸|衣|管|道|源|柱|锁|针|鞘|旗|匣|徽)$/.test(label);
  const isMarkdownAssetHeading = /^#{2,6}\s+\S/.test(compactLine(rawLine));
  const isShortBareAssetName =
    !hasNameDescription &&
    !hasDescriptorPunctuation &&
    [...label].length <= 42 &&
    label.split(/\s+/).filter(Boolean).length <= 4 &&
    !/[.!?。！？]/.test(label);
  if (hasExplicitAssetMarker || isMarkdownAssetHeading) return { label, visual: line };
  if (isBullet || hasParentheticalIdentity) return { label, visual: line };
  if (hasNameDescription) {
    if (type === "Character" && characterName && !/[、，,]/.test(label)) return { label, visual: line };
    if (type === "Scene" && sceneName) return { label, visual: line };
    if ((type === "Prop" || type === "Insert") && propName) return { label, visual: line };
    return null;
  }
  if (hasDescriptorPunctuation) return null;

  if (type === "Character") return characterName || isShortBareAssetName ? { label, visual: line } : null;
  if (type === "Scene") return sceneName || isShortBareAssetName ? { label, visual: line } : null;
  if (type === "Prop" || type === "Insert") return propName || isShortBareAssetName ? { label, visual: line } : null;
  return null;
}

function isStructuredAssetMarkerLine(line = "") {
  const normalized = stripStructuredMarkdownHeading(line);
  return (
    /^(?:(?:[①-⑳㊀-㊉⒜-⒵])(?=\s|[\p{L}\p{N}]|$)|\d+\s*[.)、．）](?:\s|$)|[A-Za-z]{1,4}\d{1,4}(?=\s|$))/u.test(
      normalized,
    )
  );
}

// “资产描述”与剧情剧本的语法不同：除了“人物：姓名，外观”，还常用
// “一、主要人物 / 三、场景 / 四、关键道具”编号标题，条目名和视觉描述分行书写。
// 不经过这个专用通道时，剧情规则会把这类说明漏掉或混进错误类别。
function parseStructuredAssetDescriptions(script = "") {
  const assets = [];
  let activeType = "";
  let structuredCardMode = false;
  let pending = null;
  let cardEntryBoundary = false;
  const push = (type, description, labelHint = "") => {
    const visual = compactLine(description);
    const label = labelHint || structuredAssetLabel(type, visual);
    if (!label || !visual) return;
    if (assets.some((asset) => asset.type === type && sameAssetLabel(asset.label, label))) return;
    assets.push({
      type,
      label,
      evidence: `用户提供${type === "Character" ? "人物" : type === "Scene" ? "场景" : type === "Insert" ? "插入镜头" : "道具"}视觉描述：${visual}`,
      visual,
    });
  };
  const flushPending = () => {
    if (!pending) return;
    push(pending.type, pending.lines.join(" "), pending.label);
    pending = null;
  };

  for (const rawLine of String(script || "").split(/\r?\n/)) {
    const line = compactLine(rawLine);
    if (!line) {
      if (structuredCardMode) {
        // 无编号的卡以段落为边界；字段值在同一段内继续归属上一张卡。
        cardEntryBoundary = true;
      }
      continue;
    }
    const sectionType = structuredAssetType(line);
    if (sectionType) {
      flushPending();
      activeType = sectionType;
      structuredCardMode = isStructuredAssetCardHeading(line);
      cardEntryBoundary = structuredCardMode;
      continue;
    }
    const markdownHeading = line.match(/^(#{1,6})\s+\S/);
    if (markdownHeading && markdownHeading[1].length <= 2 && !isStructuredAssetMarkerLine(line)) {
      flushPending();
      activeType = "";
      structuredCardMode = false;
      cardEntryBoundary = false;
      continue;
    }
    if (/^◆/.test(line)) {
      flushPending();
      activeType = "";
      structuredCardMode = false;
      cardEntryBoundary = false;
      continue;
    }
    if (/^[═━─—]{3,}$/.test(line)) continue;
    const direct = line.match(/^(?:[-•*]\s*)?(人物|角色|character|characters|场景|环境|地点|scene|scenes|environment|location|道具|物件|prop|props|object|objects|插入|细节|特写|insert|inserts|detail|details)\s*[：:]\s*(.+)$/i);
    if (direct) {
      if (!structuredCardMode) {
        flushPending();
        const type = structuredAssetType(direct[1]);
        if (type) push(type, direct[2]);
      } else if (pending) {
        pending.lines.push(line);
      }
      continue;
    }
    if (!activeType) continue;
    const isCardMarker = structuredCardMode && isStructuredAssetMarkerLine(line);
    const isCardMetadata = structuredCardMode && (isStructuredAssetMetadataLine(line) || isStructuredAssetFieldLine(line));
    // 卡片分区已经显式给出类型。编号和段落开头都可以开始新卡；字段内容则继续归属上一张卡。
    let entry = null;
    if (!isCardMetadata && (isCardMarker || (structuredCardMode && (!pending || cardEntryBoundary)))) {
      const label = structuredAssetLabel(activeType, line);
      entry = label ? { label, visual: line } : null;
    } else if (!structuredCardMode) {
      entry = structuredSectionAssetEntry(activeType, line);
    }
    if (entry) {
      flushPending();
      pending = { type: activeType, label: entry.label, lines: [entry.visual] };
      cardEntryBoundary = false;
    } else if (pending) {
      pending.lines.push(line);
      cardEntryBoundary = false;
    }
  }
  flushPending();
  return assets;
}

function parseCharacters(script) {
  const candidates = new Set();
  for (const block of extractManualAssetPromptBlocks(script).filter((item) => item.type === "Character")) {
    candidates.add(block.label);
  }
  // Regression source: top-of-script profile blocks like
  // "杰克·沃尔夫 Jack Wolfe" / "火药桶 Buck" / "格兰特博士"
  // followed by a description line must become Character assets even when
  // the model misclassifies them as props or inserts.
  extractCharacterProfileNames(script).forEach((name) => candidates.add(name));
  const dialogue = parseSpeakerDialogues(script);
  for (const item of dialogue) candidates.add(item.speaker.replace(/\(.*?\)/g, "").trim());
  const colonSpeakerMatches = script.matchAll(/(?:^|\n)\s*([A-Z][A-Za-z .'\-]{1,32})\s*:\s*["“]/g);
  for (const match of colonSpeakerMatches) {
    const name = cleanCharacterName(match[1]);
    if (isValidCharacterLabel(name)) candidates.add(name);
  }
  const allCapsNameMatches = script.matchAll(/(?:名字\s*[：:]\s*|\n)\s*([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+){1,3})\s*(?=\n|$)/g);
  for (const match of allCapsNameMatches) {
    const name = cleanCharacterName(match[1]);
    if (isValidCharacterLabel(name)) candidates.add(name);
  }
  const nameMatches = script.matchAll(/\b(?:Sheriff|Deputy|Dr\.|Doctor|Agent|Officer|Mr\.|Mrs\.|Ms\.)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/g);
  for (const match of nameMatches) candidates.add(match[0].trim());
  const mixedNameMatches = script.matchAll(/\b(?:Sheriff|Deputy|Dr\.|Doctor|Agent|Officer)\s+([A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)?)\b/g);
  for (const match of mixedNameMatches) candidates.add(match[0].trim());
  const chineseWesternNameMatches = script.matchAll(/(?:(维修工程师|警长|副警长|博士|医生|特工|司机)\s*)?([一-龥]{1,6}·[一-龥]{1,4})/g);
  for (const match of chineseWesternNameMatches) {
    const lineStart = script.lastIndexOf("\n", match.index) + 1;
    const beforeMatch = script.slice(lineStart, match.index);
    if (isStructuredAssetMarkerLine(beforeMatch) && /[（(][^）)]*$/.test(beforeMatch)) continue;
    const name = `${match[1] || ""}${match[2]}`.trim();
    if (isValidCharacterLabel(name) && (match[1] || !isLikelyLocationOrTimeLabel(name))) candidates.add(name);
  }
  const inlineSpeakerMatches = script.matchAll(/[◦•]\s*([A-Z][A-Z0-9 .'\-]{1,32}|[一-龥][一-龥·]{1,8})\s*(?:（[^）]*）)?[：:]/g);
  for (const match of inlineSpeakerMatches) {
    const name = cleanCharacterName(match[1]);
    if (isValidCharacterLabel(name)) candidates.add(name);
  }
  const actingHintMatches = script.matchAll(/演技提示[（(]([^）)]+)[）)]/g);
  for (const match of actingHintMatches) {
    const name = cleanCharacterName(match[1]);
    if (isValidCharacterLabel(name)) candidates.add(name);
  }
  const actionNameMatches = script.matchAll(/([一-龥]{2,4})(?=身着|正在|纵身|从半空|踉跄|递上|按住|挣扎|面无表情|第一次|全身一震|抬头|站在|注视)/g);
  for (const match of actionNameMatches) {
    const previousChar = script[Math.max(0, (match.index || 0) - 1)] || "";
    if (/[\u4e00-\u9fff]/.test(previousChar)) continue;
    const name = cleanCharacterName(match[1]);
    if (isValidCharacterLabel(name)) candidates.add(name);
  }
  if (/伊森·凯恩/.test(script) && /(?:Ω核心|生物装甲|战甲|能量刃)/.test(script)) candidates.add("伊森·凯恩 Ω核心战甲形态");
  if (/一名上班族[\s\S]{0,80}(?:公文包|慌乱|停电)/.test(script)) candidates.add("上班族乘客");
  if (/一名中年男人[\s\S]{0,140}(?:异化|灰化|利爪|双眼翻白)/.test(script)) candidates.add("异化中年男人");
  if (/一名女乘客[\s\S]{0,120}(?:尖叫|退缩|颤抖)/.test(script)) candidates.add("女乘客");
  if (/畸变怪物|异化怪物/.test(script)) candidates.add("畸变怪物");
  const lines = script.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = compactLine(lines[index]);
    if (isEnglishSpeakerCue(line) || isChineseSpeakerCue(lines, index)) {
      candidates.add(line);
    }
  }
  return applyCharacterAliases(preferredCharacterNames(candidates), script).filter(
    (name) =>
      !isVoiceOnlyCharacterName(name, script) &&
      !structuredAssetType(name) &&
      !isStructuredAssetFieldLine("•" + name + "：值"),
  );
}

function assetLabelConflict(a, b) {
  const left = normalizeAssetMatchText(a);
  const right = normalizeAssetMatchText(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(assetMatchTokens(left));
  const rightTokens = assetMatchTokens(right);
  return rightTokens.some((token) => token.length >= 4 && leftTokens.has(token));
}

function shouldSuppressRuleCharacter(label, manualBlocks) {
  const clean = compactLine(label);
  if (!manualBlocks.length) return false;
  if (manualBlocks.some((block) => assetLabelConflict(block.label, clean))) return true;
  return /^(群|一群|两个|两名|多名|众人|赏金犯|群赏金犯|两个孩子|醉汉|酒馆里的人|Drunk Outlaw)$/i.test(clean);
}

const NON_CHARACTER_ASSET_LABEL_RE =
  /(?:镜界|冻结现象|时间冻结|现实吞噬|黑日|超自然力场|地点条|场景|环境|画面|镜头|声音|女声|男声|旁白|画外音|耳麦失真|音效|字幕|运镜|光影|灯光|照片|文件|文件夹|画册|速写本|自行车|电话|手机|屏幕|纹路|装置|手指|胸口|瞳孔|嘴角|伤口|视线|神山|寺庙|雪坡|雪原|土路|经幡|车厢|隧道|地铁|列车|房间|厨房|走廊|街道|小巷|咖啡店|吧台|总部|办公室|实验室|农场|牧场|围栏|裂缝|虚空)/;
const SCENE_ASSET_EVIDENCE_RE =
  /(?:外景|内景|外部|内部|地点|场景|环境|空间|房间|厨房|走廊|街道|小巷|咖啡店|吧台|总部|办公室|实验室|农场|牧场|围栏|巡逻车|押运车|车厢|隧道|地铁|列车|高架桥|桥面|港口|指挥室|学校|城市|藏地|扎西岗|神山|寺庙|雪坡|雪原|土路|经幡|裂缝|虚空|清晨|早晨|上午|下午|傍晚|黄昏|夜晚|深夜|黎明|日落|日出|暴雨|wide establishing|environment|location|interior|exterior|no people|empty environment)/i;
const PROP_ASSET_EVIDENCE_RE =
  /(?:道具|物件|物体|文件|文件夹|照片|相片|画册|速写本|自行车|电话|手机|屏幕|纸条|单据|检修单|钥匙|饰品|项链|武器|枪|手枪|步枪|手雷|弹匣|消音器|刀|匕首|能量刃|核心|装置|押运车|装甲车|手铐|按钮|三视图|front view|side view|back view|prop|object|item|folder|photo|phone|paperwork|weapon|blade|gun|pistol|rifle|firearm|silencer)/i;
const INSERT_ASSET_EVIDENCE_RE =
  /(?:插入|特写|微距|证据|法医|局部|细节|镜界|冻结现象|时间冻结|现实吞噬|黑日|超自然力场|纹路|光芒|裂缝|虚空|尸体|伤口|瞳孔|手指|胸口|屏幕|画册页|预言图画|insert|close.?up|macro|forensic|evidence|detail|phenomenon|anomaly|rift)/i;
const CHARACTER_ASSET_EVIDENCE_RE =
  /(?:人物|角色|主角|反派|男主|女主|人类男性|人类女性|拟人化|狼人|狐狸|章鱼怪|少年|少女|男人|女人|老人|孩子|士兵|乘客|押运员|指挥官|队长|狙击手|赏金猎人|武器专家|情报贩子|科学家|警长|副警长|博士|医生|特工|怪物|巨兽|神兽|雪狮|实体|生命体|说|喊|问|看着|望着|注视|站起|走向|扑向|跪|挣扎|表情|眼神|呼吸|脸|发型|服装|肤色|身材|character|person|man|woman|boy|girl|monster|creature|sheriff|doctor|guard|face|hair|costume)/i;

function correctedAssetNameForType(asset, type, index = 1) {
  const label = compactLine(asset?.label || asset?.name || `Asset ${index}`);
  return typedAssetName(type, index, label);
}

function correctedAssetPromptForType(asset, type) {
  const prompt = compactLine(asset?.textToImagePromptOverride || "");
  if (!prompt) return "";
  return validateAnalyzerPrompt({ type }, prompt) || "";
}

function correctAssetRoleFromEvidence(asset = {}, context = {}) {
  const originalType = normalizeAssetType(asset.type || "Prop", "Prop");
  const label = compactLine(asset.label || asset.name || "");
  const evidence = compactLine(asset.evidence || "");
  const visual = compactLine(asset.visual || "");
  const hay = `${label} ${evidence} ${visual}`;
  // 用户在资产描述中已明确放入“人物/场景/道具”分段时，分类就是输入事实。
  if (asset.lockedManual || asset.lockedStructured) return asset;
  const modelDeclaredCharacter = asset.analyzerType === "Character" || asset.modelDeclaredType === "Character";
  const modelCharacterLabel =
    modelDeclaredCharacter &&
    isModelAssetLabelUsable(label) &&
    !isProductionFieldLabel(label) &&
    !isLikelyLocationOrTimeLabel(label) &&
    !isNonVisualAudioCueLabel(label);
  if (modelCharacterLabel && originalType !== "Character") {
    const typeIndex = Number(context.typeIndexes?.get?.("Character") || 0) + 1;
    context.typeIndexes?.set?.("Character", typeIndex);
    const name = correctedAssetNameForType(asset, "Character", typeIndex);
    return {
      ...asset,
      type: "Character",
      name,
      matchCode: assetMatchCode("Character", name, typeIndex),
      analyzerNote: compactLine([asset.analyzerNote || "", "模型明确声明为 Character，覆盖本地误分类"].filter(Boolean).join("；")),
    };
  }
  // 后续启发式不能因为“昼”是单字或“血契”含“血”而把它们重新改类。
  let correctedType = originalType;
  const reasons = [];

  if (originalType === "Character") {
    const hasCharacterEvidence = isValidCharacterLabel(label) && CHARACTER_ASSET_EVIDENCE_RE.test(hay);
    if (INSERT_ASSET_EVIDENCE_RE.test(hay) && (!hasCharacterEvidence || NON_CHARACTER_ASSET_LABEL_RE.test(label))) {
      correctedType = "Insert";
      reasons.push("insert/detail evidence outranks weak character evidence");
    } else if ((SCENE_ASSET_EVIDENCE_RE.test(hay) || isLikelyLocationOrTimeLabel(label)) && !hasCharacterEvidence) {
      correctedType = "Scene";
      reasons.push("scene/location evidence found in character candidate");
    } else if ((PROP_ASSET_EVIDENCE_RE.test(hay) || NON_CHARACTER_ASSET_LABEL_RE.test(label)) && !hasCharacterEvidence) {
      correctedType = "Prop";
      reasons.push("prop/object evidence found in character candidate");
    } else if (!isValidCharacterLabel(label)) {
      correctedType = "Prop";
      reasons.push("invalid character label fallback to prop");
    }
  } else if (originalType === "Scene") {
    if (INSERT_ASSET_EVIDENCE_RE.test(hay) && !SCENE_ASSET_EVIDENCE_RE.test(label)) {
      correctedType = "Insert";
      reasons.push("insert/detail evidence found in scene candidate");
    } else if (PROP_ASSET_EVIDENCE_RE.test(label) && !SCENE_ASSET_EVIDENCE_RE.test(hay)) {
      correctedType = "Prop";
      reasons.push("prop evidence found in scene candidate");
    }
  } else if (originalType === "Prop") {
    if (INSERT_ASSET_EVIDENCE_RE.test(hay) && !PROP_ASSET_EVIDENCE_RE.test(label)) {
      correctedType = "Insert";
      reasons.push("insert/detail evidence found in prop candidate");
    } else if (SCENE_ASSET_EVIDENCE_RE.test(label) && !PROP_ASSET_EVIDENCE_RE.test(hay)) {
      // 只有「label 本身就是地点」才翻成场景;不能因道具证据台词里提到所在地点(如「翻进厨房,一把手枪」)
      // 就把道具误升为场景(修:带消音器的手枪被错纠成 S002_..._WIDE_ESTABLISHING)。
      correctedType = "Scene";
      reasons.push("scene/location evidence found in prop candidate");
    }
  } else if (originalType === "Insert") {
    if (SCENE_ASSET_EVIDENCE_RE.test(label) && !INSERT_ASSET_EVIDENCE_RE.test(hay)) {
      correctedType = "Scene";
      reasons.push("scene/location evidence found in insert candidate");
    }
  }

  if (correctedType === originalType) return asset;
  const typeIndex = Number(context.typeIndexes?.get?.(correctedType) || 0) + 1;
  context.typeIndexes?.set?.(correctedType, typeIndex);
  const name = correctedAssetNameForType(asset, correctedType, typeIndex);
  const matchCode = assetMatchCode(correctedType, name, typeIndex);
  const correctionNote =
    originalType === "Character"
      ? `assetRoleCorrected: corrected from Character to ${correctedType}; ${reasons.join("; ")}`
      : `assetRoleCorrected: corrected from ${originalType} to ${correctedType}; ${reasons.join("; ")}`;
  return {
    ...asset,
    type: correctedType,
    name,
    matchCode,
    textToImagePromptOverride: correctedAssetPromptForType(asset, correctedType),
    analyzerSource: asset.analyzerSource || "rules",
    analyzerNote: compactLine(
      [
        asset.analyzerNote || "",
        correctionNote,
      ].filter(Boolean).join("；"),
    ),
  };
}

function correctAssetRolesFromEvidence(assets = []) {
  const typeIndexes = new Map();
  const corrected = [];
  for (const asset of assets) {
    const originalType = normalizeAssetType(asset?.type || "Prop", "Prop");
    const item = correctAssetRoleFromEvidence(asset, { typeIndexes });
    const finalType = normalizeAssetType(item?.type || originalType, originalType);
    if (finalType === originalType) {
      typeIndexes.set(finalType, Number(typeIndexes.get(finalType) || 0) + 1);
    }
    corrected.push(item);
  }
  return corrected;
}

function compactLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function gravitexVideoUrl(pathname) {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const baseUrl = gravitexVideoBaseUrl();
  if (baseUrl.endsWith("/v1") && clean.startsWith("/v1/")) return `${baseUrl}${clean.slice(3)}`;
  return `${baseUrl}${clean}`;
}

function arkVideoUrl(pathname) {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const baseUrl = volcArkVideoBaseUrl();
  if (baseUrl.endsWith("/v1") && clean.startsWith("/v1/")) return `${baseUrl}${clean.slice(3)}`;
  return `${baseUrl}${clean}`;
}

function volcArkImageBaseUrl() {
  return (
    process.env.VOLC_ARK_IMAGE_BASE_URL ||
    process.env.VOLC_ARK_BASE_URL ||
    process.env.ARK_BASE_URL ||
    DEFAULT_VOLC_ARK_VIDEO_BASE_URL
  ).replace(/\/+$/, "");
}

function arkImageUrl(pathname) {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const baseUrl = volcArkImageBaseUrl();
  if (baseUrl.endsWith("/v1") && clean.startsWith("/v1/")) return `${baseUrl}${clean.slice(3)}`;
  return `${baseUrl}${clean}`;
}

function bytePlusArkVideoUrl(pathname) {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const baseUrl = bytePlusArkVideoBaseUrl();
  if (baseUrl.endsWith("/v1") && clean.startsWith("/v1/")) return `${baseUrl}${clean.slice(3)}`;
  return `${baseUrl}${clean}`;
}

function normalizeSeedanceModel(value, provider = "") {
  const raw = compactLine(value || "seedance-2-0");
  if (provider === "byteplus") {
    const bp = {
      "seedance-2-0": process.env.BYTEPLUS_SEEDANCE_MODEL || DEFAULT_BYTEPLUS_SEEDANCE_MODEL_MAP["seedance-2-0"],
      "seedance-2-0-fast": process.env.BYTEPLUS_SEEDANCE_FAST_MODEL || DEFAULT_BYTEPLUS_SEEDANCE_MODEL_MAP["seedance-2-0-fast"],
      "seedance-2-0-mini": process.env.BYTEPLUS_SEEDANCE_MINI_MODEL || DEFAULT_BYTEPLUS_SEEDANCE_MODEL_MAP["seedance-2-0-mini"],
      "seedance-2-0-liveness-face": process.env.BYTEPLUS_SEEDANCE_MODEL || DEFAULT_BYTEPLUS_SEEDANCE_MODEL_MAP["seedance-2-0"],
      "seedance-2-0-person-reference": process.env.BYTEPLUS_SEEDANCE_MODEL || DEFAULT_BYTEPLUS_SEEDANCE_MODEL_MAP["seedance-2-0"],
    };
    return bp[raw] || raw;
  }
  const map = {
    "seedance-2-0": process.env.SEEDANCE_MODEL || DEFAULT_SEEDANCE_MODEL_MAP["seedance-2-0"],
    "seedance-2-0-fast": process.env.SEEDANCE_FAST_MODEL || DEFAULT_SEEDANCE_MODEL_MAP["seedance-2-0-fast"],
    "seedance-2-0-mini": process.env.SEEDANCE_MINI_MODEL || DEFAULT_SEEDANCE_MODEL_MAP["seedance-2-0-mini"],
    "seedance-2-0-liveness-face": process.env.SEEDANCE_MODEL || DEFAULT_SEEDANCE_MODEL_MAP["seedance-2-0"],
    "seedance-2-0-person-reference": process.env.SEEDANCE_MODEL || DEFAULT_SEEDANCE_MODEL_MAP["seedance-2-0"],
  };
  return map[raw] || raw;
}

function normalizeGravitexSeedanceModel(value) {
  const raw = compactLine(value || "seedance-2-0");
  if (raw === "seedance-2-0-fast") return "seedance-2-0-fast";
  if (raw === "seedance-2-0-liveness-face") return "seedance-2-0";
  return raw === "seedance-2-0" ? raw : "seedance-2-0";
}

function normalizeVideoConfigModelName(value = "") {
  const raw = compactLine(value || DEFAULT_VIDEO_CONFIG_MODEL);
  const lower = raw.toLowerCase();
  if (["seedance-2-0", "seedance-2-0-fast", "seedance-2-0-mini", "seedance-2-0-person-reference", "seedance-2-0-byteplus"].includes(raw)) return raw;
  if (/person|人物|真人|liveness/.test(lower)) return "seedance-2-0-person-reference";
  if (/byteplus|海外|modelark|ap-southeast/.test(lower)) return "seedance-2-0-byteplus";
  if (/mini|迷你/.test(lower)) return "seedance-2-0-mini";
  if (/fast|快速/.test(lower)) return "seedance-2-0-fast";
  return "seedance-2-0";
}

function projectVideoModelForShot(config = {}, shot = {}) {
  return normalizeVideoConfigModelName(shot.modelOverride || shot.modelName || config.modelName || DEFAULT_VIDEO_CONFIG_MODEL);
}

function normalizeVideoRatio(value) {
  const raw = compactLine(value || "9:16");
  // 火山 Ark Seedance 2.0 支持的比例(不含 9:21)
  if (["9:16", "16:9", "1:1", "4:3", "3:4", "21:9", "adaptive"].includes(raw)) return raw;
  return "9:16";
}

function normalizeReferenceVideoRatio(value) {
  const ratio = normalizeVideoRatio(value);
  return ratio === "adaptive" ? "9:16" : ratio;
}

function normalizeVideoResolution(value, model = "") {
  const raw = compactLine(value || "720p");
  const lower = raw.toLowerCase();
  const isFastOrMini = /(?:fast|mini)/i.test(String(model || ""));
  if (["480p", "720p"].includes(lower)) return lower;
  if (lower === "1080p" && !isFastOrMini) return lower;
  if (lower === "4k" && !isFastOrMini) return "4k";
  return "720p";
}

function normalizeGravitexVideoResolution(value, model = "") {
  const raw = compactLine(value || "720p").toLowerCase();
  if (raw === "480p") return "480p";
  if (raw === "1080p" && model !== "seedance-2-0-fast") return "1080p";
  return "720p";
}

function normalizeSeedanceDuration(value) {
  const number = Math.round(Number(value || 5));
  if (!Number.isFinite(number)) return 5;
  return Math.max(4, Math.min(15, number));
}

function publicRemoteAssetUrl(url) {
  const raw = compactLine(url);
  if (!raw) return "";
  if (/^asset:\/\//i.test(raw)) return raw;
  if (!/^https?:\/\//i.test(raw)) return "";
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(raw)) return "";
  return raw;
}

function localMediaPathFromUrl(url) {
  const raw = compactLine(url);
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw, "http://localhost");
  } catch {
    return "";
  }
  if (parsed.pathname !== "/media") return "";
  const file = path.resolve(parsed.searchParams.get("path") || "");
  if (!file || !allowedPath(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return "";
  return file;
}

function localFilePathFromUrl(url) {
  const raw = compactLine(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "file:") return "";
    const file = path.resolve(parsed.pathname);
    if (!file || !allowedPath(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return "";
    return file;
  } catch {
    return "";
  }
}

function localPublicAssetPathFromUrl(url) {
  const raw = compactLine(url);
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw, "http://localhost");
  } catch {
    return "";
  }
  // 本地上传的图总会先在 CANVAS_PUBLIC_ASSET_DIR 落盘,再上传 S3。因此不论引用地址是本地相对形式
  // `/public-assets/xxx`,还是 S3 公网形式 `https://<bucket>/<prefix>/public-assets/xxx`,
  // 只要 `/public-assets/` 作为路径段出现,就按 basename 命中本地镜像——避免走 fetch 网络往返
  // (慢且易超时,是"参考图解析到0张"的根因)。路径穿越由 isInside + basename 双重防护。
  const segMatch = parsed.pathname.match(/(?:^|\/)public-assets\/(.+)$/);
  if (!segMatch) return "";
  const fileName = path.basename(decodeURIComponent(segMatch[1]));
  const file = path.join(CANVAS_PUBLIC_ASSET_DIR, fileName);
  if (!fileName || !isInside(CANVAS_PUBLIC_ASSET_DIR, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return "";
  return file;
}

function fileToDataUrl(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function publicAssetBaseUrl() {
  return compactLine(
    readLocalEnvValue("PUBLIC_ASSET_BASE_URL") ||
      readLocalEnvValue("CANVAS_PUBLIC_ASSET_BASE_URL") ||
      process.env.PUBLIC_ASSET_BASE_URL ||
      process.env.CANVAS_PUBLIC_ASSET_BASE_URL ||
      "",
  ).replace(/\/+$/, "");
}

function publicAssetStorageConfig() {
  const endpoint = compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_ENDPOINT") || process.env.PUBLIC_ASSET_S3_ENDPOINT || "").replace(/\/+$/, "");
  const bucket = compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_BUCKET") || process.env.PUBLIC_ASSET_S3_BUCKET || "");
  const region = compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_REGION") || process.env.PUBLIC_ASSET_S3_REGION || "auto");
  const accessKeyId = compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_ACCESS_KEY_ID") || process.env.PUBLIC_ASSET_S3_ACCESS_KEY_ID || "");
  const secretAccessKey = compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_SECRET_ACCESS_KEY") || process.env.PUBLIC_ASSET_S3_SECRET_ACCESS_KEY || "");
  const publicBaseUrl = compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_PUBLIC_BASE_URL") || process.env.PUBLIC_ASSET_S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const prefix = compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_PREFIX") || process.env.PUBLIC_ASSET_S3_PREFIX || "pixel-toys/public-assets").replace(/^\/+|\/+$/g, "");
  const forcePathStyle = /^(1|true|yes)$/i.test(compactLine(readLocalEnvValue("PUBLIC_ASSET_S3_FORCE_PATH_STYLE") || process.env.PUBLIC_ASSET_S3_FORCE_PATH_STYLE || ""));
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) return null;
  return { endpoint, bucket, region, accessKeyId, secretAccessKey, publicBaseUrl, prefix, forcePathStyle };
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function awsUriEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectPublicUrl(baseUrl, key) {
  return `${baseUrl.replace(/\/+$/, "")}/${key.split("/").map(awsUriEncode).join("/")}`;
}

function arkVirtualPersonConfig(overrides = {}) {
  return {
    accessKeyId: compactLine(
      Object.prototype.hasOwnProperty.call(overrides, "accessKeyId")
        ? overrides.accessKeyId
        : readLocalEnvValue("ARK_ASSETS_ACCESS_KEY_ID") || process.env.ARK_ASSETS_ACCESS_KEY_ID || "",
    ),
    secretAccessKey: compactLine(
      Object.prototype.hasOwnProperty.call(overrides, "secretAccessKey")
        ? overrides.secretAccessKey
        : readLocalEnvValue("ARK_ASSETS_SECRET_ACCESS_KEY") || process.env.ARK_ASSETS_SECRET_ACCESS_KEY || "",
    ),
    groupId: compactLine(overrides.groupId || readLocalEnvValue("ARK_VIRTUAL_PERSON_GROUP_ID") || process.env.ARK_VIRTUAL_PERSON_GROUP_ID || ""),
    region: compactLine(overrides.region || readLocalEnvValue("ARK_ASSETS_REGION") || process.env.ARK_ASSETS_REGION || "cn-beijing"),
    projectName: compactLine(overrides.projectName || readLocalEnvValue("ARK_ASSETS_PROJECT_NAME") || process.env.ARK_ASSETS_PROJECT_NAME || "default"),
    service: compactLine(overrides.service || "ark"),
    endpoint: compactLine(overrides.endpoint || readLocalEnvValue("ARK_ASSETS_ENDPOINT") || process.env.ARK_ASSETS_ENDPOINT || "https://ark.cn-beijing.volcengineapi.com").replace(/\/+$/, ""),
    version: compactLine(overrides.version || "2024-01-01"),
  };
}

function buildArkAssetOpenApiRequest(action, payload = {}, overrides = {}) {
  const config = arkVirtualPersonConfig(overrides);
  if (!config.accessKeyId || !config.secretAccessKey) {
    throw new Error("缺少方舟私域虚拟人像 AK/SK：请配置 ARK_ASSETS_ACCESS_KEY_ID 和 ARK_ASSETS_SECRET_ACCESS_KEY。");
  }
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("ARK_ASSETS_ENDPOINT 必须使用 HTTPS。");
  const query = [
    ["Action", compactLine(action)],
    ["Version", config.version],
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${awsUriEncode(key)}=${awsUriEncode(value)}`)
    .join("&");
  const body = JSON.stringify(payload);
  const payloadHash = sha256Hex(body);
  const now = overrides.now instanceof Date ? overrides.now : new Date();
  const requestDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = requestDate.slice(0, 8);
  const signedHeaders = "host;x-content-sha256;x-date";
  const canonicalHeaders = `host:${endpoint.host}\nx-content-sha256:${payloadHash}\nx-date:${requestDate}\n`;
  const canonicalRequest = ["POST", "/", query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${shortDate}/${config.region}/${config.service}/request`;
  const stringToSign = ["HMAC-SHA256", requestDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(config.secretAccessKey, shortDate);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, config.service);
  const kSigning = hmac(kService, "request");
  const signature = hmac(kSigning, stringToSign, "hex");
  return {
    url: `${config.endpoint}/?${query}`,
    body,
    headers: {
      Authorization: `HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": "application/json",
      Host: endpoint.host,
      "X-Content-Sha256": payloadHash,
      "X-Date": requestDate,
    },
  };
}

function normalizeArkVirtualPersonAsset(raw = {}) {
  const result = raw.Result || raw.result || raw.Data || raw.data || raw;
  const assetId = compactLine(result.Id || result.AssetId || result.asset_id || result.id || "");
  const rawStatus = compactLine(
    result.Status || result.status || result.AssetStatus || result.asset_status || result.State || result.state || (assetId ? "Processing" : ""),
  );
  const normalizedStatus = rawStatus.toLowerCase();
  const status = /^(active|ready|completed|success|succeeded|enabled)$/.test(normalizedStatus)
    ? "active"
    : /^(failed|failure|rejected|denied|error|disabled)$/.test(normalizedStatus)
      ? "failed"
      : "processing";
  const error = compactLine(
    result.Error?.Message ||
      result.Error?.message ||
      result.error?.Message ||
      result.error?.message ||
      result.FailedReason ||
      result.failed_reason ||
      result.Message ||
      result.message ||
      "",
  );
  return {
    assetId,
    assetUrl: assetId ? `asset://${assetId}` : "",
    groupId: compactLine(result.GroupId || result.group_id || ""),
    status,
    error,
  };
}

async function callArkAssetOpenApi(action, payload = {}, options = {}) {
  const request = buildArkAssetOpenApiRequest(action, payload, options.config || {});
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  const apiError = data.ResponseMetadata?.Error || data.responseMetadata?.error || data.Error || data.error;
  if (!response.ok || apiError) {
    const message = compactLine(apiError?.Message || apiError?.message || data.message || `HTTP ${response.status}`);
    throw new Error(`方舟私域虚拟人像接口失败：${message}`);
  }
  return data;
}

async function createArkVirtualPersonAsset(body = {}, options = {}) {
  const asset = body.asset && typeof body.asset === "object" ? body.asset : body;
  const manualCertification = asset.manualCertification === true;
  if (!manualCertification && !isArkPersonEligibleAsset(asset)) {
    throw new Error("仅支持 AI 生成的写实或角色类图片认证为私域虚拟人像。");
  }
  if (asset.mediaType === "video" || /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(compactLine(asset.url || asset.name || ""))) {
    throw new Error("私域虚拟人像认证仅支持图片。");
  }
  const config = arkVirtualPersonConfig(options.config || {});
  if (!config.groupId) throw new Error("缺少私域虚拟人像素材组 ID：请配置 ARK_VIRTUAL_PERSON_GROUP_ID。");
  const publicAsset = await (options.publicize || canvasAssetToPublicUrl)(asset, 0);
  const publicUrl = compactLine(publicAsset?.url || "");
  if (!/^https:\/\//i.test(publicUrl)) throw new Error("图片尚未获得公网 HTTPS 地址，无法提交方舟认证。");
  const raw = await callArkAssetOpenApi(
    "CreateAsset",
    {
      GroupId: config.groupId,
      URL: publicUrl,
      AssetType: "Image",
      Name: canvasAssetName(asset, 0),
      ProjectName: config.projectName,
    },
    { ...options, config },
  );
  const result = normalizeArkVirtualPersonAsset(raw);
  if (!result.assetId) throw new Error("方舟 CreateAsset 未返回素材 ID。");
  return { ...result, groupId: result.groupId || config.groupId, publicUrl };
}

async function getArkVirtualPersonAsset(assetId, options = {}) {
  const cleanAssetId = compactLine(assetId || "");
  if (!cleanAssetId) throw new Error("缺少待查询的方舟素材 ID。");
  const config = arkVirtualPersonConfig(options.config || {});
  const raw = await callArkAssetOpenApi("GetAsset", { Id: cleanAssetId, ProjectName: config.projectName }, { ...options, config });
  const result = normalizeArkVirtualPersonAsset(raw);
  return { ...result, assetId: result.assetId || cleanAssetId, assetUrl: `asset://${result.assetId || cleanAssetId}` };
}

async function uploadPublicAssetToS3({ buffer, mime, fileName }) {
  const config = publicAssetStorageConfig();
  if (!config) return null;
  const endpoint = new URL(config.endpoint);
  const objectKey = [config.prefix, fileName].filter(Boolean).join("/");
  const host = config.forcePathStyle
    ? endpoint.host
    : `${config.bucket}.${endpoint.host}`;
  const canonicalUri = config.forcePathStyle
    ? `/${awsUriEncode(config.bucket)}/${objectKey.split("/").map(awsUriEncode).join("/")}`
    : `/${objectKey.split("/").map(awsUriEncode).join("/")}`;
  const uploadUrl = `${endpoint.protocol}//${host}${canonicalUri}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(buffer);
  const canonicalHeaders =
    `content-type:${mime}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": mime,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body: buffer,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    appendVideoApiLog({
      provider: "public-asset-s3",
      method: "PUT",
      url: uploadUrl,
      status: response.status,
      message: text.slice(0, 500) || `对象存储上传失败 ${response.status}`,
    });
    throw new Error(`对象存储上传失败：HTTP ${response.status}`);
  }
  return objectPublicUrl(config.publicBaseUrl, objectKey);
}

function decodeDataImageUrl(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  return {
    mime,
    ext,
    buffer: Buffer.from(match[2], "base64"),
  };
}

function decodeDataVideoUrl(dataUrl = "") {
  const match = String(dataUrl || "").match(/^data:(video\/(?:mp4|quicktime|webm|x-m4v));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = mime === "video/webm" ? ".webm" : mime === "video/quicktime" ? ".mov" : mime === "video/x-m4v" ? ".m4v" : ".mp4";
  return { mime, ext, buffer: Buffer.from(match[2], "base64") };
}

// 上传视频:落盘到本地 + 传对象存储拿公网 HTTPS 地址(和图片同一条路径),
// 这样视频既能本地播放,又能作为视频参考被远端模型抓取。
async function createCanvasVideoAsset(body = {}) {
  const decoded = decodeDataVideoUrl(body.dataUrl || body.data_url || "");
  if (!decoded) throw new Error("当前只支持 MP4/MOV/WEBM 的 dataURL 视频上传。");
  if (decoded.buffer.length > 60 * 1024 * 1024) throw new Error("视频超过 60MB，请压缩后再上传。");
  const localUrl = persistDecodedPublicAsset(decoded, body.name || "canvas-video");
  const fileName = decodeURIComponent(localUrl.replace(/^\/public-assets\/+/, ""));
  const videoFile = path.join(CANVAS_PUBLIC_ASSET_DIR, fileName);
  const storageUrl = await uploadPublicAssetToS3({ buffer: decoded.buffer, mime: decoded.mime, fileName });
  const baseUrl = publicAssetBaseUrl();
  const hasPublicBaseUrl = !!baseUrl && /^https:\/\//i.test(baseUrl);
  const publicUrl = storageUrl || (hasPublicBaseUrl ? `${baseUrl}${localUrl}` : "");
  return {
    videoUrl: publicUrl || `/media?path=${encodeURIComponent(videoFile)}`,
    videoLocalUrl: localUrl,
    publicUrl,
    frameUrl: "",
    previewUrl: "",
    fileName,
    size: decoded.buffer.length,
    mime: decoded.mime,
    publicReady: !!publicUrl,
    message: publicUrl ? "视频已保存并生成公网地址" : "视频已保存到本地(缺对象存储配置,远端模型可能抓不到)",
  };
}

async function createPublicCanvasAsset(body = {}) {
  const decoded = decodeDataImageUrl(body.dataUrl || body.data_url || "");
  if (!decoded) throw new Error("当前只支持 PNG/JPG/WEBP 的 dataURL 图片上传。");
  if (decoded.buffer.length > 30 * 1024 * 1024) throw new Error("图片超过 30MB，请压缩后重试。");
  const localUrl = persistDecodedPublicAsset(decoded, body.name || "portrait");
  const fileName = decodeURIComponent(localUrl.replace(/^\/public-assets\/+/, ""));
  const localOnly = body.localOnly === true;
  const storageUrl = localOnly
    ? null
    : await uploadPublicAssetToS3({ buffer: decoded.buffer, mime: decoded.mime, fileName });
  const baseUrl = publicAssetBaseUrl();
  const hasPublicBaseUrl = !!baseUrl && /^https:\/\//i.test(baseUrl);
  const publicUrl = localOnly ? "" : storageUrl || (hasPublicBaseUrl ? `${baseUrl}${localUrl}` : "");
  return {
    url: publicUrl,
    localUrl,
    fileName,
    size: decoded.buffer.length,
    mime: decoded.mime,
    publicReady: !!publicUrl,
    message: localOnly
      ? "图片已快速保存到本地预览地址"
      : publicUrl
        ? "已生成公网 HTTPS 素材地址"
        : "图片已保存到本地预览地址，但还缺少 PUBLIC_ASSET_BASE_URL 或对象存储配置，远端服务暂不能抓取这张图。",
  };
}

function publicAssetLibraryRecord(record = {}) {
  if (!record || typeof record !== "object") return null;
  const { ownerUserId, teamId, ...publicRecord } = record;
  const localSource = teamId
    ? localPathForAssetLibraryUrl(record.localUrl || record.url || record.previewUrl || "")
    : "";
  const teamMediaUrl = localSource
    ? `/api/team/asset-library/${encodeURIComponent(record.id)}/media?v=${encodeURIComponent(compactLine(record.updatedAt || ""))}`
    : "";
  return {
    ...publicRecord,
    ...(teamMediaUrl ? { url: teamMediaUrl, previewUrl: teamMediaUrl, localUrl: "" } : {}),
    scope: teamId ? "team" : "personal",
  };
}

function assetLibraryUserId(req) {
  const user = currentUserFromRequest(req);
  if (!user?.id) throw new Error("未登录，无法访问素材库");
  return user.id;
}

async function saveAssetToLibrary(body = {}, userId = "") {
  const input = body.asset && typeof body.asset === "object" ? { ...body.asset, ...body } : { ...body };
  // 普通素材库写入始终是个人资产；团队共享由项目转换流程在服务端受控建立。
  delete input.ownerUserId;
  delete input.teamId;
  delete input.sharedTeamId;
  let url = compactLine(input.url || input.publicUrl || input.previewUrl || "");
  let localUrl = compactLine(input.localUrl || "");
  if (isDataImageUrl(input.dataUrl || input.data_url || "")) {
    const publicAsset = await createPublicCanvasAsset({
      name: input.name || input.assetName || "library-asset",
      dataUrl: input.dataUrl || input.data_url,
    });
    url = publicAsset.url || publicAsset.localUrl || url;
    localUrl = publicAsset.localUrl || localUrl;
  }
  if (!url) throw new Error("素材库资产缺少图片地址");
  const record = assetLibrary.upsert({
    ...input,
    url,
    localUrl,
    previewUrl: input.previewUrl || localUrl || url,
  }, { userId });
  return publicAssetLibraryRecord(record);
}

function localPathForAssetLibraryUrl(url = "") {
  const clean = compactLine(url);
  return localPublicAssetPathFromUrl(clean) || localMediaPathFromUrl(clean) || localFilePathFromUrl(clean) || "";
}

function localTeamAssetLibraryPathFromUrl(url = "") {
  const match = compactLine(url).match(/^\/api\/team\/asset-library\/([^/]+)\/media(?:\?|$)/);
  if (!match) return "";
  const record = assetLibrary.get(decodeURIComponent(match[1]));
  return record?.teamId ? localPathForAssetLibraryUrl(record.localUrl || record.url || record.previewUrl || "") : "";
}

async function assetLibraryImageBuffer(record = {}) {
  const local = localPathForAssetLibraryUrl(record.localUrl || record.url || record.previewUrl || "");
  if (local && fs.existsSync(local)) {
    return { buffer: fs.readFileSync(local), mime: MIME[path.extname(local).toLowerCase()] || "image/png", name: record.name || path.basename(local) };
  }
  const url = compactLine(record.url || record.previewUrl || "");
  if (!/^https?:\/\//i.test(url)) throw new Error("素材库图片地址不可读取");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取素材库图片失败：HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "image/png").split(";", 1)[0].toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("素材库记录不是图片");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error("素材库图片超过 30MB");
  return { buffer, mime: contentType, name: record.name || "library-asset" };
}

async function importAssetLibraryAsset(episodeRoot, body = {}, userId = "") {
  const libraryId = compactLine(body.libraryId || body.id || "");
  if (!libraryId) throw new Error("缺少素材库资产 ID");
  const membership = teamMembershipForUser(userId);
  const record = assetLibrary.get(libraryId, { userId, teamId: membership?.teamId || "" });
  if (!record) throw new Error("素材库资产不存在或无权访问");
  let assetId = safeManifestAssetId(body.assetId || "");
  let added = null;
  if (!assetId) {
    const requestedType = compactLine(record.type || "");
    const type = ["Character", "Scene", "Prop", "Insert"].includes(requestedType) ? requestedType : "Prop";
    added = addManualAsset(episodeRoot, {
      type,
      label: record.name,
      description: record.prompt || `从素材库导入：${record.name}`,
      evidence: "从网站素材库导入",
      generate: false,
    });
    assetId = added.asset.id;
  }
  const source = await assetLibraryImageBuffer(record);
  const upload = uploadBoundAsset(episodeRoot, {
    assetId,
    filename: source.name,
    contentBase64: source.buffer.toString("base64"),
  });
  return {
    libraryAsset: publicAssetLibraryRecord(record),
    asset: upload.asset,
    manifestItem: upload.manifestItem,
    added: !!added,
    replaced: !!upload.replaced,
    message: `${upload.replaced ? "已替换" : "已添加"}项目资产：${assetId}`,
  };
}

function canvasAssetName(asset = {}, index = 0) {
  return safeSlug(path.basename(compactLine(asset.name || asset.id || `asset-${index + 1}`), path.extname(compactLine(asset.name || ""))), `asset-${index + 1}`).slice(0, 64);
}

function isCanvasPhotorealAsset(asset = {}) {
  const preset = compactLine(asset.assetStylePreset || asset.stylePreset || "").toLowerCase();
  const label = compactLine(asset.assetStyleLabel || asset.styleLabel || "");
  return preset === "photoreal" || /超写实|photoreal|photo-real|hyperreal|hyper-real/i.test(label);
}

// AI 生成判定(不含画风约束):供“放宽到角色类”复用。
function isCanvasAiGeneratedAsset(asset = {}) {
  if (asset.aiGenerated === true || compactLine(asset.verificationType || asset.verification_type) === "ai-generated") return true;
  const source = `${asset.source || ""} ${asset.generationMode || asset.generation_mode || ""}`;
  return /canvas-image|image-generation|ai[-_ ]?generated|gpt[-_ ]?image/i.test(source);
}

function isCanvasAiGeneratedPhotorealAsset(asset = {}) {
  if (!isCanvasPhotorealAsset(asset)) return false;
  return isCanvasAiGeneratedAsset(asset);
}

// 角色类参考判定(按声明类型或命名 C\d{3}_ / _CHARACTER_SHEET)。用于放宽“进人像库”的画风限制:
// 被平台误判真人的风格化角色也应能走人像库认证成 asset://,而道具/场景不纳入。
function isCharacterRefAsset(asset = {}) {
  const declared = compactLine(asset.manifestType || asset.assetType || "");
  if (/^Character$/i.test(declared)) return true;
  const name = compactLine(asset.name || asset.assetName || "");
  return name ? inferAssetTypeFromName(name) === "Character" : false;
}

// 进人像库资格:超写实(AI 生成),或 AI 生成的角色类素材。保留“AI 生成”硬约束以挡掉手动导入图;
// 角色约束挡掉道具/场景。批量链路认证阶段会强制 aiGenerated,画布手动认证走此判据防误收。
function isArkPersonEligibleAsset(asset = {}) {
  if (isCanvasAiGeneratedPhotorealAsset(asset)) return true;
  return isCharacterRefAsset(asset) && isCanvasAiGeneratedAsset(asset);
}

function isArkPersonTargetModel(value = "") {
  return ARK_PERSON_TARGET_MODELS.has(compactLine(value));
}

function arkPersonAssetUrl(asset = {}) {
  if (asset?.arkPersonAsset?.enabled !== true) return "";
  const url = compactLine(asset.arkPersonAsset.assetUrl || "");
  return /^asset:\/\//i.test(url) ? url : "";
}

function arkPersonAssetReadyUrl(asset = {}) {
  const status = compactLine(asset?.arkPersonAsset?.status || "").toLowerCase();
  const url = arkPersonAssetUrl(asset);
  return status === "active" ? url : "";
}

function isArkPersonReferenceAsset(asset = {}) {
  const rawType = compactLine(asset.manifestType || asset.assetType || asset.type || "");
  if (/character|person|真人|人物|角色/i.test(rawType)) return true;
  if (!isCanvasPhotorealAsset(asset)) return false;
  // Explicit scene/prop/insert assets are ordinary visual references, even when rendered photorealistically.
  if (rawType && /scene|environment|location|场景|环境|prop|object|item|道具|insert|插入/i.test(rawType)) return false;
  return true;
}

function assertArkPersonAssetsReady(body = {}) {
  const modelMode = compactLine(body.modelMode || body.model || "");
  if (!isArkPersonTargetModel(modelMode)) return;
  const sourceAssets = Array.isArray(body.assets) ? body.assets : [];
  const invalid = sourceAssets
    .filter((asset) => asset?.arkPersonAsset?.enabled === true)
    .filter((asset) => !arkPersonAssetReadyUrl(asset))
    .map((asset) => compactLine(asset.name || asset.id || "未命名真人素材"));
  if (invalid.length) throw new Error(`方舟私域虚拟人像未绑定有效 asset://：${invalid.join("、")}`);
  const missing = sourceAssets
    .filter((asset) => isArkPersonReferenceAsset(asset))
    .filter((asset) => !arkPersonAssetReadyUrl(asset))
    .map((asset) => compactLine(asset.name || asset.id || "未命名真人素材"));
  if (missing.length) {
    throw new Error(`真人/角色参考图必须先完成方舟私域虚拟人像认证并达到 active（asset://）：${missing.join("、")}`);
  }
}

function canvasVideoAssetSubmitUrl(asset = {}, { preferArkPersonAsset = false } = {}) {
  const arkPersonUrl = preferArkPersonAsset ? arkPersonAssetReadyUrl(asset) : "";
  if (arkPersonUrl) return arkPersonUrl;
  const assetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
  if (isCanvasPhotorealAsset(asset)) {
    return compactLine(asset.publicUrl || asset.public_url || asset.url || asset.previewUrl || asset.localUrl || asset.localAssetUrl || "");
  }
  return compactLine(asset.publicUrl || asset.public_url || asset.url || asset.previewUrl || asset.localUrl || asset.localAssetUrl || assetUrl);
}

function canvasVideoSubmitCapableAssets(assets = [], options = {}) {
  return (Array.isArray(assets) ? assets : [])
    .map((asset) => {
      const url = canvasVideoAssetSubmitUrl(asset, options);
      return url ? { ...asset, url } : null;
    })
    .filter(Boolean);
}

// 视频落盘+S3 的结果映射成 canvasAssetToPublicUrl 的统一形状({url,...})。
async function canvasVideoToPublicUrlShape(params = {}) {
  const r = await createCanvasVideoAsset(params);
  return {
    url: compactLine(r.publicUrl || r.videoUrl || ""),
    localUrl: compactLine(r.videoLocalUrl || ""),
    publicReady: !!r.publicReady,
    message: r.message || "",
  };
}

// 把一个本地文件(图片或视频)变成公网地址。视频不能走图片解码,单独走视频落盘+S3。
async function localAssetFileToPublicUrl(localFile, name = "") {
  const ext = path.extname(localFile).toLowerCase();
  if (/^\.(mp4|mov|webm|m4v)$/i.test(ext)) {
    return canvasVideoToPublicUrlShape({ name: name || path.basename(localFile), dataUrl: fileToDataUrl(localFile) });
  }
  return createPublicCanvasAsset({ name: name || path.basename(localFile), dataUrl: fileToDataUrl(localFile) });
}

function canvasAssetSourceCandidates(asset = {}) {
  const values = [
    asset.publicUrl,
    asset.public_url,
    asset.url,
    asset.previewUrl,
    asset.preview_url,
    asset.localUrl,
    asset.local_url,
    asset.localAssetUrl,
    asset.local_asset_url,
    asset.dataUrl,
    asset.data_url,
  ];
  const unique = [];
  const seen = new Set();
  for (const value of values) {
    const candidate = compactLine(value);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    unique.push(candidate);
  }
  const rank = (value) => {
    if (/^asset:\/\//i.test(value)) return 0;
    if (/^https:\/\//i.test(value)) return 1;
    if (/^data:(?:image|video)\//i.test(value)) return 2;
    if (/^(?:\/|file:\/\/)/i.test(value)) return 3;
    if (/^http:\/\//i.test(value)) return 4;
    return 5;
  };
  return unique
    .map((value, index) => ({ value, index, rank: rank(value) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ value }) => value);
}

async function canvasAssetToPublicUrl(asset = {}, index = 0) {
  const candidates = canvasAssetSourceCandidates(asset);
  let sawHttp = false;
  for (const raw of candidates) {
    if (/^https:\/\//i.test(raw)) {
      return { url: raw, localUrl: compactLine(asset.previewUrl || asset.localUrl || ""), publicReady: true, message: "已是公网 HTTPS 地址" };
    }
    if (/^asset:\/\//i.test(raw)) {
      return { url: raw, localUrl: compactLine(asset.previewUrl || asset.localUrl || ""), publicReady: true, message: "已是 asset:// 素材" };
    }
    if (/^data:image\//i.test(raw)) return createPublicCanvasAsset({ name: asset.name || `asset-${index + 1}.png`, dataUrl: raw });
    if (/^data:video\//i.test(raw)) return canvasVideoToPublicUrlShape({ name: asset.name || `asset-${index + 1}.mp4`, dataUrl: raw });
    const localFile = localMediaPathFromUrl(raw);
    if (localFile) return localAssetFileToPublicUrl(localFile, asset.name);
    const localUrlFile = localFilePathFromUrl(raw);
    if (localUrlFile) return localAssetFileToPublicUrl(localUrlFile, asset.name);
    const localPublicAsset = localPublicAssetPathFromUrl(raw);
    if (localPublicAsset) return localAssetFileToPublicUrl(localPublicAsset, asset.name);
    if (/^http:\/\//i.test(raw)) sawHttp = true;
  }
  if (sawHttp) throw new Error("Gravitex 素材库只接受 HTTPS 图片地址");
  throw new Error("无法生成公网 HTTPS 素材地址");
}

async function createOrReuseCanvasAssetGroup(body = {}) {
  const groupId = compactLine(body.groupId || body.group_id || "");
  if (groupId) {
    return {
      group_id: groupId,
      name: compactLine(body.name || "超写实素材组"),
      description: compactLine(body.description || ""),
      channel_id: compactLine(body.channelId || body.channel_id || ""),
      group_type: "aigc",
      reused: true,
    };
  }
  return createGravitexAigcAssetGroup({
    name: body.name || "超写实素材组",
    description: body.description || "Pixel Toys photoreal asset references",
    channelId: body.channelId || body.channel_id || "",
  });
}

async function validateCanvasPhotorealAssets(body = {}) {
  const inputAssets = Array.isArray(body.assets) ? body.assets.slice(0, 100) : [];
  if (!inputAssets.length) return { group: null, assets: [], summary: { total: 0, active: 0, pending: 0, failed: 0, skipped: 0 } };
  const group = await createOrReuseCanvasAssetGroup({
    groupId: body.groupId || body.group_id || "",
    name: body.name || "超写实素材组",
    description: body.description || "",
    channelId: body.channelId || body.channel_id || "",
  });
  const groupId = compactLine(group.group_id || group.groupId || "");
  if (!groupId) throw new Error("素材组创建失败：未返回 group_id");
  const outputs = [];
  for (let index = 0; index < inputAssets.length; index += 1) {
    const asset = inputAssets[index] || {};
    const id = compactLine(asset.id || `asset-${index + 1}`);
    try {
      const existingAssetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
      const hasExistingAssetUrl = /^asset:\/\//i.test(existingAssetUrl);
      if (hasExistingAssetUrl) {
        const refreshed = await refreshKnownGravitexAsset(groupId, {
          ...asset,
          id,
          assetUrl: existingAssetUrl,
          name: canvasAssetName(asset, index),
        });
        const refreshedStatus = compactLine(refreshed?.status || asset.validationStatus || "pending");
        outputs.push({
          ...asset,
          id,
          groupId,
          assetUrl: refreshed?.assetUrl || existingAssetUrl,
          virtualId: refreshed?.virtualId || asset.virtualId || "",
          validationStatus: refreshedStatus,
          validationError: refreshed?.errorMessage || "",
          message: refreshed?.errorMessage || (refreshedStatus.toLowerCase() === "active" ? "素材已 active" : "素材仍在处理中"),
        });
        continue;
      }
      const publicAsset = await canvasAssetToPublicUrl(asset, index);
      const publicUrl = compactLine(publicAsset.url || "");
      if (/^asset:\/\//i.test(publicUrl)) {
        outputs.push({ ...asset, id, groupId, assetUrl: publicUrl, publicUrl, validationStatus: "active", message: "已是 asset:// 素材" });
        continue;
      }
      if (!/^https:\/\//i.test(publicUrl)) throw new Error(publicAsset.message || "缺少公网 HTTPS 地址");
      const result = await createOrRefreshGravitexAsset({
        groupId,
        url: publicUrl,
        name: canvasAssetName(asset, index),
      });
      outputs.push({
        ...asset,
        id,
        groupId,
        publicUrl,
        localAssetUrl: publicAsset.localUrl || "",
        assetUrl: result.assetUrl || "",
        virtualId: result.virtualId || "",
        validationStatus: result.assetUrl && String(result.status || "").toLowerCase() === "active" ? "active" : result.status || "pending",
        validationError: "",
        message: result.message || "素材已提交",
      });
    } catch (error) {
      outputs.push({
        ...asset,
        id,
        groupId,
        validationStatus: "failed",
        validationError: error.message || "素材验证失败",
        message: error.message || "素材验证失败",
      });
    }
  }
  const summary = outputs.reduce(
    (acc, asset) => {
      acc.total += 1;
      const status = String(asset.validationStatus || "").toLowerCase();
      if (status === "active") acc.active += 1;
      else if (status === "failed") acc.failed += 1;
      else if (status === "skipped") acc.skipped += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, active: 0, pending: 0, failed: 0, skipped: 0 },
  );
  return { group, assets: outputs, summary };
}

// 非人物轨:确保资产有稳定公网 https 地址(Ark 可快速抓取,避免临时转公网超时)。
// 已有 https 公网地址则原样返回;否则用现有图源(publicUrl/url/previewUrl/磁盘)预上传公网。不注册素材库、不轮询 active。
async function ensurePublicReferenceUrl(asset = {}) {
  const existing = compactLine(asset.publicUrl || asset.public_url || "");
  if (/^https:\/\//i.test(existing)) return { ...asset, publicUrl: existing, publicReady: true };
  const source = compactLine(asset.publicUrl || asset.url || asset.previewUrl || "");
  try {
    const resolved = await canvasAssetToPublicUrl({ ...asset, url: source }, 0);
    const url = compactLine(resolved.url || "");
    if (/^https:\/\//i.test(url)) return { ...asset, publicUrl: url, publicReady: true };
    return { ...asset, publicReady: false, publicError: resolved.message || "无法生成公网地址" };
  } catch (error) {
    // canvasAssetToPublicUrl 失败会 throw;这里兜住,让阶段0 把它计入卡住清单而不是让整批崩掉。
    return { ...asset, publicReady: false, publicError: compactLine(error?.message || "无法生成公网地址") };
  }
}

async function assetUrlToReferenceUrl(url, { allowAssetUrl = false } = {}) {
  const raw = compactLine(url);
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) {
    const publicAsset = await createPublicCanvasAsset({ name: "reference-image.png", dataUrl: raw });
    return publicAsset.url || raw;
  }
  if (/^data:video\//i.test(raw)) {
    const shaped = await canvasVideoToPublicUrlShape({ name: "reference-video.mp4", dataUrl: raw });
    return shaped.url || "";
  }
  // 本地文件:视频单独走视频落盘+S3(不能被当图片解码),图片保持原有逻辑。
  const isVideoFile = (f) => /\.(mp4|mov|webm|m4v)$/i.test(f || "");
  const localFile = localMediaPathFromUrl(raw);
  if (localFile) {
    if (isVideoFile(localFile)) return (await localAssetFileToPublicUrl(localFile)).url || "";
    const publicAsset = await createPublicCanvasAsset({ name: path.basename(localFile), dataUrl: fileToDataUrl(localFile) });
    return publicAsset.url || fileToDataUrl(localFile);
  }
  const localUrlFile = localFilePathFromUrl(raw);
  if (localUrlFile) {
    if (isVideoFile(localUrlFile)) return (await localAssetFileToPublicUrl(localUrlFile)).url || "";
    const publicAsset = await createPublicCanvasAsset({ name: path.basename(localUrlFile), dataUrl: fileToDataUrl(localUrlFile) });
    return publicAsset.url || fileToDataUrl(localUrlFile);
  }
  const localPublicAsset = localPublicAssetPathFromUrl(raw);
  if (localPublicAsset) {
    if (isVideoFile(localPublicAsset)) return (await localAssetFileToPublicUrl(localPublicAsset)).url || "";
    const publicAsset = await createPublicCanvasAsset({ name: path.basename(localPublicAsset), dataUrl: fileToDataUrl(localPublicAsset) });
    return publicAsset.url || fileToDataUrl(localPublicAsset);
  }
  if (/^https?:\/\//i.test(raw)) return publicRemoteAssetUrl(raw);
  if (/^asset:\/\//i.test(raw)) return allowAssetUrl ? raw : "";
  return "";
}

function gravitexAssetContentFromUrl(url, role = "reference_image") {
  const raw = compactLine(url);
  if (!raw) return null;
  const type = /\.(mp4|mov|webm|m4v)(?:\?|#|$)/i.test(raw) ? "video_url" : /\.(mp3|wav)(?:\?|#|$)/i.test(raw) ? "audio_url" : "image_url";
  if (type === "video_url") return { type, video_url: { url: raw }, role: "reference_video" };
  if (type === "audio_url") return { type, audio_url: { url: raw }, role: "reference_audio" };
  return { type, image_url: { url: raw }, role };
}

function assertSeedanceReferenceBudget({ startFrameUrl = "", firstFrameUrl = "", lastFrameUrl = "", assets = [], livenessAssetUrl = "", maxImages = SEEDANCE_MAX_IMAGE_REFERENCES } = {}) {
  const required =
    (compactLine(startFrameUrl) ? 1 : 0) +
    (compactLine(firstFrameUrl) ? 1 : 0) +
    (compactLine(lastFrameUrl) ? 1 : 0) +
    (compactLine(livenessAssetUrl) ? 1 : 0) +
    (Array.isArray(assets) ? assets.length : 0);
  if (required > maxImages) {
    throw new Error(`参考图数量超出 Seedance 上限：帧控制 + 真人素材 + 本段图片共 ${required} 张，当前上限 ${maxImages} 张。请减少本段 refs，系统不会再静默丢图。`);
  }
  return required;
}

async function resolveSeedanceImageReferences(assets = [], maxImages = SEEDANCE_MAX_IMAGE_REFERENCES, options = {}) {
  const references = [];
  const required = options.required === true;
  const sourceAssets = Array.isArray(assets) ? assets : [];
  if (maxImages < 0) {
    throw new Error(`参考图数量超出 Seedance 上限：当前剩余上限 ${maxImages} 张。`);
  }
  if (sourceAssets.length > maxImages) {
    throw new Error(`参考图数量超出 Seedance 上限：本段图片 ${sourceAssets.length} 张，当前剩余上限 ${maxImages} 张。`);
  }
  for (const asset of sourceAssets) {
    const arkPersonUrl = options.preferArkPersonAsset ? arkPersonAssetReadyUrl(asset) : "";
    const assetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
    const sourceUrl = options.allowAssetUrl && (arkPersonUrl || assetUrl)
      ? arkPersonUrl || assetUrl
      : asset.publicUrl || asset.public_url || asset.url || asset.previewUrl;
    const referenceUrl = await assetUrlToReferenceUrl(sourceUrl, options);
    if (!referenceUrl) {
      if (required) throw new Error(`参考图无法解析，已拦截提交：${asset.name || asset.id || "未命名资产"}`);
      continue;
    }
    references.push({
      asset,
      url: referenceUrl,
      ref: `@图片${references.length + 1}`,
    });
  }
  return references;
}

function assertResolvedAllSeedanceReferences({ provider = "Seedance", startFrameUrl = "", startFrameReferenceUrl = "", firstFrameUrl = "", firstFrameReferenceUrl = "", lastFrameUrl = "", lastFrameReferenceUrl = "", assets = [], imageReferences = [], livenessAssetUrl = "", mediaReferences = [] } = {}) {
  const sourceAssets = Array.isArray(assets) ? assets : [];
  const hasStartFrame = !!compactLine(startFrameUrl);
  const hasResolvedStartFrame = !!compactLine(startFrameReferenceUrl);
  const hasFirstFrame = !!compactLine(firstFrameUrl);
  const hasResolvedFirstFrame = !!compactLine(firstFrameReferenceUrl);
  const hasLastFrame = !!compactLine(lastFrameUrl);
  const hasResolvedLastFrame = !!compactLine(lastFrameReferenceUrl);
  const hasLiveness = !!compactLine(livenessAssetUrl);
  if (hasStartFrame && !hasResolvedStartFrame) {
    throw new Error(`${provider} 提交已拦截：上一段尾帧无法解析为可提交图片引用。`);
  }
  if (hasFirstFrame && !hasResolvedFirstFrame) throw new Error(`${provider} 提交已拦截：首帧无法解析为可提交图片引用。`);
  if (hasLastFrame && !hasResolvedLastFrame) throw new Error(`${provider} 提交已拦截：尾帧无法解析为可提交图片引用。`);
  if (sourceAssets.length !== imageReferences.length) {
    const resolvedNames = new Set(imageReferences.map((reference) => compactLine(reference.asset?.name || reference.asset?.id || "")));
    const missing = sourceAssets
      .filter((asset) => !resolvedNames.has(compactLine(asset?.name || asset?.id || "")))
      .map((asset) => compactLine(asset?.name || asset?.id || "未命名资产"));
    throw new Error(`${provider} 提交已拦截：本段要求 ${sourceAssets.length} 张参考图，但只解析到 ${imageReferences.length} 张。${missing.length ? `缺失：${missing.join("、")}` : ""}`);
  }
  const expected = (hasResolvedStartFrame ? 1 : 0) + (hasResolvedFirstFrame ? 1 : 0) + (hasResolvedLastFrame ? 1 : 0) + (hasLiveness ? 1 : 0) + imageReferences.length;
  if (Array.isArray(mediaReferences) && mediaReferences.length !== expected) {
    throw new Error(`${provider} 提交已拦截：参考图装配数量不一致，要求 ${expected} 张，实际 ${mediaReferences.length} 张。`);
  }
}

function seedanceReferenceUsage(asset = {}) {
  const type = compactLine(asset.type || "");
  if (/角色|人物|character|person|liveness/i.test(type)) return "作为人物形象、服装和身份一致性参考";
  if (/场景|环境|scene|location|background/i.test(type)) return "作为场景、背景和空间氛围参考";
  if (/道具|产品|prop|product/i.test(type)) return "作为道具或产品外观细节参考";
  if (/storyboard|故事板|分镜/i.test(type)) return "作为分镜、景别和构图参考";
  return "作为视觉风格、主体外观和画面连续性参考";
}

function seedanceAssetPromptSuffix(references = []) {
  const lines = references
    .map((reference, index) => {
      const asset = reference.asset || {};
      const ref = reference.ref || `@图片${index + 1}`;
      const label = compactLine([asset.name || asset.id || `参考图${index + 1}`, asset.type].filter(Boolean).join(" / "));
      return `${ref} 是「${label}」，${seedanceReferenceUsage(asset)}。`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return `\n\n参考图像说明：\n${lines.join("\n")}`;
}

function seedanceAssetIdentityFallbackText(assets = []) {
  const lines = [];
  for (const asset of Array.isArray(assets) ? assets : []) {
    const type = assetTypeForLookupRecord(asset, asset.name || asset.id || "");
    if (!["Character", "Scene", "Prop", "Insert"].includes(type)) continue;
    const name = compactLine(asset.name || asset.id || "");
    if (!name) continue;
    const label = compactLine(asset.label || asset.assetLabel || name);
    const visual = compactLine(asset.visual || asset.description || "");
    const evidence = compactLine(asset.evidence || "");
    const body = [visual, evidence].filter(Boolean).join("；").slice(0, type === "Character" ? 420 : 220);
    if (type === "Character") {
      lines.push(`人物「${label}」来自资产「${name}」：${body || "保持该人物的脸型、发色、服装、体型、神态和身份一致。"}。`);
    } else if (type === "Scene") {
      lines.push(`场景「${label}」来自资产「${name}」：${body || "保持该地点的空间结构、材质、光线方向和环境氛围一致。"}。`);
    } else if (type === "Prop" || type === "Insert") {
      lines.push(`道具/细节「${label}」来自资产「${name}」：${body || "保持该物件外观、材质和关键互动一致。"}。`);
    }
    if (lines.length >= 6) break;
  }
  if (!lines.length) return "";
  return `\n\n已确认资产设定（首帧模式下作为文本身份锁定）：\n${lines.join("\n")}`;
}

function promptSections(prompt = "") {
  const text = String(prompt || "").replace(/\r\n/g, "\n").trim();
  const headings = [
    "剧情动作",
    "核心画面",
    "剧情与镜头",
    "剧情",
    "图片参考",
    "参考图像说明",
    "镜头语言",
    "镜头切换",
    "IMAX胶片相机设定",
    "IMAX",
    "光影描述",
    "时间轴",
    "动作/表演",
    "动作",
    "对白",
    "声音",
    "音效",
  ];
  const pattern = new RegExp(`(?:^|\\n\\n)(${headings.join("|")})[：:]\\s*`, "g");
  const matches = [...text.matchAll(pattern)];
  const sections = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const body = text.slice(start, end).trim();
    if (body) sections.push({ title: match[1], body });
  }
  return sections;
}

function promptSectionMap(prompt = "") {
  const sections = new Map();
  for (const section of promptSections(prompt)) {
    if (!sections.has(section.title)) sections.set(section.title, section.body);
  }
  return sections;
}

function stripSeedanceMetaInstructions(value = "") {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/(?:严格按照|必须遵守|提示词规则|规则如下|不要混杂|不要添加|不得添加|只输出|输出格式|素材引用规则)/i.test(line))
    .join("\n")
    .replace(/\s*(?:严格按照|必须)\s*(?:以上|上述)?(?:描述|规则|要求)[，。；;]?\s*/g, "")
    .trim();
}

function stripVideoSceneHeadingPrefix(value = "") {
  let text = compactLine(value);
  if (!text) return "";
  text = text
    .replace(/^\s*\d+(?:[-－—]\d+)?\s+[^，。；：:\n]{1,60}[-－—](?:外|内|EXT\.?|INT\.?)\s*/i, "")
    .replace(/^\s*SHOT\s*\d+\s*[·•｜|:：-]\s*[^，。；\n]{1,90}[-－—]\s*/i, "")
    .replace(/^\s*(?:画面|动作|运镜|音效|视觉点|对白)\s*[：:]\s*/i, "")
    .replace(/^[。；;，,\s]+/, "")
    .trim();
  return text;
}

function normalizeVideoStoryBody(value = "") {
  let text = stripSeedanceMetaInstructions(value);
  const explicitBeat = text.match(/只演绎本段剧情\s*[：:]\s*([\s\S]*)$/);
  if (explicitBeat) text = explicitBeat[1];
  text = text
    .replace(/^(?:核心画面|剧情与镜头|剧情|剧情动作)\s*[：:]\s*/i, "")
    .replace(/^[•◦\-\s]*(?:对白|台词)\s*[：:]\s*[•◦\-\s]*/i, "")
    .replace(/^[•◦\-\s]+/, "")
    .trim();
  return stripVideoSceneHeadingPrefix(text);
}

function dedupePromptLines(value = "") {
  const seen = new Set();
  const lines = [];
  for (const rawLine of String(value || "").split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const key = line.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n").trim();
}

function normalizeTimelinePrompt(value = "") {
  const seenLabels = new Set();
  const lines = [];
  for (const rawLine of String(value || "").split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const label = line.match(/^(\d+\s*[-–—]\s*\d+\s*秒)\s*[：:]/)?.[1]?.replace(/\s+/g, "");
    if (label) {
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
    }
    const key = line.replace(/\s+/g, "");
    if (!label && lines.some((existing) => existing.replace(/\s+/g, "") === key)) continue;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

function canonicalPromptSectionTitle(title = "") {
  if (title === "核心画面" || title === "剧情与镜头" || title === "剧情") return "剧情动作";
  if (title === "IMAX") return "IMAX胶片相机设定";
  if (title === "音效") return "声音";
  return title;
}

function sanitizeSeedancePromptForPolicy(prompt = "") {
  let text = String(prompt || "");
  if (!text.trim()) return "";
  const replacements = [
    [/\bMate\s*Bond\b/gi, "灵魂契约"],
    [/\bAlpha\b/g, "族群首领"],
    [/\bOmega\b/g, "族群成员"],
    [/兽人学院/g, "幻想族群学院"],
    [/格雷沃尔夫/g, "格雷沃尔"],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  const policy = "原创虚构短剧设定，不模仿、不复刻任何现有影视、动漫、游戏、小说或品牌 IP";
  if (text.includes("原创虚构") || text.includes("品牌 IP")) return text.trim();
  if (/"style"\s*:\s*"/.test(text)) {
    return text.replace(/"style"\s*:\s*"/, `"style": "${policy}；`).trim();
  }
  return `${policy}。\n${text}`.trim();
}

function cleanSeedancePromptForSubmission(prompt = "") {
  const text = String(prompt || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  if (isSeedanceNaturalLanguageShotPrompt(text)) return sanitizeSeedancePromptForPolicy(text);
  const keepOrder = [
    "剧情动作",
    "镜头语言",
    "镜头切换",
    "IMAX胶片相机设定",
    "光影描述",
    "时间轴",
    "动作/表演",
    "对白",
    "声音",
  ];
  const kept = new Map();
  for (const section of promptSections(text)) {
    const title = canonicalPromptSectionTitle(section.title);
    if (title === "图片参考" || title === "参考图像说明") continue;
    if (!keepOrder.includes(title)) continue;
    let body = stripSeedanceMetaInstructions(section.body);
    if (title === "剧情动作") body = normalizeVideoStoryBody(body);
    if (title === "时间轴") body = normalizeTimelinePrompt(body);
    else body = dedupePromptLines(body);
    if (!body) continue;
    if (!kept.has(title)) kept.set(title, body);
    else if (title === "剧情动作") kept.set(title, dedupePromptLines(`${kept.get(title)}\n${body}`));
  }
  const fallback = stripSeedanceMetaInstructions(
    text
      .replace(/(?:^|\n\n)(?:图片参考|参考图像说明)[：:][\s\S]*?(?=\n\n(?:剧情动作|核心画面|剧情与镜头|剧情|镜头语言|镜头切换|IMAX[^：:]*|光影描述|时间轴|动作\/表演|动作|对白|声音|音效)[：:]|$)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
  const blocks = [];
  if (!kept.has("剧情动作") && fallback) kept.set("剧情动作", normalizeVideoStoryBody(fallback));
  for (const title of keepOrder) {
    const body = kept.get(title);
    if (!body) continue;
    blocks.push(`${title}：${body}`);
  }
  return sanitizeSeedancePromptForPolicy(blocks.join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function promptHasStoryContent(prompt = "") {
  const text = String(prompt || "");
  return isSeedanceNaturalLanguageShotPrompt(text) || /(?:剧情动作|核心画面|剧情与镜头|剧情)[：:]/.test(text);
}

function promptWithStoryboardGuidance(prompt = "", guidanceText = "") {
  const promptText = String(prompt || "").trim();
  const guidance = String(guidanceText || "").trim();
  if (!guidance) return promptText;
  return `${promptText}\n\n${guidance}`.trim();
}

async function buildSeedanceGenerationPayload(body = {}) {
  const prompt = cleanSeedancePromptForSubmission(body.prompt);
  if (!prompt) throw new Error("缺少视频提示词");
  const useArkPersonAssets = isArkPersonTargetModel(body.modelMode || body.model);
  assertArkPersonAssetsReady(body);
  const assets = canvasVideoSubmitCapableAssets(body.assets, { preferArkPersonAsset: useArkPersonAssets });
  const model = normalizeSeedanceModel(body.model, body.__provider);
  const frameControl = compactLine(body.frameControl || "reference");
  const firstFrameUrl = compactLine(body.firstFrameUrl || body.first_frame_url || "");
  const lastFrameUrl = compactLine(body.lastFrameUrl || body.last_frame_url || "");
  if (frameControl === "first_last" && (!firstFrameUrl || !lastFrameUrl)) {
    throw new Error("首尾帧模式必须同时选择首帧和尾帧图片。");
  }
  const startFrameUrl = frameControl === "first_last" ? "" : compactLine(body.startFrameUrl || body.start_frame_url || "");
  const startFrameReferenceUrl = startFrameUrl ? await assetUrlToReferenceUrl(startFrameUrl, { allowAssetUrl: true }) : "";
  const firstFrameReferenceUrl = firstFrameUrl ? await assetUrlToReferenceUrl(firstFrameUrl, { allowAssetUrl: true }) : "";
  const lastFrameReferenceUrl = lastFrameUrl ? await assetUrlToReferenceUrl(lastFrameUrl, { allowAssetUrl: true }) : "";
  assertSeedanceReferenceBudget({
    startFrameUrl: startFrameReferenceUrl || startFrameUrl,
    firstFrameUrl: firstFrameReferenceUrl || firstFrameUrl,
    lastFrameUrl: lastFrameReferenceUrl || lastFrameUrl,
    assets,
  });
  const frameCount = Number(!!startFrameReferenceUrl) + Number(!!firstFrameReferenceUrl) + Number(!!lastFrameReferenceUrl);
  const imageReferences = await resolveSeedanceImageReferences(
    assets,
    SEEDANCE_MAX_IMAGE_REFERENCES - frameCount,
    { allowAssetUrl: true, required: false, preferArkPersonAsset: useArkPersonAssets },
  );
  const resolvedAssets = imageReferences.map((reference) => reference.asset);
  const framePromptReferences = [
    ...(firstFrameReferenceUrl ? [{ asset: { name: "首帧", type: "FirstFrame" }, url: firstFrameReferenceUrl }] : []),
    ...(lastFrameReferenceUrl ? [{ asset: { name: "尾帧", type: "LastFrame" }, url: lastFrameReferenceUrl }] : []),
    ...(startFrameReferenceUrl ? [{ asset: { name: "上一段视频尾帧", type: "TailFrame" }, url: startFrameReferenceUrl }] : []),
  ];
  const promptReferences = [
    ...framePromptReferences,
    ...imageReferences,
  ].map((reference, index) => ({ ...reference, ref: `@图片${index + 1}` }));
  const mediaReferences = [
    ...(firstFrameReferenceUrl ? [firstFrameReferenceUrl] : []),
    ...(lastFrameReferenceUrl ? [lastFrameReferenceUrl] : []),
    ...(startFrameReferenceUrl ? [startFrameReferenceUrl] : []),
    ...imageReferences.map((reference) => reference.url),
  ];
  assertResolvedAllSeedanceReferences({
    provider: "Ark Seedance",
    startFrameUrl,
    startFrameReferenceUrl,
    firstFrameUrl,
    firstFrameReferenceUrl,
    lastFrameUrl,
    lastFrameReferenceUrl,
    assets: resolvedAssets,
    imageReferences,
    mediaReferences,
  });
  const finalPrompt = promptWithStoryboardGuidance(
    `${prompt}${startFrameReferenceUrl ? "\n\n@图片1 是上一段视频的尾帧，直接作为本段的首帧（起始帧）。" : ""}${startFrameReferenceUrl ? seedanceAssetIdentityFallbackText(resolvedAssets) : ""}${seedanceAssetPromptSuffix(promptReferences)}`.trim(),
    body.storyboardGuidanceText,
  );
  const payload = {
    model,
    duration: normalizeSeedanceDuration(body.duration),
    resolution: normalizeVideoResolution(body.resolution, model),
    ratio: normalizeVideoRatio(body.ratio),
    generate_audio: body.generateAudio !== false,
  };
  if (mediaReferences.length) {
    payload.content = [
      { type: "text", text: finalPrompt },
      ...(firstFrameReferenceUrl
        ? [{
            type: "image_url",
            image_url: { url: firstFrameReferenceUrl },
            role: "first_frame",
          }]
        : []),
      ...(lastFrameReferenceUrl
        ? [{
            type: "image_url",
            image_url: { url: lastFrameReferenceUrl },
            role: "last_frame",
          }]
        : []),
      ...(startFrameReferenceUrl
        ? [{
            type: "image_url",
            image_url: { url: startFrameReferenceUrl },
            role: "reference_image",
          }]
        : []),
      // 参考素材可能是视频:用同一个 content-item 构造器,视频会被识别成 video_url/reference_video,
      // 否则会被当图片(image_url)发出去,触发接口的图片体积/类型限制而失败。
      ...imageReferences.map((reference) => gravitexAssetContentFromUrl(reference.url, "reference_image")).filter(Boolean),
    ];
  } else {
    payload.content = [{ type: "text", text: finalPrompt }];
  }
  if (body.seed !== undefined && body.seed !== null && body.seed !== "") payload.seed = Number(body.seed);
  if (body.watermark !== undefined) payload.watermark = body.watermark === true;
  return payload;
}

async function buildGravitexVideoGenerationPayload(body = {}) {
  const prompt = cleanSeedancePromptForSubmission(body.prompt);
  if (!prompt) throw new Error("缺少视频提示词");
  const assets = canvasVideoSubmitCapableAssets(body.assets);
  let modelMode = compactLine(body.modelMode || body.model);
  const model = normalizeGravitexSeedanceModel(modelMode);
  const startFrameUrl = compactLine(body.startFrameUrl || body.start_frame_url || "");
  const startFrameReferenceUrl = startFrameUrl ? await assetUrlToReferenceUrl(startFrameUrl, { allowAssetUrl: true }) : "";
  const livenessAssetUrl = compactLine(body.livenessAssetUrl || body.liveness_asset_url || "");
  assertSeedanceReferenceBudget({
    startFrameUrl: startFrameReferenceUrl || startFrameUrl,
    assets,
    livenessAssetUrl,
  });
  const imageReferences = await resolveSeedanceImageReferences(
    assets,
    SEEDANCE_MAX_IMAGE_REFERENCES - (startFrameReferenceUrl ? 1 : 0) - (livenessAssetUrl ? 1 : 0),
    { allowAssetUrl: true, required: false },
  );
  const resolvedAssets = imageReferences.map((reference) => reference.asset);
  const content = [];
  const references = [];

  if (modelMode === "seedance-2-0-liveness-face" && body.livenessGroupId && !livenessAssetUrl) {
    modelMode = "seedance-2-0";
  }

  if (modelMode === "seedance-2-0-liveness-face" && livenessAssetUrl) {
    const item = gravitexAssetContentFromUrl(livenessAssetUrl, "reference_image");
    if (item) references.push(item);
  }

  const hasOtherReferenceImages = imageReferences.length > 0 || !!livenessAssetUrl;
  const startFrameRole = hasOtherReferenceImages ? "reference_image" : "first_frame";
  if (startFrameReferenceUrl) {
    const item = gravitexAssetContentFromUrl(startFrameReferenceUrl, startFrameRole);
    if (item) references.push(item);
  }

  for (const reference of imageReferences) {
    const item = gravitexAssetContentFromUrl(reference.url, "reference_image");
    if (item) references.push(item);
  }

  const livenessPrefix = modelMode === "seedance-2-0-liveness-face" && livenessAssetUrl
    ? [{ asset: { name: body.livenessName || "真人模型", type: "liveness_face" }, url: livenessAssetUrl, ref: "@图片1" }]
    : [];
  const startFramePrefix = startFrameReferenceUrl
    ? [{ asset: { name: "上一段视频尾帧", type: "TailFrame" }, url: startFrameReferenceUrl, ref: `@图片${livenessPrefix.length + 1}` }]
    : [];
  const promptReferences = [
    ...livenessPrefix,
    ...startFramePrefix,
    ...imageReferences.map((reference, index) => ({ ...reference, ref: `@图片${livenessPrefix.length + startFramePrefix.length + index + 1}` })),
  ];
  const startFrameRef = startFramePrefix[0]?.ref || "@图片1";
  const continuityText = startFrameReferenceUrl
    ? `\n\n${startFrameRef} 是上一段视频的尾帧，直接作为本段的首帧（起始帧）。`
    : "";
  const assetTextFallback = startFrameReferenceUrl && assets.length
    ? seedanceAssetIdentityFallbackText(resolvedAssets)
    : "";
  assertResolvedAllSeedanceReferences({
    provider: "Gravitex Seedance",
    startFrameUrl,
    startFrameReferenceUrl,
    assets: resolvedAssets,
    imageReferences,
    livenessAssetUrl,
    mediaReferences: references,
  });
  content.push({
    type: "text",
    text: promptWithStoryboardGuidance(`${prompt}${continuityText}${assetTextFallback}${seedanceAssetPromptSuffix(promptReferences)}`.trim(), body.storyboardGuidanceText),
  });

  content.push(...references);
  const payload = {
    model,
    content,
    duration: normalizeSeedanceDuration(body.duration),
    resolution: normalizeGravitexVideoResolution(body.resolution, model),
    ratio: references.length ? normalizeReferenceVideoRatio(body.ratio) : normalizeVideoRatio(body.ratio),
    generate_audio: body.generateAudio !== false,
    watermark: body.watermark === true,
  };
  if (body.seed !== undefined && body.seed !== null && body.seed !== "") payload.seed = Number(body.seed);
  return payload;
}

function findFirstStringDeep(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new Set();
  const visit = (item) => {
    if (!item || typeof item !== "object" || seen.has(item)) return "";
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = visit(child);
        if (found) return found;
      }
      return "";
    }
    for (const [key, child] of Object.entries(item)) {
      if (wanted.has(key.toLowerCase()) && typeof child === "string" && child.trim()) return child.trim();
    }
    for (const child of Object.values(item)) {
      const found = visit(child);
      if (found) return found;
    }
    return "";
  };
  return visit(value);
}

function findFirstNumberLikeDeep(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new Set();
  const visit = (item) => {
    if (!item || typeof item !== "object" || seen.has(item)) return null;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = visit(child);
        if (found !== null) return found;
      }
      return null;
    }
    for (const [key, child] of Object.entries(item)) {
      if (!wanted.has(key.toLowerCase())) continue;
      if (typeof child === "number" && Number.isFinite(child)) return child;
      if (typeof child === "string" && child.trim()) return child.trim();
    }
    for (const child of Object.values(item)) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(value);
}

function findVideoUrlDeep(value) {
  const byKey = findFirstStringDeep(value, ["video_url", "videoUrl", "url", "download_url", "downloadUrl", "output_url", "outputUrl"]);
  if (isLikelyVideoUrl(byKey)) return byKey;
  const seen = new Set();
  const visit = (item) => {
    if (typeof item === "string") return /^https?:\/\/.+\.(mp4|mov|webm)(?:\?|#|$)/i.test(item) ? item : "";
    if (!item || typeof item !== "object" || seen.has(item)) return "";
    seen.add(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) {
      const found = visit(child);
      if (found) return found;
    }
    return "";
  };
  return visit(value);
}

function findImageUrlDeep(value, preferredKeys = []) {
  const byKey = findFirstStringDeep(value, preferredKeys);
  if (/^(https?:\/\/|data:image\/)/i.test(byKey) || /\.(png|jpe?g|webp)(?:\?|#|$)/i.test(byKey)) return byKey;
  const seen = new Set();
  const visit = (item) => {
    if (typeof item === "string") return /^https?:\/\/.+\.(png|jpe?g|webp)(?:\?|#|$)/i.test(item) ? item : "";
    if (!item || typeof item !== "object" || seen.has(item)) return "";
    seen.add(item);
    for (const child of Array.isArray(item) ? item : Object.values(item)) {
      const found = visit(child);
      if (found) return found;
    }
    return "";
  };
  return visit(value);
}

function findTailFrameUrlDeep(value = {}) {
  return findImageUrlDeep(value, [
    "tail_frame_url",
    "tailFrameUrl",
    "last_frame_url",
    "lastFrameUrl",
    "end_frame_url",
    "endFrameUrl",
    "last_image_url",
    "lastImageUrl",
    "cover_url",
    "coverUrl",
    "poster_url",
    "posterUrl",
  ]);
}

function isHttpUrl(value = "") {
  return /^https?:\/\//i.test(compactLine(value));
}

function isLocalMediaVideoUrl(value = "") {
  const clean = compactLine(value);
  if (!/^\/media\?/i.test(clean) && !/^file:\/\//i.test(clean)) return false;
  try {
    const parsed = clean.startsWith("/media?") ? new URL(clean, "http://local.test") : new URL(clean);
    const mediaPath = parsed.searchParams.get("path") || parsed.pathname || "";
    return /\.(mp4|mov|webm)(?:$|[?#])/i.test(decodeURIComponent(mediaPath));
  } catch {
    return /\.(mp4|mov|webm)(?:$|[?#])/i.test(clean);
  }
}

function isLikelyVideoUrl(value = "") {
  const clean = compactLine(value);
  if (isLocalMediaVideoUrl(clean)) return true;
  if (!isHttpUrl(clean)) return false;
  if (/\.(mp4|mov|webm)(?:\?|#|$)/i.test(clean)) return true;
  return /\/(?:video|videos|download|outputs?|generations?|files?)\//i.test(clean);
}

function videoUrlFrom(value = "") {
  const clean = compactLine(value);
  return isLikelyVideoUrl(clean) ? clean : "";
}

function invalidVideoUrlReason(value = "") {
  const clean = compactLine(value);
  if (!clean) return "";
  if (isLikelyVideoUrl(clean)) return "";
  if (/SensitiveContentDetected|sensitive information|sensitive content|output video|request failed|failed because|error|invalid|forbidden|unauthor/i.test(clean)) {
    return normalizeVideoGenerationErrorMessage(clean);
  }
  return "视频接口返回的结果不是可下载的视频地址";
}

function normalizeProgressValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(typeof value === "string" ? value.trim().replace(/%$/, "") : value);
    if (!Number.isFinite(numeric)) continue;
    const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }
  return null;
}

function extractProgressDeep(raw = {}) {
  return findFirstNumberLikeDeep(raw, [
    "progress",
    "percent",
    "percentage",
    "progress_percent",
    "progressPercent",
    "progress_percentage",
    "progressPercentage",
    "percent_complete",
    "percentComplete",
    "completion",
    "completion_percent",
    "completionPercent",
  ]);
}

function normalizeSeedanceStatus(raw = {}) {
  const statusRaw = compactLine(findFirstStringDeep(raw, ["status", "state", "task_status"])).toLowerCase();
  const rawVideoUrl = findVideoUrlDeep(raw);
  const videoUrl = videoUrlFrom(rawVideoUrl);
  const invalidVideo = invalidVideoUrlReason(rawVideoUrl);
  const tailFrameUrl = findTailFrameUrlDeep(raw);
  const taskId = findFirstStringDeep(raw, ["id", "task_id", "taskId", "generation_id", "generationId", "request_id", "requestId"]);
  const message = findFirstStringDeep(raw, ["message", "error", "error_message", "errorMessage", "failed_reason", "failedReason"]);
  const progress = normalizeProgressValue(
    raw?.progress,
    raw?.data?.progress,
    raw?.percent,
    raw?.data?.percent,
    raw?.progress_percent,
    raw?.data?.progress_percent,
    raw?.progressPercent,
    raw?.data?.progressPercent,
    extractProgressDeep(raw),
  );
  const failed = !!invalidVideo || /fail|error|cancel|reject/i.test(statusRaw) || (!!message && !videoUrl && /fail|error|invalid|unauthorized|forbidden/i.test(message));
  const completed = !failed && (!!videoUrl || /complete|completed|success|succeeded|done|finish|finished/i.test(statusRaw));
  const running = !completed && !failed;
  return {
    status: completed ? "completed" : failed ? "failed" : "running",
    statusRaw,
    taskId,
    videoUrl,
    tailFrameUrl,
    progress: completed ? 100 : failed ? progress ?? 100 : progress,
    message: invalidVideo || (failed && message ? normalizeVideoGenerationErrorMessage(message) : message) || (completed ? "生成完成" : running ? "任务生成中" : "任务失败"),
    raw,
  };
}

function extractVideoApiError(data = {}) {
  // 火山 Ark 失败结构: { error: { code, message, type } }
  if (data && typeof data.error === "object" && data.error) {
    return compactLine(data.error.message || data.error.code || "");
  }
  if (typeof data.error === "string") return compactLine(data.error);
  if (typeof data.message === "string") return compactLine(data.message);
  return "";
}

function normalizeVideoGenerationErrorMessage(message = "") {
  const raw = compactLine(message);
  if (!raw) return "视频生成失败";
  let parsed = null;
  if (/^\{/.test(raw)) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const code = compactLine(parsed?.error?.code || parsed?.code || "");
  const nested = compactLine(parsed?.error?.message || parsed?.message || raw);
  const requestId = nested.match(/Request id:\s*([A-Za-z0-9]+)/i)?.[1] || "";
  if (/copyright|copyright\s+restriction|copyright\s+restrictions|版权|著作权|ip\s*restriction/i.test(`${code} ${nested}`)) {
    return `视频接口触发版权限制：请对该镜头做原创化改写，避免使用疑似现有 IP、品牌、作品名、固定世界观术语或高度相似角色设定后重试。${requestId ? `Request ID: ${requestId}` : ""}`.trim();
  }
  if (/InputImageSensitiveContentDetected\.PrivacyInformation|input image may contain real person|真实人物|隐私/i.test(`${code} ${nested}`)) {
    return "参考图被视频接口判定可能包含真实人物/隐私信息。AI 生成标记不会改变平台审核结果；请改用非人脸/风格化角色，或平台认可的可信 AI 产物。";
  }
  if (/OutputAudioSensitiveContentDetected|output audio may contain sensitive|output audio.*sensitive/i.test(`${code} ${nested}`)) {
    return "生成的音频被海外火山判定含敏感信息。系统已尝试关闭音频重试；若仍失败，请在该模块手动关闭「音效」后再生成，或改用国内模型。";
  }
  if (/invalid\s*token|unauthor|forbidden|token\s*无效|鉴权|密钥/i.test(nested)) return nested;
  return nested;
}

async function callVideoJson(url, options = {}, missingKeyMessage = "缺少视频生成 API Key", provider = canvasVideoProvider()) {
  const key = videoApiKey(provider);
  if (!key) throw new Error(missingKeyMessage);
  const method = options.method || "GET";
  let response;
  try {
    response = await fetchWithTimeout(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    const message = normalizeVideoGenerationErrorMessage(error.message || "视频网关请求失败");
    appendVideoApiLog({
      provider,
      method,
      url,
      status: error.code || error.name || "NETWORK_ERROR",
      message,
    });
    throw new Error(message);
  }
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok || data.success === false || data.ok === false) {
    const message = normalizeVideoGenerationErrorMessage(extractVideoApiError(data) || `视频网关 HTTP ${response.status}`);
    appendVideoApiLog({
      provider,
      method,
      url,
      status: response.status,
      message,
      response: data,
    });
    throw new Error(message || "视频网关请求失败");
  }
  return data;
}

async function callArkJson(pathname, options = {}) {
  const userId = compactLine(process.env.GRAVITEX_USER_ID || process.env.GRAVITEX_NEW_API_USER || "");
  return callVideoJson(
    arkVideoUrl(pathname),
    {
      ...options,
      headers: {
        ...(userId ? { "New-Api-User": userId } : {}),
        ...(options.headers || {}),
      },
    },
    "缺少视频生成 API Key：请在 .env.local 配置 VOLC_ARK_API_KEY(火山方舟)后重启服务。",
    "ark",
  );
}

async function callArkImageJson(payload = {}) {
  return callVideoJson(
    arkImageUrl("/images/generations"),
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "缺少火山方舟图片 API Key：请在 .env.local 配置 VOLC_ARK_API_KEY 后重启服务。",
    "ark",
  );
}

async function callBytePlusArkJson(pathname, options = {}) {
  return callVideoJson(
    bytePlusArkVideoUrl(pathname),
    options,
    "缺少 BytePlus ModelArk API Key：请在 .env.local 配置 BYTEPLUS_ARK_API_KEY=ark-... 后重启服务。",
    "byteplus",
  );
}

async function callGravitexJson(pathname, options = {}) {
  try {
    return await callVideoJson(
      gravitexVideoUrl(pathname),
      options,
      "缺少 Gravitex API Key：请在 .env.local 配置 GRAVITEX_API_KEY=sk-... 后重启服务。",
      "gravitex",
    );
  } catch (error) {
    const message = String(error?.message || "");
    if (/invalid\s*token|unauthor|forbidden|token\s*无效|鉴权|密钥/i.test(message)) {
      throw new Error(
        `Gravitex 鉴权失败：真人模型/真人核验走 Gravitex，不使用火山 Ark 的 VOLC_ARK_API_KEY。当前 GRAVITEX_API_KEY 无效或已过期，请换成 Gravitex 控制台的 sk-... key。上游返回：${message}`,
      );
    }
    throw error;
  }
}

async function createArkCanvasVideoGeneration(body = {}) {
  const payload = await buildSeedanceGenerationPayload(body);
  const raw = await callArkJson("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const result = normalizeSeedanceStatus(raw);
  return { ...result, provider: "ark", request: { ...payload, prompt: payload.prompt || undefined, content: payload.content ? "[multimodal content]" : undefined } };
}

async function getArkCanvasVideoGeneration(taskId) {
  const cleanTaskId = compactLine(taskId);
  if (!cleanTaskId) throw new Error("缺少任务 ID");
  const raw = await callArkJson(`/contents/generations/tasks/${encodeURIComponent(cleanTaskId)}`, { method: "GET" });
  return { ...normalizeSeedanceStatus(raw), provider: "ark" };
}

async function createBytePlusArkCanvasVideoGeneration(body = {}) {
  // BytePlus ModelArk 与火山中国区 Ark 的请求/响应结构一致,复用同一 payload 构造与状态解析;
  // 仅模型 ID 走 dreamina- 映射(通过 __provider 透传给 normalizeSeedanceModel)。
  const payload = await buildSeedanceGenerationPayload({ ...body, __provider: "byteplus" });
  const raw = await callBytePlusArkJson("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const result = normalizeSeedanceStatus(raw);
  return { ...result, provider: "byteplus", request: { ...payload, prompt: payload.prompt || undefined, content: payload.content ? "[multimodal content]" : undefined } };
}

async function getBytePlusArkCanvasVideoGeneration(taskId) {
  const cleanTaskId = compactLine(taskId);
  if (!cleanTaskId) throw new Error("缺少任务 ID");
  const raw = await callBytePlusArkJson(`/contents/generations/tasks/${encodeURIComponent(cleanTaskId)}`, { method: "GET" });
  return { ...normalizeSeedanceStatus(raw), provider: "byteplus" };
}

function normalizeGravitexGenerationStatus(raw = {}) {
  const statusRaw = compactLine(raw?.status || raw?.data?.status || findFirstStringDeep(raw, ["status"])).toLowerCase();
  const rawVideoUrl = compactLine(raw?.video_url || raw?.url || raw?.data?.video_url || raw?.data?.url || findVideoUrlDeep(raw));
  const videoUrl = videoUrlFrom(rawVideoUrl);
  const invalidVideo = invalidVideoUrlReason(rawVideoUrl);
  const tailFrameUrl = compactLine(raw?.tail_frame_url || raw?.tailFrameUrl || raw?.data?.tail_frame_url || raw?.data?.tailFrameUrl || findTailFrameUrlDeep(raw));
  const taskId = compactLine(raw?.task_id || raw?.id || raw?.data?.task_id || raw?.data?.id || findFirstStringDeep(raw, ["task_id", "taskId", "id"]));
  const message = compactLine(raw?.error?.message || raw?.message || raw?.data?.error?.message || raw?.data?.message || "");
  const progress = normalizeProgressValue(
    raw?.progress,
    raw?.data?.progress,
    raw?.percent,
    raw?.data?.percent,
    raw?.metadata?.progress,
    raw?.data?.metadata?.progress,
    raw?.progressPercent,
    raw?.data?.progressPercent,
    extractProgressDeep(raw),
  );
  if (invalidVideo) {
    return { status: "failed", statusRaw: statusRaw || "failed", taskId, videoUrl: "", tailFrameUrl, progress: progress ?? 100, message: invalidVideo, raw };
  }
  if (videoUrl || statusRaw === "completed") {
    return { status: "completed", statusRaw, taskId, videoUrl, tailFrameUrl, progress: 100, message: "生成完成", raw };
  }
  if (statusRaw === "failed" || statusRaw === "error" || statusRaw === "cancelled" || statusRaw === "canceled") {
    return { status: "failed", statusRaw, taskId, videoUrl: "", tailFrameUrl, progress: progress ?? 100, message: message ? normalizeVideoGenerationErrorMessage(message) : "视频生成失败", raw };
  }
  return {
    status: "running",
    statusRaw: statusRaw || "queued",
    taskId,
    videoUrl: "",
    tailFrameUrl,
    progress,
    message: message || (statusRaw === "in_progress" ? "任务生成中" : "任务排队中"),
    raw,
  };
}

function firstActiveGravitexAssetUrl(raw = {}) {
  const assets = Array.isArray(raw?.assets)
    ? raw.assets
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.data?.assets)
        ? raw.data.assets
        : Array.isArray(raw?.data?.items)
          ? raw.data.items
          : Array.isArray(raw?.data)
            ? raw.data
            : [];
  const active = assets.find((asset) => {
    const type = compactLine(asset?.asset_type || asset?.type).toLowerCase();
    const status = compactLine(asset?.status).toLowerCase();
    return status === "active" && (!type || type === "image");
  });
  return {
    assetUrl: compactLine(active?.asset_url || active?.assetUrl || ""),
    previewUrl: compactLine(active?.url || active?.preview_url || active?.previewUrl || ""),
    status: compactLine(active?.status || ""),
    virtualId: compactLine(active?.virtual_id || active?.virtualId || active?.id || ""),
    raw: active || null,
  };
}

function normalizeGravitexAssets(raw = {}) {
  const assets = Array.isArray(raw?.assets)
    ? raw.assets
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.data?.assets)
        ? raw.data.assets
        : Array.isArray(raw?.data?.items)
          ? raw.data.items
          : Array.isArray(raw?.data)
            ? raw.data
            : [];
  return assets.map((asset) => ({
    virtualId: compactLine(asset?.virtual_id || asset?.virtualId || asset?.id || ""),
    assetUrl: compactLine(asset?.asset_url || asset?.assetUrl || ""),
    previewUrl: compactLine(asset?.url || asset?.preview_url || asset?.previewUrl || ""),
    groupId: compactLine(asset?.group_id || asset?.groupId || ""),
    name: compactLine(asset?.name || asset?.filename || asset?.fileName || asset?.virtual_id || "真人素材"),
    type: compactLine(asset?.asset_type || asset?.assetType || asset?.type || "Image"),
    status: compactLine(asset?.status || ""),
    errorMessage: compactLine(asset?.error_msg || asset?.errorMessage || asset?.error_message || asset?.message || ""),
    createdAt: asset?.created_at || asset?.createdAt || "",
  }));
}

function gravitexAssetReusableStatus(status = "") {
  const clean = compactLine(status).toLowerCase();
  return ["active", "pending", "running", "processing", "created", "creating"].includes(clean);
}

async function findReusableGravitexAsset(groupId, name) {
  const cleanGroupId = compactLine(groupId);
  const cleanName = compactLine(name);
  if (!cleanGroupId || !cleanName) return null;
  const raw = await callGravitexJson(`/assets?group_id=${encodeURIComponent(cleanGroupId)}`, { method: "GET" });
  const assets = normalizeGravitexAssets(raw);
  return (
    assets.find((asset) => asset.name === cleanName && compactLine(asset.status).toLowerCase() === "active" && asset.assetUrl) ||
    assets.find((asset) => asset.name === cleanName && gravitexAssetReusableStatus(asset.status)) ||
    null
  );
}

async function refreshKnownGravitexAsset(groupId, known = {}) {
  const cleanGroupId = compactLine(groupId || known.groupId || known.group_id || "");
  if (!cleanGroupId) return null;
  const raw = await callGravitexJson(`/assets?group_id=${encodeURIComponent(cleanGroupId)}`, { method: "GET" });
  const assets = normalizeGravitexAssets(raw);
  const wantedVirtualId = compactLine(known.virtualId || known.virtual_id || "").replace(/^asset:\/\//i, "");
  const wantedAssetUrl = compactLine(known.assetUrl || known.asset_url || "");
  const wantedName = compactLine(known.name || "");
  return (
    assets.find((asset) => wantedAssetUrl && asset.assetUrl === wantedAssetUrl) ||
    assets.find((asset) => wantedVirtualId && (asset.virtualId === wantedVirtualId || asset.assetUrl.endsWith(wantedVirtualId))) ||
    assets.find((asset) => wantedName && asset.name === wantedName) ||
    null
  );
}

async function refreshConfigAssetLibraryStatuses(config = {}) {
  const assets = Array.isArray(config.assets) ? config.assets : [];
  const tailFrameAssets = config.tailFrameAssets && typeof config.tailFrameAssets === "object" ? config.tailFrameAssets : {};
  const groupIds = [
    ...new Set([
      ...assets.map((asset) => compactLine(asset.groupId || asset.group_id || "")),
      ...Object.values(tailFrameAssets).map((asset) => compactLine(asset?.groupId || asset?.group_id || "")),
      projectPhotorealGroupId(config),
    ].filter(Boolean)),
  ];
  if (!groupIds.length) return { config, changed: false };
  const byKey = new Map();
  for (const groupId of groupIds) {
    try {
      const raw = await callGravitexJson(`/assets?group_id=${encodeURIComponent(groupId)}`, { method: "GET" });
      for (const asset of normalizeGravitexAssets(raw)) {
        if (!asset.assetUrl && !asset.virtualId && !asset.name) continue;
        const keys = [
          asset.assetUrl,
          asset.virtualId,
          asset.assetUrl.replace(/^asset:\/\//i, ""),
          asset.name,
        ].map(compactLine).filter(Boolean);
        for (const key of keys) if (!byKey.has(key)) byKey.set(key, { ...asset, groupId: asset.groupId || groupId });
      }
    } catch {
      // Keep local state if the status refresh endpoint is temporarily unavailable.
    }
  }
  if (!byKey.size) return { config, changed: false };
  let changed = false;
  const nextAssets = assets.map((asset) => {
    const assetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
    const virtualId = compactLine(asset.virtualId || asset.virtual_id || "");
    const name = compactLine(asset.name || asset.assetName || asset.id || "");
    const match =
      byKey.get(assetUrl) ||
      byKey.get(virtualId) ||
      byKey.get(assetUrl.replace(/^asset:\/\//i, "")) ||
      byKey.get(name);
    if (!match) return asset;
    const status = compactLine(match.status || asset.validationStatus || "");
    const next = {
      ...asset,
      assetUrl: match.assetUrl || assetUrl,
      virtualId: match.virtualId || virtualId,
      groupId: match.groupId || asset.groupId || "",
      validationStatus: status || asset.validationStatus || "",
      validationError: match.errorMessage || "",
      validationMessage: status.toLowerCase() === "active" ? "素材已 active" : (match.errorMessage || asset.validationMessage || ""),
    };
    if (JSON.stringify(next) !== JSON.stringify(asset)) changed = true;
    return next;
  });
  let nextTailFrameAssets = tailFrameAssets;
  if (Object.keys(tailFrameAssets).length) {
    nextTailFrameAssets = {};
    for (const [key, asset] of Object.entries(tailFrameAssets)) {
      if (!asset || typeof asset !== "object") {
        nextTailFrameAssets[key] = asset;
        continue;
      }
      const assetUrl = compactLine(asset.assetUrl || asset.asset_url || "");
      const virtualId = compactLine(asset.virtualId || asset.virtual_id || "");
      const name = compactLine(asset.name || key || "");
      const match =
        byKey.get(assetUrl) ||
        byKey.get(virtualId) ||
        byKey.get(assetUrl.replace(/^asset:\/\//i, "")) ||
        byKey.get(name);
      if (!match) {
        nextTailFrameAssets[key] = asset;
        continue;
      }
      const status = compactLine(match.status || asset.status || asset.validationStatus || "");
      const next = {
        ...asset,
        assetUrl: match.assetUrl || assetUrl,
        virtualId: match.virtualId || virtualId,
        groupId: match.groupId || asset.groupId || "",
        status: status || asset.status || "",
        validationStatus: status || asset.validationStatus || "",
        validationError: match.errorMessage || "",
        message: status.toLowerCase() === "active" ? "素材已 active" : (match.errorMessage || asset.message || ""),
        updatedAt: new Date().toISOString(),
      };
      if (JSON.stringify(next) !== JSON.stringify(asset)) changed = true;
      nextTailFrameAssets[key] = next;
    }
  }
  return {
    config: changed ? { ...config, assets: nextAssets, tailFrameAssets: nextTailFrameAssets } : config,
    changed,
  };
}

async function findGravitexLivenessAssetUrl(groupId) {
  const cleanGroupId = compactLine(groupId);
  if (!cleanGroupId) return "";
  const raw = await callGravitexJson(`/assets?group_id=${encodeURIComponent(cleanGroupId)}`, { method: "GET" });
  return firstActiveGravitexAssetUrl(raw).assetUrl;
}

async function listGravitexLivenessAssets(body = {}) {
  const groupId = compactLine(body.groupId || body.group_id || "");
  const query = groupId ? `?group_id=${encodeURIComponent(groupId)}` : "?group_type=liveness_face";
  const raw = await callGravitexJson(`/assets${query}`, { method: "GET" });
  return {
    groupId,
    assets: normalizeGravitexAssets(raw),
    raw,
  };
}

async function createGravitexAigcAssetGroup(body = {}) {
  const name = compactLine(body.name || "人物素材组");
  if (!name) throw new Error("缺少素材组名称");
  const payload = { name, group_type: "aigc" };
  const description = compactLine(body.description || "");
  if (description) payload.description = description;
  const channelId = Number(body.channelId || body.channel_id || process.env.GRAVITEX_DEFAULT_CHANNEL_ID || "");
  if (Number.isInteger(channelId) && channelId > 0) payload.channel_id = channelId;
  const raw = await callGravitexJson("/asset-groups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    group_id: compactLine(raw.group_id || raw.data?.group_id || raw.groupId || raw.data?.groupId || ""),
    name: compactLine(raw.name || raw.data?.name || name),
    description: compactLine(raw.description || raw.data?.description || description),
    channel_id: raw.channel_id || raw.data?.channel_id || "",
    group_type: compactLine(raw.group_type || raw.data?.group_type || "aigc"),
    raw,
  };
}

async function createOrRefreshGravitexAsset(body = {}) {
  const groupId = compactLine(body.groupId || body.group_id || "");
  if (!groupId) throw new Error("缺少素材组 ID，请先创建人物素材组。");
  const url = compactLine(body.url || body.assetUrl || body.asset_url || "");
  if (/^asset:\/\//i.test(url)) {
    return {
      status: "active",
      assetUrl: url,
      groupId,
      message: "已绑定人物素材 asset://",
    };
  }
  if (url) {
    if (!/^https:\/\//i.test(url)) throw new Error("人物素材只能使用 asset:// 或公网 HTTPS 图片 URL；本地文件需先上传到对象存储。");
    const name = compactLine(body.name || path.basename(new URL(url).pathname) || "person-asset");
    const reusable = await findReusableGravitexAsset(groupId, name);
    if (reusable) {
      return {
        status: compactLine(reusable.status || "pending"),
        assetUrl: reusable.assetUrl || "",
        virtualId: reusable.virtualId || "",
        groupId: reusable.groupId || groupId,
        name,
        type: reusable.type || "Image",
        message: reusable.assetUrl ? "已复用素材库中的 active 素材" : "已复用素材库中的处理中素材",
        raw: reusable,
      };
    }
    const raw = await callGravitexJson("/assets", {
      method: "POST",
      body: JSON.stringify({
        url,
        group_id: groupId,
        asset_type: "Image",
        name: name.slice(0, 64),
      }),
    });
    return {
      status: compactLine(raw.status || raw.data?.status || "pending"),
      assetUrl: compactLine(raw.asset_url || raw.data?.asset_url || raw.assetUrl || raw.data?.assetUrl || ""),
      virtualId: compactLine(raw.virtual_id || raw.data?.virtual_id || raw.virtualId || raw.data?.virtualId || ""),
      groupId: compactLine(raw.group_id || raw.data?.group_id || groupId),
      name,
      type: "Image",
      message: "人物素材已提交，等待 active 后可生成视频",
      raw,
    };
  }
  const raw = await callGravitexJson(`/assets?group_id=${encodeURIComponent(groupId)}`, { method: "GET" });
  const active = firstActiveGravitexAssetUrl(raw);
  if (!active.assetUrl) {
    return {
      status: "missing",
      assetUrl: "",
      groupId,
      message: "人物素材组内还没有 active 图片素材",
      raw,
    };
  }
  return {
    status: "active",
    ...active,
    groupId,
    message: "已找到 active 人物素材",
  };
}

const createOrRefreshGravitexLivenessAsset = createOrRefreshGravitexAsset;

async function createGravitexCanvasVideoGeneration(body = {}) {
  const nextBody = { ...body };
  if ((nextBody.modelMode || nextBody.model) === "seedance-2-0-liveness-face" && !nextBody.livenessAssetUrl && nextBody.livenessGroupId) {
    nextBody.livenessAssetUrl = await findGravitexLivenessAssetUrl(nextBody.livenessGroupId);
  }
  const payload = await buildGravitexVideoGenerationPayload(nextBody);
  appendVideoApiLog({
    provider: "gravitex",
    method: "POST",
    url: gravitexVideoUrl("/video/generations"),
    status: "SUBMITTING",
    message: `提交视频任务：${payload.model || ""}，参考 ${Array.isArray(payload.content) ? Math.max(0, payload.content.length - 1) : 0} 个`,
  });
  const raw = await callGravitexJson("/video/generations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const result = normalizeGravitexGenerationStatus(raw);
  return {
    ...result,
    provider: "gravitex",
    request: { ...payload, content: payload.content ? `[${payload.content.length} content items]` : undefined },
  };
}

async function getGravitexCanvasVideoGeneration(taskId) {
  const cleanTaskId = compactLine(taskId);
  if (!cleanTaskId) throw new Error("缺少任务 ID");
  const raw = await callGravitexJson(`/video/generations/${encodeURIComponent(cleanTaskId)}`, { method: "GET" });
  return { ...normalizeGravitexGenerationStatus(raw), provider: "gravitex" };
}

async function createCanvasVideoGeneration(body = {}) {
  const provider = canvasVideoProviderForBody(body);
  if (provider === "gravitex") return createGravitexCanvasVideoGeneration(body);
  if (provider === "byteplus") return createBytePlusArkCanvasVideoGeneration(body);
  return createArkCanvasVideoGeneration(body);
}

async function getCanvasVideoGeneration(taskId, provider = canvasVideoProvider()) {
  const normalizedProvider = normalizeCanvasVideoProvider(provider);
  if (normalizedProvider === "gravitex") return getGravitexCanvasVideoGeneration(taskId);
  if (normalizedProvider === "byteplus") return getBytePlusArkCanvasVideoGeneration(taskId);
  return getArkCanvasVideoGeneration(taskId);
}

// ---- 画布图片生成通道（GPT Image 2 + Seedream 5.0，输出到画布公共资产目录） ----
const canvasImageJobs = new Map();
const canvasImageQueue = [];
let canvasImageActiveJobs = 0;
const CANVAS_IMAGE_MAX_CONCURRENCY = Math.max(1, Math.min(4, Number.parseInt(process.env.PIXEL_TOYS_IMAGE_CONCURRENCY || "4", 10)));
// GPT Image 2 size constraints: each edge is 16px-aligned, <=3840px, and total pixels <=8,294,400.
const CANVAS_IMAGE_SIZE_TABLE = {
  "16:9": { "1k": "1280x720", "2k": "2048x1152", "4k": "3840x2160" },
  "4:3": { "1k": "1280x960", "2k": "2048x1536", "4k": "3200x2400" },
  "3:2": { "1k": "1536x1024", "2k": "3072x2048", "4k": "3360x2240" },
  "21:9": { "1k": "1680x720", "2k": "3360x1440", "4k": "3840x1648" },
  "9:16": { "1k": "720x1280", "2k": "1152x2048", "4k": "2160x3840" },
  "4:5": { "1k": "1024x1280", "2k": "1632x2048", "4k": "2560x3200" },
  "3:4": { "1k": "960x1280", "2k": "1536x2048", "4k": "2304x3072" },
  "2:3": { "1k": "1024x1536", "2k": "2048x3072", "4k": "2304x3456" },
  "1:1": { "1k": "1024x1024", "2k": "2048x2048", "4k": "2880x2880" },
};
const GPT_IMAGE_MODEL = process.env.PIXEL_TOYS_IMAGE_TOOL_MODEL || process.env.PIXEL_TOYS_IMAGE_MODEL || "gpt-image-2";
const DEFAULT_SEEDREAM_5_PRO_MODEL = "doubao-seedream-5-0-260128";
const DEFAULT_SEEDREAM_5_LITE_MODEL = "doubao-seedream-5-0-lite-260128";
const SEEDREAM_MIN_IMAGE_PIXELS = 3_686_400;

function normalizeCanvasImageModel(value) {
  const raw = compactLine(value || "gpt-image-2").toLowerCase();
  if (["seedream-5-0-pro", "seedream-5.0-pro", "seedream-5-pro", "doubao-seedream-5-0-260128"].includes(raw)) return "seedream-5-0-pro";
  if (["seedream-5-0-lite", "seedream-5.0-lite", "seedream-5-lite", "doubao-seedream-5-0-lite-260128"].includes(raw)) return "seedream-5-0-lite";
  return "gpt-image-2";
}

function canvasImageModelConfig(value) {
  const key = normalizeCanvasImageModel(value);
  if (key === "seedream-5-0-pro") {
    return {
      key,
      provider: "ark",
      model: process.env.VOLC_ARK_IMAGE_PRO_MODEL || process.env.SEEDREAM_5_PRO_MODEL || DEFAULT_SEEDREAM_5_PRO_MODEL,
    };
  }
  if (key === "seedream-5-0-lite") {
    return {
      key,
      provider: "ark",
      model: process.env.VOLC_ARK_IMAGE_LITE_MODEL || process.env.SEEDREAM_5_LITE_MODEL || DEFAULT_SEEDREAM_5_LITE_MODEL,
    };
  }
  return { key, provider: "gpt", model: GPT_IMAGE_MODEL };
}

function canvasImageSizeFor(ratio, resolution) {
  const r = CANVAS_IMAGE_SIZE_TABLE[ratio] || CANVAS_IMAGE_SIZE_TABLE["16:9"];
  return r[String(resolution || "1k").toLowerCase()] || r["1k"];
}

// Seedream 5.0 rejects requests below 3,686,400 total pixels. Keep the UI's
// resolution/output size unchanged, but upscale only the provider request to
// the smallest 16px-aligned size that satisfies the model constraint.
function seedreamImageSizeFor(ratio, resolution) {
  const requested = canvasImageSizeFor(ratio, resolution);
  const match = requested.match(/^(\d+)x(\d+)$/);
  if (!match) return "2560x1440";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width * height >= SEEDREAM_MIN_IMAGE_PIXELS) return requested;
  const scale = Math.sqrt(SEEDREAM_MIN_IMAGE_PIXELS / (width * height));
  const alignedWidth = Math.ceil((width * scale) / 16) * 16;
  const alignedHeight = Math.ceil((height * scale) / 16) * 16;
  return `${alignedWidth}x${alignedHeight}`;
}

// GPT Image 的 image_generation 工具只接受方形、横向或纵向三种尺寸。
// 具体比例在生成完成后按 CANVAS_IMAGE_SIZE_TABLE 裁切，避免网关静默忽略自定义尺寸。
function canvasImageProviderSizeFor(ratio) {
  const [width, height] = String(ratio || "16:9").split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "1536x1024";
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

async function normalizeCanvasImageOutput(entry = {}) {
  if (!entry.outPath || !fs.existsSync(entry.outPath)) return false;
  const match = String(entry.size || "").match(/^(\d+)x(\d+)$/);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return false;
  const tempPath = `${entry.outPath}.ratio-${process.pid}-${Date.now()}.png`;
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-i", entry.outPath,
      "-vf", filter,
      "-frames:v", "1",
      "-f", "image2",
      tempPath,
    ], { stdio: ["ignore", "ignore", "pipe"], timeout: 120_000 });
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size < 1000) throw new Error("ffmpeg 未生成有效图片");
    fs.renameSync(tempPath, entry.outPath);
    return true;
  } catch (error) {
    entry.outputNormalizationError = compactLine(error?.message || "比例校正失败").slice(-240);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    return false;
  }
}

// 把画布传来的参考图（dataURL / /media?path= / /public-assets/ / file:// / https）解析成本地文件路径。
async function resolveCanvasImageReferenceToLocalPath(url = "") {
  const clean = compactLine(url);
  if (!clean) return "";
  if (isDataImageUrl(clean)) {
    const decoded = decodeDataImageUrl(clean);
    if (!decoded?.buffer?.length) return "";
    const publicUrl = persistDecodedPublicAsset(decoded, "canvas-image-ref");
    const name = path.basename(decodeURIComponent(publicUrl.replace(/^\/public-assets\//, "")));
    const file = path.join(CANVAS_PUBLIC_ASSET_DIR, name);
    return fs.existsSync(file) ? file : "";
  }
  const media = localMediaPathFromUrl(clean);
  if (media && fs.existsSync(media)) return media;
  const teamLibraryMedia = localTeamAssetLibraryPathFromUrl(clean);
  if (teamLibraryMedia && fs.existsSync(teamLibraryMedia)) return teamLibraryMedia;
  const publicAsset = localPublicAssetPathFromUrl(clean);
  if (publicAsset && fs.existsSync(publicAsset)) return publicAsset;
  const filePath = localFilePathFromUrl(clean);
  if (filePath && fs.existsSync(filePath)) return filePath;
  if (/^https?:\/\//i.test(clean) && !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(clean)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(clean, { signal: controller.signal });
      if (!response.ok) return "";
      const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
      if (contentType && !contentType.startsWith("image/")) return "";
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 25 * 1024 * 1024) return "";
      const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/gif" ? "gif" : "jpg";
      const name = `canvas-image-ref-${crypto.createHash("sha1").update(clean).digest("hex").slice(0, 16)}-${Date.now()}.${extension}`;
      const target = path.join(CANVAS_PUBLIC_ASSET_DIR, name);
      fs.mkdirSync(CANVAS_PUBLIC_ASSET_DIR, { recursive: true });
      fs.writeFileSync(target, buffer);
      return target;
    } catch {
      return "";
    } finally {
      clearTimeout(timer);
    }
  }
  return "";
}

async function completeCanvasImageJob(entry = {}) {
  if (!entry.outPath || !fs.existsSync(entry.outPath)) throw new Error("上游没有返回有效图片文件");
  await normalizeCanvasImageOutput(entry);
  const version = Math.round(fs.statSync(entry.outPath).mtimeMs);
  Object.assign(entry, {
    // 图片本体已经可读时就结束图片任务。对象存储上传和素材库写入不能阻塞前端拿到结果。
    status: "completed",
    url: `/public-assets/${encodeURIComponent(entry.fileName)}?v=${version}`,
    message: "生成完成",
  });
  // 入库失败不应把已生成的图片变成失败任务；结果仍通过本地 public-assets 地址可用。
  void finalizeGeneratedCanvasAsset(entry)
    .then(() => {
      entry.message = entry.libraryError
        ? `生成完成，但素材库保存失败：${entry.libraryError}`
        : entry.outputNormalizationError
          ? `生成完成，但比例校正失败：${entry.outputNormalizationError}`
          : "生成完成";
    })
    .catch((error) => {
      entry.message = `生成完成，但素材库保存失败：${compactLine(error?.message || "未知错误")}`;
    });
}

function recoverCanvasImageJobFromOutput(taskId = "") {
  const cleanTaskId = compactLine(taskId);
  if (!/^[a-z0-9-]{16,80}$/i.test(cleanTaskId)) return null;
  const directName = `canvas-image-${cleanTaskId}.png`;
  let fileName = directName;
  let outPath = path.join(CANVAS_PUBLIC_ASSET_DIR, directName);
  if (!fs.existsSync(outPath)) {
    const suffix = `-canvas-image-${cleanTaskId}.png`;
    try {
      fileName = fs.readdirSync(CANVAS_PUBLIC_ASSET_DIR).find((name) => name.endsWith(suffix)) || "";
    } catch {
      fileName = "";
    }
    outPath = fileName ? path.join(CANVAS_PUBLIC_ASSET_DIR, fileName) : "";
  }
  if (!outPath || !fs.existsSync(outPath)) return null;
  const stat = fs.statSync(outPath);
  if (!stat.isFile() || stat.size < 1000) return null;
  const version = Math.round(stat.mtimeMs);
  return {
    status: "completed",
    url: `/public-assets/${encodeURIComponent(fileName)}?v=${version}`,
    message: "生成完成（已从本地图片恢复）",
    imageModel: "gpt-image-2",
    provider: "gpt",
  };
}

function seedreamImageResult(raw = {}) {
  const candidates = [
    raw?.data?.[0],
    raw?.output?.[0],
    raw?.images?.[0],
    raw?.result?.data?.[0],
    raw?.result?.output?.[0],
  ].filter(Boolean);
  for (const item of candidates) {
    if (typeof item === "string") return { url: item };
    if (item.url || item.image_url || item.b64_json || item.base64 || item.image_base64) {
      return {
        url: item.url || item.image_url || "",
        b64: item.b64_json || item.base64 || item.image_base64 || "",
      };
    }
  }
  return null;
}

async function writeSeedreamImageResult(entry, raw) {
  const result = seedreamImageResult(raw);
  if (!result) throw new Error("Seedream 图片接口没有返回图片结果");
  let buffer;
  if (result.b64) {
    buffer = Buffer.from(result.b64, "base64");
  } else if (isDataImageUrl(result.url)) {
    buffer = decodeDataImageUrl(result.url)?.buffer;
  } else if (/^https?:\/\//i.test(result.url)) {
    const response = await fetchWithTimeout(result.url, { headers: { Accept: "image/*" } }, 180_000);
    if (!response.ok) throw new Error(`Seedream 返回图片下载失败（HTTP ${response.status}）`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (!buffer?.length || buffer.length > 50 * 1024 * 1024) throw new Error("Seedream 返回的图片内容无效");
  fs.writeFileSync(entry.outPath, buffer);
}

function seedreamImagePayload(entry = {}) {
  const payload = {
    model: entry.providerModel,
    prompt: entry.prompt,
    size: entry.providerSize || entry.size,
    response_format: "url",
    watermark: false,
    stream: false,
  };
  if (entry.referencePaths?.length) {
    const images = entry.referencePaths.map((file) => fileToDataUrl(file));
    payload.image = images.length === 1 ? images[0] : images;
  }
  return payload;
}

function isCanvasImagePolicyFailure(rawError = "") {
  return /moderation|safety|content[_\s-]?(?:policy|filter)|content_policy_violation|blocked|rejected|审核|敏感|违规|违禁|内容策略/i.test(String(rawError || ""));
}

function policySafeCanvasImagePrompt(prompt = "") {
  const replacements = [
    [/尸潮|丧尸|僵尸|亡灵|尸体|死尸/gi, "混乱人群的阴影"],
    [/鲜血|血液|血迹|血泊|血污|流血|血腥/gi, "非具象深色痕迹"],
    [/伤口|断肢|肢体残骸|内脏/gi, "衣物破损与散落物件"],
    [/杀戮|屠杀|砍杀|刺杀|打斗|搏斗|战斗/gi, "紧张对峙与快速躲避"],
    [/武器|匕首|刀剑|枪械|枪支/gi, "手持金属道具"],
    [/\bzombies?\b|\bundead\b|\bcorpses?\b|\bdead bod(?:y|ies)\b/gi, "shadowy crowd"],
    [/\bblood(?:y)?\b|\bgore\b|\bwounds?\b|\bsevered\b|\bdismembered\b/gi, "non-graphic dark trace"],
    [/\bmurder(?:ing)?\b|\bkill(?:ing)?\b|\bslaughter\b|\bstabb?(?:ing)?\b|\bfight(?:ing)?\b|\bcombat\b/gi, "tense evasion"],
    [/\bweapons?\b|\bguns?\b|\brifles?\b|\bknives?\b|\bswords?\b/gi, "handheld metal prop"],
  ];
  let safe = String(prompt || "");
  for (const [pattern, replacement] of replacements) safe = safe.replace(pattern, replacement);
  return [
    "Safety rendering adjustment: depict an age-appropriate, non-graphic dramatic situation. Keep all action implied and convey tension only through composition, lighting, movement, and environmental storytelling.",
    safe,
  ].filter(Boolean).join("\n\n");
}

function withCanvasImagePrompt(args = [], prompt = "") {
  const promptIndex = args.findIndex((value) => value === "--prompt");
  if (promptIndex < 0 || promptIndex + 1 >= args.length) return args;
  const next = [...args];
  next[promptIndex + 1] = prompt;
  return next;
}

async function runSeedreamCanvasImageJob(taskId, policyRetried = false, requestPrompt = "") {
  const entry = canvasImageJobs.get(taskId);
  if (!entry) return;
  try {
    const raw = await callArkImageJson(seedreamImagePayload({ ...entry, prompt: requestPrompt || entry.prompt }));
    await writeSeedreamImageResult(entry, raw);
    await completeCanvasImageJob(entry);
  } catch (error) {
    const detail = error?.message || "Seedream 图片生成失败";
    if (!policyRetried && isCanvasImagePolicyFailure(detail)) {
      Object.assign(entry, {
        status: "running",
        message: "提示词触发审核，正在按安全表达自动重试…",
        policyRetry: true,
      });
      return runSeedreamCanvasImageJob(taskId, true, policySafeCanvasImagePrompt(entry.prompt));
    }
    Object.assign(entry, { status: "failed", message: classifyImageGenError(detail, "ark") });
  }
}

function drainCanvasImageQueue() {
  while (canvasImageActiveJobs < CANVAS_IMAGE_MAX_CONCURRENCY && canvasImageQueue.length) {
    const queued = canvasImageQueue.shift();
    canvasImageActiveJobs += 1;
    const entry = canvasImageJobs.get(queued.taskId);
    if (entry) Object.assign(entry, { status: "running", message: "生成中" });
    Promise.resolve()
      .then(queued.run)
      .catch((error) => {
        const current = canvasImageJobs.get(queued.taskId);
        if (current) Object.assign(current, { status: "failed", message: `出图失败：${compactLine(error?.message || "未知错误")}` });
      })
      .finally(() => {
        canvasImageActiveJobs = Math.max(0, canvasImageActiveJobs - 1);
        drainCanvasImageQueue();
      });
  }
}

function enqueueCanvasImageJob(taskId, run) {
  const entry = canvasImageJobs.get(taskId);
  if (entry && (canvasImageActiveJobs >= CANVAS_IMAGE_MAX_CONCURRENCY || canvasImageQueue.length)) {
    Object.assign(entry, { status: "running", message: `排队中（当前并发上限 ${CANVAS_IMAGE_MAX_CONCURRENCY}）` });
  }
  canvasImageQueue.push({ taskId, run });
  drainCanvasImageQueue();
}

function runCanvasImageJob(taskId, args, env, attempt = 0, policyRetried = false) {
  return new Promise((resolve) => {
    let child;
    let stderr = "";
    let spawnError = "";
    try {
      child = spawn(process.execPath, args, { env });
    } catch (error) {
      const entry = canvasImageJobs.get(taskId);
      if (entry) Object.assign(entry, { status: "failed", message: `无法启动出图进程：${error.message}` });
      resolve();
      return;
    }
    const job = canvasImageJobs.get(taskId);
    if (job) job.child = child;
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", (error) => {
      spawnError = error.message || "无法启动出图进程";
    });
    child.on("close", async (code) => {
      const entry = canvasImageJobs.get(taskId);
      if (!entry) {
        resolve();
        return;
      }
      let retryScheduled = false;
      try {
        if (code === 0 && fs.existsSync(entry.outPath)) {
          await completeCanvasImageJob(entry);
        } else {
          const diagnostics = stderr || spawnError;
          const failMessage = classifyImageGenError(diagnostics) || `出图失败（退出码 ${code}）`;
          if (!policyRetried && isCanvasImagePolicyFailure(diagnostics)) {
            Object.assign(entry, {
              status: "running",
              message: "提示词触发审核，正在按安全表达自动重试…",
              policyRetry: true,
            });
            entry.child = null;
            retryScheduled = true;
            setTimeout(() => {
              runCanvasImageJob(taskId, withCanvasImagePrompt(args, policySafeCanvasImagePrompt(entry.prompt)), env, attempt, true).then(resolve, resolve);
            }, 0);
          // 网络、流中断、空结果、限流和 5xx 自动重试,最多 2 次;审核/参数类不重试。
          } else if (attempt < 2 && /stream|api_stream_error|no_image_result|read_error|unexpected eof|timeout|timed out|ETIMEDOUT|ECONNRESET|network|fetch failed|no available|rate.?limit|429|500|502|503|504|522|523|524|限流|超时|流/i.test(diagnostics)) {
            Object.assign(entry, { status: "running", message: `上游波动，正在自动重试（${attempt + 1}/2）…` });
            entry.child = null;
            retryScheduled = true;
            setTimeout(() => {
              runCanvasImageJob(taskId, args, env, attempt + 1, policyRetried).then(resolve, resolve);
            }, 4000 * (attempt + 1));
          } else {
            Object.assign(entry, { status: "failed", message: failMessage });
          }
        }
      } catch (error) {
        Object.assign(entry, {
          status: "failed",
          message: `出图后处理失败：${compactLine(error?.message || "未知错误")}`,
        });
      } finally {
        if (entry.child === child) entry.child = null;
      }
      if (!retryScheduled) resolve();
    });
  });
}

async function finalizeGeneratedCanvasAsset(entry = {}) {
  if (!entry.ownerUserId || !entry.outPath || !fs.existsSync(entry.outPath)) return null;
  try {
    const publicAsset = await createPublicCanvasAsset({
      name: entry.fileName || `canvas-image-${entry.taskId}.png`,
      dataUrl: fileToDataUrl(entry.outPath),
    });
    const record = await saveAssetToLibrary({
      id: `image_${entry.taskId}`,
      name: entry.prompt ? compactLine(entry.prompt).slice(0, 80) : entry.fileName,
      url: publicAsset.url || publicAsset.localUrl || entry.url,
      previewUrl: publicAsset.localUrl || publicAsset.url || entry.url,
      localUrl: publicAsset.localUrl || "",
      source: "image-generation",
      prompt: entry.prompt,
      ratio: entry.ratio,
      resolution: entry.resolution,
      assetStylePreset: "photoreal",
      assetStyleLabel: "AI 写实",
      generationMode: "ai-generated",
      verificationType: "ai-generated",
      aiGenerated: true,
      metadata: { taskId: entry.taskId, size: entry.size },
    }, entry.ownerUserId);
    entry.libraryAssetId = record?.id || "";
    entry.libraryAsset = record || null;
    return record;
  } catch (error) {
    entry.libraryError = compactLine(error.message || "素材库入库失败");
    return null;
  }
}

function classifyImageGenError(stderr = "", provider = "gpt") {
  const text = String(stderr || "");
  const detail = parseImageGenFailure(text);
  const status = Number(detail.status || 0);
  const upstreamMessage = detail.upstreamMessage || detail.message || "";
  if (status === 401 || status === 403) {
    return provider === "ark"
      ? "Seedream 出图鉴权失败：请检查 VOLC_ARK_API_KEY。"
      : "出图鉴权失败：请检查 OPENAI_API_KEY（apikey.fun 网关）。";
  }
  if (status === 429) return "生图接口限流（HTTP 429），请稍后重试。";
  if (isCanvasImagePolicyFailure(`${upstreamMessage} ${text}`)) return "提示词被安全审核拦截，请调整后重试。";
  if (status === 400 && upstreamMessage) return `生图请求参数错误（HTTP 400）：${upstreamMessage}`;
  if (status >= 500 && upstreamMessage) return `生图上游服务异常（HTTP ${status}）：${upstreamMessage}`;
  if (status && upstreamMessage) return `生图接口失败（HTTP ${status}）：${upstreamMessage}`;
  if (/invalid|unauthorized|401|api key|token|鉴权|密钥/i.test(text)) {
    return provider === "ark"
      ? "Seedream 出图鉴权失败：请检查 VOLC_ARK_API_KEY。"
      : "出图鉴权失败：请检查 OPENAI_API_KEY（apikey.fun 网关）。";
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(text)) return "出图超时，请重试或降低分辨率。";
  if (isCanvasImagePolicyFailure(text)) return "提示词被安全审核拦截，请调整后重试。";
  return text.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 200) || "";
}

async function createCanvasImageGeneration(body = {}) {
  const prompt = compactLine(body.prompt || "");
  if (!prompt) throw new Error("请先填写图片描述（prompt）");
  const modelConfig = canvasImageModelConfig(body.imageModel || body.model);
  if (modelConfig.provider === "gpt") {
    if (!imageApiKey()) throw new Error("缺少 OPENAI_API_KEY：GPT Image 2 出图需要 api.apikey.fun 的生图 Key，请在 .env.local 配置后重启服务。");
    if (!IMAGE_GEN_SKILL_SCRIPT || !fs.existsSync(IMAGE_GEN_SKILL_SCRIPT)) throw new Error("缺少 image-gen 脚本：请先安装 apikey.fun 的 image-gen skill。");
  } else if (!videoApiKey("ark")) {
    throw new Error("缺少 VOLC_ARK_API_KEY：Seedream 5.0 Pro/Lite 出图需要火山方舟 API Key，请在 .env.local 配置后重启服务。");
  }
  const ratio = CANVAS_IMAGE_SIZE_TABLE[body.ratio] ? body.ratio : "16:9";
  const resolution = ["1k", "2k", "4k"].includes(String(body.resolution || "").toLowerCase()) ? String(body.resolution).toLowerCase() : "1k";
  const size = canvasImageSizeFor(ratio, resolution);
  const providerSize = modelConfig.provider === "ark" ? seedreamImageSizeFor(ratio, resolution) : canvasImageProviderSizeFor(ratio);
  fs.mkdirSync(CANVAS_PUBLIC_ASSET_DIR, { recursive: true });
  const taskId = crypto.randomUUID();
  const fileName = `canvas-image-${taskId}.png`;
  const outPath = path.join(CANVAS_PUBLIC_ASSET_DIR, fileName);
  // 参考图（可选）：有则走 image 模式（首图为基准，其余为参考），否则纯文生图。
  const requestedReferences = (Array.isArray(body.referenceImages) ? body.referenceImages : []).map(compactLine).filter(Boolean).slice(0, 4);
  const references = (await Promise.all(requestedReferences.map(resolveCanvasImageReferenceToLocalPath))).filter(Boolean);
  if (requestedReferences.length && references.length !== requestedReferences.length) {
    throw new Error(`参考图解析失败：要求 ${requestedReferences.length} 张，实际解析到 ${references.length} 张。请重新上传或导入参考图。`);
  }
  const timeout = String(Number.parseInt(process.env.PIXEL_TOYS_IMAGE_TIMEOUT_SECONDS || "900", 10));
  let args;
  if (modelConfig.provider === "gpt") {
    if (references.length) {
      args = [
        IMAGE_GEN_SKILL_SCRIPT, "--mode", "image",
        "--image", references[0],
        "--prompt", prompt, "--size", providerSize,
        "--model", process.env.PIXEL_TOYS_IMAGE_ORCHESTRATION_MODEL || "gpt-5.4-mini",
        "--image-model", modelConfig.model,
        "--out", outPath, "--timeout", timeout,
      ];
      if (references.length > 1) args.push("--reference-image", references.slice(1).join(path.delimiter));
    } else {
      args = [IMAGE_GEN_SKILL_SCRIPT, "--mode", "text", "--prompt", prompt, "--size", providerSize, "--model", modelConfig.model, "--orchestration-model", process.env.PIXEL_TOYS_IMAGE_ORCHESTRATION_MODEL || "gpt-5.4-mini", "--out", outPath, "--timeout", timeout];
    }
  }
  const env = { ...process.env, OPENAI_API_KEY: imageApiKey() || process.env.OPENAI_API_KEY || "" };
  canvasImageJobs.set(taskId, {
    taskId, // fix:image_undefined — finalize 用 entry.taskId 生成库 id,缺此字段会导致 id 恒为 image_undefined,每次覆盖同一条
    status: "running",
    message: "生成中",
    url: "",
    outPath,
    fileName,
    ratio,
    resolution,
    size,
    providerSize,
    imageModel: modelConfig.key,
    provider: modelConfig.provider,
    providerModel: modelConfig.model,
    referencePaths: references,
    prompt,
    ownerUserId: compactLine(body.ownerUserId || ""),
    createdAt: Date.now(),
    child: null,
  });
  if (modelConfig.provider === "ark") enqueueCanvasImageJob(taskId, () => runSeedreamCanvasImageJob(taskId));
  else enqueueCanvasImageJob(taskId, () => runCanvasImageJob(taskId, args, env));
  // 清理老任务（>30 分钟）避免内存无界增长。
  for (const [id, job] of canvasImageJobs) {
    if (Date.now() - (job.createdAt || 0) > 30 * 60 * 1000 && job.status !== "running") canvasImageJobs.delete(id);
  }
  return { taskId, status: "running", size, ratio, resolution, imageModel: modelConfig.key, provider: modelConfig.provider };
}

function getCanvasImageGeneration(taskId) {
  const cleanTaskId = compactLine(taskId);
  const job = canvasImageJobs.get(cleanTaskId);
  if (!job) return recoverCanvasImageJobFromOutput(cleanTaskId) || { status: "failed", message: "任务不存在或已过期，请重新生成" };
  return {
    status: job.status,
    url: job.url || "",
    message: job.message || "",
    size: job.size,
    ratio: job.ratio,
    resolution: job.resolution,
    imageModel: job.imageModel || "gpt-image-2",
    provider: job.provider || "gpt",
    libraryAssetId: job.libraryAssetId || "",
    libraryAsset: job.libraryAsset || null,
  };
}

function projectAssetForVideoPayload(episodeRoot, asset = {}) {
  const rel = compactLine(asset.file || asset.rel || "");
  const localPath = rel ? path.join(episodeRoot, rel) : "";
  const url = localPath && fs.existsSync(localPath) ? `/media?path=${encodeURIComponent(localPath)}` : compactLine(asset.url || asset.previewUrl || "");
  return {
    id: compactLine(asset.name || asset.assetName || ""),
    name: compactLine(asset.name || asset.assetName || ""),
    label: compactLine(asset.label || ""),
    evidence: compactLine(asset.evidence || ""),
    visual: compactLine(asset.visual || ""),
    matchCode: compactLine(asset.matchCode || ""),
    type: asset.manifestType || asset.type || "",
    url,
    previewUrl: url,
    assetUrl: compactLine(asset.assetUrl || asset.asset_url || ""),
    publicUrl: compactLine(asset.publicUrl || asset.public_url || ""),
    groupId: compactLine(asset.groupId || asset.group_id || ""),
    validationStatus: compactLine(asset.validationStatus || asset.validation_status || ""),
    validationError: compactLine(asset.validationError || asset.validation_error || ""),
    virtualId: compactLine(asset.virtualId || asset.virtual_id || ""),
    assetStylePreset: compactLine(asset.assetStylePreset || ""),
    assetStyleLabel: compactLine(asset.assetStyleLabel || ""),
    generationMode: compactLine(asset.generationMode || asset.generation_mode || ""),
    aiGenerated: asset.aiGenerated === true,
    verificationType: compactLine(asset.verificationType || asset.verification_type || ""),
    // 方舟私域虚拟人像绑定状态必须透传:asset:// 只存在 arkPersonAsset.assetUrl,
    // 丢了它 → 提交时 canvasVideoAssetSubmitUrl 拿不到 asset:// → 退回发原图 → 被上游判真人 400。
    arkPersonAsset:
      asset.arkPersonAsset && typeof asset.arkPersonAsset === "object"
        ? {
            enabled: asset.arkPersonAsset.enabled === true,
            assetId: compactLine(asset.arkPersonAsset.assetId || ""),
            assetUrl: /^asset:\/\//i.test(compactLine(asset.arkPersonAsset.assetUrl || ""))
              ? compactLine(asset.arkPersonAsset.assetUrl)
              : "",
            groupId: compactLine(asset.arkPersonAsset.groupId || ""),
            status: compactLine(asset.arkPersonAsset.status || ""),
            boundAt: compactLine(asset.arkPersonAsset.boundAt || ""),
            error: compactLine(asset.arkPersonAsset.error || ""),
          }
        : undefined,
  };
}

function scannedProjectAssetByName(episodeRoot) {
  const map = new Map();
  for (const asset of scanAssets(episodeRoot)) {
    const name = compactLine(asset.assetName || path.basename(asset.name || "", path.extname(asset.name || "")));
    if (!name) continue;
    map.set(name, {
      file: asset.rel || "",
      manifestType: asset.manifestType || "",
      type: "image",
      assetStylePreset: asset.assetStylePreset || "",
      assetStyleLabel: asset.assetStyleLabel || "",
      generationMode: asset.generationMode || "",
      url: asset.url || "",
      previewUrl: asset.url || "",
    });
  }
  return map;
}

function hydrateProjectVideoAssets(episodeRoot, config = {}) {
  const scannedByName = scannedProjectAssetByName(episodeRoot);
  let changed = false;
  const assets = (Array.isArray(config.assets) ? config.assets : []).map((asset) => {
    const name = compactLine(asset?.name || asset?.assetName || "");
    const promptMeta = promptMetaForAsset(episodeRoot, name) || {};
    const scanned = {
      ...(scannedByName.get(name) || {}),
      assetStylePreset: promptMeta.assetStylePreset || scannedByName.get(name)?.assetStylePreset || "",
      assetStyleLabel: promptMeta.assetStyleLabel || scannedByName.get(name)?.assetStyleLabel || "",
      generationMode: promptMeta.mode || scannedByName.get(name)?.generationMode || "",
    };
    const next = { ...asset };
    for (const key of ["file", "manifestType", "assetStylePreset", "assetStyleLabel", "generationMode"]) {
      if (!compactLine(next[key] || "") && compactLine(scanned[key] || "")) {
        next[key] = scanned[key];
        changed = true;
      }
    }
    return next;
  });
  return { config: changed ? { ...config, assets } : config, changed };
}

function projectPhotorealGroupId(config = {}) {
  return compactLine(
    config.photorealAssetGroupId ||
      config.personAssetGroupId ||
      config.livenessLibrary?.groupId ||
      config.assetLibrary?.groupId ||
      config.settings?.photorealAssetGroupId ||
      config.settings?.personAssetGroupId ||
      "",
  );
}

function projectAssetLibraryPatch(group = {}, fallbackGroupId = "") {
  const groupId = compactLine(group.group_id || group.groupId || fallbackGroupId || "");
  if (!groupId) return {};
  return {
    photorealAssetGroupId: groupId,
    assetLibrary: {
      groupId,
      groupType: compactLine(group.group_type || group.groupType || "aigc"),
      name: compactLine(group.name || "超写实素材组"),
      description: compactLine(group.description || ""),
      channelId: group.channel_id || group.channelId || "",
      updatedAt: new Date().toISOString(),
    },
  };
}

function mergeValidatedProjectAssets(config = {}, validatedAssets = []) {
  const byId = new Map();
  const remember = (key, asset) => {
    const cleanKey = compactLine(key);
    if (cleanKey && !byId.has(cleanKey)) byId.set(cleanKey, asset);
  };
  for (const asset of validatedAssets || []) {
    remember(asset.id || asset.name, asset);
    remember(asset.name, asset);
    remember(asset.assetUrl || asset.asset_url, asset);
    remember(asset.virtualId || asset.virtual_id, asset);
    const assetIdFromUrl = compactLine(asset.assetUrl || asset.asset_url || "").replace(/^asset:\/\//i, "");
    remember(assetIdFromUrl, asset);
  }
  let changed = false;
  const assets = (Array.isArray(config.assets) ? config.assets : []).map((asset) => {
    const id = compactLine(asset?.name || asset?.assetName || asset?.id || "");
    const assetUrl = compactLine(asset?.assetUrl || asset?.asset_url || "");
    const virtualId = compactLine(asset?.virtualId || asset?.virtual_id || "");
    const assetIdFromUrl = assetUrl.replace(/^asset:\/\//i, "");
    const validated = byId.get(id) || byId.get(assetUrl) || byId.get(virtualId) || byId.get(assetIdFromUrl);
    if (!validated) return asset;
    const next = {
      ...asset,
      publicUrl: compactLine(validated.publicUrl || validated.public_url || asset.publicUrl || ""),
      localAssetUrl: compactLine(validated.localAssetUrl || asset.localAssetUrl || ""),
      assetUrl: compactLine(validated.assetUrl || validated.asset_url || asset.assetUrl || ""),
      groupId: compactLine(validated.groupId || validated.group_id || asset.groupId || ""),
      virtualId: compactLine(validated.virtualId || validated.virtual_id || asset.virtualId || ""),
      validationStatus: compactLine(validated.validationStatus || asset.validationStatus || ""),
      validationError: compactLine(validated.validationError || ""),
      validationMessage: compactLine(validated.message || validated.validationMessage || ""),
      assetStylePreset: compactLine(validated.assetStylePreset || asset.assetStylePreset || ""),
      assetStyleLabel: compactLine(validated.assetStyleLabel || asset.assetStyleLabel || ""),
    };
    if (JSON.stringify(next) !== JSON.stringify(asset)) changed = true;
    return next;
  });
  return { config: changed ? { ...config, assets } : config, changed };
}

function projectShotReferenceAssets(config = {}, shot = {}) {
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : []).map((asset) => [asset.name, asset]));
  return (Array.isArray(shot.refs) ? shot.refs : []).map((ref) => assetByName.get(ref)).filter(Boolean);
}

function isProductionBoardMode(config = {}, shot = null) {
  return (
    compactLine(config.settings?.promptMode || "").toLowerCase() === "production_board" ||
    config.settings?.enableStoryboards === true ||
    compactLine(shot?.videoPromptMode || "").toLowerCase() === "production_board"
  );
}

function projectShotStoryboardAssets(config = {}, shot = {}) {
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : []).map((asset) => [asset.name, asset]));
  return (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : []).map((ref) => assetByName.get(ref)).filter(Boolean);
}

function projectShotAllVideoReferenceAssets(config = {}, shot = {}) {
  const sourceAssets = isProductionBoardMode(config, shot)
    ? projectShotStoryboardAssets(config, shot)
    : projectShotReferenceAssets(config, shot);
  const refs = [];
  const seen = new Set();
  for (const asset of sourceAssets) {
    const key = compactLine(asset?.name || asset?.assetName || asset?.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    refs.push(asset);
  }
  return refs;
}

function videoReferenceAssetPotentialUrls(asset = {}) {
  return [
    asset.assetUrl,
    asset.asset_url,
    asset.publicUrl,
    asset.public_url,
    asset.url,
    asset.previewUrl,
    asset.localAssetUrl,
    asset.localUrl,
  ].map(compactLine).filter(Boolean);
}

function videoReferenceAssetHasPotentialSource(asset = {}) {
  return videoReferenceAssetPotentialUrls(asset).some((url) => {
    if (/^(asset:\/\/|https?:\/\/|data:image\/|file:\/\/|\/media\?|\/public-assets\/)/i.test(url)) return true;
    return false;
  });
}

function projectShotUsableVideoReferenceAssets(episodeRoot = "", config = {}, shot = {}) {
  const configured = new Map(
    projectShotAllVideoReferenceAssets(config, shot).map((asset) => [compactLine(asset?.name || asset?.assetName || asset?.id || ""), asset]),
  );
  const names = (isProductionBoardMode(config, shot)
    ? (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [])
    : (Array.isArray(shot.refs) ? shot.refs : []))
    .map(compactLine)
    .filter(Boolean);
  return [...new Set(names)]
    .map((name) => configured.get(name) || (episodeRoot ? resolveScannedAssetByName(episodeRoot, name) : null))
    .filter(Boolean)
    .map((asset) => (episodeRoot ? projectAssetForVideoPayload(episodeRoot, asset) : asset))
    .filter(videoReferenceAssetHasPotentialSource);
}

function videoSubmissionReferenceNames(config = {}, shots = []) {
  const names = new Set();
  for (const shot of Array.isArray(shots) ? shots : []) {
    const references = isProductionBoardMode(config, shot)
      ? (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [])
      : (Array.isArray(shot.refs) ? shot.refs : []);
    for (const reference of references) {
      const name = compactLine(reference);
      if (name) names.add(name);
    }
  }
  return [...names];
}

function tailFrameSnapshotForShot(episodeRoot, shotName, runNamespace = "") {
  const snapshot =
    snapshotStatusForShot(episodeRoot, shotName, { runNamespace }) ||
    (runNamespace ? snapshotStatusForShot(episodeRoot, shotName) : null);
  if (!snapshot?.tailFrameReady) return null;
  const localRel = compactLine(snapshot.tailFrameLocalFile || "");
  const localFile = localRel ? path.join(episodeRoot, localRel) : "";
  const url = localFile && fs.existsSync(localFile)
    ? pathToFileURL(localFile).href
    : compactLine(snapshot.tailFrameUrl || "");
  if (!url) return null;
  return {
    url,
    previewUrl: snapshot.tailFrameUrl || "",
    localFile,
    source: snapshot.tailFrameSource || "",
  };
}

const PREPARE_REFS_TIMEOUT_MS = 8 * 60 * 1000;
const PREPARE_REFS_POLL_MS = 8000;

function resolveScannedAssetByName(episodeRoot, name) {
  const clean = compactLine(name);
  if (!clean) return null;
  return scanAssets(episodeRoot).find((a) => compactLine(a.assetName) === clean) || null;
}
function mergeConfigAssetPatch(config, name, patch) {
  const list = Array.isArray(config.assets) ? config.assets : (config.assets = []);
  const clean = compactLine(name);
  let entry = list.find((a) => compactLine(a.name || a.assetName || "") === clean);
  if (!entry) { entry = { name: clean }; list.push(entry); }
  Object.assign(entry, patch);
  return entry;
}

// 阶段0:把本批引用的参考图统一备好可提交地址。人物轨->素材库 active asset://;非人物轨->稳定公网。
// 返回 { ready, stuck:[{name,track,status,reason}], config }。ready=false 时调用方整批中止。
// 解析某引用名的"可用图源"资产:优先已验证 asset://,其次 config 里的公网,最后磁盘扫描的 /media(config 条目常缺 url)。
function referenceAssetSource(episodeRoot, assetByName, name) {
  const cfg = assetByName.get(name) || null;
  const scanned = resolveScannedAssetByName(episodeRoot, name);
  if (!cfg && !scanned) return null;
  const base = cfg || scanned || {};
  const assetUrl = compactLine((cfg && cfg.assetUrl) || "");
  const publicUrl = compactLine((cfg && cfg.publicUrl) || "");
  const source = assetUrl || publicUrl || compactLine((cfg && cfg.url) || (scanned && scanned.url) || (base && base.previewUrl) || "");
  return { ...base, name, assetUrl, publicUrl, url: source };
}

// 批量链路:把单个超写实素材认证进火山虚拟人像库并轮询到 active。永不抛错——
// 失败/超时返回非 active 状态,交由就绪校验停止对应片段(不静默删引用、不卡死整批)。
async function ensureBatchArkVirtualPerson(asset, deadlineTs) {
  const existing = (asset && asset.arkPersonAsset) || {};
  const existingUrl = compactLine(existing.assetUrl || "");
  if (existing.enabled === true && compactLine(existing.status || "").toLowerCase() === "active" && /^asset:\/\//i.test(existingUrl)) {
    return { status: "active", assetUrl: existingUrl, assetId: compactLine(existing.assetId || ""), error: "" };
  }
  try {
    let assetId = compactLine(existing.assetId || "");
    let assetUrl = existingUrl;
    let status = compactLine(existing.status || "").toLowerCase();
    if (!assetId) {
      const created = await createArkVirtualPersonAsset({ asset: { ...asset, aiGenerated: true, verificationType: compactLine(asset.verificationType || "") || "ai-generated" } });
      assetId = compactLine(created.assetId || "");
      assetUrl = compactLine(created.assetUrl || (assetId ? `asset://${assetId}` : ""));
      status = compactLine(created.status || "processing").toLowerCase();
    }
    while (status !== "active" && status !== "failed" && Date.now() < deadlineTs) {
      await new Promise((r) => setTimeout(r, PREPARE_REFS_POLL_MS));
      const got = await getArkVirtualPersonAsset(assetId);
      status = compactLine(got.status || "").toLowerCase();
      if (got.assetUrl) assetUrl = compactLine(got.assetUrl);
      if (status === "failed") return { status: "failed", assetUrl, assetId, error: compactLine(got.error || "火山虚拟人像认证失败") };
    }
    if (status === "active" && /^asset:\/\//i.test(assetUrl)) return { status: "active", assetUrl, assetId, error: "" };
    return { status: status || "processing", assetUrl, assetId, error: status === "failed" ? "火山虚拟人像认证失败" : "火山虚拟人像认证超时未 active" };
  } catch (e) {
    return { status: "failed", assetUrl: "", assetId: compactLine(existing.assetId || ""), error: compactLine(e && e.message ? e.message : "火山虚拟人像认证异常") };
  }
}

// 项目短剧统一按模型边界筛选 Ark 人物轨;person-reference 继续走 Gravitex。
function arkPersonReferenceNames(episodeRoot, config = {}, names = [], shot = {}) {
  const usesGravitexPersonRef = projectVideoModelForShot(config, shot) === "seedance-2-0-person-reference";
  if (usesGravitexPersonRef) return [];
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
  return [...new Set((Array.isArray(names) ? names : []).map(compactLine).filter(Boolean))].filter((name) => {
    const asset = referenceAssetSource(episodeRoot, assetByName, name);
    return asset && isArkPersonReferenceAsset(asset);
  });
}

async function ensureArkPersonAssetsForNames(episodeRoot, configRecord, names, deadlineTs, shot = {}) {
  let config = configRecord && configRecord.data ? configRecord.data : {};
  const arkPersonNames = arkPersonReferenceNames(episodeRoot, config, names, shot);
  if (!arkPersonNames.length) return config;
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
  const arkGroupId = arkVirtualPersonConfig().groupId;
  for (const name of arkPersonNames) {
    const asset = referenceAssetSource(episodeRoot, assetByName, name);
    if (!asset) {
      mergeConfigAssetPatch(config, name, { arkPersonAsset: { enabled: true, status: "failed", error: "找不到图源" } });
      writeVideoConfigRecord(configRecord, config);
      continue;
    }
    const existing = asset.arkPersonAsset || {};
    const existingUrl = compactLine(existing.assetUrl || "");
    const alreadyActive = existing.enabled === true && compactLine(existing.status || "").toLowerCase() === "active" && /^asset:\/\//i.test(existingUrl);
    const r = alreadyActive
      ? { status: "active", assetUrl: existingUrl, assetId: compactLine(existing.assetId || ""), error: "" }
      : await ensureBatchArkVirtualPerson(asset, deadlineTs);
    mergeConfigAssetPatch(config, name, {
      arkPersonAsset: {
        enabled: true,
        assetId: r.assetId || existing.assetId || "",
        assetUrl: r.assetUrl || "",
        groupId: arkGroupId,
        status: r.status,
        boundAt: new Date().toISOString(),
        error: r.error || "",
      },
    });
    writeVideoConfigRecord(configRecord, config);
  }
  if (configRecord) configRecord.data = config;
  return config;
}

async function prepareBatchVideoReferences(episodeRoot, configRecord, shots, options = {}) {
  const timeoutMs = Number(options.timeoutMs || PREPARE_REFS_TIMEOUT_MS);
  let config = configRecord && configRecord.data ? configRecord.data : {};
  const names = videoSubmissionReferenceNames(config, shots);
  const classified = classifyReferenceAssets(names);
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
  const usesGravitexPersonRef = normalizeVideoConfigModelName(config.modelName || DEFAULT_VIDEO_CONFIG_MODEL) === "seedance-2-0-person-reference";
  // 超写实素材、或角色类素材(含被平台误判真人的风格化角色):统一走火山虚拟人像库,
  // 认证成 asset:// 后作为人物参考,绕过视频接口真人/隐私审核;其余素材走公网 HTTPS 直传。
  // 项目资产均为管线 AI 生成,认证阶段强制 aiGenerated;道具/场景非角色不纳入。
  // person-reference 模型保留 Gravitex 人物素材库流程(交接文档边界)。
  const arkPersonNames = arkPersonReferenceNames(episodeRoot, config, names);
  const arkPersonSet = new Set(arkPersonNames);
  const personTrack = usesGravitexPersonRef ? classified.personTrack : [];
  const publicTrack = usesGravitexPersonRef ? classified.publicTrack : names.filter((n) => !arkPersonSet.has(n));

  // 非人物轨:确保稳定公网 https;结果(含错误)写回 config。无论本批是否含人物轨都立即落盘,
  // 否则后续 generateProjectVideoShot 重读旧 config 会丢失刚备好的 publicUrl(修 #1)。
  let publicChanged = false;
  for (const name of publicTrack) {
    const asset = referenceAssetSource(episodeRoot, assetByName, name);
    if (!asset) {
      mergeConfigAssetPatch(config, name, { publicReady: false, publicError: "找不到图源" });
      publicChanged = true;
      continue;
    }
    const ensured = await ensurePublicReferenceUrl(asset);
    mergeConfigAssetPatch(config, name, {
      publicUrl: ensured.publicUrl || "",
      publicReady: ensured.publicReady === true,
      publicError: ensured.publicReady === true ? "" : compactLine(ensured.publicError || "无法生成公网地址"),
    });
    publicChanged = true;
  }
  if (publicChanged) writeVideoConfigRecord(configRecord, config);

  // 超写实素材轨:自动认证进火山虚拟人像库(asset://)并轮询到 active。失败/超时不抛错,
  // 写入 arkPersonAsset.status(failed/processing),由就绪校验停止对应片段(不静默删引用)。
  if (arkPersonNames.length) config = await ensureArkPersonAssetsForNames(episodeRoot, configRecord, arkPersonNames, Date.now() + timeoutMs);

  // 人物轨:先把引用名补种进 config.assets(修 #3:磁盘有、config 无的资产验证结果才回写得进去),再验证 + 轮询 active。
  const personAssets = [];
  for (const name of personTrack) {
    const asset = referenceAssetSource(episodeRoot, assetByName, name);
    if (!asset || !compactLine(asset.assetUrl || asset.url || "")) {
      mergeConfigAssetPatch(config, name, { validationStatus: "failed", validationError: "找不到图源" });
      continue;
    }
    mergeConfigAssetPatch(config, name, { name });
    personAssets.push(asset);
  }
  if (personAssets.length) {
    const validation = await validateCanvasPhotorealAssets({
      groupId: projectPhotorealGroupId(config),
      name: config.groupName || "参考素材组",
      channelId: (config.settings && config.settings.channelId) || (config.assetLibrary && config.assetLibrary.channelId) || "",
      assets: personAssets,
    });
    config = mergeValidatedProjectAssets({ ...config, ...projectAssetLibraryPatch(validation.group, projectPhotorealGroupId(config)) }, validation.assets || []).config;
    writeVideoConfigRecord(configRecord, config);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const refreshed = await refreshConfigAssetLibraryStatuses(config);
      config = refreshed.config;
      writeVideoConfigRecord(configRecord, config);
      const cur = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
      const pendingPerson = personTrack.filter((n) => {
        const a = cur.get(n) || {};
        const st = compactLine(a.validationStatus || "").toLowerCase();
        return !(st === "active" && /^asset:\/\//i.test(compactLine(a.assetUrl || "")));
      });
      const failed = personTrack.filter((n) => compactLine((cur.get(n) || {}).validationStatus || "").toLowerCase() === "failed");
      if (!pendingPerson.length) break;
      if (failed.length) break;
      await new Promise((r) => setTimeout(r, PREPARE_REFS_POLL_MS));
    }
  }

  const cur = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
  const items = names.map((name) => {
    const a = cur.get(name) || {};
    if (arkPersonSet.has(name)) {
      const ap = a.arkPersonAsset || {};
      // 火山虚拟人像轨:就绪 = status active 且 asset://(evaluateReferenceReadiness 对 person 轨的判定)。
      return { name, track: "person", status: compactLine(ap.status || ""), assetUrl: compactLine(ap.assetUrl || ""), publicUrl: "", error: compactLine(ap.error || "") };
    }
    const track = personTrack.includes(name) ? "person" : "public";
    return {
      name,
      track,
      status: compactLine(a.validationStatus || (a.publicReady ? "public" : "")),
      assetUrl: compactLine(a.assetUrl || ""),
      publicUrl: compactLine(a.publicUrl || ""),
      error: compactLine(a.validationError || a.publicError || ""),
    };
  });
  const { ready, stuck } = evaluateReferenceReadiness(items);
  return {
    ready,
    stuck,
    skipped: stuck,
    config,
    message: stuck.length ? `有 ${stuck.length} 个参考资产未就绪，已阻止批量提交。` : "",
  };
}

async function ensureProjectPhotorealReferencesReady(episodeRoot, configRecord, shot) {
  // 语义:只读检查本段引用是否已就绪(person=active asset://,public=公网 url)。
  // 实际的素材库验证/公网预上传由批量入口的阶段0(prepareBatchVideoReferences)完成;
  // 这里不再重新验证、不轮询、不看 modelName。函数名中的 photoreal 为历史遗留。
  const hydrated = hydrateProjectVideoAssets(episodeRoot, (configRecord && configRecord.data) || {});
  let config = hydrated.config;
  if (hydrated.changed) writeVideoConfigRecord(configRecord, config);
  const names = videoSubmissionReferenceNames(config, [shot]);
  if (!names.length) return { config, ready: true, summary: { total: 0, active: 0, pending: 0, failed: 0, skipped: 0 } };
  const usesGravitexPersonRef = projectVideoModelForShot(config, shot) === "seedance-2-0-person-reference";
  const byName = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
  // 超写实素材走火山虚拟人像轨(读 arkPersonAsset);person-reference 模型走 Gravitex 人物轨;其余公网轨。
  const arkPersonSet = new Set(usesGravitexPersonRef ? [] : names.filter((n) => {
    const a = referenceAssetSource(episodeRoot, byName, n);
    return a && isArkPersonReferenceAsset(a);
  }));
  const personTrack = usesGravitexPersonRef ? classifyReferenceAssets(names).personTrack : [];
  const items = names.map((name) => {
    const a = byName.get(name) || {};
    if (arkPersonSet.has(name)) {
      const ap = a.arkPersonAsset || {};
      return { name, track: "person", status: compactLine(ap.status || ""), assetUrl: compactLine(ap.assetUrl || ""), publicUrl: "", error: compactLine(ap.error || "") };
    }
    return {
      name,
      track: personTrack.includes(name) ? "person" : "public",
      status: compactLine(a.validationStatus || (a.publicReady ? "public" : "")),
      assetUrl: compactLine(a.assetUrl || ""),
      publicUrl: compactLine(a.publicUrl || ""),
      error: compactLine(a.validationError || a.publicError || ""),
    };
  });
  const { stuck } = evaluateReferenceReadiness(items);
  // 超写实素材必须完成火山虚拟人像认证(active + asset://)才提交:未就绪则停止该片段并报错,
  // 不静默按提示词生成(交接文档:批量必须停,禁止静默删引用)。
  const arkStuck = stuck.filter((s) => arkPersonSet.has(s.name));
  if (arkStuck.length) {
    return {
      config,
      ready: false,
      skipped: stuck,
      summary: { total: names.length, active: names.length - stuck.length, pending: arkStuck.length, failed: 0, skipped: stuck.length },
      message: `超写实素材未完成火山虚拟人像认证：${arkStuck.map((s) => `${s.name}（${s.reason || s.status || "未 active"}）`).join("、")}，已停止该片段。`,
    };
  }
  return {
    config,
    ready: true,
    skipped: stuck,
    summary: { total: names.length, active: names.length - stuck.length, pending: 0, failed: 0, skipped: stuck.length },
    message: stuck.length ? `有 ${stuck.length} 个参考资产未就绪，默认按提示词生成。` : "",
  };
}

function projectTailFrameNeedsArkPersonPreparation(episodeRoot, config = {}, shot = {}) {
  if (projectVideoModelForShot(config, shot) === "seedance-2-0-person-reference") return false;
  if (isProductionBoardMode(config, shot) || shot?.useTailFrame !== true || !shot.tailFrameSource) return false;
  const tailFrame = tailFrameSnapshotForShot(episodeRoot, shot.tailFrameSource, currentRunNamespace(episodeRoot, config));
  if (!tailFrame?.localFile || !fs.existsSync(tailFrame.localFile) || /\.(mp4|mov|webm|m4v)$/i.test(tailFrame.localFile)) return false;
  const id = `${compactLine(shot.name || "shot")}_START_FRAME`;
  const asset = config.tailFrameAssets?.[id] || {};
  return !(compactLine(asset.status || asset.validationStatus || "").toLowerCase() === "active" && /^asset:\/\//i.test(compactLine(asset.assetUrl || "")));
}

async function ensureTailFrameAssetReference(episodeRoot, config = {}, shot = {}, startFrameUrl = "") {
  const cleanStartFrameUrl = compactLine(startFrameUrl || "");
  if (!cleanStartFrameUrl || /^asset:\/\//i.test(cleanStartFrameUrl)) return { url: cleanStartFrameUrl, config, ready: true, message: "" };
  if (!shot?.useTailFrame || !shot.tailFrameSource) return { url: cleanStartFrameUrl, config, ready: true, message: "" };
  const localFile = localFilePathFromUrl(cleanStartFrameUrl) || localMediaPathFromUrl(cleanStartFrameUrl) || (cleanStartFrameUrl.startsWith("file:") ? fileURLToPath(cleanStartFrameUrl) : "");
  if (!localFile || !fs.existsSync(localFile)) return { url: cleanStartFrameUrl, config, ready: true, message: "" };
  const modelName = projectVideoModelForShot(config, shot);
  const id = `${compactLine(shot.name || "shot")}_START_FRAME`;
  const previous = config.tailFrameAssets?.[id] || {};

  // Ark 的 asset:// 必须来自方舟私域虚拟人像素材库,与角色参考图使用同一认证通道。
  // 整帧图若被方舟审核拒绝,保持 waiting,绝不把原图继续交给视频接口。
  if (modelName !== "seedance-2-0-person-reference") {
    const arkGroupId = arkVirtualPersonConfig().groupId;
    if (!arkGroupId) return { url: cleanStartFrameUrl, config, ready: false, message: "上一段尾帧需要先有方舟私域虚拟人像素材组，才能转为 asset:// 首帧引用。" };
    if (/^asset:\/\//i.test(compactLine(previous.assetUrl || "")) && compactLine(previous.status || previous.validationStatus || "").toLowerCase() === "active") {
      return { url: previous.assetUrl, config, ready: true, message: "已复用尾帧 asset:// 引用" };
    }
    const result = await ensureBatchArkVirtualPerson(
      {
        id,
        name: id,
        type: "TailFrame",
        assetStylePreset: "photoreal",
        generationMode: "ai-generated",
        aiGenerated: true,
        verificationType: "ai-generated",
        url: `/media?path=${encodeURIComponent(localFile)}`,
        previewUrl: `/media?path=${encodeURIComponent(localFile)}`,
        arkPersonAsset: {
          enabled: true,
          assetId: compactLine(previous.assetId || ""),
          assetUrl: compactLine(previous.assetUrl || ""),
          status: compactLine(previous.status || previous.validationStatus || ""),
        },
      },
      Date.now() + PREPARE_REFS_TIMEOUT_MS,
    );
    const nextConfig = {
      ...config,
      tailFrameAssets: {
        ...(config.tailFrameAssets || {}),
        [id]: {
          sourceShot: shot.tailFrameSource || "",
          targetShot: shot.name || "",
          localFile: path.relative(episodeRoot, localFile),
          publicUrl: previous.publicUrl || "",
          assetUrl: result.assetUrl || previous.assetUrl || "",
          assetId: result.assetId || previous.assetId || "",
          virtualId: previous.virtualId || "",
          groupId: arkGroupId,
          status: result.status || "processing",
          message: result.error || "",
          updatedAt: new Date().toISOString(),
        },
      },
    };
    if (result.status === "active" && /^asset:\/\//i.test(compactLine(result.assetUrl || ""))) {
      return { url: result.assetUrl, config: nextConfig, ready: true, message: "尾帧已通过方舟虚拟人像认证，转为 asset:// 首帧引用" };
    }
    return {
      url: cleanStartFrameUrl,
      config: nextConfig,
      ready: false,
      message: result.error || "上一段尾帧正在进行方舟虚拟人像认证，待 active 后再提交视频，避免被真实人物/隐私拦截。",
    };
  }

  const groupId = projectPhotorealGroupId(config);
  if (!groupId) return { url: cleanStartFrameUrl, config, ready: false, message: "上一段尾帧包含人物时需要先有素材库 group_id，才能转为 asset:// 首帧引用。" };
  if (/^asset:\/\//i.test(compactLine(previous.assetUrl || "")) && compactLine(previous.status || previous.validationStatus || "").toLowerCase() === "active") {
    return { url: previous.assetUrl, config, ready: true, message: "已复用尾帧 asset:// 引用" };
  }
  const validation = await validateCanvasPhotorealAssets({
    groupId,
    name: config.groupName || "超写实素材组",
    description: "Pixel Toys tail frame references",
    channelId: config.settings?.channelId || config.assetLibrary?.channelId || "",
    assets: [
      {
        id,
        name: id,
        type: "TailFrame",
        assetStylePreset: "photoreal",
        url: `/media?path=${encodeURIComponent(localFile)}`,
        previewUrl: `/media?path=${encodeURIComponent(localFile)}`,
        publicUrl: previous.publicUrl || "",
        assetUrl: previous.assetUrl || "",
        virtualId: previous.virtualId || "",
        groupId,
      },
    ],
  });
  const asset = (validation.assets || [])[0] || {};
  const nextConfig = {
    ...config,
    ...projectAssetLibraryPatch(validation.group, groupId),
    tailFrameAssets: {
      ...(config.tailFrameAssets || {}),
      [id]: {
        sourceShot: shot.tailFrameSource || "",
        targetShot: shot.name || "",
        localFile: path.relative(episodeRoot, localFile),
        publicUrl: asset.publicUrl || previous.publicUrl || "",
        assetUrl: asset.assetUrl || previous.assetUrl || "",
        virtualId: asset.virtualId || previous.virtualId || "",
        groupId: asset.groupId || groupId,
        status: asset.validationStatus || "pending",
        message: asset.message || asset.validationError || "",
        updatedAt: new Date().toISOString(),
      },
    },
  };
  const status = compactLine(asset.validationStatus || "").toLowerCase();
  const assetUrl = compactLine(asset.assetUrl || "");
  if (status === "active" && /^asset:\/\//i.test(assetUrl)) {
    return { url: assetUrl, config: nextConfig, ready: true, message: "尾帧已转为素材库 asset:// 首帧引用" };
  }
  return {
    url: cleanStartFrameUrl,
    config: nextConfig,
    ready: false,
    message: asset.validationError || asset.message || "上一段尾帧正在进入素材库，待 active 后再提交视频，避免被真实人物/隐私拦截。",
  };
}

function projectVideoPayloadForShot(episodeRoot, shot, config = {}) {
  const refs = projectShotUsableVideoReferenceAssets(episodeRoot, config, shot);
  const runNamespace = currentRunNamespace(episodeRoot, config);
  const storyboardsActive = isProductionBoardMode(config, shot);
  let startFrameUrl = "";
  if (!storyboardsActive && shot.useTailFrame === true && shot.tailFrameSource) {
    const tailFrame = tailFrameSnapshotForShot(episodeRoot, shot.tailFrameSource, runNamespace);
    if (!tailFrame) throw new Error(`等待上一段尾帧：${shot.tailFrameSource}`);
    startFrameUrl = tailFrame.url;
  }
  const storyboardGuidanceText = storyboardsActive ? storyboardGuidancePromptText(shot.storyboardGuidance, refs.length) : "";
  return {
    prompt: compactLine(shot.prompt || shot.videoPrompt || ""),
    model: projectVideoModelForShot(config, shot),
    modelMode: projectVideoModelForShot(config, shot),
    ratio: config.settings?.ratio || "9:16",
    duration: normalizeSeedanceDuration(shot.duration || 5),
    resolution: config.settings?.resolution || "480p",
    generateAudio: config.settings?.enableSound !== "off",
    startFrameUrl,
    tailFrameSource: storyboardsActive ? "" : shot.tailFrameSource || "",
    videoPromptMode: storyboardsActive ? "production_board" : "prompt",
    storyboardRefs: Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs.filter(Boolean) : [],
    storyboardGuidance: shot.storyboardGuidance || null,
    storyboardGuidanceText,
    assets: refs,
  };
}

function assertProjectTailFrameReadyForShot(episodeRoot, shot = {}, config = {}) {
  if (isProductionBoardMode(config, shot)) return;
  if (shot.useTailFrame !== true || !shot.tailFrameSource) return;
  const runNamespace = currentRunNamespace(episodeRoot, config);
  const tailFrame = tailFrameSnapshotForShot(episodeRoot, shot.tailFrameSource, runNamespace);
  if (!tailFrame) throw new Error(`等待上一段尾帧：${shot.tailFrameSource}`);
}

function canvasAssetFromConfigAsset(episodeRoot, asset = {}) {
  const payload = projectAssetForVideoPayload(episodeRoot, asset);
  return {
    ...payload,
    source: "project",
    generationMode: asset.generationMode || "",
  };
}

function stableCanvasHash(value = "") {
  let hash = 5381;
  for (const char of String(value || "")) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}

function storyboardCanvasNodeId(assetName = "") {
  return `storyboard_${safeSlug(assetName || "production_board", "production_board")}_${stableCanvasHash(assetName || "production_board")}`;
}

function canvasNodeFromStoryboardAsset(asset = {}, index = 0) {
  return {
    id: storyboardCanvasNodeId(asset.name || asset.assetName || index),
    kind: "asset",
    source: "project-storyboard",
    projectShotName: "",
    x: -360,
    y: 120 + index * 340,
    assets: [asset.name || asset.assetName].filter(Boolean),
    prompt: "",
  };
}

function canvasNodeFromConfigShot(shot = {}, index = 0, config = {}) {
  const duration = normalizeSeedanceDuration(shot.duration || 5);
  const safeName = String(shot.name || `shot_${index + 1}`).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);
  const storyboardsActive = isProductionBoardMode(config, shot);
  const sourceIndex = !storyboardsActive && Array.isArray(config.shots) ? config.shots.findIndex((item) => item.name === shot.tailFrameSource) : -1;
  const sourceShot = sourceIndex >= 0 ? config.shots[sourceIndex] : null;
  const sourceNode = sourceShot ? canvasNodeFromConfigShot(sourceShot, sourceIndex, { ...config, shots: [] }) : null;
  const runNamespace = currentRunNamespace(config.episodeRoot || APP_ROOT, config);
  const startFrame =
    !storyboardsActive && shot.useTailFrame === true && shot.tailFrameSource && config.episodeRoot
      ? tailFrameSnapshotForShot(config.episodeRoot, shot.tailFrameSource, runNamespace)
      : null;
  return {
    id: `video_${safeName || "shot"}_${stableCanvasHash(shot.name || index)}`,
    kind: "video",
    source: "project-console",
    projectShotName: shot.name || "",
    x: 120 + (index % 3) * 560,
    y: 120 + Math.floor(index / 3) * 620,
    assets: storyboardsActive
      ? (Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs.filter(Boolean) : [])
      : (Array.isArray(shot.refs) ? shot.refs.filter(Boolean) : []),
    prompt: String(shot.prompt || shot.videoPrompt || "").trim(),
    settings: {
      model: projectVideoModelForShot(config, shot),
      ratio: config.settings?.ratio || "9:16",
      duration: String(duration),
      resolution: config.settings?.resolution || "720p",
      generateAudio: config.settings?.enableSound !== "off",
    },
    liveness: { name: "人物素材组", description: "", status: "idle", assetUrl: "" },
    status: "idle",
    statusMessage: "",
    videoUrl: "",
    taskId: "",
    taskProvider: "",
    progress: null,
    startFrameUrl: startFrame?.previewUrl || startFrame?.url || "",
    tailFrameSourceNodeId: sourceNode?.id || "",
    tailFrameSourceName: storyboardsActive ? "" : shot.tailFrameSource || "",
    videoPromptMode: storyboardsActive ? "production_board" : "prompt",
    storyboardRefs: Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs.filter(Boolean) : [],
    storyboardGuidance: shot.storyboardGuidance || null,
    referenceKitId: compactLine(shot.referenceKitId || ""),
    referenceKitName: compactLine(shot.referenceKitName || ""),
    referenceKitVersion: Number(shot.referenceKitVersion || 0) || 0,
    referenceKitSnapshot: shot.referenceKitSnapshot || null,
  };
}

function projectSnapshotCanvasFields(episodeRoot, shotName, runNamespace = "") {
  const snapshot =
    snapshotStatusForShot(episodeRoot, shotName, { runNamespace }) ||
    (runNamespace ? snapshotStatusForShot(episodeRoot, shotName) : null);
  if (!snapshot) return null;
  const localVideo = snapshot.complete ? localVideoFromSnapshot(episodeRoot, snapshot) : null;
  if (snapshot.complete) {
    return {
      status: "completed",
      statusMessage: snapshot.message || "生成完成",
      videoUrl: localVideo?.url || snapshot.videoUrl || "",
      taskId: snapshot.taskId || "",
      taskProvider: snapshot.provider || "",
      progress: 100,
      tailFrameReady: snapshot.tailFrameReady === true,
      tailFrameUrl: snapshot.tailFrameUrl || "",
      tailFrameFileUrl: snapshot.tailFrameUrl || "",
      tailFrameLocalFile: snapshot.tailFrameLocalFile || "",
      tailFrameMessage: snapshot.tailFrameReady ? "尾帧已就绪" : "",
    };
  }
  if (snapshot.failed) {
    return {
      status: "failed",
      statusMessage: snapshot.failedReason || snapshot.message || "视频生成失败",
      videoUrl: "",
      taskId: snapshot.taskId || "",
      taskProvider: snapshot.provider || "",
      progress: Number.isFinite(Number(snapshot.progress)) ? Number(snapshot.progress) : 100,
      tailFrameReady: false,
      tailFrameUrl: "",
      tailFrameFileUrl: "",
      tailFrameLocalFile: "",
      tailFrameMessage: "",
    };
  }
  if (snapshot.statusCode === 1) {
    return {
      status: "running",
      statusMessage: snapshot.message || "生成中",
      videoUrl: "",
      taskId: snapshot.taskId || "",
      taskProvider: snapshot.provider || "",
      progress: snapshot.progress === null || snapshot.progress === undefined ? null : snapshot.progress,
      tailFrameReady: false,
      tailFrameUrl: "",
      tailFrameFileUrl: "",
      tailFrameLocalFile: "",
      tailFrameMessage: "",
    };
  }
  if (snapshot.statusCode === 0) {
    return {
      status: "queued",
      statusMessage: snapshot.message || "排队中",
      videoUrl: "",
      taskId: "",
      taskProvider: "",
      progress: 0,
      tailFrameReady: false,
      tailFrameUrl: "",
      tailFrameFileUrl: "",
      tailFrameLocalFile: "",
      tailFrameMessage: "",
    };
  }
  return null;
}

function syncProjectShotsToCanvasState(episodeRoot, config = {}, shots = [], options = {}) {
  const projectId = videoCanvasIdForConfig(episodeRoot, config);
  const previous = readCanvasState(projectId) || {};
  const previousAssets = Array.isArray(previous.assets) ? previous.assets.filter((asset) => asset?.id) : [];
  const previousNodes = Array.isArray(previous.nodes) ? previous.nodes.filter((node) => node?.id) : [];
  const assetById = new Map(previousAssets.map((asset) => [asset.id, asset]));
  const configAssets = Array.isArray(config.assets) ? config.assets : [];
  const storyboardsActive = isProductionBoardMode(config);
  for (const asset of configAssets) {
    const canvasAsset = canvasAssetFromConfigAsset(episodeRoot, asset);
    if (canvasAsset.id && (canvasAsset.url || canvasAsset.previewUrl || canvasAsset.localUrl || canvasAsset.publicUrl || canvasAsset.assetUrl)) {
      assetById.set(canvasAsset.id, { ...(assetById.get(canvasAsset.id) || {}), ...canvasAsset });
    }
  }
  const allShots = Array.isArray(config.shots) ? config.shots : [];
  const canvasConfig = { ...config, episodeRoot };
  const runNamespace = currentRunNamespace(episodeRoot, config);
  const shotIndex = new Map(allShots.map((shot, index) => [shot.name, index]));
  const nodeIdByShot = new Map(allShots.map((shot, index) => [shot.name, canvasNodeFromConfigShot(shot, index, canvasConfig).id]));
  const nodeById = new Map(previousNodes.map((node) => [node.id, node]));
  // 被当前镜头引用的故事板节点 id;用于剪除旧分组遗留的孤儿故事板节点及悬空连线。
  const referencedStoryboardNodeIds = new Set();
  for (const shot of allShots) {
    for (const ref of Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : []) {
      const clean = compactLine(ref);
      if (clean) referencedStoryboardNodeIds.add(storyboardCanvasNodeId(clean));
    }
  }
  if (storyboardsActive) {
    const storyboardAssets = configAssets.filter((asset) => asset.manifestType === "Storyboard" || /storyboard|Production Board/i.test(`${asset.type || ""} ${asset.use || ""}`));
    storyboardAssets.forEach((asset, index) => {
      const node = canvasNodeFromStoryboardAsset(asset, index);
      if (!referencedStoryboardNodeIds.has(node.id)) return; // 跳过未被任何镜头引用的故事板
      const previousNode = nodeById.get(node.id) || {};
      nodeById.set(node.id, { ...previousNode, ...node, assets: node.assets });
    });
  }
  for (const shot of shots) {
    const node = canvasNodeFromConfigShot(shot, shotIndex.get(shot.name) ?? 0, canvasConfig);
    const previousNode = nodeById.get(node.id) || {};
    const snapshotFields = projectSnapshotCanvasFields(episodeRoot, shot.name, runNamespace) || {};
    nodeById.set(node.id, {
      ...previousNode,
      ...node,
      ...snapshotFields,
      prompt: options.forcePrompt === true ? node.prompt : (promptHasStoryContent(previousNode.prompt) ? previousNode.prompt : node.prompt),
      status: snapshotFields.status || previousNode.status || node.status,
      statusMessage: snapshotFields.statusMessage || previousNode.statusMessage || node.statusMessage,
      videoUrl: snapshotFields.videoUrl || previousNode.videoUrl || node.videoUrl,
      taskId: snapshotFields.taskId || previousNode.taskId || node.taskId,
      taskProvider: snapshotFields.taskProvider || previousNode.taskProvider || node.taskProvider,
      progress: snapshotFields.progress ?? previousNode.progress ?? node.progress,
      startFrameUrl: storyboardsActive ? "" : node.startFrameUrl || previousNode.startFrameUrl || "",
      tailFrameSourceNodeId: storyboardsActive ? "" : node.tailFrameSourceNodeId || previousNode.tailFrameSourceNodeId || "",
      tailFrameSourceName: storyboardsActive ? "" : node.tailFrameSourceName || previousNode.tailFrameSourceName || "",
      tailFrameReady: snapshotFields.tailFrameReady ?? previousNode.tailFrameReady,
      tailFrameUrl: snapshotFields.tailFrameUrl || previousNode.tailFrameUrl || "",
      tailFrameFileUrl: snapshotFields.tailFrameFileUrl || previousNode.tailFrameFileUrl || "",
      tailFrameLocalFile: snapshotFields.tailFrameLocalFile || previousNode.tailFrameLocalFile || "",
      tailFrameMessage: snapshotFields.tailFrameMessage || previousNode.tailFrameMessage || "",
    });
  }
  const nodes = [...nodeById.values()].filter((node) => {
    // 剪除旧分组遗留、当前无镜头引用的故事板孤儿节点
    if (String(node.id || "").startsWith("storyboard_")) return referencedStoryboardNodeIds.has(node.id);
    return true;
  });
  const connectionKeys = new Set();
  const connections = [];
  const pushConnection = (connection) => {
    const from = compactLine(connection?.from || "");
    const to = compactLine(connection?.to || "");
    if (!from || !to || from === to) return;
    const key = `${from}->${to}`;
    if (connectionKeys.has(key)) return;
    connectionKeys.add(key);
    connections.push({ from, to });
  };
  (Array.isArray(previous.connections) ? previous.connections : []).forEach((connection) => {
    if (storyboardsActive) {
      const fromNode = nodeById.get(compactLine(connection?.from || ""));
      const toNode = nodeById.get(compactLine(connection?.to || ""));
      if (fromNode?.kind === "video" && toNode?.kind === "video") return;
    }
    pushConnection(connection);
  });
  for (const shot of allShots) {
    if (storyboardsActive) {
      const to = nodeIdByShot.get(shot.name);
      for (const ref of Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : []) {
        pushConnection({ from: storyboardCanvasNodeId(ref), to });
      }
      continue;
    }
    if (shot.useTailFrame !== true || !shot.tailFrameSource) continue;
    const from = nodeIdByShot.get(shot.tailFrameSource);
    const to = nodeIdByShot.get(shot.name);
    if (from && to) pushConnection({ from, to });
  }
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  const liveConnections = connections.filter((c) => liveNodeIds.has(c.from) && liveNodeIds.has(c.to));
  return writeCanvasState({
    ...previous,
    projectId,
    nextNodeId: Math.max(Number(previous.nextNodeId || 1), nodes.length + 1),
    viewport: previous.viewport || { x: 0, y: 0, scale: 1 },
    assets: [...assetById.values()],
    nodes,
    connections: liveConnections,
  });
}

function assertVideoConfigAssetsReady(config = {}, shot = null, episodeRoot = "") {
  const missingAssets = (Array.isArray(config.missingAssets) ? config.missingAssets : []).map(compactLine).filter(Boolean);
  const skippedReferenceAssets = [...missingAssets];
  const assetNames = new Set((Array.isArray(config.assets) ? config.assets : []).map((asset) => compactLine(asset?.name || asset?.assetName || "")).filter(Boolean));
  // 兜底:config.assets 名单可能滞后于 shots.refs(例如故事板重新分组后名字变化,而名单未同步),
  // 但磁盘上其实已有对应资产/故事板图。把磁盘上真实存在的资产名并入有效名单,避免"图已生成却判为缺失"导致整批不提交。
  const root = compactLine(episodeRoot || config.episodeRoot || "");
  if (root) {
    for (const asset of scanAssets(root)) {
      const name = compactLine(asset.assetName || "");
      if (name) assetNames.add(name);
    }
  }
  const selectedShots = shot ? [shot] : (Array.isArray(config.shots) ? config.shots : []);
  const boardlessShots = selectedShots.filter(
    (item) => isProductionBoardMode(config, item) && !(Array.isArray(item.storyboardRefs) && item.storyboardRefs.some((ref) => compactLine(ref))),
  );
  if (boardlessShots.length) {
    const error = new Error(`Production Board 验证失败：${boardlessShots.map((item) => compactLine(item.name || "未命名片段")).join("、")} 缺少故事板引用`);
    error.statusCode = 409;
    throw error;
  }
  const refs = videoSubmissionReferenceNames(config, selectedShots);
  const missingRefs = [...new Set(refs.map(compactLine).filter((ref) => ref && !assetNames.has(ref)))];
  if (missingRefs.length) {
    const error = new Error(`参考图验证失败：缺少或未生成 ${missingRefs.length} 张引用图：${missingRefs.join("、")}`);
    error.statusCode = 409;
    throw error;
  }
  skippedReferenceAssets.push(...missingRefs);
  if (shot) {
    projectShotUsableVideoReferenceAssets(config.episodeRoot || "", config, shot);
  }
  return { skippedReferenceAssets: [...new Set(skippedReferenceAssets)] };
}

function videoFileExtensionFromUrl(url = "") {
  return String(url || "").match(/\.(mov|mp4)(?:[?#]|$)/i)?.[1]?.toLowerCase() || "mp4";
}

function imageFileExtensionFromUrl(url = "") {
  return String(url || "").match(/\.(webp|png|jpe?g)(?:[?#]|$)/i)?.[1]?.toLowerCase().replace("jpeg", "jpg") || "png";
}

const CANVAS_TAIL_FRAME_REQUEST_TIMEOUT_MS = 110_000;
const CANVAS_VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;
const CANVAS_TAIL_FRAME_DOWNLOAD_TIMEOUT_MS = 25_000;
const CANVAS_FFMPEG_ATTEMPT_TIMEOUT_MS = 30_000;

function positiveTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function canvasTailFrameTimeoutMs(deadline, fallback, label) {
  if (!Number.isFinite(deadline)) return fallback;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`${label}超时（尾帧处理总时限已到）`);
  return Math.min(fallback, remaining);
}

async function consumeCanvasTailFrameResponse(url, timeoutMs, label, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return await consume(response, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label}超时（超过 ${Math.ceil(timeoutMs / 1000)} 秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadProjectVideoResult(episodeRoot, shotName, videoUrl) {
  const cleanUrl = compactLine(videoUrl);
  if (!/^https?:\/\//i.test(cleanUrl)) return "";
  const rawDir = path.join(episodeRoot, "06_videos", "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const target = path.join(rawDir, `${safeSlug(shotName, "shot")}.${videoFileExtensionFromUrl(cleanUrl)}`);
  const tmpTarget = `${target}.download-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    const rangeInfo = await fetchRemoteVideoRangeInfo(cleanUrl);
    if (rangeInfo?.size > PROJECT_VIDEO_RANGE_CHUNK_BYTES) {
      await downloadRemoteVideoByRanges(cleanUrl, tmpTarget, rangeInfo.size);
    } else {
      await downloadRemoteVideoSingleConnection(cleanUrl, tmpTarget);
    }
    assertValidDownloadedVideo(tmpTarget);
    fs.renameSync(tmpTarget, target);
  } catch (error) {
    fs.rmSync(tmpTarget, { force: true });
    throw error;
  }
  return target;
}

function parseContentRange(value = "") {
  const match = String(value || "").match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (!match || match[3] === "*") return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    size: Number(match[3]),
  };
}

function assertVideoResponseContentType(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/^video\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    throw new Error("生成结果不是可下载的视频文件");
  }
}

async function fetchRemoteVideoRangeInfo(url) {
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (response.status !== 206 || !response.body) return null;
    assertVideoResponseContentType(response);
    const range = parseContentRange(response.headers.get("content-range") || "");
    if (!range || !Number.isFinite(range.size) || range.size <= 0) return null;
    return { size: range.size };
  } catch {
    return null;
  }
}

async function downloadRemoteVideoSingleConnection(url, target) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`视频下载失败：HTTP ${response.status || 502}`);
  assertVideoResponseContentType(response);
  await pipeline(response.body, fs.createWriteStream(target));
  const expectedLength = Number(response.headers.get("content-length") || 0);
  const actualLength = fs.existsSync(target) ? fs.statSync(target).size : 0;
  if (expectedLength > 0 && actualLength !== expectedLength) {
    throw new Error(`视频下载不完整：${actualLength}/${expectedLength} bytes`);
  }
}

async function downloadRemoteVideoRangePart(url, partFile, start, end) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (response.status !== 206 || !response.body) {
    throw new Error(`视频分片下载失败：HTTP ${response.status || 502}`);
  }
  await pipeline(response.body, fs.createWriteStream(partFile));
  const expectedLength = end - start + 1;
  const actualLength = fs.existsSync(partFile) ? fs.statSync(partFile).size : 0;
  if (actualLength !== expectedLength) {
    throw new Error(`视频分片下载不完整：${actualLength}/${expectedLength} bytes`);
  }
}

async function downloadRemoteVideoByRanges(url, target, totalSize) {
  const tempDir = `${target}.parts`;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });
  const ranges = [];
  for (let start = 0; start < totalSize; start += PROJECT_VIDEO_RANGE_CHUNK_BYTES) {
    ranges.push({
      index: ranges.length,
      start,
      end: Math.min(totalSize - 1, start + PROJECT_VIDEO_RANGE_CHUNK_BYTES - 1),
    });
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < ranges.length) {
      const range = ranges[cursor++];
      const partFile = path.join(tempDir, `${String(range.index).padStart(5, "0")}.part`);
      await downloadRemoteVideoRangePart(url, partFile, range.start, range.end);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PROJECT_VIDEO_RANGE_CONCURRENCY, ranges.length) }, worker));
    fs.rmSync(target, { force: true });
    for (const range of ranges) {
      const partFile = path.join(tempDir, `${String(range.index).padStart(5, "0")}.part`);
      fs.appendFileSync(target, fs.readFileSync(partFile));
    }
    const actualLength = fs.existsSync(target) ? fs.statSync(target).size : 0;
    if (actualLength !== totalSize) throw new Error(`视频分片合并不完整：${actualLength}/${totalSize} bytes`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertValidDownloadedVideo(file) {
  if (!file || !fs.existsSync(file) || fs.statSync(file).size < 1024) {
    throw new Error("视频下载失败：文件为空或过小");
  }
  if (!executableExists("ffprobe")) return;
  try {
    execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], {
      stdio: "ignore",
    });
  } catch {
    throw new Error("视频下载失败：本地文件不是完整可解析的视频");
  }
}

function tailFrameFileForShot(episodeRoot, shotName, ext = "png") {
  const dir = path.join(episodeRoot, "09_tail_frames");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safeSlug(shotName, "shot")}_tail.${ext.replace(/^\./, "") || "png"}`);
}

async function downloadProjectTailFrameResult(episodeRoot, shotName, tailFrameUrl) {
  const cleanUrl = compactLine(tailFrameUrl);
  if (!/^https?:\/\//i.test(cleanUrl)) return "";
  const response = await fetch(cleanUrl);
  if (!response.ok || !response.body) throw new Error(`尾帧下载失败：HTTP ${response.status || 502}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    throw new Error("生成结果尾帧不是可下载的图片文件");
  }
  const target = tailFrameFileForShot(episodeRoot, shotName, imageFileExtensionFromUrl(cleanUrl));
  await pipeline(response.body, fs.createWriteStream(target));
  return target;
}

function executableExists(command) {
  try {
    execFileSync("sh", ["-lc", 'command -v -- "$1"', "sh", command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function extractProjectTailFrameFromVideo(episodeRoot, shotName, localVideoFile) {
  const videoFile = path.resolve(localVideoFile || "");
  if (!videoFile || !fs.existsSync(videoFile) || !fs.statSync(videoFile).isFile()) return { file: "", message: "" };
  if (!executableExists("ffmpeg")) {
    return { file: "", message: "未检测到 ffmpeg，无法从本地视频抽取尾帧" };
  }
  const target = tailFrameFileForShot(episodeRoot, shotName, "png");
  if (fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).size > 1024) {
    return { file: target, message: "复用已缓存尾帧" };
  }
  const attempts = [
    ["-y", "-sseof", "-0.5", "-i", videoFile, "-frames:v", "1", "-q:v", "2", "-update", "1", target],
    ["-y", "-sseof", "-1.0", "-i", videoFile, "-frames:v", "1", "-q:v", "2", "-update", "1", target],
    ["-y", "-ss", "14.5", "-i", videoFile, "-frames:v", "1", "-q:v", "2", "-update", "1", target],
  ];
  let lastError = "";
  for (const args of attempts) {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
          const ready = code === 0 && fs.existsSync(target) && fs.statSync(target).size > 0;
          if (ready) resolve();
          else reject(new Error(compactLine(stderr) || `ffmpeg 抽帧失败：${code}`));
        });
      });
      return { file: target, message: "已从本地视频抽取尾帧" };
    } catch (error) {
      lastError = error.message || "ffmpeg 抽帧失败";
    }
  }
  throw new Error(lastError || "ffmpeg 抽帧失败");
}

async function persistProjectTailFrame(episodeRoot, shotName, result = {}, localVideoFile = "") {
  let tailFrameFile = "";
  let tailFrameSource = "";
  let message = "";
  const remoteTailFrameUrl = compactLine(result.tailFrameUrl || result.lastFrameUrl || result.endFrameUrl || "");
  if (remoteTailFrameUrl) {
    try {
      tailFrameFile = await downloadProjectTailFrameResult(episodeRoot, shotName, remoteTailFrameUrl);
      tailFrameSource = "provider";
      message = "已保存接口返回尾帧";
    } catch (error) {
      message = `接口尾帧保存失败：${compactLine(error.message)}`;
    }
  }
  if (!tailFrameFile && localVideoFile) {
    try {
      const extracted = await extractProjectTailFrameFromVideo(episodeRoot, shotName, localVideoFile);
      tailFrameFile = extracted.file || "";
      tailFrameSource = tailFrameFile ? "ffmpeg" : "";
      message = extracted.message || message;
    } catch (error) {
      message = `本地视频尾帧抽取失败：${compactLine(error.message)}`;
    }
  }
  return {
    ready: !!tailFrameFile,
    source: tailFrameSource,
    remoteUrl: remoteTailFrameUrl,
    localFile: tailFrameFile ? path.relative(episodeRoot, tailFrameFile) : "",
    url: tailFrameFile ? `/media?path=${encodeURIComponent(tailFrameFile)}` : remoteTailFrameUrl,
    fileUrl: tailFrameFile ? pathToFileURL(tailFrameFile).href : "",
    message,
  };
}

async function extractCanvasTailFrameFromVideo(tailDir, nodeId, localVideoFile, options = {}) {
  const videoFile = path.resolve(localVideoFile || "");
  if (!videoFile || !fs.existsSync(videoFile) || !fs.statSync(videoFile).isFile()) return { file: "", message: "" };
  if (!executableExists("ffmpeg")) {
    return { file: "", message: "未检测到 ffmpeg，无法从本地视频抽取尾帧" };
  }
  const target = path.join(tailDir, `${nodeId}_tail.png`);
  if (fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).size > 1024) {
    return { file: target, message: "复用已缓存尾帧" };
  }
  const attempts = [
    ["-y", "-sseof", "-0.5", "-i", videoFile, "-frames:v", "1", "-q:v", "2", "-update", "1", target],
    ["-y", "-sseof", "-1.0", "-i", videoFile, "-frames:v", "1", "-q:v", "2", "-update", "1", target],
    ["-y", "-i", videoFile, "-frames:v", "1", "-q:v", "2", "-update", "1", target],
  ];
  const attemptTimeoutMs = positiveTimeout(options.ffmpegAttemptTimeoutMs, CANVAS_FFMPEG_ATTEMPT_TIMEOUT_MS);
  let lastError = "";
  for (const args of attempts) {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    try {
      const timeoutMs = canvasTailFrameTimeoutMs(options.deadline, attemptTimeoutMs, "ffmpeg 抽帧");
      await new Promise((resolve, reject) => {
        const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        let settled = false;
        let timer;
        const finish = (handler, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          handler(value);
        };
        timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
          finish(reject, new Error(`ffmpeg 超时（超过 ${Math.ceil(timeoutMs / 1000)} 秒）`));
        }, timeoutMs);
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => finish(reject, error));
        child.on("close", (code) => {
          const ready = code === 0 && fs.existsSync(target) && fs.statSync(target).size > 0;
          if (ready) finish(resolve);
          else finish(reject, new Error(compactLine(stderr) || `ffmpeg 抽帧失败：${code}`));
        });
      });
      return { file: target, message: "已从本地视频抽取尾帧" };
    } catch (error) {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      lastError = error.message || "ffmpeg 抽帧失败";
    }
  }
  throw new Error(lastError || "ffmpeg 抽帧失败");
}

async function resolveCanvasVideoLocalFile(tailDir, nodeId, videoUrl, options = {}) {
  const clean = compactLine(videoUrl);
  if (!clean) return "";
  const localMedia = localMediaPathFromUrl(clean);
  if (localMedia && fs.existsSync(localMedia)) return localMedia;
  if (/^https?:\/\//i.test(clean)) {
    const tmp = path.join(tailDir, `${nodeId}_src.mp4`);
    if (fs.existsSync(tmp) && fs.statSync(tmp).isFile() && fs.statSync(tmp).size > 1024) {
      try {
        assertValidDownloadedVideo(tmp);
        return tmp;
      } catch {
        fs.rmSync(tmp, { force: true });
      }
    }
    const downloadTarget = `${tmp}.download-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    try {
      const timeoutMs = canvasTailFrameTimeoutMs(
        options.deadline,
        positiveTimeout(options.videoDownloadTimeoutMs, CANVAS_VIDEO_DOWNLOAD_TIMEOUT_MS),
        "视频下载",
      );
      await consumeCanvasTailFrameResponse(clean, timeoutMs, "视频下载", async (response, signal) => {
        if (!response.ok || !response.body) throw new Error(`视频下载失败：HTTP ${response.status || 502}`);
        await pipeline(response.body, fs.createWriteStream(downloadTarget), { signal });
        assertValidDownloadedVideo(downloadTarget);
        fs.renameSync(downloadTarget, tmp);
      });
      return tmp;
    } finally {
      if (fs.existsSync(downloadTarget)) fs.rmSync(downloadTarget, { force: true });
    }
  }
  return "";
}

async function persistCanvasTailFrame(body = {}, options = {}) {
  const projectId = compactLine(body.projectId || "standalone") || "standalone";
  const nodeId = safeSlug(body.nodeId || "video-node", "video-node");
  const result = {
    tailFrameUrl: compactLine(body.tailFrameUrl || body.tail_frame_url || ""),
    videoUrl: compactLine(body.videoUrl || body.video_url || ""),
  };
  const rawRoot = decodeIdSafe(projectId) || APP_ROOT;
  const baseRoot = allowedPath(rawRoot) && fs.existsSync(rawRoot) ? rawRoot : APP_ROOT;
  const tailDir = path.join(baseRoot, projectId === "standalone" ? ".pixel-toys-canvas-tail-frames" : "09_tail_frames");
  fs.mkdirSync(tailDir, { recursive: true });
  const deadline = Date.now() + positiveTimeout(options.requestTimeoutMs, CANVAS_TAIL_FRAME_REQUEST_TIMEOUT_MS);
  const timeoutOptions = {
    deadline,
    videoDownloadTimeoutMs: positiveTimeout(options.videoDownloadTimeoutMs, CANVAS_VIDEO_DOWNLOAD_TIMEOUT_MS),
    tailFrameDownloadTimeoutMs: positiveTimeout(options.tailFrameDownloadTimeoutMs, CANVAS_TAIL_FRAME_DOWNLOAD_TIMEOUT_MS),
    ffmpegAttemptTimeoutMs: positiveTimeout(options.ffmpegAttemptTimeoutMs, CANVAS_FFMPEG_ATTEMPT_TIMEOUT_MS),
  };
  // 海外(BytePlus/新加坡 TOS)视频:国内服务器跨境下载 ~8KB/s,整段视频下载 + 抽帧物理上做不了(会卡到超时)。
  // 若视频托管在 ap-southeast 且没有可直接下载的尾帧图,直接跳过,返回明确信息,不阻塞、不超时。
  const isOverseasVideoUrl = /(?:^|[.\/])ap-southeast|bytepluses\.com/i.test(result.videoUrl);
  if (isOverseasVideoUrl && !result.tailFrameUrl && !localMediaPathFromUrl(result.videoUrl)) {
    return {
      ready: false,
      videoUrl: result.videoUrl,
      videoLocalFile: "",
      tailFrameUrl: "",
      tailFrameLocalFile: "",
      tailFrameFileUrl: "",
      message: "海外通道视频,已跳过尾帧提取(跨境下载过慢,不影响播放)",
    };
  }
  let file = "";
  let localVideoFile = "";
  let message = "";
  const remoteTailFrameUrl = result.tailFrameUrl;
  if (remoteTailFrameUrl) {
    const cachedFrame = localMediaPathFromUrl(remoteTailFrameUrl) || localFilePathFromUrl(remoteTailFrameUrl);
    if (cachedFrame) {
      file = cachedFrame;
      message = "复用已缓存尾帧";
    } else if (/^https?:\/\//i.test(remoteTailFrameUrl)) {
      const target = path.join(tailDir, `${nodeId}_tail.${imageFileExtensionFromUrl(remoteTailFrameUrl)}`);
      const downloadTarget = `${target}.download-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
      try {
        const timeoutMs = canvasTailFrameTimeoutMs(
          deadline,
          timeoutOptions.tailFrameDownloadTimeoutMs,
          "尾帧下载",
        );
        await consumeCanvasTailFrameResponse(remoteTailFrameUrl, timeoutMs, "尾帧下载", async (response, signal) => {
          if (!response.ok || !response.body) throw new Error(`尾帧下载失败：HTTP ${response.status || 502}`);
          await pipeline(response.body, fs.createWriteStream(downloadTarget), { signal });
          fs.renameSync(downloadTarget, target);
        });
        file = target;
        message = "已保存接口返回尾帧";
      } catch (error) {
        message = `接口尾帧保存失败：${compactLine(error.message)}`;
      } finally {
        if (fs.existsSync(downloadTarget)) fs.rmSync(downloadTarget, { force: true });
      }
    }
  }
  // ffmpeg 本地兜底:provider 没返回尾帧URL(或下载失败)时,用 videoUrl 从视频抽最后一帧
  if (!file && result.videoUrl) {
    try {
      localVideoFile = await resolveCanvasVideoLocalFile(tailDir, nodeId, result.videoUrl, timeoutOptions);
      if (localVideoFile) {
        const extracted = await extractCanvasTailFrameFromVideo(tailDir, nodeId, localVideoFile, timeoutOptions);
        file = extracted.file || "";
        message = extracted.message || message;
      } else {
        message = message || "无法定位本地视频用于抽帧";
      }
    } catch (error) {
      message = `本地视频尾帧抽取失败：${compactLine(error.message)}`;
    }
  }
  return {
    ready: !!file,
    videoUrl: localVideoFile ? `/media?path=${encodeURIComponent(localVideoFile)}` : result.videoUrl,
    videoLocalFile: localVideoFile,
    tailFrameUrl: file ? `/media?path=${encodeURIComponent(file)}` : remoteTailFrameUrl,
    tailFrameLocalFile: file,
    tailFrameFileUrl: file ? pathToFileURL(file).href : "",
    message: message || (remoteTailFrameUrl ? "" : "接口未返回尾帧或视频不可抽帧"),
  };
}

function updateProjectVideoSnapshotFromResult(episodeRoot, shotName, result = {}, runNamespace = "") {
  const status = compactLine(result.status || "");
  const cleanVideoUrl = videoUrlFrom(result.videoUrl || "");
  const invalidVideoUrl = invalidVideoUrlReason(result.videoUrl || "");
  const statusCode = invalidVideoUrl ? 3 : videoTaskStatusCode(cleanVideoUrl ? "completed" : status);
  const progressPercent = progressPercentFromResult({ ...result, videoUrl: cleanVideoUrl }, statusCode);
  const patch = {
    runNamespace,
    provider: result.provider || "",
    urls: cleanVideoUrl ? [cleanVideoUrl] : [],
    taskInfo: {
      taskId: result.taskId || "",
      provider: result.provider || "",
      status: statusCode,
      statusRaw: result.statusRaw || status,
      progressPercent: progressPercent === null ? undefined : progressPercent,
      failedReason: statusCode === 3 ? invalidVideoUrl || result.message || "视频生成失败" : "",
      message: invalidVideoUrl || result.message || "",
      videoUrl: cleanVideoUrl,
      tailFrameUrl: result.tailFrameUrl || "",
      updatedAt: new Date().toISOString(),
    },
  };
  return writeProjectVideoTaskSnapshot(episodeRoot, shotName, patch);
}

async function pollProjectVideoGeneration(episodeRoot, shotName, taskId, provider, runNamespace, authUser = null) {
  const started = Date.now();
  const timeoutMs = 45 * 60 * 1000;
  const config = readVideoConfig(episodeRoot)?.data || {};
  const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName);
  const tailFrameRequired = !isProductionBoardMode(config, shot);
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const result = await getCanvasVideoGeneration(taskId, provider);
    updateProjectVideoSnapshotFromResult(episodeRoot, shotName, result, runNamespace);
    const resultVideoUrl = videoUrlFrom(result.videoUrl || "");
    if (result.status === "completed" && resultVideoUrl) {
      const localFile = await downloadProjectVideoResult(episodeRoot, shotName, resultVideoUrl);
      const tailFrame = await persistProjectTailFrame(episodeRoot, shotName, result, localFile);
      writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
        runNamespace,
        provider: result.provider || provider,
        urls: resultVideoUrl ? [resultVideoUrl] : [],
        taskInfo: {
          taskId: result.taskId || taskId,
          provider: result.provider || provider,
          status: 2,
          progressPercent: 100,
          failedReason: "",
          message: projectVideoFinalizingMessage(tailFrame, localFile, { tailFrameRequired }),
          videoUrl: resultVideoUrl,
          tailFrameUrl: tailFrame.url || result.tailFrameUrl || "",
          tailFrameLocalFile: tailFrame.localFile || "",
          tailFrameReady: tailFrame.ready,
          tailFrameRequired,
          tailFrameSource: tailFrame.source || "",
          tailFrameMessage: tailFrame.message || "",
          localFile: localFile ? path.relative(episodeRoot, localFile) : "",
          updatedAt: new Date().toISOString(),
        },
      });
      markUserVideoTaskFinished(authUser, result.taskId || taskId);
      return;
    }
    if (result.status === "failed") {
      markUserVideoTaskFinished(authUser, result.taskId || taskId);
      return;
    }
  }
  markUserVideoTaskFinished(authUser, taskId);
  writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
    runNamespace,
    provider,
    taskInfo: {
      taskId,
      provider,
      status: 3,
      progressPercent: 100,
      failedReason: "视频生成轮询超时",
      updatedAt: new Date().toISOString(),
    },
  });
}

function projectVideoQueueKey(episodeRoot) {
  return path.resolve(episodeRoot);
}

function markProjectVideoShotQueued(episodeRoot, shotName, message = "等待前序片段完成") {
  const config = readVideoConfig(episodeRoot)?.data || {};
  const runNamespace = currentRunNamespace(episodeRoot, config);
  const existing = snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
  const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName);
  const tailFrameRequired = !isProductionBoardMode(config, shot);
  if (existing?.complete && localVideoFromSnapshot(episodeRoot, existing) && (!tailFrameRequired || existing.tailFrameReady === true)) return existing;
  return writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
    runNamespace,
    taskInfo: {
      status: 0,
      statusRaw: "queued_local",
      progressPercent: 0,
      failedReason: "",
      message,
      taskId: "",
      provider: "",
      videoUrl: "",
      tailFrameUrl: "",
      tailFrameLocalFile: "",
      tailFrameReady: false,
      tailFrameRequired,
      tailFrameMessage: "",
      localFile: "",
      updatedAt: new Date().toISOString(),
    },
  });
}

function isProjectVideoShotComplete(episodeRoot, shotName, runNamespace = "") {
  const config = readVideoConfig(episodeRoot)?.data || {};
  const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName);
  const tailFrameRequired = !isProductionBoardMode(config, shot);
  const snapshot = snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
  if (!snapshot?.complete) return false;
  if (!localVideoFromSnapshot(episodeRoot, snapshot)) return false;
  return !tailFrameRequired || snapshot.tailFrameReady === true;
}

function projectVideoShotIsWaitingForAssets(episodeRoot, shotName, runNamespace = "") {
  const snapshot = snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
  if (!snapshot) return false;
  if (snapshot.statusCode === 0 && isAssetActivationWaitFailure(`${snapshot.message || ""} ${snapshot.failedReason || ""}`)) return true;
  return snapshot.failed && isAssetActivationWaitFailure(`${snapshot.failedReason || ""} ${snapshot.message || ""}`);
}

async function waitForProjectVideoShotComplete(episodeRoot, shotName, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 45 * 60 * 1000);
  const intervalMs = Number(options.intervalMs || 5000);
  const started = Date.now();
  const config = readVideoConfig(episodeRoot)?.data || {};
  const runNamespace = currentRunNamespace(episodeRoot, config);
  while (Date.now() - started < timeoutMs) {
    if (isProjectVideoShotComplete(episodeRoot, shotName, runNamespace)) return snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
    const snapshot = snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
    if (snapshot?.failed) throw new Error(snapshot.failedReason || `${shotName} 生成失败`);
    if (snapshot?.statusCode === 1 && snapshot.taskId) {
      await refreshExistingProjectVideoTask(episodeRoot, shotName, snapshot, runNamespace);
    } else if (projectVideoShotNeedsFinalization(snapshot)) {
      await finalizeExistingProjectVideoShot(episodeRoot, shotName, snapshot, runNamespace);
    }
    if (isProjectVideoShotComplete(episodeRoot, shotName, runNamespace)) return snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${shotName} 等待生成完成超时`);
}

async function waitForProjectVideoShotAssetGate(episodeRoot, shotName, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 12 * 60 * 1000);
  const intervalMs = Number(options.intervalMs || 10000);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const configRecord = readVideoConfig(episodeRoot);
    let config = configRecord?.data || {};
    const refreshed = await refreshConfigAssetLibraryStatuses(config);
    config = refreshed.config || config;
    if (refreshed.changed) writeVideoConfigRecord(configRecord, config);
    const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName);
    if (!shot) throw new Error(`视频配置中找不到片段：${shotName}`);
    const refsReady = shotPhotorealReferencesAreActive(config, shot);
    const tailReady = shotTailFrameAssetIsActive(config, shot);
    if (refsReady && tailReady) {
      writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
        runNamespace: currentRunNamespace(episodeRoot, config),
        taskInfo: {
          clearStatus: true,
          status: null,
          progressPercent: 0,
          failedReason: "",
          message: "素材已 active，准备提交视频",
          taskId: "",
          provider: "",
          videoUrl: "",
          tailFrameUrl: "",
          tailFrameLocalFile: "",
          tailFrameReady: false,
          tailFrameMessage: "",
          localFile: "",
          updatedAt: new Date().toISOString(),
        },
      });
      return true;
    }
    markProjectVideoShotWaiting(
      episodeRoot,
      shotName,
      !refsReady && !tailReady
        ? "等待参考图和上一段尾帧进入素材库 active 后再提交视频"
        : !refsReady
          ? "等待参考图进入素材库 active 后再提交视频"
          : "等待上一段尾帧进入素材库 active 后再提交视频",
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${shotName} 等待素材库 active 超时`);
}

async function generateProjectVideoShot(episodeRoot, body = {}) {
  const shotName = compactLine(body.shotName || body.name || "");
  if (!shotName) throw new Error("缺少要生成的视频片段");
  const authUser = body.authUser || null;
  const configRecord = readVideoConfig(episodeRoot);
  let config = configRecord?.data || {};
  const fallback = canvasVideoFallbackForShot(episodeRoot, shotName);
  if (!Array.isArray(config.shots) || !config.shots.length) config = fallback?.config || config;
  config = { ...config, episodeRoot };
  const shot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName) || fallback?.shot || null;
  if (!shot) throw new Error(`视频配置中找不到片段：${shotName}`);
  if (!Array.isArray(config.shots) || !config.shots.some((item) => item.name === shot.name)) {
    config = { ...(fallback?.config || config), shots: [shot] };
  }
  const tailFrameRequired = !isProductionBoardMode(config, shot);
  const cleanedPrompt = cleanVideoPromptForSubmission(shot.prompt || shot.videoPrompt || "");
  if (cleanedPrompt && cleanedPrompt !== shot.prompt) {
    shot.prompt = cleanedPrompt;
    writeVideoConfigRecord(configRecord, config);
  }
  const runNamespace = currentRunNamespace(episodeRoot, config);
  const forceRegenerate = body.forceRegenerate === true || body.force === true;
  const pollInBackground = body.pollInBackground !== false;
  const existingSnapshot = snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
  if (existingSnapshot?.statusCode === 1 && existingSnapshot.taskId) {
    const reused = await refreshExistingProjectVideoTask(episodeRoot, shotName, existingSnapshot, runNamespace);
    return { shotName, reusedExistingTask: true, result: reused.result || { taskId: existingSnapshot.taskId, status: "running", provider: existingSnapshot.provider } };
  }
  if (projectVideoShotNeedsFinalization(existingSnapshot)) {
    finalizeExistingProjectVideoShot(episodeRoot, shotName, existingSnapshot, runNamespace).catch(() => {});
    return {
      shotName,
      reusedExistingTask: true,
        result: {
          taskId: existingSnapshot.taskId || "",
          status: "running",
          provider: existingSnapshot.provider || "",
          videoUrl: existingSnapshot.videoUrl || "",
          message: tailFrameRequired ? "视频已生成，正在下载并抽取尾帧" : "视频已生成，正在下载",
        },
      };
  }
  if (!forceRegenerate && existingSnapshot?.complete) {
    return {
      shotName,
      reusedExistingTask: true,
      result: {
        taskId: existingSnapshot.taskId || "",
        status: "completed",
        provider: existingSnapshot.provider || "",
        videoUrl: existingSnapshot.videoUrl || "",
        message: "该片段已完成；普通生成不会重复提交。如需重生成，请使用明确的重新生成入口。",
      },
    };
  }
  try {
    assertProjectTailFrameReadyForShot(episodeRoot, shot, config);
  } catch (error) {
    const message = error.message || "等待上一段尾帧";
    markProjectVideoShotWaiting(episodeRoot, shotName, message, { statusRaw: "waiting_tail_frame" });
    return { shotName, waitingForAssets: true, result: { status: "queued", progress: 0, message } };
  }
  archiveShotVideoArtifactsForRegeneration(episodeRoot, shotName);
  writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
    runNamespace,
    taskInfo: {
      status: 1,
      progressPercent: 1,
      failedReason: "",
      message: "正在提交 Seedance 任务",
      taskId: "",
      provider: "",
      videoUrl: "",
      tailFrameUrl: "",
      tailFrameLocalFile: "",
      tailFrameReady: false,
      tailFrameRequired,
      tailFrameMessage: "",
      localFile: "",
      updatedAt: new Date().toISOString(),
    },
  });
  const shotReferenceNames = videoSubmissionReferenceNames(config, [shot]);
  const arkPersonNames = arkPersonReferenceNames(episodeRoot, config, shotReferenceNames, shot);
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
  const needsArkPersonPreparation = arkPersonNames.some((name) => {
    const asset = referenceAssetSource(episodeRoot, assetByName, name);
    return asset && !arkPersonAssetReadyUrl(asset);
  }) || projectTailFrameNeedsArkPersonPreparation(episodeRoot, config, shot);
  // HTTP 单段请求只排队返回;批量队列显式传 false,在已有后台 worker 中等待认证完成。
  if (pollInBackground && needsArkPersonPreparation) {
    const message = "正在完成方舟私域虚拟人像认证，完成后自动提交视频";
    markProjectVideoShotWaiting(episodeRoot, shotName, message);
    setImmediate(() => {
      generateProjectVideoShot(episodeRoot, { ...body, shotName, pollInBackground: false }).catch((error) => {
        const errorMessage = error.message || "视频生成失败";
        if (isAssetActivationWaitFailure(errorMessage)) {
          markProjectVideoShotWaiting(episodeRoot, shotName, errorMessage);
          return;
        }
        writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
          runNamespace,
          taskInfo: { status: 3, progressPercent: 100, failedReason: errorMessage, message: errorMessage, updatedAt: new Date().toISOString() },
        });
      });
    });
    return { shotName, waitingForAssets: true, result: { status: "queued", progress: 0, message } };
  }
  try {
    const deadline = Date.now() + PREPARE_REFS_TIMEOUT_MS;
    config = await ensureArkPersonAssetsForNames(episodeRoot, configRecord, shotReferenceNames, deadline, shot);
    const readiness = await ensureProjectPhotorealReferencesReady(episodeRoot, configRecord, shot);
    config = readiness.config || config;
    const latestShot = (Array.isArray(config.shots) ? config.shots : []).find((item) => item.name === shotName) || shot;
    assertVideoConfigAssetsReady(config, latestShot, episodeRoot);
    syncProjectShotsToCanvasState(episodeRoot, config, [latestShot]);
    if (!readiness.ready) {
      const message = readiness.message || "超写实参考图素材库验证未完成，暂不提交视频生成";
      markProjectVideoShotWaiting(episodeRoot, shotName, message);
      return { shotName, waitingForAssets: true, result: { status: "queued", progress: 0, message } };
    }
    let payload = projectVideoPayloadForShot(episodeRoot, latestShot, config);
    assertProjectTailFrameReadyForShot(episodeRoot, latestShot, config);
    if (payload.startFrameUrl) {
      const tailFrameAsset = await ensureTailFrameAssetReference(episodeRoot, config, latestShot, payload.startFrameUrl);
      config = tailFrameAsset.config || config;
      if (tailFrameAsset.config && tailFrameAsset.config !== readiness.config) writeVideoConfigRecord(configRecord, config);
      if (!tailFrameAsset.ready) {
        const message = tailFrameAsset.message || "上一段尾帧正在进入素材库，暂不提交视频生成";
        markProjectVideoShotWaiting(episodeRoot, shotName, message);
        return { shotName, waitingForAssets: true, result: { status: "queued", progress: 0, message } };
      }
      payload = { ...payload, startFrameUrl: tailFrameAsset.url };
    }
    const result = await createCanvasVideoGeneration(payload);
    if (!result.videoUrl && result.status !== "completed" && !result.taskId) {
      const message = "视频接口已响应，但没有返回 taskId；请检查模型/素材 payload 是否被上游接收。";
      appendVideoApiLog({
        provider: result.provider || canvasVideoProviderForBody(payload),
        method: "POST",
        url: "createCanvasVideoGeneration",
        status: "MISSING_TASK_ID",
        message,
        response: result.raw || {},
      });
      throw new Error(message);
    }
    updateProjectVideoSnapshotFromResult(episodeRoot, shotName, result, runNamespace);
    recordUserVideoTask(authUser, {
      kind: "project",
      projectId: encodeId(episodeRoot),
      shotName,
      taskId: result.taskId || "",
      provider: result.provider || "",
      completed: result.status === "completed" || !!result.videoUrl,
    });
    const resultVideoUrl = videoUrlFrom(result.videoUrl || "");
    if (resultVideoUrl && result.status === "completed") {
      const localFile = await downloadProjectVideoResult(episodeRoot, shotName, resultVideoUrl);
      const tailFrame = await persistProjectTailFrame(episodeRoot, shotName, result, localFile);
      const latestTailFrameRequired = !isProductionBoardMode(config, latestShot);
      writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
        runNamespace,
        provider: result.provider || "",
        urls: resultVideoUrl ? [resultVideoUrl] : [],
        taskInfo: {
          taskId: result.taskId || "",
          provider: result.provider || "",
          status: 2,
          progressPercent: 100,
          failedReason: "",
          message: projectVideoFinalizingMessage(tailFrame, localFile, { tailFrameRequired: latestTailFrameRequired }),
          videoUrl: resultVideoUrl,
          tailFrameUrl: tailFrame.url || result.tailFrameUrl || "",
          tailFrameLocalFile: tailFrame.localFile || "",
          tailFrameReady: tailFrame.ready,
          tailFrameRequired: latestTailFrameRequired,
          tailFrameSource: tailFrame.source || "",
          tailFrameMessage: tailFrame.message || "",
          localFile: localFile ? path.relative(episodeRoot, localFile) : "",
          updatedAt: new Date().toISOString(),
        },
      });
    } else if (result.taskId && pollInBackground) {
      pollProjectVideoGeneration(episodeRoot, shotName, result.taskId, result.provider || "", runNamespace, authUser).catch((error) => {
        markUserVideoTaskFinished(authUser, result.taskId);
        writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
          runNamespace,
          provider: result.provider || "",
          taskInfo: {
            taskId: result.taskId,
            provider: result.provider || "",
            status: 3,
            progressPercent: 100,
            failedReason: error.message || "视频生成失败",
            updatedAt: new Date().toISOString(),
          },
        });
      });
    }
    return { shotName, result };
  } catch (error) {
    if (isAssetActivationWaitFailure(error.message || "")) throw error;
    writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
      runNamespace,
      taskInfo: {
        status: 3,
        progressPercent: 100,
        failedReason: error.message || "视频生成失败",
        message: error.message || "视频生成失败",
        updatedAt: new Date().toISOString(),
      },
    });
    throw error;
  }
}

async function runProjectVideoGenerationQueue(queue, episodeRoot, selected, body = {}) {
  const results = [];
  const queueConfig = readVideoConfig(episodeRoot)?.data || {};
  const queueUsesProductionBoard = isProductionBoardMode(queueConfig);
  try {
    for (const [index, shot] of selected.entries()) {
      const shotName = compactLine(shot.name);
      if (!shotName) continue;
      if (isProjectVideoShotComplete(episodeRoot, shotName, queue.runNamespace)) continue;
      const existing = snapshotStatusForShot(episodeRoot, shotName, { runNamespace: queue.runNamespace });
      if (existing?.statusCode === 1 && existing.taskId) continue;
      if (projectVideoShotNeedsFinalization(existing)) continue;
      if (
        existing?.statusCode === 0 &&
        (/queued_local|waiting_asset_active|waiting_tail_frame/i.test(compactLine(existing.statusRaw || "")) ||
          isAssetActivationWaitFailure(existing.message || ""))
      ) continue;
      const tailFrameDependent =
        !queueUsesProductionBoard && shot.useTailFrame === true && compactLine(shot.tailFrameSource || "");
      markProjectVideoShotQueued(
        episodeRoot,
        shotName,
        index === 0 && queue.recovered !== true
          ? "排队中：准备提交"
          : tailFrameDependent
            ? "排队中：等待前序片段尾帧"
            : "排队中：并发提交",
      );
    }
    const processQueueShot = async (shot) => {
      const shotName = compactLine(shot.name);
      if (!shotName) return null;
      try {
        if (isProjectVideoShotComplete(episodeRoot, shotName, queue.runNamespace)) {
          const snapshot = snapshotStatusForShot(episodeRoot, shotName, { runNamespace: queue.runNamespace });
          const reused = {
            shotName,
            reusedExistingTask: true,
            result: {
              taskId: snapshot?.taskId || "",
              status: "completed",
              provider: snapshot?.provider || "",
              videoUrl: snapshot?.videoUrl || "",
              message: "该片段已完成，批量队列已跳过重复提交。",
            },
          };
          results.push(reused);
          queue.completed = results.length;
          queue.results = results;
          queue.updatedAt = new Date().toISOString();
          projectVideoQueues.set(queue.key, queue);
          return reused;
        }
        queue.currentShotName = shotName;
        queue.updatedAt = new Date().toISOString();
        projectVideoQueues.set(queue.key, queue);
        const runningSnapshot = snapshotStatusForShot(episodeRoot, shotName, { runNamespace: queue.runNamespace });
        let result = null;
        if (runningSnapshot?.statusCode === 1 && runningSnapshot.taskId) {
          const reused = await refreshExistingProjectVideoTask(episodeRoot, shotName, runningSnapshot, queue.runNamespace);
          result = {
            shotName,
            reusedExistingTask: true,
            result: reused.result || { taskId: runningSnapshot.taskId, status: "running", provider: runningSnapshot.provider },
          };
        } else if (projectVideoShotNeedsFinalization(runningSnapshot)) {
          await finalizeExistingProjectVideoShot(episodeRoot, shotName, runningSnapshot, queue.runNamespace);
          result = {
            shotName,
            reusedExistingTask: true,
            result: {
              taskId: runningSnapshot.taskId || "",
              status: "running",
              provider: runningSnapshot.provider || "",
              videoUrl: runningSnapshot.videoUrl || "",
              message: queueUsesProductionBoard ? "视频已生成，正在下载" : "视频已生成，正在下载并抽取尾帧",
            },
          };
        } else {
          result = await generateProjectVideoShot(episodeRoot, { ...body, shotName, pollInBackground: false });
        }
        if (result?.waitingForAssets || projectVideoShotIsWaitingForAssets(episodeRoot, shotName, queue.runNamespace)) {
          await waitForProjectVideoShotAssetGate(episodeRoot, shotName, { timeoutMs: Number(body.assetWaitTimeoutMs || 12 * 60 * 1000) });
          result = await generateProjectVideoShot(episodeRoot, { ...body, shotName, pollInBackground: false });
        }
        await waitForProjectVideoShotComplete(episodeRoot, shotName, { timeoutMs: Number(body.timeoutMs || 45 * 60 * 1000) });
        markUserVideoTaskFinished(body.authUser || null, result?.result?.taskId || "");
        results.push(result);
        queue.completed = results.length;
        queue.results = results;
        queue.updatedAt = new Date().toISOString();
        projectVideoQueues.set(queue.key, queue);
        return result;
      } catch (error) {
        const message = error.message || "视频生成失败";
        if (isAssetActivationWaitFailure(message)) {
          markProjectVideoShotWaiting(episodeRoot, shotName, message);
        } else {
          writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
            runNamespace: queue.runNamespace,
            taskInfo: { status: 3, progressPercent: 100, failedReason: message, message, updatedAt: new Date().toISOString() },
          });
        }
        const failedResult = { shotName, failed: true, error: message };
        results.push(failedResult);
        queue.completed = results.length;
        queue.results = results;
        queue.updatedAt = new Date().toISOString();
        projectVideoQueues.set(queue.key, queue);
        return failedResult;
      }
    };

    const concurrency = Math.min(6, Math.max(1, Number(body.concurrency) || concurrentVideoLimitForUser(body.authUser) || DEFAULT_CONCURRENT_VIDEO_LIMIT));
    if (queueUsesProductionBoard) {
      // 故事板模式：各段独立无尾帧依赖 -> 并发提交（受账号并发上限约束，封顶 6）。
      await runWithConcurrency(selected, concurrency, processQueueShot);
    } else {
      // 首尾帧模式：只有真正续接尾帧(useTailFrame 且尾帧源在本批内)的片段才等其源片段完成；
      // 其余(独立段/多条链)并发提交。尾帧链内部按序串行;某段失败只中断其下游链,不拖累独立段。
      const selectedNames = new Set(selected.map((shot) => compactLine(shot.name)).filter(Boolean));
      const depOf = (shot) => {
        const src = compactLine(shot.tailFrameSource || "");
        return shot.useTailFrame === true && src && selectedNames.has(src) ? src : "";
      };
      const onBlocked = (shot, depKey) => {
        const shotName = compactLine(shot.name);
        const message = `前序片段「${depKey}」生成失败，尾帧链中断，本段未提交`;
        writeProjectVideoTaskSnapshot(episodeRoot, shotName, {
          runNamespace: queue.runNamespace,
          taskInfo: { status: 3, progressPercent: 100, failedReason: message, message, updatedAt: new Date().toISOString() },
        });
        const failedResult = { shotName, failed: true, blocked: true, error: message };
        results.push(failedResult);
        queue.completed = results.length;
        queue.results = results;
        queue.updatedAt = new Date().toISOString();
        projectVideoQueues.set(queue.key, queue);
        return failedResult;
      };
      await runWithDependencies(selected, concurrency, processQueueShot, {
        keyOf: (shot) => compactLine(shot.name),
        depOf,
        onBlocked,
      });
    }
    queue.status = "complete";
  } catch (error) {
    queue.status = "failed";
    queue.error = error.message || "批量视频生成失败";
    if (queue.currentShotName) {
      if (isAssetActivationWaitFailure(queue.error)) {
        markProjectVideoShotWaiting(episodeRoot, queue.currentShotName, queue.error);
      } else {
        writeProjectVideoTaskSnapshot(episodeRoot, queue.currentShotName, {
          runNamespace: queue.runNamespace,
          taskInfo: {
            status: 3,
            progressPercent: 100,
            failedReason: queue.error,
            message: queue.error,
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }
  } finally {
    queue.running = false;
    queue.finishedAt = new Date().toISOString();
    setTimeout(() => {
      const latest = projectVideoQueues.get(queue.key);
      if (latest?.id === queue.id && latest.running !== true) projectVideoQueues.delete(queue.key);
    }, 60_000);
  }
}

function recoverProjectVideoQueueIfNeeded(episodeRoot, config = {}) {
  const queueKey = projectVideoQueueKey(episodeRoot);
  if (projectVideoQueues.get(queueKey)?.running) return null;
  const shots = Array.isArray(config.shots) ? config.shots : [];
  if (!shots.length) return null;
  const runNamespace = currentRunNamespace(episodeRoot, config);
  const firstPendingIndex = shots.findIndex((shot) => {
    const snapshot = snapshotStatusForShot(episodeRoot, shot.name, { runNamespace });
    if (!snapshot) return false;
    if (snapshot.statusCode === 1 && snapshot.taskId) return true;
    if (projectVideoShotNeedsFinalization(snapshot)) return true;
    if (snapshot.statusCode !== 0) return false;
    if (snapshot.failed && snapshotIsAssetActivationWait(snapshot)) return true;
    return /queued_local|waiting_asset_active|waiting_tail_frame/i.test(compactLine(snapshot.statusRaw || "")) || isAssetActivationWaitFailure(snapshot.message || "");
  });
  if (firstPendingIndex < 0) return null;
  const unfinished = shots.slice(firstPendingIndex).filter((shot) => !isProjectVideoShotComplete(episodeRoot, shot.name, runNamespace));
  if (!unfinished.length) return null;
  const queue = {
    id: `video_queue_recovered_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    key: queueKey,
    running: true,
    status: "running",
    recovered: true,
    total: unfinished.length,
    completed: 0,
    results: [],
    runNamespace,
    currentShotName: unfinished[0]?.name || "",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  projectVideoQueues.set(queueKey, queue);
  runProjectVideoGenerationQueue(queue, episodeRoot, unfinished, { recovered: true }).catch((error) => {
    queue.running = false;
    queue.status = "failed";
    queue.error = error.message || "恢复批量视频生成失败";
    queue.finishedAt = new Date().toISOString();
  });
  return queue;
}

async function generateProjectVideoShotsSequentially(episodeRoot, body = {}) {
  const queueKey = projectVideoQueueKey(episodeRoot);
  const existingQueue = projectVideoQueues.get(queueKey);
  if (existingQueue?.running) {
    return {
      total: existingQueue.total || 0,
      completed: existingQueue.completed || 0,
      running: true,
      queueId: existingQueue.id,
      message: "已有批量生成队列在运行，本次不会重复提交。",
      results: existingQueue.results || [],
    };
  }
  const configRecord = readVideoConfig(episodeRoot);
  const config = { ...(configRecord?.data || {}), episodeRoot };
  const shots = Array.isArray(config.shots) ? config.shots : [];
  if (!shots.length) throw new Error("视频配置中没有可生成的片段");
  assertVideoConfigAssetsReady(config, null, episodeRoot);
  const requested = Array.isArray(body.shotNames) ? new Set(body.shotNames.map(compactLine).filter(Boolean)) : null;
  const selected = requested?.size ? shots.filter((shot) => requested.has(shot.name)) : shots;
  if (!selected.length) throw new Error("没有匹配的视频片段可生成");
  const queue = {
    id: `video_queue_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    key: queueKey,
    running: true,
    status: "preparing",
    total: selected.length,
    completed: 0,
    results: [],
    runNamespace: currentRunNamespace(episodeRoot, config),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: "正在准备参考图(素材库验证)…",
  };
  projectVideoQueues.set(queueKey, queue);
  // 后台执行:阶段0 准备参考图(人物轨 asset:// / 非人物轨公网)→ 就绪则跑提交队列;不就绪则整批标记失败并写卡住清单。
  // 全程不阻塞 HTTP 响应(阶段0 轮询最长 8 分钟,绝不能卡在请求里导致前端超时)。
  (async () => {
    const prepRecord = readVideoConfig(episodeRoot);
    const prep = await prepareBatchVideoReferences(episodeRoot, prepRecord, selected, {
      timeoutMs: Number(body.prepareTimeoutMs || PREPARE_REFS_TIMEOUT_MS),
    });
    if (!prep.ready) {
      const list = prep.stuck.map((s) => `${s.name}(${s.reason})`).join("、");
      queue.stuck = prep.stuck;
      queue.running = false;
      queue.status = "blocked";
      queue.error = `参考图验证未通过，视频未提交：${list}`;
      queue.message = "请先生成或导入缺失参考图，并确认其来源可用后再提交批量视频。";
      queue.finishedAt = new Date().toISOString();
      projectVideoQueues.set(queueKey, queue);
      setTimeout(() => {
        const latest = projectVideoQueues.get(queueKey);
        if (latest?.id === queue.id && latest.running !== true) projectVideoQueues.delete(queueKey);
      }, 10 * 60 * 1000);
      return;
    }
    queue.status = "running";
    queue.message = "";
    queue.updatedAt = new Date().toISOString();
    projectVideoQueues.set(queueKey, queue);
    syncProjectShotsToCanvasState(episodeRoot, prep.config || config, selected);
    await runProjectVideoGenerationQueue(queue, episodeRoot, selected, body);
  })().catch((error) => {
    queue.running = false;
    queue.status = "failed";
    queue.error = error.message || "批量视频生成失败";
    queue.finishedAt = new Date().toISOString();
    projectVideoQueues.set(queueKey, queue);
  });
  return {
    total: selected.length,
    completed: 0,
    running: true,
    queueId: queue.id,
    message: "已开始准备参考图(素材库验证),就绪后自动逐段提交。",
    results: [],
  };
}

async function createLivenessFaceSession(body = {}) {
  const name = compactLine(body.name || "真人A");
  if (!name) throw new Error("缺少真人模型名称");
  const payload = { name };
  const description = compactLine(body.description || "");
  if (description) payload.description = description;
  const channelId = Number(body.channelId || body.channel_id || process.env.GRAVITEX_DEFAULT_CHANNEL_ID || "");
  if (Number.isInteger(channelId) && channelId > 0) payload.channel_id = channelId;
  const raw = await callGravitexJson("/visual-validate/session", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    h5_link: raw.h5_link || raw.data?.h5_link || "",
    state: raw.state || raw.data?.state || "",
    channel_id: raw.channel_id || raw.data?.channel_id || "",
    byted_token: raw.byted_token || raw.data?.byted_token || "",
    expires_in: raw.expires_in || raw.data?.expires_in || 900,
    raw,
  };
}

function evidenceTerms(term) {
  const cleanTerm = compactLine(term).replace(/^(外景|内景|EXT\.?|INT\.?|EXTERIOR|INTERIOR)\s*[·.:-]?\s*/i, "").trim();
  const honorifics = new Set(["dr", "doctor", "mr", "mrs", "ms", "sheriff", "deputy", "agent", "officer", "int", "ext", "exterior", "interior"]);
  const source = [term, cleanTerm].filter(Boolean);
  const splitTerms = source.flatMap((item) => String(item).split(/[\s_·.:-]+/).map((part) => part.trim()));
  return [...source, ...splitTerms]
    .map(compactLine)
    .filter((part) => part.length >= 2)
    .filter((part) => !honorifics.has(part.toLowerCase()))
    .filter((part, index, arr) => arr.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index);
}

function normalizeEvidenceText(value) {
  return compactLine(value).replace(/[\s_·.:-]+/g, " ").trim().toLowerCase();
}

function lineMatchesEvidenceTerm(line, terms) {
  const haystack = normalizeEvidenceText(line);
  return terms.some((part) => {
    const needle = normalizeEvidenceText(part);
    if (!needle) return false;
    if (/^[a-z0-9 ]+$/i.test(needle)) {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
    }
    return haystack.includes(needle);
  });
}

function evidenceForTerm(script, term, fallback = "") {
  const rawLines = script.split(/\r?\n/);
  const lines = rawLines.map(compactLine);
  const terms = evidenceTerms(term);
  const contexts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !lineMatchesEvidenceTerm(line, terms)) continue;
    const context = [line];
    const lineIsScene = isSceneHeadingLine(line);
    const lineIsSpeaker = isEnglishSpeakerCue(line) || isChineseSpeakerCue(lines, i);
    for (let j = i + 1; j < lines.length && context.length < (lineIsScene ? 4 : 3); j += 1) {
      const next = lines[j];
      if (!next) {
        if (lineIsSpeaker) break;
        continue;
      }
      if (j !== i + 1 && lineIsSpeaker && (isEnglishSpeakerCue(next) || isChineseSpeakerCue(lines, j) || isSceneHeadingLine(next))) break;
      if (lineIsScene && isSceneHeadingLine(next)) break;
      if (!lineIsScene && !lineIsSpeaker && isSceneHeadingLine(next)) break;
      context.push(next);
    }
    contexts.push(context.join(" / "));
    if (contexts.length >= 2) break;
  }
  if (!contexts.length && fallback) contexts.push(fallback);
  if (!contexts.length) contexts.push(lines.find((line) => line.length > 12) || "剧本未提供更多明确描述。");
  return contexts.join(" / ").slice(0, 520);
}

function slugWords(value, max = 5) {
  return safeSlug(
    String(value)
      .replace(/^(外景|内景|EXT\.?|INT\.?)/i, "")
      .split(/\s+/)
      .slice(0, max)
      .join("_"),
    "STORY_BEAT",
  ).toUpperCase();
}

function namedAssetSlug(value, fallback = "ASSET") {
  return safeAssetSlug(value, fallback).toUpperCase();
}

function assetName(prefix, index, label, suffix) {
  return `${prefix}${String(index).padStart(3, "0")}_${namedAssetSlug(label, suffix)}_${suffix}`;
}

function typedAssetName(type, index, label) {
  const meta = assetMeta(type);
  return assetName(meta.prefix, index, label, meta.suffix);
}

function assetMatchCode(type, name = "", index = 0) {
  const rawName = String(name || "");
  const match = rawName.match(/^(SB|[CSPI])(\d{3})_/i);
  if (match) return `PT-${match[1].toUpperCase()}${match[2]}`;
  const normalized = normalizeAssetType(type || inferAssetTypeFromName(rawName), "Prop");
  const prefix = assetMeta(normalized).prefix;
  const number = String(Math.max(1, Number(index) || 1)).padStart(3, "0");
  return `PT-${prefix}${number}`;
}

function assetMatchRuleForPrompt(asset) {
  const code = asset.matchCode || assetMatchCode(asset.type, asset.name || asset.id || asset.label);
  const type = normalizeAssetType(asset.type || inferAssetTypeFromName(asset.name || asset.id), "Prop");
  if (type === "Character") {
    return `Production matching code: ${code}. This code links this character asset to storyboard silhouette labels and video prompts. Do not render any readable code, label, watermark, UI mark, caption, or text inside the image.`;
  }
  if (type === "Scene") {
    return `Production matching code: ${code}. This code links this location asset to storyboard scene-zone labels and video prompts. Do not render any readable code, label, signage, watermark, UI mark, caption, or text unless exact signage is explicitly required by the screenplay.`;
  }
  if (type === "Prop" || type === "Insert") {
    return `Production matching code: ${code}. This code links this prop or insert asset to storyboard prop labels and video prompts. Do not render any readable code, label, watermark, UI mark, caption, or extra text inside the image.`;
  }
  return `Production matching code: ${code}. Use this as workflow metadata only; do not render the code inside the image.`;
}

function withAssetMatchRule(prompt, asset) {
  const text = String(prompt || "").trim();
  if (!text) return text;
  const code = asset.matchCode || assetMatchCode(asset.type, asset.name || asset.id || asset.label);
  if (text.includes(code) || /Production matching code:/i.test(text)) return text;
  return `${assetMatchRuleForPrompt({ ...asset, matchCode: code })}\n${text}`;
}

function buildRuleAssets(script, worldProfile) {
  const manualBlocks = extractManualAssetPromptBlocks(script);
  const structuredDescriptions = parseStructuredAssetDescriptions(script);
  const structuredTypes = new Set(structuredDescriptions.map((asset) => asset.type));
  // 三类资产都由用户逐卡提供时，字段和画风锚不是剧本实体。
  // 只保留明确的卡片，避免通用剧本规则把“中文提示词 / 使用备注”等元信息再加回清单。
  const hasCompleteStructuredAssetPlan =
    structuredTypes.has("Character") &&
    structuredTypes.has("Scene") &&
    (structuredTypes.has("Prop") || structuredTypes.has("Insert"));
  const locations = hasCompleteStructuredAssetPlan ? [] : parseLocations(script);
  const characters = hasCompleteStructuredAssetPlan
    ? []
    : parseCharacters(script).filter((name) => !shouldSuppressRuleCharacter(name, manualBlocks));
  const hasPhone = /phone|手机|电话|未知号码|calls?|VOSS/i.test(script);
  const hasPhoto = /photo|照片|photograph|2005/i.test(script);
  const hasMercyJerichoPhoto = /Mercy and Jericho\. Before the fire|两个孩子站在烧毁前的农场前/i.test(script);
  const hasFolder = /folder|文件夹|PROJECT|GRAYLIGHT|机密/i.test(script);
  const hasDeadstockBody = /(?:牲畜|牛|cattle|cow)[\s\S]{0,120}(?:尸体|dead|灰化|中空)|(?:尸体|dead)[\s\S]{0,120}(?:牲畜|牛|cattle|cow)/i.test(script);
  const hasOmegaCore = /Ω|Omega|生物装甲|战甲|Omega[-\s]?core|Ω核心/i.test(script);
  const hasColdBlueBuildingEnergy = /外墙[\s\S]{0,40}(?:冷蓝色能源纹路|能源纹路)|Hale Tower[\s\S]{0,80}冷蓝色能源纹路|冷蓝色能源纹路[\s\S]{0,40}(?:外墙|大厦|Tower)/i.test(script);
  const hasEnergyBlade = /能量刃|energy blade|手腕装甲/i.test(script);
  const hasMaintenancePaper = /检修单据|设备检修|maintenance/i.test(script);
  const hasBlackArmoredTransport = /黑色重型装甲押运车|装甲押运车/.test(script);
  const hasHeavyHandcuffs = /重型手铐|手铐/.test(script);
  const hasRedReleaseButton = /红色按钮|按下红色/.test(script);
  const hasBlacklistFileScreen = /黑名单三人档案|三个档案|Open the blacklist/i.test(script);
  if (/小尼玛/.test(script)) pushUnique(characters, "小尼玛");
  if (/多瞳|雪狮|神兽|发光巨兽|幽蓝发光/.test(script)) pushUnique(characters, /多瞳/.test(script) ? "多瞳发光巨兽" : "幽蓝发光神兽");
  if (/变异章鱼怪|紫黑色触手|巨大(?:的)?章鱼怪/.test(script)) pushUnique(characters, "变异章鱼怪");
  const propCandidates = [
    hasDeadstockBody && { type: "Insert", label: "灰化中空牲畜尸体法医特写", slug: "FORENSIC_ANOMALY_CLOSEUP" },
    hasMercyJerichoPhoto && { type: "Prop", label: "Mercy and Jericho 火灾前旧照片", slug: "MERCY_JERICHO_BEFORE_FIRE_PHOTO" },
    hasPhoto && !hasMercyJerichoPhoto && { type: "Prop", label: /2005/.test(script) ? "2005年泛黄档案照片" : "剧情旧照片", slug: "ARCHIVAL_PHOTOGRAPH" },
    /画册|速写本/.test(script) && { type: "Prop", label: "小尼玛的画册", slug: "小尼玛的画册" },
    /旧自行车|自行车/.test(script) && { type: "Prop", label: "旧自行车", slug: "旧自行车" },
    /被光裹住的小人|黑日、凝固经幡、多瞳发光巨兽|预言图画/.test(script) && { type: "Insert", label: "画册预言图画页 被光裹住的小人", slug: "画册预言图画页_被光裹住的小人" },
    /镜界|冻结现象|时间冻结|现实吞噬|诵经声完全倒放/.test(script) && { type: "Insert", label: "镜界 冻结现象", slug: "镜界_冻结现象" },
    hasPhone && { type: "Prop", label: "未知号码电话插入镜头", slug: "PHONE_CALL_INSERT" },
    hasFolder && { type: "Prop", label: "PROJECT GRAYLIGHT 机密文件夹", slug: "CLASSIFIED_PROJECT_FOLDER" },
    hasOmegaCore && { type: "Insert", label: "Ω核心激活蓝色能量纹路", slug: "OMEGA_CORE_BLUE_ENERGY_INSERT" },
    !hasOmegaCore && hasColdBlueBuildingEnergy && { type: "Insert", label: "Hale Tower 外墙冷蓝能源纹路特写", slug: "HALE_TOWER_COLD_BLUE_ENERGY_VEINS_INSERT" },
    hasEnergyBlade && { type: "Prop", label: "蓝色能量刃", slug: "BLUE_ENERGY_BLADE_PROP" },
    hasMaintenancePaper && { type: "Prop", label: "设备检修单据", slug: "MAINTENANCE_INSPECTION_PAPERWORK" },
    hasBlackArmoredTransport && { type: "Prop", label: "黑色重型装甲押运车", slug: "BLACK_ARMORED_PRISON_TRANSPORT" },
    hasHeavyHandcuffs && { type: "Prop", label: "重型手铐", slug: "HEAVY_HANDCUFFS" },
    hasRedReleaseButton && { type: "Insert", label: "红色释放按钮", slug: "RED_RELEASE_BUTTON_INSERT" },
    hasBlacklistFileScreen && { type: "Insert", label: "黑名单三人档案屏幕", slug: "BLACKLIST_THREE_FILE_SCREEN_INSERT" },
  ].filter(Boolean);

  const assets = [];
  const pushAsset = (asset) => {
    const duplicate = assets.some((item) => {
      if (item.type !== asset.type) return false;
      // 编号分段中的地点名经常有同一长前缀（如“灰幕维护塔·外环/塔心”）。
      // 这类用户明确列出的资产只能按完整名称去重，不能因共用前缀相互吞掉。
      return asset.lockedStructured ? sameAssetLabel(item.label, asset.label) : assetLabelConflict(item.label, asset.label);
    });
    if (duplicate) return;
    assets.push(asset);
  };
  for (const block of manualBlocks) {
    const typeIndex = assets.filter((asset) => asset.type === block.type).length + 1;
    pushAsset({
      type: block.type,
      name: typedAssetName(block.type, typeIndex, block.label),
      label: block.label,
      evidence: `用户提供资产生图提示词：${block.heading}；${block.descriptor || block.label}`,
      visual: block.prompt.slice(0, 900),
      textToImagePromptOverride: validateAnalyzerPrompt({ type: block.type }, block.textToImagePrompt) || block.textToImagePrompt,
      lockedManual: true,
      worldProfile,
    });
  }
  for (const item of structuredDescriptions) {
    const typeIndex = assets.filter((asset) => asset.type === item.type).length + 1;
    pushAsset({
      type: item.type,
      name: typedAssetName(item.type, typeIndex, item.label),
      label: item.label,
      evidence: item.evidence,
      visual: item.visual,
      worldProfile,
      lockedStructured: true,
      analyzerSource: "rules",
      analyzerNote: "用户提供资产视觉描述，分类已锁定",
    });
  }
  const hasExplicitStructuredLabel = (label) => structuredDescriptions.some((item) => sameAssetLabel(item.label, label));
  characters.forEach((name, index) => {
    if (hasExplicitStructuredLabel(name)) return;
    pushAsset({
      type: "Character",
      name: typedAssetName("Character", assets.filter((asset) => asset.type === "Character").length + 1, name),
      label: name,
      evidence: evidenceForTerm(script, name),
      worldProfile,
    });
  });
  locations.forEach((location, index) => {
    if (hasExplicitStructuredLabel(location)) return;
    pushAsset({
      type: "Scene",
      name: typedAssetName("Scene", assets.filter((asset) => asset.type === "Scene").length + 1, location),
      label: location,
      evidence: evidenceForTerm(script, location),
      worldProfile,
    });
  });
  if (!hasCompleteStructuredAssetPlan) {
    propCandidates.forEach((asset, index) => {
      pushAsset({
        type: asset.type,
        name: typedAssetName(asset.type, assets.filter((item) => item.type === asset.type).length + 1, asset.slug || asset.label),
        label: asset.label,
        evidence: evidenceForTerm(script, asset.slug || asset.label, asset.label),
        worldProfile,
      });
    });
  }
  return { assets, characters, locations, propCandidates };
}

function stripJsonFence(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function assetAuditSystemPrompt() {
  return `你是资产分类审核员。逐条判断“当前类型”是否正确，只依据原文证据。
重点抓三类范畴错：
① 人物/角色/生物被误判为 Scene/Prop/Insert；
② 地点/环境被误判为 Character；
③ 道具/物件被误判为 Character。
不要吹毛求疵改措辞；只在类型范畴明确错时才提出。只输出 JSON，不输出 Markdown 或解释。`;
}

function assetAuditUserPrompt({ script, assets }) {
  const listed = assets.map((asset) => ({
    label: asset.label,
    type: asset.type,
    evidence: String(asset.evidence || "").slice(0, 200),
  }));
  return `原文：
${script}

结果清单：
${JSON.stringify(listed, null, 2)}

请逐条审核结果清单中的每条资产，输出 JSON：
{ "reviews": [ { "label", "currentType", "shouldBeType", "confidence": 0-1, "reason" } ] }
shouldBeType 与 currentType 相同表示认可；shouldBeType 只能是 Character、Scene、Prop、Insert。`;
}

function assetAnalyzerSystemPrompt() {
  return `你是短剧制作流程里的“资产视觉解析模型”。你的任务不是写故事，而是把剧本转成可生成参考图的视觉资产设计。

必须遵守：
- 只输出 JSON，不输出 Markdown，不输出解释。
- 所有 JSON 字段内容使用中文，只有 textToImagePrompt 字段必须使用英文。
- 严格根据剧本证据设计，不得凭空添加剧本没有的人物、地点、怪物、武器或事件。
- 你会收到 fallbackCandidates。优先逐项修正这些候选资产；每个修正项必须填写 sourceId，且 sourceId 必须原样等于候选资产里的 sourceId。
- 不得依靠数组顺序匹配资产；必须用 sourceId 和 label 明确指向资产。
- 候选资产给的 type 可能是本地粗规则误判的（例如把地点/场景误标成人物，或把人物误标成场景）。你必须以剧本证据为准判断真实类型：候选 type 判错时，把它放进正确的类别（characters / scenes / props），并原样保留它的 sourceId。类型判断以剧本为准，不要盲从候选给的 type。仅当候选 lockedManual 为 true 时，才必须保留其原类型。
- 如果发现剧本里确实有候选漏掉的新资产，可以新增一项，此时 sourceId 留空；但新增项仍必须有明确剧本证据。
- 人物必须区分年龄、体型、职业、服装、发型、肤色/族裔、神态和关键道具；不要让人物着装过于相似。
- 如果剧本是国外/欧美语境，人物必须是 Western or ethnically diverse non-Chinese casting；不得默认中国人或东亚脸，除非剧本明确写明。
- 人物 label 只能是人物、群体角色或怪物实体名称；不得把地点、时间、组织、文件、镜头说明当成人物。
- 场景必须解析地点、时代、国家/地域感、时间、天气、光线、空间结构和剧情痕迹；场景图必须无人物。
- 场景 label 只能是地点/环境/空间名称；不得把人物、对白、道具、文件标题当成场景。
- 人物资产图规格：16:9、纯白背景、同一人物四视图：全身正面、全身侧面、全身背面、半身特写。不要在资产解析阶段固定超写实；最终画风由界面资产风格选择控制。
- 场景资产图规格：16:9、无人物、全景或大全景。不要在资产解析阶段固定超写实；最终画风由界面资产风格选择控制。
- 道具 Prop 资产图规格：16:9、纯白背景、同一道具三视图：正面、侧面、背面。不要做成生活场景图。
- 插入 Insert 资产保持证据特写/微距细节，不使用道具三视图规则。
- textToImagePrompt 必须是英文，且可以直接提交给 gpt-image-2 文生图模型；必须包含该资产的具体剧本对象、外观差异、材质、时代/地域、构图规则和 negative constraints。

输出 JSON 结构：
{
  "world": "简短世界观/地域/时代",
  "characters": [
    {
      "sourceId": "候选资产 sourceId，若为新增资产则为空字符串",
      "label": "人物名，保留剧本人名",
      "evidence": "剧本依据，必须简短引用/概括",
      "visual": "中文视觉设计，包含年龄、族裔/地域、身材、脸、发型、服装、材质、职业痕迹、独特区分点",
      "textToImagePrompt": "English prompt for one 16:9 pure-white-background full-body front/side/back plus half-body close-up character identity sheet. Do not hardcode photorealism; describe identity, costume, materials and layout only."
    }
  ],
  "scenes": [
    {
      "sourceId": "候选资产 sourceId，若为新增资产则为空字符串",
      "label": "场景名",
      "evidence": "剧本依据",
      "visual": "中文场景设计，包含地点、时间、光线、空间、年代、地域细节、剧情痕迹",
      "textToImagePrompt": "English prompt for one 16:9 wide establishing environment image with no people"
    }
  ],
  "props": [
    {
      "sourceId": "候选资产 sourceId，若为新增资产则为空字符串",
      "type": "Prop 或 Insert",
      "label": "道具或插入镜头主体",
      "evidence": "剧本依据",
      "visual": "中文视觉设计",
      "textToImagePrompt": "English prompt. If type is Prop, prompt must create one 16:9 pure-white-background front/side/back three-view prop reference sheet. If type is Insert, prompt must create one 16:9 insert/evidence detail image. Do not hardcode photorealism; final rendering style is selected later by the UI."
    }
  ]
}`;
}

function assetAnalyzerUserPrompt({ script, fallbackAssets, worldProfile }) {
  const candidates = fallbackAssets.map((asset) => ({
    sourceId: asset.name,
    type: asset.type,
    label: asset.label,
    evidence: asset.evidence,
    lockedManual: !!asset.lockedManual,
    visual: asset.lockedManual ? asset.visual || "" : "",
    textToImagePrompt: asset.lockedManual ? asset.textToImagePromptOverride || "" : "",
  }));
  return JSON.stringify(
    {
      task: "根据剧本生成更准确的资产视觉解析和英文文生图提示词。",
      requiredProcess: [
        "如果 fallbackCandidates 中 lockedManual 为 true，必须保留该候选的 sourceId、type、label 和 textToImagePrompt，不得改成群体角色或其他人物。",
        "先阅读 screenplay，确认人物、场景、道具/插入镜头。",
        "再逐项检查 fallbackCandidates，用 sourceId 原样回填；若某候选的 type 与剧本证据不符（且非 lockedManual），把它归入正确类别（characters/scenes/props）并保留其 sourceId。",
        "最后只为剧本明确遗漏的新资产新增条目。",
        "输出只允许 JSON；不要输出规则说明。",
      ],
      worldProfile,
      fallbackCandidates: candidates,
      screenplay: script.slice(0, 26000),
    },
    null,
    2,
  );
}

function validateAnalyzerPrompt(asset, prompt) {
  const text = compactLine(prompt);
  if (text.length < 120) return "";
  if (/[\u4e00-\u9fff]/.test(text)) return "";
  const lower = text.toLowerCase();
  const hasAny = (terms) => terms.some((term) => lower.includes(term));
  const groups =
    asset.type === "Character"
      ? [["16:9"], ["pure white", "white background"], ["front"], ["side"], ["back"], ["half-body", "half body", "portrait"]]
      : asset.type === "Scene"
        ? [["16:9"], ["wide", "establishing"], ["no people", "without people", "empty environment", "no human"]]
        : asset.type === "Prop"
          ? [["16:9"], ["pure white", "white background"], ["front"], ["side"], ["back"]]
          : [["16:9"]];
  if (!groups.every(hasAny)) return "";
  return prompt.trim();
}

// 分批解析:整份文档一次性解析要吐 ~1万 tokens、200-300秒常超时;超时由资产提取流程硬失败,
// 不再静默写入本地傻规则结果(把单字名昼/绯乱塞进道具)。
// 拆成按类型的小请求(人物/场景/道具各一个,实测人物专项仅 65秒/2851 tokens),每个远低于超时线。
// FOCUS_SPEC:每个焦点对应输出数组名 + 追加到系统 prompt 的"本次只输出该类"约束。
const ANALYZER_FOCUSES = [
  { key: "characters", label: "人物 characters", instruction: "本次只输出 characters 数组(列出所有出场人物,含单字名、配角、群体角色、怪物实体,不得遗漏);scenes 和 props 必须为空数组 []。" },
  { key: "scenes", label: "场景 scenes", instruction: "本次只输出 scenes 数组(列出所有地点/环境/空间);characters 和 props 必须为空数组 []。" },
  { key: "props", label: "道具/插入 props", instruction: "本次只输出 props 数组(列出所有道具与插入特写 Insert);characters 和 scenes 必须为空数组 []。" },
];

function assetAnalyzerSystemPromptForFocus(instruction) {
  return `${assetAnalyzerSystemPrompt()}

本次请求的特别约束(分批解析):
- ${instruction}
- 其余规则不变;仍需对本类资产逐项修正 fallbackCandidates 并原样保留 sourceId。`;
}

// 把多个 typed 结果合并成单一 data。哪个焦点成功就采纳哪个的数组;world 取第一个非空。纯函数,可单测。
function mergeTypedAnalyzerResults(results) {
  const data = { world: "", characters: [], scenes: [], props: [] };
  const succeeded = [];
  const failed = [];
  for (const r of results) {
    if (r?.ok && r.data) {
      succeeded.push(r.focus);
      if (!data.world && r.data.world) data.world = r.data.world;
      if (Array.isArray(r.data.characters)) data.characters.push(...r.data.characters);
      if (Array.isArray(r.data.scenes)) data.scenes.push(...r.data.scenes);
      if (Array.isArray(r.data.props)) data.props.push(...r.data.props);
    } else {
      failed.push(`${r?.focus || "?"}(${r?.reason || "失败"})`);
    }
  }
  return { data, succeeded, failed };
}

async function callAssetAnalyzerModel({ script, fallbackAssets, worldProfile, modelName }) {
  const primary = normalizeAssetAnalyzerModel(modelName);
  if (primary === "rules") return { ok: false, model: primary, reason: "使用本地规则解析，未调用外部资产解析模型" };
  const apiKey = assetAnalyzerApiKey();
  if (!apiKey) return { ok: false, model: primary, reason: "未配置资产解析模型 API Key" };
  const requestBody = (model, withJsonMode, focus) => ({
    model,
    temperature: 0.25,
    ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: focus ? assetAnalyzerSystemPromptForFocus(focus.instruction) : assetAnalyzerSystemPrompt() },
      { role: "user", content: assetAnalyzerUserPrompt({ script, fallbackAssets, worldProfile }) },
    ],
  });
  const post = (model, withJsonMode, focus) =>
    fetchAssetAnalyzer(openAiCompatUrl("/v1/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(model, withJsonMode, focus)),
    });
  // 单个模型跑一次,返回 { ok, data } / { retryable, reason }
  const tryModel = async (model, focus) => {
    try {
      let response = await post(model, true, focus);
      let raw = await response.text();
      if (!response.ok && response.status === 400 && /response_format|json_object/i.test(raw)) {
        response = await post(model, false, focus);
        raw = await response.text();
      }
      if (!response.ok) {
        const reason = `模型接口返回 HTTP ${response.status}: ${raw.slice(0, 300)}`;
        // 401/403 是鉴权错误,对同网关所有模型都致命,切换也没用 → 直接放弃
        const fatalForAll = response.status === 401 || response.status === 403;
        return { retryable: !fatalForAll, reason };
      }
      const data = JSON.parse(raw);
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(stripJsonFence(content));
      return { ok: true, data: parsed };
    } catch (error) {
      // fetch failed / 超时 / JSON 解析失败 → 可切换到备用模型
      return { retryable: true, reason: error?.message || String(error) };
    }
  };
  // 主模型(默认 opus)一旦超时 / 网关抽风(fetch failed / 5xx / 429),立刻切换到备用模型 claude-sonnet-5,
  // 而不是死磕同一个抽风模型再摔回本地傻规则(导致垃圾资产:undefined 名字 / 缺场景)。
  // 注意:api.apikey.fun 是 Claude-only 模型组(只有 claude-opus/sonnet/haiku 各版本),填 gpt 名会 404。
  const FALLBACK_MODEL = "claude-sonnet-5";
  const candidates = primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
  // 单个焦点:opus 失败(超时/网关抽风)立刻切 sonnet;鉴权类致命错(401/403)直接放弃。
  const runFocus = async (focus) => {
    let lastReason = "";
    for (let i = 0; i < candidates.length; i += 1) {
      const model = candidates[i];
      const result = await tryModel(model, focus);
      if (result.ok) return { focus: focus.label, ok: true, model, data: result.data };
      lastReason = `${model}: ${result.reason}`;
      if (!result.retryable) return { focus: focus.label, ok: false, model, reason: result.reason };
      if (i < candidates.length - 1) {
        console.error(`[assetAnalyzer] ${focus.label} ${model} 失败(${result.reason})，切换到 ${candidates[i + 1]}`);
      }
    }
    return { focus: focus.label, ok: false, model: candidates[candidates.length - 1], reason: lastReason };
  };
  // 三类并行(每个小请求实测 ~65s,远低于超时线),墙钟≈最慢单个而非累加。
  const settled = await Promise.all(ANALYZER_FOCUSES.map((focus) => runFocus(focus)));
  const { data, succeeded, failed } = mergeTypedAnalyzerResults(settled);
  const charactersOk = settled.find((r) => r.focus.startsWith("人物"))?.ok;
  console.error(`[assetAnalyzer] 分批完成 成功=[${succeeded.join(",")}] 失败=[${failed.join(",")}] 人物=${data.characters.length} 场景=${data.scenes.length} 道具=${data.props.length}`);
  // 部分成功韧性:只要"人物"这批成功就视为可用(人物最关键,绝不能靠傻规则乱分类);
  // 场景/道具若失败暂缺,但不再全盘回退本地规则。三类全败才 ok:false。
  if (charactersOk || succeeded.length) {
    return { ok: true, model: primary, data, reason: failed.length ? `部分类别失败：${failed.join("；")}` : "" };
  }
  return { ok: false, model: primary, reason: `所有类别均失败：${failed.join("；")}` };
}

const ASSET_TYPES = new Set(["Character", "Scene", "Prop", "Insert"]);

async function auditAssetRoles({ assets = [], script = "", modelName }) {
  const apiKey = assetAnalyzerApiKey();
  if (!apiKey) {
    return { ok: false, model: "", checkedCount: 0, flippedCount: 0, flips: [], flagged: [], reason: "未配置资产审核模型 API Key", assets };
  }
  const primary = assetAuditModel(modelName);
  const fallback = "claude-haiku-4-5";
  const candidates = primary === fallback ? [primary] : [primary, fallback];
  const auditAssets = assets.map((asset) => ({ label: asset.label, type: asset.type, evidence: String(asset.evidence || "").slice(0, 200) }));
  const requestBody = (model, withJsonMode) => ({
    model,
    temperature: 0.1,
    ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: assetAuditSystemPrompt() },
      { role: "user", content: assetAuditUserPrompt({ script, assets: auditAssets }) },
    ],
  });
  const post = (model, withJsonMode) => fetchAssetAnalyzer(openAiCompatUrl("/v1/chat/completions"), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody(model, withJsonMode)),
  });
  const tryModel = async (model) => {
    let response = await post(model, true);
    let raw = await response.text();
    if (!response.ok && response.status === 400 && /response_format|json_object/i.test(raw)) {
      response = await post(model, false);
      raw = await response.text();
    }
    if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}: ${raw.slice(0, 300)}`);
    const parsed = JSON.parse(stripJsonFence(JSON.parse(raw).choices?.[0]?.message?.content || ""));
    if (!Array.isArray(parsed.reviews)) throw new Error("审核模型返回缺少 reviews");
    return { model, reviews: parsed.reviews };
  };

  let auditResult;
  let lastReason = "";
  for (const model of candidates) {
    try {
      auditResult = await tryModel(model);
      break;
    } catch (error) {
      lastReason = `${model}: ${error?.message || String(error)}`;
      if (model !== candidates[candidates.length - 1]) console.error(`[assetAudit] ${lastReason}，切换到 ${fallback}`);
    }
  }
  if (!auditResult) {
    return { ok: false, model: fallback, checkedCount: 0, flippedCount: 0, flips: [], flagged: [], reason: `资产角色交叉审核失败：${lastReason}`, assets };
  }

  const flagged = [];
  const reviewedLabels = new Set();
  for (const review of auditResult.reviews) {
    const label = compactLine(review?.label || "");
    const assetIndex = assets.findIndex((asset) => compactLine(asset.label) === label);
    if (!label || assetIndex < 0 || reviewedLabels.has(label)) continue;
    reviewedLabels.add(label);
    const asset = assets[assetIndex];
    const shouldBeType = compactLine(review?.shouldBeType || "");
    const confidence = Number(review?.confidence);
    if (asset.lockedManual || !ASSET_TYPES.has(shouldBeType) || shouldBeType === asset.type) continue;
    flagged.push({ label, currentType: asset.type, suspectType: shouldBeType, confidence, reason: compactLine(review.reason || "审核建议人工复核"), type: asset.type, note: "AI建议可能分错，待人工复核" });
  }
  const missing = assets.filter((asset) => !reviewedLabels.has(compactLine(asset.label))).map((asset) => asset.label);
  if (missing.length) return { ok: false, model: auditResult.model, checkedCount: reviewedLabels.size, flippedCount: 0, flips: [], flagged: [], reason: `审核模型未逐条返回资产：${missing.join("、")}`, assets };
  return { ok: true, model: auditResult.model, checkedCount: reviewedLabels.size, flippedCount: 0, flips: [], flagged, reason: flagged.length ? "存在审核建议项" : "", assets };
}

function analyzerItemsByType(data, type) {
  if (!data || typeof data !== "object") return [];
  if (type === "Character") return Array.isArray(data.characters) ? data.characters : [];
  if (type === "Scene") return Array.isArray(data.scenes) ? data.scenes : [];
  return Array.isArray(data.props) ? data.props.filter((item) => (item.type === type || (!item.type && type === "Prop"))) : [];
}

function analyzerAssetType(asset) {
  return normalizeAssetType(asset?.type || "Prop", "Prop");
}

function analyzerTypeSuffix(type) {
  return assetMeta(type).suffix;
}

function analyzerTypePrefix(type) {
  return assetMeta(type).prefix;
}

function sameAssetLabel(a, b) {
  return normalizeAssetMatchText(a) === normalizeAssetMatchText(b);
}

function assetExistsByLabel(assets, label, type) {
  return assets.some((asset) => asset.type === type && sameAssetLabel(asset.label, label));
}

function normalizeAssetMatchText(value) {
  return compactLine(value)
    .toLowerCase()
    .replace(/^(外景|内景|ext\.?|int\.?|interior|exterior)\s*[·.:-]?\s*/i, "")
    .replace(/character sheet|wide establishing|prop ref|insert ref|asset|scene|character|prop|insert/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assetMatchTokens(value) {
  const normalized = normalizeAssetMatchText(value);
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  const compact = normalized.replace(/\s+/g, "");
  if (compact && compact !== normalized) tokens.push(compact);
  return [...new Set(tokens)];
}

function assetMatchScore(asset, item) {
  const assetLabel = normalizeAssetMatchText(asset.label);
  const itemLabel = normalizeAssetMatchText(item?.label || "");
  if (!itemLabel) return 0;
  let score = 0;
  if (assetLabel && itemLabel && assetLabel === itemLabel) score += 12;
  if (assetLabel && itemLabel && (assetLabel.includes(itemLabel) || itemLabel.includes(assetLabel))) score += 7;
  const assetTokens = new Set(assetMatchTokens(`${asset.label} ${asset.name} ${asset.evidence}`));
  const itemTokens = assetMatchTokens(`${item?.label || ""} ${item?.evidence || ""}`);
  for (const token of itemTokens) {
    if (assetTokens.has(token)) score += token.length >= 4 ? 2 : 1;
  }
  const itemEvidence = normalizeAssetMatchText(item?.evidence || "");
  const assetEvidence = normalizeAssetMatchText(asset.evidence || "");
  if (itemEvidence && assetEvidence && (assetEvidence.includes(itemEvidence) || itemEvidence.includes(assetEvidence))) score += 3;
  return score;
}

function scriptEvidenceScoreForAsset(script, item = {}) {
  const source = normalizeAssetMatchText(script);
  if (!source) return 0;
  const label = compactLine(item.label || item.name || item.id || "");
  const evidence = compactLine(item.evidence || "");
  const visual = compactLine(item.visual || "");
  if (label && source.includes(normalizeAssetMatchText(label))) return 12;
  if (evidence && source.includes(normalizeAssetMatchText(evidence).slice(0, 80))) return 10;
  const tokens = assetMatchTokens(`${label} ${evidence} ${visual}`)
    .filter((token) => token.length >= 3)
    .filter((token) => !/^(asset|prop|insert|scene|character|reference|image|screenplay|evidence|detail|wide|shot|pure|white|front|side|back)$/i.test(token));
  let score = 0;
  for (const token of tokens) {
    if (source.includes(token)) score += token.length >= 5 ? 2 : 1;
  }
  return score;
}

function assetHasScriptEvidence(script, assetOrItem = {}) {
  const label = compactLine(assetOrItem.label || assetOrItem.name || assetOrItem.id || "");
  const evidence = compactLine(assetOrItem.evidence || "");
  if (/Ω|Omega/i.test(label) && !/Ω|Omega/i.test(script)) return false;
  if (/伊森|Ethan/i.test(label) && !/伊森|Ethan/i.test(script)) return false;
  if (/新港市|地铁|metro|subway/i.test(label) && !/新港市|地铁|metro|subway/i.test(script)) return false;
  if (evidence && normalizeAssetMatchText(script).includes(normalizeAssetMatchText(evidence).slice(0, 50))) return true;
  return scriptEvidenceScoreForAsset(script, assetOrItem) >= 3;
}

function isAnalyzerItemCompatible(asset, item) {
  const label = compactLine(item?.label || "");
  if (!label) return false;
  if (asset.type === "Character") return isValidCharacterLabel(label);
  if (asset.type === "Scene") return !isValidCharacterLabel(label) || isLikelyLocationOrTimeLabel(label);
  if (asset.type === "Insert") return analyzerAssetType(item) === "Insert";
  return analyzerAssetType(item) === "Prop";
}

function allAnalyzerItems(data) {
  return [
    ...analyzerItemsByType(data, "Character").map((item) => ({ item, type: "Character" })),
    ...analyzerItemsByType(data, "Scene").map((item) => ({ item, type: "Scene" })),
    ...analyzerItemsByType(data, "Prop").map((item) => ({ item, type: analyzerAssetType(item) })),
    ...analyzerItemsByType(data, "Insert").map((item) => ({ item, type: "Insert" })),
  ];
}

function findAnalyzerItemForAsset(asset, analyzerResult, usedItems, script = "") {
  const items = allAnalyzerItems(analyzerResult?.data).filter(
    (entry) => entry.type === asset.type && !usedItems.has(entry.item) && assetHasScriptEvidence(script, entry.item),
  );
  if (!items.length) return null;
  const bySource = items.find((entry) => compactLine(entry.item?.sourceId || "") === asset.name && isAnalyzerItemCompatible(asset, entry.item));
  if (bySource) {
    usedItems.add(bySource.item);
    return bySource.item;
  }
  const ranked = items
    .filter((entry) => isAnalyzerItemCompatible(asset, entry.item))
    .map((entry) => ({ ...entry, score: assetMatchScore(asset, entry.item) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best && best.score >= 7) {
    usedItems.add(best.item);
    return best.item;
  }
  return null;
}

// 模型为准:模型解析成功时,信任模型对"这是不是一个资产/属于哪类"的判定,只做最轻量的垃圾防护
// (挡空 label、纯 production 字段名如"画面/灯光/音效",不再用严格的 isValidCharacterLabel 否决单字名等)。
// 严格的本地校验(isValidCharacterLabel/assetHasScriptEvidence)只在模型失败、纯本地规则兜底时才把关。
function isModelAssetLabelUsable(label) {
  const name = compactLine(label);
  if (!name) return false;
  if (name.length > 40) return false; // 过长多半是把描述句当了 label
  if (isProductionFieldLabel(name)) return false; // 画面/灯光/对白/音效/镜头…纯字段名
  if (/^[\d\s.、，,。;；:：/／|]+$/.test(name)) return false; // 纯标点/数字
  return true;
}

function buildModelDiscoveredAssets(analyzerResult, existingAssets, worldProfile, script = "") {
  if (!analyzerResult?.ok) return [];
  const discovered = [];
  const existingIds = new Set(existingAssets.map((asset) => asset.name));
  for (const entry of allAnalyzerItems(analyzerResult.data)) {
    const item = entry.item;
    const assetType = entry.type;
    if (compactLine(item?.sourceId || "") && existingIds.has(compactLine(item.sourceId))) continue;
      const label = compactLine(item?.label || "");
      // 模型为准:仅轻量垃圾防护,不用 isValidCharacterLabel 否决(单字名昼/绯/阙、含"夜"的名字等都合法)。
      if (!isModelAssetLabelUsable(label)) continue;
      // 模型 ok 时不再用 assetHasScriptEvidence 硬否决:模型读了全文才产出该资产,其 visual/prompt 本身即证据。
      // 但用户已经在结构化分段中明确分类的资产不能被模型以另一种类型重复新增。
      if (existingAssets.some((asset) => asset.lockedStructured && sameAssetLabel(asset.label, label))) continue;
      if (!label || assetExistsByLabel(existingAssets, label, assetType) || assetExistsByLabel(discovered, label, assetType)) continue;
      const visual = compactLine(item?.visual || "");
      const evidence = compactLine(item?.evidence || "");
      const suffix = analyzerTypeSuffix(assetType);
      const typeIndex =
        existingAssets.filter((asset) => asset.type === assetType).length +
        discovered.filter((asset) => asset.type === assetType).length +
        1;
      const name = assetName(analyzerTypePrefix(assetType), typeIndex, label, suffix);
      const prompt = validateAnalyzerPrompt({ type: assetType }, item?.textToImagePrompt || "");
      discovered.push({
        type: assetType,
        analyzerType: assetType,
        name,
        label,
        evidence,
        visual,
        textToImagePromptOverride: prompt,
        worldProfile,
        analyzerSource: prompt || visual || evidence ? "model" : "rules",
        analyzerNote: prompt ? `资产解析模型：${analyzerResult.model}` : `模型新增资产，提示词使用本地规则补齐：${analyzerResult.model}`,
      });
  }
  return discovered;
}

// 跨类型匹配:先按 sourceId 精确命中(无视类型),再按 label 打分。命中后采纳"模型放进哪个类别"作为真实类型。
function findAnalyzerMatchAcrossTypes(asset, analyzerResult, usedItems, script = "") {
  const entries = allAnalyzerItems(analyzerResult?.data).filter(
    (entry) => !usedItems.has(entry.item) && assetHasScriptEvidence(script, entry.item),
  );
  if (!entries.length) return null;
  const characterByLabel = entries.find(
    (entry) =>
      entry.type === "Character" &&
      (sameAssetLabel(entry.item?.label, asset.label) || assetLabelConflict(entry.item?.label, asset.label)),
  );
  if (characterByLabel) {
    usedItems.add(characterByLabel.item);
    return { item: characterByLabel.item, type: "Character" };
  }
  const bySource = entries.find(
    (entry) => compactLine(entry.item?.sourceId || "") && compactLine(entry.item?.sourceId || "") === asset.name,
  );
  if (bySource) {
    usedItems.add(bySource.item);
    return { item: bySource.item, type: bySource.type };
  }
  const ranked = entries
    .map((entry) => ({ ...entry, score: assetMatchScore(asset, entry.item) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best && best.score >= 7) {
    usedItems.add(best.item);
    return { item: best.item, type: best.type };
  }
  return null;
}

function mergeAnalyzerAssets(fallbackAssets, analyzerResult, worldProfile, script = "") {
  console.error(`[assetAnalyzer] ok=${!!analyzerResult?.ok} model=${analyzerResult?.model || ""} candidates=${fallbackAssets.length}${analyzerResult?.ok ? "" : ` reason=${compactLine(analyzerResult?.reason || "")}`}`);
  if (!analyzerResult?.ok) {
    return fallbackAssets.map((asset) => ({
      ...asset,
      worldProfile,
      analyzerSource: asset.lockedManual ? "manual" : "rules",
      analyzerNote: asset.lockedManual
        ? "用户提供资产生图提示词"
        : asset.lockedStructured
          ? `用户明确分类，保留本地解析：${analyzerResult?.reason || "未调用模型"}`
          : analyzerResult?.reason || "本地规则解析",
    }));
  }
  const usedItems = new Set();
  // 第一遍:跨类型把每个候选匹配到模型输出。用户明确分段的资产可让模型补充视觉信息，
  // 但类型不得被模型或本地规则改写。
  const prelim = fallbackAssets.map((asset) => {
    if (asset.lockedManual) return { asset, locked: true, finalType: asset.type, changed: false };
    const match = findAnalyzerMatchAcrossTypes(asset, analyzerResult, usedItems, script);
    const lockedType = !!asset.lockedStructured;
    const finalType = lockedType ? asset.type : match ? match.type : asset.type;
    return { asset, match, lockedType, finalType, changed: finalType !== asset.type };
  });
  // 模型对"哪些才是资产"有裁量权，但用户明确列出的资产不能因模型漏项而被删除。
  const dropped = prelim.filter((p) => !p.locked && !p.lockedType && !p.match);
  if (dropped.length) {
    console.error(`[assetAnalyzer] ${analyzerResult.model} 丢弃 ${dropped.length} 个模型未确认的粗规则候选: ${dropped.map((p) => p.asset.label).join("、")}`);
  }
  const kept = prelim.filter((p) => p.locked || p.lockedType || p.match);
  // 计算各类型现有最大序号(取自未改类型/锁定资产的名字),给被改判的资产分配不冲突的新序号
  const maxIndexByType = {};
  const readIndex = (name) => {
    const m = String(name || "").match(/^(?:SB|[CSPI])(\d{3})_/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  for (const p of kept) {
    if (!p.changed) maxIndexByType[p.finalType] = Math.max(maxIndexByType[p.finalType] || 0, readIndex(p.asset.name));
  }
  const merged = kept.map((p) => {
    if (p.locked) {
      return { ...p.asset, worldProfile, analyzerSource: "manual", analyzerNote: "用户提供资产生图提示词，已锁定优先使用" };
    }
    const picked = p.match?.item || {};
    const visual = compactLine(picked.visual || p.asset.visual || "");
    const evidence = compactLine(picked.evidence || p.asset.evidence);
    const label = compactLine((p.lockedType ? p.asset.label : picked.label) || p.asset.label);
    const prompt = validateAnalyzerPrompt({ type: p.finalType }, picked.textToImagePrompt || "");
    let name = p.asset.name;
    if (p.changed) {
      const idx = (maxIndexByType[p.finalType] || 0) + 1;
      maxIndexByType[p.finalType] = idx;
      name = typedAssetName(p.finalType, idx, label);
    }
    return {
      ...p.asset,
      type: p.finalType,
      analyzerType: p.match?.type || p.asset.analyzerType || "",
      name,
      label,
      evidence,
      visual,
      textToImagePromptOverride: prompt,
      worldProfile,
      analyzerSource: prompt || visual ? "model" : "rules",
      analyzerNote: p.lockedType
        ? prompt
          ? `用户明确分类为 ${p.asset.type}，模型补充视觉信息：${analyzerResult.model}`
          : `用户明确分类为 ${p.asset.type}，保留本地视觉描述：${analyzerResult.model}`
        : p.changed
        ? `资产解析模型改判为 ${p.finalType}：${analyzerResult.model}`
        : prompt
          ? `资产解析模型：${analyzerResult.model}`
          : `模型输出不足，保留本地规则：${analyzerResult.model}`,
    };
  });
  return [...merged, ...buildModelDiscoveredAssets(analyzerResult, merged, worldProfile, script)];
}

function assetCoverageSystemPrompt() {
  return `你是短剧制作流程里的“资产覆盖校验模型”。你的任务不是重写资产表，而是检查已有资产是否覆盖剧本和分镜真正需要的人物、场景、道具。

必须遵守：
- 只输出 JSON，不输出 Markdown，不输出解释。
- 所有 JSON 字段内容使用中文，只有 textToImagePrompt 字段必须使用英文。
- 只能补缺口：existingAssets 已覆盖的人物、场景、道具不得重复输出。
- 严格根据 screenplay 和 storyboardShots 的证据判断，不得凭空添加剧本没有的人物、地点、怪物、武器或事件。
- 如果分镜中出现某个人物、地点、关键道具，但 existingAssets 没有对应资产，必须输出为 missing。
- 人物 label 只能是人物、群体角色或怪物实体名称；不得把地点、时间、组织、文件、镜头说明当成人物。
- 场景 label 只能是地点/环境/空间名称；不得把人物、对白、道具、文件标题当成场景。
- 道具 Prop 是需要在多个镜头保持外观的物件，必须 16:9 纯白背景三视图；Insert 是证据细节/微距特写。
- textToImagePrompt 必须是英文，可直接提交给 gpt-image-2；人物必须 16:9 纯白背景全身正侧背三视图加半身特写；场景必须 16:9 无人物大全景；Prop 必须 16:9 纯白背景三视图。

输出 JSON 结构：
{
  "coverageSummary": "一句话说明覆盖情况",
  "missingCharacters": [
    {
      "label": "缺失人物名",
      "evidence": "剧本或分镜依据",
      "visual": "中文视觉设计",
      "textToImagePrompt": "English prompt"
    }
  ],
  "missingScenes": [
    {
      "label": "缺失场景名",
      "evidence": "剧本或分镜依据",
      "visual": "中文场景设计",
      "textToImagePrompt": "English prompt"
    }
  ],
  "missingProps": [
    {
      "type": "Prop 或 Insert",
      "label": "缺失道具或插入镜头主体",
      "evidence": "剧本或分镜依据",
      "visual": "中文视觉设计",
      "textToImagePrompt": "English prompt"
    }
  ]
}`;
}

function assetCoverageUserPrompt({ script, assets, shots, worldProfile }) {
  const existingAssets = (assets || []).map((asset) => ({
    name: asset.name,
    type: asset.type,
    label: asset.label,
    evidence: asset.evidence || "",
    visual: asset.visual || "",
  }));
  const storyboardShots = (shots || []).map((shot, index) => ({
    index: index + 1,
    id: shot.id || shot.name || "",
    title: shot.title || "",
    beat: shot.beat || shot.purpose || "",
    refs: Array.isArray(shot.refs) ? shot.refs : [],
    dialogueLines: Array.isArray(shot.dialogues) ? shot.dialogues : Array.isArray(shot.dialogueLines) ? shot.dialogueLines : [],
  }));
  return JSON.stringify(
    {
      task: "检查 existingAssets 是否覆盖 screenplay 和 storyboardShots 需要的人物、场景、道具。只输出缺失项，不要重复已有资产。",
      process: [
        "先列出剧本和分镜真正出现的人物、场景、道具。",
        "再逐项和 existingAssets 按 type + label + evidence 对齐。",
        "只把缺失项放入 missingCharacters / missingScenes / missingProps。",
        "如果没有缺失，三个 missing 数组必须为空。",
      ],
      worldProfile,
      existingAssets,
      storyboardShots,
      screenplay: script.slice(0, 30000),
    },
    null,
    2,
  );
}

async function callAssetCoverageModel({ script, assets, shots, worldProfile, modelName }) {
  const model = normalizeAssetAnalyzerModel(modelName);
  if (model === "rules") return { ok: false, model, reason: "使用本地规则，未调用资产覆盖校验模型" };
  const apiKey = assetAnalyzerApiKey();
  if (!apiKey) return { ok: false, model, reason: "未配置资产解析模型 API Key，无法自动补漏" };
  const requestBody = (withJsonMode) => ({
    model,
    temperature: 0.15,
    ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: assetCoverageSystemPrompt() },
      { role: "user", content: assetCoverageUserPrompt({ script, assets, shots, worldProfile }) },
    ],
  });
  try {
    const post = (withJsonMode) =>
      fetchAssetAnalyzer(openAiCompatUrl("/v1/chat/completions"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody(withJsonMode)),
      });
    let response = await post(true);
    let raw = await response.text();
    if (!response.ok && response.status === 400 && /response_format|json_object/i.test(raw)) {
      response = await post(false);
      raw = await response.text();
    }
    if (!response.ok) return { ok: false, model, reason: `覆盖校验接口返回 HTTP ${response.status}: ${raw.slice(0, 600)}` };
    const data = JSON.parse(raw);
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(stripJsonFence(content));
    return { ok: true, model, data: parsed };
  } catch (error) {
    return { ok: false, model, reason: error.message };
  }
}

function coverageItems(data, key, fallbackKey = "") {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data[key])) return data[key];
  if (fallbackKey && Array.isArray(data[fallbackKey])) return data[fallbackKey];
  return [];
}

function isCoverageItemCompatible(type, item) {
  const label = compactLine(item?.label || "");
  if (!label) return false;
  if (type === "Character") return isValidCharacterLabel(label);
  if (type === "Scene") return !isValidCharacterLabel(label) || isLikelyLocationOrTimeLabel(label);
  if (type === "Insert") return true;
  return true;
}

function buildCoverageAssets(coverageResult, existingAssets, worldProfile, script = "") {
  if (!coverageResult?.ok) return [];
  const data = coverageResult.data || {};
  const discovered = [];
  const entries = [
    ...coverageItems(data, "missingCharacters", "characters").map((item) => ({ item, type: "Character" })),
    ...coverageItems(data, "missingScenes", "scenes").map((item) => ({ item, type: "Scene" })),
    ...coverageItems(data, "missingProps", "props").map((item) => ({ item, type: normalizeAssetType(item?.type || "Prop", "Prop") })),
  ];
  for (const { item, type } of entries) {
    if (!["Character", "Scene", "Prop", "Insert"].includes(type)) continue;
    const label = compactLine(item?.label || "");
    if (!isCoverageItemCompatible(type, item)) continue;
    if (!assetHasScriptEvidence(script, item)) continue;
    if (assetExistsByLabel(existingAssets, label, type) || assetExistsByLabel(discovered, label, type)) continue;
    const visual = compactLine(item?.visual || "");
    const evidence = compactLine(item?.evidence || "");
    const prompt = validateAnalyzerPrompt({ type }, item?.textToImagePrompt || "");
    const typeIndex =
      existingAssets.filter((asset) => asset.type === type).length +
      discovered.filter((asset) => asset.type === type).length +
      1;
    discovered.push({
      type,
      analyzerType: type,
      name: typedAssetName(type, typeIndex, label),
      label,
      evidence,
      visual,
      textToImagePromptOverride: prompt,
      worldProfile,
      analyzerSource: "model",
      analyzerNote: prompt ? `资产覆盖补漏模型：${coverageResult.model}` : `覆盖补漏模型发现缺失资产，提示词使用本地规则补齐：${coverageResult.model}`,
      coverageAdded: true,
    });
  }
  return discovered;
}

async function ensureAssetCoverage({ script, assets, shots = [], worldProfile, modelName }) {
  const coverageResult = await callAssetCoverageModel({ script, assets, shots, worldProfile, modelName });
  const additions = buildCoverageAssets(coverageResult, assets, worldProfile, script);
  return {
    assets: additions.length ? [...assets, ...additions] : assets,
    coverage: {
      checkedAt: new Date().toISOString(),
      model: coverageResult?.model || normalizeAssetAnalyzerModel(modelName),
      ok: !!coverageResult?.ok,
      reason: coverageResult?.ok ? "" : coverageResult?.reason || "",
      summary: compactLine(coverageResult?.data?.coverageSummary || ""),
      added: additions.map((asset) => ({
        id: asset.name,
        type: asset.type,
        label: asset.label,
        evidence: asset.evidence || "",
      })),
    },
  };
}

function refreshShotRefsWithAssets(shots, assets, beats = []) {
  const names = new Set(assets.map((asset) => asset.name));
  return (shots || []).map((shot, index) => {
    const beat = shot.beat || shot.purpose || shot.title || beats[index] || "";
    const suggested = refsForBeat(beat, assets, { beats, index });
    const refs = [];
    const push = (ref) => {
      if (names.has(ref) && !refs.includes(ref)) refs.push(ref);
    };
    suggested.forEach(push);
    (shot.refs || []).forEach(push);
    return {
      ...shot,
      refs: refs.slice(0, 8),
      assetLookup: assetLookupFromAssets(assets),
    };
  });
}

function assetCoverageIsFresh(manifest, script) {
  if (!manifest?.coverage?.checkedAt) return false;
  if (!manifest.coverage.ok) return false;
  const digest = crypto.createHash("sha1").update(script || "").digest("hex");
  return !manifest.sourceScriptDigest || manifest.sourceScriptDigest === digest;
}

function isDraftPlaceholderLine(value) {
  const line = compactLine(value);
  return (
    /^#\s*(?:video settings test|untitled(?: project)?|pixel toys)\s*$/i.test(line) ||
    /^(?:paste|粘贴).*(?:episode script|剧本).*here\.?$/i.test(line)
  );
}

function cleanScriptForDraft(script) {
  const productionFields =
    "画面|灯光|对白|音效|镜头|演技提示|视觉特效|动漫感特效|特效化妆|建筑场景|服饰细节|动作|声音|场景|时间|地点";
  const normalized = String(script || "")
    .replace(/\s*(?=\[场景\d+\])/g, "\n\n")
    .replace(new RegExp(`([^\\n])\\s*(?=•\\s*(?:${productionFields})(?:[（(][^）)]{1,32}[）)])?\\s*[:：])`, "g"), "$1\n")
    .replace(/([^\n])\s*(?=◦\s*[^：:]{1,24}[：:])/g, "$1\n");
  const lines = normalized.split(/\r?\n/);
  const cleaned = [];
  for (const line of lines) {
    if (isDraftPlaceholderLine(line)) continue;
    cleaned.push(line.replace(/[ \t]+$/g, ""));
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function scriptForVideoBeats(script) {
  const clean = cleanScriptForDraft(script);
  const lines = clean.split(/\r?\n/);
  const firstSceneIndex = lines.findIndex((line) => isSceneHeadingLine(line));
  if (firstSceneIndex <= 0) return clean;
  const before = lines.slice(0, firstSceneIndex).map(compactLine).filter(Boolean).join(" ");
  if (!before) return clean;
  const looksLikeCharacterSetup =
    /（[^）]*(?:主角|女主|男主|反派|公主|王妃|贵族|人鱼|角色)[^）]*）/.test(before) ||
    /(?:Character|角色|人物|设定|外貌|银白色|长发|眼眸|服装|身姿|神情|女主|男主|反派)/i.test(before);
  if (!looksLikeCharacterSetup) return clean;
  return lines.slice(firstSceneIndex).join("\n").replace(/\n{3,}/g, "\n\n").trim() || clean;
}

function stripManualAssetPromptBlocks(script) {
  const source = String(script || "");
  const headingRe = /(?:^|\n)\s*\d+[.、)]\s*[^\n]{2,90}\n+提示词\s*\d*\s*[：:]\s*[^\n]*\n+/g;
  const matches = [...source.matchAll(headingRe)];
  if (!matches.length) return source;
  let result = "";
  let cursor = 0;
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index;
    const bodyStart = match.index + match[0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const body = source.slice(bodyStart, nextStart);
    const separatorAt = body.search(/\n\s*(?:⸻|---|夜晚，|清晨，|外景|内景|EXT\.?|INT\.?)/i);
    const end = separatorAt >= 0 ? bodyStart + separatorAt : nextStart;
    result += source.slice(cursor, start);
    cursor = end;
  }
  result += source.slice(cursor);
  return result
    .replace(/^\s*(?:⸻|---)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanStoryScriptForDraft(script) {
  return cleanScriptForDraft(stripManualAssetPromptBlocks(script));
}

function isGenericDraftTitle(value) {
  return !compactLine(value) || /^(?:video settings test|untitled(?: project)?|pixel toys)$/i.test(compactLine(value));
}

function titleFromScript(script, fallback, provided = "") {
  if (!isGenericDraftTitle(provided)) return compactLine(provided).replace(/^#\s*/, "");
  for (const raw of String(script || "").split(/\r?\n/)) {
    const line = compactLine(raw);
    if (!line || isDraftPlaceholderLine(line)) continue;
    if (/^#\s+/.test(line)) return line.replace(/^#\s*/, "");
    if (/^第.+集/.test(line)) return line;
  }
  return fallback;
}

function splitSentences(text) {
  const source = compactLine(text);
  if (!source) return [];
  const matches = source.match(/[^。！？!?]+[。！？!?]?/g) || [source];
  return matches.map(compactLine).filter(Boolean);
}

function textGramSet(value = "") {
  const clean = matchableText(value).replace(/\s+/g, "");
  if (!clean) return new Set();
  const chars = [...clean];
  if (chars.length <= 2) return new Set([clean]);
  const grams = new Set();
  for (let index = 0; index < chars.length - 1; index += 1) grams.add(`${chars[index]}${chars[index + 1]}`);
  return grams;
}

function textContainmentPercent(a = "", b = "") {
  const aGrams = textGramSet(a);
  const bGrams = textGramSet(b);
  if (!aGrams.size || !bGrams.size) return 0;
  let overlap = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) overlap += 1;
  }
  return Math.round((overlap * 100) / Math.min(aGrams.size, bGrams.size));
}

function promptStoryCoreForMatch(prompt = "", sectionName = "") {
  const text = String(prompt || "");
  const core =
    text.match(/剧情动作[:：]\s*([\s\S]*?)(?=\n\n(?:图片参考|镜头语言|镜头切换|IMAX|光影|时间轴|动作\/表演|动作|对白|声音)[:：]|$)/)?.[1] ||
    text.match(/核心画面[:：][\s\S]*?只演绎本段剧情[:：]\s*([\s\S]*?)(?=\n\n(?:图片参考|镜头语言|镜头切换|IMAX|光影|时间轴|动作\/表演|动作|对白|声音)[:：]|$)/)?.[1] ||
    text.match(/(?:核心画面|剧情与镜头|剧情)[:：]\s*([\s\S]*?)(?=\n\n(?:图片参考|镜头语言|镜头切换|IMAX|光影|时间轴|动作\/表演|动作|对白|声音)[:：]|$)/)?.[1] ||
    "";
  return normalizeVideoStoryBody(core || sectionName);
}

function promptMatchesBeat(prompt = "", beat = "", sectionName = "") {
  const core = promptStoryCoreForMatch(prompt, sectionName);
  const target = compactLine(beat);
  if (!core || !target) return false;
  if (textContainmentPercent(core, target) >= 58) return true;
  return textContainmentPercent(sectionName, target) >= 72;
}

function splitBeatInHalf(beat) {
  const structured = splitStructuredBeat(beat);
  if (structured.length >= 2) return structured;
  const sentences = splitSentences(beat);
  if (sentences.length >= 2) {
    const midpoint = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, midpoint).join(" "), sentences.slice(midpoint).join(" ")].map(compactLine).filter(Boolean);
  }
  const text = compactLine(beat);
  if (text.length < 140) return [text];
  const midpoint = Math.floor(text.length / 2);
  const cut = Math.max(text.lastIndexOf("，", midpoint), text.lastIndexOf(",", midpoint), text.lastIndexOf(" ", midpoint));
  const at = cut > 40 ? cut + 1 : midpoint;
  return [text.slice(0, at), text.slice(at)].map(compactLine).filter(Boolean);
}

function splitScriptBeatIntoNaturalUnits(beat, dialogueLanguage = "en") {
  const text = compactLine(beat);
  if (!text) return [];
  const units = [];
  let cursor = 0;
  const dialogueRe = /•\s*对白\s*[：:]\s*◦\s*([^：:]{1,32})[：:]\s*/g;
  const matches = [...text.matchAll(dialogueRe)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index || 0;
    const prefix = compactLine(text.slice(cursor, start));
    if (prefix) units.push(...splitSentences(prefix));
    const bodyStart = start + match[0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    const rawBody = compactLine(text.slice(bodyStart, nextStart));
    const sentences = splitSentences(rawBody);
    const dialogueParts = [];
    const actionParts = [];
    for (const sentence of sentences) {
      if (isActionLineAfterDialogue(sentence, match[1])) actionParts.push(sentence);
      else dialogueParts.push(sentence);
    }
    const spoken = normalizeDialogueForLanguage(dialogueParts.join(" "), dialogueLanguage);
    if (spoken) units.push(`• 对白：◦ ${cleanSpeakerCue(match[1])}：${spoken}`);
    if (actionParts.length) units.push(...actionParts);
    cursor = nextStart;
  }
  const tail = compactLine(text.slice(cursor));
  if (tail) units.push(...splitSentences(tail));
  return units.map(compactLine).filter((item) => item.length > 8);
}

function isDialogueBeat(value = "") {
  return /(?:^|[。！？.!?]\s*)[•◦\-\s]*对白\s*[：:]/i.test(String(value || ""));
}

function mergeAdjacentActionUnits(units = [], options = {}) {
  const maxActionUnits = Math.max(2, Number(options.maxActionUnits || 4));
  const maxActionLength = Math.max(120, Number(options.maxActionLength || 320));
  const output = [];
  const pending = [];
  const flushPending = () => {
    let current = [];
    let currentLength = 0;
    const flushCurrent = () => {
      if (!current.length) return;
      output.push(compactLine(current.join(" ")));
      current = [];
      currentLength = 0;
    };
    for (const unit of pending.splice(0)) {
      const nextLength = currentLength + unit.length;
      if (current.length && (current.length >= maxActionUnits || nextLength > maxActionLength)) flushCurrent();
      current.push(unit);
      currentLength += unit.length;
    }
    flushCurrent();
  };
  for (const rawUnit of units.map(compactLine).filter(Boolean)) {
    if (isDialogueBeat(rawUnit)) {
      flushPending();
      output.push(rawUnit);
    } else {
      pending.push(rawUnit);
    }
  }
  flushPending();
  return output.filter(Boolean);
}

function fitBeatsToCountWithoutDuplicateTranslation(beats, targetCount, options = {}) {
  const clean = beats.map(compactLine).filter((beat) => beat.length > 8);
  const language = normalizeDialogueLanguage(options.dialogueLanguage, "en");
  const naturalUnits = mergeAdjacentActionUnits(clean.flatMap((beat) => splitScriptBeatIntoNaturalUnits(beat, language)), options);
  const source = naturalUnits.length >= Math.min(targetCount, 4) ? naturalUnits : clean;
  const maxShotCount = Math.max(1, Math.min(20, Number(options.maxShotCount || 10)));
  const requested = Math.max(1, Number(targetCount) || source.length || 1);
  const effectiveTarget = Math.max(requested, Math.min(source.length || requested, maxShotCount));
  if (source.length <= effectiveTarget) return source;
  return fitBeatsToCount(source, effectiveTarget);
}

function productionFieldSegments(text) {
  const pieces = compactLine(text)
    .split(/(?=•\s*[^：:]{1,28}(?:[（(][^）)]{1,32}[）)])?\s*[：:])/)
    .map(compactLine)
    .filter(Boolean);
  const prefix = [];
  const fields = [];
  for (const piece of pieces) {
    const field = productionFieldLine(piece);
    if (field) {
      fields.push(field);
    } else {
      prefix.push(piece);
    }
  }
  return { prefix: compactLine(prefix.join(" ")), fields };
}

function fieldText(name, body) {
  return `• ${name}：${body}`;
}

function splitStructuredBeat(beat) {
  const { prefix, fields } = productionFieldSegments(beat);
  if (!fields.some((field) => field.name === "画面")) return [];
  const visual = fields.find((field) => field.name === "画面");
  const visualParts = splitSentences(visual.body);
  if (visualParts.length < 2 && visual.body.length < 150) return [];
  const parts = visualParts.length >= 2 ? visualParts : splitBeatInHalf(visual.body);
  if (parts.length < 2) return [];
  const firstFields = [fieldText("画面", parts[0])];
  const secondFields = [fieldText("画面", parts.slice(1).join(" "))];
  const support = fields.filter((field) => field !== visual);
  for (const field of support) {
    const text = fieldText(field.name, field.body);
    if (["灯光", "建筑场景", "服饰细节"].includes(field.name)) {
      firstFields.push(text);
      secondFields.push(text);
    } else {
      secondFields.push(text);
    }
  }
  return [compactLine(`${prefix} ${firstFields.join(" ")}`), compactLine(`${prefix} ${secondFields.join(" ")}`)].filter((part) => part.length > 8);
}

function expandLongBeat(beat, maxLength = 520) {
  const text = compactLine(beat);
  if (text.length <= maxLength) return [text];
  const sentences = splitSentences(text);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function beatSceneContinuityKey(beat) {
  const text = compactLine(beat);
  const entries = [
    ["metro", /地铁|车厢|列车|隧道|metro|subway|train|carriage|tunnel/i],
    ["farm", /农场|牧场|围栏|Peterson|牲畜|farm|pasture|ranch|cattle/i],
    ["patrol-car", /巡逻车|手套箱|方向盘|patrol car|glove compartment|steering wheel/i],
    ["school", /学校|school/i],
    ["bureau", /秩序局|总部|全息|bureau|headquarters|holographic/i],
    ["rift", /裂缝|虚空|portal|rift|void/i],
    ["rain-street", /城市街头|小巷|暴雨|霓虹|street|alley|rain|neon/i],
    ["cafe", /咖啡店|吧台|风铃|咖啡|café|cafe|coffee|wind chime/i],
  ];
  return entries.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function hasHardCutCue(value) {
  return regexAny(compactLine(value), [
    /与此同时|另一边|另一处|另一地点|另一个空间|镜头切到|切到|转场|硬切|切换到|画面转向|镜头转向|新场景|建立镜头|远景建立|片刻后|数分钟后|几分钟后|第二天|翌日|随后来到|时间跳跃/i,
    /\b(meanwhile|elsewhere|cut to|hard cut|new scene|establishing shot|moments later|minutes later|time jump)\b/i,
  ]);
}

function hasContinuationCue(value) {
  return regexAny(compactLine(value), [
    /继续|接着|仍然|仍|再度|紧接|承接|延续|余波|上一|同一动作|同一姿态|同一股|同一束|同一杯|同一件|顺势|随即|转身|抬手|后退|追|冲向|扑向|逼近|倒下后|光芒延续|能量延续|烟尘未散|呼吸未稳|动作连贯|情绪衔接|运动方向/i,
    /\b(continues?|still|again|keeps?|follows?|chases?|rushes?|same action|same motion|immediately|right after|aftermath|moment continues)\b/i,
  ]);
}

function activeContinuityStages(beat) {
  const stages = classifyBeatStages(beat);
  return new Set(
    [...stages].filter((stage) =>
      [
        "disturbance",
        "mutation",
        "monsterThreat",
        "protagonistDanger",
        "powerAwakening",
        "transformedHero",
        "energyWeapon",
        "supernaturalPower",
        "aftermath",
      ].includes(stage),
    ),
  );
}

function beatsCanShareSingleClip(previousBeat, currentBeat, options = {}) {
  const previous = compactLine(previousBeat);
  const current = compactLine(currentBeat);
  if (!previous || !current) return false;
  const maxCombinedLength = Number(options.maxCombinedLength || 920);
  if (`${previous} ${current}`.length > maxCombinedLength) return false;
  if (hasHardCutCue(current)) return false;
  const previousScene = beatSceneContinuityKey(previous);
  const currentScene = beatSceneContinuityKey(current);
  const sameScene = !!previousScene && !!currentScene && previousScene === currentScene;
  if (!sameScene) return false;
  if (hasContinuationCue(current)) return true;
  const previousActive = activeContinuityStages(previous);
  const currentActive = activeContinuityStages(current);
  const overlap = [...currentActive].some((stage) => previousActive.has(stage));
  return overlap && !classifyBeatStages(current).has("establishing");
}

function consolidateContinuousBeats(beats, options = {}) {
  const clean = beats.map(compactLine).filter((beat) => beat.length > 8);
  if (clean.length <= 1) return clean;
  const merged = [];
  let current = clean[0];
  for (let index = 1; index < clean.length; index += 1) {
    const next = clean[index];
    if (beatsCanShareSingleClip(current, next, options)) {
      current = compactLine(`${current} ${next}`);
    } else {
      merged.push(current);
      current = next;
    }
  }
  if (current) merged.push(current);
  return merged;
}

function mergeBeatsToCount(beats, targetCount) {
  const clean = beats.map(compactLine).filter((beat) => beat.length > 8);
  if (clean.length <= targetCount) return clean;
  const target = Math.max(1, Math.min(targetCount, clean.length));
  let remainingLength = clean.reduce((sum, beat) => sum + beat.length, 0);
  const groups = [];
  let index = 0;
  while (index < clean.length && groups.length < target) {
    const remainingGroups = target - groups.length;
    const remainingItems = clean.length - index;
    if (remainingGroups === 1) {
      groups.push(clean.slice(index).join(" "));
      break;
    }
    if (remainingItems === remainingGroups) {
      groups.push(clean[index]);
      remainingLength -= clean[index].length;
      index += 1;
      continue;
    }
    const targetLength = Math.max(1, remainingLength / remainingGroups);
    const chunk = [];
    let chunkLength = 0;
    while (index < clean.length) {
      const itemsAfterThis = clean.length - index - 1;
      const groupsAfterThis = remainingGroups - 1;
      chunk.push(clean[index]);
      chunkLength += clean[index].length;
      remainingLength -= clean[index].length;
      index += 1;
      if (chunkLength >= targetLength && itemsAfterThis >= groupsAfterThis) break;
      if (itemsAfterThis <= groupsAfterThis) break;
    }
    groups.push(chunk.join(" "));
  }
  return groups.map(compactLine).filter(Boolean);
}

function legacyMergeBeatsToCount(beats, targetCount) {
  if (beats.length <= targetCount) return beats;
  const totalLength = beats.reduce((sum, beat) => sum + beat.length, 0);
  const targetLength = Math.max(1, totalLength / targetCount);
  const groups = [];
  let current = "";
  for (let index = 0; index < beats.length; index += 1) {
    const remainingBeats = beats.length - index;
    const remainingGroups = targetCount - groups.length;
    if (!current) {
      current = beats[index];
      continue;
    }
    if (current.length >= targetLength && remainingBeats >= remainingGroups) {
      groups.push(current);
      current = beats[index];
    } else {
      current = `${current} ${beats[index]}`;
    }
  }
  if (current) groups.push(current);
  while (groups.length > targetCount) {
    let mergeAt = 0;
    let best = Infinity;
    for (let index = 0; index < groups.length - 1; index += 1) {
      const length = groups[index].length + groups[index + 1].length;
      if (length < best) {
        best = length;
        mergeAt = index;
      }
    }
    groups.splice(mergeAt, 2, `${groups[mergeAt]} ${groups[mergeAt + 1]}`);
  }
  return groups.map(compactLine);
}

function fitBeatsToCount(beats, targetCount) {
  const fitted = beats.map(compactLine).filter((beat) => beat.length > 8);
  while (fitted.length < targetCount) {
    const candidates = fitted
      .map((beat, index) => ({ beat, index, length: beat.length }))
      .sort((a, b) => b.length - a.length);
    let didSplit = false;
    for (const candidate of candidates) {
      const parts = splitBeatInHalf(candidate.beat).filter((part) => part.length > 8);
      if (parts.length < 2) continue;
      fitted.splice(candidate.index, 1, ...parts);
      didSplit = true;
      break;
    }
    if (!didSplit) break;
  }
  if (fitted.length > targetCount) return mergeBeatsToCount(fitted, targetCount);
  return fitted;
}

function preferredShotCount(script, beats) {
  const clean = cleanScriptForDraft(script);
  const contentWeight = Math.max(1, Math.ceil(clean.length / 760));
  const beatCount = Array.isArray(beats) ? beats.length : 0;
  const dialogueCount = parseSpeakerDialogues(clean).length;
  const natural =
    beatCount <= 6
      ? Math.max(5, beatCount, contentWeight + 3, Math.ceil(dialogueCount / 2) + 4)
      : Math.max(5, Math.round((beatCount + contentWeight + Math.ceil(dialogueCount / 2)) / 2));
  const minimum = Math.ceil(VIDEO_MIN_EPISODE_SECONDS / VIDEO_MAX_SECONDS);
  return Math.max(minimum, Math.min(8, natural || minimum));
}

function clampShotDuration(value, fallback = 8) {
  const n = Number(value);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(VIDEO_MIN_SECONDS, Math.min(VIDEO_MAX_SECONDS, Math.round(base)));
}

function targetDurationForBeats(count, beats = [], requestedTarget = 0) {
  const minPossible = count * VIDEO_MIN_SECONDS;
  const maxPossible = count * VIDEO_MAX_SECONDS;
  const clampTarget = (value) => Math.max(minPossible, Math.min(maxPossible, Math.round(value)));
  const requested = Number(requestedTarget);
  if (Number.isFinite(requested) && requested > 0) {
    return clampTarget(Math.max(VIDEO_MIN_EPISODE_SECONDS, Math.min(VIDEO_MAX_EPISODE_SECONDS, requested)));
  }
  return clampTarget(episodeTargetDurationForBeats(beats));
}

function episodeTargetDurationForBeats(beats = []) {
  const clean = beats.map(compactLine).filter(Boolean);
  if (!clean.length) return VIDEO_DEFAULT_EPISODE_SECONDS;
  const text = clean.join(" ");
  const dialogueCount = (text.match(/[“”"：:]/g) || []).length;
  const sentenceCount = splitSentences(text).length;
  const stageScore = clean.reduce((sum, beat, index) => {
    const stages = classifyBeatStagesWithContext(beat, { beats: clean, index });
    let score = 0;
    if (setHasAny(stages, ["disturbance", "mutation", "monsterThreat", "protagonistDanger"])) score += 1.4;
    if (setHasAny(stages, ["powerAwakening", "transformedHero", "energyWeapon", "supernaturalPower"])) score += 1.5;
    if (setHasAny(stages, ["phoneCall", "documentEvidence", "photoEvidence", "classifiedFile"])) score += 0.65;
    if (stages.has("aftermath")) score += 0.45;
    if (hasContinuationCue(beat)) score += 0.35;
    return sum + score;
  }, 0);
  const complexity =
    Math.min(8, text.length / 420) +
    Math.min(4, clean.length * 0.45) +
    Math.min(4, sentenceCount * 0.18) +
    Math.min(4, dialogueCount * 0.18) +
    Math.min(7, stageScore);
  if (complexity >= 17) return 90;
  if (complexity >= 13) return 85;
  if (complexity >= 9) return 80;
  if (complexity >= 5) return 75;
  return VIDEO_MIN_EPISODE_SECONDS;
}

function beatDurationWeight(beat, index = 0, beats = [], rawDuration = 0) {
  const text = compactLine(beat);
  const stages = classifyBeatStagesWithContext(text, { beats, index });
  let weight = 1;
  weight += Math.min(0.55, text.length / 720);
  weight += Math.min(0.24, (splitSentences(text).length - 1) * 0.04);
  weight += Math.min(0.22, ((text.match(/[“”"：:]/g) || []).length) * 0.035);
  if (hasContinuationCue(text)) weight += 0.22;
  if (setHasAny(stages, ["monsterThreat", "protagonistDanger", "powerAwakening", "transformedHero", "energyWeapon"])) weight += 0.24;
  if (stages.has("aftermath")) weight += 0.1;
  if (stages.has("establishing") && !setHasAny(stages, ["disturbance", "monsterThreat", "transformedHero", "energyWeapon"])) weight -= 0.12;
  if (hasHardCutCue(text)) weight -= 0.12;
  const rhythmBias = [0.92, 1.08, 0.98, 1.16, 0.9, 1.12, 0.96, 1.06, 0.88, 1.1][index % 10];
  weight *= rhythmBias;
  const raw = Number(rawDuration);
  if (Number.isFinite(raw) && raw > 0) {
    weight *= Math.max(0.72, Math.min(1.32, raw / 10));
  }
  return Math.max(0.55, Math.min(2.1, weight));
}

function distributeDurationsByWeights(weights, target) {
  const count = Math.max(1, weights.length);
  const cleanWeights = weights.map((weight) => (Number.isFinite(Number(weight)) && Number(weight) > 0 ? Number(weight) : 1));
  const sum = cleanWeights.reduce((total, weight) => total + weight, 0) || count;
  const floats = cleanWeights.map((weight) => (target * weight) / sum);
  const durations = floats.map((value) => clampShotDuration(value));
  let delta = target - durations.reduce((total, duration) => total + duration, 0);
  let guard = 0;
  while (delta !== 0 && guard < 200) {
    const candidates = cleanWeights
      .map((weight, index) => ({ index, weight, duration: durations[index], remainder: floats[index] - Math.floor(floats[index]) }))
      .sort((a, b) => {
        if (delta > 0) return b.weight - a.weight || b.remainder - a.remainder;
        return a.weight - b.weight || a.remainder - b.remainder;
      });
    let changed = false;
    for (const item of candidates) {
      if (delta > 0 && durations[item.index] < VIDEO_MAX_SECONDS) {
        durations[item.index] += 1;
        delta -= 1;
        changed = true;
      } else if (delta < 0 && durations[item.index] > VIDEO_MIN_SECONDS) {
        durations[item.index] -= 1;
        delta += 1;
        changed = true;
      }
      if (delta === 0) break;
    }
    if (!changed) break;
    guard += 1;
  }
  if (new Set(durations).size === 1 && durations.length > 1) {
    const high = cleanWeights.indexOf(Math.max(...cleanWeights));
    const low = cleanWeights.indexOf(Math.min(...cleanWeights));
    if (high !== low && durations[high] < VIDEO_MAX_SECONDS && durations[low] > VIDEO_MIN_SECONDS) {
      durations[high] += 1;
      durations[low] -= 1;
    }
  }
  return durations;
}

function preferLongShotDurations(durations = [], weights = [], target = 0) {
  const next = durations.map((duration) => clampShotDuration(duration));
  let delta = Math.round(Number(target || 0)) - next.reduce((sum, duration) => sum + duration, 0);
  const weightedOrder = weights
    .map((weight, index) => ({ index, weight: Number(weight) || 1 }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  while (delta > 0) {
    let changed = false;
    for (const item of weightedOrder) {
      if (next[item.index] >= VIDEO_MAX_SECONDS) continue;
      next[item.index] += 1;
      delta -= 1;
      changed = true;
      if (delta <= 0) break;
    }
    if (!changed) break;
  }
  return next;
}

function planEpisodeDuration({ shotCount, beats = [], targetDuration = 0, rawDurations = [] } = {}) {
  const minimumCount = Math.ceil(VIDEO_MIN_EPISODE_SECONDS / VIDEO_MAX_SECONDS);
  const count = Math.max(minimumCount, Math.min(8, Number(shotCount) || beats.length || minimumCount));
  const normalizedBeats = Array.from({ length: count }, (_, index) => compactLine(beats[index] || ""));
  const target = targetDurationForBeats(count, normalizedBeats, targetDuration);
  const weights = normalizedBeats.map((beat, index) => beatDurationWeight(beat, index, normalizedBeats, rawDurations[index]));
  const durations = preferLongShotDurations(distributeDurationsByWeights(weights, target), weights, target);
  return { target, shotCount: count, durations, weights };
}

function scriptBeatCandidates(script) {
  const lines = cleanScriptForDraft(script).split(/\r?\n/);
  const structured = lines.some((line) => isSceneHeadingLine(line) || productionFieldLine(line));
  if (structured) return structuredScriptBeatCandidates(lines);
  const beats = [];
  let current = "";
  let pendingScene = "";
  const flush = () => {
    if (!compactLine(current)) return;
    beats.push(...expandLongBeat(current));
    current = "";
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = compactLine(lines[index]);
    if (!line) {
      flush();
      continue;
    }
    if (isDraftPlaceholderLine(line) || /^#\s+/.test(line) || /^第.+集/.test(line) || /^【.*】$/.test(line)) continue;
    if (isSceneHeadingLine(line)) {
      flush();
      pendingScene = line;
      continue;
    }
    if (isSpeakerCueLine(lines, index)) {
      flush();
      const speaker = cleanSpeakerCue(line);
      const dialogueLines = [];
      for (let j = index + 1; j < lines.length; j += 1) {
        const next = compactLine(lines[j]);
        if (!next) break;
        if (isSceneHeadingLine(next) || isSpeakerCueLine(lines, j) || isNonCharacterHeading(next)) break;
        if (!isParentheticalLine(next)) dialogueLines.push(next);
        index = j;
      }
      const cue = `${speaker}: ${dialogueLines.join(" ") || "沉默反应"}`;
      beats.push(compactLine(pendingScene ? `${pendingScene} / ${cue}` : cue));
      pendingScene = "";
      continue;
    }
    const prefixed = pendingScene ? `${pendingScene} / ${line}` : line;
    pendingScene = "";
    current = current ? `${current} ${prefixed}` : prefixed;
  }
  flush();
  return beats.filter((beat) => beat.length > 8).slice(0, 20);
}

function structuredScriptBeatCandidates(lines) {
  const beats = [];
  let current = "";
  const flush = () => {
    const beat = compactLine(current);
    if (beat.length > 8) beats.push(beat);
    current = "";
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = compactLine(lines[index]);
    if (!line) continue;
    if (isDraftPlaceholderLine(line) || /^#\s+/.test(line) || /^第.+集/.test(line) || /^【.*】$/.test(line)) continue;
    if (isSceneHeadingLine(line)) {
      flush();
      current = line;
      continue;
    }
    if (isSpeakerCueLine(lines, index)) {
      const speaker = cleanSpeakerCue(line);
      const dialogueLines = [];
      for (let j = index + 1; j < lines.length; j += 1) {
        const next = compactLine(lines[j]);
        if (!next) break;
        if (isSceneHeadingLine(next) || isSpeakerCueLine(lines, j) || isNonCharacterHeading(next)) break;
        if (!isParentheticalLine(next)) dialogueLines.push(next);
        index = j;
      }
      current = compactLine(`${current} • 对白：◦ ${speaker}：${dialogueLines.join(" ") || "沉默反应"}`);
      continue;
    }
    const field = productionFieldLine(line);
    if (field && field.name !== "画面" && !current) continue;
    current = compactLine(current ? `${current} ${line}` : line);
  }
  flush();
  return beats.slice(0, 20);
}

function beatTitle(beat, index) {
  const readable = readableBeatText(beat);
  const location = readable.match(/^(外景|内景|EXT\.?|INT\.?)\s*[·.:-]?\s*([^，。,.]{2,32})/i)?.[2];
  if (location) return `${location} / 剧情节拍 ${index + 1}`;
  const first = splitSentences(readable)[0] || compactLine(readable);
  return first.replace(/[“”"]/g, "").slice(0, 28) || `剧情节拍 ${index + 1}`;
}

function timeCuts(duration) {
  const total = Math.min(15, Math.max(4, Number(duration) || 10));
  if (total <= 6) return [0, 2, 4, total];
  if (total <= 8) return [0, 2, 5, total];
  if (total <= 10) return [0, 3, 7, total];
  return [0, 4, 9, total];
}

function cameraPlanForShot(shot, index) {
  const design = shot?.cinematicDesign || cinematicShotDesignForShot(shot, index);
  if (design) {
    return {
      camera: design.cameraLanguage,
      lens: design.lensPlan,
      shots: design.timeAxis,
    };
  }
  const plans = [
    {
      camera: "IMAX 65mm 摄影机语言 + ARRI Alexa 65 数字电影质感，24fps，真实物理光照，低反差惊悚色彩分级",
      lens: "24mm 广角建立镜头切到 50mm 中近景，再切 85mm 情绪特写",
      shots: [
        "镜头A：远景建立空间，低机位缓慢推镜头， foreground/midground/background 层次清晰，环境压迫感先到。",
        "镜头B：中景跟拍人物进入或停顿，轻微手持呼吸感，人物表情克制，不夸张。",
        "镜头C：极近特写落到剧本已写明的动作、表情或环境反应，浅景深，焦点只服务当前剧情信息。",
      ],
    },
    {
      camera: "IMAX certified large-format look，ARRI Alexa 65，70mm 胶片颗粒，24fps，冷静写实",
      lens: "35mm 纪实全景，65mm 过肩中景，100mm macro 插入特写",
      shots: [
        "镜头A：大全景展示现场全貌，缓慢横移 pan-left 或 pan-right，只使用一个方向的稳定运动。",
        "镜头B：过肩中景压近角色视线，轻微 dolly-in，保持人物身份和服装一致。",
        "镜头C：插入镜头只拍剧本已写明的手部动作、表情反应或环境边缘细节，不新增物件或信息。",
      ],
    },
    {
      camera: "IMAX 70mm 纵深构图，ARRI Alexa 65 高动态范围，24fps，自然环境声驱动节奏",
      lens: "28mm 空间纵深，50mm 对话中景，75mm 面部特写",
      shots: [
        "镜头A：从环境空镜开始，缓慢上摇或下摇揭示主体，不要快速转场。",
        "镜头B：中近景捕捉人物对话或沉默反应，镜头轻微前推，压缩心理距离。",
        "镜头C：面部或手部特写收束，焦点精准，表情微动作成为信息点。",
      ],
    },
    {
      camera: "IMAX 大画幅摄影机质感，ARRI Alexa 65，70mm realism，24fps，真实现场纪录感",
      lens: "32mm 建立，50mm 机械臂式跟随，90mm 情绪特写",
      shots: [
        "镜头A：稳定建立镜头，主体处于画面下三分之一，留出上方压迫空间。",
        "镜头B：机械臂感轻微环绕但不超过 35 度，围绕人物或物件制造不安。",
        "镜头C：慢推到剧本已写明的人物反应或动作结果，最后半秒保持静止，留给剪辑点。",
      ],
    },
  ];
  return plans[index % plans.length];
}

function cinematicShotDesignForShot(shot = {}, index = 0, options = {}) {
  const previousShot = options.previousShot || null;
  const assetLookup = options.assetLookup || null;
  const beat = compactLine(shot.beat || shot.prompt || shot.title || shot.purpose || "");
  const stages = classifyBeatStagesWithContext(beat, { beats: options.beats || [], index });
  const sameScene = previousShot ? shotsShareSceneContinuity(shot, previousShot, assetLookup) : false;
  const isSceneReset = !previousShot || (!sameScene && (hasHardCutCue(beat) || index === 0));
  const hasDialogue = Array.isArray(shot.dialogues) ? shot.dialogues.length > 0 : /对白|“|”|"/.test(beat);
  const hasEvidenceDetail = setHasAny(stages, ["phoneCall", "documentEvidence", "photoEvidence", "farmDeadstock", "classifiedFile"]);
  const hasThreatOrAction = setHasAny(stages, ["disturbance", "mutation", "monsterThreat", "protagonistDanger", "powerAwakening", "transformedHero", "energyWeapon", "supernaturalPower"]);
  const isContinuation = sameScene || hasContinuationCue(beat);
  let purpose = "reaction";
  if (isSceneReset) purpose = "establish";
  else if (hasEvidenceDetail) purpose = "insert";
  else if (hasThreatOrAction || isContinuation) purpose = "action_continuation";
  else if (hasDialogue) purpose = "dialogue_reaction";
  else purpose = index % 2 ? "over_shoulder" : "close_reaction";

  const duration = clampShotDuration(shot.duration || 8);
  const cuts = timeCuts(duration);
  const continuationPrefix = previousShot
    ? `开场直接承接上一镜「${previousShot.name || previousShot.id || previousShot.title || "上一镜"}」的站位、视线、道具状态和运动方向`
    : "开场建立本场戏的空间轴线、人物位置和主要光源";
  const beatCore = normalizeVideoStoryBody(videoSafeBeatText(beat)).slice(0, 220);
  const library = {
    establish: {
      shotPurpose: "establish",
      shotSize: "短建立镜头进入中近景",
      cameraMove: "低速推镜后硬切中近景",
      composition: "竖屏大画幅三层纵深构图，主体不居中，前景保留遮挡物，明确空间轴线",
      lighting: "用剧本场景中的真实主光源建立方向、色温和阴影边界，背景保持低照度层次",
      performance: "人物只做一个克制的入场、停顿或抬眼动作，给后续镜头留下剪辑点",
      cameraLanguage: "短建立镜头只负责交代空间轴线和人物位置，随后切入中近景推进剧情",
      lensPlan: "28mm 竖屏空间纵深建立，50mm 中近景压近人物，85mm 特写收束表演",
      opening: "本镜作为场景首次进入，建立空间后迅速进入人物行动，不把整段都拍成环境展示",
      timeAxis: [
        `${cuts[0]}-${cuts[1]}秒：短建立镜头，交代空间轴线、人物位置和主光方向，镜头运动缓慢克制。`,
        `${cuts[1]}-${cuts[2]}秒：切入中近景，人物开始执行当前剧情动作，焦点从环境转到表演。`,
        `${cuts[2]}-${cuts[3]}秒：特写落到眼神、手部或关键道具，最后半秒稳定成干净剪辑点。`,
      ],
    },
    action_continuation: {
      shotPurpose: "action_continuation",
      shotSize: "中近景到特写",
      cameraMove: "顺上一镜运动方向轻微跟拍或推近",
      composition: "沿用上一镜轴线，人物和关键道具保持同侧位置，前景遮挡加强压迫",
      lighting: "延续上一镜主光方向和色温，用边缘轮廓光分离人物，阴影覆盖背景",
      performance: "动作从上一镜未完成处继续，呼吸未稳、肩颈紧绷、手指收紧、眼神短促偏移",
      cameraLanguage: "同场景连续动作镜头，中近景直接承接上一镜，不重新展示环境",
      lensPlan: "50mm 中近景承接动作，75mm 情绪特写，100mm 插入手部或道具细节",
      opening: `${continuationPrefix}，本镜第一秒直接进入人物动作或反应，不做环境重介绍`,
      timeAxis: [
        `${cuts[0]}-${cuts[1]}秒：直接承接上一镜动作，人物保持原有站位和运动方向，中近景轻微跟拍。`,
        `${cuts[1]}-${cuts[2]}秒：切到反应或过肩视角，捕捉眼神停顿、呼吸变化和身体重心转移。`,
        `${cuts[2]}-${cuts[3]}秒：插入手部、道具或面部特写，动作在剪辑点前完成一个清晰状态变化。`,
      ],
    },
    dialogue_reaction: {
      shotPurpose: "dialogue_reaction",
      shotSize: "过肩中近景与反应特写",
      cameraMove: "静态压迫构图配合极慢推近",
      composition: "过肩或门框式构图，听者占画面三分之一，留出负空间制造心理压力",
      lighting: "侧逆光或窗光切出面部边缘，眼部有微弱 catchlight，背景光比降低",
      performance: "台词后保留半秒沉默，嘴角压住、喉结轻动、眼神避开再回到对方",
      cameraLanguage: "对白反应镜头，以过肩中近景和面部特写推动潜台词",
      lensPlan: "65mm 过肩中近景，85mm 面部特写，浅景深控制视线",
      opening: `${continuationPrefix}，从说话者或听者的反应开始，不重新交代场景`,
      timeAxis: [
        `${cuts[0]}-${cuts[1]}秒：过肩中近景进入对白或沉默反应，保持上一镜视线方向。`,
        `${cuts[1]}-${cuts[2]}秒：极慢推近听者面部，捕捉眼神闪避、吞咽、呼吸变浅。`,
        `${cuts[2]}-${cuts[3]}秒：切到说话者或关键手部细节，台词落点后留出短暂停顿。`,
      ],
    },
    insert: {
      shotPurpose: "insert",
      shotSize: "插入特写",
      cameraMove: "微距静止或极慢横移",
      composition: "关键物件占画面中心偏下，人物手部或阴影只作为上下文，不扩大成新场景",
      lighting: "小范围硬光或屏幕光强调材质纹理，背景压暗，反光边缘清晰",
      performance: "手指停顿、轻触、收紧或放下，物件状态变化成为剧情信息",
      cameraLanguage: "插入镜头只服务证据、道具或手部动作，不展开环境",
      lensPlan: "90mm 至 100mm macro 插入特写，浅景深，焦点从边缘滑到关键信息",
      opening: `${continuationPrefix}，第一秒直接落到关键物件或手部动作`,
      timeAxis: [
        `${cuts[0]}-${cuts[1]}秒：微距特写直接拍关键物件、屏幕、文件、手部或证据细节。`,
        `${cuts[1]}-${cuts[2]}秒：焦点轻微转移，揭示剧本信息或人物触碰造成的状态变化。`,
        `${cuts[2]}-${cuts[3]}秒：保持物件和手部的紧张停顿，用声音或呼吸连接下一镜。`,
      ],
    },
    over_shoulder: {
      shotPurpose: "over_shoulder",
      shotSize: "过肩中景",
      cameraMove: "轻微横移或手持呼吸感",
      composition: "前景肩膀/门框遮挡，主体位于另一侧三分线，保持视线方向和空间轴线",
      lighting: "沿用场景主光，前景压暗，主体脸部有一侧弱补光",
      performance: "人物不大幅走位，用停顿、转头、抬手和微小后退表达心理变化",
      cameraLanguage: "过肩视角承接人物关系和空间压力",
      lensPlan: "50mm 过肩中景，70mm 反应近景，焦点在前景与主体之间谨慎切换",
      opening: `${continuationPrefix}，从人物关系和视线方向直接切入`,
      timeAxis: [
        `${cuts[0]}-${cuts[1]}秒：过肩中景承接上一镜视线，前景遮挡压住画面。`,
        `${cuts[1]}-${cuts[2]}秒：轻微横移或推近，主体通过停顿、转头或手部动作回应。`,
        `${cuts[2]}-${cuts[3]}秒：切到反应近景或道具细节，保留下一镜可接的方向。`,
      ],
    },
    close_reaction: {
      shotPurpose: "close_reaction",
      shotSize: "情绪特写",
      cameraMove: "极慢推近或完全静止",
      composition: "脸部偏离中心，眼睛落在上三分线，背景留出压迫性负空间",
      lighting: "低照度侧光塑造眼眶和颧骨阴影，眼神有微弱高光",
      performance: "眼神短促移动、嘴唇微张、呼吸变浅、肩膀冻结，情绪通过微表情完成",
      cameraLanguage: "反应特写承接剧情压力，用微表情而不是环境展示推进信息",
      lensPlan: "85mm 情绪特写，浅景深，焦点稳定在眼睛和手部之间",
      opening: `${continuationPrefix}，第一秒直接进入人物微表情`,
      timeAxis: [
        `${cuts[0]}-${cuts[1]}秒：情绪特写直接拍眼神和呼吸变化，背景只作为模糊压力。`,
        `${cuts[1]}-${cuts[2]}秒：极慢推近，嘴唇、喉结、手指或肩膀出现细小变化。`,
        `${cuts[2]}-${cuts[3]}秒：保持反应余韵，焦点轻微转到关键动作或视线目标。`,
      ],
    },
  };
  const base = library[purpose] || library.close_reaction;
  return {
    ...base,
    continuityFrom: previousShot?.name || previousShot?.id || "",
    sharedScene: !!sameScene,
    beatFocus: beatCore,
  };
}

function applyCinematicDesignToShots(shots = [], assetLookup = null) {
  return shots.map((shot, index) => {
    const previousShot = index > 0 ? shots[index - 1] : null;
    const cinematicDesign = cinematicShotDesignForShot(shot, index, { previousShot, assetLookup, beats: shots.map((item) => item.beat || item.title || "") });
    return {
      ...shot,
      cinematicDesign,
      shotPurpose: cinematicDesign.shotPurpose,
      shotSize: cinematicDesign.shotSize,
      cameraMove: cinematicDesign.cameraMove,
      composition: cinematicDesign.composition,
      lighting: cinematicDesign.lighting,
      performance: cinematicDesign.performance,
      continuityFrom: cinematicDesign.continuityFrom,
    };
  });
}

function splitBilingualDialogue(value) {
  const text = compactLine(value).replace(/^["“]|["”]$/g, "");
  const bilingual = text.match(/^(.*?)[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[）)]$/);
  if (bilingual && /[A-Za-z]/.test(bilingual[1])) {
    return { en: compactLine(bilingual[1]), zh: compactLine(bilingual[2]) };
  }
  const firstChinese = text.search(/[\u4e00-\u9fff]/);
  if (firstChinese > 12 && /[A-Za-z]/.test(text.slice(0, firstChinese))) {
    return {
      en: compactLine(text.slice(0, firstChinese).replace(/[。！？!?，,；;：:]+$/, "")),
      zh: compactLine(text.slice(firstChinese)),
    };
  }
  return {
    en: /[A-Za-z]/.test(text) ? text : "",
    zh: /[\u4e00-\u9fff]/.test(text) ? text : "",
  };
}

function normalizeDialogueForLanguage(value, dialogueLanguage = "en") {
  const language = normalizeDialogueLanguage(dialogueLanguage, "en");
  const raw = compactLine(value || "");
  if (!raw) return "";
  const bilingual = splitBilingualDialogue(raw);
  if (language === "zh") {
    return bilingual.zh || (!/[A-Za-z]/.test(raw) && /[\u4e00-\u9fff]/.test(raw) ? raw : "");
  }
  return bilingual.en || "";
}

function inferSpeakerForQuote(text, start, end) {
  const before = text.slice(Math.max(0, start - 100), start);
  const after = text.slice(end, Math.min(text.length, end + 120));
  const context = `${before} ${after}`;
  if (/伊森|Ethan/i.test(context)) return "伊森";
  if (/女乘客|woman|female passenger/i.test(context)) return "女乘客";
  if (/上班族|office worker|公文包/i.test(context)) return "上班族乘客";
  if (/Mercer|MERCER|Cole/i.test(context)) return "Mercer";
  if (/Voss|VOSS/i.test(context)) return "Dr. Voss";
  if (/Hale|HALE/i.test(context)) return "Deputy Hale";
  return "角色";
}

function quotedDialoguesForText(text, dialogueLanguage) {
  const source = String(text || "");
  const lines = [];
  const quotePattern = /[“"]([^”"\n]{2,180})[”"]/g;
  for (const match of source.matchAll(quotePattern)) {
    const raw = compactLine(match[1]);
    if (!raw || /^(?:核心画面|素材使用|镜头语言|镜头切换|时间轴|动作|声音|负面约束)$/i.test(raw)) continue;
    const bilingual = splitBilingualDialogue(raw);
    const spoken = dialogueLanguage === "zh" ? bilingual.zh || raw : bilingual.en || raw;
    if (!spoken) continue;
    const speaker = inferSpeakerForQuote(source, match.index || 0, (match.index || 0) + match[0].length);
    if (!lines.some((item) => item.speaker === speaker && item.text === spoken)) lines.push({ speaker, text: spoken });
  }
  return lines.slice(0, 4);
}

function dialoguesForText(text, dialogueLanguage) {
  const source = String(text || "");
  const lines = [];
  for (const block of parseSpeakerDialogues(stripExplicitInlineDialogues(source))) {
    const bilingual = splitBilingualDialogue(block.text);
    const spoken = dialogueLanguage === "zh" ? bilingual.zh || block.text : bilingual.en || block.text;
    if (spoken) lines.push({ speaker: block.speaker, text: spoken });
  }
  for (const block of explicitInlineDialogues(source)) {
    const bilingual = splitBilingualDialogue(block.text);
    const spoken = dialogueLanguage === "zh" ? bilingual.zh || block.text : bilingual.en || block.text;
    if (spoken && !lines.some((item) => item.speaker === block.speaker && item.text === spoken)) {
      lines.push({ speaker: block.speaker, text: spoken });
    }
  }
  for (const block of inlineColonDialogues(source, dialogueLanguage)) {
    if (!lines.some((item) => item.speaker === block.speaker && item.text === block.text)) lines.push(block);
  }
  for (const block of quotedDialoguesForText(source, dialogueLanguage)) {
    if (!lines.some((item) => item.speaker === block.speaker && item.text === block.text)) lines.push(block);
  }
  return lines.slice(0, 3);
}

function dialogueBlockForShot(shot) {
  if (!shot.dialogues?.length) return "对白：无对白；保留呼吸、停顿、远处人声和环境反应。";
  return `对白：\n${shot.dialogues.map((item) => `- ${item.speaker}：“${item.text}”`).join("\n")}`;
}

function isSeedanceNaturalLanguageShotPrompt(prompt = "") {
  const text = String(prompt || "").trim();
  if (!/(?:^|\n)镜号\s+\d+（\d+\s*秒）/.test(text)) return false;
  return ["景别：", "摄像机 / 镜头：", "运镜：", "机位视角：", "画面：", "人声 OS：", "人物台词：", "音效："].every((field) => text.includes(field));
}

function cleanVideoPromptForSubmission(prompt) {
  let text = String(prompt || "").trim();
  if (isSeedanceNaturalLanguageShotPrompt(text)) return text;
  const blockHeadings = [
    "参考映射",
    "素材身份约束",
    "资产锁定层",
    "面板资产绑定",
    "故事版控制层",
    "视频执行规则",
    "画面约束",
    "负面约束",
    "提示词规则",
    "素材规则",
    "故事版规则",
    "当前片段约束",
    "表达策略",
    "原创策略",
  ];
  const nextHeading = "(?:图片参考|画面参考|剧情动作|核心画面|剧情与镜头|剧情|镜头语言|镜头切换|IMAX|大画幅|光影|时间轴|动作\\/表演|动作|对白|摄影与声音|声音|音效)";
  for (const heading of blockHeadings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?:^|\\n)${escaped}(?:\\/[^:：\\n]+)?[:：][\\s\\S]*?(?=\\n\\n${nextHeading}[:：]|\\n##\\s+|$)`, "g"), "\n");
  }
  return text
    .replace(/素材使用[:：]/g, "图片参考：")
    .replace(/参考映射[:：]/g, "图片参考：")
    .replace(/核心画面[:：]\s*[\s\S]*?只演绎本段剧情[:：]\s*([\s\S]*?)(?=\n\n(?:图片参考|镜头语言|镜头切换|IMAX|光影|时间轴|动作\/表演|动作|对白|声音|音效)[:：]|$)/g, (_, body) => `剧情动作：${normalizeVideoStoryBody(body)}`)
    .replace(/(?:核心画面|剧情与镜头|剧情)[:：]\s*([\s\S]*?)(?=\n\n(?:图片参考|镜头语言|镜头切换|IMAX|光影|时间轴|动作\/表演|动作|对白|声音|音效)[:：]|$)/g, (_, body) => `剧情动作：${normalizeVideoStoryBody(body)}`)
    .replace(/不作为[^，。；\n]+[，。；]?/g, "")
    .replace(/不扩展成[^，。；\n]+[，。；]?/g, "")
    .replace(/(?:不得|不要|禁止)(?:添加|渲染|把|出现|交换|卡通|廉价|过度|伤口|喷溅|多余|错误|写成|引入|再根据|呈现|复制|改变|使用|继承|要求|混用|输出|显示|生成)[^，。；\n]+[，。；]?/g, "")
    .replace(/必须(?:来自|使用|包含|保留|输出|严格|明确|保持|控制|一一|原样|是|在)[^，。；\n]+[，。；]?/g, "")
    .replace(/只用于/g, "用于")
    .replace(/只控制/g, "参考")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function storyboardGuidancePromptText(guidance, storyboardImageIndex = null) {
  if (!guidance || typeof guidance !== "object") return "";
  const imageLabel = storyboardImageIndex ? `@图片${storyboardImageIndex}` : guidance.referenceAssetName || "Production Board";
  const panels = Array.isArray(guidance.panels) ? guidance.panels : [];
  const assetLock = storyboardAssetLockText(guidance.assetBinding, imageLabel);
  const panelBindings = storyboardPanelBindingsText(guidance.panelAssetBindings);
  const panelText = panels
    .slice(0, STORYBOARD_MAX_PANELS)
    .map((panel) => {
      const label = panel.label || `P${panel.panel || "?"}`;
      const production = panel.production || storyboardProductionTabForPanel(panel.role, {
        title: panel.title,
        description: panel.description,
        dialogue: panel.dialogue,
        action: panel.actionArrow,
        camera: panel.cameraFrame,
        continuity: [panel.continuityEntry, panel.continuityExit].filter(Boolean).join(" "),
      });
      const bits = [
        `${label}${panel.timeRange ? ` ${panel.timeRange}` : ""}`,
        `Visual：${production.visual}`,
        `Camera：${production.camera}`,
        `Shot：${production.shot}`,
        `Lens：${production.lens}`,
        `Lighting：${production.lighting}`,
        `Emotion：${production.emotion}`,
        `Dialogue：${production.dialogue}`,
        `Action：${production.action}`,
        `Continuity：${production.continuity}`,
      ]
        .map(compactLine)
        .filter(Boolean);
      return `- ${bits.join("；")}`;
    })
    .join("\n");
  return `Production Board 镜头参考：
${imageLabel} 是 Production Board / storyboard_reference，也是本段唯一提交图片参考。读取本段实际编号面板中的 9:16 构图、人物/道具站位、运动方向、镜头景别、动作节奏和剪辑出口。
这张板已经由绑定的 Character/Scene/Prop/Insert 资产生成，板面中的人物身份、场景结构、道具外观、材质、颜色、光线和风格均为最终视觉依据。不要期待、引用或补充其他资产图。
${assetLock ? `${assetLock}\n` : ""}${panelBindings ? `${panelBindings}\n` : ""}
按本板固定的 9 个编号面板顺序执行镜头：首格建立空间，末格保留干净剪辑出口，中间七格推进站位、动作、转折和反应。
${panelText || "- 使用故事版图中的编号面板控制构图、站位、动作节奏与切镜。"}
Production Board 模式下，相邻片段的空间连贯由同一 Sequence 的竖版面板、板面中已锁定的场景与道具状态和剪辑出口共同控制。`;
}

function assetLookupFromAssets(assets = []) {
  return new Map((assets || []).map((asset) => [asset.name || asset.assetName, asset]).filter(([name]) => !!name));
}

function assetTypeForLookupRecord(asset, fallbackName = "") {
  const assetName = asset?.name || asset?.assetName || fallbackName;
  const canonicalType = inferAssetTypeFromName(assetName);
  // 资产编号和后缀由工作流生成，是正式身份；历史 video config 中遗留的 type
  // 不能把 C001_*_CHARACTER_SHEET 这类人物资产重新解释成道具。
  if (canonicalType) return canonicalType;
  return normalizeAssetType(asset?.manifestType || asset?.type || "", "Prop");
}

function splitRefsByAssetType(refs, lookup = null) {
  const groups = { scenes: [], characters: [], props: [], inserts: [], storyboards: [], other: [] };
  for (const ref of Array.isArray(refs) ? refs : []) {
    const clean = compactLine(ref);
    if (!clean) continue;
    const asset = lookup?.get?.(clean);
    const type = assetTypeForLookupRecord(asset, clean);
    if (type === "Scene") groups.scenes.push(clean);
    else if (type === "Character") groups.characters.push(clean);
    else if (type === "Prop") groups.props.push(clean);
    else if (type === "Insert") groups.inserts.push(clean);
    else if (type === "Storyboard") groups.storyboards.push(clean);
    else groups.other.push(clean);
  }
  return groups;
}

function storyboardAssetBindingForShot(shot, assetLookup, storyboardImageIndex = null) {
  const refs = Array.isArray(shot?.refs) ? shot.refs : [];
  const groups = splitRefsByAssetType(refs, assetLookup);
  const imageForRef = new Map(refs.map((ref, index) => [ref, storyboardImageIndex ? `{{Image ${index + 1}}}` : `@图片${index + 1}`]));
  const describe = (ref) => {
    const asset = assetLookup?.get?.(ref) || {};
    const type = assetTypeForLookupRecord(asset, ref);
    return {
      ref,
      image: imageForRef.get(ref) || ref,
      type,
      label: asset.label || ref,
      matchCode: asset.matchCode || assetMatchCode(type, ref),
      use: refUsageForName(ref, assetLookup),
    };
  };
  return {
    scenes: groups.scenes.map(describe),
    characters: groups.characters.map(describe),
    props: groups.props.map(describe),
    inserts: groups.inserts.map(describe),
    other: groups.other.map(describe),
  };
}

function primaryRefsForPanel(panel, shotRefs, assetLookup) {
  const anchors = [...new Set([...(Array.isArray(panel?.assetAnchors) ? panel.assetAnchors : []), ...(Array.isArray(panel?.refs) ? panel.refs : [])].map(compactLine).filter(Boolean))];
  const allowed = new Set(shotRefs);
  const anchored = anchors.filter((ref) => allowed.has(ref));
  const anchoredGroups = splitRefsByAssetType(anchored, assetLookup);
  const shotGroups = splitRefsByAssetType(shotRefs, assetLookup);
  const scene = anchoredGroups.scenes[0] || shotGroups.scenes[0] || "";
  const characters = [...new Set([...(anchoredGroups.characters || []), ...(shotGroups.characters || [])])].slice(0, 4);
  const props = [...new Set([...(anchoredGroups.props || []), ...(anchoredGroups.inserts || []), ...(shotGroups.props || []), ...(shotGroups.inserts || [])])].slice(0, 3);
  return { scene, characters, props, anchored };
}

function storyboardSlotLabelForCharacter(index) {
  const labels = ["主角A", "角色B", "角色C", "角色D"];
  return labels[index] || `角色${index + 1}`;
}

function buildStoryboardPanelAssetBindings({ shot, panels, assetLookup }) {
  const shotRefs = Array.isArray(shot?.refs) ? shot.refs : [];
  return (Array.isArray(panels) ? panels : [])
    .slice(0, STORYBOARD_MAX_PANELS)
    .map((panel, index) => {
      const label = panel.label || `P${panel.panel || index + 1}`;
      const refs = primaryRefsForPanel(panel, shotRefs, assetLookup);
      const characters = refs.characters.map((ref, roleIndex) => {
        const asset = assetLookup.get(ref) || {};
        const type = assetTypeForLookupRecord(asset, ref);
        return {
          roleSlot: storyboardSlotLabelForCharacter(roleIndex),
          ref,
          label: asset.label || ref,
          matchCode: asset.matchCode || assetMatchCode(type, ref),
          storyPosition: roleIndex === 0 ? "优先对应故事版中的主行动人物、最大/最靠前剪影或主视线来源" : "对应故事版中次要人物剪影，按左右/前后站位和视线关系匹配",
        };
      });
      const sceneAsset = refs.scene ? assetLookup.get(refs.scene) || {} : null;
      const props = refs.props.map((ref) => {
        const asset = assetLookup.get(ref) || {};
        const type = assetTypeForLookupRecord(asset, ref);
        return { ref, label: asset.label || ref, matchCode: asset.matchCode || assetMatchCode(type, ref) };
      });
      return {
        panel: panel.panel || index + 1,
        label,
        timeRange: panel.timeRange || "",
        scene: refs.scene
          ? {
              ref: refs.scene,
              label: sceneAsset?.label || refs.scene,
              matchCode: sceneAsset?.matchCode || assetMatchCode("Scene", refs.scene),
            }
          : null,
        characters,
        props,
        storyboardRule:
          "故事版只决定这些资产在本面板中的画面位置、朝向、动作、构图和剪辑点；人物脸、服装、体型、场景材质、道具外观必须从绑定资产继承。",
      };
    });
}

function storyboardAssetBindingWarnings(shot, bindings) {
  const warnings = [];
  if (!bindings?.scenes?.length) warnings.push(`${shot.name}: 故事版已启用，但本片段没有绑定 Scene 场景资产`);
  const beat = compactLine(shot.beat || shot.promptSection || shot.name);
  if (!bindings?.characters?.length && /(他|她|他们|人物|角色|主角|男人|女人|女孩|男孩|Ethan|Mercer|Hale|Voss|speaks?|looks?|walks?)/i.test(beat)) {
    warnings.push(`${shot.name}: 剧情疑似有人物表演，但本片段没有绑定 Character 人物资产`);
  }
  return warnings;
}

function storyboardAssetLockText(binding, imageLabel) {
  if (!binding || typeof binding !== "object") return "";
  const lines = [];
  const push = (title, items, rule) => {
    if (!Array.isArray(items) || !items.length) return;
    lines.push(`${title}：`);
    items.forEach((item) =>
      lines.push(`- ${item.matchCode || assetMatchCode(item.type, item.ref)} = ${item.ref}${item.label && item.label !== item.ref ? `（${item.label}）` : ""}，${rule}`),
    );
  };
  push("面板已锁定/人物", binding.characters, `已渲染在 ${imageLabel} 对应面板中；保留其可见的脸、肤色、体型、服装和身份，不期待额外人物图片`);
  push("面板已锁定/场景", binding.scenes, `已渲染在 ${imageLabel} 对应面板中；保留其可见的地点、建筑结构、材质和光影，不期待额外场景图片`);
  push("面板已锁定/道具", [...(binding.props || []), ...(binding.inserts || [])], `已渲染在 ${imageLabel} 对应面板中；保留其可见的外观、摆放位置、手部互动和剪辑点，不期待额外道具图片`);
  if (!lines.length) return "";
  lines.push("资产绑定：正式 Character/Scene/Prop/Insert 资产只用于生成这张板；视频提交阶段不附带这些资产图片。");
  lines.push(`视觉优先级：忠实保留 ${imageLabel} 中已经渲染的资产身份和视觉细节，不要用文字或未提交图片重新解释。`);
  return lines.join("\n");
}

function storyboardPanelBindingsText(bindings = []) {
  if (!Array.isArray(bindings) || !bindings.length) return "";
  const lines = ["面板资产绑定："];
  for (const binding of bindings.slice(0, STORYBOARD_MAX_PANELS)) {
    const scene = binding.scene?.ref ? `场景=${binding.scene.matchCode || assetMatchCode("Scene", binding.scene.ref)}->${binding.scene.ref}` : "场景=沿用本片段正式场景资产";
    const characters = binding.characters?.length
      ? `人物=${binding.characters.map((item) => `${item.roleSlot}/${item.matchCode || assetMatchCode("Character", item.ref)}->${item.ref}`).join("，")}`
      : "人物=无人物或仅作为环境空镜";
    const props = binding.props?.length ? `道具=${binding.props.map((item) => `${item.matchCode || assetMatchCode("Prop", item.ref)}->${item.ref}`).join("，")}` : "道具=无关键道具";
    lines.push(`- ${binding.label}${binding.timeRange ? ` ${binding.timeRange}` : ""}：${scene}；${characters}；${props}；这些资产已经烘焙进故事板的本面板，视频只读取板面中的位置、动作、构图、节奏、剪辑出口和可见视觉身份。`);
  }
  lines.push("角色匹配：主角A/角色B/角色C 表示板内位置；对应人物的最终脸、服装和体型以故事板中已渲染的画面为准。");
  return lines.join("\n");
}

function refUsageForName(ref, lookup = null) {
  const asset = lookup?.get?.(ref);
  const type = assetTypeForLookupRecord(asset, ref);
  if (type === "Scene") return "作为场景、空间结构、光线方向和环境氛围参考";
  if (type === "Character") return "作为人物外观、服装、体型、神态和表演参考";
  if (type === "Prop") return "作为道具外观、材质和关键互动参考";
  if (type === "Insert") return "作为证据细节、插入镜头或能量纹理参考";
  return "作为当前镜头的指定参考素材";
}

function isLikelyStoryReferenceName(value = "") {
  const text = compactLine(value);
  if (!text) return true;
  if (text.length > 36) return true;
  if (/[。！？；：，、,.!?;:]/.test(text)) return true;
  return /(SHOT\s*\d+|镜头|剧情|证据|对应|贯穿|画面|特写|喃喃|缓步|走来|消失|the screenplay|screenplay evidence|existingAssets)/i.test(text);
}

function cleanSeedanceReferenceDisplayName(value = "", fallback = "参考资产") {
  const clean = compactLine(value)
    .replace(/^[A-Z]{1,2}\d{3}_/i, "")
    .replace(/_(?:CHARACTER_SHEET|WIDE_ESTABLISHING|PROP_REF|INSERT_REF|PRODUCTION_BOARD)$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || isLikelyStoryReferenceName(clean)) return fallback;
  return clean.slice(0, 36);
}

function seedanceReferenceDisplayName(ref, lookup = null) {
  const asset = lookup?.get?.(ref) || {};
  const explicit = [
    asset.label,
    asset.assetLabel,
    asset.displayName,
    asset.characterName || asset.sceneName || asset.propName,
    asset.insertName,
  ].find((value) => {
    const clean = compactLine(value || "");
    return clean && !isLikelyStoryReferenceName(clean);
  });
  if (explicit) return cleanSeedanceReferenceDisplayName(explicit);
  return cleanSeedanceReferenceDisplayName(ref, compactLine(ref || "参考资产").slice(0, 36) || "参考资产");
}

function seedanceReferenceLine(ref, index, lookup = null) {
  const displayName = seedanceReferenceDisplayName(ref, lookup);
  const usage = refUsageForName(ref, lookup);
  return `@图片${index + 1} 是「${displayName}」，${usage}。`;
}

function videoSafeBeatText(value) {
  return compactLine(value)
    .replace(/爪牙肆意撕扯皮肉/g, "畸变体冲向乘客，伤害发生在画面边缘和遮挡后方，通过惊恐反应、车厢震动和急促声响呈现")
    .replace(/撕扯皮肉/g, "离屏攻击和痛苦反应")
    .replace(/骨骼撕裂/g, "沉闷撞击与失衡声")
    .replace(/血液迅速浸透/g, "深色受伤痕迹印在")
    .replace(/温热的血液/g, "深色受伤痕迹")
    .replace(/浓烈的血腥味/g, "刺鼻的铁锈气味")
    .replace(/血腥味/g, "铁锈气味")
    .replace(/遍地畸变怪物/g, "倒伏和失去行动力的畸变体轮廓")
    .replace(/人间炼狱/g, "极端混乱的灾难现场");
}

function matchableText(value) {
  return compactLine(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
}

function textMentionsAsset(text, asset) {
  const haystack = matchableText(text);
  const terms = [asset.label, asset.name]
    .flatMap((value) => evidenceTerms(value || ""))
    .map(matchableText)
    .filter((term) => term.length >= 2)
    .filter((term) => !/^(?:c|s|p|i)?\d{1,3}$|character sheet|wide establishing|prop ref|insert ref|asset|scene|character|prop|insert$/i.test(term));
  return terms.some((term) => term && haystack.includes(term));
}

function regexAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function setHasAny(set, names) {
  return names.some((name) => set.has(name));
}

function classifyBeatStages(beat) {
  const raw = compactLine(beat);
  const lower = raw.toLowerCase();
  const stages = new Set();
  const add = (name, patterns) => {
    if (regexAny(raw, patterns) || regexAny(lower, patterns)) stages.add(name);
  };

  add("establishing", [/晚高峰|通勤|闭目休整|车厢灯火|清晨|黄昏|外景|内景|EXT\.?|INT\.?|站在|围栏前|establishing|rush hour|morning|dusk|dawn/i]);
  add("disturbance", [/频闪|暗紫色|震颤|轰鸣|电流爆破|应急灯|警报|不稳定|instability|flicker|emergency light|rumble|alarm/i]);
  add("powerOutage", [/power failure|power outage|blackout|停电|断电|电力故障/i]);
  add("dialogueAlarm", [/what.?s happening|they.?re changing|get away|people are scared|尖叫|失声|惊呼|慌乱|骚动|退缩|颤抖|低吼|scared|panic|scream/i]);
  add("mutation", [/异化|变异|灰化龟裂|皮肤快速灰化|青筋|骨骼错位|指甲疯长|双眼翻白|丧失人类神智|mutat|changing/i]);
  add("monsterThreat", [/畸变怪物|异化怪物|畸变体|怪物|扑杀|扑向|围拢|攻击性|利爪|monster|creature|attack/i]);
  add("protagonistDanger", [/逃窜|毫无退路|退路|后背|格挡|伤口|死亡的压迫|步步逼近|逼近|剧痛|体力飞速流逝|trapped|wound|get away|cornered/i]);
  add("aftermath", [/狼藉|倒地|丧失行动力|遍地|余波|崩塌|浩劫|灾变后|铁锈味|disaster|aftermath|ruin/i]);
  add("phoneCall", [/电话|手机|未知号码|来电|phone|unknown number|calls?/i]);
  add("documentEvidence", [/检修单据|设备检修|文件|档案|报告|samples?|reports?|paperwork|document/i]);
  add("photoEvidence", [/照片|泛黄|2005|photograph|photo|archival/i]);
  add("vehicleInterior", [/巡逻车|手套箱|方向盘|发动引擎|patrol car|glove compartment|steering wheel/i]);
  add("classifiedFile", [/PROJECT\s*GRAYLIGHT|GRAYLIGHT|机密文件夹|level 4 clearance|classified|folder/i]);
  add("schoolDirection", [/学校方向|school/i]);
  add("farmDeadstock", [/Peterson|农场|牧场|围栏|牲畜|牛|cattle|cow|deadstock|carcass|灰色尸体|中空|石灰色/i]);
  add("bureauHq", [/秩序局总部|银白色空间|全息数据|2147|执行官|bureau|headquarters|holographic/i]);
  add("riftVoid", [/时空裂缝|虚空|裂缝|光粒子|跃入裂缝|撕裂.*重组|白光吞没|rift|void|time.?space|portal/i]);
  add("cityStreetRain", [/2026|城市街头|小巷|暴雨|霓虹|雨声|汽车鸣笛|wet pavement|neon|rain|alley|street/i]);
  add("cafeInterior", [/咖啡店|晚风|吧台|暖黄|风铃|热咖啡|咖啡蒸汽|亚麻围裙|针织衫|wooden bar|café|cafe|coffee|wind chime/i]);

  const supernaturalPower = regexAny(raw, [
    /Ω|Omega|核心|蓝色能量|能量纹路|生物装甲|战甲|铠甲|装甲|能量刃|觉醒|激活|未知力量|澄澈冰蓝|this power|what is this power|blue energy|energy blade|bio-armor|armor/i,
  ]);
  const onlyMundanePower = stages.has("powerOutage") && !supernaturalPower;
  if (supernaturalPower && !onlyMundanePower) stages.add("supernaturalPower");
  if (
    !onlyMundanePower &&
    regexAny(raw, [/危急关头|滚烫的蓝色能量|胸腔炸开|眉心.*幽蓝|Ω核心.*激活|未知力量|what is this power|this power|blue energy/i])
  ) {
    stages.add("powerAwakening");
  }
  if (!onlyMundanePower && regexAny(raw, [/生物装甲|战甲形态|漆黑.*装甲|覆盖全身|瞳孔.*冰蓝|身披漆黑|bio-armor|armor form|activated armor/i])) {
    stages.add("transformedHero");
  }
  if (!onlyMundanePower && regexAny(raw, [/能量刃|手腕装甲|挥出能量刃|蓝光破空|刃力|energy blade|blade/i])) {
    stages.add("energyWeapon");
  }
  if (stages.has("farmDeadstock")) stages.delete("mutation");
  if (stages.has("cafeInterior") && /咖啡|蒸汽|热咖啡|风铃|吧台|围裙|coffee|cafe|café|steam|wind chime/i.test(raw)) {
    stages.delete("riftVoid");
    stages.delete("bureauHq");
    stages.delete("cityStreetRain");
  }
  return stages;
}

function classifyAssetRole(asset) {
  const raw = `${asset.name || ""} ${asset.label || ""} ${asset.visual || ""}`;
  const lower = raw.toLowerCase();
  const roles = new Set();
  const has = (patterns) => regexAny(raw, patterns) || regexAny(lower, patterns);

  if (asset.type === "Scene") {
    roles.add("scene");
    if (has([/地铁|车厢|隧道|列车|metro|subway|train|carriage|tunnel/i])) roles.add("scene.metro");
    if (has([/晚高峰|通勤|2103|新港|Newport|rush hour|normal|列车车厢与隧道/i])) roles.add("scene.metro.establishing");
    if (has([/暗紫|应急灯|震颤|频闪|轰鸣|emergency|purple|flicker|shaking/i])) roles.add("scene.metro.emergency");
    if (has([/灾变|狼藉|血腥|铁锈|倒地|disaster|bloody|struck|aftermath|ruin/i])) roles.add("scene.metro.disaster");
    if (has([/农场|牧场|围栏|Peterson|牲畜|牛|farm|pasture|cattle|deadstock/i])) roles.add("scene.farm");
    if (has([/巡逻车|手套箱|方向盘|patrol car|glove compartment|steering wheel/i])) roles.add("scene.vehicle");
    if (has([/学校|school/i])) roles.add("scene.school");
    if (has([/办公室|实验室|facility|lab|office/i])) roles.add("scene.facility");
    if (has([/秩序局总部|2147|银白色空间|全息|bureau|headquarters|holographic/i])) roles.add("scene.bureauHq");
    if (has([/时空裂缝|虚空|裂缝|rift|void|portal|time.?space/i])) roles.add("scene.riftVoid");
    if (has([/城市街头|小巷|暴雨|霓虹|2026|wet pavement|neon|rain|alley|street/i])) roles.add("scene.cityStreetRain");
    if (has([/咖啡店|晚风|吧台|暖黄|风铃|咖啡|café|cafe|coffee|wooden bar|wind chime/i])) roles.add("scene.cafeInterior");
    return roles;
  }

  if (asset.type === "Character") {
    roles.add("character");
    if (has([/伊森|Ethan/i])) {
      roles.add("character.protagonist");
      if (has([/Ω|Omega|战甲|armor|生物装甲|activated|bio-armor|核心战甲/i])) roles.add("character.protagonist.transformed");
      else roles.add("character.protagonist.base");
    }
    if (has([/上班族|office worker|公文包/i])) roles.add("character.passenger.office");
    if (has([/女乘客|female passenger|woman passenger/i])) roles.add("character.passenger.female");
    if (has([/中年|异化中|mutating middle-aged|middle-aged/i])) roles.add("character.mutatingVictim");
    if (has([/畸变怪物|异化怪物|怪物|monster|creature/i])) roles.add("character.monster");
    if (has([/Mercer|Cole|警长|sheriff/i])) roles.add("character.sheriff");
    if (has([/Hale|Deputy|副警长/i])) roles.add("character.deputy");
    if (has([/Voss|Doctor|Dr\.|博士/i])) roles.add("character.doctor");
    return roles;
  }

  roles.add(asset.type === "Insert" ? "insert" : "prop");
  if (has([/检修|maintenance|paperwork|单据/i])) roles.add("prop.maintenancePaperwork");
  if (has([/Ω|Omega|核心|blue energy|蓝色能量|能量纹路/i])) roles.add("prop.energyCore");
  if (has([/能量刃|energy blade|blade/i])) roles.add("prop.energyWeapon");
  if (has([/照片|photograph|photo|2005|archival/i])) roles.add("prop.archivalPhoto");
  if (has([/电话|手机|phone|unknown number/i])) roles.add("prop.phone");
  if (has([/文件夹|folder|GRAYLIGHT|PROJECT|classified|机密/i])) roles.add("prop.classifiedFile");
  if (has([/牛|牲畜|尸体|灰化|中空|cattle|carcass|deadstock/i])) roles.add("insert.deadstockCarcass");
  return roles;
}

function classifyBeatStagesWithContext(beat, context = {}) {
  const stages = classifyBeatStages(beat);
  const beats = Array.isArray(context.beats) ? context.beats : [];
  const index = Number.isFinite(Number(context.index)) ? Number(context.index) : -1;
  if (index <= 0 || !beats.length) return stages;

  const previousText = beats.slice(0, index).join(" ");
  const previousStages = classifyBeatStages(previousText);
  const current = compactLine(beat);
  const transformedAlready = previousStages.has("transformedHero") || previousStages.has("energyWeapon");
  const mutationAlready = previousStages.has("mutation") || previousStages.has("monsterThreat");
  const metroCrisisAlready = previousStages.has("disturbance") || previousStages.has("monsterThreat") || previousStages.has("aftermath");

  if (
    transformedAlready &&
    regexAny(current, [/伊森|Ethan|this power|what is this power|未知力量|蓝色能量|Ω|Omega|能量刃|怪物|畸变体|狼藉|余波|战甲/i])
  ) {
    stages.add("supernaturalPower");
    stages.add("transformedHero");
  }
  if (mutationAlready && regexAny(current, [/怪物|畸变体|畸变怪物|异化怪物|扑杀|围拢|倒地|遍地|惨叫|monster|mutat(?:ed|ion)? creature/i])) {
    stages.add("monsterThreat");
  }
  if (metroCrisisAlready && regexAny(current, [/车厢|隧道|灯光|乘客|伊森|Ethan|怪物|畸变|Ω|Omega|train|carriage|metro|tunnel/i])) {
    stages.add("disturbance");
  }
  return stages;
}

function assetKeywordScore(beat, asset, context = {}) {
  const stages = classifyBeatStagesWithContext(beat, context);
  const roles = classifyAssetRole(asset);
  let score = textMentionsAsset(beat, asset) ? 4 : 0;
  const officePassengerBeat = regexAny(beat, [/上班族|公文包|power failure|what.?s happening|office worker|briefcase/i]);
  const femalePassengerBeat = regexAny(beat, [/女乘客|they.?re changing|all of them|尖叫|退缩|颤抖|female passenger/i]);
  const monsterBeat = regexAny(beat, [/畸变怪物|异化怪物|畸变体|怪物|扑杀|扑向|围拢|倒地|遍地|monster|creature/i]);

  if (asset.type === "Scene") {
    if (roles.has("scene.metro.establishing") && stages.has("establishing") && !setHasAny(stages, ["disturbance", "mutation", "monsterThreat", "aftermath"])) score += 18;
    if (roles.has("scene.metro.emergency") && setHasAny(stages, ["disturbance", "powerOutage", "dialogueAlarm", "mutation"]) && !stages.has("aftermath")) score += 24;
    if (
      roles.has("scene.metro.disaster") &&
      (stages.has("aftermath") || stages.has("transformedHero") || stages.has("energyWeapon") || (stages.has("monsterThreat") && stages.has("protagonistDanger")))
    ) {
      score += 22;
    }
    if (roles.has("scene.farm") && stages.has("farmDeadstock")) score += 24;
    if (roles.has("scene.vehicle") && setHasAny(stages, ["vehicleInterior", "phoneCall", "classifiedFile"])) score += 22;
    if (roles.has("scene.school") && stages.has("schoolDirection")) score += 18;
    if (roles.has("scene.bureauHq") && stages.has("bureauHq")) score += 28;
    if (roles.has("scene.riftVoid") && stages.has("riftVoid")) score += 28;
    if (roles.has("scene.cityStreetRain") && stages.has("cityStreetRain")) score += 28;
    if (roles.has("scene.cafeInterior") && stages.has("cafeInterior")) score += 28;
    if (roles.has("scene.metro") && setHasAny(stages, ["establishing", "disturbance", "mutation", "monsterThreat", "aftermath", "powerAwakening", "transformedHero", "energyWeapon"])) score += 4;
    if (roles.has("scene.bureauHq") && setHasAny(stages, ["riftVoid", "cityStreetRain", "cafeInterior"])) score -= 20;
    if (roles.has("scene.riftVoid") && setHasAny(stages, ["bureauHq", "cityStreetRain", "cafeInterior"])) score -= 20;
    if (roles.has("scene.cityStreetRain") && setHasAny(stages, ["bureauHq", "riftVoid", "cafeInterior"])) score -= 20;
    if (roles.has("scene.cafeInterior") && setHasAny(stages, ["bureauHq", "riftVoid", "cityStreetRain"])) score -= 20;
    if (
      roles.has("scene.metro.disaster") &&
      !(stages.has("aftermath") || stages.has("transformedHero") || stages.has("energyWeapon") || (stages.has("monsterThreat") && stages.has("protagonistDanger")))
    ) {
      score -= 16;
    }
    if (roles.has("scene.metro.establishing") && setHasAny(stages, ["monsterThreat", "transformedHero", "energyWeapon", "aftermath"])) score -= 10;
  }

  if (asset.type === "Character") {
    score += characterAssetSemanticScore(beat, asset, context);
    if (roles.has("character.protagonist.base") && setHasAny(stages, ["establishing", "protagonistDanger", "powerAwakening"])) score += 16;
    if (roles.has("character.protagonist.base") && setHasAny(stages, ["transformedHero", "energyWeapon", "aftermath"])) score += 3;

    if (roles.has("character.protagonist.transformed")) {
      if (setHasAny(stages, ["transformedHero", "energyWeapon"])) score += 26;
      else if (stages.has("powerAwakening") || (stages.has("supernaturalPower") && !stages.has("powerOutage"))) score -= 6;
      else score -= 30;
    }

    if (roles.has("character.passenger.office") && officePassengerBeat) score += 20;
    if (roles.has("character.mutatingVictim")) {
      if (stages.has("mutation")) score += 22;
      else score -= 22;
    }
    if (roles.has("character.passenger.female") && femalePassengerBeat) score += 18;
    if (roles.has("character.monster")) {
      if (stages.has("monsterThreat") && monsterBeat) score += 22;
      else if (stages.has("aftermath") && monsterBeat) score += 12;
      else if (stages.has("mutation")) score += 8;
      else score -= 24;
    }
    if (roles.has("character.sheriff") && regexAny(beat, [/Mercer|Cole|警长|Sheriff/i])) score += 18;
    if (roles.has("character.deputy") && regexAny(beat, [/Hale|Deputy|副警长/i])) score += 18;
    if (roles.has("character.doctor") && regexAny(beat, [/Voss|Dr\.|博士|Doctor/i])) score += 18;
  }

  if (asset.type === "Prop" || asset.type === "Insert") {
    if (roles.has("prop.maintenancePaperwork") && setHasAny(stages, ["documentEvidence", "establishing"])) score += 18;
    if (roles.has("prop.energyCore")) {
      if (setHasAny(stages, ["powerAwakening", "transformedHero", "energyWeapon"]) || (stages.has("supernaturalPower") && !stages.has("powerOutage"))) score += 20;
      if (stages.has("powerOutage") && !stages.has("supernaturalPower")) score -= 30;
    }
    if (roles.has("prop.energyWeapon")) {
      if (stages.has("energyWeapon")) score += 24;
      else score -= 24;
    }
    if (roles.has("prop.archivalPhoto") && stages.has("photoEvidence")) score += 22;
    if (roles.has("prop.phone") && stages.has("phoneCall")) score += 22;
    if (roles.has("prop.classifiedFile") && stages.has("classifiedFile")) score += 22;
    if (roles.has("insert.deadstockCarcass") && stages.has("farmDeadstock")) score += 24;
  }

  return score;
}

function characterAssetSemanticScore(beat, asset, context = {}) {
  const current = compactLine(beat);
  if (!current || asset?.type !== "Character") return 0;
  const assetText = compactLine(`${asset.name || ""} ${asset.label || ""} ${asset.evidence || ""} ${asset.visual || ""}`);
  const label = compactLine(asset.label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let score = 0;
  if (label && new RegExp(`(^|[^A-Za-z0-9])${label}([^A-Za-z0-9]|$)`, "i").test(current)) score += 42;
  const activeText = `${(Array.isArray(context.beats) ? context.beats.slice(Math.max(0, Number(context.index || 0) - 2), Number(context.index || 0)).join(" ") : "")} ${current}`;
  if (label && current.length < 180 && /(?:原本|仍|继续|伤|受伤|剥落|苍白|脸颊|尾巴|尾鳍|鳞片|衣衫|锁链|跪|被押|被捆|被推|her|his|she|he)/i.test(current)) {
    if (new RegExp(`(^|[^A-Za-z0-9])${label}([^A-Za-z0-9]|$)`, "i").test(activeText)) score += 8;
  }
  const beatWoundedTail =
    /(?:人鱼|鱼尾|尾巴|尾鳍|鳞片).{0,24}(?:伤|剥落|破碎|黯淡|狼狈|受损)|(?:伤|剥落|破碎|黯淡|狼狈|受损).{0,24}(?:人鱼|鱼尾|尾巴|尾鳍|鳞片)/.test(current);
  if (beatWoundedTail) {
    if (/(?:人鱼|鱼尾|尾巴|尾鳍|鳞片)/.test(assetText)) score += 8;
    if (/(?:伤痕|伤口|剥落|破碎|黯淡|狼狈|受损|捆缚|衣衫破碎)/.test(assetText)) score += 34;
    if (!/(?:伤痕|伤口|剥落|破碎|黯淡|狼狈|受损)/.test(assetText) && /(?:完整|华贵|奢华|金尾|金色|珠宝|王妃|得意|挑衅)/.test(assetText)) score -= 18;
  }
  const beatLuxuryAntagonist =
    /(?:华贵|妆容|艳丽|张扬|金色|金尾|王妃|恶毒|轻蔑|得意|居高临下|Isabella)/i.test(current);
  if (beatLuxuryAntagonist) {
    if (/(?:华贵|妆容|艳丽|张扬|金色|金尾|王妃|恶毒|轻蔑|得意|Isabella)/i.test(assetText)) score += 20;
    if (/(?:伤痕|剥落|破碎|黯淡|狼狈|星辰公主|Aria)/i.test(assetText) && !/Aria/i.test(current)) score -= 6;
  }
  const beatBoundVictim = /(?:被押|押着|跪|捆缚|锁链|衣衫破碎|狼狈|苍白|Star Princess|trash fish|Aria)/i.test(current);
  if (beatBoundVictim) {
    if (/(?:被押|跪|捆缚|锁链|衣衫破碎|狼狈|苍白|星辰公主|Star Princess|Aria)/i.test(assetText)) score += 18;
  }
  const beatDeepSeaGuard = /(?:侍卫|押着|押解|长戟|护卫|guard)/i.test(current);
  if (beatDeepSeaGuard && /(?:侍卫|押解|长戟|护卫|guard)/i.test(assetText)) score += 22;
  return score;
}

function characterAssetRelevantToBeat(beat, asset, context = {}) {
  if (!asset || assetTypeForLookupRecord(asset, asset.name) !== "Character") return false;
  return assetKeywordScore(beat, { ...asset, type: "Character" }, context) >= 8;
}

function refineShotRefsForBeat({ refs = [], fallbackRefs = [], beat = "", assetLookup, context = {} }) {
  const merged = [];
  const push = (ref) => {
    const clean = compactLine(ref);
    if (clean && assetLookup?.has?.(clean) && !merged.includes(clean)) merged.push(clean);
  };
  const fallbackValidation = validateShotRefs(fallbackRefs, assetLookup);
  const fallbackScene = fallbackValidation.refs.find((ref) => assetLookup.get(ref)?.manifestType === "Scene");
  const fallbackCharacters = fallbackValidation.refs.filter((ref) => assetLookup.get(ref)?.manifestType === "Character");
  const fallbackProps = fallbackValidation.refs.filter((ref) => ["Prop", "Insert"].includes(assetLookup.get(ref)?.manifestType));
  if (fallbackScene) push(fallbackScene);
  fallbackCharacters.forEach(push);
  fallbackProps.forEach(push);
  const scoredOriginalCharacters = refs
    .filter((ref) => assetLookup.get(ref)?.manifestType === "Character")
    .map((ref) => ({ ref, score: assetKeywordScore(beat, { ...assetLookup.get(ref), type: "Character" }, context) }))
    .filter((item) => item.score >= 8)
    .sort((a, b) => b.score - a.score);
  scoredOriginalCharacters.forEach((item) => push(item.ref));
  const originalProps = refs.filter((ref) => ["Prop", "Insert"].includes(assetLookup.get(ref)?.manifestType));
  originalProps.forEach(push);
  const originalScenes = refs.filter((ref) => assetLookup.get(ref)?.manifestType === "Scene");
  for (const ref of originalScenes) {
    if (merged.some((item) => assetLookup.get(item)?.manifestType === "Scene")) continue;
    push(ref);
  }
  if (!merged.length) refs.forEach(push);
  return merged.slice(0, 8);
}

function bestAssetsForBeat(assets, beat, limit, fallback = true, context = {}) {
  const scored = assets
    .map((asset) => ({ asset, score: assetKeywordScore(beat, asset, context) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.asset.name.localeCompare(b.asset.name));
  const picked = scored.slice(0, limit).map((item) => item.asset);
  if (!picked.length && fallback && assets[0]) picked.push(assets[0]);
  return picked;
}

function refsForBeat(beat, assets, context = {}) {
  const sceneAssets = assets.filter((asset) => asset.type === "Scene");
  const characterAssets = assets.filter((asset) => asset.type === "Character");
  const propAssets = assets.filter((asset) => asset.type === "Prop" || asset.type === "Insert");
  const refs = [];
  const push = (asset) => {
    if (asset?.name && !refs.includes(asset.name)) refs.push(asset.name);
  };
  bestAssetsForBeat(sceneAssets, beat, 1, true, context).forEach(push);
  bestAssetsForBeat(characterAssets, beat, 4, false, context).forEach(push);
  const byName = assetLookupFromAssets(assets);
  if (!refs.some((ref) => byName.get(ref)?.type === "Character") && /伊森|Ethan/i.test(beat)) {
    const ethan = characterAssets.find((asset) => /伊森|Ethan/i.test(asset.name + asset.label) && !/Ω|OMEGA|战甲|armor/i.test(asset.name + asset.label));
    push(ethan);
  }
  // A:beat 描写了人却没匹配到具名角色时,继承最近一段有角色的 beat 的人物,避免"无人物参考、模型乱编人脸"。
  const beatHasPerson = /她|他|女人|男人|女子|男子|女孩|男孩|女士|先生|保镖|人影|身影|角色|众人/.test(beat);
  if (beatHasPerson && !refs.some((ref) => byName.get(ref)?.type === "Character")) {
    const priorBeats = Array.isArray(context.beats) ? context.beats : [];
    const curIndex = Number.isFinite(Number(context.index)) ? Number(context.index) : priorBeats.length;
    for (let j = curIndex - 1; j >= 0; j -= 1) {
      const inherited = bestAssetsForBeat(characterAssets, priorBeats[j] || "", 2, false, context);
      if (inherited.length) { inherited.forEach(push); break; }
    }
  }
  bestAssetsForBeat(propAssets, beat, 2, false, context).forEach(push);
  if (!refs.some((ref) => byName.get(ref)?.type === "Scene")) bestAssetsForBeat(sceneAssets, beat, 1, true, context).forEach(push);
  return refs.slice(0, 8);
}

function seedanceDialogueText(shot) {
  const dialogues = Array.isArray(shot.dialogues) ? shot.dialogues : Array.isArray(shot.dialogueLines) ? shot.dialogueLines : [];
  if (!dialogues.length) return "无对白；保留呼吸、停顿和环境声";
  return dialogues
    .map((item) => {
      if (typeof item === "string") return item;
      const speaker = compactLine(item.speaker || "");
      const text = compactLine(item.text || "");
      if (!text) return "";
      return speaker ? `${speaker}：${text}` : text;
    })
    .map(compactLine)
    .filter(Boolean)
    .slice(0, 4)
    .join(" / ");
}

// 按已经绑定的正式资产风格生成“风格定律”。资产尚未生成时只允许规划镜头，
// 不能擅自把整片锁成超写实或任何其他画风。
function seedanceStyleLawForPreset(preset = "") {
  const raw = compactLine(preset || "");
  if (!raw) return "视觉风格：待正式资产图生成并绑定后确定；当前只按剧本规划镜头，不预设写实、动画或任何画风。";
  const key = normalizeAssetStylePreset(raw);
  const label = ASSET_IMAGE_STYLE_PRESETS[key]?.label || "指定风格";
  if (key === "photoreal") {
    return "全片强制超写实真人电影实拍质感：真实皮肤、毛孔、自然光影与真实材质，写实人体比例。";
  }
  return `全片强制保持「${label}」风格：所有镜头、人物、场景、材质、光影与调色都必须是该风格的渲染，人物必须是该风格下的角色形象；严禁真人实拍或写实照片质感、真实皮肤毛孔细节。`;
}

function seedancePromptDesignForShot(shot, index) {
  const design = sanitizeSeedanceDesign(shot?.videoDesign);
  if (!hasCompleteSeedanceDesign(design)) {
    throw new Error(`模型导演设计缺失：${shot?.name || shot?.id || `镜头 ${Number(index || 0) + 1}`}。请重新生成分镜草稿。`);
  }
  const stylePreset = compactLine(shot.videoStylePreset || "") ? normalizeAssetStylePreset(shot.videoStylePreset) : "";
  return {
    style: seedanceStyleLawForPreset(stylePreset),
    shot_size: design.shot_size,
    camera_lens: design.camera_lens,
    camera_movement: design.camera_movement,
    camera_angle: design.camera_angle,
    visual: design.visual,
    voice_over: design.voice_over,
    sound: design.sound,
  };
}

function seedanceNaturalLanguagePromptForShot(shot, index, dialogueLanguage) {
  const refs = (shot.refs || []).map((ref, refIndex) => seedanceReferenceLine(ref, refIndex, shot.assetLookup)).join("\n");
  const d = seedancePromptDesignForShot(shot, index);
  const dialogue = Array.isArray(shot?.dialogues) && shot.dialogues.length ? seedanceDialogueText(shot) : "无";
  const duration = clampShotDuration(shot.duration || 8);
  const prompt = [
    `镜号 ${index + 1}（${duration} 秒）`,
    `景别：${d.shot_size}`,
    `摄像机 / 镜头：${d.camera_lens}`,
    `运镜：${d.camera_movement}`,
    `机位视角：${d.camera_angle}`,
    `画面：${d.style} ${d.visual}`,
    `人声 OS：${d.voice_over}`,
    `人物台词：${dialogue}`,
    `音效：${d.sound}`,
  ].join("\n");
  return `${refs ? `${refs}\n\n` : ""}${prompt}`.trim();
}

// Production Board 已把实际资产身份烘焙进每个画面。视频阶段只提交故事板，
// 文字提示只说明板的画面语义和对白，绝不能引用未上传的正式资产图片。
function storyboardSeedancePrompt(shot, index, dialogueLanguage) {
  const storyboardRefs = Array.isArray(shot.storyboardRefs) ? shot.storyboardRefs : [];
  const sbLines = storyboardRefs.map(
    (ref, i) => `@图片${i + 1} 是 Production Board 故事板，作为唯一提交图片参考；直接继承其面板中已经渲染的人物身份、场景、道具、材质、色彩、光线、构图、站位、镜头景别、动作方向与节奏。`,
  );
  const storyText = "严格按 Production Board 对应编号面板执行。人物、场景和道具的最终视觉身份已经在板面中锁定，不要期待、引用或补充其他资产图；不要臆造未出现的人物、物体或视觉风格。";
  const blocks = [`剧情动作：${storyText}`];
  const dlg = compactLine(seedanceDialogueText(shot));
  if (dlg) blocks.push(`对白：${dlg}`);
  return `${sbLines.join("\n")}\n\n${blocks.join("\n\n")}`.trim();
}

// 按生成模式自动选择提示词方案:故事板模式=极简(跟故事板);首尾帧/普通模式=完整电影化提示词。
function seedancePromptForShotMode(shot, index, dialogueLanguage, storyboardsActive) {
  return storyboardsActive
    ? storyboardSeedancePrompt(shot, index, dialogueLanguage)
    : seedanceNaturalLanguagePromptForShot(shot, index, dialogueLanguage);
}

function seedancePromptBlock(shot, index, dialogueLanguage) {
  return `## ${shot.id}

推荐时长：${shot.duration}s
画幅：9:16 vertical
参考资产：${shot.refs.join(", ")}

\`\`\`text
${seedanceNaturalLanguagePromptForShot(shot, index, dialogueLanguage)}
\`\`\``;
}

function storyboardSystemPrompt() {
  return `你是短剧视频分镜和 Seedance 2.0 提示词拆解模型。你的任务是根据剧本和已确认资产解析，输出可直接进入视频生成配置的镜头列表。

必须遵守：
- 只返回服务端可读取的结构化镜头计划，不输出 Markdown、散文提示词或解释；这个返回仅用于校验和保存，绝不能作为 Seedance 视频提示词提交。
- 结构化字段内容使用中文；dialogueLines 每条必须严格按「说话人：目标语言台词」格式返回，说话人必须使用剧本中的角色名或代号，不得省略；英文模式台词用英文，中文模式台词用中文。
- 严格根据剧本拆解，不得添加剧本没有的人物、地点、道具、怪物、武器或事件。
- 每一集剧情视频总时长允许 ${VIDEO_MIN_EPISODE_SECONDS}-${VIDEO_MAX_EPISODE_SECONDS} 秒，由剧本内容复杂度决定；不得为了凑时长增补剧情，镜头数量和秒数必须服务原剧本节拍。
- 每个镜头必须有明确剧情依据、推荐时长、参考资产 refs、中文标题、中文分镜目的。
- refs 只能使用给定 assets 中的 name，不得编造不存在的资产名。
- 分镜规划优先把同一场景、同一连续动作、同一情绪/物件状态的相邻节拍合并到一个镜头里生成，单个镜头时长必须在 4-15 秒之间；切镜、换场、建立镜头、节奏重置、时间跳跃应拆成独立镜头。
- 不要平均分配镜头时长，不要把所有镜头都设为 12 秒。推荐时长必须根据剧情节拍决定，并优先把完整剧情段落设计成接近 15 秒：建立镜头/插入/转场 4-8 秒，普通对白或反应 8-12 秒，同场景连续动作、危机升级、关键表演、需要尾帧承接的剧情 12-15 秒。
- 一集通常优先规划约 5 个 15 秒级视频片段；剧情复杂、切镜明确、换场较多或对白密集时增加到 6-8 个片段，最高不超过 ${VIDEO_MAX_EPISODE_SECONDS} 秒。
- 如果相邻镜头发生在同一场景，应保持同一个场景资产引用和空间方向；尾帧续接由后端配置层判断，videoPrompt 中不要写尾帧规则。
- Production Board 衔接流程：先用正式资产图锁定人物、场景、道具身份；再把同一连续场景或动作段落渲染成一张 9:16 竖版、3×3 九个编号面板的 Production Board。每个面板必须把实际人物、场景和道具的最终视觉身份烘焙进画面；视频阶段只提交这张 Production Board。
- 当使用 Production Board 时，videoPrompt 需要明确本段读取哪些实际面板的节奏来源，说明动作方向、演员站位、构图、切换点和同场景衔接；整张制作板与每个面板都服务最终 9:16 成片构图。
- 使用 Production Board 时，videoPrompt 只引用已提交的故事板图片、剧情与镜头、对白、摄影与声音。后端面板资产绑定仅用于生成故事板；视频模型不再接收正式 Character / Scene / Prop / Insert 资产图。
- 每个镜头的画面拆解必须用下方《导演引擎》方法，并输出为结构化的 design 对象（字段值用具体中文，禁用感觉词）。design 字段内容使用中文，英文对白只出现在 dialogueLines。
- 同一场景只有第一个镜头可以承担短建立镜头；后续镜头必须直接承接上一镜的站位、视线、道具状态、动作方向和情绪，不得重新展示环境，不得用空镜或大全景重启本段。
- 相邻镜头必须有不同镜头目的，可在 establish / action_continuation / dialogue_reaction / insert / over_shoulder / close_reaction 中选择；不要连续输出同一种中景站立镜头。
- 触发审核风险的暴力/恐怖内容，要用遮挡、影子、反应镜头、环境变化和声音替代直白血腥描写，同时最大限度保留剧本原意。

${SEEDANCE_DIRECTOR_SYSTEM_ZH}

返回对象结构（仅供服务端保存模型计划，视频阶段会编译为中文镜头单）：
{
  "targetDuration": "根据剧本复杂度在 ${VIDEO_MIN_EPISODE_SECONDS}-${VIDEO_MAX_EPISODE_SECONDS} 秒内决定",
  "shots": [
    {
      "title": "镜头中文标题",
      "duration": 8,
      "beat": "对应剧本依据",
      "purpose": "分镜目标",
      "refs": ["S001_example", "C001_example"],
      "dialogueLines": ["SPEAKER：目标语言台词（每条必须带说话人前缀；英文模式用英文，中文模式用中文）"],
      "design": {
        "shot_size": "双人侧面半身中近景",
        "camera_lens": "50mm 标准定焦",
        "camera_movement": "小幅前后缓慢推动，写明速度、幅度和持续时间",
        "camera_angle": "侧前方微仰 15° 视角",
        "visual": "空间、站位、一个可见动作及终点、构图裁切、可信光源与连续性",
        "voice_over": "人声 OS；没有时写 无",
        "sound": "具体音效、环境底噪与声音延续"
      }
    }
  ]
}`;
}

function storyboardUserPrompt({ script, assets, dialogueLanguage, targetShotCount, durationPlan = null }) {
  return JSON.stringify(
    {
      task: "根据剧本和资产解析拆解视频分镜，并为 Seedance 2.0 生成中文视频提示词。",
      dialogueLanguage: dialogueLanguage === "zh" ? "zh" : "en",
      targetShotCount,
      durationGuidance: durationPlan
        ? {
            targetDuration: durationPlan.target,
            suggestedDurations: durationPlan.durations,
            allowedTotalRange: `${VIDEO_MIN_EPISODE_SECONDS}-${VIDEO_MAX_EPISODE_SECONDS}s`,
            rule: "这是后端按剧情复杂度和剧情权重计算的参考时长。可以在 70-90 秒内微调，但不要平均分配，不要全部 12 秒；优先把完整剧情段落设计成接近 15 秒，每段必须 4-15 秒。只允许使用剧本已有剧情，信息不足时不要为了凑时长增补事件。",
          }
        : undefined,
      assets: assets.map((asset) => ({
        name: asset.name,
        type: asset.type,
        label: asset.label,
        evidence: asset.evidence,
        visual: asset.visual || "",
      })),
      screenplay: script.slice(0, 30000),
    },
    null,
    2,
  );
}

function normalizeStoryboardShot(raw, index, context) {
  if (!raw || typeof raw !== "object") return null;
  const duration = clampShotDuration(Number(raw.duration || 0) || context.durationPlan.durations[index] || 9, context.durationPlan.durations[index] || 9);
  const title = compactLine(raw.title || raw.name || raw.beat || `分镜 ${index + 1}`).slice(0, 80);
  const beat = compactLine(raw.beat || raw.evidence || raw.purpose || title).slice(0, 1200);
  const purpose = compactLine(raw.purpose || `还原剧本节拍：${beat || title}`).slice(0, 600);
  const allowedRefs = new Set(context.assets.map((asset) => asset.name));
  const assetLookup = assetLookupFromAssets(context.assets);
  const refs = Array.isArray(raw.refs) ? raw.refs.map(compactLine).filter((ref) => allowedRefs.has(ref)) : [];
  const finalRefs = [...new Set(refs)].slice(0, 8);
  // 对白说话人:剧本是「谁说的」的地面真相。分镜模型返回的 dialogueLines 常是无归属的纯台词字符串,
  // 直接用会丢说话人(渲染成 seedanceDialogueText 的字符串分支 → 「台词／台词」无名字)。这里统一规范成
  // {speaker,text}:模型行先按「名字：台词」解析,speaker 缺失时用本镜剧本节拍(原始 script beat)提取回填。
  const scriptBeat = compactLine(context.beats?.[index] || "") || beat;
  const beatDialogues = dialoguesForText(scriptBeat, context.dialogueLanguage);
  const modelItems = Array.isArray(raw.dialogueLines)
    ? normalizeDialogueItems(raw.dialogueLines.slice(0, 4), context.dialogueLanguage)
    : [];
  const dialogueLines = backfillDialogueSpeakers(modelItems, beatDialogues, {
    positional: true,
    dialogueLanguage: context.dialogueLanguage,
  });
  const videoDesign = sanitizeSeedanceDesign(raw.design);
  if (!title || !beat || !finalRefs.length || !hasCompleteSeedanceDesign(videoDesign)) {
    throw new Error(`视频分镜模型第 ${index + 1} 镜缺少有效资产引用或完整导演设计`);
  }
  return {
    id: `${context.code}_V${String(index + 1).padStart(3, "0")}_${safeAssetSlug(title, "BEAT").slice(0, 28)}`,
    duration,
    title,
    purpose,
    refs: finalRefs,
    dialogues: dialogueLines,
    beat,
    videoDesign,
    assetLookup,
  };
}

function shouldRebalanceShotDurations(shots = []) {
  const durations = shots.map((shot) => Number(shot.duration || 0)).filter((duration) => duration > 0);
  if (durations.length <= 1) return false;
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const unique = new Set(durations);
  if (total < VIDEO_MIN_EPISODE_SECONDS) return true;
  if (durations.some((duration) => duration < VIDEO_MIN_SECONDS || duration > VIDEO_MAX_SECONDS)) return true;
  if (unique.size === 1) return true;
  if (unique.size <= Math.max(1, Math.floor(durations.length / 4))) return true;
  return durations.every((duration) => duration === 12);
}

function rebalanceShotDurations(shots = [], options = {}) {
  if (!shots.length) return shots;
  const beats = shots.map((shot) => compactLine(shot.beat || shot.title || shot.purpose || ""));
  const rawDurations = shots.map((shot) => Number(shot.duration || 0));
  const targetDuration = Number(options.targetDuration || 0) || options.durationPlan?.target || 0;
  const plan = planEpisodeDuration({
    shotCount: shots.length,
    beats,
    targetDuration,
    rawDurations,
  });
  return shots.map((shot, index) => ({
    ...shot,
    duration: plan.durations[index] || shot.duration,
    durationReason: `按剧情权重重新分配：${plan.durations[index] || shot.duration}s`,
  }));
}

function shotOverlapWarnings(shots = []) {
  const warnings = [];
  const coreForShot = (shot) => compactLine(shot?.beat || promptStoryCoreForMatch(shot?.prompt || "", shot?.promptSection || shot?.name || "") || shot?.title || "");
  for (let index = 0; index < shots.length; index += 1) {
    const current = coreForShot(shots[index]);
    if (!current) continue;
    for (const nearby of [index - 1, index + 1]) {
      if (nearby < 0 || nearby >= shots.length) continue;
      const other = coreForShot(shots[nearby]);
      if (!other) continue;
      const containment = textContainmentPercent(current, other);
      if (containment >= 86 && Math.min(current.length, other.length) >= 36) {
        warnings.push(
          `${shots[index].name || `V${index + 1}`}: 与 ${shots[nearby].name || `V${nearby + 1}`} 剧情重叠 ${containment}% ，请检查分段后再批量生成。`,
        );
      }
    }
  }
  return [...new Set(warnings)];
}

function shouldExpandVideoConfigShots({ sectionCount = 0, targetShotCount = 0, beats = [] } = {}) {
  if (!sectionCount || !targetShotCount) return false;
  if (sectionCount >= targetShotCount) return false;
  if (sectionCount >= 8) return false;
  const beatTextLength = (beats || []).map(compactLine).join(" ").length;
  return targetShotCount - sectionCount >= 2 && (beats.length >= 1 || beatTextLength > 500);
}

function verifiedRefsTextForPrompt(refs = [], lookup = null) {
  return refs.length
    ? refs.map((ref, index) => seedanceReferenceLine(ref, index, lookup)).join("\n")
    : "使用当前镜头已配置参考资产。";
}

function removeTailFrameContinuityFromStoryboardPrompt(prompt) {
  return String(prompt || "")
    .replace(
      /如果本段与上一片段同场景，保持尾帧方向、光线、人物站位和运动方向连续，避免跳轴。/g,
      "如果本段与相邻片段同场景，按 Production Board 的 9:16 面板构图、站位、镜头方向、动作节奏和剪辑出口保持空间连贯，避免跳轴。",
    )
    .replace(
      /如果与上一片段同场景，保持尾帧方向、光线和人物站位连续，避免跳轴。/g,
      "如果与相邻片段同场景，按 Production Board 的 9:16 面板构图、站位、镜头方向和剪辑出口保持空间连贯，避免跳轴。",
    )
    .replace(/尾帧续接/g, "Production Board 衔接")
    .replace(/上一片段尾帧/g, "Production Board")
    .replace(/上一段尾帧/g, "Production Board")
    .replace(/首帧连续性参考/g, "Production Board 连续性参考");
}

function normalizeStoryboardPlan(data, context) {
  const rawShots = Array.isArray(data?.shots) ? data.shots : [];
  let shots = rawShots.map((shot, index) => normalizeStoryboardShot(shot, index, context)).filter(Boolean);
  if (!shots.length) throw new Error("视频分镜模型没有返回有效 shots");
  if (shouldRebalanceShotDurations(shots)) {
    shots = rebalanceShotDurations(shots, {
      durationPlan: context.durationPlan,
      targetDuration: Number(data?.targetDuration || 0),
    });
  }
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const maxAllowed = Math.min(VIDEO_MAX_EPISODE_SECONDS, shots.length * VIDEO_MAX_SECONDS);
  if (total < VIDEO_MIN_EPISODE_SECONDS || total > maxAllowed) {
    throw new Error(`视频分镜模型返回总时长异常：${total}s，要求 ${VIDEO_MIN_EPISODE_SECONDS}-${maxAllowed}s`);
  }
  return {
    ok: true,
    model: context.model,
    targetDuration: total,
    shots,
  };
}

async function callStoryboardModel({ script, assets, dialogueLanguage, modelName, targetShotCount, code, beats, durationPlan }) {
  const model = normalizeStoryboardModel(modelName);
  if (model === "rules") return { ok: false, model, reason: "使用本地规则拆解，未调用外部分镜模型" };
  const apiKey = storyboardApiKey();
  if (!apiKey) return { ok: false, model, reason: "未配置视频分镜模型 API Key" };
  // 网关偶发返回空内容、坏 JSON 或短暂 5xx；同一请求直接失败会让整套视频配置不可用。
  // 备用模型仍使用同一 STORYBOARD_API_KEY，只更换 GPT 导演模型，不改变提示词来源。
  const candidates = [...new Set([model, "gpt-5.6-terra", "gpt-5.6-luna"])]
    .filter((candidate) => candidate && candidate !== "rules");
  const attempted = [];
  for (const candidate of candidates) {
    const requestBody = (withJsonMode) => ({
      model: candidate,
      temperature: 0.35,
      ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: storyboardSystemPrompt() },
        { role: "user", content: storyboardUserPrompt({ script, assets, dialogueLanguage, targetShotCount, durationPlan }) },
      ],
    });
    const post = (withJsonMode) =>
      fetch(openAiCompatUrl("/v1/chat/completions", "storyboard"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody(withJsonMode)),
      });
    try {
      let response = await post(true);
      let raw = await response.text();
      if (!response.ok && response.status === 400 && /response_format|json_object/i.test(raw)) {
        response = await post(false);
        raw = await response.text();
      }
      if (!response.ok) {
        attempted.push(`${candidate}: HTTP ${response.status} ${raw.slice(0, 240)}`);
        continue;
      }
      const data = JSON.parse(raw);
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(stripJsonFence(content));
      return normalizeStoryboardPlan(parsed, { model: candidate, assets, dialogueLanguage, code, beats, durationPlan });
    } catch (error) {
      attempted.push(`${candidate}: ${error?.message || String(error)}`);
    }
  }
  return { ok: false, model, reason: `所有导演模型均失败：${attempted.join("；") || "未知失败"}` };
}

const IMAGE_STORYBOARD_PANEL_COUNT = 9;
const IMAGE_STORYBOARD_BOARD_COUNT_MAX = 4;
const IMAGE_STORYBOARD_PANEL_TIMES = [
  "0-2s", "2-4s", "4-6s",
  "6-8s", "8-10s", "10-12s",
  "12-13s", "13-14s", "14-15s",
];

function imageStoryboardText(value, fallback = "", maxLength = 900) {
  return compactLine(value || fallback).slice(0, maxLength);
}

function normalizeImageStoryboardDialogue(value) {
  if (typeof value === "string") return { speaker: "", text: imageStoryboardText(value, "无对白", 240) };
  const speaker = imageStoryboardText(value?.speaker || value?.name || "", "", 80);
  const text = imageStoryboardText(value?.text || value?.dialogue || "", "无对白", 240);
  return { speaker, text };
}

function imageStoryboardFallbackPanel(boardIndex, panelIndex, summary) {
  return {
    panel: panelIndex + 1,
    time: IMAGE_STORYBOARD_PANEL_TIMES[panelIndex],
    plot: panelIndex === 0 ? summary : `承接上一格动作，推进「${summary}」`,
    shot: panelIndex === 0 ? "中远景建立空间" : panelIndex === 8 ? "近景收束并留下下一板出口" : "中近景跟随动作",
    cameraMovement: panelIndex === 0 ? "固定机位后缓慢推进" : "平稳跟拍，保持视线方向一致",
    lighting: "沿用同一主光源方向，人物面部有清晰层次",
    dialogue: { speaker: "", text: "无对白" },
    transition: panelIndex === 8 ? "动作或视线留在画面出口，衔接下一板" : "动作连续切入下一格",
    boardIndex,
  };
}

function imageStoryboardImagePrompt(board, totalBoards, hasReferenceImages = false) {
  const panels = board.panels.map((panel) => {
    const dialogue = normalizeImageStoryboardDialogue(panel.dialogue);
    const dialogueText = dialogue.text === "无对白"
      ? "无对白"
      : `${dialogue.speaker ? `${dialogue.speaker}：` : ""}${dialogue.text}`;
    return `面板${panel.panel}（${panel.time}）：剧情=${panel.plot}；景别/镜头=${panel.shot}；运镜=${panel.cameraMovement}；光影=${panel.lighting}；对白=${dialogueText}；转场=${panel.transition}`;
  }).join("\n");
  return [
    "制作一张完整的 16:9 横向 3×3 九宫格故事板图片。整张图片必须是一张统一画布，包含且只包含 9 个等大的分镜格；面板从左到右、从上到下严格编号 1-9。",
    "每个面板同时体现对应的剧情动作、景别或镜头语言、运镜方向、光影关系和对白；对白请作为清晰但克制的画面文字出现。保持人物身份、服装、场景、道具状态和视线方向连续。",
    ...(hasReferenceImages ? [
      "参考图是本项目的唯一视觉身份基准，必须被所有 9 个面板共同遵循；锁定参考图中的人物脸型、发型、体型、服装、服装颜色、道具、场景结构和整体视觉风格。不得重新设计角色，不得换脸、换装、改色、改变年龄或体型，不得用一套新角色和新场景替代参考图。",
      "如有多张参考图，先识别它们对应的同一角色、场景或道具，并在每个相关面板中保持对应关系；参考图只用于确定视觉身份，剧情动作和镜头按本故事板规划执行。",
    ] : []),
    "不要生成 9 张独立图片，不要把九宫格拆成多张图片，不要裁切或拼贴成画外内容，不要加入与剧情无关的角色、道具或事件。",
    `这是连续故事板中的第 ${board.index}/${totalBoards} 张，时长 ${board.timeRange || "0-15s"}。`,
    `前一张的衔接入口：${board.continuityIn || "从故事起始状态进入"}。本张结束出口：${board.continuityOut || "保留动作或视线方向供下一张承接"}。`,
    `本张剧情摘要：${board.summary}`,
    panels,
  ].join("\n\n");
}

function normalizeImageStoryboardBoard(raw, index, totalBoards) {
  const summary = imageStoryboardText(raw?.summary || raw?.plot || raw?.story, `第 ${index + 1} 张故事板的连续剧情`);
  const rawPanels = Array.isArray(raw?.panels) ? raw.panels : [];
  const panels = Array.from({ length: IMAGE_STORYBOARD_PANEL_COUNT }, (_, panelIndex) => {
    const fallback = imageStoryboardFallbackPanel(index + 1, panelIndex, summary);
    const source = rawPanels[panelIndex] || {};
    return {
      ...fallback,
      panel: panelIndex + 1,
      time: imageStoryboardText(source.time, IMAGE_STORYBOARD_PANEL_TIMES[panelIndex], 30),
      plot: imageStoryboardText(source.plot || source.story || source.action, fallback.plot),
      shot: imageStoryboardText(source.shot || source.shotType, fallback.shot, 240),
      cameraMovement: imageStoryboardText(source.cameraMovement || source.camera || source.camera_language, fallback.cameraMovement, 300),
      lighting: imageStoryboardText(source.lighting || source.light, fallback.lighting, 260),
      dialogue: normalizeImageStoryboardDialogue(source.dialogue),
      transition: imageStoryboardText(source.transition || source.cut, fallback.transition, 240),
    };
  });
  const board = {
    index: index + 1,
    timeRange: `${index * 15}-${(index + 1) * 15}s`,
    summary,
    continuityIn: imageStoryboardText(raw?.continuityIn || raw?.continuity_in, index === 0 ? "从故事起始状态进入" : "承接上一张故事板的结尾动作、视线和情绪"),
    continuityOut: imageStoryboardText(raw?.continuityOut || raw?.continuity_out, index === totalBoards - 1 ? "在最后一格完成本段情绪落点" : "保留下一张可以直接接上的动作、视线和道具状态"),
    panels,
  };
  return { ...board, imagePrompt: imageStoryboardImagePrompt(board, totalBoards) };
}

function imageStoryboardPlannerSystemPrompt() {
  return `你是广告与短剧视觉导演，负责把用户输入的故事或情节拆成连续的九宫格故事板方案。

必须遵守：
- 只输出 JSON，不输出 Markdown 或解释。
- layout 固定为 "3x3"，durationPerBoard 固定为 15，boards 数量必须等于用户要求的 1-4 张。
- 每张 board 必须有 9 个 panels，按从左到右、从上到下排列；每格都要给出 plot、shot、cameraMovement、lighting、dialogue、transition。
- 剧情、对白必须根据用户输入展开，不要凭空改变人物关系、目标、地点或结局。
- 如果用户提供参考图，参考图是唯一视觉身份来源；必须先识别参考图中的人物、服装、道具、场景和画面风格，再把它们贯穿到所有 board 和每个 panel。不得重新设计角色、换脸、换装、改色、改变年龄或体型，也不得用全新的角色或场景替代参考图。
- 多张故事板必须连续：后一张的 continuityIn 从前一张的 continuityOut 开始；保持人物身份、服装、场景、道具状态、动作方向、视线和情绪连续，只推进用户故事中已经存在或合理隐含的剧情。
- 每张内部按 0-15 秒推进，9 格可使用 0-2s、2-4s、4-6s、6-8s、8-10s、10-12s、12-13s、13-14s、14-15s 等时间段。
- cameraMovement 要写具体景别、机位和运镜；lighting 要写光源方向、色温或明暗层次；dialogue 没有对白时必须写 speaker 为空、text 为“无对白”。
- 画面用于后续生成一张完整 3×3 九宫格，不要输出九张独立图片的描述。`;
}

function imageStoryboardPlannerUserPrompt({ prompt, boardCount, referenceImageCount }) {
  return JSON.stringify({
    task: "根据用户故事或情节生成 Image 页使用的 3x3 九宫格故事板规划",
    layout: "3x3",
    boardCount,
    durationPerBoard: 15,
    referenceImageCount,
    referenceImageInstruction: referenceImageCount
      ? "已附上参考图。必须以参考图为视觉身份基准，所有 board 和 9 个 panel 都要保持同一人物/道具/场景的外观，不得重新设计。"
      : "未提供参考图。根据故事文字设计角色、道具和场景。",
    continuityRule: boardCount > 1 ? "后一张从前一张 continuityOut 直接开始，保持人物、场景、道具、动作和情绪连续" : "单张内部保持九格动作连续",
    story: prompt.slice(0, 20000),
    outputSchema: {
      layout: "3x3",
      durationPerBoard: 15,
      boards: [{
        index: 1,
        timeRange: "0-15s",
        summary: "本张剧情摘要",
        continuityIn: "进入状态",
        continuityOut: "离开状态",
        panels: [{
          panel: 1,
          time: "0-2s",
          plot: "剧情",
          shot: "景别/镜头",
          cameraMovement: "运镜",
          lighting: "光影",
          dialogue: { speaker: "说话人或空", text: "对白或无对白" },
          transition: "与下一格衔接",
        }],
      }],
    },
  }, null, 2);
}

function imageStoryboardPlannerUserMessage({ prompt, boardCount, referencePaths = [] }) {
  const content = [{
    type: "text",
    text: imageStoryboardPlannerUserPrompt({ prompt, boardCount, referenceImageCount: referencePaths.length }),
  }];
  referencePaths.forEach((file, index) => {
    content.push({ type: "text", text: `参考图 ${index + 1}（必须遵循，不得重新设计）：` });
    content.push({ type: "image_url", image_url: { url: fileToDataUrl(file), detail: "high" } });
  });
  return content;
}

const IMAGE_STORYBOARD_MODEL_TIMEOUT_MS = Math.max(15_000, Number.parseInt(process.env.STORYBOARD_TIMEOUT_MS || "240000", 10));
const IMAGE_STORYBOARD_MODEL_MAX_ATTEMPTS = 3;

function imageStoryboardModelRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function fetchImageStoryboardModel(url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < IMAGE_STORYBOARD_MODEL_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_STORYBOARD_MODEL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
      });
      if (response.ok || !imageStoryboardModelRetryableStatus(response.status)) return response;
      lastError = new Error(`HTTP ${response.status}`);
      try {
        await response.body?.cancel();
      } catch {}
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < IMAGE_STORYBOARD_MODEL_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    }
  }
  const cause = lastError?.cause?.code || lastError?.code || lastError?.message || "未知网络错误";
  throw new Error(`故事板规划模型请求失败（已重试 ${IMAGE_STORYBOARD_MODEL_MAX_ATTEMPTS} 次）：${cause}`);
}

function shouldRetryImageStoryboardWithoutReferences(errorText = "") {
  return /fetch failed|请求失败|超时|network|timeout|timed out|HTTP (400|408|413|422|429|500|502|503|504)|image_url|vision|multimodal|payload|unsupported/i.test(String(errorText || ""));
}

async function createImageStoryboardPlan(body = {}) {
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new Error("请先填写故事或情节");
  const boardCount = Math.max(1, Math.min(IMAGE_STORYBOARD_BOARD_COUNT_MAX, Number(body.boardCount) || 1));
  const model = normalizeStoryboardModel(body.model);
  const apiKey = storyboardApiKey();
  if (!apiKey) throw new Error("未配置故事板规划模型 API Key");
  const requestedReferences = (Array.isArray(body.referenceImages) ? body.referenceImages : [])
    .map(compactLine)
    .filter(Boolean)
    .slice(0, 4);
  const referencePaths = (await Promise.all(requestedReferences.map(resolveCanvasImageReferenceToLocalPath))).filter(Boolean);
  if (requestedReferences.length && referencePaths.length !== requestedReferences.length) {
    throw new Error(`故事板参考图解析失败：要求 ${requestedReferences.length} 张，实际解析到 ${referencePaths.length} 张。请重新上传或导入参考图。`);
  }
  const requestBody = (withJsonMode, includeReferenceImages = referencePaths.length > 0) => ({
    model,
    temperature: 0.35,
    ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: imageStoryboardPlannerSystemPrompt() },
      {
        role: "user",
        content: includeReferenceImages
          ? imageStoryboardPlannerUserMessage({ prompt, boardCount, referencePaths })
          : imageStoryboardPlannerUserPrompt({ prompt, boardCount, referenceImageCount: referencePaths.length }),
      },
    ],
  });
  const post = (withJsonMode, includeReferenceImages = referencePaths.length > 0) => fetchImageStoryboardModel(openAiCompatUrl("/v1/chat/completions", "storyboard"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody(withJsonMode, includeReferenceImages)),
  });
  let usedReferenceImages = referencePaths.length > 0;
  let response;
  try {
    response = await post(true, usedReferenceImages);
  } catch (error) {
    if (!usedReferenceImages || !shouldRetryImageStoryboardWithoutReferences(error.message)) throw error;
    console.warn(`[storyboard] 多模态规划失败，降级为文字规划：${error.message}`);
    usedReferenceImages = false;
    response = await post(true, false);
  }
  let raw = await response.text();
  const shouldFallbackToTextPlanning = usedReferenceImages && (
    [400, 413, 422].includes(response.status) || shouldRetryImageStoryboardWithoutReferences(`HTTP ${response.status} ${raw}`)
  );
  if (!response.ok && shouldFallbackToTextPlanning) {
    console.warn(`[storyboard] 多模态规划返回 ${response.status}，降级为文字规划`);
    usedReferenceImages = false;
    response = await post(true, false);
    raw = await response.text();
  }
  if (!response.ok && response.status === 400 && /response_format|json_object/i.test(raw)) {
    response = await post(false, usedReferenceImages);
    raw = await response.text();
  }
  if (!response.ok) throw new Error(`故事板规划模型返回 HTTP ${response.status}: ${raw.slice(0, 600)}`);
  let parsed;
  try {
    const data = JSON.parse(raw);
    parsed = JSON.parse(stripJsonFence(data.choices?.[0]?.message?.content || ""));
  } catch (error) {
    throw new Error(`故事板规划结果不是有效 JSON：${error.message}`);
  }
  const rawBoards = Array.isArray(parsed?.boards) ? parsed.boards : [];
  if (rawBoards.length < boardCount) throw new Error(`故事板规划只返回 ${rawBoards.length} 张，要求 ${boardCount} 张`);
  const boards = rawBoards.slice(0, boardCount).map((board, index) => {
    const normalized = normalizeImageStoryboardBoard(board, index, boardCount);
    return { ...normalized, imagePrompt: imageStoryboardImagePrompt(normalized, boardCount, referencePaths.length > 0) };
  });
  return {
    layout: "3x3",
    durationPerBoard: 15,
    boardCount,
    model,
    boards,
  };
}

function seedancePromptForShot(shot, index, dialogueLanguage) {
  return seedancePromptBlock(shot, index, dialogueLanguage);
}

const ENGLISH_CUE_TRANSLATIONS = [
  ["PROJECT GRAYLIGHT 机密文件夹", "classified PROJECT GRAYLIGHT folder"],
  ["灰化中空牲畜尸体法医特写", "forensic close-up of an ash-gray hollow livestock carcass"],
  ["2005年泛黄档案照片", "yellowed archival photograph from 2005"],
  ["未知号码电话插入镜头", "unknown-number phone call insert"],
  ["2103年新港市地铁列车车厢与隧道", "Newport City metro train carriage and tunnel in 2103"],
  ["暗紫色应急灯下震颤的地铁车厢", "shaking metro carriage under dark purple emergency lights"],
  ["灾变后狼藉血腥的地铁车厢", "bloodied disaster-struck metro carriage after the mutation outbreak"],
  ["Peterson农场牧场围栏清晨", "Peterson farm pasture fence at early morning"],
  ["警长巡逻车内", "inside the sheriff patrol car"],
  ["小镇学校方向", "toward the small-town school"],
  ["伊森·凯恩 Ω核心战甲形态", "Ethan Kane in activated Omega-core black bio-armor form"],
  ["维修工程师伊森·凯恩", "Ethan Kane, maintenance engineer"],
  ["伊森·凯恩", "Ethan Kane"],
  ["上班族乘客", "office worker passenger"],
  ["异化中年男人", "mutating middle-aged male passenger"],
  ["女乘客", "female passenger"],
  ["畸变怪物", "mutated humanoid monster"],
  ["Ω核心激活蓝色能量纹路", "activated Omega core with blue energy veins"],
  ["蓝色能量刃", "blue energy blade"],
  ["设备检修单据", "maintenance inspection paperwork"],
  ["外景", "exterior"],
  ["内景", "interior"],
  ["牧场", "ranch pasture"],
  ["农场", "farm"],
  ["新港市", "Newport City"],
  ["地铁", "metro"],
  ["车厢", "train carriage"],
  ["隧道", "tunnel"],
  ["列车", "train"],
  ["晚高峰", "rush hour"],
  ["晚秋", "late autumn"],
  ["学校", "school"],
  ["巡逻车", "patrol car"],
  ["手套箱", "glove compartment"],
  ["围栏", "fence"],
  ["清晨", "early morning"],
  ["夜晚", "night"],
  ["白天", "daytime"],
  ["黄昏", "dusk"],
  ["灰化", "ash-gray calcified"],
  ["中空", "hollow"],
  ["牲畜", "livestock"],
  ["牛", "cattle"],
  ["尸体", "carcass"],
  ["照片", "photograph"],
  ["文件夹", "folder"],
  ["电话", "phone call"],
  ["手机", "cell phone"],
  ["检修单据", "inspection paperwork"],
  ["生物装甲", "bio-armor"],
  ["战甲", "armor suit"],
  ["能量刃", "energy blade"],
  ["蓝色能量", "blue energy"],
  ["暗紫色", "dark purple"],
  ["频闪", "flickering"],
  ["电流爆破", "electrical blast"],
  ["畸变", "mutated"],
  ["异化", "mutation"],
  ["怪物", "monster"],
  ["利爪", "claws"],
  ["工装", "workwear"],
  ["机油", "machine oil"],
  ["公文包", "briefcase"],
  ["未知号码", "unknown number"],
  ["机密", "classified"],
  ["裂缝", "rift"],
  ["灰蓝光", "gray-blue glow"],
  ["副警长", "deputy sheriff"],
  ["警长", "sheriff"],
  ["博士", "doctor"],
];

function englishCue(value, fallback = "screenplay-derived subject") {
  let text = compactLine(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[·]/g, " ")
    .replace(/[，、]/g, ", ")
    .replace(/[。]/g, ". ")
    .replace(/[：]/g, ": ")
    .replace(/[；]/g, "; ")
    .replace(/[！？]/g, ". ");
  for (const [source, target] of ENGLISH_CUE_TRANSLATIONS) {
    text = text.replace(new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), target);
  }
  text = text.replace(/[\u4e00-\u9fff]+/g, " ");
  text = text.replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function textToImagePrompt(asset) {
  if (asset.textToImagePromptOverride) return withAssetMatchRule(asset.textToImagePromptOverride, asset);
  const object = englishCue(asset.label, asset.type === "Scene" ? "screenplay-derived location" : asset.type === "Character" ? "screenplay character" : "screenplay prop or insert detail");
  const evidence = englishCue(asset.evidence, object);
  const visual = englishCue(asset.visual, "");
  const profile = asset.worldProfile || {};
  const storyWorld = profile.settingPrompt || "screenplay-specific story world";
  const castingRule = profile.humanCastingPrompt || "Casting must follow the screenplay context exactly; do not default to any unrelated ethnicity.";
  const localeRule = profile.sceneLocalePrompt || "The environment must follow the screenplay location exactly; do not add unrelated regional visual defaults.";
  if (asset.type === "Character") {
    return `Text-to-image task: Generate one production-grade character reference asset based on the screenplay-parsed subject "${object}".
Story world: ${storyWorld}.
Screenplay evidence cue: ${evidence}
Parsed visual design cue: ${visual || "use only the screenplay evidence and avoid generic casting"}
Image specification: 16:9 landscape frame, pure white background, one single identity-sheet image containing four views: full-body front view, full-body side view, full-body back view, and one half-body close-up portrait.
Casting and ethnicity rule: ${castingRule}
Character design: infer the character's age range, professional presence, body condition, clothing, hairstyle, facial features, and restrained expression only from the screenplay evidence. Do not create a generic unrelated person.
Rendering style: leave final rendering style to the selected asset style in Pixel Toys. This base prompt describes only identity, costume, materials, layout, and story evidence.
Lighting: premium neutral presentation lighting appropriate to the selected asset style, clear facial identity, readable costume/material details, not overly theatrical.
Composition: clean character turnaround identity-sheet layout; all four views must be complete and visibly the same person, not four different people.
Negative constraints: no readable text, no watermark, no action pose, no dramatic scene background, no extra props, no random decoration, no sunglasses unless explicitly required by the screenplay, no default Chinese or East Asian face unless explicitly written in the screenplay.`;
  }
  if (asset.type === "Scene") {
    return `Text-to-image task: Generate one production-grade environment reference asset based on the screenplay-parsed location "${object}".
Story world: ${storyWorld}.
Screenplay evidence cue: ${evidence}
Parsed visual design cue: ${visual || "use only the screenplay evidence and avoid generic locations"}
Image specification: 16:9 landscape frame, cinematic wide establishing shot or extreme wide establishing shot.
Locale rule: ${localeRule}
Scene design: infer the location, period, time of day, weather, lighting, spatial structure, ground material, background elements, and story-relevant traces only from the screenplay evidence. Do not create a generic unrelated location.
Content rule: absolutely no people, no character silhouettes, no crowds, no human shadows, and no visible human figures. Show environment and space only.
Rendering style: leave final rendering style to the selected asset style in Pixel Toys. This base prompt describes only location identity, spatial structure, materials, light direction, and story evidence.
Composition: wide-angle establishing composition with complete foreground, midground, and background; preserve usable negative space for later character generation and video camera movement. Do not crop into a close-up.
Atmosphere: truthful suspense and pressure implied by the screenplay, without cheap horror filters.
Negative constraints: no people, no human silhouettes, no pure white background, no random readable text, no unrelated animals or vehicles unless explicitly required by the screenplay, no Chinese signage or Chinese metro visual defaults unless explicitly written in the screenplay.`;
  }
  if (asset.type === "Prop") {
    return `Text-to-image task: Generate one production-grade prop reference asset based on the screenplay-parsed subject "${object}".
Story world: ${storyWorld}.
Screenplay evidence cue: ${evidence}
Parsed visual design cue: ${visual || "use only the screenplay evidence and avoid generic props"}
Image specification: 16:9 landscape frame, pure white background, one single prop turnaround sheet containing three views of the exact same prop: front view, side view, and back view.
Subject design: the main subject must be ${object}. Infer material, period, wear, condition, placement, and story meaning only from the screenplay evidence. Do not create a generic unrelated object.
Rendering style: leave final rendering style to the selected asset style in Pixel Toys. This base prompt describes only object identity, material logic, construction, wear, and reference-sheet layout.
Composition: clean prop turnaround layout; all three views must show the same object identity, full object silhouette visible, evenly spaced, no scene background, no hands, no people, no extra objects.
Lighting: premium neutral studio lighting on pure white, clear edges and material detail, not overly theatrical.
Text rule: if readable text is necessary, use only exact text explicitly present in the screenplay; do not invent extra text.
Negative constraints: no watermark, no random logos, no extra people, no hands, no lifestyle scene, no table clutter, no cartoon style, no CG look, no three different props.`;
  }
  return `Text-to-image task: Generate one production-grade insert-shot / evidence-detail reference asset based on the screenplay-parsed subject "${object}".
Story world: ${storyWorld}.
Screenplay evidence cue: ${evidence}
Parsed visual design cue: ${visual || "use only the screenplay evidence and avoid generic insert details"}
Image specification: 16:9 landscape frame, clear insert-shot / evidence-detail reference image.
Subject design: the main subject must be ${object}. Infer material, period, wear, condition, placement, and story meaning only from the screenplay evidence. Do not create a generic unrelated object.
Rendering style: leave final rendering style to the selected asset style in Pixel Toys. This base prompt describes only subject identity, material logic, evidence detail, and composition.
Composition: keep the subject clear and centered for later image-to-video reference; macro forensic evidence composition is allowed, and the relevant detail must be clear.
Lighting: restrained evidence lighting or truthful practical location light, tense suspense atmosphere, not overly theatrical.
Text rule: if readable text is necessary, use only exact text explicitly present in the screenplay; do not invent extra text.
Negative constraints: no watermark, no random logos, no extra people, no cartoon style, no CG look.`;
}

function assetManifestFromAssets({ title, script, worldProfile, assets, analyzerResult, modelName, coverage = null, audit = null }) {
  const byTypeOrder = { Character: 0, Scene: 1, Prop: 2, Insert: 3 };
  const items = assets
    .map((asset, index) => ({
      id: asset.name,
      type: asset.type,
      label: asset.label,
      matchCode: asset.matchCode || assetMatchCode(asset.type, asset.name, index + 1),
      usage:
        asset.type === "Scene"
          ? "只作场景/空间参考"
          : asset.type === "Character"
            ? "只作人物身份参考"
            : asset.type === "Insert"
              ? "只作插入镜头/证据细节参考"
              : "只作道具参考",
      evidence: asset.evidence || "",
      visual: asset.visual || "",
      source: asset.analyzerSource === "model" ? "model" : asset.analyzerSource === "manual" ? "manual" : "rules",
      note: asset.analyzerNote || "",
      textToImagePrompt: textToImagePrompt(asset),
      referenceAssetNames: Array.isArray(asset.referenceAssetNames) ? asset.referenceAssetNames : [],
      generate: asset.generate !== false,
      confirmed: false,
    }))
    .filter(manifestItemCompatibleWithType)
    .sort((a, b) => (byTypeOrder[a.type] ?? 9) - (byTypeOrder[b.type] ?? 9) || a.id.localeCompare(b.id));
  return {
    version: 1,
    title,
    generatedAt: new Date().toISOString(),
    confirmedAt: "",
    confirmed: false,
    worldProfile,
    analyzer: {
      model: analyzerResult?.model || normalizeAssetAnalyzerModel(modelName),
      ok: !!analyzerResult?.ok,
      reason: analyzerResult?.ok ? "" : analyzerResult?.reason || "",
    },
    coverage: coverage || {
      checkedAt: "",
      model: "",
      ok: false,
      reason: "",
      summary: "",
      added: [],
    },
    audit: audit
      ? {
          ok: !!audit.ok,
          pending: audit.pending === true,
          model: compactLine(audit.model || ""),
          checkedCount: Number(audit.checkedCount) || 0,
          flippedCount: Number(audit.flippedCount) || 0,
          flips: Array.isArray(audit.flips) ? audit.flips : [],
          flagged: Array.isArray(audit.flagged)
            ? audit.flagged.map((item) => ({
                label: compactLine(item.label || ""),
                currentType: compactLine(item.currentType || item.type || ""),
                suspectType: compactLine(item.suspectType || item.to || ""),
                confidence: Number(item.confidence) || 0,
                reason: compactLine(item.reason || item.note || ""),
                type: compactLine(item.type || item.currentType || ""),
                note: compactLine(item.note || item.reason || ""),
              }))
            : [],
          reason: compactLine(audit.reason || ""),
        }
      : null,
    counts: {
      characters: items.filter((item) => item.type === "Character").length,
      scenes: items.filter((item) => item.type === "Scene").length,
      props: items.filter((item) => item.type === "Prop").length,
      inserts: items.filter((item) => item.type === "Insert").length,
      total: items.length,
    },
    checklist: [
      "人物是否完整：姓名、身份、年龄/体型、族裔/地域、服装、发型、独特区分点。",
      "场景是否完整：地点、时间、光线、空间结构、地域/年代、剧情痕迹，并且无人物。",
      "道具是否只来自剧本，且 Prop 使用白底三视图，Insert 使用证据/微距特写。",
      "资产 ID 是否包含人物/场景/道具名，避免后续画布连线混淆。",
    ],
    sourceScriptDigest: crypto.createHash("sha1").update(script).digest("hex"),
    items,
  };
}

function readAssetManifest(episodeRoot) {
  const file = findProjectFile(episodeRoot, "assetManifest");
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { file, data };
  } catch {
    return { file, data: null };
  }
}

function normalizeManifestItem(item, index = 0) {
  const type = normalizeAssetType(item?.type || "Prop", "Prop");
  const meta = assetMeta(type);
  const label = compactLine(item?.label || item?.id || `Asset ${index + 1}`);
  const rawId = compactLine(item?.id || "");
  const idIdentity = rawId ? resolveAssetIdentity({ declaredType: type, assetName: rawId }) : null;
  const id = rawId && idIdentity?.valid ? rawId : assetName(meta.prefix, index + 1, label, meta.suffix);
  const matchCode = compactLine(item?.matchCode || assetMatchCode(type, id, index + 1));
  return {
    id,
    type,
    label,
    matchCode,
    usage: compactLine(item?.usage || ""),
    evidence: compactLine(item?.evidence || ""),
    visual: compactLine(item?.visual || ""),
    source: item?.source === "model" ? "model" : item?.source === "manual" ? "manual" : "rules",
    note: compactLine(item?.note || ""),
    textToImagePrompt: String(item?.textToImagePrompt || "").trim().slice(0, 4000),
    referenceAssetNames: [...new Set((Array.isArray(item?.referenceAssetNames) ? item.referenceAssetNames : []).map(compactLine).filter(Boolean))].slice(0, 4),
    generate: item?.generate !== false,
    confirmed: !!item?.confirmed,
  };
}

function manifestItemCompatibleWithType(item) {
  const label = compactLine(item?.label || item?.id || "");
  if (!label) return false;
  if (isNonVisualAudioCueLabel(label)) return false;
  // 人物候选已经由结构化分段 / 模型解析和角色纠偏处理过；这里不能再套用旧的
  // “至少两字”的粗筛，否则昼、绯、阙、砾等合法单字角色会在落盘时被静默删掉。
  // 仍保留地点、音频提示和纯 production 字段的拦截。
  if (item.type === "Character") {
    return isModelAssetLabelUsable(label) && !isLikelyLocationOrTimeLabel(label);
  }
  if (item.type === "Scene") return SCENE_ASSET_EVIDENCE_RE.test(`${label} ${item.evidence || ""} ${item.visual || ""}`) || !isValidCharacterLabel(label) || isLikelyLocationOrTimeLabel(label);
  if (item.type === "Storyboard") return true;
  return true;
}

function sanitizeManifestItems(items = []) {
  const clean = [];
  const seen = new Set();
  for (const item of items) {
    if (!item?.id || !manifestItemCompatibleWithType(item)) continue;
    if (item.type === "Scene" && (isGenericFallbackSceneLabel(item.label) || isGenericFallbackSceneLabel(item.id))) continue;
    const key = `${item.type}:${normalizeAssetMatchText(item.label || item.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(item);
  }
  return clean;
}

function normalizeAssetManifest(raw) {
  const items = Array.isArray(raw?.items) ? sanitizeManifestItems(raw.items.map(normalizeManifestItem)) : [];
  const rawDialogueLanguage = raw?.dialogueLanguage || raw?.production?.dialogueLanguage || "";
  const dialogueLanguage = rawDialogueLanguage ? normalizeDialogueLanguage(rawDialogueLanguage, "en") : "";
  return {
    version: 1,
    title: compactLine(raw?.title || ""),
    generatedAt: raw?.generatedAt || new Date().toISOString(),
    confirmedAt: raw?.confirmedAt || "",
    confirmed: !!raw?.confirmed,
    dialogueLanguage,
    production: {
      ...(raw?.production && typeof raw.production === "object" ? raw.production : {}),
      dialogueLanguage,
    },
    worldProfile: raw?.worldProfile || {},
    analyzer: raw?.analyzer || {},
    coverage: raw?.coverage || {
      checkedAt: "",
      model: "",
      ok: false,
      reason: "",
      summary: "",
      added: [],
    },
    audit: raw?.audit && typeof raw.audit === "object"
      ? {
          ok: !!raw.audit.ok,
          pending: raw.audit.pending === true,
          model: compactLine(raw.audit.model || ""),
          checkedCount: Number(raw.audit.checkedCount) || 0,
          flippedCount: Number(raw.audit.flippedCount) || 0,
          flips: Array.isArray(raw.audit.flips) ? raw.audit.flips : [],
          flagged: Array.isArray(raw.audit.flagged)
            ? raw.audit.flagged.map((item) => ({
                label: compactLine(item.label || ""),
                currentType: compactLine(item.currentType || item.type || ""),
                suspectType: compactLine(item.suspectType || item.to || ""),
                confidence: Number(item.confidence) || 0,
                reason: compactLine(item.reason || item.note || ""),
                type: compactLine(item.type || item.currentType || ""),
                note: compactLine(item.note || item.reason || ""),
              }))
            : [],
          reason: compactLine(raw.audit.reason || ""),
        }
      : null,
    counts: {
      characters: items.filter((item) => item.type === "Character").length,
      scenes: items.filter((item) => item.type === "Scene").length,
      props: items.filter((item) => item.type === "Prop").length,
      inserts: items.filter((item) => item.type === "Insert").length,
      total: items.length,
    },
    checklist: Array.isArray(raw?.checklist) ? raw.checklist : [],
    sourceScriptDigest: raw?.sourceScriptDigest || "",
    items,
  };
}

function updateAssetPromptInManifest(rawManifest, assetName, prompt) {
  const cleanAssetName = compactLine(assetName || "");
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanAssetName) throw new Error("资产名称不能为空");
  if (!cleanPrompt) throw new Error("提示词不能为空");
  if (cleanPrompt.length > 4000) throw new Error("提示词过长，请控制在 4000 字以内");
  const manifest = normalizeAssetManifest(rawManifest || {});
  let found = false;
  const items = manifest.items.map((item) => {
    if (item.id !== cleanAssetName) return item;
    found = true;
    return { ...item, textToImagePrompt: cleanPrompt };
  });
  if (!found) throw new Error("资产不存在");
  return { ...manifest, items };
}

function updateVideoPromptInConfig(rawConfig, shotName, prompt) {
  const name = compactLine(shotName || "");
  const nextPrompt = String(prompt || "").trim();
  if (!name) throw new Error("缺少视频片段");
  if (!nextPrompt) throw new Error("提示词不能为空");
  if (nextPrompt.length > 8000) throw new Error("提示词不能超过 8000 字符");
  const shots = Array.isArray(rawConfig?.shots) ? rawConfig.shots : [];
  const index = shots.findIndex((shot) => compactLine(shot?.name || "") === name);
  if (index < 0) throw new Error("视频片段不存在");
  const nextShots = [...shots];
  nextShots[index] = {
    ...nextShots[index],
    prompt: nextPrompt,
    videoPrompt: nextPrompt,
    promptSource: "manual",
    promptUpdatedAt: new Date().toISOString(),
  };
  return { ...rawConfig, shots: nextShots };
}

function updateVideoModelForShotInConfig(rawConfig, shotName, modelName) {
  const name = compactLine(shotName || "");
  const requestedModel = compactLine(modelName || "");
  const supportedModels = new Set(["seedance-2-0", "seedance-2-0-fast", "seedance-2-0-mini", "seedance-2-0-person-reference", "seedance-2-0-byteplus"]);
  if (!name) throw new Error("缺少视频片段");
  if (!supportedModels.has(requestedModel)) throw new Error("不支持的视频模型");
  const shots = Array.isArray(rawConfig?.shots) ? rawConfig.shots : [];
  const index = shots.findIndex((shot) => compactLine(shot?.name || "") === name);
  if (index < 0) throw new Error("视频片段不存在");
  const nextShots = [...shots];
  nextShots[index] = {
    ...nextShots[index],
    modelOverride: requestedModel,
    modelOverrideUpdatedAt: new Date().toISOString(),
  };
  return { ...rawConfig, shots: nextShots };
}

function manifestItemsToAssets(manifest) {
  return (manifest?.items || []).map((item) => ({
    type: item.type,
    name: item.id,
    label: item.label,
    matchCode: item.matchCode || assetMatchCode(item.type, item.id),
    evidence: item.evidence,
    visual: item.visual,
    worldProfile: manifest.worldProfile || {},
    analyzerSource: item.source,
    analyzerNote: item.note,
    textToImagePromptOverride: item.textToImagePrompt,
    referenceAssetNames: item.referenceAssetNames || [],
    generate: item.generate !== false,
  }));
}

function draftAssetManifestForEpisode(episodeRoot) {
  const localManifest = readAssetManifest(episodeRoot)?.data || {};
  if (Array.isArray(localManifest.items) && localManifest.items.length) return localManifest;

  const projectItems = [];
  const seenKeys = new Set();
  let firstProjectManifest = null;
  for (const projectEpisodeRoot of projectEpisodeRoots(episodeRoot)) {
    const projectManifest = readAssetManifest(projectEpisodeRoot)?.data || {};
    const items = Array.isArray(projectManifest.items) ? projectManifest.items : [];
    if (!items.length) continue;
    if (!firstProjectManifest) firstProjectManifest = projectManifest;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const keys = [
        compactLine(item.id) ? `id:${normalizeAssetMatchText(item.id)}` : "",
        compactLine(item.label) ? `label:${normalizeAssetMatchText(item.label)}` : "",
      ].filter(Boolean);
      if (!keys.length || keys.some((key) => seenKeys.has(key))) continue;
      keys.forEach((key) => seenKeys.add(key));
      projectItems.push(item);
    }
  }
  if (!projectItems.length) return localManifest;
  return { ...(firstProjectManifest || localManifest), items: projectItems };
}

function assetPromptsFromManifest(manifest) {
  const title = manifest.title || "Asset Prompts";
  const assets = manifestItemsToAssets(manifest);
  const characterAssets = assets.filter((asset) => asset.type === "Character");
  const sceneAssets = assets.filter((asset) => asset.type === "Scene");
  const propAssets = assets.filter((asset) => asset.type === "Prop" || asset.type === "Insert");
  const listLine = (asset) => `- ${asset.matchCode || assetMatchCode(asset.type, asset.name)} | ${asset.label} → ${asset.name}`;
  const characterList = characterAssets.length ? characterAssets.map(listLine).join("\n") : "- 剧本中未识别到明确人物。";
  const sceneList = sceneAssets.length ? sceneAssets.map(listLine).join("\n") : "- 剧本中未识别到明确场景。";
  const propList = propAssets.length ? propAssets.map(listLine).join("\n") : "- 剧本中未识别到明确道具或插入镜头资产。";
  const orderedAssets = [
    ...characterAssets,
    ...sceneAssets,
    ...propAssets,
  ];
  const analyzerText = manifest.analyzer?.ok
    ? `已使用资产解析模型 ${manifest.analyzer.model || ""}`
    : `已回退本地规则解析；尝试模型：${manifest.analyzer?.model || "unknown"}；原因：${manifest.analyzer?.reason || "未知"}`;
  const coverageAdded = Array.isArray(manifest.coverage?.added) ? manifest.coverage.added : [];
  const coverageText = manifest.coverage?.checkedAt
    ? manifest.coverage?.ok
      ? `覆盖校验已完成${coverageAdded.length ? `，自动补充 ${coverageAdded.length} 个缺失资产` : "，未发现缺失资产"}`
      : `覆盖校验未完成：${manifest.coverage.reason || "未知原因"}`
    : "覆盖校验尚未运行";
  const sourceText = (asset) =>
    asset.analyzerSource === "manual"
      ? "用户提供资产生图提示词"
      : asset.analyzerSource === "model"
        ? `资产解析模型：${manifest.analyzer?.model || ""}`
        : asset.analyzerNote || "本地规则解析";

  return `# ${title} 资产提示词

## 剧本人物清单

${characterList}

## 剧本场景清单

${sceneList}

## 剧本道具/插入镜头清单

${propList}

## 解析到的资产生成顺序

1. 先生成所有人物资产（Character / C###），用于锁定角色身份、脸、身材、服装和关键外观细节。
2. 再生成所有场景资产（Scene / S###），场景图必须为空景，不得出现人物。
3. 最后生成道具和插入镜头资产（Prop / Insert / P### / I###）。

## 硬性资产规则

- 资产解析确认状态：${manifest.confirmed ? `已确认（${manifest.confirmedAt || "未记录时间"}）` : "未确认"}。
- 资产解析来源：${analyzerText}。
- 资产覆盖校验：${coverageText}。
- 人物资产：C###，16:9，纯白背景，一张图内必须包含全身正面、全身侧面、全身背面、半身特写。
- 人物质感：由界面中的“资产风格”选择决定；只有选择“超写实”时才使用真人电影质感、真实皮肤、毛孔、皱纹、细小瑕疵等写实描述。
- 场景资产：S###，16:9，必须是无人物的全景/大全景环境图，不得出现人影、群众、角色剪影，不得使用纯白背景。
- 场景质感：由界面中的“资产风格”选择决定；只有选择“超写实”时才使用电影场景照/实拍摄影描述，空间信息必须完整并保留后续角色生成可用的留白。
- 命名规则：每个资产名必须包含可识别的人物名称、场景名称、道具名称或插入镜头主体，避免画布连线时混淆。
- 道具资产：P###，16:9，纯白背景，同一道具三视图（正面、侧面、背面），清晰、实拍感、物件主导。
- 插入镜头资产：I###，法医细节、微距、证据特写。
- 严禁混用角色、场景、道具、插入镜头身份。
- 每个资产段落中的“文生图提示词”代码块，才是真正交给 APIKEY.FUN image-gen 的输入。
- 提示词必须来自剧本解析，不得凭空添加剧本没有的人物、地点、怪物、武器或事件。

${orderedAssets
  .map((asset) => {
    if (asset.type === "Character") {
      return `## New Character Asset: ${asset.name}

剧本解析对象：${asset.label}
资产用途：人物身份参考图，用于后续图生视频保持角色一致。
剧本依据：${asset.evidence}
视觉解析：${asset.visual || "使用剧本依据和本地规则生成。"}
解析来源：${sourceText(asset)}
匹配暗号：${asset.matchCode || assetMatchCode(asset.type, asset.name)}（用于故事版和视频提示词绑定，不要求画进资产图）

文生图提示词（英文，提交给生图模型）：
\`\`\`text
${textToImagePrompt(asset)}
\`\`\``;
    }
    if (asset.type === "Scene") {
      return `## New Scene Asset: ${asset.name}

剧本解析对象：${asset.label}
资产用途：场景/空间参考图，只用于环境、光线和空间结构。
剧本依据：${asset.evidence}
视觉解析：${asset.visual || "使用剧本依据和本地规则生成。"}
解析来源：${sourceText(asset)}
匹配暗号：${asset.matchCode || assetMatchCode(asset.type, asset.name)}（用于故事版和视频提示词绑定，不要求画进资产图）

文生图提示词（英文，提交给生图模型）：
\`\`\`text
${textToImagePrompt(asset)}
\`\`\``;
    }
    return `## New ${asset.type} Asset: ${asset.name}

剧本解析对象：${asset.label}
资产用途：特定镜头中的${asset.type === "Insert" ? "插入/证据细节参考" : "道具参考"}。
剧本依据：${asset.evidence}
视觉解析：${asset.visual || "使用剧本依据和本地规则生成。"}
解析来源：${sourceText(asset)}
匹配暗号：${asset.matchCode || assetMatchCode(asset.type, asset.name)}（用于故事版和视频提示词绑定，不要求画进资产图）

文生图提示词（英文，提交给生图模型）：
\`\`\`text
${textToImagePrompt(asset)}
\`\`\``;
  })
  .join("\n\n")}
`;
}

function writeAssetManifest(episodeRoot, manifest) {
  const normalized = normalizeAssetManifest(manifest);
  writeText(findProjectFile(episodeRoot, "assetManifest"), `${JSON.stringify(normalized, null, 2)}\n`);
  writeText(findProjectFile(episodeRoot, "assetPrompts"), assetPromptsFromManifest(normalized));
  return normalized;
}

async function runAssetAuditInBackground(
  episodeRoot,
  { assets = [], script = "", modelName } = {},
) {
  try {
    let audit;
    try {
      audit = await auditAssetRoles({ assets, script, modelName });
    } catch (error) {
      audit = { ok: false, model: "", checkedCount: 0, flippedCount: 0, flips: [], flagged: [], reason: error?.message || String(error) };
      console.error(`[assetAudit] 后台审核异常: ${audit.reason}`);
    }
    const current = readAssetManifest(episodeRoot)?.data;
    if (!current) return null;
    if (!audit.ok) console.error(`[assetAudit] 后台审核未通过: ${audit.reason || "未知原因"}`);
    return writeAssetManifest(episodeRoot, {
      ...current,
      audit: {
        ok: !!audit.ok,
        model: compactLine(audit.model || ""),
        checkedCount: Number(audit.checkedCount) || 0,
        flippedCount: Number(audit.flippedCount) || 0,
        flips: Array.isArray(audit.flips) ? audit.flips : [],
        flagged: Array.isArray(audit.flagged) ? audit.flagged : [],
        reason: compactLine(audit.reason || ""),
        pending: false,
      },
    });
  } catch (error) {
    console.error(`[assetAudit] 后台审核写回异常: ${error?.message || String(error)}`);
    return null;
  }
}

async function extractAssetManifest(episodeRoot, options = {}) {
  const slug = episodeSlug(episodeRoot);
  const rawScript = typeof options.scriptText === "string" ? options.scriptText : readText(findProjectFile(episodeRoot, "script"));
  // 「资产描述」独立输入:传入则落盘;资产解析优先以它为来源(只含人物/场景/道具描述,避免剧情干扰);
  // 没有资产描述时回退用剧情剧本(向后兼容)。剧情剧本仍单独保存,供分镜/节拍使用。
  if (typeof options.assetDescriptionText === "string") writeAssetDescription(episodeRoot, options.assetDescriptionText);
  const assetDescription =
    typeof options.assetDescriptionText === "string" ? options.assetDescriptionText : readAssetDescription(episodeRoot);
  const rawAssetSource = String(assetDescription || "").trim() ? assetDescription : rawScript;
  const plotScript = cleanStoryScriptForDraft(rawScript);
  const script = cleanStoryScriptForDraft(rawAssetSource);
  const assetSourceScript = cleanScriptForDraft(rawAssetSource);
  // 资产描述包含的是视觉事实，不是剧情。模型合并和补漏必须看到未剥离的原文，
  // 否则“人物：… / 场景：… / 道具：…”或手工资产块会在 cleanStoryScriptForDraft 后失去证据。
  const assetAnalysisSource = assetSourceScript || script;
  if (!script.trim() && !plotScript.trim()) throw new Error("script is empty");
  if (typeof options.scriptText === "string") writeScriptWithWorkflowIsolation(episodeRoot, rawScript, "asset extraction script input");
  const dialogueLanguage = persistProjectDialogueLanguage(
    episodeRoot,
    normalizeDialogueLanguage(options.dialogueLanguage || projectDialogueLanguage(episodeRoot), "en"),
  );
  const title = titleFromScript(plotScript || assetSourceScript || script, slug, options.title);
  const worldProfile = inferWorldProfile(assetAnalysisSource);
  const rulePlan = buildRuleAssets(assetAnalysisSource, worldProfile);
  const analyzerResult = await callAssetAnalyzerModel({
    script: assetAnalysisSource,
    fallbackAssets: rulePlan.assets,
    worldProfile,
    modelName: options.assetAnalyzerModel,
  });
  if (!analyzerResult?.ok) {
    throw new Error(`资产解析模型不可用或超时，请重试或检查 API Key。${analyzerResult?.reason || "未知失败原因"}`);
  }
  let assets = correctAssetRolesFromEvidence(mergeAnalyzerAssets(rulePlan.assets, analyzerResult, worldProfile, assetAnalysisSource));
  const coverageResult = await ensureAssetCoverage({
    script: assetAnalysisSource,
    assets,
    shots: [],
    worldProfile,
    modelName: options.assetAnalyzerModel,
  });
  assets = correctAssetRolesFromEvidence(coverageResult.assets);
  const audit = { ok: false, model: "", checkedCount: 0, flippedCount: 0, flips: [], flagged: [], reason: "审核进行中", pending: true };
  const previous = readAssetManifest(episodeRoot)?.data || {};
  const manifest = assetManifestFromAssets({
    title,
    script: assetAnalysisSource,
    worldProfile,
    assets,
    analyzerResult,
    modelName: options.assetAnalyzerModel,
    coverage: coverageResult.coverage,
    audit,
  });
  const staleVideoDerivatives = hasUnboundVideoDerivatives(episodeRoot, manifest);
  const downstreamInvalidated = assetManifestIdentityChanged(previous, manifest) || staleVideoDerivatives;
  const invalidation = downstreamInvalidated ? invalidateDerivedVideoArtifactsForAssetManifestChange(episodeRoot, previous, manifest) : null;
  const normalized = writeAssetManifest(episodeRoot, {
    ...manifest,
    dialogueLanguage,
    production: {
      ...(manifest.production || {}),
      dialogueLanguage,
    },
    generatedAt: new Date().toISOString(),
    confirmed: false,
    confirmedAt: "",
  });
  runAssetAuditInBackground(episodeRoot, {
    assets,
    script: assetAnalysisSource,
    modelName: options.assetAuditModel,
  }).catch((error) => console.error(`[assetAudit] 后台写回异常: ${error?.message || String(error)}`));
  return {
    assetManifest: findProjectFile(episodeRoot, "assetManifest"),
    assetPrompts: findProjectFile(episodeRoot, "assetPrompts"),
    analyzer: normalized.analyzer,
    extracted: {
      characters: normalized.items.filter((item) => item.type === "Character").map((item) => item.label),
      scenes: normalized.items.filter((item) => item.type === "Scene").map((item) => item.label),
    },
    previousConfirmed: !!previous.confirmed,
    downstreamInvalidated,
    staleVideoDerivatives,
    invalidation,
  };
}

async function buildDraft(episodeRoot, options = {}) {
  assertNoBlockingWorkflowJobs(episodeRoot, "重建草稿");
  const slug = episodeSlug(episodeRoot);
  const code = episodeCode(slug);
  const paths = defaultPaths(episodeRoot);
  const rawScript = readText(findProjectFile(episodeRoot, "script"));
  const script = cleanStoryScriptForDraft(rawScript);
  const videoScript = scriptForVideoBeats(script);
  const assetSourceScript = cleanScriptForDraft(rawScript);
  if (!script.trim()) throw new Error("script is empty");
  const dialogueLanguage = options.dialogueLanguage === "zh" ? "zh" : "en";
  persistProjectDialogueLanguage(episodeRoot, dialogueLanguage);
  const dialogueRule =
    dialogueLanguage === "zh"
      ? "中文描述摄影、场景、动作、声音；对白翻译成自然中文，只针对对白部分使用中文。"
      : "中文描述摄影、场景、动作、声音；英文对白逐字保留，只针对对白部分使用英文。";
  const title = titleFromScript(assetSourceScript || script, slug, options.title);
  const worldProfile = inferWorldProfile(assetSourceScript || script);
  const dialogues = parseSpeakerDialogues(videoScript);
  // 分镜草稿只使用「资产提取」的资产，绝不重新解析或覆盖它。资产提取结果可直接进入
  // 分镜模型；确认按钮只是人工校对入口，不能成为草稿生成的隐藏前置条件。
  const sourceAssetManifest = draftAssetManifestForEpisode(episodeRoot);
  if (!(Array.isArray(sourceAssetManifest.items) && sourceAssetManifest.items.length)) {
    throw new Error("本项目还没有可用资产，请先在资产图完成首集资产生成");
  }
  let assets = manifestItemsToAssets(sourceAssetManifest);
  const analyzerResult = { ok: true, model: sourceAssetManifest.analyzer?.model || "资产提取结果" };
  const rawBeats = scriptBeatCandidates(videoScript);
  const continuityBeats = consolidateContinuousBeats(rawBeats);
  const targetShotCount = preferredShotCount(videoScript, continuityBeats);
  const beats = fitBeatsToCountWithoutDuplicateTranslation(continuityBeats, targetShotCount, { dialogueLanguage });
  const durationPlan = planEpisodeDuration({ shotCount: beats.length || targetShotCount, beats });
  const storyboardModelCaller = typeof options.callStoryboardModel === "function" ? options.callStoryboardModel : callStoryboardModel;
  const storyboardModelResult = await storyboardModelCaller({
    script: videoScript,
    assets,
    dialogueLanguage,
    modelName: undefined,
    targetShotCount,
    code,
    beats,
    durationPlan,
  });
  if (!storyboardModelResult.ok) {
    throw new Error(`视频分镜模型不可用或返回不完整设计，请重试。${storyboardModelResult.reason || "未知失败"}`);
  }
  const shots = storyboardModelResult.shots;
  if (!shots.length) throw new Error("视频分镜模型没有返回可用镜头");
  const coverageResult = { assets, coverage: sourceAssetManifest.coverage || {} };
  const modelShotPlanPayload = {
    model: storyboardModelResult.model,
    script: videoScript,
    dialogueLanguage,
    shots,
  };
  const characterAssets = assets.filter((asset) => asset.type === "Character");
  const sceneAssets = assets.filter((asset) => asset.type === "Scene");
  const propAssets = assets.filter((asset) => asset.type === "Prop" || asset.type === "Insert");
  const characters = characterAssets.map((asset) => asset.label);
  const locations = sceneAssets.map((asset) => asset.label);

  const assetTable = assets
    .map((asset) => `| ${asset.name} | ${asset.type} | ${asset.label} | ${asset.type === "Scene" ? "只作场景/空间参考" : asset.type === "Character" ? "只作人物身份参考" : "只作道具/插入镜头参考"} | ${asset.evidence || ""} | ${asset.analyzerSource === "model" ? "模型解析" : "规则兜底"} |`)
    .join("\n");
  const segmentTable = shots
    .map((shot) => `| ${shot.id} | ${shot.duration}s | ${shot.title} | ${shot.refs.join(", ")} | ${shot.beat || ""} |`)
    .join("\n");
  const storyboard = `# ${title} 分镜设计

## 制作规则

- 当前阶段：资产图、分镜提示词、视频配置。视频生成统一在独立画布节点中提交。
- 提示词主体全部使用中文。对白语言模式：${dialogueLanguage === "zh" ? "中文对白" : "英文对白保留"}。
- 默认视频目标：Seedance 2.0 Fast，480p，9:16，image2video，开启声音。
- 视频分镜来源：${storyboardModelResult.model}。每镜导演设计由该模型生成，视频配置只会引用该设计。
- 素材身份必须严格区分：人物图只作人物身份参考，场景图只作环境/空间参考，道具/插入图只作物件或证据细节参考。
- 人物参考图必须是 16:9、纯白背景、全身三视图加半身特写；最终画风由资产图实际选择的风格决定。
- 场景参考图必须是 16:9 无人物全景/大全景环境图；最终画风由资产图实际选择的风格决定。
- 资产文件名必须包含剧本中的人物名、场景名、道具名或插入主体，避免画布连线混淆。
- 本集目标时长：${durationPlan.target}s，在 ${VIDEO_MIN_EPISODE_SECONDS}-${VIDEO_MAX_EPISODE_SECONDS} 秒范围内按剧本复杂度规划。
- 影像风格：待正式资产图生成并绑定后确定；当前只规划镜头语言、构图、动作与节奏，不预设写实或任何画风。

## 剧本人物清单

${characters.length ? characters.map((name) => `- ${name}：${evidenceForTerm(script, name)}`).join("\n") : "- 未识别到明确人物。"}

## 剧本场景清单

${locations.length ? locations.map((location) => `- ${location}：${evidenceForTerm(script, location)}`).join("\n") : "- 未识别到明确场景。"}

## 资产身份表

| 资产 | 类型 | 剧本对象 | 允许用途 | 剧本依据 | 解析来源 |
| --- | --- | --- | --- | --- | --- |
${assetTable}

## 分镜片段列表

计划总时长：${shots.reduce((sum, shot) => sum + shot.duration, 0)}s。

| ID | 时长 | 标题 | 参考资产 | 剧本依据 |
| --- | ---: | --- | --- | --- |
${segmentTable}

## 分镜节拍

${shots.map((shot, index) => `### ${shot.id}

- 时长：${shot.duration}s
- 剧本依据：${shot.beat || "当前剧情节拍"}
- 参考资产：${shot.refs.join(", ") || "无"}
- 景别：${shot.videoDesign.shot_size}
- 摄像机 / 镜头：${shot.videoDesign.camera_lens}
- 运镜：${shot.videoDesign.camera_movement}
- 机位视角：${shot.videoDesign.camera_angle}
- 画面：${shot.videoDesign.visual}
- 人声 OS：${shot.videoDesign.voice_over}
- 人物台词：${shot.dialogues?.length ? seedanceDialogueText(shot) : "无"}
- 音效：${shot.videoDesign.sound}`).join("\n\n")}
`;

  const characterList = characterAssets.length
    ? characterAssets.map((asset) => `- ${asset.label} → ${asset.name}`).join("\n")
    : "- 剧本中未识别到明确人物。";
  const sceneList = sceneAssets.length
    ? sceneAssets.map((asset) => `- ${asset.label} → ${asset.name}`).join("\n")
    : "- 剧本中未识别到明确场景。";
  const propList = propAssets.length
    ? propAssets.map((asset) => `- ${asset.label} → ${asset.name}`).join("\n")
    : "- 剧本中未识别到明确道具或插入镜头资产。";
  const orderedAssets = [
    ...assets.filter((asset) => asset.type === "Character"),
    ...assets.filter((asset) => asset.type === "Scene"),
    ...assets.filter((asset) => asset.type === "Prop" || asset.type === "Insert"),
  ];

  const assetPrompts = `# ${title} 资产提示词

## 剧本人物清单

${characterList}

## 剧本场景清单

${sceneList}

## 剧本道具/插入镜头清单

${propList}

## 解析到的资产生成顺序

1. 先生成所有人物资产（Character / C###），用于锁定角色身份、脸、身材、服装和关键外观细节。
2. 再生成所有场景资产（Scene / S###），场景图必须为空景，不得出现人物。
3. 最后生成道具和插入镜头资产（Prop / Insert / P### / I###）。

## 硬性资产规则

- 资产解析来源：${analyzerResult.ok ? `已使用资产解析模型 ${analyzerResult.model}` : `已回退本地规则解析；尝试模型：${analyzerResult.model || normalizeAssetAnalyzerModel(options.assetAnalyzerModel)}；原因：${analyzerResult.reason || "未知"}`}。
- 人物资产：C###，16:9，纯白背景，一张图内必须包含全身正面、全身侧面、全身背面、半身特写。
- 人物质感：由界面中的“资产风格”选择决定；只有选择“超写实”时才使用真人电影质感、真实皮肤、毛孔、皱纹、细小瑕疵等写实描述。
- 场景资产：S###，16:9，必须是无人物的全景/大全景环境图，不得出现人影、群众、角色剪影，不得使用纯白背景。
- 场景质感：由界面中的“资产风格”选择决定；只有选择“超写实”时才使用电影场景照/实拍摄影描述，空间信息完整，保留可用于后续角色生成的留白。
- 命名规则：每个资产名必须包含可识别的人物名称、场景名称、道具名称或插入镜头主体，避免画布连线时混淆。
- 道具资产：P###，16:9，纯白背景，同一道具三视图（正面、侧面、背面），清晰、实拍感、物件主导。
- 插入镜头资产：I###，法医细节、微距、证据特写。
- 严禁混用角色、场景、道具、插入镜头身份。
- 每个资产段落中的“文生图提示词”代码块，才是真正交给 APIKEY.FUN image-gen 的输入。
- 提示词必须来自剧本解析，不得凭空添加剧本没有的人物、地点、怪物、武器或事件。

${orderedAssets
  .map((asset) => {
    if (asset.type === "Character") {
      return `## New Character Asset: ${asset.name}

剧本解析对象：${asset.label}
资产用途：人物身份参考图，用于后续图生视频保持角色一致。
剧本依据：${asset.evidence}
视觉解析：${asset.visual || "使用剧本依据和本地规则生成。"}
解析来源：${asset.analyzerNote || "本地规则解析"}

文生图提示词（英文，提交给生图模型）：
\`\`\`text
${textToImagePrompt(asset)}
\`\`\``;
    }
    if (asset.type === "Scene") {
      return `## New Scene Asset: ${asset.name}

剧本解析对象：${asset.label}
资产用途：场景/空间参考图，只用于环境、光线和空间结构。
剧本依据：${asset.evidence}
视觉解析：${asset.visual || "使用剧本依据和本地规则生成。"}
解析来源：${asset.analyzerNote || "本地规则解析"}

文生图提示词（英文，提交给生图模型）：
\`\`\`text
${textToImagePrompt(asset)}
\`\`\``;
    }
    return `## New ${asset.type} Asset: ${asset.name}

剧本解析对象：${asset.label}
资产用途：特定镜头中的${asset.type === "Insert" ? "插入/证据细节参考" : "道具参考"}。
剧本依据：${asset.evidence}
视觉解析：${asset.visual || "使用剧本依据和本地规则生成。"}
解析来源：${asset.analyzerNote || "本地规则解析"}

文生图提示词（英文，提交给生图模型）：
\`\`\`text
${textToImagePrompt(asset)}
\`\`\``;
  })
  .join("\n\n")}
`;

  const seedancePrompts = `# ${title} Seedance 2.0 中文视频提示词

## 生成来源

- 视频分镜来源：${storyboardModelResult.model}；视频配置将使用草稿中持久化的模型导演设计。
- 提示词主体使用中文；对白语言模式：${dialogueLanguage === "zh" ? "中文对白" : "英文对白保留"}。

${shots.map((shot, index) => seedancePromptForShot(shot, index, dialogueLanguage)).join("\n\n")}
`;

  const assetManifest = assetManifestFromAssets({
    title,
    script,
    worldProfile,
    assets,
    analyzerResult,
    modelName: options.assetAnalyzerModel,
    coverage: coverageResult.coverage,
  });
  assetManifest.dialogueLanguage = dialogueLanguage;
  assetManifest.production = {
    ...(assetManifest.production || {}),
    dialogueLanguage,
  };
  const finalAssetPrompts = assetPromptsFromManifest(assetManifest);

  assertNoBlockingWorkflowJobs(episodeRoot, "写入新草稿");
  const modelShotPlan = writeStoryboardModelPlan(episodeRoot, modelShotPlanPayload);
  writeText(paths.storyboard, storyboard);
  // 生成视频配置不再写 assetManifest / assetPrompts,避免覆盖「资产提取」的成果
  writeText(paths.seedancePrompts, seedancePrompts);
  resetVideoCanvasBindingForNewDraft(episodeRoot);
  return { storyboard: paths.storyboard, modelShotPlan, assetManifest: paths.assetManifest, assetPrompts: paths.assetPrompts, seedancePrompts: paths.seedancePrompts };
}

function parsePromptSections(markdown) {
  const matches = [...markdown.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    return { name: match[1].trim(), body: markdown.slice(start, end).trim() };
  });
}

function seedancePromptMarkdownFromConfig(config = {}) {
  const shots = Array.isArray(config?.shots) ? config.shots : [];
  if (!shots.length) return "";
  const blocks = shots
    .map((shot, index) => {
      const name = compactLine(shot.name || `V${String(index + 1).padStart(3, "0")}`);
      const prompt = String(shot.prompt || "").trim();
      if (!name || !prompt) return "";
      return `## ${name}\n\n推荐时长：${Math.max(4, Math.min(15, Math.round(Number(shot.duration || 8))))}s\n画幅：9:16 vertical\n参考资产：${(Array.isArray(shot.refs) ? shot.refs : []).join(", ")}\n\n\`\`\`text\n${prompt}\n\`\`\``;
    })
    .filter(Boolean);
  return blocks.length ? `# ${config.episodeSlug || "e01"} Seedance 视频提示词\n\n${blocks.join("\n\n")}\n` : "";
}

function seedancePromptsTextForState(episodeRoot, seedancePath, config = {}) {
  const raw = stripSeedancePromptRules(readText(seedancePath));
  const hasShotSections = parsePromptSections(raw).some(isShotPromptSection);
  if (hasShotSections) return raw;
  const recovered = seedancePromptMarkdownFromConfig({ ...(config || {}), episodeRoot });
  return recovered || raw;
}

function parseAssetsFromPromptNames(markdown) {
  const names = [];
  const re = /^## New (?:Character|Scene|Prop|Insert|Storyboard) Asset:\s+([^\r\n]+?)\s*$/gm;
  for (const match of markdown.matchAll(re)) names.push(match[1]);
  return [...new Set(names)];
}

function filterPromptMarkdownByAssetNames(markdown, selectedNames, types = "Character|Scene|Prop|Insert") {
  const selected = new Set((selectedNames || []).map(compactLine).filter(Boolean));
  if (!selected.size) return markdown;
  const re = new RegExp(`^## New (${types}) Asset:\\s+([^\\r\\n]+?)\\s*$`, "gm");
  const matches = [...String(markdown || "").matchAll(re)];
  if (!matches.length) return markdown;
  const kept = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = compactLine(match[2]);
    if (!selected.has(name)) continue;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    kept.push(markdown.slice(match.index, end).trim());
  }
  if (!kept.length) throw new Error(`资产提示词中找不到选中资产：${[...selected].join("、")}`);
  const intro = String(markdown || "").slice(0, matches[0].index).trim();
  return `${intro}\n\n${kept.join("\n\n")}\n`.trim() + "\n";
}

function filterAssetPromptsMarkdown(markdown, selectedNames) {
  return filterPromptMarkdownByAssetNames(markdown, selectedNames, "Character|Scene|Prop|Insert");
}

function filterStoryboardPromptsMarkdown(markdown, selectedNames) {
  return filterPromptMarkdownByAssetNames(markdown, selectedNames, "Storyboard");
}

function partialAssetPromptsPath(episodeRoot, promptsPath, selectedNames) {
  const selected = [...new Set((selectedNames || []).map(compactLine).filter(Boolean))];
  if (!selected.length) return promptsPath;
  const dir = path.join(episodeRoot, "03_asset_prompts", ".partial");
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash("sha1").update(selected.join("\n")).digest("hex").slice(0, 12);
  const file = path.join(dir, `${episodeSlug(episodeRoot)}_asset_prompts_${hash}.md`);
  writeText(file, filterAssetPromptsMarkdown(readText(promptsPath), selected));
  return file;
}

function storyboardPanelGuideText(panels = [], dialogueLanguage = "en") {
  const list = Array.isArray(panels) && panels.length ? panels : defaultStoryboardPanels();
  const language = normalizeDialogueLanguage(dialogueLanguage, "en");
  return list
    .slice(0, STORYBOARD_MAX_PANELS)
    .map((panel) => {
      const label = panel.label || `P${panel.panel || "?"}`;
      const timeRange = panel.timeRange || storyboardTimeRangeLabel(panel.startSecond || 0, panel.endSecond || (panel.startSecond || 0) + (panel.duration || 1));
      const anchors = Array.isArray(panel.assetAnchors || panel.refs) && (panel.assetAnchors || panel.refs).length ? ` Asset anchors: ${(panel.assetAnchors || panel.refs).join(", ")}.` : "";
      const production = panel.production || storyboardProductionTabForPanel(panel.role, {
        title: panel.title,
        description: panel.description,
        dialogue: panel.dialogue,
        action: panel.actionArrow,
        camera: panel.cameraFrame,
        continuity: [panel.continuityEntry, panel.continuityExit].filter(Boolean).join(" "),
      });
      const dialogue = panel.dialogue?.text
        ? language === "zh"
          ? `${compactLine(panel.dialogue.speaker || "角色")}：“${panel.dialogue.text}”。本面板嘴型、表情、眼神和动作必须与这句对白同步。`
          : production.dialogue
        : production.dialogue;
      return [
        `${label} (${timeRange}, ${panel.duration || ""}s) PRODUCTION TAB — Visual: ${production.visual}; Camera: ${production.camera}; Shot: ${production.shot}; Lens: ${production.lens}; Lighting: ${production.lighting}; Emotion: ${production.emotion}; Dialogue: ${dialogue}; Action: ${production.action}; Continuity: ${production.continuity}.${anchors}`,
      ].join(" ");
    })
    .join("\n");
}

function storyboardPanelPromptLine(panel = {}, dialogueLanguage = "en") {
  const language = normalizeDialogueLanguage(dialogueLanguage, "en");
  const label = panel.label || `P${panel.panel || "?"}`;
  const timeRange = panel.timeRange || storyboardTimeRangeLabel(panel.startSecond || 0, panel.endSecond || (panel.startSecond || 0) + (panel.duration || 1));
  const production = panel.production || storyboardProductionTabForPanel(panel.role, {
    title: panel.title,
    description: panel.description,
    dialogue: panel.dialogue,
    action: panel.actionArrow,
    camera: panel.cameraFrame,
    continuity: [panel.continuityEntry, panel.continuityExit].filter(Boolean).join(" "),
  });
  const dialogue = panel.dialogue?.text
    ? language === "zh"
      ? `对白：${compactLine(panel.dialogue.speaker || "角色")}：“${compactLine(panel.dialogue.text)}”`
      : `Dialogue: ${compactLine(panel.dialogue.speaker || "Character")}: "${compactLine(panel.dialogue.text)}"`
    : production.dialogue;
  return `${label} ${timeRange}: visual=${production.visual}; camera=${production.camera}; shot=${production.shot}; lens=${production.lens}; lighting=${production.lighting}; emotion=${production.emotion}; dialogue=${dialogue}; action=${production.action}; continuity=${production.continuity}.`;
}

function storyboardPanelPromptText(panels = [], dialogueLanguage = "en") {
  const list = Array.isArray(panels) && panels.length ? panels : defaultStoryboardPanels();
  return list.slice(0, STORYBOARD_MAX_PANELS).map((panel) => storyboardPanelPromptLine(panel, dialogueLanguage)).join("\n");
}

function compactStoryboardRefs(refs = []) {
  return [...new Set((Array.isArray(refs) ? refs : []).map(compactLine).filter(Boolean))]
    .slice(0, 8)
    .join("; ");
}

function storyboardPromptForSlot(slot) {
  const shots = (slot.sourceShotNames || []).join(", ") || "current story beat";
  const refs = compactStoryboardRefs(slot.refs || []) || "use screenplay context only";
  const beat = compactLine(slot.beatSummary || slot.label || slot.id);
  const timeRange = `${slot.startSecond || 0}-${slot.endSecond || slot.duration || PRODUCTION_BOARD_MAX_SECONDS}s`;
  const dialogueLanguage = normalizeDialogueLanguage(slot.dialogueLanguage || "", "en");
  const panelGuide = storyboardPanelPromptText(slot.panels || [], dialogueLanguage);
  const panelCount = Math.max(
    STORYBOARD_MIN_PANELS,
    Math.min(STORYBOARD_MAX_PANELS, (slot.panels || []).length || STORYBOARD_MAX_PANELS),
  );
  const rows = storyboardBoardRows(panelCount);
  const gridLabel = `${STORYBOARD_BOARD_COLUMNS}x${rows}`; // 固定 3x3
  const dialogueRule =
    dialogueLanguage === "zh"
      ? "Dialogue language: Chinese only. The final deterministic Production Tab must typeset every dialogue line in Chinese; do not make the image model invent speech bubbles or handwritten dialogue."
      : "Dialogue language: English only. The final deterministic Production Tab must typeset every dialogue line in English; do not make the image model invent speech bubbles or handwritten dialogue.";
  // 整张 Production Board 就是 3×3 网格。P1 承担建立空间，但不能额外占据一条大建立镜头。
  // 角色、场景、道具直接从引用资产生成到面板画面中，视频阶段仅提交这张板。
  return [
    "Create ONE 9:16 vertical (portrait) professional film storyboard sheet — clearly taller than wide, matching the final vertical 9:16 short-drama video. Full sheet visible, no cropping.",
    `The complete sheet is one edge-to-edge ${gridLabel} grid of exactly ${panelCount} equal-size storyboard panels, read left-to-right then top-to-bottom (P1 top-left through P${panelCount} bottom-right). Every panel outer boundary has the same portrait 9:16 proportion, with uniform narrow gutters.`,
    "P1 is the establishing composition, but it must occupy exactly one ordinary top-left grid cell. No panel may span multiple rows or columns.",
    "Do not draw a separate establishing strip, full-width image, top header, footer, sequence summary band, or any other content outside the nine equal panels.",
    "Every panel has an integrated lower Production Tab. Reserve its lower 40 percent as clean off-white paper with no generated lettering: a deterministic post-process will typeset P-number, duration, full plot/action, full dialogue, Visual / Camera / Shot / Lens / Lighting / Emotion, and visible identity anchors there. Use the upper 60 percent as the cinematic frame, with a portrait vertical 9:16 composition, leaving no important face, product, action, or location detail in the lower reserved area. Do not make the image model render its own production copy, speech bubbles, tables, or technical notes; this prevents glyph errors while preserving the full readable document.",
    "Render every panel as a cinematic production still using the actual referenced Character, Scene, Prop, and Insert assets. The same actual character face, hairstyle, wardrobe, body type, scene architecture, prop shape, materials, palette, and lighting identity from those references must visibly appear in the panels. This is a true visual storyboard, NOT hand-drawn sketches, NOT silhouettes, NOT stick figures, NOT flat icons, and NOT a contact sheet of the source images.",
    "Cinematic composition with clear foreground / midground / background and correct vertical 9:16 framing in every panel; each upper frame is a true standing-phone-screen vertical camera view.",
    "Keep characters and locations visually identical across every panel. The panel image itself must carry the final identity, material, color, texture and lighting information from the official references, so it can later serve as the only submitted video reference.",
    "Do NOT draw literal blue/red diagram arrows, camera rectangles, asset-reference strips, thumbnails or PT-code boxes in the generated artwork — the deterministic Production Tab adds the visible identity references and readable production information after generation. Draw a clean cinematic Production Board, not a technical markup diagram.",
    `Every panel must use a distinct shot scale and camera angle per the plan below — do not repeat the same drawing. Time coverage ${timeRange}; sequence duration ${slot.duration || PRODUCTION_BOARD_MAX_SECONDS}s.`,
    `Source shots: ${shots}.`,
    `Scene / story beat: ${beat || "cinematic story progression from the screenplay."}`,
    `Characters and assets to keep consistent (do not invent new characters): ${refs}.`,
    dialogueRule,
    "Per-panel plan — follow exactly, one panel each, in order:",
    panelGuide,
    "Preserve every supplied full plot/action and dialogue word for the deterministic Production Tab. No watermark, no random glyphs, no unrelated text, no invented dialogue.",
  ].join("\n");
}

function storyboardPromptsMarkdown(episodeRoot, slots) {
  const title = projectSummary(episodeRoot).title || "Storyboard";
  const dialogueLanguage = projectDialogueLanguage(episodeRoot, "en");
  const body = (slots || [])
    .map((slot) => `## New Storyboard Asset: ${slot.id}

剧情覆盖：${slot.label}
时长：${slot.duration || PRODUCTION_BOARD_MAX_SECONDS}s（单张 Production Board 最多 ${PRODUCTION_BOARD_MAX_SECONDS}s；最终视频片段仍最多 ${VIDEO_MAX_SECONDS}s）
来源镜头：${(slot.sourceShotNames || []).join(", ") || "未记录"}
剧情摘要：${slot.beatSummary || "根据剧本和分镜提示词自动拆解。"}
参考资产：${(slot.refs || []).join(", ") || "无"}
视频引用方式：${slot.videoReferenceGuide || "作为唯一视频图片参考：直接继承板内已锁定的人物身份、场景、道具、构图、站位、镜头方向、动作节奏和剪辑出口。"}

分镜格说明：
${storyboardPanelGuideText(slot.panels || [], slot.dialogueLanguage || dialogueLanguage)
  .split("\n")
  .map((line) => `- ${line}`)
  .join("\n")}

文生图提示词（英文，提交给生图模型）：
\`\`\`text
${storyboardPromptForSlot({ ...slot, dialogueLanguage: slot.dialogueLanguage || dialogueLanguage })}
\`\`\``)
    .join("\n\n");
  return `# ${title} Production Board 提示词

## 规则

- Production Board 定位为「专业影视故事板文档」竖版 9:16 工作纸(与最终竖屏视频一致),整张只由标准 3×3 九个等大竖格组成,从左到右、从上到下阅读;禁止顶部信息栏、底部总结栏。每格上 60% 是电影级竖版画面，下 40% 是后处理写入的可读 Production Tab：镜号、时长、完整剧情动作、完整对白、Visual/Camera/Shot/Lens/Lighting/Emotion 必须保留；由确定性排版输出，避免模型文字乱码。
- 分镜格是**由正式资产图驱动的电影级真实镜头画面**:角色脸、发型、服装、体型、场景结构、道具外观、材质、颜色和光线必须继承引用资产;禁止粗剪影、火柴人、扁平图标和黑白速写。每格构图/景别/机位各异,按弧线展开(建立→站位→转折/高潮→反应→剪辑点),不得各格重复同一张图。
- 这张 Production Board 是视频阶段的唯一图片参考，正式资产图只在本板生成阶段使用。每格 Production Tab 显示该镜头的**可见身份参考**（人物三视图、产品、场景缩略图），作为角色、产品和布景连续性的可见锚点；不要让模型自行画蓝红箭头、镜头框或乱码技术标注。
- 每张 Production Board 最多覆盖 ${PRODUCTION_BOARD_MAX_SECONDS} 秒连续场景段落;最终视频片段仍按 ${VIDEO_MIN_SECONDS}-${VIDEO_MAX_SECONDS} 秒拆分。
- Production Board 对白语言必须跟随剧本解析阶段设置:${dialogueLanguage === "zh" ? "中文对白" : "英文对白"},不得中英混用。
- 后处理把结构化制作指引完整排版进每格 Production Tab 并传递给视频生成；画面区与文字区分层，既不遮挡关键构图，也不会产生乱码。

${body}
`;
}

function storyboardPromptsPath(episodeRoot, slots, selectedNames = []) {
  const dir = path.join(episodeRoot, "03_asset_prompts", ".storyboards");
  fs.mkdirSync(dir, { recursive: true });
  const selected = [...new Set((selectedNames || []).map(compactLine).filter(Boolean))];
  const markdown = storyboardPromptsMarkdown(episodeRoot, slots);
  const hashSource = selected.length ? selected.join("\n") : (slots || []).map((slot) => slot.id).join("\n");
  const hash = crypto.createHash("sha1").update(hashSource || "all").digest("hex").slice(0, 12);
  const file = path.join(dir, `${episodeSlug(episodeRoot)}_storyboard_prompts_${hash}.md`);
  writeText(file, selected.length ? filterStoryboardPromptsMarkdown(markdown, selected) : markdown);
  return file;
}

const ASSET_IMAGE_STYLE_PRESETS = {
  photoreal: {
    label: "超写实",
    prompt: [
      "Ultra-realistic live-action cinematic photography, natural human proportions, authentic real-world materials,",
      "hyper-detailed skin texture, pores, hair, fabric fibers, realistic reflections,",
      "physically plausible practical lighting, natural color grading, documentary-level realism,",
      "shot on Arri Alexa, 85mm lens, shallow depth of field, sharp focus, high detail.",
      "Style anchors: live-action photography, natural proportions, real materials, cinematic camera optics, realistic skin texture.",
    ].join(" "),
  },
  cg_3d: {
    label: "3D 渲染 / CG 质感",
    prompt: "3D rendered game character style.",
  },
  pixar_3d: {
    label: "皮克斯 / 迪士尼 3D",
    prompt: [
      "Pixar-style and Disney-style 3D render, soft rounded character design, oversized expressive eyes,",
      "subsurface scattering skin, warm cinematic lighting, gentle global illumination,",
      "appealing stylized proportions, smooth subsurface materials, shallow depth of field,",
      "high detail, family-friendly, rendered in RenderMan, 8k.",
      "Style anchors: subsurface scattering, oversized expressive eyes, soft global illumination, appealing proportions.",
    ].join(" "),
  },
  ghibli_miyazaki: {
    label: "宫崎骏 / 吉卜力",
    prompt: [
      "Studio Ghibli and Miyazaki-inspired 2D animation aesthetic, hand-painted watercolor background, soft natural lighting,",
      "lush detailed scenery, gentle pastel color palette, nostalgic atmosphere,",
      "fluffy clouds, anime cel character on painterly background, warm and serene.",
      "Style anchors: hand-painted watercolor, lush scenery, pastel palette, nostalgic atmosphere, painterly background.",
    ].join(" "),
  },
  retro_american_cel: {
    label: "复古美式赛璐璐",
    prompt: [
      "Retro American cel animation, 1980s-1990s cartoon style, bold black ink outlines,",
      "flat cel-shaded colors, limited color palette, vintage print grain,",
      "halftone texture, hand-inked lines, saturated retro tones,",
      "Saturday-morning cartoon aesthetic, screen-printed look.",
      "Style anchors: bold ink outlines, flat cel-shaded colors, halftone texture, print grain, limited palette, vintage.",
    ].join(" "),
  },
  american_bold_toon: {
    label: "美式粗线条",
    prompt: [
      "3D toon-rendered animation still, stylized cartoon shading, clean cel-shaded look,",
      "soft global illumination with hard-edged toon shadows, subtle outline / line art on characters,",
      "Pixar-meets-Rick-and-Morty proportions, exaggerated but clean character design,",
      "low-saturation silver-white environment, tech-blue accent lighting,",
      "matte finish, smooth surfaces, shallow depth of field,",
      "vertical 9:16 composition, subject centered upper-two-thirds, clean negative space at bottom,",
      "high detail on face and hands, modern clean lab/apartment setting,",
      "cinematic but bright lighting, no photorealism",
    ].join(" "),
  },
  modern_anime_cel: {
    label: "日式动漫赛璐璐",
    prompt: [
      "Modern anime cel shading, clean lineart, two-tone flat shading,",
      "vibrant saturated colors, sharp highlights, glossy hair rendering,",
      "detailed anime eyes, Kyoto Animation style, crisp digital cel look,",
      "soft rim light, 2D animation key visual.",
      "Style anchors: two-tone flat shading, clean lineart, detailed anime eyes, soft rim light.",
    ].join(" "),
  },
  american_painterly: {
    label: "美式厚涂插画",
    prompt: [
      "Painterly digital illustration, thick brushstrokes, semi-realistic stylized rendering,",
      "dramatic cinematic lighting, rich color grading, dynamic composition,",
      "concept art quality, Blizzard and Riot Games splash art style,",
      "detailed rendering, epic atmosphere, ArtStation trending.",
      "Style anchors: thick brushstrokes, semi-realistic stylized rendering, splash art, cinematic lighting.",
    ].join(" "),
  },
  claymation: {
    label: "定格动画 / 黏土",
    prompt: [
      "Stop-motion claymation style, handcrafted clay figures, visible fingerprint texture,",
      "miniature set, tactile felt and fabric materials, soft practical lighting,",
      "shallow depth of field, Laika studio aesthetic, slight imperfections,",
      "tilt-shift macro, physical puppet look.",
      "Style anchors: handcrafted clay, fingerprint texture, miniature set, tactile materials.",
    ].join(" "),
  },
  chinese_ink: {
    label: "水墨 / 国风",
    prompt: [
      "Traditional Chinese ink wash painting, sumi-e, flowing brushwork,",
      "ink splash and gradient washes, abundant negative space, minimalist composition,",
      "rice paper texture, monochrome black ink with subtle accent color,",
      "elegant and poetic, shan shui landscape aesthetic.",
      "Style anchors: ink wash, negative space, rice paper texture, flowing brushwork.",
    ].join(" "),
  },
  pixel_art: {
    label: "复古像素",
    prompt: [
      "Pixel art, 16-bit retro game style, limited color palette, crisp pixel grid,",
      "dithering shading, sprite art, isometric or side-scroller view,",
      "nostalgic SNES aesthetic, clean pixel clusters, no anti-aliasing.",
      "Style anchors: 16-bit, limited palette, dithering, crisp pixel grid, no anti-aliasing.",
    ].join(" "),
  },
  custom: {
    label: "自定义",
    prompt: "Use the user-specified custom visual style exactly as the primary art-direction layer.",
  },
};

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
  return ASSET_IMAGE_STYLE_PRESETS[key] ? key : "cg_3d";
}

function assetStyleFromBody(body = {}) {
  const preset = normalizeAssetStylePreset(body.assetStylePreset || "cg_3d");
  const custom = compactLine(body.assetStyleCustom || "").replace(/```+/g, "'''").slice(0, 700);
  return {
    preset,
    custom,
    label: ASSET_IMAGE_STYLE_PRESETS[preset].label,
    prompt: ASSET_IMAGE_STYLE_PRESETS[preset].prompt,
  };
}

function videoStylePresetFromProductionAssets(productionAssets = [], body = {}) {
  const assetPreset = (productionAssets || []).map((asset) => compactLine(asset?.assetStylePreset || "")).find(Boolean);
  if (assetPreset) return normalizeAssetStylePreset(assetPreset);
  const mode = compactLine(body.videoStyleMode || "").toLowerCase();
  const manualPreset = compactLine(body.videoStylePreset || body.assetStylePreset || "");
  return mode === "manual" && manualPreset ? normalizeAssetStylePreset(manualPreset) : "";
}

function assetStyleNeedsOverride(style) {
  return !!style?.preset;
}

function assetStyleDirective(style) {
  const custom = style.custom
    ? `\nUser custom style note: ${style.custom}\nIf the note is not English, interpret it as visual art direction and preserve its meaning.`
    : "";
  const lines = [
    `Selected visual style, the only active renderer: ${style.prompt}${custom}`,
    "Compatible quality add-ons: highly detailed, sharp focus, masterpiece; use resolution, lighting, and camera cues only when they fit the selected style.",
    "Universal negative prompt: blurry, lowres, bad anatomy, extra fingers, watermark, text, jpeg artifacts.",
  ];
  if (style.preset === "photoreal") {
    lines.push(
      "Photoreal permission: because the selected style is 超写实, live-action cinematic photography, realistic skin texture, visible pores, wrinkles, hair detail, fabric fibers, real-world material detail, and camera optics are allowed and should be used when relevant.",
      "Photoreal negative (critical): the image must NOT look like a 3D render, CGI, 3D game character, Pixar/Disney 3D, cartoon, anime, cel shading, illustration, concept art, digital painting, or any stylized art. No plastic, waxy, glossy, or smooth CG skin; no 3D-model turnaround/T-pose render look; no rendered-shader surfaces. It must read as authentic real-world photographs of real subjects with genuine photographic skin, fabric, and lighting.",
    );
  } else {
    lines.push(
      `Style lock: render only in ${style.label}. Use this selected art direction as the sole renderer for characters, scenes, props, materials, lighting, and surfaces.`,
    );
  }
  lines.push(
    "Style firewall: ignore any legacy rendering-style wording that appears in older asset text. Use old text only for identity, costume, props, setting, era, mood, and story evidence.",
    "Preserve all asset identity details, type-specific layouts, 16:9 format, character/prop white-background rules, scene no-people rules, readable-text limits, and safety constraints.",
    "Do not copy any protected character, studio, logo, brand, or existing IP.",
  );
  return lines.join("\n");
}

function assetLayoutContract(assetType) {
  if (assetType === "Character") {
    return [
      "Layout contract: 16:9 landscape frame, pure white background.",
      "Create one character identity-sheet image containing full-body front view, full-body side view, full-body back view, and one half-body close-up portrait.",
      "All views must clearly be the same single character with consistent face, body, hair, clothing, and key props.",
    ].join(" ");
  }
  if (assetType === "Scene") {
    return [
      "Layout contract: 16:9 landscape frame, wide establishing or extreme-wide establishing environment image.",
      "Show complete foreground, midground, and background with usable negative space for later character placement.",
      "No people, no human silhouettes, no crowds, no human shadows, and no visible human figures.",
    ].join(" ");
  }
  if (assetType === "Prop") {
    return [
      "Layout contract: 16:9 landscape frame, pure white background.",
      "Create one prop turnaround sheet containing front view, side view, and back view of the same single prop.",
      "Show the full object silhouette clearly, evenly spaced, with no hands, no scene background, and no extra unrelated objects.",
    ].join(" ");
  }
  return [
    "Layout contract: 16:9 landscape frame.",
    "Create one clear insert-shot or evidence-detail reference image with the main subject centered and readable as a production reference.",
    "Keep the subject identity precise and avoid turning it into a full scene unless the asset itself is a scene.",
  ].join(" ");
}

function assetNegativeContract(assetType) {
  const common = "Negative constraints: no watermark, no random logos, no random readable text, no JPEG artifacts, no unrelated decorative graphic design.";
  if (assetType === "Character") {
    return `${common} No extra people, no action pose, no dramatic scene background, no unrelated props, no sunglasses unless explicitly required, no default Chinese or East Asian face unless explicitly written in the screenplay.`;
  }
  if (assetType === "Scene") {
    return `${common} No people, no human silhouettes, no crowds, no human shadows, no pure white background, no unrelated animals or vehicles unless explicitly required, no Chinese signage or Chinese regional defaults unless explicitly written in the screenplay.`;
  }
  if (assetType === "Prop") {
    return `${common} No extra people, no hands, no lifestyle scene, no table clutter, no three different props, no invented readable text.`;
  }
  return `${common} No extra people, no unrelated props, no invented readable text.`;
}

function styleFinalLock(style) {
  if (style.preset === "photoreal") {
    return "Final style lock: the final image must read as ultra-realistic live-action cinematic photography with authentic real-world materials and natural camera optics — a real photograph, absolutely not a 3D render, CGI, game-character render, or any stylized/cartoon/illustration look.";
  }
  if (style.preset === "cg_3d") {
    return "Final CG style lock: keep the image in 3D rendered game character style, then follow the asset identity, costume, materials, silhouette, and story-specific details.";
  }
  if (style.preset === "american_bold_toon") {
    return "Final style lock: the final image must be a non-photoreal 3D toon-rendered animation still with stylized cartoon shading, clean cel-shaded look, subtle outline line art, and exaggerated clean character design.";
  }
  return `Final style lock: the final image must visibly follow ${style.label} as the only renderer.`;
}

const LEGACY_STYLE_LINE_RE = /^(?:Global visual style override|Selected visual style|Universal quality|Compatible quality|Universal lighting|Universal camera|Universal negative|Style priority|Style firewall|Preserve all asset|Do not copy|Final .*?style lock|Final CG style lock|Rendering style|Realism|Lighting and camera|Atmosphere|Required specification|Negative constraints|Image specification|Casting and ethnicity rule|Locale rule|Character design|Scene design|Subject design|Content rule|Composition|Text rule)\s*:/i;
const LEGACY_STYLE_CLAUSE_RE = /(?:\b(?:ultra[-\s]?realistic|hyper[-\s]?realistic|hyper[-\s]?detailed|photoreal(?:istic)?|photo[-\s]?real(?:ism)?|live[-\s]?action|real[-\s]?person|real\s+human|documentary|practical photography|photography|arri|alexa|imax|85mm|depth of field|camera optics|studio lighting|cinematic(?:\s+\w+)?\s+lighting|lighting\b|soft rim light|golden hour|volumetric|ray[-\s]?traced|global illumination|subsurface|pbr|octane|unreal|blender|renderman|render(?:ed|er|ing)?|shader|cg\b|3d animation|semi[-\s]?realistic style|realistic skin|skin texture|skin pores|pores|visible pores|realistic fabric|fabric weave|fabric texture|realistic materials|physically believable|physically plausible|masterpiece|8k|ultra detailed|sharp focus|style anchors|style\b|aesthetic\b|anime\b|cel\b|cartoon\b|watercolor|painterly|pixel art|claymation|concept art|artstation|pixar|disney|ghibli|miyazaki|kyoto animation|riot games|blizzard|natural skin tone|anatomically natural|wrinkles|subtle scars|subtle blemishes|moist eye reflections|clear facial identity|sharp but not plastic|illustration look|material detail|restrained color grade)\b|(?:3D\s*动画|3D\s*渲染|CG\s*质感|半写实|超写实|写实|真人|电影质感|实拍感|赛璐璐|像素|水墨|厚涂|定格动画|黏土|吉卜力|宫崎骏|皮克斯|迪士尼|风格|动画角色设计))/i;

function legacyStyleFreeIdentityText(prompt, style = null) {
  const source = String(prompt || "")
    .replace(/```(?:text|txt|markdown|md)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "\n")
    .replace(/\bRequired specification:[\s\S]*$/i, "")
    .replace(/\bNegative constraints:[\s\S]*$/i, "");
  const clauseRe = isPhotorealAssetStyle(style)
    ? /(?:\b(?:style anchors|style\b|aesthetic\b|anime\b|cel\b|cartoon\b|watercolor|painterly|pixel art|claymation|concept art|artstation|pixar|disney|ghibli|miyazaki|kyoto animation|riot games|blizzard|illustration look|cg\b|3d animation|octane|unreal|blender|renderman|shader)\b|(?:3D\s*动画|3D\s*渲染|CG\s*质感|赛璐璐|像素|水墨|厚涂|定格动画|黏土|吉卜力|宫崎骏|皮克斯|迪士尼|风格|动画角色设计))/i
    : LEGACY_STYLE_CLAUSE_RE;
  const lines = source
    .split(/\n+/)
    .map((line) => compactLine(line))
    .filter(Boolean)
    .filter((line) => !LEGACY_STYLE_LINE_RE.test(line));
  const clauses = lines
    .join(", ")
    .split(/\s*,\s*/)
    .map((clause) => compactLine(clause))
    .filter(Boolean)
    .filter((clause) => !clauseRe.test(clause));
  const deduped = [];
  for (const clause of clauses) {
    const key = clause.toLowerCase();
    if (!deduped.some((item) => item.toLowerCase() === key)) deduped.push(clause);
  }
  return deduped.join(", ").replace(/\s+/g, " ").trim().slice(0, 4500);
}

function compileAssetPromptForStyle(prompt, style, assetType = "", assetName = "") {
  const type = normalizeAssetType(assetType, "Prop");
  const identity = legacyStyleFreeIdentityText(prompt, style) || "Use the screenplay-parsed asset identity and visual evidence from this asset section.";
  return [
    assetStyleDirective(style),
    `Target asset: ${assetName || "current asset"}. Asset type: ${type}.`,
    "Legacy style firewall: the identity source below may come from older prompts. Treat all rendering-style terms in that source as inactive metadata. Only preserve subject identity, costume, props, materials as story objects, setting, era, composition intent, and narrative evidence.",
    `Asset identity source: ${identity}`,
    assetLayoutContract(type),
    assetNegativeContract(type),
    styleFinalLock(style),
  ].join("\n\n");
}

function cleanAssetPromptForStyle(prompt, style) {
  let result = String(prompt || "").trim();
  if (!style?.preset || style.preset === "photoreal") return result;
  const renderingLine = "Rendering style: follow the Global visual style override above as the primary visual renderer while preserving the asset identity, physical clarity, and required reference-sheet layout.";
  result = result
    .replace(/Realism:\s*ultra-realistic live-action cinematic reference image,[^\n]*\n?/gi, `${renderingLine}\n`)
    .replace(/Realism:\s*ultra-realistic live-action cinematic location still,[^\n]*\n?/gi, `${renderingLine}\n`)
    .replace(/Realism:\s*ultra-realistic practical photography,[^\n]*\n?/gi, `${renderingLine}\n`)
    .replace(/Lighting and camera:\s*([^\n]*?)no illustration look,\s*no CG look\./gi, "Lighting and camera: $1style-consistent rendered finish, no cheap plastic look.")
    .replace(/,\s*no plastic CG look/gi, "")
    .replace(/,\s*no CG look/gi, "");
  result = result
    .replace(/,\s*no cartoon style/gi, "")
    .replace(/,\s*no illustration look/gi, "");
  if (style.preset === "cg_3d") {
    result = result
      .replace(/\bultra[-\s]?realistic live[-\s]?action production still\b/gi, "cinematic 3D CG environment render")
      .replace(/\bultra[-\s]?realistic live[-\s]?action\b/gi, "cinematic 3D CG")
      .replace(/\blive[-\s]?action\b/gi, "3D CG")
      .replace(/\bpractical photography\b/gi, "CG render")
      .replace(/\bphotorealistic\b/gi, "high-quality 3D CG")
      .replace(/\bultra[-\s]?realistic skin texture\b/gi, "high-detail stylized CG skin shader")
      .replace(/\brealistic skin texture\b/gi, "stylized CG skin material")
      .replace(/\bdetailed skin texture\b/gi, "detailed CG skin shader")
      .replace(/\bhyper[-\s]?detailed skin texture\b/gi, "high-detail CG skin shader")
      .replace(/\bvisible pores\b/gi, "subtle stylized CG skin surface detail")
      .replace(/\bsemi[-\s]?realistic style\b/gi, "stylized 3D animation style")
      .replace(/\brealistic fabric folds\b/gi, "modeled fabric folds with CG cloth shading")
      .replace(/\brealistic materials and reflections\b/gi, "game-character materials and rendered reflections")
      .replace(/\brealistic materials\b/gi, "game-character materials")
      .replace(/\bphysically believable materials\b/gi, "game-character materials")
      .replace(/\bauthentic real-world materials\b/gi, "game-character materials")
      .replace(/\breal[-\s]?person photo texture\b/gi, "non-photographic CG character texture")
      .replace(/\bdocumentary camera realism\b/gi, "cinematic CG camera language")
      .replace(/\bshot on Arri Alexa\b/gi, "rendered with a cinematic virtual camera");
    result += "\n\nFinal CG style lock: keep the image in 3D rendered game character style, then follow the asset identity, costume, materials, silhouette, and story-specific details.";
  } else {
    result = result
      .replace(/\bultra[-\s]?realistic live[-\s]?action production still\b/gi, "style-consistent production reference image")
      .replace(/\bultra[-\s]?realistic live[-\s]?action\b/gi, "style-consistent")
      .replace(/\bphotorealistic\b/gi, "style-consistent")
      .replace(/\bultra[-\s]?realistic skin texture\b/gi, "style-consistent character surface detail")
      .replace(/\brealistic skin texture\b/gi, "style-consistent character surface detail")
      .replace(/\bdetailed skin texture\b/gi, "style-consistent character surface detail")
      .replace(/\brealistic fabric folds\b/gi, "style-consistent fabric shapes")
      .replace(/\brealistic materials\b/gi, "style-consistent materials")
      .replace(/\bphysically believable materials\b/gi, "style-consistent materials");
    result += "\n\nFinal style lock: the final image must follow the selected visual style above as the only renderer.";
  }
  return result.replace(/\s+,/g, ",").replace(/,\s*\./g, ".").replace(/\n{3,}/g, "\n\n");
}

function applyAssetStyleToMarkdown(markdown, style) {
  if (!assetStyleNeedsOverride(style)) return markdown;
  let count = 0;
  const sectionStyled = String(markdown || "").replace(
    /(^## New (Character|Scene|Prop|Insert) Asset:\s+([^\r\n]+)[\s\S]*?文生图提示词[^\n]*：\s*\n```text\s*\n)([\s\S]*?)(\n```)/gm,
    (_, prefix, assetType, assetName, prompt, suffix) => {
      count += 1;
      return `${prefix}${compileAssetPromptForStyle(prompt, style, assetType, compactLine(assetName))}\n${suffix}`;
    },
  );
  if (count) return sectionStyled;
  const directive = assetStyleDirective(style).trim();
  return String(markdown || "").replace(/(```text\s*\n)([\s\S]*?)(\n```)/g, (_, prefix, prompt, suffix) => {
    count += 1;
    return `${prefix}${directive}\n\n${cleanAssetPromptForStyle(prompt, style)}\n${suffix}`;
  });
}

function styledAssetPromptsPath(episodeRoot, promptsPath, style) {
  if (!assetStyleNeedsOverride(style)) return promptsPath;
  const dir = path.join(episodeRoot, "03_asset_prompts", ".partial");
  fs.mkdirSync(dir, { recursive: true });
  const source = readText(promptsPath);
  const styled = applyAssetStyleToMarkdown(source, style);
  const hash = crypto
    .createHash("sha1")
    .update([promptsPath, style.preset, style.custom, styled].join("\n"))
    .digest("hex")
    .slice(0, 12);
  const file = path.join(dir, `${episodeSlug(episodeRoot)}_asset_style_${style.preset}_${hash}.md`);
  writeText(file, styled);
  return file;
}

function refsFromPromptSection(section, referenceNames, assetLookup = null) {
  const known = new Set(referenceNames);
  const refs = [];
  const push = (name) => {
    const clean = compactLine(name).replace(/[，,、]+$/g, "");
    if (known.has(clean) && !refs.includes(clean)) refs.push(clean);
  };
  const explicit = section.body.match(/^参考资产[:：]\s*(.+)$/m);
  if (explicit) {
    for (const item of explicit[1].split(/[，,、]/)) push(item);
  }
  if (!refs.length) {
    referenceNames
      .map((name) => ({ name, at: section.body.indexOf(name) }))
      .filter((item) => item.at >= 0)
      .sort((a, b) => a.at - b.at)
      .forEach((item) => push(item.name));
  }
  if (!refs.length) {
    const scene = referenceNames.find((name) => (assetLookup?.get?.(name)?.manifestType || inferAssetTypeFromName(name)) === "Scene");
    const character = referenceNames.find((name) => (assetLookup?.get?.(name)?.manifestType || inferAssetTypeFromName(name)) === "Character");
    if (scene) push(scene);
    if (character) push(character);
  }
  return refs.slice(0, 8);
}

function validateShotRefs(refs, assetLookup) {
  const valid = [];
  const warnings = [];
  for (const ref of refs || []) {
    const clean = compactLine(ref);
    const asset = assetLookup.get(clean);
    if (!asset) {
      warnings.push(`未知参考资产：${clean}`);
      continue;
    }
    if (asset.invalid || asset.conflicts?.length) {
      warnings.push(`${clean} 类型冲突：${(asset.conflicts || []).join("；")}`);
      continue;
    }
    if (!valid.includes(clean)) valid.push(clean);
  }
  return { refs: valid.slice(0, 8), warnings };
}

function sceneRefForShotRefs(refs, assetLookup) {
  return (refs || []).find((ref) => assetLookup.get(ref)?.manifestType === "Scene") || "";
}

function shotsShareSceneContinuity(currentShot, previousShot, assetLookup) {
  const currentScene = sceneRefForShotRefs(currentShot?.refs || [], assetLookup);
  const previousScene = sceneRefForShotRefs(previousShot?.refs || [], assetLookup);
  if (!currentScene || !previousScene) return false;
  if (currentScene === previousScene) return true;
  const currentLabel = assetLookup.get(currentScene)?.label || currentScene;
  const previousLabel = assetLookup.get(previousScene)?.label || previousScene;
  return sceneLabelsSameForContinuity(currentLabel, previousLabel);
}

function tailFrameContinuityDecision(currentShot, previousShot, assetLookup) {
  const sameScene = shotsShareSceneContinuity(currentShot, previousShot, assetLookup);
  if (!sameScene) {
    return { useTailFrame: false, sharedScene: false, reason: "换场或场景资产不同：使用正常切镜" };
  }
  const purpose = compactLine(currentShot?.shotPurpose || currentShot?.cinematicDesign?.shotPurpose || "");
  if (["establish", "insert", "dialogue_reaction", "over_shoulder", "close_reaction"].includes(purpose)) {
    return { useTailFrame: false, sharedScene: true, reason: `同场景但当前镜头是 ${purpose}：使用正常切镜，不使用尾帧` };
  }
  const currentBeat = compactLine(currentShot?.beat || currentShot?.prompt || currentShot?.title || "");
  const previousBeat = compactLine(previousShot?.beat || previousShot?.prompt || previousShot?.title || "");
  if (hasHardCutCue(currentBeat)) {
    return { useTailFrame: false, sharedScene: true, reason: "同场景但属于切镜/转场/节奏重置：不使用尾帧" };
  }
  if (purpose === "action_continuation" && hasContinuationCue(currentBeat)) {
    return { useTailFrame: true, sharedScene: true, reason: "同场景且文字明确承接上一动作/状态：使用上一片段尾帧" };
  }
  const previousStages = activeContinuityStages(previousBeat);
  const currentStages = activeContinuityStages(currentBeat);
  const overlap = [...currentStages].filter((stage) => previousStages.has(stage));
  if ((purpose === "action_continuation" || hasContinuationCue(currentBeat)) && overlap.length && !classifyBeatStages(currentBeat).has("establishing")) {
    return { useTailFrame: true, sharedScene: true, reason: `同场景且连续危机/动作状态延续（${overlap.join(", ")}）：使用上一片段尾帧` };
  }
  return { useTailFrame: false, sharedScene: true, reason: "同场景但不是直接动作连续：使用正常切镜，不使用尾帧" };
}

async function buildVideoConfig(episodeRoot, body = {}) {
  const rawScript = readText(findProjectFile(episodeRoot, "script"));
  const script = scriptForVideoBeats(cleanStoryScriptForDraft(rawScript));
  if (!script.trim()) throw new Error("剧本为空，无法生成视频配置。");
  const currentConfig = readVideoConfig(episodeRoot)?.data || {};
  const currentManifest = readAssetManifest(episodeRoot)?.data || {};
  const requestedDialogueLanguage = normalizeDialogueLanguage(
    body.dialogueLanguage || currentConfig.dialogueLanguage || currentConfig.settings?.dialogueLanguage || currentManifest.dialogueLanguage || currentManifest.production?.dialogueLanguage || "",
    projectDialogueLanguage(episodeRoot, "en"),
  );
  // 7 月 23 日前创建的项目没有持久化模型导演计划。这里按当前剧本补建，
  // 仍由相同的大模型输出完整设计，不会从旧 Markdown 或手写提示词反推。
  const modelPlan = await ensureModelShotPlanForConfig(episodeRoot, {
    script,
    dialogueLanguage: requestedDialogueLanguage,
    assetAnalyzerModel: body.assetAnalyzerModel,
  });
  const slug = episodeSlug(episodeRoot);
  const configPath = findProjectFile(episodeRoot, "config");
  const promptPath = findProjectFile(episodeRoot, "seedancePrompts");
  const workflow = ensureWorkflowNamespace(episodeRoot, "build video config");
  const runNamespace = normalizeRunNamespace(body.runNamespace || workflow.currentNamespace) || createRunNamespace("pt");
  if (runNamespace !== workflow.currentNamespace) {
    writeWorkflowState(episodeRoot, {
      ...workflow,
      currentNamespace: runNamespace,
      createdAt: new Date().toISOString(),
      reason: "body supplied run namespace",
    });
  }
  let previous = {};
  if (fs.existsSync(configPath)) {
    try {
      previous = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      previous = {};
    }
  }
  const previousHadIsolation = !!configRunNamespace(previous);
  const previousMatchesCurrentIsolation = previousHadIsolation && configHasCurrentIsolationFingerprint(episodeRoot, previous);
  const runStart = currentRunStartMs(episodeRoot, { ...previous, runNamespace, runNamespaceCreatedAt: workflow.createdAt });
  let manifest = normalizeAssetManifest(readAssetManifest(episodeRoot)?.data || {});
  const manifestNames = (manifest.items || []).map((item) => item.id);
  const plannedAssetNames = manifestNames.length ? manifestNames : parseAssetsFromPromptNames(readText(findProjectFile(episodeRoot, "assetPrompts")));
  const plannedSet = new Set(plannedAssetNames);
  const scannedAssets = scanAssets(episodeRoot);
  const promptMode = compactLine(body.promptMode || body.videoGenerationMode || body.mode || "").toLowerCase();
  const storyboardsActive =
    promptMode === "production_board" ||
    promptMode === "storyboard" ||
    body.enableStoryboards === true ||
    body.storyboardsEnabled === true ||
    body.storyboardWorkflow === "enabled";
  const videoPromptMode = storyboardsActive ? "production_board" : "prompt";
  const projectProductionAssets = projectProductionAssetsForState(episodeRoot, manifest, { minModifiedAt: runStart });
  const actualAssets = projectProductionAssets.filter((asset) => asset.manifestType !== "Storyboard" && (!plannedSet.size || plannedSet.has(asset.assetName)));
  const actualStoryboards = storyboardsActive
    ? currentStoryboardAssetsForWorkflow(scannedAssets, {
        configData: previous,
        minModifiedAt: runStart,
      })
    : [];
  const rejectedAssets = actualAssets.filter((asset) => asset.invalid || asset.conflicts?.length);
  const historicalAssetBindings = collectHistoricalAssetLibraryBindings(episodeRoot, previous);
  const productionAssets = applyAssetLibraryBindingsToRecords(
    actualAssets
    .filter((asset) => !asset.invalid && !asset.conflicts?.length)
    .map((asset, index) => assetRecordFromMedia(asset, manifest, index))
      .filter(Boolean),
    historicalAssetBindings,
  );
  const storyboardRecords = actualStoryboards
    .filter((asset) => !asset.invalid && !asset.conflicts?.length)
    .map((asset, index) => {
      const record = assetRecordFromMedia(asset, manifest, productionAssets.length + index);
      return record ? { ...record, role: "storyboard_reference" } : null;
    })
    .filter(Boolean);
  const assets = storyboardsActive ? [...productionAssets, ...storyboardRecords] : productionAssets;
  const assetNames = productionAssets.map((asset) => asset.name);
  const assetLookup = new Map(productionAssets.map((asset) => [asset.name, asset]));
  // 视频风格只能继承已生成并实际绑定的正式资产。素材缺失时保留为空，避免把规划阶段
  // 误锁为超写实；只有显式 manual 模式才允许在未绑定资产时由请求指定风格。
  const videoStylePreset = videoStylePresetFromProductionAssets(productionAssets, body);
  const dialogueLanguage = modelPlanDialogueLanguageForConfig(modelPlan, script, requestedDialogueLanguage);
  persistProjectDialogueLanguage(episodeRoot, dialogueLanguage);
  const { shots: modelShots } = modelShotPlanForConfig({
    episodeRoot,
    modelPlan,
    script,
    dialogueLanguage,
    assets: productionAssets,
    videoStylePreset,
  });
  const referenceWarnings = [];
  const shots = modelShots.map((shot, index) => ({
    ...shot,
    prompt: cleanVideoPromptForSubmission(seedancePromptForShotMode(shot, index, dialogueLanguage, storyboardsActive)),
  }));
  const allowTailFrameContinuity =
    videoPromptMode === "production_board"
      ? false
      : body.tailFrameContinuity === true
        ? true
        : body.tailFrameContinuity === false || previous.settings?.tailFrameContinuity === false
          ? false
          : true;
  const storyboardSlots = storyboardsActive
    ? storyboardSlotsForState(episodeRoot, manifest, actualStoryboards, { segments: storyboardSegmentsFromShots(shots, dialogueLanguage) })
    : [];
  const storyboardByShot = new Map();
  const storyboardByName = new Map(storyboardSlots.map((slot) => [slot.id, slot]));
  for (const slot of storyboardSlots) {
    for (const shotName of slot.sourceShotNames || []) {
      storyboardByShot.set(shotName, slot);
    }
  }
  shots.forEach((shot, index) => {
    const storyboardSlot = storyboardByShot.get(shot.name) || null;
    const storyboardRef = storyboardSlot?.asset?.assetName || "";
    shot.storyboardRefs = storyboardRef ? [storyboardRef] : [];
    if (storyboardSlot) {
      const panelsForShot = (storyboardSlot.panels || []).filter((panel) => {
        const names = panel.sourceShotNames || [];
        return !names.length || names.includes(shot.name);
      });
      const panels = panelsForShot.length ? panelsForShot : storyboardSlot.panels || [];
      if (storyboardRef) shot.prompt = removeTailFrameContinuityFromStoryboardPrompt(shot.prompt);
      const assetBinding = storyboardAssetBindingForShot(shot, assetLookup);
      const panelAssetBindings = buildStoryboardPanelAssetBindings({ shot, panels, assetLookup });
      const storyboardWarnings = storyboardAssetBindingWarnings(shot, assetBinding);
      if (storyboardWarnings.length) referenceWarnings.push(...storyboardWarnings);
      shot.storyboardGuidance = {
        storyboardId: storyboardSlot.id,
        referenceAssetName: storyboardRef || "",
        timeRange: storyboardTimeRangeLabel(storyboardSlot.startSecond || 0, storyboardSlot.endSecond || (storyboardSlot.startSecond || 0) + (storyboardSlot.duration || 0)),
        duration: storyboardSlot.duration || 0,
        usage: storyboardSlot.videoReferenceGuide || "",
        assetBinding,
        panelAssetBindings,
        panels: panels.map((panel) => ({
          panel: panel.panel,
          label: panel.label,
          timeRange: panel.timeRange,
          duration: panel.duration,
          description: panel.description,
          dialogue: panel.dialogue || null,
          production: panel.production || storyboardProductionTabForPanel(panel.role, {
            title: panel.title,
            description: panel.description,
            dialogue: panel.dialogue,
            action: panel.actionArrow,
            camera: panel.cameraFrame,
            continuity: [panel.continuityEntry, panel.continuityExit].filter(Boolean).join(" "),
          }),
          actionArrow: panel.actionArrow,
          cameraFrame: panel.cameraFrame,
          continuityExit: panel.continuityExit,
          assetAnchors: panel.assetAnchors || panel.refs || [],
          videoUse: panel.videoUse,
        })),
        promptMode: "production_board",
        policy:
          "Use the Production Board as the sole submitted image reference. Each numbered panel already contains the bound Character, Scene, Prop, and Insert identity, materials, colors, lighting, blocking, camera direction, shot rhythm, and cut structure. Do not expect extra asset images.",
      };
      shot.prompt = storyboardSeedancePrompt(shot, index, dialogueLanguage);
    }
  });
  const storyboardsAttached = storyboardsActive && storyboardRecords.length > 0;
  shots.forEach((shot, index) => {
    const continuityDecision =
      index > 0
        ? tailFrameContinuityDecision(shot, shots[index - 1], assetLookup)
        : { useTailFrame: false, sharedScene: false, reason: "第一段视频：无上一片段尾帧" };
    const usesStoryboardReference = videoPromptMode === "production_board" && Array.isArray(shot.storyboardRefs) && shot.storyboardRefs.length > 0;
    shot.continuityDecision = continuityDecision;
    shot.sharedSceneContinuity = !!continuityDecision.sharedScene;
    shot.videoPromptMode = videoPromptMode;
    shot.useTailFrame = videoPromptMode === "prompt" && allowTailFrameContinuity && continuityDecision.useTailFrame;
    if (videoPromptMode === "production_board") {
      shot.useTailFrame = false;
      delete shot.tailFrameSource;
      delete shot.startFrameUrl;
    }
    if (shot.useTailFrame) {
      shot.tailFrameSource = shots[index - 1].name;
      shot.continuityNote = continuityDecision.reason;
    } else {
      delete shot.tailFrameSource;
      if (usesStoryboardReference) {
        shot.continuityNote = "已启用 Production Board 唯一参考：使用板面中已锁定的 9:16 画面、人物、场景、道具与剪辑出口保持连贯";
      } else if (!allowTailFrameContinuity && continuityDecision.sharedScene) {
        shot.continuityNote = "尾帧续接已关闭：同场景片段使用正常切镜";
      } else if (continuityDecision.reason) {
        shot.continuityNote = continuityDecision.reason;
      }
    }
  });
  const shotsWithoutRefs = shots.filter((shot) => !shot.refs.length);
  if (shotsWithoutRefs.length) throw new Error(`视频配置引用校验失败：${shotsWithoutRefs.map((shot) => shot.name).join("、")} 缺少有效参考资产`);
  referenceWarnings.push(...shotOverlapWarnings(shots));
  const config = {
    groupName:
      body.groupName ||
      (previousMatchesCurrentIsolation && normalizeRunNamespace(previous.runNamespace) === runNamespace && !isGenericGroupName(previous.groupName, episodeRoot) ? previous.groupName : "") ||
      isolatedDefaultGroupName(episodeRoot, runNamespace),
    ...isolationMetadataFor(episodeRoot, {
      ...workflow,
      currentNamespace: runNamespace,
      createdAt: workflow.currentNamespace === runNamespace ? workflow.createdAt || new Date().toISOString() : new Date().toISOString(),
    }),
    isolatedFromLegacy: !previousHadIsolation,
    promptsPath: path.relative(episodeRoot, promptPath),
    modelName: normalizeVideoConfigModelName(body.modelName || previous.modelName || DEFAULT_VIDEO_CONFIG_MODEL),
    modelAliases: previous.modelAliases || [DEFAULT_VIDEO_CONFIG_MODEL],
    dialogueLanguage,
    settings: {
      ratio: body.ratio || previous.settings?.ratio || "9:16",
      resolution: body.resolution || previous.settings?.resolution || "480p",
      dialogueLanguage,
      enableSound: previous.settings?.enableSound || "on",
      count: Number(previous.settings?.count || 1),
      search_enabled: Number(previous.settings?.search_enabled || 0),
      autoCompliance: Number(previous.settings?.autoCompliance ?? 1),
      tailFrameContinuity: allowTailFrameContinuity,
      enableStoryboards: storyboardsActive,
      promptMode: videoPromptMode,
      storyboardWorkflowExplicit: storyboardsActive,
      storyboardDisablesTailFrameContinuity: false,
      modeType: previous.settings?.modeType || "image2video",
    },
    assets,
    storyboardPlans: storyboardSlots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      referenceAssetName: slot.asset?.assetName || "",
      timeRange: storyboardTimeRangeLabel(slot.startSecond || 0, slot.endSecond || (slot.startSecond || 0) + (slot.duration || 0)),
      duration: slot.duration || 0,
      maxDuration: slot.maxDuration || STORYBOARD_MAX_SECONDS,
      sourceShotNames: slot.sourceShotNames || [],
      refs: slot.refs || [],
      beatSummary: slot.beatSummary || "",
      videoReferenceGuide: slot.videoReferenceGuide || "",
      panels: slot.panels || [],
    })),
    storyboardReferences: storyboardRecords.map((asset) => ({
      name: asset.name,
      file: asset.file,
      type: asset.manifestType,
      use: asset.use,
      plan: storyboardByName.get(asset.name)
        ? {
            timeRange: storyboardTimeRangeLabel(storyboardByName.get(asset.name).startSecond || 0, storyboardByName.get(asset.name).endSecond || 0),
            duration: storyboardByName.get(asset.name).duration || 0,
            sourceShotNames: storyboardByName.get(asset.name).sourceShotNames || [],
          }
        : null,
    })),
    storyboardPolicy: {
      mode: videoPromptMode === "production_board" ? "production_board_reference" : "prompt_tail_frame",
      instruction: storyboardsAttached
        ? "Use each Production Board as the sole submitted image reference: nine vertical 9:16 numbered panels in a 3-column grid inside a 9:16 vertical board. Read composition, blocking, camera direction, shot rhythm, cut structure, and the actual character, scene, prop, material, color, lighting, and visual style already rendered into the panels. Do not expect separate Character, Scene, Prop, or Insert images during video generation."
        : "Storyboard files are preserved but inactive for the current production flow. Generate videos from Seedance prompts and use previous-shot tail frames only for true continuous action or state carryover.",
      assetBindingInstruction:
        "Before Production Board generation, bind each panel to the shot's official Scene, Character, Prop, and Insert assets and render their actual identity into the panel. Character slots such as 主角A/角色B define panel position only. After the board is generated, submit only the board to video generation; do not attach the source asset images.",
      defaultShotContinuity: storyboardsAttached
        ? "production_board_controls_panel_continuity"
        : allowTailFrameContinuity
          ? "tail_frame_only_for_true_action_or_state_continuity"
          : "hard_cut_between_segments_when_disabled",
    },
    shots,
    missingAssets: plannedAssetNames.filter((name) => !assetNames.includes(name)),
    rejectedAssets: rejectedAssets.map((asset) => ({ name: asset.assetName, rel: asset.rel, conflicts: asset.conflicts || [] })),
    referenceWarnings,
    configReady: assets.length > 0,
    workflowGuide: {
      phase: "next_story",
      completedAt: new Date().toISOString(),
    },
  };
  const resetVideoState = resetVideoGenerationStateForNewConfig(episodeRoot, config);
  config.resetVideoState = resetVideoState;
  writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { configPath, config };
}

function clearVideoArtifactsForNewCanvas(episodeRoot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawDir = path.join(episodeRoot, "06_videos", "raw");
  const assetUploadDir = path.join(episodeRoot, VIDEO_ASSET_UPLOAD_DIR);
  const nodeDir = path.join(episodeRoot, VIDEO_TASK_DIR);
  const tailDir = path.join(episodeRoot, "09_tail_frames");
  const tailUploadDir = path.join(episodeRoot, "10_tail_frame_uploads");
  const singleConfigDir = path.join(workDirForEpisode(episodeRoot), "single_shot_configs");
  const archiveRoot = path.join(episodeRoot, "06_videos", "canvas_reset_archive", stamp);
  const archive = (dir, predicate) => {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      if (!fs.statSync(full).isFile()) continue;
      if (!predicate(file)) continue;
      const rel = path.relative(episodeRoot, full).replace(/^(\.\.[/\\])+/, "");
      const target = path.join(archiveRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.renameSync(full, target);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        fs.copyFileSync(full, target);
        fs.unlinkSync(full);
      }
      count += 1;
    }
    return count;
  };
  const archived = {
    rawVideos: archive(rawDir, (file) => /\.mp4$/i.test(file)),
    assetUploads: archive(assetUploadDir, (file) => /\.json$/i.test(file)),
    taskSnapshots: archive(nodeDir, (file) => /\.(json|txt)$/i.test(file)),
    tailFrames: archive(tailDir, (file) => /\.(png|jpe?g|webp)$/i.test(file)),
    tailUploads: archive(tailUploadDir, (file) => /\.json$/i.test(file)),
    singleConfigs: archive(singleConfigDir, (file) => /\.json$/i.test(file)),
  };
  return {
    stamp,
    archiveDir: archiveRoot,
    archived,
  };
}

function appendJobLog(job, chunk) {
  job.logs += chunk;
  if (job.logs.length > 240000) job.logs = job.logs.slice(-240000);
  if (job.logPath) {
    fs.mkdirSync(path.dirname(job.logPath), { recursive: true });
    fs.appendFileSync(job.logPath, chunk, "utf8");
  }
  persistJob(job);
}

const AUTO_RETRYABLE_ASSET_FAILURE_CATEGORIES = new Set(["gateway", "gateway-timeout", "gateway-network", "stream", "ratelimit"]);
const AUTO_RETRYABLE_ASSET_JOB_TYPES = new Set(["assets", "asset-regenerate", "asset-edit", "storyboards", "storyboard-regenerate"]);
const AUTO_RETRYABLE_ASSET_JOB_MAX_ATTEMPTS = 2;

function shouldAutoRetryTransientAssetJob(job) {
  if (!AUTO_RETRYABLE_ASSET_JOB_TYPES.has(job?.type)) return false;
  const targetAssetNames = Array.isArray(job?.targetAssetNames) ? job.targetAssetNames.filter(Boolean) : [];
  if (targetAssetNames.length !== 1) return false;
  if (Number(job?.autoRetryAttempt || 0) >= AUTO_RETRYABLE_ASSET_JOB_MAX_ATTEMPTS) return false;
  const failures = Array.isArray(job?.failureDetails) ? job.failureDetails : [];
  return failures.length > 0 && failures.every((failure) => AUTO_RETRYABLE_ASSET_FAILURE_CATEGORIES.has(failure.category));
}

function startProcessJob({ episodeRoot, type, command, args, cwd, meta = {} }) {
  const id = crypto.randomUUID();
  const jobDir = jobsDirForEpisode(episodeRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runNamespace = normalizeRunNamespace(meta.runNamespace || currentRunNamespace(episodeRoot));
  const job = {
    id,
    type,
    status: "running",
    episodeRoot,
    runNamespace,
    isolationVersion: 1,
    command: [command, ...args].join(" "),
    startedAt: new Date().toISOString(),
    finishedAt: "",
    exitCode: null,
    logs: "",
    metaPath: path.join(jobDir, `${stamp}_${type}_${id}.json`),
    logPath: path.join(jobDir, `${stamp}_${type}_${id}.log`),
    ...meta,
  };
  jobs.set(id, job);
  persistJob(job);
  const childEnv = {
    ...process.env,
    PATH: [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      process.env.PATH || "",
    ]
      .filter(Boolean)
      .join(":"),
    OPENAI_API_KEY: imageApiKey() || process.env.OPENAI_API_KEY || "",
    PIXEL_TOYS_RUN_NAMESPACE: runNamespace,
    PIXEL_TOYS_ASSET_STYLE_PRESET: compactLine(meta.assetStylePreset || ""),
    PIXEL_TOYS_ASSET_STYLE_LABEL: compactLine(meta.assetStyleLabel || ""),
  };
  const launch = () => {
    const child = spawn(command, args, { cwd: cwd || episodeRoot, env: childEnv });
    jobChildren.set(id, child);
    child.stdout.on("data", (chunk) => appendJobLog(job, chunk.toString()));
    child.stderr.on("data", (chunk) => appendJobLog(job, chunk.toString()));
    child.on("error", (error) => {
      job.status = "failed";
      job.exitCode = job.exitCode == null ? -1 : job.exitCode;
      job.finishedAt = new Date().toISOString();
      job.failureReason = job.failureReason || `进程无法启动：${compactLine(error.message)}`;
      appendJobLog(job, `\n进程启动失败：${error.message}\n`);
      persistJob(job);
    });
    child.on("close", (code) => {
      jobChildren.delete(id);
      job.exitCode = code;
      job.status = job.status === "canceled" ? "canceled" : code === 0 ? "complete" : "failed";
      job.finishedAt = new Date().toISOString();
      if (job.status === "failed" && !job.failureReason) {
        job.failureReason = jobFailureReason(job);
      }
      // 失败（或部分成功但有资产失败）时，从磁盘 .failed.json 回填真实原因，避免"只记到 generating 就断"的静默失败。
      try {
        enrichJobWithAssetFailures(job);
      } catch (err) {
        appendJobLog(job, `\n（回填失败原因时出错：${compactLine(err.message)}）\n`);
      }
      if (job.status === "failed" && shouldAutoRetryTransientAssetJob(job)) {
        const attempt = Number(job.autoRetryAttempt || 0) + 1;
        const delayMs = 15_000 * attempt;
        const retryAt = new Date(Date.now() + delayMs).toISOString();
        job.autoRetryAttempt = attempt;
        job.autoRetryAt = retryAt;
        job.failureReason = `上游临时故障，正在自动重试（${attempt}/${AUTO_RETRYABLE_ASSET_JOB_MAX_ATTEMPTS}）`;
        job.status = "running";
        appendJobLog(job, `\n上游临时故障，正在自动重试（${attempt}/${AUTO_RETRYABLE_ASSET_JOB_MAX_ATTEMPTS}），将在 ${Math.round(delayMs / 1000)} 秒后继续。\n`);
        setTimeout(() => {
          if (job.status !== "running" || job.autoRetryAt !== retryAt) return;
          job.autoRetryAt = "";
          job.failureReason = "";
          job.failureDetails = [];
          appendJobLog(job, `\n开始第 ${attempt} 次自动重试。\n`);
          launch();
        }, delayMs);
        return;
      }
      persistJob(job);
    });
  };
  launch();
  return job;
}

function cancelJob(episodeRoot, jobId = "") {
  const id = compactLine(jobId);
  if (!id) throw new Error("缺少任务 ID");
  const live = jobs.get(id);
  const persisted = readPersistedJobs(episodeRoot).find((job) => job.id === id);
  const job = live || persisted;
  if (!job || job.episodeRoot !== episodeRoot) throw new Error("找不到可取消的任务");
  if (job.status !== "running") return jobSummary(job);
  const child = jobChildren.get(id);
  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 2500);
  }
  job.status = "canceled";
  job.finishedAt = new Date().toISOString();
  appendJobLog(job, "\n用户取消任务。\n");
  persistJob(job);
  if (live) jobs.set(id, job);
  return jobSummary(job);
}

async function startToolJob(episodeRoot, type, body = {}) {
  if (["assets", "assets-dry-run", "asset-regenerate", "asset-regenerate-dry-run", "asset-edit", "asset-edit-dry-run"].includes(type)) {
    const isDryRun = type === "assets-dry-run" || type === "asset-regenerate-dry-run" || type === "asset-edit-dry-run";
    const isRegenerate = type === "asset-regenerate" || type === "asset-regenerate-dry-run";
    const isEdit = type === "asset-edit" || type === "asset-edit-dry-run";
    const manifest = readAssetManifest(episodeRoot)?.data;
    if (!manifest?.items?.length) throw new Error("还没有资产解析结果，请先提取资产再生成");
    if (!manifest.confirmed) throw new Error("资产解析尚未确认，请先确认分类再生图");
    if (!isDryRun && !imageApiKey()) {
      throw new Error("缺少 OPENAI_API_KEY：请在启动 Pixel Toys 的终端或项目 .env.local 中配置 api.apikey.fun 的 OpenAI 兼容 API Key，然后重启服务。");
    }
    const assetStyle = assetStyleFromBody(body);
    const basePrompts = enforcedAssetPromptsPath(episodeRoot, assetStyle);
    if (!fs.existsSync(basePrompts)) throw new Error("asset prompts file is missing");
    const assetName = compactLine(body.assetName || "");
    const editInstruction = compactLine(body.editInstruction || "");
    const manifestForRefs = readAssetManifest(episodeRoot)?.data;
    const manifestItemForAsset = assetName && manifestForRefs?.items?.length
      ? normalizeAssetManifest(manifestForRefs).items.find((item) => item.id === assetName)
      : null;
    const assetReferenceNamesFromManifest =
      assetName && manifestForRefs?.items?.length
        ? manifestForRefs.items.find((item) => item.id === assetName)?.referenceAssetNames || []
        : [];
    const requestedReferenceNames = Array.isArray(body.referenceAssetNames) && body.referenceAssetNames.length
      ? body.referenceAssetNames
      : assetReferenceNamesFromManifest;
    const referenceAssets = (isEdit || isRegenerate) ? resolveReferenceAssets(episodeRoot, requestedReferenceNames) : [];
    if (isRegenerate || isEdit) {
      if (!assetName) throw new Error("缺少要重新生成的资产名称");
      if (isRegenerate && manifestItemForAsset?.generate === false) throw new Error(`资产已设为不生成：${assetName}`);
      const plannedAssetNames = parseAssetsFromPromptNames(readText(basePrompts));
      if (!plannedAssetNames.includes(assetName)) throw new Error(`资产提示词中找不到：${assetName}`);
    }
    if (isEdit) {
      if (!editInstruction) throw new Error("请填写资产图修改要求");
      if (editInstruction.length > 1200) throw new Error("修改要求过长，请控制在 1200 字以内");
      const currentAsset = projectProductionAssetsForState(episodeRoot, manifestForRefs).find((asset) => asset.assetName === assetName);
      if (!currentAsset) throw new Error(`找不到当前资产图：${assetName}`);
      if (referenceAssets.some((asset) => asset.assetName === assetName)) throw new Error("参考图不能选择当前正在修改的同一张资产图");
    }
    if (!isEdit && referenceAssets.some((asset) => asset.assetName === assetName)) throw new Error("参考图不能选择当前正在生成的同一张资产图");
    const size = IMAGE_SIZE_BY_QUALITY_16_9[String(body.quality || "1k").toLowerCase()] || DEFAULT_IMAGE_SIZE_16_9;
    let selectedAssetNames = [];
    if (!isRegenerate && !isEdit) {
    const manifest = readAssetManifest(episodeRoot)?.data;
      const runStart = currentRunStartMs(episodeRoot);
      const slots = assetSlotsForState(
        episodeRoot,
        manifest || {},
        projectProductionAssetsForState(episodeRoot, manifest || {}, { minModifiedAt: runStart }),
        { minFailedAt: runStart, minModifiedAt: runStart },
      );
      const range = compactLine(body.assetRange || "missing") || "missing";
      if (range === "selected") {
        const allowedNames = new Set(slots.filter((slot) => !slot.skipped).map((slot) => slot.id));
        selectedAssetNames = (Array.isArray(body.assetNames) ? body.assetNames : [])
          .map(compactLine)
          .filter((name) => name && allowedNames.has(name));
        if (!selectedAssetNames.length) throw new Error("请选择要生成的资产");
      } else if (range === "failed") {
        selectedAssetNames = slots.filter((slot) => !slot.skipped && slot.failed).map((slot) => slot.id);
        if (!selectedAssetNames.length) throw new Error("没有失败资产需要重新生成");
      } else if (range === "all") {
        selectedAssetNames = slots.filter((slot) => !slot.skipped).map((slot) => slot.id).filter(Boolean);
      } else {
        selectedAssetNames = slots
          .filter((slot) => !slot.skipped && (slot.missing || slot.status === "failed" || slot.failed))
          .map((slot) => slot.id);
        if (!selectedAssetNames.length) throw new Error("没有缺失资产需要生成");
      }
    }
    const targetAssetNames = isRegenerate || isEdit ? [assetName] : selectedAssetNames;
    if (!isDryRun) clearAssetFailureLogs(episodeRoot, targetAssetNames);
    const filteredPrompts = isRegenerate || isEdit ? basePrompts : partialAssetPromptsPath(episodeRoot, basePrompts, selectedAssetNames);
    const prompts = styledAssetPromptsPath(episodeRoot, filteredPrompts, assetStyle);
    const args = [prompts, episodeRoot];
    if (isDryRun) args.push("--dry-run");
    if (isRegenerate || isEdit) args.push("--asset-name", assetName, "--force");
    if (isEdit) args.push("--edit-instruction", editInstruction);
    for (const referenceAsset of referenceAssets) args.push("--reference-image", referenceAsset.path);
    const hiddenSceneReferenceMap = !isEdit
      ? await buildHiddenSceneReferenceMap(episodeRoot, manifestForRefs, targetAssetNames, assetStyle)
      : null;
    if (hiddenSceneReferenceMap?.mapPath) args.push("--asset-reference-map", hiddenSceneReferenceMap.mapPath);
    const styleReference = readAssetStyleReference(episodeRoot);
    const useStyleReference = body.assetStyleReferenceEnabled !== false && styleReference.enabled && styleReference.asset?.path;
    if (useStyleReference) args.push("--style-reference-image", styleReference.asset.path);
    args.push("--size", size);
    const job = startProcessJob({
      episodeRoot,
      type,
      command: process.execPath,
      args: [ASSET_GENERATOR_SCRIPT, ...args],
      meta: {
        runNamespace: currentRunNamespace(episodeRoot),
        assetStylePreset: assetStyle.preset,
        assetStyleLabel: assetStyle.label,
        assetStyleReferenceEnabled: !!useStyleReference,
        assetStyleReferenceName: useStyleReference ? styleReference.asset.name : "",
        hiddenSceneReferenceEnabled: !!hiddenSceneReferenceMap?.mapPath,
        hiddenSceneReferenceCount: hiddenSceneReferenceMap?.selections?.length || 0,
        targetAssetNames,
      },
    });
    persistJob(job);
    return job;
  }
  if (["storyboards", "storyboards-dry-run", "storyboard-regenerate", "storyboard-regenerate-dry-run"].includes(type)) {
    const isDryRun = type === "storyboards-dry-run" || type === "storyboard-regenerate-dry-run";
    const isRegenerate = type === "storyboard-regenerate" || type === "storyboard-regenerate-dry-run";
    if (!isDryRun && !imageApiKey()) {
      throw new Error("缺少 OPENAI_API_KEY：Production Board 需要通过 api.apikey.fun / gpt-image-2 生图模型生成，请在项目 .env.local 或启动终端配置可用 Key 后重启服务。");
    }
    const size = IMAGE_SIZE_BY_QUALITY_9_16[String(body.quality || "1k").toLowerCase()] || DEFAULT_IMAGE_SIZE_9_16;
    persistProjectDialogueLanguage(
      episodeRoot,
      normalizeDialogueLanguage(body.dialogueLanguage || projectDialogueLanguage(episodeRoot), "en"),
    );
    const manifest = readAssetManifest(episodeRoot)?.data || {};
    const config = readVideoConfig(episodeRoot)?.data || null;
    const runStart = currentRunStartMs(episodeRoot, config);
    const storyboardAssets = currentStoryboardAssetsForWorkflow(scanAssets(episodeRoot), {
      configData: config,
      minModifiedAt: runStart,
    });
    const slots = storyboardSlotsForState(episodeRoot, manifest, storyboardAssets, { configData: config });
    if (!slots.length) throw new Error("没有可生成的故事版槽位，请先载入剧本并生成分镜/视频配置");
    let selectedStoryboardNames = [];
    if (isRegenerate) {
      const storyboardName = compactLine(body.storyboardName || body.assetName || "");
      if (!storyboardName) throw new Error("缺少要重新生成的 Production Board 名称");
      if (!slots.some((slot) => slot.id === storyboardName)) throw new Error(`Production Board 槽位不存在：${storyboardName}`);
      selectedStoryboardNames = [storyboardName];
    } else {
      const range = compactLine(body.storyboardRange || "missing") || "missing";
      if (range === "selected") {
        selectedStoryboardNames = (Array.isArray(body.storyboardNames) ? body.storyboardNames : []).map(compactLine).filter(Boolean);
        if (!selectedStoryboardNames.length) throw new Error("请选择要生成的 Production Board");
      } else if (range === "all") {
        selectedStoryboardNames = slots.map((slot) => slot.id).filter(Boolean);
      } else {
        selectedStoryboardNames = slots.filter((slot) => slot.missing).map((slot) => slot.id);
        if (!selectedStoryboardNames.length) throw new Error("没有缺失 Production Board 需要生成");
      }
    }
    if (!isDryRun) clearAssetFailureLogs(episodeRoot, selectedStoryboardNames);
    const prompts = storyboardPromptsPath(episodeRoot, slots, selectedStoryboardNames);
    const args = [prompts, episodeRoot];
    if (isDryRun) args.push("--dry-run");
    if (isRegenerate) args.push("--force", "--asset-name", selectedStoryboardNames[0]);
    const selectedSlots = slots.filter((slot) => selectedStoryboardNames.includes(slot.id));
    for (const referenceImage of productionBoardReferenceImagesForSlots(episodeRoot, selectedSlots)) {
      args.push("--reference-image", referenceImage);
    }
    args.push("--size", size);
    const storyboardConcurrency = Math.max(1, Math.min(STORYBOARD_IMAGE_CONCURRENCY, selectedStoryboardNames.length));
    if (!isRegenerate && storyboardConcurrency > 1) {
      args.push("--concurrency", String(storyboardConcurrency));
    }
    const job = startProcessJob({
      episodeRoot,
      type,
      command: process.execPath,
      args: [ASSET_GENERATOR_SCRIPT, ...args],
      meta: {
        runNamespace: currentRunNamespace(episodeRoot),
        assetStylePreset: "production_board",
        assetStyleLabel: "Production Board",
        aspectRatio: "9:16",
        imageSize: size,
        targetAssetNames: selectedStoryboardNames.length === 1 ? selectedStoryboardNames : [],
      },
    });
    persistJob(job);
    return job;
  }
  throw new Error(`unknown job type: ${type}`);
}

function userUsageSnapshot(user) {
  const today = currentUsageDay();
  return {
    today,
    todayVideoTasks: userDailyVideoCount(user.id, today),
    runningVideoTasks: runningVideoCountForUser(user.id),
    dailyVideoLimit: dailyVideoLimitForUser(user),
    concurrentVideoLimit: concurrentVideoLimitForUser(user),
  };
}

function adminUserRows() {
  const sessions = readAuthSessions().sessions;
  const users = readAuthUsers().users;
  return users.map((user) => ({
    ...publicUser(user),
    inviteCode: user.inviteCode || "",
    sessionCount: sessions.filter((session) => session.userId === user.id).length,
    usage: userUsageSnapshot(user),
  }));
}

function inviteRows() {
  const users = readAuthUsers().users;
  return invitationCodes().map((code) => {
    const usedBy = users
      .filter((user) => user.inviteCode === code)
      .map((user) => ({ id: user.id, username: user.username, displayName: user.displayName || user.username }));
    return { code, usedCount: usedBy.length, usedBy };
  });
}

function apiStatusRows() {
  const storageEnvNames = [
    "PUBLIC_ASSET_S3_ENDPOINT",
    "PUBLIC_ASSET_S3_REGION",
    "PUBLIC_ASSET_S3_BUCKET",
    "PUBLIC_ASSET_S3_ACCESS_KEY_ID",
    "PUBLIC_ASSET_S3_SECRET_ACCESS_KEY",
  ];
  return [
    { id: "image", label: "图片生成 API", configured: configuredEnv(IMAGE_API_KEY_ENV_NAMES) },
    { id: "assetAnalyzer", label: "资产解析 API", configured: configuredEnv(["ASSET_ANALYZER_API_KEY", ...IMAGE_API_KEY_ENV_NAMES]) },
    { id: "storyboard", label: "故事板生成 API", configured: configuredEnv(["STORYBOARD_API_KEY", ...IMAGE_API_KEY_ENV_NAMES]) },
    { id: "arkVideo", label: "火山 Ark 视频 API", configured: configuredEnv(ARK_VIDEO_API_KEY_ENV_NAMES) },
    { id: "byteplusVideo", label: "BytePlus ModelArk 视频 API", configured: configuredEnv(BYTEPLUS_ARK_VIDEO_API_KEY_ENV_NAMES) },
    { id: "gravitexVideo", label: "Gravitex/Seedance 视频 API", configured: configuredEnv(GRAVITEX_VIDEO_API_KEY_ENV_NAMES) },
    { id: "publicStorage", label: "公开素材存储", configured: storageEnvNames.every((name) => configuredEnv([name])) },
  ];
}

function usageRows() {
  const usage = readAuthUsage();
  const users = new Map(readAuthUsers().users.map((user) => [user.id, user]));
  return Object.entries(usage.days || {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 30)
    .flatMap(([day, dayUsage]) =>
      Object.entries(dayUsage || {}).map(([userId, entry]) => {
        const user = users.get(userId) || {};
        return {
          day,
          userId,
          username: user.username || userId,
          displayName: user.displayName || user.username || userId,
          videoTasks: Number(entry?.videoTasks || 0),
          activeVideoTasks: activeVideoTasksForUser(userId, day).length,
          updatedAt: entry?.updatedAt || "",
          lastTask: entry?.lastTask || null,
        };
      }),
    );
}

// content 可以是纯文本，也可以是 [{type:"text"}, {type:"image_url"}] 多模态数组
// （资产图拖进对话框的场景）。注意不能对数组用 String()，那会压成 "[object Object]"。
function superPixelTextPart(value) {
  return String(value || "").trim().slice(0, 12000);
}

function superPixelContent(raw) {
  if (!Array.isArray(raw)) return superPixelTextPart(raw);
  const parts = [];
  let imageCount = 0;
  for (const item of raw) {
    if (item?.type === "text") {
      const text = superPixelTextPart(item.text);
      if (text) parts.push({ type: "text", text });
      continue;
    }
    if (item?.type === "image_url") {
      // 单条消息最多 8 张图，避免一次请求把上游图片额度/体积打爆
      if (imageCount >= SUPER_PIXEL_MAX_IMAGES_PER_MESSAGE) continue;
      const url = compactLine(item.image_url?.url || item.url || "");
      if (!url) continue;
      imageCount += 1;
      parts.push({ type: "image_url", image_url: { url } });
    }
  }
  // 只有图没有文字也允许（"这张图什么风格？"式的追问由前端补默认文案）
  return parts.length ? parts : "";
}

// 对话看图必须内联 base64。实测 api.apikey.fun 不会去抓公网 https 图片链接
// （模型会回「我没有收到图片」），只认 data URL。注意这和 Seedance 视频参考图正好相反：
// 那边要求公网可读、走 assetUrlToReferenceUrl 转 S3。别把两条路混用。
function superPixelInlineImage(url) {
  const raw = compactLine(url);
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return raw;
  // /media?path= 、file:// 、/public-assets/xxx（含 S3 公网地址反查本地镜像）
  const local =
    localMediaPathFromUrl(raw) || localFilePathFromUrl(raw) || localPublicAssetPathFromUrl(raw);
  if (!local) return "";
  if (!/\.(png|jpe?g|webp)$/i.test(local)) return "";
  if (fs.statSync(local).size > SUPER_PIXEL_MAX_IMAGE_BYTES) return "";
  return fileToDataUrl(local);
}

// 逐张转成内联 base64。转不出来的图跳过并保留文字，不让一张坏图搞挂整轮对话。
async function superPixelResolveImages(messages) {
  const out = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      out.push(message);
      continue;
    }
    const parts = [];
    for (const part of message.content) {
      if (part.type !== "image_url") {
        parts.push(part);
        continue;
      }
      const inlined = superPixelInlineImage(part.image_url.url);
      if (inlined) parts.push({ type: "image_url", image_url: { url: inlined } });
      else console.error(`[superPixel] 图片无法内联，已跳过: ${String(part.image_url.url).slice(0, 80)}`);
    }
    if (parts.length) out.push({ ...message, content: parts });
  }
  return out;
}

function superPixelMessages(bodyMessages) {
  if (!Array.isArray(bodyMessages)) return [];
  return bodyMessages
    .filter((item) => ["user", "assistant"].includes(item?.role))
    .map((item) => ({ role: item.role, content: superPixelContent(item.content) }))
    .filter((item) => (Array.isArray(item.content) ? item.content.length : item.content))
    .slice(-20);
}

function superPixelSystemPrompt(scriptText) {
  const script = truncateSuperPixelScript(scriptText);
  return [
    "You are Super Pixel in Ask mode.",
    "Answer the user's questions and creative requests with text only.",
    "Do not call tools, modify project data, create episodes, write storyboards, or claim that you performed an action.",
    script ? `The user uploaded this screenplay for context:\n\n${script}` : "",
  ].filter(Boolean).join("\n\n");
}

function superPixelConversationImageHandles(images = []) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => ({
      url: compactLine(image?.url || ""),
      name: compactLine(image?.name || "未命名图片") || "未命名图片",
      source: compactLine(image?.source || "conversation") || "conversation",
    }))
    .filter((image) => image.url)
    .slice(0, 64)
    .map((image, index) => ({ ...image, handle: `image_${index + 1}` }));
}

function superPixelReferenceSourceLabel(source = "") {
  if (source === "local" || source === "upload" || source === "user-upload") return "用户上传";
  if (source === "asset-library" || source === "library") return "资产库";
  if (source === "agent-generated" || source === "generated") return "你生成的图";
  return "对话图片";
}

function superPixelReferencePromptLines(images = []) {
  return (Array.isArray(images) ? images : [])
    .map((image) => `${image.handle}（${superPixelReferenceSourceLabel(image.source)}：${image.name}）`)
    .filter(Boolean);
}

function superPixelAgentSystemPrompt(scriptText, conversationImages = []) {
  const script = truncateSuperPixelScript(scriptText);
  const referenceLines = superPixelReferencePromptLines(conversationImages);
  return [
    "You are Super Pixel in Agent mode.",
    "Use the available tools when the user asks you to create images, request a video, search assets, or inspect a project.",
    "Do not claim that a video was generated: generate_video only asks the user for confirmation.",
    referenceLines.length
      ? `The conversation reference images are available as handles. Use these exact handles in referenceImages; do not invent image URLs or handles. Do not use firstFrameUrl for ordinary reference-image requests.\n${referenceLines.join("\n")}`
      : "There are no conversation reference images available. Do not invent image handles or URLs.",
    "After a tool result, answer the user concisely and accurately. Never invent task IDs, project changes, or completed work.",
    script ? `The user uploaded this screenplay for context:\n\n${script}` : "",
  ].filter(Boolean).join("\n\n");
}

const SUPER_PIXEL_TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Submit an image generation task immediately and continue the conversation without waiting for completion.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The image description." },
          imageModel: { type: "string", enum: ["gpt-image-2", "seedream-5-0-pro", "seedream-5-0-lite"], default: "gpt-image-2" },
          ratio: { type: "string", enum: Object.keys(CANVAS_IMAGE_SIZE_TABLE), default: "16:9" },
          resolution: { type: "string", enum: ["1k", "2k", "4k"], default: "1k" },
          referenceImages: { type: "array", items: { type: "string" }, maxItems: 4 },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_video",
      description: "Ask the user to confirm a video generation request; this tool never submits a video task.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The video description." },
          videoModel: { type: "string", default: "seedance-2-0" },
          duration: { type: "number", minimum: 1, default: 5 },
          ratio: { type: "string", default: "9:16" },
          firstFrameUrl: { type: "string" },
          referenceImages: { type: "array", items: { type: "string" }, maxItems: 9 },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_assets",
      description: "Search the current user's asset library and return compact asset records.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Keyword to search for." },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        required: ["search"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_project",
      description: "Read a compact summary of the selected project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Optional encoded project ID; defaults to the current project." },
          section: { type: "string", enum: ["script", "assets", "storyboard", "config", "all"], default: "all" },
        },
        additionalProperties: false,
      },
    },
  },
];

function superPixelToolSummary(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return String(text || "").slice(0, 8000);
}

function parseSuperPixelToolArguments(rawArguments) {
  if (rawArguments && typeof rawArguments === "object") return rawArguments;
  const raw = String(rawArguments || "{}");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("工具参数必须是 JSON 对象");
  return parsed;
}

async function resolveSuperPixelReferenceImages(values = [], conversationImages = [], maxImages = 9) {
  const requested = Array.isArray(values) ? values.map(compactLine).filter(Boolean) : [];
  if (requested.length > maxImages) throw new Error(`参考图数量超过上限：最多 ${maxImages} 张。`);
  const handles = new Map((Array.isArray(conversationImages) ? conversationImages : []).map((image) => [image.handle, image]));
  const resolved = [];
  for (const value of requested) {
    const handleLike = /^image_\d+$/i.test(value);
    const image = handleLike ? handles.get(value) : null;
    if (handleLike && !image) throw new Error(`参考图句柄 ${value} 无法解析：当前对话没有这张图片。`);
    const sourceUrl = image?.url || value;
    const name = image?.name || `参考图${resolved.length + 1}`;
    let url = "";
    let thumbnailUrl = "";
    if (isDataImageUrl(sourceUrl)) {
      const publicAsset = await createPublicCanvasAsset({ name, dataUrl: sourceUrl });
      url = compactLine(publicAsset.url || publicAsset.localUrl || "");
      thumbnailUrl = compactLine(publicAsset.localUrl || publicAsset.url || "");
    } else {
      const localFile = localMediaPathFromUrl(sourceUrl)
        || localTeamAssetLibraryPathFromUrl(sourceUrl)
        || localFilePathFromUrl(sourceUrl)
        || localPublicAssetPathFromUrl(sourceUrl);
      if (localFile) {
        const publicAsset = await createPublicCanvasAsset({ name, dataUrl: fileToDataUrl(localFile) });
        url = compactLine(publicAsset.url || publicAsset.localUrl || "");
        thumbnailUrl = compactLine(publicAsset.localUrl || publicAsset.url || "");
      } else {
        url = compactLine(await assetUrlToReferenceUrl(sourceUrl, { allowAssetUrl: true }));
        thumbnailUrl = url;
      }
    }
    if (!url || /^data:/i.test(url)) throw new Error(`参考图「${name}」无法解析为稳定 URL。`);
    resolved.push({
      handle: image?.handle || "",
      url,
      thumbnailUrl: thumbnailUrl || url,
      name,
      source: image?.source || "direct",
    });
  }
  return resolved;
}

function superPixelProjectRoot(req, projectId = "") {
  const user = currentUserFromRequest(req);
  const cleanId = compactLine(projectId || "");
  if (cleanId) {
    const fromProjectId = episodeRootFromCanvasProjectId(cleanId);
    const directPath = path.resolve(cleanId);
    const root = fromProjectId || (allowedPath(directPath) && fs.existsSync(directPath) ? directPath : "");
    if (!root || !userCanAccessProject(user, root)) throw new Error("项目不存在或无权访问");
    return root;
  }
  return scanEpisodeRoots()
    .filter((root) => userCanAccessProject(user, root))
    .sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    })[0] || "";
}

function superPixelProjectSummary(req, args, context) {
  const root = superPixelProjectRoot(req, args.projectId || context.projectId);
  if (!root) return "当前没有可读取的项目。";
  const section = compactLine(args.section || "all").toLowerCase() || "all";
  if (!["script", "assets", "storyboard", "config", "all"].includes(section)) throw new Error("项目读取 section 不正确");
  const state = fullProjectState(root);
  const manifest = readAssetManifest(root)?.data || state.assetManifest || null;
  const config = readVideoConfig(root)?.data || null;
  const project = state.project || { id: root };
  const result = { project };
  if (section === "script" || section === "all") result.script = state.contents?.script || "";
  if (section === "assets" || section === "all") {
    result.assetManifest = manifest;
    result.assets = state.assets || [];
  }
  if (section === "storyboard" || section === "all") {
    result.storyboard = state.contents?.storyboard || "";
    result.storyboards = state.storyboards || [];
  }
  if (section === "config" || section === "all") result.config = config || state.contents?.config || "";
  return superPixelToolSummary(result);
}

async function executeSuperPixelTool({ req, context, callId, name, rawArguments, emit }) {
  let args = {};
  try {
    args = parseSuperPixelToolArguments(rawArguments);
  } catch (error) {
    const summary = superPixelToolSummary(error.message || "工具参数无效");
    emit({ toolStart: { callId, name, args } });
    emit({ toolResult: { callId, name, summary } });
    return summary;
  }
  emit({ toolStart: { callId, name, args } });
  try {
    if (name === "generate_image") {
      const prompt = compactLine(args.prompt || "");
      if (!prompt) throw new Error("缺少图片描述 prompt");
      const referenceImages = await resolveSuperPixelReferenceImages(
        args.referenceImages,
        context.conversationImageHandles,
        4,
      );
      const result = await createCanvasImageGeneration({
        ...args,
        prompt,
        referenceImages: referenceImages.map((reference) => reference.url),
        ownerUserId: context.userId,
      });
      const meta = {
        prompt,
        imageModel: result.imageModel || compactLine(args.imageModel || "gpt-image-2"),
        ratio: result.ratio || compactLine(args.ratio || "16:9"),
        resolution: result.resolution || compactLine(args.resolution || "1k"),
        referenceImages,
      };
      emit({ toolCard: { kind: "image", callId, taskId: result.taskId, meta } });
      return `已提交出图任务 taskId=${result.taskId}，图片生成中并会自动显示在对话里。不要等待，继续回答用户。`;
    }
    if (name === "generate_video") {
      const prompt = compactLine(args.prompt || "");
      if (!prompt) throw new Error("缺少视频描述 prompt");
      const duration = Number(args.duration);
      const referenceImages = await resolveSuperPixelReferenceImages(args.referenceImages, context.conversationImageHandles, 9);
      const videoArgs = {
        prompt,
        videoModel: compactLine(args.videoModel || "seedance-2-0") || "seedance-2-0",
        duration: Number.isFinite(duration) && duration > 0 ? duration : 5,
        ratio: compactLine(args.ratio || "9:16") || "9:16",
        firstFrameUrl: compactLine(args.firstFrameUrl || ""),
        referenceImages: referenceImages.map((reference) => reference.url),
      };
      emit({ toolConfirm: { kind: "video", callId, args: videoArgs, referenceImages } });
      return "已向用户发出视频生成确认请求，等待用户点击确认。不要假设视频已生成。";
    }
    if (name === "search_assets") {
      const requestedLimit = Number(args.limit);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.floor(requestedLimit))) : 20;
      const assets = assetLibrary.list({
        userId: assetLibraryUserId(req),
        search: compactLine(args.search || ""),
        limit,
      }).map(publicAssetLibraryRecord).map((asset) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        url: asset.url,
      }));
      const summary = superPixelToolSummary({ count: assets.length, assets });
      emit({ toolResult: { callId, name, summary } });
      return summary;
    }
    if (name === "read_project") {
      const summary = superPixelProjectSummary(req, args, context);
      emit({ toolResult: { callId, name, summary } });
      return summary;
    }
    throw new Error(`未知工具：${name}`);
  } catch (error) {
    const summary = superPixelToolSummary(error?.message || "工具执行失败");
    emit({ toolResult: { callId, name, summary } });
    return summary;
  }
}

function superPixelDelta(data) {
  const choice = data?.choices?.[0] || {};
  const delta = choice.delta;
  if (typeof delta === "string") return delta;
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content.map((item) => typeof item === "string" ? item : item?.text || "").join("");
  }
  return typeof choice.text === "string" ? choice.text : "";
}

function adminSummary() {
  const users = adminUserRows();
  const invites = inviteRows();
  const usage = usageRows();
  const today = currentUsageDay();
  return {
    usersTotal: users.length,
    usersDisabled: users.filter((user) => user.disabled).length,
    invitesTotal: invites.length,
    invitesUsed: invites.filter((invite) => invite.usedCount > 0).length,
    todayVideoTasks: usage.filter((entry) => entry.day === today).reduce((sum, entry) => sum + entry.videoTasks, 0),
    runningVideoTasks: users.reduce((sum, user) => sum + Number(user.usage?.runningVideoTasks || 0), 0),
    defaultDailyVideoLimit: dailyVideoLimit(),
    defaultConcurrentVideoLimit: concurrentVideoLimit(),
  };
}

const INVITE_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateInviteCode() {
  let code = "";
  for (let i = 0; i < 7; i += 1) {
    code += INVITE_CODE_ALPHABET[crypto.randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

function removeUserSessions(userId) {
  const store = readAuthSessions();
  store.sessions = store.sessions.filter((session) => session.userId !== userId);
  writeAuthSessions(store);
}

async function readSuperPixelStream(upstream, emit) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map();
  let pending = "";
  let finishReason = "";
  let content = "";
  let upstreamDone = false;
  const processLine = (line) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") {
      if (raw === "[DONE]") upstreamDone = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const choice = data?.choices?.[0] || {};
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    const text = superPixelDelta(data);
    if (text) {
      content += text;
      emit({ delta: text });
    }
    for (const [fallbackIndex, call] of (Array.isArray(delta.tool_calls) ? delta.tool_calls : []).entries()) {
      const index = Number.isInteger(call?.index) ? call.index : fallbackIndex;
      const current = toolCalls.get(index) || {
        index,
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      if (call?.id) current.id = call.id;
      if (call?.type) current.type = call.type;
      if (call?.function?.name) current.function.name += call.function.name;
      if (call?.function?.arguments) current.function.arguments += call.function.arguments;
      toolCalls.set(index, current);
    }
  };
  while (!upstreamDone) {
    const { done, value } = await reader.read();
    if (done) {
      pending += decoder.decode();
      break;
    }
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) processLine(line);
  }
  if (pending) processLine(pending);
  return {
    content,
    finishReason,
    toolCalls: [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => ({
      ...call,
      id: call.id || `call_${call.index}`,
    })),
  };
}

async function handleSuperPixelChat(req, res) {
  const adminUser = currentUserFromRequest(req);
  if (!adminUser || !isAdminUser(adminUser)) return fail(res, 403, "需要管理员权限");
  if (req.method !== "POST") return fail(res, 405, "method not allowed");
  const body = await readBody(req);
  const mode = compactLine(body.mode || "ask").toLowerCase();
  if (!["ask", "agent"].includes(mode)) return fail(res, 400, "不支持的 Super Pixel 模式");
  const agentMode = mode === "agent";
  const model = compactLine(body.model || "");
  const modelConfig = superPixelModelConfig(model);
  if (!modelConfig) return fail(res, 400, "不支持的 Super Pixel 模型");
  if (!modelConfig.apiKey) return fail(res, 503, "未配置 Super Pixel 模型 API Key");
  const messages = superPixelMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return fail(res, 400, "请输入对话内容");
  }
  const conversationImageHandles = agentMode ? superPixelConversationImageHandles(body.conversationImages) : [];
  const controller = new AbortController();
  let clientClosed = false;
  const onClose = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      controller.abort();
    }
  };
  req.on("close", onClose);
  // 拖进来的图可能是 asset:// / /media?path= / data: / 本地文件，上游都读不到，
  // 统一过一遍 assetUrlToReferenceUrl 转成模型可读的公开 URL。
  let resolvedMessages;
  try {
    resolvedMessages = await superPixelResolveImages(messages);
  } catch (error) {
    return fail(res, 400, "对话图片处理失败", error?.message || String(error));
  }
  let conversationMessages = resolvedMessages;
  const context = {
    userId: adminUser.id,
    projectId: body.projectId || body.currentProjectId || body.selectedProjectId || "",
    conversationImageHandles,
  };
  let streamStarted = false;
  let round = 0;
  let emit = () => {};
  try {
    emit = (payload) => {
      if (!clientClosed && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    while (round < 5) {
      round += 1;
      const requestBody = {
        model,
        stream: true,
        temperature: 0.7,
        messages: [{ role: "system", content: agentMode ? superPixelAgentSystemPrompt(body.scriptText, conversationImageHandles) : superPixelSystemPrompt(body.scriptText) }, ...conversationMessages],
      };
      if (agentMode) requestBody.tools = SUPER_PIXEL_TOOLS;
      const upstream = await superPixelFetch(openAiCompatUrl("/v1/chat/completions", modelConfig.kind), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${modelConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!upstream.ok) {
        const raw = await upstream.text();
        if (clientClosed) return;
        const message = `Super Pixel 模型返回 HTTP ${upstream.status}`;
        if (!res.headersSent) return fail(res, upstream.status, message, raw.slice(0, 600));
        emit({ error: message });
        res.end();
        return;
      }
      if (!upstream.body) throw new Error("Super Pixel 模型未返回流");
      if (!streamStarted) {
        streamStarted = true;
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
      }
      const streamed = await readSuperPixelStream(upstream, emit);
      if (agentMode && streamed.finishReason === "tool_calls") {
        if (!streamed.toolCalls.length) {
          emit({ error: "Super Pixel 模型返回了空工具调用" });
          res.end();
          return;
        }
        conversationMessages = [
          ...conversationMessages,
          {
            role: "assistant",
            content: streamed.content || null,
            tool_calls: streamed.toolCalls.map(({ index, ...call }) => call),
          },
        ];
        for (const call of streamed.toolCalls) {
          const summary = await executeSuperPixelTool({
            req,
            context,
            callId: call.id,
            name: call.function?.name || "",
            rawArguments: call.function?.arguments || "{}",
            emit,
          });
          conversationMessages.push({ role: "tool", tool_call_id: call.id, content: summary });
        }
        if (round >= 5) {
          emit({ error: "Super Pixel 工具调用轮数超过上限" });
          res.end();
          return;
        }
        continue;
      }
      emit({ done: true });
      res.end();
      return;
    }
    emit({ error: "Super Pixel 工具调用轮数超过上限" });
    if (!res.writableEnded) res.end();
  } catch (error) {
    if (clientClosed || error?.name === "AbortError") return;
    if (!res.headersSent) return fail(res, 502, "Super Pixel 流式请求失败", error.message);
    if (!res.writableEnded) {
      emit({ error: "Super Pixel 流式请求失败" });
      res.end();
    }
  } finally {
    req.off("close", onClose);
  }
}

async function handleAdminApi(req, res, url) {
  const adminUser = currentUserFromRequest(req);
  if (!adminUser || !isAdminUser(adminUser)) return fail(res, 403, "需要管理员权限");

  if (req.method === "GET" && url.pathname === "/api/admin/summary") {
    return send(res, 200, { ok: true, summary: adminSummary() });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    return send(res, 200, { ok: true, users: adminUserRows() });
  }
  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (req.method === "POST" && userMatch) {
    const userId = decodeURIComponent(userMatch[1]);
    const body = await readBody(req);
    const store = readAuthUsers();
    const user = store.users.find((item) => item.id === userId);
    if (!user) throw new Error("用户不存在");
    if (body.disabled === true && user.id === adminUser.id) throw new Error("不能停用当前管理员账号");
    if (typeof body.displayName === "string") user.displayName = compactLine(body.displayName).slice(0, 80) || user.username;
    if (typeof body.disabled === "boolean") user.disabled = body.disabled;
    if (typeof body.canvasEnabled === "boolean") user.canvasEnabled = body.canvasEnabled;
    if (body.dailyVideoLimit !== undefined) user.dailyVideoLimit = Math.max(0, Math.floor(Number(body.dailyVideoLimit) || 0));
    if (body.concurrentVideoLimit !== undefined) user.concurrentVideoLimit = Math.max(0, Math.floor(Number(body.concurrentVideoLimit) || 0));
    if (typeof body.password === "string" && body.password) {
      if (body.password.length < 8) throw new Error("密码至少 8 位");
      user.passwordHash = passwordHash(body.password);
    }
    user.updatedAt = new Date().toISOString();
    writeAuthUsers(store);
    if (user.disabled) removeUserSessions(user.id);
    return send(res, 200, { ok: true, user: adminUserRows().find((item) => item.id === user.id) });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/invites") {
    return send(res, 200, { ok: true, invites: inviteRows() });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/invites") {
    const body = await readBody(req);
    const requested = compactLine(body.code || "");
    const code = requested || generateInviteCode();
    if (!/^[A-Z]{7}$/.test(code)) throw new Error("邀请码格式需为 7 位大写字母");
    const codes = invitationCodes();
    if (!codes.includes(code)) codes.push(code);
    updateLocalEnvValue("PIXEL_TOYS_INVITE_CODES", codes.join(","));
    return send(res, 200, { ok: true, invite: inviteRows().find((item) => item.code === code), invites: inviteRows() });
  }
  const inviteMatch = url.pathname.match(/^\/api\/admin\/invites\/([^/]+)$/);
  if (req.method === "DELETE" && inviteMatch) {
    const code = decodeURIComponent(inviteMatch[1]);
    updateLocalEnvValue("PIXEL_TOYS_INVITE_CODES", invitationCodes().filter((item) => item !== code).join(","));
    return send(res, 200, { ok: true, invites: inviteRows() });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/api-status") {
    return send(res, 200, { ok: true, apiStatus: apiStatusRows() });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/usage") {
    return send(res, 200, { ok: true, usage: usageRows() });
  }
  return fail(res, 404, "not found");
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/team") {
    const user = currentUserFromRequest(req);
    return send(res, 200, { ok: true, team: currentTeamSummary(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/team") {
    const user = currentUserFromRequest(req);
    const body = await readBody(req);
    teamStore.createTeam({ userId: user.id, name: body.name });
    return send(res, 200, { ok: true, team: currentTeamSummary(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/team/join") {
    const user = currentUserFromRequest(req);
    const body = await readBody(req);
    teamStore.joinTeam({ userId: user.id, code: body.code });
    return send(res, 200, { ok: true, team: currentTeamSummary(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/team/leave") {
    const user = currentUserFromRequest(req);
    teamStore.leaveTeam({ userId: user.id });
    return send(res, 200, { ok: true, team: null });
  }

  if (req.method === "POST" && url.pathname === "/api/team/invite") {
    const user = currentUserFromRequest(req);
    const membership = assertCurrentTeamMembership(user);
    const invite = teamStore.replaceInvite({ actorUserId: user.id, teamId: membership.teamId });
    return send(res, 200, { ok: true, invite });
  }

  if (req.method === "DELETE" && url.pathname === "/api/team/invite") {
    const user = currentUserFromRequest(req);
    const membership = assertCurrentTeamMembership(user);
    teamStore.revokeInvite({ actorUserId: user.id, teamId: membership.teamId });
    return send(res, 200, { ok: true });
  }

  const teamMemberMatch = url.pathname.match(/^\/api\/team\/members\/([^/]+)$/);
  if (req.method === "DELETE" && teamMemberMatch) {
    const user = currentUserFromRequest(req);
    const membership = assertCurrentTeamMembership(user);
    teamStore.removeMember({
      actorUserId: user.id,
      teamId: membership.teamId,
      userId: decodeURIComponent(teamMemberMatch[1]),
    });
    return send(res, 200, { ok: true, team: currentTeamSummary(user) });
  }

  const teamAssetMediaMatch = url.pathname.match(/^\/api\/team\/asset-library\/([^/]+)\/media$/);
  if (req.method === "GET" && teamAssetMediaMatch) {
    const userId = assetLibraryUserId(req);
    const membership = teamMembershipForUser(userId);
    const record = assetLibrary.get(decodeURIComponent(teamAssetMediaMatch[1]), {
      userId,
      teamId: membership?.teamId || "",
    });
    if (!record?.teamId || !membership || record.teamId !== membership.teamId) return fail(res, 404, "团队素材不存在");
    const file = localPathForAssetLibraryUrl(record.localUrl || record.url || record.previewUrl || "");
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, "团队素材文件不存在");
    const sourceProject = episodeRootForFile(file);
    if (sourceProject) assertUserCanAccessProject(req, sourceProject);
    return serveMedia(req, res, file, { cacheSeconds: 86400 });
  }

  if (req.method === "POST" && url.pathname === "/api/team/transfer") {
    const user = currentUserFromRequest(req);
    const membership = assertCurrentTeamMembership(user);
    const body = await readBody(req);
    teamStore.transferOwnership({
      actorUserId: user.id,
      teamId: membership.teamId,
      nextOwnerUserId: body.userId,
    });
    return send(res, 200, { ok: true, team: currentTeamSummary(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/team/resources") {
    const user = currentUserFromRequest(req);
    const type = compactLine(url.searchParams.get("type") || "");
    if (type && !["asset-image", "storyboard", "shot"].includes(type)) return fail(res, 400, "资源类型不正确");
    const resources = teamResourceCatalog(user, type).map(publicTeamResourceDescriptor);
    return send(res, 200, { ok: true, resources });
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const user = currentUserFromRequest(req);
    const projects = scanEpisodeRoots().filter((episodeRoot) => userCanAccessProject(user, episodeRoot)).map((episodeRoot) => ({
      ...lightweightProjectSummary(episodeRoot),
      canDelete: userCanDeleteProject(user, episodeRoot),
    })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return send(res, 200, { ok: true, appRoot: APP_ROOT, defaultProjectRoot: DEFAULT_PROJECT_ROOT, ui: uiRuntimeConfig(), projects });
  }

  if (req.method === "GET" && url.pathname === "/api/canvas/state") {
    const projectId = url.searchParams.get("projectId") || "standalone";
    const episodeRoot = episodeRootFromCanvasProjectId(projectId);
    if (episodeRoot) assertUserCanAccessProject(req, episodeRoot);
    const state = syncCanvasStateFromProjectSnapshots(projectId) || readCanvasState(projectId);
    if (!episodeRoot && projectId !== "standalone" && state) {
      const user = currentUserFromRequest(req);
      if (!userCanAccessCanvasState(user, state)) return fail(res, 404, "canvas not found");
    }
    return send(res, 200, { ok: true, state: canvasStateWithThumbPreviews(state) }, { "Cache-Control": "no-store" });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/state") {
    const body = await readBody(req);
    const episodeRoot = episodeRootFromCanvasProjectId(body.projectId || "");
    if (episodeRoot) assertUserCanAccessProject(req, episodeRoot);
    const user = currentUserFromRequest(req);
    const written = writeCanvasState(body, user);
    const state = syncCanvasStateFromProjectSnapshots(written.projectId) || written;
    return send(res, 200, { ok: true, state: { updatedAt: state.updatedAt } });
  }

  if (req.method === "GET" && url.pathname === "/api/canvas/blank-list") {
    const user = currentUserFromRequest(req);
    return send(res, 200, { ok: true, canvases: listBlankCanvases(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/blank-delete") {
    const body = await readBody(req);
    const user = currentUserFromRequest(req);
    return send(res, 200, { ok: true, result: deleteBlankCanvas(body.projectId || body.id || "", user) });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/blank-rename") {
    const body = await readBody(req);
    const user = currentUserFromRequest(req);
    return send(res, 200, { ok: true, result: renameBlankCanvas(body.projectId || body.id || "", body.name || "", user) });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/blank-team") {
    const body = await readBody(req);
    const user = currentUserFromRequest(req);
    const membership = assertCurrentTeamMembership(user);
    const state = readCanvasState(body.projectId || body.id || "");
    if (!state || episodeRootFromCanvasProjectId(state.projectId || "")) return fail(res, 404, "canvas not found");
    const scope = canvasScopeRecord(state);
    if (scope.scope === "team") return fail(res, 409, "画布已经属于团队");
    if (scope.ownerUserId !== user.id) return fail(res, 403, "只有个人画布所有者可以加入团队");
    const written = persistCanvasState(sanitizeCanvasState({
      ...state,
      scope: "team",
      teamId: membership.teamId,
      lastModifiedByUserId: user.id,
      lastModifiedByUsername: user.username || "",
    }));
    return send(res, 200, { ok: true, canvas: blankCanvasSummary(written, user) });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/blank-duplicate-personal") {
    const body = await readBody(req);
    const user = currentUserFromRequest(req);
    const state = readCanvasState(body.projectId || body.id || "");
    if (!state || !userCanAccessCanvasState(user, state)) return fail(res, 404, "canvas not found");
    if (canvasScopeRecord(state).scope !== "team") return fail(res, 409, "只有团队画布可以复制为个人画布");
    const written = duplicateBlankCanvasAsPersonal(state, user);
    return send(res, 200, { ok: true, canvas: blankCanvasSummary(written, user) });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/video-generations") {
    const body = await readBody(req);
    const usageGate = assertUserCanSubmitVideoTask(req, 1);
    const projectRequest = resolveCanvasProjectVideoRequest(body);
    if (projectRequest.project) {
      assertUserCanAccessProject(req, projectRequest.episodeRoot);
      if (!projectRequest.shotName) throw new Error(projectRequest.error || "项目视频片段缺少可解析的片段名");
      const projectResult = await generateProjectVideoShot(projectRequest.episodeRoot, {
        ...body,
        shotName: projectRequest.shotName,
        authUser: usageGate.user,
        pollInBackground: true,
      });
      return send(res, 200, {
        ok: true,
        result: projectResult.result || projectResult,
        projectResult,
        state: fullProjectState(projectRequest.episodeRoot),
        routedToProject: true,
      });
    }
    const result = await createCanvasVideoGeneration(body);
    recordUserVideoTask(usageGate.user, {
      kind: "canvas",
      projectId: body.projectId || body.canvasProjectId || "",
      nodeId: body.nodeId || "",
      taskId: result.taskId || "",
      provider: result.provider || "",
      completed: result.status === "completed" || !!result.videoUrl,
    });
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/project-video-generate") {
    const body = await readBody(req);
    const usageGate = assertUserCanSubmitVideoTask(req, 1);
    const episodeRoot = episodeRootFromCanvasProjectId(body.projectId || "");
    if (!episodeRoot) throw new Error("画布缺少有效项目 ID，不能提交项目片段生成");
    assertUserCanAccessProject(req, episodeRoot);
    const result = await generateProjectVideoShot(episodeRoot, {
      ...body,
      shotName: body.shotName || body.name || "",
      authUser: usageGate.user,
      pollInBackground: true,
    });
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/video-generations/preview-payload") {
    const body = await readBody(req);
    const projectRequest = resolveCanvasProjectVideoRequest(body);
    if (projectRequest.project) {
      if (!projectRequest.shotName) throw new Error(projectRequest.error || "项目视频片段缺少可解析的片段名");
      throw new Error("项目视频片段不能走普通画布 payload 预览；请使用项目生成链路，避免绕过尾帧 asset:// 转换和素材库校验。");
    }
    const provider = canvasVideoProviderForBody(body);
    const payload = provider === "gravitex"
      ? await buildGravitexVideoGenerationPayload(body)
      : provider === "byteplus"
        ? await buildSeedanceGenerationPayload({ ...body, __provider: "byteplus" })
        : await buildSeedanceGenerationPayload(body);
    return send(res, 200, {
      ok: true,
      provider,
      payload: {
        ...payload,
        content: Array.isArray(payload.content)
          ? payload.content.map((item) => {
              const url = item.image_url?.url || item.video_url?.url || item.audio_url?.url || "";
              return {
                ...item,
                image_url: item.image_url ? { url: url.startsWith("data:") ? `[data-url ${url.length} chars]` : url } : undefined,
                video_url: item.video_url,
                audio_url: item.audio_url,
              };
            })
          : payload.content,
        startFrameBase64: payload.startFrameBase64 ? `[image ${String(payload.startFrameBase64).length} chars]` : payload.startFrameBase64,
      },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/tail-frame") {
    const tailBody = await readBody(req);
    const tailProjectId = compactLine(tailBody.projectId || "standalone") || "standalone";
    if (tailProjectId !== "standalone") {
      // projectId 若解析到一个真实存在的项目根(persistCanvasTailFrame 会往其 09_tail_frames 写),
      // 必须校验归属,防止越权把尾帧写进他人项目;独立画布(解析不到项目根)维持原行为。
      const tailRoot = path.resolve(decodeIdSafe(tailProjectId) || "");
      if (tailRoot && allowedPath(tailRoot) && fs.existsSync(tailRoot)) assertUserCanAccessProject(req, tailRoot);
    }
    const result = await persistCanvasTailFrame(tailBody);
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/liveness-face-session") {
    const result = await createLivenessFaceSession(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/person-asset-group") {
    const result = await createGravitexAigcAssetGroup(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/person-asset") {
    const result = await createOrRefreshGravitexAsset(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/ark-virtual-person") {
    const result = await createArkVirtualPersonAsset(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "GET" && url.pathname === "/api/canvas/ark-virtual-person") {
    const result = await getArkVirtualPersonAsset(url.searchParams.get("assetId") || "");
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/photoreal-assets/validate") {
    const result = await validateCanvasPhotorealAssets(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "GET" && url.pathname === "/api/canvas/person-assets") {
    const result = await listGravitexLivenessAssets({ groupId: url.searchParams.get("groupId") || "" });
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/liveness-face-asset") {
    const result = await createOrRefreshGravitexLivenessAsset(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "GET" && url.pathname === "/api/canvas/liveness-face-assets") {
    const result = await listGravitexLivenessAssets({ groupId: url.searchParams.get("groupId") || "" });
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/public-assets") {
    const result = await createPublicCanvasAsset(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "GET" && url.pathname === "/api/asset-library") {
    const userId = assetLibraryUserId(req);
    const membership = teamMembershipForUser(userId);
    if (membership) syncTeamAssetLibraryForUser({ id: userId });
    const assets = assetLibrary.list({
      userId,
      teamId: membership?.teamId || "",
      search: url.searchParams.get("search") || "",
      limit: url.searchParams.get("limit") || 100,
    }).map(publicAssetLibraryRecord);
    return send(res, 200, { ok: true, assets });
  }

  const assetLibraryMatch = url.pathname.match(/^\/api\/asset-library\/([^/]+)$/);
  if (req.method === "GET" && assetLibraryMatch) {
    const userId = assetLibraryUserId(req);
    const membership = teamMembershipForUser(userId);
    const asset = assetLibrary.get(decodeURIComponent(assetLibraryMatch[1]), { userId, teamId: membership?.teamId || "" });
    if (!asset) return fail(res, 404, "素材库资产不存在");
    return send(res, 200, { ok: true, asset: publicAssetLibraryRecord(asset) });
  }

  if (req.method === "POST" && url.pathname === "/api/asset-library") {
    const userId = assetLibraryUserId(req);
    const asset = await saveAssetToLibrary(await readBody(req), userId);
    return send(res, 200, { ok: true, asset });
  }

  if (req.method === "DELETE" && assetLibraryMatch) {
    const userId = assetLibraryUserId(req);
    const membership = teamMembershipForUser(userId);
    const assetId = decodeURIComponent(assetLibraryMatch[1]);
    const asset = assetLibrary.get(assetId, { userId, teamId: membership?.teamId || "" });
    if (!asset) return fail(res, 404, "素材库资产不存在");
    const removed = assetLibrary.remove(assetId, { userId });
    if (!removed) return fail(res, 404, "素材库资产不存在");
    return send(res, 200, { ok: true, removed: true });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/video-assets") {
    const result = await createCanvasVideoAsset(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/image-storyboard-plan") {
    const result = await createImageStoryboardPlan(await readBody(req));
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/image-generation") {
    const body = await readBody(req);
    const userId = assetLibraryUserId(req);
    const result = await createCanvasImageGeneration({ ...body, ownerUserId: userId });
    return send(res, 200, { ok: true, result });
  }

  const canvasImageMatch = url.pathname.match(/^\/api\/canvas\/image-generations\/([^/]+)$/);
  if (req.method === "GET" && canvasImageMatch) {
    return send(
      res,
      200,
      { ok: true, result: getCanvasImageGeneration(decodeURIComponent(canvasImageMatch[1])) },
      { "Cache-Control": "no-store" },
    );
  }

  const canvasVideoMatch = url.pathname.match(/^\/api\/canvas\/video-generations\/([^/]+)$/);
  if (req.method === "GET" && canvasVideoMatch) {
    const result = await getCanvasVideoGeneration(decodeURIComponent(canvasVideoMatch[1]), url.searchParams.get("provider") || "");
    if (["completed", "failed"].includes(String(result.status || "").toLowerCase())) {
      markUserVideoTaskFinished(currentUserFromRequest(req), result.taskId || decodeURIComponent(canvasVideoMatch[1]));
    }
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "POST" && url.pathname === "/api/extract-script") {
    const body = await readBody(req);
    return send(res, 200, { ok: true, text: extractUploadedScript(body) });
  }

  if (req.method === "POST" && url.pathname === "/api/asset-analyzer-key") {
    const body = await readBody(req);
    const key = compactLine(body.apiKey || "");
    if (!key) {
      runtimeAssetAnalyzerApiKey = "";
      runtimeAssetAnalyzerKeySource = "";
      return send(res, 200, { ok: true, runtime: runtimeStatus() });
    }
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error("资产解析 API Key 格式不正确");
    runtimeAssetAnalyzerApiKey = key;
    runtimeAssetAnalyzerKeySource = "临时会话";
    return send(res, 200, { ok: true, runtime: runtimeStatus() });
  }

  if (req.method === "POST" && url.pathname === "/api/series-preflight") {
    const body = await readBody(req);
    const scriptText = typeof body.scriptText === "string" ? body.scriptText : "";
    if (!scriptText.trim()) throw new Error("请先粘贴或上传短剧剧本");
    return send(res, 200, { ok: true, result: analyzeSeriesPreflight({ scriptText, title: body.title || body.projectName || "" }) });
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const user = currentUserFromRequest(req);
    const body = await readBody(req);
    const requestedDisplayName = cleanProjectDisplayTitle(body.title || body.projectName || "");
    const projectName = safeSlug(body.projectName || body.title || "untitled_project");
    const requestedSlug = safeSlug(body.episodeSlug || "e01");
    const requestedProjectDir = body.projectDir ? path.resolve(body.projectDir) : path.join(DEFAULT_PROJECT_ROOT, projectName);
    let projectDir = requestedProjectDir;
    let slug = requestedSlug;
    if (body.reuseExistingProject !== true) {
      if (!body.projectDir && fs.existsSync(path.join(projectDir, "outputs", slug))) {
        projectDir = uniqueProjectDir(projectDir);
      } else {
        slug = uniqueEpisodeSlug(projectDir, slug);
      }
    }
    if (!allowedPath(projectDir)) throw new Error("projectDir is outside allowed roots");
    // 归属护栏:目标项目目录若已存在且含"他人拥有"的 episode,拒绝——防止用 projectDir/reuseExistingProject
    // 复用进他人项目从而越权读(fullProjectState)或写(脚本)。无主的遗留 episode 不拦(可被认领)。
    const targetOutputsDir = path.join(projectDir, "outputs");
    if (fs.existsSync(targetOutputsDir)) {
      const hasForeignEpisode = fs
        .readdirSync(targetOutputsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(targetOutputsDir, entry.name))
        .some((er) => projectOwner(er).ownerUserId && !userCanAccessProject(user, er));
      if (hasForeignEpisode) {
        const error = new Error("project not found");
        error.statusCode = 404;
        throw error;
      }
    }
    const { episodeRoot } = createEpisodeWorkspace(projectDir, slug, body.title || slug);
    persistProjectOwner(episodeRoot, user);
    const hasScriptText = typeof body.scriptText === "string" && body.scriptText.trim();
    if (hasScriptText) writeScriptWithWorkflowIsolation(episodeRoot, body.scriptText, "new project script");
    else ensureWorkflowNamespace(episodeRoot, "new project");
    // 「资产描述」独立输入(只做资产解析,不影响剧情/分镜);建项目时一并落盘。
    if (typeof body.assetDescriptionText === "string") writeAssetDescription(episodeRoot, body.assetDescriptionText);
    if (requestedDisplayName) persistProjectDisplayName(episodeRoot, requestedDisplayName);
    return send(res, 200, fullProjectState(episodeRoot));
  }

  const projectMatch = url.pathname.match(/^\/api\/project\/([^/]+)(?:\/(.+))?$/);
  if (!projectMatch) return fail(res, 404, "not found");
  const episodeRoot = path.resolve(decodeId(projectMatch[1]));
  if (!allowedPath(episodeRoot) || !fs.existsSync(episodeRoot)) return fail(res, 404, "project not found");
  assertUserCanAccessProject(req, episodeRoot);
  const action = projectMatch[2] || "";

  if (req.method === "POST" && action !== "duplicate-personal") {
    const modifyingUser = currentUserFromRequest(req);
    res.once("finish", () => {
      if (res.statusCode >= 400 || !fs.existsSync(episodeRoot)) return;
      const workflow = readWorkflowState(episodeRoot);
      writeWorkflowState(episodeRoot, {
        ...workflow,
        lastModifiedByUserId: modifyingUser.id,
        lastModifiedByUsername: modifyingUser.username || "",
        lastModifiedAt: new Date().toISOString(),
      });
    });
  }

  if (req.method === "DELETE" && !action) {
    assertUserCanDeleteProject(req, episodeRoot);
    const result = deleteProjectFiles(episodeRoot);
    return send(res, 200, { ok: true, result });
  }

  if (req.method === "GET" && !action) {
    const user = currentUserFromRequest(req);
    return send(res, 200, fullProjectStateForUser(episodeRoot, user));
  }

  if (req.method === "GET" && action === "status") {
    const user = currentUserFromRequest(req);
    return send(res, 200, projectStatusSnapshotForUser(episodeRoot, user));
  }

  const referenceKitBindingMatch = action.match(/^reference-kits\/([^/]+)\/(bind|unbind)$/);
  if (req.method === "GET" && action === "reference-kits") {
    const workflow = readWorkflowState(episodeRoot);
    const config = ensureVideoConfigIsolation(episodeRoot);
    return send(res, 200, { ok: true, ...projectReferenceKitState(workflow, config?.data || {}) });
  }

  if (req.method === "POST" && action === "reference-kits") {
    const body = await readBody(req);
    const workflow = readWorkflowState(episodeRoot);
    const kits = projectReferenceKits(workflow);
    const requestedId = compactLine(body.id || "");
    const existingIndex = requestedId ? kits.findIndex((kit) => kit.id === requestedId) : -1;
    const previous = existingIndex >= 0 ? kits[existingIndex] : null;
    const kit = normalizeReferenceKit(
      {
        ...body,
        id: requestedId || `kit_${crypto.randomUUID()}`,
      },
      { previous, now: new Date().toISOString() },
    );
    const nextKits = [...kits];
    if (existingIndex >= 0) nextKits[existingIndex] = kit;
    else nextKits.push(kit);
    writeWorkflowState(episodeRoot, { ...workflow, referenceKits: nextKits });
    return send(res, 200, fullProjectStateForUser(episodeRoot, currentUserFromRequest(req)));
  }

  if (req.method === "POST" && referenceKitBindingMatch) {
    const kitId = decodeURIComponent(referenceKitBindingMatch[1]);
    const operation = referenceKitBindingMatch[2];
    const workflow = readWorkflowState(episodeRoot);
    const kit = projectReferenceKits(workflow).find((item) => item.id === kitId);
    if (!kit) return fail(res, 404, "Reference Kit 不存在");
    const body = await readBody(req);
    const shotName = compactLine(body.shotName || body.shotId || "");
    const configRecord = ensureVideoConfigIsolation(episodeRoot);
    if (!configRecord?.data || !Array.isArray(configRecord.data.shots)) return fail(res, 409, "当前项目还没有可绑定的 Shot");
    const shotIndex = configRecord.data.shots.findIndex((shot, index) => compactLine(shot?.name || shot?.id || `shot_${index + 1}`) === shotName);
    if (shotIndex < 0) return fail(res, 404, "Shot 不存在");
    const currentShot = configRecord.data.shots[shotIndex];
    const nextShot = operation === "bind"
      ? bindReferenceKitToShot(currentShot, kit)
      : unbindReferenceKitFromShot(currentShot, kit);
    const nextShots = [...configRecord.data.shots];
    nextShots[shotIndex] = nextShot;
    writeVideoConfigRecord(configRecord, { ...configRecord.data, shots: nextShots });
    return send(res, 200, fullProjectStateForUser(episodeRoot, currentUserFromRequest(req)));
  }

  const referenceKitDeleteMatch = action.match(/^reference-kits\/([^/]+)$/);
  if (req.method === "DELETE" && referenceKitDeleteMatch) {
    const kitId = decodeURIComponent(referenceKitDeleteMatch[1]);
    const workflow = readWorkflowState(episodeRoot);
    const kits = projectReferenceKits(workflow);
    if (!kits.some((kit) => kit.id === kitId)) return fail(res, 404, "Reference Kit 不存在");
    const nextWorkflow = { ...workflow, referenceKits: kits.filter((kit) => kit.id !== kitId) };
    const configRecord = ensureVideoConfigIsolation(episodeRoot);
    if (configRecord?.data && Array.isArray(configRecord.data.shots)) {
      const deletedKit = kits.find((kit) => kit.id === kitId);
      const nextShots = configRecord.data.shots.map((shot) => shot?.referenceKitId === kitId ? unbindReferenceKitFromShot(shot, deletedKit) : shot);
      writeVideoConfigRecord(configRecord, { ...configRecord.data, shots: nextShots });
    }
    writeWorkflowState(episodeRoot, nextWorkflow);
    return send(res, 200, fullProjectStateForUser(episodeRoot, currentUserFromRequest(req)));
  }

  if (req.method === "POST" && action === "references") {
    const user = currentUserFromRequest(req);
    const body = await readBody(req);
    const descriptor = findTeamResourceDescriptor(user, {
      sourceProjectId: compactLine(body.sourceProjectId || ""),
      sourceResourceType: compactLine(body.sourceResourceType || ""),
      sourceResourceId: compactLine(body.sourceResourceId || ""),
    });
    if (!descriptor) return fail(res, 404, "团队资源不存在或无权访问");
    const workflow = readWorkflowState(episodeRoot);
    const references = Array.isArray(workflow.teamReferences) ? workflow.teamReferences : [];
    const duplicate = references.some(
      (reference) =>
        reference.sourceProjectId === descriptor.sourceProjectId &&
        reference.sourceResourceType === descriptor.sourceResourceType &&
        reference.sourceResourceId === descriptor.sourceResourceId,
    );
    if (duplicate) return fail(res, 409, "该团队资源已经引用");
    const referenceId = `ref_${crypto.randomUUID()}`;
    const snapshot = snapshotForTeamResource(episodeRoot, descriptor, referenceId);
    const reference = createReference({
      sourceTeamId: descriptor.sourceTeamId,
      sourceProjectId: descriptor.sourceProjectId,
      sourceResourceType: descriptor.sourceResourceType,
      sourceResourceId: descriptor.sourceResourceId,
      snapshot,
      versionPayload: descriptor.versionPayload,
      referencedByUserId: user.id,
      generateId: () => referenceId,
    });
    writeWorkflowState(episodeRoot, { ...workflow, teamReferences: [...references, reference] });
    return send(res, 200, fullProjectStateForUser(episodeRoot, user));
  }

  const referenceUpdateMatch = action.match(/^references\/([^/]+)\/update$/);
  if (req.method === "POST" && referenceUpdateMatch) {
    const user = currentUserFromRequest(req);
    const referenceId = decodeURIComponent(referenceUpdateMatch[1]);
    const workflow = readWorkflowState(episodeRoot);
    const references = Array.isArray(workflow.teamReferences) ? workflow.teamReferences : [];
    const index = references.findIndex((reference) => reference.id === referenceId);
    if (index < 0) return fail(res, 404, "引用不存在");
    const current = references[index];
    const descriptor = findTeamResourceDescriptor(user, current);
    if (!descriptor) return fail(res, 409, "来源资源不可用");
    const snapshot = snapshotForTeamResource(episodeRoot, descriptor, current.id);
    const updated = updateReference(current, snapshot, new Date(), descriptor.versionPayload);
    const nextReferences = [...references];
    nextReferences[index] = updated;
    writeWorkflowState(episodeRoot, { ...workflow, teamReferences: nextReferences });
    return send(res, 200, fullProjectStateForUser(episodeRoot, user));
  }

  if (req.method === "POST" && action === "team") {
    const user = currentUserFromRequest(req);
    if (!userOwnsProject(user, episodeRoot)) return fail(res, 403, "只有个人项目所有者可以加入团队");
    const membership = assertCurrentTeamMembership(user);
    const workflow = readWorkflowState(episodeRoot);
    if (resourceScope(workflow) === "team") return fail(res, 409, "项目已经属于团队");
    writeWorkflowState(episodeRoot, {
      ...workflow,
      scope: "team",
      teamId: membership.teamId,
      scopeChangedAt: new Date().toISOString(),
      scopeChangedByUserId: user.id,
    });
    const sharedAssetCount = shareProjectAssetsWithTeam(episodeRoot, membership.teamId, user.id);
    return send(res, 200, { ...fullProjectState(episodeRoot), sharedAssetCount });
  }

  if (req.method === "POST" && action === "duplicate-personal") {
    const user = currentUserFromRequest(req);
    if (projectScopeRecord(episodeRoot).scope !== "team") return fail(res, 409, "只有团队项目可以复制为个人项目");
    const copiedEpisodeRoot = duplicateTeamProjectAsPersonal(episodeRoot, user);
    return send(res, 200, fullProjectState(copiedEpisodeRoot));
  }

  if (req.method === "POST" && action === "display-name") {
    const body = await readBody(req);
    const displayName = cleanProjectDisplayTitle(body.displayName || body.title || "");
    if (!displayName) throw new Error("项目名称不能为空");
    persistProjectDisplayName(episodeRoot, displayName);
    return send(res, 200, fullProjectState(episodeRoot));
  }

  if (req.method === "POST" && action === "file") {
    const body = await readBody(req);
    const key = body.key;
    if (!["script", "assetDescription", "storyboard", "assetManifest", "assetPrompts", "seedancePrompts", "config"].includes(key)) throw new Error("invalid file key");
    if (key === "script") {
      writeScriptWithWorkflowIsolation(episodeRoot, body.content || "", "script file edited");
    } else if (key === "assetDescription") {
      // 「资产描述」独立输入,只做资产解析源,不触发剧情/分镜工作流重置。
      writeAssetDescription(episodeRoot, body.content || "");
    } else {
      const file = findProjectFile(episodeRoot, key);
      const content = body.content || "";
      const skipEmptySeedancePromptOverwrite =
        key === "seedancePrompts" &&
        !parsePromptSections(stripSeedancePromptRules(content)).some(isShotPromptSection) &&
        !!seedancePromptMarkdownFromConfig(readVideoConfig(episodeRoot)?.data || {});
      if (!skipEmptySeedancePromptOverwrite) writeText(file, content);
      if (key === "config") ensureVideoConfigIsolation(episodeRoot, { file, data: JSON.parse(body.content || "{}") });
    }
    return send(res, 200, fullProjectState(episodeRoot));
  }

  if (req.method === "POST" && action === "asset-manifest") {
    const body = await readBody(req);
    const incoming = typeof body.manifest === "string" ? JSON.parse(body.manifest) : body.manifest;
    if (!incoming || typeof incoming !== "object") throw new Error("资产解析格式不正确");
    const previous = readAssetManifest(episodeRoot)?.data || {};
    const manifest = normalizeAssetManifest({
      ...previous,
      ...incoming,
      confirmed: body.confirm === true ? true : !!incoming.confirmed,
      confirmedAt: body.confirm === true ? new Date().toISOString() : incoming.confirmedAt || previous.confirmedAt || "",
    });
    if (body.confirm === true && !manifest.items.length) throw new Error("资产解析为空，无法确认");
    writeAssetManifest(episodeRoot, manifest);
    return send(res, 200, fullProjectState(episodeRoot));
  }

  if (req.method === "POST" && action === "asset-prompt") {
    const body = await readBody(req);
    const current = readAssetManifest(episodeRoot)?.data;
    if (!current) throw new Error("请先完成资产提取");
    const manifest = updateAssetPromptInManifest(current, body.assetName, body.prompt);
    const written = writeAssetManifest(episodeRoot, manifest);
    return send(res, 200, { ok: true, assetManifest: written, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "video-prompt") {
    const body = await readBody(req);
    const configRecord = ensureVideoConfigIsolation(episodeRoot);
    if (!configRecord?.data || !Array.isArray(configRecord.data.shots)) throw new Error("请先生成视频配置");
    const config = updateVideoPromptInConfig(configRecord.data, body.shotName || body.name, body.prompt);
    const shot = config.shots.find((item) => item.name === compactLine(body.shotName || body.name));
    writeVideoConfigRecord(configRecord, config);
    if (shot) syncProjectShotsToCanvasState(episodeRoot, config, [shot], { forcePrompt: true });
    return send(res, 200, { ok: true, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "video-model") {
    const body = await readBody(req);
    const configRecord = ensureVideoConfigIsolation(episodeRoot);
    if (!configRecord?.data || !Array.isArray(configRecord.data.shots)) throw new Error("请先生成视频配置");
    const shotName = compactLine(body.shotName || body.name);
    const runNamespace = currentRunNamespace(episodeRoot, configRecord.data);
    const snapshot = snapshotStatusForShot(episodeRoot, shotName, { runNamespace });
    if (!snapshot?.failed && Number(snapshot?.statusCode) !== 3) throw new Error("仅生成失败的片段可以切换模型重试");
    const config = updateVideoModelForShotInConfig(configRecord.data, shotName, body.modelName || body.model);
    const shot = config.shots.find((item) => item.name === shotName);
    writeVideoConfigRecord(configRecord, config);
    if (shot) syncProjectShotsToCanvasState(episodeRoot, config, [shot]);
    return send(res, 200, { ok: true, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "asset-extract") {
    const result = await extractAssetManifest(episodeRoot, await readBody(req));
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "asset-upload") {
    const body = await readBody(req);
    const result = uploadBoundAsset(episodeRoot, body);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "asset-upload-local") {
    const body = await readBody(req);
    const result = uploadLocalAsset(episodeRoot, body);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "asset-import-library") {
    const body = await readBody(req);
    const result = await importAssetLibraryAsset(episodeRoot, body, assetLibraryUserId(req));
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "asset-style-reference") {
    const body = await readBody(req);
    const result = updateAssetStyleReference(episodeRoot, body);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "asset-delete") {
    const body = await readBody(req);
    const result = deleteAssetImage(episodeRoot, body);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "asset-manual") {
    const body = await readBody(req);
    const result = addManualAsset(episodeRoot, body);
    let job = null;
    if (body.generate !== false) {
      job = await startToolJob(episodeRoot, "asset-regenerate", {
        ...body,
        assetName: result.asset.id,
        quality: body.quality || "1k",
      });
    }
    return send(res, 200, { ok: true, result, job: job ? jobSummary(job) : null, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "storyboard-upload") {
    const body = await readBody(req);
    const result = uploadStoryboardAsset(episodeRoot, body);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "dialogue-language") {
    const body = await readBody(req);
    const targetLanguage = body.targetLanguage === "zh" ? "zh" : "en";
    const assumeEnglish = body.assumeEnglish === true;
    const script = typeof body.scriptText === "string" ? body.scriptText : readText(findProjectFile(episodeRoot, "script"));
    const result = await convertScriptDialogueLanguage(script, targetLanguage, body.assetAnalyzerModel, { assumeEnglish });
    // 熔断:提取到疑似误吞(对白块含场景卡/镜头/过半正文)→ 不写回,原样保留剧本,返回明确错误。
    if (result.aborted) {
      return send(res, 422, { ok: false, error: `对白语言切换已中止,未改动剧本:${result.abortReason}。请检查剧本格式或联系维护者。` });
    }
    // 已是英文对白(手动声明或自动检测):不调用模型、不改动剧本内容,仅记录对白语言。
    if (result.skipped) {
      persistProjectDialogueLanguage(episodeRoot, targetLanguage);
      return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
    }
    // 写回前先备份原剧本到 .script_history,任何意外都可回滚(此前事故正因无备份且直接覆写)。
    backupScriptBeforeOverwrite(episodeRoot, script, `dialogue-language-${targetLanguage}`);
    writeScriptWithWorkflowIsolation(episodeRoot, result.script, "dialogue language changed");
    persistProjectDialogueLanguage(episodeRoot, targetLanguage);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "draft") {
    ensureWorkflowNamespace(episodeRoot, "draft request");
    const result = await buildDraft(episodeRoot, await readBody(req));
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "config") {
    ensureWorkflowNamespace(episodeRoot, "config request");
    const result = await buildVideoConfig(episodeRoot, await readBody(req));
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "video-canvas") {
    const body = await readBody(req);
    const result = clearVideoArtifactsForNewCanvas(episodeRoot, body);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "video-generate") {
    const body = await readBody(req);
    const usageGate = assertUserCanSubmitVideoTask(req, 1);
    const result = await generateProjectVideoShot(episodeRoot, { ...body, authUser: usageGate.user });
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "video-generate-all") {
    const body = await readBody(req);
    const config = readVideoConfig(episodeRoot)?.data || {};
    const shots = Array.isArray(config.shots) ? config.shots : [];
    const requested = Array.isArray(body.shotNames) ? new Set(body.shotNames.map(compactLine).filter(Boolean)) : null;
    const selected = requested?.size ? shots.filter((shot) => requested.has(shot.name)) : shots;
    assertUserCanSubmitVideoTask(req, Math.max(1, selected.length || 1));
    const user = currentUserFromRequest(req);
    const result = await generateProjectVideoShotsSequentially(episodeRoot, { ...body, authUser: user });
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "assemble-final-cut") {
    const result = startFinalCutAssembly(episodeRoot);
    return send(res, 200, { ok: true, result, state: fullProjectState(episodeRoot) });
  }

  if (req.method === "POST" && action === "job") {
    const body = await readBody(req);
    const job = await startToolJob(episodeRoot, body.type, body);
    return send(res, 200, { ok: true, job });
  }

  if (req.method === "POST" && action === "job-cancel") {
    const body = await readBody(req);
    const job = cancelJob(episodeRoot, body.jobId);
    return send(res, 200, { ok: true, job, state: fullProjectState(episodeRoot) });
  }

  return fail(res, 404, "not found");
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = path.join(APP_ROOT, "public", pathname);
  if (!isInside(path.join(APP_ROOT, "public"), file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return fail(res, 404, "not found");
  }
  const ext = path.extname(file).toLowerCase();
  send(res, 200, fs.readFileSync(file), {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
}

function contentDispositionName(file) {
  const fallback = "asset";
  const name = path.basename(file) || fallback;
  const ascii = name.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || fallback;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function contentDispositionFileName(name, fallback = "video.mp4") {
  const cleanName = path.basename(compactLine(name || fallback)) || fallback;
  const ascii = cleanName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || fallback;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`;
}

async function proxyVideoDownload(req, res, url) {
  const target = compactLine(url.searchParams.get("url") || "");
  if (!/^https?:\/\//i.test(target)) return fail(res, 400, "缺少有效视频地址");
  const parsed = new URL(target);
  if (!["http:", "https:"].includes(parsed.protocol)) return fail(res, 400, "不支持的视频地址");
  const fileName = compactLine(url.searchParams.get("name") || path.basename(parsed.pathname) || "pixel-toys-video.mp4");
  const upstream = await fetch(target);
  if (!upstream.ok || !upstream.body) return fail(res, upstream.status || 502, `视频下载失败：HTTP ${upstream.status || 502}`);
  const contentType = upstream.headers.get("content-type") || "";
  if (contentType && !/^video\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    return fail(res, 400, "远端地址不是可下载的视频文件");
  }
  res.writeHead(200, {
    "Content-Type": contentType || "video/mp4",
    "Content-Disposition": contentDispositionFileName(fileName),
    "Cache-Control": "no-store",
    ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length") } : {}),
  });
  await pipeline(upstream.body, res);
}

function serveMedia(req, res, file, options = {}) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const range = req.headers.range;
  const disposition = options.download ? { "Content-Disposition": contentDispositionName(file) } : {};
  // Versioned URLs (/media?...&v=<mtime-size-ino>) are content-addressed: any
  // change to the file changes v and therefore the URL, so we can cache them
  // hard. This stops every page refresh from re-downloading all asset images.
  const versioned = !options.download && /[?&]v=/.test(req.url || "");
  // 缩略图按源文件 mtime+size 落盘缓存,内容稳定;给它一个中期浏览器缓存,
  // 消除"每次刷新全量重下预览图"的延迟。带 v= 的仍走 immutable 强缓存。
  const cacheControl = versioned
    ? "public, max-age=31536000, immutable"
    : options.cacheSeconds
      ? `public, max-age=${options.cacheSeconds}`
      : "no-store";
  if (!range) {
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      ...disposition,
    });
    const stream = fs.createReadStream(file);
    stream.on("error", (error) => res.destroy(error));
    stream.pipe(res);
    return;
  }
  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    return res.end();
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    return res.end();
  }
  res.writeHead(206, {
    "Content-Type": contentType,
    "Content-Length": String(end - start + 1),
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ...disposition,
  });
  fs.createReadStream(file, { start, end }).pipe(res);
}

const server = http.createServer(async (req, res) => {
  // Defensive headers applied to every response. Set via setHeader so they
  // merge with (and are preserved through) later res.writeHead calls.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  // 扫描器/爬虫常发畸形路径(如 //%252eenv、//?phpinfo=1),new URL 会抛
  // TypeError: Invalid URL。必须在总 try 之前兜住,否则未捕获异常会让整个进程
  // 崩溃重启,并清空内存里的视频生成队列。畸形 URL 直接回 400。
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return fail(res, 400, "bad request url");
  }
  try {
    if (isAuthApiPath(url.pathname)) return await handleAuthApi(req, res, url);
    if (url.pathname === "/api/super-pixel/chat") return await handleSuperPixelChat(req, res, url);
    if (!requireAuth(req, res, url)) return;
    if (isAdminApiPath(url.pathname)) return await handleAdminApi(req, res, url);
    if (url.pathname === "/media") {
      const file = path.resolve(url.searchParams.get("path") || "");
      if (!allowedPath(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, "media not found");
      const episodeRoot = episodeRootForFile(file);
      if (episodeRoot) assertUserCanAccessProject(req, episodeRoot);
      const download = url.searchParams.get("download") === "1";
      // 画布预览缩略图:?thumb=<宽> 时返回小图(下载/无 thumb 走原图);失败回退原图。
      const thumbParam = url.searchParams.get("thumb");
      if (thumbParam && !download) {
        const thumb = await ensureThumbnail(file, thumbParam);
        if (thumb) return serveMedia(req, res, thumb, { cacheSeconds: 86400 });
      }
      return serveMedia(req, res, file, { download });
    }
    if (url.pathname === "/api/canvas/video-download") return await proxyVideoDownload(req, res, url);
    if (url.pathname.startsWith("/public-assets/")) {
      const fileName = path.basename(decodeURIComponent(url.pathname.replace(/^\/public-assets\/+/, "")));
      const file = path.join(CANVAS_PUBLIC_ASSET_DIR, fileName);
      if (!fileName || !file.startsWith(CANVAS_PUBLIC_ASSET_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return fail(res, 404, "public asset not found");
      }
      const thumbParam = url.searchParams.get("thumb");
      if (thumbParam) {
        const thumb = await ensureThumbnail(file, thumbParam);
        if (thumb) return serveMedia(req, res, thumb, { cacheSeconds: 86400 });
      }
      return serveMedia(req, res, file);
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return fail(res, error.statusCode || 500, error.message, process.env.NODE_ENV === "development" ? error.stack : undefined);
  }
});

// 畸形 HTTP(坏请求行/头)在解析层触发,不会进入 requestListener。默认行为是
// 直接销毁连接,但要显式兜底避免噪声;这里回 400 后关闭,不影响进程存活。
server.on("clientError", (err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

if (require.main === module) {
  // 最后一道防线:任何未捕获异常/未处理 Promise 只记录,绝不让进程崩溃。
  // 视频生成队列存活在内存中,一次崩溃重启会清空整批进行中的任务(一次事故的根因)。
  //
  // 必须留在 require.main 守卫内。放在模块顶层时,所有 require 本文件的测试都会
  // 继承这个处理器:异步断言失败被它吞掉只打日志,进程正常结束、退出码 0,
  // npm test 的 && 链照常往下走 —— 17 个 import server.js 的测试文件里的断言
  // 全变成装饰品(2026-07-27 实测:把工具循环上限从 5 改成 3,断言报错但退出码仍为 0)。
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err && err.stack ? err.stack : err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason && reason.stack ? reason.stack : reason);
  });

  server.listen(PORT, () => {
    console.log(`Pixel Toys running at http://localhost:${PORT}`);
    console.log(`Workspace: ${APP_ROOT}`);
  });
}

// 供隔离测试/冒烟脚本 require 后调用(require.main !== module 时不监听端口)。
module.exports = {
  server,
  prepareBatchVideoReferences,
  readVideoConfig,
  __test: {
    superPixel: {
      handle: handleSuperPixelChat,
      setFetch(fetchImpl) {
        superPixelFetch = typeof fetchImpl === "function" ? fetchImpl : (...args) => fetch(...args);
      },
      truncateScript: truncateSuperPixelScript,
      delta: superPixelDelta,
      messages: superPixelMessages,
      content: superPixelContent,
      resolveImages: superPixelResolveImages,
      referenceHandles: superPixelConversationImageHandles,
      agentPrompt: superPixelAgentSystemPrompt,
      resolveReferences: resolveSuperPixelReferenceImages,
      executeTool: executeSuperPixelTool,
      maxImages: SUPER_PIXEL_MAX_IMAGES_PER_MESSAGE,
    },
    draft: {
      buildDraft,
      draftAssetManifestForEpisode,
    },
    dialogue: {
      dialoguesForText,
      inlineColonDialogues,
      backfillDialogueSpeakers,
      normalizeDialogueItems,
      seedanceDialogueText,
      buildScriptSpeakerMap,
      parseSectionDialogueTexts,
      dialoguesForShotWithSpeakers,
      dialogueBlocksAreAllEnglish,
      convertScriptDialogueLanguage,
      extractDialogueBlocks,
    },
    assetParser: {
      assetManifestFromAssets,
      buildRuleAssets,
      parseDocxDocumentXml,
      parseStructuredAssetDescriptions,
      correctAssetRolesFromEvidence,
      inferWorldProfile,
      mergeAnalyzerAssets,
      buildModelDiscoveredAssets,
      isModelAssetLabelUsable,
      mergeTypedAnalyzerResults,
      callAssetAnalyzerModel,
      auditAssetRoles,
      runAssetAuditInBackground,
      extractAssetManifest,
      startToolJob,
      assetManifestIdentityChanged,
      invalidateDerivedVideoArtifactsForAssetManifestChange,
      seedanceReferenceLine,
      seedancePromptForShotMode,
      normalizeAssetManifest,
    },
    assetPrompt: {
      updateAssetPromptInManifest,
    },
    videoPrompt: {
      updateVideoPromptInConfig,
    },
    videoRetry: {
      updateVideoModelForShotInConfig,
      projectVideoModelForShot,
      projectVideoPayloadForShot,
      archiveShotVideoArtifactsForRegeneration,
    },
    assetJobRetry: {
      shouldAutoRetryTransientAssetJob,
      AUTO_RETRYABLE_ASSET_JOB_MAX_ATTEMPTS,
    },
    assetUpload: {
      uploadLocalAsset,
      projectProductionAssetsForState,
      resolveReferenceAssets,
    },
    dialogue: {
      extractDialogueBlocks,
      isSpeakerCueLine,
      dialogueBlocksLookSafe,
      blockquoteDialogues,
      convertScriptDialogueLanguage,
      dialogueBlocksAreAllEnglish,
      dialoguesForText,
      inlineColonDialogues,
      backfillDialogueSpeakers,
      normalizeDialogueItems,
      seedanceDialogueText,
      buildScriptSpeakerMap,
      parseSectionDialogueTexts,
      dialoguesForShotWithSpeakers,
    },
    canvasVideo: {
      canvasVideoProviderForBody,
      buildSeedanceGenerationPayload,
      normalizeVideoResolution,
    },
    videoReferences: {
      assertVideoConfigAssetsReady,
      projectShotUsableVideoReferenceAssets,
    },
    projectVideo: {
      generateProjectVideoShot,
      ensureTailFrameAssetReference,
    },
    canvasTailFrame: {
      persistCanvasTailFrame,
      resolveCanvasVideoLocalFile,
      extractCanvasTailFrameFromVideo,
    },
    canvasImageRef: {
      localPublicAssetPathFromUrl,
      CANVAS_PUBLIC_ASSET_DIR,
    },
    canvasAsset: {
      sourceCandidates: canvasAssetSourceCandidates,
      toPublicUrl: canvasAssetToPublicUrl,
    },
    canvasImage: {
      normalizeCanvasImageModel,
      canvasImageModelConfig,
      seedreamImageSizeFor,
      seedreamImageResult,
      seedreamImagePayload,
    },
    arkVirtualPerson: {
      buildOpenApiRequest: buildArkAssetOpenApiRequest,
      normalizeAssetResult: normalizeArkVirtualPersonAsset,
      createAsset: createArkVirtualPersonAsset,
      getAsset: getArkVirtualPersonAsset,
      sanitizeState: sanitizeCanvasState,
      mergeState: mergeCanvasStateForWrite,
      isArkPersonEligibleAsset,
      isCharacterRefAsset,
      isCanvasPhotorealAsset,
    },
  },
};
