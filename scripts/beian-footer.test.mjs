import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// 备案号是合规展示要求(工信部 ICP + 公安网安备案),首页必须可见且可点击。
// 被误删或链接写错都有监管风险,所以钉死在测试里。
const root = new URL("..", import.meta.url).pathname;
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

const ICP = "鲁ICP备2026038084号";
const MPS = "鲁公网安备37010402441634号";
const MPS_CODE = "37010402441634";

// --- 1) 两个备案号都必须出现在首页 ---
assert.ok(html.includes(ICP), `首页必须展示 ICP 备案号：${ICP}`);
assert.ok(html.includes(MPS), `首页必须展示公安网安备案号：${MPS}`);

// --- 2) 必须是可点击外链,且指向正确的官方查询地址 ---
const footerStart = html.indexOf('<footer class="site-beian"');
assert.notEqual(footerStart, -1, "必须存在 .site-beian 页脚容器");
const footer = html.slice(footerStart, html.indexOf("</footer>", footerStart));

assert.match(footer, /href="https:\/\/beian\.miit\.gov\.cn\/"/, "ICP 号必须链到工信部备案系统");
// 公安部备案查询必须带 code 参数,否则打开是空查询页,备不到案。
assert.ok(
  footer.includes(`https://beian.mps.gov.cn/#/query/webSearch?code=${MPS_CODE}`),
  "公网安备必须链到公安部查询页且带 code 参数",
);

// 两条外链都要 target=_blank + rel 防 tabnabbing
const anchors = footer.match(/<a\b[^>]*>/g) || [];
assert.equal(anchors.length, 2, "页脚应恰好两条备案链接");
for (const a of anchors) {
  assert.match(a, /target="_blank"/, "备案链接必须新窗口打开");
  assert.match(a, /rel="noreferrer noopener"/, "备案链接必须带 rel 防 tabnabbing");
}

// --- 3) 页脚必须在首页可见区块内,不能落在 hidden 容器之后被隐藏 ---
const exploreStart = html.indexOf('<section id="exploreHome"');
const projectStart = html.indexOf('<section id="projectHome"');
assert.notEqual(exploreStart, -1, "exploreHome 必须存在");
assert.ok(footerStart > exploreStart, "备案页脚必须位于 exploreHome 内");
assert.ok(footerStart < projectStart, "备案页脚必须在 exploreHome 闭合前,否则会落到别的视图里");

// --- 4) 样式必须存在,否则页脚会挤在内容里没有分隔 ---
assert.match(css, /\.site-beian\s*\{/, "必须有 .site-beian 样式");
assert.match(css, /\.site-beian a\s*\{/, "必须有链接样式");

// --- 5) 制作台入口用 ETag 重验证；独立页面仍可使用版本戳 ---
const indexSource = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
assert.match(indexSource, /<link rel="stylesheet" href="\/styles\.css"\s*\/>/, "index.html 的 styles.css 必须走 ETag 重验证");
for (const page of ["admin.html", "canvas.html", "pixeltale.html"]) {
  const source = fs.readFileSync(path.join(root, "public", page), "utf8");
  assert.match(source, /styles\.css\?v=[A-Za-z0-9._-]+/, `${page} 的 styles.css 必须带缓存戳`);
}

console.log("beian footer tests passed");
