import assert from "node:assert/strict";
import { callStageCouncil, createPixelTaleAgent, contentHash, isRetryableReviewFailure, mergeStageBatchContent, validateContent } from "../server/pixeltale-agent.js";

const models = [
  { id: "gpt-5.6-terra", provider: "chatgpt" },
  { id: "gpt-5.6-sol", provider: "chatgpt" },
  { id: "gpt-5.6-luna", provider: "chatgpt" },
  { id: "gpt-5.5", provider: "chatgpt" },
  { id: "gemini-3.1-pro", provider: "gemini" },
  { id: "claude-opus-5", provider: "claude" },
  { id: "claude-sonnet-5", provider: "claude" },
  { id: "claude-haiku-4-5", provider: "claude" },
];

function reviewOutput({ pass = true, closureItems = [] } = {}) {
  return {
    pass,
    score: pass ? 92 : 54,
    findings: pass ? [] : ["第一个未通过批次存在因果断裂"],
    required_changes: pass ? [] : ["补足该批次的因果结果"],
    issues: pass ? [] : [{ criterion_id: "ARC_CAUSAL_PROGRESS", tag: "批次因果断裂", dimension: "logic", severity: "high", feedback: "本批次的选择没有产生明确结果", fix: "补足选择、结果与下一集动力" }],
    revision_closures: closureItems.map((item) => ({ issue_id: item.id, status: "resolved", evidence: "已补足目标集的选择、结果和下一集动力", remaining_fix: "" })),
    dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: pass ? 92 : 54, feedback: pass ? "通过" : "需要修订" }])),
    checks: { cross_validation: true, consistency: pass, adversarial: true, structure: true, mode: true, continuity: true, dialogue: true, localization: true },
  };
}

function arcUnit(number, suffix = "") {
  return {
    number,
    title_zh: `第${number}集${suffix}`,
    promise_zh: "主角必须作出选择",
    plot_zh: `${suffix || "原始"}第${number}集：主角发现新的证据，主动选择追查，冲突升级并产生明确结果。`,
    impact_zh: "开头即暴击",
    causal_turn_zh: "选择改变局面",
    reversal_zh: "证据被重新解释",
    hook_zh: "集尾出现新的危险",
    cliffhanger_question_zh: "主角能否活着揭开下一层真相？",
    payoff_zh: "兑现前一集留下的线索",
    episode_goal_zh: "拿到下一条证据",
    opposition_zh: "追捕者封锁出口",
    active_choice_zh: "主角主动闯入禁区",
    choice_cost_zh: "暴露自己的位置",
    audience_tension_zh: "观众知道追捕者已到门外，却不知道主角能否拿到证据",
    character_engine_refs: ["C001"],
    character_drive_zh: "主角为了救家人，必须继续追查证据",
    character_choice_basis_zh: "他害怕暴露身份，却选择闯入禁区",
  };
}

function scene(number) {
  return {
    id: `S${String(number).padStart(3, "0")}`,
    unit_number: number,
    purpose_zh: "推进冲突",
    time_zh: "夜",
    location_zh: "公寓",
    characters: ["C001"],
    action_zh: "主角带走证据并触发追捕",
    conflict_zh: "追捕者逼近",
    choice_zh: "主角选择逃入后门",
    result_zh: "安全路线被锁死",
    turn_zh: "主角从逃亡转为追查",
  };
}

assert.equal(
  isRetryableReviewFailure({ technicalFailures: [{ status: "failed", failureReason: "timeout" }] }),
  true,
  "a technical review interruption must reuse the generated artifact on retry",
);
assert.equal(
  isRetryableReviewFailure({ technicalFailures: [{ status: "rule_blocked" }] }),
  false,
  "a rule finding must return to revision instead of reusing the same artifact",
);

function baseState({ episodeCount = 10 } = {}) {
  const stages = ["brief", "title", "proposal", "characters"];
  const artifacts = stages.map((stage) => ({ id: `approved-${stage}`, type: `pixeltale_${stage}`, stage, version: 1, status: "approved", content: {} }));
  return {
    projectId: "episode-isolation-test",
    mode: "tk_short_drama",
    stage: "arc",
    input: { idea: "主角为救家人闯入禁区", episodeCount, episodeScale: `${episodeCount} episodes`, marketCountry: "united_states" },
    artifacts,
    approvedArtifactIds: artifacts.map((artifact) => artifact.id),
  };
}

