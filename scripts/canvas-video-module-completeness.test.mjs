import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");

assert.match(
  js,
  /const PIXVERSE_VIDEO_COMPOSER_EXTRA_HEIGHT = 58;/,
  "PixVerse modules need room for their extra operation row",
);
assert.match(
  js,
  /element\?\.classList\.toggle\("is-pixverse", enabled\)/,
  "PixVerse state must be reflected on the node for responsive layout",
);
assert.match(
  js,
  /function refreshVideoNodeElement\(nodeId\)[\s\S]*?syncPixverseControls\(/,
  "refreshing a model in place must also refresh PixVerse controls",
);
assert.match(
  css,
  /\.video-node\.is-pixverse\s+\.video-composer[\s\S]*?height:\s*398px/,
  "PixVerse composer must grow to contain its extra controls",
);
assert.match(
  css,
  /@container \(max-width: 499px\)[\s\S]*?\.video-node\.is-pixverse \.video-settings-strip[\s\S]*?grid-template-rows:\s*44px 44px 44px 44px 44px/,
  "narrow PixVerse controls must use an explicit five-row layout",
);

console.log("canvas video module completeness tests passed");
