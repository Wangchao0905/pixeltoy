import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const referencePolicy = canvas.slice(canvas.indexOf("function assetReferenceUrl("), canvas.indexOf("function videoSubmitCapableAsset("));
const uploadFlow = canvas.slice(canvas.indexOf("async function createNodesForFiles("), canvas.indexOf("function markAssetUploadFailed("));

assert.match(
  referencePolicy,
  /const localUrl = asset\.localUrl \|\| asset\.local_url \|\| "";/,
  "reference selection must consider a persisted local asset URL",
);
assert.match(
  referencePolicy,
  /return publicUrl \|\| localUrl \|\| rawUrl/,
  "a persisted local URL must win over a stale blob preview",
);
assert.match(
  uploadFlow,
  /if \(asset\) \{[\s\S]*?URL\.revokeObjectURL\(job\.blobUrl\);[\s\S]*?\} else \{[\s\S]*?markAssetUploadFailed/,
  "blob previews must be revoked only after a stable upload succeeds",
);
assert.doesNotMatch(
  uploadFlow,
  /finally \{\s*URL\.revokeObjectURL\(job\.blobUrl\);/,
  "failed uploads must retain the current-session preview for reference recovery",
);

console.log("canvas blob reference recovery tests passed");