function makeRouter({ failBatch = false, omitSummary = false, failAuthorScopeAbove = 0 } = {}) {
  const calls = [];
  let failReviewsRemaining = failBatch ? 2 : 0;
  const router = {
    calls,
    models: () => models,
    status: () => Object.fromEntries(["chatgpt", "claude"].map((provider) => [provider, { provider, configured: true }])),
    stageModels: (route) => [route.primary, route.reviewer, route.consistency],
    reviewModels: () => [
      { seatId: "seat_a", model: "gpt-5.6-terra", provider: "chatgpt", configured: true, fallbackModels: [] },
      { seatId: "seat_c", model: "claude-opus-5", provider: "claude", configured: true, fallbackModels: [] },
    ],
    call: async ({ model, system, user, purpose }) => {
    const payload = JSON.parse(user);
    calls.push({ model, system, purpose, payload });
      if (/交叉审核 Agent/.test(system)) {
      const shouldFail = payload.unitScope?.includes(6) && failReviewsRemaining > 0;
        if (shouldFail) {
          failReviewsRemaining -= 1;
          const error = new Error("模拟审核模型超时");
          error.code = "TIMEOUT";
          error.retryable = true;
          throw error;
        }
        return { provider: models.find((entry) => entry.id === model)?.provider || "chatgpt", model, content: reviewOutput({ pass: !shouldFail, closureItems: payload.revisionClosureProtocol?.items || [] }), attempts: 0 };
      }
      if (purpose.endsWith(":synthesis")) {
        const contribution = payload.creativeCouncil?.contributions?.[0]?.content || {};
        return {
          provider: models.find((entry) => entry.id === model)?.provider || "chatgpt",
          model,
          content: contribution,
          attempts: 0,
        };
      }
      const scope = payload.unitScope || [];
      if (failAuthorScopeAbove > 0 && scope.length > failAuthorScopeAbove) {
        const error = new Error(`模拟模型超时：${scope.length} 集批次过大`);
        error.code = "TIMEOUT";
        error.retryable = true;
        throw error;
      }
      return {
        provider: models.find((entry) => entry.id === model)?.provider || "chatgpt",
        model,
        content: {
          units: scope.map((number) => arcUnit(number, payload.userRevisionDirection ? "修订" : "")),
          ...(omitSummary ? {} : { arc_summary_zh: "完整连续推进" }),
        },
        attempts: 0,
      };
    },
  };
  return router;
}

function makeAgent(router, store) {
  let uuid = 0;
  return createPixelTaleAgent({
    modelRouter: router,
    readPixelTaleState: (root) => store.get(root) || {},
    writePixelTaleState: (root, state) => store.set(root, structuredClone(state)),
    randomUUID: () => `${String(++uuid).padStart(12, "0")}-1234-1234-1234-123456789abc`,
  });
}

