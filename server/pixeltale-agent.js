const crypto = require("node:crypto");
const path = require("node:path");
const { REVIEW_SEATS, LEGACY_MODEL_IDS, RETIRED_SEAT_MODELS } = require("./pixeltale-api.js");
// Two reasons a stored route must be rewritten on read:
//  - the model was retired outright (LEGACY_MODEL_IDS)
//  - the model lost its seat to a replacement (RETIRED_SEAT_MODELS)
// Without the second case, editing REVIEW_SEATS only affects brand-new sessions:
// existing projects keep running the old roster because their saved seat_* values
// override the new defaults.
const LEGACY_ROUTE_MODELS = new Set([...LEGACY_MODEL_IDS, ...RETIRED_SEAT_MODELS]);
// Retired outright: unusable in any slot. Kept separate from the seat-only set so
// the vestigial route keys are not rewritten just because a model lost its seat.
const RETIRED_MODEL_IDS = new Set(LEGACY_MODEL_IDS);
const { fallbackVisualAssets } = require("./pixeltale-visual-assets.js");
const { runStageRules, EPISODE_TITLE_CODENAME } = require("./pixeltale-review-rules.js");

const STAGES = ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue"];
const STAGE_LABELS = Object.freeze({ brief: "故事架构", title: "剧名选择", proposal: "故事提案", characters: "人物与世界", arc: "分集与章节", scenes: "场景与镜头", dialogue: "对白本土化" });
const DEFAULT_ROUTES = {
  orchestration: "gpt-5.6-terra",
  continuity: "gemini-3.1-pro",
  // 网关（beefapi）不提供 claude-* 模型（实测 /models 只有 GPT 系列），
  // claude-haiku-4-5/claude-sonnet-5 会 404 model_not_found——hooks/dialogueReview
  // 改用 beefapi 确认存在的模型，保证新项目默认路由可用。
  hooks: "gpt-5.5",
  dialogueReview: "deepseek-v4-pro",
  consistency: "gpt-5.6-luna",
  seat_a: "gpt-5.6-terra",
  seat_b: "gpt-5.6-sol",
  seat_c: "deepseek-v4-pro",
};
// 网关确定不提供的模型（claude 全家）——任何槽位保存了它们都必须重写为当前默认，
// 否则存量项目 state 里的旧 hooks/dialogueReview 值会一直 404。
const UNUSABLE_ROUTE_MODELS = new Set(["claude-opus-5", "claude-haiku-4-5", "claude-sonnet-5"]);
// The three authors run concurrently, so round 1 consumes about `model` ms of the
// shared `total` budget. The fallback round then gets only `total - model`, which
// must still be large enough to regenerate the whole stage payload — otherwise the
// retry is structurally dead. Keep `total >= 2 * model + margin`.
// Measured on the real characters prompt (7000-token payload):
// claude-haiku-4-5 70s, gpt-5.6-terra 93-108s, claude-opus-5 208s.
// `model` is sized at roughly 1.3x the slowest observed seat.
const STAGE_PRIMARY_TIMINGS = Object.freeze({
  brief: { total: 270_000, model: 120_000 },
  title: { total: 200_000, model: 90_000 },
  proposal: { total: 340_000, model: 150_000 },
  characters: { total: 600_000, model: 270_000 },
  arc: { total: 660_000, model: 300_000 },
  scenes: { total: 660_000, model: 300_000 },
  dialogue: { total: 660_000, model: 300_000 },
});
const MIN_STAGE_PRIMARY_ATTEMPT_MS = 3_000;
const STAGE_PRIMARY_RETRY_ROUNDS = 2;
// A review seat must read the whole stage artifact before it can answer, so this
// budget scales with artifact size, not with review output size. Measured on a
// 13-character (13.9 kB) characters artifact: gpt-5.6-terra 44s, claude-opus-5
// exceeded 120s, and its grok fallback then burned another 120s — leaving only one
// of three seats completed and blocking release. 240s covers the slowest seat on
// the largest artifacts with headroom for its fallback.
const REVIEW_MODEL_TIMEOUT_MS = 240_000;
// Two matching findings are enough to classify a shared issue. Stage release
// requires the review seats to finish (2 seats since 2026-08-08 speed pass).
const REVIEW_QUORUM = 2;
const REVIEW_COMPLETION_REQUIRED = 2;
// 共识放行阈值：2 席全部通过即放行（多数制）；分歧席记录不阻断。
const REVIEW_PASS_QUORUM = 2;
// 自动放行：多数通过 + 意见一致 ≥ 90% 时，无需人工确认，自动进入下一步。
const AUTO_APPROVE_AGREEMENT = 90;
const REVIEW_DIMENSIONS = ["structure", "plot", "design", "logic"];
const EPISODE_BATCH_SIZE = 5;
const UNIT_STAGES = new Set(["arc", "scenes"]);
const FAST_REVIEW_STAGES = new Set(["brief", "proposal", "characters", "dialogue"]);
const STAGE_OUTPUT_TOKEN_BUDGETS = Object.freeze({
  brief: 1_800,
  title: 2_400,
  proposal: 2_800,
  // characters schema trimmed to 4 visual fields → output ~3.5 kB → fits 4 k tokens.
  characters: 4_000,
  arc: 12_000,
  scenes: 12_000,
  dialogue: 12_000,
});
const REVIEW_OUTPUT_TOKEN_BUDGETS = Object.freeze({
  brief: 1_200,
  title: 1_400,
  proposal: 1_800,
  characters: 2_800,
  arc: 4_000,
  scenes: 4_000,
  dialogue: 4_000,
});

// DeepSeek 官方端点严格按 max_tokens 截断（OpenAI 兼容网关不截断 maxTokens）。中文审核输出
// token 密度高，且 deepseek 的 max_tokens 预算包含 reasoning_tokens（推理 token，实测单次审核
// 推理可达 1800+）；1800 的 proposal 审核预算曾被截断（TRUNCATED_OUTPUT，2026-08-07 提案卡死
// 事故，×3=5400 在含 revisionContract 的真实长 prompt 下仍可能不够）。这里仅对 deepseek provider
// 放大到接近官方上限，其余模型保持紧凑审核设计。
function reviewTokenBudget(stage, provider) {
  const base = REVIEW_OUTPUT_TOKEN_BUDGETS[stage] || 3_000;
  return String(provider).startsWith("deepseek") ? Math.min(8_000, Math.max(base * 4, 4_800)) : base;
}

// 生成阶段（council author / synthesis）预算：deepseek 的 max_tokens 含 reasoning_tokens，
// proposal 生成预算 2800 曾被 seat_c 推理(实测 2834)耗尽而 TRUNCATED（2026-08-07 提案卡死根因）。
function stageTokenBudget(stage, provider) {
  const base = STAGE_OUTPUT_TOKEN_BUDGETS[stage] || STAGE_OUTPUT_TOKEN_BUDGETS.proposal;
  return String(provider).startsWith("deepseek") ? Math.min(8_000, Math.max(base * 4, 4_800)) : base;
}
// 2026-08-08 提速：自动修复轮 2 → 1（每批省一整轮 主笔+审核 ≈ 19 分钟）。
const UNIT_AUTO_REPAIR_MAX_PASSES = 1;
const AUTO_REPAIR_TOKEN_BUDGET = 30_000;
const STAGE_REVIEW_CRITERIA = Object.freeze({
  brief: {
    BRIEF_SPEC_MATCH: "创作规格与用户输入一致",
    BRIEF_PROJECT_ISOLATION: "没有混入其他项目或旧故事",
    BRIEF_CORE_CONFLICT: "核心冲突包含主角、目标、阻碍与代价",
    BRIEF_AUDIENCE_MARKET: "受众与目标市场方向成立",
    BRIEF_OPENING_PROMISE: "开头暴击与观众追问明确",
    BRIEF_SERIES_ENGINE: "持续追更的问题与每集承诺明确",
    BRIEF_PRODUCTION_FEASIBILITY: "概念可继续发展且不存在明显制作死角",
  },
  title: {
    TITLE_COUNT_VARIETY: "恰好四个且风格有区分",
    TITLE_CONCEPT_MATCH: "名称准确承接核心概念",
    TITLE_MARKET_FIT: "符合目标市场与受众的传播语感",
  },
  proposal: {
    PROPOSAL_CAUSAL_CHAIN: "目标、阻碍、代价和行动形成因果链",
    PROPOSAL_FIRST_IMPACT: "首个冲击可视且立即改变局面",
    PROPOSAL_PROMISED_PAYOFF: "故事承诺与首个反转可兑现",
  },
  characters: {
    CHARACTER_LOCALIZATION: "姓名、身份和社会细节符合地区",
    CHARACTER_MOTIVATION: "欲望、恐惧、秘密和选择相互支撑",
    CHARACTER_RELATIONSHIP_ENGINE: "人物关系能够持续制造行动与冲突",
    CHARACTER_WORLD_CONSISTENCY: "人物设定不违反已确认世界规则",
  },
  arc: {
    ARC_UNIT_COUNT: "单元数量与创作规格一致",
    ARC_CAUSAL_PROGRESS: "每个单元都推进主因果链",
    ARC_REVERSAL_HOOK: "反转与集尾钩子有证据且不重复",
    ARC_PAYOFF_LEDGER: "伏笔、承诺和回收位置可追踪",
    ARC_EPISODE_PLOT_COMPLETENESS: "每个单元都有完整剧情推进，不是审核摘要",
  },
  scenes: {
    SCENE_REFERENCE_INTEGRITY: "人物、地点和事件引用有效",
    SCENE_STATE_CHANGE: "每场戏都改变信息、关系或行动状态",
    SCENE_DURATION: "每集所有场景的 shot_plan[].duration_seconds 之和相对用户设定的单集目标秒数允许偏差不超过 ±25%（生成时按目标 ±10% 设计）",
    SCENE_DIRECTABILITY: "场面可拍摄、可表演且可制作",
  },
  dialogue: {
    DIALOGUE_REFERENCE_INTEGRITY: "说话人与场景引用有效",
    DIALOGUE_INTENT_MATCH: "英文对白准确兑现中文剧情意图",
    DIALOGUE_LOCALIZATION: "口语、身份、地区和关系语感自然",
    DIALOGUE_VOICE_TIMING: "人物声线可区分且时长可执行",
  },
});
const DEFAULT_DIALOGUE_POLICY = "zh_story_en_localized_dialogue";
const DEFAULT_CREATIVE_CONTROLS = {
  openingImpactSeconds: 3,
  openingPromise: "mainline_promise",
  hookCadence: "every_episode",
  dialogueMode: "localized_english",
  handoffScope: "confirmed_versioned",
};
const DEFAULT_MARKET = {
  marketRegion: "north_america",
  marketCountry: "united_states",
  localizationNote: "",
};
const MARKET_PROFILES = {
  united_states: { region: "north_america", label: "美国", setting: "美国当代社会、职业与生活细节", names: "使用自然的美国姓名与地名；角色显示名不得翻译成中文名", dialogue: "自然美式英语口语，避免网络刻板印象和生硬俚语" },
  united_kingdom: { region: "europe", label: "英国", setting: "英国当代社会、阶层、城市与生活细节", names: "使用自然的英国姓名与地名；角色显示名不得翻译成中文名", dialogue: "自然英式英语口语，克制使用地区表达" },
  canada: { region: "north_america", label: "加拿大", setting: "加拿大当代城市、多元社区与生活细节", names: "使用自然的加拿大姓名与地名；角色显示名不得翻译成中文名", dialogue: "自然北美英语口语，保持加拿大社会语境" },
  mexico: { region: "latin_america", label: "墨西哥", setting: "墨西哥本土城市、家庭和社会关系细节", names: "使用自然的墨西哥西语姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，人物关系与称呼体现墨西哥语境，不夹杂无解释西语" },
  brazil: { region: "latin_america", label: "巴西", setting: "巴西本土城市、家庭和社会关系细节", names: "使用自然的巴西葡语姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，人物关系与称呼体现巴西语境，不夹杂无解释葡语" },
  germany: { region: "europe", label: "德国", setting: "德国当代城市、工作和社会生活细节", names: "使用自然的德国姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，人物行为和社会细节适配德国语境" },
  france: { region: "europe", label: "法国", setting: "法国当代城市、家庭和社会生活细节", names: "使用自然的法国姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，人物行为和社会细节适配法国语境" },
  japan: { region: "east_asia", label: "日本", setting: "日本本土城市、学校、职场和社会关系细节", names: "使用自然的日文罗马字姓名与日本地名；不要用中文姓名替代", dialogue: "英文对白保持自然国际英语，人物礼貌层级与社会距离适配日本语境" },
  south_korea: { region: "east_asia", label: "韩国", setting: "韩国本土城市、家庭、职场和社会关系细节", names: "使用自然的韩文罗马字姓名与韩国地名；不要用中文姓名替代", dialogue: "英文对白保持自然国际英语，人物礼貌层级与社会距离适配韩国语境" },
  indonesia: { region: "southeast_asia", label: "印度尼西亚", setting: "印尼本土城市、家庭和社会关系细节", names: "使用自然的印尼姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，人物行为与社会细节适配印尼语境" },
  philippines: { region: "southeast_asia", label: "菲律宾", setting: "菲律宾本土城市、家庭和社会关系细节", names: "使用自然的菲律宾姓名与地名；不要出现中文角色名", dialogue: "使用自然的菲律宾英语口语，避免生硬模仿口音" },
  thailand: { region: "southeast_asia", label: "泰国", setting: "泰国本土城市、家庭和社会关系细节", names: "使用自然的泰国姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，人物行为与社会细节适配泰国语境" },
  saudi_arabia: { region: "mena", label: "沙特阿拉伯", setting: "沙特本土城市、家庭与社会生活细节", names: "使用自然的阿拉伯姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，尊重当地社会规范，不挪用文化符号" },
  united_arab_emirates: { region: "mena", label: "阿联酋", setting: "阿联酋城市、多元职业与社会生活细节", names: "使用自然的阿拉伯或当地常见姓名与地名；不要出现中文角色名", dialogue: "英文对白保持自然国际英语，尊重当地社会规范，不挪用文化符号" },
  CN: { region: "east_asia", label: "中国大陆", setting: "中国大陆当代城市、家庭、职场与社会关系细节", names: "使用自然中文姓名、地名和机构名称，符合国内短剧语感", dialogue: "纯中文对白，本土化口语表达，贴近国内观众语感" },
};
const STAGE_OPTIONS = {
  brief: { storySetting: ["urban_contemporary", "small_town", "elite_world", "heightened_reality"], storyDirection: ["mystery", "revenge", "romance", "rise"] },
  title: { titleTone: ["commercial_hook", "cold_mystery", "poetic", "character_fate"] },
  proposal: { centralConflict: ["identity", "power", "love", "family"] },
  characters: { relationshipTone: ["alliance_conflict", "love_hate", "family_betrayal", "forbidden_bond"] },
  arc: { twistStyle: ["identity_reveal", "information_reversal", "moral_choice", "power_shift"] },
  scenes: { sceneRhythm: ["close_pressure", "visual_mystery", "daily_contrast", "scale_escalation"] },
  dialogue: { dialogueEnergy: ["direct", "restrained", "witty", "intimate"] },
};
const RESERVED_TITLE_REFERENCES = new Set([
  "wednesday", "you", "stranger things", "squid game", "the diplomat", "the residence", "house of the dragon", "euphoria", "the wire", "succession", "the last of us", "black mirror",
]);
const CREATIVE_CONTROL_VALUES = {
  openingPromise: ["mainline_promise", "character_crisis", "world_mystery"],
  hookCadence: ["every_episode", "double_hook", "key_unit"],
  dialogueMode: ["zh_story_zh_localized_dialogue", "localized_english", "localized_english_sharp", "localized_english_subtle"],
  handoffScope: ["confirmed_versioned", "script_and_assets"],
};

