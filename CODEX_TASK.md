# Codex 任务：Super Pixel 阶段 2 —— 接真实模型对话（流式）+ 剧本上传 + Ask/Agent 落地

## 现状

线上 `c7919b2`，https://pixeltoy.cn 管理员登录 → 首页导航 Super Pixel 可见。
阶段 1 已完成：页面布局、暗红视觉、6 个模型选择器、Ask/Agent 下拉、4 个场景 chips、
4 张虚线空白卡。**但没有任何后端**，提交按钮只弹 `toast("Super Pixel 即将上线")`。

工作区干净，`npm test` 全绿。改之前先 `git pull`。

## 三件事（按依赖顺序做）

1. **服务端 `/api/super-pixel/chat` + 流式 SSE**，前端渲染消息气泡
2. **剧本上传**（现在 `＋ 剧本` 只弹 toast），解析后作为对话上下文
3. **Ask / Agent 模式落地**（现在两个模式只存 state，行为完全一样）

## 第一优先：安全边界（不是可选项）

**当前的权限控制只是前端隐藏入口，不是安全边界。**
接口一上线，任何人都能直接 `curl -X POST https://pixeltoy.cn/api/super-pixel/chat`
调用模型、烧掉 API 额度。所以新接口的第一行就必须做服务端鉴权。

复用现成的，不要新造：

- `isAdminUser(user)` —— server.js:337
- `requireAuth(req, res, url)` —— server.js:692
- 现成的 403 先例 —— server.js:20535：
  `if (!adminUser || !isAdminUser(adminUser)) return fail(res, 403, "需要管理员权限");`

照抄这个模式。**做完必须验证**：未登录和普通用户 curl 都要拿到 403，不能只测管理员通路。

前端那三层（入口默认 `class="hidden"`、`syncAuthUser` 按 role 切换、`openExploreTool`
内二次拦截）保留，别删——测试有断言守着。它们是体验层，服务端那道才是安全层。

## 流式 SSE：全库零先例，这三个坑一定会踩

我查过了，`text/event-stream` 在整个 server.js 里**一处都没有**，你是第一个做流式的。
现有的 5 处 `chat/completions` 调用（8759 / 8895 / 15177 / 15262 / 15705 行）全是非流式，
可以抄它们的鉴权和错误处理，但**流式部分没有先例可抄**。

### 坑 1：nginx 默认缓冲会让流式失效（最容易被误判为「代码没问题」）

生产 nginx（`/etc/nginx/sites-enabled/pixel-toy`）**没有配 `proxy_buffering off`**。
默认缓冲下，你的 SSE 会被 nginx 攒住，前端看到的仍然是「等很久，然后一次性全出来」——
本地直连 4317 端口测是好的，一上线就不流式了，非常容易误判成前端问题。

**推荐解法：在 Node 响应头里加 `X-Accel-Buffering: no`。**
nginx 认这个头并对该请求关闭缓冲，不需要动 nginx 配置、不需要 sudo、不需要 reload，
也不影响其它接口。改 nginx 配置是生产基础设施变更，风险大得多，别为这个去动它。

必要响应头：

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`proxy_read_timeout 300`（已配）对对话够用，不用改。

### 坑 2：客户端断开后上游请求还在跑，继续烧额度

用户关标签页或切走，`res` 就废了，但你发给 apikey.fun 的 fetch 还在继续。
必须监听 `req.on("close")` 并 abort 上游（用 `AbortController`），否则每个被放弃的
对话都在静默消耗额度。

### 坑 3：两家供应商的流式响应格式不同

Claude 和 GPT 走的都是 `openAiCompatUrl("/v1/chat/completions")`（apikey.fun 网关，
OpenAI 兼容），所以理论上都是 `data: {...}` + `data: [DONE]`。
**但你必须实测确认两边 delta 结构一致**，别假设。至少各跑一个模型验证。

## 可复用的现成代码（别重写）

| 需要的东西 | 已有的 | 位置 |
|---|---|---|
| 管理员校验 | `isAdminUser` | server.js:337 |
| 登录态 | `requireAuth` | server.js:692 |
| 读请求 body | `readBody(req)` | server.js:856 |
| 调模型的 URL 拼装 | `openAiCompatUrl("/v1/chat/completions", "storyboard")` | 见 8895 行用法 |
| docx 文本提取 | `extractDocxText(buffer, filename)` | server.js:2353 |
| 前端读文件 | `FileReader` + docx 分支 | app.js:1174-1196 |
| 已有的剧本上传 UI 先例 | `#scriptUpload`（已支持 .md/.txt/.docx） | index.html:324，绑定在 app.js:7139 |

路由风格是原生 `http.createServer`（server.js:21513），不是 express。
新路由照 `if (req.method === "POST" && url.pathname === "/api/super-pixel/chat")` 这种写法加。

## 模型 ID（已实调验证，别改）

前端选择器 6 项，这些 ID 我都向 api.apikey.fun 发过真实 `chat/completions` 并拿到 200：

`claude-opus-5`、`claude-sonnet-5`、`claude-haiku-4-5`、
`gpt-5.6-terra`、`gpt-5.6-sol`、`gpt-5.6-luna`

