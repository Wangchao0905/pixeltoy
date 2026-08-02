const crypto = require("node:crypto");
const path = require("node:path");
const { fallbackVisualAssets } = require("./pixeltale-visual-assets.js");

const STAGES = ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue"];
const PROVIDERS = ["chatgpt", "claude", "grok"];
const MODEL_PROVIDER_MAP = Object.freeze({
  "gpt-5.6-terra": "chatgpt",
  "gpt-5.6-sol": "chatgpt",
  "gpt-5.6-luna": "chatgpt",
  "claude-opus-5": "claude",
  "claude-sonnet-5": "claude",
  "claude-haiku-4-5": "claude",
  "grok-4.5": "grok",
});
const DEFAULT_MODEL_BY_PROVIDER = Object.freeze({
  chatgpt: "gpt-5.6-terra",
  claude: "claude-opus-5",
  grok: "grok-4.5",
});
const DEFAULT_ROUTES = {
  orchestration: "gpt-5.6-terra",
  continuity: "claude-opus-5",
  hooks: "grok-4.5",
  dialogueReview: "claude-sonnet-5",
};
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

function normalizeRoutes(value = {}) {
  const routes = { ...DEFAULT_ROUTES };
  for (const key of Object.keys(routes)) {
    const raw = text(value?.[key], 100).toLowerCase();
    if (MODEL_PROVIDER_MAP[raw]) routes[key] = raw;
    else if (PROVIDERS.includes(raw)) routes[key] = DEFAULT_MODEL_BY_PROVIDER[raw];
  }
  return routes;
}

function modelForRoute(route, env = process.env) {
  const raw = text(route, 100).toLowerCase();
  return MODEL_PROVIDER_MAP[raw] ? raw : providerConfig(raw, env).model;
}

function stageRoute(stage, mode, routes) {
  const normalized = normalizeMode(mode);
  const current = normalizeRoutes(routes);
  if (stage === "characters" || (stage === "arc" && normalized === "long_form_drama")) {
    return { primary: current.continuity, reviewer: current.orchestration };
  }
  if (stage === "arc" || stage === "dialogue") {
    return { primary: stage === "dialogue" ? current.hooks : current.hooks, reviewer: current.dialogueReview };
  }
  return { primary: current.orchestration, reviewer: current.continuity };
}

function titleStylePrompt(mode) {
  return [
    "剧名必须输出 5 个候选，不能少于或多于 5 个，名称之间不得只是同义词替换。",
    "五个候选必须分别体现：冷峻悬疑、强钩子商业、诗意隐喻、人物命运、极简国际化短标题。",
    `结合${modeLabel(mode)}的节奏和受众，名称要有记忆点、可传播、适合海报与视频封面。`,
    "每个候选都要说明风格、语气和命名理由；不要使用‘未命名故事’等占位名称。",
  ].join("\n");
}

function providerConfig(provider, env = process.env) {
  const configs = {
    chatgpt: {
      label: "ChatGPT",
      key: env.PIXELTALE_CHATGPT_API_KEY || env.OPENAI_API_KEY || env.STORYBOARD_API_KEY || "",
      baseUrl: env.PIXELTALE_CHATGPT_BASE_URL || env.STORYBOARD_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: env.PIXELTALE_CHATGPT_MODEL || env.STORYBOARD_MODEL || env.OPENAI_MODEL || "gpt-4o-mini",
      protocol: "openai_compat",
    },
    claude: {
      label: "Claude",
      key: env.PIXELTALE_CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || env.ASSET_ANALYZER_API_KEY || "",
      baseUrl: env.PIXELTALE_CLAUDE_BASE_URL || env.ANTHROPIC_BASE_URL || env.ASSET_ANALYZER_BASE_URL || env.OPENAI_BASE_URL || "https://api.anthropic.com/v1",
      model: env.PIXELTALE_CLAUDE_MODEL || env.CLAUDE_MODEL || env.ASSET_ANALYZER_MODEL || "claude-sonnet-4-5",
      protocol: text(env.PIXELTALE_CLAUDE_PROTOCOL || "openai_compat", 40).toLowerCase(),
    },
    grok: {
      label: "Grok",
      key: env.PIXELTALE_GROK_API_KEY || env.XAI_API_KEY || env.GROK_API_KEY || "",
      baseUrl: env.PIXELTALE_GROK_BASE_URL || env.XAI_BASE_URL || "https://api.x.ai/v1",
      model: env.PIXELTALE_GROK_MODEL || env.GROK_MODEL || "grok-3-mini",
      protocol: "openai_compat",
    },
  };
  const config = configs[provider];
  if (!config) throw new Error(`未知模型 provider：${provider}`);
  return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
}

