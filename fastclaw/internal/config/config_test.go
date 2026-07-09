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
