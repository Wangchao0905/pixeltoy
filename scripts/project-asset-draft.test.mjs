import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const server = require(path.join(root, "server.js"));
const draft = server.__test?.draft;

async function run() {
  assert.equal(typeof draft?.buildDraft, "function", "draft test hook must expose buildDraft");
  assert.equal(typeof draft?.draftAssetManifestForEpisode, "function", "draft test hook must expose project manifest fallback");

  const projectRoot = fs.mkdtempSync(path.join(root, ".project-asset-draft-"));
  const episodeRoot = (slug) => path.join(projectRoot, "outputs", slug);
  const manifestPath = (slug) => path.join(episodeRoot(slug), "03_asset_prompts", `${slug}_asset_manifest.json`);

  function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  function writeEpisode(slug, manifest, script = "# 测试剧\n\n林夏走进房间。\n") {
    const root = episodeRoot(slug);
    fs.mkdirSync(path.join(root, "01_script"), { recursive: true });
    fs.writeFileSync(path.join(root, "01_script", `${slug}_script.md`), script, "utf8");
    writeJson(manifestPath(slug), manifest);
    return root;
  }

  const character = { id: "C001_LINXIA_CHARACTER_SHEET", type: "Character", label: "林夏", evidence: "剧本人物" };
  const scene = { id: "S001_ROOM_WIDE_ESTABLISHING", type: "Scene", label: "房间", evidence: "剧本场景" };
  const prop = { id: "P001_KEY_PROP_REF", type: "Prop", label: "钥匙", evidence: "剧本道具" };

  try {
    writeEpisode("e01", { items: [character, scene] });
    writeEpisode("e02", { items: [] }, "# 第二集\n\n林夏回到房间。\n");
    writeEpisode("e03", {
      items: [
        { ...character, id: "C099_LINXIA_CHARACTER_SHEET" },
        { ...scene, label: "房间内" },
        prop,
      ],
    });

    const foreignProjectRoot = fs.mkdtempSync(path.join(root, ".foreign-project-"));
    try {
      const foreignEpisodeRoot = path.join(foreignProjectRoot, "outputs", "e01");
      fs.mkdirSync(path.join(foreignEpisodeRoot, "01_script"), { recursive: true });
      writeJson(path.join(foreignEpisodeRoot, "03_asset_prompts", "e01_asset_manifest.json"), {
        items: [{ id: "C777_FOREIGN_CHARACTER_SHEET", type: "Character", label: "外部项目角色" }],
      });

      const fallback = draft.draftAssetManifestForEpisode(episodeRoot("e02"));
      assert.deepEqual(
        fallback.items.map((item) => item.id),
        [character.id, scene.id, prop.id],
        "empty episode manifest must fall back to same-project assets, deduping by id/label",
      );
      assert.ok(!fallback.items.some((item) => item.id === "C777_FOREIGN_CHARACTER_SHEET"), "assets must not cross project boundaries");

      writeEpisode("e02", { items: [{ id: "C002_LOCAL_CHARACTER_SHEET", type: "Character", label: "本集角色" }] }, "# 第二集\n\n本集角色进入房间。\n");
      const localPreferred = draft.draftAssetManifestForEpisode(episodeRoot("e02"));
      assert.deepEqual(localPreferred.items.map((item) => item.id), ["C002_LOCAL_CHARACTER_SHEET"], "local assets must remain preferred");

      writeEpisode("e02", { items: [] }, "# 第二集\n\n林夏回到房间。\n");
      const modelCalls = [];
      const result = await draft.buildDraft(episodeRoot("e02"), {
        callStoryboardModel: async (payload) => {
          modelCalls.push(payload);
          return {
            ok: true,
            model: "mock-storyboard-model",
            shots: [
              {
                id: "V001",
                title: "林夏回到房间",
                beat: "林夏回到房间。",
                duration: 8,
                refs: [character.id, scene.id],
                dialogues: [],
                videoDesign: {
                  shot_size: "中景",
                  camera_lens: "50mm",
                  camera_movement: "缓慢推进",
                  camera_angle: "平视",
                  visual: "林夏走进房间。",
                  voice_over: "无",
                  sound: "室内环境声",
                },
              },
            ],
          };
        },
      });
      assert.equal(modelCalls.length, 1, "draft should reach the mocked storyboard model");
      assert.deepEqual(modelCalls[0].assets.map((asset) => asset.name), [character.id, scene.id, prop.id]);
      assert.ok(fs.existsSync(result.storyboard), "draft should write the storyboard after using project assets");
    } finally {
      fs.rmSync(foreignProjectRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }

  const emptyProjectRoot = fs.mkdtempSync(path.join(root, ".empty-project-asset-draft-"));
  try {
    const emptyEpisodeRoot = path.join(emptyProjectRoot, "outputs", "e01");
    fs.mkdirSync(path.join(emptyEpisodeRoot, "01_script"), { recursive: true });
    fs.writeFileSync(path.join(emptyEpisodeRoot, "01_script", "e01_script.md"), "# 空项目\n\n角色走进房间。\n", "utf8");
    writeJson(path.join(emptyEpisodeRoot, "03_asset_prompts", "e01_asset_manifest.json"), { items: [] });
    await assert.rejects(
      () => draft.buildDraft(emptyEpisodeRoot, { callStoryboardModel: async () => ({ ok: true, shots: [] }) }),
      /本项目还没有可用资产，请先在资产图完成首集资产生成/,
      "an asset-less project must retain the draft precondition",
    );
  } finally {
    fs.rmSync(emptyProjectRoot, { recursive: true, force: true });
  }

  console.log("project asset draft tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
