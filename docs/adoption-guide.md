# Adoption Guide

How to use the Bee-Logical Claude AIDLC in any project — new or existing.

## 1. Prerequisites

- Claude Code installed and authenticated.
- `git` and (for GitHub projects) the `gh` CLI, authenticated (`gh auth login`).
- Node.js ≥ 18 (hook scripts and MCP servers run on Node).
- For Azure DevOps projects: `az` CLI with the `azure-devops` extension, logged in.

## 2. Install the plugin (once per developer)

```
/plugin marketplace add bee-logical/AIDLC
/plugin install aidlc@bee-logical
/plugin install aidlc-stack-web@bee-logical   # if the project is on the Next.js/NestJS/PG/Mongo stack
```

The `aidlc-ux` design pod is **enabled by default** when you add the marketplace — no install line
needed. It only activates on UI work (backend/infra items never invoke it), so leaving it on costs
nothing on non-UI projects. To turn it off for a project, set `ux.enabled: false` in
`.claude/aidlc.config.json`.

> Working from a local clone instead: `/plugin marketplace add D:\path\to\AIDLC`
> or launch with `claude --plugin-dir <clone>\plugins\aidlc-core`.

Verify: type `/aidlc:` — you should see `init`, `run`, `next`, `status`.

## 3. Adopt in a project (once per repo)

```
cd your-project
claude
/aidlc:init
```

Answer the Q&A (project key, name, work-item source, git host, stack, commands).
**Approve the `.claude/settings.json` write when prompted** — Claude Code guards permission
files at the harness level, so this one file always asks. Review the scaffold with
`git status`, then commit it.

**Trust the workspace.** Claude Code ignores a project's `permissions.allow` rules until the
workspace is trusted — an untrusted headless run has every git/npm command denied. Opening
Claude Code interactively in the repo once (accepting the trust dialog) fixes it permanently.
This matters for CI/headless usage and for `/aidlc:sprint` worktrees in mono.

Trust is *not* the same as plugin enablement, and mixing them up produces a confusing failure.
Enablement lives in `settings.json` (`enabledPlugins` + a known marketplace), at user scope
(`~/.claude/settings.json`) or project scope (`<workspace>/.claude/settings.json`); trust lives in
`~/.claude.json`. A headless run in a path where the plugin isn't *enabled* exits **rc=0** with
`Unknown command: /aidlc:run` — it looks like a clean success. If you enable AIDLC at project scope
in a poly workspace, only the control plane has it: the product repos do not, which is why sprint
launches poly runs from the control plane rather than from a per-repo worktree (F42).

### What lands in your repo

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | ~40 lines of project facts + AIDLC workflow pointers |
| `.claude/aidlc.config.json` | Per-project switchboard (source, git host, autonomy gates) |
| `.claude/settings.json` | Permission posture: high autonomy + guardrails |
| `.claude/rules/` | Tiny always-on rules: git workflow, safety |
| `backlog/` | Markdown work-item tracker (if source = markdown) |
| `.aidlc/runs/` | Pipeline run state — one file per in-flight item |
| `docs/adr/` | Architecture Decision Records |
| `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig`, `.npmrc` | Strict web-stack tooling baseline (TypeScript repos only, from `aidlc-stack-web`; merge-aware — skipped if you already have configs). Makes the coding standards a machine-enforced CI gate. Run the printed `npm i -D …` to activate. |
| Enterprise skeleton + `.dependency-cruiser.cjs` | Canonical folder structure (NestJS backend; Next.js App-Router or RTK-Query SPA frontend — you pick at init) with `store/`, `common/constants`, feature modules, plus a boundary-lint config that fails CI on layering violations. From `aidlc-stack-web:project-structure`; merge-aware. |

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

> **Azure DevOps: "connected" ≠ "authenticated" (a sharp edge).** `/mcp` showing
> `azure-devops · connected · N tools` only means the MCP **process started** — it authenticates on the
> **first real call**, which then fails opaquely (*"Failed to find api location for area."*) if the
> launch environment is wrong. The requirement is that **both `ADO_MCP_ORG` (your org name) and a
> working `az login` are present in the shell that _launches_ Claude Code**. Consequences:
> - Installing `az` (or setting `ADO_MCP_ORG`) **mid-session doesn't take** — it isn't on the launching
>   shell's PATH/env. **Fully relaunch** Claude Code from a shell where both are set.
> - Verify before you start: `echo $ADO_MCP_ORG` is non-empty, `az account show` succeeds, and (once)
>   `az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>`.
> - `/aidlc:status` runs a tracker doctor that distinguishes "MCP process up" from "ADO reachable +
>   authenticated" and prints this remediation if the probe fails.

