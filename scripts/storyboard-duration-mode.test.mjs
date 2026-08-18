import assert from "node:assert/strict";
import serverModule from "../server.js";

const storyboard = serverModule.__test?.durationMode;
const videoRetry = serverModule.__test?.videoRetry;
assert.ok(storyboard?.productionBoardShotsFromSlots, "Production Board duration helper must be exported");
assert.ok(videoRetry?.projectVideoPayloadForShot, "video payload helper must be exported");
const SHORT15 = storyboard.DURATION_MODE_SHORT_DRAMA_15;

const assets = [
  { name: "S001_CABIN", type: "Scene", manifestType: "Scene", label: "小屋", assetUrl: "asset://S001_CABIN" },
  { name: "C001_GUDONG", type: "Character", manifestType: "Character", label: "咕咚", assetUrl: "asset://C001_GUDONG" },
];
const assetLookup = new Map(assets.map((asset) => [asset.name, asset]));
const videoDesign = {
  shot_size: "中景",
  camera_lens: "35mm 广角",
  camera_movement: "缓慢推进",
  camera_angle: "平视",
  visual: "小屋入口与室内空间保持连续，人物动作清晰可见。",
  timeline: "起始：人物推门进入。\n推进：人物停下观察室内。\n终点：人物锁定桌面线索。",
  voice_over: "无",
  sound: "门轴声与室内环境底噪。",
};
const sourceShots = [
  { name: "E01_V001", duration: 8, title: "进入小屋", beat: "咕咚推门进入小屋。", refs: ["S001_CABIN", "C001_GUDONG"], dialogues: [], videoDesign },
  { name: "E01_V002", duration: 7, title: "观察室内", beat: "咕咚在门口观察室内。", refs: ["S001_CABIN", "C001_GUDONG"], dialogues: [], videoDesign },
  { name: "E01_V003", duration: 7, title: "发现线索", beat: "咕咚发现桌上的线索。", refs: ["S001_CABIN", "C001_GUDONG"], dialogues: [], videoDesign },
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

const fixedBoardShots = storyboard.productionBoardShotsFromSlots(sourceShots, [
  { ...slots[0], duration: 8 },
  { ...slots[1], duration: 7 },
], "zh", assetLookup, SHORT15);
assert.deepEqual(fixedBoardShots.map((shot) => shot.duration), [15, 15], "15-second short-drama mode must normalize every Production Board clip");

const variableBoardShots = storyboard.productionBoardShotsFromSlots(sourceShots, [
  { ...slots[0], duration: 30 },
], "zh", assetLookup, storyboard.DURATION_MODE_SHORT_DRAMA_VARIABLE);
assert.deepEqual(variableBoardShots.map((shot) => shot.duration), [30], "variable short-drama mode must accept a 30-second Production Board clip");
assert.throws(
  () => storyboard.productionBoardShotsFromSlots(sourceShots, [{ ...slots[0], duration: 31 }], "zh", assetLookup, storyboard.DURATION_MODE_SHORT_DRAMA_VARIABLE),
  /4-30s/u,
  "variable short-drama mode must reject a Production Board clip over 30 seconds",
);

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
