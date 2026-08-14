package gateway

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/store"
)

// stubStore implements just enough of store.Store for loadUserSpace /
// applyAgentScopedDefaults tests. Any other method panics through the
// embedded nil interface, surfacing accidental store dependencies.
type stubStore struct {
	store.Store
	agents  []store.AgentRecord
	configs map[string]*store.ConfigRecord
}

func (s *stubStore) ListAgents(ctx context.Context, ownerUserID string) ([]store.AgentRecord, error) {
	return s.agents, nil
}

func (s *stubStore) ListConfigs(ctx context.Context, kind, scope, scopeID string) ([]store.ConfigRecord, error) {
	return nil, nil
}

func (s *stubStore) GetConfigByName(ctx context.Context, kind, scope, scopeID, name string) (*store.ConfigRecord, error) {
	key := scope + "|" + scopeID + "|" + name
	if rec, ok := s.configs[key]; ok {
		return rec, nil
	}
	return nil, store.ErrNotFound
}

func agentDefaultsRecord(agentID string, data map[string]interface{}) *store.ConfigRecord {
	return &store.ConfigRecord{
		Kind:    store.KindSetting,
		Scope:   store.ScopeAgent,
		ScopeID: agentID,
		Name:    "agents.defaults",
		Data:    data,
	}
}

// TestApplyAgentScopedDefaultsWritesBackToSlice is the regression test for
// the contract bug: the loadUserSpace merge used `for _, rc := range
// resolved`, which mutated a copy and discarded every agent-scope override
// before agent.NewManager saw the slice. The helper must mutate resolved[i]
// in place.
func TestApplyAgentScopedDefaultsWritesBackToSlice(t *testing.T) {
	ctx := context.Background()
	st := &stubStore{configs: map[string]*store.ConfigRecord{
		"agent|role-baizang|agents.defaults": agentDefaultsRecord("role-baizang", map[string]interface{}{
			"roleplay":          true,
			"thinking":          "off",
			"maxToolIterations": 0,
			"memory": map[string]interface{}{
				"autoPersist": map[string]interface{}{
					"enabled":     true,
					"everyNTurns": 5,
				},
			},
		}),
	}}
	cfg := &config.Config{}
	config.ApplyDefaults(cfg)
	resolved := config.ResolveAgents(cfg, []config.AgentEntry{
		{ID: "role-baizang", UserID: "u1"},
		{ID: "plain-agent", UserID: "u1"},
	})

	applyAgentScopedDefaults(ctx, st, resolved)

	got := resolved[0]
	if !got.Roleplay {
		t.Fatalf("role-baizang roleplay = false, want true (agent-scope override lost)")
	}
	if got.Thinking != "off" {
		t.Fatalf("role-baizang thinking = %q, want %q", got.Thinking, "off")
	}
	if got.MaxToolIterations != 0 {
		t.Fatalf("role-baizang maxToolIterations = %d, want 0", got.MaxToolIterations)
	}
	if !got.Memory.AutoPersist.Enabled || got.Memory.AutoPersist.EveryNTurns != 5 {
		t.Fatalf("role-baizang Memory = %+v, want autoPersist enabled every 5 turns", got.Memory)
	}
	// Agent without a scope=agent row keeps the resolved defaults untouched.
	if plain := resolved[1]; plain.Roleplay || plain.Thinking != "" || plain.MaxToolIterations != 20 || plain.Memory.AutoPersist.Enabled {
		t.Fatalf("plain-agent unexpectedly overridden: %+v", plain)
	}
}

// TestApplyAgentDefaultsClearsRoleplayDefault covers the explicit
// roleplay:false case: a false override must be able to clear a roleplay
// default from the merged config.
func TestApplyAgentDefaultsClearsRoleplayDefault(t *testing.T) {
	// Build the override through JSON so UnmarshalJSON marks roleplaySet:
	// an explicit false must clear a roleplay default.
	var ovr config.AgentDefaults
	if err := json.Unmarshal([]byte(`{"roleplay":false}`), &ovr); err != nil {
		t.Fatalf("unmarshal override: %v", err)
	}
	rc := &config.ResolvedAgent{Roleplay: true}
	applyAgentDefaults(rc, ovr)
	if rc.Roleplay {
		t.Fatal("applyAgentDefaults(roleplay:false) did not clear resolved roleplay=true")
	}
}

