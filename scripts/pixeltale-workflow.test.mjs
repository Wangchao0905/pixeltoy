import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const nestedHtml = fs.readFileSync(path.join(root, "public/pixeltale/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/pixeltale/styles.css"), "utf8");
const agent = fs.readFileSync(path.join(root, "server/pixeltale-agent.js"), "utf8");
const { createPixelTaleAgent, callStagePrimary, aggregateCrossReview, buildRevisionContract, mergeRevisionContent, reviewAdvisoryGate, validateContent, validateReview } = await import(pathToFileURL(path.join(root, "server/pixeltale-agent.js")).href);

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
assert.match(app, /agentTaskCopy"\)\.textContent = state\.lastError \|\| action\.copy/, "run errors must remain visible in the right-rail next action");
assert.match(app, /agentTaskCopy"\)\.setAttribute\("role", state\.lastError \? "alert"/, "run errors must be announced from the right-rail next action");
assert.match(app, /function renderBriefArtifact\(\)/, "brief output must show its generated artifact and review state");
assert.match(app, /const inspirationPool = \[/, "brief stage must expose the current Story DNA taxonomy");
assert.match(app, /const dnaAudienceRecommendations = \{/, "Story DNA must retain audience-based recommendations");
assert.match(app, /function startDnaMotion\(field\)/, "Story DNA must have a canvas motion controller");
assert.match(app, /function toggleDnaWindow\(open\)/, "Story DNA must have an explicit expand/collapse interaction");
assert.match(app, /data-dna-toggle/, "Story DNA must expose a visible launch control");
assert.match(app, /id=\"dnaWindow\" class=\"dna-window\" hidden/, "Story DNA field must start collapsed");
assert.match(app, /data-dna-canvas/, "Story DNA must render its particle field on canvas");
assert.match(app, /data-dna-filter/, "Story DNA must expose category filters");
assert.match(app, /data-dna-tag/, "Story DNA tags must remain selectable");
assert.match(app, /const DNA_FRAME_INTERVAL_MS = 1000 \/ 24/, "Story DNA animation must cap its draw rate");
assert.match(app, /const DNA_MAX_DPR = 1\.25/, "Story DNA canvas must cap its backing resolution");
assert.match(app, /document\.hidden/, "Story DNA animation must pause when the document is hidden");
assert.match(app, /IntersectionObserver/, "Story DNA animation must pause outside the viewport");
assert.match(app, /审核未通过，需要处理必修项[\s\S]*唯一下一步位于右侧/, "brief review failures must explain how to continue");
assert.match(app, /参考意见与模型状态[\s\S]*不阻断确认/, "single-model opinions must be visibly separated from mandatory revisions");
assert.match(app, /kind: "auto-revise"[\s\S]*执行定向修订并复审/, "review flow must expose one canonical revision action");
assert.match(app, /REQUIRED WORKLIST[\s\S]*仅处理此处/, "mandatory revisions must be presented as one canonical worklist");
assert.match(app, /pendingClosures\.length \? pendingClosures : mandatoryIssues/, "an open revision contract must be the only source for mandatory work items");
assert.match(app, /review-reference-panel/, "optional review material must be collapsible");
assert.doesNotMatch(app, /review-auto-fix/, "review panel must not expose a duplicate revision button");
assert.match(html, /id="agentTaskAction"/, "the right rail must contain the canonical next-step action slot");
assert.match(app, /function renderAgentTaskAction\(action\)/, "the right rail must render the current workflow action");
assert.match(app, /function bindAgentTaskAction\(\)/, "the right rail action must have a dedicated event binding");
assert.match(app, /const productionStageTotal = stageOrder\.length - 1/, "progress must use the seven confirmable production stages");
assert.match(app, /function productionProgressLabel\(stage = workflowStage\(\)\)/, "all progress surfaces must share one stage counter");
assert.match(app, /\$\("#flowStepCounter"\)\.textContent = productionProgressLabel\(flowStage\)/, "right-rail progress must use the shared counter");
assert.match(app, /当前阶段 \$\{productionProgressLabel\(workflowStage\(\)\)\}/, "central progress must use the shared counter");
assert.match(html, /<span>当前阶段<\/span><span id="flowStepCounter">01 \/ 07<\/span>/, "right rail must label its seven-stage progress consistently");
assert.match(html, /id="approvedCount">0 \/ 7/, "left rail must keep the seven-stage confirmation denominator");
assert.doesNotMatch(html, /class="agent-context"/, "the right rail must not show a passive context module");
assert.doesNotMatch(html, /id="contextChips"|id="editContext"/, "passive context chips and their dead edit action must be removed");
assert.doesNotMatch(nestedHtml, /class="agent-context"|id="contextChips"|id="editContext"/, "the nested PixelTale page must not retain the passive context module");
assert.doesNotMatch(app, /contextChips|editContext/, "the app must not render or bind the removed passive context module");
assert.doesNotMatch(app, /renderNextStep/, "the central workspace must not render a duplicate next-step card");
assert.doesNotMatch(app, /review-button-action/, "artifact cards must not expose a second confirmation entry");
assert.match(app, /const fieldLabelMap = \{[\s\S]*title_zh: "剧名"/, "structured fields must have Chinese display labels");
assert.match(app, /data-regenerate-title/, "title selection must expose a regenerate action before approval");
assert.match(app, /生成 4 个剧名候选[\s\S]*重新生成 4 个/, "title UI must expose exactly four title choices");
assert.match(app, /中文释义只供创作者对照，不会写入后续正式标题/, "title UI must distinguish the English release title from its Chinese explanation");
assert.match(app, /data-flow-action="approve"[\s\S]*data-approve-artifact/, "the right rail must expose a clickable artifact confirmation action");
assert.match(app, /单模型生成完成 · 等待人工选择[\s\S]*不进入交叉审核/, "title UI must explain its single-model no-review policy");
assert.match(agent, /正式发行片名必须使用自然英文/, "title generation must follow the release language instead of returning Chinese names");
assert.match(agent, /人物身份或关系、地点或机构、异常物件或意象、带双重含义的极简短语/, "title generation must enforce four distinct naming genes");
assert.match(agent, /Billionaire、CEO、Mafia、Reborn、Revenge/, "title generation must reject generic web-fiction naming templates");
assert.match(app, /fieldLabel\(key\)/, "nested structured fields must use the display label map");
assert.match(styles, /\.app-shell \{ height: 100vh; height: 100dvh;[\s\S]*overflow: hidden; \}/, "desktop shell must stay within the viewport");
assert.match(styles, /\.stage-content \{ width: min\(1180px,/, "wide screens must use the central workspace");
assert.match(styles, /\.inspiration-pool \{[\s\S]*height: 360px;/, "inspiration pool must not push the workflow down");
assert.match(app, /function renderReviewPanel\(reviewContent = \{\}, \{ passed/, "review output must expose a complete issue panel");
assert.match(app, /可选优化建议[\s\S]*不阻断确认/, "low-risk consensus recommendations must be visibly non-blocking");
assert.match(app, /审核超时\/失败/, "review cards must expose actual model failure state");
assert.match(app, /执行定向修订并复审/, "review output must offer one canonical revision action");
assert.match(app, /revisionPlan/, "automatic revision must pass a scoped revision plan");
assert.match(app, /revision-progress/, "revision output must expose closure progress");
assert.match(app, /data-advisory-decision/, "advisory feedback must expose creator decision actions");
assert.match(app, /const reviewConflictGuidance =/, "score conflicts must have deterministic review guidance");
assert.match(app, /审核建议[\s\S]*核对指引[\s\S]*决策规则/, "advisory cards must explain what to check and how to decide");
assert.match(app, /guidance\.title/, "advisory cards must display the dimension-specific guidance title");
assert.match(app, /data-advisory-requires-reason/, "conflict decisions must expose their required rationale state");
assert.match(styles, /\.review-advisory-guidance \{/, "advisory guidance must have a distinct readable panel");
assert.match(agent, /mergeRevisionContent\(stage, primary\.content, revisionBase\?\.content\)/, "revision output must preserve omitted stage fields from the source artifact");
assert.match(styles, /\.review-issue-list \{[\s\S]*max-height: 420px;/, "review issues must stay readable in a bounded panel");
assert.match(styles, /\.dna-field \{[\s\S]*height: 420px;/, "Story DNA must reserve a stable spherical field");
assert.match(styles, /\.dna-field canvas \{/, "Story DNA must layer a particle canvas");
assert.match(styles, /\.dna-field \{[\s\S]*contain: layout paint;/, "Story DNA field must contain its paint work");
assert.match(styles, /\.dna-core \{[\s\S]*border-radius: 50%[\s\S]*pointer-events: none;/, "Story DNA must have a spherical thought core");
assert.doesNotMatch(styles, /\.dna-tag \{[\s\S]*will-change:\s*transform/, "Story DNA tags must not force 56 persistent compositor layers");
assert.match(styles, /@keyframes dna-launcher-drift/, "Story DNA launcher must have visible motion");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.dna-launcher-orb/, "Story DNA must respect reduced-motion preferences");
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
assert.ok(aggregated.independentIssues.some((item) => item.tag === "审核模型补充意见" && item.models.includes("review-a")), "unstructured reviewer changes must retain their source model");
assert.ok(!aggregated.required_changes.some((item) => item.includes("节奏偏弱")), "a single-model opinion must remain advisory until independently confirmed");
assert.ok(aggregated.required_changes.some((item) => item.includes("人物动机不足")), "two-model agreement must become a mandatory change");
assert.equal(aggregated.mandatoryIssueCount, 1, "only high-severity two-model issues must block confirmation");

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
const acceptedAdvisoryContract = buildRevisionContract({
  commonIssues: [],
  reviewIssues: [],
  independentIssues: [{ id: "advisory_issue_character_motivation", tag: "人物动机不足", dimension: "plot", severity: "high", modelCount: 1, models: ["review-a"], suggestions: ["补足触发事件与代价"], evidence: ["主角没有明确选择原因"] }],
  advisoryDecisions: [{ id: "advisory_issue_character_motivation", status: "accepted", reason: "采纳，必须补出选择代价" }],
}, { stage: "characters", sourceArtifactId: "artifact_v5", id: "revision_test_5" });
assert.equal(acceptedAdvisoryContract.items.length, 1, "a creator-accepted advisory must become a revision contract item");
assert.equal(acceptedAdvisoryContract.items[0].modelCount, 1, "accepted advisory must retain its original model count");

const sourceCharacters = {
  characters: [{ id: "C001", name_zh: "Alex", desire_zh: "查明真相" }],
  relationships: [{ from: "C001", to: "C002", dynamic_zh: "互相利用" }],
  world_rules: ["所有记忆证据必须有可追溯来源"],
};
const partialCharacters = mergeRevisionContent("characters", { characters: [{ id: "C001", name_zh: "Alex", desire_zh: "复仇" }] }, sourceCharacters);
assert.deepEqual(partialCharacters.relationships, sourceCharacters.relationships, "partial character revisions must preserve relationships");
assert.deepEqual(partialCharacters.world_rules, sourceCharacters.world_rules, "partial character revisions must preserve world rules");
assert.doesNotThrow(() => validateContent("characters", partialCharacters), "merged character revisions must satisfy the stage schema");
const sourceArc = { unit: "episode_or_chapter", units: [{ number: 1, title_zh: "开场" }], arc_summary_zh: "原始分集总纲" };
const partialArc = mergeRevisionContent("arc", { units: [{ number: 1, title_zh: "修订后的开场" }] }, sourceArc);
assert.equal(partialArc.arc_summary_zh, sourceArc.arc_summary_zh, "partial arc revisions must preserve arc_summary_zh");
assert.doesNotThrow(() => validateContent("arc", partialArc), "merged arc revisions must satisfy the stage schema");
const emptyCharacters = mergeRevisionContent("characters", { characters: sourceCharacters.characters, relationships: [], world_rules: [] }, sourceCharacters);
assert.deepEqual(emptyCharacters.relationships, sourceCharacters.relationships, "empty relationship revisions must preserve the source relationship contract");
assert.deepEqual(emptyCharacters.world_rules, sourceCharacters.world_rules, "empty world-rule revisions must preserve the source world contract");
const sourceScenes = {
  scenes: [
    { id: "S001", location_zh: "公寓", action_zh: "原始动作", props: [{ id: "PR01", name_zh: "警徽", appearance: "旧外观" }], shot_plan: [{ shot_id: "SH001", description_zh: "原始镜头" }, { shot_id: "SH002", description_zh: "第二镜头" }] },
    { id: "S002", location_zh: "医院", action_zh: "第二场原始动作", props: [{ id: "PR02", name_zh: "分诊单" }], shot_plan: [{ shot_id: "SH003", description_zh: "第三镜头" }] },
  ],
};
const partialScenes = mergeRevisionContent("scenes", {
  scenes: [{ id: "S001", action_zh: "修订后的动作", props: [{ id: "PR01", appearance: "修订后的外观" }], shot_plan: [{ shot_id: "SH001", description_zh: "修订后的镜头" }] }],
}, sourceScenes);
assert.equal(partialScenes.scenes.length, 2, "scene revisions must preserve omitted source scenes");
assert.equal(partialScenes.scenes[0].action_zh, "修订后的动作", "scene revisions must apply the changed scene field");
assert.equal(partialScenes.scenes[0].props[0].appearance, "修订后的外观", "scene revisions must apply the changed prop field");
assert.equal(partialScenes.scenes[0].props[0].name_zh, "警徽", "scene revisions must preserve omitted prop fields");
assert.equal(partialScenes.scenes[0].shot_plan.length, 2, "scene revisions must preserve omitted shots");
assert.equal(partialScenes.scenes[1].shot_plan[0].description_zh, "第三镜头", "scene revisions must preserve omitted scene content");

const advisoryGate = reviewAdvisoryGate({
  independentIssues: [{ id: "advisory_issue_high", tag: "高影响逻辑问题", dimension: "logic", severity: "high" }],
  conflicts: [{ id: "advisory_conflict_structure", dimension: "structure", agreement: 50 }],
});
assert.equal(advisoryGate.blockingPending.length, 0, "model score disagreements and independent advice must not block confirmation");
const explicitHumanGate = reviewAdvisoryGate({
  conflicts: [{ id: "advisory_conflict_logic", dimension: "logic", agreement: 40 }],
  advisoryDecisions: [{ id: "advisory_conflict_logic", status: "needs_human_review" }],
});
assert.equal(explicitHumanGate.blockingPending.length, 1, "only an explicit human-review exception may block confirmation");
const duplicateLegacyAdvisories = reviewAdvisoryGate({
  independentIssues: [
    { tag: "审核修订项", severity: "medium" },
    { tag: "审核修订项", severity: "medium" },
  ],
  advisoryDecisions: [{ id: "advisory_issue_审核修订项", status: "accepted" }],
});
assert.deepEqual(duplicateLegacyAdvisories.items.map((item) => item.id), ["advisory_issue_审核修订项", "advisory_issue_审核修订项_2"], "legacy advisory IDs must remain stable while duplicate generated IDs become unique");
assert.equal(duplicateLegacyAdvisories.accepted.length, 1, "a legacy decision must apply only to the first duplicate advisory");
const recommendationOnly = aggregateCrossReview([
  { result: { provider: "chatgpt", model: "review-a", content: { pass: false, score: 82, findings: [], required_changes: [], issues: [{ tag: "节奏优化", dimension: "structure", severity: "medium", feedback: "可进一步压缩", fix: "压缩中段重复信息" }], dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 82, feedback: "可优化" }])), checks: { adversarial: true } } } },
  { result: { provider: "deepseek", model: "review-b", content: { pass: false, score: 80, findings: [], required_changes: [], issues: [{ tag: "节奏优化", dimension: "structure", severity: "medium", feedback: "中段略松", fix: "压缩重复信息" }], dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 80, feedback: "可优化" }])), checks: { adversarial: true } } } },
  { route: "claude-sonnet-5", model: "claude-sonnet-5", error: "upstream timeout" },
]);
assert.equal(recommendationOnly.pass, true, "medium-severity consensus recommendations must not block confirmation");
assert.equal(recommendationOnly.mandatoryIssueCount, 0, "recommendation-only review must have no mandatory blockers");
assert.equal(recommendationOnly.recommendedIssueCount, 1, "recommendation-only review must retain the recommendation count");
const staleConsensusContract = buildRevisionContract({
  commonIssues: [{ tag: "旧单模型问题", modelCount: 1, severity: "high", suggestions: ["不得执行"] }],
  reviewIssues: [{ tag: "真实共识问题", modelCount: 2, severity: "high", suggestions: ["按两个模型的共同证据修订"] }],
}, { stage: "brief", sourceArtifactId: "artifact_v4", id: "revision_test_4" });
assert.deepEqual(staleConsensusContract.items.map((item) => item.tag), ["真实共识问题"], "legacy commonIssues must still obey the two-model quorum");
const mediumConsensusContract = buildRevisionContract({
  commonIssues: [{ tag: "节奏优化", modelCount: 2, severity: "medium", suggestions: ["压缩重复信息"] }],
  reviewIssues: [{ tag: "节奏优化", modelCount: 2, severity: "medium", suggestions: ["压缩重复信息"] }],
}, { stage: "brief", sourceArtifactId: "artifact_v6", id: "revision_test_6" });
assert.equal(mediumConsensusContract.items.length, 0, "medium consensus recommendations must not enter the mandatory revision contract");
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
  ["Night Index", "Dead Air", "The Counterfeit Room", "Last Exit"],
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
stateStore.set("advisory-e2e", {
  projectId: "advisory-e2e",
  stage: "brief",
  artifacts: [
    { id: "artifact_advisory", type: "pixeltale_brief", stage: "brief", version: 1, status: "ready", reviewId: "review_advisory", content: { title_zh: "测试", logline_zh: "测试", core_conflict_zh: "测试", viewer_question_zh: "测试" } },
    { id: "review_advisory", type: "pixeltale_stage_review", stage: "brief", version: 1, status: "passed", content: { pass: true, independentIssues: [{ id: "advisory_issue_high", tag: "高影响逻辑问题", dimension: "logic", severity: "high", modelCount: 1, models: ["review-a"], suggestions: ["补足因果"], evidence: ["行动缺少触发"] }], conflicts: [], advisoryDecisions: [] } },
  ],
  approvedArtifactIds: [],
});
const advisoryDecisionResult = runAgent.decideAdvisory({ pixelTaleRoot: "advisory-e2e", projectId: "advisory-e2e", reviewId: "review_advisory", advisoryId: "advisory_issue_high", status: "accepted" });
assert.equal(advisoryDecisionResult.review.content.advisoryDecisions[0].status, "accepted", "creator advisory decisions must persist on the review artifact");
assert.equal(advisoryDecisionResult.state.artifacts.find((artifact) => artifact.id === "artifact_advisory").status, "needs_review", "accepting an advisory must reopen its source artifact for revision");
assert.throws(
  () => runAgent.approve({ pixelTaleRoot: "advisory-e2e", projectId: "advisory-e2e", artifactId: "artifact_advisory" }),
  (error) => error.code === "ADVISORY_REVISION_REQUIRED",
  "an accepted advisory must prevent direct artifact approval",
);
stateStore.set("advisory-priority-e2e", {
  projectId: "advisory-priority-e2e",
  stage: "brief",
  artifacts: [
    { id: "artifact_priority", type: "pixeltale_brief", stage: "brief", version: 1, status: "ready", reviewId: "review_priority", content: { title_zh: "测试", logline_zh: "测试", core_conflict_zh: "测试", viewer_question_zh: "测试" } },
    { id: "review_priority", type: "pixeltale_stage_review", stage: "brief", version: 1, status: "passed", content: {
      pass: true,
      independentIssues: [{ id: "advisory_priority_accepted", tag: "已采纳修订", severity: "medium" }],
      conflicts: [{ id: "advisory_priority_pending", dimension: "logic", agreement: 40 }],
      advisoryDecisions: [
        { id: "advisory_priority_accepted", status: "accepted" },
        { id: "advisory_priority_pending", status: "needs_human_review" },
      ],
    } },
  ],
  approvedArtifactIds: [],
});
assert.throws(
  () => runAgent.approve({ pixelTaleRoot: "advisory-priority-e2e", projectId: "advisory-priority-e2e", artifactId: "artifact_priority" }),
  (error) => error.code === "ADVISORY_DECISION_REQUIRED",
  "an explicit human-review decision must take priority over an accepted advisory",
);
const runParams = { pixelTaleRoot: "revision-e2e", projectId: "revision-e2e", project: { id: "revision-e2e", title: "Revision E2E", episode: "DRAFT" }, stage: "brief", input: { idea: "主角为救家人闯入禁区" } };
const initialRun = await runAgent.run(runParams);
assert.equal(initialRun.status, "needs_review", "initial review must retain a failed source version");
const revisionRun = await runAgent.run({ ...runParams, revisionPlan: "按全部审核问题修订" });
assert.equal(revisionRun.status, "completed", `revision must run as a distinct, reviewable version: ${JSON.stringify(revisionRun.errors)}`);
assert.equal(revisionRun.revision.allResolved, true, "the run record must prove all revision contract items were closed");
const finalReview = revisionRun.state.artifacts.find((artifact) => artifact.id === revisionRun.artifacts[1].id);
assert.equal(finalReview.content.revision.closure.allResolved, true, "the persisted review must retain item-by-item closure evidence");

runAgent.approve({ ...runParams, artifactId: revisionRun.artifacts[0].id });
const staleState = stateStore.get("revision-e2e");
staleState.stage = "brief";
stateStore.set("revision-e2e", staleState);
routedCalls.length = 0;
reviewModelSelections = 0;
const titleParams = { ...runParams, stage: "title", mode: "tk_short_drama", input: { ...runParams.input, platform: "TikTok / TikTok Series", marketCountry: "united_states", audienceGender: "all" } };
const titleRun = await runAgent.run(titleParams);
assert.equal(titleRun.status, "completed", "title generation must complete without waiting for cross-review");
assert.equal(titleRun.state.stage, "title", "a run must keep the requested editor stage even when the stored session stage is stale");
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

runAgent.approve({ ...titleParams, artifactId: regeneratedTitleRun.artifacts[0].id, selectedTitle: titleSets[1][0] });
const rerunAfterTitleApproval = await runAgent.run(titleParams);
assert.equal(rerunAfterTitleApproval.artifacts[0].version, 3, "a rerun after approval must create a new title version");
assert.doesNotThrow(() => runAgent.approve({ ...titleParams, artifactId: rerunAfterTitleApproval.artifacts[0].id, selectedTitle: titleSets[2][0] }), "the latest rerun must remain the stage that requires confirmation");

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
assert.match(agent, /characters: \{ total: 240_000, model: 210_000 \}/, "characters and world generation needs a longer bounded model window");
assert.match(agent, /arc: \{ total: 300_000, model: 270_000 \}/, "long-form arc generation needs a bounded long-stage window");
assert.match(agent, /const REVIEW_MODEL_TIMEOUT_MS = 120_000/, "review calls must have enough time for structured feedback");
assert.ok(
  Number(agent.match(/characters: \{ total: ([\d_]+), model: ([\d_]+) \}/)[1].replace(/_/g, "")) <= 300_000,
  "the longest primary budget must stay bounded for background job recovery",
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
