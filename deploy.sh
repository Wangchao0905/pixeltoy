#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/apps/pixel-toy
echo "== git fetch =="
git fetch origin main
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then echo "已是最新 ($REMOTE)"; exit 0; fi
# 拦截:生产有未提交改动(多半是有人 scp 盲改)→ 停,逼走 git
if [ -n "$(git status --porcelain -uno)" ]; then
  echo "✗ 生产有未提交改动(疑似直接 scp),先入库再部署:"
  git status --porcelain -uno
  exit 1
fi
echo "== 备份 server.js =="
mkdir -p .deploy_bak
cp server.js ".deploy_bak/server.js.$(date +%Y%m%d-%H%M%S)"
echo "== 更新到 origin/main =="
git reset --hard origin/main
[ package-lock.json -nt node_modules ] && npm ci --omit=dev || true
node --check server.js
echo "== 重启 =="
# Asset/storyboard workers are detached and persist their result markers on disk.
# Do not let PM2's process-tree cleanup kill an in-flight generation during deploy.
pm2 restart pixel-toy --update-env --no-treekill
sleep 3
curl -fsS -o /dev/null http://localhost:4317/ && echo "✓ 部署成功,服务健康" || { echo "✗ 健康检查失败,检查 pm2 logs"; exit 1; }
curl --retry 10 --retry-delay 1 -fsS -o /dev/null https://pixeltoy.cn/ && echo "✓ HTTPS 首页可访问" || { echo "✗ HTTPS 首页检查失败"; exit 1; }
