import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// 「小屋卧室」这类居室名字命中不了场景关键词表，落盘时被静默过滤掉，
// addManualAsset 随后 find 不到新条目、返回 undefined，调用方读 .id 崩成
// "Cannot read properties of undefined (reading 'id')" —— 用户只看到"上传失败"。
const require = createRequire(import.meta.url);
const server = require(path.resolve("server.js"));
const upload = server.__test?.assetUpload;
assert.equal(typeof upload?.uploadLocalAsset, "function", "asset upload helpers must be exposed for focused tests");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

function makeEpisode() {
  const projectDir = fs.mkdtempSync(path.join(path.resolve("."), ".manual-upload-test-"));
  const episodeRoot = path.join(projectDir, "outputs", "e01");
  fs.mkdirSync(path.join(episodeRoot, "01_script"), { recursive: true });
  fs.writeFileSync(path.join(episodeRoot, "01_script", "e01_script.md"), "咕咚回到小屋，走上二楼的卧室。", "utf8");
  return { projectDir, episodeRoot };
}

function uploadScene(episodeRoot, label) {
  return upload.uploadLocalAsset(episodeRoot, {
    type: "Scene",
    label,
    description: "木质床架，暖黄夜灯，窗外森林剪影。",
    filename: "bedroom.png",
    contentBase64: PNG.toString("base64"),
    confirm: true,
  });
}

// 前半是用户实际用过的名字和同类居室名(靠关键词表覆盖)；
// 后半是自造地名——关键词表永远覆盖不到这类，只能靠"用户手动指定的资产不被启发式否决"。
for (const label of [
  "小屋卧室", "卧室", "客厅", "书房", "地下室", "阁楼", "小屋厨房", "森林小屋外景",
  "咕咚的窝", "灶间", "望星台", "苔藓地", "老槐树下", "阿茶铺子",
]) {
  const { projectDir, episodeRoot } = makeEpisode();
  try {
    const result = uploadScene(episodeRoot, label);
    assert.ok(result?.asset?.id, `manual scene upload must persist "${label}" and return its asset`);
    assert.match(result.asset.id, /^S\d{3}_/, `manual scene "${label}" must land in the scene id space`);
    assert.equal(result.asset.label, label, `manual scene "${label}" must keep the user's label`);
    const persisted = server.__test.seriesAssets.readAssetManifest(episodeRoot).data.items || [];
    assert.ok(persisted.some((item) => item.id === result.asset.id), `manual scene "${label}" must be readable back from the manifest`);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

// 模型解析出的居室场景没有"手动豁免"这条后路，只能靠场景关键词表覆盖。
// 缺了关键词它们会在落盘时被静默丢掉——用户看到的是资产凭空少了几个。
{
  const series = server.__test?.seriesAssets;
  assert.equal(typeof series?.writeAssetManifest, "function", "manifest writer must be exposed for focused tests");
  const { projectDir: modelProject, episodeRoot: modelEpisode } = makeEpisode();
  try {
    for (const label of ["卧室", "客厅", "书房", "阁楼", "地下室", "院子"]) {
      const item = {
        id: `S001_${label}_WIDE_ESTABLISHING`,
        type: "Scene",
        label,
        source: "model",
        evidence: `咕咚走进${label}`,
        visual: "木质床架，暖黄夜灯",
        usage: "只作场景/空间参考",
        generate: true,
        confirmed: false,
      };
      const written = series.writeAssetManifest(modelEpisode, { version: 1, title: "t", confirmed: true, items: [item] });
      assert.equal((written.items || []).length, 1, `a model-parsed "${label}" scene must survive manifest normalization`);
    }
  } finally {
    fs.rmSync(modelProject, { recursive: true, force: true });
  }
}

// 仍被拒的名字(非视觉音频提示)必须报出能看懂的原因，而不是 undefined.id 崩溃
const { projectDir, episodeRoot } = makeEpisode();
try {
  assert.throws(
    () => uploadScene(episodeRoot, "旁白"),
    (error) => {
      const message = String(error?.message || "");
      assert.doesNotMatch(message, /Cannot read properties of undefined/, "dropped assets must not surface as an undefined property crash");
      assert.match(message, /旁白/, "the failure must name the asset the user tried to upload");
      return true;
    },
    "a rejected label must fail with an explicit reason",
  );
} finally {
  fs.rmSync(projectDir, { recursive: true, force: true });
}

console.log("manual asset upload label tests passed");
