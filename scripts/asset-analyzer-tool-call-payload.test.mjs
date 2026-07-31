// 模型答案可能不在 message.content，而在 tool_calls 里。
//
// 病史（2026-07-31，咕咚第二集只解析出 2 个资产）：网关上的 claude-opus-4-8 解析资产文档时，
// 反复返回 finish_reason=tool_calls、content=""、tool_calls[0].function = {
//   name: "Write",
//   arguments: '{}{"file_path":"/tmp/props.json","content":"{\\"props\\":[...]}"}'
// } —— 模型把答案当成"要写进文件的内容"，而不是直接回话。
// 服务端只读 content，JSON.parse("") 抛 "Unexpected end of JSON input"，
// 该类资产判为失败 → 一路降级 opus→sonnet→haiku → 三类全失败 → 退回本地粗规则，
// 产出「只有 1 人物 1 场景」这种残缺清单。
// 生产实测：修复前 1/3 类成功，修复后 3/3。
// 注意 arguments 前面那个多余的 "{}" 是网关拼接产生的，必须容忍。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

// 花括号计数在这里不可用：函数体内含字符串字面量 "{" 和 "}"，会数错。
// 用明确的下一个顶层声明作为结束锚点。
function sliceBetween(source, startSig, endSig) {
  const start = source.indexOf(startSig);
  assert.notEqual(start, -1, `missing: ${startSig}`);
  const end = source.indexOf(endSig, start);
  assert.ok(end > start, `missing end anchor for ${startSig}`);
  return source.slice(start, end);
}

const context = { JSON, String, Array, Object };
vm.createContext(context);
vm.runInContext(sliceBetween(server, "function stripJsonFence(", "\nfunction assetAuditSystemPrompt("), context, { filename: "server.js" });
vm.runInContext(sliceBetween(server, "function jsonPayloadFromModelMessage(", "\nfunction assetAuditSystemPrompt("), context, { filename: "server.js" });

const answer = {
  world: "",
  characters: [],
  scenes: [],
  props: [{ name: "橡果小包", description: "小包" }, { name: "大铲子", description: "铲子" }],
};
const parsePayload = (message) => JSON.parse(context.stripJsonFence(context.jsonPayloadFromModelMessage(message)));

// 正常路径不能被破坏。
assert.equal(parsePayload({ content: JSON.stringify(answer) }).props.length, 2, "普通 content 必须照常解析");
assert.equal(
  parsePayload({ content: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }).props.length,
  2,
  "```json 围栏必须照常解析",
);

// 生产实测的那个形状：content 为空，答案在 Write 工具的 content 参数里，
// 且 arguments 被前置的 "{}" 污染。
const realShape = {
  content: "",
  reasoning_content: "I'm extracting the props...",
  tool_calls: [{
    function: {
      name: "Write",
      arguments: `{}${JSON.stringify({ file_path: "/tmp/props.json", content: JSON.stringify(answer) })}`,
    },
  }],
};
const recovered = parsePayload(realShape);
assert.equal(recovered.props.length, 2, "答案在 tool_calls 里时必须能取出来（这是咕咚第二集只出 2 个资产的根因）");
assert.equal(recovered.props[0].name, "橡果小包", "取出的道具内容必须完整");

// tool_calls 的 arguments 直接就是答案对象。
assert.equal(
  parsePayload({ content: "", tool_calls: [{ function: { arguments: JSON.stringify(answer) } }] }).props.length,
  2,
  "tool_calls 直接携带答案对象时也要能取出",
);

// 真的什么都没有：返回空串，让调用方给出可读原因，而不是 JSON.parse("") 抛天书。
assert.equal(context.jsonPayloadFromModelMessage({}), "", "空消息应返回空串");
assert.equal(context.jsonPayloadFromModelMessage({ content: "", tool_calls: [] }), "", "无 tool_calls 应返回空串");
// 坏数据不能抛异常——抛了就会被当成"可重试"，白白烧掉一次候选模型。
assert.equal(context.jsonPayloadFromModelMessage({ content: "", tool_calls: [{ function: { arguments: "not json" } }] }), "", "坏 arguments 不能抛");
assert.equal(context.jsonPayloadFromModelMessage({ content: "", tool_calls: [{ function: { arguments: "{broken" } }] }), "", "截断的 arguments 不能抛");

// 调用方必须用统一提取，并在空载荷时给出带 finish_reason 的可读原因。
const analyzer = server.slice(server.indexOf("async function callAssetAnalyzerModel("));
assert.match(analyzer, /jsonPayloadFromModelMessage\(message\)/, "资产解析器必须经由统一提取读响应");
assert.match(
  analyzer,
  /data\.choices\?\.\[0\]\?\.finish_reason/,
  "空载荷时必须真的从响应里读 finish_reason 写进失败原因，否则无法定位是哪种返回形状",
);
assert.doesNotMatch(
  analyzer.slice(0, analyzer.indexOf("const parsed = JSON.parse(stripJsonFence(content))")),
  /const content = data\.choices\?\.\[0\]\?\.message\?\.content \|\| ""/,
  "不能退回只读 message.content",
);

console.log("asset analyzer tool call payload tests passed");
