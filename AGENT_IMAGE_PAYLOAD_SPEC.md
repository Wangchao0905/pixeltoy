# 修：对话图片让请求体翻倍，大图必挂网关

## 已实测的事实（别重复验证，直接用）

**1. 我引入了 base64 翻倍。**
`superPixelConversationImages()`（public/app.js，`function superPixelConversationImages`）
原样送 `image.url`。对本地拖入的图那就是完整 data URL——**而同一份 base64 已经在
`messages[].content[].image_url.url` 里送过一遍**（`superPixelMessagePayload`）。请求体翻倍。

**2. 网关对大 body 不稳，失败率随体积上升（生产实测，每档跑 3 次）：**
- 22KB 单份 → 成功 3/3
- 44KB 双份 → 成功 3/3
- 116KB 双份 → 成功 **1/3**（两次 HTTP 502）
- 596KB → 0/1（响应 0 字节）

502 来自 apikey.fun 网关本身（`<title>apikey.fun | 502: Bad gateway</title>`），
不是我们的服务。

**3. 因此这功能在真实场景基本必挂。** 前端允许单张 8MB、最多 8 张
（`SUPER_PIXEL_MAX_ATTACHMENTS`）。一张普通手机照片 3-5MB → base64 约 4-7MB，
翻倍后 8-14MB，远超网关能扛的量级。

**4. 关键区别（决定架构，别搞反）：**
- **给模型看的那份可以大幅缩图**——它只需要看懂画面
- **给视频当参考图的那份必须保持原分辨率**——缩了会直接拉低成片的商品还原度

## 目标架构：拖入即上传，请求体里不再有 base64

1. 用户拖入/选图时就把**原图**落盘换成稳定公网 URL
   （复用 `createPublicCanvasAsset`，或复用现有 `POST /api/canvas/video-assets` 的同类图片路径；
   `assetUrlToReferenceUrl` 已有 data URL→公网 URL 的成熟实现，别另写一套）
2. `conversationImages` 只带**短 URL**，不带 base64
3. 给模型看的那份：**先测网关能不能直接吃 http 图片 URL**
   - 能 → `messages` 里直接放 http URL，请求体里彻底没有 base64（最优）
   - 不能 → `messages` 里放**缩图后**的 data URL（长边 ≤1024，JPEG q80）
   - 这一步我没验完，你自己验：用 `.env.local` 里的 `ASSET_ANALYZER_API_KEY`
     打 `https://apikey.fun/v1/chat/completions`，content 里放
     `{type:"image_url",image_url:{url:"<公网图URL>"}}`，看是否返回正常描述
4. 参考图仍走**原图的稳定 URL**，不受缩图影响

## 硬性要求

- **原图分辨率不得因为「给模型看」而降级**——参考图必须是原图
- 上传失败要明确提示用户并阻止发送，不许静默退回内联 base64（否则又撞 502）
- Ask 模式也共用附件，改动不得破坏 Ask 现有行为（有测试守）
- 出片仍必须走确认卡，`confirming` 不得跳过（有断言守，别改那条测试）
- 缓存戳断言已改成「两个戳存在且一致」，**不要再写死字面值**
  （`?v=` 是并发协作必冲突行，一小时内被 bump 了四次）
- 扩测试：无 base64 泄漏进请求体、缩图不影响参考图原分辨率、上传失败阻止发送
- 新测试注册进 package.json 的 test 链
- bump `app.js?v=` 与 `styles.css?v=`（两个必须同步）
- **验证看 `npm test` 的退出码，不是看打印 passed**（本仓库有过整类断言空转的先例）
- 仓库有并发会话在推提交，只改与本任务相关的文件，别碰 `public/canvas.js`
