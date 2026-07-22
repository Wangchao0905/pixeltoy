import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const director = require(path.join(root, "server", "seedance-director.js"));

// --- 模块函数 ---

// sanitizeSeedanceDesign: 只保留白名单键、压平空白、motion_intensity 约束、空值丢弃、非对象→{}
{
  const clean = director.sanitizeSeedanceDesign({
    scene: "  雨夜  天台  ",
    camera_movement: "低角度仰拍，缓慢推镜",
    motion_intensity: "HIGH",
    mood: "",
    bogus_key: "should be dropped",
  });
  assert.equal(clean.scene, "雨夜 天台", "应压平多余空白");
  assert.equal(clean.camera_movement, "低角度仰拍，缓慢推镜");
  assert.equal(clean.motion_intensity, "high", "motion_intensity 应小写归一");
  assert.ok(!("mood" in clean), "空值字段应丢弃");
  assert.ok(!("bogus_key" in clean), "白名单外字段应丢弃");
  assert.deepEqual(director.sanitizeSeedanceDesign(null), {}, "非对象应返回空对象");
  assert.deepEqual(director.sanitizeSeedanceDesign(["x"]), {}, "数组应返回空对象");
  assert.deepEqual(
    director.sanitizeSeedanceDesign({ motion_intensity: "insane" }),
    {},
    "非法 motion_intensity 应丢弃(让上层回退)",
  );
}

// parseSeedanceDesignFromPrompt: 从 Stage 1 序列化的 (@图片行 + {json}) 块反解 design
{
  const promptBlock = [
    "@图片1 是「主角」，锁定主体身份。",
    "{",
    '  "style": "全片保持像素风",',
    '  "scene": "深夜便利店",',
    '  "camera_movement": "过肩镜头，长焦压缩",',
    '  "motion_intensity": "low",',
    '  "duration": "8s",',
    '  "dialogue": "无对白"',
    "}",
  ].join("\n");
  const design = director.parseSeedanceDesignFromPrompt(promptBlock);
  assert.equal(design.scene, "深夜便利店", "应解析出 scene");
  assert.equal(design.camera_movement, "过肩镜头，长焦压缩");
  assert.equal(design.motion_intensity, "low");
  assert.ok(!("style" in design), "style 不属于模型驱动字段,应被 sanitize 丢弃");
  assert.ok(!("duration" in design), "duration 应被丢弃(后端计算)");
  assert.ok(!("dialogue" in design), "dialogue 应被丢弃(单独本地化)");
  assert.deepEqual(director.parseSeedanceDesignFromPrompt("没有 JSON 的纯文本"), {}, "无 JSON 应返回空对象");
  assert.deepEqual(director.parseSeedanceDesignFromPrompt("{坏的 json,,,}"), {}, "坏 JSON 应返回空对象不抛错");
  assert.deepEqual(director.parseSeedanceDesignFromPrompt(""), {}, "空串应返回空对象");
}

// seedanceDirectorEnabled: 默认开;显式关闭值→false
{
  const saved = process.env.PIXEL_TOYS_SEEDANCE_DIRECTOR;
  delete process.env.PIXEL_TOYS_SEEDANCE_DIRECTOR;
  assert.equal(director.seedanceDirectorEnabled(), true, "未设应默认开启");
  for (const off of ["0", "false", "off", "no", "OFF"]) {
    process.env.PIXEL_TOYS_SEEDANCE_DIRECTOR = off;
    assert.equal(director.seedanceDirectorEnabled(), false, `${off} 应关闭`);
  }
  process.env.PIXEL_TOYS_SEEDANCE_DIRECTOR = "1";
  assert.equal(director.seedanceDirectorEnabled(), true, "1 应开启");
  if (saved === undefined) delete process.env.PIXEL_TOYS_SEEDANCE_DIRECTOR;
  else process.env.PIXEL_TOYS_SEEDANCE_DIRECTOR = saved;
}

// 导出的方法/常量齐全
{
  assert.ok(Array.isArray(director.SEEDANCE_DESIGN_FIELDS) && director.SEEDANCE_DESIGN_FIELDS.includes("camera_movement"));
  assert.ok(typeof director.SEEDANCE_DIRECTOR_SYSTEM_ZH === "string" && director.SEEDANCE_DIRECTOR_SYSTEM_ZH.includes("导演引擎"));
  assert.ok(!director.SEEDANCE_DESIGN_FIELDS.includes("style"), "style 不应在模型驱动字段里");
  assert.ok(!director.SEEDANCE_DESIGN_FIELDS.includes("duration"));
  assert.ok(!director.SEEDANCE_DESIGN_FIELDS.includes("dialogue"));
}

// --- server.js 静态接线断言 ---
{
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /require\("\.\/server\/seedance-director\.js"\)/, "server.js 必须 require seedance-director 模块");
  assert.match(server, /SEEDANCE_DIRECTOR_SYSTEM_ZH/, "storyboardSystemPrompt 必须注入导演引擎方法");
  assert.match(server, /"design":\s*\{/, "storyboard 输出 schema 必须包含 design 对象");
  assert.match(server, /const videoDesign = sanitizeSeedanceDesign\(raw\.design\)/, "normalizeStoryboardShot 必须捕获模型 design");
  assert.match(server, /const videoDesign = shouldReusePrompt \? parseSeedanceDesignFromPrompt\(originalPrompt\)/, "buildVideoConfig 必须从序列化块反解 design 并 thread");
  assert.match(server, /if \(seedanceDirectorEnabled\(\) && videoDesign && typeof videoDesign === "object"\)/, "seedanceJsonObjectForShot 必须在开关开启时优先用模型 design");
  // style/duration/dialogue 不被模型覆盖
  assert.match(server, /if \(key === "style" \|\| key === "duration" \|\| key === "dialogue"\) continue;/, "style/duration/dialogue 必须锁定不被模型覆盖");
}

console.log("seedance-director tests passed.");
