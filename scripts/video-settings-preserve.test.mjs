import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.equal(typeof __test.videoSettings?.updateVideoSettingsInConfig, "function", "video settings updater must be exposed for regression coverage");
assert.match(server, /action === "video-settings"/, "server must expose a lightweight video settings route");
assert.match(app, /\/video-settings/, "client must persist lightweight video settings");
assert.match(app, /function saveVideoSettings\(/, "client must have a lightweight settings saver");
assert.match(
  app,
  /\["configRatio", "configResolution", "configModel"\][\s\S]*?saveVideoSettings\(\{/,
  "legacy model and format controls must not rebuild the full video config",
);
assert.match(
  app,
  /\["configDialectEnabled", "configDialectStyle"\][\s\S]*?saveVideoSettings\(\{ dialectStyle: selectedVideoDialectStyle\(\) \}\)/,
  "legacy dialect controls must not rebuild the full video config",
);

const original = {
  videoCanvasId: "episode::video::run-1",
  runNamespace: "run-1",
  modelName: "seedance-2-0-fast",
  dialectStyle: "none",
  settings: {
    ratio: "16:9",
    resolution: "480p",
    dialectStyle: "none",
  },
  shots: [
    { name: "E01_V01", prompt: "completed shot prompt", status: "complete" },
    { name: "E01_V02", prompt: "second shot prompt", status: "queued" },
  ],
  tailFrameAssets: { E01_V01: { status: "active" } },
};

const next = __test.videoSettings.updateVideoSettingsInConfig(original, {
  modelName: "seedance-2-0-mini",
  ratio: "9:16",
  resolution: "720p",
  dialectStyle: "sichuan",
});

assert.equal(next.videoCanvasId, original.videoCanvasId, "changing settings must keep the video canvas identity");
assert.equal(next.runNamespace, original.runNamespace, "changing settings must keep the active run namespace");
assert.equal(next.modelName, "seedance-2-0-mini", "the selected model must be persisted");
assert.equal(next.settings.ratio, "9:16", "the selected ratio must be persisted");
assert.equal(next.settings.resolution, "720p", "the selected resolution must be persisted");
assert.equal(next.settings.dialectStyle, "sichuan", "the selected dialect must be persisted");
assert.equal(next.shots.length, original.shots.length, "changing settings must keep every shot");
assert.equal(next.shots[0].status, "complete", "changing settings must keep completed shot state");
assert.equal(next.shots[0].prompt.startsWith("方言对白风格：粤语") || next.shots[0].prompt.startsWith("方言对白风格：四川话"), true, "new dialect must apply to future shot submissions");
assert.deepEqual(original.shots[0], { name: "E01_V01", prompt: "completed shot prompt", status: "complete" }, "the updater must not mutate the original config");

const disabled = __test.videoSettings.updateVideoSettingsInConfig(next, { dialectStyle: "none" });
assert.equal(disabled.dialectStyle, "none", "disabling dialect must clear the top-level setting");
assert.equal(disabled.settings.dialectStyle, "none", "disabling dialect must clear the settings value");
assert.equal(disabled.shots[0].prompt, "completed shot prompt", "disabling dialect must restore the underlying prompt");
const sfxEnabled = __test.videoSettings.updateVideoSettingsInConfig(original, { sfxStyle: "comedy" });
assert.equal(sfxEnabled.sfxStyle, "comedy", "the selected SFX style must be persisted");
assert.equal(sfxEnabled.settings.sfxStyle, "comedy", "the selected SFX style must be persisted in settings");
assert.match(sfxEnabled.shots[0].prompt, /^声音设计风格：搞笑/, "the selected SFX style must be injected into existing shot prompts");
const sfxDisabled = __test.videoSettings.updateVideoSettingsInConfig(sfxEnabled, { sfxStyle: "none" });
assert.equal(sfxDisabled.sfxStyle, "none", "disabling SFX must clear the top-level setting");
assert.equal(sfxDisabled.shots[0].prompt, "completed shot prompt", "disabling SFX must restore the underlying prompt");

console.log("video settings preservation tests passed");
