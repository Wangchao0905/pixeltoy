import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { __test } = require(path.join(root, "server.js"));
const {
  persistCanvasTailFrame,
  resolveCanvasVideoLocalFile,
  extractCanvasTailFrameFromVideo,
} = __test.canvasTailFrame;

assert.equal(typeof persistCanvasTailFrame, "function", "tail-frame persistence test hook must be exposed");
assert.equal(typeof resolveCanvasVideoLocalFile, "function", "canvas video resolver test hook must be exposed");
assert.equal(typeof extractCanvasTailFrameFromVideo, "function", "canvas ffmpeg extractor test hook must be exposed");

function testProject() {
  const projectRoot = fs.mkdtempSync(path.join(root, ".canvas-tail-frame-test-"));
  return {
    projectRoot,
    projectId: Buffer.from(projectRoot, "utf8").toString("base64url"),
    tailDir: path.join(projectRoot, "09_tail_frames"),
  };
}

function mediaUrl(file) {
  return `/media?path=${encodeURIComponent(file)}`;
}

function writeLargeFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
}

async function assertHangingDownloadFailsFast(body) {
  const project = testProject();
  const originalFetch = global.fetch;
  const hangingBodies = [];
  global.fetch = async (_url, { signal } = {}) => {
    const stream = new Readable({ read() {} });
    hangingBodies.push(stream);
    signal?.addEventListener("abort", () => stream.destroy(new Error("test stream aborted")), { once: true });
    return { ok: true, status: 200, body: stream };
  };
  try {
    const started = Date.now();
    const result = await persistCanvasTailFrame(body(project), {
      requestTimeoutMs: 80,
      videoDownloadTimeoutMs: 80,
      tailFrameDownloadTimeoutMs: 80,
    });
    assert.equal(result.ready, false, "a hanging download must not produce a ready tail frame");
    assert.match(result.message, /超时/, "a hanging download must return an explicit timeout message");
    assert.ok(Date.now() - started < 1000, "a hanging download must return well before the frontend timeout");
    const files = fs.existsSync(project.tailDir) ? fs.readdirSync(project.tailDir) : [];
    assert.deepEqual(files, [], "a timed-out download must remove partial files");
    assert.ok(hangingBodies.length > 0, "the test must exercise the fetch body");
  } finally {
    global.fetch = originalFetch;
    for (const stream of hangingBodies) stream.destroy();
    fs.rmSync(project.projectRoot, { recursive: true, force: true });
  }
}

await assertHangingDownloadFailsFast((project) => ({
  projectId: project.projectId,
  nodeId: "video-download-timeout",
  videoUrl: "https://hang.example/video.mp4",
}));

await assertHangingDownloadFailsFast((project) => ({
  projectId: project.projectId,
  nodeId: "tail-image-timeout",
  tailFrameUrl: "https://hang.example/tail.png",
}));

{
  const project = testProject();
  const previousPath = process.env.PATH || "";
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-tail-frame-bin-"));
  const fakeFfmpeg = path.join(binDir, "ffmpeg");
  fs.writeFileSync(fakeFfmpeg, "#!/bin/sh\nexec node -e 'setTimeout(() => {}, 60000)'\n", { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${previousPath}`;
  const videoFile = path.join(project.projectRoot, "video.mp4");
  writeLargeFile(videoFile);
  try {
    const started = Date.now();
    await assert.rejects(
      () => extractCanvasTailFrameFromVideo(project.tailDir, "ffmpeg-timeout", videoFile, { ffmpegAttemptTimeoutMs: 25 }),
      /ffmpeg 超时/,
      "a stuck ffmpeg process must be killed and reported",
    );
    assert.ok(Date.now() - started < 1500, "three bounded ffmpeg attempts must remain well below 120 seconds");
    assert.equal(fs.existsSync(path.join(project.tailDir, "ffmpeg-timeout_tail.png")), false, "timed-out ffmpeg must remove partial output");
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(project.projectRoot, { recursive: true, force: true });
  }
}

{
  const project = testProject();
  const videoFile = path.join(project.projectRoot, "video.mp4");
  const cachedFrame = path.join(project.tailDir, "cached_tail.png");
  writeLargeFile(videoFile);
  writeLargeFile(path.join(project.tailDir, "local-cache_tail.png"));
  writeLargeFile(cachedFrame);
  try {
    const localResult = await persistCanvasTailFrame({
      projectId: project.projectId,
      nodeId: "local-cache",
      videoUrl: mediaUrl(videoFile),
    });
    assert.equal(localResult.ready, true, "an existing local video and cached tail frame must remain a fast path");
    assert.equal(localResult.tailFrameLocalFile, path.join(project.tailDir, "local-cache_tail.png"));
    assert.equal(localResult.message, "复用已缓存尾帧");

    const cachedResult = await persistCanvasTailFrame({
      projectId: project.projectId,
      nodeId: "remote-cache",
      tailFrameUrl: mediaUrl(cachedFrame),
    });
    assert.equal(cachedResult.ready, true, "an existing cached tail-frame URL must remain a fast path");
    assert.equal(cachedResult.tailFrameLocalFile, cachedFrame);
    assert.equal(cachedResult.message, "复用已缓存尾帧");
  } finally {
    fs.rmSync(project.projectRoot, { recursive: true, force: true });
  }
}

console.log("canvas tail-frame timeout tests passed");
