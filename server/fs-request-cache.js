"use strict";
// 请求级 fs 读缓存。
//
// 病史:一次 /status 走 fullProjectState,实测 4506 次同步读盘(readFileSync 1041
// + stat 580 + existsSync 2463 + readdirSync 423),其中 89% 的 readFileSync 和
// 95% 的 stat/exists 是**同一请求内对同一路径的重复读**。最热的
// outputs/e01 一次请求被 exists/stat 了 351 次,pixel_toys_workflow.json 被读了 28 次。
// Node 单线程,这些同步读全发生在事件循环上,直接堆在用户的下一次点击前面。
// 工作进行中前端每 2 秒轮询一次,于是整站"刷新和点击都很重"。
//
// 为什么拦在 fs 层而不是业务函数层:
//   - 业务层封装(readText/readJsonFile/listDir)只盖住一部分,还有 150+ 处裸
//     fs.existsSync 散落在各处。逐个改调用点等于全文件重写,风险远大于收益。
//   - 函数级 memo 会出正确性事故:bindManualAssetToConfig 之类会直接改
//     readVideoConfig(...).data 返回的对象,缓存对象等于把改动漏给别人。
//     这里只缓存**不可变值**(字符串正文 / Stats / 目录名数组的副本)。
//
// 为什么是请求级而不是进程级:进程级需要写时失效,但全项目有 25 处 fs.writeFileSync
// 绕过 writeText 封装,漏一处就是"改了不生效"的幽灵 bug。请求级的失效边界由请求
// 自身的生命周期给定,不依赖任何人记得去失效。
//
// 为什么用 als.run 而不是 als.enterWith:enterWith 改的是"当前同步执行 + 其后
// 的异步延续",在 keep-alive 连接上多个请求可能落在同一父异步上下文里,store 会
// 跨请求泄漏。run 的作用域由回调边界给定,不存在这个问题。
const fs = require("node:fs");
const { AsyncLocalStorage } = require("node:async_hooks");

const als = new AsyncLocalStorage();

// 单个文件正文的缓存上限。防止某个请求 readFileSync 一个大媒体文件后,整份正文
// 被按在内存里直到请求结束。热路径读的都是 JSON/Markdown,远低于这个数。
const MAX_CACHED_BYTES = 2 * 1024 * 1024;

// 缓存生存期上限。请求级作用域本身不够 —— /api/super-pixel/chat 里有
// while (round < 5) 的工具循环,每轮调一次大模型,单个请求可以活好几分钟。
// 同一请求自己写自己读是安全的(写会停用缓存),危险的是这期间**别的**请求或
// 后台任务改了盘:它们只清自己的 store,清不到这个长连请求捧着的快照。
// 普通请求实测 46ms 完成,2 秒留了 40 倍余量,同时把陈旧窗口钉死在 2 秒。
// 放在可变对象里是为了让测试能把它调小,不必真睡 2 秒。
const config = { ttlMs: 2000 };

function store() {
  const s = als.getStore();
  if (!s) return null;
  if (!s.disabled && Date.now() - s.bornAt > config.ttlMs) {
    // 超龄:停用。只清空也是对的(每次进来都清一遍,等于每次读都落盘),
    // 但那样要反复清 Map 又反复填,做的是无用功。停用一次就够。
    s.disabled = true;
    s.files.clear();
  }
  return s;
}

// 只读方法:命中缓存。
const READ_METHODS = ["readFileSync", "statSync", "existsSync", "readdirSync"];

// 与缓存无关、既不读被缓存的东西也不改盘的方法,原样放过。
const NEUTRAL_METHODS = [
  "createReadStream", "constants", "promises", "Stats", "Dirent", "ReadStream", "WriteStream",
  "F_OK", "R_OK", "W_OK", "X_OK", "realpathSync", "readlinkSync", "accessSync", "opendirSync",
  "watch", "watchFile", "unwatchFile", "read", "readv", "fstatSync", "readSync", "closeSync",
  "Dir", "FileReadStream", "FileWriteStream", "_toUnixTimestamp",
];

// 同步写:执行完就地清空本请求缓存,之后可以继续缓存(写已经落盘,再读就是新内容)。
const SYNC_WRITE_METHODS = [
  "writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "rmdirSync", "unlinkSync",
  "renameSync", "copyFileSync", "truncateSync", "ftruncateSync", "utimesSync", "futimesSync",
  "chmodSync", "fchmodSync", "chownSync", "fchownSync", "lchownSync", "lchmodSync",
  "symlinkSync", "linkSync", "writeSync", "writevSync", "mkdtempSync", "cpSync", "openSync",
];

