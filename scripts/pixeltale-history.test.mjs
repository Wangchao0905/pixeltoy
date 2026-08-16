import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const nestedHtml = fs.readFileSync(path.join(root, "public/pixeltale/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const require = createRequire(import.meta.url);
const { __test: testApi } = require(path.join(root, "server.js"));
const { createPixelTaleAgent } = require(path.join(root, "server/pixeltale-agent.js"));

assert.match(html, /id="openHistory"[^>]*>[^<]*<span[^>]*>↺<\/span>\s*创作历史/, "PixelTale must expose a visible creative history entry");
assert.match(html, /id="historyDialog"/, "PixelTale must provide a history dialog");
assert.match(nestedHtml, /id="openHistory"/, "the nested PixelTale page must keep the history entry");
assert.match(html, /pixeltale-runtime-20260816-r73/, "the public PixelTale entry must bust the history-resume script cache");
assert.match(nestedHtml, /pixeltale-runtime-20260816-r73/, "the nested PixelTale entry must bust the history-resume script cache");
assert.match(app, /async function loadCreativeHistory\(\)[\s\S]*request\("\/history"\)/, "history must load from the server session index");
assert.match(app, /async function deleteHistorySession\(targetSessionId[\s\S]*method: "DELETE"/, "history items must expose a delete action backed by the API");
assert.match(app, /data-history-delete/, "history items must expose a delete control");
assert.match(app, /function resumeHistorySession\(nextSessionId\)[\s\S]*searchParams\.set\("session", nextSessionId\)/, "history items must restore their original session");
assert.match(app, /function resumeHistorySession\(nextSessionId\)[\s\S]*searchParams\.set\("resume",/, "resuming history must force a fresh page context");
assert.doesNotMatch(app, /function resumeHistorySession\(nextSessionId\)[\s\S]*const sameSession =/, "resuming history must not short-circuit on a stale current-session check");
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

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing app function: ${signature}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated app function: ${signature}`);
}

const resumeContext = {
  URL,
  URLSearchParams,
  window: {
    location: {
      href: "https://pixeltoy.cn/pixeltale.html?session=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#scenes",
      assign: (value) => { resumeContext.assigned = value; },
    },
  },
  sessionId: firstSession,
  SESSION_STORAGE_KEY: "pixeltale.story-forge-session",
  localStorage: { setItem: (key, value) => { resumeContext.saved = { key, value }; } },
};
vm.createContext(resumeContext);
vm.runInContext(extractFunction(app, "function resumeHistorySession(nextSessionId)"), resumeContext, { filename: "public/pixeltale/app.js" });
vm.runInContext(`resumeHistorySession("${firstSession}")`, resumeContext);
assert.equal(resumeContext.saved.value, firstSession, "history resume must persist the selected session before navigation");
assert.match(resumeContext.assigned, new RegExp(`session=${firstSession}`), "history resume must navigate with the selected session");
assert.match(resumeContext.assigned, /resume=/, "history resume must invalidate the stale page context");

const payloadState = {
  mode: "tk_short_drama",
  stage: "scenes",
  input: { storyTitle: "The Returned Heir", idea: "A saved project" },
  artifacts: [
    ...Array.from({ length: 24 }, (_, index) => ({
      id: `old_${index}`,
      type: "pixeltale_stage_review",
      stage: "scenes",
      version: index + 1,
      status: "failed",
      content: { issues: [{ message: "old review".repeat(80) }] },
    })),
    { id: "current_scenes", type: "pixeltale_scenes", stage: "scenes", version: 25, status: "needs_review", reviewId: "current_review", content: { scenes: [{ unit_number: 1, name_zh: "码头" }] } },
    { id: "current_review", type: "pixeltale_stage_review", stage: "scenes", version: 25, status: "failed", content: { pass: false, issues: [] } },
  ],
  approvedArtifactIds: [],
  handoffs: [],
};
const payloadAgent = createPixelTaleAgent({
  modelRouter: { call: async () => ({}), models: () => [], status: () => ({}) },
  readPixelTaleState: () => payloadState,
  writePixelTaleState: () => payloadState,
});
const compactPayload = payloadAgent.status({ pixelTaleRoot: "payload-test", projectId: "standalone:payload-test" });
assert.equal(compactPayload.artifactHistoryCount, 26, "state response must expose how many historical artifacts were compacted");
assert.deepEqual(compactPayload.artifacts.map((artifact) => artifact.id).sort(), ["current_review", "current_scenes"], "state response must keep only the latest content and review artifacts needed by the current UI");
assert.ok(JSON.stringify(compactPayload).length < 100_000, "state response must stay small enough to hydrate before the client timeout");

fs.rmSync(historyRoot, { recursive: true, force: true });
console.log("pixeltale history ok");
