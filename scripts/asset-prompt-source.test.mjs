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

资产文档生图提示词（中文事实源，提交给生图模型）：
\`\`\`text
ASSET DOCUMENT PROMPT: a generic English prompt that must not replace the Chinese facts.
\`\`\`
`;

const [asset] = parseAssets(markdown);
assert.ok(asset.prompt.startsWith("主体："), "asset document facts must remain the primary prompt");
assert.doesNotMatch(asset.prompt, /ASSET DOCUMENT PROMPT/);
assert.match(asset.prompt, /荧光橙外套/);
assert.doesNotMatch(asset.prompt, /资产类型|剧本依据|视觉解析|唯一来源/);

const prompt = promptFor(asset);
assert.ok(prompt.startsWith(asset.prompt), "the asset document prompt must remain the primary prompt");
assert.match(prompt, /16:9 横版画幅/);
assert.match(prompt, /纯白背景/);
assert.match(prompt, /全身正面.*全身侧面.*全身背面.*面部特写/);
assert.doesNotMatch(prompt, /资产文档事实|资产类型|剧本依据|视觉解析|唯一来源/);
assert.doesNotMatch(prompt, /selected visual style|Production-grade reference asset|English prompt/i);

const manualMarkdown = `## New Prop Asset: P002_MANUAL_PROP

剧本解析对象：旧收音机
剧本依据：桌上唯一的旧收音机。
视觉解析：木质外壳，旋钮磨损，暖棕色。
解析来源：用户提供资产生图提示词

资产文档生图提示词（中文事实源，提交给生图模型）：
\`\`\`text
木质旧收音机，暖棕色外壳，旋钮磨损，保留用户指定的复古质感。
\`\`\`
`;
const [manualAsset] = parseAssets(manualMarkdown);
assert.equal(manualAsset.prompt, "木质旧收音机，暖棕色外壳，旋钮磨损，保留用户指定的复古质感。", "only explicitly marked manual prompts may bypass document facts");

const generatedMarkdown = `## New Character Asset: C003_GENERATED_CHARACTER_SHEET

剧本解析对象：一名父亲
剧本依据：家庭客厅中的父亲。
视觉解析：白衬衫，短棕发。
全局视觉风格：恶搞之家风格的二维动画，粗黑外轮廓，平涂色块。

资产文档生图提示词（中文事实源，提交给生图模型）：
\`\`\`text
资产文档事实（生图内容唯一来源）：
全局视觉风格（来自资产文档）：恶搞之家风格的二维动画，粗黑外轮廓，平涂色块。
资产解析模型提示词：中文资产文档提示词：恶搞之家风格的二维动画角色，白衬衫，短棕发。
\`\`\`
`;
const [generatedAsset] = parseAssets(generatedMarkdown);
assert.match(generatedAsset.prompt, /恶搞之家风格/);
assert.match(promptFor(generatedAsset), /恶搞之家风格/);
assert.match(promptFor(generatedAsset), /视觉风格：恶搞之家风格/);

const topLevelStyleMarkdown = `# Asset prompts

全局视觉风格：恶搞之家风格的二维动画，粗黑外轮廓，平涂色块。

## New Character Asset: C004_TOP_LEVEL_STYLE_CHARACTER_SHEET

剧本解析对象：一名父亲
视觉解析：白衬衫，短棕发。

资产文档生图提示词（中文事实源，提交给生图模型）：
\`\`\`text
一名父亲，白衬衫，短棕发。
\`\`\`
`;
const [topLevelStyleAsset] = parseAssets(topLevelStyleMarkdown);
assert.match(topLevelStyleAsset.prompt, /恶搞之家风格/, "top-level document style must be injected into each asset prompt");
assert.match(promptFor(topLevelStyleAsset), /视觉风格：恶搞之家风格/, "final image prompt must retain top-level document style");
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