function text(value, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCreativeControls(input = {}) {
  const source = asObject(input);
  const rawImpact = Number(source.openingImpactSeconds);
  return {
    openingImpactSeconds: Number.isFinite(rawImpact)
      ? Math.max(0, Math.min(5, Math.round(rawImpact)))
      : DEFAULT_CREATIVE_CONTROLS.openingImpactSeconds,
    openingPromise: CREATIVE_CONTROL_VALUES.openingPromise.includes(source.openingPromise)
      ? source.openingPromise
      : DEFAULT_CREATIVE_CONTROLS.openingPromise,
    hookCadence: CREATIVE_CONTROL_VALUES.hookCadence.includes(source.hookCadence)
      ? source.hookCadence
      : DEFAULT_CREATIVE_CONTROLS.hookCadence,
    dialogueMode: CREATIVE_CONTROL_VALUES.dialogueMode.includes(source.dialogueMode)
      ? source.dialogueMode
      : DEFAULT_CREATIVE_CONTROLS.dialogueMode,
    handoffScope: CREATIVE_CONTROL_VALUES.handoffScope.includes(source.handoffScope)
      ? source.handoffScope
      : DEFAULT_CREATIVE_CONTROLS.handoffScope,
  };
}

function normalizeMarket(input = {}, mode = "") {
  const source = asObject(input);
  const normalizedMode = normalizeMode(mode || source.mode);
  const country = normalizedMode === "cn_short_drama"
    ? "CN"
    : MARKET_PROFILES[source.marketCountry] ? source.marketCountry : DEFAULT_MARKET.marketCountry;
  const profile = MARKET_PROFILES[country];
  return {
    marketRegion: profile.region,
    marketCountry: country,
    localizationNote: text(source.localizationNote, 1200),
  };
}

function normalizeStageOptions(input = {}) {
  const source = asObject(input);
  const rawOptions = asObject(source.stageOptions);
  const rawGuidance = asObject(source.stageGuidance);
  const stageOptions = {};
  const stageGuidance = {};
  for (const stage of STAGES) {
    const allowed = STAGE_OPTIONS[stage] || {};
    const selected = asObject(rawOptions[stage]);
    stageOptions[stage] = Object.fromEntries(Object.entries(allowed).map(([key, values]) => [key, values.includes(selected[key]) ? selected[key] : values[0]]));
    stageGuidance[stage] = text(rawGuidance[stage], 1600);
  }
  return { stageOptions, stageGuidance };
}

function marketPrompt(input = {}, mode = "") {
  const market = normalizeMarket(input, mode);
  const profile = MARKET_PROFILES[market.marketCountry];
  return [
    `目标投放市场：${profile.label}。`,
    `剧情本土化：${profile.setting}。`,
    `命名规则：${profile.names}。中文剧情叙述可以解释文化背景，但人物、地名、机构和店名必须保留该市场自然的显示名称。`,
    `对白规则：${profile.dialogue}。`,
    market.localizationNote ? `用户补充的本土化要求：${market.localizationNote}` : "没有额外本土化要求。",
  ].join("\n");
}

function normalizeAudience(input = {}) {
  const source = typeof input === "string" ? { audience: input } : asObject(input);
  const selected = text(source.audienceGender, 40).toLowerCase();
  if (["all", "male", "female"].includes(selected)) return selected;
  const raw = text(source.audience, 80).toLowerCase();
  if (["female", "female_drama", "女频", "女性"].includes(raw)) return "female";
  if (["male", "male_drama", "男频", "男性"].includes(raw)) return "male";
  return "all";
}

function audiencePrompt(input = {}) {
  const direction = normalizeAudience(input);
  const guidance = direction === "female"
    ? "优先强化人物关系、情感张力、身份与选择的代价、情绪回报和关系反转；不要把女性角色写成被动的剧情工具。"
    : direction === "male"
      ? "优先强化目标驱动、能力成长、竞争对抗、资源升级、行动回报和清晰的胜负推进；不要用空泛旁白替代主角行动。"
      : "在目标驱动、人物关系、情感张力与悬念推进之间保持平衡，并以用户创作想法为最高优先级。";
  const label = { all: "全部受众", male: "男性受众", female: "女性受众" }[direction];
  return `目标受众偏好方向：${label}。${guidance} 此方向只决定选题、人物关系、爽点和钩子的优先级，不得把任何性别写成固定审美或刻板角色。`;
}

function stageParticipationPrompt(stage, input = {}) {
  const participation = normalizeStageOptions(input);
  const choices = participation.stageOptions[stage] || {};
  const guidance = participation.stageGuidance[stage] || "";
  return [
    `用户在本阶段的方向选择：${Object.entries(choices).map(([key, value]) => `${key}=${value}`).join("；") || "无"}。`,
    guidance ? `用户针对本阶段的介入意见：${guidance}。此意见只修订本阶段产物，必须尊重前序已确认资产。` : "用户没有补充本阶段介入意见。",
  ].join("\n");
}

function creativeControlPrompt(input = {}, mode = "tk_short_drama") {
  const controls = normalizeCreativeControls(input);
  const normalized = normalizeMode(mode);

  let opening, dialogueStyle;

  if (normalized === "tk_short_drama") {
    opening = `开头冲击窗口：前 ${controls.openingImpactSeconds} 秒内必须给出可感知的冲击或异常。`;
    dialogueStyle = `英文对白风格：${controls.dialogueMode}，仍须保持中文剧情、英文对白且口语化本土化。`;
  } else if (normalized === "cn_short_drama") {
    opening = `开头冲击窗口：前 ${controls.openingImpactSeconds} 秒内必须给出强烈的身份反差、情感冲突或爆点。`;
    dialogueStyle = `中文对白风格：${controls.dialogueMode}，纯中文对白，本土化口语表达，贴近国内观众语感。`;
  } else {
    opening = `开场承诺类型：${controls.openingPromise}，首章必须明确主线推进方向。`;
    dialogueStyle = `英文对白风格：${controls.dialogueMode}，仍须保持中文剧情、英文对白且口语化本土化。`;
  }

  return [
    opening,
    `钩子频率：${controls.hookCadence}。`,
    dialogueStyle,
    `交接范围：${controls.handoffScope}，不得覆盖正式文件。`,
  ].join("\n");
}

function targetDurationSeconds(input = {}) {
  const source = asObject(input);
  const value = Number(source.durationValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = text(source.durationUnit, 40).toLowerCase();
  if (["sec", "secs", "second", "seconds", "秒"].includes(unit)) return value;
  if (["min", "mins", "minute", "minutes", "分", "分钟"].includes(unit)) return value * 60;
  return null;
}

function formatDurationSeconds(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function suggestedShotCountRange(targetSeconds) {
  const seconds = Number(targetSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const min = Math.ceil(seconds / 6);
  return { min, max: Math.max(min, Math.floor(seconds / 3)) };
}

function durationBudget(input = {}) {
  const targetSeconds = targetDurationSeconds(input);
  if (targetSeconds === null) return null;
  return {
    targetSeconds,
    minSeconds: targetSeconds * 0.9,
    maxSeconds: targetSeconds * 1.1,
    suggestedShots: suggestedShotCountRange(targetSeconds),
  };
}

function durationBudgetPrompt(input = {}) {
  const budget = durationBudget(input);
  if (!budget) return "";
  const controls = normalizeCreativeControls(input);
  return [
    `单集目标时长：${formatDurationSeconds(budget.targetSeconds)} 秒。`,
    `硬要求：每集所有 scene 的所有 shot_plan[].duration_seconds 之和必须落在 ${formatDurationSeconds(budget.minSeconds)}-${formatDurationSeconds(budget.maxSeconds)} 秒（目标±10%）。`,
    `建议每集 ${budget.suggestedShots.min}-${budget.suggestedShots.max} 个镜头（按平均 3-6 秒/镜头推导）。`,
    "每个镜头的 duration_seconds 必须是有意义的数字，不得为 0 或缺省；每集镜头必须覆盖该集全部剧情。",
    `开头冲击窗口：前 ${controls.openingImpactSeconds} 秒，已包含在单集目标时长内，不得另行叠加。`,
  ].join("\n");
}

function scenePromptInput(input = {}) {
  const source = asObject(input);
  if (durationBudget(source)) return source;
  const { durationValue, durationUnit, duration, ...withoutDuration } = source;
  return withoutDuration;
}

function nowIso(now = () => new Date()) {
  return new Date(now()).toISOString();
}

function id(prefix, randomUUID = crypto.randomUUID) {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

function normalizeMode(value) {
  const raw = text(value, 80).toLowerCase();
  if (["long", "long_form_drama", "long-form-drama", "普通长剧"].includes(raw)) return "long_form_drama";
  if (["cn", "cn_short_drama", "cn-short-drama", "国内短剧", "国内"].includes(raw)) return "cn_short_drama";
  return "tk_short_drama";
}

function modeLabel(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "long_form_drama") return "普通长剧";
  if (normalized === "cn_short_drama") return "国内短剧";
  return "TK 短剧";
}

function normalizeStage(value) {
  const stage = text(value, 40).toLowerCase();
  return STAGES.includes(stage) ? stage : "brief";
}

function normalizeRoutes(value = {}, availableModels = []) {
  const routes = { ...DEFAULT_ROUTES };
  const allowed = new Set(asArray(availableModels).map((item) => text(typeof item === "string" ? item : item?.id, 100).toLowerCase()).filter(Boolean));
  for (const key of Object.keys(routes)) {
    const raw = text(value?.[key], 100).toLowerCase();
    if (!raw) continue;
    const migrated = migratedRouteValue(key, raw);
    // No provider aliases or hidden defaults: PixelTale only accepts model IDs
    // registered by the injected SuperPixel router.
    if (!allowed.size || allowed.has(migrated)) routes[key] = migrated;
  }
  return routes;
}

// A stored route value is rewritten only when it can no longer serve the slot it
// was saved in. Seat slots additionally reject models that lost their seat, since
// otherwise a saved roster would outlive every REVIEW_SEATS change. The vestigial
// 5-slot keys are deliberately left alone: they no longer choose seats, and
// migrating them would rewrite a value to itself and re-persist on every read.
function migratedRouteValue(key, raw) {
  const seat = REVIEW_SEATS.find((item) => item.id === key);
  if (seat) return LEGACY_ROUTE_MODELS.has(raw) ? seat.model : raw;
  // 网关不可用模型：任何非 seat 槽保存了它都必须重写为当前默认（否则存量项目持续 404）。
  if (UNUSABLE_ROUTE_MODELS.has(raw)) return DEFAULT_ROUTES[key];
  return RETIRED_MODEL_IDS.has(raw) ? DEFAULT_ROUTES[key] : raw;
}

// Must mirror migratedRouteValue exactly. If this reports a change the normalizer
// would not actually make, every read persists the same state forever.
function routesNeedMigration(value) {
  return Object.entries(asObject(value)).some(([key, entry]) => {
    const raw = text(entry, 100).toLowerCase();
    return raw ? migratedRouteValue(key, raw) !== raw : false;
  });
}

function modelForRoute(route) {
  return text(route, 100).toLowerCase();
}

function stageRoute(stage, mode, routes, availableModels = []) {
  const normalized = normalizeMode(mode);
  const current = normalizeRoutes(routes, availableModels);
  let primary;
  let reviewer;
  if (stage === "characters" || (stage === "arc" && normalized === "long_form_drama")) {
    primary = current.continuity;
    reviewer = current.orchestration;
  } else if (stage === "arc" || stage === "dialogue") {
    primary = current.hooks;
    reviewer = current.dialogueReview;
  } else {
    primary = current.orchestration;
    reviewer = current.continuity;
  }
  return { ...current, primary, reviewer, consistency: current.consistency };
}

function titleStylePrompt(mode, input = {}) {
  const normalized = normalizeMode(mode);
  const market = normalizeMarket(input, normalized);
  const profile = MARKET_PROFILES[market.marketCountry];
  const platform = text(input.platform, 120) || "国际流媒体 / 短视频平台";

  if (normalized === "cn_short_drama") {
    return [
      "剧名必须输出恰好 4 个候选，不能少于或多于 4 个。",
      "正式发行剧名字段 title_en 保持英文键名，但字段值必须使用自然中文，适配中国大陆市场与\"" + platform + "\"的传播语感。",
      "先读取 userInput 中的剧本 DNA、受众、平台和发行属性，再读取 approvedContext 中已确认的 brief；每个候选必须结合国内短剧爆款题材。",
      "四个候选必须分别使用不同命名基因：核心意象型、人物或关系型、地点或机构型、命运悬念型；naming_gene_zh 必须明确写出所用基因。",
      "国内短剧剧名优先 3-10 个中文字，要有独立的识别锚点，朗读自然、海报上易识别、搜索时有区分度。",
      "剧名必须是可独立成立的片名短语，不要写成主谓宾完整剧情句，不要把人物行动、因果过程、反转答案或结局直接写进标题。",
      "禁止“听懂……后我……”“……却要我……”“……为何等我……”这类剧情摘要句式；用一个身份、关系、地点、物件、秘密或异常意象承载钩子即可。",
      "题材可优先考虑霸总、赘婿、逆袭、重生、闪婚、马甲、宠妻、追妻等国内短剧常见方向。",
      "保持商业化表达，避免过度夸张或低俗，确保剧名适合平台发布。",
      "每个候选的 explanation_zh 用一句话解释剧名的钩子设计；reason_zh 说明它如何承接本剧 DNA、目标受众和发行场景。",
    ].join("\n");
  }

  return [
    "剧名必须输出恰好 4 个候选，不能少于或多于 4 个，名称之间不得只是同义词替换。",
    `正式发行片名必须使用自然英文，适配${profile.label}市场与“${platform}”的传播语感；中文只能写在 explanation_zh、style_zh、tone_zh、naming_gene_zh 和 reason_zh 中供创作者参考。`,
    "先读取 userInput 中的剧本 DNA、受众、平台和发行属性，再读取 approvedContext 中已确认的 brief；每个候选必须绑定一个本剧独有的身份、地点、关系、物件、秘密或异常意象，不能只套类型词。",
    "四个候选必须分别使用不同命名基因：人物身份或关系、地点或机构、异常物件或意象、带双重含义的极简短语。naming_gene_zh 必须明确写出所用基因。",
    `结合${modeLabel(mode)}节奏：TK 短剧优先 1-5 个英文单词，普通长剧优先 1-7 个英文单词；朗读自然、海报上可瞬间识别、搜索时有区分度。`,
    "片名要保留解释空间和语义张力，不要把剧情梗概、反转答案或人物结局直接写进标题。",
    "禁止廉价网文或移动短剧模板词组，包括 Billionaire、CEO、Mafia、Reborn、Revenge、Forbidden Love、Secret Love、Contract Wife、Fake Marriage；禁止冒号副标题、夸张营销句、陈词滥调和生硬中译英。",
    "只提炼欧美流媒体热剧常见的短、准、独特和可延展特征；不得复制、近似改写或拼接任何现有影视作品名。",
    "每个候选的 explanation_zh 用一句中文解释英文片名的字面义与剧情含义；reason_zh 说明它如何承接本剧 DNA、目标受众和发行场景。",
  ].join("\n");
}

function stripJsonFence(value) {
  const raw = text(value, 200000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

function parseJson(value, label) {
  try {
    return JSON.parse(stripJsonFence(value));
  } catch (error) {
    const parseError = new Error(`${label}未返回合法 JSON：${error.message}`);
    parseError.code = "INVALID_JSON";
    throw parseError;
  }
}

function responseContent(payload) {
  const choice = payload?.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice;
  if (Array.isArray(choice)) return choice.map((item) => item?.text || "").join("\n");
  if (typeof payload?.content?.[0]?.text === "string") return payload.content[0].text;
  return "";
}

function stageOutputContract(stage, mode) {
  const normalized = normalizeMode(mode);
  let common = stage === "title"
    ? `\n正式片名字段 title_en 必须使用英文；其余带 _zh 的解释字段使用中文。模式：${modeLabel(mode)}。`
    : `\n所有中文剧情字段必须使用中文；对白字段必须是自然、口语化、符合人物身份与语境的英文。不要逐字直译。模式：${modeLabel(mode)}。`;
  const contracts = {
    brief: `{"title_zh":"故事名","logline_zh":"一句话梗概","core_conflict_zh":"核心冲突","viewer_question_zh":"观众要追问的问题","episode_promise_zh":"每集持续兑现的承诺","mode_rules":["模式约束"]}`,
    title: `{"candidates":[{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"},{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"},{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"},{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"}],"selection_note_zh":"选择建议"}`,
    proposal: `{"title_zh":"故事名","premise_zh":"核心命题","logline_zh":"一句话梗概","viewer_question_zh":"核心悬念","protagonist_goal_zh":"主角目标","antagonistic_force_zh":"对抗力量","season_or_series_engine_zh":"持续推进引擎","first_impact_zh":"开头暴击","episode_hook_zh":"集尾钩子","reversal_zh":"首个反转"}`,
    // visual_profile keeps only the 4 fields needed for scene continuity.
    // body / facial_features / eye_color / costume_accessories / posture / prompt_zh
    // are moved to the visual-assets stage which already generates them independently.
    // Removing them from the characters call cuts output from ~8 kB to ~3.5 kB,
    // which eliminates INVALID_JSON / TIMEOUT on every seat for this stage.
    characters: `{"characters":[{"id":"C001","name_zh":"按目标市场生成的角色显示名，不得翻译为中文名","name_en":"English or romanized display name","role":"protagonist","desire_zh":"欲望","fear_zh":"恐惧","secret_zh":"秘密","arc_zh":"人物弧线","voice_rules_en":["英文声线规则"],"visual_profile":{"gender":"性别","age_phase":"年龄相","hair_color":"发型发色","palette":"识别色"}}],"relationships":[{"from":"C001","to":"C002","dynamic_zh":"关系变化"}],"world_rules":["不可违反的世界规则"]}`,
    arc: `{"unit":"episode_or_chapter","units":[{"number":1,"title_zh":"标题","promise_zh":"本集承诺","plot_zh":"本集完整剧情推进，包含人物行动、冲突、选择、结果与下一集动力，不是审核摘要","impact_zh":"开头暴击","causal_turn_zh":"因果转折","reversal_zh":"反转","hook_zh":"集尾强钩子","cliffhanger_question_zh":"未回答问题","payoff_zh":"推进或回收"}],"arc_summary_zh":"整体推进"}`,
    // Same trim as characters: the visual-assets stage regenerates every scene and
    // prop visual field independently, so asking for them here doubled the payload
    // for nothing. Measured at full payload: claude-opus-5 timed out at 300s,
    // deepseek-v4-pro returned invalid JSON at 256s, claude-haiku-4-5 returned an
    // empty scenes array. visual_profile keeps only the 3 fields a shot plan needs
    // for continuity; props keep identity and recurrence, not their look.
    scenes: `{"scenes":[{"id":"S001","unit_number":1,"purpose_zh":"场景目的","time_zh":"时间","location_zh":"地点","characters":["C001"],"action_zh":"连续动作推进","conflict_zh":"场面冲突","choice_zh":"人物主动选择","result_zh":"选择结果","turn_zh":"因果转折","visual_intent_zh":"画面意图","recurring":true,"visual_profile":{"indoor_outdoor":"室内外","lighting":"光线","palette":"色调"},"props":[{"id":"PR01","name_zh":"道具名","description_zh":"道具描述","recurring":true}],"shot_plan":[{"shot_id":"SH001","type":"impact","duration_seconds":3,"description_zh":"镜头描述","dialogue_refs":["D001"]}]}]}`,
    dialogue: `{"lines":[{"id":"D001","scene_id":"S001","speaker":"C001","intent_zh":"中文剧情意图","dialogue_en":"Natural localized English dialogue.","subtext_zh":"潜台词","delivery_en":"delivery note in English"}],"localization_checks":["口语化","人物声线一致","未泄露悬念"]}`,
  };
  if (normalized === "cn_short_drama") {
    common = stage === "title"
      ? "\n正式剧名字段 title_en 保持英文键名，但字段值必须是 6-15 个中文字；其余解释字段使用中文。模式：" + modeLabel(mode) + "。"
      : "\n对白字段 dialogue_en 保持英文键名，但字段值必须是纯中文、自然、口语化的对白；所有中文剧情字段使用中文。模式：" + modeLabel(mode) + "。";
    const cnTitleCandidate = { title_en: "中文正式剧名", explanation_zh: "中文释义", style_zh: "风格标签", tone_zh: "语气与气质", naming_gene_zh: "命名基因", reason_zh: "命名理由" };
    contracts.title = JSON.stringify({ candidates: Array.from({ length: 4 }, () => ({ ...cnTitleCandidate })), selection_note_zh: "选择建议" });
    contracts.dialogue = JSON.stringify({ lines: [{ id: "D001", scene_id: "S001", speaker: "C001", intent_zh: "中文剧情意图", dialogue_en: "自然中文对白", subtext_zh: "潜台词", delivery_en: "中文演绎说明" }], localization_checks: ["口语化", "人物声线一致", "未泄露悬念"] });
    // 国内短剧：voice_rules_en 键名保持通用（对白阶段仍按此字段引用声线），
    // 但内容必须是中文——角色说话方式用中文描写，与 dialogue_en 中文对白同模式。
    contracts.characters = contracts.characters.replace(
      '"voice_rules_en":["英文声线规则"]',
      '"voice_rules_en":["中文声线规则（用中文描写角色说话方式：句式长短、语气、口头禅、情绪表达习惯）"]',
    );
  }
  const sceneDurationContract = stage === "scenes"
    ? "\n时长契约：每集所有 scene 的所有 shot_plan[].duration_seconds 之和必须贴合用户设定的单集目标秒数；确定性检查允许偏差为 ±25%，生成时必须按目标 ±10% 设计。"
    : "";
  return `${contracts[stage]}${common}${sceneDurationContract}`;
}

function stageSystemPrompt(stage, mode, input = {}) {
  const controls = normalizeCreativeControls(input);
  const normalized = normalizeMode(mode);
  const sceneDurationPrompt = stage === "scenes" ? durationBudgetPrompt(input) : "";
  let tkRules = normalized === "tk_short_drama"
    ? [
      `开头前 ${controls.openingImpactSeconds} 秒必须出现可感知的冲击或异常。`,
      `按 ${controls.hookCadence} 设计每集钩子，至少有主动选择、重新解释前情的反转，集尾留下未回答问题。`,
      "钩子必须推动下一集探索，不用空泛的‘真相即将揭晓’。",
    ]
    : [
      `开场按 ${controls.openingPromise} 建立主线承诺。`,
      `按 ${controls.hookCadence} 推进章节节奏。`,
      "每章都要改变人物的选择空间，并与主线因果链相连。",
      "伏笔必须绑定后续回收位置，不用只制造氛围的伪伏笔。",
      "人物弧线通过选择体现，不用旁白宣告成长。",
    ];
  if (normalized === "cn_short_drama") {
    tkRules = [
      `前 ${controls.openingImpactSeconds} 秒内必须给出强烈的身份反差、情感冲突或剧情爆点。`,
      "每集都要通过主动选择、关系升级或身份揭示制造连续钩子。",
      "对白必须使用纯中文口语，符合中国大陆观众的称呼、节奏和情绪表达。",
    ];
  }
  const dialogueInstruction = normalized === "cn_short_drama"
    ? "对白字段必须是自然、口语化、符合人物身份与语境的中文；不要夹杂英文台词。"
    : "对白字段必须是自然、口语化、符合人物身份与语境的英文。不要逐字直译。";
  const titleRules = stage === "title" ? [titleStylePrompt(mode, input)] : [];
  const selectedTitleRule = stage !== "title" && text(input.storyTitle, 200)
    ? [`用户已确认剧名为“${text(input.storyTitle, 200)}”，后续产物必须沿用，不得擅自改名。`]
    : [];
  const arcRules = stage === "arc" ? [
    "分集与章节必须写出每集完整剧情正文，不是只列反转、钩子、未回答问题和推进与回收四个摘要字段。",
    "units 数量必须严格等于用户计划集数；每集 plot_zh 必须写清人物正在做什么、冲突如何升级、人物做了什么选择、选择造成什么结果，以及如何把下一集推出来。",
    "每集 title_zh 必须是完整中文短语标题（4-10 字），概括该集核心事件或冲突；禁止使用英文代号、字母数字组合（如 A-01、B-02、Witness C、Anchor A）、禁止直接用人物英文名或代码作标题。",
  ] : [];
  const sceneRules = stage === "scenes" ? [
    "场景与镜头必须覆盖每一个分集/章节编号，至少每集一个完整场次；不得只输出少量代表场景。",
    "每个场次必须把对应的剧情正文转换为可拍的动作、冲突、人物选择、选择结果和因果转折，不能只写视觉氛围或镜头关键词。",
    ...(sceneDurationPrompt ? [sceneDurationPrompt] : []),
  ] : [];
  const characterCompleteness = stage === "characters" ? [
    "一次性定义本剧全生命周期所需的角色体系：主角团、关键配角、反派/对抗方，以及后续集数必然出场的重要角色。",
    "不要只生成两三个主角：把剧情推进中必然需要的角色（家人、同事、对手、服务角色等）一并定义，避免后续阶段临时引入未定义角色。",
    "每个角色都必须有 id（C001 起）与 role；次要角色可精简设定，但必须有 ID 和一句话定位。",
  ] : [];
  const characterUsage = ["scenes", "dialogue"].includes(stage) ? [
    "场景/对白只引用 characters 阶段已确认的人物 ID；优先复用已定义角色。",
    "确需新角色时，直接使用新的 C 编号让其自然出场/说话即可——引擎会把该角色补录进人物名单，但标记为待确认身份；正式设定仍需回到人物阶段补齐。",
  ] : [];
  const unitRules = UNIT_STAGES.has(stage) ? [
    "当前请求可能只是一个分批单元；严格只输出 userInput.unitScope 指定的集数，不得补写其他集，不得返回整季内容。",
    "已锁定集只以压缩后的 startState、endState、openThreads 和 contentHash 作为连续性参考，不得重写、复述或复制已锁定集全文。",
    "arc 的 number 必须是全局集数；scenes 的 id 必须在全剧内唯一，不能每个批次都从同一个编号重新开始。",
  ] : [];
  return [
    "你是 PixelTale 编剧 Agent 的阶段执行器。你只负责当前阶段，不能跳过结构化资产直接写散文。",
    "输出严格 JSON，不要 Markdown，不要代码围栏，不要解释，不要增加契约之外的顶层字段。",
    dialogueInstruction,
    `当前阶段：${stage}。当前模式：${modeLabel(mode)}。`,
    creativeControlPrompt(controls, mode),
    audiencePrompt(input),
    marketPrompt(input, mode),
    stageParticipationPrompt(stage, input),
    ...tkRules,
    ...titleRules,
    ...selectedTitleRule,
    ...arcRules,
    ...sceneRules,
    ...unitRules,
    ...characterCompleteness,
    ...characterUsage,
    `输出契约：${stageOutputContract(stage, mode)}`,
  ].join("\n");
}

function stageContextContent(artifact, { unitScope = [] } = {}) {
  const content = asObject(artifact?.content);
  const scope = new Set(normalizeUnitNumbers(unitScope, 999));
  const compactUnit = (unit) => ({
    number: Number(unit?.number || unit?.unit_number || 0),
    title_zh: text(unit?.title_zh, 160),
    promise_zh: text(unit?.promise_zh, 300),
    plot_zh: text(unit?.plot_zh || unit?.action_zh, scope.size ? 2200 : 520),
    causal_turn_zh: text(unit?.causal_turn_zh, 360),
    hook_zh: text(unit?.hook_zh, 320),
    cliffhanger_question_zh: text(unit?.cliffhanger_question_zh, 240),
    payoff_zh: text(unit?.payoff_zh, 360),
  });
  if (artifact?.stage === "arc") {
    const units = asArray(content.units)
      .filter((unit) => !scope.size || scope.has(Number(unit?.number)))
      .map(compactUnit);
    return { arc_summary_zh: text(content.arc_summary_zh, 1800), units };
  }
  if (artifact?.stage === "scenes") {
    const scenes = asArray(content.scenes)
      .filter((scene) => !scope.size || scope.has(Number(scene?.unit_number)))
      .map((scene) => ({
        id: text(scene?.id, 100),
        unit_number: Number(scene?.unit_number || 0),
        location_zh: text(scene?.location_zh, 180),
        characters: asArray(scene?.characters).slice(0, 10),
        action_zh: text(scene?.action_zh, scope.size ? 1800 : 460),
        purpose_zh: text(scene?.purpose_zh, 360),
      }));
    return { scenes, props: asArray(content.props).slice(0, 24) };
  }
  if (artifact?.stage === "characters") {
    return {
      characters: asArray(content.characters).slice(0, 24).map((character) => ({
        id: text(character?.id, 80), name_zh: text(character?.name_zh, 120), name_en: text(character?.name_en, 120),
        role: text(character?.role, 180), desire_zh: text(character?.desire_zh, 360), fear_zh: text(character?.fear_zh, 300),
        secret_zh: text(character?.secret_zh, 360), arc_zh: text(character?.arc_zh, 520), voice_rules_en: text(character?.voice_rules_en, 520),
      })),
      relationships: asArray(content.relationships).slice(0, 36),
      world_rules: asArray(content.world_rules).slice(0, 24),
    };
  }
  const compact = {};
  Object.entries(content).slice(0, 20).forEach(([key, value]) => {
    compact[key] = typeof value === "string" ? text(value, 1200) : Array.isArray(value) ? value.slice(0, 12) : value;
  });
  return compact;
}

function stageContextPacket(previousArtifacts = [], { unitScope = [] } = {}) {
  return previousArtifacts.map((artifact) => ({
    stage: text(artifact?.stage, 80),
    type: text(artifact?.type, 120),
    version: Number(artifact?.version || 0),
    status: text(artifact?.status, 80),
    content: stageContextContent(artifact, { unitScope }),
  }));
}

function stageUserPrompt({ stage, mode, input, previousArtifacts, project, excludedTitles = [], unitScope = [], lockedContext = [], continuityContext = [] }) {
  const prior = stageContextPacket(previousArtifacts, { unitScope });
  const sceneDurationBudget = stage === "scenes" ? durationBudget(input) : null;
  return JSON.stringify({
    task: stage === "title"
      ? (normalizeMode(mode) === "cn_short_drama" ? "基于剧本 DNA、发行属性和已确认故事架构，生成 4 个全新的中文正式剧名候选。" : "基于剧本 DNA、发行属性和已确认故事架构，生成 4 个全新的英文正式片名候选。")
      : "基于创作规格和已确认结构，生成当前阶段唯一可审核的结构化产物。",
    project: { id: text(project?.id, 300), title: text(project?.title, 300), episode: text(project?.episode, 100) },
    mode,
    dialoguePolicy: normalizeMode(mode) === "cn_short_drama" ? "zh_story_zh_localized_dialogue" : DEFAULT_DIALOGUE_POLICY,
    audience: normalizeAudience(input),
    creativeControls: normalizeCreativeControls(input),
    market: normalizeMarket(input, mode),
    stageParticipation: normalizeStageOptions(input),
    currentStage: stage,
    ...(UNIT_STAGES.has(stage) ? {
      unitScope: normalizeUnitNumbers(unitScope, plannedUnitCount(input)),
      lockedUnitContext: lockedContext,
      continuityContext,
    } : {}),
    ...(stage === "arc" ? {
      structureExample: [
        {
          number: 1,
          title_zh: "黑雨里的徽记",
          promise_zh: "用主角被迫接管一件异常事件，建立她与核心悬念（徽记/旧承诺）的关联，并启动一条不可逆的照护路径。",
          plot_zh: "开场即异常：主角在雨夜撞见被黑色裂隙包围的孩子，孩子手中徽记发烫并呼唤旧名。主角在救人与上报之间做出主动选择（先救人），因此被卷入规则之外。中段反派/规则方登场施压，主角发现常规流程无效，被迫越界。结尾：孩子体征恶化，主角决定独自调查，为下一集留下行动钩子。",
        },
        {
          number: 2,
          title_zh: "她记得他",
          promise_zh: "揭示一个改变双方关系的身份事实：孩子记得主角的旧日身份，且这份记忆与徽记的力量绑定。",
          plot_zh: "承接上集：主角尝试常规求助却被挡回，孩子说出只有旧识才知道的话，主角意识到自己被认出来了。反派意识到徽记被激活，提前收网。主角利用对方一次误判设下反制（主动选择），短暂获得主动权。结尾：反制成功但暴露了主角的位置，反派放话追到天涯，钩住下一集。",
        },
      ],
    } : {}),
    ...(stage === "title" ? { excludedTitles: uniqueText(excludedTitles, 100) } : {}),
    ...(sceneDurationBudget ? {
      sceneDurationBudget: {
        targetSeconds: sceneDurationBudget.targetSeconds,
        requiredRangeSeconds: { min: sceneDurationBudget.minSeconds, max: sceneDurationBudget.maxSeconds },
        requiredTolerance: "目标±10%",
        suggestedShotCount: sceneDurationBudget.suggestedShots,
        openingImpactSeconds: normalizeCreativeControls(input).openingImpactSeconds,
        requirements: [
          "每集所有 scene 的所有 shot_plan[].duration_seconds 之和必须落在目标±10%区间内。",
          `建议每集 ${sceneDurationBudget.suggestedShots.min}-${sceneDurationBudget.suggestedShots.max} 个镜头（按平均 3-6 秒/镜头推导）。`,
          "每个镜头的 duration_seconds 必须是有意义的数字，不得为 0 或缺省；每集镜头必须覆盖该集全部剧情。",
          `开头冲击窗口为前 ${normalizeCreativeControls(input).openingImpactSeconds} 秒，已包含在单集目标时长内。`,
        ],
      },
    } : {}),
    userInput: stage === "scenes" ? scenePromptInput(input) : asObject(input),
    approvedContext: prior,
  }, null, 2).slice(0, 180000);
}

function reviewSystemPrompt(stage, mode, input = {}) {
  const criteria = STAGE_REVIEW_CRITERIA[stage] || {};
  return [
    "你是 PixelTale 的交叉审核 Agent。你不是润色员，也不是顺从的二次生成器；必须对上一个模型的产物进行独立、对抗式复核。",
    "输出严格 JSON，不要 Markdown、代码围栏或额外文字。",
    `检查阶段：${stage}；模式：${modeLabel(mode)}。`,
    "只审核当前阶段的交付契约，不得要求人物表、分集表、场景表或对白等尚未到达阶段的产物。",
    ...(stage === "brief" ? ["brief 只评价 title_zh、logline_zh、core_conflict_zh、viewer_question_zh、episode_promise_zh 和 mode_rules；不得要求分段规划、命名配角、警务流程或完整事件解释。"] : []),
    `本阶段唯一审核标准：${Object.entries(criteria).map(([id, description]) => `${id}=${description}`).join("；")}。`,
    "逐项比对待审产物、用户规格和已确认上下文；不要因为产物写得流畅就默认通过。",
    "重点寻找：前后设定冲突、因果断裂、角色动机缺口、市场本土化错误、模式节奏偏离、悬念提前泄露和无法执行的空泛表达。",
    "只返回最多 3 个会阻断下一阶段的问题；每项使用一个标准 ID、一句证据和一句可执行修改，不写二次策划案。",
    "required_changes 必须与 issues 一一对应，不得追加未在 issues 中举证的新要求。",
    "若输入包含 revisionClosureProtocol，则必须逐条返回 revision_closures：每条合同项只能标记 resolved、partial 或 unresolved，并写明修订证据和未完成时的剩余修改；不得遗漏合同编号。只有存在两个都符合阶段契约、但会导向不同创作方向的方案时，才能标记 requires_creator_decision=true 并给出两个 decision_options；普通未完成修订必须为 false。",
    "四个维度任一评分低于 75 时，必须明确分歧证据并提出供创作者裁决的取舍建议；不要把低于 75 的结果写成通过。",
    "只有 cross_validation、consistency、adversarial 三项均为 true，并且阶段专项检查均通过时，pass 才能为 true；发现任一硬伤必须 pass=false，并在 required_changes 中给出可执行修订意见。",
    creativeControlPrompt(input, mode),
    audiencePrompt(input),
    marketPrompt(input, mode),
    stageParticipationPrompt(stage, input),
    "pass 只有在结构完整、因果清晰、可执行、符合模式节奏、没有把悬念提前解释，并且角色名、地名、社会细节和对白都符合目标市场时才为 true。",
    "模式规则只能检查当前阶段已有字段：brief 检查开头承诺与追更问题，arc 才检查逐集钩子、反转与回收；不得提前索要后续资产。",
    "对白阶段还要检查英文是否自然口语化、是否保留中文剧情意图、是否像人物会说的话。",
    ...(stage === "title" ? ["剧名阶段必须检查恰好 4 个候选、名称不重复、四种命名基因确实拉开差异，并且每个候选都有风格、语气、命名基因和理由。"] : []),
    '输出契约：{"pass":true,"score":<0-100整数>,"confidence":<0-100整数>,"findings":["具体发现"],"required_changes":["必须修正的问题"],"issues":[{"criterion_id":"只能使用本阶段审核标准ID","tag":"稳定短标签","dimension":"structure|plot|design|logic","severity":"high|medium|low","feedback":"问题证据","fix":"具体修改建议","unit":"集号（arc/scenes 阶段必填，如 6）","field_path":"字段定位路径（scenes 如 scenes[0].beats[2].line；必须属于本集，不得跨集）","target_stage":"问题实际归属阶段（可选）","related_stage":"当前审核阶段（可选）","requires_creator_decision":false,"decision_options":["方案 A","方案 B"]}],"revision_closures":[{"issue_id":"brief-R01","status":"resolved|partial|unresolved","evidence":"修订核验依据","remaining_fix":"未完成时的具体修改","requires_creator_decision":false,"decision_options":["方案 A","方案 B"]}],"dimensions":{"structure":{"score":<0-100整数>,"feedback":"结构意见"},"plot":{"score":<0-100整数>,"feedback":"剧情意见"},"design":{"score":<0-100整数>,"feedback":"设计意见"},"logic":{"score":<0-100整数>,"feedback":"逻辑意见"}},"checks":{"cross_validation":true,"consistency":true,"adversarial":true,"structure":true,"mode":true,"continuity":true,"dialogue":true,"localization":true}}',
    "锚点示例（arc/scenes 阶段每条 issue 必须给出 unit + field_path）：",
    '正例：{"unit":6,"field_path":"scenes[0].beats[2].line"}；反例：无 unit、或 field_path 指向其他集（如 scenes[1] 属于第 7 集时指向它）——跨集锚点视为无效。',
    "分数必须是你的真实评估；0 分仅在内容确实完全不可用时使用。confidence 是你对本次判断的确定度（0-100）。",
  ].join("\n");
}

function reviewerIdentity(role) {
  return {
    structure_causality: "结构与因果审读席：核对阶段契约、因果链闭合、用户硬约束兑现、时间线与逻辑自洽，只提交 structure、logic 维度的证据。",
    character_continuity: "人物与连续性审读席：核对人物动机、关系演进、世界规则一致性、长剧连续性、姓名与语境本土化，只提交 plot 维度的证据。",
    audience_pacing_visual: "受众节奏与视觉审读席：核对首屏冲击、每集钩子、反转因果、对白口语化与人物声线，以及场景/镜头的可拍性，只提交 design 维度的证据。",
  }[text(role, 120)] || "独立审读席：基于证据提交结构化发现，系统裁判负责最终决定。";
}

function revisionUserPrompt({ stage, mode, input, previousArtifacts, project, baseArtifact, revisionContract, revisionPlan, unitScope = [], lockedContext = [], continuityContext = [] }) {
  const prior = stageContextPacket(previousArtifacts, { unitScope });
  return JSON.stringify({
    task: "基于已审核版本执行定向修订。只解决修订合同中的问题，保留没有问题的有效内容，不得重置故事方向、改变已确认上下文或用空泛改写回避问题。必须返回当前阶段的完整结构化产物，不能只返回修改片段；未修改的顶层字段必须原样保留。",
    project: { id: text(project?.id, 300), title: text(project?.title, 300), episode: text(project?.episode, 100) },
    mode,
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    creativeControls: normalizeCreativeControls(input),
    audience: normalizeAudience(input),
    market: normalizeMarket(input, mode),
    stageParticipation: normalizeStageOptions(input),
    currentStage: stage,
    ...(UNIT_STAGES.has(stage) ? {
      unitScope: normalizeUnitNumbers(unitScope, plannedUnitCount(input)),
      lockedUnitContext: lockedContext,
      continuityContext,
    } : {}),
    userRevisionDirection: text(revisionPlan, 14000),
    sourceArtifact: { id: baseArtifact.id, version: baseArtifact.version, content: baseArtifact.content },
    revisionContract,
    approvedContext: prior,
  }, null, 2).slice(0, 180000);
}

function reviewUserPrompt({ stage, mode, artifact, previousArtifacts, input, revisionContract = null, unitScope = [], lockedContext = [], continuityContext = [], ruleFindings = [] }) {
  const revisionItems = asArray(revisionContract?.items);
  return JSON.stringify({
    reviewProtocol: {
      type: "adversarial_cross_validation",
      instructions: revisionItems.length ? [
        "你是审读席，只提交结构化证据；不能自行决定通过、阻断或扩大修订范围。系统裁判会统一生成决定。",
        "本轮只核验修订合同与已知规则违规；合同外新发现只能作为建议记录，不能标记为 required_changes 或 high severity。",
        "逐条核对修订合同是否满足验收条件，不得重建或扩大本轮验收范围。",
        "除 knownRuleFindings 外，不得把合同外意见写入 required_changes。",
      ] : [
        "你是审读席，只提交结构化证据；不能自行决定通过、阻断或扩大修订范围。系统裁判会统一生成决定。",
        "独立重建验收标准",
        "逐字段核对当前产物与用户规格",
        "逐项核对已确认上下文的一致性",
        "主动寻找会导致后续失控的隐性缺陷",
      ],
    },
    stage,
    mode,
    audience: normalizeAudience(input),
    creativeControls: normalizeCreativeControls(input),
    market: normalizeMarket(input, mode),
    stageParticipation: normalizeStageOptions(input),
    ...(UNIT_STAGES.has(stage) ? {
      unitScope: normalizeUnitNumbers(unitScope, plannedUnitCount(input)),
      lockedUnitContext: lockedContext,
      continuityContext,
    } : {}),
    artifact,
    ...(ruleFindings.length ? { knownRuleFindings: { label: "已知违规，请重点核验", findings: ruleFindings } } : {}),
    approvedContext: stageContextPacket(previousArtifacts.slice(-6), { unitScope }),
    ...(revisionItems.length ? {
      revisionClosureProtocol: {
        sourceArtifactId: text(revisionContract.sourceArtifactId, 200),
        contractId: text(revisionContract.id, 200),
        instructions: [
          "逐条核验修订合同；不得只评价整体质量。",
          "每个合同编号都必须在 revision_closures 中出现。",
          "只有修改确实满足该条验收条件时才能标记 resolved；证据不足必须标记 partial 或 unresolved。",
        ],
        items: revisionItems,
      },
    } : {}),
  }, null, 2).slice(0, 180000);
}

function visualAssetSystemPrompt(mode, input = {}) {
  return [
    "你是 PixelTale 的视觉资产设计 Agent。根据已确认的全剧结构，整理供大模型解析与文生图使用的主要重复资产。",
    "只收在全剧中重复出现或明确需要保持连续性的主要人物、场景、道具，不收一次性背景和临时群众。",
    "输出严格 JSON，不要 Markdown、代码围栏或解释。字段值使用中文；name_en 可使用英文；prompt_zh 必须是可直接用于文生图的完整中文画面描述，不含剧情台词。",
    `当前模式：${modeLabel(mode)}。人物要锁定外观、服装、识别色与姿态；场景要锁定光线、色调、材质、空间布局与氛围；道具要锁定材质、形态、尺寸与特殊质感。`,
    audiencePrompt(input),
    marketPrompt(input, mode),
    '输出契约：{"characters":[{"id":"P01","name_zh":"中文名","name_en":"English name","type":"人物","aliases":"别名","gender":"性别","age_phase":"年龄相","body":"体型","hair_color":"发型发色","facial_features":"面部特征","eye_color":"瞳色","costume_accessories":"服装配饰","palette":"识别色","posture":"气质姿态","prompt_zh":"中文文生图提示词"}],"scenes":[{"id":"S01","name_zh":"场景名","name_en":"English name","type":"场景","aliases":"别名","indoor_outdoor":"室内外","lighting":"光线","palette":"色调","materials":"建筑材质","layout":"空间布局","atmosphere":"氛围气味","prompt_zh":"中文文生图提示词"}],"props":[{"id":"PR01","name_zh":"道具名","name_en":"English name","type":"道具","aliases":"别名","materials":"材质","appearance":"颜色形态","size":"尺寸","texture":"特殊质感","prompt_zh":"中文文生图提示词"}],"consistency_notes":["全剧统一视觉规则"]}',
  ].join("\n");
}

function visualAssetUserPrompt({ mode, input, approvedArtifacts, project }) {
  return JSON.stringify({
    task: "从已确认的全剧结构中提取并补全视觉资产设计，确保同一资产在不同单元中可复用且外观连续。",
    project,
    mode,
    audience: normalizeAudience(input),
    market: normalizeMarket(input, mode),
    approvedArtifacts: approvedArtifacts.map((item) => ({ stage: item.stage, content: item.content })),
  }, null, 2).slice(0, 240000);
}

function visualAssetReviewSystemPrompt(mode, input = {}) {
  return [
    "你是 PixelTale 的视觉资产复核 Agent。检查视觉资产文档数据，不要重写全文。",
    "输出严格 JSON，不要 Markdown、代码围栏或额外文字。",
    `当前模式：${modeLabel(mode)}。检查重复资产筛选、编号唯一性、字段完整性、人物与场景连续性、文生图提示词可执行性。`,
    audiencePrompt(input),
    marketPrompt(input, mode),
    '输出契约：{"pass":true,"score":<0-100整数>,"confidence":<0-100整数>,"findings":["具体发现"],"required_changes":["必须修正的问题"],"checks":{"cross_validation":true,"consistency":true,"adversarial":true,"recurrence":true,"identity":true,"prompt":true}}',
    "分数必须是你的真实评估；0 分仅在内容确实完全不可用时使用。confidence 是你对本次判断的确定度（0-100）。",
  ].join("\n");
}

function visualAssetReviewUserPrompt({ mode, input, visualAssets }) {
  return JSON.stringify({ mode, market: normalizeMarket(input, mode), visualAssets }, null, 2).slice(0, 200000);
}

function validateVisualAssets(value) {
  const output = asObject(value);
  const sections = ["characters", "scenes", "props"];
  for (const section of sections) {
    if (!Array.isArray(output[section])) {
      const error = new Error(`视觉资产产物缺少 ${section} 数组`);
      error.code = "SCHEMA_INVALID";
      throw error;
    }
  }
  const seen = new Set();
  for (const item of sections.flatMap((section) => output[section].map((entry) => ({ section, entry: asObject(entry) })))) {
    const assetId = text(item.entry.id, 80);
    const name = text(item.entry.name_zh, 200);
    const prompt = text(item.entry.prompt_zh, 5000);
    if (!assetId || !name || !prompt || seen.has(assetId)) {
      const error = new Error("视觉资产产物存在重复编号或缺少名称、提示词");
      error.code = "SCHEMA_INVALID";
      throw error;
    }
    seen.add(assetId);
  }
  return {
    characters: output.characters.map((item) => asObject(item)),
    scenes: output.scenes.map((item) => asObject(item)),
    props: output.props.map((item) => asObject(item)),
    consistency_notes: asArray(output.consistency_notes).map((item) => text(item, 1000)).filter(Boolean).slice(0, 30),
    source: "visual_asset_agent",
  };
}

function requiredContentFields(stage) {
  return {
    brief: ["title_zh", "logline_zh", "core_conflict_zh", "viewer_question_zh"],
    title: ["candidates"],
    proposal: ["title_zh", "premise_zh", "viewer_question_zh", "first_impact_zh", "episode_hook_zh"],
    characters: ["characters", "relationships", "world_rules"],
    arc: ["units", "arc_summary_zh"],
    scenes: ["scenes"],
    dialogue: ["lines", "localization_checks"],
  }[stage] || [];
}

function plannedUnitCount(input = {}) {
  const direct = Number(input.episodeCount);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const match = text(input.episodeScale, 100).match(/\d+/);
  const parsed = Number(match?.[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeUnitNumbers(value, total = 0) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,，、；;]+/u);
  return [...new Set(raw
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0 && (!total || item <= total)))]
    .sort((left, right) => left - right);
}

function unitNumberForStage(stage, item) {
  const value = asObject(item);
  return Number(stage === "scenes" ? value.unit_number : value.number);
}

function unitNumbersForContent(stage, content) {
  const items = stage === "scenes" ? asArray(asObject(content).scenes) : asArray(asObject(content).units);
  return [...new Set(items.map((item) => unitNumberForStage(stage, item)).filter((item) => Number.isInteger(item) && item > 0))].sort((left, right) => left - right);
}

function unitItemsForContent(stage, content, unitNumbers = []) {
  const scope = new Set(normalizeUnitNumbers(unitNumbers));
  const items = stage === "scenes" ? asArray(asObject(content).scenes) : asArray(asObject(content).units);
  return items.filter((item) => {
    const number = unitNumberForStage(stage, item);
    return !scope.size || scope.has(number);
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
  return value;
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function unitContinuityState(stage, itemOrItems) {
  if (stage === "scenes") {
    const scenes = asArray(itemOrItems);
    const last = asObject(scenes.at(-1));
    return {
      unitNumber: Number(last.unit_number) || 0,
      lastSceneId: text(last.id, 120),
      location: text(last.location_zh, 240),
      result: text(last.result_zh, 1200),
      turn: text(last.turn_zh, 1200),
      shotCount: scenes.reduce((count, scene) => count + asArray(asObject(scene).shot_plan).length, 0),
    };
  }
  const unit = asObject(itemOrItems);
  return {
    unitNumber: Number(unit.number) || 0,
    title: text(unit.title_zh, 240),
    causalTurn: text(unit.causal_turn_zh, 1200),
    reversal: text(unit.reversal_zh, 1200),
    hook: text(unit.hook_zh, 1200),
    cliffhanger: text(unit.cliffhanger_question_zh, 1200),
    payoff: text(unit.payoff_zh, 1200),
  };
}

function unitOpenThreads(stage, itemOrItems) {
  if (stage === "scenes") {
    const last = asObject(asArray(itemOrItems).at(-1));
    return [text(last.turn_zh, 800), text(last.result_zh, 800)].filter(Boolean).slice(-2);
  }
  const unit = asObject(itemOrItems);
  return [text(unit.cliffhanger_question_zh, 1000), text(unit.hook_zh, 1000)].filter(Boolean);
}

// ===== 集级锁状态机（2026-08-09 新增：open/locked/pinned/dirty）=====
// open（未生成/自由）→ locked（批次审核通过定稿）→ pinned（人工编辑过，绝对不可被自动流程覆盖）
// 依赖变更 → dirty（进复核清单，不自动改；pinned 不降级，仅记 dirtyReason 供复核参考）
function unitLockStatus(state, stage, unit) {
  const lock = asObject(state?.unitLocks?.[stage]?.[unit]);
  return lock.status === "locked" || lock.status === "pinned" || lock.status === "dirty" ? lock.status : "open";
}

function isUnitProtected(state, stage, unit) {
  const st = unitLockStatus(state, stage, unit);
  return st === "locked" || st === "pinned";
}

function markUnitPinned(state, stage, unit, by) {
  const locks = (state.unitLocks ??= {});
  locks[stage] ??= {};
  const prev = locks[stage][unit] || {};
  locks[stage][unit] = { ...prev, status: "pinned", pinnedBy: by, pinnedAt: new Date().toISOString() };
}

function markUnitDirty(state, stage, unit, reason) {
  const locks = (state.unitLocks ??= {});
  locks[stage] ??= {};
  const prev = locks[stage][unit] || {};
  if (prev.status === "pinned") {
    locks[stage][unit] = { ...prev, dirtyReason: reason, dirtyAt: new Date().toISOString() };
    return;
  }
  locks[stage][unit] = { ...prev, status: "dirty", dirtyReason: reason, dirtyAt: new Date().toISOString() };
}

function autoRepairableUnits(state, stage, pending) {
  return normalizeUnitNumbers(pending).filter((u) => unitLockStatus(state, stage, u) === "open");
}

// 上游阶段确认（重跑批准）→ 下游 unit 阶段已有 locked/pinned 的集标 dirty。
// 简单下游传播（不做全依赖图）：characters 之后是 arc/scenes；arc 之后是 scenes。
const DIRTY_DOWNSTREAM = { characters: ["arc", "scenes"], arc: ["scenes"] };
function propagateDirty(state, upstreamStage, reason) {
  const downstream = DIRTY_DOWNSTREAM[upstreamStage] || [];
  for (const stage of downstream) {
    for (const [unit, lock] of Object.entries(asObject(state?.unitLocks?.[stage]) || {})) {
      if (lock.status === "locked") markUnitDirty(state, stage, Number(unit), reason);
      else if (lock.status === "pinned") state.unitLocks[stage][unit].dirtyReason = reason;
    }
  }
}

function dirtyUnits(state, stage) {
  return Object.keys(asObject(state?.unitLocks?.[stage]) || {}).map(Number)
    .filter((u) => unitLockStatus(state, stage, u) === "dirty").sort((a, b) => a - b);
}

// 提取 issue 的集锚点；非法返回 null（单修时跳过 unfixable issue）
function extractUnitAnchor(issue) {
  const unit = Number(asObject(issue).unit);
  return Number.isInteger(unit) && unit > 0 ? unit : null;
}

function compactLockedUnit(stage, lock) {
  return {
    unitNumber: Number(lock.unitNumber),
    version: Number(lock.version || 0),
    contentHash: text(lock.contentHash, 80),
    startState: asObject(lock.startState),
    endState: asObject(lock.endState),
    openThreads: asArray(lock.openThreads).map((item) => text(item, 1000)).filter(Boolean),
    lockedAt: text(lock.lockedAt, 80),
  };
}

function lockedUnitNumbers(state, stage) {
  return Object.keys(asObject(state?.unitLocks?.[stage]))
    .map((number) => Number(number))
    .filter((number) => Number.isInteger(number) && number > 0 && asObject(state.unitLocks[stage][number]).status === "locked")
    .sort((left, right) => left - right);
}

function lockedUnitContext(state, stage, excludeNumbers = []) {
  const excluded = new Set(normalizeUnitNumbers(excludeNumbers));
  return lockedUnitNumbers(state, stage)
    .filter((number) => !excluded.has(number))
    .map((number) => compactLockedUnit(stage, state.unitLocks[stage][number]));
}

function splitUnitBatches(unitNumbers, batchSize = EPISODE_BATCH_SIZE) {
  const batches = [];
  for (let index = 0; index < unitNumbers.length; index += batchSize) batches.push(unitNumbers.slice(index, index + batchSize));
  return batches;
}

function normalizeUnitProgress(source = {}) {
  const progress = asObject(source);
  return {
    totalUnits: Number(progress.totalUnits) || 0,
    batchSize: Number(progress.batchSize) || EPISODE_BATCH_SIZE,
    lockedUnits: normalizeUnitNumbers(progress.lockedUnits),
    pendingUnits: normalizeUnitNumbers(progress.pendingUnits),
    currentBatch: normalizeUnitNumbers(progress.currentBatch),
    batches: asArray(progress.batches).map((batch) => ({
      id: text(batch?.id, 200),
      units: normalizeUnitNumbers(batch?.units),
      status: text(batch?.status, 40),
      artifactId: text(batch?.artifactId, 200),
      reviewId: text(batch?.reviewId, 200),
      error: text(batch?.error, 1600),
      startedAt: text(batch?.startedAt, 80),
      completedAt: text(batch?.completedAt, 80),
    })).filter((batch) => batch.id || batch.units.length),
    updatedAt: text(progress.updatedAt, 80),
  };
}

function unitStageContent(stage, content, unitNumbers) {
  const scope = new Set(normalizeUnitNumbers(unitNumbers));
  if (stage === "arc") return { ...asObject(content), units: unitItemsForContent(stage, content, [...scope]) };
  if (stage === "scenes") return { ...asObject(content), scenes: unitItemsForContent(stage, content, [...scope]) };
  return asObject(content);
}

function assertLockedUnitsUnchanged(stage, beforeContent, afterContent, state, excludedNumbers = []) {
  const excluded = new Set(normalizeUnitNumbers(excludedNumbers));
  for (const number of lockedUnitNumbers(state, stage)) {
    if (excluded.has(number)) continue;
    const before = unitItemsForContent(stage, beforeContent, [number]);
    const after = unitItemsForContent(stage, afterContent, [number]);
    if (contentHash(before) !== contentHash(after)) {
      const error = new Error(`第${number}集已锁定，不能被当前批次覆盖`);
      error.code = "UNIT_LOCK_VIOLATION";
      error.statusCode = 409;
      throw error;
    }
  }
}

function mergeStageBatchContent(stage, sourceContent, candidateContent, { unitNumbers = [], state = {}, allowLockedUnitRevision = false } = {}) {
  const source = asObject(sourceContent);
  const candidate = asObject(candidateContent);
  const requested = normalizeUnitNumbers(unitNumbers);
  const locked = new Set(lockedUnitNumbers(state, stage));
  const overlapping = requested.filter((number) => locked.has(number));
  if (overlapping.length && !allowLockedUnitRevision) {
    const error = new Error(`第${overlapping.join("、")}集已经锁定，不能被普通重试覆盖`);
    error.code = "UNIT_LOCKED";
    error.statusCode = 409;
    throw error;
  }
  const merged = { ...source, ...candidate };
  if (stage === "arc") {
    const sourceUnits = asArray(source.units);
    const candidateUnits = asArray(candidate.units);
    const target = new Set(requested.length ? requested : unitNumbersForContent(stage, candidate));
    const candidates = new Map(candidateUnits.map((item) => [unitNumberForStage(stage, item), item]));
    const units = sourceUnits.map((item) => {
      const number = unitNumberForStage(stage, item);
      return target.has(number) && candidates.has(number) ? candidates.get(number) : item;
    });
    const existing = new Set(units.map((item) => unitNumberForStage(stage, item)));
    candidateUnits.forEach((item) => {
      const number = unitNumberForStage(stage, item);
      if (Number.isInteger(number) && !existing.has(number)) units.push(item);
    });
    merged.units = units.sort((left, right) => unitNumberForStage(stage, left) - unitNumberForStage(stage, right));
  }
  if (stage === "scenes") {
    const sourceScenes = asArray(source.scenes);
    const candidateScenes = asArray(candidate.scenes);
    const target = new Set(requested.length ? requested : unitNumbersForContent(stage, candidate));
    const scenes = sourceScenes.filter((scene) => !target.has(unitNumberForStage(stage, scene)));
    const usedIds = new Set(scenes.map((scene) => text(scene?.id, 120)).filter(Boolean));
    candidateScenes.forEach((scene) => {
      const next = { ...asObject(scene) };
      const baseId = text(next.id, 120) || `S${String(next.unit_number).padStart(3, "0")}`;
      let sceneId = baseId;
      let suffix = 1;
      while (usedIds.has(sceneId)) sceneId = `${baseId}_E${Number(next.unit_number) || 0}_${suffix++}`;
      next.id = sceneId;
      usedIds.add(sceneId);
      scenes.push(next);
    });
    merged.scenes = scenes.sort((left, right) => unitNumberForStage(stage, left) - unitNumberForStage(stage, right) || text(left.id, 120).localeCompare(text(right.id, 120)));
  }
  assertLockedUnitsUnchanged(stage, source, merged, state, allowLockedUnitRevision ? overlapping : []);
  return merged;
}

function batchReviewSummary(stage, batchReviews, totalUnits, unitLocks) {
  const reviews = asArray(batchReviews);
  const hasBasePass = (review) => Object.hasOwn(asObject(review), "basePass")
    ? review.basePass === true
    : review?.pass === true;
  const average = (key, fallback = null) => {
    const values = reviews.map((review) => Number(review?.[key])).filter((value) => Number.isFinite(value));
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : fallback;
  };
  const dimensions = Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => {
    const scores = reviews.flatMap((review) => {
      const value = Number(review?.dimensions?.[dimension]?.average);
      return Number.isFinite(value) ? [value] : [];
    });
    const agreements = reviews.flatMap((review) => {
      const value = Number(review?.dimensions?.[dimension]?.agreement);
      return Number.isFinite(value) ? [value] : [];
    });
    return [dimension, {
      average: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
      agreement: agreements.length ? Math.round(agreements.reduce((sum, value) => sum + value, 0) / agreements.length) : null,
      scores: reviews.flatMap((review) => asArray(review?.dimensions?.[dimension]?.scores)),
    }];
  }));
  const lockedUnits = Object.keys(asObject(unitLocks)).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  const conflicts = reviews.flatMap((review) => asArray(review?.conflicts));
  const quorumMet = reviews.length > 0 && reviews.every((review) => review?.quorum?.met === true);
  // Only batches that actually produced a quorum record may lower these numbers.
  // Taking Math.min over every batch let a not-yet-run batch (no quorum → `|| 0`)
  // report the whole stage as 0/3 seats completed and flag it degraded, even when
  // every batch that had run was fully staffed with three distinct models.
  const measuredQuorums = reviews.map((review) => asObject(review?.quorum)).filter((quorum) => Number.isFinite(Number(quorum.completed)));
  const completedReviewSeats = measuredQuorums.length
    ? Math.min(REVIEW_COMPLETION_REQUIRED, ...measuredQuorums.map((quorum) => Math.max(0, Number(quorum.completed))))
    : 0;
  const measuredDistinctModels = measuredQuorums
    .map((quorum) => Number(quorum.distinctActualModels))
    .filter((value) => Number.isFinite(value));
  // A single batch whose seats collapsed onto one model is a real finding, but it
  // describes that batch, not the stage. Report it with the batch identified.
  const degradedBatches = reviews
    .map((review, index) => ({ index, quorum: asObject(review?.quorum) }))
    .filter((entry) => entry.quorum.degraded === true);
  const reviewCompletion = Math.round((completedReviewSeats / REVIEW_COMPLETION_REQUIRED) * 100);
  const basePass = reviews.length > 0
    && reviews.every(hasBasePass)
    && lockedUnits.length >= totalUnits;
  const mandatoryIssues = reviews.flatMap((review) => asArray(review?.mandatoryIssues));
  const decisionRequiredIssues = reviews.flatMap((review) => asArray(review?.decisionRequiredIssues));
  const retryRequiredIssues = reviews.flatMap((review) => asArray(review?.retryRequiredIssues));
  const retryUnits = normalizeUnitNumbers(reviews.filter((review) => !hasBasePass(review)).flatMap((review) => asArray(review?.units)), totalUnits);
  const decision = !quorumMet
    ? { kind: "rerun", owner: "系统裁判", title: "审核未完成", summary: "至少一个批次未完成双席审读。", items: [] }
    : decisionRequiredIssues.length
      ? { kind: "needs_decision", owner: "系统裁判", title: "需要创作者决定", summary: "至少一个批次存在无法由阶段契约自动取舍的创作选择。", items: decisionRequiredIssues }
      : retryRequiredIssues.length
        ? { kind: "retry_failed", owner: "系统裁判", title: "只重跑未通过批次", summary: `仅处理第${retryUnits.join("、")}集的未关闭项，已锁定集不会再次提交。`, items: retryRequiredIssues }
      : mandatoryIssues.length
        ? { kind: "revise", owner: "系统裁判", title: "定向修订", summary: "仅处理双席共同确认的高风险问题。", items: mandatoryIssues }
        : basePass
          ? { kind: "approve", owner: "系统裁判", title: "通过", summary: "全部批次已完成规则校验与双席审读。", items: [] }
          : { kind: "rerun", owner: "系统裁判", title: "尚未完成", summary: "仍有批次未完成，继续处理剩余集数。", items: [] };
  return {
    pass: decision.kind === "approve",
    basePass: decision.kind === "approve",
    score: average("score"),
    consensusIndex: average("consensusIndex"),
    agreement: average("agreement"),
    quality: average("quality"),
    reviewCompletion,
    quorum: {
      required: REVIEW_COMPLETION_REQUIRED,
      completedSeats: completedReviewSeats,
      completed: completedReviewSeats,
      passing: reviews.filter((review) => review?.pass).length,
      distinctActualModels: measuredDistinctModels.length ? Math.min(...measuredDistinctModels) : 0,
      met: quorumMet,
      degraded: degradedBatches.length > 0,
      degradedBatches: degradedBatches.map((entry) => entry.index + 1),
    },
    dimensions,
    feedbacks: reviews.flatMap((review) => asArray(review?.feedbacks)),
    ruleFindings: reviews.flatMap((review) => asArray(review?.ruleFindings)),
    reviewIssues: reviews.flatMap((review) => asArray(review?.reviewIssues)),
    issueCount: reviews.reduce((sum, review) => sum + Number(review?.issueCount || 0), 0),
    commonIssues: reviews.flatMap((review) => asArray(review?.commonIssues)),
    commonIssueCount: reviews.reduce((sum, review) => sum + Number(review?.commonIssueCount || 0), 0),
    mandatoryIssues,
    mandatoryIssueCount: mandatoryIssues.length,
    decisionRequiredIssues,
    retryRequiredIssues,
    retryUnits,
    automaticRevisionBlocked: decision.kind === "needs_decision",
    decision,
    recommendedIssues: reviews.flatMap((review) => asArray(review?.recommendedIssues)),
    recommendedIssueCount: reviews.reduce((sum, review) => sum + Number(review?.recommendedIssueCount || 0), 0),
    independentIssues: reviews.flatMap((review) => asArray(review?.independentIssues)),
    independentIssueCount: reviews.reduce((sum, review) => sum + Number(review?.independentIssueCount || 0), 0),
    conflicts,
    findings: uniqueText(reviews.flatMap((review) => asArray(review?.findings)), 60),
    technicalFailures: reviews.flatMap((review) => asArray(review?.technicalFailures)),
    required_changes: uniqueText(reviews.flatMap((review) => asArray(review?.required_changes)), 60),
    advisories: { independentIssues: reviews.flatMap((review) => asArray(review?.advisories?.independentIssues)), conflicts: reviews.flatMap((review) => asArray(review?.advisories?.conflicts)), failedReviews: reviews.flatMap((review) => asArray(review?.advisories?.failedReviews)) },
    checks: {
      cross_validation: quorumMet,
      consistency: reviews.every((review) => review?.checks?.consistency !== false),
      adversarial: reviews.every((review) => review?.checks?.adversarial === true),
      issues_converged: reviews.every((review) => review?.checks?.issues_converged !== false),
      dimensions_agree: conflicts.length === 0,
      revision_contract_closed: reviews.every((review) => review?.checks?.revision_contract_closed !== false),
    },
    batchCoverage: { stage, totalUnits, lockedUnits, batches: reviews.length },
    revision: null,
  };
}

function mergeRevisionList(sourceItems, candidateItems, key, mergeItem = (source, candidate) => ({ ...source, ...candidate })) {
  if (!Array.isArray(sourceItems)) return Array.isArray(candidateItems) ? candidateItems : [];
  if (!Array.isArray(candidateItems) || !candidateItems.length) return sourceItems;
  const candidates = new Map(candidateItems
    .map((item) => [text(item?.[key], 160), asObject(item)])
    .filter(([id]) => id));
  const merged = sourceItems.map((source) => {
    const candidate = candidates.get(text(source?.[key], 160));
    return candidate ? mergeItem(asObject(source), candidate) : source;
  });
  const sourceIds = new Set(sourceItems.map((item) => text(item?.[key], 160)).filter(Boolean));
  candidateItems.forEach((candidate) => {
    const id = text(candidate?.[key], 160);
    if (id && !sourceIds.has(id)) merged.push(candidate);
  });
  return merged;
}

function mergeSceneRevision(source, candidate) {
  const merged = {
    ...source,
    ...candidate,
    visual_profile: {
      ...asObject(source.visual_profile),
      ...asObject(candidate.visual_profile),
    },
  };
  merged.props = mergeRevisionList(source.props, candidate.props, "id");
  merged.shot_plan = mergeRevisionList(source.shot_plan, candidate.shot_plan, "shot_id");
  return merged;
}

function mergeRevisionContent(stage, content, sourceContent) {
  const candidate = asObject(content);
  const source = asObject(sourceContent);
  if (!Object.keys(source).length) return candidate;
  // A revision model may return only changed fields. Preserve the source artifact
  // for omitted top-level fields so a targeted fix cannot erase the stage contract.
  const merged = { ...source, ...candidate };
  if (stage === "arc") {
    merged.units = mergeRevisionList(source.units, candidate.units, "number");
  }
  if (stage === "scenes") {
    merged.scenes = mergeRevisionList(source.scenes, candidate.scenes, "id", mergeSceneRevision);
  }
  requiredContentFields(stage).forEach((key) => {
    const value = candidate[key];
    const missing = value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
    if (missing && source[key] !== undefined) merged[key] = source[key];
  });
  return merged;
}

function validateContent(stage, content, input = {}) {
  const value = asObject(content);
  const normalizedMode = normalizeMode(input.mode);
  const required = requiredContentFields(stage);
  const missing = required.filter((key) => value[key] === undefined || value[key] === null || (typeof value[key] === "string" && !value[key].trim()) || (Array.isArray(value[key]) && value[key].length === 0));
  if (missing.length) {
    const error = new Error(`${stage} 产物缺少必填字段：${missing.join(", ")}`);
    error.code = "SCHEMA_INVALID";
    throw error;
  }
  if (stage === "title") {
    const candidates = asArray(value.candidates).map((candidate) => asObject(candidate));
    if (normalizedMode === "cn_short_drama") {
      const cnNames = candidates.map((candidate) => text(candidate.title_en, 200)).filter(Boolean);
      const cnGenes = candidates.map((candidate) => text(candidate.naming_gene_zh, 300).toLowerCase()).filter(Boolean);
      const excludedTitles = new Set(asArray(input.excludedTitles).map((name) => text(name, 200).toLowerCase()).filter(Boolean));
      const invalidCnTitle = cnNames.some((name) => {
        const hanCount = (name.match(/[\u3400-\u9fff]/gu) || []).length;
        const actionCount = (name.match(/听懂|逆转|拯救|唤醒|怀疑|追查|揭开|成为|觉醒|复仇|重生|闪婚|离婚|结婚|爱上|逃离|回到|压城|救/g) || []).length;
        const isNarrativeSentence = /[我你他她它]/u.test(name) || /之后|以后|却|为了|为何/u.test(name) || actionCount >= 2;
        return !hanCount
          || hanCount < 3
          || hanCount > 10
          || !/^[\u3400-\u9fff]+$/u.test(name)
          || isNarrativeSentence
          || excludedTitles.has(name.toLowerCase());
      });
      const invalidCn = candidates.length !== 4
        || cnNames.length !== 4
        || new Set(cnNames).size !== 4
        || cnGenes.length !== 4
        || new Set(cnGenes).size !== 4
        || invalidCnTitle
        || candidates.some((candidate) => !/[\u3400-\u9fff]/u.test(text(candidate.explanation_zh, 500)) || !text(candidate.style_zh, 200) || !text(candidate.tone_zh, 300) || !text(candidate.naming_gene_zh, 300) || !text(candidate.reason_zh, 1000));
      if (invalidCn) {
        const error = new Error("国内短剧剧名产物必须包含 4 个不重复、3-10 个中文字、非剧情摘要句且说明完整的候选");
        error.code = "SCHEMA_INVALID";
        throw error;
      }
      return {
        ...value,
        candidates: candidates.map((candidate) => ({
          title_en: text(candidate.title_en, 200),
          explanation_zh: text(candidate.explanation_zh, 500),
          style_zh: text(candidate.style_zh, 200),
          tone_zh: text(candidate.tone_zh, 300),
          naming_gene_zh: text(candidate.naming_gene_zh, 300),
          reason_zh: text(candidate.reason_zh, 1000),
        })),
        selection_note_zh: text(value.selection_note_zh, 1000),
      };
    }
    const names = candidates.map((candidate) => text(candidate.title_en, 200)).filter(Boolean);
    const normalizedNames = names.map((name) => name.toLowerCase());
    const namingGenes = candidates.map((candidate) => text(candidate.naming_gene_zh, 300).toLowerCase()).filter(Boolean);
    const excludedTitles = new Set(asArray(input.excludedTitles).map((name) => text(name, 200).toLowerCase()).filter(Boolean));
    const maxWords = normalizeMode(input.mode) === "long_form_drama" ? 7 : 5;
    const invalidReleaseTitle = names.some((name) => {
      const words = name.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || [];
      return /[\u3400-\u9fff]/u.test(name)
        || !/[A-Za-z]/.test(name)
        || words.length < 1
        || words.length > maxWords
        || name.includes(":")
        || RESERVED_TITLE_REFERENCES.has(name.toLowerCase())
        || excludedTitles.has(name.toLowerCase())
        || /\b(billionaire|ceo|mafia|reborn|revenge|forbidden love|secret love|contract wife|fake marriage)\b/i.test(name);
    });
    const invalid = candidates.length !== 4
      || names.length !== 4
      || new Set(normalizedNames).size !== 4
      || namingGenes.length !== 4
      || new Set(namingGenes).size !== 4
      || invalidReleaseTitle
      || candidates.some((candidate) => !/[\u3400-\u9fff]/u.test(text(candidate.explanation_zh, 500)) || !text(candidate.style_zh, 200) || !text(candidate.tone_zh, 300) || !text(candidate.naming_gene_zh, 300) || !text(candidate.reason_zh, 1000));
    if (invalid) {
      const error = new Error(`剧名产物必须包含 4 个不重复、符合发行语言且说明完整的英文候选（每个不超过 ${maxWords} 个单词）`);
      error.code = "SCHEMA_INVALID";
      throw error;
    }
    return {
      ...value,
      candidates: candidates.map((candidate) => ({
        title_en: text(candidate.title_en, 200),
        explanation_zh: text(candidate.explanation_zh, 500),
        style_zh: text(candidate.style_zh, 200),
        tone_zh: text(candidate.tone_zh, 300),
        naming_gene_zh: text(candidate.naming_gene_zh, 300),
        reason_zh: text(candidate.reason_zh, 1000),
      })),
      selection_note_zh: text(value.selection_note_zh, 1000),
    };
  }
  if (stage === "dialogue") {
    const invalid = value.lines.some((line) => {
      const dialogue = text(line?.dialogue_en, 1000);
      const chineseModeInvalid = normalizedMode === "cn_short_drama" && (!/[\u3400-\u9fff]/u.test(dialogue) || /[A-Za-z]/u.test(dialogue));
      return !text(line?.speaker, 120) || !dialogue || !text(line?.intent_zh, 1000) || chineseModeInvalid;
    });
    if (invalid) {
      const error = new Error(normalizedMode === "cn_short_drama" ? "国内短剧对白必须包含 speaker、intent_zh 和纯中文 dialogue_en" : "对白产物必须同时包含 speaker、intent_zh 和 dialogue_en");
      error.code = "SCHEMA_INVALID";
      throw error;
    }
  }
  if (stage === "arc") {
    const units = asArray(value.units);
    const expectedCount = plannedUnitCount(input);
    const requestedUnits = normalizeUnitNumbers(input.unitScope || input.unitNumbers, expectedCount);
    const expectedUnits = requestedUnits.length ? requestedUnits : [...Array(expectedCount || 0)].map((_, index) => index + 1);
    const actualUnits = units.map((unit) => Number(asObject(unit).number));
    const locked = normalizeUnitNumbers(input.lockedUnitNumbers, expectedCount);
    const lockedOverlap = actualUnits.filter((number) => locked.includes(number));
    const invalidUnit = units.find((unit, index) => {
      const item = asObject(unit);
      return !expectedUnits.includes(Number(item.number))
        || !text(item.title_zh, 300)
        || !text(item.plot_zh, 8000)
        || !text(item.impact_zh, 2000)
        || !text(item.hook_zh, 2000)
        || !text(item.cliffhanger_question_zh, 2000);
    });
    if (!expectedCount || units.length !== expectedUnits.length || new Set(actualUnits).size !== actualUnits.length || expectedUnits.some((number) => !actualUnits.includes(number)) || lockedOverlap.length && input.allowLockedUnitRevision !== true || invalidUnit) {
      const error = new Error(lockedOverlap.length && input.allowLockedUnitRevision !== true
        ? `分集与章节包含已锁定的第${[...new Set(lockedOverlap)].join("、")}集，不能重复提交`
        : `分集与章节必须只返回当前批次的第${expectedUnits.join("、")}集完整剧情，不能漏集或返回结构摘要`);
      error.code = "SCHEMA_INVALID";
      throw error;
    }
  }
  if (stage === "scenes") {
    const scenes = asArray(value.scenes);
    const expectedCount = plannedUnitCount(input);
    const requestedUnits = normalizeUnitNumbers(input.unitScope || input.unitNumbers, expectedCount);
    const expectedUnits = requestedUnits.length ? requestedUnits : [...Array(expectedCount || 0)].map((_, index) => index + 1);
    const coveredUnits = new Set(scenes.map((scene) => Number(asObject(scene).unit_number)).filter((number) => Number.isInteger(number)));
    const locked = new Set(normalizeUnitNumbers(input.lockedUnitNumbers, expectedCount));
    const lockedOverlap = [...coveredUnits].filter((number) => locked.has(number));
    const invalidScene = scenes.find((scene) => {
      const item = asObject(scene);
      return !text(item.id, 120)
        || !text(item.time_zh, 120)
        || !text(item.location_zh, 300)
        || !text(item.action_zh, 5000)
        || !text(item.conflict_zh, 2000)
        || !text(item.choice_zh, 2000)
        || !text(item.result_zh, 2000)
        || !text(item.turn_zh, 2000);
    });
    if (!expectedCount || scenes.length < expectedUnits.length || expectedUnits.some((number) => !coveredUnits.has(number)) || lockedOverlap.length && input.allowLockedUnitRevision !== true || invalidScene) {
      const error = new Error(lockedOverlap.length && input.allowLockedUnitRevision !== true
        ? `场景与镜头包含已锁定的第${lockedOverlap.join("、")}集，不能重复提交`
        : `场景与镜头必须只覆盖当前批次的第${expectedUnits.join("、")}集，不能漏集或只生成少量代表场景`);
      error.code = "SCHEMA_INVALID";
      throw error;
    }
  }
  return value;
}

function validateReview(value, { requireDimensions = false, revisionContract = null } = {}) {
  const root = asObject(value);
  const review = typeof root.pass === "boolean"
    ? root
    : [root.review, root.result, root.evaluation, root.data].map(asObject).find((item) => typeof item.pass === "boolean") || root;
  if (typeof review.pass !== "boolean" || !Number.isFinite(Number(review.score)) || !Array.isArray(review.findings) || !Array.isArray(review.required_changes)) {
    const error = new Error("复核产物缺少 pass、score、findings 或 required_changes");
    error.code = "SCHEMA_INVALID";
    throw error;
  }
  const checks = asObject(review.checks);
  const hardChecks = ["cross_validation", "consistency", "adversarial"];
  const missingHardChecks = hardChecks.filter((key) => checks[key] !== true);
  const rawDimensions = asObject(review.dimensions);
  const dimensions = Object.fromEntries(REVIEW_DIMENSIONS.map((key) => {
    const item = asObject(rawDimensions[key]);
    const rawScore = Number(rawDimensions[key]?.score ?? rawDimensions[key]);
    return [key, {
      score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null,
      feedback: text(item.feedback || rawDimensions[key], 1200),
    }];
  }));
  const issues = asArray(review.issues).map((item) => {
    const entry = asObject(item);
    const dimension = REVIEW_DIMENSIONS.includes(entry.dimension) ? entry.dimension : "logic";
    const unit = entry.unit === undefined || entry.unit === null ? null : Number(entry.unit);
    const fieldPath = text(entry.field_path || entry.fieldPath, 300);
    return {
      criterionId: text(entry.criterion_id || entry.criterionId, 120).toUpperCase(),
      tag: text(entry.tag, 120),
      dimension,
      severity: ["high", "medium", "low"].includes(entry.severity) ? entry.severity : "medium",
      feedback: text(entry.feedback, 1200),
      fix: text(entry.fix || entry.suggestion, 1200),
      unit: Number.isInteger(unit) && unit > 0 ? unit : null,
      fieldPath,
      targetStage: text(entry.target_stage || entry.targetStage, 80),
      relatedStage: text(entry.related_stage || entry.relatedStage, 80),
      requiresCreatorDecision: entry.requires_creator_decision === true || entry.requiresCreatorDecision === true,
      decisionOptions: asArray(entry.decision_options || entry.decisionOptions).map((option) => text(option, 400)).filter(Boolean).slice(0, 2),
      unfixable: !(Number.isInteger(unit) && unit > 0 && fieldPath),
    };
  }).filter((item) => item.tag && item.feedback).slice(0, 3);
  const missingDimensions = requireDimensions ? REVIEW_DIMENSIONS.filter((key) => !Number.isFinite(Number(rawDimensions[key]?.score ?? rawDimensions[key]))) : [];
  const requiredChanges = review.required_changes.map((item) => text(item, 1000)).filter(Boolean).slice(0, 6);
  const contractItems = asArray(revisionContract?.items);
  const revisionClosures = asArray(review.revision_closures).map((item) => {
    const entry = asObject(item);
    return {
      issueId: text(entry.issue_id || entry.issueId, 160),
      status: ["resolved", "partial", "unresolved"].includes(text(entry.status, 40).toLowerCase())
        ? text(entry.status, 40).toLowerCase()
        : "unresolved",
      evidence: text(entry.evidence, 1200),
      remainingFix: text(entry.remaining_fix || entry.remainingFix, 1200),
      requiresCreatorDecision: entry.requires_creator_decision === true || entry.requiresCreatorDecision === true,
      decisionOptions: asArray(entry.decision_options || entry.decisionOptions).map((option) => text(option, 400)).filter(Boolean).slice(0, 2),
    };
  }).filter((item) => item.issueId);
  const missingClosures = contractItems.filter((item) => !revisionClosures.some((closure) => closure.issueId === item.id));
  if (review.pass && missingHardChecks.length) {
    requiredChanges.unshift(`交叉审核硬门槛未满足：${missingHardChecks.join("、")}`);
  }
  if (review.pass && missingDimensions.length) {
    requiredChanges.unshift(`一致性维度未完成：${missingDimensions.join("、")}`);
  }
  if (contractItems.length && missingClosures.length) {
    requiredChanges.unshift(`修订关闭证明缺失：${missingClosures.map((item) => item.id).join("、")}`);
  }
  return {
    pass: review.pass && missingHardChecks.length === 0 && missingDimensions.length === 0 && missingClosures.length === 0,
    score: Math.max(0, Math.min(100, Number(review.score))),
    confidence: Number.isFinite(Number(review.confidence)) ? Math.max(0, Math.min(100, Number(review.confidence))) : null,
    findings: review.findings.map((item) => text(item, 1000)).filter(Boolean).slice(0, 6),
    required_changes: requiredChanges,
    checks,
    dimensions,
    issues,
    revisionClosures,
  };
}

function providerForRoute(route) {
  const raw = text(route, 100).toLowerCase();
  if (raw.startsWith("gpt-")) return "chatgpt";
  if (raw.startsWith("claude-")) return "claude";
  if (raw.startsWith("deepseek-")) return "deepseek";
  if (raw.startsWith("grok-")) return "grok";
  return "superpixel";
}

function pairwiseAgreement(scores) {
  if (scores.length < 2) return null;
  let total = 0;
  let pairs = 0;
  for (let index = 0; index < scores.length; index += 1) {
    for (let next = index + 1; next < scores.length; next += 1) {
      total += Math.abs(scores[index] - scores[next]);
      pairs += 1;
    }
  }
  return Math.max(0, Math.min(100, Math.round(100 - total / pairs)));
}

function uniqueText(items, max = 20) {
  return [...new Set(items.map((item) => text(item, 1200)).filter(Boolean))].slice(0, max);
}

function issueKey(tag) {
  return text(tag, 120).toLowerCase().replace(/[\s：:，,。.!?！？；;]/g, "");
}

function advisoryItemId(kind, item = {}, index = 0) {
  const source = item.id || item.criterionId || item.criterion_id || item.tag || item.dimension || item.model || index;
  return `advisory_${kind}_${issueKey(source) || index}`;
}

function reviewAdvisoryItems(review = {}) {
  const makeUniqueIds = (items, kind) => {
    const seen = new Map();
    return items.map((item, index) => {
      const baseId = text(item?.id, 160) || advisoryItemId(kind, item, index);
      const occurrence = seen.get(baseId) || 0;
      seen.set(baseId, occurrence + 1);
      return { ...item, id: occurrence ? `${baseId}_${occurrence + 1}` : baseId };
    });
  };
  const independentIssues = makeUniqueIds(asArray(review.independentIssues).map((item, index) => ({
    ...asObject(item),
    kind: "issue",
    severity: ["high", "medium", "low"].includes(item?.severity) ? item.severity : "medium",
    suggestions: asArray(item?.suggestions).filter(Boolean),
    evidence: asArray(item?.evidence).filter(Boolean),
  })), "issue");
  const conflicts = makeUniqueIds(asArray(review.conflicts).map((item, index) => ({
    ...asObject(item),
    kind: "conflict",
    severity: "medium",
    suggestions: item?.suggestion ? [text(item.suggestion, 1200)] : [],
    evidence: asArray(item?.scores).length ? [`模型评分：${item.scores.join(" / ")}`] : [],
  })), "conflict");
  const failedReviews = makeUniqueIds(asArray(review.advisories?.failedReviews).map((item, index) => ({
    ...asObject(item),
    kind: "failed",
    severity: "low",
    suggestions: [],
    evidence: [text(item?.message, 1200) || "审核模型未返回审核意见"],
  })), "failed");
  return [...independentIssues, ...conflicts, ...failedReviews];
}

function advisoryDecisionMap(review = {}) {
  return new Map(asArray(review.advisoryDecisions)
    .filter((item) => item?.id && ["accepted", "ignored", "needs_human_review"].includes(item.status))
    .map((item) => [item.id, item]));
}

function reviewAdvisoryGate(review = {}) {
  const items = reviewAdvisoryItems(review);
  const decisions = advisoryDecisionMap(review);
  const accepted = items.filter((item) => decisions.get(item.id)?.status === "accepted");
  const blockingPending = items.filter((item) => {
    const decision = decisions.get(item.id);
    // Conflicts get no special case. An undecided score disagreement is resolved
    // automatically (adjudications[].mode === "automatic") and must not gate the
    // stage; it only blocks when the creator explicitly asks to review it.
    // The same rule is duplicated in public/pixeltale/app.js — keep both in sync.
    return decision?.status === "needs_human_review";
  });
  return { items, decisions, accepted, blockingPending };
}

const issueSeverityRank = { high: 0, medium: 1, low: 2 };

function groupedReviewIssues(feedbacks) {
  const groups = new Map();
  feedbacks.forEach((feedback) => {
    const seen = new Set();
    asArray(feedback.issues).forEach((issue) => {
      const key = issueKey(issue.criterionId) || issueKey(issue.tag) || issueKey(`${issue.dimension}:${issue.feedback}`);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const group = groups.get(key) || {
        criterionId: issue.criterionId,
        tag: issue.tag || `${issue.dimension} 维度问题`,
        dimension: issue.dimension,
        severity: issue.severity,
        models: new Map(),
        suggestions: [],
        evidence: [],
        decisionVotes: new Map(),
        targetStages: new Set(),
        relatedStages: new Set(),
      };
      group.models.set(feedback.actualModel || feedback.model, feedback);
      if ((issueSeverityRank[issue.severity] ?? 1) < (issueSeverityRank[group.severity] ?? 1)) group.severity = issue.severity;
      if (issue.fix) group.suggestions.push(issue.fix);
      if (issue.feedback) group.evidence.push(`${feedback.model}：${issue.feedback}`);
      if (issue.requiresCreatorDecision === true && asArray(issue.decisionOptions).length >= 2) {
        group.decisionVotes.set(feedback.actualModel || feedback.model, asArray(issue.decisionOptions).slice(0, 2));
      }
      if (issue.targetStage) group.targetStages.add(issue.targetStage);
      if (issue.relatedStage) group.relatedStages.add(issue.relatedStage);
      groups.set(key, group);
    });
  });
  return [...groups.values()].map((group) => ({
      id: `issue_${issueKey(group.criterionId) || issueKey(group.tag)}`,
      criterionId: group.criterionId,
      tag: group.tag,
      dimension: group.dimension,
      severity: group.severity,
      modelCount: group.models.size,
      models: [...group.models.keys()],
      ownerHighConfidence: [...group.models.values()].some((feedback) => feedback.ownedDimensions?.includes(group.dimension)
        && asArray(feedback.issues).some((issue) => issue.dimension === group.dimension && issue.severity === "high")
        && Number(feedback.confidence) >= 80),
      suggestions: uniqueText(group.suggestions, 5),
      evidence: uniqueText(group.evidence, 5),
      requiresCreatorDecision: group.decisionVotes.size >= 2,
      decisionOptions: uniqueText([...group.decisionVotes.values()].flat(), 2),
      targetStage: [...group.targetStages][0] || "",
      targetStages: [...group.targetStages],
      relatedStage: [...group.relatedStages][0] || "",
    }))
    .sort((left, right) => (issueSeverityRank[left.severity] ?? 1) - (issueSeverityRank[right.severity] ?? 1) || right.modelCount - left.modelCount || left.tag.localeCompare(right.tag, "zh-CN"));
}

function sharedReviewIssues(feedbacks) {
  return groupedReviewIssues(feedbacks).filter((group) => group.modelCount >= 2);
}

function revisionIssueKeys(stage, item = {}) {
  const dimension = text(item.dimension, 40) || "logic";
  const criterionId = text(item.criterionId || item.criterion_id, 160);
  const tag = text(item.tag, 160);
  return [...new Set([
    criterionId ? `${stage}:criterion:${issueKey(criterionId)}` : "",
    tag ? `${stage}:tag:${issueKey(`${dimension}:${tag}`)}` : "",
  ].filter(Boolean))];
}

function revisionIssueId(stage, item = {}) {
  const seed = text(item.criterionId || item.criterion_id, 160) || `${text(item.dimension, 40) || "logic"}-${text(item.tag, 160) || "issue"}`;
  return `${stage}-R-${issueKey(seed)}`.slice(0, 180);
}

function stageReviewPolicy(stage, { revisionContract = null } = {}) {
  const needsDualConfirmation = UNIT_STAGES.has(stage) || !!revisionContract;
  return needsDualConfirmation || !FAST_REVIEW_STAGES.has(stage)
    ? { mode: "dual", requiredSeats: REVIEW_QUORUM, issueSupport: REVIEW_QUORUM }
    : { mode: "fast", requiredSeats: 1, issueSupport: 1 };
}

// 高风险问题需要达到当前阶段的独立证据门槛。首稿快速审读以一席为门槛；
// 分集、场景和定向修订保持两席共同确认。
function isMandatoryReviewIssue(issue, requiredSupport = REVIEW_QUORUM) {
  return issue?.severity === "high" && Number(issue.modelCount) >= requiredSupport;
}

function buildRevisionContract(review = {}, { stage, sourceArtifactId, id: contractId }) {
  const requiredSupport = Math.max(1, Math.min(REVIEW_QUORUM, Number(review?.reviewPolicy?.issueSupport) || REVIEW_QUORUM));
  const acceptedAdvisories = reviewAdvisoryItems(review)
    .filter((item) => item.kind !== "failed" && advisoryDecisionMap(review).get(item.id)?.status === "accepted")
    .map((item) => {
      const decision = advisoryDecisionMap(review).get(item.id);
      return {
        criterionId: `ADVISORY_${issueKey(item.id).toUpperCase()}`,
        tag: item.tag || `${item.dimension || "logic"} 建议已采纳`,
        dimension: item.dimension || "logic",
        severity: item.severity || "medium",
        modelCount: Number(item.modelCount) || 1,
        models: asArray(item.models),
        suggestions: uniqueText([...(asArray(item.suggestions)), text(decision?.reason, 1200)], 5),
        evidence: uniqueText(asArray(item.evidence), 5),
      };
    });
  // Prefer the aggregator's authoritative list — the frontend reads the same field,
  // so both agree on what "must fix" means. Older review artifacts predate that
  // field and carry only reviewIssues/commonIssues, so fall back through both using
  // the shared predicate rather than a second, divergent filter.
  const candidateMandatory = asArray(review.mandatoryIssues).length
    ? asArray(review.mandatoryIssues)
    : [...asArray(review.reviewIssues), ...asArray(review.commonIssues)];
  const freshMandatory = candidateMandatory
    .filter((issue) => isMandatoryReviewIssue(issue, requiredSupport))
    .filter((item, index, all) => all.findIndex((candidate) => revisionIssueId(stage, candidate) === revisionIssueId(stage, item)) === index);
  const freshIssues = [...freshMandatory, ...acceptedAdvisories];
  const previousItems = asArray(review.revision?.contract?.items);
  const previousClosures = new Map(asArray(review.revision?.closure?.items).map((item) => [item.id, item]));
  const previousByKey = new Map();
  previousItems.forEach((item) => revisionIssueKeys(stage, item).forEach((key) => {
    if (!previousByKey.has(key)) previousByKey.set(key, item);
  }));
  const findPrevious = (issue) => revisionIssueKeys(stage, issue).map((key) => previousByKey.get(key)).find(Boolean);
  const issues = [];
  freshIssues.forEach((issue) => {
    const previous = findPrevious(issue);
    const closure = previous ? previousClosures.get(previous.id) : null;
    issues.push({
      id: previous?.id || revisionIssueId(stage, issue),
      criterionId: issue.criterionId || issue.criterion_id || previous?.criterionId,
      tag: issue.tag || previous?.tag,
      dimension: issue.dimension || previous?.dimension,
      severity: issue.severity || previous?.severity,
      modelCount: Number(issue.modelCount) || Number(previous?.modelCount) || 0,
      models: [...new Set([...(asArray(previous?.models)), ...(asArray(issue.models))].filter(Boolean))],
      targetStage: issue.targetStage || previous?.targetStage || "",
      targetStages: [...new Set([...(asArray(previous?.targetStages)), ...(asArray(issue.targetStages)), ...(issue.targetStage ? [issue.targetStage] : [])].filter(Boolean))],
      relatedStage: issue.relatedStage || previous?.relatedStage || "",
      requiresCreatorDecision: issue.requiresCreatorDecision === true || previous?.requiresCreatorDecision === true,
      decisionOptions: uniqueText([...(asArray(previous?.decisionOptions)), ...(asArray(issue.decisionOptions))], 2),
      requiredEdit: uniqueText([...(asArray(previous?.requiredEdit)), ...(asArray(issue.suggestions)), ...(asArray(closure?.remainingFix))], 4),
      evidence: uniqueText([...(asArray(previous?.evidence)), ...(asArray(issue.evidence)), ...(asArray(closure?.remainingFix))], 4),
    });
  });
  return {
    id: text(contractId, 200),
    stage,
    sourceArtifactId: text(sourceArtifactId, 200),
    items: issues.slice(0, 24).map((issue) => ({
      id: text(issue.id, 180) || revisionIssueId(stage, issue),
      tag: text(issue.tag || "审核修订项", 160),
      dimension: REVIEW_DIMENSIONS.includes(issue.dimension) ? issue.dimension : "logic",
      severity: ["high", "medium", "low"].includes(issue.severity) ? issue.severity : "medium",
      modelCount: Math.max(0, Number(issue.modelCount) || 0),
      evidence: uniqueText(asArray(issue.evidence), 4),
      requiredEdit: uniqueText(asArray(issue.requiredEdit || issue.suggestions), 4),
      targetStage: text(issue.targetStage, 80),
      targetStages: asArray(issue.targetStages).map((stage) => text(stage, 80)).filter(Boolean),
      relatedStage: text(issue.relatedStage, 80),
      requiresCreatorDecision: issue.requiresCreatorDecision === true,
      decisionOptions: uniqueText(asArray(issue.decisionOptions), 2),
      acceptance: `修订版本必须消除“${text(issue.tag || "审核修订项", 160)}”的证据，并与用户规格和已确认上下文保持一致。`,
    })),
  };
}

function automaticUnitRepairPlan(stage, review, unitNumbers = []) {
  const commonIssues = asArray(review?.commonIssues)
    .filter((item) => Number(item?.modelCount) >= REVIEW_QUORUM && item?.severity === "high" && item?.code !== "DURATION_BUDGET_MISMATCH");
  const durationIssues = asArray(review?.ruleFindings)
    .filter((item) => item?.code === "DURATION_BUDGET_MISMATCH")
    .map((item) => {
      const values = text(item.message, 1200).match(/目标\s*([0-9]+(?:\.[0-9]+)?)\s*秒，实际\s*([0-9]+(?:\.[0-9]+)?)\s*秒/u);
      const target = Number(values?.[1]);
      const actual = Number(values?.[2]);
      if (!Number.isFinite(target) || !Number.isFinite(actual)) return "";
      const difference = target - actual;
      const unit = text(item.fieldPath, 300).match(/unit_(\d+)/u)?.[1]
        || text(item.message, 1200).match(/第\s*(\d+)\s*集/u)?.[1]
        || "当前";
      return `第 ${unit} 集：当前镜头总时长 ${formatDurationSeconds(actual)} 秒，目标 ${formatDurationSeconds(target)} 秒，差值 ${formatDurationSeconds(Math.abs(difference))} 秒，需${difference >= 0 ? "增加" : "减少"} ${formatDurationSeconds(Math.abs(difference))} 秒。`;
    })
    .filter(Boolean);
  if (!commonIssues.length && !durationIssues.length) return "";
  const scope = normalizeUnitNumbers(unitNumbers).map((number) => `第${number}集`).join("、");
  return [
    `这是${stage === "scenes" ? "场景与镜头" : "分集与章节"}的集级自动恢复修订。只修改${scope || "当前未锁定批次"}，一次性解决下列必须修正的问题。`,
    "保持已锁定集、未涉及的内容、整体故事基因和上下文不变；修订后必须返回完整目标集结构，而不是审核说明。",
    ...durationIssues,
    ...commonIssues.map((issue, index) => {
      const evidence = asArray(issue.evidence).filter(Boolean).join("；");
      const fixes = asArray(issue.suggestions).filter(Boolean).join("；") || "补足可验证的因果、冲突和结果";
      return `${durationIssues.length + index + 1}. ${text(issue.tag || "集级结构问题", 160)}：${fixes}${evidence ? `；证据：${evidence}` : ""}`;
    }),
  ].join("\n");
}

function isRetryableReviewFailure(review = {}) {
  return asArray(review?.technicalFailures).some((item) => ["failed", "degraded", "stalled", "budget_exhausted"].includes(text(item?.status, 80)));
}

function revisionIssueSignatures(review = {}) {
  const source = asObject(review);
  return new Set(asArray(source.mandatoryIssues).map((issue) => `${text(issue.id || issue.criterionId || issue.tag, 180)}:${text(issue.fieldPath, 300)}`));
}

function tokenUsage(result) {
  return Number(result?.usage?.total_tokens || result?.usage?.totalTokens || result?.total_tokens || 0);
}

function stalledRevision(previousReview, currentReview) {
  const previous = revisionIssueSignatures(previousReview);
  const current = revisionIssueSignatures(currentReview);
  if (!previous.size || !current.size) return false;
  const overlap = [...current].filter((key) => previous.has(key)).length / Math.max(previous.size, current.size);
  return overlap >= 0.8;
}

function aggregateRevisionClosure(feedbacks = [], revisionContract = null, requiredSeats = REVIEW_QUORUM) {
  const items = asArray(revisionContract?.items);
  if (!items.length) return { required: false, allResolved: true, items: [] };
  const closureItems = items.map((item) => {
    const responses = feedbacks.map((feedback) => {
      const closure = asArray(feedback.revisionClosures).find((entry) => entry.issueId === item.id);
      return closure || { status: "unresolved", evidence: "该审核模型未提供该修订项的关闭证明", remainingFix: "补充逐项复审结论", requiresCreatorDecision: false, decisionOptions: [] };
    });
    const counts = Object.fromEntries(["resolved", "partial", "unresolved"].map((status) => [status, responses.filter((entry) => entry.status === status).length]));
    const resolved = counts.resolved >= requiredSeats;
    return {
      ...item,
      status: resolved ? "resolved" : counts.resolved ? "partial" : "unresolved",
      resolvedBy: counts.resolved,
      responses: responses.map((entry) => ({ status: entry.status, evidence: entry.evidence, remainingFix: entry.remainingFix })),
      remainingFix: uniqueText(responses.filter((entry) => entry.status !== "resolved").map((entry) => entry.remainingFix || entry.evidence), 4),
      requiresCreatorDecision: !resolved && responses.length >= requiredSeats && responses.every((entry) => entry.requiresCreatorDecision === true && asArray(entry.decisionOptions).length >= 2),
      decisionOptions: uniqueText(responses.flatMap((entry) => asArray(entry.decisionOptions)), 2),
    };
  });
  return { required: true, allResolved: closureItems.every((item) => item.status === "resolved"), items: closureItems };
}

function aggregateCrossReview(reviews = [], revisionContract = null, reviewPolicy = {}) {
  const requiredSeats = Math.max(1, Math.min(REVIEW_QUORUM, Number(reviewPolicy.requiredSeats) || REVIEW_COMPLETION_REQUIRED));
  const issueSupport = Math.max(1, Math.min(requiredSeats, Number(reviewPolicy.issueSupport) || requiredSeats));
  const reviewMode = reviewPolicy.mode === "fast" ? "fast" : "dual";
  const heterogeneityAvailable = reviewPolicy.heterogeneityAvailable !== false;
  const feedbacks = reviews.map((item) => {
    if (item.result) {
      const review = item.result;
      const route = asObject(item.route);
      const actualModel = text(review.actualModel || review.model, 120);
      return {
        seatId: text(route.seatId, 40),
        role: text(item.role || route.role, 120) || "",
        requiredModel: text(route.requiredModel || route.model || review.model, 120),
        actualModel,
        provider: review.provider || providerForRoute(actualModel),
        fallbackUsed: review.fallbackUsed === true,
        model: actualModel,
        ownedDimensions: asArray(route.ownedDimensions),
        status: "completed",
        pass: review.content.pass,
        score: review.content.score,
        confidence: review.content.confidence,
        findings: review.content.findings,
        required_changes: review.content.required_changes,
        checks: review.content.checks,
        dimensions: review.content.dimensions,
        issues: review.content.issues,
        revisionClosures: review.content.revisionClosures,
      };
    }
    const failureCode = text(item.errorCode || item.code, 80).toUpperCase();
    const failureReason = {
      TIMEOUT: "timeout",
      NETWORK_ERROR: "network_error",
      EMPTY_RESPONSE: "empty_response",
      INVALID_JSON: "invalid_json",
      SCHEMA_INVALID: "schema_error",
      MODEL_NOT_CONFIGURED: "not_configured",
    }[failureCode] || "network_error";
    return {
      seatId: text(item.route?.seatId, 40),
      role: text(item.role || item.route?.role, 120) || "",
      requiredModel: text(item.route?.requiredModel || item.model, 120),
      actualModel: "",
      provider: providerForRoute(item.model),
      fallbackUsed: false,
      model: item.model,
      status: "failed",
      pass: false,
      score: null,
      confidence: null,
      findings: [item.error || "模型未返回审核意见"],
      required_changes: [],
      failureReason,
      checks: {},
      dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((key) => [key, { score: null, feedback: "未返回（调用失败）" }])),
      issues: [],
      revisionClosures: [],
    };
  });
  const completed = feedbacks.filter((item) => item.status === "completed");
  const dimensions = Object.fromEntries(REVIEW_DIMENSIONS.map((key) => {
    const scores = completed.map((item) => item.dimensions?.[key]?.score)
      .map((value) => (value === null || value === undefined || value === "" ? NaN : Number(value)))
      .filter((value) => Number.isFinite(value));
    const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
    return [key, { average, agreement: pairwiseAgreement(scores), scores }];
  }));
  const agreementValues = REVIEW_DIMENSIONS.map((key) => dimensions[key].agreement).filter(Number.isFinite);
  const agreement = agreementValues.length ? Math.round(agreementValues.reduce((sum, value) => sum + value, 0) / agreementValues.length) : null;
  const qualityScores = completed.map((item) => Number(item.score)).filter(Number.isFinite);
  const quality = qualityScores.length ? Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length) : null;
  const reviewCompletion = Math.round((Math.min(completed.length, requiredSeats) / requiredSeats) * 100);
  const index = Number.isFinite(agreement) && Number.isFinite(quality)
    ? Math.round(agreement * 0.45 + quality * 0.35 + reviewCompletion * 0.2)
    : null;
  const structuredIssues = groupedReviewIssues(completed);
  const structuredIssueText = structuredIssues.flatMap((issue) => [...issue.suggestions, ...issue.evidence]);
  const supplementalIssues = completed
    .flatMap((feedback) => asArray(feedback.required_changes).map((change) => ({ feedback, change: text(change, 1200) })))
    .filter(({ change }) => change && !structuredIssueText.some((known) => known === change || known.includes(change) || change.includes(known)))
    .map(({ feedback, change }) => ({
      id: `issue_supplemental_${issueKey(feedback.model)}_${issueKey(change)}`,
      tag: "审核模型补充意见",
      dimension: "logic",
      severity: "medium",
      modelCount: 1,
      models: [feedback.model],
      suggestions: [change],
      evidence: [`${feedback.model}：该意见未绑定到结构化问题，暂不进入强制修订`],
    }))
    .filter((issue, index, all) => all.findIndex((candidate) => candidate.id === issue.id) === index);
  const reviewIssues = [...structuredIssues, ...supplementalIssues];
  const commonIssues = reviewIssues.filter((issue) => issue.modelCount >= issueSupport);
  const contractKeys = new Set(asArray(revisionContract?.items).flatMap((item) => revisionIssueKeys(revisionContract.stage, item)));
  const isInRevisionContract = (issue) => !revisionContract || revisionIssueKeys(revisionContract.stage, issue).some((key) => contractKeys.has(key));
  const scopedIssues = reviewIssues.filter(isInRevisionContract);
  const outOfContractIssues = revisionContract ? reviewIssues.filter((issue) => !isInRevisionContract(issue)) : [];
  const mandatoryIssues = scopedIssues.filter((issue) => isMandatoryReviewIssue(issue, issueSupport));
  const recommendedIssues = commonIssues.filter((issue) => issue.severity !== "high");
  const independentIssues = reviewIssues.filter((issue) => issue.modelCount === 1);
  const conflicts = REVIEW_DIMENSIONS
    // agreement 为 null 表示该维度有效分不足 2 个，无法判断分歧。
    // 不加 Number.isFinite 守卫的话 null < 75 在 JS 里为 true，会凭空生成假分歧裁决记录。
    .filter((key) => completed.length >= 2 && Number.isFinite(dimensions[key].agreement) && dimensions[key].agreement < 75)
    .map((key) => ({
      id: `advisory_conflict_${key}`,
      dimension: key,
      agreement: dimensions[key].agreement,
      scores: dimensions[key].scores,
      seats: completed.map((item) => item.seatId),
      suggestion: `已完成模型对${key}维度评分差异较大，建议按证据强度与阶段契约自动裁决`,
    }));
  const adjudications = conflicts.map((item) => ({
    id: item.id,
    dimension: item.dimension,
    agreement: item.agreement,
    scores: item.scores,
    seats: item.seats,
    adjudication: {
      mode: "automatic",
      status: "resolved",
      basis: "按§8.1优先级与证据强度取舍",
    },
  }));
  const revisionClosure = aggregateRevisionClosure(completed, revisionContract, requiredSeats);
  const unresolvedContractItems = revisionClosure.items.filter((item) => item.status !== "resolved");
  const explicitTradeoffIssues = scopedIssues
    .filter((item) => requiredSeats >= REVIEW_QUORUM
      && Number(item.modelCount) >= REVIEW_QUORUM
      && item.requiresCreatorDecision === true
      && asArray(item.decisionOptions).length >= 2)
    .map((item) => ({
      ...item,
      tag: item.tag || "审核取舍项",
      severity: item.severity || "high",
      suggestions: item.suggestions?.length ? item.suggestions : ["请先选择一条创作路径，再执行后续修订"],
      evidence: item.evidence || [],
      decisionType: "creative_tradeoff",
    }));
  const closureDecisionIssues = unresolvedContractItems
    .filter((item) => item.requiresCreatorDecision === true && asArray(item.decisionOptions).length >= 2)
    .map((item) => ({
      ...item,
      tag: item.tag || "未收敛修订项",
      severity: item.severity || "high",
      suggestions: item.remainingFix?.length ? item.remainingFix : [item.acceptance || "需要创作者决定下一步"],
      evidence: item.evidence || [],
      decisionType: "creative_tradeoff",
    }));
  const decisionRequiredIssues = [...explicitTradeoffIssues, ...closureDecisionIssues]
    .filter((item, index, all) => all.findIndex((candidate) => (candidate.id || candidate.criterionId || candidate.tag) === (item.id || item.criterionId || item.tag)) === index);
  const retryRequiredIssues = unresolvedContractItems
    .filter((item) => !item.requiresCreatorDecision)
    .map((item) => ({ ...item, tag: item.tag || "未关闭修订项", severity: item.severity || "high", decisionType: "retry_failed" }));
  const automaticRevisionBlocked = Boolean(revisionContract && decisionRequiredIssues.length);
  const distinctActualModels = new Set(completed.map((item) => item.actualModel || item.model).filter(Boolean)).size;
  const distinctProviders = new Set(completed
    .map((item) => item.provider || providerForRoute(item.actualModel || item.model))
    .filter(Boolean)).size;
  const passingReviews = completed.filter((item) => item.pass).length;
  const allReviewSeatsCompleted = feedbacks.length >= requiredSeats && feedbacks.every((item) => item.status === "completed");
  const independenceUnavailable = !heterogeneityAvailable;
  const nonIndependentPass = independenceUnavailable
    && allReviewSeatsCompleted
    && passingReviews >= requiredSeats;
  const quorumMet = completed.length >= requiredSeats
    && (distinctProviders >= requiredSeats || nonIndependentPass);
  const degraded = completed.length >= requiredSeats
    && distinctProviders < requiredSeats
    && !independenceUnavailable;
  // Name the seats that actually collided and the provider they landed on. A hardcoded
  // seat pair was wrong the moment the roster changed, because the pair depends on
  // which provider ultimately served the completed reviews.
  const collapsedSeats = (() => {
    const byProvider = new Map();
    completed.forEach((item) => {
      const provider = item.provider || providerForRoute(item.actualModel || item.model);
      if (!provider) return;
      if (!byProvider.has(provider)) byProvider.set(provider, []);
      byProvider.get(provider).push(item.seatId || "?");
    });
    return [...byProvider.entries()].filter(([, seats]) => seats.length > 1);
  })();
  const degradedMessage = collapsedSeats.length
    ? `技术未完成：${collapsedSeats.map(([provider, seats]) => `${seats.join("/")} 席位都落到了同一 provider（${provider}）`).join("；")}，独立复核不成立`
    : "技术未完成：审读席位未满足独立复核条件";
  const independenceUnavailableMessage = "审核标注：当前仅一个可用模型通道，本次为非独立复核。";
  const technicalFailures = [
    ...feedbacks.filter((item) => item.status === "failed").map((item) => ({ seatId: item.seatId, status: "failed", failureReason: item.failureReason, message: item.findings[0] })),
    ...(degraded ? [{ status: "degraded", collapsedSeats: collapsedSeats.map(([provider, seats]) => ({ provider, seats })), message: degradedMessage }] : []),
    ...(independenceUnavailable ? [{ status: "independence_unavailable", message: independenceUnavailableMessage }] : []),
  ];
  // 共识降级：3 席全票 → 2 席多数通过即可放行（仍需无 mandatory 硬伤 + 修订闭环）。
  // 第三席的分歧不阻断，记录到 disagreements 供追溯/导出标注——保留三席独立
  // 评估的严谨性，同时消除"单席异议永久卡死"（实测 30 次运行 0 通过）。
  const majorityPass = completed.length >= requiredSeats
    && passingReviews >= requiredSeats;
  // 2026-08-10 P1-1：关键维度最低线（防平均分掩盖单维硬伤，§5.3）。
  // 任一关键维度均值 < 75（3/4）或加权质量 < 80（3.2/4）→ 不得放行。
  // 缺失维度（null）不拦截（无证据视为参考，兼容旧输出）；有值但低于门槛才拦截。
  const KEY_DIMENSIONS = ["structure", "plot", "design", "logic"];
  const dimensionFloorMiss = KEY_DIMENSIONS.filter((key) => {
    const avg = dimensions[key]?.average;
    return Number.isFinite(avg) && avg < 75;
  });
  const belowQualityFloor = Number.isFinite(quality) && quality < 80;
  const dimensionGateFailed = dimensionFloorMiss.length > 0 || belowQualityFloor;
  const disagreements = completed
    .filter((item) => item.pass !== true)
    .map((item) => ({ seatId: item.seatId || "", model: item.actualModel || item.model || "", issues: asArray(item.mandatoryIssues).slice(0, 5).map((issue) => issue.tag || issue.criterionId || "分歧意见") }));
  const decision = !quorumMet
    ? {
      kind: "rerun",
      owner: "系统裁判",
      title: "审核未完成",
      summary: "审读席位未满足独立复核条件，需要重新完成审核。",
      items: technicalFailures,
    }
      : decisionRequiredIssues.length
      ? {
        kind: "needs_decision",
        owner: "系统裁判",
        title: "需要创作者决定",
        summary: "定向修订未收敛或出现合同外共识，自动改稿已停止。",
        items: decisionRequiredIssues,
      }
      : retryRequiredIssues.length
        ? {
          kind: "revise",
          owner: "系统裁判",
          title: "继续定向修订",
          summary: "仅处理尚未关闭的修订项，不扩大当前阶段范围。",
          items: retryRequiredIssues,
        }
      : mandatoryIssues.length
        ? {
          kind: "revise",
          owner: "系统裁判",
          title: "定向修订",
          summary: reviewMode === "fast" ? "快速审读发现高风险问题，已转为定向修订。" : "仅处理双席共同确认的高风险问题。",
          items: mandatoryIssues,
        }
        : dimensionGateFailed
          ? {
            kind: "revise",
            owner: "系统裁判",
            title: "关键维度未达最低线",
            summary: `${dimensionFloorMiss.length ? `维度 ${dimensionFloorMiss.join("/")} 均值低于 75；` : ""}${belowQualityFloor ? "加权质量低于 80；" : ""}不满足放行门槛，需定向修订后再审。`,
            items: dimensionFloorMiss.map((key) => ({
              id: `dimension_floor_${key}`,
              tag: `维度未达最低线：${key}`,
              severity: "high",
              dimension: key,
              suggestions: [`${key} 维度平均分 ${Math.round(dimensions[key].average)} < 75，需提升后重新审核`],
              evidence: [],
            })),
          }
          : {
            kind: "approve",
            owner: "系统裁判",
            title: independenceUnavailable ? "非独立复核放行" : "通过",
            summary: independenceUnavailable
              ? "当前仅一个可用模型通道，本次为非独立复核；两席审核均已完成并通过，带标注放行。"
              : reviewMode === "fast" ? "硬规则与快速审读均已满足；其余意见仅供参考。" : "硬规则、修订合同和双席共识均已满足；其余意见仅供参考。",
            items: [],
          };
  const basePass = decision.kind === "approve";
  const pass = basePass;
  const checks = {
    cross_validation: quorumMet,
    independent_review: !independenceUnavailable,
    reviews_passed: majorityPass,
    majority_consensus: majorityPass,
    consistency: mandatoryIssues.length === 0,
    adversarial: completed.filter((item) => item.checks?.adversarial === true).length >= requiredSeats,
    issues_converged: mandatoryIssues.length === 0,
    dimensions_agree: conflicts.length === 0,
    revision_contract_closed: revisionClosure.allResolved,
  };
  const issueChanges = mandatoryIssues.map((issue) => {
    const source = `至少 ${issue.modelCount} 个模型共同指出`;
    const suggestions = issue.suggestions.length ? issue.suggestions.join("；") : "针对该问题补充具体修订并重新提交规定审核席位复审";
    return `${source}【${issue.severity} / ${issue.tag}】：${suggestions}`;
  });
  const closureChanges = revisionClosure.items
    .filter((item) => item.status !== "resolved")
    .map((item) => `【${item.id} / ${item.tag}】修订关闭未通过：${item.remainingFix.join("；") || "请按验收条件补充修订"}`);
  return {
    pass,
    basePass,
    score: quality,
    consensusIndex: index,
    agreement,
    quality,
    reviewCompletion,
    reviewPolicy: { mode: reviewMode, requiredSeats, issueSupport, heterogeneityAvailable },
    quorum: { required: requiredSeats, completedSeats: completed.length, completed: completed.length, passing: passingReviews, distinctActualModels, distinctProviders, met: quorumMet, degraded, independenceUnavailable },
    disagreements,
    dimensions,
    feedbacks,
    reviewIssues,
    issueCount: reviewIssues.length,
    commonIssues,
    commonIssueCount: commonIssues.length,
    mandatoryIssues,
    mandatoryIssueCount: mandatoryIssues.length,
    outOfContractIssues,
    decisionRequiredIssues,
    retryRequiredIssues,
    automaticRevisionBlocked,
    decision,
    recommendedIssues,
    recommendedIssueCount: recommendedIssues.length,
    independentIssues,
    independentIssueCount: independentIssues.length,
    conflicts,
    adjudications,
    technicalFailures,
    findings: uniqueText([...commonIssues.map((item) => `共识问题【${item.tag}】（${item.modelCount} 个模型）`), ...conflicts.map((item) => `意见冲突：${item.dimension} 一致性 ${item.agreement}%`), ...feedbacks.flatMap((item) => item.findings)]),
    required_changes: uniqueText([...issueChanges, ...closureChanges], 60),
    advisories: {
      independentIssues,
      conflicts,
      failedReviews: feedbacks.filter((item) => item.status === "failed").map((item) => ({ provider: item.provider, model: item.model, message: item.findings[0] })),
    },
    checks,
    revision: revisionContract ? { contract: revisionContract, closure: revisionClosure } : null,
  };
}

function ruleBlockedReview(ruleResult) {
  const base = aggregateCrossReview([], null);
  const findings = ruleResult.violations.map((item) => `规则违规【${item.code}】：${item.message}`);
  const decisionRequiredIssues = ruleResult.violations
    .filter((item) => item.requiresCreatorDecision === true && asArray(item.decisionOptions).length >= 2)
    .map((item) => ({
      ...item,
      id: `rule_${String(item.code || "issue").toLowerCase()}`,
      tag: item.code,
      severity: item.severity || "high",
      suggestions: [item.message],
      evidence: [item.message],
      decisionType: "creative_tradeoff",
    }));
  const needsDecision = decisionRequiredIssues.length > 0;
  return {
    ...base,
    pass: false,
    basePass: false,
    reviewCompletion: null,
    findings,
    ruleFindings: ruleResult.violations,
    decisionRequiredIssues,
    automaticRevisionBlocked: needsDecision,
    technicalFailures: [{ status: "rule_blocked", message: "命中 high 规则，审核模型未调用" }],
    decision: {
      kind: needsDecision ? "needs_decision" : "revise",
      owner: "规则校验",
      title: needsDecision ? "需要创作者决定" : "定向修订",
      summary: needsDecision ? "规则校验发现跨阶段取舍，先选择修正归属，再处理对应产物。" : "规则校验发现必须修正的硬约束。",
      items: needsDecision ? decisionRequiredIssues : ruleResult.violations,
    },
    checks: { ...base.checks, rule_gate: false },
  };
}

class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, code = "PROVIDER_ERROR" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

async function callProvider({ provider, system, user, modelRouter, timeoutMs, maxTokens, purpose = "pixeltale", temperature, signal }) {
  if (!modelRouter || typeof modelRouter.call !== "function") {
    throw new ProviderError("PixelTale 未接入独立编剧 API 路由", { code: "PIXELTALE_API_ROUTER_MISSING" });
  }
  return modelRouter.call({ model: modelForRoute(provider), system, user, purpose, timeoutMs, maxTokens, temperature, signal });
}

// "Can we try a DIFFERENT model?" — not "can we retry this one?". TRUNCATED_OUTPUT
// is deliberately marked non-retryable at the API layer because repeating the same
// model with the same max_tokens truncates again, but another model may well fit the
// budget. Leaving it out killed a whole review seat on one truncation and dropped
// the stage below quorum.
function canFallbackFrom(error) {
  return error?.retryable === true || ["TIMEOUT", "NETWORK_ERROR", "EMPTY_RESPONSE", "INVALID_JSON", "SCHEMA_INVALID", "TRUNCATED_OUTPUT"].includes(error?.code);
}

function stagePrimaryTiming(stage) {
  return STAGE_PRIMARY_TIMINGS[stage] || STAGE_PRIMARY_TIMINGS.proposal;
}

function creativeAuthorIdentity(role, slot = 0) {
  return {
    structure_causality: "结构与因果主创：负责结构、因果、用户要求和阶段契约兑现。",
    character_continuity: "人物与连续性主创：负责人物动机、关系连续性、世界规则、市场细节和语言自然度。",
    audience_pacing_visual: "受众节奏与视觉主创：负责首屏冲击、反转、对白声线、场景可拍性和追更动力。",
  }[text(role, 120)] || [
    "结构与规格主创：负责结构、因果、用户要求和阶段契约兑现。",
    "人物与连续性主创：负责人物动机、关系连续性、世界规则、市场细节和语言自然度。",
    "受众节奏与视觉主创：负责首屏冲击、反转、对白声线、场景可拍性和追更动力。",
  ][slot] || "独立主创：基于当前阶段契约提出可执行创作方案。";
}

function parsePromptObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : { sourceRequest: value };
  } catch {
    return { sourceRequest: text(value, 120000) };
  }
}

function councilPromptWithRole(user, role) {
  const payload = parsePromptObject(user);
  return JSON.stringify({
    ...payload,
    creativeCouncilRole: role,
    creativeCouncilInstruction: "独立完成本角色的完整阶段产物；不要等待其他模型，也不要只给意见。你的输出会与另外两份独立产物一起交给合并器。",
  }, null, 2).slice(0, 180000);
}

function stageSynthesisPrompt({ stage, mode, user, contributions }) {
  return JSON.stringify({
    task: "三模型独立创作已经全部完成。请作为合并编排器，基于三份完整贡献合并出唯一的阶段产物。必须同时吸收三份贡献的有效内容，解决彼此冲突，保留用户规格和已确认上下文；不得只复制某一个模型，也不得丢失本阶段契约字段。",
    currentStage: stage,
    mode,
    sourceRequest: parsePromptObject(user),
      creativeCouncil: {
      requiredModels: 3,
      instruction: "三份贡献均为必需输入；如果存在冲突，按用户规格、阶段契约和因果可执行性取舍，不得静默忽略任何一份。",
      contributions: contributions.map((item) => ({
        model: item.requiredModel || item.model,
        actualModel: item.actualModel || item.model,
        provider: item.provider,
        role: item.role,
        fallbackUsed: item.fallbackUsed === true,
        content: item.result.content,
      })),
    },
    outputInstruction: `严格按照当前阶段的输出契约返回 JSON：${stageOutputContract(stage, mode)}`,
  }, null, 2).slice(0, 180000);
}

// The merge step is the only single point of decision in a stage: one model
// compresses three independent drafts into the released artifact, and nothing
// downstream can see what it discarded (reviewers only receive the merged
// result). This computes retention deterministically — no extra model call — so
// a merge that simply copied one draft becomes visible instead of silent.
function leafStrings(value, out = []) {
  if (typeof value === "string") {
    const text = value.trim();
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => leafStrings(item, out));
    return out;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => leafStrings(item, out));
  }
  return out;
}

