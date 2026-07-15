#!/usr/bin/env node
// 前端 JS 压缩(minify only,不混淆)。源码留在 public/ 可读,
// 压缩版输出到 .deploy-min/public/,部署时上传压缩版覆盖生产 public/。
// 用法: node scripts/build-min.mjs   (仓库根目录执行)
import { build } from "esbuild";
import { mkdir, copyFile, readFile, rm, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public");
const OUT = path.join(ROOT, ".deploy-min", "public");

// 手写、未压缩、需 minify 的全局脚本(非 ES module)
const MINIFY = ["app.js", "canvas.js", "auth.js", "auth-infinity.js"];

const kb = (n) => (n / 1024).toFixed(1) + "KB";

async function run() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  let totalOrig = 0, totalMin = 0;
  console.log("前端 minify(源码保持可读,只输出压缩版到 .deploy-min/):\n");
  for (const name of MINIFY) {
    const src = path.join(SRC, name);
    const out = path.join(OUT, name);
    const orig = (await stat(src)).size;
    await build({
      entryPoints: [src],
      outfile: out,
      minify: true,
      legalComments: "none",
      logLevel: "silent",
      // 纯 minify:去空格/合并声明,保留全局作用域与标识符名(不混淆、不包 IIFE)。
      // 与预验证行为一致,避免切断 HTML 内联事件或跨文件全局变量。
    });
    const min = (await readFile(out));
    const gz = gzipSync(min).length;
    totalOrig += orig; totalMin += min.length;
    console.log(`  ${name.padEnd(18)} ${kb(orig).padStart(9)} → ${kb(min.length).padStart(9)}  (gzip ${kb(gz)})  省${Math.round(100 - min.length*100/orig)}%`);
  }
  console.log(`\n  合计 ${kb(totalOrig)} → ${kb(totalMin)}  省${Math.round(100 - totalMin*100/totalOrig)}%`);
  console.log(`\n输出目录: ${OUT}`);
}
run().catch((e) => { console.error("构建失败:", e); process.exit(1); });
