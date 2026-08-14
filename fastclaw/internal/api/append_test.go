package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fastclaw-ai/fastclaw/internal/agent"
	"github.com/fastclaw-ai/fastclaw/internal/auth"
	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
	"github.com/fastclaw-ai/fastclaw/internal/session"
	"github.com/fastclaw-ai/fastclaw/internal/store"
)

// appendSessionStore implements the session-relevant part of store.Store.
type appendSessionStore struct {
	store.Store
	mu   sync.Mutex
	msgs map[string][]provider.Message // userID|agentID|sessionKey
}

func newAppendSessionStore() *appendSessionStore {
	return &appendSessionStore{msgs: map[string][]provider.Message{}}
}

func (f *appendSessionStore) key(userID, agentID, sessionKey string) string {
	return userID + "|" + agentID + "|" + sessionKey
}

func (f *appendSessionStore) GetSession(ctx context.Context, userID, agentID, sessionKey string) (*store.SessionRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	msgs, ok := f.msgs[f.key(userID, agentID, sessionKey)]
	if !ok {
		return nil, store.ErrNotFound
	}
	rec := &store.SessionRecord{Messages: make([]store.SessionMessage, 0, len(msgs))}
	for _, m := range msgs {
		rec.Messages = append(rec.Messages, store.SessionMessage{Role: m.Role, Content: m.Content, Metadata: m.Metadata, Timestamp: time.Now()})
	}
	return rec, nil
}

func (f *appendSessionStore) SaveSession(ctx context.Context, userID, agentID, sessionKey string, rec *store.SessionRecord) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	msgs := make([]provider.Message, 0, len(rec.Messages))
	for _, m := range rec.Messages {
		msgs = append(msgs, provider.Message{Role: m.Role, Content: m.Content, Metadata: m.Metadata})
	}
	f.msgs[f.key(userID, agentID, sessionKey)] = msgs
	return nil
}

func (f *appendSessionStore) ListSessions(ctx context.Context, userID, agentID string) ([]store.SessionMeta, error) {
	return nil, nil
}

func (f *appendSessionStore) DeleteSession(ctx context.Context, userID, agentID, sessionKey string) error {
	return nil
}

func (f *appendSessionStore) RenameSession(ctx context.Context, userID, agentID, sessionKey, title string) error {
	return nil
}

// appendOwnershipChecker is a scriptable F8 ownership probe.
type appendOwnershipChecker struct{ taken bool }

func (c appendOwnershipChecker) SessionTakenByOther(ctx context.Context, agentID, sessionKey, userID string) (bool, error) {
	return c.taken, nil
}

func newAppendTestServer(t *testing.T, checker agent.SessionOwnershipChecker) (*Server, *appendSessionStore) {
	t.Helper()
	sessDB := newAppendSessionStore()
	mgr, err := agent.NewManager([]config.ResolvedAgent{{
		ID:                "agt_rp",
		Home:              t.TempDir(),
		Model:             "openrouter/test-model",
		MaxTokens:         768,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
	}}, &runtimeSpecProvider{}, bus.New(),
		agent.WithUserID("u_owner"),
		agent.WithSessionStore(session.NewStoreAdapter(sessDB, "u_owner")),
		agent.WithSessionStoreFactory(func(uid string) session.SessionStore {
			return session.NewStoreAdapter(sessDB, uid)
		}),
		agent.WithSessionOwnershipChecker(checker),
	)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(&runtimeSpecResolver{space: &UserSpaceView{
		UserID: "u_owner",
		Agents: mgr,
	}}, nil, nil)
	return server, sessDB
}

func doAppend(t *testing.T, server *Server, key string, headers map[string]string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/sessions/"+key+"/messages", strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.SetPathValue("key", key)
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{
		UserID:       "u_owner",
		AuthMethod:   "apikey",
		APIKeyAgents: []string{"agt_rp"},
	}))
	rec := httptest.NewRecorder()
	server.HandleAppendMessage(rec, req)
	return rec
}

func appendHeaders(extra map[string]string) map[string]string {
	h := map[string]string{
		"x-fastclaw-agent-id": "agt_rp",
		"x-fastclaw-user-id":  "u_alice",
		"x-fastclaw-scope":    "free",
	}
	for k, v := range extra {
		h[k] = v
	}
	return h
}

