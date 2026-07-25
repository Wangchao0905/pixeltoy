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
assert.match(html, /id="superPixelAssetRail"[^>]*aria-label="资产库"/, "Super Pixel 必须常驻资产侧栏");
assert.match(html, /id="superPixelAssetRailList"/, "资产侧栏必须有独立列表容器");

// 模型选项：Claude 与 ChatGPT 各三档，分组呈现。
// 这些 ID 已在 api.apikey.fun 网关实调通过（2026-07-25），阶段 2 直接用于请求。
const MODEL_IDS = [
  "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5",
  "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna",
];
const selectBlock = html.match(/<select id="superPixelModel"[\s\S]*?<\/select>/)?.[0] || "";
for (const id of MODEL_IDS) {
  assert.ok(selectBlock.includes(`value="${id}"`), `模型选择器缺少 ${id}`);
}
const optionCount = (selectBlock.match(/<option /g) || []).length;
assert.equal(optionCount, 6, `模型选项须为 6 个（Claude 3 + ChatGPT 3），当前 ${optionCount}`);
assert.match(selectBlock, /<optgroup label="Claude">/, "Claude 需独立分组");
assert.match(selectBlock, /<optgroup label="ChatGPT">/, "ChatGPT 需独立分组");
// 旧的两个选项不得残留
assert.doesNotMatch(selectBlock, /value="gpt-5\.2"|value="claude-opus-4-8"/, "旧模型选项应已移除");
// state 默认值必须是选择器里真实存在的 ID
const stateDefault = app.match(/superPixel: \{ model: "([^"]+)"/)?.[1];
assert.ok(MODEL_IDS.includes(stateDefault), `state 默认模型 ${stateDefault} 不在选项内`);
assert.ok(selectBlock.indexOf(`value="${stateDefault}"`) === selectBlock.indexOf('value="'), "state 默认模型须与选择器首项一致");

assert.match(html, /value="ask"/, "必须有 Ask 模式");
assert.match(html, /value="agent"/, "必须有 Agent 模式");

// 卡片占位栏已移除：资产改由左侧常驻侧栏承载，底部空卡只占高度不给信息
assert.ok(!/super-pixel-gallery|super-pixel-cards|super-pixel-card is-empty/.test(html), "资产占位卡片栏必须已移除");
assert.ok(!/super-pixel-gallery|\.super-pixel-cards/.test(css), "卡片栏样式必须一并删除，别留死代码");

// 开聊后 composer 贴底：dock 容器 + is-chatting 态
assert.match(html, /id="superPixelDock"/, "composer 必须包在 dock 容器里才能贴底");
assert.match(app, /classList\.toggle\("is-chatting", chatting\)/, "有消息时必须切到对话态");
assert.match(css, /\.super-pixel-stage\.is-chatting\s*\{/, "必须有对话态布局");
assert.match(css, /\.super-pixel-stage\.is-chatting[\s\S]{0,400}?\.super-pixel-title,?[\s\S]{0,120}?display:\s*none/, "对话态必须收掉首屏引导物");

// 聊天字体：衬线，且消息与输入框同源（输入时所见即发出后所得）
assert.match(css, /--sp-chat-font:[^;]*serif/, "聊天字体栈必须以 serif 收尾");
assert.match(css, /\.super-pixel-message\s*\{[\s\S]*?font-family:\s*var\(--sp-chat-font\)/, "消息气泡必须用聊天字体");
assert.match(css, /\.super-pixel-input\s*\{[\s\S]*?font-family:\s*var\(--sp-chat-font\)/, "输入框必须与气泡同字体");

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
assert.match(app, /function renderSuperPixelAssetRail\(\)/, "必须渲染 Super Pixel 资产侧栏");
assert.match(app, /bindManualAssetControls\(rail/, "侧栏卡片必须复用现有资产拖拽绑定");
assert.match(app, /data-manifest-asset-id=/, "侧栏资产卡片必须复用现有资产拖拽协议");
assert.match(app, /application\/x-pixel-toys-asset-type/, "composer 必须识别现有资产拖拽 MIME");
assert.match(app, /state\.assetLibrary\.assets\.find\(\(asset\) => asset\.id === assetId\)/, "drop 后必须按 assetId 反查素材库图片");
assert.match(app, /renderSuperPixelAssetRail\(\);/, "资产库更新后必须刷新侧栏");
assert.match(app, /state\.exploreView === "superpixel"/, "进入 Super Pixel 时必须加载资产库");

// 蜂窝背景必须真的落在 CSS 里（内联 style 会被引号撕断，见 CLAUDE.md 经验）
assert.match(css, /\.super-pixel-hex\s*\{[\s\S]*?url\("data:image\/svg\+xml,/, "蜂窝 data URI 必须写在 CSS 中");
assert.match(css, /\.super-pixel-view\s*\{[\s\S]*?--sp-acc:/, "配色变量必须限定在 .super-pixel-view 作用域");
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?super-pixel/, "必须有 reduced-motion 降级");
assert.match(css, /\.super-pixel-asset-rail\s*\{/, "必须有资产侧栏样式");
assert.match(css, /\.super-pixel-asset-card\s*\{/, "必须有可拖拽资产卡片样式");

// —— 以下四条锁住本轮 Playwright 实测发现并修复的缺陷 ——

// 1) 全站 button{min-height:36px} 会把 31px 圆形发送键撑成椭圆
// 提取到行首 } 为止：规则内注释含 "button{...}"，非贪婪到首个 } 会截断
const sendRule = css.match(/\.super-pixel-send\s*\{[\s\S]*?\n\}/)?.[0] || "";
// 不锁死具体像素（尺寸会随视觉调整变化），锁「min-height 必须等于 height」这个关系：
// 全站 button{min-height:36px} 会压过 height，二者不一致就会被撑成椭圆。
// 先去掉注释——注释里提到的 button{min-height:36px} 会被误当成声明匹配到
const sendDecls = sendRule.replace(/\/\*[\s\S]*?\*\//g, "");
const sendH = sendDecls.match(/(?<!min-)height:\s*(\d+)px/)?.[1];
const sendMinH = sendDecls.match(/min-height:\s*(\d+)px/)?.[1];
assert.ok(sendH && sendMinH, "发送按钮须同时声明 height 与 min-height");
assert.equal(sendMinH, sendH, `min-height(${sendMinH}) 须等于 height(${sendH})，否则全站 button 规则会把圆撑成椭圆`);
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
assert.equal(cssStamp, jsStamp, "styles.css 与 app.js 缓存戳必须同步");

console.log("super pixel view tests passed");
