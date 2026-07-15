const fs = require("node:fs");
const path = require("node:path");

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function scriptHasMeaningfulBody(script) {
  return String(script ?? "")
    .split(/\r?\n/)
    .some((line) => {
      const trimmed = line.trim();
      return trimmed && !/^#{1,6}\s+/.test(trimmed);
    });
}

function countGeneratedManifestAssets({ episodeRoot, manifestItems = [], scannedAssets = [] } = {}) {
  const assetRoot = path.join(path.resolve(episodeRoot || "."), "04_assets");
  const plannedNames = new Set(manifestItems.map((item) => String(item?.id || "").trim()).filter(Boolean));
  const generatedNames = new Set();
  for (const asset of scannedAssets) {
    const assetName = String(asset?.assetName || "").trim();
    const filePath = path.resolve(asset?.path || "");
    const relativePath = path.relative(assetRoot, filePath);
    const parts = relativePath.split(path.sep);
    if (!plannedNames.has(assetName)) continue;
    if (parts.length !== 2 || !["characters", "scenes", "props"].includes(parts[0])) continue;
    if (!/\.(png|jpg|jpeg|webp)$/i.test(parts[1])) continue;
    if (path.basename(parts[1]).replace(/\.(png|jpg|jpeg|webp)$/i, "") !== assetName) continue;
    generatedNames.add(assetName);
  }
  return generatedNames.size;
}

function selectVideoConfigRecord(candidateFiles = [], options = {}) {
  const expectedEpisodeRoot = options.episodeRoot ? path.resolve(options.episodeRoot) : "";
  const records = [];
  for (const file of new Set(candidateFiles)) {
    try {
      if (!fs.statSync(file).isFile()) continue;
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const configEpisodeRoot = String(data?.episodeRoot || "").trim();
      if (expectedEpisodeRoot && configEpisodeRoot && path.resolve(configEpisodeRoot) !== expectedEpisodeRoot) continue;
      if (!Array.isArray(data?.shots)) continue;
      if (!options.allowEmptyShots && data.shots.length === 0) continue;
      records.push({ file, data, modifiedAt: fs.statSync(file).mtimeMs });
    } catch {
      // Malformed or unreadable candidates are not usable configs.
    }
  }
  records.sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!records.length) return null;
  const { file, data } = records[0];
  return { file, data };
}

function buildTeamProjectProgressFacts({
  episodeRoot,
  scriptText = "",
  manifestItems = [],
  scannedAssets = [],
  configData = {},
  generatedStoryboards = 0,
  generatedClips = 0,
} = {}) {
  return {
    scriptReady: scriptHasMeaningfulBody(scriptText),
    plannedAssets: manifestItems.length,
    generatedAssets: countGeneratedManifestAssets({ episodeRoot, manifestItems, scannedAssets }),
    plannedStoryboards: Array.isArray(configData.storyboardPlans) ? configData.storyboardPlans.length : 0,
    generatedStoryboards,
    plannedShots: Array.isArray(configData.shots) ? configData.shots.length : 0,
    generatedClips,
    storyboardsEnabled: configData.settings?.enableStoryboards !== false,
  };
}

function calculateTeamProjectProgress(project = {}) {
  const plannedAssets = normalizeCount(project.plannedAssets);
  const generatedAssets = normalizeCount(project.generatedAssets);
  const plannedStoryboards = normalizeCount(project.plannedStoryboards);
  const generatedStoryboards = normalizeCount(project.generatedStoryboards);
  const plannedShots = normalizeCount(project.plannedShots);
  const generatedClips = normalizeCount(project.generatedClips);
  const storyboardsEnabled = project.storyboardsEnabled !== false;

  if (!project.scriptReady) {
    return { stage: "script", attention: "等待完善剧本" };
  }
  if (plannedAssets === 0) {
    return { stage: "script", attention: "等待资产提取" };
  }
  if (generatedAssets < plannedAssets) {
    return {
      stage: "assets",
      attention: `缺少 ${plannedAssets - generatedAssets} 个资产`,
    };
  }
  if (storyboardsEnabled) {
    if (plannedStoryboards === 0) {
      return { stage: "storyboard", attention: "等待故事板规划" };
    }
    if (generatedStoryboards < plannedStoryboards) {
      return {
        stage: "storyboard",
        attention: `缺少 ${plannedStoryboards - generatedStoryboards} 个故事板`,
      };
    }
  }
  if (plannedShots === 0) {
    return { stage: "video", attention: "等待视频分镜配置" };
  }
  if (generatedClips < plannedShots) {
    return {
      stage: "video",
      attention: `缺少 ${plannedShots - generatedClips} 个视频片段`,
    };
  }
  return { stage: "complete", attention: "" };
}

module.exports = {
  buildTeamProjectProgressFacts,
  calculateTeamProjectProgress,
  countGeneratedManifestAssets,
  selectVideoConfigRecord,
  scriptHasMeaningfulBody,
};
