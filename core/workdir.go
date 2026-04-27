package core

import (
	"fmt"
	"os"
	"strings"
)

// EnsureWorkDir creates a configured agent work_dir before it is used as
// exec.Cmd.Dir. Without this, Go reports a missing cwd as a misleading
// "fork/exec <cli>: no such file or directory" error.
func EnsureWorkDir(workDir string) error {
	if strings.TrimSpace(workDir) == "" {
		return nil
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("create work_dir %q: %w", workDir, err)
	}
	return nil
}
