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
assert.equal(typeof parser?.mergeAnalyzerAssets, "function", "asset parser test hook must expose mergeAnalyzerAssets");
assert.equal(typeof parser?.isModelAssetLabelUsable, "function", "asset parser test hook must expose isModelAssetLabelUsable");
assert.equal(typeof parser?.mergeTypedAnalyzerResults, "function", "asset parser test hook must expose mergeTypedAnalyzerResults");

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

const unrelatedAftermathScript = `
【场景】废弃工厂·深夜
暴雨后的厂房一片狼藉，地面留有深色血腥味和散落的金属零件。
主角沿着生产线寻找出口。
`;
const unrelatedAftermathAssets = parser.buildRuleAssets(
  unrelatedAftermathScript,
  parser.inferWorldProfile(unrelatedAftermathScript),
).assets;
assert(
  !unrelatedAftermathAssets.some((asset) => /地铁|车厢|隧道|列车/.test(asset.label)),
  `non-metro aftermath must not create a metro scene\nActual assets:\n${unrelatedAftermathAssets.map((asset) => `${asset.type}:${asset.label}`).join("\n")}`,
);

const metroAftermathScript = `
列车驶入地铁隧道后，车厢里发生灾变，狼藉不堪，空气里有浓烈血腥味。
`;
const metroAftermathAssets = parser.buildRuleAssets(
  metroAftermathScript,
  parser.inferWorldProfile(metroAftermathScript),
).assets;
assert(
  metroAftermathAssets.some((asset) => asset.type === "Scene" && /灾变后狼藉血腥的地铁车厢/.test(asset.label)),
  `metro aftermath should keep the derived metro scene\nActual assets:\n${metroAftermathAssets.map((asset) => `${asset.type}:${asset.label}`).join("\n")}`,
);

// 资产描述不是剧情剧本。用户只粘贴人物/场景/道具视觉说明时，旧规则会产出空数组，
// 导致解析结果混乱、缺项。结构化描述必须独立保留三类资产和完整视觉依据。
const assetDescriptionOnly = `
人物：林夏，27岁，短银发女法医，黑色风衣，左耳银色耳钉。
人物：顾沉，31岁，卷发刑警，深蓝夹克，眉骨有旧伤疤。
场景：废弃玻璃温室，暴雨深夜，破碎玻璃和积水，无人物。
场景：市局法医室，冷白灯，金属解剖台，无人物。
道具：带血的黄铜怀表，表盖刻着海鸥图案。
道具：密封证物袋，内有黑色羽毛。
`;
const assetDescriptionAssets = parser.buildRuleAssets(
  assetDescriptionOnly,
  parser.inferWorldProfile(assetDescriptionOnly),
).assets;
for (const expected of [
  "Character:林夏",
  "Character:顾沉",
  "Scene:废弃玻璃温室",
  "Scene:市局法医室",
  "Prop:带血的黄铜怀表",
  "Prop:密封证物袋",
]) {
  assert(
    assetDescriptionAssets.some((asset) => `${asset.type}:${asset.label}` === expected),
    `asset-description-only input must retain ${expected}\nActual assets:\n${assetDescriptionAssets.map((asset) => `${asset.type}:${asset.label}`).join("\n")}`,
  );
}
assert(
  assetDescriptionAssets.find((asset) => asset.label === "林夏")?.visual.includes("短银发女法医"),
  "structured character description must remain available as visual evidence",
);

const groupedAssetDescription = `
【人物】
- 洛伊：红发女飞行员，旧皮夹克，护目镜挂在颈前。
【场景】
- 高空货运机驾驶舱：黎明云海，模拟仪表泛蓝光，无人物。
【道具】
- 裂纹飞行记录仪：钛金属外壳，屏幕显示失联航线。
`;
const groupedAssetLabels = parser
  .buildRuleAssets(groupedAssetDescription, parser.inferWorldProfile(groupedAssetDescription))
  .assets.map((asset) => `${asset.type}:${asset.label}`);
