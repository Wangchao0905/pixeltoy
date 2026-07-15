import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

assert.match(app, /function projectHasAssetSurface/, "asset surface visibility should be centralized");
assert.match(app, /assetGalleryHidden/, "asset gallery should be hidden before parsed assets exist");
assert.match(app, /assetJobStatusHidden/, "asset job status should be hidden before parsed assets exist");
assert.doesNotMatch(app, /还没有读取到资产图。可以先上传资产图，或生成资产图。/, "pre-parse empty asset copy should not render");
assert.doesNotMatch(app, /资产图：未开始/, "pre-parse asset status should not render");
