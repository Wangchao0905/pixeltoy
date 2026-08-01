import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import runner from "./run_asset_generation.js";

function boardGrid(width, height) {
  const margin = Math.max(12, Math.round(width * 0.03));
  const gap = Math.max(6, Math.round(width * 0.0165));
  const maxGridWidth = width - margin * 2;
  const maxGridHeight = height - margin * 2;
  const cellWidth = Math.max(
    40,
    Math.min(
      Math.floor((maxGridWidth - gap * 2) / 3),
      Math.floor(((maxGridHeight - gap * 2) / 3) * 16 / 9),
    ),
  );
  const cellHeight = Math.max(40, Math.round(cellWidth * 9 / 16));
  const gridWidth = cellWidth * 3 + gap * 2;
  const gridHeight = cellHeight * 3 + gap * 2;
  return {
    x: Math.max(0, Math.floor((width - gridWidth) / 2)),
    y: Math.max(0, Math.floor((height - gridHeight) / 2)),
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

try {
  execFileSync(
    "python3",
    [
      "-c",
      [
        "from PIL import Image, ImageDraw",
        "import sys",
        "def grid(w, h):",
        "  margin=max(12, round(w*.03)); gap=max(6, round(w*.0165))",
        "  cw=max(40, min((w-margin*2-gap*2)//3, int((((h-margin*2-gap*2)/3)*16/9))))",
        "  ch=max(40, round(cw*9/16)); gw=cw*3+gap*2; gh=ch*3+gap*2",
        "  return (max(0,(w-gw)//2), max(0,(h-gh)//2), cw, ch, gap)",
        "def board(path, p1, p9):",
        "  im=Image.new('RGB',(1280,720),(236,236,232)); d=ImageDraw.Draw(im); x,y,cw,ch,gap=grid(*im.size)",
        "  for i in range(9):",
        "    px=x+(i%3)*(cw+gap); py=y+(i//3)*(ch+gap)",
        "    d.rectangle((px,py,px+cw-1,py+ch-1), fill=(45,55,65), outline=(15,15,15))",
        "  d.rectangle((x,y,x+cw-1,y+ch-1), fill=p1)",
        "  px=x+2*(cw+gap); py=y+2*(ch+gap); d.rectangle((px,py,px+cw-1,py+ch-1), fill=p9)",
        "  im.save(path)",
        "board(sys.argv[1], (30,80,220), (224,70,42))",
        "board(sys.argv[2], (32,175,90), (90,60,175))",
      ].join("\n"),
      previousBoard,
      currentBoard,
    ],
    { stdio: "pipe" },
  );

  assert.equal(typeof runner.applyStoryboardTailAnchor, "function", "storyboard renderer must expose the deterministic tail-anchor post-process");
  fs.writeFileSync(stalePreviousBoard, "stale");
  fs.writeFileSync(expectedPreviousBoard, "current");
  assert.equal(
    runner.previousStoryboardPath(dir, { type: "Storyboard", name: "SB007_E01_V007_PRODUCTION_BOARD" }, "", new Map([["SB007_E01_V007_PRODUCTION_BOARD", expectedPreviousBoard]])),
    expectedPreviousBoard,
    "the server-provided current sequence map must win over stale boards with the same sequence number",
  );
  runner.applyStoryboardTailAnchor({ type: "Storyboard", name: "SB002_E01_V002_PRODUCTION_BOARD" }, currentBoard, previousBoard);
  const panelPrompt = Array.from({ length: 9 }, (_, index) => `P${index + 1} ${index}-${index + 1}s: visual=continuous scripted action; camera=locked; shot=medium; lens=50mm; lighting=motivated; emotion=focused; dialogue=none; action=hold; continuity=preserve.`).join("\n");
  runner.stampStoryboardProductionTabs({ type: "Storyboard", prompt: panelPrompt }, currentBoard);

  const grid = boardGrid(1280, 720);
  const visualHeight = grid.height - Math.max(96, Math.round(grid.height * 0.48));
  const pixels = JSON.parse(execFileSync(
    "python3",
    ["-c", "from PIL import Image, ImageChops; import json,sys; a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB'); sx,sy,dx,dy,w,h=map(int,sys.argv[3].split(',')); source=a.crop((sx,sy,sx+w,sy+h)); target=b.crop((dx,dy,dx+w,dy+h)); print(json.dumps({'equal': ImageChops.difference(source,target).getbbox() is None, 'source': source.getpixel((w//2,h//2)), 'target': target.getpixel((w//2,h//2))}))", previousBoard, currentBoard, [grid.x + 2 * (grid.width + grid.gap), grid.y + 2 * (grid.height + grid.gap), grid.x, grid.y, grid.width, visualHeight].join(",")],
    { encoding: "utf8" },
  ));
  assert.equal(pixels.equal, true, "the full next-board P1 visual region must exactly equal the previous-board P9 visual region");
  assert.deepEqual(pixels.target, pixels.source, "the copied visual region must preserve the prior board's pixels");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("storyboard tail anchor tests passed");
