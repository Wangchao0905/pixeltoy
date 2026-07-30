import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "server.js",
  "package.json",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/canvas.html",
  "public/canvas.js",
  "public/canvas.css",
  "scripts/vendor/image-gen.js",
];
const syntaxFiles = [
  "server.js",
  "server/asset-library.js",
  "server/reference-kits.js",
  "server/seedance-director.js",
  "server/team-access.js",
  "server/team-progress.js",
  "server/team-references.js",
  "server/team-store.js",
  "server/email-auth.js",
  "public/app.js",
  "public/admin.js",
  "public/canvas.js",
  "public/workspace-shell.js",
  "scripts/run_asset_generation.js",
  "scripts/vendor/image-gen.js",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  console.error(`verify-deploy: ${message}`);
  process.exitCode = 1;
}

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`missing ${relativePath}`);
}
for (const relativePath of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`syntax check failed for ${relativePath}`);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

const html = read("public/index.html");
const app = read("public/app.js");
const styles = read("public/styles.css");
const server = read("server.js");
const slotCount = (html.match(/data-video-slot="work-\d+"/g) || []).length;
if (!html.includes("video-showcase-six") || slotCount !== 6) fail(`homepage must expose exactly six video slots (found ${slotCount})`);
if ((html.match(/\/home-videos\/work-\d+\.mp4/g) || []).length !== 6) fail("homepage video source paths are incomplete");
if ((html.match(/\/home-videos\/posters\/work-\d+\.jpg/g) || []).length !== 6) fail("homepage poster paths are incomplete");
if (!html.includes('aria-label="个人中心"') || !app.includes("superadmin")) fail("account/admin identity markers are missing");
if (!server.includes('SUPER_ADMIN_USERNAME = "superadmin"') || !server.includes('require("./server/reference-kits.js")')) {
  fail("server collaboration markers are missing");
}
if (!styles.includes(".video-showcase-grid-six") || !styles.includes("pixel-toys-wordmark")) fail("homepage visual markers are missing");

if (process.exitCode) process.exit();
console.log("verify-deploy: source, homepage structure, and collaboration markers passed");
