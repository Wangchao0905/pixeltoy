import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = fs.readFileSync(path.join(root, "scriptwriter-agent/ui/index.html"), "utf8");

assert.match(ui, /\.app\{height:100dvh;/, "工作台外壳应锁定在可视窗口内");
assert.match(ui, /\.workspace\{[\s\S]*overflow:auto/, "中央工作区应独立滚动");
assert.match(ui, /\.rail\s*,\s*\.agent\{[\s\S]*overflow:auto/, "两侧栏应独立滚动");
assert.match(ui, /id="workspace-tabs"/, "聚焦工作区应提供内容视图切换");
assert.match(ui, /data-view="script"/, "工作区应有默认剧本视图");
assert.match(ui, /id="toggle-context"/, "用户应可收起右侧上下文面板");
assert.match(ui, /id="command-trigger"/, "顶栏应提供命令面板入口");
assert.match(ui, /id="command-palette"/, "页面应实现键盘可达的命令面板");
assert.match(ui, /@media \(prefers-reduced-motion:reduce\)/, "动效应尊重减少动态效果偏好");
assert.match(ui, /\.ep-chips\{display:flex;[\s\S]*flex-wrap:wrap/, "集数标签应以可换行的独立胶囊呈现");
assert.match(ui, /\.ep-chip\{display:inline-flex;[\s\S]*justify-content:center/, "每个集数标签应有独立的可读触达区域");
assert.match(ui, /<details class="composer" id="composer-panel" open>/, "故事种子应支持收起");
assert.match(ui, /<details class="episode-progress[\s\S]*<summary>/, "集数进度应支持收起");
assert.match(ui, /<details class="agent-fold method">/, "低频工作方法应默认收起");
assert.match(ui, /<details id="episode-\$\{escapeHtml\(index\)\}" class="\$\{unitClass\}"[\s\S]*\$\{summary\}/, "每集剧本应以独立收起单元呈现");
assert.match(ui, /const unitClass=`script-unit\$\{isCurrent\?" is-current":""\}`/, "当前或待处理剧集应得到当前态样式");
assert.match(ui, /\$\{isCurrent\?"open":""\}/, "当前或待处理剧集应默认展开");
assert.match(ui, /id="btn-next"/, "逐集生成操作必须保留");
assert.match(ui, /id="btn-export"/, "导出操作必须保留");

console.log("pixel-writer workspace UI tests passed");
