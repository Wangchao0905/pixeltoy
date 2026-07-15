# Team Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local team creation/joining, personal and team project scopes, shared project/canvas access, progress visibility, and versioned cross-project resource references to Pixel Toys.

**Architecture:** Keep the existing file-based project and canvas stores. Add focused CommonJS modules for the team registry, scope permissions, and reference snapshots, then wire them into the existing `server.js` access helpers and API router. Extend the unified Canvas-first frontend with one compact Team panel, personal/team filters, scope actions, and a team-resource picker.

**Tech Stack:** Node.js 18 CommonJS server, filesystem JSON stores, browser JavaScript, HTML/CSS, Vite build, Node `assert` test scripts.

**Repository note:** This workspace is not a Git repository. Do not initialize Git. Replace commit steps with the verification checkpoint listed at the end of each task.

---

## File Map

Create:

- `server/team-store.js`: atomic team registry persistence, membership, roles, and seven-day invite lifecycle.
- `server/team-access.js`: pure personal/team scope and destructive-permission checks.
- `server/team-references.js`: deterministic versions, snapshot records, and reference status/update logic.
- `scripts/team-store.test.mjs`: registry lifecycle and invariant tests.
- `scripts/team-access.test.mjs`: permission matrix and legacy-scope tests.
- `scripts/team-references.test.mjs`: snapshot/version tests.
- `scripts/team-server-wiring.test.mjs`: server route and authorization wiring guards.
- `scripts/team-collaboration-ui.test.mjs`: top-bar panel, filters, actions, and resource-picker guards.

Modify:

- `server.js`: initialize modules, expose team APIs, extend project/canvas scope, enforce permissions, produce progress metadata, duplicate resources, and create reference catalogs/snapshots.
- `public/index.html`: compact Team button/panel, personal/team filters, and team-resource controls.
- `public/app.js`: team state/actions, project and canvas scope menus, progress labels, and team-resource reference interactions.
- `public/styles.css`: restrained panel, badges, filters, and reference status styles.
- `package.json`: run the new focused tests before `scripts/self-check.mjs`.
- `scripts/self-check.mjs`: replace owner-only invariants with intentional personal-or-team access invariants.
- `docs/ACCESS-CONTROL.md`: document system admin versus team owner authority and canvas scope access.

## Task 1: Team Registry Store

**Files:**

- Create: `server/team-store.js`
- Create: `scripts/team-store.test.mjs`

- [ ] **Step 1: Write the failing registry tests**

Create `scripts/team-store.test.mjs` with direct filesystem-isolated coverage:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTeamStore } = require("../server/team-store.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-team-store-"));
const filePath = path.join(root, ".pixel-toys-teams.json");
let nowMs = Date.parse("2026-07-12T00:00:00.000Z");
let codeIndex = 0;
const codes = ["JOINAAA1", "JOINBBB2", "JOINCCC3"];
const store = createTeamStore({
  filePath,
  now: () => new Date(nowMs),
  generateCode: () => codes[codeIndex++],
  generateId: (prefix) => `${prefix}_${codeIndex}`,
});

const team = store.createTeam({ userId: "u1", name: "Studio" });
assert.equal(team.ownerUserId, "u1");
assert.equal(store.teamForUser("u1").id, team.id);
assert.throws(() => store.createTeam({ userId: "u1", name: "Second" }), /已经加入团队/);

const invite = store.replaceInvite({ actorUserId: "u1", teamId: team.id });
assert.equal(invite.code, "JOINAAA1");
assert.equal(Date.parse(invite.expiresAt) - nowMs, 7 * 24 * 60 * 60 * 1000);
store.joinTeam({ userId: "u2", code: invite.code });
store.joinTeam({ userId: "u3", code: invite.code });
assert.equal(store.teamForUser("u2").id, team.id);
assert.equal(store.teamForUser("u3").id, team.id);

assert.throws(() => store.removeMember({ actorUserId: "u2", teamId: team.id, userId: "u3" }), /团队管理员/);
store.removeMember({ actorUserId: "u1", teamId: team.id, userId: "u3" });
assert.equal(store.teamForUser("u3"), null);

store.transferOwnership({ actorUserId: "u1", teamId: team.id, nextOwnerUserId: "u2" });
assert.equal(store.teamForUser("u2").ownerUserId, "u2");
assert.throws(() => store.leaveTeam({ userId: "u2" }), /转移团队/);

const replacement = store.replaceInvite({ actorUserId: "u2", teamId: team.id });
store.revokeInvite({ actorUserId: "u2", teamId: team.id });
assert.throws(() => store.joinTeam({ userId: "u4", code: replacement.code }), /邀请码无效/);

const expiring = store.replaceInvite({ actorUserId: "u2", teamId: team.id });
nowMs += 8 * 24 * 60 * 60 * 1000;
assert.throws(() => store.joinTeam({ userId: "u4", code: expiring.code }), /邀请码已过期/);

assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /JOINAAA1|JOINBBB2|JOINCCC3/);
console.log("team store tests passed");
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `node scripts/team-store.test.mjs`

Expected: FAIL with `Cannot find module '../server/team-store.js'`.

- [ ] **Step 3: Implement the registry with atomic writes**

Create `server/team-store.js` with this public interface:

