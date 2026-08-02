import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.match(app, /function modernVideoParameterPolicy\(data, ratio = "9:16"\)/, "free-mode parameter policy must be centralized");
const policyStart = app.indexOf("function modernVideoParameterPolicy(data, ratio = \"9:16\")");
const policyEnd = app.indexOf("function setProjectState", policyStart);
const policy = app.slice(policyStart, policyEnd);
assert.match(policy, /mode === DURATION_MODE_FREE/, "policy must recognize free mode");
assert.match(policy, /自由可选/, "free mode must not present the aspect ratio as locked");
assert.match(policy, /自由选择视频比例/, "free ratio selector needs an accessible name");

const modernVideoParameterPolicy = new Function(
  "DURATION_MODE_TK",
  "DURATION_MODE_FREE",
  "state",
  "normalizeDurationMode",
  "projectDurationModeFrom",
  `${policy.slice(0, policy.indexOf("function applyModernVideoParameterPolicy"))}; return modernVideoParameterPolicy;`,
)(
  "tk",
  "free",
  { durationMode: "tk" },
  (value, fallback = "tk") => value === "free" ? "free" : value === "tk" ? "tk" : fallback,
  (data) => data?.durationMode || "",
);
assert.deepEqual(
  modernVideoParameterPolicy({ durationMode: "free" }, "16:9"),
  {
    free: true,
    heroRatio: "16:9 自由可选",
    ratioAriaLabel: "自由选择视频比例",
    parameterHint: "自由模式：模型、比例、规格可调",
  },
  "free mode must expose all video parameters without a 9:16 lock",
);

assert.match(app, /applyModernVideoParameterPolicy\(data, ratio\)/, "studio renderer must apply the policy");
assert.match(app, /modernHeroRatio[\s\S]{0,220}classList\.toggle\("is-free", policy\.free\)/, "hero ratio state must visually switch out of locked mode");
assert.match(app, /\["modernParamRatio", "modernParamResolution", "modernParamModel"\]/, "free mode must cover ratio, resolution, and model controls");
assert.match(app, /control\.disabled = false/, "free-mode controls must be operable");
assert.match(css, /\.modern-episode-kicker b\.is-free/, "free-mode ratio badge needs a non-warning visual state");

console.log("free-mode video parameter tests passed");
