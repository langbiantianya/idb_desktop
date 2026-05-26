//go:build !windows

package main

import "os/exec"

func javaExecName() string { return "java" }

// applyHideWindow 在 macOS / Linux 无需特殊处理。
func applyHideWindow(cmd *exec.Cmd) {}
