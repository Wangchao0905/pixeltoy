# ChatCut 服务器队列与独立 Agent

## 目标

Pixel Toys 不再依赖用户电脑上的 Codex 持续运行。每集剪辑请求先写入本集的：

```text
12_chatcut/chatcut_job.json
```

线上 Node 服务启动后会轮询队列。队列任务由独立 ChatCut Agent 执行，导出视频后由 Pixel Toys 自动导入，最后仍需要人工确认本集。

```text
准备制作包
  -> 提交服务器队列
  -> 独立 Agent 读取剧本/分镜约束并调用 ChatCut
  -> 写入 12_chatcut/exports/
  -> Pixel Toys 自动导入
  -> 人工确认本集
```

## 为什么不能复用本地 Codex 登录

ChatCut 插件使用 MCP 连接器 OAuth。Pixel Toys 不读取 Codex 的 OAuth 文件，也不把用户登录态复制到服务器。线上 Agent 必须使用单独的服务账号和自己的授权管理方式。

## 执行器配置

二选一。未配置时，任务仍会写盘，但不会执行任何 ChatCut 网络调用。

### 同机 Agent 命令

适用于 Agent Worker 和 Pixel Toys 在同一台服务器、共享项目文件的情况：

```env
CHATCUT_AGENT_COMMAND=/opt/chatcut-agent/run-job
CHATCUT_AGENT_POLL_MS=10000
CHATCUT_AGENT_TIMEOUT_MS=1800000
CHATCUT_AGENT_MAX_ATTEMPTS=2
CHATCUT_AGENT_CODEX_BIN=/home/ubuntu/.local/codex-agent/node_modules/.bin/codex
```

仓库提供的同机执行器是 `server/chatcut-agent-runner.js`。生产环境应按以下方式配置：

```env
CHATCUT_AGENT_COMMAND=node /home/ubuntu/apps/pixel-toy/server/chatcut-agent-runner.js
CHATCUT_AGENT_CODEX_BIN=/home/ubuntu/.local/codex-agent/node_modules/.bin/codex
```

首次联调可额外设置 `CHATCUT_AGENT_DRY_RUN=1`。它会验证制作包、任务参数和 Worker 状态回写，但不会调用 ChatCut、不会导出视频，也不会自动导入；验证完成后必须移除此变量，才能运行真实剪辑。

命令会收到以下环境变量：

```text
CHATCUT_JOB_ID
CHATCUT_JOB_FILE
CHATCUT_PACKAGE_DIR
CHATCUT_MANIFEST_PATH
CHATCUT_EDIT_BRIEF_PATH
CHATCUT_OUTPUT_DIR
```

命令必须在 stdout 最后输出一行 JSON：

```json
{"ok":true,"exportPath":"12_chatcut/exports/E01_chatcut.mp4","fileName":"E01_chatcut.mp4"}
```

### 独立 HTTP Agent

适用于 Agent 是单独的服务。Pixel Toys 会发送：

```env
CHATCUT_AGENT_URL=http://127.0.0.1:9321/v1/chatcut/jobs
CHATCUT_AGENT_TOKEN=<Pixel Toys 与 Agent 之间的内部令牌>
CHATCUT_AGENT_TIMEOUT_MS=1800000
```

请求使用 `Authorization: Bearer <CHATCUT_AGENT_TOKEN>`，JSON 内容包含：

```json
{
  "schemaVersion": 1,
  "jobId": "chatcut_...",
  "type": "chatcut-edit",
  "project": {"id": "...", "title": "..."},
  "sourceDigest": "...",
  "packageDir": "12_chatcut",
  "manifestFile": "12_chatcut/assembly_manifest.json",
  "editBriefFile": "12_chatcut/edit_brief.md",
  "packagePath": "/srv/pixel-toy/projects/.../12_chatcut",
  "manifestPath": "/srv/pixel-toy/projects/.../assembly_manifest.json",
  "editBriefPath": "/srv/pixel-toy/projects/.../edit_brief.md",
  "outputDir": "/srv/pixel-toy/projects/.../12_chatcut/exports"
}
```

HTTP Agent 必须在剪辑和导出完成后返回：

```json
{"ok":true,"exportPath":"/srv/pixel-toy/projects/.../12_chatcut/exports/E01_chatcut.mp4"}
```

HTTP Agent 与 Pixel Toys 需要共享制作目录，或者把导出文件同步到 Pixel Toys 可读的项目目录。返回的路径必须位于当前项目目录内，否则 Pixel Toys 会拒绝导入。

## 任务状态

```text
queued -> running -> succeeded
             \-> queued（可重试）
             \-> failed（达到最大重试次数）
```

进程重启后，超过 `CHATCUT_AGENT_STALE_AFTER_MS` 的 running 任务会自动恢复到 queued。相同 `sourceDigest` 的 queued/running/succeeded 任务不会重复提交。

## 当前安全边界

- 没有独立 Agent 配置时，`提交服务器队列` 只创建任务，不联网、不扣 ChatCut credits。
- Pixel Toys 不保存 ChatCut MCP OAuth token。
- 导出文件只能从当前项目目录导入，避免 Agent 返回任意路径。
- 自动导出后仍保留人工确认步骤，不自动发布成片。
