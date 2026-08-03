import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/pixeltale/styles.css"), "utf8");
const agent = fs.readFileSync(path.join(root, "server/pixeltale-agent.js"), "utf8");
const { createPixelTaleAgent, callStagePrimary, aggregateCrossReview, buildRevisionContract, validateReview } = await import(pathToFileURL(path.join(root, "server/pixeltale-agent.js")).href);

assert.match(agent, /modelRouter\.call/, "PixelTale must delegate text execution to an injected model router");
assert.match(agent, /modelRouter\.reviewModels\(route\)/, "cross-review must be selected by the SuperPixel router");
assert.doesNotMatch(agent, /PIXELTALE_(CHATGPT|CLAUDE|GROK)_API_KEY/, "PixelTale must not own provider credentials");
assert.match(app, /syncRoutingModelOptions\(agent\.modelOptions \|\| \[\]\)/, "model choices must be synchronized from SuperPixel's returned registry");
assert.match(app, /\["chatgpt", "claude", "grok"\]/, "review UI must represent all three SuperPixel model families");

assert.match(html, /id="newDraft"[^>]*>[^<]*<span[^>]*>\+<\/span>\s*新建剧集/, "new story action must be explicit");
const pixelTaleStylesStamp = html.match(/pixeltale\/styles\.css\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
const pixelTaleAppStamp = html.match(/pixeltale\/app\.js\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
assert.ok(pixelTaleStylesStamp && pixelTaleAppStamp, "PixelTale static assets must carry cache stamps");
assert.equal(pixelTaleAppStamp, pixelTaleStylesStamp, "PixelTale styles and app cache stamps must stay synchronized");
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
assert.match(agent, /只返回最多 3 个会阻断下一阶段的问题/, "review prompts must stay concise and stage-scoped");
assert.match(agent, /revisionClosureProtocol/, "review prompts must require closure evidence for every revision item");
assert.match(agent, /BRIEF_SPEC_MATCH/, "brief review must use stable stage-specific criterion ids");
assert.match(agent, /不得要求人物表、分集表、场景表或对白等尚未到达阶段的产物/, "a reviewer must not demand deliverables from later stages");

const wrappedReview = validateReview({ review: {
  pass: true,
  score: 92,
  findings: [],
  required_changes: [],
  issues: [],
  dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 92, feedback: "通过" }])),
  checks: { cross_validation: true, consistency: true, adversarial: true },
} }, { requireDimensions: true });
assert.equal(wrappedReview.pass, true, "common review/result wrapper objects must normalize to the canonical review schema");

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
assert.ok(!aggregated.required_changes.some((item) => item.includes("节奏偏弱")), "a single-model opinion must remain advisory until independently confirmed");
assert.ok(aggregated.required_changes.some((item) => item.includes("人物动机不足")), "two-model agreement must become a mandatory change");

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

