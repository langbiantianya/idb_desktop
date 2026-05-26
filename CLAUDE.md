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
├── app.go                       # Wails App 结构与绑定方法（当前仅 Greet 桩）
├── main.go                      # Wails 启动入口，//go:embed all:frontend/build
├── go.mod / go.sum              # Go 依赖（wails v2.12.0）
├── wails.json                   # Wails 项目配置
├── engine/
│   ├── bin/idb-engine.jar       # 底层数据引擎（JVM jar，行分隔 JSON 协议）
│   └── jre/                     # 精简 JRE（与 jar 一同打包随发行）
├── frontend/
│   ├── package.json             # Svelte 5 + SvelteKit 2 + Tailwind 4 + Vite 8
│   ├── svelte.config.js         # adapter-static + 强制 runes 模式
│   ├── vite.config.js           # @tailwindcss/vite + sveltekit() 插件
│   ├── src/
│   │   ├── app.html
│   │   ├── lib/                 # $lib 别名根，公共代码
│   │   └── routes/
│   │       ├── +layout.js       # prerender = true
│   │       ├── +layout.svelte
│   │       ├── +page.svelte
│   │       └── layout.css       # @import 'tailwindcss'
│   ├── static/                  # 静态资产
│   └── wailsjs/                 # Wails 自动生成的 JS 绑定（go/main + runtime）
└── build/
    ├── appicon.png
    ├── windows/                 # 安装器素材、manifest
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
| 数据引擎 | JVM jar 子进程 | `engine/bin/idb-engine.jar` + `engine/jre/` |
| 设计语言 | Material Design 3（规划中） | Tailwind 通过 CSS 变量注入 MD Token |

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
  "action": "LIST | CREATE | UPDATE | DELETE | EXECUTE",
  "connection": {
    "driver": "mysql | postgresql",
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "user_secret_password",
    "database": "target_db"
  },
  "payload": {}
}
```

### 5.2 响应体（Response Envelope）

```json
{
  "id": "uuid-v4-string",
  "success": true,
  "error": null,
  "data": {}
}
```

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
| DATA | LIST | `{ tableName, page, pageSize }` | **page 从 1 开始**；LOB / 长文本字段引擎自动截断为 `[LOB Data]` |
| DATA | CREATE | `{ tableName, values: { col: val, ... } }` | 单行插入；返回 `{ affectedRows }` |
| DATA | UPDATE | `{ tableName, changes: {...}, where: {...} }` | 多列条件更新；返回 `{ affectedRows }` |
| DATA | DELETE | `{ tableName, where: {...} }` | 条件删除；返回 `{ affectedRows }` |
| SQL | EXECUTE | `{ sql }` | 原生 SQL；查询返回结果集数组，DML/DDL 返回 `{ affectedRows }` |

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
1. 释放（或定位）`engine/bin/idb-engine.jar`，拼装命令行；
2. 以受限 JVM 参数（`-Xms32m -Xmx64m -XX:+UseSerialGC`）启动 Java 子进程；
3. 取得 stdin / stdout 句柄，建立行扫描器。

关闭时：
1. 向子进程写入 `CMD_EXIT\n`，等待优雅退出；
2. 必要时 `Process.Kill()` 兜底；
3. 清理临时释放出的 jar 文件（如果走 embed 释放路径）。

#### 启动命令参考实现（Go）

```go
package main

import (
    "bufio"
    "context"
    "io"
    "os/exec"
    "path/filepath"
)

type Engine struct {
    cmd    *exec.Cmd
    stdin  io.WriteCloser
    stdout *bufio.Scanner
}

// 优先使用项目内捆绑的 JRE，避免对宿主 Java 环境的依赖
func resolveJavaBin(appDir string) string {
    // Windows: engine/jre/bin/java.exe；macOS / Linux: engine/jre/bin/java
    return filepath.Join(appDir, "engine", "jre", "bin", javaExecName())
}

