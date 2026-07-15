# Intent vs Implementation Audit Map

This document records the intent that future audits should compare against code evidence.

## Intent: Paid Generation Safety

Claim:

- Pixel Toys must not trigger paid image or video generation without explicit user action.

Implementation evidence to check:

- Frontend buttons that call generation routes.
- Server routes under `/api/canvas/video-generations`, `/api/canvas/project-video-generate`, and asset generation job routes.
- Any automatic recovery logic that could submit work after refresh.

Mismatch that matters:

- A background refresh, state read, or queue recovery submits a new paid task without user intent.

## Intent: Production Data Protection

Claim:

- Deployments must not overwrite `.env.local`, user/session/usage JSON, canvas state, public assets, project data, outputs, or logs.

Implementation evidence to check:

- Deployment commands used in handoff or scripts.
- Actual rsync include/exclude lists.
- Server directory after deployment.

Mismatch that matters:

- A deploy command uses broad `--delete` or syncs local runtime state over production state.

## Intent: Video Duration Planning

Claim:

- Episode unit duration is allowed to vary from 70 to 90 seconds based on script complexity.
- Each video segment stays within 4-15 seconds.
- Segments should prefer near-15-second design when script content supports it.

Implementation evidence to check:

- `VIDEO_MIN_EPISODE_SECONDS`
- `VIDEO_MAX_EPISODE_SECONDS`
- `episodeTargetDurationForBeats()`
- `planEpisodeDuration()`
- `clampShotDuration()`

Mismatch that matters:

- Config generation allows totals below 70 seconds, above 90 seconds, or segment durations above 15 seconds.

## Intent: Tail Frame Continuity

Claim:

- Tail frames should be used for direct action continuity, not for every same-scene shot.

Implementation evidence to check:

- `tailFrameContinuityDecision()`
- `shot.shotPurpose`
- `shot.cinematicDesign`
- `shot.useTailFrame`

Mismatch that matters:

- Same-scene insert, reaction, over-shoulder, close reaction, establish, or hard-cut shots use tail frame by default.

## Intent: Professional Video Prompts

Claim:

- Video prompts must include cinematic shot design, not generic repeated environment openings.

Implementation evidence to check:

- `cinematicShotDesignForShot()`
- `applyCinematicPromptDesign()`
- `seedancePromptBlock()`
- `enforceVideoPromptCinematicRules()`
- `scripts/self-check.mjs`

Mismatch that matters:

- Generated prompts repeatedly start with establishing shots in the same scene or lack camera, composition, lighting, performance, and continuity instructions.

## Intent: Frontend UI Quality

Claim:

- Pixel Toys is a dense production tool, not a landing page.

Implementation evidence to check:

- `public/index.html`
- `public/styles.css`
- `public/canvas.html`
- `public/canvas.css`
- `public/app.js`
- `public/canvas.js`

Mismatch that matters:

- Production workflows are hidden behind decorative layout, card nesting, text overflow, unlabeled controls, or missing loading/error states.

