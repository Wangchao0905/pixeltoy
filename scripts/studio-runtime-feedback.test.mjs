import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.match(app, /function activeStudioRun\(/, "the studio must resolve one real active task for visible feedback");
assert.match(app, /function studioFlowSignature\(/, "flow steps need a stable semantic render signature");
assert.match(app, /node\.dataset\.flowSig !== signature/, "polling must not rebuild unchanged flow status DOM");
assert.match(app, /function renderStudioActionStates\(/, "primary execution controls need persistent task-state feedback");
assert.match(app, /function assetManifestRenderSignature\(/, "asset classification must have an independent stable render signature");
assert.match(app, /overview\.dataset\.manifestSig === signature/, "unchanged classification data must not be rebuilt by polling");
assert.doesNotMatch(
  css,
  /body:not\(\.show-advanced-ui\) \.studio-flow-strip,\n[\s\S]{0,500}?display:\s*none !important;/,
  "the flow strip must stay visible in the normal studio experience",
);
assert.match(css, /\.studio-flow-step\.is-running/, "running flow steps need a dedicated visual state");
assert.match(css, /button\.is-task-running/, "background task buttons need a persistent running state");

console.log("studio runtime feedback tests passed");