// Character 5-grams, not whole strings. The merger legitimately rewords while
// reconciling three drafts, so whole-string matching reported ~6% retention on a
// prose-heavy stage even for a sound merge. Shingles survive light rewording but
// still collapse when a draft was genuinely discarded.
const MERGE_SHINGLE_SIZE = 5;

function contentShingles(value) {
  const out = new Set();
  for (const text of leafStrings(value)) {
    const compact = text.replace(/\s+/g, "");
    if (compact.length < MERGE_SHINGLE_SIZE) continue;
    for (let index = 0; index + MERGE_SHINGLE_SIZE <= compact.length; index += 1) {
      out.add(compact.slice(index, index + MERGE_SHINGLE_SIZE));
    }
  }
  return out;
}

function computeMergeAudit(contributions = [], mergedContent = null) {
  const merged = contentShingles(mergedContent);
  if (!merged.size) return null;
  const seats = contributions.map((item) => {
    const own = contentShingles(item?.result?.content);
    let kept = 0;
    own.forEach((gram) => { if (merged.has(gram)) kept += 1; });
    return {
      seatId: item?.seatId || "",
      role: item?.role || "",
      ownShingles: own.size,
      keptShingles: kept,
      retentionPct: own.size ? Math.round((kept / own.size) * 100) : null,
    };
  });
  const rates = seats.map((seat) => seat.retentionPct).filter((value) => Number.isFinite(value));
  if (rates.length < 2) return { seats, dominatedBy: "", ignoredDrafts: false, spreadPct: null, note: "" };
  const highest = Math.max(...rates);
  const lowest = Math.min(...rates);
  const leader = seats.find((seat) => seat.retentionPct === highest);
  // Two distinct failure shapes, and the earlier version only caught the first:
  //  - one seat dominates → the other drafts were thrown away
  //  - every seat is low  → the merger ignored all three and wrote its own version,
  //    which is worse and previously reported as "no dominance".
  const dominated = highest >= 60 && highest - lowest >= 40;
  const ignoredDrafts = highest < 25;
  const notes = [];
  if (dominated) notes.push(`合并由 ${leader?.seatId || "某一席"} 主导（留存 ${highest}% vs 最低 ${lowest}%），另外两席基本未被采纳`);
  if (ignoredDrafts) notes.push(`合并器几乎没有采纳任何一席（最高留存仅 ${highest}%），产物可能是它自己重写的，请核对是否丢失三席的有效内容`);
  return {
    seats,
    spreadPct: highest - lowest,
    dominatedBy: dominated ? (leader?.seatId || "") : "",
    ignoredDrafts,
    note: notes.join("；"),
  };
}

