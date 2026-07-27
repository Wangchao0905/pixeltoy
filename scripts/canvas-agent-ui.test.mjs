import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");

const launcher = html.match(/<button id="canvasAgentToggle"[\s\S]*?<\/button>/)?.[0] || "";
assert.ok(launcher, "canvas must provide an Agent launcher");
assert.match(launcher, /aria-expanded="false"/);
assert.match(launcher, /class="canvas-agent-propeller"/);
assert.match(launcher, /class="canvas-agent-robot"/);
assert.doesNotMatch(launcher, /Pixel Toys|pixel-toys-wordmark|pixel-toys-logo/i, "launcher icon must not include a wordmark");
assert.match(html, /id="canvasAgentPanel"[^>]*aria-hidden="true"[^>]*inert/);
assert.match(html, /id="canvasAgentClose"/);
assert.match(html, /id="canvasAgentThread"/);
assert.match(html, /id="canvasAgentComposer"/);
assert.match(html, /id="canvasAgentInput"[^>]*disabled/);

assert.match(css, /\.canvas-agent-launcher\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*22px;[\s\S]*?bottom:\s*22px;/);
assert.match(css, /\.canvas-agent-panel\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*20px;[\s\S]*?width:\s*min\(402px/);
assert.match(css, /\.canvas-agent-panel\[aria-hidden="true"\][\s\S]*?transform:\s*translateX\(calc\(100% \+ 28px\)\)/);
assert.match(css, /@keyframes canvasAgentPropellerSpin[\s\S]*?rotate\(360deg\)/);
assert.match(css, /\.canvas-agent-propeller[\s\S]*?animation:\s*canvasAgentPropellerSpin/);
assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*?canvas-agent-propeller[\s\S]*?animation:\s*none/);

assert.match(js, /function setCanvasAgentOpen\(open\)/);
assert.match(js, /panel\.setAttribute\("aria-hidden", String\(!isOpen\)\)/);
assert.match(js, /panel\.toggleAttribute\("inert", !isOpen\)/);
assert.match(js, /qs\("#canvasAgentToggle"\)\?\.addEventListener\("click"/);
assert.match(js, /qs\("#canvasAgentClose"\)\?\.addEventListener\("click"/);
assert.match(js, /event\.key === "Escape"[\s\S]*?setCanvasAgentOpen\(false\)/);
assert.match(js, /canvasAgentContextName/);

assert.match(html, /canvas\.css\?v=canvas-agent-ui-20260728/);
assert.match(html, /canvas\.js\?v=canvas-agent-ui-20260728/);

console.log("canvas agent UI tests passed");
