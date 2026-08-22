import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleNamespace = await import(path.join(root, "server.js"));
const { __test } = moduleNamespace.default?.__test ? moduleNamespace.default : moduleNamespace;
const { canvasVideoProviderForBody, buildPaisioVideoGenerationPayload, buildPaisioMiniMaxH3ChatPayload, normalizePaisioMiniMaxH3Status, normalizePaisioDuration, normalizePaisioStatus, normalizeVideoResolution, paisioVideoSubmitTimeoutForBody, normalizeVideoGenerationErrorMessage, isTransientVideoGatewayResponse } = __test.canvasVideo;

assert.equal(
  normalizeVideoGenerationErrorMessage("<!DOCTYPE html><html><body>upstream error</body></html>"),
  "视频网关返回了 HTML 页面，而不是 JSON API 响应，请检查登录状态、网关地址或稍后重试。",
  "HTML gateway responses must become a concise actionable error",
);
assert.equal(
  isTransientVideoGatewayResponse({ status: 409 }, "<!DOCTYPE html><html><title>Could not find host</title></html>", "GET"),
  true,
  "Cloudflare HTML polling failures must be retryable",
);
assert.equal(
  isTransientVideoGatewayResponse({ status: 409 }, JSON.stringify({ error: { code: "TASK_NOT_FOUND" } }), "GET"),
  false,
  "JSON task errors must remain terminal",
);
assert.equal(
  isTransientVideoGatewayResponse({ status: 502 }, "<!DOCTYPE html><html><title>Bad gateway</title></html>", "POST"),
  false,
  "submission failures must never be retried automatically",
);

assert.equal(
  paisioVideoSubmitTimeoutForBody({ model: "seedance-2-5-c", modelMode: "seedance-2-5-c" }),
  180_000,
  "Seedance 2.5 C must allow a longer Paisio submission window for 30-second jobs",
);
assert.equal(
  paisioVideoSubmitTimeoutForBody({ model: "sd3-720p", modelMode: "sd3-720p" }),
  45_000,
  "other Paisio video models must keep the default submission timeout",
);