// 其余一切(异步写、createWriteStream、open、以及**将来 Node 新增的任何方法**)
// 一律按"可能改盘且完成时机不可控"处理:直接停用本请求剩余部分的缓存。
// 这条默认值是刻意选的 —— 新方法的默认后果是"慢",不是"读到脏数据"。
// 异步写不能只清空:清空后的读会缓存写入前的旧内容,写落盘后同请求再读就拿到
// 陈旧值,这是没有缓存时不会发生的行为变化。停用则退化成原样,只损失性能。
function classify(name) {
  if (READ_METHODS.includes(name)) return "read";
  if (NEUTRAL_METHODS.includes(name)) return "neutral";
  if (SYNC_WRITE_METHODS.includes(name)) return "sync-write";
  return "async-write";
}

// readFileSync 只在指定了字符串编码时缓存。不带编码返回 Buffer,是可变对象,
// 缓存同一个 Buffer 等于把它交给多个调用方共享,任何一处改写就污染其他人。
function encodingOf(options) {
  if (typeof options === "string") return options;
  if (options && typeof options === "object" && typeof options.encoding === "string") return options.encoding;
  return null;
}

// 缓存里同时存"成功值"和"抛出的错"。不存错的话,对不存在的文件反复 readFileSync
// 仍然每次都要走一遍系统调用 —— 而"文件不存在"恰恰是热路径上最常见的结果
// (existsSync 2463 次里绝大多数是在问"这个可选文件在不在")。
function memo(cache, key, compute) {
  const hit = cache.get(key);
  if (hit) {
    if (hit.threw) throw hit.error;
    return hit.value;
  }
  let entry;
  try {
    entry = { threw: false, value: compute() };
  } catch (error) {
    entry = { threw: true, error };
  }
  cache.set(key, entry);
  if (entry.threw) throw entry.error;
  return entry.value;
}

function installReads(target, real) {
  target.readFileSync = function (file, options) {
    const s = store();
    const enc = encodingOf(options);
    // 不带编码 → Buffer,可变,不缓存(静态资源有自己的 serveStatic 缓存)。
    if (!s || s.disabled || !enc || typeof file !== "string") return real.readFileSync.call(this, file, options);
    const key = `read ${enc} ${file}`;
    const hit = s.files.get(key);
    if (hit) {
      if (hit.threw) throw hit.error;
      return hit.value;
    }
    let entry;
    try {
      const value = real.readFileSync.call(this, file, options);
      // 超限的正文照常返回,但不进缓存:避免大文件把内存按住一整个请求。
      if (typeof value === "string" && Buffer.byteLength(value) > MAX_CACHED_BYTES) return value;
      entry = { threw: false, value };
    } catch (error) {
      entry = { threw: true, error };
    }
    s.files.set(key, entry);
    if (entry.threw) throw entry.error;
    return entry.value;
  };

  // Stats 上被用到的只有 isFile/isDirectory/size/mtimeMs 这类只读取值器,
  // 实践上不可变,可以安全复用同一个对象。
  target.statSync = function (file, options) {
    const s = store();
    // throwIfNoEntry:false 会返回 undefined 而不抛,语义不同,单独作 key。
    if (!s || s.disabled || typeof file !== "string") return real.statSync.call(this, file, options);
    const noThrow = !!(options && options.throwIfNoEntry === false);
    return memo(s.files, `stat ${noThrow} ${file}`, () => real.statSync.call(this, file, options));
  };

  // existsSync 与 statSync 同源:existsSync(p) 等价于 statSync(p) 不抛。
  // 复用同一份 stat 结果,让"先 exists 再 stat"这种最常见的两连问只花一次系统调用。
  target.existsSync = function (file) {
    const s = store();
    if (!s || s.disabled || typeof file !== "string") return real.existsSync.call(this, file);
    try {
      memo(s.files, `stat false ${file}`, () => real.statSync.call(this, file));
      return true;
    } catch {
      return false;
    }
  };

  // readdirSync 返回数组,是可变对象。调用方可能就地 sort/reverse,
  // 缓存原数组等于让后一个调用方看到前一个排过的结果。每次返回浅拷贝。
  target.readdirSync = function (dir, options) {
    const s = store();
    if (!s || s.disabled || typeof dir !== "string") return real.readdirSync.call(this, dir, options);
    const enc = encodingOf(options);
    const withTypes = !!(options && typeof options === "object" && options.withFileTypes);
    const recursive = !!(options && typeof options === "object" && options.recursive);
    const key = `dir ${withTypes} ${recursive} ${enc || ""} ${dir}`;
    return memo(s.files, key, () => real.readdirSync.call(this, dir, options)).slice();
  };
}

