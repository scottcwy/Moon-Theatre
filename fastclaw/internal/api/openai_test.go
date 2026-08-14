package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/agent"
	"github.com/fastclaw-ai/fastclaw/internal/auth"
	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
)

// newRoleplayTestServer builds an API server whose user space holds one
// agent (roleplay flag per arg) owned by u_owner.
func newRoleplayTestServer(t *testing.T, roleplay bool) *Server {
	t.Helper()
	mgr, err := agent.NewManager([]config.ResolvedAgent{{
		ID:                "agt_rp",
		Home:              t.TempDir(),
		Model:             "openrouter/test-model",
		MaxTokens:         768,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          roleplay,
	}}, &runtimeSpecProvider{}, bus.New(), agent.WithUserID("u_owner"))
	if err != nil {
		t.Fatal(err)
	}
	return NewServer(&runtimeSpecResolver{space: &UserSpaceView{
		UserID: "u_owner",
		Agents: mgr,
	}}, nil, nil)
}

func doChatCompletionRequest(t *testing.T, server *Server, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"messages":[{"role":"system","content":"你是白藏，保持角色。"},{"role":"user","content":"你好"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("x-fastclaw-agent-id", "agt_rp")
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{
		UserID:       "u_owner",
		AuthMethod:   "apikey",
		APIKeyAgents: []string{"agt_rp"},
	}))
	rec := httptest.NewRecorder()
	server.HandleChatCompletions(rec, req)
	return rec
}

func TestValidUserIDGrammar(t *testing.T) {
	valid := []string{"u_abc", "user-123", "A_Z9", "a"}
	for _, s := range valid {
		if !validUserID(s) {
			t.Errorf("validUserID(%q) = false, want true", s)
		}
	}
	invalid := []string{"", "u a", "u/a", "u..a", "中文", "u\x00", strings.Repeat("a", 65)}
	for _, s := range invalid {
		if validUserID(s) {
			t.Errorf("validUserID(%q) = true, want false", s)
		}
	}
}

func TestValidScopeGrammar(t *testing.T) {
	valid := []string{"free", "script:role-baizang", "script:a", "script:" + strings.Repeat("s", 64)}
	for _, s := range valid {
		if !validScope(s) {
			t.Errorf("validScope(%q) = false, want true", s)
		}
	}
	invalid := []string{"", "free ", "script:", "script:../etc", "script:a b", "script:中文", "SCRIPT:free", "script:" + strings.Repeat("s", 65)}
	for _, s := range invalid {
		if validScope(s) {
			t.Errorf("validScope(%q) = true, want false", s)
		}
	}
}

func TestRoleplayGateRejectsMissingUserID(t *testing.T) {
	server := newRoleplayTestServer(t, true)
	rec := doChatCompletionRequest(t, server, map[string]string{"x-fastclaw-scope": "free"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "x-fastclaw-user-id") {
		t.Fatalf("error body does not mention x-fastclaw-user-id: %s", rec.Body.String())
	}
}

func TestRoleplayGateRejectsInvalidScope(t *testing.T) {
	server := newRoleplayTestServer(t, true)
	rec := doChatCompletionRequest(t, server, map[string]string{
		"x-fastclaw-user-id": "u_abc",
		"x-fastclaw-scope":   "script:../etc",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "x-fastclaw-scope") {
		t.Fatalf("error body does not mention x-fastclaw-scope: %s", rec.Body.String())
	}
}

func TestRoleplayGateAcceptsValidHeaders(t *testing.T) {
	server := newRoleplayTestServer(t, true)
	rec := doChatCompletionRequest(t, server, map[string]string{
		"x-fastclaw-user-id": "u_abc",
		"x-fastclaw-scope":   "script:role-baizang",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}
	var resp chatCompletionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Choices) == 0 || resp.Choices[0].Message.Content != "ok" {
		t.Fatalf("reply = %+v, want provider content", resp.Choices)
	}
}

func TestNonRoleplayFallsBackToOwnerWithoutHeaders(t *testing.T) {
	// Legacy compatibility: a non-roleplay agent must keep serving
	// requests that omit x-fastclaw-user-id / x-fastclaw-scope (fallback
	// to owner / no-scope instead of 400).
	server := newRoleplayTestServer(t, false)
	rec := doChatCompletionRequest(t, server, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}
}

func TestCORSPreflightAllowsRoleplayHeaders(t *testing.T) {
	server := newRoleplayTestServer(t, false)
	req := httptest.NewRequest(http.MethodOptions, "/v1/chat/completions", nil)
	rec := httptest.NewRecorder()
	server.handleCORS(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	got := rec.Header().Get("Access-Control-Allow-Headers")
	for _, h := range []string{"x-fastclaw-user-id", "x-fastclaw-scope", "x-fastclaw-message-id", "x-fastclaw-no-persist"} {
		if !strings.Contains(got, h) {
			t.Errorf("CORS allow-headers missing %q: %q", h, got)
		}
	}
}
