(function exposeWorkspaceShell(root) {
  const WORKSPACE_MODES = ["script", "image", "video", "storyboard", "assets"];
  const TOOL_MODE_MAP = {
    "short-drama": "script",
    "short-drama-workspace": "script",
    "image-generation": "image",
    "video-generation": "video",
    "production-board": "storyboard",
    "asset-library": "assets",
  };

  function normalizeWorkspaceMode(value) {
    const mode = String(value || "");
    return WORKSPACE_MODES.includes(mode) ? mode : "assets";
  }

  function workspaceModeForTool(tool) {
    return normalizeWorkspaceMode(TOOL_MODE_MAP[String(tool || "")] || "assets");
  }

  function shouldEnableExplore({ serverEnabled = false, search = "" } = {}) {
    const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    return !!serverEnabled && params.get("legacy") !== "1";
  }

  const api = { WORKSPACE_MODES, normalizeWorkspaceMode, workspaceModeForTool, shouldEnableExplore };
  root.PixelToysWorkspaceShell = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
