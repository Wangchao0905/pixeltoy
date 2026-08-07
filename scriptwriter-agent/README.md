# Pixel Writer v3.0

中文短剧编剧服务。双模型反射闭环：GPT 主笔产出剧本，DeepSeek 负责审核（按 `facts/humanizer-zh.md` 的 21 个 AI 腔模式 + `facts/文风契约.md` 五条契约逐条检查），审核意见回灌修正，迭代至通过。

## 特性

- **零依赖**：纯 Python 标准库（`http.server`），无第三方包安装。
- **双模型**：
  - GPT 主笔：OpenAI 兼容网关（`GPT_BASE_URL` / `GPT_API_KEY` / `GPT_MODEL`）。
  - DeepSeek 审核：官方端点，不走网关（`DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL`）。
- **反射闭环**：主笔产出 → 审核逐条引用模式编号 → 回灌修正 → 再审核。
- **审核契约**：
  - `facts/humanizer-zh.md`：中文 AI 腔 21 个检查模式（M01–M21）。
  - `facts/文风契约.md`：短剧对白五条契约（口语化 / 短句 / 潜台词 / 角色语言差异化 / 每场景有转折）。

## 目录结构

```
scriptwriter-agent/
├── server.py          # HTTP 服务入口（Web UI + API）
├── engine.py          # 确定性流水线 + 反射闭环引擎
├── llm.py             # 双模型调用封装（读 .env）
├── docx_export.py     # 纯 Python 零依赖 docx 导出
├── facts/
│   ├── humanizer-zh.md   # 审核契约：21 个 AI 腔检查模式
│   └── 文风契约.md        # 短剧对白写作契约
├── tests/             # 单元测试（unittest）
├── ui/                # 前端页面
└── projects/          # 剧本项目数据（git 忽略）
```

## 配置

复制 `.env.example` 为 `.env` 并填入密钥：

```bash
cp .env.example .env
```

`GPT_API_KEY` 是网关密钥；`DEEPSEEK_API_KEY` 是 DeepSeek 官方密钥。

## 运行

```bash
python3 server.py --port 8877 --no-browser
```

访问 `http://localhost:8877`。

## 测试

```bash
python3 -m unittest discover -s tests -v
```

## 环境要求

- Python 3.9+（标准库，无第三方依赖）
- 网络可访问 GPT 网关与 DeepSeek 官方 API

## 部署（git 流程）

生产机 `/home/ubuntu/apps/scriptwriter-agent` 为 git 仓库，服务由 pm2 管理（应用名 `pixel-writer`，端口 8877）。

> **远端地址待确认**：下方以 `git@github.com:Wangchao0905/scriptwriter-agent.git` 为占位，首次部署前需向仓库所有者确认实际地址。

**首次部署**（生产机现有 v2.0，先备份再切换）：

```bash
# 本地：推送新仓库
cd scriptwriter-agent
git remote add origin git@github.com:Wangchao0905/scriptwriter-agent.git  # 或用户指定远端
git push -u origin main

# 生产：备份 v2.0 → 全新克隆 → 装配置 → 启动
ssh ubuntu@101.42.111.251 'cp -r /home/ubuntu/apps/scriptwriter-agent /home/ubuntu/apps/scriptwriter-agent-v2-backup && rm -rf /home/ubuntu/apps/scriptwriter-agent && git clone <repo> /home/ubuntu/apps/scriptwriter-agent && cd /home/ubuntu/apps/scriptwriter-agent && cp .env.example .env && pm2 restart pixel-writer'
```

> **密钥注意**：`.env.example` 中的 key 均为占位符。部署时必须在 `.env` 里填入真实的 DeepSeek key（官方端点 `https://api.deepseek.com/v1`，即 `DEEPSEEK_BASE_URL` 指向处）与 GPT 网关 key。若本仓库曾在公开环境托管过真实 key（如历史提交含 `DEEPSEEK_API_KEY=sk-...` 真实值），请立即在 DeepSeek 控制台轮换该 key，并确认 `.gitignore` 已将 `.env` 排除出仓库。

**日常更新**（改动已提交并推送后）：

```bash
ssh ubuntu@101.42.111.251 'cd /home/ubuntu/apps/scriptwriter-agent && git pull && pm2 restart pixel-writer'
```

**验证**：

```bash
curl -s http://localhost:8877/api/project?project_id=nonexistent | head -1
pm2 status pixel-writer
```
