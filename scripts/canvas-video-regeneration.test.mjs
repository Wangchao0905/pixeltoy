import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const canvas = fs.readFileSync(new URL("public/canvas.js", root), "utf8");
const html = fs.readFileSync(new URL("public/canvas.html", root), "utf8");

assert.match(
  canvas,
  /api\("\/api\/canvas\/project-video-generate"[\s\S]*?shotName: projectShotName,[\s\S]*?forceRegenerate: true,/,
  "canvas project video regeneration must bypass completed-task reuse",
);
assert.match(
  canvas,
  /const previewSig = JSON\.stringify\(\{[\s\S]*?videoUrl: node\.videoUrl \|\| "",[\s\S]*?taskId: node\.taskId \|\| "",/,
  "canvas video previews must refresh when a new task reuses the same media URL",
);
const renderStart = canvas.indexOf("function renderVideoPreview(node)");
const renderEnd = canvas.indexOf("\nfunction nodePrompt(node)", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, "canvas video preview renderer should be present");
const render = canvas.slice(renderStart, renderEnd);
assert.ok(render.indexOf('if (node.status === "running")') < render.indexOf("if (node.videoUrl)"),
  "running video nodes must render generation state before a stale media URL");
assert.match(
  html,
  /canvas\.js\?v=[A-Za-z0-9._-]+/,
  "canvas video regeneration fix must invalidate the browser script cache",
);

console.log("canvas video regeneration tests passed");
