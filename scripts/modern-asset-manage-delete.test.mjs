import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.match(html, /id="modernKitButton"/, "资产解析界面必须保留管理与修改入口");
assert.match(app, /modernKitButton[\s\S]*assetManageMode\s*=\s*!state\.modernStudio\.assetManageMode/, "管理入口必须切换资产管理态");
assert.match(app, /assetManageMode/, "资产管理态必须存放在现代制作台状态中");
assert.match(
  app,
  /data-modern-remove-asset/,
  "管理态的每个解析资产必须渲染独立删除按钮",
);
assert.match(
  app,
  /async function deleteModernParsedAsset\(/,
  "解析资产删除必须通过独立动作持久化",
);
assert.match(
  app,
  /body:\s*JSON\.stringify\(\{\s*manifest,\s*confirm:\s*false\s*\}\)/,
  "删除解析资产必须保存更新后的资产清单而不是只改前端",
);
assert.match(styles, /\.modern-asset-chip-remove\s*\{/);
assert.match(styles, /\.modern-asset-chip\.is-manage-mode/);
assert.match(
  styles,
  /\.modern-asset-chip\.is-manage-mode\s*\{[^}]*position:\s*relative[^}]*padding-right:\s*36px/,
  "管理态资产标签必须给右上角删除控件预留空间",
);
assert.match(
  styles,
  /\.modern-asset-chip-remove\s*\{[^}]*position:\s*absolute[^}]*top:\s*6px[^}]*right:\s*6px[^}]*border-radius:\s*6px/,
  "删除控件应为右上角的小型方形操作，不应继续使用椭圆胶囊",
);
assert.doesNotMatch(
  styles,
  /\.modern-asset-chip-remove\s*\{[^}]*border-radius:\s*50%/,
  "删除控件不得恢复为圆形胶囊",
);
assert.match(
  app,
  /const readyToConfirm = !extracting && !confirmed && items\.length > 0;[\s\S]*?classList\.toggle\("is-ready-to-confirm", readyToConfirm\)/,
  "解析完成且未确认时，确认按钮必须进入提醒状态",
);
assert.match(
  styles,
  /\.modern-asset-primary-actions button\.is-ready-to-parse\s*,[\s\S]*?button\.is-ready-to-confirm\s*\{[\s\S]*?animation:\s*modernAssetActionAttention/,
  "确认按钮提醒状态必须使用呼吸动效",
);
assert.match(app, /function renderModernAssetExtractAction\([\s\S]*?workflowEditorValue\("assetDescription"\)[\s\S]*?classList\.toggle\("is-ready-to-parse", readyToParse\)/);
assert.match(app, /modernAssetDescriptionText[\s\S]*?renderModernAssetExtractAction\(\)/);
assert.match(styles, /\.modern-asset-primary-actions button\.is-ready-to-parse/);
assert.match(styles, /@keyframes modernAssetActionAttention\s*\{/);
assert.match(styles, /prefers-reduced-motion:\s*reduce/);

console.log("modern asset manage delete tests passed");
