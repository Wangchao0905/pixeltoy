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
assert.match(app, /referenceImages: state\.imageStudio\.references[\s\S]*!reference\.uploading/);

console.log("image reference upload tests passed");