Claude 用 `ASSET_ANALYZER_API_KEY`，GPT 用 `STORYBOARD_API_KEY`（`.env.local`，都指向
`https://api.apikey.fun/v1`）。**服务端要按选中的模型路由到对应的 key**，
用错 key 会 401。别把 key 写进仓库、日志或前端。

## Ask / Agent 模式

现在 `state.superPixel.mode` 只存值，两个模式行为完全一样。落地前先定义清楚：

- **Ask**：纯对话，只回文本，不碰项目数据。建议先做这个，风险低。
- **Agent**：能调工具（建剧集、写分镜、拉素材……）。
  **这个要谨慎**：Agent 若能写项目数据，就意味着模型输出能直接改用户的东西。
  建议第一版只允许「读 + 提议」，真正的写操作要用户点确认再执行，不要让模型直接落库。

如果你觉得 Agent 的工具边界不清楚，**先只做 Ask，把 Agent 留成 disabled 选项**，
并在交接里说明——不要凭猜实现一套工具调用。

## 剧本上传

`＋ 剧本` 按钮现在是 `app.js:2537` 的 `toast("剧本上传即将上线")`。
照 `#scriptUpload`（app.js:7139 / index.html:324）那套做：`.md/.txt/.docx`，
docx 走服务端 `extractDocxText`。解析出的文本作为对话上下文。

注意剧本可能很长，要考虑截断或摘要，别把十万字直接塞进 prompt 打爆上下文。

## 收尾（必做）

- **缓存戳**：改了 `public/styles.css` 或 `public/app.js`，必须同步 `index.html` 里
  css 和 js **两处** `?v=`（当前 `super-pixel-tune-20260725`）。
  CLAUDE.md 明文规定，漏了等于没上线。
- 测试：`node scripts/super-pixel-view.test.mjs` + `npm test` 全绿才能提交。
  现有断言守着权限三层、模型 6 项、暗红配色作用域、发送键 min-height==height，别撞。
- 新功能要补测试。服务端鉴权尤其要测：未登录 403、普通用户 403、管理员 200。
- 部署：`git push origin main` 然后
  `ssh ubuntu@101.42.111.251 'cd /home/ubuntu/apps/pixel-toy && bash deploy.sh'`。
  脚本会 `git reset --hard origin/main`，所以必须先入库，别 scp。

## 铁律

- 单次 Write/Edit ≤50 行。不引第三方库。
- 暗红配色只能活在 `.super-pixel-view` 作用域，`--sp-*` **不得**进 `:root`（会污染
  studio/canvas 蓝调主题，测试有断言）。
- CSS 里的 `font` 简写**不要**写成 `font: 400 14px/1.5 inherit` —— family 位不接受
  `inherit`，整条声明会被浏览器静默丢弃。我上一版这么写，6 处字号全部失效回落到 16px，
  查了半天才发现。用 `font-size` / `font-weight` / `line-height` 独立属性。
- 缩小按钮/选择框时，`height` 单独写不生效：全站 `button{min-height:36px}`、
  `select{height:38px}` 会压过去，必须连 `min-height` 一起覆盖。
- SVG data URI 只能写在 CSS 里并保持百分号编码，**不要**放进 HTML 内联 `style=""`
  （引号会被撕断，`encodeURIComponent` 也救不了）。

## 验证时必读：零尺寸会让断言假通过

我在这个页面上被坑过两次，同一个模式：祖先元素 `display:none` 时后代全部测出 **0×0**，
而「宽高相等 → 正圆」「所有中心点相同 → 单行」这类判定在全是 0 时**一律为真**。
我有一轮四个指标齐刷刷通过，实际什么都没测到，是假绿。

浏览器里量尺寸前先加零值拦截：

```js
const zero = [['input', inp.getBoundingClientRect().width], ['send', send.width]]
  .filter(([, v]) => v <= 0).map(([k]) => k);
if (zero.length) return { INVALID: '零尺寸: ' + zero.join(',') };
```

另外：静态起 `public/` 没有后端，`/api/auth/me` 404 → 鉴权失败分支会隐藏 `#exploreHome`
和入口。要看到页面得手动 `classList.remove('hidden')` 再 `style.display='block'`，
或用 Playwright `page.route` mock `/api/auth/me` 返回 `role:"admin"`。
注意光 mock auth 不够——真实 `/api/projects` 有数据时 app 会切到项目工作区，
`#exploreHome` 还是会被隐藏，这个我踩过。

## 页面已知信息

- `#superPixelView` 与 `.canvas-home` / `#imageExploreView` / `#assetLibraryView` 同级互斥。
- 高度用 `calc(100vh - 44px)`（44px 顶栏），跟另两个视图一致。用 `100%` 无效（父级 auto 高度）。
- 工具条窄屏是 `flex-wrap: nowrap`，折行会把发送键甩到单独一行。
- 4 张虚线空白卡是占位，等真实内容。
- 视觉上用户已两次反馈「背景太亮」，我压过三轮（底色 #120409、遮罩 82%/42%、
  光晕 alpha 0.16、蜂窝 tile 20.8×36）。**用户还没最终确认这轮够不够暗**，
  如果他再提，调光晕 alpha 或蜂窝线色，别动布局。
