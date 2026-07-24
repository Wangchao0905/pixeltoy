import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

for (const id of [
  "videoPromptInspector",
  "videoPromptInspectorPrompt",
  "closeVideoPromptInspector",
  "saveVideoPrompt",
  "regenerateVideoFromInspector",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} must exist for failed video prompt recovery`);
}

assert.match(app, /function selectVideoForInspector\(/, "failed video cards must be selectable for prompt editing");
assert.match(app, /function saveVideoPrompt\(/, "video prompt edits must be persisted before retrying");
assert.match(app, /function regenerateSelectedVideoFromInspector\(/, "the inspector must resubmit the selected video");
assert.match(app, /data-segment-edit-prompt/, "failed video cards must expose a prompt edit action");
assert.match(app, /forceRegenerate:\s*true/, "manual prompt retries must force a fresh video task");
assert.match(app, /\/video-prompt/, "frontend must use the dedicated video prompt API");

assert.match(server, /function updateVideoPromptInConfig\(/, "server must update one video prompt without rebuilding the full config");
assert.match(server, /action === "video-prompt"/, "server must expose the video prompt update API");

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const nextConfig = __test.videoPrompt.updateVideoPromptInConfig(
  { shots: [{ name: "E01_V01", prompt: "old", videoPrompt: "old" }, { name: "E01_V02", prompt: "keep" }] },
  "E01_V01",
  "safe revised prompt",
);
assert.equal(nextConfig.shots[0].prompt, "safe revised prompt", "the selected shot must use the edited prompt");
assert.equal(nextConfig.shots[0].videoPrompt, "safe revised prompt", "all submission paths must use the edited prompt");
assert.equal(nextConfig.shots[1].prompt, "keep", "other video prompts must remain unchanged");
assert.throws(
  () => __test.videoPrompt.updateVideoPromptInConfig(nextConfig, "missing", "prompt"),
  /视频片段不存在/,
);

console.log("video prompt retry tests passed");
