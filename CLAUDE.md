# Wails + SvelteKit 跨平台桌面端数据库管理工具

本文件为 Claude / 协作者快速建立项目上下文的索引文档：覆盖目录结构、技术栈、架构契约、安全边界与本地开发命令。所有"实现语言无关"的契约（JSON 管道协议、安全规范）保持稳定，引擎侧实现细节按语言无关方式描述。

---

## 1. 项目概览

- 定位：本地化、绿色启动的多数据库（MySQL / PostgreSQL）运维客户端。
- 通信策略：**全程不开本地 HTTP / WebSocket 端口**，UI 与 Go 主进程使用 Wails 原生 IPC，Go 与底层数据引擎使用进程标准输入输出（stdin / stdout）传递行分隔 JSON。
- 状态策略：底层引擎完全无状态；连接凭证及会话上下文常驻于前端 Svelte Store，每次请求由前端附带至引擎。
- 分发策略：JVM 引擎 jar 与精简 JRE 直接随 Wails 二进制一同交付（`engine/` 目录），实现"双击即用"。

---

## 2. 实际目录结构

```
idb_desktop/
├── app.go                       # Wails App 结构体：生命周期钩子 + 前端绑定方法
├── app_dev.go                   # dev build tag: isDevBuild() = true
├── app_prod.go                  # production build tag: isDevBuild() = false
├── config.go                    # 连接配置持久化（~/.config/idb/connections.json）
├── settings.go                  # 应用设置持久化（~/.config/idb/settings.json：语言/主题/引导/刷新频率/JVM内存）
├── theme.go                     # 主题文件扫描/读取/部署（~/.config/idb/theme/*.css + 内置嵌入）
├── mem_windows.go               # Windows 系统内存检测（GlobalMemoryStatusEx）
├── mem_unix.go                  # Linux/macOS 系统内存检测（syscall.Sysinfo）
├── crypto_windows.go            # Windows DPAPI 密码加密
├── crypto_other.go              # 非 Windows 平台 AES-256-GCM 密码加密
├── engine.go                    # JVM 子进程生命周期 + 异步并发管道协议（含流式响应）
├── engine_windows.go            # Windows 平台隐藏控制台子窗口
├── engine_unix.go               # macOS / Linux 平台空实现
├── main.go                      # Wails 启动入口，//go:embed all:frontend/build
├── Makefile                     # 构建/打包/清理（Windows NSIS + Linux tar.gz）
├── go.mod / go.sum              # Go 依赖（wails v2.12.0）
├── wails.json                   # Wails 项目配置（含 Info 元数据）
├── engine/
│   ├── bin/
│   │   ├── idb-engine.jar        # 底层数据引擎入口（Kotlin + HikariCP + JDBC，行分隔 JSON 协议）
│   │   ├── libs/                 # 引擎运行时依赖（HikariCP、kotlinx-serialization、logback、SLF4J 等）
│   │   └── drivers/              # JDBC 驱动（mysql-connector-j、postgresql）
│   └── jre/                      # Azul Zulu JRE 21（make jre-download 自动下载）
├── themes/                        # 内置主题（go:embed 嵌入，首次启动部署到 ~/.config/idb/theme/）
│   └── cyberpunk-dark.css         # 赛博朋克深色主题
├── scripts/
│   └── package-linux.sh         # Linux 打包脚本（tar.gz + run.sh 启动器）
├── frontend/
│   ├── package.json             # Svelte 5 + SvelteKit 2 + Tailwind 4 + Vite 8
│   ├── svelte.config.js         # adapter-static + 强制 runes 模式
│   ├── vite.config.js           # @tailwindcss/vite + sveltekit() 插件
│   ├── src/
│   │   ├── app.html
│   │   ├── lib/
│   │   │   ├── api/             # 引擎通信 API 层（含流式调用）
│   │   │   │   ├── index.js     # 统一请求封装（invoke + invokeStreaming）
│   │   │   │   ├── connections.js # 连接管理 API（List/Get/Save/Delete）
│   │   │   │   ├── themes.js    # 主题与应用设置 API（ListThemes/GetThemeCSS/LoadSettings/SaveSettings）
│   │   │   │   └── normalize.js   # 响应数据归一化工具
│   │   │   ├── i18n/            # 多语言支持（5 种语言）
│   │   │   │   ├── index.js     # locale store + t() 翻译函数 + 语言检测
│   │   │   │   ├── zh-CN.js     # 简体中文
│   │   │   │   ├── zh-TW.js     # 繁体中文
│   │   │   │   ├── en.js        # English
│   │   │   │   ├── ja.js        # 日本語
│   │   │   │   └── ru.js        # Русский
│   │   │   ├── components/      # 15 个 Svelte 组件
│   │   │   │   ├── ConnectionForm.svelte  # 连接管理界面
│   │   │   │   ├── Sidebar.svelte         # 数据库树形浏览器
│   │   │   │   ├── DataGrid.svelte        # 数据表格（分页 + 全量流式加载 + 行 CRUD + 列内筛选 + 搜索）；header 双行：标题/工具栏（上）+ WHERE / ORDER BY（下，中间分割线）
│   │   │   │   ├── SqlConsole.svelte      # SQL 控制台（SELECT 自动流式）
│   │   │   │   ├── SqlEditor.svelte       # Monaco 编辑器封装
│   │   │   │   ├── MonacoInput.svelte     # Monaco 单行输入封装（WHERE / ORDER BY 补全）
│   │   │   │   ├── UserPanel.svelte       # 用户与权限管理
│   │   │   │   ├── TablePanel.svelte      # 表结构编辑器（ALTER TABLE，支持改名）
│   │   │   │   ├── TableEditor.svelte     # 新建表向导
│   │   │   │   ├── RowEditor.svelte       # 行插入/编辑表单
│   │   │   │   ├── Modal.svelte           # 通用模态框
│   │   │   │   ├── ConfirmDialog.svelte   # 确认对话框
│   │   │   │   ├── ContextMenu.svelte     # 右键上下文菜单
│   │   │   │   ├── ThemeToggle.svelte     # 亮色/暗色/自动主题切换
│   │   │   │   └── ToastHost.svelte       # Toast 通知容器
│   │   │   ├── stores/          # Svelte 状态管理
│   │   │   │   ├── appState.js  # 活跃连接状态
│   │   │   │   ├── themeStore.js # 主题偏好 + 自定义主题注入 + 设置持久化（Go 后端）
│   │   │   │   └── toasts.js    # Toast 通知队列
│   │   │   ├── monaco/setup.js  # Monaco Worker 初始化
│   │   │   ├── readonly.js      # 只读系统库保护（MySQL 系统 schema + 写关键字检测）
│   │   │   ├── temporal.js      # 时间列类型格式化工具
│   │   │   ├── sqlValidate.js   # WHERE / ORDER BY 方言级 SQL 片段校验（引擎侧二次校验前的早判）
│   │   │   ├── sqlCompletion.js # Monaco 补全项源（按 driver 区分关键字、函数、DDL/DML）
│   │   │   ├── assets/          # 内联 SVG / 图标资源
│   │   │   └── index.js         # lib 顶层 barrel 导出（轻量）
│   │   └── routes/
│   │       ├── +layout.js       # prerender = true
│   │       ├── +layout.svelte   # 全局布局（主题初始化 + 引导检测 + 右键策略 + ToastHost）
│   │       ├── +page.svelte     # 连接选择页（路由 /）
│   │       ├── setup/
│   │       │   └── +page.svelte # 首次引导页（路由 /setup：语言选择 + 主题选择）
│   │       ├── settings/
│   │       │   └── +page.svelte # 设置页（路由 /settings：语言/主题模式/自定义主题）
│   │       ├── workspace/
│   │       │   └── +page.svelte # 数据库工作台（路由 /workspace）
│   │       └── layout.css       # MD3 设计令牌 + Tailwind 4 @theme 注入
│   ├── static/                  # 静态资产
│   └── wailsjs/                 # Wails 自动生成的 JS 绑定（go/main + runtime）
└── build/
    ├── appicon.png
    ├── windows/                 # 安装器素材、manifest、NSIS 脚本
    └── darwin/                  # macOS 打包资源
```

