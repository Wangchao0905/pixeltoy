import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/pixeltale/styles.css"), "utf8");
const agent = fs.readFileSync(path.join(root, "server/pixeltale-agent.js"), "utf8");
const { createPixelTaleAgent, callStagePrimary, aggregateCrossReview, buildRevisionContract, validateContent, validateReview } = await import(pathToFileURL(path.join(root, "server/pixeltale-agent.js")).href);

assert.match(agent, /modelRouter\.call/, "PixelTale must delegate text execution to an injected model router");
assert.match(agent, /modelRouter\.reviewModels\(route\)/, "cross-review must be selected by the SuperPixel router");
assert.doesNotMatch(agent, /PIXELTALE_(CHATGPT|CLAUDE|GROK|DEEPSEEK)_API_KEY/, "PixelTale must not own provider credentials");
assert.match(app, /syncRoutingModelOptions\(agent\.modelOptions \|\| \[\]\)/, "model choices must be synchronized from SuperPixel's returned registry");
assert.match(app, /\["chatgpt", "claude", "deepseek"\]/, "review UI must represent all three SuperPixel model families");

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
assert.match(app, /共识复核未通过，需要定向修订[\s\S]*统一操作入口位于下方/, "brief review failures must explain how to continue");
assert.match(app, /参考建议，不阻断确认/, "single-model opinions must be visibly separated from mandatory revisions");
assert.match(app, /kind: "auto-revise"[\s\S]*执行交叉修订并复审/, "review flow must expose one canonical revision action");
assert.doesNotMatch(app, /review-auto-fix/, "review panel must not expose a duplicate revision button");
assert.match(app, /const fieldLabelMap = \{[\s\S]*title_zh: "剧名"/, "structured fields must have Chinese display labels");
assert.match(app, /data-regenerate-title/, "title selection must expose a regenerate action before approval");
assert.match(app, /生成 4 个剧名候选[\s\S]*重新生成 4 个/, "title UI must expose exactly four title choices");
assert.match(app, /中文释义只供创作者对照，不会写入后续正式标题/, "title UI must distinguish the English release title from its Chinese explanation");
assert.match(app, /单模型生成完成 · 等待人工选择[\s\S]*不进入交叉审核/, "title UI must explain its single-model no-review policy");
assert.match(agent, /正式发行片名必须使用自然英文/, "title generation must follow the release language instead of returning Chinese names");
assert.match(agent, /人物身份或关系、地点或机构、异常物件或意象、带双重含义的极简短语/, "title generation must enforce four distinct naming genes");
assert.match(agent, /Billionaire、CEO、Mafia、Reborn、Revenge/, "title generation must reject generic web-fiction naming templates");
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
      provider: "deepseek",
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

const advisoryOnly = aggregateCrossReview([
  {
    result: {
      provider: "chatgpt",
      model: "review-a",
      content: {
        pass: true,
        score: 92,
        findings: [],
        required_changes: [],
        issues: [],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 92, feedback: "通过" }])),
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
        score: 68,
        findings: ["可以进一步强化开场"],
        required_changes: ["考虑提前异常事件"],
        issues: [{ criterionId: "BRIEF_OPENING_PROMISE", tag: "开场力度", dimension: "structure", severity: "medium", feedback: "开场较平", fix: "考虑提前异常事件" }],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 68, feedback: "有优化空间" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
  { route: "deepseek-v4-pro", model: "deepseek-v4-pro", error: "upstream timeout" },
]);
assert.equal(advisoryOnly.pass, true, "one model's unconfirmed issue must remain advisory when review quorum is met");
assert.equal(advisoryOnly.required_changes.length, 0, "advisory-only feedback must not create a mandatory revision contract");
assert.equal(advisoryOnly.independentIssueCount, 1, "the independent opinion must remain visible to the user");

