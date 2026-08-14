package agent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/codeany-ai/open-agent-sdk-go/costtracker"

	"github.com/fastclaw-ai/fastclaw/internal/agent/tools"
	"github.com/fastclaw-ai/fastclaw/internal/bus"
	"github.com/fastclaw-ai/fastclaw/internal/config"
	"github.com/fastclaw-ai/fastclaw/internal/mcp"
	"github.com/fastclaw-ai/fastclaw/internal/privacy"
	"github.com/fastclaw-ai/fastclaw/internal/provider"
	"github.com/fastclaw-ai/fastclaw/internal/sandbox"
	"github.com/fastclaw-ai/fastclaw/internal/session"
	"github.com/fastclaw-ai/fastclaw/internal/store"
	"github.com/fastclaw-ai/fastclaw/internal/toolproviders"
	"github.com/fastclaw-ai/fastclaw/internal/workspace"
)

// Agent is the ReAct agent loop.
type Agent struct {
	name              string
	provider          provider.Provider
	registry          *tools.Registry
	sessions          *session.Manager
	memory            *Memory
	ctxBuilder        *ContextBuilder
	mcpMgr            *mcp.Manager
	hooks             *HookRegistry
	model             string
	maxTokens         int
	temperature       float64
	maxToolIterations int
	thinking          string
	roleplay          bool
	homePath          string // agent's home: SOUL.md, sessions, memory, skills
	workspacePath     string // working dir where agent creates user files
	homeDir           string // FastClaw root, ~/.fastclaw
	ownerUserID       string // the user that owns this agent (for hook namespacing)
	skillsCfg         config.SkillsConfig
	globalSkillsCfg   config.SkillsCfg
	messageBus        *bus.MessageBus
	subAgentSpawner   tools.SubAgentSpawner
	ftsStore          *store.FTSStore
	piiScrubEnabled   bool
	memoryCfg         config.MemoryCfg
	// memoryStore is the optional Store-backed source of identity files
	// (SOUL.md, IDENTITY.md, ...). Kept on the Agent so ReloadWorkspaceFiles
	// can rewire a fresh ContextBuilder to keep reading from the Store
	// instead of silently falling back to pod-local filesystem.
	memoryStore MemoryStore
	// workspaceStore is optional; when set, SkillsLoader hydrates per-agent
	// and global skill dirs from the object store on every turn so skills
	// uploaded post-boot or on a sibling replica become visible here.
	workspaceStore workspace.Store
	skillsLearner  *SkillsLearner
	turnCount      int
	turnMu         sync.Mutex // serializes the legacy (non-roleplay) turnCount (F2 P0)
	// perUserCtx caches roleplay per-(userID, scopeKey) contexts (F2):
	// memory, sessions and turnCount are isolated per chatter+scope,
	// lazily created on first turn. Non-roleplay agents never use it.
	perUserCtx sync.Map // key userCtxKey, value *userContext
	// userFileLocks serializes AutoPersist writes to USER.md per chatter
	// across scope instances (F7 P0): free and script Memory instances of
	// the same user share one lock so read-modify-write cannot lose
	// updates. Keyed by userID.
	userFileLocks sync.Map // key userID, value *sync.Mutex
	// sessionStoreFactory builds a session store bound to the chatter
	// userID so per-chatter session managers persist under the chatter
	// row (F2/F8 ownership).
	sessionStoreFactory func(userID string) session.SessionStore
	// sessionOwnership is the optional F8 ownership probe (gateway-backed
	// store query). Nil when unavailable (local/file mode) — the 403 is
	// defense-in-depth; the API chat_sessions.userId contract is primary.
	sessionOwnership SessionOwnershipChecker
	engine           *sdkEngine
	costTracker      *costtracker.Tracker
	agentID          string
	// sandboxPool is the per-user (agent + session) sandbox pool. Set
	// once at boot/hot-reload by attachSandboxToAgents; bindSession
	// pulls a session-scoped executor from it at the top of every turn
	// so concurrent sessions of the same agent get isolated containers
	// + isolated /workspace mounts.
	sandboxPool sandbox.ExecutorPool
}

// userCtxKey identifies a roleplay agent's per-user context.
type userCtxKey struct {
	userID   string
	scopeKey string
}

// userContext is the per-(userID, scopeKey) state a roleplay agent keeps:
// its own scope-routed Memory, its own session manager (store user_id =
// chatter, so F8 ownership checks work), and its own turn counter
// (AutoPersist trigger).
type userContext struct {
	memory    *Memory
	sessions  *session.Manager
	turnMu    sync.Mutex
	turnCount int
}

// scopeKey maps a validated F1 scope to the agent_files namespace used by
// F7: "free" (or empty) -> "shared", "script:<id>" -> "script_<id>".
func scopeKey(scope string) string {
	if scope == "" || scope == "free" {
		return "shared"
	}
	if strings.HasPrefix(scope, "script:") {
		return "script_" + strings.TrimPrefix(scope, "script:")
	}
	return scope
}

// resolveUserContext returns the per-(userID, scopeKey) context for a
// roleplay turn, lazily creating it on first use. Non-roleplay agents
// return nil and keep using the agent-level (owner) sessions/memory so
// legacy behavior is unchanged.
func (a *Agent) resolveUserContext(msg bus.InboundMessage) *userContext {
	if !a.roleplay || msg.UserID == "" {
		return nil
	}
	key := userCtxKey{userID: msg.UserID, scopeKey: scopeKey(msg.Scope)}
	if v, ok := a.perUserCtx.Load(key); ok {
		return v.(*userContext)
	}
	uc := &userContext{
		memory:   a.newUserMemory(msg.UserID, msg.Scope),
		sessions: a.newUserSessionManager(msg.UserID),
	}
	actual, _ := a.perUserCtx.LoadOrStore(key, uc)
	return actual.(*userContext)
}

func (a *Agent) newUserMemory(userID, scope string) *Memory {
	var m *Memory
	if a.memoryStore != nil {
		m = NewMemoryWithStoreForUser(a.homePath, a.memoryStore, userID, a.name)
	} else {
		m = NewMemory(filepath.Join(a.homePath, "users", userID))
	}
	m.SetScope(scope)
	m.SetUserLock(a.userFileLock(userID))
	return m
}

// userFileLock returns the per-user AutoPersist write lock, creating it
// on first use. Shared by every scope instance of the same user (F7 P0).
func (a *Agent) userFileLock(userID string) *sync.Mutex {
	lock := &sync.Mutex{}
	actual, _ := a.userFileLocks.LoadOrStore(userID, lock)
	return actual.(*sync.Mutex)
}

func (a *Agent) newUserSessionManager(userID string) *session.Manager {
	dataDir := filepath.Join(a.homePath, "sessions", userID)
	if a.sessionStoreFactory != nil {
		return session.NewManagerWithStoreForUser(dataDir, a.sessionStoreFactory(userID), userID, a.name)
	}
	return session.NewManager(dataDir)
}

// turnContextBuilder returns the ContextBuilder for one turn. Roleplay
// agents get a shallow copy stamped with the chatter userID + that user's
// Memory so identity files read chatter-first with owner fallback (F3)
// and long-term memory is per-user / scope-routed (F7). Non-roleplay
// agents reuse the base builder (legacy behavior). Copying per turn also
// keeps the per-user view consistent with hot reloads of a.ctxBuilder
// (ReloadWorkspaceFiles / refreshSkillsFromStore).
func (a *Agent) turnContextBuilder(uc *userContext, msg bus.InboundMessage) *ContextBuilder {
	if uc == nil {
		return a.ctxBuilder
	}
	cb := *a.ctxBuilder
	cb.userID = msg.UserID
	cb.memory = uc.memory
	return &cb
}

// ErrSessionOwnedByOther is returned by AppendMessage when the target
// session key already belongs to a different user (F8 ownership check,
// defense-in-depth).
var ErrSessionOwnedByOther = errors.New("agent: session is owned by another user")

