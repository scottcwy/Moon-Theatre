package agent

import (
	"context"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
)

type streamFallbackProvider struct {
	chatContent string
	chatTools   []provider.Tool
	streamTools []provider.Tool
}

func (p *streamFallbackProvider) Chat(
	_ context.Context,
	_ []provider.Message,
	tools []provider.Tool,
	_ string,
	_ int,
	_ float64,
	_ string,
) (*provider.Response, error) {
	p.chatTools = append([]provider.Tool(nil), tools...)
	return &provider.Response{Content: p.chatContent}, nil
}

func (p *streamFallbackProvider) ChatStream(
	_ context.Context,
	_ []provider.Message,
	tools []provider.Tool,
	_ string,
	_ int,
	_ float64,
	_ string,
) (*provider.StreamReader, error) {
	p.streamTools = append([]provider.Tool(nil), tools...)
	ch := make(chan provider.StreamChunk, 1)
	close(ch)
	return provider.NewStreamReader(ch), nil
}

func TestHandleMessageStreamReturnsChatContentWhenStreamIsEmpty(t *testing.T) {
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-agent",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 1,
	}, &streamFallbackProvider{chatContent: "在线回复"}, bus.New(), t.TempDir())

	sr := ag.HandleMessageStream(context.Background(), bus.InboundMessage{
		Channel:  "api",
		ChatID:   "stream-empty",
		UserID:   "api-user",
		Text:     "你好",
		PeerKind: "dm",
	})

	var got string
	for {
		chunk, ok := sr.Next()
		if !ok {
			break
		}
		got += chunk.Content
	}

	if got != "在线回复" {
		t.Fatalf("stream content = %q, want %q", got, "在线回复")
	}
}

func TestHandleMessageStreamWithZeroToolIterationsCallsModelWithoutTools(t *testing.T) {
	prov := &streamFallbackProvider{chatContent: "无工具回复"}
	ag := NewAgent(config.ResolvedAgent{
		ID:                "test-agent",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
	}, prov, bus.New(), t.TempDir())

	sr := ag.HandleMessageStream(context.Background(), bus.InboundMessage{
		Channel:  "api",
		ChatID:   "stream-no-tools",
		UserID:   "api-user",
		Text:     "你好",
		PeerKind: "dm",
	})

	var got string
	for {
		chunk, ok := sr.Next()
		if !ok {
			break
		}
		got += chunk.Content
	}

	if got != "无工具回复" {
		t.Fatalf("stream content = %q, want %q", got, "无工具回复")
	}
	if len(prov.chatTools) != 0 {
		t.Fatalf("chat tool count = %d, want 0", len(prov.chatTools))
	}
}
