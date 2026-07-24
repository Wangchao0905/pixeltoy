import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const source = fs.readFileSync(new URL("scripts/run_asset_generation.js", root), "utf8");

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
  parseImageGenFailurePayload() {
    return null;
  },
};
vm.createContext(context);
vm.runInContext(extractFunction("function isPolicyImageGenFailure("), context, { filename: "run_asset_generation.js" });
vm.runInContext(extractFunction("function policySafeImagePrompt("), context, { filename: "run_asset_generation.js" });

assert.equal(
  context.isPolicyImageGenFailure('HTTP 400: 您的请求无法用于生成图像。该请求可能因安全政策被拦截。'),
  true,
  "a safety-policy response must trigger the one-time safe retry",
);
assert.equal(
  context.isPolicyImageGenFailure('{"code":"network_error","message":"fetch failed"}'), false, "network errors must keep their existing retry path");

const safePrompt = context.policySafeImagePrompt("尸潮围住角色，鲜血流过地面，角色手持匕首对峙 zombie horde with blood and weapons");
assert.match(safePrompt, /age-appropriate, non-graphic/i, "the retry must explicitly request a non-graphic render");
assert.doesNotMatch(safePrompt, /尸潮|鲜血|匕首|zombie|blood|weapons/i, "high-risk visual terms must be removed from the retry prompt");
assert.match(safePrompt, /角色|紧张/i, "the narrative context must remain available to the image model");

console.log("image policy retry tests passed");