// AppendMessage appends a return-message to the target session (F8).
// Semantics: write-only — no generation, no AutoPersist, no billing, no
// bond effects. Idempotent on messageId (persisted in the message's
// Metadata.messageId, which rides along with the session JSON, so
// restarts/multi-replica dedup work). The ownership check runs first:
// if the session key is already taken by a different user, it returns
// ErrSessionOwnedByOther. Check-then-create is intentionally non-atomic
// (F8); the API layer's chat_sessions.userId contract is the primary
// defense. Returns (false, nil) when messageId was already appended.
func (a *Agent) AppendMessage(ctx context.Context, userID, scope, sessionKey, role, content, messageID string) (bool, error) {
	if messageID == "" {
		return false, errors.New("agent: messageId is required")
	}
	if a.sessionOwnership != nil {
		taken, err := a.sessionOwnership.SessionTakenByOther(ctx, a.name, session.StoreKey("api", sessionKey), userID)
		if err != nil {
			return false, err
		}
		if taken {
			return false, ErrSessionOwnedByOther
		}
	}
	uc := a.resolveUserContext(bus.InboundMessage{Channel: "api", ChatID: sessionKey, UserID: userID, Scope: scope})
	var sess *session.Session
	if uc != nil {
		sess = uc.sessions.Get("api", sessionKey)
	} else {
		sess = a.sessions.Get("api", sessionKey)
	}
	return sess.AppendIfAbsent(provider.Message{
		Role:     role,
		Content:  content,
		Metadata: map[string]any{"messageId": messageID},
	}), nil
}

// SetSandboxPool wires the per-(agent,session) executor pool. Called by
// attachSandboxToAgents on boot and by hot-reload's reloadSandbox after
// onboarding flips sandbox on. The pool is consulted by bindSession at
// the start of every chat turn — there's no eager Get at boot anymore
// because session IDs only exist once a chat starts.
//
// Also flips the context builder's sandbox flag so the system prompt's
// "Working Directory" / filesystem-layout description matches reality.
// Without this, an agent whose rc.Sandbox.Enabled=false but who got a
// pool reference (attachSandboxToAgents wires the pool to ALL agents
// once any one of them wants sandbox) ends up with exec routed through
// the container while the prompt still advertises host paths — model
// dutifully writes `/Users/.../workspaces/<id>/foo` which 404s inside
// the container. The two states must agree.
func (a *Agent) SetSandboxPool(p sandbox.ExecutorPool) {
	a.sandboxPool = p
	if a.ctxBuilder != nil {
		a.ctxBuilder.sandboxEnabled = p != nil
	}
	// Tell the tool registry sandbox is required so its host-shell exec
	// fallback refuses to run when bindSession can't bind an executor.
	// The two states (system prompt advertising /workspace + /skills,
	// exec actually using sandbox) must agree — without this, a Docker
	// daemon hiccup turns into "sh: python: command not found" on the
	// host instead of a clear "sandbox required but unavailable" error.
	if a.registry != nil {
		a.registry.SetSandboxRequired(p != nil)
	}
}

// bindSession wires per-turn session state into the tool registry: the
// session-scoped sandbox executor (when a pool is configured) and the
// sessionID workspace.Store calls use to namespace artifacts. Called at
// the top of HandleMessage / HandleMessageStream before any tool runs.
//
// Mutating the shared registry across concurrent chats would race, but
// the current invariant is one chat-in-flight per agent — the gateway
// serializes per-agent turns. Documenting it here in case that changes.
func (a *Agent) bindSession(ctx context.Context, sessionID string) {
	a.registry.SetSessionID(sessionID)
	if a.sandboxPool == nil {
		return
	}
	ex, err := a.sandboxPool.Get(ctx, a.name, sessionID)
	if err != nil {
		// Error level (not warn) — when sandbox is required and we
		// can't bind, the next exec call will refuse with the
		// "sandboxRequired but no executor" message; log here so the
		// upstream cause (docker daemon down, image pull failed, …) is
		// captured next to the user-facing error.
		slog.Error("sandbox executor unavailable; exec will refuse host fallback",
			"agent", a.name, "session", sessionID, "error", err)
		return
	}
	a.registry.SetExecutor(ex)
}

// NewAgent creates a new Agent from a resolved config.
func NewAgent(rc config.ResolvedAgent, prov provider.Provider, mb *bus.MessageBus, homeDir string) *Agent {
	return NewAgentWithSkillsCfg(rc, prov, mb, homeDir, config.SkillsCfg{})
}

// NewAgentWithFullCfg creates a new Agent with full config support (memory, privacy, skills learner).
func NewAgentWithFullCfg(rc config.ResolvedAgent, prov provider.Provider, mb *bus.MessageBus, homeDir string, fullCfg *config.Config) *Agent {
	ag := NewAgentWithSkillsCfg(rc, prov, mb, homeDir, fullCfg.Skills)
	// memoryCfg comes from rc.Memory (wired in NewAgentWithSkillsCfg);
	// ResolveAgents/MergedAgentConfig copies cfg.Memory into rc.Memory.
	ag.piiScrubEnabled = fullCfg.Privacy.PIIScrubbing.Enabled

	// Set up FTS store if configured
	if fullCfg.Memory.FTS.Enabled {
		dbPath := fullCfg.Memory.FTS.DBPath
		if dbPath == "" {
			dbPath = rc.Home + "/memory/fts.db"
		}
		if fts, err := store.NewFTSStore(dbPath); err == nil {
			if err := fts.Init(); err == nil {
				ag.ftsStore = fts
				slog.Info("FTS5 search enabled", "agent", rc.ID, "db", dbPath)
			} else {
				slog.Warn("FTS5 init failed, falling back to file scan", "error", err)
			}
		} else {
			slog.Warn("FTS5 store open failed, falling back to file scan", "error", err)
		}
	}

	// Set up skills learner if configured
	if fullCfg.SkillsLearner.Enabled {
		model := fullCfg.SkillsLearner.Model
		if model == "" {
			model = rc.Model
		}
		learnerLoader := NewSkillsLoaderWithGlobal(homeDir, rc.Home, "", rc.Skills, fullCfg.Skills)
		learnerLoader.agentID = rc.ID
		ag.skillsLearner = NewSkillsLearner(rc.Home, prov, model, rc.Thinking, learnerLoader.AllSkillDirs()...)
		if fullCfg.SkillsLearner.MinToolCalls > 0 {
			ag.skillsLearner.minToolCalls = fullCfg.SkillsLearner.MinToolCalls
		}
	}

	return ag
}

