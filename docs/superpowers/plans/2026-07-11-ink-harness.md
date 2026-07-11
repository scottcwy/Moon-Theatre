# Ink-Harness Personal Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use isolated evaluator agents only for the behavioral RED/GREEN tests in Task 7.

**Goal:** Build, validate, register, and install the `Ink-Harness` Codex Personal Plugin described by the frozen design.

**Architecture:** Scaffold a marketplace-backed personal plugin at `/Users/macbookpro/plugins/ink-harness`. Keep the main skill as a lifecycle router, move detailed workflow contracts into references, use deterministic Python validators and templates for project artifacts, and use isolated behavioral evaluations to prove the skill enforces its gates.

**Tech Stack:** Codex Personal Plugins, Codex skills, Markdown, JSON Schema, Python 3 with `unittest` and PyYAML, personal marketplace JSON, Codex CLI.

## Global Constraints

- Implement frozen design revision: `docs/superpowers/specs/2026-07-11-ink-harness-design.md`, approved 2026-07-11.
- Plugin normalized name is `ink-harness`; display name is `Ink-Harness`.
- Plugin source lives at `/Users/macbookpro/plugins/ink-harness`.
- Personal marketplace lives at `/Users/macbookpro/.agents/plugins/marketplace.json`.
- Do not modify installed Superpowers skills.
- Do not migrate this repository's existing product, system, spec, or plan documents.
- Do not put secrets in configuration, fixtures, prompts, logs, or reports.
- Project safety rules are non-overridable by local configuration or run arguments.
- Use TDD for deterministic scripts: failing test, observed failure, minimal implementation, passing test.
- Use isolated no-guidance and with-skill evaluators for behavior-shaping rules.
- Do not claim completion without fresh plugin, skill, test, marketplace, and install verification.

---

## File Map

### Plugin metadata

- `/Users/macbookpro/plugins/ink-harness/.codex-plugin/plugin.json`
  - Plugin identity, version, skill discovery path, and UI metadata.
- `/Users/macbookpro/.agents/plugins/marketplace.json`
  - Default personal marketplace entry for `ink-harness`.

### Skill router and contracts

- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/SKILL.md`
  - Phase classification, lifecycle routing, required references, hard gates, and completion contract.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/agents/openai.yaml`
  - Skill display name, short description, and default prompt.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/references/lifecycle.md`
  - States, transitions, failure recovery, design amendment, and resume rules.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/references/review-gates.md`
  - Design, Batch, and Integration Gate evidence contracts.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/references/agent-contracts.md`
  - Spec Review, Implementation, Code Review, and Tech Lead responsibilities.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/references/evidence-rules.md`
  - Verification Matrix, Pre-Merge Gate, Deep Quality Audit, and fresh-evidence requirements.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/references/risk-policy.md`
  - Risk classification, human approval, rollback, safety, and Code Necessity Gate.

### Templates and schema

- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/assets/templates/product.md`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/assets/templates/system.md`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/assets/templates/implement-design.md`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/assets/templates/implement-plan.md`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/assets/templates/pr-contract.md`
  - Valid initial artifact shapes with no placeholder tokens.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/schemas/project.schema.json`
  - Machine-readable project adapter contract.

### Deterministic scripts

- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/scripts/common.py`
  - YAML loading, path handling, shared validation helpers, and structured errors.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/scripts/validate_config.py`
  - Project adapter validation.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/scripts/init_project.py`
  - Read-only detection, bootstrap proposal, confirmed project initialization, and safe template copying.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/scripts/validate_design.py`
  - Implementation Design structure and state validation.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/scripts/validate_plan.py`
  - Implementation Plan structure, revision linkage, Batch mapping, and parallel independence validation.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/scripts/route_phase.py`
  - Deterministic current-state inspection and phase routing.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/scripts/build_review_package.py`
  - Compile scoped evidence paths and metadata for a review gate.

### Tests

- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests/test_config.py`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests/test_init_project.py`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests/test_artifacts.py`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests/test_router.py`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests/test_review_package.py`
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests/fixtures/`
  - Positive and negative deterministic fixtures.
- `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests/behavior/`
  - Raw evaluator prompts, no-guidance outputs, with-skill outputs, and comparison notes.

---

