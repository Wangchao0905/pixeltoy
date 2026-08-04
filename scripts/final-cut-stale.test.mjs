import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

assert.equal(typeof __test.finalCut?.finalCutOutputIsCurrent, "function", "final cut freshness helper must be exposed");
assert.equal(typeof __test.finalCut?.finalCutClipSignature, "function", "final cut signature helper must be exposed");
assert.equal(
  __test.finalCut.finalCutOutputIsCurrent({ outputMtime: 200, clips: [{ mtimeMs: 100 }, { mtimeMs: 200 }], missing: [], total: 2 }),
  true,
  "a final cut newer than every source clip remains current",
);
assert.equal(
  __test.finalCut.finalCutOutputIsCurrent({ outputMtime: 200, clips: [{ mtimeMs: 100 }, { mtimeMs: 201 }], missing: [], total: 2 }),
  false,
  "a regenerated source clip must invalidate the previous final cut",
);
assert.equal(
  __test.finalCut.finalCutOutputIsCurrent({ outputMtime: 300, clips: [{ mtimeMs: 100 }], missing: ["E01_V02"], total: 2 }),
  false,
  "a missing source clip must invalidate the previous final cut",
);
const currentClips = [
  { name: "E01_V01", mtimeMs: 100, size: 10, version: "v1" },
  { name: "E01_V02", mtimeMs: 110, size: 20, version: "v2" },
];
const currentSignature = __test.finalCut.finalCutClipSignature(currentClips);
assert.equal(
  __test.finalCut.finalCutOutputIsCurrent({ outputMtime: 999, outputSignature: currentSignature, clips: currentClips, missing: [], total: 2 }),
  true,
  "a matching clip manifest keeps the final cut current even when file mtimes are ambiguous",
);
assert.equal(
  __test.finalCut.finalCutOutputIsCurrent({ outputMtime: 999, outputSignature: currentSignature, clips: [{ ...currentClips[0], version: "v3" }, currentClips[1]], missing: [], total: 2 }),
  false,
  "a regenerated clip must invalidate a final cut with a previous manifest signature",
);
assert.match(serverSource(), /finalCutOutputIsCurrent/, "server status must use the freshness helper");
assert.match(serverSource(), /current:\s*outputCurrent/, "stale final cuts must keep a preview URL with an explicit current flag");
assert.match(app, /fc\.stale \|\| fc\.status === "stale"/, "the UI must show a stale state after a source clip changes");
assert.match(app, /modernVideoQueueGenerate[\s\S]*?generateModernVideoQueueShot/, "bottom take action must use the selected-shot handler");
assert.match(app, /generateModernVideoQueueShot[\s\S]*?generateVideoSegment\(shotName/, "selected-shot handler must submit one shot");

function serverSource() {
  return fs.readFileSync(path.join(root, "server.js"), "utf8");
}

console.log("final cut stale-state tests passed");
