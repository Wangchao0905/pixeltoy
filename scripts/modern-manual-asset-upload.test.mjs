import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(html, /id="modernManualAssetUpload"/, "modern asset document surface should expose a manual upload section");
assert.match(html, /id="modernManualAssetUploadType"/, "manual upload should let users choose the asset type");
assert.match(html, /option value="Character">人物/, "manual upload should include character classification");
assert.match(html, /option value="Scene">场景/, "manual upload should include scene classification");
assert.match(html, /option value="Prop">道具/, "manual upload should include prop classification");
assert.match(html, /id="modernManualAssetUploadFile"/, "manual upload should provide an image input");
assert.match(app, /function uploadModernManualAsset/, "modern manual upload should have a dedicated submit flow");
assert.match(app, /confirm:\s*false/, "modern manual upload must remain pending until classification is confirmed");
assert.match(app, /#modernManualAssetUpload.*addEventListener\("submit"/, "modern manual upload should be wired to the form");
assert.match(server, /const shouldConfirm = body\.confirm !== false/, "server should preserve legacy confirmation while supporting pending uploads");
assert.match(server, /nextManifest\.confirmed = shouldConfirm/, "pending uploads should leave the manifest unconfirmed");
assert.match(css, /\.modern-manual-asset-upload\s*\{[\s\S]*?border:/, "manual upload should have a visible grouped surface");

console.log("modern manual asset upload tests passed");
