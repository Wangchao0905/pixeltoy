import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { compileVideoPromptPack, validateVideoPromptPack } from "../server/pixeltale-video.js";
import {
  DEFAULT_SEGMENT_SECONDS,
  MAX_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  SEGMENT_DURATION_POLICY_LEGACY_15,
  SEGMENT_DURATION_POLICY_VARIABLE,
  migrateLegacyDurationSettings,
  normalizeDurationSettings,
  normalizeSegmentDuration,
} from "../server/segment-duration.js";

const require = createRequire(import.meta.url);
const server = require("../server.js");
const duration = server.__test?.durationMode;
const series = server.__test?.seriesAssets;

assert.equal(MIN_SEGMENT_SECONDS, 4);
assert.equal(MAX_SEGMENT_SECONDS, 30);
assert.equal(DEFAULT_SEGMENT_SECONDS, 15);
assert.equal(normalizeSegmentDuration(3), 4);
assert.equal(normalizeSegmentDuration(31), 30);
assert.equal(normalizeSegmentDuration("not-a-number"), 15);

const legacy = normalizeDurationSettings({ durationMode: "short_drama_15s" });
assert.equal(legacy.segmentDurationPolicy, SEGMENT_DURATION_POLICY_LEGACY_15);
assert.equal(legacy.defaultSegmentDurationSeconds, DEFAULT_SEGMENT_SECONDS);
assert.equal(normalizeDurationSettings({}).segmentDurationPolicy, SEGMENT_DURATION_POLICY_LEGACY_15, "legacy records without the new fields must migrate to the legacy policy");

const variable = normalizeDurationSettings({ durationMode: "short_drama_variable" });
assert.equal(variable.durationMode, "short_drama_variable");
assert.equal(variable.segmentDurationPolicy, SEGMENT_DURATION_POLICY_VARIABLE);
assert.deepEqual(variable.segmentDuration, { min: 4, max: 30, default: 15, policy: "variable" });

const migrated = migrateLegacyDurationSettings({ durationMode: "short_drama_15s", customField: "keep" });
assert.equal(migrated.customField, "keep");
assert.equal(migrated.segmentDurationPolicy, SEGMENT_DURATION_POLICY_LEGACY_15);
assert.equal(migrated.segmentDuration.default, DEFAULT_SEGMENT_SECONDS);

assert.ok(duration, "duration mode helpers must be exported");
assert.equal(duration.DURATION_MODE_SHORT_DRAMA_VARIABLE, "short_drama_variable");
assert.deepEqual(
  duration.planEpisodeDuration({ durationMode: duration.DURATION_MODE_SHORT_DRAMA_VARIABLE, targetDuration: 45, beats: ["开场"] }).durations,
  [30, 15],
  "variable mode should use the 4-30 second capacity instead of forcing 15-second clips",
);
assert.deepEqual(
  duration.planEpisodeDuration({ durationMode: duration.DURATION_MODE_SHORT_DRAMA_VARIABLE, targetDuration: 31, beats: ["开场"] }).durations,
  [27, 4],
  "variable mode must keep every clip inside the 4-30 second range",
);

const persistenceRoot = fs.mkdtempSync(path.join(process.cwd(), ".segment-duration-contract-"));
try {
  const { episodeRoot } = series.createEpisodeWorkspace(persistenceRoot, "e01", "可变时长测试");
  series.writeAssetManifest(episodeRoot, { confirmed: true, items: [{ id: "SCENE", type: "Scene", label: "小屋" }] });
  duration.persistProjectDurationSettings(episodeRoot, { durationMode: duration.DURATION_MODE_SHORT_DRAMA_VARIABLE });
  const manifest = series.readAssetManifest(episodeRoot).data;
  const config = server.readVideoConfig(episodeRoot, { allowEmptyShots: true }).data;
  for (const record of [manifest, manifest.production, config, config.settings]) {
    assert.equal(record.durationMode, duration.DURATION_MODE_SHORT_DRAMA_VARIABLE);
    assert.equal(record.segmentDurationPolicy, SEGMENT_DURATION_POLICY_VARIABLE);
    assert.deepEqual(record.segmentDuration, { min: 4, max: 30, default: 15, policy: "variable" });
  }
  assert.equal(duration.fullProjectState(episodeRoot).durationSettings.segmentDurationPolicy, SEGMENT_DURATION_POLICY_VARIABLE);
} finally {
  fs.rmSync(persistenceRoot, { recursive: true, force: true });
}

const variableSource = {
  projectId: "variable_demo",
  durationMode: "short_drama_variable",
  arc: { units: [{ number: 1, title_zh: "连续动作" }] },
  characters: { characters: [{ id: "C001", name_zh: "林默" }] },
  scenes: {
    scenes: [{
      id: "S001",
      unit_number: 1,
      name_zh: "小屋",
      location_zh: "小屋",
      characters: ["C001"],
      shot_plan: [
        { shot_id: "SH001", duration_seconds: 8, description_zh: "林默推门进入。" },
        { shot_id: "SH002", duration_seconds: 22, description_zh: "林默停下并发现桌上的线索。" },
      ],
    }],
  },
};
const variablePack = compileVideoPromptPack(variableSource);
assert.equal(variablePack.schemaVersion, 2);
assert.deepEqual(variablePack.segmentDuration, { min: 4, max: 30, default: 15, policy: "variable" });
assert.equal(variablePack.episodes[0].clips.length, 1);
assert.equal(variablePack.episodes[0].clips[0].durationSeconds, 30);
assert.equal(variablePack.episodes[0].clips[0].timecode, "00:00-00:30");
assert.deepEqual(validateVideoPromptPack(variablePack), { errors: [], warnings: [] });

const invalidVariablePack = structuredClone(variablePack);
invalidVariablePack.episodes[0].clips[0].durationSeconds = 31;
assert.ok(validateVideoPromptPack(invalidVariablePack).errors.some((error) => error.code === "CLIP_DURATION_OUT_OF_RANGE"));

console.log("segment duration contract tests passed");
