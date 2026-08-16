import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const nestedHtml = fs.readFileSync(path.join(root, "public/pixeltale/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const require = createRequire(import.meta.url);
const { __test: testApi } = require(path.join(root, "server.js"));

assert.match(html, /id="openHistory"[^>]*>[^<]*<span[^>]*>↺<\/span>\s*创作历史/, "PixelTale must expose a visible creative history entry");
assert.match(html, /id="historyDialog"/, "PixelTale must provide a history dialog");
assert.match(nestedHtml, /id="openHistory"/, "the nested PixelTale page must keep the history entry");
assert.match(app, /async function loadCreativeHistory\(\)[\s\S]*request\("\/history"\)/, "history must load from the server session index");
assert.match(app, /async function deleteHistorySession\(targetSessionId[\s\S]*method: "DELETE"/, "history items must expose a delete action backed by the API");
assert.match(app, /data-history-delete/, "history items must expose a delete control");
assert.match(app, /function resumeHistorySession\(nextSessionId\)[\s\S]*searchParams\.set\("session", nextSessionId\)/, "history items must restore their original session");
assert.match(app, /const sameSession = nextSessionId === currentSession \|\| nextSessionId === sessionId[\s\S]*syncAgentState\(\{ silent: false \}\)/, "the current history session must hydrate in place instead of relying on a no-op reload");
assert.doesNotMatch(app, /function resumeHistorySession\(nextSessionId\)[\s\S]*window\.location\.reload\(\)/, "resuming the current session must not depend on a full-page reload");
assert.match(app, /function createSessionId\(\)[\s\S]*localStorage\.setItem\(SESSION_STORAGE_KEY, querySession\)/, "URL session recovery must persist the selected session");
assert.match(app, /function startNewDraft\(\)[\s\S]*searchParams\.set\("session", freshSession\)[\s\S]*window\.location\.assign/, "new drafts must not be captured by an old session query");
assert.match(serverSource, /action === "history"[\s\S]*pixelTaleHistorySummaries/, "server must expose the read-only history endpoint");
assert.match(serverSource, /method === "DELETE"[\s\S]*deletePixelTaleHistorySession/, "server must expose a guarded history deletion endpoint");

const historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltale-history-"));
const firstSession = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
fs.mkdirSync(path.join(historyRoot, firstSession), { recursive: true });
fs.mkdirSync(path.join(historyRoot, secondSession), { recursive: true });
fs.mkdirSync(path.join(historyRoot, "short"), { recursive: true });
fs.writeFileSync(path.join(historyRoot, firstSession, "pixel_tale_state.json"), JSON.stringify({
  mode: "tk_short_drama",
  stage: "arc",
  input: { storyTitle: "The Last Signal", idea: "A courier finds a signal that predicts the next murder." },
  artifacts: [{ id: "brief_1", stage: "brief", type: "pixeltale_brief", version: 1 }, { id: "arc_1", stage: "arc", type: "pixeltale_arc", version: 1 }],
  approvedArtifactIds: ["brief_1"],
  handoffs: [],
  createdAt: "2026-08-04T09:00:00.000Z",
  updatedAt: "2026-08-04T09:30:00.000Z",
}));
fs.writeFileSync(path.join(historyRoot, secondSession, "pixel_tale_state.json"), JSON.stringify({
  mode: "long_form_drama",
  stage: "brief",
  input: { idea: "A family returns to a town that remembers their secrets." },
  artifacts: [],
  approvedArtifactIds: [],
  handoffs: [],
  createdAt: "2026-08-04T09:05:00.000Z",
  updatedAt: "2026-08-04T09:40:00.000Z",
}));

const history = testApi.pixelTaleHistory.list({ root: historyRoot, currentSessionId: firstSession });
assert.equal(history.length, 2, "history must ignore invalid or incomplete session directories");
assert.equal(history[0].sessionId, secondSession, "history must sort by latest saved time");
assert.equal(history[0].mode, "普通长剧");
assert.equal(history[1].title, "The Last Signal");
assert.equal(history[1].progressLabel, "1 / 7");
assert.equal(history[1].isCurrent, true, "the active session must be marked current");
assert.equal(history[1].ideaExcerpt, "A courier finds a signal that predicts the next murder.");
assert.equal(Object.hasOwn(history[1], "artifacts"), false, "history must not expose full artifacts");

assert.equal(typeof testApi.pixelTaleHistory.remove, "function", "history deletion must be available to focused tests");
const removed = testApi.pixelTaleHistory.remove({ root: historyRoot, sessionId: secondSession });
assert.equal(removed.sessionId, secondSession, "history deletion must identify the removed session");
assert.equal(fs.existsSync(path.join(historyRoot, secondSession)), false, "history deletion must remove the session directory");

fs.rmSync(historyRoot, { recursive: true, force: true });
console.log("pixeltale history ok");
