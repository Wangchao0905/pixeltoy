import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

for (const id of ["studioModernShell", "modernShotRail", "modernShotCopy", "modernVideoPreview"]) {
  assert.match(html, new RegExp(`id=\"${id}\"`), `modern shell missing ${id}`);
}
assert.match(html, /id="studioShell" class="studio-shell hidden"/, "legacy editor must remain available");
assert.doesNotMatch(html, /id="modernDetailsButton"/, "modern shell must not expose the legacy editor entry");
assert.match(css, /body\.is-studio-modern[\s\S]*--modern-signal/, "modern palette must be scoped to modern studio");
assert.match(css, /body\.is-studio-modern\s+#studioShell\s*\{[\s\S]*display:\s*none\s*!important/, "legacy editor must stay hidden in modern studio");
assert.match(css, /modern-brand-logo\.pixel-toys-wordmark::before[\s\S]*animation:[^;]+!important/, "modern logo rotor must override the studio thermal guard");
assert.match(js, /studioModernShell/, "modern shell visibility must be wired");
assert.match(js, /renderModernStudio\(data\)/, "modern shell must hydrate from project state");
assert.doesNotMatch(js, /modernDetailsButton/, "modern shell must not wire a legacy editor handoff");
assert.doesNotMatch(js, /detailsOpen\s*=\s*true/, "modern actions must not switch to the legacy editor");

console.log("studio modern shell tests passed");
