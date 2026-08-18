const {
  DEFAULT_SEGMENT_SECONDS,
  MAX_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  SEGMENT_DURATION_POLICY_LEGACY_15,
  SEGMENT_DURATION_POLICY_VARIABLE,
  normalizeDurationSettings,
} = require("./segment-duration.js");

const FIXED_SEGMENT_SECONDS = DEFAULT_SEGMENT_SECONDS;

function text(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function unique(values) {
  return [...new Set(list(values).map((value) => text(value, 200)).filter(Boolean))];
}

function positiveSeconds(value, fallback = 0) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

function formatTimecode(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function timecode(start, end) {
  return `${formatTimecode(start)}-${formatTimecode(end)}`;
}

function sceneProps(scene) {
  return asArray(scene?.props || scene?.recurring_props)
    .map((prop) => asObject(prop))
    .filter((prop) => text(prop.id, 160));
}

function dialogueForScene(dialogue, sceneId) {
  return asArray(dialogue?.lines)
    .filter((line) => text(line?.scene_id, 160) === sceneId)
    .map((line) => {
      const speaker = text(line?.speaker, 160);
      const value = text(line?.dialogue_zh || line?.dialogue_en || line?.dialogue, 1600);
      if (!value) return null;
      return {
        speaker,
        text: value,
        delivery: text(line?.delivery_zh || line?.delivery_en, 500),
        intent: text(line?.intent_zh, 500),
      };
    })
    .filter(Boolean);
}

function sceneAssetRefs(scene) {
  const characterIds = unique([
    ...asArray(scene?.characters),
    ...asArray(scene?.character_engine_refs),
  ]);
  const propIds = unique(sceneProps(scene).map((prop) => prop.id));
  const visual = asObject(scene?.visual_profile);
  const lightingProfile = {
    indoorOutdoor: text(visual.indoor_outdoor, 120),
    lighting: text(visual.lighting, 600),
    palette: text(visual.palette, 300),
  };
  return {
    characterIds,
    propIds,
    sceneId: text(scene?.id, 160),
    spaceRefs: unique([scene?.id, scene?.space_ref]),
    layoutId: text(scene?.layout_asset_id || scene?.layout_ref || scene?.id, 160),
    layoutIds: unique([scene?.layout_asset_id, scene?.layout_ref, scene?.id]),
    continuityAnchors: unique(scene?.continuity_anchors || scene?.continuityAnchors),
    screenDirections: unique([scene?.screen_direction_zh, scene?.screen_direction]),
    lightingProfile,
    lightingProfiles: unique([lightingLabel(lightingProfile)]),
  };
}

function lightingLabel(profile = {}) {
  return [profile.lighting, profile.palette ? `色彩为${profile.palette}` : "", profile.indoorOutdoor]
    .filter(Boolean)
    .join("，");
}

function mergeAssetRefs(base = {}, extra = {}) {
  const source = asObject(extra);
  const lightingSource = asObject(source.lighting_profile || source.lightingProfile);
  const lighting = text(
    lightingSource.lighting
      || (typeof source.lighting_profile === "string" ? source.lighting_profile : "")
      || (typeof source.lightingProfile === "string" ? source.lightingProfile : ""),
    600,
  );
  const lightingProfile = {
    ...(base.lightingProfile || {}),
    ...(lighting ? { lighting } : {}),
    ...(text(lightingSource.indoorOutdoor || source.indoor_outdoor, 120) ? { indoorOutdoor: text(lightingSource.indoorOutdoor || source.indoor_outdoor, 120) } : {}),
    ...(text(lightingSource.palette || source.palette, 300) ? { palette: text(lightingSource.palette || source.palette, 300) } : {}),
  };
  return {
    characterIds: unique([...list(base.characterIds), ...list(source.characterIds || source.character_ids)]),
    propIds: unique([...list(base.propIds), ...list(source.propIds || source.prop_ids)]),
    sceneId: text(base.sceneId || source.sceneId || source.scene_id, 160),
    spaceRefs: unique([
      ...list(base.spaceRefs),
      ...list(source.spaceRefs || source.space_refs),
      source.space_ref,
      source.spaceRef,
    ]),
    layoutId: text(base.layoutId || source.layoutId || source.layout_id || source.layout_ref, 160),
    layoutIds: unique([
      ...list(base.layoutIds),
      ...list(source.layoutIds || source.layout_ids),
      source.layoutId,
      source.layout_id,
      source.layout_ref,
    ]),
    continuityAnchors: unique([
      ...list(base.continuityAnchors),
      ...list(source.continuityAnchors || source.continuity_anchors),
    ]),
    screenDirections: unique([
      ...list(base.screenDirections),
      ...list(source.screenDirections || source.screen_directions),
      source.screen_direction,
      source.screen_direction_zh,
    ]),
    lightingProfile,
    lightingProfiles: unique([
      ...list(base.lightingProfiles),
      ...list(source.lightingProfiles || source.lighting_profiles),
      lightingLabel(lightingProfile),
    ]),
  };
}

function shotAssetRefs(scene, shot) {
  return mergeAssetRefs(sceneAssetRefs(scene), asObject(shot?.asset_refs || shot?.assetRefs));
}

function transitionType(value, fallback) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw.includes("sound") || raw.includes("audio") || /声音|音桥|声桥/u.test(raw)) return "sound_bridge";
  if (raw.includes("gaze") || raw.includes("look") || /视线|视线匹配/u.test(raw)) return "gaze_match";
  if (raw.includes("landmark") || raw.includes("space") || /地标|空间|位置/u.test(raw)) return "landmark_match";
  if (raw.includes("hard") || raw.includes("cut") || /硬切|对比剪辑/u.test(raw)) return "hard_cut";
  if (raw.includes("opening") || /建立状态|开场/u.test(raw)) return "opening_state";
  return fallback;
}