```js
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function clean(value, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function hashCode(code) {
  return crypto.createHash("sha256").update(clean(code, 80)).digest("hex");
}

function teamError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createTeamStore({
  filePath,
  now = () => new Date(),
  generateCode = () => crypto.randomBytes(6).toString("base64url").toUpperCase(),
  generateId = (prefix) => `${prefix}_${crypto.randomUUID()}`,
} = {}) {
  if (!filePath) throw teamError("team store path is required", 500);

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { version: 1, teams: Array.isArray(parsed.teams) ? parsed.teams : [] };
    } catch {
      return { version: 1, teams: [] };
    }
  }

  function write(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, teams: data.teams }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  }

  function teamForUser(userId, data = read()) {
    return data.teams.find((team) => team.members.some((member) => member.userId === userId)) || null;
  }

  function requireTeam(data, teamId) {
    const team = data.teams.find((item) => item.id === teamId);
    if (!team) throw teamError("团队不存在", 404);
    return team;
  }

  function requireOwner(team, actorUserId) {
    if (team.ownerUserId !== actorUserId) throw teamError("需要团队管理员权限", 403);
  }

  function uniqueInviteCode(data) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = clean(generateCode(), 80);
      const digest = hashCode(code);
      if (code && !data.teams.some((team) => team.invite?.codeHash === digest && !team.invite?.revokedAt)) return code;
    }
    throw teamError("无法生成唯一邀请码", 500);
  }

  function createTeam({ userId, name }) {
    const data = read();
    if (!userId) throw teamError("请先登录", 401);
    if (teamForUser(userId, data)) throw teamError("账号已经加入团队", 409);
    const timestamp = now().toISOString();
    const team = {
      id: generateId("team"),
      name: clean(name, 80) || "未命名团队",
      ownerUserId: userId,
      members: [{ userId, role: "owner", joinedAt: timestamp }],
      invite: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    data.teams.push(team);
    write(data);
    return team;
  }

  function replaceInvite({ actorUserId, teamId }) {
    const data = read();
    const team = requireTeam(data, teamId);
    requireOwner(team, actorUserId);
    const code = uniqueInviteCode(data);
    const createdAt = now();
    team.invite = {
      codeHash: hashCode(code),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + INVITE_TTL_MS).toISOString(),
      revokedAt: "",
    };
    team.updatedAt = createdAt.toISOString();
    write(data);
    return { code, expiresAt: team.invite.expiresAt };
  }

  function revokeInvite({ actorUserId, teamId }) {
    const data = read();
    const team = requireTeam(data, teamId);
    requireOwner(team, actorUserId);
    if (team.invite) team.invite.revokedAt = now().toISOString();
    team.updatedAt = now().toISOString();
    write(data);
    return team;
  }

  function joinTeam({ userId, code }) {
    const data = read();
    if (teamForUser(userId, data)) throw teamError("账号已经加入团队", 409);
    const incomingHash = hashCode(code);
    const team = data.teams.find((item) => item.invite?.codeHash === incomingHash);
    if (!team || team.invite.revokedAt) throw teamError("邀请码无效", 400);
    if (Date.parse(team.invite.expiresAt) <= now().getTime()) throw teamError("邀请码已过期", 410);
    const timestamp = now().toISOString();
    team.members.push({ userId, role: "member", joinedAt: timestamp });
    team.updatedAt = timestamp;
    write(data);
    return team;
  }

  function leaveTeam({ userId }) {
    const data = read();
    const team = teamForUser(userId, data);
    if (!team) throw teamError("尚未加入团队", 409);
    if (team.ownerUserId === userId) throw teamError("请先转移团队所有权", 409);
    team.members = team.members.filter((member) => member.userId !== userId);
    team.updatedAt = now().toISOString();
    write(data);
    return team;
  }

  function removeMember({ actorUserId, teamId, userId }) {
    const data = read();
    const team = requireTeam(data, teamId);
    requireOwner(team, actorUserId);
    if (userId === team.ownerUserId) throw teamError("不能移除团队管理员", 409);
    team.members = team.members.filter((member) => member.userId !== userId);
    team.updatedAt = now().toISOString();
    write(data);
    return team;
  }

  function transferOwnership({ actorUserId, teamId, nextOwnerUserId }) {
    const data = read();
    const team = requireTeam(data, teamId);
    requireOwner(team, actorUserId);
    const next = team.members.find((member) => member.userId === nextOwnerUserId);
    if (!next) throw teamError("新管理员必须是当前团队成员", 400);
    team.members = team.members.map((member) => ({
      ...member,
      role: member.userId === nextOwnerUserId ? "owner" : "member",
    }));
    team.ownerUserId = nextOwnerUserId;
    team.updatedAt = now().toISOString();
    write(data);
    return team;
  }

  return {
    read,
    teamForUser,
    createTeam,
    replaceInvite,
    revokeInvite,
    joinTeam,
    leaveTeam,
    removeMember,
    transferOwnership,
  };
}

module.exports = { INVITE_TTL_MS, createTeamStore, hashCode, teamError };
```

- [ ] **Step 4: Run the focused test**

Run: `node scripts/team-store.test.mjs`

Expected: PASS and print `team store tests passed`.

- [ ] **Step 5: Verification checkpoint**

Run: `node --check server/team-store.js && node scripts/team-store.test.mjs`

Expected: both commands pass. Do not initialize or commit to Git.

## Task 2: Scope Permissions and Reference Versions

**Files:**

- Create: `server/team-access.js`
- Create: `server/team-references.js`
- Create: `scripts/team-access.test.mjs`
- Create: `scripts/team-references.test.mjs`

- [ ] **Step 1: Write failing permission tests**

Create `scripts/team-access.test.mjs` covering legacy personal scope, team membership, deletion, and admin bypass:

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resourceScope, canAccessResource, canDeleteResource } = require("../server/team-access.js");

const personal = { ownerUserId: "u1" };
const team = { ownerUserId: "u1", scope: "team", teamId: "t1" };
const membership = (userId) => (userId === "u1" ? { teamId: "t1", role: "owner" } : userId === "u2" ? { teamId: "t1", role: "member" } : null);

assert.equal(resourceScope(personal), "personal");
assert.equal(canAccessResource({ user: { id: "u1" }, record: personal, membershipForUser: membership }), true);
assert.equal(canAccessResource({ user: { id: "u2" }, record: personal, membershipForUser: membership }), false);
assert.equal(canAccessResource({ user: { id: "u2" }, record: team, membershipForUser: membership }), true);
assert.equal(canDeleteResource({ user: { id: "u2" }, record: team, membershipForUser: membership }), false);
assert.equal(canDeleteResource({ user: { id: "u1" }, record: team, membershipForUser: membership }), true);
assert.equal(canAccessResource({ user: { id: "admin" }, record: personal, membershipForUser: membership, isAdmin: true }), true);
console.log("team access tests passed");
```

- [ ] **Step 2: Write failing reference tests**

Create `scripts/team-references.test.mjs`:

```js
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resourceVersion, createReference, referenceStatus, updateReference } = require("../server/team-references.js");

const source = { id: "hero", label: "Hero", url: "/media?file=hero.png" };
const reference = createReference({
  sourceTeamId: "t1",
  sourceProjectId: "p1",
  sourceResourceType: "asset-image",
  sourceResourceId: "hero",
  snapshot: source,
  referencedByUserId: "u2",
  now: new Date("2026-07-12T00:00:00.000Z"),
  generateId: () => "ref_1",
});
assert.equal(reference.sourceVersion, resourceVersion(source));
assert.equal(referenceStatus(reference, source), "current");
assert.equal(referenceStatus(reference, { ...source, label: "Hero v2" }), "new-version");
assert.equal(referenceStatus(reference, null), "source-unavailable");
const updated = updateReference(reference, { ...source, label: "Hero v2" }, new Date("2026-07-13T00:00:00.000Z"));
assert.equal(updated.snapshot.label, "Hero v2");
assert.equal(referenceStatus(updated, { ...source, label: "Hero v2" }), "current");
console.log("team reference tests passed");
```

- [ ] **Step 3: Run both tests and verify missing-module failures**

Run: `node scripts/team-access.test.mjs && node scripts/team-references.test.mjs`

Expected: FAIL because the two modules do not exist.

- [ ] **Step 4: Implement the pure access module**

Create `server/team-access.js`:

```js
function clean(value) {
  return String(value || "").trim();
}

