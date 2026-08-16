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

function secondsLabel(value) {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? `${seconds}s` : "-";
}

function modelsLabel(models = []) {
  return Array.isArray(models) && models.length ? models.join("、") : "-";
}

function modelTokens(models = []) {
  return (Array.isArray(models) ? models : []).map((model) => String(model).replace(/\s+\(\d+\)$/, ""));
}

function initialsFor(user = {}) {
  const source = String(user.displayName || user.username || "?").trim();
  return source.slice(0, 2).toUpperCase();
}

function usageNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function Summary({ summary }) {
  const rows = [
    ["用户总数", summary.usersTotal || 0, "含管理员与普通用户"],
    ["今日任务", Number(summary.todayImageTasks || 0) + Number(summary.todayVideoTasks || 0), `生图 ${summary.todayImageTasks || 0} · 视频 ${summary.todayVideoTasks || 0}`],
    ["视频时长", secondsLabel(summary.todayVideoSeconds), "今日已完成时长"],
    ["运行中", summary.runningVideoTasks || 0, "当前视频任务"],
  ];
  return (
    <section className="admin-summary" aria-label="概览">
      {rows.map(([label, value, detail]) => (
        <div className="admin-stat" key={label}>
          <span className="admin-stat-label">{label}</span>
          <strong>{typeof value === "number" ? usageNumber(value) : value}</strong>
          <small>{detail}</small>
        </div>
      ))}
      <div className="admin-summary-rail">
        <div>
          <span>邀请码</span>
          <strong>{summary.invitesUsed || 0}<em> / {summary.invitesTotal || 0} 已使用</em></strong>
        </div>
        <div>
          <span>停用账号</span>
          <strong>{summary.usersDisabled || 0}<em> 个</em></strong>
        </div>
        <div>
          <span>默认视频额度</span>
          <strong>{summary.defaultDailyVideoLimit || 0}<em> 秒/天 · {summary.defaultConcurrentVideoLimit || 0} 并发</em></strong>
        </div>
      </div>
    </section>
  );
}

