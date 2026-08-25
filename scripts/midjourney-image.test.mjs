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
assert.match(testSource, /\/mj\/submit\/action/, "必须调用 N1N Midjourney Action 单图放大接口");
assert.match(testSource, /customId: `MJ::JOB::upsample::\$\{cleanIndex\}::\$\{crypto\.randomUUID\(\)\}`/, "单图放大必须发送 N1N 文档规定的 customId");
assert.match(canvas, /data-image-action="upscale"/, "画布必须显示 Midjourney 单图放大按钮");
assert.match(canvas, /const upscaleActions = isMidjourney && node\.midjourneyProviderTaskId/, "只有 Midjourney 结果才显示单图放大按钮");
assert.match(canvas, /node\.settings\?\.model !== "mj_imagine"\) return/, "只有 Midjourney 模型才允许提交单图放大");
assert.doesNotMatch(canvas, /showMidjourneyUpscaleWindow|midjourney-upscale-dialog/, "单图放大不能打开独立图片窗口");
assert.match(canvas, /const upscaleNode = createNode\("image"/, "单图放大必须先创建新的图片模块节点");
assert.match(canvas, /pollImageNode\(upscaleNode\.id, taskId, \{ upscaleIndex: cleanIndex \}\)/, "单图放大结果必须回填到新图片模块节点");
assert.match(canvas, /midjourneyUpscaleSourceNodeId = node\.id/, "新图片模块必须记录来源 Midjourney 节点");
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
const upscalePayload = api.midjourneyUpscalePayload({ taskId: "mj-task-1", index: 2 });
assert.deepEqual({ ...upscalePayload, customId: upscalePayload.customId.replace(/::[a-f0-9-]+$/, "::<uuid>") }, {
  chooseSameChannel: true,
  customId: "MJ::JOB::upsample::2::<uuid>",
  taskId: "mj-task-1",
  notifyHook: "",
  state: "",
});
assert.equal(api.normalizeMidjourneyStatus({ status: "SUCCESS", imageUrl: "https://cdn.example/image.png", progress: "100%" }, "task-1").status, "completed");
assert.equal(api.normalizeMidjourneyStatus({ status: "FAILURE", failReason: "bad prompt" }, "task-1").status, "failed");
assert.equal(api.normalizeMidjourneyStatus({ status: "IN_PROGRESS", progress: "42%" }, "task-1").progress, 42);
console.log("midjourney image contract tests passed");