function resourceScope(record = {}) {
  return record.scope === "team" && clean(record.teamId) ? "team" : "personal";
}

function canAccessResource({ user = {}, record = {}, membershipForUser = () => null, isAdmin = false } = {}) {
  if (!user.id) return false;
  if (isAdmin) return true;
  if (resourceScope(record) === "personal") return clean(record.ownerUserId) === clean(user.id);
  const membership = membershipForUser(user.id);
  return !!membership && clean(membership.teamId || membership.id) === clean(record.teamId);
}

function canDeleteResource(options = {}) {
  if (!canAccessResource(options)) return false;
  if (options.isAdmin) return true;
  const { user = {}, record = {}, membershipForUser = () => null } = options;
  if (resourceScope(record) === "personal") return clean(record.ownerUserId) === clean(user.id);
  const membership = membershipForUser(user.id);
  return membership?.role === "owner" && clean(membership.teamId || membership.id) === clean(record.teamId);
}

module.exports = { resourceScope, canAccessResource, canDeleteResource };
```

- [ ] **Step 5: Implement deterministic reference records**

Create `server/team-references.js`:

```js
const crypto = require("node:crypto");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function resourceVersion(resource) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(resource))).digest("hex");
}

function createReference({ sourceTeamId, sourceProjectId, sourceResourceType, sourceResourceId, snapshot, versionPayload = snapshot, referencedByUserId, now = new Date(), generateId = () => `ref_${crypto.randomUUID()}` }) {
  return {
    id: generateId(),
    sourceTeamId,
    sourceProjectId,
    sourceResourceType,
    sourceResourceId,
    sourceVersion: resourceVersion(versionPayload),
    snapshot: JSON.parse(JSON.stringify(snapshot)),
    referencedAt: now.toISOString(),
    referencedByUserId,
    updatedFromSourceAt: "",
  };
}

function referenceStatus(reference, currentVersionPayload) {
  if (!currentVersionPayload) return "source-unavailable";
  return resourceVersion(currentVersionPayload) === reference.sourceVersion ? "current" : "new-version";
}

function updateReference(reference, currentSnapshot, now = new Date(), currentVersionPayload = currentSnapshot) {
  return {
    ...reference,
    sourceVersion: resourceVersion(currentVersionPayload),
    snapshot: JSON.parse(JSON.stringify(currentSnapshot)),
    updatedFromSourceAt: now.toISOString(),
  };
}

module.exports = { resourceVersion, createReference, referenceStatus, updateReference };
```

- [ ] **Step 6: Run focused tests**

Run: `node scripts/team-access.test.mjs && node scripts/team-references.test.mjs`

Expected: both PASS.

- [ ] **Step 7: Verification checkpoint**

Run: `node --check server/team-access.js && node --check server/team-references.js`

Expected: PASS. Do not initialize or commit to Git.

## Task 3: Wire Team Identity and Team APIs

**Files:**

- Modify: `server.js:1-90`, `server.js:276-340`, and `server.js:17245-17255`
- Create: `scripts/team-server-wiring.test.mjs`

- [ ] **Step 1: Write failing server wiring guards**

Create `scripts/team-server-wiring.test.mjs` and assert that `server.js`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(server, /require\("\.\/server\/team-store\.js"\)/);
assert.match(server, /const TEAM_STORE_PATH = path\.join\(APP_ROOT, "\.pixel-toys-teams\.json"\)/);
assert.match(server, /function currentTeamSummary/);
assert.match(server, /url\.pathname === "\/api\/team"/);
assert.match(server, /url\.pathname === "\/api\/team\/join"/);
assert.match(server, /url\.pathname === "\/api\/team\/leave"/);
assert.match(server, /url\.pathname === "\/api\/team\/invite"/);
assert.match(server, /\/api\/team\/members\//);
assert.match(server, /url\.pathname === "\/api\/team\/transfer"/);
assert.match(server, /teamId:/);
assert.match(server, /teamRole:/);
console.log("team server wiring tests passed");
```

- [ ] **Step 2: Run the wiring test and verify failure**

Run: `node scripts/team-server-wiring.test.mjs`

Expected: FAIL on the first missing team-store import.

- [ ] **Step 3: Initialize the store and expose safe team summaries**

Add the module imports immediately after the existing `series-preflight.js` import. Add `TEAM_STORE_PATH` and `teamStore` immediately after `AUTH_USAGE_PATH`:

```js
const { createTeamStore } = require("./server/team-store.js");
const { canAccessResource, canDeleteResource, resourceScope } = require("./server/team-access.js");
const { createReference, referenceStatus, updateReference } = require("./server/team-references.js");

const TEAM_STORE_PATH = path.join(APP_ROOT, ".pixel-toys-teams.json");
const teamStore = createTeamStore({ filePath: TEAM_STORE_PATH });
```

Add helpers before `publicUser()`:

```js
function teamMembershipForUser(userId = "") {
  const team = teamStore.teamForUser(userId);
  if (!team) return null;
  const member = team.members.find((item) => item.userId === userId);
  return member ? { teamId: team.id, role: member.role, team } : null;
}

function currentTeamSummary(user = {}) {
  const membership = teamMembershipForUser(user.id);
  if (!membership) return null;
  const users = new Map(readAuthUsers().users.map((item) => [item.id, item]));
  return {
    id: membership.team.id,
    name: membership.team.name,
    role: membership.role,
    ownerUserId: membership.team.ownerUserId,
    members: membership.team.members.map((member) => ({
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt,
      username: users.get(member.userId)?.username || member.userId,
      displayName: users.get(member.userId)?.displayName || users.get(member.userId)?.username || member.userId,
    })),
    inviteExpiresAt: membership.role === "owner" ? membership.team.invite?.expiresAt || "" : "",
  };
}
```

Extend `publicUser()` with `teamId` and `teamRole` derived from `teamMembershipForUser(user.id)`.

- [ ] **Step 4: Add authenticated team routes at the top of `handleApi()`**

Implement exact behaviors:

