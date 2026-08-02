import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const runner = fs.readFileSync(path.join(root, "scripts/run_asset_generation.js"), "utf8");

// 从源码里抠出单个纯函数并真正执行它。纯文本断言看不见 falsy-zero 这类缺陷:
// `String(0 || "")` 是 `""`,读代码时和 `String(0)` 长得一样。
function evalHelper(name) {
  const start = runner.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} 必须存在,超时/重试策略靠它收口`);
  const end = runner.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${name} 的函数体必须完整`);
  return new Function(`return (${runner.slice(start, end + 2)})`)();
}

assert.match(
  runner,
  /PIXEL_TOYS_STORYBOARD_IMAGE_TIMEOUT_SECONDS \|\| "900"/,
  "故事板是最慢的资产类型(一次画完 9 格),预算不能低于其它单图资产",
);
assert.match(
  runner,
  /PIXEL_TOYS_STORYBOARD_RESCUE_TIMEOUT_SECONDS \|\| "300"/,
  "参考板兜底路线比主路线快,可以用更短的预算,但仍需容得下实测的 56s 级耗时",
);
assert.match(
  runner,
  /function boundedStoryboardTimeoutSeconds\(/,
  "故事板超时需要独立的上下限函数,便于与其它资产分别调参",
);
const fallbackStart = runner.indexOf("function shouldFallbackStoryboardToText(");
const fallbackEnd = runner.indexOf("\n}\n\nasync function main", fallbackStart);
const fallback = runner.slice(fallbackStart, fallbackEnd);
assert.doesNotMatch(
  fallback,
  /request_timeout|timed out|超时/,
  "已超时的故事板请求必须直接失败,不能再花一整个预算走兜底路线",
);
assert.match(
  runner,
  /const STORYBOARD_IMAGE_RETRIES = 0/,
  "单次故事板请求应当明确失败,而不是静默再等一个完整预算",
);

// ——— 行为断言:上面那条只证明常量写着 0,不证明**生效**的重试次数是 0 ———
// 生产实证:声明 0 次重试的任务,总耗时恒为 373s = 180 + 12(退避) + 180,
// 也就是实际重试了 1 次。根因是 String(value || "") 把 0 变成了空串。
const boundedRetryCount = evalHelper("boundedRetryCount");
assert.equal(boundedRetryCount(0, 1), 0, "显式的 0 次重试必须生效:0 是 falsy,不能被 fallback 吞掉");
assert.equal(boundedRetryCount(2, 1), 2, "正常取值照常透传");
assert.equal(boundedRetryCount(undefined, 2), 2, "缺省时才回落到 fallback");
assert.equal(boundedRetryCount("", 2), 2, "空串视为未配置");
assert.equal(boundedRetryCount(99, 2), 4, "重试次数仍有上限,避免无限放大等待");

const boundedStoryboardTimeoutSeconds = evalHelper("boundedStoryboardTimeoutSeconds");
assert.equal(
  boundedStoryboardTimeoutSeconds(900, 900),
  900,
  "上限不得把默认预算夹掉:生产上 7 次连续失败都是被 180s 硬顶砍断的",
);
assert.equal(
  boundedStoryboardTimeoutSeconds(600, 900),
  600,
  "环境变量必须真的可调,而不是被静默改写成另一个数",
);
assert.equal(boundedStoryboardTimeoutSeconds(5, 900), 60, "过小的取值抬到下限,避免一提交就超时");
assert.equal(boundedStoryboardTimeoutSeconds(99999, 900), 900, "仍需封顶,防止一个请求长期占住 worker");

console.log("storyboard image timeout tests passed");
