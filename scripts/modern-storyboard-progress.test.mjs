import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

const storyboardStart = html.indexOf('id="modernStoryboardStudio"');
const workbenchStart = html.indexOf('<section class="modern-workbench"', storyboardStart);
const panel = storyboardStart >= 0 && workbenchStart > storyboardStart ? html.slice(storyboardStart, workbenchStart) : "";
assert.ok(panel, "storyboard document must be present");

for (const id of [
  "modernStoryboardRunStatus",
  "modernStoryboardRunStage",
  "modernStoryboardRunCurrent",
  "modernStoryboardRunPercent",
  "modernStoryboardRunMeter",
  "modernStoryboardRunFill",
  "modernStoryboardRunDetail",
]) {
  assert.match(panel, new RegExp(`id="${id}"`), `storyboard progress UI missing ${id}`);
}

assert.match(js, /function parseModernStoryboardProgress\(/, "storyboard progress must be derived from job logs");
assert.match(js, /modernStoryboardRunFill/, "storyboard progress renderer must update the meter fill");
assert.match(js, /modernStoryboardRunPercent/, "storyboard progress renderer must update the percentage");
assert.match(js, /const activeName[\s\S]*modernStoryboardRunPartLabel/, "running state must expose the active PART");
assert.match(js, /job\.status === "queued"|status === "queued"/, "queued state must be represented");
assert.match(js, /job\.failureReason|failureReason/, "failed state must expose a failure reason");
assert.match(css, /\.modern-storyboard-run-status\.is-running/, "running storyboard status needs a visual state");
assert.match(css, /\.modern-storyboard-run-status\.is-failed/, "failed storyboard status needs a visual state");
assert.match(css, /modern-storyboard-run-pulse/, "running storyboard status needs a purposeful pulse");
assert.match(css, /prefers-reduced-motion/, "storyboard progress animation must respect reduced motion");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${signature}`);
}

const progressContext = {};
vm.createContext(progressContext);
vm.runInContext(
  `${extractFunction(js, "function modernStoryboardRunPartLabel(")}\n${extractFunction(js, "function parseModernStoryboardProgress(")}\nthis.parseModernStoryboardProgress = parseModernStoryboardProgress;`,
  progressContext,
);
const pages = [
  { id: "SB001_E01_V001_PRODUCTION_BOARD", partNumber: 1, status: "waiting" },
  { id: "SB002_E01_V002_PRODUCTION_BOARD", partNumber: 2, status: "waiting" },
];
let progress = progressContext.parseModernStoryboardProgress(
  { status: "running", logs: "planned assets: 0 characters, 0 scenes, 0 props, 0 inserts, 2 storyboards\ngenerating SB002_E01_V002_PRODUCTION_BOARD (1536x864) -> /tmp/board.png" },
  pages,
  false,
);
assert.equal(progress.state, "running", "active storyboard job must be running");
assert.equal(progress.current, "PART 02 / 02", "active log target must resolve to the current PART");
assert.equal(progress.percent, 52, "image generation should report the drawing phase");

progress = progressContext.parseModernStoryboardProgress(
  { status: "running", targetAssetNames: ["SB002_E01_V002_PRODUCTION_BOARD"], logs: "generating SB002_E01_V002_PRODUCTION_BOARD (1536x864) -> /tmp/board.png\n2026-08-01T07:30:00.000Z SB002_E01_V002_PRODUCTION_BOARD: transient image-gen failure, retrying in 12s" },
  pages,
  false,
);
assert.equal(progress.label, "上游暂时不可用 · 正在重试", "a retried provider request must not be presented as generic generation");
assert.match(progress.detail, /12 秒/);

progress = progressContext.parseModernStoryboardProgress(
  { status: "running", targetAssetNames: ["SB002_E01_V002_PRODUCTION_BOARD"], logs: "generating SB002_E01_V002_PRODUCTION_BOARD (1536x864) -> /tmp/board.png\ntransient image-gen failure, retrying in 12s\n开始第 1 次自动重试。\ngenerating SB002_E01_V002_PRODUCTION_BOARD (1536x864) -> /tmp/board.png" },
  pages,
  false,
);
assert.equal(progress.label, "生成中 · 九宫格画面", "a restarted request must clear the stale waiting-retry state");

progress = progressContext.parseModernStoryboardProgress(
  { status: "complete", logs: "generated SB001_E01_V001_PRODUCTION_BOARD -> /tmp/old-board.png" },
  pages,
  true,
);
assert.equal(progress.state, "submitting", "a new click must not display the previous completed job");

progress = progressContext.parseModernStoryboardProgress(
  { status: "running", targetAssetNames: ["SB001_E01_V001_PRODUCTION_BOARD"], logs: "generating SB001_E01_V001_PRODUCTION_BOARD (1536x864) -> /tmp/board.png\ngenerated SB001_E01_V001_PRODUCTION_BOARD -> /tmp/board.png" },
  pages,
  false,
);
assert.equal(progress.percent, 82, "a returned image must move into the continuity-write phase");

progress = progressContext.parseModernStoryboardProgress(
  { status: "failed", targetAssetNames: ["SB001_E01_V001_PRODUCTION_BOARD"], failureReason: "上游超时" },
  pages,
  false,
);
assert.equal(progress.state, "failed", "failed storyboard jobs must expose a failure state");
assert.match(progress.detail, /上游超时/);

console.log("modern storyboard progress tests passed");
