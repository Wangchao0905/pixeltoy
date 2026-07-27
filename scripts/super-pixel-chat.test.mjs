import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(html, /id="superPixelMessages"/);
assert.match(html, /id="superPixelScriptUpload"[^>]*\.md[^>]*\.txt[^>]*\.docx/);
assert.match(html, /<option value="agent">Agent<\/option>/);
assert.doesNotMatch(html, /<option value="agent" disabled>/);
const superPixelModelSelect = html.match(/<select id="superPixelModel"[\s\S]*?<\/select>/)?.[0] || "";
assert.doesNotMatch(superPixelModelSelect, /value="claude-sonnet-5"/);
// 别咬缓存戳的字面值。?v= 是并发协作里唯一必冲突行,任何人 bump 一次就会把
// 硬编码的字面值断言打挂(2026-07-27 实测:被 empty-studio-20260727 冲掉)。
// 这里只保证两个戳存在且一致——那才是「改动能到浏览器」的真实条件。
const stylesStamp = html.match(/styles\.css\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
const appStamp = html.match(/app\.js\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
assert.ok(stylesStamp, "styles.css 必须带缓存戳");
assert.ok(appStamp, "app.js 必须带缓存戳");
assert.equal(appStamp, stylesStamp, "两个缓存戳必须同步 bump");
assert.match(app, /async function submitSuperPixelChat\(prompt\)/);
assert.match(app, /fetch\("\/api\/super-pixel\/chat"/);
assert.match(app, /Accept: "text\/event-stream"/);
assert.match(app, /new AbortController\(\)/);
assert.match(app, /readScriptUpload\(file\)/);
assert.match(app, /state\.superPixel\.scriptText/);
assert.doesNotMatch(app, /Agent 模式暂未开放/);
assert.match(app, /mode: state\.superPixel\.mode/);
assert.doesNotMatch(app, /Super Pixel 即将上线|剧本上传即将上线/);
assert.match(server, /if \(url\.pathname === "\/api\/super-pixel\/chat"\) return await handleSuperPixelChat/);
assert.match(server, /req\.on\("close", onClose\)/);
assert.match(server, /controller\.abort\(\)/);
assert.match(server, /"X-Accel-Buffering": "no"/);
assert.doesNotMatch(app, /ASSET_ANALYZER_API_KEY|STORYBOARD_API_KEY/);

const streamStart = app.indexOf("async function readSuperPixelStream");
const streamEnd = app.indexOf("\nconst SUPER_PIXEL_MAX_ATTACHMENTS", streamStart);
assert.ok(streamStart >= 0 && streamEnd > streamStart, "readSuperPixelStream 必须可测试");
const streamSource = app.slice(streamStart, streamEnd);
for (const eventName of ["toolStart", "toolCard", "toolConfirm", "toolResult"]) {
  assert.ok(streamSource.includes(`"${eventName}"`), `流解析必须支持 ${eventName}`);
}
assert.match(streamSource, /payload\.error\) throw new Error/);
assert.match(streamSource, /payload\.delta\) onDelta\(payload\.delta\)/);
assert.match(streamSource, /payload\.done/);

function responseFrom(payloads) {
  const text = payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");
  const chunks = [text.slice(0, 19), text.slice(19, 61), text.slice(61)];
  return {
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) if (chunk) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  };
}

const readSuperPixelStream = new Function(`${streamSource}; return readSuperPixelStream;`)();
const deltas = [];
const events = [];
await readSuperPixelStream(responseFrom([
  { delta: "Ask " },
  { toolStart: { callId: "call_1", name: "generate_image", args: { prompt: "city" } } },
  { toolCard: { kind: "image", callId: "call_1", taskId: "task_1", meta: { prompt: "city" } } },
  { toolConfirm: { kind: "video", callId: "call_2", args: { prompt: "rain" } } },
  { toolResult: { callId: "call_1", name: "generate_image", summary: "submitted" } },
  { done: true },
]), (delta) => deltas.push(delta), (type, data) => events.push({ type, data }));
assert.deepEqual(deltas, ["Ask "], "delta 事件必须保持原行为");
assert.deepEqual(events.map((event) => event.type), ["toolStart", "toolCard", "toolConfirm", "toolResult", "done"]);
await assert.rejects(
  readSuperPixelStream(responseFrom([{ error: "stream failed" }]), () => {}, () => {}),
  /stream failed/,
  "error 事件必须继续中断当前流",
);

