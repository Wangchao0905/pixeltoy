const REQUIRED_FIELDS = Object.freeze({
  brief: ["title_zh", "logline_zh", "core_conflict_zh", "viewer_question_zh"],
  title: ["candidates"],
  proposal: ["title_zh", "premise_zh", "viewer_question_zh", "first_impact_zh", "episode_hook_zh"],
  characters: ["characters", "relationships", "world_rules"],
  arc: ["units", "arc_summary_zh"],
  scenes: ["scenes"],
  dialogue: ["lines", "localization_checks"],
});
const DIMENSIONS = ["structure", "plot", "design", "logic"];
const CJK = /[一-鿿]/u;
const WESTERN_MARKETS = new Set(["united_states", "united_kingdom", "canada", "mexico", "brazil", "germany", "france"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function empty(value) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

function pathValue(root, path) {
  return String(path).replace(/\[([^\]]+)\]/g, ".$1").split(".").filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], root);
}

function contextValue(approvedContext, key) {
  const root = object(approvedContext);
  if (root[key] !== undefined) return root[key];
  if (root.input && root.input[key] !== undefined) return root.input[key];
  return array(approvedContext).map(object).find((item) => item[key] !== undefined)?.[key];
}

function add(violations, code, severity, fieldPath, message, metadata = {}) {
  violations.push({ code, severity, fieldPath, message, ...object(metadata) });
}

function checkSchema(stage, artifact, violations) {
  for (const field of REQUIRED_FIELDS[stage] || []) {
    if (empty(artifact[field])) add(violations, "SCHEMA_INCOMPLETE", "high", field, `${stage} 产物缺少必填字段：${field}`);
  }
}

function checkUnitCount(stage, artifact, approvedContext, violations) {
  if (!(["arc", "scenes"].includes(stage))) return;
  const expected = array(contextValue(approvedContext, "unitScope") || contextValue(approvedContext, "unitNumbers"))
    .map(Number).filter(Number.isInteger);
  if (!expected.length) return;
  const items = stage === "scenes" ? array(artifact.scenes) : array(artifact.units);
  const key = stage === "scenes" ? "unit_number" : "number";
  const actual = items.map((item) => Number(object(item)[key])).filter(Number.isInteger);
  const actualSet = new Set(actual);
  const missing = expected.filter((number) => !actualSet.has(number));
  const extra = [...actualSet].filter((number) => !expected.includes(number));
  const path = `${stage}.${stage === "scenes" ? "scenes" : "units"}`;
  if (stage === "arc") {
    // An episode is exactly one arc unit. A duplicate always shows up as either a
    // count mismatch or a missing episode, so those two conditions cover it.
    if (missing.length || extra.length || actual.length !== expected.length) {
      add(violations, "UNIT_COUNT_MISMATCH", "high", path, `产物单元与请求批次不一致：期望 ${expected.join(",")}，实际 ${actual.join(",")}`);
    }
    return;
  }
  // An episode legitimately breaks into several scenes, so repeated unit_number is
  // expected here. Only a missing episode or a scene outside the requested batch is
  // a violation — comparing raw counts would fail every valid scene breakdown.
  if (missing.length || extra.length) {
    const detail = [
      missing.length ? `缺少集号 ${missing.join(",")}` : "",
      extra.length ? `出现批次外集号 ${extra.join(",")}` : "",
    ].filter(Boolean).join("；");
    add(violations, "UNIT_COUNT_MISMATCH", "high", path, `场景批次与请求不一致：期望覆盖 ${expected.join(",")}，${detail}`);
  }
}

function targetDurationSeconds(approvedContext) {
  const direct = contextValue(approvedContext, "targetDurationSeconds");
  if (direct !== undefined) {
    const seconds = Number(direct);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }
  const duration = Number(contextValue(approvedContext, "durationValue"));
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const unit = String(contextValue(approvedContext, "durationUnit") || "").trim().toLowerCase();
  if (["sec", "secs", "second", "seconds", "秒"].includes(unit)) return duration;
  if (["min", "mins", "minute", "minutes", "分", "分钟"].includes(unit)) return duration * 60;
  return null;
}

