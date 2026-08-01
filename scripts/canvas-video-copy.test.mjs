import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

assert.match(html, /id="nodeContextMenu"/, "video nodes need a dedicated context menu");
assert.match(html, /data-node-action="duplicate-video"/, "video context menu needs a copy action");
assert.match(canvas, /function duplicateVideoNode\(/, "video modules need a duplication handler");
assert.match(canvas, /prompt:\s*source\.prompt/, "copying a video module must retain its prompt");
assert.match(canvas, /assets:\s*\[\.\.\.\(source\.assets\s*\|\|\s*\[\]\)\]/, "copying a video module must retain its references");
assert.match(canvas, /settings:\s*\{\s*\.\.\.\(source\.settings\s*\|\|\s*\{\}\)\s*\}/, "copying a video module must retain its settings");
assert.match(
  canvas,
  /connection\.from === source\.id \? copy\.id : connection\.from[\s\S]*?connection\.to === source\.id \? copy\.id : connection\.to/,
  "copying a video module must remap both incoming and outgoing connections",
);
assert.match(canvas, /showNodeContextMenu\(event, node\.id\)/, "video nodes must open the copy menu on right click");

console.log("canvas video copy tests passed");
