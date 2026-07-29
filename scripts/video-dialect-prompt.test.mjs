import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url);
const require = createRequire(import.meta.url);
const server = require(new URL("server.js", root).pathname);
const app = fs.readFileSync(new URL("public/app.js", root), "utf8");
const html = fs.readFileSync(new URL("public/index.html", root), "utf8");

const videoPrompt = server.__test?.videoPrompt;
assert.equal(typeof videoPrompt?.normalizeVideoDialectStyle, "function");
assert.equal(typeof videoPrompt?.videoDialectPromptDirective, "function");
assert.equal(typeof videoPrompt?.injectVideoDialectPrompt, "function");
assert.equal(typeof videoPrompt?.normalizeVideoSfxStyle, "function");
assert.equal(typeof videoPrompt?.videoSfxPromptDirective, "function");
assert.equal(typeof videoPrompt?.injectVideoSfxPrompt, "function");

for (const [id, options] of [
  ["configDialectEnabled", null],
  ["configDialectStyle", ["northeastern", "sichuan", "cantonese"]],
  ["modernDialectEnabled", null],
  ["modernDialectStyle", ["northeastern", "sichuan", "cantonese"]],
  ["configSfxEnabled", null],
  ["configSfxStyle", ["mystery", "epic", "palace", "vampire", "sci_fi", "disaster", "light", "comedy"]],
  ["modernSfxEnabled", null],
  ["modernSfxStyle", ["mystery", "epic", "palace", "vampire", "sci_fi", "disaster", "light", "comedy"]],
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `${id} must be present in the video config UI`);
  if (options) {
    const block = html.match(new RegExp(`<select id=["']${id}["'][^>]*>([\\s\\S]*?)</select>`))?.[1] || "";
    for (const value of options) assert.match(block, new RegExp(`value=["']${value}["']`), `${id} must expose ${value}`);
  }
}
assert.doesNotMatch(html, /搞笑无厘头/, "the visible SFX style list must use the shorter 搞笑 label");

assert.equal(videoPrompt.normalizeVideoDialectStyle(""), "none");
assert.equal(videoPrompt.normalizeVideoDialectStyle("东北话"), "northeastern");
assert.equal(videoPrompt.normalizeVideoDialectStyle("四川话"), "sichuan");
assert.equal(videoPrompt.normalizeVideoDialectStyle("粤语"), "cantonese");

const sourcePrompt = "镜号 1\n人物台词：别急，马上就到。";
assert.equal(videoPrompt.injectVideoDialectPrompt(sourcePrompt, "none"), sourcePrompt, "disabled dialect must not change the prompt");
for (const [style, label] of [["northeastern", "东北话"], ["sichuan", "四川话"], ["cantonese", "粤语"]]) {
  const prompt = videoPrompt.injectVideoDialectPrompt(sourcePrompt, style);
  assert.match(prompt, new RegExp(`^方言对白风格：${label}`));
  assert.match(prompt, /人物对白、旁白和 OS/);
  assert.match(prompt, /镜号 1/);
  assert.equal(videoPrompt.injectVideoDialectPrompt(prompt, style), prompt, "dialect directive must not duplicate");
}

assert.equal(videoPrompt.normalizeVideoSfxStyle(""), "none");
assert.equal(videoPrompt.normalizeVideoSfxStyle("搞笑"), "comedy");
assert.equal(videoPrompt.normalizeVideoSfxStyle("搞笑无厘头"), "comedy");
for (const [style, label] of [["mystery", "悬疑"], ["epic", "史诗"], ["palace", "宫斗"], ["vampire", "吸血鬼"], ["sci_fi", "科幻"], ["disaster", "灾难"], ["light", "轻松"], ["comedy", "搞笑"]]) {
  const prompt = videoPrompt.injectVideoSfxPrompt(sourcePrompt, style);
  assert.match(prompt, new RegExp(`^声音设计风格：${label}`));
  assert.match(prompt, /BGM：/);
  assert.match(prompt, /混音规则：/);
  assert.equal(videoPrompt.injectVideoSfxPrompt(prompt, style), prompt, "SFX directive must not duplicate");
}
assert.equal(videoPrompt.injectVideoSfxPrompt(sourcePrompt, "none"), sourcePrompt, "disabled SFX must not change the prompt");

assert.match(app, /function selectedVideoDialectStyle\(/);
assert.match(app, /dialectStyle:\s*selectedVideoDialectStyle\(\)/);
assert.match(app, /function selectedVideoSfxStyle\(/);
assert.match(app, /sfxStyle:\s*selectedVideoSfxStyle\(\)/);
assert.match(app, /function hydrateConfigInputs[\s\S]*setVideoDialectControls\(/);
assert.match(app, /function hydrateConfigInputs[\s\S]*setVideoSfxControls\(/);
assert.match(fs.readFileSync(new URL("server.js", root), "utf8"), /injectVideoSfxPrompt\(injectVideoDialectPrompt\(shot\.prompt, requestedDialectStyle\), requestedSfxStyle\)/);

console.log("video dialect prompt tests passed");