// NewAgentWithSkillsCfg creates a new Agent with global skills config for env injection.
func NewAgentWithSkillsCfg(rc config.ResolvedAgent, prov provider.Provider, mb *bus.MessageBus, homeDir string, globalSkillsCfg config.SkillsCfg) *Agent {
	workspace := rc.Workspace
	if workspace == "" {
		// Fallback for callers (tests, legacy configs) that don't populate
		// Workspace — use the agent's home as a single-dir fallback.
		workspace = rc.Home
	}
	// Ensure the workspace dir exists so the first write_file doesn't fail.
	if workspace != "" {
		_ = os.MkdirAll(workspace, 0o755)
	}

	memory := NewMemory(rc.Home)
	registry := tools.NewRegistry(rc.Home, workspace)
	tools.RegisterMessage(registry, mb)
	tools.RegisterMemorySearch(registry, rc.Home)
	tools.RegisterWebFetch(registry)

	// Load skills with OpenClaw compatibility. We can't hydrate from OSS
	// here — the Agent isn't constructed yet and the manager hasn't wired
	// workspaceStore. The manager will call ReloadWorkspaceFiles after
	// wiring to refresh the summary with OSS-hosted skills, and runOnce
	// re-hydrates on every turn to pick up later uploads.
	loader := NewSkillsLoaderWithGlobal(homeDir, rc.Home, "", rc.Skills, globalSkillsCfg)
	loader.agentID = rc.ID
	skills := loader.LoadSkills()
	skillsSummary := loader.BuildSkillsSummary(skills)

	// Set up skill env injection for exec tool. Pass an sbCfg carrying
	// just the Enabled flag so the host-mode closure (used until
	// bindSession swaps in a sandboxed executor on session start) knows
	// sandbox was REQUIRED for this agent — without that signal an
	// executor-pool failure would silently fall through to /bin/sh on the
	// host, defeating the security boundary the user asked for.
	skillDirs := loader.AllSkillDirs()
	var sbCfg *tools.SandboxConfig
	if rc.Sandbox.Enabled {
		sbCfg = &tools.SandboxConfig{Enabled: true}
	}
	tools.RegisterExecWithSkillEnv(registry, sbCfg, loader.SkillEnvVars, skillDirs)

	if len(skills) > 0 {
		slog.Info("loaded skills", "agent", rc.ID, "count", len(skills))
	}

	// Set up hooks with logging
	hooks := NewHookRegistry()
	hooks.Register(BeforeModelCall, LoggingHook())
	hooks.Register(AfterModelCall, LoggingHook())
	hooks.Register(BeforeToolCall, LoggingHook())
	hooks.Register(AfterToolCall, LoggingHook())

	eng := newSDKEngine(rc.ID)

	ag := &Agent{
		name:              rc.ID,
		provider:          prov,
		registry:          registry,
		sessions:          session.NewManager(rc.Home + "/sessions"),
		memory:            memory,
		memoryCfg:         rc.Memory,
		ctxBuilder:        newContextBuilderWithSandbox(rc.Home, workspace, memory, skillsSummary, rc.Thinking, rc.Sandbox.Enabled, rc.Sandbox.Backend),
		hooks:             hooks,
		model:             rc.Model,
		maxTokens:         rc.MaxTokens,
		temperature:       rc.Temperature,
		maxToolIterations: rc.MaxToolIterations,
		thinking:          rc.Thinking,
		roleplay:          rc.Roleplay,
		homePath:          rc.Home,
		workspacePath:     workspace,
		homeDir:           homeDir,
		skillsCfg:         rc.Skills,
		globalSkillsCfg:   globalSkillsCfg,
		messageBus:        mb,
		engine:            eng,
		costTracker:       eng.costTracker,
	}

	// Auto-persist defaults: an omitted everyNTurns means every 5 turns
	// (Spec §8). runPostTurn divides by EveryNTurns once enabled, so 0
	// would panic — default before the gate can ever see it. Enabled stays
	// false unless a config row explicitly turns it on (legacy unchanged).
	if ag.memoryCfg.AutoPersist.EveryNTurns == 0 {
		ag.memoryCfg.AutoPersist.EveryNTurns = 5
	}

	// Connect MCP servers and register their tools
	ag.SetRoleplay(rc.Roleplay)

	if len(rc.MCPServers) > 0 {
		mcpMgr := mcp.NewManager(rc.MCPServers)
		ag.mcpMgr = mcpMgr

		for _, td := range mcpMgr.ToolDefs() {
			toolName := td.Name
			ag.registry.Register(toolName, td.Description, td.InputSchema,
				func(ctx context.Context, args json.RawMessage) (string, error) {
					return mcpMgr.CallTool(ctx, toolName, args)
				},
			)
		}

		if mcpMgr.HasTools() {
			slog.Info("registered MCP tools", "agent", rc.ID)
		}
	}

	return ag
}

func newContextBuilderWithThinking(home string, memory *Memory, skillsSummary string, thinking string) *ContextBuilder {
	cb := NewContextBuilder(home, memory, skillsSummary)
	if thinking != "" {
		cb.SetThinking(thinking)
	}
	return cb
}

func newContextBuilderWithSandbox(home, workspace string, memory *Memory, skillsSummary string, thinking string, sandboxEnabled bool, sandboxBackend string) *ContextBuilder {
	cb := newContextBuilderWithThinking(home, memory, skillsSummary, thinking)
	cb.SetWorkspace(workspace)
	cb.sandboxEnabled = sandboxEnabled
	cb.sandboxBackend = sandboxBackend
	return cb
}

// Name returns the agent's name.
func (a *Agent) Name() string {
	return a.name
}

// HandleWebChat handles a chat message from the web UI with a session ID.
func (a *Agent) HandleWebChat(ctx context.Context, sessionId, text string) string {
	if sessionId == "" {
		sessionId = "web-ui"
	}
	msg := bus.InboundMessage{
		Channel:  "web",
		ChatID:   sessionId,
		UserID:   "web-user",
		Text:     text,
		PeerKind: "dm",
	}
	return a.HandleMessage(ctx, msg)
}

// HandleWebChatStream handles a web chat message with real-time event streaming.
// imageURLs carries any user-attached images (data URLs or fetchable HTTPS
// links) so vision-capable models receive them as image_url content parts on
// the user message.
func (a *Agent) HandleWebChatStream(ctx context.Context, sessionId, text string, imageURLs []string, events chan<- ChatEvent) string {
	if sessionId == "" {
		sessionId = "web-ui"
	}
	ctx = ContextWithChatEvents(ctx, events)
	msg := bus.InboundMessage{
		Channel:   "web",
		ChatID:    sessionId,
		UserID:    "web-user",
		Text:      text,
		PeerKind:  "dm",
		PhotoURLs: imageURLs,
	}
	return a.HandleMessage(ctx, msg)
}

// home returns the agent's home (metadata) directory path.
func (a *Agent) home() string {
	return a.homePath
}

// SetGroupContext configures group chat awareness for this agent's system prompt.
func (a *Agent) SetGroupContext(gc *GroupContext) {
	a.ctxBuilder.SetGroupContext(gc)
}

// InjectGroupMessage appends a message from another bot into the session history
// without triggering an LLM call. This gives the agent awareness of what other
// bots said in the group chat.
func (a *Agent) InjectGroupMessage(ctx context.Context, msg bus.InboundMessage) {
	sess := a.sessions.Get(msg.Channel, msg.ChatID)
	label := msg.SenderName
	if label == "" {
		label = "Bot"
	}
	content := fmt.Sprintf("[%s]: %s", label, msg.Text)
	sess.Append(provider.Message{Role: "user", Content: content})
}

// SetSubAgentSpawner sets the sub-agent spawner for the spawn_subagent tool.
func (a *Agent) SetSubAgentSpawner(spawner tools.SubAgentSpawner) {
	a.subAgentSpawner = spawner
	tools.RegisterSubAgent(a.registry, spawner, a.name)
}

// ToolRegistry returns the agent's tool registry for external registration.
func (a *Agent) ToolRegistry() *tools.Registry {
	return a.registry
}

// SetOwnerUserID tags this agent with the owning user ID. The value is
// propagated into every HookContext so plugins like mem0 can namespace
// data per user.
func (a *Agent) SetOwnerUserID(uid string) {
	a.ownerUserID = uid
}

// HookRegistry returns the agent's hook registry for external hook registration.
func (a *Agent) HookRegistry() *HookRegistry {
	return a.hooks
}

// RegisterWebSearchChain exposes the web_search tool to this agent using a
// provider chain (primary + fallbacks). Pass nil to skip — the tool won't
// appear in the agent's tool list, so the model can't try to call it.
func (a *Agent) RegisterWebSearchChain(chain *toolproviders.Chain) {
	tools.RegisterWebSearchChain(a.registry, chain)
}

// RegisterImageGenChain exposes the image_gen tool to this agent.
func (a *Agent) RegisterImageGenChain(chain *toolproviders.Chain) {
	tools.RegisterImageGenChain(a.registry, chain)
}

// RegisterTTSChain exposes the tts tool to this agent.
func (a *Agent) RegisterTTSChain(chain *toolproviders.Chain) {
	tools.RegisterTTSChain(a.registry, chain)
}

// Sessions returns the session manager for this agent.
func (a *Agent) Sessions() *session.Manager {
	return a.sessions
}

