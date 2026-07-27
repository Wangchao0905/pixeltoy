import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const statusStart = server.indexOf("function projectStatusSnapshot(episodeRoot)");
const statusEnd = server.indexOf("function fullProjectStateForUser", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, "projectStatusSnapshot must remain a standalone function");
const statusBody = server.slice(statusStart, statusEnd);
const recoveryCall = statusBody.indexOf("recoverProjectVideoQueueIfNeeded(episodeRoot, configRecord?.data || {});");
const progressRead = statusBody.indexOf("const progress = videoProgress(episodeRoot, localJobs, videos);");
assert.ok(recoveryCall >= 0, "状态轮询必须触发磁盘队列恢复");
assert.ok(progressRead > recoveryCall, "必须先恢复队列,再读取视频进度");

const recoveryStart = server.indexOf("function recoverProjectVideoQueueIfNeeded(episodeRoot, config = {})");
const recoveryEnd = server.indexOf("async function generateProjectVideoShotsSequentially", recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "缺少视频队列恢复函数");
const recoveryBody = server.slice(recoveryStart, recoveryEnd);
assert.match(recoveryBody, /queued_local\|waiting_asset_active\|waiting_tail_frame/, "恢复必须识别持久化的未完成队列状态");
assert.match(recoveryBody, /projectVideoQueues\.get\(queueKey\)\?\.running/, "已有运行队列不得被状态轮询重复启动");
assert.match(recoveryBody, /projectVideoQueues\.set\(queueKey, queue\)/, "恢复队列必须先登记再异步执行");

console.log("project video queue recovery tests passed");
