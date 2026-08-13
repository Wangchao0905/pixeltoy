const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { __test } = require("../server.js");

process.env.CANVAS_VIDEO_PROVIDER = "ark";

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
assert.match(
  serverSource,
  /"seedance-2-0-mini": "doubao-seedance-2-0-mini-260615"/,
  "Mini must default to the currently available Ark model ID",
);

const { canvasVideoProviderForBody, buildSeedanceGenerationPayload, normalizeVideoResolution, normalizeSeedanceDuration } = __test.canvasVideo;
const ARK_MODELS = [
  "seedance-2-0",
  "seedance-2-0-fast",
  "seedance-2-0-mini",
];
const ARK_MODEL_IDS = {
  "seedance-2-0": "doubao-seedance-2-0-260128",
  "seedance-2-0-fast": "doubao-seedance-2-0-fast-260128",
  "seedance-2-0-mini": "doubao-seedance-2-0-mini-260615",
};
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
const arkPerson = {
  ...aiPhotoreal,
  arkPersonAsset: {
    enabled: true,
    assetUrl: "asset://person-1",
    assetId: "person-1",
    status: "active",
  },
};

assert.equal(normalizeVideoResolution("4k", "doubao-seedance-2-0-260128"), "4k");
assert.equal(normalizeVideoResolution("1080p", "doubao-seedance-2-0-fast-260128"), "720p");
assert.equal(normalizeVideoResolution("4k", "doubao-seedance-2-0-fast-260128"), "720p");
assert.equal(normalizeVideoResolution("4k", "doubao-seedance-2-0-mini-260615"), "720p");
assert.equal(normalizeVideoResolution("1080p", "dreamina-seedance-2-5-260628"), "720p");
assert.equal(normalizeSeedanceDuration(30, "dreamina-seedance-2-5-260628"), 30);
assert.equal(normalizeSeedanceDuration(31, "dreamina-seedance-2-5-260628"), 30);

assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-5-byteplus", modelMode: "seedance-2-5-byteplus", assets: [] }),
  "byteplus",
  "overseas Seedance 2.5 must route to BytePlus ModelArk",
);

assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0-fast", modelMode: "seedance-2-0-fast", assets: [aiPhotoreal] }),
  "ark",
);
for (const model of ARK_MODELS) {
  assert.equal(
    canvasVideoProviderForBody({ model, modelMode: model, assets: [aiPhotoreal] }),
    "ark",
    `${model} should keep the selected/default provider for an AI photoreal asset`,
  );
}
assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0", modelMode: "seedance-2-0", frameControl: "first_last", assets: [] }),
  "ark",
);
process.env.CANVAS_VIDEO_PROVIDER = "ark";
assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0-fast", modelMode: "seedance-2-0-fast", assets: [aiPhotoreal] }),
  "ark",
  "unbound image references should keep the configured provider",
);
process.env.CANVAS_VIDEO_PROVIDER = "gravitex";
assert.equal(
  canvasVideoProviderForBody({ model: "seedance-2-0", modelMode: "seedance-2-0", assets: [aiPhotoreal] }),
  "gravitex",
  "unbound image references should keep the configured provider",
);
for (const model of ARK_MODELS) {
  assert.equal(
    canvasVideoProviderForBody({ model, modelMode: model, assets: [arkPerson] }),
    "ark",
    `${model} must use Ark when a private-library asset is bound`,
  );
}
assert.equal(
  canvasVideoProviderForBody({
    model: "seedance-2-0-person-reference",
    modelMode: "seedance-2-0-person-reference",
    assets: [arkPerson],
  }),
  "gravitex",
  "the separate person-reference model must not be forced into the three-model Ark library route",
);
process.env.CANVAS_VIDEO_PROVIDER = "ark";

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
    assets: [arkPerson],
  });
  assert.deepEqual(payload.content.map((item) => item.role || item.type), ["text", "first_frame", "last_frame", "reference_image"]);
  assert.equal(payload.content[3].image_url.url, "asset://person-1");
  const byteplus25Payload = await buildSeedanceGenerationPayload({
    prompt: "剧情动作：飞船穿过云层。",
    model: "seedance-2-5",
    modelMode: "seedance-2-5-byteplus",
    duration: 30,
    resolution: "1080p",
    __provider: "byteplus",
  });
  assert.equal(byteplus25Payload.model, "dreamina-seedance-2-5-260628", "overseas Seedance 2.5 must use the model ID returned by the configured BytePlus account");
  assert.equal(byteplus25Payload.duration, 30, "overseas Seedance 2.5 must preserve 30-second requests");
  assert.equal(byteplus25Payload.resolution, "720p", "overseas Seedance 2.5 must reject unsupported 1080p requests");
  for (const model of ARK_MODELS) {
    const modelPayload = await buildSeedanceGenerationPayload({
      prompt: "剧情动作：人物向前走。",
      model,
      modelMode: model,
      assets: [arkPerson],
    });
    assert.equal(modelPayload.model, ARK_MODEL_IDS[model], `${model} should preserve its Ark model ID`);
    assert.equal(modelPayload.content[1].image_url.url, "asset://person-1", `${model} should submit the private-library asset URI`);
  }
  for (const model of ARK_MODELS) {
    await assert.rejects(
      () => buildSeedanceGenerationPayload({
        prompt: "剧情动作：人物向前走。",
        model,
        modelMode: model,
        assets: [{ ...aiPhotoreal, arkPersonAsset: { enabled: true, assetUrl: "" } }],
      }),
      /方舟私域虚拟人像未绑定有效 asset:\/\//,
      `${model} must reject an enabled library binding without an asset URI`,
    );
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
  const cartoonUploadPayload = await buildSeedanceGenerationPayload({
    prompt: "剧情动作：卡通角色向前走。",
    model: "seedance-2-0",
    assets: [{
      id: "cartoon-upload",
      name: "C001_CARTOON_CHARACTER",
      type: "Character",
      source: "local",
      assetStylePreset: "cg_3d",
      url: "https://preview.example/cartoon-character.png",
    }],
  });
  assert.equal(
    cartoonUploadPayload.content[1].image_url.url,
    "https://preview.example/cartoon-character.png",
    "cartoon uploads must use the ordinary public reference path without Ark certification",
  );
  console.log("canvas Ark video tests passed.");
})();
