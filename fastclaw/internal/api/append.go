package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/fastclaw-ai/fastclaw/internal/agent"
)

// appendMessageRequest mirrors the F8 append body: {role, content,
// messageId}. messageId is the product messages.id (UUID) — a separate ID
// space from F9's clientMessageId (return messages vs chat user messages).
type appendMessageRequest struct {
	Role      string `json:"role"`
	Content   string `json:"content"`
	MessageID string `json:"messageId"`
}

// HandleAppendMessage implements POST /v1/sessions/{key}/messages (F8):
// a write-only, idempotent append of a return-message into a session.
// It never triggers generation, AutoPersist, billing, or bond effects.
// The x-fastclaw-agent-id header is mandatory (sessions are isolated by
// (user_id, agent_id, session_key)); x-fastclaw-scope must match the
// target session's mode (回访留言 targets free). Ownership is checked
// first: an already-taken session key under another user returns 403.
func (s *Server) HandleAppendMessage(w http.ResponseWriter, r *http.Request) {
	sessionKey := r.PathValue("key")
	if sessionKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"message": "session key is required", "type": "invalid_request_error"},
		})
		return
	}
	var req appendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"message": "invalid request body", "type": "invalid_request_error"},
		})
		return
	}
	if req.Role == "" || req.Content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"message": "role and content are required", "type": "invalid_request_error"},
		})
		return
	}
	if req.MessageID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"message": "messageId is required", "type": "invalid_request_error"},
		})
		return
	}

	space, err := s.userSpaceFor(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": map[string]string{"message": err.Error(), "type": "authentication_error"},
		})
		return
	}

	// F8: agent-id is mandatory — the session namespace is
	// (user_id, agent_id, session_key) and session managers are per-agent.
	agentID := r.Header.Get("x-fastclaw-agent-id")
	if agentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"message": "x-fastclaw-agent-id is required", "type": "invalid_request_error"},
		})
		return
	}
	ag := space.Agents.AgentByID(agentID)
	if ag == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": map[string]string{"message": "agent not found", "type": "not_found_error"},
		})
		return
	}

	// F1 gate: roleplay agents require valid user-id + scope (400);
	// non-roleplay agents fall back to owner / no-scope.
	userID, scope, gateErr := s.resolveUserAndScope(ag, space, r)
	if gateErr != "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": map[string]string{"message": gateErr, "type": "invalid_request_error"},
		})
		return
	}

	appended, err := ag.AppendMessage(r.Context(), userID, scope, sessionKey, req.Role, req.Content, req.MessageID)
	if err != nil {
		if errors.Is(err, agent.ErrSessionOwnedByOther) {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error": map[string]string{"message": "session is owned by another user", "type": "permission_error"},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": map[string]string{"message": "failed to append message", "type": "server_error"},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"appended": appended})
}
