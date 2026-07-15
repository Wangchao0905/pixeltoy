# 统一参考图交付(素材库 asset://)设计

日期:2026-07-02
状态:已通过 brainstorming 评审,待写实现计划

## 目标

根治 Pixel Toys 视频生成中"参考图交付给 Ark 视频接口"的两类失败:

- **A. 抓取超时** —— `The parameter content[N].image_url is not valid: timeout while fetching resource`。Ark 逐张下载参考图 url,遇到"提交时才临时转公网、体积大"(如故事板 ~3MB)的地址会抓取超时。实证:V001 超时卡在 content[2]=故事板(非人物图)。
- **B. 真人拦截** —— `InputImageSensitiveContentDetected.PrivacyInformation`("input image may contain real person")。写实/3D 人物参考图被 Ark 判为真实人物。

## 根因与核心洞察

两个错本质是同一件事:**参考图如何交付给 Ark**。

- `asset://` 是 Ark 自家素材库引用:取图稳定(解决 A)、且是审核过的素材(解决 B)。
- **关键事实**:基础模型 seedance-2-0 经 Gravitex 提交时,`buildGravitexVideoGenerationPayload` 里 `resolveSeedanceImageReferences` 已用 `allowAssetUrl:true`。**即基础模型本就接受 asset://,无需切换到 person-reference 模型。**
- 之前直接切 person-reference 导致 V001 回归,根因不是"切模型",而是**混用了已验证 asset:// 与未验证的本地/公网地址**;故事板等未验证 ref 仍走临时公网 → 超时/非法。已回滚。

## 铁律(不变式)

任何片段提交视频前,它引用的**每一张**参考图都必须有"Ark 能稳定快速取到的地址":
- 人物类(Character/Storyboard)→ `validationStatus==="active"` 的 `asset://`;
- 非人物类(Scene/Prop/Insert)→ 稳定公网 https 地址(预置或阶段0预上传)。
不满足 → 该批不提交。**杜绝提交时才临时转公网(超时根因),也杜绝把写实人物原图直接发给 Ark(真人根因)。**

## 已确认的决策

1. 时机:批量出片前设**"准备参考图"步骤**(不在资产生成时、不在逐段提交时)。
2. 范围:**双轨处理**,按"是否含人物"分流,兼顾治错与省时——
   - **人物轨(Character + Storyboard)**:走完整素材库验证 → `asset://`(治真人拦截 B,顺带治超时 A)。
   - **非人物轨(Scene + Prop + Insert)**:**不做 asset:// 验证、不等 active**;仅确保有稳定公网地址(缺失则在阶段0预上传一次,快),避免临时转公网导致的超时 A。已有公网地址的直接沿用、零成本。
   - 分类依据:`inferAssetTypeFromName`(C_→Character、SB_→Storyboard 归人物轨;S_/P_/I_ 归非人物轨)。
3. 触发:作为"批量生成视频"的**自动第 0 阶段**(一次点击,显示进度)。
4. 失败:**整批阻塞**并返回卡住资产清单(不部分提交)。
5. 模型:**保持配置模型**(seedance-2-0/fast),不切 person-reference——防回归。

## 架构与数据流

批量生成新流程(`generateProjectVideoShotsSequentially` 入口):

```
点击"批量生成视频"
  └─ 阶段0:准备参考图(新增,阻塞式)
       1. 收集本批 selected 片段引用的全部资产名(refs + storyboardRefs 去重),按类型分两轨
       2. 人物轨(Character/Storyboard):validateCanvasPhotorealAssets(全量推素材库)→ 轮询 active → asset://
       3. 非人物轨(Scene/Prop/Insert):有公网地址则沿用;缺失则预上传公网(不轮询 active)
       4. 人物轨全 active 且非人物轨全部有稳定地址 → 进入提交循环
       5. 人物轨有卡住(pending 超时/failed)或某图无任何可用图源 → 整批中止,返回卡住清单
  └─ 提交循环(基本不变)
       - projectVideoPayloadForShot 用 asset:// 引用(allowAssetUrl 已 true)
       - 模型保持配置模型,不切 person-reference
```

单张参考图数据流:

```
磁盘图 /media?path=  ──dataUrl──▶ 素材库上传(createOrRefreshGravitexAsset)
   └─ asset://xxx (pending) ──轮询──▶ active
        └─ 写回 config.assets[name].assetUrl / validationStatus=active
             └─ 提交时 resolveSeedanceImageReferences(allowAssetUrl:true) 用 asset://
                  └─ Ark 从自家素材库取图 → 不超时、不判真人
```

## 组件与职责

