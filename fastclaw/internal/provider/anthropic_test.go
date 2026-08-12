package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestAnthropicChatThinking asserts the wire-level thinking field on the
// Anthropic-compatible path: thinking=="off" sends {"type":"disabled"}, any
// other value leaves it unset. This path is not reachable in production
// (apiType=openai), so the request body is verified via unit test only.
func TestAnthropicChatThinking(t *testing.T) {
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
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()

			p := NewAnthropic("test-key", srv.URL)
			if _, err := p.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}}, nil, "test/model", 100, 0.7, tt.thinking); err != nil {
				t.Fatalf("Chat: %v", err)
			}

			val, present := gotBody["thinking"]
			if tt.wantField {
				if !present {
					t.Fatalf("request body missing thinking: %v", gotBody)
				}
				m, ok := val.(map[string]any)
				if !ok || m["type"] != "disabled" {
					t.Fatalf("thinking = %v (%T), want {\"type\":\"disabled\"}", val, val)
				}
			} else if present {
				t.Fatalf("request body has thinking = %v, want unset", val)
			}
		})
	}
}
