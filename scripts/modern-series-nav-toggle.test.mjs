import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

const nav = html.match(/<aside class="modern-series-nav"[\s\S]*?<\/aside>/)?.[0] || "";
assert.match(nav, /id="modernSeriesNavToggle"[^>]*type="button"/, "制作台主导航必须有独立的折叠按钮");
assert.match(nav, /aria-controls="modernProjectSwitcher modernEpisodeList modernSeriesFooter"/, "折叠按钮必须声明受控的主导航区域");
assert.match(nav, /data-nav-toggle-icon/, "折叠按钮必须有可更新的箭头图标");
assert.match(html, /<footer id="modernSeriesFooter" class="modern-series-footer"/, "进度底栏需要稳定 ID 供折叠状态管理");

assert.match(app, /MODERN_SERIES_NAV_COLLAPSED_KEY\s*=\s*"pixelToys\.modernSeriesNavCollapsed"/, "折叠状态必须有独立的持久化 key");
assert.match(app, /navCollapsed:\s*localStorage\.getItem\(MODERN_SERIES_NAV_COLLAPSED_KEY\)\s*===\s*"1"/, "刷新后必须恢复主导航折叠状态");
assert.match(app, /function syncModernSeriesNav\([\s\S]*?studioModernShell[\s\S]*?aria-expanded/, "主导航必须同步视觉和无障碍状态");
assert.match(app, /modernSeriesNavToggle[\s\S]*?localStorage\.setItem\(MODERN_SERIES_NAV_COLLAPSED_KEY/, "点击折叠按钮必须保存状态");
assert.match(app, /renderModernStudio\([\s\S]{0,260}syncModernSeriesNav\(\)/, "主导航状态必须在制作台渲染时同步");

assert.match(css, /body\.is-studio-modern \.studio-modern-shell\.is-nav-collapsed\s*\{[^}]*grid-template-columns:\s*56px\s+minmax\(0,\s*1fr\)/, "折叠状态必须将左栏收缩到 56px 并释放主区");
assert.match(css, /body\.is-studio-modern \.studio-modern-shell\s*\{[^}]*grid-template-columns:\s*224px\s+minmax\(0,\s*1fr\)/, "展开状态必须保留 224px 主导航宽度");
assert.match(css, /\.studio-modern-shell\.is-nav-collapsed \.modern-project-switcher[\s\S]*\.modern-episode-list[\s\S]*\.modern-series-footer/, "折叠状态必须隐藏项目、分集和进度信息");
assert.match(css, /\.modern-series-nav-toggle\s*\{[^}]*position:\s*absolute[^}]*min-width:\s*28px[^}]*min-height:\s*40px/, "箭头按钮必须固定在主导航边缘且保留可点击尺寸");
assert.match(css, /\.modern-series-nav-toggle[^}]*transition:[^}]*transform/, "折叠按钮必须有轻量状态动效");
assert.match(css, /body\.is-studio-modern \.studio-modern-shell\.is-nav-collapsed \.modern-brand\s*\{[^}]*height:\s*54px[^}]*box-sizing:\s*border-box/, "折叠后的品牌栏必须与右侧顶部栏保持同高并对齐边线");
assert.match(css, /body\.is-studio-modern \.studio-modern-shell\.is-nav-collapsed \.modern-brand-logo\s*\{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*pixel-toys-logo-agent\.gif/, "折叠后必须显示完整的方形动画 logo，而不是裁切横向字标");
assert.match(css, /body\.is-studio-modern \.studio-modern-shell\.is-nav-collapsed \.modern-brand-logo::before,\s*body\.is-studio-modern \.studio-modern-shell\.is-nav-collapsed \.modern-brand-logo::after\s*\{[^}]*display:\s*none/, "折叠后的方形 logo 不得叠加横向字标的旋转伪元素");
assert.match(css, /@media \(max-width:\s*980px\)[\s\S]*?\.modern-series-nav-toggle\s*\{[^}]*display:\s*none/, "窄屏应回到横向导航而不是保留 56px 窄轨");
assert.match(css, /@media \(max-width:\s*980px\)[\s\S]*?is-nav-collapsed \.modern-episode-list\s*\{[^}]*display:\s*flex/, "窄屏折叠状态仍必须保留横向分集导航");

console.log("modern series nav toggle tests passed");