for (const expected of ["Character:洛伊", "Scene:高空货运机驾驶舱", "Prop:裂纹飞行记录仪"]) {
  assert(groupedAssetLabels.includes(expected), `grouped asset description must retain ${expected}\nActual assets:\n${groupedAssetLabels.join("\n")}`);
}

// 《囚日》项目使用编号分段和“名称（身份）”条目，不是“人物：名称”的简写格式。
// 这些资产必须在模型超时的本地兜底中仍被稳定分类，不能让单字角色掉进道具/插入镜头。
const qiuRiAssetDescription = `
一、主要人物
昼（男主 / 囚日之子）
年轻男性，黑色长发，暗红战袍，左臂有灼日裂纹。
绯（女主 / 血市引路人）
年轻女性，银白短发，深红斗篷，瞳孔有血金色反光。
家主肃（天阙家主）
中年男性，黑曜石冠冕，长袍带冷金刺绣。
阙（永夜舞厅主理人）
高挑女性，乌黑礼服，苍白面孔。

二、配角与单元人物
砾（灰渊线人）
瘦削少年，锈红护目镜，旧皮夹克。
灰渊新民（结局群像）
老血民、血民妇人、孩子与反抗残军混在日光下：颈侧留有编号疤，灰蓝粗麻衣。

三、场景
天阙 · 永夜舞厅
百尺黑曜石大厅，穹顶垂落灰幕，冷金吊灯，无人物。
血市 · 街衢
地下血市的狭窄街道，猩红灯笼和潮湿石板，无人物。
灰渊 · 底层街区
锈炉与废血泵站之间的底层居住区，蒸汽弥漫，无人物。
灰幕维护塔 · 外环
黑塔外环缠满半透明血税主管，冷白祭光从塔缝漏出，无人物。
灰幕维护塔 · 塔心
一整条竖向绞肉井：上方血税主管倒挂如脏红树根，中央机关环悬浮，无人物。
天阙残顶
碎裂灰幕悬成黑色断檐，俯瞰被日光打通的渊都，无人物。

四、关键道具
囚日之刃 / 开天刀
残缺长刀，黑铁刀身有熔金裂纹。
血契法印 / 法环 / 契纹
悬浮的暗红金属法环，内侧有血色纹路。
血税官器物
滴血形银质血税徽、金质抽血笏管、血玉算盘与袖口血税编号绣纹。
`;
const qiuRiRuleAssets = parser.buildRuleAssets(
  qiuRiAssetDescription,
  parser.inferWorldProfile(qiuRiAssetDescription),
).assets;
const qiuRiLabels = qiuRiRuleAssets.map((asset) => `${asset.type}:${asset.label}`);
for (const expected of [
  "Character:昼",
  "Character:绯",
  "Character:家主肃",
  "Character:阙",
  "Scene:天阙 · 永夜舞厅",
  "Scene:血市 · 街衢",
  "Scene:灰渊 · 底层街区",
  "Scene:灰幕维护塔 · 外环",
  "Scene:灰幕维护塔 · 塔心",
  "Scene:天阙残顶",
  "Prop:囚日之刃 / 开天刀",
  "Prop:血契法印 / 法环 / 契纹",
  "Prop:血税官器物",
]) {
  assert(qiuRiLabels.includes(expected), `《囚日》编号资产描述必须保留 ${expected}\nActual assets:\n${qiuRiLabels.join("\n")}`);
}
for (const character of ["昼", "绯", "家主肃", "阙", "砾"]) {
  assert(
    !qiuRiRuleAssets.some((asset) => asset.label === character && asset.type !== "Character"),
    `《囚日》人物 ${character} 不得被解析成道具或插入镜头\nActual assets:\n${qiuRiLabels.join("\n")}`,
  );
}
assert(
  !qiuRiRuleAssets.some((asset) => asset.label === "老血民、血民妇人、孩子与反抗残军混在日光下"),
  "《囚日》群像描述行不得误拆成独立人物",
);
assert(
  !qiuRiRuleAssets.some((asset) => asset.label === "一整条竖向绞肉井"),
  "《囚日》场景描述行不得误拆成独立场景",
);
const qiuRiCorrectedLabels = parser
  .enforceCharacterProfileAssets(
    parser.correctAssetRolesFromEvidence(qiuRiRuleAssets),
    qiuRiAssetDescription,
    parser.inferWorldProfile(qiuRiAssetDescription),
  )
  .map((asset) => `${asset.type}:${asset.label}`);
