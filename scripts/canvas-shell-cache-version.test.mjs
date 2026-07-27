import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");

assert.match(html, /styles\.css\?v=canvas-shell-visual-20260727/);
assert.match(html, /canvas\.css\?v=canvas-shell-visual-20260727/);
assert.match(html, /canvas\.js\?v=asset-library-deeplink-20260727/);
assert.match(css, /\.canvas-topbar\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*1200;/);
assert.match(css, /\.blank-canvas::before\s*\{[\s\S]*?background-size:\s*16px 16px;/);
assert.match(css, /\.canvas-topbar\s*\{[\s\S]*?border-bottom:\s*1px solid/);

console.log("canvas shell cache/version tests passed");