// WebChatHistory returns chat history for a specific web session.
func (a *Agent) WebChatHistory(sessionId string) []map[string]any {
	if sessionId == "" {
		sessionId = "web-ui"
	}
	sess := a.sessions.Get("web", sessionId)
	msgs := sess.GetMessages()
	var history []map[string]any
	for _, m := range msgs {
		switch m.Role {
		case "user":
			// Multimodal user turns store text inside ContentParts and
			// leave Content empty (see HandleMessageStream's image
			// attachment path). Surface both shapes here:
			//   - text (Content fallback to joined text parts)
			//   - imageUrls (image_url parts) so the chat UI can render
			//     image thumbnails on bubbles loaded from history, not
			//     just on the live in-flight bubble.
			text := m.TextContent()
			var imageURLs []string
			for _, p := range m.ContentParts {
				if p.Type == "image_url" && p.ImageURL != nil && p.ImageURL.URL != "" {
					imageURLs = append(imageURLs, p.ImageURL.URL)
				}
			}
			if text == "" && len(imageURLs) == 0 {
				continue
			}
			entry := map[string]any{"role": "user", "content": text}
			if len(imageURLs) > 0 {
				entry["imageUrls"] = imageURLs
			}
			history = append(history, entry)
		case "assistant":
			entry := map[string]any{"role": "assistant"}
			if m.Content != "" {
				entry["content"] = m.Content
			}
			if len(m.ToolCalls) > 0 {
				var calls []map[string]string
				for _, tc := range m.ToolCalls {
					calls = append(calls, map[string]string{
						"id":        tc.ID,
						"name":      tc.Function.Name,
						"arguments": tc.Function.Arguments,
					})
				}
				entry["toolCalls"] = calls
			}
			// Skip empty assistant messages (no content, no tool calls)
			if m.Content == "" && len(m.ToolCalls) == 0 {
				continue
			}
			history = append(history, entry)
		case "tool":
			entry := map[string]any{
				"role":       "tool",
				"content":    m.Content,
				"name":       m.Name,
				"toolCallId": m.ToolCallID,
			}
			if len(m.Metadata) > 0 {
				entry["metadata"] = m.Metadata
			}
			history = append(history, entry)
		}
	}
	return history
}

// WebChatSessions returns a list of web chat sessions with metadata.
func (a *Agent) WebChatSessions() []session.WebSession {
	return a.sessions.ListWebSessions()
}

// DeleteWebChatSession removes a web chat session.
func (a *Agent) DeleteWebChatSession(sessionId string) error {
	return a.sessions.DeleteWebSession(sessionId)
}

// RenameWebChatSession sets a custom title for a web chat session.
func (a *Agent) RenameWebChatSession(sessionId, title string) error {
	return a.sessions.RenameWebSession(sessionId, title)
}

// Model returns the agent's model name.
func (a *Agent) Model() string {
	return a.model
}

// RuntimeSpec is intentionally limited to non-secret fields. Do not add
// provider credentials, prompts, memory, workspace paths, or user data here.
type RuntimeSpec struct {
	ID                string  `json:"id"`
	Model             string  `json:"model"`
	MaxTokens         int     `json:"maxTokens"`
	Temperature       float64 `json:"temperature"`
	MaxToolIterations int     `json:"maxToolIterations"`
	Thinking          string  `json:"thinking,omitempty"`
	Roleplay          bool    `json:"roleplay"`
}

// RuntimeSpec returns the non-secret runtime knobs that affect model latency.
func (a *Agent) RuntimeSpec() RuntimeSpec {
	return RuntimeSpec{
		ID:                a.name,
		Model:             a.model,
		MaxTokens:         a.maxTokens,
		Temperature:       a.temperature,
		MaxToolIterations: a.maxToolIterations,
		Thinking:          a.thinking,
		Roleplay:          a.roleplay,
	}
}

// IsRoleplay reports whether this agent runs in roleplay mode (F4). Roleplay
// agents get per-(userID, scopeKey) contexts, no runtime/tool preamble in the
// system prompt, and request-scoped system prompts as Turn Context instead of
// wholesale replacement.
func (a *Agent) IsRoleplay() bool {
	return a.roleplay
}

// SetRoleplay flips roleplay mode on the agent and its context builder. Used
// by hot-reload paths (UpdateConfig) that rebuild runtime knobs without
// recreating the Agent.
func (a *Agent) SetRoleplay(b bool) {
	a.roleplay = b
	if a.ctxBuilder != nil {
		a.ctxBuilder.SetRoleplay(b)
	}
}

// CostTracker returns the agent's cost tracker for usage/billing queries.
func (a *Agent) CostTracker() *costtracker.Tracker {
	return a.costTracker
}

func selectSystemPrompt(defaultPrompt string, override string) string {
	if strings.TrimSpace(override) == "" {
		return defaultPrompt
	}
	return override
}

// turnMessages assembles the provider message list for one turn. Roleplay
// agents (F4) treat the request-scoped SystemPromptOverride as Turn Context:
// the base system prompt stays, and the override is inserted as an additional
// system-role message between the prompt and the history — never as a user
// message (which would pollute user-side semantics). Non-roleplay keeps the
// legacy replace behavior via selectSystemPrompt.
func (a *Agent) turnMessages(systemPrompt, override string, sessionMsgs []provider.Message) []provider.Message {
	messages := make([]provider.Message, 0, len(sessionMsgs)+2)
	messages = append(messages, provider.Message{Role: "system", Content: systemPrompt})
	if a.roleplay && strings.TrimSpace(override) != "" {
		messages = append(messages, provider.Message{Role: "system", Content: override})
	}
	return append(messages, sessionMsgs...)
}

func (a *Agent) handleMessageWithoutTools(
	ctx context.Context,
	msg bus.InboundMessage,
	uc *userContext,
	sess *session.Session,
	noPersist bool,
	messages []provider.Message,
) string {
	hcBefore := &HookContext{AgentName: a.name, Point: BeforeModelCall, Messages: messages, ChatID: msg.ChatID, UserID: a.ownerUserID}
	a.hooks.Run(ctx, hcBefore)

	llmMessages := messages
	if a.piiScrubEnabled {
		llmMessages = privacy.ScrubMessages(messages)
	}

	if a.provider == nil {
		slog.Error("agent has no provider configured", "agent", a.name, "model", a.model)
		noProviderMsg := "Agent is not configured with a usable LLM provider. Check that cfg.Providers contains the prefix referenced by model `" + a.model + "`."
		emitEvent(ctx, ChatEvent{Type: "error", Data: map[string]any{"message": noProviderMsg}})
		emitEvent(ctx, ChatEvent{Type: "done"})
		return noProviderMsg
	}
	resp, err := a.provider.Chat(ctx, llmMessages, nil, a.model, a.maxTokens, a.temperature, a.thinking)

	hcAfter := &HookContext{AgentName: a.name, Point: AfterModelCall, Messages: messages, Response: resp, Error: err, StartTime: hcBefore.StartTime, ChatID: msg.ChatID, UserID: a.ownerUserID}
	a.hooks.Run(ctx, hcAfter)

	if err != nil {
		slog.Error("LLM chat failed", "agent", a.name, "error", err)
		emitEvent(ctx, ChatEvent{Type: "error", Data: map[string]any{"message": err.Error()}})
		emitEvent(ctx, ChatEvent{Type: "done"})
		return "Sorry, I encountered an error processing your request."
	}

	assistantMsg := provider.Message{
		Role:         "assistant",
		Content:      resp.Content,
		Thinking:     resp.Thinking,
		Timestamp:    time.Now().UnixMilli(),
		RawAssistant: resp.RawAssistant,
	}
	if !noPersist {
		sess.Append(assistantMsg)
	}
	emitEvent(ctx, ChatEvent{Type: "content", Data: map[string]any{"content": resp.Content}})
	emitEvent(ctx, ChatEvent{Type: "done"})
	if !noPersist {
		a.runPostTurn(ctx, uc, append(messages, assistantMsg), 0)
	}
	return resp.Content
}

