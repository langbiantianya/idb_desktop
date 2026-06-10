//go:build linux

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// getWebViewMemory 递归收集当前进程的所有 WebKitGTK 后代进程，返回 RSS 总和（字节）。
func getWebViewMemory() uint64 {
	pid := os.Getpid()

	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0
	}

	type procInfo struct {
		name string
		rss  uint64 // bytes
		pid  int
	}
	byParent := map[int][]procInfo{}

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		pp, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		// 读 /proc/[pid]/stat — 字段 1=名称(含括号), 字段 4=PPID
		stat, err := os.ReadFile(filepath.Join("/proc", e.Name(), "stat"))
		if err != nil {
			continue
		}
		// 名称在最后一个 ')' 之后
		idx := bytes.LastIndexByte(stat, ')')
		if idx < 0 || idx+2 >= len(stat) {
			continue
		}
		name := string(stat[4:idx]) // 去掉 PID 和 '('
		fields := strings.Fields(string(stat[idx+2:]))
		if len(fields) < 1 {
			continue
		}
		ppid, err := strconv.Atoi(fields[0]) // 第 4 个字段（跳过了 name 和 state）
		if err != nil {
			continue
		}

		// 读 /proc/[pid]/status — VmRSS
		var rss uint64
		status, err := os.ReadFile(filepath.Join("/proc", e.Name(), "status"))
		if err == nil {
			for _, line := range strings.Split(string(status), "\n") {
				if strings.HasPrefix(line, "VmRSS:") {
					f := strings.Fields(line)
					if len(f) >= 2 {
						kb, _ := strconv.ParseUint(f[1], 10, 64)
						rss = kb * 1024
					}
					break
				}
			}
		}

		byParent[ppid] = append(byParent[ppid], procInfo{name: name, rss: rss, pid: pp})
	}

	// BFS 从当前进程出发
	total := uint64(0)
	queue := []int{pid}
	visited := map[int]bool{pid: true}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, child := range byParent[cur] {
			if visited[child.pid] {
				continue
			}
			visited[child.pid] = true
			lower := strings.ToLower(child.name)
			if strings.Contains(lower, "webkit") || strings.Contains(lower, "webprocess") {
				total += child.rss
			}
			queue = append(queue, child.pid)
		}
	}
	return total
}
