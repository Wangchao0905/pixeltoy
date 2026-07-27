const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function compact(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeRecord(input = {}, { userId = "" } = {}) {
  const now = new Date().toISOString();
  const url = compact(input.url || input.publicUrl || input.previewUrl, 4000);
  if (!url) throw new Error("素材库资产缺少可访问地址");
  const id = compact(input.id, 120) || `lib_${crypto.randomUUID()}`;
  return {
    id,
    ownerUserId: compact(input.ownerUserId || userId, 160),
    teamId: compact(input.teamId || input.sharedTeamId, 160),
    name: compact(input.name || input.assetName || "未命名素材", 160),
    type: compact(input.type || "image", 40),
    url,
    previewUrl: compact(input.previewUrl || url, 4000),
    localUrl: compact(input.localUrl, 4000),
    source: compact(input.source || "manual", 80),
    prompt: compact(input.prompt, 4000),
    ratio: compact(input.ratio, 20),
    resolution: compact(input.resolution, 20),
    assetStylePreset: compact(input.assetStylePreset || input.stylePreset, 80),
    assetStyleLabel: compact(input.assetStyleLabel || input.styleLabel, 120),
    generationMode: compact(input.generationMode || input.generation_mode, 80),
    verificationType: compact(input.verificationType || input.verification_type, 40),
    aiGenerated: input.aiGenerated === true,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    createdAt: compact(input.createdAt, 80) || now,
    updatedAt: now,
  };
}

function createAssetLibrary({ filePath, now = () => new Date() } = {}) {
  if (!filePath) throw new Error("asset library filePath is required");

  function readStore() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { assets: Array.isArray(parsed?.assets) ? parsed.assets : [] };
    } catch {
      return { assets: [] };
    }
  }

  function writeStore(store) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  function list({ userId = "", teamId = "", search = "", limit = 100 } = {}) {
    const query = compact(search, 120).toLowerCase();
    const max = Math.max(1, Math.min(500, Number(limit) || 100));
    return readStore().assets
      .filter((asset) => !userId
        || (asset.teamId ? !!teamId && asset.teamId === teamId : asset.ownerUserId === userId))
      .filter((asset) => !query || `${asset.name} ${asset.prompt} ${asset.source} ${asset.metadata?.sourceProjectName || ""}`.toLowerCase().includes(query))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, max);
  }

  function get(id, { userId = "", teamId = "" } = {}) {
    const cleanId = compact(id, 120);
    return readStore().assets.find(
      (asset) => asset.id === cleanId && (!userId
        || (asset.teamId ? !!teamId && asset.teamId === teamId : asset.ownerUserId === userId)),
    ) || null;
  }

  function upsertMany(inputs = [], { userId = "" } = {}) {
    const store = readStore();
    const results = [];
    for (const input of Array.isArray(inputs) ? inputs : []) {
      const normalized = normalizeRecord(input, { userId });
      const ownerUserId = normalized.ownerUserId || compact(userId, 160);
      if (!ownerUserId) throw new Error("素材库资产缺少所属用户");
      normalized.ownerUserId = ownerUserId;
      const existingIndex = store.assets.findIndex((asset) => asset.id === normalized.id && asset.ownerUserId === ownerUserId);
      if (existingIndex >= 0) {
        normalized.createdAt = store.assets[existingIndex].createdAt || normalized.createdAt;
        store.assets[existingIndex] = { ...store.assets[existingIndex], ...normalized, updatedAt: now().toISOString() };
        results.push(store.assets[existingIndex]);
      } else {
        store.assets.push(normalized);
        results.push(normalized);
      }
    }
    if (!results.length) return results;
    writeStore(store);
    return results;
  }

  function upsert(input = {}, options = {}) {
    return upsertMany([input], options)[0];
  }

  function remove(id, { userId = "" } = {}) {
    const store = readStore();
    const index = store.assets.findIndex((asset) => asset.id === compact(id, 120) && (!userId || asset.ownerUserId === userId));
    if (index < 0) return false;
    store.assets.splice(index, 1);
    writeStore(store);
    return true;
  }

  return { list, get, upsert, upsertMany, remove };
}

module.exports = { createAssetLibrary, normalizeRecord };