async function callStageCouncil({
  route,
  system,
  user,
  stage = "brief",
  mode = "tk_short_drama",
  modelRouter,
  nowMs = () => Date.now(),
  totalTimeoutMs,
  perModelTimeoutMs,
  validateContribution,
  onPhase,
}) {
  if (!modelRouter || typeof modelRouter.stageModels !== "function") {
    throw new ProviderError("PixelTale 未接入独立编剧 API 主创路由", { code: "PIXELTALE_API_ROUTER_MISSING" });
  }
  // Seats are positional now, so this list must stay aligned with REVIEW_SEATS.
  // Deduplicating here would drop a seat whenever two seats share one model.
  const providers = modelRouter.stageModels(route).slice(0, 3).map((model) => text(model, 120).toLowerCase()).filter(Boolean);
  const failures = [];
  const timing = stagePrimaryTiming(stage);
  const totalBudgetMs = totalTimeoutMs ?? timing.total;
  const perModelBudgetMs = perModelTimeoutMs ?? timing.model;
  const startedAtMs = nowMs();
  const authorDeadlineMs = startedAtMs + Math.max(MIN_STAGE_PRIMARY_ATTEMPT_MS, totalBudgetMs);
  if (providers.length !== 3) {
    const error = new ProviderError("三模型创作未齐备，当前阶段不能进入合并和审核", { code: "STAGE_CREATIVE_COUNCIL_INCOMPLETE", retryable: false });
    error.creativeCouncil = { requiredModels: 3, completedModels: 0, missingModels: providers.length ? 3 - providers.length : 3, contributors: providers };
    throw error;
  }
  const synthesisTimeoutMs = Math.max(MIN_STAGE_PRIMARY_ATTEMPT_MS, Math.min(perModelBudgetMs, totalBudgetMs));
  const roles = providers.map((model, index) => ({
    seat: REVIEW_SEATS[index],
    // Keyed by seat position, not by model id: two seats may run the same model.
    seatKey: index,
    model,
    role: REVIEW_SEATS[index]?.role || "",
    roleDescription: creativeAuthorIdentity(REVIEW_SEATS[index]?.role, index),
    fallbackModel: typeof modelRouter.fallbackModelFor === "function" ? modelRouter.fallbackModelFor(model, REVIEW_SEATS[index]?.id) : "",
  }));
  const completed = new Map();
  const attemptedModels = [];
  let pending = roles.slice();
  let authorRounds = 0;

  for (let round = 1; round <= STAGE_PRIMARY_RETRY_ROUNDS && pending.length; round += 1) {
    authorRounds = round;
    const settled = await Promise.allSettled(pending.map(async (author) => {
      const model = author.candidate || author.model;
      attemptedModels.push(model);
      const remainingMs = authorDeadlineMs - nowMs();
      if (remainingMs < MIN_STAGE_PRIMARY_ATTEMPT_MS) {
        throw new ProviderError("主创席位剩余预算不足，未启动该席位请求", { code: "STAGE_TIMEOUT_BUDGET_EXHAUSTED", retryable: true });
      }
      const result = await callProvider({
        provider: model,
        system: `${system}\n本次固定创作身份：${author.roleDescription}\n必需席位模型：${author.model}\n本次实际调用模型：${model}`,
        user: councilPromptWithRole(user, author.roleDescription),
        modelRouter,
        timeoutMs: Math.max(MIN_STAGE_PRIMARY_ATTEMPT_MS, Math.min(perModelBudgetMs, remainingMs)),
        maxTokens: stageTokenBudget(stage, model),
        purpose: `pixeltale:${stage}:author`,
        temperature: { seat_a: 0.3, seat_b: 0.7, seat_c: 1.0 }[author.seat?.id] ?? 0.25,
      });
      if (!result?.content || typeof result.content !== "object") {
        const error = new Error(`${model} 未返回可合并的结构化创作产物`);
        error.code = "SCHEMA_INVALID";
        error.retryable = true;
        throw error;
      }
      const content = typeof validateContribution === "function" ? validateContribution(result.content, { model: author.model, actualModel: model, role: author.role }) : result.content;
      return {
        model: author.model,
        seatId: author.seat?.id || "",
        requiredModel: author.model,
        actualModel: model,
        fallbackUsed: author.fallbackUsed === true,
        role: author.role,
        provider: result.provider || providerForRoute(model),
        result: { ...result, content },
      };
    }));
    const retry = [];
    settled.forEach((item, index) => {
      const author = pending[index];
      if (item.status === "fulfilled") {
        completed.set(author.seatKey, item.value);
        return;
      }
      const reason = item.reason instanceof Error ? item.reason : new Error(String(item.reason || "主创模型请求失败"));
      const failure = {
        provider: providerForRoute(author.candidate || author.model),
        seatId: author.seat?.id || "",
        requiredModel: author.model,
        model: author.candidate || author.model,
        actualModel: author.candidate || author.model,
        fallbackModel: author.fallbackModel,
        fallbackUsed: author.fallbackUsed === true,
        role: author.role,
        round,
        code: reason.code || "PROVIDER_ERROR",
        retryable: canFallbackFrom(reason),
        message: reason.message || "主创模型请求失败",
      };
      failures.push(failure);
      if (round < STAGE_PRIMARY_RETRY_ROUNDS && canFallbackFrom(reason) && author.fallbackModel && author.fallbackUsed !== true) {
        retry.push({ ...author, candidate: author.fallbackModel, fallbackUsed: true });
      }
    });
    pending = retry;
  }

  if (completed.size !== roles.length) {
    const error = new ProviderError("三模型创作未齐备，当前阶段不能进入合并和审核", { code: "STAGE_CREATIVE_COUNCIL_INCOMPLETE", retryable: false });
    error.fallbackFailures = failures;
    error.creativeCouncil = { requiredModels: 3, completedModels: completed.size, contributors: roles.map(({ seat, seatKey, model, role }) => ({ seatId: seat?.id || "", model, requiredModel: model, role, status: completed.has(seatKey) ? "completed" : "failed" })) };
    error.splitSafe = failures.length > 0 && failures.every((item) => canFallbackFrom(item));
    error.primaryBudget = { totalTimeoutMs: totalBudgetMs * STAGE_PRIMARY_RETRY_ROUNDS, elapsedMs: Math.max(0, nowMs() - startedAtMs), rounds: authorRounds, authorAttempts: attemptedModels.length };
    throw error;
  }

  const contributions = roles.map(({ seatKey }) => completed.get(seatKey));
  try {
    if (typeof onPhase === "function") onPhase("synthesizing");
  } catch {
    // Phase reporting is observational and must never interrupt generation.
  }
  const synthesisModel = providers[0];
  const synthesisCandidates = uniqueText([synthesisModel, typeof modelRouter.fallbackModelFor === "function" ? modelRouter.fallbackModelFor(synthesisModel) : ""], 2);
  let synthesisResult;
  const synthesisFailures = [];
  let synthesisActualModel = synthesisModel;
  let synthesisFallbackUsed = false;
  for (const [index, candidate] of synthesisCandidates.entries()) {
    synthesisActualModel = candidate;
    synthesisFallbackUsed = index > 0;
    try {
      synthesisResult = await callProvider({
        provider: candidate,
        system: `${system}\n本次固定身份：合并编排器。三份独立创作均已齐备，必须综合三份贡献后输出唯一阶段产物。\n必需合并模型：${synthesisModel}\n本次实际调用模型：${candidate}`,
        user: stageSynthesisPrompt({ stage, mode, user, contributions }),
        modelRouter,
        timeoutMs: synthesisTimeoutMs,
        maxTokens: stageTokenBudget(stage, candidate),
        purpose: `pixeltale:${stage}:synthesis`,
        temperature: 0.35,
      });
      break;
    } catch (error) {
      const failure = { requiredModel: synthesisModel, model: candidate, actualModel: candidate, fallbackUsed: index > 0, retryable: canFallbackFrom(error), code: error?.code || "PROVIDER_ERROR", message: error?.message || "创作合并失败" };
      synthesisFailures.push(failure);
      if (!canFallbackFrom(error)) break;
    }
  }
  if (!synthesisResult?.content || typeof synthesisResult.content !== "object") {
    const error = new ProviderError("三模型创作合并失败，当前阶段不能进入审核", { code: "STAGE_SYNTHESIS_FAILED", retryable: false });
    error.fallbackFailures = synthesisFailures;
    error.creativeCouncil = { requiredModels: 3, completedModels: 3, contributors: contributions.map(({ seatId, model, requiredModel, actualModel, provider, role, fallbackUsed }) => ({ seatId, model: requiredModel || model, requiredModel: requiredModel || model, actualModel, provider, role, fallbackUsed: fallbackUsed === true, status: "completed" })), synthesizer: { requiredModel: synthesisModel, actualModel: synthesisActualModel, fallbackUsed: synthesisFallbackUsed, status: "failed" } };
    error.splitSafe = synthesisFailures.length > 0 && synthesisFailures.every((item) => canFallbackFrom(item));
    throw error;
  }
  const creativeCouncil = {
    mode: "parallel_authoring_then_synthesis",
    requiredModels: 3,
    completedModels: contributions.length,
    contributors: contributions.map(({ seatId, model, requiredModel, actualModel, provider, role, fallbackUsed, result }) => ({
      seatId,
      model: requiredModel || model,
      requiredModel: requiredModel || model,
      actualModel,
      provider,
      role,
      fallbackUsed: fallbackUsed === true,
      status: "completed",
      attempts: attemptedModels.filter((item) => item === model || item === actualModel).length,
      contribution: {
        contentHash: contentHash(result.content),
        outputChars: JSON.stringify(result.content).length,
        excerpt: JSON.stringify(result.content).slice(0, 800),
      },
    })),
    synthesizer: { requiredModel: synthesisModel, actualModel: synthesisActualModel, provider: synthesisResult.provider || providerForRoute(synthesisActualModel), role: "合并编排器", fallbackUsed: synthesisFallbackUsed, attempts: synthesisFailures.length + 1 },
    mergeAudit: computeMergeAudit(contributions, synthesisResult.content),
  };
  return {
    ...synthesisResult,
    attempts: attemptedModels.length + synthesisFailures.length + 1,
    fallback: contributions.some((item) => item.fallbackUsed) || synthesisFallbackUsed,
    fallbackFailures: [...failures, ...synthesisFailures],
    attemptedModels: [...new Set(attemptedModels)],
    tokenUsageTotal: [...contributions.map((item) => tokenUsage(item.result)), tokenUsage(synthesisResult)].reduce((sum, value) => sum + value, 0),
    creativeCouncil,
    primaryBudget: { totalTimeoutMs: totalBudgetMs * (STAGE_PRIMARY_RETRY_ROUNDS + 1), elapsedMs: Math.max(0, nowMs() - startedAtMs), rounds: authorRounds, authorAttempts: attemptedModels.length, synthesisAttempts: synthesisFailures.length + 1 },
  };
}

