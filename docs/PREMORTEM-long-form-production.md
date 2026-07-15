# Pre-Mortem: Long-Form Production

Imagine Pixel Toys launches long-form production support and fails. These are the likely causes.

## Tigers

### T1: Video credits are wasted by accidental task submission

Category: Launch-blocking

Why it matters: Image and video providers are paid. Silent retries or accidental queue recovery can burn credits.

Mitigation:

- Keep explicit user action as the only trigger for new paid generation.
- Add route-level tests for generation endpoints.
- Log task creation with user, project, shot, provider, and reason.

### T2: Long projects become impossible to debug

Category: Launch-blocking

Why it matters: A 50-minute project could create hundreds of clips. Without package boundaries, failures become hard to isolate.

Mitigation:

- Keep 70-90 second episode units as the first production unit.
- Add package manifests before supporting full long-form assembly.
- Store assembly manifests with source shot paths and timings.

### T3: Final assembly depends on expiring provider URLs

Category: Launch-blocking

Why it matters: Provider URLs can expire or fail range requests.

Mitigation:

- Assemble only from validated local server MP4 files.
- Use `ffprobe` validation before final cut.
- Mark missing or invalid clips before running `ffmpeg`.

### T4: Prompt quality regresses to repeated establishing shots

Category: Fast-follow

Why it matters: Editing cannot fix clips that all restart the scene.

Mitigation:

- Keep self-check guards against repeated establishing prompt templates.
- Add sample prompt tests for same-scene continuation, insert, reaction, and hard cut.

### T5: Browser UI cannot handle long-form state

Category: Fast-follow

Why it matters: Canvas state and project pages may become slow with many nodes and assets.

Mitigation:

- Keep long-form package state server-side.
- Render package summaries before full node graphs.
- Avoid loading every video node for a whole long-form episode at once.

## Paper Tigers

### P1: Every scene needs a transition effect

This is overblown. Hard cuts are often more professional. Use transitions only for scene changes, package boundaries, or explicit style choices.

### P2: ASR must be required before subtitles

This is overblown for version 1. Script/config subtitles are good enough to start. ASR alignment can be added later.

## Elephants

### E1: Who owns final creative approval?

The system can generate and assemble clips, but it cannot know whether the dramatic performance is acceptable. Add a human approval checkpoint before final assembly.

### E2: How much production data should stay on the server?

Generated assets, local MP4s, and final cuts will grow quickly. Add retention and archive rules before scaling usage.

## Launch-Blocking Action Plans

| Risk | Mitigation | Owner | Completion rule |
| --- | --- | --- | --- |
| Accidental paid task submission | Add generation route tests and require explicit UI action | Engineering | Tests prove read/refresh routes do not submit tasks |
| Debugging long projects | Add package manifest design before 50-minute workflow | Product + Engineering | Every package has status, shots, assets, and output paths |
| Expiring URLs in final cut | Assemble only from local validated MP4 files | Engineering | Assembly refuses remote-only clips |