assert.match(app, /function renderSuperPixelImageCard\(/);
assert.match(app, /function renderSuperPixelVideoConfirmCard\(/);
assert.match(app, /function handleSuperPixelStreamEvent\(/);
assert.match(app, /function startSuperPixelImagePoll\(/);
assert.match(app, /function startSuperPixelVideoPoll\(/);
assert.match(app, /\/api\/canvas\/image-generations\/\$\{encodeURIComponent\(taskId\)\}/);
assert.match(app, /\/api\/canvas\/video-generations\/\$\{encodeURIComponent\(taskId\)\}/);
assert.match(app, /provider=\$\{encodeURIComponent\(provider\)\}/);
assert.match(app, /body: JSON\.stringify\(\{\s*\.\.\.args, model: args\.videoModel, assets\s*\}\)/);
assert.match(app, /referenceImages[\s\S]*thumbnailUrl/);
assert.match(app, /assets:[\s\S]*referenceImages/);
assert.match(app, /function cancelSuperPixelVideoCard\(/);
assert.match(app, /function stopSuperPixelPoll\(/);
assert.match(app, /clearTimeout\(/);

function functionSource(name) {
  const asyncStart = app.indexOf(`async function ${name}`);
  const start = asyncStart >= 0 ? asyncStart : app.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} 必须存在`);
  const bodyStart = app.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name} source is incomplete`);
}

const cancelSuperPixelVideoCard = new Function(
  "renderSuperPixelMessages",
  `${functionSource("cancelSuperPixelVideoCard")}; return cancelSuperPixelVideoCard;`,
)(() => {});
const confirmSuperPixelVideoCard = new Function(
  "api",
  "renderSuperPixelMessages",
  "startSuperPixelVideoPoll",
  `${functionSource("confirmSuperPixelVideoCard")}; return confirmSuperPixelVideoCard;`,
)(async () => { throw new Error("request must not happen"); }, () => {}, () => {});
const canceledCard = { status: "confirming" };
cancelSuperPixelVideoCard(canceledCard);
assert.equal(canceledCard.status, "cancelled");
await confirmSuperPixelVideoCard(canceledCard);
assert.equal(canceledCard.status, "cancelled", "取消后的确认卡不得再次触发请求");

// 事件处理器的行为测试。上面第 37-38 行只检查 readSuperPixelStream 源码里出现过
// 事件名,那是解析器;把 handleSuperPixelStreamEvent 里的 toolCard 分支整段去掉
// 仍能通过。这里真正驱动处理器,确保卡片被插入、轮询被启动。
{
  const inserted = [];
  const polled = [];
  const handleSuperPixelStreamEvent = new Function(
    "insertSuperPixelToolCard",
    "startSuperPixelImagePoll",
    `${functionSource("handleSuperPixelStreamEvent")}; return handleSuperPixelStreamEvent;`,
  )((card) => inserted.push(card), (card) => polled.push(card));

  const assistant = { content: "" };
  handleSuperPixelStreamEvent("toolStart", { callId: "c1", name: "generate_image" }, assistant);
  assert.equal(assistant.toolEvents?.length, 1, "toolStart 必须记录到 assistant.toolEvents");

  handleSuperPixelStreamEvent(
    "toolCard",
    { kind: "image", callId: "c1", taskId: "task_1", meta: { prompt: "雪山" } },
    assistant,
  );
  assert.equal(inserted.length, 1, "toolCard 必须插入图片卡片");
  assert.equal(inserted[0].kind, "image");
  assert.equal(inserted[0].status, "running");
  assert.equal(polled.length, 1, "带 taskId 的图片卡片必须启动轮询");

  // 缺 taskId 时不能假装在生成,也不能启动轮询。
  handleSuperPixelStreamEvent("toolCard", { kind: "image", callId: "c2" }, assistant);
  assert.equal(inserted[1].status, "failed", "缺 taskId 的图片卡片必须标记失败");
  assert.equal(polled.length, 1, "缺 taskId 时不得启动轮询");

  handleSuperPixelStreamEvent(
    "toolConfirm",
    { kind: "video", callId: "c3", args: { prompt: "推近" }, referenceImages: [{ url: "https://cdn.example/ref.png", thumbnailUrl: "https://cdn.example/ref-thumb.png", name: "商品图" }] },
    assistant,
  );
  assert.equal(inserted[2].kind, "video");
  assert.equal(inserted[2].status, "confirming", "视频卡片必须先进入待确认态");
  assert.equal(inserted[2].referenceImages[0].thumbnailUrl, "https://cdn.example/ref-thumb.png", "视频确认卡必须保留参考图缩略图");
  assert.equal(polled.length, 1, "视频确认前不得启动轮询");
}

console.log("super pixel chat UI tests passed");