function transitionValue(value, fallbackType, fallbackDescription) {
  const source = asObject(value);
  const description = text(source.description || (typeof value === "string" ? value : ""), 600);
  return {
    type: transitionType(source.type || value, fallbackType),
    description: description || fallbackDescription,
  };
}

function sceneOpeningState(scene, charactersById) {
  const refs = sceneAssetRefs(scene);
  const names = refs.characterIds.map((id) => text(charactersById.get(id)?.name_zh || charactersById.get(id)?.name_en || id, 160));
  const location = text(scene?.location_zh || scene?.name_zh, 300);
  const time = text(scene?.time_zh, 120);
  return [
    names.length ? `${names.join("、")}在${location || "当前场景"}中` : `画面在${location || "当前场景"}中建立`,
    time ? `时间为${time}` : "",
    text(scene?.start_state_zh, 1000),
  ].filter(Boolean).join("，") + "。";
}

function sliceDescription(description, sliceType) {
  const value = text(description, 1800) || "执行当前镜头的主要动作并保持空间连续。";
  if (sliceType === "continuation") return `动作延续：${value}`;
  if (sliceType === "end") return `动作结果：${value}`;
  return value;
}

function createShotSegments(scene, warnings) {
  const shots = asArray(scene?.shot_plan).map((shot, index) => ({
    ...asObject(shot),
    shotId: text(shot?.shot_id || shot?.id || `SH${String(index + 1).padStart(3, "0")}`, 160),
    type: text(shot?.type || "medium", 120),
    durationSeconds: positiveSeconds(shot?.duration_seconds, 0),
    description: text(shot?.description_zh || shot?.description || shot?.visual || shot?.action_zh, 1800),
    assetRefs: shotAssetRefs(scene, shot),
    startState: text(shot?.start_state_zh || shot?.startState, 1800),
    endState: text(shot?.end_state_zh || shot?.endState, 1800),
    transitionIn: shot?.transition_in || shot?.transitionIn,
    transitionOut: shot?.transition_out || shot?.transitionOut,
  })).filter((shot) => shot.durationSeconds > 0);
  if (!shots.length) {
    warnings.push({ code: "SCENE_HAS_NO_SHOT_PLAN", sceneId: text(scene?.id, 160), message: "场景没有有效 shot_plan，无法生成可执行片段。" });
  }
  return shots;
}

