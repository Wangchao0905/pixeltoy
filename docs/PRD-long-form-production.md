# PRD: Long-Form Production And Server Assembly

## 1. Summary

Pixel Toys needs to support short-drama episodes that are longer than a single generation batch. The goal is to produce 70-90 second episode units first, then later support multi-package long-form episodes with server-side assembly, subtitles, and transitions.

## 2. Contacts

| Name | Role | Comment |
| --- | --- | --- |
| Product owner | User / creator | Defines production quality, workflow priorities, and deployment approval. |
| Engineering | Codex agent | Implements scoped changes, tests locally and remotely, and protects production data. |
| Operations | Server owner | Maintains PM2, nginx, HTTPS, API keys, object storage, and deployment safety. |

## 3. Background

Pixel Toys already converts screenplays into assets, Production Boards, Seedance prompts, canvas video nodes, downloaded clips, and tail frames. Recent changes added cinematic shot design, 70-90 second episode planning, and stricter tail-frame decisions.

The next product step is not a single massive 50-minute project. It is a staged workflow: produce reliable 70-90 second episode units, then group those units into long-form packages and assemble them on the server.

## 4. Objective

Make Pixel Toys reliable for repeatable short-drama production without wasting video credits.

Key results:

- Generate video configs whose total planned duration is between 70 and 90 seconds.
- Keep every video segment within 4-15 seconds.
- Prefer near-15-second segments when the script supports it.
- Use tail frames only for direct action continuity, not every same-scene shot.
- Block assembly until every required video has a local, valid, server-side MP4.
- Produce a final assembly manifest that maps every final timeline segment to source shots.

## 5. Market Segments

Primary segment:

- Solo creators or small teams making AI-assisted short drama, teaser episodes, or serialized story content.

Constraints:

- External video APIs cost money and can fail.
- Reference assets may require public HTTPS URLs.
- Long scripts create too many clips for a single browser/canvas session.
- Production must be restartable after browser refresh, server reload, or provider delay.

## 6. Value Propositions

Pixel Toys should help creators avoid:

- Re-generating clips because of weak prompts.
- Losing progress after a browser refresh.
- Stitching together unrelated clip openings.
- Manually tracking hundreds of generated video URLs.
- Paying for failed or duplicate video submissions.

Pixel Toys should provide:

- Structured shot design with camera, composition, light, and performance direction.
- Server-side clip download and validation.
- Clear queue state and recovery.
- Final assembly from local MP4 files, not expiring provider URLs.

## 7. Solution

### 7.1 UX

The current UI should remain production-focused. Add long-form support in stages:

- Episode unit view: 70-90 second planned unit.
- Package view: list of episode units or scene packages.
- Assembly view: missing clips, local MP4 readiness, subtitle readiness, final output.

### 7.2 Key Features

Version 1:

- Existing 70-90 second video config generation.
- Existing cinematic shot design in each shot.
- Existing local video download and tail-frame validation.
- Add server assembly manifest design before code.

Version 2:

- Generate `10_final_cuts/assembly_manifest.json`.
- Concatenate local MP4 clips with hard cuts.
- Generate `.srt` and `.ass` subtitles from script/config dialogue.

Version 3:

- Add scene-change transitions.
- Add package-level long-form grouping.
- Add assembly UI with missing-shot diagnostics.

### 7.3 Technology

- Node.js native server remains the app runtime.
- `ffmpeg` and `ffprobe` should be the server-side assembly tools.
- Final assembly should read only local MP4 files that passed validation.
- Object storage remains for provider-readable reference assets, not final assembly.

### 7.4 Assumptions

- Every generated clip can be downloaded to server storage before assembly.
- Provider video URLs may expire, so final cuts must not depend on remote URLs.
- Subtitle timing from script/config is good enough for version 1.
- ASR alignment is optional and should not block initial assembly.

## 8. Release

First release:

- Keep current deployed changes.
- Add assembly manifest and hard-cut server assembly.
- Add tests for missing clips, invalid MP4, duration boundaries, and subtitle output.

Future releases:

- Scene/package grouping.
- Subtitle editing.
- Transition controls.
- Long-form progress dashboard.

