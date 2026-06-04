//go:build !windows

package main

import (
	"syscall"
)

// systemMemoryMB 返回系统物理内存总量（MB）。
func systemMemoryMB() int {
	var si syscall.Sysinfo_t
	if err := syscall.Sysinfo(&si); err != nil {
		return 0
	}
	return int(si.Totalram / 1024 / 1024)
}