for (const [model, expectedModels] of [
  ["sd2", { "480p": "sd2-480p", "720p": "sd2-720p" }],
  ["sd2-fast", { "720p": "sd2-fast-720p" }],
  ["seedance-2-5", { "720p": "sd2.5-ultra-720p" }],
  ["seedance-2-5-m", { "480p": "paisiodance-2.5-480p", "720p": "paisiodance-2.5-720p" }],
  ["seedance-2-0", { "720p": "sd2-ultra-720p" }],
  ["seedance-2-0-fast", { "720p": "sd2-ultra-fast-720p" }],
  ["seedance-2-0-mini", { "480p": "sd2-video20-mini-480p", "720p": "sd2-video20-mini-720p" }],
  ["seedance-2-0-m", { "480p": "sd3-480p", "720p": "sd3-720p" }],
  ["seedance-2-0-m-fast", { "480p": "sd3-fast-480p", "720p": "sd3-fast-720p" }],
  ["seedance-2-0-m-fast-mini", { "480p": "sd2-video20-mini-480p", "720p": "sd2-video20-mini-720p" }],
]) {
  for (const resolution of Object.keys(expectedModels)) {
    assert.equal(canvasVideoProviderForBody({ model, modelMode: model }), "paisio", `${model} must route through Paisio`);
    const payload = await buildPaisioVideoGenerationPayload({ model, prompt: "Paisio 模型路由测试", duration: 8, resolution, ratio: "16:9" });
    assert.equal(payload.model, expectedModels[resolution], `${model} ${resolution} must select the matching Paisio model ID`);
  }
}
const paisio25Payload = await buildPaisioVideoGenerationPayload({
  model: "seedance-2-5",
  prompt: "Seedance 2.5 长视频测试",
  duration: 30,
  resolution: "480p",
});
assert.equal(paisio25Payload.model, "sd2.5-ultra-720p");
assert.equal(paisio25Payload.duration, 30, "Paisio Seedance 2.5 must preserve the 30-second limit");
assert.equal(
  (await buildPaisioVideoGenerationPayload({ model: "seedance-2-5-m", prompt: "Seedance 2.5 M 长视频测试", duration: 30, resolution: "480p" })).duration,
  30,
  "Seedance 2.5 M must preserve the 30-second limit",
);
assert.equal(
  (await buildPaisioVideoGenerationPayload({ model: "seedance-2-0", prompt: "固定规格测试", resolution: "4k" })).model,
  "sd2-ultra-720p",
  "Seedance 2.0 must keep the fixed 720p Paisio model even when an unsupported resolution is requested",
);
assert.equal(
  (await buildPaisioVideoGenerationPayload({ model: "seedance-2-0-mini", prompt: "固定规格测试", resolution: "720p" })).model,
  "sd2-video20-mini-720p",
  "Seedance 2.0 Mini must select the 720p Paisio model when 720p is requested",
);
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
assert.equal(canvasVideoProviderForBody({ model: "mx-h3", modelMode: "mx-h3" }), "paisio", "mx-h3 must route through Paisio");
const miniMaxPayload = await buildPaisioMiniMaxH3ChatPayload({
  model: "mx-h3",
  prompt: "MiniMax H3 路由测试",
  duration: 8,
  ratio: "16:9",
  assets: [{ id: "reference-1", name: "参考图.png", url: "https://cdn.example/reference.png", mediaType: "image" }],
});
assert.equal(miniMaxPayload.model, "mx-h3");
assert.equal(miniMaxPayload.duration, 8);
assert.equal(miniMaxPayload.resolution, "2k");
assert.equal(miniMaxPayload.messages[0].content[1].type, "image_url");
assert.equal(miniMaxPayload.messages[0].content[1].image_url.url, "https://cdn.example/reference.png");
assert.equal(canvasVideoProviderForBody({ model: "seedance-2-5-c", modelMode: "seedance-2-5-c" }), "paisio", "Seedance 2.5 C must route through Paisio");
const seedance25CPayload = await buildPaisioVideoGenerationPayload({
  model: "seedance-2-5-c",
  prompt: "@图片1 作为首帧，保持人物动作连续",
  duration: 30,
  resolution: "1080p",
  ratio: "16:9",
  assets: [{ id: "image-c-1", name: "参考图.png", url: "https://cdn.example/seedance-c.png", mediaType: "image" }],
});
assert.equal(seedance25CPayload.model, "seedance2.5-4-1-720p");
assert.equal(seedance25CPayload.duration, 30);
assert.equal(seedance25CPayload.image_url, "https://cdn.example/seedance-c.png");
await assert.rejects(
  () => buildPaisioVideoGenerationPayload({ model: "seedance-2-5-c", prompt: "使用@视频1", assets: [{ url: "https://cdn.example/ref.mp4", mediaType: "video" }] }),
  /只支持图片参考/,
  "Seedance 2.5 C must reject unsupported video references",
);
await assert.rejects(
  () => buildPaisioVideoGenerationPayload({ model: "seedance-2-5-c", prompt: "使用@视频1" }),
  /只支持图片参考/,
  "Seedance 2.5 C must reject video mentions even without an attached video",
);
assert.equal(
  (await buildPaisioVideoGenerationPayload({
    model: "seedance-2-5-c",
    prompt: "@图片1 @图片2",
    assets: [
      { url: "https://cdn.example/ref-1.png", mediaType: "image" },
      { url: "https://cdn.example/ref-2.png", mediaType: "image" },
    ],
  })).extra_images.length,
  1,
  "Seedance 2.5 C must use the standard extra_images payload",
);
assert.equal(normalizePaisioDuration(99, "seedance-2-5-c"), 30, "Seedance 2.5 C must support up to 30 seconds");
assert.equal(normalizePaisioDuration(1, "seedance-2-5-c"), 4, "Seedance 2.5 C must start at four seconds");
assert.equal(normalizeVideoResolution("480p", "sd2-fast"), "720p", "sd2-fast must fall back to its only 720p resolution");
assert.equal(normalizeVideoResolution("480p", "sd2"), "480p", "sd2 must keep its selectable 480p resolution");
const miniMaxReferencePayload = await buildPaisioMiniMaxH3ChatPayload({
  model: "mx-h3",
  prompt: "@图片1 和@图片2 对话，@视频1 作为动作参考，@音频1 作为声音参考",
  duration: 8,
  assets: [
    { id: "image-1", name: "人物1.png", url: "https://cdn.example/person-1.png", mediaType: "image" },
    { id: "image-2", name: "人物2.png", url: "https://cdn.example/person-2.png", mediaType: "image" },
    { id: "video-1", name: "动作.mp4", url: "https://cdn.example/motion.mp4", mediaType: "video" },
    { id: "audio-1", name: "对白.mp3", url: "https://cdn.example/dialogue.mp3", mediaType: "audio" },
  ],
});
assert.match(miniMaxReferencePayload.messages[0].content[0].text, /@Image1/);
assert.match(miniMaxReferencePayload.messages[0].content[0].text, /@Image2/);
assert.match(miniMaxReferencePayload.messages[0].content[0].text, /@Video1/);
assert.match(miniMaxReferencePayload.messages[0].content[0].text, /@Audio1/);
assert.doesNotMatch(miniMaxReferencePayload.messages[0].content[0].text, /@图片|@视频|@音频/);
assert.deepEqual(
  miniMaxReferencePayload.messages[0].content.slice(1).map((item) => item.type),
  ["image_url", "image_url", "video_url", "audio_url"],
  "mx-h3 content items must preserve the image/video/audio reference order",
);
assert.equal(
  (await buildPaisioMiniMaxH3ChatPayload({
    model: "minimax-h3",
    prompt: "旧模型 ID 迁移测试",
    assets: [{ url: "https://cdn.example/reference.png", mediaType: "image" }],
  })).model,
  "mx-h3",
  "legacy minimax-h3 requests must be migrated to mx-h3",
);
await assert.rejects(
  () => buildPaisioMiniMaxH3ChatPayload({ model: "mx-h3", prompt: "缺少参考图" }),
  /至少需要一张参考图/,
  "mx-h3 must require at least one reference image",
);
assert.equal(
  normalizePaisioMiniMaxH3Status({ choices: [{ message: { content: "https://cdn.example/videos/minimax-h3.mp4" } }] }).videoUrl,
  "https://cdn.example/videos/minimax-h3.mp4",
  "mx-h3 chat responses must expose the returned video URL",
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
const pixelsStudio = fs.readFileSync(path.join(root, "public", "pixels-studio.js"), "utf8");
const expectedPaisioPrices = [
  ["sd2", "0.230/秒", "0.290/秒"],
  ["sd2-fast", "0.230/秒"],
  ["Seedance 2.5", "1.270/秒"],
  ["Seedance 2.5 C", "3.500/秒"],
  ["Seedance 2.5 M", "0.570/秒", "0.970/秒"],
  ["Seedance 2.0", "0.730/秒"],
  ["Seedance 2.0 Fast", "0.620/秒"],
  ["Seedance 2.0 Mini", "0.210/秒", "0.280/秒"],
  ["Seedance 2.0 M", "0.420/秒", "0.560/秒"],
  ["Seedance 2.0 M fast", "0.350/秒", "0.490/秒"],
  ["Seedance 2.0 M fast mini", "0.210/秒", "0.280/秒"],
  ["mx-h3", "2.800/秒"],
];
for (const [label, ...prices] of expectedPaisioPrices) {
  for (const price of prices) assert.match(`${index}\n${canvasHtml}\n${pixelsStudio}`, new RegExp(price.replace("/", "\\/")), `${label} must expose its Paisio price`);
  assert.match(`${index}\n${canvasHtml}\n${pixelsStudio}`, new RegExp(`${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")} · ${prices[0].replace("/", "\\/")}起`), `${label} must show its starting price after the model name`);
}

assert.match(server, /PAISIO_SD3_MODELS/);
assert.match(server, /PAISIO_SEEDANCE_M_MODEL/);
assert.match(server, /callPaisioJson\("\/v1\/videos"/);
assert.match(server, /PAISIO_SPECIAL_VIDEO_MODEL_MAP/);
assert.match(server, /\[PAISIO_SD2_MODEL\]: \{ "480p": "sd2-480p", "720p": "sd2-720p" \}/);
assert.match(server, /\[PAISIO_SD2_FAST_MODEL\]: \{ "720p": "sd2-fast-720p" \}/);
assert.match(server, /PAISIO_SEEDANCE_25_C_REQUEST_TIMEOUT_MS/);
assert.match(server, /提交请求可能已被上游接收/);
assert.doesNotMatch(server, /buildPaisioSeedance25CChatPayload/);
assert.doesNotMatch(server, /PAISIO_SEEDANCE_SUPER_MODEL|seedance-2-0-super/);
assert.doesNotMatch(app, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(canvas, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(index, /seedance-2-0-super|Seedance 2\.0 super/);
assert.doesNotMatch(canvasHtml, /seedance-2-0-super|Seedance 2\.0 super/);
assert.match(index, /value="seedance-2-0-m"[^>]*>Seedance 2\.0 M/);
assert.match(index, /value="seedance-2-0-m-fast"[^>]*>Seedance 2\.0 M fast/);
assert.match(index, /value="seedance-2-0-m-fast-mini"[^>]*>Seedance 2\.0 M fast mini/);
assert.match(index, /value="mx-h3"[^>]*>mx-h3/);
assert.match(index, /value="seedance-2-0-m-fast"[^>]*title="480p 0\.350\/秒；720p 0\.490\/秒"/);
assert.match(canvasHtml, /value="seedance-2-0-m"[^>]*>Seedance 2\.0 M/);
assert.match(canvasHtml, /value="seedance-2-0-m-fast"[^>]*>Seedance 2\.0 M fast/);
assert.match(canvasHtml, /value="seedance-2-0-m-fast-mini"[^>]*>Seedance 2\.0 M fast mini/);
assert.match(canvasHtml, /value="mx-h3"[^>]*>mx-h3/);
assert.match(canvasHtml, /value="seedance-2-0-m-fast"[^>]*title="480p 0\.350\/秒；720p 0\.490\/秒"/);
assert.match(index, /value="seedance-2-5-c"[^>]*>Seedance 2\.5 C/);
assert.match(canvasHtml, /value="seedance-2-5-c"[^>]*>Seedance 2\.5 C/);
assert.match(index, /id="modernVideoModelPrice"/);
assert.match(pixelsStudio, /sd2.*0\.230\/秒.*0\.290\/秒/s);
assert.match(pixelsStudio, /sd2-fast.*0\.230\/秒/s);
assert.doesNotMatch(index, /value="sd3-(?:480p|720p)"/);
assert.doesNotMatch(canvasHtml, /value="sd3-(?:480p|720p)"/);

console.log("paisio sd3 tests passed");
