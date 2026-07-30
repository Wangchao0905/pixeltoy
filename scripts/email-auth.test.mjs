import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const emailAuth = require("../server/email-auth.js");

process.env.PIXEL_TOYS_EMAIL_CODE_SECRET = "test-only-email-code-secret";
assert.equal(emailAuth.normalizeEmail("  Test@Example.COM "), "test@example.com");
assert.equal(emailAuth.isValidEmail("test@example.com"), true);
assert.equal(emailAuth.isValidEmail("not-an-email"), false);

const previousSmtp = {
  host: process.env.SMTP_HOST,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM,
};
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SMTP_FROM;
assert.equal(emailAuth.configuredSmtp().configured, false);
await assert.rejects(
  emailAuth.requestEmailCode({ email: "test@example.com", purpose: "register", rateKey: "test" }),
  /SMTP/,
);
for (const [name, value] of Object.entries(previousSmtp)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

console.log("email-auth: validation, missing-config, and normalization checks passed");