// HandleMessage processes an inbound message through the ReAct loop.
func (a *Agent) HandleMessage(ctx context.Context, msg bus.InboundMessage) string {
	// Check for slash commands first
	if result := a.handleSlashCommand(msg); result.handled {
		emitEvent(ctx, ChatEvent{Type: "content", Data: map[string]any{"content": result.reply}})
		emitEvent(ctx, ChatEvent{Type: "done"})
		return result.reply
	}

	a.refreshSkillsFromStore()
	uc := a.resolveUserContext(msg)
	var sess *session.Session
	if msg.NoPersist {
		// F10 read-only generation: a target session key only supplies
		// history for context; nothing is appended, compacted, or
		// post-processed. No key means no session at all (no orphan row).
		if msg.ChatID != "" {
			if uc != nil {
				sess = uc.sessions.Get(msg.Channel, msg.ChatID)
			} else {
				sess = a.sessions.Get(msg.Channel, msg.ChatID)
			}
		}
	} else if uc != nil {
		sess = uc.sessions.Get(msg.Channel, msg.ChatID)
	} else {
		sess = a.sessions.Get(msg.Channel, msg.ChatID)
	}
	// Bind the registry to this chat's session so workspace.Store reads
	// + writes get session-scoped paths and (when a sandbox pool is
	// wired) the executor used by exec/read_file/list_dir is tied to a
	// session-private container.
	a.bindSession(ctx, msg.ChatID)

	// Safety net for client-aborted turns: if the loop exits with a
	// tool_use that never got its matching tool_result appended (the
	// user clicked Stop while a long-running exec was in flight, the
	// SDK returned no response for it, etc.), pad the orphan so the
	// session history stays well-formed. Without this, the tool keeps
	// rendering as a forever-spinning "running" entry on history
	// rebuild and the next turn's API call gets a 400 from Anthropic
	// for orphaned tool_use ids. No-op when no session was resolved
	// (F10 read-only without a session key).
	if sess != nil {
		defer padOrphanToolResults(sess)
	}

	// Hook: BeforeSystemPrompt
	a.hooks.Run(ctx, &HookContext{AgentName: a.name, Point: BeforeSystemPrompt, UserID: a.ownerUserID})

	cb := a.turnContextBuilder(uc, msg)
	systemPrompt := cb.BuildSystemPrompt()
	if !a.roleplay {
		systemPrompt = selectSystemPrompt(systemPrompt, msg.SystemPromptOverride)
	}

	// Hook: AfterSystemPrompt
	a.hooks.Run(ctx, &HookContext{AgentName: a.name, Point: AfterSystemPrompt, UserID: a.ownerUserID})

	// Store the raw user message. Images may arrive via the legacy
	// PhotoURL (single, used by IM bridges) or PhotoURLs (multi, used by
	// the web chat upload path); flatten both into one content-parts
	// slice so the provider sees `[text, image, image, …]`.
	userMsg := provider.Message{Role: "user", Content: msg.Text}
	imageURLs := msg.PhotoURLs
	if msg.PhotoURL != "" {
		imageURLs = append([]string{msg.PhotoURL}, imageURLs...)
	}
	if len(imageURLs) > 0 {
		userMsg.Content = ""
		// Skip an empty leading text part — image-only sends used to
		// produce `[{text: ""}, {image_url}, …]` which some upstreams
		// reject as a content-less wire message.
		var parts []provider.ContentPart
		if msg.Text != "" {
			parts = append(parts, provider.ContentPart{Type: "text", Text: msg.Text})
		}
		for _, u := range imageURLs {
			parts = append(parts, provider.ContentPart{
				Type: "image_url", ImageURL: &provider.ImageURL{URL: u, Detail: "auto"},
			})
		}
		userMsg.ContentParts = parts
	}
	// F9: the product clientMessageId rides in Metadata.clientMessageId
	// and is persisted with the session JSON. AppendIfAbsent skips when
	// an identical user message is already in the session (API retry),
	// under the session lock. Missing message-id keeps legacy append.
	if msg.MessageID != "" {
		userMsg.Metadata = map[string]any{"clientMessageId": msg.MessageID}
	}
	if !msg.NoPersist {
		if msg.MessageID != "" {
			if !sess.AppendIfAbsent(userMsg) {
				slog.Info("session dedup: user message already present", "agent", a.name, "chat", msg.ChatID, "message_id", msg.MessageID)
			}
		} else {
			sess.Append(userMsg)
		}
	}

	// Context compaction: check if session messages are too large.
	// Skipped in no-persist mode — the target session is read-only.
	var sessionMsgs []provider.Message
	if sess != nil {
		sessionMsgs = sess.GetMessages()
		if !msg.NoPersist {
			compactResult, err := CompactMessages(sessionMsgs, a.homePath, a.provider, a.model, a.thinking)
			if err != nil {
				slog.Warn("compaction error", "agent", a.name, "error", err)
			}
			if compactResult != nil && compactResult.Pruned {
				// Replace session messages with compacted version
				sess.ReplaceMessages(compactResult.Messages)
				sessionMsgs = compactResult.Messages
				slog.Info("context compacted", "agent", a.name, "log_file", compactResult.LogFile)
			}
		}
	}

	messages := a.turnMessages(systemPrompt, msg.SystemPromptOverride, sessionMsgs)
	if msg.NoPersist {
		// F10 read-only generation: the current user message joins the
		// provider context in memory only (last message). It is never
		// appended to the target session, so no session write, no
		// AutoPersist, and no turnCount.
		messages = append(messages, userMsg)
	}

	// F10 no-persist always uses the pure-text path: generation must not
	// mutate the target session through tool results.
	if a.maxToolIterations == 0 || msg.NoPersist {
		return a.handleMessageWithoutTools(ctx, msg, uc, sess, msg.NoPersist, messages)
	}
	toolDefs := a.registry.Definitions()

	// Loop detection: track consecutive identical tool calls
	type toolCallSig struct {
		name string
		hash [32]byte
	}
	var lastSig toolCallSig
	consecutiveCount := 0
	totalToolCalls := 0

	// ReAct loop
	for i := 0; i < a.maxToolIterations; i++ {
		slog.Info("agent loop iteration",
			"agent", a.name,
			"iteration", i+1,
			"channel", msg.Channel,
			"chat_id", msg.ChatID,
		)

		// Hook: BeforeModelCall
		hcBefore := &HookContext{AgentName: a.name, Point: BeforeModelCall, Messages: messages, ChatID: msg.ChatID, UserID: a.ownerUserID}
		a.hooks.Run(ctx, hcBefore)

		// PII scrubbing: redact sensitive data before sending to LLM
		llmMessages := messages
		if a.piiScrubEnabled {
			llmMessages = privacy.ScrubMessages(messages)
		}

		if a.provider == nil {
			slog.Error("agent has no provider configured", "agent", a.name, "model", a.model)
			noProviderMsg := "Agent is not configured with a usable LLM provider. Check that cfg.Providers contains the prefix referenced by model `" + a.model + "`."
			emitEvent(ctx, ChatEvent{Type: "error", Data: map[string]any{"message": noProviderMsg}})
			emitEvent(ctx, ChatEvent{Type: "done"})
			return noProviderMsg
		}
		resp, err := a.provider.Chat(ctx, llmMessages, toolDefs, a.model, a.maxTokens, a.temperature, a.thinking)

		// Hook: AfterModelCall
		hcAfter := &HookContext{AgentName: a.name, Point: AfterModelCall, Messages: messages, Response: resp, Error: err, StartTime: hcBefore.StartTime, ChatID: msg.ChatID, UserID: a.ownerUserID}
		a.hooks.Run(ctx, hcAfter)

		if err != nil {
			slog.Error("LLM chat failed", "agent", a.name, "error", err)
			emitEvent(ctx, ChatEvent{Type: "error", Data: map[string]any{"message": err.Error()}})
			emitEvent(ctx, ChatEvent{Type: "done"})
			return "Sorry, I encountered an error processing your request."
		}

		if !resp.HasToolCalls() {
			sess.Append(provider.Message{Role: "assistant", Content: resp.Content, Thinking: resp.Thinking, Timestamp: time.Now().UnixMilli(), RawAssistant: resp.RawAssistant})
			emitEvent(ctx, ChatEvent{Type: "content", Data: map[string]any{"content": resp.Content}})
			emitEvent(ctx, ChatEvent{Type: "done"})
			a.runPostTurn(ctx, uc, messages, totalToolCalls)
			return resp.Content
		}

		// Emit assistant content before tool calls if present
		if resp.Content != "" {
			emitEvent(ctx, ChatEvent{Type: "content", Data: map[string]any{"content": resp.Content}})
		}

		// Emit tool_call events
		for _, tc := range resp.ToolCalls {
			emitEvent(ctx, ChatEvent{Type: "tool_call", Data: map[string]any{
				"id":        tc.ID,
				"name":      tc.Function.Name,
				"arguments": tc.Function.Arguments,
			}})
		}

		assistantMsg := provider.Message{
			Role:         "assistant",
			Content:      resp.Content,
			ToolCalls:    resp.ToolCalls,
			Thinking:     resp.Thinking,
			Timestamp:    time.Now().UnixMilli(),
			RawAssistant: resp.RawAssistant,
		}
		sess.Append(assistantMsg)
		messages = append(messages, assistantMsg)

		// Loop detection: check before executing
		loopDetected := false
		for _, tc := range resp.ToolCalls {
			sig := toolCallSig{
				name: tc.Function.Name,
				hash: sha256.Sum256([]byte(tc.Function.Arguments)),
			}
			if sig.name == lastSig.name && sig.hash == lastSig.hash {
				consecutiveCount++
			} else {
				consecutiveCount = 1
				lastSig = sig
			}
			if consecutiveCount >= 3 {
				slog.Warn("tool loop detected", "agent", a.name, "tool", tc.Function.Name)
				warnMsg := provider.Message{
					Role:    "system",
					Content: "Loop detected: you called the same tool with the same arguments 3 times. Please try a different approach.",
				}
				sess.Append(warnMsg)
				messages = append(messages, warnMsg)
				loopDetected = true
				break
			}
		}
		if loopDetected {
			break
		}

		// Fire BeforeToolCall hooks
		for _, tc := range resp.ToolCalls {
			a.hooks.Run(ctx, &HookContext{
				AgentName: a.name,
				Point:     BeforeToolCall,
				ToolName:  tc.Function.Name,
				ToolArgs:  tc.Function.Arguments,
				UserID:    a.ownerUserID,
			})
		}

		// Execute tools concurrently via SDK engine
		slog.Info("executing tools concurrently",
			"agent", a.name,
			"count", len(resp.ToolCalls),
		)
		results := a.engine.executeToolsConcurrently(ctx, a.registry, resp.ToolCalls, a.workspacePath)

		// Defensive backstop: if the SDK returned fewer results than tool
		// calls (and the bridge somehow didn't already pad — belt and
		// suspenders since orphan tool_use ids poison the next API request
		// with HTTP 400), synthesize a failure result so every tool_use
		// gets a paired tool_result in the conversation history.
		if len(results) < len(resp.ToolCalls) {
			padded := make([]toolCallResult, len(resp.ToolCalls))
			gotByID := make(map[string]toolCallResult, len(results))
			for _, r := range results {
				gotByID[r.toolCallID] = r
			}
			for i, tc := range resp.ToolCalls {
				if r, ok := gotByID[tc.ID]; ok {
					padded[i] = r
					continue
				}
				padded[i] = toolCallResult{
					toolCallID: tc.ID,
					toolName:   tc.Function.Name,
					result:     "tool execution did not return a result",
					err:        fmt.Errorf("missing executor response for %s", tc.ID),
				}
			}
			results = padded
		}

		// Process results
		for idx, r := range results {
			totalToolCalls++
			tc := resp.ToolCalls[idx]
			resultContent, meta := extractToolMeta(r.result)

			// Hook: AfterToolCall
			a.hooks.Run(ctx, &HookContext{
				AgentName:  a.name,
				Point:      AfterToolCall,
				ToolName:   r.toolName,
				ToolResult: resultContent,
				Error:      r.err,
				UserID:     a.ownerUserID,
			})

			if r.err != nil {
				slog.Warn("tool execution error",
					"agent", a.name,
					"name", r.toolName,
					"error", r.err,
				)
			}

			// Index in FTS if available
			if a.ftsStore != nil {
				_ = a.ftsStore.Index(a.name, msg.ChatID, "tool:"+r.toolName, resultContent, time.Now())
			}

			// Check for MEDIA: protocol in tool output
			if mediaPaths := extractMediaPaths(resultContent); len(mediaPaths) > 0 {
				a.sendMediaFiles(msg, mediaPaths)
			}

			toolMsg := provider.Message{
				Role:       "tool",
				Content:    resultContent,
				ToolCallID: tc.ID,
				Name:       r.toolName,
				Metadata:   meta,
			}
			sess.Append(toolMsg)
			messages = append(messages, toolMsg)

			evt := map[string]any{
				"id":     tc.ID,
				"name":   r.toolName,
				"result": resultContent,
			}
			if meta != nil {
				evt["metadata"] = meta
			}
			emitEvent(ctx, ChatEvent{Type: "tool_result", Data: evt})
		}
	}

	a.runPostTurn(ctx, uc, messages, totalToolCalls)
	slog.Warn("max tool iterations reached", "agent", a.name, "max", a.maxToolIterations)
	return "I've reached the maximum number of tool iterations. Here's what I have so far."
}

