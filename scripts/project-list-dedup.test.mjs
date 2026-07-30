import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const server = require(path.join(root, "server.js"));
const projectList = server.__test?.projectList;
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.equal(typeof projectList?.groupProjectSummariesForList, "function", "project list grouping helper must be exposed");

const sharedProjectDir = path.join(root, "test-project", "囚日_视觉资产 2");
const makeEpisode = (slug, updatedAt, counts, canDelete = true) => ({
  id: `/tmp/${slug}`,
  title: "囚日_视觉资产 2",
  seriesTitle: "囚日_视觉资产 2",
  displayTitle: `囚日_视觉资产 2 / ${slug.toUpperCase()}`,
  episodeLabel: slug.toUpperCase(),
  episodeCode: slug.toUpperCase(),
  episodeSlug: slug,
  episodeRoot: path.join(sharedProjectDir, "outputs", slug),
  projectDir: sharedProjectDir,
  counts,
  preview: { url: `/media/${slug}.mp4`, type: "video" },
  updatedAt,
  scope: "personal",
  canDelete,
});

const grouped = projectList.groupProjectSummariesForList([
  makeEpisode("e02", "2026-07-30T02:00:00.000Z", { assets: 4, parsedAssets: 6, rawClips: 3, plannedAssets: 5, plannedStoryboards: 1, storyboards: 1, plannedShots: 2 }),
  makeEpisode("e01", "2026-07-30T01:00:00.000Z", { assets: 9, parsedAssets: 4, rawClips: 2, plannedAssets: 3, plannedStoryboards: 2, storyboards: 2, plannedShots: 4 }),
]);

assert.equal(grouped.length, 1, "same projectDir must produce one project card");
assert.equal(grouped[0].displayTitle, "囚日_视觉资产 2", "merged card must use the project title without an episode suffix");
assert.deepEqual(grouped[0].episodes.map((episode) => episode.episodeSlug), ["e01", "e02"], "episodes must remain available in natural order");
assert.equal(grouped[0].episodeCount, 2, "merged card must expose its episode count");
assert.equal(grouped[0].counts.assets, 9, "shared asset count must use the largest episode value");
assert.equal(grouped[0].counts.parsedAssets, 6, "shared parsed asset count must use the largest episode value");
assert.equal(grouped[0].counts.rawClips, 5, "per-episode clip counts must be summed");
assert.equal(grouped[0].counts.storyboards, 3, "per-episode storyboard counts must be summed");
assert.equal(grouped[0].preview.url, "/media/e02.mp4", "the newest episode supplies the project preview");
assert.equal(grouped[0].canDelete, false, "multi-episode cards must not expose episode deletion");

const otherProject = makeEpisode("e01", "2026-07-29T01:00:00.000Z", { assets: 1, parsedAssets: 1, rawClips: 0 });
otherProject.projectDir = path.join(root, "test-project", "another-project");
const separated = projectList.groupProjectSummariesForList([...grouped[0].episodes, otherProject]);
assert.equal(separated.length, 2, "different projectDir values must remain separate projects");

assert.match(app, /function projectListIncludesEpisode\(/, "front end must recognize an episode nested in a project card");
assert.match(app, /state\.projects\.some\(\(project\) => projectListIncludesEpisode\(project, INITIAL_PROJECT_ID\)\)/, "deep-linked episodes must remain openable");
assert.match(app, /projectListIncludesEpisode\(project, state\.selectedId\)/, "active project state must follow the selected episode");
assert.match(app, /function projectEpisodeListLabel\(/, "project cards must show a compact episode summary");
assert.ok(packageJson.scripts.test.includes("node scripts/project-list-dedup.test.mjs"), "project list dedup test must be in the npm test chain");

console.log("project list dedup tests passed");
