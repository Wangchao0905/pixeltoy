import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleNamespace = await import(path.join(root, "server.js"));
const { __test } = moduleNamespace.default?.__test ? moduleNamespace.default : moduleNamespace;
const { canvasVideoProviderForBody, buildPaisioVideoGenerationPayload, normalizePaisioDuration, normalizePaisioStatus } = __test.canvasVideo;

for (const model of ["sd3-480p", "sd3-720p"]) {
  assert.equal(canvasVideoProviderForBody({ model, modelMode: model }), "paisio", `${model} must route through Paisio`);
  const payload = await buildPaisioVideoGenerationPayload({ model, prompt: "sd3 模型路由测试", duration: 8, ratio: "16:9" });
  assert.equal(payload.model, model, `${model} must be sent as the Paisio model ID`);
  assert.equal(payload.duration, 8);
}
assert.notEqual(canvasVideoProviderForBody({ model: "seedance-2-0-super", modelMode: "seedance-2-0-super" }), "paisio", "removed super model must not route through Paisio");
assert.equal(normalizePaisioDuration(1, "sd3-480p"), 4, "sd3 models require at least four seconds");
assert.equal(normalizePaisioDuration(99, "sd3-720p"), 15, "sd3 models are capped at fifteen seconds");
assert.equal(
  normalizePaisioStatus({ task_id: "task-1", status: "completed", video_url: "https://cdn.example/video?id=1" }).videoUrl,
  "https://cdn.example/video?id=1",
  "Paisio direct video_url values must be accepted even without an .mp4 suffix",
);

const referencePayload = await buildPaisioVideoGenerationPayload({
  model: "sd3-720p",
  prompt: "@图片1 与@视频1 配合@音频1",
  firstFrameUrl: "https://cdn.example/first.png",
  lastFrameUrl: "https://cdn.example/last.png",
  assets: [
    { id: "image-1", name: "人物.png", url: "https://cdn.example/person.png", mediaType: "image" },
    { id: "video-1", name: "动作.mp4", url: "https://cdn.example/motion.mp4", mediaType: "video" },
    { id: "audio-1", name: "对白.mp3", url: "https://cdn.example/dialogue.mp3", mediaType: "audio" },
  ],
});
assert.equal(referencePayload.image_url, "https://cdn.example/first.png");
assert.deepEqual(referencePayload.extra_images, ["https://cdn.example/person.png"]);
assert.deepEqual(referencePayload.extra_videos, ["https://cdn.example/motion.mp4"]);
assert.deepEqual(referencePayload.extra_audios, ["https://cdn.example/dialogue.mp3"]);
assert.equal(referencePayload.end_image_url, "https://cdn.example/last.png");

await assert.rejects(
  () => buildPaisioVideoGenerationPayload({
    model: "sd3-720p",
    prompt: "禁止使用虚拟资产 URI",
    assets: [{ id: "asset-1", name: "人物.png", url: "asset://asset-1", mediaType: "image" }],
  }),
  /不能使用 asset:\/\/ 引用/,
  "Paisio must reject asset:// references before submitting a paid request",
);

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const canvasHtml = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

assert.match(server, /PAISIO_SD3_MODELS/);
assert.match(server, /callPaisioJson\("\/v1\/videos"/);
assert.doesNotMatch(server, /PAISIO_SEEDANCE_SUPER_MODEL|seedance-2-0-super/);
assert.doesNotMatch(app, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(canvas, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(index, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(canvasHtml, /seedance-2-0-super|Seedance 2\.0 super/);
assert.match(index, /value="sd3-480p">sd3-480p/);
assert.match(index, /value="sd3-720p">sd3-720p/);
assert.match(canvasHtml, /value="sd3-480p">sd3-480p/);
assert.match(canvasHtml, /value="sd3-720p">sd3-720p/);

console.log("paisio sd3 tests passed");
