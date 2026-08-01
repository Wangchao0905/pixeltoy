import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const runner = fs.readFileSync(path.join(root, "scripts/run_asset_generation.js"), "utf8");

assert.match(
  runner,
  /PIXEL_TOYS_STORYBOARD_IMAGE_TIMEOUT_SECONDS \|\| "180"/,
  "storyboard generation must default to a bounded request timeout",
);
assert.match(
  runner,
  /PIXEL_TOYS_STORYBOARD_RESCUE_TIMEOUT_SECONDS \|\| "120"/,
  "storyboard fallback generation must use a shorter bounded timeout",
);
assert.match(
  runner,
  /function boundedStoryboardTimeoutSeconds\(/,
  "storyboard timeout needs its own upper bound rather than inheriting the 15-minute asset limit",
);
const fallbackStart = runner.indexOf("function shouldFallbackStoryboardToText(");
const fallbackEnd = runner.indexOf("\n}\n\nasync function main", fallbackStart);
const fallback = runner.slice(fallbackStart, fallbackEnd);
assert.doesNotMatch(
  fallback,
  /request_timeout|timed out|超时/,
  "a timed-out storyboard request must fail instead of spending another full timeout on the fallback route",
);
assert.match(
  runner,
  /const STORYBOARD_IMAGE_RETRIES = 0/,
  "a single storyboard request must fail clearly instead of silently extending the wait with another full request",
);

console.log("storyboard image timeout tests passed");
