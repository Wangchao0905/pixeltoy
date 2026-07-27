import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

process.env.ASSET_ANALYZER_API_KEY = "test-canvas-agent-asset-key";
process.env.STORYBOARD_API_KEY = "test-canvas-agent-storyboard-key";
process.env.XAI_API_KEY = "test-canvas-agent-grok-key";

const select = html.match(/<select id="canvasAgentModel"[\s\S]*?<\/select>/)?.[0] || "";
assert.deepEqual(
  [...select.matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]),
  ["claude-opus-5", "gpt-5.6-sol", "grok-4.5"],
  "Canvas Agent 只能展示三个指定模型",
);
assert.match(html, /id="canvasAgentInput"[^>]*placeholder=/);
assert.doesNotMatch(html, /canvasAgentInput[^>]*disabled/);
assert.doesNotMatch(html, /UI PREVIEW/);
assert.match(canvas, /fetch\("\/api\/canvas\/agent\/chat"/);
assert.match(server, /url\.pathname === "\/api\/canvas\/agent\/chat"/);

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const agent = __test.canvasAgent;
assert.deepEqual(agent.modelOptions.map((item) => item.id), ["claude-opus-5", "gpt-5.6-sol", "grok-4.5"]);
assert.equal(agent.modelConfig("claude-opus-5")?.kind, "asset");
assert.equal(agent.modelConfig("gpt-5.6-sol")?.kind, "storyboard");
assert.equal(agent.modelConfig("grok-4.5")?.kind, "grok");
assert.equal(agent.modelConfig("claude-sonnet-5"), null, "Canvas Agent 不得接受其他模型");
assert.deepEqual(
  agent.tools.map((tool) => tool.function.name),
  ["create_node", "update_node", "set_node_prompt", "delete_node", "connect_nodes", "disconnect_nodes"],
);

const context = agent.context({
  name: "动作测试画布",
  assets: [{ id: "asset-1", name: "人物", type: "Character" }],
  nodes: [
    { id: "image-1", kind: "image", x: 80, y: 80, prompt: "旧提示词", settings: {} },
    { id: "video-1", kind: "video", x: 500, y: 80, settings: {} },
  ],
  connections: [],
});
const created = agent.action(context, "create_node", { kind: "video", x: 240, y: 320, prompt: "夜景镜头" });
assert.equal(created.action.type, "create_node");
assert.match(created.action.node.id, /^agent_/);
const generatedId = created.action.node.id;
agent.action(context, "set_node_prompt", { nodeId: generatedId, prompt: "青年在雨夜奔跑，手持霓虹色饮料，手持摄影，日系胶片色彩" });
agent.action(context, "connect_nodes", { from: "image-1", to: "video-1" });
assert.deepEqual(context.connections, [{ from: "image-1", to: "video-1" }]);
assert.throws(
  () => agent.action(context, "connect_nodes", { from: "video-1", to: "image-1" }),
  /不支持该连接方向/,
  "视频不能反向连接到图片",
);
agent.action(context, "disconnect_nodes", { from: "image-1", to: "video-1" });
assert.equal(context.connections.length, 0);
agent.action(context, "delete_node", { nodeId: generatedId });
assert.equal(context.nodes.some((node) => node.id === generatedId), false);

process.env.PIXEL_TOYS_AUTH_DISABLED = "1";
const upstreamCalls = [];
function sseResponse(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
let upstreamRound = 0;
agent && __test.superPixel.setFetch(async (url, options) => {
  upstreamCalls.push({ url, body: JSON.parse(options.body) });
  upstreamRound += 1;
  if (upstreamRound === 1) {
    return sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-create", type: "function", function: { name: "create_node", arguments: JSON.stringify({ kind: "image", x: 120, y: 180, prompt: "测试提示词" }) } }], }, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);
  }
  return sseResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"已完成\"},\"finish_reason\":\"stop\"}]}\n\n", "data: [DONE]\n\n"]);
});

function mockResponse() {
  const chunks = [];
  const headers = new Map();
  return {
    headersSent: false,
    writableEnded: false,
    status: 0,
    headers: { get(name) { return headers.get(name.toLowerCase()) || null; } },
    writeHead(status, values) {
      this.status = status;
      this.headersSent = true;
      Object.entries(values).forEach(([key, value]) => headers.set(key.toLowerCase(), String(value)));
    },
    write(chunk) { chunks.push(String(chunk)); },
    end(chunk = "") { if (chunk) chunks.push(String(chunk)); this.writableEnded = true; },
    text() { return chunks.join(""); },
  };
}

async function invoke(body) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: "" };
  req.setEncoding = () => {};
  const res = mockResponse();
  const pending = agent.handle(req, res);
  process.nextTick(() => {
    req.emit("data", JSON.stringify(body));
    req.emit("end");
  });
  await pending;
  return res;
}

const streamResult = await invoke({
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "创建一个图片模块" }],
  canvasContext: { name: "流测试画布", nodes: [], connections: [], assets: [] },
});
assert.equal(streamResult.status, 200);
assert.match(streamResult.text(), /"canvasAction"/);
assert.match(streamResult.text(), /已完成/);
assert.equal(upstreamCalls.length, 2, "工具调用后必须继续请求模型完成回答");
assert.equal(upstreamCalls[0].body.model, "gpt-5.6-sol");
assert.equal(upstreamCalls[0].body.tools.length, 6);
const rejected = await invoke({ model: "claude-sonnet-5", messages: [{ role: "user", content: "test" }] });
assert.equal(rejected.status, 400, "后端必须拒绝白名单外模型");

console.log("canvas agent model and action tests passed");
