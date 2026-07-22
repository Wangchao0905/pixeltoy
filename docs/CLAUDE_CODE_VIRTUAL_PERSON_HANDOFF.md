# Claude Code 交接：方舟私域虚拟人像

更新时间：2026-07-18

这份文档用于把 Pixel Toys 中已完成的方舟私域虚拟人像流程交给 Claude Code。工作区是共享的，不需要复制代码或密钥；Claude Code 进入仓库后先阅读本文，再查看下面列出的实现文件和测试。

## 已完成的用户流程

1. 独立画布中生成的 AI 写实人物图片，可以通过图片右键菜单选择“认证为私域虚拟人像”。
2. 认证请求先把本地图转换成公网 HTTPS，再调用方舟素材接口 `CreateAsset`。
3. 返回 `assetId` 后，前端保存 `asset://<assetId>`，并轮询 `GetAsset` 直到 `active` 或 `failed`。
4. 认证成功后，图片右上角显示完整的蓝色圆形对号；认证状态写入画布状态，刷新后保留。
5. 带有 AI 生成人物/写实元数据的素材拖入画布或节点时会自动触发认证；已经 `processing` 或 `active` 的素材不会重复提交。普通场景、道具和未标记为人物的手动图片不会自动认证。
6. 视频节点连接已认证人物图片后，Seedance 2.0、2.0 Fast、2.0 Mini 使用方舟 `asset://` 引用；不会把本地预览 URL 当作人物素材提交。

## 模型边界

- `seedance-2-0`、`seedance-2-0-fast`、`seedance-2-0-mini`：方舟人物素材绑定流程。
- `seedance-2-0-person-reference`：保留原有 Gravitex 人物参考素材库流程，不读取 `arkPersonAsset`。
- `seedance-2-0-byteplus`：走 BytePlus ModelArk，不改变上述人物参考模型边界。
- 不要根据“图片看起来像人物”自动切换模型，也不要把普通写实图片自动改成 `person-reference`。

## 画布状态字段

每个素材的方舟绑定独立保存在 `arkPersonAsset`，不能与 Gravitex 的 `assetUrl`、`validationStatus` 混用：

```js
arkPersonAsset: {
  enabled: true,
  assetId: "...",
  assetUrl: "asset://...",
  groupId: "...",
  status: "processing" | "active" | "failed",
  boundAt: "ISO timestamp",
  error: ""
}
```

只有 `status === "active"` 且 `assetUrl` 匹配 `asset://...` 才算认证完成。

## 服务端入口和配置

- `POST /api/canvas/ark-virtual-person`：提交图片认证/入库。
- `GET /api/canvas/ark-virtual-person?assetId=...`：查询认证状态。
- `POST /api/canvas/video-generations`：普通画布视频生成；模型和人物绑定决定 provider。
- `POST /api/canvas/video-generations/preview-payload`：只预览请求 payload，不提交视频任务。

服务端实现集中在 `server.js`：

- `arkVirtualPersonConfig()`：读取方舟配置。
- `buildArkAssetOpenApiRequest()`：签名方舟 OpenAPI 请求。
- `createArkVirtualPersonAsset()` / `getArkVirtualPersonAsset()`：创建和查询素材。
- `canvasVideoProviderForBody()`：按模型和原始素材绑定选择 Ark/Gravitex/BytePlus。
- `assertArkPersonAssetsReady()`：阻止启用但没有合法 `asset://` 的人物素材提交。
- `buildSeedanceGenerationPayload()`：对普通/Fast/Mini 使用 `asset://` 人物素材并处理帧控制。

只配置环境变量名，不把值写入仓库：

```text
ARK_ASSETS_ACCESS_KEY_ID
ARK_ASSETS_SECRET_ACCESS_KEY
ARK_VIRTUAL_PERSON_GROUP_ID
ARK_ASSETS_REGION                 # 默认 cn-beijing
ARK_ASSETS_PROJECT_NAME           # 默认 default
ARK_ASSETS_ENDPOINT               # 默认 https://ark.cn-beijing.volcengineapi.com
```

图片转公网 HTTPS 依赖现有对象存储配置：`PUBLIC_ASSET_*`。不要在交接、日志或提交中输出 AK/SK。

## 前端实现位置

- `public/canvas.html`：右键菜单、认证 badge、视频节点方舟人物素材面板、首尾帧控件。
- `public/canvas.js`：
  - `arkPersonAssetUrl()` / `isArkVirtualPersonCertified()`：认证判定。
  - `certifyArkVirtualPersonAsset()` / `pollArkVirtualPersonAsset()`：认证和轮询。
  - `autoCertifyCanvasGeneratedAsset()`：兼容历史函数名，实际对拖入画布的 AI 生成人物/写实素材自动认证。
  - 视频提交前校验人物绑定、首尾帧和参考图数量。
- `public/canvas.css`：蓝色认证对号位于图片右上角，使用正向 inset，不使用负 top，避免遮挡或被裁切。

## 回归测试

先运行这些测试，不调用真实方舟或视频生成接口：

```bash
node scripts/canvas-ark-virtual-person.test.js
node scripts/canvas-ark-virtual-person-ui.test.mjs
node scripts/canvas-ark-virtual-person-auto-drop.test.mjs
node scripts/canvas-ark-video.test.js
node scripts/canvas-ark-video-ui.test.mjs
```

测试覆盖：签名请求、响应状态归一化、`asset://` 持久化、右键入口、蓝色 badge、自动拖入认证、三种 Ark 模型路由、人物参考模型不误走 Ark、首尾帧和参考图上限。

## 当前并行修复注意事项

项目工作流的批量视频生成与独立画布认证是两条链路，不能直接把 `arkPersonAsset` 绑定逻辑复制到项目队列。项目批量链路使用 `prepareBatchVideoReferences()` 做参考图预检：人物参考模型验证素材库 `active/asset://`，普通 Ark 模型确保稳定公网 HTTPS。批量队列必须在参考图缺失或验证失败时停止，禁止静默删掉 refs 后提交视频。
