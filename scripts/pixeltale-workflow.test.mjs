import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pixeltaleApi = fs.readFileSync(path.join(root, "server/pixeltale-api.js"), "utf8");
const pixeltaleAgentSource = fs.readFileSync(path.join(root, "server/pixeltale-agent.js"), "utf8");
process.env.PIXELTALE_GPT_API_KEY ||= "sk-test-pixeltale-gpt-000000000000";
process.env.PIXELTALE_GEMINI_API_KEY ||= "sk-test-pixeltale-gemini-000000000000";
const { callPixelTaleApiModel, readStreamPayload, reviewModels, models, MODEL_DEFINITIONS, GROK_FALLBACK_MODEL, GEMINI_FALLBACK_MODEL } = createRequire(import.meta.url)("../server/pixeltale-api.js");
const apiTemperatures = [];
await callPixelTaleApiModel({ model: "gpt-5.6-terra", system: "test", user: "test", temperature: 0.6, fetchImpl: async (_url, options) => {
  apiTemperatures.push(JSON.parse(options.body).temperature);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
} });
await callPixelTaleApiModel({ model: "gpt-5.6-terra", system: "test", user: "test", fetchImpl: async (_url, options) => {
  apiTemperatures.push(JSON.parse(options.body).temperature);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
} });
assert.deepEqual(apiTemperatures, [0.6, 0.25], "the API temperature override and compatibility default must be preserved");
const html = fs.readFileSync(path.join(root, "public/pixeltale.html"), "utf8");
const nestedHtml = fs.readFileSync(path.join(root, "public/pixeltale/pixeltale.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/pixeltale/app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "public/pixeltale/styles.css"), "utf8");
const agent = fs.readFileSync(path.join(root, "server/pixeltale-agent.js"), "utf8");
const { createPixelTaleAgent, callStageCouncil, collectCrossReviewQuorum, aggregateCrossReview, batchReviewSummary, buildRevisionContract, isMandatoryReviewIssue, mergeRevisionContent, reviewAdvisoryGate, titleStylePrompt, validateContent, validateReview, runStageRules, computeMergeAudit, normalizeRoutes, stageOutputContract, createHandoffPayload } = await import(pathToFileURL(path.join(root, "server/pixeltale-agent.js")).href);

const ruleFindings = (result, code) => result.violations.filter((item) => item.code === code);
assert.ok(ruleFindings(runStageRules({ stage: "brief", artifact: {}, approvedContext: {} }), "SCHEMA_INCOMPLETE").length, "rules must detect missing stage schema fields");
assert.ok(ruleFindings(runStageRules({ stage: "arc", artifact: { units: [{ number: 1 }] }, approvedContext: { unitScope: [1, 2] } }), "UNIT_COUNT_MISMATCH").length, "rules must detect missing or extra requested units");
assert.ok(ruleFindings(runStageRules({ stage: "brief", artifact: { locked: "changed" }, approvedContext: { lockedArtifact: { locked: "original" } }, lockedPaths: ["locked"] }), "LOCKED_PATH_TOUCHED").length, "rules must detect locked path changes");
assert.ok(ruleFindings(runStageRules({ stage: "review", artifact: { dimensions: { structure: {}, plot: {}, design: {}, } } }), "DIMENSION_KEY_MISSING").length, "rules must detect missing review dimensions");
assert.ok(ruleFindings(runStageRules({ stage: "arc", mode: "tk_short_drama", artifact: { units: [{ number: 1, hook_zh: "月光洒在空房间" }] } }), "EMPTY_HOOK").length, "TK rules must detect empty or atmospheric hooks");
const localizedNames = runStageRules({ stage: "characters", artifact: { characters: [{ name_zh: "李明", plot_zh: "李明在雨夜追查真相。" }] }, approvedContext: { marketCountry: "united_states" } });
assert.equal(ruleFindings(localizedNames, "NAME_LOCALIZATION").length, 1, "western-market CJK display names must be flagged");
const chinesePlot = runStageRules({ stage: "brief", artifact: { title_zh: "雾镇", logline_zh: "中文剧情叙述：主角在雨夜追查真相。", core_conflict_zh: "真相与生存冲突", viewer_question_zh: "他能否活下来？" }, approvedContext: { marketCountry: "united_states" } });
assert.equal(ruleFindings(chinesePlot, "NAME_LOCALIZATION").length, 0, "Chinese plot narration must never trigger NAME_LOCALIZATION");
const localizedCharacterFields = runStageRules({ stage: "characters", artifact: { characters: [{ name_zh: "李明", plot_zh: "李明在雨夜追查真相。" }] }, approvedContext: { marketCountry: "united_states" } });
assert.equal(ruleFindings(localizedCharacterFields, "NAME_LOCALIZATION").length, 1, "NAME_LOCALIZATION must inspect characters[].name_zh in the characters stage");
assert.equal(ruleFindings(runStageRules({ stage: "brief", artifact: { title_zh: "雾镇", logline_zh: "中文剧情叙述：主角在雨夜追查真相。" }, approvedContext: { marketCountry: "united_states" } }), "NAME_LOCALIZATION").length, 0, "NAME_LOCALIZATION must not inspect non-character stages");

// Roster measured on a real trimmed scenes payload (10 scenes over 5 episodes):
// gpt-5.6-terra 122s, gpt-5.6-sol 108s, deepseek-v4-pro 166s, grok-4.5 99s.
// claude-opus-5 was replaced after timing out at 300s and claude-haiku-4-5 after
// returning a valid-but-empty scenes array.
const ROSTER = [["seat_a", "gpt-5.6-terra"], ["seat_b", "gpt-5.6-sol"], ["seat_c", "deepseek-v4-pro"]];
const fixedReviewSeats = ["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue"]
  .map((stage) => ({ stage, models: reviewModels({ stage }) }));
assert.deepEqual(
  fixedReviewSeats.map(({ models }) => models.map((item) => [item.seatId, item.model])),
  fixedReviewSeats.map(() => ROSTER),
  "review seat identities and models must remain fixed across all stages",
);
// The seats must stay three genuinely different models. Two seats sharing one model
// collapses cross-review into a single opinion voting twice, which is exactly what
// the degraded-quorum guard exists to reject.
const rosterModels = fixedReviewSeats[0].models.map((item) => item.model);
assert.equal(new Set(rosterModels).size, 3, "the three seats must be three distinct models");
assert.ok(!rosterModels.includes(GROK_FALLBACK_MODEL), "the shared fallback model must not also hold a seat, or a single failure would fake a quorum");
assert.equal(fixedReviewSeats[0].models[0].fallbackModels[0], GEMINI_FALLBACK_MODEL, "seat_a must prefer the configured Gemini fallback");
assert.notEqual(fixedReviewSeats[0].models[0].fallbackModels[0], fixedReviewSeats[0].models[2].fallbackModels[0], "seat_a and seat_c must not collapse onto the same fallback");

// Retiring a model must still rewrite stored routes on read and persist the result,
// otherwise a saved session keeps reclaiming a seat with a model we removed.
// Nothing is retired right now, so this asserts the machinery rather than a victim.
assert.match(agent, /LEGACY_ROUTE_MODELS\.has\(raw\)/, "route normalization must consult the retired-model list");
assert.match(agent, /routesNeedMigration\(storedRoutes\)/, "a migrated route must be detected on read");
assert.match(agent, /persistState\(params, state\)/, "a migrated route must be written back, not just fixed in memory");
const unknownRouteStore = new Map([["route-fallback", { projectId: "route-fallback", routes: { seat_c: "model-that-was-removed" } }]]);
const fallbackAgent = createPixelTaleAgent({
  modelRouter: { models: () => ROSTER.map(([, id]) => ({ id, provider: id.startsWith("gpt-") ? "chatgpt" : "deepseek" })), status: () => ({}), call: async () => ({ content: {} }) },
  readPixelTaleState: (rootPath) => unknownRouteStore.get(rootPath) || {},
  writePixelTaleState: (rootPath, state) => unknownRouteStore.set(rootPath, structuredClone(state)),
});
assert.equal(
  fallbackAgent.status({ pixelTaleRoot: "route-fallback", projectId: "route-fallback" }).routes.seat_c,
  "deepseek-v4-pro",
  "a route naming an unavailable model must fall back to the seat default",
);

// Editing REVIEW_SEATS must actually reach existing projects. A stored session
// pins seat_* explicitly, and those values override the new defaults — so without
// a retired-seat migration a roster change silently applies to new sessions only.
// This was live: both production projects kept running the previous roster after a
// reseat because their state files still named it.
const storedOldRoster = {
  orchestration: "gpt-5.6-terra", continuity: "claude-opus-5", hooks: "claude-haiku-4-5",
  dialogueReview: "claude-sonnet-5", consistency: "gpt-5.6-luna",
  seat_a: "gpt-5.6-terra", seat_b: "claude-opus-5", seat_c: "claude-haiku-4-5",
};
const reseated = normalizeRoutes(storedOldRoster, models());
assert.deepEqual(
  ROSTER.map(([seatId]) => reseated[seatId]),
  ROSTER.map(([, model]) => model),
  "a stored session pinning a replaced roster must migrate to the current seats",
);
// The vestigial 5-slot keys no longer choose seats. Rewriting them would map a
// value onto itself and re-persist state on every single read.
assert.equal(reseated.continuity, "claude-opus-5", "the legacy route slots must be left untouched by a reseat");
assert.deepEqual(normalizeRoutes(reseated, models()), reseated, "route normalization must be idempotent, or every read rewrites the session");

assert.match(agent, /modelRouter\.call/, "PixelTale must delegate text execution to an injected model router");
assert.match(agent, /modelRouter\.reviewModels\(route\)/, "cross-review must be selected by the independent PixelTale router");
assert.doesNotMatch(agent, /PIXELTALE_(CHATGPT|CLAUDE|GROK|DEEPSEEK)_API_KEY/, "PixelTale must not own provider credentials");
assert.match(app, /persistActiveRun\(null\);[\s\S]{0,80}state\.lastError = userFacingError\(error\)/, "any monitor failure (terminal RUN_INTERRUPTED or network polling failure) must clear the stale activeRun so the stage shows a rerun button instead of stuck 'processing'");
assert.match(app, /syncRoutingModelOptions\(agent\.modelOptions \|\| \[\]\)/, "model choices must be synchronized from SuperPixel's returned registry");
assert.doesNotMatch(app, /\["chatgpt", "claude", "deepseek"\]/, "review UI must not deduplicate seats by provider");
assert.match(app, /const reviewTeam = seatDefaults\.map\(\(seat, index\) =>/, "review UI must always render from the three-seat roster");
assert.match(app, /reviewFeedbacks\[index\]\?\.seatId \? null : reviewFeedbacks\[index\]/, "historical feedback without seat ids must use positional matching");
const modelTeamRenderer = app.slice(app.indexOf("function renderModelTeam()"), app.indexOf("function collectBriefInput()"));
const modelCardTemplate = modelTeamRenderer.slice(modelTeamRenderer.indexOf("return `<button"), modelTeamRenderer.indexOf("}).join(\"\");"));
assert.doesNotMatch(modelCardTemplate, /requiredModel|meta\.name|actualModel/, "seat card templates must not expose model identifiers");
assert.match(modelTeamRenderer, /已启用备用模型/, "seat cards must use the generic fallback notice");
assert.match(styles, /@keyframes pixeltale-seat-breathe/, "seat cards must have a breathing animation");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*model-team-cards\.is-breathing/, "seat breathing must respect reduced-motion preferences");
assert.match(app, /seat_b[\s\S]*seat_c/, "review UI must retain distinct B and C Claude seats");

assert.match(html, /id="newDraft"[^>]*>[^<]*<span[^>]*>\+<\/span>\s*新建剧集/, "new story action must be explicit");
assert.match(html, /<optgroup label="Gemini"><option value="gemini-3\.1-pro">Gemini 3\.1 Pro<\/option><\/optgroup>/, "every creative-routing select must offer Gemini 3.1 Pro as the Claude replacement");
assert.match(app, /continuity: "gemini-3\.1-pro"/, "the default continuity route must be Gemini 3.1 Pro, not Claude");
assert.match(app, /"gemini-3\.1-pro": \{ name: "Gemini 3\.1 Pro", provider: "gemini"/, "the model meta table must describe Gemini 3.1 Pro");
assert.match(app, /groups = \{ chatgpt: \[\], claude: \[\], gemini: \[\] \}/, "routing sync must accept Gemini providers");
assert.match(app, /labels = \{ chatgpt: "GPT", claude: "Claude", gemini: "Gemini" \}/, "routing sync must label Gemini as a first-class provider");
assert.doesNotMatch(pixeltaleApi, /id: GEMINI_FALLBACK_MODEL,[\s\S]*?fallbackOnly: true/, "Gemini must be a primary (selectable) model, not fallback-only");
assert.match(pixeltaleAgentSource, /const DEFAULT_ROUTES = \{[\s\S]*?continuity: "gemini-3\.1-pro"/, "the server default continuity route must be Gemini 3.1 Pro");
const pixelTaleStylesStamp = html.match(/pixeltale\/styles\.css\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
const pixelTaleAppStamp = html.match(/pixeltale\/app\.js\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
assert.ok(pixelTaleStylesStamp && pixelTaleAppStamp, "PixelTale static assets must carry cache stamps");
assert.equal(pixelTaleAppStamp, pixelTaleStylesStamp, "PixelTale styles and app cache stamps must stay synchronized");
// Assert the stamp's shape, not a literal value: pinning the exact string means
// every legitimate cache bust also has to edit this test, and a stale literal here
// has broken the suite before.
assert.match(pixelTaleAppStamp, /^pixeltale-runtime-\d{8}-r\d+$/, "the PixelTale bundle stamp must follow pixeltale-runtime-<date>-r<n> so each deploy can invalidate the cache");
// Both entry points serve the same bundle; a stamp that only advances in one of them
// leaves half the users on the old script.
const nestedAppStamp = nestedHtml.match(/pixeltale\/app\.js\?v=([0-9a-zA-Z._-]+)/)?.[1] || "";
assert.equal(nestedAppStamp, pixelTaleAppStamp, "both PixelTale entry HTML files must carry the same bundle stamp");
assert.equal(nestedHtml.match(/pixeltale\/app\.js\?v=([0-9a-zA-Z._-]+)/)?.[1], pixelTaleAppStamp, "the nested PixelTale entry must share the runtime stamp");
assert.equal(nestedHtml.match(/pixeltale\/styles\.css\?v=([0-9a-zA-Z._-]+)/)?.[1], pixelTaleStylesStamp, "the nested PixelTale styles must share the runtime stamp");
assert.match(app, /function startNewDraft\(\)[\s\S]*localStorage\.setItem\(SESSION_STORAGE_KEY[\s\S]*window\.location\.assign/, "new story must rotate the session before navigating");
assert.match(app, /function userFacingError\(error\)/, "provider errors must be normalized for users");
assert.match(app, /agentTaskCopy"\)\.textContent = state\.lastError \|\| action\.copy/, "run errors must remain visible in the right-rail next action");
assert.match(app, /agentTaskCopy"\)\.setAttribute\("role", state\.lastError \? "alert"/, "run errors must be announced from the right-rail next action");
assert.match(app, /function renderBriefArtifact\(\)/, "brief output must show its generated artifact and review state");
assert.match(app, /const inspirationPool = \[/, "brief stage must expose the current Story DNA taxonomy");
assert.match(app, /const dnaAudienceRecommendations = \{/, "Story DNA must retain audience-based recommendations");
assert.match(app, /kind: "情绪关系"/, "Story DNA must include relationship-emotion taxonomy");
assert.match(app, /kind: "冲突机制"/, "Story DNA must include conflict-mechanism taxonomy");
assert.match(app, /kind: "世界设定"/, "Story DNA must include world-setting taxonomy");
assert.match(app, /kind: "视觉风格"/, "Story DNA must include visual-style taxonomy");
assert.match(app, /kind: "时代"/, "Story DNA must include era taxonomy");
assert.match(app, /"视觉风格": "视觉"/, "Story DNA must expose a compact visual-style filter label");
assert.match(app, /"时代": "时代"/, "Story DNA must expose an era filter label");
assert.match(app, /function toggleDnaWindow\(open\)/, "Story DNA must have an explicit expand/collapse interaction");
assert.match(app, /data-dna-toggle/, "Story DNA must expose a visible launch control");
assert.match(app, /id=\"dnaWindow\" class=\"dna-window\" hidden/, "Story DNA field must start collapsed");
assert.match(app, /data-dna-filter/, "Story DNA must expose category filters");
assert.match(app, /data-dna-tag/, "Story DNA tags must remain selectable");
assert.match(app, /class=\"dna-tag-layer\" role=\"list\">\$\{tags\}/, "Story DNA tags must render in one dedicated tag layer");
assert.doesNotMatch(app, /data-dna-canvas|class=\"dna-core\"|dna-thinking-state/, "Story DNA must not render the retired central visual treatment");
assert.doesNotMatch(app, /startDnaMotion|createDnaParticles|stopDnaMotion/, "Story DNA must not retain inactive canvas motion code");
assert.match(app, /title: `\$\{flowMeta\.title\}技术未完成`[\s\S]*请重新提交当前阶段/, "technical review blockers must explain that review is incomplete");
assert.match(app, /review-zone-mandatory[\s\S]*review-zone-optional[\s\S]*review-zone-adjudication[\s\S]*review-zone-technical/, "review UI must expose the four fixed review zones");
assert.match(app, /kind: "auto-revise"[\s\S]*一键修订并复审/, "review flow must expose one canonical revision action");
assert.match(app, /review-zone-mandatory[\s\S]*必须修订/, "mandatory revisions must be presented in the mandatory zone");
assert.match(app, /return mergeReviewItems\(\[\.\.\.pendingClosures, \.\.\.mandatoryIssues, \.\.\.acceptedAdvisories\]\)/, "revision UI must merge unresolved contracts with newly discovered mandatory issues");
assert.match(app, /review-reference-panel/, "optional review material must be collapsible");
assert.doesNotMatch(app, /review-auto-fix/, "review panel must not expose a duplicate revision button");
assert.match(html, /id="agentTaskAction"/, "the right rail must contain the canonical next-step action slot");
assert.match(app, /function renderAgentTaskAction\(action\)/, "the right rail must render the current workflow action");
assert.match(app, /function bindAgentTaskAction\(\)/, "the right rail action must have a dedicated event binding");
assert.match(app, /const productionStageTotal = stageOrder\.length - 1/, "progress must use the seven confirmable production stages");
assert.match(app, /function productionProgressLabel\(stage = workflowStage\(\)\)/, "all progress surfaces must share one stage counter");
assert.match(app, /\$\("#flowStepCounter"\)\.textContent = productionProgressLabel\(flowStage\)/, "right-rail progress must use the shared counter");
assert.match(app, /当前阶段 \$\{productionProgressLabel\(workflowStage\(\)\)\}/, "central progress must use the shared counter");
assert.match(html, /<span>当前阶段<\/span><span id="flowStepCounter">01 \/ 07<\/span>/, "right rail must label its seven-stage progress consistently");
assert.match(html, /id="approvedCount">0 \/ 7/, "left rail must keep the seven-stage confirmation denominator");
assert.doesNotMatch(html, /data-stage="script"/, "the screenplay body must not be a separate production stage");
assert.doesNotMatch(nestedHtml, /data-stage="script"/, "the nested PixelTale page must not expose a screenplay body stage");
assert.match(app, /stageOrder = \["brief", "title", "proposal", "characters", "arc", "scenes", "dialogue", "handoff"\]/, "the screenplay body must be assembled at export after dialogue");
assert.doesNotMatch(app, /script: \{ kicker: "08 \/ SCRIPT"/, "the screenplay body must not have a separate stage definition");
assert.doesNotMatch(html, /class="agent-context"/, "the right rail must not show a passive context module");
assert.doesNotMatch(html, /id="contextChips"|id="editContext"/, "passive context chips and their dead edit action must be removed");
assert.doesNotMatch(nestedHtml, /class="agent-context"|id="contextChips"|id="editContext"/, "the nested PixelTale page must not retain the passive context module");
assert.doesNotMatch(app, /contextChips|editContext/, "the app must not render or bind the removed passive context module");
assert.doesNotMatch(app, /renderNextStep/, "the central workspace must not render a duplicate next-step card");
assert.doesNotMatch(app, /review-button-action/, "artifact cards must not expose a second confirmation entry");
assert.match(app, /const fieldLabelMap = \{[\s\S]*title_zh: "剧名"/, "structured fields must have Chinese display labels");
assert.match(app, /data-regenerate-title/, "title selection must expose a regenerate action before approval");
assert.match(app, /生成 4 个剧名候选[\s\S]*重新生成 4 个/, "title UI must expose exactly four title choices");
assert.match(app, /中文释义只供创作者对照，不会写入后续正式标题/, "title UI must distinguish the English release title from its Chinese explanation");
assert.match(app, /data-flow-action="approve"[\s\S]*data-approve-artifact/, "the right rail must expose a clickable artifact confirmation action");
assert.match(app, /单模型生成完成 · 等待人工选择[\s\S]*不进入交叉审核/, "title UI must explain its single-model no-review policy");
assert.match(agent, /正式发行片名必须使用自然英文/, "title generation must follow the release language instead of returning Chinese names");
assert.match(agent, /人物身份或关系、地点或机构、异常物件或意象、带双重含义的极简短语/, "title generation must enforce four distinct naming genes");
assert.match(agent, /Billionaire、CEO、Mafia、Reborn、Revenge/, "title generation must reject generic web-fiction naming templates");
const cnTitlePrompt = titleStylePrompt("cn_short_drama", { platform: "抖音短剧" });
assert.match(cnTitlePrompt, /3-10 个中文字/, "Chinese short-drama titles must stay concise enough to read as titles");
assert.match(cnTitlePrompt, /不要写成主谓宾完整剧情句/, "Chinese short-drama title prompts must reject plot-sentence titles");
assert.match(cnTitlePrompt, /核心意象型、人物或关系型、地点或机构型、命运悬念型/, "Chinese short-drama titles must use distinct title-oriented naming genes");
assert.match(app, /fieldLabel\(key\)/, "nested structured fields must use the display label map");
assert.match(styles, /\.app-shell \{ height: 100vh; height: 100dvh;[\s\S]*overflow: hidden; \}/, "desktop shell must stay within the viewport");
assert.match(styles, /\.stage-content \{ width: min\(1180px,/, "wide screens must use the central workspace");
assert.match(styles, /\.inspiration-pool \{[\s\S]*height: 360px;/, "inspiration pool must not push the workflow down");
assert.match(app, /function renderReviewPanel\(reviewContent = \{\}, \{ passed/, "review output must expose a complete issue panel");
assert.match(app, /review-zone-optional[\s\S]*可选优化/, "low-risk recommendations must be presented in the optional zone");
assert.match(app, /未返回 · 技术未完成[\s\S]*scoreLabel = entry\.status === "failed" \? "—"/, "failed seats must show technical incompletion and a dash score");
assert.match(app, /一键修订并复审/, "review output must offer one canonical revision action");
assert.match(app, /revisionPlan/, "automatic revision must pass a scoped revision plan");
assert.match(app, /const maxPasses = 2/, "automatic revision must cap the number of passes");
assert.match(app, /currentIssues = remainingIssues/, "automatic revision must rebuild the plan from the latest review");
assert.match(app, /return \{ detached: true \}/, "automatic revision must stop when the run continues in the background");
assert.match(app, /outcome\?\.detached \|\| state\.lastError/, "automatic revision must not submit a second pass for a detached run");
assert.match(app, /async function runAutoRevision[\s\S]*const payload = await request\(""\)/, "revision clicks must refresh the server session before selecting a source artifact");
assert.match(app, /action\.kind === "auto-revise"[\s\S]*等待执行修订/, "the right rail must distinguish a pending revision from waiting for input");
assert.match(app, /reviewContent\.revision\?\.closure\?\.items/, "revision output must expose unresolved closure items");
assert.match(app, /data-advisory-decision/, "advisory feedback must expose creator decision actions");
assert.match(app, /const reviewConflictGuidance =/, "score conflicts must have deterministic review guidance");
assert.match(app, /审核建议[\s\S]*核对指引[\s\S]*决策规则/, "advisory cards must explain what to check and how to decide");
assert.match(app, /guidance\.title/, "advisory cards must display the dimension-specific guidance title");
assert.match(app, /data-advisory-requires-reason/, "conflict decisions must expose their required rationale state");
assert.match(styles, /\.review-advisory-guidance \{/, "advisory guidance must have a distinct readable panel");
assert.match(agent, /mergeRevisionContent\(stage, primary\.content, revisionBase\?\.content\)/, "revision output must preserve omitted stage fields from the source artifact");
assert.match(styles, /\.review-issue-list \{[\s\S]*max-height: 420px;/, "review issues must stay readable in a bounded panel");
assert.match(styles, /\.dna-field \{[\s\S]*height: 420px;[\s\S]*overflow: auto;/, "Story DNA must reserve a stable scrollable tag field");
assert.match(styles, /\.dna-tag-layer \{[\s\S]*display: grid;[\s\S]*grid-template-columns: repeat\(auto-fill, minmax\(118px, 1fr\)\);/, "Story DNA labels must fill the field in a responsive grid");
assert.match(styles, /\.dna-tag \{[\s\S]*position: relative;[\s\S]*max-width: none;[\s\S]*transform: none;/, "Story DNA labels must remain readable grid items rather than orbiting markers");
assert.doesNotMatch(styles, /\.dna-field canvas|\.dna-core|dna-core-orbit/, "Story DNA styles must not retain the retired central visual treatment");
assert.match(styles, /@keyframes dna-launcher-drift/, "Story DNA launcher must have visible motion");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.dna-launcher-orb/, "Story DNA must respect reduced-motion preferences");
assert.match(agent, /只返回最多 3 个会阻断下一阶段的问题/, "review prompts must stay concise and stage-scoped");
assert.match(agent, /revisionClosureProtocol/, "review prompts must require closure evidence for every revision item");
assert.match(agent, /BRIEF_SPEC_MATCH/, "brief review must use stable stage-specific criterion ids");
assert.match(agent, /const creativeControls = payload\.creativeControls \|\| normalizeCreativeControls\(state\.input\);[\s\S]*dialogue_mode: creativeControls\.dialogueMode/, "formal screenplay export must receive scoped creative controls");
assert.match(app, /async function fetchVisualAssetDocument\(\)[\s\S]*agentApiPath\("\/visual-assets\/download"\)[\s\S]*agentRequestHeaders/, "visual asset downloads must carry the PixelTale session header");
assert.match(app, /data-download-visual-assets[\s\S]*runDocumentAction\(downloadVisualAssetDocument\)/, "visual asset downloads must use the authenticated Blob download flow");
assert.doesNotMatch(app, /href="\$\{agentApiPath\("\/visual-assets\/download"\)\}"/, "visual asset downloads must not use an unauthenticated anchor");
assert.match(agent, /function revisionIssueKeys\(stage, item = \{\}\)/, "revision items must have stable cross-round identities");
assert.match(agent, /previousItems = asArray\(review\.revision\?\.contract\?\.items\)/, "revision contracts must inspect the prior contract before merging new findings");
assert.match(agent, /不得要求人物表、分集表、场景表或对白等尚未到达阶段的产物/, "a reviewer must not demand deliverables from later stages");

const wrappedReview = validateReview({ review: {
  pass: true,
  score: 92,
  findings: [],
  required_changes: [],
  issues: [],
  dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 92, feedback: "通过" }])),
  checks: { cross_validation: true, consistency: true, adversarial: true },
} }, { requireDimensions: true });
assert.equal(wrappedReview.pass, true, "common review/result wrapper objects must normalize to the canonical review schema");

const aggregated = aggregateCrossReview([
  {
    result: {
      provider: "chatgpt",
      model: "review-a",
      content: {
        pass: false,
        score: 60,
        findings: ["人物动机不足"],
        required_changes: ["补足主角行动动机"],
        issues: [{ tag: "人物动机不足", dimension: "plot", severity: "high", feedback: "主角没有明确选择原因", fix: "补出触发事件与代价" }],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 60, feedback: "需修订" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
  {
    result: {
      provider: "claude",
      model: "review-b",
      content: {
        pass: false,
        score: 62,
        findings: ["节奏偏弱"],
        required_changes: ["强化第一幕节奏"],
        issues: [
          { tag: "人物动机不足", dimension: "plot", severity: "high", feedback: "目标与阻碍没有形成因果", fix: "明确主角的即时目标" },
          { tag: "节奏偏弱", dimension: "structure", severity: "medium", feedback: "开头缺少可感知冲突", fix: "在前 3 秒加入异常事件" },
        ],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 62, feedback: "需修订" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
  {
    result: {
      provider: "deepseek",
      model: "review-c",
      content: {
        pass: false,
        score: 64,
        findings: [],
        required_changes: [],
        issues: [],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 64, feedback: "需修订" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
]);
assert.ok(aggregated.issueCount >= 2, "consensus must include independent and shared issues");
assert.equal(aggregated.commonIssueCount, 1, "shared issue count must remain available");
assert.ok(aggregated.independentIssueCount >= 1, "independent issue count must remain available");
assert.equal(aggregated.reviewIssues[0].suggestions.length, 2, "all suggestions for a shared issue must be retained");
assert.equal(aggregated.pass, false, "any unresolved issue must keep the artifact behind the review gate");
assert.ok(aggregated.independentIssues.some((item) => item.tag === "审核模型补充意见" && item.models.includes("review-a")), "unstructured reviewer changes must retain their source model");
assert.ok(!aggregated.required_changes.some((item) => item.includes("节奏偏弱")), "a single-model opinion must remain advisory until independently confirmed");
assert.ok(aggregated.required_changes.some((item) => item.includes("人物动机不足")), "two-model agreement must become a mandatory change");
assert.equal(aggregated.mandatoryIssueCount, 1, "only high-severity two-model issues must block confirmation");

const advisoryOnly = aggregateCrossReview([
  {
    result: {
      provider: "chatgpt",
      model: "review-a",
      content: {
        pass: true,
        score: 92,
        findings: [],
        required_changes: [],
        issues: [],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 92, feedback: "通过" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
  {
    result: {
      provider: "claude",
      model: "review-b",
      content: {
        pass: false,
        score: 68,
        findings: ["可以进一步强化开场"],
        required_changes: ["考虑提前异常事件"],
        issues: [{ criterionId: "BRIEF_OPENING_PROMISE", tag: "开场力度", dimension: "structure", severity: "medium", feedback: "开场较平", fix: "考虑提前异常事件" }],
        dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 68, feedback: "有优化空间" }])),
        checks: { cross_validation: true, consistency: true, adversarial: true },
      },
    },
  },
  { route: "deepseek-v4-pro", model: "deepseek-v4-pro", error: "upstream timeout" },
]);
assert.equal(advisoryOnly.pass, false, "an incomplete third review must block stage release even when the first two disagree only on an advisory");
assert.equal(advisoryOnly.required_changes.length, 0, "advisory-only feedback must not create a mandatory revision contract");
assert.equal(advisoryOnly.independentIssueCount, 1, "the independent opinion must remain visible to the user");

const contract = buildRevisionContract(aggregated, { stage: "brief", sourceArtifactId: "artifact_v1", id: "revision_test" });
const inheritedContract = buildRevisionContract({
  commonIssues: [],
  reviewIssues: [{ tag: "单模型建议", modelCount: 1, suggestions: ["不应形成强制修订"] }],
  required_changes: ["单模型建议不得直接变成修订合同"],
  revision: {
    contract: {
      items: [{ id: "brief-R01", tag: "开场冲击", dimension: "structure", severity: "high", modelCount: 2, requiredEdit: ["补足首个冲击"], evidence: ["开头没有立即改变局面"] }],
    },
    closure: {
      items: [{ id: "brief-R01", status: "unresolved", remainingFix: ["补足首个冲击并明确代价"] }],
    },
  },
}, { stage: "brief", sourceArtifactId: "artifact_v2", id: "revision_test_2" });
assert.equal(inheritedContract.items.length, 1, "an unresolved prior revision item must be carried into the next revision contract");
assert.deepEqual(inheritedContract.items[0].requiredEdit, ["补足首个冲击", "补足首个冲击并明确代价"], "inherited contract must retain both the original edit and the latest remaining fix");
const stableContract = buildRevisionContract({
  mandatoryIssues: [{ criterionId: "BRIEF_OPENING_PROMISE", tag: "开场冲击", dimension: "structure", severity: "high", modelCount: 2, suggestions: ["补足开场冲击"] }],
  commonIssues: [{ criterionId: "BRIEF_OPENING_PROMISE", tag: "开场冲击", dimension: "structure", severity: "high", modelCount: 2, suggestions: ["补足开场冲击"] }],
}, { stage: "brief", sourceArtifactId: "artifact_stable_v1", id: "revision_stable_1" });
const stableNextContract = buildRevisionContract({
  mandatoryIssues: [{ criterionId: "BRIEF_OPENING_PROMISE", tag: "开场冲击", dimension: "structure", severity: "high", modelCount: 2, suggestions: ["明确冲击后的代价"] }],
  commonIssues: [{ criterionId: "BRIEF_OPENING_PROMISE", tag: "开场冲击", dimension: "structure", severity: "high", modelCount: 2, suggestions: ["明确冲击后的代价"] }],
  revision: {
    contract: { items: stableContract.items },
    closure: { items: stableContract.items.map((item) => ({ id: item.id, status: "partial", remainingFix: ["明确冲击后的代价"] })) },
  },
}, { stage: "brief", sourceArtifactId: "artifact_stable_v2", id: "revision_stable_2" });
assert.equal(stableNextContract.items.length, 1, "the same issue must not grow into two contract items after revision");
assert.equal(stableNextContract.items[0].id, stableContract.items[0].id, "the same issue must retain its contract ID across revision rounds");
const resolvedThenNewContract = buildRevisionContract({
  mandatoryIssues: [{ criterionId: "BRIEF_VIEWER_QUESTION", tag: "追更问题", dimension: "plot", severity: "high", modelCount: 2, suggestions: ["补足追更问题"] }],
  commonIssues: [{ criterionId: "BRIEF_VIEWER_QUESTION", tag: "追更问题", dimension: "plot", severity: "high", modelCount: 2, suggestions: ["补足追更问题"] }],
  revision: {
    contract: { items: stableContract.items },
    closure: { items: stableContract.items.map((item) => ({ id: item.id, status: "resolved", remainingFix: [] })) },
  },
}, { stage: "brief", sourceArtifactId: "artifact_stable_v3", id: "revision_stable_3" });
assert.deepEqual(resolvedThenNewContract.items.map((item) => item.tag), ["追更问题"], "resolved prior issues must not return when a genuinely new issue appears");
const advisoryContract = buildRevisionContract({
  commonIssues: [],
  reviewIssues: [{ tag: "单模型建议", modelCount: 1, suggestions: ["只供参考"] }],
  required_changes: ["单模型建议只供参考"],
}, { stage: "brief", sourceArtifactId: "artifact_v3", id: "revision_test_3" });
assert.equal(advisoryContract.items.length, 0, "single-model advice must never create a mandatory revision contract");
const acceptedAdvisoryContract = buildRevisionContract({
  commonIssues: [],
  reviewIssues: [],
  independentIssues: [{ id: "advisory_issue_character_motivation", tag: "人物动机不足", dimension: "plot", severity: "high", modelCount: 1, models: ["review-a"], suggestions: ["补足触发事件与代价"], evidence: ["主角没有明确选择原因"] }],
  advisoryDecisions: [{ id: "advisory_issue_character_motivation", status: "accepted", reason: "采纳，必须补出选择代价" }],
}, { stage: "characters", sourceArtifactId: "artifact_v5", id: "revision_test_5" });
assert.equal(acceptedAdvisoryContract.items.length, 1, "a creator-accepted advisory must become a revision contract item");
assert.equal(acceptedAdvisoryContract.items[0].modelCount, 1, "accepted advisory must retain its original model count");

const sourceCharacters = {
  characters: [{ id: "C001", name_zh: "Alex", desire_zh: "查明真相" }],
  relationships: [{ from: "C001", to: "C002", dynamic_zh: "互相利用" }],
  world_rules: ["所有记忆证据必须有可追溯来源"],
};
const partialCharacters = mergeRevisionContent("characters", { characters: [{ id: "C001", name_zh: "Alex", desire_zh: "复仇" }] }, sourceCharacters);
assert.deepEqual(partialCharacters.relationships, sourceCharacters.relationships, "partial character revisions must preserve relationships");
assert.deepEqual(partialCharacters.world_rules, sourceCharacters.world_rules, "partial character revisions must preserve world rules");
assert.doesNotThrow(() => validateContent("characters", partialCharacters), "merged character revisions must satisfy the stage schema");
const sourceArc = {
  unit: "episode_or_chapter",
  units: [{
    number: 1,
    title_zh: "开场",
    promise_zh: "主角必须在追捕逼近前拿到关键证据",
    plot_zh: "主角在封锁前抢到关键记录，选择相信证人并改变逃亡路线。",
    impact_zh: "警报突然响起，主角被列为嫌疑人。",
    causal_turn_zh: "记录时间证明案件在案发前已被篡改。",
    reversal_zh: "证据指向主角自己的身份记录。",
    hook_zh: "监控出现另一个与主角一模一样的人。",
    cliffhanger_question_zh: "监控中的另一个人是谁？",
    payoff_zh: "主角从逃亡转为追查。",
  }],
  arc_summary_zh: "原始分集总纲",
};
const partialArc = mergeRevisionContent("arc", { units: [{ number: 1, title_zh: "修订后的开场" }] }, sourceArc);
assert.equal(partialArc.arc_summary_zh, sourceArc.arc_summary_zh, "partial arc revisions must preserve arc_summary_zh");
assert.doesNotThrow(() => validateContent("arc", partialArc, { episodeCount: 1 }), "merged arc revisions must satisfy the stage schema");
const emptyCharacters = mergeRevisionContent("characters", { characters: sourceCharacters.characters, relationships: [], world_rules: [] }, sourceCharacters);
assert.deepEqual(emptyCharacters.relationships, sourceCharacters.relationships, "empty relationship revisions must preserve the source relationship contract");
assert.deepEqual(emptyCharacters.world_rules, sourceCharacters.world_rules, "empty world-rule revisions must preserve the source world contract");
const sourceScenes = {
  scenes: [
    { id: "S001", location_zh: "公寓", action_zh: "原始动作", props: [{ id: "PR01", name_zh: "警徽", appearance: "旧外观" }], shot_plan: [{ shot_id: "SH001", description_zh: "原始镜头" }, { shot_id: "SH002", description_zh: "第二镜头" }] },
    { id: "S002", location_zh: "医院", action_zh: "第二场原始动作", props: [{ id: "PR02", name_zh: "分诊单" }], shot_plan: [{ shot_id: "SH003", description_zh: "第三镜头" }] },
  ],
};
const partialScenes = mergeRevisionContent("scenes", {
  scenes: [{ id: "S001", action_zh: "修订后的动作", props: [{ id: "PR01", appearance: "修订后的外观" }], shot_plan: [{ shot_id: "SH001", description_zh: "修订后的镜头" }] }],
}, sourceScenes);
assert.equal(partialScenes.scenes.length, 2, "scene revisions must preserve omitted source scenes");
assert.equal(partialScenes.scenes[0].action_zh, "修订后的动作", "scene revisions must apply the changed scene field");
assert.equal(partialScenes.scenes[0].props[0].appearance, "修订后的外观", "scene revisions must apply the changed prop field");
assert.equal(partialScenes.scenes[0].props[0].name_zh, "警徽", "scene revisions must preserve omitted prop fields");
assert.equal(partialScenes.scenes[0].shot_plan.length, 2, "scene revisions must preserve omitted shots");
assert.equal(partialScenes.scenes[1].shot_plan[0].description_zh, "第三镜头", "scene revisions must preserve omitted scene content");

const advisoryGate = reviewAdvisoryGate({
  independentIssues: [{ id: "advisory_issue_high", tag: "高影响逻辑问题", dimension: "logic", severity: "high" }],
  conflicts: [{ id: "advisory_conflict_structure", dimension: "structure", agreement: 50 }],
});
assert.equal(advisoryGate.blockingPending.length, 0, "an undecided score disagreement is auto-adjudicated and must never block confirmation");
const explicitHumanGate = reviewAdvisoryGate({
  conflicts: [{ id: "advisory_conflict_logic", dimension: "logic", agreement: 40 }],
  advisoryDecisions: [{ id: "advisory_conflict_logic", status: "needs_human_review" }],
});
assert.equal(explicitHumanGate.blockingPending.length, 1, "a conflict blocks only when the creator explicitly asks to review it, which is user intent rather than automatic gating");
const duplicateLegacyAdvisories = reviewAdvisoryGate({
  independentIssues: [
    { tag: "审核修订项", severity: "medium" },
    { tag: "审核修订项", severity: "medium" },
  ],
  advisoryDecisions: [{ id: "advisory_issue_审核修订项", status: "accepted" }],
});
assert.deepEqual(duplicateLegacyAdvisories.items.map((item) => item.id), ["advisory_issue_审核修订项", "advisory_issue_审核修订项_2"], "legacy advisory IDs must remain stable while duplicate generated IDs become unique");
assert.equal(duplicateLegacyAdvisories.accepted.length, 1, "a legacy decision must apply only to the first duplicate advisory");
const recommendationOnly = aggregateCrossReview([
  { result: { provider: "chatgpt", model: "review-a", content: { pass: true, score: 82, findings: [], required_changes: [], issues: [{ tag: "节奏优化", dimension: "structure", severity: "medium", feedback: "可进一步压缩", fix: "压缩中段重复信息" }], dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 82, feedback: "可优化" }])), checks: { adversarial: true } } } },
  { result: { provider: "deepseek", model: "review-b", content: { pass: true, score: 80, findings: [], required_changes: [], issues: [{ tag: "节奏优化", dimension: "structure", severity: "medium", feedback: "中段略松", fix: "压缩重复信息" }], dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 80, feedback: "可优化" }])), checks: { adversarial: true } } } },
  { result: { provider: "claude", model: "review-c", content: { pass: true, score: 81, findings: [], required_changes: [], issues: [], dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 81, feedback: "可优化" }])), checks: { adversarial: true } } } },
]);
assert.equal(recommendationOnly.pass, true, "medium-severity consensus recommendations must not block confirmation");
assert.equal(recommendationOnly.mandatoryIssueCount, 0, "recommendation-only review must have no mandatory blockers");
assert.equal(recommendationOnly.recommendedIssueCount, 1, "recommendation-only review must retain the recommendation count");
const staleConsensusContract = buildRevisionContract({
  commonIssues: [{ tag: "旧单模型问题", modelCount: 1, severity: "high", suggestions: ["不得执行"] }],
  reviewIssues: [{ tag: "真实共识问题", modelCount: 2, severity: "high", suggestions: ["按两个模型的共同证据修订"] }],
}, { stage: "brief", sourceArtifactId: "artifact_v4", id: "revision_test_4" });
assert.deepEqual(staleConsensusContract.items.map((item) => item.tag), ["真实共识问题"], "legacy commonIssues must still obey the two-model quorum");
const mediumConsensusContract = buildRevisionContract({
  commonIssues: [{ tag: "节奏优化", modelCount: 2, severity: "medium", suggestions: ["压缩重复信息"] }],
  reviewIssues: [{ tag: "节奏优化", modelCount: 2, severity: "medium", suggestions: ["压缩重复信息"] }],
}, { stage: "brief", sourceArtifactId: "artifact_v6", id: "revision_test_6" });
assert.equal(mediumConsensusContract.items.length, 0, "medium consensus recommendations must not enter the mandatory revision contract");
const resolvedReview = (model) => ({
  result: {
    provider: "chatgpt",
    model,
    content: {
      pass: true,
      score: 92,
      findings: [],
      required_changes: [],
      issues: [],
      revisionClosures: contract.items.map((item) => ({ issueId: item.id, status: "resolved", evidence: "修订内容满足验收条件", remainingFix: "" })),
      dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 92, feedback: "通过" }])),
      checks: { cross_validation: true, consistency: true, adversarial: true },
    },
  },
});
const closed = aggregateCrossReview([resolvedReview("review-a"), resolvedReview("review-b"), resolvedReview("review-c")], contract);
assert.equal(closed.pass, true, "a revised artifact must pass only after every contract item is closed");
assert.equal(closed.revision.closure.allResolved, true, "closure evidence must be retained for the approved revision");

const quorumPass = aggregateCrossReview([
  resolvedReview("review-a"),
  resolvedReview("review-b"),
  { route: "deepseek-v4-pro", model: "deepseek-v4-pro", error: "upstream timeout" },
]);
assert.equal(quorumPass.pass, false, "two agreeing reviewers must not release a stage while the third review seat is unavailable");
assert.deepEqual(quorumPass.quorum, { required: 3, completedSeats: 2, completed: 2, passing: 2, distinctActualModels: 2, met: false, degraded: false }, "the canonical review result must expose the three-seat completion gate");

const reviewCase = ({ model, seatId, ownedDimensions = [], score = 90, pass = true, issues = [], confidence = 90, dimensions: dimensionValues } = {}) => ({
  route: { seatId, role: seatId === "seat_c" ? "audience_pacing_visual" : "structure_causality", requiredModel: model, model, ownedDimensions },
  result: {
    provider: model.startsWith("claude") ? "claude" : model.startsWith("grok") ? "grok" : "chatgpt",
    model,
    actualModel: model,
    content: {
      pass,
      score,
      confidence,
      findings: [],
      required_changes: [],
      issues,
      dimensions: dimensionValues || Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score, feedback: "通过" }])),
      checks: { cross_validation: true, consistency: true, adversarial: true },
    },
  },
});
const allReviewsFailed = aggregateCrossReview([
  reviewCase({ model: "review-a", seatId: "seat_a", pass: false }),
  reviewCase({ model: "review-b", seatId: "seat_b", pass: false }),
  reviewCase({ model: "review-c", seatId: "seat_c", pass: false }),
]);
assert.equal(allReviewsFailed.quorum.passing, 0, "the quorum must report zero passing reviews");
assert.equal(allReviewsFailed.checks.reviews_passed, false, "all review seats must pass before release");
assert.equal(allReviewsFailed.pass, false, "three completed but failed reviews must block release");
// 共识降级：三席全部完成（quorumMet 仍严格），但 2/3 多数通过即可放行；
// 分歧席不阻断，记录到 disagreements 供追溯/导出标注。
const majorityRelease = aggregateCrossReview([
  reviewCase({ model: "review-a", seatId: "seat_a" }),
  reviewCase({ model: "review-b", seatId: "seat_b" }),
  reviewCase({ model: "review-c", seatId: "seat_c", pass: false, issues: [{ criterionId: "C", tag: "单席分歧", severity: "medium" }] }),
]);
assert.equal(majorityRelease.pass, true, "2-of-3 majority must release when the third seat dissents");
assert.equal(majorityRelease.checks.majority_consensus, true, "majority consensus check must be true");
assert.equal(majorityRelease.checks.reviews_passed, true, "reviews_passed must reflect the majority");
assert.equal(majorityRelease.disagreements.length, 1, "the dissenting seat must be recorded for traceability");
assert.equal(majorityRelease.disagreements[0].seatId, "seat_c", "the disagreement must name the dissenting seat");
const twoCompletedOneAbsent = aggregateCrossReview([
  reviewCase({ model: "review-a", seatId: "seat_a" }),
  reviewCase({ model: "review-b", seatId: "seat_b" }),
]);
assert.equal(twoCompletedOneAbsent.pass, false, "two seats alone must not release: quorumMet still requires three completed seats");
const failedSeat = aggregateCrossReview([
  reviewCase({ model: "gpt-5.6-terra", seatId: "seat_a" }),
  { route: { seatId: "seat_b", role: "character_continuity", requiredModel: "claude-opus-5", model: "claude-opus-5" }, model: "claude-opus-5", error: "upstream timeout", errorCode: "TIMEOUT" },
]);
assert.equal(failedSeat.feedbacks.find((item) => item.status === "failed").score, null, "failed seats must use a null score");
assert.equal(failedSeat.feedbacks.find((item) => item.status === "failed").failureReason, "timeout", "failed seats must preserve the real failure reason");
assert.equal(failedSeat.quality, 90, "failed seats must not enter the quality average");
assert.equal(failedSeat.dimensions.structure.average, 90, "failed seats must not enter dimension averages");
const realZero = aggregateCrossReview([reviewCase({ model: "gpt-5.6-terra", seatId: "seat_a", score: 0 })]);
assert.equal(realZero.feedbacks[0].score, 0, "a valid zero score must be preserved");
assert.equal(realZero.feedbacks[0].status, "completed", "a valid zero score must remain completed");
const degradedQuorum = aggregateCrossReview([
  reviewCase({ model: "gpt-5.6-terra", seatId: "seat_a" }),
  { ...reviewCase({ model: "grok-4.5", seatId: "seat_b" }), result: { ...reviewCase({ model: "grok-4.5", seatId: "seat_b" }).result, fallbackUsed: true } },
  { ...reviewCase({ model: "grok-4.5", seatId: "seat_c", ownedDimensions: ["design"] }), result: { ...reviewCase({ model: "grok-4.5", seatId: "seat_c", ownedDimensions: ["design"] }).result, fallbackUsed: true } },
]);
assert.equal(degradedQuorum.quorum.degraded, true, "same-model fallback must mark quorum as degraded");
assert.equal(degradedQuorum.quorum.met, false, "degraded quorum must not be met");
assert.equal(degradedQuorum.pass, false, "degraded quorum must block release");
const autoAdjudicated = aggregateCrossReview([
  reviewCase({ model: "gpt-5.6-terra", seatId: "seat_a", score: 100 }),
  reviewCase({ model: "claude-opus-5", seatId: "seat_b", score: 50 }),
  reviewCase({ model: "claude-haiku-4-5", seatId: "seat_c", score: 90, ownedDimensions: ["design"] }),
]);
assert.equal(autoAdjudicated.pass, true, "score disagreement must not block a complete review quorum");
assert.equal(autoAdjudicated.adjudications[0].adjudication.mode, "automatic", "score disagreements must produce automatic adjudications");
assert.equal(autoAdjudicated.adjudications[0].adjudication.status, "resolved", "automatic adjudications must be recorded as resolved");
const missingDimension = aggregateCrossReview([reviewCase({ model: "gpt-5.6-terra", seatId: "seat_a", dimensions: { structure: { score: 90, feedback: "通过" } } }), reviewCase({ model: "claude-opus-5", seatId: "seat_b", score: 80 })]);
assert.equal(missingDimension.dimensions.structure.average, 85, "missing dimensions must not be treated as zero");
const designIssue = { tag: "镜头不可拍", dimension: "design", severity: "high", feedback: "机位无法执行", fix: "补足可拍机位" };
const cDesignIssue = aggregateCrossReview([reviewCase({ model: "claude-haiku-4-5", seatId: "seat_c", ownedDimensions: ["design"], confidence: 80, issues: [designIssue] })]);
assert.equal(cDesignIssue.mandatoryIssueCount, 1, "the design owner may raise a single high-confidence mandatory issue");
const aDesignIssue = aggregateCrossReview([reviewCase({ model: "gpt-5.6-terra", seatId: "seat_a", ownedDimensions: ["structure", "logic"], confidence: 100, issues: [designIssue] })]);
assert.equal(aDesignIssue.mandatoryIssueCount, 0, "a non-owner single-seat design issue must remain advisory");

const mandatoryIssueCases = [
  { issue: { tag: "两席高风险", dimension: "plot", severity: "high", modelCount: 2 }, expected: true, label: "high + two seats" },
  { issue: { tag: "主人高置信", dimension: "plot", severity: "high", modelCount: 1, ownerHighConfidence: true }, expected: true, label: "high + owner + high confidence" },
  { issue: { tag: "非主人单席", dimension: "plot", severity: "high", modelCount: 1 }, expected: false, label: "high + non-owner single seat" },
  { issue: { tag: "中风险共识", dimension: "plot", severity: "medium", modelCount: 2 }, expected: false, label: "medium + two seats" },
];
mandatoryIssueCases.forEach(({ issue, expected, label }) => {
  assert.equal(isMandatoryReviewIssue(issue), expected, `shared mandatory predicate: ${label}`);
  const reviews = issue.modelCount >= 2
    ? [
      reviewCase({ model: "review-a", seatId: "seat_a", issues: [issue] }),
      reviewCase({ model: "review-b", seatId: "seat_b", issues: [issue] }),
    ]
    : [reviewCase({
      model: "review-a",
      seatId: expected ? "seat_c" : "seat_a",
      ownedDimensions: expected ? [issue.dimension] : [],
      issues: [issue],
    })];
  const aggregate = aggregateCrossReview(reviews);
  assert.equal(aggregate.mandatoryIssues.some((item) => item.tag === issue.tag), expected, `aggregate must share mandatory predicate: ${label}`);
});

const ownerSingleSeatReview = {
  mandatoryIssues: [{ tag: "维度主人单席修订", dimension: "plot", severity: "high", modelCount: 1, ownerHighConfidence: true, suggestions: ["补足因果代价"] }],
  commonIssues: [],
};
const ownerSingleSeatContract = buildRevisionContract(ownerSingleSeatReview, { stage: "characters", sourceArtifactId: "artifact_owner_single", id: "revision_owner_single" });
assert.equal(ownerSingleSeatContract.items.length, 1, "owner high-confidence single-seat mandatory issue must enter the revision contract");
assert.equal(ownerSingleSeatContract.items[0].tag, ownerSingleSeatReview.mandatoryIssues[0].tag, "contract item must retain the mandatory issue tag");
const mediumContract = buildRevisionContract({
  reviewIssues: [{ tag: "中风险共识", dimension: "plot", severity: "medium", modelCount: 2, suggestions: ["可选优化"] }],
}, { stage: "brief", sourceArtifactId: "artifact_medium", id: "revision_medium" });
assert.equal(mediumContract.items.length, 0, "medium-severity consensus issues must not enter the revision contract");
const nonOwnerContract = buildRevisionContract({
  reviewIssues: [{ tag: "非主人单席高风险", dimension: "plot", severity: "high", modelCount: 1, suggestions: ["不得强制修订"] }],
}, { stage: "brief", sourceArtifactId: "artifact_non_owner", id: "revision_non_owner" });
assert.equal(nonOwnerContract.items.length, 0, "non-owner single-seat high issues must not enter the revision contract");
const historicalMandatoryContract = buildRevisionContract({
  reviewIssues: [
    { tag: "历史两席高风险", dimension: "plot", severity: "high", modelCount: 2, suggestions: ["补足共同证据"] },
    { tag: "历史中风险共识", dimension: "plot", severity: "medium", modelCount: 2, suggestions: ["仅供参考"] },
    { tag: "历史主人单席", dimension: "plot", severity: "high", modelCount: 1, ownerHighConfidence: true, suggestions: ["补足主人判断"] },
  ],
}, { stage: "brief", sourceArtifactId: "artifact_historical", id: "revision_historical" });
assert.deepEqual(historicalMandatoryContract.items.map((item) => item.tag), ["历史两席高风险", "历史主人单席"], "historical reviews must use the shared mandatory predicate");

const batchConflictReview = batchReviewSummary("arc", [{
  pass: false,
  basePass: true,
  score: 86,
  consensusIndex: 80,
  agreement: 72,
  quality: 86,
  reviewCompletion: 100,
  quorum: { required: 3, completed: 3, passing: 3, met: true },
  conflicts: [{ id: "advisory_conflict_logic", dimension: "logic", agreement: 60, scores: [92, 61, 74], suggestion: "按证据裁决因果链取舍" }],
  checks: { consistency: true, adversarial: true, issues_converged: true, revision_contract_closed: true },
}], 1, { 1: { status: "locked" } });
assert.equal(batchConflictReview.basePass, true, "a complete batch with no hard issue must retain its release base pass");
assert.equal(batchConflictReview.pass, true, "a low-agreement conflict must be auto-adjudicated without blocking release");
const ignoredBatchConflict = reviewAdvisoryGate({ ...batchConflictReview, advisoryDecisions: [{ id: "advisory_conflict_logic", status: "ignored", reason: "保留已确认因果链，证据支持当前版本" }] });
assert.equal(batchConflictReview.basePass && !ignoredBatchConflict.blockingPending.length && !ignoredBatchConflict.accepted.length, true, "ignoring a documented conflict must allow the existing batch base pass to release");
const noQuorum = aggregateCrossReview([
  resolvedReview("review-a"),
  { route: "claude-opus-5", model: "claude-opus-5", error: "upstream timeout" },
  { route: "deepseek-v4-pro", model: "deepseek-v4-pro", error: "upstream timeout" },
]);
assert.equal(noQuorum.pass, false, "one reviewer can never release a stage");

const reviewRoutesForScheduling = [{ model: "review-a" }, { model: "review-b" }, { model: "review-c" }];
const reviewPayload = (model, score) => ({
  route: { model },
  result: {
    provider: "test",
    model,
    content: {
      pass: true,
      score,
      findings: [],
      required_changes: [],
      issues: [],
      dimensions: Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score, feedback: "通过" }])),
      checks: { cross_validation: true, consistency: true, adversarial: true },
    },
  },
});
const alignedReviewStarts = [];
await collectCrossReviewQuorum({
  reviewRoutes: reviewRoutesForScheduling,
  execute: async (route) => {
    alignedReviewStarts.push(route.model);
    return reviewPayload(route.model, 92);
  },
});
assert.deepEqual(alignedReviewStarts, ["review-a", "review-b", "review-c"], "all three review seats must start even when the first two agree");
const conflictedReviewStarts = [];
await collectCrossReviewQuorum({
  reviewRoutes: reviewRoutesForScheduling,
  execute: async (route) => {
    conflictedReviewStarts.push(route.model);
    return reviewPayload(route.model, route.model === "review-a" ? 96 : route.model === "review-b" ? 40 : 82);
  },
});
assert.deepEqual(conflictedReviewStarts, ["review-a", "review-b", "review-c"], "all three review seats must remain available for cross-validation");

const partial = resolvedReview("review-c");
partial.result.content.revisionClosures[0].status = "partial";
partial.result.content.revisionClosures[0].remainingFix = "补出主角的明确选择";
const majorityClosed = aggregateCrossReview([resolvedReview("review-a"), resolvedReview("review-b"), partial], contract);
assert.equal(majorityClosed.pass, true, "two resolved votes must close a revision despite one dissenting reviewer");
assert.equal(majorityClosed.revision.closure.items[0].status, "resolved", "the two-model closure consensus must be retained");
const unresolved = resolvedReview("review-b");
unresolved.result.content.revisionClosures[0].status = "unresolved";
unresolved.result.content.revisionClosures[0].remainingFix = "仍缺少明确选择";
const notClosed = aggregateCrossReview([resolvedReview("review-a"), partial, unresolved], contract);
assert.equal(notClosed.pass, false, "fewer than two resolved votes must keep the revision behind the review gate");
assert.equal(notClosed.revision.closure.items[0].status, "partial", "an unconfirmed closure must remain visible");

const stateStore = new Map();
let uuidSequence = 0;
const dimensions = Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: 90, feedback: "通过" }]));
const reviewOutput = (revisionProtocol) => ({
  pass: !!revisionProtocol,
  score: revisionProtocol ? 90 : 58,
  findings: revisionProtocol ? [] : ["主角行动动机不足"],
  required_changes: revisionProtocol ? [] : ["补足主角立刻行动的触发事件与代价"],
  issues: revisionProtocol ? [] : [{ tag: "人物动机不足", dimension: "plot", severity: "high", feedback: "主角没有行动触发", fix: "补足触发事件与代价" }],
  revision_closures: revisionProtocol ? revisionProtocol.items.map((item) => ({ issue_id: item.id, status: "resolved", evidence: "修订稿已给出触发事件与代价", remaining_fix: "" })) : [],
  dimensions,
  checks: { cross_validation: true, consistency: true, adversarial: true },
});
const fakeFetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  const system = request.messages[0].content;
  const user = JSON.parse(request.messages[1].content);
  const output = /交叉审核 Agent/.test(system)
    ? reviewOutput(user.revisionClosureProtocol)
    : { title_zh: "暗门", logline_zh: "主角必须在代价逼近前打开一扇暗门。", core_conflict_zh: "真相与生存冲突。", viewer_question_zh: "她会付出什么代价？" };
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }) };
};
const testModels = [
  { id: "gpt-5.6-terra", provider: "chatgpt", configured: true },
  { id: "claude-opus-5", provider: "claude", configured: true },
  { id: "deepseek-v4-pro", provider: "deepseek", configured: true },
];
const titleSets = [
  ["The Last Tenant", "Room Zero", "Borrowed Silence", "On Hold"],
  ["The Hollow Key", "Northbound", "Glass Witness", "After the Signal"],
  ["Night Index", "Dead Air", "The Counterfeit Room", "Last Exit"],
];
const titleOutput = (index = 0) => ({
  candidates: titleSets[Math.min(index, titleSets.length - 1)].map((title, candidateIndex) => ({
    title_en: title,
    explanation_zh: `中文释义 ${candidateIndex + 1}`,
    style_zh: "国际流媒体",
    tone_zh: "克制而有悬念",
    naming_gene_zh: ["人物身份或关系", "地点或机构", "异常物件或意象", "双重含义极简短语"][candidateIndex],
    reason_zh: "承接主角进入禁区的故事 DNA，并适配英语市场封面传播。",
  })),
  selection_note_zh: "优先选择与核心异常意象绑定最紧的片名。",
});
assert.throws(
  () => validateContent("title", { ...titleOutput(), candidates: titleOutput().candidates.map((candidate, index) => index === 0 ? { ...candidate, title_en: "暗门" } : candidate) }, { mode: "tk_short_drama" }),
  (error) => error.code === "SCHEMA_INVALID",
  "Chinese formal titles must be rejected before persistence",
);
assert.throws(
  () => validateContent("title", { ...titleOutput(), candidates: titleOutput().candidates.map((candidate, index) => index === 0 ? { ...candidate, title_en: "Billionaire Revenge" } : candidate) }, { mode: "tk_short_drama" }),
  (error) => error.code === "SCHEMA_INVALID",
  "generic web-fiction title templates must be rejected before persistence",
);
const cnTitleOutput = {
  ...titleOutput(),
  candidates: ["龙鸣城", "城下龙鸣", "群龙未醒", "末日回声"].map((title, index) => ({
    ...titleOutput().candidates[index],
    title_en: title,
    naming_gene_zh: ["核心意象型", "地点或机构型", "命运悬念型", "人物或关系型"][index],
  })),
};
assert.doesNotThrow(
  () => validateContent("title", cnTitleOutput, { mode: "cn_short_drama" }),
  "concise Chinese title phrases must remain valid",
);
assert.throws(
  () => validateContent("title", { ...cnTitleOutput, candidates: cnTitleOutput.candidates.map((candidate, index) => index === 0 ? { ...candidate, title_en: "听懂龙鸣后我逆转末日" } : candidate) }, { mode: "cn_short_drama" }),
  (error) => error.code === "SCHEMA_INVALID",
  "Chinese plot-sentence titles must be rejected before persistence",
);
stateStore.set("cn-title-legacy", {
  projectId: "cn-title-legacy",
  stage: "title",
  mode: "cn_short_drama",
  input: {},
  artifacts: [
    { id: "cn-title-brief", type: "pixeltale_brief", stage: "brief", version: 1, status: "approved", content: { title_zh: "测试", logline_zh: "测试", core_conflict_zh: "测试", viewer_question_zh: "测试" } },
    { id: "cn-title-legacy-artifact", type: "pixeltale_title", stage: "title", version: 1, status: "ready", content: { ...cnTitleOutput, candidates: cnTitleOutput.candidates.map((candidate, index) => index === 0 ? { ...candidate, title_en: "听懂龙鸣后我逆转末日" } : candidate) } },
  ],
  approvedArtifactIds: ["cn-title-brief"],
});
const routedCalls = [];
let reviewModelSelections = 0;
let generatedTitleSets = 0;
const testRouter = {
  models: () => testModels,
  status: () => Object.fromEntries(["chatgpt", "claude", "deepseek"].map((provider) => [provider, { provider, configured: true }])),
  stageModels: (route) => [route.primary, route.reviewer, route.consistency],
  reviewModels: () => {
    reviewModelSelections += 1;
    return testModels.map(({ id: model, provider }) => ({ model, provider, configured: true }));
  },
  call: async ({ model, system, user, purpose, temperature }) => {
    const input = JSON.parse(user);
    routedCalls.push({ model, purpose, system, input, temperature });
    const output = /交叉审核 Agent/.test(system)
      ? reviewOutput(input.revisionClosureProtocol)
      : input.currentStage === "title"
        ? titleOutput(generatedTitleSets++)
        : input.currentStage === "scenes"
          ? {
            scenes: [{
              id: "S001",
              unit_number: 1,
              purpose_zh: "修订后的场景目的",
              time_zh: "夜",
              location_zh: "公寓",
              characters: ["C001"],
              action_zh: "主角作出选择并触发即时威胁。",
              conflict_zh: "追捕者逼近，证据会暴露主角身份。",
              choice_zh: "主角带走原件并放弃安全路线。",
              result_zh: "逃生路线被锁定，但主角拿到了关键证据。",
              turn_zh: "主角从逃亡转为追查篡改者。",
              visual_intent_zh: "紧迫",
              recurring: false,
              visual_profile: { aliases: "公寓", indoor_outdoor: "室内", lighting: "冷光", palette: "蓝灰", materials: "水泥", layout: "单间", atmosphere: "压迫", prompt_zh: "冷光公寓" },
              props: [{ id: "PR01", name_zh: "警徽", description_zh: "旧警徽", recurring: true, materials: "金属", appearance: "磨损", size: "掌心", texture: "划痕", prompt_zh: "磨损警徽" }],
              shot_plan: [{ shot_id: "SH001", type: "hook", duration_seconds: 4, description_zh: "警报突然响起", dialogue_refs: [] }],
            }],
          }
        : { title_zh: "暗门", logline_zh: "主角必须在代价逼近前打开一扇暗门。", core_conflict_zh: "真相与生存冲突。", viewer_question_zh: "她会付出什么代价？" };
    return { provider: testModels.find((item) => item.id === model)?.provider || "superpixel", model, content: output, attempts: 0, trace: [{ model }] };
  },
};
const runAgent = createPixelTaleAgent({
  modelRouter: testRouter,
  readPixelTaleState: (stateRoot) => stateStore.get(stateRoot) || {},
  writePixelTaleState: (stateRoot, state) => stateStore.set(stateRoot, state),
  randomUUID: () => `${String(++uuidSequence).padStart(12, "0")}-1234-1234-1234-123456789abc`,
  onPhase: (_params, phase) => phaseEvents.push(phase),
});
assert.throws(
  () => runAgent.approve({ pixelTaleRoot: "cn-title-legacy", projectId: "cn-title-legacy", artifactId: "cn-title-legacy-artifact", selectedTitle: "听懂龙鸣后我逆转末日" }),
  (error) => error.code === "TITLE_REGENERATION_REQUIRED",
  "legacy plot-sentence title candidates must require regeneration before approval",
);
stateStore.set("advisory-e2e", {
  projectId: "advisory-e2e",
  stage: "brief",
  artifacts: [
    { id: "artifact_advisory", type: "pixeltale_brief", stage: "brief", version: 1, status: "ready", reviewId: "review_advisory", content: { title_zh: "测试", logline_zh: "测试", core_conflict_zh: "测试", viewer_question_zh: "测试" } },
    { id: "review_advisory", type: "pixeltale_stage_review", stage: "brief", version: 1, status: "passed", content: { pass: true, independentIssues: [{ id: "advisory_issue_high", tag: "高影响逻辑问题", dimension: "logic", severity: "high", modelCount: 1, models: ["review-a"], suggestions: ["补足因果"], evidence: ["行动缺少触发"] }], conflicts: [], advisoryDecisions: [] } },
  ],
  approvedArtifactIds: [],
});
const advisoryDecisionResult = runAgent.decideAdvisory({ pixelTaleRoot: "advisory-e2e", projectId: "advisory-e2e", reviewId: "review_advisory", advisoryId: "advisory_issue_high", status: "accepted" });
assert.equal(advisoryDecisionResult.review.content.advisoryDecisions[0].status, "accepted", "creator advisory decisions must persist on the review artifact");
assert.equal(advisoryDecisionResult.state.artifacts.find((artifact) => artifact.id === "artifact_advisory").status, "needs_review", "accepting an advisory must reopen its source artifact for revision");
assert.throws(
  () => runAgent.approve({ pixelTaleRoot: "advisory-e2e", projectId: "advisory-e2e", artifactId: "artifact_advisory" }),
  (error) => error.code === "ADVISORY_REVISION_REQUIRED",
  "an accepted advisory must prevent direct artifact approval",
);
stateStore.set("advisory-priority-e2e", {
  projectId: "advisory-priority-e2e",
  stage: "brief",
  artifacts: [
    { id: "artifact_priority", type: "pixeltale_brief", stage: "brief", version: 1, status: "ready", reviewId: "review_priority", content: { title_zh: "测试", logline_zh: "测试", core_conflict_zh: "测试", viewer_question_zh: "测试" } },
    { id: "review_priority", type: "pixeltale_stage_review", stage: "brief", version: 1, status: "passed", content: {
      pass: true,
      independentIssues: [{ id: "advisory_priority_accepted", tag: "已采纳修订", severity: "medium" }],
      conflicts: [{ id: "advisory_priority_pending", dimension: "logic", agreement: 40 }],
      advisoryDecisions: [
        { id: "advisory_priority_accepted", status: "accepted" },
        { id: "advisory_priority_pending", status: "needs_human_review" },
      ],
    } },
  ],
  approvedArtifactIds: [],
});
assert.throws(
  () => runAgent.approve({ pixelTaleRoot: "advisory-priority-e2e", projectId: "advisory-priority-e2e", artifactId: "artifact_priority" }),
  (error) => error.code === "ADVISORY_DECISION_REQUIRED",
  "an explicit human-review decision must take priority over an accepted advisory",
);
// 人工放行：needs_review 产物默认拒绝（ARTIFACT_NOT_READY），humanOverride=true
// 时跳过审核闸、强制锁定未锁定集并确认，打破"修订不收敛无出口"死循环。
stateStore.set("human-override-e2e", {
  projectId: "human-override-e2e",
  stage: "arc",
  artifacts: [
    { id: "a_brief", type: "pixeltale_brief", stage: "brief", version: 1, status: "ready", content: {} },
    { id: "a_title", type: "pixeltale_title", stage: "title", version: 1, status: "ready", content: {} },
    { id: "a_proposal", type: "pixeltale_proposal", stage: "proposal", version: 1, status: "ready", content: {} },
    { id: "a_characters", type: "pixeltale_characters", stage: "characters", version: 1, status: "ready", content: {} },
    { id: "artifact_hr", type: "pixeltale_arc", stage: "arc", version: 1, status: "needs_review", reviewId: "review_hr", content: { units: [{ number: 1, title_zh: "第一集", plot_zh: "剧情推进", hook_zh: "集尾钩子" }, { number: 2, title_zh: "第二集", plot_zh: "剧情推进", hook_zh: "集尾钩子" }], arc_summary_zh: "整体推进" } },
    { id: "review_hr", type: "pixeltale_stage_review", stage: "arc", version: 1, status: "failed", content: { pass: false, score: 42 } },
  ],
  approvedArtifactIds: ["a_brief", "a_title", "a_proposal", "a_characters"],
  input: { idea: "测试", episodeCount: 2 },
  unitLocks: { arc: {} },
});
const humanParams = { pixelTaleRoot: "human-override-e2e", projectId: "human-override-e2e" };
assert.throws(
  () => runAgent.approve({ ...humanParams, artifactId: "artifact_hr" }),
  (error) => error.code === "ARTIFACT_NOT_READY",
  "needs_review without humanOverride must still be rejected",
);
const humanOverrideResult = runAgent.approve({ ...humanParams, artifactId: "artifact_hr", humanOverride: true });
const humanArtifact = humanOverrideResult.state.artifacts.find((item) => item.id === "artifact_hr");
assert.equal(humanArtifact.status, "approved", "human override must approve the needs_review artifact");
assert.ok(humanArtifact.humanOverride, "human override must record the override marker");
assert.equal(Object.keys(humanOverrideResult.state.unitLocks.arc).length, 2, "human override must force-lock the unlocked units");
assert.equal(humanOverrideResult.state.stage, "scenes", "approving arc advances to the next stage");
const runParams = { pixelTaleRoot: "revision-e2e", projectId: "revision-e2e", project: { id: "revision-e2e", title: "Revision E2E", episode: "DRAFT" }, stage: "brief", input: { idea: "主角为救家人闯入禁区" } };
const phaseEvents = [];
phaseEvents.length = 0;
const initialRun = await runAgent.run(runParams);
assert.deepEqual(phaseEvents, ["authoring", "synthesizing", "reviewing"], "a stage run must report its three explicit phases in order");
assert.equal(initialRun.status, "needs_review", "initial review must retain a failed source version");
assert.ok(routedCalls.filter((item) => item.purpose.endsWith(":review")).every((item) => item.temperature === 0.2), "every review seat must use stable temperature 0.2");
const revisionRun = await runAgent.run({ ...runParams, revisionPlan: "按全部审核问题修订" });
assert.equal(revisionRun.status, "completed", `revision must run as a distinct, reviewable version: ${JSON.stringify(revisionRun.errors)}`);
assert.equal(revisionRun.revision.allResolved, true, "the run record must prove all revision contract items were closed");
const finalReview = revisionRun.state.artifacts.find((artifact) => artifact.id === revisionRun.artifacts[1].id);
assert.equal(finalReview.content.revision.closure.allResolved, true, "the persisted review must retain item-by-item closure evidence");

