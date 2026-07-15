import React, { useEffect, useState } from "react";

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

function compactDate(value = "") {
  if (!value) return "-";
  return String(value).replace("T", " ").replace(/\.\d+Z$/, "");
}

function Summary({ summary }) {
  const rows = [
    ["用户", summary.usersTotal || 0],
    ["停用用户", summary.usersDisabled || 0],
    ["邀请码", `${summary.invitesUsed || 0}/${summary.invitesTotal || 0}`],
    ["今日视频", summary.todayVideoTasks || 0],
    ["运行中", summary.runningVideoTasks || 0],
    ["默认额度", `${summary.defaultDailyVideoLimit || 0}/天 · ${summary.defaultConcurrentVideoLimit || 0} 并发`],
  ];
  return (
    <section className="admin-summary" aria-label="概览">
      {rows.map(([label, value]) => (
        <div className="admin-stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function UsersTable({ users, onAction, onLimitChange }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>用户</th>
          <th>角色</th>
          <th>状态</th>
          <th>画布</th>
          <th>今日</th>
          <th>运行中</th>
          <th>每日额度</th>
          <th>并发额度</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => {
          const usage = user.usage || {};
          return (
            <tr key={user.id}>
              <td>
                <strong>{user.displayName || user.username}</strong>
                <span>
                  {user.username} · {user.inviteCode || "无邀请码记录"}
                </span>
              </td>
              <td>
                <span className={`admin-pill ${user.role === "admin" ? "is-admin" : ""}`}>{user.role === "admin" ? "管理员" : "用户"}</span>
              </td>
              <td>
                <span className={`admin-pill ${user.disabled ? "is-disabled" : "is-ok"}`}>{user.disabled ? "停用" : "可用"}</span>
              </td>
              <td>
                <span className={`admin-pill ${user.canvasEnabled ? "is-ok" : "is-disabled"}`}>{user.canvasEnabled ? "已开启" : "已关闭"}</span>
              </td>
              <td>
                {Number(usage.todayVideoTasks || 0)}/{Number(usage.dailyVideoLimit || 0)}
              </td>
              <td>
                {Number(usage.runningVideoTasks || 0)}/{Number(usage.concurrentVideoLimit || 0)}
              </td>
              <td>
                <input
                  className="admin-quota-input"
                  min="0"
                  type="number"
                  value={Number(usage.dailyVideoLimit || 0)}
                  onChange={(event) => onLimitChange(user.id, "dailyVideoLimit", event.target.value)}
                />
              </td>
              <td>
                <input
                  className="admin-quota-input"
                  min="0"
                  type="number"
                  value={Number(usage.concurrentVideoLimit || 0)}
                  onChange={(event) => onLimitChange(user.id, "concurrentVideoLimit", event.target.value)}
                />
              </td>
              <td className="admin-row-actions">
                <button type="button" onClick={() => onAction("toggle-disabled", user)}>
                  {user.disabled ? "启用" : "停用"}
                </button>
                {user.role === "admin" ? null : (
                  <button type="button" onClick={() => onAction("toggle-canvas", user)}>
                    {user.canvasEnabled ? "关闭画布" : "开启画布"}
                  </button>
                )}
                <button type="button" onClick={() => onAction("save-limits", user)}>
                  保存额度
                </button>
                <button type="button" onClick={() => onAction("reset-password", user)}>
                  重置密码
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Invites({ invites, onCreate, onDelete }) {
  return (
    <article className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <span className="section-label">Invites</span>
          <h2>邀请码</h2>
        </div>
        <button className="primary" type="button" onClick={onCreate}>
          生成
        </button>
      </div>
      <div className="admin-list">
        {invites.length ? (
          invites.map((invite) => (
            <div className="admin-list-item" key={invite.code}>
              <div>
                <strong>{invite.code}</strong>
                <span>
                  已使用 {Number(invite.usedCount || 0)} 次{invite.usedBy?.length ? ` · ${invite.usedBy.map((user) => user.username).join(", ")}` : ""}
                </span>
              </div>
              <button type="button" onClick={() => onDelete(invite.code)}>
                删除
              </button>
            </div>
          ))
        ) : (
          <div className="admin-empty">暂无邀请码</div>
        )}
      </div>
    </article>
  );
}

function ApiStatus({ apiStatus }) {
  return (
    <article className="admin-panel">
      <div className="admin-panel-head">
        <div>
          <span className="section-label">API</span>
          <h2>接口状态</h2>
        </div>
      </div>
      <div className="admin-list">
        {apiStatus.map((item) => (
          <div className="admin-list-item" key={item.id}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.id}</span>
            </div>
            <span className={`admin-pill ${item.configured ? "is-ok" : "is-disabled"}`}>{item.configured ? "已配置" : "缺失"}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function UsageTable({ usage }) {
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>日期</th>
          <th>用户</th>
          <th>视频任务</th>
          <th>运行中</th>
          <th>最后任务</th>
        </tr>
      </thead>
      <tbody>
        {usage.length ? (
          usage.map((entry) => {
            const lastTask = entry.lastTask ? `${entry.lastTask.kind || "video"} ${entry.lastTask.provider || ""} ${entry.lastTask.taskId || ""}`.trim() : "-";
            return (
              <tr key={`${entry.day}-${entry.userId}`}>
                <td>{entry.day}</td>
                <td>
                  <strong>{entry.displayName || entry.username}</strong>
                  <span>{entry.username || entry.userId}</span>
                </td>
                <td>{Number(entry.videoTasks || 0)}</td>
                <td>{Number(entry.activeVideoTasks || 0)}</td>
                <td>
                  <span>{lastTask}</span>
                  <small>{compactDate(entry.updatedAt)}</small>
                </td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan="5">暂无用量记录</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function AdminApp() {
  const [summary, setSummary] = useState({});
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [apiStatus, setApiStatus] = useState([]);
  const [usage, setUsage] = useState([]);
  const [message, setMessage] = useState({ text: "正在读取后台数据...", error: false });

  async function loadAdmin() {
    setMessage({ text: "正在读取后台数据...", error: false });
    const [summaryData, usersData, invitesData, apiStatusData, usageData] = await Promise.all([
      api("/api/admin/summary"),
      api("/api/admin/users"),
      api("/api/admin/invites"),
      api("/api/admin/api-status"),
      api("/api/admin/usage"),
    ]);
    setSummary(summaryData.summary || {});
    setUsers(usersData.users || []);
    setInvites(invitesData.invites || []);
    setApiStatus(apiStatusData.apiStatus || []);
    setUsage(usageData.usage || []);
    setMessage({ text: `已刷新：${new Date().toLocaleTimeString()}`, error: false });
  }

  useEffect(() => {
    loadAdmin().catch((error) => setMessage({ text: error.message, error: true }));
  }, []);

  function updateUserUsage(userId, key, value) {
    setUsers((items) =>
      items.map((user) =>
        user.id === userId
          ? {
              ...user,
              usage: {
                ...(user.usage || {}),
                [key]: Number(value || 0),
              },
            }
          : user,
      ),
    );
  }

  async function handleUserAction(action, user) {
    try {
      if (action === "toggle-disabled") {
        await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          method: "POST",
          body: JSON.stringify({ disabled: !user.disabled }),
        });
        await loadAdmin();
        return;
      }
      if (action === "toggle-canvas") {
        await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          method: "POST",
          body: JSON.stringify({ canvasEnabled: !user.canvasEnabled }),
        });
        await loadAdmin();
        return;
      }
      if (action === "save-limits") {
        await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          method: "POST",
          body: JSON.stringify({
            dailyVideoLimit: Number(user.usage?.dailyVideoLimit || 0),
            concurrentVideoLimit: Number(user.usage?.concurrentVideoLimit || 0),
          }),
        });
        await loadAdmin();
        return;
      }
      if (action === "reset-password") {
        const password = window.prompt("输入新密码，至少 8 位");
        if (!password) return;
        if (password.length < 8) throw new Error("新密码至少 8 位");
        await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        setMessage({ text: "密码已重置", error: false });
      }
    } catch (error) {
      setMessage({ text: error.message, error: true });
    }
  }

  async function createInvite() {
    try {
      const result = await api("/api/admin/invites", { method: "POST", body: JSON.stringify({}) });
      setInvites(result.invites || []);
      setMessage({ text: `已生成邀请码：${result.invite?.code || ""}`, error: false });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    }
  }

  async function deleteInvite(code) {
    try {
      const result = await api(`/api/admin/invites/${encodeURIComponent(code)}`, { method: "DELETE" });
      setInvites(result.invites || []);
      setMessage({ text: `已删除邀请码：${code}`, error: false });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div className="brand">
          <div className="mark pixel-toys-wordmark" aria-label="Pixel Toys"></div>
          <div>
            <strong>Pixel Toys Admin</strong>
            <span>用户、邀请码、额度、API 与用量</span>
          </div>
        </div>
        <div className="admin-actions">
          <a className="ghost admin-home-link" href="/">
            返回项目页
          </a>
          <button className="primary" type="button" onClick={() => loadAdmin().catch((error) => setMessage({ text: error.message, error: true }))}>
            刷新
          </button>
        </div>
      </header>

      <Summary summary={summary} />

      <section className="admin-grid">
        <article className="admin-panel admin-panel-wide">
          <div className="admin-panel-head">
            <div>
              <span className="section-label">Users</span>
              <h2>用户与额度</h2>
            </div>
          </div>
          <div className="admin-table-wrap">
            <UsersTable users={users} onAction={handleUserAction} onLimitChange={updateUserUsage} />
          </div>
        </article>

        <Invites invites={invites} onCreate={createInvite} onDelete={deleteInvite} />
        <ApiStatus apiStatus={apiStatus} />

        <article className="admin-panel admin-panel-wide">
          <div className="admin-panel-head">
            <div>
              <span className="section-label">Usage</span>
              <h2>用量统计</h2>
            </div>
          </div>
          <div className="admin-table-wrap">
            <UsageTable usage={usage} />
          </div>
        </article>
      </section>

      <p className={`admin-message ${message.error ? "is-error" : ""}`} aria-live="polite">
        {message.text}
      </p>
    </main>
  );
}
