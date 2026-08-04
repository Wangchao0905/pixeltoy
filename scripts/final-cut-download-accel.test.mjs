import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const nginx = fs.readFileSync(path.join(root, "deploy", "nginx", "pixel-toy.conf"), "utf8");

assert.match(nginx, /location \/_pixel-toy-final-cut\/ \{\s*internal;\s*alias \/home\/ubuntu\/apps\/pixel-toy\/projects\//, "Nginx must expose only an internal alias for project final cuts");
assert.match(nginx, /proxy_set_header X-Pixel-Toy-Final-Cut-Accel 1;/, "Nginx must explicitly enable final-cut acceleration for proxied requests");

const finalCutStart = server.indexOf("function finalCutStatus(episodeRoot)");
const finalCutEnd = server.indexOf("async function runFinalCutAssembly", finalCutStart);
assert.ok(finalCutStart >= 0 && finalCutEnd > finalCutStart, "finalCutStatus must remain testable");
const finalCutStatus = server.slice(finalCutStart, finalCutEnd);
assert.match(
  finalCutStatus,
  /downloadUrl:\s*`\/media\?path=\$\{encodeURIComponent\(out\)\}[\s\S]*?&final_cut=1`/,
  "final-cut downloads must opt into the accelerated download path",
);

assert.match(server, /function finalCutAccelRedirect\(req, file\)/, "missing final-cut Nginx acceleration guard");
const accelStart = server.indexOf("function finalCutAccelRedirect(req, file)");
const accelEnd = server.indexOf("function serveMedia(req, res, file, options = {})", accelStart);
const accelSource = server.slice(accelStart, accelEnd);
assert.match(accelSource, /x-pixel-toy-final-cut-accel/, "acceleration must require the trusted Nginx capability header");
assert.match(accelSource, /finalCutOutputFile\(episodeRoot\)/, "only rough-cut outputs may use the internal static route");
assert.match(accelSource, /_pixel-toy-final-cut/, "internal redirect must target the dedicated Nginx location");
assert.match(accelSource, /encodeURIComponent/, "project paths must remain URL-safe");

const mediaStart = server.indexOf('if (url.pathname === "/media")');
const mediaEnd = server.indexOf('if (url.pathname === "/api/canvas/video-download")', mediaStart);
const mediaRoute = server.slice(mediaStart, mediaEnd);
assert.match(mediaRoute, /finalCutAccelRedirect\(req, file\)/, "media route must select acceleration only after normal authorization");
assert.match(mediaRoute, /serveMedia\(req, res, file, \{ download, accelRedirect \}\)/, "media route must retain stream fallback when acceleration is unavailable");

const streamStart = server.indexOf("function serveMedia(req, res, file, options = {})");
const streamEnd = server.indexOf("const handleRequest", streamStart);
const streamSource = server.slice(streamStart, streamEnd);
assert.match(streamSource, /options\.accelRedirect/, "serveMedia must accept an internal redirect option");
assert.match(streamSource, /"X-Accel-Redirect": accelRedirect/, "accelerated downloads must hand the file to Nginx");
assert.match(streamSource, /fs\.createReadStream\(file\)/, "non-Nginx requests must retain local streaming fallback");
assert.match(streamSource, /fs\.createReadStream\(file, \{ start, end \}\)/, "fallback must preserve ranged downloads");
assert.match(app, /function finalCutDownloadUrl\(output\s*=\s*\{\}\)/, "the final-cut download link needs a URL fallback");
assert.match(app, /finalCutDownloadUrl\(fc\.output\s*\|\|\s*\{\}\)/, "the final-cut download control must use the fallback URL");

console.log("final cut accelerated download tests passed");
