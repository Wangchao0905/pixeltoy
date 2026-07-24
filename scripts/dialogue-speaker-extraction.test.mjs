import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const {
  dialoguesForText,
  inlineColonDialogues,
  backfillDialogueSpeakers,
  normalizeDialogueItems,
  seedanceDialogueText,
  buildScriptSpeakerMap,
  parseSectionDialogueTexts,
  dialoguesForShotWithSpeakers,
} = __test.dialogue;

// 密集单段剧本(内联 名字：台词,△/句号分隔,不换行) —— 竹编等剧本的真实格式。
const denseScript =
  "第1集1-1 沈一航家客厅 中午 内人物：周桂兰、沈一航△沈一航打开门。沈一航：妈，我饿了，饭好了没有？" +
  "周桂兰：饭马上好了。△沈一航转身。沈一航：妈，跟你说了多少次了，弄得满屋子都是灰！" +
  "△周桂兰抬头。周桂兰：我就在这儿做一会儿，马上收拾。";

// 内联提取器:说话人正确、无 metadata(内人物/参考资产)误提。
const inline = inlineColonDialogues(denseScript, "zh");
assert.ok(inline.length >= 3, `应提取到多条内联对白, 实际 ${inline.length}`);
assert.deepEqual(
  [...new Set(inline.map((d) => d.speaker))].sort(),
  ["周桂兰", "沈一航"],
  "说话人应为 周桂兰/沈一航,不得混入 内人物 等 metadata",
);
assert.ok(!inline.some((d) => /人物|参考资产|时长|画幅|时间|地点|场景/.test(d.speaker)), "不得误提 metadata 字段为说话人");

// dialoguesForText 汇聚后仍带正确 speaker。
const merged = dialoguesForText(denseScript, "zh");
assert.ok(merged.every((d) => d.speaker), "汇聚后每条对白都应带 speaker");

// 模型路径回填:模型给无归属纯台词字符串,应从剧本回填 speaker。
// 单镜节拍(≤15s)通常 ≤3 句对白,与 dialoguesForText 的 3 句上限一致。
const shotBeat = "△沈一航转身。沈一航：妈，跟你说了多少次了，弄得满屋子都是灰！△周桂兰抬头。周桂兰：我就在这儿做一会儿，马上收拾。";
const beatD = dialoguesForText(shotBeat, "zh");
const modelItems = normalizeDialogueItems(["妈，跟你说了多少次了，弄得满屋子都是灰！", "我就在这儿做一会儿，马上收拾。"], "zh");
const filled = backfillDialogueSpeakers(modelItems, beatD);
assert.ok(filled.every((d) => d.speaker), "模型无归属台词应回填出 speaker");

// 渲染:不再出现无说话人的裸台词,也不出现占位符「角色：」。
const rendered = seedanceDialogueText({ dialogues: filled });
assert.ok(/沈一航：/.test(rendered) && /周桂兰：/.test(rendered), `渲染应标明说话人, 实际: ${rendered}`);
assert.ok(!/角色：/.test(rendered), "不应出现占位符「角色：」");

// 模型带 名字：台词 时,保留模型 speaker。
const withSpeaker = backfillDialogueSpeakers(normalizeDialogueItems(["沈一航：饭好了没有？"], "zh"), beatD);
assert.equal(withSpeaker[0].speaker, "沈一航", "模型自带 speaker 应保留");

// 英文分镜回填:纯中文剧本没有英文台词时,英文模型行仍须只保留英文,不得追加中文。
const bilingualFallbackBeat = "NANA：睡不着，亲爱的？DYLAN：我也是。NANA：那我们聊聊。";
const englishBeat = dialoguesForText(bilingualFallbackBeat, "en");
const englishWithSpeakers = backfillDialogueSpeakers(
  normalizeDialogueItems(["NANA：Can't sleep either, sweetheart?", "DYLAN：Me neither."], "en"),
  englishBeat,
  { positional: true, dialogueLanguage: "en" },
);
assert.deepEqual(
  englishWithSpeakers,
  [
    { speaker: "NANA", text: "Can't sleep either, sweetheart?" },
    { speaker: "DYLAN", text: "Me neither." },
  ],
  "英文模型带 speaker 时应只输出目标语言对白",
);

// 英文模型未带 speaker 时,调用点 A 按本镜节拍同下标回填,仍不得追加中文剧本行。
const englishWithoutSpeakers = backfillDialogueSpeakers(
  normalizeDialogueItems(["Can't sleep either, sweetheart?", "Me neither."], "en"),
  englishBeat,
  { positional: true, dialogueLanguage: "en" },
);
assert.deepEqual(
  englishWithoutSpeakers,
  [
    { speaker: "NANA", text: "Can't sleep either, sweetheart?" },
    { speaker: "DYLAN", text: "Me neither." },
  ],
  "英文模型无 speaker 时应按位置回填且不混入中文",
);
const englishRendered = seedanceDialogueText({ dialogues: englishWithoutSpeakers });
assert.equal(englishRendered, "NANA：Can't sleep either, sweetheart? / DYLAN：Me neither.", "英文 Seedance 台词应带 speaker 且纯英文");
assert.ok(!/[\u4e00-\u9fff]/.test(englishRendered), "英文 Seedance 台词不得出现中文");

