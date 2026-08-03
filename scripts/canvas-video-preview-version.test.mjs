import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 「同一个视频模块重新生成后仍显示旧视频」反复出现过多次。真根因在服务端:
// 前端每次提交都新造 videoPreviewVersion 写进节点(canvas.js ~3850),预览签名
// 靠它强制换播放器;但 sanitizeCanvasState 的字段白名单里没有它 → 存不下来 →
// loadProject 拿回恒为空 → 签名里那一项永远相同。部分 provider 还会复用同一
// videoUrl,于是整个签名不变,守卫把新结果挡在外面。
//
// 这与 2026-07-18 的 arkPersonAsset 透传丢字段是同一类病:前端发了、服务端
// sanitize 时丢掉。所以两侧都要锁。

const root = new URL("..", import.meta.url).pathname;
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");

// --- 1) 服务端必须持久化 videoPreviewVersion ---
assert.match(
  server,
  /videoPreviewVersion: compactLine\(node\.videoPreviewVersion \|\| ""\)/,
  "sanitizeCanvasState 必须保留 videoPreviewVersion,否则重新生成后一直显示旧视频",
);

// 必须落在与 videoUrl / taskId 同一个节点白名单里(而不是别处某个无关对象)
const sanitizeStart = server.indexOf("function sanitizeCanvasState");
assert.notEqual(sanitizeStart, -1, "sanitizeCanvasState 必须存在");
const sanitizeBlock = server.slice(sanitizeStart, sanitizeStart + 12000);
for (const field of ["videoUrl:", "taskId:", "videoPreviewVersion:"]) {
  assert.ok(sanitizeBlock.includes(field), `节点白名单必须包含 ${field}`);
}

// --- 2) 前端预览签名必须包含 videoPreviewVersion ---
const sigStart = canvas.indexOf("const previewSig = JSON.stringify({");
assert.notEqual(sigStart, -1, "视频预览签名必须存在");
const sigBlock = canvas.slice(sigStart, canvas.indexOf("});", sigStart));
for (const key of ["videoUrl", "taskId", "videoPreviewVersion", "status"]) {
  assert.ok(sigBlock.includes(key), `预览签名必须包含 ${key}`);
}

// --- 3) 提交时必须新造版本号并清掉旧结果 ---
assert.match(
  canvas,
  /const videoPreviewVersion = `\$\{Date\.now\(\)\.toString\(36\)\}_\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`/,
  "每次提交必须新造 videoPreviewVersion",
);
const submitStart = canvas.indexOf("const videoPreviewVersion = `");
const submitBlock = canvas.slice(submitStart, submitStart + 1600);
assert.match(submitBlock, /videoUrl: ""/, "提交时必须清掉旧 videoUrl");
assert.match(submitBlock, /taskId: ""/, "提交时必须清掉旧 taskId");
assert.match(submitBlock, /videoPreviewVersion,/, "提交时必须把新版本号写进节点");

// --- 4) 行为验证:复刻签名逻辑,证明「同 URL 换任务」也能触发重建 ---
const makeSig = (node) => JSON.stringify({
  kind: node.kind,
  videoUrl: node.videoUrl || "",
  taskId: node.taskId || "",
  videoPreviewVersion: node.videoPreviewVersion || "",
  status: node.status || "",
  tailFrameUrl: node.tailFrameUrl || "",
  tailFrameCaptureStatus: node.tailFrameCaptureStatus || "",
  tailFrameCaptureMessage: node.tailFrameCaptureMessage || "",
});

const base = { kind: "video", videoUrl: "https://cdn/x.mp4", taskId: "t1", videoPreviewVersion: "v1", status: "complete" };

// 同一 URL、同一 taskId,只有版本号变 → 必须重建(这正是 provider 复用 URL 的场景)
assert.notEqual(
  makeSig(base),
  makeSig({ ...base, videoPreviewVersion: "v2" }),
  "provider 复用同一 videoUrl 时,版本号变化必须导致签名变化",
);

// 版本号被服务端丢弃(退化成空)的情况:签名会与旧的相同 → 正是这个 bug
assert.equal(
  makeSig({ ...base, videoPreviewVersion: "" }),
  makeSig({ ...base, videoPreviewVersion: "" }),
  "版本号丢失后两次生成签名相同——这就是旧视频不刷新的机理",
);

// 稳定态不得误触重建(否则完成的 <video> 会被 5s 轮询反复销毁,回到闪烁 bug)
assert.equal(makeSig(base), makeSig({ ...base }), "内容未变时签名必须稳定");

console.log("canvas video preview version tests passed");
