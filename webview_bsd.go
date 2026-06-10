//go:build !windows && !linux

package main

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// getWebViewMemory 通过 ps 命令递归收集当前进程的 WebKit 后代进程 RSS 总和（字节）。
// 兼容 FreeBSD、macOS 等非 Linux Unix 系统。
func getWebViewMemory() uint64 {
	pid := os.Getpid()
	// -axo: 所有进程, 自定义列; rss 单位 kB
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,rss=,comm=").Output()
	if err != nil {
		return 0
	}

	type procInfo struct {
		name string
		rss  uint64 // bytes
		pid  int
	}
	byParent := map[int][]procInfo{}

	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 4 {
			continue
		}
		p, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		pp, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}
		rssKB, _ := strconv.ParseUint(fields[2], 10, 64)
		name := fields[3]
		byParent[pp] = append(byParent[pp], procInfo{name: name, rss: rssKB * 1024, pid: p})
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
