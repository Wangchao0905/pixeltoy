import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

assert.match(app, /function prepareImageReferenceDataUrl\(/);
assert.match(app, /createImageBitmap/);
assert.match(app, /image\/webp/);
assert.match(app, /const referenceUploadConcurrency = 2/);
assert.match(app, /Promise\.all\(workers\.map\(\(worker\) => worker\(\)\)\)/);
assert.match(app, /URL\.createObjectURL\(file\)/);
assert.match(app, /uploading: true/);
assert.match(app, /reference\.uploading\)/);
assert.match(app, /URL\.revokeObjectURL\(/);
const imageSubmit = app.slice(app.indexOf("async function submitImageExploreGeneration"), app.indexOf("async function uploadImageExploreReferences"));
assert.match(imageSubmit, /const referenceImages = state\.imageStudio\.references[\s\S]*\.filter\(\(reference\) => !reference\.uploading\)/, "only completed uploads may become generation references");
assert.match(imageSubmit, /referenceImages,/, "the completed reference URLs must be retained on every submitted image task");

console.log("image reference upload tests passed");
