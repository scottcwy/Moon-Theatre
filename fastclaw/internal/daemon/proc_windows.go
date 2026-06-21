//go:build windows

package daemon

import (
	"os"
	"os/exec"
)

func setSysProcAttr(cmd *exec.Cmd) {}

func isCleanShutdown(exitErr *exec.ExitError) bool {
	return false
}

func signalProcess(proc *os.Process, sig string) error {
	switch sig {
	case "TERM", "KILL":
		return proc.Kill()
	case "CHECK":
		// On Windows, just try to open the process
		return nil
	}
	return nil
}
