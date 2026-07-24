import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
const styles = [
  fs.readFileSync(new URL("public/styles.css", root), "utf8"),
  fs.readFileSync(new URL("public/studio-feedback.css", root), "utf8"),
].join("\n");

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
    this.dataset = {};
    this.disabled = false;
    this.attributes = new Map();
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
}

const timers = [];
const context = {
  HTMLElement: FakeElement,
  document: { body: { classList: { contains: (name) => name === "is-studio" } } },
  setTimeout(callback) { timers.push(callback); return timers.length; },
  clearTimeout() {},
};
vm.createContext(context);
vm.runInContext(extractFunction(app, "async function withStudioButtonFeedback("), context, { filename: "public/app.js" });

const complete = new FakeElement();
const result = await context.withStudioButtonFeedback(complete, async () => "ok");
assert.equal(result, "ok");
assert.equal(complete.disabled, false, "button must return to its original disabled state");
assert.equal(complete.classList.contains("is-working"), false, "working state must clear after completion");
assert.equal(complete.classList.contains("is-complete"), true, "success must be visible on the button");
assert.equal(complete.attributes.has("aria-busy"), false, "busy accessibility state must clear");

const failed = new FakeElement();
await assert.rejects(() => context.withStudioButtonFeedback(failed, async () => { throw new Error("network"); }));
assert.equal(failed.classList.contains("is-error"), true, "failure must be visible on the button");
assert.equal(failed.disabled, false, "failed actions must restore the button");

assert.match(app, /document\.addEventListener\("pointerdown",/, "all studio buttons need immediate pointer feedback");
assert.match(app, /withStudioButtonFeedback\(button, \(\) => startJob/, "asset and board jobs must expose a working state");
assert.match(app, /withStudioButtonFeedback\(button, \(\) => buildConfig/, "video config creation must expose a working state");
assert.match(app, /withStudioButtonFeedback\(button, \(\) => generateAllVideoSegments/, "batch video generation must expose a working state");
assert.doesNotMatch(
  extractFunction(app, "async function assembleFinalCut("),
  /catch\s*\(/,
  "final cut failures must reach the shared button feedback state",
);
assert.doesNotMatch(
  extractFunction(app, "async function startChatcutEditing("),
  /catch\s*\(/,
  "ChatCut failures must reach the shared button feedback state",
);
assert.match(styles, /body\.is-studio button\.is-working/, "working button styles must be scoped to the studio");
assert.match(styles, /body\.is-studio button\.is-complete/, "completed button styles must be present");
assert.match(styles, /body\.is-studio button:active/, "all studio buttons need an immediate press state");
assert.match(styles, /prefers-reduced-motion: reduce/, "button feedback must respect reduced motion preferences");

console.log("studio button feedback tests passed");
