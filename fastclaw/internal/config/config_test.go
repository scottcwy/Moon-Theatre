package config

import (
	"encoding/json"
	"testing"
)

func TestApplyDefaultsKeepsExplicitZeroMaxToolIterations(t *testing.T) {
	cfg := &Config{}
	data := []byte(`{"agents":{"defaults":{"maxToolIterations":0}}}`)
	if err := json.Unmarshal(data, cfg); err != nil {
		t.Fatal(err)
	}

	ApplyDefaults(cfg)

	if cfg.Agents.Defaults.MaxToolIterations != 0 {
		t.Fatalf("maxToolIterations = %d, want explicit 0", cfg.Agents.Defaults.MaxToolIterations)
	}
	if cfg.Agents.Defaults.MaxTokens != 768 {
		t.Fatalf("maxTokens = %d, want default 768", cfg.Agents.Defaults.MaxTokens)
	}
	if cfg.Agents.Defaults.Model != "siliconflow/deepseek-ai/DeepSeek-V4-Flash" {
		t.Fatalf("model = %q, want DeepSeek-V4 Flash default", cfg.Agents.Defaults.Model)
	}
}

func TestAgentDefaultsMarshalKeepsExplicitZeroMaxToolIterations(t *testing.T) {
	var defaults AgentDefaults
	if err := json.Unmarshal([]byte(`{"maxToolIterations":0}`), &defaults); err != nil {
		t.Fatal(err)
	}

	data, err := json.Marshal(defaults)
	if err != nil {
		t.Fatal(err)
	}

	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["maxToolIterations"] != float64(0) {
		t.Fatalf("marshaled maxToolIterations = %v, want 0", got["maxToolIterations"])
	}
}

func TestApplyDefaultsUsesDefaultWhenMaxToolIterationsMissing(t *testing.T) {
	cfg := &Config{}

	ApplyDefaults(cfg)

	if cfg.Agents.Defaults.MaxToolIterations != 20 {
		t.Fatalf("maxToolIterations = %d, want default 20", cfg.Agents.Defaults.MaxToolIterations)
	}
}

func TestMergedAgentConfigKeepsExplicitZeroMaxToolIterations(t *testing.T) {
	cfg := &Config{}
	if err := json.Unmarshal([]byte(`{"agents":{"defaults":{"maxToolIterations":20}}}`), cfg); err != nil {
		t.Fatal(err)
	}
	ApplyDefaults(cfg)
	var entry AgentEntry
	if err := json.Unmarshal([]byte(`{"id":"agt_no_tools","maxToolIterations":0}`), &entry); err != nil {
		t.Fatal(err)
	}

	resolved := cfg.MergedAgentConfig(entry)

	if resolved.MaxToolIterations != 0 {
		t.Fatalf("maxToolIterations = %d, want explicit 0", resolved.MaxToolIterations)
	}
}

func TestMergedAgentConfigKeepsExplicitZeroMaxToolIterationsFromAgentFile(t *testing.T) {
	origLoader := AgentFileConfigLoader
	t.Cleanup(func() {
		AgentFileConfigLoader = origLoader
	})
	AgentFileConfigLoader = func(_, _ string) (AgentFileConfig, bool) {
		var cfg AgentFileConfig
		if err := json.Unmarshal([]byte(`{"maxToolIterations":0}`), &cfg); err != nil {
			t.Fatal(err)
		}
		return cfg, true
	}
	cfg := &Config{}
	if err := json.Unmarshal([]byte(`{"agents":{"defaults":{"maxToolIterations":20}}}`), cfg); err != nil {
		t.Fatal(err)
	}
	ApplyDefaults(cfg)

	resolved := cfg.MergedAgentConfig(AgentEntry{ID: "agt_no_tools"})

	if resolved.MaxToolIterations != 0 {
		t.Fatalf("maxToolIterations = %d, want explicit 0", resolved.MaxToolIterations)
	}
}

func TestAgentFileConfigMarshalKeepsExplicitZeroMaxToolIterations(t *testing.T) {
	var cfg AgentFileConfig
	if err := json.Unmarshal([]byte(`{"maxToolIterations":0}`), &cfg); err != nil {
		t.Fatal(err)
	}

	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}

	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["maxToolIterations"] != float64(0) {
		t.Fatalf("marshaled maxToolIterations = %v, want 0", got["maxToolIterations"])
	}
}