async function callStagePrimary({ route, system, user, stage = "brief", modelRouter, validateContribution, onPhase }) {
  if (!modelRouter || typeof modelRouter.call !== "function") {
    throw new ProviderError("PixelTale 未接入独立编剧 API 主创路由", { code: "PIXELTALE_API_ROUTER_MISSING" });
  }
  const model = text(route?.primary, 120);
  if (!model) throw new ProviderError("当前阶段未配置主笔模型", { code: "STAGE_PRIMARY_NOT_CONFIGURED" });
  try {
    if (typeof onPhase === "function") onPhase("authoring");
  } catch {
    // Phase reporting is observational and must never interrupt generation.
  }
  let result;
  try {
    result = await callProvider({
      provider: model,
      system: `${system}\n本次固定身份：主笔。只负责生成完整阶段产物，不自我审核、不扩展任务边界。`,
      user,
      modelRouter,
      timeoutMs: stagePrimaryTiming(stage).model,
      maxTokens: stageTokenBudget(stage, model),
      purpose: `pixeltale:${stage}:author`,
      temperature: 0.4,
    });
  } catch (error) {
    error.splitSafe = canFallbackFrom(error);
    throw error;
  }
  const content = typeof validateContribution === "function" ? validateContribution(result.content) : result.content;
  return {
    ...result,
    content,
    primaryExecution: {
      role: "主笔",
      requiredModel: model,
      actualModel: result.model || model,
      provider: result.provider || providerForRoute(model),
      fallbackUsed: false,
    },
  };
}

