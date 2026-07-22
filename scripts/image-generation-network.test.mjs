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
if (!server.includes('require("node:dns")') || !server.includes('dns.setDefaultResultOrder("ipv4first")')) {
  throw new Error("server must prefer IPv4 for outbound provider requests");
}

console.log("image generation network routing test passed");
