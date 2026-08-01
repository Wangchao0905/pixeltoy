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
assert.match(html, /id="superPixelInput"[\s\S]*?placeholder="说出你的想法。"/, "Super Pixel 输入框提示文字必须简洁为说出你的想法");
assert.match(html, /id="superPixelModel"/, "模型选择器必须存在");
assert.match(html, /id="superPixelMode"/, "模式选择器必须存在");
assert.match(html, /id="superPixelSend"/, "提交按钮必须存在");
assert.match(html, /<div class="super-pixel-layout">\s*<button id="superPixelAssetRailToggle"[^>]*type="button"[^>]*aria-controls="superPixelAssetRail"[^>]*aria-expanded="false"[^>]*aria-label="素材库"[^>]*title="素材库"/, "Super Pixel 必须提供默认收起的资产抽屉开关");
assert.match(html, /id="superPixelAssetRailToggle"[\s\S]{0,320}<span class="super-pixel-asset-icon" aria-hidden="true">[\s\S]*?<svg[^>]*>[\s\S]*?<\/svg>[\s\S]*?<\/span>/, "资产抽屉开关必须有清晰的素材库图标");
assert.match(html, /id="superPixelAssetRail"[^>]*aria-label="资产库"/, "Super Pixel 资产侧栏必须保留为可收起抽屉");
assert.match(html, /id="superPixelAssetRailClose"[^>]*type="button"[^>]*aria-label="收起素材库"/, "资产抽屉必须提供关闭按钮");
assert.match(html, /id="superPixelAssetRailList"/, "资产侧栏必须有独立列表容器");

// 模型选项：Claude 两档、ChatGPT 三档与 Grok，分组呈现。
// 这些 ID 已在 api.apikey.fun 网关实调通过（2026-07-25），阶段 2 直接用于请求。
const MODEL_IDS = [
  "claude-opus-5", "claude-haiku-4-5",
  "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna",
  "grok-4.5",
];
const selectBlock = html.match(/<select id="superPixelModel"[\s\S]*?<\/select>/)?.[0] || "";
for (const id of MODEL_IDS) {
  assert.ok(selectBlock.includes(`value="${id}"`), `模型选择器缺少 ${id}`);
}
const optionCount = (selectBlock.match(/<option /g) || []).length;
assert.equal(optionCount, 6, `模型选项须为 6 个（Claude 2 + ChatGPT 3 + Grok 1），当前 ${optionCount}`);
assert.match(selectBlock, /<optgroup label="Claude">/, "Claude 需独立分组");
assert.match(selectBlock, /<optgroup label="ChatGPT">/, "ChatGPT 需独立分组");
assert.match(selectBlock, /<optgroup label="Grok">/, "Grok 需独立分组");
// 旧的两个选项不得残留
assert.doesNotMatch(selectBlock, /value="gpt-5\.2"|value="claude-opus-4-8"/, "旧模型选项应已移除");
assert.doesNotMatch(selectBlock, /value="claude-sonnet-5"/, "网关不支持 claude-sonnet-5");
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

