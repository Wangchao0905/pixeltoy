import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const start = server.indexOf("function serveMedia(req, res, file, options = {})");
const end = server.indexOf("const server = http.createServer", start);
assert.ok(start >= 0 && end > start, "serveMedia must remain a standalone function");
const body = server.slice(start, end);
const noRangeStart = body.indexOf("if (!range) {");
const rangeStart = body.indexOf("const match = range.match", noRangeStart);
assert.ok(noRangeStart >= 0 && rangeStart > noRangeStart, "serveMedia must keep separate full-file and Range paths");
const noRangeBody = body.slice(noRangeStart, rangeStart);

assert.match(noRangeBody, /fs\.createReadStream\(file\)/, "full-file media responses must stream from disk");
assert.doesNotMatch(noRangeBody, /fs\.readFileSync\(file\)/, "full-file media responses must not buffer the entire file");
assert.match(noRangeBody, /Content-Length/, "streamed media must preserve the file length");
assert.match(noRangeBody, /Accept-Ranges/, "streamed media must preserve resumable downloads");
assert.match(body, /fs\.createReadStream\(file, \{ start, end \}\)/, "Range media responses must remain stream-based");

console.log("media stream download tests passed");
