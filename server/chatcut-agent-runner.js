#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function text(value) {
  return String(value || "").trim();
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

function requiredPath(env, name) {
  const value = text(env[name]);
  if (!value) throw new Error(`缺少 ${name}`);
  return path.resolve(value);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 ${label}：${error.message}`);
  }
}

function readFinalResult(file) {
  const output = fs.readFileSync(file, "utf8").trim();
  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Codex 未返回符合约定的 JSON 剪辑结果");
  }
}

function main(env = process.env) {
  const packageDir = requiredPath(env, "CHATCUT_PACKAGE_DIR");
  const manifestPath = requiredPath(env, "CHATCUT_MANIFEST_PATH");
  const editBriefPath = requiredPath(env, "CHATCUT_EDIT_BRIEF_PATH");
  const outputDir = requiredPath(env, "CHATCUT_OUTPUT_DIR");
  const jobFile = requiredPath(env, "CHATCUT_JOB_FILE");
  const episodeRoot = path.dirname(packageDir);
  for (const candidate of [manifestPath, editBriefPath, outputDir, jobFile]) {
    if (!isInside(episodeRoot, candidate)) throw new Error("ChatCut Agent 只能访问当前集制作目录");
  }
  if (!fs.statSync(manifestPath).isFile() || !fs.statSync(editBriefPath).isFile()) {
    throw new Error("ChatCut 制作包不完整");
  }
  const job = readJson(jobFile, "ChatCut 队列任务");
  fs.mkdirSync(outputDir, { recursive: true });

  if (truthy(env.CHATCUT_AGENT_DRY_RUN)) {
    return { ok: true, dryRun: true, jobId: text(job.id), message: "已验证 ChatCut Agent 输入，未调用 ChatCut 剪辑服务" };
  }

  const codexBin = text(env.CHATCUT_AGENT_CODEX_BIN) || "codex";
  const id = text(job.id || "job");
  const resultFile = path.join(outputDir, `.chatcut-${id}-result.json`);
  const schemaFile = path.join(outputDir, `.chatcut-${id}-schema.json`);
  fs.writeFileSync(schemaFile, `${JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["ok", "exportPath"],
    properties: {
      ok: { type: "boolean" },
      exportPath: { type: "string" },
      fileName: { type: "string" },
      projectId: { type: "string" },
    },
  })}\n`, { mode: 0o600 });
  const prompt = [
    "You are the production ChatCut editor for one episode. Use the configured ChatCut MCP tools, not a local video editor.",
    `Read the editing brief at ${editBriefPath} and the assembly manifest at ${manifestPath}.`,
    `Create or update the ChatCut project for episode ${text(job.project?.title || job.project?.id || job.id)}.`,
    "Import only the source media listed in the manifest. Build the timeline in manifest order and apply the brief's narrative, pacing, dialogue, music, and transition requirements.",
    `Export the completed episode as an MP4 into ${outputDir}. Do not publish it.`,
    "Before responding, verify that the exported MP4 exists at the specified path. Your final response must match the provided JSON schema with ok=true and the absolute exportPath.",
  ].join("\n");
  const timeoutMs = Math.max(60_000, Number(env.CHATCUT_AGENT_TIMEOUT_MS || 30 * 60 * 1000));
  const child = spawnSync(codexBin, [
    "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--cd", packageDir,
    "--add-dir", episodeRoot, "--output-schema", schemaFile, "--output-last-message", resultFile, prompt,
  ], { encoding: "utf8", timeout: timeoutMs, env });
  if (child.error) throw new Error(`无法启动 Codex Agent：${child.error.message}`);
  if (child.status !== 0) throw new Error(`Codex Agent 执行失败：${text(child.stderr || child.stdout).slice(-500)}`);
  const result = readFinalResult(resultFile);
  if (!result.ok) throw new Error("Codex Agent 未完成 ChatCut 剪辑");
  const exportPath = path.resolve(text(result.exportPath));
  if (!isInside(outputDir, exportPath) || !fs.existsSync(exportPath) || !fs.statSync(exportPath).isFile()) {
    throw new Error("Codex Agent 返回的导出文件不存在，或不在本集 exports 目录中");
  }
  return { ...result, exportPath, fileName: text(result.fileName) || path.basename(exportPath) };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(main())}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
