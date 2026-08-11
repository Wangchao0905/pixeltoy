import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const nodeCreation = canvas.slice(canvas.indexOf("function createNode("), canvas.indexOf("function duplicateVideoNode("));
const connectionCreation = canvas.slice(canvas.indexOf("function createNodeFromConnectionMenu("), canvas.indexOf("function cancelConnectionDrag("));

assert.match(
  nodeCreation,
  /kind === "video" && !options\.preserveDropPoint && moveVideoNodeAwayFromOverlaps/,
  "从接线菜单创建的视频节点必须可以保留松开位置，不被自动排到画布底部",
);
assert.match(
  connectionCreation,
  /createNode\(kind, pending\.point, \{[\s\S]*?preserveDropPoint: true,/,
  "接线菜单创建模块必须将松开位置作为节点位置",
);

console.log("canvas connection drop position tests passed");
