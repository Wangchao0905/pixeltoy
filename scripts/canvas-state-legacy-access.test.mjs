import assert from "node:assert/strict";

const serverModule = (await import("../server.js")).default;
const { __test } = serverModule;
const canvasState = __test.canvasState;

assert.ok(canvasState, "canvas state helpers must be exported for regression coverage");
assert.equal(typeof canvasState.claimLegacyOwner, "function");

const legacy = {
  projectId: "canvas_legacy",
  nodes: [{ id: "node_1", kind: "image" }],
  assets: [],
};
const claimed = canvasState.claimLegacyOwner(legacy, { id: "user_1", username: "owner" });
assert.equal(claimed.ownerUserId, "user_1");
assert.equal(claimed.lastModifiedByUserId, "user_1");
assert.equal(claimed.scope, "personal");

const owned = { ...legacy, ownerUserId: "other" };
assert.equal(canvasState.claimLegacyOwner(owned, { id: "user_1" }), owned, "owned canvases must not be reassigned");

console.log("canvas state legacy access tests passed");
