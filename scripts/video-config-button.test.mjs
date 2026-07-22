import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
const html = fs.readFileSync(new URL("public/index.html", root), "utf8");

for (const id of ["buildConfigBtn", "seedanceText", "configGroup", "configModel", "configResolution", "configRatio", "configPromptMode"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} must remain in the storyboard workflow DOM`);
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
    this.value = "";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
}

const elements = new Map(
  ["buildConfigBtn", "seedanceText", "configGroup", "configModel", "configResolution", "configRatio", "configPromptMode"].map(
    (id) => [id, new FakeElement(id)],
  ),
);
const requestLog = [];
const toastLog = [];
const localStorage = {
  values: new Map(),
  getItem(key) {
    return this.values.get(key) || null;
  },
  setItem(key, value) {
    this.values.set(key, String(value));
  },
};
const context = {
  console,
  document: {
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
  },
  fetch: async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    requestLog.push({ path, body });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          state: { project: {}, videoConfigStatus: { ready: true, missing: [] } },
          data: { state: { project: {} } },
        };
      },
    };
  },
  localStorage,
  state: {
    selectedId: "p1",
    project: { project: { model: "seedance-2-0-fast" } },
    assetAnalyzerModel: "claude-opus-4-8",
    dialogueLanguage: "en",
  },
  normalizeAssetAnalyzerModel: (value) => value,
  normalizeVideoModelName: (value) => value || "seedance-2-0-fast",
  setProjectState() {},
  renderWorkspace() {},
  toast(message) {
    toastLog.push(message);
  },
  $: (selector) => context.document.querySelector(selector),
};
vm.createContext(context);
for (const signature of [
  "async function api(",
  "async function saveFileQuiet(",
  "async function refreshVideoConfig(",
  "async function buildConfig(",
  "function hydrateConfigInputs(",
]) {
  vm.runInContext(extractFunction(app, signature), context, { filename: "public/app.js" });
}

const buildConfigBinding = app.match(/^\s*\$\("#buildConfigBtn"\)\?\.addEventListener\("click", \(\) => buildConfig\(\)\.catch\(\(error\) => toast\(error\.message\)\)\);$/m)?.[0];
assert.ok(buildConfigBinding, "buildConfig button binding must remain wired");

function resetInputs() {
  elements.get("seedanceText").value = "draft prompt";
  elements.get("configGroup").value = "";
  elements.get("configModel").value = "seedance-2-0-fast";
  elements.get("configResolution").value = "480p";
  elements.get("configRatio").value = "9:16";
  elements.get("configPromptMode").value = "prompt";
}

resetInputs();
vm.runInContext('hydrateConfigInputs("")', context);
assert.equal(elements.get("configPromptMode").value, "prompt", "an empty config must default to the prompt flow");
vm.runInContext('hydrateConfigInputs(JSON.stringify({ settings: { enableStoryboards: false } }))', context);
assert.equal(elements.get("configPromptMode").value, "prompt", "a config without storyboard mode must default to the prompt flow");
vm.runInContext('hydrateConfigInputs(JSON.stringify({ settings: { enableStoryboards: true, promptMode: "production_board" }, storyboardPlans: [], storyboardReferences: [] }))', context);
assert.equal(elements.get("configPromptMode").value, "prompt", "a legacy default Production Board config without board data must use the prompt flow");
vm.runInContext('hydrateConfigInputs(JSON.stringify({ settings: { storyboardWorkflowExplicit: true, promptMode: "production_board" }, storyboardPlans: [] }))', context);
assert.equal(elements.get("configPromptMode").value, "production_board", "an explicitly selected Production Board flow must remain available");
resetInputs();
vm.runInContext(buildConfigBinding, context);
await elements.get("buildConfigBtn").listeners.get("click")();

assert.equal(requestLog[0]?.path, "/api/project/p1/file", "click must save the edited Seedance prompt first");
assert.equal(requestLog[1]?.path, "/api/project/p1/config", "click must submit the video config");
assert.equal(requestLog[1]?.body.promptMode, "prompt", "normal storyboard prompt flow must not silently enable Production Board");
assert.equal(requestLog[1]?.body.enableStoryboards, false, "normal storyboard prompt flow must not require a Production Board");
assert.equal(requestLog[1]?.body.tailFrameContinuity, true, "normal storyboard prompt flow must keep tail-frame continuity enabled");
assert.deepEqual(toastLog, ["视频配置已生成，可提交"], "a successful click must report completion");

elements.get("configPromptMode").value = "production_board";
requestLog.length = 0;
toastLog.length = 0;
await elements.get("buildConfigBtn").listeners.get("click")();
assert.equal(requestLog[1]?.body.promptMode, "production_board", "explicit Production Board mode must remain available");
assert.equal(requestLog[1]?.body.enableStoryboards, true, "explicit Production Board mode must enable storyboard references");
assert.equal(requestLog[1]?.body.tailFrameContinuity, false, "explicit Production Board mode must disable tail-frame continuity");

console.log("video config button tests passed");
