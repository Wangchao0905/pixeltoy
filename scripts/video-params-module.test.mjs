import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const html = fs.readFileSync(new URL("public/index.html", root), "utf8");
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");

function selectOptions(id) {
  const source = html.match(new RegExp(`<select id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`))?.[1] || "";
  return [...source.matchAll(/<option value=["']([^"']+)["']/g)].map((match) => match[1]);
}

assert.deepEqual(selectOptions("modernParamRatio"), ["9:16", "16:9", "1:1", "4:3", "3:4"], "the active workbench must expose its supported ratios");
assert.deepEqual(selectOptions("modernParamResolution"), ["480p", "720p", "1080p"], "the active workbench must expose its supported resolutions");
assert.deepEqual(
  selectOptions("modernParamModel"),
  ["seedance-2-5", "seedance-2-5-byteplus", "seedance-2-0", "seedance-2-0-fast", "seedance-2-0-mini", "seedance-2-0-person-reference", "seedance-2-0-byteplus", "grok-imagine-video"],
  "the active workbench must expose the available video models",
);
for (const id of ["configModel", "configResolution", "configRatio", "configPromptMode", "configDialectEnabled", "configSfxEnabled"]) {
  assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`), `${id} must not remain as an invisible compatibility control`);
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing app function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
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
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.classList = { toggle() {} };
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
  VIDEO_DIALECT_STYLE_OPTIONS: ["northeastern", "sichuan", "cantonese"],
  VIDEO_SFX_STYLE_OPTIONS: ["mystery", "epic", "palace", "vampire", "sci_fi", "disaster", "light", "comedy"],
  VIDEO_MODEL_OPTIONS: {
    "seedance-2-5": "Seedance 2.5",
    "seedance-2-5-byteplus": "Seedance 2.5（海外火山）",
    "seedance-2-0": "Seedance 2.0",
    "seedance-2-0-fast": "Seedance 2.0 Fast",
    "seedance-2-0-mini": "Seedance 2.0 Mini",
    "seedance-2-0-person-reference": "Seedance 2.0 人物素材参考",
    "seedance-2-0-byteplus": "Seedance 2.0（海外火山）",
  },
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
  normalizeAssetAnalyzerModel: (value) => value,
  saveFileQuiet: async () => {},
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
  "function normalizeVideoModelName(",
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
  "function hydrateConfigInputs(",
  "async function refreshVideoConfig(",
]) {
  vm.runInContext(extractFunction(app, signature), context, { filename: "public/app.js" });
}

assert.equal(vm.runInContext('normalizeVideoModelName("Seedance 2.0 Mini")', context), "seedance-2-0-mini", "the Mini model label must normalize to its stable key");
assert.equal(vm.runInContext('normalizeVideoModelName("Seedance 2.5（海外火山）")', context), "seedance-2-5-byteplus", "the overseas Seedance 2.5 label must normalize to its stable key");
vm.runInContext(
  'hydrateConfigInputs(JSON.stringify({ modelName: "seedance-2-0-person-reference", settings: { resolution: "1080p", ratio: "16:9", promptMode: "production_board", storyboardWorkflowExplicit: true, dialectStyle: "cantonese", sfxStyle: "搞笑无厘头" } }))',
  context,
);
assert.equal(elements.get("modernParamModel").value, "seedance-2-0-person-reference", "saved model must hydrate the active model control");
assert.equal(elements.get("modernParamResolution").value, "1080p", "saved resolution must hydrate the active resolution control");
assert.equal(elements.get("modernParamRatio").value, "16:9", "saved ratio must hydrate the active ratio control");
assert.equal(elements.get("modernVideoPromptMode").dataset.value, "production_board", "saved board mode must hydrate the visible selector");
assert.equal(elements.get("modernDialectEnabled").checked, true, "saved dialect must hydrate the active toggle");
assert.equal(elements.get("modernDialectStyle").value, "cantonese", "saved dialect must hydrate the active selector");
assert.equal(elements.get("modernSfxEnabled").checked, true, "saved SFX must hydrate the active toggle");
assert.equal(elements.get("modernSfxStyle").value, "comedy", "legacy SFX labels must normalize during hydration");

elements.get("modernParamModel").value = "seedance-2-0-mini";
elements.get("modernParamResolution").value = "720p";
elements.get("modernParamRatio").value = "1:1";
await vm.runInContext("refreshVideoConfig({ silent: true })", context);
assert.equal(requestLog.at(-1)?.body.modelName, "seedance-2-0-mini", "config generation must only read the visible model control");
assert.equal(requestLog.at(-1)?.body.resolution, "720p", "config generation must only read the visible resolution control");
assert.equal(requestLog.at(-1)?.body.ratio, "1:1", "config generation must only read the visible ratio control");
assert.equal(requestLog.at(-1)?.body.promptMode, "production_board", "config generation must preserve the visible mode");
assert.equal(requestLog.at(-1)?.body.dialectStyle, "cantonese", "config generation must submit the enabled visible dialect");
assert.equal(requestLog.at(-1)?.body.sfxStyle, "comedy", "config generation must submit the enabled visible SFX style");

console.log("video params module tests passed");
