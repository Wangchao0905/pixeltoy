import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");

assert.match(html, /id="canvasAgentPanel"/);
assert.match(html, /id="canvasAgentAttachments"/);
assert.match(html, /id="canvasAgentImageUpload"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
assert.match(css, /\.canvas-agent-composer\.is-dragover/);
assert.match(css, /\.canvas-agent-attachment/);
assert.match(canvas, /conversationImages:\s*canvasAgentConversationImages\(\)/);
assert.match(canvas, /application\/x-pixel-toys-canvas-agent-image/);
assert.match(canvas, /function ensureCanvasAgentReferenceAsset/);
assert.match(canvas, /referenceImages/);
assert.match(canvas, /const CANVAS_AGENT_MAX_ATTACHMENTS = 8/);
assert.match(canvas, /URL\.createObjectURL\(file\)/, "Canvas Agent 必须先使用本地 blob 显示即时预览");
assert.match(canvas, /Promise\.all\(jobs\.map/, "Canvas Agent 图片上传必须并行执行");
assert.match(canvas, /localOnly: true/, "Canvas Agent 参考图上传应先走本地快速存储");
assert.match(canvas, /参考图仍在上传，请稍候/, "上传未完成时不得提交 Agent 请求");

const require = createRequire(import.meta.url);
const { __test } = require(path.join(root, "server.js"));
const agent = __test.canvasAgent;
const messages = agent.messages([{
  role: "user",
  content: [
    { type: "text", text: "分析这张图" },
    { type: "image_url", image_url: { url: "/public-assets/reference.png" } },
  ],
}]);
assert.equal(Array.isArray(messages[0].content), true, "Canvas Agent 必须保留多模态消息");
assert.equal(messages[0].content[1].type, "image_url");

const handles = [{ handle: "image_1", url: "/public-assets/reference.png", name: "参考图.png", source: "canvas-asset" }];
assert.match(agent.systemPrompt(agent.context({ name: "测试画布", assets: [], nodes: [], connections: [] }), handles), /image_1.*参考图\.png/s);
const context = { nodes: [], connections: [] };
const created = agent.action(context, "create_node", { kind: "video", referenceImages: ["image_1"], prompt: "保持参考图中的角色" });
assert.deepEqual(created.action.node.referenceImages, ["image_1"]);
assert.equal(created.action.node.prompt, "保持参考图中的角色");

console.log("canvas agent image drop tests passed");
