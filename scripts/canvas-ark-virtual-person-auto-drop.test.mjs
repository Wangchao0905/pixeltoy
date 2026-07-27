import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");

assert.match(js, /function isWorkflowArkAutoCertificationAsset\(asset = \{\}\)/, "automatic certification must identify workflow assets");
assert.match(js, /\["project", "workflow", "project-reuse"\]/, "workflow sources must be explicit");
assert.match(js, /preset === "photoreal" \|\| preset === "cg_3d"/, "automatic certification must allow only photoreal and CG 3D styles");
assert.match(js, /source: "shared-asset-library"/, "shared library assets must keep a non-workflow source");
assert.match(js, /function autoCertifyCanvasGeneratedAsset\(asset\)/, "canvas drops must have an automatic certification entry point");
assert.match(js, /addAssetNodeAt\(assetId, point, \{ autoCertify: true \}\)/, "asset drops must opt into automatic certification");
assert.doesNotMatch(
  js.match(/function addSharedLibraryAsset\(asset = \{\}[\s\S]*?\n\}/)?.[0] || "",
  /autoCertify:\s*true/,
  "shared library drops must not opt into automatic certification",
);
assert.match(
  js,
  /function isAutoArkPersonAsset\(asset = \{\}\)[\s\S]*?status === "processing"[\s\S]*?isArkVirtualPersonCertified\(asset\)/,
  "automatic certification must not resubmit active or processing assets",
);
assert.match(js, /function createNodesForFiles\(files, point\)[\s\S]*?source: "local"/, "local file drops must remain external assets");

console.log("canvas Ark virtual-person auto-drop tests passed.");
