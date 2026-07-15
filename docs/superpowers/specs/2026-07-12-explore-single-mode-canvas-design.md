# Pixel Toys Explore And Single-Mode Canvas Design

Date: 2026-07-12

## 1. Objective

Upgrade Pixel Toys from a project-list-first production console into an Explore-led creative workspace. The first release prioritizes feature discovery: a user should understand the platform's main capabilities within ten seconds and enter the correct workflow without learning the existing internal page structure.

All implementation and verification must remain local. Do not connect to, deploy to, restart, or modify the production server. Do not submit any paid image or video generation during UI verification.

## 2. Product Direction

The product uses an Explore homepage inspired by creative-tool ecosystems, while retaining Pixel Toys' specialist short-drama workflow.

The homepage has four responsibilities:

1. Present the primary production workflow.
2. Expose the main creative capabilities.
3. Resume recent projects.
4. Surface global task, quota, search, and account status.

The first release does not include a community feed, template marketplace, third-party app publishing, rankings, creator payouts, or manually operated promotional carousels.

## 3. Information Architecture

The global navigation is:

- Explore
- Image
- Video
- Storyboard
- Canvas
- Assets
- Productions

The Explore homepage contains:

1. A featured short-drama production workflow.
2. A single Quick Start entry for the freeform generation canvas.
3. A recent-project continuation card.
4. A creative-tool matrix containing Short Drama Production, Image Generation, Video Generation, and Storyboard.
5. A searchable and filterable project list.

Generation Canvas must not appear twice in the same viewport. It remains a Quick Start entry, while Storyboard occupies the fourth core-tool position.

## 4. Visual System

The visual direction is a dark creative canvas:

- Page background: `#080D14`
- Canvas region: `#0C1523`
- Card and panel surface: `#121B29`
- Selection and connection blue: `#2D8CFF`
- Primary action green: `#A8FF36`
- Ready and success green: `#43DD79`
- Primary text: cool off-white
- Secondary text: muted blue-grey

Fine dot grids are limited to canvas surfaces and featured spatial areas. Blue indicates selection, structure, focus, or connection. Fluorescent green is reserved for primary actions and successful or ready states. Ordinary cards remain low-contrast blue-grey so the interface does not become uniformly neon.

Cards use a maximum 7px radius. Tool buttons use familiar icons with tooltips. The interface must not rely on decorative gradients, oversized marketing type, or nested card structures.

## 5. Single-Mode Canvas

The main workspace uses a fixed left function rail. The buttons are:

- Script
- Image
- Video
- Storyboard
- Assets

These buttons switch mutually exclusive modes. They do not add independent windows to a shared desktop. At any time, the canvas renders only the module group owned by the selected mode.

Mode responsibilities:

- Script: screenplay editing, dialogue tools, asset extraction, and parsing results.
- Image: image prompt composition, reference selection, generation settings, and image task results.
- Video: shot list, reference preparation, video settings, task progress, and generated clips.
- Storyboard: beat planning, Production Board slots, generation status, upload, and review.
- Assets: character, scene, prop, insert, and storyboard asset browsing and maintenance.

Each mode stores its own viewport, scroll position, filters, selection, and unsaved editing draft. Switching modes saves the current mode state and restores the destination mode state.

Global task status, quota, search, account, and errors remain visible in the top bar across mode changes.

## 6. Cross-Mode References

Another mode's full interface must not be mounted inside the current mode. Cross-mode data is accessed through a lightweight drawer, picker, or mention menu.

Examples:

- Storyboard opens an asset picker to select character and scene references.
- Video opens a reference picker for assets, Production Boards, and tail frames.
- Image opens a reference picker without mounting the complete Assets mode.

The picker returns stable asset identifiers and display metadata. It does not duplicate the source module's editing UI.

## 7. Asset Prompt Inspector

Clicking an asset card selects the asset and opens a right-side Asset Inspector in Assets mode.

The inspector displays:

- Asset identifier, type, status, style, and output quality.
- The effective generation prompt.
- Character count and unsaved state.
- Collapsible, read-only system style locks and negative constraints.
- Restore, Save Prompt, and Regenerate actions.

Save Prompt only updates the stored asset prompt. It must never submit image generation.

Regenerate is a separate fluorescent-green command. Before submission it shows the target asset, model, resolution, and a clear credit warning. The existing paid-generation safety rule remains unchanged.