function uniqueAuthorScopes(calls) {
  const seen = new Set();
  return calls
    .map((call) => call.payload.unitScope || [])
    .filter((scope) => {
      const key = JSON.stringify(scope);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const store = new Map([["batch-e2e", baseState()]]);
const router = makeRouter();
const agent = makeAgent(router, store);
const params = { pixelTaleRoot: "batch-e2e", projectId: "episode-isolation-test", stage: "arc", mode: "tk_short_drama", input: baseState().input };
const firstRun = await agent.run(params);
assert.equal(firstRun.status, "completed");
const authorPayloads = router.calls.filter((call) => call.purpose === "pixeltale:arc:author");
assert.deepEqual(uniqueAuthorScopes(authorPayloads), [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]], "arc must be generated in isolated batches");
for (const scope of uniqueAuthorScopes(authorPayloads)) {
  const modelsForScope = new Set(authorPayloads.filter((call) => JSON.stringify(call.payload.unitScope || []) === JSON.stringify(scope)).map((call) => call.model));
  assert.equal(modelsForScope.size, 1, "every isolated batch must have one accountable primary writer");
  const reviewCalls = router.calls.filter((call) => call.purpose === "pixeltale:arc:review" && JSON.stringify(call.payload.unitScope || []) === JSON.stringify(scope));
  assert.equal(reviewCalls.length, 2, "episode batches must retain dual review despite the fast first-draft policy");
}
assert.ok(authorPayloads.every((call) => !call.payload.approvedContext.some((item) => item.stage === "arc" && item.content?.units?.length > 5)), "a batch must not receive the full season as approved context");
assert.ok(authorPayloads.find((call) => call.payload.unitScope.includes(6)).payload.lockedUnitContext.every((item) => !item.plot_zh && !item.content), "locked episodes must be represented only by compressed continuity state");

let state = store.get("batch-e2e");
assert.deepEqual(state.stageProgress.arc.lockedUnits, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.deepEqual(state.stageProgress.arc.pendingUnits, []);
const fullArtifact = state.artifacts.filter((artifact) => artifact.type === "pixeltale_arc").at(-1);
assert.equal(fullArtifact.content.units.length, 10, "batch results must merge into a complete arc artifact");
const lockedHashes = Object.fromEntries(Object.entries(state.unitLocks.arc).map(([number, lock]) => [number, lock.contentHash]));

const noOp = await agent.run(params);
assert.equal(noOp.noOp, true, "repeated submission after all episodes are locked must not call a model");
assert.equal(router.calls.filter((call) => call.purpose === "pixeltale:arc:author").length, authorPayloads.length);

state.artifacts.find((artifact) => artifact.id === fullArtifact.reviewId).content = {
  ...state.artifacts.find((artifact) => artifact.id === fullArtifact.reviewId).content,
  commonIssues: [{ criterionId: "ARC_CAUSAL_PROGRESS", tag: "批次因果断裂", dimension: "logic", severity: "high", modelCount: 2, models: ["review-a", "review-b"], suggestions: ["补足选择和结果"], evidence: ["第7集选择没有后果"] }],
};
store.set("batch-e2e", state);
const beforeTargeted = router.calls.length;
const targeted = await agent.run({ ...params, revisionPlan: "只修订第7集的因果结果", unitNumbers: [7] });
assert.equal(targeted.status, "completed");
const targetedCalls = router.calls.slice(beforeTargeted).filter((call) => call.purpose === "pixeltale:arc:author");
assert.deepEqual(uniqueAuthorScopes(targetedCalls), [[7]], "single-episode revision must submit only the selected episode");
assert.equal(targetedCalls[0].payload.sourceArtifact.content.units.length, 1, "single-episode revision must not include the full arc source body");
state = store.get("batch-e2e");
for (const [number, hash] of Object.entries(lockedHashes)) if (number !== "7") assert.equal(state.unitLocks.arc[number].contentHash, hash, `episode ${number} lock must remain unchanged`);

const sceneSource = { scenes: [scene(1)], consistency_notes: [] };
const sceneState = { unitLocks: { scenes: { 1: { status: "locked", unitNumber: 1, contentHash: contentHash([scene(1)]) } } } };
const mergedScenes = mergeStageBatchContent("scenes", sceneSource, { scenes: [{ ...scene(2), id: "S001" }] }, { unitNumbers: [2], state: sceneState });
assert.deepEqual(mergedScenes.scenes.map((item) => item.unit_number), [1, 2], "scene batches must merge by unit number");
assert.notEqual(mergedScenes.scenes[0].id, mergedScenes.scenes[1].id, "scene ids must remain globally unique after batch merge");
assert.throws(() => validateContent("arc", { units: [arcUnit(1)], arc_summary_zh: "x" }, { episodeCount: 10, unitScope: [1], lockedUnitNumbers: [1] }), /已锁定/);

const retryStore = new Map([["retry-e2e", baseState()]]);
const retryRouter = makeRouter({ failBatch: true });
const retryAgent = makeAgent(retryRouter, retryStore);
const retryParams = { ...params, pixelTaleRoot: "retry-e2e" };
const recovered = await retryAgent.run(retryParams);
assert.equal(recovered.status, "completed", "a review failure must recover inside the same user-triggered run");
const firstAttemptAuthors = retryRouter.calls.filter((call) => call.purpose === "pixeltale:arc:author");
assert.deepEqual(uniqueAuthorScopes(firstAttemptAuthors), [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]]);
assert.deepEqual(retryStore.get("retry-e2e").stageProgress.arc.lockedUnits, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

const continueStore = new Map([["continue-e2e", baseState({ episodeCount: 15 })]]);
const continueRouter = makeRouter({ failBatch: true });
const continueAgent = makeAgent(continueRouter, continueStore);
const continueParams = { ...params, pixelTaleRoot: "continue-e2e", input: baseState({ episodeCount: 15 }).input };
const continued = await continueAgent.run(continueParams);
assert.equal(continued.status, "completed", "later batches and the failed batch must all recover in one run");
assert.deepEqual(uniqueAuthorScopes(continueRouter.calls.filter((call) => call.purpose === "pixeltale:arc:author")), [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]], "later batches must continue after a review failure");
let continueState = continueStore.get("continue-e2e");
assert.deepEqual(continueState.stageProgress.arc.lockedUnits, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
assert.deepEqual(continueState.stageProgress.arc.pendingUnits, []);

const summaryStore = new Map([["summary-e2e", baseState({ episodeCount: 5 })]]);
const summaryAgent = makeAgent(makeRouter({ omitSummary: true }), summaryStore);
const summaryRun = await summaryAgent.run({ ...params, pixelTaleRoot: "summary-e2e", input: baseState({ episodeCount: 5 }).input });
assert.equal(summaryRun.status, "completed", "missing arc summary must not invalidate complete unit content");
const summaryArtifact = summaryStore.get("summary-e2e").artifacts.filter((artifact) => artifact.type === "pixeltale_arc").at(-1);
assert.match(summaryArtifact.content.arc_summary_zh, /本季故事围绕核心冲突/);

const primaryAttempts = [];
let primaryFailures = 0;
let logicalNow = 0;
const primaryRetry = await callStageCouncil({
  route: { primary: models[0].id },
  stage: "arc",
  system: "system",
  user: "user",
  modelRouter: {
    stageModels: () => models.map((model) => model.id),
    fallbackModelFor: (model) => model === models[0].id ? "grok-4.5" : "",
    call: async ({ model, timeoutMs }) => {
      primaryAttempts.push({ model, timeoutMs });
      if (primaryFailures++ < 1) {
        const error = new Error("模拟上游超时");
        error.code = "TIMEOUT";
        error.retryable = true;
        throw error;
      }
      return { provider: model === "grok-4.5" ? "grok" : "chatgpt", model, content: { units: [arcUnit(1)], arc_summary_zh: "ok" }, attempts: 0 };
    },
  },
  nowMs: () => logicalNow,
});
assert.equal(primaryRetry.creativeCouncil.completedModels, 3, "a failed author must recover only through its own retry");
assert.equal(primaryAttempts.length, 5, "three authors plus one same-role retry and one synthesis call must stay bounded");
assert.ok(primaryAttempts.every((attempt) => attempt.timeoutMs <= 300_000), "primary budget must stay bounded for every concurrent candidate");

const splitStore = new Map([["split-e2e", baseState({ episodeCount: 5 })]]);
const splitRouter = makeRouter({ failAuthorScopeAbove: 2 });
const splitAgent = makeAgent(splitRouter, splitStore);
const splitRun = await splitAgent.run({ ...params, pixelTaleRoot: "split-e2e", input: baseState({ episodeCount: 5 }).input });
assert.equal(splitRun.status, "completed", "an oversized failed batch must be split and completed in the same run");
assert.deepEqual(splitStore.get("split-e2e").stageProgress.arc.lockedUnits, [1, 2, 3, 4, 5]);

const legacyStore = new Map([["legacy-e2e", {
  projectId: "legacy-e2e",
  stage: "arc",
  input: { episodeCount: 2 },
  artifacts: [{ id: "legacy-arc", type: "pixeltale_arc", stage: "arc", version: 1, status: "approved", content: { units: [arcUnit(1), arcUnit(2)], arc_summary_zh: "legacy" } }],
  approvedArtifactIds: ["legacy-arc"],
}]]);
const migrated = makeAgent(makeRouter(), legacyStore).status({ pixelTaleRoot: "legacy-e2e", projectId: "legacy-e2e" });
assert.deepEqual(migrated.stageProgress.arc.lockedUnits, [1, 2], "legacy approved full artifacts must migrate into episode locks");
assert.equal(migrated.unitLocks.arc[1].artifactId, "legacy-arc");

console.log("pixeltale episode isolation contract ok");
