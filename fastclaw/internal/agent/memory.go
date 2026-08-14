package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/privacy"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
)

// MemoryStore is an optional interface for DB-backed memory persistence.
// userID is the chatter — chat-time MEMORY.md / USER.md updates land in
// that user's per-user override row so they don't pollute the shared
// template that the agent owner edits via the Customize page.
type MemoryStore interface {
	GetMemory(ctx context.Context, agentID, userID string) (string, error)
	SaveMemory(ctx context.Context, agentID, userID, content string) error
	GetWorkspaceFile(ctx context.Context, agentID, userID, filename string) ([]byte, error)
	SaveWorkspaceFile(ctx context.Context, agentID, userID, filename string, data []byte) error
}

type Memory struct {
	workspace string
	store     MemoryStore
	userID    string
	agentID   string
	// scope is the roleplay memory scope (F7): "" (legacy), "free", or
	// "script:<id>". It selects the agent_files filename namespace
	// (shared/MEMORY.md vs script_<id>/MEMORY.md) for roleplay agents.
	scope string
	// userLock serializes AutoPersist read-modify-write on USER.md for one
	// chatter across all scope instances (F7 P0). The agent shares one
	// lock per (agent, user) between the free and script Memory instances
	// so concurrent AutoPersist in two scopes cannot lose updates. Nil for
	// legacy agents (single Memory, no cross-scope hazard).
	userLock *sync.Mutex
}

func NewMemory(workspace string) *Memory {
	return &Memory{workspace: workspace}
}

// NewMemoryWithStoreForUser is the user-scoped constructor. userID must be
// a real users.id resolved from auth.
func NewMemoryWithStoreForUser(workspace string, st MemoryStore, userID, agentID string) *Memory {
	if userID == "" {
		panic("agent.NewMemoryWithStoreForUser: userID is required")
	}
	return &Memory{workspace: workspace, store: st, userID: userID, agentID: agentID}
}

// ctx returns a context tagged with this Memory's user so SQL queries in
// the store layer scope correctly. The store falls back to DefaultUserID
// when no user is on the context, but going through here is explicit and
// keeps callers from accidentally writing under "".
// SetScope configures the roleplay memory scope for filename routing.
func (m *Memory) SetScope(scope string) { m.scope = scope }

// SetUserLock attaches the per-(agent, user) write lock shared by all
// scope instances of this user (F7 P0 USER.md serialization).
func (m *Memory) SetUserLock(lock *sync.Mutex) { m.userLock = lock }

func (m *Memory) ctx() context.Context {
	if m.userID == "" {
		return context.Background()
	}
	return config.WithUserID(context.Background(), m.userID)
}

// memoryPath returns the path to MEMORY.md.
func (m *Memory) memoryPath() string {
	return filepath.Join(m.workspace, memoryFilename)
}

// sharedMemoryFile returns the agent_files filename that holds shared
// long-term memory (F7): legacy agents keep the bare MEMORY.md row;
// roleplay free/script scopes use shared/MEMORY.md.
func (m *Memory) sharedMemoryFile() string {
	if m.scope == "" {
		return memoryFilename
	}
	return "shared/" + memoryFilename
}

// scriptMemoryFile returns the agent_files filename for script-scoped
// story memory (script_<id>/MEMORY.md), or "" outside script mode.
func (m *Memory) scriptMemoryFile() string {
	if !strings.HasPrefix(m.scope, "script:") {
		return ""
	}
	return "script_" + strings.TrimPrefix(m.scope, "script:") + "/" + memoryFilename
}

// isScriptScope reports whether this memory instance is script-scoped.
func (m *Memory) isScriptScope() bool {
	return strings.HasPrefix(m.scope, "script:")
}

// loadStoreFile reads one agent_files row through the store.
func (m *Memory) loadStoreFile(name string) string {
	if m.store == nil {
		return ""
	}
	data, err := m.store.GetWorkspaceFile(m.ctx(), m.agentID, m.userID, name)
	if err != nil {
		return ""
	}
	return string(data)
}

