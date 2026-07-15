import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const server = require("../server.js");

const parser = server.__test?.assetParser;
assert.equal(typeof parser?.buildRuleAssets, "function", "asset parser test hook must expose buildRuleAssets");
assert.equal(typeof parser?.inferWorldProfile, "function", "asset parser test hook must expose inferWorldProfile");
assert.equal(typeof parser?.assetManifestFromAssets, "function", "asset parser test hook must expose assetManifestFromAssets");
assert.equal(typeof parser?.correctAssetRolesFromEvidence, "function", "asset parser test hook must expose correctAssetRolesFromEvidence");
assert.equal(typeof parser?.enforceCharacterProfileAssets, "function", "asset parser test hook must expose enforceCharacterProfileAssets");

const blackHarborScript = `
杰克·沃尔夫 Jack Wolfe
人类男性，前特种部队队长，地下拳场冠军。

薇薇安·凯恩 Vivian Kane
人类女性，半机械改造狙击手，前顶级杀手，现黑市赏金猎人。

火药桶 Buck
完整拟人化狼人，武器专家，爆破狂人。灰黑毛发，狼头狼爪狼尾，穿战术背心。

奥斯卡 Oscar
完整拟人化红狐狸，情报贩子，赌场老千，精神系能力者。

女指挥官
秘密行动部门负责人，52岁欧美女性，银灰短发，黑色西装。

格兰特博士
伊甸实验室创始人，疯狂科学家兼直播节目的幕后导演。

第1集：暴雨高架桥

【场景】黑港城 · 深夜 · 暴雨高架桥
一辆黑色重型装甲押运车在桥上飞驰。

【场景】押运车内
杰克·沃尔夫坐在右侧长椅上，双手被重型手铐锁住。

【场景】高架桥外部
一条巨大的紫黑色触手从桥下猛地甩上来。车外，一个巨大的变异章鱼怪从高架桥下方爬上来。

【场景】黑港城 · 秘密指挥室
女指挥官按下红色按钮。屏幕上快速弹出黑名单三人档案。
`;

const worldProfile = parser.inferWorldProfile(blackHarborScript);
const result = parser.buildRuleAssets(blackHarborScript, worldProfile);
const correctedAssets = parser.enforceCharacterProfileAssets(parser.correctAssetRolesFromEvidence(result.assets), blackHarborScript, worldProfile);
const labels = correctedAssets.map((asset) => `${asset.type}:${asset.label}`);
const manifestLabels = parser
  .assetManifestFromAssets({
    title: "Black Harbor regression",
    script: blackHarborScript,
    worldProfile,
    assets: correctedAssets,
    analyzerResult: { ok: false, model: "rules", reason: "test" },
    modelName: "rules",
  })
  .items.map((asset) => `${asset.type}:${asset.label}`);

const audioCueScript = `
【场景】宅·厨房
女声（耳麦·失真）：快跑。
音效：耳麦·失真。
`;
const audioCueWorldProfile = parser.inferWorldProfile(audioCueScript);
const audioCueManifestLabels = parser
  .assetManifestFromAssets({
    title: "Audio cue regression",
    script: audioCueScript,
    worldProfile: audioCueWorldProfile,
    assets: parser.correctAssetRolesFromEvidence([
      { type: "Character", name: "C001_女声_CHARACTER_SHEET", label: "女声", evidence: "女声（耳麦·失真）：快跑。", visual: "voice over comms" },
      { type: "Character", name: "C002_宅_厨房_CHARACTER_SHEET", label: "宅·厨房", evidence: "【场景】宅·厨房", visual: "interior kitchen" },
      { type: "Character", name: "C003_耳麦_失真_CHARACTER_SHEET", label: "耳麦·失真", evidence: "音效：耳麦·失真", visual: "distorted headset audio" },
    ]),
    analyzerResult: { ok: false, model: "rules", reason: "test" },
    modelName: "rules",
  })
  .items.map((asset) => `${asset.type}:${asset.label}`);

assert(!labels.some((label) => /新港市|地铁|metro|subway/i.test(label)), "Black Harbor script must not inherit Newport City metro assets");
for (const expected of [
  "Scene:黑港城 深夜 暴雨高架桥",
  "Scene:押运车内",
  "Scene:黑港城 秘密指挥室",
  "Prop:黑色重型装甲押运车",
  "Prop:重型手铐",
  "Insert:红色释放按钮",
  "Character:变异章鱼怪",
]) {
  assert(labels.includes(expected), `missing parsed asset: ${expected}\nActual labels:\n${labels.join("\n")}`);
  assert(manifestLabels.includes(expected), `manifest dropped parsed asset: ${expected}\nManifest labels:\n${manifestLabels.join("\n")}`);
}

assert(audioCueManifestLabels.includes("Scene:宅·厨房"), `kitchen heading must be a scene\nManifest labels:\n${audioCueManifestLabels.join("\n")}`);
assert(!audioCueManifestLabels.some((label) => /^Character:/.test(label)), `audio cues must not become character assets\nManifest labels:\n${audioCueManifestLabels.join("\n")}`);
assert(!audioCueManifestLabels.some((label) => /女声|耳麦·失真/.test(label)), `voice/audio cues must not become visual assets\nManifest labels:\n${audioCueManifestLabels.join("\n")}`);

console.log("asset parser regression tests passed.");
