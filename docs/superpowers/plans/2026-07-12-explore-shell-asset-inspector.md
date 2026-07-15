# Explore Shell And Asset Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally gated Explore homepage and mutually exclusive five-mode production shell, including an asset prompt inspector that saves prompt text without starting paid generation.

**Architecture:** Keep the current server and `public/app.js` workflows intact, but add one small browser-safe workspace helper for mode normalization and local rollout decisions. The new shell reuses existing Script, Assets/Image, Storyboard, and Video DOM surfaces, showing only the selected mode; Image and Assets share the existing asset surface but expose different subviews. Persist one asset prompt through a focused server endpoint that updates the existing manifest and regenerated prompt markdown without creating a job.

**Tech Stack:** Node.js 18+, native HTTP server, browser JavaScript, HTML/CSS, Node `assert`, existing Vite build for the React admin page.

---

## Scope Boundary

This plan implements P0 and P1 from `docs/superpowers/specs/2026-07-12-explore-single-mode-canvas-design.md`.

Included:

- Local-only Explore feature flag and legacy escape hatch.
- Dark-canvas design tokens and global navigation.
- Explore homepage with core tool and recent-project routes.
- Script, Image, Video, Storyboard, and Assets mode exclusivity.
- Assets prompt inspector with draft protection and prompt-only save.
- Local desktop/mobile verification without provider calls.

Deferred to separate plans:

- Full redesign of Script internals.
- Full redesign of Storyboard internals.
- Full redesign of Image and Video composition flows.
- Marketplace, community, templates, publishing, billing, and creator features.

## Version-Control Limitation

The current directory is not a Git repository. Do not initialize Git as part of this plan. Each task includes the commit command to use only if the workspace is placed under Git before execution; otherwise record the checkpoint in this plan and continue.

## File Map

- Create `public/workspace-shell.js`: pure rollout and mode helpers usable in the browser and Node tests.
- Create `scripts/workspace-shell.test.js`: behavior tests for rollout and mutually exclusive mode normalization.
- Create `scripts/explore-workspace-ui.test.mjs`: structural UI and paid-generation guard assertions.
- Modify `server.js`: expose local UI configuration and add the focused asset-prompt save route.
- Modify `public/index.html`: add Explore markup, mode rail, asset inspector, and the helper script.
- Modify `public/app.js`: render Explore, switch modes, render inspector, preserve drafts, and save prompts.
- Modify `public/styles.css`: dark-canvas tokens, Explore layout, mode layout, inspector, and responsive rules.
- Modify `package.json`: add the two new tests to the existing test chain.
- Modify `scripts/self-check.mjs`: replace only assertions invalidated by the approved shell and add new invariants.

### Task 1: Add Workspace Mode And Rollout Helpers

**Files:**

- Create: `public/workspace-shell.js`
- Create: `scripts/workspace-shell.test.js`
- Modify: `public/index.html:1-12`
- Modify: `package.json:6-10`

- [ ] **Step 1: Write the failing helper test**

Create `scripts/workspace-shell.test.js`:

```js
const assert = require("node:assert/strict");
const {
  WORKSPACE_MODES,
  normalizeWorkspaceMode,
  workspaceModeForTool,
  shouldEnableExplore,
} = require("../public/workspace-shell.js");

assert.deepEqual(WORKSPACE_MODES, ["script", "image", "video", "storyboard", "assets"]);
assert.equal(normalizeWorkspaceMode("storyboard"), "storyboard");
assert.equal(normalizeWorkspaceMode("logs"), "assets");
assert.equal(normalizeWorkspaceMode(""), "assets");
assert.equal(workspaceModeForTool("short-drama"), "script");
assert.equal(workspaceModeForTool("image-generation"), "image");
assert.equal(workspaceModeForTool("video-generation"), "video");
assert.equal(workspaceModeForTool("production-board"), "storyboard");
assert.equal(shouldEnableExplore({ serverEnabled: true, search: "" }), true);
assert.equal(shouldEnableExplore({ serverEnabled: true, search: "?legacy=1" }), false);
assert.equal(shouldEnableExplore({ serverEnabled: false, search: "?explore=1" }), false);

console.log("workspace shell tests passed");
```

- [ ] **Step 2: Run the helper test and verify failure**

Run:

```bash
node scripts/workspace-shell.test.js
```

Expected: failure with `Cannot find module '../public/workspace-shell.js'`.

- [ ] **Step 3: Implement the minimal browser-safe helper**

Create `public/workspace-shell.js`:

```js
(function exposeWorkspaceShell(root) {
  const WORKSPACE_MODES = ["script", "image", "video", "storyboard", "assets"];
  const TOOL_MODE_MAP = {
    "short-drama": "script",
    "image-generation": "image",
    "video-generation": "video",
    "production-board": "storyboard",
    "asset-library": "assets",
  };

  function normalizeWorkspaceMode(value) {
    return WORKSPACE_MODES.includes(String(value || "")) ? String(value) : "assets";
  }

  function workspaceModeForTool(tool) {
    return normalizeWorkspaceMode(TOOL_MODE_MAP[String(tool || "")] || "assets");
  }

  function shouldEnableExplore({ serverEnabled = false, search = "" } = {}) {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return !!serverEnabled && params.get("legacy") !== "1";
  }

  const api = { WORKSPACE_MODES, normalizeWorkspaceMode, workspaceModeForTool, shouldEnableExplore };
  root.PixelToysWorkspaceShell = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
```

- [ ] **Step 4: Load the helper before the main application**

