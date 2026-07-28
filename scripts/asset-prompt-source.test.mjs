import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  imageInputsFor,
  parseAssets,
  promptFor,
  styleReferenceGuidance,
} = require("./run_asset_generation.js");

const markdown = `# Asset prompts

## New Character Asset: C001_TEST_CHARACTER_SHEET

文生图提示词（英文，提交给生图模型）：
\`\`\`text
ASSET DOCUMENT PROMPT: a specific woman with a bright orange coat, rusty nail bun, tired alert expression, and worn gray scarf.
\`\`\`
`;

const [asset] = parseAssets(markdown);
assert.equal(
  asset.prompt,
  "ASSET DOCUMENT PROMPT: a specific woman with a bright orange coat, rusty nail bun, tired alert expression, and worn gray scarf.",
  "the runner must extract the document prompt verbatim",
);

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

const styleInputs = imageInputsFor("1280x720", [], "/tmp/style-reference.jpg", "/tmp/pixel-toys-prompt-test");
assert.equal(styleInputs.length, 2, "a style reference needs a neutral primary anchor and the style image");
assert.notEqual(styleInputs[0], "/tmp/style-reference.jpg", "the style image must never be the primary subject input");
assert.equal(styleInputs[1], "/tmp/style-reference.jpg", "the style image must be sent as an auxiliary input");

console.log("asset prompt source tests passed");
