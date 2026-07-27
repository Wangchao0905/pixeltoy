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
assert.match(html, /value="grok-imagine-image"/, "出图模型选择必须提供 grok-imagine-image");
assert.match(html, /value="grok-imagine-video"/, "出片模型选择必须提供 grok-imagine-video");

assert.match(server, /const SUPER_PIXEL_GROK_MODELS = new Set\(\["grok-4\.5", "grok-4\.5-latest", "grok-4\.3"\]\)/);
assert.match(server, /apiKey: process\.env\.XAI_API_KEY, kind: "grok"/);
assert.match(server, /grok-imagine-image/);
assert.match(server, /response_format: "b64_json"/);
assert.match(server, /grok-imagine-video/);
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
assert.match(imageTool, /"grok-imagine-image"/, "Agent 出图工具必须允许 Grok");
assert.match(videoTool, /"grok-imagine-video"/, "Agent 出片工具必须允许 Grok");
assert.match(app, /status === "confirming"/, "出片确认卡必须保留 confirming 状态");

const require = createRequire(import.meta.url);
const { __test } = require(path.join(root, "server.js"));
const grokImagePayload = __test.canvasImage.grokImagePayload({ prompt: "red circle" });
assert.deepEqual(grokImagePayload, {
  model: "grok-imagine-image",
  prompt: "red circle",
  response_format: "b64_json",
});
assert.equal("size" in grokImagePayload, false, "未验证生效前不得向 Grok 出图暴露 size");
assert.equal("aspect_ratio" in grokImagePayload, false, "未验证生效前不得向 Grok 出图暴露 aspect_ratio");

const grokVideoPayload = __test.canvasVideo.grokVideoPayload({
  prompt: "product rotates",
  duration: 5,
  ratio: "9:16",
  referenceUrl: "https://assets.example/product.png",
});
assert.deepEqual(grokVideoPayload, {
  model: "grok-imagine-video",
  prompt: "product rotates",
  duration: 5,
  aspect_ratio: "9:16",
  image: { url: "https://assets.example/product.png" },
});
assert.equal("image_url" in grokVideoPayload, false, "Grok 出片不得发送会被忽略的 image_url 字段");

console.log("grok integration tests passed");
