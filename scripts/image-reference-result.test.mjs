import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.match(app, /function imageExploreReferenceButtonHtml\(/);
assert.match(app, /data-image-reference-add/);
assert.match(app, /function addImageExploreReferenceFromResult\(/);
assert.match(app, /state\.imageStudio\.references\.length >= 4/);
assert.match(app, /libraryPreviewUrl\(reference, 240\)/);
assert.match(app, /dataUrl, localOnly: true/);
assert.match(app, /\$\("#imageExplorePrompt"\)\?\.focus\(\)/);
assert.match(styles, /button\[data-image-reference-add\]/);

console.log("image reference result tests passed");
