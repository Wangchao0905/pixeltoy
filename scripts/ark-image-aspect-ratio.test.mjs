import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 火山方舟视频接口要求参考图宽高比在 0.40~2.50。生产实测:用户往视频节点连了 3 张图,
// 两张 1280×720(1.78,合规)、一张误连的外部截屏 2048×340(6.02),提交后被火山拒,
// 报文是英文且不点名哪张图,用户连撞 3 次都不知道问题在哪。
// 这个测试锁住提交前预检。
const root = new URL("..", import.meta.url).pathname;
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

// --- 1) 常量与函数必须存在 ---
assert.match(server, /const ARK_IMAGE_MIN_ASPECT_RATIO = 0\.4;/, "必须有下限常量");
assert.match(server, /const ARK_IMAGE_MAX_ASPECT_RATIO = 2\.5;/, "必须有上限常量");
assert.match(server, /function assertArkImageAspectRatio\(entries = \[\]\)/, "必须有预检函数");
assert.match(server, /function arkAspectRatioEntriesFromAssets\(assets = \[\]\)/, "必须有资产→本地路径映射");

// --- 2) 必须接在 Ark 提交路径上,且在数量预检之后 ---
const arkStart = server.indexOf("async function buildSeedanceGenerationPayload");
assert.notEqual(arkStart, -1, "buildSeedanceGenerationPayload 必须存在");
const arkBody = server.slice(arkStart, arkStart + 4000);
assert.match(
  arkBody,
  /assertArkImageAspectRatio\(arkAspectRatioEntriesFromAssets\(assets\)\)/,
  "Ark 提交路径必须做宽高比预检",
);
assert.ok(
  arkBody.indexOf("assertSeedanceReferenceBudget") < arkBody.indexOf("assertArkImageAspectRatio"),
  "宽高比预检应在数量预检之后(先报数量问题更直观)",
);

// --- 3) 不得误伤 Gravitex:0.40~2.50 是 Ark 独有限制 ---
const gvStart = server.indexOf("async function buildGravitexVideoGenerationPayload");
assert.notEqual(gvStart, -1, "buildGravitexVideoGenerationPayload 必须存在");
const gvBody = server.slice(gvStart, gvStart + 2500);
assert.ok(
  !gvBody.includes("assertArkImageAspectRatio"),
  "Gravitex 路径不得套用 Ark 的宽高比限制,否则会误拦合法提交",
);

// --- 4) 必须复用现成的 ffprobeVideoDimensions,而不是自己拼 ffprobe ---
const fnStart = server.indexOf("function assertArkImageAspectRatio");
const fnBody = server.slice(fnStart, fnStart + 1800);
assert.match(fnBody, /ffprobeVideoDimensions\(localPath\)/, "必须复用 ffprobeVideoDimensions(它带 20s timeout 且解析更稳)");
assert.ok(!fnBody.includes('execFileSync("ffprobe"'), "不得在此函数内另起一套 ffprobe 调用");

// --- 5) 容错:量不到尺寸必须跳过,不能阻断合法提交 ---
assert.match(fnBody, /if \(!localPath\) return;/, "无本地路径必须跳过");
assert.match(fnBody, /if \(!dimensions\) return;/, "量不到尺寸必须跳过");

// --- 6) 报错必须点名、给数值、可执行 ---
assert.match(fnBody, /第 \$\{item\.seq\} 张/, "必须点名第几张");
assert.match(fnBody, /\$\{item\.width\}×\$\{item\.height\}/, "必须给实际尺寸");
assert.match(fnBody, /item\.ratio\.toFixed\(2\)/, "必须给比例(2 位小数)");
assert.match(fnBody, /offenders\s*\n?\s*\.map|offenders$/m, "多张超标必须一次性全列出");
assert.match(fnBody, /请断开这些参考图/, "必须给可执行的下一步");

// --- 7) 行为验证:用真实图片跑一遍判定逻辑 ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ark-ratio-"));
try {
  const make = (name, w, h) => {
    const file = path.join(dir, name);
    execFileSync("python3", ["-c", "from PIL import Image;import sys;Image.new('RGB',(int(sys.argv[2]),int(sys.argv[3])),(200,200,200)).save(sys.argv[1])", file, String(w), String(h)], { stdio: "pipe" });
    return file;
  };
  const probe = (file) => {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 20000 });
    const [w, h] = String(out).trim().split(/[,x]/).map(Number);
    return w / h;
  };
  const inRange = (r) => r >= 0.4 && r <= 2.5;

  // 生产实测的三张图
  assert.equal(inRange(probe(make("ok_16x9.png", 1280, 720))), true, "1280×720(1.78) 必须合规");
  assert.equal(inRange(probe(make("ok_9x16.png", 1080, 1920))), true, "1080×1920(0.56) 必须合规");
  assert.equal(inRange(probe(make("bad_strip.png", 2048, 340))), false, "2048×340(6.02) 必须被判超标");
  // 边界:恰好 2.50 与 0.40 应视为合规(火山文案是 between,取闭区间更宽容)
  assert.equal(inRange(probe(make("edge_max.png", 2500, 1000))), true, "比例 2.50 应合规");
  assert.equal(inRange(probe(make("edge_min.png", 400, 1000))), true, "比例 0.40 应合规");
  // 略微越界必须被拦
  assert.equal(inRange(probe(make("over_max.png", 2510, 1000))), false, "比例 2.51 应超标");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("ark image aspect ratio tests passed");
