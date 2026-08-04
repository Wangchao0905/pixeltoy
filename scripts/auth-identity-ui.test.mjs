import assert from "node:assert/strict";
import fs from "node:fs";

const modal = fs.readFileSync(new URL("../public/auth-modal.js", import.meta.url), "utf8");
const standalone = fs.readFileSync(new URL("../public/auth.js", import.meta.url), "utf8");

for (const source of [modal, standalone]) {
  assert.match(source, /identityField\.type\s*=\s*mode\s*===\s*["']register["']\s*\?\s*["']email["']\s*:\s*["']text["']/);
  assert.match(source, /identityField\.placeholder\s*=\s*mode\s*===\s*["']register["']/);
}

console.log("auth-identity-ui: login accepts usernames while registration keeps email validation");