// padOrphanToolResults walks the session and appends a synthetic
// tool_result for any tool_use id from the latest assistant message that
// doesn't already have a matching tool_result. Earlier rounds aren't
// scanned — once the loop has moved past them they're already
// well-formed, otherwise the previous turn's API call would have failed.
//
// Triggered by HandleMessage's defer so a client-side Stop (or any other
// premature exit) can't leave the conversation in a state where the next
// turn's API call gets a 400 for orphan tool_use ids and the UI keeps
// spinning a "Running tools" indicator that will never resolve.
func padOrphanToolResults(sess *session.Session) {
	msgs := sess.GetMessages()
	// Walk back to the latest assistant message; if it has no tool_calls
	// or all tool_calls already have results after it, nothing to do.
	lastAssistantIdx := -1
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "assistant" && len(msgs[i].ToolCalls) > 0 {
			lastAssistantIdx = i
			break
		}
	}
	if lastAssistantIdx < 0 {
		return
	}
	resolved := make(map[string]bool)
	for _, m := range msgs[lastAssistantIdx+1:] {
		if m.Role == "tool" && m.ToolCallID != "" {
			resolved[m.ToolCallID] = true
		}
	}
	for _, tc := range msgs[lastAssistantIdx].ToolCalls {
		if resolved[tc.ID] {
			continue
		}
		slog.Warn("padding orphan tool_use with stopped result",
			"toolCallID", tc.ID, "tool", tc.Function.Name)
		sess.Append(provider.Message{
			Role:       "tool",
			ToolCallID: tc.ID,
			Name:       tc.Function.Name,
			Content:    "(stopped — execution was interrupted before the tool returned)",
		})
	}
}