In `public/index.html`, immediately before the existing `/app.js` script, add:

```html
<script src="/workspace-shell.js"></script>
<script src="/app.js"></script>
```

Do not convert `app.js` to an ES module.

- [ ] **Step 5: Add the helper test to the test chain**

In `package.json`, insert this before UI structural tests:

```json
"test": "node --check server.js && node --check public/workspace-shell.js && node --check public/app.js && node --check public/admin.js && node --check public/canvas.js && node --check scripts/run_asset_generation.js && node --check scripts/pixel-toys-canvas-mcp.mjs && node --check vite.config.js && npm run build && node scripts/workspace-shell.test.js && node scripts/explore-workspace-ui.test.mjs && node scripts/asset-surface-ui.test.mjs && node scripts/series-preflight.test.mjs && node scripts/video-progress-ui.test.mjs && node scripts/project-video-without-canvas.test.mjs && node scripts/video-ref-prep.test.js && node scripts/asset-parser-regression.test.mjs && node scripts/pixel-toys-canvas-mcp.test.mjs && node scripts/self-check.mjs"
```

`scripts/explore-workspace-ui.test.mjs` is created in Task 2; until then, run the helper test directly.

- [ ] **Step 6: Run the helper test and syntax check**

Run:

```bash
node --check public/workspace-shell.js
node scripts/workspace-shell.test.js
```

Expected: `workspace shell tests passed`.

- [ ] **Step 7: Version-control checkpoint**

If Git is available:

```bash
git add public/workspace-shell.js public/index.html scripts/workspace-shell.test.js package.json
git commit -m "test: define explore workspace modes"
```

Otherwise verify `git status` reports that the directory is not a repository and mark Task 1 complete without initializing Git.

### Task 2: Expose A Local-Only Explore Flag

**Files:**

- Modify: `server.js:1651-1670`
- Modify: `server.js:17227-17232`
- Create: `scripts/explore-workspace-ui.test.mjs`

- [ ] **Step 1: Write failing source assertions for the local flag**

Create `scripts/explore-workspace-ui.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.match(server, /function uiRuntimeConfig\(\)/);
assert.match(server, /exploreEnabled:\s*process\.env\.PIXEL_TOYS_EXPLORE_UI === "1"/);
assert.match(server, /ui:\s*uiRuntimeConfig\(\)/);
assert.match(html, /id="exploreHome"/);
assert.match(html, /data-workspace-mode="script"/);
assert.match(html, /data-workspace-mode="assets"/);
assert.match(html, /id="assetInspectorPrompt"/);
assert.match(app, /function setWorkspaceMode/);
assert.match(app, /function renderExploreHome/);
assert.match(app, /function saveAssetPrompt/);
assert.match(styles, /--explore-bg:\s*#080d14/i);
assert.doesNotMatch(app, /saveAssetPrompt[\s\S]{0,900}type:\s*"asset-edit"/);

console.log("explore workspace UI tests passed");
```

- [ ] **Step 2: Run the structural test and verify failure**

Run:

```bash
node scripts/explore-workspace-ui.test.mjs
```

Expected: first assertion fails because `uiRuntimeConfig` does not exist.

- [ ] **Step 3: Add the non-secret UI runtime configuration**

Near `runtimeStatus()` in `server.js`, add:

```js
function uiRuntimeConfig() {
  return {
    exploreEnabled: process.env.PIXEL_TOYS_EXPLORE_UI === "1",
  };
}
```

Do not include API keys, provider URLs, or filesystem paths in this object.

- [ ] **Step 4: Return the UI configuration with the project list**

Change the `/api/projects` response to:

```js
return send(res, 200, {
  ok: true,
  appRoot: APP_ROOT,
  defaultProjectRoot: DEFAULT_PROJECT_ROOT,
  ui: uiRuntimeConfig(),
  projects,
});
```

- [ ] **Step 5: Run server syntax and the focused flag assertions**

Run:

```bash
node --check server.js
node scripts/explore-workspace-ui.test.mjs
```

Expected: the test advances past the server flag assertions and fails at the missing Explore markup.

- [ ] **Step 6: Version-control checkpoint**

If Git is available:

```bash
git add server.js scripts/explore-workspace-ui.test.mjs
git commit -m "feat: expose local explore UI flag"
```

Otherwise mark Task 2 complete without initializing Git.

### Task 3: Build The Explore Homepage

**Files:**

- Modify: `public/index.html:10-48`
- Modify: `public/app.js:36-63`
- Modify: `public/app.js:579-700`
- Modify: `public/app.js:895-992`
- Modify: `public/styles.css:4835-5040`
- Test: `scripts/explore-workspace-ui.test.mjs`

- [ ] **Step 1: Extend the structural test with required Explore destinations**

Add these assertions to `scripts/explore-workspace-ui.test.mjs`:

```js
assert.match(html, /data-explore-tool="short-drama"/);
assert.match(html, /data-explore-tool="image-generation"/);
assert.match(html, /data-explore-tool="video-generation"/);
assert.match(html, /data-explore-tool="production-board"/);
assert.match(html, /id="exploreProjectList"/);
assert.match(html, /id="exploreCanvasQuickStart"/);
assert.match(app, /PixelToysWorkspaceShell\.shouldEnableExplore/);
assert.match(app, /workspaceModeForTool/);
```

- [ ] **Step 2: Run the test and verify the new assertions fail**

Run:

```bash
node scripts/explore-workspace-ui.test.mjs
```

