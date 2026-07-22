const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CHATCUT_QUEUE_FILE = "chatcut_job.json";
const CHATCUT_QUEUE_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
});

const STATUS_LABELS = {
  [CHATCUT_QUEUE_STATUS.QUEUED]: "等待服务器 Agent",
  [CHATCUT_QUEUE_STATUS.RUNNING]: "服务器 Agent 剪辑中",
  [CHATCUT_QUEUE_STATUS.SUCCEEDED]: "服务器 Agent 已完成",
  [CHATCUT_QUEUE_STATUS.FAILED]: "服务器 Agent 失败",
  [CHATCUT_QUEUE_STATUS.CANCELED]: "已取消",
};

function text(value) {
  return String(value || "").trim();
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function queueFile(episodeRoot) {
  return path.join(path.resolve(episodeRoot), "12_chatcut", CHATCUT_QUEUE_FILE);
}

function validRelativePath(value, fallback) {
  const candidate = text(value || fallback).replace(/\\/g, "/");
  if (!candidate || path.posix.isAbsolute(candidate) || candidate.split("/").includes("..")) {
    throw new Error("ChatCut 队列路径必须是项目内相对路径");
  }
  return candidate;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readQueueFile(episodeRoot) {
  const file = queueFile(episodeRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || !text(value.id)) return null;
    return value;
  } catch {
    return {
      status: CHATCUT_QUEUE_STATUS.FAILED,
      error: "chatcut_job.json 无法读取",
      updatedAt: new Date(0).toISOString(),
    };
  }
}

function createChatcutQueue(options = {}) {
  const env = options.env || process.env;
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const defaultMaxAttempts = Math.max(1, Math.min(5, Number(env.CHATCUT_AGENT_MAX_ATTEMPTS || 2)));
  const defaultStaleAfterMs = Math.max(60_000, Number(env.CHATCUT_AGENT_STALE_AFTER_MS || 30 * 60 * 1000));
  const defaultRetryDelayMs = Math.max(1_000, Number(env.CHATCUT_AGENT_RETRY_DELAY_MS || 15_000));

  function read(episodeRoot) {
    return readQueueFile(episodeRoot);
  }

  function write(episodeRoot, job) {
    const next = { ...job, updatedAt: nowIso(clock) };
    writeJsonAtomic(queueFile(episodeRoot), next);
    return next;
  }

  function enqueue(episodeRoot, input = {}) {
    const current = read(episodeRoot);
    const sourceDigest = text(input.sourceDigest);
    if (current && [CHATCUT_QUEUE_STATUS.QUEUED, CHATCUT_QUEUE_STATUS.RUNNING].includes(current.status)) {
      return { created: false, job: current };
    }
    if (current && current.status === CHATCUT_QUEUE_STATUS.SUCCEEDED && sourceDigest && current.sourceDigest === sourceDigest) {
      return { created: false, job: current };
    }
    const createdAt = nowIso(clock);
    const job = {
      schemaVersion: 1,
      id: `chatcut_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`,
      type: "chatcut-edit",
      status: CHATCUT_QUEUE_STATUS.QUEUED,
      label: STATUS_LABELS[CHATCUT_QUEUE_STATUS.QUEUED],
      project: input.project && typeof input.project === "object" ? input.project : {},
      sourceDigest,
      packageDir: validRelativePath(input.packageDir, "12_chatcut"),
      manifestFile: validRelativePath(input.manifestFile, "12_chatcut/assembly_manifest.json"),
      editBriefFile: validRelativePath(input.editBriefFile, "12_chatcut/edit_brief.md"),
      requestedBy: text(input.requestedBy),
      attempts: 0,
      maxAttempts: Math.max(1, Math.min(5, Number(input.maxAttempts || defaultMaxAttempts))),
      retryAt: "",
      workerId: "",
      createdAt,
      startedAt: "",
      finishedAt: "",
      heartbeatAt: "",
      result: null,
      error: "",
    };
    return { created: true, job: write(episodeRoot, job) };
  }

  function recover(episodeRoot, input = {}) {
    const current = read(episodeRoot);
    if (!current || current.status !== CHATCUT_QUEUE_STATUS.RUNNING) return current;
    const heartbeat = Date.parse(current.heartbeatAt || current.startedAt || "");
    const staleAfterMs = Math.max(0, Number(input.staleAfterMs ?? defaultStaleAfterMs));
    if (Number.isFinite(heartbeat) && clock() - heartbeat < staleAfterMs) return current;
    return write(episodeRoot, {
      ...current,
      status: CHATCUT_QUEUE_STATUS.QUEUED,
      label: STATUS_LABELS[CHATCUT_QUEUE_STATUS.QUEUED],
      workerId: "",
      retryAt: "",
      heartbeatAt: "",
      error: "上一次服务器 Agent 未完成，已恢复到队列",
      recoveredAt: nowIso(clock),
    });
  }

  function claim(episodeRoot, input = {}) {
    const current = read(episodeRoot);
    if (!current || current.status !== CHATCUT_QUEUE_STATUS.QUEUED) return null;
    const retryAt = Date.parse(current.retryAt || "");
    if (Number.isFinite(retryAt) && retryAt > clock()) return null;
    const timestamp = nowIso(clock);
    return write(episodeRoot, {
      ...current,
      status: CHATCUT_QUEUE_STATUS.RUNNING,
      label: STATUS_LABELS[CHATCUT_QUEUE_STATUS.RUNNING],
      workerId: text(input.workerId) || `worker_${process.pid}`,
      attempts: Number(current.attempts || 0) + 1,
      startedAt: current.startedAt || timestamp,
      heartbeatAt: timestamp,
      retryAt: "",
      error: "",
    });
  }

  function heartbeat(episodeRoot, input = {}) {
    const current = read(episodeRoot);
    if (!current || current.status !== CHATCUT_QUEUE_STATUS.RUNNING) return current;
    if (input.workerId && current.workerId !== input.workerId) return current;
    return write(episodeRoot, { ...current, heartbeatAt: nowIso(clock) });
  }

  function complete(episodeRoot, result = {}) {
    const current = read(episodeRoot);
    if (!current || current.status !== CHATCUT_QUEUE_STATUS.RUNNING) throw new Error("没有正在运行的 ChatCut 队列任务");
    const finishedAt = nowIso(clock);
    return write(episodeRoot, {
      ...current,
      status: CHATCUT_QUEUE_STATUS.SUCCEEDED,
      label: STATUS_LABELS[CHATCUT_QUEUE_STATUS.SUCCEEDED],
      finishedAt,
      heartbeatAt: finishedAt,
      result,
      error: "",
    });
  }

  function fail(episodeRoot, error, input = {}) {
    const current = read(episodeRoot);
    if (!current || current.status !== CHATCUT_QUEUE_STATUS.RUNNING) throw new Error("没有正在运行的 ChatCut 队列任务");
    const message = text(error?.message || error || "ChatCut Agent 执行失败").slice(0, 500);
    const retryable = input.retryable !== false && Number(current.attempts || 0) < Number(current.maxAttempts || defaultMaxAttempts);
    const timestamp = nowIso(clock);
    return write(episodeRoot, {
      ...current,
      status: retryable ? CHATCUT_QUEUE_STATUS.QUEUED : CHATCUT_QUEUE_STATUS.FAILED,
      label: STATUS_LABELS[retryable ? CHATCUT_QUEUE_STATUS.QUEUED : CHATCUT_QUEUE_STATUS.FAILED],
      retryAt: retryable ? new Date(clock() + defaultRetryDelayMs).toISOString() : "",
      finishedAt: retryable ? "" : timestamp,
      heartbeatAt: timestamp,
      error: message,
      lastError: message,
    });
  }

  function diagnose() {
    const url = text(env.CHATCUT_AGENT_URL);
    const token = text(env.CHATCUT_AGENT_TOKEN);
    const command = text(env.CHATCUT_AGENT_COMMAND);
    const mode = command ? "command" : url && token ? "http" : "disabled";
    return {
      provider: "chatcut",
      enabled: mode !== "disabled",
      mode,
      url: url || "",
      reason:
        mode === "disabled"
          ? "未配置 CHATCUT_AGENT_URL + CHATCUT_AGENT_TOKEN 或 CHATCUT_AGENT_COMMAND，任务只会写入队列"
          : mode === "command"
            ? "已配置服务器本机 ChatCut Agent 命令"
            : "已配置独立 ChatCut Agent HTTP 服务",
    };
  }

  return { read, write, enqueue, recover, claim, heartbeat, complete, fail, diagnose, queueFile };
}

module.exports = { CHATCUT_QUEUE_FILE, CHATCUT_QUEUE_STATUS, createChatcutQueue, queueFile };