// 中文模式仍可把模型漏掉的中文剧本对白追加回来。
const chineseWithMissing = backfillDialogueSpeakers(
  normalizeDialogueItems(["NANA：睡不着，亲爱的？"], "zh"),
  dialoguesForText(bilingualFallbackBeat, "zh"),
  { dialogueLanguage: "zh" },
);
assert.equal(chineseWithMissing.length, 3, "中文模式仍应追加本镜缺失对白");
assert.ok(chineseWithMissing.every((item) => item.speaker && /[\u4e00-\u9fff]/.test(item.text)), "中文模式应保持说话人和中文台词");

// 调用点 B 使用全剧本 speakerMap,即使 map 顺序与 shot 不同也只能按文本匹配,不能按位置错配。
const unorderedSpeakerMap = [
  { speaker: "NANA", text: "睡不着，亲爱的？" },
  { speaker: "DYLAN", text: "我也是。" },
];
const unorderedShot = dialoguesForShotWithSpeakers(
  "设计块无台词",
  "对白：DYLAN：我也是。 / NANA：睡不着，亲爱的？",
  unorderedSpeakerMap,
  "zh",
);
assert.deepEqual(
  unorderedShot.map(({ speaker, text }) => ({ speaker, text })),
  [
    { speaker: "DYLAN", text: "我也是。" },
    { speaker: "NANA", text: "睡不着，亲爱的？" },
  ],
  "全剧本 speakerMap 调用点不得按位置错配 speaker",
);

// seedance 分镜设计块(剧情动作/光线/调色…字段)不得被当成对白说话人。
const designBlock =
  "推荐时长：15s画幅：9:16 vertical剧情动作：全片强制超写实真人电影实拍质感。" +
  "光线：右侧窗光斜照周桂兰的手和竹篾，形成较高光比。调色：延续藏青、暗灰和竹青主色，降低鲜艳颜色。" +
  "构图：中景偏近。声音：环境底噪与竹篾摩擦声。";
const designDlg = dialoguesForText(designBlock, "zh");
assert.ok(
  !designDlg.some((d) => /剧情动作|光线|调色|构图|声音|画面|环境|材质|节奏|运镜|景别|时长|画幅/.test(d.speaker)),
  `分镜设计字段不得成为说话人, 实际: ${JSON.stringify(designDlg)}`,
);

// ---- config 阶段:从 seedance section 的对白行取台词,用全剧本 map 补 speaker ----
const fullScript =
  "第1集 沈一航家客厅 中午△沈一航：妈，我饿了，饭好了没有？周桂兰：饭马上好了。" +
  "△沈一航：妈，跟你说了多少次了，弄得满屋子都是灰！周桂兰：我就在这儿做一会儿，马上收拾。" +
  "△沈一航：妈，今天是你的生日，我叫你多做几个菜。周桂兰：一航，你今早给我的50元钱，根本做不了一桌菜。";

// 全剧本 map 无上限,应覆盖 8 句以上(超过旧的 slice(0,8))。
const speakerMap = buildScriptSpeakerMap(fullScript, "zh");
assert.ok(speakerMap.length >= 6, `全剧本 map 应无上限覆盖多句, 实际 ${speakerMap.length}`);

// 对白行解析:去掉模型自加的名字前缀,拆成纯台词。
const sectionBody =
  "推荐时长：15s\n光线：右侧窗光。\n对白：妈，跟你说了多少次了，弄得满屋子都是灰！ / 我就在这儿做一会儿，马上收拾。\n声音：竹篾刮削声。";
const texts = parseSectionDialogueTexts(sectionBody);
assert.deepEqual(
  texts,
  ["妈，跟你说了多少次了，弄得满屋子都是灰！", "我就在这儿做一会儿，马上收拾。"],
  `对白行应拆成纯台词, 实际 ${JSON.stringify(texts)}`,
);

// 设计字段行(光线/声音)不得被 parseSectionDialogueTexts 当成对白。
assert.ok(!/窗光|竹篾刮削/.test(JSON.stringify(texts)), "设计字段不得进入对白");

// 端到端:模型无归属对白 → 从全剧本 map 补出正确 speaker。
const shotDlg = dialoguesForShotWithSpeakers("设计块无台词", sectionBody, speakerMap, "zh");
assert.ok(shotDlg.length === 2, `应得 2 条对白, 实际 ${shotDlg.length}`);
assert.equal(shotDlg[0].speaker, "沈一航", `第1句应归属沈一航, 实际 ${JSON.stringify(shotDlg[0])}`);
assert.equal(shotDlg[1].speaker, "周桂兰", `第2句应归属周桂兰, 实际 ${JSON.stringify(shotDlg[1])}`);

// 纯设计块 section(无对白行)→ 空对白,不误提设计字段。
const designSection = "推荐时长：15s\n光线：窗光。\n调色：藏青主色。\n构图：中景。";
const emptyDlg = dialoguesForShotWithSpeakers("", designSection, speakerMap, "zh");
assert.ok(
  !emptyDlg.some((d) => typeof d === "object" && /光线|调色|构图|推荐时长/.test(d.speaker || "")),
  `纯设计 section 不得产出设计字段说话人, 实际 ${JSON.stringify(emptyDlg)}`,
);

console.log("dialogue speaker extraction tests passed");
