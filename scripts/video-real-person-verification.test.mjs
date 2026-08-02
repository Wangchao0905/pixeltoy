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

assert.match(html, /id="modernRealPersonVerification"/, "视频参数区域必须显示真人验证开关");
assert.match(app, /enableRealPersonVerification/, "前端必须将真人验证状态写入视频设置接口");
assert.match(server, /function scheduleProjectRealPersonVerification\(/, "开启开关后必须立即启动人物素材认证");
assert.match(server, /scheduleProjectRealPersonVerification\(episodeRoot, configRecord\)/, "视频设置接口必须在开启真人验证后启动后台认证");

console.log("video real-person verification tests passed");
