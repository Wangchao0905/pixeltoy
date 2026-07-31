import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.argv[2] || process.cwd();
const app = readFileSync(resolve(root, "public", "app.js"), "utf8");

assert.match(
  app,
  /async function saveFileQuiet\(key, \{ content \} = \{\}\)[\s\S]*?const savedContent = typeof content === "string" \? content : editor\?\.value;/,
  "quiet saves must accept the source value captured before a render",
);
assert.match(
  app,
  /async function persistAssetExtractionSources\(script, assetDescription\)[\s\S]*?await saveFileQuiet\("script", \{ content: script \}\);[\s\S]*?await saveFileQuiet\("assetDescription", \{ content: assetDescription \}\);[\s\S]*?contents:[\s\S]*?script,[\s\S]*?assetDescription,/,
  "asset extraction must persist and retain both source editors before rendering progress",
);
assert.match(
  app,
  /const capturedScriptText[\s\S]*?const capturedAssetDescriptionText[\s\S]*?await persistAssetExtractionSources\(capturedScriptText, capturedAssetDescriptionText\);[\s\S]*?state\.uiBusy\.assetExtracting = true;[\s\S]*?renderWorkspace\(\);/,
  "the parsing progress render must occur only after both source values are retained",
);

console.log("asset extraction source persistence checks passed");
