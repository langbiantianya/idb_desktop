# idb_desktop

本地化的多数据库（**MySQL** / **PostgreSQL**）桌面客户端。

基于 **Wails v2** + **SvelteKit** + **Svelte 5** + **Tailwind CSS 4**，遵循 Material Design 3。

---

## 特色

- **数据导出工作台** — 基于自定义 SQL 的 5 种格式导出（CSV/JSON Lines/SQL INSERT/Excel/Parquet），独立子进程运行，流式进度显示，任务中心支持进度查看和停止
- **造数工作台** — Lua 脚本驱动批量造数，内置 11 个随机函数 + 多 Lua 版本支持 + Monaco 编辑器（关键字/标准库/数据库元数据补全）+ StyLua 格式化 + 流式 SQL 日志
- **函数与存储过程管理** — 查看/创建/编辑/删除 Function、Procedure、Trigger；plpgsql 语法补全；调用执行；EXPLAIN 调试
- **数据浏览与编辑** — 三级树形浏览 + 分页/全量流式 + 虚拟滚动 + 行级 CRUD + 列内筛选
- **SQL 控制台** — Monaco 编辑器 + 按 driver 智能补全 + 多语句执行 + SELECT 流式返回
- **表结构管理** — 新建表向导 + ALTER TABLE Draft 模式编辑器（ADD/MODIFY/DROP + 改名）+ GET_DDL
- **5 种语言** — 简体中文 / 繁体中文 / English / 日本語 / Русский（390+ 翻译 key）
- **MD3 主题** — 亮色 / 暗色 / 跟随系统 + 自定义主题（`~/.config/idb/theme/*.css`）
- **凭证加密** — Windows DPAPI / 非 Windows AES-256-GCM + 本地 key 文件
- **只读保护** — MySQL 系统 Schema 自动拦截写操作

---

## 环境依赖

| 依赖 | 版本 | 备注 |
|---|---|---|
| **Go** | 1.23+ | 主进程编译 |
| **Node.js** | 18+ | 前端构建 |
| **Wails CLI** | v2 | `go install github.com/wailsapp/wails/v2/cmd/wails@latest` |
| **JDK** | 25+ | `make jre-download` 自动下载 Azul Zulu JRE 25 |
| **NSIS** | 任意 | Windows 安装包构建：https://nsis.sourceforge.io/Download |

---

## 快速开始

```bash
# 安装 Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 开发模式（热重载）
make dev

# 生产构建
make build

# 平台安装包
make package-windows    # Windows NSIS
make package-linux      # Linux tar.gz
make package-all        # 双平台
```

| 命令 | 说明 |
|---|---|
| `make dev` | 开发模式 |
| `make build` | 当前平台构建 |
| `make package-windows` | Windows 安装包 |
| `make package-linux` | Linux 分发包 |
| `make jre-download` | 下载 Azul Zulu JRE 25 |
| `make deps` | 依赖自检 |
| `make clean` | 清理构建产物 |

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Wails v2 |
| 主进程 | Go 1.23 |
| 前端 | SvelteKit 2 + Svelte 5 (runes) |
| 样式 | Tailwind CSS 4 + Material Design 3 |
| 编辑器 | Monaco Editor |
| 数据引擎 | JVM 子进程（Kotlin + HikariCP + JDBC） |

---

## 项目结构

```
idb_desktop/
├── app.go / app_dev.go / app_prod.go   # Wails App
├── config.go / settings.go / theme.go  # 配置 / 设置 / 主题
├── engine.go (+ _windows / _unix)      # JVM 进程管理 + 管道协议
├── crypto_windows.go / crypto_other.go # 密码加密
├── main.go / Makefile
├── engine/
│   ├── bin/idb-engine.jar              # 数据引擎
│   └── jre/                            # Azul Zulu JRE 25
├── themes/                             # 内置主题
├── scripts/                            # 打包脚本
└── frontend/
    └── src/
        ├── lib/api/                    # 引擎 API 层
        ├── lib/i18n/                   # 5 种语言
        ├── lib/components/            # 22 个 Svelte 组件
        └── routes/
            ├── +page.svelte           # 连接选择
            ├── setup/                 # 首次引导
            ├── settings/              # 设置页
            └── workspace/             # 数据库工作台
```

详细架构、协议契约、安全规范见 [CLAUDE.md](CLAUDE.md)。
