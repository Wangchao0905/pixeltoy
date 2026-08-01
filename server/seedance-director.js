"use strict";

// Seedance 2.0 导演引擎(视频提示词拆解)——方法蒸馏自 Emily2040/seedance-2.0 Skill OS
// (MIT,见 references/seedance/NOTICE.md)。核心参考:directing-engine.md、prompt-compiler.md、
// vocab/zh.md、reference-transfer-contract.md。
//
// 本模块只提供「拆解的脑」：一段注入 storyboard 模型的中文系统提示词 + 模型返回 design 字段的规整器。
// API 返回可以是结构化对象，便于校验字段完整；最终交给 Seedance 的始终是中文自然语言镜头单。

// 模型输出的字段会被编译为自然语言视频提示词。资产风格、时长和人物台词由后端锁定，
// 不使用 JSON 作为最终提交提示词。
const SEEDANCE_DESIGN_FIELDS = [
  "shot_size",
  "camera_lens",
  "camera_movement",
  "camera_angle",
  "visual",
  "timeline",
  "voice_over",
  "sound",
];

function compact(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

function compactTimeline(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => compact(line))
    .filter(Boolean)
    .join("\n");
}

// 把模型返回的 design 规整成「字段名 → 字符串」的干净对象：只保留白名单键、压平空白、空值不保留。
function sanitizeSeedanceDesign(design) {
  if (!design || typeof design !== "object" || Array.isArray(design)) return {};
  const out = {};
  for (const key of SEEDANCE_DESIGN_FIELDS) {
    const value = key === "timeline" ? compactTimeline(design[key]) : compact(design[key]);
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

function hasCompleteSeedanceDesign(design) {
  const clean = sanitizeSeedanceDesign(design);
  return SEEDANCE_DESIGN_FIELDS.every((key) => !!clean[key]) &&
    ["起始", "推进", "终点"].every((phase) => new RegExp(`(?:^|\\n)${phase}\\s*[：:]\\s*\\S`, "u").test(clean.timeline));
}

// 注入 storyboard 系统提示词的导演引擎方法(中文)。指导模型对每个镜头做「导演式拆解」并输出 design。
const SEEDANCE_DIRECTOR_SYSTEM_ZH = `视频提示词拆解方法（Seedance 2.0 导演引擎，逐镜执行）：

一、导演阅读（先想清，不写进字段）：对每个镜头先回答——本镜在全剧的功能（建立/深化/转折/收束）、这一镜要交付的一个价值翻转（如安全→受威胁、希望→绝望、掌控→失控、平常→惊奇）、观众代入谁的视角与身体位置、权力在谁手里且如何移动、台词之外真正未说出口的潜台词。没有翻转的镜头应合并，不要为凑时长保留。

二、一个意图，所有器械同指：把这一镜的阅读凝成「一句话意图」（例：让观众感到她的笃定开始裂开）。景别、机位/高度、焦段、运镜、光比、光向、色温、调度站位、表演、声音、剪辑——每一项都必须服务这同一个意图；单项好看但各指一方 = AI 味废镜。

三、按场景功能选一套连贯器械（起点，再按本镜阅读微调）：
- 亲密对话：中近景/近景、平视、长焦、少运动、柔和有源主光、稀疏声音；表演靠一个克制的微动作。
- 对峙/权力：对立机位、用高度编码地位、长焦隔离、冷暖分光、调度收缩距离；静止即压迫，失态即转折。
- 揭示/发现：先遮再露——构图先藏，用运镜或光变揭开，镜头与主体一起发现；拍的是反应不是那个物件。
- 抉择/转折点：推镜隔离抉择者、世界安静下来、一个动作完成选择、光可在承诺瞬间变化。
- 到达/定场：中远景、有动机的环境光、一个把主体放进空间的运镜、环境声；靠体态与节奏在远处读出身份意图。
- 追逐/动作：跟拍或手持能量、严守画面方向、对比光、声音加厚；一个清晰的物理目标，见得到重量与代价。
- 转变/特效：锁定或受控机位让变化可读、光随变化走、一个原因一串可见后果。
- 情绪低点：距离与静止、冷调柔光、留白、近乎静默；镜头旁观不推进。

四、表演写成可见行为，不写情绪词：Seedance 只渲染看得见的行为。不要写「悲伤/紧张/震惊」，写那个证明它的真实动作（不是「悲伤」而是「她把信折平、双手压住、始终不抬头」）。每个短镜只给一个能承载转折的清晰动作，可用言行矛盾表达潜台词（一边同意一边后退）。

五、光与色是情绪不是亮度：光比（低比=安全开放，高比=私密受威胁）、光向（正面保护/侧面显露冲突/背逆光孤立/底光不安/顶光审判）、色温（暖=亲密记忆安全，冷=距离夜晚控制，同框冷暖=内在或关系撕裂）、每个光源要有可信来源（窗/灯/屏/日），场景翻转时让光一起翻转。色彩克制、主色一致=导演签名。

六、去 AI 味（硬性）：禁止使用空洞感觉词——「电影感、氛围感、高级感、大片感、质感（单用）、震撼、唯美、史诗级、绝美、超高清/8K/4K、杰作/顶级品质、酷炫转场」。一律拆成制造该效果的物理元素：材质、光线、色彩、空气、景别、运镜、光源、调色、具体空间尺度与人数、具体转场名称（匹配剪辑/硬切/甩镜）。

七、参考图与角色绑定：严格保留 @图片 等引用标签不改；每张参考各承担一个角色（人物=锁定主体身份，场景=场景氛围/空间，道具=形状颜色不变）；参考图已经展示的静态外观不要用文字重复描述，文字只写参考图承载不了的动作、运镜与变化。

按上述方法，为每个镜头输出一个 design 对象。以下 8 项必须全部存在，字段值用具体中文、不用感觉词：
- shot_size：景别，例如「双人侧面半身中近景」或「单人面部近景特写」。
- camera_lens：摄像机 / 镜头，例如「50mm 标准定焦」。
- camera_movement：运镜，写清方向、速度、幅度、持续时间；固定机位明确写「固定镜头」。
- camera_angle：机位视角，例如「侧前方微仰 15° 视角」。
- visual：画面。必须包含可见空间、人物或道具位置、一个可见动作及终点、构图裁切、光源/光线与连续性；不要用抽象情绪词代替事实。
- timeline：严格写 3 行动作节拍，依次为「起始：…」「推进：…」「终点：…」。每行只写一个可拍摄的动作或状态变化；终点必须是可见的落点，不要自行编造秒数，后端会按锁定时长换算为 0-X 秒时间线。
- voice_over：人声 OS；没有时明确写「无」。
- sound：具体音效与环境底噪；没有特殊音效时也要写保留的环境声。`;

module.exports = {
  SEEDANCE_DESIGN_FIELDS,
  SEEDANCE_DIRECTOR_SYSTEM_ZH,
  sanitizeSeedanceDesign,
  hasCompleteSeedanceDesign,
};
