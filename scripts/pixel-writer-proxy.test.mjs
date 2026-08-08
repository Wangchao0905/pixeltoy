import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Pixel Writer 接入主站（pixeltoy.cn）的守门测试：
//   1) Story Forge 页面（pixeltale.html）必须挂载 scriptwriter-mode.js（注入 Pixel Writer tab）
//   2) server.js 必须提供 /pixel-writer/ 同源代理（iframe 工作台走同源，远程访客不连自己 127.0.0.1）
//   3) 代理目标路径重写规则正确（/pixel-writer/api/start -> /api/start）
//   4) 工作台 UI 的 API 调用必须是相对路径（否则 iframe 里会打到主站 /api/，而非代理）

const root = new URL("..", import.meta.url).pathname;

// --- 1) 挂载点：pixeltale.html 必须加载 scriptwriter-mode.js ---
const page = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
assert.match(page, /<script src="\/scriptwriter-mode\.js[^"]*"><\/script>/, "pixeltale.html 必须挂载 scriptwriter-mode.js（Pixel Writer tab）");

// --- 2) server.js 必须包含同源代理 ---
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
assert.match(serverSource, /function proxyPixelWriter\(req, res, url\)/, "server.js 必须实现 proxyPixelWriter");
assert.match(serverSource, /function pixelWriterProxyTarget\(pathname\)/, "server.js 必须实现 pixelWriterProxyTarget（可测的路径重写）");
assert.match(
  serverSource,
  /url\.pathname\.startsWith\("\/pixel-writer\/"\) \|\| url\.pathname === "\/pixel-writer"/,
  "handleRequest 必须路由 /pixel-writer/ 到代理",
);
assert.match(serverSource, /PIXEL_WRITER_TARGET = \{ host: "127\.0\.0\.1", port: 8877 \}/, "代理目标必须是本机 8877");

// --- 3) 路径重写规则（纯函数级验证）---
const mod = await import(path.join(root, "server.js"));
const { __test } = mod.default || mod;
assert.ok(__test, "server.js 必须导出 __test（供测试探针）");
assert.equal(typeof __test.pixelWriterProxyTarget, "function", "__test.pixelWriterProxyTarget 必须是函数");
assert.equal(__test.pixelWriterProxyTarget("/pixel-writer/"), "/");
assert.equal(__test.pixelWriterProxyTarget("/pixel-writer"), "/");
assert.equal(__test.pixelWriterProxyTarget("/pixel-writer/api/start"), "/api/start");
assert.equal(__test.pixelWriterProxyTarget("/pixel-writer/projects/p1.docx"), "/projects/p1.docx");
assert.equal(__test.pixelWriterProxyTarget("/api/start"), "/api/start", "非 /pixel-writer 路径不被重写");

// --- 4) 工作台 UI 相对路径（iframe 走代理的前提）---
const ui = fs.readFileSync(path.join(root, "scriptwriter-agent/ui/index.html"), "utf8");
assert.match(ui, /post\("api\/start"/, "UI 必须用相对路径调用 api/start（iframe 走 /pixel-writer/ 代理）");
assert.match(ui, /post\("api\/export"/, "UI 必须用相对路径调用 api/export");
assert.match(ui, /window\.location\.href\s*=\s*result\.file\s*\|\|\s*\("projects\/"\s*\+\s*encodeURIComponent\(projectId\)\s*\+\s*"\.docx"\)/, "UI 下载必须用相对路径 projects/<id>.docx（优先服务端返回的 file）");
assert.match(ui, /beat-action/, "UI 必须渲染动作描述（beat.action），不能只有对白（speaker/line 存在时 action 曾被丢弃）");
assert.match(ui, /api\/project\?project_id=/, "创作历史加载必须用 GET + query（/api/project 是 GET 接口，POST 会 404 导致点击无反应）");
assert.match(ui, /ideaBox\.raw/, "点击创作历史后必须把故事种子（idea.raw）回填到输入框");
assert.doesNotMatch(ui, /fetch\("\/api\//, "UI 不得用绝对路径 /api/（会绕过代理打到主站 API）");

console.log("pixel-writer proxy + mount tests passed");
