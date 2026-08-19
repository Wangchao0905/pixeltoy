import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import serverModule from "../server.js";

const director = serverModule.__test?.videoDirectorAgent;
assert.equal(typeof director?.run, "function", "Video Director Agent must expose an executable run");
assert.equal(typeof director?.rerun, "function", "Video Director Agent must expose a config-only rerun");
assert.equal(typeof director?.read, "function", "Video Director Agent state must be readable");
assert.equal(typeof director?.evaluate, "function", "Video Director Agent must evaluate its output");
assert.equal(typeof director?.inputFingerprints, "function", "Video Director Agent must fingerprint its inputs");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltoy-video-director-agent-"));
const script = "[场景1] 午后校园操场\n星眠抱着报名表站在步道旁，柚夏跑来与她相撞。";
const manifest = {
  items: [
    { id: "S001_COURTYARD", type: "Scene", label: "午后校园操场" },
    { id: "C001_STAR", type: "Character", label: "星眠" },
    { id: "C002_YOUXIA", type: "Character", label: "柚夏" },
  ],
};
const spatialAgent = {
  runId: "space_current",
  status: "ready",
  inputs: { scriptFingerprint: "script", shotFingerprint: "shots", assetFingerprint: "assets" },
  shotStates: [
    { shotName: "E01_V001", spatialState: { cameraSide: "camera-left", entryState: "星眠站在步道左侧。", exitState: "星眠仍站在步道左侧。" } },
    { shotName: "E01_V002", spatialState: { cameraSide: "camera-left", entryState: "柚夏从步道右侧进入。", exitState: "两人蹲在草地上捡报名表。" } },
  ],
};
const shots = [
  {
    name: "E01_V001",
    duration: 8,
    prompt: "开场：星眠站在操场步道旁，抱着报名表，午后暖光从左上方照入。",
    beat: "星眠在招新棚外犹豫。",
    refs: ["S001_COURTYARD", "C001_STAR"],
    sceneRef: "S001_COURTYARD",
    spatialMapId: "MAP_001",
    spatialMapVersion: 2,
    startState: "星眠站在步道左侧。",
    endState: "星眠仍站在步道左侧。",
    transitionIn: "开场建立操场地标。",
    transitionOut: "保留星眠站在步道左侧。",
    lighting: "午后暖光从左上方照入，阴影向右下方落下。",
  },
  {
    name: "E01_V002",
    duration: 22,
    prompt: "柚夏跑入画面，与星眠相撞，报名表散落在草地上。",
    beat: "柚夏跑来与星眠相撞。",
    refs: ["S001_COURTYARD", "C001_STAR", "C002_YOUXIA"],
    sceneRef: "S001_COURTYARD",
    spatialMapId: "MAP_001",
    spatialMapVersion: 2,
    startState: "柚夏从步道右侧进入。",
    endState: "两人蹲在草地上捡报名表。",
    transitionIn: "从上一段星眠站在步道左侧的状态切入。",
    transitionOut: "保留两人蹲在草地上的站位和报名表位置。",
    lighting: "沿用午后暖光和右下方阴影方向。",
  },
];

const fingerprints = director.inputFingerprints({ script, shots, manifest, spatialAgent, promptMode: "prompt", durationMode: "short_drama_variable" });
assert.ok(fingerprints.scriptFingerprint);
assert.ok(fingerprints.shotFingerprint);
assert.ok(fingerprints.assetFingerprint);
assert.notEqual(
  fingerprints.shotFingerprint,
  director.inputFingerprints({ script, shots: shots.map((shot, index) => index === 1 ? { ...shot, duration: 23 } : shot), manifest, spatialAgent, promptMode: "prompt", durationMode: "short_drama_variable" }).shotFingerprint,
  "changing a variable-duration shot must invalidate the director input",
);

const result = director.run(temp, {
  script,
  shots,
  manifest,
  spatialAgent,
  spatialReadiness: { ready: true, ran: true, stale: false, status: "ready", blockingCount: 0, warningCount: 0 },
  promptMode: "prompt",
  durationMode: "short_drama_variable",
});
assert.equal(result.status, "ready");
assert.equal(result.shots[1].spatialState.cameraSide, "camera-left", "the Director Agent must consume Space Agent shot state");
assert.equal(result.shots[1].directorDecision.transitionMode, "same_scene_cut");
assert.equal(result.shots[1].directorDecision.referencePolicy, "official_assets_plus_spatial_map");
assert.equal(result.shots[1].directorDecision.duration, 22);
assert.equal(director.read(temp).runId, result.runId);

const invalid = director.evaluate({
  script,
  shots: [{ ...shots[1], duration: 31 }],
  promptMode: "prompt",
  durationMode: "short_drama_variable",
  spatialAgent,
  spatialReadiness: { ready: true, ran: true, stale: false, status: "ready", blockingCount: 0, warningCount: 0 },
});
assert.equal(invalid.status, "blocked");
assert.ok(invalid.issues.some((item) => item.code === "DURATION_OUT_OF_RANGE"));

fs.rmSync(temp, { recursive: true, force: true });
console.log("video director agent tests passed");
