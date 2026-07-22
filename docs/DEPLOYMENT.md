# Pixel Toys 部署入口

生产部署唯一入口是仓库根目录的 `deploy.sh`。服务器上的生产工作副本从 `Wangchao0905/pixeltoy` 的 `main` 拉取代码，再在服务器本地完成未提交改动检查、备份、校验和 PM2 restart。

## 协作方式

1. Claude 或 Codex 在 `main` 上先 `git pull --rebase origin main`，再提交并推送到 `Wangchao0905/pixeltoy`。
2. 执行：`ssh ubuntu@101.42.111.251 'cd /home/ubuntu/apps/pixel-toy && ./deploy.sh'`。
3. `deploy.sh` 先检查线上是否存在未提交改动，再 fetch `origin/main`、备份 `server.js`、更新代码、执行语法检查并重启 `pixel-toy`。
4. 脚本通过 `http://localhost:4317/` 健康检查确认服务已启动，再用 HTTPS 检查首页和六个视频 URL。

部署不使用 `scp` 或 `rsync` 覆盖生产。脚本只更新 Git 跟踪的代码，不提交或主动清理 `.env.local`、用户账号、项目、生成结果、会话和其他运行数据。备份保存在 `.deploy_bak/`。

首页视频属于生产公开媒体，当前按仓库约定不入 Git；部署脚本会检查服务器上的六段视频和六张 poster 仍然存在，并验证它们可访问。

## 本地验证

```bash
npm ci
npm test
```

`npm test` 只做无副作用的 source、构建、首页契约和生产不变量检查，不会调用图片或视频生成 API。
