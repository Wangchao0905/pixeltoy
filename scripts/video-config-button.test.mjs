import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
const html = fs.readFileSync(new URL("public/index.html", root), "utf8");

for (const id of ["modernBuildConfig", "modernVideoPromptMode", "modernParamModel", "modernParamResolution", "modernParamRatio"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} must be in the active video workbench`);
}
for (const id of ["buildConfigBtn", "configGroup", "configModel", "configResolution", "configRatio", "configPromptMode"]) {
  assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`), `${id} must not return as hidden legacy DOM`);
}

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
  throw new Error(`unterminated app function: ${signature}`);
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.checked = false;
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.dataset = {};
    this.classList = { toggle() {} };
  }

  setAttribute() {}

  removeAttribute() {}
}

const elements = new Map(
  [
    "modernBuildConfig",
    "modernVideoPromptMode",
    "modernVideoPromptModeHint",
    "modernParamModel",
    "modernParamResolution",
    "modernParamRatio",
    "modernDialectEnabled",
    "modernDialectStyle",
    "modernSfxEnabled",
    "modernSfxStyle",
  ].map((id) => [id, new FakeElement(id)]),
);
const modeButtons = ["prompt", "production_board"].map((mode) => {
  const button = new FakeElement(mode);
  button.dataset.videoPromptMode = mode;
  return button;
});
const requestLog = [];
const savedFiles = [];
const toastLog = [];
const workflowFocusLog = [];
const context = {
  console,
  VIDEO_DIALECT_STYLE_OPTIONS: ["northeastern", "sichuan", "cantonese"],
  VIDEO_SFX_STYLE_OPTIONS: ["mystery", "epic", "palace", "vampire", "sci_fi", "disaster", "light", "comedy"],
  document: {
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
  },
  state: {
    selectedId: "p1",
    project: { project: { model: "seedance-2-0-fast" } },
    assetAnalyzerModel: "claude-opus-4-8",
    dialogueLanguage: "en",
    pendingVideoPromptMode: null,
  },
  localStorage: { setItem() {} },
  requestAnimationFrame(callback) {
    callback();
  },
  normalizeAssetAnalyzerModel: (value) => value,
  normalizeVideoModelName: (value) => value || "seedance-2-0-fast",
  saveFileQuiet: async (name) => savedFiles.push(name),
  api: async (path, options) => {
    requestLog.push({ path, body: JSON.parse(options.body) });
    return { state: { project: {}, videoConfigStatus: { ready: true, missing: [] } } };
  },
  setProjectState() {},
  renderWorkspace() {},
  setWorkflowFocus(mode) {
    workflowFocusLog.push(mode);
  },
  toast(message) {
    toastLog.push(message);
  },
  $: (selector) => context.document.querySelector(selector),
  $$: (selector) => (selector === "[data-video-prompt-mode]" ? modeButtons : []),
};
vm.createContext(context);
for (const signature of [
  "function normalizeVideoPromptMode(",
  "function setModernVideoPromptMode(",
  "function selectedVideoPromptMode(",
  "function normalizeVideoDialectStyle(",
  "function syncDialectControlAvailability(",
  "function setVideoDialectControls(",
  "function selectedVideoDialectStyle(",
  "function normalizeVideoSfxStyle(",
  "function syncSfxControlAvailability(",
  "function setVideoSfxControls(",
  "function selectedVideoSfxStyle(",
  "async function refreshVideoConfig(",
  "async function buildConfig(",
]) {
  vm.runInContext(extractFunction(app, signature), context, { filename: "public/app.js" });
}

assert.match(
  app,
  /modernBuildConfig[\s\S]{0,300}withStudioButtonFeedback\(button, \(\) => buildConfig\(button\)\)/,
  "the visible video-config action must use the shared button feedback layer",
);

elements.get("modernParamModel").value = "seedance-2-0-fast";
elements.get("modernParamResolution").value = "480p";
elements.get("modernParamRatio").value = "9:16";
vm.runInContext('setModernVideoPromptMode("prompt")', context);
await vm.runInContext("buildConfig()", context);

assert.deepEqual(savedFiles, ["seedancePrompts"], "config generation must save the current prompt document first");
assert.equal(requestLog.at(-1)?.path, "/api/project/p1/config", "the visible action must submit the video config");
assert.equal(requestLog.at(-1)?.body.promptMode, "prompt", "prompt mode must remain the default submission mode");
assert.equal(requestLog.at(-1)?.body.enableStoryboards, false, "prompt mode must not require a Production Board");
assert.equal(requestLog.at(-1)?.body.tailFrameContinuity, true, "prompt mode must retain tail-frame continuity");
assert.deepEqual(toastLog, ["正在生成视频配置", "视频配置已生成，可提交"], "the action must provide start and completion feedback");
assert.deepEqual(workflowFocusLog, ["shots", "shots"], "config generation must keep the user in the video workspace");

vm.runInContext('setModernVideoPromptMode("production_board", { pending: true })', context);
await vm.runInContext("buildConfig()", context);
assert.equal(requestLog.at(-1)?.body.promptMode, "production_board", "the selected storyboard mode must be submitted");
assert.equal(requestLog.at(-1)?.body.enableStoryboards, true, "storyboard mode must require board references");
assert.equal(requestLog.at(-1)?.body.tailFrameContinuity, false, "storyboard mode must not inject tail-frame continuity");

console.log("video config button tests passed");