const ruleGateState = new Map();
const ruleGateCalls = [];
let ruleGateReviewSelections = 0;
const ruleGateRouter = {
  models: () => testModels,
  status: () => ({}),
  stageModels: () => testModels.map((item) => item.id),
  reviewModels: () => { ruleGateReviewSelections += 1; return testModels.map(({ id: model, provider }) => ({ model, provider, configured: true })); },
  call: async ({ model, purpose }) => {
    ruleGateCalls.push({ model, purpose });
    return {
      provider: testModels.find((item) => item.id === model)?.provider || "chatgpt",
      model,
      content: {
        characters: [{ id: "C001", name_en: "李明", role: "protagonist", desire_zh: "查明真相" }],
        relationships: [{ from: "C001", to: "C001", dynamic_zh: "自我对抗" }],
        world_rules: ["真相必须付出代价"],
      },
      attempts: 0,
    };
  },
};
const ruleGateAgent = createPixelTaleAgent({
  modelRouter: ruleGateRouter,
  readPixelTaleState: (stateRoot) => ruleGateState.get(stateRoot) || {},
  writePixelTaleState: (stateRoot, state) => ruleGateState.set(stateRoot, state),
  randomUUID: () => `${String(++uuidSequence).padStart(12, "0")}-1234-1234-1234-123456789abc`,
});
const ruleGateParams = { pixelTaleRoot: "rule-gate", projectId: "rule-gate", stage: "characters", mode: "tk_short_drama", input: { idea: "测试", marketCountry: "united_states" } };
const ruleGatePrerequisites = ["brief", "title", "proposal"].map((stage) => ({ id: `rule-gate-${stage}`, type: `pixeltale_${stage}`, stage, version: 1, status: "approved", content: {} }));
ruleGateState.set("rule-gate", { projectId: "rule-gate", stage: "characters", input: ruleGateParams.input, artifacts: ruleGatePrerequisites, approvedArtifactIds: ruleGatePrerequisites.map((item) => item.id) });
const ruleGateRun = await ruleGateAgent.run(ruleGateParams);
const ruleGateReview = ruleGateRun.artifacts.find((artifact) => artifact.type === "pixeltale_stage_review");
assert.equal(ruleGateReview?.content.ruleFindings[0]?.code, "NAME_LOCALIZATION", `a high deterministic rule must be returned as a rule finding: ${JSON.stringify(ruleGateRun)}`);
assert.equal(ruleGateReviewSelections, 0, "a high rule violation must skip review model selection and calls");
assert.equal(ruleGateCalls.filter((item) => item.purpose.endsWith(":review")).length, 0, "a high rule violation must consume zero review model calls");

