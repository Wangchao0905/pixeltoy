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

module.exports = { referenceTrackForName, collectReferencedAssetNames, classifyReferenceAssets, evaluateReferenceReadiness, runWithConcurrency };