function providerStatus(env = process.env) {
  return Object.fromEntries(PROVIDERS.map((provider) => {
    const config = providerConfig(provider, env);
    return [provider, {
      provider,
      label: config.label,
      configured: !!config.key,
      model: config.model,
      protocol: config.protocol,
    }];
  }));
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
  const common = `\n所有中文剧情字段必须使用中文；对白字段必须是自然、口语化、符合人物身份与语境的英文。不要逐字直译。模式：${modeLabel(mode)}。`;
  const contracts = {
    brief: `{"title_zh":"故事名","logline_zh":"一句话梗概","core_conflict_zh":"核心冲突","viewer_question_zh":"观众要追问的问题","episode_promise_zh":"每集持续兑现的承诺","mode_rules":["模式约束"]}`,
    title: `{"candidates":[{"title_zh":"候选剧名","style_zh":"风格标签","tone_zh":"语气与气质","reason_zh":"命名理由"},{"title_zh":"候选剧名","style_zh":"风格标签","tone_zh":"语气与气质","reason_zh":"命名理由"},{"title_zh":"候选剧名","style_zh":"风格标签","tone_zh":"语气与气质","reason_zh":"命名理由"},{"title_zh":"候选剧名","style_zh":"风格标签","tone_zh":"语气与气质","reason_zh":"命名理由"},{"title_zh":"候选剧名","style_zh":"风格标签","tone_zh":"语气与气质","reason_zh":"命名理由"}],"selection_note_zh":"选择建议"}`,
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
  const titleRules = stage === "title" ? [titleStylePrompt(mode)] : [];
  const selectedTitleRule = stage !== "title" && text(input.storyTitle, 200)
    ? [`用户已确认剧名为“${text(input.storyTitle, 200)}”，后续产物必须沿用，不得擅自改名。`]
    : [];
  return [
    "你是 PixelTale 编剧 Agent 的阶段执行器。你只负责当前阶段，不能跳过结构化资产直接写散文。",
    "输出严格 JSON，不要 Markdown，不要代码围栏，不要解释，不要增加契约之外的顶层字段。",
    "中文字段服务中文剧情；英文对白必须本土化、口语化，符合人物关系、年龄、阶层和冲突强度。",
    `当前阶段：${stage}。当前模式：${modeLabel(mode)}。`,
    creativeControlPrompt(controls, mode),
    marketPrompt(input),
    stageParticipationPrompt(stage, input),
    ...tkRules,
    ...titleRules,
    ...selectedTitleRule,
    `输出契约：${stageOutputContract(stage, mode)}`,
  ].join("\n");
}

function stageUserPrompt({ stage, mode, input, previousArtifacts, project }) {
  const prior = previousArtifacts.map((artifact) => ({
    stage: artifact.stage,
    type: artifact.type,
    version: artifact.version,
    status: artifact.status,
    content: artifact.content,
  }));
  return JSON.stringify({
    task: "基于创作规格和已确认结构，生成当前阶段唯一可审核的结构化产物。",
    project: { id: text(project?.id, 300), title: text(project?.title, 300), episode: text(project?.episode, 100) },
    mode,
    dialoguePolicy: DEFAULT_DIALOGUE_POLICY,
    creativeControls: normalizeCreativeControls(input),
    market: normalizeMarket(input),
    stageParticipation: normalizeStageOptions(input),
    currentStage: stage,
    userInput: asObject(input),
    approvedContext: prior,
  }, null, 2).slice(0, 180000);
}

function reviewSystemPrompt(stage, mode, input = {}) {
  return [
    "你是 PixelTale 的交叉审核 Agent。你不是润色员，也不是顺从的二次生成器；必须对上一个模型的产物进行独立、对抗式复核。",
    "输出严格 JSON，不要 Markdown、代码围栏或额外文字。",
    `检查阶段：${stage}；模式：${modeLabel(mode)}。`,
    "先独立重建本阶段验收标准，再逐项比对待审产物、用户规格和已确认上下文；不要因为产物写得流畅就默认通过。",
    "重点寻找：前后设定冲突、因果断裂、角色动机缺口、市场本土化错误、模式节奏偏离、悬念提前泄露和无法执行的空泛表达。",
    "只有 cross_validation、consistency、adversarial 三项均为 true，并且阶段专项检查均通过时，pass 才能为 true；发现任一硬伤必须 pass=false，并在 required_changes 中给出可执行修订意见。",
    creativeControlPrompt(input, mode),
    marketPrompt(input),
    stageParticipationPrompt(stage, input),
    "pass 只有在结构完整、因果清晰、可执行、符合模式节奏、没有把悬念提前解释，并且角色名、地名、社会细节和对白都符合目标市场时才为 true。",
    "TK 必查开头暴击、每集钩子、主动选择、反转和集尾悬念；长剧必查主线因果、人物弧线和伏笔回收位置。",
    "对白阶段还要检查英文是否自然口语化、是否保留中文剧情意图、是否像人物会说的话。",
    ...(stage === "title" ? ["剧名阶段必须检查恰好 5 个候选、名称不重复、五种风格确实拉开差异，并且每个候选都有风格、语气和理由。"] : []),
    '输出契约：{"pass":true,"score":0,"findings":["具体发现"],"required_changes":["必须修正的问题"],"checks":{"cross_validation":true,"consistency":true,"adversarial":true,"structure":true,"mode":true,"continuity":true,"dialogue":true,"localization":true}}',
  ].join("\n");
}

function reviewUserPrompt({ stage, mode, artifact, previousArtifacts, input }) {
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
    creativeControls: normalizeCreativeControls(input),
    market: normalizeMarket(input),
    stageParticipation: normalizeStageOptions(input),
    artifact,
    approvedContext: previousArtifacts.map((item) => ({ stage: item.stage, content: item.content })).slice(-6),
  }, null, 2).slice(0, 180000);
}

