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
/plugin install sdlc-stack-web@bee-logical   # if the project is on the Next.js/NestJS/PG/Mongo stack
```

The `sdlc-ux` design pod is **enabled by default** when you add the marketplace — no install line
needed. It only activates on UI work (backend/infra items never invoke it), so leaving it on costs
nothing on non-UI projects. To turn it off for a project, set `ux.enabled: false` in
`.claude/sdlc.config.json`.

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
**Approve the `.claude/settings.json` write when prompted** — Claude Code guards permission
files at the harness level, so this one file always asks. Review the scaffold with
`git status`, then commit it.

**Trust the workspace.** Claude Code ignores a project's `permissions.allow` rules until the
workspace is trusted — an untrusted headless run has every git/npm command denied. Opening
Claude Code interactively in the repo once (accepting the trust dialog) fixes it permanently.
This matters for CI/headless usage and for `/sdlc:sprint` worktrees.

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
| `atlassian` (Jira) | Remote server — OAuth browser prompt on first use |
| `azure-devops` | Set `ADO_MCP_ORG` env var to your org name; sign-in via `az login` |

If a server fails to start, `claude --debug` shows why; the pipeline degrades gracefully
(GitHub operations fall back to the `gh` CLI, Azure Boards falls back to `az boards`).
Servers you don't use just sit idle — disable them via `/mcp` if the noise bothers you.

**Optional project-scoped servers** (databases, Sentry, Notion, Figma): the template ships
`.mcp.json.example` — copy the entries you need into a `.mcp.json` at the repo root and fill
the env vars. Database servers must use **read-only** users; pipeline writes go through migrations.

### Connecting Jira or Azure Boards as the tracker

1. `.claude/sdlc.config.json → workItems.source`: `"jira"` or `"ado"`.
2. Fill `workItems.jira` (`site`, `project`) or `workItems.ado` (`org`, `project`).
3. If your workflow's status names differ from the defaults documented in the adapter skills,
   add a `statusMap` (canonical → your status), e.g.
   `"statusMap": { "in_review": "Code Review", "blocked": "On Hold" }`.
4. For Azure Repos as the git host too: `git.host = "azure-repos"`.

### Polyrepo: many repos in one workspace

Use this when your product is split across separate git repos (e.g. `backend/`, `frontend/`,
`website/`, `mobile/`) instead of one repo for everything. Run `/sdlc:init` in the **workspace root**
(the "control plane") and choose the **poly** layout — or edit the config by hand:

1. Set `workspace.layout: "poly"` and, if the repos live somewhere other than direct subfolders,
   `workspace.root`.
2. Add one entry per repo to `repos[]` — `name`, `path` (relative to `workspace.root`), `host`,
   `remote`, `defaultBranch`, a one-line `role`, `labels` (routing hints) and per-repo `stack`; give
   frontend repos a `ux.renderBaseUrl`; mark one repo `default: true`. A filled reference ships as
   `.claude/sdlc.config.poly.example.json`; the shape is validated by `docs/sdlc.config.schema.json`.
3. The control plane holds the single shared `backlog/`, `.sdlc/` board and `.claude/`; each product
   repo is a normal git checkout under it.

How it behaves: you describe a requirement in plain language and the **orchestrator** grounds it against
the actual repos, routes each piece to the right repo, and — for anything spanning repos — creates an
**epic** whose child stories each target one repo (sequenced by `dependsOn`). Every run stays atomic:
**one item → one repo → one branch → one PR**, each independently reviewable. `/sdlc:status` shows a
unified board across all repos; `/sdlc:release <repo>` cuts a per-repo release. Mono projects are
unaffected — an empty `repos[]` behaves exactly as before.

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
- `git.host`: `github` | `azure-repos`; `git.branchPattern` (mono)
- `git.mode`: `remote` (default — push + open a PR; you merge it) | `local` (**no remote yet** —
  the pipeline skips push/PR and, after green verify, proposes a local `--no-ff` merge into the
  default branch that it makes only once you confirm; flip back to `remote` when you add an origin).
  In poly this is per-repo on each `repos[]` entry, so one repo can be local while another has a remote.
- `workspace.layout` + `repos[]`: switch to **polyrepo** (see §4 · *Polyrepo* above)
- `pipeline.maxFixCycles`, `pipeline.architectThreshold`
- `pipeline.gates.ambiguousRequirements`: `assume-and-log` (default) | `ask-human`
  — flip to `ask-human` on lower-trust projects to pause when acceptance criteria are ambiguous.

Project-specific expertise belongs in `.claude/skills/` (landing zone already scaffolded) —
the pipeline scaffolds these itself when it hits a capability gap, and tracks reuse in
`.sdlc/extensions.json`. Once a skill proves out (used ≥2×), `/sdlc:promote <name>` PRs it
into the shared plugin for platform review; after it merges, `/plugin marketplace update` +
`/sdlc:sync` removes your local copy. See `docs/promotion-policy.md` for the acceptance bar.

## 7. Working several items at once

`/sdlc:sprint 3` picks the top independent ready items (an analyst checks they don't touch the
same code), runs each in its own git worktree via a headless pipeline, and shows a live board.
Conflicting items queue automatically. Blocked runs keep their worktree for resumption.
