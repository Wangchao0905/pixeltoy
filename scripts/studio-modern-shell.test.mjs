import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

for (const id of [
  "studioModernShell",
  "modernShotRail",
  "modernShotCopy",
  "modernVideoPreview",
  "modernScriptText",
  "modernScriptUpload",
  "modernAssetDescriptionText",
  "modernAssetDescriptionUpload",
  "modernExtractAssets",
  "modernAssetWall",
  "modernAssetGenerationControls",
  "modernAssetStylePreset",
  "modernAssetStyleReferenceFile",
  "modernAssetReferenceTarget",
  "modernAssetReferenceBind",
  "modernAssetManifestOverview",
  "modernAssetGallery",
]) {
  assert.match(html, new RegExp(`id=\"${id}\"`), `modern shell missing ${id}`);
}
assert.doesNotMatch(html, /id="studioShell"/, "legacy editor must be removed from the document");
assert.doesNotMatch(html, /class="studio-shell hidden"/, "legacy editor shell must be removed from the document");
assert.doesNotMatch(html, /id="modernDetailsButton"/, "modern shell must not expose the legacy editor entry");
assert.match(css, /body\.is-studio-modern[\s\S]*--modern-signal/, "modern palette must be scoped to modern studio");
assert.doesNotMatch(css, /body\.is-studio-modern\s+#studioShell/, "modern shell must not depend on a hidden legacy editor");
assert.match(css, /modern-brand-logo\.pixel-toys-wordmark::before[\s\S]*animation:[^;]+!important/, "modern logo rotor must override the studio thermal guard");
assert.match(js, /studioModernShell/, "modern shell visibility must be wired");
assert.match(js, /renderModernStudio\(data\)/, "modern shell must hydrate from project state");
assert.match(js, /modernScriptUpload/, "modern shell must wire script upload");
assert.match(js, /modernAssetDescriptionUpload/, "modern shell must wire asset document upload");
assert.match(js, /modernExtractAssets/, "modern shell must expose asset extraction");
assert.match(js, /modern-asset-wall-group/, "modern asset wall must group cards by asset type");
assert.match(js, /function bindModernAssetReference/, "modern shell must bind uploaded reference images to parsed assets");
assert.match(js, /persistModernAssetStyleFromControls/, "modern shell must persist modern asset style controls");
assert.match(js, /workflowEditorElement/, "modern source inputs must use shared workflow persistence");
assert.doesNotMatch(js, /modernDetailsButton/, "modern shell must not wire a legacy editor handoff");
assert.doesNotMatch(js, /detailsOpen\s*=\s*true/, "modern actions must not switch to the legacy editor");
assert.doesNotMatch(js, /#studioShell/, "runtime must not query the removed legacy editor shell");
assert.doesNotMatch(js, /runHiddenLegacyAction/, "modern actions must not proxy through legacy buttons");
assert.match(js, /data-modern-view/, "pipeline clicks must switch the modern core view");
assert.doesNotMatch(js, /target\.scrollIntoView\(\{ behavior: "smooth"/, "pipeline clicks must not scroll the whole page");
assert.match(css, /modern-main\[data-modern-view="storyboard"\]/, "storyboard view must have a dedicated core layout");
assert.match(css, /\.modern-video-preview\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/, "video preview must use a portrait 9:16 frame");
assert.match(css, /\.modern-source-panel\s*\{[^}]*display:\s*grid/, "source panel must place the asset wall beside the parsed rail");
assert.match(css, /\.modern-stage-pane\s*\{[^}]*align-self:\s*start/, "stage panes must not stretch to the portrait video height");
assert.match(css, /\.modern-asset-results\s*\{[^}]*max-height:/, "asset rail must not stretch the entire source panel");
assert.match(css, /\.modern-asset-wall\s*\{[^}]*grid-column:\s*1/, "asset wall must occupy the source panel workspace");
assert.match(css, /\.modern-asset-wall-grid\s*\{[^}]*grid-template-columns:/, "asset wall must use a card grid");
assert.doesNotMatch(html, /modern-episode-hero/, "episode hero must be merged into the topbar");
assert.doesNotMatch(html, /modernEpisodeKicker/, "removed episode kicker must not remain in the DOM");
assert.match(html, /<header class="modern-topbar">[\s\S]*modernProjectCrumb[\s\S]*modernEpisodeTitle[\s\S]*modernEpisodeCopy[\s\S]*modern-episode-stats[\s\S]*modern-top-actions/, "topbar must contain the merged episode summary");
assert.match(css, /\.modern-topbar\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto\s+minmax\(0,1fr\)\s+auto\s+auto[^}]*height:\s*60px/, "topbar must use the four-column single-row layout");
assert.match(css, /\.modern-topbar\s*\{[^}]*min-height:\s*56px/, "topbar must remain at least 56px tall");
assert.doesNotMatch(js, /modernEpisodeKicker/, "runtime must not assign the removed episode kicker");
assert.doesNotMatch(css, /\.modern-episode-hero/, "hero styles must be removed after merging the topbar");
assert.match(html, /<section class="modern-pipeline"[\s\S]*modern-pipeline-link[\s\S]*modern-pipeline-rail/, "pipeline must include arrow links and a progress rail");
assert.match(css, /\.modern-pipeline\s*\{[^}]*display:\s*flex/, "pipeline must use a flex filmstrip layout");
assert.match(css, /\.modern-pipeline-link\s*\{[^}]*width:\s*26px/, "pipeline steps must be joined by fixed-width arrows");
assert.match(css, /\.modern-pipeline-rail\s*\{[^}]*height:\s*2px/, "pipeline must have a 2px bottom progress rail");
assert.match(css, /\.modern-pipeline-rail span\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*var\(--mv-vio\),\s*var\(--mv-lime\)\)/, "pipeline rail must use violet-to-lime progress");
// 无前缀的 --bg / --line / --ok 在本文件已有 4 套主题各自的定义，即便限定
// 在 body.is-studio-modern 内也会被后代继承并覆盖它们本该拿到的全局值。
assert.match(css, /body\.is-studio-modern \{[\s\S]{0,900}--mv-bg:/, "modern tokens must use the --mv- prefix");
assert.doesNotMatch(css, /body\.is-studio-modern \{[\s\S]{0,900}\n\s*--bg:/, "modern tokens must not shadow the global --bg");
// #62626F 对 #0B0B0F 仅 3.27:1，低于 WCAG AA 正文 4.5:1；未达态步骤标签用的是它。
assert.doesNotMatch(css, /--mv-qt:\s*#62626F/i, "--mv-qt must clear WCAG AA against the canvas");
// overflow-x: auto 会把 overflow-y 的 visible 提升为 auto，连带纵向裁剪副标签。
// 只查基础规则（含 flex: none 那条）；窄屏 media query 里的 overflow-x 是刻意的。
assert.doesNotMatch(css, /\.modern-pipeline \{[^}]*flex:\s*none[^}]*overflow-x:\s*auto/, "pipeline must not clip vertically at desktop width");
assert.match(css, /\.modern-pipeline \{[^}]*flex:\s*none/, "pipeline must not shrink inside the flex column");
assert.doesNotMatch(css, /\.modern-pipeline\s*\{[^}]*display:\s*grid/, "pipeline must not retain the equal-column grid");
assert.doesNotMatch(css, /modern-pipeline button[^}]*border-right/, "pipeline must not use hard block dividers");
assert.match(html, /id="modernCore" class="modern-core"/, "modern shell must have a fixed core workspace");
assert.match(css, /\.studio-modern-shell\s*\{[\s\S]*height:\s*100vh[\s\S]*overflow:\s*hidden/, "modern shell must keep the page viewport fixed");
assert.match(css, /\.modern-core\s*\{[\s\S]*overflow:\s*auto/, "only the core workspace may scroll internally");

console.log("studio modern shell tests passed");
