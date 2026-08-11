import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");

assert.match(app, /const SESSION_SNAPSHOT_KEY = `pixeltale\.story-forge-snapshot:\$\{sessionId\}`/, "项目快照必须按当前会话隔离");
assert.match(app, /function persistSessionSnapshot\([\s\S]{0,800}JSON\.stringify/, "当前页面状态必须写入会话快照");
assert.match(app, /function restoreSessionSnapshot\([\s\S]{0,1200}state\.stage = snapshot\.stage/, "刷新时必须恢复刷新前所在阶段");
assert.match(app, /const restoredSession = restoreSessionSnapshot\(\);\s*renderStage\(\);\s*syncAgentState\(\{ silent: true \}\)/, "启动时必须先同步恢复当前会话页面，再后台读取服务端状态");
assert.doesNotMatch(app, /正在读取当前项目/, "刷新不得显示读取项目的等待页面");
assert.doesNotMatch(app, /autoRestore/, "刷新不得自动切换到其他历史项目");
assert.match(app, /timeoutMs[\s\S]{0,220}AbortController/, "状态请求必须有可控超时，不能无限等待");
assert.match(app, /response = await fetch\([\s\S]{0,500}payload = await response\.json\(\)[\s\S]{0,500}\} finally \{[\s\S]{0,100}clearTimeout/, "响应体读取也必须受同一个状态请求超时保护");
assert.match(app, /for \(let attempt = 1; attempt <= PIXELTALE_STATE_RETRY_LIMIT; attempt\+\+\)/, "刷新状态请求必须在短暂失败时自动重试");
assert.match(app, /updateAgentState\(payload\.agent\)[\s\S]{0,180}renderStage\(\)/, "后台同步成功后必须用完整服务端状态校准页面");
assert.match(app, /syncAgentState\(\{ silent: true \}\)\.finally\(\(\) => \{[\s\S]{0,180}if \(state\.activeRun\) void monitorBackgroundRun\(state\.activeRun\)/, "刷新后必须继续监控已持久化的后台任务");
assert.match(app, /function updateAgentState\(agent\) \{\s*if \(!agent \|\| typeof agent !== "object"\) return;/, "后台任务缺少状态时不得清空已恢复的项目");
assert.match(app, /if \(!result\?\.state\) \{[\s\S]{0,180}renderStage\(\)/, "后台任务缺少完整状态时必须保留当前页面内容");
assert.match(app, /function consumePendingNewNotice\([\s\S]{0,300}sessionStorage\.removeItem\(PENDING_NOTICE_KEY\)/, "新建剧集标记必须在状态恢复流程内消费");
assert.match(app, /const pendingNew = consumePendingNewNotice\(\);/, "新建剧集提示必须在状态同步后消费");

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

const snapshotStore = new Map();
const snapshotContext = {
  JSON,
  SESSION_SNAPSHOT_KEY: "pixeltale.story-forge-snapshot:test-session",
  Set,
  sessionStorage: {
    getItem: (key) => snapshotStore.get(key) || null,
    setItem: (key, value) => snapshotStore.set(key, value),
  },
  stageOrder: ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue", "handoff"],
  state: {
    agent: { stage: "arc", artifacts: [{ id: "arc_1", stage: "arc" }], approvedArtifactIds: ["arc_1"] },
    stage: "arc",
    input: { storyTitle: "The Last Signal" },
    routes: { orchestration: "gpt-5.6-terra" },
    approved: new Set(["arc_1"]),
  },
  updateAgentState: (agent) => {
    snapshotContext.state.agent = agent;
    snapshotContext.state.stage = agent.stage || "brief";
  },
};
vm.createContext(snapshotContext);
vm.runInContext(extractFunction(app, "function persistSessionSnapshot()"), snapshotContext, { filename: "public/pixeltale/app.js" });
vm.runInContext(extractFunction(app, "function restoreSessionSnapshot()"), snapshotContext, { filename: "public/pixeltale/app.js" });
vm.runInContext("persistSessionSnapshot()", snapshotContext);
snapshotContext.state.agent = { stage: "brief", artifacts: [], approvedArtifactIds: [] };
snapshotContext.state.stage = "brief";
snapshotContext.state.input = {};
snapshotContext.state.routes = {};
snapshotContext.state.approved = new Set();
assert.equal(vm.runInContext("restoreSessionSnapshot()", snapshotContext), true, "刷新必须能恢复当前会话快照");
assert.equal(snapshotContext.state.stage, "arc", "刷新后必须立即回到刷新前所在阶段");
assert.equal(snapshotContext.state.agent.artifacts[0].id, "arc_1", "刷新后必须立即保留原阶段产物");

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
