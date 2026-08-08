/* ============================================================
 * Pixel Writer — PixelTale 页面独立挂载脚本
 * ------------------------------------------------------------
 * 作用：在现有 Story Forge 页面上注入一个"Pixel Writer" tab，
 *       点击后在内容区以 iframe 加载独立的编剧流水线工作台。
 *
 * 设计原则（不破坏现有系统）：
 *   - 不改动现有 app.js 任何逻辑
 *   - 不改动现有 DOM 结构（只在 topbar 追加 tab 按钮）
 *   - 用 IIFE 隔离作用域，不污染全局
 *   - iframe 全屏覆盖内容区，切回时自动隐藏，不影响原流程状态
 * ============================================================ */
(function () {
  "use strict";

  // Local development keeps the standalone service address. Production uses a
  // same-origin proxy so remote visitors never try to reach their own 127.0.0.1.
  var SW_URL = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname)
    ? "http://127.0.0.1:8877"
    : "/pixel-writer/";
  var TAB_LABEL = "Pixel Writer";
  var TAB_SUB = "SCRIPT STUDIO";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") node.className = attrs[key];
        else if (key === "text") node.textContent = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  var active = false;
  var iframe = null;
  var overlay = null;
  var tabBtn = null;

  function injectTab() {
    var topActions = document.querySelector(".top-actions");
    if (!topActions || topActions.querySelector("[data-sw-pipeline-tab]")) return !!tabBtn;

    tabBtn = el("button", {
      type: "button",
      class: "sw-tab-btn",
      "data-sw-pipeline-tab": "true",
      title: "Pixel Writer",
    }, [
      el("span", { class: "sw-tab-mark", text: "✦", "aria-hidden": "true" }),
      el("span", { class: "sw-tab-label", text: TAB_LABEL }),
    ]);

    var segmented = topActions.querySelector(".segmented");
    if (segmented && segmented.parentNode === topActions) topActions.insertBefore(tabBtn, segmented.nextSibling);
    else topActions.appendChild(tabBtn);
    tabBtn.addEventListener("click", toggle);
    return true;
  }

  function injectOverlay() {
    if (document.getElementById("sw-pipeline-overlay")) return true;
    overlay = el("div", { class: "sw-overlay", id: "sw-pipeline-overlay" });
    overlay.style.display = "none";

    var header = el("div", { class: "sw-overlay-head" }, [
      el("span", { class: "sw-overlay-title", text: "Pixel Writer 编剧工作台" }),
      el("button", {
        type: "button",
        class: "sw-overlay-close",
        title: "返回 Story Forge",
        "aria-label": "关闭 Pixel Writer",
      }, ["✕ 返回"]),
    ]);
    header.querySelector(".sw-overlay-close").addEventListener("click", toggle);

    iframe = el("iframe", {
      src: SW_URL,
      class: "sw-overlay-frame",
      frameborder: "0",
      allow: "clipboard-write",
      title: "Pixel Writer 编剧工作台",
    });
    overlay.appendChild(header);
    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
    return true;
  }

  function toggle() {
    active = !active;
    if (active) {
      overlay.style.display = "flex";
      tabBtn.classList.add("is-active");
      iframe.src = SW_URL;
    } else {
      overlay.style.display = "none";
      tabBtn.classList.remove("is-active");
    }
    try { localStorage.setItem("sw.activePipeline", active ? "1" : ""); } catch (e) {}
  }

  function restoreActiveTab() {
    // 刷新后恢复 Pixel Writer tab：上次打开过则直接激活，避免每次跳回 Story Forge。
    if (active || !iframe || !tabBtn) return;
    try {
      if (localStorage.getItem("sw.activePipeline") !== "1") return;
    } catch (e) { return; }
    active = true;
    overlay.style.display = "flex";
    tabBtn.classList.add("is-active");
    iframe.src = SW_URL;
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }
    injectOverlay();
    if (!injectTab()) {
      var tries = 0;
      var timer = setInterval(function () {
        tries += 1;
        if (injectTab() || tries > 20) {
          clearInterval(timer);
          restoreActiveTab();
        }
      }, 300);
    }
    var css = document.createElement("style");
    css.textContent = SW_CSS;
    document.head.appendChild(css);
    restoreActiveTab();
  }

  var SW_CSS = [
    ".sw-tab-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:0 13px; margin-left:4px; border:1px solid #b9df72; border-radius:9px; color:#426216; background:#f1fbdc; box-shadow:0 2px 7px rgba(83,121,22,.14); font-size:12px; font-weight:750; white-space:nowrap; cursor:pointer; transition:background .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease; }",
    ".sw-tab-btn:hover { border-color:#80b72b; background:#e6f8c3; box-shadow:0 4px 10px rgba(83,121,22,.18); transform:translateY(-1px); }",
    ".sw-tab-btn:focus-visible { outline:2px solid #5e9cf5; outline-offset:2px; }",
    ".sw-tab-btn.is-active { border-color:#598b19; color:#fff; background:#6fa51d; box-shadow:0 3px 9px rgba(70,111,15,.24); }",
    ".sw-tab-mark { color:currentColor; font-size:13px; line-height:1; }",
    ".sw-tab-label { letter-spacing:-.01em; }",
    ".sw-overlay { position:fixed; inset:0; z-index:9999; background:#0d1117; flex-direction:column; }",
    ".sw-overlay-head { display:flex; align-items:center; gap:14px; padding:10px 18px; background:#131a24; border-bottom:1px solid #232e3d; flex-shrink:0; }",
    ".sw-overlay-title { font-weight:700; font-size:13px; color:#dce4ee; letter-spacing:.5px; }",
    ".sw-overlay-note { color:#8b98a9; font-size:11px; flex:1; }",
    ".sw-overlay-close { min-height:28px; border:1px solid #232e3d; border-radius:6px; padding:0 12px; color:#dce4ee; background:#1b2431; font-size:11px; font-weight:600; cursor:pointer; }",
    ".sw-overlay-close:hover { border-color:#e05d5d; color:#e05d5d; }",
    ".sw-overlay-frame { flex:1; width:100%; border:0; background:#0d1117; }",
  ].join("\n");

  init();
})();
