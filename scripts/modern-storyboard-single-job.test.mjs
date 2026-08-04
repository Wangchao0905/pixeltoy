import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import serverModule from "../server.js";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

const startJob = js.match(/async function startJob\(type, options = \{\}\) \{[\s\S]*?scheduleProjectRefresh\(\{ immediate: true \}\);\n\}/);
assert.ok(startJob, "startJob must accept scoped job options");
assert.match(startJob[0], /options\.storyboardRange/);
assert.match(startJob[0], /options\.storyboardNames/);
assert.match(startJob[0], /options\.storyboardName/);
assert.match(startJob[0], /options\.storyboardIndex/);
assert.match(startJob[0], /body\.storyboardRange = options\.storyboardRange/);
assert.match(startJob[0], /body\.storyboardNames = options\.storyboardNames/);
assert.match(startJob[0], /body\.storyboardName = options\.storyboardName/);
assert.match(startJob[0], /body\.storyboardIndex = options\.storyboardIndex/);
assert.match(startJob[0], /body\.ratio = "16:9"/);

const runModern = js.match(/async function runModernStoryboardJob\(action = "current"\) \{[\s\S]*?\n\}\n\nfunction saveModernStoryboardContinuity/);
assert.ok(runModern, "modern storyboard job runner must be present");
assert.match(runModern[0], /modernStoryboardPages\(state\.project, modernShotRecords\(state\.project\)\)/);
assert.match(runModern[0], /storyboardRange:\s*"selected"/);
assert.match(runModern[0], /storyboardNames:\s*\[page\.id\]/);
assert.match(runModern[0], /storyboardIndex:\s*page\.pageIndex/);
assert.match(runModern[0], /action === "retry"[\s\S]*?storyboard-regenerate/);
assert.match(runModern[0], /storyboardName:\s*page\.id/);
assert.doesNotMatch(runModern[0], /startJob\("storyboards"\);/);

const retryControl = js.match(/\$\("#modernStoryboardGeneratePage"\)\?\.addEventListener\("click", \(event\) => \{[\s\S]*?\n  \}\);/);
assert.ok(retryControl, "storyboard generation button must have an event handler");
assert.match(retryControl[0], /dataset\.storyboardAction === "retry" \? "retry" : "current"/);
assert.match(retryControl[0], /runModernStoryboardJob\(action\)/, "retry button must use the scoped retry action");

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
assert.match(server, /function resolveStoryboardSelection\(/, "server must resolve a storyboard by stable id or page index");
assert.match(server, /resolveStoryboardSelection\(slots, body, isRegenerate\)/);
assert.match(server, /storyboardIndex/);

const resolveStoryboardSelection = serverModule.__test?.durationMode?.resolveStoryboardSelection;
assert.equal(typeof resolveStoryboardSelection, "function", "selection resolver must be testable");
const fallbackSlots = [
  { id: "SB001_E01_V001_PRODUCTION_BOARD", missing: true },
  { id: "SB002_E01_V002_PRODUCTION_BOARD", missing: true },
];
assert.deepEqual(
  resolveStoryboardSelection(fallbackSlots, {
    storyboardRange: "selected",
    storyboardNames: ["sb-part-01"],
    storyboardIndex: 0,
  }),
  ["SB001_E01_V001_PRODUCTION_BOARD"],
  "a synthetic modern page id must resolve through its page index",
);
assert.deepEqual(
  resolveStoryboardSelection(fallbackSlots, {
    storyboardName: "sb-part-02",
    storyboardIndex: 1,
  }, true),
  ["SB002_E01_V002_PRODUCTION_BOARD"],
  "a synthetic modern page id must also resolve during regeneration",
);

console.log("modern storyboard single-board job tests passed");
