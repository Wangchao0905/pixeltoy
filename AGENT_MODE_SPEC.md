# Super Pixel Agent 模式实施规范（前后端共用契约）

## 目标
让 Super Pixel 对话框的 Agent 模式可用，并能在对话中调用出图/出片模型。

## 三道现有硬拦（都要放开）
- `public/index.html:257` `<option value="agent" disabled>Agent（即将开放）</option>`
- `public/app.js:2728` `if (state.superPixel.mode !== "ask") return toast("Agent 模式暂未开放");`
- `server.js:20677` `if (mode !== "ask") return fail(res, 400, "Agent 模式暂未开放");`

## SSE 事件契约（前后端必须严格一致）

现有事件语义**不得改动**（Ask 模式依赖）：
```
{ delta: "文本片段" }
{ done: true }
{ error: "消息" }
```

Agent 模式新增：
```
{ toolStart:   { callId, name, args } }
{ toolCard:    { kind: "image", callId, taskId, meta: { prompt, imageModel, ratio, resolution } } }
{ toolConfirm: { kind: "video", callId, args: { prompt, videoModel, duration, ratio, firstFrameUrl } } }
{ toolResult:  { callId, name, summary } }
```

## 四个工具

### generate_image（直接执行，不需确认）
参数：`prompt`(必填)、`imageModel`(gpt-image-2|seedream-5-0-pro|seedream-5-0-lite，默认 gpt-image-2)、
`ratio`(默认 16:9)、`resolution`(1k|2k|4k，默认 1k)、`referenceImages`(可选 URL 数组，最多 4)

实现：调用现有 `createCanvasImageGeneration(body)`（server.js:12492），
拿到 `{taskId, status:"running", ...}` 后**立刻**发 `toolCard`，
喂回模型的工具结果为：`已提交出图任务 taskId=xxx，图片生成中并会自动显示在对话里。不要等待，继续回答用户。`

### generate_video（不执行，只发确认请求）
参数：`prompt`(必填)、`videoModel`(默认 seedance-2-0)、`duration`(秒，默认 5)、
`ratio`(默认 9:16)、`firstFrameUrl`(可选)

实现：**绝对不要**在服务端提交视频生成。只发 `toolConfirm` 事件，
喂回模型的工具结果为：`已向用户发出视频生成确认请求，等待用户点击确认。不要假设视频已生成。`
真正的提交由前端在用户点确认后打现有的 `POST /api/canvas/video-generations`。

### search_assets（同步）
参数：`search`(关键词)、`limit`(默认 20，上限 50)
实现：`assetLibrary.list({ userId: assetLibraryUserId(req), search, limit })`，
用 `publicAssetLibraryRecord` 映射后返回精简字段（id/name/type/url），发 `toolResult`。

### read_project（同步）
参数：`projectId`(可选，缺省用当前选中项目)、`section`(script|assets|storyboard|config|all)
实现：读 `fullProjectState` / `readAssetManifest` / `readVideoConfig`，
返回文本摘要（注意截断，单个工具结果不超过 8000 字符），发 `toolResult`。

## 工具循环规则
- 只在 `mode === "agent"` 时带 `tools` 请求上游；Ask 模式请求体完全不变
- 流式响应中 `tool_calls` 是**分片投递**的，必须按 `index` 累积拼接 `function.arguments`
- `finish_reason === "tool_calls"` 时执行工具，追加 `assistant`(带 tool_calls) + 每个 `tool` 角色消息，再请求上游下一轮
- **循环上限 5 轮**，超过则发 `{error}` 并结束
- 任一工具抛错时，把错误文本作为该工具的结果喂回模型，不要中断整个流

## 模型
`claude-sonnet-5` 网关不支持（实测 HTTP 404 "not supported by any configured account"），
从 `public/index.html` 的 `#superPixelModel` 下拉中移除该选项。
其余 5 个（claude-opus-5 / claude-haiku-4-5 / gpt-5.6-terra / gpt-5.6-sol / gpt-5.6-luna）实测均支持 tools。

## 硬性要求
- 新增测试必须注册进 `package.json` 的 `test` 链
- `public/index.html` 里 `app.js?v=` 和 `styles.css?v=` 缓存戳必须改成新值
- 全量 `npm test` 必须通过
- Ask 模式的现有行为和测试不得回归
