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

console.log("modern asset manage delete tests passed");
