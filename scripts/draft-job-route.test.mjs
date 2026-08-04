import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const routeLine = server.split("\n").find((line) => line.includes("const draftJobMatch = action.match("));

assert.ok(routeLine, "draft job polling route must be present");
const route = routeLine.match(/action\.match\((.*)\);/)?.[1];
assert.ok(route, "draft job polling route expression must be present");
assert.ok(
  route.includes("draft-jobs"),
  "draft job polling route must match the action format without a leading slash",
);
assert.equal(route, "/^draft-jobs\\/([^/]+)$/", "draft job polling route must match draft-jobs/<jobId>");

const matcher = eval(route);
assert.deepEqual(matcher.exec("draft-jobs/job-123")?.[1], "job-123");
assert.equal(matcher.exec("/draft-jobs/job-123"), null);

console.log("draft job route tests passed");