> Wails 在构建期会把 `frontend/build`（adapter-static 输出）通过 `//go:embed` 嵌入二进制；运行期由 Wails AssetServer 直接从内存提供，前端无需独立 Web 服务器。

---

## 3. 技术栈与版本

| 层 | 技术 | 当前版本 / 形态 |
|---|---|---|
| 桌面框架 | Wails v2 | `github.com/wailsapp/wails/v2 v2.12.0` |
| 主进程 | Go | `go 1.23.0` |
| 前端框架 | SvelteKit | `^2.57.0` |
| UI 运行时 | Svelte | `^5.55.2`，runes 模式强制开启（node_modules 除外） |
| 样式 | Tailwind CSS | `^4.2.2`（通过 `@tailwindcss/vite` 注入） |
| 构建器 | Vite | `^8.0.7` |
| 适配器 | `@sveltejs/adapter-static` | `^3.0.10` |
| 数据引擎 | JVM jar 子进程 | `engine/bin/idb-engine.jar`（内置 `engine/jre/` 待捆绑） |
| SQL 编辑器 | Monaco Editor | `^0.55.1`（动态加载，自定义 SQL 补全 + MD3 主题） |
| SQL 格式化 | sql-formatter | `^15.8.0`（支持 MySQL / PostgreSQL 方言） |
| 设计语言 | Material Design 3 | Tailwind 4 通过 `@theme` + CSS 变量注入完整 MD3 令牌 |

