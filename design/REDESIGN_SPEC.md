# 新版制作台视觉重构 · 执行规格

参考实现在 `design/redesign-v2/`（独立静态页，`python3 -m http.server` 直接可看）。
目标是把这套视觉语言迁进 `public/styles.css` + `public/index.html`，**不改任何业务逻辑**。

## 为什么现在这版显旧

诊断基于实测，不是观感：

| 症状 | 现状 | 目标 |
|---|---|---|
| 全屏 1px 硬边框把界面切成表格 | `border: 1px solid var(--modern-line)` 到处实色 | 半透明发丝线 `rgba(255,255,255,.07)` + 顶部内高光 |
| 零景深，所有卡片贴边通栏 | 无 `box-shadow` | 两段式阴影，卡片浮在画布上 |
| 字号压到 9–11px | `font-size: 9px` 大量出现 | 正文 13px / 次级 11.5px / 微标签 9.5px 仅限等宽标签 |
| 圆角 3–4px | `border-radius: 3px` | 卡片 12px、控件 7–8px |
| 纯黑死板 | `#0f1112` 平涂 | 近黑偏蓝紫 `#0B0B0F` + 环境光 + 极轻颗粒 |
| 信号色滥用 | 柠檬绿用在边框、文字、背景 | 只留给「当前步骤」与「主行动」，其余降为中性 |

## 借鉴来源

- **Linear** — 分层表面、发丝线、顶部内高光
- **Runway / LTX Studio** — 媒体优先，分镜帧当主角
- **Frame.io** — 状态色点 + 轻微发光替代纯文字状态
- **Raycast** — 活动态柔光而非纯色反白
- **剪辑软件（DaVinci）** — 胶片条流程轴、段轨

## Design tokens

全部加在 `body.is-studio-modern` 作用域内，**不要污染全局**（legacy 视图仍在用旧变量）。

```css
--bg: #0B0B0F;        /* 画布 */
--s1: #13131A;        /* 卡片 */
--s2: #1A1A23;        /* 卡内抬升 */
--s3: #23232E;        /* 活动态控件 */
--line: rgba(255,255,255,.07);
--line-2: rgba(255,255,255,.12);
--tx: #EDEDF2; --mut: #9A9AA8; --qt: #62626F;
--lime: #C8FF2E;      /* 行动 / 当前 */
--vio: #8B7CFF;       /* AI 生成物 */
--amb: #FFB86B;       /* 进行中 */
--ok: #6EE7A0;        /* 完成 */
--e1: 0 1px 2px rgba(0,0,0,.5), 0 8px 24px -10px rgba(0,0,0,.6);
--e2: 0 1px 2px rgba(0,0,0,.5), 0 18px 44px -14px rgba(0,0,0,.7);
--hi: inset 0 1px 0 rgba(255,255,255,.05);
--r: 12px; --r-s: 7px;
```

保留现有 `--mono` 定义（上一个 commit 刚补的，别删）。

## 六笔改动（每笔一个 commit，可独立回滚）

### 1. 合并顶栏与 hero → 单行 56–60px

现状：`.modern-topbar`（52px，只有「队列 N」）+ `.modern-episode-hero`（113px）两层共 165px，
而 hero 左侧 844px 是死区——紧凑头把面包屑和 `<h1>` 都 `display:none` 了，主列没有任何
「我在哪一集」的指示。

改为单条 grid：`auto minmax(0,1fr) auto auto`，依次放
面包屑（项目 / 剧集名 + 比例徽章）、描述（省略号截断）、统计、队列 + 主行动。

**必须同步改 app.js**：`#modernEpisodeKicker` 随 hero 移除，`renderModernStudio` 里对它的
赋值要删掉，否则报错。原先 `h1` 与 crumb 都写 `title`、kicker 与 episodeCrumb 都写
`episodeSlug`，同一字符串各印两遍；合并后 crumb 放项目名、`h1` 放剧集名。