const sceneRevisionState = {
  projectId: "scene-revision-e2e",
  stage: "scenes",
  mode: "tk_short_drama",
  input: { idea: "主角为救家人闯入禁区", coreConflict: "真相与生存冲突", episodeCount: 1 },
  artifacts: ["brief", "title", "proposal", "characters", "arc"].map((stage) => ({
    id: `scene-approved-${stage}`,
    type: `pixeltale_${stage}`,
    stage,
    version: 1,
    status: "ready",
    content: { title_zh: "场景修订测试上下文" },
  })),
  approvedArtifactIds: ["scene-approved-brief", "scene-approved-title", "scene-approved-proposal", "scene-approved-characters", "scene-approved-arc"],
};
stateStore.set("scene-revision-e2e", sceneRevisionState);
const sceneParams = {
  pixelTaleRoot: "scene-revision-e2e",
  projectId: "scene-revision-e2e",
  project: { id: "scene-revision-e2e", title: "Scene Revision E2E", episode: "DRAFT" },
  stage: "scenes",
  mode: "tk_short_drama",
  input: sceneRevisionState.input,
};
const initialSceneRun = await runAgent.run(sceneParams);
assert.equal(initialSceneRun.status, "completed", "scene review failures must recover inside the same user-triggered run");
assert.equal(initialSceneRun.artifacts[0].version, 2, "automatic scene recovery must create a repaired version in the same run");

