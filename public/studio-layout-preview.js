const posters = [
  "/home-videos/posters/work-01.jpg",
  "/home-videos/posters/work-02.jpg",
  "/home-videos/posters/work-03.jpg",
  "/home-videos/posters/work-04.jpg",
  "/home-videos/posters/work-05.jpg",
  "/home-videos/posters/work-06.jpg",
];

const shotSeeds = [
  ["暴雨前的雾港", 4, "暴雨压住海面，港口最后一班货船亮起离岸灯。林夏的车从远处冲入画面。", "无", "大全景", "35mm 广角", "缓慢横移", ["雾港码头", "离岸货船", "林夏的车"]],
  ["旧车冲入港区", 5, "轮胎碾过积水，林夏猛打方向，车身贴着集装箱滑过。", "无", "中景", "50mm 标准定焦", "低位平行跟拍", ["林夏的车", "港区集装箱", "雾港码头"]],
  ["船笛穿透雨声", 4, "货船鸣笛。林夏抬头，意识到留给她的时间只剩几分钟。", "林夏 OS：再晚一步，就真的来不及了。", "面部近景", "85mm 长焦", "固定镜头", ["林夏", "雾港码头", "离岸货船"]],
  ["闸门缓慢落下", 4, "码头闸门开始关闭，红色警示灯在雨中循环闪烁。", "广播：三号泊位即将封闭。", "中远景", "70mm 中长焦", "小幅推进", ["港区闸门", "林夏的车", "雾港码头"]],
  ["弃车翻越闸门", 5, "林夏冲出驾驶室，踩上车头翻过正在闭合的闸门。", "无", "全身中景", "40mm", "手持跟随", ["林夏", "林夏的车", "港区闸门"]],
  ["文件袋贴近胸口", 4, "林夏确认防水文件袋仍在，随后冲向三号泊位。", "林夏 OS：你必须看到它。", "手部特写", "85mm 长焦", "短距离跟移", ["林夏", "防水文件袋", "雾港码头"]],
  ["林夏穿过雨幕", 5, "林夏沿码头奔向即将离岸的货船。她举起文件袋，隔着雨幕寻找陈默。", "林夏：陈默！\n林夏 OS：至少让我把真相交给你。", "单人中近景", "50mm 标准定焦", "侧前方匀速后退", ["林夏", "雾港码头", "防水文件袋"]],
  ["甲板上的回望", 4, "陈默听见呼喊，在甲板人群中停步回头。", "无", "半身近景", "85mm 长焦", "固定后轻推", ["陈默", "离岸货船", "甲板栏杆"]],
  ["文件袋抛向甲板", 5, "林夏踩上系缆桩，将文件袋用尽全力抛向甲板。", "林夏：接住！", "双人中景", "65mm", "快速跟随上摇", ["林夏", "陈默", "防水文件袋"]],
  ["文件滑落边缘", 4, "文件袋撞上栏杆，沿湿润甲板滑向边缘。陈默扑过去抓住提带。", "陈默：林夏！", "物件特写", "100mm 微距", "快速短距跟移", ["陈默", "防水文件袋", "甲板栏杆"]],
  ["隔海无声对望", 7, "船与岸之间的距离继续拉开。两人在雨中无声对望。", "无", "超远景", "120mm 长焦", "固定镜头", ["林夏", "陈默", "离岸货船"]],
  ["雾港吞没船影", 6, "货船进入浓雾，只剩船尾灯在雨夜中闪烁。林夏终于停下。", "林夏 OS：这一次，选择权在你手里。", "大全景", "35mm 广角", "缓慢升高", ["林夏", "离岸货船", "雾港码头"]],
];

const initialStates = ["complete", "complete", "complete", "complete", "complete", "complete", "complete", "complete", "running", "failed", "ready", "ready"];
const failureReasons = {
  9: "内容安全策略拦截：镜头动作与文本描述冲突",
};

const shots = shotSeeds.map((seed, index) => {
  const [title, duration, story, dialogue, size, lens, motion, assets] = seed;
  const state = initialStates[index];
  return {
    number: index + 1,
    title,
    duration,
    story,
    dialogue,
    size,
    lens,
    motion,
    assets,
    state,
    failureReason: failureReasons[index] || "",
    progress: state === "complete" || state === "failed" ? 100 : state === "running" ? 64 : 0,
    image: posters[(index + 3) % posters.length],
    prompt: buildPrompt(index + 1, duration, size, lens, motion, story, dialogue),
    stillTakes: state === "ready" ? 1 : 3,
    takes: state === "complete" ? 2 + (index % 2) : state === "running" || state === "failed" ? 1 : 0,
    selectedTake: 0,
  };
});

const assetImages = {
  "林夏": posters[4],
  "陈默": posters[2],
  "雾港码头": posters[3],
  "离岸货船": posters[5],
  "林夏的车": posters[4],
  "港区集装箱": posters[1],
  "港区闸门": posters[5],
  "防水文件袋": posters[1],
  "甲板栏杆": posters[2],
};

const assetTypes = {
  "林夏": "人物三视图",
  "陈默": "人物三视图",
  "雾港码头": "场景设定",
  "离岸货船": "场景设定",
  "林夏的车": "道具资产",
  "港区集装箱": "场景设定",
  "港区闸门": "场景设定",
  "防水文件袋": "道具资产",
  "甲板栏杆": "场景设定",
};

const referenceKits = [
  {
    id: "kit_series_linxia",
    name: "林夏·全剧身份",
    scope: "全剧",
    version: 4,
    nextVersion: 4,
    roles: { character: ["林夏"], scene: [], props: [], style: ["冷调海港现实主义"] },
    policy: ["身份", "服装", "风格"],
  },
  {
    id: "kit_scene_dock",
    name: "雨夜码头行动线",
    scope: "EP03 · 场景",
    version: 2,
    nextVersion: 3,
    roles: { character: [], scene: ["雾港码头"], props: ["防水文件袋", "港区闸门"], style: [] },
    policy: ["场景", "风格"],
  },
  {
    id: "kit_scene_ship",
    name: "离岸货船与甲板",
    scope: "EP03 · 场景",
    version: 3,
    nextVersion: 3,
    roles: { character: ["陈默"], scene: ["离岸货船"], props: ["甲板栏杆"], style: [] },
    policy: ["身份", "场景"],
  },
];

