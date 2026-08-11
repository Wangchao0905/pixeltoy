// 剧本格式硬规范测试：严格对齐《Badass Nanny 铁拳俏保姆》对标 DOCX。
// 一卡 + 人设 + 大纲 + 连续正文 / △动作 / 角色：对白。
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
    scenes: { scenes: [{ id: "S001", unit_number: 1, location_zh: "Blair House 客厅", time_zh: "夜晚", indoor_outdoor: "内", characters: ["C001", "C002"], action_zh: "内部场景动作不应成为正式导出正文。" }] },
    dialogue: { lines: [{ id: "D1", scene_id: "S001", speaker: "C001", delivery_en: "urgent", dialogue_en: "There is something outside.", intent_zh: "Iris 感到不安。" }] },
    characters: { characters: [{ id: "C001", name_en: "Iris Brooks", name_zh: "Iris Brooks" }, { id: "C002", name_en: "Ethan Cole", name_zh: "Ethan Cole" }] },
  },
  screenplay: {
    schemaVersion: 1,
    episodes: [{
      number: 1,
      scenes: [{
        number: "1-1",
        location_zh: "Blair House 客厅",
        time_zh: "夜晚",
        indoor_outdoor: "内",
        characters: ["Iris Brooks", "Ethan Cole"],
        action_zh: "Iris 走进客厅，Ethan 站在窗边。",
        dialogue: [{ speaker: "Iris Brooks", dialogue: "There is something outside." }],
      }],
    }],
  },
};

const dir = mkdtempSync(path.join(tmpdir(), "pw-docx-format-"));
const out = path.join(dir, "out.docx");
try {
  writeScriptDocument({ scriptFile, outputFile: out, payload });
  execSync(`unzip -o ${JSON.stringify(out)} -d ${JSON.stringify(path.join(dir, "x"))} >/dev/null 2>&1`);
  const xml = readFileSync(path.join(dir, "x", "word", "document.xml"), "utf8");

  assert.match(xml, /剧本正文：/, "必须有剧本正文标题");
  assert.match(xml, /第一集/, "分集标题必须使用中文集数");
  assert.match(xml, /1-1 Blair House 客厅 夜 内/, "首场必须为 [集-场] [地点] [日夜] [内外]");
  assert.match(xml, /△Iris 走进客厅，Ethan 站在窗边。/, "动作必须以 △ 开头");
  assert.doesNotMatch(xml, /内部场景动作不应成为正式导出正文/, "正式 DOCX 必须优先使用 screenplay 交付结构");
  assert.match(xml, /Iris Brooks：There is something outside\./, "角色名与对白必须处于同一段");
  assert.match(xml, /Iris Brooks/, "出场人物必须用角色名字");
  assert.match(xml, /Ethan Cole/, "出场人物必须列出全部角色名字");
  assert.ok(!xml.includes("S001"), "场景代号 S001 不得出现在导出剧本中");
  assert.ok(!xml.includes("C001"), "角色代号 C001 不得出现在导出剧本中");
  assert.ok(!xml.includes("场景："), "不得输出字段式场景标题");
  assert.ok(!xml.includes("时间："), "不得输出字段式时间");
  assert.ok(!xml.includes("内外："), "不得输出字段式内外景");
  assert.ok(!xml.includes("Delivery:"), "不得输出 Delivery 说明");
  assert.ok(!xml.includes("剧情意图"), "不得输出内部剧情意图");
  assert.ok(!xml.includes("未标注"), "正式剧本不得出现未标注内外景");

  console.log("pixeltale-docx-format ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
