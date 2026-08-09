import assert from "node:assert/strict";
import { aggregateCrossReview, buildRevisionContract, callStagePrimary, isMandatoryReviewIssue, stageReviewPolicy } from "../server/pixeltale-agent.js";

const dimensions = Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 90, feedback: "通过" }]));

function review(model, { issues = [], revisionClosures = [], pass = true } = {}) {
  return {
    route: { seatId: model },
    result: {
      provider: "test",
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
assert.equal(scopedReview.outOfContractIssues.length, 1, "合同外共识必须保留为待决定事项");

const unresolved = { issueId: "brief-R-opening", status: "unresolved", evidence: "仍有争议", remainingFix: "需要创作者决定取舍" };
const stalled = aggregateCrossReview([review("review-a", { revisionClosures: [unresolved], pass: false }), review("review-b", { revisionClosures: [unresolved], pass: false })], contract);
assert.equal(stalled.automaticRevisionBlocked, true, "合同修订未收敛时必须停止再次自动改稿");
assert.equal(stalled.decisionRequiredIssues.length, 1, "未收敛合同必须转为需要决定");

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

assert.equal(scopedReview.decision.kind, "needs_decision", "合同外共识必须由统一裁判转为创作者决定，而非自动改稿");
assert.equal(stalled.decision.kind, "needs_decision", "未收敛合同必须由统一裁判转为创作者决定");

console.log("PixelTale review governance tests passed.");