function createClip({ episodeNumber, clipIndex, start, segments, sceneMap, charactersById, dialogue, durationSeconds }) {
  const sceneIds = unique(segments.map((segment) => segment.sceneId));
  const sourceShotIds = unique(segments.map((segment) => segment.sourceShotId));
  const firstScene = sceneMap.get(sceneIds[0]) || {};
  const lastScene = sceneMap.get(sceneIds.at(-1)) || firstScene;
  const startState = text(segments[0]?.startState, 1800) || sceneOpeningState(firstScene, charactersById);
  const lastSegment = segments.at(-1) || {};
  const lastDescription = text(lastSegment.description, 1800);
  const endState = text(lastSegment.endState, 1800)
    || text(lastScene?.end_state_zh, 1800)
    || `${lastDescription || "当前动作"}完成，画面保留这一结果并把行动压力交给下一段。`;
  const refs = segments.reduce((result, segment) => mergeAssetRefs(result, segment.assetRefs), {});
  const dialogueCues = sceneIds.flatMap((sceneId) => dialogueForScene(dialogue, sceneId));
  const dialogueLines = unique(dialogueCues.map((line) => {
    const speaker = line.speaker ? `${line.speaker}：` : "";
    return `${speaker}${line.text}`;
  }));
  const descriptions = segments.map((segment) => segment.description).filter(Boolean).join("；");
  const shotTypes = unique(segments.map((segment) => segment.type)).join("、");
  const lighting = refs.lightingProfile;
  const dialogueDescription = dialogueCues.map((line) => {
    const speaker = line.speaker ? `${line.speaker}：` : "";
    const delivery = line.delivery ? `（${line.delivery}）` : "";
    return `${speaker}${line.text}${delivery}`;
  }).join("；");
  const continuityAnchors = refs.continuityAnchors.join("、");
  const screenDirections = refs.screenDirections.join("、");
  const prompt = [
    `${durationSeconds}秒视频生成片段，${shotTypes || "连续镜头"}，服务于第${episodeNumber}集的剧情推进。`,
    `从起始状态开始：${startState}`,
    `主体动作：${descriptions || "保持角色、道具和空间的连续动作"}。动作必须有清晰的接触、受力、反应和结果，不新增人物，不改变服装和道具状态。`,
    `结束状态：${endState}`,
    `参考资产：角色 ${refs.characterIds.join("、") || "待补齐"}；场景布局 ${refs.layoutIds.join("、") || refs.layoutId || refs.sceneId || "待补齐"}；空间锚点 ${refs.spaceRefs.join("、") || "待补齐"}；道具 ${refs.propIds.join("、") || "无"}。`,
    continuityAnchors ? `连续性锚点：${continuityAnchors}。` : "连续性锚点：继承人物位置、关键地标和道具状态。",
    screenDirections ? `屏幕方向：${screenDirections}。` : "屏幕方向：沿用上一段运动方向，不无因反轴。",
    `摄影：围绕${shotTypes || "当前动作"}保持清晰构图，镜头运动服务于动作连续性，不在片段内无因改变屏幕方向。`,
    `光影：${refs.lightingProfiles.join("；") || lightingLabel(lighting) || "沿用场景既定主光方向"}。`,
    dialogueLines.length ? `对白与表演：${dialogueDescription}。` : "无对白，保留动作声和环境声。",
    "片段衔接：继承上一段的人物位置、朝向、视线、道具持握状态、主光方向和延续声音；结尾保留可剪辑的动作或声音钩子。",
  ].join("\n");
  return {
    clipId: `EP${String(episodeNumber).padStart(2, "0")}_C${String(clipIndex).padStart(2, "0")}`,
    episodeNumber,
    sceneIds,
    sourceShotIds,
    sourceSegments: segments.map(({ sceneId, sourceShotId, type, description, durationSeconds, offsetSeconds, sliceType, assetRefs, startState: segmentStartState, endState: segmentEndState, transitionIn, transitionOut }) => ({
      sceneId,
      sourceShotId,
      type,
      description,
      durationSeconds,
      offsetSeconds,
      sliceType,
      assetRefs,
      startState: segmentStartState,
      endState: segmentEndState,
      transitionIn,
      transitionOut,
    })),
    timecode: timecode(start, start + durationSeconds),
    durationSeconds,
    narrativePurpose: text(firstScene?.purpose_zh || firstScene?.visual_intent_zh, 1200) || "推进当前场景并完成一个可剪辑的动作结果。",
    startState,
    action: descriptions || "保持当前动作连续推进。",
    endState,
    assetRefs: refs,
    dialogue: dialogueLines,
    dialogueCues,
    transitionIn: clipIndex === 1
      ? { type: "opening_state", description: "从本集第一个场景的建立状态开始。" }
      : transitionValue(segments[0]?.transitionIn, "action_match", "从上一段结束动作的同一方向、速度和空间位置继续。"),
    transitionOut: transitionValue(lastSegment.transitionOut, "action_match", "下一段从本段结束动作的同一方向、速度和空间位置继续。"),
    prompt,
    continuity: {
      inherits: clipIndex === 1 ? [] : ["character_position", "screen_direction", "prop_state", "lighting_direction", "continuing_sound"],
      lock: ["character_identity", "costume", "scene_layout", "asset_ids"],
      anchors: refs.continuityAnchors,
      screenDirections: refs.screenDirections,
    },
  };
}

