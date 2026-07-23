import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");

assert.match(
  canvas,
  /function renderNodes\(\{ preserveExisting = false \} = \{\}\)/,
  "canvas rendering should expose an incremental preserve-existing path",
);
assert.match(
  canvas,
  /const existingElements = preserveExisting[\s\S]*new Map\(qsa\("#canvasNodes > \.canvas-node"\)/,
  "incremental canvas rendering should reuse existing node elements",
);
assert.match(
  canvas,
  /function addAssetNodeAt\([\s\S]*?renderNodes\(\{ preserveExisting: true \}\)/,
  "asset drops should append the new node without rebuilding existing nodes",
);

console.log("canvas asset-drop UI tests passed");
