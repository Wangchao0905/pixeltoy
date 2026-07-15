# Pixel Toys Product UI Design

Date: 2026-07-01

## 1. Design Read

Pixel Toys is not a marketing site. It is a production console for short-drama creation, where the user needs fast status reading, controlled paid actions, and continuity across script, assets, Production Boards, video prompts, generated clips, and later final assembly.

The current UI already has the right functional surfaces: project home, studio, canvas, and admin. The main problem is not missing capability. The problem is that hierarchy and state are spread across many panels, while visual treatment competes for attention. A better design should make the workflow feel like a production board: compact, structured, and accountable.

## 2. Success Criteria

- On opening a project, the user can immediately see the current stage, blockers, and next recommended action.
- Paid actions are visually distinct and always require deliberate action.
- Assets, storyboards, video clips, and future assemblies share one status language.
- The main studio becomes easier to scan without hiding advanced controls.
- Canvas remains an expert surface for node work, not the default place to understand project progress.
- Admin remains a quiet operational table UI, optimized for quota and access control.

## 3. UI Directions Considered

### Direction A: Pipeline Command Center

Principle: The project is organized as a linear production pipeline with persistent stage status.

Layout:
- Left rail: project navigation and global sections.
- Top bar: project identity, stage summary, account/admin links.
- Main area: a horizontal or vertical stage board for Script, Assets, Production Board, Video, Review, Assembly.
- Right inspector: selected stage details, blockers, latest outputs, and primary actions.

Optimizes:
- Fast understanding of project readiness.
- Long-form package support.
- Lower risk of accidental generation because actions live inside explicit stage panels.

Sacrifices:
- Less freeform than the current draggable workspace.
- Requires careful state summaries to avoid becoming another dashboard.

Fit: Strong. This best matches the current product direction and future server assembly workflow.

### Direction B: Script-Centric Studio

Principle: The script stays in the center, and every downstream asset/shot/video is attached to script beats.

Layout:
- Center: script/beat timeline.
- Left: asset and scene index.
- Right: selected beat details, prompt, references, generated clips.

Optimizes:
- Narrative continuity.
- Fixing shot prompts that restart every scene.
- Debugging character/scene/prop parsing mistakes.

Sacrifices:
- More complex implementation.
- Harder to fit existing assets/storyboards/video tabs without deeper data model changes.

Fit: Good later, especially after asset role classification and package manifests mature.

### Direction C: Canvas-First Production Desk

Principle: Everything is represented as nodes, from assets to storyboards to videos.

Layout:
- Full-screen canvas.
- Node groups for scenes/packages.
- Floating tray for assets and generated media.

Optimizes:
- Power-user flexibility.
- Visualizing reference connections.

Sacrifices:
- Poor for long-form state scanning.
- Risky because current canvas state is mostly browser/localStorage based.
- Can make paid operations feel too easy to trigger accidentally.

Fit: Weak as the main UI. Keep canvas as an expert tool, not the primary production shell.

## 4. Recommended Direction

Use Direction A: Pipeline Command Center, with one focused improvement from Direction B: every stage should be able to drill down by scene/shot/package.

This is the safest and simplest path because it keeps the current surfaces but reorganizes hierarchy:
- project home remains a project launcher;
- studio becomes the production command center;
- canvas remains a separate generation workbench;
- admin remains a React operational island;
- future assembly can be added as a new stage without changing the whole app model.

## 5. Information Architecture

### Project Home

Purpose: choose or create work.

Structure:
- Compact header with logo, account, admin, refresh, new project.
- Project table/list with status columns: script, assets, board, video, assembly.
- Empty state for first project creation.
- Optional canvas entry only for authorized users, visually secondary.

Primary action: New Project.

Avoid:
- Hero copy.
- Large decorative cards.
- Hidden project status.

### Studio

Purpose: operate one project.

Structure:
- Left rail: Projects, Overview, Script, Assets, Board, Video, Assembly, Logs, Canvas.
- Top project bar: project name, episode/package selector, readiness chips, last saved/status.
- Main default view: Overview stage board.
- Stage detail view: selected stage content with inspector.

Recommended default stage board:
- Script: loaded, saved, dialogue language.
- Asset Parse: characters/scenes/props count, unresolved role conflicts.
- Asset Images: missing/failed/complete counts.
- Production Board: generated/uploaded board count and 9:16 panel compliance status.
- Video Config: planned total seconds, shot count, tail-frame usage summary.
- Video Clips: generated/downloaded/failed/missing clips.
- Assembly: disabled until local MP4 validation exists.

