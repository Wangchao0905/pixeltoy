(() => {
  "use strict";

  const HISTORY_KEY = "pixelToys.pixelsStudioHistory.v1";
  const MAX_HISTORY = 24;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp)$/i;
  const POLL_INTERVAL = 1600;
  const MAX_POLLS = 3000;
  const polls = new Map();

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    category: "product-shot",
    mode: "image",
    prompt: "",
    model: "gpt-image-2",
    style: "closeup",
    ratio: "3:4",
    duration: 5,
    batch: 1,
    activeSlot: "product",
    nav: "home",
    generating: false,
    assets: [],
    assetSearch: "",
    slots: { product: null, avatar: null, reference: null },
    results: readHistory(),
  };

  const categoryLabels = {
    "product-shot": "product shot",
    marketplace: "marketplace listing",
    ugc: "UGC social commerce",
    motion: "product motion",
    ads: "paid social ad",
    posters: "campaign poster",
  };
  const styleLabels = {
    closeup: "close-up",
    editorial: "editorial",
    ugc: "authentic UGC",
    "studio-white": "studio white",
    "color-pop": "color pop",
    natural: "natural lifestyle",
    usage: "in-use demonstration",
  };
  const slotLabels = { product: "Product", avatar: "Avatar", reference: "Reference" };
  const IMAGE_MODEL_OPTIONS = Object.freeze([
    { value: "gpt-image-2", label: "GPT Image 2", provider: "GPT", hint: "Flexible 1K / 2K / 4K output" },
    { value: "gemini-3.1-flash-image-preview", label: "Nano Banana 2", provider: "n1n", hint: "Lowest-price image generation" },
    { value: "gemini-3-pro-image-preview", label: "Nano Banana Pro", provider: "n1n", hint: "Lowest-price image generation" },
    { value: "seedream-5-0-pro", label: "Seedream 5 Pro", provider: "Ark", hint: "Commercial detail" },
    { value: "seedream-5-0-lite", label: "Seedream 5 Lite", provider: "Ark", hint: "Faster exploration" },
    { value: "grok-imagine-image-quality", label: "Grok image", provider: "Grok", hint: "High-detail 2K image generation" },
  ]);
  const VIDEO_MODEL_OPTIONS = Object.freeze([
    { value: "sd2", label: "sd2 · 0.230/秒起", provider: "Paisio", hint: "480p / 720p", price: "480p 0.230/秒；720p 0.290/秒" },
    { value: "sd2-fast", label: "sd2-fast · 0.230/秒起", provider: "Paisio", hint: "720p", price: "720p 0.230/秒" },
    { value: "seedance-2-5", label: "Seedance 2.5 · 1.270/秒起", provider: "Paisio", hint: "720p cinematic product motion", price: "720p 1.270/秒" },
    { value: "seedance-2-5-c", label: "Seedance 2.5 C · 3.500/秒起", provider: "Paisio", hint: "720p motion up to 30 seconds", price: "720p 3.500/秒" },
    { value: "seedance-2-5-m", label: "Seedance 2.5 M · 0.570/秒起", provider: "Paisio", hint: "480p / 720p motion with references", price: "480p 0.570/秒；720p 0.970/秒" },
    { value: "seedance-2-0", label: "Seedance 2.0 · 0.730/秒起", provider: "Paisio", hint: "720p balanced product video", price: "720p 0.730/秒" },
    { value: "seedance-2-0-fast", label: "Seedance 2.0 Fast · 0.620/秒起", provider: "Paisio", hint: "720p fast social variations", price: "720p 0.620/秒" },
    { value: "seedance-2-0-mini", label: "Seedance 2.0 Mini · 0.210/秒起", provider: "Paisio", hint: "480p / 720p lightweight iterations", price: "480p 0.210/秒；720p 0.280/秒" },
    { value: "seedance-2-0-m", label: "Seedance 2.0 M · 0.420/秒起", provider: "Paisio", hint: "480p / 720p motion with references", price: "480p 0.420/秒；720p 0.560/秒" },
    { value: "seedance-2-0-m-fast", label: "Seedance 2.0 M Fast · 0.350/秒起", provider: "Paisio", hint: "480p / 720p fast reference motion", price: "480p 0.350/秒；720p 0.490/秒" },
    { value: "seedance-2-0-m-fast-mini", label: "Seedance 2.0 M Fast Mini · 0.210/秒起", provider: "Paisio", hint: "480p / 720p rapid concept tests", price: "480p 0.210/秒；720p 0.280/秒" },
    { value: "mx-h3", label: "mx-h3 · 2.800/秒起", provider: "Paisio", hint: "2K image-to-video motion", price: "2K 2.800/秒" },
    { value: "pixverse-v6", label: "PixVerse V6 · $0.0301/秒起", provider: "n1n", hint: "360p / 540p / 720p / 1080p · text/image/transition/extend", price: "360p $0.0301/秒；540p $0.0422/秒；720p $0.0543/秒；1080p $0.1085/秒" },
    { value: "pixverse-c1", label: "PixVerse C1 · $0.0362/秒起", provider: "n1n", hint: "360p / 540p / 720p / 1080p · text/image/transition/fusion", price: "360p $0.0362/秒；540p $0.0482/秒；720p $0.0603/秒；1080p $0.1146/秒" },
    { value: "seedance-2-0-byteplus", label: "Seedance 2.0 BytePlus", provider: "BytePlus", hint: "Overseas Ark route" },
    { value: "grok-imagine-video", label: "Grok Imagine Video 1.5 Preview · $0.0706/秒起", provider: "Grok", hint: "480p / 720p image-to-video", price: "480p $0.0706/秒；720p $0.1235/秒" },
  ]);

  function modelOptions() {
    return state.mode === "video" ? VIDEO_MODEL_OPTIONS : IMAGE_MODEL_OPTIONS;
  }

  function renderModelOptions() {
    const select = $("#pixels-model");
    if (!select) return;
    const options = modelOptions();
    const selected = options.find((option) => option.value === state.model) || options[0];
    if (state.model !== selected.value) state.model = selected.value;
    if (select.dataset.mode !== state.mode || select.options.length !== options.length) {
      select.innerHTML = options.map((option) => `<option value="${escapeHtml(option.value)}"${option.price ? ` title="${escapeHtml(option.price)}"` : ""}>${escapeHtml(option.label)}</option>`).join("");
      select.dataset.mode = state.mode;
    }
    select.value = state.model;
    const hint = $("#pixelsModelHint");
    if (hint) hint.textContent = `${selected.provider} / ${selected.hint}`;
  }

  function readHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(value) ? value.filter((item) => item && item.id).slice(0, MAX_HISTORY) : [];
    } catch {
      return [];
    }
  }

  function persistHistory() {
    const value = state.results.slice(0, MAX_HISTORY).map((item) => ({
      id: item.id,
      kind: item.kind,
      status: item.status,
      taskId: item.taskId || "",
      provider: item.provider || "",
      url: item.url || "",
      prompt: item.prompt || "",
      category: item.category || "product-shot",
      ratio: item.ratio || "3:4",
      duration: item.duration || 5,
      model: item.model || "",
      style: item.style || "closeup",
      createdAt: item.createdAt || new Date().toISOString(),
      favorite: item.favorite === true,
      message: item.message || "",
    }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function toast(message) {
    const node = $("#pixelsToast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("is-visible"), 3600);
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || (response.status === 401 ? "请先登录 Pixels Studio" : `Request failed (${response.status})`));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function handleRequestError(error, { quiet = false } = {}) {
    if (error?.status === 401) {
      toast("请先登录后使用生成和素材库功能");
      if (!quiet) $("#pixelsStatus").textContent = "登录后即可开始生成";
      return;
    }
    if (!quiet) toast(error?.message || "操作失败，请重试");
  }

  function setSaveState(label = "All changes saved") {
    const node = $("#pixelsSaveState");
    if (node) node.textContent = label;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
      reader.readAsDataURL(file);
    });
  }

  function setMode(mode) {
    state.mode = mode === "video" ? "video" : "image";
    if (!modelOptions().some((option) => option.value === state.model)) state.model = modelOptions()[0].value;
    render();
  }

  function references() {
    return Object.values(state.slots).filter((item) => item?.url).slice(0, 4);
  }

  function campaignPrompt() {
    const base = state.prompt.trim() || `Create a ${categoryLabels[state.category] || "commerce"} campaign asset for this product.`;
    const medium = state.mode === "video" ? `a ${state.duration}-second product video` : "a finished ecommerce image";
    const style = styleLabels[state.style] || state.style;
    return `${base}\n\nCommerce direction: create ${medium} for a ${categoryLabels[state.category] || "commerce"} campaign. Use a ${style} visual language, preserve the product identity and proportions, keep the composition ready for text overlay, and make the main selling point immediately legible. Output ratio: ${state.ratio}.`;
  }

  function renderSlots() {
    $$('[data-slot]').forEach((button) => {
      const slot = button.dataset.slot;
      const image = state.slots[slot];
      button.classList.toggle("has-media", Boolean(image?.url));
      button.setAttribute("aria-pressed", image?.url ? "true" : "false");
      const label = slotLabels[slot];
      button.innerHTML = image?.url
        ? `<img src="${escapeHtml(image.preview || image.url)}" alt="${escapeHtml(image.name || `${label} image`)}" /><span><strong>${escapeHtml(image.name || label)}</strong><small>Ready / click to replace</small></span>`
        : `<span class="pixels-slot-add" aria-hidden="true">+</span><span><strong>${label}</strong><small>${slot === "product" ? "Add product image" : slot === "avatar" ? "Add a person or creator" : "Add style or mood"}</small></span>`;
    });
  }

  function renderResults() {
    const container = $("#pixelsResults");
    const empty = $("#pixelsEmptyResults");
    if (!container || !empty) return;
    const visible = state.nav === "favorites" ? state.results.filter((item) => item.favorite) : state.results;
    container.textContent = "";
    empty.classList.toggle("hidden", visible.length > 0);
    for (const result of visible) container.appendChild(resultCard(result));
  }

  function resultStatus(result) {
    if (result.status === "completed") return "Ready";
    if (result.status === "failed") return "Failed";
    if (result.status === "submitting") return "Submitting";
    return "Generating";
  }

  function resultCard(result) {
    const card = document.createElement("article");
    card.className = `pixels-result-card is-${result.status === "completed" ? "complete" : result.status === "failed" ? "failed" : "running"}`;
    const media = document.createElement("div");
    media.className = "pixels-result-media";
    if (result.status === "completed" && result.url) {
      const mediaNode = result.kind === "video" ? document.createElement("video") : document.createElement("img");
      mediaNode.src = result.url;
      mediaNode.alt = `${categoryLabels[result.category] || "Commerce"} generated content`;
      if (result.kind === "video") {
        mediaNode.controls = true;
        mediaNode.playsInline = true;
        mediaNode.preload = "metadata";
      } else {
        mediaNode.loading = "lazy";
      }
      media.appendChild(mediaNode);
      const open = document.createElement("button");
      open.className = "pixels-result-open";
      open.type = "button";
      open.textContent = "Open";
      open.addEventListener("click", () => window.open(result.url, "_blank", "noopener,noreferrer"));
      media.appendChild(open);
    } else if (result.status === "failed") {
      const failure = document.createElement("span");
      failure.textContent = result.message || "Generation failed. Try again.";
      media.appendChild(failure);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "pixels-result-placeholder";
      placeholder.textContent = result.status === "submitting" ? "Submitting task" : "Generating content";
      media.appendChild(placeholder);
    }
    card.appendChild(media);

    const body = document.createElement("div");
    body.className = "pixels-result-body";
    const meta = document.createElement("div");
    meta.className = "pixels-result-meta";
    const descriptor = document.createElement("span");
    descriptor.textContent = `${result.kind === "video" ? "Video" : "Image"} / ${categoryLabels[result.category] || "Commerce"}`;
    const status = document.createElement("span");
    status.className = "pixels-result-status";
    status.textContent = resultStatus(result);
    meta.append(descriptor, status);
    body.appendChild(meta);
    const actions = document.createElement("div");
    actions.className = "pixels-result-actions";
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.classList.toggle("is-favorite", result.favorite === true);
    favorite.textContent = result.favorite ? "Favorited" : "Favorite";
    favorite.addEventListener("click", () => {
      result.favorite = !result.favorite;
      persistHistory();
      renderResults();
    });
    actions.appendChild(favorite);
    if (result.status === "failed") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => retryResult(result));
      actions.appendChild(retry);
    }
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function render() {
    $$('[data-category]').forEach((button) => {
      const active = button.dataset.category === state.category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$('[data-mode]').forEach((button) => {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$('[data-nav]').forEach((button) => button.classList.toggle("is-active", button.dataset.nav === state.nav));
    const prompt = $("#pixels-prompt");
    if (prompt && prompt.value !== state.prompt) prompt.value = state.prompt;
    renderModelOptions();
    const model = $("#pixels-model");
    const style = $("#pixels-style");
    const ratio = $("#pixels-ratio");
    const duration = $("#pixels-duration");
    if (model && model.value !== state.model) model.value = state.model;
    if (style && style.value !== state.style) style.value = state.style;
    if (ratio && ratio.value !== state.ratio) ratio.value = state.ratio;
    if (duration && Number(duration.value) !== state.duration) duration.value = String(state.duration);
    $("#pixels-duration-value").textContent = `${state.duration}s`;
    $("#pixels-batch").textContent = String(state.batch);
    $("#pixelsCreditLabel").textContent = `${state.batch} generation${state.batch > 1 ? "s" : ""} / ${state.mode === "video" ? "29.8" : "3.6"} credits`;
    $(".pixels-duration")?.classList.toggle("hidden", state.mode !== "video");
    const hasInput = Boolean(state.prompt.trim() || references().length);
    $("#pixelsStatus").textContent = state.generating ? "Generating campaign..." : references().length ? `${references().length} reference${references().length > 1 ? "s" : ""} ready` : hasInput ? "Ready to generate" : "Add a product image or describe your product";
    const generate = $("#pixels-generate");
    generate.disabled = state.generating || !hasInput;
    generate.setAttribute("aria-busy", state.generating ? "true" : "false");
    generate.innerHTML = state.generating ? "Generating <span aria-hidden=\"true\">...</span>" : "Generate campaign <span aria-hidden=\"true\">-></span>";
    renderSlots();
    renderResults();
  }

  async function uploadFiles(fileList) {
    const files = [...(fileList || [])].filter((file) => IMAGE_TYPES.test(file.type) && file.size <= MAX_IMAGE_BYTES);
    if (!files.length) {
      toast("请选择 8MB 以内的 PNG、JPG 或 WebP 图片");
      return;
    }
    const slots = [state.activeSlot, ...Object.keys(state.slots).filter((slot) => slot !== state.activeSlot)];
    for (const [index, file] of files.slice(0, 3).entries()) {
      const slot = slots[index];
      $("#pixelsUploadStatus").textContent = `Uploading ${file.name}...`;
      try {
        const preview = await readFileAsDataUrl(file);
        const data = await requestJson("/api/canvas/public-assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, dataUrl: preview }),
        });
        const uploaded = data.result || {};
        state.slots[slot] = { name: file.name, url: uploaded.url || uploaded.localUrl, preview, localUrl: uploaded.localUrl || "" };
        $("#pixelsUploadStatus").textContent = uploaded.publicReady === false ? `${file.name} stored locally` : `${file.name} ready`;
      } catch (error) {
        $("#pixelsUploadStatus").textContent = "Upload failed";
        handleRequestError(error);
        break;
      }
    }
    setSaveState("Reference updated");
    render();
  }

  function makeResult(index) {
    return {
      id: `pixels-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      kind: state.mode,
      status: "submitting",
      taskId: "",
      provider: "",
      url: "",
      prompt: campaignPrompt(),
      category: state.category,
      ratio: state.ratio,
      duration: state.duration,
      model: state.model,
      style: state.style,
      createdAt: new Date().toISOString(),
      favorite: false,
      message: "Submitting generation task",
    };
  }

  function updateResult(result, patch) {
    Object.assign(result, patch);
    persistHistory();
    renderResults();
  }

  async function submitImage(result) {
    try {
      const data = await requestJson("/api/canvas/image-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: result.prompt,
          imageModel: result.model,
          ratio: result.ratio,
          resolution: "1k",
          referenceImages: references().map((image) => image.url),
        }),
      });
      const payload = data.result || {};
      if (payload.status === "completed" && payload.url) {
        updateResult(result, { status: "completed", url: payload.url, message: "Generation complete" });
        return;
      }
      if (!payload.taskId) throw new Error(payload.message || "图片接口没有返回 taskId");
      updateResult(result, { status: "running", taskId: payload.taskId, message: "Image generation in progress" });
      await pollImage(result);
    } catch (error) {
      updateResult(result, { status: "failed", message: error.message || "Image generation failed" });
      handleRequestError(error, { quiet: error?.status === 401 });
    }
  }

  async function submitVideo(result) {
    try {
      const data = await requestJson("/api/canvas/video-generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: result.prompt,
          videoModel: result.model,
          duration: result.duration,
          ratio: result.ratio,
          assets: references().map((image, index) => ({
            id: `pixels-reference-${index + 1}`,
            name: image.name || `Reference ${index + 1}`,
            type: "Image",
            url: image.url,
            previewUrl: image.preview || image.url,
          })),
          referenceImages: references().map((image) => image.url),
        }),
      });
      const payload = data.result || {};
      if (payload.videoUrl || (payload.status === "completed" && payload.url)) {
        updateResult(result, { status: "completed", url: payload.videoUrl || payload.url, provider: payload.provider || "", message: "Generation complete" });
        return;
      }
      if (!payload.taskId) throw new Error(payload.message || "视频接口没有返回 taskId");
      updateResult(result, { status: "running", taskId: payload.taskId, provider: payload.provider || "", message: "Video generation in progress" });
      await pollVideo(result);
    } catch (error) {
      updateResult(result, { status: "failed", message: error.message || "Video generation failed" });
      handleRequestError(error, { quiet: error?.status === 401 });
    }
  }

  async function pollImage(result) {
    if (!result.taskId || polls.has(result.id)) return;
    polls.set(result.id, true);
    try {
      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        const data = await requestJson(`/api/canvas/image-generations/${encodeURIComponent(result.taskId)}`);
        const payload = data.result || {};
        const status = String(payload.status || "").toLowerCase();
        if (status === "completed" && payload.url) {
          updateResult(result, { status: "completed", url: payload.url, message: "Generation complete" });
          return;
        }
        if (status === "failed") {
          updateResult(result, { status: "failed", message: payload.message || "Image generation failed" });
          return;
        }
      }
      updateResult(result, { status: "failed", message: "Generation timed out. Try again." });
    } catch (error) {
      updateResult(result, { status: "failed", message: error.message || "Image status unavailable" });
      handleRequestError(error, { quiet: error?.status === 401 });
    } finally {
      polls.delete(result.id);
    }
  }

  async function pollVideo(result) {
    if (!result.taskId || polls.has(result.id)) return;
    polls.set(result.id, true);
    try {
      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        const query = result.provider ? `?provider=${encodeURIComponent(result.provider)}` : "";
        const data = await requestJson(`/api/canvas/video-generations/${encodeURIComponent(result.taskId)}${query}`);
        const payload = data.result || {};
        const status = String(payload.status || "").toLowerCase();
        if ((status === "completed" || payload.videoUrl) && (payload.videoUrl || payload.url)) {
          updateResult(result, { status: "completed", url: payload.videoUrl || payload.url, message: "Generation complete" });
          return;
        }
        if (status === "failed") {
          updateResult(result, { status: "failed", message: payload.message || "Video generation failed" });
          return;
        }
      }
      updateResult(result, { status: "failed", message: "Generation timed out. Try again." });
    } catch (error) {
      updateResult(result, { status: "failed", message: error.message || "Video status unavailable" });
      handleRequestError(error, { quiet: error?.status === 401 });
    } finally {
      polls.delete(result.id);
    }
  }

  async function submitCampaign() {
    if (state.generating) return;
    if (!state.prompt.trim() && !references().length) {
      toast("先添加商品图片或写下商品广告描述");
      return;
    }
    state.generating = true;
    const results = Array.from({ length: state.batch }, (_, index) => makeResult(index));
    state.results.unshift(...results);
    persistHistory();
    render();
    setSaveState("Generating campaign");
    await Promise.all(results.map((result) => (state.mode === "video" ? submitVideo(result) : submitImage(result))));
    state.generating = false;
    setSaveState("All changes saved");
    render();
  }

  async function retryResult(result) {
    if (polls.has(result.id)) return;
    updateResult(result, { status: "submitting", message: "Submitting generation task", taskId: "", url: "" });
    if (result.kind === "video") await submitVideo(result);
    else await submitImage(result);
  }

  async function loadAssets() {
    const list = $("#pixelsAssetList");
    if (!list) return;
    list.innerHTML = '<div class="pixels-assets-empty">Loading assets...</div>';
    try {
      const data = await requestJson("/api/asset-library?limit=100");
      state.assets = Array.isArray(data.assets) ? data.assets : [];
      renderAssets();
    } catch (error) {
      list.innerHTML = '<div class="pixels-assets-empty">Log in to view your asset library.</div>';
      handleRequestError(error, { quiet: true });
    }
  }

  function renderAssets() {
    const list = $("#pixelsAssetList");
    if (!list) return;
    const search = state.assetSearch.trim().toLowerCase();
    const assets = state.assets.filter((asset) => !search || `${asset.name || ""} ${asset.prompt || ""}`.toLowerCase().includes(search));
    list.textContent = "";
    if (!assets.length) {
      list.innerHTML = '<div class="pixels-assets-empty">No assets found. Upload a product image to start.</div>';
      return;
    }
    for (const asset of assets) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pixels-asset-card";
      const image = document.createElement("img");
      image.src = asset.previewUrl || asset.preview || asset.url || asset.localUrl || "";
      image.alt = asset.name || "Asset";
      image.loading = "lazy";
      const name = document.createElement("strong");
      name.textContent = asset.name || "Untitled asset";
      button.append(image, name);
      button.addEventListener("click", () => {
        const url = asset.url || asset.publicUrl || asset.localUrl || asset.previewUrl;
        if (!url) return toast("这个素材还没有可用图片地址");
        state.slots[state.activeSlot] = { name: asset.name || "Library asset", url, preview: asset.previewUrl || asset.preview || url };
        closeAssets();
        setSaveState("Reference updated");
        render();
      });
      list.appendChild(button);
    }
  }

  function openAssets() {
    $("#pixelsAssetsPanel")?.classList.remove("hidden");
    state.nav = "assets";
    render();
    if (!state.assets.length) loadAssets();
  }

  function closeAssets() {
    $("#pixelsAssetsPanel")?.classList.add("hidden");
    if (state.nav === "assets") state.nav = "home";
    render();
  }

  function resetProject() {
    state.category = "product-shot";
    state.mode = "image";
    state.prompt = "";
    state.model = "gpt-image-2";
    state.style = "closeup";
    state.ratio = "3:4";
    state.duration = 5;
    state.batch = 1;
    state.activeSlot = "product";
    state.nav = "home";
    state.slots = { product: null, avatar: null, reference: null };
    setSaveState("New project");
    closeAssets();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function bind() {
    $("#pixels-prompt")?.addEventListener("input", (event) => {
      state.prompt = event.target.value;
      render();
    });
    $("#pixelsComposer")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCampaign().catch((error) => handleRequestError(error));
    });
    $$('[data-category]').forEach((button) => button.addEventListener("click", () => {
      state.category = button.dataset.category;
      render();
    }));
    $$('[data-mode]').forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
    $("#pixels-model")?.addEventListener("change", (event) => { state.model = event.target.value; render(); });
    $("#pixels-style")?.addEventListener("change", (event) => { state.style = event.target.value; render(); });
    $("#pixels-ratio")?.addEventListener("change", (event) => { state.ratio = event.target.value; render(); });
    $("#pixels-duration")?.addEventListener("input", (event) => { state.duration = Number(event.target.value) || 5; render(); });
    $("#pixels-batch-down")?.addEventListener("click", () => { state.batch = Math.max(1, state.batch - 1); render(); });
    $("#pixels-batch-up")?.addEventListener("click", () => { state.batch = Math.min(4, state.batch + 1); render(); });
    const upload = $("#pixels-upload");
    $("#pixelsReferenceButton")?.addEventListener("click", () => { state.activeSlot = "reference"; upload?.click(); });
    upload?.addEventListener("change", async (event) => { await uploadFiles(event.target.files); event.target.value = ""; });
    $$('[data-slot]').forEach((button) => button.addEventListener("click", () => { state.activeSlot = button.dataset.slot; upload?.click(); }));
    $$('[data-template]').forEach((button) => button.addEventListener("click", () => {
      state.category = button.dataset.template || "product-shot";
      state.prompt = button.dataset.templatePrompt || "";
      state.style = button.dataset.templateStyle || state.style;
      render();
      $("#pixels-prompt")?.focus();
    }));
    $$('[data-nav]').forEach((button) => button.addEventListener("click", () => {
      const nav = button.dataset.nav;
      if (nav === "new-project") return resetProject();
      state.nav = nav;
      if (nav === "assets") openAssets();
      else {
        closeAssets();
        if (nav === "projects") toast("Projects workspace is coming next");
        else $("#pixelsResultsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
        render();
      }
    }));
    $("[data-clear-results]")?.addEventListener("click", () => {
      state.results = [];
      persistHistory();
      renderResults();
    });
    $("[data-view-all]")?.addEventListener("click", () => toast("更多电商模板正在整理中"));
    $("[data-command]")?.addEventListener("click", () => $("#pixels-prompt")?.focus());
    $("[data-close-assets]")?.addEventListener("click", closeAssets);
    $("[data-refresh-assets]")?.addEventListener("click", loadAssets);
    $("#pixelsAssetSearch")?.addEventListener("input", (event) => { state.assetSearch = event.target.value; renderAssets(); });
    $("[data-mobile-menu]")?.addEventListener("click", (event) => {
      const sidebar = $("#pixelsSidebar");
      const open = sidebar.classList.toggle("is-open");
      event.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
    });
    window.addEventListener("pagehide", persistHistory);
    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#pixels-prompt")?.focus();
      }
    });
    render();
    state.results.filter((result) => result.status === "running" && result.taskId).forEach((result) => {
      (result.kind === "video" ? pollVideo(result) : pollImage(result)).catch(() => {});
    });
  }

  bind();
})();
