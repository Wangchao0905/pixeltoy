import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const rootHtml = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const html = fs.readFileSync(path.join(root, "public/pixeltale/pixeltale.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/pixeltale/styles.css"), "utf8");

assert.match(rootHtml, /data-view-tab="pulse"/, "the root PixelTale entry must expose the P1 view shell");
assert.match(html, /data-view-tab="workbench"/, "P1 must expose a workbench view tab");
assert.match(html, /data-view-tab="pulse"/, "P1 must expose a story pulse view tab");
assert.match(html, /data-view-tab="episode-card"/, "P1 must expose an episode card view tab");
assert.match(html, /data-view-tab="judge"/, "P1 must expose a judge view tab");
assert.match(app, /view: "workbench"/, "view state must be separate from production stage state");
assert.match(app, /selectedEpisode: null/, "selected episode must be UI state, not a generated artifact field");
assert.match(app, /function parseViewHash\(/, "view hash parsing must be explicit");
assert.match(app, /function viewHashForState\([\s\S]*selectedEpisode/, "pulse view must support a selected episode in the URL hash");
assert.match(app, /function renderPulseView\(/, "P1 must have a standalone pulse view renderer");
assert.match(app, /function renderEpisodeCardView\(/, "P1 must have a standalone episode card renderer");
assert.match(app, /function renderJudgeView\(/, "P1 must have a standalone judge renderer");
assert.match(styles, /\.view-nav \{/, "P1 must provide a fixed view shell navigation surface");
assert.match(styles, /\.pulse-view-grid \{/, "P1 must provide a bounded pulse layout with an inspector");
assert.match(styles, /grid-template-columns: repeat\(30/, "P1 pulse tracks must reserve 30 episode positions");

const pulseStart = app.indexOf("function pulseUnitsForArtifact");
const pulseEnd = app.indexOf("function renderPulseNode");
assert.ok(pulseStart >= 0 && pulseEnd > pulseStart, "pulse data helpers must remain extractable as a small contract layer");
const pulseHelpers = Function(`
  const state = {
    agent: {
      unitLocks: { arc: { 1: { status: "locked" } } },
      stageProgress: {
        arc: {
          totalUnits: 30,
          lockedUnits: [1],
          generatedUnits: [1, 2],
          pendingUnits: [3, 4],
          currentBatch: [3],
          batches: [{ units: [3], status: "running" }, { units: [4], status: "completed" }, { units: [4], status: "running" }],
        },
      },
    },
    input: { episodeCount: 30 },
  };
  const artifactForStage = () => null;
  const unitStageProgress = () => state.agent.stageProgress.arc;
  ${app.slice(pulseStart, pulseEnd)}
  return { pulseUnitsForArtifact, pulseEventsForUnit, pulseBatchFor, normalizeArcPulseUnits, normalizeSelectedEpisode };
`)();

const artifact = {
  id: "arc-v4",
  version: 4,
  content: {
    units: [
      { number: 1, title_zh: "第一集", hook_zh: "集尾危险", reversal_zh: "真相反转", payoff_zh: "兑现线索" },
      { number: 2, title_zh: "第二集", hook_zh: "新的问题", reversal_zh: "身份被揭开", payoff_zh: "" },
    ],
  },
};
const units = pulseHelpers.normalizeArcPulseUnits(artifact);
assert.equal(units.length, 30, "pulse normalization must preserve 1-30 positions");
assert.deepEqual(units.slice(0, 4).map((unit) => unit.status), ["locked", "generated", "pending", "pending"], "pulse status must distinguish locked, generated, pending, and missing");
assert.equal(pulseHelpers.pulseBatchFor(4).status, "running", "the latest batch record must win when an episode has historical retries");
assert.equal(units[0].sourceArtifactId, "arc-v4", "each normalized unit must retain the source artifact id");
assert.equal(units[0].sourceVersion, 4, "each normalized unit must retain the source artifact version");
assert.equal(units[1].payoff, "", "missing payoff must stay missing instead of receiving fabricated content");
assert.deepEqual(pulseHelpers.pulseEventsForUnit(artifact.content.units[0]).slice(0, 3).map((event) => event[0]), ["hook", "reversal", "payoff"], "the three pulse tracks must map to the existing arc fields");
assert.equal(pulseHelpers.normalizeSelectedEpisode(99, units), 1, "an invalid episode hash must fall back to the first available unit");
assert.equal(pulseHelpers.normalizeSelectedEpisode(2, units), 2, "a valid episode hash must remain selected even when a field is missing");

const emptyUnits = pulseHelpers.normalizeArcPulseUnits(null);
assert.equal(emptyUnits.filter((unit) => unit.status === "generated").length, 0, "an empty arc must not invent generated episodes");
assert.equal(emptyUnits.length, 30, "an empty arc must still reserve the full timeline");
assert.equal(emptyUnits[2].status, "pending", "a running batch must remain visible as pending even before its content arrives");

const hashStart = app.indexOf("function parseViewHash");
const hashEnd = app.indexOf("function requiredReviewSeatsFor");
const parseViewHash = Function(`
  const stageOrder = ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue", "handoff"];
  const viewOrder = ["workbench", "pulse", "episode-card", "judge"];
  ${app.slice(hashStart, hashEnd)}
  return parseViewHash;
`)();
assert.deepEqual(parseViewHash("#pulse/12"), { view: "pulse", stage: null, episode: 12 }, "pulse hash must restore the selected episode");
assert.deepEqual(parseViewHash("#brief"), { view: "workbench", stage: "brief", episode: null }, "legacy stage hashes must open the workbench without changing semantics");
assert.deepEqual(parseViewHash("#judge/99"), { view: "judge", stage: null, episode: null }, "invalid non-episode hash values must not leak into selected state");

assert.match(app, /function selectPulseEpisode\([\s\S]*state\.view = "pulse"[\s\S]*state\.selectedEpisode/, "selecting a pulse node must only update view selection");
assert.match(app, /function renderStage\(\) \{[\s\S]*if \(state\.view !== "workbench"\)/, "read-only views must branch before the existing production renderer");
assert.match(app, /function bindAgentTaskAction\(\)/, "the existing Agent task action rail must remain the production action owner");

console.log("pixeltale pulse view contract ok");
