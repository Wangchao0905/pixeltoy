// 请求级 fs 读缓存的正确性。
// 这个缓存拦在 fs 模块方法上,一旦出错影响全站每一个请求,所以每一条不变式都要有断言:
//   1. 没有请求上下文时必须完全穿透(启动期、子进程、定时任务、测试都走这条路)
//   2. 同一请求内重复读同一路径只花一次系统调用
//   3. "文件不存在"也要缓存(热路径上最常见的结果就是问可选文件在不在)
//   4. 缓存的值必须不可变或每次给副本,否则一个调用方改了会污染其他人
//   5. 写之后再读必须看到新内容
//   6. store 不能跨请求泄漏
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modPath = path.resolve(new URL("../server/fs-request-cache.js", import.meta.url).pathname);
const cache = require(modPath);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-req-cache-"));
const real = cache.install(fs);
cache.assertInstalled(fs);

let reads = 0;
let stats = 0;
let dirs = 0;
const realRead = real.readFileSync;
const realStat = real.statSync;
const realDir = real.readdirSync;
real.readFileSync = function (...a) { reads += 1; return realRead.apply(this, a); };
real.statSync = function (...a) { stats += 1; return realStat.apply(this, a); };
real.readdirSync = function (...a) { dirs += 1; return realDir.apply(this, a); };

function reset() { reads = 0; stats = 0; dirs = 0; }
const file = path.join(tmp, "a.json");
const missing = path.join(tmp, "nope.json");
fs.writeFileSync(file, '{"v":1}');

