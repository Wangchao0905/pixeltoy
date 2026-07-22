"use strict";

// 画布预览缩略图:用系统 ffmpeg 把大图/视频首帧缩放成小 webp(保留透明底),落盘缓存。
// 目的是根治画布"大图 2-3MB 冷加载慢 + 布局跳"的问题——预览只加载几十 KB 的小图。
// 不新增 npm 依赖(复用尾帧抽取已在用的 ffmpeg)。下载/生视频参考仍用原图,不走这里。

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const THUMB_DIR = path.join(process.cwd(), ".pixel-toys-thumbs");
// 允许的目标宽度(前端只会请求这几档;其它值就近吸附,避免任意宽度撑爆缓存)。
const ALLOWED_WIDTHS = [240, 360, 480, 640, 720];
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv)$/i;
const FFMPEG_TIMEOUT_MS = 20000;

const inFlight = new Map();

function isThumbnailable(file) {
  return IMAGE_RE.test(file) || VIDEO_RE.test(file);
}

function normalizeThumbWidth(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return ALLOWED_WIDTHS.reduce((best, w) => (Math.abs(w - n) < Math.abs(best - n) ? w : best), ALLOWED_WIDTHS[0]);
}

function thumbCachePath(file, width, mtimeMs, size) {
  const key = crypto
    .createHash("sha1")
    .update(`${file}:${mtimeMs}:${size}:${width}`)
    .digest("hex")
    .slice(0, 20);
  // WebP:体积比 PNG 小 10-20 倍(640px 照片 PNG 常 300KB-1.5MB,WebP q80 仅几十 KB),
  // 保留透明底。生产 ffmpeg 已确认内置 libwebp 编码器。
  return path.join(THUMB_DIR, `${key}-w${width}.webp`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg thumbnail timeout"));
    }, FFMPEG_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(compact(err).slice(-300) || `ffmpeg exit ${code}`));
    });
  });
}

function compact(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

// 生成(或复用缓存的)缩略图,返回本地文件路径;任何失败返回 null(调用方回退原图)。
async function ensureThumbnail(srcFile, widthInput) {
  try {
    const width = normalizeThumbWidth(widthInput);
    if (!width || !srcFile || !isThumbnailable(srcFile)) return null;
    const stat = fs.statSync(srcFile);
    if (!stat.isFile() || !stat.size) return null;
    const out = thumbCachePath(srcFile, width, Math.round(stat.mtimeMs), stat.size);
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
    if (inFlight.has(out)) return inFlight.get(out);

    const job = (async () => {
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      const tmp = `${out}.tmp-${process.pid}-${Date.now()}.webp`;
      // scale='min(W,iw)':-2 → 不放大超过原宽、保持比例、高取偶数;单帧输出 WebP(q80,保留 alpha)。
      const vf = `scale='min(${width},iw)':-2:flags=lanczos`;
      const webpArgs = ["-c:v", "libwebp", "-quality", "80", "-compression_level", "5"];
      const args = VIDEO_RE.test(srcFile)
        ? ["-y", "-ss", "0", "-i", srcFile, "-frames:v", "1", "-vf", vf, ...webpArgs, tmp]
        : ["-y", "-i", srcFile, "-frames:v", "1", "-vf", vf, ...webpArgs, tmp];
      await runFfmpeg(args);
      if (!fs.existsSync(tmp) || !fs.statSync(tmp).size) throw new Error("empty thumbnail output");
      fs.renameSync(tmp, out);
      return out;
    })().catch((error) => {
      // 失败时清理可能残留的 tmp,返回 null 让上层回退原图。
      try {
        for (const f of fs.readdirSync(THUMB_DIR)) {
          if (f.startsWith(path.basename(out) + ".tmp-")) fs.unlinkSync(path.join(THUMB_DIR, f));
        }
      } catch {}
      return null;
    }).finally(() => inFlight.delete(out));

    inFlight.set(out, job);
    return job;
  } catch {
    return null;
  }
}

module.exports = { ensureThumbnail, normalizeThumbWidth, isThumbnailable, THUMB_DIR };
