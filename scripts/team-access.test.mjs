import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resourceScope, canAccessResource, canDeleteResource } = require("../server/team-access.js");

const personal = { ownerUserId: "u1" };
const team = { ownerUserId: "u1", scope: "team", teamId: "t1" };
const membership = (userId) =>
  userId === "u1"
    ? { teamId: "t1", role: "owner" }
    : userId === "u2"
      ? { teamId: "t1", role: "member" }
      : null;

assert.equal(resourceScope(personal), "personal");
assert.equal(canAccessResource({ user: { id: "u1" }, record: personal, membershipForUser: membership }), true);
assert.equal(canAccessResource({ user: { id: "u2" }, record: personal, membershipForUser: membership }), false);
assert.equal(canAccessResource({ user: { id: "u2" }, record: team, membershipForUser: membership }), true);
assert.equal(canDeleteResource({ user: { id: "u2" }, record: team, membershipForUser: membership }), false);
assert.equal(canDeleteResource({ user: { id: "u1" }, record: team, membershipForUser: membership }), true);
assert.equal(canAccessResource({ user: { id: "admin" }, record: personal, membershipForUser: membership, isAdmin: true }), false);
assert.equal(canDeleteResource({ user: { id: "admin" }, record: personal, membershipForUser: membership, isAdmin: true }), false);
assert.equal(canAccessResource({ user: { id: "admin" }, record: { ownerUserId: "admin" }, membershipForUser: membership, isAdmin: true }), true);
console.log("team access tests passed");
