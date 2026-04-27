package core

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

type terminalWSMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

var terminalWSUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (m *ManagementServer) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}

	conn, err := terminalWSUpgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("terminal: websocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	cwd := strings.TrimSpace(r.URL.Query().Get("cwd"))
	if cwd == "" {
		cwd = "/data/workspaces"
	}
	if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
		cwd = "/"
	}

	shell := strings.TrimSpace(os.Getenv("SHELL"))
	if shell == "" {
		shell = "/bin/bash"
	}
	if _, err := os.Stat(shell); err != nil {
		shell = "/bin/sh"
	}

	cols := parseTerminalSize(r.URL.Query().Get("cols"), 120, 20, 400)
	rows := parseTerminalSize(r.URL.Query().Get("rows"), 32, 8, 120)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	cmd := exec.CommandContext(ctx, shell, "-l")
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		_ = conn.WriteJSON(terminalWSMessage{Type: "error", Data: err.Error()})
		return
	}
	defer ptmx.Close()

	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 8192)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if writeErr := conn.WriteJSON(terminalWSMessage{Type: "output", Data: string(buf[:n])}); writeErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	for {
		var msg terminalWSMessage
		if err := conn.ReadJSON(&msg); err != nil {
			break
		}
		switch msg.Type {
		case "input":
			if msg.Data != "" {
				_, _ = ptmx.Write([]byte(msg.Data))
			}
		case "resize":
			cols := clampTerminalSize(msg.Cols, 20, 400)
			rows := clampTerminalSize(msg.Rows, 8, 120)
			if cols > 0 && rows > 0 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Rows: rows, Cols: cols})
			}
		}
	}

	cancel()
	if cmd.Process != nil {
		_ = cmd.Process.Signal(os.Interrupt)
		select {
		case <-done:
		case <-time.After(750 * time.Millisecond):
			_ = cmd.Process.Kill()
		}
	}
	_ = cmd.Wait()
}

func parseTerminalSize(raw string, fallback, min, max uint16) uint16 {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	if value < int(min) {
		return min
	}
	if value > int(max) {
		return max
	}
	return uint16(value)
}

func clampTerminalSize(value, min, max uint16) uint16 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
