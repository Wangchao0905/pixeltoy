import assert from "node:assert/strict";
import serverModule from "../server.js";

const usage = serverModule.__test?.usage;
assert.equal(typeof usage?.usageRowsFromData, "function", "usage rows must be testable");
assert.equal(typeof usage?.userUsageTotalsFromData, "function", "user usage totals must be testable");

const data = {
  days: {
    "2026-08-04": {
      user_1: {
        imageTasks: 3,
        videoTasks: 2,
        videoSeconds: 18,
        plannedVideoSeconds: 20,
        models: {
          "gpt-image-2": 2,
          "seedance-2-0": 2,
          "seedance-2-0-fast": 1,
        },
        updatedAt: "2026-08-04T10:00:00.000Z",
      },
    },
    "2026-08-03": {
      user_1: {
        videoTasks: 1,
        plannedVideoSeconds: 8,
        models: { "seedance-2-0": 1 },
      },
    },
  },
};
const users = [{ id: "user_1", username: "alice", displayName: "Alice" }];

const rows = usage.usageRowsFromData(data, users);
assert.equal(rows.length, 2, "usage rows should preserve daily records");
assert.equal(rows[0].totalTasks, 5, "daily total should combine image and video tasks");
assert.equal(rows[0].imageTasks, 3, "daily image count should be exposed");
assert.equal(rows[0].videoTasks, 2, "daily video count should be exposed");
assert.equal(rows[0].videoSeconds, 18, "completed video seconds should be exposed");
assert.equal(rows[0].plannedVideoSeconds, 20, "planned video seconds should be exposed");
assert.deepEqual(rows[0].models, ["gpt-image-2 (2)", "seedance-2-0 (2)", "seedance-2-0-fast (1)"], "model usage should be readable and sorted");

const totals = usage.userUsageTotalsFromData(data);
assert.deepEqual(totals.user_1, {
  totalTasks: 6,
  imageTasks: 3,
  videoTasks: 3,
  videoSeconds: 18,
  plannedVideoSeconds: 28,
  models: ["gpt-image-2 (2)", "seedance-2-0 (3)", "seedance-2-0-fast (1)"],
});

// Old usage files only contain videoTasks and must remain valid.
const legacy = usage.userUsageTotalsFromData({ days: { "2026-08-04": { old: { videoTasks: 2 } } } });
assert.equal(legacy.old.totalTasks, 2);
assert.equal(legacy.old.imageTasks, 0);
assert.deepEqual(legacy.old.models, []);

console.log("admin usage tests passed");
