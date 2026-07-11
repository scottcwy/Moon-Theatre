# Ink-Harness Codex Personal Plugin Design

Status: frozen
Approved: 2026-07-11

## Goal

Create `Ink-Harness`, a reusable Codex Personal Plugin that turns product intent into independently mergeable, evidence-backed pull requests through a configurable multi-agent workflow.

The plugin is a workflow harness, not a project-specific documentation migration. It must be installable once, adaptable per repository, and able to preserve the state and evidence of each change without polluting long-lived product or system documentation.

## Success Criteria

- One global plugin can initialize and operate across unrelated repositories.
- Each repository declares its own document paths, commands, risk policy, safety rules, and merge policy.
- Each substantial change produces a frozen implementation design and an executable implementation plan.
- Each implementation batch is independently verifiable and mergeable.
- Independent batches may run in parallel worktrees only when their files, interfaces, state changes, and observable behavior do not conflict.
- Design, batch, and integration reviews have distinct owners and evidence requirements.
- High-risk changes require human approval; ordinary batches may auto-merge after all required gates pass.
- The plugin validates its configuration and generated artifacts before execution.

## Non-Goals

- Do not migrate or rewrite this repository's current PRD, technical spec, design document, historical specs, or historical plans.
- Do not modify the installed Superpowers skills as part of the first Ink-Harness release.
- Do not enforce a universal repository layering scheme such as `Types -> Config -> Repo -> Service -> Runtime -> UI`.
- Do not require every code change to create or rewrite a long-lived specification.
- Do not require unit, API, and end-to-end tests to be duplicated for every batch.
- Do not treat process metrics such as defect rework rate as feature acceptance criteria.
- Do not store credentials, tokens, or secrets in project configuration or run artifacts.

## Canonical Terms

**Product Specification**:
The repository's long-lived, human-readable product intent, scope, user journeys, requirements, and observable acceptance criteria.

**System Specification**:
The repository's long-lived engineering architecture, module responsibilities, public contracts, engineering policies, safety constraints, and verification rules.

**Change Packet**:
The pair of files that defines and executes one substantial change: `implement-design.md` and `implement-plan.md`.

**Implementation Design**:
The frozen description of one change's goals, non-goals, behavior, invariants, technical approach, acceptance criteria, and verification matrix.

**Implementation Plan**:
The executable decomposition of an approved Implementation Design into Mergeable Batches.

**Mergeable Batch**:
One independently verifiable pull request that can merge into the default branch without relying on a later pull request for correctness.

**Change Record**:
The durable explanation of a code change. For substantial changes this is the Change Packet; for small fixes, dependency updates, internal refactors, and documentation corrections it may be a lightweight PR Contract.

**Code Necessity Gate**:
A structural review that may classify production code as unnecessary only when it has no required behavior in the relevant Specification Record, has no valid static call path, and can be removed without changing relevant tests or acceptance results. Duplicate code additionally requires an existing canonical implementation that can replace it.

## Product Model

Ink-Harness recognizes three artifact categories.

### Product

Default entry point:

```text
docs/product/PRODUCT.md
```

`PRODUCT.md` is owned by humans. Agents may draft changes, but an agent must not independently freeze a product behavior, scope, invariant, or acceptance criterion.

It contains:

- product vision and users
- supported and excluded scope
- user journeys
- functional requirements with stable IDs
- user-visible experience principles
- observable acceptance criteria
- frozen product decisions

It does not contain code paths, class names, database fields, CSS implementation details, or execution steps.

### System

Default entry points:

```text
docs/system/SYSTEM.md
docs/system/adr/
```

`SYSTEM.md` is the engineering source of truth. It contains:

- architecture and deployment relationships
- module ownership and boundaries
- public interfaces and compatibility rules
- engineering, testing, CI, documentation, and safety policies
- structural quality gates
- risk classification and merge authority

ADRs are supporting decision records within the System category. An ADR is created only for a decision that is costly to reverse, surprising without context, and the result of a real trade-off.

### Change

Default location:

```text
docs/changes/<feature>/
|-- implement-design.md
`-- implement-plan.md
```

An Implementation Design references Product and System requirements; it does not replace either source of truth.

## Global Plugin Package

The plugin uses the normalized name `ink-harness` and the display name `Ink-Harness`.

Default personal installation layout:

```text
~/plugins/ink-harness/
|-- .codex-plugin/
|   `-- plugin.json
|-- skills/
|   `-- ink-harness/
|       |-- SKILL.md
|       |-- agents/
|       |   `-- openai.yaml
|       |-- references/
|       |   |-- lifecycle.md
|       |   |-- review-gates.md
|       |   |-- agent-contracts.md
|       |   |-- evidence-rules.md
|       |   `-- risk-policy.md
|       |-- assets/
|       |   `-- templates/
|       |       |-- product.md
|       |       |-- system.md
|       |       |-- implement-design.md
|       |       |-- implement-plan.md
|       |       `-- pr-contract.md
|       |-- schemas/
|       |   `-- project.schema.json
|       `-- scripts/
|           |-- init-project.py
|           |-- validate-config.py
|           |-- validate-design.py
|           |-- validate-plan.py
|           `-- build-review-package.py
`-- scripts/
    `-- ink-harness
```

`SKILL.md` remains a concise router. Detailed role contracts, lifecycle rules, evidence policy, and risk policy live in the referenced files and are loaded only when the active phase requires them.

The plugin is registered in the default personal marketplace at `~/.agents/plugins/marketplace.json`.

## Project Adapter

Each initialized repository contains:

```text
.spec-harness/
|-- project.yaml
|-- local.yaml
`-- runs/
```

`project.yaml` is committed to Git. `local.yaml` is ignored by Git and may contain machine-specific paths, but never secrets. In version 1, the only local override is `worktrees.directory`; commands, document paths, review owners, gates, merge policy, risk policy, and safety policy remain committed project state.

Configuration precedence is:

```text
built-in defaults
  < .spec-harness/project.yaml
  < .spec-harness/local.yaml
  < explicit run arguments
```

Higher-precedence configuration must not disable safety rules declared non-overridable by the plugin or project policy.

### Required Project Configuration

The project adapter declares:

- project identity and default branch
- Product, System, ADR, and Change paths
- Change Packet filenames
- install, test, typecheck, lint, build, and affected-test commands
- pre-merge required gates
- deep audit policy
- forbidden source and build patterns
- build output directories
- worktree and branch conventions
- maximum parallel batches
- review owners
- high-risk categories requiring human approval
- rollback policy

The validator rejects unknown keys, invalid enum values, missing required commands, invalid document paths, conflicting policies, and attempts to weaken non-overridable safety rules.

### Initialization

`Ink-Harness init` performs read-only detection first:

1. Detect repository root, default branch, languages, package manager, and existing worktree convention.
2. Detect likely test, typecheck, lint, and build commands.
3. Detect existing product, system, ADR, spec, and plan documents.
4. Detect project safety constraints from repository instructions.
5. Generate a proposed `project.yaml` and document bootstrap plan.
6. Require Tech Lead confirmation before freezing the adapter.
7. Validate the adapter before any change workflow can run.

The initializer must not rewrite existing project documents unless the user explicitly requests migration.

## Phase Router

The orchestrator classifies every invocation before acting.

Supported task types:

- `init`: create or repair a project adapter
- `design`: clarify intent and produce an Implementation Design
- `plan`: produce or revise an Implementation Plan from a frozen design
- `execute`: run approved Mergeable Batches
- `review`: run a Design, Batch, or Integration Gate
- `audit`: run structural or deep quality checks
- `resume`: recover an interrupted run from durable state

Routing output:

```json
{
  "task_type": "design",
  "project_root": "/absolute/path",
  "change_id": "payment-refund",
  "current_state": "DESIGN_DRAFT",
  "target_state": "DESIGN_FROZEN",
  "risk": ["payment"],
  "required_gates": ["design", "human-approval"]
}
```

The router must inspect repository state before asking the user for information that can be discovered locally.

## Lifecycle State Machine

```text
UNINITIALIZED
  -> PROJECT_READY
  -> DESIGN_DRAFT
  -> DESIGN_FROZEN
  -> PLAN_READY
  -> BATCHES_RUNNING
  -> BATCHES_REVIEWED
  -> INTEGRATION_VERIFIED
  -> MERGED
