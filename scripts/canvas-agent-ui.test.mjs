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
assert.match(launcher, /class="canvas-agent-source-logo"[^>]*src="\/pixel-toys-logo-agent\.gif"/);
assert.doesNotMatch(launcher, /\btitle\s*=\s*["']Canvas Agent["']/i, "launcher must not show a native browser tooltip");
assert.doesNotMatch(launcher, /Pixel Toys|pixel-toys-wordmark/i, "launcher icon must not include a wordmark");
assert.doesNotMatch(html, /canvas-agent-panel-icon|canvas-agent-empty-mark|canvas-agent-robot|canvas-agent-propeller/);
assert.match(html, /id="canvasAgentPanel"[^>]*aria-hidden="true"[^>]*inert/);
assert.match(html, /id="canvasAgentClose"/);
assert.match(html, /id="canvasAgentThread"/);
assert.match(html, /id="canvasAgentComposer"/);
assert.match(html, /id="canvasAgentInput"[^>]*placeholder=/);

assert.match(css, /\.canvas-agent-launcher\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*22px;[\s\S]*?bottom:\s*22px;[\s\S]*?width:\s*50px;[\s\S]*?height:\s*50px;/);
assert.match(css, /\.canvas-agent-launcher\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
assert.match(css, /\.canvas-agent-launcher\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
assert.match(css, /\.canvas-agent-launcher:hover,[\s\S]*?\.canvas-agent-launcher:focus-visible\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
assert.match(css, /\.canvas-agent-logo\s*\{[\s\S]*?background:\s*transparent\s*!important;/);
assert.doesNotMatch(css, /\.canvas-agent-launcher::before/);
assert.match(css, /\.canvas-agent-panel\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*20px;[\s\S]*?width:\s*min\(402px/);
assert.match(css, /\.canvas-agent-panel\[aria-hidden="true"\][\s\S]*?transform:\s*translateX\(calc\(100% \+ 28px\)\)/);
assert.match(css, /\.canvas-agent-launcher\[aria-expanded="true"\][\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/);
assert.match(css, /\.canvas-agent-source-logo\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*contain;/);
assert.doesNotMatch(css, /\.canvas-agent-source-logo\s*\{[\s\S]*?left:\s*-141px;/, "mobile styles must not use the old cropped wordmark offset");
assert.ok(fs.existsSync(path.join(root, "public/pixel-toys-logo-agent.gif")), "transparent launcher logo asset must exist");
assert.doesNotMatch(css, /canvas-agent-propeller|canvasAgentPropellerSpin|canvas-agent-robot/);

assert.match(js, /function setCanvasAgentOpen\(open\)/);
assert.match(js, /panel\.setAttribute\("aria-hidden", String\(!isOpen\)\)/);
assert.match(js, /panel\.toggleAttribute\("inert", !isOpen\)/);
assert.match(js, /qs\("#canvasAgentToggle"\)\?\.addEventListener\("click"/);
assert.match(js, /qs\("#canvasAgentClose"\)\?\.addEventListener\("click"/);
assert.match(js, /event\.key === "Escape"[\s\S]*?setCanvasAgentOpen\(false\)/);
assert.match(js, /canvasAgentContextName/);

assert.match(css, /\.canvas-agent-composer\s*\{[\s\S]*?border:\s*1px\s+solid/);
assert.match(css, /\.canvas-agent-composer textarea\s*\{[\s\S]*?border:\s*0;[\s\S]*?outline:\s*0;[\s\S]*?box-shadow:\s*none;/);
assert.match(css, /\.canvas-agent-send\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
assert.match(html, /canvas\.css\?v=canvas-agent-transparent-20260728/);
assert.match(html, /canvas\.js\?v=canvas-video-regeneration-20260728/);

console.log("canvas agent UI tests passed");
