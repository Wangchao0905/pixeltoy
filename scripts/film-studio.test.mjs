import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

assert.equal(typeof __test.filmStudio?.selectCandidates, "function", "Film Studio must expose candidate selection rules");
assert.equal(typeof __test.filmStudio?.applyToVideoConfig, "function", "Film Studio must expose video config binding");
assert.equal(typeof __test.filmStudio?.removeFromVideoConfig, "function", "Film Studio must expose a non-destructive video config removal rule");
assert.equal(typeof __test.filmStudio?.normalizeState, "function", "Film Studio must expose its persisted setting normalization");
assert.match(html, /Film Studio/, "the visual bible entry must be renamed to Film Studio");
assert.match(app, /film-studio/, "the client must call the Film Studio endpoint");
assert.match(html, /modernFilmStudioEnabled/, "Film Studio must expose a visible project-level video setting");
assert.match(app, /film-studio\/video-config/, "the client must persist the Film Studio video setting");

const defaultStudio = __test.filmStudio.normalizeState({});
assert.equal(defaultStudio.videoConfigEnabled, false, "Film Studio must be opt-in by default");

const sourceCandidates = [
  { id: "a", role: "wide_empty_scene", sourceUrl: "https://example.test/a.jpg", matchScore: 96, diversityScore: 10 },
  { id: "b", role: "wide_empty_scene", sourceUrl: "https://example.test/a.jpg", matchScore: 94, diversityScore: 4 },
  { id: "c", role: "color", sourceUrl: "https://example.test/c.jpg", matchScore: 91, diversityScore: 8 },
  { id: "d", role: "lighting", sourceUrl: "https://example.test/d.jpg", matchScore: 88, diversityScore: 9 },
  { id: "e", role: "texture", sourceUrl: "https://example.test/e.jpg", matchScore: 84, diversityScore: 8 },
  { id: "f", role: "composition", sourceUrl: "https://example.test/f.jpg", matchScore: 80, diversityScore: 8 },
];
const selected = __test.filmStudio.selectCandidates(sourceCandidates, 5);
assert.equal(selected.length, 5, "Film Studio should return up to five candidates");
assert.equal(new Set(selected.map((item) => item.sourceUrl)).size, selected.length, "duplicate source images must be removed");
assert.equal(new Set(selected.map((item) => item.role)).size, 5, "candidate roles must stay visually comparable but non-repetitive");

const config = __test.filmStudio.applyToVideoConfig(
  { modelName: "seedance-2-0", shots: [{ name: "V001", prompt: "原始提示词", status: "complete" }] },
  {
    selectedReferenceIds: ["a", "d"],
    candidates: selected,
    visualBible: { directive: "冷青色夜景，硬光，宽阔空间" },
  },
);
assert.deepEqual(config.visualReferenceIds, ["a", "d"], "only the chosen references should enter video config");
assert.equal(config.visualBibleVersion, 1, "video config must record the Film Studio bible version");
assert.equal(config.shots[0].status, "complete", "binding Film Studio must not reset generated clips");
assert.match(config.shots[0].prompt, /冷青色夜景/, "the global visual directive must be available to shot prompts");

const disabledConfig = __test.filmStudio.removeFromVideoConfig(config);
assert.equal(disabledConfig.visualReferences, undefined, "disabling Film Studio must remove only Film Studio reference metadata");
assert.equal(disabledConfig.visualReferenceIds, undefined, "disabling Film Studio must remove Film Studio reference ids");
assert.equal(disabledConfig.visualBible, undefined, "disabling Film Studio must remove the visual bible metadata");
assert.equal(disabledConfig.shots[0].filmStudioApplied, undefined, "disabling Film Studio must remove the per-shot Film Studio marker");
assert.equal(disabledConfig.shots[0].status, "complete", "disabling Film Studio must preserve generated clip status");
assert.doesNotMatch(disabledConfig.shots[0].prompt, /Film Studio 全剧视觉方向/, "disabling Film Studio must remove only its prompt directive");
assert.match(disabledConfig.shots[0].prompt, /原始提示词/, "disabling Film Studio must retain the original shot prompt");

console.log("film studio tests passed");