function sceneKitForShot(shot) {
  return shot.assets.includes("离岸货船") || shot.assets.includes("陈默") ? "kit_scene_ship" : "kit_scene_dock";
}

shots.forEach((shot, index) => {
  const sceneKitId = sceneKitForShot(shot);
  const sceneKit = referenceKits.find((kit) => kit.id === sceneKitId);
  shot.kitIds = ["kit_series_linxia", sceneKitId];
  shot.kitVersions = Object.fromEntries(shot.kitIds.map((id) => [id, referenceKits.find((kit) => kit.id === id)?.version || 1]));
  shot.kitConfidence = [98, 94, 91, 89, 97, 99, 96, 93, 95, 88, 90, 97][index];
  shot.kitSource = index === 3 || index === 9 ? "待人工检查" : "自动建议 · 已确认";
  shot.excludedAssets = [];
  shot.manualAssets = [];
  shot.pendingKitVersion = sceneKit?.nextVersion > sceneKit?.version;
});

let selectedShotIndex = 6;
let copyTab = "story";
let selectedPanelIndex = 3;
let assetWorkflowMode = "professional";
let toastTimer = null;
let batchTimer = null;
let batchScope = "current";
let batchTargets = [];
let queuePaused = false;
const shotTimers = new Map();
let cutTimer = null;
let cutState = "blocked";
let selectedAssetStyle = "cg_3d";
let assetStyleReferenceEnabled = true;
let assetBindMode = "bind";
let assetBindTarget = "林夏";
let previewedAsset = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function buildPrompt(number, duration, size, lens, motion, story, dialogue) {
  const spoken = dialogue === "无" ? "人声 OS：无。人物台词：无。" : `${dialogue.replaceAll("\n", " ")}。`;
  return `镜号 ${number}（${duration} 秒） 景别：${size}。摄像机 / 镜头：${lens}。运镜：${motion}，全程保持单一且连续。机位视角：侧前方平视。画面：${story} 保持人物身份、服装、场景空间与前后镜头一致，不增加剧情外物体。${spoken} 音效：持续暴雨、海浪、远处船笛与现场环境声。`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function padded(number) {
  return String(number).padStart(2, "0");
}

function currentShot() {
  return shots[selectedShotIndex];
}

function motionStageState(shot) {
  if (shot.state === "complete") return "complete";
  return shot.state;
}

function renderShotRail() {
  $("#shotRail").innerHTML = shots.map((shot, index) => `
    <button class="shot-card" type="button" role="option" data-shot-index="${index}" data-state="${shot.state}" aria-selected="${index === selectedShotIndex}">
      <img src="${shot.image}" alt="${escapeHtml(shot.title)}" />
      <span class="shot-card-number">${padded(shot.number)}</span>
      <span class="shot-card-copy"><b>${shot.duration}s</b><em>${stateLabel(shot)}</em></span>
      <span class="shot-stage-strip" aria-label="剧情、故事板、视频状态">
        <i data-stage-state="complete"></i><i data-stage-state="complete"></i><i data-stage-state="${motionStageState(shot)}"></i>
      </span>
    </button>
  `).join("");

  $$("[data-shot-index]").forEach((button) => {
    button.addEventListener("click", () => selectShot(Number(button.dataset.shotIndex)));
  });
}

function stateLabel(shot) {
  if (shot.state === "running") return `${shot.progress}%`;
  if (shot.state === "queued") return "排队";
  if (shot.state === "failed") return "失败";
  if (shot.state === "complete") return "完成";
  return "待生成";
}

function selectShot(index) {
  selectedShotIndex = index;
  copyTab = "story";
  renderShotRail();
  renderSelectedShot();
}

function renderSelectedShot() {
  const shot = currentShot();
  const effectiveAssets = effectiveShotAssets(shot);
  $("#selectedShotNumber").textContent = padded(shot.number);
  $("#selectedShotTitle").textContent = shot.title;
  $("#selectedShotMeta").textContent = `${shot.duration} 秒 · 分镜版本 v3 · 引用资产 ${effectiveAssets.length}`;
  $("#shotSize").textContent = shot.size;
  $("#shotLens").textContent = shot.lens;
  $("#shotMotion").textContent = shot.motion;
  $("#shotVoice").textContent = shot.dialogue === "无" ? "环境声 · 无对白" : `对白 / OS · ${Math.min(shot.duration - 0.8, 3.6).toFixed(1)} 秒`;
  $("#videoTime").textContent = `00:${padded(shot.duration)}`;
  renderCopyEditor();
  renderKitContinuity();
  renderReferences();
  renderStillTakes();
  renderMotion();
  renderKitPanel();
  renderInspector();
}

function copyValueForShot(shot) {
  if (copyTab === "prompt") return shot.prompt;
  if (copyTab === "dialogue") return shot.dialogue;
  return shot.story;
}

function renderCopyEditor() {
  const labels = { story: "剧情原文", prompt: "视频提示词", dialogue: "对白 / OS" };
  const value = copyValueForShot(currentShot());
  $("#copyEditorLabel").textContent = labels[copyTab];
  $("#shotCopy").value = value;
  $("#copyCount").textContent = `${value.length} 字`;
  $$("[data-copy-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.copyTab === copyTab));
}

function effectiveShotAssets(shot) {
  const excluded = new Set(shot.excludedAssets || []);
  return [...new Set([...(shot.assets || []), ...(shot.manualAssets || [])])].filter((asset) => !excluded.has(asset));
}

function kitsForShot(shot) {
  return (shot.kitIds || []).map((id) => referenceKits.find((kit) => kit.id === id)).filter(Boolean);
}

function renderKitContinuity() {
  const shot = currentShot();
  const kits = kitsForShot(shot);
  $("#kitCurrentShot").textContent = `镜头 ${padded(shot.number)}`;
  $("#activeKitNames").innerHTML = kits.map((kit) => `<span><b>${escapeHtml(kit.scope)}</b>${escapeHtml(kit.name)} <em>v${shot.kitVersions?.[kit.id] || kit.version}</em></span>`).join("");
  $("#kitConfidence").textContent = `${shot.kitConfidence}%`;
  $("#kitSource").textContent = shot.kitSource;
  $("#kitVersionNotice").textContent = `${kits.length} 个 Kit · ${shot.pendingKitVersion ? "有可用更新" : "版本已冻结"}`;
}

function renderAssetDocumentState() {
  const professional = assetWorkflowMode === "professional";
  $$("[data-asset-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.assetMode === assetWorkflowMode));
  $("#assetSourcePolicy").classList.toggle("is-quick", !professional);
  $("#assetSourceTitle").textContent = professional ? "资产描述文档 · v6" : "剧情候选池 · 尚未成为正式资产";
  $("#assetSourceRule").textContent = professional
    ? "禁止从剧情创建正式资产；剧情只检查使用关系和缺失项。"
    : "剧情只能生成待确认候选；人工补入资产文档并确认后，才能进入 Kit。";
  $("#assetParserPanel .parser-health strong").textContent = professional ? "Claude Opus · 仅解析资产文档" : "Claude Opus · 候选提取，等待人工确认";
}

function assetStyleLabel() {
  const selector = $("#assetStylePresetPreview");
  const presetLabel = selector.options[selector.selectedIndex]?.textContent || "自定义";
  const customStyle = $("#assetStyleCustomPreview").value.trim();
  return selectedAssetStyle === "custom" && customStyle ? customStyle : presetLabel;
}

function renderAssetOperationState() {
  const styleLabel = assetStyleLabel();
  const referenceControl = $("#assetStyleReferenceControl");
  const targetSelector = $("#assetBindTarget");
  const actionButton = $("#bindOrReplaceAssetButton");
  const actionLabels = { bind: "绑定上传", replace: "替换资产图", local: "新增本地资产" };

  $("#assetStyleStatus").textContent = styleLabel;
  $("#assetPreviewStyle").textContent = `${styleLabel} · ${assetStyleReferenceEnabled ? "使用全剧风格参考" : "未使用风格参考"}`;
  referenceControl.classList.toggle("is-disabled", !assetStyleReferenceEnabled);
  targetSelector.disabled = assetBindMode === "local";
  actionButton.textContent = actionLabels[assetBindMode];
}

function openAssetPreview(trigger) {
  const dialog = $("#assetPreviewDialog");
  const source = typeof trigger === "string" ? trigger : trigger.dataset.assetPreview;
  const name = typeof trigger === "string" ? "资产图" : trigger.dataset.assetName || "资产图";
  const meta = typeof trigger === "string" ? "" : trigger.dataset.assetMeta || "";

  previewedAsset = { source, name, meta };
  $("#assetPreviewImage").src = source;
  $("#assetPreviewImage").alt = `${name}放大预览`;
  $("#assetPreviewTitle").textContent = name;
  $("#assetPreviewMeta").textContent = meta;
  renderAssetOperationState();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeAssetPreview() {
  const dialog = $("#assetPreviewDialog");
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

function bindOrReplaceAsset(mode = assetBindMode) {
  const actionLabels = {
    bind: `已选择文件并绑定到「${assetBindTarget}」`,
    replace: `已为「${assetBindTarget}」提交替换图，新版本确认前保留原图`,
    local: "已选择本地图片，确认分类后才会进入正式资产文档",
  };
  showToast(actionLabels[mode]);
}

function changeAssetWorkflowMode(mode) {
  assetWorkflowMode = mode === "quick" ? "quick" : "professional";
  renderAssetDocumentState();
  showToast(assetWorkflowMode === "professional" ? "专业模式：正式资产只来自资产描述文档" : "快速模式：剧情候选不会直接进入 Kit");
}

function resolveUndefinedAsset(action, assetName) {
  const item = $(`[data-undefined-asset="${assetName}"]`);
  if (!item) return;
  if (action === "add") {
    item.classList.add("is-resolved");
    item.querySelector("span").textContent = "已加入资产描述文档草稿，确认前不会进入 Kit";
    item.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    $("#undefinedAssetCount").textContent = "1 个待文档确认";
    showToast(`${assetName}已进入资产文档草稿，尚未成为正式资产`);
    return;
  }
  item.remove();
  $("#undefinedAssetCount").textContent = "0 个未定义项";
  showToast(`${assetName}已标记为无需独立资产`);
}

function renderReferences() {
  const shot = currentShot();
  const assets = effectiveShotAssets(shot);
  const kits = kitsForShot(shot);
  $("#referenceCount").textContent = `${assets.length} 个资产 · ${shot.excludedAssets.length ? `${shot.excludedAssets.length} 个镜头例外` : "自动继承"}`;
  $("#referenceKitLineage").innerHTML = kits.map((kit) => `<span>${escapeHtml(kit.name)} <b>v${shot.kitVersions?.[kit.id] || kit.version}</b></span>`).join("");
  $("#referenceGrid").innerHTML = assets.map((asset) => `
    <figure class="reference-item">
      <img src="${assetImages[asset] || shot.image}" alt="${escapeHtml(asset)}" />
      <figcaption><strong>${escapeHtml(asset)}</strong><span>${assetTypes[asset] || "引用资产"}</span></figcaption>
    </figure>
  `).join("");
  $("#stillPreview").src = shot.image;
  $("#stillPreview").alt = `${shot.title}故事板`;
}

function panelBindingsForShot(shot) {
  const assets = effectiveShotAssets(shot);
  const characters = assets.filter((asset) => assetTypes[asset] === "人物三视图");
  const scenes = assets.filter((asset) => assetTypes[asset] === "场景设定");
  const props = assets.filter((asset) => assetTypes[asset] === "道具资产");
  return Array.from({ length: 9 }, (_, index) => {
    const panelAssets = [];
    if (scenes.length && index !== 8) panelAssets.push(scenes[0]);
    if (characters.length && index >= 1 && index <= 7) panelAssets.push(characters[index > 5 && characters[1] ? 1 : 0]);
    if (props.length && index >= 3 && index <= 6) panelAssets.push(props[(index - 3) % props.length]);
    if (!panelAssets.length) {
      const fallback = assets[Math.min(index, Math.max(0, assets.length - 1))];
      if (fallback) panelAssets.push(fallback);
    }
    return { panel: index + 1, assets: [...new Set(panelAssets)] };
  });
}

function renderPanelAssetBindings() {
  const bindings = panelBindingsForShot(currentShot());
  $("#panelAssetBindings").innerHTML = bindings.map((binding, index) => `
    <button type="button" data-panel-index="${index}" class="${index === selectedPanelIndex ? "is-selected" : ""}">
      <span>P${binding.panel}</span><b>${binding.assets.length}</b>
    </button>
  `).join("");
  const selected = bindings[selectedPanelIndex] || bindings[0];
  $("#panelBindingDetail").innerHTML = `<span>P${selected.panel} 实际出现</span><div>${selected.assets.map((asset) => `<b>${escapeHtml(asset)}</b>`).join("") || "<em>无资产空镜</em>"}</div>`;
  $$('[data-panel-index]').forEach((button) => button.addEventListener("click", () => {
    selectedPanelIndex = Number(button.dataset.panelIndex);
    renderPanelAssetBindings();
  }));
}

function renderKitPanel() {
  const shot = currentShot();
  const activeIds = new Set(shot.kitIds || []);
  $("#kitLibrary").innerHTML = referenceKits.map((kit) => {
    const assets = [...kit.roles.character, ...kit.roles.scene, ...kit.roles.props];
    const version = shot.kitVersions?.[kit.id] || kit.version;
    return `<article class="kit-library-row${activeIds.has(kit.id) ? " is-active" : ""}">
      <span class="kit-scope">${escapeHtml(kit.scope)}</span>
      <div><strong>${escapeHtml(kit.name)}</strong><small>${assets.map(escapeHtml).join(" · ") || "风格规则"}</small></div>
      <em>v${version}</em>
    </article>`;
  }).join("");
  $("#kitEditorShot").textContent = `镜头 ${padded(shot.number)} · ${shot.title}`;
  $("#kitEditorConfidence").textContent = `模型置信度 ${shot.kitConfidence}%`;
  const sceneKits = referenceKits.filter((kit) => kit.scope.includes("场景"));
  const selectedSceneKit = (shot.kitIds || []).find((id) => sceneKits.some((kit) => kit.id === id));
  $("#shotKitSelect").innerHTML = sceneKits.map((kit) => `<option value="${kit.id}" ${kit.id === selectedSceneKit ? "selected" : ""}>${escapeHtml(kit.name)} · v${kit.version}</option>`).join("");
  $("#kitAssetOverrides").innerHTML = (shot.assets || []).map((asset) => {
    const excluded = shot.excludedAssets.includes(asset);
    return `<button type="button" data-kit-asset="${escapeHtml(asset)}" class="${excluded ? "is-excluded" : ""}"><span>${escapeHtml(asset)}</span><em>${excluded ? "已排除" : "使用"}</em></button>`;
  }).join("");
  renderPanelAssetBindings();
}

function autoAssignReferenceKits() {
  const button = $("#autoAssignKits");
  button.disabled = true;
  button.textContent = "模型分析中...";
  $("#kitAssignmentStatus").textContent = "正在核对剧情、场景与在场人物";
  window.setTimeout(() => {
    shots.forEach((shot) => {
      const sceneKitId = sceneKitForShot(shot);
      shot.kitIds = ["kit_series_linxia", sceneKitId];
      shot.kitConfidence = Math.max(92, shot.kitConfidence);
      shot.kitSource = "自动建议 · 已确认";
    });
    button.disabled = false;
    button.textContent = "重新分析本集";
    $("#kitAssignmentStatus").textContent = "12 已确认 · 0 待检查";
    renderSelectedShot();
    showToast("分镜模型已重新分配 12 个镜头；没有覆盖任何故事板或 Take");
  }, 900);
}

function applyKitVersionToPendingShots() {
  const kit = referenceKits.find((item) => item.id === "kit_scene_dock");
  const pending = shots.filter((shot) => shot.state !== "complete" && shot.kitIds.includes(kit.id));
  pending.forEach((shot) => {
    shot.kitVersions[kit.id] = kit.nextVersion;
    shot.pendingKitVersion = false;
  });
  kit.version = kit.nextVersion;
  $("#kitImpactTitle").textContent = `${kit.name} v${kit.version} · 已应用`;
  $("#applyKitUpdate").textContent = "未生成镜头已更新";
  renderSelectedShot();
  showToast(`已更新 ${pending.length} 个未完成镜头；8 个已完成镜头继续使用旧版本`);
}

function changeCurrentShotSceneKit(kitId) {
  const shot = currentShot();
  const sceneKitIds = new Set(referenceKits.filter((kit) => kit.scope.includes("场景")).map((kit) => kit.id));
  shot.kitIds = [...shot.kitIds.filter((id) => !sceneKitIds.has(id)), kitId];
  const kit = referenceKits.find((item) => item.id === kitId);
  shot.kitVersions[kitId] = kit.version;
  shot.kitSource = "人工覆盖";
  shot.kitConfidence = 100;
  renderSelectedShot();
  showToast(`当前镜头已改用「${kit.name}」，其他镜头不受影响`);
}

function toggleCurrentShotAsset(asset) {
  const shot = currentShot();
  if (shot.excludedAssets.includes(asset)) shot.excludedAssets = shot.excludedAssets.filter((item) => item !== asset);
  else shot.excludedAssets.push(asset);
  shot.kitSource = "人工覆盖";
  renderSelectedShot();
  showToast(`${asset}${shot.excludedAssets.includes(asset) ? "已从当前镜头排除" : "已恢复到当前镜头"}`);
}

function renderStillTakes() {
  const shot = currentShot();
  $("#stillTakeList").innerHTML = Array.from({ length: shot.stillTakes }, (_, index) => `
    <button class="still-take${index === 0 ? " is-selected" : ""}" type="button" aria-label="故事板版本 ${index + 1}">
      <img src="${posters[(selectedShotIndex + index + 2) % posters.length]}" alt="" />
    </button>
  `).join("");
}

function renderMotion() {
  const shot = currentShot();
  const state = $("#motionState");
  const lineage = $("#motionLineage");
  const overlay = $("#generationOverlay");
  const videoFrame = $("#videoFrame");
  const labels = { complete: "已完成", running: "生成中", queued: "队列中", failed: "生成失败", ready: "待生成" };
  state.className = `stage-status is-${shot.state}`;
  state.textContent = labels[shot.state];
  lineage.className = shot.state === "complete" ? "is-done" : shot.state === "running" ? "is-running" : shot.state === "failed" ? "is-failed" : "";
  $("#shotAction").textContent = shot.state === "failed" ? "修改后重试" : shot.state === "ready" ? "生成此镜头" : shot.state === "running" || shot.state === "queued" ? "查看队列" : "生成新 Take";
  $("#videoPoster").src = shot.image;
  $("#videoPoster").alt = `${shot.title}视频预览`;
  videoFrame.classList.toggle("is-empty", shot.state === "ready" || shot.state === "failed");
  overlay.classList.toggle("is-visible", shot.state === "running" || shot.state === "queued");
  overlay.setAttribute("aria-hidden", String(!(shot.state === "running" || shot.state === "queued")));
  $("#overlayStatus").textContent = shot.state === "queued" ? "等待并发槽位" : "正在生成新 Take";
  $("#overlayProgress").textContent = `${shot.progress}%`;
  $("#takeCount").textContent = shot.takes;
  renderTakeList();
}

function renderTakeList() {
  const shot = currentShot();
  if (!shot.takes) {
    $("#takeList").innerHTML = '<div class="queue-item"><span>--</span><div><b>还没有视频 Take</b><small>故事板与引用资产已准备</small></div></div>';
    return;
  }
  $("#takeList").innerHTML = Array.from({ length: shot.takes }, (_, index) => `
    <button class="take-row${index === shot.selectedTake ? " is-selected" : ""}" type="button" data-take-index="${index}">
      <img src="${posters[(selectedShotIndex + index + 1) % posters.length]}" alt="Take ${index + 1}" />
      <span><b>TAKE ${padded(index + 1)}</b><small>${index ? "Kling v3 Pro" : "Seedance 2.0"} · ${shot.duration}s</small></span>
      <em>${index === shot.selectedTake ? "采用" : "保留"}</em>
    </button>
  `).join("");
  $$("[data-take-index]").forEach((button) => {
    button.addEventListener("click", () => {
      shot.selectedTake = Number(button.dataset.takeIndex);
      renderTakeList();
      showToast(`已选择 TAKE ${padded(shot.selectedTake + 1)}，其他版本继续保留`);
    });
  });
}

function scopeTargets(scope = batchScope) {
  if (scope === "current") return [selectedShotIndex];
  if (scope === "missing") return shots.map((shot, index) => ["failed", "ready"].includes(shot.state) ? index : -1).filter((index) => index >= 0);
  return shots.map((shot, index) => shot.state === "complete" ? -1 : index).filter((index) => index >= 0);
}

function scopeLabel(scope = batchScope) {
  return { current: "当前镜头", missing: "缺失镜头", episode: "本集全部" }[scope] || "当前镜头";
}

function renderBatchScope() {
  const targets = scopeTargets();
  const totalSeconds = targets.reduce((sum, index) => sum + shots[index].duration, 0);
  const current = currentShot();
  const currentTarget = batchScope === "current" ? `镜头 ${padded(current.number)} · 1 个` : `${targets.length} 个镜头`;
  const submitLabel = batchScope === "current" && current.state === "complete"
    ? `生成镜头 ${padded(current.number)} 新 Take`
    : `提交${scopeLabel()}${targets.length ? ` · ${targets.length} 个` : ""}`;

  $$("[data-batch-scope]").forEach((button) => {
    const selected = button.dataset.batchScope === batchScope;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    const small = button.querySelector("small");
    if (!small) return;
    const buttonTargets = scopeTargets(button.dataset.batchScope);
    if (button.dataset.batchScope === "current") small.textContent = currentTarget;
    if (button.dataset.batchScope === "missing") small.textContent = `失败 + 待生成 · ${buttonTargets.length} 个`;
    if (button.dataset.batchScope === "episode") small.textContent = `只提交未完成 · ${buttonTargets.length} 个`;
  });

  $("#batchScopeTitle").textContent = `${scopeLabel()}视频生成`;
  $("#batchScopeCount").textContent = targets.length ? `${targets.length} 个镜头 · 预计 ${totalSeconds} 秒` : "没有可提交的镜头";
  $("#batchScopeSubmit").textContent = submitLabel;
  $("#batchScopeSubmit").disabled = !targets.length || Boolean(batchTimer);
  $("#batchScopeSubmit").classList.toggle("is-running", Boolean(batchTimer));
  $("#batchScopeAccordion").classList.toggle("is-running", Boolean(batchTimer));
  const actionNote = batchScope === "current" && current.state === "complete"
    ? "会创建新的 Take，当前采用版本和其他镜头不受影响"
    : "已完成镜头与历史 Take 会保留，不会重复提交";
  $("#batchScopeNote").textContent = actionNote;
}

function renderInspector() {
  const shot = currentShot();
  const statusLabels = { complete: "已完成", running: "生成中", queued: "队列中", failed: "生成失败", ready: "待生成" };
  const status = $("#inspectorStatus");
  status.className = `inspector-status is-${shot.state}`;
  status.textContent = statusLabels[shot.state];
  $("#inspectorTitle").textContent = `镜头 ${padded(shot.number)} · ${shot.title}`;
  $("#inspectorMeta").textContent = `${shot.duration} 秒 · 引用资产 ${effectiveShotAssets(shot).length} 个 · ${shot.takes ? `Take ${padded(shot.selectedTake + 1)}` : "尚无视频 Take"}`;
  $("#inspectorFailureMessage").textContent = shot.state === "failed"
    ? `${shot.failureReason || "模型未返回可用视频"}。可切换模型后只重试这一镜。`
    : "当前镜头成功后仍可生成新的 Take；如果失败，只重试这一镜。";
  const prompt = $("#shotPromptInspector");
  prompt.value = shot.prompt;
  prompt.classList.remove("is-dirty");
  $("#inspectorPromptCount").textContent = `${shot.prompt.length} 字`;
  $("#inspectorDirtyState").textContent = "已保存";
  $("#retryFailedShotButton").disabled = shot.state !== "failed";
  $("#retryFailedShotButton").textContent = shot.state === "failed" ? "失败后重试" : "仅失败时可重试";
}

function renderCutPanel() {
  const completed = shots.filter((shot) => shot.state === "complete").length;
  const ready = completed === shots.length;
  const state = $("#cutPanel .cut-state");
  const title = $("#cutReadyTitle");
  const copy = $("#cutReadyCopy");
  const button = $("#assembleCutButton");
  if (cutState === "assembling") {
    state.className = "cut-state is-running";
    state.textContent = "组装中";
    title.textContent = "正在校验镜头与时间线";
    copy.textContent = "不会改变任何单独 Take，完成后生成独立成片。";
    button.disabled = true;
  } else if (cutState === "complete") {
    state.className = "cut-state is-complete";
    state.textContent = "可预览";
    title.textContent = "本集成片已组装";
    copy.textContent = "9:16 成片已就绪，可在此面板继续预览。";
    button.disabled = false;
    button.textContent = "重新组装";
  } else if (ready) {
    cutState = "ready";
    state.className = "cut-state is-ready";
    state.textContent = "可组装";
    title.textContent = "12 个镜头已完成";
    copy.textContent = "可以组装本集 00:57 成片，单独 Take 不会被覆盖。";
    button.disabled = false;
    button.textContent = "组装成片";
  } else {
    cutState = "blocked";
    state.className = "cut-state is-blocked";
    state.textContent = "待补齐";
    title.textContent = `还有 ${shots.length - completed} 个镜头未完成`;
    copy.textContent = `完成后才能组装本集 00:57 成片。`;
    button.disabled = true;
    button.textContent = "组装成片";
  }
  const checklist = $$("#cutPanel .cut-checklist b");
  if (checklist[0]) checklist[0].textContent = `${completed} / ${shots.length}`;
}

function completeShot(index) {
  const shot = shots[index];
  shot.state = "complete";
  shot.progress = 100;
  shot.failureReason = "";
  shot.takes += 1;
  shot.selectedTake = shot.takes - 1;
}

function runShotProgress(index, increment = 17, interval = 420) {
  if (shotTimers.has(index)) return;
  const shot = shots[index];
  shot.state = "running";
  shot.progress = 0;
  const timer = window.setInterval(() => {
    shot.progress = Math.min(100, shot.progress + increment);
    renderAllLiveState();
    if (shot.progress >= 100) {
      window.clearInterval(timer);
      shotTimers.delete(index);
      completeShot(index);
      renderAllLiveState();
      showToast(`镜头 ${padded(shot.number)} 已完成；历史 Take 继续保留`);
    }
  }, interval);
  shotTimers.set(index, timer);
}

function retryFailedShot(index = selectedShotIndex) {
  const shot = shots[index];
  if (!shot || shot.state !== "failed") {
    showToast("只有失败镜头可以重试，已完成镜头不会被覆盖");
    return;
  }
  selectedShotIndex = index;
  batchTargets = [...new Set([...batchTargets, index])];
  shot.state = "queued";
  shot.progress = 0;
  shot.failureReason = "";
  if (batchTimer) startQueuedShots(2, batchTargets);
  else runShotProgress(index, 20, 460);
  renderSelectedShot();
  renderAllLiveState();
  openPanel("queuePanel");
  showToast(`镜头 ${padded(shot.number)} 已重新提交；已完成镜头不受影响`);
}

function simulateCutAssembly() {
  openPanel("cutPanel");
  const completed = shots.filter((shot) => shot.state === "complete").length;
  if (completed !== shots.length) {
    showToast(`还有 ${shots.length - completed} 个镜头未完成，暂不能组装成片`);
    return;
  }
  if (cutTimer) return;
  cutState = "assembling";
  renderCutPanel();
  cutTimer = window.setTimeout(() => {
    cutTimer = null;
    cutState = "complete";
    renderCutPanel();
    showToast("本集成片已组装，独立于所有镜头 Take");
  }, 900);
}

function renderEpisodeMetrics() {
  const completed = shots.filter((shot) => shot.state === "complete").length;
  const running = shots.filter((shot) => shot.state === "running").length;
  const failed = shots.filter((shot) => shot.state === "failed").length;
  const pending = shots.filter((shot) => shot.state === "ready" || shot.state === "queued").length;
  $("#pipelineVideoProgress").textContent = `${completed} / ${shots.length} 已完成`;
  $("#sequenceStatus").textContent = `${completed} 完成`;
  $("#queueButtonText").textContent = `队列 ${running + shots.filter((shot) => shot.state === "queued").length}`;
  const detail = $("#episodeBatchAction").querySelector("small");
  detail.textContent = completed === shots.length ? "全部镜头已完成" : `${failed + pending + running} 个镜头待处理`;
  $("#pipelineCutProgress").textContent = completed === shots.length ? "可以组装成片" : `等待 ${shots.length - completed} 个镜头`;
  renderCutPanel();
}

function simulateEpisodeBatch() {
  if (batchTimer) {
    openPanel("queuePanel");
    return;
  }

  batchTargets = scopeTargets();
  if (!batchTargets.length) {
    showToast(`${scopeLabel()}没有可提交的镜头`);
    return;
  }

  if (batchScope === "current" && ["running", "queued"].includes(currentShot().state)) {
    openPanel("queuePanel");
    return;
  }

  batchTargets.forEach((index) => {
    const shot = shots[index];
    shot.state = "queued";
    shot.progress = 0;
    shot.failureReason = "";
  });
  startQueuedShots(2, batchTargets);
  queuePaused = false;
  $("#episodeBatchAction").classList.add("is-running");
  $("#episodeBatchAction b").textContent = `${scopeLabel()}生成中`;
  $("#pauseQueue").textContent = "暂停队列";
  renderAllLiveState();
  openPanel("queuePanel");

  batchTimer = window.setInterval(() => {
    if (queuePaused) return;
    const active = shots.map((shot, index) => shot.state === "running" ? index : -1).filter((index) => index >= 0);
    active.forEach((index) => {
      const shot = shots[index];
      shot.progress = Math.min(100, shot.progress + 14);
      if (shot.progress >= 100) {
        shot.state = "complete";
        shot.takes += 1;
        shot.selectedTake = shot.takes - 1;
      }
    });
    startQueuedShots(2, batchTargets);
    renderAllLiveState();

    const unfinished = batchTargets.some((index) => ["running", "queued"].includes(shots[index].state));
    if (!unfinished) finishEpisodeBatch();
  }, 500);
  renderAllLiveState();
}

function startQueuedShots(limit, targets = shots.map((_, index) => index)) {
  let available = limit - shots.filter((shot) => shot.state === "running").length;
  for (const index of targets) {
    if (available <= 0) break;
    const shot = shots[index];
    if (shot.state === "queued") {
      shot.state = "running";
      available -= 1;
    }
  }
}

function finishEpisodeBatch() {
  window.clearInterval(batchTimer);
  batchTimer = null;
  $("#episodeBatchAction").classList.remove("is-running");
  $("#episodeBatchAction b").textContent = `${scopeLabel()}已完成`;
  renderAllLiveState();
  showToast(`${scopeLabel()}已完成；所有旧 Take 均已保留`);
}

function runSingleShot() {
  const shot = currentShot();
  if (shot.state === "running" || shot.state === "queued") {
    openPanel("queuePanel");
    return;
  }
  runShotProgress(selectedShotIndex);
  renderAllLiveState();
}

function renderAllLiveState() {
  renderShotRail();
  renderEpisodeMetrics();
  renderBatchScope();
  renderQueuePanel();
  renderMotion();
}

function renderQueuePanel() {
  const tracked = [...new Set([...(batchTargets || []), ...shots.map((shot, index) => ["running", "queued", "failed"].includes(shot.state) ? index : -1).filter((index) => index >= 0)])];
  const running = shots.filter((shot) => shot.state === "running").length;
  $("#queueCapacity").textContent = `${running} / 4`;
  $$(".capacity-meter i").forEach((bar, index) => bar.classList.toggle("is-active", index < running));
  $("#queuePanelList").innerHTML = tracked.map((index) => {
    const shot = shots[index];
    const reason = shot.state === "failed" ? `<small class="queue-failure">${escapeHtml(shot.failureReason || "模型未返回可用视频")}</small>` : "";
    const retry = shot.state === "failed" ? `<button type="button" data-queue-action="retry" data-shot-index="${index}">重试</button>` : "";
    const cancel = shot.state === "queued" ? `<button type="button" data-queue-action="cancel" data-shot-index="${index}">取消</button>` : "";
    return `<div class="queue-item is-${shot.state}"><span>${padded(shot.number)}</span><div><b>${escapeHtml(shot.title)}</b><small>${stateLabel(shot)} · ${shot.takes} 个历史 Take 保留</small>${reason}<div class="queue-item-actions"><button type="button" data-queue-action="inspect" data-shot-index="${index}">查看镜头</button>${retry}${cancel}</div></div><em>${shot.state === "running" ? `${shot.progress}%` : stateLabel(shot)}</em></div>`;
  }).join("") || '<div class="queue-item"><span>--</span><div><b>队列为空</b><small>没有待处理任务</small></div></div>';
}

function openPanel(id) {
  $$(".side-panel").forEach((panel) => {
    const shouldOpen = panel.id === id;
    panel.classList.toggle("is-open", shouldOpen);
    panel.setAttribute("aria-hidden", String(!shouldOpen));
  });
  $("#panelScrim").hidden = false;
}

function closePanels() {
  $$(".side-panel").forEach((panel) => {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
  });
  window.setTimeout(() => { $("#panelScrim").hidden = true; }, 180);
}

function toggleStyleBible() {
  if ($("#styleBiblePanel").classList.contains("is-open")) closePanels();
  else openPanel("styleBiblePanel");
}

function showToast(message) {
  const toast = $("#previewToast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function normalizePreviewAssets() {
  $("#stillPreview").src = posters[0];
  $("#videoPoster").src = posters[0];
  $("#assetStyleReferenceControl img").src = posters[3];
  $$('[data-asset-preview]').forEach((button, index) => {
    const source = posters[(index + 1) % posters.length];
    button.dataset.assetPreview = source;
    const image = button.querySelector("img");
    if (image) image.src = source;
  });
}

function initializePreview() {
  normalizePreviewAssets();
  renderShotRail();
  renderSelectedShot();
  renderAssetDocumentState();
  renderAssetOperationState();
  renderEpisodeMetrics();
  renderBatchScope();
  renderQueuePanel();
  $("#bibleReferences").innerHTML = posters.map((poster, index) => `<img src="${poster}" alt="视觉参考 ${index + 1}" />`).join("");

  $$("[data-copy-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      copyTab = button.dataset.copyTab;
      renderCopyEditor();
    });
  });

  $("#shotCopy").addEventListener("input", (event) => {
    $("#copyCount").textContent = `${event.target.value.length} 字`;
  });

  $("#saveCopy").addEventListener("click", () => {
    currentShot()[copyTab] = $("#shotCopy").value;
    showToast("已保存到当前镜头，不影响其他镜头");
  });

  $("#episodeBatchAction").addEventListener("click", () => {
    if (batchTimer) openPanel("queuePanel");
    else {
      $("#batchScopeAccordion").classList.add("is-open", "is-attention");
      window.setTimeout(() => $("#batchScopeAccordion").classList.remove("is-attention"), 700);
      showToast("先选择提交范围，再提交视频生成");
    }
  });
  $("#batchScopeSubmit").addEventListener("click", simulateEpisodeBatch);
  $("#batchScopeAccordion").addEventListener("click", (event) => {
    const button = event.target.closest("[data-batch-scope]");
    if (!button) return;
    batchScope = button.dataset.batchScope;
    renderBatchScope();
    showToast(`已选择${scopeLabel()}；不会覆盖已完成镜头`);
  });
  $("#shotAction").addEventListener("click", runSingleShot);
  $("#shotInspectorButton").addEventListener("click", () => {
    renderInspector();
    openPanel("shotInspectorPanel");
  });
  $("#videoPipelineButton").addEventListener("click", () => openPanel("queuePanel"));
  $("#cutPipelineButton").addEventListener("click", simulateCutAssembly);
  $("#assembleCutButton").addEventListener("click", simulateCutAssembly);
  $("#styleBibleButton").addEventListener("click", toggleStyleBible);
  $("#queueButton").addEventListener("click", () => openPanel("queuePanel"));
  $("#assetParserButton").addEventListener("click", () => openPanel("assetParserPanel"));
  $("#kitManagerButton").addEventListener("click", () => openPanel("kitPanel"));
  $("#referenceKit").addEventListener("click", () => openPanel("kitPanel"));
  $("#panelScrim").addEventListener("click", closePanels);
  $$("[data-close-panel]").forEach((button) => button.addEventListener("click", closePanels));
  $("#pauseQueue").addEventListener("click", () => {
    queuePaused = !queuePaused;
    $("#pauseQueue").textContent = queuePaused ? "继续队列" : "暂停队列";
    showToast(queuePaused ? "队列已暂停，当前结果不会丢失" : "队列已继续");
  });
  $("#queuePanelList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-queue-action]");
    if (!button) return;
    const index = Number(button.dataset.shotIndex);
    const action = button.dataset.queueAction;
    if (action === "retry") retryFailedShot(index);
    if (action === "inspect") {
      selectedShotIndex = index;
      renderSelectedShot();
      openPanel("shotInspectorPanel");
    }
    if (action === "cancel") {
      const shot = shots[index];
      if (shot.state === "queued") {
        shot.state = "ready";
        shot.progress = 0;
        batchTargets = batchTargets.filter((target) => target !== index);
        renderAllLiveState();
        showToast(`镜头 ${padded(shot.number)} 已取消排队，历史 Take 保留`);
      }
    }
  });
  $("#newStillTake").addEventListener("click", () => showToast("将创建新的故事板 Take，当前版本继续保留"));
  $("#editStillPrompt").addEventListener("click", () => {
    copyTab = "prompt";
    renderCopyEditor();
    $("#shotCopy").focus();
    showToast("已切换到当前镜头提示词");
  });
  $("#shotPromptInspector").addEventListener("input", (event) => {
    const dirty = event.target.value !== currentShot().prompt;
    event.target.classList.toggle("is-dirty", dirty);
    $("#inspectorDirtyState").textContent = dirty ? "未保存" : "已保存";
    $("#inspectorPromptCount").textContent = `${event.target.value.length} 字`;
  });
  $("#saveShotPrompt").addEventListener("click", () => {
    currentShot().prompt = $("#shotPromptInspector").value;
    renderInspector();
    showToast(`镜头 ${padded(currentShot().number)} 提示词已保存；只影响当前镜头`);
  });
  $("#restoreShotPrompt").addEventListener("click", () => {
    renderInspector();
    showToast("已恢复当前镜头的已保存提示词");
  });
  $("#retryFailedShotButton").addEventListener("click", () => retryFailedShot());
  $("#inspectorRetryModel").addEventListener("change", (event) => showToast(`重试模型已切换为「${event.target.value}」`));
  $("#confirmAssetReview").addEventListener("click", () => showToast("资产描述文档已确认，12 个正式资产可用于 Kit"));
  $("#assetWorkflowMode").addEventListener("click", (event) => {
    const button = event.target.closest("[data-asset-mode]");
    if (button) changeAssetWorkflowMode(button.dataset.assetMode);
  });
  $("#undefinedAssetList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-undefined-action]");
    const item = button?.closest("[data-undefined-asset]");
    if (button && item) resolveUndefinedAsset(button.dataset.undefinedAction, item.dataset.undefinedAsset);
  });
  $$('[data-asset-preview]').forEach((button) => {
    button.addEventListener("click", () => openAssetPreview(button));
  });
  $("#closeAssetPreview").addEventListener("click", closeAssetPreview);
  $("#assetPreviewDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAssetPreview();
  });
  $("#assetPreviewDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAssetPreview();
  });
  $("#assetStylePresetPreview").addEventListener("change", (event) => {
    selectedAssetStyle = event.target.value;
    $("#assetStyleCustomPreview").classList.toggle("is-active", selectedAssetStyle === "custom");
    renderAssetOperationState();
    showToast(`资产生成风格已切换为「${assetStyleLabel()}」`);
  });
  $("#assetStyleCustomPreview").addEventListener("input", renderAssetOperationState);
  $("#assetStyleReferenceEnabledPreview").addEventListener("change", (event) => {
    assetStyleReferenceEnabled = event.target.checked;
    renderAssetOperationState();
    showToast(assetStyleReferenceEnabled ? "资产生成将继续引用全剧风格图" : "已停用风格参考，原参考图仍保留");
  });
  $("#replaceStyleReference").addEventListener("click", () => {
    showToast("已选择新的风格参考；确认前继续保留当前参考图");
  });
  $("#assetBindModeSelect").addEventListener("change", (event) => {
    assetBindMode = event.target.value;
    renderAssetOperationState();
  });
  $("#assetBindTarget").addEventListener("change", (event) => {
    assetBindTarget = event.target.value;
  });
  $("#bindOrReplaceAssetButton").addEventListener("click", () => bindOrReplaceAsset());
  $("#previewReplaceAsset").addEventListener("click", () => {
    if (previewedAsset && [...$("#assetBindTarget").options].some((option) => option.value === previewedAsset.name)) {
      assetBindTarget = previewedAsset.name;
      $("#assetBindTarget").value = assetBindTarget;
    }
    assetBindMode = "replace";
    $("#assetBindModeSelect").value = "replace";
    renderAssetOperationState();
    closeAssetPreview();
    $("#assetBindMode").scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(`已切换到「${assetBindTarget}」替换模式`);
  });
  $("#downloadPreviewAsset").addEventListener("click", () => showToast(`${previewedAsset?.name || "资产图"}已加入下载任务`));
  $("#regeneratePreviewAsset").addEventListener("click", () => showToast(`将按当前风格为「${previewedAsset?.name || assetBindTarget}」生成新版本，原图保留`));
  $("#autoAssignKits").addEventListener("click", autoAssignReferenceKits);
  $("#applyKitUpdate").addEventListener("click", applyKitVersionToPendingShots);
  $("#shotKitSelect").addEventListener("change", (event) => changeCurrentShotSceneKit(event.target.value));
  $("#kitAssetOverrides").addEventListener("click", (event) => {
    const button = event.target.closest("[data-kit-asset]");
    if (button) toggleCurrentShotAsset(button.dataset.kitAsset);
  });
}

initializePreview();
