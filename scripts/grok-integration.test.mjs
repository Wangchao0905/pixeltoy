import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

const superPixelSelect = html.match(/<select id="superPixelModel"[\s\S]*?<\/select>/)?.[0] || "";
assert.match(superPixelSelect, /value="grok-4\.5"/, "Super Pixel 必须提供 grok-4.5");
assert.match(html, /value="grok-imagine-image-quality"[^>]*>Grok image<\/option>/, "出图模型选择必须使用 Grok image quality 模型并保持展示名称");
assert.match(html, /value="grok-imagine-video"/, "出片模型选择必须提供 grok-imagine-video");

assert.match(server, /const SUPER_PIXEL_GROK_MODELS = new Set\(\["grok-4\.5", "grok-4\.5-latest", "grok-4\.3"\]\)/);
assert.match(server, /apiKey: process\.env\.XAI_API_KEY, kind: "grok"/);
assert.match(server, /grok-imagine-image-quality/);
assert.match(server, /const GROK_IMAGE_PROVIDER_MODEL = "grok-imagine-image-quality"/);
assert.match(server, /grok-imagine-video-1\.5-preview/);
assert.match(server, /grokVideoApiUrl/);
assert.match(server, /callGrokVideoJson/);
assert.match(server, /payload\.image = \{ url: referenceUrl \}/);
assert.match(server, /\/v1\/videos\/\$\{encodeURIComponent\(cleanTaskId\)\}\/content/);
// 视频 content 是需鉴权的相对路径，不带 Authorization 会拿到 401 空响应
const videoDownload = server.match(/\/v1\/videos\/\$\{encodeURIComponent\(cleanTaskId\)\}\/content[\s\S]{0,200}/)?.[0] || "";
assert.match(videoDownload, /Authorization: `Bearer \$\{key\}`/, "视频下载必须带 Authorization 头");
assert.match(server, /provider === "grok"/);
assert.match(server, /process\.env\.XAI_API_KEY/);
assert.doesNotMatch(server, /XAI_API_KEY\s*=\s*["'`]sk-/);

const imageTool = server.match(/name: "generate_image"[\s\S]*?\n  \},\n  \{/i)?.[0] || "";
const videoTool = server.match(/name: "generate_video"[\s\S]*?\n  \},\n  \{/i)?.[0] || "";
assert.match(imageTool, /"grok-imagine-image-quality"/, "Agent 出图工具必须允许 Grok image quality");
assert.match(videoTool, /"grok-imagine-video"/, "Agent 出片工具必须允许 Grok");
assert.match(app, /status === "confirming"/, "出片确认卡必须保留 confirming 状态");
assert.match(app, /Grok Imagine Video 1\.5 Preview · \$0\.0706\/秒起/, "新 Grok 视频模型必须显示截图中的起价");

const require = createRequire(import.meta.url);
const { __test } = require(path.join(root, "server.js"));
const grokImageConfig = __test.canvasImage.canvasImageModelConfig("grok-imagine-image-quality");
assert.equal(grokImageConfig.provider, "gpt", "Grok image quality 必须复用 Nano Banana 的图片 API provider");
assert.equal(grokImageConfig.supportsSize, true, "Grok image quality 必须复用 Nano Banana 的尺寸参数");
assert.equal(__test.canvasImage.canvasImageBaseUrl("grok-imagine-image-quality"), process.env.PIXEL_TOYS_IMAGE_N1N_BASE_URL || "https://llm-api.net/v1", "Grok image quality 必须使用 n1n 图片网关");
assert.equal(__test.canvasImage.isN1nGateway("https://llm-api.net/v1"), true, "服务端必须识别 n1n 网关，避免不安全重试");
assert.equal(__test.canvasImage.isN1nGateway("https://example.com/v1"), false, "服务端不应把其他网关误判为 n1n");
const createImageSource = server.slice(server.indexOf("async function createCanvasImageGeneration"), server.indexOf("function drainCanvasImageQueue"));
assert.doesNotMatch(createImageSource, /else if \(modelConfig\.provider === "grok"\)/, "Grok image quality 不得进入 XAI 专用创建分支");
const grokImagePayload = __test.canvasImage.grokImagePayload({ prompt: "red circle" });
assert.deepEqual(grokImagePayload, {
  model: "grok-imagine-image-quality",
  prompt: "red circle",
  size: "960x960",
});
assert.equal("response_format" in grokImagePayload, false, "Grok 文档未声明 response_format，不得发送该参数");
assert.equal(__test.canvasImage.grokImageSizeFor("16:9"), "1280x720", "Grok 横向出图必须使用文档支持的 1280x720");
assert.equal(__test.canvasImage.grokImageSizeFor("9:16"), "720x1280", "Grok 竖向出图必须使用文档支持的 720x1280");
assert.equal(__test.canvasImage.grokImageSizeFor("1:1"), "960x960", "Grok 方形出图必须使用文档支持的 960x960");
assert.equal(__test.canvasImage.grokImageSizeFor("3:2"), "1168x784", "Grok 横向非标准比例必须映射到文档支持尺寸而不是强裁切");
assert.equal(__test.canvasImage.grokImageSizeFor("2:3"), "784x1168", "Grok 竖向非标准比例必须映射到文档支持尺寸而不是强裁切");
assert.equal(__test.canvasImage.canvasImageModelConfig("grok-imagine-image-quality").model, "grok-imagine-image-quality", "Grok image 必须调用当前 key 实际暴露的 quality 模型 ID");
assert.match(server, /const isGrokImage = modelConfig\.key === "grok-imagine-image-quality"[\s\S]*?normalizeOutput:\s*supportsSize && !isGrokImage/, "Grok 原生比例不能再经过中心裁切");
assert.equal(__test.canvasImage.normalizeCanvasImageModel("grok-imagine-image"), "grok-imagine-image-quality", "旧 Grok image 草稿必须归一化到 quality 模型");
assert.equal(__test.canvasImage.canvasImageModelConfig("grok-imagine-image").model, "grok-imagine-image-quality", "旧 Grok image 请求必须实际调用当前可用模型 ID");
assert.equal(
  __test.canvasImage.classifyImageGenError('{"detail":{"status":503,"body":"grok-3-image 无可用渠道 (distributor)"}}'),
  "图片模型当前没有可用渠道：请在网关为该模型开通渠道，或切换到可用分组后重试。",
  "无可用渠道错误必须收敛为可操作提示，不能把网关分组列表原样展示给用户",
);
assert.match(server, /normalizeCanvasImageModel\(value\)[\s\S]*?grok-imagine-image-quality/);
assert.doesNotMatch(html, /value="grok-imagine-image"/);

const grokVideoPayload = __test.canvasVideo.grokVideoPayload({
  prompt: "product rotates",
  duration: 5,
  ratio: "9:16",
  resolution: "720p",
  referenceUrl: "https://assets.example/product.png",
});
assert.deepEqual(grokVideoPayload, {
  model: "grok-imagine-video-1.5-preview",
  prompt: "product rotates",
  duration: 5,
  aspect_ratio: "9:16",
  resolution: "720p",
  image: { url: "https://assets.example/product.png" },
});
assert.equal("image_url" in grokVideoPayload, false, "Grok 出片不得发送会被忽略的 image_url 字段");
assert.equal(__test.canvasVideo.grokVideoApiUrl("/v1/videos/generations"), "https://llm-api.net/v1/videos/generations");

console.log("grok integration tests passed");
