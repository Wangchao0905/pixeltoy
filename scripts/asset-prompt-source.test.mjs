import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  imageInputsFor,
  parseAssets,
  promptFor,
  styleReferenceGuidance,
} = require("./run_asset_generation.js");

const markdown = `# Asset prompts

## New Character Asset: C001_TEST_CHARACTER_SHEET

剧本解析对象：一名穿橙色外套的具体女性
剧本依据：她在结冰的急流勇进水槽边等待，警惕而疲惫。
视觉解析：24岁女性，荧光橙外套，生锈钉子盘发，磨损灰围巾。

文生图提示词（英文，提交给生图模型）：
\`\`\`text
ASSET DOCUMENT PROMPT: a specific woman with a bright orange coat, rusty nail bun, tired alert expression, and worn gray scarf.
\`\`\`
`;

const [asset] = parseAssets(markdown);
assert.ok(
  asset.prompt.startsWith("ASSET DOCUMENT PROMPT: a specific woman with a bright orange coat, rusty nail bun, tired alert expression, and worn gray scarf."),
  "the runner must keep the document prompt as the primary prompt",
);
assert.match(asset.prompt, /CANONICAL ASSET DOCUMENT FACTS/);
assert.match(asset.prompt, /荧光橙外套/);

const prompt = promptFor(asset);
assert.ok(prompt.startsWith(asset.prompt), "the asset document prompt must remain the primary prompt");
assert.match(prompt, /16:9 landscape frame/i);
assert.match(prompt, /pure white background/i);
assert.match(prompt, /full-body front.*full-body side.*full-body back.*face close-up/i);
assert.doesNotMatch(prompt, /Production-grade reference asset\. Follow the selected visual style/i);
assert.match(styleReferenceGuidance("/tmp/style-reference.jpg"), /STYLE REFERENCE INPUT RULES \(HARD CONSTRAINT\)/);
assert.match(styleReferenceGuidance("/tmp/style-reference.jpg"), /for STYLE ONLY/i);
assert.match(styleReferenceGuidance("/tmp/style-reference.jpg"), /according to the visual style/i);
assert.match(styleReferenceGuidance("/tmp/style-reference.jpg"), /asset prompt always wins/i);

const styleSource = path.resolve("public/pixel-toys-logo.png");
const styleLogs = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-prompt-test-"));
const styleInputs = imageInputsFor("1280x720", [], styleSource, styleLogs);
assert.equal(styleInputs.length, 2, "a style reference needs a neutral primary anchor and an abstract style swatch");
assert.notEqual(styleInputs[0], styleSource, "the style image must never be the primary subject input");
assert.notEqual(styleInputs[1], styleSource, "the raw style image must never be sent as an auxiliary content input");
assert.match(path.basename(styleInputs[1]), /^\.pixel-toys-style-swatch-/);
assert.ok(fs.existsSync(styleInputs[1]) && fs.statSync(styleInputs[1]).size > 1000, "the abstract style swatch must be generated");

console.log("asset prompt source tests passed");
