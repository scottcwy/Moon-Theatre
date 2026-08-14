package agent

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
)

func writeIdentityFiles(t *testing.T, home string) {
	t.Helper()
	files := map[string]string{
		"SOUL.md":     "你是月满楼的老板白藏。",
		"IDENTITY.md": "名字：白藏",
		"USER.md":     "用户喜欢喝茶",
		"AGENTS.md":   "runtime-only guidance that must not leak into roleplay",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(home, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRoleplayBuildSystemPromptSkipsRuntimeBlocks(t *testing.T) {
	home := t.TempDir()
	writeIdentityFiles(t, home)
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-roleplay",
		Home:              home,
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
	}, &captureProvider{}, bus.New(), t.TempDir())

	prompt := ag.ctxBuilder.BuildSystemPrompt()
	for _, want := range []string{"# SOUL.md", "# IDENTITY.md", "# USER.md"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("roleplay prompt missing %q:\n%s", want, prompt)
		}
	}
	for _, forbid := range []string{
		"FastClaw runtime",
		"# AGENTS.md",
		"# Skills",
		"Workspace Self-Update",
		"Group Chat",
		"Code Execution Environment",
	} {
		if strings.Contains(prompt, forbid) {
			t.Errorf("roleplay prompt must not contain %q:\n%s", forbid, prompt)
		}
	}
}

func TestRoleplayNonRoleplayStillLoadsFullBootstrap(t *testing.T) {
	home := t.TempDir()
	writeIdentityFiles(t, home)
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-legacy",
		Home:              home,
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
	}, &captureProvider{}, bus.New(), t.TempDir())

	prompt := ag.ctxBuilder.BuildSystemPrompt()
	if !strings.Contains(prompt, "# AGENTS.md") {
		t.Errorf("legacy prompt must still load AGENTS.md:\n%s", prompt)
	}
}

func TestRoleplaySystemPromptOverrideAppendedAsSystemRole(t *testing.T) {
	prov := &captureProvider{}
	home := t.TempDir()
	writeIdentityFiles(t, home)
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-roleplay",
		Home:              home,
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
	}, prov, bus.New(), t.TempDir())

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel:              "api",
		ChatID:               "roleplay-turn",
		UserID:               "u_abc",
		Scope:                "free",
		Text:                 "你好",
		PeerKind:             "dm",
		SystemPromptOverride: "你是白藏，必须保持角色。",
	})

	if len(prov.messages) < 3 {
		t.Fatalf("messages = %d, want >= 3 (base system + turn context + user)", len(prov.messages))
	}
	if prov.messages[0].Role != "system" {
		t.Fatalf("messages[0].Role = %q, want system (base prompt kept)", prov.messages[0].Role)
	}
	if prov.messages[1].Role != "system" || prov.messages[1].Content != "你是白藏，必须保持角色。" {
		t.Fatalf("messages[1] = %+v, want system-role turn context with override content", prov.messages[1])
	}
	if prov.messages[len(prov.messages)-1].Role != "user" {
		t.Fatalf("last message role = %q, want user", prov.messages[len(prov.messages)-1].Role)
	}
}

func TestRoleplayWithoutOverrideHasSingleSystemMessage(t *testing.T) {
	prov := &captureProvider{}
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-roleplay",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
	}, prov, bus.New(), t.TempDir())

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel:  "api",
		ChatID:   "roleplay-no-override",
		UserID:   "u_abc",
		Scope:    "free",
		Text:     "你好",
		PeerKind: "dm",
	})

	if len(prov.messages) != 2 {
		t.Fatalf("messages = %d, want 2 (system + user)", len(prov.messages))
	}
	if prov.messages[0].Role != "system" || prov.messages[1].Role != "user" {
		t.Fatalf("roles = %q / %q, want system / user", prov.messages[0].Role, prov.messages[1].Role)
	}
}
