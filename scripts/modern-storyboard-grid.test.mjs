import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts/run_asset_generation.js"), "utf8");

const render = app.match(/function renderModernStoryboardStudio\([\s\S]*?\n}\n\nasync function runModernStoryboardJob/);
assert.ok(render, "modern storyboard renderer must be present");
assert.match(render[0], /page\.panels\.map\(/, "the document must render every storyboard panel");
assert.match(render[0], /\(panelIndex % 3\) \* 50\}%/);
assert.match(render[0], /Math\.floor\(panelIndex \/ 3\) \* 50\}%/);
assert.match(styles, /\.storyboard-document-shot-frame\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
assert.match(styles, /\.storyboard-document-shot-frame\.has-media\s*\{[^}]*background-size:\s*300%\s*300%/, "each panel must crop a 3x3 board");
const mediaRules = [...styles.matchAll(/\.storyboard-document-shot-frame\.has-media\s*\{[^}]*\}/g)].map((match) => match[0]);
assert.ok(mediaRules.at(-1)?.includes("background-size: 300% 300%"), "the final media rule must survive the dark storyboard theme override");

assert.match(server, /IMAGE_SIZE_BY_QUALITY_16_9\[String\(body\.quality/);
assert.match(server, /aspectRatio:\s*"16:9"/);
assert.match(server, /Fill every panel edge-to-edge/);
assert.doesNotMatch(server, /Every panel has a readable lower production note area/);
assert.doesNotMatch(server, /storyboardPortraitSize\(/, "storyboard generation must not rotate a landscape board to portrait");
assert.match(runner, /one 16:9 horizontal \(landscape\) sheet/);
assert.match(runner, /Every panel is a landscape 16:9 outer cell/);
assert.match(runner, /Fill every panel with complete horizontal storyboard imagery/);
assert.doesNotMatch(runner, /Reserve the lower 40 percent/);
assert.doesNotMatch(runner, /reserved lower tab areas/);
assert.match(server, /no extra header, footer, or blank area outside the nine panels/);
assert.doesNotMatch(runner, /one 9:16 vertical \(portrait\) sheet/);
assert.doesNotMatch(runner, /9:16 vertical \(portrait\) sheet/);
assert.match(runner, /cell_h = max\(40, round\(cell_w \* 9 \/ 16\)\)/);
assert.match(runner, /cell_h = max\(40, round\(cell_w \* 9 \/ 16\)\)/g);

const media = app.match(/function storyboardBoardMedia\([\s\S]*?\n}\n\nfunction renderModernStoryboardStudio/);
assert.ok(media, "storyboard media resolver must be present");
assert.match(media[0], /item\?\.id === page\?\.id/);
assert.match(media[0], /item\?\.assetName === page\?\.id/);
assert.match(media[0], /asset\?\.url \|\| asset\?\.file\?\.url/);

console.log("modern storyboard grid tests passed");
