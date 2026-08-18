import assert from "node:assert/strict";
import { compileVideoPromptPack, validateVideoPromptPack } from "../server/pixeltale-video.js";

const source = {
  projectId: "project_demo",
  storyTitle: "欢迎会失控",
  mode: "cn_short_drama",
  input: { durationValue: 30, durationUnit: "sec" },
  arc: {
    units: [{ number: 1, title_zh: "备份卡到手", hook_zh: "林默必须离开会场" }],
  },
  characters: {
    characters: [{
      id: "C001",
      name_zh: "林默",
      costume_accessories: "湿透的白衬衫，黑色长裤",
      palette: "冷蓝与黑",
    }],
  },
  scenes: {
    scenes: [{
      id: "S001",
      unit_number: 1,
      name_zh: "欢迎会主会场",
      time_zh: "白天",
      location_zh: "林氏城建集团欢迎会主会场",
      characters: ["C001"],
      character_engine_refs: ["C001"],
      screenplay_zh: "林默撞翻香槟塔，借混乱翻过服务台拔走备份卡。",
      visual_intent_zh: "奢华秩序被玻璃碎裂割开。",
      visual_profile: { indoor_outdoor: "室内", lighting: "冷白灯与巨屏蓝光交错", palette: "冷蓝、香槟金、猩红" },
      props: [{ id: "PR01", name_zh: "船舱影像备份卡", description_zh: "保存被截断海难画面的存储卡" }],
      shot_plan: [
        { shot_id: "SH001", type: "impact", duration_seconds: 3, description_zh: "巨屏闪出血色船舱影像。" },
        { shot_id: "SH002", type: "reaction", duration_seconds: 6, description_zh: "宾客惊退，保安封锁控制台。" },
        { shot_id: "SH003", type: "action", duration_seconds: 6, description_zh: "林默撞翻香槟塔，玻璃和酒液砸落。", asset_refs: { character_ids: ["C002"], prop_ids: ["PR02"], space_ref: "LAYOUT_S001", lighting_profile: "侧面冷光" }, transition_out: "声音桥：玻璃碎响延续到下一段。" },
        { shot_id: "SH004", type: "close_pressure", duration_seconds: 6, description_zh: "林默翻过服务台拔走备份卡。" },
        { shot_id: "SH005", type: "hook", duration_seconds: 9, description_zh: "林默躺进酒液，右手藏住备份卡。" },
      ],
    }],
  },
  dialogue: {
    lines: [{ scene_id: "S001", speaker: "C001", dialogue_zh: "都别靠近。", delivery_zh: "压低声音，故作轻松" }],
  },
};

const pack = compileVideoPromptPack(source);
assert.equal(pack.schemaVersion, 2);
assert.equal(pack.fixedSegmentSeconds, 15);
assert.equal(pack.episodes.length, 1);
assert.equal(pack.episodes[0].clips.length, 2, "30秒场景必须编译成两个15秒片段");
assert.deepEqual(pack.episodes[0].clips.map((clip) => clip.timecode), ["00:00-00:15", "00:15-00:30"]);
assert.deepEqual(pack.episodes[0].clips.map((clip) => clip.durationSeconds), [15, 15]);
assert.deepEqual(pack.episodes[0].clips[0].sourceShotIds, ["SH001", "SH002", "SH003"]);
assert.deepEqual(pack.episodes[0].clips[1].sourceShotIds, ["SH004", "SH005"]);
assert.deepEqual(pack.episodes[0].clips[0].assetRefs.characterIds, ["C001", "C002"]);
assert.deepEqual(pack.episodes[0].clips[0].assetRefs.propIds, ["PR01", "PR02"]);
assert.deepEqual(pack.episodes[0].clips[0].assetRefs.spaceRefs, ["S001", "LAYOUT_S001"]);
assert.match(pack.episodes[0].clips[0].prompt, /侧面冷光/u);
assert.match(pack.episodes[0].clips[0].prompt, /压低声音，故作轻松/u);
assert.equal(pack.episodes[0].clips[0].sourceSegments[2].assetRefs.spaceRefs[1], "LAYOUT_S001");
assert.match(pack.episodes[0].clips[0].prompt, /冷白灯与巨屏蓝光交错/u);
assert.match(pack.episodes[0].clips[0].prompt, /从起始状态开始/u);
assert.match(pack.episodes[0].clips[1].prompt, /都别靠近/u);
assert.equal(pack.episodes[0].clips[1].transitionIn.type, "action_match");
assert.equal(pack.episodes[0].clips[0].transitionOut.type, "sound_bridge");
assert.equal(pack.episodes[0].clips[1].transitionOut.type, "sound_bridge");
assert.deepEqual(validateVideoPromptPack(pack), { errors: [], warnings: [] });

const splitPack = compileVideoPromptPack({
  ...source,
  scenes: {
    scenes: [{
      ...source.scenes.scenes[0],
      shot_plan: [
        { shot_id: "A", type: "setup", duration_seconds: 4, description_zh: "角色站定。" },
        { shot_id: "B", type: "action", duration_seconds: 4, description_zh: "角色抬手。" },
        { shot_id: "C", type: "result", duration_seconds: 10, description_zh: "灯光熄灭，门在远处打开。" },
      ],
    }],
  },
});
assert.equal(splitPack.episodes[0].clips.length, 2);
assert.equal(splitPack.episodes[0].clips[0].sourceSegments.at(-1).durationSeconds, 7, "跨15秒边界的镜头必须被切成实际片段时长");
assert.equal(splitPack.episodes[0].clips[1].sourceSegments[0].sourceShotId, "C");
assert.equal(splitPack.episodes[0].clips[0].transitionOut.type, "action_match", "未指定衔接方式时默认使用动作匹配");
assert.ok(splitPack.validation.warnings.some((warning) => warning.code === "SHOT_SPLIT_AT_BOUNDARY"));

const invalid = structuredClone(pack);
invalid.episodes[0].clips[0].durationSeconds = 14;
assert.ok(validateVideoPromptPack(invalid).errors.some((error) => error.code === "CLIP_DURATION_NOT_15"));

console.log("pixeltale video production tests passed");