function compileEpisode({ episodeNumber, scenes, charactersById, dialogue, warnings, durationSettings }) {
  const isVariable = durationSettings.segmentDurationPolicy === SEGMENT_DURATION_POLICY_VARIABLE;
  const segmentMinimum = MIN_SEGMENT_SECONDS;
  const segmentMaximum = isVariable ? MAX_SEGMENT_SECONDS : FIXED_SEGMENT_SECONDS;
  const sceneMap = new Map(scenes.map((scene) => [text(scene?.id, 160), scene]));
  const segments = [];
  let clipStart = 0;
  let current = [];
  let elapsed = 0;
  let clipIndex = 1;
  const flush = (padding = false) => {
    if (!current.length) return;
    if (padding) {
      const paddingDuration = isVariable ? segmentMinimum - elapsed : segmentMaximum - elapsed;
      current.push({
        sceneId: current.at(-1).sceneId,
        sourceShotId: current.at(-1).sourceShotId,
        type: "hold",
        description: "延长当前动作结果，保留留白和声音桥，不引入新的剧情事实。",
        durationSeconds: paddingDuration,
        offsetSeconds: current.at(-1).offsetSeconds + current.at(-1).durationSeconds,
        sliceType: "padding",
        assetRefs: current.at(-1).assetRefs,
        startState: current.at(-1).endState,
        endState: current.at(-1).endState,
      });
      elapsed = segmentMaximum === FIXED_SEGMENT_SECONDS ? segmentMaximum : elapsed + paddingDuration;
    }
    segments.push(createClip({ episodeNumber, clipIndex, start: clipStart, segments: current, sceneMap, charactersById, dialogue, durationSeconds: elapsed }));
    clipIndex += 1;
    clipStart += elapsed;
    current = [];
    elapsed = 0;
  };
  for (const scene of scenes) {
    const shots = createShotSegments(scene, warnings);
    for (const shot of shots) {
      let remaining = shot.durationSeconds;
      let offset = 0;
      while (remaining > 0) {
        const capacity = segmentMaximum - elapsed;
        const durationSeconds = Math.min(remaining, capacity);
        const sliceType = offset === 0 ? (durationSeconds < shot.durationSeconds ? "start" : "full") : (durationSeconds < remaining ? "continuation" : "end");
        current.push({
          sceneId: text(scene?.id, 160),
          sourceShotId: shot.shotId,
          type: shot.type,
          description: sliceDescription(shot.description, sliceType),
          durationSeconds,
          offsetSeconds: offset,
          sliceType,
          startState: offset === 0 ? text(shot.startState || scene?.start_state_zh, 1800) : "动作从上一时间片继续，不重置人物、道具和空间位置。",
          endState: durationSeconds >= remaining
            ? text(shot.endState || scene?.end_state_zh, 1800)
            : `${sliceDescription(shot.description, sliceType)}尚未完成，下一段从同一动作和空间位置继续。`,
          transitionIn: shot.transitionIn,
          transitionOut: shot.transitionOut,
          assetRefs: shot.assetRefs || refs,
        });
        remaining -= durationSeconds;
        offset += durationSeconds;
        elapsed += durationSeconds;
        if (remaining > 0 || elapsed >= FIXED_SEGMENT_SECONDS) {
          if (remaining > 0) warnings.push({ code: "SHOT_SPLIT_AT_BOUNDARY", sceneId: text(scene?.id, 160), shotId: shot.shotId, message: `镜头 ${shot.shotId} 跨越${segmentMaximum}秒边界，已使用动作延续拆分。` });
          flush(false);
        }
      }
    }
  }
  if (current.length) flush(current.reduce((sum, segment) => sum + segment.durationSeconds, 0) < segmentMinimum);
  segments.forEach((clip, index) => {
    const sourceTransition = clip.sourceSegments.at(-1)?.transitionOut;
    clip.transitionOut = index === segments.length - 1
      ? sourceTransition
        ? transitionValue(sourceTransition, "sound_bridge", "以动作结果或延续声音交给下一场景或剪辑。")
        : { type: "sound_bridge", description: "以动作结果或延续声音交给下一场景或剪辑。" }
      : transitionValue(clip.transitionOut, "action_match", "下一段从本段结束动作的同一方向、速度和空间位置继续。");
  });
  return segments;
}

