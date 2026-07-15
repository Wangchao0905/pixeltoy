import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resourceVersion, createReference, referenceStatus, updateReference, copyReferenceFileSnapshot } = require("../server/team-references.js");

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-team-reference-"));
const sourceFile = path.join(root, "source.png");
const destinationDir = path.join(root, "destination");
fs.writeFileSync(sourceFile, "snapshot-v1");
const copied = copyReferenceFileSnapshot({ sourceFile, destinationDir, referenceId: "ref_1" });
assert.equal(fs.readFileSync(copied.copiedFile, "utf8"), "snapshot-v1");
fs.unlinkSync(sourceFile);
assert.equal(fs.readFileSync(copied.copiedFile, "utf8"), "snapshot-v1");
console.log("team reference tests passed");
