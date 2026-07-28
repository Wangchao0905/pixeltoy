// 回归:只有明确标记为 AI 生成的超写实人物才进人像库；
// 卡通/CG 角色、道具/场景和手动导入图都走普通公网参考图。
const assert = require("node:assert/strict");
const { __test } = require("../server.js");
const { isArkPersonEligibleAsset, isCharacterRefAsset, isCanvasPhotorealAsset } = __test.arkVirtualPerson;

// 角色命名判定
assert.equal(isCharacterRefAsset({ name: "C001_DYLAN_CHARACTER_SHEET" }), true, "C\\d{3}_ 角色");
assert.equal(isCharacterRefAsset({ name: "某角色_CHARACTER_SHEET" }), true, "_CHARACTER_SHEET 角色");
assert.equal(isCharacterRefAsset({ manifestType: "Character", name: "任意" }), true, "声明 Character");
assert.equal(isCharacterRefAsset({ name: "P004_带消音器的手枪_PROP_REF" }), false, "道具非角色");
assert.equal(isCharacterRefAsset({ name: "S002_厨房_WIDE_ESTABLISHING" }), false, "场景非角色");

// 进人像库资格:AI 生成 + (写实 或 角色)
const aiChar = { name: "C001_DYLAN_CHARACTER_SHEET", aiGenerated: true };
const aiCharStylized = { name: "C002_NANA_CHARACTER_SHEET", source: "image-generation", assetStyleLabel: "皮克斯 3D" };
const aiPhotoreal = { name: "anything", aiGenerated: true, assetStylePreset: "photoreal" };
const manualChar = { name: "C003_X_CHARACTER_SHEET" }; // 无 AI 标记 = 手动导入
const aiProp = { name: "P004_手枪_PROP_REF", aiGenerated: true };
const aiScene = { name: "S002_厨房_WIDE_ESTABLISHING", aiGenerated: true };

assert.equal(isArkPersonEligibleAsset(aiChar), false, "未标记超写实的 AI 角色不可进");
assert.equal(isArkPersonEligibleAsset(aiCharStylized), false, "AI 风格化角色不可进");
assert.equal(isArkPersonEligibleAsset(aiPhotoreal), true, "AI 写实仍可进(原路径不变)");
assert.equal(isArkPersonEligibleAsset(manualChar), false, "手动导入角色不进(挡误收)");
assert.equal(isArkPersonEligibleAsset(aiProp), false, "AI 道具不进");
assert.equal(isArkPersonEligibleAsset(aiScene), false, "AI 场景不进");

// 写实判定未被牵连
assert.equal(isCanvasPhotorealAsset({ assetStylePreset: "photoreal" }), true);
assert.equal(isCanvasPhotorealAsset({ assetStyleLabel: "皮克斯 3D" }), false);

console.log("canvas Ark person-eligibility boundary tests passed.");
