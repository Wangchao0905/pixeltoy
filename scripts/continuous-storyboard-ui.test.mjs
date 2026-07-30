import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

const storyboardStart = html.indexOf('id="modernStoryboardStudio"');
const workbenchStart = html.indexOf('<section class="modern-workbench"', storyboardStart);
const panel = storyboardStart >= 0 && workbenchStart > storyboardStart ? html.slice(storyboardStart, workbenchStart) : "";
assert.ok(panel, "modern storyboard studio must be present");
for (const id of [
  "modernStoryboardProject",
  "modernStoryboardPage",
  "modernStoryboardRatio",
  "modernStoryboardSave",
  "modernStoryboardExport",
  "modernStoryboardGeneratePage",
  "modernStoryboardGenerateNext",
  "modernStoryboardToolrow",
  "modernStoryboardToolSelect",
  "modernStoryboardFit",
  "modernStoryboardZoomOut",
  "modernStoryboardZoomIn",
  "modernStoryboardAssetTabs",
  "modernStoryboardAssetList",
  "modernStoryboardReferenceDropzone",
  "modernStoryboardReferenceFile",
  "modernStoryboardReferenceUploadStatus",
  "modernStoryboardGrid",
  "modernStoryboardInspector",
  "modernStoryboardTailPreview",
  "modernStoryboardHeadPreview",
  "modernStoryboardStrictReuse",
  "modernStoryboardChecks",
  "modernStoryboardBeats",
  "modernStoryboardTimeline",
  "modernStoryboardInspectorActions",
]) {
  assert.match(panel, new RegExp(`id="${id}"`), `storyboard studio missing ${id}`);
}
assert.match(panel, /data-storyboard-asset-tab="Character"/);
assert.match(panel, /data-storyboard-asset-tab="Scene"/);
assert.match(panel, /data-storyboard-asset-tab="Prop"/);
assert.match(panel, /data-storyboard-asset-tab="Style"/);
assert.match(panel, /data-storyboard-panel-index="0"/);
assert.match(panel, /data-storyboard-panel-index="8"/);
assert.match(panel, /故事板预览不回流资产库/);
assert.match(panel, /尾格[\s\S]*首格/);

assert.match(js, /function renderModernStoryboardStudio\(/, "storyboard studio needs a dedicated renderer");
assert.match(js, /function uploadModernStoryboardReference\(/, "storyboard reference upload needs a dedicated action");
assert.match(js, /modernStoryboardReferenceUploadStatus/, "storyboard reference upload needs visible feedback");
assert.match(js, /data-storyboard-asset-id/, "reference assets must be bindable from the storyboard panel");
assert.match(js, /storyboardBindings/, "storyboard reference bindings must be kept separate from production assets");
assert.match(js, /storyboardToolLabels/, "storyboard tools need visible action feedback");
assert.match(js, /modernStoryboardToolrow[\s\S]*modernStoryboardZoom/, "storyboard renderer must update the canvas tool row");
assert.match(js, /modernMediaForShot\(data,[\s\S]*storyboard/, "storyboard panels must use generated media when available");
assert.match(js, /const modernWorkbench = root\.querySelector\("\.modern-workbench"\)[\s\S]*modernWorkbench\.hidden = modernFocus !== "video"/, "storyboard view must hard-hide the video workbench");
assert.match(js, /storyboard-preview-only/, "storyboard panels must be explicitly isolated from production assets");
assert.match(js, /reused-anchor/, "strict continuity must mark a reused anchor");
assert.match(js, /function modernStoryboardPages\(/, "storyboard pages must be derived separately from video queue records");
assert.match(js, /function runModernStoryboardJob[\s\S]*?startJob\("storyboards"\)/, "storyboard actions must use the existing storyboard job");
assert.match(js, /storyboardStrictReuse/, "strict reuse must be persisted in modern storyboard state");
assert.match(js, /saveModernStoryboardContinuity[\s\S]*storyboardStrictReuse/, "strict reuse must be saved with the storyboard controls");

assert.match(css, /\.modern-storyboard-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(190px,\s*\.72fr\)\s+minmax\(560px,\s*2fr\)\s+minmax\(240px,\s*\.9fr\)/, "storyboard studio must use a three-column workspace");
assert.match(css, /\.modern-storyboard-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "storyboard canvas must be a 3x3 grid");
assert.match(css, /\.modern-storyboard-paper\s*\{[^}]*background:\s*#f3efe7/, "storyboard must use a light paper canvas");
assert.match(css, /\.modern-storyboard-timeline\s*\{/, "storyboard must expose a page timeline");
assert.match(css, /\.modern-storyboard-toolrow\s*\{/, "storyboard must expose a dedicated canvas tool row");
assert.match(css, /\.modern-storyboard-asset-list\s*\{[^}]*grid-template-columns:\s*repeat\(2/, "reference assets must use a compact card grid");
assert.match(css, /\.modern-storyboard-panel-art img\s*\{/, "storyboard cells must support generated frame thumbnails");
assert.match(css, /\.modern-storyboard-paper-viewport\s*\{/, "storyboard zoom must stay inside a dedicated viewport");
assert.match(css, /\.modern-storyboard-asset-item\[aria-pressed="true"\]/, "bound reference cards need a clear selected state");
assert.match(css, /\.modern-storyboard-inspector-actions[^}]*\.is-primary/, "storyboard primary generation action must sit in the inspector footer");
assert.match(css, /\.modern-main\[data-modern-view="storyboard"\][\s\S]*?\.modern-workbench\s*\{\s*display:\s*none/, "legacy shot workbench must be hidden in storyboard view");

console.log("continuous storyboard UI tests passed");
