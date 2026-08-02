import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import runner from "./run_asset_generation.js";

// 必须与 run_asset_generation.js 里 applyStoryboardTailAnchor 的 grid_geometry 完全一致。
// 版式是 4×3 十二格,且网格只占 body(页眉 12% / 页脚 7% / 右侧栏 20% 之外的那块)——
// 按整幅居中算会裁到页脚或侧栏,尾帧就接错格子。
const COLS = 4;
const ROWS = 3;
const HEADER_RATIO = 0.12;
const FOOTER_RATIO = 0.07;
const SIDEBAR_RATIO = 0.2;

function boardGrid(width, height) {
  const gap = Math.max(6, Math.round(width * 0.011));
  const bodyTop = Math.round(height * HEADER_RATIO);
  const bodyHeight = Math.round(height * (1 - HEADER_RATIO - FOOTER_RATIO));
  const bodyWidth = Math.round(width * (1 - SIDEBAR_RATIO));
  const margin = Math.max(8, Math.round(width * 0.018));
  const maxGridWidth = bodyWidth - margin * 2;
  const maxGridHeight = bodyHeight - margin * 2;
  const cellWidth = Math.max(
    40,
    Math.min(
      Math.floor((maxGridWidth - gap * (COLS - 1)) / COLS),
      Math.floor(((maxGridHeight - gap * (ROWS - 1)) / ROWS) * 16 / 9),
    ),
  );
  const cellHeight = Math.max(40, Math.round(cellWidth * 9 / 16));
  const gridWidth = cellWidth * COLS + gap * (COLS - 1);
  const gridHeight = cellHeight * ROWS + gap * (ROWS - 1);
  return {
    x: Math.max(0, margin + Math.floor((maxGridWidth - gridWidth) / 2)),
    y: Math.max(0, bodyTop + margin + Math.floor((maxGridHeight - gridHeight) / 2)),
    width: cellWidth,
    height: cellHeight,
    gap,
  };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-storyboard-anchor-"));
const previousBoard = path.join(dir, "SB001_E01_V001_PRODUCTION_BOARD.png");
const currentBoard = path.join(dir, "SB002_E01_V002_PRODUCTION_BOARD.png");
const stalePreviousBoard = path.join(dir, "SB006_E01_V006_PRODUCTION_BOARD.png");
const expectedPreviousBoard = path.join(dir, "SB006_E01_V006_TO_E01_V007_PRODUCTION_BOARD.png");

// 画一张假板:12 格铺满 body 网格,首格与末格填成可辨识的纯色,
// 用来验证"末格像素被原样搬到下一张首格"。
const painter = [
  "from PIL import Image, ImageDraw",
  "import sys",
  `COLS, ROWS = ${COLS}, ${ROWS}`,
  `HEADER, FOOTER, SIDEBAR = ${HEADER_RATIO}, ${FOOTER_RATIO}, ${SIDEBAR_RATIO}`,
  "def grid(w, h):",
  "  gap=max(6, round(w*0.0110))",
  "  body_top=round(h*HEADER); body_h=round(h*(1.0-HEADER-FOOTER)); body_w=round(w*(1.0-SIDEBAR))",
  "  margin=max(8, round(w*0.018))",
  "  mgw=body_w-margin*2; mgh=body_h-margin*2",
  "  cw=max(40, min((mgw-gap*(COLS-1))//COLS, int(((mgh-gap*(ROWS-1))/ROWS)*16/9)))",
  "  ch=max(40, round(cw*9/16))",
  "  gw=cw*COLS+gap*(COLS-1); gh=ch*ROWS+gap*(ROWS-1)",
  "  return (max(0, margin+(mgw-gw)//2), max(0, body_top+margin+(mgh-gh)//2), cw, ch, gap)",
  "def board(path, first, last):",
  "  im=Image.new('RGB',(1280,720),(236,236,232)); d=ImageDraw.Draw(im); x,y,cw,ch,gap=grid(*im.size)",
  "  for i in range(COLS*ROWS):",
  "    px=x+(i%COLS)*(cw+gap); py=y+(i//COLS)*(ch+gap)",
  "    d.rectangle((px,py,px+cw-1,py+ch-1), fill=(45,55,65), outline=(15,15,15))",
  "  d.rectangle((x,y,x+cw-1,y+ch-1), fill=first)",
  "  px=x+(COLS-1)*(cw+gap); py=y+(ROWS-1)*(ch+gap)",
  "  d.rectangle((px,py,px+cw-1,py+ch-1), fill=last)",
  "  im.save(path)",
  "board(sys.argv[1], (30,80,220), (224,70,42))",
  "board(sys.argv[2], (32,175,90), (90,60,175))",
].join("\n");

try {
  execFileSync("python3", ["-c", painter, previousBoard, currentBoard], { stdio: "pipe" });

  assert.equal(typeof runner.applyStoryboardTailAnchor, "function", "storyboard renderer must expose the deterministic tail-anchor post-process");
  fs.writeFileSync(stalePreviousBoard, "stale");
  fs.writeFileSync(expectedPreviousBoard, "current");
  assert.equal(
    runner.previousStoryboardPath(
      dir,
      { type: "Storyboard", name: "SB007_E01_V007_PRODUCTION_BOARD" },
      "",
      new Map([["SB007_E01_V007_PRODUCTION_BOARD", expectedPreviousBoard]]),
    ),
    expectedPreviousBoard,
    "the server-provided current sequence map must win over stale boards with the same sequence number",
  );
  runner.applyStoryboardTailAnchor({ type: "Storyboard", name: "SB002_E01_V002_PRODUCTION_BOARD" }, currentBoard, previousBoard);

  // 搬运是"内缩"的:格子边线由模型画在 cell 内侧,整格照搬会把源格边框也搬来,
  // 盖在目标格自己的边框上,出来是双层边线夹着压扁的画面(用户报的"图像不完整")。
  // 所以断言改成:内缩区域的画面一致,而目标格最外圈仍是它自己的边框。
  const grid = boardGrid(1280, 720);
  const inset = Math.max(2, Math.round(Math.min(grid.width, grid.height) * 0.035));
  const probe = "from PIL import Image, ImageChops; import json,sys; a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB'); sx,sy,dx,dy,w,h,ins=map(int,sys.argv[3].split(',')); source=a.crop((sx+ins,sy+ins,sx+w-ins,sy+h-ins)); target=b.crop((dx+ins,dy+ins,dx+w-ins,dy+h-ins)); print(json.dumps({'equal': ImageChops.difference(source,target).getbbox() is None, 'source': source.getpixel((source.width//2,source.height//2)), 'target': target.getpixel((target.width//2,target.height//2)), 'target_edge': b.getpixel((dx,dy))}))";
  const region = [
    grid.x + (COLS - 1) * (grid.width + grid.gap),
    grid.y + (ROWS - 1) * (grid.height + grid.gap),
    grid.x,
    grid.y,
    grid.width,
    grid.height,
    inset,
  ].join(",");
  const pixels = JSON.parse(execFileSync("python3", ["-c", probe, previousBoard, currentBoard, region], { encoding: "utf8" }));
  assert.equal(pixels.equal, true, "the inset content of the next board's first panel must equal the previous board's last panel");
  assert.deepEqual(pixels.target, pixels.source, "the copied content must preserve the prior board's pixels");
  assert.deepEqual(pixels.source, [224, 70, 42], "the anchor must be cropped from the last cell, not a middle column");
  assert.notDeepEqual(pixels.target_edge, [224, 70, 42], "目标格最外圈必须留给它自己的边框,不能被源格边框覆盖");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("storyboard tail anchor tests passed");
