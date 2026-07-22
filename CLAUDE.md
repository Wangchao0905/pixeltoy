# Pixel Toys / Claude Code 入口

在处理方舟私域虚拟人像、画布认证、人物素材引用或批量视频参考图之前，先阅读：

- `docs/CLAUDE_CODE_VIRTUAL_PERSON_HANDOFF.md`

该文档记录了昨天下午已完成的流程、状态字段、服务端和前端入口、模型边界、环境变量名称以及回归测试。当前实现已经落在共享工作区中，不要重新设计一套认证流程，也不要把 AK/SK 或其他密钥写入仓库、日志或交接文本。

相关改动应保持以下约束：

- 方舟人物绑定使用独立的 `arkPersonAsset` 状态；不要与 Gravitex 的 `assetUrl` 或 `validationStatus` 混用。
- 仅 `seedance-2-0`、`seedance-2-0-fast`、`seedance-2-0-mini` 使用方舟 `asset://` 人物素材；`seedance-2-0-person-reference` 继续走 Gravitex。
- 画布生成的 AI 写实人物图可自动认证；普通手动导入图片不要自动认证。
- 提交批量视频前必须完成参考图预检，缺图或验证失败时阻止提交，不能静默删除引用后继续生成。

验证入口见交接文档中的回归测试列表。
