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
      const activeCollision = data.teams.some((team) => team.invite?.codeHash === digest && !team.invite?.revokedAt);
      if (code && !activeCollision) return code;
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
