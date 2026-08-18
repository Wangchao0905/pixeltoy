import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

const pipeline = html.slice(html.indexOf('<section class="modern-pipeline"'), html.indexOf('<div class="modern-pipeline-rail"'));
const pipelineFocuses = [...pipeline.matchAll(/data-modern-focus="([a-z]+)"/g)].map((match) => match[1]);

assert.deepEqual(
  pipelineFocuses,
  ["assets", "assetimg", "space", "video", "cut"],
  "Short Drama must expose spatial control instead of storyboard in its primary pipeline",
);
assert.match(pipeline, /空间控制层/, "the primary pipeline must name the spatial control layer");
assert.match(html, /id="modernSpatialControlPanel"/, "Short Drama must render a spatial control panel");
for (const id of [
  "modernSpatialAgentStatus",
  "modernSpatialAgentNext",
  "modernSpatialMapList",
  "modernSpatialMapSummary",
  "modernSpatialHandoffList",
  "modernSpatialMapStatus",
  "modernSpatialMapEditor",
  "modernSpatialMapJson",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `spatial control layer is missing ${id}`);
}
assert.match(js, /function renderModernSpatialControl\(/, "Short Drama must render spatial control state from the project");
assert.match(js, /modernSpatialControlPanel/, "spatial control must be addressable from the modern focus router");
assert.match(js, /state\.modernStudio\.spatialMapEditorMapId/, "spatial map selection must persist while editing");
assert.match(js, /\/api\/project\/\$\{state\.selectedId\}\/spatial-maps/, "spatial control must use the existing spatial map API");
assert.match(js, /\/api\/project\/\$\{encodeURIComponent\(state\.selectedId\)\}\/spatial-agent\/run/, "Short Drama must run the Space Agent task from the workspace");
assert.match(js, /modernSpatialAgentFindings/, "Space Agent findings must be visible in the workspace");
assert.match(html, /id="modernSpatialAgentFindings"/, "Short Drama must render Space Agent findings");
assert.match(css, /modern-main\[data-modern-view="space"\]/, "spatial control must have a dedicated modern view");
assert.match(css, /\.modern-spatial-control-panel\s*\{/, "spatial control layer must have dedicated layout styles");

console.log("short drama spatial control tests passed");
