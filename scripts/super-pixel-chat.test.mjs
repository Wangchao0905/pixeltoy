import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(html, /id="superPixelMessages"/);
assert.match(html, /id="superPixelScriptUpload"[^>]*\.md[^>]*\.txt[^>]*\.docx/);
assert.match(html, /<option value="agent" disabled>/);
assert.match(app, /async function submitSuperPixelChat\(prompt\)/);
assert.match(app, /fetch\("\/api\/super-pixel\/chat"/);
assert.match(app, /Accept: "text\/event-stream"/);
assert.match(app, /new AbortController\(\)/);
assert.match(app, /readScriptUpload\(file\)/);
assert.match(app, /state\.superPixel\.scriptText/);
assert.doesNotMatch(app, /Super Pixel 即将上线|剧本上传即将上线/);
assert.match(server, /if \(url\.pathname === "\/api\/super-pixel\/chat"\) return await handleSuperPixelChat/);
assert.match(server, /req\.on\("close", onClose\)/);
assert.match(server, /controller\.abort\(\)/);
assert.match(server, /"X-Accel-Buffering": "no"/);
assert.doesNotMatch(app, /ASSET_ANALYZER_API_KEY|STORYBOARD_API_KEY/);

console.log("super pixel chat UI tests passed");
