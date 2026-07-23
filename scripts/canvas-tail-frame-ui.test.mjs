import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");

assert.match(canvas, /class="video-media-actions"/);
assert.match(canvas, /class="media-download-button"[\s\S]*data-capture-tail-frame/);
assert.match(canvas, /tailFrameCaptureStatus: "capturing"/);
assert.match(canvas, /class="video-tail-frame-status is-capturing"/);
assert.match(canvas, /tray\.hidden = false/);
assert.match(css, /\.video-media-actions\s*\{[\s\S]*top:\s*10px[\s\S]*right:\s*10px/);
assert.match(css, /\.video-tail-frame-status\s*\{[\s\S]*position:\s*absolute/);
assert.match(css, /\.video-media-actions \.media-download-button,[\s\S]*\.video-media-actions \.video-capture-tail-button\s*\{[\s\S]*position:\s*static[\s\S]*bottom:\s*auto/);
assert.doesNotMatch(css, /\.video-capture-tail-button\s*\{[\s\S]*bottom:\s*10px/);

console.log("canvas tail-frame UI tests passed");
