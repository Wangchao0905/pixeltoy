import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.equal(
  typeof __test.videoVerification?.arkPersonReferenceNames,
  "function",
  "真人验证开关需要暴露引用选择逻辑供回归测试",
);

assert.equal(
  __test.assetParser.documentStyleIsNonPhotoreal("插画师的职业气质"),
  false,
  "人物职业描述不能被误判为二维插画风格",
);
assert.equal(
  __test.assetParser.documentStyleIsNonPhotoreal("二维插画风格，赛璐璐上色"),
  true,
  "明确的二维插画风格仍需保留非真人约束",
);
assert.doesNotMatch(
  __test.videoPrompt.videoStyleDirectiveFromProductionAssets([
    { globalStyle: "插画师的职业气质" },
  ]),
  /插画师的职业气质/u,
  "单个资产的职业描述不能升级为全片视频风格",
);
assert.doesNotMatch(
  __test.videoPrompt.stripInvalidLegacyVideoStyleLock([
    "视觉风格：插画师的职业气质",
    "视觉风格硬约束：必须保持上述二维/卡通/动画风格；禁止超写实、真人摄影、照片质感、写实皮肤与写实材质，禁止 3D、CG、游戏角色渲染、PBR、景深虚化和电影级写实打光。",
    "镜号 1（4 秒）",
  ].join("\n")),
  /插画师的职业气质|视觉风格硬约束/u,
  "历史错误风格锁必须在读取配置时被清除",
);
const migratedStyle = __test.videoPrompt.migrateInvalidVideoStyleLocks({
  assets: [{ globalStyle: "插画师的职业气质" }],
  shots: [{
    videoStyleDirective: "插画师的职业气质",
    prompt: "画面：视觉风格：插画师的职业气质 人物站在窗前\n视觉风格硬约束：必须保持上述二维/卡通/动画风格；禁止超写实、真人摄影。",
  }],
});
assert.equal(migratedStyle.data.assets[0].globalStyle, "", "历史资产职业字段必须从全局风格中清除");
assert.equal(migratedStyle.data.shots[0].videoStylePreset, "photoreal", "受污染镜头必须恢复真人实拍预设");
assert.match(migratedStyle.data.shots[0].prompt, /真人电影实拍质感/u, "受污染镜头必须写入真人实拍约束");
assert.doesNotMatch(migratedStyle.data.shots[0].prompt, /插画师的职业气质|视觉风格硬约束/u, "行内旧风格和硬约束也必须被清除");

const assets = [
  { name: "SB001_BOARD", manifestType: "Storyboard", url: "https://cdn.example.com/board.png" },
  { name: "C001_HERO", manifestType: "Character", url: "https://cdn.example.com/hero.png" },
  { name: "S001_STREET", manifestType: "Scene", url: "https://cdn.example.com/street.png" },
  { name: "P001_LAMP", manifestType: "Prop", url: "https://cdn.example.com/lamp.png" },
];
const enabledConfig = {
  modelName: "seedance-2-0",
  settings: { enableRealPersonVerification: true },
  assets,
};

assert.deepEqual(
  __test.videoVerification.arkPersonReferenceNames("", enabledConfig, assets.map((asset) => asset.name)),
  ["C001_HERO"],
  "开启真人验证后，只有人物图进入火山认证；故事板、场景与道具必须保持普通参考图路径",
);
assert.deepEqual(
  __test.videoVerification.arkPersonReferenceNames("", { ...enabledConfig, modelName: "grok-imagine-video" }, assets.map((asset) => asset.name)),
  [],
  "非火山 Ark 视频模型不得启动火山真人素材认证",
);

const original = {
  modelName: "seedance-2-0",
  settings: { ratio: "16:9", resolution: "720p", enableRealPersonVerification: false },
  shots: [{ name: "V001", prompt: "镜头" }],
};
const enabled = __test.videoSettings.updateVideoSettingsInConfig(original, { enableRealPersonVerification: true });
assert.equal(enabled.settings.enableRealPersonVerification, true, "开关必须保存到视频设置");
assert.equal(original.settings.enableRealPersonVerification, false, "设置更新不得修改旧配置对象");

assert.equal(
  typeof __test.videoVerification?.applyRequestedRealPersonVerification,
  "function",
  "视频提交必须能用当前开关值覆盖尚未落盘的旧设置",
);
const requestRecord = { data: original };
const requestConfig = __test.videoVerification.applyRequestedRealPersonVerification(requestRecord, {
  enableRealPersonVerification: true,
});
assert.equal(
  requestConfig.settings.enableRealPersonVerification,
  true,
  "用户已开启真人验证时，提交视频不能继续使用旧的 false 配置",
);
assert.equal(
  requestRecord.data.settings.enableRealPersonVerification,
  true,
  "提交路径必须把当前开关值写回配置，供认证队列和后续片段复用",
);

assert.match(html, /id="modernRealPersonVerification"/, "视频参数区域必须显示真人验证开关");
assert.match(app, /enableRealPersonVerification/, "前端必须将真人验证状态写入视频设置接口");
assert.match(
  app,
  /video-generate[\s\S]*?enableRealPersonVerification:/,
  "单片段提交必须携带当前真人验证开关，不能只依赖异步设置保存",
);
assert.match(
  app,
  /video-generate-all[\s\S]*?enableRealPersonVerification:/,
  "批量提交必须携带当前真人验证开关，不能只依赖异步设置保存",
);
assert.match(server, /function scheduleProjectRealPersonVerification\(/, "开启开关后必须立即启动人物素材认证");
assert.match(server, /scheduleProjectRealPersonVerification\(episodeRoot, configRecord\)/, "视频设置接口必须在开启真人验证后启动后台认证");

console.log("video real-person verification tests passed");
