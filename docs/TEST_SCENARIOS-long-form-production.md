# Test Scenarios: Long-Form Production

## Test Scenario: 70-90 Second Duration Planning

Test objective: Verify that video config generation plans an episode unit within the allowed total duration range.

Starting conditions:

- A project has a confirmed script and generated assets.
- Video config is rebuilt from current prompts.

User role: Creator

Test steps:

1. Rebuild video config from a simple script.
2. Inspect `config.shots`.
3. Sum `shot.duration`.
4. Verify every duration is between 4 and 15 seconds.

Expected outcomes:

- Total duration is at least 70 seconds and at most 90 seconds.
- Most complete story beats are near 15 seconds when possible.
- No shot duration exceeds 15 seconds.

## Test Scenario: Tail Frame Only For Direct Continuity

Test objective: Verify that same-scene shots do not always use tail frames.

Starting conditions:

- A generated config has adjacent shots in the same scene.
- At least one adjacent shot is an insert, reaction, over-shoulder, close reaction, or establish shot.

User role: Creator

Test steps:

1. Rebuild video config.
2. Inspect each adjacent same-scene shot.
3. Check `shot.shotPurpose`, `shot.useTailFrame`, and `shot.continuityNote`.

Expected outcomes:

- Direct action continuation can use tail frame.
- Insert, dialogue reaction, over-shoulder, close reaction, establish, hard cut, and scene reset do not use tail frame by default.
- `continuityNote` explains why tail frame is or is not used.

## Test Scenario: Cinematic Prompt Contains Director Design

Test objective: Verify that generated prompts include professional cinematic direction.

Starting conditions:

- A project has current video prompts or rebuilt config.

User role: Creator

Test steps:

1. Open a generated shot prompt.
2. Search for `导演设计`.
3. Search for `连续性开场`.
4. Inspect `镜头语言`, `光影描述`, `动作/表演`, and `时间轴`.

Expected outcomes:

- Prompt includes shot purpose, shot size, camera movement, composition, lighting, and performance.
- Same-scene continuation prompts do not reintroduce the environment.
- Performance includes micro-expression or body-action details.

## Test Scenario: Video Module Hides Person Library UI

Test objective: Verify that the Gravitex person-library UI is hidden from the canvas video module.

Starting conditions:

- `/canvas.html` is loaded after deployment.
- Browser cache is refreshed.

User role: Creator

Test steps:

1. Open `/canvas.html`.
2. Create or inspect a video node.
3. Look for the Gravitex person library note, upload panel, refresh button, settings button, and top-bar person library button.

Expected outcomes:

- Person library UI is not visible.
- Video generation controls remain visible.
- Existing backend routes remain unaffected.

## Test Scenario: Deployment Safety

Test objective: Verify that deployment does not overwrite production data.

Starting conditions:

- Local changes are ready.
- Server has production `.env.local`, users, sessions, usage, canvas states, public assets, and project data.

User role: Operator

Test steps:

1. Run local `npm test`.
2. Dry-run rsync and inspect file list.
3. Sync only intended code/static files or use explicit excludes.
4. Run remote `npm test`.
5. Reload PM2.

Expected outcomes:

- `.env.local`, auth JSON files, usage JSON, canvas state, public assets, project directories, outputs, and logs are not overwritten.
- Remote tests pass before PM2 reload.
- PM2 process returns online.

