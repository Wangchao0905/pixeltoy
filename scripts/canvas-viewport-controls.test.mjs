import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");

assert.match(html, /class="canvas-zoom-controls"[^>]*aria-label="画布缩放"/);
assert.match(html, /data-canvas-zoom="out"[^>]*aria-label="缩小画布"/);
assert.match(html, /data-canvas-zoom="in"[^>]*aria-label="放大画布"/);
assert.match(html, /data-canvas-zoom="reset"[^>]*aria-label="重置画布缩放"/);
assert.match(js, /const CANVAS_MIN_SCALE = 0\.25/);
assert.match(js, /const CANVAS_MAX_SCALE = 2\.5/);
assert.match(js, /function resetCanvasViewport\(/);
assert.match(js, /data-canvas-zoom/);
assert.match(js, /event\.key === "0"/);
assert.match(css, /\.canvas-zoom-controls\s*\{/);
assert.match(css, /\.canvas-zoom-controls button:focus-visible\s*\{/);

console.log("canvas viewport controls tests passed");