function compileVideoPromptPack(source = {}) {
  const durationSettings = normalizeDurationSettings(source, { fallbackDurationMode: "short_drama_15s" });
  const characters = asObject(source.characters);
  const scenes = asObject(source.scenes);
  const dialogue = asObject(source.dialogue);
  const arc = asObject(source.arc);
  const charactersById = new Map(asArray(characters.characters).map((character) => [text(character?.id, 160), character]));
  const scenesByEpisode = new Map();
  asArray(scenes.scenes).forEach((scene) => {
    const episodeNumber = Number(scene?.unit_number);
    if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) return;
    if (!scenesByEpisode.has(episodeNumber)) scenesByEpisode.set(episodeNumber, []);
    scenesByEpisode.get(episodeNumber).push(scene);
  });
  const episodeNumbers = unique([
    ...asArray(arc.units).map((unit) => Number(unit?.number)),
    ...scenesByEpisode.keys(),
  ]).map(Number).filter((number) => Number.isInteger(number) && number > 0).sort((a, b) => a - b);
  const warnings = [];
  const episodes = episodeNumbers.map((episodeNumber) => {
    const episode = asArray(arc.units).find((unit) => Number(unit?.number) === episodeNumber) || {};
    const episodeScenes = scenesByEpisode.get(episodeNumber) || [];
    return {
      episodeNumber,
      title: text(episode?.title_zh, 300),
      clips: compileEpisode({ episodeNumber, scenes: episodeScenes, charactersById, dialogue, warnings, durationSettings }),
    };
  });
  const pack = {
    schemaVersion: 2,
    type: "pixeltale_video_prompt_pack",
    projectId: text(source.projectId, 500),
    storyTitle: text(source.storyTitle || source.input?.storyTitle, 300),
    mode: text(source.mode, 80),
    ...(durationSettings.segmentDurationPolicy === SEGMENT_DURATION_POLICY_LEGACY_15 ? { fixedSegmentSeconds: FIXED_SEGMENT_SECONDS } : {}),
    durationMode: durationSettings.durationMode,
    segmentDuration: durationSettings.segmentDuration,
    source: { stages: ["characters", "arc", "scenes", "dialogue"], generatedAt: new Date().toISOString() },
    assetManifest: {
      characters: asArray(characters.characters).map((item) => ({ id: text(item?.id, 160), name: text(item?.name_zh || item?.name_en, 300), role: text(item?.role, 120), version: text(item?.version, 80) })),
      scenes: asArray(scenes.scenes).map((item) => ({ id: text(item?.id, 160), name: text(item?.name_zh || item?.location_zh, 300), layoutId: text(item?.layout_asset_id || item?.layout_ref || item?.id, 160) })),
      props: asArray(scenes.scenes).flatMap(sceneProps).map((item) => ({ id: text(item?.id, 160), name: text(item?.name_zh || item?.name_en, 300), version: text(item?.version, 80) })),
    },
    episodes,
    validation: { errors: [], warnings },
  };
  const structuralValidation = validateVideoPromptPack(pack);
  pack.validation = { errors: structuralValidation.errors, warnings: [...warnings, ...structuralValidation.warnings] };
  return pack;
}