// historyPath returns the path to HISTORY.md.
func (m *Memory) historyPath() string {
	return filepath.Join(m.workspace, "HISTORY.md")
}

// LoadMemory reads the long-term memory visible to the system prompt.
// Legacy scope: the single MEMORY.md row. Free scope: shared/MEMORY.md.
// Script scope: shared/MEMORY.md + script_<id>/MEMORY.md (F7).
func (m *Memory) LoadMemory() string {
	if m.store != nil {
		if m.scope == "" {
			content, err := m.store.GetMemory(m.ctx(), m.agentID, m.userID)
			if err == nil {
				return content
			}
			return ""
		}
		var sb strings.Builder
		for _, name := range m.memoryFiles() {
			if data := m.loadStoreFile(name); data != "" {
				if sb.Len() > 0 {
					sb.WriteString("\n")
				}
				sb.WriteString(data)
			}
		}
		if sb.Len() > 0 {
			return sb.String()
		}
		return ""
	}
	data, err := os.ReadFile(m.memoryPath())
	if err != nil {
		return ""
	}
	return string(data)
}

// memoryFiles lists the agent_files rows that hold long-term memory for
// the current scope (F7 routing table).
func (m *Memory) memoryFiles() []string {
	if m.scope == "" {
		return []string{memoryFilename}
	}
	if m.isScriptScope() {
		return []string{m.sharedMemoryFile(), m.scriptMemoryFile()}
	}
	return []string{m.sharedMemoryFile()}
}

// LoadSharedMemory reads only the shared long-term memory row (used by
// AutoPersist when appending user_info / relationship facts, so script
// story content never gets re-appended into shared).
func (m *Memory) LoadSharedMemory() string {
	if m.store != nil {
		if m.scope == "" {
			content, err := m.store.GetMemory(m.ctx(), m.agentID, m.userID)
			if err == nil {
				return content
			}
			return ""
		}
		return m.loadStoreFile(m.sharedMemoryFile())
	}
	data, err := os.ReadFile(filepath.Join(m.workspace, m.sharedMemoryFile()))
	if err != nil {
		return ""
	}
	return string(data)
}

// LoadScriptMemory reads only the script-scoped story memory row. Returns
// "" in free/legacy modes (no script file exists there).
func (m *Memory) LoadScriptMemory() string {
	if !m.isScriptScope() {
		return ""
	}
	if m.store != nil {
		return m.loadStoreFile(m.scriptMemoryFile())
	}
	data, err := os.ReadFile(filepath.Join(m.workspace, m.scriptMemoryFile()))
	if err != nil {
		return ""
	}
	return string(data)
}

// SaveMemory overwrites the shared long-term memory (F7: shared/MEMORY.md
// for roleplay scopes, MEMORY.md for legacy).
func (m *Memory) SaveMemory(content string) error {
	if m.store != nil {
		if m.scope == "" {
			return m.store.SaveMemory(m.ctx(), m.agentID, m.userID, content)
		}
		return m.store.SaveWorkspaceFile(m.ctx(), m.agentID, m.userID, m.sharedMemoryFile(), []byte(content))
	}
	os.MkdirAll(filepath.Dir(filepath.Join(m.workspace, m.sharedMemoryFile())), 0o755)
	return os.WriteFile(filepath.Join(m.workspace, m.sharedMemoryFile()), []byte(content), 0o644)
}

// SaveScriptMemory overwrites the script-scoped story memory
// (script_<id>/MEMORY.md). No-op in free/legacy modes: F7 free mode
// discards story candidates, so there is no script file to write.
func (m *Memory) SaveScriptMemory(content string) error {
	if !m.isScriptScope() {
		return nil
	}
	if m.store != nil {
		return m.store.SaveWorkspaceFile(m.ctx(), m.agentID, m.userID, m.scriptMemoryFile(), []byte(content))
	}
	os.MkdirAll(filepath.Dir(filepath.Join(m.workspace, m.scriptMemoryFile())), 0o755)
	return os.WriteFile(filepath.Join(m.workspace, m.scriptMemoryFile()), []byte(content), 0o644)
}

