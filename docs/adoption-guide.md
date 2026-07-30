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

### Brownfield: scan the code before you answer the Q&A

On a project that already has code, `/aidlc:init` asks you for its topology, stack and commands — from
memory, about a codebase the framework has never read. Every wrong answer is written into `CLAUDE.md`
and `aidlc.config.json` as ground truth and silently steers every later run. So scan first:

```
cd your-workspace
claude
/aidlc:init             # choose the "there's existing code — scan it" path
/aidlc:adopt            # read-only scan; or: /aidlc:adopt --depth quick|deep
/aidlc:adopt-apply      # shows the diff, writes only what you approve
/aidlc:adopt-adr        # optional: record the decisions your code already embodies
/aidlc:adopt-backlog    # optional: file the debt the scan found as tracked work
```

**One scan covers the whole workspace, not one repo.** The unit of adoption is the *workspace* you
opened — one folder with repos as subfolders, or a multi-root VS Code `.code-workspace` whose folders
sit anywhere, including outside the workspace folder or on another drive. `/aidlc:adopt` reads the
`.code-workspace` file (JSONC — comments and trailing commas and all) **and** scans for nested repos,
because using only one of those is how a six-root workspace collapses into one. Then it classifies every
root and profiles each on its own terms:

| Root it finds | What happens |
|---|---|
| a **product repo** | becomes a `repos[]` entry — its own stack, gate, git conventions and runtime constraints |
| a **monorepo** (pnpm/Nx/Turbo/Lerna/Maven/Cargo workspace) | one `repos[]` entry **plus `packages[]`**, so work routes to a package and its gate scopes to it |
| the **control plane** (the folder holding the board, the ADRs and the config) | classified `control-plane` and deliberately **excluded** from `repos[]` — it is not a routing target, so no item is ever dispatched to a repo with no code |
| a **non-repo folder** (docs, scratch) | recorded with the reason it was excluded |
| a repo **declared but not cloned** | recorded, never given a fabricated path; clone it and re-scan |
| a repo **outside the control plane** | gets an **absolute** `repo.path`, and the control plane's gitlink protection is reported as *inapplicable* rather than missing |

Different repos get different answers, which is the point: a Django service, a Go proxy and a
pnpm/Turborepo frontend in one workspace end up with three different gates, three commit conventions and
three default branches — including a `trunk` or `dev` default, where the pipeline routes correctly but
the `guard` hook's name-based protection does **not** cover it, and `/aidlc:adopt-apply` says so and
points you at host-side branch protection.

**Reachability matters in a multi-root workspace.** A root outside the folder Claude Code was started in
may not be readable by the session. The scan proves it can read each root and, where it cannot, gives you
the exact `--add-dir` remedy — it never reports a repo as profiled when it could not open it.

Later, and equally part of the lifecycle: `/aidlc:adopt` again for a **drift report** against the last
scan, `/aidlc:adopt-apply --only <repo>` to widen a **pilot** one repo at a time, and `/aidlc:remove` if
the evaluation ends. A full worked example of the whole sequence on an existing repo is
`docs/brownfield-walkthrough.md`.

`/aidlc:adopt` is **read-only**. It writes exactly two files — `.aidlc/adoption/profile.json` (a
versioned, machine-readable profile) and `.aidlc/adoption/report.md` — and touches nothing else: no
config, no `CLAUDE.md`, no items, no branch, no commit. `git status` after a run shows only those two
paths. It reports, per repo:

- **Workspace shape** — one folder with repos as subfolders, or a multi-root `*.code-workspace` whose
  folders may live under different parents or on different drives. Every root is classified (product
  repo · monorepo · docs/scratch folder · reference-only clone · already adopted · not cloned) and
  proposed for your confirmation. A root the session cannot reach is reported with the exact
  `--add-dir` fix, and an untrusted root or one where AIDLC is not enabled is named **here** rather
  than failing silently at your first `/aidlc:sprint`.
