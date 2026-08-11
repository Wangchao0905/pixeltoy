import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");

assert.match(app, /hydrating:\s*true/, "刷新启动时必须进入项目恢复状态");
assert.match(app, /function renderHydrationState\(/, "刷新期间必须有专用恢复界面，不能渲染默认空项目");
assert.match(app, /if \(state\.hydrating\s*\|\|\s*!state\.agent\)\s*\{[\s\S]{0,500}renderHydrationState/, "未恢复服务端状态前不得渲染默认阶段内容");
assert.match(app, /timeoutMs[\s\S]{0,220}AbortController/, "状态请求必须有可控超时，不能无限等待");
assert.match(app, /response = await fetch\([\s\S]{0,500}payload = await response\.json\(\)[\s\S]{0,500}\} finally \{[\s\S]{0,100}clearTimeout/, "响应体读取也必须受同一个状态请求超时保护");
assert.match(app, /for \(let attempt = 1; attempt <= PIXELTALE_STATE_RETRY_LIMIT; attempt\+\+\)/, "刷新状态请求必须在短暂失败时自动重试");
assert.match(app, /state\.hydrating = false;[\s\S]{0,180}updateAgentState\(payload\.agent\)[\s\S]{0,180}renderStage\(\)/, "恢复成功后必须用完整服务端状态重绘页面");
assert.match(app, /state\.hydrationError = userFacingError\(error\);[\s\S]{0,180}renderStage\(\)/, "恢复失败也必须离开加载状态并显示可重试入口");
assert.match(app, /data-retry-hydration/, "恢复失败时必须提供页面内重试入口");
assert.doesNotMatch(app, /if \(!state\.agent\) location\.reload\(\)/, "刷新恢复失败不得用无限强刷制造死循环");
assert.match(app, /syncAgentState\(\{ silent: true, autoRestore: true \}\)\.finally\(\(\) => \{[\s\S]{0,180}if \(state\.activeRun\) void monitorBackgroundRun\(state\.activeRun\)/, "刷新后必须继续监控已持久化的后台任务");
assert.match(app, /function updateAgentState\(agent\) \{\s*if \(!agent \|\| typeof agent !== "object"\) return;/, "后台任务缺少状态时不得清空已恢复的项目");
assert.match(app, /if \(!result\?\.state\) \{[\s\S]{0,180}renderStage\(\)/, "后台任务缺少完整状态时必须保留当前页面内容");
assert.match(app, /function consumePendingNewNotice\([\s\S]{0,300}sessionStorage\.removeItem\(PENDING_NOTICE_KEY\)/, "新建剧集标记必须在状态恢复流程内消费");
assert.match(app, /const pendingNew = consumePendingNewNotice\(\);[\s\S]{0,220}if \(autoRestore && !artifacts\.length && !pendingNew\)/, "新建的空会话不得被自动恢复逻辑替换为旧项目");
assert.doesNotMatch(app, /syncAgentState\(\{ silent: true, autoRestore: true \}\)\.finally\([\s\S]{0,400}sessionStorage\.removeItem\(PENDING_NOTICE_KEY\)/, "启动时不得在状态恢复前清除新建剧集标记");

const scoreUse = app.indexOf("scoresMet");
const scoreDeclaration = app.indexOf("const scoresMet = scoresMeetGate(reviewContent);");
assert.ok(scoreDeclaration >= 0 && scoreDeclaration === app.lastIndexOf("const scoresMet = scoresMeetGate(reviewContent);"), "评分门槛必须只声明一次");
assert.ok(scoreDeclaration < app.indexOf("const mandatoryOverride", scoreDeclaration), "评分门槛必须在人工放行条件使用前完成初始化");
assert.ok(scoreUse >= 0, "审核面板必须使用评分门槛");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing app function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated app function: ${signature}`);
}

const requestContext = {
  AbortController,
  agentApiPath: (suffix) => suffix,
  agentRequestHeaders: () => ({}),
  clearTimeout,
  fetch: async (_url, options) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("response body aborted")), { once: true });
    }),
  }),
  setTimeout,
};
vm.createContext(requestContext);
vm.runInContext(extractFunction(app, "async function request("), requestContext, { filename: "public/pixeltale/app.js" });
await assert.rejects(
  () => vm.runInContext('request("/state", { timeoutMs: 20 })', requestContext),
  (error) => error?.code === "PIXELTALE_STATE_TIMEOUT",
  "状态响应体卡住时也必须在超时窗口内结束，而不是永久显示读取中",
);

console.log("pixeltale refresh recovery ok");
