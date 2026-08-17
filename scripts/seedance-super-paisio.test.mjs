import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleNamespace = await import(path.join(root, "server.js"));
const { __test } = moduleNamespace.default?.__test ? moduleNamespace.default : moduleNamespace;
const { canvasVideoProviderForBody, buildPaisioVideoGenerationPayload, normalizePaisioDuration, normalizePaisioStatus } = __test.canvasVideo;

assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0-super", modelMode: "seedance-2-0-super" }),
  "paisio",
  "Seedance 2.0 super must route through Paisio",
);
assert.equal(normalizePaisioDuration(0), 6, "Paisio duration defaults to six seconds");
assert.equal(normalizePaisioDuration(99), 30, "Paisio duration is capped at thirty seconds");
assert.equal(
  normalizePaisioStatus({ task_id: "task-1", status: "completed", video_url: "https://cdn.example/video?id=1" }).videoUrl,
  "https://cdn.example/video?id=1",
  "Paisio direct video_url values must be accepted even without an .mp4 suffix",
);

const payload = await buildPaisioVideoGenerationPayload({
  model: "seedance-2-0-super",
  prompt: "@图片1 在街道上向镜头走来",
  duration: 8,
  ratio: "9:16",
});
assert.equal(payload.model, process.env.PAISIO_SEEDANCE_SUPER_MODEL || "sd2-720p");
assert.match(payload.prompt, /@Image1 在街道上向镜头走来$/);
assert.equal(payload.duration, 8);
assert.equal(payload.aspect_ratio, "9:16");
assert.equal(payload.image_url, undefined);

const uploaded = [];
const virtualPayload = await buildPaisioVideoGenerationPayload(
  {
    model: "seedance-2-0-super",
    prompt: "@图片1 与@视频1 配合@音频1",
    firstFrameUrl: "https://cdn.example/first.png",
    lastFrameUrl: "https://cdn.example/last.png",
    assets: [
      { id: "image-1", name: "人物.png", url: "https://cdn.example/person.png", mediaType: "image" },
      { id: "video-1", name: "动作.mp4", url: "https://cdn.example/motion.mp4", mediaType: "video" },
      { id: "audio-1", name: "对白.mp3", url: "https://cdn.example/dialogue.mp3", mediaType: "audio" },
    ],
  },
  {
    uploadVirtualAsset: async (source, name, kind) => {
      uploaded.push({ source, name, kind });
      return { url: `asset://va-${uploaded.length}`, assetId: `va-${uploaded.length}`, status: "active" };
    },
  },
);
assert.deepEqual(uploaded.map((item) => item.kind), ["image", "image", "image", "video", "audio"]);
assert.equal(virtualPayload.image_url, "asset://va-1");
assert.deepEqual(virtualPayload.extra_images, ["asset://va-3"]);
assert.deepEqual(virtualPayload.extra_videos, ["asset://va-4"]);
assert.deepEqual(virtualPayload.extra_audios, ["asset://va-5"]);
assert.equal(virtualPayload.end_image_url, "asset://va-2");

const fallbackPayload = await buildPaisioVideoGenerationPayload(
  {
    model: "seedance-2-0-super",
    prompt: "公网素材回退测试",
    assets: [{ id: "image-404", name: "fallback.png", url: "https://cdn.example/fallback.png", mediaType: "image" }],
  },
  {
    uploadVirtualAsset: async () => {
      const error = new Error("Invalid URL (POST /v1/virtual-assets)");
      error.code = "PAISIO_VIRTUAL_ASSET_ROUTE_UNAVAILABLE";
      throw error;
    },
  },
);
assert.equal(fallbackPayload.image_url, "https://cdn.example/fallback.png");

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const canvasHtml = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

assert.match(server, /PAISIO_VIDEO_BASE_URL/);
assert.match(server, /PAISIO_SEEDANCE_SUPER_MODEL/);
assert.match(server, /callPaisioJson\("\/v1\/videos"/);
assert.match(server, /callPaisioMultipart\("\/v1\/virtual-assets"/);
assert.match(server, /virtual-assets\/\$\{encodeURIComponent\(uploaded\.assetId\)\}\/sync/);
assert.match(server, /uploadFallback: "public-url"/);
assert.match(server, /paisioLocalReferenceUrl/);
assert.match(server, /paisioVirtualAssetRouteUnavailable/);
assert.match(server, /fetchWithBodyTimeout/);
assert.match(server, /PAISIO_VIDEO_REQUEST_TIMEOUT_MS/);
assert.match(server, /getPaisioCanvasVideoGeneration/);
assert.match(app, /"seedance-2-0-super": "Seedance 2\.0 super"/);
assert.match(canvas, /"seedance-2-0-super": "Seedance 2\.0 super"/);
assert.match(index, /value="seedance-2-0-super">Seedance 2\.0 super/);
assert.match(canvasHtml, /value="seedance-2-0-super">Seedance 2\.0 super/);

console.log("seedance-super-paisio ok");
