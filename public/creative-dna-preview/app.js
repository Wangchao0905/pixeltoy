const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function toast(message) {
  const node = $("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("is-visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("is-visible"), 1800);
}

function setDnaTab(tab) {
  $$("[data-dna-tab]").forEach((button) => {
    const active = button.dataset.dnaTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$("[data-dna-content]").forEach((content) => content.classList.toggle("is-hidden", content.dataset.dnaContent !== tab));
  $("#dnaTabNote").textContent = tab === "visual" ? "点击标签即可加入 DNA" : tab === "story" ? "把不可变的剧情规则写进 DNA" : "控制每集的节拍和留白";
}

function updateHealth() {
  const count = $$(".dna-chip.is-selected").length;
  const value = Math.min(96, 56 + count * 8);
  $("#dnaHealthValue").textContent = `${value}%`;
  $("#dnaHealthBar").style.transform = `scaleX(${value / 100})`;
}

$(".studio-shell").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-dna-tab]");
  if (tab) setDnaTab(tab.dataset.dnaTab);

  const chip = event.target.closest("[data-dna-chip]");
  if (chip && !chip.classList.contains("add-chip")) {
    chip.classList.toggle("is-selected");
    chip.querySelector("b")?.remove();
    if (chip.classList.contains("is-selected")) chip.insertAdjacentHTML("beforeend", " <b aria-hidden=\"true\">✓</b>");
    updateHealth();
  }

  const action = event.target.closest("[data-toast]");
  if (action) toast(action.dataset.toast);
});

$("#episodeRange").addEventListener("input", (event) => { $("#episodeCount").textContent = `${event.target.value} 集`; });
$("#durationRange").addEventListener("input", (event) => { $("#episodeDuration").textContent = `${event.target.value} 秒`; });
$("#openingRange").addEventListener("input", (event) => { $("#openingWindow").textContent = `0–${event.target.value}s`; });
