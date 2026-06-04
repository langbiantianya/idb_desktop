# idb_desktop

本地化、绿色启动的多数据库运维桌面客户端，支持 **MySQL** 和 **PostgreSQL**。

基于 **Wails v2** + **SvelteKit** + **Svelte 5** + **Tailwind CSS 4** 构建，采用 Material Design 3 设计语言。

---

## 特性

- **零端口通信** — 前端与 Go 主进程通过 Wails 原生 IPC 通信，Go 与 JVM 引擎通过 stdin/stdout 管道通信，全程不开本地网络端口
- **连接配置管理** — 保存/加载/删除连接配置，密码使用操作系统级加密（Windows DPAPI / 非 Windows AES-256-GCM + 本地 key）
- **数据库浏览** — 三级懒加载树形浏览器：Schema → Table → Column，支持筛选和右键操作
- **数据查看与编辑** — 分页数据表格（20/50/100/200/500/全量），支持全量流式加载，类型感知渲染（时间类型、LOB 大字段熔断查看），行级增删改；表头双行布局：标题/工具栏（上）+ WHERE 条件 + ORDER BY 排序（下，中间分割线）；列内筛选 + 顶部搜索
- **SQL 控制台** — Monaco 编辑器，智能自动补全（按 driver 区分 Schema / Table / Column / 关键字），多语句执行，SQL 格式化（sql-formatter），SELECT 自动流式响应
- **表结构管理** — 新建表向导 + 表结构编辑器（Draft 模式列编辑，支持 ADD / MODIFY / DROP COLUMN，支持字段改名 + GET_DDL）
- **用户权限管理** — 用户列表查看，GRANT / REVOKE 权限操作
- **主题系统** — 亮色 / 暗色 / 跟随系统三种模式，MD3 完整令牌注入，支持从 `~/.config/idb/theme/*.css` 加载自定义主题（内置赛博朋克主题）
- **多语言** — 简体中文 / 繁体中文 / English / 日本語 / Русский 五种语言，首次启动引导选择
- **只读保护** — MySQL 系统 Schema（sys, performance_schema, mysql, information_schema）自动拦截写操作 + 写关键字检测
- **首次引导** — 首次启动自动进入引导页（`/setup`），选择语言和主题模式
- **设置页** — 独立设置页面（`/settings`），管理语言、主题模式、自定义主题、内存刷新频率、系统信息展示
- **系统信息** — 设置页展示 JVM/OS/CPU/内存详情，workspace 底部实时内存占用条（可配置 1-10s 刷新频率）
- **JVM 内存配置** — 设置页可配置 JVM 最大堆内存（64-4096MB，默认 256MB），一键重启引擎生效
- **双路由设计** — 连接选择页（`/`）与数据库工作台（`/workspace`）分离
- **WHERE / ORDER BY 双重校验** — 前端方言级禁止关键字扫描 + 引擎侧二次校验

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Wails v2 |
| 主进程 | Go 1.23 |
| 前端框架 | SvelteKit 2 + Svelte 5 (runes) |
| 样式 | Tailwind CSS 4 + Material Design 3 |
| SQL 编辑器 | Monaco Editor |
| 数据引擎 | JVM 子进程（stdin/stdout JSON 管道协议 + 流式响应） |
| 构建工具 | Vite 8 + Makefile |

---

## 前置条件

- **Go** 1.23+
- **Node.js** 18+（含 npm）
- **Wails CLI** v2（`go install github.com/wailsapp/wails/v2/cmd/wails@latest`）
- **Java** 8+（`make jre-download` 自动下载 Azul Zulu JRE 21）
- **NSIS**（Windows 安装包构建需要，`https://nsis.sourceforge.io/Download`）
- **GNU coreutils**（make jre-download 用到 `mktemp` / `grep -E`）

---

## 快速开始

