// 视频配置的参考图缺失必须分级：人物/场景/故事板缺图拦截提交，道具/插入图缺图允许文本兜底。
//
// 病史（2026-07-31）：有人把「缺参考图就 throw」改成「静默剔除引用 + 只记 warning」，
// 于是资产图没生成好时，配置照样返回"成功"，引用被悄悄清空，用户拿去生成一批
// 没有人物参考的废片。CLAUDE.md 的约束是「缺图或验证失败时阻止提交，不能静默删除引用后继续生成」。
// 一刀切恢复 throw 又太糙：少一张道具图不该卡死整个配置。所以按资产类型分级。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

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

// 真实的 inferAssetTypeFromName / assetTypeForLookupRecord 一起装进沙箱——分级判断
// 完全依赖它们，用替身就测不到「C001 是人物、P001 是道具」这层。
const context = {
  Map,
  Set,
  path,
  compactLine: (value) => String(value || "").trim(),
  sha1Text: (value) => `sha1:${String(value || "")}`,
  assetLookupFromAssets: (assets = []) => new Map(assets.map((asset) => [asset.name, asset])),
  sanitizeSeedanceDesign: (design) => design || {},
  hasCompleteSeedanceDesign: (design) => design?.complete === true,
  clampShotDuration: (value) => Number(value) || 8,
  sceneRefForShotRefs: (refs = [], lookup) => refs.find((ref) => lookup.get(ref)?.manifestType === "Scene") || "",
  normalizeAssetType: (value, fallback) => value || fallback,
};
vm.createContext(context);
for (const signature of [
  "function inferAssetTypeFromName(",
  "function assetTypeForLookupRecord(",
  "const BLOCKING_ASSET_TYPES =",
  "function blockingRefsMissing(",
  "function modelShotPlanForConfig(",
]) {
  vm.runInContext(extractFunction(server, signature), context, { filename: "server.js" });
}

const plannedShot = (id, refs) => ({ id, title: id, beat: `${id} beat`, duration: 8, refs, design: { complete: true } });
const buildPlan = (refs, assets) =>
  context.modelShotPlanForConfig({
    modelPlan: { scriptFingerprint: "sha1:script", dialogueLanguage: "en", model: "test", shots: [plannedShot("V001", refs)] },
    script: "script",
    dialogueLanguage: "en",
    assets,
  });

const CHARACTER = "C001_HERO_CHARACTER_SHEET";
const SCENE = "S001_ROOM_WIDE_ESTABLISHING";
const PROP = "P001_KNIFE_PROP_REF";
const INSERT = "I001_NOTE_INSERT_REF";

// 分级的前提：类型必须能只靠资产名推断出来（缺失的 ref 在 lookup 里没有记录）。
assert.equal(context.assetTypeForLookupRecord(null, CHARACTER), "Character", "C### 资产名应判为人物");
assert.equal(context.assetTypeForLookupRecord(null, SCENE), "Scene", "S### 资产名应判为场景");
assert.equal(context.assetTypeForLookupRecord(null, PROP), "Prop", "P### 资产名应判为道具");
assert.equal(context.assetTypeForLookupRecord(null, INSERT), "Insert", "I### 资产名应判为插入图");
// 沙箱里的 const 不会挂到 context 对象上，要显式求值取出来。
const blockingTypes = vm.runInContext("BLOCKING_ASSET_TYPES", context);
assert.ok(blockingTypes.has("Character"), "人物必须属于拦截类型");
assert.ok(blockingTypes.has("Scene"), "场景必须属于拦截类型");
assert.ok(!blockingTypes.has("Prop"), "道具不该拦截整个配置");
assert.ok(!blockingTypes.has("Insert"), "插入图不该拦截整个配置");

// 主体资产(人物/场景)缺图**不再阻塞**视频配置生成。
// 2026-08-03 产品决定:配置是剧本层面的产物,和图画完没画完无关。缺图记进
// unavailableRefs → referenceWarnings 提示,真正的闸门在 configReadiness
// (提交出片时报「缺少资产图：<name>」)。缺图在那一步才真正致命。
// BLOCKING_ASSET_TYPES 的分类仍然有效——它现在用于区分"该进警告"和"可静默剔除"。
const missingCharacter = buildPlan([CHARACTER, SCENE], [{ name: SCENE, manifestType: "Scene" }]);
assert.deepEqual(missingCharacter.shots[0].unavailableRefs, [CHARACTER], "人物图缺失必须记入 unavailableRefs 供 warning 使用");
assert.deepEqual(missingCharacter.shots[0].refs, [SCENE], "人物图缺失时其余引用要保留");