// fs.promises 是另一个对象,方法名不带 Sync,不会被上面那轮分类碰到。
// 漏掉它的后果不是"慢"而是"错":走 fs.promises.writeFile 的写不触发失效,
// 同一请求后续的读会一直返回写入前的旧内容。测试就是这么抓出来的。
const PROMISE_READS = ["readFile", "stat", "lstat", "readdir", "access", "realpath", "readlink", "opendir", "statfs"];

function installPromises(target, real) {
  const api = target.promises;
  if (!api || typeof api !== "object") return;
  real.promises = {};
  for (const name of Object.keys(api).concat(Object.getOwnPropertyNames(api))) {
    const desc = Object.getOwnPropertyDescriptor(api, name);
    if (!desc || typeof desc.value !== "function") continue;
    if (!desc.writable && !desc.set) continue;
    if (PROMISE_READS.includes(name)) continue; // 异步读不缓存,原样穿透
    if (real.promises[name]) continue;
    const fn = desc.value;
    real.promises[name] = fn;
    // 异步写完成时机不受控,一律停用本请求剩余部分的缓存(含 open:
    // 拿到 FileHandle 之后的写发生在我们看不到的地方)。
    api[name] = function (...args) {
      const s = store();
      if (s) {
        s.disabled = true;
        s.files.clear();
      }
      return fn.apply(this, args);
    };
  }
}

function install(target = fs) {
  const real = {};
  const skipped = [];
  for (const name of Object.keys(target)) {
    // Node 26 起 fs 上有只读 getter 属性(Utf8Stream 等流/类构造器),赋值会抛。
    // 跳过它们,但把名字记下来 —— 静默跳过一个真正的写方法就等于返回脏数据,
    // 所以下面要断言跳过的全都不是写方法。
    const desc = Object.getOwnPropertyDescriptor(target, name);
    if (!desc || (!desc.writable && !desc.set)) {
      if (typeof target[name] === "function") skipped.push(name);
      continue;
    }
    const fn = target[name];
    if (typeof fn !== "function") continue;
    const kind = classify(name);
    if (kind === "neutral") continue;
    real[name] = fn;
    if (kind === "read") continue;
    target[name] = function (...args) {
      const s = store();
      // 同步写落盘后清空:后续读会重新读到新内容,缓存可以继续工作。
      // 异步写完成时机不可控,直接停用本请求剩余部分。
      if (s) {
        if (kind === "sync-write") {
          const out = fn.apply(this, args);
          s.files.clear();
          return out;
        }
        s.disabled = true;
        s.files.clear();
      }
      return fn.apply(this, args);
    };
  }
  installReads(target, real);
  installPromises(target, real);
  // 跳过的只读属性里如果出现写方法,说明有写操作没被拦住,缓存会返回脏数据。
  // 宁可启动即崩,也不要带着这个隐患跑起来。
  const dangerous = skipped.filter((n) => /^(write|append|mkdir|rm|unlink|rename|copy|truncate|chmod|chown|symlink|link|utimes)/i.test(n));
  if (dangerous.length) throw new Error(`fs 上这些写方法无法被包装(只读属性),缓存不安全: ${dangerous.join(", ")}`);
  real.__skipped = skipped;
  return real;
}

// 每个请求跑在自己的 store 里。没有 store 的调用(启动期、子进程、定时任务、
// 测试)全部原样穿透 —— 缓存只在"请求开始到结束"这段确定的窗口内生效。
function runInRequest(fn) {
  return als.run({ files: new Map(), disabled: false, bornAt: Date.now() }, fn);
}

// 装好之后自检一遍:确认被分类为 read 的方法真的被换掉了,
// 且 NEUTRAL 里没有把某个真正会改盘的方法误放进去(误放 = 静默返回脏数据)。
function assertInstalled(target = fs) {
  const missing = READ_METHODS.filter((n) => !target[n] || !String(target[n]).includes("store()"));
  if (missing.length) throw new Error(`fs-request-cache 未正确安装: ${missing.join(", ")}`);
  const suspicious = NEUTRAL_METHODS.filter((n) => /^(write|append|mkdir|rm|unlink|rename|copy|truncate|chmod|chown|symlink|link|utimes)/.test(n));
  if (suspicious.length) throw new Error(`NEUTRAL_METHODS 里混入了写方法: ${suspicious.join(", ")}`);
}

module.exports = {
  als, MAX_CACHED_BYTES, config, store, classify, encodingOf, memo, install,
  runInRequest, assertInstalled,
  READ_METHODS, NEUTRAL_METHODS, SYNC_WRITE_METHODS,
};
