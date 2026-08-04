import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const { __test } = createRequire(import.meta.url)(path.join(root, "server.js"));

assert.match(html, /id="modernCoverDesign"/, "the cut workspace needs a cover design module");
assert.match(html, /id="modernCoverGenerate"/, "cover design needs a prominent generate action");
assert.match(html, /id="modernCoverDesignGrid"/, "cover design needs a four-up grid");
assert.match(html, /id="modernCoverDesignFocus"/, "cover design needs an in-module enlarged preview");
assert.match(app, /function renderCoverDesign\(/, "the cover module needs a state renderer");
assert.match(app, /function generateCoverDesigns\(/, "the cover module needs a generation action");
assert.match(app, /data-cover-design-id=/, "cover tiles need selectable ids");
assert.match(serverSource, /action === "cover-designs"/, "the project needs a cover design route");
assert.match(serverSource, /imageModel:\s*"gpt-image-2"/, "covers must use image-2");
assert.match(serverSource, /COVER_DESIGN_STYLES/, "cover styles must be explicit and distinct");

const coverDesign = __test?.coverDesign;
assert.equal(typeof coverDesign?.promptForStyle, "function", "cover prompt builder must be testable");
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

console.log("cover design tests passed");