func TestAppendMessageIdempotent(t *testing.T) {
	server, sessDB := newAppendTestServer(t, appendOwnershipChecker{taken: false})
	body := `{"role":"assistant","content":"回访留言","messageId":"msg-1"}`

	rec := doAppend(t, server, "sess-1", appendHeaders(nil), body)
	if rec.Code != http.StatusOK {
		t.Fatalf("first append status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["appended"] != true {
		t.Fatalf("first append appended = %v, want true", resp["appended"])
	}

	rec = doAppend(t, server, "sess-1", appendHeaders(nil), body)
	if rec.Code != http.StatusOK {
		t.Fatalf("second append status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["appended"] != false {
		t.Fatalf("second append appended = %v, want false (idempotent skip)", resp["appended"])
	}

	sessDB.mu.Lock()
	msgs := sessDB.msgs["u_alice|agt_rp|api_sess-1"]
	sessDB.mu.Unlock()
	if len(msgs) != 1 || msgs[0].Role != "assistant" || msgs[0].Content != "回访留言" {
		t.Fatalf("session messages = %+v, want exactly one assistant message", msgs)
	}
	if msgs[0].Metadata["messageId"] != "msg-1" {
		t.Fatalf("messageId metadata = %v, want msg-1 persisted", msgs[0].Metadata["messageId"])
	}
}

func TestAppendMessageForbiddenWhenOwnedByOtherUser(t *testing.T) {
	server, sessDB := newAppendTestServer(t, appendOwnershipChecker{taken: true})
	rec := doAppend(t, server, "sess-1", appendHeaders(nil), `{"role":"assistant","content":"入侵","messageId":"msg-1"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body = %s", rec.Code, rec.Body.String())
	}
	sessDB.mu.Lock()
	rows := len(sessDB.msgs)
	sessDB.mu.Unlock()
	if rows != 0 {
		t.Fatalf("forbidden append wrote %d session rows, want 0", rows)
	}
}

func TestAppendMessageRequiresAgentAndScope(t *testing.T) {
	server, _ := newAppendTestServer(t, appendOwnershipChecker{taken: false})
	body := `{"role":"assistant","content":"x","messageId":"m-1"}`

	// Missing agent-id -> 400.
	rec := doAppend(t, server, "sess-1", map[string]string{
		"x-fastclaw-user-id": "u_alice",
		"x-fastclaw-scope":   "free",
	}, body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing agent-id status = %d, want 400", rec.Code)
	}
	// Missing scope (roleplay gate) -> 400.
	rec = doAppend(t, server, "sess-1", map[string]string{
		"x-fastclaw-agent-id": "agt_rp",
		"x-fastclaw-user-id":  "u_alice",
	}, body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing scope status = %d, want 400", rec.Code)
	}
	// Missing user-id (roleplay gate) -> 400.
	rec = doAppend(t, server, "sess-1", map[string]string{
		"x-fastclaw-agent-id": "agt_rp",
		"x-fastclaw-scope":    "free",
	}, body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing user-id status = %d, want 400", rec.Code)
	}
	// Missing messageId -> 400.
	rec = doAppend(t, server, "sess-1", appendHeaders(nil), `{"role":"assistant","content":"x"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing messageId status = %d, want 400", rec.Code)
	}
}

func TestAppendMessageCreatesSessionUnderChatter(t *testing.T) {
	server, sessDB := newAppendTestServer(t, appendOwnershipChecker{taken: false})
	rec := doAppend(t, server, "sess-1", appendHeaders(nil), `{"role":"assistant","content":"回访留言","messageId":"msg-1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	sessDB.mu.Lock()
	_, aliceOK := sessDB.msgs["u_alice|agt_rp|api_sess-1"]
	_, ownerOK := sessDB.msgs["u_owner|agt_rp|api_sess-1"]
	sessDB.mu.Unlock()
	if !aliceOK {
		t.Fatal("append must create the session under the chatter user_id (F2 per-chatter injection)")
	}
	if ownerOK {
		t.Fatal("append must not create the session under the owner user_id")
	}
}

func TestChatCompletionNoPersistDoesNotPersist(t *testing.T) {
	server, sessDB := newAppendTestServer(t, appendOwnershipChecker{taken: false})

	body := `{"stream":true,"messages":[{"role":"system","content":"你是白藏"},{"role":"user","content":"回访生成"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("x-fastclaw-agent-id", "agt_rp")
	req.Header.Set("x-fastclaw-user-id", "u_alice")
	req.Header.Set("x-fastclaw-scope", "free")
	req.Header.Set("x-fastclaw-no-persist", "true")
	req.Header.Set("x-fastclaw-session-key", "sess-1")
	req = req.WithContext(auth.WithIdentity(req.Context(), auth.Identity{
		UserID:       "u_owner",
		AuthMethod:   "apikey",
		APIKeyAgents: []string{"agt_rp"},
	}))
	rec := httptest.NewRecorder()
	server.HandleChatCompletions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	sessDB.mu.Lock()
	rows := len(sessDB.msgs)
	sessDB.mu.Unlock()
	if rows != 0 {
		t.Fatalf("no-persist chat completion wrote %d session rows, want 0", rows)
	}
}
