import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const stylesStamp = html.match(/styles\.css\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
const appStamp = html.match(/app\.js\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";

assert.ok(stylesStamp, "styles.css must have a cache version");
assert.ok(appStamp, "app.js must have a cache version");
assert.equal(appStamp, stylesStamp, "free-mode UI changes must invalidate both app.js and styles.css together");

console.log("free-mode cache bust tests passed");
