import assert from "node:assert/strict";
import { createChatcutAgent } from "../server/chatcut-agent.js";

const disabled = createChatcutAgent({ env: {} }).diagnose();
assert.equal(disabled.enabled, false);
assert.equal(disabled.mode, "disabled");
assert.match(disabled.reason, /CHATCUT_AGENT_URL|CHATCUT_AGENT_COMMAND/);

const httpMode = createChatcutAgent({
  env: {
    CHATCUT_AGENT_URL: "https://agent.example.test/v1/chatcut/jobs",
    CHATCUT_AGENT_TOKEN: "secret-token",
  },
}).diagnose();
assert.equal(httpMode.enabled, true);
assert.equal(httpMode.mode, "http");
assert.doesNotMatch(JSON.stringify(httpMode), /secret-token/);

const commandMode = createChatcutAgent({
  env: { CHATCUT_AGENT_COMMAND: "/opt/chatcut-agent/run" },
}).diagnose();
assert.equal(commandMode.enabled, true);
assert.equal(commandMode.mode, "command");

let captured = null;
const agent = createChatcutAgent({
  env: {
    CHATCUT_AGENT_URL: "https://agent.example.test/v1/chatcut/jobs",
    CHATCUT_AGENT_TOKEN: "internal-token",
  },
  fetch: async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, exportPath: "12_chatcut/exports/E01.mp4" }),
    };
  },
});
const result = await agent.run(
  { id: "job-1", type: "chatcut-edit", sourceDigest: "digest-1", packageDir: "12_chatcut", manifestFile: "12_chatcut/assembly_manifest.json", editBriefFile: "12_chatcut/edit_brief.md", project: { id: "p1" } },
  { packagePath: "/srv/p1/12_chatcut", manifestPath: "/srv/p1/12_chatcut/assembly_manifest.json", editBriefPath: "/srv/p1/12_chatcut/edit_brief.md", outputDir: "/srv/p1/12_chatcut/exports" },
);
assert.equal(result.exportPath, "12_chatcut/exports/E01.mp4");
assert.equal(captured.url, "https://agent.example.test/v1/chatcut/jobs");
assert.equal(captured.options.headers.Authorization, "Bearer internal-token");
assert.doesNotMatch(captured.options.body, /internal-token/);

console.log("chatcut agent tests passed");