Expected: failure at missing `data-explore-tool="short-drama"`.

- [ ] **Step 3: Add Explore markup without deleting the legacy home**

Insert a sibling `<section id="exploreHome" class="explore-home hidden">` before `#projectHome`. Include:

```html
<section id="exploreHome" class="explore-home hidden">
  <header class="explore-topbar">
    <button class="explore-brand" type="button" data-explore-home>Pixel Toys</button>
    <nav aria-label="创作能力">
      <button class="is-active" type="button" data-explore-home>Explore</button>
      <button type="button" data-explore-tool="image-generation">Image</button>
      <button type="button" data-explore-tool="video-generation">Video</button>
      <button type="button" data-explore-tool="production-board">Storyboard</button>
      <button id="exploreCanvasQuickStart" type="button">Canvas</button>
      <button type="button" data-explore-tool="asset-library">Assets</button>
      <button type="button" data-explore-productions>Productions</button>
    </nav>
    <div class="explore-account-actions">
      <button id="exploreRefresh" type="button" aria-label="刷新项目" title="刷新项目">↻</button>
      <button id="exploreAccount" type="button" aria-label="账号" title="账号">◉</button>
    </div>
  </header>
  <main class="explore-main">
    <section class="explore-feature-grid">
      <button class="explore-feature explore-feature-primary" type="button" data-explore-tool="short-drama">
        <span>Featured workflow</span><strong>从剧本到成片</strong><small>资产、故事板、镜头和生成状态</small>
      </button>
      <button class="explore-feature" type="button" data-explore-canvas-quick-start>
        <span>Quick start</span><strong>生成画布</strong><small>自由图片与视频节点工作流</small>
      </button>
      <button id="exploreRecentProject" class="explore-feature" type="button" disabled>
        <span>Continue</span><strong>暂无最近项目</strong><small>创建项目后从这里继续</small>
      </button>
    </section>
    <section class="explore-tools" aria-labelledby="exploreToolsTitle">
      <div class="explore-section-head"><h2 id="exploreToolsTitle">Creative tools</h2></div>
      <div class="explore-tool-grid">
        <button type="button" data-explore-tool="short-drama"><span>✦</span><strong>短剧制片</strong><small>剧本解析到成片</small></button>
        <button type="button" data-explore-tool="image-generation"><span>▧</span><strong>图片生成</strong><small>人物、场景和道具</small></button>
        <button type="button" data-explore-tool="video-generation"><span>▶</span><strong>视频生成</strong><small>参考图和镜头任务</small></button>
        <button type="button" data-explore-tool="production-board"><span>▦</span><strong>故事板</strong><small>Production Board 和节拍</small></button>
      </div>
    </section>
    <section class="explore-productions" aria-labelledby="exploreProductionsTitle">
      <div class="explore-section-head"><h2 id="exploreProductionsTitle">Your productions</h2><input id="exploreProjectSearch" type="search" placeholder="搜索项目" /></div>
      <div id="exploreProjectList" class="explore-project-grid"></div>
    </section>
  </main>
</section>
```

Keep `#projectHome` and `#projectCreateModal` unchanged for the legacy path.

- [ ] **Step 4: Add Explore state and rollout selection**

Extend `state` in `public/app.js`:

```js
ui: { exploreEnabled: false },
exploreEnabled: false,
exploreProjectSearch: "",
activeWorkspaceMode: localStorage.getItem("pixelToys.workspaceMode") || "assets",
```

In `loadProjects`, after receiving `/api/projects`:

```js
state.ui = data.ui || {};
state.exploreEnabled = PixelToysWorkspaceShell.shouldEnableExplore({
  serverEnabled: state.ui.exploreEnabled,
  search: window.location.search,
});
```

- [ ] **Step 5: Render Explore projects from the existing project state**

Add:

```js
function filteredExploreProjects() {
  const query = String(state.exploreProjectSearch || "").trim().toLowerCase();
  if (!query) return state.projects;
  return state.projects.filter((project) =>
    [project.displayName, project.title, project.slug].some((value) => String(value || "").toLowerCase().includes(query)),
  );
}

function renderExploreHome() {
  const node = $("#exploreProjectList");
  if (!node) return;
  const projects = filteredExploreProjects();
  node.innerHTML = `
    <button class="explore-project-new" type="button" data-explore-new-project>＋<strong>新建项目</strong></button>
    ${projects.map((project) => `
      <button class="explore-project-card" type="button" data-explore-project="${escapeAttr(project.id)}">
        <span>${escapeHtml(project.status || "Production")}</span>
        <strong>${escapeHtml(displayProjectTitle(project))}</strong>
        <small>${escapeHtml(project.updatedAt || "")}</small>
      </button>`).join("")}
  `;
  const recent = state.projects[0];
  const recentButton = $("#exploreRecentProject");
  recentButton.disabled = !recent;
  recentButton.dataset.exploreProject = recent?.id || "";
  recentButton.querySelector("strong").textContent = recent ? displayProjectTitle(recent) : "暂无最近项目";
}
```

Use delegated click handlers so rerendering the cards does not duplicate listeners.

- [ ] **Step 6: Route tools to a project and workspace mode**

Add one function:

```js
async function openExploreTool(tool) {
  const mode = PixelToysWorkspaceShell.workspaceModeForTool(tool);
  const projectId = state.selectedId || state.projects[0]?.id || "";
  if (!projectId) {
    openProjectModal();
    return;
  }
  await loadProject(projectId, { openStudio: true });
  setWorkspaceMode(mode);
}
```

