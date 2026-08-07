import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverSource = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const serverModule = require("../server.js");
const duration = serverModule.__test?.durationMode;

assert.ok(duration, "duration mode helpers must be exported");
const { DURATION_MODE_TK: TK, DURATION_MODE_FREE: FREE } = duration;
const series = serverModule.__test?.seriesAssets;

const persistenceRoot = fs.mkdtempSync(path.join(process.cwd(), ".duration-mode-test-"));
try {
  const { episodeRoot } = series.createEpisodeWorkspace(persistenceRoot, "e01", "时长模式测试");
  series.writeAssetManifest(episodeRoot, { confirmed: true, items: [{ id: "SCENE", type: "Scene", label: "小屋" }] });
  assert.equal(duration.projectDurationMode(episodeRoot), TK);
  duration.persistProjectDurationMode(episodeRoot, FREE);
  const manifest = series.readAssetManifest(episodeRoot).data;
  const config = serverModule.readVideoConfig(episodeRoot, { allowEmptyShots: true }).data;
  assert.equal(manifest.durationMode, FREE);
  assert.equal(manifest.production.durationMode, FREE);
  assert.equal(config.durationMode, FREE);
  assert.equal(config.settings.durationMode, FREE);
  assert.equal(duration.fullProjectState(episodeRoot).durationMode, FREE);
} finally {
  fs.rmSync(persistenceRoot, { recursive: true, force: true });
}

const ends = [3, 6, 9, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40, 43, 45, 46.5, 47.5, 48.5];
const gudongScript = ends.map((end, index) => {
  const start = index ? ends[index - 1] : 0;
  const stamp = (value) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  return `${String(index + 1).padStart(2, "0")}｜${stamp(start)}—${stamp(end)} 咕咚完成第 ${index + 1} 段动作。`;
}).join("\n");
const twentyBeats = Array.from({ length: 20 }, (_, index) => `咕咚完成第 ${index + 1} 个连续动作节拍。`);

