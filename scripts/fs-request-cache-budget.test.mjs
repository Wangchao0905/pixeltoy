// 防复发闸门:断言一次 /status（fullProjectState）在请求级缓存下的 syscall 数
// 不超过阈值。有人往热路径加了重复读，这条测试直接变红。
//
// 这里不使用总读盘次数或总读盘比率。fullProjectState 也会扫描共享画布目录,
// 唯一文件的数量随开发机环境变化；把这些不可去重的读取计入分母会让缓存正常时
// 也出现假红。改用两个真正与缓存契约对应的不变量:
//   A. 节省量:开缓存必须消除足够多的重复读取。
//   B. 重复读:同一请求内同一路径不得被重复读超过少量几次。
//      —— 这是缓存的契约本身。有人绕过缓存(比如改用 fs.promises.readFile)时,
//      重复数会立刻涨回去。优化前重复 930 次 readFile + 2892 次 stat/exists。
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import Module from "node:module";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const APP = process.cwd();
const MIN_SAVED_READS = 1000; // 当前热路径实测可消除约 1,400 次重复读取，留出合理余量。
const MAX_DUPES = 5; // 实测 0 次。留一点余量,免得热路径里加一处同步写就假红

// 关键:计数器必须在 server.js 加载之前装上。
// install() 执行时抓到的"真身"是计数器,缓存命中时不经过计数器,
// 数到的才是真正落盘的次数。顺序反了就量不出来缓存效果。
let syscalls = 0;
let trace = null; // 非 null 时记录 "方法 路径",用来数重复读
const realFs = {};
for (const name of ["readFileSync", "statSync", "existsSync", "readdirSync"]) {
  const r = fs[name];
  realFs[name] = r;
  fs[name] = function (...args) {
    syscalls += 1;
    if (trace) trace.push(`${name} ${args[0]}`);
    return r.apply(this, args);
  };
}

// 合成项目:最简结构,只有 script 文件。目的是让 fullProjectState 跑完,
// 不是要精确模拟生产数据量 —— 阈值相对于这个合成项目成立即可。
// 必须建在 cwd 下:allowedPath 只放行 APP_ROOT(=cwd) 内的路径,建在 os.tmpdir()
// 会被判 "project not found"。
const tmp = fs.mkdtempSync(path.join(APP, ".tmp-fs-cache-budget-"));
const episodeRoot = path.join(tmp, "outputs", "e01");
fs.mkdirSync(episodeRoot, { recursive: true });
fs.writeFileSync(path.join(episodeRoot, "e01_script.md"), "# 测试\n\n场景 1\n");

