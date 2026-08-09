# pixeltale 字段锁 + 单集修复：双专家方案对比与选型

> 依据 agency-agents：Backend Architect（engineering-backend-architect）+ Prompt Engineer（Prompt Architect 角色）
> 2026-08-09 · 只设计不部署

## 方案 A（Backend Architect 视角）——数据层硬保障

**核心：锁是数据层一等公民；API 幂等 + 乐观锁 + 版本快照。**

1. **独立锁存储模块** `unit-lock-store`：
   - 状态机纯函数（`transition(lock, action)`：非法转换直接拒绝——如 `open→pinned` 不允许）
   - 每集锁带 `version`（单调递增）+ `contentHash`（内容指纹，防静默漂移）
2. **API 幂等与乐观锁**：
   - `unit/update` / `unit/fix-issue` 请求带 `if-match: <version>`——版本不匹配 → 409（并发编辑防覆盖）
   - 修复/编辑任务**互斥**（复用现有 `_claim_project` 单写者锁——一次只允许一个修改任务）
3. **回滚 = 版本快照**：每次写入保留前 N 版（环形缓冲，N=5）——止损回滚 = 指针回退，不重新生成
4. **熔断与超时**：单集修复循环计数（>2 轮 → escalated 熔断）；单次修复墙钟超时 240s（复用 readStreamPayload）
5. **可观测**：所有写操作落 provenance + 审计事件（who/what/version/ts）

## 方案 B（Prompt Engineer 视角）——prompt 契约软保障

**核心：锚点是 prompt 契约；修复质量靠显式约束 + few-shot + 校验。**

1. **审核 prompt 输出契约升级**：
   - issues 必带 `unit` + `field_path`——给出 **few-shot 示例**（正例：`scenes[0].beats[2].line`；反例：无锚点/跨集锚点）
   - 契约版本化（`REVIEW_CONTRACT_V2`，changelog 记录）
2. **修复 prompt 显式约束**：
   - 硬性指令："只修改 `<field_path>` 命中的内容，其余 scene/beat 逐字复制，禁止新增/删除未点名的节拍"
   - 附 1 个 few-shot（原片段 vs 修复后片段——只变命中行）
   - 输出 schema 校验（结构 + 锚点一致性）
3. **prompt 测试套件**：每 prompt ≥3 用例（happy/锚点缺失/跨集锚点）——校验器 + prompt 绑定回归
4. **增量审核 prompt**：只注入该 unit 内容 + 相邻集压缩状态（continuityContext）——"本集为第 N 集"声明（防上下文错位——Pixel Writer 教训）

## 交叉对比

| 维度 | A（后端架构）| B（prompt 契约）| 选型 |
|---|---|---|---|
| 保护强度 | **强**（乐观锁/版本快照/互斥）| 中（prompt 约束 + 代码校验）| A 为主 |
| 修复质量上限 | 依赖 prompt（需 B 补）| **高**（锚点精准 + few-shot）| B 为主 |
| 实现成本 | 中高（锁存储/版本化/409）| 低中（prompt + 校验器）| B 低 |
| 对现有代码侵入 | 中（新模块 + API 改动）| **低**（改 prompt + 契约字段）| B 低 |
| 可测试性 | **高**（纯函数状态机单测）| 中（prompt 套件 + 校验器）| A 高 |
| 核心风险 | 并发/版本复杂度 | 模型不守 prompt 纪律 | 互补 |
| 并发编辑安全 | **A 独有**（if-match 409）| 无 | A |
| 回滚可靠性 | **A 独有**（版本快照指针回退）| 依赖重新生成 | A |

## 选型结论：**A+B 融合（架构为骨、prompt 为魂）**

- **从 A 吸收**（补进设计，成为 Task 5/6 的硬约束）：
  1. `if-match: version` 乐观锁（并发编辑 → 409，不再静默覆盖）
  2. 修复/编辑互斥（复用 `_claim_project`）
  3. 版本快照回滚（保留前 5 版，止损 = 指针回退）
  4. 修复循环熔断（>2 轮 escalated）
- **从 B 吸收**（补进设计，成为 Task 4/5 的契约）：
  1. 审核锚点契约带 **few-shot 正反例**（模型更可能输出合规锚点）
  2. 修复 prompt **显式"逐字复制"约束 + few-shot 示例**
  3. 契约版本化（`REVIEW_CONTRACT_V2`）+ prompt 测试套件（≥3 用例/契约）

> 融合后 6 层跨集保护升级为：压缩上下文 + 跨 unit 锚点拒绝 + 写入隔离 + diff 约束 + continuity 兜底 + 版本快照回滚 + 并发乐观锁（7 层）。
