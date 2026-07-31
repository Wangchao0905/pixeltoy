import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

const statusStart = server.indexOf("function projectStatusSnapshot(episodeRoot)");
const statusEnd = server.indexOf("function fullProjectStateForUser", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, "project status snapshot must remain a bounded function");
const statusSource = server.slice(statusStart, statusEnd);
assert.match(
  statusSource,
  /maybeAutoAssembleFinalCut\(episodeRoot\)/,
  "status polling must run the automatic final-cut trigger",
);

const autoStart = server.indexOf("function maybeAutoAssembleFinalCut(episodeRoot)");
const autoEnd = server.indexOf("\nfunction fullProjectState", autoStart);
assert.ok(autoStart >= 0 && autoEnd > autoStart, "automatic final-cut trigger must remain a bounded function");
const autoSource = server.slice(autoStart, autoEnd);
assert.match(
  autoSource,
  /startFinalCutAssembly\(episodeRoot\)[\s\S]*?autoFinalCutSignatures\.set\(key, signature\)/,
  "the signature guard must be recorded only after assembly is successfully started",
);

const runningWorkStart = app.indexOf("function projectHasRunningWork");
const runningWorkEnd = app.indexOf("function updateGenerationCanvasLinks", runningWorkStart);
const runningWorkSource = app.slice(runningWorkStart, runningWorkEnd);
assert.match(runningWorkSource, /data\.finalCut\?\.running/, "active work detection must include final-cut assembly");

console.log("final cut auto-trigger tests passed");