---

## 4. 三层隔离架构

```
+-----------------------------------------------------------------------+
| 宿主操作系统（Windows / macOS / Linux）                                  |
|                                                                       |
|  [前端 UI 层 — SvelteKit SPA + Svelte 5 runes]                          |
|         │                                                             |
|         │  Wails 原生内存 IPC（无网络）                                 |
|         ▼                                                             |
|  [中间控制层 — Wails Go 主进程]                                          |
|         │                                                             |
|         │  StdIn / StdOut 行分隔 JSON 管道（无网络）                     |
|         ▼                                                             |
|  [底层数据引擎 — JVM 无状态子进程]                                        |
|         │                                                             |
|         │  原生 JDBC + 全参数化绑定                                      |
|         ▼                                                             |
|  [目标数据库 — MySQL / PostgreSQL]                                      |
+-----------------------------------------------------------------------+
```

设计要点：
- **零本地端口**：根除 Localhost 端口劫持、跨进程嗅探等攻击面。
- **进程隔离**：JVM 引擎崩溃不影响 Go 主进程；Go 主进程关闭时主动回收子进程。
- **无状态引擎**：每条请求自带 connection 信息，引擎仅维护按连接特征哈希的本地连接池缓存（详见 §6）。

---

## 5. 通信契约（JSON Pipeline Protocol）

所有跨进程消息使用单行压缩 JSON，以 `\n` 作为消息边界。前端无法直接调用引擎，必须经由 Go 主进程绑定方法转发。

### 5.1 请求体（Request Envelope）

```json
{
  "id": "uuid-v4-string",
  "category": "SCHEMA | USER | TABLE | DATA | SQL",
  "action": "LIST | CREATE | UPDATE | DELETE | EXECUTE | GET_DDL",
  "connection": {
    "driver": "Mysql | Postgres",
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "user_secret_password",
    "database": "target_db"
  },
  "payload": {}
}
```

> driver 字段约定使用 `Mysql`（首字母大写，不带 "sql" 后缀）和 `Postgres`（与 Go 侧 `dataclass` 对齐）。

### 5.2 响应体（Response Envelope）