const missingScene = buildPlan([CHARACTER, SCENE], [{ name: CHARACTER, manifestType: "Character" }]);
assert.deepEqual(missingScene.shots[0].unavailableRefs, [SCENE], "场景图缺失必须记入 unavailableRefs");
assert.deepEqual(missingScene.shots[0].refs, [CHARACTER], "场景图缺失时其余引用要保留");

// 放过：道具/插入图缺失，剔除引用但保留诊断信息。
const propResult = buildPlan([CHARACTER, PROP], [{ name: CHARACTER, manifestType: "Character" }]);
assert.deepEqual(propResult.shots[0].refs, [CHARACTER], "道具缺失时人物引用要保留");
assert.deepEqual(propResult.shots[0].unavailableRefs, [PROP], "缺失的道具要记入 unavailableRefs 供 warning 使用");

const insertResult = buildPlan([SCENE, INSERT], [{ name: SCENE, manifestType: "Scene" }]);
assert.deepEqual(insertResult.shots[0].unavailableRefs, [INSERT], "插入图缺失不该拦截，但要记录");

// 资产齐全：引用完整、不遗漏，sceneRef 正确解析。这是「确保引用的都是最新资产且没有遗漏」的正面用例。
const okResult = buildPlan([CHARACTER, SCENE], [
  { name: CHARACTER, manifestType: "Character" },
  { name: SCENE, manifestType: "Scene" },
]);
assert.deepEqual(okResult.shots[0].refs, [CHARACTER, SCENE], "资产齐全时引用不得被剔除");
assert.deepEqual(okResult.shots[0].unavailableRefs, [], "资产齐全时不应有缺失项");
assert.equal(okResult.shots[0].sceneRef, SCENE, "场景引用要能被解析出来");

// 缺图不得再 throw:那道闸门已移到 configReadiness(提交出片时)。
// 这里反向锁住,防止有人"修回去"又把配置生成堵死。
const planFunction = extractFunction(server, "function modelShotPlanForConfig(");
assert.doesNotMatch(planFunction, /throw new Error\(`视频配置引用校验失败/, "缺主体资产图不得阻塞视频配置生成");
assert.match(planFunction, /unavailableRefs: missingRefs/, "缺失引用必须回传,供 referenceWarnings 提示");
assert.match(server, /missing\.push\(`缺少资产图：\$\{clean\}`\)/, "真正的闸门必须留在 configReadiness");

// 分镜 plan 必须绑资产清单指纹，否则资产图重新生成后 plan 被当成"还新鲜"直接复用，
// 引用里全是旧资产名——这就是「生成视频配置没用上最新资产图」的另一半根因。
// 光断言字符串出现不够——把比对表达式替换成 false 仍能通过。直接跑真函数验行为。
const refreshContext = {
  compactLine: (value) => String(value || "").trim(),
  sha1Text: (value) => `sha1:${String(value || "")}`,
};
vm.createContext(refreshContext);
vm.runInContext(extractFunction(server, "function modelShotPlanNeedsRefresh("), refreshContext, { filename: "server.js" });
const freshPlan = { scriptFingerprint: "sha1:script", durationMode: "tk", assetManifestFingerprint: "fp-old" };
assert.equal(
  refreshContext.modelShotPlanNeedsRefresh(freshPlan, "script", "tk", "fp-old"),
  false,
  "指纹一致时不该重建 plan",
);
assert.equal(
  refreshContext.modelShotPlanNeedsRefresh(freshPlan, "script", "tk", "fp-new"),
  true,
  "资产清单指纹变化后 plan 必须重建，否则视频引用会沿用旧资产图",
);
// 写入侧漏存指纹的话，plan 里永远是空值，比对恒不相等 → 重试两次后抛
// 「资产清单在视频配置期间发生变化」，视频配置会彻底生成不出来。
assert.match(
  extractFunction(server, "function writeStoryboardModelPlan("),
  /assetManifestFingerprint:/,
  "plan 写入时必须存下资产清单指纹，否则新鲜度比对恒不相等，视频配置永远失败",
);

console.log("video config reference tier guard tests passed");
