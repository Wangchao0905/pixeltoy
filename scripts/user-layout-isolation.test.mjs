import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

assert.match(app, /function layoutStorageKey\(key, user = null\)/);
assert.match(app, /user\?\.id \|\| user\?\.username \|\| "anonymous"/);
assert.match(app, /const initialWorkspaceMode = "image";/);
assert.doesNotMatch(app, /const storedWorkspaceMode = localStorage\.getItem\(WORKSPACE_MODE_KEY\)/);
assert.match(app, /restoreWorkspacePreferences\(state\.authUser\)/);
assert.match(app, /localStorage\.setItem\(layoutStorageKey\(WORKSPACE_MODE_KEY, state\.authUser\), nextMode\)/);
assert.match(app, /localStorage\.setItem\(layoutStorageKey\(STUDIO_TAB_KEY, state\.authUser\), nextTab\)/);
assert.match(app, /localStorage\.setItem\(layoutStorageKey\(WORKSPACE_SCALE_KEY, state\.authUser\), String\(state\.workspaceScale\)\)/);
assert.match(app, /return layoutStorageKey\(`pixelToys\.windowLayout\./);
assert.match(app, /localStorage\.setItem\(layoutStorageKey\(WINDOW_Z_KEY, state\.authUser\)/);
assert.match(app, /clearLegacyLayoutPreferences\(\)/);

console.log("user layout isolation tests passed");
