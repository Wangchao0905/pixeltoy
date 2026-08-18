import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(html, /id=["']videoPromptInspectorModel["']/, "video inspector must offer a shot model selector");
assert.match(app, /function videoModelForShot\(/, "client must resolve a shot-level model override");
assert.match(app, /function saveVideoRetryModel\(/, "client must save the selected shot model before retry");
assert.match(app, /\/video-model/, "client must use the shot model API");
assert.match(server, /function updateVideoModelForShotInConfig\(/, "server must update only one shot model override");
assert.match(server, /function projectVideoModelForShot\(/, "video submission must resolve the shot model override");
assert.match(server, /action === "video-model"/, "server must expose the selected shot model API");
assert.doesNotMatch(server, /仅生成失败的片段可以切换模型重试/, "shot model changes must not be limited to failed shots");

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const original = {
  modelName: "seedance-2-0-fast",
  shots: [
    { name: "E01_V01", prompt: "completed shot", refs: ["A"] },
    { name: "E01_V02", prompt: "failed shot", refs: ["B"] },
  ],
};
const next = __test.videoRetry.updateVideoModelForShotInConfig(original, "E01_V02", "seedance-2-0-mini");

assert.equal(next.modelName, "seedance-2-0-fast", "project default model must not change");
assert.deepEqual(next.shots[0], original.shots[0], "completed shot config must remain untouched");
assert.equal(next.shots[1].modelOverride, "seedance-2-0-mini", "only the selected failed shot gets an override");
assert.equal(__test.videoRetry.projectVideoModelForShot(next, next.shots[1]), "seedance-2-0-mini", "selected shot payload must use its override");
assert.equal(__test.videoRetry.projectVideoModelForShot(next, next.shots[0]), "seedance-2-0-fast", "other shots must retain the project model");
const completedModelChange = __test.videoRetry.updateVideoModelForShotInConfig(original, "E01_V01", "seedance-2-0-mini");
assert.equal(completedModelChange.shots[0].modelOverride, "seedance-2-0-mini", "a completed shot can switch model for explicit regeneration");
assert.deepEqual(completedModelChange.shots[1], original.shots[1], "switching one shot model must not reset other shot state");
assert.throws(
  () => __test.videoRetry.updateVideoModelForShotInConfig(original, "missing", "seedance-2-0-mini"),
  /视频片段不存在/,
);
assert.throws(
  () => __test.videoRetry.updateVideoModelForShotInConfig(original, "E01_V02", "unsupported-model"),
  /不支持的视频模型/,
);
assert.throws(
  () => __test.videoRetry.updateVideoModelForShotInConfig(original, "E01_V02", "seedance-2-0-person-reference"),
  /不支持的视频模型/,
  "the removed person-reference model must not be accepted for new shot overrides",
);

const episodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toy-video-model-retry-"));
const rawDir = path.join(episodeRoot, "06_videos", "raw");
fs.mkdirSync(rawDir, { recursive: true });
const completedFile = path.join(rawDir, "E01_V01.mp4");
const failedFile = path.join(rawDir, "E01_V02.mp4");
fs.writeFileSync(completedFile, "completed");
fs.writeFileSync(failedFile, "failed");
__test.videoRetry.archiveShotVideoArtifactsForRegeneration(episodeRoot, "E01_V02");
assert.equal(fs.existsSync(completedFile), true, "retrying a failed shot must not move completed shot media");
assert.equal(fs.existsSync(failedFile), false, "only the retried shot media may be archived");
fs.rmSync(episodeRoot, { recursive: true, force: true });

console.log("video model retry tests passed");
