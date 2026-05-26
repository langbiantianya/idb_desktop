//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func javaExecName() string { return "java.exe" }

// applyHideWindow 隐藏 java.exe 的 console 窗口，并阻止子进程窗口闪现。
func applyHideWindow(cmd *exec.Cmd) {
	const createNoWindow = 0x08000000 // CREATE_NO_WINDOW
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
