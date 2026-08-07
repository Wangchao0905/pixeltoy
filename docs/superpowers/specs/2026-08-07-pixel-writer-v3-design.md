# Pixel Writer v3.0 设计（反射闭环流水线 + Humanizer-zh 文风契约）

> 日期：2026-08-07 · 状态：**待用户确认** · 依据：吴恩达 Agent 课程交接设计 + Superpowers 方法论 + 去 AI 味 Skill 榜（Humanizer-zh）

## 1. 目标与约束（已与用户确认）

- **只接入两个大模型**：GPT（主笔）+ DeepSeek（独立审核/评估）
- 界面：**独立简洁工作台**（单页：创意输入 → 阶段进度 → 剧本/审核记录 → 导出）
- 产出：**分集大纲 + 逐集剧本**，导出 **docx**（纯 Python 零依赖 zip+XML）
- 引擎：**重构现有引擎** `backward_engine.py` → `engine.py`（确定性流程优先，推理只交给模型）
- 集数控制：**时长和剧集数都做成可选**
- 保证：架构与逻辑完整不断裂、**对白与情节不跑偏**、**对白有"人味"（去 AI 腔）**

## 2. 架构：反射闭环流水线

```
创意/关键词
  → 创意规范化（确定性解析：目标/主角/冲突/约束，不含模型）
  → 设定生成（GPT：人物/世界/结局不变量）
  → 分集大纲（GPT：钩尾衔接/事件链）
  → 逐集循环（每集）：
      GPT 主笔 → DeepSeek 独立审核
      （对照：设定事实 + 分集大纲 + 文风契约[Humanizer-zh] + 逻辑一致性）
      → 不通过 → 问题清单 → GPT 定向修订（最多 2 轮）
      → 仍不过 → 标记"需人工决策"，不阻塞后续集
  → docx 导出（剧本 + 审核记录附录）+ JSON 留存
```

确定性流水线由代码控制（阶段状态机），模型只负责生成与评估；**评估闭环**保证质量可度量、可收敛。

## 3. 组件

| 组件 | 职责 |
|---|---|
| `engine.py` | 重构 `backward_engine.py`：确定性流水线 + 反射闭环；清理 v2.0 三席位对弈旧码 |
| `server.py` | 8877 简洁 API：`/api/start`（一次性全流程）+ `/api/project` + `/api/export` |
| `ui/` | 单页工作台（见 §1） |
| `facts/` | 文风契约不变 + **新增 `humanizer-zh.md`（AI 腔检查清单）** |
| `projects/<name>/` | 结构化任务状态 JSON：goal / plan / current_step / artifacts / evaluation / budget（max_revision_rounds=2、timeout） |

## 4. Humanizer-zh 集成（本轮新增）

**来源**：去 AI 味 Skill 榜（用户提供截图）最匹配项 —— `Humanizer-zh`（中文去 AI 腔）。已内置可用（`/Users/wangchao/.claude/skills/humanizer-zh/SKILL.md`，global scope，21 个中文适配 AI 腔模式 + 质量评分）。

**使用方式**（固化到引擎，不依赖外部 skill 运行时）：
1. `facts/humanizer-zh.md`：将内置 SKILL.md 的核心规则提炼为**审核用检查清单**（AI 高频词/三段式/破折号滥用/否定式排比/宣传腔金句/千篇一律开头等 21 模式），作为审核契约的一部分。
2. **DeepSeek 审核维度新增「人味/AI 腔」**：逐集审核对白时，对照 `facts/humanizer-zh.md` 逐条检查，命中即记入问题清单（含原文引用 + 模式编号 + 改写建议）。
3. **修订闭环联动**：GPT 定向修订时必须在修订说明里说明每个 AI 腔问题的处理；修订后 DeepSeek 复核该维度。
4. 评分：审核输出含"AI 腔分数"（0-100，100=完全人味），低于阈值（如 70）即使情节通过也要求修订。

## 5. 阶段状态机（确定性）

```
brief → worldbuilding → outline → episode[n]（loop） → export
每个阶段：pending → running → review（DeepSeek） → revise（≤2） → approved / needs-human
budget：max_revision_rounds=2、单阶段 timeout → 标记 needs-human
```

## 6. 测试（Humanizer-zh 相关）

- 文风契约加载：`facts/humanizer-zh.md` 存在且含 21 模式
- 审核维度：DeepSeek 审核输出含「AI 腔」维度分数与命中清单
- 修订闭环：AI 腔问题驱动定向修订，2 轮上限生效
- 其余：设定一致性、大纲钩尾衔接、docx 结构、集成冒烟（沿用 v3.0 测试清单）

## 7. 待确认

- [ ] 设计整体确认
- [ ] 设计文档写入路径（本文件已在 `codex-skill/docs/superpowers/specs/`，是否同步到 `scriptwriter-agent/`？）
- [ ] 部署方式：生产 `/home/ubuntu/apps/scriptwriter-agent`（8877，独立 pm2 `pixel-writer`，非 deploy.sh 流程）