const contract = buildRevisionContract(aggregated, { stage: "brief", sourceArtifactId: "artifact_v1", id: "revision_test" });
const inheritedContract = buildRevisionContract({
  commonIssues: [],
  reviewIssues: [{ tag: "单模型建议", modelCount: 1, suggestions: ["不应形成强制修订"] }],
  required_changes: ["单模型建议不得直接变成修订合同"],
  revision: {
    contract: {
      items: [{ id: "brief-R01", tag: "开场冲击", dimension: "structure", severity: "high", modelCount: 2, requiredEdit: ["补足首个冲击"], evidence: ["开头没有立即改变局面"] }],
    },
    closure: {
      items: [{ id: "brief-R01", status: "unresolved", remainingFix: ["补足首个冲击并明确代价"] }],
    },
  },
}, { stage: "brief", sourceArtifactId: "artifact_v2", id: "revision_test_2" });
assert.equal(inheritedContract.items.length, 1, "an unresolved prior revision item must be carried into the next revision contract");
assert.deepEqual(inheritedContract.items[0].requiredEdit, ["补足首个冲击", "补足首个冲击并明确代价"], "inherited contract must retain both the original edit and the latest remaining fix");
const advisoryContract = buildRevisionContract({
  commonIssues: [],
  reviewIssues: [{ tag: "单模型建议", modelCount: 1, suggestions: ["只供参考"] }],
  required_changes: ["单模型建议只供参考"],
}, { stage: "brief", sourceArtifactId: "artifact_v3", id: "revision_test_3" });
assert.equal(advisoryContract.items.length, 0, "single-model advice must never create a mandatory revision contract");
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
  { route: "deepseek-v4-pro", model: "deepseek-v4-pro", error: "upstream timeout" },
]);
assert.equal(quorumPass.pass, true, "two agreeing completed reviewers must not be discarded by one unavailable reviewer");
assert.deepEqual(quorumPass.quorum, { required: 2, completed: 2, passing: 2, met: true }, "the canonical review result must expose quorum evidence");
const noQuorum = aggregateCrossReview([
  resolvedReview("review-a"),
  { route: "claude-opus-5", model: "claude-opus-5", error: "upstream timeout" },
  { route: "deepseek-v4-pro", model: "deepseek-v4-pro", error: "upstream timeout" },
]);
assert.equal(noQuorum.pass, false, "one reviewer can never release a stage");

