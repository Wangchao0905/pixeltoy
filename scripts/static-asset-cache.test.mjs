// 静态资源必须可缓存，且缓存必须随文件内容失效。
//
// 病史（2026-08-01）：整站刷新和点击切换都卡。serveStatic 给所有静态资源发
// Cache-Control: no-store，于是 app.js(510KB) + styles.css(521KB) + canvas.js(272KB)
// 等约 1.5MB 每次刷新全量重下；而且每个请求都 readFileSync 一次，同步读盘堆在
// 事件循环上，直接排在用户点击前面。URL 上明明已经带了 ?v= 版本戳，缓存是免费的。
//
// 这里守三件事：
//   1. 带 ?v= 的资源发 immutable，不带的发 no-cache（不能退回 no-store）；
//   2. 内存缓存的失效凭证必须跟文件走（mtime+size），不能是 TTL —— 否则改了文件
//      要等一会儿才生效，这个项目已经在「忘 bump ?v=」上栽过，不能再引入第二种
//      「改了没生效」的窗口；
//   3. ETag 必须按内容算，不能按 mtime —— 部署是 rsync 覆盖，mtime 变而内容常常没变。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

function sliceBetween(source, startSig, endSig) {
  const start = source.indexOf(startSig);
  assert.notEqual(start, -1, `missing: ${startSig}`);
  const end = source.indexOf(endSig, start);
  assert.ok(end > start, `missing end anchor for ${startSig}`);
  return source.slice(start, end);
}

// ---------- 静态检查：绝不能退回 no-store ----------
const fn = sliceBetween(server, "const staticFileCache = new Map();", "\nfunction contentDispositionName(");
assert.doesNotMatch(
  fn,
  /"Cache-Control": "no-store"/,
  "静态资源不得发 no-store —— 这会让 1.5MB 首屏资源每次刷新全量重下",
);
assert.match(fn, /max-age=31536000, immutable/, "带 ?v= 的资源必须发 immutable");
assert.match(fn, /ETag/, "必须发 ETag 以支持 304");
// 失效凭证必须含 mtime 和 size 两者：只看 mtime 会漏掉同秒内的改动，
// 只看 size 会漏掉等长改动。
assert.match(fn, /stat\.mtimeMs/, "缓存失效凭证必须含 mtimeMs");
assert.match(fn, /stat\.size/, "缓存失效凭证必须含 size");
// ETag 必须来自内容，不是 mtime。
const etagLine = fn.split("\n").find((line) => line.includes("etag:"));
assert.ok(etagLine, "找不到 etag 计算行");
assert.match(etagLine, /update\(body\)/, "ETag 必须按文件内容算，不能按 mtime");

// 制作台入口与 app.js/styles.css 使用版本戳 + immutable（服务器对带 ?v= 的资源发
// max-age=31536000）。双戳必须同步，否则旧脚本会配新版 DOM——同步性由
// free-mode-cache-bust 测试统一守门（本项目曾因手工 ?v= 忘同步栽过）。
assert.match(index, /<link rel="stylesheet" href="\/styles\.css\?v=[0-9a-zA-Z._-]+"\s*\/>/, "制作台样式必须携带版本戳以走 immutable");
assert.match(index, /<script src="\/app\.js\?v=[0-9a-zA-Z._-]+"><\/script>/, "制作台脚本必须携带版本戳以走 immutable");

// ---------- 行为验证：在沙箱里跑真实的 cachedStaticFile ----------
// 只抽 cachedStaticFile（纯函数，只依赖 fs 和 crypto），避免把整个 server.js 拉起来。
const context = { fs, crypto, Map, Math, String };
vm.createContext(context);
vm.runInContext(sliceBetween(server, "const staticFileCache = new Map();", "\nfunction serveStatic("), context, {
  filename: "server.js",
});
const cachedStaticFile = vm.runInContext("cachedStaticFile", context);

