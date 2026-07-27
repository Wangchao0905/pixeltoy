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
  "video sizing must keep the fixed editor width before reading the selected ratio");
assert.match(sizeFn, /if \(kind === "video"\)[\s\S]*?const ratioSize = CANVAS_NODE_RATIO_DIMENSIONS\[ratio\][\s\S]*?const previewHeight = Math\.round\(width \* ratioSize\.height \/ ratioSize\.width\)/s,
  "video sizing must use the selected ratio for the preview height");
assert.match(js, /VIDEO_PREVIEW_RATIOS\[effectiveSettings\.ratio\]/,
  "the selected ratio must still control the preview slot");

const ratioWidthRules = [...css.matchAll(/\.canvas-node\.video-node\[data-video-ratio="[^"]+"\]\s*\{([^}]*)\}/g)]
  .map((match) => match[1])
  .filter((body) => body.includes("--video-node-closed-width"));
assert.equal(ratioWidthRules.length, 0,
  "video ratio selectors must not resize the editor shell");

assert.match(css, /\.canvas-node\.video-node\.is-composer-open[\s\S]*?width:\s*var\(--video-node-width\)/s,
  "the open video editor should keep one explicit shell width");
assert.match(css, /\.video-node \.video-preview-slot[\s\S]*?aspect-ratio:\s*var\(--video-preview-ratio[\s\S]*?border:\s*0[\s\S]*?border-radius:\s*0/s,
  "the preview surface should own the selected video ratio without a frame");
assert.doesNotMatch(css, /--video-preview-frame-height/,
  "the preview must not be constrained by the old fixed stage");
assert.match(css, /\.video-node \.video-composer[\s\S]*?flex:\s*0 0 auto[\s\S]*?height:\s*var\(--video-composer-height/s,
  "the prompt and parameter composer must keep a fixed height");
assert.match(css, /\.video-node \.video-prompt[\s\S]*?flex:\s*0 0 118px[\s\S]*?height:\s*118px/s,
  "the prompt field must stay fixed while the preview ratio changes");

console.log("canvas video editor layout tests passed");
