// Super Pixel 对话图片：多模态 content 解析 + 内联 base64 方向
// 关键回归点：对话看图必须内联 data URL。实测上游不抓公网 https 图片链接
// （模型回「我没有收到图片」）。别再改回 assetUrlToReferenceUrl 那套公网 URL 方案。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = (await import("node:module")).createRequire(import.meta.url);
const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js");
const sp = require(serverPath).__test.superPixel;

// content：纯文本保持字符串，多模态保持数组
assert.equal(sp.content("你好"), "你好", "纯文本应保持字符串");
assert.deepEqual(
  sp.content([{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }]),
  [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }],
  "多模态数组应原样保留",
);
assert.equal(sp.content([{ type: "image_url", image_url: { url: "" } }]), "", "空 url 应被丢弃");

// 旧 bug：String(数组) 会压成 "[object Object]"
const shaped = sp.messages([{ role: "user", content: [{ type: "text", text: "x" }] }]);
assert.ok(!JSON.stringify(shaped).includes("object Object"), "数组 content 不能被 String() 压扁");

// 单条消息图片数上限
const many = Array.from({ length: 20 }, (_, i) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${i}` } }));
assert.equal(sp.content(many).length, sp.maxImages, `单条消息图片应截到 ${sp.maxImages} 张`);

// resolveImages：data URL 必须原样内联，不能被转成 http(s) 公网地址
const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
const resolved = await sp.resolveImages([
  { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: dataUrl } }] },
]);
assert.equal(resolved[0].content[1].image_url.url, dataUrl, "data URL 必须保持内联，不得转公网 URL");
assert.ok(!/^https?:\/\//i.test(resolved[0].content[1].image_url.url), "图片地址不能是 http(s) 链接");

// 本地真实文件：/media?path= 应被读成 data URL
// 必须放在工作区内：/media?path= 会走 allowedPath 校验，工作区外一律拒绝
const tmpPng = path.join(process.cwd(), `.sp-image-test-${process.pid}.png`);
fs.writeFileSync(tmpPng, Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
try {
  const viaMedia = await sp.resolveImages([
    { role: "user", content: [{ type: "image_url", image_url: { url: `/media?path=${encodeURIComponent(tmpPng)}` } }] },
  ]);
  const url = viaMedia[0]?.content?.[0]?.image_url?.url || "";
  assert.ok(url.startsWith("data:image/png;base64,"), `本地图应内联为 data URL，实际: ${url.slice(0, 40)}`);
} finally {
  fs.rmSync(tmpPng, { force: true });
}

// 无法内联的图（asset:// 没有本地文件）应被跳过，但同消息的文字要保留
const skipped = await sp.resolveImages([
  { role: "user", content: [{ type: "text", text: "还在" }, { type: "image_url", image_url: { url: "asset://nope" } }] },
]);
assert.equal(skipped[0].content.length, 1, "无法内联的图应被跳过");
assert.equal(skipped[0].content[0].text, "还在", "跳过图片后文字必须保留");

console.log("super pixel image tests passed");
