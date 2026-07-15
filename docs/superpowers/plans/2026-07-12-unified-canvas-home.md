# Unified Canvas Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Canvas-first local homepage with a thin global menu, spatial preview, and combined canvas library.

**Architecture:** Reuse the existing Explore feature flag and routing. Replace only the Explore markup and styles, then extend `renderExploreHome` and blank-canvas loading so saved blank canvases and productions share one filtered library.

**Tech Stack:** HTML, CSS, browser JavaScript, Node assert tests.

---

### Task 1: Lock The Canvas-First Structure

**Files:**
- Modify: `scripts/explore-workspace-ui.test.mjs`

- [ ] Add failing assertions for `exploreCanvasHero`, `exploreCanvasGrid`, top-menu destinations, and removal of the old feature/tool grids.
- [ ] Run `node scripts/explore-workspace-ui.test.mjs` and confirm failure at the first missing Canvas-first element.

### Task 2: Replace Explore Markup And Styling

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`

- [ ] Replace the old Explore feature/tool/production sections with a spatial hero and one canvas library.
- [ ] Add responsive top navigation, point-grid hero, connected media nodes, segmented filters, and stable canvas cards.
- [ ] Keep all existing modal, studio, authentication, and generation markup unchanged.

### Task 3: Connect Saved Canvases And Productions

**Files:**
- Modify: `public/app.js`

- [ ] Store blank canvas summaries in frontend state after `/api/canvas/blank-list` loads.
- [ ] Render All Canvases, Productions, and Quick Start filters into `exploreCanvasGrid`.
- [ ] Bind filter, saved-canvas, new-canvas, and production actions through the existing Explore event delegation.
- [ ] Run `node --check public/app.js` and the focused Explore test.

### Task 4: Verify Locally

**Files:**
- Test: `scripts/explore-workspace-ui.test.mjs`
- Test: `scripts/self-check.mjs`

- [ ] Run `npm test` and require exit code 0.
- [ ] Reload `http://localhost:4318/` after authentication and inspect desktop and narrow layouts without submitting generation jobs.