```json
{
  "id": "uuid-v4-string",
  "success": true,
  "error": null,
  "stream": false,
  "end": false,
  "data": {}
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `stream` | boolean | `false` | `true` 表示当前响应属于流式序列 |
| `end` | boolean | `false` | `true` 表示流式序列结束，`data` 为 `null` |

普通（非流式）响应中 `stream` 和 `end` 均为 `false`。

### 5.3 Payload 契约（按 category × action）

引擎已实装路由（参见 `engine/README` / `RequestDispatcher`）。下表给出每条命令的 `payload` 形状与典型用途；所有命令的 `connection.database` 用作目标库（schema 切换通过覆盖 `connection.database` 即可，**不要**单独再传 schema 字段）。

| Category | Action | payload | 说明 |
|---|---|---|---|
| SCHEMA | LIST | `{}` | 列出该连接可见的所有 database / schema，返回 `string[]` |
| SCHEMA | CREATE | `{ name }` | 创建库（按驱动方言） |
| SCHEMA | DELETE | `{ name }` | 删库 |
| USER | LIST | `{}` | 用户列表，MySQL 形如 `[{user, host}]`，PostgreSQL `[{user}]` |
| USER | UPDATE | `{ user, schema, privileges, isGrant }` | `isGrant=true` 授权、`false` 回收 |
| TABLE | LIST | `{}` | 列出 `connection.database` 内的表，返回 `[{name, type}]` |
| TABLE | LIST | `{ tableName }` | **payload 含 tableName 时自动路由**为列元数据，返回 `[{name, type, size, nullable, isPrimaryKey, defaultValue}]` |
| TABLE | CREATE | `{ tableName, columns: ColumnDef[] }` | 新建表；`ColumnDef` 含 `name / type / size / nullable / isPrimaryKey / defaultValue` |
| TABLE | UPDATE | `{ tableName, operation, column?, columnName? }` | **operation 字段** 二级路由：`ADD_COLUMN`（含 `column`）/ `MODIFY_COLUMN`（含 `column`，可改名 `newName`）/ `DROP_COLUMN`（含 `columnName`） |
| TABLE | DELETE | `{ tableName }` | 删除整张表 |
| TABLE | GET_DDL | `{ tableName }` | 取建表语句字符串 |
| DATA | LIST | `{ tableName, page, pageSize, where?, orderBy? }` | **page 从 1 开始**；LOB / 长文本字段引擎自动截断为 `[LOB Data]`；返回 `{ total, page, pageSize, rows: [...] }`。`where` / `orderBy` 是 SQL 片段，由前端 `sqlValidate.js` 方言级校验后透传，引擎侧会再次校验 |
| DATA | LIST | `{ tableName, page: 1, pageSize: 0, where?, orderBy? }` | **全量流式查询**：触发引擎流式多行响应（`stream:true`），每行含单条数据，末行 `end:true` |
| DATA | CREATE | `{ tableName, values: { col: val, ... } }` | 单行插入；返回 `{ affectedRows }` |
| DATA | UPDATE | `{ tableName, changes: {...}, where: {...} }` | 多列条件更新；返回 `{ affectedRows }` |
| DATA | DELETE | `{ tableName, where: {...} }` | 条件删除；返回 `{ affectedRows }` |
| SQL | EXECUTE | `{ sql }` | 非 SELECT：返回 `{ affectedRows }`；SELECT：自动触发流式多行响应（`stream:true`） |

> 退出信号：向 stdin 写一行 `CMD_EXIT`（或关闭 stdin），引擎即自清理退出。所有日志写 stderr，绝不污染 stdout 协议流。

### 5.4 跨数据库方言矩阵（引擎层抹平）

| 模块 | action | MySQL | PostgreSQL |
|:-:|:-:|:-:|:-:|
| SCHEMA | LIST | `SHOW DATABASES` | 查询 `information_schema.schemata` |
| USER | LIST | `SELECT user, host FROM mysql.user` | 查询 `pg_user` |
| USER | UPDATE（授权） | `GRANT ALL PRIVILEGES ON ...` | `GRANT ... ON ALL TABLES IN SCHEMA ...` |
| TABLE | LIST | JDBC `metaData.getTables()` | JDBC `metaData.getTables()` |
| DATA | LIST（分页） | 参数化 `LIMIT ? OFFSET ?` | 参数化 `LIMIT ? OFFSET ?` |

---

## 6. 中间控制层（Wails Go 主进程）

职责：生命周期管理 + 高速无损管道中转 + 资源护栏。

### 6.1 生命周期与子进程管控

启动时：
1. 定位 `engine/bin/idb-engine.jar`，拼装命令行（`resolveAppDir()` 优先可执行文件目录，回退到 CWD）；
2. 以受限 JVM 参数（`-Xms32m -Xmx256m -XX:+UseSerialGC`）启动 Java 子进程；
3. 取得 stdin / stdout 句柄，启动 `readLoop` goroutine 建立异步响应路由。

关闭时：
1. 向子进程写入 `CMD_EXIT\n`，关闭 stdin；
2. 调用 `Process.Kill()` 兜底；
3. `closeAll()` 唤醒所有待响应的 `pending` 调用者，返回错误信封。

#### 实际实现概要（[engine.go](engine.go)）

```go
type Engine struct {
    cmd    *exec.Cmd
    stdin  io.WriteCloser
    stdout *bufio.Scanner
    ctx    context.Context           // 用于 Wails EventsEmit

    writeMu  sync.Mutex               // 仅在写入 stdin 期间持有
    pendMu   sync.Mutex
    pending  map[string]chan string   // id → 等待者 channel（容量 1）
    done     chan struct{}            // reader 退出 / 引擎死掉时关闭
    closeOnce sync.Once
    closeErr error                    // 终止原因
}
```

**并发协议**：`Invoke(ctx, reqJSON)` 先从 JSON 中提取 `id`，注册一个 capacity-1 的 channel 到 `pending`，互斥写入 stdin，然后阻塞等待对应 channel 返回结果。独立 `readLoop` goroutine 持续读取 stdout，解析响应 `id`，将结果路由到正确的等待者。支持 `ctx` 取消和引擎死亡检测。

**流式协议**：当响应 envelope 的 `stream: true` 时，`readLoop` 通过 `wruntime.EventsEmit` 把每一行以 `engine:stream:<id>` 事件推送到前端（末行 `end:true` 走 `engine:stream-end:<id>`），并写一行到 channel 唤醒 `Invoke` 让其返回确认信封。前端 `api/index.js` 的 `invokeStreaming` 同时订阅 `EventsOnce(end)` 和 `EventsOn(stream)` 两类事件，串接成行回调。`closeAll` 在引擎异常时通过 `engine:stream-end:<id>` 事件向所有挂起的流式等待者发送带错误的结束 envelope。`closeOnce` 保护 Shutdown 与 reader 并发触发 closeAll 的安全。

**暴露入口**：
- `FetchDatabaseData(reqJSON)` — 非流式 / 同步入口，调用 `Invoke(ctx, reqJSON)`，异常时返回合成错误 envelope。
- `FetchDatabaseDataStreaming(reqJSON)` — 流式入口；首条响应若是 `stream: true`，立即返回 `{id, success:true, stream:true}` 确认信封；否则退化为普通响应直接返回。

**管道读上限**：`bufio.Scanner` 缓冲上限 `engineMaxLine = 8 MiB`，单行超大响应（不分页的大字段等）必须由 §9.2 熔断机制兜底。

**路径解析**：`resolveAppDir()` 优先使用 `os.Executable()` 推导的目录（生产），回退到 `os.Getwd()`（`wails dev`）。

**平台差异**：
- `engine_windows.go`：`syscall.SysProcAttr{HideWindow: true, CreationFlags: CREATE_NO_WINDOW}` 隐藏控制台子窗口。
- `engine_unix.go`：空实现。

**优雅关闭**：`Shutdown` 先尝试 `writeMu.TryLock()` 走优雅路径（`CMD_EXIT\n` + 关闭 stdin）；若锁被占用直接 `Process.Kill()` 兜底，关闭的 stdin 会让阻塞中的 writer 立即返回。

### 6.2 内存与并发护栏

- **JVM 上限锁死 256MB**：通过 `-Xmx256m` 启动参数施加，避免引擎抢占主进程内存预算。
- **JVM 初始堆 32MB + 串行 GC**：`-Xms32m -XX:+UseSerialGC`，桌面单人使用优先考虑内存占用而非吞吐。
- **Wails Webview 目标**：物理常驻 ≤ 150MB（与 §9 大字段熔断协同保障）。
- **stdout 单行缓冲上限 8 MiB**：`engineMaxLine`；超过会被 `bufio.ErrTooLong` 触发，readLoop 视为引擎异常并 `closeAll`。
- **stderr 独立通道**：引擎 stderr 接到 `log.Printf("[engine.stderr] ...")`，绝不混入 stdout 协议流（实现见 `engine.go` 的 `stderrLogger`）。

---

## 7. 底层数据引擎（JVM 无状态子进程）

引擎以 jar 形式分发，运行时通过精简 JRE 启动。所有逻辑均围绕"无会话状态 + 连接特征缓存"展开。

### 7.1 动态连接池策略

- **池键**：`driver://user@host:port/database`，相同凭证复用 `HikariCP` 实例。
- **池容量**：`maximumPoolSize = 5`，`minimumIdle = 1`，本地单人使用足矣。
- **空闲回收**：`idleTimeout = 600_000`（10 分钟）后自动销毁，回收资源。
- **建连超时**：`connectionTimeout = 5_000`（5 秒），让前端快速感知断开。
- **驱动 URL 模板**：
  - MySQL：`jdbc:mysql://host:port/db?useSSL=false&serverTimezone=UTC`
  - PostgreSQL：`jdbc:postgresql://host:port/db`

