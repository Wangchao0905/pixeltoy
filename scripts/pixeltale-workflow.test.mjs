import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/pixeltale/styles.css"), "utf8");
const agent = fs.readFileSync(path.join(root, "server/pixeltale-agent.js"), "utf8");
const { createPixelTaleAgent, aggregateCrossReview, buildRevisionContract } = await import(pathToFileURL(path.join(root, "server/pixeltale-agent.js")).href);

assert.match(html, /id="newDraft"[^>]*>[^<]*<span[^>]*>\+<\/span>\s*新建剧集/, "new story action must be explicit");
assert.match(app, /function startNewDraft\(\)[\s\S]*localStorage\.setItem\(SESSION_STORAGE_KEY[\s\S]*window\.location\.reload\(\)/, "new story must rotate the session before reloading");
assert.match(app, /function userFacingError\(error\)/, "provider errors must be normalized for users");
assert.match(app, /next-step-error[\s\S]*role="alert"/, "run errors must remain visible beside the next action");
assert.match(app, /const actionCopy = state\.lastError[\s\S]*生成失败：\$\{state\.lastError\}/, "next action must explain a failed run");
assert.match(app, /function renderBriefArtifact\(\)/, "brief output must show its generated artifact and review state");
assert.match(app, /复核未通过，需要一次性修订[\s\S]*统一操作入口位于下方/, "brief review failures must explain how to continue");
assert.match(app, /kind: "auto-revise"[\s\S]*执行交叉修订并复审/, "review flow must expose one canonical revision action");
assert.doesNotMatch(app, /review-auto-fix/, "review panel must not expose a duplicate revision button");
assert.match(app, /const fieldLabelMap = \{[\s\S]*title_zh: "剧名"/, "structured fields must have Chinese display labels");
assert.match(app, /fieldLabel\(key\)/, "nested structured fields must use the display label map");
assert.match(styles, /\.app-shell \{ height: 100vh; height: 100dvh;[\s\S]*overflow: hidden; \}/, "desktop shell must stay within the viewport");
assert.match(styles, /\.stage-content \{ width: min\(1180px,/, "wide screens must use the central workspace");
assert.match(styles, /\.inspiration-pool \{[\s\S]*height: 360px;/, "inspiration pool must not push the workflow down");
assert.match(app, /function renderReviewPanel\(reviewContent = \{\}, \{ passed/, "review output must expose a complete issue panel");
assert.match(app, /执行交叉修订并复审/, "review output must offer one-click full-list revision");
assert.match(app, /revisionPlan/, "automatic revision must pass a scoped revision plan");
assert.match(app, /revision-closure/, "revision output must expose item-by-item closure evidence");
assert.match(styles, /\.review-issue-list \{[\s\S]*max-height: 420px;/, "review issues must stay readable in a bounded panel");
assert.match(agent, /必须穷举本次产物中所有需要修订的问题/, "review prompts must require exhaustive findings");
assert.match(agent, /revisionClosureProtocol/, "review prompts must require closure evidence for every revision item");

const aggregated = aggregateCrossReview([
  {
    result: {
      provider: "chatgpt",
      model: "review-a",
      content: {
        pass: false,
        score: 60,
        findings: ["人物动机不足"],
        required_changes: ["补足主角行动动机"],
        issues: [{ tag: "人物动机不足", dimension: "plot", severity: "high", feedback: "主角没有明确选择原因", fix: "补出触发事件与代价" }],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 60, feedback: "需修订" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
  {
    result: {
      provider: "claude",
      model: "review-b",
      content: {
        pass: false,
        score: 62,
        findings: ["节奏偏弱"],
        required_changes: ["强化第一幕节奏"],
        issues: [
          { tag: "人物动机不足", dimension: "plot", severity: "high", feedback: "目标与阻碍没有形成因果", fix: "明确主角的即时目标" },
          { tag: "节奏偏弱", dimension: "structure", severity: "medium", feedback: "开头缺少可感知冲突", fix: "在前 3 秒加入异常事件" },
        ],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 62, feedback: "需修订" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
  {
    result: {
      provider: "grok",
      model: "review-c",
      content: {
        pass: false,
        score: 64,
        findings: [],
        required_changes: [],
        issues: [],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 64, feedback: "需修订" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
]);
assert.ok(aggregated.issueCount >= 2, "consensus must include independent and shared issues");
assert.equal(aggregated.commonIssueCount, 1, "shared issue count must remain available");
assert.ok(aggregated.independentIssueCount >= 1, "independent issue count must remain available");
assert.equal(aggregated.reviewIssues[0].suggestions.length, 2, "all suggestions for a shared issue must be retained");
assert.equal(aggregated.pass, false, "any unresolved issue must keep the artifact behind the review gate");
assert.ok(aggregated.required_changes.some((item) => item.includes("节奏偏弱")), "independent issues must become actionable changes");

const contract = buildRevisionContract(aggregated, { stage: "brief", sourceArtifactId: "artifact_v1", id: "revision_test" });
const resolvedReview = (model) => ({
  result: {
    provider: "chatgpt",
    model,
    content: {
      pass: true,
      score: 92,
      findings: [],
      required_changes: [],
      issues: [],
      revisionClosures: contract.items.map((item) => ({ issueId: item.id, status: "resolved", evidence: "修订内容满足验收条件", remainingFix: "" })),
      dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 92, feedback: "通过" }])),
      checks: { cross_validation: true, consistency: true, adversarial: true },
    },
  },
});
const closed = aggregateCrossReview([resolvedReview("review-a"), resolvedReview("review-b"), resolvedReview("review-c")], contract);
assert.equal(closed.pass, true, "a revised artifact must pass only after every contract item is closed");
assert.equal(closed.revision.closure.allResolved, true, "closure evidence must be retained for the approved revision");

const partial = resolvedReview("review-c");
partial.result.content.revisionClosures[0].status = "partial";
partial.result.content.revisionClosures[0].remainingFix = "补出主角的明确选择";
const notClosed = aggregateCrossReview([resolvedReview("review-a"), resolvedReview("review-b"), partial], contract);
assert.equal(notClosed.pass, false, "a partial closure must keep the revision behind the review gate");
assert.equal(notClosed.revision.closure.items[0].status, "partial", "the unresolved contract item must remain visible");

const stateStore = new Map();
let uuidSequence = 0;
const dimensions = Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 90, feedback: "通过" }]));
const reviewOutput = (revisionProtocol) => ({
  pass: !!revisionProtocol,
  score: revisionProtocol ? 90 : 58,
  findings: revisionProtocol ? [] : ["主角行动动机不足"],
  required_changes: revisionProtocol ? [] : ["补足主角立刻行动的触发事件与代价"],
  issues: revisionProtocol ? [] : [{ tag: "人物动机不足", dimension: "plot", severity: "high", feedback: "主角没有行动触发", fix: "补足触发事件与代价" }],
  revision_closures: revisionProtocol ? revisionProtocol.items.map((item) => ({ issue_id: item.id, status: "resolved", evidence: "修订稿已给出触发事件与代价", remaining_fix: "" })) : [],
  dimensions,
  checks: { cross_validation: true, consistency: true, adversarial: true },
});
const fakeFetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  const system = request.messages[0].content;
  const user = JSON.parse(request.messages[1].content);
  const output = /交叉审核 Agent/.test(system)
    ? reviewOutput(user.revisionClosureProtocol)
    : { title_zh: "暗门", logline_zh: "主角必须在代价逼近前打开一扇暗门。", core_conflict_zh: "真相与生存冲突。", viewer_question_zh: "她会付出什么代价？" };
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
};
const runAgent = createPixelTaleAgent({
  env: { PIXELTALE_CHATGPT_API_KEY: "test", PIXELTALE_CLAUDE_API_KEY: "test", PIXELTALE_GROK_API_KEY: "test", PIXELTALE_MAX_RETRIES: "0" },
  fetch: fakeFetch,
  readPixelTaleState: (stateRoot) => stateStore.get(stateRoot) || {},
  writePixelTaleState: (stateRoot, state) => stateStore.set(stateRoot, state),
  randomUUID: () => `${String(++uuidSequence).padStart(12, "0")}-1234-1234-1234-123456789abc`,
});
const runParams = { pixelTaleRoot: "revision-e2e", projectId: "revision-e2e", project: { id: "revision-e2e", title: "Revision E2E", episode: "DRAFT" }, stage: "brief", input: { idea: "主角为救家人闯入禁区" } };
const initialRun = await runAgent.run(runParams);
assert.equal(initialRun.status, "needs_review", "initial review must retain a failed source version");
const revisionRun = await runAgent.run({ ...runParams, revisionPlan: "按全部审核问题修订" });
assert.equal(revisionRun.status, "completed", `revision must run as a distinct, reviewable version: ${JSON.stringify(revisionRun.errors)}`);
assert.equal(revisionRun.revision.allResolved, true, "the run record must prove all revision contract items were closed");
const finalReview = revisionRun.state.artifacts.find((artifact) => artifact.id === revisionRun.artifacts[1].id);
assert.equal(finalReview.content.revision.closure.allResolved, true, "the persisted review must retain item-by-item closure evidence");

console.log("pixeltale workflow contract ok");
