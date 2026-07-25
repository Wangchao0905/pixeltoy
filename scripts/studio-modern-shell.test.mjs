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
assert.match(css, /\.modern-episode-hero\s*\{[^}]*grid-template-columns:\s*auto auto[^}]*padding:\s*10px 26px/, "episode hero must fit the compact flow summary");
assert.match(css, /\.modern-episode-hero\s*> div:first-child\s*\{[^}]*display:\s*none/, "episode hero must hide the redundant title block");
assert.match(css, /\.modern-breadcrumb\s*\{[^}]*display:\s*none/, "modern topbar must keep only the queue action");
assert.match(html, /id="modernCore" class="modern-core"/, "modern shell must have a fixed core workspace");
assert.match(css, /\.studio-modern-shell\s*\{[\s\S]*height:\s*100vh[\s\S]*overflow:\s*hidden/, "modern shell must keep the page viewport fixed");
assert.match(css, /\.modern-core\s*\{[\s\S]*overflow:\s*auto/, "only the core workspace may scroll internally");

console.log("studio modern shell tests passed");
