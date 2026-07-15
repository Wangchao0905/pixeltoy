const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setMessage(text = "", error = false) {
  const node = $("#adminMessage");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("is-error", !!error);
}

function compactDate(value = "") {
  if (!value) return "-";
  return String(value).replace("T", " ").replace(/\.\d+Z$/, "");
}

function renderSummary(summary = {}) {
  $("#adminSummary").innerHTML = [
    ["用户", summary.usersTotal || 0],
    ["停用用户", summary.usersDisabled || 0],
    ["邀请码", `${summary.invitesUsed || 0}/${summary.invitesTotal || 0}`],
    ["今日视频", summary.todayVideoTasks || 0],
    ["运行中", summary.runningVideoTasks || 0],
    ["默认额度", `${summary.defaultDailyVideoLimit || 0}/天 · ${summary.defaultConcurrentVideoLimit || 0} 并发`],
  ]
    .map(([label, value]) => `<div class="admin-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function renderUsers(users = []) {
  $("#adminUsers").innerHTML = users
    .map((user) => {
      const usage = user.usage || {};
      return `
        <tr>
          <td>
            <strong>${escapeHtml(user.displayName || user.username)}</strong>
            <span>${escapeHtml(user.username)} · ${escapeHtml(user.inviteCode || "无邀请码记录")}</span>
          </td>
          <td><span class="admin-pill ${user.role === "admin" ? "is-admin" : ""}">${user.role === "admin" ? "管理员" : "用户"}</span></td>
          <td><span class="admin-pill ${user.disabled ? "is-disabled" : "is-ok"}">${user.disabled ? "停用" : "可用"}</span></td>
          <td><span class="admin-pill ${user.canvasEnabled ? "is-ok" : "is-disabled"}">${user.canvasEnabled ? "已开启" : "已关闭"}</span></td>
          <td>${Number(usage.todayVideoTasks || 0)}/${Number(usage.dailyVideoLimit || 0)}</td>
          <td>${Number(usage.runningVideoTasks || 0)}/${Number(usage.concurrentVideoLimit || 0)}</td>
          <td><input class="admin-quota-input" data-limit="dailyVideoLimit" data-user="${escapeHtml(user.id)}" type="number" min="0" value="${Number(usage.dailyVideoLimit || 0)}" /></td>
          <td><input class="admin-quota-input" data-limit="concurrentVideoLimit" data-user="${escapeHtml(user.id)}" type="number" min="0" value="${Number(usage.concurrentVideoLimit || 0)}" /></td>
          <td class="admin-row-actions">
            <button type="button" data-action="toggle-disabled" data-user="${escapeHtml(user.id)}">${user.disabled ? "启用" : "停用"}</button>
            ${user.role === "admin" ? "" : `<button type="button" data-action="toggle-canvas" data-user="${escapeHtml(user.id)}" data-enabled="${user.canvasEnabled ? "1" : "0"}">${user.canvasEnabled ? "关闭画布" : "开启画布"}</button>`}
            <button type="button" data-action="save-limits" data-user="${escapeHtml(user.id)}">保存额度</button>
            <button type="button" data-action="reset-password" data-user="${escapeHtml(user.id)}">重置密码</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderInvites(invites = []) {
  $("#adminInvites").innerHTML =
    invites
      .map(
        (invite) => `
          <div class="admin-list-item">
            <div>
              <strong>${escapeHtml(invite.code)}</strong>
              <span>已使用 ${Number(invite.usedCount || 0)} 次${invite.usedBy?.length ? ` · ${escapeHtml(invite.usedBy.map((user) => user.username).join(", "))}` : ""}</span>
            </div>
            <button type="button" data-action="delete-invite" data-code="${escapeHtml(invite.code)}">删除</button>
          </div>
        `,
      )
      .join("") || `<div class="admin-empty">暂无邀请码</div>`;
}

function renderApiStatus(apiStatus = []) {
  $("#adminApiStatus").innerHTML = apiStatus
    .map(
      (item) => `
        <div class="admin-list-item">
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.id)}</span>
          </div>
          <span class="admin-pill ${item.configured ? "is-ok" : "is-disabled"}">${item.configured ? "已配置" : "缺失"}</span>
        </div>
      `,
    )
    .join("");
}

function renderUsage(usage = []) {
  $("#adminUsage").innerHTML =
    usage
      .map((entry) => {
        const lastTask = entry.lastTask
          ? `${entry.lastTask.kind || "video"} ${entry.lastTask.provider || ""} ${entry.lastTask.taskId || ""}`.trim()
          : "-";
        return `
          <tr>
            <td>${escapeHtml(entry.day)}</td>
            <td>
              <strong>${escapeHtml(entry.displayName || entry.username)}</strong>
              <span>${escapeHtml(entry.username || entry.userId)}</span>
            </td>
            <td>${Number(entry.videoTasks || 0)}</td>
            <td>${Number(entry.activeVideoTasks || 0)}</td>
            <td>
              <span>${escapeHtml(lastTask)}</span>
              <small>${escapeHtml(compactDate(entry.updatedAt))}</small>
            </td>
          </tr>
        `;
      })
      .join("") || `<tr><td colspan="5">暂无用量记录</td></tr>`;
}

async function loadAdmin() {
  setMessage("正在读取后台数据...");
  const [summary, users, invites, apiStatus, usage] = await Promise.all([
    api("/api/admin/summary"),
    api("/api/admin/users"),
    api("/api/admin/invites"),
    api("/api/admin/api-status"),
    api("/api/admin/usage"),
  ]);
  renderSummary(summary.summary);
  renderUsers(users.users);
  renderInvites(invites.invites);
  renderApiStatus(apiStatus.apiStatus);
  renderUsage(usage.usage);
  setMessage(`已刷新：${new Date().toLocaleTimeString()}`);
}

function userLimitPayload(userId) {
  const inputs = [...document.querySelectorAll(`.admin-quota-input[data-user="${CSS.escape(userId)}"]`)];
  return Object.fromEntries(inputs.map((input) => [input.dataset.limit, Number(input.value || 0)]));
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    if (button.id === "adminRefresh") {
      await loadAdmin();
      return;
    }
    if (button.id === "createInvite") {
      const result = await api("/api/admin/invites", { method: "POST", body: JSON.stringify({}) });
      renderInvites(result.invites);
      setMessage(`已生成邀请码：${result.invite?.code || ""}`);
      return;
    }
    const action = button.dataset.action;
    if (action === "delete-invite") {
      const code = button.dataset.code || "";
      const result = await api(`/api/admin/invites/${encodeURIComponent(code)}`, { method: "DELETE" });
      renderInvites(result.invites);
      setMessage(`已删除邀请码：${code}`);
      return;
    }
    if (action === "toggle-disabled") {
      const userId = button.dataset.user || "";
      const isDisabled = button.textContent.includes("启用");
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "POST",
        body: JSON.stringify({ disabled: !isDisabled }),
      });
      await loadAdmin();
      return;
    }
    if (action === "toggle-canvas") {
      const userId = button.dataset.user || "";
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "POST",
        body: JSON.stringify({ canvasEnabled: button.dataset.enabled !== "1" }),
      });
      await loadAdmin();
      return;
    }
    if (action === "save-limits") {
      const userId = button.dataset.user || "";
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "POST",
        body: JSON.stringify(userLimitPayload(userId)),
      });
      await loadAdmin();
      return;
    }
    if (action === "reset-password") {
      const userId = button.dataset.user || "";
      const password = window.prompt("输入新密码，至少 8 位");
      if (!password) return;
      if (password.length < 8) throw new Error("新密码至少 8 位");
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setMessage("密码已重置");
      return;
    }
  } catch (error) {
    setMessage(error.message, true);
  }
});

loadAdmin().catch((error) => setMessage(error.message, true));