Wire `data-explore-tool`, `data-explore-project`, `data-explore-new-project`, project search, refresh, and Canvas Quick Start. Reuse `openBlankCanvasProject()` for the Canvas entry.

- [ ] **Step 7: Switch the visible home without deleting legacy behavior**

Update `showProjectHome()` so:

```js
$("#exploreHome")?.classList.toggle("hidden", !state.exploreEnabled);
$("#projectHome")?.classList.toggle("hidden", state.exploreEnabled);
$("#studioShell")?.classList.add("hidden");
if (state.exploreEnabled) renderExploreHome();
else renderProjectList();
```

- [ ] **Step 8: Add the approved dark-canvas styles**

Append a bounded `body.is-explore-ui` block to `public/styles.css` using:

```css
:root {
  --explore-bg: #080d14;
  --explore-canvas: #0c1523;
  --explore-surface: #121b29;
  --explore-blue: #2d8cff;
  --explore-action: #a8ff36;
  --explore-ready: #43dd79;
  --explore-text: #edf4fc;
  --explore-muted: #7f90a7;
  --explore-line: #26364d;
}

body.is-explore-ui { background: var(--explore-bg); color: var(--explore-text); }
.explore-home { min-height: 100vh; background: var(--explore-bg); }
.explore-topbar { height: 48px; display: flex; align-items: center; gap: 20px; padding: 0 18px; border-bottom: 1px solid var(--explore-line); background: #070b10; }
.explore-topbar nav { display: flex; align-items: center; gap: 4px; min-width: 0; overflow-x: auto; }
.explore-topbar button { border: 0; background: transparent; color: var(--explore-muted); }
.explore-topbar button.is-active, .explore-brand { color: var(--explore-action); }
.explore-main { width: min(1500px, calc(100% - 36px)); margin: 0 auto; padding: 18px 0 42px; }
.explore-feature-grid { display: grid; grid-template-columns: 1.45fr 1fr 1fr; gap: 10px; }
.explore-feature, .explore-tool-grid button, .explore-project-card, .explore-project-new { min-width: 0; border: 1px solid var(--explore-line); border-radius: 7px; background: var(--explore-surface); color: var(--explore-text); text-align: left; }
.explore-feature-primary { background-color: #102850; background-image: radial-gradient(#31537b 1px, transparent 1px); background-size: 14px 14px; border-color: var(--explore-blue); }
.explore-tool-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.explore-project-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
```

Add compact breakpoints at `900px` and `640px`; do not scale font sizes with viewport width.

- [ ] **Step 9: Run focused tests**

Run:

```bash
node --check public/app.js
node scripts/workspace-shell.test.js
node scripts/explore-workspace-ui.test.mjs
```

Expected: tests advance to the mode-shell assertions introduced in Task 4.

- [ ] **Step 10: Version-control checkpoint**

If Git is available:

```bash
git add public/index.html public/app.js public/styles.css scripts/explore-workspace-ui.test.mjs
git commit -m "feat: add explore production homepage"
```

Otherwise mark Task 3 complete without initializing Git.

### Task 4: Convert The Studio To Mutually Exclusive Modes

**Files:**

- Modify: `public/index.html:93-423`
- Modify: `public/app.js:36-73`
- Modify: `public/app.js:994-1017`
- Modify: `public/app.js:1208-1272`
- Modify: `public/styles.css`
- Test: `scripts/workspace-shell.test.js`
- Test: `scripts/explore-workspace-ui.test.mjs`

- [ ] **Step 1: Add failing mode-exclusivity assertions**

Append to `scripts/explore-workspace-ui.test.mjs`:

```js
for (const mode of ["script", "image", "video", "storyboard", "assets"]) {
  assert.match(html, new RegExp(`data-workspace-mode="${mode}"`));
}
assert.match(app, /panel\.toggleAttribute\("hidden", !active\)/);
assert.match(app, /localStorage\.setItem\("pixelToys\.workspaceMode", nextMode\)/);
assert.match(app, /data-asset-workspace-view/);
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node scripts/explore-workspace-ui.test.mjs
```

Expected: failure because the five mode panels do not exist.

- [ ] **Step 3: Replace text rail buttons with five mode buttons**

In the studio sidebar, keep Projects and New Project commands separate, then add:

```html
<nav class="studio-mode-rail" aria-label="功能模式">
  <button type="button" data-workspace-mode-button="script" aria-label="剧本" title="剧本">▤</button>
  <button type="button" data-workspace-mode-button="image" aria-label="图片" title="图片">▧</button>
  <button type="button" data-workspace-mode-button="video" aria-label="视频" title="视频">▶</button>
  <button type="button" data-workspace-mode-button="storyboard" aria-label="故事板" title="故事板">▦</button>
  <button type="button" data-workspace-mode-button="assets" aria-label="资产" title="资产">◇</button>
</nav>
```

Do not add Logs to the primary rail. Preserve logs behind the existing advanced-UI switch.

- [ ] **Step 4: Assign existing surfaces to exclusive mode containers**

Use these ownership rules:

```html
<section data-workspace-mode="script">...existing .studio-console...</section>
<section data-workspace-mode="image" data-asset-workspace-view="image">...asset style, quality, generation range, upload/reference controls...</section>
<section data-workspace-mode="video">...existing #studioTabVideo contents...</section>
<section data-workspace-mode="storyboard">...existing #studioTabStoryboards contents...</section>
<section data-workspace-mode="assets" data-asset-workspace-view="library">...#assetGallery plus #assetInspector...</section>
```