runAgent.approve({ ...runParams, artifactId: revisionRun.artifacts[0].id });
const staleState = stateStore.get("revision-e2e");
staleState.stage = "brief";
stateStore.set("revision-e2e", staleState);
routedCalls.length = 0;
reviewModelSelections = 0;
const titleParams = { ...runParams, stage: "title", mode: "tk_short_drama", input: { ...runParams.input, platform: "TikTok / TikTok Series", marketCountry: "united_states", audienceGender: "all" } };
const titleRun = await runAgent.run(titleParams);
assert.equal(titleRun.status, "completed", "title generation must complete without waiting for cross-review");
assert.equal(titleRun.state.stage, "title", "a run must keep the requested editor stage even when the stored session stage is stale");
assert.equal(routedCalls.length, 1, "title generation must call exactly one assigned author model");
assert.equal(routedCalls[0].model, "gpt-5.6-terra", "title generation must use the configured orchestration model");
assert.equal(routedCalls[0].purpose, "pixeltale:title:author", "title generation must remain an author-only request");
assert.equal(reviewModelSelections, 0, "title generation must never select cross-review models");
assert.deepEqual(titleRun.reviewModels, [], "title run record must expose zero reviewers");
assert.deepEqual(titleRun.route, { primary: "gpt-5.6-terra" }, "title route must contain only the assigned author model");
assert.equal(titleRun.artifacts.length, 1, "title run must persist only the primary artifact");
assert.equal(titleRun.artifacts[0].status, "ready", "a valid title artifact must be ready for human selection");
assert.equal(titleRun.artifacts[0].reviewId, "", "title artifact must not reference a review artifact");
assert.equal(titleRun.artifacts[0].content.candidates.length, 4, "title contract must retain exactly four options");
assert.ok(titleRun.artifacts[0].content.candidates.every((candidate) => /^[^\u3400-\u9fff]*[A-Za-z][^\u3400-\u9fff]*$/u.test(candidate.title_en)), "all formal titles must be English and contain no Chinese characters");
assert.match(routedCalls[0].system, /剧本 DNA[\s\S]*目标受众和发行场景/, "title prompt must bind naming to story DNA and distribution attributes");
assert.deepEqual(routedCalls[0].input.excludedTitles, [], "the first title run must not invent an exclusion history");