### Task 1: Scaffold The Personal Plugin And Marketplace

**Files:**
- Create: `/Users/macbookpro/plugins/ink-harness/.codex-plugin/plugin.json`
- Create: `/Users/macbookpro/plugins/ink-harness/skills/`
- Create/update: `/Users/macbookpro/.agents/plugins/marketplace.json`
- Create: `/Users/macbookpro/plugins/ink-harness/skills/ink-harness/**`

**Interfaces:**
- Produces a valid plugin root and initialized skill directory for later tasks.

- [ ] **Step 1: Scaffold the plugin and personal marketplace**

Run:

```bash
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py \
  ink-harness \
  --with-skills \
  --with-marketplace \
  --category Productivity
```

Expected: `/Users/macbookpro/plugins/ink-harness` and `/Users/macbookpro/.agents/plugins/marketplace.json` are created with normalized name `ink-harness`.

- [ ] **Step 2: Initialize the skill package**

Run:

```bash
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/skill-creator/scripts/init_skill.py \
  ink-harness \
  --path /Users/macbookpro/plugins/ink-harness/skills \
  --resources scripts,references,assets \
  --interface display_name=Ink-Harness \
  --interface short_description='Spec-driven multi-agent engineering harness' \
  --interface default_prompt='Use Ink-Harness to design, plan, execute, and review this change.'
```

Expected: the skill contains `SKILL.md`, `agents/openai.yaml`, and selected resource directories.

- [ ] **Step 3: Initialize a dedicated Git repository**

Run:

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness init -b main
```

Expected: the plugin source is versioned independently on branch `main`.

- [ ] **Step 4: Replace scaffold metadata with release metadata**

Set `.codex-plugin/plugin.json` to:

```json
{
  "name": "ink-harness",
  "version": "0.1.0",
  "description": "A reusable spec-driven multi-agent engineering harness for Codex.",
  "author": {
    "name": "Personal"
  },
  "license": "UNLICENSED",
  "keywords": ["spec", "workflow", "review", "multi-agent"],
  "skills": "./skills/",
  "interface": {
    "displayName": "Ink-Harness",
    "shortDescription": "Spec-driven multi-agent engineering harness",
    "longDescription": "Turn product intent into frozen implementation designs, mergeable batches, evidence-backed reviews, and controlled merges.",
    "developerName": "Personal",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "defaultPrompt": [
      "Initialize Ink-Harness for this repository.",
      "Design and plan this change with Ink-Harness.",
      "Resume the current Ink-Harness change."
    ]
  }
}
```

- [ ] **Step 5: Validate and commit the scaffold**

Run:

```bash
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/macbookpro/plugins/ink-harness
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add .
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'chore: scaffold Ink-Harness plugin'
```

Expected: plugin validation passes and the first plugin commit contains only scaffold and metadata files.

---

### Task 2: Project Adapter Schema And Configuration Validator

**Files:**
- Create: `skills/ink-harness/schemas/project.schema.json`
- Create: `skills/ink-harness/scripts/common.py`
- Create: `skills/ink-harness/scripts/validate_config.py`
- Create: `skills/ink-harness/tests/test_config.py`
- Create: `skills/ink-harness/tests/fixtures/config-valid.yaml`
- Create: negative config fixtures

**Interfaces:**
- Produces `load_yaml(path)`, `validate_project_config(data, project_root)`, and CLI exit codes `0` valid / `1` invalid.

- [ ] **Step 1: Write failing configuration tests**

Create one test for each observable result:

- a complete fixture returns no errors
- an unknown top-level key returns `unknown_key: unsupported field`
- a missing `commands.test` value returns `commands.test: required`
- an unsupported merge policy returns `merge.normal_batch: expected auto or manual`
- a local override that removes a forbidden pattern is rejected
- any nested key named like a credential is rejected
- a configured document whose parent directory is missing is rejected

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
rtk proxy python3 -m unittest discover -s /Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests -p 'test_config.py' -v
```

Expected: FAIL because configuration modules do not exist.

- [ ] **Step 3: Implement schema and minimal validator**

The validator must:

