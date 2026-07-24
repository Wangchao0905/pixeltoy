import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const source = fs.readFileSync(new URL("scripts/vendor/image-gen.js", root), "utf8");

function extractFunction(signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing function: ${signature}`);
  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing function body: ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

class UserError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const context = { UserError };
vm.createContext(context);
vm.runInContext(extractFunction("function throwIfErrorEvent("), context, { filename: "image-gen.js" });

assert.throws(
  () => context.throwIfErrorEvent({
    type: "response.completed",
    response: {
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
    },
  }),
  (error) => error.code === "api_stream_error" && /content_filter/.test(error.message),
  "an incomplete Responses event must surface its real refusal instead of becoming an empty stream",
);

assert.doesNotThrow(
  () => context.throwIfErrorEvent({ type: "response.completed", response: { status: "completed" } }),
  "a completed Responses event must remain successful",
);

console.log("image generation response tests passed");