function validateVideoPromptPack(pack = {}) {
  const errors = [];
  const warnings = [];
  const legacyPack = Number(pack.schemaVersion || 1) < 2 || pack.segmentDuration?.policy === SEGMENT_DURATION_POLICY_LEGACY_15;
  const durationSettings = normalizeDurationSettings({
    durationMode: pack.durationMode,
    segmentDurationPolicy: pack.segmentDuration?.policy,
    defaultSegmentDurationSeconds: pack.segmentDuration?.default || pack.fixedSegmentSeconds,
  }, { fallbackDurationMode: legacyPack ? "short_drama_15s" : "short_drama_variable" });
  if (legacyPack && Number(pack.fixedSegmentSeconds) !== FIXED_SEGMENT_SECONDS) errors.push({ code: "FIXED_SEGMENT_SECONDS_INVALID", message: "旧版视频提示词包必须固定为15秒片段。" });
  if (!asArray(pack.episodes).length) errors.push({ code: "EPISODES_MISSING", message: "视频提示词包没有可生成的分集。" });
  const seen = new Set();
  asArray(pack.episodes).forEach((episode) => {
    const clips = asArray(episode?.clips);
    if (!clips.length) errors.push({ code: "EPISODE_CLIPS_MISSING", episodeNumber: episode?.episodeNumber, message: `第${episode?.episodeNumber || "?"}集没有可生成的视频片段。` });
    clips.forEach((clip) => {
      const id = text(clip?.clipId, 160);
      if (!id) errors.push({ code: "CLIP_ID_MISSING", message: "片段缺少 clipId。" });
      if (seen.has(id)) errors.push({ code: "CLIP_ID_DUPLICATE", clipId: id, message: `片段 ${id} 重复。` });
      seen.add(id);
      const duration = Number(clip?.durationSeconds);
      if (durationSettings.segmentDurationPolicy === SEGMENT_DURATION_POLICY_LEGACY_15) {
        if (duration !== FIXED_SEGMENT_SECONDS) errors.push({ code: "CLIP_DURATION_NOT_15", clipId: id, message: `片段 ${id} 不是15秒。` });
      } else if (!Number.isFinite(duration) || duration < MIN_SEGMENT_SECONDS || duration > MAX_SEGMENT_SECONDS) {
        errors.push({ code: "CLIP_DURATION_OUT_OF_RANGE", clipId: id, message: `片段 ${id} 时长不在${MIN_SEGMENT_SECONDS}-${MAX_SEGMENT_SECONDS}秒范围内。` });
      }
      for (const field of ["startState", "action", "endState", "prompt"]) {
        if (!text(clip?.[field], 4000)) errors.push({ code: "CLIP_FIELD_MISSING", clipId: id, field, message: `片段 ${id} 缺少 ${field}。` });
      }
      if (!asArray(clip?.sceneIds).length) warnings.push({ code: "CLIP_SCENE_REF_MISSING", clipId: id, message: `片段 ${id} 没有场景引用。` });
      if (!asArray(clip?.assetRefs?.characterIds).length) warnings.push({ code: "CLIP_CHARACTER_REF_MISSING", clipId: id, message: `片段 ${id} 没有角色资产引用。` });
    });
  });
  return { errors, warnings };
}

module.exports = { FIXED_SEGMENT_SECONDS, compileVideoPromptPack, validateVideoPromptPack };
