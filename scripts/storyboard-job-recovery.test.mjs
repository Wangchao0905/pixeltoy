import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts/run_asset_generation.js"), "utf8");

const startProcess = server.match(/function startProcessJob\([\s\S]*?\n}\n\nfunction cancelJob/);
assert.ok(startProcess, "startProcessJob must remain isolated for recovery assertions");
assert.match(startProcess[0], /detached:\s*true/, "generation workers must survive a PM2 server restart");
assert.match(startProcess[0], /--job-result/, "the worker must persist an exit marker outside the server process");
assert.match(startProcess[0], /resultPath/, "the persisted job must expose the worker result marker path");
assert.match(startProcess[0], /job\.pid\s*=\s*child\.pid/, "the persisted job must expose the worker PID");

assert.match(server, /function reconcilePersistedJob\(/, "persisted jobs need a restart reconciliation step");
assert.match(server, /reconcilePersistedJob\(job\)/, "mergeJobs must reconcile detached workers before marking them interrupted");
assert.match(server, /function isWorkerProcessAlive\(/, "PID recovery must verify that the PID is still the asset worker");
assert.match(server, /worker result marker|job-result|完成标记/, "interrupted jobs need a precise worker-exit reason");

const resultIndex = runner.indexOf("jobResultPath");
assert.ok(resultIndex >= 0, "asset worker must accept a result marker path");
assert.match(runner, /--job-result/, "asset worker CLI must parse --job-result");
assert.match(runner, /writeJobResult|job result/i, "asset worker must write its completion marker");

console.log("storyboard job recovery tests passed");
