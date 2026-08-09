# pixeltale 字段锁 + 单集修复 设计方案

> 依据《剧本创作工作站 v0.1》P5/§3.2（字段锁）+ Pixel Writer 单条修复能力反哺
> 状态：待评审 · 2026-08-09 · 只设计不部署

## 0. 决策（用户已确认）

1. **包含剧本编辑 UI**（改内容 → 自动 pinned）
2. **只 unit 阶段**（arc / scenes；dialogue 非 unit 不在本期）
3. **集级锁 + 状态标记**（扩展现有 unitLocks，不做字段级依赖图）

## 1. 集级锁状态机（扩展现有 unitLocks）

```
open（未生成/自由）
  └─ 批次审核通过 → locked（定稿，自动流程可跳过不可覆盖）
                     └─ 人工编辑 → pinned（绝对不可被自动流程覆盖）
  └─ 依赖变更（上游 artifact 重跑批准）→ dirty（进复核清单，不自动改，等人工裁决）
```

- 存储扩展：`unitLocks[stage][number] = { status, pinnedBy, pinnedAt, dirtyReason, provenance }`
- 现有 `status === "locked"` 语义保留（批次通过）；`pinned`/`dirty` 为新增态
- **自动流程硬规则**：
  - `locked` / `pinned` 的 unit：批次重跑、自动修复、整批 revision **一律跳过**（不覆盖）
  - `dirty` 的 unit：不进自动修复，进复核清单（人工裁决：重写 / 接受 / 改依赖）
- **依赖标记**：上游阶段 artifact 被重跑批准（confirmArtifact）时，下游 unit 阶段已有 `locked`/`pinned` 的集标 `dirty`（简单下游传播，不做全依赖图）

## 2. 剧本编辑 UI（改内容 → pinned）

- unit 详情视图（arc 集卡片 / scenes 集卡片）加「编辑」按钮 → 内联编辑（场景/节拍/对白，仅 unit 阶段）
- 保存 → `POST /api/pixeltale/unit/update`（body: projectId/stage/unit/patchedUnit）
  - 服务端：schema 校验（unit 结构契约）→ 写 state → `status="pinned"` + `pinnedBy="human"` + `pinnedAt`
  - provenance 记录（P10：who/ts）
- 前端冲突防护：`pinned` 集不显示「重新生成」主按钮（或强确认才覆盖）；编辑入口对 `pinned` 集保持可用（再次编辑刷新 pinnedAt）

## 3. 单集修复（unit 阶段逐条 finding 定向修复）

### 3.1 finding 锚点增强
- 审核输出契约（issues）增加字段：`unit`（集号，如 6）+ `field_path`（如 `scenes[0].beats[2].line`）
- 审核 prompt 要求输出锚点；缺失锚点的 issue 无法单修（仍可整批修订）

### 3.2 单条修复 API
`POST /api/pixeltale/unit/fix-issue`（body: projectId/stage/unit/issue）

- **复用 revisionContract**：items 只含该 issue（带 unit + field_path 定位）——现有修订机制最小改造
- **diff 约束**（参考 Pixel Writer `_revision_respects_scope`）：GPT 修订只改 issue 点名的 scene/beat，未点名逐字不变；越界 → 合并回滚
- **增量审核**：修复后只重跑该 unit 的审核（单集审核，非整批）→ 通过 → 该 unit 转 `locked`
- **止损回滚**（Pixel Writer rolled-back 模式）：修复后新问题数 ≥ 修复前 → 恢复原版本 + 原审核记录

### 3.3 修订上限
- 同 finding 连续 2 轮未消 → escalated → 该 unit needs_review（复用 humanOverride 放行）
- 整批修订路径保留（批次整体不过时仍走 revisionPlan）

### 3.4 跨集保护机制（单集修复不得破坏前后剧集）

1. **锁 + 压缩上下文（现有机制复用）**：修复 prompt 注入时，已锁定/已生成的其他集**只以压缩状态**（`compactLockedUnit`：unitNumber/version/contentHash/startState/endState/openThreads）呈现——**不给全文**——模型物理上接触不到其他集内容，不可能改写
2. **锚点跨 unit 拒绝（API 硬校验）**：`fix-issue` 请求的 `issue.field_path` 前缀必须等于请求的 `unit`（如请求修第 6 集，field_path 必须是 `scenes[0]...` 且 scenes 属于 unit 6）；跨集锚点（指向其他 unit）**直接拒绝**，不进入修订
3. **写入隔离**：修复结果只写 `artifacts[stage].units[unit]` 单集位置；其余集文件位置不动
4. **diff 约束**（§3.2）：GPT 修订只改锚点命中处，未点名 scene/beat 逐字不变；越界 → 合并回滚
5. **continuity 兜底（现有审核维度）**：修复后增量审核**必须含连续性维度**（与前集衔接/角色状态延续/悬念推进）——若修复破坏了前后集衔接 → continuity 分下降 → 审核不过 → 不锁定
6. **止损回滚（§3.2）**：修复后问题数（含 continuity 破坏类）不减反增 → 自动恢复原版本 + 原审核记录

> 结论：单集修复被 6 层保护包围，前后集内容不可达、不可写、不可改——最坏情况是"本集修不好"（回滚/人工），不会污染其他集。

## 4. 数据流

```
编辑/单条修复 → API → schema 校验 → 写 state（+锁态/provenance）→ 增量审核（可选）→ UI 刷新
```

- 不破坏现有批次状态机：`locked → pinned` 是单向增强；`dirty` 只标记不自动改（§3.3 原则）

## 5. 测试

| 模块 | 用例 |
|---|---|
| 锁状态机 | open→locked→pinned→dirty 转换；pinned 不被批次重跑/自动修复覆盖 |
| 编辑 API | schema 校验（非法 unit 拒绝）；pinned 标记 + provenance；dirty unit 禁止编辑冲突 |
| 单条修复 | 锚点定位（unit+field_path）；diff 约束（未点名 scene/beat 逐字不变）；增量审核只跑该 unit；止损回滚 |
| 依赖 dirty | 上游 confirmArtifact → 下游 locked/pinned unit 标 dirty；dirty 不进自动修复 |
| 前端 | 编辑 UI 渲染；pinned 集禁用重生成；dirty 徽标显示 |

## 6. 边界（本期不做）

- dialogue 非 unit 阶段的单条修复（后续）
- 字段级锁 + 全依赖图（v0.1 完整形态，本期用集级锁 + 简单下游 dirty 替代）
- intent 锁态（v0.1 §3.2 四态中的 intent——本期只做 open/locked/pinned/dirty）
