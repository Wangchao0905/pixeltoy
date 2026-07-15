# Team Project Progress Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automatic four-stage team project progress center to the existing Team panel, with real file/config counts and stage-aware project navigation.

**Architecture:** Put deterministic stage calculation in a small CommonJS module that accepts plain data. `server.js` gathers existing file/config counts and adds the result to `lightweightProjectSummary()`. `public/app.js` renders the summary in the existing Team panel and maps the calculated stage to an existing workspace mode.

**Tech Stack:** Node.js CommonJS server, browser JavaScript, HTML/CSS, existing script-based Node tests, Vite build.

---

The workspace is not a Git repository. All commit steps in the standard workflow are replaced by explicit test checkpoints; do not initialize Git.

### Task 1: Deterministic Progress Calculation

**Files:**
- Create: `server/team-progress.js`
- Create: `scripts/team-progress.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing helper test**

Create `scripts/team-progress.test.mjs`:

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { calculateTeamProjectProgress, scriptHasMeaningfulBody } = require("../server/team-progress.js");

assert.equal(scriptHasMeaningfulBody("# Title\n\n"), false);
assert.equal(scriptHasMeaningfulBody("# Title\n\nINT. ROOM - DAY\nAction."), true);

const progress = (overrides = {}) => calculateTeamProjectProgress({
  scriptReady: true,
  plannedAssets: 2,
  generatedAssets: 2,
  storyboardsEnabled: true,
  plannedStoryboards: 2,
  generatedStoryboards: 2,
  plannedShots: 2,
  generatedClips: 2,
  ...overrides,
});

assert.deepEqual(progress({ scriptReady: false }), { stage: "script", attention: "等待完善剧本" });
assert.deepEqual(progress({ plannedAssets: 0 }), { stage: "script", attention: "等待资产提取" });
assert.deepEqual(progress({ generatedAssets: 1 }), { stage: "assets", attention: "缺少 1 个资产" });
assert.deepEqual(progress({ plannedStoryboards: 0, generatedStoryboards: 0 }), { stage: "storyboard", attention: "等待故事板规划" });
assert.deepEqual(progress({ generatedStoryboards: 1 }), { stage: "storyboard", attention: "缺少 1 个故事板" });
assert.deepEqual(progress({ storyboardsEnabled: false, plannedShots: 0, generatedClips: 0 }), { stage: "video", attention: "等待视频分镜配置" });
assert.deepEqual(progress({ generatedClips: 1 }), { stage: "video", attention: "缺少 1 个视频片段" });
assert.deepEqual(progress(), { stage: "complete", attention: "" });
assert.deepEqual(progress({ generatedAssets: 3, generatedStoryboards: 3, generatedClips: 3 }), { stage: "complete", attention: "" });

console.log("team progress tests passed");
```

- [ ] **Step 2: Register and run the test to verify RED**

Insert `node scripts/team-progress.test.mjs` before `team-server-wiring.test.mjs` in the `package.json` test command.

Run: `node scripts/team-progress.test.mjs`

Expected: FAIL with `Cannot find module '../server/team-progress.js'`.

- [ ] **Step 3: Implement the minimal pure helper**

Create `server/team-progress.js`:

```js
function count(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function scriptHasMeaningfulBody(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .some((line) => {
      const clean = line.trim();
      return !!clean && !/^#{1,6}\s+/.test(clean);
    });
}

function calculateTeamProjectProgress(input = {}) {
  const scriptReady = !!input.scriptReady;
  const plannedAssets = count(input.plannedAssets);
  const generatedAssets = count(input.generatedAssets);
  const storyboardsEnabled = input.storyboardsEnabled !== false;
  const plannedStoryboards = count(input.plannedStoryboards);
  const generatedStoryboards = count(input.generatedStoryboards);
  const plannedShots = count(input.plannedShots);
  const generatedClips = count(input.generatedClips);

  if (!scriptReady) return { stage: "script", attention: "等待完善剧本" };
  if (!plannedAssets) return { stage: "script", attention: "等待资产提取" };
  if (generatedAssets < plannedAssets) {
    return { stage: "assets", attention: `缺少 ${plannedAssets - generatedAssets} 个资产` };
  }
  if (storyboardsEnabled && !plannedStoryboards) {
    return { stage: "storyboard", attention: "等待故事板规划" };
  }
  if (storyboardsEnabled && generatedStoryboards < plannedStoryboards) {
    return { stage: "storyboard", attention: `缺少 ${plannedStoryboards - generatedStoryboards} 个故事板` };
  }
  if (!plannedShots) return { stage: "video", attention: "等待视频分镜配置" };
  if (generatedClips < plannedShots) {
    return { stage: "video", attention: `缺少 ${plannedShots - generatedClips} 个视频片段` };
  }
  return { stage: "complete", attention: "" };
}

module.exports = { calculateTeamProjectProgress, scriptHasMeaningfulBody };
```