routedCalls.length = 0;
const regeneratedTitleRun = await runAgent.run(titleParams);
assert.equal(regeneratedTitleRun.artifacts[0].version, 2, "regeneration must create a new title artifact version");
assert.equal(routedCalls.length, 1, "regeneration must still call only one model");
assert.deepEqual(routedCalls[0].input.excludedTitles.sort(), titleSets[0].slice().sort(), "regeneration must ask the model to avoid every previous candidate");
assert.equal(new Set(regeneratedTitleRun.artifacts[0].content.candidates.map((candidate) => candidate.title_en).filter((title) => titleSets[0].includes(title))).size, 0, "controlled regeneration must increase the available title choices");

runAgent.approve({ ...titleParams, artifactId: regeneratedTitleRun.artifacts[0].id, selectedTitle: titleSets[1][0] });
const rerunAfterTitleApproval = await runAgent.run({ ...titleParams, override: true });
assert.equal(rerunAfterTitleApproval.artifacts[0].version, 3, "a rerun after approval must create a new title version");
assert.doesNotThrow(() => runAgent.approve({ ...titleParams, artifactId: rerunAfterTitleApproval.artifacts[0].id, selectedTitle: titleSets[2][0] }), "the latest rerun must remain the stage that requires confirmation");

let gptCalls = 0;
const councilTemperatures = [];
const councilRun = await callStageCouncil({
  route: { primary: "gpt-5.6-terra", reviewer: "claude-opus-5", consistency: "deepseek-v4-pro" },
  system: "stage generation",
  user: "{}",
  modelRouter: {
    stageModels: (route) => [route.primary, route.reviewer, route.consistency],
    fallbackModelFor: (model) => model === "gpt-5.6-terra" ? "grok-4.5" : "",
    call: async ({ model, purpose, temperature }) => {
      councilTemperatures.push({ model, purpose, temperature });
      if (model === "gpt-5.6-terra") {
        gptCalls += 1;
        if (gptCalls === 1) {
          const error = new Error("upstream connection reset");
          error.code = "NETWORK_ERROR";
          error.retryable = true;
          throw error;
        }
      }
      return { provider: model.startsWith("gpt-") ? "chatgpt" : model.startsWith("claude-") ? "claude" : model.startsWith("deepseek-") ? "deepseek" : "grok", model, content: { ok: true, purpose }, attempts: 0, trace: [{ model }] };
    },
  },
});
assert.equal(councilRun.creativeCouncil.requiredModels, 3, "a stage must require all three author models");
assert.equal(councilRun.creativeCouncil.completedModels, 3, "a stage may merge only after all three authors complete");
assert.deepEqual(councilRun.creativeCouncil.contributors.map((item) => item.model), ["gpt-5.6-terra", "claude-opus-5", "deepseek-v4-pro"]);
assert.equal(councilRun.creativeCouncil.synthesizer.requiredModel, "gpt-5.6-terra", "the configured primary model is the explicit synthesizer, not a silent winner");
assert.equal(councilRun.creativeCouncil.contributors[0].actualModel, "grok-4.5", "a failed author seat must recover through its same-seat Grok fallback");
assert.deepEqual(councilTemperatures.filter((item) => item.purpose.endsWith(":author")).map((item) => item.temperature), [0.3, 0.7, 1.0, 0.3], "creative seats must use differentiated temperatures, including same-seat retry");
assert.equal(councilTemperatures.find((item) => item.purpose.endsWith(":synthesis"))?.temperature, 0.35, "the synthesis call must use its dedicated temperature");

