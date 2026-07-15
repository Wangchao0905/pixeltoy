const assert = require("node:assert/strict");
const {
  WORKSPACE_MODES,
  normalizeWorkspaceMode,
  workspaceModeForTool,
  shouldEnableExplore,
} = require("../public/workspace-shell.js");

assert.deepEqual(WORKSPACE_MODES, ["script", "image", "video", "storyboard", "assets"]);
assert.equal(normalizeWorkspaceMode("storyboard"), "storyboard");
assert.equal(normalizeWorkspaceMode("logs"), "assets");
assert.equal(normalizeWorkspaceMode(""), "assets");
assert.equal(workspaceModeForTool("short-drama"), "script");
assert.equal(workspaceModeForTool("short-drama-workspace"), "script");
assert.equal(workspaceModeForTool("image-generation"), "image");
assert.equal(workspaceModeForTool("video-generation"), "video");
assert.equal(workspaceModeForTool("production-board"), "storyboard");
assert.equal(workspaceModeForTool("asset-library"), "assets");
assert.equal(shouldEnableExplore({ serverEnabled: true, search: "" }), true);
assert.equal(shouldEnableExplore({ serverEnabled: true, search: "?legacy=1" }), false);
assert.equal(shouldEnableExplore({ serverEnabled: false, search: "?explore=1" }), false);

console.log("workspace shell tests passed");
