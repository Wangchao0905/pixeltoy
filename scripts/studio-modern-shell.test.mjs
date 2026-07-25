import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

for (const id of ["studioModernShell", "modernShotRail", "modernShotCopy", "modernVideoPreview", "modernDetailsButton"]) {
  assert.match(html, new RegExp(`id=\"${id}\"`), `modern shell missing ${id}`);
}
assert.match(html, /id="studioShell" class="studio-shell hidden"/, "legacy editor must remain available");
assert.match(css, /body\.is-studio-modern[\s\S]*--modern-signal/, "modern palette must be scoped to modern studio");
assert.match(js, /studioModernShell/, "modern shell visibility must be wired");
assert.match(js, /renderModernStudio\(data\)/, "modern shell must hydrate from project state");
assert.match(js, /modernDetailsButton/, "modern shell must expose detailed editor handoff");

console.log("studio modern shell tests passed");
