package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Engine 封装 JVM 子进程的生命周期与基于 id 的异步管道协议。
// 多个 Invoke 可以并发：写入按 writeMu 互斥（保证两条 JSON 不交错），
// 响应由独立 reader goroutine 按 envelope 的 id 字段路由到对应等待者。
type Engine struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Scanner
	ctx    context.Context // 用于 Wails EventsEmit

	writeMu sync.Mutex // 仅在写入 stdin 期间持有

	pendMu  sync.Mutex
	pending map[string]chan string // id → 等待者 channel（容量 1）

	done      chan struct{} // reader 退出 / 引擎死掉时关闭
	closeOnce sync.Once
	closeErr  error // 终止原因，新请求和等待中的请求都会拿到它

	batcher *streamBatcher // 流式消息攒批器，减少 IPC 次数
}

// 行缓冲上限：默认 64KB 容易被分页结果撑爆，放宽到 8MB；
// 仍依赖大字段熔断（CLAUDE.md §9）做语义层兜底。
const engineMaxLine = 8 * 1024 * 1024

// streamBatcher 将流式响应攒批后一次性通过 Wails EventsEmit 推送，避免高频 IPC 淹没前端 UI 线程。
// 数据消息（stream=true, end=false）先缓冲，每 100ms 或收到 end 消息时一次性 emit 数组；
// end 消息（stream=true, end=true）触发立即 flush（含缓冲数据 + end 事件），保证前端收到 end 时所有数据已送达。
type streamBatcher struct {
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	bufs   map[string]*streamBuf // id → 缓冲区
}

type streamBuf struct {
	msgs []string
}

func newStreamBatcher(parent context.Context) *streamBatcher {
	ctx, cancel := context.WithCancel(parent)
	sb := &streamBatcher{ctx: ctx, cancel: cancel, bufs: make(map[string]*streamBuf)}
	go sb.loop()
	return sb
}

func (sb *streamBatcher) loop() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-sb.ctx.Done():
			sb.flushAll()
			return
		case <-ticker.C:
			sb.flushAll()
		}
	}
}

// flushAll 一次性 emit 所有已缓冲的流式消息。
func (sb *streamBatcher) flushAll() {
	sb.mu.Lock()
	if len(sb.bufs) == 0 {
		sb.mu.Unlock()
		return
	}
	snap := make(map[string][]string, len(sb.bufs))
	for id, b := range sb.bufs {
		if len(b.msgs) > 0 {
			snap[id] = b.msgs
			b.msgs = b.msgs[:0]
		}
	}
	sb.mu.Unlock()

	for id, msgs := range snap {
		if len(msgs) == 1 {
			wruntime.EventsEmit(sb.ctx, "engine:stream:"+id, msgs[0])
		} else {
			wruntime.EventsEmit(sb.ctx, "engine:stream:"+id, msgs)
		}
	}
}

// push 缓冲一条流式消息。如果 msg 是 end（end=true），立即 flush 该 id 的所有缓冲消息
// 并单独 emit end 事件，保证前端收到 end 时数据已全部送达。
func (sb *streamBatcher) push(id, msg string, end bool) {
	if end {
		// end 消息：先 flush 缓冲数据，再单独 emit end 事件
		sb.mu.Lock()
		b := sb.bufs[id]
		var pending []string
		if b != nil {
			pending = b.msgs
			b.msgs = b.msgs[:0]
			delete(sb.bufs, id)
		}
		sb.mu.Unlock()

		for _, m := range pending {
			wruntime.EventsEmit(sb.ctx, "engine:stream:"+id, m)
		}
		wruntime.EventsEmit(sb.ctx, "engine:stream-end:"+id, msg)
		return
	}

	// 数据消息：缓冲
	sb.mu.Lock()
	b, ok := sb.bufs[id]
	if !ok {
		b = &streamBuf{}
		sb.bufs[id] = b
	}
	b.msgs = append(b.msgs, msg)
	sb.mu.Unlock()
}

func (sb *streamBatcher) stop() { sb.cancel() }

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

