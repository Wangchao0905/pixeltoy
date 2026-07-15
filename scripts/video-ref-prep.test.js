const assert = require("node:assert");
const {
  runWithConcurrency,
  referenceTrackForName,
  collectReferencedAssetNames,
  classifyReferenceAssets,
  evaluateReferenceReadiness,
} = require("./video-ref-prep.js");

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
