import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const serverModule = require("../server.js");
const duration = serverModule.__test?.durationMode;
const series = serverModule.__test?.seriesAssets;

assert.ok(duration, "duration mode test helpers must be exported");
const { DURATION_MODE_TK: TK, DURATION_MODE_FREE: FREE } = duration;
assert.equal(TK, "tk", "TK mode must use the stable tk value");
assert.equal(FREE, "free", "free mode must use the stable free value");
assert.equal(duration.normalizeDurationMode(), TK, "duration mode must default to TK");
assert.equal(duration.normalizeDurationMode("unexpected"), TK, "unknown duration mode must fall back to TK");

const persistenceRoot = fs.mkdtempSync(path.join(process.cwd(), ".duration-mode-test-"));
try {
  const { episodeRoot } = series.createEpisodeWorkspace(persistenceRoot, "e01", "时长模式测试");
  series.writeAssetManifest(episodeRoot, { confirmed: true, items: [{ id: "SCENE", type: "Scene", label: "小屋" }] });
  assert.equal(duration.projectDurationMode(episodeRoot), TK, "new projects must read TK as the default mode");
  duration.persistProjectDurationMode(episodeRoot, FREE);
  const manifest = series.readAssetManifest(episodeRoot).data;
  const config = serverModule.readVideoConfig(episodeRoot, { allowEmptyShots: true }).data;
  assert.equal(manifest.durationMode, FREE, "free mode must be stored in the asset manifest");
  assert.equal(manifest.production.durationMode, FREE, "free mode must be stored in manifest production settings");
  assert.equal(config.durationMode, FREE, "free mode must be stored in video config");
  assert.equal(config.settings.durationMode, FREE, "free mode must be stored in video config settings");
  assert.equal(duration.projectDurationMode(episodeRoot), FREE, "stored free mode must be read back");
  assert.equal(duration.fullProjectState(episodeRoot).durationMode, FREE, "full project state must reflect the persisted free mode");
  duration.persistProjectDurationMode(episodeRoot, TK);
  assert.equal(duration.fullProjectState(episodeRoot).durationMode, TK, "full project state must reflect a persisted TK mode change");
} finally {
  fs.rmSync(persistenceRoot, { recursive: true, force: true });
}

const gudongScript = Array.from({ length: 18 }, (_, index) => {
  const start = index === 0 ? "0:00" : `${Math.floor((index * 2.85) / 60)}:${String(Math.round((index * 2.85) % 60)).padStart(2, "0")}`;
  const end = index === 17 ? "0:48.5" : `${Math.floor(((index + 1) * 2.85) / 60)}:${String(Math.round(((index + 1) * 2.85) % 60)).padStart(2, "0")}`;
  return `${String(index + 1).padStart(2, "0")}｜${start}—${end} 咕咚继续完成第 ${index + 1} 段动作。`;
}).join("\n");
assert.equal(duration.scriptTimecodeTotalSeconds(gudongScript), 49, "script timecodes must round the final end time to whole seconds");

const beats = [
  "咕咚在小屋门口继续观察并完成动作。",
  "咕咚转身继续走过走廊并停下。",
  "咕咚继续抬头发现新的线索。",
  "咕咚继续收起道具并离开现场。",
];
const tkPlan = duration.planEpisodeDuration({ shotCount: 4, beats, targetDuration: 75, script: gudongScript });
assert.equal(tkPlan.target, 75, "TK mode regression must retain the 75 second target");
assert.equal(tkPlan.shotCount, 5, "TK mode regression must retain the five-shot lower bound");
assert.equal(duration.preferredShotCount(gudongScript, beats, TK), 5, "TK preferred shot count must retain its five-shot lower bound");
assert.equal(duration.preferredShotCount(gudongScript, beats, FREE), 4, "free preferred shot count must allow four shots");
assert.equal(
  duration.preferredShotCount(gudongScript, Array.from({ length: 6 }, () => "咕咚继续完成动作。"), FREE),
  4,
  "free preferred shot count must be the minimum count needed for a 49 second target at 15 seconds per shot",
);
const twentyBeats = Array.from({ length: 20 }, (_, index) => `咕咚完成第 ${index + 1} 个连续动作节拍。`);
const freePlanWithTwentyBeats = duration.planEpisodeDuration({
  shotCount: twentyBeats.length || duration.preferredShotCount(gudongScript, twentyBeats, FREE),
  beats: twentyBeats,
  durationMode: FREE,
  script: gudongScript,
});
assert.equal(freePlanWithTwentyBeats.shotCount, 4, "free shot count must follow the 49 second target instead of beats.length");
assert.deepEqual(
  freePlanWithTwentyBeats.durations,
  [15, 15, 15, 4],
  "free mode must greedily fill four target-driven shots even when the script has twenty beats",
);
assert.equal(duration.targetDurationForBeats(5, beats, 49, TK, gudongScript), 70, "TK mode must retain the 70 second target floor");

