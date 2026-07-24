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
