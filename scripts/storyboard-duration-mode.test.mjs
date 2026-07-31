import assert from "node:assert/strict";
import serverModule from "../server.js";

const storyboard = serverModule.__test?.durationMode;
const videoRetry = serverModule.__test?.videoRetry;
assert.ok(storyboard?.productionBoardShotsFromSlots, "Production Board duration helper must be exported");
assert.ok(videoRetry?.projectVideoPayloadForShot, "video payload helper must be exported");

const assets = [
  { name: "S001_CABIN", type: "Scene", manifestType: "Scene", label: "小屋", assetUrl: "asset://S001_CABIN" },
  { name: "C001_GUDONG", type: "Character", manifestType: "Character", label: "咕咚", assetUrl: "asset://C001_GUDONG" },
];
const assetLookup = new Map(assets.map((asset) => [asset.name, asset]));
const sourceShots = [
  { name: "E01_V001", duration: 8, title: "进入小屋", beat: "咕咚推门进入小屋。", refs: ["S001_CABIN", "C001_GUDONG"], dialogues: [], videoDesign: {} },
  { name: "E01_V002", duration: 7, title: "观察室内", beat: "咕咚在门口观察室内。", refs: ["S001_CABIN", "C001_GUDONG"], dialogues: [], videoDesign: {} },
  { name: "E01_V003", duration: 7, title: "发现线索", beat: "咕咚发现桌上的线索。", refs: ["S001_CABIN", "C001_GUDONG"], dialogues: [], videoDesign: {} },
];
const slots = [
  {
    id: "SB001_E01_V001_TO_E01_V002_PRODUCTION_BOARD",
    label: "SEQ 01 · 15秒 Production Board",
    duration: 15,
    startSecond: 0,
    endSecond: 15,
    sourceShotNames: ["E01_V001", "E01_V002"],
    refs: ["S001_CABIN", "C001_GUDONG"],
    beatSummary: "进入小屋并观察室内",
    asset: { assetName: "SB001_E01_V001_TO_E01_V002_PRODUCTION_BOARD" },
    panels: [],
  },
  {
    id: "SB002_E01_V003_PRODUCTION_BOARD",
    label: "SEQ 02 · 7秒 Production Board",
    duration: 7,
    startSecond: 15,
    endSecond: 22,
    sourceShotNames: ["E01_V003"],
    refs: ["S001_CABIN", "C001_GUDONG"],
    beatSummary: "发现线索",
    asset: { assetName: "SB002_E01_V003_PRODUCTION_BOARD" },
    panels: [],
  },
];

const boardShots = storyboard.productionBoardShotsFromSlots(sourceShots, slots, "zh", assetLookup);
assert.equal(boardShots.length, 2, "one video shot must be created per storyboard slot");
assert.deepEqual(boardShots.map((shot) => shot.duration), [15, 7], "Production Board video durations must come from board slots");
assert.deepEqual(boardShots.map((shot) => shot.storyboardRefs), [
  ["SB001_E01_V001_TO_E01_V002_PRODUCTION_BOARD"],
  ["SB002_E01_V003_PRODUCTION_BOARD"],
]);
assert.deepEqual(boardShots[0].storyboardSourceShots, ["E01_V001", "E01_V002"]);
assert.equal(boardShots[0].videoPromptMode, "production_board");

const rebuiltSegments = storyboard.storyboardSegmentsFromShots(boardShots, "zh");
assert.deepEqual(rebuiltSegments.map((segment) => segment.sourceShotNames), [
  ["E01_V001", "E01_V002"],
  ["E01_V003"],
], "a rebuilt Production Board state must retain the model source-shot range");

const boardPayload = videoRetry.projectVideoPayloadForShot(
  "",
  boardShots[0],
  { settings: { promptMode: "production_board", ratio: "16:9", resolution: "480p" }, assets: [
    { name: boardShots[0].storyboardRefs[0], manifestType: "Storyboard", assetUrl: `asset://${boardShots[0].storyboardRefs[0]}` },
  ] },
);
assert.equal(boardPayload.duration, 15, "Production Board payload must submit the board duration");
assert.equal(boardPayload.videoPromptMode, "production_board");
assert.equal(boardPayload.startFrameUrl, "", "Production Board mode must not inherit tail-frame input");

const promptPayload = videoRetry.projectVideoPayloadForShot(
  "",
  { name: "E01_V001", duration: 6, refs: ["S001_CABIN"], prompt: "普通提示词", videoPromptMode: "prompt" },
  { settings: { promptMode: "prompt", ratio: "16:9", resolution: "480p" }, assets: [assets[0]] },
);
assert.equal(promptPayload.duration, 6, "prompt mode must keep its own shot duration");
assert.equal(promptPayload.videoPromptMode, "prompt");

console.log("storyboard duration mode tests passed");