- **Languages, package managers and frameworks** from manifests, with the paths that carry each — a
  polyglot repo lists all of them, not just the dominant one.
- **The commands the project actually has** (test, lint, typecheck, build, format) and, just as
  importantly, the ones it provably does **not** — recorded as absent coverage holes rather than
  quietly replaced by AIDLC's npm defaults.
- **VCS reality** — shallow clones, submodules, existing worktrees, LFS, forks, and a non-git checkout
  (Mercurial, SVN, Perforce) which is reported as unsupported while the code is still profiled.
- **Monorepo packages** — for a repo holding many packages (pnpm/npm/yarn workspaces, Nx, Turbo, Lerna,
  Maven modules, a Cargo workspace): each package's name as *its own manifest* declares it, its path, a
  derived role, its own stack, which sibling packages it depends on, and whether your tooling can release
  it independently. That last one is checked rather than assumed, so nothing later promises a per-package
  release your project has no way to publish.
- **Runtime constraints, if you run a live product** — the facts that decide what a *safe* change looks
  like and that nobody writes down because everyone already knows them: how tenants are isolated and on
  which key, whether releases ride feature flags, whether migrations run against live customer data,
  which files are public API contracts, your environments and deploy strategy, any declared change-freeze
  window, and any compliance regime **with the signal that evidenced it**. This is mostly a
  `--depth deep` section; at shallower depths it reports *"not sampled at this depth"* rather than
  letting silence read as "no constraints here".
- **Decisions with no ADR** — the irreversible choices your code embodies (tenancy model, data store,
  auth model, API style, deployment topology…), ranked by how expensive each would be to undo and capped
  (default 8, `--max-adrs`). Decisions already recorded — including in a Confluence page or an `RFCs/`
  directory — are listed as already covered rather than re-proposed.
- **Supported / partial / unsupported**, one line of consequence each, judged against the plugins you
  actually have installed. A Django + Terraform + Flutter shop gets the language-agnostic core and is
  told so plainly.
- **What was not looked at** — the scan budget, the caps, the sampling coverage percent on a large
  repo, and the skip list. Every fact carries a `path:line` or a command and its output plus a
  confidence; anything it could not establish is listed under *Not determined* with the reason, never
  guessed.

Two safety notes, because a scan runs across code you may be contractually bound to protect: it makes
**no network calls** and sends no source anywhere (an offline or air-gapped run completes, marking the
affected checks `unknown`), and it never reads or prints `.env` files — env files are recorded by path,
suspected secrets by location and type with the value redacted.

Then **`/aidlc:adopt-apply`** turns the approved profile into configuration — and it is the one command in
this sequence that changes files you own, so it works one way only: **propose, then write.** It shows the
complete diff with each value's evidence beside it, asks the `low`-confidence facts as *questions* instead
of proposing them, surfaces any disagreement with a value you authored as `detected X · configured Y —
keep / replace` (defaulting to keep), and writes nothing until you approve. What it applies:

- **`workspace.layout`, `repos[]`, per-repo `stack`** and `architecture.resolvedBy: "codebase-scan"`, from
  roots classified as product repos or monorepos — never from a docs folder, a reference clone, or a repo
  that isn't cloned yet.
- **`pipeline.gates.verify`** — your project's real verification gate, as an ordered list, per repo and per
  package. This is what replaces the old assumption that every repo runs npm scripts: a Python service
  gets `ruff` + `pytest`, a Maven module gets `mvn -B verify`, and a monorepo with Turbo runs *affected
  targets only*. Gates your project doesn't have stay in the list marked `absent`, so every run reports
  them as coverage holes instead of quietly counting them green.
- **Your git conventions** — branch pattern, commit style, merge strategy, long-lived branches, and the
  **integration branch**, so a GitFlow project branches from and merges into `develop` rather than `main`.
  `.claude/rules/git-workflow.md` is re-rendered from these; where your project has no convention, AIDLC's
  default is used *and labelled as a default*. A fork-only repo gets a fork → upstream-PR path instead of a
  push that would fail.
