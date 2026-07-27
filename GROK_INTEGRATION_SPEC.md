# 接入 Grok：聊天 + 出图 + 出片

密钥已在生产 `.env.local` 的 `XAI_API_KEY`（`sk-` 开头）。它其实是**同一个
apikey.fun 网关**上的另一个账号，只是这个账号挂的是 grok 系模型。
base URL 仍是 `https://apikey.fun/v1`，不要直连 `api.x.ai`（不通）。

下面每一条都是我在生产实测过的，**别重新探，照着接**。

## 1. 聊天：grok-4.5

`POST /v1/chat/completions`，OpenAI 兼容。实测通过：
- **视觉**：能看图，但**只吃 data URL**。传 http 图片 URL 会被网关静默丢掉
  （返回 200 但模型答"没看到图片"）——和 [[apikey-fun-gateway-body-size]] 里
  Claude 那条坑完全一样。
- **工具调用**：`tools` 正常返回 `tool_calls`，Agent 模式可用。
- **流式**：正常 `delta.content`。注意它**额外**吐 `delta.reasoning_content`（思维链），
  现有解析（server.js:21079-21083）只读 `delta.content`，思维链不会漏到界面——
  **别去"顺手支持" reasoning_content**，那会把思维链吐给用户。

可接的型号：`grok-4.5`、`grok-4.5-latest`、`grok-4.3`。
**不要接** `grok` 裸别名——视觉请求 400。

接法：加到 `SUPER_PIXEL_GROK_MODELS`（新 Set，server.js:2247 附近），
`superPixelModelConfig()` 里回 `{ apiKey: process.env.XAI_API_KEY, kind: "grok" }`。

## 2. 出图：grok-imagine-image

`POST /v1/images/generations`，**同步返回，不用轮询**。

```json
{"model":"grok-imagine-image","prompt":"...","response_format":"b64_json"}
```

**`response_format:"b64_json"` 是必须的，不是可选优化。**
默认返回 `data[0].url` 指向 `imgen.x.ai`，而这个域名**从生产服务器（国内）完全不可达**
（实测 45 秒超时、HTTP 000）。用 b64 才能拿到图。
返回 `data[0].b64_json` + `data[0].mime_type`。

- `n` 可用（n=2 真返回 2 张）
- `size` / `aspect_ratio` 会被接受，但**我没验成生效**（取图那步被 CDN 挡住了）。
  你用 b64 拿到图后**自己量一下真实尺寸**再决定要不要暴露这两个参数——
  接受≠生效，这个坑我这轮踩了两次。
- 型号 `grok-imagine-image`（约 $0.02/张）和 `grok-imagine`（约 $0.05/张）都可用

## 3. 出片：grok-imagine-video

异步三步，全部实测通过：

1. `POST /v1/videos/generations` → `{"request_id":"..."}`
2. `GET /v1/videos/{request_id}` → `{"status":"pending|done","progress":0-100,
   "video":{"duration":8,"url":"/v1/videos/{id}/content"}}`
3. `GET /v1/videos/{request_id}/content` **带 Authorization 头** → mp4 字节流

`video.url` 是**相对路径且需要鉴权**，不是公网 URL。必须带 key 下载后落盘
（复用现有落盘逻辑），不能直接把它塞给前端。

**参考图（图生视频）——只有一种写法对：**

```json
{"model":"grok-imagine-video","prompt":"...","duration":5,
 "image":{"url":"https://公网可达的图片URL"}}
```

我按结果（比对成片首帧颜色）验了 7 种写法，只有 `image:{url:...}` 嵌套对象真生效：

| 写法 | 结果 |
|---|---|
| `image:{url}` | **✓ 生效**（首帧跟上参考图） |
| `image_url` / `first_frame_image` / `reference_image` | 提交被接受，**成片忽略参考图** |
| `image` = URL字符串 / 裸base64 / dataURL | xAI 422 拒绝 |
| `image_urls:[URL]` | 接受但忽略 |
| `grok-imagine-video-1.5` + image | 422 拒绝 |

注意参考图这里要**公网 http URL**（和聊天视觉相反，那边要 data URL）。
项目里 `assetUrlToReferenceUrl` / `/api/canvas/public-assets` 已能把 data URL
换成公网 URL，直接复用。

**已验生效的参数：** `duration`（传 5 真出 5 秒，费用同比降）、
`aspect_ratio`（默认 848×480，传 `"9:16"` 真出 480×848）。

**成本**（`cost_in_usd_ticks` × 1e-10）：8 秒约 $0.40、5 秒约 $0.25。
比 Seedance 贵不少，**别设成默认**，让用户显式选。

## 硬性要求

- 三样都要能在界面上选到：Super Pixel 模型下拉加 grok-4.5；
  出图、出片的模型选择处加对应 grok 型号
- **Agent 模式的出图/出片工具也要能用 grok 型号**——这是"同步接入"的重点，
  不是只在手动下拉里能选
- 上一轮刚做的"对话图片当参考图"链路要能走 grok 出片（用 `image:{url}`）
- 出片仍必须走确认卡，`confirming` 不得跳过（有断言守，别改那条测试）
- Ask 模式不得回归
- 缓存戳断言已改成"两个戳存在且一致"，**别写死字面值**
- 新测试注册进 package.json 的 test 链；bump 两个 `?v=`（必须同步）
- **验证看 `npm test` 退出码**，不是看打印 passed
- 仓库有并发会话在推提交，只改与本任务相关的文件
- 密钥只从 `process.env.XAI_API_KEY` 读，**不许硬编码、不许写进任何测试或日志**
