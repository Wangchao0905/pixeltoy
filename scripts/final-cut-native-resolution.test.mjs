import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.equal(typeof __test.finalCut?.finalCutNativeTarget, "function", "native final-cut target helper must be exposed");
assert.deepEqual(
  __test.finalCut.finalCutNativeTarget([{ width: 496, height: 864 }, { width: 496, height: 864 }]),
  { w: 496, h: 864, fps: 24 },
  "matching source clips must assemble at their native dimensions",
);
assert.deepEqual(
  __test.finalCut.finalCutNativeTarget([{ width: 1080, height: 1920 }, { width: 496, height: 864 }]),
  { w: 496, h: 864, fps: 24 },
  "mixed clips must choose the smallest source target rather than upscaling the smaller clip",
);
assert.deepEqual(
  __test.finalCut.finalCutNativeTarget([]),
  { w: 1080, h: 1920, fps: 24 },
  "unreadable source dimensions must retain the legacy fallback target",
);

assert.match(server, /const FINAL_CUT_ASSEMBLY_VERSION = "native-source-v1"/, "assembly format version must invalidate old upscaled final cuts");
assert.match(server, /const finalTarget = finalCutTargetForClips\(clips\)/, "assembly must derive its target from the actual source clips");
assert.match(server, /scale=\$\{finalTarget\.w\}:\$\{finalTarget\.h\}/, "normalization filter must use the native target");
assert.match(server, /assemblyVersion: FINAL_CUT_ASSEMBLY_VERSION/, "manifest must record the native-resolution format version");

console.log("final cut native-resolution tests passed");
