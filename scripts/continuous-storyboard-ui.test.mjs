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
  "modernStoryboardGrid",
  "modernStoryboardSummary",
  "modernStoryboardKeywords",
  "modernStoryboardContinuity",
  "modernStoryboardTimeline",
  "modernStoryboardTimelineTrack",
  "modernStoryboardGeneratePage",
]) {
  assert.match(panel, new RegExp(`id="${id}"`), `storyboard document missing ${id}`);
}

assert.match(panel, /STORYBOARD DRAFT/);
assert.match(panel, /16:9/);
assert.match(panel, /15 秒/);
assert.doesNotMatch(panel, /Production Board|核心情绪|场景设定|单张故事板时长|镜头风格/, "九宫格前不应保留重复的标题或元数据条");
const storyboardActions = panel.match(/<div class="storyboard-document-actions">[\s\S]*?<\/div>/)?.[0] || "";
assert.match(storyboardActions, /id="modernStoryboardGeneratePage"[^>]*>单张生成<\/button>/, "故事板顶部必须提供当前 PART 的上下文生成入口");
assert.doesNotMatch(storyboardActions, /单张重新生成/, "生成与重新生成不得并列为两个重复按钮");
assert.doesNotMatch(panel, /modernStoryboardRetryPanel/, "重新生成必须复用当前 PART 的单一生成入口");
assert.doesNotMatch(panel, /modernStoryboardReferencePanel|modernStoryboardToolrow|modernStoryboardInspector|modernStoryboardAddPage/);

assert.match(js, /function modernStoryboardPages\(/, "storyboard pages must be derived from 15-second board slots");
assert.match(js, /const STORYBOARD_PLOT_SECONDS = 15/, "each storyboard grid must represent one 15-second plot");
assert.match(js, /duration: raw\?\.duration \|\| \(Number\(boardDuration\) > 0 \? Number\(boardDuration\) \/ 9/, "storyboard cells must retain their sub-shot duration");
assert.match(js, /const cellDuration = boardDuration \/ panels\.length/, "storyboard cell time ranges must be derived from the 15-second board");
assert.match(js, /function storyboardPanelDuration\([\s\S]*?panel\?\.duration/, "storyboard cell labels must use their own duration");
assert.match(js, /source:\s*"reused-anchor"/, "the next board must reuse the previous board tail");
assert.match(js, /carryIn[\s\S]*上一 PART/, "the UI must explain the cross-part anchor");
assert.match(js, /function renderModernStoryboardStudio\(/, "storyboard document needs a dedicated renderer");
assert.match(js, /const storyboardAction = hasExistingBoard \? "retry" : "current"/, "single storyboard action must switch to regeneration when the current PART already has a result");
assert.match(js, /storyboardBoardMedia\(/, "generated storyboard sheet media must be shown in the document");
assert.doesNotMatch(js, /15 秒剧情格/, "a nine-panel board must not label every cell as a separate 15-second storyboard");

assert.match(server, /const STORYBOARD_MIN_PANELS = 9/);
// 版式改成 4×3 十二格(照用户给的制作板参考图)。列数必须和上限一起钉:
// 只钉上限的话 3 列×12 格会算出 4 行,提示词声明的网格和实际格数会不一致。
assert.match(server, /const STORYBOARD_MAX_PANELS = 12/);
assert.match(server, /const STORYBOARD_BOARD_COLUMNS = 4/);
assert.match(server, /IMAGE_SIZE_BY_QUALITY_16_9\[String\(body\.quality/);
assert.match(server, /16:9 horizontal production storyboard sheet on white paper/);
assert.match(server, /black-and-white hand-drawn storyboard sketch/);
assert.match(server, /continuitySourcePanelId/);
assert.match(server, /Production Board 唯一视频参考|15 秒 16:9 横版 4×3 十二格故事板/);
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
