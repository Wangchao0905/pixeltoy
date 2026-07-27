import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

for (const id of [
  "studioModernShell",
  "modernShotCopy",
  "modernVideoPreview",
  "modernScriptText",
  "modernScriptUpload",
  "modernGenerateDraft",
  "modernAssetDescriptionText",
  "modernAssetDescriptionUpload",
  "modernExtractAssets",
  "modernAssetWall",
  "modernAssetGenerationControls",
  "modernAssetStylePreset",
  "modernAssetStyleReferenceFile",
  "modernAssetReferenceTarget",
  "modernAssetReferenceBind",
  "modernAssetManifestOverview",
  "modernAssetGallery",
  "modernBuildConfig",
  "modernVideoQueue",
  "modernVideoQueueGrid",
  "modernVideoQueueFilters",
  "modernVideoQueueInspector",
  "modernVideoQueuePrompt",
  "modernVideoQueueGenerate",
  "modernVideoGenerate",
]) {
  assert.match(html, new RegExp(`id=\"${id}\"`), `modern shell missing ${id}`);
}
assert.doesNotMatch(html, /id="studioShell"/, "legacy editor must be removed from the document");
assert.doesNotMatch(html, /class="studio-shell hidden"/, "legacy editor shell must be removed from the document");
assert.doesNotMatch(html, /id="modernDetailsButton"/, "modern shell must not expose the legacy editor entry");
assert.match(css, /body\.is-studio-modern[\s\S]*--modern-signal/, "modern palette must be scoped to modern studio");
assert.doesNotMatch(css, /body\.is-studio-modern\s+#studioShell/, "modern shell must not depend on a hidden legacy editor");
assert.match(css, /modern-brand-logo\.pixel-toys-wordmark::before[\s\S]*animation:[^;]+!important/, "modern logo rotor must override the studio thermal guard");
// 左栏品牌必须是带动效的 PNG 字标,不得再被替换成纯 CSS 图形。
// fb7b2c2「左栏换皮」曾换成 22px 柠檬渐变方块 + ::after 字母 P,盖掉 PNG 与
// 螺旋桨动效,用户要求换回。那个柠檬渐变还违反改动 9 的机制(柠檬只准出现在
// 顶栏主行动、流程轴当前步骤、进度轨三处)。
const brandLogoRule = css.match(/\.modern-brand-logo\s*\{[^}]*\}/)?.[0] || "";
assert.match(brandLogoRule, /pixel-toys-logo\.png/, "左栏品牌必须使用 PNG 字标");
assert.doesNotMatch(brandLogoRule, /--mv-lime|linear-gradient/, "左栏品牌字标不得被替换成柠檬渐变图形");
assert.doesNotMatch(css, /\.modern-brand-logo[^{]*::after\s*\{[^}]*content:\s*"P"/, "左栏品牌不得用字母 P 顶替字标");
assert.match(js, /studioModernShell/, "modern shell visibility must be wired");
assert.match(js, /renderModernStudio\(data\)/, "modern shell must hydrate from project state");
assert.match(js, /modernScriptUpload/, "modern shell must wire script upload");
assert.match(js, /modernAssetDescriptionUpload/, "modern shell must wire asset document upload");
assert.match(js, /modernExtractAssets/, "modern shell must expose asset extraction");
assert.match(js, /modernGenerateDraft[\s\S]{0,700}generateDraft\(\)/, "modern shell must bind the storyboard draft action");
assert.match(js, /modernBuildConfig[\s\S]{0,700}buildConfig\(button\)/, "modern shell must bind the video config action");
assert.doesNotMatch(js, /modernGenerateDraft[\s\S]{0,700}#draftBtn/, "modern draft action must not proxy through the hidden legacy button");
assert.doesNotMatch(js, /modernBuildConfig[\s\S]{0,700}#buildConfigBtn/, "modern config action must not proxy through the hidden legacy button");
assert.doesNotMatch(js, /hasStoryboardDraft|请先生成分镜草稿/, "storyboard must not be a prerequisite for video config");
assert.match(js, /configButton\.disabled = configGenerating \|\| !scriptSource\.trim\(\)/, "video config must only require script input in the modern shell");
assert.match(js, /const videoConfigAvailable = Boolean\(data\.videoConfigStatus\?\.exists\)/, "video generation must detect an existing config separately from readiness");
assert.match(js, /videoGenerateButton\.disabled = [^;]*!videoConfigAvailable/, "video generation must be clickable once a config exists");
assert.match(js, /body\.ratio = "9:16"/, "storyboard generation must request the vertical 9:16 format");
assert.doesNotMatch(html, /class="modern-sequence"/, "the empty shot sequence section must be removed from the modern shell");
assert.doesNotMatch(html, /id="modernShotRail"/, "the modern shell must not render the low-frequency shot sequence rail");
assert.doesNotMatch(html, /id="modernBatchAction"|id="modernBatchScopeAccordion"|选择生成范围/, "generation range controls must be removed from the modern shell");
assert.doesNotMatch(js, /modernBatchAction|modernBatchScopeAccordion|renderModernBatchScope|modernBatchScopeTargets/, "generation range controls must not remain wired in runtime");
const modernHeroStart = html.indexOf('<section class="modern-episode-hero"');
const modernPipelineStart = html.indexOf('<section class="modern-pipeline"');
assert.ok(modernHeroStart >= 0 && modernPipelineStart > modernHeroStart, "modern hero must precede the pipeline");
const modernHeroHtml = html.slice(modernHeroStart, modernPipelineStart);
assert.doesNotMatch(modernHeroHtml, /id="modernBuildConfig"/, "video config must not appear in the episode hero");
assert.match(modernHeroHtml, /id="modernVideoGenerate"[^>]*class="[^"]*modern-video-action[^>]*disabled/, "video generation must start disabled in the hero");
assert.match(css, /\.modern-episode-hero\s*\{[^}]*padding:\s*14px 26px/, "episode hero must stay compact");
assert.match(css, /\.modern-episode-video-actions\s*\{[^}]*display:\s*flex/, "hero video action must stay compact");
assert.match(css, /\.modern-episode-copy p\s*\{[^}]*display:\s*none/, "non-action hero description must not consume vertical space");
const modernMotionStart = html.indexOf('aria-labelledby="modernMotionTitle"');
const modernCutStart = html.indexOf('<section id="modernCutPanel"');
assert.ok(modernMotionStart >= 0 && modernCutStart > modernMotionStart, "modern video pane must remain in the workbench");
const modernCommandbarStart = html.indexOf('<header class="modern-shot-commandbar"');
const modernStageStart = html.indexOf('<div class="modern-stage-grid"', modernCommandbarStart);
assert.ok(modernCommandbarStart >= 0 && modernStageStart > modernCommandbarStart, "modern workbench must expose the command bar before the three panes");
const modernCommandbarHtml = html.slice(modernCommandbarStart, modernStageStart);
assert.match(modernCommandbarHtml, /id="modernBuildConfig"[^>]*class="[^"]*modern-video-action/, "video config must live beside the current-shot controls");
assert.match(modernCommandbarHtml, /class="modern-video-param-caption"/, "video params must have a dedicated control-group caption");
assert.match(modernCommandbarHtml, /class="modern-command-status"/, "command bar must separate workflow status from parameters");
assert.match(modernCommandbarHtml, /id="modernSelectedShotTitle"[^>]*class="[^"]*modern-shot-title-compat/, "shot title must remain only as a hidden runtime compatibility node");
assert.match(css, /body\.is-studio-modern \.modern-shot-title-compat,[\s\S]*display:\s*none/, "shot title must not occupy the command bar visually");
assert.match(css, /body\.is-studio-modern \.modern-shot-commandbar\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto/, "command bar must use a compact four-part layout");
assert.match(css, /body\.is-studio-modern \.modern-video-param-controls\s*\{[^}]*grid-template-columns:\s*minmax\(80px,\s*\.45fr\)/, "video params must use compact aligned control units");
const modernQueueStart = html.indexOf('<section id="modernVideoQueue"');
assert.ok(modernQueueStart > modernCommandbarStart && modernQueueStart < modernStageStart, "video queue must sit directly below the command bar");
assert.match(css, /\.modern-main\[data-modern-view="video"\] \.modern-stage-grid\s*\{[^}]*display:\s*none/, "video view must remove the standalone motion preview stage");
assert.doesNotMatch(html.slice(modernMotionStart, modernCutStart), /id="modernBuildConfig"/, "video pane must not duplicate the video config action at the bottom");
assert.doesNotMatch(html, /id="modernShotAction"/, "current-shot locator must be replaced by the video config action");
assert.doesNotMatch(html, /id="modernStillGenerate"/, "storyboard pane must not expose a generate-storyboard action");
assert.doesNotMatch(js, /modernShotAction|modernStillGenerate/, "removed modern actions must not remain wired in runtime");
assert.match(js, /function renderModernVideoQueue\([\s\S]*modernVideoQueueGrid/, "modern shell must render the video segment queue");
assert.match(js, /renderModernVideoQueue\(shots, selectedIndex, data\)/, "video segment queue must hydrate with all shot records");
assert.match(js, /function modernMediaForShot\([\s\S]*asset\?\.file\?\.url/, "completed video media must unwrap the server media object URL");
assert.match(js, /modernStudio\.queueFilter/, "video segment queue filter must persist during refreshes");
assert.match(css, /\.modern-video-queue-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill/, "video segment queue must use a responsive card grid");
assert.match(css, /\.modern-video-queue-card\.is-running[\s\S]*\.modern-video-queue-status/, "running queue cards must expose a visible status treatment");
assert.match(js, /modernVideoQueueInspector[\s\S]*generateModernVideoQueueShot/, "queue cards must open a single-shot inspector with generation controls");
assert.match(js, /saveVideoPrompt\(\)[\s\S]*generateVideoSegment\(shotName, \{ forceRegenerate \}\)/, "single-shot regeneration must save the edited prompt before submitting");
assert.match(js, /modern-asset-wall-group/, "modern asset wall must group cards by asset type");
assert.match(js, /function bindModernAssetReference/, "modern shell must bind uploaded reference images to parsed assets");
assert.match(js, /persistModernAssetStyleFromControls/, "modern shell must persist modern asset style controls");
assert.match(js, /workflowEditorElement/, "modern source inputs must use shared workflow persistence");
assert.doesNotMatch(js, /modernDetailsButton/, "modern shell must not wire a legacy editor handoff");
assert.doesNotMatch(js, /detailsOpen\s*=\s*true/, "modern actions must not switch to the legacy editor");
assert.doesNotMatch(js, /#studioShell/, "runtime must not query the removed legacy editor shell");
assert.doesNotMatch(js, /runHiddenLegacyAction/, "modern actions must not proxy through legacy buttons");
assert.match(js, /data-modern-view/, "pipeline clicks must switch the modern core view");
assert.doesNotMatch(js, /target\.scrollIntoView\(\{ behavior: "smooth"/, "pipeline clicks must not scroll the whole page");
const pipelineFocuses = [...html.matchAll(/<button[^>]*data-modern-focus="([a-z]+)"/g)].map((m) => m[1]);
assert.deepEqual(pipelineFocuses, ["assets", "assetimg", "storyboard", "video", "cut"], "pipeline 必须按顺序包含五个独立步骤");
assert.equal(pipelineFocuses.indexOf("assetimg"), pipelineFocuses.indexOf("assets") + 1, "资产图步骤必须紧跟资产文档");
assert.equal(pipelineFocuses.indexOf("storyboard"), pipelineFocuses.indexOf("assetimg") + 1, "故事板必须紧跟资产图步骤");
const sourcePanelStart = html.indexOf('id="modernSourcePanel"');
const kitBarStart = html.indexOf('id="modernKitBar"');
const assetWallStart = html.indexOf('id="modernAssetWall"');
assert.ok(sourcePanelStart >= 0 && kitBarStart > sourcePanelStart && assetWallStart > kitBarStart, "资产图墙必须移出资产文档视图");
const modernAssetImagePanel = html.match(/<section id="modernAssetImagePanel"[\s\S]*?<\/section>/)?.[0] || "";
assert.ok(modernAssetImagePanel.includes('id="modernAssetWall"'), "资产图墙必须位于独立的资产图展示页");
assert.ok(modernAssetImagePanel.includes('id="modernAssetGenerationStatus"'), "资产图模块必须有可见的生成状态提醒");
for (const id of ["modernAssetGenerateAssets", "modernAssetPromptInspector", "modernAssetPromptInspectorPrompt", "modernAssetRegeneratePrompt"]) {
  assert.match(html, new RegExp(`id="${id}"`), `资产图展示页缺少 ${id}`);
}
assert.match(js, /modernAssetGenerateAssets[\s\S]{0,700}\[data-job='assets'\]/, "资产图页生成入口必须代理现有资产生成任务");
assert.match(js, /function modernAssetGenerationStatus[\s\S]{0,1400}assetJob/, "资产图生成状态必须读取实际任务状态");
assert.match(js, /const generation = modernAssetGenerationStatus\(data\)/, "资产图页面必须渲染生成状态提醒");
assert.match(js, /data-modern-asset-action/, "资产图卡片必须提供单卡片生成或重新生成动作");
assert.match(js, /modernAssetPromptInspectorPrompt[\s\S]{0,700}ensureAssetPromptDraft[\s\S]{0,500}draft\.dirty/, "资产图页提示词编辑必须复用草稿机制");
assert.match(js, /modernAssetRegeneratePrompt[\s\S]{0,500}regenerateSelectedAssetFromInspector/, "资产图页重新生成必须复用检查器链路");
// 只取 .modern-asset-image-* 自己的规则做柠檬色检查。此前写成
// css.slice(css.indexOf(...))：类名不存在时 indexOf 返回 -1、slice(-1) 拿到
// 最后一个字符,assert.ok 恒真——断言永远不会失败(实测改坏 3 处类名仍通过);
// 且切到文件末尾会把后面所有无关 CSS 纳入检查,以后在末尾加合法柠檬规则会假报警。
const assetImageRules = [...css.matchAll(/\.modern-asset-image[a-z-]*[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
assert.ok(assetImageRules.length >= 1, "缺少资产图展示页样式(.modern-asset-image-*)");
// 资产图墙分组必须单列铺满。旧值 repeat(2, minmax(0,1fr)) 是图墙还挤在资产步骤
// 里时的设计,继承到独立展示页后每组只占一半宽度、组内每行仅 2 张(1440px 实测),
// 图的面积被砍半。这条守住「重在展现资产图」。
const galleryRules = [...css.matchAll(/\.modern-asset-gallery[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
const galleryCols = galleryRules.filter((r) => /grid-template-columns/.test(r));
assert.ok(galleryCols.length >= 1, "资产图画廊必须显式声明列数");
assert.match(galleryCols.at(-1), /grid-template-columns:\s*minmax\(0,\s*1fr\)/, "资产图画廊分组必须单列铺满(最后一条声明为准)");
// 面板内只留一层标题：合并前有 ASSET GALLERY + ASSET BOARD 两层说同一件事,
// 三层标题吃掉约 270px 才见到第一张图。
// 只认真实标记,不匹配注释——index.html 里留了说明这层为何被移除的注释,
// 早先写成 /modern-asset-wall-head/ 会被自己的注释匹配到,造成假阳性。
assert.doesNotMatch(html, /class="[^"]*\bmodern-asset-wall-head\b/, "资产图页不得再有重复的图墙标题层");
for (const rule of assetImageRules) {
  assert.doesNotMatch(rule, /--modern-signal|--mv-lime|200,255,46|C8FF2E/, `新增资产图展示页不得使用柠檬色: ${rule.slice(0, 60)}`);
}
assert.match(css, /modern-main\[data-modern-view="storyboard"\]/, "storyboard view must have a dedicated core layout");
assert.match(css, /\.modern-video-preview\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/, "video preview must use a portrait 9:16 frame");
assert.match(css, /\.modern-still-preview\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/, "storyboard preview must use a portrait 9:16 frame");
assert.doesNotMatch(css, /\.modern-main\[data-modern-view="storyboard"\][\s\S]*?\.modern-stage-pane:first-child\s*\{\s*display:\s*none/, "storyboard view must keep the draft pane visible");
assert.match(js, /function modernCopyValue[\s\S]*?contents\.storyboard/, "storyboard copy must fall back to the saved draft content");
assert.match(js, /function modernCopyValue[\s\S]*?contents\.seedancePrompts/, "prompt and dialogue tabs must fall back to saved prompt content");
assert.match(js, /已生成分镜草稿 · 可继续生成视频配置/, "draft-only state must be visible before video config exists");
assert.match(css, /\.modern-source-panel\s*\{[^}]*display:\s*grid/, "source panel must place the asset wall beside the parsed rail");
assert.match(css, /\.modern-stage-pane\s*\{[^}]*align-self:\s*start/, "stage panes must not stretch to the portrait video height");
assert.match(css, /\.modern-asset-results\s*\{[^}]*max-height:/, "asset rail must not stretch the entire source panel");
assert.match(css, /\.modern-asset-wall\s*\{[^}]*grid-column:\s*1/, "asset wall must occupy the source panel workspace");
assert.match(css, /\.modern-asset-wall-grid\s*\{[^}]*grid-template-columns:/, "asset wall must use a card grid");
assert.match(html, /modern-episode-hero/, "episode hero must remain visible in the episode-led layout");
assert.match(html, /modernEpisodeKicker/, "episode hero must expose its episode context");
assert.match(html, /<header class="modern-topbar">[\s\S]*modernProjectCrumb[\s\S]*modernEpisodeTitle[\s\S]*modern-top-actions/, "topbar must contain navigation and queue actions");
assert.match(css, /body\.is-studio-modern \.modern-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto[^}]*height:\s*54px/, "topbar must use the compact navigation layout");
assert.match(css, /\.modern-episode-hero\s*\{[^}]*display:\s*grid/, "episode hero must establish the first-viewport hierarchy");
assert.match(js, /modernEpisodeKicker/, "runtime must assign the episode hero context");
assert.doesNotMatch(css, /modern-batch-scope|modern-episode-secondary-action/, "removed range controls must not leave visual styles behind");
assert.match(html, /<section class="modern-pipeline"[\s\S]*modern-pipeline-link[\s\S]*modern-pipeline-rail/, "pipeline must include arrow links and a progress rail");
assert.match(css, /\.modern-pipeline\s*\{[^}]*display:\s*flex/, "pipeline must use a flex filmstrip layout");
assert.match(css, /\.modern-pipeline-link\s*\{[^}]*width:\s*26px/, "pipeline steps must be joined by fixed-width arrows");
assert.match(css, /\.modern-pipeline-rail\s*\{[^}]*height:\s*2px/, "pipeline must have a 2px bottom progress rail");
assert.match(css, /\.modern-pipeline-rail span\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*var\(--mv-vio\),\s*var\(--mv-lime\)\)/, "pipeline rail must use violet-to-lime progress");
// 无前缀的 --bg / --line / --ok 在本文件已有 4 套主题各自的定义，即便限定
// 在 body.is-studio-modern 内也会被后代继承并覆盖它们本该拿到的全局值。
assert.match(css, /body\.is-studio-modern \{[\s\S]{0,900}--mv-bg:/, "modern tokens must use the --mv- prefix");
assert.doesNotMatch(css, /body\.is-studio-modern \{[\s\S]{0,900}\n\s*--bg:/, "modern tokens must not shadow the global --bg");
// #62626F 对 #0B0B0F 仅 3.27:1，低于 WCAG AA 正文 4.5:1；未达态步骤标签用的是它。
assert.doesNotMatch(css, /--mv-qt:\s*#62626F/i, "--mv-qt must clear WCAG AA against the canvas");
// overflow-x: auto 会把 overflow-y 的 visible 提升为 auto，连带纵向裁剪副标签。
// 只查基础规则（含 flex: none 那条）；窄屏 media query 里的 overflow-x 是刻意的。
assert.doesNotMatch(css, /\.modern-pipeline \{[^}]*flex:\s*none[^}]*overflow-x:\s*auto/, "pipeline must not clip vertically at desktop width");
assert.match(css, /\.modern-pipeline \{[^}]*flex:\s*none/, "pipeline must not shrink inside the flex column");
assert.doesNotMatch(css, /\.modern-pipeline\s*\{[^}]*display:\s*grid/, "pipeline must not retain the equal-column grid");
assert.doesNotMatch(css, /modern-pipeline button[^}]*border-right/, "pipeline must not use hard block dividers");
assert.match(html, /id="modernCore" class="modern-core"/, "modern shell must have a fixed core workspace");
assert.match(css, /\.studio-modern-shell\s*\{[\s\S]*height:\s*100vh[\s\S]*overflow:\s*hidden/, "modern shell must keep the page viewport fixed");
assert.match(css, /\.modern-core\s*\{[\s\S]*overflow:\s*auto/, "only the core workspace may scroll internally");

// 改动 3：内容区限制 measure，卡片之间露出画布，并保留浮起层次。
// 上限由 1140px 提到 1560px：用户实测反馈「模块整体宽度太窄」，1512px 屏上
// 1140px 阅读栏白扔 245px（main 1288 → core 1140），资产图墙每行只排 3 张。
// 仍保留上限（不是去掉 max-width），避免超宽屏一行排出 8-9 张、文字行长过长。
assert.match(css, /\.modern-core\s*\{[^}]*max-width:\s*1560px[^}]*margin:\s*0 auto[^}]*gap:\s*16px/, "modern core must use a centered 1560px measure with 16px gaps");
assert.match(css, /\.modern-source-panel\s*\{[^}]*border-radius:\s*var\(--mv-r\)[^}]*box-shadow:\s*var\(--mv-e1\),\s*var\(--mv-hi\)/, "modern cards must use the mv radius, elevation, and highlight");
assert.match(css, /\.modern-core\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/, "core scrolling must declare both overflow axes");

// 改动 4：资产参数控件共享 96px 标签列，原生 select 仍保留并采用 seg 外观。
assert.match(html, /modern-asset-form-row/, "asset controls must expose the aligned form rows");
assert.match(css, /\.modern-asset-generation-row\s*\{[^}]*grid-template-columns:\s*96px\s+minmax\(0,1fr\)/, "asset form rows must share a 96px label column");
assert.match(html, /<select class="seg" id="modernAssetStylePreset"/, "style preset select must remain and use seg styling");
assert.match(html, /<select class="seg" id="modernAssetReferenceTarget"/, "reference target select must remain and use seg styling");
assert.match(css, /\.modern-asset-generation-controls\s+select\.seg[^}]*border-radius:\s*999px/, "native selects must receive the pill seg appearance");

// 改动 5：视频片段队列用统一的 9:16 媒体帧承载镜号、状态、时长和进度。
assert.match(js, /modern-video-queue-frame/, "video queue must render media-first frames");
assert.match(js, /modern-video-queue-number[\s\S]*modern-video-queue-status[\s\S]*modern-video-queue-duration/, "video queue frames must include number, status, and duration overlays");
assert.match(css, /\.modern-video-queue-frame\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/, "video queue frames must use a 9:16 ratio");
assert.match(css, /\.modern-video-queue-frame::after\s*\{[^}]*linear-gradient/, "video queue frames must include a bottom readability mask");
assert.match(css, /\.modern-video-queue-card\.is-active[^}]*box-shadow:\s*0 0 0 2px rgba\(217,45,69/, "selected queue card must use the signal frame ring");
assert.match(css, /\.modern-main\[data-modern-view="storyboard"\]\s+\.modern-source-panel,[\s\S]*?\{\s*display:\s*none/, "storyboard view must hide the source panel");
assert.match(css, /\.modern-video-queue-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill/, "video queue must use a responsive card grid");
assert.match(html, /id="modernVideoQueueProgress"[^>]*class="modern-video-queue-meter"/, "queue overview meter must use its own layout class");
assert.match(css, /\.modern-video-queue-meter\s*\{[^}]*flex:\s*1\s+1\s+auto/, "queue overview meter must remain in the toolbar flow");
assert.match(css, /\.modern-main:not\(\[data-modern-view="video"\]\)\s+\.modern-video-queue\s*\{[^}]*display:\s*none/, "video queue must stay scoped to the video step");

// 改动 6：成片卡采用三列上排 + 全宽六段轨，并保留可见的业务三件套。
const modernCutPanel = html.match(/id="modernCutPanel"[\s\S]*?<\/section>/)?.[0] || "";
for (const className of ["cut-top", "cut-info", "track", "segs"]) {
  assert.ok(modernCutPanel.includes(`class="${className}"`), `modern cut panel missing ${className}`);
}
assert.match(css, /\.cut-top\s*\{[^}]*grid-template-columns:\s*216px\s+minmax\(0,1fr\)\s+auto[^}]*align-items:\s*stretch/, "cut top must use the 216px preview column and stretch the other columns");
assert.match(css, /\.cut-info\s*\{[^}]*grid-template-rows:\s*auto\s+1fr[^}]*height:\s*100%/, "cut info must fill the preview height with auto plus 1fr rows");
assert.match(css, /\.segs\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,1fr\)\)/, "cut track must show six equal segment slots");

// 队列状态点必须始终可见，并且完成/失败状态使用明确的语义色。
assert.match(css, /\.modern-video-queue-number,[\s\S]*\.modern-video-queue-status,[\s\S]*\{[^}]*position:\s*absolute/, "queue status overlay must be positioned in the frame");
assert.match(css, /\.modern-video-queue-status i \{[^}]*border-radius:\s*50%/, "queue status must render a state dot");
assert.match(css, /\.modern-video-queue-card\.is-complete \.modern-video-queue-status i \{[^}]*var\(--mv-ok\)/, "complete queue cards must use the ok state color");
assert.match(css, /\.modern-video-queue-card\.is-failed \.modern-video-queue-status i \{[^}]*var\(--modern-accent\)/, "failed queue cards must use the failure state color");
assert.doesNotMatch(css, /#26362e/i, "legacy green shot gradient must be gone");

// src="" 的 img 仍占位 329\u00D7206，浏览器裂图标与 alt 文字压在
// 「暂无故事板」占位层上面，实测两者同时显示。
assert.match(css, /\.modern-still-preview img\[src=""\][^{]*\{[^}]*display:\s*none/, "empty-src previews must not render the broken-image glyph");
// scrollbar-width: thin 不含配色，回落到浏览器默认亮灰，暗色界面下刺眼。
// 用 [^}]* 锚到块边界而非固定字符数，避免以后新增 token 就把断言撑破。
assert.match(css, /body\.is-studio-modern \{[^}]*scrollbar-color:/, "modern shell must theme its scrollbars");
// 不能只匹配选择器名：:hover 变体里也含这段文字，删掉基础规则断言照样通过。
assert.match(css, /body\.is-studio-modern ::-webkit-scrollbar-thumb \{[^}]*background:\s*rgba/, "modern shell must theme WebKit scrollbars too");

// 固定 repeat(3,1fr) 时，视图作用域隐藏两个面板后剩下那个只占 1/3，
// 实测 1081px 容器里 721px 是空的——与 hero 844px 死区同一类毛病。
assert.match(css, /\.modern-stage-grid \{[^}]*grid-auto-flow:\s*column/, "stage grid must size columns to visible panes only");
assert.doesNotMatch(css, /\.modern-stage-grid \{[^}]*repeat\(3,\s*minmax\(0,1fr\)\)/, "stage grid must not reserve columns for hidden panes");

// 改动 9：柠檬只留给顶栏唯一主行动、流程轴当前步骤、进度轨。
// hover 是指针反馈不是优先级信号——此前 7 条 hover 规则把边框染成柠檬，
// 让每个中性按钮悬停时都借用主色，柠檬因此不再代表「这是主行动」。
const modernScope = css.slice(css.indexOf("body.is-studio-modern {"));
const hoverLime = [...modernScope.matchAll(/([^{}\n]{1,150}?:hover[^{}\n]{0,60})\{([^}]*)\}/g)]
  .filter(([, , body]) => /--modern-signal|--mv-lime|200,255,46|C8FF2E/.test(body))
  .map(([, sel]) => sel.trim());
assert.deepEqual(hoverLime, [], `hover must not change hue: ${hoverLime.join(" | ")}`);
// 三处 .is-primary 此前各自用柠檬描边，与顶栏柠檬实心 CTA 同屏竞争。
for (const sel of [".modern-source-actions button.is-primary", ".modern-pane-actions button.is-primary"]) {
  const rule = modernScope.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"))?.[1] ?? "";
  assert.ok(rule.length, `${sel} rule must exist`);
  assert.doesNotMatch(rule, /--modern-signal|--mv-lime|200,255,46/, `${sel} must be tier-2 neutral, not lime`);
}
// 仅因「可用」就染信号色，语义为零。
assert.doesNotMatch(modernScope, /button:not\(:disabled\)\s*\{[^}]*(--modern-signal|200,255,46)/, "enabled-ness is not a reason to use the signal color");

console.log("studio modern shell tests passed");
