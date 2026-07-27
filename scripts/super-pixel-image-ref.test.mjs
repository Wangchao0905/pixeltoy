import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const { __test } = createRequire(import.meta.url)(path.join(root, "server.js"));
const sp = __test.superPixel;

const images = [
  { url: "data:image/png;base64,iVBORw0KGgo=", name: "商品图.png", source: "local" },
  { url: "https://assets.example/product.png", name: "资产库商品", source: "asset-library" },
];
const handles = sp.referenceHandles(images);
assert.deepEqual(handles.map((item) => item.handle), ["image_1", "image_2"], "参考图句柄必须按输入顺序分配");
assert.match(sp.agentPrompt("", handles), /image_1.*用户上传.*商品图\.png/s, "Agent 提示词必须列出参考图句柄和来源");
assert.match(sp.agentPrompt("", handles), /image_2.*资产库.*资产库商品/s, "Agent 提示词必须列出资产库参考图");

const resolved = await sp.resolveReferences(["image_1"], handles);
assert.equal(resolved.length, 1, "句柄必须解析成一张参考图");
assert.ok(resolved[0].url, "解析结果必须有 URL");
assert.doesNotMatch(resolved[0].url, /^data:/i, "工具结果不得把 data URL 带回前端");
assert.match(resolved[0].url, /\/public-assets\//, "data URL 必须先落盘为稳定 public-assets URL");

await assert.rejects(
  sp.resolveReferences(["image_9"], handles),
  /参考图句柄 image_9 无法解析/,
  "未知句柄必须明确报错，不得静默丢图",
);
const toolEvents = [];
const toolSummary = await sp.executeTool({
  req: {},
  context: { userId: "test-user", conversationImageHandles: handles },
  callId: "call-invalid-ref",
  name: "generate_video",
  rawArguments: JSON.stringify({ prompt: "产品广告", referenceImages: ["image_9"] }),
  emit: (event) => toolEvents.push(event),
});
assert.match(toolSummary, /参考图句柄 image_9 无法解析/, "句柄解析错误必须返回给模型工具回路");
assert.match(toolEvents.at(-1)?.toolResult?.summary || "", /参考图句柄 image_9 无法解析/, "句柄解析错误必须通过 toolResult 喂回模型");

assert.match(server, /conversationImages/, "服务端必须接收对话参考图清单");
assert.match(server, /referenceImages: \{ type: "array"[\s\S]*maxItems: 9/, "视频工具必须允许最多 9 张参考图");
assert.match(app, /conversationImages/, "前端必须提交对话参考图清单");
assert.match(app, /assets:[\s\S]*referenceImages/, "视频确认必须把参考图转换为 assets");
assert.match(app, /thumbnailUrl/, "确认卡必须使用参考图缩略图");

console.log("super pixel image reference tests passed");