function UserRow({ user, onAction, onLimitChange }) {
  const usage = user.usage || {};
  const models = modelTokens(usage.models);
  const todayVideoTasks = Number(usage.todayVideoTasks || 0);
  const dailyVideoLimit = Number(usage.dailyVideoLimit || 0);
  const dailyProgress = dailyVideoLimit > 0 ? Math.min(100, Math.round((todayVideoTasks / dailyVideoLimit) * 100)) : 0;

  return (
    <article className={`admin-user-row ${user.disabled ? "is-disabled" : ""}`}>
      <div className="admin-user-identity">
        <div className="admin-avatar" aria-hidden="true">{initialsFor(user)}</div>
        <div className="admin-user-name">
          <strong title={user.displayName || user.username}>{user.displayName || user.username}</strong>
          <span>{user.username}</span>
          <small>{user.inviteCode ? `邀请码 ${user.inviteCode}` : "无邀请码记录"}</small>
        </div>
      </div>

      <div className="admin-user-status">
        <div className="admin-status-line">
          <span className={`admin-pill ${user.role === "admin" ? "is-admin" : ""}`}>{user.role === "admin" ? "管理员" : "普通用户"}</span>
          <span className={`admin-pill ${user.disabled ? "is-disabled" : "is-ok"}`}>
            <i aria-hidden="true" />{user.disabled ? "已停用" : "可用"}
          </span>
        </div>
        <span className={`admin-capability ${user.canvasEnabled ? "is-enabled" : ""}`}>
          <i aria-hidden="true" />画布 {user.canvasEnabled ? "已开启" : "未开启"}
        </span>
      </div>

      <div className="admin-user-usage">
        <div className="admin-usage-head">
          <strong>{usageNumber(usage.totalTasks)}</strong>
          <span>总任务</span>
        </div>
        <div className="admin-usage-breakdown">
          <span>生图 {usageNumber(usage.imageTasks)}</span>
          <span>视频 {usageNumber(usage.videoTasks)}</span>
          <span>{secondsLabel(usage.videoSeconds)}</span>
        </div>
        <div className="admin-models" title={modelsLabel(usage.models)}>
          {models.length ? models.slice(0, 2).map((model) => <span key={model}>{model}</span>) : <span>暂无模型记录</span>}
          {models.length > 2 ? <em>+{models.length - 2}</em> : null}
        </div>
      </div>

      <div className="admin-user-quota">
        <div className="admin-quota-heading">
          <span>视频额度</span>
          <strong>{todayVideoTasks} / {dailyVideoLimit || "不限"} 今日</strong>
        </div>
        <div className="admin-quota-meter" aria-hidden="true"><span style={{ width: `${dailyProgress}%` }} /></div>
        <div className="admin-quota-fields">
          <label>
            <span>每日秒数</span>
            <input
              className="admin-quota-input"
              min="0"
              type="number"
              value={dailyVideoLimit}
              onChange={(event) => onLimitChange(user.id, "dailyVideoLimit", event.target.value)}
            />
          </label>
          <label>
            <span>并发数</span>
            <input
              className="admin-quota-input"
              min="0"
              type="number"
              value={Number(usage.concurrentVideoLimit || 0)}
              onChange={(event) => onLimitChange(user.id, "concurrentVideoLimit", event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="admin-user-actions">
        <button className="is-primary" type="button" onClick={() => onAction("save-limits", user)}>保存额度</button>
        <button type="button" onClick={() => onAction("toggle-disabled", user)}>{user.disabled ? "启用账号" : "停用账号"}</button>
        {user.role === "admin" ? null : <button type="button" onClick={() => onAction("toggle-canvas", user)}>{user.canvasEnabled ? "关闭画布" : "开启画布"}</button>}
        <button className="is-quiet" type="button" onClick={() => onAction("reset-password", user)}>重置密码</button>
      </div>
    </article>
  );
}

function UsersPanel({ users, loading, query, filter, onQueryChange, onFilterChange, onAction, onLimitChange }) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = users.filter((user) => {
    const matchesQuery = !normalizedQuery || [user.displayName, user.username, user.inviteCode].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery));
    const matchesFilter = filter === "all"
      || (filter === "active" && !user.disabled)
      || (filter === "disabled" && user.disabled)
      || (filter === "admin" && user.role === "admin")
      || (filter === "canvas" && user.canvasEnabled);
    return matchesQuery && matchesFilter;
  });

  return (
    <article className="admin-panel admin-panel-wide admin-users-panel">
      <div className="admin-panel-head admin-users-head">
        <div>
          <span className="section-label">Accounts / Access</span>
          <h2>用户管理</h2>
          <p>控制账号状态、画布权限和视频额度。修改只在点击“保存额度”后生效。</p>
        </div>
        <div className="admin-users-count"><strong>{visibleUsers.length}</strong><span> / {users.length} 个账号</span></div>
      </div>
      <div className="admin-user-toolbar">
        <label className="admin-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索姓名、账号或邀请码" aria-label="搜索姓名、账号或邀请码" />
        </label>
        <label className="admin-filter">
          <span>筛选</span>
          <select value={filter} onChange={(event) => onFilterChange(event.target.value)} aria-label="筛选用户">
            <option value="all">全部账号</option>
            <option value="active">可用账号</option>
            <option value="disabled">已停用</option>
            <option value="admin">管理员</option>
            <option value="canvas">已开画布</option>
          </select>
        </label>
      </div>
      <div className="admin-user-list" aria-live="polite">
        {loading ? <div className="admin-empty admin-loading"><span className="admin-spinner" />正在读取账号</div> : null}
        {!loading && visibleUsers.length ? visibleUsers.map((user) => <UserRow key={user.id} user={user} onAction={onAction} onLimitChange={onLimitChange} />) : null}
        {!loading && !visibleUsers.length ? <div className="admin-empty">{users.length ? "没有符合筛选条件的账号" : "暂无用户记录"}</div> : null}
      </div>
    </article>
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
          生成邀请码
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
          <th>总用量</th>
          <th>生图</th>
          <th>视频任务</th>
          <th>视频时长</th>
          <th>使用模型</th>
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
                <td>{Number(entry.totalTasks || 0)}</td>
                <td>{Number(entry.imageTasks || 0)}</td>
                <td>{Number(entry.videoTasks || 0)}</td>
                <td>
                  <span>{secondsLabel(entry.videoSeconds)}</span>
                  <small>计划 {secondsLabel(entry.plannedVideoSeconds)}</small>
                </td>
                <td><span>{modelsLabel(entry.models)}</span></td>
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
            <td colSpan="9">暂无用量记录</td>
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
  const [userQuery, setUserQuery] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: "正在读取后台数据...", error: false });

  async function loadAdmin() {
    setLoading(true);
    setMessage({ text: "正在读取后台数据...", error: false });
    try {
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
    } finally {
      setLoading(false);
    }
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
          <div className="admin-heading">
            <span className="admin-kicker">OPERATIONS / USERS</span>
            <strong>用户与权限</strong>
            <span>账号状态、额度与平台用量</span>
          </div>
        </div>
        <div className="admin-actions">
          <a className="ghost admin-home-link" href="/">
            返回项目页
          </a>
          <button className="primary" type="button" disabled={loading} onClick={() => loadAdmin().catch((error) => setMessage({ text: error.message, error: true }))}>
            {loading ? "读取中" : "刷新数据"}
          </button>
        </div>
      </header>

      <Summary summary={summary} />

      <section className="admin-grid">
        <UsersPanel
          users={users}
          loading={loading}
          query={userQuery}
          filter={userFilter}
          onQueryChange={setUserQuery}
          onFilterChange={setUserFilter}
          onAction={handleUserAction}
          onLimitChange={updateUserUsage}
        />

        <section className="admin-secondary-grid">
          <Invites invites={invites} onCreate={createInvite} onDelete={deleteInvite} />
          <ApiStatus apiStatus={apiStatus} />
        </section>

        <article className="admin-panel admin-panel-wide">
          <div className="admin-panel-head">
            <div>
              <span className="section-label">Activity / Usage</span>
              <h2>用量统计</h2>
              <p>按日查看各账号的任务、模型和最近活动。</p>
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
