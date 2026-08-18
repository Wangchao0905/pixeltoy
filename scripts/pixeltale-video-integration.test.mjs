import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentSource = fs.readFileSync(path.join(root, "server/pixeltale-agent.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "public/pixeltale/pixeltale.html"), "utf8");

assert.match(agentSource, /require\("\.\/pixeltale-video\.js"\)/, "Short Drama agent must load the video compiler");
assert.match(agentSource, /videoPromptPack/, "handoff must carry the compiled 15-second video prompt pack");
assert.match(serverSource, /action === "video-prompt-pack"/, "Short Drama API must expose the compiled video prompt pack");
assert.match(serverSource, /video-prompt-pack\/download/, "Short Drama API must expose a downloadable video prompt pack");
assert.match(appSource, /data-download-video-prompts/, "Short Drama export UI must expose video prompt pack download");
assert.match(appSource, /video-prompt-pack\/download/, "Short Drama UI must download the compiled video prompt pack");
assert.match(htmlSource, /视频生成/, "Short Drama shell must identify the video production deliverable");

const { createHandoffPayload } = await import(pathToFileURL(path.join(root, "server/pixeltale-agent.js")).href);
assert.equal(typeof createHandoffPayload, "function");

console.log("pixeltale video integration tests passed");
