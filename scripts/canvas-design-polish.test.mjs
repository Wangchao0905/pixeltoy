import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");

assert.match(canvas, /function snapNodePosition\(/, "canvas nodes must expose magnetic snap calculation");
assert.match(canvas, /snapNodePosition\(node, drag\)/, "node dragging must apply magnetic snapping");
assert.match(canvas, /generation-progress-track/, "generation status must use a static progress track");
assert.doesNotMatch(canvas, /video-tetris-rain/, "generation status must not render falling-piece animation");
assert.doesNotMatch(canvas, /node-spinner/, "generation status must not render spinner animation");
assert.match(css, /\.canvas-links path\s*\{[\s\S]*?stroke:\s*rgba\(255,\s*255,\s*255,\s*0\.78\)/, "canvas connections must be thin white lines");
assert.match(css, /\.generation-progress-track\s*\{/, "static generation progress track styles must exist");

console.log("canvas design polish tests passed");
