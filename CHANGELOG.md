# Changelog

All notable changes to the Bee-Logical Claude SDLC marketplace.

## [0.7.4] — 2026-07-09

### Fixed

- **Duplicate hooks-file load error (`sdlc` → 0.7.3).** Current Claude Code auto-loads a plugin's
  standard `hooks/hooks.json`, so the manifest must not also point at it. Removed
  `"hooks": "./hooks/hooks.json"` from `plugins/sdlc-core/.claude-plugin/plugin.json`; the hooks
  still load automatically from the standard path. Fixes: *"Failed to load hooks … Duplicate hooks
  file detected … manifest.hooks should only reference additional hook files."*

## [0.7.3] — 2026-07-09

### Added — user-controlled verification cadence (`sdlc` → 0.7.2)

- New `pipeline.verification` config block puts the review/QA cost — the pipeline's biggest
  recurring spend — in the user's hands:
  - `mode`: `auto` (SDLC runs reviewer + QA, current behavior), `manual` (SDLC skips the agents and
    opens the PR for the human to review; run ends at a new `review-pending` phase; issues fed back
    by rerunning `/sdlc:run <ID>`), or `ask` (pipeline prompts per item).
  - `scope`: `per-item` (verify every item, default) or `per-epic` (children skip per-item review;
    one consolidated pass when the epic's children are all implemented).
  - `reviewer` / `qa` / `security` toggles for fine control (e.g. keep the fast code review, drop
    the heavier QA test-authoring).
- `/sdlc:init` now asks for the verification cadence up front.
- Safety preserved: in every mode the implementer still runs lint + tests to green before a PR, and
  the human merge of the PR remains the final gate — `manual` just skips the *extra* bot pre-review
  (and flags the PR as un-reviewed by bots). `security: off` on a risky diff leaves a visible note.
- Default is unchanged (`auto` / `per-item`) so existing projects behave exactly as before until
  they opt into a cheaper cadence.
- Docs: user guide §3b (cadence table + manual feedback loop), example walkthrough (init option),
  architecture (extension point).

## [0.7.2] — 2026-07-09

### Changed

- **`sdlc-ux` enabled by default.** The design pod now ships `defaultEnabled: true` in the
  marketplace — no manual install/enable step. It stays dormant on backend/infra items, so
  non-UI projects are unaffected; turn it off per project with `ux.enabled: false`.
- **Hardened UI detection in the orchestrator (`sdlc` → 0.7.1).** The decision to invoke the
  design pod moved from a soft path-glob check during implement to an explicit determination at
  the **classify** step, recorded as `ui:` on the run file. Signals: a `ui`/`ux`/`design`/`frontend`
  label, OR the title/description/AC mentioning a screen/page/component/layout/visual/motion/
  redesign, OR a frontend stack with an item that clearly renders something. When unsure on a
  frontend item it defaults `ui: true` (an over-invoked jury is cheap; a missed one ships un-judged
  UI). The auto-invocation now also passes the resolved **scope, mode and brand** through, so the
  autopilot behaves the same as running `/sdlc-ux:design` by hand. Run-file template gains
  `ui` / `uxScope` / `uxMode`.
- Docs updated: user guide (§3a design-pod section + cheat-sheet + troubleshooting), example
  walkthrough (§6a/§6b showing the pod on the todo UI + a brand-anchored redesign), adoption guide
  and architecture.

## [0.7.1] — 2026-07-09

### Added — `sdlc-ux` plugin (v0.2.0): existing projects, scope targeting & brand references

- **Works on existing projects, not just greenfield.** `/sdlc-ux:design` now resolves a **scope**
  (a page/route/screen, a path/glob, or the whole app) and a **mode**:
  - `greenfield` — establish the design system; it becomes the project standard every later UI item
    adopts (implemented and followed throughout).
  - `retrofit` — redesign a specific page/screen while **adopting the project's established system**
    first, so the target stays uniform with the rest of the app.
  - `redesign` — whole-app redesign that may replace and re-propagate the system.
- **UI audit step** for existing surfaces: renders the current UI (Playwright) + sibling screens,
  and `sdlc-design-system` (new **audit mode**) extracts the current design language, flags
  inconsistencies, and recommends conform / elevate-in-place / replace → `design/audit.md`.
- **Brand references** (new + existing): pass a logo, colors, fonts, or reference screenshots (in
  `$ARGUMENTS`, in `ux.brand.referenceDir` = `design/brand/`, or via the `ux.brand` config). They're
  treated as **hard constraints** — the design-system extracts a palette from the logo, matches
  fonts (best-effort, flags ambiguous screenshot matches for confirmation), and honors supplied
  values exactly. Catalogued in `design/brand.md`.
- Jury now scores **cross-page consistency + brand adherence** on scoped redesigns (target must not
  be a lone island in a different style), using sibling-page shots.
- New `ux.brand` config block; new `audit.md` and `brand.md` templates.

## [0.7.0] — 2026-07-09

### Added — `sdlc-ux` plugin (new, opt-in): the UI/UX design pod

- A five-role pod for award-tier, uniform desktop-web UI:
  - `sdlc-ux-writer` (sonnet) — writes `design/narrative.md`: the experience story (vision, tone,
    journey, one signature moment) that every downstream decision must trace back to.
  - `sdlc-ux-researcher` (sonnet) — mines Awwwards/FWA and current best-in-class work (WebSearch/
    WebFetch) for cited, transferable techniques → `design/inspiration.md`.
  - `sdlc-design-system` (sonnet) — the **uniformity anchor**: color/type/spacing/radius/elevation
    tokens emitted to code as the single source of truth, WCAG-AA contrast verified.
  - `sdlc-motion` (sonnet) — animation, micro-interactions, scroll/parallax, GSAP, sequencing —
    within a 60fps + `prefers-reduced-motion` budget; realizes the signature moment.
  - `sdlc-ux-jury` (opus) — strict, **unbiased** Awwwards-style judge. Renders the built UI with
    Playwright, screenshots it, scores a weighted rubric /10 with mandatory visual evidence, blind
    to the makers' reasoning. A 9 is rare and must be earned.
- `/sdlc-ux:design <item|path|description>` — the pod pipeline: narrative → research → design system
  → build + motion → **jury loop until composite ≥ `ux.juryThreshold` (default 9)**, capped at
  `ux.maxJuryRounds` (default 3). At the cap it ships the best-scoring round, attaches the jury's
  remaining critique, and flags for human — never loops forever, never escalates models.
- Skills: `design` (orchestration), `ux-narrative`, `design-research`, `design-system`, `motion`,
  `design-jury` (rubric + anti-bias + render protocol). Templates for all five `design/*` artifacts.

### Changed — `sdlc` plugin

- Orchestrator (`/sdlc:run`): UI-touching items now route the frontend through `sdlc-ux:design`
  (jury gate included) when `sdlc-ux` is installed and `ux.enabled` — no hard dependency; core still
  runs standalone.
- Project `sdlc.config.json` gains a `ux` block (`enabled`, `target: desktop-web`, `juryThreshold`,
  `maxJuryRounds`, `juryPanelSize`, `renderBaseUrl`, `uiPaths`).

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