try {
  const src = fs
    .readFileSync(path.join(APP, "server.js"), "utf8")
    .replace(/\.listen\(/g, ".on('__noop__',()=>{}); (()=>{})(");
  const ctx = {
    require: Module.createRequire(path.join(APP, "server.js")),
    module: { exports: {} },
    exports: {},
    __dirname: APP,
    __filename: path.join(APP, "server.js"),
    process, console, Buffer, URL, URLSearchParams,
    TextEncoder, TextDecoder, setTimeout, clearTimeout,
    setInterval, clearInterval, setImmediate, fetch,
    AbortController, structuredClone, globalThis: null,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "server.js" });
  const fullProjectState = vm.runInContext("fullProjectState", ctx);
  const fsRequestCache = vm.runInContext("fsRequestCache", ctx);

  // 预热:前两次调用会触发一次性迁移写(ensureVideoConfigIsolation 等)。
  // 稳定态(第 3 次起)是真实轮询的样子,也是我们要守护的目标。
  fullProjectState(episodeRoot);
  fullProjectState(episodeRoot);

  // 不开缓存(没有 ALS store,= 优化前的行为)
  syscalls = 0;
  fullProjectState(episodeRoot);
  const passthrough = syscalls;

  // 开缓存,同时记录每一次读的路径
  syscalls = 0;
  trace = [];
  fsRequestCache.runInRequest(() => fullProjectState(episodeRoot));
  const cached = syscalls;
  const seen = new Map();
  for (const key of trace) seen.set(key, (seen.get(key) || 0) + 1);
  trace = null;
  const dupes = [...seen.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const worst = [...seen.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const saved = passthrough - cached;

  assert.ok(
    saved >= MIN_SAVED_READS,
    `请求级 fs 缓存去重不足:开缓存 ${cached} 次 / 不开 ${passthrough} 次,` +
    `仅节省 ${saved} 次，低于下限 ${MIN_SAVED_READS}。\n` +
    `常见原因:缓存被摘掉、handler 不再被 runInRequest 包住、` +
    `或热路径里新增了写操作导致缓存被反复清空。`
  );
  assert.ok(
    dupes <= MAX_DUPES,
    `同一请求内重复读了 ${dupes} 次(上限 ${MAX_DUPES})。优化前重复约 3800 次。\n` +
    `说明有代码绕过了缓存(例如改用 fs.promises.readFile,或热路径里插了写)。\n` +
    `重复最多的:\n${worst.map(([k, c]) => `  ${c}x ${k}`).join("\n")}`
  );
  // 门控:只有真正走磁盘的请求才开缓存。静态资源走 serveStatic(自带内存缓存),
  // 给它套 als.run 是纯开销 —— 实测 /index.html 吞吐会掉一成。
  // 这几条断言同时守两个方向:该开的不能漏(否则 /status 失去缓存),
  // 不该开的不能加(否则静态路径白付开销)。
  const needsCache = vm.runInContext("requestNeedsFsCache", ctx);
  for (const p of ["/api/project/abc/status", "/api/projects", "/media?file=x", "/public-assets/a.png"]) {
    assert.equal(needsCache(p), true, `${p} 必须开 fs 读缓存`);
  }
  for (const p of ["/", "/index.html", "/app.js?v=1", "/styles.css", "/auth.html", ""]) {
    assert.equal(needsCache(p), false, `${p} 走 serveStatic,不该付 als.run 的开销`);
  }

  // 门控必须真的接在 createServer 上,而不是定义了没用。
  const wiring = src.slice(src.indexOf("const server = http.createServer("));
  assert.match(wiring, /requestNeedsFsCache\(req\.url\)/, "createServer 里必须用 requestNeedsFsCache 判断");
  assert.match(wiring, /fsRequestCache\.runInRequest\(/, "createServer 里必须调 runInRequest");
  assert.doesNotMatch(wiring.slice(0, 400), /enterWith/, "不得用 enterWith:keep-alive 上会跨请求泄漏 store");

  // 最关键的一条:发真实 HTTP 请求,看缓存到底有没有对该开的请求生效。
  // 上面那些断言全都杀不掉"门控判断反了"这个变异 —— 函数返回值对、
  // createServer 里也确实引用了它,但分支极性反了:/api 不走缓存、静态反而走。
  // 只有观察真实请求里 runInRequest 是否被调用才抓得住。
  const realRunInRequest = fsRequestCache.runInRequest;
  let wrapped = 0;
  fsRequestCache.runInRequest = function (...args) {
    wrapped += 1;
    return realRunInRequest.apply(this, args);
  };
  const server = vm.runInContext("server", ctx);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    wrapped = 0;
    await fetch(`http://127.0.0.1:${port}/api/projects`).then((r) => r.text());
    assert.equal(wrapped, 1, "/api 请求必须被 runInRequest 包住(门控分支极性反了?)");

    wrapped = 0;
    await fetch(`http://127.0.0.1:${port}/index.html`).then((r) => r.text());
    assert.equal(wrapped, 0, "静态资源请求不该被 runInRequest 包住(白付 als.run 的开销)");
  } finally {
    fsRequestCache.runInRequest = realRunInRequest;
    server.close();
  }

  console.log(
    `fs-cache budget test passed: ${passthrough} → ${cached} 次读盘 ` +
    `(节省 ${saved} 次 ≥ ${MIN_SAVED_READS}), 重复读 ${dupes} 次 ≤ ${MAX_DUPES}`
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [name, r] of Object.entries(realFs)) fs[name] = r;
}