- use `yaml.safe_load`
- reject non-mapping roots
- reject unknown keys at every validated level
- require document paths, commands, pre-merge policy, safety, batch, review, merge, and rollback sections
- reject keys matching `token`, `secret`, `password`, `api_key`, or `private_key`, case-insensitively
- require built-in human-approval categories
- prevent local overrides from removing forbidden patterns or human-approval categories
- resolve configured relative paths beneath the project root
- emit errors as `path.to.field: message`

- [ ] **Step 4: Run configuration tests and verify GREEN**

Run the Step 2 command.

Expected: all configuration tests pass.

- [ ] **Step 5: Commit**

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add skills/ink-harness/schemas skills/ink-harness/scripts skills/ink-harness/tests
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'feat: validate Ink-Harness project adapters'
```

---

### Task 3: Templates And Project Initializer

**Files:**
- Create: five files under `skills/ink-harness/assets/templates/`
- Create: `skills/ink-harness/scripts/init_project.py`
- Create: `skills/ink-harness/tests/test_init_project.py`

**Interfaces:**
- Produces `detect_project(root)`, `build_config_proposal(root)`, and `initialize_project(root, confirmed=False)`.

- [ ] **Step 1: Write failing initializer tests**

Create one test for each observable result:

- detection leaves a temporary repository byte-for-byte unchanged
- a `pnpm-workspace.yaml` repository proposes pnpm commands
- initialization without `confirmed=True` raises `ConfirmationRequired`
- confirmed initialization creates `.spec-harness/project.yaml` and missing document roots
- an existing `PRODUCT.md` remains byte-for-byte unchanged
- `.spec-harness/local.yaml` is added to `.gitignore` exactly once

- [ ] **Step 2: Run initializer tests and verify RED**

Run:

```bash
rtk proxy python3 -m unittest discover -s /Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests -p 'test_init_project.py' -v
```

Expected: FAIL because initializer and templates do not exist.

- [ ] **Step 3: Create non-placeholder templates**

Templates must contain required headings, valid initial states, explanatory comments, and example IDs that are explicitly marked as examples rather than unfinished placeholders.

The Implementation Design template starts at `status: draft`. The Implementation Plan template starts at `status: planned` and requires `design_revision`.

- [ ] **Step 4: Implement read-only detection and confirmed initialization**

CLI contract:

```bash
python3 init_project.py --project-root /path --detect
python3 init_project.py --project-root /path --proposal
python3 init_project.py --project-root /path --confirm
```

`--detect` and `--proposal` never write. `--confirm` writes only missing files and refuses conflicting existing paths.

- [ ] **Step 5: Run initializer tests and verify GREEN**

Run the Step 2 command.

Expected: all initializer tests pass.

- [ ] **Step 6: Commit**

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add skills/ink-harness/assets skills/ink-harness/scripts/init_project.py skills/ink-harness/tests/test_init_project.py
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'feat: initialize Ink-Harness projects safely'
```

---

### Task 4: Change Artifact Validators And Phase Router

**Files:**
- Create: `skills/ink-harness/scripts/validate_design.py`
- Create: `skills/ink-harness/scripts/validate_plan.py`
- Create: `skills/ink-harness/scripts/route_phase.py`
- Create: `skills/ink-harness/tests/test_artifacts.py`
- Create: `skills/ink-harness/tests/test_router.py`
- Create: artifact fixtures

**Interfaces:**
- Produces `validate_design(path)`, `validate_plan(path, design_path)`, `batches_are_parallel_safe(batches)`, and `route_phase(project_root, change_id)`.

- [ ] **Step 1: Write failing artifact and router tests**

Create one test for each observable result:

