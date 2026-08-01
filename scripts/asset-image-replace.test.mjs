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
assert.match(html, /href="\/styles\.css"/, "styles.css should use the ETag-revalidated runtime URL");
assert.match(html, /src="\/app\.js"/, "app.js should use the ETag-revalidated runtime URL");

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

// renderModernStudio 读 workflowEditorValue 得到 scriptSource / assetSource，再用它们渲染
// 「已载入 / 未保存」状态。2026-07-31 assetSource 的声明行被一次改动删掉、两处使用留着，
// 于是一进制作台就弹 ReferenceError: assetSource is not defined。
// 这里不逐个点名变量，而是把函数体里所有 *Source 标识符都要求有本地声明，
// 同类漏删（scriptSource 等）也一起挡住。
const studioStart = app.indexOf("\nfunction renderModernStudio(");
const studioEnd = app.indexOf("\nfunction syncModernSeriesNav(", studioStart);
assert.notEqual(studioStart, -1, "app should define renderModernStudio");
assert.notEqual(studioEnd, -1, "renderModernStudio should be bounded");
const studio = app.slice(studioStart, studioEnd);
const studioSourceVars = new Set(studio.match(/\b[A-Za-z_$][A-Za-z0-9_$]*Source\b/g) || []);
assert.ok(studioSourceVars.has("assetSource"), "renderModernStudio should still read the asset document source");
for (const name of studioSourceVars) {
  // assert.ok 而不是 assert.match：match 失败会把整个函数体(170 行)打进错误对象，淹掉结论。
  assert.ok(
    new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`).test(studio),
    `renderModernStudio uses ${name} but never declares it — this is the "${name} is not defined" regression`,
  );
}

console.log("asset image replace tests passed");
