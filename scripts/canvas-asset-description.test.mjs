import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");

assert.match(
  canvas,
  /const manifestItems = new Map\([\s\S]*?assetManifest\?\.items/,
  "project asset import must read the manifest descriptions",
);
assert.ok(
  canvas.includes("|| manifestItem.visual") && canvas.includes("|| manifestItem.evidence"),
  "project asset import must prefer the parsed visual description and evidence",
);
assert.match(
  canvas,
  /function refreshCanvasProjectAssetMetadata\(/,
  "existing canvas assets need metadata hydration after a project refresh",
);
assert.match(
  canvas,
  /refreshCanvasProjectAssetMetadata\(\)/,
  "project refresh must update captions for assets already on the canvas",
);

console.log("canvas asset description tests passed");
