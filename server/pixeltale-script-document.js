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
  const source = payload?.sourceArtifacts || {};
  const arc = source.arc || {};
  const units = Array.isArray(arc.units) ? arc.units : [];
  const scenes = Array.isArray(source.scenes?.scenes) ? source.scenes.scenes : [];
  const dialogue = Array.isArray(source.dialogue?.lines) ? source.dialogue.lines : [];
  const expected = Number(payload?.input?.episodeCount) || Number(String(payload?.episode_scale || "").match(/\d+/)?.[0]) || 0;
  const coveredUnits = new Set(scenes.map((scene) => Number(scene?.unit_number)).filter((number) => Number.isInteger(number)));
  const sceneIds = new Set(scenes.map((scene) => String(scene?.id || "")).filter(Boolean));
  const dialogueSceneIds = new Set(dialogue.map((line) => String(line?.scene_id || "")).filter(Boolean));
  if (!expected || units.length !== expected || scenes.length < expected || [...Array(expected)].some((_, index) => !coveredUnits.has(index + 1)) || [...sceneIds].some((id) => !dialogueSceneIds.has(id))) {
    throw new Error(`正式剧本缺少逐集正文：期望 ${expected || "计划"} 集，分集 ${units.length}，场景 ${scenes.length}，对白 ${dialogue.length}`);
  }
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
