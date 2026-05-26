package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

// Engine 封装 JVM 子进程的生命周期与单工管道协议。
// 所有方法在协议语义上同步：一次 Invoke 等价于"写一行 + 读一行"。
type Engine struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Scanner

	mu     sync.Mutex // 串行化 Invoke，保证一行请求对应一行响应
	closed bool
}

// 行缓冲上限：默认 64KB 容易被分页结果撑爆，放宽到 8MB；
// 仍依赖大字段熔断（CLAUDE.md §9）做语义层兜底。
const engineMaxLine = 8 * 1024 * 1024

// resolveAppDir 推导引擎资源所在目录。
//   - 生产分发：取可执行文件目录（engine/ 与可执行文件同级）。
//   - dev 模式（wails dev）：可执行文件位于临时目录，回退到 CWD。
func resolveAppDir() string {
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if _, err := os.Stat(filepath.Join(dir, "engine", "bin", "idb-engine.jar")); err == nil {
			return dir
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "."
}

func resolveJavaBin(appDir string) string {
	return filepath.Join(appDir, "engine", "jre", "bin", javaExecName())
}

func resolveJarPath(appDir string) string {
	return filepath.Join(appDir, "engine", "bin", "idb-engine.jar")
}

// StartEngine 拉起 JVM 子进程，建立 stdin/stdout 行协议管道。
func StartEngine(ctx context.Context) (*Engine, error) {
	appDir := resolveAppDir()
	javaBin := resolveJavaBin(appDir)
	jarPath := resolveJarPath(appDir)

	if _, err := os.Stat(javaBin); err != nil {
		return nil, fmt.Errorf("java binary not found at %s: %w", javaBin, err)
	}
	if _, err := os.Stat(jarPath); err != nil {
		return nil, fmt.Errorf("engine jar not found at %s: %w", jarPath, err)
	}

	cmd := exec.CommandContext(ctx, javaBin,
		"-Xms32m",          // 初始堆 32MB
		"-Xmx64m",          // 最大堆锁死 64MB
		"-XX:+UseSerialGC", // 桌面单人使用，串行 GC 更省内存
		"-jar", jarPath,
	)
	cmd.Dir = appDir
	applyHideWindow(cmd) // 平台分支：Windows 隐藏 console；其他平台空实现

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	// stderr 独立到日志，绝不混入 stdout 协议流
	cmd.Stderr = newStderrLogger()

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start engine: %w", err)
	}

	scanner := bufio.NewScanner(stdoutPipe)
	scanner.Buffer(make([]byte, 0, 64*1024), engineMaxLine)

	return &Engine{
		cmd:    cmd,
		stdin:  stdin,
		stdout: scanner,
	}, nil
}

// Invoke 写入一行 JSON 请求，读取一行 JSON 响应。
// 调用方负责保证 reqJSON 不含裸换行（envelope 序列化必须为单行压缩 JSON）。
func (e *Engine) Invoke(reqJSON string) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed {
		return "", errors.New("engine already closed")
	}

	if _, err := e.stdin.Write([]byte(reqJSON + "\n")); err != nil {
		return "", fmt.Errorf("pipe write: %w", err)
	}
	if !e.stdout.Scan() {
		if err := e.stdout.Err(); err != nil {
			return "", fmt.Errorf("pipe read: %w", err)
		}
		return "", io.ErrUnexpectedEOF
	}
	return e.stdout.Text(), nil
}

// Shutdown 优雅关闭：先发 CMD_EXIT 让引擎自清理，必要时 Kill 兜底。
func (e *Engine) Shutdown() {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.closed {
		return
	}
	e.closed = true

	if e.stdin != nil {
		_, _ = e.stdin.Write([]byte("CMD_EXIT\n"))
		_ = e.stdin.Close()
	}
	if e.cmd != nil && e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
		_, _ = e.cmd.Process.Wait()
	}
}

// stderrLogger 把引擎 stderr 行打到 Go log，便于联调。
type stderrLogger struct{}

func newStderrLogger() io.Writer { return &stderrLogger{} }

func (l *stderrLogger) Write(p []byte) (int, error) {
	log.Printf("[engine.stderr] %s", p)
	return len(p), nil
}
