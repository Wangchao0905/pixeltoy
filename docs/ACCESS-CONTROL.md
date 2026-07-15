# 访问控制:画布权限与管理员模型

> 记录 Pixel Toys 的两套访问控制机制:**画布(Canvas)按用户授权** 与 **管理员仅白名单**。
> 代码引用一律用函数/常量名,避免行号漂移。所有约束由 `scripts/self-check.mjs` 守卫,`npm test` 可验。

## 1. 画布权限:默认关闭,管理员按用户开启

**规则**:管理员始终可用画布;普通用户默认**关闭**,需被管理员显式开启 `canvasEnabled` 才能使用。

**重要原则**:"无画布" 只是 **不显示入口 + 服务端拦截访问**,**绝不移除画布功能**。画布代码(`public/canvas.html`、`public/canvas.js`、`/api/canvas/*`)与已有画布数据一律不动;权限只是一个开关,管理员一开即原样恢复。

**判定核心** —— `server.js`:
- `userCanUseCanvas(user)`:`isAdminUser(user) || user.canvasEnabled === true`。
- `publicUser()` 输出 `canvasEnabled` 字段,`/api/auth/me` 前端据此判断。

**服务端硬墙(安全边界)** —— `server.js` `requireAuth()`:
- 对 `"/canvas.html"` 与所有 `"/api/canvas/*"` 统一门禁:登录后再判 `userCanUseCanvas`。
- 未授权:页面 **重定向回 `/`**;接口返回 **403「未开启画布权限,请联系管理员」**。
- 说明:所有画布接口都在 `/api/canvas/` 前缀下,一条前缀规则即可全拦。

**管理员开关(后台)**:
- `server.js` 后台 API `POST /api/admin/users/:id`:接受 `canvasEnabled` 布尔并写入用户。
- `public/admin.html`:用户表含「画布」列。
- `public/admin.js`:每行显示「已开启/已关闭」状态;普通用户行有「开启画布/关闭画布」按钮(`data-action="toggle-canvas"`,用 `data-enabled` 传当前态);管理员恒开,不显示该按钮。

**前端入口(体验层,非安全层)**:
- `public/index.html`:画布入口卡默认带 `hidden` 类,避免非授权用户看到入口闪现。
- `public/app.js` `syncAuthUser()`:按 `canvasEnabled` 决定显隐(照抄 `#adminLink` 模式)。

**默认关闭如何天然成立**:老用户数据无 `canvasEnabled` 字段 → `userCanUseCanvas` 对非管理员返回 `false`,无需数据迁移。

## 2. 管理员:超级管理员唯一 + 仅白名单

**规则**:超级管理员**有且只有一个** = 用户名 `superadmin`(内建)。**除非另行设定**,没有其他管理员。"另行设定" 的唯一口子是环境变量白名单。

**管理员身份来源(仅两处,均为用户名白名单)** —— `server.js`:
- 内建常量 `SUPER_ADMIN_USERNAME = "superadmin"`。
- `adminUsernames()` 返回 `[superadmin, ...env PIXEL_TOYS_ADMIN_USERNAMES]`(去重)。
- `computedUserRole(user)`:**只**判断 `adminUsernames().includes(用户名)`,是则 `admin`,否则 `user`。

**已移除的旧机制**(防止管理员悄悄变多):
- ❌ 首个注册用户自动成为管理员(register 现恒写 `role: "user"`)。
- ❌ 无管理员时"第一个启用用户"兜底为 admin。
- ❌ 存储的 `role: "admin"` 字段作为权限来源(`computedUserRole` 不再看它)。
- ❌ 后台「设为管理员/设为用户」按钮及后端 `role` 变更(API 传 `role` 被忽略)。

**如何"另行设定"更多管理员**:
- 在项目根目录 `.env.local` 或进程环境设置:`PIXEL_TOYS_ADMIN_USERNAMES=name1,name2`(逗号分隔用户名)。
- 这些用户名对应的账号即为管理员。这是唯一的扩充方式。

**运维注意**:
- 线上要有人能进后台,**必须存在用户名恰为 `superadmin` 的账号**(用合法邀请码注册即可,注册后凭用户名自动获得 admin)。
- 生产库中**历史遗留的 `role: "admin"` 用户不再是管理员**——符合"有且只有一个"。如需保留某人,把其用户名加入 `PIXEL_TOYS_ADMIN_USERNAMES`。
- `role` 字段现为无效元数据,不再决定权限。

## 3. 相关配置项(环境变量)

| 变量 | 作用 |
|---|---|
| `PIXEL_TOYS_ADMIN_USERNAMES` | 逗号分隔的额外管理员用户名白名单(`superadmin` 已内建,无需再列) |
| `PIXEL_TOYS_INVITE_CODES` | 逗号分隔的注册邀请码 |
| `PIXEL_TOYS_AUTH_DISABLED` | =1 时全站免鉴权(**生产环境务必永不设置**) |

## 4. 验证

- 静态守卫:`scripts/self-check.mjs` 中「Canvas access control」与「Admin authority is whitelist-only」两组断言,`npm test` 全绿即达标。
- 运行时冒烟(隔离临时目录,不碰生产):以临时目录为 `APP_ROOT`(`node server.js` 的 cwd)启动,`PORT`/`PIXEL_TOYS_INVITE_CODES`/`PIXEL_TOYS_ADMIN_USERNAMES` 走环境变量,注册用户后用 curl 核验:
  - 普通用户 `/api/canvas/state`→403、`/canvas.html`→302;开权限后→200/放行;再关→回 403。
  - `superadmin` 与 env 白名单用户 role=admin、可进 `/api/admin/users`;普通用户 403;通过 API 传 `role:"admin"` 提升无效。

## 5. 团队协作权限

- 系统管理员仍只由 `superadmin` 与 `PIXEL_TOYS_ADMIN_USERNAMES` 白名单决定。
- 团队 `owner` 只是团队内角色，不会改变 `computedUserRole()`，也不能进入系统管理后台。
- 个人项目和个人独立画布只允许资源所有者访问；缺少 `scope` 的旧数据按个人资源处理。
- 团队项目和团队独立画布允许当前团队成员查看、编辑和生成；退出或被移除后立即失去访问权。
- 删除团队项目/画布、管理成员、管理邀请码和转移团队只允许团队 owner；系统管理员保留既有全局访问。
- 画布访问必须同时通过 `userCanUseCanvas()` 功能开关和资源 scope 权限，两者不可互相替代。
- 无权访问项目时继续返回 404，避免泄露项目是否存在；团队管理越权返回 403。
