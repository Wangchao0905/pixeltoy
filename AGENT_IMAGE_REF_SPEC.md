# 对话图片参与出图/出片（图片句柄机制）

## 症结不在存储，在模型没有可引用的句柄

后端**已经能吃 data URL**：`assetUrlToReferenceUrl`（server.js:~10850）见到
`data:image/` 会调 `createPublicCanvasAsset` 落盘成稳定公网 URL，视频构建路径
（server.js:11091）早就在调它。

真正的缺口是三处：
1. `superPixelAgentSystemPrompt` **完全没提对话里有哪些图**
2. `generate_video.firstFrameUrl` / `generate_image.referenceImages` 要模型**自己编一个 URL**
3. Agent 自己出的图，工具结果只回 `已提交出图任务 taskId=xxx`（server.js:20795），
   模型永远不知道最终 URL，没法「先画再拍」

## 已确认的通道形态

- **参考图通道（本次采用）**：视频请求体 `assets: [{url, name}]`，上限 9 张
  （`SEEDANCE_MAX_IMAGE_REFERENCES`）。`resolveSeedanceImageReferences` 逐张过
  `assetUrlToReferenceUrl`，并生成 `@图片N` 供提示词引用。
- **画布路径无素材库 active 门槛**：`canvasVideoAssetSubmitUrl` 接受裸 `{url}`。
  （记忆里「参考图需素材库 active」那条是**项目**视频路径的限制，Super Pixel
  确认走的是画布路由 `POST /api/canvas/video-generations`，不受影响。）

## 用户已定的两条

- **用参考图通道，不锁首帧**：模型自由设计镜头运动，商品借形象
- **支持连锁**：Agent 自己生成的图也能当出片素材

## 机制：给对话图片发短句柄

请求体新增 `conversationImages: [{url, name, source}]`，由前端汇总三类来源：
本地拖入（data URL）、资产库（http/asset:// URL）、**已完成的出图卡片**（稳定 URL）。

后端 agent 模式下：
1. 按顺序分配句柄 `image_1` / `image_2` …，建 handle→url 映射（单次请求内有效）
2. 句柄清单注入 agent 系统提示词，例：
   `image_1（用户上传：商品图.png）` / `image_2（你生成的图：雪山黎明）`
3. 工具参数改为吃句柄：
   - `generate_video.referenceImages: string[]`（句柄或 URL，最多 9）
   - `generate_image.referenceImages` 同样接受句柄
   - 保留 `firstFrameUrl` 但不在提示词里推荐（用户选了参考图通道）
4. **工具执行时就把 data URL 落盘**成稳定 `/public-assets/` URL
   （复用 `createPublicCanvasAsset`），避免 8MB base64 在前后端来回搬
5. `toolConfirm` 事件带上已解析的参考图 URL + 缩略图，确认卡直接显示"参考图：[缩略图]"
6. 前端确认 → `POST /api/canvas/video-generations`，`assets: [{url, name}]`

## 连锁怎么实现（不引入服务端异步等待）

出图卡片轮询到 `completed` 时，前端把最终 URL 记在卡片上。下一轮提交时该卡片
自动进入 `conversationImages` → 拿到句柄 → 模型可引用。

好处：服务端无需挂起等待图片完成，也不必持久化任务态。代价是"先画再拍"要跨一轮
对话（图没出完时模型引用不到），这是可接受的——用户本来也要看到图才决定拍不拍。

## 硬性要求

- Ask 模式请求体与行为**不得改变**（现有测试守着）
- 出片仍必须走确认卡，`confirming` 状态不得跳过（现有断言守着，别改）
- 句柄解析失败要明确报错喂回模型，不能静默丢图后假装成功
- 新增测试注册进 `package.json` 的 test 链
- `app.js?v=` 和 `styles.css?v=` 缓存戳必须 bump
- 验证时看 `npm test` 的**退出码**，不是看打印 passed
