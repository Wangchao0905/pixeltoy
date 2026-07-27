import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const exploreStart = app.indexOf('function setExploreView(view = "canvas")');
const exploreEnd = app.indexOf('function showExploreImageTool', exploreStart);
const exploreView = app.slice(exploreStart, exploreEnd);
assert.match(exploreView, /if \(state\.exploreView === "canvas"\)/);
assert.match(exploreView, /else if \(state\.exploreView === "image"\)/);
assert.match(exploreView, /else if \(state\.exploreView === "library"\)/);
assert.match(exploreView, /else if \(state\.exploreView === "superpixel"\)/);
assert.doesNotMatch(exploreView, /renderImageExploreView\(\);\s*renderAssetLibraryView\(\);\s*renderSuperPixelAssetRail\(\);/);

assert.match(app, /let projectListRequest = null;/);
assert.match(app, /let assetLibraryRequest = null;/);
assert.match(app, /function renderHtmlInBatches\(/);
assert.match(app, /const needsProjectIndex = !!INITIAL_PROJECT_ID \|\| state\.exploreView === "canvas";/);
assert.match(app, /responseMode: "summary"/);
assert.match(app, /&bootstrap=1/);

assert.match(canvas, /let sharedAssetLibraryRequest = null;/);
assert.match(canvas, /function renderHtmlInBatches\(/);
assert.match(canvas, /const preloadedCanvasRequest = urlCanvasId/);
assert.match(canvas, /const initialCanvasBootstrap = params\.get\("bootstrap"\) === "1"/);

assert.match(server, /if \(body\.responseMode === "summary"\)/);
assert.match(server, /loading: true, project: lightweightProjectSummary\(episodeRoot\)/);

console.log("navigation performance contracts passed");
