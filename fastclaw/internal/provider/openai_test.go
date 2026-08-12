package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestOpenAIChatEnableThinking asserts the wire-level enable_thinking field:
// thinking=="off" sends false, any other value leaves it unset (backward
// compatible with unconfigured agents).
func TestOpenAIChatEnableThinking(t *testing.T) {
	tests := []struct {
		name      string
		thinking  string
		wantField bool
	}{
		{name: "off disables thinking", thinking: "off", wantField: true},
		{name: "empty leaves field unset", thinking: "", wantField: false},
		{name: "medium leaves field unset", thinking: "medium", wantField: false},
		{name: "unknown leaves field unset", thinking: "bogus", wantField: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotBody map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
					t.Errorf("decode request body: %v", err)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				w.Write([]byte("data: [DONE]\n\n"))
			}))
			defer srv.Close()

			p := NewOpenAI("test-key", srv.URL)
			if _, err := p.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}}, nil, "test/model", 100, 0.7, tt.thinking); err != nil {
				t.Fatalf("Chat: %v", err)
			}

			val, present := gotBody["enable_thinking"]
			if tt.wantField {
				if !present {
					t.Fatalf("request body missing enable_thinking: %v", gotBody)
				}
				if b, ok := val.(bool); !ok || b {
					t.Fatalf("enable_thinking = %v (%T), want false", val, val)
				}
			} else if present {
				t.Fatalf("request body has enable_thinking = %v, want unset", val)
			}
		})
	}
}
