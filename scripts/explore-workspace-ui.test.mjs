import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.match(server, /function uiRuntimeConfig\(\)/);
assert.match(server, /exploreEnabled:\s*process\.env\.PIXEL_TOYS_EXPLORE_UI !== "0"/);
assert.match(server, /ui:\s*uiRuntimeConfig\(\)/);
assert.match(server, /function isStandaloneImageGenerationApiPath\(pathname = ""\)/);
assert.match(server, /if \(isStandaloneImageGenerationApiPath\(url\.pathname\)\)/);
assert.match(html, /id="exploreHome"/);
assert.match(html, /id="projectHome"[^>]*class="project-home hidden"/, "旧项目首页必须默认隐藏，避免首屏闪现蓝色旧页面");
assert.match(html, /class="explore-brand-mark pixel-toys-wordmark"/);
assert.match(html, /id="exploreLoginLink"[^>]*href="\/auth\.html\?next=\/"[^>]*>登录<\/a>/);
assert.match(html, /id="exploreAccount"[^>]*aria-label="个人中心"/);
assert.match(html, /id="personalCenterDialog"/);
assert.match(html, /id="imageExploreView"/);
assert.match(html, /id="assetLibraryView"/);
assert.match(html, /id="exploreCanvasGrid"/);
assert.match(html, /data-explore-scope="all"/);
assert.match(html, /data-explore-scope="personal"/);
assert.match(html, /data-explore-scope="team"/);
assert.match(html, /data-explore-tool="asset-library"/);
// Super Pixel 已从 disabled 占位转为可用工具入口，详见 super-pixel-view.test.mjs
assert.match(html, /data-explore-tool="super-pixel"/);
assert.doesNotMatch(html, /data-explore-tool="video-generation"|data-explore-tool="production-board"/);

const videoSlots = html.match(/data-video-slot="work-\d+"/g) || [];
assert.equal(videoSlots.length, 6, "首页必须保留六个独立视频位");
assert.equal((html.match(/\/home-videos\/work-\d+\.mp4/g) || []).length, 6);
assert.equal((html.match(/\/home-videos\/posters\/work-\d+\.jpg/g) || []).length, 6);
for (const mode of ["script", "image", "shots", "storyboard", "video"]) {
  assert.match(html, new RegExp(`data-workspace-mode-button="${mode}"`));
}
assert.match(html, /id="referenceKitPanel"/);
assert.match(html, /id="studioTabStoryboards"/);
assert.match(html, /<h2>Production Board<\/h2>/);
assert.match(html, /id="lightboxDownload"[^>]*download/);
assert.match(app, /PixelToysWorkspaceShell\.shouldEnableExplore/);
assert.match(app, /function setWorkspaceMode/);
assert.match(app, /function renderExploreHome/);
assert.match(app, /function showExploreImageTool/);
assert.match(app, /function submitImageExploreGeneration/);
assert.match(app, /function renderExploreCanvasLibrary/);
assert.match(app, /function exploreProductionPreviewMarkup/);
assert.match(app, /data-explore-project-preview/);
assert.match(app, /project\.preview/);
assert.match(app, /function renderAssetInspector/);
assert.match(app, /function openPersonalCenter/);
assert.match(app, /function createEmptyProject\(\)[\s\S]*?projectName:\s*"Untitled"[\s\S]*?scriptText:\s*""/);
assert.match(app, /function openProjectModal\(\)\s*\{\s*return createEmptyProject\(\);/);
assert.match(app, /exploreLoginLink\?\.classList\.toggle\("hidden", !!data\.user\)/);
assert.match(app, /function setupExploreVideoPlayback/);
assert.match(styles, /\.video-showcase-six/);
assert.match(styles, /\.video-showcase-grid-six/);
assert.match(styles, /\.explore-canvas-library/);
assert.match(styles, /\.explore-production-preview video/);
assert.match(styles, /\.image-explore-composer/);
assert.match(styles, /\.password-dialog/);
assert.match(styles, /pixel-toys-wordmark/);
console.log("explore workspace UI tests passed");
