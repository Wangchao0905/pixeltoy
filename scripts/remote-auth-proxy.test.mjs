import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

assert.match(server, /PIXEL_TOYS_AUTH_REMOTE_ENABLED/);
assert.match(server, /process\.env\.NODE_ENV !== "production"/);
assert.match(server, /function handleRemoteAuthApi/);
assert.match(server, /passwordHash: ""/);
assert.match(server, /remoteAuth: true/);
assert.match(server, /bindRemoteAuthSession\(session\.id, result\.cookie\)/);

console.log("remote-auth-proxy: explicit local-only proxy and no local password hash sync");
