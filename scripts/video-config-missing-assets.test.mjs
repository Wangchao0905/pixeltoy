import assert from "node:assert/strict";
import fs from "node:fs";

// 未生成的资产不能阻塞「生成视频配置」。配置是剧本层面的产物,和图画完没画完无关。
// 缺图真正致命的地方是提交出片,那一步由 configReadiness 拦。
// 这个测试锁住两件事:配置生成侧不再抛错,提交侧的闸门仍然在。
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

// 1) 配置生成侧:两条历史上的 throw 必须已经消失。
assert.doesNotMatch(
  server,
  /throw new Error\(`视频配置引用校验失败/,
  "缺人物/场景资产图不得阻塞视频配置生成",
);
assert.doesNotMatch(
  server,
  /throw new Error\(`故事板模式尚未完成/,
  "缺 Production Board 不得阻塞视频配置生成",
);

// 2) 缺失信息必须仍然回报给用户,而不是静默吞掉。
assert.match(
  server,
  /referenceWarnings\.push\(\s*`以下故事板尚未生成或覆盖不全/,
  "缺板要进 referenceWarnings 提示",
);
assert.match(
  server,
  /以下资产图尚未生成，已从本次视频引用中排除/,
  "缺资产图要进 referenceWarnings 提示",
);

// 3) 提交出片侧的闸门必须保留:这是缺图真正致命的地方。
assert.match(server, /missing\.push\(`缺少资产图：\$\{clean\}`\)/, "configReadiness 必须仍然拦缺资产图");
assert.match(server, /个片段缺少 Production Board 绑定/, "configReadiness 必须仍然拦缺板绑定");

// 4) 结构性问题的 throw 要保留:槽位与镜头名完全对不上不是"缺图",不能放行。
assert.match(
  server,
  /throw new Error\("故事板模式未找到与当前模型导演镜头对应的故事板/,
  "槽位与镜头对不上属结构性错误,仍应阻塞",
);

// 5) 缺板时该镜头的 storyboardRefs 必须是空数组而不是 [""],否则下游会拿到假引用。
assert.match(
  server,
  /storyboardRefs: \[slot\?\.asset\?\.assetName \|\| ""\]\.filter\(Boolean\)/,
  "缺板槽位必须产出空 storyboardRefs,交给 readiness 判定",
);

console.log("video config missing assets tests passed");
