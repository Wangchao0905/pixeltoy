const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { __test } = require("../server.js");

process.env.CANVAS_VIDEO_PROVIDER = "xluo";

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
assert.match(
  serverSource,
  /"seedance-2-0-mini": "doubao-seedance-2-0-mini-260615"/,
  "Mini must default to the currently available Ark model ID",
);

const { canvasVideoProviderForBody, buildSeedanceGenerationPayload } = __test.canvasVideo;
const ARK_MODELS = [
  "seedance-2-0",
  "seedance-2-0-fast",
  "seedance-2-0-mini",
];
const aiPhotoreal = {
  id: "person-a",
  name: "AI 写实人物",
  url: "https://preview.example/person-a.png",
  publicUrl: "https://preview.example/person-a.png",
  source: "canvas-image",
  aiGenerated: true,
  generationMode: "ai-generated",
  assetStylePreset: "photoreal",
  assetStyleLabel: "AI 写实",
};

assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0-fast", modelMode: "seedance-2-0-fast", assets: [aiPhotoreal] }),
  "xluo",
);
for (const model of ARK_MODELS) {
  assert.equal(
    canvasVideoProviderForBody({ model, modelMode: model, assets: [aiPhotoreal] }),
    "xluo",
    `${model} should keep the selected/default provider for an AI photoreal asset`,
  );
}
assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0", modelMode: "seedance-2-0", frameControl: "first_last", assets: [] }),
  "xluo",
);
process.env.CANVAS_VIDEO_PROVIDER = "ark";
assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0-fast", modelMode: "seedance-2-0-fast", assets: [aiPhotoreal] }),
  "xluo",
  "AI photoreal references must use the image-reference-capable XLUO route instead of Ark content review",
);
assert.equal(
  canvasVideoProviderForBody({
    model: "seedance-2-0-person-reference",
    modelMode: "seedance-2-0-person-reference",
    assets: [{ arkPersonAsset: { enabled: true, assetUrl: "asset://person-1" } }],
  }),
  "ark",
  "explicitly bound Ark person assets must keep the Ark person-reference route",
);
process.env.CANVAS_VIDEO_PROVIDER = "gravitex";
assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0", modelMode: "seedance-2-0", assets: [aiPhotoreal] }),
  "xluo",
  "AI photoreal references must never use a legacy Gravitex default provider",
);
process.env.CANVAS_VIDEO_PROVIDER = "xluo";

(async () => {
  const payload = await buildSeedanceGenerationPayload({
    prompt: "剧情动作：人物走向镜头。",
    model: "seedance-2-0-mini",
    ratio: "9:16",
    duration: 5,
    resolution: "720p",
    frameControl: "first_last",
    firstFrameUrl: "asset://first-frame",
    lastFrameUrl: "asset://last-frame",
    assets: [aiPhotoreal],
  });
  assert.deepEqual(payload.content.map((item) => item.role || item.type), ["text", "first_frame", "last_frame", "reference_image"]);
  assert.equal(payload.content[3].image_url.url, "https://preview.example/person-a.png");
  for (const model of ARK_MODELS) {
    const modelPayload = await buildSeedanceGenerationPayload({
      prompt: "剧情动作：人物向前走。",
      model,
      assets: [aiPhotoreal],
    });
    assert.equal(modelPayload.content[1].image_url.url, "https://preview.example/person-a.png", `${model} should include the AI photoreal asset`);
  }
  await assert.rejects(
    () => buildSeedanceGenerationPayload({ prompt: "剧情动作：测试。", model: "seedance-2-0", frameControl: "first_last", firstFrameUrl: "asset://first-frame" }),
    /首尾帧模式.*首帧.*尾帧/,
  );
  const unverifiedPhotorealPayload = await buildSeedanceGenerationPayload({
    prompt: "剧情动作：测试。",
    model: "seedance-2-0",
    assets: [{ id: "ai-person", name: "AI 写实人物", assetStylePreset: "photoreal", url: "https://preview.example/ai-person.png" }],
  });
  assert.equal(unverifiedPhotorealPayload.content[1].image_url.url, "https://preview.example/ai-person.png");
  console.log("canvas Ark video tests passed.");
})();
