import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const server = require(path.join(root, "server.js"));
const series = server.__test?.seriesAssets;
const index = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeImage(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "test-image", "utf8");
}

async function run() {
  assert.equal(typeof series?.resolveSeriesAssetDir, "function", "series asset path helper must be exposed for focused tests");
  assert.equal(typeof series?.readAssetManifest, "function", "asset manifest reader must be exposed for focused tests");
  assert.equal(typeof series?.createEpisodeWorkspace, "function", "episode workspace creator must be exposed for focused tests");
  assert.equal(typeof series?.scanAssets, "function", "asset scanner must be exposed for focused tests");

  const projectDir = fs.mkdtempSync(path.join(root, ".series-assets-test-"));
  const episode = (slug) => path.join(projectDir, "outputs", slug);
  const seriesManifest = path.join(projectDir, "project_asset_manifest.json");
  const legacyManifest = (slug) => path.join(episode(slug), "03_asset_prompts", `${slug}_asset_manifest.json`);
  const asset = "C001_LINXIA_CHARACTER_SHEET";

  try {
    const e01 = episode("e01");
    fs.mkdirSync(path.join(e01, "01_script"), { recursive: true });
    writeJson(legacyManifest("e01"), { confirmed: true, items: [{ id: asset, type: "Character", label: "林夏" }] });

    const migrated = series.readAssetManifest(e01);
    assert.equal(migrated.data.confirmed, true, "legacy confirmed manifests remain readable");
    assert.equal(migrated.file, seriesManifest, "a confirmed legacy manifest is copied to the series root");
    assert.ok(fs.existsSync(legacyManifest("e01")), "legacy upgrade must copy, not move");

    writeJson(seriesManifest, { confirmed: true, items: [{ id: "C002_SERIES_CHARACTER_SHEET", type: "Character", label: "剧集角色" }] });
    const preferred = series.readAssetManifest(e01);
    assert.equal(preferred.file, seriesManifest, "series manifest has read priority over episode manifests");
    assert.equal(preferred.data.items[0].id, "C002_SERIES_CHARACTER_SHEET");

    const firstStoryboard = path.join(e01, "02_storyboard", "e01_storyboard.md");
    fs.mkdirSync(path.dirname(firstStoryboard), { recursive: true });
    fs.writeFileSync(firstStoryboard, "FIRST EPISODE STORYBOARD\n", "utf8");
    const { episodeRoot: e02 } = series.createEpisodeWorkspace(projectDir, "e02", "第二集");
    assert.equal(series.readAssetManifest(e02).data.confirmed, true, "new episodes inherit confirmed series manifests");
    assert.ok(series.readAssetManifest(e02).data.items.length > 0, "new episodes inherit non-empty series assets");
    assert.equal(fs.existsSync(path.join(e02, "04_assets")), false, "new episodes must not create episode asset directories");
    assert.equal(fs.readFileSync(firstStoryboard, "utf8"), "FIRST EPISODE STORYBOARD\n", "adding an episode must not touch the first storyboard");

    assert.throws(
      () => series.createEpisodeWorkspace(projectDir, "e02", "重复第二集"),
      (error) => error?.code === "EEXIST" && error?.statusCode === 409,
      "duplicate episode creation must be rejected by atomic mkdir",
    );
    assert.equal(fs.existsSync(path.join(projectDir, "outputs", "e02_20260728_001")), false, "duplicate episodes must not be silently renamed");

    // 路由层的预检负责把 409 交给前端；丢了它 API 退化成 500，前端提示不出「第 N 集已存在」
    assert.equal(typeof series?.uniqueEpisodeSlug, "function", "episode slug guard must be exposed for focused tests");
    assert.throws(
      () => series.uniqueEpisodeSlug(projectDir, "e02"),
      (error) => error?.code === "EEXIST" && error?.statusCode === 409,
      "duplicate episode slugs must be rejected with 409 before workspace creation",
    );
    assert.equal(series.uniqueEpisodeSlug(projectDir, "e03"), "e03", "unused episode slugs must pass through unchanged");

    const seriesAsset = "C002_SERIES_CHARACTER_SHEET";
    writeImage(path.join(series.resolveSeriesAssetDir(e01), "characters", `${seriesAsset}.png`));
    writeImage(path.join(e01, "04_assets", "characters", `${asset}.png`));
    const scanned = series.scanAssets(e02);
    assert.ok(scanned.some((item) => item.assetName === seriesAsset), "series asset scanning must include series-level images");
    assert.ok(scanned.some((item) => item.assetName === asset), "series asset scanning must include legacy episode images");

    // 状态药丸读 readAssetManifest()、粘贴框读 findProjectFile("assetManifest")，
    // 两者必须指向同一份文件，否则"显示已确认、粘贴框却是空的"。
    assert.equal(typeof series?.findProjectFile, "function", "project file resolver must be exposed for focused tests");
    for (const [name, root] of [["e01", e01], ["e02", e02]]) {
      const resolved = series.findProjectFile(root, "assetManifest");
      assert.equal(resolved, seriesManifest, `${name} manifest file resolution must point at the series manifest`);
      assert.equal(resolved, series.readAssetManifest(root).file, `${name} status and textarea must read the same manifest file`);
      assert.ok(fs.existsSync(resolved), `${name} resolved manifest file must exist so the textarea is not blank`);
    }

    // 资产描述是产出全剧资产的源文档，必须跟清单同级。否则第二集显示「已确认」、
    // 而资产描述粘贴框是空的——状态和源文档对不上。
    assert.equal(typeof series?.readAssetDescription, "function", "asset description reader must be exposed for focused tests");
    assert.equal(typeof series?.writeAssetDescription, "function", "asset description writer must be exposed for focused tests");
    const descText = "林小雨：二十五岁女性，长发，米色针织衫。";
    series.writeAssetDescription(e01, descText);
    assert.equal(series.readAssetDescription(e02), descText, "every episode must read the same series asset description");
    for (const [name, root] of [["e01", e01], ["e02", e02]]) {
      const confirmed = series.readAssetManifest(root).data?.confirmed === true;
      const description = String(series.readAssetDescription(root) || "").trim();
      assert.ok(!confirmed || description, `${name} must not show confirmed assets with a blank description box`);
    }

    // 旧项目：描述还在分集级 01_script 下，读到时提升为剧集级且不删原文件
    const legacyProject = fs.mkdtempSync(path.join(root, ".series-desc-test-"));
    const legacyEpisode = path.join(legacyProject, "outputs", "e01");
    const legacyDescFile = path.join(legacyEpisode, "01_script", "e01_asset_description.md");
    fs.mkdirSync(path.dirname(legacyDescFile), { recursive: true });
    fs.writeFileSync(legacyDescFile, "旧项目的资产描述", "utf8");
    try {
      assert.equal(series.readAssetDescription(legacyEpisode), "旧项目的资产描述", "legacy episode descriptions stay readable");
      assert.ok(fs.existsSync(path.join(legacyProject, "project_asset_description.md")), "legacy descriptions are promoted to the series root");
      assert.ok(fs.existsSync(legacyDescFile), "legacy description promotion must copy, not move");
    } finally {
      fs.rmSync(legacyProject, { recursive: true, force: true });
    }

    writeJson(path.join(projectDir, "work", "e01_video_generation", "pixel_toys_workflow.json"), { ownerUserId: "owner-user" });
    assert.throws(
      () => series.assertProjectEpisodeAccess(projectDir, { id: "other-user" }),
      (error) => error?.statusCode === 404,
      "foreign project episodes must retain the 404 ownership guard",
    );
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  const inheritanceProject = fs.mkdtempSync(path.join(root, ".series-assets-inheritance-"));
  try {
    const firstEpisode = path.join(inheritanceProject, "outputs", "e01");
    fs.mkdirSync(path.join(firstEpisode, "01_script"), { recursive: true });
    writeJson(path.join(firstEpisode, "03_asset_prompts", "e01_asset_manifest.json"), {
      confirmed: true,
      items: [{ id: asset, type: "Character", label: "林夏" }],
    });
    const { episodeRoot: inheritedEpisode } = series.createEpisodeWorkspace(inheritanceProject, "e02", "第二集");
    const inheritedManifest = series.readAssetManifest(inheritedEpisode);
    assert.equal(inheritedManifest.data.confirmed, true, "creating a new episode must inherit a confirmed legacy series manifest");
    assert.ok(inheritedManifest.data.items.length > 0, "inherited episode manifest must retain asset items");
  } finally {
    fs.rmSync(inheritanceProject, { recursive: true, force: true });
  }

  assert.match(serverSource(), /function assertProjectEpisodeAccess[\s\S]*statusCode = 404/, "foreign project ownership guard must remain a 404");
  assert.match(serverSource(), /url\.pathname === "\/api\/project\/\$\{?[^\n]*episodes|action === "episodes"/, "episode list endpoint must be present");
  assert.match(app, /modernEpisodeSwitcher/, "top-level episode switcher UI must be present");
  assert.match(app, /reuseExistingProject:\s*true/, "adding an episode must reuse the existing series directory");
  assert.match(index, /本剧共用，改动影响所有分集/, "asset UI must identify series-shared assets");
  assert.ok(packageJson.scripts.test.includes("node scripts/series-assets.test.mjs"), "series asset test must be in the npm test chain");

  console.log("series asset tests passed");
}

function serverSource() {
  return fs.readFileSync(path.join(root, "server.js"), "utf8");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