function visualAssetSystemPrompt(mode, input = {}) {
  return [
    "你是 PixelTale 的视觉资产设计 Agent。根据已确认的全剧结构，整理供大模型解析与文生图使用的主要重复资产。",
    "只收在全剧中重复出现或明确需要保持连续性的主要人物、场景、道具，不收一次性背景和临时群众。",
    "输出严格 JSON，不要 Markdown、代码围栏或解释。字段值使用中文；name_en 可使用英文；prompt_zh 必须是可直接用于文生图的完整中文画面描述，不含剧情台词。",
    `当前模式：${modeLabel(mode)}。人物要锁定外观、服装、识别色与姿态；场景要锁定光线、色调、材质、空间布局与氛围；道具要锁定材质、形态、尺寸与特殊质感。`,
    marketPrompt(input),
    '输出契约：{"characters":[{"id":"P01","name_zh":"中文名","name_en":"English name","type":"人物","aliases":"别名","gender":"性别","age_phase":"年龄相","body":"体型","hair_color":"发型发色","facial_features":"面部特征","eye_color":"瞳色","costume_accessories":"服装配饰","palette":"识别色","posture":"气质姿态","prompt_zh":"中文文生图提示词"}],"scenes":[{"id":"S01","name_zh":"场景名","name_en":"English name","type":"场景","aliases":"别名","indoor_outdoor":"室内外","lighting":"光线","palette":"色调","materials":"建筑材质","layout":"空间布局","atmosphere":"氛围气味","prompt_zh":"中文文生图提示词"}],"props":[{"id":"PR01","name_zh":"道具名","name_en":"English name","type":"道具","aliases":"别名","materials":"材质","appearance":"颜色形态","size":"尺寸","texture":"特殊质感","prompt_zh":"中文文生图提示词"}],"consistency_notes":["全剧统一视觉规则"]}',
  ].join("\n");
}

