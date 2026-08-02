import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");

assert.match(html, /id="newDraft"[^>]*>[^<]*<span[^>]*>\+<\/span>\s*新建剧集/, "new story action must be explicit");
assert.match(app, /function startNewDraft\(\)[\s\S]*localStorage\.setItem\(SESSION_STORAGE_KEY[\s\S]*window\.location\.reload\(\)/, "new story must rotate the session before reloading");
assert.match(app, /function userFacingError\(error\)/, "provider errors must be normalized for users");
assert.match(app, /next-step-error[\s\S]*role="alert"/, "run errors must remain visible beside the next action");
assert.match(app, /const actionCopy = state\.lastError[\s\S]*生成失败：\$\{state\.lastError\}/, "next action must explain a failed run");
assert.match(app, /function renderBriefArtifact\(\)/, "brief output must show its generated artifact and review state");
assert.match(app, /复核未通过[\s\S]*修改后重新生成/, "brief review failures must explain how to continue");

console.log("pixeltale workflow contract ok");