// AppendHistory adds an entry to the history log.
func (m *Memory) AppendHistory(entry string) error {
	os.MkdirAll(m.workspace, 0o755)
	f, err := os.OpenFile(m.historyPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	timestamp := time.Now().Format("2006-01-02 15:04:05")
	_, err = fmt.Fprintf(f, "- [%s] %s\n", timestamp, entry)
	return err
}

// LoadHistory reads the history log.
func (m *Memory) LoadHistory() string {
	data, err := os.ReadFile(m.historyPath())
	if err != nil {
		return ""
	}
	return string(data)
}

// ReviewAndUpdateMemory scans recent history entries and appends new key facts
// to MEMORY.md. This is called by the heartbeat to keep long-term memory fresh.
func (m *Memory) ReviewAndUpdateMemory(workspace string) {
	history := m.LoadHistory()
	if history == "" {
		return
	}

	// Get the last N lines of history to review
	lines := strings.Split(strings.TrimSpace(history), "\n")
	reviewCount := 50
	if len(lines) < reviewCount {
		reviewCount = len(lines)
	}
	recentLines := lines[len(lines)-reviewCount:]

	// Extract key facts from recent history (simple keyword-based extraction)
	currentMemory := m.LoadMemory()
	var newFacts []string

	for _, line := range recentLines {
		lower := strings.ToLower(line)
		// Look for lines that contain important keywords
		if containsAny(lower, []string{
			"learned", "discovered", "user prefers", "important",
			"remember", "note:", "key fact", "decision",
			"preference", "configured", "set up",
		}) {
			// Extract the content after the timestamp
			if idx := strings.Index(line, "] "); idx >= 0 {
				fact := strings.TrimSpace(line[idx+2:])
				if fact != "" && !strings.Contains(currentMemory, fact) {
					newFacts = append(newFacts, fact)
				}
			}
		}
	}

	if len(newFacts) == 0 {
		slog.Debug("memory review: no new facts to add")
		return
	}

	// Append new facts to MEMORY.md
	var sb strings.Builder
	sb.WriteString(currentMemory)
	if currentMemory != "" && !strings.HasSuffix(currentMemory, "\n") {
		sb.WriteString("\n")
	}
	sb.WriteString(fmt.Sprintf("\n## Auto-updated: %s\n", time.Now().Format("2006-01-02 15:04")))
	for _, fact := range newFacts {
		sb.WriteString(fmt.Sprintf("- %s\n", fact))
	}

	if err := m.SaveMemory(sb.String()); err != nil {
		slog.Warn("failed to update memory", "error", err)
		return
	}

	slog.Info("memory updated", "new_facts", len(newFacts))
}

func containsAny(s string, keywords []string) bool {
	for _, kw := range keywords {
		if strings.Contains(s, kw) {
			return true
		}
	}
	return false
}

// SaveMemoryWithScan scans content for threats before writing to MEMORY.md.
// Logs warnings for any detected threats but still writes (to avoid data loss).
func (m *Memory) SaveMemoryWithScan(content string) error {
	if threats := privacy.Scan(content); len(threats) > 0 {
		for _, t := range threats {
			slog.Warn("memory safety threat detected in MEMORY.md write",
				"type", t.Type,
				"pattern", t.Pattern,
				"context", t.Context,
			)
		}
	}
	return m.SaveMemory(content)
}

// SaveUserFile writes USER.md with threat scanning.
func (m *Memory) SaveUserFile(content string) error {
	if threats := privacy.Scan(content); len(threats) > 0 {
		for _, t := range threats {
			slog.Warn("memory safety threat detected in USER.md write",
				"type", t.Type,
				"pattern", t.Pattern,
				"context", t.Context,
			)
		}
	}
	if m.store != nil {
		return m.store.SaveWorkspaceFile(m.ctx(), m.agentID, m.userID, "USER.md", []byte(content))
	}
	os.MkdirAll(m.workspace, 0o755)
	return os.WriteFile(filepath.Join(m.workspace, "USER.md"), []byte(content), 0o644)
}

// LoadUserFile reads the USER.md file.
func (m *Memory) LoadUserFile() string {
	if m.store != nil {
		data, err := m.store.GetWorkspaceFile(m.ctx(), m.agentID, m.userID, "USER.md")
		if err == nil {
			return string(data)
		}
	}
	data, err := os.ReadFile(filepath.Join(m.workspace, "USER.md"))
	if err != nil {
		return ""
	}
	return string(data)
}

// AutoPersistMemory uses an LLM to extract roleplay memory facts from
// recent USER messages only (F5: assistant replies are never fed back)
// and routes them by the frozen F5/F7 table:
//
//	user_info (称呼/偏好类)      -> USER.md            (chatter row, global)
//	user_info (其余) + relationship -> shared/MEMORY.md
//	story                       -> script_<id>/MEMORY.md (script mode)
//	story in free mode          -> discarded (no script file)
//
// Output schema is frozen (single JSON, no markdown fences):
//
//	{"user_info": [...], "relationship": [...], "story": [...]}
//
// Extraction failures degrade silently — they never block the main reply.
// Called every N turns (per-user counter for roleplay).
func AutoPersistMemory(ctx context.Context, mem *Memory, prov provider.Provider, model string, thinking string, messages []provider.Message) {
	// Build a summary of recent user messages (assistant/system excluded).
	var sb strings.Builder
	userMsgs := make([]string, 0, len(messages))
	for _, m := range messages {
		if m.Role != "user" {
			continue
		}
		content := m.TextContent()
		if content == "" {
			continue
		}
		if len(content) > 300 {
			content = content[:300] + "..."
		}
		userMsgs = append(userMsgs, content)
	}
	start := 0
	if len(userMsgs) > 20 {
		start = len(userMsgs) - 20
	}
	for _, content := range userMsgs[start:] {
		sb.WriteString(fmt.Sprintf("[用户]: %s\n", content))
	}
	if sb.Len() == 0 {
		slog.Debug("auto-persist: no user messages to extract from")
		return
	}

	currentMemory := mem.LoadMemory()
	currentUserForPrompt := mem.LoadUserFile()

	extractPrompt := fmt.Sprintf(`你是剧本杀角色的记忆抽取助手。只从「用户消息」中抽取值得长期记忆的事实，忽略助手消息与系统提示。
输出三类（与产品记忆模型对齐）：
- user_info: 用户画像事实（称呼/名字、喜欢/讨厌、偏好/最爱、习惯、职业、年龄、来源地等）
- relationship: 用户与角色之间的关系、信任或态度变化
- story: 剧本剧情相关事实（场景、地点、线索、事件、剧情进展）

严格输出单条 JSON，无 markdown 围栏，无其他文字：
{"user_info": ["..."], "relationship": ["..."], "story": ["..."]}
没有值得保存的内容时对应数组为空。

当前记忆：
%s

当前用户档案：
%s

近期用户消息：
%s`,
		truncateStr(currentMemory, 500),
		truncateStr(currentUserForPrompt, 500),
		sb.String(),
	)

	resp, err := prov.Chat(ctx, []provider.Message{
		{Role: "user", Content: extractPrompt},
	}, nil, model, 200, 0.3, thinking)
	if err != nil {
		slog.Debug("auto-persist: LLM call failed", "error", err)
		return
	}

	var result AutoPersistResult
	if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &result); err != nil {
		slog.Debug("auto-persist: failed to parse LLM response", "error", err)
		return
	}

	// Route by the frozen F5/F7 table.
	var userFacts, sharedFacts, storyFacts []string
	for _, fact := range result.UserInfo {
		if routeUserInfoToUserProfile(fact) {
			userFacts = append(userFacts, fact)
		} else {
			sharedFacts = append(sharedFacts, fact)
		}
	}
	sharedFacts = append(sharedFacts, result.Relationship...)
	storyFacts = append(storyFacts, result.Story...)

	// Serialize AutoPersist writes per (agent, user) across scopes so the
	// free and script Memory instances cannot lose USER.md updates (F7 P0).
	// The whole read-modify-write of USER.md / shared / script files must
	// run under the lock: reading before it would let two goroutines base
	// their append on the same stale snapshot and drop updates.
	if mem.userLock != nil {
		mem.userLock.Lock()
		defer mem.userLock.Unlock()
	}

	// 称呼/偏好类 user_info -> USER.md (chatter row, cross-mode global)
	if len(userFacts) > 0 {
		currentUser := mem.LoadUserFile()
		next := appendFactSection(currentUser, "Auto-persisted", userFacts)
		if err := mem.SaveUserFile(next); err != nil {
			slog.Warn("auto-persist: failed to save USER.md", "error", err)
		} else {
			slog.Info("auto-persist: updated USER.md", "facts", len(userFacts))
		}
	}

	// 其余 user_info / relationship -> shared/MEMORY.md
	if len(sharedFacts) > 0 {
		currentShared := mem.LoadSharedMemory()
		next := appendFactSection(currentShared, "Auto-persisted", sharedFacts)
		if err := mem.SaveMemoryWithScan(next); err != nil {
			slog.Warn("auto-persist: failed to save shared MEMORY.md", "error", err)
		} else {
			slog.Info("auto-persist: updated shared MEMORY.md", "facts", len(sharedFacts))
		}
	}

	// story -> script_<id>/MEMORY.md (script mode only; free discards)
	if len(storyFacts) > 0 {
		if !mem.isScriptScope() {
			slog.Debug("auto-persist: dropping story facts in non-script scope", "facts", len(storyFacts))
		} else {
			currentScript := mem.LoadScriptMemory()
			next := appendFactSection(currentScript, "Auto-persisted", storyFacts)
			if err := mem.SaveScriptMemory(next); err != nil {
				slog.Warn("auto-persist: failed to save script MEMORY.md", "error", err)
			} else {
				slog.Info("auto-persist: updated script MEMORY.md", "facts", len(storyFacts))
			}
		}
	}
}

