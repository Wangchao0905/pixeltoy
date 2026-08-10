// 剧本格式硬规范测试（script-format-guardian）：
// 场号 X-X 格式 / 纯名字无代号 / 无无关内容 / 剧情中文保留。
// 2026-08-10 按用户格式参考图（场号/场景/时间/内外/人物/动作/角色名：台词）。
import assert from "node:assert/strict";
import { writeScriptDocument } from "../server/pixeltale-script-document.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptFile = path.join(root, "server", "pixeltale-script-document.py");

const payload = {
  input: { episodeCount: 1 },
  episode_scale: "1 episodes",
  sourceArtifacts: {
    arc: { units: [{ number: 1, title_zh: "直播里的好运绳结", plot_zh: "Iris 在直播中看见巨兽。" }] },
    scenes: { scenes: [{ id: "S001", unit_number: 1, location_zh: "Blair House 客厅", time_zh: "夜晚", indoor_outdoor: "内", characters: ["C001", "C002"], action_zh: "Iris 走进客厅，Ethan 站在窗边。" }] },
    dialogue: { lines: [{ id: "D1", scene_id: "S001", speaker: "C001", delivery_en: "urgent", dialogue_en: "There is something outside.", intent_zh: "Iris 感到不安。" }] },
    characters: { characters: [{ id: "C001", name_en: "Iris Brooks", name_zh: "Iris Brooks" }, { id: "C002", name_en: "Ethan Cole", name_zh: "Ethan Cole" }] },
  },
};

const dir = mkdtempSync(path.join(tmpdir(), "pw-docx-format-"));
const out = path.join(dir, "out.docx");
try {
  writeScriptDocument({ scriptFile, outputFile: out, payload });
  execSync(`unzip -o ${JSON.stringify(out)} -d ${JSON.stringify(path.join(dir, "x"))} >/dev/null 2>&1`);
  const xml = readFileSync(path.join(dir, "x", "word", "document.xml"), "utf8");

  assert.match(xml, /1-1 场景：/, "场号必须为 X-X 格式（第 1 集第 1 场）");
  assert.match(xml, /场景：Blair House 客厅/, "场景必须用地点名");
  assert.match(xml, /时间：夜晚/, "时间字段必须存在");
  assert.match(xml, /内外：内/, "内外景字段必须存在");
  assert.match(xml, /Iris Brooks/, "出场人物必须用角色名字");
  assert.match(xml, /Ethan Cole/, "出场人物必须列出全部角色名字");
  assert.match(xml, /IRIS BROOKS/, "对白角色名必须用名字（大写 Character）");
  assert.ok(!xml.includes("S001"), "场景代号 S001 不得出现在导出剧本中");
  assert.ok(!xml.includes("C001"), "角色代号 C001 不得出现在导出剧本中");
  assert.ok(!xml.includes("场景目的"), "不得输出创作依据（场景目的）");
  assert.ok(!xml.includes("开头暴击"), "不得输出创作依据（开头暴击）");
  assert.ok(!xml.includes("冲突"), "不得输出创作依据（冲突/选择/结果）");
  assert.match(xml, /剧情意图/, "中文剧情意图（剧情恒中文）必须保留");

  console.log("pixeltale-docx-format ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
