import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
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
assert.match(
  server,
  /if \(job\.status === "completed"\)[\s\S]*?state = user \? fullProjectStateForUser\(episodeRoot, user\) : fullProjectState\(episodeRoot\)[\s\S]*?state \}/,
  "completed draft polling must return the refreshed project state",
);
assert.match(
  app,
  /const projectState = data\.state \|\| data\.job\?\.state \|\| await api\(`\/api\/project\/\$\{state\.selectedId\}`\)/,
  "draft completion must refresh project state when the completion response has no state",
);

console.log("draft job route tests passed");