try {
  // 1. 没有 store:必须每次都真的读盘,行为与未安装时完全一致。
  reset();
  assert.equal(fs.readFileSync(file, "utf8"), '{"v":1}');
  assert.equal(fs.readFileSync(file, "utf8"), '{"v":1}');
  assert.equal(reads, 2, "无请求上下文时不得缓存,必须每次读盘");
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.existsSync(missing), false);
  console.log("  ✓ 无上下文穿透");

  // 2. 请求内:重复读同一路径只花一次系统调用,且值一致。
  cache.runInRequest(() => {
    reset();
    const a = fs.readFileSync(file, "utf8");
    const b = fs.readFileSync(file, "utf8");
    const c = fs.readFileSync(file, { encoding: "utf8" });
    assert.equal(reads, 1, "同一请求内重复读同一路径必须只读盘一次");
    assert.equal(a, b);
    assert.equal(a, c, "字符串编码与 {encoding} 形式必须共用同一缓存");
  });
  console.log("  ✓ 请求内重复读只花一次");

  // 3. 不存在的文件:抛出的错也要缓存,否则热路径上大量"问可选文件在不在"仍然每次走系统调用。
  cache.runInRequest(() => {
    reset();
    for (let i = 0; i < 5; i += 1) {
      assert.throws(() => fs.readFileSync(missing, "utf8"), /ENOENT/, "缺文件必须照常抛 ENOENT");
    }
    assert.equal(reads, 1, "重复读同一个不存在的文件必须只走一次系统调用");
  });
  console.log("  ✓ 缺文件的错也被缓存且照常抛出");

  // 4. existsSync 与 statSync 同源:先 exists 再 stat 这种最常见的两连问只花一次。
  cache.runInRequest(() => {
    reset();
    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.statSync(file).isFile(), true);
    assert.equal(fs.existsSync(file), true);
    assert.equal(stats, 1, "exists 与 stat 必须共用一份结果");
    assert.equal(fs.existsSync(missing), false);
    assert.equal(fs.existsSync(missing), false);
    assert.equal(stats, 2, "不存在的路径也只问一次");
  });
  console.log("  ✓ exists 与 stat 共用缓存");

  // 5. readdirSync 返回数组,是可变的。必须每次给副本,
  //    否则前一个调用方就地 sort/reverse 之后,后一个拿到的是被改过的顺序。
  fs.writeFileSync(path.join(tmp, "b.json"), "{}");
  cache.runInRequest(() => {
    reset();
    const first = fs.readdirSync(tmp);
    const original = [...first];
    first.reverse();
    first.push("污染");
    const second = fs.readdirSync(tmp);
    assert.equal(dirs, 1, "同一请求内重复列同一目录必须只读一次");
    assert.deepEqual(second, original, "缓存的目录数组必须每次给副本,不能被上一个调用方改到");
  });
  console.log("  ✓ readdir 返回副本,不被就地修改污染");

  // 6. 不带编码的读返回 Buffer,是可变对象,不能缓存同一个实例给多个调用方。
  cache.runInRequest(() => {
    reset();
    const b1 = fs.readFileSync(file);
    const b2 = fs.readFileSync(file);
    assert.ok(Buffer.isBuffer(b1), "不带编码必须返回 Buffer");
    assert.notEqual(b1, b2, "Buffer 可变,不得缓存同一实例");
    assert.equal(reads, 2, "Buffer 读不进缓存");
  });
  console.log("  ✓ Buffer 读不缓存");

  // 7. 同步写之后再读必须看到新内容 —— 这是缓存最容易出的那类事故。
  cache.runInRequest(() => {
    reset();
    assert.equal(fs.readFileSync(file, "utf8"), '{"v":1}');
    fs.writeFileSync(file, '{"v":2}');
    assert.equal(fs.readFileSync(file, "utf8"), '{"v":2}', "同步写之后必须读到新内容");
    // 写后缓存可以继续工作:再读一次不应该再走系统调用。
    const before = reads;
    fs.readFileSync(file, "utf8");
    assert.equal(reads, before, "同步写只清空缓存,之后应继续缓存");
  });
  console.log("  ✓ 同步写后读到新内容,且缓存继续生效");

  // 8. 异步写:落盘时机不受控,直接停用本请求剩余部分的缓存。
  //    只"清空"是不够的 —— 清空后的读会缓存写入前的旧内容,写落盘后同请求再读
  //    就拿到陈旧值,而没有缓存时不会有这个行为。
  await cache.runInRequest(async () => {
    reset();
    fs.readFileSync(file, "utf8");
    await fs.promises.writeFile(file, '{"v":3}');
    const before = reads;
    fs.readFileSync(file, "utf8");
    fs.readFileSync(file, "utf8");
    assert.equal(reads, before + 2, "异步写之后必须停用缓存,每次都重新读盘");
    assert.equal(fs.readFileSync(file, "utf8"), '{"v":3}');
  });
  console.log("  ✓ 异步写(promises)停用本请求缓存");

  // 8b. 回调式异步写走的是 fs 对象本身而不是 fs.promises,是另一条代码路径。
  //     变异验证发现:只测 fs.promises 的话,"同步侧的异步写只清不停用"这个变异
  //     能活下来 —— 两条路径必须各自有断言。
  await cache.runInRequest(async () => {
    reset();
    fs.readFileSync(file, "utf8");
    await new Promise((resolve, reject) => {
      fs.writeFile(file, '{"v":6}', (err) => (err ? reject(err) : resolve()));
    });
    const before = reads;
    fs.readFileSync(file, "utf8");
    fs.readFileSync(file, "utf8");
    assert.equal(reads, before + 2, "回调式异步写之后也必须停用缓存");
    assert.equal(fs.readFileSync(file, "utf8"), '{"v":6}');
  });
  console.log("  ✓ 异步写(回调式)停用本请求缓存");

  // 9. store 不得跨请求泄漏。第二个请求必须重新读盘,
  //    否则上一个请求的内容会被下一个请求当成当前状态,这是最难查的一类脏数据。
  //
  //    先断言 store 对象身份 —— 这条与测试顺序无关。
  //    只做下面的"行为"断言是不够的:变异验证发现,如果 store 被改成跨请求共享,
  //    上面第 8 条的异步写会把 disabled 永久置为 true,于是后续读全部穿透、
  //    值和读盘次数都"正确",行为断言反而被前一条测试掩盖过去了。
  let storeA = null;
  let storeB = null;
  cache.runInRequest(() => { storeA = cache.store(); });
  cache.runInRequest(() => { storeB = cache.store(); });
  assert.ok(storeA && storeB, "请求内必须能取到 store");
  assert.notEqual(storeA, storeB, "每个请求必须拿到独立的 store,不能跨请求共享");
  assert.notEqual(storeA.files, storeB.files, "两个请求的缓存 Map 必须是不同实例");
  assert.equal(cache.store(), null, "请求之外必须取不到 store(否则会缓存到请求边界之外)");

  fs.writeFileSync(file, '{"v":4}');
  cache.runInRequest(() => {
    reset();
    assert.equal(fs.readFileSync(file, "utf8"), '{"v":4}');
    assert.equal(reads, 1);
  });
  fs.writeFileSync(file, '{"v":5}');
  cache.runInRequest(() => {
    reset();
    assert.equal(fs.readFileSync(file, "utf8"), '{"v":5}', "上一个请求的缓存不得泄漏到下一个请求");
    assert.equal(reads, 1, "新请求必须重新读盘");
  });
  console.log("  ✓ store 不跨请求泄漏");

  // 10. 超过上限的正文照常返回但不进缓存,避免大文件把内存按住一整个请求。
  const big = path.join(tmp, "big.txt");
  fs.writeFileSync(big, "x".repeat(cache.MAX_CACHED_BYTES + 10));
  cache.runInRequest(() => {
    reset();
    const v1 = fs.readFileSync(big, "utf8");
    const v2 = fs.readFileSync(big, "utf8");
    assert.equal(v1.length, cache.MAX_CACHED_BYTES + 10, "超限文件必须照常完整返回");
    assert.equal(v1, v2);
    assert.equal(reads, 2, "超限正文不得进缓存");
  });
  console.log("  ✓ 超限正文不进缓存但照常返回");

  // 11. 未知方法必须当写操作处理。这条是防将来的:Node 新增一个会改盘的方法时,
  //     默认后果应该是"缓存被停用(慢)",不是"返回脏数据(错)"。
  assert.equal(cache.classify("readFileSync"), "read");
  assert.equal(cache.classify("writeFileSync"), "sync-write");
  assert.equal(cache.classify("createReadStream"), "neutral");
  assert.equal(cache.classify("someFutureNodeMethod"), "async-write", "未知方法必须按写操作处理");
  assert.equal(cache.classify("writeBigFileSomehowSync"), "async-write", "没登记的写方法也必须落到保守分支");
  console.log("  ✓ 未知方法按写操作保守处理");

  // 12. NEUTRAL 名单里不得混入写方法 —— 混进去等于该写不触发失效,静默返回脏数据。
  assert.doesNotThrow(() => cache.assertInstalled(fs));
  const polluted = [...cache.NEUTRAL_METHODS];
  assert.ok(!polluted.some((n) => /^(write|append|mkdir|rm|unlink|rename|copy|truncate|chmod|chown|symlink|link|utimes)/.test(n)),
    "NEUTRAL_METHODS 混入写方法会导致缓存返回脏数据");
  console.log("  ✓ NEUTRAL 名单无写方法");

  // 13. 生存期上限:长连请求(super-pixel 的 while (round < 5) 工具循环能跑几分钟)
  //     不能一直捧着几分钟前的文件快照。请求作用域本身管不住这个,必须有时限。
  const originalTtl = cache.config.ttlMs;
  try {
    cache.config.ttlMs = 15;
    fs.writeFileSync(file, '{"v":7}');
    await cache.runInRequest(async () => {
      reset();
      assert.equal(fs.readFileSync(file, "utf8"), '{"v":7}');
      assert.equal(reads, 1);
      fs.readFileSync(file, "utf8");
      assert.equal(reads, 1, "超时之前必须正常命中缓存");
      await new Promise((r) => setTimeout(r, 40));
      // 模拟"别的请求/后台任务改了盘":这个长连请求自己没写过,
      // 没有时限的话它会一直返回 {"v":7}。
      // 用未被包装的真身写盘 —— 走包装过的 fs.writeFileSync 会触发失效,
      // 那样这条测试就会因为"写触发了清空"而通过,验不到生存期本身。
      real.writeFileSync(file, '{"v":8}');
      assert.equal(fs.readFileSync(file, "utf8"), '{"v":8}', "超过生存期后必须读到盘上的新内容");
      const after = reads;
      fs.readFileSync(file, "utf8");
      assert.equal(reads, after + 1, "超龄后应停用缓存,不再命中");
    });
  } finally {
    cache.config.ttlMs = originalTtl;
  }
  console.log("  ✓ 超过生存期后停用缓存,不再返回陈旧快照");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("fs request cache tests passed");
