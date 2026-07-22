import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

function sectionBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing section start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing section end: ${endNeedle}`);
  return source.slice(start, end);
}

const manifestView = sectionBetween(app, "function renderAssetManifest", "function bindManualAssetControls");
const manualControls = sectionBetween(app, "function bindManualAssetControls", "function manualAssetFormHtml");
const reclassify = sectionBetween(app, "async function reclassifyAsset", "const ASSET_CLASSIFICATION_GROUPS");

assert.match(manifestView, /draggable="true"/);
assert.match(manifestView, /data-manifest-asset-type="\$\{escapeAttr\(item\.type\)\}"/);
assert.match(manifestView, /data-manifest-drop-type="\$\{escapeAttr\(type\)\}"/);
assert.doesNotMatch(manifestView, /asset-reclassify-(?:groups|dropzone)/);

assert.match(manualControls, /root\.querySelectorAll\("\[data-manifest-asset-id\]"\)/);
assert.match(manualControls, /dataTransfer\.setData\("text\/plain", assetId\)/);
assert.match(manualControls, /root\.querySelectorAll\("\[data-manifest-drop-type\]"\)/);
assert.match(manualControls, /event\.preventDefault\(\)/);
assert.match(manualControls, /reclassifyAsset\(assetId, targetType\)/);
assert.match(reclassify, /confirm: false/);

assert.match(styles, /\.manifest-name\.is-dragging/);
assert.match(styles, /\.manifest-name-list\.is-dragover/);

console.log("asset manifest reclassify DnD contract tests passed");
