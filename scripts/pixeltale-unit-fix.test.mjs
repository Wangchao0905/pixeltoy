// pixeltale 单集修复测试：锚点校验 / diff 约束 / 止损回滚 / 版本快照 / pinned 拒绝
import assert from "node:assert/strict";
import { assertAnchorInUnit, findDiffPaths, respectsScope, fixUnitIssue } from "../server/pixeltale-unit-fix.js";

// ---- 锚点校验 ----
{
  assertAnchorInUnit({ unit: 6, field_path: "scenes[0].beats[2].line" }, 6); // 同 unit 通过
  assert.throws(() => assertAnchorInUnit({ unit: 7, field_path: "scenes[0].beats[2].line" }, 6), /跨集锚点拒绝/, "跨 unit 锚点必须拒绝");
  assert.throws(() => assertAnchorInUnit({ unit: 6, field_path: "" }, 6), /缺少 field_path/, "缺锚点必须拒绝");
}

// ---- findDiffPaths ----
{
  const a = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "旧", action: "a" }] }] };
  const b = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }] }] };
  const diffs = findDiffPaths(a, b);
  assert.deepEqual(diffs, ["scenes.0.beats.0.line"], "只检测到 line 变化");
}

// ---- respectsScope ----
{
  const orig = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "旧", action: "a" }, { speaker: "B", line: "b2", action: "b" }] }] };
  const hitLine = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }, { speaker: "B", line: "b2", action: "b" }] }] };
  assert.equal(respectsScope(orig, hitLine, "scenes[0].beats[0].line"), true, "命中行变化合规");

  const touchedOther = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }, { speaker: "B", line: "被改", action: "b" }] }] };
  assert.equal(respectsScope(orig, touchedOther, "scenes[0].beats[0].line"), false, "改动未点名节拍必须越界");

  const addedBeat = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }, { speaker: "B", line: "b2", action: "b" }, { speaker: "C", line: "x", action: "y" }] }] };
  assert.equal(respectsScope(orig, addedBeat, "scenes[0].beats[0].line"), false, "新增未点名节拍必须越界");
}

// ---- fixUnitIssue：止损回滚 ----
{
  const unitContent = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "旧", action: "a" }] }] };
  const state = {
    artifacts: { scenes: { units: { 6: JSON.parse(JSON.stringify(unitContent)) } } },
    unitLocks: { scenes: { 6: { status: "open", version: 1 } } },
  };
  const writer = { async chat() { return JSON.stringify({ scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }] }] }); } };
  const reviewer = { async chat() { return JSON.stringify({ pass: false, score: 50, issues: [
    { unit: 6, field_path: "scenes[0].beats[0].line" },
    { unit: 6, field_path: "scenes[0].beats[0].action" },
  ] }); } };
  const result = await fixUnitIssue({ state, stage: "scenes", unit: 6, issue: { unit: 6, field_path: "scenes[0].beats[0].line" }, writer, reviewer });
  assert.equal(result.status, "rolled-back", "问题不减反增必须回滚");
  assert.equal(state.artifacts.scenes.units[6].scenes[0].beats[0].line, "旧", "回滚恢复原版本");
  assert.equal(state.unitLocks.scenes[6].status, "dirty", "回滚后标 dirty");
}

// ---- fixUnitIssue：通过 → locked + 快照 ----
{
  const unitContent = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "旧", action: "a" }] }] };
  const state = {
    artifacts: { scenes: { units: { 6: JSON.parse(JSON.stringify(unitContent)) } } },
    unitLocks: { scenes: { 6: { status: "open", version: 1 } } },
  };
  const writer = { async chat() { return JSON.stringify({ scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }] }] }); } };
  const reviewer = { async chat() { return JSON.stringify({ pass: true, score: 90, issues: [] }); } };
  const result = await fixUnitIssue({ state, stage: "scenes", unit: 6, issue: { unit: 6, field_path: "scenes[0].beats[0].line" }, writer, reviewer });
  assert.equal(result.status, "approved", "修复通过应 approved");
  assert.equal(state.artifacts.scenes.units[6].scenes[0].beats[0].line, "新");
  assert.equal(state.unitLocks.scenes[6].status, "locked", "通过后锁定");
  assert.equal(state.unitLocks.scenes[6].version, 2, "版本递增");
  assert.equal(state.unitLocks.scenes[6].snapshots.length, 1, "保留快照");
}

// ---- fixUnitIssue：越界修订 → 回滚（不写入）----
{
  const unitContent = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "旧", action: "a" }, { speaker: "B", line: "b2", action: "b" }] }] };
  const state = {
    artifacts: { scenes: { units: { 6: JSON.parse(JSON.stringify(unitContent)) } } },
    unitLocks: { scenes: { 6: { status: "open", version: 1 } } },
  };
  const writer = { async chat() { return JSON.stringify({ scenes: [{ location: "L", beats: [{ speaker: "A", line: "新", action: "a" }, { speaker: "B", line: "被改", action: "b" }] }] }); } };
  const reviewer = { async chat() { throw new Error("不应走到审核"); } };
  const result = await fixUnitIssue({ state, stage: "scenes", unit: 6, issue: { unit: 6, field_path: "scenes[0].beats[0].line" }, writer, reviewer });
  assert.equal(result.status, "rolled-back", "越界必须回滚不写入");
  assert.equal(state.artifacts.scenes.units[6].scenes[0].beats[0].line, "旧");
}

// ---- pinned 拒绝 ----
{
  const unitContent = { scenes: [{ location: "L", beats: [{ speaker: "A", line: "旧", action: "a" }] }] };
  const state = {
    artifacts: { scenes: { units: { 6: JSON.parse(JSON.stringify(unitContent)) } } },
    unitLocks: { scenes: { 6: { status: "pinned", pinnedBy: "human" } } },
  };
  await assert.rejects(() => fixUnitIssue({ state, stage: "scenes", unit: 6, issue: { unit: 6, field_path: "scenes[0].beats[0].line" }, writer: {}, reviewer: {} }), /pinned/, "pinned 集禁止自动修复");
}

console.log("pixeltale unit-fix tests passed");