Move existing DOM nodes; do not duplicate IDs. The Image mode owns generation controls. Assets mode owns the gallery and inspector. Both still read the same project state.

- [ ] **Step 5: Implement one mode switcher**

Replace mode-specific uses of `setStudioTab` with:

```js
function setWorkspaceMode(mode, { persist = true } = {}) {
  const nextMode = PixelToysWorkspaceShell.normalizeWorkspaceMode(mode);
  state.activeWorkspaceMode = nextMode;
  if (persist) localStorage.setItem("pixelToys.workspaceMode", nextMode);
  document.body.classList.toggle("is-explore-ui", state.exploreEnabled);
  $$('[data-workspace-mode-button]').forEach((button) => {
    const active = button.dataset.workspaceModeButton === nextMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  $$('[data-workspace-mode]').forEach((panel) => {
    const active = panel.dataset.workspaceMode === nextMode;
    panel.classList.toggle("is-active", active);
    panel.toggleAttribute("hidden", !active);
  });
  requestAnimationFrame(updateWorkspaceSize);
}
```

Keep `setStudioTab` temporarily as a compatibility adapter:

```js
function setStudioTab(tab, options = {}) {
  const map = { assets: "assets", storyboards: "storyboard", video: "video", logs: "assets" };
  setWorkspaceMode(map[tab] || tab, options);
}
```

- [ ] **Step 6: Restore mode after project hydration**

At the end of `renderWorkspace()`, replace the final tab call with:

```js
setWorkspaceMode(state.activeWorkspaceMode, { persist: false });
```

Project changes reset selections and inspector state but do not force the user back to Assets mode.

- [ ] **Step 7: Add mode-shell layout styles**

Add:

```css
body.is-explore-ui .studio-shell { grid-template-columns: 64px minmax(0, 1fr); background: var(--explore-bg); }
body.is-explore-ui .studio-sidebar { width: 64px; border-right: 1px solid var(--explore-line); background: #080d14; }
.studio-mode-rail { display: grid; gap: 6px; padding: 10px; }
.studio-mode-rail button { width: 42px; height: 42px; padding: 0; display: grid; place-items: center; border-radius: 6px; }
.studio-mode-rail button.is-active { border-color: var(--explore-blue); background: #18345e; color: #5fa8ff; }
[data-workspace-mode][hidden] { display: none !important; }
[data-workspace-mode].is-active { min-width: 0; min-height: 0; }
```

On widths below `720px`, use a bottom fixed mode rail and one full-screen mode panel. Do not expose an infinite desktop on mobile.

- [ ] **Step 8: Run mode tests and syntax checks**

Run:

```bash
node --check public/app.js
node scripts/workspace-shell.test.js
node scripts/explore-workspace-ui.test.mjs
```

Expected: all mode assertions pass; asset prompt assertions may still fail until Tasks 5 and 6.

- [ ] **Step 9: Version-control checkpoint**

If Git is available:

```bash
git add public/index.html public/app.js public/styles.css scripts/explore-workspace-ui.test.mjs
git commit -m "feat: add single-mode production shell"
```

Otherwise mark Task 4 complete without initializing Git.

### Task 5: Add A Prompt-Only Asset API

**Files:**

- Modify: `server.js:15100-15116`
- Modify: `server.js:15314-15320`
- Modify: `server.js:17535-17555`
- Modify: `server.js:17792-17803`
- Create: `scripts/asset-prompt-update.test.js`
- Modify: `package.json:6-10`

- [ ] **Step 1: Write the failing manifest update test**

Create `scripts/asset-prompt-update.test.js`:

```js
const assert = require("node:assert/strict");
const { __test } = require("../server.js");

const manifest = {
  title: "Example",
  items: [
    { id: "C001_EVELYN_CHARACTER_SHEET", type: "Character", label: "Evelyn", textToImagePrompt: "old prompt" },
    { id: "S001_GARAGE_WIDE_ESTABLISHING", type: "Scene", label: "Garage", textToImagePrompt: "scene prompt" },
  ],
};

const updated = __test.assetPrompt.updateAssetPromptInManifest(
  manifest,
  "C001_EVELYN_CHARACTER_SHEET",
  "new production prompt\nkeep the same face",
);

assert.equal(updated.items[0].textToImagePrompt, "new production prompt\nkeep the same face");
assert.equal(updated.items[1].textToImagePrompt, "scene prompt");
assert.throws(
  () => __test.assetPrompt.updateAssetPromptInManifest(manifest, "missing", "prompt"),
  /资产不存在/,
);
assert.throws(
  () => __test.assetPrompt.updateAssetPromptInManifest(manifest, "C001_EVELYN_CHARACTER_SHEET", ""),
  /提示词不能为空/,
);

console.log("asset prompt update tests passed");
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node scripts/asset-prompt-update.test.js
```

Expected: failure because `__test.assetPrompt` is undefined.

- [ ] **Step 3: Add the pure manifest update function**

First change the `textToImagePrompt` field in `normalizeManifestItem` so prompt formatting is not collapsed by `compactLine`:

```js
textToImagePrompt: String(item?.textToImagePrompt || "").trim().slice(0, 4000),
```

Then, near `normalizeAssetManifest` in `server.js`, add:

```js
function updateAssetPromptInManifest(rawManifest, assetName, prompt) {
  const cleanAssetName = compactLine(assetName || "");
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanAssetName) throw new Error("资产名称不能为空");
  if (!cleanPrompt) throw new Error("提示词不能为空");
  if (cleanPrompt.length > 4000) throw new Error("提示词过长，请控制在 4000 字以内");
  const manifest = normalizeAssetManifest(rawManifest || {});
  let found = false;
  const items = manifest.items.map((item) => {
    if (item.id !== cleanAssetName) return item;
    found = true;
    return { ...item, textToImagePrompt: cleanPrompt };
  });
  if (!found) throw new Error("资产不存在");
  return { ...manifest, items };
}
```

- [ ] **Step 4: Add the focused project route**

Before `asset-extract` in the project action dispatch, add:

```js
if (req.method === "POST" && action === "asset-prompt") {
  const body = await readBody(req);
  const current = readAssetManifest(episodeRoot)?.data;
  if (!current) throw new Error("请先完成资产提取");
  const manifest = updateAssetPromptInManifest(current, body.assetName, body.prompt);
  const written = writeAssetManifest(episodeRoot, manifest);
  return send(res, 200, { ok: true, assetManifest: written, state: fullProjectState(episodeRoot) });
}
```

This route must not call `startToolJob`, `spawn`, `createCanvasImageGeneration`, or any provider function.

- [ ] **Step 5: Export only the pure helper for tests**

Extend `module.exports.__test`:

```js
assetPrompt: {
  updateAssetPromptInManifest,
},
```

- [ ] **Step 6: Add the unit test to `package.json`**

Insert `node scripts/asset-prompt-update.test.js` after `workspace-shell.test.js`.

- [ ] **Step 7: Run focused server tests**

Run:

```bash
node --check server.js
node scripts/asset-prompt-update.test.js
```

Expected: `asset prompt update tests passed`.

- [ ] **Step 8: Version-control checkpoint**

If Git is available:

```bash
git add server.js scripts/asset-prompt-update.test.js package.json
git commit -m "feat: save asset prompts without generation"
```

Otherwise mark Task 5 complete without initializing Git.

### Task 6: Build The Asset Prompt Inspector

**Files:**

- Modify: `public/index.html:215-296`
- Modify: `public/app.js:36-63`
- Modify: `public/app.js:1292-1323`
- Modify: `public/app.js:2067-2325`
- Modify: `public/app.js:2704-2777`
- Modify: `public/styles.css`
- Test: `scripts/explore-workspace-ui.test.mjs`

- [ ] **Step 1: Add failing inspector and paid-action assertions**

Append to `scripts/explore-workspace-ui.test.mjs`:

```js
assert.match(html, /id="assetInspector"/);
assert.match(html, /id="assetInspectorPrompt"/);
assert.match(html, /id="saveAssetPrompt"/);
assert.match(html, /id="regenerateAssetFromInspector"/);
assert.match(app, /state\.selectedAssetId/);
assert.match(app, /function renderAssetInspector/);
assert.match(app, /\/asset-prompt/);
assert.match(app, /assetPromptDrafts/);
assert.match(app, /saveAssetPrompt[\s\S]{0,1200}method:\s*"POST"/);
assert.doesNotMatch(app, /saveAssetPrompt[\s\S]{0,1200}\/job/);
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node scripts/explore-workspace-ui.test.mjs
```

Expected: failure at missing `assetInspector`.

- [ ] **Step 3: Add the inspector beside the gallery**

Wrap the Assets mode body in:

```html
<div class="asset-library-layout">
  <div class="asset-library-main">
    <div id="assetGallery" class="gallery"></div>
  </div>
  <aside id="assetInspector" class="asset-inspector hidden" aria-label="资产检查器">
    <header><div><strong id="assetInspectorName"></strong><span id="assetInspectorMeta"></span></div><button id="closeAssetInspector" type="button" aria-label="关闭检查器" title="关闭">×</button></header>
    <label for="assetInspectorPrompt">生成提示词</label>
    <textarea id="assetInspectorPrompt" maxlength="4000" rows="14"></textarea>
    <div class="asset-inspector-draft"><span id="assetInspectorDraftStatus"></span><span id="assetInspectorPromptCount">0 / 4000</span></div>
    <details><summary>风格锁与负向约束</summary><pre id="assetInspectorPolicy"></pre></details>
    <div class="asset-inspector-actions">
      <button id="restoreAssetPrompt" type="button">还原</button>
      <button id="saveAssetPrompt" type="button">保存提示词</button>
    </div>
    <button id="regenerateAssetFromInspector" class="asset-inspector-regenerate" type="button">使用修改后的提示词重新生成</button>
    <p>重新生成会消耗额度；保存提示词不会生成图片。</p>
  </aside>
</div>
```

Keep only one `#assetGallery` ID.

- [ ] **Step 4: Replace inline edit-form state with prompt draft state**

Extend `state`:

```js
selectedAssetId: "",
assetPromptDrafts: new Map(),
assetInspectorOpen: false,
```

Use draft records with one shape:

```js
function assetPromptDraft(assetName) {
  return state.assetPromptDrafts.get(assetName) || null;
}

function effectiveAssetPrompt(assetName) {
  const item = state.project?.assetManifest?.items?.find((entry) => entry.id === assetName);
  return String(item?.textToImagePrompt || "");
}

function ensureAssetPromptDraft(assetName) {
  const existing = assetPromptDraft(assetName);
  if (existing) return existing;
  const original = effectiveAssetPrompt(assetName);
  const draft = { original, value: original, dirty: false };
  state.assetPromptDrafts.set(assetName, draft);
  return draft;
}
```