assert.equal(duration.normalizeDurationMode(), TK, "duration mode must default to TK");
const declared45SecondScript = `# 自由模式时长测试\n\n总时长：约 45 秒\n\n[场景1]\n咕咚在小屋内完成连续动作并停下。`;
assert.equal(
  duration.scriptDeclaredDurationSeconds(declared45SecondScript),
  45,
  "an explicit script duration declaration must be recognized before text estimation",
);
assert.equal(
  duration.scriptDeclaredDurationSeconds("旁白：这条语音消息时长 7 秒。"),
  0,
  "a dialogue line mentioning an audio duration must not become the episode target",
);
assert.equal(
  duration.scriptDeclaredDurationSeconds("单集时长：1 分 15 秒"),
  75,
  "minute-and-second duration declarations must be supported",
);
const markdownTimedScript = `# 奶茶店\n\n**00:00-00:04　店门推开**\n\n傍晚，玻璃门被推开。\n\n**00:04-00:10　柜台前的停顿**\n\n她站在点单台前。\n\n**00:10-00:16　那句问题**\n\n她终于抬眼。\n\n**00:16-00:20　店里静下来**\n\n全店安静。\n\n**00:20-00:30　店员的回答**\n\n店员认真回应。\n\n**00:30-00:36　一杯被替换的选择**\n\n热牛奶注入茶汤。\n\n**00:36-00:41　传染**\n\n后面的人也要一杯。\n\n**00:41-00:45　收尾**\n\n她在窗边喝下奶茶。`;
assert.equal(
  duration.scriptTimecodeTotalSeconds(markdownTimedScript),
  45,
  "Markdown-wrapped screenplay timecodes must determine the free-mode target",
);
const declared45CharacterSetupScript = `角色设定：咕咚，主角，住在小屋。\n总时长：45 秒\n\n[场景1]\n咕咚在小屋内完成连续动作并停下。`;
assert.equal(
  duration.freeTargetDuration({ script: duration.modelPlanningScript(declared45CharacterSetupScript), beats: twentyBeats }),
  45,
  "duration metadata must survive character-setup trimming before video planning",
);
assert.equal(
  duration.freeTargetDuration({ script: declared45SecondScript, beats: twentyBeats }),
  45,
  "free mode must use the explicit 45-second script duration",
);
const declared45Plan = duration.planEpisodeDuration({
  shotCount: twentyBeats.length,
  beats: twentyBeats,
  durationMode: FREE,
  script: declared45SecondScript,
});
assert.equal(declared45Plan.target, 45, "a 45-second script must keep a 45-second free-mode target");
assert.equal(declared45Plan.shotCount, 3, "a 45-second script must produce three 15-second-cap clips");
assert.deepEqual(declared45Plan.durations, [15, 15, 15], "a 45-second script must not expand to eight 15-second clips");
assert.equal(duration.scriptTimecodeTotalSeconds(gudongScript), 49, "48.5 seconds must round to a 49 second target");
assert.equal(typeof duration.modelPlanningScript, "function", "video-config plan rebuild must expose its script preparation path");
const configPlanningScript = duration.modelPlanningScript(gudongScript);
assert.equal(
  duration.freeDurationSourceBeats(configPlanningScript, twentyBeats).length,
  18,
  "video-config plan rebuild must preserve all eighteen timecode lines",
);
assert.equal(
  duration.planEpisodeDuration({
    shotCount: twentyBeats.length,
    beats: twentyBeats,
    durationMode: FREE,
    script: configPlanningScript,
  }).target,
  49,
  "video-config plan rebuild must derive 49 seconds from the prepared script",
);
const staleConfigRoot = fs.mkdtempSync(path.join(process.cwd(), ".duration-mode-readiness-test-"));
try {
  const { episodeRoot } = series.createEpisodeWorkspace(staleConfigRoot, "e01", "自由模式过期配置");
  fs.writeFileSync(series.findProjectFile(episodeRoot, "script"), markdownTimedScript, "utf8");
  duration.persistProjectDurationMode(episodeRoot, FREE);
  const configPath = series.findProjectFile(episodeRoot, "config");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ durationMode: FREE, settings: { durationMode: FREE }, shots: Array.from({ length: 8 }, (_, index) => ({ name: `V${index + 1}`, duration: 15 })) }, null, 2)}\n`,
    "utf8",
  );
  const readiness = duration.configReadiness(episodeRoot);
  assert.deepEqual(readiness.durationPlan?.["target"], 45, "readiness must expose the screenplay target duration");
  assert.deepEqual(readiness.durationPlan?.["shotCount"], 3, "readiness must expose the corrected free-mode shot count");
  assert.deepEqual(readiness.durationMismatch?.actual, { shotCount: 8, target: 120 }, "readiness must identify the stale 120-second config");
  assert.deepEqual(readiness.durationMismatch?.expected, { shotCount: 3, target: 45 }, "readiness must identify the corrected 45-second target");
  assert.equal(readiness.ready, false, "a stale free-mode config must not remain ready for video submission");
} finally {
  fs.rmSync(staleConfigRoot, { recursive: true, force: true });
}
const gudongFingerprint = crypto.createHash("sha1").update(gudongScript).digest("hex");
assert.equal(
  duration.modelShotPlanNeedsRefresh({
    scriptFingerprint: gudongFingerprint,
    durationMode: FREE,
    shots: [{ duration: 4 }],
  }, gudongScript, FREE),
  true,
  "a cached one-shot/four-second free-mode plan must be invalidated even when its mode and script fingerprint match",
);
assert.equal(
  duration.modelShotPlanNeedsRefresh({
    scriptFingerprint: gudongFingerprint,
    durationMode: FREE,
    shots: [13, 13, 10, 13].map((duration) => ({ duration })),
  }, gudongScript, FREE),
  false,
  "a cached free-mode plan must remain reusable only when count and total match the selected script-duration rule",
);
const multilineSource = duration.freeDurationSourceBeats(
  "01｜0:00—0:02.5\n\n景别/运镜：外景大全景\n画面内容：清晨薄雾中的森林小屋。\n\n02｜0:02.5—0:05\n\n画面内容：咕咚在卧室醒来。",
  [],
);
assert.equal(multilineSource.length, 2, "multiline production script must retain both timecode blocks");
assert.match(multilineSource[0].text, /清晨薄雾中的森林小屋/, "timecode source beats must include the following multiline shot content");

const tkBeats = [
  "咕咚在小屋门口继续观察并完成动作。",
  "咕咚转身继续走过走廊并停下。",
  "咕咚继续抬头发现新的线索。",
  "咕咚继续收起道具并离开现场。",
];
const tkPlan = duration.planEpisodeDuration({ shotCount: 4, beats: tkBeats, targetDuration: 75, durationMode: TK, script: gudongScript });
assert.equal(tkPlan.target, 75, "TK target must remain unchanged");
assert.equal(tkPlan.shotCount, 5, "TK must retain the 70-second five-shot floor");
assert.equal(duration.preferredShotCount(gudongScript, tkBeats, TK), 5, "TK preferred shot count must remain unchanged");

const freePlan = duration.planEpisodeDuration({
  shotCount: twentyBeats.length,
  beats: twentyBeats,
  durationMode: FREE,
  script: gudongScript,
});
assert.equal(freePlan.target, 49, "real twenty-beat input must keep the script target");
assert.equal(freePlan.shotCount, 4, "twenty beats must not expand a 49 second free-mode episode");
assert.deepEqual(freePlan.durations, [15, 15, 15, 4], "no-transition fallback must greedily fill 15 second clips");

const sourceBeats = duration.freeDurationSourceBeats(gudongScript, twentyBeats);
assert.equal(sourceBeats.length, 18, "timecoded script lines must be the free-mode cut source");
const transitionDurations = duration.lockFreeDurationsFromCuts({
  targetDuration: 49,
  shotCount: 4,
  sourceBeats,
  cutAfterBeatIndices: [4, 9, 14, 18],
});
assert.deepEqual(transitionDurations, [13, 15, 15, 6], "a model-selected 13 second transition must outrank filling 15 seconds");
assert.equal(transitionDurations.reduce((sum, value) => sum + value, 0), 49, "backend cut allocation must exactly preserve total duration");

const completeDesign = {
  shot_size: "中近景",
  camera_lens: "50mm 标准定焦",
  camera_movement: "固定镜头",
  camera_angle: "平视",
  visual: "咕咚在小屋内完成当前动作，空间方向保持连续。",
  timeline: "起始：咕咚站在小屋内。\n推进：咕咚完成当前动作。\n终点：咕咚停在动作落点。",
  voice_over: "无",
  sound: "室内环境声与动作声",
};
const guardRoot = fs.mkdtempSync(path.join(process.cwd(), ".duration-mode-plan-guard-test-"));
try {
  const { episodeRoot } = series.createEpisodeWorkspace(guardRoot, "e01", "自由模式写入保护");
  assert.throws(
    () => duration.writeStoryboardModelPlan(episodeRoot, {
      model: "test-model",
      script: gudongScript,
      dialogueLanguage: "zh",
      durationMode: FREE,
      shots: [{
        id: "E01_V001_BAD",
        title: "错误单镜头",
        beat: "错误地把完整剧本压成一镜。",
        duration: 4,
        refs: ["SCENE"],
        dialogues: [],
        videoDesign: completeDesign,
      }],
    }),
    /要求 4 镜头 \/ 49 秒，实际 1 镜头 \/ 4 秒/,
    "free-mode persistence must reject a collapsed one-shot plan",
  );
} finally {
  fs.rmSync(guardRoot, { recursive: true, force: true });
}
const rawShots = [4, 90, 4, 90].map((modelDuration, index) => ({
  title: `镜头 ${index + 1}`,
  duration: modelDuration,
  endBeatIndex: [4, 9, 14, 18][index],
  beat: `咕咚完成第 ${index + 1} 段连续动作。`,
  purpose: "推进剧本动作",
  refs: ["SCENE"],
  dialogueLines: [],
  design: completeDesign,
}));
const normalized = duration.normalizeStoryboardPlan(
  { targetDuration: 4, shots: rawShots },
  {
    model: "test-model",
    assets: [{ name: "SCENE", type: "Scene", label: "小屋" }],
    dialogueLanguage: "zh",
    code: "E01",
    beats: twentyBeats,
    sourceBeats,
    durationMode: FREE,
    durationPlan: freePlan,
  },
);
assert.deepEqual(normalized.shots.map((shot) => shot.duration), [13, 15, 15, 6], "model duration values must not control free-mode output");
assert.equal(normalized.targetDuration, 49, "model targetDuration must not control free-mode output");
assert.throws(
  () => duration.normalizeStoryboardPlan(
    { targetDuration: 4, shots: [rawShots[0]] },
    {
      model: "test-model",
      assets: [{ name: "SCENE", type: "Scene", label: "小屋" }],
      dialogueLanguage: "zh",
      code: "E01",
      beats: twentyBeats,
      sourceBeats,
      durationMode: FREE,
      durationPlan: freePlan,
    },
  ),
  /镜头数量/,
  "a one-shot model response must be rejected instead of validating itself as four seconds",
);

const freePrompt = JSON.parse(duration.storyboardUserPrompt({
  script: gudongScript,
  assets: [{ name: "SCENE", type: "Scene", label: "小屋" }],
  dialogueLanguage: "zh",
  targetShotCount: 4,
  beats: twentyBeats,
  sourceBeats,
  durationPlan: freePlan,
}));
assert.equal(freePrompt.durationGuidance.targetDuration, 49);
assert.equal(freePrompt.durationGuidance.shotCount, 4);
assert.match(freePrompt.durationGuidance.rule, /只标记切分点/);
assert.match(freePrompt.durationGuidance.rule, /13 秒.*15 秒/);
assert.doesNotMatch(JSON.stringify(freePrompt.durationGuidance), /70-90/);
assert.equal(freePrompt.sourceBeats.at(-1).end, 48.5);
assert.match(duration.storyboardSystemPrompt(FREE), /endBeatIndex/);
assert.doesNotMatch(duration.storyboardSystemPrompt(FREE), /70-90/);
assert.match(duration.storyboardSystemPrompt(TK), /70-90/);

assert.match(serverSource, /function projectDurationMode\(/);
assert.match(serverSource, /function persistProjectDurationMode\(/);
assert.match(serverSource, /action === "duration-mode"/);
assert.match(serverSource, /modelShotPlanNeedsRefresh\(plan, script, durationMode/);
assert.match(html, /id="modernDurationModeTk"[^>]*role="menuitemradio"/);
assert.match(html, /id="modernDurationModeFree"[^>]*role="menuitemradio"/);
assert.match(appSource, /function renderModernDurationMode[\s\S]*aria-checked/);
assert.match(appSource, /persistProjectDurationMode[\s\S]*\/duration-mode/);
assert.match(styles, /\.modern-project-menu button\.is-active,[\s\S]*var\(--mv-lime\)/);
assert.equal((appSource.match(/durationMode:\s*state\.durationMode/g) || []).length, 2, "draft and config requests must carry duration mode");

console.log("duration mode tests passed");
