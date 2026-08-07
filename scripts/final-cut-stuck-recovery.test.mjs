import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { __test } = require(path.join(root, "server.js"));
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.equal(typeof __test.finalCut?.finalCutJobIsStale, "function", "final-cut jobs need a stale liveness helper");
const now = Date.parse("2026-08-06T00:00:00.000Z");
assert.equal(
  __test.finalCut.finalCutJobIsStale({ running: true, updatedAt: "2026-08-05T23:55:00.000Z", ffmpegPid: 0 }, now),
  true,
  "a running job without a live ffmpeg process must become recoverable after its heartbeat expires",
);
assert.equal(
  __test.finalCut.finalCutJobIsStale({ running: true, updatedAt: "2026-08-06T00:00:30.000Z", ffmpegPid: 0 }, now),
  false,
  "a recently heartbeating job must remain running",
);
assert.equal(
  __test.finalCut.finalCutJobIsStale({ running: false, updatedAt: "2026-08-05T23:00:00.000Z", ffmpegPid: 0 }, now),
  false,
  "completed or failed jobs must not be treated as stuck",
);
assert.match(server, /onHeartbeat:\s*\(\) => touchFinalCutJob\(job\)/, "ffmpeg assembly must refresh the final-cut heartbeat");
assert.match(server, /recoverStaleFinalCutJob\(episodeRoot\)/, "status and manual start must recover stale final-cut jobs");
assert.match(server, /ffmpegPid:\s*child\.pid/, "final-cut status must track the active ffmpeg process");

console.log("final cut stuck-recovery tests passed");
