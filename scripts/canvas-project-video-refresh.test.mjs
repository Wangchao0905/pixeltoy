import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

function extractFunction(signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const context = {};
vm.createContext(context);
vm.runInContext(extractFunction("function projectSnapshotCanvasVideoState("), context, { filename: "server.js" });

const previous = {
  status: "completed",
  statusMessage: "第一次生成完成",
  taskId: "task-first",
  taskProvider: "ark",
  videoUrl: "https://cdn.example/first.mp4",
  progress: 100,
  tailFrameReady: true,
  tailFrameUrl: "/tail-first.png",
};
const node = { status: "idle", videoUrl: "", taskId: "" };
const runningSnapshot = {
  status: "running",
  statusMessage: "第二次生成中",
  taskId: "task-second",
  taskProvider: "ark",
  videoUrl: "",
  progress: null,
  tailFrameReady: false,
  tailFrameUrl: "",
};

const running = context.projectSnapshotCanvasVideoState(previous, node, runningSnapshot);
assert.equal(running.status, "running");
assert.equal(running.taskId, "task-second");
assert.equal(running.videoUrl, "", "a new running snapshot must clear the previous video URL");
assert.equal(running.tailFrameUrl, "", "a new running snapshot must clear the previous tail frame");

const completed = context.projectSnapshotCanvasVideoState(previous, node, {
  ...runningSnapshot,
  status: "completed",
  statusMessage: "第二次生成完成",
  videoUrl: "https://cdn.example/second.mp4",
  taskId: "task-second",
  progress: 100,
  tailFrameReady: false,
});
assert.equal(completed.videoUrl, "https://cdn.example/second.mp4", "the completed snapshot must display the latest video");
assert.equal(completed.taskId, "task-second");

const noSnapshot = context.projectSnapshotCanvasVideoState(previous, node, null);
assert.equal(noSnapshot.videoUrl, "https://cdn.example/first.mp4", "without a project snapshot, existing state remains available");

console.log("canvas project video refresh tests passed");
