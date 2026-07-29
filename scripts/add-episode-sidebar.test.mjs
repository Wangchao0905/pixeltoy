// 左边栏「添加剧集」＋:点一下建下一集、清空剧本框、资产库锁定继承不变。
// 第三条(资产库继承)用真实文件系统验证,不靠断言源码字符串。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const server = require(path.join(root, "server.js"));
const series = server.__test?.seriesAssets;
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.equal(typeof series?.createEpisodeWorkspace, "function", "createEpisodeWorkspace 需导出");
assert.equal(typeof series?.readAssetManifest, "function", "readAssetManifest 需导出");
assert.equal(typeof series?.resolveSeriesAssetManifestPath, "function", "路径解析需导出");

// ── 第三条:新建分集后资产库锁定继承不变(真实 FS) ──
const projectDir = fs.mkdtempSync(path.join(root, ".add-episode-test-"));
try {
  const e01 = path.join(projectDir, "outputs", "e01");
  fs.mkdirSync(path.join(e01, "01_script"), { recursive: true });
  // E01 先放真实剧情，后面才能验证 E02 没把它带过来。
  fs.writeFileSync(path.join(e01, "01_script", "e01_script.md"), "# e01\n\n咕咚掉进湖里，小兔子跑了起来。\n");
  const locked = {
    confirmed: true,
    dialogueLanguage: "zh",
    items: [
      { id: "C001_GUDONG_CHARACTER_SHEET", type: "Character", label: "咕咚" },
      { id: "S001_FOREST_SCENE", type: "Scene", label: "森林" },
    ],
  };
  fs.writeFileSync(path.join(projectDir, "project_asset_manifest.json"), `${JSON.stringify(locked, null, 2)}\n`);

  const before = series.readAssetManifest(e01);
  assert.equal(before.data.confirmed, true, "E01 资产库应为已锁定");

  const { episodeRoot: e02 } = series.createEpisodeWorkspace(projectDir, "e02", "e02");
  assert.ok(fs.existsSync(e02), "E02 工作区应已创建");

  // 关键:两集必须解析到同一份项目级清单文件。
  assert.equal(
    series.resolveSeriesAssetManifestPath(e02),
    series.resolveSeriesAssetManifestPath(e01),
    "E01/E02 应共读同一份项目级资产清单",
  );
  const after = series.readAssetManifest(e02);
  assert.equal(after.data.confirmed, true, "E02 必须继承锁定状态");
  assert.deepEqual(after.data.items, locked.items, "E02 资产项必须与 E01 一致");
  assert.equal(after.data.dialogueLanguage, "zh", "对白语言设置一并继承");

  // 新集的剧本必须是空的(旧剧情不带过来)。
  // 新集不能带过来 E01 的旧剧情。新集只有 "# e02" 这种标题占位是既有行为。
  const scriptDir = path.join(e02, "01_script");
  const texts = fs.existsSync(scriptDir)
    ? fs.readdirSync(scriptDir).filter((f) => /\.(md|txt)$/i.test(f))
        .map((f) => fs.readFileSync(path.join(scriptDir, f), "utf8"))
    : [];
  for (const text of texts) {
    assert.doesNotMatch(text, /咕咚/, "E02 不应带过来 E01 的剧情");
    assert.ok(text.replace(/^#.*$/gm, "").trim() === "", `E02 剧本除标题外应为空，实际: ${JSON.stringify(text)}`);
  }
} finally {
  fs.rmSync(projectDir, { recursive: true, force: true });
}

// ── 分集序列必须按集数升序，左边栏才是向下增长的 ──
{
  const dir = fs.mkdtempSync(path.join(root, ".add-episode-order-"));
  try {
    // 故意乱序创建，验证读出来是升序。
    for (const slug of ["e03", "e01", "e10", "e02"]) {
      fs.mkdirSync(path.join(dir, "outputs", slug, "01_script"), { recursive: true });
      fs.writeFileSync(path.join(dir, "outputs", slug, "01_script", `${slug}_script.md`), `# ${slug}\n`);
    }
    const roots = series.projectEpisodeRoots(path.join(dir, "outputs", "e01"));
    const slugs = roots.map((r) => path.basename(r));
    assert.deepEqual(slugs, ["e01", "e02", "e03", "e10"], `分集应按集数升序，实际: ${slugs.join(",")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── 第一条:＋ 要渲染在左边栏卡片列表(#modernEpisodeList)里,不只是顶部切换器 ──
const listRender = app.match(/const nav = \$\("#modernEpisodeList"\);[\s\S]{0,600}?nav\.innerHTML = [^\n]+/);
assert.ok(listRender, "找不到 #modernEpisodeList 的渲染");
assert.match(listRender[0], /data-add-episode/, "卡片列表渲染里必须含 ＋");
// 必须真的拼进 innerHTML，光有 addMarkup 定义不算。
const innerHtmlLine = listRender[0].match(/nav\.innerHTML = [^\n]+/)?.[0] || "";
assert.match(innerHtmlLine, /\$\{addMarkup\}/, "＋ 必须拼进 nav.innerHTML");
// 非剧集项目不该出现 ＋（没有 projectDir 时无处新建）。
assert.match(listRender[0], /project\?\.projectDir\s*\n?\s*\?/, "＋ 需以 projectDir 为条件");

// 点击要接线到 #modernEpisodeList,而不是只有切换器有。
const listClick = app.match(/\$\("#modernEpisodeList"\)\?\.addEventListener\("click"[\s\S]{0,500}?loadProject\(episodeButton\.dataset\.episodeId\)/);
assert.ok(listClick, "找不到 #modernEpisodeList 的点击处理");
assert.match(listClick[0], /data-add-episode/, "卡片列表的点击要识别 ＋");
assert.match(listClick[0], /addSeriesEpisode\(addButton\)/, "＋ 要触发 addSeriesEpisode 并传按钮以禁用");

// ── 第二条:不再弹 prompt 问集数,直接建下一集 ──
const fn = app.match(/async function addSeriesEpisode\([\s\S]*?\n\}/);
assert.ok(fn, "找不到 addSeriesEpisode");
assert.doesNotMatch(fn[0], /window\.prompt/, "不应再弹 prompt 问集数");
assert.match(fn[0], /const episodeSlug = nextEpisodeSlug\(episodes\)/, "集数应自动取下一集");
// 剧本要清空,资产描述也不带过来。
assert.match(fn[0], /scriptText: ""/, "新集剧本必须为空");
// 不能塞任何非空剧本进去，否则新集一开就带内容。
assert.doesNotMatch(fn[0], /scriptText: "[^"]/, "新集不应预置任何剧本内容");
assert.doesNotMatch(fn[0], /assetDescriptionText: "[^"]/, "新集不应预置资产描述");
assert.match(fn[0], /reuseExistingProject: true/, "必须复用同一项目目录，资产库才继承");
assert.match(fn[0], /projectDir: project\.projectDir/, "必须传同一 projectDir");
// 防连点重复建集。
assert.match(fn[0], /if \(addSeriesEpisode\.pending\) return;/, "需防重复点击");
assert.match(fn[0], /finally \{[\s\S]*?pending = false/, "pending 必须在 finally 里复位");

// 剧本框回填必须回落空串,否则切到新集还留着旧剧情。
assert.match(app, /\$\("#modernScriptText"\); if \(el\) el\.value = data\.contents\.script \|\| ""/,
  "剧本框需以 data.contents.script || '' 回填，新集才会清空");

// ＋ 在卡片列表里要占满整行并与卡片对齐。
assert.match(styles, /\.modern-episode-add-row \{[^}]*width: 100%/);
assert.match(styles, /\.modern-episode-add-row \{[^}]*min-height: 40px/);
assert.match(styles, /\.modern-episode-add-row:disabled/, "建集中要有禁用态");

console.log("add-episode-sidebar: OK");
