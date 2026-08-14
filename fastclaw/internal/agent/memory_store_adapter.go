package agent

import (
	"context"
	"errors"

	"github.com/fastclaw-ai/fastclaw/internal/store"
)

// MemoryStoreAdapter exposes the agent's identity + memory files via the
// underlying store. Reads implement the F3 fallback chain: the chatter's
// per-user row wins when present, and a miss falls back to the owner row
// (the role-card template written by provisioning). Writes always land on
// the chatter's row, never the owner template.
type MemoryStoreAdapter struct {
	st      store.Store
	ownerID string
}

func NewMemoryStoreAdapter(st store.Store, ownerID string) *MemoryStoreAdapter {
	return &MemoryStoreAdapter{st: st, ownerID: ownerID}
}

const memoryFilename = "MEMORY.md"

func (a *MemoryStoreAdapter) GetMemory(ctx context.Context, agentID, userID string) (string, error) {
	data, err := a.st.GetAgentFile(ctx, agentID, userID, memoryFilename)
	if errors.Is(err, store.ErrNotFound) && a.ownerID != "" && userID != a.ownerID {
		data, err = a.st.GetAgentFile(ctx, agentID, a.ownerID, memoryFilename)
	}
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *MemoryStoreAdapter) SaveMemory(ctx context.Context, agentID, userID, content string) error {
	return a.st.SaveAgentFile(ctx, agentID, userID, memoryFilename, []byte(content))
}

func (a *MemoryStoreAdapter) GetWorkspaceFile(ctx context.Context, agentID, userID, filename string) ([]byte, error) {
	data, err := a.st.GetAgentFile(ctx, agentID, userID, filename)
	if errors.Is(err, store.ErrNotFound) && a.ownerID != "" && userID != a.ownerID {
		data, err = a.st.GetAgentFile(ctx, agentID, a.ownerID, filename)
	}
	if err != nil {
		return nil, err
	}
	return data, nil
}

func (a *MemoryStoreAdapter) SaveWorkspaceFile(ctx context.Context, agentID, userID, filename string, data []byte) error {
	return a.st.SaveAgentFile(ctx, agentID, userID, filename, data)
}
