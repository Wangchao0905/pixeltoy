const crypto = require("node:crypto");
const path = require("node:path");
const { fallbackVisualAssets } = require("./pixeltale-visual-assets.js");

const STAGES = ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue"];
const STAGE_LABELS = Object.freeze({ brief: "故事架构", title: "剧名选择", proposal: "故事提案", characters: "人物与世界", arc: "分集与章节", scenes: "场景与镜头", dialogue: "对白本土化" });
const DEFAULT_ROUTES = {
  orchestration: "gpt-5.6-terra",
  continuity: "claude-opus-5",
  hooks: "deepseek-v4-pro",
  dialogueReview: "claude-sonnet-5",
  consistency: "gpt-5.6-luna",
};
const STAGE_PRIMARY_TIMINGS = Object.freeze({
  brief: { total: 120_000, model: 100_000 },
  title: { total: 90_000, model: 80_000 },
  proposal: { total: 150_000, model: 120_000 },
  characters: { total: 240_000, model: 210_000 },
  arc: { total: 300_000, model: 270_000 },
  scenes: { total: 300_000, model: 270_000 },
  dialogue: { total: 300_000, model: 270_000 },
});
const MIN_STAGE_PRIMARY_ATTEMPT_MS = 3_000;
const REVIEW_MODEL_TIMEOUT_MS = 120_000;
const REVIEW_QUORUM = 2;
const REVIEW_DIMENSIONS = ["structure", "plot", "design", "logic"];
const STAGE_OUTPUT_TOKEN_BUDGETS = Object.freeze({
  brief: 1_800,
  title: 2_400,
  proposal: 2_800,
  characters: 7_000,
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
  },
  scenes: {
    SCENE_REFERENCE_INTEGRITY: "人物、地点和事件引用有效",
    SCENE_STATE_CHANGE: "每场戏都改变信息、关系或行动状态",
    SCENE_DURATION: "镜头与动作适配单集时长",
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
  dialogueMode: ["localized_english", "localized_english_sharp", "localized_english_subtle"],
  handoffScope: ["confirmed_versioned", "confirmed_with_reviews", "script_and_assets"],
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

function normalizeMarket(input = {}) {
  const source = asObject(input);
  const country = MARKET_PROFILES[source.marketCountry] ? source.marketCountry : DEFAULT_MARKET.marketCountry;
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

function marketPrompt(input = {}) {
  const market = normalizeMarket(input);
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
  const opening = mode === "tk_short_drama"
    ? `开头冲击窗口：前 ${controls.openingImpactSeconds} 秒内必须给出可感知的冲击或异常。`
    : `开场承诺类型：${controls.openingPromise}，首章必须明确主线推进方向。`;
  return [
    opening,
    `钩子频率：${controls.hookCadence}。`,
    `英文对白风格：${controls.dialogueMode}，仍须保持中文剧情、英文对白且口语化本土化。`,
    `交接范围：${controls.handoffScope}，不得覆盖正式文件。`,
  ].join("\n");
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
  return "tk_short_drama";
}

function modeLabel(mode) {
  return normalizeMode(mode) === "long_form_drama" ? "普通长剧" : "TK 短剧";
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
    // No provider aliases or hidden defaults: PixelTale only accepts model IDs
    // registered by the injected SuperPixel router.
    if (!allowed.size || allowed.has(raw)) routes[key] = raw;
  }
  return routes;
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
  return { primary, reviewer, consistency: current.consistency };
}

function titleStylePrompt(mode, input = {}) {
  const market = normalizeMarket(input);
  const profile = MARKET_PROFILES[market.marketCountry];
  const platform = text(input.platform, 120) || "国际流媒体 / 短视频平台";
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
  const common = stage === "title"
    ? `\n正式片名字段 title_en 必须使用英文；其余带 _zh 的解释字段使用中文。模式：${modeLabel(mode)}。`
    : `\n所有中文剧情字段必须使用中文；对白字段必须是自然、口语化、符合人物身份与语境的英文。不要逐字直译。模式：${modeLabel(mode)}。`;
  const contracts = {
    brief: `{"title_zh":"故事名","logline_zh":"一句话梗概","core_conflict_zh":"核心冲突","viewer_question_zh":"观众要追问的问题","episode_promise_zh":"每集持续兑现的承诺","mode_rules":["模式约束"]}`,
    title: `{"candidates":[{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"},{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"},{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"},{"title_en":"English release title","explanation_zh":"中文释义","style_zh":"风格标签","tone_zh":"语气与气质","naming_gene_zh":"命名基因","reason_zh":"命名理由"}],"selection_note_zh":"选择建议"}`,
    proposal: `{"title_zh":"故事名","premise_zh":"核心命题","logline_zh":"一句话梗概","viewer_question_zh":"核心悬念","protagonist_goal_zh":"主角目标","antagonistic_force_zh":"对抗力量","season_or_series_engine_zh":"持续推进引擎","first_impact_zh":"开头暴击","episode_hook_zh":"集尾钩子","reversal_zh":"首个反转"}`,
    characters: `{"characters":[{"id":"C001","name_zh":"按目标市场生成的角色显示名，不得翻译为中文名","name_en":"English or romanized display name","role":"protagonist","desire_zh":"欲望","fear_zh":"恐惧","secret_zh":"秘密","arc_zh":"人物弧线","voice_rules_en":["英文声线规则"],"visual_profile":{"gender":"性别","age_phase":"年龄相","body":"体型","hair_color":"发型发色","facial_features":"面部特征","eye_color":"瞳色","costume_accessories":"服装配饰","palette":"识别色","posture":"气质姿态","prompt_zh":"中文文生图提示词"}}],"relationships":[{"from":"C001","to":"C002","dynamic_zh":"关系变化"}],"world_rules":["不可违反的世界规则"]}`,
    arc: `{"unit":"episode_or_chapter","units":[{"number":1,"title_zh":"标题","promise_zh":"本集承诺","impact_zh":"开头暴击","causal_turn_zh":"因果转折","reversal_zh":"反转","hook_zh":"集尾强钩子","cliffhanger_question_zh":"未回答问题","payoff_zh":"推进或回收"}],"arc_summary_zh":"整体推进"}`,
    scenes: `{"scenes":[{"id":"S001","unit_number":1,"purpose_zh":"场景目的","location_zh":"地点","characters":["C001"],"action_zh":"动作推进","visual_intent_zh":"画面意图","recurring":true,"visual_profile":{"aliases":"别名","indoor_outdoor":"室内外","lighting":"光线","palette":"色调","materials":"建筑材质","layout":"空间布局","atmosphere":"氛围气味","prompt_zh":"中文文生图提示词"},"props":[{"id":"PR01","name_zh":"道具名","description_zh":"道具描述","recurring":true,"materials":"材质","appearance":"颜色形态","size":"尺寸","texture":"特殊质感","prompt_zh":"中文文生图提示词"}],"shot_plan":[{"shot_id":"SH001","type":"impact","duration_seconds":3,"description_zh":"镜头描述","dialogue_refs":["D001"]}]}]}`,
    dialogue: `{"lines":[{"id":"D001","scene_id":"S001","speaker":"C001","intent_zh":"中文剧情意图","dialogue_en":"Natural localized English dialogue.","subtext_zh":"潜台词","delivery_en":"delivery note in English"}],"localization_checks":["口语化","人物声线一致","未泄露悬念"]}`,
  };
  return `${contracts[stage]}${common}`;
}

function stageSystemPrompt(stage, mode, input = {}) {
  const controls = normalizeCreativeControls(input);
  const tkRules = mode === "tk_short_drama"
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
  const titleRules = stage === "title" ? [titleStylePrompt(mode, input)] : [];
  const selectedTitleRule = stage !== "title" && text(input.storyTitle, 200)
    ? [`用户已确认剧名为“${text(input.storyTitle, 200)}”，后续产物必须沿用，不得擅自改名。`]
    : [];
  return [
    "你是 PixelTale 编剧 Agent 的阶段执行器。你只负责当前阶段，不能跳过结构化资产直接写散文。",
    "输出严格 JSON，不要 Markdown，不要代码围栏，不要解释，不要增加契约之外的顶层字段。",
    "中文字段服务中文剧情；英文对白必须本土化、口语化，符合人物关系、年龄、阶层和冲突强度。",
    `当前阶段：${stage}。当前模式：${modeLabel(mode)}。`,
    creativeControlPrompt(controls, mode),
    audiencePrompt(input),
    marketPrompt(input),
    stageParticipationPrompt(stage, input),
    ...tkRules,
    ...titleRules,
    ...selectedTitleRule,
    `输出契约：${stageOutputContract(stage, mode)}`,
  ].join("\n");
}

function stageUserPrompt({ stage, mode, input, previousArtifacts, project, excludedTitles = [] }) {
  const prior = previousArtifacts.map((artifact) => ({
    stage: artifact.stage,
    type: artifact.type,
    version: artifact.version,
    status: artifact.status,
    content: artifact.content,
  }));
  return JSON.stringify({
    task: stage === "title" ? "基于剧本 DNA、发行属性和已确认故事架构，生成 4 个全新的英文正式片名候选。" : "基于创作规格和已确认结构，生成当前阶段唯一可审核的结构化产物。",
    project: { id: text(project?.id, 300), title: text(project?.title, 300), episode: text(project?.episode, 100) },
    mode,
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    audience: normalizeAudience(input),
    creativeControls: normalizeCreativeControls(input),
    market: normalizeMarket(input),
    stageParticipation: normalizeStageOptions(input),
    currentStage: stage,
    ...(stage === "title" ? { excludedTitles: uniqueText(excludedTitles, 100) } : {}),
    userInput: asObject(input),
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
    "若输入包含 revisionClosureProtocol，则必须逐条返回 revision_closures：每条合同项只能标记 resolved、partial 或 unresolved，并写明修订证据和未完成时的剩余修改；不得遗漏合同编号。",
    "只有 cross_validation、consistency、adversarial 三项均为 true，并且阶段专项检查均通过时，pass 才能为 true；发现任一硬伤必须 pass=false，并在 required_changes 中给出可执行修订意见。",
    creativeControlPrompt(input, mode),
    audiencePrompt(input),
    marketPrompt(input),
    stageParticipationPrompt(stage, input),
    "pass 只有在结构完整、因果清晰、可执行、符合模式节奏、没有把悬念提前解释，并且角色名、地名、社会细节和对白都符合目标市场时才为 true。",
    "模式规则只能检查当前阶段已有字段：brief 检查开头承诺与追更问题，arc 才检查逐集钩子、反转与回收；不得提前索要后续资产。",
    "对白阶段还要检查英文是否自然口语化、是否保留中文剧情意图、是否像人物会说的话。",
    ...(stage === "title" ? ["剧名阶段必须检查恰好 4 个候选、名称不重复、四种命名基因确实拉开差异，并且每个候选都有风格、语气、命名基因和理由。"] : []),
    '输出契约：{"pass":true,"score":0,"findings":["具体发现"],"required_changes":["必须修正的问题"],"issues":[{"criterion_id":"只能使用本阶段审核标准ID","tag":"稳定短标签","dimension":"structure|plot|design|logic","severity":"high|medium|low","feedback":"问题证据","fix":"具体修改建议"}],"revision_closures":[{"issue_id":"brief-R01","status":"resolved|partial|unresolved","evidence":"修订核验依据","remaining_fix":"未完成时的具体修改"}],"dimensions":{"structure":{"score":0,"feedback":"结构意见"},"plot":{"score":0,"feedback":"剧情意见"},"design":{"score":0,"feedback":"设计意见"},"logic":{"score":0,"feedback":"逻辑意见"}},"checks":{"cross_validation":true,"consistency":true,"adversarial":true,"structure":true,"mode":true,"continuity":true,"dialogue":true,"localization":true}}',
  ].join("\n");
}

function reviewerIdentity(provider) {
  return {
    chatgpt: "结构与规格审查员：核对阶段契约、因果结构和用户要求是否完整兑现。",
    claude: "连续性与本土化审查员：核对人物动机、前后连续性、地区文化和语言自然度。",
    deepseek: "钩子与受众对抗审查员：从目标受众视角攻击节奏、爽点、反转和追更动力。",
  }[providerForRoute(provider)] || "独立交叉审查员：基于证据给出可执行结论。";
}

function revisionUserPrompt({ stage, mode, input, previousArtifacts, project, baseArtifact, revisionContract, revisionPlan }) {
  const prior = previousArtifacts.map((artifact) => ({
    stage: artifact.stage,
    type: artifact.type,
    version: artifact.version,
    status: artifact.status,
    content: artifact.content,
  }));
  return JSON.stringify({
    task: "基于已审核版本执行定向修订。只解决修订合同中的问题，保留没有问题的有效内容，不得重置故事方向、改变已确认上下文或用空泛改写回避问题。必须返回当前阶段的完整结构化产物，不能只返回修改片段；未修改的顶层字段必须原样保留。",
    project: { id: text(project?.id, 300), title: text(project?.title, 300), episode: text(project?.episode, 100) },
    mode,
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    creativeControls: normalizeCreativeControls(input),
    audience: normalizeAudience(input),
    market: normalizeMarket(input),
    stageParticipation: normalizeStageOptions(input),
    currentStage: stage,
    userRevisionDirection: text(revisionPlan, 14000),
    sourceArtifact: { id: baseArtifact.id, version: baseArtifact.version, content: baseArtifact.content },
    revisionContract,
    approvedContext: prior,
  }, null, 2).slice(0, 180000);
}

function reviewUserPrompt({ stage, mode, artifact, previousArtifacts, input, revisionContract = null }) {
  const revisionItems = asArray(revisionContract?.items);
  return JSON.stringify({
    reviewProtocol: {
      type: "adversarial_cross_validation",
      instructions: [
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
    market: normalizeMarket(input),
    stageParticipation: normalizeStageOptions(input),
    artifact,
    approvedContext: previousArtifacts.map((item) => ({ stage: item.stage, content: item.content })).slice(-6),
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
    marketPrompt(input),
    '输出契约：{"characters":[{"id":"P01","name_zh":"中文名","name_en":"English name","type":"人物","aliases":"别名","gender":"性别","age_phase":"年龄相","body":"体型","hair_color":"发型发色","facial_features":"面部特征","eye_color":"瞳色","costume_accessories":"服装配饰","palette":"识别色","posture":"气质姿态","prompt_zh":"中文文生图提示词"}],"scenes":[{"id":"S01","name_zh":"场景名","name_en":"English name","type":"场景","aliases":"别名","indoor_outdoor":"室内外","lighting":"光线","palette":"色调","materials":"建筑材质","layout":"空间布局","atmosphere":"氛围气味","prompt_zh":"中文文生图提示词"}],"props":[{"id":"PR01","name_zh":"道具名","name_en":"English name","type":"道具","aliases":"别名","materials":"材质","appearance":"颜色形态","size":"尺寸","texture":"特殊质感","prompt_zh":"中文文生图提示词"}],"consistency_notes":["全剧统一视觉规则"]}',
  ].join("\n");
}

function visualAssetUserPrompt({ mode, input, approvedArtifacts, project }) {
  return JSON.stringify({
    task: "从已确认的全剧结构中提取并补全视觉资产设计，确保同一资产在不同单元中可复用且外观连续。",
    project,
    mode,
    audience: normalizeAudience(input),
    market: normalizeMarket(input),
    approvedArtifacts: approvedArtifacts.map((item) => ({ stage: item.stage, content: item.content })),
  }, null, 2).slice(0, 240000);
}

function visualAssetReviewSystemPrompt(mode, input = {}) {
  return [
    "你是 PixelTale 的视觉资产复核 Agent。检查视觉资产文档数据，不要重写全文。",
    "输出严格 JSON，不要 Markdown、代码围栏或额外文字。",
    `当前模式：${modeLabel(mode)}。检查重复资产筛选、编号唯一性、字段完整性、人物与场景连续性、文生图提示词可执行性。`,
    audiencePrompt(input),
    marketPrompt(input),
    '输出契约：{"pass":true,"score":0,"findings":["具体发现"],"required_changes":["必须修正的问题"],"checks":{"cross_validation":true,"consistency":true,"adversarial":true,"recurrence":true,"identity":true,"prompt":true}}',
  ].join("\n");
}

function visualAssetReviewUserPrompt({ mode, input, visualAssets }) {
  return JSON.stringify({ mode, market: normalizeMarket(input), visualAssets }, null, 2).slice(0, 200000);
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
  const required = requiredContentFields(stage);
  const missing = required.filter((key) => value[key] === undefined || value[key] === null || (typeof value[key] === "string" && !value[key].trim()) || (Array.isArray(value[key]) && value[key].length === 0));
  if (missing.length) {
    const error = new Error(`${stage} 产物缺少必填字段：${missing.join(", ")}`);
    error.code = "SCHEMA_INVALID";
    throw error;
  }
  if (stage === "title") {
    const candidates = asArray(value.candidates).map((candidate) => asObject(candidate));
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
    const invalid = value.lines.some((line) => !text(line?.speaker, 120) || !text(line?.dialogue_en, 1000) || !text(line?.intent_zh, 1000));
    if (invalid) {
      const error = new Error("对白产物必须同时包含 speaker、intent_zh 和 dialogue_en");
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
      score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0,
      feedback: text(item.feedback || rawDimensions[key], 1200),
    }];
  }));
  const issues = asArray(review.issues).map((item) => {
    const entry = asObject(item);
    const dimension = REVIEW_DIMENSIONS.includes(entry.dimension) ? entry.dimension : "logic";
    return {
      criterionId: text(entry.criterion_id || entry.criterionId, 120).toUpperCase(),
      tag: text(entry.tag, 120),
      dimension,
      severity: ["high", "medium", "low"].includes(entry.severity) ? entry.severity : "medium",
      feedback: text(entry.feedback, 1200),
      fix: text(entry.fix || entry.suggestion, 1200),
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
  return "superpixel";
}

function pairwiseAgreement(scores) {
  if (scores.length < 2) return 0;
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
      };
      group.models.set(feedback.model, feedback.provider);
      if ((issueSeverityRank[issue.severity] ?? 1) < (issueSeverityRank[group.severity] ?? 1)) group.severity = issue.severity;
      if (issue.fix) group.suggestions.push(issue.fix);
      if (issue.feedback) group.evidence.push(`${feedback.model}：${issue.feedback}`);
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
      suggestions: uniqueText(group.suggestions, 5),
      evidence: uniqueText(group.evidence, 5),
    }))
    .sort((left, right) => (issueSeverityRank[left.severity] ?? 1) - (issueSeverityRank[right.severity] ?? 1) || right.modelCount - left.modelCount || left.tag.localeCompare(right.tag, "zh-CN"));
}

function sharedReviewIssues(feedbacks) {
  return groupedReviewIssues(feedbacks).filter((group) => group.modelCount >= 2);
}

function buildRevisionContract(review = {}, { stage, sourceArtifactId, id: contractId }) {
  const freshCommonIssues = asArray(review.commonIssues)
    .filter((item) => Number(item.modelCount) >= REVIEW_QUORUM && item.severity === "high");
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
  const freshIssues = [...freshCommonIssues, ...acceptedAdvisories];
  if (!freshIssues.length) {
    freshIssues.push(...asArray(review.reviewIssues)
      .filter((item) => Number(item.modelCount) >= REVIEW_QUORUM && item.severity === "high"));
  }
  const inheritedIssues = asArray(review.revision?.contract?.items)
    .filter((item) => {
      const closure = asArray(review.revision?.closure?.items).find((entry) => entry.id === item.id);
      return !closure || closure.status !== "resolved";
    })
    .map((item) => {
      const closure = asArray(review.revision?.closure?.items).find((entry) => entry.id === item.id);
      return {
        criterionId: item.criterionId,
        tag: item.tag,
        dimension: item.dimension,
        severity: item.severity,
        modelCount: item.modelCount,
        models: item.models,
        suggestions: uniqueText([...(asArray(item.requiredEdit)), ...(asArray(closure?.remainingFix))], 4),
        evidence: uniqueText([...(asArray(item.evidence)), ...(asArray(closure?.remainingFix))], 4),
      };
    });
  const issues = [...freshIssues, ...inheritedIssues].filter((issue, index, all) => {
    const key = issueKey(issue.criterionId) || issueKey(issue.tag) || `issue-${index}`;
    return all.findIndex((candidate) => (issueKey(candidate.criterionId) || issueKey(candidate.tag)) === key) === index;
  });
  return {
    id: text(contractId, 200),
    stage,
    sourceArtifactId: text(sourceArtifactId, 200),
    items: issues.slice(0, 24).map((issue, index) => ({
      id: `${stage}-R${String(index + 1).padStart(2, "0")}`,
      tag: text(issue.tag || "审核修订项", 160),
      dimension: REVIEW_DIMENSIONS.includes(issue.dimension) ? issue.dimension : "logic",
      severity: ["high", "medium", "low"].includes(issue.severity) ? issue.severity : "medium",
      modelCount: Math.max(0, Number(issue.modelCount) || 0),
      evidence: uniqueText(asArray(issue.evidence), 4),
      requiredEdit: uniqueText(asArray(issue.suggestions), 4),
      acceptance: `修订版本必须消除“${text(issue.tag || "审核修订项", 160)}”的证据，并与用户规格和已确认上下文保持一致。`,
    })),
  };
}

function aggregateRevisionClosure(feedbacks = [], revisionContract = null) {
  const items = asArray(revisionContract?.items);
  if (!items.length) return { required: false, allResolved: true, items: [] };
  const closureItems = items.map((item) => {
    const responses = feedbacks.map((feedback) => {
      const closure = asArray(feedback.revisionClosures).find((entry) => entry.issueId === item.id);
      return closure || { status: "unresolved", evidence: "该审核模型未提供该修订项的关闭证明", remainingFix: "补充逐项复审结论" };
    });
    const counts = Object.fromEntries(["resolved", "partial", "unresolved"].map((status) => [status, responses.filter((entry) => entry.status === status).length]));
    const resolved = counts.resolved >= REVIEW_QUORUM;
    return {
      ...item,
      status: resolved ? "resolved" : counts.resolved ? "partial" : "unresolved",
      resolvedBy: counts.resolved,
      responses: responses.map((entry) => ({ status: entry.status, evidence: entry.evidence, remainingFix: entry.remainingFix })),
      remainingFix: uniqueText(responses.filter((entry) => entry.status !== "resolved").map((entry) => entry.remainingFix || entry.evidence), 4),
    };
  });
  return { required: true, allResolved: closureItems.every((item) => item.status === "resolved"), items: closureItems };
}

function aggregateCrossReview(reviews = [], revisionContract = null) {
  const feedbacks = reviews.map((item) => {
    if (item.result) {
      const review = item.result;
      return {
        provider: review.provider,
        model: review.model,
        role: item.role || reviewerIdentity(review.model),
        status: "completed",
        pass: review.content.pass,
        score: review.content.score,
        findings: review.content.findings,
        required_changes: review.content.required_changes,
        checks: review.content.checks,
        dimensions: review.content.dimensions,
        issues: review.content.issues,
        revisionClosures: review.content.revisionClosures,
      };
    }
    return {
      provider: providerForRoute(item.route),
      model: item.model,
      role: item.role || reviewerIdentity(item.route),
      status: "failed",
      pass: false,
      score: 0,
      findings: [item.error || "模型未返回审核意见"],
      required_changes: ["该模型审核未完成，不能将一致性指数视为完整"],
      checks: {},
      dimensions: Object.fromEntries(REVIEW_DIMENSIONS.map((key) => [key, { score: 0, feedback: "审核未完成" }])),
      issues: [],
      revisionClosures: [],
    };
  });
  const completed = feedbacks.filter((item) => item.status === "completed");
  const dimensions = Object.fromEntries(REVIEW_DIMENSIONS.map((key) => {
    const scores = completed.map((item) => Number(item.dimensions?.[key]?.score || 0));
    const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
    return [key, { average, agreement: pairwiseAgreement(scores), scores }];
  }));
  const agreement = Math.round(REVIEW_DIMENSIONS.reduce((sum, key) => sum + dimensions[key].agreement, 0) / REVIEW_DIMENSIONS.length);
  const quality = completed.length ? Math.round(completed.reduce((sum, item) => sum + item.score, 0) / completed.length) : 0;
  const reviewCompletion = Math.round((completed.length / 3) * 100);
  const index = Math.round(agreement * 0.45 + quality * 0.35 + reviewCompletion * 0.2);
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
  const commonIssues = reviewIssues.filter((issue) => issue.modelCount >= 2);
  const mandatoryIssues = commonIssues.filter((issue) => issue.severity === "high");
  const recommendedIssues = commonIssues.filter((issue) => issue.severity !== "high");
  const independentIssues = reviewIssues.filter((issue) => issue.modelCount === 1);
  const conflicts = REVIEW_DIMENSIONS
    .filter((key) => completed.length >= 2 && dimensions[key].agreement < 75)
    .map((key) => ({
      id: `advisory_conflict_${key}`,
      dimension: key,
      agreement: dimensions[key].agreement,
      scores: dimensions[key].scores,
      models: completed.map((item) => item.model),
      suggestion: `已完成模型对${key}维度评分差异较大，建议人工核对证据与取舍`,
    }));
  const revisionClosure = aggregateRevisionClosure(completed, revisionContract);
  const quorumMet = completed.length >= REVIEW_QUORUM;
  const passingReviews = completed.filter((item) => item.pass).length;
  const pass = quorumMet && mandatoryIssues.length === 0 && revisionClosure.allResolved;
  const checks = {
    cross_validation: quorumMet,
    consistency: mandatoryIssues.length === 0,
    adversarial: completed.filter((item) => item.checks?.adversarial === true).length >= REVIEW_QUORUM,
    issues_converged: mandatoryIssues.length === 0,
    dimensions_agree: conflicts.length === 0,
    revision_contract_closed: revisionClosure.allResolved,
  };
  const issueChanges = mandatoryIssues.map((issue) => {
    const source = `至少 ${issue.modelCount} 个模型共同指出`;
    const suggestions = issue.suggestions.length ? issue.suggestions.join("；") : "针对该问题补充具体修订并重新提交三模型审核";
    return `${source}【${issue.severity} / ${issue.tag}】：${suggestions}`;
  });
  const closureChanges = revisionClosure.items
    .filter((item) => item.status !== "resolved")
    .map((item) => `【${item.id} / ${item.tag}】修订关闭未通过：${item.remainingFix.join("；") || "请按验收条件补充修订"}`);
  return {
    pass,
    score: index,
    consensusIndex: index,
    agreement,
    quality,
    reviewCompletion,
    quorum: { required: REVIEW_QUORUM, completed: completed.length, passing: passingReviews, met: quorumMet },
    dimensions,
    feedbacks,
    reviewIssues,
    issueCount: reviewIssues.length,
    commonIssues,
    commonIssueCount: commonIssues.length,
    mandatoryIssues,
    mandatoryIssueCount: mandatoryIssues.length,
    recommendedIssues,
    recommendedIssueCount: recommendedIssues.length,
    independentIssues,
    independentIssueCount: independentIssues.length,
    conflicts,
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

class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, code = "PROVIDER_ERROR" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

async function callProvider({ provider, system, user, modelRouter, timeoutMs, maxTokens, purpose = "pixeltale", signal }) {
  if (!modelRouter || typeof modelRouter.call !== "function") {
    throw new ProviderError("PixelTale 未接入 SuperPixel 文本模型路由", { code: "SUPER_PIXEL_ROUTER_MISSING" });
  }
  return modelRouter.call({ model: modelForRoute(provider), system, user, purpose, timeoutMs, maxTokens, signal });
}

function canFallbackFrom(error) {
  return error?.retryable === true || ["TIMEOUT", "NETWORK_ERROR", "EMPTY_RESPONSE", "INVALID_JSON", "SCHEMA_INVALID"].includes(error?.code);
}

function stagePrimaryTiming(stage) {
  return STAGE_PRIMARY_TIMINGS[stage] || STAGE_PRIMARY_TIMINGS.proposal;
}

async function callStagePrimary({
  route,
  system,
  user,
  stage = "brief",
  modelRouter,
  nowMs = () => Date.now(),
  totalTimeoutMs,
  perModelTimeoutMs,
}) {
  if (!modelRouter || typeof modelRouter.stageModels !== "function") {
    throw new ProviderError("PixelTale 未接入 SuperPixel 主创模型路由", { code: "SUPER_PIXEL_ROUTER_MISSING" });
  }
  const providers = uniqueText(modelRouter.stageModels(route).slice(0, 3), 3);
  const failures = [];
  const timing = stagePrimaryTiming(stage);
  const totalBudgetMs = totalTimeoutMs ?? timing.total;
  const perModelBudgetMs = perModelTimeoutMs ?? timing.model;
  const startedAtMs = nowMs();
  const deadlineMs = startedAtMs + Math.max(MIN_STAGE_PRIMARY_ATTEMPT_MS, totalBudgetMs);
  if (!providers.length) {
    throw new ProviderError("SuperPixel 没有可用的主创模型", { code: "STAGE_GENERATION_UNAVAILABLE", retryable: true });
  }
  const raceController = new AbortController();
  const attempts = providers.map(async (provider) => {
    const remainingMs = deadlineMs - nowMs();
    if (remainingMs < MIN_STAGE_PRIMARY_ATTEMPT_MS) {
      const error = new ProviderError("主创阶段的响应预算已用尽，未启动该模型请求", { code: "STAGE_TIMEOUT_BUDGET_EXHAUSTED", retryable: true });
      failures.push({ provider, code: error.code, message: error.message });
      throw error;
    }
    const timeoutMs = Math.max(MIN_STAGE_PRIMARY_ATTEMPT_MS, Math.min(perModelBudgetMs, remainingMs));
    try {
      const result = await callProvider({
        provider,
        system,
        user,
        modelRouter,
        timeoutMs,
        maxTokens: STAGE_OUTPUT_TOKEN_BUDGETS[stage] || STAGE_OUTPUT_TOKEN_BUDGETS.proposal,
        purpose: `pixeltale:${stage}:author`,
        signal: raceController.signal,
      });
      return { provider, result };
    } catch (error) {
      if (error?.code !== "REQUEST_CANCELLED") {
        failures.push({ provider, code: error?.code || "PROVIDER_ERROR", message: error?.message || "主创模型请求失败" });
      }
      throw error;
    }
  });
  try {
    const winner = await Promise.any(attempts);
    const failureSnapshot = failures.slice();
    raceController.abort();
    return {
      ...winner.result,
      fallback: winner.provider !== route.primary,
      fallbackFailures: failureSnapshot,
      racedModels: providers,
      primaryBudget: { totalTimeoutMs: totalBudgetMs, elapsedMs: Math.max(0, nowMs() - startedAtMs) },
    };
  } catch {
    raceController.abort();
  }
  const detail = failures.map((item) => item.message).join("；");
  const error = new ProviderError(`SuperPixel 主创模型未能在 ${Math.round(totalBudgetMs / 1000)} 秒响应窗口内完成：${detail}`, { code: "STAGE_GENERATION_UNAVAILABLE", retryable: true });
  error.fallbackFailures = failures;
  error.primaryBudget = { totalTimeoutMs: totalBudgetMs, elapsedMs: Math.max(0, nowMs() - startedAtMs) };
  throw error;
}

function emptyState({ projectId, mode = "tk", now = () => new Date() }) {
  const timestamp = nowIso(now);
  return {
    schemaVersion: 1,
    projectId: text(projectId, 500),
    mode: normalizeMode(mode),
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    input: {},
    stage: "brief",
    routes: { ...DEFAULT_ROUTES },
    artifacts: [],
    approvedArtifactIds: [],
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
  return {
    ...base,
    ...source,
    projectId: text(source.projectId || params.projectId, 500),
    mode: normalizeMode(source.mode || params.mode),
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    input: { ...asObject(source.input), audienceGender: normalizeAudience(source.input), ...normalizeCreativeControls(source.input), ...normalizeMarket(source.input), ...normalizeStageOptions(source.input) },
    stage: source.stage === "handoff" ? "handoff" : normalizeStage(source.stage),
    routes: normalizeRoutes(source.routes),
    artifacts: asArray(source.artifacts),
    approvedArtifactIds: asArray(source.approvedArtifactIds),
    runs: asArray(source.runs).slice(-50),
    handoffs: asArray(source.handoffs),
  };
}

function readState({ stateRoot, projectId, mode, readPixelTaleState, writePixelTaleState, now }) {
  const raw = asObject(readPixelTaleState(stateRoot));
  const state = normalizeState(raw, { projectId, mode, now });
  if (!Object.keys(raw).length) writePixelTaleState(stateRoot, state);
  return state;
}

function saveState({ stateRoot, state, writePixelTaleState }) {
  return writePixelTaleState(stateRoot, state);
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
    evidence: ["用户创作规格", "已确认阶段上下文", `${modeLabel(mode)} / 中文剧情 + 英文对白策略`, `目标市场：${MARKET_PROFILES[normalizeMarket(input).marketCountry].label}`],
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
    "## 分场",
    ...asArray(scenes.scenes).map((scene) => `### ${text(scene.id, 40)} / ${text(scene.location_zh, 100)}\n${text(scene.action_zh || scene.purpose_zh, 1000)}`),
    "",
    "## English Dialogue",
    ...asArray(dialogue.lines).map((line) => `${text(line.speaker, 100)}: ${text(line.dialogue_en, 1000)}`),
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
    market: normalizeMarket(state.input),
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

function createPixelTaleAgent(options = {}) {
  const modelRouter = options.modelRouter;
  const now = options.now || (() => new Date());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const readPixelTaleState = options.readPixelTaleState;
  const writePixelTaleState = options.writePixelTaleState;
  const writeHandoffFile = options.writeHandoffFile || (() => "");
  const writeVisualAssetDocument = options.writeVisualAssetDocument;
  const writeScriptDocument = options.writeScriptDocument;
  if (typeof readPixelTaleState !== "function" || typeof writePixelTaleState !== "function") throw new Error("PixelTale Agent 缺少独立 state adapter");
  if (!modelRouter || typeof modelRouter.call !== "function" || typeof modelRouter.models !== "function") throw new Error("PixelTale Agent 必须使用 SuperPixel 文本模型路由");

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
    state.routes = normalizeRoutes(state.routes, availableModels());
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
      audienceGender: normalizeAudience({ ...asObject(state.input), ...asObject(params.input) }),
      ...normalizeCreativeControls({ ...asObject(state.input), ...asObject(params.input) }),
      ...normalizeMarket({ ...asObject(state.input), ...asObject(params.input) }),
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
      if (!text(params.input?.idea || params.input?.coreConflict || (stage !== "brief" ? "context" : ""), 6000)) {
        const error = new Error("创作规格需要一个可识别的核心冲突");
        error.code = "INPUT_INVALID";
        throw error;
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
      const excludedTitles = stage === "title"
        ? state.artifacts.filter((artifact) => artifact.stage === "title" && artifact.type === "pixeltale_title").flatMap((artifact) => asArray(artifact.content?.candidates).map((candidate) => candidate?.title_en || candidate?.title_zh))
        : [];
      const system = stageSystemPrompt(stage, mode, runInput);
      const user = revisionContract
        ? revisionUserPrompt({ stage, mode, input: runInput, previousArtifacts, project: params.project, baseArtifact: revisionBase, revisionContract, revisionPlan })
        : stageUserPrompt({ stage, mode, input: runInput, previousArtifacts, project: params.project, excludedTitles });
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
        : await callStagePrimary({ route, stage, system, user, modelRouter });
      retryCount += primary.attempts || 0;
      const content = validateContent(
        stage,
        revisionPlan ? mergeRevisionContent(stage, primary.content, revisionBase?.content) : primary.content,
        { ...runInput, mode, excludedTitles },
      );
      const version = state.artifacts.filter((artifact) => artifact.stage === stage && artifact.type === `pixeltale_${stage}`).length + 1;
      primaryArtifact = buildArtifact({ stage, mode, input: runInput, content, model: `${primary.provider}:${primary.model}`, version, now, randomUUID });
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
      reviewRoutes = modelRouter.reviewModels(route);
      reviews = await Promise.all(reviewRoutes.map(async (reviewRoute) => {
        const reviewModel = reviewRoute.model || reviewRoute;
        const role = reviewerIdentity(reviewModel);
        const reviewCandidates = uniqueText([reviewModel, ...asArray(reviewRoute.fallbackModels)], 2);
        let lastError;
        for (const candidate of reviewCandidates) {
          try {
            const result = await callProvider({
              provider: candidate,
              system: `${reviewSystemPrompt(stage, mode, runInput)}\n本次固定身份：${role}`,
              user: reviewUserPrompt({ stage, mode, input: runInput, artifact: primaryArtifact, previousArtifacts, revisionContract }),
              modelRouter,
              timeoutMs: REVIEW_MODEL_TIMEOUT_MS,
              maxTokens: REVIEW_OUTPUT_TOKEN_BUDGETS[stage] || 3_000,
              purpose: `pixeltale:${stage}:review`,
            });
            const content = validateReview(result.content, { requireDimensions: true, revisionContract });
            retryCount += result.attempts || 0;
            return { route: reviewRoute, selectedModel: reviewModel, role, result: { ...result, content } };
          } catch (error) {
            lastError = error;
            retryCount += 1;
            if (!canFallbackFrom(error)) break;
          }
        }
        return { route: reviewModel, model: reviewCandidates.at(-1) || reviewModel, selectedModel: reviewModel, role, error: lastError?.message || "审核模型请求失败" };
      }));
      reviews.filter((item) => !item.result).forEach((item) => errors.push({ code: "CROSS_REVIEW_FAILED", message: `${item.model}：${item.error}` }));
      consensus = aggregateCrossReview(reviews, revisionContract);
      if (consensus.revision) consensus.revision.owner = "本阶段主创";
      reviewArtifact = buildReviewArtifact({ stage, review: consensus, model: `cross-review:${reviews.map((item) => item.result?.model || item.model).join(",")}`, version, now, randomUUID, primaryArtifactId: primaryArtifact.id });
      primaryArtifact.status = consensus.pass ? "ready" : "needs_review";
      primaryArtifact.reviewId = reviewArtifact.id;
      state.artifacts.push(primaryArtifact, reviewArtifact);
      const runStatus = consensus.pass ? "completed" : "needs_review";
      const record = { runId, stage, mode, route: { ...route, crossReview: reviewRoutes.map((item) => item.model || item) }, status: runStatus, primaryModel: `${primary.provider}:${primary.model}`, reviewModels: reviews.map((item) => item.result ? `${item.result.provider}:${item.result.model}` : `${providerForRoute(item.model)}:${item.model}`), primaryFallback: primary.fallback ? { attempted: primary.fallbackFailures.length, recovered: true, failures: primary.fallbackFailures, budget: primary.primaryBudget } : null, consensusIndex: consensus.consensusIndex, agreement: consensus.agreement, reviewCompletion: consensus.reviewCompletion, revision: revisionPlan ? { sourceArtifactId: revisionBase?.id || "", contractId: revisionContract?.id || "", itemCount: revisionContract?.items.length || 0, plan: text(revisionPlan, 14000), allResolved: consensus.revision?.closure?.allResolved === true } : null, artifactIds: [primaryArtifact.id, reviewArtifact.id], errors, retryCount, startedAt, completedAt: nowIso(now) };
      state.runs.push(record);
      persistState(params, state);
      return { ...publicRun(record), artifacts: [primaryArtifact, reviewArtifact].map(publicArtifact), state: publicState(state, modelRouter) };
    } catch (error) {
      errors.push({ code: error.code || "RUN_FAILED", message: error.message });
      if (primaryArtifact && !state.artifacts.some((artifact) => artifact.id === primaryArtifact.id)) state.artifacts.push(primaryArtifact);
      const fallbackReviewModels = stage === "title" ? [] : (reviewRoutes.length ? reviewRoutes : [route.reviewer]);
      const record = { runId, stage, mode, route: stage === "title" ? { primary: route.primary } : route, status: "failed", primaryModel: primary ? `${primary.provider}:${primary.model}` : modelForRoute(route.primary), reviewModels: fallbackReviewModels.map((item) => `${item.provider || providerForRoute(item.model || item)}:${modelForRoute(item.model || item)}`), primaryFallback: error?.fallbackFailures?.length ? { attempted: error.fallbackFailures.length, recovered: false, failures: error.fallbackFailures, budget: error.primaryBudget || null } : null, revision: revisionPlan ? { sourceArtifactId: revisionBase?.id || "", contractId: revisionContract?.id || "", itemCount: revisionContract?.items.length || 0, plan: text(revisionPlan, 14000), allResolved: false } : null, artifactIds: primaryArtifact ? [primaryArtifact.id] : [], errors, retryCount, startedAt, completedAt: nowIso(now) };
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
      sourceArtifact.status = gate.accepted.length || gate.blockingPending.length || !review.content.pass ? "needs_review" : "ready";
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
    if (advisoryGate.blockingPending.length) {
      const error = new Error("请先处理高影响审核建议或结构、逻辑分歧");
      error.code = "ADVISORY_DECISION_REQUIRED";
      error.statusCode = 409;
      throw error;
    }
    if (advisoryGate.accepted.length) {
      const error = new Error("已有审核建议被采纳，请先执行定向修订并完成复审");
      error.code = "ADVISORY_REVISION_REQUIRED";
      error.statusCode = 409;
      throw error;
    }
    if (artifact.status !== "ready") {
      const error = new Error("只有通过复核的产物才可以确认");
      error.code = "ARTIFACT_NOT_READY";
      error.statusCode = 409;
      throw error;
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
      state.input = { ...asObject(state.input), storyTitle: selectedTitle };
    }
    artifact.status = "approved";
    artifact.updatedAt = nowIso(now);
    if (!state.approvedArtifactIds.includes(artifact.id)) state.approvedArtifactIds.push(artifact.id);
    state.stage = nextStage(artifact.stage);
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
        const sourceArtifacts = Object.fromEntries(STAGES.map((stage) => [stage, approvedForStage(state, stage)?.content || {}]));
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
        audienceGender: normalizeAudience({ ...asObject(state.input), ...asObject(params.input) }),
        ...normalizeCreativeControls({ ...asObject(state.input), ...asObject(params.input) }),
        ...normalizeMarket({ ...asObject(state.input), ...asObject(params.input) }),
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
  createPixelTaleAgent,
  callProvider,
  callStagePrimary,
  normalizeMode,
  normalizeRoutes,
  validateContent,
  validateReview,
  mergeRevisionContent,
  reviewAdvisoryItems,
  reviewAdvisoryGate,
  stageRoute,
  buildRevisionContract,
  aggregateRevisionClosure,
  aggregateCrossReview,
  STAGES,
};
