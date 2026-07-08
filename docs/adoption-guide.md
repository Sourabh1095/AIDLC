# Adoption Guide

How to use the Bee-Logical Claude SDLC in any project — new or existing.

## 1. Prerequisites

- Claude Code installed and authenticated.
- `git` and (for GitHub projects) the `gh` CLI, authenticated (`gh auth login`).
- Node.js ≥ 18 (hook scripts and MCP servers run on Node).
- For Azure DevOps projects: `az` CLI with the `azure-devops` extension, logged in.

## 2. Install the plugin (once per developer)

```
/plugin marketplace add bee-logical/claude-sdlc
/plugin install sdlc@bee-logical
```

> Working from a local clone instead: `/plugin marketplace add D:\path\to\claude-sdlc`
> or launch with `claude --plugin-dir <clone>\plugins\sdlc-core`.

Verify: type `/sdlc:` — you should see `init`, `run`, `next`, `status`.

## 3. Adopt in a project (once per repo)

```
cd your-project
claude
/sdlc:init
```

Answer the Q&A (project key, name, work-item source, git host, stack, commands).
Review the scaffold with `git status`, then commit it.

### What lands in your repo

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | ~40 lines of project facts + SDLC workflow pointers |
| `.claude/sdlc.config.json` | Per-project switchboard (source, git host, autonomy gates) |
| `.claude/settings.json` | Permission posture: high autonomy + guardrails |
| `.claude/rules/` | Tiny always-on rules: git workflow, safety |
| `backlog/` | Markdown work-item tracker (if source = markdown) |
| `.sdlc/runs/` | Pipeline run state — one file per in-flight item |
| `docs/adr/` | Architecture Decision Records |

## 4. MCP authentication (per user, per machine)

The plugin ships MCP servers pre-wired; you provide credentials:

| Server | Auth |
|--------|------|
| `context7` | None required (free tier) |
| `github` | Set `GITHUB_PERSONAL_ACCESS_TOKEN` env var (repo + PR scopes) |
| `playwright` | None (drives a local browser) |
| Jira (Phase 3) | Atlassian MCP OAuth on first use |
| Azure DevOps (Phase 3) | `az login` / PAT |

If a server fails to start, `claude --debug` shows why; the pipeline degrades gracefully
(e.g. GitHub operations fall back to the `gh` CLI).

## 5. Daily workflow

1. Groom your backlog: add items to `backlog/items/` (see `backlog/README.md`) or your tracker.
2. `/sdlc:next` — picks the top ready item, or `/sdlc:run PROJ-123` for a specific one.
3. The pipeline branches, implements, reviews, tests, fixes, pushes, and opens a PR —
   commenting progress on the work item as it goes.
4. **You review and merge the PR.** That's the human gate.
5. `/sdlc:status` any time — active runs, blockers, what's next. After merges it offers cleanup
   (transition item to Done, archive the run file).

### When a run gets BLOCKED

After `maxFixCycles` (default 3) failed fix attempts, the pipeline stops, records findings in
`.sdlc/runs/<ID>.md`, and comments on the item. Fix the underlying issue (or adjust the item),
then rerun `/sdlc:run <ID>` — it resumes from the recorded phase.

## 6. Customizing per project

Edit `.claude/sdlc.config.json`:

- `workItems.source`: `markdown` | `jira` | `ado`
- `git.host`: `github` | `azure-repos`; `git.branchPattern`
- `pipeline.maxFixCycles`, `pipeline.architectThreshold`
- `pipeline.gates.ambiguousRequirements`: `assume-and-log` (default) | `ask-human`
  — flip to `ask-human` on lower-trust projects to pause when acceptance criteria are ambiguous.

Project-specific expertise belongs in `.claude/skills/` (landing zone already scaffolded);
genuinely reusable skills get promoted into this plugin (Phase 5 workflow).