func TestApplyDefaultsLeavesThinkingEmpty(t *testing.T) {
	cfg := &Config{}

	ApplyDefaults(cfg)

	if cfg.Agents.Defaults.Thinking != "" {
		t.Fatalf("thinking = %q, want empty default", cfg.Agents.Defaults.Thinking)
	}
}

func TestMergedAgentConfigUsesDefaultThinking(t *testing.T) {
	cfg := &Config{}
	if err := json.Unmarshal([]byte(`{"agents":{"defaults":{"thinking":"off"}}}`), cfg); err != nil {
		t.Fatal(err)
	}
	ApplyDefaults(cfg)

	resolved := cfg.MergedAgentConfig(AgentEntry{ID: "agt_default_thinking"})

	if resolved.Thinking != "off" {
		t.Fatalf("thinking = %q, want off from defaults", resolved.Thinking)
	}
}

func TestMergedAgentConfigEntryOverridesDefaultThinking(t *testing.T) {
	cfg := &Config{}
	if err := json.Unmarshal([]byte(`{"agents":{"defaults":{"thinking":"off"}}}`), cfg); err != nil {
		t.Fatal(err)
	}
	ApplyDefaults(cfg)
	var entry AgentEntry
	if err := json.Unmarshal([]byte(`{"id":"agt_override_thinking","thinking":"adaptive"}`), &entry); err != nil {
		t.Fatal(err)
	}

	resolved := cfg.MergedAgentConfig(entry)

	if resolved.Thinking != "adaptive" {
		t.Fatalf("thinking = %q, want adaptive from entry override", resolved.Thinking)
	}
}

func TestAgentEntryUnmarshalRoleplay(t *testing.T) {
	var e AgentEntry
	if err := json.Unmarshal([]byte(`{"id":"agt_rp","roleplay":true}`), &e); err != nil {
		t.Fatal(err)
	}
	if !e.Roleplay {
		t.Fatal("Roleplay = false, want true")
	}
	if !e.HasRoleplay() {
		t.Fatal("HasRoleplay = false, want true")
	}
}

func TestAgentEntryUnmarshalExplicitFalseRoleplay(t *testing.T) {
	var e AgentEntry
	if err := json.Unmarshal([]byte(`{"id":"agt_rp","roleplay":false}`), &e); err != nil {
		t.Fatal(err)
	}
	if e.Roleplay {
		t.Fatal("Roleplay = true, want explicit false")
	}
	if !e.HasRoleplay() {
		t.Fatal("HasRoleplay = false for explicit false, want true (must be able to clear a roleplay default)")
	}
}

func TestAgentEntryUnmarshalMissingRoleplay(t *testing.T) {
	var e AgentEntry
	if err := json.Unmarshal([]byte(`{"id":"agt_rp"}`), &e); err != nil {
		t.Fatal(err)
	}
	if e.HasRoleplay() {
		t.Fatal("HasRoleplay = true when roleplay was never configured")
	}
}

func TestAgentDefaultsHasRoleplay(t *testing.T) {
	var d AgentDefaults
	if err := json.Unmarshal([]byte(`{"roleplay":false}`), &d); err != nil {
		t.Fatal(err)
	}
	if !d.HasRoleplay() {
		t.Fatal("HasRoleplay = false for explicit false default, want true")
	}
}

func TestMergedAgentConfigRoleplayFromEntry(t *testing.T) {
	cfg := &Config{}
	resolved := cfg.MergedAgentConfig(AgentEntry{ID: "agt_rp", Roleplay: true, roleplaySet: true})
	if !resolved.Roleplay {
		t.Fatal("resolved.Roleplay = false, want true from agent entry")
	}
}

func TestMergedAgentConfigRoleplayFromDefaults(t *testing.T) {
	var cfg Config
	if err := json.Unmarshal([]byte(`{"agents":{"defaults":{"roleplay":true}}}`), &cfg); err != nil {
		t.Fatal(err)
	}
	resolved := cfg.MergedAgentConfig(AgentEntry{ID: "agt_rp"})
	if !resolved.Roleplay {
		t.Fatal("resolved.Roleplay = false, want true from defaults")
	}
}

func TestAgentDefaultsMarshalKeepsExplicitFalseRoleplay(t *testing.T) {
	var defaults AgentDefaults
	if err := json.Unmarshal([]byte(`{"roleplay":false}`), &defaults); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(defaults)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if v, ok := got["roleplay"]; !ok || v != false {
		t.Fatalf("marshaled roleplay = %v (present=%v), want explicit false", v, ok)
	}
}
