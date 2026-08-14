package agent

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
)

// waitForAutoPersistWrites polls the fake memory store until the
// AutoPersistMemory goroutine spawned by runPostTurn lands its writes.
func waitForAutoPersistWrites(t *testing.T, mem *fakeUserMemStore, agentID, userID string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := mem.GetWorkspaceFile(context.Background(), agentID, userID, "USER.md"); err == nil {
			if _, err := mem.GetWorkspaceFile(context.Background(), agentID, userID, "shared/MEMORY.md"); err == nil {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("auto-persist did not write USER.md/shared/MEMORY.md within deadline")
}

// TestRoleplayAutoPersistWiredThroughManager is the P0 production-path
// regression: a roleplay agent built by NewManager (the same path
// loadUserSpace uses) must carry memoryCfg.AutoPersist from the resolved
// config, and runPostTurn must actually call AutoPersistMemory — writing
// USER.md / shared/MEMORY.md — once the per-user turn counter hits the
// every-5-turns threshold.
func TestRoleplayAutoPersistWiredThroughManager(t *testing.T) {
	memStore := newFakeUserMemStore()
	prov := &jsonProvider{content: `{"user_info":["用户自称「阿茶」。","用户喜欢「草莓」"],"relationship":["用户信任角色"],"story":[]}`}
	mgr, err := NewManager([]config.ResolvedAgent{{
		ID:                "agt_rp",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
		Memory:            config.MemoryCfg{AutoPersist: config.AutoPersistCfg{Enabled: true, EveryNTurns: 5}},
	}}, prov, bus.New(),
		WithUserID("u_owner"),
		WithMemoryStore(memStore),
	)
	if err != nil {
		t.Fatal(err)
	}
	ag := mgr.AgentByID("agt_rp")
	if ag == nil {
		t.Fatal("agent agt_rp not loaded")
	}
	if !ag.memoryCfg.AutoPersist.Enabled || ag.memoryCfg.AutoPersist.EveryNTurns != 5 {
		t.Fatalf("memoryCfg = %+v, want AutoPersist enabled every 5 turns", ag.memoryCfg)
	}

	uc := ag.resolveUserContext(bus.InboundMessage{UserID: "u_alice", Scope: "free"})
	if uc == nil {
		t.Fatal("resolveUserContext returned nil for roleplay agent")
	}

	// Turns 1-4 must stay below the threshold: no AutoPersist goroutine,
	// so no writes (deterministic).
	for i := 1; i <= 4; i++ {
		ag.runPostTurn(context.Background(), uc, []provider.Message{{Role: "user", Content: "我叫阿茶"}}, 0)
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "USER.md"); err == nil {
		t.Fatal("auto-persist fired before the every-5-turns threshold")
	}

	// 5th turn crosses the threshold and must really write through the
	// memory store (fake provider returns the frozen extraction JSON).
	ag.runPostTurn(context.Background(), uc, []provider.Message{{Role: "user", Content: "我叫阿茶，喜欢草莓"}}, 0)
	waitForAutoPersistWrites(t, memStore, "agt_rp", "u_alice")

	user, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "USER.md")
	if err != nil {
		t.Fatalf("USER.md missing after 5th turn: %v", err)
	}
	for _, want := range []string{"阿茶", "草莓"} {
		if !strings.Contains(string(user), want) {
			t.Errorf("USER.md missing %q:\n%s", want, user)
		}
	}
	shared, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "shared/MEMORY.md")
	if err != nil {
		t.Fatalf("shared/MEMORY.md missing after 5th turn: %v", err)
	}
	if !strings.Contains(string(shared), "信任") {
		t.Errorf("shared/MEMORY.md missing relationship fact:\n%s", shared)
	}
}

// TestAutoPersistDefaultsEveryNTurnsToFive locks the modulo-zero guard:
// AutoPersist.Enabled with an omitted everyNTurns must default to 5 (the
// runPostTurn gate divides by EveryNTurns).
func TestAutoPersistDefaultsEveryNTurnsToFive(t *testing.T) {
	ag := NewAgent(config.ResolvedAgent{
		ID:                "agt_rp",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
		Memory:            config.MemoryCfg{AutoPersist: config.AutoPersistCfg{Enabled: true}},
	}, &jsonProvider{content: `{"user_info":[],"relationship":[],"story":[]}`}, bus.New(), t.TempDir())
	if ag.memoryCfg.AutoPersist.EveryNTurns != 5 {
		t.Fatalf("EveryNTurns = %d, want default 5", ag.memoryCfg.AutoPersist.EveryNTurns)
	}
	uc := ag.resolveUserContext(bus.InboundMessage{UserID: "u_a", Scope: "free"})
	for i := 1; i <= 5; i++ {
		ag.runPostTurn(context.Background(), uc, []provider.Message{{Role: "user", Content: "你好"}}, 0)
	}
}

// TestLegacyAgentAutoPersistStaysDisabled guards non-roleplay behavior: a
// legacy agent built without a memory config keeps Enabled=false and must
// never write USER.md/MEMORY.md through runPostTurn.
func TestLegacyAgentAutoPersistStaysDisabled(t *testing.T) {
	memStore := newFakeUserMemStore()
	ag := NewAgent(config.ResolvedAgent{
		ID:                "agt_legacy",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
	}, &jsonProvider{content: `{"user_info":["用户喜欢「草莓」"],"relationship":[],"story":[]}`}, bus.New(), t.TempDir())
	// Point the agent-level memory at the fake store so a write would land
	// somewhere observable if autoPersist were wrongly enabled.
	ag.memory = NewMemoryWithStoreForUser(ag.homePath, memStore, "u_owner", ag.name)

	for i := 1; i <= 10; i++ {
		ag.runPostTurn(context.Background(), nil, []provider.Message{{Role: "user", Content: "你好"}}, 0)
	}
	if ag.memoryCfg.AutoPersist.Enabled {
		t.Fatal("legacy agent autoPersist must stay disabled")
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt_legacy", "u_owner", "USER.md"); err == nil {
		t.Fatal("legacy agent wrote USER.md despite autoPersist disabled")
	}
}
