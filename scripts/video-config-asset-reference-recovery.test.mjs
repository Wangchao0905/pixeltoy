import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing server function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const context = {
  Map,
  compactLine: (value) => String(value || "").trim(),
  sha1Text: (value) => `sha1:${String(value || "")}`,
  assetLookupFromAssets: (assets = []) => new Map(assets.map((asset) => [asset.name, asset])),
  sanitizeSeedanceDesign: (design) => design || {},
  hasCompleteSeedanceDesign: (design) => design?.complete === true,
  clampShotDuration: (value) => Number(value) || 8,
  sceneRefForShotRefs: (refs = [], lookup) => refs.find((ref) => lookup.get(ref)?.manifestType === "Scene") || "",
};
context.Set = Set;
context.path = path;
context.normalizeAssetType = (value, fallback) => value || fallback;
vm.createContext(context);
// 分级拦截依赖真实的类型推断，必须一起装进沙箱。
for (const signature of [
  "function inferAssetTypeFromName(",
  "function assetTypeForLookupRecord(",
  "const BLOCKING_ASSET_TYPES =",
  "function blockingRefsMissing(",
  "function modelShotPlanForConfig(",
]) {
  vm.runInContext(extractFunction(server, signature), context, { filename: "server.js" });
}

const plan = {
  scriptFingerprint: "sha1:script",
  dialogueLanguage: "en",
  model: "test",
  shots: [
    {
      id: "V001",
      title: "Opening",
      beat: "A character enters an empty room.",
      duration: 8,
      refs: ["C001_HERO_CHARACTER_SHEET", "P001_KNIFE_PROP_REF"],
      design: { complete: true },
    },
    {
      id: "V002",
      title: "Empty room",
      beat: "The camera holds on the room.",
      duration: 8,
      refs: ["P002_LAMP_PROP_REF"],
      design: { complete: true },
    },
  ],
};

const result = context.modelShotPlanForConfig({
  modelPlan: plan,
  script: "script",
  dialogueLanguage: "en",
  assets: [{ name: "C001_HERO_CHARACTER_SHEET", manifestType: "Character" }],
});

assert.deepEqual(JSON.parse(JSON.stringify(result.shots[0].refs)), ["C001_HERO_CHARACTER_SHEET"], "only files that exist may remain video references");
assert.deepEqual(JSON.parse(JSON.stringify(result.shots[0].unavailableRefs)), ["P001_KNIFE_PROP_REF"], "missing prop assets must be surfaced for warnings");
assert.deepEqual(JSON.parse(JSON.stringify(result.shots[1].refs)), [], "a prop-only shot with no generated image may remain text-only");
assert.deepEqual(JSON.parse(JSON.stringify(result.shots[1].unavailableRefs)), ["P002_LAMP_PROP_REF"], "text-only shots must retain missing-reference diagnostics");

const builder = extractFunction(server, "async function buildVideoConfig(");
assert.match(builder, /以下资产图尚未生成，已从本次视频引用中排除/, "config build must expose excluded references as warnings");
assert.match(builder, /以下镜头当前没有可用资产图，将以文本提示词生成/, "config build must allow text-only shots instead of rejecting the whole configuration");
// 原先这里断言「任何缺图都不许中止配置」，那等于把 bug 固化：人物图缺失时用户会拿到
// 一个引用被清空的"成功"配置，生成一批没有人物的废片。缺图要分级——
// 人物/场景缺失由 modelShotPlanForConfig 拦截（见 video-config-reference-tier-guard.test.mjs），
// 只有道具/插入图缺失才允许退化成文本提示词。
assert.match(
  extractFunction(server, "function modelShotPlanForConfig("),
  /\|\|\s*missingBlockingRefs\.length\s*\|\|/,
  "character and scene images must still block video config generation",
);

console.log("video config asset reference recovery tests passed");