### 7.2 协议循环

引擎主线程按行读取 stdin，解析 JSON → 路由到 `category/action` 处理器 → 序列化结果 → 单行写回 stdout。所有处理器必须满足：

- 全部使用占位符（`?`）参数化绑定，**严禁字符串拼接 SQL**；
- 大字段在序列化前必须按 §9.2 熔断；
- 处理器内部异常须捕获并填充到响应 envelope 的 `error` 字段，绝不让异常打穿到 stdout，否则会污染下一条消息。
- WHERE / ORDER BY 片段由前端 `sqlValidate.js` 方言级预校验后透传（禁止关键字白名单 + 引号内豁免），引擎侧仍需二次校验。

---

## 8. 前端展现层（SvelteKit + Svelte 5 + Tailwind 4 + MD3）

### 8.1 SPA 化

`adapter-static` + `+layout.js` 中 `prerender = true` 确保产物为纯静态文件，由 Wails AssetServer 内嵌提供。无 SSR、无服务端路由。

> 原 SDD 中 `ssr = false` / `prerender = false` 的写法是早期方案；当前实际方案是 `prerender = true`（adapter-static 默认要求），效果一致：构建期生成纯静态 HTML/JS，运行期不需要任何 Node.js 运行时。

### 8.2 Svelte 5 Runes 模式

`svelte.config.js` 强制 runes：

```js
compilerOptions: {
  runes: ({ filename }) =>
    filename.split(/[/\\]/).includes('node_modules') ? undefined : true
}
```

意味着：
- 状态用 `$state` / `$derived` / `$effect`，不要用旧版 `let` 自动响应式写法；
- props 用 `let { foo } = $props()`（参见 [+layout.svelte](frontend/src/routes/+layout.svelte)）；
- node_modules 内库代码不受影响，避免破坏第三方 Svelte 4 组件。

### 8.3 Tailwind 4 + MD3 设计令牌

通过 Vite 插件 `@tailwindcss/vite` 注入；样式入口 [layout.css](frontend/src/routes/layout.css) 已包含完整的 Material Design 3 令牌层：