```

Failure and recovery states:

```text
DESIGN_BLOCKED
PLAN_BLOCKED
BATCH_BLOCKED
INTEGRATION_BLOCKED
SUPERSEDED
```

Every state transition records the prior state, next state, actor, timestamp, artifact revision, and evidence paths in `.spec-harness/runs/<feature>/progress.md`.

## Implementation Design Contract

`implement-design.md` uses only these document states:

```text
draft | frozen | superseded
```

It contains:

- Context Manifest with exact Product, System, and ADR references
- product delta and requirement IDs
- problem evidence
- goals and non-goals
- user-visible behavior
- technical design and module boundaries
- invariants, edge cases, and failure paths
- Acceptance Criteria with stable IDs
- Verification Matrix mapping criteria to test layers
- risk classification
- rollout and rollback requirements when applicable
- amendment history

Implementation Agents cannot modify a frozen design. If implementation reveals an invalid acceptance criterion, interface assumption, invariant, or codebase contradiction, the batch becomes `DESIGN_BLOCKED`.

The Tech Lead decides whether the issue is:

- an Implementation Plan correction, when observable behavior and frozen constraints remain unchanged; or
- an Implementation Design Amendment, when behavior, invariants, or acceptance criteria change.

An amendment increments the design revision and re-enters the Design Gate.

## Implementation Plan Contract

`implement-plan.md` uses these delivery states:

```text
planned | in_progress | blocked | verified | merged
```

The plan records the exact frozen design revision it implements.

Each Mergeable Batch includes:

- Batch ID and goal
- referenced Acceptance Criteria IDs
- exact files and ownership boundaries
- consumed and produced interfaces
- dependencies on other batches
- TDD steps where behavior changes
- exact verification commands and expected results
- Verification Matrix decisions and skip reasons
- documentation impact
- risk classification and approval requirements
- rollback method
- PR and CI evidence fields

One Mergeable Batch maps to one pull request. Commits inside the pull request must be semantically coherent and revertible, but do not need to be independently production-ready.

## Parallel Batch Rules

Parallel worktree execution is allowed only when every pair of concurrent batches satisfies all of the following:

- no logical dependency
- no modification of the same file
- no modification of the same public interface
- no dependency on an unmerged schema or configuration change
- independent Acceptance Criteria and verification
- merge order does not change observable behavior

The Tech Lead records the dependency graph before dispatch. Unproven independence means sequential execution.

Implementation and Batch Review may run in parallel. Rebase, final CI, Integration Gate, and merge are serialized by the Tech Lead.

## Agent Roles

### Spec Review Agent

Owns the Design Gate. It checks completeness, ambiguity, contradictions, scope, invariants, risk classification, and testability. It does not review code style or approve implementation quality.

### Implementation Agent

Owns one worktree and one Mergeable Batch. It follows the frozen design and plan, uses TDD where applicable, runs required verification, commits only its batch scope, and cannot approve its own pull request.

### Code Review Agent

Owns the Batch Gate. It checks Acceptance Criteria coverage, implementation correctness, Verification Matrix evidence, maintainability, unnecessary code, documentation impact, and scope control. It cannot redefine the frozen design.

### Tech Lead Agent

Owns decomposition, dependency classification, conflict adjudication, Integration Gate, merge order, and final merge authority. It may approve and auto-merge ordinary batches after required checks pass.

High-risk changes require human approval even when all automated gates pass.

## Review Gates

### Design Gate

Required before an Implementation Design becomes `frozen`.

Evidence:

- Context Manifest resolves to existing sources
- goals and non-goals are explicit
- Acceptance Criteria are observable
- failure and edge paths are covered
- Verification Matrix is justified
- no contradictions remain
- required human product approval is recorded

### Batch Gate

Required before a pull request becomes eligible for integration.

Evidence:

- diff is limited to the batch scope
- referenced Acceptance Criteria are satisfied
- required tests and quality checks passed with fresh output
- skipped test layers have explicit reasons
- Code Necessity Gate has no unresolved finding
- documentation impact is handled according to project policy
- no implementation agent self-approval

### Integration Gate

Required immediately before merge.

Evidence:

- branch is rebased or otherwise current with the target branch
- required Pre-Merge Gate checks passed on the current head
- merge order remains valid
- cross-batch contracts are consistent
- high-risk approval is present when required
- rollback requirements are satisfied

## Verification Policy

Every Mergeable Batch includes a risk-driven Verification Matrix.

- Unit tests cover pure functions, state transitions, and isolated business behavior.
- API or integration tests cover public contracts, persistence, module boundaries, and external adapters.
- End-to-end tests cover critical user journeys and runtime integration that lower layers cannot prove.
- Structural Quality Gates run for every pull request, but expensive analyses may run in the Deep Quality Audit.

Not every batch must add every test layer. When an applicable layer is skipped, the plan and pull request must state why.

### Pre-Merge Gate

Target completion time: less than 10 minutes.

Required checks are project-configurable and may include:

- affected tests
- typecheck
- lint
- API contract tests
- critical end-to-end tests
- build
- structural checks
- forbidden source and build pattern scans

The time target must be achieved through parallel CI jobs and affected-scope selection, not by silently omitting required coverage.

### Deep Quality Audit

Runs on a project-defined schedule and is required before release.

It may include:

- complete end-to-end suite
- mutation testing for high-risk modules
- repository-wide dead code and duplicate analysis
- long-running stability tests
- broad Code Necessity review

## Code Necessity Gate

Code is not classified as unnecessary merely because deletion leaves the current tests green.

Removal requires all applicable evidence:

1. No Product, System, Change Design, or PR Contract behavior requires the code.
2. Static analysis finds no valid call path or supported external entry point.
3. Relevant tests and acceptance evidence remain unchanged after deletion.
4. For duplicate implementations, an existing canonical implementation replaces the removed path.

Uncertain findings are reported for review; they do not authorize automatic deletion.

## Merge Authority And Risk

Ordinary batches may auto-merge after the Integration Gate passes.

Human approval is required for:

- database migration
- payment behavior
- security policy or authentication
- production configuration
- breaking public API changes
- irreversible data writes

Project configuration may add high-risk categories but cannot remove the built-in minimum categories without editing and revalidating the plugin policy itself.

## Rollback Policy

Pure code changes default to a revert pull request.

Explicit compatibility windows, rollback steps, and data recovery are required for:

- database migrations
- configuration protocols
- payment behavior
- external interface changes
- irreversible data writes

## Safety Policy

The project adapter may define forbidden patterns for both source and build outputs. These checks are blocking Pre-Merge Gate requirements.

For this repository, `api.example.com` must never enter miniapp source or build artifacts. Ink-Harness must not run a miniapp build until configuration inspection proves that the forbidden host cannot be emitted, and it must scan build output after any permitted build.

Secrets never appear in generated configuration, prompts, reports, progress ledgers, or review packages.

## Durable Run State

Each active change uses:

```text
.spec-harness/runs/<feature>/
|-- routing.json
|-- batch-graph.json
|-- progress.md
|-- evidence/
`-- reviews/
```