func StartEngine(ctx context.Context, appDir string) (*Engine, error) {
    jarPath := filepath.Join(appDir, "engine", "bin", "idb-engine.jar")

    cmd := exec.CommandContext(ctx, resolveJavaBin(appDir),
        "-Xms32m",          // 初始堆内存仅分配 32MB
        "-Xmx64m",          // 最大堆内存严格限制在 64MB
        "-XX:+UseSerialGC", // 桌面端单人使用，开启串行 GC 更省内存
        "-jar", jarPath,
    )
    // 防止 Windows 下弹出 console 子窗口（按平台用 build tag 注入 SysProcAttr）
    applyHideWindow(cmd)

    stdin, err := cmd.StdinPipe()
    if err != nil {
        return nil, err
    }
    stdoutPipe, err := cmd.StdoutPipe()
    if err != nil {
        return nil, err
    }
    // stderr 保留给调试日志，绝不与 stdout 协议流混用
    cmd.Stderr = newStderrLogger()

    if err := cmd.Start(); err != nil {
        return nil, err
    }

    scanner := bufio.NewScanner(stdoutPipe)
    // 默认 64KB 行缓冲过小，分页结果易超限；放宽到 8MB（仍受 §9 大字段熔断保护）
    scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)

    return &Engine{cmd: cmd, stdin: stdin, stdout: scanner}, nil
}

// 单次请求：写入一行 JSON，读取一行 JSON
func (e *Engine) Invoke(reqJSON string) (string, error) {
    if _, err := e.stdin.Write([]byte(reqJSON + "\n")); err != nil {
        return "", err
    }
    if !e.stdout.Scan() {
        if err := e.stdout.Err(); err != nil {
            return "", err
        }
        return "", io.ErrUnexpectedEOF
    }
    return e.stdout.Text(), nil
}

func (e *Engine) Shutdown() {
    if e.stdin != nil {
        _, _ = e.stdin.Write([]byte("CMD_EXIT\n"))
        _ = e.stdin.Close()
    }
    if e.cmd != nil && e.cmd.Process != nil {
        _ = e.cmd.Process.Kill()
    }
}
```

集成到 Wails 生命周期：

```go
// app.go
func (a *App) startup(ctx context.Context) {
    a.ctx = ctx
    appDir, _ := os.Getwd() // dev 模式取工作目录；prod 改用 os.Executable() 推导
    eng, err := StartEngine(ctx, appDir)
    if err != nil {
        runtime.LogErrorf(ctx, "engine start failed: %v", err)
        return
    }
    a.engine = eng
}

func (a *App) shutdown(ctx context.Context) {
    if a.engine != nil {
        a.engine.Shutdown()
    }
}

// 暴露给前端的统一入口
func (a *App) FetchDatabaseData(reqJSON string) string {
    if a.engine == nil {
        return `{"success":false,"error":"engine not ready"}`
    }
    resp, err := a.engine.Invoke(reqJSON)
    if err != nil {
        return `{"success":false,"error":"pipe error: ` + err.Error() + `"}`
    }
    return resp
}
```

要点：
- **`exec.CommandContext`** 让子进程受 Wails ctx 约束，主进程退出可联动取消。
- **`Stderr` 必须独立**，绝不可重定向到 stdout，否则 §5 协议流被污染。
- **行缓冲** 必须放大（默认 `bufio.Scanner` 上限 64KB），同时仍依赖 §9 大字段熔断兜底。
- **平台差异**：`applyHideWindow` 在 Windows 通过 `syscall.SysProcAttr{HideWindow: true, CreationFlags: CREATE_NO_WINDOW}` 隐藏控制台子窗口；macOS / Linux 留空实现，按 build tag 拆文件。
- **Java 路径**：优先用 `engine/jre/bin/java`，不要假设宿主已装 JDK；分发包内置 JRE 是产品形态的一部分。

> 当前 [app.go](app.go) 仅有 `Greet` 桩，引擎启动 / 管道转发逻辑尚未实装，是接下来需要补齐的核心环节。

### 6.2 内存与并发护栏

- **JVM 上限锁死 64MB**：通过启动参数施加，避免引擎抢占主进程内存预算。
- **Wails Webview 目标**：物理常驻 ≤ 150MB（与 §8 大字段熔断协同保障）。
- **管道读超时**：建议在 Go 侧使用带 deadline 的 reader 包装，防止子进程僵死阻塞 UI。

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
- 大字段在序列化前必须按 §8.2 熔断；
- 处理器内部异常须捕获并填充到响应 envelope 的 `error` 字段，绝不让异常打穿到 stdout，否则会污染下一条消息。

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

### 8.3 Tailwind 4 接入

通过 Vite 插件 `@tailwindcss/vite` 注入；样式入口 [layout.css](frontend/src/routes/layout.css) 仅一行：

```css
@import 'tailwindcss';
```

无 `tailwind.config.js`（Tailwind 4 默认零配置）。如需 MD3 设计令牌（颜色、圆角、阴影），通过 CSS 变量 + `@theme` 块在 `layout.css` 中扩展。

### 8.4 状态中心（规划）

```ts
// src/lib/stores/appState.ts（待新建）
import { writable } from 'svelte/store';

