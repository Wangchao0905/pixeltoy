function clean(value) {
  return String(value || "").trim();
}

function resourceScope(record = {}) {
  return record.scope === "team" && clean(record.teamId) ? "team" : "personal";
}

function canAccessResource({ user = {}, record = {}, membershipForUser = () => null } = {}) {
  if (!user.id) return false;
  if (resourceScope(record) === "personal") return clean(record.ownerUserId) === clean(user.id);
  const membership = membershipForUser(user.id);
  return !!membership && clean(membership.teamId || membership.id) === clean(record.teamId);
}

function canDeleteResource(options = {}) {
  if (!canAccessResource(options)) return false;
  const { user = {}, record = {}, membershipForUser = () => null } = options;
  if (resourceScope(record) === "personal") return clean(record.ownerUserId) === clean(user.id);
  const membership = membershipForUser(user.id);
  return membership?.role === "owner" && clean(membership.teamId || membership.id) === clean(record.teamId);
}

module.exports = { resourceScope, canAccessResource, canDeleteResource };
