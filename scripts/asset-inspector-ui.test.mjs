import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

// 制作台入口使用稳定 URL + ETag 重验证，内容变化时自动取得新版资源。
assert.match(html, /<link rel="stylesheet" href="\/styles\.css"\s*\/>/, "styles.css must use ETag revalidation");
assert.match(html, /<script src="\/app\.js"><\/script>/, "app.js must use ETag revalidation");
assert.match(html, /id="assetInspector"/);
assert.match(html, /id="assetInspectorPrompt"/);
assert.match(html, /id="regenerateAssetFromInspector"/);
assert.doesNotMatch(html, /id="assetInspector" class="[^"]*asset-library-only/);
assert.match(css, /body\.is-studio \.studio-content-shell\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) !important;/, "studio content must keep the active asset panel visible after the tab rail is hidden");
assert.match(css, /body\.is-studio \.studio-tab-panel\.is-active\s*\{[\s\S]*?overflow-y:\s*auto !important;/, "active studio tabs must provide the vertical scroll boundary");
assert.match(css, /body\.is-studio \.studio-tab-panel\.is-active > \.panel\s*\{[\s\S]*?height:\s*auto !important;[\s\S]*?overflow:\s*visible !important;/, "asset and storyboard panels must expand instead of clipping their contents");
assert.match(css, /body\.is-studio \.studio-tab-panel\.is-active \.asset-preview-panel \.gallery,[\s\S]*?body\.is-studio \.studio-tab-panel\.is-active \.storyboard-gallery\s*\{[\s\S]*?overflow:\s*visible !important;/, "asset and storyboard galleries must not steal or clip the tab scroll boundary");
assert.match(css, /body\.is-studio \.asset-preview-panel \.asset-upload-form\s*\{[\s\S]*?width:\s*min\(100%, 920px\);[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\) !important;/, "manual asset upload should use a compact two-column layout");
assert.match(css, /body\.is-studio \.asset-preview-panel \.asset-upload-fields\s*\{\s*display:\s*contents;/, "manual asset fields should participate in the two-row parent grid");
assert.match(css, /body\.is-studio \.asset-parse-panel #confirmAssetManifestBtn\s*\{[\s\S]*?width:\s*max-content !important;[\s\S]*?justify-self:\s*center !important;/, "asset classification confirmation should remain a compact button");
assert.match(app, /if \(mode === "image" \|\| mode === "assets"\) \{\s*return \{ label: "Run: 生成资产", selector: "\[data-job='assets'\]", focus: "assets" \};/);
assert.match(app, /function finalCutOutputReady\(finalCut\)[\s\S]*?return !!finalCut\?\.output\?\.url;/, "CUT must use the real final output instead of object presence");
assert.match(app, /const cutReady = finalCutOutputReady\(data\.finalCut\);[\s\S]*?value: cutReady \? "ready" : cutRunning \? "assembling" : cutFailed \? "failed" : "locked"/);
assert.match(app, /function flowStepClass\(done, active, blocked = false[\s\S]*?if \(active\) classes\.push\("active"\);/);
assert.match(css, /body\.is-studio \.studio-flow-step\.active:not\(\.ok\):not\(\.warn\)::after\s*\{[\s\S]*?background:\s*var\(--studio-accent\);/);
assert.doesNotMatch(app, /label: "Run: 资产提取", selector: "#draftBtn"/);

assert.match(app, /function selectAssetForInspector\(assetName\)[\s\S]*?state\.selectedAssetId = assetName;[\s\S]*?ensureAssetPromptDraft\(assetName\);/);
assert.match(app, /function assetPromptInspectorWorkspace\(\)[\s\S]*?state\.activeWorkspaceMode === "assets"[\s\S]*?state\.activeWorkspaceMode === "image"/);
assert.match(app, /const visible = assetPromptInspectorWorkspace\(\) && !!assetName && !!item && state\.assetInspectorOpen;/);
assert.match(app, /function effectiveAssetPrompt\(assetName\)[\s\S]*?视觉风格：/);
assert.doesNotMatch(app, /function effectiveAssetPrompt\(assetName\)[\s\S]*?资产文档事实是生图内容唯一来源/);
assert.match(html, /资产文档提示词（中文事实源）/);
assert.match(app, /if \(asset && assetPromptInspectorWorkspace\(\)\) selectAssetForInspector\(assetName\);/);

const cardRenderer = app.slice(app.indexOf("const buildAssetCard = (slot) => {"), app.indexOf("function renderStoryboards("));
assert.match(cardRenderer, /class="asset-tool asset-download"/);
assert.match(cardRenderer, /class="asset-tool asset-regenerate"/);
assert.match(cardRenderer, /class="asset-tool asset-delete"/);
assert.doesNotMatch(cardRenderer, /asset-edit-form|asset-edit-toggle|asset-reference/);
assert.doesNotMatch(app, /assetEditDrafts|activeAssetEditName|hasOpenAssetEditDraft/);

console.log("asset inspector UI tests passed");
