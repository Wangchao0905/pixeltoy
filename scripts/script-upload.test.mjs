import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

assert.match(html, /id="workflowScriptUpload"[^>]*accept="[^"]*\.txt[^\"]*\.docx/, "workflow script upload must accept TXT and DOCX");
assert.match(html, /<label[^>]*class="upload-pill"[^>]*for="workflowScriptUpload"[^>]*data-upload-tooltip="支持 TXT、DOCX 和 PDF"[^>]*>上传剧本<\//, "workflow script upload must expose an upload button with a format tooltip");
assert.match(html, /id="workflowScriptUploadName"/, "workflow script upload must show the selected filename");
assert.match(html, /id="assetDescriptionUpload"[^>]*accept="[^"]*\.txt[^\"]*\.docx/, "asset documents must accept TXT and DOCX");
assert.match(html, /<label[^>]*class="upload-pill"[^>]*for="assetDescriptionUpload"[^>]*data-upload-tooltip="支持 TXT、DOCX 和 PDF"[^>]*>上传资产文档<\//, "asset page must expose a document upload button");
assert.match(html, /id="assetDescriptionText"/, "asset page must expose a pasteable asset document field");
assert.match(html, /<div class="asset-description-editor-shell">\s*<textarea id="assetDescriptionText"/, "asset document input should use its compact editor shell");
assert.doesNotMatch(html, /<p class="dual-input-hint">只写人物、场景和道具的外观描述/, "asset document input should not show redundant descriptive copy");
assert.match(styles, /\.asset-description-editor-shell[\s\S]*width: min\(760px, calc\(100% - 56px\)\)/, "asset document editor should have a compact maximum width");
assert.match(styles, /\.asset-description-editor-shell #assetDescriptionText[\s\S]*font-family: var\(--ui-font\)/, "asset document editor should use the studio UI typeface");
assert.match(app, /async function readScriptUpload\(file\)/, "script uploads must use a shared reader");
assert.match(app, /await api\("\/api\/extract-script"/, "DOCX uploads must use the existing extraction endpoint");
assert.match(app, /isPdf = \/\\\.pdf\$\/i/, "PDF uploads must use the existing extraction endpoint");
assert.match(app, /textareaSelector: "#scriptText"/, "workflow uploads must populate the current script editor");
assert.match(app, /textareaSelector: "#assetDescriptionText"/, "asset document uploads must populate the asset document field");
assert.match(app, /label: "资产文档"/, "asset document uploads must use asset-specific feedback");
assert.match(server, /url\.pathname === "\/api\/extract-script"/, "server must retain the document extraction endpoint");
assert.match(server, /ext !== "\.docx" && ext !== "\.pdf"/, "server must accept PDF document extraction");

console.log("script upload UI tests passed.");
