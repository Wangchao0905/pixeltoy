import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.argv[2] || process.cwd();
const app = readFileSync(resolve(root, "public/app.js"), "utf8");
const server = readFileSync(resolve(root, "server.js"), "utf8");

assert.match(
  app,
  /const configShot = shot\?\.name \? videoPromptShot\(shot\.name\) : null;[\s\S]*?configShot\s*\?\s*videoModelForShot\(configShot\)/,
  "the video model selector must resolve from the persisted selected shot rather than its display label",
);
assert.match(
  app,
  /if \(selected\?\.name\) state\.selectedVideoShotName = selected\.name;/,
  "the selected shot id must match the shot displayed by the modern parameter strip",
);
assert.match(
  server,
  /const supportedModels = new Set\(\[[^\]]*"grok-imagine-video"[^\]]*\]\);/,
  "every model exposed in the modern selector must be accepted for a per-shot override",
);
assert.doesNotMatch(
  server,
  /seedance-2-0-person-reference/,
  "the removed person-reference model must not remain in server model configuration",
);

console.log("video model persistence checks passed");
