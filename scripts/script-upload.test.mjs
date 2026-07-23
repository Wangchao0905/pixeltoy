import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(html, /id="workflowScriptUpload"[^>]*accept="[^"]*\.txt[^\"]*\.docx/, "workflow script upload must accept TXT and DOCX");
assert.match(html, /label class="upload-pill" for="workflowScriptUpload">上传剧本<\//, "workflow script upload must expose an upload button");
assert.match(html, /id="workflowScriptUploadName"/, "workflow script upload must show the selected filename");
assert.match(app, /async function readScriptUpload\(file\)/, "script uploads must use a shared reader");
assert.match(app, /await api\("\/api\/extract-script"/, "DOCX uploads must use the existing extraction endpoint");
assert.match(app, /textareaSelector: "#scriptText"/, "workflow uploads must populate the current script editor");
assert.match(server, /url\.pathname === "\/api\/extract-script"/, "server must retain the DOCX extraction endpoint");

console.log("script upload UI tests passed.");
