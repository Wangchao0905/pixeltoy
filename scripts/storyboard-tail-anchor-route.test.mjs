import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import serverModule from "../server.js";

const writeTailAnchorMap = serverModule.__test?.durationMode?.storyboardTailAnchorMapPath;
assert.equal(typeof writeTailAnchorMap, "function", "storyboard job routing must export the tail-anchor map writer");

const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-storyboard-anchor-route-"));
const episodeRoot = path.join(projectRoot, "outputs", "e01");
try {
  fs.mkdirSync(episodeRoot, { recursive: true });
  const firstPath = path.join(projectRoot, "assets", "storyboards", "SB001_E01_V001_PRODUCTION_BOARD.png");
  const slots = [
    { id: "SB001_E01_V001_PRODUCTION_BOARD", asset: { path: firstPath } },
    { id: "SB002_E01_V002_PRODUCTION_BOARD" },
    { id: "SB003_E01_V003_PRODUCTION_BOARD" },
  ];
  const mapPath = writeTailAnchorMap(episodeRoot, slots, slots.slice(1).map((slot) => slot.id));
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));

  assert.equal(map.SB002_E01_V002_PRODUCTION_BOARD, firstPath, "a selected board must receive the exact current predecessor path");
  assert.equal(
    map.SB003_E01_V003_PRODUCTION_BOARD,
    path.join(projectRoot, "assets", "storyboards", "SB002_E01_V002_PRODUCTION_BOARD.png"),
    "a selected batch must point the next board at the file generated immediately before it",
  );
} finally {
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

console.log("storyboard tail anchor route tests passed");
