const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

process.env.ARK_ASSETS_ACCESS_KEY_ID = "test-ak";
process.env.ARK_ASSETS_SECRET_ACCESS_KEY = "test-sk";
process.env.ARK_VIRTUAL_PERSON_GROUP_ID = "group-test";
process.env.ARK_ASSETS_ENDPOINT = "https://ark-assets.test";
process.env.VOLC_ARK_API_KEY = "test-video-key";
process.env.VOLC_ARK_BASE_URL = "https://ark-video.test";

const originalFetch = global.fetch;
const originalSetTimeout = global.setTimeout;
let arkMode = "active";
let videoSubmitCalls = 0;
let arkCreateCalls = 0;
let arkGetCalls = 0;

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

global.fetch = async (url) => {
  const parsed = new URL(url);
  const action = parsed.searchParams.get("Action");
  if (action === "CreateAsset") {
    arkCreateCalls += 1;
    if (arkMode === "failed") return response({ Result: { Id: "ark-failed", Status: "Failed", Message: "verification rejected" } });
    if (arkMode === "processing") return response({ Result: { Id: "ark-processing", Status: "Processing" } });
    return response({ Result: { Id: "ark-active", Status: "Active" } });
  }
  if (action === "GetAsset") {
    arkGetCalls += 1;
    await new Promise((resolve) => originalSetTimeout(resolve, 80));
    return response({ Result: { Id: "ark-processing", Status: "Active" } });
  }
  if (parsed.pathname === "/contents/generations/tasks") {
    videoSubmitCalls += 1;
    return response({ id: `video-task-${videoSubmitCalls}`, status: "queued" });
  }
  throw new Error(`unexpected mock fetch: ${url}`);
};

// The production poll interval is eight seconds. Keep this test deterministic while
// preserving the await/yield behavior of the polling code.
global.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 8000 ? 0 : delay, ...args);

const { __test, prepareBatchVideoReferences } = require("../server.js");
const generateProjectVideoShot = __test.projectVideo.generateProjectVideoShot;

function createFixture(name) {
  const episodeRoot = fs.mkdtempSync(path.join(process.cwd(), ".tmp-project-video-ark-"));
  const config = {
    episodeRoot,
    modelName: "seedance-2-0-fast",
    runNamespace: `test_${name}`,
    isolationFingerprint: {
      projectRoot: episodeRoot,
      episodeSlug: path.basename(episodeRoot),
      scriptDigest: crypto.createHash("sha1").update("").digest("hex"),
    },
    assets: [{
      name: "C001_DYLAN_CHARACTER_SHEET",
      manifestType: "Character",
      aiGenerated: true,
      url: "https://assets.test/c001.png",
    }],
    shots: [{ name: "E01_V001", refs: ["C001_DYLAN_CHARACTER_SHEET"], prompt: "A character walks forward." }],
  };
  fs.writeFileSync(path.join(episodeRoot, "pipeline.json"), `${JSON.stringify(config, null, 2)}\n`);
  return { episodeRoot, configPath: path.join(episodeRoot, "pipeline.json") };
}

function readConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => originalSetTimeout(resolve, 5));
  }
  assert.fail("timed out waiting for background project video generation");
}

(async () => {
  try {
    // An unverified Ark-person reference is certified before the project video submit.
    {
      arkMode = "active";
      videoSubmitCalls = 0;
      arkCreateCalls = 0;
      const fixture = createFixture("active");
      try {
        const result = await generateProjectVideoShot(fixture.episodeRoot, { shotName: "E01_V001", pollInBackground: false });
        const saved = readConfig(fixture.configPath);
        const asset = saved.assets[0];
        assert.equal(arkCreateCalls, 1, "single-shot generation must trigger Ark certification");
        assert.equal(asset.arkPersonAsset.status, "active");
        assert.equal(asset.arkPersonAsset.assetUrl, "asset://ark-active");
        assert.equal(videoSubmitCalls, 1, "video submission must happen after certification");
        assert.equal(result.result.taskId, "video-task-1");
      } finally {
        fs.rmSync(fixture.episodeRoot, { recursive: true, force: true });
      }
    }

    // A failed certification remains queued and must never submit the raw reference.
    {
      arkMode = "failed";
      videoSubmitCalls = 0;
      arkCreateCalls = 0;
      const fixture = createFixture("failed");
      try {
        const result = await generateProjectVideoShot(fixture.episodeRoot, { shotName: "E01_V001", pollInBackground: false });
        const saved = readConfig(fixture.configPath);
        assert.equal(arkCreateCalls, 1, "failed certification must still be attempted");
        assert.equal(saved.assets[0].arkPersonAsset.status, "failed");
        assert.equal(videoSubmitCalls, 0, "failed certification must block video submission");
        assert.equal(result.waitingForAssets, true);
        assert.equal(result.result.status, "queued");
        const snapshot = JSON.parse(fs.readFileSync(path.join(fixture.episodeRoot, "08_video_task_nodes", "E01_V001.json"), "utf8"));
        assert.equal(snapshot.data.taskInfo.status, 0, "failed certification must leave the shot waiting");
      } finally {
        fs.rmSync(fixture.episodeRoot, { recursive: true, force: true });
      }
    }

    // HTTP-style invocation returns before certification polling finishes.
    {
      arkMode = "processing";
      videoSubmitCalls = 0;
      arkCreateCalls = 0;
      arkGetCalls = 0;
      const fixture = createFixture("background");
      try {
        const started = Date.now();
        const accepted = await generateProjectVideoShot(fixture.episodeRoot, { shotName: "E01_V001" });
        assert.ok(Date.now() - started < 50, "HTTP-style single-shot generation must not wait for Ark polling");
        assert.equal(accepted.waitingForAssets, true);
        await waitFor(() => {
          const saved = readConfig(fixture.configPath);
          return saved.assets[0].arkPersonAsset?.status === "active" && videoSubmitCalls === 1;
        });
        assert.ok(arkGetCalls >= 1, "background path must poll Ark status");
      } finally {
        fs.rmSync(fixture.episodeRoot, { recursive: true, force: true });
      }
    }

    // Batch preparation keeps the same Ark-person behavior through the shared helper.
    {
      arkMode = "active";
      videoSubmitCalls = 0;
      arkCreateCalls = 0;
      const fixture = createFixture("batch");
      try {
        const record = { file: fixture.configPath, data: readConfig(fixture.configPath) };
        const prepared = await prepareBatchVideoReferences(fixture.episodeRoot, record, record.data.shots, { timeoutMs: 1 });
        assert.equal(prepared.ready, true);
        assert.equal(arkCreateCalls, 1, "batch preparation must retain Ark certification");
        assert.equal(record.data.assets[0].arkPersonAsset.status, "active");
        assert.equal(videoSubmitCalls, 0, "reference preparation must not submit video");
      } finally {
        fs.rmSync(fixture.episodeRoot, { recursive: true, force: true });
      }
    }
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
  console.log("project video Ark-person certification tests passed.");
})().catch((error) => {
  global.fetch = originalFetch;
  global.setTimeout = originalSetTimeout;
  throw error;
});
