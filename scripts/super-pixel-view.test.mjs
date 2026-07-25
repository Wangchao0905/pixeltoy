import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

// 入口按钮已激活（不再是 disabled 占位）
const entry = html.match(/<button[^>]*data-explore-tool="super-pixel"[^>]*>/);
assert.ok(entry, "Super Pixel 入口必须带 data-explore-tool");
assert.doesNotMatch(entry[0], /disabled/, "入口按钮不得再是 disabled");
assert.doesNotMatch(html, /data-explore-placeholder="super-pixel"/, "占位标记应已移除");
assert.doesNotMatch(html, /Coming soon: conversational model/, "Coming soon 文案应已移除");

// 视图容器与结构
assert.match(html, /id="superPixelView"[^>]*class="super-pixel-view hidden"/, "视图容器必须存在且默认隐藏");
assert.match(html, /id="superPixelInput"/, "输入框必须存在");
assert.match(html, /id="superPixelModel"/, "模型选择器必须存在");
assert.match(html, /id="superPixelMode"/, "模式选择器必须存在");
assert.match(html, /id="superPixelSend"/, "提交按钮必须存在");

// 模型/模式选项即后续双供应商与工具开关的入口
assert.match(html, /value="claude-opus-4-8"/, "必须有 Claude 选项");
assert.match(html, /value="gpt-5\.2"/, "必须有 GPT 选项");
assert.match(html, /value="ask"/, "必须有 Ask 模式");
assert.match(html, /value="agent"/, "必须有 Agent 模式");

// 卡片占位：4 张，后期填充资产图
const cards = html.match(/class="super-pixel-card is-empty"/g) || [];
assert.equal(cards.length, 4, "资产图占位卡必须是 4 张");

// 可访问性
assert.match(html, /id="superPixelInput"[\s\S]{0,220}aria-label="剧集创作输入"/, "输入框需有 aria-label");
assert.match(html, /id="superPixelSend"[^>]*aria-label="发送"/, "提交按钮需有 aria-label");
assert.match(html, /<select id="superPixelModel" aria-label="模型">/, "模型选择器需有 aria-label");
assert.match(html, /<select id="superPixelMode" aria-label="模式">/, "模式选择器需有 aria-label");
const chips = html.match(/<button class="super-pixel-chip" type="button"/g) || [];
assert.equal(chips.length, 4, "场景 chips 必须是 4 个可聚焦 button");

// JS 接线
assert.match(app, /\["image", "library", "superpixel"\]/, "setExploreView 必须接受 superpixel");
assert.match(app, /#superPixelView"\)\?\.classList\.toggle\("hidden"/, "必须切换视图容器可见性");
assert.match(app, /dataset\.exploreTool === "super-pixel"/, "导航高亮必须处理 super-pixel");
assert.match(app, /function showExploreSuperPixel\(\)/, "必须有 showExploreSuperPixel");
assert.match(app, /tool === "super-pixel"/, "openExploreTool 必须分发 super-pixel");
assert.match(app, /function bindSuperPixel\(\)/, "必须有 bindSuperPixel");
assert.match(app, /bindSuperPixel\(\);/, "bindSuperPixel 必须被调用");

// 蜂窝背景必须真的落在 CSS 里（内联 style 会被引号撕断，见 CLAUDE.md 经验）
assert.match(css, /\.super-pixel-hex\s*\{[\s\S]*?url\("data:image\/svg\+xml,/, "蜂窝 data URI 必须写在 CSS 中");
assert.match(css, /\.super-pixel-view\s*\{[\s\S]*?--sp-acc:/, "配色变量必须限定在 .super-pixel-view 作用域");
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?super-pixel/, "必须有 reduced-motion 降级");

// —— 以下四条锁住本轮 Playwright 实测发现并修复的缺陷 ——

// 1) 全站 button{min-height:36px} 会把 31px 圆形发送键撑成椭圆
// 提取到行首 } 为止：规则内注释含 "button{...}"，非贪婪到首个 } 会截断
const sendRule = css.match(/\.super-pixel-send\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(sendRule, /min-height:\s*31px/, "发送按钮需显式 min-height 覆盖全站 button 规则，否则圆变椭圆");
assert.match(sendRule, /box-sizing:\s*border-box/, "发送按钮需 border-box，否则 padding 撑破尺寸");

// 2) 视图高度：用 100% 无效（父级 auto 高度），须与同级视图一致用 calc(100vh - 44px)
const viewRule = css.match(/\.super-pixel-view\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(viewRule, /min-height:\s*calc\(100vh - 44px\)/, "视图高度须用 calc(100vh - 44px)，与 image/library 视图一致");

// 3) 窄屏工具条不得折行，否则发送键被甩到单独一行
const narrow = css.match(/@media \(max-width: 600px\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(narrow, /\.super-pixel-toolbar\s*\{[^}]*flex-wrap:\s*nowrap/, "窄屏工具条须 nowrap");

// 4) 次文字对比度：0.48 实测仅 4.57:1，须 ≥0.65 才达 7:1
const dimAlpha = Number(viewRule.match(/--sp-dim:\s*rgba\([^)]*?,\s*([\d.]+)\)/)?.[1]);
assert.ok(dimAlpha >= 0.65, `--sp-dim 透明度需 ≥0.65 以达 7:1 对比度，当前 ${dimAlpha}`);

// 权限：入口默认隐藏，仅管理员可见；且函数层有二次拦截
assert.match(entry[0], /class="hidden"/, "入口必须默认隐藏，避免鉴权前闪现");
assert.match(app, /superPixelEntry\?\.classList\.toggle\("hidden", data\.user\?\.role !== "admin"\)/, "登录态须按 admin 切换入口可见性");
assert.match(app, /superPixelEntry\?\.classList\.add\("hidden"\)/, "未登录/鉴权失败须隐藏入口");
assert.match(app, /tool === "super-pixel"[\s\S]{0,160}role !== "admin"\) return/, "openExploreTool 须对非管理员二次拦截");

// 缓存戳必须与被改文件同步（不硬编码具体取值，只校验存在且一致）
const cssStamp = html.match(/styles\.css\?v=([A-Za-z0-9._-]+)/)?.[1];
const jsStamp = html.match(/app\.js\?v=([A-Za-z0-9._-]+)/)?.[1];
assert.ok(cssStamp && jsStamp, "缓存戳必须存在");

console.log("super pixel view tests passed");
