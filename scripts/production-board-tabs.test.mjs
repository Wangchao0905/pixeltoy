import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import runner from "./run_asset_generation.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-production-tab-"));
const board = path.join(dir, "SB001_E01_V001_PRODUCTION_BOARD.png");
const character = path.join(dir, "C001_LIN_XIA.png");
const scene = path.join(dir, "S001_ROOFTOP.png");

try {
  execFileSync(
    "python3",
    [
      "-c",
      "from PIL import Image; import sys; Image.new('RGB', (720, 1280), (112, 96, 78)).save(sys.argv[1]); Image.new('RGB', (180, 320), (190, 70, 55)).save(sys.argv[2]); Image.new('RGB', (320, 180), (45, 90, 145)).save(sys.argv[3])",
      board,
      character,
      scene,
    ],
    { stdio: "pipe" },
  );
  const panels = Array.from({ length: 9 }, (_, index) => {
    const n = index + 1;
    return `P${n} ${(n - 1) * 1.6}-${n * 1.6}s: visual=Lin Xia crosses the rainy rooftop and sees the signal flare above the city; camera=low tracking camera; shot=medium full shot; lens=35mm; lighting=blue rain practicals; emotion=controlled fear; dialogue=Lin Xia: \"Do not let them see the flare.\"; action=she shields the flare and runs toward the exit; continuity=the red flare remains in her right hand.`;
  }).join("\n");
  runner.stampStoryboardProductionTabs(
    {
      type: "Storyboard",
      prompt: `Asset bindings: PT-C001 = C001_LIN_XIA; PT-S001 = S001_ROOFTOP\n${panels}`,
    },
    board,
    [character, scene],
  );
  const stats = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "from PIL import Image; import json, sys; im=Image.open(sys.argv[1]).convert('RGB'); print(json.dumps({'size': im.size, 'tab': im.getpixel((120, 334)), 'header': im.getpixel((120, 275)), 'thumb': im.getpixel((80, 420))}))",
        board,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(stats.size, [720, 1280], "post-process must preserve the portrait board canvas");
  assert.notDeepEqual(stats.tab, [112, 96, 78], "production tab must replace the generated image at the bottom of each panel");
  assert.notDeepEqual(stats.header, [112, 96, 78], "production tab header must be visibly rendered");
  assert.deepEqual(stats.thumb, [190, 70, 55], "visible reference thumbnails must be rendered in every panel tab");
} finally {
  if (process.env.PIXEL_TOYS_KEEP_TEST_ARTIFACTS !== "1") {
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    console.log(`production board fixture: ${board}`);
  }
}

console.log("production board tab tests passed");
