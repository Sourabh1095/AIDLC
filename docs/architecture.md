# Architecture — Bee-Logical Claude SDLC

**Status:** Phases 0–3 implemented (v0.3.0) · Phases 4–5 designed, pending

## 1. Core design decisions

**D1 — The orchestrator is a main-thread skill, not a subagent.** Subagents cannot spawn other
subagents; only the main session owns the user interaction, permission prompts and the Agent
tool. `/sdlc:run` therefore loads a state machine + router into the main session, which
dispatches specialist subagents per phase. The orchestrator holds routing logic only; durable
state lives in run files.

**D2 — Run files are the single source of truth.** `.sdlc/runs/<ID>.md` records phase, plan,
assumptions, findings and log. It survives compaction (PreCompact hook forces a flush),
session restarts (SessionStart hook re-injects a snapshot), and crashes (`/sdlc:run` resumes
from the recorded phase). It's committed to the feature branch, so every PR carries its own
audit trail. Tracker comments are the *external* progress signal; the run file is the
*internal* machine state; the run file wins on conflict.

**D3 — Agents only where isolation pays.** An agent needs its own context window (big
exploration/diffs), a different tool surface, or independent adversarial judgment (the
reviewer must not share the implementer's reasoning). Everything else — docker knowledge,
Postgres patterns, commit conventions, adapter mechanics — is a skill loaded on demand by
whoever needs it. This is why there is no "postgres agent" and no "bug-fix agent".

**D4 — One schema, pluggable trackers.** The pipeline speaks the canonical WorkItem schema
through a 7-operation adapter contract (`fetch, query, create, transition, comment, link,
updateAC`). Jira/ADO/markdown are adapter skills selected by `.claude/sdlc.config.json`.
Adding a tracker = one new `wi-*` skill, zero orchestrator changes.

**D5 — Flat token cost.** Always-loaded context is capped (~120 lines: project CLAUDE.md +
two rules files). The framework's bulk (playbooks, stack expertise, adapters) costs zero
tokens until a task triggers it.

**D6 — High autonomy, hard guardrails.** Allow the full story→PR path; deny irreversible /
production / secret / self-modification operations; ask on ambiguous blast radius. Two layers:
static permission rules + context-aware hooks (branch-aware push guard, exfil patterns,
protected paths). Humans keep exactly one mandatory gate: PR review + merge.

## 2. Implemented (Phases 0–2)

### Pipeline

```
/sdlc:run ID → fetch (adapter) → classify by type
  story: requirements → plan → implement → verify → PR → docs → done
  bug:   requirements(light) → failing repro test → fix → verify → PR
  task:  plan → implement → verify → PR
  epic:  analyst decomposes into child stories, stops
verify = reviewer ∥ qa (parallel) → fix cycles (max pipeline.maxFixCycles) → BLOCKED if exhausted
```

### Agents (4)

| Agent | Role | Isolation reason |
|-------|------|------------------|
| `sdlc-analyst` | AC validation/refinement, sizing, epic decomposition, assumption logging | own judgment loop over item + codebase |
| `sdlc-implementer` | code per plan, conventional commits, fix cycles | large working context |
| `sdlc-reviewer` | adversarial diff review vs AC/standards (read-only tools) | must not share implementer context |
| `sdlc-qa` | run suite, author missing tests, failing-repro-first for bugs | independent evidence gathering |

### Skills (14)

Commands: `run`, `next`, `status`, `init`. Infrastructure: `run-state`, `work-items`,
`wi-markdown`, `git-workflow`. Playbooks: `requirements`, `planning`, `code-review`,
`testing`, `debugging`. (`x-sdlc`-templated scaffolds ship in `templates/`.)

### Hooks (Node, cross-platform)

`guard.mjs` (PreToolUse Bash) · `protect-paths.mjs` (PreToolUse Edit/Write) · `format.mjs`
(PostToolUse) · `session-context.mjs` (SessionStart) · `checkpoint.mjs` (PreCompact + Stop).

### Phase 3 — Real trackers + Azure ✅ (v0.3.0)

Implemented: `wi-jira` (Atlassian MCP; JQL; transition-by-target-status; statusMap),
`wi-ado` (ADO MCP + `az boards` fallback; WIQL; Agile/Scrum process detection; state-stepping
with tag fallbacks), Azure Repos PR path in `git-workflow`, `/sdlc:groom` (autonomy
boundaries: AC/sizing applied, decompositions/priorities proposed only), bundled `atlassian` +
`azure-devops` MCP servers, project `.mcp.json.example` (read-only Postgres/MongoDB, Sentry,
Notion, Figma). Adapter contract unchanged — the pipeline runs identically over all three sources.

## 3. Roadmap

### Phase 4 — Depth agents + stack pack
- Agents: `sdlc-architect` (opus-class; plans items ≥ `architectThreshold`, writes ADRs),
  `sdlc-security` (opus-class; triggered by `securityReviewPaths` overlap or dependency
  changes), `sdlc-devops` (docker/CI/release), `sdlc-docwriter` (haiku-class),
  `sdlc-researcher` (spikes, cited decision reports).
- New plugin `sdlc-stack-web`: `coding-standards-ts`, `nextjs`, `nestjs`, `postgres`,
  `mongodb`, `db-migrations` (expand-contract, rollback safety), `docker`, `api-design`.
  Separate plugin so other stacks (e.g. `sdlc-stack-python`) can slot in without touching core.
- Skills: `architecture` (ADR triggers/format), `security` (OWASP diff pass, dependency
  audit), `ci-cd`, `release`, `docs-writing`, `research`, `maintenance`.
- **Exit criterion:** full-SDLC pipeline over a reference Next.js/NestJS/PG/Mongo project.

### Phase 5 — Self-extension & scale
- **Capability-gap protocol** in the orchestrator: search plugin skills → local `.claude/` →
  `extensions.json` registry; create only as last resort; skill by default (agents require an
  `agentJustification`).
- `scaffold-skill` / `scaffold-agent`: instantiate the templates (with `x-sdlc` metadata:
  origin, createdDuring, promotion status, reuseCount), register in `.sdlc/extensions.json`.
  The orchestrator bumps `reuseCount` on each reuse; `/sdlc:status` surfaces candidates with
  reuseCount ≥ 2.
- `/sdlc:promote <name>`: validate (no secrets/absolute paths) → generalize (project specifics
  → config placeholders) → clone marketplace repo, branch `promote/<name>`, copy into the
  right plugin, bump version, CHANGELOG → PR with origin metadata and reviewer checklist.
  Platform team owns merges (CODEOWNERS on `plugins/**`).
- `/sdlc:sync`: post-merge, detect local skills shadowed by newer plugin versions, delete the
  local copy, mark registry entry `promoted` — prevents silent drift between local forks and
  the promoted version.
- `/sdlc:sprint N`: adapter returns top-N ready items → analyst checks independence
  (file-overlap heuristic, shared parents) → one git worktree + headless run per item
  (`claude -p "/sdlc:run <ID>"`), parent session aggregates run-file phases into a board;
  colliding items serialize.
- **Exit criteria:** two stories land as parallel PRs; a project-born skill round-trips
  through promotion into the plugin.

## 4. Extension points (for adopting teams)

- **New tracker** → write a `wi-*` skill implementing the 7-operation contract; add a `source` value.
- **New stack** → new `sdlc-stack-*` plugin; core degrades gracefully without one.
- **Different autonomy** → per-project `settings.json` + `pipeline.gates`; the pipeline reads, never hardcodes.
- **Project-specific expertise** → `.claude/skills/` landing zone, `x-sdlc` metadata, promotion path when it proves reusable.
