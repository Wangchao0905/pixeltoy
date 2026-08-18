import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import serverModule from "../server.js";

const duration = serverModule.__test?.durationMode;
const spatial = serverModule.__test?.spatialMap;
const agent = serverModule.__test?.spaceAgent;
assert.equal(typeof duration?.configReadiness, "function", "config readiness helper must be exported");
assert.equal(typeof spatial?.write, "function", "spatial map writer must be exported");
assert.equal(typeof agent?.run, "function", "space agent runner must be exported");
assert.equal(typeof agent?.refresh, "function", "space agent refresher must be exported");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltoy-space-agent-readiness-"));
const episodeRoot = path.join(temp, "e01");
fs.mkdirSync(path.join(episodeRoot, "01_script"), { recursive: true });
fs.mkdirSync(path.join(episodeRoot, "02_storyboard"), { recursive: true });

const scriptPath = path.join(episodeRoot, "01_script", "e01_script.md");
fs.writeFileSync(scriptPath, "[场景1] 午后校园操场\n星眠抱着报名表站在步道旁。", "utf8");

const config = {
  promptMode: "prompt",
  settings: { promptMode: "prompt" },
  spatialMapPolicy: { mode: "prompt_only", requireLockedMap: true, versioned: true },
  assets: [
    { name: "S001_COURTYARD", manifestType: "Scene", label: "午后校园操场", assetUrl: "asset://scene" },
    { name: "C001_STAR", manifestType: "Character", label: "星眠", assetUrl: "asset://star" },
  ],
  shots: [
    {
      name: "E01_V001",
      duration: 9,
      sceneRef: "S001_COURTYARD",
      refs: ["S001_COURTYARD", "C001_STAR"],
      startState: "星眠站在步道旁。",
      endState: "星眠仍站在步道左侧。",
      transitionOut: "保留星眠站在步道左侧的状态。",
    },
    {
      name: "E01_V002",
      duration: 12,
      sceneRef: "S001_COURTYARD",
      refs: ["S001_COURTYARD", "C001_STAR"],
      startState: "星眠延续上一段站位。",
      endState: "星眠抬头看向步道前方。",
      transitionIn: "从上一段退出状态切入，保持站位和视线。",
      transitionOut: "以抬头看向步道前方收尾。",
    },
  ],
};
fs.writeFileSync(path.join(episodeRoot, "pipeline.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

const notRun = duration.configReadiness(episodeRoot);
assert.equal(notRun.ready, false);
assert.ok(notRun.missing.some((item) => /尚未运行 Space Agent/.test(item)));
assert.equal(notRun.spatialAgent.status, "not_run");

const run = await agent.run(episodeRoot, { model: "rules" });
assert.equal(run.source, "local_rules");
assert.equal(run.maps.length, 1);
assert.equal(run.status, "blocked", "draft maps must keep the video gate blocked");

const locked = spatial.write(episodeRoot, { map: { ...run.maps[0], status: "locked" } });
assert.equal(locked.maps[0].status, "locked");
const refreshed = agent.refresh(episodeRoot);
assert.equal(refreshed.status, "ready");

const ready = duration.configReadiness(episodeRoot);
assert.equal(ready.ready, true, "a current ready Space Agent run must unlock prompt generation");
assert.equal(ready.spatialAgent.ready, true);
assert.equal(ready.spatialAgent.status, "ready");

fs.writeFileSync(scriptPath, "[场景1] 午后校园操场\n星眠跑向招新棚。", "utf8");
const stale = duration.configReadiness(episodeRoot);
assert.equal(stale.ready, false);
assert.ok(stale.missing.some((item) => /Space Agent 输入已过期/.test(item)));
assert.equal(stale.spatialAgent.stale, true);

fs.writeFileSync(scriptPath, "[场景1] 午后校园操场\n星眠抱着报名表站在步道旁。", "utf8");
const draftMap = spatial.write(episodeRoot, { map: { ...locked.maps[0], status: "draft" } });
assert.equal(draftMap.maps[0].status, "draft");
const blocked = agent.refresh(episodeRoot);
assert.equal(blocked.status, "blocked");
const blockedReadiness = duration.configReadiness(episodeRoot);
assert.equal(blockedReadiness.ready, false);
assert.ok(blockedReadiness.missing.some((item) => /Space Agent 发现/.test(item)));
assert.ok(blockedReadiness.spatialAgent.blockingCount > 0);

fs.rmSync(temp, { recursive: true, force: true });
console.log("space agent readiness tests passed");
