import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const html = fs.readFileSync(new URL("public/index.html", root), "utf8");
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
const css = fs.readFileSync(new URL("public/styles.css", root), "utf8");

function selectOptions(id) {
  const block = html.match(new RegExp(`<select id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`))?.[1] || "";
  return [...block.matchAll(/<option value=["']([^"']+)["']/g)].map((match) => match[1]);
}

assert.match(
  html,
  /<div id="modernSelectedShotMeta"[\s\S]*id="modernParamRatio"[\s\S]*id="modernParamResolution"[\s\S]*id="modernParamModel"[\s\S]*<\/div>/,
  "modern selected shot meta must become a parameter module while retaining its id",
);
for (const id of ["modernParamRatio", "modernParamResolution", "modernParamModel"]) {
  assert.ok(selectOptions(id).length > 0, `${id} must expose selectable options`);
}
assert.deepEqual(selectOptions("modernParamRatio"), selectOptions("configRatio"), "ratio options must stay aligned");
assert.deepEqual(selectOptions("modernParamResolution"), selectOptions("configResolution"), "resolution options must stay aligned");
assert.deepEqual(selectOptions("modernParamModel"), selectOptions("configModel"), "model options must stay aligned");
assert.match(css, /\.modern-video-params\s*\{[^}]*display:\s*(?:inline-)?flex/, "video parameter module must use an inline compact layout");
assert.match(css, /\.modern-video-params select\s*\{[^}]*min-width:/, "video parameter selects need a stable clickable width");
assert.match(app, /function syncModernVideoParams/, "modern and legacy video params need a shared sync function");
assert.match(app, /function normalizeVideoModelName\([\s\S]*?if \(\/mini\|迷你\/\.test\(lower\)/, "model normalization must preserve the Seedance 2.0 Mini option");
assert.match(app, /function renderModernSelectedShot[\s\S]*modernParamRatio[\s\S]*modernParamResolution[\s\S]*modernParamModel/, "selected shot rendering must populate modern params");
assert.match(app, /function refreshVideoConfig[\s\S]*modernParamRatio[\s\S]*modernParamResolution[\s\S]*modernParamModel/, "video config must read modern params first");

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

const ids = [
  "modernParamRatio",
  "modernParamResolution",
  "modernParamModel",
  "configGroup",
  "configModel",
  "configResolution",
  "configRatio",
  "configPromptMode",
];
const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
const requestLog = [];
const context = {
  console,
  VIDEO_MODEL_OPTIONS: {
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
    project: { project: { model: "seedance-2-0" } },
    assetAnalyzerModel: "claude-opus-4-8",
    dialogueLanguage: "en",
  },
  localStorage: { setItem() {} },
  normalizeVideoModelName: (value) => value || "seedance-2-0-fast",
  normalizeAssetAnalyzerModel: (value) => value,
  saveFileQuiet: async () => {},
  api: async (path, options) => {
    requestLog.push({ path, body: JSON.parse(options.body) });
    return { state: { project: {}, videoConfigStatus: { ready: true, missing: [] } } };
  },
  setProjectState() {},
  renderWorkspace() {},
  $: (selector) => context.document.querySelector(selector),
};
vm.createContext(context);
for (const signature of ["function syncModernVideoParams(", "function hydrateConfigInputs(", "async function refreshVideoConfig("]) {
  vm.runInContext(extractFunction(app, signature), context, { filename: "public/app.js" });
}
vm.runInContext(extractFunction(app, "function normalizeVideoModelName("), context, { filename: "public/app.js" });
context.normalizeVideoModelName = vm.runInContext("normalizeVideoModelName", context);
assert.equal(
  context.normalizeVideoModelName("Seedance 2.0 Mini"),
  "seedance-2-0-mini",
  "the displayed Mini model label must normalize back to the Mini model key",
);
assert.equal(
  context.normalizeVideoModelName("seedance-2-0-mini"),
  "seedance-2-0-mini",
  "the Mini model key must remain stable when already normalized",
);

elements.get("configModel").value = "seedance-2-0-fast";
elements.get("configResolution").value = "480p";
elements.get("configRatio").value = "9:16";
vm.runInContext(
  'hydrateConfigInputs(JSON.stringify({ modelName: "seedance-2-0-person-reference", settings: { resolution: "1080p", ratio: "16:9" } }))',
  context,
);
for (const [modernId, legacyId] of [
  ["modernParamModel", "configModel"],
  ["modernParamResolution", "configResolution"],
  ["modernParamRatio", "configRatio"],
]) {
  assert.equal(elements.get(modernId).value, elements.get(legacyId).value, `${modernId} must hydrate with the legacy value`);
}

elements.get("modernParamModel").value = "seedance-2-0-mini";
elements.get("modernParamResolution").value = "720p";
elements.get("modernParamRatio").value = "1:1";
await vm.runInContext("refreshVideoConfig({ silent: true })", context);
assert.equal(requestLog.at(-1).body.modelName, "seedance-2-0-mini", "config must prefer the modern model control");
assert.equal(requestLog.at(-1).body.resolution, "720p", "config must prefer the modern resolution control");
assert.equal(requestLog.at(-1).body.ratio, "1:1", "config must prefer the modern ratio control");

elements.delete("modernParamModel");
elements.delete("modernParamResolution");
elements.delete("modernParamRatio");
await vm.runInContext("refreshVideoConfig({ silent: true })", context);
assert.equal(requestLog.at(-1).body.modelName, "seedance-2-0-person-reference", "config must fall back to the legacy model control");
assert.equal(requestLog.at(-1).body.resolution, "1080p", "config must fall back to the legacy resolution control");
assert.equal(requestLog.at(-1).body.ratio, "16:9", "config must fall back to the legacy ratio control");

console.log("video params module tests passed");
