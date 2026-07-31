import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(app, /data-modern-asset-replace=/, "asset cards should expose a replace action");
const replaceStart = app.indexOf("async function replaceModernAssetImage");
const replaceEnd = app.indexOf("async function setAssetStyleReferenceEnabled", replaceStart);
assert.notEqual(replaceStart, -1, "modern asset replacement should have a dedicated function");
assert.notEqual(replaceEnd, -1, "modern asset replacement function should be bounded");
const replaceFunction = app.slice(replaceStart, replaceEnd);
assert.match(replaceFunction, /\/api\/project\/\$\{state\.selectedId\}\/asset-upload/, "replacement should use the bound asset upload endpoint");
assert.doesNotMatch(replaceFunction, /asset-upload-local/, "replacement should not use the local asset creation endpoint");
assert.match(
  app,
  /\$\("#modernAssetGallery"\)\?\.addEventListener\("click",[\s\S]*?data-modern-asset-replace[\s\S]*?replaceModernAssetImage/,
  "gallery click delegation should invoke modern asset replacement",
);

assert.match(css, /\.modern-asset-card-actions\s*\{[\s\S]*?grid-template-columns:/, "asset card actions should use a grid layout");
assert.match(html, /styles\.css\?v=[A-Za-z0-9._-]+/, "styles.css should have a cache version");
assert.match(html, /app\.js\?v=[A-Za-z0-9._-]+/, "app.js should have a cache version");

const localUploadStart = server.indexOf("function uploadLocalAsset");
const localUploadEnd = server.indexOf("\nfunction ", localUploadStart + 1);
assert.notEqual(localUploadStart, -1, "server should define uploadLocalAsset");
assert.notEqual(localUploadEnd, -1, "uploadLocalAsset should be bounded");
const localUpload = server.slice(localUploadStart, localUploadEnd);
assert.match(localUpload, /sameAssetLabel\(item\.label, label\)/, "local uploads should detect same-name assets");
assert.match(localUpload, /uploadBoundAsset\(episodeRoot, \{\s*assetId: existingItem\.id,[\s\S]*?\}\)/, "same-name local uploads should replace the existing bound asset");
assert.match(localUpload, /replacedExisting:\s*true/, "replaced local uploads should report replacement");

const boundUploadStart = server.indexOf("function uploadBoundAsset");
const boundUploadEnd = server.indexOf("\nfunction ", boundUploadStart + 1);
assert.notEqual(boundUploadStart, -1, "server should define uploadBoundAsset");
assert.notEqual(boundUploadEnd, -1, "uploadBoundAsset should be bounded");
const boundUpload = server.slice(boundUploadStart, boundUploadEnd);
assert.match(boundUpload, /\$\{assetId\}\$\{ext\}/, "bound assets should be saved using the asset id and extension");

assert.doesNotMatch(html, /modernManualAssetUploadPanel/, "the modern manual asset upload panel should be removed");
assert.doesNotMatch(app, /uploadModernManualAsset/, "the modern manual asset upload flow should be removed");

console.log("asset image replace tests passed");
