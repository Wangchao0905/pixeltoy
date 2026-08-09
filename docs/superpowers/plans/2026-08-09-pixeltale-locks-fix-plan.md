# pixeltale 字段锁 + 单集修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 pixeltale 补齐集级锁状态机（open/locked/pinned/dirty）+ 剧本编辑 UI（改内容→pinned）+ unit 阶段单条 finding 定向修复（6 层跨集保护）。

**Architecture:** 扩展现有 `unitLocks`（集级锁 + 状态标记）；新增两个 API（`unit/update` 编辑保存、`unit/fix-issue` 定向修复）；审核 issues 增加 `unit`+`field_path` 锚点；复用现有 `revisionContract` + `compactLockedUnit` 压缩上下文做跨集保护；前端 unit 卡片加编辑模式与 fix 按钮。

**Tech Stack:** Node.js（server.js / pixeltale-agent.js）、原生 JS SPA（public/pixeltale/app.js）、`node --test`/自研 .mjs 测试脚本。

## Global Constraints

- 范围：仅 `arc` / `scenes` 两个 unit 阶段（dialogue 非 unit 不在本期）
- 不部署：本期只实施 + 本地测试，部署等用户下令
- 现有 `status === "locked"` 语义保留（批次通过定稿）；新增 `pinned`/`dirty`
- 自动流程（批次重跑/自动修复/整批 revision）**一律跳过** `locked`/`pinned` 的 unit
- `dirty` 的 unit 不进自动修复，进复核清单
- 6 层跨集保护（设计 §3.4）：压缩上下文 / field_path 跨 unit 拒绝 / 写入隔离 / diff 约束 / continuity 兜底 / 止损回滚
- 每次改动后 `npm test` 101 组全绿；PixTale 缓存戳两个 pixeltale.html 各 2 处同步 bump

---
## 双专家融合补强（2026-08-09 决策，已落入下方 Task）

从 Backend Architect + Prompt Engineer 对比（docs/superpowers/specs/2026-08-09-pixeltale-arch-compare.md）吸收 4 项独有补强：
- **P1 if-match 乐观锁**：`unit/update` 请求带 `if-match: <version>`，版本不匹配 → 409（Task 6）
- **P2 契约版本化**：审核契约升级 `REVIEW_CONTRACT_V2`，issues 锚点带 few-shot 正反例（Task 4）
- **P3 版本快照回滚**：unitLocks 保留前 5 版内容快照（环形缓冲），止损回滚 = 指针回退（Task 5）
- **P4 claim 互斥**：修复/编辑任务复用 `_claim_project` 单写者锁（Task 5/6）

## 文件结构

- `server/pixeltale-agent.js` — 锁状态机函数、审核锚点契约、修订 diff 校验、单 unit 审核
- `server.js` — `/api/pixeltale/unit/update` + `/api/pixeltale/unit/fix-issue` 路由（幂等 + schema 校验）
- `public/pixeltale/app.js` — 编辑 UI、pinned/dirty 徽标、fix 按钮
- `public/pixeltale/styles.css` — 编辑模式/徽标样式
- `scripts/pixeltale-unit-locks.test.mjs` — 锁状态机 + 守卫 + dirty 传播测试
- `scripts/pixeltale-unit-fix.test.mjs` — 单集修复（锚点/diff/回滚）测试

---

### Task 1: 锁状态机扩展（unitLocks 状态迁移）

**Files:**
- Modify: `server/pixeltale-agent.js`（unitLocks 构造与 helper 附近）
- Test: `scripts/pixeltale-unit-locks.test.mjs`

**Interfaces:**
- Produces: `unitLockStatus(state, stage, unit)` → "open"|"locked"|"pinned"|"dirty"；`markUnitPinned(state, stage, unit, by)`；`markUnitDirty(state, stage, unit, reason)`；`isUnitProtected(state, stage, unit)` → locked|pinned 时 true

- [ ] **Step 1: 写失败测试**

