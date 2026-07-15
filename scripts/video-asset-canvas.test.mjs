import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const canvasCss = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const renderNodeAssets = canvas.slice(canvas.indexOf("function renderNodeAssets(node) {"), canvas.indexOf("function mentionTriggerForTextarea"));

assert.match(canvas, /function assetThumbnailHtml\(asset, \{ controls = false \} = \{\}\)/, "canvas assets should have one video/image thumbnail renderer");
assert.match(renderNodeAssets, /const chips = references[\s\S]*assetThumbnailHtml\(asset\)/, "video reference chips should keep video previews instead of forcing img tags");
assert.doesNotMatch(renderNodeAssets, /const chips = references[\s\S]*<img src=\"\$\{escapeHtml\(assetPreviewUrl\(asset\)\)\}/, "video reference chips must not render video URLs as images");
assert.match(canvas, /mediaType: "video"[\s\S]*videoUrl: result\.videoUrl/, "uploaded videos should retain their media type and playable URL");
assert.match(canvasCss, /\.asset-node-image[\s\S]*height: auto;/, "canvas video assets should keep their intrinsic aspect ratio");
assert.match(canvasCss, /\.node-asset-chip video[\s\S]*object-fit: contain;/, "video reference chips should show the full frame without cropping");
assert.match(packageJson.scripts.test, /video-asset-canvas\.test\.mjs/, "video asset canvas regression test should run with the suite");

console.log("video asset canvas tests passed");
