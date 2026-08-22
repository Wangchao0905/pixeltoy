import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const source = fs.readFileSync(new URL("server.js", root), "utf8");

function extractFunction(signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
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
  compactLine(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  },
};
vm.createContext(context);
vm.runInContext(extractFunction("function isCanvasImagePolicyFailure("), context, { filename: "server.js" });
vm.runInContext(extractFunction("function policySafeCanvasImagePrompt("), context, { filename: "server.js" });

const refusal = JSON.stringify({
  code: "api_stream_error",
  message: "content_filter",
  detail: {
    status: 400,
    body: JSON.stringify({ error: { code: "content_policy_violation", message: "Request rejected by safety system" } }),
  },
});
assert.equal(context.isCanvasImagePolicyFailure(refusal), true, "content_filter must be recognized as a policy refusal");
assert.equal(context.isCanvasImagePolicyFailure('{"code":"network_error","message":"fetch failed"}'), false, "network failures must preserve the normal retry path");

const originalPrompt = "尸潮围住角色，鲜血流过地面，角色手持匕首对峙 zombie horde with blood and weapons";
const safePrompt = context.policySafeCanvasImagePrompt(originalPrompt);
assert.match(safePrompt, /age-appropriate, non-graphic/i, "the fallback must explicitly request a non-graphic render");
assert.doesNotMatch(safePrompt, /尸潮|鲜血|匕首|zombie|blood|weapons/i, "high-risk visual terms must be removed from the fallback");
assert.match(safePrompt, /角色|紧张/i, "the fallback must keep the narrative context");

const gptRunner = extractFunction("function runCanvasImageJob(");
assert.match(gptRunner, /isCanvasImagePolicyFailure/, "GPT canvas jobs must branch to the policy retry");
assert.match(gptRunner, /withCanvasImagePrompt\(args, policySafeCanvasImagePrompt\(entry\.prompt\)\)/, "GPT retries must replace only the child process prompt");
assert.doesNotMatch(gptRunner, /entry\.prompt\s*=/, "the original user prompt must remain unchanged");

console.log("canvas image policy retry tests passed");
