# idb_desktop

本地化、绿色启动的多数据库运维桌面客户端，支持 **MySQL** 和 **PostgreSQL**。

基于 **Wails v2** + **SvelteKit** + **Svelte 5** + **Tailwind CSS 4** 构建，采用 Material Design 3 设计语言。

---

## 特性

- **零端口通信** — 前端与 Go 主进程通过 Wails 原生 IPC 通信，Go 与 JVM 引擎通过 stdin/stdout 管道通信，全程不开本地网络端口
- **连接配置管理** — 保存/加载/删除连接配置，密码使用操作系统级加密（Windows DPAPI / AES-256-GCM）
- **数据库浏览** — 三级懒加载树形浏览器：Schema → Table → Column，支持筛选和右键操作
- **数据查看与编辑** — 分页数据表格，类型感知渲染（时间类型、LOB 大字段熔断查看），行级增删改
- **SQL 控制台** — Monaco 编辑器，智能自动补全（Schema / Table / Column / 关键字），多语句执行，SQL 格式化
- **表结构管理** — 新建表向导 + 表结构编辑器（Draft 模式列编辑，支持添加/修改/删除列）
- **用户权限管理** — 用户列表查看，GRANT / REVOKE 权限操作
- **主题系统** — 亮色 / 暗色 / 跟随系统三种模式，MD3 完整令牌注入
- **只读保护** — MySQL 系统 Schema（sys, performance_schema, mysql, information_schema）自动拦截写操作

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Wails v2 |
| 主进程 | Go 1.23 |
| 前端框架 | SvelteKit 2 + Svelte 5 (runes) |
| 样式 | Tailwind CSS 4 + Material Design 3 |
| SQL 编辑器 | Monaco Editor |
| 数据引擎 | JVM 子进程（stdin/stdout JSON 管道协议） |
| 构建工具 | Vite 8 |

---

## 前置条件

- **Go** 1.23+
- **Node.js** 18+（含 npm）
- **Wails CLI** v2（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`）
- **Java** 8+（用于运行 `engine/bin/idb-engine.jar`；后续版本将捆绑精简 JRE）

---

## 快速开始

```bash
# 安装 Wails CLI（如未安装）
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 安装前端依赖
cd frontend && npm install && cd ..

# 开发模式（带热重载）
wails dev

# 生产构建
wails build
```

---

## 项目结构

```
idb_desktop/
├── app.go                  # Wails App：生命周期钩子 + 前端绑定方法
├── config.go               # 连接配置持久化
├── crypto_windows.go       # Windows DPAPI 加密
├── crypto_other.go         # AES-256-GCM 加密（非 Windows）
├── engine.go               # JVM 子进程生命周期 + 异步并发管道协议
├── engine_windows.go       # Windows 平台隐藏控制台子窗口
├── engine_unix.go          # macOS / Linux 平台空实现
├── main.go                 # Wails 启动入口
├── engine/
│   └── bin/idb-engine.jar  # 数据引擎
├── frontend/
│   └── src/
│       ├── lib/
│       │   ├── api/        # 引擎通信 API 层
│       │   ├── components/ # 14 个 Svelte 组件
│       │   └── stores/     # Svelte 状态管理
│       └── routes/         # 路由页面
└── build/                  # 构建资源
```

---

## 架构

```
┌─────────────────────────────────────────────────┐
│  前端 UI — SvelteKit SPA + Svelte 5 runes       │
│         │ Wails 原生内存 IPC（无网络）            │
│         ▼                                        │
│  中间控制层 — Go 主进程                           │
│         │ stdin/stdout JSON 管道（无网络）         │
│         ▼                                        │
│  数据引擎 — JVM 无状态子进程                      │
│         │ JDBC + 参数化绑定                       │
│         ▼                                        │
│  目标数据库 — MySQL / PostgreSQL                  │
└─────────────────────────────────────────────────┘
```

---

## 开发命令

```bash
# 开发模式（热重载，可访问 Go 绑定）
wails dev

# 生产构建
wails build

# 仅前端开发（调试样式时方便）
cd frontend && npm run dev

# 前端格式化 / Lint
cd frontend && npm run format
cd frontend && npm run lint
```

---

## License

Private project.
