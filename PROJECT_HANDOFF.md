# Pixel Toys Project Handoff

Last updated: 2026-07-04（第二轮:画布出图通道+Midjourney 折叠布局+独立画布画廊+资产生成门槛/防闪/photoreal 负向 等一大批。全部已部署到远程生产。见下方「2026-07-04 第二轮」）

This file is the recovery card for continuing Pixel Toys from a new chat.
持久记忆(每次会话自动加载)见 `~/.claude/projects/-Users-wangchao/memory/MEMORY.md`,里面有更细的分条:[[pixel-toy-runs-on-remote]]、[[pixel-toy-storyboard-board-format]]、[[pixel-toy-security-moat]]、[[pixel-toy-poll-rerender-guard]]、[[pixel-toy-tailframe-fix]]、[[pixel-toy-asset-classify-fix]] 等。

## ⚠️ 最重要:生产在远程,不是本地

- **用户实际使用的是远程生产**:`http://101.42.111.251/`(nginx → PM2 `pixel-toy`,监听 4317)。改代码前先确认在哪运行,别只改本地。
- 本地 `~/Documents/Codex/2026-06-16/codex-skill` 是**开发副本**;`npm start` / launchd `com.pixeltoys.local` 只用于本地调试。
- **部署流程**(只推代码,绝不碰数据):
  1. 本地 `node --check` + `npm test`(含 `scripts/self-check.mjs`,有一堆不变量断言,改设计要同步翻断言)。
  2. 备份:`ssh ubuntu@101.42.111.251 "mkdir -p ~/apps/pixel-toy/.deploy_bak/<TS>/... && cp ..."`。
  3. `scp` **仅改动的代码文件**到 `~/apps/pixel-toy/`(server.js / public/*.js / public/*.css / scripts/*)。**绝不** `--delete`,绝不覆盖 `projects/`、`.env.local`、`outputs/`、`data/`。
  4. 远程 `node --check` + `node scripts/self-check.mjs` → `pm2 reload pixel-toy --update-env` → `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/`(302 = 正常)。
- ssh 免密到 `ubuntu@101.42.111.251`。

## 关键护栏(保留)

- 不经用户明确同意,不提交任何付费图片/视频生成(Gravitex/Seedance/gpt-image 都要 credits)。
- 不把完整 API Key 写进文件/对话,只用 `.env.local`。
- 前端设计铁律:任何"生成后要自动刷新"的东西,必须同时进**轮询三件套**——① `/status`(projectStatusSnapshot)返回它 ② `mergeProjectStatus` 并进 state ③轮询函数 `refreshSelectedProjectStatus` 里调它的 render(且 render 要有签名守卫防闪)。详见 [[pixel-toy-poll-rerender-guard]]。

## Project Entry

- 远程生产:`http://101.42.111.251/`(nginx + PM2 `pixel-toy`)。
- 本地开发副本:`/Users/wangchao/Documents/Codex/2026-06-16/codex-skill`,`npm start`,`http://localhost:4317/`。
- 主服务:`server.js`(~17k 行);主 UI:`public/app.js`(直接下发不打包);画布:`public/canvas.js`;样式:`public/styles.css` / `public/canvas.css`;出图脚本:`scripts/run_asset_generation.js`;自检:`scripts/self-check.mjs`。
- 资产解析模型:claude-opus-4-8(经 apikey.fun 网关),失败自动切 gpt-5.5-thinking;故事板/分镜模型:gpt-5.5-thinking;出图:gpt-image-2。

## 2026-07-04 本轮改动(均已部署到远程生产)

1. **资产解析模型自动切换**:`callAssetAnalyzerModel`(server.js)——opus 超时(240s)/网关 fetch failed/5xx 时**立刻切 gpt-5.5-thinking**,不再死磕同一模型或摔回本地傻规则(避免"分不出人物场景/垃圾资产")。
2. **故事板整体改版**(推翻旧"16:9 横版 3×3 九宫格 9 格",见下方作废声明):
   - 整张板 = **9:16 竖版**;面板 **2 列自适应**——标准 6 格(2×3),节拍少时 4 格(2×2),不出现 5 格残行;**每板 ≤15 秒**剧情单元(`PRODUCTION_BOARD_MAX_SECONDS=15`)。
   - 弧线角色:建立→(站位/动作)→转折→反应→切点;跨板续接接口(末格=下一板起始帧)已留。
   - 落点:server.js(`storyboardPanelPlanForGroup`/常量/9:16尺寸表/job route/prompt/中文策略)+ `scripts/run_asset_generation.js`(模型契约/rescue/**PIL 本地兜底**改 2 列去资产栏)+ self-check 断言全翻。
   - 前端 UI 卡片:`public/styles.css` 的 `.storyboard-card img` / `.storyboard-missing-preview` + `body.is-studio` 那条 `!important` 全改 9:16;chip 文案更新。
3. **多租户隔离审计 + 补漏**:项目库按 owner 隔离(列表过滤 + `/api/project/:id/*` 统一 `assertUserCanAccessProject` 网关 + 路径穿越防护)。补了两处越权:`POST /api/canvas/tail-frame` 加 owner 校验;`POST /api/projects` 加归属护栏(防 reuse 进他人项目)。详见记忆 pixel-toy-security-moat。
4. **故事板轮询刷新修复**:`/status` 现在返回 `storyboards`+`storyboardSlots`,`mergeProjectStatus` 并入,轮询里调 `renderStoryboards`/`renderStoryboardJob`——Production Board 生成完不必手动刷新就自动变就绪(资产图此前已修,现两者一致)。

**下一步/验证**:页面强刷(Ctrl+Shift+R)后测故事板生成完是否自动显示;板从横改竖是推翻旧设计,**旧 16:9 板不会自动重画**,要重新生成才出竖版。

## 2026-07-04 第二轮（画布 + 资产大改，均已部署远程生产）

同一天的后续会话，改动很多，按模块分：

### 资产生成 / 制作台
1. **生成门槛从「confirmed」改为「有 items（提取过没）」**：`extractAssetManifest` 现在提取即 `confirmed=true`（自动确认）；三处门槛统一改成看 `items.length` 不看 confirmed——① 前端「生成资产图」按钮（renderAssetManifest）② 前端 `startJob` 拦截 ③ 服务端 `startToolJob`（原 `if(!manifest.confirmed) throw`）。**效果：只要提取出资产，随时来生成按钮都亮**，既有项目和新项目一致。`writeAssetManifest` 每次都同步 assetPrompts，故无副作用。
2. **单卡生成不再闪 / 不再跳顶 / 不卡**：
   - `renderAssets`/`renderStoryboards` 从「整格 innerHTML 重建」改为**按 key 逐卡复用** `reconcileKeyedCards`——只重建 sig 变化的那张卡，其余卡（含已加载 `<img>`）原地保留。每卡 sig 含 `asset.url`/生成态/选中/编辑草稿。
   - 提交生成（`regenerateAsset`/`regenerateStoryboard`/`startJob`）改走**轻量路径**：`renderAssetsFromState`/`renderStoryboardsFromState` + `scheduleProjectRefresh({immediate:true})`，不再调 `renderWorkspace()`+`loadProject()`（那俩会跑 setStudioTab/applyWindowLayout 把滚动弹回顶部 + 卡顿）。
3. **资产图卡片内联「加入/排除生成」开关**：每张卡右侧 −/+（复用 `toggleManifestAssetGeneration`，已改轻量渲染），缺失卡也有，生成前即可挑；排除的卡生成按钮变灰。
4. **超写实（photoreal）加负向约束**：生效路径 `compileAssetPromptForStyle → assetStyleDirective` photoreal 分支 + `styleFinalLock` 增加「禁止 3D/CG/卡通/插画/塑料蜡感 CG 皮肤/T-pose 模型转身」负向（修「超写实出 3D 画风」）。仅影响之后新生成。
5. **加载态空状态**：`renderAssets` 在 shell/加载阶段（`state.project.loading`）显示「正在加载资产」，不再闪误导的「还没有读取到资产图」；`loading` 已纳入 `assetRenderSignature`。

### 画布（generation canvas）
6. **画布出图通道打通（gpt-image-2）**：新 `POST /api/canvas/image-generation`（直接 spawn `IMAGE_GEN_SKILL_SCRIPT`/image-gen.js，`--mode text/image`，输出 `CANVAS_PUBLIC_ASSET_DIR`，返回 `/public-assets/...`）+ `GET /api/canvas/image-generations/:taskId` 轮询（内存表 `canvasImageJobs`）。图片节点：**尺寸(16:9/9:16/1:1)+分辨率(1K/2K/4K)** 选择、生成按钮已点亮、**可接收参考图连线**（放开 image/asset→image）、出图结果登记为画布资产入 `node.assets` 经 `upstreamAssetsForNode` 流向视频节点。
7. **连线悬停剪刀删除修复**：`.canvas-nodes` 加 `pointer-events:none` + `.canvas-node` 加 `pointer-events:auto`——原来节点层铺满画布拦截了对下方连线的 hover，`.connection-cut` 剪刀从不出现。现悬停连线即出 ✂ 可删。
8. **Midjourney 式节点内折叠 composer**：把视频节点已有的 `is-composer-open`+`activeVideoNodeId`+`setActiveVideoNode` **泛化到图片节点**——节点默认收起=纯预览卡，点击展开 prompt+控件，点空白收起，新建即展开。`nodePortPoint` 对 image/video 改为**测量实际端口元素位置**，收起/展开改高度时连线+剪刀仍对齐。
9. **图片节点拖拽缩放**：右下角缩放手柄（`data-resize-handle`），拖拽调 `node.width`（240–720，仅图片节点持久化）；框选本就支持图片节点。self-check 旧「不得有 resize handle」断言已翻成「资产节点不得 / 图片节点必须有」。

### 独立画布（?canvas=<id>，不绑剧本项目）
10. **命名 + 网格画廊入口**：画布状态新增 `name` + `ownerUserId`；新接口 `GET /api/canvas/blank-list`（带 `cover` 封面缩略图）、`POST /api/canvas/blank-delete`、`POST /api/canvas/blank-rename`，**全部按 owner 隔离**（写入时服务端按登录用户打 owner）。项目主页「空白画布」卡改成**网格画廊**：首格「新建项目」⊕（建 Untitled 并打开）+ 每格封面缩略图/标题/编辑时间，点击打开、hover ✕ 删除、双击标题就地重命名。
11. **画布 UI 细节**：入口卡文字左上对齐（`align-items:stretch`+`text-align:left`）；画布页 logo 螺旋桨对齐——`.canvas-mark` 改成和项目页同尺寸比例 `aspect-ratio:960/165`（螺旋桨 `::before` 是按此比例的百分比定位，比例不同就错位）。

### 本轮护栏 / 注意
- 画布出图、资产/视频生成**都要点按钮才触发（花 credits）**；实现期间未触发任何真实生成。
- 改设计务必同步翻 `scripts/self-check.mjs` 断言（本轮翻了资产列表逐卡复用、confirmed 门槛无关、resize handle、canvas brand 等多条）。
- 画布状态是**全局文件**（`CANVAS_STATE_DIR`），本轮给独立画布加了 `ownerUserId` 做列表隔离；episode 绑定画布仍走 `assertUserCanAccessProject`。

**验证**:F5 刷新。资产:提取后生成按钮即亮、点单卡生成不闪不跳、超写实出真人质感。画布:节点收起/展开、连线剪刀、图片节点出图+缩放+接参考图。主页:独立画布网格新建/打开/删除/重命名、logo 螺旋桨与项目页一致。

## How To Continue From A New Account

Open a new Codex session with this folder as the workspace:

```text
/Users/wangchao/Documents/Codex/2026-06-16/codex-skill
```

Then say:

```text
继续 Pixel Toys 项目。先阅读 PROJECT_HANDOFF.md，不要启动任何图片或视频生成。先检查当前服务、任务状态和最近失败日志，然后告诉我现状。
```

Recognition passphrase:

```text
灰光未熄，镜头继续。
```

If the user asks for the passphrase or says they are returning from another account, answer with this line first.

## Current State

- 项目**活跃开发中**(远程生产在跑,持续在改)。旧版这里写"暂停"已过时。
- 不经明确同意不启动任何图片/视频生成。
- Video preview clip 模块已刻意移除;只保留视频生成状态。
- 用户极其在意浪费 credits 和静默失败。
- 常复现的坑(都已修但要警惕):尾帧不被引用([[pixel-toy-tailframe-fix]])、分不出人物场景/垃圾资产([[pixel-toy-asset-classify-fix]] + 上面的模型切换)、生成后不自动显示(轮询三件套)、图片/视频闪烁(轮询重渲染守卫)。

## Active Work Area

Recent active project data is under:

```text
/Users/wangchao/Documents/Codex/2026-06-16/codex-skill/projects/untitled
```

Older completed episode outputs are under:

```text
/Users/wangchao/Documents/Codex/2026-06-16/codex-skill/outputs/rift_hollow_e03
/Users/wangchao/Documents/Codex/2026-06-16/codex-skill/outputs/rift_hollow_e04
```

## Most Recent Asset Generation Issue

The latest asset generation attempt was paused/canceled. Before pause:

- `C001_MERCY_CAIN_CHARACTER_SHEET` failed.
- The failure log reported `api_stream_error` and `upstream did not return image output`.
- Several other character sheets succeeded, so the API chain itself was working.
- Likely root cause: the Mercy prompt included terms that may trigger image provider filtering, such as active weapons, violent language, blood stains, bullet marks, and mixed Chinese fragments in an English prompt.

Before retrying, fix/sanitize the image prompt generation logic rather than manually retrying the same prompt.

## 2026-06-19 Style Control Update

- The asset style selector now separates `photoreal` (`超写实`) from `cg_3d` (`3D 渲染 / CG 质感`).
- Old cached/frontend/backend values `photoreal_3d` and `three_d` are aliases for `cg_3d`.
- For any non-`photoreal` style, generated asset prompts now remove conflicting legacy phrases such as `no CG look`, `no plastic CG look`, `no illustration look`, and `no cartoon style`.
- The CG style prompt explicitly avoids live-action photography and emphasizes visible 3D modeling, PBR shaders, ray-traced lighting, clean render geometry, and CG surface finish.
- No image or video generation should be started automatically after this change; the local service has only been restarted to load the new logic.

## 2026-06-19 Style Compiler Update

- Asset image generation now uses a style compiler in `server.js`, not incremental regex patching.
- Each submitted text-to-image code block is rebuilt as:
  1. selected visual style as the only active renderer,
  2. legacy style firewall,
  3. asset identity source,
  4. type-specific layout contract,
  5. type-specific negative constraints,
  6. final style lock.
- Legacy prompt text is now treated only as identity/story evidence. Old renderer words such as photorealism, live-action, no-CG, 3D animation, semi-realistic, cel, anime, pixel, clay, painterly, studio names, camera/lens terms, and Chinese equivalents are stripped from the identity source.
- Dry-run verification was completed for `cg_3d`, `ghibli_miyazaki`, and `pixel_art` using `C003_TOBY_FINCH_CHARACTER_SHEET`; the resulting identity source stayed identical across styles and no longer carried old renderer/style constraints.
- Keep this compiler as the single place for future style-control changes.

## 2026-06-19 Nine-Grid Storyboard Module

> ⚠️ **已作废(2026-07-04 起)**:故事板不再是 16:9 九宫格 9 格。现为 **9:16 竖版 2 列 4/6 格、每板 ≤15 秒**,且板上**不再画资产参考栏**(只有分镜格,资产靠 C/S/P/I 编号绑定)。以下九宫格描述仅作历史参考;当前设计见顶部「2026-07-04 本轮改动」第 2 条。


- Added a separate `Storyboard` asset type with stable `SB###_*_NINE_GRID_STORYBOARD` IDs.
- Uploaded nine-grid storyboard images are stored under `04_assets/storyboards`.
- The frontend now has a dedicated `九宫格分镜` module with target slots, upload binding, gallery preview, download, and lightbox preview.
- Storyboard slots are generated per scene from the confirmed scene assets; if no scene manifest exists yet, one full-episode storyboard slot is shown.
- Project state now returns `storyboards` and `storyboardSlots` separately from normal `assets`.
- Node map now includes a `storyboards` lane and a `九宫格` node between text storyboard planning and video shots.
- Video config now includes uploaded storyboard images in canvas `assets`, plus `storyboardReferences` and `storyboardPolicy`.
- Storyboard policy: use nine-grid images only for composition, blocking, camera direction, shot rhythm, and cut structure; do not copy black-and-white sketch style, hand-drawn texture, character identity, scene identity, or final visual style from storyboard references.
- Video shot `refs` still come only from Character, Scene, Prop, and Insert assets so storyboard sketches cannot replace final visual assets.
- When uploaded/generated nine-grid storyboards are enabled, they control composition, blocking, camera direction, shot rhythm, and edit continuity. In that mode, video shots must not also use first-frame or tail-frame continuity.
- Same-scene adjacent shots default to tail-frame continuity only when no storyboard reference is active for that shot; disable it explicitly when a hard cut is desired.

## 2026-06-25/26 Generation Canvas Module (节点式画布)

A standalone node-based generation canvas was added. This is separate from the main studio UI.

- Entry: `/canvas.html` (linked from studio top bar and rail buttons `openGenerationCanvas` / `openGenerationCanvasRail` in `public/index.html`). Carries `?project=<id>` so the canvas can load that project's assets.
- Frontend files: `public/canvas.html`, `public/canvas.js`, `public/canvas.css`.
- Two node types on a blank canvas:
  - Image Generator node: prompt, asset type (人物/场景/道具/故事板), quality (1K/2K/4K), reference dropzone, output port.
  - Video Generator node: prompt, model, ratio, resolution, duration slider (4-15s), audio toggle, input port, live preview slot.
- Nodes are created via right-click context menu, the bottom dock, or double-clicking a tray asset. Image node output ports connect (bezier links) into video node input ports; connected image assets auto-flow to the video node as reference images. Only image→video connections are allowed.
- Asset tray: import current project assets (characters/scenes/props/storyboards via `projectAssets()`), or upload local PNG/JPG/WEBP (read as data URLs). Assets drag onto node dropzones.
- Backend routes in `server.js`:
  - `POST /api/canvas/video-generations` → `createCanvasVideoGeneration`; current provider is Ark (`CANVAS_VIDEO_PROVIDER=ark`), with XLUO and Gravitex fallback paths still present.
  - `GET /api/canvas/video-generations/:taskId` → `getCanvasVideoGeneration` (polling, frontend polls every 5s).
  - `POST /api/canvas/liveness-face-session` → `createLivenessFaceSession` → Gravitex `/visual-validate/session` when `CANVAS_VIDEO_PROVIDER=gravitex`; opens H5 popup and listens for `gravitex-asset-validate-result` postMessage.
- Default XLUO video payload (`buildXluoVideoGenerationPayload`): converts canvas prompt/settings to `POST /api/v3/generations/video`; maps the first connected/uploaded image to `startFrameBase64` and the remaining images to `params.referenceImages`. Project `/media?path=...` assets are converted to data URLs server-side, so local project assets can be used as XLUO references.
- Ark payload (`buildSeedanceGenerationPayload`): builds multimodal `content` array (text + up to 9 `image_url` reference images). The text prompt appends Seedance-style `@图片1`, `@图片2` reference instructions in the same order as the `image_url` items, and all connected canvas images are sent with `role: "reference_image"`. Includes `model`, `duration`, `resolution`, `ratio`, `generate_audio`, optional `seed`/`watermark`.
- Liveness ("真人模型"): `seedance-2-0-liveness-face` is present in the video model dropdown. The frontend blocks generation until H5真人核验 returns `group_id`. The server maps this mode back to Gravitex-supported model `seedance-2-0`, then tries to find an active `asset://` image in the liveness group before generation.
- IMPORTANT — canvas state is NOT persisted: nodes, connections, and tray assets live only in browser memory + localStorage (`pixelToys.canvasProjectId`). Reloading clears the canvas layout. There is no server-side save of the canvas graph yet.
- IMPORTANT — the canvas video/liveness routes call live external APIs and will consume credits. Same no-auto-generation pause rule applies: do not trigger canvas video generation unless explicitly requested.

### Gravitex Seedance configuration (2026-06-26)

Current `.env.local` is set to:

```text
CANVAS_VIDEO_PROVIDER=gravitex
GRAVITEX_VIDEO_BASE_URL=https://api.gravitex.ai/v1
GRAVITEX_API_KEY=<configured locally, do not paste into docs>
```

Important: the key currently configured locally has been tested against Gravitex and is rejected by upstream as `Invalid token`.

Tests already performed:

- Local `POST /api/canvas/liveness-face-session` reaches Gravitex `/v1/visual-validate/session`.
- Direct Gravitex auth tests were run with:
  - `Authorization: Bearer sk-...`
  - raw `Authorization: sk-...`
  - `X-API-Key`
  - `Api-Key`
  - `Bearer` without `sk-`
- All returned HTTP 401 `Invalid token`.
- Conclusion: the code path is wired, but the current key is probably not a valid Gravitex API Token, is disabled/expired/quota-limited/IP-limited, or came from another provider/session system.

What to do next:

1. In Gravitex console (`https://maas.gravitex.ai`) create/copy a valid API key from 模型中心 / API 密钥.
2. Replace only `GRAVITEX_API_KEY` in `.env.local`.
3. Restart `node server.js`.
4. Safe auth test first:

```bash
curl https://api.gravitex.ai/v1/models \
  -H "Authorization: Bearer $GRAVITEX_API_KEY"
```

Do not trigger paid `/v1/video/generations` until the user explicitly approves a real generation test.

### Deploy note (2026-06-26)

The local service was restarted and is currently running as `node server.js` on port `4317`. Run `npm test` before future restarts. If stale assets/CSS appear in the browser, hard refresh the page.

### Canvas video gateway history → XLUO v3 / Ark / Gravitex

The canvas video nodes used to default to XLUO v3. Current provider is Gravitex. The previous external canvas platform has been removed from the app-level flow: the main studio now prepares assets, Production Boards, Seedance prompts, and video config; actual video generation happens only through `/canvas.html` video nodes.

- Current provider: `CANVAS_VIDEO_PROVIDER=gravitex`.
- Legacy XLUO provider: `CANVAS_VIDEO_PROVIDER=xluo`.
- Optional Ark fallback: `CANVAS_VIDEO_PROVIDER=ark`.
- XLUO base URL: `https://xluo.ai/api/v3`, override via `XLUO_API_BASE_URL` / `XLUO_BASE_URL`.
- XLUO create task: `POST /generations/video`. Poll: `GET /generations/{id}`. Auth: `Authorization: Bearer <key>`.
- XLUO model IDs: `seedance-2-0` → `ef719399-8b59-471e-b559-f2c6ea68e642`, `seedance-2-0-fast` → `21dd509b-d591-4862-aae9-ba584c98845d`, optional liveness model → `2965515c-99ef-4f99-9ae8-ac6a11edbb0e`. Override via `XLUO_SEEDANCE_MODEL`, `XLUO_SEEDANCE_FAST_MODEL`, `XLUO_SEEDANCE_LIVENESS_MODEL`.
- XLUO request body: `prompt`, `count`, `params.duration`, `params.orientation`, `params.resolution`, `params.model`, `params.audioGeneration`, optional `startFrameBase64`, optional `params.referenceImages`.
- XLUO API key env names checked: `XLUO_API_KEY`, `XLUO_AUTH_TOKEN`, `XLUO_TOKEN`. Add one to `.env.local` and restart. Without it, canvas video generation returns an auth error before any generation task is submitted.
- Ark fallback remains available: `VOLC_ARK_BASE_URL` default `https://ark.cn-beijing.volces.com/api/v3`; key env names `VOLC_ARK_API_KEY`, `ARK_API_KEY`, `PIXEL_TOYS_VIDEO_API_KEY`, `GRAVITEX_API_KEY`, `GRAVITEXAI_API_KEY`, `SEEDANCE_API_KEY`.
- Verified syntax with `node --check server.js` and `npm test`. End-to-end generation NOT run until the user explicitly asks.

### Legacy Canvas Cleanup (2026-06-26)

- Removed app-level legacy-canvas login UI, legacy video-platform routes, old helper functions, and the previous external workflow script dependencies.
- Project creation now uses the local `createEpisodeWorkspace()` helper.
- Asset and Production Board generation now run through `scripts/run_asset_generation.js`.
- New project directories use provider-neutral names: `05_video_prompts`, `07_video_asset_uploads`, and `08_video_task_nodes`.
- Root-level obsolete files were removed: the legacy canvas credential folder, old cleanup helper, and `work/e04_video_generation`.
- Historical output directories were renamed to the provider-neutral names where possible. Generated videos and old task snapshots were otherwise left intact to avoid deleting useful media.

## 2026-06-26 Canvas Visual / Brand Updates

User direction:

- Preserve the dark/green visual direction.
- Make the canvas feel more refined but keep scope visual unless asked otherwise.
- Left-top brand area should not use a glass/card background.
- Use user's provided pixel logo and no border.
- UI typography should move toward a thin pixelated style like the supplied reference screenshot, not thick arcade lettering.

Implemented:

- Canvas brand mark now references `/pixel-toy-symbol.png` instead of `/pixel-infinity-logo.png`.
- Source logo copy stored as `/public/logo11-source.png`.
- `/public/pixel-toy-symbol.png` was derived from `/Users/wangchao/Downloads/logo11.png` by cropping the central infinity symbol and removing the outer square border/background as much as possible.
- `.canvas-brand` has no border/background/shadow/backdrop-filter.
- Brand icon is wide (`96px x 58px`) and rendered pixelated/crisp.
- Self-hosted Pixelify Sans latin fonts were added:
  - `public/fonts/pixelify-sans-latin-400.woff2`
  - `public/fonts/pixelify-sans-latin-500.woff2`
  - `public/fonts/pixelify-sans-latin-600.woff2`
  - `public/fonts/pixelify-sans-latin-700.woff2`
- `public/canvas.css` now declares `@font-face` for Pixelify Sans and sets the canvas page font to that pixel font stack.

Important current caveat:

- The pixel-font pass was in progress when the user asked to整理 context. It has passed `npm test`, but has not yet had a browser screenshot QA after the Pixelify Sans change.
- Chinese text will fall back to system/monospace fonts because Pixelify Sans is latin-only. If the user wants Chinese also fully pixelated, install/provide a Chinese pixel font such as zpix/fusion-pixel and add it as the second family in `--canvas-pixel-font`.
- Continue by visually checking `http://localhost:4317/canvas.html`; verify button labels, select text, node titles, and Chinese labels do not overflow.

## 2026-06-26 Deployment Recommendation Summary

For lowest-cost domestic deployment:

1. Recommended: 阿里云轻量应用服务器 or 腾讯云 Lighthouse + OSS/COS.
   - Run `node server.js` via PM2/systemd.
   - Use Nginx/Caddy for HTTPS.
   - Store project uploads/generated media in OSS/COS, because Gravitex/Seedance asset APIs need public HTTPS URLs for reference assets.
2. Avoid pure serverless as the first deployment path because this app uses local files, long-running tasks, uploads, and polling state.
3. China mainland deployment with a public domain normally requires ICP filing. Hong Kong servers avoid备案 but may have worse mainland latency.
4. Before real deployment, remove any complete API keys from chat/log-visible places and use `.env`/server secrets only.

## 2026-07-02 Canvas / Studio Performance Investigation (read-only, no code changed yet)

User report: (1) `/canvas.html` is slow — long white screen after F5 reload; (2) canvas interactions feel laggy. The main studio page was also mentioned, but the confirmed pain points are the canvas page and reload.

Measured (backend/network are NOT the bottleneck):

- `GET /api/projects` ~150ms; `/` and `/canvas.html` static responses ~1-2ms.
- `GET /api/project/{id}` ~20ms, payload ~288KB pure text (`storyboardSlots` ~86KB + `contents` ~67KB), zero inline base64. The current active project has 0 media files on disk, so this is not a large-image problem for that project.

Ruled out:

- Studio polling: `refreshSelectedProjectStatus` (`public/app.js`) runs only light `render*` calls with signature guards and does NOT re-run full `renderWorkspace`. Intervals: active 2s / idle 30s / hidden 15s.
- Event-listener accumulation: `initWindowDragging` (`public/app.js`) guards with `dataset.boundWindow="1"`; no rebinding leak.
- Canvas full rebuild: `renderNodes` (`public/canvas.js:2447`) already has the `wrap._structSig` structural guard, and images use `loading="lazy"` + `decoding="async"`. Not the interaction-lag source unless node count is very high.

Primary suspected root cause of the F5 white screen:

- `boot()` in `public/canvas.js:3325-3327` is a SERIAL await chain: `loadProjects()` (`/api/projects`) → `loadProject()` which awaits `/api/project/{id}` (`canvas.js:3304`) then awaits `/api/canvas/state` (`canvas.js:3309`) → only then `renderNodes()`. Three sequential network round-trips before any node paints.
- Candidate fixes (NOT yet applied, need approval): parallelize the project + canvas-state fetch (`Promise.all`); render cached canvas state / a skeleton first, then hydrate; or paint nodes from the restored localStorage/canvas-state snapshot before the project payload resolves.

Next steps:

1. Confirm in-browser which stage dominates (serial fetch vs first `renderNodes`) before editing — a console timing probe was prepared for the `render*` functions.
2. A Codex CLI sub-agent (gpt-5.5, read-only) was dispatched to independently analyze `canvas.js` render/poll/init paths. Integrate its findings from `/tmp/codex_out.md` when it returns, then decide the concrete fix.
3. Do not change code until the dominant stage is confirmed and the fix approach is approved.

## Required Behavior Rules

- Asset parsing must identify actual script characters, scenes, and props.
- Asset image prompts submitted to the image model should be English.
- UI/status/prompt rules may be Chinese, but text-to-image prompts should be English.
- Video prompt body should be Chinese.
- Dialogue language must be controlled by the UI dialogue switch.
- Uploaded assets and generated assets must have stable asset IDs and type tags so characters, scenes, and props cannot be mixed.
- Characters: full-body three-view plus bust close-up, pure white background, 16:9, photorealistic by default, realistic skin texture.
- Scenes: wide establishing images with no people, 16:9.
- Props: pure white background three-view, 16:9.
- Same-scene adjacent video clips should default to tail-frame continuity only when storyboard references are not active. If storyboards are active, use storyboard continuity instead and do not insert first/tail-frame references.
- If moderation/audit rejects a video prompt, rewrite it to satisfy safety while preserving story intent as much as possible.

## Quick Health Checks

Check whether the app is running:

```bash
curl -sS http://localhost:4317/api/projects | jq '{ok,count:(.projects|length)}'
```

Check for active generation processes:

```bash
ps -axo pid,ppid,etime,stat,command | rg 'run_apikey_asset_generation|image-gen\.js|seedance|video_generation' || true
```

Restart local service if needed:

```bash
launchctl kickstart -k gui/$(id -u)/com.pixeltoys.local
```

or:

```bash
npm start
```

## Security Note

Do not paste or commit API keys into this file. Use existing local config/env files only.
