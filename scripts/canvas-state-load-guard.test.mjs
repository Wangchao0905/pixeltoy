import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");

assert.match(source, /!saved\?\.state && canvasState\.canvasId/, "missing canvas state must be detected");
assert.match(source, /画布状态加载失败：\$\{error\.message/, "canvas load failures must be visible instead of a silent blank canvas");

console.log("canvas state load guard tests passed");
