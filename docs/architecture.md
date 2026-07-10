# Architecture — Bee-Logical Claude SDLC

**Status:** All phases (0–5) implemented + polyrepo · core v0.8.x · `sdlc-ux` design pod v0.2.x

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
protected paths). Humans keep exactly one mandatory gate: PR review + merge. When a repo has no
remote (`git.mode: local`, per-repo) there is no PR — the gate is *relocated, not removed*: the
pipeline integrates via a **user-confirmed local `--no-ff` merge** into the default branch after
green verify, and never merges unattended. Default is `remote` (push + PR), so nothing changes for
projects with an origin.

**D7 — Parallelize independent work; serialize anything that mutates a shared tree.** The rule
is *isolation, not just similarity* — two units run concurrently only when they cannot collide on
files or on each other's outputs. This applies at three levels:

- **Item level (`/sdlc:sprint`).** Independent backlog items each get their own **git worktree** and
  a headless `claude -p "/sdlc:run <ID>"` background process, aggregated into one board. An
  `sdlc-analyst` **independence check** (file/subsystem overlap, cross-referencing AC, parent-epic
  ordering — the same detection `sdlc:planning` uses) selects a conflict-free set; conflicting items
  queue behind their counterpart. Worktrees are what make this safe: separate working trees mean no
  mid-flight collisions on the index or files.
- **Phase level (`/sdlc:run` §verify).** The reviewer, QA and (conditional) security agents are
  dispatched in **one parallel batch** — they only read the diff, so there's nothing to collide on.
  Fix cycles that follow are serial (one implementer mutates the branch).
- **Design pod (`sdlc-ux:design`).** The jury panel (`ux.juryPanelSize` jurors) and the
  design-system / motion / implementer fix agents each run as a batch when their work is independent.

The deliberate **non-parallel** point is IMPLEMENT inside a single run: one `sdlc-implementer` works
the plan sequentially on one branch. Splitting mutating work across agents on the same working tree
invites merge conflicts and interleaved half-states; cross-item concurrency is delivered by worktree
isolation in `sprint` instead. As `sprint` puts it: *parallelism multiplies mistakes too* — so the
default is serial, and concurrency is opt-in exactly where isolation removes the risk.

**D8 — One workspace, one or many repos; everything resolves to a repo entry.** A project is either
**mono** (one git repo for everything — the default, unchanged) or **poly** (a workspace holding
several git repos, e.g. `backend/`, `frontend/`, `website/`, `mobile/`, each with its own remote).
The design that keeps both on one code path with zero migration:

- **The config always yields a list of repo entries.** `repos[]` in `.claude/sdlc.config.json` defines
  them in poly; in mono the resolver **synthesizes a single entry** from the legacy top-level
  `git`/`stack`/`ux` blocks. Mono is just a one-entry registry, so every downstream consumer
  (orchestrator, `git-workflow`, `status`, `sprint`, `release`) is written once against repo entries.
  (Resolver spec: `sdlc:work-items` → *Repos & routing*.)
- **The control plane is the workspace root.** `.claude/`, the shared `backlog/` and `.sdlc/` live at
  the top; the product repos are subfolders under `workspace.root`. One backlog and one board span all
  repos — the home for cross-repo features.
- **The orchestrator owns routing.** The user states a requirement in plain language; the orchestrator
  grounds it against the actual repos (their `role`/`stack`/`labels`) and routes each item to exactly one
  repo (explicit `repo` → label → default → ground → ask). Users never hand-tag repos.
- **Invariant: 1 run = 1 item = 1 repo = 1 branch = 1 PR.** A cross-repo feature is an **epic** whose
  child stories each target one repo, ordered by `dependsOn`; the epic is the coordination unit (a
  control-plane coordination file rolls up the children). Each PR stays small and independently
  reviewable, a failure in one repo never poisons another, and every child run is atomic and resumable.
  Per-item run files live in their repo (committed to its branch, so the PR keeps its audit trail);
  `status` aggregates run files from the control plane and every repo.
- **What stays per-repo:** branch/commit/push/PR (each repo's own `host`/`remote`/`defaultBranch`), the
  design pod (each frontend repo's `renderBaseUrl`), and releases (each repo versions/tags on its own
  cadence; a coordinated release iterates repos in `dependsOn` order).

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
- **Verification cost/cadence** → `pipeline.verification` (`mode`: auto/manual/ask, `scope`:
  per-item/per-epic, plus `reviewer`/`qa`/`security` toggles); the human review of the PR is always
  the final gate, so `manual` degrades safely rather than skipping oversight.
- **Project-specific expertise** → `.claude/skills/` landing zone, `x-sdlc` metadata, promotion path when it proves reusable.