**新增**
- `collectReferencedAssetNames(config, shots)` — 纯函数。收集 selected 片段的 refs+storyboardRefs,去重,返回资产名数组。
- `classifyReferenceAssets(names)` — 纯函数。按 `inferAssetTypeFromName` 把资产名分成人物轨(Character/Storyboard)与非人物轨(Scene/Prop/Insert)。
- `ensurePublicReferenceUrl(episodeRoot, config, asset)` — 非人物轨用。若资产已有稳定 https 公网地址则原样返回;否则用磁盘图源预上传到公网(复用 createPublicCanvasAsset),写回 config。不注册素材库、不轮询 active。
- `prepareBatchVideoReferences(episodeRoot, config, shots, { timeoutMs })` — 编排:收集→分轨→人物轨 validateCanvasPhotorealAssets+轮询 active、非人物轨 ensurePublicReferenceUrl→返回 `{ ready, active[], publicReady[], stuck[] }`。阶段0主体。

**改动**
- `validateCanvasPhotorealAssets` — 去掉"只验 photoreal、其余 skipped"过滤(约 8057/8082);验证传入的所有资产(范围由调用方筛,这里只处理人物轨资产)。
- `generateProjectVideoShotsSequentially` — 提交循环前插入阶段0;`!ready` 则不建队列、抛错(含卡住清单)。
- `ensureProjectPhotorealReferencesReady` — 语义改为"验证该片段全部引用就绪"(人物轨=active asset://,非人物轨=有公网地址),作为单段提交前的二道防线;不再以 config.modelName 为门槛。实现时加注释说明它现在验全部引用(名字里的 photoreal 是历史遗留)。

**不改**
- 模型路由 / `projectVideoPayloadForShot` 的 model 字段(保持配置模型)。
- `isCanvasPhotorealAsset` 保持 photoreal 判定;不再用它当"要不要验证"的开关——"要不要验证"由"是否被片段引用"决定。

**职责边界**:collect(算范围)→ classify(分轨)→ 人物轨 validate+轮询 / 非人物轨 ensurePublicUrl → prepare(编排)→ 提交循环(消费 asset:// 与公网 url)。每层单一职责、可独立测试。

## 错误处理与边界

- **整批阻塞**:`prepare` 返回 `ready:false` → 不建队列、不提交、抛错并列出卡住资产(名/状态/原因);前端状态区显示。
- **超时**:总超时 `PREPARE_REFS_TIMEOUT_MS`(建议 8 分钟,可调);超时未 active 计入卡住。轮询间隔复用现有节奏(5–10s),用 `refreshConfigAssetLibraryStatuses`。
- **分类**(人物轨):active→就绪;pending/processing 未超时→继续轮询;failed→立即计卡住(不等超时);无任何图源→计卡住,提示重新生成。
- **非人物轨**:已有稳定公网地址→就绪;缺失但有磁盘图源→预上传得公网地址→就绪;无任何图源→计卡住。非人物轨不轮询 active、通常秒级完成。
- **幂等**:已 active 的 asset:// 跳过(现有 `refreshKnownGravitexAsset` 路径),重复点批量不重复上传/烧额度。
- **并发**:阶段0 期间队列标 `preparing`;已有队列 running 则沿用"不重复提交"保护。
- **真人题材**:asset:// 验证 active 即视为合规通道,不额外拦。

## 测试与验证

1. **纯逻辑单测(不碰 API)**:`collectReferencedAssetNames`(去重/不漏)、`classifyReferenceAssets`(人物轨/非人物轨分类正确)、`prepareBatchVideoReferences` 判定(mock 人物轨全 active / pending / failed / 超时,非人物轨有无公网地址 → 断言 ready 与 stuck)。
2. **self-check 静态断言**:`validateCanvasPhotorealAssets` 无"非 photoreal 跳过"短路;`generateProjectVideoShotsSequentially` 提交前调用 `prepareBatchVideoReferences` 且 `!ready` 抛错不建队列;提交仍用配置模型(无 person-reference 自动切换,防回归)。
3. **隔离冒烟(不烧视频额度)**:只跑到阶段0结束,验证参考图推进素材库、轮询 active、名单齐→ready:true,提交前停下。
4. **真机验证(用户点头后,消耗额度)**:Dragonwake 完整批量,核对不再出现 timeout / real-person。
5. **部署守则**:本地 `npm test` 全绿 → rsync(安全 exclude,保护 .env.local/.pixel-toys-*/projects/)→ 远端 `node --check` → `pm2 reload` → 健康检查。

## 非目标(YAGNI)

- 不改视频模型路由、不引入 person-reference 自动切换。
- 不改 Production Board 并发/串行行为(另议)。
- 不做参考图的自动降尺寸/压缩(如后续仍偶发超时再评估)。
