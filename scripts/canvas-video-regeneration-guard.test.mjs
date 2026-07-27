import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const source = fs.readFileSync(new URL("public/canvas.js", root), "utf8");

function extractFunction(signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const context = {
  videoGenerationTokens: new Map(),
  audioRetriedVideoNodes: new Set(),
  canvasState: {
    nodes: [{ id: "video-1", kind: "video", status: "completed", taskId: "old-task", videoUrl: "https://cdn.test/old.mp4" }],
    pollTimers: new Map(),
  },
  normalizeVideoProgress: () => 50,
  clearVideoPoll: () => {},
  updateVideoNodeStatus: (nodeId, patch) => Object.assign(context.canvasState.nodes.find((node) => node.id === nodeId), patch),
  persistNodeTailFrame: () => {},
  scheduleTailFrameSync: () => {},
  markVideoNodeFailed: () => {},
  toast: () => {},
};
vm.createContext(context);
for (const signature of [
  "function beginVideoGeneration(",
  "function ensureVideoGenerationToken(",
  "function videoOperationIsCurrent(",
  "function applyVideoGenerationResult(",
]) {
  vm.runInContext(extractFunction(signature), context, { filename: "public/canvas.js" });
}

const oldToken = context.beginVideoGeneration("video-1");
const newToken = context.beginVideoGeneration("video-1");
Object.assign(context.canvasState.nodes[0], {
  status: "running",
  taskId: "new-task",
  videoUrl: "",
});

context.applyVideoGenerationResult(
  "video-1",
  { status: "completed", taskId: "old-task", videoUrl: "https://cdn.test/old.mp4" },
  { generationToken: oldToken, expectedTaskId: "old-task" },
);
assert.equal(context.canvasState.nodes[0].videoUrl, "", "an old completion must not restore the previous video");
assert.equal(context.canvasState.nodes[0].taskId, "new-task", "an old completion must not replace the new task");

context.applyVideoGenerationResult(
  "video-1",
  { status: "completed", taskId: "new-task", videoUrl: "https://cdn.test/new.mp4" },
  { generationToken: newToken, expectedTaskId: "new-task" },
);
assert.equal(context.canvasState.nodes[0].videoUrl, "https://cdn.test/new.mp4", "the current completion must display the new video");

context.videoGenerationTokens.clear();
Object.assign(context.canvasState.nodes[0], {
  status: "running",
  taskId: "resumed-task",
  videoUrl: "",
});
context.applyVideoGenerationResult(
  "video-1",
  { status: "completed", taskId: "resumed-task", videoUrl: "https://cdn.test/resumed.mp4" },
  { expectedTaskId: "resumed-task" },
);
assert.equal(context.canvasState.nodes[0].videoUrl, "https://cdn.test/resumed.mp4", "a resumed task must still work without an existing in-memory token");

console.log("canvas video regeneration guard tests passed");
