import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(html, /id="imageExploreStoryboardToggle"/);
assert.match(html, /id="imageExploreStoryboardOptions"/);
const storyboardOptions = html.match(/<section id="imageExploreStoryboardOptions"[\s\S]*?<\/section>/)?.[0] || "";
assert.match(storyboardOptions, /<span>张数<\/span>/);
assert.match(storyboardOptions, /<option value="1" selected>1 张<\/option>/);
assert.doesNotMatch(storyboardOptions, /3×3 九宫格|每张 15 秒|多张自动保持剧情衔接/);
assert.match(html, /id="imageExploreReference"/);
assert.match(html, /id="imageExploreStoryboardCount"/);
assert.match(app, /storyboardMode: false/);
assert.match(app, /storyboardCount: 1/);
assert.match(app, /api\("\/api\/canvas\/image-storyboard-plan"/);
assert.match(app, /status: "planning"/);
assert.match(app, /storyboardActiveBatchId/);
assert.match(app, /故事板生成中\（\$\{storyboardProgress\}\）/);
assert.match(app, /referenceImages: Array\.isArray\(item\.referenceImages\)/);
assert.match(app, /ratio: "16:9"/);
assert.match(app, /storyboardHistory/);
assert.match(server, /const IMAGE_STORYBOARD_PANEL_COUNT = 9/);
assert.match(server, /const IMAGE_STORYBOARD_BOARD_COUNT_MAX = 4/);
assert.match(server, /durationPerBoard: 15/);
assert.match(server, /function imageStoryboardImagePrompt/);
assert.match(server, /image-storyboard-plan/);
assert.match(server, /openAiCompatUrl\("\/v1\/chat\/completions", "storyboard"\)/);
assert.match(styles, /\.image-explore-storyboard-options/);
assert.match(styles, /\.image-explore-storyboard-panels/);

console.log("image storyboard tests passed");
