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
  /function syncAssetNodeElement\(element, node\)/,
  "asset node media should update in place when its upload URL changes",
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
assert.match(
  canvas,
  /addAssets\(\[asset\]\);[\s\S]*?renderNodes\(\{ preserveExisting: true \}\)/,
  "completed local asset uploads should keep existing canvas nodes mounted",
);
assert.match(
  canvas,
  /function thumbnailFallbackUrl\(url\)/,
  "canvas thumbnails should retain a non-thumbnail fallback URL",
);
assert.match(
  canvas,
  /data-thumbnail-fallback=/,
  "reference thumbnails should expose their original image as a fallback",
);
assert.match(
  canvas,
  /image\.dataset\.thumbnailFallbackApplied = "true"[\s\S]*?image\.src = fallback/,
  "a failed thumbnail should fall back to the original image once",
);
assert.match(
  canvas,
  /setThumbnailImageSource\(img, previewUrl, 640\)/,
  "asset nodes should use the same thumbnail fallback path as reference chips",
);

console.log("canvas asset-drop UI tests passed");
