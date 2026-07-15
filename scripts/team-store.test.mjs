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