// AutoPersistResult mirrors the frozen F5 output JSON schema.
type AutoPersistResult struct {
	UserInfo     []string `json:"user_info"`
	Relationship []string `json:"relationship"`
	Story        []string `json:"story"`
}

// userProfileKeywords drives the frozen F5/F7 user_info sub-routing: a
// user_info fact mentioning these 用户画像 keywords goes to USER.md; the
// rest goes to shared/MEMORY.md. Aligned with apps/api extractor.ts
// USER_INFO_PATTERNS (称呼/名字/喜欢/讨厌/偏好/最爱/习惯/职业/年龄等).
var userProfileKeywords = []string{
	"称呼", "名字", "自称", "来自", "住在", "职业", "工作", "从事",
	"喜欢", "讨厌", "害怕", "担心", "期待", "偏好", "最爱", "习惯", "年龄",
	"过去", "以前", "曾经",
}

// routeUserInfoToUserProfile reports whether a user_info fact belongs in
// USER.md (称呼/偏好类) rather than shared/MEMORY.md (F5/F7 frozen rule).
func routeUserInfoToUserProfile(fact string) bool {
	for _, kw := range userProfileKeywords {
		if strings.Contains(fact, kw) {
			return true
		}
	}
	return false
}

// appendFactSection appends a dated fact section to existing file content.
func appendFactSection(current, sectionTitle string, facts []string) string {
	var sb strings.Builder
	sb.WriteString(current)
	if current != "" && !strings.HasSuffix(current, "\n") {
		sb.WriteString("\n")
	}
	sb.WriteString(fmt.Sprintf("\n## %s: %s\n", sectionTitle, time.Now().Format("2006-01-02 15:04")))
	for _, fact := range facts {
		sb.WriteString(fmt.Sprintf("- %s\n", fact))
	}
	return sb.String()
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
