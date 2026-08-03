import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 火山会把「明显不含真人」的图也判成真人——卡通风景照实测同样中招。
// 而 isArkPersonReferenceAsset 只放行「AI 生成的超写实人物」,风景/卡通
// 两道判据都不过 → 从不认证 → 原图直传 → 被误判后只能报错收场。
// 修法是反应式的:那个 400 本身就是火山说「我看到人了」,拿它当触发条件
// 强制认证成 asset:// 再重试一次。这个测试锁住整条链路都在。

const root = new URL("..", import.meta.url).pathname;
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

// --- 1) 三个 helper 必须存在 ---
assert.match(server, /function isArkRealPersonRejection\(error\)/, "必须有拒绝识别函数");
assert.match(server, /async function certifyCanvasAssetsForRealPersonRetry\(body = \{\}\)/, "必须有强制认证函数");
assert.match(server, /async function submitArkVideoWithRealPersonRetry\(body, submitOnce\)/, "必须有提交重试包装");

// --- 2) 两个 Ark 提交入口都必须走重试包装,不能直接裸提交 ---
for (const [label, fnName] of [
  ["中国区 Ark", "createArkCanvasVideoGeneration"],
  ["BytePlus Ark", "createBytePlusArkCanvasVideoGeneration"],
]) {
  const start = server.indexOf(`async function ${fnName}(body = {}) {`);
  assert.notEqual(start, -1, `${fnName} 必须存在`);
  const bodyText = server.slice(start, start + 900);
  assert.match(bodyText, /submitArkVideoWithRealPersonRetry\(body, async \(submitBody\) =>/, `${label} 必须经由重试包装提交`);
  // payload 必须用重试传入的 submitBody 构造,否则第二次提交仍是未认证的旧 body
  assert.match(bodyText, /buildSeedanceGenerationPayload\(\s*\{?\s*\.\.\.submitBody|buildSeedanceGenerationPayload\(submitBody\)/, `${label} 必须用 submitBody 构造 payload`);
}

// --- 3) 强制认证必须绕过资格判据,否则风景图仍然认证不了 ---
const certStart = server.indexOf("async function certifyCanvasAssetsForRealPersonRetry");
const certBody = server.slice(certStart, certStart + 2200);
assert.match(
  certBody,
  /ensureBatchArkVirtualPerson\(asset, deadlineTs, \{ forceRealPersonVerification: true \}\)/,
  "必须以 forceRealPersonVerification 强制认证:否则卡通/风景过不了 isArkPersonEligibleAsset",
);
assert.match(certBody, /if \(arkPersonAssetReadyUrl\(asset\)\)/, "已有可用 asset:// 的不得重复认证");
assert.match(certBody, /mediaType === "video"/, "视频资产不能进人像库,必须跳过");
assert.match(certBody, /enabled: true/, "认证成功必须把 arkPersonAsset.enabled 置真,否则提交时取不到 asset://");
assert.match(certBody, /status: "active"/, "必须写入 active 状态:arkPersonAssetReadyUrl 只认 active");

// --- 4) 认证一张都没成功时必须抛回原错误,不能吞掉 ---
const submitStart = server.indexOf("async function submitArkVideoWithRealPersonRetry");
const submitBody = server.slice(submitStart, submitStart + 900);
assert.match(submitBody, /if \(!isArkRealPersonRejection\(error\)\) throw error;/, "非真人拒绝必须原样抛出");
assert.match(submitBody, /if \(!certified\.length\) throw error;/, "一张都没认证成功时必须抛回原错误");

// --- 5) 行为验证:拒绝识别必须覆盖真实报文,且不能误伤其它错误 ---
const detect = (text) => /InputImageSensitiveContentDetected\.PrivacyInformation|input image may contain real person|真实人物|可能包含真实人物/i.test(text);
for (const hit of [
  "InputImageSensitiveContentDetected.PrivacyInformation",
  "The input image may contain real person",
  "参考图可能包含真实人物",
]) {
  assert.equal(detect(hit), true, `必须识别为真人拒绝：${hit}`);
}
for (const miss of [
  "OutputAudioSensitiveContentDetected",
  "copyright restriction",
  "invalid token",
  "rate limit exceeded",
]) {
  assert.equal(detect(miss), false, `不得误判为真人拒绝：${miss}`);
}

// --- 6) 提示语必须反映"已自动重试",不能再说"AI 标记无用" ---
assert.doesNotMatch(server, /AI 生成标记不会改变平台审核结果/, "旧提示语误导:asset:// 确实能绕过审核");
assert.match(server, /系统已尝试把参考图认证为方舟私域虚拟人像/, "提示语必须说明已自动认证重试");

console.log("ark real-person retry tests passed");