```js
// scripts/pixeltale-unit-locks.test.mjs
import assert from "node:assert/strict";
import { markUnitPinned, markUnitDirty, isUnitProtected, unitLockStatus } from "../server/pixeltale-agent.js";

function state() { return { unitLocks: { arc: { 1: { status: "locked", version: 1 } }, scenes: {} } }; }

const s1 = state();
markUnitPinned(s1, "arc", 1, "human");
assert.equal(s1.unitLocks.arc[1].status, "pinned");
assert.equal(s1.unitLocks.arc[1].pinnedBy, "human");
assert.ok(s1.unitLocks.arc[1].pinnedAt);
assert.equal(isUnitProtected(s1, "arc", 1), true, "pinned 必须被保护");

const s2 = state();
markUnitDirty(s2, "arc", 1, "proposal 重跑");
assert.equal(s2.unitLocks.arc[1].status, "dirty");
assert.equal(s2.unitLocks.arc[1].dirtyReason, "proposal 重跑");
assert.equal(isUnitProtected(s2, "arc", 1), false, "dirty 不被锁定，但也不该被自动覆盖（见 Task 2）");
assert.equal(unitLockStatus(s2, "arc", 2), "open", "未生成集为 open");
```

- [ ] **Step 2: 跑测试确认失败** — `node scripts/pixeltale-unit-locks.test.mjs` → 报 `markUnitPinned is not a function`

- [ ] **Step 3: 实现最小代码**（pixeltale-agent.js 新增导出）

```js
export function unitLockStatus(state, stage, unit) {
  const lock = asObject(state?.unitLocks?.[stage]?.[unit]);
  return lock.status === "locked" || lock.status === "pinned" || lock.status === "dirty" ? lock.status : "open";
}
export function isUnitProtected(state, stage, unit) {
  const st = unitLockStatus(state, stage, unit);
  return st === "locked" || st === "pinned";
}
export function markUnitPinned(state, stage, unit, by) {
  const locks = (state.unitLocks ??= {});
  locks[stage] ??= {};
  locks[stage][unit] = { ...(locks[stage][unit] || {}), status: "pinned", pinnedBy: by, pinnedAt: new Date().toISOString() };
}
export function markUnitDirty(state, stage, unit, reason) {
  const locks = (state.unitLocks ??= {});
  locks[stage] ??= {};
  const prev = locks[stage][unit] || {};
  if (prev.status === "pinned") return; // pinned 优先级高于 dirty：人工定稿不被依赖变更降级
  locks[stage][unit] = { ...prev, status: "dirty", dirtyReason: reason, dirtyAt: new Date().toISOString() };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node scripts/pixeltale-unit-locks.test.mjs` → 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/pixeltale-agent.js scripts/pixeltale-unit-locks.test.mjs
git commit -m "feat(pixeltale): unit lock state machine (open/locked/pinned/dirty)"
```

---

### Task 2: 自动流程锁守卫（批次重跑/自动修复跳过 protected unit）

**Files:**
- Modify: `server/pixeltale-agent.js`（批次重跑/自动修复/整批 revision 的 unit 筛选处，`lockedUnitNumbers`/`pendingUnitNumbers` 附近）
- Test: `scripts/pixeltale-unit-locks.test.mjs`

**Interfaces:**
- Consumes: `isUnitProtected`（Task 1）
- Produces: `autoRepairableUnits(state, stage, pending)` → 过滤掉 protected unit；`dirtyUnits(state, stage)` → dirty 清单

- [ ] **Step 1: 写失败测试**

```js
import { autoRepairableUnits, dirtyUnits } from "../server/pixeltale-agent.js";

const s = { unitLocks: { arc: { 1: { status: "locked" }, 2: { status: "pinned", pinnedBy: "human" }, 3: { status: "dirty", dirtyReason: "上游变更" } } } };
assert.deepEqual(autoRepairableUnits(s, "arc", [1, 2, 3, 4]), [4], "locked/pinned 不进自动修复，dirty 也不进");
assert.deepEqual(dirtyUnits(s, "arc"), [3], "dirty 进复核清单");
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

```js
export function autoRepairableUnits(state, stage, pending) {
  return normalizeUnitNumbers(pending).filter((u) => unitLockStatus(state, stage, u) === "open");
}
export function dirtyUnits(state, stage) {
  return Object.keys(asObject(state?.unitLocks?.[stage])).map(Number)
    .filter((u) => unitLockStatus(state, stage, u) === "dirty").sort((a, b) => a - b);
}
```

