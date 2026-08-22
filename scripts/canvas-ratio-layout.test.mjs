import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const js = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");

assert.match(js, /const CANVAS_NODE_RATIO_DIMENSIONS = Object\.freeze\(\{/,
  "canvas nodes need one shared aspect-ratio map");
assert.match(js, /function ratioSizedNodeDimensions\(/,
  "canvas nodes need a ratio-aware size calculation");
assert.match(js, /const IMAGE_PREVIEW_MAX_HEIGHT = 360;/,
  "portrait image previews need a bounded height so the composer stays scannable");
assert.match(js, /const RATIO_LAYOUT_CHROME_HEIGHT = \{ image: 500, video: 300 \};/,
  "image nodes need enough bottom chrome for the fixed 16:9 prompt and visible parameters");
assert.match(js, /const naturalPreviewHeight = Math\.round\(width \* ratioSize\.height \/ ratioSize\.width\)/,
  "image preview sizing should start from the selected ratio");
assert.match(js, /const previewHeight = ratioSize\.height > ratioSize\.width\s*\?\s*Math\.min\(naturalPreviewHeight, IMAGE_PREVIEW_MAX_HEIGHT\)\s*:\s*naturalPreviewHeight/,
  "only portrait image previews should be capped to the compact height");
assert.match(js, /previewWidth,\s*previewHeight/,
  "image sizing should expose the bounded preview dimensions to CSS");
assert.match(js, /function syncImageNodeDimensions\(/,
  "image nodes need ratio-aware dimension syncing");
assert.match(js, /element\.style\.setProperty\("--image-preview-width", `\$\{size\.previewWidth\}px`\)/,
  "image nodes should apply the bounded preview width");
assert.match(js, /element\.style\.setProperty\("--image-preview-height", `\$\{size\.previewHeight\}px`\)/,
  "image nodes should apply the bounded preview height");
assert.match(js, /syncImageNodeDimensions\(element, node\)/,
  "image refresh must apply ratio dimensions");
assert.match(js, /ratioSizedNodeDimensions\(node, "video"\)/,
  "video refresh must derive dimensions from the selected ratio");
assert.match(js, /ratioManualSize = true/,
  "manual corner resizing must remain available after automatic ratio sizing");
assert.match(html, /class="node-control-row image-control-row image-parameter-strip"/,
  "image parameters should have an explicit bottom strip");
assert.match(css, /\.canvas-node\.image-node[\s\S]*?border:\s*0;/,
  "image modules must be frameless");
assert.match(css, /\.canvas-node\.video-node[\s\S]*?border:\s*0;/,
  "video modules must be frameless");
assert.match(css, /\.image-parameter-strip[\s\S]*?display:\s*grid/s,
  "image parameters should be laid out as a clear strip");
assert.match(css, /\.image-node\.is-composer-open \.image-preview-slot[\s\S]*?width:\s*min\(100%,\s*var\(--image-preview-width, 100%\)\)/s,
  "portrait image previews should narrow inside the composer instead of stretching the node");
assert.match(css, /\.image-node\.is-composer-open \.image-preview-slot[\s\S]*?height:\s*var\(--image-preview-height, auto\)[\s\S]*?max-height:\s*360px/s,
  "image preview height should be capped in the final layout rule");
assert.match(css, /\.image-node \.image-prompt-field[\s\S]*?flex:\s*0 0 auto[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/s,
  "image prompt fields should keep a stable 16:9 editing surface independent of preview ratio");
assert.match(css, /\.image-node \.image-prompt-field[\s\S]*?min-height:\s*0/s,
  "fixed-ratio image prompt fields should not collapse or inherit a ratio-driven minimum height");
assert.match(css, /\.video-settings-strip[\s\S]*?grid-template-columns:/s,
  "video parameters should remain in a dedicated bottom strip");
assert.match(html, /class="video-reference-dock"[\s\S]*class="node-assets video-reference-assets"/,
  "video references should have a dedicated in-flow dock");
assert.match(css, /\.video-node \.video-reference-dock[\s\S]*?display:\s*flex/s,
  "video references should stay in normal layout flow");
assert.doesNotMatch(html, /class="node-dropzone video-add-reference"/,
  "video modules should not show a standalone add-reference plus button");
assert.doesNotMatch(html, /class="video-setting-icon"/,
  "video parameter controls should not show decorative symbols");
assert.match(css, /\.video-node \.video-prompt[\s\S]*?overflow:\s*auto/s,
  "long video prompts should scroll instead of covering references");
assert.match(css, /\.video-node \.video-settings-strip[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)\s+minmax\(0, 1fr\)/s,
  "narrow video modules should use a responsive parameter grid");
assert.match(css, /\.video-node \.video-setting-row > \.video-setting select[\s\S]*?font-size:\s*17px/s,
  "video model and parameter values should use readable type");
assert.match(css, /\.video-node \.video-generate-button[\s\S]*?justify-content:\s*center[\s\S]*?text-align:\s*center/s,
  "video generate button text should be centered");
assert.match(css, /\.canvas-node\.video-node\.is-selected[\s\S]*?border-color:\s*transparent\s*!important/s,
  "selected video modules should not show a blue border");
assert.match(css, /\.canvas-node:not\(\.asset-node\)\s*>\s*\.node-port\.input-port[\s\S]*?top:\s*50%[\s\S]*?transform:\s*translateY\(-50%\)/s,
  "input ports should be vertically centered on their node");
assert.match(css, /\.canvas-node:not\(\.asset-node\)\s*>\s*\.node-port\.output-port[\s\S]*?top:\s*50%[\s\S]*?transform:\s*translateY\(-50%\)/s,
  "output ports should be vertically centered on their node");
assert.match(js, /const height = element\?\.offsetHeight[\s\S]*?const y = node\.y \+ height \/ 2;/s,
  "connection fallback points should use the node vertical center");
assert.match(css, /\.canvas-node\.image-node,\s*\.canvas-node\.video-node[\s\S]*?background:\s*rgba\(10, 14, 20, 0\.94\)/s,
  "media modules should keep a dark panel background without a border");
assert.match(css, /\.image-node \.image-composer[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/s,
  "image composer should keep its action row in a stable vertical layout");
assert.match(css, /\.image-node \.node-action-row[\s\S]*?flex:\s*0 0 auto/s,
  "image generate actions should remain visible at the bottom of the node");
assert.doesNotMatch(html, /拖入参考图或资产/,
  "image modules should not show the redundant drag-and-drop placeholder");
assert.match(js, /const dropzone = element\.querySelector\("\.node-dropzone"\)[\s\S]*?node\.kind === "image" \? element\.querySelector\("\.image-composer"\) :[\s\S]*?node\.kind === "video" \? element\.querySelector\("\.video-composer"\)/,
  "media modules should keep drag-and-drop handling on their composer surface");
assert.match(js, /function activateVideoPreview\(preview\)[\s\S]*?video\.autoplay = false[\s\S]*?video\.preload = "metadata"/s,
  "refreshing the canvas should not auto-play video previews");
assert.doesNotMatch(js, /<video src="\$\{escapeHtml\(node\.videoUrl\)\}" controls playsinline autoplay/,
  "video preview markup should not request autoplay");
assert.match(css, /\.node-spinner\s*\{[\s\S]*?width:\s*min\(180px,\s*100%\)[\s\S]*?height:\s*20px[\s\S]*?border:\s*0;/s,
  "image generation should use a thin horizontal pulse instead of a circular spinner");
assert.match(css, /\.image-preview-state\.running\s*\{[\s\S]*?width:\s*100%[\s\S]*?box-sizing:\s*border-box;/s,
  "running image previews should give the ECG trace a full-width container");
assert.match(css, /\.node-spinner\s*\{[\s\S]*?flex:\s*0\s+0\s+auto;/s,
  "ECG trace should not shrink to the width of the status label");
assert.match(css, /\.node-spinner::before[\s\S]*?clip-path:\s*polygon\(/s,
  "image generation pulse should have an ECG-style waveform");
assert.match(css, /@keyframes node-ecg-pulse[\s\S]*?left:\s*calc\(100% \+ 60px\)/s,
  "image generation pulse should travel across the trace");
assert.match(js, /const isOpen = canvasState\.activeVideoNodeId === node\.id[\s\S]*?element\.style\.height = isOpen \? `\$\{size\.height\}px` : "auto"/s,
  "image modules should collapse their composer height until activated");
assert.match(js, /const VIDEO_EDITOR_DEFAULT_WIDTH = 620;[\s\S]*?const VIDEO_EDITOR_DEFAULT_HEIGHT = 650;/s,
  "video modules should expose the stable 16:9 editor baseline");
assert.match(js, /element\.style\.setProperty\("--video-node-height", `\$\{size\.height\}px`\)/,
  "video modules should keep their shell height stable across ratio changes");
assert.match(js, /function panCanvasBy\(deltaX, deltaY\)/,
  "trackpad wheel panning should share one viewport translation helper");
assert.match(js, /function startCanvasPan\(event\)[\s\S]*?event\.button !== 1/s,
  "middle-button drag should start a dedicated canvas pan gesture");
assert.match(js, /canvasState\.viewportPan\s*=\s*\{/,
  "canvas pan should retain its pointer origin separately from node dragging");
assert.match(js, /function updateCanvasPan\(event\)[\s\S]*?canvasState\.viewport\.x[\s\S]*?canvasState\.viewport\.y/s,
  "middle-button movement should translate the whole viewport");
assert.match(js, /description:\s*asset\.description\s*\|\|\s*asset\.prompt/s,
  "project assets should carry their visual description into the canvas");
assert.match(js, /caption\.textContent\s*=\s*captionText/s,
  "asset nodes should render the description instead of only the file name");
assert.match(js, /a\?\.description\s*\|\|\s*a\?\.prompt/s,
  "asset refresh signatures should notice description changes");
assert.match(js, /function applyCanvasPanFrame\(\)/,
  "canvas panning should have a frame-coalesced render path");
assert.match(js, /requestAnimationFrame\(applyCanvasPanFrame\)/,
  "canvas panning should render at most once per animation frame");
assert.doesNotMatch(js, /imagePreview\.addEventListener\("click"/, 
  "image preview clicks must not duplicate the node drag click-vs-move decision");
assert.doesNotMatch(js, /preview\.addEventListener\("click",[\s\S]*?setActiveVideoNode\(node\.id\)/s,
  "video preview clicks must not reopen the node after a drag gesture");
assert.match(js, /<img class="image-preview-img"[^>]*draggable="false"/,
  "generated image previews must not start the browser's native image drag ghost");
assert.match(css, /\.image-preview-slot \.image-preview-img[\s\S]*?-webkit-user-drag:\s*none/s,
  "generated image previews must disable native image dragging in WebKit");
assert.match(js, /function endCanvasPan\(event(?: = \{\})?\)/,
  "canvas pan should end when the middle pointer is released");
assert.match(js, /addEventListener\("pointerdown", startCanvasPan\)/,
  "the canvas should listen for middle-button pan start");
assert.match(js, /addEventListener\("pointermove", updateCanvasPan\)/,
  "the canvas should update middle-button pan while the pointer moves");
assert.match(js, /addEventListener\("pointerup", endCanvasPan\)/,
  "the canvas should finish middle-button pan on pointerup");
assert.match(js, /addEventListener\("pointercancel", endCanvasPan\)/,
  "the canvas should cancel middle-button pan when the pointer is canceled");
assert.match(css, /\.blank-canvas\.is-middle-panning[\s\S]*?\{[^}]*cursor:\s*grabbing/s,
  "middle-button panning should expose a grabbing cursor");
assert.match(css, /\.generation-canvas-shell\s*\{[\s\S]*?height:\s*100dvh/s,
  "canvas shell should occupy the viewport so its background cannot expose the page below");
assert.match(css, /\.blank-canvas\s*\{[\s\S]*?height:\s*100%/s,
  "blank canvas should fill the shell grid track");
assert.match(css, /\.blank-canvas\.is-viewport-moving\s+\.video-preview-slot\s+video[\s\S]*?visibility:\s*visible\s*!important/s,
  "video previews should remain visible while panning the canvas");
assert.match(js, /function startSelectionMarquee\(event\)[\s\S]*?initialSelection:\s*\[\.\.\.canvasState\.selectedNodeIds\][\s\S]*?setPointerCapture/s,
  "blank-canvas dragging should capture a pointer for marquee selection");
assert.match(js, /function updateMarqueeSelection\(\)[\s\S]*?rectsIntersect\(rect,[\s\S]*?setSelectedNodes\(next\)/s,
  "marquee updates should select every node intersecting the stage rectangle");
assert.match(js, /const selectedIds = canvasState\.selectedNodeIds\.has\(nodeId\) \? \[\.\.\.canvasState\.selectedNodeIds\] : \[nodeId\][\s\S]*?origins:\s*selectedIds\.map/s,
  "dragging one selected node should snapshot all selected node origins");
assert.match(js, /for \(const origin of drag\.origins \|\| \[\]\)[\s\S]*?node\.x = origin\.x \+ deltaX[\s\S]*?node\.y = origin\.y \+ deltaY/s,
  "node drag should apply the same delta to every selected origin");
assert.match(js, /img\.setAttribute\("draggable",\s*"false"\)/,
  "asset image previews should disable native browser dragging");
assert.match(css, /\.canvas-node img[\s\S]*?-webkit-user-drag:\s*none/s,
  "all canvas images should disable native drag ghosts");
assert.match(css, /\.canvas-node\.asset-node\.is-selected \.asset-node-image,[\s\S]*?outline:\s*2px solid rgba\(229, 240, 250, 0\.76\)/s,
  "selected asset nodes should have a visible neutral selection outline");
assert.match(js, /CAMERA_ICON_SVG/, "completed video previews should expose a camera capture action");
assert.match(js, /data-capture-tail-frame/, "completed video previews should render a tail-frame capture button");
assert.match(js, /function captureVideoTailFrame\(nodeId, button\)/, "tail-frame capture should use a dedicated action handler");
assert.match(js, /api\("\/api\/canvas\/tail-frame"/, "tail-frame capture should reuse server-side extraction");
assert.match(js, /source: "video-tail-frame"[\s\S]*?addAssetNodeAt\(asset\.id/, "captured tail frames should become canvas image assets");
assert.match(css, /\.video-capture-tail-button\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?visibility:\s*hidden/s,
  "tail-frame camera button should stay hidden until hover/focus");
assert.match(css, /\.video-preview-slot:hover \.video-capture-tail-button[\s\S]*?opacity:\s*1/s,
  "tail-frame camera button should appear on preview hover");

console.log("canvas ratio layout tests passed");
