import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const imageGen = fs.readFileSync(path.join(root, "scripts/vendor/image-gen.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

function extractAsyncFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  if (start < 0) throw new Error(`missing async ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated async ${name}`);
}

if (!imageGen.includes('require("node:dns")') || !imageGen.includes('dns.setDefaultResultOrder("ipv4first")')) {
  throw new Error("image-gen child must prefer IPv4 for provider requests");
}
if (!imageGen.includes('partial_image_b64') || !imageGen.includes("const finalEvent = parseFrame(buffer)")) {
  throw new Error("image-gen child must parse partial image fields and unterminated final SSE frames");
}
if (!imageGen.includes("let lastPartialImages = []") || !imageGen.includes("partial: true")) {
  throw new Error("image-gen child must keep the last partial image when the final SSE event is missing");
}
if (!imageGen.includes('async function* readSseJson(response, timeoutSeconds = 0)') || !imageGen.includes('new UserError("request_timeout", "接口响应超时"') || !imageGen.includes("readImageResponse(activeRequest.response, timeout)")) {
  throw new Error("an SSE response that stalls after its headers must surface as a bounded upstream timeout");
}
if (!server.includes('require("node:dns")') || !server.includes('dns.setDefaultResultOrder("ipv4first")')) {
  throw new Error("server must prefer IPv4 for outbound provider requests");
}
if (!server.includes('PIXEL_TOYS_IMAGE_CONCURRENCY || "4"') || !server.includes("enqueueCanvasImageJob")) {
  throw new Error("canvas image jobs must preserve four-way concurrency behind a bounded queue");
}
if (!imageGen.includes('Accept: "application/json"') || !imageGen.includes("stream: false")) {
  throw new Error("text image generation must support the standard non-streaming JSON response");
}
if (!imageGen.includes("function isXibApiGateway") || !imageGen.includes("function buildXibApiChatUrl") || !imageGen.includes('`${base}/v1/chat/completions`') || !imageGen.includes('messages: [{ role: "user", content: prompt }]') || !imageGen.includes("temperature: 0.7")) {
  throw new Error("xibapi image generation must use the documented chat completions request contract");
}
if (!imageGen.includes('isXibApiGateway(args["base-url"]) || !shouldFallbackToResponses(error)')) {
  throw new Error("xibapi image errors must not fall back to the Responses image route");
}
if (!imageGen.includes("return image;") || !imageGen.includes('Accept: "text/event-stream"')) {
  throw new Error("reference image generation must pass public HTTPS URLs through the streaming Responses request");
}
if (!server.includes("const referenceRecords = await Promise.all") || !server.includes("localAssetFileToPublicUrl(providerLocalPath")) {
  throw new Error("canvas reference images must be normalized and publicized before the upstream image request");
}
if (/providerLocalPath === localPath[\s\S]{0,240}return \{ input: source, localPath \}/.test(server)) {
  throw new Error("canvas reference images must not bypass first-party publicization with the original remote URL");
}
const referenceContext = {};
vm.createContext(referenceContext);
vm.runInContext(`${extractAsyncFunction(imageGen, "imageToInputUrl")}; globalThis.imageToInputUrl = imageToInputUrl;`, referenceContext);
const publicReference = "https://cdn.example.test/pixel-toys/reference.png";
assert.equal(await referenceContext.imageToInputUrl(publicReference), publicReference, "public references must not be converted to data URLs");
if (!imageGen.includes("function buildTextResponsesRequest") || !imageGen.includes("function shouldFallbackToResponses")) {
  throw new Error("text image generation must fall back to the Responses image tool when the direct route is rejected");
}
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}
const fallbackContext = {};
vm.createContext(fallbackContext);
vm.runInContext(`${extractFunction(imageGen, "shouldFallbackToResponses")}; globalThis.shouldFallbackToResponses = shouldFallbackToResponses;`, fallbackContext);
if (!fallbackContext.shouldFallbackToResponses({ detail: { status: 503, body: '{"error":{"message":"No available compatible accounts"}}' } })) {
  throw new Error("503 no-account text generation failures must fall back to the Responses image tool");
}
if (!fallbackContext.shouldFallbackToResponses({ detail: { status: 502, body: "Bad Gateway" } })) {
  throw new Error("502 gateway failures must fall back to the Responses image tool");
}
if (!fallbackContext.shouldFallbackToResponses({ detail: { status: 504, body: "Gateway Timeout" } })) {
  throw new Error("504 gateway failures must fall back to the Responses image tool");
}
if (fallbackContext.shouldFallbackToResponses({ detail: { status: 503, body: '{"error":{"message":"service temporarily unavailable"}}' } })) {
  throw new Error("generic 503 failures must not trigger an unbounded second generation route");
}
if (!server.includes('--orchestration-model') || !server.includes("const detail = parseImageGenFailure(text)")) {
  throw new Error("image generation failures must retain the orchestration model and upstream HTTP details");
}

console.log("image generation network routing test passed");
