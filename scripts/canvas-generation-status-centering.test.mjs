import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

assert.match(
  css,
  /\.generation-status\s*\{[\s\S]*?display:\s*grid;[\s\S]*?justify-items:\s*center;[\s\S]*?align-content:\s*center;[\s\S]*?text-align:\s*center;/,
  "图片与视频的生成状态容器必须在预览区内居中",
);
assert.match(
  css,
  /\.generation-status-row\s*\{[\s\S]*?justify-content:\s*center;/,
  "生成中标题和进度百分比必须在同一居中行显示",
);
assert.match(
  css,
  /\.generation-status-message\s*\{[\s\S]*?text-align:\s*center;/,
  "图片任务说明必须居中显示",
);
assert.match(html, /canvas\.css\?v=canvas-status-center-20260811-r2/, "生成状态样式变更必须更新长期缓存版本号");
assert.match(html, /canvas\.js\?v=canvas-status-center-20260811-r2/, "生成状态交互页面必须更新长期缓存版本号");

console.log("canvas generation status centering tests passed");