- Design accepts only `draft`, `frozen`, and `superseded`
- a frozen Design without revision and approval metadata is rejected
- Plan `design_revision` must equal the frozen Design revision
- every Batch Acceptance Criteria ID must exist in the Design
- parallel Batches sharing a file are rejected
- parallel Batches sharing a public interface are rejected
- parallel Batches sharing an unmerged schema dependency are rejected
- order-dependent parallel Batches are rejected
- an unconfigured repository routes to `init`
- a frozen Design without a Plan routes to `plan`
- a progress ledger with completed work routes to `resume` without replaying completed Batches

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
rtk proxy python3 -m unittest discover -s /Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests -p 'test_artifacts.py' -v
rtk proxy python3 -m unittest discover -s /Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests -p 'test_router.py' -v
```

Expected: FAIL because validators and router do not exist.

- [ ] **Step 3: Implement minimal artifact parsing and validation**

Use YAML frontmatter plus required Markdown headings. Reject placeholder markers, invalid states, missing AC IDs, missing Verification Matrix mappings, missing revision linkage, and unsafe parallel declarations.

- [ ] **Step 4: Implement deterministic phase routing**

Routing output is JSON and includes `task_type`, `project_root`, `change_id`, `current_state`, `target_state`, `risk`, and `required_gates`.

- [ ] **Step 5: Run tests and verify GREEN**

Run both Step 2 commands.

Expected: all artifact and router tests pass.

- [ ] **Step 6: Commit**

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add skills/ink-harness/scripts skills/ink-harness/tests
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'feat: validate and route Ink-Harness changes'
```

---

### Task 5: Review Package Builder

**Files:**
- Create: `skills/ink-harness/scripts/build_review_package.py`
- Create: `skills/ink-harness/tests/test_review_package.py`

**Interfaces:**
- Produces a gate-specific JSON review package containing immutable artifact paths, revisions, evidence paths, actor separation, risk, and unresolved findings.

- [ ] **Step 1: Write failing review package tests**

Create one test for each observable result:

- Design package rejects missing product approval
- Batch package rejects identical implementer and reviewer identities
- Integration package rejects evidence recorded for an older commit
- payment risk rejects missing human approval
- required forbidden-pattern scan cannot be omitted

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
rtk proxy python3 -m unittest discover -s /Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests -p 'test_review_package.py' -v
```

Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement minimal review package validation and output**

The CLI accepts `--gate design|batch|integration`, input artifact paths, actor identities, current commit, evidence paths, risk flags, and approval paths. It refuses incomplete or conflicting evidence.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command.

Expected: all review package tests pass.

- [ ] **Step 5: Commit**

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add skills/ink-harness/scripts/build_review_package.py skills/ink-harness/tests/test_review_package.py
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'feat: build Ink-Harness review evidence'
```

---

### Task 6: Write The Orchestrator Skill And Reference Contracts

**Files:**
- Modify: `skills/ink-harness/SKILL.md`
- Modify: `skills/ink-harness/agents/openai.yaml`
- Create: five reference files

**Interfaces:**
- Produces the behavior-shaping workflow loaded by Codex.

- [ ] **Step 1: Write references from the frozen design**

Rules:

- `lifecycle.md` owns state entry, exit, failure, amendment, and resume contracts.
- `review-gates.md` owns Design, Batch, and Integration evidence.
- `agent-contracts.md` owns role responsibilities, non-responsibilities, and escalation.
- `evidence-rules.md` owns Verification Matrix and fresh command evidence.
- `risk-policy.md` owns approval, rollback, safety, and Code Necessity rules.

- [ ] **Step 2: Replace scaffold SKILL.md with a concise router**

The frontmatter description must trigger on initialization, spec-driven design, implementation planning, multi-agent batches, worktree orchestration, review gates, audit, and resume requests.

The body must:

- run Phase 0 classification before action
- inspect repository state before questions
- load only references needed by the routed phase
- enforce frozen design before substantial implementation
- select PR Contract for eligible small changes
- refuse unsafe parallel batches
- keep role approvals separate
- require high-risk human approval
- preserve run state
- require fresh verification before completion

- [ ] **Step 3: Regenerate UI metadata**

Run:

```bash
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py \
  /Users/macbookpro/plugins/ink-harness/skills/ink-harness \
  --interface display_name=Ink-Harness \
  --interface short_description='Spec-driven multi-agent engineering harness' \
  --interface default_prompt='Use Ink-Harness to design, plan, execute, and review this change.'
```

- [ ] **Step 4: Run structural skill validation**

```bash
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/macbookpro/plugins/ink-harness/skills/ink-harness
```

Expected: skill validation passes with no unfinished placeholders or invalid frontmatter.

