import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAssetLibrary } = require("../server/asset-library.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-team-library-"));
const library = createAssetLibrary({ filePath: path.join(root, "asset-library.json") });

library.upsert({ id: "private-1", name: "个人素材", url: "/public-assets/private.png" }, { userId: "u1" });
library.upsert({ id: "team-1", name: "团队素材", url: "/media?path=%2Fteam%2Fasset.png", teamId: "t1" }, { userId: "u1" });

assert.equal(library.list({ userId: "u2", teamId: "t1" }).map((asset) => asset.id).join(","), "team-1");
assert.equal(library.get("team-1", { userId: "u2", teamId: "t1" })?.name, "团队素材");
assert.equal(library.get("team-1", { userId: "u2", teamId: "t2" }), null, "other teams must not see shared assets");
assert.equal(library.get("team-1", { userId: "u1" }), null, "shared assets need an active team membership");
assert.equal(library.get("private-1", { userId: "u2", teamId: "t1" }), null, "personal assets must remain private");
assert.deepEqual(
  library.list({ userId: "u1", teamId: "t1" }).map((asset) => asset.id).sort(),
  ["private-1", "team-1"],
);
console.log("team shared asset library tests passed");
