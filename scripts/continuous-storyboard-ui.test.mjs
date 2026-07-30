import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const storyboardStart = html.indexOf('id="modernStoryboardStudio"');
const workbenchStart = html.indexOf('<section class="modern-workbench"', storyboardStart);
const panel = storyboardStart >= 0 && workbenchStart > storyboardStart ? html.slice(storyboardStart, workbenchStart) : "";
assert.ok(panel, "storyboard document must be present");

for (const id of [
  "modernStoryboardProject",
  "modernStoryboardBoardCount",
  "modernStoryboardPage",
  "modernStoryboardTimeRange",
  "modernStoryboardCanvasTitle",
  "modernStoryboardCanvasMeta",
  "modernStoryboardCanvasStatus",
  "modernStoryboardEmotion",
  "modernStoryboardSetting",
  "modernStoryboardGrid",
  "modernStoryboardSummary",
  "modernStoryboardKeywords",
  "modernStoryboardContinuity",
  "modernStoryboardTimeline",
  "modernStoryboardTimelineTrack",
  "modernStoryboardGeneratePage",
  "modernStoryboardRetryPanel",
]) {
  assert.match(panel, new RegExp(`id="${id}"`), `storyboard document missing ${id}`);
}

assert.match(panel, /STORYBOARD DRAFT/);
assert.match(panel, /16:9/);
assert.match(panel, /15 秒/);
assert.match(panel, /黑白线稿速写/);
assert.doesNotMatch(panel, /modernStoryboardReferencePanel|modernStoryboardToolrow|modernStoryboardInspector|modernStoryboardAddPage/);

assert.match(js, /function modernStoryboardPages\(/, "storyboard pages must be derived from 15-second board slots");
assert.match(js, /source:\s*"reused-anchor"/, "the next board must reuse the previous board tail");
assert.match(js, /carryIn[\s\S]*上一 PART/, "the UI must explain the cross-part anchor");
assert.match(js, /function renderModernStoryboardStudio\(/, "storyboard document needs a dedicated renderer");
assert.match(js, /storyboardBoardMedia\(/, "generated storyboard sheet media must be shown in the document");
assert.match(js, /黑白线稿速写 · 九宫格 · 16:9/, "the document must stay fixed to the approved first format");

assert.match(server, /const STORYBOARD_MIN_PANELS = 9/);
assert.match(server, /const STORYBOARD_MAX_PANELS = 9/);
assert.match(server, /IMAGE_SIZE_BY_QUALITY_16_9\[String\(body\.quality/);
assert.match(server, /16:9 horizontal professional film storyboard document/);
assert.match(server, /black-and-white hand-drawn storyboard sketch/);
assert.match(server, /continuitySourcePanelId/);
assert.match(server, /Production Board 唯一视频参考|15 秒 16:9 横版九宫格故事板/);
assert.doesNotMatch(server, /Create ONE 9:16 vertical \(portrait\)/);

for (const selector of [
  /\.storyboard-document-board\s*\{/,
  /\.storyboard-document-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/,
  /\.storyboard-document-shot-frame\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/,
  /\.storyboard-document-sequence-connector/,
]) {
  assert.match(css, selector, `missing storyboard document styling: ${selector}`);
}

console.log("storyboard document UI tests passed");