- 亮色 / 暗色调色板（基于 MD3 baseline seed `#6750A4`）；
- 完整令牌集：primary / secondary / tertiary / error / success / surface 色调 / outline / 阴影 / 圆角 / 状态层透明度；
- `@theme` 块将所有 MD3 令牌映射为 Tailwind 工具类颜色；
- `@utility` 自定义组件类：`md-card`、`md-card-elevated`、`md-input`、`md-btn-filled`、`md-btn-tonal`、`md-btn-outlined`、`md-btn-text`、`md-btn-danger`、`md-icon-btn`、`md-chip`、`md-chip-pk`；
- 字体栈：Inter + CJK 回退（sans），JetBrains Mono（monospace）。

无 `tailwind.config.js`（Tailwind 4 默认零配置）。

### 8.4 状态中心

已实现三个 Svelte Store（位于 `src/lib/stores/`）+ i18n locale store：

```js
// appState.js — 活跃数据库连接
export const defaultConnection = { driver: 'Mysql', host: '127.0.0.1', port: 3306, user: 'root' }
export const activeConnection = writable(null) // ConnectionConfig | null

// themeStore.js — 主题偏好 + 自定义主题 + 设置持久化（Go 后端）
export const themeMode = writable('auto')       // 'light' | 'dark' | 'auto'
export const resolvedTheme = writable('light')  // 实际应用的 'light' | 'dark'
export const lightThemeId = writable('')        // 浅色自定义主题 ID（空 = 内置 MD3）
export const darkThemeId = writable('')         // 深色自定义主题 ID（空 = 内置 MD3）
export const setupComplete = writable(false)    // 首次引导是否已完成
export const memRefreshSeconds = writable(10)   // workspace 内存刷新间隔（秒）
export const jvmMaxMemoryMB = writable(256)     // JVM 最大堆内存（MB）

// i18n/index.js — 多语言
export const locale = writable('zh-CN')         // 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ru'
export const t = derived(locale, ...)           // 翻译函数：$t('key') 或 $t('key', { param })

// toasts.js — Toast 通知队列，自动 3.5s 移除
export const toasts = writable([])
export function ok(text) { pushToast('success', text) }
export function err(text) { pushToast('error', text) }
```

> 所有写入引擎的请求从 `activeConnection` 取出 `connection` 字段，前端 API 层（`src/lib/api/index.js`）自动完成拼装。
> 设置（语言/主题/引导状态/内存刷新频率）通过 `themeStore.js` 的 `persistSettings()` 写回 Go 后端 `~/.config/idb/settings.json`。

### 8.5 Wails JS 绑定

`frontend/wailsjs/go/main/App.js` 由 Wails 自动生成，当前暴露 12 个方法：

| 方法 | 用途 |
|---|---|
| `FetchDatabaseData(reqJSON)` | 统一引擎中转（非流式） |
| `FetchDatabaseDataStreaming(reqJSON)` | 流式引擎中转（流式通过 Wails 事件推送） |
| `IsDevMode()` | 返回是否为 dev 构建（用于前端右键策略等） |
| `ListConnections()` | 列出已保存的连接（密码脱敏） |
| `GetConnectionPassword(id)` | 解密并返回指定连接的密码 |
| `SaveConnection(input)` | 创建/更新连接配置（密码自动加密） |
| `DeleteConnection(id)` | 删除连接配置 |
| `ListThemes()` | 扫描 `~/.config/idb/theme/*.css`，返回主题列表 |
| `GetThemeCSS(id)` | 读取指定主题的完整 CSS 内容 |
| `LoadSettings()` | 从 `~/.config/idb/settings.json` 读取应用设置 |
| `SaveSettings(input)` | 写入应用设置（语言/主题/引导状态/JVM内存等） |
| `RestartEngine()` | 关闭当前 JVM 引擎并以新配置重启（JVM 内存变更后调用） |

新增 Go 方法后会自动刷新。**不要手工编辑 `wailsjs/` 内任何文件**。

### 8.6 DataGrid 双行 Header 布局

[DataGrid.svelte](frontend/src/lib/components/DataGrid.svelte) 的 toolbar header 采用 `flex-col` 双行结构，中间用 `border-top: 1px solid var(--md-outline-variant)` 分割：

- **第一行**：标题（schema · table）+ 右侧工具栏（刷新、只读 / + 插入）。
- **第二行**：WHERE 条件（`flex-1` 自适应）+ ORDER BY（固定 `11rem`）并排显示。

布局要点：
- 整体 `gap-1 pt-1` 让两行之间有视觉留白。
- 分割线颜色复用 `--md-outline-variant`，与 header 底部外框线、表格 thead 分隔线保持一致。
- WHERE 输入使用 `flex-1` 占满剩余宽度，ORDER BY 固定宽度保证简短排序条件不被拉伸。
- 两行均使用 `items-center`，输入框高度统一 `20px`（与 MonacoInput 单行基线对齐）。

### 8.7 SQL 片段前端校验

