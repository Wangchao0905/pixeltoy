import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const source = fs.readFileSync(new URL("server.js", root), "utf8");

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
  compactLine: (value) => String(value || "").trim(),
  canvasReferenceAssetKey: (value) => String(value || "").trim(),
  mergeCanvasAssetState: (existing, incoming) => ({ ...existing, ...incoming }),
  promptHasStoryContent: () => false,
  isStaleVideoFailureMessage: () => false,
  repairCanvasAssetReferences: (state) => ({ state }),
};
vm.createContext(context);
vm.runInContext(extractFunction("function mergeCanvasStateForWrite("), context, { filename: "server.js" });

function state(node, updatedAt) {
  return {
    projectId: "canvas-refresh-test",
    updatedAt,
    assets: [],
    connections: [],
    nodes: [{
      id: "video-1",
      kind: "video",
      prompt: "same prompt",
      source: "",
      projectShotName: "",
      videoPromptMode: "",
      storyboardRefs: [],
      ...node,
    }],
  };
}

const oldCompleted = state({
  status: "completed",
  taskId: "task-old",
  taskProvider: "ark",
  videoUrl: "https://cdn.example/old.mp4",
  submittedAt: "2026-07-24T08:00:00.000Z",
  progress: 100,
  tailFrameReady: true,
  tailFrameUrl: "/tail-old.png",
}, "2026-07-24T08:05:00.000Z");

const newSubmitting = state({
  status: "running",
  statusMessage: "正在提交 Seedance 任务",
  taskId: "",
  taskProvider: "",
  videoUrl: "",
  submittedAt: "2026-07-24T09:00:00.000Z",
  progress: null,
  tailFrameReady: false,
  tailFrameUrl: "",
}, "2026-07-24T09:00:01.000Z");

const submittingMerged = context.mergeCanvasStateForWrite(oldCompleted, newSubmitting).nodes[0];
assert.equal(submittingMerged.status, "running", "starting a new generation must clear the previous completed state");
assert.equal(submittingMerged.videoUrl, "", "starting a new generation must not retain the previous video URL");
assert.equal(submittingMerged.tailFrameUrl, "", "starting a new generation must not retain the previous tail frame");

const newCompleted = state({
  status: "completed",
  taskId: "task-new",
  taskProvider: "ark",
  videoUrl: "https://cdn.example/new.mp4",
  submittedAt: "2026-07-24T09:00:00.000Z",
  progress: 100,
  tailFrameReady: false,
  tailFrameUrl: "",
}, "2026-07-24T09:05:00.000Z");

const completedMerged = context.mergeCanvasStateForWrite(oldCompleted, newCompleted).nodes[0];
assert.equal(completedMerged.taskId, "task-new", "a newer generation must persist its own task ID");
assert.equal(completedMerged.videoUrl, "https://cdn.example/new.mp4", "refresh must restore the newly generated video");

const staleMerged = context.mergeCanvasStateForWrite(newCompleted, oldCompleted, { preserveMissingNodes: true }).nodes[0];
assert.equal(staleMerged.taskId, "task-new", "a delayed save from the old page must not replace the newer task");
assert.equal(staleMerged.videoUrl, "https://cdn.example/new.mp4", "a delayed save must not restore the previous video");

console.log("canvas video refresh identity tests passed");
