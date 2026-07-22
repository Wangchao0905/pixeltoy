import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const canvasHtml = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(html, /value="gpt-image-2">GPT Image 2/);
assert.match(html, /value="seedream-5-0-pro">Seedream 5\.0 Pro/);
assert.match(html, /value="seedream-5-0-lite">Seedream 5\.0 Lite/);
assert.match(canvasHtml, /data-node-field="model"/);
assert.match(canvas, /model: "gpt-image-2"/);
assert.match(canvas, /imageModel: settings\.model/);
assert.match(app, /imageModel: item\.model \|\| "gpt-image-2"/);
assert.match(server, /POST.*images\/generations|images\/generations/);
assert.match(server, /VOLC_ARK_IMAGE_PRO_MODEL/);
assert.match(server, /VOLC_ARK_IMAGE_LITE_MODEL/);
assert.match(server, /runSeedreamCanvasImageJob/);

const require = createRequire(import.meta.url);
const loaded = require(path.join(root, "server.js"));
const image = loaded.__test.canvasImage;
assert.equal(image.normalizeCanvasImageModel("gpt-image-2"), "gpt-image-2");
assert.equal(image.normalizeCanvasImageModel("seedream-5-0-pro"), "seedream-5-0-pro");
assert.equal(image.normalizeCanvasImageModel("seedream-5-0-lite"), "seedream-5-0-lite");
assert.equal(image.canvasImageModelConfig("seedream-5-0-pro").provider, "ark");
assert.equal(image.canvasImageModelConfig("seedream-5-0-lite").provider, "ark");
assert.equal(image.canvasImageModelConfig("gpt-image-2").provider, "gpt");
const payload = image.seedreamImagePayload({ providerModel: "doubao-seedream-5-0-260128", prompt: "test", size: "1280x720" });
assert.equal(payload.model, "doubao-seedream-5-0-260128");
assert.equal(payload.size, "1280x720");
assert.equal(payload.response_format, "url");

console.log("image model routing tests passed");
