import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

process.env.ASSET_ANALYZER_API_KEY ||= "sk-test-asset-analyzer-000000000000";
process.env.STORYBOARD_API_KEY ||= "sk-test-storyboard-0000000000000000";
process.env.XAI_API_KEY ||= "sk-test-grok-00000000000000000000000";
process.env.DEEPSEEK_API_KEY ||= "sk-test-deepseek-0000000000000000000";

const require = createRequire(import.meta.url);
const server = require("../server.js");
const { pixelTaleApi, pixelTaleRuns } = server.__test;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltale-run-job-"));
const recoveryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltale-run-recovery-"));

const dimensions = Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 95, feedback: "通过" }]));
const requestedTokenBudgets = [];
const requestedPurposes = [];
pixelTaleApi.setFetch(async (_url, options) => {
  const request = JSON.parse(options.body);
  requestedTokenBudgets.push(request.max_tokens);
  const review = /交叉审核 Agent/.test(request.messages[0].content);
  const synthesis = /合并编排器/.test(request.messages[0].content);
  requestedPurposes.push(review ? "review" : synthesis ? "synthesis" : "author");
  const content = review
    ? {
      pass: true,
      score: 95,
      findings: [],
      required_changes: [],
      issues: [],
      dimensions,
      checks: { cross_validation: true, consistency: true, adversarial: true },
    }
    : {
      title_zh: "雾镇回声",
      logline_zh: "失忆警探必须在陌生小镇重建自己的身份。",
      core_conflict_zh: "追查真相会摧毁他刚建立的生活。",
      viewer_question_zh: "他究竟是警探还是被追捕的人？",
      episode_promise_zh: "每集揭开一条身份线索并制造新的解释。",
      mode_rules: ["前三秒异常", "集尾强钩子"],
    };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

const params = {
  pixelTaleRoot: root,
  projectId: "standalone:test-run-job",
  project: { id: "story-forge", title: "测试", episode: "SESSION" },
  stage: "brief",
  mode: "tk_short_drama",
  input: { idea: "失忆警探在神秘小镇追查自己的身份" },
};

try {
  const first = pixelTaleRuns.start(params);
  const duplicate = pixelTaleRuns.start(params);
  assert.equal(duplicate.jobId, first.jobId, "the same stage must reuse its in-flight job");
  assert.equal(duplicate.reused, true, "the duplicate response must disclose idempotent reuse");

  let job;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    job = pixelTaleRuns.get(params, first.jobId);
    if (job.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(job.status, "completed", `background run must complete: ${JSON.stringify(job)}`);
  assert.equal(job.result.status, "completed", "three completed reviews must release the generated brief");
  assert.equal(job.result.state.runs.length, 1, "duplicate starts must not create duplicate Agent runs");
  assert.equal(requestedPurposes.filter((purpose) => purpose === "author").length, 3, "all three configured author models must contribute");
  assert.equal(requestedPurposes.filter((purpose) => purpose === "synthesis").length, 1, "the merged draft must be created only after the author council completes");
  assert.equal(requestedPurposes.filter((purpose) => purpose === "review").length, 3, "all three review seats must complete before release");
  assert.equal(requestedTokenBudgets.length, 7, "three authors, one merge pass, and three reviewers must stay bounded");
  assert.equal(requestedTokenBudgets.filter((budget, index) => requestedPurposes[index] === "review" && budget === 1_200).length, 3, "reviewers must retain the compact review token budget");
  assert.ok(fs.existsSync(path.join(root, "run-jobs", `${first.jobId}.json`)), "run status must be persisted beside the story session");
  const persistedJob = JSON.parse(fs.readFileSync(path.join(root, "run-jobs", `${first.jobId}.json`), "utf8"));
  assert.deepEqual(persistedJob.request, {
    pixelTaleRoot: root,
    projectId: params.projectId,
    project: params.project,
    stage: params.stage,
    mode: params.mode,
    input: params.input,
  }, "persisted run jobs must retain only the safe request needed for restart recovery");
  assert.equal(Object.hasOwn(persistedJob.request, "apiKey"), false, "persisted run jobs must never include provider credentials");

  const recoveryJobId = "ptrun_0123456789abcdef0123456789";
  const recoveryParams = { ...params, pixelTaleRoot: recoveryRoot, projectId: "standalone:recovery-run" };
  fs.mkdirSync(path.join(recoveryRoot, "run-jobs"), { recursive: true });
  fs.writeFileSync(path.join(recoveryRoot, "run-jobs", `${recoveryJobId}.json`), JSON.stringify({
    jobId: recoveryJobId,
    status: "running",
    stage: "brief",
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    request: {
      ...recoveryParams,
      project: recoveryParams.project,
    },
  }));
  const recovered = pixelTaleRuns.get(recoveryParams, recoveryJobId);
  assert.equal(recovered.status, "running", "a persisted running job must resume after a process restart");
  assert.equal(recovered.recovered, true, "restart recovery must be visible to the polling client");
  let recoveryResult;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    recoveryResult = pixelTaleRuns.get(recoveryParams, recoveryJobId);
    if (recoveryResult.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(recoveryResult.status, "completed", `recovered background run must complete: ${JSON.stringify(recoveryResult)}`);

  const seeded = pixelTaleRuns.start(recoveryParams);
  let seededResult;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    seededResult = pixelTaleRuns.get(recoveryParams, seeded.jobId);
    if (seededResult.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(seededResult.status, "completed", "the recovery reuse fixture must have a completed Agent run");
  const requestsBeforeReuse = requestedTokenBudgets.length;
  const completedButMarkedRunningId = "ptrun_abcdef0123456789abcdef0123456789";
  fs.writeFileSync(path.join(recoveryRoot, "run-jobs", `${completedButMarkedRunningId}.json`), JSON.stringify({
    jobId: completedButMarkedRunningId,
    status: "running",
    stage: "brief",
    runId: seededResult.result.runId,
    createdAt: Date.parse(seededResult.result.startedAt),
    updatedAt: Date.now(),
    request: { ...recoveryParams, project: recoveryParams.project },
  }));
  const reusedCompleted = pixelTaleRuns.get(recoveryParams, completedButMarkedRunningId);
  assert.equal(reusedCompleted.status, "completed", "a completed Agent result must be reused after an index-only restart");
  assert.equal(reusedCompleted.recovered, true, "reused completed results must disclose restart recovery");
  assert.equal(requestedTokenBudgets.length, requestsBeforeReuse, "reusing a completed Agent result must not call any model again");
  // ── 启动扫描：上一进程遗留的 running 任务必须被标记为中断 ──
  const staleRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pixeltale-stale-")), ".pixel-tale-sessions");
  const staleSession = path.join(staleRoot, "sess-stale");
  const staleJobsDir = path.join(staleSession, "run-jobs");
  fs.mkdirSync(staleJobsDir, { recursive: true });
  fs.writeFileSync(path.join(staleJobsDir, "ptrun_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json"), JSON.stringify({ jobId: "ptrun_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", status: "running", stage: "characters", createdAt: 1000, updatedAt: 1000 }));
  fs.writeFileSync(path.join(staleJobsDir, "ptrun_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json"), JSON.stringify({ jobId: "ptrun_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", status: "completed", stage: "title", createdAt: 1000, updatedAt: 1000 }));
  fs.writeFileSync(path.join(staleJobsDir, "not-a-job.json"), JSON.stringify({ status: "running" }));
  const markedCount = pixelTaleRuns.markStaleInterrupted(staleRoot);
  assert.equal(markedCount, 1, "exactly one stale running job must be marked interrupted");
  const markedJob = JSON.parse(fs.readFileSync(path.join(staleJobsDir, "ptrun_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json"), "utf8"));
  assert.equal(markedJob.status, "failed", "stale running job must be flipped to failed");
  assert.equal(markedJob.errorCode, "RUN_INTERRUPTED", "stale running job must carry RUN_INTERRUPTED");
  const untouchedJob = JSON.parse(fs.readFileSync(path.join(staleJobsDir, "ptrun_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json"), "utf8"));
  assert.equal(untouchedJob.status, "completed", "non-running jobs must be left untouched");
  fs.rmSync(path.dirname(staleRoot), { recursive: true, force: true });
} finally {
  pixelTaleApi.setFetch();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(recoveryRoot, { recursive: true, force: true });
}

console.log("pixeltale run jobs ok");