Primary action rules:
- Every stage has at most one primary action.
- Paid generation buttons use a distinct danger/cost treatment and confirmation.
- Read-only actions use neutral buttons.
- Advanced settings collapse inside the stage inspector.

### Canvas

Purpose: expert image/video node generation.

Structure:
- Keep full-screen canvas.
- Top actions should be grouped: Project, Import, Generate, Utility, Navigation.
- Video node should emphasize reference assets, prompt JSON, duration, and generate button.
- Person/liveness library remains hidden unless explicitly re-enabled.
- Asset tray should show type badges and source names clearly.

Primary action: Generate selected node, not global generation.

Avoid:
- Making canvas the place to diagnose whole-project readiness.
- Reintroducing hidden person-library controls in normal video workflow.

### Admin

Purpose: access, quota, invite, and API operations.

Structure:
- Keep table-first layout.
- Summary row on top.
- Users table as primary.
- Invites/API/usage as secondary panels.
- Status pills should use the same status language as studio.

Primary action: save explicit row changes.

Avoid:
- Marketing styling.
- Big cards that reduce table density.

## 6. Visual System

Tone: professional production console with restrained Pixel Toys identity.

Palette:
- Use a neutral dark base with controlled cyan/green accent.
- Reduce current dominant blue radial glow.
- Use semantic colors: ready, blocked, running, failed, paid action.
- Avoid one-note blue/purple gradient dominance.

Typography:
- Use system Chinese UI font for most interface text.
- Use pixel font only for logo, small labels, or decorative product identity.
- No viewport-scaled font sizes.
- No negative letter spacing.

Components:
- Buttons: icon + concise text where possible.
- Pills: status only, not decoration.
- Cards: only for repeated items or stage modules, with radius <= 8px.
- Tables: dense, readable, sticky headers where useful.
- Inspector: right-side or inline panel with stable width.
- Progress: stage-based readiness, not ambiguous spinners.

Layout:
- Desktop-first with fixed operational zones.
- Mobile/tablet can inspect and approve status but does not need full canvas production.
- Avoid nested cards.
- Keep text from overflowing by using stable widths, wrapping, and smaller labels.

## 7. Rollout Plan

### Phase 1: Design System Cleanup

- Define shared CSS tokens for color, spacing, radius, typography, status, and button variants.
- Reduce decorative background effects.
- Normalize button heights, focus states, form fields, and status pills.
- Keep behavior unchanged.

### Phase 2: Studio Overview

- Add an Overview tab/stage board as the default project view.
- Reuse existing state from `public/app.js`.
- Do not remove existing Assets/Storyboards/Video/Logs tabs yet.
- Add one next-action area that points to the relevant existing tab.

### Phase 3: Stage Detail Consolidation

- Rework Assets, Production Board, and Video tabs into consistent stage layouts.
- Move advanced controls into collapsible settings.
- Make generation status and missing blockers more prominent.

### Phase 4: Canvas Polish

- Re-group topbar actions.
- Make video node controls denser and clearer.
- Ensure reference names match asset identity rules.
- Verify screenshots at desktop and narrower widths.

### Phase 5: Admin Polish

- Align React admin visual tokens with the main UI.
- Improve table density, row actions, and quota editing affordances.
- Keep admin as a React island.

### Phase 6: Assembly Entry

- Add disabled Assembly stage with clear requirements.
- Later wire it to server-side MP4 validation and assembly manifest.

## 8. Implementation Guardrails

- Do not rewrite the whole app to React for the first UI pass.
- Do not change paid-generation behavior while doing visual cleanup.
- Do not overwrite production data during deployment.
- Do not make canvas access more permissive.
- Do not let pixel font apply broadly to Chinese operational text.
- Keep changes page-scoped and test after each phase.

## 9. QA Checklist

- Run `npm test`.
- Check `/` project home.
- Check studio with a real project selected.
- Check `/canvas.html` with and without imported assets.
- Check `/admin.html` as admin.
- Verify paid buttons remain explicit.
- Verify hidden canvas/person-library access rules still hold.
- Verify no text overflow in Chinese labels.
- Verify Production Board language still supports 16:9 sheet with 9:16 panels.

## 10. Recommendation

Proceed with Phase 1 and Phase 2 first. These two phases give the biggest product improvement with the lowest risk: they preserve current workflows while making the system readable as a production pipeline. After that, refine each stage one by one.