Do not reuse `editInstruction`: the inspector edits the complete stored prompt, while the existing edit job remains an optional image-edit command.

- [ ] **Step 5: Make card click select and inspect**

Replace the generic card selection click path for generated assets with:

```js
function selectAssetForInspector(assetName) {
  state.selectedAssetId = assetName;
  state.assetInspectorOpen = true;
  state.selectedAssetIds = new Set([assetName]);
  ensureAssetPromptDraft(assetName);
  renderAssetsFromState();
  renderAssetInspector();
}
```

Single click calls `selectAssetForInspector(assetName)`. Keep double-click or a dedicated icon for `openLightbox(asset)`.

- [ ] **Step 6: Render inspector without replacing active drafts**

Add:

```js
function renderAssetInspector() {
  const inspector = $("#assetInspector");
  const assetName = state.selectedAssetId;
  const item = state.project?.assetManifest?.items?.find((entry) => entry.id === assetName);
  const asset = assetForName(assetName);
  const visible = !!assetName && !!item && state.assetInspectorOpen;
  inspector.classList.toggle("hidden", !visible);
  if (!visible) return;
  const draft = ensureAssetPromptDraft(assetName);
  $("#assetInspectorName").textContent = item.label || assetName;
  $("#assetInspectorMeta").textContent = `${assetTypeLabel(item.type)} · ${asset?.assetStyleLabel || state.assetStylePreset} · ${$("#assetQuality")?.value || "1k"}`;
  const input = $("#assetInspectorPrompt");
  if (document.activeElement !== input) input.value = draft.value;
  $("#assetInspectorDraftStatus").textContent = draft.dirty ? "未保存修改" : "已保存";
  $("#assetInspectorPromptCount").textContent = `${draft.value.length} / 4000`;
  $("#assetInspectorPolicy").textContent = asset?.policy || "风格锁由当前项目资产风格控制。";
}
```

Call `renderAssetInspector()` after `renderAssets()` in both full render and polling refresh paths.

- [ ] **Step 7: Update draft on input and preserve it through polling**

Wire:

```js
$("#assetInspectorPrompt").addEventListener("input", (event) => {
  const assetName = state.selectedAssetId;
  if (!assetName) return;
  const draft = ensureAssetPromptDraft(assetName);
  draft.value = event.currentTarget.value;
  draft.dirty = draft.value !== draft.original;
  renderAssetInspector();
});
```

`mergeProjectStatus()` must not clear `assetPromptDrafts`. When a saved manifest arrives, update `original` only for drafts where `dirty === false`.

- [ ] **Step 8: Save prompt without starting a job**

Add:

```js
async function saveAssetPrompt() {
  const assetName = state.selectedAssetId;
  const draft = assetPromptDraft(assetName);
  if (!state.selectedId || !assetName || !draft) return;
  const prompt = draft.value.trim();
  if (!prompt) return toast("提示词不能为空");
  const data = await api(`/api/project/${state.selectedId}/asset-prompt`, {
    method: "POST",
    body: JSON.stringify({ assetName, prompt }),
  });
  setProjectState(data.state);
  state.assetPromptDrafts.set(assetName, { original: prompt, value: prompt, dirty: false });
  renderAssetsFromState();
  renderAssetInspector();
  toast("提示词已保存，未启动生成");
}
```

The function must not call `/job`, `editAsset`, `regenerateAsset`, or `startJob`.

- [ ] **Step 9: Keep regeneration explicit**

Wire `#regenerateAssetFromInspector` to:

```js
async function regenerateSelectedAssetFromInspector() {
  const assetName = state.selectedAssetId;
  const draft = assetPromptDraft(assetName);
  if (!assetName || !draft) return;
  if (draft.dirty) await saveAssetPrompt();
  const confirmed = window.confirm(`重新生成“${assetName}”？这会使用额度。`);
  if (!confirmed) return;
  await regenerateAsset(assetName, { force: true });
}
```

Do not auto-confirm in tests. Test only that Save Prompt does not reach the job endpoint.

- [ ] **Step 10: Add inspector layout styles**

Add:

```css
.asset-library-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; min-height: 0; }
.asset-library-main { min-width: 0; overflow: auto; }
.asset-inspector { min-width: 0; border-left: 1px solid var(--explore-line); background: #0d151f; padding: 14px; }
.asset-inspector textarea { width: 100%; resize: vertical; background: #080d14; border: 1px solid var(--explore-blue); color: var(--explore-text); }
.asset-inspector-draft { display: flex; justify-content: space-between; color: var(--explore-muted); }
.asset-inspector-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.asset-inspector-regenerate { width: 100%; background: var(--explore-action); color: #101820; }
@media (max-width: 900px) { .asset-library-layout { grid-template-columns: 1fr; } .asset-inspector { position: fixed; inset: 48px 0 0; z-index: 30; border-left: 0; } }
```

- [ ] **Step 11: Run inspector tests**

Run:

```bash
node --check public/app.js
node scripts/asset-prompt-update.test.js
node scripts/explore-workspace-ui.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 12: Version-control checkpoint**

If Git is available:

```bash
git add public/index.html public/app.js public/styles.css scripts/explore-workspace-ui.test.mjs
git commit -m "feat: add editable asset prompt inspector"
```

Otherwise mark Task 6 complete without initializing Git.

### Task 7: Update Existing Invariants And Run The Full Local Suite

**Files:**

- Modify: `scripts/self-check.mjs`
- Modify: `scripts/asset-surface-ui.test.mjs`
- Test: all scripts in `package.json`

- [ ] **Step 1: Run the full suite before changing assertions**

Run:

```bash
npm test
```

Expected: failures identify old assumptions about the studio tabbar, inline asset edit form, or layout. Do not change an assertion unless it conflicts with the approved design.

- [ ] **Step 2: Preserve existing asset-surface guards**

Extend `scripts/asset-surface-ui.test.mjs` with:

```js
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");

