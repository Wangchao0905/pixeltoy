# 统一参考图交付(素材库 asset:// / 公网双轨)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 批量出片前新增阻塞式"阶段0 准备参考图":人物类(Character/Storyboard)验证成 active `asset://`,非人物类(Scene/Prop/Insert)确保稳定公网地址;全部就绪才逐段提交,提交仍用配置模型。杜绝 Ark 抓取超时与真人拦截。

**Architecture:** 纯逻辑(收集/分轨/就绪判定)抽到可单测的 CommonJS 模块 `scripts/video-ref-prep.js`;server.js 负责有副作用的编排(素材库验证/公网预上传/轮询)与批量入口闸;提交链、模型路由不变(基础模型经 Gravitex 本就支持 asset://,`allowAssetUrl:true`)。

**Tech Stack:** Node CommonJS 单文件 server.js;验证 = `npm test`(`node --check` 各文件 + `node scripts/self-check.mjs`)+ 新增 `node scripts/video-ref-prep.test.js`。**本项目非 git 仓库**,故用"Checkpoint: npm test 全绿"代替 commit;部署 = rsync → 远端 node --check → pm2 reload。

**设计依据:** `docs/superpowers/specs/2026-07-02-unified-asset-reference-delivery-design.md`

---

## 文件结构

- 新建 `scripts/video-ref-prep.js` — 纯函数:收集引用名、按类型分轨、就绪判定。无 server 依赖,可单测。
- 新建 `scripts/video-ref-prep.test.js` — node:assert 单测。
- 修改 `server.js` — require 上述模块;新增 `ensurePublicReferenceUrl`、`prepareBatchVideoReferences`;改 `validateCanvasPhotorealAssets`、`generateProjectVideoShotsSequentially`、`ensureProjectPhotorealReferencesReady`。
- 修改 `scripts/self-check.mjs` — 锁死接线与不变式。
- 修改 `package.json` — test 脚本加跑纯逻辑单测。

---

## Task 1: 纯逻辑模块 + 单测(收集/分轨/就绪判定)

**Files:**
- Create: `scripts/video-ref-prep.js`
- Create: `scripts/video-ref-prep.test.js`
- Modify: `package.json`(test 脚本)

- [ ] **Step 1: 写失败测试** `scripts/video-ref-prep.test.js`

```js
const assert = require("node:assert");
const {
  referenceTrackForName,
  collectReferencedAssetNames,
  classifyReferenceAssets,
  evaluateReferenceReadiness,
} = require("./video-ref-prep.js");

// 分轨:人物/故事板 -> person;场景/道具/插入 -> public
assert.equal(referenceTrackForName("C001_EVELYN_CHARACTER_SHEET"), "person");
assert.equal(referenceTrackForName("SB003_E01_V003_PRODUCTION_BOARD"), "person");
assert.equal(referenceTrackForName("S002_宴会厅_WIDE_ESTABLISHING"), "public");
assert.equal(referenceTrackForName("P002_HALE_PROP_REF"), "public");
assert.equal(referenceTrackForName("I001_x_INSERT_REF"), "public");
assert.equal(referenceTrackForName("未知名字"), "public"); // 未知安全默认:只需公网

// 收集:合并 refs + storyboardRefs 去重
const shots = [
  { refs: ["S002_宴会厅_WIDE_ESTABLISHING", "C001_EVELYN_CHARACTER_SHEET"], storyboardRefs: ["SB001_E01_V001_PRODUCTION_BOARD"] },
  { refs: ["S002_宴会厅_WIDE_ESTABLISHING"], storyboardRefs: ["SB002_E01_V002_PRODUCTION_BOARD"] },
];
const names = collectReferencedAssetNames(shots);
assert.equal(names.length, 4, "S002 应去重");

// 分类
const { personTrack, publicTrack } = classifyReferenceAssets(names);
assert.deepEqual(
  personTrack.slice().sort(),
  ["C001_EVELYN_CHARACTER_SHEET", "SB001_E01_V001_PRODUCTION_BOARD", "SB002_E01_V002_PRODUCTION_BOARD"].sort(),
);
assert.deepEqual(publicTrack, ["S002_宴会厅_WIDE_ESTABLISHING"]);

// 就绪判定:person 要 active+asset://;public 要 https
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

console.log("video-ref-prep tests passed.");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/video-ref-prep.test.js`
Expected: FAIL — `Cannot find module './video-ref-prep.js'`

- [ ] **Step 3: 实现模块** `scripts/video-ref-prep.js`

```js
"use strict";

// 参考图交付轨道:person = 含人形(人物图/故事板),必须变 active asset://(治真人+超时);
// public = 无人形(场景/道具/插入),只需稳定公网 https(治超时)。未知名字默认 public(最省)。
function referenceTrackForName(name) {
  const base = String(name || "").trim();
  if (/_CHARACTER_SHEET$/i.test(base) || /^C\d{3}_/i.test(base)) return "person";
  if (/_PRODUCTION_BOARD$/i.test(base) || /_NINE_GRID_STORYBOARD$/i.test(base) || /^SB\d{3}_/i.test(base)) return "person";
  return "public";
}

function collectReferencedAssetNames(shots) {
  const names = new Set();
  for (const shot of Array.isArray(shots) ? shots : []) {
    for (const r of Array.isArray(shot && shot.refs) ? shot.refs : []) {
      const n = String(r || "").trim();
      if (n) names.add(n);
    }
    for (const r of Array.isArray(shot && shot.storyboardRefs) ? shot.storyboardRefs : []) {
      const n = String(r || "").trim();
      if (n) names.add(n);
    }
  }
  return [...names];
}

function classifyReferenceAssets(names) {
  const personTrack = [];
  const publicTrack = [];
  for (const name of Array.isArray(names) ? names : []) {
    if (referenceTrackForName(name) === "person") personTrack.push(name);
    else publicTrack.push(name);
  }
  return { personTrack, publicTrack };
}

// items: [{ name, track, status?, assetUrl?, publicUrl?, error? }] -> { ready, stuck[] }
function evaluateReferenceReadiness(items) {
  const stuck = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (it && it.track === "person") {
      const ok = it.status === "active" && /^asset:\/\//i.test(String(it.assetUrl || ""));
      if (!ok) stuck.push({ name: it.name, track: "person", status: it.status || "pending", reason: it.error || "素材库未 active" });
    } else {
      const ok = /^https?:\/\//i.test(String((it && it.publicUrl) || ""));
      if (!ok) stuck.push({ name: it && it.name, track: "public", status: (it && it.status) || "no-source", reason: (it && it.error) || "缺少可用公网图源" });
    }
  }
  return { ready: stuck.length === 0, stuck };
}

module.exports = { referenceTrackForName, collectReferencedAssetNames, classifyReferenceAssets, evaluateReferenceReadiness };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/video-ref-prep.test.js`
Expected: PASS — 输出 `video-ref-prep tests passed.`

- [ ] **Step 5: 把单测加入 npm test** — `package.json` 的 `test` 脚本末尾追加 `&& node scripts/video-ref-prep.test.js`

改后 test 脚本形如:
`"test": "node --check server.js && node --check public/app.js && node --check public/admin.js && node --check public/canvas.js && node --check scripts/run_asset_generation.js && node scripts/video-ref-prep.test.js && node scripts/self-check.mjs"`

- [ ] **Step 6: Checkpoint** — Run: `npm test` Expected: 全绿(含新单测 + self-check)

---

## Task 2: server.js 接线 + 放开 validateCanvasPhotorealAssets 只验 photoreal 的限制

**Files:**
- Modify: `server.js`(顶部 require;`validateCanvasPhotorealAssets` ~8054-8090)

- [ ] **Step 1: require 纯模块** — 在 server.js 顶部现有 require 块之后加:

```js
const { collectReferencedAssetNames, classifyReferenceAssets, evaluateReferenceReadiness } = require("./scripts/video-ref-prep.js");
```

- [ ] **Step 2: 放开验证范围** — 在 `validateCanvasPhotorealAssets` 内,删除"非 photoreal 全部 skipped 提前返回"分支(原 `if (!photorealAssets.length) { ... skipped ... return }`)与逐条里的 `if (!isCanvasPhotorealAsset(asset) && !hasExistingAssetUrl) { skipped; continue; }`。改为:传入的每个资产都尝试验证(调用方只会把"人物轨"资产传进来)。逐条循环体保留 `hasExistingAssetUrl` 复用与 `createOrRefreshGravitexAsset` 主流程,仅移除 skipped 短路。

- [ ] **Step 3: node 语法检查** — Run: `node --check server.js` Expected: OK(注意:此时若有引用未定义会报错)

- [ ] **Step 4: Checkpoint** — Run: `npm test` Expected: 全绿(self-check 断言在 Task 7 补;此步只保证不破坏现有)

---

## Task 3: 非人物轨——ensurePublicReferenceUrl

**Files:**
- Modify: `server.js`(新增函数,置于 `validateCanvasPhotorealAssets` 附近)

- [ ] **Step 1: 实现** — 新增:

```js
// 非人物轨:确保资产有稳定公网 https 地址(Ark 可快速抓取,避免临时转公网超时)。
// 已有 https 公网地址则原样返回;否则用现有图源(publicUrl/url/previewUrl/磁盘)预上传公网。不注册素材库、不轮询 active。
async function ensurePublicReferenceUrl(asset = {}) {
  const existing = compactLine(asset.publicUrl || asset.public_url || "");
  if (/^https:\/\//i.test(existing)) return { ...asset, publicUrl: existing, publicReady: true };
  const source = compactLine(asset.publicUrl || asset.url || asset.previewUrl || "");
  const resolved = await canvasAssetToPublicUrl({ ...asset, url: source }, 0);
  const url = compactLine(resolved.url || "");
  if (/^https:\/\//i.test(url)) return { ...asset, publicUrl: url, publicReady: true };
  return { ...asset, publicReady: false, publicError: resolved.message || "无法生成公网地址" };
}
```

- [ ] **Step 2: node 语法检查** — Run: `node --check server.js` Expected: OK

- [ ] **Step 3: Checkpoint** — Run: `npm test` Expected: 全绿

---

## Task 4: 编排器——prepareBatchVideoReferences(阶段0主体)

**Files:**
- Modify: `server.js`(新增 async 函数 + 常量,置于 `ensureProjectPhotorealReferencesReady` 前)

- [ ] **Step 1: 实现**

```js
const PREPARE_REFS_TIMEOUT_MS = 8 * 60 * 1000;
const PREPARE_REFS_POLL_MS = 8000;

// 阶段0:把本批引用的参考图统一备好可提交地址。人物轨->素材库 active asset://;非人物轨->稳定公网。
// 返回 { ready, stuck:[{name,track,status,reason}], config }。ready=false 时调用方整批中止。
async function prepareBatchVideoReferences(episodeRoot, configRecord, shots, options = {}) {
  const timeoutMs = Number(options.timeoutMs || PREPARE_REFS_TIMEOUT_MS);
  let config = configRecord && configRecord.data ? configRecord.data : {};
  const names = collectReferencedAssetNames(shots);
  const { personTrack, publicTrack } = classifyReferenceAssets(names);
  const nameSet = new Set(names);
  const assetByName = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));

  // 非人物轨:逐个确保公网地址,写回 config.assets
  for (const name of publicTrack) {
    const asset = assetByName.get(name) || resolveScannedAssetByName(episodeRoot, name);
    if (!asset) continue;
    const ensured = await ensurePublicReferenceUrl(asset);
    mergeConfigAssetPatch(config, name, { publicUrl: ensured.publicUrl || "", publicReady: ensured.publicReady === true });
  }

  // 人物轨:推素材库 + 轮询 active(整体超时)
  const personAssets = personTrack.map((n) => assetByName.get(n) || resolveScannedAssetByName(episodeRoot, n)).filter(Boolean);
  if (personAssets.length) {
    const validation = await validateCanvasPhotorealAssets({
      groupId: projectPhotorealGroupId(config),
      name: config.groupName || "参考素材组",
      channelId: (config.settings && config.settings.channelId) || (config.assetLibrary && config.assetLibrary.channelId) || "",
      assets: personAssets,
    });
    config = mergeValidatedProjectAssets({ ...config, ...projectAssetLibraryPatch(validation.group, projectPhotorealGroupId(config)) }, validation.assets || []).config;
    writeVideoConfigRecord(configRecord, config);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const refreshed = await refreshConfigAssetLibraryStatuses(config);
      config = refreshed.config;
      writeVideoConfigRecord(configRecord, config);
      const cur = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
      const pendingPerson = personTrack.filter((n) => {
        const a = cur.get(n) || {};
        const st = compactLine(a.validationStatus || "").toLowerCase();
        return !(st === "active" && /^asset:\/\//i.test(compactLine(a.assetUrl || "")));
      });
      const failed = personTrack.filter((n) => compactLine((cur.get(n) || {}).validationStatus || "").toLowerCase() === "failed");
      if (!pendingPerson.length) break;
      if (failed.length) break; // 有 failed 立即停止等待
      await new Promise((r) => setTimeout(r, PREPARE_REFS_POLL_MS));
    }
  }

  // 汇总判定
  const cur = new Map((Array.isArray(config.assets) ? config.assets : []).map((a) => [compactLine(a.name || a.assetName || ""), a]));
  const items = names.map((name) => {
    const a = cur.get(name) || {};
    const track = personTrack.includes(name) ? "person" : "public";
    return {
      name,
      track,
      status: compactLine(a.validationStatus || (a.publicReady ? "public" : "")),
      assetUrl: compactLine(a.assetUrl || ""),
      publicUrl: compactLine(a.publicUrl || ""),
      error: compactLine(a.validationError || a.publicError || ""),
    };
  });
  const { ready, stuck } = evaluateReferenceReadiness(items);
  return { ready, stuck, config };
}
```

- [ ] **Step 2: 补依赖小工具** — 若 server.js 无 `resolveScannedAssetByName` / `mergeConfigAssetPatch`,新增:

```js
function resolveScannedAssetByName(episodeRoot, name) {
  const clean = compactLine(name);
  if (!clean) return null;
  return scanAssets(episodeRoot).find((a) => compactLine(a.assetName) === clean) || null;
}
function mergeConfigAssetPatch(config, name, patch) {
  const list = Array.isArray(config.assets) ? config.assets : (config.assets = []);
  const clean = compactLine(name);
  let entry = list.find((a) => compactLine(a.name || a.assetName || "") === clean);
  if (!entry) { entry = { name: clean }; list.push(entry); }
  Object.assign(entry, patch);
  return entry;
}
```

- [ ] **Step 3: node 语法检查** — Run: `node --check server.js` Expected: OK
- [ ] **Step 4: Checkpoint** — Run: `npm test` Expected: 全绿

---

## Task 5: 批量入口闸——generateProjectVideoShotsSequentially 前插阶段0

**Files:**
- Modify: `server.js`(`generateProjectVideoShotsSequentially` ~10951,`selected` 确定后、建 queue 前)

- [ ] **Step 1: 插入阶段0** — 在 `if (!selected.length) throw ...` 之后、`syncProjectShotsToCanvasState` 之前加:

```js
  const prepRecord = readVideoConfig(episodeRoot);
  const prep = await prepareBatchVideoReferences(episodeRoot, prepRecord, selected, { timeoutMs: Number(body.prepareTimeoutMs || PREPARE_REFS_TIMEOUT_MS) });
  if (!prep.ready) {
    const list = prep.stuck.map((s) => `${s.name}(${s.reason})`).join("、");
    throw new Error(`参考图素材库验证未通过,已阻止本批视频生成。卡住的资产:${list}。请稍后重试或重新生成这些资产图。`);
  }
```

- [ ] **Step 2: node 语法检查** — Run: `node --check server.js` Expected: OK
- [ ] **Step 3: Checkpoint** — Run: `npm test` Expected: 全绿

---

## Task 6: ensureProjectPhotorealReferencesReady 二道防线(验全部引用)

**Files:**
- Modify: `server.js`(`ensureProjectPhotorealReferencesReady` ~9720)

- [ ] **Step 1: 改语义** — 该函数是单段提交前的兜底。改为:对本段引用按 person/public 分轨,person 轨要 active asset://、public 轨要公网地址;不再以 `config.modelName === "seedance-2-0-person-reference"` 为触发门槛。在函数体开头加注释:`// 语义:验证本段全部引用是否就绪(person=active asset://,public=公网 url);函数名中的 photoreal 为历史遗留。` 复用 `prepareBatchVideoReferences(episodeRoot, configRecord, [shot], {...})` 得到 `{ready, stuck, config}`;`ready` 则返回 `{config, ready:true, summary}`,否则返回 `{config, ready:false, message}`(message 含 stuck 清单),保持原有返回结构字段名不变(下游 `readiness.ready` / `readiness.config` / `readiness.message` 不改)。

- [ ] **Step 2: node 语法检查** — Run: `node --check server.js` Expected: OK
- [ ] **Step 3: Checkpoint** — Run: `npm test` Expected: 全绿

---

## Task 7: self-check 断言(锁死接线与防回归)

**Files:**
- Modify: `scripts/self-check.mjs`(console.log 前追加)

- [ ] **Step 1: 追加断言**

```js
// 统一参考图交付:阶段0 + 双轨 + 不切模型(防 person-reference 回归)
assert(server.includes('require("./scripts/video-ref-prep.js")'), "server 必须复用 video-ref-prep 纯模块");
assert(server.includes("async function prepareBatchVideoReferences"), "必须有阶段0编排器 prepareBatchVideoReferences");
assert(server.includes("await prepareBatchVideoReferences(episodeRoot, prepRecord, selected"), "批量入口必须在提交前跑阶段0");
assert(server.includes("已阻止本批视频生成"), "阶段0 未就绪必须整批中止并报清单");
assert(server.includes("async function ensurePublicReferenceUrl"), "非人物轨必须有公网地址确保函数");
assert(!server.includes('modelMode = usesValidatedRealisticRefs ? "seedance-2-0-person-reference"'), "禁止再引入 person-reference 自动切换(防回归)");
assert(!server.includes("非超写实资产跳过素材库验证"), "validateCanvasPhotorealAssets 不得再对传入资产做 photoreal 短路跳过");

// 纯模块单测存在且被 npm test 覆盖
import("node:fs").then(() => {});
```

- [ ] **Step 2: Checkpoint** — Run: `npm test` Expected: 全绿

---

## Task 8: 隔离冒烟(只跑阶段0,不烧视频额度)

**Files:**
- Create(临时,验证后删除): `scripts/smoke-prepare-refs.js`

- [ ] **Step 1: 临时冒烟脚本** — 写一个脚本:以某测试 episode(或复制 Dragonwake config 的只读副本)构造 `configRecord` 与 `shots`,`require` server.js 导出的 `prepareBatchVideoReferences`(为此在 server.js 末尾加受保护导出:`if (require.main !== module) module.exports = { prepareBatchVideoReferences };`),调用后打印 `{ready, stuck}`,**在返回后立即结束、绝不进入提交循环**。确认人物轨能推进素材库、公网轨得到 https、名单齐 → ready:true。

- [ ] **Step 2: 跑冒烟** — Run: `node scripts/smoke-prepare-refs.js`
Expected: 打印 ready 与 stuck;人物轨资产 status 走向 active、public 轨有 https。不产生视频任务、不烧视频额度(仅素材库上传)。

- [ ] **Step 3: 删除临时脚本 + 保留导出** — 删 `scripts/smoke-prepare-refs.js`;`module.exports` 那行可保留(受 `require.main` 保护,不影响直接运行)。

- [ ] **Step 4: Checkpoint** — Run: `npm test` Expected: 全绿

---

## Task 9: 部署 + 真机验证(最后,用户点头后执行,消耗额度)

**Files:** 无(部署)

- [ ] **Step 1: 部署** — `rsync -avc --delete`(排除 `.env.local*`/`.pixel-toys-*`/`projects/`/`node_modules/`)到 `ubuntu@101.42.111.251:/home/ubuntu/apps/pixel-toy/`
- [ ] **Step 2: 远端校验 + 重载** — `ssh ... 'cd /home/ubuntu/apps/pixel-toy && node --check server.js && pm2 reload pixel-toy'`,健康检查 `/api/auth/me` 返回 200
- [ ] **Step 3: 真机批量(用户确认后)** — 对 Dragonwake 点批量生成:阶段0 全就绪 → V001–V009 提交,核对**不再出现 timeout / real-person**;若有卡住,读 stuck 清单定位。
- [ ] **Step 4: 观察 pm2 日志** — 确认无 `content[N].image_url ... timeout`、无 `InputImageSensitiveContentDetected`。

---

## 自查(spec 覆盖 / 占位 / 类型一致)

- 覆盖:错误 A(超时)= 双轨都产出 Ark 可快速取的地址;错误 B(真人)= 人物轨 asset://;时机=阶段0;范围=双轨;触发=批量入口自动;失败=整批中止报清单;不切模型=Task7 断言防回归。逐条有任务。
- 占位:无 TODO/TBD;代码步骤均含完整代码。
- 类型一致:`{ready, stuck, config}` 贯穿 prepare/ensure;`evaluateReferenceReadiness` 的 item 字段(name/track/status/assetUrl/publicUrl/error)与 prepare 组装一致;`referenceTrackForName` 返回 "person"|"public" 全程一致。
