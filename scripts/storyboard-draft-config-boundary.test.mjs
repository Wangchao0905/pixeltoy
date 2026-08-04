import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const configStart = server.indexOf("async function buildVideoConfig(");
const configEnd = server.indexOf("// 仅重建一个视频片段的配置", configStart);
const configBody = server.slice(configStart, configEnd);
assert.match(configBody, /const modelPlan = storyboardDraftForConfig\(/);
assert.doesNotMatch(configBody, /await ensureModelShotPlanForConfig\(/);
assert.match(app, /data\?\.storyboardDraftStatus\?\.ready === true/);
assert.match(server, /分镜与视频提示词必须先由剧本页的「生成分镜草稿」完成/);

const context = {
  compactLine: (value) => String(value || "").trim(),
  readStoryboardModelPlan: () => null,
  normalizeAssetManifest: (value) => value || {},
  readAssetManifest: () => ({ data: {} }),
  assetManifestIdentityFingerprint: () => "fp",
  modelShotPlanNeedsRefresh: () => false,
  projectDurationMode: () => "tk",
  scriptForVideoBeats: (value) => value,
  cleanStoryScriptForDraft: (value) => value,
  findProjectFile: () => "script.md",
  readText: () => "script",
};
vm.createContext(context);
vm.runInContext(extractFunction(server, "function storyboardDraftForConfig("), context);
assert.throws(
  () => context.storyboardDraftForConfig("/project/e01", { script: "script", durationMode: "tk" }),
  /请先在剧本阶段点击.*生成分镜草稿/,
);

context.normalizeStoryboardModel = (value) => value || "gpt-5.6-sol";
context.storyboardApiKey = () => "test-key";
context.storyboardSystemPrompt = () => "system";
context.storyboardUserPrompt = ({ compact }) => compact ? "compact-prompt" : "full-prompt";
context.openAiCompatUrl = (path, kind) => `${kind}:${path}`;
context.stripJsonFence = (value) => value;
context.normalizeStoryboardPlan = (data, options) => ({ ok: true, model: options.model, shots: data.shots || [] });
const requests = [];
const responses = [
  { ok: false, status: 500, body: { error: { message: "Upstream gateway error" } } },
  { ok: true, status: 200, body: { choices: [{ message: { content: JSON.stringify({ shots: [{ id: "V001" }] }) } }] } },
];
context.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  const response = responses.shift();
  return { ok: response.ok, status: response.status, async text() { return JSON.stringify(response.body); } };
};
vm.runInContext(extractFunction(server, "async function callStoryboardModel("), context);
const result = await context.callStoryboardModel({
  script: "x".repeat(20000),
  assets: [{ name: "S001", type: "Scene", label: "站台", evidence: "x".repeat(1000), visual: "y".repeat(1000) }],
  dialogueLanguage: "zh",
  targetShotCount: 1,
  code: "E01",
  beats: ["站台"],
  durationPlan: { durations: [8], target: 8 },
});
assert.equal(requests.length, 2, "HTTP 500 should retry once with a compact request");
assert.equal(requests[0].model, "gpt-5.6-sol");
assert.equal(requests[1].model, "gpt-5.6-sol", "compact retry must keep the same director model");
assert.equal(requests[0].response_format.type, "json_object");
assert.equal(requests[1].response_format, undefined, "compact retry should avoid JSON mode gateway incompatibility");
assert.equal(result.model, "gpt-5.6-sol");

console.log("storyboard draft/config boundary tests passed");
