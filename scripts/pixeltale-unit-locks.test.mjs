// pixeltale 集级锁状态机测试：open/locked/pinned/dirty + 自动修复守卫 + dirty 清单
import assert from "node:assert/strict";
import { markUnitPinned, markUnitDirty, isUnitProtected, unitLockStatus, autoRepairableUnits, dirtyUnits, propagateDirty } from "../server/pixeltale-agent.js";

function state() {
  return { unitLocks: { arc: { 1: { status: "locked", version: 1 } }, scenes: {} } };
}

// ---- Task 1: 状态迁移 ----
{
  const s = state();
  markUnitPinned(s, "arc", 1, "human");
  assert.equal(s.unitLocks.arc[1].status, "pinned");
  assert.equal(s.unitLocks.arc[1].pinnedBy, "human");
  assert.ok(s.unitLocks.arc[1].pinnedAt, "pinned 必须带时间戳");
  assert.equal(isUnitProtected(s, "arc", 1), true, "pinned 必须被保护");

  const s2 = state();
  markUnitDirty(s2, "arc", 1, "proposal 重跑");
  assert.equal(s2.unitLocks.arc[1].status, "dirty");
  assert.equal(s2.unitLocks.arc[1].dirtyReason, "proposal 重跑");
  assert.equal(isUnitProtected(s2, "arc", 1), false, "dirty 不被锁定保护（但也不被自动覆盖，见守卫）");
  assert.equal(unitLockStatus(s2, "arc", 2), "open", "未生成集为 open");
  assert.equal(unitLockStatus(s2, "scenes", 9), "open", "其他 stage 未生成集为 open");
}

// ---- pinned 不降级 ----
{
  const s = state();
  markUnitPinned(s, "arc", 1, "human");
  markUnitDirty(s, "arc", 1, "上游变更");
  assert.equal(s.unitLocks.arc[1].status, "pinned", "pinned 不被 dirty 降级");
  assert.ok(s.unitLocks.arc[1].dirtyReason, "pinned 记录 dirty 提示供复核");
}

// ---- Task 2: 自动修复守卫 + dirty 清单 ----
{
  const s = { unitLocks: { arc: { 1: { status: "locked" }, 2: { status: "pinned", pinnedBy: "human" }, 3: { status: "dirty", dirtyReason: "上游变更" } } } };
  assert.deepEqual(autoRepairableUnits(s, "arc", [1, 2, 3, 4]), [4], "locked/pinned/dirty 都不进自动修复");
  assert.deepEqual(autoRepairableUnits(s, "arc", [1, 2]), [], "全保护时为空");
  assert.deepEqual(dirtyUnits(s, "arc"), [3], "dirty 进复核清单");
  assert.deepEqual(dirtyUnits(s, "scenes"), [], "无 dirty 时为空");
}

// ---- Task 3: 依赖 dirty 传播 ----
{
  const s = { unitLocks: { arc: { 1: { status: "locked" }, 2: { status: "pinned", pinnedBy: "human" } }, scenes: { 3: { status: "locked" } } } };
  propagateDirty(s, "characters", "characters 重跑确认，依赖已变更");
  assert.equal(s.unitLocks.arc[1].status, "dirty", "locked 集被标 dirty");
  assert.ok(s.unitLocks.arc[1].dirtyReason.includes("characters"), "dirty 记录原因");
  assert.equal(s.unitLocks.arc[2].status, "pinned", "pinned 不降级");
  assert.ok(s.unitLocks.arc[2].dirtyReason, "pinned 记录提示");
  assert.equal(s.unitLocks.scenes[3].status, "dirty", "scenes 也是 characters 下游");
}

console.log("pixeltale unit-locks tests passed");
