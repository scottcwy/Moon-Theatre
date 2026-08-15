package agent

import (
	"fmt"
	"sync"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
)

// TestContextBuilderConcurrentPromptAndHotReload exercises the reviewer I2
// race: roleplay turns read-copy ctxBuilder (BuildSystemPrompt / snapshot)
// while hot-reload paths write it (SetSkillsSummary / ReloadWorkspaceFiles /
// SetRoleplay). Must run clean under -race.
func TestContextBuilderConcurrentPromptAndHotReload(t *testing.T) {
	home := t.TempDir()
	writeIdentityFiles(t, home)
	ag := NewAgent(config.ResolvedAgent{
		ID:                "agt_rp",
		Home:              home,
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
	}, &captureProvider{}, bus.New(), t.TempDir())

	cb := ag.ctxBuilder
	stop := make(chan struct{})
	var wg sync.WaitGroup

	// Readers: per-turn prompt builds on the shared builder (snapshot path)
	// and on the per-turn copy path (turnContextBuilder semantics).
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				prompt := cb.BuildSystemPrompt()
				if prompt == "" {
					t.Error("BuildSystemPrompt returned empty prompt")
					return
				}
				perTurn := cb.snapshot()
				perTurn.userID = "u_concurrent"
				if perTurn.BuildSystemPrompt() == "" {
					t.Error("per-turn BuildSystemPrompt returned empty prompt")
					return
				}
			}
		}()
	}

	// Writers: hot-reload paths that previously raced with the read-copy.
	wg.Add(3)
	go func() {
		defer wg.Done()
		for i := 0; i < 300; i++ {
			cb.SetSkillsSummary(fmt.Sprintf("skills summary %d", i))
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			ag.ReloadWorkspaceFiles()
		}
	}()
	go func() {
		defer wg.Done()
		cb.SetRoleplay(true)
		cb.SetRoleplay(false)
		cb.SetRoleplay(true)
		cb.SetSandboxEnabled(true)
		cb.SetSandbox(true, "docker")
		cb.SetStore(nil, "agt_rp", "u_owner")
		cb.SetWorkspace(home)
		cb.SetThinking("off")
	}()

	close(stop)
	wg.Wait()
}