export interface ConnectionConfig {
  id: string;
  driver: 'mysql' | 'postgresql';
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

export const activeConnection = writable<ConnectionConfig | null>(null);
```

> 所有写入引擎的请求必须从该 Store 取出 `activeConnection` 拼装 `connection` 字段。Svelte 5 项目可考虑用 `$state` rune + `getContext` 替代经典 `writable`，按团队偏好选型。

### 8.5 Wails JS 绑定

`frontend/wailsjs/go/main/App.js` 由 Wails 自动生成，每个 Go 绑定方法对应一个具名 export。新增 Go 方法后会自动刷新。**不要手工编辑 `wailsjs/` 内任何文件**。

---

## 9. 安全与边界规范

1. **绝对防注入（元数据阻断）**
   表/库结构相关的 DDL/DML 必须使用占位符；引擎层禁止任何形式的字符串拼接 SQL，包括看似"安全"的内部白名单字段。
2. **大字段熔断**
   `BLOB` / `CLOB` / `BYTEA` 或长度 > 2048 字符的文本，引擎层在序列化 JSON 时必须截断为占位 `[LOB Data / Multi-Text Context]`；前端渲染为 MD3 放大镜图标，用户点击触发**单行精准查询**。规避 stdin/stdout 缓冲区被打爆导致 Wails 假死。
3. **分页强约束**
   单页上限 `pageSize ≤ 1000`；前端表格强制虚拟滚动（virtual list），保证 DOM 节点常量级。
4. **凭证生命周期**
   `password` 仅存在于前端 Store + 单次请求 envelope；引擎落到磁盘 / 日志的内容必须脱敏（连接串中的密码字段在 panic / error 路径中务必抹除）。
5. **进程边界纪律**
   - 所有 stdout 写入仅允许 envelope JSON；调试日志写 stderr。
   - Go 侧读取 stdout 必须按行；任何越界换行（如错误堆栈直出）都会破坏协议。

---

## 10. 本地开发与构建

### 10.1 常用命令（Windows / bash）

```bash
# 开发模式（带热重载，devtools 可访问 Go 绑定）
wails dev

# 生产构建
wails build

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
| Wails 项目骨架 | ✅ 已搭建（main.go / app.go / wails.json） |
| SvelteKit + Svelte 5 + Tailwind 4 | ✅ 脚手架就绪，仅 Hello World 页面 |
| Go ↔ JVM 子进程管道 | ⏳ 未实装，仅有 `Greet` 占位 |
| JSON 协议处理器 | ⏳ 待实现（SCHEMA / USER / TABLE / DATA / SQL） |
| 前端连接管理 / 表格视图 / 虚拟滚动 | ⏳ 未开始 |
| MD3 Token / Tailwind theme | ⏳ 未注入 |
| 大字段熔断 / 分页护栏 | ⏳ 未实现 |
| 打包脚本（embed jar + jre） | ⏳ 未配置 |

> 实施顺序建议：先打通 Go ↔ JVM 管道（含 jar 释放与生命周期），再落地一条端到端的最小请求（如 SCHEMA LIST），再补 MD3 设计层与表格视图。
