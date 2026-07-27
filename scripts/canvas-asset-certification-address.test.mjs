import assert from "node:assert/strict";
import fs from "node:fs";
import serverModule from "../server.js";

const canvasAsset = serverModule.__test.canvasAsset;
assert.ok(canvasAsset, "canvas asset helpers must be exported for regression coverage");

const result = await canvasAsset.toPublicUrl({
  name: "历史素材",
  publicUrl: "http://legacy.example/image.png",
  url: "https://cdn.example/image.png",
});

assert.equal(
  result.url,
  "https://cdn.example/image.png",
  "an obsolete HTTP publicUrl must not block a valid HTTPS library URL",
);

const canvasSource = fs.readFileSync(new URL("../public/canvas.js", import.meta.url), "utf8");
assert.match(canvasSource, /publicUrl: asset\.publicUrl \|\| asset\.public_url/);
assert.match(canvasSource, /localUrl: asset\.localUrl \|\| asset\.local_url/);
assert.match(
  canvasSource,
  /publicUrl: asset\.publicUrl,[\s\S]*localUrl: asset\.localUrl,/,
  "manual certification must send the preserved local fallback address",
);

console.log("canvas asset certification address tests passed");
