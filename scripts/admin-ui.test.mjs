import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const source = fs.readFileSync(path.join(root, "src/admin/AdminApp.jsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

assert.match(source, /function UsersPanel\(/, "admin users must use the operational list surface");
assert.match(source, /function UserRow\(/, "each account must have a dedicated action row");
assert.doesNotMatch(source, /function UsersTable\(/, "the user management surface must not regress to the 14-column table");
assert.match(source, /搜索姓名、账号或邀请码/, "operators must be able to find an account directly");
assert.match(source, /value=\{filter\}/, "the account list must expose a status filter");
assert.match(source, /onAction\("save-limits", user\)/, "quota editing must keep an explicit save action");
assert.match(source, /onAction\("reset-password", user\)/, "password reset must remain available from the account row");
assert.match(styles, /\.admin-user-row[\s\S]*grid-template-columns/, "account rows must have stable responsive columns");
assert.match(styles, /\.admin-models span,[\s\S]*max-width: 104px/, "model names must remain bounded instead of forcing vertical table text");
assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.admin-user-row \{ grid-template-columns: 1fr/, "account rows must collapse to one column on narrow screens");

console.log("admin UI contract ok");