function visualAssetUserPrompt({ mode, input, approvedArtifacts, project }) {
  return JSON.stringify({
    task: "从已确认的全剧结构中提取并补全视觉资产设计，确保同一资产在不同单元中可复用且外观连续。",
    project,
    mode,
    market: normalizeMarket(input),
    approvedArtifacts: approvedArtifacts.map((item) => ({ stage: item.stage, content: item.content })),
  }, null, 2).slice(0, 240000);
}

function visualAssetReviewSystemPrompt(mode, input = {}) {
  return [
    "你是 PixelTale 的视觉资产复核 Agent。检查视觉资产文档数据，不要重写全文。",
    "输出严格 JSON，不要 Markdown、代码围栏或额外文字。",
    `当前模式：${modeLabel(mode)}。检查重复资产筛选、编号唯一性、字段完整性、人物与场景连续性、文生图提示词可执行性。`,
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

function validateContent(stage, content) {
  const value = asObject(content);
  const required = {
    brief: ["title_zh", "logline_zh", "core_conflict_zh", "viewer_question_zh"],
    title: ["candidates"],
    proposal: ["title_zh", "premise_zh", "viewer_question_zh", "first_impact_zh", "episode_hook_zh"],
    characters: ["characters", "relationships", "world_rules"],
    arc: ["units", "arc_summary_zh"],
    scenes: ["scenes"],
    dialogue: ["lines", "localization_checks"],
  }[stage] || [];
  const missing = required.filter((key) => value[key] === undefined || value[key] === null || (typeof value[key] === "string" && !value[key].trim()) || (Array.isArray(value[key]) && value[key].length === 0));
  if (missing.length) {
    const error = new Error(`${stage} 产物缺少必填字段：${missing.join(", ")}`);
    error.code = "SCHEMA_INVALID";
    throw error;
  }
  if (stage === "title") {
    const candidates = asArray(value.candidates).map((candidate) => asObject(candidate));
    const names = candidates.map((candidate) => text(candidate.title_zh, 200)).filter(Boolean);
    const invalid = candidates.length !== 5
      || names.length !== 5
      || new Set(names).size !== 5
      || candidates.some((candidate) => !text(candidate.style_zh, 200) || !text(candidate.tone_zh, 300) || !text(candidate.reason_zh, 1000));
    if (invalid) {
      const error = new Error("剧名产物必须包含 5 个不重复且说明完整的候选");
      error.code = "SCHEMA_INVALID";
      throw error;
    }
    return {
      ...value,
      candidates: candidates.map((candidate) => ({
        title_zh: text(candidate.title_zh, 200),
        style_zh: text(candidate.style_zh, 200),
        tone_zh: text(candidate.tone_zh, 300),
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

function validateReview(value) {
  const review = asObject(value);
  if (typeof review.pass !== "boolean" || !Number.isFinite(Number(review.score)) || !Array.isArray(review.findings) || !Array.isArray(review.required_changes)) {
    const error = new Error("复核产物缺少 pass、score、findings 或 required_changes");
    error.code = "SCHEMA_INVALID";
    throw error;
  }
  const checks = asObject(review.checks);
  const hardChecks = ["cross_validation", "consistency", "adversarial"];
  const missingHardChecks = hardChecks.filter((key) => checks[key] !== true);
  const requiredChanges = review.required_changes.map((item) => text(item, 1000)).filter(Boolean).slice(0, 20);
  if (review.pass && missingHardChecks.length) {
    requiredChanges.unshift(`交叉审核硬门槛未满足：${missingHardChecks.join("、")}`);
  }
  return {
    pass: review.pass && missingHardChecks.length === 0,
    score: Math.max(0, Math.min(100, Number(review.score))),
    findings: review.findings.map((item) => text(item, 1000)).filter(Boolean).slice(0, 20),
    required_changes: requiredChanges,
    checks,
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

async function callProvider({ provider, system, user, env = process.env, fetchImpl = globalThis.fetch }) {
  const routeValue = text(provider, 100).toLowerCase();
  const resolvedProvider = MODEL_PROVIDER_MAP[routeValue] || routeValue;
  const config = { ...providerConfig(resolvedProvider, env), model: MODEL_PROVIDER_MAP[routeValue] ? routeValue : providerConfig(resolvedProvider, env).model };
  if (!config.key) throw new ProviderError(`${config.label} 未配置 API Key`, { code: "PROVIDER_NOT_CONFIGURED" });
  if (typeof fetchImpl !== "function") throw new ProviderError("当前运行时没有 fetch", { code: "FETCH_UNAVAILABLE" });
  const timeoutMs = Math.max(5000, Number(env.PIXELTALE_MODEL_TIMEOUT_MS || 120000));
  const maxRetries = Math.max(0, Math.min(1, Number(env.PIXELTALE_MAX_RETRIES ?? 1)));
  const directAnthropic = resolvedProvider === "claude" && config.protocol === "anthropic";
  const endpoint = directAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;
  const body = directAnthropic
    ? {
      model: config.model,
      max_tokens: 12000,
      temperature: 0.25,
      system,
      messages: [{ role: "user", content: user }],
    }
    : {
      model: config.model,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      };
      if (directAnthropic) {
        headers["x-api-key"] = config.key;
        headers["anthropic-version"] = env.PIXELTALE_ANTHROPIC_VERSION || "2023-06-01";
        delete headers.Authorization;
      }
      let response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
      let raw = await response.text();
      if (!directAnthropic && response.status === 400 && /response_format|json_object/i.test(raw)) {
        const compatibilityBody = { ...body };
        delete compatibilityBody.response_format;
        response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(compatibilityBody), signal: controller.signal });
        raw = await response.text();
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if ((response.status === 401 || response.status === 403) || !retryable || attempt >= maxRetries) {
          throw new ProviderError(`${config.label} HTTP ${response.status}: ${raw.slice(0, 500)}`, { status: response.status, retryable: false, code: response.status === 401 || response.status === 403 ? "AUTH_ERROR" : "HTTP_ERROR" });
        }
        continue;
      }
      const payload = parseJson(raw, `${config.label} 响应`);
      const content = responseContent(payload);
      if (!content) throw new ProviderError(`${config.label} 响应没有可解析内容`, { retryable: attempt < maxRetries, code: "EMPTY_RESPONSE" });
      try {
        return { provider: resolvedProvider, model: config.model, content: parseJson(content, `${config.label} 输出`), attempts: attempt };
      } catch (error) {
        if (attempt >= maxRetries) throw error;
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        if (attempt >= maxRetries) throw new ProviderError(`${config.label} 请求超时（${Math.round(timeoutMs / 1000)} 秒）`, { retryable: false, code: "TIMEOUT" });
        continue;
      }
      if (error instanceof ProviderError) {
        if (error.code === "INVALID_JSON" && attempt < maxRetries) continue;
        throw error;
      }
      if (attempt >= maxRetries) throw new ProviderError(`${config.label} 请求失败：${error.message}`, { retryable: false, code: "NETWORK_ERROR" });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ProviderError(`${config.label} 请求失败`, { code: "PROVIDER_ERROR" });
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
    input: { ...asObject(source.input), ...normalizeCreativeControls(source.input), ...normalizeMarket(source.input), ...normalizeStageOptions(source.input) },
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

function publicState(state, env) {
  const configuredProviders = providerStatus(env);
  const publicProviderStatus = Object.fromEntries(PROVIDERS.map((provider) => [provider, {
    provider,
    configured: !!configuredProviders[provider]?.configured,
  }]));
  return {
    ...state,
    artifacts: asArray(state.artifacts).map(publicArtifact),
    runs: asArray(state.runs).map(publicRun),
    providerStatus: publicProviderStatus,
  };
}

function artifactForStage(state, stage) {
  return state.artifacts.filter((artifact) => artifact.stage === stage).sort((a, b) => Number(a.version || 0) - Number(b.version || 0)).at(-1) || null;
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
    const artifact = approvedForStage(state, stage);
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
  const env = options.env || process.env;
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || (() => new Date());
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const readPixelTaleState = options.readPixelTaleState;
  const writePixelTaleState = options.writePixelTaleState;
  const writeHandoffFile = options.writeHandoffFile || (() => "");
  const writeVisualAssetDocument = options.writeVisualAssetDocument;
  const writeScriptDocument = options.writeScriptDocument;
  if (typeof readPixelTaleState !== "function" || typeof writePixelTaleState !== "function") throw new Error("PixelTale Agent 缺少独立 state adapter");

  function stateFor(params) {
    return readState({
      ...params,
      stateRoot: params.pixelTaleRoot || params.episodeRoot,
      readPixelTaleState,
      writePixelTaleState,
      now,
    });
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
    return publicState(state, env);
  }

  async function run(params = {}) {
    const projectId = text(params.projectId, 500);
    const stage = normalizeStage(params.stage);
    const state = stateFor({ ...params, projectId, mode: params.mode || params.input?.mode });
    const mode = normalizeMode(params.mode || params.input?.mode || state.mode);
    const routes = params.routes ? normalizeRoutes(params.routes) : normalizeRoutes(state.routes);
    state.mode = mode;
    state.routes = routes;
    state.input = {
      ...asObject(state.input),
      ...asObject(params.input),
      ...normalizeCreativeControls({ ...asObject(state.input), ...asObject(params.input) }),
      ...normalizeMarket({ ...asObject(state.input), ...asObject(params.input) }),
      ...normalizeStageOptions({ ...asObject(state.input), ...asObject(params.input) }),
    };
    state.updatedAt = nowIso(now);
    const startedAt = nowIso(now);
    const runId = id("run", randomUUID);
    const route = stageRoute(stage, mode, routes);
    const previousArtifacts = STAGES.map((item) => approvedForStage(state, item)).filter(Boolean);
    const errors = [];
    let retryCount = 0;
    let primary;
    let review;
    let primaryArtifact;
    let reviewArtifact;
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
      primary = await callProvider({
        provider: route.primary,
        system: stageSystemPrompt(stage, mode, state.input),
        user: stageUserPrompt({ stage, mode, input: state.input, previousArtifacts, project: params.project }),
        env,
        fetchImpl,
      });
      retryCount += primary.attempts || 0;
      const content = validateContent(stage, primary.content);
      const version = state.artifacts.filter((artifact) => artifact.stage === stage && artifact.type === `pixeltale_${stage}`).length + 1;
      primaryArtifact = buildArtifact({ stage, mode, input: state.input, content, model: `${primary.provider}:${primary.model}`, version, now, randomUUID });
      review = await callProvider({
        provider: route.reviewer,
        system: reviewSystemPrompt(stage, mode, state.input),
        user: reviewUserPrompt({ stage, mode, input: state.input, artifact: primaryArtifact, previousArtifacts }),
        env,
        fetchImpl,
      });
      retryCount += review.attempts || 0;
      const reviewContent = validateReview(review.content);
      reviewArtifact = buildReviewArtifact({ stage, review: reviewContent, model: `${review.provider}:${review.model}`, version, now, randomUUID, primaryArtifactId: primaryArtifact.id });
      primaryArtifact.status = reviewContent.pass ? "ready" : "needs_review";
      primaryArtifact.reviewId = reviewArtifact.id;
      state.artifacts.push(primaryArtifact, reviewArtifact);
      const runStatus = reviewContent.pass ? "completed" : "needs_review";
      const record = { runId, stage, mode, route, status: runStatus, primaryModel: `${primary.provider}:${primary.model}`, reviewModel: `${review.provider}:${review.model}`, artifactIds: [primaryArtifact.id, reviewArtifact.id], errors, retryCount, startedAt, completedAt: nowIso(now) };
      state.runs.push(record);
      persistState(params, state);
      return { ...publicRun(record), artifacts: [primaryArtifact, reviewArtifact].map(publicArtifact), state: publicState(state, env) };
    } catch (error) {
      errors.push({ code: error.code || "RUN_FAILED", message: error.message });
      if (primaryArtifact && !state.artifacts.some((artifact) => artifact.id === primaryArtifact.id)) state.artifacts.push(primaryArtifact);
      const record = { runId, stage, mode, route, status: "failed", primaryModel: primary ? `${primary.provider}:${primary.model}` : modelForRoute(route.primary, env), reviewModel: review ? `${review.provider}:${review.model}` : modelForRoute(route.reviewer, env), artifactIds: primaryArtifact ? [primaryArtifact.id] : [], errors, retryCount, startedAt, completedAt: nowIso(now) };
      state.runs.push(record);
      state.updatedAt = nowIso(now);
      persistState(params, state);
      return { ...publicRun(record), artifacts: primaryArtifact ? [primaryArtifact].map(publicArtifact) : [], state: publicState(state, env) };
    }
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
      const error = new Error(`请先确认“${requiredStage}”阶段的产物`);
      error.code = "STAGE_OUT_OF_ORDER";
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
      if (!selectedTitle || !candidates.some((candidate) => text(candidate?.title_zh, 200) === selectedTitle)) {
        const error = new Error("请从 5 个候选中选择一个剧名");
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
    return { artifact: publicArtifact(artifact), state: publicState(state, env) };
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
        env,
        fetchImpl,
      });
      visualAssets = validateVisualAssets(primary.content);
      const review = await callProvider({
        provider: visualRoute.reviewer,
        system: visualAssetReviewSystemPrompt(state.mode, state.input),
        user: visualAssetReviewUserPrompt({ mode: state.mode, input: state.input, visualAssets }),
        env,
        fetchImpl,
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
    return { handoff, payload, state: publicState(state, env) };
  }

  function saveSettings(params = {}) {
    const state = stateFor(params);
    if (params.mode) state.mode = normalizeMode(params.mode);
    if (params.routes) state.routes = normalizeRoutes(params.routes);
    if (params.input) {
      state.input = {
        ...asObject(state.input),
        ...asObject(params.input),
        ...normalizeCreativeControls({ ...asObject(state.input), ...asObject(params.input) }),
        ...normalizeMarket({ ...asObject(state.input), ...asObject(params.input) }),
        ...normalizeStageOptions({ ...asObject(state.input), ...asObject(params.input) }),
      };
    }
    state.updatedAt = nowIso(now);
    persistState(params, state);
    return publicState(state, env);
  }

  return { status, run, approve, handoff, saveSettings, providerStatus: () => providerStatus(env), constants: { STAGES, DEFAULT_ROUTES, DEFAULT_DIALOGUE_POLICY } };
}

module.exports = {
  createPixelTaleAgent,
  callProvider,
  providerConfig,
  providerStatus,
  normalizeMode,
  normalizeRoutes,
  validateContent,
  validateReview,
  stageRoute,
  STAGES,
};
