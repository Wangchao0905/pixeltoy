import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const usersPath = path.join(root, ".pixel-toys-users.json");
const sessionsPath = path.join(root, ".pixel-toys-sessions.json");
const originalUsers = fs.existsSync(usersPath) ? fs.readFileSync(usersPath) : null;
const originalSessions = fs.existsSync(sessionsPath) ? fs.readFileSync(sessionsPath) : null;
const users = originalUsers ? JSON.parse(originalUsers) : { users: [] };
const sessions = originalSessions ? JSON.parse(originalSessions) : { sessions: [] };
if (!users.users.some((user) => user.username === "superadmin")) {
  users.users.push({ id: "super-pixel-admin", username: "superadmin", displayName: "admin", disabled: false });
}
const admin = users.users.find((user) => user.username === "superadmin");
const adminSession = `super-pixel-admin-${Date.now()}`;
const regularId = `super-pixel-user-${Date.now()}`;
const regularSession = `super-pixel-regular-${Date.now()}`;
users.users.push({ id: regularId, username: "superpixel-test-user", displayName: "test", disabled: false });
sessions.sessions.push(
  { id: adminSession, userId: admin.id, expiresAt: new Date(Date.now() + 3600000).toISOString() },
  { id: regularSession, userId: regularId, expiresAt: new Date(Date.now() + 3600000).toISOString() },
);
fs.writeFileSync(usersPath, `${JSON.stringify(users, null, 2)}\n`);
fs.writeFileSync(sessionsPath, `${JSON.stringify(sessions, null, 2)}\n`);

process.env.ASSET_ANALYZER_API_KEY = "test-super-pixel-asset-key";
process.env.STORYBOARD_API_KEY = "test-super-pixel-storyboard-key";
process.env.XAI_API_KEY = "test-super-pixel-grok-key";
process.env.DEEPSEEK_API_KEY = "test-super-pixel-deepseek-key";
process.env.ASSET_ANALYZER_BASE_URL = "https://asset.example/v1";
process.env.STORYBOARD_BASE_URL = "https://storyboard.example/v1";
process.env.DEEPSEEK_API_BASE_URL = "https://deepseek.example/v1";
const require = createRequire(import.meta.url);
const { __test } = require("../server.js");

function cookie(sessionId) {
  return `pixel_toys_session=${encodeURIComponent(sessionId)}`;
}

const calls = [];
function sseResponse(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function sseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function defaultSuperPixelFetch(url, options) {
  calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
  const gpt = url.startsWith("https://storyboard.example");
  const chunks = gpt
    ? ["data: {\"choices\":[{\"text\":\"GPT\"}]}\n\n", "data: [DONE]\n\n"]
    : ["data: {\"choices\":[{\"delta\":{\"content\":\"Claude\"}}]}\n\n", "data: [DONE]\n\n"];
  return sseResponse(chunks);
}

__test.superPixel.setFetch(defaultSuperPixelFetch);

function responseMock() {
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
      for (const [name, value] of Object.entries(values)) headers.set(name.toLowerCase(), String(value));
    },
    write(chunk) { chunks.push(String(chunk)); },
    end(chunk = "") { if (chunk) chunks.push(String(chunk)); this.writableEnded = true; },
    async text() { return chunks.join(""); },
  };
}

async function request(body, sessionId = "") {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionId ? cookie(sessionId) : "" };
  req.setEncoding = () => {};
  const res = responseMock();
  const result = __test.superPixel.handle(req, res);
  process.nextTick(() => { req.emit("data", JSON.stringify(body)); req.emit("end"); });
  await result;
  return res;
}