```js
if (req.method === "GET" && url.pathname === "/api/team") {
  const user = currentUserFromRequest(req);
  return send(res, 200, { ok: true, team: currentTeamSummary(user) });
}
if (req.method === "POST" && url.pathname === "/api/team") {
  const user = currentUserFromRequest(req);
  const body = await readBody(req);
  teamStore.createTeam({ userId: user.id, name: body.name });
  return send(res, 200, { ok: true, team: currentTeamSummary(user) });
}
if (req.method === "POST" && url.pathname === "/api/team/join") {
  const user = currentUserFromRequest(req);
  const body = await readBody(req);
  teamStore.joinTeam({ userId: user.id, code: body.code });
  return send(res, 200, { ok: true, team: currentTeamSummary(user) });
}
if (req.method === "POST" && url.pathname === "/api/team/leave") {
  const user = currentUserFromRequest(req);
  teamStore.leaveTeam({ userId: user.id });
  return send(res, 200, { ok: true, team: null });
}
if (req.method === "POST" && url.pathname === "/api/team/invite") {
  const user = currentUserFromRequest(req);
  const membership = teamMembershipForUser(user.id);
  const invite = teamStore.replaceInvite({ actorUserId: user.id, teamId: membership?.teamId });
  return send(res, 200, { ok: true, invite });
}
if (req.method === "DELETE" && url.pathname === "/api/team/invite") {
  const user = currentUserFromRequest(req);
  const membership = teamMembershipForUser(user.id);
  teamStore.revokeInvite({ actorUserId: user.id, teamId: membership?.teamId });
  return send(res, 200, { ok: true });
}
const teamMemberMatch = url.pathname.match(/^\/api\/team\/members\/([^/]+)$/);
if (req.method === "DELETE" && teamMemberMatch) {
  const user = currentUserFromRequest(req);
  const membership = teamMembershipForUser(user.id);
  teamStore.removeMember({ actorUserId: user.id, teamId: membership?.teamId, userId: decodeURIComponent(teamMemberMatch[1]) });
  return send(res, 200, { ok: true, team: currentTeamSummary(user) });
}
if (req.method === "POST" && url.pathname === "/api/team/transfer") {
  const user = currentUserFromRequest(req);
  const membership = teamMembershipForUser(user.id);
  const body = await readBody(req);
  teamStore.transferOwnership({ actorUserId: user.id, teamId: membership?.teamId, nextOwnerUserId: body.userId });
  return send(res, 200, { ok: true, team: currentTeamSummary(user) });
}
```

Guard missing membership before owner-only calls and return `403` with `需要团队管理员权限`. Preserve generic authentication handling through the existing `/api/` gate.

- [ ] **Step 5: Run focused and syntax tests**

Run: `node scripts/team-store.test.mjs && node scripts/team-server-wiring.test.mjs && node --check server.js`

Expected: PASS.

- [ ] **Step 6: Verification checkpoint**

Confirm `.pixel-toys-teams.json` is not created merely by loading the server module or running static tests. Do not initialize or commit to Git.

## Task 4: Project Scope, Access, Progress, and Duplication

**Files:**

- Modify: `server.js:1912-1960`, `server.js:6656-6690`, `server.js:17251-17255`, and `server.js:17515-17535`
- Modify: `scripts/self-check.mjs:59-75`
- Modify: `scripts/team-server-wiring.test.mjs`

- [ ] **Step 1: Extend failing wiring assertions**

Add assertions for `projectScopeRecord`, team-aware list access, destructive checks, scope conversion, personal duplication, and last modifier metadata:

```js
assert.match(server, /function projectScopeRecord/);
assert.match(server, /scanEpisodeRoots\(\)\.filter\(\(episodeRoot\) => userCanAccessProject\(user, episodeRoot\)\)/);
assert.match(server, /function assertUserCanDeleteProject/);
assert.match(server, /action === "team"/);
assert.match(server, /action === "duplicate-personal"/);
assert.match(server, /lastModifiedByUserId/);
```

Run: `node scripts/team-server-wiring.test.mjs`

Expected: FAIL on `projectScopeRecord`.

- [ ] **Step 2: Centralize project scope records and permissions**

Replace owner-only access logic with:

```js
function projectScopeRecord(episodeRoot) {
  const workflow = readWorkflowState(episodeRoot);
  const owner = projectOwner(episodeRoot);
  return {
    ownerUserId: owner.ownerUserId,
    scope: workflow.scope === "team" && workflow.teamId ? "team" : "personal",
    teamId: compactLine(workflow.teamId || ""),
  };
}

function membershipRecordForUser(userId = "") {
  const membership = teamMembershipForUser(userId);
  return membership ? { teamId: membership.teamId, role: membership.role } : null;
}

function userCanAccessProject(user = {}, episodeRoot = "") {
  return canAccessResource({
    user,
    record: projectScopeRecord(episodeRoot),
    membershipForUser: membershipRecordForUser,
    isAdmin: isAdminUser(user),
  });
}

function userCanDeleteProject(user = {}, episodeRoot = "") {
  return canDeleteResource({
    user,
    record: projectScopeRecord(episodeRoot),
    membershipForUser: membershipRecordForUser,
    isAdmin: isAdminUser(user),
  });
}
```

Keep `userOwnsProject()` for personal ownership checks used by conversion. Add `assertUserCanDeleteProject()` with the same 404 non-disclosure behavior as `assertUserCanAccessProject()`.

- [ ] **Step 3: Return scope and progress metadata from lightweight summaries**

Extend `lightweightProjectSummary()`:

```js
const scopeRecord = projectScopeRecord(episodeRoot);
const workflowStage = compactLine(workflow.currentStage || workflow.stage || "script");
return {
  id: encodeId(episodeRoot),
  title: seriesTitle,
  seriesTitle,
  episodeLabel,
  displayTitle: `${seriesTitle} / ${episodeLabel}`,
  scriptTitle: cleanScriptTitle || scriptTitle.trim().replace(/^#\s*/, ""),
  episodeSlug: slug,
  episodeCode: episodeLabel,
  episodeRoot,
  projectDir: projectDirForEpisode(episodeRoot),
  scope: scopeRecord.scope,
  teamId: scopeRecord.teamId,
  canDelete: false,
  progress: {
    stage: workflowStage,
    lastModifiedByUserId: compactLine(workflow.lastModifiedByUserId || workflow.ownerUserId || ""),
    lastModifiedByUsername: compactLine(workflow.lastModifiedByUsername || workflow.ownerUsername || ""),
    lastModifiedAt: workflow.lastModifiedAt || fs.statSync(episodeRoot).mtime.toISOString(),
  },
  counts: { assets: assetCount, parsedAssets, rawClips: rawClipCount },
  runNamespace,
  isolated: !!runNamespace,
  model: "",
  updatedAt: fs.statSync(episodeRoot).mtime.toISOString(),
  lightweight: true,
};
```

After mapping the summary in `/api/projects`, set `summary.canDelete = userCanDeleteProject(user, episodeRoot)` so the client never guesses destructive permissions.

- [ ] **Step 4: Update project list and deletion authorization**

