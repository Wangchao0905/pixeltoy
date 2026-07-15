import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const canvasJs = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const canvasCss = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");

assert.match(canvasJs, /画面正在拼装/, "running video UI should use the approved assembly copy");
assert.match(canvasJs, /video-tetris-rain/, "running video UI should render the falling block layer");
assert.match(canvasJs, /shape-i/, "falling block layer should include an I piece");
assert.match(canvasJs, /shape-o/, "falling block layer should include an O piece");
assert.match(canvasJs, /shape-t/, "falling block layer should include a T piece");
assert.match(canvasJs, /shape-l/, "falling block layer should include an L piece");
assert.match(canvasJs, /shape-s/, "falling block layer should include an S piece");
assert.match(canvasCss, /@keyframes video-tetris-fall/, "CSS should animate blocks from top to bottom");
assert.match(canvasCss, /\.video-tetris-piece/, "CSS should style tiny falling pixel pieces");

assert.match(
  canvasJs,
  /function syncRunningVideoPreview\(preview, node\)/,
  "running video previews should have an incremental status updater",
);
assert.match(
  canvasJs,
  /syncRunningVideoPreview\(preview, node\)/,
  "video node refresh should update running status without rebuilding the preview",
);
assert.match(
  canvasJs,
  /statusMessage: node\.status === "completed" \? node\.statusMessage \|\| "" : ""/,
  "ordinary running status messages must not invalidate the preview DOM",
);