const body = { model: "claude-sonnet-5", mode: "ask", messages: [{ role: "user", content: "hello" }] };
try {
  const anonymous = await request(body);
  assert.equal(anonymous.status, 403, "未登录必须返回 403");
  const regular = await request(body, regularSession);
  assert.equal(regular.status, 403, "普通用户必须返回 403");
  const agent = await request({ ...body, mode: "agent" }, adminSession);
  assert.equal(agent.status, 200, "Agent 模式必须返回流");
  await agent.text();
  assert.equal(Array.isArray(calls.at(-1).body.tools), true, "Agent 模式请求体必须包含 tools");
  assert.equal(calls.at(-1).body.tools.length, 4, "Agent 模式必须声明四个工具");
  const agentWithImage = await request({
    ...body,
    mode: "agent",
    conversationImages: [{ url: "https://assets.example/product.png", name: "商品图.png", source: "local" }],
  }, adminSession);
  assert.equal(agentWithImage.status, 200);
  await agentWithImage.text();
  assert.match(calls.at(-1).body.messages[0].content, /image_1（用户上传：商品图\.png）/, "Agent 系统提示必须列出 conversationImages 句柄");

  const claude = await request(body, adminSession);
  assert.equal(claude.status, 200, "管理员必须返回 200");
  assert.equal(claude.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(claude.headers.get("x-accel-buffering"), "no");
  assert.match(await claude.text(), /Claude/);
  assert.equal("tools" in calls.at(-1).body, false, "Ask 模式请求体不得包含 tools");
  assert.equal("conversationImages" in calls.at(-1).body, false, "Ask 模式请求体不得包含 conversationImages");
  assert.equal(calls.at(-1).url, "https://asset.example/v1/chat/completions");
  assert.equal(calls.at(-1).headers.Authorization, "Bearer test-super-pixel-asset-key");

  const gpt = await request({ ...body, model: "gpt-5.6-sol" }, adminSession);
  assert.equal(gpt.status, 200);
  assert.match(await gpt.text(), /GPT/);
  assert.equal(calls.at(-1).url, "https://storyboard.example/v1/chat/completions");
  assert.equal(calls.at(-1).headers.Authorization, "Bearer test-super-pixel-storyboard-key");

  const scripted = await request({ ...body, scriptText: "x".repeat(30000) }, adminSession);
  assert.equal(scripted.status, 200);
  await scripted.text();
  assert.match(calls.at(-1).body.messages[0].content, /剧本过长，中间内容已截断/);
  assert.ok(calls.at(-1).body.messages[0].content.length < 25000);

  calls.length = 0;
  let splitRound = 0;
  __test.superPixel.setFetch(async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    splitRound += 1;
    if (splitRound === 1) {
      return sseResponse([
        sseChunk({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call-search", type: "function", function: { name: "search_assets", arguments: '{"search":"blue' } }] } }] }),
        sseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-video", type: "function", function: { name: "generate_video", arguments: '{"prompt":"sun' } }] } }] }),
        sseChunk({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: ' assets"}' } }] } }] }),
        sseChunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':set","duration":6}' } }] }, finish_reason: "tool_calls" }] }),
        "data: [DONE]\n\n",
      ]);
    }
    return sseResponse([
      "data: {\"choices\":[{\"delta\":{\"content\":\"tools complete\"},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n",
    ]);
  });
  const split = await request({ ...body, mode: "agent" }, adminSession);
  assert.equal(split.status, 200);
  const splitText = await split.text();
  assert.match(splitText, /\"toolConfirm\"/);
  assert.match(splitText, /\"toolResult\"/);
  const followUp = calls[1].body.messages;
  const assistantToolCall = followUp.find((message) => message.role === "assistant");
  assert.deepEqual(assistantToolCall.tool_calls.map((call) => call.id), ["call-video", "call-search"], "tool_calls 必须按 index 排序");
  assert.deepEqual(JSON.parse(assistantToolCall.tool_calls[0].function.arguments), { prompt: "sun:set", duration: 6 }, "index 0 参数必须跨分片拼接");
  assert.deepEqual(JSON.parse(assistantToolCall.tool_calls[1].function.arguments), { search: "blue assets" }, "index 1 参数必须跨分片拼接");

  calls.length = 0;
  __test.superPixel.setFetch(async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return sseResponse([
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-limit\",\"type\":\"function\",\"function\":{\"name\":\"generate_video\",\"arguments\":\"{\\\"prompt\\\":\\\"loop\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
      "data: [DONE]\n\n",
    ]);
  });
  const limited = await request({ ...body, mode: "agent" }, adminSession);
  assert.equal(limited.status, 200);
  assert.match(await limited.text(), /轮数超过上限/);
  assert.equal(calls.length, 5, "工具循环最多只能请求上游 5 轮");

  calls.length = 0;
  let videoGenerationFetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    videoGenerationFetches += 1;
    throw new Error(`unexpected video generation fetch: ${args[0]}`);
  };
  __test.superPixel.setFetch(async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (calls.length === 1) {
      return sseResponse([
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-video-confirm\",\"type\":\"function\",\"function\":{\"name\":\"generate_video\",\"arguments\":\"{\\\"prompt\\\":\\\"confirm only\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n",
      ]);
    }
    return sseResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"confirmed\"}}]}\n\ndata: [DONE]\n\n"]);
  });
  try {
    const video = await request({ ...body, mode: "agent" }, adminSession);
    assert.equal(video.status, 200);
    assert.match(await video.text(), /\"toolConfirm\"/);
    assert.equal(videoGenerationFetches, 0, "generate_video 不得调用视频生成接口");
  } finally {
    globalThis.fetch = originalFetch;
  }

  let resolveUpstreamReady;
  const upstreamReady = new Promise((resolve) => { resolveUpstreamReady = resolve; });
  let upstreamAborted = false;
  __test.superPixel.setFetch(async (_url, { signal }) => {
    resolveUpstreamReady();
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    upstreamAborted = signal.aborted;
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  });
  const disconnectReq = new EventEmitter();
  disconnectReq.method = "POST";
  disconnectReq.headers = { cookie: cookie(adminSession) };
  disconnectReq.setEncoding = () => {};
  const disconnectRes = responseMock();
  const pending = __test.superPixel.handle(disconnectReq, disconnectRes);
  process.nextTick(() => { disconnectReq.emit("data", JSON.stringify(body)); disconnectReq.emit("end"); });
  await upstreamReady;
  disconnectReq.emit("close");
  await pending;
  assert.equal(upstreamAborted, true, "客户端断开必须 abort 上游请求");

  const textRouter = __test.superPixel.textRouter();
  const textModels = textRouter.models();
  assert.deepEqual(
    new Set(textModels.map((item) => item.provider)),
    new Set(["chatgpt", "claude", "deepseek"]),
    "PixelTale router must use SuperPixel's registered model families",
  );
  assert.deepEqual(
    textModels.filter((item) => item.provider === "deepseek").map((item) => item.id),
    ["deepseek-v4-pro"],
    "PixelTale must use DeepSeek V4 Pro as its third writing family",
  );
  // A stalled gateway used to abort all three authors on one blocked channel,
  // because the three configured roles commonly resolve to a single provider.
  const sameProviderChain = textRouter.stageModels({
    primary: "gpt-5.6-sol",
    reviewer: "gpt-5.6-terra",
    consistency: "gpt-5.6-luna",
  });
  assert.equal(sameProviderChain[0], "gpt-5.6-sol", "the configured author must still run first");
  assert.equal(sameProviderChain.length, 3, "the primary chain must keep exactly three attempts");
  assert.ok(
    new Set(sameProviderChain.map((id) => __test.superPixel.modelProvider(id))).size >= 2,
    "primary fallback must leave the author's provider so a degraded channel cannot abort every attempt",
  );
  const reviewerModels = textRouter.reviewModels({
    primary: "gpt-5.6-terra",
    reviewer: "claude-opus-5",
    consistency: "gpt-5.6-luna",
  });
  assert.deepEqual(
    reviewerModels.map((item) => item.provider),
    ["chatgpt", "claude", "deepseek"],
    "cross-review must reserve one distinct SuperPixel model family per reviewer",
  );
  assert.equal(new Set(reviewerModels.map((item) => item.model)).size, 3, "cross-review models must be distinct");

  const textCalls = [];
  __test.superPixel.setFetch(async (url, options) => {
    textCalls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
  });
  const textResult = await textRouter.call({ model: "gpt-5.6-sol", system: "return JSON", user: "{}", purpose: "pixeltale" });
  assert.equal(textResult.model, "gpt-5.6-sol");
  assert.deepEqual(textResult.content, { ok: true });
  assert.equal(textCalls[0].url, "https://storyboard.example/v1/chat/completions", "text router must reuse SuperPixel's model gateway");
  assert.equal(textCalls[0].headers.Authorization, "Bearer test-super-pixel-storyboard-key", "text router must reuse SuperPixel's credential source");
  const deepseekResult = await textRouter.call({ model: "deepseek-v4-pro", system: "return JSON", user: "{}", purpose: "pixeltale" });
  assert.equal(deepseekResult.model, "deepseek-v4-pro");
  assert.equal(textCalls[1].url, "https://deepseek.example/v1/chat/completions", "DeepSeek must use its configured OpenAI-compatible gateway");
  assert.equal(textCalls[1].headers.Authorization, "Bearer test-super-pixel-deepseek-key", "DeepSeek must use its own credential source");
  assert.equal(textCalls[0].body.stream, false, "PixelTale structured output must be a non-streaming SuperPixel request");
} finally {
  __test.superPixel.setFetch(null);
  if (originalUsers) fs.writeFileSync(usersPath, originalUsers);
  else fs.rmSync(usersPath, { force: true });
  if (originalSessions) fs.writeFileSync(sessionsPath, originalSessions);
  else fs.rmSync(sessionsPath, { force: true });
}

console.log("super pixel server tests passed");
