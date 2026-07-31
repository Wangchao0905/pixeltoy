// 画布视频/尾帧的本地 /media URL 必须带 mtime 缓存戳。
//
// 病史（2026-07-31）：同一视频窗口重新生成后一直显示旧片段，新片段"不知道跑哪去了"。
// 新文件其实已经在 06_videos/raw/<shot>.mp4（旧的被归档到 shot_regenerate_archive/），
// 但画布节点存的是 provider 的远程签名地址（X-Tos-Expires=86400），或不带戳的本地地址。
// 重生成后文件路径不变，src 字符串就不变，已经在播的 <video> 不会重新拉流——
// /media 端点对不带 v= 的请求发 no-store 也救不了，因为播放器根本没再发请求。
// 远程地址还有第二个后果：签名 24 小时过期，之后彻底放不出来。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing server function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const context = { fs, path, compactLine: (value) => String(value || "").trim() };
vm.createContext(context);
vm.runInContext(extractFunction(server, "function stampedLocalMediaUrl("), context, { filename: "server.js" });

// 真跑一遍：戳必须存在，且必须随文件内容变化。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltoy-video-stamp-"));
const clip = path.join(tmp, "shot.mp4");
try {
  fs.writeFileSync(clip, "first-generation");
  const first = context.stampedLocalMediaUrl(clip);
  assert.match(first, /[?&]v=/, "本地视频 URL 必须带缓存戳");

  // 重新生成 = 同名覆盖。戳必须变，否则播放器继续用缓冲里的旧片段。
  fs.writeFileSync(clip, "second-generation-with-different-size");
  const second = context.stampedLocalMediaUrl(clip);
  assert.notEqual(second, first, "同名覆盖后缓存戳必须变化，否则画布仍然显示旧片段");

  // 文件不存在时不能抛——尾帧路径会拿还没下载完的文件调用它。
  assert.equal(
    context.stampedLocalMediaUrl(path.join(tmp, "missing.mp4")),
    `/media?path=${encodeURIComponent(path.join(tmp, "missing.mp4"))}`,
    "文件不存在时应退回不带戳的地址而不是抛错",
  );
  assert.equal(context.stampedLocalMediaUrl(""), "", "空路径应返回空串");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 尾帧接口返回的 videoUrl / tailFrameUrl 都要走带戳构造，别退回裸拼。
const tailFrameBuilder = extractFunction(server, "async function persistCanvasTailFrame(");
assert.match(tailFrameBuilder, /videoUrl: localVideoFile \? stampedLocalMediaUrl\(localVideoFile\)/, "尾帧接口返回的本地视频地址必须带缓存戳");
assert.match(tailFrameBuilder, /tailFrameUrl: file \? stampedLocalMediaUrl\(file\)/, "尾帧图地址必须带缓存戳（尾帧文件同名覆盖）");
// provider 直返尾帧时 localVideoFile 是空串，此时若本地已有该视频要优先用本地带戳地址，
// 否则画布会存下 24 小时后过期的 provider 签名 URL。
assert.match(
  tailFrameBuilder,
  /stampedLocalMediaUrl\(localMediaPathFromUrl\(result\.videoUrl\)\) \|\| result\.videoUrl/,
  "provider 远程地址只能作为最后兜底，本地已有文件时必须用本地带戳地址",
);

// 画布视频恢复路径同样不能裸拼。
assert.match(
  extractFunction(server, "function localCanvasVideoUrlForNode("),
  /stampedLocalMediaUrl\(file\)/,
  "画布视频恢复路径必须带缓存戳",
);

// 项目视频节点的 videoUrl 来自 mediaItem，它本身带戳——别把它改成裸拼。
assert.match(
  extractFunction(server, "function mediaItem("),
  /&v=\$\{encodeURIComponent\(version\)\}/,
  "mediaItem 必须保留 mtime-size-ino 缓存戳",
);
assert.match(
  extractFunction(server, "function localVideoFromSnapshot("),
  /mediaItem\(/,
  "项目视频节点必须经由 mediaItem 得到带戳地址，而不是 provider 远程地址",
);

// 缓存戳存在即可，绝不断言精确取值（项目规则：写死会让每次正常换戳都挂测试）。
assert.match(html, /canvas\.js\?v=[A-Za-z0-9._-]+/, "canvas.js 必须有缓存戳");

console.log("canvas video cache stamp tests passed");
