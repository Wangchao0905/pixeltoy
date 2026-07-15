# 独立画布方舟真人素材与首尾帧设计

## 目标

在独立画布中，让 `seedance-2-0`、`seedance-2-0-fast` 和
`seedance-2-0-mini` 使用火山方舟已认证的真人素材，并加入官方首尾帧生成。
`seedance-2-0-person-reference` 继续使用现有 Gravitex 素材组与核验流程，
不改变其界面、请求或路由。

本次不调用“录入真人形象素材”的认证、授权或入库 API。公开教程明确了认证
成功后的 `asset://<asset ID>` 使用方式，但本次没有可验证的官方 API 合同、权限
要求和回调协议。画布只绑定用户已经通过方舟认证并入库的素材。

## 范围

- 仅独立画布的普通视频生成请求。
- 不修改项目视频生成链路、项目素材准备流程或批量项目队列。
- 不触发真实视频生成，也不增加第三方人脸识别或认证服务。

## 用户流程

1. 用户在方舟完成真人认证、授权和素材入库，取得素材 `asset ID`。
2. 在独立画布的资产中，将需要作为真人参考的图片标记为“方舟真人素材”，并
   绑定 `asset://<asset ID>`。该图片仅用于本地预览；生成请求只提交 `asset://`。
3. 在普通、Fast 或 Mini 视频节点连接该素材，保留当前选择的模型。提交时自动
   使用 Ark。
4. 若已标记的真人素材缺少合法 `asset://`，前端显示明确错误并阻止提交；服务端
   也再次拒绝该请求。不会退回 Gravitex 或提交原始图片 URL。
5. 在“首尾帧”模式选择首帧和尾帧。两者都存在时，方舟请求使用
   `first_frame` / `last_frame`；该模式不会被上一段视频的自动尾帧续接覆盖。

## 画布状态与界面

资产新增独立字段，避免混用当前 Gravitex 的 `assetUrl`、`validationStatus`：

```js
arkPersonAsset: {
  enabled: true,
  assetUrl: "asset://...",
  assetId: "...",
  boundAt: "ISO timestamp",
  error: ""
}
```

`enabled` 必须由用户明确开启。现有画布中标为 `photoreal` 的参考素材沿用既有
真人参考语义：在三个目标模型中，未绑定有效 `asset://` 时直接阻断，不能作为
普通图片退回提交。其他素材不自动标为真人，方舟仍会对任何直接上传的含人脸素材
执行其自身输入审核。

三个目标模型的视频节点显示“方舟真人素材”小面板：允许选择已连接素材并绑定或
清除 `asset://`。人物参考模型不显示该面板，继续显示原有 Gravitex 素材库。

视频节点设置增加：

```js
frameControl: "reference" | "first_last"
firstFrameAssetId: ""
lastFrameAssetId: ""
```

选择 `first_last` 时显示两个固定选择框，候选项来自画布中的可提交图片。首帧、
尾帧从普通参考列表中排除，避免同一图片在请求中重复出现。删除选中资产或素材
不可提交时，节点校验失败。

## 请求路由与载荷

普通、Fast、Mini 三个模式只要引用了 `arkPersonAsset.enabled === true` 的素材，
服务端强制返回 `ark` provider，并保留原模型名。这个路由规则不依赖全局
`CANVAS_VIDEO_PROVIDER`。

人物参考模式仍按现在的 Gravitex 判断和载荷生成。新字段不会参与其逻辑。

Ark 内容顺序固定：

```js
[
  { type: "text", text: prompt },
  { type: "image_url", image_url: { url: firstFrame }, role: "first_frame" },
  { type: "image_url", image_url: { url: lastFrame }, role: "last_frame" },
  ...references.map(({ url }) => ({
    type: "image_url",
    image_url: { url },
    role: "reference_image"
  }))
]
```

`firstFrame`、`lastFrame` 和普通参考图共同计入 9 张上限。绑定真人素材时，上述
`url` 是 `asset://...`，而不是本地预览图或原始图片地址。提示词继续依据素材在
`content` 中的顺序使用“图片1、图片2”等引用，不写入 Asset ID。

服务器必须拒绝以下情况：目标模型使用已标记真人素材但没有合法 `asset://`；
`first_last` 缺少任一帧；帧与普通参考图超过总数上限；或人物参考模式试图进入
Ark 这条新增路径。

## 自动续接

当前普通模式保留“上一段视频尾帧作为下一段首帧”的行为。`first_last` 模式优先，
不读取或等待上游尾帧；这样手动指定的首尾帧是唯一的帧控制来源。

## 验证

- 新增服务端 payload 单测：模型保持 `seedance-2-0`、`fast`、`mini`；官方真人
  素材强制 Ark；`asset://` 出现在 `image_url.url`。
- 覆盖缺失或非法 `asset://`、首尾帧缺失、9 张上限、手动首尾帧覆盖自动续接。
- 覆盖人物参考模式仍走 Gravitex，且未读取 `arkPersonAsset`。
- 新增画布 UI 结构断言：三个目标模型可见方舟绑定与帧控制，人物参考模式不变。
- 运行语法检查、现有受影响脚本和完整 `npm test`；不调用真实 Ark 或 Gravitex
  生成接口。
