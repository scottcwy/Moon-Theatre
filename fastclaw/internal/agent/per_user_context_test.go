package agent

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
	"github.com/fastclaw-ai/fastclaw/internal/session"
	"github.com/fastclaw-ai/fastclaw/internal/store"
)

// fakeUserMemStore is an in-memory agent.MemoryStore with owner fallback,
// mirroring the F3 chain (chatter row wins, owner row is the template).
type fakeUserMemStore struct {
	mu    sync.Mutex
	files map[string][]byte // key: agentID|userID|filename
}

func newFakeUserMemStore() *fakeUserMemStore {
	return &fakeUserMemStore{files: map[string][]byte{}}
}

func (f *fakeUserMemStore) key(agentID, userID, filename string) string {
	return agentID + "|" + userID + "|" + filename
}

func (f *fakeUserMemStore) GetMemory(ctx context.Context, agentID, userID string) (string, error) {
	data, err := f.GetWorkspaceFile(ctx, agentID, userID, "MEMORY.md")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (f *fakeUserMemStore) SaveMemory(ctx context.Context, agentID, userID, content string) error {
	return f.SaveWorkspaceFile(ctx, agentID, userID, "MEMORY.md", []byte(content))
}

func (f *fakeUserMemStore) GetWorkspaceFile(ctx context.Context, agentID, userID, filename string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if data, ok := f.files[f.key(agentID, userID, filename)]; ok {
		return data, nil
	}
	if userID != "u_owner" {
		if data, ok := f.files[f.key(agentID, "u_owner", filename)]; ok {
			return data, nil
		}
	}
	return nil, store.ErrNotFound
}

func (f *fakeUserMemStore) SaveWorkspaceFile(ctx context.Context, agentID, userID, filename string, data []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.files[f.key(agentID, userID, filename)] = data
	return nil
}

// fakeSessionDB implements the session-relevant parts of store.Store so the
// real session.StoreAdapter + session.Manager are exercised end to end.
type fakeSessionDB struct {
	store.Store // embed to satisfy the interface; only session methods are implemented
	mu          sync.Mutex
	msgs        map[string][]provider.Message // key: userID|agentID|sessionKey
}

func newFakeSessionDB() *fakeSessionDB {
	return &fakeSessionDB{msgs: map[string][]provider.Message{}}
}

func (f *fakeSessionDB) key(userID, agentID, sessionKey string) string {
	return userID + "|" + agentID + "|" + sessionKey
}

func (f *fakeSessionDB) GetSession(ctx context.Context, userID, agentID, sessionKey string) (*store.SessionRecord, error) {
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

func (f *fakeSessionDB) SaveSession(ctx context.Context, userID, agentID, sessionKey string, rec *store.SessionRecord) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	msgs := make([]provider.Message, 0, len(rec.Messages))
	for _, m := range rec.Messages {
		msgs = append(msgs, provider.Message{Role: m.Role, Content: m.Content, Metadata: m.Metadata})
	}
	f.msgs[f.key(userID, agentID, sessionKey)] = msgs
	return nil
}

func (f *fakeSessionDB) ListSessions(ctx context.Context, userID, agentID string) ([]store.SessionMeta, error) {
	return nil, nil
}

func (f *fakeSessionDB) DeleteSession(ctx context.Context, userID, agentID, sessionKey string) error {
	return nil
}

func (f *fakeSessionDB) RenameSession(ctx context.Context, userID, agentID, sessionKey, title string) error {
	return nil
}

func newRoleplayManagerWithStores(t *testing.T, prov provider.Provider, mem MemoryStore, sessDB *fakeSessionDB) *Manager {
	t.Helper()
	mgr, err := NewManager([]config.ResolvedAgent{{
		ID:                "agt_rp",
		Home:              t.TempDir(),
		Model:             "siliconflow/test-model",
		MaxTokens:         1024,
		Temperature:       0.7,
		MaxToolIterations: 0,
		Roleplay:          true,
	}}, prov, bus.New(),
		WithUserID("u_owner"),
		WithMemoryStore(mem),
		WithSessionStore(session.NewStoreAdapter(sessDB, "u_owner")),
		WithSessionStoreFactory(func(uid string) session.SessionStore {
			return session.NewStoreAdapter(sessDB, uid)
		}),
	)
	if err != nil {
		t.Fatal(err)
	}
	return mgr
}

func TestScopeKeyMapping(t *testing.T) {
	cases := map[string]string{
		"free":                "shared",
		"":                    "shared",
		"script:abc":          "script_abc",
		"script:role-baizang": "script_role-baizang",
	}
	for in, want := range cases {
		if got := scopeKey(in); got != want {
			t.Errorf("scopeKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRoleplayPerUserMemoryIsolation(t *testing.T) {
	prov := &captureProvider{}
	mem := newFakeUserMemStore()
	if err := mem.SaveWorkspaceFile(context.Background(), "agt_rp", "u_owner", "SOUL.md", []byte("你是白藏")); err != nil {
		t.Fatal(err)
	}
	if err := mem.SaveWorkspaceFile(context.Background(), "agt_rp", "u_alice", "USER.md", []byte("Alice 喜欢茶")); err != nil {
		t.Fatal(err)
	}
	if err := mem.SaveWorkspaceFile(context.Background(), "agt_rp", "u_bob", "USER.md", []byte("Bob 喜欢咖啡")); err != nil {
		t.Fatal(err)
	}
	mgr := newRoleplayManagerWithStores(t, prov, mem, newFakeSessionDB())
	ag := mgr.AgentByID("agt_rp")

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "sess-1", UserID: "u_alice", Scope: "free",
		Text: "你好", PeerKind: "dm",
	})
	aliceSys := prov.messages[0].Content

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "sess-1", UserID: "u_bob", Scope: "free",
		Text: "你好", PeerKind: "dm",
	})
	// captureProvider overwrites on every Chat call, so read the last
	// turn's system prompt from index 0 of the latest capture.
	bobSys := prov.messages[0].Content

	if !strings.Contains(aliceSys, "Alice 喜欢茶") {
		t.Errorf("Alice system prompt missing her USER.md:\n%s", aliceSys)
	}
	if strings.Contains(aliceSys, "Bob 喜欢咖啡") {
		t.Errorf("Alice system prompt leaked Bob's USER.md:\n%s", aliceSys)
	}
	if !strings.Contains(aliceSys, "你是白藏") {
		t.Errorf("Alice system prompt missing owner SOUL.md fallback:\n%s", aliceSys)
	}
	if !strings.Contains(bobSys, "Bob 喜欢咖啡") {
		t.Errorf("Bob system prompt missing his USER.md:\n%s", bobSys)
	}
	if strings.Contains(bobSys, "Alice 喜欢茶") {
		t.Errorf("Bob system prompt leaked Alice's USER.md:\n%s", bobSys)
	}
}

