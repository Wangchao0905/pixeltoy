import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public", "canvas.html"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "canvas.css"), "utf8");

assert.match(html, /data-asset-action="certify-ark-virtual-person"/, "image context menu must expose private virtual-person certification");
assert.match(html, /class="ark-virtual-person-badge"/, "asset node must expose the certification badge");
assert.match(js, /function certifyArkVirtualPersonFromMenu\(/, "right-click action must call the Ark certification flow");
assert.match(js, /\/api\/canvas\/ark-virtual-person/, "certification must use the dedicated Ark endpoint");
assert.match(js, /status === "active" && arkPersonAssetUrl\(asset\)/, "the badge must require an active Ark asset URI");
assert.match(js, /isAiGeneratedPhotorealAsset\(asset\)/, "only AI-generated photoreal images may enter the virtual-person flow");
assert.match(css, /\.ark-virtual-person-badge[^}]*background:\s*#1687ff/s, "certification check must use a blue badge");
assert.match(css, /\.ark-virtual-person-badge\s*\{[^}]*top:\s*8px;[^}]*right:\s*8px;[^}]*left:\s*auto;[^}]*transform:\s*none;/s, "certification badge must sit fully inside the image top-right corner");
assert.doesNotMatch(css, /\.ark-virtual-person-badge\s*\{[^}]*top:\s*-\d/s, "certification badge must not be clipped by a negative top offset");

console.log("canvas Ark virtual-person UI tests passed.");