```bash
# 安装 Wails CLI（如未安装）
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 开发模式（热重载，右键可打开 DevTools）
make dev
# 或
wails dev

# 生产构建
make build

# Windows 安装包
make package-windows

# Linux 分发包
make package-linux
```

---

## Makefile 命令

| 命令 | 说明 |
|---|---|
| `make dev` | 开发模式（热重载） |
| `make build` | 当前平台构建 |
| `make package-windows` | Windows NSIS 安装包 |
| `make package-linux` | Linux tar.gz 分发包 |
| `make package-all` | 双平台构建 |
| `make jre-download` | 下载 Azul Zulu JRE 21 到 `engine/jre/` |
| `make deps` | 依赖自检（go / node / npm / wails 是否就绪） |
| `make clean` | 清理构建产物 |

---

## 项目结构

```
idb_desktop/
├── app.go                  # Wails App：生命周期钩子 + 前端绑定方法
├── app_dev.go / app_prod.go # dev/prod 构建标识
├── config.go               # 连接配置持久化（~/.config/idb/connections.json）
├── settings.go             # 应用设置持久化（~/.config/idb/settings.json）
├── theme.go                # 主题文件扫描/读取/部署（~/.config/idb/theme/*.css）
├── mem_windows.go          # Windows 系统内存检测
├── mem_unix.go             # Linux/macOS 系统内存检测
├── crypto_windows.go       # Windows DPAPI 加密
├── crypto_other.go         # AES-256-GCM 加密（非 Windows，密钥存于 ~/.config/idb/key）
├── engine.go               # JVM 子进程生命周期 + 异步并发管道 + 流式响应（事件推送）
├── engine_windows.go       # Windows 平台隐藏控制台子窗口
├── engine_unix.go          # macOS / Linux 平台空实现
├── main.go                 # Wails 启动入口
├── Makefile                # 构建 / 打包 / JRE 下载 / 依赖检查
├── engine/
│   ├── bin/
│   │   ├── idb-engine.jar  # 数据引擎入口（Kotlin + HikariCP + JDBC）
│   │   ├── libs/           # 运行时依赖（HikariCP / kotlinx-serialization / logback / SLF4J）
│   │   └── drivers/        # JDBC 驱动（mysql-connector-j、postgresql）
│   └── jre/                # Azul Zulu JRE 21（make jre-download 自动下载）
├── themes/                 # 内置主题（首次启动部署到 ~/.config/idb/theme/）
│   └── cyberpunk-dark.css  # 赛博朋克深色主题
├── scripts/
│   └── package-linux.sh    # Linux 打包脚本
├── frontend/
│   └── src/
│       ├── lib/
│       │   ├── api/         # 引擎通信 API（invoke + invokeStreaming + 连接管理 + 主题/设置 + 响应归一化）
│       │   ├── i18n/        # 多语言支持（zh-CN / zh-TW / en / ja / ru）
│       │   ├── components/  # 15 个 Svelte 组件（含 MonacoInput 单行输入封装）
│       │   ├── stores/      # Svelte 状态管理（appState / themeStore / toasts）
│       │   ├── monaco/      # Monaco Worker 初始化
│       │   ├── readonly.js  # 只读系统库保护
│       │   ├── temporal.js  # 时间类型格式化
│       │   ├── sqlValidate.js   # WHERE / ORDER BY 方言级校验
│       │   ├── sqlCompletion.js # Monaco 补全项源（按 driver 区分）
│       │   └── assets/      # 内联 SVG / 图标
│       └── routes/
│           ├── +page.svelte        # 连接选择页
│           ├── setup/
│           │   └── +page.svelte    # 首次引导页（语言选择 + 主题选择，MD3 动画）
│           ├── settings/
│           │   └── +page.svelte    # 设置页（语言/主题/性能/系统信息）
│           └── workspace/
│               └── +page.svelte    # 数据库工作台
└── build/                  # 构建资源（NSIS、manifest、icon）
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
