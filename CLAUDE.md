# Pixel Toys / Claude Code 入口

在处理方舟私域虚拟人像、画布认证、人物素材引用或批量视频参考图之前，先阅读：

- `docs/CLAUDE_CODE_VIRTUAL_PERSON_HANDOFF.md`

该文档记录了昨天下午已完成的流程、状态字段、服务端和前端入口、模型边界、环境变量名称以及回归测试。当前实现已经落在共享工作区中，不要重新设计一套认证流程，也不要把 AK/SK 或其他密钥写入仓库、日志或交接文本。

相关改动应保持以下约束：

- 方舟人物绑定使用独立的 `arkPersonAsset` 状态；不要与 Gravitex 的 `assetUrl` 或 `validationStatus` 混用。
- 仅 `seedance-2-0`、`seedance-2-0-fast`、`seedance-2-0-mini` 使用方舟 `asset://` 人物素材；旧的 `seedance-2-0-person-reference` 只允许在读取历史画布时迁移到普通 `seedance-2-0`，不得作为现行模型暴露或提交。
- 画布生成的 AI 写实人物图可自动认证；普通手动导入图片不要自动认证。
- 提交批量视频前必须完成参考图预检，缺图或验证失败时阻止提交，不能静默删除引用后继续生成。

验证入口见交接文档中的回归测试列表。

## 前端缓存戳

- 改了 `public/styles.css` 或 `public/app.js`，**必须同步更新 `index.html` 里对应的 `?v=` 缓存戳**，否则用户浏览器继续读旧文件，改动等于没上线。
- 部署后如仍显示旧样式，让用户 `Ctrl+Shift+R` 硬刷一次。

## 测试规则

- **改动凡涉及缓存戳文件（`styles.css?v=`、`app.js?v=`），必须跑全量 `npm test`，不能只跑相关测试。**
  教训来源：2026-07-25 `313bf8b` 改样式换戳后，`asset-inspector-ui.test.mjs` 里硬编码精确戳值的断言挂掉，Codex 和审查都只跑了 studio/chatcut 相关测试，漏掉了这条，导致测试链在已部署代码上是红的。
- 测试文件里**不要硬编码缓存戳的精确取值**；用正则校验戳存在（`/styles\.css\?v=[A-Za-z0-9._-]+/`）即可，否则每次正常换戳都会让断言失败。
