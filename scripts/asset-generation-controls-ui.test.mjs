import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.match(html, /<span>生成范围<\/span>/, "asset range control should name the action explicitly");
assert.match(html, /id="assetGenerateRange"[^>]*aria-label="生成资产图范围"/, "asset range should have an accessible label");
assert.match(html, /data-job="assets"[^>]*aria-label="生成资产图"/, "asset generation button should have an accessible label");
assert.match(html, /class="modern-asset-image-actions"/, "modern asset actions should have a dedicated aligned wrapper");
assert.match(html, /id="modernAssetGenerateRange"[^>]*aria-label="生成资产图范围"/, "modern range should have an accessible label");
assert.match(html, /id="modernAssetGenerateAssets"[^>]*aria-label="生成资产图"/, "modern asset generation button should have an accessible label");
assert.match(css, /\.asset-preview-panel \.section-head \.actions\.asset-generation-only\s*\{[\s\S]*?align-items:\s*center;/, "asset actions should share one vertical alignment");
assert.match(css, /\.asset-preview-panel \.asset-range-pill\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:/, "range control should use a stable two-column layout");
assert.match(css, /\.modern-asset-image-actions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;/, "modern asset actions should share one vertical alignment");
assert.match(css, /\.modern-asset-range-control\s*\{[\s\S]*?min-height:\s*42px;/, "modern range control should have a stable height");
assert.match(css, /\.modern-asset-image-actions \.modern-asset-image-action\s*\{[\s\S]*?min-width:\s*156px;[\s\S]*?min-height:\s*42px;/, "modern generation button should have a stable size");
assert.match(app, /ASSET_GENERATION_RANGE_HINTS/, "asset range hints should be centralized");
assert.match(app, /function syncAssetGenerationRange/, "legacy and modern range controls should share one value");
assert.match(app, /updateAssetGenerateButtonHint\(canGenerate\)/, "asset button hint should reflect current availability");
assert.match(app, /#assetGenerateRange.*addEventListener\("change"/, "changing the range should update the button hint");
assert.match(app, /#modernAssetGenerateRange.*addEventListener\("change"/, "changing the modern range should update the button hint");
assert.match(app, /syncAssetGenerationRange\(\$\("#modernAssetGenerateRange"\)\?\.value\)/, "modern generation should submit the selected range");

console.log("asset generation controls UI tests passed");