const freePlan = duration.planEpisodeDuration({
  shotCount: 4,
  beats,
  script: gudongScript,
  durationMode: FREE,
});
assert.equal(freePlan.target, 49, "free mode must round the 48.5 second script to 49 seconds");
assert.equal(freePlan.shotCount, 4, "free mode must not force the TK five-shot lower bound");
assert.equal(freePlan.durationMode, FREE, "duration plans must carry the selected mode to model normalization and prompts");
assert.ok(freePlan.durations.every((seconds) => seconds >= 4 && seconds <= 15), "planned free-mode shots must stay within 4-15 seconds");
assert.ok(freePlan.durations.includes(15), "free-mode suggestions must greedily use 15 second shots when possible");
assert.ok(freePlan.durations.length <= 5, "free-mode suggestions must use the minimum practical shot count");
assert.equal(
  duration.targetDurationForBeats(4, beats, 49, FREE, gudongScript),
  49,
  "free mode must not apply the TK floor when a target is explicitly requested",
);

const modelShots = [13, 12, 11, 13].map((durationSeconds, index) => ({
  title: `镜头 ${index + 1}`,
  beat: beats[index],
  duration: durationSeconds,
  refs: ["SCENE"],
  design: {
    shot_size: "中近景",
    camera_lens: "50mm 标准定焦",
    camera_movement: "固定镜头",
    camera_angle: "平视",
    visual: "室内，主体从左向右完成一个可见动作，窗光保持连续",
    voice_over: "无",
    sound: "脚步与室内环境声",
  },
}));
assert.equal(duration.shouldRebalanceShotDurations(modelShots, TK), true, "TK mode must retain the 70 second rebalance gate");
assert.equal(duration.shouldRebalanceShotDurations(modelShots, FREE), false, "free mode must not rebalance a valid 49 second cut plan");
const normalizedFreePlan = duration.normalizeStoryboardPlan(
  { targetDuration: 49, shots: modelShots },
  {
    model: "test-model",
    assets: [{ name: "SCENE" }],
    dialogueLanguage: "zh",
    code: "E01",
    beats,
    durationMode: FREE,
    durationPlan: { target: 49, durations: [13, 12, 11, 13], durationMode: FREE },
  },
);
assert.deepEqual(
  normalizedFreePlan.shots.map((shot) => shot.duration),
  [13, 12, 11, 13],
  "free mode must preserve valid model cut points instead of rebalancing them",
);
assert.equal(normalizedFreePlan.targetDuration, 49, "free mode must accept a valid 49 second model plan");
assert.ok(normalizedFreePlan.shots.every((shot) => shot.duration >= 4 && shot.duration <= 15), "normalized free-mode shots must stay within 4-15 seconds");
const clampedFreePlan = duration.normalizeStoryboardPlan(
  { targetDuration: 47, shots: modelShots.map((shot, index) => ({ ...shot, duration: [3, 16, 13, 17][index] })) },
  {
    model: "test-model",
    assets: [{ name: "SCENE" }],
    dialogueLanguage: "zh",
    code: "E01",
    beats,
    durationMode: FREE,
    durationPlan: { target: 47, durations: [4, 15, 13, 15], durationMode: FREE },
  },
);
assert.deepEqual(clampedFreePlan.shots.map((shot) => shot.duration), [4, 15, 13, 15], "free mode must clamp every model shot to 4-15 seconds");

const freePrompt = JSON.parse(duration.storyboardUserPrompt({
  script: gudongScript,
  assets: [{ name: "SCENE", type: "Scene", label: "小屋" }],
  dialogueLanguage: "zh",
  targetShotCount: 4,
  durationPlan: { target: 49, durations: [13, 12, 11, 13], durationMode: FREE },
}));
const tkPrompt = JSON.parse(duration.storyboardUserPrompt({
  script: gudongScript,
  assets: [{ name: "SCENE", type: "Scene", label: "小屋" }],
  dialogueLanguage: "zh",
  targetShotCount: 5,
  durationPlan: { target: 75, durations: [15, 15, 15, 15, 15], durationMode: TK },
}));
assert.match(freePrompt.durationGuidance.rule, /优先在转场和镜头切换处分段/, "free prompt must prioritize transitions and shot changes");
assert.match(freePrompt.durationGuidance.rule, /13 秒.*转场.*15/, "free prompt must prefer a transition at 13 seconds over filling 15 seconds");
assert.match(freePrompt.durationGuidance.rule, /只允许使用剧本已有内容/, "free prompt must forbid invented events");
assert.doesNotMatch(freePrompt.durationGuidance.allowedTotalRange, /70/, "free prompt range must not retain the TK 70 second floor");
assert.equal(freePrompt.durationGuidance.allowedTotalRange, "44-54s", "free prompt range must stay within a narrow window around the 49 second target");
const freeRange = freePrompt.durationGuidance.allowedTotalRange.match(/^(\d+)-(\d+)s$/);
assert.ok(freeRange, "free prompt must expose a numeric allowed total range");
assert.ok(Number(freeRange[1]) <= freePrompt.durationGuidance.targetDuration, "free prompt range lower bound must include the target duration");
assert.ok(Number(freeRange[2]) >= freePrompt.durationGuidance.targetDuration, "free prompt range upper bound must include the target duration");
assert.ok(Number(freeRange[1]) >= 4 * 4, "free prompt range lower bound must not undercut four shots at four seconds each");
assert.ok(Number(freeRange[2]) <= 60, "free prompt range upper bound must be materially below the 90 second theoretical maximum");
assert.doesNotMatch(tkPrompt.durationGuidance.rule, /优先在转场和镜头切换处分段/, "TK prompt must retain the existing duration rule");
assert.equal(tkPrompt.durationGuidance.allowedTotalRange, "70-90s", "TK prompt must retain its 70-90 second allowed range");

