import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import runner from "./run_asset_generation.js";

// 侧栏必须贴真实资产 PNG,不能交给模型画:扩散模型只会得到"对资产图的彩色再创作"。
// 这个测试证明贴进去的像素与源文件一致,且分类按 C/P/S 落到对应分区。
assert.equal(typeof runner.stampStoryboardSidebar, "function", "必须导出侧栏后处理");
assert.equal(typeof runner.storyboardSidebarSections, "function", "必须导出侧栏分区计算");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-sidebar-"));
try {
  // 三类各造两张纯色图,颜色互不相同,便于按像素断言"贴对了哪张"。
  const swatches = [
    ["C001_HERO_CHARACTER_SHEET.png", "220,40,40"],
    ["C002_ALLY_CHARACTER_SHEET.png", "40,180,60"],
    ["P001_KEY_PROP_REF.png", "40,80,220"],
    ["S001_ROOM_WIDE_ESTABLISHING.png", "240,200,40"],
  ];
  const py = [
    "from PIL import Image",
    "import sys",
    "for spec in sys.argv[1:]:",
    "  p, rgb = spec.split('|')",
    "  Image.new('RGB', (320, 180), tuple(int(v) for v in rgb.split(','))).save(p)",
  ].join("\n");
  execFileSync("python3", ["-c", py, ...swatches.map(([n, c]) => `${path.join(dir, n)}|${c}`)], { stdio: "pipe" });

  const sections = runner.storyboardSidebarSections(swatches.map(([n]) => path.join(dir, n)));
  assert.deepEqual(sections.map((s) => s.heading), ["CHARACTER / CASTING", "PROP REFERENCE", "LOCATION / SET"]);
  assert.equal(sections[0].slots.length, 2, "两张角色图都要进 casting 区");
  assert.equal(sections[1].slots.length, 1, "一张道具图");
  assert.equal(sections[2].slots.length, 1, "一张场景图");

  // 造一张 1280x720 的"模型输出":右 20% 留白,其余填灰,模拟提示词被遵守的情况。
  const board = path.join(dir, "SB001_E01_V001_PRODUCTION_BOARD.png");
  execFileSync("python3", ["-c", [
    "from PIL import Image, ImageDraw",
    "import sys",
    "im = Image.new('RGB', (1280, 720), (255, 255, 255))",
    "d = ImageDraw.Draw(im)",
    "d.rectangle((0, 86, 1023, 669), fill=(160, 160, 160))",
    "im.save(sys.argv[1])",
  ].join("\n"), board], { stdio: "pipe" });

  const ok = runner.stampStoryboardSidebar({ type: "Storyboard", name: "SB001_E01_V001_PRODUCTION_BOARD" }, board, swatches.map(([n]) => path.join(dir, n)));
  assert.equal(ok, true, "侧栏后处理必须成功");

  // 断言:右栏出现了两种角色色,且左栏(面板区)未被污染。
  const probe = [
    "from PIL import Image",
    "import json, sys",
    "im = Image.open(sys.argv[1]).convert('RGB')",
    "w, h = im.size",
    "strip = im.crop((round(w * 0.8), round(h * 0.12), w, h - round(h * 0.07)))",
    "colours = {c[1] for c in strip.getcolors(maxcolors=1000000)}",
    "left = im.crop((0, round(h * 0.12), round(w * 0.8) - 4, h - round(h * 0.07)))",
    "left_colours = {c[1] for c in left.getcolors(maxcolors=1000000)}",
    "print(json.dumps({",
    "  'hero': (220, 40, 40) in colours,",
    "  'ally': (40, 180, 60) in colours,",
    "  'prop': (40, 80, 220) in colours,",
    "  'scene': (240, 200, 40) in colours,",
    "  'left_clean': (220, 40, 40) not in left_colours and (40, 80, 220) not in left_colours,",
    "}))",
  ].join("\n");
  const result = JSON.parse(execFileSync("python3", ["-c", probe, board], { encoding: "utf8" }));
  assert.equal(result.hero, true, "角色图 1 必须出现在侧栏");
  assert.equal(result.ally, true, "角色图 2 必须出现在侧栏");
  assert.equal(result.prop, true, "道具图必须出现在侧栏");
  assert.equal(result.scene, true, "场景图必须出现在侧栏");
  assert.equal(result.left_clean, true, "侧栏后处理不得越界污染左侧面板区");

  // 没有可用资产时必须安静跳过,不能把侧栏刷成空白框。
  assert.equal(runner.stampStoryboardSidebar({ type: "Storyboard", name: "SB002" }, board, []), false, "无资产时应跳过");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("storyboard sidebar stamp tests passed");
