# Codex 任务：Super Pixel 资产库侧栏（唯一剩余任务）

## 现状

**前两件事已完成，别重做：**

- 图片入对话已上线。`e8c4ae7` 含 server.js 内联逻辑 + 前端附件盘，
  线上 https://pixeltoy.cn 缓存戳 `super-pixel-images-20260726` 已生效
- 本地拖入 / 截图粘贴 / 点选文件三条路都已验证：真浏览器实测模型能正确读出图片颜色
- `scripts/super-pixel-image.test.mjs` 已入库并挂进 `npm test`，39 项全绿

## 你在隔离 worktree 里工作

主仓库有另一个 Codex（ChatGPT 桌面版）正在改 modern studio 制作台，改的是
`public/app.js` / `public/index.html` 这两个文件里 `modern*` 前缀的那部分。
为了不对撞，你在独立 worktree 里做，物理隔离。

**规矩：**

- 只改 Super Pixel 相关的代码，`modern*` 前缀的一律别碰
- 提交只提你自己的改动
- **不要 push、不要部署**。你做完提交在分支上就停，由我来合回 main
  （主仓库那边还在动，合并时机我来判断）
- 你的分支名和 worktree 路径在下面「运行环境」里

## 运行环境（worktree 已备好，别重新装）

- worktree 路径：`/Users/wangchao/Documents/Codex/2026-06-16/sp-sidebar`
- 分支：`feat/super-pixel-asset-rail`
- `.env.local`（含 API key）和 `node_modules` 已经从主仓库软链/复制过来了，
  `npm test` 和 `node server.js` 直接能跑。**别再 npm install**
- 起本地服务用 `PORT=4396 node server.js`，别占 4394（主仓库在用）

部署不用你管，我来做。

## 任务：资产库做成侧栏

用户要的是「资产图能从资产库或本地直接拖进对话框参与对话」。本地拖入 / 粘贴 / 选择文件
我已经做完并验证过了。**资产库拖入做不了**，因为四个 explore 视图互斥：

`setExploreView`（`public/app.js:2477`）一次只显示一个视图，
`#assetLibraryView` 和 `#superPixelView` 永远不会同时可见，拖不动隐藏视图里的卡片。

用户已确认：**资产库做成侧栏**。所以要在 Super Pixel 视图里加一个常驻资产侧栏，
让卡片能拖到 composer 上。

现成的可以复用，别新造（行号是刚校准过的，你自己提交后可能再漂，按函数名找更稳）：

- 资产卡片的 `dragstart` 已经写好了（`bindManualAssetControls`，`public/app.js:4771`），
  已经往 `dataTransfer` 里塞了 `text/plain`=assetId 和自定义 MIME
  `application/x-pixel-toys-asset-type`
- composer 的 drop 监听已经在了（`isFileDrag`，`public/app.js:2761`），现在只认 `Files`；
  加一个分支认上面那个自定义 MIME，从 assetId 反查图片 URL 即可
- 附件盘 `addSuperPixelAttachment({ url, preview, name })`（`public/app.js:2632`）
  已经写好，直接调；它内部已带 8 张上限和去重
- 服务端 `superPixelInlineImage`（`server.js:20556`）负责把图转成内联 base64，
  侧栏拖进来的资产图不用你另写解析

## 铁律：图片必须内联 base64，不要转公网 URL

这是我踩过的坑，实测数据（直连 `api.apikey.fun`，claude-opus-5）：

| 图片形式 | 结果 |
|---|---|
| data URL（内联 base64） | ✅ 模型正确答出图片颜色 |
| 公网 https URL | ❌ 模型回「我没有收到图片」 |

上游**不会去抓远程图片链接**。所以 `superPixelInlineImage`（server.js）走的是
「任何来源 → 本地文件 → `fileToDataUrl` 内联」。

**不要改成 `assetUrlToReferenceUrl`。** 那个函数是把图转成 S3 公网 URL 的，
给 Seedance 视频参考图用（Seedance 要求公网可读），和对话看图的要求**正好相反**。
我一开始照搬了它，结果模型一直说收不到图。`scripts/super-pixel-image.test.mjs`
里有断言锁死这个方向，别绕过它。

侧栏拖进来的资产图如果是 `/public-assets/xxx` 或 S3 公网地址，
`localPublicAssetPathFromUrl` 能按 basename 反查回本地镜像文件，不用走网络。
`asset://` 开头的没有本地文件，会被跳过（这是已知限制，不是 bug）。

## 验证要求

- `npm test` 全绿
- 真浏览器验证侧栏拖入：拖一张资产图到 composer → 附件盘出现缩略图 →
  发送 → 模型能正确描述图片内容。**必须验证模型真的看到了图**，
  不能只看到附件盘有缩略图就算过（我第一版就是 UI 全对但模型收不到图）
- 拿 `getBoundingClientRect()` 确认缩略图和删除键不是零尺寸
  （全站 `button{min-height:36px}` 会撑大小圆点，我已经在 CSS 里清零了）
- 部署后线上复验一次

## 已知的验证陷阱

- explore 首页默认隐藏，`exploreEnabled` 来自 `/api/projects` 的 `ui.exploreEnabled`，
  未登录时整个 explore 区不渲染。Playwright 里必须**先设 cookie 再 goto**，
  设 cookie 之后 `reload` 也行；顺序错了会看到入口存在但 `offsetParent` 为 null
- 如果上一次会话用过 `page.route` mock，它会残留并拦截 `/api/projects`
  返回假数据（我被这个坑了十几分钟，症状是 `{"projects":[]}` 且没有 `ui` 键）。
  开测前先 `page.unrouteAll()`
- 缓存戳：`public/index.html` 里 `styles.css?v=` 和 `app.js?v=` 两处必须同步改，
  现在是 `super-pixel-images-20260726`
- 测试如果要注入会话，`.pixel-toys-users.json` / `.pixel-toys-sessions.json`
  改完必须还原，别提交进去
- `/media?path=` 有 `allowedPath` 校验，测试用的临时图必须放在工作区内，tmpdir 会被拒