const timedCalls = [];
let timedClock = 0;
await assert.rejects(
  () => callStageCouncil({
    route: { primary: "gpt-5.6-terra", reviewer: "claude-opus-5", consistency: "deepseek-v4-pro" },
    system: "stage generation",
    user: "{}",
    totalTimeoutMs: 15_000,
    perModelTimeoutMs: 14_000,
    nowMs: () => timedClock,
    modelRouter: {
      stageModels: (route) => [route.primary, route.reviewer, route.consistency, "gpt-5.6-sol"],
      fallbackModelFor: () => "grok-4.5",
      call: async ({ model, timeoutMs }) => {
        timedCalls.push({ model, timeoutMs });
        const error = new Error("upstream request timed out");
        error.code = "TIMEOUT";
        error.retryable = true;
        throw error;
      },
    },
  }),
  (error) => error.code === "STAGE_CREATIVE_COUNCIL_INCOMPLETE" && error.fallbackFailures.length === 6 && error.creativeCouncil.completedModels === 0,
  "the stage must fail when any author remains unavailable after its own retry",
);
assert.equal(timedCalls.length, 6, "each author role gets one bounded retry while the three roles remain concurrent");
assert.equal(new Set(timedCalls.map((item) => item.model)).size, 4, "the author fallback may share Grok while retaining three independent seat identities");
assert.ok(timedCalls.every((item) => item.timeoutMs === 14_000), "each concurrent author candidate must receive its full bounded timeout");
assert.deepEqual(timedCalls.map((item) => item.model), ["gpt-5.6-terra", "claude-opus-5", "deepseek-v4-pro", "grok-4.5", "grok-4.5", "grok-4.5"], "retries must use the same role's Grok fallback");
// Sized from measured seat latency on the real prompts, not guessed: the slowest
// seat (claude-opus-5) needed 208s for the characters payload, so a 210s model
// window left no headroom and a 240s total left the fallback round only 30s.
assert.match(agent, /characters: \{ total: 600_000, model: 270_000 \}/, "characters and world generation needs a model window above the measured slowest seat");
assert.match(agent, /arc: \{ total: 660_000, model: 300_000 \}/, "long-form arc generation needs a bounded long-stage window with room for one retry");
// A review seat reads the entire artifact before answering, so this budget tracks
// artifact size. Measured: a 13.9 kB characters artifact took gpt-5.6-terra 44s and
// pushed claude-opus-5 past the old 120s cap, which then starved its fallback too.
assert.match(agent, /const REVIEW_MODEL_TIMEOUT_MS = 240_000/, "review calls must cover the slowest seat on the largest artifacts");
assert.match(agent, /modelRouter\.stageModels\(route\)\.slice\(0, 3\)/, "the creative council must stay within the configured writing roster");
assert.match(agent, /const settled = await Promise\.allSettled/, "all author roles must be launched concurrently and settled together");
assert.doesNotMatch(agent, /Promise\.any\(attempts\)/, "a first-success race must never release a stage");
assert.match(agent, /三模型创作未齐备，当前阶段不能进入合并和审核/, "missing author contributions must block synthesis and review");
assert.match(agent, /creativeCouncil/, "stage artifacts must preserve contribution provenance");
assert.match(agent, /collectCrossReviewQuorum/, "review execution must have an explicit quorum collector");
assert.doesNotMatch(agent, /\.\.\.providers, \.\.\.providers|flatMap\(\(provider\) => \[provider, provider\]\)/, "a stage must never repeat the same three-model sweep");
assert.match(agent, /brief: 1_800/, "brief generation must not request the universal 12k output budget");
assert.match(agent, /REVIEW_QUORUM = 2/, "two independent completed reviews must form quorum");
assert.match(agent, /REVIEW_COMPLETION_REQUIRED = 3/, "all three review seats must complete before release");
assert.match(agent, /basePass/, "review release eligibility must remain distinct from dimension-conflict arbitration");
assert.match(agent, /batchReviewSummary/, "episode batch review must retain a release base pass for human conflict decisions");
assert.match(app, /releaseReady/, "the consensus meter must expose the actual release state");
assert.match(app, /completedSeats \?\? quorum\.completed/, "the review UI must read the three-seat completion count from quorum");
assert.doesNotMatch(app, /至少两个模型完成独立审核/, "the UI must not claim that two reviewers can release a stage");
assert.match(app, /async function waitForRunJob/, "long PixelTale runs must be polled instead of held inside one proxy request");
assert.match(app, /accepted\.job\?\.jobId/, "the stage runner must poll the exact accepted job");
assert.match(app, /const RUN_BACKGROUND_TIMEOUT_MS = 6 \* 60 \* 60 \* 1_000/, "long runs must continue in the background after the foreground window");
assert.match(app, /return \{ status: "detached", jobId \}/, "foreground polling must detach instead of converting a running job into a failure");
assert.match(app, /function monitorBackgroundRun\(/, "detached PixelTale jobs must keep a background monitor");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
assert.match(serverSource, /function startPixelTaleRun\(/, "the server must execute PixelTale stages as background jobs");
assert.match(serverSource, /activePixelTaleRuns/, "the server must deduplicate concurrent runs for the same stage");
assert.match(serverSource, /max_tokens: maxTokens/, "the PixelTale API router must honor the stage output budget");
assert.match(serverSource, /fallbackModels/, "a review role must have a same-provider model fallback without changing its identity");
assert.match(fs.readFileSync(path.join(root, "server/pixeltale-api.js"), "utf8"), /function stageModels\(route = \{\}\)/, "the independent PixelTale API must retain the configured three-role chain");

// The fallback round must have room to regenerate the whole stage payload. Authors
// run concurrently, so round 1 burns ~`model` ms of the shared `total`; if
// `total - model` is smaller than `model`, the retry can never finish and
// STAGE_PRIMARY_RETRY_ROUNDS is decorative. Production hit exactly this: every big
// stage left the fallback only 30s, so a slow seat killed the stage outright.
const stageTimings = [...agent.matchAll(/^\s*(brief|title|proposal|characters|arc|scenes|dialogue): \{ total: ([\d_]+), model: ([\d_]+) \}/gm)]
  .map(([, stage, total, model]) => ({ stage, total: Number(total.replace(/_/g, "")), model: Number(model.replace(/_/g, "")) }));
assert.equal(stageTimings.length, 7, "every production stage must declare a primary timing budget");
for (const { stage, total, model } of stageTimings) {
  assert.ok(total >= model * 2, `${stage}: total (${total}) must leave the fallback round a full model budget (${model} x2)`);
  // Budgets may exceed the 4-minute foreground poll: waitForRunJob returns
  // { status: "detached" } and monitorBackgroundRun takes over for up to 6 hours.
  // They must still stay far inside that window so an interrupted run stays
  // recoverable rather than orphaned.
  assert.ok(total <= 900_000, `${stage}: primary budget (${total}) must stay bounded inside the background monitor window`);
}

// The characters stage asked every seat for 7 full character cards including a
// 10-field visual_profile in one call. Measured result: gpt-5.6-terra and
// claude-haiku-4-5 both returned INVALID_JSON and claude-opus-5 exceeded 270s, so
// the all-or-nothing council gate failed 17 consecutive runs with zero artifacts.
// The heavy visual fields belong to the visual-assets stage, which regenerates
// them anyway. Keep the characters payload light.
const apiSource = fs.readFileSync(path.join(root, "server/pixeltale-api.js"), "utf8");
const charactersContract = agent.match(/characters: `\{"characters".*?`,/s)?.[0] || "";
assert.ok(charactersContract, "the characters stage must declare an output contract");
for (const heavy of ["prompt_zh", "facial_features", "costume_accessories", "eye_color", "posture", '"body"']) {
  assert.ok(!charactersContract.includes(heavy), `characters output contract must not request ${heavy}; it belongs to the visual-assets stage`);
}
for (const kept of ["gender", "age_phase", "hair_color", "palette"]) {
  assert.ok(charactersContract.includes(kept), `characters output contract must keep ${kept} for scene continuity`);
}
assert.match(agent, /characters: 4_000/, "the characters token budget must match its trimmed payload");

// The scenes stage had the same redundancy, one layer worse: every scene carried an
// 8-field visual_profile and 9-field props entries that the visual-assets stage
// regenerates from scratch. At full payload claude-opus-5 timed out at 300s and
// deepseek-v4-pro returned invalid JSON at 256s; after the trim deepseek completed
// the same batch in 166s. Keep the shot plan, drop the look.
const scenesContract = agent.match(/scenes: `\{"scenes".*?`,/s)?.[0] || "";
assert.ok(scenesContract, "the scenes stage must declare an output contract");
for (const heavy of ["materials", "appearance", "texture", "atmosphere", "layout", "aliases", "prompt_zh"]) {
  assert.ok(!scenesContract.includes(heavy), `scenes output contract must not request ${heavy}; the visual-assets stage regenerates it`);
}
for (const kept of ["shot_plan", "shot_id", "duration_seconds", "dialogue_refs", "unit_number", "indoor_outdoor", "lighting", "palette"]) {
  assert.ok(scenesContract.includes(kept), `scenes output contract must keep ${kept}`);
}

// A model that stops at max_tokens produces truncated JSON. Retrying with the same
// budget just truncates again, so it must not be reported as a retryable parse error.
assert.match(apiSource, /finish_reason/, "the API layer must read finish_reason");
assert.match(apiSource, /code = "TRUNCATED_OUTPUT"[\s\S]*retryable = false/, "a max_tokens truncation must be a distinct non-retryable failure");
// ...but non-retryable must not mean non-recoverable. canFallbackFrom answers "may
// we try a DIFFERENT model", and omitting TRUNCATED_OUTPUT there killed a review
// seat outright on one truncation, dropping the stage below quorum in production.
assert.match(agent, /function canFallbackFrom[\s\S]{0,400}"TRUNCATED_OUTPUT"/, "a truncated output must still allow falling back to another model");
assert.equal(
  (agent.match(/let lastAttempted = reviewModel;/g) || []).length,
  2,
  "both review paths must track the model actually attempted",
);
// The failure record named reviewCandidates.at(-1), so a seat that failed on its
// own model was reported as "grok-4.5: <other model> truncated" with grok never called.
assert.doesNotMatch(agent, /model: reviewCandidates\.at\(-1\)/, "a review failure must name the model that actually failed");
// tokenUsage() reads result.usage, so the call layer has to return it or the
// revision token circuit breaker can never fire.
assert.match(apiSource, /usage: payload\.usage \|\| null/, "model calls must return upstream usage so the token breaker is live");

// Cross-stage referential integrity is decidable in code, so it must never cost a
// review call. A scene that names a character the characters stage never defined,
// or a dialogue line spoken by nobody, is a hard error the review models cannot
// reliably catch because they never see the full ID registry.
const refCtx = {
  artifacts: [
    { stage: "characters", content: { characters: [{ id: "C001" }, { id: "C002" }] } },
    { stage: "scenes", content: { scenes: [{ id: "S001" }] } },
  ],
};
const refClean = runStageRules({ stage: "scenes", artifact: { scenes: [{ id: "S001", characters: ["C001", "C002"] }] }, approvedContext: refCtx });
assert.equal(ruleFindings(refClean, "UNKNOWN_CHARACTER_REF").length, 0, "valid character references must not be flagged");
const refGhost = runStageRules({ stage: "scenes", artifact: { scenes: [{ id: "S001", characters: ["C001", "C999"] }] }, approvedContext: refCtx });
assert.equal(ruleFindings(refGhost, "UNKNOWN_CHARACTER_REF").length, 1, "a scene referencing an undefined character must be a hard violation");
assert.equal(ruleFindings(refGhost, "UNKNOWN_CHARACTER_REF")[0].severity, "high", "a phantom character reference must block before spending review tokens");

// A 90-second episode legitimately breaks into several scenes — the rule must not
// treat a repeated unit_number as a batch mismatch. This was a live regression:
// scenes v22 of a 30-episode project was blocked by this false positive.
const multiSceneCtx = { unitScope: [16, 17, 18, 19, 20] };
const multiSceneArt = { scenes: [16, 17, 18, 19, 20].flatMap((u) => [{ id: `S${u}a`, unit_number: u }, { id: `S${u}b`, unit_number: u }]) };
assert.equal(ruleFindings(runStageRules({ stage: "scenes", artifact: multiSceneArt, approvedContext: multiSceneCtx }), "UNIT_COUNT_MISMATCH").length, 0, "a scene breakdown with multiple scenes per episode must not be flagged as a batch mismatch");
assert.equal(ruleFindings(runStageRules({ stage: "scenes", artifact: { scenes: multiSceneArt.scenes.filter((x) => x.unit_number !== 18) }, approvedContext: multiSceneCtx }), "UNIT_COUNT_MISMATCH").length, 1, "a scenes batch where an expected episode produced no scenes must still be flagged");
assert.equal(ruleFindings(runStageRules({ stage: "arc", artifact: { units: [16, 16, 17, 18, 19, 20].map((n) => ({ number: n })) }, approvedContext: multiSceneCtx }), "UNIT_COUNT_MISMATCH").length, 1, "arc must still reject a duplicate episode number");
const refSpeaker = runStageRules({ stage: "dialogue", artifact: { lines: [{ speaker: "C999", scene_id: "S001" }] }, approvedContext: refCtx });
assert.equal(ruleFindings(refSpeaker, "UNKNOWN_SPEAKER_REF").length, 1, "dialogue spoken by an undefined character must be caught");
const refScene = runStageRules({ stage: "dialogue", artifact: { lines: [{ speaker: "C001", scene_id: "S999" }] }, approvedContext: refCtx });
assert.equal(ruleFindings(refScene, "UNKNOWN_SCENE_REF").length, 1, "dialogue attached to a nonexistent scene must be caught");
// Upstream may legitimately be unapproved; the check must stay silent then rather
// than blocking a stage the creator is allowed to run out of order.
const refNoUpstream = runStageRules({ stage: "scenes", artifact: { scenes: [{ id: "S001", characters: ["C999"] }] }, approvedContext: {} });
assert.equal(ruleFindings(refNoUpstream, "UNKNOWN_CHARACTER_REF").length, 0, "reference checks must skip when the upstream stage is not approved yet");

// The merge step compresses three drafts into one artifact and reviewers only ever
// see the result, so a merge that discarded two drafts is otherwise invisible.
const draft = (seatId, lines) => ({ seatId, role: seatId, result: { content: { items: lines } } });
const balancedMerge = computeMergeAudit(
  [draft("seat_a", ["结构线索必须在第三集回收完毕"]), draft("seat_b", ["人物动机与关系演进要有代价"]), draft("seat_c", ["集尾钩子必须留下行动压力"])],
  { items: ["结构线索必须在第三集回收完毕", "人物动机与关系演进要有代价", "集尾钩子必须留下行动压力"] },
);
assert.equal(balancedMerge.dominatedBy, "", "a merge that absorbed all three drafts must not be flagged as dominated");
const dominatedMerge = computeMergeAudit(
  [draft("seat_a", ["结构线索必须在第三集回收完毕", "因果链条要闭合到主线承诺"]), draft("seat_b", ["人物动机与关系演进要有代价"]), draft("seat_c", ["集尾钩子必须留下行动压力"])],
  { items: ["结构线索必须在第三集回收完毕", "因果链条要闭合到主线承诺"] },
);
assert.equal(dominatedMerge.dominatedBy, "seat_a", "a merge that kept only one draft must name the dominating seat");
assert.ok(dominatedMerge.note.includes("seat_a"), "a dominated merge must explain which seat took over");
// The dominance rule alone missed the worse shape: a merger that discarded all
// three drafts and wrote its own version showed up as "no dominance" on real runs.
const ignoredMerge = computeMergeAudit(
  [draft("seat_a", ["结构线索必须在第三集回收完毕形成闭环"]), draft("seat_b", ["人物动机与关系演进必须付出代价"]), draft("seat_c", ["集尾钩子必须留下明确行动压力"])],
  { items: ["完全无关的另一套自己重写的内容与上述三份都不相同"] },
);
assert.equal(ignoredMerge.ignoredDrafts, true, "a merge that absorbed none of the drafts must be flagged");
assert.ok(ignoredMerge.note.includes("没有采纳"), "an ignored-drafts merge must say the drafts were not absorbed");
assert.equal(balancedMerge.ignoredDrafts, false, "a healthy merge must not be flagged as ignoring the drafts");
assert.match(agent, /mergeAudit: computeMergeAudit\(contributions, synthesisResult\.content\)/, "every stage merge must record a retention audit");

// --- Regression locks for invariants that mutation testing proved were unguarded ---
// Each assertion below was verified to turn RED when its invariant is broken.

// 1. A completed seat with one missing dimension score must not drag the average
//    toward zero. Regression: `Number(score || 0)` counted the gap as a real 0.
const seatDims = (value) => Object.fromEntries(["structure", "plot", "design", "logic"].map((key) => [key, { score: value, feedback: "意见" }]));
const seatReview = (score, overrides = {}) => ({
  route: { seatId: "seat_x", role: "r", ownedDimensions: [], requiredModel: "m" },
  result: { provider: "p", model: "m", actualModel: overrides.actualModel || `m-${score}`, content: { pass: true, score, confidence: 90, findings: [], required_changes: [], checks: { adversarial: true }, dimensions: overrides.dimensions || seatDims(score), issues: [], revisionClosures: [] } },
});
const gapAggregate = aggregateCrossReview([
  seatReview(90, { dimensions: { ...seatDims(90), design: { score: null, feedback: "未返回该维度" } } }),
  seatReview(90),
  seatReview(90),
]);
assert.equal(gapAggregate.dimensions.design.average, 90, "a missing dimension score must be skipped, never averaged in as zero");
assert.deepEqual(gapAggregate.dimensions.design.scores, [90, 90], "only finite dimension scores may enter the average");

// 2. A dimension with fewer than two finite scores cannot be judged for
//    disagreement. Regression: `null < 75` is true in JS, inventing a conflict.
const singleScoreAggregate = aggregateCrossReview([
  seatReview(90, { dimensions: { ...seatDims(90), design: { score: null, feedback: "" } } }),
  seatReview(90, { dimensions: { ...seatDims(90), design: { score: null, feedback: "" } } }),
  seatReview(90, { dimensions: { ...seatDims(90), design: { score: 88, feedback: "唯一有效分" } } }),
]);
assert.equal(singleScoreAggregate.dimensions.design.agreement, null, "agreement must be null when a dimension has fewer than two finite scores");
assert.equal(singleScoreAggregate.conflicts.filter((item) => item.dimension === "design").length, 0, "a null agreement must never be reported as a score disagreement");
assert.equal(singleScoreAggregate.adjudications.filter((item) => item.dimension === "design").length, 0, "a null agreement must never produce a fabricated adjudication record");

// 2b. Batch stages (arc/scenes) read their numbers from batchReviewSummary, so
//     its "no data" value must stay null there too. Regression: falling back to 0
//     reproduces the original "shows 0 when it means not measured" confusion on
//     exactly the two stages that carry most of the work.
const emptyBatchSummary = batchReviewSummary("arc", [{ pass: false, basePass: false, quorum: { required: 3, completedSeats: 0, completed: 0, distinctActualModels: 0, met: false, degraded: false }, dimensions: {}, feedbacks: [] }], 5, {});
assert.equal(emptyBatchSummary.quality, null, "an unmeasured batch quality score must be null, never 0");
assert.equal(emptyBatchSummary.agreement, null, "an unmeasured batch agreement must be null, never 0");
assert.equal(emptyBatchSummary.score, null, "an unmeasured batch score must be null, never 0");

// 2c. A batch that has not run yet has no quorum record. Taking Math.min across
//     every batch let that missing record (`|| 0`) report the whole stage as 0/3
//     seats and flag it degraded — live on a 30-episode scenes stage where all five
//     batches that HAD run were fully staffed with three distinct models.
const seatDraft = (seatId, model, score = 70) => ({
  route: { seatId, role: seatId, ownedDimensions: [], requiredModel: model },
  result: { provider: "p", model, actualModel: model, content: { pass: true, score, confidence: 90, findings: [], required_changes: [], checks: { adversarial: true }, dimensions: seatDims(score), issues: [], revisionClosures: [] } },
});
const healthyBatch = aggregateCrossReview([seatDraft("seat_a", "gpt-5.6-terra"), seatDraft("seat_b", "gpt-5.6-sol"), seatDraft("seat_c", "deepseek-v4-pro")]);
const collapsedBatch = aggregateCrossReview([seatDraft("seat_a", "gpt-5.6-terra"), seatDraft("seat_b", "grok-4.5"), seatDraft("seat_c", "grok-4.5")]);
const withUnrunBatch = batchReviewSummary("scenes", [healthyBatch, healthyBatch, {}], 15, {});
assert.equal(withUnrunBatch.quorum.completedSeats, 3, "a batch that has not run must not drag completedSeats to zero");
assert.equal(withUnrunBatch.quorum.distinctActualModels, 3, "a batch that has not run must not drag distinctActualModels to zero");
assert.equal(withUnrunBatch.quorum.degraded, false, "a stage must not be flagged degraded just because a batch has not run yet");
// A genuinely collapsed batch is still a real finding, and it must say which batch.
const withCollapsedBatch = batchReviewSummary("scenes", [collapsedBatch, healthyBatch, {}], 15, {});
assert.equal(withCollapsedBatch.quorum.degraded, true, "a batch whose seats collapsed onto one model must still be reported");
assert.deepEqual(withCollapsedBatch.quorum.degradedBatches, [1], "a degraded stage must identify which batch collapsed");

// 2d. The degraded message must name the seats that actually collided. It was
//     hardcoded to "B/C", which became wrong the moment seat_a and seat_b started
//     sharing the GPT channel — the pair that collapses follows the failed channel.
const bcNote = collapsedBatch.technicalFailures.find((item) => item.status === "degraded");
assert.match(bcNote.message, /seat_b\/seat_c/, "a degraded message must name the seats that actually collapsed");
assert.match(bcNote.message, /grok-4\.5/, "a degraded message must name the model they collapsed onto");
const gptChannelDown = aggregateCrossReview([seatDraft("seat_a", "grok-4.5"), seatDraft("seat_b", "grok-4.5"), seatDraft("seat_c", "deepseek-v4-pro")]);
const abNote = gptChannelDown.technicalFailures.find((item) => item.status === "degraded");
assert.match(abNote.message, /seat_a\/seat_b/, "when the GPT channel fails the message must say seat_a/seat_b, not a hardcoded pair");
assert.doesNotMatch(agent, /B\/C 席位已兜底至同一模型/, "the degraded message must be derived, not a hardcoded seat pair");
assert.doesNotMatch(app, /B\/C 已兜底至同一模型/, "the frontend must render the backend's degraded message, not a hardcoded seat pair");

// 3. Every seat model must be routable, and a retired model must stay loadable so
//    historical review records keep showing a real model name instead of a blank.
const routableModels = models().map((item) => item.id);
for (const [seatId, model] of ROSTER) {
  assert.ok(routableModels.includes(model), `${seatId}'s model (${model}) must be routable`);
}
// Models the seats replaced remain defined: old artifacts reference them by id and
// would otherwise render as an unnamed model.
for (const retired of ["claude-opus-5", "claude-haiku-4-5"]) {
  assert.ok(MODEL_DEFINITIONS.some((item) => item.id === retired), `${retired} must stay defined so historical reviews keep a real model name`);
}

// 4. Review seats must stay at a reproducible low temperature on every review
//    path. A behavioural assertion above covers the main stage path; this locks
//    the batch path too, which the behavioural test never exercises.
assert.equal((agent.match(/temperature: 0\.2,/g) || []).length, 2, "both review dispatch paths must pin review temperature to 0.2");
assert.doesNotMatch(agent, /purpose: `pixeltale:\$\{stage\}:review`,\n\s*temperature: (?!0\.2)/, "no review call may raise its sampling temperature");

// 5. The frontend advisory gate must not special-case conflicts back into
//    blocking. The rule is duplicated in app.js and pixeltale-agent.js.
const appGateBody = app.slice(app.indexOf("function reviewAdvisoryGate"), app.indexOf("function isMandatoryReviewIssue"));
assert.ok(appGateBody.includes("blockingPending"), "the frontend advisory gate must still compute blockingPending");
assert.doesNotMatch(appGateBody, /kind === "conflict"/, "the frontend gate must not re-introduce a conflict special case that blocks confirmation");
const agentGateBody = agent.slice(agent.indexOf("function reviewAdvisoryGate"), agent.indexOf("const issueSeverityRank"));
assert.doesNotMatch(agentGateBody, /kind === "conflict"/, "the backend gate must not re-introduce a conflict special case that blocks confirmation");

// 6. Voice rules must be localized per mode: cn_short_drama produces Chinese
//    voice rules under the shared voice_rules_en key (dialogue stage reads it),
//    while TK keeps English content.
const cnCharactersContract = stageOutputContract("characters", "cn_short_drama");
assert.match(cnCharactersContract, /中文声线规则/, "cn mode characters contract must ask for Chinese voice rules");
assert.doesNotMatch(cnCharactersContract, /英文声线规则/, "cn mode characters contract must not ask for English voice rules");
const tkCharactersContract = stageOutputContract("characters", "tk_short_drama");
assert.match(tkCharactersContract, /英文声线规则/, "tk mode characters contract keeps English voice rules");

// 7. Human override must be informed: the confirm dialog shows review
//    evidence (score / issue counts / revision state) before releasing.
assert.match(app, /function buildHumanOverrideBrief/, "app.js must expose the human-override evidence builder");
assert.match(app, /审核依据/, "the human-override dialog must present review evidence before confirming");
assert.match(app, /人工放行不会修复问题/, "the human-override dialog must state that it does not fix issues");

// 8. Handoff must not silently export a script missing dialogue for scenes.
const handoffIncompleteState = {
  input: { idea: "测试", episodeCount: 1, storyTitle: "测试剧" },
  mode: "cn_short_drama",
  approvedArtifactIds: ["h_brief", "h_title", "h_proposal", "h_chars", "h_arc", "h_scenes", "h_dialogue"],
  artifacts: [
    { id: "h_brief", type: "pixeltale_brief", stage: "brief", version: 1, status: "approved", content: { title_zh: "测试", logline_zh: "测试", core_conflict_zh: "测试", viewer_question_zh: "测试", episode_promise_zh: "测试" } },
    { id: "h_title", type: "pixeltale_title", stage: "title", version: 1, status: "approved", content: { candidates: [{ title_en: "Test", explanation_zh: "测试" }] } },
    { id: "h_proposal", type: "pixeltale_proposal", stage: "proposal", version: 1, status: "approved", content: { title_zh: "测试", premise_zh: "测试命题", logline_zh: "测试", viewer_question_zh: "测试", protagonist_goal_zh: "测试" } },
    { id: "h_chars", type: "pixeltale_characters", stage: "characters", version: 1, status: "approved", content: { characters: [{ id: "C001", name_zh: "小明", arc_zh: "成长" }], world_rules: [] } },
    { id: "h_arc", type: "pixeltale_arc", stage: "arc", version: 1, status: "approved", content: { units: [{ number: 1, title_zh: "第一集", impact_zh: "暴击", plot_zh: "剧情", hook_zh: "钩子", cliffhanger_question_zh: "悬念" }], arc_summary_zh: "概要" } },
    { id: "h_scenes", type: "pixeltale_scenes", stage: "scenes", version: 1, status: "approved", content: { scenes: [{ id: "S001", unit_number: 1, location_zh: "地点", action_zh: "动作" }], props: [] } },
    // 对白缺 S001：handoff 必须拒绝而非静默出包
    { id: "h_dialogue", type: "pixeltale_dialogue", stage: "dialogue", version: 1, status: "approved", content: { lines: [{ id: "D001", scene_id: "S999", speaker: "C001", intent_zh: "意图", dialogue_en: "台词", subtext_zh: "潜台词" }] } },
  ],
};
assert.throws(
  () => createHandoffPayload({ state: handoffIncompleteState, project: { id: "t", title: "t", episode: "DRAFT" }, now: () => new Date("2026-08-08T00:00:00Z"), randomUUID: () => "uuid-1" }),
  (error) => error.code === "HANDOFF_INCOMPLETE",
  "handoff must reject dialogue that does not cover every scene",
);

// 9. Streaming read must time out even when AbortController cannot interrupt
//    reader.read() — a hung SSE body used to stall authoring for 30+ minutes.
{
  const hungReader = {
    read: () => new Promise(() => { /* 永不返回 */ }),
    cancel: async () => {},
  };
  const hungResponse = { body: { getReader: () => hungReader } };
  await assert.rejects(
    () => readStreamPayload(hungResponse, { timeoutMs: 60 }),
    (error) => error?.code === "STREAM_READ_TIMEOUT",
    "a hung stream must be forced to time out by wall-clock deadline",
  );
}

console.log("pixeltale workflow contract ok");
