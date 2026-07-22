# Codex 任务:三方合并——把资产改动移植到生产基线(不丢生产功能)

## 严重背景(先读懂再动手)
生产在今晚被换成了**另一条分支**:它有「参考套件 reference-kits」和「工作区模式 workspace-modes / 按用户布局」,
但**没有**我今晚做的资产三件套(审核降级 + 拖拽重分类 + 后台异步加速)。
反过来,我的版本有资产三件套,却**没有**参考套件和工作区模式。两条分支各有对方没有的功能。

**当前 repo 已被我设为「生产基线」**(即生产当前代码 + 补齐的 `server/reference-kits.js`),已 `node --check` 通过。
你的任务:**把我的资产改动移植到这个生产基线上**,让最终结果**同时拥有两边功能**。

## 铁律
- **绝不删除/破坏**生产基线已有的:reference-kits(`server/reference-kits.js`、`projectReferenceKits`、
  `bindReferenceKitToShot` 等)、workspace-modes(`WORKSPACE_MODE_MIGRATION_KEY`、`layoutStorageKey`、
  `normalizeStoredWorkspaceMode`、`initialWorkspaceScale` 等)。移植完必须 grep 确认它们还在。
- 不碰生产服务器(不 scp/pm2)。改完 `node --check server.js` + `node --check public/app.js`。
- 单次 Write/Edit ≤50 行。不引第三方库。

## 两个版本(对照移植)
- **当前 repo**(`/Users/wangchao/Documents/Codex/2026-06-16/codex-skill/`)= 生产基线,移植目标(改这里)。
- **我的资产版快照** = `/tmp/merge_work/mine/`(`server.js`/`app.js`/`index.html`/`styles.css`)= 移植来源(从这里抄资产功能)。
- 生产基线快照 = `/tmp/merge_work/prod/`(= 当前 repo 同内容,供你 diff 参照)。

## 移植清单(从 mine/ 抄到 当前repo)

### server.js
1. **auditAssetRoles 函数**(mine 有、基线无):整段移植。它是「非阻断 + 仅建议 + 不自动翻转」版
   (`hasCompleteStructuredAssetPlan` 跳过;无 key/失败返回 `ok:false` 不 throw;`flippedCount:0`;
   可疑项进 `flagged:[{label,currentType,suspectType,confidence,reason,type,note}]`)。
2. **assetAuditModel 函数**(mine 有):移植,默认值用 `"claude-haiku-4-5"`(不是 claude-sonnet,网关不支持)。
3. **runAssetAuditInBackground 函数**(mine 有):整段移植。后台异步审核:跑 auditAssetRoles →
   **重读最新 manifest**(readAssetManifest)→ **只 merge audit 字段**(`{...current, audit:{...}}`,
   绝不动 items/confirmed)→ writeAssetManifest。全程 try/catch,失败只 log。
4. **extractAssetManifest 主流程**:参照 mine 改造——
   - 取消自动确认:把 `manifest.confirmed = true / autoConfirmedAt` 改成 `confirmed=false`、`confirmedAt=""`。
   - manifest 的 audit 先置 `pending` 标记:`{ok:false,...,reason:"审核进行中",pending:true}`。
   - manifest 落盘后,`if(!hasCompleteStructuredAssetPlan)` 触发
     `runAssetAuditInBackground(...).catch(logErr)`(**不 await**,fire-and-forget)。
5. **normalizeAssetManifest 的 audit 规范化**:兼容 `pending` 字段与 flagged 的
   `currentType/suspectType/confidence` 扩展字段(参照 mine)。
6. **生图门槛**:确保 startToolJob 里有 `if(!manifest.confirmed) throw "资产解析尚未确认，请先确认分类再生图"`
   (生产基线 issues 检查处已有类似文案,startToolJob 入口也要卡)。
7. **导出**:`__test` 里加 `runAssetAuditInBackground`(若 mine 有)。

### public/app.js
生产基线的 renderAssets 是无拖拽的基础形态,但**已有** `confirmAssetManifestBtn` + `saveAssetManifest`。
把 mine 的拖拽分组**加到生产基线的 renderAssets 上**,复用已有确认按钮,别重造:
- `reclassifyAsset` 函数(mine 有):移植。改 item.type → POST `asset-manifest {confirm:false}` →
  成功 setProjectState+重渲染,失败重渲染回滚(操作深拷贝)。
- `pendingClassification` 分组模式(mine 有):仅当 manifest 待确认(items 且 !confirmed)时,
  renderAssets 渲染四分组(人物/场景/道具/插入)+ drop 区 + 卡片 draggable;否则沿用基线平铺。
- `audit.flagged` 标黄(mine 有 is-flagged)。
- 确认按钮沿用基线的 `confirmAssetManifestBtn` / `saveAssetManifest({confirm:true})`,别新建重复。

### public/index.html + styles.css
- index.html:确认按钮生产基线已有则不重复加;分组标题若靠 JS 生成则不改 html。
- styles.css:移植 mine 的分组容器 / drop 高亮 / 黄框(is-flagged)样式(基线没有则加)。

## 测试
把 mine 的资产测试也带过来并全绿:`scripts/asset-drag-reclassify.test.mjs`、
`asset-drag-reclassify-ui.test.mjs`、`asset-role-audit.test.mjs`、`asset-audit-async.test.mjs`
(这些文件在当前 repo 的 scripts/ 应已存在;若缺则从逻辑重建)。外加:
`asset-parser-regression.test.mjs`、`asset-character-vs-prop.test.mjs`。
最后 `node --check server.js`、`node --check public/app.js`。

## 完成后输出(务必逐条)
1. 移植的函数/行号清单(server.js / app.js / css 分列)。
2. **反向确认**:grep 证明 reference-kits + workspace-modes 仍在(贴命中数)。
3. 测试 pass 行。
4. 已知残留/风险。
5. 不执行部署(交人工)。
