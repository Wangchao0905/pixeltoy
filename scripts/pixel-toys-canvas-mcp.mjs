#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PIXEL_TOYS_BASE_URL = (process.env.PIXEL_TOYS_BASE_URL || "http://127.0.0.1:4317").replace(/\/+$/, "");
const PIXEL_TOYS_MCP_TOKEN = process.env.PIXEL_TOYS_MCP_TOKEN || "";

function headers() {
  return {
    "Content-Type": "application/json",
    ...(PIXEL_TOYS_MCP_TOKEN ? { Authorization: `Bearer ${PIXEL_TOYS_MCP_TOKEN}` } : {}),
  };
}

async function pixelToysApi(pathname, options = {}) {
  const response = await fetch(`${PIXEL_TOYS_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `Pixel Toys API returned HTTP ${response.status}`);
  }
  return data;
}

function jsonText(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: "pixel-toys-canvas",
  version: "0.1.0",
});

server.registerTool(
  "canvas_get_state",
  {
    title: "Get canvas state",
    description: "Read the persisted Pixel Toys canvas state for a project or standalone canvas.",
    inputSchema: {
      projectId: z.string().default("standalone"),
    },
  },
  async ({ projectId }) => {
    const data = await pixelToysApi(`/api/canvas/state?projectId=${encodeURIComponent(projectId || "standalone")}`);
    return jsonText(data.state || {});
  },
);

server.registerTool(
  "canvas_save_state",
  {
    title: "Save canvas state",
    description: "Persist a complete Pixel Toys canvas state object.",
    inputSchema: {
      state: z.object({}).passthrough(),
    },
  },
  async ({ state }) => {
    const data = await pixelToysApi("/api/canvas/state", {
      method: "POST",
      body: JSON.stringify(state),
    });
    return jsonText(data.state || {});
  },
);

server.registerTool(
  "canvas_preview_payload",
  {
    title: "Preview video payload",
    description: "Build the video generation payload without submitting a video task.",
    inputSchema: {
      payload: z.object({}).passthrough(),
    },
  },
  async ({ payload }) => {
    const data = await pixelToysApi("/api/canvas/video-generations/preview-payload", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return jsonText({ provider: data.provider, payload: data.payload });
  },
);

server.registerTool(
  "canvas_generate_video",
  {
    title: "Generate canvas video",
    description: "Submit a Pixel Toys canvas video generation payload.",
    inputSchema: {
      payload: z.object({}).passthrough(),
    },
  },
  async ({ payload }) => {
    const data = await pixelToysApi("/api/canvas/video-generations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return jsonText(data.result || {});
  },
);

server.registerTool(
  "canvas_get_video_status",
  {
    title: "Get video status",
    description: "Poll a Pixel Toys canvas video generation task.",
    inputSchema: {
      taskId: z.string().min(1),
      provider: z.string().optional(),
    },
  },
  async ({ taskId, provider = "" }) => {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    const data = await pixelToysApi(`/api/canvas/video-generations/${encodeURIComponent(taskId)}${query}`);
    return jsonText(data.result || {});
  },
);

await server.connect(new StdioServerTransport());
