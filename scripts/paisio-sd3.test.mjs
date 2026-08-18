import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleNamespace = await import(path.join(root, "server.js"));
const { __test } = moduleNamespace.default?.__test ? moduleNamespace.default : moduleNamespace;
const { canvasVideoProviderForBody, buildPaisioVideoGenerationPayload, buildPaisioMiniMaxH3ChatPayload, normalizePaisioMiniMaxH3Status, normalizePaisioDuration, normalizePaisioStatus } = __test.canvasVideo;

for (const [model, expectedModels] of [
  ["seedance-2-0-m", { "480p": "sd3-480p", "720p": "sd3-720p" }],
  ["seedance-2-0-m-fast", { "480p": "sd3-fast-480p", "720p": "sd3-fast-720p" }],
  ["seedance-2-0-m-fast-mini", { "480p": "sd2-video20-mini-480p", "720p": "sd2-video20-mini-720p" }],
]) {
  for (const resolution of ["480p", "720p"]) {
    assert.equal(canvasVideoProviderForBody({ model, modelMode: model }), "paisio", `${model} must route through Paisio`);
    const payload = await buildPaisioVideoGenerationPayload({ model, prompt: "Paisio 模型路由测试", duration: 8, resolution, ratio: "16:9" });
    assert.equal(payload.model, expectedModels[resolution], `${model} ${resolution} must select the matching Paisio model ID`);
  }
}
for (const [model, expectedPaisioModel] of [
  ["sd3-480p", "sd3-480p"],
  ["sd3-720p", "sd3-720p"],
  ["sd3-fast-480p", "sd3-fast-480p"],
  ["sd3-fast-720p", "sd3-fast-720p"],
  ["sd2-video20-mini-480p", "sd2-video20-mini-480p"],
  ["sd2-video20-mini-720p", "sd2-video20-mini-720p"],
]) {
  const payload = await buildPaisioVideoGenerationPayload({ model, prompt: "旧配置兼容测试", duration: 8 });
  assert.equal(payload.model, expectedPaisioModel);
  assert.equal(payload.duration, 8);
}
assert.equal(canvasVideoProviderForBody({ model: "minimax-h3", modelMode: "minimax-h3" }), "paisio", "minimax-h3 must route through Paisio");
const miniMaxPayload = await buildPaisioMiniMaxH3ChatPayload({
  model: "minimax-h3",
  prompt: "MiniMax H3 路由测试",
  duration: 8,
  ratio: "16:9",
  assets: [{ id: "reference-1", name: "参考图.png", url: "https://cdn.example/reference.png", mediaType: "image" }],
});
assert.equal(miniMaxPayload.model, "minimax-h3");
assert.equal(miniMaxPayload.duration, 8);
assert.equal(miniMaxPayload.resolution, "2k");
assert.equal(miniMaxPayload.messages[0].content[1].type, "image_url");
assert.equal(miniMaxPayload.messages[0].content[1].image_url.url, "https://cdn.example/reference.png");
await assert.rejects(
  () => buildPaisioMiniMaxH3ChatPayload({ model: "minimax-h3", prompt: "缺少参考图" }),
  /至少需要一张参考图/,
  "minimax-h3 must require at least one reference image",
);
assert.equal(
  normalizePaisioMiniMaxH3Status({ choices: [{ message: { content: "https://cdn.example/videos/minimax-h3.mp4" } }] }).videoUrl,
  "https://cdn.example/videos/minimax-h3.mp4",
  "minimax-h3 chat responses must expose the returned video URL",
);
assert.notEqual(canvasVideoProviderForBody({ model: "seedance-2-0-super", modelMode: "seedance-2-0-super" }), "paisio", "removed super model must not route through Paisio");
assert.equal(normalizePaisioDuration(1, "seedance-2-0-m"), 4, "Seedance 2.0 M requires at least four seconds");
assert.equal(normalizePaisioDuration(99, "seedance-2-0-m"), 15, "Seedance 2.0 M is capped at fifteen seconds");
assert.equal(normalizePaisioDuration(1, "seedance-2-0-m-fast"), 4, "Seedance 2.0 M fast requires at least four seconds");
assert.equal(normalizePaisioDuration(99, "seedance-2-0-m-fast-mini"), 15, "Seedance 2.0 M fast mini is capped at fifteen seconds");
assert.equal(
  normalizePaisioStatus({ task_id: "task-1", status: "completed", video_url: "https://cdn.example/video?id=1" }).videoUrl,
  "https://cdn.example/video?id=1",
  "Paisio direct video_url values must be accepted even without an .mp4 suffix",
);

const referencePayload = await buildPaisioVideoGenerationPayload({
  model: "seedance-2-0-m",
  resolution: "720p",
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
    model: "seedance-2-0-m",
    resolution: "720p",
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
assert.match(server, /PAISIO_SEEDANCE_M_MODEL/);
assert.match(server, /callPaisioJson\("\/v1\/videos"/);
assert.doesNotMatch(server, /PAISIO_SEEDANCE_SUPER_MODEL|seedance-2-0-super/);
assert.doesNotMatch(app, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(canvas, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(index, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(canvasHtml, /seedance-2-0-super|Seedance 2\.0 super/);
assert.match(index, /value="seedance-2-0-m">Seedance 2\.0 M/);
assert.match(index, /value="seedance-2-0-m-fast">Seedance 2\.0 M fast/);
assert.match(index, /value="seedance-2-0-m-fast-mini">Seedance 2\.0 M fast mini/);
assert.match(index, /value="minimax-h3">MiniMax H3/);
assert.match(canvasHtml, /value="seedance-2-0-m">Seedance 2\.0 M/);
assert.match(canvasHtml, /value="seedance-2-0-m-fast">Seedance 2\.0 M fast/);
assert.match(canvasHtml, /value="seedance-2-0-m-fast-mini">Seedance 2\.0 M fast mini/);
assert.match(canvasHtml, /value="minimax-h3">MiniMax H3/);
assert.doesNotMatch(index, /value="sd3-(?:480p|720p)"/);
assert.doesNotMatch(canvasHtml, /value="sd3-(?:480p|720p)"/);

console.log("paisio sd3 tests passed");
