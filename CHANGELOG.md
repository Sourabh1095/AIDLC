# Changelog

All notable changes to the Bee-Logical Claude SDLC marketplace.

## [0.6.1] — 2026-07-09

### Fixed

- **Agent model identifiers**: all agents pinned invalid model ids (`claude-sonnet`,
  `claude-opus`, `claude-haiku`) which Claude Code could not resolve — subagents died with an
  API error and the orchestrator fell back to the session's (larger) model. Corrected to the
  valid tier aliases (`sonnet` / `opus` / `haiku`), so each agent runs on its intended tier.
- Orchestrator invariant added: a subagent model/API failure must be reported, never worked
  around by escalating to a larger model.

## [0.6.0] — 2026-07-09

### Added — `sdlc` plugin (requirement intake)

- `/sdlc:intake <text>`: the pipeline's front door for requirements that exist only in the
  user's head — analyst grounds the requirement in the codebase, sweeps the existing backlog
  (skip covered / delta-only for partial overlap / flag in-flight conflicts), proposes the
  item set (epic+stories or single story/bug/task) with AC, creates on approval in the active
  tracker (Jira/ADO/markdown).
- `/sdlc:run <free text>`: non-ID arguments route through intake, then the pipeline runs the
  first created item — "describe it and it gets built".
- Analyst agent: intake mode (propose-only; the orchestrator creates after approval).

## [0.5.0] — 2026-07-08

### Added — `sdlc` plugin (Phase 5: self-extension & scale)

- `scaffold-skill` / `scaffold-agent`: create project-local capabilities from the templates,
  with mandatory `x-sdlc` metadata and the agent-test justification; registered in
  `.sdlc/extensions.json` with reuse tracking.
- Capability-gap protocol in the orchestrator: search plugins → local → registry before
  creating; reuseCount bumped on every reuse; `/sdlc:status` surfaces promotion candidates.
- `/sdlc:promote`: validate (secret scan, lint) → generalize (project specifics → config
  references, with a shown diff) → package into the right plugin on a `promote/<name>` branch
  → PR with the reviewer checklist. PR opening is user-confirmed.
- `/sdlc:sync`: post-merge reconciliation — deletes local forks shadowed by promoted plugin
  versions, resolves shadowing conflicts, reports promotion-ready candidates.
- `/sdlc:sprint N`: parallel independent items — analyst independence check, one git worktree
  + headless pipeline run per item, live board from run-file polling, queued conflicts,
  worktree cleanup on completion.
- Governance: `docs/promotion-policy.md` (acceptance bar + reviewer checklist), CODEOWNERS
  making `plugins/**` platform-team owned.

## [0.4.0] — 2026-07-08

### Added — `sdlc` plugin (Phase 4: depth agents)

- `sdlc-architect` (opus): explores the codebase, plans items ≥ `architectThreshold`, writes ADRs.
- `sdlc-security` (opus): deep security pass — input→sink tracing, authz, dependency audit —
  auto-triggered by `securityReviewPaths` overlap, manifest changes, or `security` label.
- `sdlc-devops`: docker/CI/release items and red-PR-check diagnosis.
- `sdlc-docwriter` (haiku): docs phase; amends the PR with `docs(...)` commits.
- `sdlc-researcher`: spike items → cited decision reports in `docs/research/`.
- Skills: `architecture` (ADR discipline), `security`, `ci-cd`, `release` (`/sdlc:release`),
  `docs-writing`, `research`, `maintenance`; ADR template.
- Orchestrator wiring: security agent joins the verify batch conditionally; spikes route to the
  researcher; infra-only plans route to devops; red CI checks get a diagnosis pass.

### Added — `sdlc-stack-web` plugin (new)

- Stack expertise skills: `coding-standards-ts`, `nextjs` (App Router), `nestjs`, `postgres`,
  `mongodb`, `db-migrations` (expand-contract), `docker`, `api-design`.

## [0.3.0] — 2026-07-08

### Added — `sdlc` plugin (Phase 3: real trackers + Azure)

- `wi-jira` adapter: Jira via Atlassian MCP — JQL queries, transition-by-target-status,
  AC field/section detection, dev-panel linking, per-project `statusMap`.
- `wi-ado` adapter: Azure Boards via ADO MCP with `az boards` CLI fallback — WIQL queries,
  Agile/Scrum process detection, state-stepping with tag fallbacks, HTML field mapping.
- Azure Repos PR path in `git-workflow` (`az repos pr create` + work-item linking).
- `/sdlc:groom` — analyst-driven backlog refinement with autonomy boundaries
  (AC/sizing applied; decompositions and priority changes proposed only).
- Bundled MCP: `atlassian` (remote, OAuth) and `azure-devops` servers.
- Project template: `.mcp.json.example` with optional read-only Postgres/MongoDB, Sentry,
  Notion, Figma servers.

## [0.2.0] — 2026-07-08

### Added — `sdlc` plugin (Phases 0–2)

- Marketplace + plugin manifests; installable via `/plugin marketplace add`.
- Project template (`templates/project/`) scaffolded by `/sdlc:init`: CLAUDE.md, permissions
  posture, `sdlc.config.json` switchboard, always-on rules, markdown backlog spec, run-state folders.
- Orchestrator pipeline `/sdlc:run`: fetch → classify → requirements → plan → implement →
  verify (review + QA parallel, fix cycles) → PR → wrap; resumable via run files.
- `/sdlc:next`, `/sdlc:status` commands.
- Work-item adapter layer: canonical WorkItem schema + 7-operation contract; `wi-markdown` adapter.
- Agents: `sdlc-analyst`, `sdlc-implementer`, `sdlc-reviewer`, `sdlc-qa`.
- Phase skills: requirements, planning, git-workflow, code-review, testing, debugging, run-state.
- Hooks (Node, cross-platform): bash guard, protected paths, format-on-save, session context
  snapshot, run-state checkpoint/notify.
- Bundled MCP config: context7, github, playwright (auth per user).
- Docs: adoption guide, architecture (incl. phases 3–5 roadmap), permissions rationale.
