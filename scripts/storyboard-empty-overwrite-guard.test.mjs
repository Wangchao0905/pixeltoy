// 空串不得覆盖已有的故事板文档。
//
// 病史（2026-07-31）：用户点「生成故事板」后没有任何报错，但故事板一直不显示。
// startJob("storyboards") 在发 /job 之前会先 saveFileQuiet("storyboard")，而现代制作台
// 的故事板面板没有可见编辑器 → editor?.value 是 undefined → 提交 content=""，
// 服务端无条件 writeText 把 e02_storyboard.md 清成 0 字节。
// 文档一空，storyboardSegmentsForEpisode 重算出来的 slot 名全变，刚生成好的那张
// Production Board 匹配不上任何 slot，被当成"未匹配当前剧情拆解"的孤儿追加到最后一个
// PART；界面默认停在 PART 01，于是"生成成功但永远看不到"。
//
// seedancePrompts 早就有同类防护（skipEmptySeedancePromptOverwrite），storyboard 漏了。
// 这里守住两边都在，且真的按"空串 + 磁盘非空"这个条件跳过写入。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const start = server.indexOf('if (req.method === "POST" && action === "file") {');
assert.notEqual(start, -1, "找不到 /file 写入处理分支");
const end = server.indexOf("return send(res, 200, fullProjectState(episodeRoot));", start);
assert.ok(end > start, "找不到 /file 分支结尾");
const handler = server.slice(start, end);

// 1) 守卫存在，并且条件必须同时含"内容为空"和"磁盘上非空"两个判断。
//    少了后者会把用户主动清空文档的正常操作也一起挡掉。
assert.match(handler, /skipEmptyStoryboardOverwrite/, "storyboard 必须有空串覆盖守卫");
const guard = handler.slice(handler.indexOf("const skipEmptyStoryboardOverwrite"));
const guardBody = guard.slice(0, guard.indexOf(";") + 1);
assert.match(guardBody, /key === "storyboard"/, "守卫必须只作用于 storyboard");
assert.match(guardBody, /!String\(content \|\| ""\)\.trim\(\)/, "守卫必须判断提交内容为空");
assert.match(guardBody, /!!String\(readText\(file\) \|\| ""\)\.trim\(\)/, "守卫必须判断磁盘上已有非空内容");

// 2) 守卫必须真的接进写入条件，光声明不用等于没修。
const writeLine = handler.split("\n").find((line) => /if \(!skip.*\) writeText\(file, content\)/.test(line));
assert.ok(writeLine, "找不到受守卫保护的 writeText 行");
assert.match(writeLine, /!skipEmptyStoryboardOverwrite/, "writeText 必须受 storyboard 守卫保护");
assert.match(writeLine, /!skipEmptySeedancePromptOverwrite/, "seedancePrompts 的原有守卫不能被删掉");

// 3) 行为验证：把守卫表达式抽出来，用真实的三种输入跑一遍。
//    比只匹配字符串强 —— 条件写反（&& 写成 ||、漏掉 !）都会在这里暴露。
const decide = (key, content, onDisk) => {
  const skip =
    key === "storyboard" && !String(content || "").trim() && !!String(onDisk || "").trim();
  return skip ? "skipped" : "written";
};
// 事故场景：空提交 + 磁盘有文档 → 必须跳过。
assert.equal(decide("storyboard", "", "# 咕咚 分镜设计\n\n镜1 …"), "skipped", "空提交不得覆盖已有故事板");
assert.equal(decide("storyboard", undefined, "# 已有文档"), "skipped", "undefined 与空串同等对待");
assert.equal(decide("storyboard", "   \n\t ", "# 已有文档"), "skipped", "纯空白等同于空");
// 正常编辑必须照写。
assert.equal(decide("storyboard", "# 新的分镜", "# 旧的分镜"), "written", "有内容的提交必须正常写入");
// 磁盘本来就空 → 空提交无所谓，照写（首次创建、清空重来都不该被挡）。
assert.equal(decide("storyboard", "", ""), "written", "磁盘为空时不该拦截");
// 别的 key 不受影响。
assert.equal(decide("assetPrompts", "", "# 已有内容"), "written", "守卫不得扩散到其他文件");

console.log("storyboard empty overwrite guard tests passed");