func TestRoleplaySessionsLandOnChatterRows(t *testing.T) {
	prov := &captureProvider{}
	mem := newFakeUserMemStore()
	sessDB := newFakeSessionDB()
	mgr := newRoleplayManagerWithStores(t, prov, mem, sessDB)
	ag := mgr.AgentByID("agt_rp")

	for _, uid := range []string{"u_alice", "u_bob"} {
		ag.HandleMessage(context.Background(), bus.InboundMessage{
			Channel: "api", ChatID: "sess-1", UserID: uid, Scope: "free",
			Text: "来自 " + uid, PeerKind: "dm",
		})
	}

	aliceKey := "u_alice|agt_rp|api_sess-1"
	bobKey := "u_bob|agt_rp|api_sess-1"
	ownerKey := "u_owner|agt_rp|api_sess-1"
	sessDB.mu.Lock()
	alice, aok := sessDB.msgs[aliceKey]
	bob, bok := sessDB.msgs[bobKey]
	_, ook := sessDB.msgs[ownerKey]
	sessDB.mu.Unlock()

	if !aok || len(alice) == 0 || alice[0].Content != "来自 u_alice" {
		t.Fatalf("Alice session row missing/mismatched: ok=%v msgs=%v", aok, alice)
	}
	if !bok || len(bob) == 0 || bob[0].Content != "来自 u_bob" {
		t.Fatalf("Bob session row missing/mismatched: ok=%v msgs=%v", bok, bob)
	}
	if ook {
		t.Fatal("owner must NOT hold the roleplay session row (per-chatter injection failed)")
	}
}

