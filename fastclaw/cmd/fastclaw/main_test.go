package main

import (
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/config"
)

func TestNewGatewayCfgEnablesOpenAICompatibleEndpointsByDefault(t *testing.T) {
	cfg := newGatewayCfg(18953, &config.EnvConfig{})

	if !cfg.HTTP.Endpoints.ChatCompletions.Enabled {
		t.Fatal("expected /v1/chat/completions endpoint to be enabled by default")
	}
	if !cfg.HTTP.Endpoints.Agents.Enabled {
		t.Fatal("expected /v1/agents endpoint to be enabled by default")
	}
}
