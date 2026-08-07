import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const {
  inlineColonDialogueRanges,
  quotedDialogueRanges,
  applyDialogueAndBlockquoteTranslations,
  blockquoteDialogues,
  projectDialogueLanguage,
  persistProjectDialogueLanguage,
  convertScriptDialogueLanguage,
} = __test.dialogue;

const inlineScript = [
  "张三：你好，欢迎来到现场。",
  "EVELYN: \"There she is...\"",
  "小北皱眉，乐高从手里滑落：\"妈咪，那个叔叔闻起来像枪油。\"",
].join("\n");

const inline = inlineColonDialogueRanges(inlineScript, "en", { limit: Infinity });
assert.equal(inline.length, 2, "行内角色：对白应被提取,叙述中的动作短语不能误当说话人");
assert.deepEqual(
  inline.map((item) => item.text),
  ["你好，欢迎来到现场。", "There she is..."],
);
assert.equal(inline[1].quoteOpen, '"', "英文引号应保留为替换范围元数据");

const quoted = quotedDialogueRanges("小北说：“别走。”", "zh", { limit: Infinity });
assert.equal(quoted.length, 1, "叙述中的中文引号对白应被提取");
assert.equal(quoted[0].text, "别走。");
assert.equal(quotedDialogueRanges("张三：「你好。」", "zh", { limit: Infinity })[0].text, "你好。");

const conversionRanges = [
  ...inline,
  ...quotedDialogueRanges(inlineScript, "en", { limit: Infinity }).filter(
    (item) => !inline.some((direct) => direct.replaceStart === item.replaceStart && direct.replaceEnd === item.replaceEnd),
  ),
].map((item, id) => ({ ...item, id }));
const translated = applyDialogueAndBlockquoteTranslations(
  inlineScript,
  [],
  [],
  conversionRanges.map((item, id) => ({ id, text: ["Hello, welcome to the scene.", "There she is...", "Mommy, that man smells like gun oil."][id] })),
  conversionRanges,
);
assert.match(translated, /张三：Hello, welcome to the scene\./);
assert.match(translated, /EVELYN: "There she is\.\.\."/);
assert.match(translated, /小北皱眉，乐高从手里滑落："Mommy, that man smells like gun oil\."/);

const previousFetch = globalThis.fetch;
process.env.ASSET_ANALYZER_API_KEY = process.env.ASSET_ANALYZER_API_KEY || "dialogue-test-key";
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  const payload = JSON.parse(request.messages[1].content);
  const response = {
    translations: payload.dialogues.map((item) => ({
      id: item.id,
      text: "译文-" + item.id,
    })),
  };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
try {
  const converted = await convertScriptDialogueLanguage(inlineScript, "en", "test-model");
  assert.equal(converted.count, 3, "转换请求应包含三段对白");
  assert.match(converted.script, /张三：译文-0/);
  assert.match(converted.script, /EVELYN: "译文-1"/);
  assert.match(converted.script, /小北皱眉，乐高从手里滑落："译文-2"/);
} finally {
  globalThis.fetch = previousFetch;
}

const blockquoteScript = "> 张三：你好。";
assert.deepEqual(blockquoteDialogues(blockquoteScript, "zh"), [{ speaker: "张三", text: "你好。" }]);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toy-dialogue-"));
const episodeRoot = path.join(tempRoot, "outputs", "e01");
fs.mkdirSync(episodeRoot, { recursive: true });
try {
  persistProjectDialogueLanguage(episodeRoot, "zh");
  assert.equal(projectDialogueLanguage(episodeRoot, "en"), "zh", "没有 manifest/config 时也必须持久化对白语言");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("dialogue language conversion: OK");
