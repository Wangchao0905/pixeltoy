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

// 1) 分辨率封顶：Paisio Seedance 2.5 仅固定 720p
assert.equal(normalizeVideoResolution("1080p", "seedance-2-5"), "720p", "2.5 请求 1080p 必须回退 720p");
assert.equal(normalizeVideoResolution("4k", "seedance-2-5"), "720p", "2.5 请求 4k 必须回退 720p");
assert.equal(normalizeVideoResolution("720p", "seedance-2-5"), "720p", "2.5 720p 保持");
assert.equal(normalizeVideoResolution("480p", "seedance-2-5"), "720p", "2.5 480p 必须回退到固定 720p");
assert.equal(normalizeVideoResolution("1080p", "seedance-2-5-c"), "720p", "2.5 C 请求 1080p 必须回退 720p");
// 标准 2.0 三项已固定走 Paisio 的截图模型规格。
assert.equal(normalizeVideoResolution("1080p", "seedance-2-0"), "720p", "2.0 固定 720p");
assert.equal(normalizeVideoResolution("4k", "seedance-2-0"), "720p", "2.0 固定 720p");
assert.equal(normalizeVideoResolution("1080p", "seedance-2-0-fast"), "720p", "2.0 Fast 固定 720p");
assert.equal(normalizeVideoResolution("720p", "seedance-2-0-mini"), "720p", "2.0 Mini 支持 720p");

// 2) 静态断言：模型映射 + 前端选项 + 文本归一
const serverSource = readFileSync(path.join(root, "server.js"), "utf8");
assert.match(serverSource, /"seedance-2-5": \{ model: "sd2\.5-ultra-720p", resolution: "720p" \}/, "server 必须将标准 Seedance 2.5 固定映射到 Paisio 720p 模型");
assert.match(serverSource, /seedance-2\.5-c|seedance2\.5-4-1-720p/, "server 必须注册 Seedance 2.5 C");
assert.doesNotMatch(serverSource, /doubao-seedance-2-5-260628/, "标准 Seedance 2.5 不得继续使用旧 Ark 模型");
assert.doesNotMatch(serverSource, /process\.env\.SEEDANCE_25_MODEL\b/, "标准 Seedance 2.5 不得继续保留旧 Ark 环境变量");
assert.doesNotMatch(serverSource, /dreamina-seedance-2-5-260628|BYTEPLUS_SEEDANCE_25_MODEL|seedance-2-5-byteplus/, "海外 Seedance 2.5 必须从后端删除");
assert.ok(serverSource.includes('const maxDuration = /(?:2-5|2\\.5)/i.test(String(model || "")) ? 30 : 15;'), "后端时长 2.5 必须放宽到 30 秒（2.0 保持 15）");

const appSource = readFileSync(path.join(root, "public", "app.js"), "utf8");
assert.match(appSource, /"seedance-2-5": "Seedance 2\.5"/, "前端必须提供 Seedance 2.5 模型选项");
assert.match(appSource, /\/2\\.5\|2-5\//, "前端必须归一化 2.5 文本输入");

console.log("seedance-25-config ok");
