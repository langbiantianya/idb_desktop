package main

import (
	"embed"
	"fmt"
	"syscall"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/build
var assets embed.FS

var (
	user32         = syscall.NewLazyDLL("user32.dll")
	procKeybdEvent = user32.NewProc("keybd_event")
)

const (
	VK_F12          = 0x7B
	KEYEVENTF_KEYUP = 0x0002
)

func pressF12() {
	procKeybdEvent.Call(uintptr(VK_F12), 0, 0, 0)
	procKeybdEvent.Call(uintptr(VK_F12), 0, uintptr(KEYEVENTF_KEYUP), 0)
}

func main() {
	app := NewApp()

	// 不设置自定义 Menu，保留 Wails 默认菜单（含 dev 模式内置快捷键）。
	// Help → Developer Tools 通过前端 runtime WindowExecJS 触发。
	// 菜单注册移到 app.startup 中通过 runtime.Menu* API 动态追加。

	err := wails.Run(&options.App{
		Title:  "IDB Desktop",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		fmt.Println("Error:", err.Error())
	}
}
