# Bee-Logical Claude AIDLC

A reusable **AIDLC (AI Development Life Cycle)** base for every Bee-Logical project, built entirely on
Claude Code primitives: **agents, skills, rules, hooks, permissions, settings, and MCP servers**.

One orchestrator (`/aidlc:run`) takes any work item — epic, story, task, bug or spike — from
**Jira, Azure DevOps, or a local markdown backlog** and drives it end-to-end:

```
fetch item → validate requirements → plan → implement → review + QA (parallel)
→ fix cycles → push branch → open PR → update the tracker
```

One workspace can hold **one repo or many** (e.g. `backend/`, `frontend/`, `website/`, `mobile/`):
the orchestrator routes each item to the repo it belongs in, and a cross-repo feature becomes an
epic whose child stories each ship as their own repo → branch → PR. Mono is the default and
unchanged — existing projects need zero migration.

Humans stay in the loop where it matters: **reviewing and merging PRs** — or, for a project with no
remote yet (`git.mode: local`), **approving the local merge** the pipeline proposes after verify.

## Repository layout

| Path | What it is |
|------|-----------|
| `.claude-plugin/marketplace.json` | The company plugin marketplace manifest |
| `plugins/aidlc-core/` | The `aidlc` plugin: orchestrator, 9 agents, skills, hooks, MCP config |
| `plugins/aidlc-stack-web/` | Stack pack: TS standards, Next.js, NestJS, Postgres, MongoDB, migrations, Docker, API design |
| `plugins/aidlc-core/templates/project/` | The project template scaffolded by `/aidlc:init` |
| `docs/` | Adoption guide, architecture, permissions rationale |

## Install (per developer)

```
/plugin marketplace add <OWNER>/AIDLC     # or a local path / Azure Repos URL
/plugin install aidlc@bee-logical
/plugin install aidlc-stack-web@bee-logical          # Next.js/NestJS/PG/Mongo expertise (optional per stack)
```

For local development of this repo: `claude --plugin-dir D:\AIDLC\plugins\aidlc-core`

## Adopt in a project

1. Open Claude Code in the project repo.
2. Run `/aidlc:init` — answers a short Q&A and scaffolds `CLAUDE.md`, `.claude/` config,
   permissions, rules, `backlog/`, and `.aidlc/` run-state folders.
3. Create work items (markdown backlog, or point config at Jira/ADO).
4. Run `/aidlc:next` — the pipeline takes it from there.

See `docs/adoption-guide.md` for the full walkthrough, including MCP authentication.
**New to the framework?** Start with `docs/example-walkthrough.md` — empty folder → typed
requirement → working full-stack app, every command included.

## Commands

| Command | Purpose |
|---------|---------|
| `/aidlc:init` | Scaffold the AIDLC template into a project |
| `/aidlc:intake <text>` | Turn a plain-language requirement into backlog items (deduped against existing ones) |
| `/aidlc:run <ID \| text>` | Run one work item end-to-end (resumable); free text = intake + run |
| `/aidlc:next` | Pick the highest-priority ready item and run it |
| `/aidlc:status` | Dashboard: active runs + backlog snapshot |
| `/aidlc:groom` | Backlog refinement: fix AC, size, flag blockers, propose splits |
| `/aidlc:release` | Cut a release: semver from commits, changelog, tag, notes (publish is approval-gated) |
| `/aidlc:sprint N` | Run N independent items in parallel worktrees with a live board |
| `/aidlc:repo add <name>` | Declare + bootstrap a repo in a poly workspace (config entry + `git init` + base commit) |
| `/aidlc:promote` | PR a proven project-local skill/agent into the shared plugin |
| `/aidlc:sync` | Reconcile local extensions after plugin updates (kill drift) |

## Design principles

- **Orchestrator is a skill, not an agent** — the main session routes; specialist subagents do the work.
- **Run files** (`.aidlc/runs/<ID>.md`) are durable, resumable pipeline state, committed to the branch.
- **Adapter contract** — the pipeline speaks one WorkItem schema; Jira/ADO/markdown are pluggable adapters.
- **Skills over agents** — expertise (docker, postgres, standards…) is procedural knowledge loaded on demand.
- **High autonomy, hard guardrails** — everything on the story→PR path is allowed; destructive or
  production-touching operations are denied or gated (see `docs/permissions-rationale.md`).

## Self-extension

When the pipeline hits a capability gap it can't cover, it scaffolds a project-local skill (or
agent, behind a justification bar) in `.claude/`, tracks its reuse in `.aidlc/extensions.json`,
and — once proven — `/aidlc:promote` PRs it into this repo for platform-team review
(`docs/promotion-policy.md`). `/aidlc:sync` closes the loop after merge. The framework grows
itself, curated.

## Status

All five design phases are implemented, plus **polyrepo (multi-repo) support** (`aidlc` v0.8.0):
core pipeline + quality gates, Jira/ADO/markdown trackers, GitHub + Azure Repos, mono **and**
multi-repo workspaces, 9 specialist agents, the web stack pack, the `aidlc-ux` design pod, parallel
sprints and the self-extension/promotion workflow. Full design: `docs/architecture.md`.
