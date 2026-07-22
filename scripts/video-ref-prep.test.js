const assert = require("node:assert");
const {
  runWithConcurrency,
  runWithDependencies,
  referenceTrackForName,
  collectReferencedAssetNames,
  classifyReferenceAssets,
  evaluateReferenceReadiness,
} = require("./video-ref-prep.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareBatchVideoReferences, __test } = require("../server.js");

assert.equal(referenceTrackForName("C001_EVELYN_CHARACTER_SHEET"), "person");
assert.equal(referenceTrackForName("SB003_E01_V003_PRODUCTION_BOARD"), "person");
assert.equal(referenceTrackForName("S002_宴会厅_WIDE_ESTABLISHING"), "public");
assert.equal(referenceTrackForName("P002_HALE_PROP_REF"), "public");
assert.equal(referenceTrackForName("I001_x_INSERT_REF"), "public");
assert.equal(referenceTrackForName("未知名字"), "public");

const shots = [
  { refs: ["S002_宴会厅_WIDE_ESTABLISHING", "C001_EVELYN_CHARACTER_SHEET"], storyboardRefs: ["SB001_E01_V001_PRODUCTION_BOARD"] },
  { refs: ["S002_宴会厅_WIDE_ESTABLISHING"], storyboardRefs: ["SB002_E01_V002_PRODUCTION_BOARD"] },
];
const names = collectReferencedAssetNames(shots);
assert.equal(names.length, 4, "S002 应去重");

const { personTrack, publicTrack } = classifyReferenceAssets(names);
assert.deepEqual(
  personTrack.slice().sort(),
  ["C001_EVELYN_CHARACTER_SHEET", "SB001_E01_V001_PRODUCTION_BOARD", "SB002_E01_V002_PRODUCTION_BOARD"].sort(),
);
assert.deepEqual(publicTrack, ["S002_宴会厅_WIDE_ESTABLISHING"]);

const ok = evaluateReferenceReadiness([
  { name: "C001", track: "person", status: "active", assetUrl: "asset://a" },
  { name: "S002", track: "public", publicUrl: "https://x/y.png" },
]);
assert.equal(ok.ready, true);
assert.equal(ok.stuck.length, 0);

const bad = evaluateReferenceReadiness([
  { name: "C001", track: "person", status: "pending", assetUrl: "" },
  { name: "S002", track: "public", publicUrl: "" },
]);
assert.equal(bad.ready, false);
assert.equal(bad.stuck.length, 2);
assert.equal(bad.stuck[0].track, "person");

// public 轨只认 https,http:// 不放行
const httpOnly = evaluateReferenceReadiness([{ name: "S002", track: "public", publicUrl: "http://x/y.png" }]);
assert.equal(httpOnly.ready, false, "http:// 公网地址不应判为就绪");

// 批量入口不能把缺失参考图当成 ready,否则后续 payload 会静默丢图。
(async () => {
  const episodeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-video-ref-"));
  const configFile = path.join(episodeRoot, "video-config.json");
  const configRecord = {
    file: configFile,
    data: {
      modelName: "seedance-2-0-fast",
      assets: [],
      shots: [{ name: "E01_V001", refs: ["P003_MISSING_PROP_REF"] }],
    },
  };
  try {
    assert.throws(
      () => __test.videoReferences.assertVideoConfigAssetsReady(configRecord.data, null, episodeRoot),
      /参考图验证失败.*P003_MISSING_PROP_REF/,
      "批量入口的同步门禁必须拒绝缺失引用图",
    );
    const prepared = await prepareBatchVideoReferences(episodeRoot, configRecord, configRecord.data.shots, { timeoutMs: 1 });
    assert.equal(prepared.ready, false, "缺少参考图时批量预检必须阻止提交");
    assert.deepEqual(prepared.stuck.map((item) => item.name), ["P003_MISSING_PROP_REF"]);
  } finally {
    fs.rmSync(episodeRoot, { recursive: true, force: true });
  }
})();

console.log("video-ref-prep tests passed.");

// 并发池:最多 limit 并发、全部处理、结果按序
(async () => {
  let inFlight = 0, maxSeen = 0;
  const worker = async (x) => { inFlight++; maxSeen = Math.max(maxSeen, inFlight); await new Promise(r=>setTimeout(r,5)); inFlight--; return x*2; };
  const res = await runWithConcurrency([1,2,3,4,5,6,7], 3, worker);
  assert.deepEqual(res, [2,4,6,8,10,12,14], "结果需按序");
  assert.ok(maxSeen <= 3, "并发不超过 limit,实际="+maxSeen);
  assert.ok(maxSeen >= 2, "应确有并发");
  const empty = await runWithConcurrency([], 3, worker);
  assert.deepEqual(empty, [], "空输入");
  console.log("runWithConcurrency tests passed.");
})();

// 依赖感知调度器:尾帧链按序、独立段并发、源失败只挡下游
(async () => {
  const key = (s) => s.name;

  // 1) 尾帧链严格按序:B 依赖 A、C 依赖 B,启动顺序必须 A<B<C,且下游在上游完成后才启动。
  {
    const startedAt = {};
    const finishedAt = {};
    let tick = 0;
    const items = [
      { name: "A", dep: "" },
      { name: "B", dep: "A" },
      { name: "C", dep: "B" },
    ];
    const worker = async (s) => {
      startedAt[s.name] = tick++;
      await new Promise((r) => setTimeout(r, 5));
      finishedAt[s.name] = tick++;
      return { shotName: s.name };
    };
    await runWithDependencies(items, 4, worker, { keyOf: key, depOf: (s) => s.dep });
    assert.ok(startedAt.B > finishedAt.A, "B 必须在 A 完成后才启动");
    assert.ok(startedAt.C > finishedAt.B, "C 必须在 B 完成后才启动");
  }

  // 2) 独立段并发:7 段独立 + 一条3段链(与真实 EP1 同形态),独立段应并发(maxSeen>1),链仍按序。
  {
    let inFlight = 0, maxSeen = 0;
    const done = [];
    const items = [
      { name: "V1", dep: "" }, { name: "V2", dep: "" }, { name: "V3", dep: "" },
      { name: "V4", dep: "V3" }, { name: "V5", dep: "V4" }, { name: "V6", dep: "V5" },
      { name: "V7", dep: "" }, { name: "V8", dep: "" }, { name: "V9", dep: "" }, { name: "V10", dep: "" },
    ];
    const worker = async (s) => {
      inFlight += 1; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 4));
      inFlight -= 1; done.push(s.name);
      return { shotName: s.name };
    };
    await runWithDependencies(items, 6, worker, { keyOf: key, depOf: (s) => s.dep });
    assert.ok(maxSeen >= 2, "独立段应并发,实际 maxSeen=" + maxSeen);
    assert.ok(maxSeen <= 6, "并发不超过 limit");
    assert.ok(done.indexOf("V4") < done.indexOf("V5") && done.indexOf("V5") < done.indexOf("V6"), "尾帧链需按序完成");
    assert.equal(done.length, 10, "全部片段都应处理");
  }

  // 3) 源失败只阻塞其下游链,独立段照常;onBlocked 被调用。
  {
    const ran = [];
    const blocked = [];
    const items = [
      { name: "A", dep: "" },          // 失败源
      { name: "B", dep: "A" },          // A 的下游 -> 应被阻塞
      { name: "C", dep: "B" },          // 间接下游 -> 也应被阻塞
      { name: "X", dep: "" },           // 独立 -> 照常
    ];
    const worker = async (s) => {
      ran.push(s.name);
      if (s.name === "A") return { shotName: "A", failed: true, error: "boom" };
      return { shotName: s.name };
    };
    const res = await runWithDependencies(items, 4, worker, {
      keyOf: key,
      depOf: (s) => s.dep,
      onBlocked: (s, depKey) => { blocked.push(s.name); return { shotName: s.name, failed: true, blocked: true, dependency: depKey }; },
    });
    assert.ok(ran.includes("A") && ran.includes("X"), "失败源与独立段都应被执行");
    assert.ok(!ran.includes("B") && !ran.includes("C"), "失败源的下游不得被提交");
    assert.deepEqual(blocked.slice().sort(), ["B", "C"], "B、C 应被 onBlocked 阻塞");
    assert.equal(res[3].shotName, "X", "结果按原序返回");
  }

  // 4) 空输入
  assert.deepEqual(await runWithDependencies([], 3, async () => ({})), []);
  console.log("runWithDependencies tests passed.");
})();