- **`packages[]`** on the repo entry (or at the top level in a single-repo workspace) — the package
  dimension of a monorepo. It stays `layout: mono`/one repo entry on purpose: `repos[]` means a *git*
  boundary and a monorepo has exactly one, so the package is a second dimension rather than a third
  layout. An item then routes to a package, and its gate **layers** over the repo's — a package that
  declares its own `test` still inherits the repo's `lint`, because a gate that silently vanished is
  indistinguishable from one that passed.
- **The `saas` block** and the security-review paths it seeds. `pipeline.securityReviewPaths` is extended
  by **union**, never replaced, so anything you added by hand stays. Two things then become conditional
  gates, both only where the scan found evidence: a destructive migration is a review **blocker** where
  migrations run against live tenant data, and a diff touching a public API contract, an auth path or a
  tenant-isolation path is reviewed **regardless of your configured cadence**. A detected compliance
  regime *recommends* raising the security cadence and names the signal — it never raises it for you.
- **Provenance** (`adoption.scannedAt` / `commit`), which is what makes re-running it a no-op: apply the
  same profile at the same commit and you get **no diff at all** — not a one-line timestamp churn, byte
  identical, with a clean `git status`.

Finally, **`/aidlc:adopt-adr`** writes the decisions from the scan into `docs/adr/`, one at a time, each
behind its own approval. Each ADR is `accepted (retroactive)` — accepted because your code already runs on
it, retroactive because nobody approved the document at the time — dated `unknown` where history cannot
establish a date, and citing the `path:line` evidence. Its `## Rationale` and `## Alternatives considered`
read **"not recorded — confirm with the team"**, and they stay that way until a human fills them in. That
blank is the point: a scan can prove *what* was decided and never *why*, and one plausible invented
sentence in an ADR marked `accepted` becomes history nobody authored and everybody cites. Existing
decision records elsewhere (Confluence, Notion, `RFCs/`) are **linked** from the ADR index, never copied
or moved — they are your files, in the place you keep them.

**`/aidlc:adopt-backlog`** then turns the debt the scan found — absent gates, an untested tenant-isolation
path, an end-of-life runtime, a TODO cluster, docs contradicted by the code — into items on your board.
It is opt-in, capped, and every item is shown before anything is created, with the evidence beside it.
Two things it deliberately does *not* do: it does not propose volume (twenty items appearing overnight is
a mess somebody has to close, not a gift), and it does not put a finding's *location* on an item where
that location is itself the disclosure. A credential in your git history becomes *"Rotate a credential
found in git history — details in `.aidlc/adoption/report.md`"*, because a tracker item may be a public
issue and the report stays in your repo. Every created item carries the **`adopted`** label plus a dated
provenance note naming the scan commit, so months later the board can answer *"what did adopting AIDLC
actually put on our plate?"*.

### Adoption is a lifecycle, not an event

Four things happen after the first adoption, and all four are first-class:

- **Re-scan for drift.** `/aidlc:adopt` on an already-adopted workspace reads the previous profile before
  overwriting it and reports a **drift** section: what moved in the code, what the config no longer
  matches, and — kept strictly separate — **what you changed by hand**, which it reports and never
  proposes to overwrite. That last distinction is the one that matters: a hand-tuned gate command
  reverted under a diff that looks like routine convergence is a change nobody catches in review. A
  re-scan at the same commit and depth **writes nothing at all** and leaves `git status` clean.
- **Pilot on one repo, then widen.** `--only <repo|package>` on both commands scopes adoption to a
  subset. The config records the scope (`adoption.only`) *and* the exclusions (`adoption.unmanaged`), so
  later scans report the rest as unmanaged-by-choice instead of re-proposing them every time — the
  difference between "not adopted" and "missed".
- **Upgrade an older config in place.** A config written by an earlier plugin version is detected (by its
  version stamp, or by shape where it predates the stamp), and its keys are **relocated, never
  rewritten** — every command you authored stays verbatim — as its own small diff you approve before
  anything else. The moves are recorded in `adoption.upgrades[]`.