// runPostTurn fires PostTurn hooks and handles auto-persist and skills learning.
// Roleplay turns pass their per-(userID, scopeKey) userContext so the turn
// counter (and AutoPersist) stay per-user (F2); nil means legacy non-roleplay
// and uses the agent-level counter, now guarded by a.turnMu (F2 P0 — the old
// unlocked increment was a data race under concurrent turns).
func (a *Agent) runPostTurn(ctx context.Context, uc *userContext, messages []provider.Message, toolCallCount int) {
	var turnCount int
	if uc != nil {
		uc.turnMu.Lock()
		uc.turnCount++
		turnCount = uc.turnCount
		uc.turnMu.Unlock()
	} else {
		a.turnMu.Lock()
		a.turnCount++
		turnCount = a.turnCount
		a.turnMu.Unlock()
	}

	// Index user/assistant messages in FTS
	if a.ftsStore != nil {
		for _, m := range messages {
			if m.Role == "user" || m.Role == "assistant" {
				_ = a.ftsStore.Index(a.name, "", m.Role, m.Content, time.Now())
			}
		}
	}

	// Fire PostTurn hooks
	a.hooks.Run(ctx, &HookContext{
		AgentName:     a.name,
		Point:         PostTurn,
		Messages:      messages,
		TurnCount:     turnCount,
		ToolCallCount: toolCallCount,
		Workspace:     a.homePath,
		UserID:        a.ownerUserID,
	})

	// Auto-persist memory every N turns (per-user counter for roleplay)
	if a.memoryCfg.AutoPersist.Enabled && turnCount%a.memoryCfg.AutoPersist.EveryNTurns == 0 {
		model := a.memoryCfg.AutoPersist.Model
		if model == "" {
			model = a.model
		}
		mem := a.memory
		if uc != nil {
			mem = uc.memory
		}
		go AutoPersistMemory(ctx, mem, a.provider, model, a.thinking, messages)
	}

	// Skills learner
	if a.skillsLearner != nil {
		go func() {
			if err := a.skillsLearner.MaybeExtract(ctx, messages, toolCallCount); err != nil {
				slog.Debug("skills learner error", "error", err)
			}
		}()
	}
}

// HandleMessageStream processes a message through the ReAct loop and returns
// a StreamReader for the final response. Tool call iterations use non-streaming Chat;
// the final text response uses ChatStream for true SSE streaming.
func (a *Agent) HandleMessageStream(ctx context.Context, msg bus.InboundMessage) *provider.StreamReader {
	// Reuse setup logic from HandleMessage
	if result := a.handleSlashCommand(msg); result.handled {
		ch := make(chan provider.StreamChunk, 2)
		go func() {
			ch <- provider.StreamChunk{Content: result.reply, Done: true}
			close(ch)
		}()
		return provider.NewStreamReader(ch)
	}

	a.refreshSkillsFromStore()
	uc := a.resolveUserContext(msg)
	var sess *session.Session
	if msg.NoPersist {
		// F10 read-only generation: a target session key only supplies
		// history for context; nothing is appended, compacted, or
		// post-processed. No key means no session at all (no orphan row).
		if msg.ChatID != "" {
			if uc != nil {
				sess = uc.sessions.Get(msg.Channel, msg.ChatID)
			} else {
				sess = a.sessions.Get(msg.Channel, msg.ChatID)
			}
		}
	} else if uc != nil {
		sess = uc.sessions.Get(msg.Channel, msg.ChatID)
	} else {
		sess = a.sessions.Get(msg.Channel, msg.ChatID)
	}
	a.bindSession(ctx, msg.ChatID)
	a.hooks.Run(ctx, &HookContext{AgentName: a.name, Point: BeforeSystemPrompt, UserID: a.ownerUserID})
	cb := a.turnContextBuilder(uc, msg)
	systemPrompt := cb.BuildSystemPrompt()
	if !a.roleplay {
		systemPrompt = selectSystemPrompt(systemPrompt, msg.SystemPromptOverride)
	}
	a.hooks.Run(ctx, &HookContext{AgentName: a.name, Point: AfterSystemPrompt, UserID: a.ownerUserID})

	// Store raw user message — same multi-image flatten as HandleMessage.
	userMsg := provider.Message{Role: "user", Content: msg.Text}
	imageURLs := msg.PhotoURLs
	if msg.PhotoURL != "" {
		imageURLs = append([]string{msg.PhotoURL}, imageURLs...)
	}
	if len(imageURLs) > 0 {
		userMsg.Content = ""
		// Skip an empty leading text part — image-only sends used to
		// produce `[{text: ""}, {image_url}, …]` which some upstreams
		// reject as a content-less wire message.
		var parts []provider.ContentPart
		if msg.Text != "" {
			parts = append(parts, provider.ContentPart{Type: "text", Text: msg.Text})
		}
		for _, u := range imageURLs {
			parts = append(parts, provider.ContentPart{
				Type: "image_url", ImageURL: &provider.ImageURL{URL: u, Detail: "auto"},
			})
		}
		userMsg.ContentParts = parts
	}
	// F9: the product clientMessageId rides in Metadata.clientMessageId
	// (persisted with the session JSON); AppendIfAbsent skips when the
	// user message is already in the session (API retry).
	if msg.MessageID != "" {
		userMsg.Metadata = map[string]any{"clientMessageId": msg.MessageID}
	}
	if !msg.NoPersist {
		if msg.MessageID != "" {
			if !sess.AppendIfAbsent(userMsg) {
				slog.Info("session dedup: user message already present", "agent", a.name, "chat", msg.ChatID, "message_id", msg.MessageID)
			}
		} else {
			sess.Append(userMsg)
		}
	}

	// F10 read-only: history is loaded for context only; compaction is
	// skipped because it rewrites the target session.
	var sessionMsgs []provider.Message
	if sess != nil {
		sessionMsgs = sess.GetMessages()
		if !msg.NoPersist {
			compactResult, err := CompactMessages(sessionMsgs, a.homePath, a.provider, a.model, a.thinking)
			if err != nil {
				slog.Warn("compaction error", "agent", a.name, "error", err)
			}
			if compactResult != nil && compactResult.Pruned {
				sess.ReplaceMessages(compactResult.Messages)
				sessionMsgs = compactResult.Messages
			}
		}
	}

	messages := a.turnMessages(systemPrompt, msg.SystemPromptOverride, sessionMsgs)
	if msg.NoPersist {
		// F10 read-only generation: the current user message joins the
		// provider context in memory only (last message). It is never
		// appended to the target session, so no session write, no
		// AutoPersist, and no turnCount.
		messages = append(messages, userMsg)
	}

	// F10 no-persist always uses the pure-text path: generation must not
	// mutate the target session through tool results.
	if a.maxToolIterations == 0 || msg.NoPersist {
		return a.stringStream(a.handleMessageWithoutTools(ctx, msg, uc, sess, msg.NoPersist, messages))
	}
	toolDefs := a.registry.Definitions()

	type toolCallSig struct {
		name string
		hash [32]byte
	}
	var lastSig toolCallSig
	consecutiveCount := 0

	// ReAct loop - use Chat for tool iterations
	for i := 0; i < a.maxToolIterations; i++ {
		hcBefore := &HookContext{AgentName: a.name, Point: BeforeModelCall, Messages: messages, ChatID: msg.ChatID, UserID: a.ownerUserID}
		a.hooks.Run(ctx, hcBefore)

		resp, err := a.provider.Chat(ctx, messages, toolDefs, a.model, a.maxTokens, a.temperature, a.thinking)

		hcAfter := &HookContext{AgentName: a.name, Point: AfterModelCall, Messages: messages, Response: resp, Error: err, StartTime: hcBefore.StartTime, ChatID: msg.ChatID, UserID: a.ownerUserID}
		a.hooks.Run(ctx, hcAfter)

		if err != nil {
			slog.Error("LLM chat failed", "agent", a.name, "error", err)
			return a.stringStream("Sorry, I encountered an error processing your request.")
		}

		if !resp.HasToolCalls() {
			sess.Append(provider.Message{Role: "assistant", Content: resp.Content, Thinking: resp.Thinking, Timestamp: time.Now().UnixMilli(), RawAssistant: resp.RawAssistant})
			return a.stringStream(resp.Content)
		}

		// Tool calls - process concurrently via SDK engine
		assistantMsg := provider.Message{
			Role:         "assistant",
			Content:      resp.Content,
			ToolCalls:    resp.ToolCalls,
			Thinking:     resp.Thinking,
			Timestamp:    time.Now().UnixMilli(),
			RawAssistant: resp.RawAssistant,
		}
		sess.Append(assistantMsg)
		messages = append(messages, assistantMsg)

		// Loop detection
		loopDetected := false
		for _, tc := range resp.ToolCalls {
			sig := toolCallSig{
				name: tc.Function.Name,
				hash: sha256.Sum256([]byte(tc.Function.Arguments)),
			}
			if sig.name == lastSig.name && sig.hash == lastSig.hash {
				consecutiveCount++
			} else {
				consecutiveCount = 1
				lastSig = sig
			}
			if consecutiveCount >= 3 {
				slog.Warn("tool loop detected", "agent", a.name, "tool", tc.Function.Name)
				warnMsg := provider.Message{
					Role:    "system",
					Content: "Loop detected: you called the same tool with the same arguments 3 times. Please try a different approach.",
				}
				sess.Append(warnMsg)
				messages = append(messages, warnMsg)
				loopDetected = true
				break
			}
		}
		if loopDetected {
			break
		}

		// Fire BeforeToolCall hooks
		for _, tc := range resp.ToolCalls {
			a.hooks.Run(ctx, &HookContext{AgentName: a.name, Point: BeforeToolCall, ToolName: tc.Function.Name, ToolArgs: tc.Function.Arguments, UserID: a.ownerUserID})
		}

		// Execute tools concurrently via SDK engine
		results := a.engine.executeToolsConcurrently(ctx, a.registry, resp.ToolCalls, a.workspacePath)

		for idx, r := range results {
			tc := resp.ToolCalls[idx]
			resultContent, meta := extractToolMeta(r.result)
			a.hooks.Run(ctx, &HookContext{AgentName: a.name, Point: AfterToolCall, ToolName: r.toolName, ToolResult: resultContent, Error: r.err, UserID: a.ownerUserID})

			if r.err != nil {
				slog.Warn("tool execution error", "agent", a.name, "name", r.toolName, "error", r.err)
			}

			if mediaPaths := extractMediaPaths(resultContent); len(mediaPaths) > 0 {
				a.sendMediaFiles(msg, mediaPaths)
			}

			toolMsg := provider.Message{Role: "tool", Content: resultContent, ToolCallID: tc.ID, Name: r.toolName, Metadata: meta}
			sess.Append(toolMsg)
			messages = append(messages, toolMsg)
		}
	}

	return a.stringStream("I've reached the maximum number of tool iterations. Here's what I have so far.")
}

