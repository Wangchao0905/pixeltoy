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
assert.match(js, /const VIDEO_PREVIEW_WIDTHS = Object\.freeze\(\{/,
  "video preview sizing needs one shared ratio width map");

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
assert.match(sizeFn, /if \(kind === "video"\)[\s\S]*?const previewWidth = Math\.min\(Math\.round\(width \* 0\.68\)/s,
  "video shell height should follow the compact preview width");
assert.match(css, /\.video-node\[data-video-ratio="9:16"\] \.video-preview-slot[\s\S]*?--video-preview-width:\s*196px/s,
  "portrait previews should stay compact inside the fixed editor shell");
assert.match(css, /\.video-node \.video-preview-slot[\s\S]*?width:\s*min\(100%, var\(--video-preview-width, 100%\)\)/s,
  "preview width should be capped independently from the editor shell");
assert.match(css, /\.video-node \.video-preview-slot[\s\S]*?max-width:\s*68%/s,
  "every preview should remain visibly narrower than the prompt composer");
assert.match(css, /\.video-node \.video-preview-slot[\s\S]*?border:\s*0\s*!important[\s\S]*?border-radius:\s*0\s*!important[\s\S]*?background:\s*transparent\s*!important/s,
  "the video preview must remain completely frameless");
assert.match(css, /\.canvas-node\.video-node[\s\S]*?background:\s*transparent\s*!important[\s\S]*?box-shadow:\s*none\s*!important/s,
  "the video node shell must not become a second card around the composer");
assert.match(css, /\.video-node\[data-video-ratio="16:9"\] \.video-preview-slot[\s\S]*?--video-preview-width:\s*420px/s,
  "landscape previews should use a compact width instead of filling the composer");
assert.match(css, /\.video-node \.video-composer[\s\S]*?border-radius:\s*20px[\s\S]*?background:/s,
  "the prompt composer should read as the wider lower panel");
assert.match(css, /\.video-node \.video-settings-strip[\s\S]*?grid-template-rows:\s*48px 50px/s,
  "video controls should use a stable model row and action row");

const finalComposerCss = css.slice(css.lastIndexOf("/* Final video composer layout:"));
assert.match(finalComposerCss,
  /grid-template-columns:\s*minmax\(92px, 0\.95fr\)\s+minmax\(92px, 0\.95fr\)\s+minmax\(180px, 1\.8fr\)\s+44px\s+minmax\(126px, 1\.2fr\)/,
  "the final action row should use five tracks without an empty spacer column");
assert.match(finalComposerCss,
  /\.video-node \.video-duration-field[\s\S]*?grid-template-columns:\s*auto 42px minmax\(118px, 1fr\)/s,
  "the duration field should reserve a readable slider track");
assert.match(finalComposerCss,
  /\.video-node \.video-setting-row > \.video-setting,[\s\S]*?backdrop-filter:\s*blur\(16px\)/s,
  "video parameters should use the blue frosted control surface");
assert.match(js, /function syncVideoNodePortPosition\(element\)[\s\S]*?video-port-left/s,
  "video port positions should be derived from the rendered preview slot");
assert.match(js, /node\.kind === "video"[\s\S]*?preview\?\.getBoundingClientRect\(\)/s,
  "video connection endpoints should read the preview bounds");
assert.match(finalComposerCss,
  /\.canvas-node\.video-node,[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none !important/s,
  "the video editor shell must remain frameless and transparent");
assert.match(finalComposerCss,
  /\.video-node > \.node-port\.input-port,[\s\S]*?left:\s*calc\(var\(--video-port-left, 0px\) - 12px\) !important/s,
  "video input ports should sit on the preview left edge");
assert.match(finalComposerCss,
  /\.video-node > \.node-port\.output-port[\s\S]*?left:\s*calc\(var\(--video-port-right, 100%\) - 12px\) !important/s,
  "video output ports should sit on the preview right edge");

console.log("canvas video editor layout tests passed");
