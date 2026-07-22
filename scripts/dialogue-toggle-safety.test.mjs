import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const { extractDialogueBlocks, dialogueBlocksLookSafe } = __test.dialogue;

// 事故复现:说话人误判(如"血税官")后,旧逻辑会把〔场景卡〕/数字｜镜头｜/单字名全吞成一个巨块,
// 翻译时整篇被替换成英文并塌成一行。加固后:结构标记必须成为对白块边界。
const script = [
  "血税官",
  "〔场景·天阙永夜舞厅〕百尺黑曜石大厅,穹顶封灰幕。",
  "1｜特写｜银质抽血管刚从血奴颈侧拔出。",
  "昼",
  "半寸阳光买你这条烂命。太贵了。",
  "2｜全景｜舞厅大门无声合拢。",
  "绯",
  "你杀得干净。可惜饵也是真的。",
  "3｜中景｜绯立于黑金阶梯。",
].join("\n");

// 第2层:边界加固——不再有对白块吞掉场景卡/镜头行,最大块跨行数不应爆炸(修复前=8)。
{
  const blocks = extractDialogueBlocks(script);
  const maxSpan = Math.max(0, ...blocks.map((b) => b.lineIndexes.length));
  assert.ok(maxSpan <= 6, `对白块跨行数应被边界收住(<=6),实际 ${maxSpan}`);
  for (const b of blocks) {
    for (const idx of b.lineIndexes) {
      const line = script.split("\n")[idx];
      assert.ok(!/^[〔【]/.test(line) && !/^\d+\s*[｜|]/.test(line), `对白块不应含结构行:${line}`);
    }
  }
}

// 第1层:熔断护栏——即便上游意外形成了吞过界的巨块,也必须判定不安全(中止写回)。
{
  const badBlocks = [{ id: 0, speaker: "血税官", lineIndexes: [1, 2, 3, 4, 5, 6, 7, 8] }];
  const verdict = dialogueBlocksLookSafe(script, badBlocks);
  assert.equal(verdict.safe, false, "吞掉场景卡/镜头的巨块必须判不安全");
  assert.ok(verdict.reason, "不安全时须给出原因");

  // 正常小对白块(不含结构行、行数少)应判安全。
  const okScript = ["周桂兰", "饭马上好了。"].join("\n");
  const okBlocks = [{ id: 0, speaker: "周桂兰", lineIndexes: [1] }];
  assert.equal(dialogueBlocksLookSafe(okScript, okBlocks).safe, true, "正常对白块应判安全");

  // 替换过半正文应判不安全。
  const half = ["A", "x", "y", "z"].join("\n");
  const halfBlocks = [{ id: 0, speaker: "A", lineIndexes: [1, 2, 3] }];
  assert.equal(dialogueBlocksLookSafe(half, halfBlocks).safe, false, "替换>50%正文应判不安全");
}

console.log("dialogue toggle safety tests passed");
