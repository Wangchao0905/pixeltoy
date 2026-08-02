const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function text(value, fallback = "未设定") {
  if (Array.isArray(value)) return value.filter(Boolean).join("、") || fallback;
  if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}：${item}`).join("；") || fallback;
  return String(value ?? "").trim() || fallback;
}

function safeFileName(value, fallback = "pixel-tale") {
  const result = String(value || "")
    .trim()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return result || fallback;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim()) || "未设定";
}

function fallbackCharacter(item, index) {
  const visual = item.visual_profile || item.visualProfile || {};
  const name = firstValue(item.name_zh, item.name_en, `人物${index + 1}`);
  const promptParts = [
    name,
    firstValue(visual.age_phase, item.age_phase, item.age),
    firstValue(visual.body, item.body),
    firstValue(visual.hair_color, item.hair_color),
    firstValue(visual.facial_features, item.facial_features),
    firstValue(visual.costume_accessories, item.costume_accessories),
    firstValue(visual.posture, item.posture, item.arc_zh, item.desire_zh),
  ].filter((value) => value !== "未设定");
  return {
    id: item.id || `P${String(index + 1).padStart(2, "0")}`,
    name_zh: name,
    name_en: item.name_en || "",
    type: "人物",
    aliases: firstValue(visual.aliases, item.aliases, item.role),
    gender: firstValue(visual.gender, item.gender),
    age_phase: firstValue(visual.age_phase, item.age_phase, item.age),
    body: firstValue(visual.body, item.body),
    hair_color: firstValue(visual.hair_color, item.hair_color),
    facial_features: firstValue(visual.facial_features, item.facial_features),
    eye_color: firstValue(visual.eye_color, item.eye_color),
    costume_accessories: firstValue(visual.costume_accessories, item.costume_accessories),
    palette: firstValue(visual.palette, item.palette),
    posture: firstValue(visual.posture, item.posture, item.arc_zh, item.desire_zh),
    prompt_zh: firstValue(visual.prompt_zh, item.prompt_zh, `${promptParts.join("，")}；电影级质感，统一剧集视觉风格。`),
  };
}

function fallbackScene(item, index) {
  const visual = item.visual_profile || item.visualProfile || {};
  const name = firstValue(item.name_zh, item.location_zh, `场景${index + 1}`);
  return {
    id: item.id || `S${String(index + 1).padStart(2, "0")}`,
    name_zh: name,
    name_en: item.name_en || "",
    type: "场景",
    aliases: firstValue(visual.aliases, item.aliases, item.location_zh),
    indoor_outdoor: firstValue(visual.indoor_outdoor, item.indoor_outdoor),
    lighting: firstValue(visual.lighting, item.lighting, item.visual_intent_zh),
    palette: firstValue(visual.palette, item.palette),
    materials: firstValue(visual.materials, item.materials),
    layout: firstValue(visual.layout, item.layout, item.action_zh),
    atmosphere: firstValue(visual.atmosphere, item.atmosphere, item.visual_intent_zh),
    prompt_zh: firstValue(visual.prompt_zh, item.prompt_zh, `${name}，${firstValue(item.visual_intent_zh, item.purpose_zh)}；电影级布光，统一剧集视觉风格。`),
  };
}

function fallbackProp(item, index) {
  const name = firstValue(item.name_zh, item.name, `道具${index + 1}`);
  return {
    id: item.id || `PR${String(index + 1).padStart(2, "0")}`,
    name_zh: name,
    name_en: item.name_en || "",
    type: "道具",
    aliases: firstValue(item.aliases, item.role),
    materials: firstValue(item.materials, item.material),
    appearance: firstValue(item.appearance, item.color_shape, item.description_zh),
    size: firstValue(item.size),
    texture: firstValue(item.texture, item.special_texture),
    prompt_zh: firstValue(item.prompt_zh, item.description_zh, `${name}，${firstValue(item.appearance, item.description_zh)}；电影级特写，统一剧集视觉风格。`),
  };
}

function fallbackVisualAssets({ characters = [], scenes = [], props = [], consistencyNotes = [] } = {}) {
  return {
    characters: characters.map(fallbackCharacter),
    scenes: scenes.map(fallbackScene),
    props: props.map(fallbackProp),
    consistency_notes: consistencyNotes,
    source: "structured-artifact-fallback",
  };
}

function writeVisualAssetDocument({ templateFile, scriptFile, outputFile, payload }) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const pythonBin = process.env.PIXELTALE_PYTHON_BIN || "python3";
  const result = spawnSync(pythonBin, [scriptFile, templateFile, outputFile], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 200000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || !fs.existsSync(outputFile)) {
    throw new Error(`视觉资产 DOCX 生成失败：${String(result.stderr || result.stdout || "未知错误").trim().slice(0, 500)}`);
  }
  return outputFile;
}

module.exports = { fallbackVisualAssets, safeFileName, text, writeVisualAssetDocument };
