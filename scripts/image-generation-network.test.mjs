import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const imageGen = fs.readFileSync(path.join(root, "scripts/vendor/image-gen.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

if (!imageGen.includes('require("node:dns")') || !imageGen.includes('dns.setDefaultResultOrder("ipv4first")')) {
  throw new Error("image-gen child must prefer IPv4 for provider requests");
}
if (!imageGen.includes('partial_image_b64') || !imageGen.includes("const finalEvent = parseFrame(buffer)")) {
  throw new Error("image-gen child must parse partial image fields and unterminated final SSE frames");
}
if (!imageGen.includes("let lastPartialImages = []") || !imageGen.includes("partial: true")) {
  throw new Error("image-gen child must keep the last partial image when the final SSE event is missing");
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
if (!imageGen.includes("function buildTextResponsesRequest") || !imageGen.includes("function shouldFallbackToResponses")) {
  throw new Error("text image generation must fall back to the Responses image tool when the direct route is rejected");
}
if (!server.includes('--orchestration-model') || !server.includes("const detail = parseImageGenFailure(text)")) {
  throw new Error("image generation failures must retain the orchestration model and upstream HTTP details");
}

console.log("image generation network routing test passed");
