import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");

assert.match(app, /hydrating:\s*true/, "刷新启动时必须进入项目恢复状态");
assert.match(app, /function renderHydrationState\(/, "刷新期间必须有专用恢复界面，不能渲染默认空项目");
assert.match(app, /if \(state\.hydrating\s*\|\|\s*!state\.agent\)\s*\{[\s\S]{0,500}renderHydrationState/, "未恢复服务端状态前不得渲染默认阶段内容");
assert.match(app, /timeoutMs[\s\S]{0,220}AbortController/, "状态请求必须有可控超时，不能无限等待");
assert.match(app, /for \(let attempt = 1; attempt <= PIXELTALE_STATE_RETRY_LIMIT; attempt\+\+\)/, "刷新状态请求必须在短暂失败时自动重试");
assert.match(app, /state\.hydrating = false;[\s\S]{0,180}updateAgentState\(payload\.agent\)[\s\S]{0,180}renderStage\(\)/, "恢复成功后必须用完整服务端状态重绘页面");
assert.match(app, /state\.hydrationError = userFacingError\(error\);[\s\S]{0,180}renderStage\(\)/, "恢复失败也必须离开加载状态并显示可重试入口");
assert.match(app, /data-retry-hydration/, "恢复失败时必须提供页面内重试入口");
assert.doesNotMatch(app, /if \(!state\.agent\) location\.reload\(\)/, "刷新恢复失败不得用无限强刷制造死循环");
assert.match(app, /syncAgentState\(\{ silent: true, autoRestore: true \}\)\.finally\(\(\) => \{[\s\S]{0,180}if \(state\.activeRun\) void monitorBackgroundRun\(state\.activeRun\)/, "刷新后必须继续监控已持久化的后台任务");
assert.match(app, /function updateAgentState\(agent\) \{\s*if \(!agent \|\| typeof agent !== "object"\) return;/, "后台任务缺少状态时不得清空已恢复的项目");
assert.match(app, /if \(!result\?\.state\) \{[\s\S]{0,180}renderStage\(\)/, "后台任务缺少完整状态时必须保留当前页面内容");

console.log("pixeltale refresh recovery ok");
