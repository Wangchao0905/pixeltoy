# Team Collaboration Design

Date: 2026-07-12

## Goal

Add local team collaboration to Pixel Toys without replacing the existing file-based project model. A user can keep private personal projects while selectively moving projects into one team. Team members can view progress, edit shared production content, generate media, and reference reusable resources from other team projects.

## Scope

V1 includes:

- Creating one team or joining one team with an invite code.
- Personal and team projects existing side by side.
- Shared scripts, shot breakdowns, storyboards, assets, videos, and canvases.
- Team project progress and recent-editor visibility.
- Versioned cross-project references for asset images, shots, and storyboards.
- Owner and member roles.

V1 does not include:

- Membership in multiple teams or active-team switching.
- Real-time cursors, presence, or collaborative conflict merging.
- Automatic propagation of source resource changes.
- Moving a team project back to personal ownership.
- Production deployment or paid image/video generation during validation.

## Confirmed Product Rules

- Each account belongs to at most one team.
- A team member may still create and use personal projects.
- Existing personal projects stay personal until their owner explicitly moves them into the team.
- Existing personal blank canvases stay personal until their owner explicitly moves them into the team.
- Moving a project into a team is irreversible. A member can create an independent personal copy instead.
- Ordinary members can view, edit, and generate in team projects.
- Ordinary members cannot delete team projects, manage members, reset invite codes, or transfer team ownership.
- Team content remains with the team when a member leaves or is removed. The former member loses access immediately.
- Invite codes are reusable for seven days, and the team owner may revoke or replace them earlier.
- A referenced resource captures a version snapshot. Source changes produce an update notice; the referencing project updates only after an explicit user action.

## Architecture

Keep the existing project directories, workflow state files, canvas state files, authentication, and route structure. Add one team registry and extend the existing centralized access helpers.

The design has four focused responsibilities:

1. Team registry: team identity, membership, role, and invite lifecycle.
2. Resource scope: whether a project or blank canvas is personal or team-owned.
3. Access policy: centralized read, edit, generation, and destructive-action checks.
4. Resource references: stable source identity plus a captured snapshot and source version.

The system administrator model remains separate from team roles. `superadmin` and environment-whitelisted administrators retain the existing global administration/access behavior. A team owner is not a system administrator and has authority only inside that team.

## Storage Model

### Team Registry

Add a structured local store such as `.pixel-toys-teams.json`:

```json
{
  "version": 1,
  "teams": [
    {
      "id": "team_uuid",
      "name": "Studio name",
      "ownerUserId": "user_uuid",
      "members": [
        {
          "userId": "user_uuid",
          "role": "owner",
          "joinedAt": "ISO-8601"
        }
      ],
      "invite": {
        "codeHash": "sha256",
        "createdAt": "ISO-8601",
        "expiresAt": "ISO-8601",
        "revokedAt": ""
      },
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

Persist only a hash of the invite code. Show the plain code when it is generated; if it is lost, the team owner generates a replacement. Enforce the one-team-per-user rule when creating a team and when accepting an invite.

### Project Scope

Extend existing workflow ownership metadata:

```json
{
  "ownerUserId": "original_creator",
  "scope": "personal",
  "teamId": "",
  "scopeChangedAt": "ISO-8601",
  "scopeChangedByUserId": "user_uuid",
  "lastModifiedByUserId": "user_uuid",
  "lastModifiedByUsername": "username",
  "lastModifiedAt": "ISO-8601"
}
```

Legacy projects without `scope` are treated as `personal`. Their existing `ownerUserId` behavior remains unchanged. Moving a project to the team sets `scope` to `team` and records the current user's `teamId`; it does not copy or relocate the project directory.

### Blank Canvas Scope

Blank canvas state receives the same `scope`, `teamId`, and last-modifier fields. Legacy blank canvases remain personal and continue to use `ownerUserId`.

### Team Resource Reference

References use a common record for supported resource types:

```json
{
  "id": "reference_uuid",
  "sourceTeamId": "team_uuid",
  "sourceProjectId": "project_id",
  "sourceResourceType": "asset-image",
  "sourceResourceId": "resource_id",
  "sourceVersion": "content_signature",
  "snapshot": {},
  "referencedAt": "ISO-8601",
  "referencedByUserId": "user_uuid",
  "updatedFromSourceAt": ""
}
```

Supported V1 resource types are `asset-image`, `shot`, and `storyboard`. `sourceVersion` is a deterministic signature of the shareable resource data. The snapshot contains the data needed to keep using the resource if the source is later changed or deleted.

## Permission Model

| Action | Allowed callers |
|---|---|
| View/edit/generate in a personal project | Its personal owner; existing system administrators retain their current access |
| Move a personal project into the current team | Its personal owner, when that owner currently belongs to a team |
| View/edit/generate in a team project | Current members of that project's team; existing system administrators retain their current access |
| Reference a team resource | Current members of the source team who can edit the destination project |
| Delete a personal project | Its personal owner; existing system administrators retain their current access |
| Delete a team project | The source team's owner; existing system administrators retain their current access |
| Manage members and invite codes | The team owner; existing system administrators retain their current access |
| Transfer team ownership | The current team owner; existing system administrators retain their current access |

The original project creator has no special destructive authority after the project becomes a team project. Destructive actions follow team ownership, avoiding mixed ownership rules.

Use separate centralized checks for:

- `userCanAccessProject`: read, edit, and generation access.
- `userCanDeleteProject`: personal owner, team owner, or existing system administrator.
- `userCanManageTeam`: team owner or existing system administrator.
- `userCanAccessCanvasState`: personal owner or member of the canvas team, while preserving the existing `userCanUseCanvas` global feature gate.

Unauthorized project access should continue returning a not-found response where the current code intentionally avoids leaking project existence. Team-management authorization failures may return a clear `403`.

## Main Flows

### Create or Join a Team

1. A user with no team opens the compact Team panel.
2. The user creates a named team or enters an invite code.
3. Team creation makes the user the owner.
4. Invite acceptance checks the hash, active state, seven-day expiry, and that the user has no existing team.
5. The UI refreshes the current user/team summary without changing personal project ownership.

The team owner cannot leave while still owning the team. Ownership must first be transferred to another current member.

### Move a Personal Project Into the Team

1. The personal owner selects `Add to team` from the project menu.
2. A confirmation explains that the operation cannot be reversed and that all team members will gain edit/generation access.
3. The server verifies personal ownership and current team membership.
4. The workflow state changes to `scope: team` with the user's current `teamId`.
5. The project appears in the team view. A personal copy can later be created without affecting the team project.

The same irreversible scope change applies to an independent blank canvas. Its owner may move it into the current team; team members with canvas entitlement can then open and edit it. A personal copy is created when an independent version is needed.

### Remove a Member

1. The team owner removes a non-owner member.
2. Membership is removed atomically from the registry.
3. Subsequent project, canvas, and resource requests fail immediately.
4. Existing team data and the member's contribution history remain intact.
5. The removed member's personal projects and personal canvases remain unchanged.

### Reference a Team Resource

1. In Assets mode, a user filters the resource picker to `Team resources`.
2. The server returns only supported resources from accessible team projects.
3. Selecting a resource captures its current snapshot and source version in a personal project owned by the caller or a team project the caller can edit.
4. Later reads compare the stored source version with the current source signature.
5. A changed source displays `New version available`; the user may preview and explicitly update the snapshot.
6. A missing or newly inaccessible source displays `Source unavailable` but keeps the saved snapshot usable, including after the referencing user leaves the source team.

## UI Design

Integrate collaboration into the existing unified Canvas/top-menu experience.

- Add one compact Team button near the account controls in the global top bar.
- Open a focused panel rather than a separate dashboard.
- For users without a team, show only `Create team` and `Join with code`.
- For team members, show Overview, Projects, and Members. Invite management controls appear only for the team owner.
- Ordinary members may leave the team. The team owner must transfer ownership before leaving.
- Keep the existing project/canvas library and add `All`, `Personal`, and `Team` filters.
- Team project cards show the current workflow stage, last modifier, and update time using existing workflow state rather than a separate manually maintained progress system.
- Add `Add to team` to eligible personal project and blank-canvas menus. Add `Duplicate as personal` to team project and team blank-canvas menus.
- In Assets mode, add a `Team resources` source filter. Referenced items show their source project and one of `Current`, `New version`, or `Source unavailable`.
- Do not add explanatory feature copy, a second navigation system, or a card-heavy team administration page.

## API Surface

Add a small set of authenticated endpoints following existing server conventions:

- `GET /api/team` returns the current user's team summary and role.
- `POST /api/team` creates a team.
- `POST /api/team/join` accepts an invite code.
- `POST /api/team/leave` removes the current non-owner member from the team.
- `POST /api/team/invite` generates or replaces the seven-day invite code.
- `DELETE /api/team/invite` revokes the active invite.
- `DELETE /api/team/members/:userId` removes a member.
- `POST /api/team/transfer` transfers team ownership.
- `POST /api/projects/:projectId/team` moves an owned personal project into the current team.
- `POST /api/projects/:projectId/duplicate-personal` copies a team project into a new personal project.
- `POST /api/canvas/blank-team` moves an owned personal blank canvas into the current team.
- `POST /api/canvas/blank-duplicate-personal` copies a team blank canvas into a new personal blank canvas.
- `GET /api/team/resources` lists referenceable team resources.
- `POST /api/projects/:projectId/references` captures a resource snapshot.
- `POST /api/projects/:projectId/references/:referenceId/update` explicitly updates a snapshot.

Exact route names may be adapted to existing project route patterns during implementation, but the authorization and behavior above are fixed.

## Errors and Consistency

- Reject invalid, expired, revoked, or replaced invite codes without revealing team membership details.
- Reject team creation or invite acceptance when the user already belongs to a team.
- Reject project conversion when the project is not personal, the caller is not its owner, or the project team differs from the caller's current team.
- Write the team registry atomically through a temporary file and rename, matching the reliability expected for local structured state.
- Reject removal of the team owner and require an explicit ownership transfer.
- Reject team-resource references unless the caller is a current source-team member and can edit the destination project.
- Keep a reference snapshot usable when its source is inaccessible or deleted.
- Never auto-update a reference snapshot on read or save.
- Preserve existing canvas feature-gate checks in addition to team access checks.

## Migration and Compatibility

No bulk migration is required.

- Missing team registry means no teams exist.
- Existing users have no team until they create or join one.
- Existing projects and blank canvases without `scope` remain personal.
- Existing owner metadata remains authoritative for personal resources.
- Existing system administrator and canvas entitlement behavior remains unchanged.
- Existing project URLs and directories remain valid after a project joins a team.

## Validation

Follow test-driven implementation: add failing coverage before each behavioral change.

Required automated coverage:

- Team creation and the one-team-per-user invariant.
- Invite generation, seven-day expiry, revocation, replacement, and reuse.
- Owner/member permission matrix for projects, generation routes, canvases, deletion, and team management.
- Legacy personal project and blank-canvas behavior.
- Personal-to-team conversion and the absence of a reverse conversion.
- Team project duplication into an independent personal project.
- Blank-canvas scope conversion, team access, destructive permissions, and personal duplication.
- Member removal and immediate access loss without content deletion.
- Resource snapshot creation, update detection, explicit update, and missing-source behavior.
- Project list and canvas list filtering for personal and team scopes.
- Preservation of the existing `superadmin` whitelist model and canvas feature gate.
- UI states for no team, owner, member, invite errors, project scope, progress metadata, and reference version badges.

Run the full local test suite and local browser checks. Use isolated temporary data for runtime API tests. Do not deploy, change production data, or invoke paid generation APIs.
