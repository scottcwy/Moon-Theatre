package agent

import (
	"context"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/bus"
)

func TestRoleplaySessionDedupByClientMessageID(t *testing.T) {
	prov := &captureProvider{}
	mem := newFakeUserMemStore()
	sessDB := newFakeSessionDB()
	mgr := newRoleplayManagerWithStores(t, prov, mem, sessDB)
	ag := mgr.AgentByID("agt_rp")

	// Simulate an API retry: the same clientMessageId arrives twice.
	for i := 0; i < 2; i++ {
		ag.HandleMessage(context.Background(), bus.InboundMessage{
			Channel: "api", ChatID: "sess-1", UserID: "u_alice", Scope: "free",
			MessageID: "cm-1", Text: "重试的消息", PeerKind: "dm",
		})
	}

	sessDB.mu.Lock()
	msgs := sessDB.msgs["u_alice|agt_rp|api_sess-1"]
	sessDB.mu.Unlock()
	var userCount int
	for _, m := range msgs {
		if m.Role == "user" {
			userCount++
		}
	}
	if userCount != 1 {
		t.Fatalf("user messages in session = %d, want 1 (F9 dedup failed): %+v", userCount, msgs)
	}
}

func TestNoPersistStreamDoesNotMutateTargetSession(t *testing.T) {
	prov := &captureProvider{}
	mem := newFakeUserMemStore()
	sessDB := newFakeSessionDB()
	mgr := newRoleplayManagerWithStores(t, prov, mem, sessDB)
	ag := mgr.AgentByID("agt_rp")

	// One normal turn seeds the target session.
	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "sess-1", UserID: "u_alice", Scope: "free",
		Text: "你好", PeerKind: "dm",
	})
	sessDB.mu.Lock()
	before := len(sessDB.msgs["u_alice|agt_rp|api_sess-1"])
	sessDB.mu.Unlock()

	// F10: read-only generation against the same session.
	sr := ag.HandleMessageStream(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "sess-1", UserID: "u_alice", Scope: "free",
		NoPersist: true, Text: "回访生成", PeerKind: "dm",
	})
	var got string
	for {
		chunk, ok := sr.Next()
		if !ok {
			break
		}
		got += chunk.Content
	}
	if got == "" {
		t.Fatal("no-persist generation returned empty reply")
	}

	sessDB.mu.Lock()
	after := len(sessDB.msgs["u_alice|agt_rp|api_sess-1"])
	sessDB.mu.Unlock()
	if after != before {
		t.Fatalf("target session mutated by no-persist turn: %d -> %d messages", before, after)
	}

	// turnCount must not advance (F10: 不计 turnCount).
	uc := ag.resolveUserContext(bus.InboundMessage{UserID: "u_alice", Scope: "free"})
	uc.turnMu.Lock()
	n := uc.turnCount
	uc.turnMu.Unlock()
	if n != 1 {
		t.Fatalf("turnCount = %d, want 1 (only the normal turn counted)", n)
	}

	// History is still fed to the model as context.
	if len(prov.messages) < 3 {
		t.Fatalf("provider messages = %d, want history fed to context", len(prov.messages))
	}
	// F10: the current no-persist message must be the final provider
	// message (memory only) so generation is not detached from the
	// request.
	if last := prov.messages[len(prov.messages)-1]; last.Role != "user" || last.Content != "回访生成" {
		t.Fatalf("last provider message = %+v, want user %q (current message in context)", last, "回访生成")
	}
}

func TestNoPersistWithoutSessionKeyCreatesNoRow(t *testing.T) {
	prov := &captureProvider{}
	mem := newFakeUserMemStore()
	sessDB := newFakeSessionDB()
	mgr := newRoleplayManagerWithStores(t, prov, mem, sessDB)
	ag := mgr.AgentByID("agt_rp")

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "", UserID: "u_alice", Scope: "free",
		NoPersist: true, Text: "回访生成无目标会话", PeerKind: "dm",
	})

	sessDB.mu.Lock()
	rows := len(sessDB.msgs)
	sessDB.mu.Unlock()
	if rows != 0 {
		t.Fatalf("no-persist without a session key created %d session rows, want 0 (no orphan row)", rows)
	}
	if len(prov.messages) == 0 {
		t.Fatal("provider received no messages")
	}
	if last := prov.messages[len(prov.messages)-1]; last.Role != "user" || last.Content != "回访生成无目标会话" {
		t.Fatalf("last provider message = %+v, want user %q (no session key must still feed current message)", last, "回访生成无目标会话")
	}
}

func TestNoPersistHandleMessageSkipsAppendAndTurnCount(t *testing.T) {
	prov := &captureProvider{}
	mem := newFakeUserMemStore()
	sessDB := newFakeSessionDB()
	mgr := newRoleplayManagerWithStores(t, prov, mem, sessDB)
	ag := mgr.AgentByID("agt_rp")

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "sess-1", UserID: "u_alice", Scope: "free",
		Text: "你好", PeerKind: "dm",
	})
	sessDB.mu.Lock()
	before := len(sessDB.msgs["u_alice|agt_rp|api_sess-1"])
	sessDB.mu.Unlock()

	ag.HandleMessage(context.Background(), bus.InboundMessage{
		Channel: "api", ChatID: "sess-1", UserID: "u_alice", Scope: "free",
		NoPersist: true, Text: "回访生成非流式", PeerKind: "dm",
	})
	sessDB.mu.Lock()
	after := len(sessDB.msgs["u_alice|agt_rp|api_sess-1"])
	sessDB.mu.Unlock()
	if after != before {
		t.Fatalf("session mutated by no-persist non-stream turn: %d -> %d", before, after)
	}
	uc := ag.resolveUserContext(bus.InboundMessage{UserID: "u_alice", Scope: "free"})
	uc.turnMu.Lock()
	n := uc.turnCount
	uc.turnMu.Unlock()
	if n != 1 {
		t.Fatalf("turnCount = %d, want 1", n)
	}
	if last := prov.messages[len(prov.messages)-1]; last.Role != "user" || last.Content != "回访生成非流式" {
		t.Fatalf("last provider message = %+v, want user %q (current message in context)", last, "回访生成非流式")
	}
}
