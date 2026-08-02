// 跨请求缓存只保存画布文件的归属索引,不共享 JSON.parse 出来的可变 state。
// 计数器必须在 server.js 加载前安装,否则 server.js 内的缓存包装会把命中和穿透
// 都包在计数器外,读盘收益会被测成一样。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(root, ".tmp-canvas-state-cache-"));
const stateDir = path.join(tmp, ".pixel-toys-canvas-states");
const episodeA = path.join(tmp, "outputs", "e01");
const episodeB = path.join(tmp, "outputs", "e02");
fs.mkdirSync(episodeA, { recursive: true });
fs.mkdirSync(episodeB, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });

const encodeId = (value) => Buffer.from(value, "utf8").toString("base64url");
const projectIdA = encodeId(episodeA);
const projectIdB = encodeId(episodeB);
const filesA = [];
const filesB = [];
for (let index = 0; index < 3; index += 1) {
  const file = path.join(stateDir, `state-a-${index}.json`);
  filesA.push(file);
  fs.writeFileSync(file, JSON.stringify({
    projectId: projectIdA,
    updatedAt: `2026-08-01T00:0${index}:00.000Z`,
    name: `A-${index}`,
    nodes: [],
    assets: [],
  }));
}
for (let index = 0; index < 7; index += 1) {
  const file = path.join(stateDir, `state-b-${index}.json`);
  filesB.push(file);
  fs.writeFileSync(file, JSON.stringify({
    projectId: projectIdB,
    updatedAt: `2026-08-01T01:0${index}:00.000Z`,
    name: `B-${index}`,
    nodes: [],
    assets: [],
  }));
}
fs.writeFileSync(path.join(stateDir, "ignored.txt"), "not json");

let reads = 0;
const realReadFileSync = fs.readFileSync;
fs.readFileSync = function (...args) {
  const file = typeof args[0] === "string" ? path.resolve(args[0]) : "";
  if (file.startsWith(`${stateDir}${path.sep}`)) reads += 1;
  return realReadFileSync.apply(this, args);
};

const previousCwd = process.cwd();
process.chdir(tmp);
try {
  const require = createRequire(import.meta.url);
  const { __test } = require(path.join(root, "server.js"));
  const canvasStatesForEpisodeRoot = __test.canvasState.canvasStatesForEpisodeRoot;

  reads = 0;
  const firstA = canvasStatesForEpisodeRoot(episodeA);
  const coldReads = reads;
  assert.deepEqual(firstA.map((state) => state.name), ["A-2", "A-1", "A-0"], "同一集结果须按 updatedAt 倒序");
  assert.equal(coldReads, filesA.length + filesB.length + filesA.length, "首次建立归属索引必须读过全部 JSON,再加载 A 集 state");

  reads = 0;
  const secondA = canvasStatesForEpisodeRoot(episodeA);
  assert.deepEqual(secondA, firstA, "缓存前后 state 集合与顺序必须等价");
  assert.notEqual(secondA[0], firstA[0], "跨调用不得复用可变 state 对象");
  assert.equal(reads, filesA.length, "稳定态只允许真正读取当前 episode 的文件");

  reads = 0;
  const firstB = canvasStatesForEpisodeRoot(episodeB);
  assert.deepEqual(firstB.map((state) => state.name), ["B-6", "B-5", "B-4", "B-3", "B-2", "B-1", "B-0"], "不同 episode 不得串集");
  assert.equal(reads, filesB.length, "B 集命中索引后只读 B 集文件");

  const movedFile = filesB[0];
  fs.writeFileSync(movedFile, JSON.stringify({
    projectId: projectIdA,
    updatedAt: "2026-08-01T02:00:00.000Z",
    name: "B-0 moved to A",
    nodes: [],
    assets: [],
    changedMarker: "mtime-plus-size",
  }));
  reads = 0;
  const afterChangeA = canvasStatesForEpisodeRoot(episodeA);
  assert.equal(afterChangeA[0].name, "B-0 moved to A", "修改文件后下一次调用必须立刻看到新归属和内容");
  assert.equal(afterChangeA.length, filesA.length + 1, "修改后的文件必须进入新的 episode");
  assert.equal(reads, filesA.length + 2, "修改文件只需为归属和 state 做有限次真实读取");

  console.log(`canvas state scan cache tests passed: 冷启动 ${coldReads} → 稳定态 ${filesA.length} 次相关读`);
} finally {
  process.chdir(previousCwd);
  fs.readFileSync = realReadFileSync;
  fs.rmSync(tmp, { recursive: true, force: true });
}
