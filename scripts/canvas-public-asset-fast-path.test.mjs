import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "server.js"), "utf8");

const route = source.slice(source.indexOf("async function createPublicCanvasAsset"), source.indexOf("function publicAssetLibraryRecord"));
assert.match(source, /DEFAULT_CANVAS_PUBLIC_ASSET_BASE_URL = "https:\/\/pixeltoy\.cn"/, "画布图片必须有本站正式 HTTPS 地址作为默认参考域名");
assert.match(source, /function canvasPublicAssetBaseUrl\(\)[\s\S]*DEFAULT_CANVAS_PUBLIC_ASSET_BASE_URL/, "未配置通用素材域名时必须回退本站 HTTPS 地址");
assert.match(source, /function publicAssetUrlForLocalUrl\([\s\S]*\$\{origin\}\$\{local\}/, "本地 public-assets 必须可直接转换成公网 HTTPS 地址");
assert.match(route, /queuePublicAssetUpload\(/, "已有站内 HTTPS 地址时，对象存储写入必须转入后台");
assert.doesNotMatch(route, /await uploadPublicAssetToS3\(/, "公共素材请求不能同步等待对象存储上传");
assert.match(source, /PUBLIC_ASSET_S3_UPLOAD_TIMEOUT_MS/, "对象存储后台上传必须有独立时限");

console.log("canvas public asset fast path tests passed");
