"use strict";

// Seedance 2.0 导演引擎(视频提示词拆解)——方法蒸馏自 Emily2040/seedance-2.0 Skill OS
// (MIT,见 references/seedance/NOTICE.md)。核心参考:directing-engine.md、prompt-compiler.md、
// vocab/zh.md、reference-transfer-contract.md。
//
// 本模块只提供「拆解的脑」:一段注入 storyboard 模型的中文系统提示词 + 模型返回 design 字段的规整器。
// 项目最终仍产出既有的 14 字段 JSON 提示词(壳不变),字段内容由模型按导演引擎判断填充,
// 缺失时上层回退到原关键词启发式(零回归)。

// 模型需要按导演引擎输出的每镜字段(与 SEEDANCE_JSON_PROMPT_FIELDS 中「模型驱动」的 11 项对应;
// style 由资产风格锁定、dialogue 由对白行生成、duration 由后端计算,均不交给这里)。
const SEEDANCE_DESIGN_FIELDS = [
  "scene",
  "subject",
  "action",
  "camera_movement",
  "motion_intensity",
  "environment",
  "lighting",
  "effects",
  "color_palette",
  "mood",
  "sound",
];

const MOTION_INTENSITY_VALUES = new Set(["low", "medium", "high"]);

function compact(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

// 默认开启;设 PIXEL_TOYS_SEEDANCE_DIRECTOR=0 / false / off 回退纯启发式。
function seedanceDirectorEnabled() {
  const raw = String(process.env.PIXEL_TOYS_SEEDANCE_DIRECTOR ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

// 把模型返回的 design 规整成「字段名 → 字符串」的干净对象:只保留白名单键、压平空白、
// motion_intensity 约束为 low/medium/high(非法值丢弃让上层回退)、空值不保留。
function sanitizeSeedanceDesign(design) {
  if (!design || typeof design !== "object" || Array.isArray(design)) return {};
  const out = {};
  for (const key of SEEDANCE_DESIGN_FIELDS) {
    const value = compact(design[key]);
    if (!value) continue;
    if (key === "motion_intensity") {
      const level = value.toLowerCase();
      if (MOTION_INTENSITY_VALUES.has(level)) out[key] = level;
      continue;
    }
    out[key] = value;
  }
  return out;
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

按上述方法，为每个镜头输出一个 design 对象（字段值用具体中文、不用感觉词）：
- scene：本镜剧情与所在空间的一句话。
- subject：主体人物 + 关键道具 + 构图/站位。
- action：一个明确的可见动作与其终点（本镜只做这一件事，不重演已完成、不预演未发生）。
- camera_movement：景别 + 焦段 + 机位/高度 + 运镜（用具体词：中近景、长焦压缩、低角度仰拍、缓慢推镜、横向跟拍、过肩、手持呼吸感…）。
- motion_intensity：low / medium / high（三选一）。
- environment：空间方向、站位、道具状态与场景纵深如何保持连续。
- lighting：光源方向 + 色温 + 光比 + 阴影层次（有可信来源）。
- effects：仅呈现剧本明确出现的能量/烟雾/震动/粒子/光晕/环境变化，否则写「无特效」。
- color_palette：克制电影调色、主色一致、严格符合所选风格的色彩语言。
- mood：本镜的镜头目的与情绪（一句话意图的落点，仍写成具体的画面读法）。
- sound：环境底噪、空间混响、脚步、衣料、道具声与对白同步，音乐克制；写具体音效不写「氛围」。`;

// 从 Stage 1 序列化到 seedancePrompts 文档里的 JSON 块(jsonOnlySeedancePrompt 的输出:@图片行 + {json})
// 反解出 design 字段,供 Stage 2 buildVideoConfig 重建 shot 时复用(否则模型拆解会在两阶段间丢失)。
function parseSeedanceDesignFromPrompt(promptText) {
  const text = String(promptText == null ? "" : promptText);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return sanitizeSeedanceDesign(obj);
  } catch {
    return {};
  }
}

module.exports = {
  SEEDANCE_DESIGN_FIELDS,
  SEEDANCE_DIRECTOR_SYSTEM_ZH,
  sanitizeSeedanceDesign,
  parseSeedanceDesignFromPrompt,
  seedanceDirectorEnabled,
};
