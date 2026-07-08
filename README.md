# Bee-Logical Claude SDLC

A reusable, AI-driven SDLC base for every Bee-Logical project, built entirely on Claude Code
primitives: **agents, skills, rules, hooks, permissions, settings, and MCP servers**.

One orchestrator (`/sdlc:run`) takes any work item — epic, story, task, bug or spike — from
**Jira, Azure DevOps, or a local markdown backlog** and drives it end-to-end:

```
fetch item → validate requirements → plan → implement → review + QA (parallel)
→ fix cycles → push branch → open PR → update the tracker
```

Humans stay in the loop where it matters: **reviewing and merging PRs**.

## Repository layout

| Path | What it is |
|------|-----------|
| `.claude-plugin/marketplace.json` | The company plugin marketplace manifest |
| `plugins/sdlc-core/` | The `sdlc` plugin: orchestrator, agents, skills, hooks, MCP config |
| `plugins/sdlc-core/templates/project/` | The project template scaffolded by `/sdlc:init` |
| `docs/` | Adoption guide, architecture, permissions rationale |

## Install (per developer)

```
/plugin marketplace add bee-logical/claude-sdlc     # or a local path / Azure Repos URL
/plugin install sdlc@bee-logical
```

For local development of this repo: `claude --plugin-dir D:\SDLC\plugins\sdlc-core`

## Adopt in a project

1. Open Claude Code in the project repo.
2. Run `/sdlc:init` — answers a short Q&A and scaffolds `CLAUDE.md`, `.claude/` config,
   permissions, rules, `backlog/`, and `.sdlc/` run-state folders.
3. Create work items (markdown backlog, or point config at Jira/ADO).
4. Run `/sdlc:next` — the pipeline takes it from there.

See `docs/adoption-guide.md` for the full walkthrough, including MCP authentication.

## Commands

| Command | Purpose |
|---------|---------|
| `/sdlc:init` | Scaffold the SDLC template into a project |
| `/sdlc:run <ID>` | Run one work item end-to-end (resumable) |
| `/sdlc:next` | Pick the highest-priority ready item and run it |
| `/sdlc:status` | Dashboard: active runs + backlog snapshot |
| `/sdlc:groom` | Backlog refinement: fix AC, size, flag blockers, propose splits |

## Design principles

- **Orchestrator is a skill, not an agent** — the main session routes; specialist subagents do the work.
- **Run files** (`.sdlc/runs/<ID>.md`) are durable, resumable pipeline state, committed to the branch.
- **Adapter contract** — the pipeline speaks one WorkItem schema; Jira/ADO/markdown are pluggable adapters.
- **Skills over agents** — expertise (docker, postgres, standards…) is procedural knowledge loaded on demand.
- **High autonomy, hard guardrails** — everything on the story→PR path is allowed; destructive or
  production-touching operations are denied or gated (see `docs/permissions-rationale.md`).

## Roadmap

Phases 4–5 (architect/security/devops/docs/research agents, the Next.js/NestJS/Postgres/MongoDB
stack pack, parallel sprints, and the self-extension + promotion workflow) are designed and
documented in `docs/architecture.md`. Phase 3 (Jira, Azure DevOps, Azure Repos, grooming) shipped in v0.3.0.
