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

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const canvasHtml = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

assert.match(server, /PAISIO_VIDEO_BASE_URL/);
assert.match(server, /PAISIO_SEEDANCE_SUPER_MODEL/);
assert.match(server, /callPaisioJson\("\/v1\/videos"/);
assert.match(server, /getPaisioCanvasVideoGeneration/);
assert.match(app, /"seedance-2-0-super": "Seedance 2\.0 super"/);
assert.match(canvas, /"seedance-2-0-super": "Seedance 2\.0 super"/);
assert.match(index, /value="seedance-2-0-super">Seedance 2\.0 super/);
assert.match(canvasHtml, /value="seedance-2-0-super">Seedance 2\.0 super/);

console.log("seedance-super-paisio ok");
