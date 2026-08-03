import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");

assert.match(canvas, /function snapNodePosition\(/, "canvas nodes must expose magnetic snap calculation");
assert.match(canvas, /snapNodePosition\(node, drag\)/, "node dragging must apply magnetic snapping");
assert.match(canvas, /function connectionToneFor\(/, "connections must resolve a semantic line tone");
assert.match(canvas, /active-link \$\{tone\}/, "active connections must carry their semantic line tone");
assert.match(canvas, /generation-progress-track/, "generation status must use a static progress track");
assert.doesNotMatch(canvas, /video-tetris-rain/, "generation status must not render falling-piece animation");
assert.doesNotMatch(canvas, /node-spinner/, "generation status must not render spinner animation");
assert.match(css, /\.blank-canvas\s*\{\s*background:\s*#000;/, "canvas background must be pure black");
assert.match(css, /\.blank-canvas::before\s*\{[\s\S]*?linear-gradient\(#070707 1px/, "canvas grid must use a near-black hairline");
assert.match(css, /\.blank-canvas::before\s*\{[\s\S]*?background-size:\s*24px\s+24px/, "canvas grid must use a fixed screen-sized rhythm");
assert.match(css, /\.canvas-links path\.active-link,[\s\S]*?\.canvas-links path\.image-link\s*\{[\s\S]*?stroke:\s*#fff/, "image connections must be pure white");
assert.match(css, /\.canvas-links path\.video-link\s*\{[\s\S]*?stroke:\s*#fff/, "video connections must be pure white");
assert.doesNotMatch(css, /stroke-dasharray:\s*3\s+6/, "canvas connections must not use a dashed pattern");
assert.match(css, /\.canvas-links path\.active-link,[\s\S]*?\.canvas-links path\.pending-link\s*\{[\s\S]*?vector-effect:\s*non-scaling-stroke/, "canvas connections must remain continuous at zoom levels");
assert.match(html, /<svg id="canvasLinks"[^>]*>\s*<g id="canvasLinksContent"><\/g>\s*<\/svg>/, "canvas links must scale inside the SVG coordinate system");
assert.match(canvas, /const content = qs\("#canvasLinksContent"\) \|\| svg;/, "link rendering must target the inner SVG group");
assert.match(canvas, /linksGroup\.setAttribute\("transform", `translate\(\$\{Math\.round\(x\)\} \$\{Math\.round\(y\)\}\) scale\(\$\{scale\}\)`\)/, "canvas zoom must use an SVG group transform for stable strokes");
assert.doesNotMatch(css, /\.canvas-links\s*\{[^}]*?will-change:\s*transform/, "the root link SVG must not be promoted as a scaled compositor layer");
assert.match(css, /\.generation-progress-track\s*\{/, "static generation progress track styles must exist");
assert.doesNotMatch(html, /class="context-icon|class="context-arrow/, "creation menus must display text without decorative icons");
assert.match(css, /\.canvas-context-menu\s*\{[\s\S]*?width:\s*248px[\s\S]*?background:\s*rgba\(10,\s*12,\s*14,\s*0\.96\)/, "creation menu must use the compact dark surface");
assert.match(css, /\.canvas-context-menu button\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*?font-weight:\s*450/, "creation menu text must use a light single-column treatment");
assert.match(css, /\.canvas-context-menu button:focus-visible\s*\{/, "creation menu items must keep a visible keyboard focus state");

console.log("canvas design polish tests passed");