assert.match(serverSource, /function projectDurationMode\(/, "server must expose persisted duration mode lookup");
assert.match(serverSource, /function persistProjectDurationMode\(/, "server must expose persisted duration mode writeback");
assert.match(serverSource, /durationMode:\s*normalized/, "duration mode must be written to project records");
const persistDurationModeSource = serverSource.slice(
  serverSource.indexOf("function persistProjectDurationMode("),
  serverSource.indexOf("\nfunction persistProjectDialogueLanguage(")
);
assert.ok(
  persistDurationModeSource.includes("...(manifestRecord.data.production || {}),\n        durationMode: normalized"),
  "duration mode must follow the manifest production persistence path",
);
assert.match(serverSource, /action === "duration-mode"/, "server must provide a duration mode writeback route");
const durationPlanCalls = [...serverSource.matchAll(/const durationPlan = planEpisodeDuration\(\{([\s\S]*?)\n  \}\);/g)].map((match) => match[1]);
assert.equal(durationPlanCalls.length, 3, "the three generation entry points must remain covered");
assert.ok(durationPlanCalls.every((call) => call.includes("durationMode") && call.includes("script")), "all duration planning entry points must pass duration mode and script");
assert.match(html, /id="modernDurationModeTk"[^>]*role="menuitemradio"/, "project menu must expose TK mode radio item");
assert.match(html, /id="modernDurationModeFree"[^>]*role="menuitemradio"/, "project menu must expose free mode radio item");
assert.match(appSource, /function projectDurationModeFrom\(/, "frontend must read the persisted project duration mode");
assert.match(appSource, /function renderModernDurationMode[\s\S]*aria-checked/, "frontend must reflect the current mode in the menu");
const renderModernDurationModeSource = appSource.slice(
  appSource.indexOf("function renderModernDurationMode("),
  appSource.indexOf("\nasync function persistProjectDurationMode(")
);
const modeButtons = ["tk", "free"].map((durationMode) => {
  const attributes = new Map();
  const icon = { textContent: "" };
  const button = {
    dataset: { durationMode },
    classList: { toggle() {} },
    querySelector(selector) {
      return selector === ".modern-duration-mode-icon" ? icon : null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  return { button, attributes, icon };
});
const renderContext = vm.createContext({
  state: { durationMode: TK },
  document: { querySelectorAll: () => modeButtons.map(({ button }) => button) },
  normalizeDurationMode: (mode) => mode === FREE ? FREE : TK,
  projectDurationModeFrom: (data) => data?.durationMode,
});
vm.runInContext(`${renderModernDurationModeSource}; globalThis.renderModernDurationMode = renderModernDurationMode;`, renderContext);
renderContext.renderModernDurationMode({ durationMode: FREE });
assert.notEqual(modeButtons[0].icon.textContent, modeButtons[1].icon.textContent, "selected and unselected duration modes must use different icons");
assert.equal(modeButtons[1].icon.textContent, "◉", "free mode must show the selected icon after switching to free");
assert.doesNotMatch(html, /data-duration-mode="(?:tk|free)"[^>]*>\s*<span[^>]*>◉|data-duration-mode="(?:tk|free)"[^>]*>\s*<span[^>]*>◌/, "duration mode icons must not be hardcoded in HTML");
assert.match(html, /<div class="modern-project-menu-label">时长模式<\/div>/, "duration mode items must be grouped in the project menu");
assert.match(
  fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8"),
  /\.modern-project-menu button\.is-active,\s*\.modern-project-menu button\[aria-checked="true"\]\s*\{[^}]*var\(--mv-lime\)/,
  "selected duration mode menu items must use the existing lime selection color",
);
assert.match(appSource, /modernProjectMenu[\s\S]*persistProjectDurationMode/, "project menu must bind mode changes");
assert.match(appSource, /persistProjectDurationMode[\s\S]*\/duration-mode/, "frontend must write duration mode back to the server");
assert.equal((appSource.match(/durationMode:\s*state\.durationMode/g) || []).length, 2, "draft and config requests must carry duration mode");

console.log("duration mode tests passed");