// extractToolMeta strips a FC_META prefix (if present) from a tool result and
// returns the remaining content plus the parsed metadata. Today the only
// signal is whether exec ran in a sandbox. Keeping the helper shared so all
// tool-result handoff paths emit the same shape to the frontend.
func extractToolMeta(result string) (string, map[string]any) {
	if strings.HasPrefix(result, tools.MetaSandboxPrefix) {
		return strings.TrimPrefix(result, tools.MetaSandboxPrefix), map[string]any{"sandbox": true}
	}
	return result, nil
}

// stringStream creates a StreamReader that yields a single string.
func (a *Agent) stringStream(text string) *provider.StreamReader {
	ch := make(chan provider.StreamChunk, 2)
	go func() {
		ch <- provider.StreamChunk{Content: text, Done: true}
		close(ch)
	}()
	return provider.NewStreamReader(ch)
}

// HomePath returns the agent's home directory (identity/metadata).
func (a *Agent) HomePath() string {
	return a.homePath
}

// WorkspacePath returns the agent's working directory for user-facing files.
func (a *Agent) WorkspacePath() string {
	return a.workspacePath
}

// UpdateConfig updates the agent's runtime config (model, temperature, etc.)
func (a *Agent) UpdateConfig(rc config.ResolvedAgent) {
	a.model = rc.Model
	a.maxTokens = rc.MaxTokens
	a.temperature = rc.Temperature
	a.maxToolIterations = rc.MaxToolIterations
	a.SetRoleplay(rc.Roleplay)
	// Sandbox flags drive the system prompt's "Working Directory" / "home
	// dir" description and the sandbox-capabilities block. Without this
	// propagation an agent that existed before sandbox was enabled keeps
	// telling the LLM its home is the host absolute path, even after the
	// executor itself has been swapped to Docker — model dutifully calls
	// list_dir /Users/idoubi/.fastclaw/agents/<id>/agent and 404s in the
	// container.
	a.ctxBuilder.sandboxEnabled = rc.Sandbox.Enabled
	a.ctxBuilder.sandboxBackend = rc.Sandbox.Backend
}

// refreshSkillsFromStore mirrors OSS-hosted skills (global and per-agent)
// to the local filesystem and rebuilds the skills summary baked into the
// system prompt. No-op when no workspace store is configured. Called at
// the top of every turn so a skill uploaded after pod start — or on a
// sibling replica — becomes visible here on the next message instead of
// requiring a pod restart.
func (a *Agent) refreshSkillsFromStore() {
	if a.workspaceStore == nil {
		return
	}
	loader := NewSkillsLoaderWithGlobal(a.homeDir, a.homePath, "", a.skillsCfg, a.globalSkillsCfg).
		WithObjectStore(a.workspaceStore, a.agentID)
	skills := loader.LoadSkills()
	a.ctxBuilder.SetSkillsSummary(loader.BuildSkillsSummary(skills))
}

// ReloadWorkspaceFiles re-reads workspace .md files (SOUL.md, AGENTS.md, etc.)
// and rebuilds the context builder.
func (a *Agent) ReloadWorkspaceFiles() {
	if a.memoryStore != nil {
		a.memory = NewMemoryWithStoreForUser(a.homePath, a.memoryStore, a.ownerUserID, a.name)
	} else {
		a.memory = NewMemory(a.homePath)
	}
	// Rebuild skills summary. When a workspace store is configured,
	// LoadSkills first hydrates global + per-agent skill dirs from object
	// storage so skills uploaded on another replica (or post-boot on this
	// one) become visible.
	loader := NewSkillsLoaderWithGlobal(a.homeDir, a.homePath, "", a.skillsCfg, a.globalSkillsCfg)
	if a.workspaceStore != nil {
		loader.WithObjectStore(a.workspaceStore, a.agentID)
	}
	skills := loader.LoadSkills()
	skillsSummary := loader.BuildSkillsSummary(skills)
	a.ctxBuilder = NewContextBuilder(a.homePath, a.memory, skillsSummary)
	a.ctxBuilder.SetWorkspace(a.workspacePath)
	// Preserve Store-backed identity reads across reload; without this,
	// Postgres-mode pods silently fall back to pod-local filesystem.
	if a.memoryStore != nil {
		a.ctxBuilder.store = a.memoryStore
		a.ctxBuilder.agentID = a.name
		// F2: NewContextBuilder leaves userID empty; without re-setting
		// it the store reads fall back to an empty user_id and then to
		// pod-local FS, losing per-user identity/memory rows. The base
		// builder is owner-scoped; roleplay turns stamp the chatter onto
		// a per-turn shallow copy (turnContextBuilder).
		a.ctxBuilder.userID = a.ownerUserID
	}
}

// extractMediaPaths scans tool output for MEDIA: lines and returns file paths.
// The MEDIA: protocol is used by OpenClaw skills to attach files to chat messages.
func extractMediaPaths(output string) []string {
	var paths []string
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "MEDIA:") {
			path := strings.TrimSpace(strings.TrimPrefix(line, "MEDIA:"))
			if path != "" {
				if _, err := os.Stat(path); err == nil {
					paths = append(paths, path)
				}
			}
		}
	}
	return paths
}

// sendMediaFiles sends extracted MEDIA: files to the outbound bus.
func (a *Agent) sendMediaFiles(msg bus.InboundMessage, mediaPaths []string) {
	if len(mediaPaths) == 0 || a.messageBus == nil {
		return
	}
	outMsg := bus.OutboundMessage{
		Channel:    msg.Channel,
		AccountID:  msg.AccountID,
		ChatID:     msg.ChatID,
		MediaPaths: mediaPaths,
	}
	select {
	case a.messageBus.Outbound <- outMsg:
	default:
		slog.Warn("outbound channel full, dropping media message", "agent", a.name)
	}
}