// StartEngine 拉起 JVM 子进程，建立 stdin/stdout 行协议管道，并启动 reader goroutine。
// maxMemoryMB 为 JVM 最大堆内存（MB），传 0 使用默认值（系统内存 70%）。
func StartEngine(ctx context.Context, maxMemoryMB int) (*Engine, error) {
	if maxMemoryMB < 64 {
		maxMemoryMB = defaultJvmMemoryMB()
	}
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
		"-Xms32m",
		fmt.Sprintf("-Xmx%dm", maxMemoryMB),
		"-XX:+UseSerialGC",
		"-XX:NewRatio=1",              // young:old = 1:1，young gen 更大 → 更频繁 minor GC 及时回收短命对象
		"-XX:MaxTenuringThreshold=6",  // 更早晋升 old gen（默认 15），减少 survivor 来回拷贝开销
		"-XX:MinHeapFreeRatio=10",     // 堆空闲低于 10% 时扩容
		"-XX:MaxHeapFreeRatio=25",     // 堆空闲高于 25% 时缩容，主动还内存给 OS
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

	e := &Engine{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  scanner,
		ctx:     ctx,
		pending: make(map[string]chan string),
		done:    make(chan struct{}),
		batcher: newStreamBatcher(ctx),
	}

	go e.readLoop()

	return e, nil
}

// readLoop 单 goroutine 消费 stdout 行，按 id 路由到 pending channel。
// 支持流式响应：stream=true 的消息通过 Wails EventsEmit 推送到前端，
// 直到 end=true 时才从 pending 中移除并通知 channel。
// 看到 EOF / 缓冲超限 / 任何 scanner 错误即调 closeAll 终止整个 engine。
func (e *Engine) readLoop() {
	for e.stdout.Scan() {
		line := e.stdout.Text()
		var meta struct {
			ID     string `json:"id"`
			Stream bool   `json:"stream"`
			End    bool   `json:"end"`
		}
		if err := json.Unmarshal([]byte(line), &meta); err != nil || meta.ID == "" {
			log.Printf("[engine] orphan response (no id): %s", truncateForLog(line))
			continue
		}

		if meta.Stream {
			// 流式响应：数据消息走 batcher 攒批，end 消息立即 flush + emit
			e.batcher.push(meta.ID, line, meta.End)

			if meta.End {
				// 流结束：从 pending 移除（前端通过事件接收结束信号）
				e.pendMu.Lock()
				delete(e.pending, meta.ID)
				e.pendMu.Unlock()
			} else {
				// 流式数据行：尝试写 channel 唤醒 Invoke。
				// 首条消息会成功（Invoke 在等待），后续消息会被 drop（Invoke 已返回）。
				e.pendMu.Lock()
				ch, ok := e.pending[meta.ID]
				e.pendMu.Unlock()
				if ok {
					select {
					case ch <- line:
					default:
					}
				}
			}
			continue
		}

		// 非流式响应：与之前逻辑一致
		e.pendMu.Lock()
		ch, ok := e.pending[meta.ID]
		if ok {
			delete(e.pending, meta.ID)
		}
		e.pendMu.Unlock()

		if !ok {
			log.Printf("[engine] orphan response: id=%s", meta.ID)
			continue
		}
		select {
		case ch <- line:
		default:
			log.Printf("[engine] dropped response for id=%s (channel full)", meta.ID)
		}
	}

	err := e.stdout.Err()
	if err == nil {
		err = io.ErrUnexpectedEOF
	}
	e.closeAll(fmt.Errorf("engine pipe closed: %w", err))
}

// closeAll 在 reader 退出时调用一次：关闭 done、给所有 pending 发失败响应、清空 map。
// 由 closeOnce 保护，可被 Shutdown 与 reader 同时调用而只执行一次。
func (e *Engine) closeAll(reason error) {
	e.closeOnce.Do(func() {
		e.closeErr = reason
		close(e.done)

		e.pendMu.Lock()
		pend := e.pending
		e.pending = map[string]chan string{}
		e.pendMu.Unlock()

		errMsg := "engine pipe closed"
		if reason != nil {
			errMsg = reason.Error()
		}
		for id, ch := range pend {
			// 非流式等待者：通过 channel 返回错误 envelope
			synth := fmt.Sprintf(`{"id":%q,"success":false,"error":%q}`, id, errMsg)
			select {
			case ch <- synth:
			default:
			}
			// 流式等待者：flush 缓冲数据后通过事件通知前端流结束（带错误信息）
			errEvent := fmt.Sprintf(`{"id":%q,"success":false,"error":%q,"stream":true,"end":true}`, id, errMsg)
			e.batcher.push(id, errEvent, true)
		}
	})
}

