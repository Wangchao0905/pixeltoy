const MIN_SEGMENT_SECONDS = 4;
const MAX_SEGMENT_SECONDS = 30;
const DEFAULT_SEGMENT_SECONDS = 15;
const SEGMENT_DURATION_POLICY_LEGACY_15 = "legacy_15s";
const SEGMENT_DURATION_POLICY_VARIABLE = "variable";
const DURATION_MODE_SHORT_DRAMA_15 = "short_drama_15s";
const DURATION_MODE_SHORT_DRAMA_VARIABLE = "short_drama_variable";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeSegmentDuration(value, fallback = DEFAULT_SEGMENT_SECONDS) {
  const candidate = Number(value);
  const base = Number.isFinite(candidate) && candidate > 0 ? candidate : Number(fallback);
  const normalizedFallback = Number.isFinite(base) && base > 0 ? base : DEFAULT_SEGMENT_SECONDS;
  return Math.max(MIN_SEGMENT_SECONDS, Math.min(MAX_SEGMENT_SECONDS, Math.round(normalizedFallback)));
}

function normalizeSegmentDurationPolicy(value, fallback = SEGMENT_DURATION_POLICY_LEGACY_15) {
  const raw = String(value ?? "").trim().toLowerCase();
  if ([SEGMENT_DURATION_POLICY_VARIABLE, "variable_duration", "可变", "可变时长"].includes(raw)) {
    return SEGMENT_DURATION_POLICY_VARIABLE;
  }
  if ([SEGMENT_DURATION_POLICY_LEGACY_15, "fixed_15s", "fixed15", "legacy", "固定15秒"].includes(raw)) {
    return SEGMENT_DURATION_POLICY_LEGACY_15;
  }
  return fallback === SEGMENT_DURATION_POLICY_VARIABLE
    ? SEGMENT_DURATION_POLICY_VARIABLE
    : SEGMENT_DURATION_POLICY_LEGACY_15;
}

function normalizeDurationMode(value, fallback = "tk") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === DURATION_MODE_SHORT_DRAMA_VARIABLE || raw === "variable" || raw === "可变时长短剧模式") {
    return DURATION_MODE_SHORT_DRAMA_VARIABLE;
  }
  if (raw === DURATION_MODE_SHORT_DRAMA_15 || raw === "15 秒短剧模式" || raw === "固定15秒") {
    return DURATION_MODE_SHORT_DRAMA_15;
  }
  if (raw === "free" || raw === "自由模式") return "free";
  if (raw === "tk" || raw === "tk 模式") return "tk";
  return fallback;
}

function normalizeDurationSettings(input = {}, { fallbackDurationMode = "tk" } = {}) {
  const root = asObject(input);
  const settings = asObject(root.settings);
  const production = asObject(root.production);
  const segment = asObject(firstValue(root.segmentDuration, settings.segmentDuration, production.segmentDuration));
  const rawMode = firstValue(root.durationMode, settings.durationMode, production.durationMode);
  const durationMode = normalizeDurationMode(rawMode, normalizeDurationMode(fallbackDurationMode, "tk"));
  const explicitPolicy = firstValue(
    root.segmentDurationPolicy,
    settings.segmentDurationPolicy,
    production.segmentDurationPolicy,
    segment.policy,
  );
  const defaultPolicy = durationMode === DURATION_MODE_SHORT_DRAMA_VARIABLE
    ? SEGMENT_DURATION_POLICY_VARIABLE
    : durationMode === DURATION_MODE_SHORT_DRAMA_15
      ? SEGMENT_DURATION_POLICY_LEGACY_15
      : normalizeSegmentDurationPolicy(explicitPolicy, SEGMENT_DURATION_POLICY_LEGACY_15);
  const segmentDurationPolicy = normalizeSegmentDurationPolicy(explicitPolicy, defaultPolicy);
  return {
    durationMode,
    segmentDurationPolicy: durationMode === DURATION_MODE_SHORT_DRAMA_VARIABLE
      ? SEGMENT_DURATION_POLICY_VARIABLE
      : durationMode === DURATION_MODE_SHORT_DRAMA_15
        ? SEGMENT_DURATION_POLICY_LEGACY_15
        : segmentDurationPolicy,
    defaultSegmentDurationSeconds: normalizeSegmentDuration(
      firstValue(
        root.defaultSegmentDurationSeconds,
        settings.defaultSegmentDurationSeconds,
        production.defaultSegmentDurationSeconds,
        segment.default,
      ),
    ),
    segmentDuration: {
      min: MIN_SEGMENT_SECONDS,
      max: MAX_SEGMENT_SECONDS,
      default: normalizeSegmentDuration(
        firstValue(
          root.defaultSegmentDurationSeconds,
          settings.defaultSegmentDurationSeconds,
          production.defaultSegmentDurationSeconds,
          segment.default,
        ),
      ),
      policy: durationMode === DURATION_MODE_SHORT_DRAMA_VARIABLE
        ? SEGMENT_DURATION_POLICY_VARIABLE
        : durationMode === DURATION_MODE_SHORT_DRAMA_15
          ? SEGMENT_DURATION_POLICY_LEGACY_15
          : segmentDurationPolicy,
    },
  };
}

function migrateLegacyDurationSettings(input = {}, options = {}) {
  const source = asObject(input);
  const settings = normalizeDurationSettings(source, options);
  return {
    ...source,
    durationMode: settings.durationMode,
    segmentDurationPolicy: settings.segmentDurationPolicy,
    defaultSegmentDurationSeconds: settings.defaultSegmentDurationSeconds,
    segmentDuration: settings.segmentDuration,
  };
}

module.exports = {
  MIN_SEGMENT_SECONDS,
  MAX_SEGMENT_SECONDS,
  DEFAULT_SEGMENT_SECONDS,
  SEGMENT_DURATION_POLICY_LEGACY_15,
  SEGMENT_DURATION_POLICY_VARIABLE,
  DURATION_MODE_SHORT_DRAMA_VARIABLE,
  normalizeSegmentDuration,
  normalizeSegmentDurationPolicy,
  normalizeDurationSettings,
  migrateLegacyDurationSettings,
};
