import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");

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

const localVideo = "/srv/pixel-toy/09_tail_frames/node_1784787598728_31_src.mp4";
const context = {
  APP_ROOT: "/srv/pixel-toy",
  path,
  fs: {
    existsSync(file) {
      return file === localVideo;
    },
    statSync() {
      return { isFile: () => true, size: 9995069 };
    },
  },
  compactLine(value) {
    return String(value || "").trim();
  },
  safeSlug(value, fallback) {
    return String(value || fallback).replace(/[^A-Za-z0-9_-]+/g, "_");
  },
  allowedPath(file) {
    return String(file).startsWith("/srv/pixel-toy/");
  },
  localMediaPathFromUrl() {
    return "";
  },
  localFilePathFromUrl() {
    return "";
  },
  encodeURIComponent,
};
vm.createContext(context);
context.compactLine = (value) => String(value || "").trim();
vm.runInContext(extractFunction(server, "function stampedLocalMediaUrl("), context, { filename: "server.js" });
vm.runInContext(extractFunction(server, "function validLocalCanvasVideoFile("), context, { filename: "server.js" });
vm.runInContext(extractFunction(server, "function localCanvasVideoFileForNode("), context, { filename: "server.js" });
vm.runInContext(extractFunction(server, "function localCanvasVideoUrlForNode("), context, { filename: "server.js" });

const recoveredUrl = context.localCanvasVideoUrlForNode({
  id: "node_1784787598728_31",
  videoUrl: "https://expired.example/video.mp4?X-Tos-Expires=86400",
});
assert.ok(
  recoveredUrl.startsWith(`/media?path=${encodeURIComponent(localVideo)}`),
  "an expired remote URL must fall back to the matching local canvas MP4",
);
assert.match(recoveredUrl, /[?&]v=[^&]+$/, "恢复出的本地视频地址必须带缓存戳，否则重生成后画布仍播旧片段");
assert.doesNotMatch(recoveredUrl, /v=NaN/, "缓存戳不能是 NaN（那会变成永不失效的假戳）");
assert.equal(
  context.localCanvasVideoUrlForNode({ id: "node_missing", videoUrl: "https://expired.example/video.mp4" }),
  "",
  "nodes without a local MP4 must not be rewritten to a guessed URL",
);

assert.match(
  server,
  /const recoveredVideoUrl = localCanvasVideoUrlForNode\(next\);/,
  "canvas-state migration must apply the local video fallback when loading legacy nodes",
);

console.log("canvas local video recovery tests passed");
