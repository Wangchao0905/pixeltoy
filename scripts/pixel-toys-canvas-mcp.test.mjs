import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const serverPath = path.join(root, "server.js");
const mcpPath = path.join(root, "scripts/pixel-toys-canvas-mcp.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(fs.existsSync(mcpPath), "Pixel Toys canvas MCP server script must exist");

const mcp = fs.readFileSync(mcpPath, "utf8");
const server = fs.readFileSync(serverPath, "utf8");

for (const toolName of [
  "canvas_get_state",
  "canvas_save_state",
  "canvas_preview_payload",
  "canvas_generate_video",
  "canvas_get_video_status",
]) {
  assert(mcp.includes(`"${toolName}"`), `MCP server must register ${toolName}`);
}

assert(mcp.includes("@modelcontextprotocol/sdk/server/mcp.js"), "MCP server must use the official MCP SDK");
assert(mcp.includes("StdioServerTransport"), "MCP server must use stdio transport for local agent hosts");
assert(mcp.includes("PIXEL_TOYS_MCP_TOKEN"), "MCP server must support PIXEL_TOYS_MCP_TOKEN forwarding");

assert(server.includes("function isAuthorizedMcpRequest"), "server must expose a narrow MCP token authorization helper");
assert(server.includes("PIXEL_TOYS_MCP_TOKEN"), "server must check PIXEL_TOYS_MCP_TOKEN");
assert(server.includes("isLocalRequest(req)"), "MCP token authorization must be limited to local requests");
assert(server.includes("if (isAuthorizedMcpRequest(req)) return true;"), "requireAuth must allow authorized local MCP requests");
