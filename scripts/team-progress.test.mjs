import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildTeamProjectProgressFacts,
  calculateTeamProjectProgress,
  countGeneratedManifestAssets,
  selectVideoConfigRecord,
  scriptHasMeaningfulBody,
} = require("../server/team-progress.js");

assert.equal(typeof buildTeamProjectProgressFacts, "function");
assert.equal(typeof countGeneratedManifestAssets, "function");
assert.equal(typeof selectVideoConfigRecord, "function");

assert.equal(scriptHasMeaningfulBody("# Title\n\n"), false);
assert.equal(scriptHasMeaningfulBody("#hashtag"), true);
assert.equal(
  scriptHasMeaningfulBody("# Title\n\nINT. ROOM - DAY\n\nAction"),
  true,
);

const completeProject = {
  scriptReady: true,
  plannedAssets: 2,
  generatedAssets: 2,
  storyboardsEnabled: true,
  plannedStoryboards: 2,
  generatedStoryboards: 2,
  plannedShots: 2,
  generatedClips: 2,
};

assert.deepEqual(calculateTeamProjectProgress(completeProject), {
  stage: "complete",
  attention: "",
});
assert.deepEqual(
  calculateTeamProjectProgress({ ...completeProject, scriptReady: false }),
  { stage: "script", attention: "等待完善剧本" },
);
assert.deepEqual(
  calculateTeamProjectProgress({ ...completeProject, plannedAssets: 0 }),
  { stage: "script", attention: "等待资产提取" },
);
assert.deepEqual(
  calculateTeamProjectProgress({ ...completeProject, generatedAssets: 1 }),
  { stage: "assets", attention: "缺少 1 个资产" },
);
assert.deepEqual(
  calculateTeamProjectProgress({ ...completeProject, plannedStoryboards: 0 }),
  { stage: "storyboard", attention: "等待故事板规划" },
);
const storyboardsEnabledByDefault = {
  ...completeProject,
  plannedStoryboards: 0,
};
delete storyboardsEnabledByDefault.storyboardsEnabled;
assert.deepEqual(calculateTeamProjectProgress(storyboardsEnabledByDefault), {
  stage: "storyboard",
  attention: "等待故事板规划",
});
assert.deepEqual(
  calculateTeamProjectProgress({ ...completeProject, generatedStoryboards: 1 }),
  { stage: "storyboard", attention: "缺少 1 个故事板" },
);
assert.deepEqual(
  calculateTeamProjectProgress({
    ...completeProject,
    storyboardsEnabled: false,
    plannedStoryboards: 2,
    generatedStoryboards: 0,
    plannedShots: 0,
  }),
  { stage: "video", attention: "等待视频分镜配置" },
);
assert.deepEqual(
  calculateTeamProjectProgress({ ...completeProject, generatedClips: 1 }),
  { stage: "video", attention: "缺少 1 个视频片段" },
);
assert.deepEqual(
  calculateTeamProjectProgress({
    ...completeProject,
    generatedAssets: 3,
    generatedStoryboards: 3,
    generatedClips: 3,
  }),
  { stage: "complete", attention: "" },
);

assert.deepEqual(
  calculateTeamProjectProgress({
    ...completeProject,
    plannedAssets: 2.9,
    generatedAssets: -1,
  }),
  { stage: "assets", attention: "缺少 2 个资产" },
);

const episodeRoot = path.join(os.tmpdir(), "team-progress-facts", "outputs", "e01");
const manifestItems = [{ id: "C001_ALICE_CHARACTER_SHEET" }, { id: "S001_ROOM_WIDE_ESTABLISHING" }];
const scannedAssets = [
  {
    assetName: "C001_ALICE_CHARACTER_SHEET",
    manifestType: "Character",
    path: path.join(episodeRoot, "04_assets", "characters", "C001_ALICE_CHARACTER_SHEET.png"),
  },
  {
    assetName: "C001_ALICE_CHARACTER_SHEET",
    manifestType: "Character",
    path: path.join(episodeRoot, "04_assets", "characters", "C001_ALICE_CHARACTER_SHEET.jpg"),
  },
  {
    assetName: "S001_ROOM_WIDE_ESTABLISHING",
    manifestType: "Scene",
    path: path.join(episodeRoot, "04_assets", "scenes", "history", "S001_ROOM_WIDE_ESTABLISHING.png"),
  },
  {
    assetName: "S001_ROOM_WIDE_ESTABLISHING",
    manifestType: "Scene",
    path: path.join(episodeRoot, "04_assets", "generation_logs", "S001_ROOM_WIDE_ESTABLISHING.png"),
  },
  {
    assetName: "UNKNOWN_ASSET",
    manifestType: "Prop",
    path: path.join(episodeRoot, "04_assets", "props", "UNKNOWN_ASSET.webp"),
  },
  {
    assetName: "SB001",
    manifestType: "Storyboard",
    path: path.join(episodeRoot, "04_assets", "storyboards", "SB001.png"),
  },
];

assert.equal(countGeneratedManifestAssets({ episodeRoot, manifestItems, scannedAssets }), 1);

const assetFacts = buildTeamProjectProgressFacts({
  episodeRoot,
  scriptText: "# Episode\n\nINT. ROOM - DAY",
  manifestItems,
  scannedAssets,
  configData: { settings: { enableStoryboards: false }, shots: [] },
  generatedStoryboards: 1,
  generatedClips: 0,
});
assert.equal(assetFacts.plannedAssets, 2);
assert.equal(assetFacts.generatedAssets, 1);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-progress-config-"));
try {
  const zeroShotConfigPath = path.join(tempDir, "zero-shot_skill_config.json");
  fs.writeFileSync(
    zeroShotConfigPath,
    JSON.stringify({ episodeRoot, settings: { enableStoryboards: false }, storyboardPlans: [], shots: [] }),
  );
  const zeroShotBefore = {
    files: fs.readdirSync(tempDir),
    content: fs.readFileSync(zeroShotConfigPath, "utf8"),
  };
  assert.equal(selectVideoConfigRecord([zeroShotConfigPath], { episodeRoot }), null);
  const zeroShotRecord = selectVideoConfigRecord([zeroShotConfigPath], { episodeRoot, allowEmptyShots: true });
  assert.deepEqual(zeroShotRecord?.data?.shots, []);
  assert.deepEqual(
    calculateTeamProjectProgress({
      ...completeProject,
      storyboardsEnabled: zeroShotRecord.data.settings.enableStoryboards !== false,
      plannedStoryboards: zeroShotRecord.data.storyboardPlans.length,
      generatedStoryboards: 0,
      plannedShots: zeroShotRecord.data.shots.length,
      generatedClips: 0,
    }),
    { stage: "video", attention: "等待视频分镜配置" },
  );
  assert.deepEqual(fs.readdirSync(tempDir), zeroShotBefore.files);
  assert.equal(fs.readFileSync(zeroShotConfigPath, "utf8"), zeroShotBefore.content);

  const malformedConfigPath = path.join(tempDir, "malformed_skill_config.json");
  fs.writeFileSync(malformedConfigPath, "{ malformed");
  const malformedBefore = {
    files: fs.readdirSync(tempDir),
    content: fs.readFileSync(malformedConfigPath, "utf8"),
  };
  const malformedConfigData = selectVideoConfigRecord([malformedConfigPath], { episodeRoot, allowEmptyShots: true })?.data || {};
  assert.deepEqual(malformedConfigData, {});
  assert.deepEqual(fs.readdirSync(tempDir), malformedBefore.files);
  assert.equal(fs.readFileSync(malformedConfigPath, "utf8"), malformedBefore.content);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("team progress tests passed");
