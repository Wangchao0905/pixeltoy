import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CHATCUT_DIR, CHATCUT_STATUS, createChatcutAdapter } = require("../server/chatcut-adapter.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-chatcut-"));
const mediaRoot = path.join(root, "06_videos", "raw");
fs.mkdirSync(mediaRoot, { recursive: true });
const firstClip = path.join(mediaRoot, "E01_V01.mp4");
const secondClip = path.join(mediaRoot, "E01_V02.mp4");
const roughCut = path.join(root, "11_final_cut", "rough_cut.mp4");
const exportFile = path.join(root, "chatcut-export.mp4");
fs.mkdirSync(path.dirname(roughCut), { recursive: true });
fs.writeFileSync(firstClip, Buffer.alloc(2048, "a"));
fs.writeFileSync(secondClip, Buffer.alloc(2048, "b"));
fs.writeFileSync(roughCut, Buffer.alloc(4096, "r"));
fs.writeFileSync(exportFile, Buffer.alloc(3072, "e"));

try {
  const adapter = createChatcutAdapter({ env: {} });
  const result = adapter.buildPackage({
    episodeRoot: root,
    project: { id: "episode-01", title: "裂隙追凶", episodeCode: "E01" },
    roughCutPath: roughCut,
    shots: [
      { name: "E01_V01", durationSeconds: 2.5, filePath: firstClip },
      { name: "E01_V02", durationSeconds: 3, filePath: secondClip },
    ],
  });

  assert.equal(result.status, CHATCUT_STATUS.PACKAGE_READY);
  assert.equal(result.packageDir, path.join(root, CHATCUT_DIR));
  assert.ok(fs.existsSync(path.join(result.packageDir, "media", "rough_cut.mp4")));
  assert.ok(fs.existsSync(path.join(result.packageDir, "media", "shots", "001_E01_V01.mp4")));
  assert.ok(fs.existsSync(path.join(result.packageDir, "media", "shots", "002_E01_V02.mp4")));
  assert.ok(fs.existsSync(path.join(result.packageDir, "assembly_manifest.json")));
  assert.ok(fs.existsSync(path.join(result.packageDir, "edit_brief.md")));
  assert.ok(fs.existsSync(path.join(result.packageDir, "chatcut_state.json")));

  const manifest = JSON.parse(fs.readFileSync(path.join(result.packageDir, "assembly_manifest.json"), "utf8"));
  assert.deepEqual(manifest.shots.map((shot) => shot.name), ["E01_V01", "E01_V02"]);
  assert.deepEqual(manifest.shots.map((shot) => shot.order), [1, 2]);
  assert.deepEqual(manifest.shots.map((shot) => ({
    startSeconds: shot.timecode.startSeconds,
    endSeconds: shot.timecode.endSeconds,
  })), [
    { startSeconds: 0, endSeconds: 2.5 },
    { startSeconds: 2.5, endSeconds: 5.5 },
  ]);
  assert.match(manifest.sourceDigest, /^[a-f0-9]{64}$/);

  assert.deepEqual(adapter.readState(root).status, CHATCUT_STATUS.PACKAGE_READY);
  adapter.setState(root, CHATCUT_STATUS.EDITING, { note: "人工确认后开始剪辑" });
  assert.equal(adapter.readState(root).status, CHATCUT_STATUS.EDITING);
  const imported = adapter.importExport(root, exportFile);
  assert.equal(imported.status, CHATCUT_STATUS.EXPORTED);
  assert.ok(fs.existsSync(imported.export.path));
  adapter.setState(root, CHATCUT_STATUS.APPROVED, { note: "人工确认本集" });
  assert.equal(adapter.readState(root).status, CHATCUT_STATUS.APPROVED);

  let networkCalls = 0;
  const offlineAdapter = createChatcutAdapter({
    env: {},
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("network should not be called");
    },
  });
  const diagnosis = offlineAdapter.diagnose();
  assert.equal(diagnosis.enabled, false);
  const automation = await offlineAdapter.automate({ episodeRoot: root });
  assert.equal(automation.enabled, false);
  assert.equal(automation.networkAttempted, false);
  assert.equal(networkCalls, 0);

  console.log("chatcut adapter tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