assert.match(app, /function projectHasAssetSurface/, "asset surface visibility should remain centralized");
assert.match(app, /function renderAssetInspector/, "asset cards should open the prompt inspector");
assert.match(app, /function saveAssetPrompt/, "asset prompts need an explicit save path");
assert.match(html, /id="assetInspectorPrompt"/, "asset inspector needs an editable prompt field");
assert.doesNotMatch(app, /saveAssetPrompt[\s\S]{0,1200}\/job/, "saving a prompt must not submit generation");
```

Keep the existing pre-parse empty-state assertions.

- [ ] **Step 3: Replace only obsolete self-check invariants**

In `scripts/self-check.mjs`:

- Replace assertions requiring inline `.asset-edit-form` with assertions requiring `#assetInspector` and `assetPromptDrafts`.
- Replace assertions requiring simultaneous script/asset/storyboard panels with assertions for five `data-workspace-mode` values and hidden inactive panels.
- Keep owner isolation, path safety, polling data, keyed card reconciliation, prompt compiler, paid-generation, and video reference assertions unchanged.

Use exact new assertions:

```js
assert(html.includes('id="exploreHome"'), "local explore UI needs a dedicated home surface");
assert(html.includes('data-workspace-mode="script"') && html.includes('data-workspace-mode="assets"'), "workspace modes must be explicit");
assert(app.includes("function setWorkspaceMode"), "workspace modes need one switcher");
assert(app.includes("function renderAssetInspector"), "asset prompt editing must use the inspector");
assert(app.includes("function saveAssetPrompt"), "asset prompt saving must be explicit");
assert(!sectionBetween(app, "async function saveAssetPrompt", "async function regenerateSelectedAssetFromInspector").includes("/job"), "saving asset prompts must not start generation");
```

- [ ] **Step 4: Run the full suite again**

Run:

```bash
npm test
```

Expected: all syntax checks, Vite build, behavioral tests, structural tests, and self-check assertions pass.

- [ ] **Step 5: Version-control checkpoint**

If Git is available:

```bash
git add scripts/self-check.mjs scripts/asset-surface-ui.test.mjs
git commit -m "test: cover explore shell and asset inspector"
```

Otherwise mark Task 7 complete without initializing Git.

### Task 8: Start Local Deployment And Perform Visual Acceptance

**Files:**

- Read only during verification: `public/index.html`, `public/styles.css`, `public/app.js`
- Local runtime data only: existing authenticated development data

- [ ] **Step 1: Start the local service with Explore enabled**

Run:

```bash
PIXEL_TOYS_EXPLORE_UI=1 PORT=4317 npm start
```

Expected:

```text
Pixel Toys running at http://localhost:4317
```

If port 4317 is occupied, rerun with `PORT=4318`. Do not stop or reload the production PM2 process.

- [ ] **Step 2: Verify the legacy escape hatch**

Open:

```text
http://localhost:4317/?legacy=1
```

Expected: the existing project home remains usable.

- [ ] **Step 3: Verify Explore discovery paths**

Open:

```text
http://localhost:4317/
```

Verify:

- Explore is visible only when the local environment flag is set.
- Short Drama opens Script mode.
- Image opens Image mode.
- Video opens Video mode.
- Storyboard opens Storyboard mode.
- Assets opens Assets mode.
- Canvas opens the existing standalone canvas route.
- No click automatically submits image or video generation.

- [ ] **Step 4: Verify mode exclusivity**

For each left-rail button, verify only one `[data-workspace-mode]` panel lacks `hidden`. Switch repeatedly and confirm the selected project, filters, and drafts remain intact.

- [ ] **Step 5: Verify asset prompt behavior without provider calls**

Select an existing asset, change its prompt, and confirm:

- The inspector shows `未保存修改`.
- Two polling cycles do not replace the text.
- Save Prompt updates the manifest and displays `提示词已保存，未启动生成`.
- No asset job appears after saving.
- Do not click the regenerate confirmation during acceptance.

- [ ] **Step 6: Verify responsive layout**

Inspect at:

- Desktop: `1440x900`
- Wide desktop: `1920x1080`
- Tablet: `900x1100`
- Mobile: `390x844`

Expected: no overlap, clipped labels, blank content, nested horizontal scroll, or inspector text under the mode rail. Mobile shows one full-screen mode and a bottom rail.

- [ ] **Step 7: Stop only the local development process**

Send `Ctrl-C` to the local `npm start` session. Do not run SSH, SCP, PM2, deployment scripts, or production health checks.

- [ ] **Step 8: Record acceptance results**

Append a dated `Local acceptance` section to this plan containing the local port, test result, viewport results, and any remaining defects. Do not record credentials, API keys, or production data.

## Completion Gate

This implementation slice is complete only when:

- `npm test` passes.
- Explore is enabled only by the local environment flag.
- `?legacy=1` retains the old interface.
- Exactly one workspace mode is visible at a time.
- Asset prompt drafts survive polling.
- Saving a prompt creates no generation job.
- Local desktop and mobile visual acceptance passes.
- No production command or paid provider submission was executed.
