import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { __test } = require("../server.js");
const { shouldAutoRetryTransientAssetJob, AUTO_RETRYABLE_ASSET_JOB_MAX_ATTEMPTS, STORYBOARD_AUTO_RETRY_MAX_ATTEMPTS } = __test.assetJobRetry;

const networkFailure = { category: "gateway-network" };

assert.equal(
  shouldAutoRetryTransientAssetJob({
    type: "storyboards",
    targetAssetNames: ["SB007_E01_V007_PRODUCTION_BOARD"],
    autoRetryAttempt: 0,
    failureDetails: [networkFailure],
  }),
  true,
);
assert.equal(
  shouldAutoRetryTransientAssetJob({
    type: "storyboards",
    targetAssetNames: ["SB007", "SB008"],
    autoRetryAttempt: 0,
    failureDetails: [networkFailure],
  }),
  false,
);
assert.equal(
  shouldAutoRetryTransientAssetJob({
    type: "storyboards",
    targetAssetNames: ["SB007"],
    autoRetryAttempt: STORYBOARD_AUTO_RETRY_MAX_ATTEMPTS,
    failureDetails: [networkFailure],
  }),
  false,
  "a storyboard must stop after its single automatic retry so the user can recover from a known state",
);
assert.equal(
  shouldAutoRetryTransientAssetJob({
    type: "storyboard-regenerate",
    targetAssetNames: ["SB007"],
    autoRetryAttempt: 0,
    failureDetails: [{ category: "moderation" }],
  }),
  false,
);
assert.equal(
  shouldAutoRetryTransientAssetJob({
    type: "storyboards",
    targetAssetNames: ["SB007"],
    autoRetryAttempt: AUTO_RETRYABLE_ASSET_JOB_MAX_ATTEMPTS,
    failureDetails: [networkFailure],
  }),
  false,
);

console.log("transient asset job retry tests passed");
