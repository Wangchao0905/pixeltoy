import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const imageRatioSelect = html.match(/<select id="imageExploreRatio"[\s\S]*?<\/select>/)?.[0] || "";

assert.match(app, /resolution: "1k"/);
assert.match(app, /IMAGE_EXPLORE_RATIO_VALUES = Object\.freeze\(\["16:9", "4:3", "3:2", "21:9", "1:1", "4:5", "3:4", "2:3", "9:16"\]\)/);
assert.match(app, /ratio: "16:9"/);
assert.match(app, /--image-preview-ratio/);
assert.match(html, /<option value="1k" selected>1K<\/option>/);
assert.doesNotMatch(html, /<option value="2k" selected>2K<\/option>/);
for (const ratio of ["16:9", "4:3", "3:2", "21:9", "1:1", "4:5", "3:4", "2:3", "9:16"]) {
  assert.match(imageRatioSelect, new RegExp(`<option value="${ratio.replace(":", "\\:")}">${ratio}<\\/option>`));
}
assert.doesNotMatch(imageRatioSelect, /横屏|方形|人像|竖屏|超宽/);
assert.match(styles, /aspect-ratio: var\(--image-preview-ratio, 16 \/ 9\)/);
assert.match(server, /"4:5":\s*\{\s*"1k": "1024x1280"[\s\S]*"4k": "2560x3200"/);
assert.match(server, /"3:4":\s*\{\s*"1k": "960x1280"[\s\S]*"4k": "2304x3072"/);
assert.match(server, /"2:3":\s*\{\s*"1k": "1024x1536"[\s\S]*"4k": "2304x3456"/);
assert.match(server, /function canvasImageProviderSizeFor\(ratio\)/);
assert.match(server, /const providerSize = canvasImageProviderSizeFor\(ratio\)/);
assert.match(server, /async function normalizeCanvasImageOutput\(entry = \{\}\)/);
assert.match(server, /await normalizeCanvasImageOutput\(entry\)/);

console.log("image explore ratio tests passed");
