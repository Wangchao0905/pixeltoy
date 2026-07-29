// 对白语言选择控件。制作台改版后旧控件留在隐藏的 legacy 布局里够不着,
// 默认 en 一直生效,中文剧本被强制翻成英文且无法调整。这些断言锁住新控件
// 的存在、接线和选中态样式,避免再次被改版漏掉。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

// 控件必须在剧本模块头部(而不是隐藏的 legacy 布局)里。
const head = index.match(/<header class="modern-source-head">[\s\S]*?<\/header>/);
assert.ok(head, "找不到 .modern-source-head");
assert.match(head[0], /id="modernDialogueLanguage"/);
assert.match(head[0], /role="radiogroup"/);
assert.match(head[0], /data-dialogue-language="zh"[^>]*>中文对白/);
assert.match(head[0], /data-dialogue-language="en"[^>]*>英文对白/);
// 原有的 01 / 02 编号要保留,并和按钮同在右侧容器里。
assert.match(head[0], /modern-source-head-aside[\s\S]*modern-source-order/);

// 点击要走既有的 changeDialogueLanguage,不另开接口。
assert.match(app, /\$\("#modernDialogueLanguage"\)\?\.addEventListener\("click"/);
assert.match(app, /closest\("\[data-dialogue-language\]"\)/);
assert.match(app, /changeDialogueLanguage\(next\)/);
// 同值点击不应触发重新翻译。
assert.match(app, /if \(next === state\.dialogueLanguage\) return;/);
// 无项目时禁用,避免空请求。
assert.match(app, /function renderModernDialogueLanguage\(\)/);
assert.match(app, /const disabled = !state\.selectedId;/);
assert.match(app, /button\.disabled = disabled;/);
// 必须接进 renderWorkspace 的回填链路,否则切项目后选中态不跟着变。
assert.match(app, /if \(dialogueInput\) dialogueInput\.checked = true;\s*\n\s*renderModernDialogueLanguage\(\);/);

// 选中态要有可见差异(背景+边框+文字),否则点了没反应。
assert.match(styles, /\.modern-lang-tabs button\[aria-checked="true"\][^}]*background: var\(--mv-s3\)/);
assert.match(styles, /\.modern-lang-tabs button\[aria-checked="true"\][^}]*border-color: var\(--mv-line-2\)/);
assert.match(styles, /\.modern-lang-tabs button\[aria-checked="true"\][^}]*color: var\(--mv-tx\)/);
// 父容器特异度要压过 .modern-source-head > div { display: grid },否则布局靠巧合。
assert.match(styles, /\.modern-source-head > \.modern-source-head-aside \{[^}]*display: flex/);

// 资源版本号必须随前端改动前进,否则浏览器拿缓存看不到新控件。
const cssVer = index.match(/styles\.css\?v=([^"]+)/)?.[1];
const appVer = index.match(/app\.js\?v=([^"]+)/)?.[1];
assert.equal(cssVer, appVer, "styles.css 与 app.js 的版本号应一致");
assert.notEqual(cssVer, "navigation-performance-20260728", "改了前端就要推版本号");

console.log("dialogue-language-tabs: OK");
