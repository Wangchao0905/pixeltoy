import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");
const start = server.indexOf("async function buildVideoConfig(");
const end = server.indexOf("function clearVideoArtifactsForNewCanvas", start);

assert.notEqual(start, -1, "video configuration builder must exist");
assert.notEqual(end, -1, "video configuration builder boundary must exist");

const buildVideoConfig = server.slice(start, end);
assert.match(
  buildVideoConfig,
  /const promptPath = findProjectFile\(episodeRoot, "seedancePrompts"\);[\s\S]*?promptsPath: path\.relative\(episodeRoot, promptPath\),/,
  "video configuration must resolve the prompt file before persisting promptsPath",
);

console.log("video config runtime guard tests passed");
