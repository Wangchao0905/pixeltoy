# 方案:拖拽重分类 + AI建议(生图前人工纠偏)

## 目标
Opus 照常解析资产 → 解析完成进入**待确认**状态,按 人物/场景/道具/插入 分组展示 →
用户**拖拽**把分错类的资产拖到正确分组 → AI(降级后的审核)在可能分错的资产上**标黄提示** →
用户点「确认分类」→ 分类锁定,之后生图/视频配置全部引用锁定后的最终分类。

## 为什么安全(核心)
拖拽只发生在**生图前**。此刻图未画、视频配置未建、**不存在任何 refs**,
所以改类型→改名字(`P001_…`→`C001_…`)**不会断任何引用**。确认锁定后引用才产生。

## 关键既有能力(已核实,减少改动)
- 后端 `normalizeManifestItem`(server.js:17419):type 改变时经 `resolveAssetIdentity`
  判定旧 id 与新类型不符 → **自动重算 id/name**(`P001_NANA_PROP_REF`→`C00n_NANA_CHARACTER_SHEET`)。
- 后端 `asset-manifest` POST(server.js:20211):已收完整 manifest、支持改 type 和 `confirm` 标志。
  → **拖拽保存直接复用它,后端几乎不用新增。**
- 前端 `renderAssets`(app.js:3354)**当前是平铺渲染**(单 `#assetGallery` 容器 +
  `reconcileKeyedCards` 增量),但每个 slot **已带 `.type`** → 数据够,需新增分组容器 DOM。
- 生图门槛已看 `manifest.confirmed`(server.js:7349 `!confirmed → "资产解析尚未确认"`)。

## 改动清单

### A. 后端:取消自动确认(server.js:17765-17767)
- 现状:解析完 `manifest.confirmed=true` 立即可生图。
- 改为:解析完 `confirmed=false`(待确认)。生图门槛已卡 confirmed,自然要求先确认。
- 影响面检查:确保没有别处依赖"解析即已确认"(如批量流程)。若有,加显式确认步骤。

### B. 后端:审核关降级为"仅建议"(server.js:14356 auditAssetRoles + 17742 接入)
- 现状:阻断式——审核跑完才交付,高置信自动翻转类型,失败则 throw 挡住交付。
- 改为:**非阻断**。审核照跑,但:
  - **不自动翻转**任何类型(人拖才算数)。
  - 把可疑项写入 `manifest.audit.flagged`(`{label, currentType, suspectType, reason}`)供前端标黄。
  - 审核超时/报错 → **不 throw**,`audit.ok=false` 记原因,解析结果照常交付(pending)。
- 保留 5 条测试里"锁定豁免""不误翻"的逻辑;删掉"失败阻断交付"那条,改测"失败不阻断"。

### C. 前端:平铺→四分组容器 + 拖拽 + AI建议标黄 + 确认按钮
- **改造 `renderAssets`(app.js:3354)为分组渲染**(仅在"待确认"状态时启用分组;
  已确认/生成中沿用平铺,避免影响生图后的画廊):
  - `#assetGallery` 内建四个分组容器(人物/场景/道具/插入),各含标题 + drop 区。
  - 按 `slot.type` 把 specs 分到四组,**每组各调一次 `reconcileKeyedCards`**(保留增量渲染,
    key 仍用资产名),不破坏现有机制。
  - 每张资产卡 `draggable=true`;四个分组容器为 drop 区(dragover/drop)。
  - 拖入某组 → 本地改该 item 的 `type` → 调 `asset-manifest` POST(不带 confirm)保存 →
    后端 `normalizeManifestItem` 重算 id/name → 重新拉取 manifest 刷新(资产落到新分组)。
  - `manifest.audit.flagged` 里的资产卡加黄色边框 + 悬浮"AI认为可能是X类,请核对"。
  - 分组视图顶部「确认分类」按钮 → `asset-manifest` POST `{confirm:true}` → 锁定 → 解锁生图。
- 拖拽用原生 HTML5 DnD(项目已有 `draggable` 用例,app.js:742),不引第三方库。
- CSS:分组容器 + drop 高亮 + 标黄边框,加到现有资产样式表。

### D. 边界与防错
- 待确认状态下**禁止生图**(门槛已在,验证即可)。
- 拖拽保存失败(网络)→ 回滚本地视图 + toast,不静默。
- 幽灵资产(硬编码正则造的多余项)→ 也在分组里,用户可拖入正确类或用现有「设为不生成」排除。

## 验证
1. 单测:构造 NANA 在 Prop 分组的 manifest → 模拟拖到 Character → 断言保存后 id 变
   `C…_CHARACTER_SHEET`、type=Character、counts 更新。
2. 单测:审核降级后失败**不 throw**、结果照常返回 pending。
3. 手动:解析→待确认→拖一个分错的→标黄项核对→确认→可生图;确认前生图被拒。
4. `node --check server.js` + 既有资产回归测试全绿。

## 不做(明确边界)
- 不做"生图后改类型"(那需要稳定ID+级联改名+移文件+重画,风险大,本期不碰)。
- 不引第三方拖拽库。
- 不动视频配置的引用机制(锁定后名字即最终,引用天然正确)。

## 执行分工
方案认可后 → 我出 Codex 详细任务书(精确到行号)→ Codex 实现 → 我独立验证 → 交你部署。
