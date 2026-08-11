import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");

const refreshConnected = canvas.slice(canvas.indexOf("function refreshConnectedNodeElements("), canvas.indexOf("function removeSelectedNodes("));
const upstreamSummary = canvas.slice(canvas.indexOf("function upstreamSummary("), canvas.indexOf("function imageGenerationControlWarning("));
const imageReferences = canvas.slice(canvas.indexOf("function imageReferenceAssetsForGeneration("), canvas.indexOf("function imageDownloadName("));

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

console.log("canvas image multi-reference tests passed");
