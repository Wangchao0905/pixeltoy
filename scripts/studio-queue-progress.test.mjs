import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing app function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

class FakeClassList {
  values = new Set();

  add(...items) { items.forEach((item) => this.values.add(item)); }
  remove(...items) { items.forEach((item) => this.values.delete(item)); }
  contains(item) { return this.values.has(item); }
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.innerHTML = "";
    this.textContent = "";
    this.style = {};
  }
}

const elements = {
  "#studioQueueBar": new FakeElement(),
  "#studioQueueItems": new FakeElement(),
  "#studioQueueSummary": new FakeElement(),
  "#studioQueueProgress": new FakeElement(),
  "#studioQueueProgressFill": new FakeElement(),
};
const context = {
  $: (selector) => elements[selector] || null,
  escapeHtml: (value) => String(value),
  videoProgressHasActiveWork: (progress = {}) => !!progress.running || !!progress.queued,
};
vm.createContext(context);
vm.runInContext(
  `${extractFunction(app, "function renderStudioQueue(")}`,
  context,
  { filename: "public/app.js" },
);

function resetElements() {
  Object.values(elements).forEach((element) => {
    element.classList = new FakeClassList();
    element.innerHTML = "";
    element.textContent = "";
    element.style = {};
  });
}

function render(data) {
  resetElements();
  context.renderStudioQueue(data);
  return elements;
}

assert.match(html, /<footer id="studioQueueBar"[^>]*>[\s\S]*<\/footer>/, "queue bar must remain a footer");
assert.doesNotMatch(html, /studioQueueBar[\s\S]*<\/div>\s*<\/main>/, "queue footer must not close with a div");
assert.doesNotMatch(html, /class="studio-queue-title"/, "the redundant QUEUE label must be removed");
assert.match(html, /id="studioQueueProgress"/, "queue progress track must exist");
assert.match(html, /id="studioQueueProgressFill"/, "queue progress fill must exist");

let rendered = render({ project: null });
assert.equal(rendered["#studioQueueItems"].innerHTML, "", "idle queue must have no item text");
assert.equal(rendered["#studioQueueSummary"].textContent, "", "idle queue must have no summary");
assert.equal(rendered["#studioQueueSummary"].style.visibility, "hidden", "idle summary must preserve its layout slot");
assert.equal(rendered["#studioQueueProgressFill"].style.width, "0%", "idle queue fill must be empty");
assert.equal(rendered["#studioQueueProgress"].style.opacity, "0", "idle queue track must be hidden");

rendered = render({ project: {}, assetJob: { status: "running" } });
assert.match(rendered["#studioQueueItems"].innerHTML, /资产图/);
assert.equal(rendered["#studioQueueSummary"].textContent, "进行中", "unknown active work must say it is running");
assert.equal(rendered["#studioQueueProgressFill"].style.width, "30%", "unknown active work must use a 30% indeterminate fill");
assert.equal(rendered["#studioQueueProgressFill"].classList.contains("is-indeterminate"), true);

rendered = render({ project: {}, videoProgress: { total: 80, completed: 30, running: true } });
assert.equal(rendered["#studioQueueSummary"].textContent, "30/80 片段");
assert.equal(rendered["#studioQueueProgressFill"].style.width, "37.5%", "30/80 must render a real percentage width");
assert.equal(rendered["#studioQueueProgressFill"].classList.contains("is-indeterminate"), false);

rendered = render({
  project: {},
  assetJob: { status: "failed" },
  storyboardJob: { status: "failed" },
});
assert.equal(rendered["#studioQueueSummary"].textContent, "2 项失败");
assert.equal(rendered["#studioQueueProgressFill"].style.width, "0%");
assert.equal(rendered["#studioQueueProgressFill"].classList.contains("is-error"), true);

// 回归:视频任务失败但已产出部分片段(total>0)时,必须显示失败态,
// 不能因为 total>0 就继续渲染蓝色进度条。
rendered = render({
  project: {},
  videoJob: { status: "failed" },
  videoProgress: { total: 80, completed: 30 },
});
assert.equal(rendered["#studioQueueSummary"].textContent, "1 项失败", "failed video job must report failure even with partial segments");
assert.equal(rendered["#studioQueueProgressFill"].style.width, "0%", "failed state must not render a progress width");
assert.equal(rendered["#studioQueueProgressFill"].classList.contains("is-error"), true, "failed state must mark the fill as error");
assert.equal(rendered["#studioQueueBar"].classList.contains("is-active"), false, "failed state must not look active");

console.log("studio queue progress tests passed");
