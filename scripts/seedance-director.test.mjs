import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const director = require(path.join(root, "server", "seedance-director.js"));

const completeDesign = {
  shot_size: "双人侧面半身中近景",
  camera_lens: "50mm 标准定焦",
  camera_movement: "小幅前后缓慢推动，全程匀速 3 秒",
  camera_angle: "侧前方微仰 15° 视角",
  visual: "马车旁的草丛环绕两人，Cassian 护住 Vivienne，侧平行自然光勾勒轮廓。",
  voice_over: "I force myself to stay silent.",
  sound: "布料摩擦声延续，叠加野外底噪。",
};

// 模型返回只保留自然语言镜头单所需的七项；未知键和空值必须被清掉。
{
  const clean = director.sanitizeSeedanceDesign({
    ...completeDesign,
    shot_size: "  双人侧面半身中近景  ",
    obsolete_json_field: "discard",
    sound: "",
  });
  assert.equal(clean.shot_size, "双人侧面半身中近景");
  assert.ok(!("obsolete_json_field" in clean));
  assert.ok(!("sound" in clean));
  assert.equal(director.hasCompleteSeedanceDesign(clean), false, "缺少任一字段都不能进入视频配置");
  assert.equal(director.hasCompleteSeedanceDesign(completeDesign), true, "完整导演设计才可进入视频配置");
  assert.deepEqual(director.sanitizeSeedanceDesign(null), {});
  assert.deepEqual(director.sanitizeSeedanceDesign(["x"]), {});
}

{
  assert.deepEqual(director.SEEDANCE_DESIGN_FIELDS, [
    "shot_size",
    "camera_lens",
    "camera_movement",
    "camera_angle",
    "visual",
    "voice_over",
    "sound",
  ]);
  assert.match(director.SEEDANCE_DIRECTOR_SYSTEM_ZH, /以下 7 项必须全部存在/);
  for (const field of director.SEEDANCE_DESIGN_FIELDS) {
    assert.match(director.SEEDANCE_DIRECTOR_SYSTEM_ZH, new RegExp(`- ${field}：`));
  }
}

// server.js 接线：草稿保存模型计划，配置只读取它，最终提交保留中文镜头单。
{
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const buildVideoConfig = server.slice(server.indexOf("async function buildVideoConfig("), server.indexOf("function clearVideoArtifactsForNewCanvas"));

  assert.match(server, /function writeStoryboardModelPlan\(/);
  assert.match(server, /function readStoryboardModelPlan\(/);
  assert.match(server, /function modelShotPlanForConfig\(/);
  assert.match(server, /function seedanceNaturalLanguagePromptForShot\(/);
  assert.match(server, /镜号 \$\{index \+ 1\}（\$\{duration\} 秒）/);
  for (const field of ["景别：", "摄像机 / 镜头：", "运镜：", "机位视角：", "画面：", "人声 OS：", "人物台词：", "音效："]) {
    assert.ok(server.includes(field), `自然语言模板必须包含 ${field}`);
  }
  assert.match(server, /const modelPlan = readStoryboardModelPlan\(episodeRoot\)/);
  assert.match(buildVideoConfig, /modelShotPlanForConfig\(\{/);
  assert.match(buildVideoConfig, /assets: productionAssets/);
  assert.match(buildVideoConfig, /seedancePromptForShotMode\(shot, index, dialogueLanguage, storyboardsActive\)/);
  assert.doesNotMatch(buildVideoConfig, /applyCinematicDesignToShots\(/);
  assert.doesNotMatch(buildVideoConfig, /refsForBeat\(/);
  assert.doesNotMatch(buildVideoConfig, /refineShotRefsForBeat\(/);
  assert.doesNotMatch(buildVideoConfig, /parsePromptSections\(/);
  assert.doesNotMatch(buildVideoConfig, /localizeShotDialoguesWithStoryboardModel\(/);
  assert.doesNotMatch(server, /parseSeedanceDesignFromPrompt/);
  assert.doesNotMatch(server, /seedanceDirectorEnabled/);
  assert.match(server, /模型导演设计缺失或已过期，请重新生成分镜草稿后再生成视频配置。/);
  assert.match(server, /function isSeedanceNaturalLanguageShotPrompt\(/);
  assert.match(server, /if \(isSeedanceNaturalLanguageShotPrompt\(text\)\) return sanitizeSeedancePromptForPolicy\(text\);/);
}

console.log("seedance-director tests passed.");
