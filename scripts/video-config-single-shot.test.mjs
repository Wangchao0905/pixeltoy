import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const { __test } = createRequire(import.meta.url)(path.join(root, "server.js"));

assert.match(server, /action === "video-config-shot"/, "server needs a single-shot video config route");
assert.match(server, /buildVideoConfigForShot\(/, "server needs a single-shot config builder");
assert.match(server, /body\.shotName/, "single-shot config must receive the selected shot name");
assert.match(app, /data-segment-config=/, "each video segment needs a config action");
assert.match(index, /id=\"modernVideoQueueConfig\"/, "the selected take inspector needs a config action");
assert.match(app, /function generateVideoConfigForSegment\(/, "the segment config action needs a client handler");
assert.match(app, /video-config-shot/, "the client must call the single-shot config route");
assert.match(app, /重新生成当前片段的视频配置/, "the single-shot config action must be explicit");
assert.match(server, /mergeVideoConfigAssetRecords/, "single-shot config must merge fresh asset records");
assert.match(server, /projectProductionAssetsForState\(episodeRoot, manifest/, "single-shot config must rescan current assets");

const mergeVideoConfigAssetRecords = __test?.videoConfig?.mergeAssetRecords;
assert.equal(typeof mergeVideoConfigAssetRecords, "function", "asset merge helper must be testable");
const clearStaleAssetLibraryBinding = __test?.videoConfig?.clearStaleAssetLibraryBinding;
assert.equal(typeof clearStaleAssetLibraryBinding, "function", "stale library binding cleanup must be testable");
const applyHistoricalBindings = __test?.videoConfig?.applyHistoricalBindings;
assert.equal(typeof applyHistoricalBindings, "function", "historical binding merge must be testable");
const reconcileVideoReferenceAsset = __test?.videoReferences?.reconcileAssetSource;
assert.equal(typeof reconcileVideoReferenceAsset, "function", "video references must reconcile against the current disk asset");
const merged = mergeVideoConfigAssetRecords(
  [
    { name: "主角", file: "old-character.png", manifestType: "Character" },
    { name: "旧道具", file: "old-prop.png", manifestType: "Prop" },
  ],
  [
    { name: "主角", file: "new-character.png", manifestType: "Character" },
    { name: "新场景", file: "new-scene.png", manifestType: "Scene" },
  ],
);
assert.deepEqual(merged.map((asset) => [asset.name, asset.file]), [
  ["主角", "new-character.png"],
  ["旧道具", "old-prop.png"],
  ["新场景", "new-scene.png"],
], "same-name fresh assets replace old records while unrelated assets remain");
assert.equal(new Set(merged.map((asset) => asset.name)).size, merged.length, "merged asset names must be unique");
const refreshed = clearStaleAssetLibraryBinding({
  name: "主角",
  file: "new-character.png",
  assetUrl: "asset://old-character",
  publicUrl: "https://old.example/character.png",
  validationStatus: "active",
  arkPersonAsset: { enabled: true, assetUrl: "asset://old-person" },
});
assert.equal(refreshed.assetUrl, "", "replaced assets must not keep the old library asset URL");
assert.equal(refreshed.publicUrl, "", "replaced assets must not keep the old public URL");
assert.equal(refreshed.arkPersonAsset, undefined, "replaced assets must not keep the old person binding");

// 回归:同名资产被覆盖在同一路径后，旧 config 仍可能带着旧的 asset:// 绑定。
// 参考图提交必须以当前磁盘文件为准，并清空已经失效的远端/真人库绑定。
const reconciled = reconcileVideoReferenceAsset(
  {
    name: "S003_兰溪村村口_日_WIDE_ESTABLISHING",
    file: "assets/scenes/S003_兰溪村村口_日_WIDE_ESTABLISHING.png",
    sourceFingerprint: "old-mtime-613",
    assetUrl: "asset://old-scene",
    publicUrl: "https://old.example/scene.png",
  },
  {
    assetName: "S003_兰溪村村口_日_WIDE_ESTABLISHING",
    rel: "assets/scenes/S003_兰溪村村口_日_WIDE_ESTABLISHING.png",
    sourceFingerprint: "new-mtime-1690",
    url: "/media?path=current-scene",
    updatedAt: "2026-08-04T15:00:00.000Z",
    size: 1690,
  },
);
assert.equal(reconciled.file, "assets/scenes/S003_兰溪村村口_日_WIDE_ESTABLISHING.png", "current disk path must remain the source");
assert.equal(reconciled.url, "/media?path=current-scene", "current disk URL must replace the stale config URL");
assert.equal(reconciled.assetUrl, "", "changed source must not submit the old asset library binding");
assert.equal(reconciled.publicUrl, "", "changed source must not submit the old public binding");
const legacyReconciled = reconcileVideoReferenceAsset(
  { name: "旧配置场景", file: "assets/scenes/旧配置场景.png", publicUrl: "https://old.example/scene.png" },
  { assetName: "旧配置场景", rel: "assets/scenes/旧配置场景.png", sourceFingerprint: "current", url: "/media?path=current" },
);
assert.equal(legacyReconciled.publicUrl, "", "legacy config without a source fingerprint must not keep its old public binding");
const historicalFiltered = applyHistoricalBindings(
  [{ name: "旧配置场景", sourceFingerprint: "current", sourceUpdatedAt: "2026-08-04T15:00:00.000Z" }],
  new Map([["旧配置场景", { name: "旧配置场景", assetUrl: "asset://old-scene", validationStatus: "active" }]]),
)[0];
assert.equal(historicalFiltered.assetUrl, undefined, "an unversioned historical binding must not return to a current asset");

console.log("single-shot video config tests passed");