async function collectCrossReviewQuorum({ reviewRoutes = [], revisionContract = null, execute }) {
  const results = new Array(reviewRoutes.length);
  const runReview = (index) => {
    const reviewRoute = reviewRoutes[index];
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => execute(reviewRoute, controller.signal))
      .catch((error) => ({
        route: reviewRoute,
        model: reviewRoute?.model || reviewRoute,
        error: error?.message || "审核模型请求失败",
        errorCode: error?.code || "NETWORK_ERROR",
      }))
      .then((result) => ({ index, result }));
    return { controller, promise };
  };
  const settle = async (indexes) => {
    const settled = await Promise.all(indexes.map((index) => runReview(index).promise));
    settled.forEach(({ index, result }) => { results[index] = result; });
  };

  // The three review seats run in parallel every time. A fast agreement between
  // two models is useful evidence, but it is not a release gate: the third
  // independent review is part of the interactive consistency baseline.
  await settle(reviewRoutes.map((_route, index) => index));
  return results.filter(Boolean);
}

function emptyState({ projectId, mode = "tk", now = () => new Date() }) {
  const timestamp = nowIso(now);
  return {
    schemaVersion: 2,
    projectId: text(projectId, 500),
    mode: normalizeMode(mode),
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    input: {},
    stage: "brief",
    routes: { ...DEFAULT_ROUTES },
    artifacts: [],
    approvedArtifactIds: [],
    unitLocks: { arc: {}, scenes: {} },
    stageProgress: {
      arc: normalizeUnitProgress(),
      scenes: normalizeUnitProgress(),
    },
    runs: [],
    handoffs: [],
    visualAssets: null,
    visualAssetReview: null,
    visualAssetDocument: null,
    scriptDocument: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeState(raw, params) {
  const base = emptyState(params);
  const source = asObject(raw);
  const stateMode = normalizeMode(source.mode || params.mode);
  const state = {
    ...base,
    ...source,
    projectId: text(source.projectId || params.projectId, 500),
    mode: stateMode,
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    input: { ...asObject(source.input), mode: stateMode, audienceGender: normalizeAudience(source.input), ...normalizeCreativeControls(source.input), ...normalizeMarket(source.input, stateMode), ...normalizeStageOptions(source.input) },
    stage: source.stage === "handoff" ? "handoff" : normalizeStage(source.stage),
    routes: normalizeRoutes(source.routes),
    artifacts: asArray(source.artifacts),
    approvedArtifactIds: asArray(source.approvedArtifactIds),
    unitLocks: {
      arc: asObject(source.unitLocks?.arc),
      scenes: asObject(source.unitLocks?.scenes),
    },
    stageProgress: {
      arc: normalizeUnitProgress(source.stageProgress?.arc),
      scenes: normalizeUnitProgress(source.stageProgress?.scenes),
    },
    runs: asArray(source.runs).slice(-50),
    handoffs: asArray(source.handoffs),
  };
  migrateApprovedUnitLocks(state);
  return state;
}

function migrateApprovedUnitLocks(state) {
  for (const stage of UNIT_STAGES) {
    if (Object.keys(asObject(state.unitLocks?.[stage])).length) continue;
    const approvedIds = new Set(state.approvedArtifactIds);
    const artifact = asArray(state.artifacts)
      .filter((item) => item?.stage === stage && item?.type === `pixeltale_${stage}` && approvedIds.has(item.id))
      .sort((left, right) => Number(left.version || 0) - Number(right.version || 0))
      .at(-1);
    if (!artifact) continue;
    const content = asObject(artifact.content);
    const numbers = unitNumbersForContent(stage, content);
    if (!numbers.length) continue;
    const total = plannedUnitCount(state.input) || Math.max(...numbers);
    if (numbers.length < total) continue;
    state.input.episodeCount ||= total;
    lockStageUnits(state, stage, content, numbers, artifact, () => new Date());
    state.stageProgress[stage] = {
      ...normalizeUnitProgress(state.stageProgress?.[stage]),
      totalUnits: total,
      batchSize: EPISODE_BATCH_SIZE,
      lockedUnits: numbers,
      pendingUnits: [],
      currentBatch: [],
      batches: [{ id: `migration_${artifact.id}`, units: numbers, status: "migrated", artifactId: artifact.id, reviewId: artifact.reviewId, error: "", startedAt: text(artifact.createdAt, 80), completedAt: text(artifact.updatedAt || artifact.createdAt, 80) }],
      updatedAt: text(artifact.updatedAt || artifact.createdAt, 80),
    };
  }
}

function readState({ stateRoot, projectId, mode, readPixelTaleState, writePixelTaleState, now }) {
  const raw = asObject(readPixelTaleState(stateRoot));
  const state = normalizeState(raw, { projectId, mode, now });
  if (!Object.keys(raw).length || JSON.stringify(raw.routes || {}) !== JSON.stringify(state.routes)) writePixelTaleState(stateRoot, state);
  return state;
}

function saveState({ stateRoot, state, writePixelTaleState }) {
  return writePixelTaleState(stateRoot, state);
}

function stageBatchInput({ stage, totalUnits, unitScope, lockedUnits, allowLockedUnitRevision = false }) {
  return {
    unitScope: normalizeUnitNumbers(unitScope, totalUnits),
    unitNumbers: normalizeUnitNumbers(unitScope, totalUnits),
    lockedUnitNumbers: normalizeUnitNumbers(lockedUnits, totalUnits),
    allowLockedUnitRevision,
  };
}

function stageBatchContext(state, stage, unitScope) {
  const scope = normalizeUnitNumbers(unitScope, plannedUnitCount(state.input));
  const previous = scope.map((number) => state.unitLocks?.[stage]?.[number - 1]).filter(Boolean).map((lock) => compactLockedUnit(stage, lock));
  const locked = lockedUnitContext(state, stage, scope);
  return [...previous, ...locked].slice(-12);
}

function transientUnitContext(stage, content, unitNumbers) {
  return normalizeUnitNumbers(unitNumbers).map((number) => {
    const items = unitItemsForContent(stage, content, [number]);
    if (!items.length) return null;
    const current = stage === "scenes" ? items : items[0];
    return {
      unitNumber: number,
      version: 0,
      contentHash: contentHash(items),
      startState: unitContinuityState(stage, null),
      endState: unitContinuityState(stage, current),
      openThreads: unitOpenThreads(stage, current),
      transient: true,
    };
  }).filter(Boolean);
}

function updateUnitStageProgress(state, stage, totalUnits, { batchId = "", units = [], status = "running", artifactId = "", reviewId = "", error = "", startedAt = "", completedAt = "" } = {}) {
  const progress = normalizeUnitProgress(state.stageProgress?.[stage]);
  const locked = lockedUnitNumbers(state, stage);
  const pending = [...Array(totalUnits || 0)].map((_, index) => index + 1).filter((number) => !locked.includes(number));
  const batch = batchId ? {
    id: batchId,
    units: normalizeUnitNumbers(units, totalUnits),
    status,
    artifactId: text(artifactId, 200),
    reviewId: text(reviewId, 200),
    error: text(error, 1600),
    startedAt: text(startedAt, 80),
    completedAt: text(completedAt, 80),
  } : null;
  const batches = batch
    ? [...progress.batches.filter((entry) => entry.id !== batch.id), batch]
    : progress.batches;
  // 已生成集 = 所有非 running 批次覆盖的集（含 needs_review/approved/已锁定），
  // 用于 UI 体现"已生成但尚未锁定"的集（否则 0/30 会让用户误以为什么都没做）。
  const generatedUnits = [...new Set(
    batches.filter((entry) => entry.status !== "running").flatMap((entry) => entry.units || []),
  )].sort((a, b) => a - b);
  const pinList = Object.keys(asObject(state?.unitLocks?.[stage]) || {}).map(Number)
    .filter((u) => unitLockStatus(state, stage, u) === "pinned").sort((a, b) => a - b);
  const dirtyList = dirtyUnits(state, stage);
  state.stageProgress[stage] = {
    ...progress,
    totalUnits,
    batchSize: EPISODE_BATCH_SIZE,
    lockedUnits: locked,
    // 人工定稿集并入锁定语义（进度条绿色），并单独暴露给前端做徽标
    pinnedUnits: pinList,
    dirtyUnits: dirtyList,
    pendingUnits: pending,
    currentBatch: status === "running" ? normalizeUnitNumbers(units, totalUnits) : [],
    batches: batches.slice(-30),
    updatedAt: new Date().toISOString(),
  };
}

function lockStageUnits(state, stage, content, unitNumbers, artifact, now) {
  if (!UNIT_STAGES.has(stage)) return;
  if (!state.unitLocks[stage] || typeof state.unitLocks[stage] !== "object") state.unitLocks[stage] = {};
  const sorted = normalizeUnitNumbers(unitNumbers);
  const allItems = stage === "scenes" ? asArray(asObject(content).scenes) : asArray(asObject(content).units);
  sorted.forEach((number) => {
    const items = allItems.filter((item) => unitNumberForStage(stage, item) === number);
    if (!items.length) return;
    const previous = state.unitLocks[stage][number];
    const previousUnit = stage === "scenes"
      ? asArray(asObject(content).scenes).filter((item) => unitNumberForStage(stage, item) === number - 1)
      : asObject(asArray(asObject(content).units).find((item) => unitNumberForStage(stage, item) === number - 1));
    const current = stage === "scenes" ? items : items[0];
    state.unitLocks[stage][number] = {
      status: "locked",
      unitNumber: number,
      artifactId: text(artifact?.id, 200),
      version: Number(artifact?.version || 0),
      contentHash: contentHash(items),
      startState: unitContinuityState(stage, previousUnit),
      endState: unitContinuityState(stage, current),
      openThreads: unitOpenThreads(stage, current),
      previousLock: text(previous?.artifactId, 200),
      lockedAt: nowIso(now),
    };
  });
}

function synthesizeBatchReview(stage, batchReviews, totalUnits, unitLocks, revisionContract = null) {
  const review = batchReviewSummary(stage, batchReviews, totalUnits, unitLocks);
  review.revision = revisionContract ? { contract: revisionContract, closure: { required: true, allResolved: review.basePass, items: asArray(revisionContract.items).map((item) => ({ ...item, status: review.basePass ? "resolved" : "unresolved", evidence: review.basePass ? "每个分批产物均完成规定审核席位审读并关闭硬性问题" : "至少一个分批产物未完成基础审核条件", remainingFix: review.basePass ? "" : "按失败批次重新修订" })) } } : null;
  return review;
}

function scopedPreviousArtifacts(previousArtifacts, unitScope) {
  const scope = normalizeUnitNumbers(unitScope);
  return asArray(previousArtifacts).map((artifact) => {
    if (!UNIT_STAGES.has(artifact?.stage)) return artifact;
    return {
      ...artifact,
      content: unitStageContent(artifact.stage, artifact.content, scope),
    };
  });
}

function publicArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return artifact;
  const { model, ...safeArtifact } = artifact;
  return safeArtifact;
}

function publicRun(run) {
  if (!run || typeof run !== "object") return run;
  const { primaryModel, reviewModel, ...safeRun } = run;
  return safeRun;
}

function publicState(state, modelRouter) {
  const publicProviderStatus = typeof modelRouter?.status === "function" ? modelRouter.status() : {};
  return {
    ...state,
    artifacts: asArray(state.artifacts).map(publicArtifact),
    runs: asArray(state.runs).map(publicRun),
    providerStatus: publicProviderStatus,
    modelOptions: typeof modelRouter?.models === "function" ? modelRouter.models() : [],
  };
}

function artifactForStage(state, stage) {
  return state.artifacts.filter((artifact) => artifact.stage === stage && artifact.type === `pixeltale_${stage}`).sort((a, b) => Number(a.version || 0) - Number(b.version || 0)).at(-1) || null;
}

function approvedForStage(state, stage) {
  const approved = new Set(state.approvedArtifactIds);
  return state.artifacts.filter((artifact) => artifact.stage === stage && approved.has(artifact.id)).sort((a, b) => Number(a.version || 0) - Number(b.version || 0)).at(-1) || null;
}

function nextStage(stage) {
  const index = STAGES.indexOf(stage);
  return index < 0 || index === STAGES.length - 1 ? "handoff" : STAGES[index + 1];
}

function nextRequiredStage(state) {
  const approved = new Set(state.approvedArtifactIds);
  return STAGES.find((stage) => {
    // A newer rerun supersedes an older approval. The latest artifact is the
    // only version that can release this stage and its downstream stages.
    const artifact = artifactForStage(state, stage);
    return !artifact || !approved.has(artifact.id);
  }) || "handoff";
}

function buildArtifact({ stage, mode, input, content, model, version, review, now, randomUUID }) {
  const timestamp = nowIso(now);
  const ready = !!review?.pass;
  return {
    id: id("artifact", randomUUID),
    type: `pixeltale_${stage}`,
    stage,
    version,
    status: ready ? "ready" : "needs_review",
    source: "pixeltale_agent",
    content,
    evidence: ["用户创作规格", "已确认阶段上下文", `${modeLabel(mode)} / 中文剧情 + 英文对白策略`, `目标市场：${MARKET_PROFILES[normalizeMarket(input, mode).marketCountry].label}`],
    model,
    reviewId: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildReviewArtifact({ stage, review, model, version, now, randomUUID, primaryArtifactId }) {
  const timestamp = nowIso(now);
  return {
    id: id("review", randomUUID),
    type: "pixeltale_stage_review",
    stage,
    version,
    status: review.pass ? "passed" : "failed",
    source: "pixeltale_reviewer",
    content: review,
    evidence: [`复核 ${primaryArtifactId}`],
    model,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createHandoffPayload({ state, project, now, randomUUID }) {
  const approved = Object.fromEntries(STAGES.map((stage) => [stage, approvedForStage(state, stage)]));
  const missing = STAGES.filter((stage) => !approved[stage]);
  if (missing.length) {
    const error = new Error(`仍有阶段未确认：${missing.join(", ")}`);
    error.code = "HANDOFF_NOT_READY";
    error.statusCode = 409;
    throw error;
  }
  const proposal = approved.proposal.content;
  const characters = approved.characters.content;
  const scenes = approved.scenes.content;
  const dialogue = approved.dialogue.content;
  const creativeControls = normalizeCreativeControls(state.input);
  const timestamp = nowIso(now);
  const handoffId = id("handoff", randomUUID);
  // 对白完整性校验：每个场景都应有对白行，缺行静默出"空对白剧本"会让交付残缺。
  const sceneIds = new Set(asArray(scenes.scenes).map((scene) => text(scene.id, 120)).filter(Boolean));
  const coveredSceneIds = new Set(asArray(dialogue.lines).map((line) => text(line.scene_id, 120)).filter(Boolean));
  const missingScenes = [...sceneIds].filter((sceneId) => !coveredSceneIds.has(sceneId));
  if (missingScenes.length) {
    const error = new Error(`对白未覆盖全部场景：${missingScenes.slice(0, 5).join("、")}${missingScenes.length > 5 ? ` 等 ${missingScenes.length} 个场景` : ""}缺少对白行。请重新生成对白或人工放行后再导出。`);
    error.code = "HANDOFF_INCOMPLETE";
    error.statusCode = 409;
    throw error;
  }
  const storyTitle = text(state.input?.storyTitle || proposal.title_zh || "PixelTale 剧本", 200);
  const script = [
    `# ${storyTitle}`,
    "",
    `模式：${modeLabel(state.mode)}`,
    `对白策略：${creativeControls.dialogueMode}`,
    "",
    `## 故事命题\n${text(proposal.premise_zh || proposal.logline_zh, 4000)}`,
    "",
    "## 人物",
    ...asArray(characters.characters).map((item) => `- ${text(item.name_zh || item.name_en, 100)}：${text(item.arc_zh || item.desire_zh, 500)}`),
    "",
    "## 完整剧本正文",
    ...asArray(approved.arc.content.units).flatMap((unit) => [
      `### 第${text(unit.number, 20)}集｜${text(unit.title_zh, 200)}`,
      `开头暴击：${text(unit.impact_zh, 2000)}`,
      text(unit.plot_zh, 8000),
      ...asArray(scenes.scenes).filter((scene) => Number(scene.unit_number) === Number(unit.number)).flatMap((scene) => [
        `#### ${text(scene.id, 60)}｜${text(scene.location_zh, 200)}`,
        text(scene.action_zh || scene.purpose_zh, 5000),
        ...asArray(dialogue.lines).filter((line) => text(line.scene_id, 80) === text(scene.id, 80)).map((line) => `${text(line.speaker, 100)}: ${text(line.dialogue_en, 1600)}`),
      ]),
      `集尾钩子：${text(unit.hook_zh, 2000)}`,
      `未回答问题：${text(unit.cliffhanger_question_zh, 2000)}`,
      "",
    ]),
    "",
  ].join("\n");
  return {
    id: handoffId,
    schemaVersion: 1,
    projectId: state.projectId,
    project: { id: text(project?.id, 500), title: text(project?.title, 300), episode: text(project?.episode, 100) },
    mode: state.mode,
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    creativeControls,
    market: normalizeMarket(state.input, state.mode),
    stageParticipation: normalizeStageOptions(state.input),
    handoffScope: creativeControls.handoffScope,
    input: state.input,
    storyTitle,
    episodeScale: text(state.input?.episodeScale || state.input?.episodeCount, 100),
    duration: text(state.input?.duration || state.input?.durationValue, 100),
    artifactIds: STAGES.map((stage) => approved[stage].id),
    script,
    assetManifest: { characters: asArray(characters.characters), relationships: asArray(characters.relationships), worldRules: asArray(characters.world_rules) },
    storyboard: { scenes: asArray(scenes.scenes) },
    dialogue: { lines: asArray(dialogue.lines) },
    formalFilesUntouched: true,
    createdAt: timestamp,
  };
}

function confirmArtifact(state, artifact, now, { auto = false } = {}) {
  artifact.status = "approved";
  artifact.updatedAt = nowIso(now);
  if (auto) artifact.autoApproved = true;
  if (!state.approvedArtifactIds.includes(artifact.id)) state.approvedArtifactIds.push(artifact.id);
  // Approving a rerun supersedes every downstream approval: downstream
  // artifacts were built against the previous upstream context and would
  // otherwise silently produce an inconsistent handoff.
  const stageIndex = STAGES.indexOf(artifact.stage);
  state.approvedArtifactIds = state.approvedArtifactIds.filter((id) => {
    const item = state.artifacts.find((candidate) => candidate.id === id);
    return !item || STAGES.indexOf(item.stage) <= stageIndex;
  });
  state.artifacts.forEach((item) => {
    if (item.stage !== artifact.stage && STAGES.indexOf(item.stage) > stageIndex && item.status === "approved") {
      item.status = "needs_review";
    }
  });
  state.stage = nextStage(artifact.stage);
  // 2026-08-09：上游重跑确认 → 下游 unit 阶段已锁定/人工定稿的集标 dirty（不自动改，进复核清单）
  try {
    propagateDirty(state, artifact.stage, `${artifact.stage} 重跑确认，依赖已变更`);
  } catch {
    // 传播失败不影响主流程（dirty 仅提示）
  }
}

// 2026-08-10 根治：场景/对白引入的新角色自动补录进人物名单。
// 此前 characters 阶段只生成主角团，后续阶段模型按剧情需要"自造"角色，
// 规则只能拦截/提示（人物"不存在"）。现在生成后、规则校验前自动补录：
// 引用到的未注册 ID 追加进最新 characters 产物（source=episode_auto_registered），
// 但保留待确认身份，避免占位角色被误当成正式人物设定。
function normalizeAutoRegisteredCharacters(state) {
  let changed = 0;
  asArray(state?.artifacts).forEach((artifact) => {
    if (artifact?.stage !== "characters" || artifact?.type !== "pixeltale_characters") return;
    asArray(artifact.content?.characters).forEach((character) => {
      if (character?.source !== "episode_auto_registered") return;
      if (character.identityStatus !== "pending_confirmation") {
        character.identityStatus = "pending_confirmation";
        changed += 1;
      }
      if (character.requiresConfirmation !== true) {
        character.requiresConfirmation = true;
        changed += 1;
      }
    });
  });
  return changed;
}

function autoRegisterEpisodeCharacters(state, stage, artifactContent, now = () => new Date()) {
  // 纯原生实现（模块级函数不依赖 createPixelTaleAgent 闭包内的 helper）。
  if (!["scenes", "dialogue"].includes(stage)) return 0;
  const artifacts = Array.isArray(state.artifacts) ? state.artifacts : [];
  const charArtifact = artifacts
    .filter((a) => a && a.stage === "characters" && a.type === "pixeltale_characters")
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
  if (!charArtifact) return 0;
  const chars = Array.isArray(charArtifact.content && charArtifact.content.characters) ? charArtifact.content.characters : [];
  const existing = new Set(chars.map((c) => String((c && c.id) || "").trim()).filter(Boolean));
  const referenced = new Set();
  if (stage === "scenes") {
    const scenes = Array.isArray(artifactContent && artifactContent.scenes) ? artifactContent.scenes : [];
    scenes.forEach((scene) => {
      const ids = Array.isArray(scene && scene.characters) ? scene.characters : [];
      ids.forEach((id) => { const v = String(id || "").trim(); if (v) referenced.add(v); });
    });
  } else if (stage === "dialogue") {
    const lines = Array.isArray(artifactContent && artifactContent.lines) ? artifactContent.lines : [];
    lines.forEach((line) => { const v = String(line && line.speaker || "").trim(); if (v) referenced.add(v); });
  }
  const missing = [...referenced].filter((id) => !existing.has(id));
  if (!missing.length) return 0;
  const additions = missing.map((id) => ({
    id,
    name_en: `Episode character ${id}`,
    name_zh: `剧集引入角色 ${id}`,
    role: "supporting",
    source: "episode_auto_registered",
    identityStatus: "pending_confirmation",
    requiresConfirmation: true,
    introduced_in_stage: stage,
    note_zh: "由后续剧集阶段自动补录；如需正式设定（欲望/恐惧/声线），请在人物与世界阶段补充。",
  }));
  charArtifact.content = { ...(charArtifact.content || {}), characters: [...chars, ...additions] };
  charArtifact.updatedAt = new Date(now()).toISOString();
  return additions.length;
}

// 2026-08-10 精准修标题：代号/非中文的 arc 集标题批量改为语义中文标题。
// 只改 units[].title_zh，不触碰剧情字段；下游（scenes/dialogue）无需重跑。
async function fixEpisodeTitles({ state, modelRouter, writer = "gpt-5.6-terra", now = () => new Date() } = {}) {
  const arcArtifact = (state.artifacts || [])
    .filter((a) => a && a.stage === "arc" && a.type === "pixeltale_arc")
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
  if (!arcArtifact) return { fixed: 0, flagged: 0 };
  const units = Array.isArray(arcArtifact.content && arcArtifact.content.units) ? arcArtifact.content.units : [];
  const isBadTitle = (u) => {
    const t = String((u && u.title_zh) || "").trim();
    return !t || !/[\u4e00-\u9fff]/.test(t) || EPISODE_TITLE_CODENAME.test(t);
  };
  const flagged = units.filter(isBadTitle);
  const flaggedCount = flagged.length;
  if (!flaggedCount) return { fixed: 0, flagged: 0 };
  if (!modelRouter) {
    flagged.forEach((u) => { u.title_zh = `第${u.number}集 剧情推进`; });
  } else {
    const system = "你是 PixelTale 编剧助手。根据每集剧情摘要为该集生成一个完整中文短语标题（4-10 字，概括该集核心事件或冲突）。只输出 JSON 数组，不要解释。";
    const user = `请为以下各集生成规范中文标题（每集一个 4-10 字短语，概括核心事件/冲突，禁止英文代号）：\n${flagged.map((u) => `第${u.number}集：${String((u.plot_zh || u.promise_zh || "").slice(0, 120))}`).join("\n")}\n输出 JSON：[{"number":1,"title_zh":"中文标题"}]`;
    try {
      const res = await callProvider({ provider: writer, system, user, modelRouter, maxTokens: 2000, purpose: "pixeltale-fix-titles" });
      const rawContent = typeof res?.content === "string" ? res.content : responseContent(res) || JSON.stringify(res.content || {});
      const content = rawContent;
      // stripJsonFence 只处理 {} 对象，数组 JSON（本接口输出）会丢 []——直接先试 JSON.parse。
      let parsed = null;
      try { parsed = JSON.parse(content); } catch { try { parsed = JSON.parse(stripJsonFence(content)); } catch { parsed = null; } }
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const unit = units.find((u) => Number(u.number) === Number(item && item.number));
          const t = String(item && item.title_zh || "").trim();
          if (unit && t && /[\u4e00-\u9fff]/.test(t) && !EPISODE_TITLE_CODENAME.test(t)) unit.title_zh = t;
        });
      }
    } catch (error) { console.error("[pixeltale] fix-titles model call failed:", error?.message || error); }
  }
  arcArtifact.updatedAt = new Date(now()).toISOString();
  return { fixed: flaggedCount - units.filter(isBadTitle).length, flagged: units.filter(isBadTitle).length };
}

function createPixelTaleAgent(options = {}) {
  const modelRouter = options.modelRouter;
  const now = options.now || (() => new Date());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const readPixelTaleState = options.readPixelTaleState;
  const writePixelTaleState = options.writePixelTaleState;
  const writeHandoffFile = options.writeHandoffFile || (() => "");
  const writeVisualAssetDocument = options.writeVisualAssetDocument;
  const writeScriptDocument = options.writeScriptDocument;
  const onPhase = typeof options.onPhase === "function" ? options.onPhase : () => {};
  if (typeof readPixelTaleState !== "function" || typeof writePixelTaleState !== "function") throw new Error("PixelTale Agent 缺少独立 state adapter");
  if (!modelRouter || typeof modelRouter.call !== "function" || typeof modelRouter.models !== "function") throw new Error("PixelTale Agent 必须使用独立编剧 API 路由");

  function reportPhase(params, phase) {
    try {
      onPhase(params, phase);
    } catch {
      // Phase reporting is observational and must never interrupt generation.
    }
  }

  function availableModels() {
    return asArray(modelRouter.models());
  }

  function stateFor(params) {
    const state = readState({
      ...params,
      stateRoot: params.pixelTaleRoot || params.episodeRoot,
      readPixelTaleState,
      writePixelTaleState,
      now,
    });
    const storedRoutes = state.routes;
    state.routes = normalizeRoutes(storedRoutes, availableModels());
    const normalizedCharacters = normalizeAutoRegisteredCharacters(state);
    // A migrated route must be written back. Migrating only in memory lets the
    // retired model reappear on every subsequent read of the stored session.
    if (routesNeedMigration(storedRoutes) || normalizedCharacters > 0) {
      try {
        persistState(params, state);
      } catch {
        // Never fail a read because the migration write-back failed.
      }
    }
    return state;
  }

  function persistState(params, state) {
    return saveState({
      stateRoot: params.pixelTaleRoot || params.episodeRoot,
      state,
      writePixelTaleState,
    });
  }

  function status(params) {
    const state = stateFor(params);
    return publicState(state, modelRouter);
  }

  async function runUnitStage({ params, state, stage, mode, routes, route, runInput, runId, startedAt, revisionPlan, autoRepairPass = 0, revisionBudget = { used: 0, previousReview: null } }) {
    const totalUnits = plannedUnitCount(runInput);
    const explicitUnits = normalizeUnitNumbers(
      params.unitNumbers || params.input?.unitNumbers || params.input?.revisionUnitNumbers || state.input?.revisionUnitNumbers,
      totalUnits,
    );
    const existingLocked = lockedUnitNumbers(state, stage);
    const lockedTarget = explicitUnits.filter((number) => existingLocked.includes(number));
    const allowLockedUnitRevision = !!revisionPlan && lockedTarget.length > 0;
    if (!totalUnits) {
      const error = new Error("分集与章节需要有效的计划集数，才能建立批次");
      error.code = "UNIT_COUNT_INVALID";
      error.statusCode = 409;
      throw error;
    }
    if (lockedTarget.length && !allowLockedUnitRevision) {
      const error = new Error(`第${lockedTarget.join("、")}集已经锁定；普通重试只能处理未锁定集`);
      error.code = "UNIT_LOCKED";
      error.statusCode = 409;
      throw error;
    }
    const allUnits = [...Array(totalUnits)].map((_, index) => index + 1);
    const targetUnits = explicitUnits.length ? explicitUnits : allUnits.filter((number) => !existingLocked.includes(number));
    if (!targetUnits.length) {
      const existingArtifact = artifactForStage(state, stage) || approvedForStage(state, stage);
      const existingReview = existingArtifact?.reviewId ? state.artifacts.find((artifact) => artifact.id === existingArtifact.reviewId) : null;
      state.input.revisionUnitNumbers = "";
      const record = { runId, stage, mode, route: { primary: route.primary }, status: existingArtifact?.status === "ready" ? "completed" : "needs_review", noOp: true, unitProgress: state.stageProgress[stage], primaryModel: "", reviewModels: [], artifactIds: existingArtifact ? [existingArtifact.id, existingReview?.id].filter(Boolean) : [], errors: [], retryCount: 0, startedAt, completedAt: nowIso(now) };
      state.runs.push(record);
      persistState(params, state);
      return { ...publicRun(record), artifacts: state.artifacts.filter((artifact) => record.artifactIds.includes(artifact.id)).map(publicArtifact), state: publicState(state, modelRouter) };
    }

    const sourceArtifact = artifactForStage(state, stage) || approvedForStage(state, stage);
    const sourceReview = sourceArtifact?.reviewId ? state.artifacts.find((artifact) => artifact.id === sourceArtifact.reviewId) : null;
    let revisionContract = null;
    if (revisionPlan) {
      if (!sourceArtifact || !sourceReview?.content) {
        const error = new Error("当前阶段没有可执行的待修订版本");
        error.code = "REVISION_SOURCE_INVALID";
        error.statusCode = 409;
        throw error;
      }
      revisionContract = buildRevisionContract(sourceReview.content, { stage, sourceArtifactId: sourceArtifact.id, id: `revision_${runId}` });
      if (!revisionContract.items.length) {
        const error = new Error("当前审核没有形成可执行的共识修订项，不能安全开始定向修订");
        error.code = "REVISION_CONTRACT_EMPTY";
        error.statusCode = 409;
        throw error;
      }
    }

    let accumulatedContent = asObject(sourceArtifact?.content);
    if (stage === "arc" && !Array.isArray(accumulatedContent.units)) accumulatedContent = { ...accumulatedContent, units: [] };
    if (stage === "scenes" && !Array.isArray(accumulatedContent.scenes)) accumulatedContent = { ...accumulatedContent, scenes: [] };
    const previousArtifacts = scopedPreviousArtifacts(STAGES.map((item) => approvedForStage(state, item)).filter(Boolean), targetUnits);
    const reviewPolicy = stageReviewPolicy(stage, { revisionContract });
    const batches = splitUnitBatches(targetUnits);
    const batchReviews = [];
    const completedArtifactIds = [];
    const errors = [];
    let retryCount = 0;
    let lastPrimary = null;
    let lastReview = null;
    let continuityCarry = [];
    const continuityBatches = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batchUnits = batches[batchIndex];
      const batchId = `${runId}_batch_${batchIndex + 1}`;
      const batchStartedAt = nowIso(now);
      const batchInput = {
        ...runInput,
        ...stageBatchInput({ stage, totalUnits, unitScope: batchUnits, lockedUnits: lockedUnitNumbers(state, stage), allowLockedUnitRevision }),
        unitCount: totalUnits,
      };
      const continuityContext = [...stageBatchContext({ ...state, input: batchInput }, stage, batchUnits), ...continuityCarry].slice(-12);
      updateUnitStageProgress(state, stage, totalUnits, { batchId, units: batchUnits, status: "running", startedAt: batchStartedAt });
      state.updatedAt = nowIso(now);
      persistState(params, state);
      try {
        const previousProgress = normalizeUnitProgress(state.stageProgress?.[stage]);
        const previousBatch = previousProgress.batches
          .filter((entry) => entry.status === "needs_review"
            && entry.units.length === batchUnits.length
            && entry.units.every((number, index) => number === batchUnits[index])
            && entry.artifactId)
          .at(-1);
        const previousArtifact = previousBatch ? state.artifacts.find((artifact) => artifact.id === previousBatch.artifactId && artifact.stage === stage) : null;
        const previousBatchContent = previousArtifact ? unitStageContent(stage, previousArtifact.content, batchUnits) : null;
        const canReuseFailedBatch = !revisionContract
          && previousArtifact
          && unitNumbersForContent(stage, previousBatchContent).length === batchUnits.length;
        let primary;
        let batchContent;
        let mergedContent;
        if (canReuseFailedBatch) {
          const recoveryContent = stage === "arc" && !text(previousBatchContent.arc_summary_zh, 2000)
            ? { ...previousBatchContent, arc_summary_zh: text(accumulatedContent.arc_summary_zh || sourceArtifact?.content?.arc_summary_zh || "本季故事围绕核心冲突持续推进，并在每集结尾留下下一集追问。", 2000) }
            : previousBatchContent;
          batchContent = validateContent(stage, recoveryContent, { ...batchInput, unitScope: batchUnits, lockedUnitNumbers: lockedUnitNumbers(state, stage), allowLockedUnitRevision });
          mergedContent = mergeStageBatchContent(stage, accumulatedContent, batchContent, { unitNumbers: batchUnits, state, allowLockedUnitRevision });
          primary = {
            provider: "recovery",
            model: text(previousArtifact.model, 200) || route.primary,
            attempts: 0,
            reused: true,
            primaryExecution: previousArtifact.primaryExecution || { role: "主笔", actualModel: text(previousArtifact.model, 200) || route.primary, provider: "recovery" },
          };
        } else {
          const system = stageSystemPrompt(stage, mode, batchInput);
          const batchSourceArtifact = sourceArtifact ? { ...sourceArtifact, content: unitStageContent(stage, accumulatedContent, batchUnits) } : { id: "", version: 0, content: unitStageContent(stage, accumulatedContent, batchUnits) };
          const user = revisionContract
            ? revisionUserPrompt({ stage, mode, input: batchInput, previousArtifacts, project: params.project, baseArtifact: batchSourceArtifact, revisionContract, revisionPlan, unitScope: batchUnits, lockedContext: lockedUnitContext(state, stage, batchUnits), continuityContext })
            : stageUserPrompt({ stage, mode, input: batchInput, previousArtifacts, project: params.project, unitScope: batchUnits, lockedContext: lockedUnitContext(state, stage, batchUnits), continuityContext });
          primary = await callStagePrimary({
            route,
            stage,
            mode,
            system,
            user,
            modelRouter,
            onPhase: (phase) => reportPhase(params, phase),
            validateContribution: (content) => {
              const rawContent = asObject(content);
              const candidateContent = stage === "arc" && !text(rawContent.arc_summary_zh, 2000)
                ? { ...rawContent, arc_summary_zh: text(accumulatedContent.arc_summary_zh || sourceArtifact?.content?.arc_summary_zh || "本季故事围绕核心冲突持续推进，并在每集结尾留下下一集追问。", 2000) }
                : rawContent;
              return validateContent(stage, candidateContent, { ...batchInput, unitScope: batchUnits, lockedUnitNumbers: lockedUnitNumbers(state, stage), allowLockedUnitRevision });
            },
          });
          retryCount += primary.attempts || 0;
          revisionBudget.used += Number(primary.tokenUsageTotal || 0);
          const rawContent = asObject(primary.content);
          const candidateContent = stage === "arc" && !text(rawContent.arc_summary_zh, 2000)
            ? { ...rawContent, arc_summary_zh: text(accumulatedContent.arc_summary_zh || sourceArtifact?.content?.arc_summary_zh || "本季故事围绕核心冲突持续推进，并在每集结尾留下下一集追问。", 2000) }
            : rawContent;
          batchContent = validateContent(stage, candidateContent, { ...batchInput, unitScope: batchUnits, lockedUnitNumbers: lockedUnitNumbers(state, stage), allowLockedUnitRevision });
          mergedContent = mergeStageBatchContent(stage, accumulatedContent, batchContent, { unitNumbers: batchUnits, state, allowLockedUnitRevision });
        }
        const version = state.artifacts.filter((artifact) => artifact.stage === stage && artifact.type === `pixeltale_${stage}`).length + 1;
        const primaryArtifact = buildArtifact({ stage, mode, input: batchInput, content: mergedContent, model: `${primary.provider}:${primary.model}`, version, now, randomUUID });
        if (primary.primaryExecution) primaryArtifact.primaryExecution = primary.primaryExecution;
        if (primary.reused) primaryArtifact.recovery = { sourceArtifactId: previousArtifact.id, owner: "审核恢复", authorModelSkipped: true };
        if (revisionContract) primaryArtifact.revision = { sourceArtifactId: sourceArtifact?.id || "", contractId: revisionContract.id, itemCount: revisionContract.items.length, unitNumbers: batchUnits, owner: "本阶段主创" };
        const reviewTarget = { ...primaryArtifact, content: unitStageContent(stage, batchContent, batchUnits) };
        autoRegisterEpisodeCharacters(state, stage, reviewTarget.content, now);
        reportPhase(params, "validating");
        const ruleContext = {
          ...batchInput,
          input: batchInput,
          artifacts: previousArtifacts,
          cumulativeArtifact: { stage, content: mergedContent },
          unitBatches: [...continuityBatches, { id: batchId, units: batchUnits }],
        };
        const ruleResult = runStageRules({ stage, mode, artifact: reviewTarget.content, approvedContext: ruleContext, lockedPaths: lockedUnitContext(state, stage, batchUnits) });
        const highRuleViolations = ruleResult.violations.filter((item) => item.severity === "high");
        const reviewRoutes = highRuleViolations.length ? [] : modelRouter.reviewModels(route).slice(0, reviewPolicy.requiredSeats);
        reportPhase(params, "reviewing");
        const reviews = await collectCrossReviewQuorum({ reviewRoutes, revisionContract, execute: async (reviewRoute, signal) => {
          const reviewModel = reviewRoute.model || reviewRoute;
          const role = reviewRoute.role || "";
          const roleDescription = reviewerIdentity(role);
          const reviewCandidates = uniqueText([reviewModel, ...asArray(reviewRoute.fallbackModels)], 2);
          let lastError;
          let lastAttempted = reviewModel;
          for (const candidate of reviewCandidates) {
            lastAttempted = candidate;
            try {
              const result = await callProvider({
                provider: candidate,
                system: `${reviewSystemPrompt(stage, mode, batchInput)}\n本次固定身份：${roleDescription}`,
                user: reviewUserPrompt({ stage, mode, input: batchInput, artifact: reviewTarget, previousArtifacts, revisionContract, unitScope: batchUnits, lockedContext: lockedUnitContext(state, stage, batchUnits), continuityContext, ruleFindings: ruleResult.violations }),
                modelRouter,
                timeoutMs: REVIEW_MODEL_TIMEOUT_MS,
                maxTokens: reviewTokenBudget(stage, candidate),
                purpose: `pixeltale:${stage}:review`,
                temperature: 0.2,
                signal,
              });
              revisionBudget.used += tokenUsage(result);
              const content = validateReview(result.content, { requireDimensions: true, revisionContract });
              retryCount += result.attempts || 0;
              return { route: reviewRoute, selectedModel: reviewModel, role, result: { ...result, content, actualModel: candidate, fallbackUsed: candidate !== reviewModel } };
            } catch (error) {
              lastError = error;
              retryCount += 1;
              if (!canFallbackFrom(error)) break;
            }
          }
          // Name the model that actually failed. Using the last candidate reported
          // "grok-4.5: deepseek truncated" for a seat where grok was never called.
          return { route: reviewRoute, model: lastAttempted || reviewModel, selectedModel: reviewModel, role, error: lastError?.message || "审核模型请求失败", errorCode: lastError?.code || "NETWORK_ERROR" };
        } });
        reviews.filter((item) => !item.result).forEach((item) => errors.push({ code: "CROSS_REVIEW_FAILED", message: `${item.model}：${item.error}` }));
        reportPhase(params, "refereeing");
        const effectiveReviewPolicy = { ...reviewPolicy, heterogeneityAvailable: !reviewRoutes.every((reviewRoute) => reviewRoute.heterogeneous === false) };
        const consensus = highRuleViolations.length ? ruleBlockedReview(ruleResult) : { ...aggregateCrossReview(reviews, revisionContract, effectiveReviewPolicy), ruleFindings: ruleResult.violations };
        if (consensus.revision) consensus.revision.owner = "本阶段主创";
        const reviewArtifact = buildReviewArtifact({ stage, review: consensus, model: `cross-review:${reviews.map((item) => item.result?.model || item.model).join(",")}`, version, now, randomUUID, primaryArtifactId: primaryArtifact.id });
        primaryArtifact.status = consensus.pass ? "ready" : "needs_review";
        primaryArtifact.reviewId = reviewArtifact.id;
        state.artifacts.push(primaryArtifact, reviewArtifact);
        lastPrimary = primaryArtifact;
        lastReview = reviewArtifact;
        completedArtifactIds.push(primaryArtifact.id, reviewArtifact.id);
        batchReviews.push({ ...consensus, batchId, units: batchUnits });
        if (consensus.pass) {
          lockStageUnits(state, stage, mergedContent, batchUnits, primaryArtifact, now);
          updateUnitStageProgress(state, stage, totalUnits, { batchId, units: batchUnits, status: "completed", artifactId: primaryArtifact.id, reviewId: reviewArtifact.id, startedAt: batchStartedAt, completedAt: nowIso(now) });
        } else {
          updateUnitStageProgress(state, stage, totalUnits, { batchId, units: batchUnits, status: "needs_review", artifactId: primaryArtifact.id, reviewId: reviewArtifact.id, error: "该批次交叉审核未通过", startedAt: batchStartedAt, completedAt: nowIso(now) });
        }
        // 审核失败只阻止锁定当前批次；其产物仍作为临时连续性上下文，保证一次运行可以继续生成后续批次。
        accumulatedContent = mergedContent;
        continuityCarry = transientUnitContext(stage, batchContent, batchUnits).slice(-EPISODE_BATCH_SIZE);
        continuityBatches.push({ id: batchId, units: batchUnits });
        state.updatedAt = nowIso(now);
        persistState(params, state);
      } catch (error) {
        errors.push({ code: error.code || "RUN_FAILED", message: error.message });
        const canAutoSplit = batchUnits.length > 1 && (error.splitSafe === true || ["STAGE_TIMEOUT_BUDGET_EXHAUSTED", "SCHEMA_INVALID"].includes(error.code));
        if (canAutoSplit) {
          const smallerSize = Math.max(1, Math.ceil(batchUnits.length / 2));
          const smallerBatches = splitUnitBatches(batchUnits, smallerSize);
          updateUnitStageProgress(state, stage, totalUnits, { batchId, units: batchUnits, status: "retrying_smaller", error: `${error.message}；已自动拆分为 ${smallerBatches.length} 个小批次重试`, startedAt: batchStartedAt, completedAt: nowIso(now) });
          batches.splice(batchIndex, 1, ...smallerBatches);
          state.updatedAt = nowIso(now);
          persistState(params, state);
          batchIndex -= 1;
          continue;
        }
        updateUnitStageProgress(state, stage, totalUnits, { batchId, units: batchUnits, status: "failed", error: error.message, startedAt: batchStartedAt, completedAt: nowIso(now) });
        state.updatedAt = nowIso(now);
        persistState(params, state);
        const record = { runId, stage, mode, route, status: "failed", unitProgress: state.stageProgress[stage], primaryModel: "", reviewModels: [], revision: revisionPlan ? { sourceArtifactId: sourceArtifact?.id || "", contractId: revisionContract?.id || "", itemCount: revisionContract?.items.length || 0, unitNumbers: batchUnits, plan: text(revisionPlan, 14000), allResolved: false } : null, artifactIds: completedArtifactIds, errors, retryCount, startedAt, completedAt: nowIso(now) };
        state.runs.push(record);
        persistState(params, state);
        return { ...publicRun(record), artifacts: state.artifacts.filter((artifact) => record.artifactIds.includes(artifact.id)).map(publicArtifact), state: publicState(state, modelRouter) };
      }
    }

    const finalReview = synthesizeBatchReview(stage, batchReviews, totalUnits, state.unitLocks[stage], revisionContract);
    if (revisionContract) finalReview.revision = { contract: revisionContract, closure: { required: true, allResolved: finalReview.basePass, items: revisionContract.items.map((item) => ({ ...item, status: finalReview.basePass ? "resolved" : "unresolved", evidence: finalReview.basePass ? "所有目标批次均完成规定审核席位审读并关闭硬性问题" : "存在未完成基础审核条件的批次", remainingFix: finalReview.basePass ? "" : "按未通过批次重新修订" })) } };
    let repairPlan = "";
    let autoRepairEligible = false;
    if (!finalReview.pass && !revisionPlan && autoRepairPass < UNIT_AUTO_REPAIR_MAX_PASSES && targetUnits.length) {
      autoRepairEligible = true;
      repairPlan = automaticUnitRepairPlan(stage, finalReview, targetUnits);
      // 2026-08-10 P1-2：停止原因细分（文档 §7.3）。
      // stalled = 同一问题签名重叠 ≥80%（连续两轮未收敛）；
      // new_high_risk = 修订引入了不在上一轮合同中的高风险问题（越修越坏防扩散）；
      // budget_exhausted = 累计 token 超预算。
      const stalled = stalledRevision(revisionBudget.previousReview, finalReview);
      const prevHighSigs = new Set(asArray(revisionBudget.previousReview?.mandatoryIssues)
        .map((i) => `${text(i.criterionId || i.tag, 180)}:${text(i.fieldPath, 300)}`));
      const newHighRisk = Boolean(revisionBudget.previousReview
        && asArray(finalReview.mandatoryIssues).some((i) => i.severity === "high"
          && !prevHighSigs.has(`${text(i.criterionId || i.tag, 180)}:${text(i.fieldPath, 300)}`)));
      const technicalStatus = revisionBudget.used > AUTO_REPAIR_TOKEN_BUDGET
        ? "budget_exhausted"
        : stalled ? "stalled"
          : newHighRisk ? "new_high_risk" : "";
      if (technicalStatus) {
        const message = technicalStatus === "stalled"
          ? "自动修订未收敛：同一问题连续出现（签名重叠≥80%），已停止自动改稿，请查看证据后决定下一步"
          : technicalStatus === "new_high_risk"
            ? "修订引入了新的高风险问题（不在上一轮合同内），已停止自动改稿以防越修越坏，请人工决定"
            : "自动修订累计 token 超出阶段预算，已转人工交接";
        finalReview.technicalFailures = [{ status: technicalStatus, message }];
        repairPlan = "";
        autoRepairEligible = false;
      }
    }
    const finalReviewArtifact = buildReviewArtifact({ stage, review: finalReview, model: "batch-cross-review", version: Number(lastPrimary?.version || 1), now, randomUUID, primaryArtifactId: lastPrimary?.id || "" });
    if (lastPrimary) {
      lastPrimary.status = finalReview.pass ? "ready" : "needs_review";
      lastPrimary.reviewId = finalReviewArtifact.id;
    }
    state.artifacts.push(finalReviewArtifact);
    if (explicitUnits.length) state.input.revisionUnitNumbers = "";
    // 自动放行：多数通过 + 意见一致≥90% → 自动确认并进入下一步（无需人工 approve）。
    // 仅在全部目标批通过（finalReview.pass）时触发；分歧席已记录在 disagreements。
    if (lastPrimary && finalReview.pass && Number(finalReview.agreement) >= AUTO_APPROVE_AGREEMENT) {
      confirmArtifact(state, lastPrimary, now, { auto: true });
    }
    state.updatedAt = nowIso(now);
    persistState(params, state);
    if (autoRepairEligible) {
      // A failed batch used to end the whole request here, forcing the user
      // to click again. Re-enter the same unit runner once so a failed review
      // can be retried or repaired without resubmitting locks.
      const repairPlan = automaticUnitRepairPlan(stage, finalReview, targetUnits);
      return await runUnitStage({
        params: { ...params, revisionPlan: repairPlan },
        state,
        stage,
        mode,
        routes,
        route,
        runInput,
        runId: `${runId}_auto_${autoRepairPass + 1}`,
        startedAt,
        revisionPlan: repairPlan,
        autoRepairPass: autoRepairPass + 1,
        revisionBudget: { used: revisionBudget.used, previousReview: finalReview },
      });
    }
    const record = { runId, stage, mode, route, status: finalReview.pass ? "completed" : "needs_review", unitProgress: state.stageProgress[stage], primaryModel: lastPrimary?.model || "", reviewModels: [], creativeCouncil: lastPrimary?.creativeCouncil || null, consensusIndex: finalReview.consensusIndex, agreement: finalReview.agreement, reviewCompletion: finalReview.reviewCompletion, revision: revisionPlan ? { sourceArtifactId: sourceArtifact?.id || "", contractId: revisionContract?.id || "", itemCount: revisionContract?.items.length || 0, unitNumbers: targetUnits, plan: text(revisionPlan, 14000), allResolved: finalReview.revision?.closure?.allResolved === true } : null, artifactIds: [...completedArtifactIds, finalReviewArtifact.id], errors, retryCount, startedAt, completedAt: nowIso(now) };
    state.runs.push(record);
    persistState(params, state);
    return { ...publicRun(record), artifacts: state.artifacts.filter((artifact) => record.artifactIds.includes(artifact.id)).map(publicArtifact), state: publicState(state, modelRouter) };
  }

  async function run(params = {}) {
    const projectId = text(params.projectId, 500);
    const stage = normalizeStage(params.stage);
    const state = stateFor({ ...params, projectId, mode: params.mode || params.input?.mode });
    const mode = normalizeMode(params.mode || params.input?.mode || state.mode);
    const routes = params.routes ? normalizeRoutes(params.routes, availableModels()) : normalizeRoutes(state.routes, availableModels());
    const revisionPlan = text(params.revisionPlan, 14000);
    state.mode = mode;
    state.routes = routes;
    // Keep the active editor stage stable while a run is in progress. Approval still controls workflow advancement.
    state.stage = stage;
    state.input = {
      ...asObject(state.input),
      ...asObject(params.input),
      mode,
      audienceGender: normalizeAudience({ ...asObject(state.input), ...asObject(params.input) }),
      ...normalizeCreativeControls({ ...asObject(state.input), ...asObject(params.input) }),
      ...normalizeMarket({ ...asObject(state.input), ...asObject(params.input) }, mode),
      ...normalizeStageOptions({ ...asObject(state.input), ...asObject(params.input) }),
    };
    const runInput = revisionPlan
      ? {
        ...state.input,
        stageGuidance: {
          ...asObject(state.input.stageGuidance),
          [stage]: revisionPlan,
        },
      }
      : state.input;
    state.updatedAt = nowIso(now);
    const startedAt = nowIso(now);
    const runId = id("run", randomUUID);
    const route = stageRoute(stage, mode, routes, availableModels());
    const previousArtifacts = STAGES.map((item) => approvedForStage(state, item)).filter(Boolean);
    const revisionBase = revisionPlan ? artifactForStage(state, stage) : null;
    const sourceReview = revisionBase?.reviewId ? state.artifacts.find((artifact) => artifact.id === revisionBase.reviewId) : null;
    const reviewRetryArtifact = !revisionPlan && stage !== "title" ? artifactForStage(state, stage) : null;
    const reviewRetry = reviewRetryArtifact?.reviewId ? state.artifacts.find((artifact) => artifact.id === reviewRetryArtifact.reviewId) : null;
    const reuseReviewArtifact = reviewRetryArtifact?.status === "needs_review" && isRetryableReviewFailure(reviewRetry?.content);
    const errors = [];
    let retryCount = 0;
    let primary;
    let reviews = [];
    let consensus;
    let reviewRoutes = [];
    let primaryArtifact;
    let reviewArtifact;
    let revisionContract = null;
    try {
      const requiredStage = nextRequiredStage(state);
      const requestedIndex = STAGES.indexOf(stage);
      const requiredIndex = STAGES.indexOf(requiredStage);
      if (requiredStage !== "handoff" && requestedIndex > requiredIndex) {
        const error = new Error(`请先完成“${requiredStage}”阶段，再生成“${stage}”阶段`);
        error.code = "STAGE_OUT_OF_ORDER";
        error.statusCode = 409;
        throw error;
      }
      const approvedVersion = approvedForStage(state, stage);
      if (approvedVersion && !revisionPlan && params.override !== true) {
        // 已确认阶段重跑需显式 override；但 unit 阶段若全部集已锁定，
        // 重复提交应为无害 noOp（全锁定时不调模型），而不是 409 拦截。
        const allUnitsLocked = UNIT_STAGES.has(stage)
          && lockedUnitNumbers(state, stage).length >= (plannedUnitCount(state.input) || 0);
        if (!allUnitsLocked) {
          const error = new Error(`“${STAGE_LABELS[stage] || stage}”已有已确认版本 v${approvedVersion.version || 0}，重新生成会使下游已确认内容失效；如确认继续请重试（override）`);
          error.code = "STAGE_RERUN_REQUIRES_OVERRIDE";
          error.statusCode = 409;
          throw error;
        }
      }
      if (!text(params.input?.idea || params.input?.coreConflict || (stage !== "brief" ? "context" : ""), 6000)) {
        const error = new Error("创作规格需要一个可识别的核心冲突");
        error.code = "INPUT_INVALID";
        throw error;
      }
      if (UNIT_STAGES.has(stage)) {
        return await runUnitStage({ params, state, stage, mode, routes, route, runInput, runId, startedAt, revisionPlan });
      }
      if (revisionPlan) {
        if (!revisionBase || revisionBase.status !== "needs_review" || !sourceReview?.content) {
          const error = new Error("当前阶段没有可执行的待修订版本");
          error.code = "REVISION_SOURCE_INVALID";
          throw error;
        }
        revisionContract = buildRevisionContract(sourceReview.content, {
          stage,
          sourceArtifactId: revisionBase.id,
          id: `revision_${runId}`,
        });
        if (!revisionContract.items.length) {
          const error = new Error("当前审核没有形成二模型共识修订项，不能安全开始定向修订；请重新生成并审核");
          error.code = "REVISION_CONTRACT_EMPTY";
          throw error;
        }
      }
      const reviewPolicy = stageReviewPolicy(stage, { revisionContract });
      const excludedTitles = stage === "title"
        ? state.artifacts.filter((artifact) => artifact.stage === "title" && artifact.type === "pixeltale_title").flatMap((artifact) => asArray(artifact.content?.candidates).map((candidate) => candidate?.title_en || candidate?.title_zh))
        : [];
      if (reuseReviewArtifact) {
        primaryArtifact = reviewRetryArtifact;
        primary = {
          provider: "recovery",
          model: text(primaryArtifact.model, 200) || route.primary,
          attempts: 0,
          reused: true,
          primaryExecution: primaryArtifact.primaryExecution || { role: "主笔", actualModel: text(primaryArtifact.model, 200) || route.primary, provider: "recovery" },
        };
      } else {
        const system = stageSystemPrompt(stage, mode, runInput);
        const user = revisionContract
          ? revisionUserPrompt({ stage, mode, input: runInput, previousArtifacts, project: params.project, baseArtifact: revisionBase, revisionContract, revisionPlan })
          : stageUserPrompt({ stage, mode, input: runInput, previousArtifacts, project: params.project, excludedTitles });
        if (stage === "title") reportPhase(params, "authoring");
        primary = stage === "title"
          ? await callProvider({
            provider: route.primary,
            system,
            user,
            modelRouter,
            timeoutMs: stagePrimaryTiming("title").model,
            maxTokens: STAGE_OUTPUT_TOKEN_BUDGETS.title,
            purpose: "pixeltale:title:author",
          })
          : await callStagePrimary({
            onPhase: (phase) => reportPhase(params, phase),
            route,
            stage,
            mode,
            system,
            user,
            modelRouter,
            validateContribution: (content) => validateContent(stage, content, { ...runInput, mode, excludedTitles }),
          });
        retryCount += primary.attempts || 0;
        const content = validateContent(
          stage,
          revisionPlan ? mergeRevisionContent(stage, primary.content, revisionBase?.content) : primary.content,
          { ...runInput, mode, excludedTitles },
        );
        const version = state.artifacts.filter((artifact) => artifact.stage === stage && artifact.type === `pixeltale_${stage}`).length + 1;
        primaryArtifact = buildArtifact({ stage, mode, input: runInput, content, model: `${primary.provider}:${primary.model}`, version, now, randomUUID });
        if (primary.primaryExecution) primaryArtifact.primaryExecution = primary.primaryExecution;
      }
      const version = Number(primaryArtifact.version || 1);
      if (stage === "title") {
        primaryArtifact.status = "ready";
        primaryArtifact.reviewId = "";
        state.artifacts.push(primaryArtifact);
        const record = { runId, stage, mode, route: { primary: route.primary }, status: "completed", primaryModel: `${primary.provider}:${primary.model}`, reviewModels: [], primaryFallback: null, consensusIndex: null, agreement: null, reviewCompletion: null, revision: null, artifactIds: [primaryArtifact.id], errors, retryCount, startedAt, completedAt: nowIso(now) };
        state.runs.push(record);
        persistState(params, state);
        return { ...publicRun(record), artifacts: [primaryArtifact].map(publicArtifact), state: publicState(state, modelRouter) };
      }
      if (revisionContract) {
        primaryArtifact.revision = {
          sourceArtifactId: revisionBase.id,
          contractId: revisionContract.id,
          itemCount: revisionContract.items.length,
          owner: "本阶段主创",
        };
      }
      reportPhase(params, "validating");
      autoRegisterEpisodeCharacters(state, stage, primaryArtifact.content, now);
      const ruleResult = runStageRules({ stage, mode, artifact: primaryArtifact.content, approvedContext: { ...runInput, input: runInput, artifacts: previousArtifacts }, lockedPaths: [] });
      const highRuleViolations = ruleResult.violations.filter((item) => item.severity === "high");
      reviewRoutes = highRuleViolations.length ? [] : modelRouter.reviewModels(route).slice(0, reviewPolicy.requiredSeats);
      reportPhase(params, "reviewing");
      reviews = await collectCrossReviewQuorum({ reviewRoutes, revisionContract, execute: async (reviewRoute, signal) => {
        const reviewModel = reviewRoute.model || reviewRoute;
        const role = reviewRoute.role || "";
        const roleDescription = reviewerIdentity(role);
        const reviewCandidates = uniqueText([reviewModel, ...asArray(reviewRoute.fallbackModels)], 2);
        let lastError;
        let lastAttempted = reviewModel;
        for (const candidate of reviewCandidates) {
          lastAttempted = candidate;
          try {
            const result = await callProvider({
              provider: candidate,
              system: `${reviewSystemPrompt(stage, mode, runInput)}\n本次固定身份：${roleDescription}`,
              user: reviewUserPrompt({ stage, mode, input: runInput, artifact: primaryArtifact, previousArtifacts, revisionContract, ruleFindings: ruleResult.violations }),
              modelRouter,
              timeoutMs: REVIEW_MODEL_TIMEOUT_MS,
              maxTokens: reviewTokenBudget(stage, candidate),
              purpose: `pixeltale:${stage}:review`,
              temperature: 0.2,
              signal,
            });
            const content = validateReview(result.content, { requireDimensions: true, revisionContract });
            retryCount += result.attempts || 0;
            return { route: reviewRoute, selectedModel: reviewModel, role, result: { ...result, content, actualModel: candidate, fallbackUsed: candidate !== reviewModel } };
          } catch (error) {
            lastError = error;
            retryCount += 1;
            if (!canFallbackFrom(error)) break;
          }
        }
        // Name the model that actually failed. Using the last candidate reported
          // "grok-4.5: deepseek truncated" for a seat where grok was never called.
          return { route: reviewRoute, model: lastAttempted || reviewModel, selectedModel: reviewModel, role, error: lastError?.message || "审核模型请求失败", errorCode: lastError?.code || "NETWORK_ERROR" };
      } });
      reviews.filter((item) => !item.result).forEach((item) => errors.push({ code: "CROSS_REVIEW_FAILED", message: `${item.model}：${item.error}` }));
      reportPhase(params, "refereeing");
      const effectiveReviewPolicy = { ...reviewPolicy, heterogeneityAvailable: !reviewRoutes.every((reviewRoute) => reviewRoute.heterogeneous === false) };
      consensus = highRuleViolations.length ? ruleBlockedReview(ruleResult) : { ...aggregateCrossReview(reviews, revisionContract, effectiveReviewPolicy), ruleFindings: ruleResult.violations };
      if (consensus.revision) consensus.revision.owner = "本阶段主创";
      reviewArtifact = buildReviewArtifact({ stage, review: consensus, model: `cross-review:${reviews.map((item) => item.result?.model || item.model).join(",")}`, version, now, randomUUID, primaryArtifactId: primaryArtifact.id });
      primaryArtifact.status = consensus.pass ? "ready" : "needs_review";
      primaryArtifact.reviewId = reviewArtifact.id;
      if (!state.artifacts.some((artifact) => artifact.id === primaryArtifact.id)) state.artifacts.push(primaryArtifact);
      state.artifacts.push(reviewArtifact);
      // 自动放行：多数通过 + 意见一致≥90% → 自动确认并进入下一步（title 由人工选题，不放行）
      if (consensus.pass && Number(consensus.agreement) >= AUTO_APPROVE_AGREEMENT && stage !== "title") {
        confirmArtifact(state, primaryArtifact, now, { auto: true });
      }
      const runStatus = consensus.pass ? "completed" : "needs_review";
      const record = { runId, stage, mode, route: { ...route, crossReview: reviewRoutes.map((item) => item.model || item) }, status: runStatus, primaryModel: `${primary.provider}:${primary.model}`, reviewModels: reviews.map((item) => item.result ? `${item.result.provider}:${item.result.model}` : `${providerForRoute(item.model)}:${item.model}`), creativeCouncil: primary.creativeCouncil || null, consensusIndex: consensus.consensusIndex, agreement: consensus.agreement, reviewCompletion: consensus.reviewCompletion, revision: revisionPlan ? { sourceArtifactId: revisionBase?.id || "", contractId: revisionContract?.id || "", itemCount: revisionContract?.items.length || 0, plan: text(revisionPlan, 14000), allResolved: consensus.revision?.closure?.allResolved === true } : null, artifactIds: [primaryArtifact.id, reviewArtifact.id], errors, retryCount, startedAt, completedAt: nowIso(now) };
      state.runs.push(record);
      persistState(params, state);
      return { ...publicRun(record), artifacts: [primaryArtifact, reviewArtifact].map(publicArtifact), state: publicState(state, modelRouter) };
    } catch (error) {
      errors.push({ code: error.code || "RUN_FAILED", message: error.message });
      if (primaryArtifact && !state.artifacts.some((artifact) => artifact.id === primaryArtifact.id)) state.artifacts.push(primaryArtifact);
      const fallbackReviewModels = stage === "title" ? [] : (reviewRoutes.length ? reviewRoutes : [route.reviewer]);
      const record = { runId, stage, mode, route: stage === "title" ? { primary: route.primary } : route, status: "failed", primaryModel: primary ? `${primary.provider}:${primary.model}` : modelForRoute(route.primary), reviewModels: fallbackReviewModels.map((item) => `${item.provider || providerForRoute(item.model || item)}:${modelForRoute(item.model || item)}`), creativeCouncil: primary?.creativeCouncil || error?.creativeCouncil || null, creativeCouncilFailures: error?.fallbackFailures || [], revision: revisionPlan ? { sourceArtifactId: revisionBase?.id || "", contractId: revisionContract?.id || "", itemCount: revisionContract?.items.length || 0, plan: text(revisionPlan, 14000), allResolved: false } : null, artifactIds: primaryArtifact ? [primaryArtifact.id] : [], errors, retryCount, startedAt, completedAt: nowIso(now) };
      state.runs.push(record);
      state.updatedAt = nowIso(now);
      persistState(params, state);
      return { ...publicRun(record), artifacts: primaryArtifact ? [primaryArtifact].map(publicArtifact) : [], state: publicState(state, modelRouter) };
    }
  }

  function decideAdvisory(params = {}) {
    const state = stateFor(params);
    const reviewId = text(params.reviewId, 200);
    const advisoryId = text(params.advisoryId, 200);
    const status = text(params.status, 40).toLowerCase();
    const reason = text(params.reason, 1600);
    const review = state.artifacts.find((item) => item.id === reviewId && item.type === "pixeltale_stage_review");
    if (!review) {
      const error = new Error("审核产物不存在，无法处理建议");
      error.code = "REVIEW_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    if (!["accepted", "ignored", "needs_human_review"].includes(status)) {
      const error = new Error("建议处理状态无效");
      error.code = "ADVISORY_DECISION_INVALID";
      error.statusCode = 400;
      throw error;
    }
    const item = reviewAdvisoryItems(review.content).find((entry) => entry.id === advisoryId);
    if (!item) {
      const error = new Error("审核建议不存在或已过期");
      error.code = "ADVISORY_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    if ((status === "ignored" || (status === "accepted" && item.kind === "conflict")) && reason.length < 2) {
      const error = new Error(status === "ignored" ? "忽略建议必须填写理由" : "将模型分歧转为修订必须写明处理方向");
      error.code = "ADVISORY_REASON_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    const decision = {
      id: item.id,
      status,
      reason,
      item: {
        id: item.id,
        kind: item.kind,
        tag: text(item.tag, 160),
        dimension: text(item.dimension, 40) || "logic",
        severity: text(item.severity, 20) || "medium",
        modelCount: Number(item.modelCount) || 1,
        models: asArray(item.models).map((model) => text(model, 160)).filter(Boolean),
        suggestions: asArray(item.suggestions).map((suggestion) => text(suggestion, 1200)).filter(Boolean),
        evidence: asArray(item.evidence).map((evidence) => text(evidence, 1200)).filter(Boolean),
      },
      decidedAt: nowIso(now),
    };
    const decisions = asArray(review.content?.advisoryDecisions).filter((entry) => entry?.id !== item.id);
    review.content = { ...asObject(review.content), advisoryDecisions: [...decisions, decision] };
    review.updatedAt = nowIso(now);
    const sourceArtifact = state.artifacts.find((artifact) => artifact.reviewId === review.id);
    if (sourceArtifact) {
      const gate = reviewAdvisoryGate(review.content);
      const basePass = review.content.basePass === true;
      const resolvedPass = basePass && !gate.accepted.length && !gate.blockingPending.length;
      review.content = { ...review.content, pass: resolvedPass, releaseResolved: resolvedPass };
      sourceArtifact.status = resolvedPass ? "ready" : "needs_review";
      sourceArtifact.updatedAt = nowIso(now);
    }
    state.updatedAt = nowIso(now);
    persistState(params, state);
    return { review: publicArtifact(review), state: publicState(state, modelRouter) };
  }

function approve(params = {}) {
    const state = stateFor(params);
    const artifactId = text(params.artifactId, 200);
    const artifact = state.artifacts.find((item) => item.id === artifactId);
    // 人工放行：接受当前版本继续，跳过审核闸（仅锁定与推进状态仍执行）。
    // 用于修订轮数耗尽或 stalled 后，用户确认"接受现状"打破死循环。
    const humanOverride = params.humanOverride === true;
    if (!artifact || !STAGES.includes(artifact.stage) || !artifact.type.startsWith("pixeltale_")) {
      const error = new Error("PixelTale 产物不存在");
      error.code = "ARTIFACT_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    const requiredStage = nextRequiredStage(state);
    if (artifact.stage !== requiredStage) {
      const error = new Error(`请先确认“${STAGE_LABELS[requiredStage] || requiredStage}”阶段的产物`);
      error.code = "STAGE_OUT_OF_ORDER";
      error.statusCode = 409;
      throw error;
    }
    const review = artifact.reviewId ? state.artifacts.find((item) => item.id === artifact.reviewId) : null;
    const advisoryGate = reviewAdvisoryGate(review?.content || {});
    if (!humanOverride && advisoryGate.blockingPending.length) {
      const error = new Error("请先处理高影响审核建议或结构、逻辑分歧");
      error.code = "ADVISORY_DECISION_REQUIRED";
      error.statusCode = 409;
      throw error;
    }
    if (!humanOverride && advisoryGate.accepted.length) {
      const error = new Error("已有审核建议被采纳，请先执行定向修订并完成复审");
      error.code = "ADVISORY_REVISION_REQUIRED";
      error.statusCode = 409;
      throw error;
    }
    if (artifact.status !== "ready" && !humanOverride) {
      const error = new Error("只有通过复核的产物才可以确认");
      error.code = "ARTIFACT_NOT_READY";
      error.statusCode = 409;
      throw error;
    }
    if (UNIT_STAGES.has(artifact.stage)) {
      const totalUnits = plannedUnitCount(state.input);
      const locked = lockedUnitNumbers(state, artifact.stage);
      if (!totalUnits || locked.length < totalUnits) {
        if (!humanOverride) {
          const error = new Error(`${STAGE_LABELS[artifact.stage]}仍有未完成集数：已锁定 ${locked.length} / ${totalUnits || "计划"} 集，只能确认完整全剧`);
          error.code = "UNIT_BATCH_INCOMPLETE";
          error.statusCode = 409;
          throw error;
        }
        // 人工放行：把该产物覆盖且尚未锁定的集强制锁定，解锁后续阶段。
        const numbers = unitNumbersForContent(artifact.stage, artifact.content)
          .filter((number) => !lockedUnitNumbers(state, artifact.stage).includes(number));
        if (numbers.length) {
          lockStageUnits(state, artifact.stage, artifact.content, numbers, artifact, () => new Date());
          updateUnitStageProgress(state, artifact.stage, totalUnits, { batchId: `human_override_${artifact.id}`, units: numbers, status: "completed", artifactId: artifact.id, reviewId: artifact.reviewId || "", startedAt: text(artifact.createdAt, 80), completedAt: nowIso(now) });
        }
      }
    }
    if (humanOverride) {
      artifact.humanOverride = { confirmedAt: nowIso(now), reason: text(params.humanOverrideReason, 500) || "人工放行：接受当前版本继续" };
    }
    if (artifact.stage === "title") {
      const selectedTitle = text(params.selectedTitle, 200);
      const candidates = asArray(artifact.content?.candidates);
      if (!selectedTitle || !candidates.some((candidate) => text(candidate?.title_en, 200) === selectedTitle)) {
        const error = new Error("请从 4 个候选中选择一个剧名");
        error.code = "TITLE_SELECTION_REQUIRED";
        error.statusCode = 409;
        throw error;
      }
      try {
        validateContent("title", artifact.content, { mode: state.mode });
      } catch (validationError) {
        const error = new Error("当前剧名候选采用旧版命名规则，不符合正式剧名标准；请重新生成 4 个候选后再确认");
        error.code = "TITLE_REGENERATION_REQUIRED";
        error.statusCode = 409;
        throw error;
      }
      state.input = { ...asObject(state.input), storyTitle: selectedTitle };
    }
    confirmArtifact(state, artifact, now);
    state.updatedAt = nowIso(now);
    persistState(params, state);
    return { artifact: publicArtifact(artifact), state: publicState(state, modelRouter) };
  }

  async function handoff(params = {}) {
    const state = stateFor(params);
    const payload = createHandoffPayload({ state, project: params.project, now, randomUUID });
    const approvedArtifacts = STAGES.map((stage) => approvedForStage(state, stage)).filter(Boolean);
    const scenesContent = approvedForStage(state, "scenes")?.content || {};
    const sceneProps = asArray(scenesContent.scenes).flatMap((scene) => asArray(scene?.props || scene?.recurring_props));
    const fallbackSource = fallbackVisualAssets({
      characters: asArray(approvedForStage(state, "characters")?.content?.characters),
      scenes: asArray(scenesContent.scenes),
      props: [...asArray(scenesContent.props), ...sceneProps],
      consistencyNotes: asArray(approvedForStage(state, "characters")?.content?.world_rules),
    });
    let visualAssets = fallbackSource;
    let visualAssetReview = { status: "fallback", pass: false, score: 0, findings: ["视觉资产模型未完成调用，已使用结构化资产回退"], required_changes: [] };
    try {
      const visualRoute = { primary: state.routes.continuity, reviewer: state.routes.orchestration };
      const primary = await callProvider({
        provider: visualRoute.primary,
        system: visualAssetSystemPrompt(state.mode, state.input),
        user: visualAssetUserPrompt({ mode: state.mode, input: state.input, approvedArtifacts, project: params.project }),
        modelRouter,
      });
      visualAssets = validateVisualAssets(primary.content);
      const review = await callProvider({
        provider: visualRoute.reviewer,
        system: visualAssetReviewSystemPrompt(state.mode, state.input),
        user: visualAssetReviewUserPrompt({ mode: state.mode, input: state.input, visualAssets }),
        modelRouter,
      });
      const reviewContent = validateReview(review.content);
      visualAssetReview = {
        status: reviewContent.pass ? "passed" : "needs_review",
        pass: reviewContent.pass,
        score: reviewContent.score,
        findings: reviewContent.findings,
        required_changes: reviewContent.required_changes,
        primaryModel: `${primary.provider}:${primary.model}`,
        reviewModel: `${review.provider}:${review.model}`,
      };
    } catch (error) {
      visualAssetReview = { ...visualAssetReview, error: { code: error.code || "VISUAL_ASSET_RUN_FAILED", message: error.message } };
    }
    payload.visualAssets = visualAssets;
    payload.visualAssetReview = visualAssetReview;
    const storyRoot = params.pixelTaleRoot || params.episodeRoot;
    const sourceArtifacts = Object.fromEntries(STAGES.map((stage) => [stage, approvedForStage(state, stage)?.content || {}]));
    payload.sourceArtifacts = sourceArtifacts;
    const packageFile = writeHandoffFile(storyRoot, payload);
    let visualAssetDocument = { status: "unavailable", fileName: "", error: "" };
    if (typeof writeVisualAssetDocument === "function") {
      try {
        const documentPayload = {
          ...payload,
          characters: visualAssets.characters,
          scenes: visualAssets.scenes,
          props: visualAssets.props,
          consistency_notes: visualAssets.consistency_notes,
        };
        const file = writeVisualAssetDocument(storyRoot, {
          ...documentPayload,
          title: payload.storyTitle || params.project?.title || "PixelTale",
          mode: modeLabel(state.mode),
          episode_scale: payload.episodeScale,
          duration: payload.duration,
        });
        visualAssetDocument = { status: "ready", fileName: path.basename(file), error: "" };
      } catch (error) {
        visualAssetDocument = { status: "failed", fileName: "", error: error.message };
      }
    }
    let scriptDocument = { status: "unavailable", fileName: "", error: "" };
    if (typeof writeScriptDocument === "function") {
      try {
        const creativeControls = payload.creativeControls || normalizeCreativeControls(state.input);
        const documentFile = writeScriptDocument(storyRoot, {
          ...payload,
          title: payload.storyTitle || params.project?.title || payload.project?.title || "PixelTale",
          mode: modeLabel(state.mode),
          episode_scale: payload.episodeScale,
          duration: payload.duration,
          dialogue_mode: creativeControls.dialogueMode,
          version: state.handoffs.length + 1,
          sourceArtifacts,
        });
        scriptDocument = { status: "ready", fileName: path.basename(documentFile), error: "" };
      } catch (error) {
        scriptDocument = { status: "failed", fileName: "", error: error.message };
      }
    }
    state.visualAssets = visualAssets;
    state.visualAssetReview = visualAssetReview;
    state.visualAssetDocument = visualAssetDocument;
    state.scriptDocument = scriptDocument;
    const handoff = { id: payload.id, status: "ready", artifactIds: payload.artifactIds, packageFile, visualAssetDocument, scriptDocument, createdAt: payload.createdAt, formalFilesUntouched: true };
    state.handoffs.push(handoff);
    state.stage = "handoff";
    state.updatedAt = nowIso(now);
    persistState(params, state);
    return { handoff, payload, state: publicState(state, modelRouter) };
  }

  function saveSettings(params = {}) {
    const state = stateFor(params);
    if (params.mode) state.mode = normalizeMode(params.mode);
    if (params.routes) state.routes = normalizeRoutes(params.routes, availableModels());
    if (params.input) {
      state.input = {
        ...asObject(state.input),
        ...asObject(params.input),
        mode: state.mode,
        audienceGender: normalizeAudience({ ...asObject(state.input), ...asObject(params.input) }),
        ...normalizeCreativeControls({ ...asObject(state.input), ...asObject(params.input) }),
        ...normalizeMarket({ ...asObject(state.input), ...asObject(params.input) }, state.mode),
        ...normalizeStageOptions({ ...asObject(state.input), ...asObject(params.input) }),
      };
    }
    state.updatedAt = nowIso(now);
    persistState(params, state);
    return publicState(state, modelRouter);
  }

  return { status, run, approve, decideAdvisory, handoff, saveSettings, providerStatus: () => modelRouter.status(), constants: { STAGES, DEFAULT_ROUTES, DEFAULT_DIALOGUE_POLICY } };
}

module.exports = {
  unitLockStatus,
  isUnitProtected,
  markUnitPinned,
  markUnitDirty,
  normalizeAutoRegisteredCharacters,
  autoRegisterEpisodeCharacters,
  fixEpisodeTitles,
  autoRepairableUnits,
  dirtyUnits,
  propagateDirty,
  extractUnitAnchor,
  createPixelTaleAgent,
  createHandoffPayload,
  confirmArtifact,
  callProvider,
  callStageCouncil,
  computeMergeAudit,
  callStagePrimary,
  collectCrossReviewQuorum,
  normalizeMode,
  modeLabel,
  creativeControlPrompt,
  durationBudgetPrompt,
  suggestedShotCountRange,
  titleStylePrompt,
  stageOutputContract,
  stageSystemPrompt,
  stageUserPrompt,
  automaticUnitRepairPlan,
  normalizeRoutes,
  validateContent,
  validateReview,
  mergeRevisionContent,
  mergeStageBatchContent,
  normalizeUnitNumbers,
  unitItemsForContent,
  contentHash,
  EPISODE_BATCH_SIZE,
  reviewAdvisoryItems,
  reviewAdvisoryGate,
  isMandatoryReviewIssue,
  stageReviewPolicy,
  stageRoute,
  buildRevisionContract,
  isRetryableReviewFailure,
  aggregateRevisionClosure,
  aggregateCrossReview,
  runStageRules,
  batchReviewSummary,
  STAGES,
};
