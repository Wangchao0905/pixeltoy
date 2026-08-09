// pixeltale 单集修复：逐条 finding 定向修订（6 层跨集保护）
// 2026-08-09 · 复用 diff 约束/增量审核/版本快照回滚（双专家 P3 快照、P4 互斥由调用方保证）
const { unitLockStatus } = require("./pixeltale-agent.js");

function assertAnchorInUnit(issue, unit) {
  const u = Number(issue?.unit);
  const fp = String(issue?.field_path || "").trim();
  if (!Number.isInteger(u) || u <= 0 || u !== unit) {
    const err = new Error(`锚点集号不匹配（issue.unit=${u}，请求 unit=${unit}）——跨集锚点拒绝`);
    err.code = "ANCHOR_OUT_OF_SCOPE";
    throw err;
  }
  if (!fp) {
    const err = new Error("issue 缺少 field_path 锚点，无法单修");
    err.code = "ANCHOR_MISSING";
    throw err;
  }
}

// 深度找差异路径（返回 ["scenes[0].beats[2].line", ...]）
function findDiffPaths(a, b, prefix = "") {
  const out = [];
  if (a === b) return out;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return [prefix || "$"];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (!(k in a)) out.push(p);
    else if (!(k in b)) out.push(p);
    else out.push(...findDiffPaths(a[k], b[k], p));
  }
  return out;
}

// diff 约束：所有差异路径必须落在 field_path 前缀内（如 scenes[0].beats[2].line）
// 允许整段命中（prefix 精确匹配）或命中段内字段（如 line/action）
function respectsScope(original, revised, fieldPath) {
  const diffs = findDiffPaths(original, revised);
  if (diffs.length === 0) return true; // 无差异 = 什么都没改（视为合规，交由审核判定无改进）
  const norm = fieldPath.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  const fieldSegs = norm.split(".");
  const allowedPrefixes = [];
  for (let i = 0; i < fieldSegs.length; i++) allowedPrefixes.push(fieldSegs.slice(0, i + 1).join("."));
  // 数组索引归一化：scenes[0].beats[2].line → scenes.0.beats.2.line；diff 路径同格式
  const allowed = new Set(allowedPrefixes);
  return diffs.every((d) => {
    const dd = d.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
    return allowed.has(dd) || allowed.has(dd.split(".").slice(0, fieldSegs.length).join("."));
  });
}

function countIssues(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v?.issues) ? v.issues.length : 0;
  } catch {
    return -1;
  }
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

async function fixUnitIssue({ state, stage, unit, issue, writer, reviewer, now = () => new Date() }) {
  assertAnchorInUnit(issue, unit);
  const unitContent = state?.artifacts?.[stage]?.units?.[unit];
  if (!unitContent) {
    const err = new Error(`第 ${unit} 集尚未生成，无法修复`);
    err.code = "UNIT_MISSING";
    throw err;
  }
  const locks = (state.unitLocks ??= {});
  locks[stage] ??= {};
  const lock = locks[stage][unit] || {};
  if (lock.status === "pinned") {
    const err = new Error(`第 ${unit} 集已被人工定稿（pinned），自动修复被禁止`);
    err.code = "UNIT_PINNED";
    throw err;
  }

  // P3 版本快照（环形保留前 5 版）
  const version = Number(lock.version || 0);
  const snapshots = Array.isArray(lock.snapshots) ? lock.snapshots.slice(-4) : [];
  snapshots.push({ version, content: JSON.parse(JSON.stringify(unitContent)), at: now().toISOString() });

  // 修订 prompt：显式逐字复制约束（Prompt Engineer 方案 B）
  const prompt = `你是短剧编剧，定向修复单集的一个问题。只修改以下 field_path 命中的内容：
field_path: ${issue.field_path}
问题（${issue.tag || "审核问题"}）：${issue.feedback || ""}
修改建议：${issue.fix || ""}
硬约束：
- 只允许 field_path 命中的字段变化；其余 scene/beat 逐字复制，禁止增删未点名的节拍/场景/集。
- 保持语言与风格一致。
原集内容：${JSON.stringify(unitContent, null, 0)}
输出：修改后的完整单集 JSON（与输入结构完全一致）。`;

  const raw = String((await writer.chat([{ role: "user", content: prompt }], { temperature: 0.3, max_tokens: 12000 })) || "");
  let revised;
  try {
    revised = JSON.parse(extractJson(raw));
  } catch {
    return { status: "needs_review", state, reason: "修订输出非法 JSON" };
  }

  // diff 约束：越界 → 回滚（不写入）
  if (!respectsScope(unitContent, revised, String(issue.field_path || ""))) {
    return { status: "rolled-back", state, reason: "修订越界（改动了未点名内容），已拒绝写入" };
  }

  // 增量审核（只审该 unit；continuity 维度兜底跨集衔接）
  const reviewPrompt = `你是短剧审核编辑。只审核第 ${unit} 集（不涉及其他集）。
本集内容：${JSON.stringify(revised, null, 0)}
输出 JSON：{"pass":bool,"score":0-100,"issues":[{"severity":"high|medium|low","tag":"短标签","feedback":"证据","fix":"建议","unit":${unit},"field_path":"定位路径"}]}
规则：重点查连续性（与前集衔接/角色状态延续/悬念推进）、设定一致、该 issue 是否已修复；破坏跨集衔接必须 pass=false。`;
  let verdictRaw;
  try {
    verdictRaw = String((await reviewer.chat([{ role: "user", content: reviewPrompt }], { temperature: 0.2, max_tokens: 4000 })) || "");
  } catch {
    return { status: "needs_review", state, reason: "增量审核调用失败" };
  }
  const beforeCount = 1; // 修复前至少该 issue
  const afterCount = countIssues(verdictRaw);

  if (afterCount < 0) return { status: "needs_review", state, reason: "审核输出无法解析" };

  // 写入（只写单 unit 槽——写入隔离）
  state.artifacts[stage].units[unit] = revised;
  const ok = (() => { try { const v = JSON.parse(extractJson(verdictRaw)); return v.pass === true; } catch { return false; } })();

  if (ok && afterCount <= beforeCount) {
    locks[stage][unit] = { ...lock, status: "locked", version: version + 1, snapshots, fixedAt: now().toISOString(), lastFix: { issue: String(issue.tag || ""), fieldPath: String(issue.field_path || "") } };
    return { status: "approved", state };
  }
  if (afterCount >= beforeCount) {
    // 止损回滚：恢复快照 + 原审核记录
    state.artifacts[stage].units[unit] = unitContent;
    locks[stage][unit] = { ...lock, status: "dirty", dirtyReason: "自动修复未改善，已回滚", dirtyAt: now().toISOString(), version };
    return { status: "rolled-back", state, reason: `修复后问题数 ${afterCount} ≥ 修复前 ${beforeCount}，已恢复原版本` };
  }
  locks[stage][unit] = { ...lock, version: version + 1, snapshots, lastFix: { issue: String(issue.tag || ""), fieldPath: String(issue.field_path || "") } };
  return { status: "needs_review", state };
}

module.exports = { assertAnchorInUnit, findDiffPaths, respectsScope, fixUnitIssue };
