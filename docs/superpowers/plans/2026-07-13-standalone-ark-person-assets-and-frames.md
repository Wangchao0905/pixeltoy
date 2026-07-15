# Standalone Ark Person Assets And Frames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In standalone canvas, submit user-bound Ark `asset://` person assets through Ark for the three standard Seedance modes and support official first/last-frame requests without changing the Gravitex person-reference mode.

**Architecture:** Keep the new Ark person binding on each canvas asset under `arkPersonAsset`, separate from the existing Gravitex fields. The browser serializes explicit frame selections and Ark person bindings; the server validates them, forces only the three target modes to Ark, and constructs the ordered Ark `content` array.

**Tech Stack:** Node.js CommonJS server, vanilla browser JavaScript/HTML/CSS, Node assert tests, Vite build.

---

## File Structure

- Modify: `server.js` -- validate bound Ark person assets, choose provider, build first/last-frame Ark content, expose narrow test hooks.
- Modify: `public/canvas.js` -- persist new state, render/bind controls, build payload, keep model selection stable, validate before submission.
- Modify: `public/canvas.html` -- add frame-control and Ark person-binding controls to the video node template.
- Modify: `public/canvas.css` -- style only the new compact controls and status text.
- Create: `scripts/canvas-ark-video.test.js` -- direct regression tests for server routing and Ark payload construction.
- Create: `scripts/canvas-ark-video-ui.test.mjs` -- static browser-template and state-boundary regression checks.
- Modify: `package.json` -- run the two new tests in `npm test`.

### Task 1: Lock Server Behavior With a Failing Test

**Files:**
- Create: `scripts/canvas-ark-video.test.js`
- Modify: `package.json:9`

- [ ] **Step 1: Add a failing server contract test**

Create `scripts/canvas-ark-video.test.js`:

```js
const assert = require("node:assert/strict");
const { __test } = require("../server.js");

const { canvasVideoProviderForBody, buildSeedanceGenerationPayload } = __test.canvasVideo;
const arkPerson = {
  id: "person-a",
  name: "真人 A",
  url: "https://preview.example/person-a.png",
  arkPersonAsset: { enabled: true, assetUrl: "asset://person-a", assetId: "person-a" },
};

assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0-fast", modelMode: "seedance-2-0-fast", assets: [arkPerson] }),
  "ark",
);
assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0-person-reference", modelMode: "seedance-2-0-person-reference", assets: [arkPerson] }),
  "gravitex",
);

(async () => {
  const payload = await buildSeedanceGenerationPayload({
    prompt: "剧情动作：人物走向镜头。",
    model: "seedance-2-0-mini",
    ratio: "9:16",
    duration: 5,
    resolution: "720p",
    frameControl: "first_last",
    firstFrameUrl: "asset://first-frame",
    lastFrameUrl: "asset://last-frame",
    assets: [arkPerson],
  });
  assert.deepEqual(payload.content.map((item) => item.role || item.type), ["text", "first_frame", "last_frame", "reference_image"]);
  assert.equal(payload.content[3].image_url.url, "asset://person-a");
  await assert.rejects(
    () => buildSeedanceGenerationPayload({ prompt: "剧情动作：测试。", model: "seedance-2-0", frameControl: "first_last", firstFrameUrl: "asset://first-frame" }),
    /首尾帧模式.*首帧.*尾帧/,
  );
  console.log("canvas Ark video tests passed.");
})();
```

- [ ] **Step 2: Register and run the test to confirm the missing hook fails**

In `package.json`, insert `node scripts/canvas-ark-video.test.js` immediately before `node scripts/self-check.mjs` in the `test` script.

Run: `node scripts/canvas-ark-video.test.js`

Expected: fail because `__test.canvasVideo` is not exported yet.

### Task 2: Implement Ark Routing, Binding Validation, and Frame Payloads

**Files:**
- Modify: `server.js:1737-1747`
- Modify: `server.js:8999-9057`
- Modify: `server.js:9296-9357`
- Modify: `server.js:18383-18398`

- [ ] **Step 1: Add target-model and Ark-binding helpers**

Near `canvasVideoProviderForBody`, add these helpers. They must inspect the original request asset list so an enabled but malformed binding cannot disappear during URL normalization:

