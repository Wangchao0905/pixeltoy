import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

assert.match(html, /id="assetInspector"/);
assert.match(html, /id="assetInspectorPrompt"/);
assert.match(html, /id="regenerateAssetFromInspector"/);
assert.doesNotMatch(html, /id="assetInspector" class="[^"]*asset-library-only/);

assert.match(app, /function selectAssetForInspector\(assetName\)[\s\S]*?state\.selectedAssetId = assetName;[\s\S]*?ensureAssetPromptDraft\(assetName\);/);
assert.match(app, /function assetPromptInspectorWorkspace\(\)[\s\S]*?state\.activeWorkspaceMode === "assets"[\s\S]*?state\.activeWorkspaceMode === "image"/);
assert.match(app, /const visible = assetPromptInspectorWorkspace\(\) && !!assetName && !!item && state\.assetInspectorOpen;/);
assert.match(app, /if \(asset && assetPromptInspectorWorkspace\(\)\) selectAssetForInspector\(assetName\);/);

const cardRenderer = app.slice(app.indexOf("const buildAssetCard = (slot) => {"), app.indexOf("function renderStoryboards("));
assert.match(cardRenderer, /class="asset-tool asset-download"/);
assert.match(cardRenderer, /class="asset-tool asset-regenerate"/);
assert.match(cardRenderer, /class="asset-tool asset-delete"/);
assert.doesNotMatch(cardRenderer, /asset-edit-form|asset-edit-toggle|asset-reference/);
assert.doesNotMatch(app, /assetEditDrafts|activeAssetEditName|hasOpenAssetEditDraft/);

console.log("asset inspector UI tests passed");
