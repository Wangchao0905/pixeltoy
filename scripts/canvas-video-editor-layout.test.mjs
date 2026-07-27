import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");

assert.match(js, /const VIDEO_EDITOR_DEFAULT_WIDTH = 620;/,
  "video editors need a stable desktop width matching the 16:9 layout");
assert.match(js, /const VIDEO_EDITOR_DEFAULT_HEIGHT = 650;/,
  "video editors need a stable desktop height matching the 16:9 layout");

const sizeFnStart = js.indexOf("function ratioSizedNodeDimensions(");
const sizeFnEnd = js.indexOf("\nfunction syncImageNodeDimensions", sizeFnStart);
assert.ok(sizeFnStart >= 0 && sizeFnEnd > sizeFnStart, "ratio size function should be readable");
const sizeFn = js.slice(sizeFnStart, sizeFnEnd);
const videoFixedBranch = sizeFn.indexOf('if (kind === "video")');
const ratioMapLookup = sizeFn.indexOf("CANVAS_NODE_RATIO_DIMENSIONS[ratio]");
assert.ok(videoFixedBranch >= 0 && videoFixedBranch < ratioMapLookup,
  "video sizing must return the fixed editor shell before reading the selected ratio");
assert.match(sizeFn, /if \(kind === "video"\)[\s\S]*?width: VIDEO_EDITOR_DEFAULT_WIDTH[\s\S]*?height: VIDEO_EDITOR_DEFAULT_HEIGHT/s,
  "video sizing must use the fixed editor dimensions");
assert.match(js, /VIDEO_PREVIEW_RATIOS\[effectiveSettings\.ratio\]/,
  "the selected ratio must still control the preview slot");

const ratioWidthRules = [...css.matchAll(/\.canvas-node\.video-node\[data-video-ratio="[^"]+"\]\s*\{([^}]*)\}/g)]
  .map((match) => match[1])
  .filter((body) => body.includes("--video-node-closed-width"));
assert.equal(ratioWidthRules.length, 0,
  "video ratio selectors must not resize the editor shell");

assert.match(css, /\.canvas-node\.video-node\.is-composer-open[\s\S]*?width:\s*var\(--video-node-width\)/s,
  "the open video editor should keep one explicit shell width");
assert.match(css, /\.video-node \.video-preview-slot[\s\S]*?aspect-ratio:\s*var\(--video-preview-ratio/s,
  "the preview surface should own the selected video ratio");
assert.match(css, /\.video-node \.video-prompt[\s\S]*?flex:\s*1 1 auto[\s\S]*?min-height:\s*130px/s,
  "the prompt field should remain in a stable editor flow instead of resizing with the preview");

console.log("canvas video editor layout tests passed");
