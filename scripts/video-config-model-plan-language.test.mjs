import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");

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
  normalizeDialogueLanguage(value, fallback = "en") {
    if (["zh", "中文", "cn"].includes(value)) return "zh";
    if (["en", "英文"].includes(value)) return "en";
    return fallback === "zh" ? "zh" : "en";
  },
  sha1Text(value) {
    return `sha:${String(value || "")}`;
  },
};
vm.createContext(context);
vm.runInContext(extractFunction(server, "function modelPlanDialogueLanguageForConfig("), context, { filename: "server.js" });
vm.runInContext(extractFunction(server, "function modelShotPlanNeedsRefresh("), context, { filename: "server.js" });

const script = "场景一：林夏走进站台。";
const matchingPlan = { scriptFingerprint: `sha:${script}`, dialogueLanguage: "en" };

assert.equal(
  context.modelPlanDialogueLanguageForConfig(matchingPlan, script, "zh"),
  "en",
  "a valid model shot plan must win over a stale browser language value",
);
assert.equal(
  context.modelPlanDialogueLanguageForConfig(null, script, "zh"),
  "zh",
  "without a model shot plan the explicit request remains the fallback",
);
assert.equal(
  context.modelPlanDialogueLanguageForConfig({ ...matchingPlan, scriptFingerprint: "sha:old" }, script, "zh"),
  "zh",
  "a plan from another script must not silently become valid",
);
assert.equal(context.modelShotPlanNeedsRefresh(matchingPlan, script), false, "a matching persisted plan must not be rebuilt");
assert.equal(context.modelShotPlanNeedsRefresh(null, script), true, "legacy projects without a model plan must be rebuilt automatically");
assert.equal(
  context.modelShotPlanNeedsRefresh({ ...matchingPlan, scriptFingerprint: "sha:old" }, script),
  true,
  "a plan from an older script must be regenerated before configuration",
);

const ensureModelShotPlanForConfig = extractFunction(server, "async function ensureModelShotPlanForConfig(");
assert.match(
  ensureModelShotPlanForConfig,
  /await buildModelShotPlanForConfig\(episodeRoot, \{[\s\S]*?script,[\s\S]*?dialogueLanguage/,
  "a stale director plan must be rebuilt by the narrow model-plan builder",
);
assert.doesNotMatch(
  ensureModelShotPlanForConfig,
  /buildDraft\(/,
  "video config repair must not rebuild the whole draft workflow",
);

let recoveredPlan = null;
let modelPlanBuilds = 0;
context.readStoryboardModelPlan = () => recoveredPlan;
context.buildModelShotPlanForConfig = async (_episodeRoot, options) => {
  modelPlanBuilds += 1;
  recoveredPlan = { scriptFingerprint: `sha:${options.script}`, dialogueLanguage: options.dialogueLanguage };
};
context.buildDraft = async () => {
  throw new Error("whole draft rebuild must not run for video config repair");
};
vm.runInContext(ensureModelShotPlanForConfig, context, { filename: "server.js" });
const recovered = await context.ensureModelShotPlanForConfig("/project/e01", { script, dialogueLanguage: "en" });
assert.equal(modelPlanBuilds, 1, "a missing plan must invoke only the model-plan builder");
assert.equal(recovered, recoveredPlan, "the newly persisted model plan must be returned to config generation");

// 导演模型偶发返回坏 JSON 时，配置生成必须自动切换备用 GPT 导演模型，而不是直接提示失败。
context.normalizeStoryboardModel = (value) => value || "gpt-5.6-sol";
context.storyboardApiKey = () => "test-key";
context.storyboardSystemPrompt = () => "system";
context.storyboardUserPrompt = () => "user";
context.openAiCompatUrl = (path, kind) => `${kind}:${path}`;
context.stripJsonFence = (value) => value;
context.normalizeStoryboardPlan = (data, options) => ({ ok: true, model: options.model, shots: data.shots || [] });
const directorRequests = [];
const directorResponses = [
  { ok: true, status: 200, body: { choices: [{ message: { content: "not-json" } }] } },
  { ok: true, status: 200, body: { choices: [{ message: { content: JSON.stringify({ shots: [{ id: "V001" }] }) } }] } },
];
context.fetch = async (_url, options) => {
  directorRequests.push(JSON.parse(options.body));
  const response = directorResponses.shift();
  return { ok: response.ok, status: response.status, async text() { return JSON.stringify(response.body); } };
};
vm.runInContext(extractFunction(server, "async function callStoryboardModel("), context, { filename: "server.js" });
const directorRecovery = await context.callStoryboardModel({
  script,
  assets: [{ name: "S001", type: "Scene", label: "站台" }],
  dialogueLanguage: "en",
  targetShotCount: 1,
  code: "E01",
  beats: [script],
  durationPlan: { durations: [8], target: 8 },
});
assert.equal(directorRequests[0]?.model, "gpt-5.6-sol", "导演模型必须先使用默认模型");
assert.equal(directorRequests[1]?.model, "gpt-5.6-terra", "导演模型失败后必须切换备用模型");
assert.equal(directorRecovery.model, "gpt-5.6-terra", "备用导演模型成功结果必须继续进入配置流程");

assert.match(
  server,
  /const dialogueLanguage = modelPlanDialogueLanguageForConfig\(modelPlan, script, requestedDialogueLanguage\);/,
  "video config construction must use the persisted matching model plan language",
);
assert.match(
  server,
  /const modelPlan = await ensureModelShotPlanForConfig\(episodeRoot, \{[\s\S]*?script,[\s\S]*?dialogueLanguage: requestedDialogueLanguage/,
  "legacy or stale plans must be rebuilt from the model before video configuration continues",
);

console.log("video config model plan language tests passed");
