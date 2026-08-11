import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const videoPreview = canvas.slice(canvas.indexOf("function renderVideoPreview("), canvas.indexOf("function syncRunningVideoPreview("));
const runningVideoPreview = videoPreview.slice(videoPreview.indexOf('if (node.status === "running")'), videoPreview.indexOf("if (node.videoUrl)"));
const videoPreviewSync = canvas.slice(canvas.indexOf("function syncRunningVideoPreview("), canvas.indexOf("function activateVideoPreview("));

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
assert.match(
  css,
  /\.generation-status\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/,
  "窄比例预览中的生成状态不得以最小宽度撑破容器",
);
assert.match(
  videoPreview,
  /<strong>\$\{hasProgress \? `生成中 · \$\{progress\}%` : "生成中"\}<\/strong>/,
  "视频生成标题和进度必须作为一个居中标签输出",
);
assert.doesNotMatch(runningVideoPreview, /<em>/, "视频生成状态不得再使用带自动外边距的独立百分比元素");
assert.match(
  videoPreviewSync,
  /progressLabel\.textContent = hasProgress \? `生成中 · \$\{progress\}%` : "生成中";/,
  "轮询刷新时必须更新完整的居中生成标签",
);
assert.match(html, /canvas\.css\?v=canvas-zoom-layout-20260811-r5/, "生成状态样式变更必须更新长期缓存版本号");
assert.match(html, /canvas\.js\?v=canvas-zoom-layout-20260811-r5/, "生成状态交互页面必须更新长期缓存版本号");

console.log("canvas generation status centering tests passed");