Servers you don't use just sit idle — disable them via `/mcp` if the noise bothers you.

**Optional project-scoped servers** (databases, Sentry, Notion, Figma): the template ships
`.mcp.json.example` — copy the entries you need into a `.mcp.json` at the repo root and fill
the env vars. Database servers must use **read-only** users; pipeline writes go through migrations.

### Connecting Jira or Azure Boards as the tracker

1. `.claude/aidlc.config.json → workItems.source`: `"jira"` or `"ado"`.
2. Fill `workItems.jira` (`site`, `project`) or `workItems.ado` (`org`, `project`).
3. If your workflow's status names differ from the defaults documented in the adapter skills,
   add a `statusMap` (canonical → your status), e.g.
   `"statusMap": { "in_review": "Code Review", "blocked": "On Hold" }`.
4. For Azure Repos as the git host too: `git.host = "azure-repos"`.

### Polyrepo: many repos in one workspace

Use this when your product is split across separate git repos (e.g. `backend/`, `frontend/`,
`website/`, `mobile/`) instead of one repo for everything. Run `/aidlc:init` in the **workspace root**
(the "control plane") and choose the **poly** layout — or edit the config by hand:

1. Set `workspace.layout: "poly"` and, if the repos live somewhere other than direct subfolders,
   `workspace.root`.
2. Add one entry per repo to `repos[]` — `name`, `path` (relative to `workspace.root`), `host`,
   `remote`, `defaultBranch`, a one-line `role`, `labels` (routing hints) and per-repo `stack`; give
   frontend repos a `ux.renderBaseUrl`; mark one repo `default: true`. A filled reference ships as
   `.claude/aidlc.config.poly.example.json`; the shape is validated by `docs/aidlc.config.schema.json`.
3. The control plane holds the single shared `backlog/`, `.aidlc/` board and `.claude/`; each product
   repo is a normal git checkout under it.

How it behaves: you describe a requirement in plain language and the **orchestrator** grounds it against
the actual repos, routes each piece to the right repo, and — for anything spanning repos — creates an
**epic** whose child stories each target one repo (sequenced by `dependsOn`). Every run stays atomic:
**one item → one repo → one branch → one PR**, each independently reviewable. `/aidlc:status` shows a
unified board across all repos; `/aidlc:release <repo>` cuts a per-repo release. Mono projects are
unaffected — an empty `repos[]` behaves exactly as before.

## 5. Daily workflow

1. Groom your backlog: add items to `backlog/items/` (see `backlog/README.md`) or your tracker.
2. `/aidlc:next` — picks the top ready item, or `/aidlc:run PROJ-123` for a specific one.
3. The pipeline branches, implements, reviews, tests, fixes, pushes, and opens a PR —
   commenting progress on the work item as it goes.
4. **You review and merge the PR.** That's the human gate.
5. `/aidlc:status` any time — active runs, blockers, what's next. After merges it offers cleanup
   (transition item to Done, archive the run file).

### When a run gets BLOCKED

After `maxFixCycles` (default 3) failed fix attempts, the pipeline stops, records findings in
`.aidlc/runs/<ID>.md`, and comments on the item. Fix the underlying issue (or adjust the item),
then rerun `/aidlc:run <ID>` — it resumes from the recorded phase.

## 6. Customizing per project

Edit `.claude/aidlc.config.json`:

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
`.aidlc/extensions.json`. Once a skill proves out (used ≥2×), `/aidlc:promote <name>` PRs it
into the shared plugin for platform review; after it merges, `/plugin marketplace update` +
`/aidlc:sync` removes your local copy. See `docs/promotion-policy.md` for the acceptance bar.

## 7. Working several items at once

`/aidlc:sprint 3` picks the top independent ready items (an analyst checks they don't touch the
same code), runs each through a headless pipeline, and shows a live board. Conflicting items queue
automatically.

How each run is isolated depends on your layout. In **mono**, every item gets its own **git
worktree**, and a blocked run keeps that worktree for resumption. In **poly**, the runs launch from
the **control plane** with the cwd unchanged — `/aidlc:run` already routes each item into its own
repo checkout, so separate repos provide the isolation and no worktree is created. The constraint
there is one in-flight item per repo: a second item targeting the same repo queues behind the first.
