package main

import (
	"context"
	"encoding/json"
	"fmt"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 持有 Wails 上下文与底层 JVM 引擎实例。
// 所有暴露给前端的方法都以此结构体的方法形式声明，由 Wails 自动生成 JS 绑定。
type App struct {
	ctx    context.Context
	engine *Engine
	cfg    *configStore
}

func NewApp() *App {
	return &App{cfg: &configStore{}}
}

// startup 在 Wails 主窗口创建后调用，用于拉起底层数据引擎。
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 首次启动：部署内置主题到 ~/.config/idb/theme/
	if err := deployBundledThemes(); err != nil {
		wruntime.LogWarningf(ctx, "deploy bundled themes failed: %v", err)
	}

	// 读取 JVM 内存配置
	settings, _ := a.cfg.LoadSettings()
	maxMem := settings.JvmMaxMemoryMB

	eng, err := StartEngine(ctx, maxMem)
	if err != nil {
		wruntime.LogErrorf(ctx, "engine start failed: %v", err)
		return
	}
	a.engine = eng
	wruntime.LogInfof(ctx, "engine started, pid=%d, -Xmx%dm", eng.cmd.Process.Pid, maxMem)
}

// shutdown 在主窗口关闭前调用，回收子进程。
func (a *App) shutdown(ctx context.Context) {
	if a.engine != nil {
		a.engine.Shutdown()
		a.engine = nil
	}
}

// FetchDatabaseData 是前端访问引擎的统一入口。
// 入参为 §5.1 请求 envelope 的单行 JSON，出参为 §5.2 响应 envelope 的单行 JSON。
// 任何管道层错误也会以响应 envelope 的形式返回，前端无需区分错误来源。
func (a *App) FetchDatabaseData(reqJSON string) string {
	if a.engine == nil {
		return `{"success":false,"error":"engine not ready"}`
	}
	resp, err := a.engine.Invoke(a.ctx, reqJSON)
	if err != nil {
		return `{"success":false,"error":"pipe error: ` + escapeJSONString(err.Error()) + `"}`
	}
	return resp
}

// FetchDatabaseDataStreaming 发送流式请求。
// 如果引擎返回 stream:true，响应通过 Wails 事件逐行推送，本函数立即返回确认信封；
// 如果引擎返回 stream:false（引擎不支持流式或非流式场景），本函数等待完整响应并直接返回。
func (a *App) FetchDatabaseDataStreaming(reqJSON string) string {
	if a.engine == nil {
		return `{"success":false,"error":"engine not ready"}`
	}

	// 先尝试 Invoke（等第一个响应）
	resp, err := a.engine.Invoke(a.ctx, reqJSON)
	if err != nil {
		return `{"success":false,"error":"pipe error: ` + escapeJSONString(err.Error()) + `"}`
	}

	// 解析首个响应，判断是否流式
	var meta struct {
		ID     string `json:"id"`
		Stream bool   `json:"stream"`
	}
	if err := json.Unmarshal([]byte(resp), &meta); err == nil && meta.Stream {
		// 流式响应：readLoop 已将此条通过事件推送，返回确认信封
		return `{"id":"` + meta.ID + `","success":true,"stream":true}`
	}

	// 非流式响应：直接返回原始响应
	return resp
}

// ListConnections 返回所有保存的连接（不含密码本身，仅 hasPassword 标记）。
func (a *App) ListConnections() ([]SavedConnection, error) {
	return a.cfg.listConnections()
}

// GetConnectionPassword 解密并返回某条连接的密码；未保存返回空串。
// 解密失败（key 缺失 / 密文损坏 / 跨用户拷贝）会带错误返回。
func (a *App) GetConnectionPassword(id string) (string, error) {
	return a.cfg.getPassword(id)
}

// SaveConnection 新建或覆盖。input.id 为空时分配新 id。
// savePassword=false 时密码不入文件，下次需要用户手动填。
func (a *App) SaveConnection(input SaveConnectionInput) (SavedConnection, error) {
	return a.cfg.saveConnection(input)
}

// DeleteConnection 按 id 删除（幂等）。
func (a *App) DeleteConnection(id string) error {
	return a.cfg.deleteConnection(id)
}

// IsDevMode 暴露给前端判断当前是否为开发模式（wails dev）。
func (a *App) IsDevMode() bool {
	return isDevBuild()
}

// RestartEngine 关闭当前引擎并以新配置重启（用于 JVM 内存变更后）。
func (a *App) RestartEngine() error {
	// 关闭旧引擎
	if a.engine != nil {
		a.engine.Shutdown()
		a.engine = nil
	}

	// 读取最新设置
	settings, err := a.cfg.LoadSettings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}
	maxMem := settings.JvmMaxMemoryMB

	eng, err := StartEngine(a.ctx, maxMem)
	if err != nil {
		return fmt.Errorf("restart engine: %w", err)
	}
	a.engine = eng
	wruntime.LogInfof(a.ctx, "engine restarted, pid=%d, -Xmx%dm", eng.cmd.Process.Pid, maxMem)
	return nil
}

// ---------- 主题管理 ----------

// ListThemes 扫描 ~/.config/idb/theme/*.css 并返回主题列表。
func (a *App) ListThemes() ([]ThemeInfo, error) {
	return a.cfg.ListThemes()
}

// GetThemeCSS 读取指定主题的完整 CSS 内容。
func (a *App) GetThemeCSS(id string) (string, error) {
	return a.cfg.GetThemeCSS(id)
}

// LoadSettings 从 ~/.config/idb/settings.json 读取应用设置。
func (a *App) LoadSettings() (AppSettings, error) {
	return a.cfg.LoadSettings()
}

// SaveSettings 写入应用设置到 ~/.config/idb/settings.json。
func (a *App) SaveSettings(input AppSettings) error {
	return a.cfg.SaveSettings(input)
}
// 不引入 encoding/json 是为了避免在已有 envelope 字符串外再做一次完整序列化的开销。
func escapeJSONString(s string) string {
	out := make([]byte, 0, len(s)+8)
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"', '\\':
			out = append(out, '\\', c)
		case '\n':
			out = append(out, '\\', 'n')
		case '\r':
			out = append(out, '\\', 'r')
		case '\t':
			out = append(out, '\\', 't')
		default:
			if c < 0x20 {
				continue
			}
			out = append(out, c)
		}
	}
	return string(out)
}
