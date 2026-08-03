import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 多张参考图靠 --reference-image 传给 image-gen,分隔符选错就静默丢图。历史踩过两次:
//  1) path.delimiter(Linux 是冒号)→ https:// 被切碎,第二张起全丢。
//  2) 正则 /\n|:(?!\/\/)/ → data:image/png;base64,... 切成 ["data", ...],
//     "data" 被当本地路径读 → image_path_not_found(用户看到"本地图片路径不存在")。
// 结论:只能按 \n 切,因为 \n 是唯一不可能出现在 URL / data URI / POSIX 路径里的字符。
// 这个测试同时锁 join 侧(3 处)和 split 侧(1 处)。

const root = new URL("..", import.meta.url).pathname;
const imageGen = fs.readFileSync(path.join(root, "scripts/vendor/image-gen.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts/run_asset_generation.js"), "utf8");

// --- split 侧 ---
const splitMatch = imageGen.match(
  /const extraReferences = String\(args\["reference-image"\] \|\| ""\)[\s\S]{0,500}?\.filter\(Boolean\);/,
);
assert.ok(splitMatch, "image-gen.js 必须保留 --reference-image 的解析段");
const splitBlock = splitMatch[0];
assert.match(splitBlock, /\.split\("\\n"\)/, "只能按 \\n 切分参考图列表");
assert.doesNotMatch(splitBlock, /path\.delimiter/, "不得用 path.delimiter:冒号会切碎 https://");
assert.doesNotMatch(splitBlock, /:\(\?!/, "不得用含冒号的正则:会切碎 data: URI");

// --- join 侧 ---
assert.doesNotMatch(server, /join\(path\.delimiter\)/, "server.js 不得用 path.delimiter 拼接参考图");
assert.doesNotMatch(runner, /join\(path\.delimiter\)/, "runner 不得用 path.delimiter 拼接参考图");
assert.match(
  server,
  /args\.push\("--reference-image", referenceInputs\.slice\(1\)\.join\("\\n"\)\)/,
  "画布出图必须用 \\n 拼接多张参考图",
);

// --- 行为验证:复刻 split 逻辑,各类真实输入拼接后必须完全还原 ---
const splitRefs = (value) => String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);

// 形态清单来自一轮穷举分析,已逐条实测。重点是"含冒号但绝不能被切开"的那些。
const CASES = [
  ["单个 https URL", ["https://s3.example.com/a.png"]],
  ["多个 https URL", ["https://s3.example.com/a.png", "https://s3.example.com/b.png", "https://s3.example.com/c.png"]],
  ["data URI(base64 不含换行)", ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUg"]],
  ["POSIX 本地路径", ["/home/u/app/assets/C001.png", "/home/u/app/assets/S001.png"]],
  ["URL 与本地路径混合", ["https://s3.example.com/a.png", "/home/u/app/assets/S001.png"]],
  ["带端口与认证信息", ["https://user:secret@s3.example.com:8443/a.png"]],
  ["IPv6 主机(冒号密集)", ["http://[2001:db8::1]:8080/a.png"]],
  ["URL 编码的中文路径", ["https://s3.example.com/%E4%B8%AD%E6%96%87/%E5%9B%BE.png"]],
  ["预签名 URL(多查询参数含冒号编码)", ["https://s3.amazonaws.com/b/k?X-Amz-Date=20231012T235959Z&X-Amz-Signature=abcdef"]],
  ["Windows 盘符路径", ["C:\\Users\\Name\\Pictures\\photo.jpg"]],
  ["UNC 路径", ["\\\\server\\share\\path\\file.png"]],
  ["路径含冒号与井号", ["/home/u/图片:头像#1.png"]],
];

for (const [label, inputs] of CASES) {
  assert.deepEqual(splitRefs(inputs.join("\n")), inputs, `${label}:拼接再切分必须完全还原`);
}

// trim + filter(Boolean) 是必需的清洗步骤,不是多余的:
// - \r\n 换行风格会在切分后于前一项尾部残留 \r,污染 URL,靠 trim 吃掉。
// - 空项/纯空白项没有意义,靠 filter 丢弃,避免下游把 "" 当本地路径去读。
assert.deepEqual(
  splitRefs("https://s3.example.com/a.png\r\nhttps://s3.example.com/b.png"),
  ["https://s3.example.com/a.png", "https://s3.example.com/b.png"],
  "\\r\\n 换行风格不得在 URL 尾部残留 \\r",
);
assert.deepEqual(
  splitRefs(["https://s3.example.com/a.png", "", "   \t ", "https://s3.example.com/b.png"].join("\n")),
  ["https://s3.example.com/a.png", "https://s3.example.com/b.png"],
  "空项与纯空白项必须被丢弃",
);
assert.match(splitBlock, /\.map\(\(item\) => item\.trim\(\)\)/, "必须保留 trim:否则 \\r\\n 会残留 \\r");
assert.match(splitBlock, /\.filter\(Boolean\)/, "必须保留 filter:否则空串会被当本地路径读");

console.log(`reference image delimiter tests passed (${CASES.length} 组形态 + 清洗断言)`);