Run state is operational evidence, not a long-lived product or system specification. The project decides which run artifacts are committed. At minimum, pull request links and final verification results are copied into `implement-plan.md` before the plan becomes `merged`.

Resume logic trusts repository state, commits, pull requests, and the durable progress ledger over conversation memory.

## Lightweight PR Contract

Small bug fixes, dependency updates, internal refactors, and documentation corrections do not require a Change Packet unless they alter product behavior, public interfaces, data models, architecture boundaries, critical workflows, error contracts, or external behavior.

They require a durable PR Contract containing:

- Why
- What
- Files and boundaries
- Tests and verification
- documentation impact
- risk and rollback

## Behavioral Contract For Skill Testing

### Trigger

The skill activates when the user asks to initialize, design, plan, execute, review, audit, resume, or enforce a spec-driven multi-agent development workflow using Ink-Harness.

### Required Behavior

- classify the current lifecycle phase before acting
- inspect the repository before asking discoverable questions
- refuse implementation without a frozen Implementation Design and valid Implementation Plan for substantial changes
- use a lightweight PR Contract for eligible small changes
- prevent parallel dispatch when batch independence is unproven
- keep design, batch, and integration approvals separate
- require fresh verification evidence before completion or merge claims
- require human approval for high-risk categories
- preserve durable run state for resume