for (const expected of [
  "Character:昼",
  "Character:绯",
  "Character:家主肃",
  "Character:阙",
  "Scene:天阙 · 永夜舞厅",
  "Scene:血市 · 街衢",
  "Scene:灰渊 · 底层街区",
  "Scene:灰幕维护塔 · 外环",
  "Scene:灰幕维护塔 · 塔心",
  "Scene:天阙残顶",
  "Prop:囚日之刃 / 开天刀",
  "Prop:血契法印 / 法环 / 契纹",
  "Prop:血税官器物",
]) {
  assert(
    qiuRiCorrectedLabels.includes(expected),
    `《囚日》用户明确分类不得被后续纠偏改错 ${expected}\nActual assets:\n${qiuRiCorrectedLabels.join("\n")}`,
  );
}
assert(
  !qiuRiCorrectedLabels.includes("Character:血税官器物"),
  "《囚日》明确列为关键道具的血税官器物不得被人物补偿逻辑加回 Character",
);

// 解析出的资产还要经过 manifest 正规化。这里不能重新使用老的“人物名至少两个字”
// 校验，否则昼、绯、阙、砾虽在规则层分类正确，落盘时仍会被静默删除。
const qiuRiManifestCharacterLabels = parser
  .assetManifestFromAssets({
    title: "QiuRi manifest regression",
    script: qiuRiAssetDescription,
    worldProfile: parser.inferWorldProfile(qiuRiAssetDescription),
    assets: qiuRiRuleAssets,
    analyzerResult: { ok: false, model: "rules", reason: "test" },
    modelName: "rules",
  })
  .items.filter((asset) => asset.type === "Character")
  .map((asset) => asset.label);
for (const character of ["昼", "绯", "家主肃", "阙", "砾", "灰渊新民"]) {
  assert(
    qiuRiManifestCharacterLabels.includes(character),
    `《囚日》人物 ${character} 不得在写入资产清单时被二次删除\n实际保留:${qiuRiManifestCharacterLabels.join("、")}`,
  );
}

const deepVaultDescription = `
三、场景
天阙 · 凛冬封库
深藏地底的血契法库，入口是一道血契法阵门，冷白法光从顶缝垂落，无人物。
`;
const deepVaultLabels = parser
  .buildRuleAssets(deepVaultDescription, parser.inferWorldProfile(deepVaultDescription))
  .assets.map((asset) => `${asset.type}:${asset.label}`);
assert(
  !deepVaultLabels.some((label) => /藏地扎西岗/.test(label)),
  `“深藏地底”不得误触发藏地默认场景\nActual assets:\n${deepVaultLabels.join("\n")}`,
);

const qiuRiWrongTypeModel = {
  ok: true,
  model: "regression-model",
  data: {
    characters: [],
    scenes: [],
    props: [
      {
        sourceId: qiuRiRuleAssets.find((asset) => asset.label === "昼")?.name,
        type: "Prop",
        label: "昼",
        evidence: "昼（男主 / 囚日之子）",
        visual: "错误分类的模型输出",
        textToImagePrompt: "a prop reference",
      },
    ],
  },
};
const qiuRiWrongTypeMerged = parser.mergeAnalyzerAssets(
  qiuRiRuleAssets,
  qiuRiWrongTypeModel,
  parser.inferWorldProfile(qiuRiAssetDescription),
  qiuRiAssetDescription,
);
assert(
  qiuRiWrongTypeMerged.some((asset) => asset.type === "Character" && asset.label === "昼"),
  "用户明确列在人物分段的昼必须保持 Character",
);
assert(
  !qiuRiWrongTypeMerged.some((asset) => asset.type === "Prop" && asset.label === "昼"),
  "模型错误分类不能额外新增 Prop:昼",
);

