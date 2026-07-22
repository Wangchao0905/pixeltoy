const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function text(value) {
  return String(value || "").trim();
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resultFrom(value) {
  const result = value?.result && typeof value.result === "object" ? value.result : value;
  const exportPath = text(result?.exportPath || result?.exportFile);
  // Dry-run 只验证制作包和路径，不会生成成片，因此不应要求 exportPath。
  if (!exportPath && result?.dryRun !== true) throw new Error("ChatCut Agent 未返回 exportPath");
  return exportPath ? { ...result, exportPath } : { ...result };
}

function createChatcutAgent(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || globalThis.fetch;

  function diagnose() {
    const url = text(env.CHATCUT_AGENT_URL);
    const token = text(env.CHATCUT_AGENT_TOKEN);
    const command = text(env.CHATCUT_AGENT_COMMAND);
    const mode = command ? "command" : url && token ? "http" : "disabled";
    return {
      provider: "chatcut",
      enabled: mode !== "disabled",
      mode,
      url,
      reason:
        mode === "disabled"
          ? "未配置 CHATCUT_AGENT_URL + CHATCUT_AGENT_TOKEN 或 CHATCUT_AGENT_COMMAND"
          : mode === "command"
            ? "使用服务器本机独立 Agent 命令"
            : "使用独立 Agent HTTP 服务",
    };
  }

  function requestBody(job, context = {}) {
    return {
      schemaVersion: 1,
      jobId: job.id,
      type: job.type,
      project: job.project || {},
      sourceDigest: job.sourceDigest || "",
      packageDir: job.packageDir,
      manifestFile: job.manifestFile,
      editBriefFile: job.editBriefFile,
      packagePath: context.packagePath || "",
      manifestPath: context.manifestPath || "",
      editBriefPath: context.editBriefPath || "",
      outputDir: context.outputDir || "",
    };
  }

  async function runHttp(job, context) {
    if (typeof fetchImpl !== "function") throw new Error("当前 Node 运行时没有 fetch，无法调用 ChatCut Agent");
    const url = text(env.CHATCUT_AGENT_URL);
    const token = text(env.CHATCUT_AGENT_TOKEN);
    const timeoutMs = Math.max(10_000, Number(env.CHATCUT_AGENT_TIMEOUT_MS || 30 * 60 * 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody(job, context)),
        signal: controller.signal,
      });
      const body = await response.text();
      const payload = safeJson(body) || { error: body.slice(0, 500) };
      if (!response.ok) throw new Error(`ChatCut Agent HTTP ${response.status}: ${text(payload.error || payload.message || "请求失败")}`);
      return resultFrom(payload);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`ChatCut Agent 请求超时（${Math.round(timeoutMs / 60_000)} 分钟）`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function runCommand(job, context) {
    const command = text(env.CHATCUT_AGENT_COMMAND);
    const timeoutMs = Math.max(10_000, Number(env.CHATCUT_AGENT_TIMEOUT_MS || 30 * 60 * 1000));
    const packagePath = context.packagePath || "";
    const jobFile = context.jobFile || path.join(packagePath, "chatcut_job.json");
    return new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", ["-lc", command], {
        cwd: packagePath || undefined,
        env: {
          ...process.env,
          CHATCUT_JOB_ID: job.id,
          CHATCUT_JOB_FILE: jobFile,
          CHATCUT_PACKAGE_DIR: packagePath,
          CHATCUT_MANIFEST_PATH: context.manifestPath || "",
          CHATCUT_EDIT_BRIEF_PATH: context.editBriefPath || "",
          CHATCUT_OUTPUT_DIR: context.outputDir || "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const append = (target, chunk) => (target + String(chunk || "")).slice(-1_000_000);
      child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`ChatCut Agent 命令启动失败：${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`ChatCut Agent 命令失败（${code}）：${text(stderr || stdout).slice(-500)}`));
          return;
        }
        const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
        const payload = lines.map(safeJson).find(Boolean);
        if (!payload) {
          reject(new Error("ChatCut Agent 命令未输出 JSON 结果"));
          return;
        }
        try {
          resolve(resultFrom(payload));
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async function run(job, context = {}) {
    const diagnosis = diagnose();
    if (!diagnosis.enabled) throw new Error(diagnosis.reason);
    return diagnosis.mode === "command" ? runCommand(job, context) : runHttp(job, context);
  }

  return { diagnose, requestBody, run };
}

module.exports = { createChatcutAgent };
