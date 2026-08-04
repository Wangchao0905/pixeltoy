import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

// 主流程保留五个互斥视图；Film Studio 是由视觉圣经按钮打开的辅助面板，不占用流程步骤。
const focuses = [...html.matchAll(/data-modern-focus="([a-z]+)"/g)].map((m) => m[1]);
assert.equal(focuses.length, 5, "pipeline 应有 5 个步骤按钮");
assert.equal(new Set(focuses).size, 5, `5 个步骤必须映射到 5 个不同视图，实为 ${focuses.join(",")}`);
assert.deepEqual(focuses, ["assets", "assetimg", "storyboard", "video", "cut"], "五个步骤必须按流程顺序映射到独立视图");
assert.ok(focuses.includes("cut"), "第 05 步必须指向 cut 视图");

// focus 值需被两处消费者接受，否则会静默回落 assets。
assert.match(js, /\["assets", "assetimg", "filmstudio", "storyboard", "video", "cut"\]\.includes/, "renderModernStudio 白名单缺 Film Studio 或 cut");
assert.match(js, /\["assetimg", "filmstudio", "storyboard", "video", "cut"\]\.includes\(focus\)/, "focusModernPane 缺资产图、Film Studio 或故事板分支");
assert.match(js, /nextFocus === "assetimg"[\s\S]{0,60}modernAssetImagePanel/, "focusModernPane 需把 assetimg 指向 #modernAssetImagePanel");
assert.match(js, /nextFocus === "filmstudio"[\s\S]{0,80}modernFilmStudioPanel/, "focusModernPane 需把 Film Studio 指向 #modernFilmStudioPanel");
assert.match(js, /nextFocus === "cut"[\s\S]{0,40}modernCutPanel/, "focusModernPane 需把 cut 指向 #modernCutPanel");

// 成片三件套此前只存在于永不渲染的 legacy <template> 与 display:none 的 bridge 中。
for (const id of ["finalCutStatus", "finalCutPreview", "assembleFinalCutBtn"]) {
  const inBridge = new RegExp(`workflow-data-bridge[\\s\\S]*?id="${id}"`);
  assert.doesNotMatch(html, inBridge, `${id} 不应留在隐藏 bridge 中`);
}
assert.match(html, /id="modernCutPanel"/, "缺少可见的成片面板");
const cutStart = html.indexOf('id="modernCutPanel"');
const cutEnd = html.indexOf('id="workflowDataBridge"', cutStart);
const cutPanel = cutStart >= 0 && cutEnd > cutStart ? html.slice(cutStart, cutEnd) : "";
assert.match(cutPanel, /class="cut-layout"/, "成片面板必须使用双栏工作台布局");
assert.match(cutPanel, /class="cut-preview-card"/, "成片面板必须突出主预览卡");
assert.match(cutPanel, /class="modern-cut-preview final-cut-preview-slot"/, "成片面板必须保留可见预览区域");
for (const id of ["finalCutStatus", "finalCutPreview", "assembleFinalCutBtn"]) {
  assert.ok(cutPanel.includes(`id="${id}"`), `成片面板应包含 ${id}（renderFinalCut 依赖这些 ID）`);
}

const modernStudioRenderer = js.slice(js.indexOf("function renderModernStudio("), js.indexOf("function renderModernAssetGenerationControls("));
assert.match(js, /function finalCutOutputReady\(finalCut\)[\s\S]*?return !!finalCut\?\.output\?\.url && finalCut\?\.output\?\.current !== false;/, "CUT must use the current assembled output instead of object presence");
assert.match(modernStudioRenderer, /const finalCutReady = finalCutOutputReady\(data\.finalCut\);/, "modern pipeline must use the final output readiness helper");
assert.match(modernStudioRenderer, /Boolean\(total && completed === total\),\s*finalCutReady,/, "completed pipeline must include the actual assembled output");
assert.match(modernStudioRenderer, /\$\("#modernCutStep"\)\.textContent = finalCutReady \? "成片已组装"/, "assembled output must turn the cut step green with the ready label");
assert.doesNotMatch(modernStudioRenderer, /Boolean\(data\.finalCut\?\.url\)/, "modern pipeline must not read the obsolete top-level finalCut.url field");

// 入口判据必须是「片段是否齐」。原先写成 finalCutOutputReady() 时条件是反的：
// 只有成片已生成才给出组装入口，首次组装永远拿不到，服务端 ffmpeg 拼接成死代码。
const videoBranch = js.match(/if \(mode === "video"\) \{[\s\S]*?\n  \}/)?.[0] || "";
assert.ok(videoBranch, "找不到 studioPrimaryActionForMode 的 video 分支");
assert.ok(
  /segmentsAllDone[\s\S]*?\?[\s\S]*?assembleFinalCutBtn/.test(videoBranch),
  "组装入口应由 segmentsAllDone 决定，而非 finalCutOutputReady",
);
assert.doesNotMatch(
  videoBranch,
  /return finalCutOutputReady\(data\?\.finalCut\)\s*\n\s*\? \{ label: "Run: 组装成片"/,
  "条件反转已回退：finalCutOutputReady 不能作为是否提供组装的判据",
);

// 视图门控与面板样式。
assert.match(css, /:not\(\[data-modern-view="cut"\]\) \.modern-cut-panel \{ display: none/, "缺少 cut 面板显隐门控");
assert.match(css, /\[data-modern-view="cut"\] \.modern-workbench \{ display: none/, "cut 视图应隐藏 workbench");
// 全站 button{min-height:36px} 会压过 height，必须用 min-height 覆盖。
assert.match(css, /\.modern-cut-foot button \{ min-height: 28px/, "成片按钮需用 min-height 覆盖全站 36px 基线");
// min-height 撑出的富余空间会摊到行间，把图标与文字拉开 77px。
assert.match(css, /\.final-cut-placeholder \{[^}]*align-content: center/, "占位图需 align-content: center");
assert.doesNotMatch(css, /\.final-cut-preview-proxy\s*\{[^}]*display:\s*none\s*!important/, "成片预览不能再由隐藏代理容器承载");

// --mono 曾被引用 12+ 次却从未定义，静默回落 Inter。
assert.match(css, /--mono:\s*ui-monospace/, "--mono 必须有定义");
const monoUses = (css.match(/var\(--mono\)/g) || []).length;
assert.ok(monoUses >= 10, `var(--mono) 用量应 >=10，实为 ${monoUses}`);

console.log("modern final cut tests passed");