`sqlValidate.js`（在 `invoke` 前调用）对 WHERE / ORDER BY 片段做早判，提前拒绝危险片段，避免无意义的网络往返。校验逻辑按数据库方言分叉：

- **FORBIDDEN_KEYWORDS**（通用）：`INSERT, UPDATE, DELETE, DROP, UNION, EXEC, EXECUTE, CREATE, ALTER, GRANT, REVOKE, TRUNCATE`，引号内的出现会被跳过。
- **ORDER BY 额外约束**：仅允许列名、ASC/DESC、数字字面量和逗号分隔符，显式拒绝函数/子查询拼接。
- 引擎侧也会做二次校验（Kotlin 层），双重防护确保安全。

### 8.8 SQL 补全项配置

`sqlCompletion.js` 按上下文分组提供 Monaco 补全项：

- **表达式级**（WHERE / HAVING）：`AND, OR, NOT, NULL, IN, BETWEEN, LIKE, EXISTS, DISTINCT, TRUE, FALSE, CASE/WHEN/THEN/ELSE/END`
- **子句级**（SELECT 结构）：`SELECT, FROM, WHERE, GROUP BY, ORDER BY, HAVING, LIMIT, OFFSET, JOIN, LEFT/RIGHT/INNER/OUTER JOIN, ON, AS, UNION, ASC, DESC`
- **DML 级**：`INSERT INTO, VALUES, UPDATE, SET, DELETE FROM`
- **通用函数**：`COUNT, SUM, AVG, MIN, MAX, NOW, CURRENT_DATE, CURRENT_TIMESTAMP, COALESCE, NULLIF, CAST, UPPER, LOWER, LENGTH, TRIM, SUBSTRING, CONCAT`
- **MySQL 专属**：`RLIKE, REGEXP, SOUNDS LIKE, XOR, IGNORE, FORCE, USE INDEX, STRAIGHT_JOIN, DESCRIBE, EXPLAIN, SHOW, TRUNCATE, AUTO_INCREMENT, IF NOT EXISTS, REPLACE`
- **PostgreSQL 专属**：`ILIKE, SIMILAR TO, ARRAY, JSONB_EXTRACT_PATH, REGEXP_REPLACE, REGEXP_MATCHES, STRING_AGG, GENERATE_SERIES, LATERAL, RETURNING, DO, EXCLUDE`

---

## 9. 安全与边界规范

1. **绝对防注入（元数据阻断）**
   表/库结构相关的 DDL/DML 必须使用占位符；引擎层禁止任何形式的字符串拼接 SQL，包括看似"安全"的内部白名单字段。
2. **大字段熔断**
   `BLOB` / `CLOB` / `BYTEA` 或长度 > 2048 字符的文本，引擎层在序列化 JSON 时必须截断为占位 `[LOB Data / Multi-Text Context]`；前端渲染为 MD3 放大镜图标，用户点击触发**单行精准查询**。规避 stdin/stdout 缓冲区被打爆导致 Wails 假死。
3. **分页强约束**
   单页上限 `pageSize ≤ 1000`（当前默认 20 行/页，可选 20/50/100/200/500/全量）；前端表格目前使用标准 `<table>` 渲染，虚拟滚动（virtual list）待后续引入以保证大列宽表 DOM 节点常量级。
4. **凭证生命周期**
   `password` 仅存在于前端 Store + 单次请求 envelope；引擎落到磁盘 / 日志的内容必须脱敏（连接串中的密码字段在 panic / error 路径中务必抹除）。
5. **进程边界纪律**
   - 所有 stdout 写入仅允许 envelope JSON；调试日志写 stderr。
   - Go 侧读取 stdout 必须按行；任何越界换行（如错误堆栈直出）都会破坏协议。
6. **连接配置加密**
   Windows 走 `crypto_windows.go` 的 DPAPI（`CryptProtectData` / `CryptUnprotectData`），密文仅在当前用户 / 当前机器下可解；非 Windows 走 `crypto_other.go` 的 AES-256-GCM，密钥从 `~/.config/idb/key` 派生，目录权限 0o700，密钥文件权限 0o600。`getPassword` 失败（key 缺失 / 密文损坏 / 跨用户拷贝）会带错误返回，让前端给出明确提示。
7. **WHERE / ORDER BY 双重校验**
   前端 `sqlValidate.js` 在请求发出前做禁止关键字扫描 + 引号内豁免 + ORDER BY 严格词法约束；引擎侧（Kotlin）做二次校验，确保即便前端校验被绕过也无法拼接危险 SQL。

---

## 10. 本地开发与构建

### 10.1 常用命令（Windows / bash）

