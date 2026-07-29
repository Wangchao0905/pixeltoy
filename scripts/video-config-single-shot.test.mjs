import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

assert.match(server, /action === "video-config-shot"/, "server needs a single-shot video config route");
assert.match(server, /buildVideoConfigForShot\(/, "server needs a single-shot config builder");
assert.match(server, /body\.shotName/, "single-shot config must receive the selected shot name");
assert.match(app, /data-segment-config=/, "each video segment needs a config action");
assert.match(index, /id=\"modernVideoQueueConfig\"/, "the selected take inspector needs a config action");
assert.match(app, /function generateVideoConfigForSegment\(/, "the segment config action needs a client handler");
assert.match(app, /video-config-shot/, "the client must call the single-shot config route");

console.log("single-shot video config tests passed");
