import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const { dialogueBlocksAreAllEnglish, convertScriptDialogueLanguage, extractDialogueBlocks } = __test.dialogue;

// 全英文对白块 → 判定为已英文
assert.equal(
  dialogueBlocksAreAllEnglish([{ text: "Hello there." }, { text: "I am fine, thanks." }]),
  true,
  "all-English blocks must be detected as English",
);
// 含中文 → 不是全英文
assert.equal(
  dialogueBlocksAreAllEnglish([{ text: "Hello." }, { text: "你好。" }]),
  false,
  "any CJK block must fail the all-English check",
);
// 空列表 → 不做"已英文"判断(交给正常流程)
assert.equal(dialogueBlocksAreAllEnglish([]), false, "empty blocks must not be treated as English");

// 集成:target=en + 英文剧本 → 自动跳过模型(不改动剧本,skipped=detected-english)。
// 若此路径误调模型,因无 API Key 会抛错而非返回 skipped,能立刻发现回归。
const enScript = "INT. ROOM - DAY\n\nJOHN\nHello there, how are you?\n\nMARY\nI am doing great, thank you.";
const auto = await convertScriptDialogueLanguage(enScript, "en", undefined, {});
assert.equal(auto.skipped, true, "English script + target=en must skip translation");
assert.equal(auto.skipReason, "detected-english", "auto-skip reason must be detected-english");
assert.equal(auto.script, enScript, "skipped conversion must not modify the script");

// 集成:手动 assumeEnglish=true 即使检测不确定也跳过(这里用同样英文剧本,断言 manual 原因优先)。
const manual = await convertScriptDialogueLanguage(enScript, "en", undefined, { assumeEnglish: true });
assert.equal(manual.skipped, true, "assumeEnglish must skip translation");
assert.equal(manual.skipReason, "manual", "manual flag must take precedence in skipReason");

console.log("dialogue english-skip tests passed");
