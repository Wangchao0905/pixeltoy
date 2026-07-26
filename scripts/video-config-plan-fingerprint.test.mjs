// 回归:模型导演计划的剧本指纹,写入侧与校验侧必须用同一个输入。
// 2026-07-27 线上「生成视频配置一直失败」根因:buildModelShotPlanForConfig 写入时传
// compactLine(script),而 modelShotPlanNeedsRefresh 用原始 script 算 sha1。剧本必然
// 带换行 → 指纹永不相等 → needsRefresh 恒 true → 白跑约 160 秒模型调用后必抛
// 「模型导演设计生成失败,请稍后重新提交视频配置。」,该功能从上线起从未成功过。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const server = fs.readFileSync(new URL("server.js", root), "utf8");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing server function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

const design = {
  camera: "缓慢推近",
  lighting: "黎明冷光",
  action: "少年推开木门",
  mood: "肃穆",
  composition: "中景居中",
};

let written = "";
const context = {
  MODEL_SHOT_PLAN_VERSION: 3,
  written: null,
  compactLine: (value) => String(value || "").replace(/\s+/g, " ").trim(),
  sha1Text: (value) => crypto.createHash("sha1").update(String(value || ""), "utf8").digest("hex"),
  clampShotDuration: (value) => Number(value) || 8,
  sanitizeSeedanceDesign: (value) => ({ ...design, ...(value || {}) }),
  hasCompleteSeedanceDesign: () => true,
  defaultPaths: () => ({ modelShotPlan: "/tmp/model-shot-plan.json" }),
  writeText: (_path, text) => {
    written = text;
  },
  JSON,
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(
  [
    extractFunction(server, "function writeStoryboardModelPlan("),
    extractFunction(server, "function modelShotPlanNeedsRefresh("),
  ].join("\n"),
  context,
);

// 带空行和换行的真实剧本形态——正是触发这个 bug 的输入。
const script = "镜头一:黎明的山脊。\n\n少年推开木门,风雪灌入。\n镜头二:远景,经幡翻卷。";
const shots = [
  { id: "S01", title: "山脊", beat: "黎明", refs: ["char_boy"], videoDesign: design },
];

// 1) 写入后立刻校验:必须判定「无需刷新」,否则调用方会白跑模型再抛错。
context.writeStoryboardModelPlan("/tmp/ep", { model: "m", script, dialogueLanguage: "zh", shots });
const plan = JSON.parse(written);
assert.equal(
  context.modelShotPlanNeedsRefresh(plan, script),
  false,
  "刚写入的计划必须被判定为最新;若为 true 则「生成视频配置」永远失败",
);

// 2) 写入侧若多套一层 compactLine,校验就会失效——固化这个失败模式,防止改回去。
written = "";
context.writeStoryboardModelPlan("/tmp/ep", {
  model: "m",
  script: context.compactLine(script),
  dialogueLanguage: "zh",
  shots,
});
assert.equal(
  context.modelShotPlanNeedsRefresh(JSON.parse(written), script),
  true,
  "compactLine 后的指纹本就对不上原始 script——这条断言在说明为何写入侧不能压缩",
);

// 3) 静态锁:buildModelShotPlanForConfig 的写入调用不得再传 videoScript。
//    上面的功能断言测不到调用方传错变量,这条补上。
const builder = extractFunction(server, "async function buildModelShotPlanForConfig(");
const writeCall = builder.slice(builder.indexOf("writeStoryboardModelPlan("));
assert.doesNotMatch(
  writeCall,
  /script:\s*videoScript/,
  "buildModelShotPlanForConfig 必须传未压缩的 script,传 videoScript 会让指纹永不匹配",
);
assert.match(writeCall, /\n\s*script,/, "应直接透传原始 script");

// 4) 三处校验必须都以原始 script 为输入,任何一处改成压缩版都会重新引入这个 bug。
for (const signature of [
  "function modelShotPlanNeedsRefresh(",
  "function modelPlanDialogueLanguageForConfig(",
  "function modelShotPlanForConfig(",
]) {
  const fn = extractFunction(server, signature);
  assert.doesNotMatch(
    fn,
    /sha1Text\(compactLine\(script\)\)/,
    `${signature} 不应对 script 先压缩再算指纹`,
  );
  assert.match(fn, /sha1Text\(script\)/, `${signature} 应以原始 script 算指纹`);
}

console.log("video config plan fingerprint tests passed");
