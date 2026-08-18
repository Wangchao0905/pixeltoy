// Seedance 2.5 接入测试（2026-08-10）：
// 火山方舟模型映射、分辨率封顶（2.5 仅 480p/720p）、前端模型选项。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(path.join(root, "server.js"));
const serverExports = (mod.default && mod.default.__test ? mod.default : mod);
const { __test } = serverExports;
const { normalizeVideoResolution, normalizeSeedanceDuration } = __test.canvasVideo;

// 1) 分辨率封顶：Seedance 2.5 仅 480p/720p
assert.equal(normalizeVideoResolution("1080p", "seedance-2-5"), "720p", "2.5 请求 1080p 必须回退 720p");
assert.equal(normalizeVideoResolution("4k", "seedance-2-5"), "720p", "2.5 请求 4k 必须回退 720p");
assert.equal(normalizeVideoResolution("720p", "seedance-2-5"), "720p", "2.5 720p 保持");
assert.equal(normalizeVideoResolution("480p", "seedance-2-5"), "480p", "2.5 480p 保持");
assert.equal(normalizeVideoResolution("1080p", "dreamina-seedance-2-5-260628"), "720p", "海外 2.5 请求 1080p 必须回退 720p");
assert.equal(normalizeSeedanceDuration(30, "dreamina-seedance-2-5-260628"), 30, "海外 2.5 必须保留 30 秒");
assert.equal(normalizeSeedanceDuration(31, "dreamina-seedance-2-5-260628"), 30, "海外 2.5 必须封顶 30 秒");
// 标准 2.0 三项已固定走 Paisio 的截图模型规格。
assert.equal(normalizeVideoResolution("1080p", "seedance-2-0"), "720p", "2.0 固定 720p");
assert.equal(normalizeVideoResolution("4k", "seedance-2-0"), "720p", "2.0 固定 720p");
assert.equal(normalizeVideoResolution("1080p", "seedance-2-0-fast"), "720p", "2.0 Fast 固定 720p");
assert.equal(normalizeVideoResolution("720p", "seedance-2-0-mini"), "480p", "2.0 Mini 固定 480p");

// 2) 静态断言：模型映射 + 前端选项 + 文本归一
const serverSource = readFileSync(path.join(root, "server.js"), "utf8");
assert.match(serverSource, /"seedance-2-5": "doubao-seedance-2-5-260628"/, "server 必须映射 Seedance 2.5 到火山模型 ID");
assert.match(serverSource, /SEEDANCE_25_MODEL/, "2.5 必须支持 env 覆盖（SEEDANCE_25_MODEL）");
assert.match(serverSource, /"seedance-2-5": "dreamina-seedance-2-5-260628"/, "server 必须映射海外 Seedance 2.5 到 BytePlus 模型 ID");
assert.match(serverSource, /BYTEPLUS_SEEDANCE_25_MODEL/, "海外 2.5 必须支持 env 覆盖（BYTEPLUS_SEEDANCE_25_MODEL）");
assert.ok(serverSource.includes('const maxDuration = /(?:2-5|2\\.5)/i.test(String(model || "")) ? 30 : 15;'), "后端时长 2.5 必须放宽到 30 秒（2.0 保持 15）");

const appSource = readFileSync(path.join(root, "public", "app.js"), "utf8");
assert.match(appSource, /"seedance-2-5": "Seedance 2\.5"/, "前端必须提供 Seedance 2.5 模型选项");
assert.match(appSource, /\/2\\.5\|2-5\//, "前端必须归一化 2.5 文本输入");

console.log("seedance-25-config ok");