- [ ] **Step 4: Run the helper test to verify GREEN**

Run: `node scripts/team-progress.test.mjs`

Expected: `team progress tests passed`.

- [ ] **Step 5: Run syntax checks**

Run: `node --check server/team-progress.js`

Expected: exit code 0 with no output.

### Task 2: Add Progress Facts to Project Summaries

**Files:**
- Modify: `server.js:1-20`
- Modify: `server.js:6983-7030`
- Modify: `scripts/team-server-wiring.test.mjs`

- [ ] **Step 1: Add failing server wiring assertions**

Add these assertions before the final log in `scripts/team-server-wiring.test.mjs`:

```js
assert.match(server, /require\("\.\/server\/team-progress\.js"\)/);
assert.match(server, /calculateTeamProjectProgress\(/);
assert.match(server, /plannedStoryboards/);
assert.match(server, /storyboardsEnabled/);
assert.match(server, /plannedShots/);
assert.match(server, /attention:/);
```

- [ ] **Step 2: Run the wiring test to verify RED**

Run: `node scripts/team-server-wiring.test.mjs`

Expected: FAIL because `server.js` does not require `team-progress.js`.

- [ ] **Step 3: Import the helper**

Add beside the other local server imports:

```js
const { calculateTeamProjectProgress, scriptHasMeaningfulBody } = require("./server/team-progress.js");
```

- [ ] **Step 4: Gather lightweight progress facts**

In `lightweightProjectSummary()`, replace the single combined asset count with non-storyboard and storyboard counts, and read the existing config without calling migration helpers:

```js
const scriptText = readText(scriptPath);
const configData = readVideoConfig(episodeRoot)?.data || {};
const assetMediaCount = walkFiles(path.join(episodeRoot, "04_assets"), (file) => /\.(png|jpg|jpeg|webp)$/i.test(file), 2).length;
const storyboardCount = walkFiles(path.join(episodeRoot, "04_assets", "storyboards"), (file) => /\.(png|jpg|jpeg|webp)$/i.test(file), 2).length;
const assetCount = Math.max(0, assetMediaCount - storyboardCount);
const plannedStoryboards = Array.isArray(configData.storyboardPlans) ? configData.storyboardPlans.length : 0;
const plannedShots = Array.isArray(configData.shots) ? configData.shots.length : 0;
const storyboardsEnabled = configData.settings?.enableStoryboards !== false;
const calculatedProgress = calculateTeamProjectProgress({
  scriptReady: scriptHasMeaningfulBody(scriptText),
  plannedAssets: parsedAssets,
  generatedAssets: assetCount,
  storyboardsEnabled,
  plannedStoryboards,
  generatedStoryboards: storyboardCount,
  plannedShots,
  generatedClips: rawClipCount,
});
```

Use `scriptText` for the existing title extraction so the script file is read once.

- [ ] **Step 5: Return the extended summary contract**

Change the `progress` and `counts` blocks in `lightweightProjectSummary()` to:

```js
progress: {
  stage: calculatedProgress.stage,
  attention: calculatedProgress.attention,
  lastModifiedByUserId: compactLine(workflow.lastModifiedByUserId || workflow.ownerUserId || ""),
  lastModifiedByUsername: compactLine(workflow.lastModifiedByUsername || workflow.ownerUsername || ""),
  lastModifiedAt: workflow.lastModifiedAt || fs.statSync(episodeRoot).mtime.toISOString(),
},
counts: {
  scriptReady: scriptHasMeaningfulBody(scriptText),
  plannedAssets: parsedAssets,
  assets: assetCount,
  parsedAssets,
  plannedStoryboards,
  storyboards: storyboardCount,
  plannedShots,
  rawClips: rawClipCount,
},
```

- [ ] **Step 6: Run focused server tests**

Run: `node scripts/team-progress.test.mjs`

Expected: `team progress tests passed`.

Run: `node scripts/team-server-wiring.test.mjs`

Expected: `team server wiring tests passed`.

Run: `node --check server.js`

Expected: exit code 0.

### Task 3: Render the Team Progress Center and Navigate by Stage

**Files:**
- Modify: `public/app.js:247-315`
- Modify: `public/app.js:4470-4495`
- Modify: `scripts/team-collaboration-ui.test.mjs`

- [ ] **Step 1: Add failing UI assertions**

Add to `scripts/team-collaboration-ui.test.mjs`:

```js
assert.match(app, /const TEAM_PROGRESS_STAGES/);
assert.match(app, /function teamProjectProgressHtml/);
assert.match(app, /team-progress-rail/);
assert.match(app, /team-progress-counts/);
assert.match(app, /team-progress-attention/);
assert.match(app, /function teamProgressWorkspaceMode/);
assert.match(app, /setWorkspaceMode\(teamProgressWorkspaceMode\(stage\)\)/);
```

- [ ] **Step 2: Run the UI test to verify RED**

Run: `node scripts/team-collaboration-ui.test.mjs`

Expected: FAIL because the progress helpers and classes do not exist.

- [ ] **Step 3: Add stage metadata and formatting helpers**

Add near the existing Team helpers in `public/app.js`:

```js
const TEAM_PROGRESS_STAGES = [
  { id: "script", label: "剧本" },
  { id: "assets", label: "资产" },
  { id: "storyboard", label: "故事板" },
  { id: "video", label: "视频" },
];

function normalizeTeamProgressStage(stage = "") {
  return ["script", "assets", "storyboard", "video", "complete"].includes(stage) ? stage : "script";
}

function teamProgressWorkspaceMode(stage = "") {
  const normalized = normalizeTeamProgressStage(stage);
  if (normalized === "assets") return "assets";
  if (normalized === "storyboard") return "storyboard";
  if (normalized === "video" || normalized === "complete") return "video";
  return "script";
}

function teamProjectProgressHtml(project = {}) {
  const stage = normalizeTeamProgressStage(project.progress?.stage);
  const currentIndex = stage === "complete" ? TEAM_PROGRESS_STAGES.length : TEAM_PROGRESS_STAGES.findIndex((item) => item.id === stage);
  const counts = project.counts || {};
  const stageLabel = stage === "complete" ? "完成" : TEAM_PROGRESS_STAGES.find((item) => item.id === stage)?.label || "剧本";
  const rail = TEAM_PROGRESS_STAGES.map((item, index) => {
    const stateClass = index < currentIndex || stage === "complete" ? "is-complete" : index === currentIndex ? "is-current" : "is-pending";
    return `<span class="${stateClass}">${escapeHtml(item.label)}</span>`;
  }).join("");
  const editor = project.progress?.lastModifiedByUsername || "-";
  const updated = blankCanvasTimeLabel(project.progress?.lastModifiedAt || project.updatedAt || "") || "刚刚";
  return `<button class="team-progress-item" type="button" data-team-open-project="${escapeAttr(project.id)}" data-team-stage="${escapeAttr(stage)}">
    <span class="team-progress-heading"><strong>${escapeHtml(displayProjectTitle(project))}</strong><small>${escapeHtml(stageLabel)}</small></span>
    <span class="team-progress-rail" aria-label="项目进度">${rail}</span>
    <span class="team-progress-counts">资产 ${Number(counts.assets || 0)}/${Number(counts.plannedAssets || 0)} · 故事板 ${Number(counts.storyboards || 0)}/${Number(counts.plannedStoryboards || 0)} · 视频 ${Number(counts.rawClips || 0)}/${Number(counts.plannedShots || 0)}</span>
    ${project.progress?.attention ? `<span class="team-progress-attention">${escapeHtml(project.progress.attention)}</span>` : ""}
    <span class="team-progress-editor">${escapeHtml(editor)} · ${escapeHtml(updated)}</span>
  </button>`;
}
```

- [ ] **Step 4: Replace the simple project rows**

In `renderTeamPanel()`, replace the existing `.map()` project button template with:

```js
.map((project) => teamProjectProgressHtml(project))
```

Keep the existing team filter and six-project limit unchanged.

- [ ] **Step 5: Add stage-aware opening**

Add:

```js
async function openTeamProgressProject(projectId, stage) {
  await loadProject(projectId, { openStudio: true });
  setWorkspaceMode(teamProgressWorkspaceMode(stage));
  state.teamPanelOpen = false;
  renderTeamPanel();
}
```

Update the Team-panel click handler:

```js
const projectButton = event.target.closest("[data-team-open-project]");
if (projectButton) {
  return openTeamProgressProject(projectButton.dataset.teamOpenProject, projectButton.dataset.teamStage)
    .catch((error) => toast(error.message));
}
```

- [ ] **Step 6: Run focused UI tests**

Run: `node scripts/team-collaboration-ui.test.mjs`

Expected: `team collaboration UI tests passed`.

Run: `node --check public/app.js`

Expected: exit code 0.

### Task 4: Style the Compact Progress Rows

**Files:**
- Modify: `public/styles.css:7689-7720`
- Modify: `scripts/team-collaboration-ui.test.mjs`

