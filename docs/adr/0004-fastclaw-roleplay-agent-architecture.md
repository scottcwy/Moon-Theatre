# FastClaw roleplay agent architecture (one agent per character)

Status: accepted

Records the architecture decisions of `docs/specs/2026-08-14-fastclaw-roleplay-agent-architecture-spec.md` (revision 4, frozen), which supersede the rationale of `docs/adr/0001-api-owned-chat-context-and-client-message-id.md`:

- One roleplay agent per character: 19 FastClaw agents are provisioned script-wise (one stable slug per character) and role-play the character while holding memory; the API keeps the business shell (WeChat login, wallet/billing, moderation, idempotency, message persistence, bond, return messages).
- Memory and session ownership moves to FastClaw: FastClaw `agent_files` becomes the single source of truth for memory (per-user multi-tenant isolation + scope-split files); FastClaw sessions hold the generation context (history + compaction); the API `memories` table is retired (existing rows are not migrated).
- F8 append: return messages are appended into the target free-mode session via `POST /v1/sessions/{key}/messages` (idempotent, write-only; no generation, no AutoPersist, no points, no bond).
- F10 no-persist: return-message generation sends `x-fastclaw-no-persist: true` (no append, no AutoPersist, no turnCount, target session read-only).
- Script-wise provisioning of 19 agents: `character_prompts` remains the editing source; a script renders SOUL.md / IDENTITY.md / USER.md and idempotently syncs FastClaw owner rows (no FastClaw UI).
- Rollback order: apps/api first (`USE_ROLEPLAY_AGENTS=false` one-key fallback), then FastClaw image/config; `/api/ready`'s 19-agent check is the rollback-window sentinel.
