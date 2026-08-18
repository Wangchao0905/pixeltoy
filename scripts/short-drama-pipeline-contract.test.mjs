import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const server = require("../server.js");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const duration = server.__test?.durationMode;
const prompt = server.__test?.videoPrompt;

assert.equal(duration.DURATION_MODE_SHORT_DRAMA_15, "short_drama_15s");
assert.deepEqual(
  duration.planEpisodeDuration({ durationMode: duration.DURATION_MODE_SHORT_DRAMA_15, script: "总时长：45秒", beats: ["开场"] }).durations,
  [15, 15, 15],
);
assert.deepEqual(
  duration.planEpisodeDuration({ durationMode: duration.DURATION_MODE_SHORT_DRAMA_15, script: "总时长：90秒", beats: ["开场"] }).durations,
  [15, 15, 15, 15, 15, 15],
);

const shot = {
  name: "E01_V001",
  duration: 15,
  refs: ["C001_XIA", "S001_CAMPUS", "P001_FORM"],
  assetLookup: new Map([
    ["C001_XIA", { type: "Character" }],
    ["S001_CAMPUS", { type: "Scene" }],
    ["P001_FORM", { type: "Prop" }],
  ]),
  videoDesign: {
    shot_size: "中景",
    camera_lens: "50mm",
    camera_movement: "固定",
    camera_angle: "平视",
    visual: "人物站在操场步道边",
    timeline: "起始：人物停下；推进：人物抬头；终点：人物看向招新棚。",
    lighting: "午后暖色主光从画面左上方穿过树叶，阴影向右下方落下",
    voice_over: "无",
    sound: "风吹树叶和远处操场环境声",
  },
  startState: "人物站在画面左侧，报名表垂在胸前",
  action: "人物攥紧报名表并抬头",
  endState: "人物视线停在招新棚，报名表仍在手中",
  transitionIn: "从上一段正常切镜进入，保持操场轴线",
  transitionOut: "保留人物视线和报名表位置交给下一段",
};
const compiled = prompt.applyVideoPromptContinuityContract("基础视频提示词", shot, 1);
assert.match(compiled, /VIDEO PRODUCTION CONTRACT/);
assert.match(compiled, /@C001_XIA：人物身份与服装/);
assert.match(compiled, /起始状态：人物站在画面左侧/);
assert.match(compiled, /主动作与物理结果：人物攥紧报名表/);
assert.match(compiled, /退出衔接：保留人物视线/);
assert.match(compiled, /光影连续性：午后暖色主光/);

assert.match(app, /DURATION_MODE_SHORT_DRAMA_15\s*=\s*"short_drama_15s"/);
assert.match(app, /modernShotTransitionLabel/);
assert.match(app, /资产 \$\{referenceCount\} 个/);
assert.match(html, /15 秒短剧模式/);

console.log("short drama pipeline contract tests passed");
