import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

assert.match(
  canvas,
  /function videoModeSummary\(node\)[\s\S]*?文生视频模式：无需图片连接，可直接用提示词生成。/,
  "video nodes without inputs must advertise direct text-to-video generation",
);
assert.match(
  canvas,
  /if \(!sources\.length\) return "文生视频模式：无需连接素材，可直接用提示词生成。";/,
  "video nodes without upstream connections must not ask for an image connection",
);
assert.match(
  canvas,
  /function videoNodeHasReferenceInputs\(node\)[\s\S]*?selectedFrameAssetsForVideoNode\(node\)[\s\S]*?effectiveNodeAssetIds\(node\)\.length/,
  "video submission must distinguish optional references from direct text-to-video",
);
assert.match(
  canvas,
  /function upstreamAssetsForNode\(node\)[\s\S]*?sourceNode\.assets \|\| \[\][\s\S]*?sourceNode\.generatedAssetId/,
  "video submission must include an upstream image node's generated asset even when its legacy assets array is empty",
);
assert.match(
  canvas,
  /if \(hasReferenceInputs\) \{[\s\S]*?ensurePhotorealReferencesReady\(\[node\]\)/,
  "reference readiness checks must not delay direct text-to-video submission",
);
assert.match(
  canvas,
  /generate\.addEventListener\("click", \(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?generateVideoNode\(node\.id\)/,
  "the generate button must remain isolated from the canvas drag surface",
);
assert.match(html, /canvas\.js\?v=[A-Za-z0-9._-]+/, "canvas.js must use a versioned URL");

console.log("canvas text-to-video tests passed");