**必须同步改测试**：`scripts/studio-modern-shell.test.mjs:60-61` 两条断言明确要求
「hero 用 auto auto + padding 10px 26px」和「hero 隐藏标题块」——它们锁死了这个死区，
要改成断言新顶栏结构。

删除时注意：`.modern-episode-hero` 相关规则与 `.modern-episode-stats` / `.modern-episode-action`
挤在同一行 CSS 里，后两者仍要用，逐条精确删除，别整行删。

### 2. 胶片条流程轴

现状：`.modern-pipeline` 是 `repeat(4, 1fr)` 四个等宽块，靠 `border-right` 分隔，视觉上互不相关。

改为 flex + 箭头连接符：步骤按内容宽度收缩，中间插 `→`（已完成段落用绿色、未达用灰）。
完成态圆角方块内绿勾，当前态实心柠檬渐变 + 柔光，未达态灰底。下方一条 2px 渐变进度轨
（violet → lime）横贯全宽。

### 3. 内容区 measure 上限 + 卡片浮起

现状：主列内容通栏铺满，1440px 下单行文本可达 1100px+，且卡片靠分割线区隔。

改为 `max-width: 1140px; margin: 0 auto`，卡片改用 `--r` 圆角 + `--e1` 阴影 + `--hi` 内高光，
卡间 16px gap，画布透出来。

### 4. 表单统一对齐线

现状：生图参数三行栅格列数分别是 2 / 4 / 3，控件左缘参差。

改为 `.row { grid-template-columns: 96px minmax(0,1fr) }`，标签右对齐，
所有控件左缘落在同一条线上。分段控件（比例、风格）用 `.seg` 胶囊组替代原生 select。

### 5. 分镜墙媒体优先

现状：缩略图被压到很小，文字信息占主导。

改为 `repeat(4, 1fr)` 的 9:16 大帧，帧内左上镜号（毛玻璃底）、左下状态色点 + 文字、
右下时长，底部渐变蒙版压暗保证文字可读。选中态 `box-shadow: 0 0 0 2px var(--lime)`。

### 6. 成片卡

上排 `216px | 1fr | auto`：9:16 预览、2×2 规格读数 + 装配规则说明、下载卡。
下排全宽段轨：6 格缩略图 + 状态点，直接看出成片由什么拼成。

**这里我自己踩过坑，务必照做**：`.cut-info` 必须 `grid-template-rows: auto 1fr; height: 100%`
且 `.cut-top` 用 `align-items: stretch`。初版用 `align-content: start`，中列只占 231px，
比 384px 的预览短 153px，底下又是死区——跟第 1 条要修的 hero 死区是同一个毛病。

## 硬约束

1. **不改任何业务逻辑。** 只动 markup 结构、CSS、以及因 DOM 变动必须同步的 `$()` 赋值。
2. **保留全部 ID。** `renderFinalCut` / `renderModernStudio` 等依赖现有 ID 取节点。
   尤其 `finalCutStatus` / `finalCutPreview` / `assembleFinalCutBtn` 三个必须留在
   可见的 `#modernCutPanel` 内（上个 commit 刚从隐藏 bridge 里救出来）。
3. **不要碰 `--mono`。** 全文 12+ 处引用，上个 commit 刚补的定义。
4. **全站 `button { min-height: 36px }`** 会压过 `height`，覆盖必须用 `min-height`。
5. **`min-height` + grid 会把富余空间摊到行间**，居中内容需显式 `align-content: center`，
   否则图标与文字会被拉开（实测 77px）。
6. **每笔改完跑 `npm test`。** 40 个测试，现在全绿，不许留红。
7. `CODEX_TASK.md` 有他人未提交改动，**不要碰、不要提交**。

## 验收

- `npm test` 全绿
- 1440 / 1180 / 860 三档宽度下无横向溢出、无元素重叠
- 顶栏高度 ≤ 60px，且面包屑与剧集名可见
- 成片卡内 `.cut-info` 底边与 `.cut-prev` 底边落差为 0
- 四个流程步骤 `data-modern-focus` 值互不相同（`scripts/modern-final-cut.test.mjs` 已覆盖）
