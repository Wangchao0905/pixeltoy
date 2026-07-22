import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");

assert.match(
  js,
  /function isCanvasGeneratedPhotorealAsset\(asset = \{\}\)[\s\S]*?asset\.source === "canvas-image"[\s\S]*?asset\.aiGenerated === true/,
  "automatic certification must be limited to canvas-generated AI assets",
);
assert.match(js, /function autoCertifyCanvasGeneratedAsset\(asset\)/, "canvas drops must have an automatic certification entry point");
assert.match(js, /addAssetNodeAt\(assetId, point, \{ autoCertify: true \}\)/, "asset drops must opt into automatic certification");
assert.match(
  js,
  /function autoCertifyCanvasGeneratedAsset\(asset\)[\s\S]*?isArkVirtualPersonCertified\(asset\)[\s\S]*?toLowerCase\(\) === "processing"/,
  "automatic certification must not resubmit active or processing assets",
);
assert.match(js, /function createNodesForFiles\(files, point\)[\s\S]*?source: "local"/, "local file drops must remain external assets");

console.log("canvas Ark virtual-person auto-drop tests passed.");