// 模型为准回归:模型 ok 时,单字名(昼/绯/阙/砾)和含"夜/场景词"的人物不得被本地闸门丢弃。
// 这是"十几个人物只解析出1个"的根治点——曾因 isValidCharacterLabel 要求中文名2-8字 + 证据校验硬否决而丢失。
const shadowNames = ["昼", "绯", "家主肃", "阙", "独眼侍从", "砾", "普通血税官夜主"];
const shadowAnalyzer = {
  ok: true,
  model: "claude-opus-4-8",
  data: {
    characters: shadowNames.map((label) => ({
      label,
      visual: `${label}的完整视觉描述:服装、体型、神态、外观识别色`,
      textToImagePrompt: `a detailed character sheet of ${label}, full body three views, pure white background, cinematic realistic`,
    })),
    scenes: [],
    props: [],
  },
};
const shadowMerged = parser.mergeAnalyzerAssets([], shadowAnalyzer, {}, "剧本正文较短，未必包含全部人物名");
const shadowChars = shadowMerged.filter((a) => a.type === "Character").map((a) => a.label);
for (const name of shadowNames) {
  assert(shadowChars.includes(name), `模型为准:人物「${name}」不得被本地闸门丢弃\n实际保留:${shadowChars.join("、")}`);
}

// 垃圾防护仍在:纯 production 字段名/空/纯标点不得被当资产 label。
assert.equal(parser.isModelAssetLabelUsable("画面"), false, "纯字段名'画面'应被挡");
assert.equal(parser.isModelAssetLabelUsable("灯光"), false, "纯字段名'灯光'应被挡");
assert.equal(parser.isModelAssetLabelUsable(""), false, "空 label 应被挡");
assert.equal(parser.isModelAssetLabelUsable("昼"), true, "单字名'昼'应通过");

// 分批解析合并回归:整份文档一次解析常超时(200-300s)→ 回退傻规则把单字名乱塞进道具。
// 拆成人物/场景/道具三个小请求并行,mergeTypedAnalyzerResults 合并,部分成功也可用(人物最关键)。
{
  const all = parser.mergeTypedAnalyzerResults([
    { focus: "人物 characters", ok: true, data: { world: "囚日", characters: [{ label: "昼" }, { label: "绯" }], scenes: [], props: [] } },
    { focus: "场景 scenes", ok: true, data: { characters: [], scenes: [{ label: "血税堂" }], props: [] } },
    { focus: "道具/插入 props", ok: true, data: { characters: [], scenes: [], props: [{ label: "半柄囚日" }] } },
  ]);
  assert(all.data.characters.length === 2 && all.data.scenes.length === 1 && all.data.props.length === 1 && all.data.world === "囚日", "三类全成功应合并齐全");

  const partial = parser.mergeTypedAnalyzerResults([
    { focus: "人物 characters", ok: true, data: { characters: [{ label: "昼" }], scenes: [], props: [] } },
    { focus: "场景 scenes", ok: false, reason: "超时" },
    { focus: "道具/插入 props", ok: true, data: { characters: [], scenes: [], props: [{ label: "血玉" }] } },
  ]);
  assert(partial.data.characters.length === 1 && partial.data.scenes.length === 0 && partial.failed.length === 1, "场景超时时人物/道具仍保留,失败被记录");

  const none = parser.mergeTypedAnalyzerResults([
    { focus: "人物 characters", ok: false, reason: "超时" },
    { focus: "场景 scenes", ok: false, reason: "超时" },
    { focus: "道具/插入 props", ok: false, reason: "超时" },
  ]);
  assert(none.succeeded.length === 0 && none.failed.length === 3, "三类全失败应无成功项");
}

console.log("asset parser regression tests passed.");
