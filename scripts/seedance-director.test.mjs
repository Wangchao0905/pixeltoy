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
  timeline: "起始：Vivienne 咬住下唇，Cassian 维持遮挡姿态。\n推进：两人随马车颠簸收紧躯干距离。\n终点：Vivienne 停住吞咽，视线仍向下。",
  voice_over: "I force myself to stay silent.",
  sound: "布料摩擦声延续，叠加野外底噪。",
};

// 模型返回只保留自然语言镜头单所需的八项；未知键和空值必须被清掉。
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
    "timeline",
    "voice_over",
    "sound",
  ]);
  assert.match(director.SEEDANCE_DIRECTOR_SYSTEM_ZH, /以下 8 项必须全部存在/);
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
  assert.ok(server.includes("动作时间线："), "自然语言模板必须包含模型导演设计的动作时间线");
  assert.match(server, /function videoStyleDirectiveFromProductionAssets\(/, "视频风格必须能从资产文案提取，而不只读取 preset");
  assert.match(server, /function storyboardPanelTimelineForPrompt\(/, "Production Board 必须编译九宫格节拍，而非只提交笼统说明");
  assert.match(server, /const modelPlan = await ensureModelShotPlanForConfig\(episodeRoot, \{/);
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
  assert.doesNotMatch(server, /promptTextFromSeedanceBlock/);
  assert.doesNotMatch(server, /enforceVideoPromptCinematicRules/);
  assert.doesNotMatch(server, /fencedTextFromSectionBody/);
  assert.doesNotMatch(server, /modelVideoPrompt/);
  assert.match(server, /模型导演设计缺失或已过期，请重新生成分镜草稿后再生成视频配置。/);
  assert.match(server, /function isSeedanceNaturalLanguageShotPrompt\(/);
  assert.match(server, /if \(isSeedanceNaturalLanguageShotPrompt\(text\)\) return sanitizeSeedancePromptForPolicy\(text\);/);
  assert.match(server, /绝不能作为 Seedance 视频提示词提交/);
}

// 提示词输出始终以模型导演 design 为唯一镜头语法来源；Production Board 只增加板面
// 构图与节拍，不能退化为“读板 + 剧情动作 + 对白”的薄提示词。
{
  const { __test } = require(path.join(root, "server.js"));
  const promptApi = __test.videoPrompt;
  assert.equal(typeof promptApi.seedanceNaturalLanguagePromptForShot, "function");
  assert.equal(typeof promptApi.storyboardSeedancePrompt, "function");
  assert.equal(typeof promptApi.cleanVideoPromptForSubmission, "function");
  assert.equal(typeof promptApi.videoStyleDirectiveFromProductionAssets, "function");

  const styleDirective = promptApi.videoStyleDirectiveFromProductionAssets([
    { globalStyle: "恶搞之家式美式电视动画：粗黑描边、平涂色块、低饱和暖色调。" },
  ]);
  assert.match(styleDirective, /恶搞之家/, "资产文案中明确的风格必须进入视频风格来源");

  const assetLookup = new Map([
    ["C001_VIVIENNE", { name: "C001_VIVIENNE", label: "Vivienne", manifestType: "Character" }],
    ["S001_CARRIAGE", { name: "S001_CARRIAGE", label: "国王马车", manifestType: "Scene" }],
  ]);
  const shot = {
    name: "E01_V001",
    duration: 6,
    refs: ["C001_VIVIENNE", "S001_CARRIAGE"],
    assetLookup,
    videoStyleDirective: styleDirective,
    dialogues: [],
    videoDesign: completeDesign,
  };
  const prompt = promptApi.seedanceNaturalLanguagePromptForShot(shot, 0, "en");
  assert.match(prompt, /动作时间线：0-2 秒：Vivienne 咬住下唇/);
  assert.match(prompt, /2-4 秒：两人随马车颠簸/);
  assert.match(prompt, /4-6 秒：Vivienne 停住吞咽/);
  assert.match(prompt, /恶搞之家式美式电视动画/, "资产文案风格必须写进最终视频提示词");

  const boardPrompt = promptApi.storyboardSeedancePrompt({
    ...shot,
    storyboardRefs: ["SB001_CARRIAGE_PRODUCTION_BOARD"],
    storyboardGuidance: {
      panels: [
        { label: "P1", timeRange: "0-2 秒", description: "马车外侧建立空间", cameraFrame: "中远景平视" },
        { label: "P2", timeRange: "2-4 秒", description: "Vivienne 侧脸压低", actionArrow: "头部下沉" },
        { label: "P3", timeRange: "4-6 秒", description: "车轮碾过阴影", continuityExit: "切向车厢内" },
      ],
    },
  }, 0, "en", assetLookup);
  for (const field of ["景别：", "摄像机 / 镜头：", "运镜：", "机位视角：", "画面：", "动作时间线：", "人声 OS：", "人物台词：", "音效：", "故事板面板节拍："]) {
    assert.match(boardPrompt, new RegExp(field), `Production Board 提示词必须保留 ${field}`);
  }
  assert.equal(promptApi.cleanVideoPromptForSubmission(boardPrompt), boardPrompt, "清洗层不能压缩或改写已成型的故事板镜头语法");
}

console.log("seedance-director tests passed.");
