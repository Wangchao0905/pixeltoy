import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
const server = fs.readFileSync(new URL("server.js", root), "utf8");

const draftStart = server.indexOf("async function buildDraft(");
const draftEnd = server.indexOf("function parsePromptSections(", draftStart);
assert.notEqual(draftStart, -1, "draft builder must exist");
assert.notEqual(draftEnd, -1, "draft builder boundary must exist");
const buildDraft = server.slice(draftStart, draftEnd);

assert.match(
  buildDraft,
  /Array\.isArray\(sourceAssetManifest\.items\) && sourceAssetManifest\.items\.length/,
  "a completed asset extraction must provide usable assets to the draft builder",
);
assert.doesNotMatch(
  buildDraft,
  /confirmedManifest\.confirmed/,
  "draft generation must not be blocked by the retired manual confirmation gate",
);

assert.match(app, /draftGenerating:\s*false/, "draft generation needs an independent UI running state");
assert.match(app, /function isDraftGenerating\(\)/, "flow status must expose draft generation as a real running task");
assert.match(
  app,
  /state\.uiBusy\.draftGenerating = true;[\s\S]*?await saveFileQuiet\("script"\);/,
  "draft feedback must start before the preliminary script save finishes",
);
assert.match(
  app,
  /finally\s*\{\s*state\.uiBusy\.draftGenerating = false;/,
  "draft feedback must always clear after success or failure",
);

assert.match(server, /workflowGuide:\s*\{\s*phase:\s*"next_story"/, "a completed video config must persist the next-story guide state");
assert.match(server, /phase:\s*"draft_ready"/, "a new draft must clear the previous next-story guide state");
assert.match(server, /workflowGuide:\s*compactLine\(config\.workflowGuide\?\.phase \|\| ""\)/, "project state must expose the persisted workflow guide state");
assert.match(app, /function isReadyForNextStoryGuidance\(/, "the studio flow must recognize a completed config as a new-story guide");
assert.match(app, /step\.value = "未启动"/, "the reset flow must visibly return steps to the unstarted state");
assert.match(
  app,
  /await refreshVideoConfig\(\{ silent: false \}\);[\s\S]*?setWorkflowFocus\("shots"\);/,
  "after configuration succeeds, the workspace must guide the next story from the shot step",
);

console.log("draft flow lifecycle tests passed");
