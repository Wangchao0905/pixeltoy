import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const html = fs.readFileSync(new URL("public/index.html", root), "utf8");
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");

assert.doesNotMatch(html, /id=["']studioTabVideo["']/, "the retired video page must not remain in the DOM");
assert.doesNotMatch(html, /id=["']configPromptMode["']/, "the retired hidden prompt-mode control must not remain in the DOM");
assert.match(html, /id=["']modernVideoPromptMode["']/, "the active video workbench must expose a mode selector");
assert.match(html, /data-video-prompt-mode=["']prompt["']/, "the active selector must offer prompt mode");
assert.match(html, /data-video-prompt-mode=["']production_board["']/, "the active selector must offer Production Board mode");

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
    this.value = "";
    this.textContent = "";
    this.checked = false;
    this.dataset = {};
    this.listeners = new Map();
    this.classList = { toggle() {} };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute() {}
}

const elements = new Map(
  [
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
const context = {
  console,
  state: {
    selectedId: "p1",
    project: { project: { model: "seedance-2-0-fast" } },
    assetAnalyzerModel: "claude-opus-4-8",
    dialogueLanguage: "en",
    pendingVideoPromptMode: null,
  },
  document: {
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
  },
  VIDEO_DIALECT_STYLE_OPTIONS: ["northeastern", "sichuan", "cantonese"],
  VIDEO_SFX_STYLE_OPTIONS: ["mystery", "epic", "palace", "vampire", "sci_fi", "disaster", "light", "comedy"],
  normalizeAssetAnalyzerModel: (value) => value,
  normalizeVideoModelName: (value) => value || "seedance-2-0-fast",
  saveFileQuiet: async () => {},
  selectedVideoDialectStyle: () => "none",
  selectedVideoSfxStyle: () => "none",
  localStorage: { setItem() {} },
  api: async (path, options) => {
    requestLog.push({ path, body: JSON.parse(options.body) });
    return { state: { project: {}, videoConfigStatus: { ready: true, missing: [] } } };
  },
  setProjectState() {},
  renderWorkspace() {},
  $: (selector) => context.document.querySelector(selector),
  $$: (selector) => (selector === "[data-video-prompt-mode]" ? modeButtons : []),
};
vm.createContext(context);
for (const signature of [
  "function normalizeVideoPromptMode(",
  "function setModernVideoPromptMode(",
  "function selectedVideoPromptMode(",
  "async function refreshVideoConfig(",
]) {
  vm.runInContext(extractFunction(app, signature), context, { filename: "public/app.js" });
}

elements.get("modernParamModel").value = "seedance-2-0-fast";
elements.get("modernParamResolution").value = "480p";
elements.get("modernParamRatio").value = "9:16";
vm.runInContext('setModernVideoPromptMode("production_board", { pending: true })', context);
assert.equal(requestLog.length, 0, "changing the mode must not rebuild the video configuration");
assert.equal(elements.get("modernVideoPromptMode").dataset.value, "production_board", "the selector must expose its current mode");
assert.match(elements.get("modernVideoPromptModeHint").textContent, /故事板/, "the active mode must explain its storyboard rule");

await vm.runInContext("refreshVideoConfig({ silent: true })", context);
assert.equal(requestLog.at(-1)?.body.promptMode, "production_board", "the config request must use the active modern mode");
assert.equal(requestLog.at(-1)?.body.enableStoryboards, true, "Production Board mode must enable board references");
assert.equal(requestLog.at(-1)?.body.tailFrameContinuity, false, "Production Board mode must disable tail-frame continuity");

console.log("video mode selector tests passed");
