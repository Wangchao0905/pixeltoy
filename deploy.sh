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
PREV=$LOCAL
echo "== 备份 server.js =="
mkdir -p .deploy_bak
cp server.js ".deploy_bak/server.js.$(date +%Y%m%d-%H%M%S)"
echo "== 更新到 origin/main =="
git reset --hard origin/main
# 依赖残缺也必须中止，不允许带病重启（历史上 || true 曾吞掉 npm ci 失败）。
[ package-lock.json -nt node_modules ] && npm ci --omit=dev
node --check server.js
echo "== 重启 =="
pm2 restart pixel-toy --update-env --no-treekill
sleep 3

rollback() {
  echo "✗ 健康检查失败，回滚到 $PREV"
  git reset --hard "$PREV"
  pm2 restart pixel-toy --update-env --no-treekill
  sleep 3
  curl -fsS -o /dev/null http://localhost:4317/ || { echo "✗ 回滚后服务仍不可用，检查 pm2 logs"; exit 1; }
  echo "✓ 已回滚到 $PREV"
  exit 1
}

# 关键配置存在性检查（只查变量名是否在 .env.local 中，不打印值）。
# deepseek 401 事故曾因 DEEPSEEK_API_BASE_URL 指向网关而 key 不匹配导致，
# 这里至少保证部署后关键配置没有被误删。
if [ ! -f .env.local ]; then echo "✗ .env.local 缺失"; rollback; fi
for var in DEEPSEEK_API_KEY DEEPSEEK_API_BASE_URL PIXELTALE_GEMINI_MODEL PIXELTALE_GEMINI_API_KEY XAI_API_KEY; do
  grep -qE "^${var}=" .env.local || { echo "✗ .env.local 缺少 ${var}"; rollback; }
done

curl -fsS -o /dev/null http://localhost:4317/ && echo "✓ 部署成功,服务健康" || rollback
curl --retry 10 --retry-delay 1 -fsS -o /dev/null https://pixeltoy.cn/ && echo "✓ HTTPS 首页可访问" || rollback