// Invoke 写入一行 JSON 请求，等待对应 id 的响应行返回（非流式）。
// reqJSON 必须是单行压缩 JSON，且包含非空字符串字段 "id"。
// 任意一路触发：响应到达 / ctx 取消 / 引擎终止。
func (e *Engine) Invoke(ctx context.Context, reqJSON string) (string, error) {
	var meta struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(reqJSON), &meta); err != nil {
		return "", fmt.Errorf("invalid request envelope: %w", err)
	}
	if meta.ID == "" {
		return "", errors.New("invalid request envelope: missing id")
	}

	ch := make(chan string, 1)

	e.pendMu.Lock()
	if e.closeErr != nil {
		e.pendMu.Unlock()
		return "", e.closeErr
	}
	if _, dup := e.pending[meta.ID]; dup {
		e.pendMu.Unlock()
		return "", fmt.Errorf("duplicate request id %s", meta.ID)
	}
	e.pending[meta.ID] = ch
	e.pendMu.Unlock()

	cleanup := func() {
		e.pendMu.Lock()
		delete(e.pending, meta.ID)
		e.pendMu.Unlock()
	}

	e.writeMu.Lock()
	_, werr := e.stdin.Write([]byte(reqJSON + "\n"))
	e.writeMu.Unlock()
	if werr != nil {
		cleanup()
		return "", fmt.Errorf("pipe write: %w", werr)
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-ctx.Done():
		cleanup()
		return "", ctx.Err()
	case <-e.done:
		// closeAll 已经向 ch 写过失败响应；优先返回它，让前端拿到结构化 envelope。
		select {
		case resp := <-ch:
			return resp, nil
		default:
			return "", e.closeErr
		}
	}
}

// InvokeStreaming 发送流式请求，响应通过 Wails EventsEmit 逐行推送到前端。
// 注册到 pending 以便引擎异常时通过事件通知前端结束。
// reqJSON 中的请求会触发引擎流式响应（stream=true 的多行 JSON），
// 每行通过 "engine:stream:{id}" 事件推送，最后一行（end=true）通过 "engine:stream-end:{id}" 推送。
func (e *Engine) InvokeStreaming(reqJSON string) (string, error) {
	var meta struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(reqJSON), &meta); err != nil {
		return "", fmt.Errorf("invalid request envelope: %w", err)
	}
	if meta.ID == "" {
		return "", errors.New("invalid request envelope: missing id")
	}

	ch := make(chan string, 1)

	e.pendMu.Lock()
	if e.closeErr != nil {
		e.pendMu.Unlock()
		return "", e.closeErr
	}
	if _, dup := e.pending[meta.ID]; dup {
		e.pendMu.Unlock()
		return "", fmt.Errorf("duplicate request id %s", meta.ID)
	}
	e.pending[meta.ID] = ch
	e.pendMu.Unlock()

	e.writeMu.Lock()
	_, werr := e.stdin.Write([]byte(reqJSON + "\n"))
	e.writeMu.Unlock()
	if werr != nil {
		e.pendMu.Lock()
		delete(e.pending, meta.ID)
		e.pendMu.Unlock()
		return "", fmt.Errorf("pipe write: %w", werr)
	}

	return meta.ID, nil
}

// Shutdown 优雅关闭：先发 CMD_EXIT 让引擎自清理，必要时 Kill 兜底。
// reader 看到 stdout EOF 后会触发 closeAll，唤醒所有等待中的 Invoke。
func (e *Engine) Shutdown() {
	// 尝试拿 writeMu 走优雅路径；若有 Invoke 正卡在 stdin.Write 上拿不到锁，
	// 直接跳到 Kill —— Process.Kill 会关闭 stdin 让那个 writer 立刻返回。
	if e.writeMu.TryLock() {
		if e.stdin != nil {
			_, _ = e.stdin.Write([]byte("CMD_EXIT\n"))
			_ = e.stdin.Close()
		}
		e.writeMu.Unlock()
	}

	if e.cmd != nil && e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
		_, _ = e.cmd.Process.Wait()
	}

	// 兜底：若 reader 已经退出而 closeAll 尚未被调用（极少见），这里也补一次。
	e.closeAll(errors.New("engine shutting down"))

	// 停止流式消息攒批器，flush 剩余缓冲数据
	if e.batcher != nil {
		e.batcher.stop()
	}
}

// truncateForLog 对超长响应日志做安全截断，避免把 8MB 行原样灌进日志。
func truncateForLog(s string) string {
	const max = 256
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}

// stderrLogger 把引擎 stderr 行打到 Go log，便于联调。
type stderrLogger struct{}

func newStderrLogger() io.Writer { return &stderrLogger{} }

func (l *stderrLogger) Write(p []byte) (int, error) {
	log.Printf("[engine.stderr] %s", p)
	return len(p), nil
}
