import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import serverModule from "../server.js";

const spatial = serverModule.__test?.spatialMap;
const videoRetry = serverModule.__test?.videoRetry;
const duration = serverModule.__test?.durationMode;
assert.ok(spatial?.normalize, "spatial map normalizer must be exported");
assert.ok(spatial?.promptText, "spatial map prompt compiler must be exported");
assert.ok(spatial?.read, "spatial map reader must be exported");
assert.ok(spatial?.bind, "spatial map shot binder must be exported");
assert.ok(videoRetry?.projectVideoPayloadForShot, "video payload helper must be exported");
assert.ok(duration?.configReadiness, "config readiness helper must be exported");

const map = spatial.normalize({
  id: "MAP_S001_NIGHT",
  sceneRef: "S001_ROOM_NIGHT",
  status: "locked",
  version: 3,
  anchors: [
    { id: "door", label: "入口", screenPosition: "frame-left", distanceM: 8 },
    { id: "mat", label: "训练垫", screenPosition: "center", distanceM: 0 },
  ],
  axis: { cameraSide: "door-side", line: "door-to-mat", crossing: "forbidden" },
  lighting: { source: "overhead", direction: "above-center", shadowDirection: "down" },
  zones: [{ id: "mat-center", anchor: "mat", purpose: "主要表演区" }],
});

assert.equal(map.status, "locked");
assert.equal(map.version, 3);
assert.equal(map.sceneRef, "S001_ROOM_NIGHT");
assert.match(spatial.promptText(map), /GEO SPATIAL LAYOUT/);
assert.match(spatial.promptText(map), /camera stays on the door-side/);
assert.match(spatial.promptText(map), /入口/);

const promptModeConfig = {
  settings: { promptMode: "prompt", ratio: "9:16", resolution: "480p" },
  spatialMapPolicy: { mode: "prompt_only", requireLockedMap: true, versioned: true },
  assets: [
    { name: "S001_ROOM_NIGHT", manifestType: "Scene", label: "地下训练室", assetUrl: "asset://scene" },
    { name: "C001_ROCO", manifestType: "Character", label: "ROCO", assetUrl: "asset://roco" },
  ],
  spatialMaps: [map],
};
const promptShot = {
  name: "E01_V001",
  prompt: "剧情动作：ROCO站在训练垫中央。",
  refs: ["S001_ROOM_NIGHT", "C001_ROCO"],
  sceneRef: "S001_ROOM_NIGHT",
  spatialMapId: map.id,
  spatialMapVersion: map.version,
  spatialState: {
    cameraSide: "door-side",
    blocking: [{ actor: "ROCO", zone: "mat-center", screenPosition: "center", facing: "door", gaze: "door" }],
    entryState: "ROCO is already at the center of the mat.",
    exitState: "ROCO keeps his gaze on the doorway.",
  },
};
const promptPayload = videoRetry.projectVideoPayloadForShot("", promptShot, promptModeConfig);
assert.match(promptPayload.prompt, /GEO SPATIAL LAYOUT/);
assert.match(promptPayload.prompt, /SHOT SPATIAL BLOCKING/);
assert.match(promptPayload.prompt, /CONTINUITY HANDOFF/);

const boardConfig = {
  settings: { promptMode: "production_board" },
  assets: promptModeConfig.assets,
  spatialMaps: [map],
};
const boardShot = {
  ...promptShot,
  videoPromptMode: "production_board",
  storyboardRefs: ["SB001"],
  refs: ["S001_ROOM_NIGHT", "C001_ROCO"],
};
const boardPayload = videoRetry.projectVideoPayloadForShot("", boardShot, boardConfig);
assert.doesNotMatch(boardPayload.prompt, /GEO SPATIAL LAYOUT/);
assert.doesNotMatch(boardPayload.prompt, /SHOT SPATIAL BLOCKING/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltoy-spatial-map-"));
const episodeRoot = path.join(temp, "e01");
fs.mkdirSync(path.join(episodeRoot, "02_storyboard"), { recursive: true });
fs.writeFileSync(
  path.join(episodeRoot, "02_storyboard", "e01_spatial_maps.json"),
  JSON.stringify({ version: 1, maps: [map] }),
  "utf8",
);
const readResult = spatial.read(episodeRoot);
assert.equal(readResult.maps.length, 1);
assert.equal(readResult.maps[0].id, map.id);

const boundPromptShot = spatial.bind({ sceneRef: map.sceneRef, name: "E01_V002" }, readResult.maps, { promptMode: "prompt" });
assert.equal(boundPromptShot.spatialMapId, map.id, "prompt shots bind the scene map automatically");
assert.equal(boundPromptShot.spatialMapVersion, map.version, "prompt shots snapshot the current map version");

const boardBoundShot = spatial.bind({ sceneRef: map.sceneRef, name: "E01_V002", spatialMapId: map.id }, readResult.maps, { promptMode: "production_board" });
assert.equal(boardBoundShot.spatialMapId, undefined, "storyboard shots do not carry spatial map bindings");

const firstSave = spatial.write(episodeRoot, {
  map: { ...map, version: 99 },
});
assert.equal(firstSave.maps[0].version, 3, "unchanged map keeps its version");
const updatedMap = {
  ...map,
  status: "locked",
  lighting: { ...map.lighting, direction: "above-left" },
};
const secondSave = spatial.write(episodeRoot, { map: updatedMap });
assert.equal(secondSave.maps[0].version, 4, "changed map increments its version");
assert.equal(secondSave.maps[0].status, "locked");
assert.equal(spatial.forShot(episodeRoot, { sceneRef: map.sceneRef, spatialMapId: map.id, spatialMapVersion: 3 }, { promptMode: "prompt" }), null, "old shot version becomes stale after map update");
const draftSave = spatial.write(episodeRoot, { map: { ...updatedMap, status: "draft" } });
assert.throws(
  () => duration.assertPromptSpatialMapsReady(episodeRoot, { promptMode: "prompt", spatialMapPolicy: { requireLockedMap: true }, shots: [{ name: "E01_V002", sceneRef: map.sceneRef, spatialMapId: map.id, spatialMapVersion: draftSave.maps[0].version }] }),
  /空间地图校验未通过/,
  "draft maps are saved but cannot be submitted",
);

const missingMapConfig = {
  ...promptModeConfig,
  shots: [{ ...promptShot, spatialMapId: "MAP_MISSING", spatialMapVersion: 1 }],
};
const readiness = duration.configReadiness(episodeRoot, missingMapConfig);
assert.equal(readiness.promptMode, "prompt");
assert.ok(readiness.missing.some((item) => /空间地图/.test(item)), "prompt mode must report missing spatial maps");

const boardReadiness = duration.configReadiness(episodeRoot, {
  ...boardConfig,
  shots: [boardShot],
});
assert.equal(boardReadiness.missing.some((item) => /空间地图/.test(item)), false, "storyboard mode must ignore spatial map readiness");

console.log("prompt spatial map tests passed");
