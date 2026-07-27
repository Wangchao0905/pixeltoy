import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const lightweightProjectSummarySource = server.slice(
  server.indexOf("function lightweightProjectSummary"),
  server.indexOf("function scanEpisodeRoots"),
);
const locateConfigSource = server.slice(
  server.indexOf("function locateConfig"),
  server.indexOf("function mediaItem"),
);

assert.match(server, /require\("\.\/server\/team-store\.js"\)/);
assert.match(server, /require\("\.\/server\/team-progress\.js"\)/);
assert.match(server, /calculateTeamProjectProgress/);
assert.match(server, /plannedStoryboards/);
assert.match(server, /storyboardsEnabled/);
assert.match(server, /plannedShots/);
assert.match(server, /attention/);
assert.match(lightweightProjectSummarySource, /const scriptText = readText\(scriptPath\)/);
assert.equal((lightweightProjectSummarySource.match(/readText\(scriptPath\)/g) || []).length, 1);
assert.match(lightweightProjectSummarySource, /readVideoConfig\(episodeRoot, \{ allowEmptyShots: true \}\)\?\.data \|\| \{\}/);
assert.match(lightweightProjectSummarySource, /normalizeAssetManifest\(manifest \|\| \{\}\)\.items \|\| \[\]/);
assert.match(lightweightProjectSummarySource, /const scannedAssets = scanAssets\(episodeRoot\)/);
assert.equal((lightweightProjectSummarySource.match(/scanAssets\(episodeRoot\)/g) || []).length, 1);
assert.match(lightweightProjectSummarySource, /buildTeamProjectProgressFacts\(\{/);
assert.match(lightweightProjectSummarySource, /calculateTeamProjectProgress\(progressFacts\)/);
assert.match(lightweightProjectSummarySource, /stage: teamProgress\.stage/);
assert.match(lightweightProjectSummarySource, /attention: teamProgress\.attention/);
assert.match(lightweightProjectSummarySource, /plannedStoryboards: progressFacts\.plannedStoryboards/);
assert.match(lightweightProjectSummarySource, /storyboards: storyboardCount/);
assert.match(lightweightProjectSummarySource, /plannedShots: progressFacts\.plannedShots/);
assert.doesNotMatch(lightweightProjectSummarySource, /walkFiles\(path\.join\(episodeRoot, "04_assets"/);
assert.match(lightweightProjectSummarySource, /const rawVideoFiles = walkFiles/);
assert.match(lightweightProjectSummarySource, /preview: previewMedia/);
assert.doesNotMatch(lightweightProjectSummarySource, /ensureVideoConfigIsolation|writeWorkflowState/);
assert.match(locateConfigSource, /function locateConfig\(episodeRoot, options = \{\}\)/);
assert.match(locateConfigSource, /selectVideoConfigRecord\(files, \{/);
assert.match(locateConfigSource, /allowEmptyShots: options\.allowEmptyShots === true/);
assert.match(server, /const TEAM_STORE_PATH = path\.join\(APP_ROOT, "\.pixel-toys-teams\.json"\)/);
assert.match(server, /function currentTeamSummary/);
assert.match(server, /url\.pathname === "\/api\/team"/);
assert.match(server, /url\.pathname === "\/api\/team\/join"/);
assert.match(server, /url\.pathname === "\/api\/team\/leave"/);
assert.match(server, /url\.pathname === "\/api\/team\/invite"/);
assert.match(server, /const teamMemberMatch = url\.pathname\.match/);
assert.match(server, /teamStore\.removeMember/);
assert.match(server, /url\.pathname === "\/api\/team\/transfer"/);
assert.match(server, /teamId:/);
assert.match(server, /teamRole:/);
assert.match(server, /function projectScopeRecord/);
assert.match(server, /scanEpisodeRoots\(\)\.filter\(\(episodeRoot\) => userCanAccessProject\(user, episodeRoot\)\)/);
assert.match(server, /function assertUserCanDeleteProject/);
assert.match(server, /action === "team"/);
assert.match(server, /action === "duplicate-personal"/);
assert.match(server, /lastModifiedByUserId/);
assert.match(server, /function canvasScopeRecord/);
assert.match(server, /function userCanAccessCanvasState/);
assert.match(server, /function deleteBlankCanvas[\s\S]{0,1200}statusCode = 404/);
assert.match(server, /url\.pathname === "\/api\/canvas\/blank-team"/);
assert.match(server, /url\.pathname === "\/api\/canvas\/blank-duplicate-personal"/);
assert.match(server, /listBlankCanvases\(user\)/);
assert.match(server, /url\.pathname === "\/api\/team\/resources"/);
assert.match(server, /action === "references"/);
assert.match(server, /const referenceUpdateMatch = action\.match/);
assert.match(server, /updateReference\(current, snapshot/);
assert.match(server, /function teamResourceCatalog/);
assert.match(server, /function copyReferenceImageSnapshot/);
console.log("team server wiring tests passed");
