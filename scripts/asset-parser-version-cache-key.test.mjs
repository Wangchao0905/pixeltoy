// ASSET_PARSER_VERSION 是「已解析过的清单可以复用」的缓存键，不是装饰。
//
// 病史（2026-07-31，咕咚第二集）：修好 tool_calls 解析后，同一份资产文档从 2 个资产
// 变成 12 个。但用户重新点「解析」毫无反应——旧清单的 sourceFingerprint 里带的还是
// 旧 parserVersion，指纹照样命中 extractAssetManifest 的短路分支，直接返回那份 2 项的
// 残缺清单，新代码一行都没跑到。改解析器却不换版本号 = 改动对已有项目等于没上线。
//
// 这里守两件事：
//   1. 指纹必须真的把 ASSET_PARSER_VERSION 混进去（否则换版本号也失效不了旧清单）；
//   2. 短路分支必须同时比对 parserVersion（否则换版本号也绕不过短路）。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

function sliceBetween(source, startSig, endSig) {
  const start = source.indexOf(startSig);
  assert.notEqual(start, -1, `missing: ${startSig}`);
  const end = source.indexOf(endSig, start);
  assert.ok(end > start, `missing end anchor for ${startSig}`);
  return source.slice(start, end);
}

const versionLine = server.match(/^const ASSET_PARSER_VERSION = "([^"]+)";$/m);
assert.ok(versionLine, "ASSET_PARSER_VERSION 必须是单行字符串常量（缓存键要肉眼可核对）");
const version = versionLine[1];

// 1) 指纹真的把版本号混进哈希：换版本号 → 同一份文档指纹必须变。
const context = { crypto, String, ASSET_PARSER_VERSION: version };
vm.createContext(context);
vm.runInContext(
  sliceBetween(server, "function assetSourceFingerprint(", "\n// 覆写剧本前把当前内容存进"),
  context,
  { filename: "server.js" },
);

const doc = "人物：咕咚\n场景：木屋外空地\n道具：大铲子\n";
const fingerprint = context.assetSourceFingerprint(doc);
assert.match(fingerprint, /^[0-9a-f]{64}$/, "指纹应是 sha256 十六进制");
// 同文档同版本 → 稳定（复用逻辑本身要能命中，不能每次都重算）。
assert.equal(context.assetSourceFingerprint(doc), fingerprint, "同文档同版本指纹必须稳定");
// 只改版本号，文档一个字不动 → 指纹必须变。这条挂掉意味着以后改解析器再也没法让旧清单失效。
context.ASSET_PARSER_VERSION = `${version}-probe`;
assert.notEqual(
  context.assetSourceFingerprint(doc),
  fingerprint,
  "换 ASSET_PARSER_VERSION 后指纹必须变化，否则旧的残缺清单永远失效不了",
);
context.ASSET_PARSER_VERSION = version;
// 文档变化当然也要变。
assert.notEqual(context.assetSourceFingerprint(`${doc}道具：橡果小包\n`), fingerprint, "文档变化必须换指纹");

// 2) 短路分支必须同时校验 parserVersion。只比 sourceFingerprint 的话，
//    换版本号也绕不过去——因为旧清单里存的 sourceFingerprint 是旧算法算的，
//    但只要有人把这行删成"只比指纹"，这道防线就没了。
const shortCircuit = sliceBetween(server, "  const sourceFingerprint = assetSourceFingerprint(", "  const rulePlan = buildRuleAssets(");
assert.match(
  shortCircuit,
  /previous\.sourceFingerprint === sourceFingerprint/,
  "复用分支必须比对源文档指纹",
);
assert.match(
  shortCircuit,
  /previous\.parserVersion === ASSET_PARSER_VERSION/,
  "复用分支必须比对 parserVersion，否则解析器升级后旧清单仍会被当成可复用结果",
);
// 落盘时也必须写回当前版本号，否则下次比对永远不相等（每次都白重解一遍）。
assert.match(shortCircuit, /parserVersion: ASSET_PARSER_VERSION/, "复用后落盘必须写回当前 parserVersion");

// 3) 这次真正修的那个函数必须还在。它和版本号是一对:函数在、版本号没跟上，
//    就是本次事故；函数被删了，版本号留着也没意义。
assert.match(server, /function jsonPayloadFromModelMessage\(/, "tool_calls 载荷提取函数必须还在");
assert.ok(
  /v4|tool-call/.test(version),
  `ASSET_PARSER_VERSION 当前为 "${version}"，应包含本次解析器变更标识（改解析器必须换缓存键）`,
);

console.log("asset parser version cache key tests passed");
