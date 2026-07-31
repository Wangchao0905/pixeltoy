import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canvas = fs.readFileSync(path.join(root, "public", "canvas.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const helper = canvas.slice(canvas.indexOf("function assetReferenceUrlById"), canvas.indexOf("function imagePreviewSig"));
const mentionMenu = canvas.slice(canvas.indexOf("function updatePromptMentionMenu"), canvas.indexOf("function insertPromptMention"));
const imageControls = canvas.slice(canvas.indexOf('if (node.kind === "image") {'), canvas.indexOf('if (node.kind !== "video") return;'));
const renderNodeAssets = canvas.slice(canvas.indexOf("function renderNodeAssets(node) {"), canvas.indexOf("function mentionTriggerForTextarea"));
const imageRefresh = canvas.slice(canvas.indexOf("function refreshImageNodeElement"), canvas.indexOf("async function pollImageNode"));

assert.match(helper, /return assetReferenceUrl\(asset\)/, "image generation must resolve connected assets through the shared reference URL policy");
assert.doesNotMatch(helper, /asset\.publicUrl \|\| asset\.url \|\| asset\.localUrl/, "image generation must not submit asset:// as a reference URL");
assert.match(canvas, /function imageReferenceAssetsForGeneration\(node\)[\s\S]*referenceAssetsForVideoNode\(node\)/, "connected assets must be included in image generation references");
assert.match(canvas, /function imageReferenceAssetsForGeneration\(node\)/, "image generation must resolve explicit @ mentions to reference assets");
assert.match(canvas, /selection\.missing\.length/, "unmatched @ image mentions must block generation instead of becoming text-only");
assert.match(mentionMenu, /\["video", "image"\]\.includes\(node\.kind\)/, "image prompts must use the shared @ reference menu");
assert.match(imageControls, /bindPromptMentionMenu\(prompt, node\)/, "image prompt input must bind @ reference interactions");
assert.match(renderNodeAssets, /node\.kind !== "video"[\s\S]*data-insert-reference/, "image reference chips must insert @ mentions");
assert.match(imageRefresh, /data-insert-reference[\s\S]*insertTextIntoPrompt/, "image reference chips must remain clickable after refresh");
const imageGenerationRoute = server.slice(server.indexOf("function createCanvasImageGeneration"), server.indexOf("function getCanvasImageGeneration"));
assert.match(imageGenerationRoute, /const referenceRecords = await Promise\.all\(requestedReferences\.map/, "image generation must prepare every requested reference before submission");
assert.match(imageGenerationRoute, /const failedReference = referenceRecords\.find\(\(record\) => record\?\.error\)/, "image generation must detect unresolved references instead of silently switching to text mode");
assert.match(imageGenerationRoute, /if \(failedReference\) throw new Error\(`参考图准备失败：/, "image generation must block submission when any reference cannot be prepared");
assert.match(imageGenerationRoute, /const providerPrompt = canvasImagePromptWithReferences\(prompt, references\.length\)/, "image generation must add an explicit visual-reference instruction after every reference has resolved");
assert.match(imageGenerationRoute, /"--prompt", providerPrompt/, "GPT Image requests must send the explicit visual-reference instruction to the image tool");
assert.match(imageGenerationRoute, /providerPrompt,/, "Seedream requests must retain the explicit visual-reference instruction separately from the user-visible prompt");
assert.match(imageGenerationRoute, /referenceImageCount: references\.length/, "image jobs must retain the resolved reference count for request diagnostics");

console.log("image reference connection tests passed");
