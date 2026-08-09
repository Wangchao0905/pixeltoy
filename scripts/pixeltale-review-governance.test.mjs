import assert from "node:assert/strict";
import { aggregateCrossReview, buildRevisionContract, callStagePrimary, isMandatoryReviewIssue, stageReviewPolicy } from "../server/pixeltale-agent.js";

const dimensions = Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 90, feedback: "通过" }]));

function review(model, { issues = [], revisionClosures = [], pass = true } = {}) {
  return {
    route: { seatId: model },
    result: {
      provider: model === "review-b" ? "claude" : "chatgpt",
      model,
      content: {
        pass,
        score: 90,
        findings: [],
        required_changes: [],
        issues,
        revisionClosures,
        dimensions,
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  };
}

const ownerOnly = { tag: "单席结构意见", dimension: "structure", severity: "high", modelCount: 1, ownerHighConfidence: true };
assert.equal(isMandatoryReviewIssue(ownerOnly), false, "单席维度意见不能单独阻断阶段");
assert.equal(aggregateCrossReview([review("review-a", { issues: [ownerOnly] })]).mandatoryIssueCount, 0, "单席高风险意见必须转为建议");

const fastPolicy = stageReviewPolicy("brief");
assert.equal(fastPolicy.requiredSeats, 1, "first-draft brief review must use one fast review seat");
assert.equal(stageReviewPolicy("arc").requiredSeats, 2, "episode architecture must retain two review seats");
assert.equal(stageReviewPolicy("brief", { revisionContract: { id: "revision" } }).requiredSeats, 2, "targeted revisions must restore two-seat confirmation");
const fastIssue = { tag: "快速审读硬问题", dimension: "structure", severity: "high", feedback: "开场承诺缺失", fix: "补足开场改变" };
assert.equal(aggregateCrossReview([review("review-a", { issues: [fastIssue], pass: false })], null, fastPolicy).decision.kind, "revise", "a single fast-review hard finding must still produce a bounded revision decision");

const shared = { tag: "两席共同问题", dimension: "plot", severity: "high", feedback: "缺少触发", fix: "补足触发", modelCount: 2 };
assert.equal(aggregateCrossReview([review("review-a", { issues: [shared], pass: false }), review("review-b", { issues: [shared], pass: false })]).mandatoryIssueCount, 1, "两席共同确认的高风险问题必须阻断阶段");

const contract = {
  id: "revision_1",
  stage: "brief",
  sourceArtifactId: "artifact_1",
  items: [{ id: "brief-R-opening", criterionId: "BRIEF_OPENING", tag: "开场冲击", dimension: "structure", severity: "high", modelCount: 2, evidence: [], requiredEdit: [], acceptance: "补足开场冲击" }],
};
const resolved = { issueId: "brief-R-opening", status: "resolved", evidence: "已补足", remainingFix: "" };
const outOfContract = { tag: "合同外新问题", dimension: "logic", severity: "high", feedback: "新的争议", fix: "人工决定" };
const scopedReview = aggregateCrossReview([review("review-a", { issues: [outOfContract], revisionClosures: [resolved] }), review("review-b", { issues: [outOfContract], revisionClosures: [resolved] })], contract);
assert.equal(scopedReview.mandatoryIssueCount, 0, "复审合同外的问题不能重新触发自动修订");
assert.equal(scopedReview.outOfContractIssues.length, 1, "合同外共识必须保留为参考事项");

const unresolved = { issueId: "brief-R-opening", status: "unresolved", evidence: "仍有争议", remainingFix: "补足开场触发" };
const stalled = aggregateCrossReview([review("review-a", { revisionClosures: [unresolved], pass: false }), review("review-b", { revisionClosures: [unresolved], pass: false })], contract);
assert.equal(stalled.automaticRevisionBlocked, false, "普通未关闭修订项应回到定向修订，而非强制人工放行");
assert.equal(stalled.retryRequiredIssues.length, 1, "普通未关闭修订项必须保留为可重跑清单");

const creativeUnresolved = { ...unresolved, requiresCreatorDecision: true, decisionOptions: ["保留倒叙开场", "改为当下时空开场"] };
const creativeStalled = aggregateCrossReview([review("review-a", { revisionClosures: [creativeUnresolved], pass: false }), review("review-b", { revisionClosures: [creativeUnresolved], pass: false })], contract);
assert.equal(creativeStalled.automaticRevisionBlocked, true, "只有双席明确标注的创作取舍才进入人工决定");
assert.equal(creativeStalled.decisionRequiredIssues.length, 1, "创作取舍必须携带可见的决定项");

const nextContract = buildRevisionContract({ revision: { contract, closure: { items: [{ ...contract.items[0], status: "unresolved", remainingFix: ["需要创作者决定取舍"] }] } } }, { stage: "brief", sourceArtifactId: "artifact_2", id: "revision_2" });
assert.equal(nextContract.items.length, 0, "未被本轮两席重新确认的旧问题不能无限继承为下一轮合同");

const authorCalls = [];
const authored = await callStagePrimary({
  route: { primary: "writer-a" },
  stage: "brief",
  system: "writer system",
  user: "writer task",
  modelRouter: { call: async (request) => {
    authorCalls.push(request);
    return { provider: "test", model: request.model, content: { title_zh: "测试" } };
  } },
});
assert.equal(authorCalls.length, 1, "每个阶段只能由一位主笔生成内容");
assert.equal(authored.primaryExecution.role, "主笔", "主笔执行记录必须明确内容责任人");

assert.equal(scopedReview.decision.kind, "approve", "合同外共识不能阻断已完成的修订合同");
assert.equal(stalled.decision.kind, "revise", "普通未关闭项应回到统一的定向修订路径");
assert.equal(creativeStalled.decision.kind, "needs_decision", "真正的创作取舍才由统一裁判转为创作者决定");

// ---- P1-1 关键维度最低线 ----
{
  // 低维度：任一关键维 <75 不得放行
  const lowDim = Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: key === "structure" ? 60 : 90, feedback: "x" }]));
  const lowReview = { ...review("review-a"), result: { ...review("review-a").result, content: { ...review("review-a").result.content, dimensions: lowDim } } };
  const lowReviewB = { ...review("review-b"), result: { ...review("review-b").result, content: { ...review("review-b").result.content, dimensions: lowDim } } };
  const lowDecision = aggregateCrossReview([lowReview, lowReviewB]).decision;
  assert.equal(lowDecision.kind, "revise", "关键维度低于 75 不得放行（两席平均仍低于门槛）");
  assert.ok(lowDecision.title.includes("维度"), "维度门槛给出明确标题");

  // 低加权质量：score 平均 <80 不得放行
  const lowScoreReview = { ...review("review-a"), result: { ...review("review-a").result, content: { ...review("review-a").result.content, score: 70 } } };
  const lowScoreReviewB = { ...review("review-b"), result: { ...review("review-b").result, content: { ...review("review-b").result.content, score: 70 } } };
  const lowScoreDecision = aggregateCrossReview([lowScoreReview, lowScoreReviewB]).decision;
  assert.equal(lowScoreDecision.kind, "revise", "加权质量低于 80 不得放行（两席平均仍低于门槛）");

  // 维度缺失不拦截（兼容旧输出）
  const missingDim = { ...review("review-a"), result: { ...review("review-a").result, content: { ...review("review-a").result.content, dimensions: {} } } };
  const missingDecision = aggregateCrossReview([missingDim, review("review-b")]).decision;
  assert.equal(missingDecision.kind, "approve", "缺失维度视为参考，不拦截");
}

console.log("PixelTale review governance tests passed.");