### Forbidden Behavior

- silently change frozen product behavior or Acceptance Criteria
- let an Implementation Agent approve its own work
- treat passing tests alone as proof that code is unnecessary
- weaken non-overridable safety policy through local configuration
- expose secrets in artifacts
- claim success from agent reports without independent evidence
- rewrite existing project documentation during initialization without explicit authorization

### Completion Evidence

- valid plugin manifest
- valid personal marketplace entry
- skill structural validation passes
- project configuration schema and validator pass positive and negative fixtures
- artifact validators pass valid fixtures and reject invalid state transitions or missing evidence
- behavioral forward tests cover init, design, plan, parallel execution refusal, high-risk approval, resume, and review separation

## Acceptance Criteria

### AC-01: Plugin Packaging

`ink-harness` has a valid `.codex-plugin/plugin.json`, a personal marketplace entry, and a discoverable `ink-harness` skill with valid UI metadata.

### AC-02: Project Initialization

Given an uninitialized repository, Ink-Harness detects project facts, proposes a project adapter, avoids rewriting existing documentation, and produces a configuration that passes schema validation after Tech Lead confirmation.

### AC-03: Phase Routing

Given repository and run state, Ink-Harness selects exactly one supported task type and records the transition in durable run state.

### AC-04: Change Artifacts

A substantial change produces `implement-design.md` and `implement-plan.md` with distinct state fields, revision linkage, stable Acceptance Criteria IDs, and a justified Verification Matrix.

### AC-05: Batch Independence

Ink-Harness permits parallel execution only when all configured independence predicates pass; otherwise it produces a sequential dependency graph and explains the blocking predicate.

### AC-06: Review Separation

Design, Batch, and Integration Gates use distinct role contracts and reject self-approval or role attempts to redefine another gate's authority.

### AC-07: Evidence And Safety

Completion and merge decisions require fresh command evidence, required forbidden-pattern scans, and no unresolved blocking review finding.

### AC-08: High-Risk Approval

High-risk changes cannot auto-merge without recorded human approval.

### AC-09: Resume

After interruption, Ink-Harness resumes from durable repository and run state without re-running completed batches or trusting stale conversation memory.

### AC-10: Validation

Plugin, skill, configuration, artifact, and behavioral validation complete successfully, while negative fixtures demonstrate rejection of unsafe configuration, invalid state transitions, missing approvals, and unjustified parallel execution.

## Amendment A-01: Evidence And Local Override Hardening

Approved during implementation review on 2026-07-11.

- A frozen Design does not unlock planning until a current-head `gate_passed` Design package is validated and the Design transition is recorded.
- Review packages use only committed `.spec-harness/project.yaml` and committed Change Packet artifacts; lifecycle validation rebuilds the package and compares all hashes and policy-derived fields.
- Resume accepts completed Batch commits only when they are ancestors of current HEAD and their recorded evidence hashes remain valid.
- Plan file paths are normalized before overlap checks, Plan and Design `change_id` values must match, and missing independence proof is unsafe.
- Initialization stages atomic writes and can repair missing document roots from an existing valid adapter.
- Version 1 local configuration is limited to `worktrees.directory` so uncommitted machine settings cannot replace required commands or policy.
- Risk categories are derived from committed Design frontmatter; caller input cannot remove them.
- Gate transitions persist artifact hashes and are revalidated against current Design state, so amendments require a new Design Gate.
- Resumable Batch completion uses hashed `batch-complete` JSON records backed by a Batch Gate package; legacy free-form completion lines are not trusted.
- Every Batch declares at least one normalized project-relative file path; an empty file set is not independence proof.
- Batch Gate packages bind one Plan-declared Batch ID, and snapshot validation reconstructs configuration and Change Packet artifacts from the package commit before accepting historical evidence.

## Delivery Boundary

The first release delivers the personal plugin, marketplace registration, templates, schema, deterministic validators, reference contracts, and behavioral forward-test evidence.

Adapting or replacing installed Superpowers workflows is explicitly deferred. Ink-Harness may reference compatible concepts, but its first release must remain independently understandable and testable.
