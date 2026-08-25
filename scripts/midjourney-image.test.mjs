import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = readFileSync(`${root}/server.js`, "utf8");
const canvas = readFileSync(`${root}/public/canvas.js`, "utf8");
const marker = "if (process.env.NODE_ENV !== \"test\")";
const testSource = server.slice(0, server.indexOf(marker));

// The contract assertions never submit a generation request or contact the gateway.
assert.match(testSource, /mj_imagine/, "必须注册 Midjourney Imagine 模型");
assert.match(testSource, /\/mj\/submit\/imagine/, "必须调用 N1N Midjourney 提交接口");
assert.match(testSource, /\/mj\/task\/\$\{encodeURIComponent\(.*\)\}\/fetch/, "必须调用 N1N Midjourney 状态接口");
assert.match(testSource, /\/mj\/submit\/change/, "必须调用 N1N Midjourney 单图放大接口");
assert.match(testSource, /action: `UPSCALE_U\$\{cleanIndex\}`/, "单图放大必须发送 UPSCALE_U1-U4 动作");
assert.match(canvas, /data-image-action="upscale"/, "画布必须显示 Midjourney 单图放大按钮");
assert.match(canvas, /const upscaleActions = isMidjourney && node\.midjourneyProviderTaskId/, "只有 Midjourney 结果才显示单图放大按钮");
assert.match(canvas, /node\.settings\?\.model !== "mj_imagine"\) return/, "只有 Midjourney 模型才允许提交单图放大");
assert.match(canvas, /showMidjourneyUpscaleWindow\(result\.url, upscaleIndex\)/, "单图放大完成后必须打开独立图片窗口");
assert.match(canvas, /midjourney-upscale-dialog/, "必须提供 Midjourney 单图结果窗口");
assert.match(canvas, /\/api\/canvas\/image-generations\/\$\{encodeURIComponent\(node\.taskId\)\}\/upscale/, "画布必须调用单图放大接口");
assert.match(testSource, /JSON\.stringify\(args \|\| \[\]\)\.slice/, "异步图片 provider 没有 args 时日志不能因 slice 崩溃");

const require = createRequire(import.meta.url);
const image = require(`${root}/server.js`);
const api = image.__test?.canvasImage;
assert.ok(api, "测试导出必须提供 canvasImage API");
assert.equal(api.normalizeCanvasImageModel("midjourney"), "mj_imagine");
assert.equal(api.normalizeCanvasImageModel("mj-imagine"), "mj_imagine");
assert.deepEqual(api.midjourneyImagePayload({ prompt: "cat", ratio: "16:9" }), {
  botType: "MID_JOURNEY",
  prompt: "cat --ar 16:9",
  base64Array: [],
});
assert.deepEqual(api.midjourneyUpscalePayload({ taskId: "mj-task-1", index: 2 }), {
  action: "UPSCALE_U2",
  taskId: "mj-task-1",
});
assert.equal(api.normalizeMidjourneyStatus({ status: "SUCCESS", imageUrl: "https://cdn.example/image.png", progress: "100%" }, "task-1").status, "completed");
assert.equal(api.normalizeMidjourneyStatus({ status: "FAILURE", failReason: "bad prompt" }, "task-1").status, "failed");
assert.equal(api.normalizeMidjourneyStatus({ status: "IN_PROGRESS", progress: "42%" }, "task-1").progress, 42);
console.log("midjourney image contract tests passed");
