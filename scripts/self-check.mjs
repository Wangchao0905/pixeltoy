import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectVideoConfigRecord } = require("../server/team-progress.js");

const root = path.resolve(new URL("..", import.meta.url).pathname);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "public/admin.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const adminReact = fs.existsSync(path.join(root, "src/admin/AdminApp.jsx")) ? fs.readFileSync(path.join(root, "src/admin/AdminApp.jsx"), "utf8") : "";
const viteConfig = fs.existsSync(path.join(root, "vite.config.js")) ? fs.readFileSync(path.join(root, "vite.config.js"), "utf8") : "";
const adminBundlePath = path.join(root, "public/dist/admin.js");
const adminBundle = fs.existsSync(adminBundlePath) ? fs.readFileSync(adminBundlePath, "utf8") : "";
const canvas = fs.readFileSync(path.join(root, "public/canvas.js"), "utf8");
const canvasCss = fs.readFileSync(path.join(root, "public/canvas.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const authHtml = fs.readFileSync(path.join(root, "public/auth.html"), "utf8");
const authInfinity = fs.readFileSync(path.join(root, "public/auth-infinity.js"), "utf8");
const canvasHtml = fs.readFileSync(path.join(root, "public/canvas.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const assetRunner = fs.readFileSync(path.join(root, "scripts/run_asset_generation.js"), "utf8");
const skillsApplied = fs.readFileSync(path.join(root, "docs/SKILLS_APPLIED.md"), "utf8");
const longFormPrd = fs.readFileSync(path.join(root, "docs/PRD-long-form-production.md"), "utf8");
const longFormTests = fs.readFileSync(path.join(root, "docs/TEST_SCENARIOS-long-form-production.md"), "utf8");
const intentAudit = fs.readFileSync(path.join(root, "docs/INTENT-vs-IMPLEMENTATION.md"), "utf8");
const longFormPremortem = fs.readFileSync(path.join(root, "docs/PREMORTEM-long-form-production.md"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sectionBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert(start >= 0, `missing section start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(end >= 0, `missing section end: ${endNeedle}`);
  return source.slice(start, end);
}

assert(server.includes("const ASSET_STYLE_LABELS"), "video compatibility labels must remain available");
const assetStyleLabels = sectionBetween(server, "const ASSET_STYLE_LABELS", "function normalizeAssetStylePreset");
assert(!assetStyleLabels.includes("prompt:"), "asset style compatibility labels must not contain rendering prompt text");
assert(!server.includes("const ASSET_IMAGE_STYLE_PRESETS"), "asset image preset prompt table must be removed");
assert(!server.includes("function assetStyleFromBody"), "asset generation must not have a UI style-preset request path");
assert(!server.includes("function applyAssetStyleToMarkdown"), "asset generation must not rewrite document prompts through a style preset");
assert(!server.includes("function styledAssetPromptsPath"), "asset generation must not create styled prompt shadow files");
assert(!server.includes("Ultra-realistic live-action cinematic photography"), "legacy English asset style prompt must be removed");
const storyboardJobRoute = sectionBetween(
  server,
  'if (["storyboards", "storyboards-dry-run", "storyboard-regenerate", "storyboard-regenerate-dry-run"].includes(type))',
  '  throw new Error(`unknown job type: ${type}`);',
);
const productionBoardPrompt = sectionBetween(server, "function storyboardPromptForSlot", "function storyboardPromptsMarkdown");
const projectBoardVideoReferences = sectionBetween(server, "function projectShotVideoReferenceNames", "function videoReferenceAssetPotentialUrls");
const productionBoardGuidance = sectionBetween(server, "function storyboardGuidancePromptText", "function assetLookupFromAssets");
const productionBoardReadiness = sectionBetween(server, "function configReadiness", "function isGenericGroupName");
const productionBoardSeedancePrompt = sectionBetween(server, "function storyboardSeedancePrompt", "function seedancePromptForShotMode");
const productionBoardSubmissionGuard = sectionBetween(server, "function assertVideoConfigAssetsReady", "function videoFileExtensionFromUrl");
const productionBoardPanelPlan = sectionBetween(server, "function storyboardProductionTabForPanel", "function defaultStoryboardPanels");
const buildDraftSection = sectionBetween(server, "async function buildDraft(", "function parsePromptSections");
const buildVideoConfigSection = sectionBetween(server, "async function buildVideoConfig(", "function clearVideoArtifactsForNewCanvas");

assert(server.includes("function clearAssetFailureLogs"), "asset failure cleanup guard is missing");
assert(app.includes('toast("正在生成分镜草稿")') && !app.includes('toast("正在生成分镜草稿并解析资产")'), "script workflow must describe storyboard-only generation");
assert(app.includes('toast("分镜和提示词草稿已生成")') && !app.includes('toast("资产解析、分镜和提示词草稿已生成，请先确认解析结果")'), "script workflow completion must not claim asset extraction");
assert(buildDraftSection.includes("manifestItemsToAssets(sourceAssetManifest)"), "draft generation must read the extracted asset manifest");
assert(!buildDraftSection.includes("extractAssetManifest("), "draft generation must not parse assets");
assert(!buildVideoConfigSection.includes("ensureAssetCoverage("), "video config generation must not mutate the asset library");
assert(viteConfig.includes("@vitejs/plugin-react"), "Vite must use the official React plugin");
assert(viteConfig.includes('entryFileNames: "dist/[name].js"'), "Vite admin build must emit a stable public/dist/admin.js bundle");
assert(adminHtml.includes('<div id="adminRoot"></div>'), "admin.html must mount the React admin island");
assert(adminHtml.includes('type="module" src="/dist/admin.js"'), "admin.html must load the Vite-built React admin bundle");
assert(adminBundle.includes("用户与权限"), "Vite admin bundle must be built before test/deploy");
assert(adminReact.includes("import React") && adminReact.includes("useEffect") && adminReact.includes("useState"), "admin page must be implemented as a React component");
assert(adminReact.includes("function AdminApp"), "React admin page must expose an AdminApp component");
assert(server.includes("function projectDisplayNameForSummary"), "project summary must resolve a real display name instead of raw folder slug");
assert(server.includes("function persistProjectDisplayName"), "project creation must persist the user-facing project display name");
assert(server.includes("persistProjectDisplayName(episodeRoot, requestedDisplayName);"), "new projects must save the original display title separately from the directory slug");
assert(server.includes("function persistProjectOwner"), "project creation must persist the owning user");
assert(server.includes("function userCanAccessProject"), "project APIs must have a shared owner/access guard");
assert(server.includes("function userOwnsProject"), "personal project ownership checks must remain available for scope conversion");
assert(server.includes("function assertUserCanAccessProject"), "project detail/action APIs must reject inaccessible projects server-side");
assert(server.includes("scanEpisodeRoots().filter((episodeRoot) => userCanAccessProject(user, episodeRoot))"), "project list must show personal ownership and current team membership access");
assert(server.includes("function assertUserCanDeleteProject"), "project deletion must use a separate destructive permission guard");
assert(server.includes("assertUserCanDeleteProject(req, episodeRoot);"), "project deletion route must enforce personal owner or team owner authority");
assert(server.includes('url.pathname === "/api/team"'), "team creation and summary API must exist");
assert(server.includes('action === "team"'), "personal projects must have an explicit team conversion action");
assert(server.includes('url.pathname === "/api/canvas/blank-team"'), "personal blank canvases must have an explicit team conversion action");
assert(server.includes("function userCanAccessCanvasState"), "blank canvas access must use personal/team scope checks");
assert(server.includes("function teamResourceCatalog"), "team resources must be resolved through a scoped catalog");
assert(server.includes("function copyReferenceImageSnapshot"), "team image references must copy a durable snapshot");
assert(server.includes("const referenceUpdateMatch = action.match"), "team reference updates must be explicit actions");
assert(!server.includes("teamRole === \"admin\""), "team owner role must not grant system administrator authority");
assert(server.includes("persistProjectOwner(episodeRoot, user);"), "new projects must be assigned to the current authenticated user");
assert(server.includes("assertUserCanAccessProject(req, episodeRoot);"), "project route must enforce project access before actions");
assert(server.includes("assertUserCanAccessProject(req, projectRequest.episodeRoot);"), "canvas-routed project video generation must enforce project access");
assert(server.includes("assertUserCanAccessProject(req, episodeRoot);") && server.includes('url.pathname === "/api/canvas/project-video-generate"'), "canvas project video route must enforce project access");
assert(server.includes("function lightweightProjectSummary"), "project list must use a lightweight summary without full state recovery");
assert(server.includes("function projectStatusSnapshot"), "project polling must have a lightweight status endpoint");
const projectsListRoute = sectionBetween(server, 'if (req.method === "GET" && url.pathname === "/api/projects")', '  if (req.method === "GET" && url.pathname === "/api/canvas/state")');
assert(projectsListRoute.includes("lightweightProjectSummary"), "project list route must call lightweightProjectSummary");
assert(!projectsListRoute.includes("projectSummary"), "project list route must not call heavy projectSummary");
assert(server.includes('action === "status"'), "project API must expose a status action for polling");
assert(app.includes("function projectShellStateFromSummary"), "frontend must build an immediate project shell from list summary");
assert(app.includes("setProjectState(projectShellStateFromSummary(summary));"), "project click must render the studio shell before the full project API returns");
assert(app.includes('api(`/api/project/${state.selectedId}/status`)'), "project refresh must use the lightweight status endpoint");
assert(!app.includes('await loadProject(state.selectedId, { openStudio: false, rescheduleRefresh: false });'), "polling must not reload the full project state every cycle");
assert(server.includes('action === "display-name"'), "project display name must be editable after creation");
assert(app.includes("function displayProjectTitle"), "frontend must centralize project title display");
assert(app.includes('$("#projectTitle").textContent = displayProjectTitle(project);'), "studio header must use the cleaned project display title");
assert(app.includes("function saveProjectDisplayName"), "frontend must save missing project display names");
assert(html.includes('id="projectDisplayNameForm"'), "studio header must expose a display-name form when missing");
assert(server.includes("function extractCharacterProfileNames"), "asset parser must extract top-of-script character profile headings");
assert(server.includes("extractCharacterProfileNames(script).forEach((name) => candidates.add(name));"), "character parser must feed profile headings into rule candidates");
assert(server.includes("杰克·沃尔夫 Jack Wolfe") && server.includes("火药桶 Buck") && server.includes("格兰特博士"), "self-check must preserve regression names for character profile parsing");
assert(server.includes("【场景】") && server.includes("extractBracketSceneHeadings"), "asset parser must extract uploaded scripts that use 【场景】 headings");
assert(server.includes("新港市[\\s\\S]{0,80}(?:地铁|车厢|隧道|列车)"), "Newport metro fallback must require explicit Newport + metro evidence");
assert(server.includes("黑色重型装甲押运车") && server.includes("重型手铐") && server.includes("红色释放按钮"), "asset parser must preserve Black Harbor uploaded-script props/inserts");
assert(server.includes("变异章鱼怪") && server.includes('pushUnique(characters, "变异章鱼怪")'), "asset parser must preserve Black Harbor monster characters");
assert(server.includes("function fetchAssetAnalyzer"), "asset analyzer calls must have a dedicated timeout wrapper");
assert(server.includes("ASSET_ANALYZER_TIMEOUT_MS"), "asset analyzer timeout must be configurable");
assert(server.includes("includeReusableAssets") && server.includes("projectReusableAssetsForManifest(episodeRoot, manifest, options) : []"), "current project asset state must not reuse other-episode assets unless explicitly requested");
assert(app.includes("function assetStylePayload"), "single-asset generation must preserve the optional style-reference payload");
assert(!app.includes("function stylePayloadForAsset") && !app.includes("function applyAssetBoundStyle"), "single-asset generation must not restore removed style selectors");
assert(app.includes("function selectAssetForInspector") && app.includes("state.assetInspectorOpen = true") && app.includes("ensureAssetPromptDraft(assetName);"), "selecting an asset must open its dedicated prompt inspector");
assert(!app.includes("applyAssetBoundStyle(assetForName(assetName))"), "clicking a generated asset must not restore removed style selectors");
assert(app.includes("...assetStylePayload(),"), "single-asset regenerate requests must send the optional style-reference payload");
for (const [name, pageHtml] of [
  ["index", html],
  ["auth", authHtml],
  ["canvas", canvasHtml],
  ["admin", adminHtml],
]) {
  assert(/<link\s+rel=["']icon["']\s+href=["']data:,["']\s*\/?>/i.test(pageHtml), `${name} page must use a blank browser tab icon`);
  assert(!/<link\s+[^>]*rel=["'](?:shortcut\s+)?icon["'][^>]*pixel-infinity-logo/i.test(pageHtml), `${name} page must not use the brand image as browser tab icon`);
}
assert(authHtml.includes('<meta http-equiv="refresh" content="0;url=/?auth=login" />'), "auth page must redirect to the shared login surface");
assert(authHtml.includes('target.searchParams.set("auth", params.get("mode") === "register" ? "register" : "login")'), "auth redirect must preserve login/register mode");
assert(!authHtml.includes("auth-logo-mark"), "auth topbar must not show the pill logo icon");
assert(!authInfinity.includes("auth-logo-mark"), "auth animation must not query the removed pill logo icon");
assert(!styles.includes("auth-logo-mark"), "styles must not retain rules for the removed pill logo icon");
assert(/\.auth-page \.auth-topbar\s*\{[^}]*gap:\s*24px;/s.test(styles), "auth topbar must keep spacing after the pill logo icon is removed");
assert(server.includes("function currentStoryboardAssetsForWorkflow"), "storyboard assets must use current-workflow isolation");
assert(server.includes("function assertNoBlockingWorkflowJobs"), "workflow resets must be blocked while asset/video jobs are running");
assert(server.includes('assertNoBlockingWorkflowJobs(episodeRoot, "重建草稿");'), "draft rebuild must not start while generation is running");
assert(server.includes('assertNoBlockingWorkflowJobs(episodeRoot, "写入新草稿");'), "draft rebuild must re-check before writing/resetting");
assert(server.includes("function recoverableAssetNamesFromRecentJobs"), "recent interrupted asset jobs must be recoverable");
assert(server.includes("function assetNameSimilarityScore"), "recoverable interrupted assets need conservative label similarity matching");
assert(server.includes("recoveredFromInterruptedWorkflow"), "recovered asset files must be mapped back to current manifest slots");
assert(server.includes("function isGenericGroupCharacterLabel"), "asset parser must reject generic group labels as characters");
assert(server.includes("function isActionPhraseCharacterLabel"), "asset parser must reject action phrases as characters");
assert(server.includes("function correctAssetRoleFromEvidence"), "asset parser must run deterministic type correction after model analysis");
assert(server.includes("function correctAssetRolesFromEvidence"), "asset parser must normalize merged assets through the role correction layer");
assert(server.includes("NON_CHARACTER_ASSET_LABEL_RE"), "asset parser must centralize non-character label guards");
assert(server.includes("SCENE_ASSET_EVIDENCE_RE"), "asset parser must detect scene/location evidence before keeping Character assets");
assert(server.includes("PROP_ASSET_EVIDENCE_RE"), "asset parser must detect prop evidence before keeping Character assets");
assert(server.includes("INSERT_ASSET_EVIDENCE_RE"), "asset parser must detect insert/detail evidence before keeping Character assets");
assert(server.includes("previousChar") && server.includes("actionNameMatches"), "action-name parser must avoid slicing names out of the middle of Chinese words");
assert(server.includes("function sanitizeManifestItems"), "asset manifests must sanitize stale incompatible items");
assert(server.includes("function manifestItemCompatibleWithType"), "asset manifests must validate item labels against their declared type");
assert(server.includes("const manifestIsSourceOfTruth = names.size > 0;"), "current asset workflow must treat manifest names as the source of truth");
assert(server.includes("if (!manifestIsSourceOfTruth) {") && server.includes("plannedAssetNames"), "stale asset prompt names must not override a manifest-backed workflow");
assert(server.includes("藏地扎西岗雪坡神山寺庙"), "Tibetan location subtitles must become scene assets, not character assets");
assert(server.includes("镜界|冻结现象|时间冻结|现实吞噬|超自然力场"), "supernatural phenomena such as 镜界 must be parsed as Insert assets, not Character assets");
assert(server.includes("correctAssetRolesFromEvidence(mergeAnalyzerAssets"), "merged analyzer assets must be corrected before coverage checks");
assert(server.includes("correctAssetRolesFromEvidence(coverageResult.assets"), "coverage-added assets must be corrected before manifest writing");
assert(server.includes("assetRoleCorrected") && server.includes("corrected from Character"), "type correction must preserve an audit note when a Character is reclassified");
assert(server.includes('label: "镜界 冻结现象"'), "local asset fallback must preserve 镜界 as an insert/reference phenomenon");
assert(server.includes('pushUnique(characters, "小尼玛")'), "local asset fallback must preserve screenplay protagonist 小尼玛");
assert(server.includes('pushUnique(characters, /多瞳/.test(script) ? "多瞳发光巨兽"'), "local asset fallback must preserve the multi-pupil glowing beast");
assert(server.includes("const nameAllowed = allowedNames.size ? allowedNames.has(asset.assetName) || allowedNames.has(recoveredName) : true;"), "asset isolation must reject non-current names except recoverable interrupted assets");
assert(server.includes("if (minModifiedAt && mediaModifiedAt(asset) < minModifiedAt) return false;"), "asset isolation must reject stale same-name files");
assert(server.includes("failedRunNamespace") && server.includes("failedRunNamespace !== runNamespace"), "asset failure logs must be isolated by run namespace");
assert(server.includes("targetAssetNames: job.targetAssetNames || []"), "job failure backfill must be limited to current job targets");
assert(server.includes("PIXEL_TOYS_RUN_NAMESPACE: runNamespace"), "asset generation subprocesses must receive the current run namespace");
assert(assetRunner.includes('runNamespace: process.env.PIXEL_TOYS_RUN_NAMESPACE || ""'), "image generation failure logs must persist the run namespace");
assert(server.includes("function shouldAutoRetryTransientAssetJob"), "single-asset transient gateway failures must be eligible for job-level retry");
assert(server.includes("AUTO_RETRYABLE_ASSET_FAILURE_CATEGORIES"), "job-level retry must be limited to known transient upstream failure categories");
assert(server.includes("targetAssetNames.length !== 1"), "job-level retry must never replay a batch after one transient failure");
assert(server.includes("上游临时故障，正在自动重试"), "asset jobs must expose delayed automatic retry progress instead of a terminal failure");
assert(server.includes("storyboardAssets = currentStoryboardAssetsForWorkflow(scanAssets(episodeRoot)"), "storyboard jobs must not scan stale board files");
assert(server.includes("const actualStoryboards = storyboardsActive") && server.includes("currentStoryboardAssetsForWorkflow(scannedAssets"), "video config must use isolated storyboard assets");
assert(server.includes('selectedAssetNames = slots.filter((slot) => !slot.skipped).map((slot) => slot.id).filter(Boolean);'), "assetRange=all must target every non-skipped asset explicitly");
assert(server.includes("const targetAssetNames = isRegenerate || isEdit ? [assetName] : selectedAssetNames;"), "batch asset jobs must persist the full target list");
assert(server.includes("clearAssetFailureLogs(episodeRoot, targetAssetNames);"), "asset jobs must clear stale failure logs before retrying");
assert(server.includes("targetAssetNames,"), "job metadata must expose targetAssetNames");
assert(server.includes("staleFailureDetailsCleared"), "job summaries must clear stale persisted failure reasons after failure logs are resolved");
assert(server.includes("generate: item?.generate !== false"), "asset manifest items must default to generate=true");
assert(server.includes('statusLabel: exists ? (asset.reused ? "已生成（复用）" : "已生成") : skipped ? "不生成" : hasFailure ? "失败，可重新生成" : "缺失"'), "asset slots must keep existing assets ready while exposing skipped/not-generate state");
assert(server.includes('!slot.skipped && (slot.missing || slot.status === "failed" || slot.failed)'), "asset batch generation must include missing/failed assets while excluding skipped assets");

assert(app.includes('if (slot?.isGenerating) return "生成中";'), "asset cards must show per-asset running state");
assert(app.includes("function assetNamesForRange"), "frontend must compute optimistic batch targets");
assert(app.includes("state.optimisticAssetJobs.set(name"), "frontend must set optimistic asset running targets");
assert(app.includes("function toggleManifestAssetGeneration"), "frontend must allow per-asset generate/skip toggles");
assert(app.includes('const allowed = (slot) => !slot.skipped && slot.status !== "skipped";'), "frontend asset range selection must exclude skipped assets");
assert(server.includes("function removeExistingBoundAssetFiles"), "uploaded asset replacement must remove stale same-name and recovered files");
assert(server.includes("const priority = isExactCurrentAsset ? 40"), "exact uploaded/current assets must outrank recovered or reused assets");
assert(server.includes("clearAssetGeneratedMetadata(episodeRoot, [assetId]);"), "uploaded asset replacement must clear stale generation metadata");
assert(server.includes("savedAs: path.basename(target)"), "uploaded assets must report the manifest-based saved filename");
assert(app.includes("function updateAssetUploadHint"), "asset upload UI must explain manifest-name binding");
assert(app.includes('button.textContent = exists ? "替换上传" : "绑定上传";'), "asset upload button must switch to replacement mode for existing assets");
assert(app.includes("assetUploadTargetId"), "asset upload target must be preserved across polling renders");
assert(app.includes("const targetStillExists = previousTarget && ordered.some((item) => item.id === previousTarget);"), "asset upload target must not reset to the first missing slot on refresh");
assert(app.includes("state.assetUploadTargetId = event.target.value || \"\";"), "manual asset upload target changes must be tracked explicitly");
assert(app.includes("state.assetUploadTargetId = \"\";"), "project-scoped upload target must reset only when changing projects");
assert(server.includes("function beatDurationWeight"), "video shot durations must use story beat weighting");
assert(server.includes("function rebalanceShotDurations"), "uniform model shot durations must be rebalanced");
assert(server.includes("const VIDEO_MIN_EPISODE_SECONDS = 70;"), "episode video duration must allow a 70s lower bound");
assert(server.includes("const VIDEO_MAX_EPISODE_SECONDS = 90;"), "episode video duration must allow a 90s upper bound");
assert(server.includes("function episodeTargetDurationForBeats"), "episode target duration must be decided from script complexity");
assert(server.includes("同场景但不是直接动作连续：使用正常切镜，不使用尾帧"), "tail-frame continuity must not be the default for every same-scene shot");
assert(skillsApplied.includes("last30days") && skillsApplied.includes("taste-skill") && skillsApplied.includes("create-prd"), "installed skills and project application notes must be documented");
assert(longFormPrd.includes("70-90 second") && longFormPrd.includes("Server-side"), "long-form PRD must capture 70-90s production and server assembly intent");
assert(longFormTests.includes("Tail Frame Only For Direct Continuity"), "long-form test scenarios must cover tail-frame continuity rules");
assert(intentAudit.includes("Intent: Video Duration Planning") && intentAudit.includes("Intent: Tail Frame Continuity"), "intent-vs-implementation audit map must cover video duration and tail-frame intent");
assert(longFormPremortem.includes("Video credits are wasted") && longFormPremortem.includes("Expiring URLs"), "pre-mortem must cover paid generation and provider URL risks");
assert(server.includes("不要把所有镜头都设为 12 秒"), "storyboard model prompt must forbid uniform 12s durations");
assert(server.includes("function cinematicShotDesignForShot"), "video prompts must use structured cinematic shot design");
assert(server.includes("function seedanceNaturalLanguagePromptForShot"), "Seedance prompts must use the natural-language director template");
assert(server.includes("function isSeedanceNaturalLanguageShotPrompt"), "final video prompt submission must preserve the natural-language director template");
assert(!server.includes("function seedanceJsonPromptForShot"), "final video prompt must not fall back to the abandoned JSON template");
assert(!server.includes("function jsonOnlySeedancePrompt"), "final video prompt must not be normalized into JSON");
assert(server.includes("function seedanceReferenceDisplayName"), "Seedance @ references must use asset display labels, not ref filenames or story text");
assert(server.includes("function seedanceReferenceLine"), "Seedance @ reference lines must be built through a single strict formatter");
assert(server.includes("function cleanSeedanceReferenceDisplayName"), "Seedance @ reference names must be cleaned as asset identity names before formatting");
assert(server.includes("function isLikelyStoryReferenceName"), "Seedance @ reference names must reject story/narrative text as the quoted object name");
assert(server.includes("asset.label || asset.assetLabel"), "Seedance @ reference names must prefer manifest asset labels");
assert(server.includes("asset.characterName || asset.sceneName || asset.propName"), "Seedance @ reference names must support explicit person/scene/prop name fields");
assert(!server.includes("asset.evidence || asset.visual"), "Seedance @ reference names must not fall back to evidence or visual story descriptions");
assert(!server.includes("asset.beat || asset.purpose || asset.title"), "Seedance @ reference names must not fall back to shot/story fields");
assert(!server.includes('@图片${refIndex + 1} 是「${ref}」'), "Seedance @ references must not expose raw ref IDs as the object name");
assert(server.includes('"shot_size"') && server.includes('"camera_lens"') && server.includes('"camera_movement"') && server.includes('"voice_over"') && server.includes('"sound"'), "Seedance natural-language template must receive a complete director design");
assert(!server.includes("图片参考：\\n${refs}"), "Seedance prompt code blocks must not include the old 图片参考 heading");
assert(!server.includes("剧情动作：${visualBeat}"), "Seedance prompt code blocks must not include obsolete section headings before the natural-language template");
assert(server.includes("同一场景只有第一个镜头可以承担短建立镜头"), "storyboard prompt must forbid repeated establishing shots in the same scene");
assert(!server.includes("先用明确空间关系的建立镜头，再切人物中近景或过肩视角"), "video prompt template must not force every segment to start with an establishing shot");
assert(!server.includes("先用大全景或中远景建立空间，再切中近景捕捉人物反应"), "video prompt fallback must not force every segment to re-establish the environment");
assert(!server.includes("Math.min(12, Math.round(Number(raw.duration"), "storyboard normalization must not clamp max duration to 12 seconds");
assert(server.includes('suffix: "PRODUCTION_BOARD"'), "storyboard assets must use Production Board suffix");
assert(server.includes("const PRODUCTION_BOARD_MAX_SECONDS = 15;"), "Production Board must cap each board at a 15-second story unit");
assert(server.includes("const VIDEO_MAX_SECONDS = 15;"), "video clips must remain capped at 15 seconds");
assert(server.includes("const STORYBOARD_MIN_PANELS = 9;") && server.includes("const STORYBOARD_MAX_PANELS = 12;") && server.includes("const STORYBOARD_BOARD_COLUMNS = 4;"), "Production Board must use a 4x3 twelve-panel grid");
assert(storyboardJobRoute.includes("IMAGE_SIZE_BY_QUALITY_16_9"), "Production Board job route must render the whole board as a 16:9 horizontal sheet");
assert(storyboardJobRoute.includes('aspectRatio: "16:9"'), "Production Board generation metadata must describe the full board as 16:9");
assert(!storyboardJobRoute.includes("IMAGE_SIZE_BY_QUALITY_9_16"), "Production Board job route must not make the whole board 9:16 portrait");
assert(!storyboardJobRoute.includes('aspectRatio: "9:16"'), "Production Board generation must not mark the whole board as 9:16");
assert(server.includes("Create ONE 16:9 horizontal"), "Production Board prompt must make the whole board a 16:9 horizontal sheet");
assert(productionBoardPrompt.includes("exactly ${panelCount} equal storyboard panels"), "Production Board prompt must require equal-sized panels");
assert(productionBoardPrompt.includes("Footer holds a notes/timing field"), "Production Board prompt must reserve a readable footer area");
assert(productionBoardPrompt.includes("deterministic post-process"), "Production Board prompt must keep all production copy readable by reserving it for deterministic typesetting");
assert(productionBoardPrompt.includes("Render the ACTUAL scripted story"), "Production Board prompt must visibly retain the scripted plot for every panel");
assert(productionBoardPrompt.includes("attached production reference assets"), "Production Board must render the actual bound assets, not generic sketch placeholders");
assert(projectBoardVideoReferences.includes("function projectShotVideoReferenceNames"), "Production Board references must use one shared board-plus-assets reference list");
assert(projectBoardVideoReferences.includes("const refs = isProductionBoardMode(config, shot) ? [...storyboardRefs, ...officialRefs] : officialRefs"), "Production Board video submission must combine storyboard and official asset references");
assert(productionBoardGuidance.includes("Character/Scene/Prop/Insert 正式资产"), "Production Board video guidance must describe the official asset references");
assert(!productionBoardGuidance.includes("唯一提交图片参考"), "Production Board video guidance must not claim the board is the sole image reference");
assert(productionBoardReadiness.includes('const promptMode = config.settings?.promptMode'), "Production Board readiness must define the active prompt mode locally");
assert(productionBoardReadiness.includes("const storyboardMode = [\"production_board\", \"storyboard\"].includes"), "Production Board readiness must define the storyboard mode locally");
assert(productionBoardSeedancePrompt.includes("@图片${i + 1} 是 Production Board"), "Production Board prompt must number storyboard images first");
assert(productionBoardSeedancePrompt.includes("const officialRefs"), "Production Board prompt must preserve official asset references");
assert(productionBoardSubmissionGuard.includes("const boardlessShots = selectedShots.filter"), "Production Board submission must reject shots missing their board");
assert(productionBoardPanelPlan.includes("production: storyboardProductionTabForPanel"), "Production Board panels must carry a structured production tab");
assert(productionBoardPrompt.includes("Each panel must communicate shot scale, camera angle"), "Production Board prompt must retain the structured production direction");
assert(assetRunner.includes("function stampStoryboardProductionTabs"), "Production Board renderer must typeset a production tab after image generation");
assert(assetRunner.includes('"PRODUCTION TAB"'), "Production Board renderer must visibly label each production tab");
assert(assetRunner.includes("visible identity anchors"), "Production Board must render character turnarounds and product references as visible identity anchors");
assert(!productionBoardPrompt.includes("ESTABLISHING SHOT:"), "Production Board must not reserve a separate large establishing-shot panel");
assert(!productionBoardPrompt.includes("below the establishing shot"), "Production Board grid must start immediately below the header");
assert(server.includes("15 秒 16:9 横版 4×3 十二格故事板"), "Production Board policy must describe the whole board as a 16:9 horizontal sheet");
assert(server.includes("Do NOT draw literal blue/red diagram arrows, camera rectangles, asset-reference strips"), "Production Board prompt must keep technical reference markup out of the final board");
assert(server.includes("function buildStoryboardPanelAssetBindings"), "Production Board must retain backend panel-to-asset binding");
assert(assetRunner.includes("deterministic Production Tab") && assetRunner.includes("Integrate it naturally into each upper 16:9 narrative camera frame"), "Production Board edits must preserve the readable production tab and reference layout");
assert(server.includes("storyboardDisablesTailFrameContinuity: false"), "Production Board must not globally disable tail-frame continuity");
assert(styles.includes(".storyboard-card img {\n  display: block;\n  width: 100%;\n  aspect-ratio: 16 / 9;"), "Production Board preview cards must show the 16:9 horizontal board");
assert(styles.includes(".storyboard-missing-preview {\n  aspect-ratio: 16 / 9;"), "Production Board missing previews must show the 16:9 horizontal board shape");
assert(styles.includes("body.is-studio .storyboard-card img,\nbody.is-studio .storyboard-card .asset-missing-preview,\nbody.is-studio .storyboard-missing-preview {\n  aspect-ratio: 16 / 9 !important;"), "studio storyboard previews must show the 16:9 horizontal board");
assert(!html.includes('id="configPromptMode"'), "retired video config mode DOM must stay removed");
assert(html.includes('id="modernVideoPromptMode"'), "active video workbench must expose prompt/Production Board mode selection");
assert(app.includes("const promptMode = selectedVideoPromptMode()"), "frontend must submit the selected modern video mode");
assert(app.includes("enableStoryboards: promptMode === \"production_board\""), "frontend must enable storyboards only in Production Board mode");
assert(server.includes('const videoPromptMode = storyboardsActive ? "production_board" : "prompt";'), "server must split prompt mode from Production Board mode");
assert(server.includes('if (storyboardMode && !storyboards.length) missing.push("缺少 Production Board")'), "Production Board mode must not silently fall back when boards are missing");
assert(!server.includes("Use nine-grid storyboard images only"), "old nine-grid storyboard policy must not be reintroduced");
assert(!server.includes("已启用九宫格故事版参考"), "old nine-grid continuity label must not be reintroduced");
assert(!server.includes("请选择要生成的九宫格"), "old nine-grid UI error copy must not be reintroduced");
assert(server.includes('const VIDEO_PROMPTS_DIR = "05_video_prompts";'), "video prompts must use provider-neutral directory naming");
assert(server.includes('const VIDEO_ASSET_UPLOAD_DIR = "07_video_asset_uploads";'), "video asset uploads must use provider-neutral directory naming");
assert(server.includes('const VIDEO_TASK_DIR = "08_video_task_nodes";'), "video task snapshots must use provider-neutral directory naming");
assert(server.includes("function createEpisodeWorkspace"), "project creation must use the local workspace creator");
assert(server.includes("ASSET_GENERATOR_SCRIPT"), "asset generation must use the local runner");
assert(server.includes("command: process.execPath") && server.includes("[ASSET_GENERATOR_SCRIPT, ...args]"), "asset/storyboard jobs must invoke the local asset runner");
assert(server.includes("Array.isArray(raw?.data?.items)"), "Gravitex asset status refresh must parse data.items responses");
assert(server.includes("Array.isArray(raw?.items)"), "Gravitex asset status refresh must parse top-level items responses");
assert(
  server.includes("projectPhotorealGroupId(config)") && server.includes("refreshConfigAssetLibraryStatuses(config = {})"),
  "Gravitex asset refresh must fall back to the config assetLibrary group id when individual assets lack groupId",
);
assert(server.includes('"-sseof", "-0.5"') && server.includes('"-sseof", "-1.0"'), "tail-frame extraction must use safer fallback offsets, not only the final instant");
assert(server.includes('"-update", "1", target'), "tail-frame extraction must write a single PNG reliably with ffmpeg -update 1");
assert(!server.includes('"-sseof", "-0.08"'), "tail-frame extraction must not use the brittle -0.08s offset");
assert(server.includes("const SEEDANCE_MAX_IMAGE_REFERENCES = 9;"), "Seedance reference hard cap must be centralized");
assert(server.includes("function assertSeedanceReferenceBudget"), "Seedance payloads must reject over-budget references before submit");
assert(server.includes("function assertResolvedAllSeedanceReferences"), "Seedance payloads must verify every required reference was included");
assert(server.includes("required: false"), "Seedance optional asset references must be skippable so unfinished assets do not block video generation");
assert(!server.includes('referenceMode === "first_frame"'), "first-frame mode must not clear ordinary reference images");
assert(!server.includes('? []\n    : await resolveSeedanceImageReferences(assets, 9'), "Gravitex first-frame mode must not silently drop reference media content");
assert(!server.includes("if (imageData.length >= 9) break"), "Xluo payload must not silently truncate reference images");
assert(!server.includes("if (references.length >= maxImages) break"), "Seedance payload must not silently truncate reference images");
assert(server.includes("function assertProjectTailFrameReadyForShot"), "project video generation must block until the previous segment tail frame is ready");
assert(canvas.includes("function missingUpstreamTailFrameForVideoNode"), "canvas video generation must block when an upstream video tail frame is missing");
const videoPreviewRenderer = sectionBetween(canvas, "function renderVideoPreview(node) {", "function nodePrompt(node) {");
assert(videoPreviewRenderer.includes('controls playsinline preload="metadata"'), "completed video previews must expose native controls without autoplay");
assert(!videoPreviewRenderer.includes('controls playsinline autoplay'), "completed video previews must not request autoplay on refresh");
assert(!videoPreviewRenderer.includes("video-result-captions") && !videoPreviewRenderer.includes('>尾帧已就绪<'), "video result preview must not show status captions over the video");
assert(!server.includes("const forceGravitexMode = /^seedance-2-0-(?:liveness-face|person-reference)$/i.test(modelMode)"), "AI photoreal assets must not force a Gravitex provider route");
assert(server.includes("sourceAssets.some((asset) => asset?.arkPersonAsset?.enabled === true)"), "only explicitly bound Ark person assets may select the Ark provider");
assert(!canvasCss.includes('body.canvas-page:not(.show-advanced-ui) #livenessLibraryToggle'), "compact canvas UI must not hide the liveness/person asset library entry");
assert(!canvasCss.includes("body.canvas-page:not(.show-advanced-ui) .video-liveness-library"), "compact canvas UI must not hide inline person asset controls in video nodes");
assert(!canvasCss.includes("body.canvas-page:not(.show-advanced-ui) .liveness-library-panel"), "compact canvas UI must not hard-hide the person asset library panel");
assert(canvas.includes('api("/api/canvas/video-generations"'), "standalone canvas must be the video generation entry point");
assert(server.includes('url.pathname === "/api/canvas/project-video-generate"'), "canvas project video route must exist");
assert(server.includes("function resolveCanvasProjectVideoRequest"), "server must detect project video nodes submitted through the standalone canvas route");
const canvasVideoGenerationRoute = sectionBetween(
  server,
  'if (req.method === "POST" && url.pathname === "/api/canvas/video-generations")',
  '  if (req.method === "POST" && url.pathname === "/api/canvas/project-video-generate")',
);
assert(canvasVideoGenerationRoute.includes("resolveCanvasProjectVideoRequest(body)"), "standalone canvas video route must inspect the request before submitting");
assert(canvasVideoGenerationRoute.includes("generateProjectVideoShot(projectRequest.episodeRoot"), "project video nodes must be routed to the project generation chain");
assert(canvasVideoGenerationRoute.includes("routedToProject: true"), "project route fallback must tell stale clients that the request was rerouted");
assert(server.includes("这是项目视频片段节点，但无法解析片段名。已拦截普通画布提交"), "unresolvable project nodes must be blocked instead of submitted standalone");
assert(server.includes("projectShotName: compactLine(node.projectShotName || node.shotName || \"\")"), "canvas state must preserve projectShotName");
assert(canvas.includes("projectShotName: node.projectShotName || \"\""), "canvas payload must carry projectShotName for backend guard routing");
assert(canvas.includes('api("/api/canvas/project-video-generate"'), "canvas project nodes must use the project video generation route");
assert(server.includes("submittedAt: compactLine(node.submittedAt"), "canvas state must persist video submission timestamps");
assert(canvas.includes("timeoutMs: VIDEO_SUBMIT_TIMEOUT_MS"), "video submit requests must use explicit long submit timeouts");
assert(canvas.includes("function pollProjectVideoNode"), "project video nodes must keep polling project state until completion");
assert(canvas.includes("function resumeVideoPolls"), "canvas restore must resume saved video tasks");
assert(canvas.includes("resumeVideoPolls();"), "canvas load must resume saved video tasks after hydration");
assert(/pollVideoNode\(node\.id, node\.taskId, node\.taskProvider \|\| ""(?:, ensureVideoGenerationToken\(node\.id\))?\)/.test(canvas), "saved standalone video tasks must resume with their provider");
assert(canvas.includes('class="video-media-actions"') && canvasCss.includes(".video-media-actions") && canvasCss.includes("bottom: auto"), "tail-frame capture control must share the top action row with download");
assert(canvas.includes("tailFrameUrl: node.tailFrameUrl || \"\"") && canvas.includes("videoLocalFile: saved.videoLocalFile || node.videoLocalFile || \"\""), "manual tail-frame capture must reuse saved frame and local video paths");
assert(server.includes("复用已缓存尾帧") && server.includes("const downloadTarget = `${tmp}.download-"), "tail-frame extraction must reuse cached frames and avoid partial source files");
assert(canvas.includes("function videoDownloadHref") && canvas.includes('return String(node?.videoUrl || "").trim();') && !canvas.includes('url.searchParams.set("download", "1")'), "canvas video downloads must use the original video URL");
assert(!canvas.includes('`/api/canvas/video-download?url=${encodeURIComponent(raw)}&name=${encodeURIComponent(videoDownloadName(node))}`'), "canvas video downloads must not use the same-origin attachment proxy");
assert(server.includes('if (url.pathname === "/api/canvas/video-download") return await proxyVideoDownload(req, res, url);'), "canvas remote video download proxy route must exist");
assert(server.includes("videoLocalFile: localVideoFile") && server.includes("stampedLocalMediaUrl(localVideoFile)"), "standalone canvas videos must persist a local mp4 URL for durable downloads");
assert(canvas.includes("videoLocalFile: saved.videoLocalFile || node.videoLocalFile || \"\"") && canvas.includes("videoUrl: saved.videoUrl || node.videoUrl || videoUrl"), "canvas tail-frame persistence must replace expiring provider URLs with local media URLs");
assert(server.includes("nodeId: compactLine(meta.nodeId || \"\").slice(0, 120)") && server.includes("nodeId: body.nodeId || \"\""), "active canvas video usage records must keep nodeId for refresh recovery");
assert(server.includes('execFileSync("sh", ["-lc", \'command -v -- "$1"\''), "ffmpeg executable detection must use a robust shell command");
assert(server.includes("function markProjectVideoShotWaiting"), "tail-frame pending must be represented as queued waiting, not failed");
assert(server.includes("function waitForProjectVideoShotAssetGate"), "batch video queue must keep tail-frame wait support");
assert(server.includes("skippedReferenceAssets") && server.includes("canvasVideoSubmitCapableAssets"), "video generation must skip unfinished assets instead of blocking default generation");
assert(app.includes("function isBlockingCanvasVideoConfigMissing"), "frontend canvas handoff must distinguish blocking config gaps from skippable missing assets");
assert(app.includes("const blockingMissing = missing.filter(isBlockingCanvasVideoConfigMissing)"), "frontend canvas handoff must not block on skipped unfinished assets");
assert(!app.includes("片段引用了未生成资产："), "frontend canvas handoff must not fail only because optional references are unfinished");
assert(!app.includes("没有可用参考资产，请先生成或导入资产图"), "frontend canvas handoff must allow prompt-only video nodes when no assets are generated yet");
assert(server.includes("migrateAssetActivationFailuresToQueued"), "old asset-activation failures must be migrated away from failed status");
assert(server.includes("projectVideoShotIsWaitingForAssets"), "batch video queue must detect waiting asset-gate snapshots");
assert(server.includes("function recoverProjectVideoQueueIfNeeded"), "queued project video batches must recover after refresh or server restart");
assert(server.includes("recoverProjectVideoQueueIfNeeded(episodeRoot"), "project state refresh must restart a lost video queue");
assert(server.includes("queued_local|waiting_asset_active"), "queue recovery must distinguish batch queued snapshots from idle video shots");
assert(server.includes("isAssetActivationWaitFailure(snapshot.message || \"\")"), "queue recovery must include legacy queued snapshots without statusRaw");
assert(server.includes("existing?.statusCode === 1 && existing.taskId") && server.includes("continue;"), "queue initialization must not overwrite running video task snapshots");
assert(server.includes("refreshExistingProjectVideoTask(episodeRoot, shotName, runningSnapshot"), "recovered queues must reuse running tasks instead of submitting duplicates");
assert(server.includes("complete: taskInfo.status === 2 && (!tailFrameRequired || taskTailFrameReady)"), "project shot completion must respect Production Board no-tail-frame mode while preserving tail-frame gating when required");
assert(server.includes("function isProductionBoardMode"), "Production Board mode detection must be centralized");
assert(server.includes("projectShotAllVideoReferenceAssets"), "project payloads must include both official refs and Production Board refs");
assert(server.includes("function videoReferenceAssetHasPotentialSource"), "video generation must distinguish missing refs from refs that have a submit-capable source");
assert(server.includes("function projectShotUsableVideoReferenceAssets"), "project video generation must filter per-shot references down to submit-capable assets");
assert(server.includes("function clearResolvedVideoReferenceFailures"), "stale missing-reference video failures must be auto-cleared once refs become submit-capable");
assert(server.includes("clearResolvedVideoReferenceFailures(episodeRoot, config") && server.includes("clearResolvedVideoReferenceFailures(episodeRoot, configRecord?.data"), "canvas and project state reads must clear stale missing-reference failures");
assert(server.includes("const refs = projectShotUsableVideoReferenceAssets(episodeRoot, config, shot);"), "project photoreal validation must validate submit-capable video reference assets before submitting video");
assert(server.includes("skipped: stuck") && server.includes("默认按提示词生成"), "per-shot unfinished references must be non-blocking and fall back to prompt-only generation");
assert(server.includes("const refs = projectShotUsableVideoReferenceAssets(episodeRoot, config, shot);"), "project payloads must not submit local/empty/broken optional reference assets");
assert(!server.includes('throw new Error("缺少可提交的参考资产图') && !server.includes("throw new Error(`视频片段引用了未生成资产"), "project video generation must not fail only because optional references are unfinished");
assert(server.includes("storyboardCanvasNodeId"), "canvas sync must create stable Production Board nodes");
assert(server.includes('tailFrameRequired: latestTailFrameRequired'), "project snapshots must persist whether tail frames are required");
assert(server.includes("视频已生成，正在下载并抽取尾帧"), "video progress must expose finalization instead of marking URL-only tasks complete");
assert(server.includes("function projectVideoShotNeedsFinalization"), "project queue must model generated-but-tail-frame-not-ready as an active finalization state");
assert(server.includes("await finalizeExistingProjectVideoShot(episodeRoot, shotName, snapshot, runNamespace);"), "waiting for completion must actively finish local download/tail-frame extraction");
assert(server.includes("projectVideoShotNeedsFinalization(existingSnapshot)"), "single-shot generation must reuse finalizing video tasks instead of resubmitting");
assert(server.includes("projectVideoShotNeedsFinalization(snapshot)") && server.includes("return true;"), "queue recovery must resume finalizing video shots after server restart");
assert(server.includes("function isLikelyVideoUrl"), "video completion must only accept real downloadable video URLs");
assert(server.includes("function invalidVideoUrlReason"), "provider error text must not be stored as a video URL");
assert(server.includes("function assertValidDownloadedVideo"), "downloaded project videos must be validated before being marked local-ready");
assert(server.includes("视频下载不完整") && server.includes("content-length"), "project video downloads must reject truncated response bodies");
assert(server.includes('execFileSync("ffprobe"'), "project video downloads must verify that local MP4 files are parseable");
assert(server.includes("PROJECT_VIDEO_RANGE_CONCURRENCY"), "project video downloads must support bounded parallel range fetching");
assert(server.includes('Range: `bytes=${start}-${end}`'), "project video downloads must fetch remote videos with byte ranges when supported");
assert(server.includes("downloadRemoteVideoByRanges(cleanUrl, tmpTarget, rangeInfo.size)"), "project video downloads must use parallel range downloads before falling back to single connection");
assert(server.includes("const mergeCanvasVideoNodeState") && server.includes("tailSource.tailFrameReady === true"), "canvas writes must preserve completed video/tail-frame state from stale browser saves");
assert(server.includes("snapshotStatusForShot(episodeRoot, shotName, { runNamespace }) ||") && server.includes("runNamespace ? snapshotStatusForShot(episodeRoot, shotName)"), "tail-frame/project snapshot sync must fall back when run namespaces drift");
assert(server.includes("function syncCanvasStateFromProjectSnapshots"), "canvas state reads/writes must resync project video nodes from task snapshots");
assert(server.includes("const state = syncCanvasStateFromProjectSnapshots(projectId) || readCanvasState(projectId);"), "canvas state reads must use project task snapshots as the authority");
assert(server.includes("syncCanvasStateFromProjectSnapshots(written.projectId) || written"), "canvas state writes must repair stale browser saves from project task snapshots");
assert(server.includes("function existingTailFrameForShot"), "snapshot status must recover ready tail frames from existing local tail-frame files");
assert(server.includes("const taskTailFrameReady = taskInfo.tailFrameReady === true || !!recoveredTailFrame"), "project video snapshots must treat recovered tail frames as ready");
assert(server.includes("function canvasVideoFallbackForShot"), "project video generation must recover shot config from canvas nodes when config files are missing");
assert(server.includes("fallback?.config") && server.includes("fallback?.shot"), "project video generation must use canvas fallback config/shot before failing missing config");
const configCheckDir = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-toys-config-check-"));
try {
  const episodeRoot = path.join(configCheckDir, "project-a", "outputs", "e01");
  const otherEpisodeRoot = path.join(configCheckDir, "project-b", "outputs", "e01");
  const emptyConfigPath = path.join(configCheckDir, "empty_skill_config.json");
  const copiedConfigPath = path.join(configCheckDir, "copied_skill_config.json");
  fs.writeFileSync(emptyConfigPath, JSON.stringify({ episodeRoot, shots: [] }));
  fs.writeFileSync(copiedConfigPath, JSON.stringify({ episodeRoot: otherEpisodeRoot, shots: [{ id: "V001" }] }));

  assert(selectVideoConfigRecord([emptyConfigPath], { episodeRoot }) === null, "config discovery must reject empty video configs by default");
  assert(
    selectVideoConfigRecord([emptyConfigPath], { episodeRoot, allowEmptyShots: true })?.file === emptyConfigPath,
    "config discovery must accept empty video configs only when explicitly allowed",
  );
  assert(
    selectVideoConfigRecord([copiedConfigPath], { episodeRoot }) === null &&
      selectVideoConfigRecord([copiedConfigPath], { episodeRoot, allowEmptyShots: true }) === null,
    "config discovery must reject configs copied from another machine/project root",
  );
} finally {
  fs.rmSync(configCheckDir, { recursive: true, force: true });
}
assert(server.includes("function migrateInvalidVideoUrlsToFailed"), "legacy invalid videoUrl snapshots must be migrated to failed state");
assert(server.includes("migrateInvalidVideoUrlsToFailed(episodeRoot"), "project state refresh must clean invalid videoUrl snapshots before rendering progress");
assert(server.includes("function collectHistoricalAssetLibraryBindings"), "video config rebuild must inherit active asset:// bindings from previous canvas/config state");
assert(server.includes("applyAssetLibraryBindingsToRecords("), "rebuilt video config assets must keep active Gravitex asset bindings");
assert(server.includes("function isAssetLibraryTimeoutMessage"), "asset-library timeouts must not be mislabeled as missing video taskId");
assert(app.includes("const PROJECT_REFRESH_ACTIVE_MS = 2000;"), "project console must poll active video work every 2 seconds");
assert(app.includes("function videoProgressHasActiveWork"), "frontend refresh must inspect per-segment video activity, not only summary flags");
assert(app.includes("statusCode === 1") && app.includes("statusCode === 0"), "frontend refresh must treat running/queued task status codes as active work");
assert(app.includes("refreshSelectedProjectStatus().finally(() => scheduleProjectRefresh())"), "project refresh loop must be serial and reschedule after every poll");
assert(app.includes("scheduleProjectRefresh({ immediate: true })"), "project console must refresh immediately when the page becomes visible");
assert(app.includes("window._pixelToysRefreshInFlight") && app.includes("refreshSelectedProjectStatus().finally(() => scheduleProjectRefresh())"), "polling refresh must not recursively create overlapping refresh timers");
assert(app.includes("segment-task-id"), "video segment cards must expose real task/finalization status metadata");
assert(!server.includes("/api/" + "lib" + "tv"), "server must not expose removed video-platform API routes");
assert(!server.includes("RIFT" + "_VIDEO") && !server.includes("RIFT" + "_NEW") && !server.includes("RIFT" + "_ASSETS"), "server must not depend on removed external workflow scripts");
assert(!server.includes("function " + "lib" + "tv") && !server.includes("function create" + "Lib" + "tv"), "server must not keep removed platform helper functions");
assert(!app.includes("refresh" + "Lib" + "tvStatus") && !app.includes("lib" + "tvLogin"), "frontend must not include removed account controls");
assert(!html.includes("Lib" + "TV") && !html.includes("lib" + "tvLoginWidget") && !html.includes("studio" + "Lib" + "tvMount"), "project UI must not expose removed login entries");
assert(!styles.includes("login-panel") && !styles.includes("global-" + "lib" + "tv-login") && !styles.includes("studio-" + "lib" + "tv-mount"), "styles must not carry obsolete login selectors");
assert(!html.includes('data-window-id="relation"'), "node map module must stay removed from the UI");
assert(!html.includes("节点地图"), "node map copy must stay removed from the UI");
assert(app.includes("const FIXED_WORKSPACE_LAYOUT = true;"), "studio modules must use fixed adaptive layout, not draggable-only layout");
assert(styles.includes("Fixed adaptive studio layout"), "fixed adaptive studio layout styles are missing");
assert(styles.includes("body.is-studio .workspace-controls") && styles.includes("display: none"), "workspace drag/zoom controls must be hidden in fixed layout");
assert(styles.includes("Final Production OS workflow surface v20260723"), "studio workflow must keep the final Production OS visual override at the end of styles.css");
assert(styles.includes("body.is-studio .studio-workspace-layout {\n  display: grid !important;") && styles.includes("grid-template-columns: minmax(0, 1fr) minmax(260px, 310px);"), "studio workflow must use the final two-column production layout");
assert(styles.includes("@keyframes studioSurfaceIn") && styles.includes("@keyframes studioSoftSweep"), "studio workflow must keep the approved lightweight motion layer");
assert(styles.includes("Studio workflow correction v20260723-3"), "studio workflow must include the corrected production desk layer");
assert(styles.includes("body.is-studio .studio-console-head {\n  display: none !important;") && styles.includes("body.is-studio .studio-content-shell:has(.studio-tab-panel.is-active[hidden])"), "studio workflow must remove the old form-stack feel in script mode");
assert(html.includes('class="studio-sidebar"'), "studio must expose the new left production toolbar");
assert(html.includes('class="studio-console"'), "studio must expose the central generation console");
assert(html.includes('id="studioFlowStatus"'), "studio must expose the flow status strip");
assert(html.includes('data-studio-tab="assets"') && html.includes('data-studio-tab="storyboards"') && html.includes('data-studio-tab="logs"'), "studio content tabs are missing");
assert(html.includes('data-studio-panel="assets"') && html.includes('data-studio-panel="storyboards"') && html.includes('data-studio-panel="logs"'), "studio tab panels are missing");
assert(html.includes('id="studioLogContent"'), "studio log panel is missing");
assert(app.includes("function setStudioTab"), "frontend must bind the new studio content tabs");
assert(app.includes("function renderStudioFlowStatus"), "frontend must render real project state in the flow strip");
assert(styles.includes("Higgsfield-inspired studio shell"), "new studio visual shell styles are missing");
const projectFormHtml = sectionBetween(html, '<form id="projectForm" class="stack">', "</form>");
assert(!projectFormHtml.includes('name="ratio"'), "project creation must not expose video ratio; use video generation settings only");
assert(!projectFormHtml.includes('name="resolution"'), "project creation must not expose video resolution; use video generation settings only");
assert(!projectFormHtml.includes('name="modelName"'), "project creation must not expose video model; use video generation settings only");
const createProjectRoute = sectionBetween(server, 'if (req.method === "POST" && url.pathname === "/api/projects")', "  const projectMatch =");
assert(!/body\.(?:ratio|resolution|modelName)/.test(createProjectRoute), "project creation API must not accept video settings that conflict with video config");
assert(createProjectRoute.includes("createEpisodeWorkspace(projectDir, slug"), "project creation route must create the workspace locally");
assert(!createProjectRoute.includes("buildDraft("), "project creation must not block on draft/asset parsing");
assert(app.includes("payload.autoDraft = false;"), "frontend project creation must not request synchronous draft parsing");
assert(app.includes("项目已创建，可在制作台继续生成草稿和提取资产"), "project creation copy must tell users parsing is a later studio action");
assert(html.includes('data-window-id="storyboards"'), "Production Board window must exist");
assert(!html.includes('storyboard-grid-panel flow-preview draggable-window hidden'), "Production Board window must be visible by default");
assert(app.includes('element.dataset.windowId === "storyboards"'), "frontend must force-show the Production Board window during workspace hydration");
const dragonwakeManifest = path.join(root, "projects/Dragonwake/outputs/e01/03_asset_prompts/e01_asset_manifest.json");
if (fs.existsSync(dragonwakeManifest)) {
  const text = fs.readFileSync(dragonwakeManifest, "utf8");
  assert(!/Ω核心激活蓝色能量纹路|OMEGA_CORE_BLUE_ENERGY_INSERT|omega-shaped|圆形 Ω/i.test(text), "Dragonwake manifest contains stale Omega asset residue");
}

// Canvas access control: non-admins are canvas-disabled by default; the entry is only hidden while the feature stays intact, and admins toggle per-user access.
assert(server.includes('if (url.pathname === "/canvas.html" || url.pathname.startsWith("/api/canvas/"))'), "canvas page and API must be gated together in requireAuth");
assert(server.includes("if (!userCanUseCanvas(user)) {"), "canvas gate must reject users without canvas permission");
assert(server.includes("未开启画布权限，请联系管理员"), "canvas API must return an explicit 403 message for users without canvas permission");
assert(server.includes('if (url.pathname === "/" || url.pathname === "/index.html") return true;'), "home/index login gate must stay separate from the canvas permission gate");
assert(!server.includes('url.pathname === "/index.html" || url.pathname === "/canvas.html"'), "canvas.html must not remain in the login-only gate");
assert(server.includes('if (typeof body.canvasEnabled === "boolean") user.canvasEnabled = body.canvasEnabled;'), "admin user API must let admins toggle per-user canvas permission");
assert(adminReact.includes("admin-capability") && adminReact.includes("canvasEnabled ? \"已开启\" : \"未开启\""), "admin user rows must expose a canvas permission state");
assert(adminReact.includes('action === "toggle-canvas"'), "admin UI must expose a per-user canvas toggle control");
assert(adminReact.includes("canvasEnabled: !user.canvasEnabled"), "admin canvas toggle must post the inverted canvas permission");
assert(app.includes('canvasCard?.classList.toggle("hidden", !data.user?.canvasEnabled)'), "home page must hide the canvas entry for users without canvas permission");
assert(html.includes("canvas-entry-card hidden"), "canvas entry card must start hidden until permission is confirmed");
assert(canvasHtml.includes("<title>canvas</title>"), "canvas browser title must be canvas");
assert(canvasHtml.includes("<strong>canvas</strong>"), "canvas visible brand title must be canvas only");
assert(!canvasHtml.includes("画布 canvas") && !canvasHtml.includes("空白画布") && !canvasHtml.includes("Pixel Toys Canvas"), "canvas brand area must not show old canvas wording");
assert(!canvasHtml.includes('id="canvasProjectSelect"'), "canvas topbar must not show the standalone canvas project list");
assert(!canvas.includes('"空白画布"'), "canvas runtime must not restore the old blank canvas subtitle");
assert(canvasCss.includes(".canvas-brand-title"), "canvas brand title wrapper must exist for centerline alignment");
assert(canvasCss.includes(".canvas-brand-title {\n  display: flex;") && canvasCss.includes("align-items: center;"), "canvas text must align to the logo centerline");
assert(canvasCss.includes(".canvas-topbar {\n  position: fixed;") && canvasCss.includes("z-index: 1200;"), "canvas topbar must stay fixed above the canvas");
assert(canvasHtml.includes('class="canvas-button canvas-back-button"'), "canvas return-to-project action must live outside the crowded action group");
// 本文件的 assert 是第 32 行的自定义函数,没有 .match/.doesNotMatch(那是 node:assert 的)。
assert(/function setStudioBackLink\(\)[\s\S]*const href = "\/";/.test(canvas), "canvas return link must always return to the project page root");
assert(!/setStudioBackLink\(\)[\s\S]*\?project=/.test(canvas), "canvas return link must not reopen the studio with a project query");
assert(canvasCss.includes("#canvasStudioBack {\n  flex: 0 0 auto;") && canvasCss.includes("pointer-events: auto;"), "canvas return-to-project action must stay visible and clickable in compact layouts");
const assetNodeTemplateHtml = sectionBetween(canvasHtml, 'id="assetNodeTemplate"', "</template>");
assert(assetNodeTemplateHtml.includes("data-resize-handle"), "canvas asset node must expose a drag-resize handle");
const imageNodeTemplateHtml = sectionBetween(canvasHtml, 'id="imageNodeTemplate"', "</template>");
assert(imageNodeTemplateHtml.includes("data-resize-handle"), "canvas image node must expose a drag-resize handle");
assert(!canvasHtml.includes("contextSearch") && !canvasHtml.includes("context-search"), "canvas right-click creation menu must not expose a search box");
assert(!canvas.includes("contextSearch"), "canvas right-click creation menu must not focus or reset a removed search input");
assert(canvasCss.includes(".blank-canvas::before"), "canvas background grid must live on an unscaled pseudo layer");
assert(canvasCss.includes("canvas background grid stays screen-fixed and sharp") && canvasCss.includes("repeating-linear-gradient"), "canvas background grid must use sharp fixed linear grid lines instead of a blurred scaled dot texture");
assert(!sectionBetween(canvasCss, ".blank-canvas {", ".blank-canvas.is-asset-drag-over").includes("radial-gradient(circle, rgba(155, 207, 255"), "canvas base background must not use the old fuzzy radial dot texture");
assert(!canvasCss.includes(".blank-canvas.is-asset-drag-over::before"), "canvas drag-over state must not replace the sharp background grid pseudo layer");
assert(canvas.includes("function canvasDragHasPayload") && canvas.includes("function setCanvasAssetDragOver"), "canvas drag-over must use cached lightweight helpers instead of repeated DOM/class work");
const canvasDragOverHandler = sectionBetween(canvas, "function handleCanvasDragOver(event) {", "function handleCanvasDragLeave(event) {");
assert(!canvasDragOverHandler.includes("dataTransferHasType("), "canvas drag-over must not repeatedly rebuild dataTransfer types on every event");
assert(canvasDragOverHandler.includes("setCanvasAssetDragOver(true)") && !canvasDragOverHandler.includes("classList.add"), "canvas drag-over must only toggle DOM state through a guarded helper");
assert(canvasCss.includes(".canvas-context-menu") && canvasCss.includes("border: 0;"), "canvas right-click creation menu must use the borderless minimal shell");
assert(canvasCss.includes("@keyframes contextMenuIn"), "canvas right-click creation menu must keep a lightweight entrance animation");
assert(canvasCss.includes("prompt mention menu uses the same minimal shell as the blank-canvas menu"), "prompt mention menu must document the shared blank-canvas menu styling");
assert(canvasCss.includes("grid-template-columns: 42px minmax(0, 1fr);"), "prompt mention menu items must use a stable thumbnail/text grid");
assert(canvasCss.includes("grid-template-columns: 42px minmax(0, 1fr);") && canvasCss.includes("border: 0;\n  border-radius: 10px;\n  background: transparent;"), "prompt mention menu buttons must be borderless and minimal");
const gestureStartHandler = sectionBetween(canvas, "function handleCanvasGestureStart(event) {", "function handleCanvasGestureChange(event) {");
const gestureChangeHandler = sectionBetween(canvas, "function handleCanvasGestureChange(event) {", "function handleCanvasGestureEnd(event) {");
assert(!gestureStartHandler.includes("gestureWheelBlockUntil"), "canvas gesturestart must not block wheel zoom before a real gesture scale is applied");
assert(gestureChangeHandler.includes("gestureWheelBlockUntil"), "canvas gesturechange must block duplicate wheel zoom only after handling a real gesture scale");
assert(canvas.includes("const CANVAS_MIN_SCALE = 0.25;") && canvas.includes("const CANVAS_MAX_SCALE = 2.5;"), "canvas zoom must keep a bounded, recoverable scale range");
assert(canvas.includes("return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, safe));"), "canvas zoom clamp must enforce both scale boundaries");
assert(canvas.includes("function resetCanvasViewport(") && canvasHtml.includes("data-canvas-zoom=\"reset\""), "canvas zoom must expose an explicit reset path");
assert(canvas.includes("const CANVAS_ZOOM_SPEED = 0.0048;"), "canvas zoom response must be fast enough for touchpad pinch and wheel gestures");
assert(canvas.includes("ASSET_NODE_DEFAULT_WIDTH") && canvas.includes("ASSET_NODE_DEFAULT_HEIGHT"), "canvas asset nodes must have explicit image dimensions");
assert(canvas.includes("clampAssetNodeDimension(node?.width, ASSET_NODE_MIN_WIDTH, ASSET_NODE_MAX_WIDTH, ASSET_NODE_DEFAULT_WIDTH)"), "canvas asset nodes must restore a clamped saved width");
assert(canvas.includes("restored.width = legacyDefaultSize") && canvas.includes("clampAssetNodeDimension(node.width"), "canvas asset nodes must keep their saved dimensions after refresh");
assert(canvas.includes("function startNodeResize") && (canvas.includes('element.querySelector("[data-resize-handle]")') || canvas.includes('element.querySelectorAll("[data-resize-handle]")')), "canvas image node must wire its drag-resize handle");
assert(server.includes("clampCanvasAssetDimension(node.width, 96, 520, 300)"), "canvas asset node width must be sanitized server-side");
assert(server.includes("clampCanvasAssetDimension(node.height, 64, 420, 200)"), "canvas asset node height must be sanitized server-side");
assert(server.includes("CANVAS_VIDEO_DEFAULT_WIDTH") && server.includes("CANVAS_VIDEO_DEFAULT_HEIGHT"), "canvas video node dimensions must have server-side defaults");
assert(server.includes("clampCanvasAssetDimension(node.width, CANVAS_VIDEO_MIN_WIDTH, CANVAS_VIDEO_MAX_WIDTH, CANVAS_VIDEO_DEFAULT_WIDTH)"), "canvas video node width must be sanitized server-side");
assert(server.includes("clampCanvasAssetDimension(node.height, CANVAS_VIDEO_MIN_HEIGHT, CANVAS_VIDEO_MAX_HEIGHT, CANVAS_VIDEO_DEFAULT_HEIGHT)"), "canvas video node height must be sanitized server-side");
const assetImageRule = sectionBetween(canvasCss, ".asset-node-image {", ".canvas-node.asset-node:hover .asset-node-image,");
assert(assetImageRule.includes("width: var(--asset-node-width"), "canvas asset images must use node-specific resizable width");
assert(assetImageRule.includes("height: auto;"), "canvas asset images must not use a fixed contain box that separates the connector from the visible image");
assert(assetImageRule.includes("border: 0;"), "canvas asset images must be borderless");
assert(assetImageRule.includes("background: transparent;"), "canvas asset images must not sit inside a visible frame fill");
assert(assetImageRule.includes("box-shadow: none;"), "canvas asset images must not use heavy card shadows");
const assetCaptionRule = sectionBetween(canvasCss, ".asset-node-caption {", ".asset-node-file {");
assert(assetCaptionRule.includes("border: 0;"), "canvas asset captions must be borderless");
assert(assetCaptionRule.includes("background: transparent;"), "canvas asset captions must not use a boxed panel");
assert(assetCaptionRule.includes("opacity: 1;"), "canvas asset captions must stay visible without selection");
assert(assetCaptionRule.includes("max-height: 34px;") && assetCaptionRule.includes("white-space: normal;"), "canvas asset captions must remain readable across two lines");
const assetConnectorRule = sectionBetween(canvasCss, ".asset-node .asset-connector {", ".asset-node:focus-within .asset-connector,");
assert(assetConnectorRule.includes("width: 28px;") && assetConnectorRule.includes("height: 28px;"), "canvas asset plus connector must stay compact");
assert(assetConnectorRule.includes("border: 2px solid rgba(255, 255, 255"), "canvas asset plus connector must use a TapNow-style white circle");
assert(assetConnectorRule.includes("border-radius: 999px;"), "canvas asset plus connector must render as a circular endpoint");
assert(assetConnectorRule.includes("background: rgba(0, 0, 0"), "canvas asset plus connector must use a subtle dark center like the reference");
assert(assetConnectorRule.includes("box-shadow: none;"), "canvas asset plus connector must not use an outer glow shell");
assert(assetConnectorRule.includes("font-size: 0;") && assetConnectorRule.includes("color: transparent;"), "canvas asset plus connector must not use a text glyph");
assert(assetConnectorRule.includes("top: 50%;"), "canvas asset plus connector must track the visible image vertical middle");
assert(assetConnectorRule.includes("right: -14px;"), "canvas asset plus connector must center on the image right edge");
assert(canvasCss.includes(".asset-node .asset-connector::before") && canvasCss.includes(".asset-node .asset-connector::after"), "canvas asset plus connector must draw the plus with CSS strokes");
assert(canvasCss.includes('content: "";') && canvasCss.includes("background: rgba(255, 255, 255, 0.92);"), "canvas asset plus connector strokes must be white");
const assetConnectorVisibleRule = sectionBetween(canvasCss, ".asset-node:focus-within .asset-connector,", ".asset-node .asset-connector:active");
assert(!assetConnectorVisibleRule.includes(".asset-node:hover .asset-connector"), "canvas asset plus connector must not appear from whole-image hover");
assert(canvasCss.includes(".asset-node.has-output-link .asset-connector {\n  opacity: 1;"), "connected canvas asset nodes must show the plus endpoint");
assert(canvas.includes("return stagePoint(rect.right, rect.top + rect.height / 2);"), "canvas asset connection lines must start at the actual visible image right edge");
assert(canvas.includes('img.addEventListener("load", renderLinks, { once: true });'), "canvas asset image load must refresh connection geometry after the preview dimensions settle");
assert(canvas.includes("function markCanvasViewportMoving") && canvas.includes('classList.add("is-viewport-moving")'), "canvas panning must mark the viewport as moving");
assert(canvas.includes("translate3d(") && canvas.includes("Math.round(x)") && canvas.includes("Math.round(y)"), "canvas viewport transforms must avoid subpixel translate shimmer");
const movingCanvasRule = sectionBetween(canvasCss, ".blank-canvas.is-viewport-moving::before {", ".blank-canvas.is-viewport-moving .canvas-node {");
assert(movingCanvasRule.includes("image-rendering: auto;"), "moving canvas grid must disable pixelated rendering to avoid mosaic flicker");
const movingNodeRule = sectionBetween(canvasCss, ".blank-canvas.is-viewport-moving .canvas-node {", ".blank-canvas.is-viewport-moving .canvas-node.is-selected {");
assert(movingNodeRule.includes("backdrop-filter: none;") && movingNodeRule.includes("-webkit-backdrop-filter: none;"), "moving canvas nodes must disable backdrop filters while panning");
const compactAssetConnectorRule = sectionBetween(
  canvasCss,
  "body.canvas-page:not(.show-advanced-ui) .canvas-node:hover .node-port,",
  "body.canvas-page:not(.show-advanced-ui) .node-flow-summary",
);
assert(compactAssetConnectorRule.includes(".canvas-node.has-output-link .asset-connector"), "compact canvas connected asset plus endpoint must stay visible");
assert(canvasCss.includes(".asset-node .node-resize-handle"), "canvas asset selection must style a resize handle");
assert(canvas.includes("node.kind === \"asset\"") && canvas.includes("ASSET_NODE_MIN_WIDTH"), "canvas asset selection must use asset-specific resize bounds");
assert(canvasCss.includes(".asset-node .node-close {\n  display: none;"), "canvas asset selection must not reveal the floating delete control");
assert(canvasCss.includes("stroke: rgba(45, 140, 255, 0.95);") && canvasCss.includes("stroke-width: 1;"), "canvas connection lines must be ultra-thin pixel blue");
assert(canvasCss.includes("stroke-linecap: square;") && canvasCss.includes("shape-rendering: crispEdges;"), "canvas connection lines must render with a pixelated edge");
const canvasLinksRule = sectionBetween(canvasCss, ".canvas-links {", ".canvas-links path {");
assert(canvasLinksRule.includes("pointer-events: auto;"), "canvas link layer must receive pointer events so scissors can delete connections");
assert(canvas.includes('data-connection-index="${index}"') && canvas.includes('data-connection-cut="${index}"'), "canvas connection cut control must carry its own stable connection index");
assert(canvas.includes("function handleConnectionCutPointerDown(event)") && canvas.includes('event.target.closest(".connection-cut")'), "canvas connection cut control must use delegated pointer handling");
assert(canvas.includes('qs("#canvasLinks").addEventListener("pointerdown", handleConnectionCutPointerDown);'), "canvas connection cut pointer handler must stay bound after link re-renders");
const connectionCutRule = sectionBetween(canvasCss, ".connection-cut {", ".connection-link:hover .connection-cut");
assert(connectionCutRule.includes("pointer-events: all;"), "canvas connection cut control must stay pointer-clickable instead of disappearing on click");
assert(canvasCss.includes(".connection-cut circle") && canvasCss.includes(".connection-cut text") && canvasCss.includes("pointer-events: all;"), "canvas connection scissors glyph and hit circle must be directly clickable");
assert(!canvasCss.includes("stroke: rgba(210, 214, 220"), "canvas connection lines must not use the previous gray style");
assert(!canvasCss.includes("drop-shadow(0 0 8px rgba(22, 135, 255"), "canvas connection lines must not use the old blue glow");

// Admin authority is whitelist-only: the built-in "superadmin" username plus env PIXEL_TOYS_ADMIN_USERNAMES. No stored role flag, no first-user auto-promotion, no in-panel role changes.
assert(server.includes('const SUPER_ADMIN_USERNAME = "superadmin"'), "superadmin must be defined as the built-in super admin username");
assert(server.includes("[...new Set([SUPER_ADMIN_USERNAME, ...configured])]"), "adminUsernames must always include the built-in super admin");
assert(!server.includes('store.users.length ? "user" : "admin"'), "first registered user must no longer auto-become admin");
assert(!server.includes("!hasStoredAdmin && firstEnabledUser"), "the no-stored-admin first-user fallback must be removed");
assert(!server.includes('if (user.role === "admin") return "admin";'), "admin identity must come only from the username allowlist, not a stored role flag");
assert(!server.includes('if (body.role === "admin" || body.role === "user") user.role = body.role;'), "admin API must not mutate a user's stored role; admin is whitelist-only");
assert(!adminReact.includes('toggle-role'), "admin panel must not expose role promotion; admin membership is whitelist-only");
assert(server.includes('function invitationCodeUsed'), "invite validation must know whether a code has already been assigned to a user");
assert(server.includes('if (!verifyInvitationCode(inviteCode, store.users))'), "registration must reject invite codes already used by an existing user");
assert(server.includes('const INVITE_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"'), "generated invite codes must use uppercase letters only");
assert(server.includes("for (let i = 0; i < 7; i += 1)"), "generated invite codes must be exactly 7 uppercase letters");
assert(server.includes('/^[A-Z]{7}$/.test(code)'), "admin-created invite codes must be exactly 7 uppercase letters");

// Storyboard plot distribution: every beat sentence lands in exactly one panel (no gap), and split boards/parts never duplicate the same plot verbatim.
assert(server.includes("function storyboardPanelSourceText(segment = {}, localIndex = 0, localCount = 1)"), "storyboard panel text must be picked by the panel's local position within its segment, not the global panel index");
assert(!server.includes("beat.length > 520"), "long merged beats must not degrade every panel to a single placeholder");
assert(server.includes("Math.floor(((idx + 1) * total) / count)"), "panel text must distribute a segment's beat sentences into per-panel chunks");
assert(server.includes("const sameSegmentPanels = panelSegments.reduce"), "panel plan must compute each panel's local index within its own segment run");
assert(server.includes("function storyboardSegmentSlice(segment, offset, duration, partIndex = 1, partCount = 1)"), "over-length storyboard segments must partition beat/dialogue across parts instead of copying them verbatim");

// Storyboard board format: a 16:9 horizontal sheet with twelve equal panels in a 4x3 grid. Each panel pairs a cinematic frame with a deterministic production tab and visible identity anchors.
assert(server.includes("15 秒 16:9 横版 4×3 十二格故事板"), "server storyboard prompt must make the board landscape");
assert(assetRunner.includes("16:9 horizontal (landscape) sheet"), "storyboard generation contract must describe the whole board as a 16:9 horizontal sheet");
assert(!assetRunner.includes("one 9:16 vertical (portrait) sheet"), "storyboard generation contract must not describe the whole board as a 9:16 vertical sheet");
assert(assetRunner.includes("4-column grid") && assetRunner.includes("12 equal-size panels in a 4 columns x 3 rows grid"), "storyboard generation contract must specify an equal-size four-column, twelve-panel grid");
assert(!assetRunner.includes("2-column grid"), "storyboard renderer must not retain the retired 2-column grid");
assert(!server.includes("外层制作板为 16:9 排版"), "storyboard planner must not retain the legacy 16:9 board contract");
assert(!server.includes("按面板编号执行镜头：P1 建立空间与轴线"), "storyboard guidance must not retain the legacy fixed P1-P9 sequence");
assert(assetRunner.includes("visible identity anchors"), "storyboard renderer must retain visible identity references for cast, product and set continuity");
assert(assetRunner.includes("P1-P${STORYBOARD_BOARD_PANELS}: show chronological story beats"), "storyboard renderer must retain the twelve-panel fallback for the 4x3 contract");
assert(assetRunner.includes("deterministic post-process pastes the real reference assets there"), "storyboard renderer must add visible reference references to the final board");
assert(!assetRunner.includes("16:9 landscape Production Board"), "storyboard edits must preserve the vertical Production Board contract");
assert(assetRunner.includes("production-board-imagegen-v21-sheet-4x3-handlettered"), "storyboard renderer revision must invalidate boards generated before deterministic tail anchoring");
assert(assetRunner.includes("function stampStoryboardProductionTabs"), "storyboard renderer must overlay production tabs after image generation");
assert(assetRunner.includes("stampStoryboardProductionTabs(asset, out, assetReferenceImages);"), "storyboard renderer must typeset production tabs on every completed board");
assert(assetRunner.includes("PRODUCTION TAB"), "storyboard renderer must render the production tab label on the final board");
assert(assetRunner.includes("function isMissingPillowError"), "storyboard post-processing must detect missing Pillow separately");
assert(assetRunner.includes("optionalStoryboardPostprocess"), "missing Pillow must not fail an already generated Production Board image");
assert(server.includes("server-dependency") && server.includes("Python Pillow"), "Pillow dependency failures must not be reported as unknown");

assert(server.includes("凡文件名与当前 slot 名精确一致的都认作该 slot 已生成"), "storyboard display must fall back to on-disk boards matched by exact slot name so completed Production Boards are not shown as 缺失");

// Auto final-cut: assemble the full episode automatically once every shot clip is ready, no manual click.
assert(server.includes("function maybeAutoAssembleFinalCut(episodeRoot)"), "final cut must auto-assemble when all shot clips are ready");
assert((server.match(/maybeAutoAssembleFinalCut\(episodeRoot\)/g) || []).length >= 2, "auto final-cut trigger must be wired into both shot finalization and project state polling");
assert(server.includes("autoFinalCutSignatures"), "auto final-cut must guard against re-assembling the same clip set repeatedly");

// Video readiness must not block batch submit when refs exist on disk but the config.assets list lags (namespace/regroup drift).
assert(server.includes("function assertVideoConfigAssetsReady(config = {}, shot = null, episodeRoot = \"\")"), "asset-readiness check must accept episodeRoot for on-disk fallback");
assert(server.includes("for (const asset of scanAssets(root)) {") && server.includes("assetNames.add(name)"), "asset-readiness check must merge on-disk asset names so lagging config.assets does not block submission");

// Storyboard slots must match on-disk boards by a stable key (covered shot set), not literal filename, so regrouping/renaming does not break display/links/refs.
assert(server.includes("function matchStoryboardAssetForSlot"), "storyboard slots must match assets by stable shot-set key");
assert(server.includes("function storyboardShotStemsFromName"), "storyboard matching must parse covered shot stems from the board filename");
assert(server.includes("bareStems") && server.includes("/(?:^|_)V\\d+/gi"), "storyboard matching must parse bare V001 stems from Production Board filenames");
assert(server.includes("shotStemFromName(s).toUpperCase()"), "storyboard matching must compare normalized shot stems, not full shot titles");
assert(server.includes("matchStoryboardAssetForSlot(slot, storyboardCandidates"), "storyboardSlotsForState must use stable-key matching instead of literal byName.get(slot.id)");
assert(server.includes("partialCoverage"), "storyboard slots must flag partial coverage so users can choose to regenerate");

// Asset rendering style is authored in the document prompt. The UI keeps only an optional style reference image.
assert(!server.includes("assetStyleFromBody"), "asset generation must not read a style preset from the request");
assert(html.includes('id="assetStyleReferenceFile"'), "legacy asset generation must retain style reference upload");
assert(html.includes('id="modernAssetStyleReferenceFile"'), "modern asset generation must retain style reference upload");
assert(!html.includes('id="assetStylePreset"') && !html.includes('id="assetStyleCustom"'), "legacy asset generation must not expose style selectors");
assert(!html.includes('id="modernAssetStylePreset"') && !html.includes('id="modernAssetStyleCustom"'), "modern asset generation must not expose style selectors");

// Video (Seedance) prompt must carry a mandatory style law from the asset style, and realistic light/skin cues must be photoreal-only.
assert(server.includes("function seedanceStyleLawForPreset"), "seedance prompt must derive a mandatory style law from the asset style preset");
assert(server.includes("镜号 ${index + 1}（${duration} 秒）"), "seedance prompt must begin with the natural-language shot number and duration");
assert(server.includes("人声 OS：${d.voice_over}") && server.includes("人物台词：${dialogue}") && server.includes("音效：${d.sound}"), "seedance prompt must retain voice-over, dialogue, and sound fields");
assert(server.includes("style: seedanceStyleLawForShot(stylePreset, shot?.videoStyleDirective)"), "seedance natural-language prompt must inject the style law");
assert(server.includes("const videoStylePreset = videoStylePresetFromProductionAssets(productionAssets, body);"), "video config must resolve the project video style from the reference assets");
assert(server.includes("photoreal\n      ? design.lighting") || server.includes("photoreal"), "realistic lighting/skin cues must be gated to photoreal style only");
assert(server.includes("function sanitizeSeedancePromptForPolicy"), "Seedance prompt submission must sanitize copyright/policy-risk wording before provider submit");
assert(server.includes("sanitizeSeedancePromptForPolicy(blocks"), "cleanSeedancePromptForSubmission must run the policy sanitizer after assembling prompt blocks");
assert(server.includes("版权限制") && server.includes("原创化改写"), "video copyright restriction failures must be normalized to a Chinese actionable message");
assert(canvas.includes("版权限制") && canvas.includes("原创化改写"), "canvas video error UI must explain copyright restriction failures in Chinese");



// 统一参考图交付:阶段0 + 双轨 + 防 person-reference 回归
assert(server.includes('require("./scripts/video-ref-prep.js")'), "server 必须复用 video-ref-prep 纯模块");
assert(server.includes("async function prepareBatchVideoReferences"), "必须有阶段0编排器 prepareBatchVideoReferences");
assert(server.includes("await prepareBatchVideoReferences(episodeRoot, prepRecord, selected"), "批量入口必须在提交前跑阶段0");
assert(server.includes("async function ensureArkPersonAssetsForNames"), "短剧单段入口必须复用 Ark 私域虚拟人像认证函数");
assert(server.includes("const deadline = Date.now() + PREPARE_REFS_TIMEOUT_MS"), "单段认证必须使用阶段0超时窗口");
assert(server.includes("正在完成方舟私域虚拟人像认证，完成后自动提交视频"), "单段认证轮询必须放入后台并保持 queued 状态");
assert(server.includes("pollInBackground: true"), "项目视频 HTTP 路由必须强制后台轮询，避免认证阻塞响应");
assert(server.includes("默认按提示词生成"), "阶段0 未就绪资产必须降级为默认提示词生成而不是整批中止");
assert(server.includes("async function ensurePublicReferenceUrl"), "非人物轨必须有公网地址确保函数");
assert(!server.includes('modelMode = usesValidatedRealisticRefs ? "seedance-2-0-person-reference"'), "禁止再引入 person-reference 自动切换(防回归)");
assert(!server.includes("非超写实资产跳过素材库验证"), "validateCanvasPhotorealAssets 不得再对传入资产做 photoreal 短路跳过");
assert(server.includes("function assertArkPersonAssetsReady"), "Ark-bound person assets must be server-validated");
assert(server.includes('role: "first_frame"') && server.includes('role: "last_frame"'), "Ark payload must use official first/last-frame roles");
assert(canvas.includes("arkPersonAsset") && canvas.includes('frameControl === "first_last"'), "standalone canvas must preserve Ark binding and manual frame state");
assert(
  /const ARK_PERSON_TARGET_MODELS = new Set\(\[\s*"seedance-2-0",\s*"seedance-2-0-fast",\s*"seedance-2-0-mini",\s*\]\)/.test(server),
  "Ark private-library routing must target Seedance 2.0, Fast, and Mini",
);
assert(!canvas.includes('PERSON_REFERENCE_MODEL'), "canvas must not retain the removed person-reference model branch");
assert(canvas.includes('"seedance-2-0-person-reference": "seedance-2-0"'), "canvas must migrate legacy person-reference nodes to ordinary Seedance 2.0");

assert(server.includes("referencedStoryboardNodeIds") && server.includes("剪除") , "画布同步必须剪除未被当前镜头引用的故事板孤儿节点");

assert(server.includes("function storyboardSeedancePrompt") && server.includes("function seedancePromptForShotMode"), "故事板/首尾帧必须是两套提示词,按模式选择器注入");
assert(server.includes("seedancePromptForShotMode(shot, index, dialogueLanguage, storyboardsActive)"), "视频配置生成必须按 storyboardsActive 自动选提示词方案");
const shotPromptSectionGuard = sectionBetween(server, "function isShotPromptSection(section)", "function defaultGroupName");
assert(shotPromptSectionGuard.includes("/^V\\d+/i.test(name)"), "Seedance prompt parser must accept short V01/V001 section headings");
assert(shotPromptSectionGuard.includes("参考资产"), "Seedance prompt parser must accept current 参考资产 sections, not only old 参考映射 sections");
assert(server.includes("matchAll(/^#{2,3}"), "Seedance prompt parser must accept ## and ### shot headings");
assert(server.includes("模型导演设计缺失或已过期，请重新生成分镜草稿后再生成视频配置。"), "video config must reject a missing or stale model shot plan instead of falling back to prompt parsing");
assert(server.includes("function seedancePromptMarkdownFromConfig"), "project state must be able to reconstruct Seedance prompt markdown from video config shots");
assert(server.includes("seedancePromptsTextForState(episodeRoot, files.seedancePrompts, config?.data)"), "project state must hydrate empty Seedance prompt files from config shots");
assert(server.includes("skipEmptySeedancePromptOverwrite"), "file save API must refuse empty Seedance prompt overwrites when config already has prompts");

assert(server.includes("const beatHasPerson =") && server.includes("继承最近一段有角色"), "beat 描写人却无具名角色时必须就近继承人物参考(避免乱编人脸)");

assert(server.includes("const processQueueShot = async") && server.includes("await runWithConcurrency(selected, concurrency, processQueueShot)"), "故事板模式必须并发出片(工作池),受并发上限约束");
assert(
  server.includes("await runWithDependencies(selected, concurrency, processQueueShot") &&
    server.includes("const onBlocked =") &&
    server.includes("本段未提交"),
  "首尾帧模式必须按依赖链串行并在前序失败时阻断下游",
);

console.log("Pixel Toys self-check passed.");