const partial = resolvedReview("review-c");
partial.result.content.revisionClosures[0].status = "partial";
partial.result.content.revisionClosures[0].remainingFix = "补出主角的明确选择";
const majorityClosed = aggregateCrossReview([resolvedReview("review-a"), resolvedReview("review-b"), partial], contract);
assert.equal(majorityClosed.pass, true, "two resolved votes must close a revision despite one dissenting reviewer");
assert.equal(majorityClosed.revision.closure.items[0].status, "resolved", "the two-model closure consensus must be retained");
const unresolved = resolvedReview("review-b");
unresolved.result.content.revisionClosures[0].status = "unresolved";
unresolved.result.content.revisionClosures[0].remainingFix = "仍缺少明确选择";
const notClosed = aggregateCrossReview([resolvedReview("review-a"), partial, unresolved], contract);
assert.equal(notClosed.pass, false, "fewer than two resolved votes must keep the revision behind the review gate");
assert.equal(notClosed.revision.closure.items[0].status, "partial", "an unconfirmed closure must remain visible");

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
  { id: "deepseek-v4-pro", provider: "deepseek", configured: true },
];
const titleSets = [
  ["The Last Tenant", "Room Zero", "Borrowed Silence", "On Hold"],
  ["The Hollow Key", "Northbound", "Glass Witness", "After the Signal"],
];
const titleOutput = (index = 0) => ({
  candidates: titleSets[Math.min(index, titleSets.length - 1)].map((title, candidateIndex) => ({
    title_en: title,
    explanation_zh: `中文释义 ${candidateIndex + 1}`,
    style_zh: "国际流媒体",
    tone_zh: "克制而有悬念",
    naming_gene_zh: ["人物身份或关系", "地点或机构", "异常物件或意象", "双重含义极简短语"][candidateIndex],
    reason_zh: "承接主角进入禁区的故事 DNA，并适配英语市场封面传播。",
  })),
  selection_note_zh: "优先选择与核心异常意象绑定最紧的片名。",
});
assert.throws(
  () => validateContent("title", { ...titleOutput(), candidates: titleOutput().candidates.map((candidate, index) => index === 0 ? { ...candidate, title_en: "暗门" } : candidate) }, { mode: "tk_short_drama" }),
  (error) => error.code === "SCHEMA_INVALID",
  "Chinese formal titles must be rejected before persistence",
);
assert.throws(
  () => validateContent("title", { ...titleOutput(), candidates: titleOutput().candidates.map((candidate, index) => index === 0 ? { ...candidate, title_en: "Billionaire Revenge" } : candidate) }, { mode: "tk_short_drama" }),
  (error) => error.code === "SCHEMA_INVALID",
  "generic web-fiction title templates must be rejected before persistence",
);
const routedCalls = [];
let reviewModelSelections = 0;
let generatedTitleSets = 0;
const testRouter = {
  models: () => testModels,
  status: () => Object.fromEntries(["chatgpt", "claude", "deepseek"].map((provider) => [provider, { provider, configured: true }])),
  stageModels: (route) => [route.primary, route.reviewer, route.consistency],
  reviewModels: () => {
    reviewModelSelections += 1;
    return testModels.map(({ id: model, provider }) => ({ model, provider, configured: true }));
  },
  call: async ({ model, system, user, purpose }) => {
    const input = JSON.parse(user);
    routedCalls.push({ model, purpose, system, input });
    const output = /交叉审核 Agent/.test(system)
      ? reviewOutput(input.revisionClosureProtocol)
      : input.currentStage === "title"
        ? titleOutput(generatedTitleSets++)
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

runAgent.approve({ ...runParams, artifactId: revisionRun.artifacts[0].id });
routedCalls.length = 0;
reviewModelSelections = 0;
const titleParams = { ...runParams, stage: "title", mode: "tk_short_drama", input: { ...runParams.input, platform: "TikTok / TikTok Series", marketCountry: "united_states", audienceGender: "all" } };
const titleRun = await runAgent.run(titleParams);
assert.equal(titleRun.status, "completed", "title generation must complete without waiting for cross-review");
assert.equal(routedCalls.length, 1, "title generation must call exactly one assigned author model");
assert.equal(routedCalls[0].model, "gpt-5.6-terra", "title generation must use the configured orchestration model");
assert.equal(routedCalls[0].purpose, "pixeltale:title:author", "title generation must remain an author-only request");
assert.equal(reviewModelSelections, 0, "title generation must never select cross-review models");
assert.deepEqual(titleRun.reviewModels, [], "title run record must expose zero reviewers");
assert.deepEqual(titleRun.route, { primary: "gpt-5.6-terra" }, "title route must contain only the assigned author model");
assert.equal(titleRun.artifacts.length, 1, "title run must persist only the primary artifact");
assert.equal(titleRun.artifacts[0].status, "ready", "a valid title artifact must be ready for human selection");
assert.equal(titleRun.artifacts[0].reviewId, "", "title artifact must not reference a review artifact");
assert.equal(titleRun.artifacts[0].content.candidates.length, 4, "title contract must retain exactly four options");
assert.ok(titleRun.artifacts[0].content.candidates.every((candidate) => /^[^\u3400-\u9fff]*[A-Za-z][^\u3400-\u9fff]*$/u.test(candidate.title_en)), "all formal titles must be English and contain no Chinese characters");
assert.match(routedCalls[0].system, /剧本 DNA[\s\S]*目标受众和发行场景/, "title prompt must bind naming to story DNA and distribution attributes");
assert.deepEqual(routedCalls[0].input.excludedTitles, [], "the first title run must not invent an exclusion history");

routedCalls.length = 0;
const regeneratedTitleRun = await runAgent.run(titleParams);
assert.equal(regeneratedTitleRun.artifacts[0].version, 2, "regeneration must create a new title artifact version");
assert.equal(routedCalls.length, 1, "regeneration must still call only one model");
assert.deepEqual(routedCalls[0].input.excludedTitles.sort(), titleSets[0].slice().sort(), "regeneration must ask the model to avoid every previous candidate");
assert.equal(new Set(regeneratedTitleRun.artifacts[0].content.candidates.map((candidate) => candidate.title_en).filter((title) => titleSets[0].includes(title))).size, 0, "controlled regeneration must increase the available title choices");

const primaryFallback = await callStagePrimary({
  route: { primary: "gpt-5.6-terra", reviewer: "claude-opus-5", consistency: "deepseek-v4-pro" },
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

const timedCalls = [];
await assert.rejects(
  () => callStagePrimary({
    route: { primary: "gpt-5.6-terra", reviewer: "claude-opus-5", consistency: "deepseek-v4-pro" },
    system: "stage generation",
    user: "{}",
    totalTimeoutMs: 15_000,
    perModelTimeoutMs: 14_000,
    nowMs: () => 0,
    modelRouter: {
      stageModels: (route) => [route.primary, route.reviewer, route.consistency, "gpt-5.6-sol"],
      call: async ({ model, timeoutMs }) => {
        timedCalls.push({ model, timeoutMs });
        const error = new Error("upstream request timed out");
        error.code = "TIMEOUT";
        error.retryable = true;
        throw error;
      },
    },
  }),
  (error) => error.code === "STAGE_GENERATION_UNAVAILABLE" && error.fallbackFailures.length === 3,
  "the primary stage must fail only after every distinct race candidate fails",
);
assert.equal(timedCalls.length, 3, "the author race must start one request for each distinct model family");
assert.equal(new Set(timedCalls.map((item) => item.model)).size, 3, "the author race must never duplicate a model");
assert.ok(timedCalls.every((item) => item.timeoutMs === 14_000), "each concurrent author must receive the bounded timeout");
assert.match(agent, /STAGE_PRIMARY_BUDGET_MS = 80_000/, "production primary generation must fit inside one bounded race window");
assert.match(agent, /STAGE_PRIMARY_MODEL_TIMEOUT_MS = 70_000/, "a single author must have measured latency headroom without creating an eleven-minute retry chain");
assert.ok(
  Number(agent.match(/STAGE_PRIMARY_BUDGET_MS = ([\d_]+)/)[1].replace(/_/g, "")) <= 300_000,
  "the primary budget must stay inside the 300 second Nginx upstream window",
);
assert.match(agent, /modelRouter\.stageModels\(route\)\.slice\(0, 3\)/, "primary fallback must never walk the full writing roster sequentially");
assert.match(agent, /Promise\.any\(attempts\)/, "distinct author candidates must race instead of waiting serially");
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
