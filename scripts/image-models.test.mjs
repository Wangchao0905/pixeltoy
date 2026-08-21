import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const canvasHtml = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const imageGen = fs.readFileSync(path.join(root, "scripts", "vendor", "image-gen.js"), "utf8");
const assetGenerator = fs.readFileSync(path.join(root, "scripts", "run_asset_generation.js"), "utf8");

assert.match(html, /value="gpt-image-2"[^>]*>GPT Image 2/);
assert.match(html, /value="gemini-3\.1-flash-image-preview"[^>]*>Nano Banana 2/);
assert.match(html, /value="gemini-3-pro-image-preview"[^>]*>Nano Banana Pro/);
assert.match(html, /value="seedream-5-0-pro">Seedream 5\.0 Pro/);
assert.match(html, /value="seedream-5-0-lite">Seedream 5\.0 Lite/);
assert.match(canvasHtml, /data-node-field="model"/);
assert.match(canvas, /model: "gpt-image-2"/);
assert.match(canvas, /imageModel: settings\.model/);
assert.match(app, /imageModel: item\.model \|\| "gpt-image-2"/);
assert.match(server, /POST.*images\/generations|images\/generations/);
assert.match(server, /DEFAULT_PAISIO_VIDEO_BASE_URL/, "video Paisio routing must remain available");
for (const legacyImageConfig of [
  "PIXEL_TOYS_IMAGE_BASE_URL",
  "PIXEL_TOYS_IMAGE_BEEF_BASE_URL",
  "gpt-image2-high",
  "gpt-image2-medium",
]) {
  assert.doesNotMatch(`${server}\n${html}\n${canvasHtml}\n${imageGen}`, new RegExp(legacyImageConfig.replace(/[.]/g, "\\.")), `legacy image config must be removed: ${legacyImageConfig}`);
}
assert.match(server, /VOLC_ARK_IMAGE_PRO_MODEL/);
assert.match(server, /VOLC_ARK_IMAGE_LITE_MODEL/);
assert.match(server, /runSeedreamCanvasImageJob/);
assert.match(assetGenerator, /const IMAGE_GEN_BASE_URL = \(process\.env\.PIXEL_TOYS_IMAGE_N1N_BASE_URL \|\| "https:\/\/llm-api\.net\/v1"\)/, "Image asset generation must use the n1n gateway");
assert.match(assetGenerator, /"--base-url",\s*IMAGE_GEN_BASE_URL/, "Image asset generation must pass the shared gateway to image-gen");
assert.match(imageGen, /const allImages = \[image, \.\.\.extraReferences\]/, "GPT Image requests must include the primary and additional reference images");
assert.match(imageGen, /type: "input_image", image_url: await imageToInputUrl\(item\)/, "GPT Image requests must send every reference as image input, not prompt text");

