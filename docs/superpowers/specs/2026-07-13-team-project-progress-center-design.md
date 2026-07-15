# Team Project Progress Center Design

Date: 2026-07-13

## Goal

Turn the existing project list inside the compact Team panel into a useful progress center. A team member should be able to see the current production stage, completion gaps, last editor, and last update time, then open the project directly in the stage that needs attention.

## Scope

This increment includes:

- Automatic progress calculation for team projects from existing project files and video configuration.
- Four visible stages: Script, Assets, Storyboard, and Video.
- Generated-versus-planned counts for Assets, Storyboard, and Video.
- A concise attention message when planned output is missing.
- Last modifier and relative update time.
- Opening a project directly in its current stage.
- Responsive rendering inside the existing Team panel.

This increment does not include:

- A separate team dashboard page.
- Manually editable percentages or statuses.
- Comments, notifications, assignments, due dates, or activity history.
- New persistence files or database tables.
- Real-time push updates.

## Chosen Approach

Extend `lightweightProjectSummary()` so `/api/projects` returns the progress facts needed by both the Explore cards and Team panel. The browser formats those facts but does not infer them from unrelated UI state.

This keeps one authoritative calculation, avoids a new endpoint, and preserves the current project-loading flow. The calculation must remain file-based and lightweight: read the script, asset manifest, generated media folders, and existing video configuration without starting jobs or modifying project state.

## Project Summary Contract

Extend each project summary with:

```json
{
  "progress": {
    "stage": "assets",
    "lastModifiedByUserId": "user_id",
    "lastModifiedByUsername": "username",
    "lastModifiedAt": "ISO-8601",
    "attention": "缺少 2 个资产"
  },
  "counts": {
    "scriptReady": true,
    "plannedAssets": 4,
    "assets": 2,
    "plannedStoryboards": 3,
    "storyboards": 1,
    "plannedShots": 5,
    "rawClips": 0
  }
}
```

Keep the existing `parsedAssets`, `assets`, and `rawClips` properties for compatibility. `plannedAssets` equals the normalized asset-manifest item count. Storyboard counts come from the current video configuration and generated storyboard images. Planned shot count comes from the current video configuration.

## Stage Calculation

Calculate one current stage in this order:

1. `script`: the script has no meaningful body content, or asset extraction has not produced any planned assets.
2. `assets`: planned assets exist and generated asset images are fewer than planned assets.
3. `storyboard`: assets are ready, storyboards are enabled, and either storyboard plans are not prepared or generated storyboard images are fewer than planned storyboards.
4. `video`: earlier stages are ready, but no shots are configured or generated raw clips are fewer than planned shots.
5. `complete`: at least one shot is configured and generated raw clips meet or exceed the planned shot count.

If storyboards are explicitly disabled in the existing video settings, skip the Storyboard stage. Counts may exceed plans; this is valid and must not create a warning.

The short attention message describes only the first unresolved stage:

- `等待完善剧本`
- `等待资产提取`
- `缺少 N 个资产`
- `等待故事板规划`
- `缺少 N 个故事板`
- `等待视频分镜配置`
- `缺少 N 个视频片段`
- Empty string when complete

## Team Panel UI

Keep the panel compact and reuse `#teamProjectProgress`.

Each project row contains:

- Project title and a small current-stage badge.
- A four-step horizontal progress rail: Script, Assets, Storyboard, Video.
- One count line such as `资产 2/4 · 故事板 1/3 · 视频 0/5`.
- An attention line when work is missing.
- Last modifier and relative update time.

Completed stages use the existing green team accent. The current stage uses the existing blue action accent. Pending stages stay muted. Attention text uses the existing warning color. The row remains a single button, not a card inside another card.

On narrow screens the count and editor lines wrap, but the stage rail remains four equal columns and must not create horizontal page overflow.

## Navigation

Clicking a team progress row loads that project through the existing `loadProject(projectId, { openStudio: true })` flow, then calls `setWorkspaceMode()` using this mapping:

- `script` -> `script`
- `assets` -> `assets`
- `storyboard` -> `storyboard`
- `video` or `complete` -> `video`

No new route or query parameter is required.

## Data Flow

1. `GET /api/projects` scans projects the current user may access.
2. `lightweightProjectSummary()` reads progress facts and returns the extended summary.
3. `loadProjects()` stores the summaries in `state.projects`.
4. `renderTeamPanel()` filters current-team projects and renders progress rows.
5. Clicking a row opens the selected project in its calculated current mode.

The existing periodic project refresh updates progress when files change. No Team-panel-specific polling is added.

## Error Handling

- Missing or malformed optional configuration produces zero planned storyboards and shots; it must not break the project list.
- Missing asset folders produce zero generated counts.
- A project that becomes inaccessible between list rendering and click follows the existing project-load error path.
- Unknown stage values fall back to `script` in the browser.
- Progress calculation must not create directories, migrate configuration, start generation, or write workflow state.

## Testing

Add focused tests before production changes:

- Server wiring test asserts the extended lightweight summary fields and stage-calculation helper are present.
- A dedicated progress helper test covers Script, Assets, Storyboard, Video, Complete, and storyboard-disabled cases with plain objects.
- UI test asserts the Team panel renders the four-stage rail, counts, attention message, last editor, and stage-aware navigation.
- CSS test asserts a stable four-column progress rail and responsive wrapping.
- Full `npm test` must pass.
- Browser acceptance checks desktop and 390px mobile layouts, verifies no horizontal overflow, and confirms clicking a project opens only the corresponding workspace mode.

## Acceptance Criteria

- Team projects show four-stage progress without opening the project.
- Missing work is derived from actual files/configuration and cannot be manually falsified.
- Last modifier and update time remain visible.
- Clicking a progress row opens the correct current workspace mode.
- Personal projects never appear in the Team progress list.
- Members and owners see the same progress facts; existing deletion and team-management permissions remain unchanged.
- The Team panel remains usable at 390px width without clipped project names or horizontal overflow.
