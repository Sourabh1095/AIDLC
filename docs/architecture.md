# Architecture — Bee-Logical Claude SDLC

**Status:** All phases (0–5) implemented · core v0.7.x · `sdlc-ux` design pod v0.2.x

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

### Agents (9)

| Agent | Role | Isolation reason | Model tier |
|-------|------|------------------|-----------|
| `sdlc-analyst` | AC validation/refinement, sizing, epic decomposition, assumption logging | own judgment loop over item + codebase | sonnet |
| `sdlc-architect` | explores codebase, plans items ≥ threshold, writes ADRs | large exploration context, deep judgment | opus |
| `sdlc-implementer` | code per plan, conventional commits, fix cycles | large working context | sonnet |
| `sdlc-reviewer` | adversarial diff review vs AC/standards (read-only tools) | must not share implementer context | sonnet |
| `sdlc-qa` | run suite, author missing tests, failing-repro-first for bugs | independent evidence gathering | sonnet |
| `sdlc-security` | input→sink tracing, authz, dependency audit (conditional trigger) | adversarial depth, read-only surface | opus |
| `sdlc-devops` | docker/CI/release items, red-check diagnosis | different tool domain | sonnet |
| `sdlc-docwriter` | README/CHANGELOG/API docs on the PR branch | mechanical, cheap | haiku |
| `sdlc-researcher` | spikes → cited decision reports | web-heavy exploration context | sonnet |

### Skills

Commands: `run`, `next`, `status`, `init`, `groom`, `release`. Infrastructure: `run-state`,
`work-items`, `wi-markdown`, `wi-jira`, `wi-ado`, `git-workflow`. Playbooks: `requirements`,
`planning`, `architecture`, `code-review`, `testing`, `debugging`, `security`, `ci-cd`,
`docs-writing`, `research`, `maintenance`. Stack pack (`sdlc-stack-web` plugin):
`coding-standards-ts`, `nextjs`, `nestjs`, `postgres`, `mongodb`, `db-migrations`, `docker`,
`api-design`. (`x-sdlc`-templated scaffolds ship in `templates/`.)

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

### Phase 4 — Depth agents + stack pack ✅ (v0.4.0)

Implemented: the five depth agents (`sdlc-architect` opus + ADRs, `sdlc-security` opus with
conditional trigger, `sdlc-devops` incl. red-check diagnosis, `sdlc-docwriter` haiku,
`sdlc-researcher`), the seven phase skills (`architecture`, `security`, `ci-cd`, `release`,
`docs-writing`, `research`, `maintenance`) + ADR template, orchestrator wiring (security in
the verify batch, spikes → researcher, infra plans → devops), and the `sdlc-stack-web` plugin
(8 stack skills). Separate plugin so other stacks (e.g. `sdlc-stack-python`) can slot in
without touching core — stack skills are namespaced `sdlc-stack-web:*`.

### Phase 5 — Self-extension & scale ✅ (v0.5.0)

Implemented: capability-gap protocol in the orchestrator (search plugins → local →
`extensions.json` registry; create as last resort; skill by default, agents behind the
agent-test justification); `scaffold-skill`/`scaffold-agent` with mandatory `x-sdlc` metadata
and reuse tracking (`/sdlc:status` surfaces candidates at reuseCount ≥ 2); `/sdlc:promote`
(validate → secret-scan → generalize with shown diff → package into the right plugin on
`promote/<name>` → user-confirmed PR with the reviewer checklist); `/sdlc:sync` (deletes local
forks shadowed by promoted versions, resolves shadowing conflicts); `/sdlc:sprint N` (analyst
independence check → worktree + headless run per item → live board from run-file polling →
cleanup); governance via `docs/promotion-policy.md` + CODEOWNERS (`plugins/**` platform-owned).

### Design pod ✅ (`sdlc-ux` plugin, v0.1–0.2)

A separate, default-enabled plugin for award-grade UI. Five roles: `sdlc-ux-writer` (narrative),
`sdlc-ux-researcher` (cited Awwwards inspiration), `sdlc-design-system` (the tokenized uniformity
anchor — also audits existing UIs and honors brand anchors), `sdlc-motion` (animation within a
perf+a11y budget), and `sdlc-ux-jury` (opus; renders via Playwright and scores a weighted rubric
/10, blind to the makers). `/sdlc-ux:design` runs narrative → research → design system →
build/redesign + motion → a jury loop that iterates until composite ≥ `ux.juryThreshold` (default 9),
capped at `ux.maxJuryRounds`. Works greenfield (establish the project standard), retrofit (adopt the
existing system, redesign a scoped surface) and full redesign; brand references (logo/colors/fonts)
are hard constraints. **Design decision:** the jury is the only opus tier and is deliberately blind
to reasoning to keep scoring unbiased; the loop is capped (never model-escalates) to respect cost.
The core orchestrator detects UI items at classify (`ui:` flag) and routes them here when the plugin
is present and `ux.enabled` — no hard dependency, so core still runs standalone.

## 3. Post-v1 candidates (not committed)

- Additional stack packs (`sdlc-stack-python`, `sdlc-stack-dotnet`) as demand appears.
- More adapters via the same 7-op contract (Linear, GitHub Issues).
- Sentry-fed bug intake: production error → draft bug item with stack trace context.
- Metrics: cycle-time and fix-cycle stats aggregated from archived run files.

## 4. Extension points (for adopting teams)

- **New tracker** → write a `wi-*` skill implementing the 7-operation contract; add a `source` value.
- **New stack** → new `sdlc-stack-*` plugin; core degrades gracefully without one.
- **Different autonomy** → per-project `settings.json` + `pipeline.gates`; the pipeline reads, never hardcodes.
- **Project-specific expertise** → `.claude/skills/` landing zone, `x-sdlc` metadata, promotion path when it proves reusable.
