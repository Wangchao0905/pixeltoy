import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import serverModule from "../server.js";

const agent = serverModule.__test?.spaceAgent;
assert.ok(agent?.draftMap, "space agent must create scene map drafts");
assert.ok(agent?.evaluate, "space agent must evaluate spatial continuity");
assert.ok(agent?.run, "space agent must expose an executable run");
assert.ok(agent?.read, "space agent state must be persisted and readable");

const map = agent.draftMap({
  sceneRef: "S001_COURTYARD",
  title: "午后校园操场",
  index: 0,
  script: "午后阳光穿过梧桐枝叶，人物站在操场步道旁。",
});
assert.equal(map.status, "draft");
assert.equal(map.sceneRef, "S001_COURTYARD");
assert.ok(map.anchors.length >= 2, "a generated map needs reusable landmarks");
assert.ok(map.axis.cameraSide);
assert.ok(map.lighting.direction);
assert.equal(map.source, "space-agent");

const assetLookup = new Map([
  ["S001_COURTYARD", { manifestType: "Scene", label: "午后校园操场" }],
  ["C001_STAR", { manifestType: "Character", label: "星眠" }],
]);
const shots = [
  {
    name: "E01_V001",
    sceneRef: "S001_COURTYARD",
    refs: ["S001_COURTYARD", "C001_STAR"],
    startState: "星眠站在招新棚几步外，手里抱着报名表。",
    endState: "星眠仍站在步道左侧，视线落向招新棚。",
    spatialMapId: map.id,
    spatialMapVersion: map.version,
    spatialState: { cameraSide: map.axis.cameraSide },
  },
  {
    name: "E01_V002",
    sceneRef: "S001_COURTYARD",
    refs: ["S001_COURTYARD", "C001_STAR"],
    startState: "星眠延续上一段的站位和视线。",
    endState: "星眠抬头看向迎面跑来的柚夏。",
    spatialMapId: map.id,
    spatialMapVersion: map.version,
    spatialState: { cameraSide: map.axis.cameraSide },
  },
];

const ready = agent.evaluate({
  script: "午后校园操场的连续动作。",
  scenes: [{ sceneRef: map.sceneRef, title: map.title }],
  shots,
  maps: [{ ...map, status: "locked" }],
  assetLookup,
  promptMode: "prompt",
});
assert.equal(ready.status, "ready");
assert.equal(ready.issues.length, 0);
assert.equal(ready.handoffs[0].mode, "same_scene_cut");

const blocked = agent.evaluate({
  script: "连续动作。",
  scenes: [{ sceneRef: map.sceneRef, title: map.title }],
  shots: [{ ...shots[1], spatialMapVersion: map.version - 1 }],
  maps: [{ ...map, status: "locked" }],
  assetLookup,
  promptMode: "prompt",
});
assert.equal(blocked.status, "blocked");
assert.ok(blocked.issues.some((item) => item.code === "MAP_VERSION_STALE"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltoy-space-agent-"));
const episodeRoot = path.join(temp, "e01");
fs.mkdirSync(path.join(episodeRoot, "01_script"), { recursive: true });
fs.writeFileSync(
  path.join(episodeRoot, "01_script", "e01_script.md"),
  "[场景1] 午后校园操场\n星眠抱着报名表站在步道旁。",
  "utf8",
);
fs.writeFileSync(
  path.join(episodeRoot, "pipeline.json"),
  JSON.stringify({
    settings: { promptMode: "prompt" },
    shots: [
      { name: "E01_V001", sceneRef: "SCENE_001", refs: ["SCENE_001"], startState: "人物站在步道旁。", endState: "人物看向招新棚。" },
      { name: "E01_V002", sceneRef: "SCENE_001", refs: ["SCENE_001"], startState: "人物延续上一段站位。", endState: "人物抬头。" },
    ],
  }),
  "utf8",
);
const run = await agent.run(episodeRoot, { model: "rules" });
assert.equal(run.source, "local_rules");
assert.equal(run.maps.length, 1);
assert.equal(run.maps[0].status, "draft");
assert.equal(agent.read(episodeRoot).runId, run.runId);
assert.ok(run.issues.some((item) => item.code === "MAP_NOT_LOCKED"));
const persistedConfig = JSON.parse(fs.readFileSync(path.join(episodeRoot, "pipeline.json"), "utf8"));
assert.equal(persistedConfig.shots[0].spatialMapId, run.maps[0].id);
assert.equal(persistedConfig.shots[0].spatialState.cameraSide, run.maps[0].axis.cameraSide);
serverModule.__test.spatialMap.write(episodeRoot, { map: { ...run.maps[0], status: "locked" } });
const refreshed = agent.refresh(episodeRoot);
assert.equal(refreshed.status, "ready", "locking the generated map must clear the agent blocker");

console.log("space agent tests passed");