// 聊天字体：几何黑体，且消息与输入框同源（输入时所见即发出后所得）。
// 注意断言别写成 /serif/——"sans-serif" 含该子串，会把黑体栈也判过（曾假绿）。
assert.match(css, /--sp-chat-font:[^;]*sans-serif\s*;/, "聊天字体栈必须以 sans-serif 收尾");
assert.match(css, /--sp-chat-font:[^;]*"PingFang SC"/, "中文必须落 PingFang SC");
assert.doesNotMatch(css, /--sp-chat-font:[^;]*"Songti SC"/, "聊天字体不应再回落宋体衬线");
assert.match(css, /\.super-pixel-message\s*\{[\s\S]*?font-family:\s*var\(--sp-chat-font\)/, "消息气泡必须用聊天字体");
assert.match(css, /\.super-pixel-input\s*\{[\s\S]*?font-family:\s*var\(--sp-chat-font\)/, "输入框必须与气泡同字体");
assert.match(css, /\.super-pixel-input::placeholder\s*\{[\s\S]*?rgba\(252,\s*239,\s*240,\s*0\.48\)/, "输入框提示文字必须使用半透明颜色");
assert.match(css, /\.super-pixel-input:focus(?:::placeholder|,)[\s\S]*?color:\s*transparent/, "输入框获得焦点后必须隐藏提示文字");

// 可访问性
assert.match(html, /id="superPixelInput"[\s\S]{0,220}aria-label="剧集创作输入"/, "输入框需有 aria-label");
assert.match(html, /id="superPixelSend"[^>]*aria-label="发送"/, "提交按钮需有 aria-label");
assert.match(html, /<select id="superPixelModel" aria-label="模型">/, "模型选择器需有 aria-label");
assert.match(html, /<select id="superPixelMode" aria-label="模式">/, "模式选择器需有 aria-label");
const chips = html.match(/<button class="super-pixel-chip" type="button"/g) || [];
assert.equal(chips.length, 0, "Super Pixel 不应再显示快捷场景按钮");
assert.doesNotMatch(html, /super-pixel-chips|data-super-pixel-chip/, "快捷场景结构必须移除");

// JS 接线
assert.match(app, /EXPLORE_VIEW_VALUES = Object\.freeze\(\["canvas", "image", "library", "superpixel"\]\)/, "setExploreView 必须接受 superpixel");
assert.match(app, /#superPixelView"\)\?\.classList\.toggle\("hidden"/, "必须切换视图容器可见性");
assert.match(app, /#exploreHome"\)\?\.classList\.toggle\("is-superpixel", state\.exploreView === "superpixel"\)/, "进入 Super Pixel 时必须给 Explore 外壳加主题状态类");
assert.match(app, /dataset\.exploreTool === "super-pixel"/, "导航高亮必须处理 super-pixel");
assert.match(app, /function showExploreSuperPixel\(\)/, "必须有 showExploreSuperPixel");
assert.match(app, /tool === "super-pixel"/, "openExploreTool 必须分发 super-pixel");
assert.match(app, /function bindSuperPixel\(\)/, "必须有 bindSuperPixel");
assert.match(app, /bindSuperPixel\(\);/, "bindSuperPixel 必须被调用");
assert.match(app, /function renderSuperPixelAssetRail\(\)/, "必须渲染 Super Pixel 资产侧栏");
assert.match(app, /function enhanceSuperPixelSelects\(\)/, "模型和模式下拉必须使用统一的自定义菜单");
assert.match(app, /enhanceSuperPixelSelects\(\);/, "Super Pixel 初始化时必须增强下拉菜单");
assert.match(app, /bindManualAssetControls\(rail/, "侧栏卡片必须复用现有资产拖拽绑定");
assert.match(app, /data-manifest-asset-id=/, "侧栏资产卡片必须复用现有资产拖拽协议");
assert.match(app, /application\/x-pixel-toys-asset-type/, "composer 必须识别现有资产拖拽 MIME");
assert.match(app, /state\.assetLibrary\.assets\.find\(\(asset\) => asset\.id === assetId\)/, "drop 后必须按 assetId 反查素材库图片");
assert.match(app, /renderSuperPixelAssetRail\(\);/, "资产库更新后必须刷新侧栏");
assert.doesNotMatch(app, /data-super-pixel-chip/, "快捷场景按钮的事件绑定必须一并移除");
// dropEffect 必须跟源端 effectAllowed 匹配：资产卡片声明 "move"，写死 "copy" 会让
// 浏览器回落 none、drop 不触发（真机拖拽弹回原位，合成事件测不出来）。
assert.match(
  app,
  /dropEffect\s*=\s*isAssetDrag\(event\)\s*\?\s*"move"\s*:\s*"copy"/,
  "composer 的 dropEffect 必须按拖拽类型分派，资产拖拽用 move 以匹配卡片的 effectAllowed",
);
assert.match(app, /effectAllowed = "move"/, "资产卡片 dragstart 必须声明 move");
assert.match(app, /state\.exploreView === "superpixel"/, "进入 Super Pixel 时必须加载资产库");
assert.match(app, /superPixelAssetRailToggle/, "必须接入资产抽屉开关");
assert.match(app, /superPixelAssetRailClose/, "必须接入资产抽屉关闭按钮");
assert.match(app, /SUPER_PIXEL_RAIL_OPEN_KEY\s*=\s*"pixelToys\.superPixelRailOpen"/, "资产抽屉状态必须使用指定的 localStorage key");
assert.match(app, /localStorage\.setItem\(SUPER_PIXEL_RAIL_OPEN_KEY/, "资产抽屉开关必须持久化状态");

// 蜂窝背景必须真的落在 CSS 里（内联 style 会被引号撕断，见 CLAUDE.md 经验）
assert.match(css, /\.super-pixel-hex\s*\{[\s\S]*?url\("data:image\/svg\+xml,/, "蜂窝 data URI 必须写在 CSS 中");
assert.match(css, /\.super-pixel-view\s*\{[\s\S]*?--sp-acc:/, "配色变量必须限定在 .super-pixel-view 作用域");
assert.match(css, /\.explore-home\.is-superpixel[\s\S]*?data-explore-tool="super-pixel"[\s\S]*?color:\s*#d92d45\s*!important/, "Super Pixel 顶栏入口与 Admin 必须使用暗红强调色");
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?super-pixel/, "必须有 reduced-motion 降级");
assert.match(css, /\.super-pixel-asset-rail\s*\{/, "必须有资产侧栏样式");
assert.match(css, /\.super-pixel-asset-card\s*\{/, "必须有可拖拽资产卡片样式");
assert.doesNotMatch(css, /\.super-pixel-chips|\.super-pixel-chip/, "快捷场景按钮样式必须一并移除");
assert.match(css, /\.super-pixel-asset-icon[\s\S]*?width:\s*17px[\s\S]*?height:\s*17px/, "素材库图标必须有稳定尺寸");
assert.match(css, /\.super-pixel-select-menu\s*\{[\s\S]*?background:\s*rgba\(20,\s*7,\s*11,\s*0\.96\)/, "下拉菜单背景必须与对话框使用同一暗红色系");
assert.match(css, /\.super-pixel-select-option\.is-selected[\s\S]*?background:\s*rgba\(217,\s*45,\s*69,\s*0\.28\)/, "下拉选中态必须使用 Super Pixel 暗红强调色");
assert.match(css, /\.super-pixel-layout\s*\{[\s\S]*?grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)/, "资产抽屉默认必须收起为零宽度");
assert.match(css, /\.super-pixel-layout\.is-rail-open\s*\{[\s\S]*?grid-template-columns:\s*minmax\(210px,\s*252px\)\s+minmax\(0,\s*1fr\)/, "打开资产抽屉必须把聊天内容向右推开");

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
assert.match(viewRule, /height:\s*calc\(100vh - 44px\)/, "对话视图必须固定可用高度，避免消息把输入框向下撑走");
assert.match(viewRule, /min-height:\s*calc\(100vh - 44px\)/, "视图高度须用 calc(100vh - 44px)，与 image/library 视图一致");
assert.match(css, /\.super-pixel-layout\s*\{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*0/, "Super Pixel 布局容器必须允许 flex/grid 子项收缩");
assert.match(css, /\.super-pixel-stage\s*\{[\s\S]*?height:\s*100%[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*hidden/, "对话 stage 必须固定高度并裁住外层溢出");
assert.match(css, /\.super-pixel-stage\.is-chatting\s+\.super-pixel-messages\s*\{[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/, "对话消息必须是唯一可滚动区域");
assert.match(css, /\.super-pixel-stage\.is-chatting\s+\.super-pixel-messages\s*\{[\s\S]*?height:\s*0[\s\S]*?overflow-x:\s*hidden/, "对话消息区域必须占据剩余高度并允许内部滚动");
assert.match(css, /\.super-pixel-image-card \.super-pixel-tool-card-details\s*\{[\s\S]*?display:\s*none/, "图片工具卡不应显示提示词和模型规格");
assert.match(css, /\.super-pixel-image-card \.super-pixel-tool-card-media\s*\{[\s\S]*?max-height:\s*min\(36vh,\s*300px\)/, "图片工具卡预览高度必须受控");
assert.match(app, /const previousScrollTop = container\.scrollTop[\s\S]*?shouldStickToBottom/, "用户上翻消息时不能被重新渲染强制拉到底部");
assert.match(app, /const SUPER_PIXEL_HISTORY_KEY = "pixelToys\.superPixelHistory\.v1"/, "Super Pixel 历史必须使用独立持久化键");
assert.match(app, /function restoreSuperPixelHistory\(\)[\s\S]*?readSuperPixelHistory[\s\S]*?state\.superPixel\.messages/, "刷新后必须恢复 Super Pixel 历史消息");
assert.match(app, /function persistSuperPixelHistory\([\s\S]*?localStorage\.setItem/, "Super Pixel 消息必须持久化到本地");
assert.match(app, /window\.addEventListener\("pagehide", \(\) => persistSuperPixelHistory\(\{ immediate: true \}\)\)/, "离开页面前必须立即保存 Super Pixel 历史");

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
assert.match(app, /data\.user\?\.role !== "admin" && state\.exploreView === "superpixel"\) showExploreCanvasHome\(\)/, "直接访问 Super Pixel 路由时仍须遵守管理员权限");

// 缓存戳必须与被改文件同步（不硬编码具体取值，只校验存在且一致）
const cssStamp = html.match(/styles\.css\?v=([A-Za-z0-9._-]+)/)?.[1];
const jsStamp = html.match(/app\.js\?v=([A-Za-z0-9._-]+)/)?.[1];
assert.ok(cssStamp && jsStamp, "缓存戳必须存在");
assert.equal(cssStamp, jsStamp, "styles.css 与 app.js 缓存戳必须同步");

const superPixelRedesign = css.slice(css.indexOf("/* Super Pixel redesign:"));
assert.match(superPixelRedesign, /--sp-chat-font:\s*"Google Sans", "Google Sans Text", "SF Pro Display"/, "Super Pixel 正文应使用与参考一致的圆润无衬线字体栈");
assert.match(superPixelRedesign, /\.super-pixel-message\.is-user\s*\{[^}]*border:\s*0/, "对话消息不应使用卡片边框");
assert.match(superPixelRedesign, /\.super-pixel-tool-card\s*\{[^}]*border:\s*0/, "生成结果在对话流中不应使用外框");
assert.match(superPixelRedesign, /\.super-pixel-video-media:hover \.super-pixel-tool-card-download,[\s\S]*?\.super-pixel-video-media:focus-within \.super-pixel-tool-card-download/, "视频下载按钮应在悬停或键盘聚焦时显示");
assert.match(superPixelRedesign, /\.super-pixel-messages\s*,\s*\.super-pixel-asset-rail-list\s*\{[\s\S]*?scrollbar-width:\s*none[\s\S]*?-ms-overflow-style:\s*none/, "消息区和素材栏必须隐藏原生滚动条但保留滚动能力");
assert.match(superPixelRedesign, /\.super-pixel-messages::-webkit-scrollbar\s*,\s*\.super-pixel-asset-rail-list::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none[\s\S]*?width:\s*0[\s\S]*?height:\s*0/, "WebKit 浏览器必须隐藏消息区和素材栏的滚动条滑块");
assert.match(superPixelRedesign, /body\.is-explore-ui \.super-pixel-view\s*\{[\s\S]*?height:\s*auto[\s\S]*?min-height:\s*calc\(100vh - 44px\)[\s\S]*?overflow-y:\s*visible/, "Super Pixel 外层必须回到文档流，让页面接管纵向滚动");
assert.match(superPixelRedesign, /body\.is-explore-ui \.super-pixel-stage\.is-chatting \.super-pixel-messages\s*\{[\s\S]*?height:\s*auto[\s\S]*?max-height:\s*none[\s\S]*?overflow:\s*visible/, "对话消息不能再成为唯一滚动容器，页面滚轮应能浏览完整内容");
assert.match(superPixelRedesign, /body\.is-explore-ui \.super-pixel-stage\.is-chatting \.super-pixel-dock\s*\{[\s\S]*?position:\s*sticky[\s\S]*?bottom:\s*0/, "对话输入区在页面滚动时必须保持在底部");

console.log("super pixel view tests passed");