```js
const ARK_PERSON_TARGET_MODELS = new Set(["seedance-2-0", "seedance-2-0-fast", "seedance-2-0-mini"]);

function isArkPersonTargetModel(value = "") {
  return ARK_PERSON_TARGET_MODELS.has(compactLine(value));
}

function arkPersonAssetUrl(asset = {}) {
  if (asset?.arkPersonAsset?.enabled !== true) return "";
  const url = compactLine(asset.arkPersonAsset.assetUrl || "");
  return /^asset:\/\//i.test(url) ? url : "";
}

function assertArkPersonAssetsReady(body = {}) {
  const modelMode = compactLine(body.modelMode || body.model || "");
  if (!isArkPersonTargetModel(modelMode)) return;
  const invalid = (Array.isArray(body.assets) ? body.assets : [])
    .filter((asset) => asset?.arkPersonAsset?.enabled === true)
    .filter((asset) => !arkPersonAssetUrl(asset))
    .map((asset) => compactLine(asset.name || asset.id || "未命名真人素材"));
  if (invalid.length) throw new Error(`方舟真人素材未绑定有效 asset://：${invalid.join("、")}`);
}
```

Add an explicit `preferArkPersonAsset = false` option to `canvasVideoAssetSubmitUrl()` and `canvasVideoSubmitCapableAssets()`. Only when the option is true may `canvasVideoAssetSubmitUrl()` return `arkPersonAssetUrl(asset)` before checking existing Gravitex fields. Call `canvasVideoSubmitCapableAssets(body.assets, { preferArkPersonAsset: true })` from `buildSeedanceGenerationPayload()` only; preserve the default call in `buildGravitexVideoGenerationPayload()` so that mode never reads `arkPersonAsset`.

Update `canvasVideoProviderForBody()` so a target model with any enabled `arkPersonAsset` returns `"ark"`; retain its existing Gravitex branch only for `seedance-2-0-person-reference` and its existing liveness path. The provider decision must inspect the original request assets, rather than the normalized asset URLs.

- [ ] **Step 2: Add first/last-frame accounting and Ark content construction**

Extend `assertSeedanceReferenceBudget()` and `assertResolvedAllSeedanceReferences()` with `firstFrameUrl` and `lastFrameUrl`, counting both as required inputs. Preserve `startFrameUrl` for old automatic continuity only.

At the start of `buildSeedanceGenerationPayload()`, validate the binding and choose the frame source:

```js
assertArkPersonAssetsReady(body);
const frameControl = compactLine(body.frameControl || "reference");
const manualFirstFrameUrl = compactLine(body.firstFrameUrl || body.first_frame_url || "");
const manualLastFrameUrl = compactLine(body.lastFrameUrl || body.last_frame_url || "");
if (frameControl === "first_last" && (!manualFirstFrameUrl || !manualLastFrameUrl)) {
  throw new Error("首尾帧模式必须同时选择首帧和尾帧图片。");
}
const startFrameUrl = frameControl === "first_last"
  ? ""
  : compactLine(body.startFrameUrl || body.start_frame_url || "");
```

Resolve the manual URLs with `assetUrlToReferenceUrl(..., { allowAssetUrl: true })`, subtract their count from `SEEDANCE_MAX_IMAGE_REFERENCES`, and place the resolved content before ordinary references. In `resolveSeedanceImageReferences()`, when `options.preferArkPersonAsset === true`, choose `arkPersonAssetUrl(asset)` before the old `assetUrl`, `publicUrl`, and `url` fallbacks. Pass this option from `buildSeedanceGenerationPayload()` only.

```js
payload.content = [
  { type: "text", text: finalPrompt },
  ...(firstFrameReferenceUrl ? [{ type: "image_url", image_url: { url: firstFrameReferenceUrl }, role: "first_frame" }] : []),
  ...(lastFrameReferenceUrl ? [{ type: "image_url", image_url: { url: lastFrameReferenceUrl }, role: "last_frame" }] : []),
  ...imageReferences.map((reference) => ({ type: "image_url", image_url: { url: reference.url }, role: "reference_image" })),
];
```

Build `promptReferences` in exactly the same order, beginning with the manual first and last frame, so `@图片1` etc. remains aligned with `content` without writing any Asset ID into the prompt.

- [ ] **Step 3: Export the narrow test hooks and run the new test**

Extend the existing `module.exports.__test` object without changing its other keys:

```js
canvasVideo: {
  canvasVideoProviderForBody,
  buildSeedanceGenerationPayload,
},
```

Run: `node scripts/canvas-ark-video.test.js`

Expected: `canvas Ark video tests passed.`

### Task 3: Add Standalone Canvas State and Controls

**Files:**
- Modify: `public/canvas.js:135-152,278-335,407-430,842-913,1292-1409,2608-2645`
- Modify: `public/canvas.html:245-324`
- Modify: `public/canvas.css` near the existing `.video-settings-strip` and `.video-liveness-library` rules

- [ ] **Step 1: Add a failing UI boundary test**

Create `scripts/canvas-ark-video-ui.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");

