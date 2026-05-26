package main

import (
	"context"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 持有 Wails 上下文与底层 JVM 引擎实例。
// 所有暴露给前端的方法都以此结构体的方法形式声明，由 Wails 自动生成 JS 绑定。
type App struct {
	ctx    context.Context
	engine *Engine
}

func NewApp() *App {
	return &App{}
}

// startup 在 Wails 主窗口创建后调用，用于拉起底层数据引擎。
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	eng, err := StartEngine(ctx)
	if err != nil {
		wruntime.LogErrorf(ctx, "engine start failed: %v", err)
		return
	}
	a.engine = eng
	wruntime.LogInfof(ctx, "engine started, pid=%d", eng.cmd.Process.Pid)
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
	resp, err := a.engine.Invoke(reqJSON)
	if err != nil {
		return `{"success":false,"error":"pipe error: ` + escapeJSONString(err.Error()) + `"}`
	}
	return resp
}

// escapeJSONString 仅处理 envelope error 字段中可能出现的控制字符与引号。
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
