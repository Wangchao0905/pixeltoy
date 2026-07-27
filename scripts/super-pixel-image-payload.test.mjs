import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

const payloadStart = app.indexOf("function superPixelMessagePayload");
const conversationStart = app.indexOf("function superPixelConversationImages");
const submitStart = app.indexOf("async function submitSuperPixelChat");
assert.ok(payloadStart >= 0 && conversationStart > payloadStart && submitStart > conversationStart, "Super Pixel 图片处理函数必须存在");
const payload = app.slice(payloadStart, conversationStart);
const conversation = app.slice(conversationStart, submitStart);
const submit = app.slice(submitStart, app.indexOf("\nfunction enhanceSuperPixelSelect", submitStart));

assert.match(app, /async function uploadSuperPixelImage\(/, "本地图片必须在加入附件前上传");
assert.match(app, /\/api\/canvas\/public-assets/, "图片上传必须复用公开素材上传接口");
assert.match(app, /SUPER_PIXEL_MODEL_IMAGE_MAX_EDGE\s*=\s*1024/, "模型缩图长边上限必须是 1024");
assert.match(app, /SUPER_PIXEL_MODEL_IMAGE_QUALITY\s*=\s*0\.8/, "模型缩图必须是 JPEG q80");
assert.match(app, /toDataURL\("image\/jpeg",\s*SUPER_PIXEL_MODEL_IMAGE_QUALITY\)/, "模型缩图必须编码为 JPEG");
assert.match(payload, /const modelUrl = String\(image\?\.modelUrl/, "模型消息必须优先使用缩图地址");
assert.ok(payload.includes("/^data:/i.test(sourceUrl)"), "没有缩图的旧 data URL 不得泄漏进模型请求");
assert.ok(conversation.includes("/^data:/i.test(url)"), "conversationImages 不得携带 base64");
assert.match(conversation, /url,\s*name:/, "参考图清单必须保留原图 URL");
assert.match(submit, /state\.superPixel\.uploading\s*\>\s*0/, "上传未完成时必须阻止发送");
assert.match(submit, /state\.superPixel\.uploadError/, "上传失败时必须阻止发送");
assert.match(app, /if \(state\.superPixel\.mode === "agent"\) requestBody\.conversationImages/, "Ask 模式不得回归 conversationImages");

console.log("super pixel image payload tests passed");
