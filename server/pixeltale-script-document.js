const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function safeFileName(value, fallback = "PixelTale") {
  const result = String(value || "")
    .trim()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return result || fallback;
}

function writeScriptDocument({ scriptFile, outputFile, payload }) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const pythonBin = process.env.PIXELTALE_PYTHON_BIN || "python3";
  const result = spawnSync(pythonBin, [scriptFile, outputFile], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 200000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || !fs.existsSync(outputFile)) {
    throw new Error(`正式剧本 DOCX 生成失败：${String(result.stderr || result.stdout || "未知错误").trim().slice(0, 600)}`);
  }
  return outputFile;
}

module.exports = { safeFileName, writeScriptDocument };