function formatSeconds(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function checkDurationBudget(stage, artifact, approvedContext, violations) {
  if (stage !== "scenes") return;
  const target = targetDurationSeconds(approvedContext);
  if (target === null) return;
  const grouped = new Map();
  array(artifact.scenes).forEach((scene) => {
    const item = object(scene);
    const number = Number(item.unit_number);
    if (!Number.isInteger(number)) return;
    if (!grouped.has(number)) grouped.set(number, { seconds: 0, hasDuration: false });
    const total = grouped.get(number);
    array(item.shot_plan).forEach((shot) => {
      const seconds = Number(object(shot).duration_seconds);
      if (!Number.isFinite(seconds)) return;
      total.seconds += seconds;
      total.hasDuration = true;
    });
  });
  const requested = array(contextValue(approvedContext, "unitScope") || contextValue(approvedContext, "unitNumbers"))
    .map(Number).filter(Number.isInteger);
  const numbers = (requested.length ? requested : [...grouped.keys()]).filter((number) => grouped.has(number));
  numbers.forEach((number) => {
    const total = grouped.get(number);
    if (!total.hasDuration) return;
    const deviation = (total.seconds - target) / target;
    const absoluteDeviation = Math.abs(deviation);
    if (absoluteDeviation <= 0.25) return;
    const severity = absoluteDeviation > 0.4 ? "high" : "medium";
    const percent = Number((deviation * 100).toFixed(1));
    add(violations, "DURATION_BUDGET_MISMATCH", severity, `scenes.unit_${number}.shot_plan`, `第 ${number} 集时长预算不匹配：目标 ${formatSeconds(target)} 秒，实际 ${formatSeconds(total.seconds)} 秒，偏差 ${percent}%`);
  });
}

function checkUnitContinuity(stage, approvedContext, violations) {
  if (!(stage === "arc" || stage === "scenes")) return;
  const cumulativeArtifact = object(contextValue(approvedContext, "cumulativeArtifact"));
  const cumulativeContent = object(cumulativeArtifact.content || cumulativeArtifact);
  const batches = array(contextValue(approvedContext, "unitBatches"));
  if (!Object.keys(cumulativeContent).length || batches.length < 2) return;
  const key = stage === "scenes" ? "scenes" : "units";
  const numberKey = stage === "scenes" ? "unit_number" : "number";
  const numbers = array(cumulativeContent[key]).map((item) => Number(object(item)[numberKey])).filter(Number.isInteger);
  const batchNumbers = new Map();
  batches.forEach((batch, index) => {
    const item = object(batch);
    const batchId = String(item.id || index + 1);
    const units = array(item.units || item.unitScope || item.unitNumbers || batch).map(Number).filter(Number.isInteger);
    [...new Set(units)].forEach((number) => {
      if (!batchNumbers.has(number)) batchNumbers.set(number, []);
      batchNumbers.get(number).push(batchId);
    });
  });
  const repeatedAcrossBatches = [...batchNumbers.entries()].filter(([, ids]) => ids.length > 1);
  const duplicateArcNumbers = stage === "arc" ? numbers.filter((number, index) => numbers.indexOf(number) !== index) : [];
  const sorted = [...new Set(numbers)].sort((left, right) => left - right);
  const missing = stage === "arc" && sorted.length
    ? Array.from({ length: sorted.at(-1) - sorted[0] + 1 }, (_, index) => sorted[0] + index).filter((number) => !sorted.includes(number))
    : [];
  if (!repeatedAcrossBatches.length && !duplicateArcNumbers.length && !missing.length) return;
  const details = [
    repeatedAcrossBatches.length ? `集号 ${repeatedAcrossBatches.map(([number]) => number).join(",")} 在不同批次重复出现` : "",
    duplicateArcNumbers.length ? `累计产物集号 ${[...new Set(duplicateArcNumbers)].join(",")} 重复` : "",
    missing.length ? `累计集号缺少 ${missing.join(",")}` : "",
  ].filter(Boolean).join("；");
  add(violations, "UNIT_CONTINUITY_BROKEN", "high", `${stage}.${key}`, `${stage} 集号连续性异常：${details}`);
}

function checkLockedPaths(artifact, approvedContext, lockedPaths, violations) {
  const paths = array(lockedPaths).map((entry) => typeof entry === "string" ? entry : entry?.path).filter(Boolean);
  for (const fieldPath of paths) {
    const current = pathValue(artifact, fieldPath);
    const baseline = pathValue(object(contextValue(approvedContext, "lockedArtifact") || contextValue(approvedContext, "artifact")), fieldPath);
    if (current !== undefined && (baseline === undefined || JSON.stringify(current) !== JSON.stringify(baseline))) {
      add(violations, "LOCKED_PATH_TOUCHED", "high", fieldPath, `产物改动触及已锁定字段：${fieldPath}`);
    }
  }
}

function checkDimensions(artifact, violations) {
  const target = artifact.dimensions || artifact.review?.dimensions;
  if (!target) return;
  for (const key of DIMENSIONS) if (empty(target[key])) add(violations, "DIMENSION_KEY_MISSING", "high", `dimensions.${key}`, `审核产物缺少维度键：${key}`);
}

function checkHooks(stage, mode, artifact, violations) {
  if (!(["tk_short_drama", "cn_short_drama"].includes(mode)) || stage !== "arc") return;
  array(artifact.units).forEach((unit, index) => {
    const item = object(unit);
    const hook = item.endingHook ?? item.ending_hook ?? item.hook_zh;
    if (empty(hook) || !/(未|问题|追问|能否|是否|必须|危险|威胁|选择|行动|逃|追|揭开|真相|倒计时|阻止|代价|下一集)/u.test(String(hook))) {
      add(violations, "EMPTY_HOOK", "medium", `units[${index}].${item.endingHook !== undefined ? "endingHook" : "hook_zh"}`, `第 ${item.number || index + 1} 集缺少带有未解决问题或行动压力的集尾钩子`);
    }
  });
}

function checkLocalization(stage, artifact, approvedContext, violations) {
  const market = contextValue(approvedContext, "marketCountry") || contextValue(approvedContext, "targetMarket") || artifact.marketCountry;
  if (!WESTERN_MARKETS.has(String(market || "").toLowerCase())) return;
  // The production payload keeps Chinese explanatory labels in *_zh fields. Only
  // display-name/location fields are localization targets; plot_zh and *_zh text
  // must remain valid Chinese story content.
  const nameKey = /^(?:name|location|place|city|characterName|personName|institutionName|storeName)(?!_zh(?:_|$))(?:$|_)/i;
  // characters[].name_zh is a localization target ONLY in the characters stage,
  // whose contract says it is the market display name and must not be a Chinese
  // translation. The visual-asset contract reuses characters[].name_zh for a real
  // Chinese name, so scoping by stage keeps that legitimate field out of scope.
  const checkPersonName = stage === "characters";
  const walk = (value, fieldPath) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${fieldPath}[${index}]`));
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([key, item]) => {
      const nextPath = fieldPath ? `${fieldPath}.${key}` : key;
      const personChineseName = checkPersonName && key === "name_zh" && /(?:^|\.)characters\[\d+\](?:\.|$)/u.test(fieldPath);
      if ((nameKey.test(key) || personChineseName) && typeof item === "string" && CJK.test(item)) add(violations, "NAME_LOCALIZATION", "high", nextPath, `人物名或地名字段含 CJK 字符：${nextPath}`);
      walk(item, nextPath);
    });
  };
  walk(artifact, "");
}

function checkCrossStageRefs(stage, artifact, approvedContext, violations) {
  // Build registries from already-approved upstream artifacts.
  // Only check stages that reference earlier ones; skip gracefully when
  // upstream has not been approved yet.
  const arts = array(approvedContext?.artifacts).map(object);
  const charArt = arts.find((a) => a.stage === "characters")?.content;
  const sceneArt = arts.find((a) => a.stage === "scenes")?.content;
  const charIds = new Set(array(charArt?.characters).map((c) => String(object(c).id || "")).filter(Boolean));
  const sceneIds = new Set([
    ...array(sceneArt?.scenes).map((s) => String(object(s).id || "")),
  ].filter(Boolean));

  if (stage === "scenes" && charIds.size) {
    array(object(artifact).scenes).forEach((scene, si) => {
      array(object(scene).characters).forEach((ref, ri) => {
        const id = String(ref || "");
        if (id && !charIds.has(id)) {
          // 新剧集引入新人物是正常创作：降为 medium 提示（不阻断），
          // 交由审核模型按 knownRuleFindings 核验出场合理性；只有对白
          // 发言者（UNKNOWN_SPEAKER_REF）才保持 high 硬拦。
          add(violations, "UNKNOWN_CHARACTER_REF", "medium",
            `scenes[${si}].characters[${ri}]`,
            `场景引用了未在已确认人物名单中的 ID "${id}"（已知: ${[...charIds].slice(0, 8).join(", ")}）——新人物可正常出场，由审核核验合理性`);
        }
      });
    });
  }

  if (stage === "dialogue") {
    const spokenIds = new Set();
    array(object(artifact).lines).forEach((line, li) => {
      const lineItem = object(line);
      const sp = String(lineItem.speaker || "");
      if (sp) spokenIds.add(sp);
      const sid = String(lineItem.scene_id || "");
      if (sid && sceneIds.size && !sceneIds.has(sid)) {
        add(violations, "UNKNOWN_SCENE_REF", "high",
          `lines[${li}].scene_id`,
          `对白引用了未知场景 ID "${sid}"`);
      }
      const scene = array(sceneArt?.scenes).find((item) => String(object(item).id || "") === sid);
      if (sp && scene && Array.isArray(scene.characters) && !scene.characters.map((id) => String(id || "")).includes(sp)) {
        add(violations, "SCENE_SPEAKER_ROSTER_MISMATCH", "high",
          `lines[${li}].speaker`,
          `对白发言者 "${sp}" 未列入场景 "${sid}" 的人物名单——请同步场景人物名单或更换说话人`,
          {
            targetStage: "scenes",
            relatedStage: "dialogue",
            decisionOptions: ["将说话人加入该场景人物名单", "改用该场景已登记人物发言"],
            requiresCreatorDecision: true,
          });
      }
    });
    if (charIds.size) {
      [...spokenIds].forEach((sp) => {
        if (!charIds.has(sp)) {
          // scenes 阶段已允许新人物出场；dialogue 是延续——若没有"注册新人物"
          // 通道仍 high 硬拦就是死锁。降为 medium 提示，交由审核模型核验
          // 新发言者的对白合理性（knownRuleFindings 传入核验清单）。
          add(violations, "UNKNOWN_SPEAKER_REF", "medium",
            "lines[].speaker",
            `对白发言者 "${sp}" 不在已确认人物名单中（已知: ${[...charIds].slice(0, 8).join(", ")}）——新人物对白由审核核验合理性`);
        }
      });
    }
  }
}

function runStageRules({ stage = "", mode = "", artifact = {}, approvedContext = {}, lockedPaths = [] } = {}) {
  const normalizedStage = String(stage || "").toLowerCase();
  const normalizedMode = ["tk", "tk_short_drama", "短剧"].includes(String(mode).toLowerCase()) ? "tk_short_drama" : String(mode || "").toLowerCase();
  const violations = [];
  checkSchema(normalizedStage, object(artifact), violations);
  checkUnitCount(normalizedStage, object(artifact), approvedContext, violations);
  checkDurationBudget(normalizedStage, object(artifact), approvedContext, violations);
  checkUnitContinuity(normalizedStage, approvedContext, violations);
  checkLockedPaths(object(artifact), approvedContext, lockedPaths, violations);
  checkDimensions(object(artifact), violations);
  checkHooks(normalizedStage, normalizedMode, object(artifact), violations);
  checkLocalization(normalizedStage, object(artifact), approvedContext, violations);
  checkCrossStageRefs(normalizedStage, object(artifact), approvedContext, violations);
  return {
    violations,
    checked: [
      "SCHEMA_INCOMPLETE", "UNIT_COUNT_MISMATCH", "LOCKED_PATH_TOUCHED",
      "DURATION_BUDGET_MISMATCH", "UNIT_CONTINUITY_BROKEN", "DIMENSION_KEY_MISSING", "EMPTY_HOOK", "NAME_LOCALIZATION",
      "UNKNOWN_CHARACTER_REF", "UNKNOWN_SCENE_REF", "UNKNOWN_SPEAKER_REF",
      "SCENE_SPEAKER_ROSTER_MISMATCH",
    ],
  };
}

module.exports = { runStageRules };
