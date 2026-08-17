import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const { __test } = createRequire(import.meta.url)(path.join(root, "server.js"));

assert.match(html, /id="modernCoverDesign"/, "the cut workspace needs a cover design module");
assert.match(html, /id="modernCoverGenerate"/, "cover design needs a prominent generate action");
assert.match(html, /id="modernCoverDesignGrid"/, "cover design needs a four-up grid");
assert.match(html, /id="modernCoverDesignFocus"/, "cover design needs an in-module enlarged preview");
assert.match(app, /function renderCoverDesign\(/, "the cover module needs a state renderer");
assert.match(app, /function generateCoverDesigns\(/, "the cover module needs a generation action");
assert.match(app, /data-cover-design-id=/, "cover tiles need selectable ids");
assert.match(styles, /\.cover-design-panel\s*\{[^}]*width:\s*min\(100%,\s*432px/, "cover design must stay within the reference window width");
assert.match(styles, /\.cover-design-grid\s*\{[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,1fr\)/, "cover design must render a bounded four-up grid");
assert.match(styles, /\.cover-design-focus\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,1fr\)/, "enlarged cover preview must stay inside the same window");
assert.match(styles, /\.cover-design-focus figure img\s*\{[^}]*height:\s*100%/, "enlarged cover preview must fill the bounded preview area");
assert.match(serverSource, /action === "cover-designs"/, "the project needs a cover design route");
assert.match(serverSource, /imageModel:\s*"gpt-image2-medium"/, "covers must use gpt-image2-medium");
assert.match(serverSource, /COVER_DESIGN_STYLES/, "cover styles must be explicit and distinct");

const coverDesign = __test?.coverDesign;
assert.equal(typeof coverDesign?.promptForStyle, "function", "cover prompt builder must be testable");
assert.equal(typeof coverDesign?.normalizeTaskStatus, "function", "cover task status mapping must be testable");
assert.equal(Array.isArray(coverDesign?.styles), true, "cover styles must be exposed for UI/tests");
assert.equal(coverDesign.styles.length, 4, "one click must create four cover directions");
assert.equal(new Set(coverDesign.styles.map((style) => style.id)).size, 4, "cover directions must be unique");
const prompt = coverDesign.promptForStyle(coverDesign.styles[0], {
  title: "夏夜回声",
  referenceNames: ["C001_女主", "S001_天台"],
});
assert.match(prompt, /夏夜回声/, "the cover prompt must include the project title");
assert.match(prompt, /C001_女主/, "the cover prompt must name the bound character reference");
assert.match(prompt, /TK|短剧|封面/, "the cover prompt must carry short-drama cover constraints");

assert.equal(coverDesign.normalizeTaskStatus("completed"), "complete", "completed image jobs must unlock cover tiles");
assert.equal(coverDesign.normalizeTaskStatus("complete"), "complete", "complete image jobs must remain complete");
assert.equal(coverDesign.normalizeTaskStatus("failed"), "failed", "failed image jobs must remain failed");

const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toy-cover-state-"));
const coverDir = path.join(staleRoot, "12_cover_design");
fs.mkdirSync(coverDir, { recursive: true });
fs.writeFileSync(path.join(coverDir, "cover_design.json"), JSON.stringify({
  status: "running",
  createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  items: [{ id: "stale", styleId: "cinematic", styleLabel: "电影叙事", taskId: "", status: "starting" }],
}));
const recovered = coverDesign.refresh(staleRoot);
assert.equal(recovered.items[0].status, "failed", "no-task cover jobs must recover after a service restart timeout");
assert.match(recovered.items[0].error, /提交超时|重新生成/, "stale cover jobs need an actionable error");

console.log("cover design tests passed");
