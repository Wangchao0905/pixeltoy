const assert = require("node:assert/strict");
const { __test } = require("../server.js");

const manifest = {
  title: "Example",
  items: [
    { id: "C001_EVELYN_CHARACTER_SHEET", type: "Character", label: "Evelyn", textToImagePrompt: "old prompt" },
    {
      id: "S001_GARAGE_WIDE_ESTABLISHING",
      type: "Scene",
      label: "Garage interior",
      evidence: "INT. GARAGE - AFTER SCHOOL",
      textToImagePrompt: "scene prompt",
    },
  ],
};

const updated = __test.assetPrompt.updateAssetPromptInManifest(
  manifest,
  "C001_EVELYN_CHARACTER_SHEET",
  "new production prompt\nkeep the same face",
);

assert.equal(updated.items[0].textToImagePrompt, "new production prompt\nkeep the same face");
assert.equal(updated.items[1].textToImagePrompt, "scene prompt");
assert.throws(
  () => __test.assetPrompt.updateAssetPromptInManifest(manifest, "missing", "prompt"),
  /资产不存在/,
);
assert.throws(
  () => __test.assetPrompt.updateAssetPromptInManifest(manifest, "C001_EVELYN_CHARACTER_SHEET", ""),
  /提示词不能为空/,
);

console.log("asset prompt update tests passed");