func TestRoleplayTurnCountLockedAndPerUser(t *testing.T) {
	ag := NewAgent(config.ResolvedAgent{
		ID: "agt_rp", Home: t.TempDir(), Model: "siliconflow/test-model",
		MaxTokens: 1024, Temperature: 0.7, MaxToolIterations: 0, Roleplay: true,
	}, &captureProvider{}, bus.New(), t.TempDir())

	ucA := ag.resolveUserContext(bus.InboundMessage{UserID: "u_a", Scope: "free"})
	ucB := ag.resolveUserContext(bus.InboundMessage{UserID: "u_b", Scope: "script:role-baizang"})
	if ucA == nil || ucB == nil {
		t.Fatal("resolveUserContext returned nil for roleplay agent")
	}
	if ucA.memory.scope != "free" || ucB.memory.scope != "script:role-baizang" {
		t.Fatalf("memory scopes = %q / %q, want free / script:role-baizang", ucA.memory.scope, ucB.memory.scope)
	}

	const turns = 50
	var wg sync.WaitGroup
	for i := 0; i < turns; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); ag.runPostTurn(context.Background(), ucA, nil, 0) }()
		go func() { defer wg.Done(); ag.runPostTurn(context.Background(), ucB, nil, 0) }()
	}
	wg.Wait()

	ucA.turnMu.Lock()
	a := ucA.turnCount
	ucA.turnMu.Unlock()
	ucB.turnMu.Lock()
	b := ucB.turnCount
	ucB.turnMu.Unlock()
	if a != turns || b != turns {
		t.Fatalf("turn counts = %d / %d, want %d each", a, b, turns)
	}
}

func TestLegacyTurnCountLocked(t *testing.T) {
	ag := NewAgent(config.ResolvedAgent{
		ID: "agt_legacy", Home: t.TempDir(), Model: "siliconflow/test-model",
		MaxTokens: 1024, Temperature: 0.7, MaxToolIterations: 0,
	}, &captureProvider{}, bus.New(), t.TempDir())

	const turns = 50
	var wg sync.WaitGroup
	for i := 0; i < turns; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); ag.runPostTurn(context.Background(), nil, nil, 0) }()
	}
	wg.Wait()

	ag.turnMu.Lock()
	n := ag.turnCount
	ag.turnMu.Unlock()
	if n != turns {
		t.Fatalf("legacy turn count = %d, want %d", n, turns)
	}
}

func TestRoleplayReloadWorkspaceFilesResetsUserID(t *testing.T) {
	prov := &captureProvider{}
	mem := newFakeUserMemStore()
	if err := mem.SaveWorkspaceFile(context.Background(), "agt_rp", "u_bob", "USER.md", []byte("Bob 喜欢咖啡")); err != nil {
		t.Fatal(err)
	}
	mgr := newRoleplayManagerWithStores(t, prov, mem, newFakeSessionDB())
	ag := mgr.AgentByID("agt_rp")

	ag.ReloadWorkspaceFiles()
	if ag.ctxBuilder.userID != "u_owner" {
		t.Fatalf("ctxBuilder.userID = %q after reload, want owner %q", ag.ctxBuilder.userID, "u_owner")
	}

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "sess-1", UserID: "u_bob", Scope: "free",
		Text: "你好", PeerKind: "dm",
	})
	sys := prov.messages[0].Content
	if !strings.Contains(sys, "Bob 喜欢咖啡") {
		t.Errorf("system prompt after reload missing Bob USER.md (per-user read broken):\n%s", sys)
	}
}
