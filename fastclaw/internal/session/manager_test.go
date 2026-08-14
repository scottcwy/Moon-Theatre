package session

import (
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/provider"
)

func TestAppendIfAbsentUserDedupByClientMessageID(t *testing.T) {
	s := &Session{Messages: []provider.Message{
		{Role: "user", Content: "first", Metadata: map[string]any{"clientMessageId": "cm-1"}},
	}}
	// Same clientMessageId -> skip (F9).
	if got := s.AppendIfAbsent(provider.Message{
		Role: "user", Content: "first-retry", Metadata: map[string]any{"clientMessageId": "cm-1"},
	}); got {
		t.Fatal("AppendIfAbsent returned true for duplicate clientMessageId")
	}
	// Different clientMessageId -> append.
	if got := s.AppendIfAbsent(provider.Message{
		Role: "user", Content: "second", Metadata: map[string]any{"clientMessageId": "cm-2"},
	}); !got {
		t.Fatal("AppendIfAbsent returned false for a new clientMessageId")
	}
	if len(s.Messages) != 2 {
		t.Fatalf("messages = %d, want 2", len(s.Messages))
	}
}

func TestAppendIfAbsentAssistantDedupByMessageID(t *testing.T) {
	s := &Session{Messages: []provider.Message{
		{Role: "assistant", Content: "return-1", Metadata: map[string]any{"messageId": "msg-1"}},
	}}
	// Same messageId -> skip (F8).
	if got := s.AppendIfAbsent(provider.Message{
		Role: "assistant", Content: "return-1-retry", Metadata: map[string]any{"messageId": "msg-1"},
	}); got {
		t.Fatal("AppendIfAbsent returned true for duplicate messageId")
	}
	// New messageId -> append.
	if got := s.AppendIfAbsent(provider.Message{
		Role: "assistant", Content: "return-2", Metadata: map[string]any{"messageId": "msg-2"},
	}); !got {
		t.Fatal("AppendIfAbsent returned false for a new messageId")
	}
	if len(s.Messages) != 2 {
		t.Fatalf("messages = %d, want 2", len(s.Messages))
	}
}

func TestAppendIfAbsentIDSeparateSpaces(t *testing.T) {
	// F8/P1-C: messageId (return messages) and clientMessageId (chat user
	// messages) must never cross-match.
	s := &Session{Messages: []provider.Message{
		{Role: "user", Content: "chat", Metadata: map[string]any{"clientMessageId": "shared-id"}},
	}}
	if got := s.AppendIfAbsent(provider.Message{
		Role: "assistant", Content: "return", Metadata: map[string]any{"messageId": "shared-id"},
	}); !got {
		t.Fatal("assistant messageId must not collide with user clientMessageId")
	}
	if len(s.Messages) != 2 {
		t.Fatalf("messages = %d, want 2", len(s.Messages))
	}
}

func TestAppendIfAbsentNoMetadataAlwaysAppends(t *testing.T) {
	s := &Session{}
	for i := 0; i < 3; i++ {
		if got := s.AppendIfAbsent(provider.Message{Role: "user", Content: "plain"}); !got {
			t.Fatal("message without dedup metadata must always append")
		}
	}
	if len(s.Messages) != 3 {
		t.Fatalf("messages = %d, want 3", len(s.Messages))
	}
}
