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
assert.match(panel, /每格 15 秒剧情/);
assert.match(panel, /黑白线稿速写/);
const storyboardActions = panel.match(/<div class="storyboard-document-actions">[\s\S]*?<\/div>/)?.[0] || "";
assert.match(storyboardActions, /id="modernStoryboardGeneratePage"[^>]*>单张生成<\/button>/, "故事板顶部必须提供单张生成");
assert.match(storyboardActions, /id="modernStoryboardRetryPanel"[^>]*>单张重新生成<\/button>/, "故事板顶部必须提供单张重新生成");
assert.doesNotMatch(panel, /storyboard-document-selection[\s\S]*?id="modernStoryboardRetryPanel"/, "重新生成入口不应藏在底部选择栏");
assert.doesNotMatch(panel, /modernStoryboardReferencePanel|modernStoryboardToolrow|modernStoryboardInspector|modernStoryboardAddPage/);

assert.match(js, /function modernStoryboardPages\(/, "storyboard pages must be derived from 15-second board slots");
assert.match(js, /const STORYBOARD_PLOT_SECONDS = 15/, "each storyboard grid must represent one 15-second plot");
assert.match(js, /duration: STORYBOARD_PLOT_SECONDS/, "storyboard grid cells must use the 15-second plot duration");
assert.doesNotMatch(js, /duration: raw\?\.duration \|\| shot\?\.duration \|\| 1\.7/, "storyboard cells must not fall back to 1.7-second beats");
assert.match(js, /source:\s*"reused-anchor"/, "the next board must reuse the previous board tail");
assert.match(js, /carryIn[\s\S]*上一 PART/, "the UI must explain the cross-part anchor");
assert.match(js, /function renderModernStoryboardStudio\(/, "storyboard document needs a dedicated renderer");
assert.match(js, /storyboardBoardMedia\(/, "generated storyboard sheet media must be shown in the document");
assert.match(js, /黑白线稿速写 · 九宫格 · 16:9 · 每格 \$\{STORYBOARD_PLOT_SECONDS\} 秒剧情/, "the document must identify each grid as a 15-second plot");

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
  /\.storyboard-document-grid\s*\{[^}]*gap:\s*16px[^}]*width:\s*min\(100%,\s*1360px\)[^}]*margin:\s*0\s+auto/,
  /\.storyboard-document-shot-frame\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/,
  /\.storyboard-document-shot-frame::after\s*\{[^}]*display:\s*none/,
  /\.storyboard-document-sequence-connector/,
]) {
  assert.match(css, selector, `missing storyboard document styling: ${selector}`);
}

assert.doesNotMatch(css, /\.modern-main\[data-modern-view="storyboard"\]\s+\.modern-episode-hero\s*\{[^}]*display:\s*none/, "故事板视图不得隐藏统一剧集概览");
assert.doesNotMatch(css, /\.modern-main\[data-modern-view="storyboard"\]\s+\.modern-pipeline\s*\{[^}]*padding-top:\s*8px/, "故事板视图不得压缩统一流程栏");

console.log("storyboard document UI tests passed");
