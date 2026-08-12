package agent

import (
	"context"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
)

type captureProvider struct {
	messages []provider.Message
	tools    []provider.Tool
}

func (p *captureProvider) Chat(
	_ context.Context,
	messages []provider.Message,
	toolDefs []provider.Tool,
	_ string,
	_ int,
	_ float64,
	_ string,
) (*provider.Response, error) {
	p.messages = append([]provider.Message(nil), messages...)
	p.tools = append([]provider.Tool(nil), toolDefs...)
	return &provider.Response{Content: "收到"}, nil
}

func (p *captureProvider) ChatStream(
	context.Context,
	[]provider.Message,
	[]provider.Tool,
	string,
	int,
	float64,
	string,
) (*provider.StreamReader, error) {
	ch := make(chan provider.StreamChunk, 1)
	close(ch)
	return provider.NewStreamReader(ch), nil
}

func TestHandleMessageUsesRequestSystemPromptOverride(t *testing.T) {
	prov := &captureProvider{}
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-agent",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 1,
	}, prov, bus.New(), t.TempDir())

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel:              "api",
		ChatID:               "system-override",
		UserID:               "api-user",
		Text:                 "继续调查",
		PeerKind:             "dm",
		SystemPromptOverride: "你是白藏，必须保持角色。",
	})

	if len(prov.messages) == 0 {
		t.Fatal("provider did not receive messages")
	}
	if got := prov.messages[0].Content; got != "你是白藏，必须保持角色。" {
		t.Fatalf("system prompt = %q, want request override", got)
	}
}

func TestHandleMessageWithZeroToolIterationsCallsModelWithoutTools(t *testing.T) {
	prov := &captureProvider{}
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-agent",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
	}, prov, bus.New(), t.TempDir())

	got := ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel:  "api",
		ChatID:   "no-tools",
		UserID:   "api-user",
		Text:     "你好",
		PeerKind: "dm",
	})

	if got != "收到" {
		t.Fatalf("reply = %q, want model content", got)
	}
	if len(prov.messages) == 0 {
		t.Fatal("provider did not receive messages")
	}
	if len(prov.tools) != 0 {
		t.Fatalf("tool count = %d, want 0", len(prov.tools))
	}
}
