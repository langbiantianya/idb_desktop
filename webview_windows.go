package main

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// getWebViewMemory 递归收集当前进程的所有 WebView2 后代进程，返回 Working Set 总和（字节）。
func getWebViewMemory() uint64 {
	pid := os.Getpid()
	out, err := exec.Command("powershell", "-NoProfile", "-Command",
		"Get-WmiObject Win32_Process | ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.WorkingSetSize)\" }",
	).Output()
	if err != nil {
		return 0
	}

	type fullProc struct {
		name string
		mem  uint64
		pid  int
	}
	byParent := map[int][]fullProc{}

	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "|", 4)
		if len(parts) < 4 {
			continue
		}
		p, err1 := strconv.Atoi(parts[0])
		pp, err2 := strconv.Atoi(parts[1])
		if err1 != nil || err2 != nil {
			continue
		}
		mem, _ := strconv.ParseUint(parts[3], 10, 64)
		byParent[pp] = append(byParent[pp], fullProc{name: parts[2], mem: mem, pid: p})
	}

	// BFS 从当前进程出发，累加后代中的 msedgewebview2 内存
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
			if strings.Contains(strings.ToLower(child.name), "msedgewebview2") {
				total += child.mem
			}
			queue = append(queue, child.pid)
		}
	}
	return total
}