- [ ] **Step 4: 跑测试确认通过** — `node scripts/pixeltale-unit-locks.test.mjs` PASS

- [ ] **Step 5: 提交** — `git commit -m "feat(pixeltale): auto-repair skips locked/pinned/dirty units"`

---

### Task 3: 依赖 dirty 传播（上游 confirmArtifact → 下游 unit dirty）

**Files:**
- Modify: `server/pixeltale-agent.js`（`confirmArtifact` 函数，2864 行附近）
- Test: `scripts/pixeltale-unit-locks.test.mjs`

**Interfaces:**
- Consumes: `markUnitDirty`（Task 1）
- Produces: `propagateDirty(state, upstreamStage)` — 上游阶段确认时，下游 unit 阶段已有 locked/pinned 的集标 dirty（pinned 例外：pinned 保持 pinned，仅记录 dirtyReason 供复核参考）

- [ ] **Step 1: 写失败测试**

```js
import { propagateDirty } from "../server/pixeltale-agent.js";

// proposal 重跑确认 → arc 已锁定集标 dirty
const s = { unitLocks: { arc: { 1: { status: "locked" }, 2: { status: "pinned", pinnedBy: "human" } } } };
propagateDirty(s, "proposal", "proposal 被人工重跑");
assert.equal(s.unitLocks.arc[1].status, "dirty");
assert.equal(s.unitLocks.arc[1].dirtyReason.includes("proposal"), true);
assert.equal(s.unitLocks.arc[2].status, "pinned", "pinned 不被降级为 dirty");
assert.ok(s.unitLocks.arc[2].dirtyReason, "pinned 集记录 dirty 提示供人工复核");
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**（在 confirmArtifact 内调用；新增导出函数）

```js
const UNIT_ORDER = { characters: ["arc", "scenes"], arc: ["scenes"] };
export function propagateDirty(state, upstreamStage, reason) {
  const downstream = UNIT_ORDER[upstreamStage] || [];
  for (const stage of downstream) {
    for (const [unit, lock] of Object.entries(asObject(state?.unitLocks?.[stage]) || {})) {
      if (lock.status === "locked") markUnitDirty(state, stage, Number(unit), reason);
      else if (lock.status === "pinned") state.unitLocks[stage][unit].dirtyReason = reason; // 提示不降级
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交** — `git commit -m "feat(pixeltale): downstream units marked dirty on upstream confirm (pinned kept)"`

---

### Task 4: 审核锚点契约（issues 增加 unit + field_path）

**Files:**
- Modify: `server/pixeltale-agent.js`（stageUserPrompt/reviewUserPrompt 输出契约 + validateReview）
- Test: `scripts/pixeltale-unit-fix.test.mjs`

**Interfaces:**
- Produces: 审核 issues 每条含 `unit`（集号）+ `field_path`（如 `scenes[0].beats[2].line`）；`extractUnitAnchor(issue)` → unit 或 null

- [ ] **Step 1: 写失败测试**

```js
import { validateReview } from "../server/pixeltale-agent.js";
const review = { pass: false, score: 60, findings: ["x"], required_changes: ["y"],
  issues: [{ criterion_id: "S_CAUSAL", tag: "因果断裂", dimension: "logic", severity: "high", feedback: "f", fix: "g", unit: 6, field_path: "scenes[0].beats[2].line" }],
  dimensions: {}, checks: {} };
// validateReview 应接受带 unit/field_path 的 issue（不抛错）
const ok = validateReview(review, { requireDimensions: false });
assert.equal(ok.pass, false);
```

- [ ] **Step 2: 跑测试确认失败**（validateReview 因缺 dimensions 抛错或契约不认 unit 字段——按实际失败修）

- [ ] **Step 3: 实现**
  - `stageUserPrompt` / `reviewUserPrompt` 输出契约 issues 定义追加：`"unit": 集号（仅 unit 阶段必填）`, `"field_path": "字段定位路径（如 scenes[0].beats[2].line）"`
  - `validateReview` 对 unit 阶段的 issues 校验：缺 `unit` 或 `field_path` → 该 issue 标记 `unfixable: true`（不拒绝整条审核，单修时跳过）
  - 新增 `export function extractUnitAnchor(issue)`：返回 `Number(issue.unit)`（非法返回 null）

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交** — `git commit -m "feat(pixeltale): review issues carry unit + field_path anchors"`

---

### Task 5: fix-issue API（定向修订 + diff 约束 + 增量审核 + 止损回滚）

**Files:**
- Create: `server/pixeltale-unit-fix.js`（单集修复逻辑，独立小文件）
- Modify: `server.js`（路由 `/api/pixeltale/unit/fix-issue`）
- Test: `scripts/pixeltale-unit-fix.test.mjs`

**Interfaces:**
- Consumes: `extractUnitAnchor`（Task 4）、`isUnitProtected`（Task 1）、`compactLockedUnit`、`revisionUserPrompt`
- Produces: `fixUnitIssue({ state, stage, unit, issue, engine })` → `{ status: "approved"|"needs_review"|"rolled-back", state }`
  - `assertAnchorInUnit(issue, unit)` — field_path 前缀必须属于请求 unit，否则抛错（跨 unit 拒绝）

- [ ] **Step 1: 写失败测试**

```js
import { fixUnitIssue, assertAnchorInUnit } from "../server/pixeltale-unit-fix.js";
import assert from "node:assert/strict";

assert.throws(() => assertAnchorInUnit({ unit: 6, field_path: "scenes[0].beats[2].line" }, 6), undefined, "同 unit 锚点应通过");
assert.throws(() => assertAnchorInUnit({ unit: 7, field_path: "scenes[0].beats[2].line" }, 6), "跨 unit 锚点必须拒绝");

// 止损回滚：修订后新问题数 ≥ 修复前 → rolled-back
const state = { artifacts: { scenes: { units: { 6: { scenes: [{ location: "L", beats: [{ speaker: "A", line: "旧", action: "a" }] }] } } } },
  unitLocks: { scenes: {} }, evaluation: { 6: { pass: false, issues: [ { unit: 6, field_path: "scenes[0].beats[0].line" } ] } } };
const writer = { async chat() { return JSON.stringify({ scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }] }] }); } };
const reviewer = { async chat() { return JSON.stringify({ pass: false, score: 50, issues: [ { unit: 6, field_path: "scenes[0].beats[0].line" }, { unit: 6, field_path: "scenes[0].beats[0].action" } ] }); } };
const result = await fixUnitIssue({ state, stage: "scenes", unit: 6, issue: { unit: 6, field_path: "scenes[0].beats[0].line" }, writer, reviewer });
assert.equal(result.status, "rolled-back", "问题不减反增必须回滚");
assert.equal(state.artifacts.scenes.units[6].scenes[0].beats[0].line, "旧", "回滚后恢复原版本");
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**（server/pixeltale-unit-fix.js）
  - `assertAnchorInUnit(issue, unit)`：`Number(issue.unit) !== unit` → throw；field_path 非字符串 → throw
  - 修订 prompt：复用 `revisionUserPrompt`，`revisionContract.items = [issue]`，`unitScope = [unit]`，`lockedContext = compactLockedUnit 的相邻集`
  - **diff 约束**：修订后对比原 unit——只有 `field_path` 命中的 scene/beat 允许变化；未点名逐字不变（参考 Pixel Writer `_revision_respects_scope` 逻辑）
  - **增量审核**：只对修复后的 unit 跑一次审核（`reviewUserPrompt` + 单个 unit artifact）——pass 且问题数 ≤ 修复前 → `approved` + `markUnitPinned`（不，锁定：`status="locked"` + version+1）
  - **止损回滚**：新问题数 ≥ 修复前 → 恢复原 unit 内容 + 原 evaluation → `rolled-back`
  - **上限**：连续 2 轮同 finding 未消 → `needs_review`（复用 humanOverride 放行路径）

- [ ] **Step 4: 跑测试确认通过** — `node scripts/pixeltale-unit-fix.test.mjs` PASS

- [ ] **Step 5: 提交** — `git commit -m "feat(pixeltale): per-unit issue fix with diff guard + loss rollback"`

---

### Task 6: unit-update API（编辑保存 → pinned + provenance + schema 校验）

**Files:**
- Modify: `server.js`（路由 `/api/pixeltale/unit/update`）
- Test: `scripts/pixeltale-unit-locks.test.mjs`（API 层）

**Interfaces:**
- Consumes: `markUnitPinned`（Task 1）、unit 结构契约（`validateContent`）
- Produces: `POST /api/pixeltale/unit/update` → `{ ok, state }`

- [ ] **Step 1: 写失败测试**（API 层，参照 pixeltale-run-jobs 的 mock router 模式）

```js
// 非法 unit 结构（缺 scenes/缺 beats）→ 400
// 合法编辑 → unitLocks[stage][unit].status === "pinned" + provenance 记录
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**（server.js 路由）
  - body: `{ projectId, stage, unit, patchedUnit }`
  - 校验：stage ∈ {arc, scenes}；unit 已存在（locked/pinned/open）；`patchedUnit` 过 `validateContent` 契约
  - 写 `artifacts[stage].units[unit] = patchedUnit` → `markUnitPinned(state, stage, unit, "human")`
  - provenance：state.unitLocks[stage][unit].provenance 追加 `{ by: "human", ts, action: "edit" }`

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交** — `git commit -m "feat(pixeltale): unit edit API pins the unit"`

---

### Task 7: 前端编辑 UI + pinned/dirty 徽标 + fix 按钮

**Files:**
- Modify: `public/pixeltale/app.js`（unit 卡片渲染、编辑模式、事件）
- Modify: `public/pixeltale/styles.css`
- Modify: `public/pixeltale.html` + `public/pixeltale/pixeltale.html`（缓存戳 r20→r21，各 2 处）

**Interfaces:**
- Consumes: Task 5/6 的 API

- [ ] **Step 1: 写失败测试**（pixeltale-workflow.test.mjs 或新守卫）

```js
assert.match(appJs, /unit\/update/, "编辑保存走 unit/update API");
assert.match(appJs, /unit\/fix-issue/, "单集修复走 unit/fix-issue API");
assert.match(appJs, /pinned|已人工修改|人工定稿/, "pinned 状态有徽标文案");
assert.match(appJs, /dirty/, "dirty 状态有标记");
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**
  - unit 卡片（arc 集卡片/scenes 集卡片）：状态为 pinned 显示「✍ 人工定稿」徽标 + 禁用「重新生成」主按钮（或强确认）；dirty 显示「⚠ 依赖已变」徽标 + 复核提示
  - 「编辑」按钮（仅 unit 阶段）→ 内联编辑区（场景/节拍/对白 textarea）→ 保存调 `unit/update` → 刷新显示 pinned
  - 审核建议列表（issues）→ 有 `unit`+`field_path` 锚点的显示「修复此集」按钮 → 调 `unit/fix-issue` → 结果提示（通过/需人工/已回滚）

- [ ] **Step 4: 跑测试确认通过** — `npm test`（含守卫）全绿

- [ ] **Step 5: 提交** — `git commit -m "feat(pixeltale): edit UI + pinned/dirty badges + per-unit fix button"`

---

## Self-Review

1. **Spec 覆盖**：设计 §1 锁状态机→Task1-3；§2 编辑 UI→Task6-7；§3.1 锚点→Task4；§3.2 单条修复→Task5；§3.4 六层保护→Task5（跨 unit 拒绝/写入隔离/diff/continuity 兜底/回滚）+Task3（dirty）；§5 测试→各 Task；§6 边界（dialogue/字段级/intent）→不在任务内 ✅
2. **占位符**：Task5/6 的测试有 `...` 缩写（API 层 mock 细节）——实施时按 pixeltale-run-jobs.test.mjs 现有模式补全；标注明确
3. **类型一致性**：`markUnitPinned(state, stage, unit, by)` / `markUnitDirty(state, stage, unit, reason)` / `fixUnitIssue({state, stage, unit, issue, writer, reviewer})` 跨 Task 一致 ✅

## 执行交接

计划完成，保存于 `docs/superpowers/plans/2026-08-09-pixeltale-locks-fix-plan.md`。

**两种执行方式：**
1. **Subagent-Driven（推荐）** — 每个 task 派新 subagent，task 间 review
2. **Inline Execution** — 本会话用 executing-plans 批量执行 + 检查点

**（注意：用户要求"只设计不部署"——本计划到"实施+本地测试"为止，部署另等指令）**
