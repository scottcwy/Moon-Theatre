package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/agent"
	"github.com/fastclaw-ai/fastclaw/internal/auth"
	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
)

type runtimeSpecResolver struct {
	space *UserSpaceView
}

func (r *runtimeSpecResolver) UserSpaceFor(string) (*UserSpaceView, error) {
	return r.space, nil
}

func (r *runtimeSpecResolver) LocalAgentManager() *agent.Manager {
	return nil
}

func (r *runtimeSpecResolver) IsCloudMode() bool {
	return true
}

type runtimeSpecProvider struct{}

func (p *runtimeSpecProvider) Chat(
	context.Context,
	[]provider.Message,
	[]provider.Tool,
	string,
	int,
	float64,
) (*provider.Response, error) {
	return &provider.Response{Content: "ok"}, nil
}

func (p *runtimeSpecProvider) ChatStream(
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

func TestHandleAgentRuntimeSpecReturnsNonSecretRuntimeConfig(t *testing.T) {
	mgr, err := agent.NewManager([]config.ResolvedAgent{{
		ID:                "agt_speed",
		Home:              t.TempDir(),
		Model:             "openrouter/test-model",
		MaxTokens:         768,
		Temperature:       0.7,
		MaxToolIterations: 1,
	}}, &runtimeSpecProvider{}, bus.New(), agent.WithUserID("u_test"))
	if err != nil {
		t.Fatal(err)
	}

	server := NewServer(&runtimeSpecResolver{space: &UserSpaceView{
		UserID: "u_test",
		Agents: mgr,
	}}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/agents/agt_speed/runtime-spec", nil)
	req.SetPathValue("id", "agt_speed")
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{
		UserID:       "u_test",
		AuthMethod:   "apikey",
		APIKeyAgents: []string{"agt_speed"},
	}))
	rec := httptest.NewRecorder()

	server.HandleAgentRuntimeSpec(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["id"] != "agt_speed" {
		t.Fatalf("id = %v", body["id"])
	}
	if body["model"] != "openrouter/test-model" {
		t.Fatalf("model = %v", body["model"])
	}
	if body["maxTokens"] != float64(768) {
		t.Fatalf("maxTokens = %v", body["maxTokens"])
	}
	if body["maxToolIterations"] != float64(1) {
		t.Fatalf("maxToolIterations = %v", body["maxToolIterations"])
	}
	if _, ok := body["providers"]; ok {
		t.Fatal("runtime spec leaked providers")
	}
	if _, ok := body["apiKey"]; ok {
		t.Fatal("runtime spec leaked apiKey")
	}
}

func TestHandleAgentRuntimeSpecReturnsZeroMaxToolIterations(t *testing.T) {
	mgr, err := agent.NewManager([]config.ResolvedAgent{{
		ID:                "agt_no_tools",
		Home:              t.TempDir(),
		Model:             "openrouter/test-model",
		MaxTokens:         768,
		Temperature:       0.7,
		MaxToolIterations: 0,
	}}, &runtimeSpecProvider{}, bus.New(), agent.WithUserID("u_test"))
	if err != nil {
		t.Fatal(err)
	}

	server := NewServer(&runtimeSpecResolver{space: &UserSpaceView{
		UserID: "u_test",
		Agents: mgr,
	}}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/agents/agt_no_tools/runtime-spec", nil)
	req.SetPathValue("id", "agt_no_tools")
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{
		UserID:       "u_test",
		AuthMethod:   "apikey",
		APIKeyAgents: []string{"agt_no_tools"},
	}))
	rec := httptest.NewRecorder()

	server.HandleAgentRuntimeSpec(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["maxToolIterations"] != float64(0) {
		t.Fatalf("maxToolIterations = %v, want 0", body["maxToolIterations"])
	}
}

func TestHandleAgentRuntimeSpecRejectsApikeyWithoutAgentAccess(t *testing.T) {
	mgr, err := agent.NewManager([]config.ResolvedAgent{{
		ID:                "agt_speed",
		Home:              t.TempDir(),
		Model:             "openrouter/test-model",
		MaxTokens:         768,
		Temperature:       0.7,
		MaxToolIterations: 1,
	}}, &runtimeSpecProvider{}, bus.New(), agent.WithUserID("u_test"))
	if err != nil {
		t.Fatal(err)
	}

	server := NewServer(&runtimeSpecResolver{space: &UserSpaceView{
		UserID: "u_test",
		Agents: mgr,
	}}, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/agents/agt_speed/runtime-spec", nil)
	req.SetPathValue("id", "agt_speed")
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{
		UserID:       "u_test",
		AuthMethod:   "apikey",
		APIKeyAgents: []string{"agt_other"},
	}))
	rec := httptest.NewRecorder()

	server.HandleAgentRuntimeSpec(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}