- **Remove it cleanly.** `/aidlc:remove` reads the manifest `adopt-apply` wrote (`adoption.writes[]`:
  which files were *created*, which were *merged into*, and which sections were added) and reverses
  exactly that: deletes the framework's own files, reverts only our sections of `CLAUDE.md` and
  `.claude/settings.json`, and **keeps everything you authored** — your ADRs, your backlog, your run
  history, the adoption report. It shows the whole plan before deleting anything and then verifies with
  `git diff` against the pre-adoption commit that your own files are untouched. It does not uninstall the
  plugin; that is `/plugin uninstall`.

Nothing in any of this fixes what the scan finds — adopt reports and proposes; fixing is normal pipeline
work through the normal doors.

### Reading the profile and the config it produces

Five values are worth knowing, because they each mean something narrower than they look:

- **A gate is `present`, `absent`, or `not-applicable`.** `absent` is a gate your project *could* have and
  does not — a **coverage hole**, reported in every run's `## Findings` and never counted green.
  `not-applicable` is a step your **stack** has no concept of: a Django service is deployed from source so
  has no `build`; Go type-checks during `go build` so has no separate `typecheck`. Those are listed once as
  inapplicable and are **never** findings. The distinction exists because a hole nobody can ever fill
  trains you to skip the section that matters.
- **A surface is `supported`, `partial`, `unsupported`, or `not-present`.** The first three describe what
  *AIDLC* covers — `partial` is the usual answer for a non-TypeScript stack, meaning the pipeline runs your
  real gate but coding-standards guidance falls back to the language-agnostic core. **`not-present`** is
  different: it means *your project* does not have that surface (no CI, no release tooling). That is a fact
  about your repo, so it goes to the debt findings, not to AIDLC's capability gaps.
- **`adoption.writes[]`** records every file adoption touched and how — `created`, `merged` (with the
  sections it added) or `rendered`. This is what makes `/aidlc:remove` able to revert *sections* rather
  than guess which `CLAUDE.md` lines were ours.
- **`adoption.seeded`** records the paths adoption contributed to `pipeline.securityReviewPaths`. It exists
  so that a path **you deleted on purpose** is not silently re-added on the next apply: without it, "absent
  because never seeded" and "absent because you removed it" look identical, and a union merge would restore
  your deletion under a diff that looks like routine convergence.
- **`repos[].adoptedFromRoot`** maps a config repo back to the profile root it came from, when the names
  differ — your `.code-workspace` may name a folder `billing-api` while the routing id is `api`. Items and
  ADRs resolve through it, because an item stamped with a repo name that matches nothing runs **no gate at
  all** and reports green.

### What lands in your repo

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | ~40 lines of project facts + AIDLC workflow pointers |
| `.claude/aidlc.config.json` | Per-project switchboard (source, git host, autonomy gates) |
| `.claude/settings.json` | Permission posture: high autonomy + guardrails |
| `.claude/rules/` | Tiny always-on rules: git workflow, safety |
| `backlog/` | Markdown work-item tracker (if source = markdown) |
| `.aidlc/runs/` | Pipeline run state — one file per in-flight item |
| `.aidlc/adoption/` | Brownfield only: the scan's `profile.json` (the drift baseline — commit it) and `report.md` |
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
`website/`, `mobile/`) instead of one repo for everything.

> **If those repos already exist, do not fill this in by hand — run `/aidlc:adopt`.** It derives every
> field below from the code, with `path:line` evidence for each, including the ones easiest to get wrong
> from memory: each repo's real gate commands, its actual default branch, its commit and merge
> conventions, and the monorepo `packages[]` of any repo that has them. See *Brownfield: scan the code
> before you answer the Q&A* above. The steps below are for a **greenfield** poly workspace, or for
> checking what adopt produced.

Run `/aidlc:init` in the **workspace root** (the "control plane") and choose the **poly** layout — or
edit the config by hand:

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