Change the list filter to `userCanAccessProject(user, episodeRoot)`. Change the DELETE branch to call `assertUserCanDeleteProject(req, episodeRoot)` before deleting.

Update `scripts/self-check.mjs` so it asserts team-aware list access and separate destructive authorization instead of the old owner-only list invariant.

- [ ] **Step 5: Add irreversible team conversion and personal duplication actions**

Under `/api/project/:id/:action`:

```js
if (req.method === "POST" && action === "team") {
  const user = currentUserFromRequest(req);
  if (!userOwnsProject(user, episodeRoot)) return fail(res, 403, "只有个人项目所有者可以加入团队");
  const membership = teamMembershipForUser(user.id);
  if (!membership) return fail(res, 409, "请先创建或加入团队");
  const workflow = readWorkflowState(episodeRoot);
  if (resourceScope(workflow) === "team") return fail(res, 409, "项目已经属于团队");
  writeWorkflowState(episodeRoot, {
    ...workflow,
    scope: "team",
    teamId: membership.teamId,
    scopeChangedAt: new Date().toISOString(),
    scopeChangedByUserId: user.id,
  });
  return send(res, 200, fullProjectState(episodeRoot));
}
```

For `action === "duplicate-personal"`, require access to a team project and use this helper:

```js
function duplicateTeamProjectAsPersonal(episodeRoot, user) {
  const sourceProjectDir = projectDirForEpisode(episodeRoot);
  const targetProjectDir = uniqueProjectDir(`${sourceProjectDir}_personal_copy`);
  try {
    fs.cpSync(sourceProjectDir, targetProjectDir, { recursive: true, errorOnExist: true });
    const relativeEpisodeRoot = path.relative(sourceProjectDir, episodeRoot);
    const copiedEpisodeRoot = path.join(targetProjectDir, relativeEpisodeRoot);
    const copiedWorkflow = readWorkflowState(copiedEpisodeRoot);
    const timestamp = new Date().toISOString();
    writeWorkflowState(copiedEpisodeRoot, {
      ...copiedWorkflow,
      ownerUserId: user.id,
      ownerUsername: user.username,
      ownerAssignedAt: timestamp,
      scope: "personal",
      teamId: "",
      scopeChangedAt: timestamp,
      scopeChangedByUserId: user.id,
      lastModifiedByUserId: user.id,
      lastModifiedByUsername: user.username,
      lastModifiedAt: timestamp,
    });
    return copiedEpisodeRoot;
  } catch (error) {
    if (fs.existsSync(targetProjectDir)) fs.rmSync(targetProjectDir, { recursive: true, force: true });
    throw error;
  }
}
```

The route returns `fullProjectState(duplicateTeamProjectAsPersonal(episodeRoot, user))`. If the copy fails, remove only the newly created target directory and leave the source untouched.

- [ ] **Step 6: Track successful project mutations without rewriting every route**

After access is asserted and before action dispatch, register a finish hook only for mutating project requests:

```js
if (req.method === "POST") {
  const modifyingUser = currentUserFromRequest(req);
  res.once("finish", () => {
    if (res.statusCode >= 400 || !fs.existsSync(episodeRoot)) return;
    const workflow = readWorkflowState(episodeRoot);
    writeWorkflowState(episodeRoot, {
      ...workflow,
      lastModifiedByUserId: modifyingUser.id,
      lastModifiedByUsername: modifyingUser.username || "",
      lastModifiedAt: new Date().toISOString(),
    });
  });
}
```

Do not attach this hook to GET polling or failed requests.

- [ ] **Step 7: Run focused guards and full static checks**

Run: `node scripts/team-access.test.mjs && node scripts/team-server-wiring.test.mjs && node scripts/self-check.mjs && node --check server.js`

Expected: PASS.

- [ ] **Step 8: Verification checkpoint**

Inspect the project list response locally with two test accounts before later browser sign-off. Confirm personal projects remain hidden from teammates and team projects appear for both. Do not trigger generation.

## Task 5: Blank Canvas Team Scope

**Files:**

- Modify: `server.js:971-1120`, `server.js:1285-1365`, and `server.js:17257-17295`
- Modify: `scripts/team-server-wiring.test.mjs`

- [ ] **Step 1: Add failing blank-canvas wiring assertions**

```js
assert.match(server, /function canvasScopeRecord/);
assert.match(server, /function userCanAccessCanvasState/);
assert.match(server, /url\.pathname === "\/api\/canvas\/blank-team"/);
assert.match(server, /url\.pathname === "\/api\/canvas\/blank-duplicate-personal"/);
assert.match(server, /listBlankCanvases\(user\)/);
```

Run: `node scripts/team-server-wiring.test.mjs`

Expected: FAIL.

- [ ] **Step 2: Preserve scope metadata during canvas sanitization**

Add these fields to the object returned by `sanitizeCanvasState()`:

```js
scope: body.scope === "team" && compactLine(body.teamId || "") ? "team" : "personal",
teamId: compactLine(body.teamId || "").slice(0, 120),
lastModifiedByUserId: compactLine(body.lastModifiedByUserId || "").slice(0, 120),
lastModifiedByUsername: compactLine(body.lastModifiedByUsername || "").slice(0, 120),
```

Change `writeCanvasState(body, user)` so new blank canvases default to the caller's personal ownership, existing scope fields cannot be overwritten by arbitrary request bodies, and successful saves record the caller as last modifier.

- [ ] **Step 3: Add canvas scope helpers and team-aware lists**

Implement:

```js
function canvasScopeRecord(state = {}) {
  return {
    ownerUserId: compactLine(state.ownerUserId || ""),
    scope: state.scope === "team" && state.teamId ? "team" : "personal",
    teamId: compactLine(state.teamId || ""),
  };
}

function userCanAccessCanvasState(user = {}, state = {}) {
  return canAccessResource({
    user,
    record: canvasScopeRecord(state),
    membershipForUser: membershipRecordForUser,
    isAdmin: isAdminUser(user),
  });
}
```

Change `listBlankCanvases(ownerUserId)` to `listBlankCanvases(user)` and include only states for which `userCanAccessCanvasState(user, state)` is true. Return `scope`, `teamId`, `canDelete`, and last-modifier metadata with each list item.

Use `canDeleteResource()` for blank rename/delete destructive checks. Project-bound canvas state continues to use `assertUserCanAccessProject()` and inherits project scope.

- [ ] **Step 4: Add blank-canvas conversion and duplication APIs**

Implement `/api/canvas/blank-team` for a personal owner with current team membership. Use this helper for personal duplication:

```js
function duplicateBlankCanvasAsPersonal(state, user) {
  const timestamp = new Date().toISOString();
  return writeCanvasState({
    ...state,
    projectId: `canvas_${crypto.randomUUID()}`,
    name: `${compactLine(state.name || "未命名画布")} - 个人副本`,
    ownerUserId: user.id,
    scope: "personal",
    teamId: "",
    lastModifiedByUserId: user.id,
    lastModifiedByUsername: user.username || "",
    updatedAt: timestamp,
  }, user);
}
```

`/api/canvas/blank-duplicate-personal` must read the source state, call `userCanAccessCanvasState`, require `scope === "team"`, and return the new summary from `duplicateBlankCanvasAsPersonal()`.

Both routes must return the updated/new blank-canvas summary and must not call image or video generation.

- [ ] **Step 5: Run focused tests**

Run: `node scripts/team-access.test.mjs && node scripts/team-server-wiring.test.mjs && node --check server.js`

Expected: PASS.

- [ ] **Step 6: Verification checkpoint**

Using temporary canvas JSON fixtures, verify a team member can list/open a team blank canvas but cannot delete it, while the team owner can. Confirm the existing `userCanUseCanvas()` entitlement still blocks users whose canvas permission is disabled.

## Task 6: Team Resource Catalog and Snapshot Persistence

**Files:**

- Modify: `server.js:1862-2160`, `server.js:2876-3075`, `server.js:4862-4905`, `server.js:6939-7100`, `server.js:17245-17270`, and `server.js:17515-17620`
- Modify: `scripts/team-server-wiring.test.mjs`

- [ ] **Step 1: Add failing resource route assertions**

```js
assert.match(server, /url\.pathname === "\/api\/team\/resources"/);
assert.match(server, /action === "references"/);
assert.match(server, /references\/.+\/update/);
assert.match(server, /function teamResourceCatalog/);
assert.match(server, /function copyReferenceImageSnapshot/);
```

Run: `node scripts/team-server-wiring.test.mjs`

Expected: FAIL.

- [ ] **Step 2: Build stable resource descriptors**

Add `teamResourceCatalog(user)` that scans only projects with `scope: team` and the caller's `teamId`. Normalize every source through:

```js
function teamResourceDescriptor({ teamId, episodeRoot, type, resource }) {
  const sourceResourceId = compactLine(resource.id || resource.assetName || resource.name || "");
  if (!sourceResourceId) return null;
  const previewUrl = type === "shot" ? "" : String(resource.url || resource.previewUrl || "");
  const versionPayload = type === "shot"
    ? {
        id: sourceResourceId,
        name: compactLine(resource.name || ""),
        prompt: String(resource.prompt || ""),
        refs: Array.isArray(resource.refs) ? resource.refs.map(compactLine).filter(Boolean) : [],
        duration: Number(resource.duration || 0),
      }
    : {
        id: sourceResourceId,
        assetName: compactLine(resource.assetName || resource.name || ""),
        name: compactLine(resource.name || ""),
        size: Number(resource.size || 0),
        modifiedAt: resource.modifiedAt || resource.mtime || "",
      };
  return {
    sourceTeamId: teamId,
    sourceProjectId: encodeId(episodeRoot),
    sourceProjectName: projectDisplayNameForSummary(episodeRoot),
    sourceResourceType: type,
    sourceResourceId,
    label: compactLine(resource.label || resource.assetName || resource.name || sourceResourceId),
    previewUrl,
    versionPayload,
    sourceFile: type === "shot" ? "" : compactLine(resource.file || resource.path || ""),
  };
}
```

Use `projectProductionAssetsForState()` for `asset-image`, `currentStoryboardAssetsForWorkflow()` for `storyboard`, and `ensureVideoConfigIsolation(episodeRoot)?.data?.shots` for `shot`. IDs must be stable: asset/storyboard `assetName`, shot `id || name`.

- [ ] **Step 3: Copy image snapshots into the destination project**

Implement `copyReferenceImageSnapshot(destinationEpisodeRoot, descriptor, referenceId)`:

```js
function copyReferenceImageSnapshot(destinationEpisodeRoot, descriptor, referenceId) {
  const sourceFile = path.resolve(descriptor.sourceFile || "");
  if (!sourceFile || !allowedPath(sourceFile) || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    const error = new Error("来源资源文件不可用");
    error.statusCode = 409;
    throw error;
  }
  const extension = path.extname(sourceFile).toLowerCase() || ".bin";
  const destinationDir = path.join(workDirForEpisode(destinationEpisodeRoot), "team_references");
  fs.mkdirSync(destinationDir, { recursive: true });
  const destinationFile = path.join(destinationDir, `${safeSlug(referenceId, "reference")}${extension}`);
  const temporary = `${destinationFile}.${process.pid}.tmp`;
  fs.copyFileSync(sourceFile, temporary);
  fs.renameSync(temporary, destinationFile);
  return {
    copiedFile: destinationFile,
    url: `/media?file=${encodeURIComponent(destinationFile)}`,
  };
}
```

Shot snapshots remain JSON-only. Never store only the source media URL for image/storyboard snapshots, because the snapshot must survive source deletion or access loss.

- [ ] **Step 4: Persist references in destination workflow state**

Store references under `workflow.teamReferences`. Parse reference routes before the existing single-segment `action` switch:

```js
const referenceCreateMatch = url.pathname.match(/^\/api\/project\/([^/]+)\/references$/);
const referenceUpdateMatch = url.pathname.match(/^\/api\/project\/([^/]+)\/references\/([^/]+)\/update$/);
```

For create: verify caller can edit destination, verify caller is a current source-team member, resolve the catalog descriptor server-side, create the reference ID first, copy image data when required, call `createReference()` with the sanitized snapshot and `descriptor.versionPayload`, append to `workflow.teamReferences`, and write workflow state.

For update: find the stored reference, resolve its current source, replace the copied image snapshot atomically when required, call `updateReference(reference, sanitizedSnapshot, new Date(), descriptor.versionPayload)`, replace only that array entry, and write workflow state. Return `409 来源资源不可用` when explicit update is requested for a missing source; ordinary reads still return `source-unavailable`.

Add `teamReferences` to `fullProjectState()` and `projectStatusSnapshot()`, each enriched with `current`, `new-version`, or `source-unavailable` from `referenceStatus()`.

- [ ] **Step 5: Add the team resource list route**

Implement `GET /api/team/resources?type=asset-image|storyboard|shot` before the project list route. Return an empty list for users without a team. Strip `sourceFile` and `versionPayload` before sending descriptors to the browser.

- [ ] **Step 6: Test the resource behavior**

Extend `scripts/team-references.test.mjs` with a copied-file fixture and assert:

- the snapshot file remains after deleting the source fixture;
- status becomes `source-unavailable`;
- an explicit update replaces the destination copy;
- no automatic update occurs when only reading status.