const require = createRequire(import.meta.url);
const loaded = require(path.join(root, "server.js"));
const image = loaded.__test.canvasImage;
assert.equal(image.normalizeCanvasImageModel("gpt-image-2"), "gpt-image-2");
assert.equal(image.normalizeCanvasImageModel("gemini-3.1-flash-image-preview"), "gemini-3.1-flash-image-preview");
assert.equal(image.normalizeCanvasImageModel("gemini-3-pro-image-preview"), "gemini-3-pro-image-preview");
assert.equal(image.normalizeCanvasImageModel("seedream-5-0-pro"), "seedream-5-0-pro");
assert.equal(image.normalizeCanvasImageModel("seedream-5-0-lite"), "seedream-5-0-lite");
assert.equal(image.canvasImageModelConfig("seedream-5-0-pro").provider, "ark");
assert.equal(image.canvasImageModelConfig("seedream-5-0-lite").provider, "ark");
assert.equal(image.canvasImageModelConfig("gpt-image-2").provider, "gpt");
assert.equal(image.canvasImageModelConfig("gemini-3.1-flash-image-preview").model, "gemini-3.1-flash-image-preview");
assert.equal(image.canvasImageModelConfig("gemini-3-pro-image-preview").model, "gemini-3-pro-image-preview");
assert.equal(image.canvasImageBaseUrl("gpt-image-2"), process.env.PIXEL_TOYS_IMAGE_N1N_BASE_URL || "https://llm-api.net/v1");
assert.equal(image.canvasImageBaseUrl("gemini-3.1-flash-image-preview"), process.env.PIXEL_TOYS_IMAGE_N1N_BASE_URL || "https://llm-api.net/v1");
assert.equal(image.canvasImageBaseUrl("gemini-3-pro-image-preview"), process.env.PIXEL_TOYS_IMAGE_N1N_BASE_URL || "https://llm-api.net/v1");
assert.equal(image.canvasImageProviderSizeFor("16:9", "1k"), "2048x1152");
assert.equal(image.canvasImageProviderSizeFor("16:9", "2k"), "2048x1152");
assert.equal(image.canvasImageProviderSizeFor("16:9", "4k"), "3840x2160");
assert.equal(image.canvasImageProviderSizeFor("9:16", "4k"), "2160x3840");
assert.equal(image.canvasImageProviderSizeFor("1:1", "2k"), "2048x2048");
assert.match(
  image.classifyImageGenError("Error while downloading image, error: expected the aspect ratio to be one of 1:1, 3:2, 2:3"),
  /参考图画幅不符合 GPT Image 2/,
  "aspect-ratio download errors must become actionable Chinese feedback",
);
assert.equal(image.seedreamImageSizeFor("16:9", "1k"), "2560x1440");
assert.equal(image.seedreamImageSizeFor("9:16", "1k"), "1440x2560");
assert.equal(image.seedreamImageSizeFor("1:1", "1k"), "1920x1920");
const payload = image.seedreamImagePayload({ providerModel: "doubao-seedream-5-0-260128", prompt: "test", size: "1280x720", providerSize: "2560x1440" });
assert.equal(payload.model, "doubao-seedream-5-0-260128");
assert.equal(payload.size, "2560x1440");
assert.equal(payload.response_format, "url");
const referencePrompt = image.canvasImagePromptWithReferences("一只橙色的猫", 2);
assert.match(referencePrompt, /Treat every supplied reference image as the visual source of truth/);
assert.match(referencePrompt, /Attached reference images: 2/);
assert.match(referencePrompt, /User request: 一只橙色的猫/);
assert.equal(image.canvasImagePromptWithReferences("纯文生图", 0), "纯文生图");
const assetDirectory = loaded.__test.canvasImageRef.CANVAS_PUBLIC_ASSET_DIR;
const referencePath = path.join(assetDirectory, `image-reference-test-${process.pid}.png`);
fs.mkdirSync(assetDirectory, { recursive: true });
fs.writeFileSync(referencePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
let normalizedReferencePath = "";
try {
  normalizedReferencePath = image.normalizeCanvasImageReferenceForProvider(referencePath, "1536x1024", `image-reference-test-${process.pid}`, 0);
  assert.notEqual(normalizedReferencePath, referencePath, "GPT reference images must be normalized before upload");
  assert.ok(fs.existsSync(normalizedReferencePath), "normalized GPT reference image must be written locally");
  const payloadWithReference = image.seedreamImagePayload({
    providerModel: "doubao-seedream-5-0-260128",
    prompt: "用户原始提示词",
    providerPrompt: referencePrompt,
    providerSize: "2560x1440",
    referencePaths: [referencePath],
  });
  assert.equal(payloadWithReference.prompt, referencePrompt, "Seedream must receive the reference-aware prompt");
  assert.match(payloadWithReference.image, /^data:image\/png;base64,/, "Seedream must receive the uploaded reference pixels");
} finally {
  fs.rmSync(referencePath, { force: true });
  if (normalizedReferencePath && normalizedReferencePath !== referencePath) fs.rmSync(normalizedReferencePath, { force: true });
}

console.log("image model routing tests passed");
