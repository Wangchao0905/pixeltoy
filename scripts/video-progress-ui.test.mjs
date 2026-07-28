import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const canvasJs = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const canvasCss = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const appCss = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.match(appJs, /segment-status-indicator/, "video queue cards should use a visual status indicator");
assert.doesNotMatch(
  appJs,
  /<span class="pill \$\{progressClass\(item\.status\)\}">\$\{escapeHtml\(item\.label\)\}<\/span>/,
  "video queue cards should not render long status descriptions as visible pills",
);
assert.match(appJs, /segment-state-button/, "queued and running cards should use a visual state button");
assert.match(appJs, /segment-download-button/, "completed video segments should expose a download link");
assert.match(appJs, /segmentIsComplete && segmentVideoUrl[\s\S]*segment-download-button/, "segment downloads should require a completed item and a source URL");
assert.match(appCss, /#videoProgressList \.segment-status-indicator[\s\S]*animation:/, "status indicators should animate without changing progress data");
assert.match(appCss, /#videoProgressList \.segment-state-queued[\s\S]*background:/, "queued state should have a distinct color");
assert.match(appCss, /#videoProgressList \.segment-state-running[\s\S]*border:/, "running state should have a distinct ring");
assert.match(appCss, /\.segment-download-button\s*\{[\s\S]*border-radius:\s*50%/, "segment downloads should use the compact action style");

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
  canvasCss,
  /\.video-node\[data-video-status="running"\] \.video-preview-slot[\s\S]*?background:[\s\S]*?!important;/,
  "running video previews should use an opaque assembly background",
);

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
  /status: node\.status \|\| "",[\s\S]*tailFrameUrl: node\.tailFrameUrl \|\| ""/,
  "ordinary running status messages must not invalidate the preview DOM",
);
