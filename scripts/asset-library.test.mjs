import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAssetLibrary } = require("../server/asset-library.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-asset-library-"));
const filePath = path.join(root, "asset-library.json");
const library = createAssetLibrary({ filePath, now: () => new Date("2026-07-18T00:00:00.000Z") });

const first = library.upsert({ id: "lib-1", name: "Dylan", url: "/public-assets/dylan.png", source: "image-generation", aiGenerated: true }, { userId: "u1" });
assert.equal(first.ownerUserId, "u1");
assert.equal(library.list({ userId: "u1" }).length, 1);
assert.equal(library.list({ userId: "u2" }).length, 0, "assets must not leak between users");
assert.equal(library.get("lib-1", { userId: "u1" }).url, "/public-assets/dylan.png");
assert.equal(library.get("lib-1", { userId: "u2" }), null);

library.upsert({ id: "lib-1", name: "Dylan updated", url: "/public-assets/dylan-v2.png" }, { userId: "u1" });
assert.equal(library.list({ userId: "u1" })[0].name, "Dylan updated");
assert.equal(library.remove("lib-1", { userId: "u2" }), false);
assert.equal(library.remove("lib-1", { userId: "u1" }), true);
assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
console.log("asset library store tests passed");
