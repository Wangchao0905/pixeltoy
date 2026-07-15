import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSeriesPreflight } from "./series-preflight.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const script = `
# 《裂隙追凶》

第1集 失踪的雨夜
场景1：雨夜，废弃工厂外。
林夏带着旧怀表追踪黑色货车。周凛在远处观察。

场景2：废弃工厂内。
林夏发现血迹和银色钥匙，周凛提醒她别碰证物。

第2集 地下诊所
场景1：地下诊所，清晨。
林夏换上灰色风衣，医生阿岚检查旧怀表。

场景2：天桥下。
周凛把银色钥匙交给林夏，黑色货车再次出现。
`;

const result = analyzeSeriesPreflight({ scriptText: script, title: "裂隙追凶" });

assert.equal(result.title, "裂隙追凶");
assert.equal(result.episodes.length, 2);
assert.equal(result.episodes[0].scenes.length, 2);
assert.equal(result.episodes[1].scenes.length, 2);

assert.deepEqual(
  result.seriesBible.characters.map((item) => item.name),
  ["林夏", "周凛", "阿岚"],
);
assert.deepEqual(
  result.seriesBible.props.map((item) => item.name),
  ["旧怀表", "银色钥匙", "黑色货车"],
);
assert.deepEqual(
  result.seriesBible.locations.map((item) => item.name),
  ["废弃工厂", "地下诊所", "天桥下"],
);

assert.equal(result.assetPlan.coreAssets.length, 9);
assert.equal(result.executionPlan.generatesMedia, false);
assert.match(result.summary, /2 集/);
assert.match(result.summary, /4 场/);

const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

assert.match(server, /\/api\/series-preflight/, "server should expose the series preflight endpoint");
assert.match(app, /runSeriesPreflight/, "frontend should bind a local preflight action");
assert.match(app, /\/api\/series-preflight/, "frontend should call the preflight endpoint");
assert.match(html, /seriesPreflightButton/, "project modal should include a preflight button");
