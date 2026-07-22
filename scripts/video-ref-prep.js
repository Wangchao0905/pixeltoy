"use strict";

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

function evaluateReferenceReadiness(items) {
  const stuck = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (it && it.track === "person") {
      const ok = it.status === "active" && /^asset:\/\//i.test(String(it.assetUrl || ""));
      if (!ok) stuck.push({ name: it.name, track: "person", status: it.status || "pending", reason: it.error || "素材库未 active" });
    } else {
      const ok = /^https:\/\//i.test(String((it && it.publicUrl) || ""));
      if (!ok) stuck.push({ name: it && it.name, track: "public", status: (it && it.status) || "no-source", reason: (it && it.error) || "缺少可用公网 https 图源" });
    }
  }
  return { ready: stuck.length === 0, stuck };
}


// 有界并发工作池:最多 limit 个 worker 同时进行,按序返回结果。用于故事板模式并行出片。
async function runWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const max = Math.max(1, Number(limit) || 1);
  const results = new Array(list.length);
  let next = 0;
  async function runner() {
    while (next < list.length) {
      const i = next;
      next += 1;
      results[i] = await worker(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, list.length) }, () => runner()));
  return results;
}

// 依赖感知的有界并发池:仅当一项的依赖已成功完成才下发它;最多 limit 个同时进行;结果按原序返回。
// 用于首尾帧模式——尾帧链(useTailFrame 续接)内部按序串行,链与链、链与独立段之间并发。
// options.keyOf(item,i)  -> 该项的唯一 key(默认下标)。
// options.depOf(item,i)  -> 该项依赖的另一项 key(空串=无依赖;仅本批内的 key 生效)。
// options.onBlocked(item,depKey,i) -> 当依赖失败导致本项被阻塞(不下发)时调用,其返回值作为该项结果。
// worker(item,i) 抛错或返回 { failed:true } 视为失败,会阻塞其直接/间接下游。假设依赖无环(尾帧链有向无环)。
async function runWithDependencies(items, limit, worker, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  if (!list.length) return results;
  const max = Math.max(1, Number(limit) || 1);
  const keyOf = typeof options.keyOf === "function" ? options.keyOf : (_item, i) => String(i);
  const depOf = typeof options.depOf === "function" ? options.depOf : () => "";
  const onBlocked = typeof options.onBlocked === "function" ? options.onBlocked : null;

  const keys = list.map((item, i) => String(keyOf(item, i) || i));
  const keySet = new Set(keys);
  const deps = list.map((item, i) => {
    const d = String(depOf(item, i) || "");
    return d && keySet.has(d) ? d : ""; // 只认本批内依赖;不在本批的依赖交给 worker 自身的门槛处理
  });

  const doneOk = new Set();
  const doneBad = new Set();
  const settled = new Array(list.length).fill(false);
  const inflight = new Set();

  return await new Promise((resolve) => {
    const settle = (i, value, bad) => {
      results[i] = value;
      settled[i] = true;
      (bad ? doneBad : doneOk).add(keys[i]);
    };
    const start = (i) => {
      inflight.add(i);
      Promise.resolve()
        .then(() => worker(list[i], i))
        .then((value) => {
          inflight.delete(i);
          settle(i, value, !!(value && value.failed === true));
          pump();
        })
        .catch((error) => {
          inflight.delete(i);
          settle(i, { failed: true, error: error && error.message ? error.message : String(error) }, true);
          pump();
        });
    };
    const pump = () => {
      // 1) 依赖已失败 -> 阻塞本项(可级联到更下游),不下发 worker。
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < list.length; i += 1) {
          if (settled[i] || inflight.has(i)) continue;
          if (deps[i] && doneBad.has(deps[i])) {
            const value = onBlocked ? onBlocked(list[i], deps[i], i) : { failed: true, blocked: true, dependency: deps[i] };
            settle(i, value, true);
            changed = true;
          }
        }
      }
      // 2) 下发:依赖为空或依赖已成功、且当前空闲的项。
      for (let i = 0; i < list.length && inflight.size < max; i += 1) {
        if (settled[i] || inflight.has(i)) continue;
        if (deps[i] && !doneOk.has(deps[i])) continue;
        start(i);
      }
      // 3) 全部结算 -> 完成。
      if (settled.every(Boolean)) { resolve(results); return; }
      // 4) 防卡死:无在途且本轮没能下发任何项(异常/环)-> 强推最低序号未结算项打破僵局。
      if (inflight.size === 0) {
        for (let i = 0; i < list.length; i += 1) {
          if (!settled[i] && !inflight.has(i)) { start(i); break; }
        }
      }
    };
    pump();
  });
}

module.exports = { referenceTrackForName, collectReferencedAssetNames, classifyReferenceAssets, evaluateReferenceReadiness, runWithConcurrency, runWithDependencies };