Run: `node scripts/team-references.test.mjs && node scripts/team-server-wiring.test.mjs && node --check server.js`

Expected: PASS.

- [ ] **Step 7: Verification checkpoint**

Inspect a destination workflow JSON fixture and confirm it stores only the sanitized snapshot, copied destination path/URL, source IDs, and version metadata. Confirm it does not store an invite code or unrestricted source filesystem path.

## Task 7: Team Panel, Scope Filters, and Project/Canvas Actions

**Files:**

- Modify: `public/index.html:10-75`
- Modify: `public/app.js:35-75`, `public/app.js:196-220`, `public/app.js:921-1135`, and `public/app.js:4040-4175`
- Modify: `public/styles.css:7700-7860`
- Create: `scripts/team-collaboration-ui.test.mjs`

- [ ] **Step 1: Write failing UI structure tests**

Create `scripts/team-collaboration-ui.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.match(html, /id="exploreTeamButton"/);
assert.match(html, /id="teamPanel"/);
assert.match(html, /id="teamCreateForm"/);
assert.match(html, /id="teamJoinForm"/);
assert.match(html, /data-explore-scope="personal"/);
assert.match(html, /data-explore-scope="team"/);
assert.match(app, /async function loadTeam/);
assert.match(app, /function renderTeamPanel/);
assert.match(app, /function moveProjectToTeam/);
assert.match(app, /function duplicateProjectAsPersonal/);
assert.match(app, /function moveBlankCanvasToTeam/);
assert.match(app, /function duplicateBlankCanvasAsPersonal/);
assert.match(css, /\.team-panel/);
assert.match(css, /\.scope-badge/);
console.log("team collaboration UI tests passed");
```

- [ ] **Step 2: Run the UI test and verify failure**

Run: `node scripts/team-collaboration-ui.test.mjs`

Expected: FAIL on `exploreTeamButton`.

- [ ] **Step 3: Add compact top-bar team UI**

In `public/index.html`, add this structure inside `.explore-account-actions`:

```html
<button id="exploreTeamButton" type="button" aria-haspopup="dialog" aria-controls="teamPanel" title="团队">Team</button>
<section id="teamPanel" class="team-panel hidden" role="dialog" aria-label="团队">
  <header><strong id="teamPanelTitle">Team</strong><button id="closeTeamPanel" type="button" aria-label="关闭">×</button></header>
  <div id="teamEmptyState">
    <form id="teamCreateForm"><input name="name" required maxlength="80" placeholder="团队名称" /><button type="submit">创建团队</button></form>
    <form id="teamJoinForm"><input name="code" required maxlength="80" placeholder="邀请码" /><button type="submit">加入</button></form>
  </div>
  <div id="teamMemberState" class="hidden">
    <div id="teamSummary"></div>
    <div id="teamProjectProgress"></div>
    <div id="teamMemberList"></div>
    <div id="teamOwnerControls"></div>
    <button id="leaveTeamButton" type="button">退出团队</button>
  </div>
</section>
```

Keep the panel hidden by default and use existing `hidden`, `ghost`, `primary`, and form classes where possible.

- [ ] **Step 4: Add frontend team state and API actions**

Add to `state`:

```js
team: null,
teamPanelOpen: false,
exploreScopeFilter: "all",
teamResources: [],
```

Implement `loadTeam()`, `renderTeamPanel()`, `createTeam()`, `joinTeam()`, `leaveTeam()`, `generateTeamInvite()`, `revokeTeamInvite()`, `removeTeamMember()`, and `transferTeamOwnership()` using the routes from Task 3. Reload projects/canvases after membership changes.

- [ ] **Step 5: Replace the library scope controls**

Use `All`, `Personal`, and `Team` segmented controls with `data-explore-scope`. `filteredExploreProjects()` and blank-canvas rendering must filter on `item.scope`, while search remains independent. Quick-start creation cards appear in `All` and `Personal`, not `Team`.

Team project cards display:

```html
<span class="scope-badge is-team">Team</span>
<small>阶段名称 · 最后修改人 · 相对更新时间</small>
```

Personal items display a restrained `Personal` badge without extra explanatory text.

- [ ] **Step 6: Add project and blank-canvas action menus**

Use compact icon action buttons with tooltips:

- Personal project/canvas owned by a team member: `Add to team` with an irreversible confirmation.
- Team project/canvas: `Duplicate as personal`.
- Delete button only when server-provided `canDelete` is true.

Implement the four UI functions asserted by the test and refresh lists after success.

- [ ] **Step 7: Style the panel and stable card metadata**

Add a top-right anchored `.team-panel` with maximum width `360px`, maximum viewport-aware height, internal scrolling, 6px radius, existing dark surface colors, and no decorative gradients. Add stable-height scope/progress rows so labels cannot resize cards.

- [ ] **Step 8: Run focused UI tests and build**

Run: `node scripts/team-collaboration-ui.test.mjs && node scripts/explore-workspace-ui.test.mjs && npm run build`

Expected: PASS.

- [ ] **Step 9: Verification checkpoint**

At desktop and mobile widths, verify the panel does not overlap navigation or overflow the viewport. Confirm only relevant owner/member controls render and no action triggers paid generation.

## Task 8: Team Resource Picker and Version Status UI

**Files:**

- Modify: `public/index.html:260-315`
- Modify: `public/app.js:1464-1520`, `public/app.js:2337-2585`, and `public/app.js:4040-4175`
- Modify: `public/styles.css:3500-3650` and `public/styles.css:8000-8085`
- Modify: `scripts/team-collaboration-ui.test.mjs`

- [ ] **Step 1: Add failing resource UI assertions**

```js
assert.match(html, /id="teamResourceButton"/);
assert.match(html, /id="teamResourcePanel"/);
assert.match(app, /async function loadTeamResources/);
assert.match(app, /async function referenceTeamResource/);
assert.match(app, /async function updateTeamReference/);
assert.match(app, /new-version/);
assert.match(app, /source-unavailable/);
assert.match(css, /\.team-reference-status/);
```

Run: `node scripts/team-collaboration-ui.test.mjs`

Expected: FAIL.

- [ ] **Step 2: Add the team resource picker**

In Assets mode, add:

```html
<button id="teamResourceButton" class="ghost small hidden" type="button">Team resources</button>
<section id="teamResourcePanel" class="team-resource-panel hidden" aria-label="团队资源">
  <div role="tablist" aria-label="资源类型">
    <button type="button" data-team-resource-type="asset-image">Asset images</button>
    <button type="button" data-team-resource-type="storyboard">Storyboards</button>
    <button type="button" data-team-resource-type="shot">Shots</button>
  </div>
  <div id="teamResourceList"></div>
</section>
```

