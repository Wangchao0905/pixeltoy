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
const { superPixel, pixelTaleRuns } = server.__test;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixeltale-run-job-"));

const dimensions = Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 95, feedback: "通过" }]));
const requestedTokenBudgets = [];
superPixel.setFetch(async (_url, options) => {
  const request = JSON.parse(options.body);
  requestedTokenBudgets.push(request.max_tokens);
  const review = /交叉审核 Agent/.test(request.messages[0].content);
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
  assert.equal(job.result.status, "completed", "two-review quorum must release the generated brief");
  assert.equal(job.result.state.runs.length, 1, "duplicate starts must not create duplicate Agent runs");
  assert.equal(requestedTokenBudgets[0], 1_800, "brief authoring must use the brief-sized output budget");
  assert.deepEqual(requestedTokenBudgets.slice(1).sort((a, b) => a - b), [1_200, 1_200, 1_200], "brief reviewers must use the compact brief review budget");
  assert.ok(fs.existsSync(path.join(root, "run-jobs", `${first.jobId}.json`)), "run status must be persisted beside the story session");
} finally {
  superPixel.setFetch();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("pixeltale run jobs ok");
