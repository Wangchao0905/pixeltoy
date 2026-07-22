import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-chatcut-runner-"));
const packageDir = path.join(root, "12_chatcut");
const outputDir = path.join(packageDir, "exports");
fs.mkdirSync(outputDir, { recursive: true });
const manifestPath = path.join(packageDir, "assembly_manifest.json");
const briefPath = path.join(packageDir, "edit_brief.md");
const jobPath = path.join(packageDir, "chatcut_job.json");
fs.writeFileSync(manifestPath, "{}\n");
fs.writeFileSync(briefPath, "# edit\n");
fs.writeFileSync(jobPath, JSON.stringify({ id: "chatcut-test", project: { title: "E01" } }));
const runner = path.resolve(new URL("../server/chatcut-agent-runner.js", import.meta.url).pathname);
const run = spawnSync(process.execPath, [runner], {
  encoding: "utf8",
  env: { ...process.env, CHATCUT_AGENT_DRY_RUN: "1", CHATCUT_PACKAGE_DIR: packageDir, CHATCUT_MANIFEST_PATH: manifestPath, CHATCUT_EDIT_BRIEF_PATH: briefPath, CHATCUT_OUTPUT_DIR: outputDir, CHATCUT_JOB_FILE: jobPath },
});
assert.equal(run.status, 0, run.stderr);
const result = JSON.parse(run.stdout);
assert.equal(result.ok, true);
assert.equal(result.dryRun, true);
assert.equal(result.jobId, "chatcut-test");
fs.rmSync(root, { recursive: true, force: true });
console.log("chatcut agent runner tests passed");