Only show the button when `state.team` exists and a destination project is selected.

Each resource row shows preview when available, resource label, source project, and a single `Reference` command. Do not expose source prompts or filesystem paths.

- [ ] **Step 3: Add reference actions and statuses**

Implement:

```js
async function loadTeamResources(type = "asset-image") {
  const data = await api(`/api/team/resources?type=${encodeURIComponent(type)}`);
  state.teamResources = data.resources || [];
  renderTeamResourcePanel();
}

async function referenceTeamResource(resource) {
  if (!state.selectedId) return;
  await api(`/api/project/${state.selectedId}/references`, {
    method: "POST",
    body: JSON.stringify({
      sourceProjectId: resource.sourceProjectId,
      sourceResourceType: resource.sourceResourceType,
      sourceResourceId: resource.sourceResourceId,
    }),
  });
  await loadProject(state.selectedId, { openStudio: false });
}

async function updateTeamReference(referenceId) {
  await api(`/api/project/${state.selectedId}/references/${encodeURIComponent(referenceId)}/update`, { method: "POST" });
  await loadProject(state.selectedId, { openStudio: false });
}
```

Render referenced resources in the current project asset/reference surface with source-project text and status badges: Current, New version, or Source unavailable. Show `Update` only for New version.

- [ ] **Step 4: Preserve existing prompt editing and generation controls**

Do not replace `assetInspector`, `assetInspectorPrompt`, `saveAssetPrompt`, or `regenerateAssetFromInspector`. Team references are an additional reference source and must not trigger regeneration when created or updated.

- [ ] **Step 5: Run UI and regression tests**

Run: `node scripts/team-collaboration-ui.test.mjs && node scripts/asset-prompt-update.test.js && node scripts/asset-surface-ui.test.mjs && node scripts/explore-workspace-ui.test.mjs`

Expected: PASS.

- [ ] **Step 6: Verification checkpoint**

Manually verify a referenced asset remains visible after the source resource is removed, displays Source unavailable, and can still be selected as a reference without calling a paid API.

## Task 9: Test Registration and Access-Control Documentation

**Files:**

- Modify: `package.json`
- Modify: `docs/ACCESS-CONTROL.md`
- Modify: `scripts/self-check.mjs`

- [ ] **Step 1: Register all focused tests in `npm test`**

Insert before `node scripts/self-check.mjs`:

```json
"node scripts/team-store.test.mjs && node scripts/team-access.test.mjs && node scripts/team-references.test.mjs && node scripts/team-server-wiring.test.mjs && node scripts/team-collaboration-ui.test.mjs && node scripts/self-check.mjs"
```

Keep existing tests in their current order.

- [ ] **Step 2: Update access-control documentation**

Append this section to `docs/ACCESS-CONTROL.md`:

```markdown
## 5. 团队协作权限

- 系统管理员仍只由 `superadmin` 与 `PIXEL_TOYS_ADMIN_USERNAMES` 白名单决定。
- 团队 `owner` 只是团队内角色，不会改变 `computedUserRole()`，也不能进入系统管理后台。
- 个人项目和个人独立画布只允许资源所有者访问；缺少 `scope` 的旧数据按个人资源处理。
- 团队项目和团队独立画布允许当前团队成员查看、编辑和生成；退出或被移除后立即失去访问权。
- 删除团队项目/画布、管理成员、管理邀请码和转移团队只允许团队 owner；系统管理员保留既有全局访问。
- 画布访问必须同时通过 `userCanUseCanvas()` 功能开关和资源 scope 权限，两者不可互相替代。
- 无权访问项目时继续返回 404，避免泄露项目是否存在；团队管理越权返回 403。
```

- [ ] **Step 3: Finalize static invariants**

In `scripts/self-check.mjs`, assert:

- project lists use `userCanAccessProject`;
- project deletion uses `assertUserCanDeleteProject`;
- project and blank-canvas team conversions exist;
- `userCanUseCanvas` remains in the global canvas gate;
- team owner does not alter `computedUserRole` or `adminUsernames`;
- reference updates are explicit and no automatic update path exists.

- [ ] **Step 4: Run the full automated suite**

Run: `npm test`

Expected: exit code 0, Vite build succeeds, all existing and new test scripts print their pass messages.

- [ ] **Step 5: Verification checkpoint**

Confirm test execution does not create or modify the real `.pixel-toys-teams.json`, user store, project directories, or canvas states. All filesystem mutation tests must use temporary directories.

## Task 10: Local Runtime and Browser Acceptance

**Files:**

- No production files unless acceptance reveals a directly related defect.

- [ ] **Step 1: Start a local-only server on a free port**

Run: `PORT=4318 PIXEL_TOYS_EXPLORE_UI=1 npm start`

Expected: local server remains running and reports `http://localhost:4318/`. If 4318 is occupied, use the next free port.

- [ ] **Step 2: Verify team creation and invite lifecycle**

Using local test accounts:

1. Create a team as account A.
2. Generate an invite and join as account B.
3. Reuse the invite with another test account before expiry.
4. Revoke or replace it and confirm the previous code fails.
5. Confirm ordinary members cannot manage invites or members.

- [ ] **Step 3: Verify personal/team isolation and progress**

Create or use local non-production fixtures:

1. Account A's personal project is invisible to B.
2. After A moves it into the team, B can open, edit, and save it.
3. B cannot delete it; team owner A can.
4. Last modifier and update time change after B saves.
5. B's unrelated personal project remains invisible to A.
6. Team project duplication creates an independent personal copy.

- [ ] **Step 4: Verify canvas access**

1. Move a blank canvas into the team.
2. A canvas-entitled member can list and edit it.
3. A member without canvas entitlement is still blocked by the existing feature gate.
4. Only the team owner can delete the team canvas.
5. Duplicate as personal produces a new owner-only canvas.

- [ ] **Step 5: Verify reference snapshots**

1. Reference an asset image, storyboard, and shot from another team project.
2. Modify the source and confirm New version appears without changing the destination snapshot.
3. Explicitly update and confirm the snapshot/version changes.
4. Remove the source and confirm Source unavailable while the snapshot remains usable.

- [ ] **Step 6: Verify responsive UI**

Check desktop and mobile viewport screenshots:

- top navigation and Team button do not overlap;
- Team panel stays inside the viewport;
- All/Personal/Team filters remain readable;
- project/canvas cards keep stable dimensions;
- resource picker does not nest cards or cover asset controls;
- no blank canvas state appears when accessible items exist.

- [ ] **Step 7: Stop with local results only**

Do not deploy, publish, modify production data, or call paid image/video generation. Report automated test output, local URL, tested accounts/fixtures, and any remaining risk.