- [ ] **Step 5: Commit**

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add skills/ink-harness
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'feat: orchestrate the Ink-Harness lifecycle'
```

---

### Task 7: Behavioral RED-GREEN Forward Tests

**Files:**
- Create: `skills/ink-harness/tests/behavior/*.md`
- Modify: skill or references only when evaluation exposes a real failure

**Interfaces:**
- Produces raw behavioral evidence that the skill changes decisions for the intended reason.

- [ ] **Step 1: Create isolated scenarios**

Scenarios:

1. Time pressure asks an agent to implement a substantial feature without a frozen design.
2. Two batches look independent but modify the same public interface.
3. An implementation agent attempts to approve its own batch.
4. A payment change has green tests but no human approval.
5. A deletion leaves tests green but has no static call-path evidence.
6. A resumed run has stale conversation context but a completed progress ledger entry.

- [ ] **Step 2: Run no-guidance controls and preserve raw outputs**

Dispatch fresh evaluators without Ink-Harness guidance. At least one control must demonstrate the target failure; otherwise do not add guidance for that scenario.

- [ ] **Step 3: Run the same scenarios with Ink-Harness**

Dispatch fresh evaluators with only the skill path and realistic task. Do not include expected answers or prior failure analysis.

- [ ] **Step 4: Compare observable decisions**

Required GREEN outcomes:

- implementation is refused until Design Gate
- conflicting batches are serialized
- self-approval is rejected
- payment merge waits for human approval
- deletion is not authorized from tests alone
- completed batches are not re-dispatched on resume

- [ ] **Step 5: Refine minimally and re-run affected scenarios**

Capture rationalizations verbatim. Change only the rule that failed, then re-run the same scenario and a nearby counter-example.

- [ ] **Step 6: Commit behavioral evidence and refinements**

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add skills/ink-harness
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'test: verify Ink-Harness behavior gates'
```

---

### Task 8: Final Validation, Cachebuster, And Installation

**Files:**
- Review all plugin files
- Update plugin version with cachebuster through the plugin-creator helper

**Interfaces:**
- Produces an installed personal plugin visible to Codex.

- [ ] **Step 1: Run the complete deterministic suite**

```bash
rtk proxy python3 -m unittest discover -s /Users/macbookpro/plugins/ink-harness/skills/ink-harness/tests -p 'test_*.py' -v
```

Expected: all tests pass with zero failures and zero errors.

- [ ] **Step 2: Validate skill and plugin structure**

```bash
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/macbookpro/plugins/ink-harness/skills/ink-harness
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/macbookpro/plugins/ink-harness
```

Expected: both validators pass.

- [ ] **Step 3: Validate marketplace content**

Check that the personal marketplace contains one `ink-harness` entry with local path `./plugins/ink-harness`, `AVAILABLE`, `ON_INSTALL`, and category `Productivity`.

- [ ] **Step 4: Add a Codex cachebuster**

```bash
rtk proxy python3 /Users/macbookpro/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py /Users/macbookpro/plugins/ink-harness
```

Expected: version becomes `0.1.0+codex.<generated-cachebuster>` without changing the base version.

- [ ] **Step 5: Commit the final release state**

```bash
rtk proxy git -C /Users/macbookpro/plugins/ink-harness add .
rtk proxy git -C /Users/macbookpro/plugins/ink-harness commit -m 'chore: prepare Ink-Harness 0.1.0'
```

- [ ] **Step 6: Install from the personal marketplace**

```bash
MARKETPLACE_NAME=$(rtk proxy python3 /Users/macbookpro/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py)
rtk proxy codex plugin add "ink-harness@${MARKETPLACE_NAME}"
rtk proxy codex plugin list
```

Expected: Codex lists `ink-harness` as installed from the personal marketplace.

- [ ] **Step 7: Final scope and safety review**

Verify:

- no installed Superpowers file changed
- no existing project documentation migrated
- no secret-shaped fixture values exist
- plugin Git status is clean
- current project worktree contains only the approved design/plan commits plus pre-existing user files

---

## Spec Coverage

- AC-01: Tasks 1, 6, and 8.
- AC-02: Tasks 2 and 3.
- AC-03: Task 4.
- AC-04: Tasks 3 and 4.
- AC-05: Task 4 and behavioral scenario 2.
- AC-06: Tasks 5, 6, and behavioral scenario 3.
- AC-07: Tasks 2, 5, 6, and 8.
- AC-08: Tasks 5, 6, and behavioral scenario 4.
- AC-09: Task 4 and behavioral scenario 6.
- AC-10: Tasks 2 through 8.