```bash
# 开发模式（带热重载，devtools 可访问 Go 绑定，右键可用）
wails dev

# 生产构建（含 devtools 支持）
wails build -devtools

# Makefile 构建（推荐）
make dev               # 开发模式
make build             # 当前平台构建
make package-windows   # Windows NSIS 安装包
make package-linux     # Linux tar.gz 分发包
make package-all       # 全平台
make jre-download      # 下载 Azul Zulu JRE 21
make deps              # 依赖检查（go / node / npm / wails）
make clean             # 清理构建产物

# 仅前端开发（不通过 wails，调试样式时方便）
cd frontend && npm run dev

# 前端格式化 / Lint
cd frontend && npm run format
cd frontend && npm run lint
```

### 10.2 路径与平台注记

- 当前会话运行在 Windows + bash shell：脚本中使用正斜杠路径与 Unix 重定向（`/dev/null` 而非 `NUL`）。
- Wails 的 `frontend:dev:serverUrl: auto` 会自动选用 Vite 端口，无需手工配置。
- `engine/jre/` 体积较大，避免误提交无关变更进 git；jre 升级需同步在打包脚本中校验。

---

## 11. 当前进度速览

| 模块 | 状态 |
|---|---|
| Wails 项目骨架 | ✅ 已搭建（main.go / app.go / app_dev.go / app_prod.go / wails.json） |
| SvelteKit + Svelte 5 + Tailwind 4 | ✅ 完整 SPA，双路由（连接页 + 工作台） |
| Go ↔ JVM 子进程管道 | ✅ 异步并发协议 + 流式响应（id 路由 + Wails 事件推送 + 8 MiB 缓冲上限） |
| JSON 协议处理器 | ✅ 前端 API 层完整封装（invoke + invokeStreaming） |
| 连接配置持久化 | ✅ 加密存储（Windows DPAPI / 非 Windows AES-256-GCM + 本地 key），CRUD 完整 |
| 连接管理界面 | ✅ 连接列表 + 表单 + 密码保存 + 删除确认 |
| 数据库树形浏览器 | ✅ 三级懒加载（Schema → Table → Column），右键菜单，筛选 |
| 数据表格查看/编辑 | ✅ 分页（20/50/100/200/500/全量） + 全量流式加载 + 行 CRUD + 列内筛选 + 搜索 + 双行 header（标题工具栏 / WHERE+ORDER BY） |
| SQL 控制台 | ✅ Monaco 编辑器 + 智能补全（按 driver 区分） + 多语句执行 + SELECT 流式 + sql-formatter 格式化 |
| 表结构编辑 | ✅ Draft 模式列编辑器（ADD / MODIFY / DROP COLUMN）+ 新建表向导 + 字段改名（newName）+ GET_DDL |
| 用户与权限管理 | ✅ 用户列表 + GRANT/REVOKE 模态框 |
| WHERE / ORDER BY 安全 | ✅ 前端 `sqlValidate.js` 方言级校验 + 引擎侧二次校验 |
| MD3 Token / Tailwind theme | ✅ 完整 MD3 令牌注入 + 亮色/暗色/自动主题 + 自定义主题加载（`~/.config/idb/theme/*.css`） |
| 上下文菜单 / Toast 通知 | ✅ 右键菜单（dev 模式可用原生菜单） + Toast |
| 只读系统库保护 | ✅ MySQL 系统 schema 写操作拦截 + 写关键字检测 |
| 多语言（i18n） | ✅ 5 种语言（zh-CN / zh-TW / en / ja / ru），`$t('key')` 翻译函数，220+ 翻译 key |
| 自定义主题 | ✅ 从 `~/.config/idb/theme/*.css` 加载，支持亮色/暗色分别指定，内置赛博朋克主题 |
| 首次引导页 | ✅ `/setup` 路由：语言选择（下拉预览）→ 主题模式选择，MD3 动画过渡 |
| 设置页 | ✅ `/settings` 路由：语言切换、主题模式、自定义主题选择、性能设置、系统信息展示、主题文件格式说明 |
| 设置持久化 | ✅ `~/.config/idb/settings.json`：语言/主题/引导状态/内存刷新频率/JVM内存，Go 后端 atomic-rename |
| 系统信息 | ✅ 设置页展示 JVM/OS/CPU/内存信息，workspace 底部内存占用条（可配置刷新频率 1-10s） |
| JVM 内存配置 | ✅ 设置页可配置 JVM 最大堆内存（64-4096MB，默认 256MB），重启引擎生效，系统内存检测（Windows API / Unix syscall） |
| NSIS 安装包 | ✅ Windows 安装包（含 engine 打包 + 快捷方式选项） |
| Linux 分发包 | ✅ tar.gz + run.sh 启动器 |
| Makefile 自动化 | ✅ 双平台构建 + Azul Zulu JRE 21 自动下载 + deps 依赖自检 |
| 虚拟滚动 | ⏳ 未实现（当前标准 table 渲染） |
