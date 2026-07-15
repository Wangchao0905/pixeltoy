const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function resourceVersion(resource) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(resource))).digest("hex");
}

function createReference({
  sourceTeamId,
  sourceProjectId,
  sourceResourceType,
  sourceResourceId,
  snapshot,
  versionPayload = snapshot,
  referencedByUserId,
  now = new Date(),
  generateId = () => `ref_${crypto.randomUUID()}`,
}) {
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

function copyReferenceFileSnapshot({ sourceFile, destinationDir, referenceId }) {
  const source = path.resolve(sourceFile || "");
  if (!sourceFile || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error("来源资源文件不可用");
  fs.mkdirSync(destinationDir, { recursive: true });
  const extension = path.extname(source).toLowerCase() || ".bin";
  const safeId = String(referenceId || "reference").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 160) || "reference";
  const copiedFile = path.join(destinationDir, `${safeId}${extension}`);
  const temporary = `${copiedFile}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.copyFileSync(source, temporary);
  fs.renameSync(temporary, copiedFile);
  return { copiedFile };
}

module.exports = { resourceVersion, createReference, referenceStatus, updateReference, copyReferenceFileSnapshot };