const tmp = path.join(root, `.tmp-static-cache-${process.pid}`);
fs.mkdirSync(tmp, { recursive: true });
const probe = path.join(tmp, "probe.js");
try {
  fs.writeFileSync(probe, "console.log(1);\n");
  let reads = 0;
  const realRead = fs.readFileSync;
  fs.readFileSync = function (...args) {
    if (String(args[0]) === probe) reads += 1;
    return realRead.apply(this, args);
  };
  try {
    // 首次：必须读盘一次。
    const first = cachedStaticFile(probe, fs.statSync(probe));
    assert.equal(reads, 1, "首次访问应读盘一次");
    assert.match(first.etag, /^"[0-9a-f]{40}"$/, "ETag 应是带引号的 sha1");

    // 命中缓存：不得再读盘。这是省掉那 1.5MB/次 的关键。
    const second = cachedStaticFile(probe, fs.statSync(probe));
    assert.equal(reads, 1, "同一文件未变时不得重复读盘");
    assert.equal(second.etag, first.etag, "内容未变时 ETag 必须稳定");
    assert.equal(second.body, first.body, "命中缓存应复用同一 body");

    // 内容变化（且长度不同）：必须失效。
    fs.writeFileSync(probe, "console.log(22);\n");
    const third = cachedStaticFile(probe, fs.statSync(probe));
    assert.equal(reads, 2, "文件变化后必须重新读盘");
    assert.notEqual(third.etag, first.etag, "内容变化必须换 ETag");

    // 等长改动：size 相同，靠 mtime 兜住。这是"只比 size"会漏的那一类。
    const beforeEtag = third.etag;
    const beforeReads = reads;
    fs.writeFileSync(probe, "console.log(33);\n"); // 与上一版等长
    // mtime 精度有限，显式推进一秒确保凭证变化可被观测。
    const future = new Date(Date.now() + 1000);
    fs.utimesSync(probe, future, future);
    const fourth = cachedStaticFile(probe, fs.statSync(probe));
    assert.equal(reads, beforeReads + 1, "等长改动也必须重新读盘（靠 mtime 兜）");
    assert.notEqual(fourth.etag, beforeEtag, "等长但内容不同，ETag 必须不同");

    // mtime 不变但长度变了：靠 size 兜住。git checkout / tar 解包会还原 mtime，
    // 只比 mtime 的凭证在这类场景下会把旧内容一直发下去。
    const pinned = fs.statSync(probe).mtime;
    const fifthBeforeEtag = fourth.etag;
    const fifthBeforeReads = reads;
    fs.writeFileSync(probe, "console.log(3333333);\n"); // 比上一版长
    fs.utimesSync(probe, pinned, pinned); // 把 mtime 钉回去，只剩 size 能体现变化
    const fifth = cachedStaticFile(probe, fs.statSync(probe));
    assert.equal(reads, fifthBeforeReads + 1, "mtime 未变但长度变了，也必须重新读盘（靠 size 兜）");
    assert.notEqual(fifth.etag, fifthBeforeEtag, "长度变化必须换 ETag");

    // ETag 必须真的等于内容哈希 —— 防止有人改成 mtime 哈希后前三条仍然侥幸通过。
    const expected = `"${crypto.createHash("sha1").update(fs.readFileSync(probe)).digest("hex")}"`;
    assert.equal(fifth.etag, expected, "ETag 必须等于文件内容的 sha1");
  } finally {
    fs.readFileSync = realRead;
  }
  // 4. 备份/临时文件不得公网可访问：scp 盲改残留的 *.bak-*、*.orig 等不能经静态服务泄漏。
  const staticPrefix = sliceBetween(server, "function serveStatic(", "\nfunction contentDispositionName");
  assert.match(staticPrefix, /baseName\.endsWith\("\.bak"\)/, "static serving must reject *.bak files");
  assert.match(staticPrefix, /baseName\.endsWith\("\.orig"\)/, "static serving must reject *.orig files");
  assert.match(staticPrefix, /403, "forbidden"/, "backup files must return 403, not 200");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("static asset cache tests passed");