// TestLoadUserSpaceAppliesAgentScopedDefaults runs the full loadUserSpace
// path: ResolveAgents → applyAgentScopedDefaults → agent.NewManager. The
// runtime spec must carry the agent-scope roleplay/thinking/maxToolIterations
// values — this is what GET /v1/agents/{id}/runtime-spec and the F1 gate
// depend on.
func TestLoadUserSpaceAppliesAgentScopedDefaults(t *testing.T) {
	t.Setenv("FASTCLAW_HOME", t.TempDir())
	ctx := context.Background()
	st := &stubStore{
		agents: []store.AgentRecord{{ID: "role-baizang", UserID: "u1"}},
		configs: map[string]*store.ConfigRecord{
			"agent|role-baizang|agents.defaults": agentDefaultsRecord("role-baizang", map[string]interface{}{
				"roleplay":          true,
				"thinking":          "off",
				"maxToolIterations": 0,
			}),
		},
	}

	sp, err := loadUserSpace(ctx, "u1", bus.New(), st, nil)
	if err != nil {
		t.Fatalf("loadUserSpace: %v", err)
	}
	ag := sp.Agents.AgentByID("role-baizang")
	if ag == nil {
		t.Fatal("agent role-baizang not loaded")
	}
	spec := ag.RuntimeSpec()
	if !spec.Roleplay {
		t.Fatalf("runtime-spec roleplay = false, want true (agent-scope defaults lost before NewManager)")
	}
	if spec.Thinking != "off" {
		t.Fatalf("runtime-spec thinking = %q, want %q", spec.Thinking, "off")
	}
	if spec.MaxToolIterations != 0 {
		t.Fatalf("runtime-spec maxToolIterations = %d, want 0", spec.MaxToolIterations)
	}
}

// TestApplyAgentDefaultsMergesAgentScopeMemory covers the P0 wiring: an
// agent-scope agents.defaults row carrying memory.autoPersist must land on
// the resolved agent's Memory so the gateway-built agent gets a non-zero
// memoryCfg (runPostTurn gate F5/F7).
func TestApplyAgentDefaultsMergesAgentScopeMemory(t *testing.T) {
	var ovr config.AgentDefaults
	if err := json.Unmarshal([]byte(`{"memory":{"autoPersist":{"enabled":true,"everyNTurns":5}}}`), &ovr); err != nil {
		t.Fatalf("unmarshal override: %v", err)
	}
	rc := &config.ResolvedAgent{}
	applyAgentDefaults(rc, ovr)
	if !rc.Memory.AutoPersist.Enabled || rc.Memory.AutoPersist.EveryNTurns != 5 {
		t.Fatalf("rc.Memory = %+v, want autoPersist enabled every 5 turns", rc.Memory)
	}
}

// TestApplyAgentDefaultsAbsentMemoryLeavesResolvedUntouched guards legacy
// drift: an agent-scope row without a `memory` key is a zero-value
// AgentDefaults and must not clobber an already-resolved memory config.
func TestApplyAgentDefaultsAbsentMemoryLeavesResolvedUntouched(t *testing.T) {
	var ovr config.AgentDefaults
	rc := &config.ResolvedAgent{Memory: config.MemoryCfg{
		AutoPersist: config.AutoPersistCfg{Enabled: true, EveryNTurns: 7},
	}}
	applyAgentDefaults(rc, ovr)
	if !rc.Memory.AutoPersist.Enabled || rc.Memory.AutoPersist.EveryNTurns != 7 {
		t.Fatalf("absent agent-scope memory clobbered resolved memory: %+v", rc.Memory)
	}
}
