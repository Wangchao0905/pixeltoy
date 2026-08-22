import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

const start = canvas.indexOf("function videoPreviewSrc(node) {");
const end = canvas.indexOf("function renderVideoPreview(node) {", start);
assert.ok(start >= 0 && end > start, "video preview URL helper must exist");
const helper = canvas.slice(start, end);

assert.match(
  helper,
  /if \(url\.origin !== window\.location\.origin\) return raw;/,
  "external signed video URLs must remain unchanged",
);
assert.match(
  helper,
  /url\.searchParams\.set\("canvasVideoGeneration", version\)/,
  "same-origin media URLs should still receive a cache-busting generation marker",
);
assert.match(canvas, /videoPreviewSrc\(node\)/, "video preview renderer must use the safe URL helper");
assert.match(html, /canvas\.js\?v=canvas-video-module-20260822-r1/);

console.log("canvas signed video URL tests passed");
