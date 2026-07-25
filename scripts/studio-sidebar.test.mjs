import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const sidebar = html.match(/<aside class="studio-sidebar"[\s\S]*?<\/aside>/)?.[0] || "";

assert.ok(sidebar, "short drama workspace sidebar must exist");
assert.doesNotMatch(sidebar, /studio-sidebar-nav|studioProjectsButton|studioNewProject|studioCanvasButton/, "sidebar should not expose project, new, or canvas shortcuts");
assert.match(sidebar, /studio-sidebar-brand[\s\S]*?pixel-toys-wordmark/, "sidebar should render the Production OS wordmark at the top");

const modes = [...sidebar.matchAll(/data-workspace-mode-button="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(modes, ["script", "image", "shots", "storyboard", "video"], "sidebar should expose the production modules in workflow order");
assert.match(sidebar, /data-workspace-mode-button="script"[^>]+title="剧本（剧情→生成分镜草稿）"/, "script module should include storyboard breakdown in its title");
assert.match(sidebar, /data-workspace-mode-button="image"[^>]+aria-label="资产图"/, "asset generation module should be labeled as asset images");
assert.match(html, /data-explore-tool="image-generation"/, "standalone Image tool should remain available outside the short drama sidebar");
assert.match(sidebar, /data-workspace-mode-button="script"[^>]*>剧本<\/button>/, "script sidebar action should use visible text");
assert.match(sidebar, /data-workspace-mode-button="image"[^>]*>资产图<\/button>/, "asset sidebar action should use visible text");
assert.match(sidebar, /data-workspace-mode-button="shots"[^>]*>分镜<\/button>/, "storyboard breakdown sidebar action should use visible text");
assert.match(sidebar, /data-workspace-mode-button="storyboard"[^>]*>故事板<\/button>/, "storyboard sidebar action should use visible text");
assert.match(sidebar, /data-workspace-mode-button="video"[^>]*>视频<\/button>/, "video sidebar action should use visible text");
assert.deepEqual(
  [...sidebar.matchAll(/data-workspace-mode-button="([^"]+)" data-nav-index="([^"]+)"/g)].map((match) => [match[1], match[2]]),
  [["script", "01"], ["image", "02"], ["shots", "03"], ["storyboard", "04"], ["video", "05"]],
  "sidebar modules should expose stable navigation indexes",
);
assert.doesNotMatch(sidebar, />[▤◇▦▶]<\/button>/, "sidebar actions should not render the old icon glyphs");

console.log("studio-sidebar.test: ok");
