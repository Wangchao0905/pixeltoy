import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(server, /require\("\.\/server\/chatcut-adapter\.js"\)/);
assert.match(server, /require\("\.\/server\/chatcut-queue\.js"\)/);
assert.match(server, /require\("\.\/server\/chatcut-agent\.js"\)/);
assert.match(server, /result\.dryRun === true/);
assert.match(server, /chatcut: chatcutStatus\(episodeRoot\)/);
assert.match(server, /chatcutQueue\.enqueue\(episodeRoot/);
assert.match(server, /processChatcutQueueOnce/);
assert.match(server, /action === "chatcut\/package"/);
assert.match(server, /action === "chatcut\/status"/);
assert.match(server, /action === "chatcut\/state"/);
assert.match(server, /action === "chatcut\/import"/);
assert.match(server, /action === "chatcut\/approve"/);
assert.match(server, /action === "chatcut\/automate"/);
assert.match(app, /startChatcutEditing/);
assert.match(app, /chatcutProgress/);
assert.match(app, /openChatcutFileBtn/);
assert.match(html, /chatcutEditBtn/);
assert.match(html, /openChatcutFileBtn/);
assert.doesNotMatch(html, /chatcutExportPath/);
assert.doesNotMatch(html, /approveChatcutBtn/);
assert.match(packageJson.scripts.test, /chatcut-adapter\.test\.mjs/);
assert.match(packageJson.scripts.test, /chatcut-queue\.test\.mjs/);
assert.match(packageJson.scripts.test, /chatcut-agent\.test\.mjs/);
assert.match(packageJson.scripts.test, /chatcut-agent-runner\.test\.mjs/);
assert.match(packageJson.scripts.test, /chatcut-server-wiring\.test\.mjs/);

console.log("chatcut server wiring tests passed");
