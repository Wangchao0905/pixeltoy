import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createChatcutQueue, CHATCUT_QUEUE_STATUS } from "../server/chatcut-queue.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-chatcut-queue-"));
const episodeRoot = path.join(root, "episode-01");
fs.mkdirSync(path.join(episodeRoot, "12_chatcut"), { recursive: true });

const queue = createChatcutQueue({ env: { CHATCUT_AGENT_COMMAND: "node worker.mjs" } });
const first = queue.enqueue(episodeRoot, {
  project: { id: "project-1", title: "第一集" },
  sourceDigest: "digest-1",
  packageDir: "12_chatcut",
});
assert.equal(first.created, true);
assert.equal(first.job.status, CHATCUT_QUEUE_STATUS.QUEUED);
assert.ok(fs.existsSync(path.join(episodeRoot, "12_chatcut", "chatcut_job.json")));

const duplicate = queue.enqueue(episodeRoot, {
  project: { id: "project-1", title: "第一集" },
  sourceDigest: "digest-1",
  packageDir: "12_chatcut",
});
assert.equal(duplicate.created, false);
assert.equal(duplicate.job.id, first.job.id);

const claimed = queue.claim(episodeRoot, { workerId: "worker-a" });
assert.equal(claimed.status, CHATCUT_QUEUE_STATUS.RUNNING);
assert.equal(claimed.attempts, 1);
assert.equal(queue.claim(episodeRoot, { workerId: "worker-b" }), null);

const reloaded = createChatcutQueue({ env: { CHATCUT_AGENT_COMMAND: "node worker.mjs" } });
const recovered = reloaded.recover(episodeRoot, { workerId: "worker-b", staleAfterMs: 0 });
assert.equal(recovered.status, CHATCUT_QUEUE_STATUS.QUEUED);
assert.equal(recovered.attempts, 1);

const claimedAgain = reloaded.claim(episodeRoot, { workerId: "worker-b" });
assert.equal(claimedAgain.status, CHATCUT_QUEUE_STATUS.RUNNING);
const completed = reloaded.complete(episodeRoot, { exportPath: "12_chatcut/exports/episode-01.mp4" });
assert.equal(completed.status, CHATCUT_QUEUE_STATUS.SUCCEEDED);
assert.equal(completed.result.exportPath, "12_chatcut/exports/episode-01.mp4");

const second = reloaded.enqueue(episodeRoot, {
  project: { id: "project-1", title: "第一集" },
  sourceDigest: "digest-2",
  packageDir: "12_chatcut",
});
assert.equal(second.created, true);
assert.notEqual(second.job.id, first.job.id);

const disabled = createChatcutQueue({ env: {} }).diagnose();
assert.equal(disabled.enabled, false);
assert.equal(disabled.mode, "disabled");

fs.rmSync(root, { recursive: true, force: true });
console.log("chatcut queue tests passed");