const quorumPass = aggregateCrossReview([
  resolvedReview("review-a"),
  resolvedReview("review-b"),
  { route: "grok-4.5", model: "grok-4.5", error: "upstream timeout" },
]);
assert.equal(quorumPass.pass, true, "two agreeing completed reviewers must not be discarded by one unavailable reviewer");
assert.deepEqual(quorumPass.quorum, { required: 2, completed: 2, passing: 2, met: true }, "the canonical review result must expose quorum evidence");
const noQuorum = aggregateCrossReview([
  resolvedReview("review-a"),
  { route: "claude-opus-5", model: "claude-opus-5", error: "upstream timeout" },
  { route: "grok-4.5", model: "grok-4.5", error: "upstream timeout" },
]);
assert.equal(noQuorum.pass, false, "one reviewer can never release a stage");

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
const testModels = [
  { id: "gpt-5.6-terra", provider: "chatgpt", configured: true },
  { id: "claude-opus-5", provider: "claude", configured: true },
  { id: "grok-4.5", provider: "grok", configured: true },
];
const testRouter = {
  models: () => testModels,
  status: () => Object.fromEntries(["chatgpt", "claude", "grok"].map((provider) => [provider, { provider, configured: true }])),
  stageModels: (route) => [route.primary, route.reviewer, route.consistency],
  reviewModels: () => testModels.map(({ id: model, provider }) => ({ model, provider, configured: true })),
  call: async ({ model, system, user }) => {
    const input = JSON.parse(user);
    const output = /交叉审核 Agent/.test(system)
      ? reviewOutput(input.revisionClosureProtocol)
      : { title_zh: "暗门", logline_zh: "主角必须在代价逼近前打开一扇暗门。", core_conflict_zh: "真相与生存冲突。", viewer_question_zh: "她会付出什么代价？" };
    return { provider: testModels.find((item) => item.id === model)?.provider || "superpixel", model, content: output, attempts: 0, trace: [{ model }] };
  },
};
const runAgent = createPixelTaleAgent({
  modelRouter: testRouter,
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

const primaryFallback = await callStagePrimary({
  route: { primary: "gpt-5.6-terra", reviewer: "claude-opus-5", consistency: "grok-4.5" },
  system: "stage generation",
  user: "{}",
  modelRouter: {
    stageModels: (route) => [route.primary, route.reviewer, route.consistency],
    call: async ({ model }) => {
      if (model === "gpt-5.6-terra") {
        const error = new Error("upstream connection reset");
        error.code = "NETWORK_ERROR";
        error.retryable = true;
        throw error;
      }
      return { provider: "claude", model, content: { ok: true }, attempts: 0, trace: [{ model }] };
    },
  },
});
assert.equal(primaryFallback.provider, "claude", "a timed-out primary must advance to the next configured stage model");
assert.equal(primaryFallback.fallback, true, "fallback execution must remain visible to the run record");
assert.equal(primaryFallback.fallbackFailures.length, 1, "only the failed primary should be recorded before recovery");

let elapsedMs = 0;
const timedCalls = [];
await assert.rejects(
  () => callStagePrimary({
    route: { primary: "gpt-5.6-terra", reviewer: "claude-opus-5", consistency: "grok-4.5" },
    system: "stage generation",
    user: "{}",
    totalTimeoutMs: 15_000,
    perModelTimeoutMs: 14_000,
    nowMs: () => elapsedMs,
    modelRouter: {
      stageModels: (route) => [route.primary, route.reviewer, route.consistency, "gpt-5.6-sol"],
      call: async ({ model, timeoutMs }) => {
        timedCalls.push({ model, timeoutMs });
        elapsedMs += timeoutMs;
        const error = new Error("upstream request timed out");
        error.code = "TIMEOUT";
        error.retryable = true;
        throw error;
      },
    },
  }),
  (error) => error.code === "STAGE_GENERATION_UNAVAILABLE" && error.fallbackFailures.some((item) => item.code === "STAGE_TIMEOUT_BUDGET_EXHAUSTED"),
  "the primary stage must stop before starting another request after its total budget is exhausted",
);
assert.equal(timedCalls.length, 1, "the stage budget must prevent a second model request after a 14 second failure in a 15 second window");
assert.equal(timedCalls[0].timeoutMs, 14_000, "each primary attempt must receive the bounded per-model timeout");
assert.match(agent, /STAGE_PRIMARY_BUDGET_MS = 210_000/, "production primary generation must have one bounded attempt for each provider family");
assert.match(agent, /STAGE_PRIMARY_MODEL_TIMEOUT_MS = 70_000/, "a single author must have measured latency headroom without creating an eleven-minute retry chain");
assert.ok(
  Number(agent.match(/STAGE_PRIMARY_BUDGET_MS = ([\d_]+)/)[1].replace(/_/g, "")) <= 300_000,
  "the primary budget must stay inside the 300 second Nginx upstream window",
);
assert.match(agent, /modelRouter\.stageModels\(route\)\.slice\(0, 3\)/, "primary fallback must never walk the full writing roster sequentially");
assert.doesNotMatch(agent, /\.\.\.providers, \.\.\.providers|flatMap\(\(provider\) => \[provider, provider\]\)/, "a stage must never repeat the same three-model sweep");
assert.match(agent, /brief: 1_800/, "brief generation must not request the universal 12k output budget");
assert.match(agent, /REVIEW_QUORUM = 2/, "two independent completed reviews must form quorum");
assert.match(app, /async function waitForRunJob/, "long PixelTale runs must be polled instead of held inside one proxy request");
assert.match(app, /accepted\.job\?\.jobId/, "the stage runner must poll the exact accepted job");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
assert.match(serverSource, /function startPixelTaleRun\(/, "the server must execute PixelTale stages as background jobs");
assert.match(serverSource, /activePixelTaleRuns/, "the server must deduplicate concurrent runs for the same stage");
assert.match(serverSource, /max_tokens: maxTokens/, "the SuperPixel router must honor the stage output budget");
assert.match(serverSource, /fallbackModels/, "a review role must have a same-provider model fallback without changing its identity");
assert.match(fs.readFileSync(path.join(root, "server.js"), "utf8"), /uniqueModelIds\(\[route\.primary, route\.reviewer, route\.consistency\]\)/, "SuperPixel stage candidates must remain the configured three-role chain");

console.log("pixeltale workflow contract ok");
