import assert from "node:assert/strict";
import serverModule from "../server.js";

const videoRetry = serverModule.__test?.videoRetry;
const videoReferences = serverModule.__test?.videoReferences;
const canvasVideo = serverModule.__test?.canvasVideo;
assert.ok(videoRetry?.projectVideoPayloadForShot, "project video payload helper must be exported");
assert.ok(videoReferences?.projectShotUsableVideoReferenceAssets, "project video reference helper must be exported");
assert.ok(canvasVideo?.buildSeedanceGenerationPayload, "Seedance payload builder must be exported");

const assets = [
  { name: "SB001_E01_V001_PRODUCTION_BOARD", manifestType: "Storyboard", assetUrl: "asset://SB001" },
  { name: "C001_HERO", manifestType: "Character", label: "主角", assetUrl: "asset://C001" },
  { name: "S001_ROOFTOP", manifestType: "Scene", label: "屋顶", assetUrl: "asset://S001" },
  { name: "P001_FLARE", manifestType: "Prop", label: "信号棒", assetUrl: "asset://P001" },
  { name: "I001_SIGNAL", manifestType: "Insert", label: "信号细节", assetUrl: "asset://I001" },
];
const shot = {
  name: "SB001_E01_V001_PRODUCTION_BOARD",
  duration: 15,
  videoPromptMode: "production_board",
  storyboardRefs: [assets[0].name],
  refs: assets.slice(1).map((asset) => asset.name),
  prompt: "剧情动作：主角在屋顶举起信号棒。",
};
const config = {
  settings: { promptMode: "production_board", ratio: "16:9", resolution: "480p" },
  assets,
};

const usable = videoReferences.projectShotUsableVideoReferenceAssets("", config, shot);
assert.deepEqual(
  usable.map((asset) => asset.name),
  assets.map((asset) => asset.name),
  "Production Board video references must include the board first, followed by every bound official asset",
);

const payload = videoRetry.projectVideoPayloadForShot("", shot, config);
assert.deepEqual(
  payload.assets.map((asset) => asset.name),
  assets.map((asset) => asset.name),
  "the submitted payload must carry storyboard, character, scene, prop, and insert images",
);
const submitted = await canvasVideo.buildSeedanceGenerationPayload({
  ...payload,
  model: "seedance-2-0",
  modelMode: "seedance-2-0",
});
assert.match(submitted.content[0].text, /@图片1/, "the submitted prompt must identify the storyboard image");
assert.match(submitted.content[0].text, /@图片2/, "the submitted prompt must preserve the first official asset image mapping");

console.log("storyboard video reference binding tests passed");
