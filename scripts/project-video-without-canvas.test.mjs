import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

assert.match(app, /authUser:\s*null/, "frontend state must remember the signed-in user");
assert.match(app, /function userHasCanvasPermission\(\)/, "frontend must centralize canvas permission checks");

const singleGenerate = app.slice(app.indexOf("async function generateVideoSegment"), app.indexOf("async function generateAllVideoSegments"));
assert.match(singleGenerate, /if\s*\(userHasCanvasPermission\(\)\)/, "single segment generation must only sync to canvas when the user has canvas permission");

const batchGenerate = app.slice(app.indexOf("async function generateAllVideoSegments"), app.indexOf("function renderFinalCut"));
assert.match(batchGenerate, /if\s*\(userHasCanvasPermission\(\)\)/, "batch video generation must only sync to canvas when the user has canvas permission");

console.log("project video without canvas permission tests passed.");