assert.match(html, /data-frame-control/, "video node must expose frame control");
assert.match(html, /data-ark-person-panel/, "video node must expose Ark person binding controls");
assert.match(js, /arkPersonAsset/, "canvas state must preserve Ark person bindings");
assert.match(js, /firstFrameAssetId/, "canvas state must persist a first-frame selection");
assert.match(js, /lastFrameAssetId/, "canvas state must persist a last-frame selection");
assert.match(js, /frameControl === "first_last"/, "manual first/last frames must take precedence over continuity");
assert.match(js, /PERSON_REFERENCE_MODEL/, "person-reference mode must retain an explicit branch");
console.log("canvas Ark video UI tests passed.");
```

Register it immediately after `node scripts/canvas-ark-video.test.js` in `package.json`.

Run: `node scripts/canvas-ark-video-ui.test.mjs`

Expected: fail because the new controls and fields do not exist yet.

- [ ] **Step 2: Persist defaults and build the outgoing payload**

Add `frameControl: "reference"`, `firstFrameAssetId: ""`, and `lastFrameAssetId: ""` to `VIDEO_NODE_DEFAULTS`. In `normalizeRestoredNode()` and `createNode()`, merge those defaults so old canvases remain valid.

Add browser helpers that only read `asset.arkPersonAsset` and never overwrite the Gravitex fields:

```js
function arkPersonAssetUrl(asset = {}) {
  if (asset?.arkPersonAsset?.enabled !== true) return "";
  const url = compactNodeText(asset.arkPersonAsset.assetUrl || "");
  return /^asset:\/\//i.test(url) ? url : "";
}

function isArkPersonTargetVideoNode(node) {
  const model = node?.settings?.model || VIDEO_NODE_DEFAULTS.model;
  return ["seedance-2-0", "seedance-2-0-fast", "seedance-2-0-mini"].includes(model);
}
```

In `videoNodePayload()`, resolve `firstFrameAssetId` and `lastFrameAssetId` from `canvasState.assets`. When `frameControl === "first_last"`, send their submit-capable URLs as `firstFrameUrl` and `lastFrameUrl`, remove their IDs from normal `assets`, and set `startFrameUrl` to an empty string. Otherwise retain existing upstream-tail behavior.

Replace the body of `syncVideoModelForReferences()` with a no-op for the three target modes so connecting a reference never changes the user's model selection. Keep its explicit person-reference behavior untouched.

- [ ] **Step 3: Render and bind the compact controls**

In `public/canvas.html`, add a `data-frame-control` select after the model selector with values `reference` and `first_last`. Add hidden `data-first-last-frame-panel` controls containing `data-first-frame-select` and `data-last-frame-select`. Add a hidden `data-ark-person-panel` containing a select of connected assets, an `asset://` text input, bind/clear buttons, and a status element.

In `public/canvas.js`, populate all three selects from `referenceAssetsForVideoNode(node)`, bind their change events to node settings or the selected asset's `arkPersonAsset`, and call `scheduleCanvasSave()` after every mutation. Show these panels only for the three target models; keep `[data-video-liveness-library]` controlled by the existing `PERSON_REFERENCE_MODEL` path.

Render first and last frame chips separately in `renderNodeAssets()`. In `validateVideoNode()`, require both selected assets, require a valid `asset://` for every enabled `arkPersonAsset`, and skip `missingUpstreamTailFrameForVideoNode()` when `frameControl === "first_last"`.

Add scoped CSS rules for the two new panels using the existing small control typography and 8px-or-less radii. Do not alter the general canvas layout or Gravitex styles.

- [ ] **Step 4: Run the UI test and syntax check**

Run: `node scripts/canvas-ark-video-ui.test.mjs && node --check public/canvas.js`

Expected: both commands succeed and print `canvas Ark video UI tests passed.`

### Task 4: Run Regression Verification

**Files:**
- Modify: `scripts/self-check.mjs:609-612`

- [ ] **Step 1: Add durable source guards**

Append these checks next to the current video-reference regression checks:

```js
assert(server.includes("function assertArkPersonAssetsReady"), "Ark-bound person assets must be server-validated");
assert(server.includes('role: "first_frame"') && server.includes('role: "last_frame"'), "Ark payload must use official first/last-frame roles");
assert(canvas.includes("arkPersonAsset") && canvas.includes('frameControl === "first_last"'), "standalone canvas must preserve Ark binding and manual frame state");
```

- [ ] **Step 2: Run focused checks**

Run: `node --check server.js && node scripts/canvas-ark-video.test.js && node scripts/canvas-ark-video-ui.test.mjs && node scripts/self-check.mjs`

Expected: all commands exit 0; no external generation request is made.

- [ ] **Step 3: Run the full suite and production build**

Run: `npm test`

Expected: all existing tests, the two new tests, `npm run build`, and self-check pass.