- [ ] **Step 1: Add failing CSS assertions**

Add:

```js
assert.match(css, /\.team-progress-rail\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(css, /\.team-progress-heading/);
assert.match(css, /\.team-progress-attention/);
assert.match(css, /\.team-progress-editor/);
```

- [ ] **Step 2: Run the UI test to verify RED**

Run: `node scripts/team-collaboration-ui.test.mjs`

Expected: FAIL on `.team-progress-rail`.

- [ ] **Step 3: Replace the old Team project button styling**

Use these focused styles:

```css
.team-progress-item {
  width: 100%;
  min-width: 0;
  display: grid;
  justify-items: stretch;
  gap: 7px;
  border: 1px solid rgba(117, 151, 192, 0.14);
  border-radius: 5px;
  padding: 9px;
  background: #101925;
  text-align: left;
}

.team-progress-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.team-progress-heading strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-progress-heading small {
  flex: 0 0 auto;
  border: 1px solid rgba(83, 158, 255, 0.34);
  border-radius: 4px;
  padding: 2px 5px;
  color: #82b9ff;
  font-size: 9px;
}

.team-progress-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
}

.team-progress-rail span {
  min-width: 0;
  border-top: 2px solid #263345;
  padding-top: 4px;
  color: #66768b;
  font-size: 8px;
  text-align: center;
}

.team-progress-rail span.is-complete {
  border-color: #50d397;
  color: #72dfa4;
}

.team-progress-rail span.is-current {
  border-color: #539eff;
  color: #82b9ff;
}

.team-progress-counts,
.team-progress-editor {
  min-width: 0;
  color: #74859c;
  font-size: 10px;
  line-height: 1.35;
  white-space: normal;
}

.team-progress-attention {
  color: #f5c56f;
  font-size: 10px;
}
```

Remove the obsolete `#teamProjectProgress button` rule so it does not compete with `.team-progress-item`.

- [ ] **Step 4: Add narrow-screen wrapping**

Inside the existing `@media (max-width: 500px)` block add:

```css
.team-progress-heading {
  align-items: flex-start;
}

.team-progress-counts,
.team-progress-editor {
  overflow-wrap: anywhere;
}
```

- [ ] **Step 5: Run focused checks**

Run: `node scripts/team-collaboration-ui.test.mjs`

Expected: `team collaboration UI tests passed`.

Run: `npm run build`

Expected: Vite build completes successfully.

### Task 5: Full Verification and Local Browser Acceptance

**Files:**
- Modify only if acceptance reveals a directly related defect.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: exit code 0, including `team progress tests passed`, `team server wiring tests passed`, `team collaboration UI tests passed`, and `Pixel Toys self-check passed`.

- [ ] **Step 2: Start the isolated local service**

Use the existing isolated acceptance workspace and start with Explore enabled:

```bash
env PORT=4319 PIXEL_TOYS_EXPLORE_UI=1 node /Users/wangchao/Documents/Codex/2026-06-16/codex-skill/server.js
```

Run from `/tmp/pixel-toys-team-acceptance.xsFGhW`. Do not deploy or call paid generation.

- [ ] **Step 3: Validate the progress API**

Call `GET /api/projects` with the existing temporary member cookie and verify each team project contains:

```json
{
  "progress": { "stage": "script", "attention": "等待资产提取" },
  "counts": {
    "scriptReady": true,
    "plannedAssets": 0,
    "storyboards": 0,
    "plannedStoryboards": 0,
    "plannedShots": 0
  }
}
```

The exact stage may differ if the fixture has advanced; the fields and internally consistent counts are required.

- [ ] **Step 4: Validate desktop UI**

At `http://127.0.0.1:4319/`:

- Open Team.
- Confirm only team projects appear.
- Confirm title, stage badge, four-stage rail, counts, attention, editor, and time are visible.
- Confirm no nested project card and no horizontal overflow.
- Click a progress row and confirm only the calculated workspace mode is visible.

- [ ] **Step 5: Validate 390px mobile UI**

Set viewport to `390x844`:

- Confirm the Team panel remains within the viewport.
- Confirm project title is not clipped vertically.
- Confirm the rail keeps four stable columns.
- Confirm count/editor text wraps without increasing document width beyond 390px.

- [ ] **Step 6: Check browser errors and restore desktop viewport**

Verify there are no application console errors or warnings, reset the viewport override, and leave the local Explore page available for user acceptance.

- [ ] **Step 7: Record completion checkpoint**

Because this workspace is not a Git repository, do not initialize Git. Record the exact `npm test` result and local URL in the final handoff.
