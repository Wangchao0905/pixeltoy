const ROLE_KEYS = ["character", "scene", "props", "style", "storyboard"];

const ROLE_ALIASES = {
  character: "character",
  characters: "character",
  scene: "scene",
  scenes: "scene",
  prop: "props",
  props: "props",
  style: "style",
  styles: "style",
  storyboard: "storyboard",
  storyboards: "storyboard",
};

const DEFAULT_POLICY = {
  identityLock: true,
  sceneLock: true,
  wardrobeLock: true,
  styleLock: true,
};

function clean(value, maxLength = 180) {
  return String(value || "").trim().slice(0, maxLength);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values, max = 24) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 180)).filter(Boolean))].slice(0, max);
}

function normalizeReferenceRoles(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const roles = Object.fromEntries(ROLE_KEYS.map((role) => [role, []]));
  for (const [rawRole, items] of Object.entries(source)) {
    const role = ROLE_ALIASES[String(rawRole || "").trim().toLowerCase()];
    if (!role) continue;
    roles[role] = uniqueStrings([...(roles[role] || []), ...(Array.isArray(items) ? items : [items])]);
  }
  return roles;
}

function normalizeReferencePolicy(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.keys(DEFAULT_POLICY).map((key) => [key, source[key] === undefined ? DEFAULT_POLICY[key] : source[key] !== false]));
}

function comparableKit(kit = {}) {
  return {
    name: clean(kit.name, 120),
    roles: normalizeReferenceRoles(kit.roles),
    policy: normalizeReferencePolicy(kit.policy),
  };
}

function referenceKitVersion(kit = {}, previous = null) {
  const requested = Math.max(1, Number.parseInt(kit.version, 10) || 1);
  if (!previous) return requested;
  const previousVersion = Math.max(1, Number.parseInt(previous.version, 10) || 1);
  return JSON.stringify(comparableKit(kit)) === JSON.stringify(comparableKit(previous))
    ? previousVersion
    : Math.max(previousVersion + 1, requested);
}

function normalizeReferenceKit(input = {}, options = {}) {
  const now = clean(options.now || input.updatedAt || new Date().toISOString(), 80) || new Date().toISOString();
  const previous = options.previous || null;
  const kit = {
    id: clean(input.id || previous?.id, 120),
    name: clean(input.name || previous?.name || "未命名 Reference Kit", 120),
    version: referenceKitVersion(input, previous),
    roles: normalizeReferenceRoles(input.roles || previous?.roles),
    policy: normalizeReferencePolicy(input.policy || previous?.policy),
    createdAt: clean(previous?.createdAt || input.createdAt || now, 80),
    updatedAt: now,
  };
  return kit;
}

function referenceKitSnapshot(kit = {}) {
  const normalized = normalizeReferenceKit(kit, { now: kit.updatedAt || kit.createdAt || new Date().toISOString() });
  return {
    name: normalized.name,
    version: normalized.version,
    roles: clone(normalized.roles),
    policy: clone(normalized.policy),
  };
}

function referenceIdsFromSnapshot(snapshot = {}) {
  const roles = normalizeReferenceRoles(snapshot.roles || snapshot);
  return {
    refs: uniqueStrings([...roles.character, ...roles.scene, ...roles.props]),
    storyboardRefs: uniqueStrings(roles.storyboard),
  };
}

function withoutValues(values, removed) {
  const removal = new Set(removed);
  return uniqueStrings((Array.isArray(values) ? values : []).filter((value) => !removal.has(clean(value))));
}

function bindReferenceKitToShot(shot = {}, kit = {}) {
  const normalizedKit = normalizeReferenceKit(kit);
  const previous = shot.referenceKitSnapshot || (shot.referenceKitId ? referenceKitSnapshot(kit) : null);
  const oldRefs = referenceIdsFromSnapshot(previous || {});
  const nextRefs = referenceIdsFromSnapshot(normalizedKit);
  return {
    ...shot,
    refs: uniqueStrings([
      ...withoutValues(shot.refs, oldRefs.refs),
      ...nextRefs.refs,
    ]),
    storyboardRefs: uniqueStrings([
      ...withoutValues(shot.storyboardRefs, oldRefs.storyboardRefs),
      ...nextRefs.storyboardRefs,
    ]),
    referenceKitId: normalizedKit.id,
    referenceKitName: normalizedKit.name,
    referenceKitVersion: normalizedKit.version,
    referenceKitSnapshot: referenceKitSnapshot(normalizedKit),
  };
}

function unbindReferenceKitFromShot(shot = {}, kit = null) {
  const snapshot = shot.referenceKitSnapshot || (kit ? referenceKitSnapshot(kit) : null);
  const bound = referenceIdsFromSnapshot(snapshot || {});
  const next = { ...shot };
  next.refs = withoutValues(shot.refs, bound.refs);
  next.storyboardRefs = withoutValues(shot.storyboardRefs, bound.storyboardRefs);
  delete next.referenceKitId;
  delete next.referenceKitName;
  delete next.referenceKitVersion;
  delete next.referenceKitSnapshot;
  return next;
}

module.exports = {
  ROLE_KEYS,
  DEFAULT_POLICY,
  normalizeReferenceRoles,
  normalizeReferenceKit,
  normalizeReferencePolicy,
  referenceKitVersion,
  referenceKitSnapshot,
  bindReferenceKitToShot,
  unbindReferenceKitFromShot,
};
