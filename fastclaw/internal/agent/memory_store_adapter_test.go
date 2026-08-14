package agent

import (
	"context"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/store"
)

// fakeFileStore implements only the agent_files part of store.Store. All
// other methods panic through the embedded nil interface — the adapter
// under test never calls them.
type fakeFileStore struct {
	store.Store
	files map[string][]byte // key: agentID|userID|filename
}

func (f *fakeFileStore) GetAgentFile(ctx context.Context, agentID, userID, filename string) ([]byte, error) {
	key := agentID + "|" + userID + "|" + filename
	if data, ok := f.files[key]; ok {
		return data, nil
	}
	return nil, store.ErrNotFound
}

func (f *fakeFileStore) SaveAgentFile(ctx context.Context, agentID, userID, filename string, data []byte) error {
	f.files[agentID+"|"+userID+"|"+filename] = data
	return nil
}

func TestMemoryStoreAdapterFallsBackToOwnerRow(t *testing.T) {
	fs := &fakeFileStore{files: map[string][]byte{}}
	fs.files["ag|u_owner|MEMORY.md"] = []byte("owner memory")
	fs.files["ag|u_owner|USER.md"] = []byte("owner USER template")
	adapter := NewMemoryStoreAdapter(fs, "u_owner")

	got, err := adapter.GetMemory(context.Background(), "ag", "u_alice")
	if err != nil {
		t.Fatal(err)
	}
	if got != "owner memory" {
		t.Fatalf("GetMemory = %q, want owner fallback", got)
	}
	data, err := adapter.GetWorkspaceFile(context.Background(), "ag", "u_alice", "USER.md")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "owner USER template" {
		t.Fatalf("USER.md = %q, want owner fallback", data)
	}
}

func TestMemoryStoreAdapterChatterRowWins(t *testing.T) {
	fs := &fakeFileStore{files: map[string][]byte{}}
	fs.files["ag|u_owner|MEMORY.md"] = []byte("owner memory")
	fs.files["ag|u_alice|MEMORY.md"] = []byte("alice memory")
	adapter := NewMemoryStoreAdapter(fs, "u_owner")

	got, err := adapter.GetMemory(context.Background(), "ag", "u_alice")
	if err != nil {
		t.Fatal(err)
	}
	if got != "alice memory" {
		t.Fatalf("GetMemory = %q, want chatter row to win", got)
	}
}

func TestMemoryStoreAdapterWriteLandsOnChatterRowOnly(t *testing.T) {
	fs := &fakeFileStore{files: map[string][]byte{}}
	adapter := NewMemoryStoreAdapter(fs, "u_owner")
	if err := adapter.SaveMemory(context.Background(), "ag", "u_bob", "bob memory"); err != nil {
		t.Fatal(err)
	}
	if _, ok := fs.files["ag|u_bob|MEMORY.md"]; !ok {
		t.Fatalf("chatter row not written: %v", fs.files)
	}
	if _, ok := fs.files["ag|u_owner|MEMORY.md"]; ok {
		t.Fatal("owner row must never be written by a chatter save")
	}
	if err := adapter.SaveWorkspaceFile(context.Background(), "ag", "u_bob", "USER.md", []byte("bob user")); err != nil {
		t.Fatal(err)
	}
	if _, ok := fs.files["ag|u_bob|USER.md"]; !ok {
		t.Fatalf("chatter USER.md row not written: %v", fs.files)
	}
}

func TestMemoryStoreAdapterOwnerReadsItsOwnRow(t *testing.T) {
	fs := &fakeFileStore{files: map[string][]byte{}}
	fs.files["ag|u_owner|MEMORY.md"] = []byte("owner memory")
	adapter := NewMemoryStoreAdapter(fs, "u_owner")

	got, err := adapter.GetMemory(context.Background(), "ag", "u_owner")
	if err != nil {
		t.Fatal(err)
	}
	if got != "owner memory" {
		t.Fatalf("GetMemory = %q, want owner row for owner itself", got)
	}
}
