import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const canvasHtml = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");
const canvasCss = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(canvasHtml, /id="assetNodeTemplate"[\s\S]*data-resize-handle/, "asset nodes should expose a resize handle");
assert.match(canvas, /const ASSET_NODE_DEFAULT_WIDTH = 300;/, "asset nodes should use a larger default width");
assert.match(canvas, /const ASSET_NODE_DEFAULT_HEIGHT = 200;/, "asset nodes should use a larger default height");
assert.match(canvas, /function assetNodeSize\(node(?:\s*=\s*\{\})?\)/, "asset node size should read the node dimensions");
assert.match(canvas, /clampAssetNodeDimension\(node\?\.width, ASSET_NODE_MIN_WIDTH, ASSET_NODE_MAX_WIDTH, ASSET_NODE_DEFAULT_WIDTH\)/, "asset width should use the saved clamped dimension");
assert.match(canvas, /restored\.width = legacyDefaultSize[\s\S]*clampAssetNodeDimension\(node\.width/, "restored asset nodes should keep their saved width");
assert.match(canvas, /node\.kind === "asset"[\s\S]*node\.width = width[\s\S]*--asset-node-width/, "asset resize should update both state and rendered width");
assert.match(canvasCss, /\.asset-node:hover \.node-resize-handle/, "asset resize handle should be visible on hover");
assert.match(canvasCss, /\.asset-node-file[\s\S]*width: var\(--asset-node-width\)/, "asset placeholders should follow the node width");
assert.match(packageJson.scripts.test, /asset-node-resize\.test\.mjs/, "asset resize regression test should run with the suite");

console.log("asset node resize UI tests passed");
