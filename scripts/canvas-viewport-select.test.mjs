import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");

assert.match(
  js,
  /nodes\.style\.setProperty\("--canvas-viewport-scale",\s*String\(scale\)\)/,
  "canvas zoom must expose its scale to native select options",
);
assert.match(
  js,
  /const transform = scale === 1 && x === 0 && y === 0[\s\S]*?\? "none"/,
  "an idle 1:1 canvas must not keep a transform that breaks native select menus",
);
assert.match(
  css,
  /\.canvas-node\s+select\s+option\s*\{[\s\S]*?font-size:\s*calc\(1em\s*\*\s*var\(--canvas-viewport-scale,\s*1\)\)/,
  "canvas select options must scale with the canvas so native menus do not dwarf nodes",
);

console.log("canvas viewport select tests passed");
