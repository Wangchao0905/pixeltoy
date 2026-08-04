# Audit

target: PixelTale 独立编剧工作区
goal: 让用户找回并继续既有创作

| # | area | issue | sev | fix | eff |
|---|---|---|---|---|---|
| 1 | flow | 现有界面只有“新建剧集”，没有已保存会话索引；切换 session 后无法找回作品 | HIGH | 增加服务端历史摘要接口与“创作历史”入口 | M |
| 2 | recovery | 通过 URL 恢复 session 后没有同步 localStorage，下一次直接访问可能回到旧 session | HIGH | URL session 优先时同步 session storage，并让新建剧集使用新 URL | S |
| 3 | clarity | 没有当前会话、阶段、确认进度和更新时间，用户无法判断作品是否仍在保存 | MED | 历史项展示状态、进度、阶段、更新时间；当前项标记“当前会话” | S |
| 4 | error | 历史接口加载失败或无记录时没有专用状态 | MED | 增加加载、空状态和失败重试状态 | S |

notes: 未做完整屏幕阅读器审查；本次先覆盖键盘焦点、可见按钮、aria 标签和可操作恢复路径。
verdict: 先修复 1-2，再补齐 3-4；不把不存在于服务端的旧内存数据伪称为可恢复。
