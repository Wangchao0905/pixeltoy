import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("public/pixels-studio.html");
const js = read("public/pixels-studio.js");
const css = read("public/pixels-studio.css");
const home = read("public/index.html");
const server = read("server.js");

assert.match(home, /href="\/pixels-studio\.html"[^>]*>Pixels Studio<\/a>/, "首页顶栏必须提供 Pixels Studio 独立入口");
assert.match(html, /<title>Pixels Studio/, "独立页面必须有品牌标题");
assert.match(html, /href="\/pixels-studio\.css/, "独立页面必须加载自有样式");
assert.match(html, /src="\/pixels-studio\.js/, "独立页面必须加载自有脚本");

for (const category of ["product-shot", "marketplace", "ugc", "motion", "ads", "posters"]) {
  assert.match(html, new RegExp(`data-category="${category}"`), `缺少电商场景 ${category}`);
}
for (const mode of ["image", "video"]) {
  assert.match(html, new RegExp(`data-mode="${mode}"`), `缺少 ${mode} 生成模式`);
}
for (const slot of ["product", "avatar", "reference"]) {
  assert.match(html, new RegExp(`data-slot="${slot}"`), `缺少 ${slot} 素材槽位`);
}
for (const control of ["prompt", "model", "style", "ratio", "duration", "batch", "generate"]) {
  assert.match(html, new RegExp(`id="pixels-${control}"`), `缺少 Pixels Studio 控件 ${control}`);
}
for (const template of ["product-shot", "marketplace", "ugc", "motion"]) {
  assert.match(html, new RegExp(`data-template="${template}"`), `缺少模板 ${template}`);
}
for (const nav of ["home", "generations", "favorites", "projects", "assets", "new-project"]) {
  assert.match(html, new RegExp(`data-nav="${nav}"`), `缺少工作区导航 ${nav}`);
}

assert.match(js, /const HISTORY_KEY\s*=\s*["']pixelToys\.pixelsStudioHistory\.v1["']/, "必须使用独立本地历史键");
assert.match(js, /\/api\/canvas\/public-assets/, "必须接入公共图片上传接口");
assert.match(js, /\/api\/canvas\/image-generation/, "图片模式必须接入图片生成接口");
assert.match(js, /\/api\/canvas\/image-generations\//, "图片模式必须轮询任务状态");
assert.match(js, /\/api\/canvas\/video-generations/, "视频模式必须接入视频生成接口");
assert.match(js, /\/api\/canvas\/video-generations\//, "视频模式必须轮询任务状态");
assert.match(js, /\/api\/asset-library/, "必须接入素材库接口");
assert.match(js, /const IMAGE_MODEL_OPTIONS\s*=\s*Object\.freeze/, "必须定义真实图片模型目录");
assert.match(js, /const VIDEO_MODEL_OPTIONS\s*=\s*Object\.freeze/, "必须定义真实视频模型目录");
for (const model of ["gpt-image-2", "seedream-5-0-pro", "seedream-5-0-lite", "grok-imagine-image"]) {
  assert.match(js, new RegExp(`value: "${model}"`), `图片模型目录缺少 ${model}`);
}
for (const model of ["sd2", "sd2-fast", "seedance-2-5", "seedance-2-5-c", "seedance-2-5-m", "seedance-2-0", "seedance-2-0-fast", "seedance-2-0-mini", "seedance-2-0-m", "seedance-2-0-m-fast", "seedance-2-0-m-fast-mini", "mx-h3", "seedance-2-0-byteplus", "grok-imagine-video"]) {
  assert.match(js, new RegExp(`value: "${model}"`), `视频模型目录缺少 ${model}`);
}
assert.match(js, /imageModel:\s*result\.model/, "图片请求必须使用当前选中的图片模型");
assert.match(js, /videoModel:\s*result\.model/, "视频请求必须使用当前选中的视频模型");
assert.match(js, /assets:\s*references\(\)\.map\(\(image, index\) => \(\{/, "视频请求必须把参考素材转换为后端需要的 assets");
assert.match(js, /id:\s*`pixels-reference-\$\{index \+ 1\}`/, "视频参考素材必须有稳定的请求内素材 ID");
assert.match(js, /previewUrl:\s*image\.preview \|\| image\.url/, "视频参考素材必须提供预览地址兼容字段");
assert.match(js, /function renderModelOptions\(\)/, "模式切换必须重新渲染模型选项");
assert.doesNotMatch(html, /<option value="seedance-2-0">Seedance/, "图片初始模型列表不得混入视频模型");
assert.match(js, /status:\s*["']running["']|status\s*=\s*["']running["']/, "生成中状态必须显式存在");
assert.match(js, /status:\s*["']failed["']|status\s*=\s*["']failed["']/, "失败状态必须显式存在");
assert.match(js, /status:\s*["']completed["']|status\s*=\s*["']completed["']/, "完成状态必须显式存在");
assert.match(js, /login|登录/i, "未登录时必须给出登录提示");
assert.match(js, /batch/, "生成请求必须处理批量数量");

assert.match(css, /\.pixels-page\s*\{/, "必须有独立页面根样式");
assert.match(css, /\.pixels-sidebar\s*\{/, "必须有 Marketing Studio 式侧栏");
assert.match(css, /\.pixels-composer\s*\{/, "必须有核心生成 composer");
assert.match(css, /\.pixels-template-grid\s*\{/, "必须有模板画廊样式");
assert.match(css, /@media\s*\(max-width:\s*760px\)/, "必须有窄屏布局");

assert.match(server, /pathname === "\/pixels-studio\.html"/, "服务端必须公开独立页面");
assert.match(server, /pathname === "\/pixels-studio\.js"/, "服务端必须公开独立脚本");
assert.match(server, /pathname === "\/pixels-studio\.css"/, "服务端必须公开独立样式");
assert.match(server, /pathname\.startsWith\("\/pixels-studio\/"\)/, "服务端必须公开模板资产目录");

console.log("pixels studio tests passed");
