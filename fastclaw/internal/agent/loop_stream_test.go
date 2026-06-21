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
}

func (p *streamFallbackProvider) Chat(
	context.Context,
	[]provider.Message,
	[]provider.Tool,
	string,
	int,
	float64,
) (*provider.Response, error) {
	return &provider.Response{Content: p.chatContent}, nil
}

func (p *streamFallbackProvider) ChatStream(
	context.Context,
	[]provider.Message,
	[]provider.Tool,
	string,
	int,
	float64,
) (*provider.StreamReader, error) {
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
