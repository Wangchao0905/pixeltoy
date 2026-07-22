# 给另一台 Codex 的协作说明

我们俩(本机 Claude + 你这台 Codex）在改同一个项目、部署到同一台生产。
之前各自用 scp 直接覆盖生产文件，已多次互相删掉对方的功能、还导致过生图卡死。
现在已改为 **以 GitHub 为唯一中枢的 git 部署**。请你也切到这个流程，**停止 scp/rsync 覆盖生产**。

## 基本信息
- 仓库（私有）：`git@github.com:Wangchao0905/pixeltoy.git`，主分支 `main`
- 生产目录：`ubuntu@101.42.111.251:/home/ubuntu/apps/pixel-toy`
- 生产已是 git 工作副本，并配了只读 Deploy Key，能 `git pull`
- 生产当前 = 仓库最新（含：资产解析加速、拖拽重分类+确认门槛、ERR_HTTP_HEADERS_SENT 修复，
  以及你之前做的 reference-kits、工作区模式、首页/登录页重设计）

## 每次改动的标准流程
```sh
# 1) 本地先同步对方的改动（重要，避免冲突）
git pull --rebase origin main
# 2) 改代码 …… 然后提交
git add -A && git commit -m "说明改了什么"
# 3) 推到 GitHub
git push origin main
# 4) 部署：SSH 到生产，跑一键脚本
ssh ubuntu@101.42.111.251
cd /home/ubuntu/apps/pixel-toy && ./deploy.sh
```

`deploy.sh` 会自动：fetch → 备份 server.js → `git reset --hard origin/main` →
`node --check` → `pm2 restart` → 健康检查。

## 三条硬规则
1. **不要再 scp/rsync 覆盖生产。** 所有改动必须先进 GitHub。
   - `deploy.sh` 一旦发现生产有“未提交改动”（就是有人 scp 了），会**直接中止报错**，
     逼着走 git。别绕过它。
2. **push 前先 `git pull --rebase`**，把我的改动合进来，冲突在你本地 git 层解决，别到生产上撞。
3. **不要提交数据/密钥/大媒体**：`.env*`、`.pixel-toys-*.json`、`projects/`、`outputs/`、
   `*.mp4`、`node_modules/` 等已在 `.gitignore` 排除，保持这样。

## 如果遇到冲突
- `git pull --rebase` 报冲突：正常解决冲突文件后 `git rebase --continue`。
- `deploy.sh` 报“生产有未提交改动”：说明生产被直接改过。**先把那份改动整理进 git**
  （在本地对齐后 push），不要 `git reset --hard` 直接丢弃——那可能删掉未入库的线上修复。
  拿不准就先同步一下人。

有疑问同步一下，避免又各改各的。
