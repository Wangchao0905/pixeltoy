import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

const refreshConnected = canvas.slice(canvas.indexOf("function refreshConnectedNodeElements("), canvas.indexOf("function removeSelectedNodes("));
const upstreamSummary = canvas.slice(canvas.indexOf("function upstreamSummary("), canvas.indexOf("function imageGenerationControlWarning("));
const imageReferences = canvas.slice(canvas.indexOf("function imageReferenceAssetsForGeneration("), canvas.indexOf("function imageDownloadName("));
const targetResolver = canvas.slice(canvas.indexOf("function connectionInputTargetAtEvent("), canvas.indexOf("function clearConnectionTarget("));

assert.match(
  refreshConnected,
  /else if \(node\.kind === "image"\) refreshImageNodeElement\(nodeId\);/,
  "图片节点接入新的参考图后必须立即刷新节点内容，而不只是更新连线状态",
);
assert.match(
  upstreamSummary,
  /if \(node\.kind === "image"\)[\s\S]*?已连接 \$\{sources\.length\} 张图片，自动引用 \$\{assetCount\} 张参考图。/,
  "图片节点应明确显示累计的上游图片数量，便于继续接入多张参考图",
);
assert.match(
  imageReferences,
  /const references = referenceAssetsForVideoNode\(node\);[\s\S]*?return \{ references: selected, missing \};/,
  "图片生成请求必须保留由所有上游连接汇总出的参考图集合",
);
assert.match(
  canvas,
  /function connectionInputTargetAtEvent\(event, source\)[\s\S]*?CONNECTION_TARGET_SNAP_RADIUS/,
  "连线松开时必须以输入点附近区域判断图片或视频目标，不能只依赖像素级命中端口",
);
assert.match(
  canvas,
  /function updateConnectionDrag\(event\)[\s\S]*?updateConnectionTarget\(event\)/,
  "连线拖动时必须持续计算可接入的目标",
);
assert.match(
  canvas,
  /const target = connectionInputTargetAtEvent\(event, source\);[\s\S]*?if \(connectNodes\(source, target\)\) return;/,
  "在页面空白层接到 pointerup 时，图片模块也必须被识别为有效接线目标",
);
assert.match(
  css,
  /\.canvas-node\.is-connection-target > \.node-port\.input-port[\s\S]*?scale\(1\.55\)/,
  "接近输入点时必须显示明确的吸附反馈",
);
assert.match(html, /canvas\.css\?v=canvas-status-center-20260811-r3/, "画布样式变更必须更新长期缓存版本号");
assert.match(html, /canvas\.js\?v=canvas-status-center-20260811-r3/, "画布交互变更必须更新长期缓存版本号");

const targetContext = {
  Math,
  CANVAS_MIN_SCALE: 0.25,
  CONNECTION_TARGET_SNAP_RADIUS: 36,
  canvasState: {
    viewport: { scale: 1 },
    nodes: [
      { id: "source-a", kind: "asset" },
      { id: "source-b", kind: "asset" },
      { id: "image-target", kind: "image" },
    ],
  },
  stagePoint: (x, y) => ({ x, y }),
  nodePortPoint: (node) => ({ x: node.id === "image-target" ? 240 : 0, y: 180 }),
};
vm.runInNewContext(`${targetResolver}; result = connectionInputTargetAtEvent({ clientX: 260, clientY: 180 }, canvasState.nodes[0]);`, targetContext);
assert.equal(targetContext.result?.id, "image-target", "两个素材源都应能在图片输入点附近接入同一图片模块");
vm.runInNewContext(`result = connectionInputTargetAtEvent({ clientX: 260, clientY: 180 }, { id: "video-source", kind: "video" });`, targetContext);
assert.equal(targetContext.result?.id, undefined, "视频输出不应吸附到图片输入点");

console.log("canvas image multi-reference tests passed");