An active prompt draft is authoritative in the UI. Project polling may update the asset image, status, and job fields, but must not overwrite an unsaved prompt draft. Switching assets preserves per-asset drafts until they are saved, restored, or explicitly discarded.

Image enlargement uses a separate preview control; clicking the card itself selects the asset and opens the inspector.

## 8. State And Data Flow

The frontend state adds:

- `activeWorkspaceMode`
- Per-mode UI state keyed by mode
- `selectedAssetId`
- Per-asset prompt drafts
- Inspector open state
- Explore filters and search state

Server project state remains the source of truth for persisted project data and task status. Local drafts remain frontend-owned until the user saves them.

The current polling contract remains mandatory:

1. The project status endpoint returns changed task and asset state.
2. The frontend merges status without replacing local drafts.
3. Only the affected mode or card is reconciled.
4. Signature guards prevent image reload, scroll jumps, and input replacement.

## 9. Local Rollout Strategy

The redesign must be introduced behind a local-only UI variant flag. The legacy interface remains reachable during development so behavior can be compared and regressions can be isolated.

Recommended activation order:

1. Local environment flag enables Explore and the single-mode shell.
2. Default local route opens the new Explore page when the flag is enabled.
3. A temporary local route or query parameter keeps the legacy interface accessible.
4. No production deployment configuration is added or changed during this phase.

## 10. Upgrade Priorities

### P0: Safety And Shell Foundation

- Add the local-only UI variant switch.
- Add design tokens and the global top bar.
- Add the left mode rail and mutually exclusive mode state.
- Add non-generation interaction tests.
- Preserve access control, owner isolation, quotas, and paid-generation guards.

Validation: users can switch all five modes locally without network generation, data mutation outside normal UI state, stale content overlap, or loss of the current project.

### P1: Explore Homepage And Feature Discovery

- Build the Explore homepage hierarchy.
- Add featured workflow, Quick Start Canvas, recent project, core tools, search, and filters.
- Ensure every card routes to the correct project or workspace mode.
- Add empty, loading, error, permission-denied, and no-project states.

Validation: a first-time tester can identify the four core tools and enter each workflow without instruction.

### P1: Asset Mode And Prompt Inspector

- Recompose the current asset grid into Assets mode.
- Add card selection and the right-side inspector.
- Preserve per-asset prompt drafts across polling and asset switching.
- Separate Save Prompt from Regenerate.
- Retain upload, replace, include/exclude, failure, and task states.

Validation: editing and saving a prompt never starts generation; an unsaved draft survives at least two status polling cycles.

### P2: Migrate Script And Storyboard Modes

- Move existing screenplay and asset-extraction tools into Script mode.
- Move Production Board planning, slots, upload, generation state, and review into Storyboard mode.
- Add lightweight cross-mode asset pickers.

Validation: Script and Storyboard interfaces are never visible simultaneously, while their persisted data remains available after switching.

### P2: Migrate Image And Video Modes

- Move image composition and results into Image mode.
- Move shot configuration, references, progress, clip review, and final assembly into Video mode.
- Keep global task status visible across mode changes.

Validation: background tasks continue polling after leaving their originating mode and show correct status when the user returns.

### P3: Polish And Local Acceptance

- Add keyboard navigation, tooltips, focus handling, and responsive behavior.
- Use full-screen single-mode layouts on narrow screens rather than an infinite desktop.
- Run visual regression checks at desktop and mobile widths.
- Run the full local test suite and update structural assertions only where the approved design intentionally changes behavior.

Validation: no overlap, text clipping, scroll reset, flicker, blank canvas, or accidental paid submission across supported viewports.

## 11. Testing Strategy

Tests must be written before each implementation slice.

Required coverage:

- Mode exclusivity and state restoration.
- Explore route and tool-card destination mapping.
- Project and permission isolation.
- Asset inspector selection and draft preservation.
- Save Prompt does not create a job.
- Regenerate requires an explicit command.
- Polling preserves active editor content.
- Background task status remains visible across modes.
- Desktop and mobile layout screenshots.
- Existing asset, storyboard, video reference, and project-isolation regressions.

Paid image and video providers must be stubbed or kept in dry-run mode for all local acceptance testing.

## 12. Success Criteria

- New users identify the four core tools within ten seconds.
- Only one functional mode is visible at a time.
- Existing project workflows and data remain accessible.
- Asset prompts are visible and editable from asset cards.
- Saving prompt text cannot consume credits.
- Polling does not overwrite drafts or cause visible rerender flicker.
- The redesign is fully verifiable on localhost without touching production.
