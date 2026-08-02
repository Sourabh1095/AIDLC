# Bee-Logical Claude AIDLC

A reusable **AIDLC (AI Development Life Cycle)** base for every Bee-Logical project, built entirely on
Claude Code primitives: **agents, skills, rules, hooks, permissions, settings, and MCP servers**.

One orchestrator (`/aidlc:run`) takes any work item — epic, story, task, bug or spike — from
**Jira, Azure DevOps, or a local markdown backlog** and drives it end-to-end:

```
fetch item → validate requirements → plan → implement (fanned out across disjoint files)
→ review + security (parallel) → QA → fix cycles → push branch → open PR → update the tracker
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
| `plugins/aidlc-core/` | The `aidlc` plugin: orchestrator, 9 agents, skills, hooks, MCP config — stack-agnostic |
| `plugins/aidlc-stack-web/` | Stack pack: TS standards, project structure, Next.js, NestJS, Postgres, MongoDB, migrations, Docker, API design, the Node/TS CI half |
| `plugins/aidlc-ux/` | UX pod: 7 design agents, Figma + Playwright MCP, the design/jury/fidelity pipeline |
| `plugins/aidlc-core/templates/project/` | The project template scaffolded by `/aidlc:init` |
| `docs/` | Adoption guide, architecture, permissions rationale |

## Install (per developer)

```
/plugin marketplace add bee-logical/AIDLC     # or a local path / Azure Repos URL
/plugin install aidlc@bee-logical
/plugin install aidlc-stack-web@bee-logical          # Next.js/NestJS/PG/Mongo expertise (optional per stack)
```

For local development of this repo: `claude --plugin-dir <your-clone>/plugins/aidlc-core`

## Adopt in a project

1. Open Claude Code in the project repo (or the workspace folder holding several repos).
2. Run `/aidlc:init` — a short Q&A, then it scaffolds `CLAUDE.md`, `.claude/` config, permissions, rules,
   `backlog/` and `.aidlc/` run-state folders. **On a project that already has code, pick the "scan it"
   path** and init leaves topology, stack and commands pending rather than asking you to recall them.
3. **Existing code?** `/aidlc:adopt` (read-only: derives topology, per-repo stack, monorepo packages, the
   real gate commands, the project's git conventions and its runtime constraints — tenancy, feature flags,
   migration safety, public API contracts — each with `path:line` evidence, writing only
   `.aidlc/adoption/`), then `/aidlc:adopt-apply`, which shows the full diff and writes config only once
   you approve it. `/aidlc:adopt-adr` then records the decisions your code already embodies as ADRs, with
   the rationale left blank for a human — a scan can prove *what* was decided, never *why*.
4. Create work items (markdown backlog, or point config at Jira/ADO).
5. Run `/aidlc:next` — the pipeline takes it from there, verifying against **your** gate rather than
   assumed npm scripts.

**Brownfield and multi-repo are the same door.** The unit of adoption is the **workspace**, not the repo:
one folder with repos inside it, or a multi-root VS Code `.code-workspace` whose folders live anywhere —
different parents, different drives, a UNC share. One `/aidlc:adopt` classifies every root and profiles
each on its own terms, so a Django service, a Go proxy and a pnpm/Turborepo frontend in one workspace end
up with three different gates, three commit conventions and three default branches. The folder holding
your board and ADRs is recognised as the control plane and is never made a routing target.

*Verification status:* every command in the adoption set — `adopt`, `adopt-apply`, `adopt-adr`,
`adopt-backlog`, `remove` — has been run end to end against a purpose-built multi-root fixture (a
multi-tenant Django service, a three-package pnpm/Turbo monorepo, a Go proxy on a `trunk` branch outside
the control plane, a non-repo docs folder and a not-yet-cloned repo), including the drift, in-place
upgrade and clean-removal paths. That surfaced **14 defects, none of which raised an error** — all fixed,
with 373 test cases now guarding the parts that fail silently. What has *not* happened yet is an adoption
of a real third-party repository; see `docs/brownfield-adoption.md` for exactly what is proven and what is
still open.

See `docs/adoption-guide.md` for the full walkthrough, including MCP authentication.
**New to the framework?** Start with `docs/example-walkthrough.md` — empty folder → typed
requirement → working full-stack app, every command included.
**Existing codebase?** `docs/brownfield-walkthrough.md` — a four-year-old GitFlow service and a
squash-only web app, from first scan through a merged PR to a drift report six weeks later.

## Commands

**Setup, and the door for anything at all:**

| Command | Purpose |
|---------|---------|
| `/aidlc:init` | Scaffold the AIDLC template into a project |
| `/aidlc:do <anything>` | General front door: ask an opinion/fit question, investigate, or describe work — the orchestrator grounds itself in the project (ADRs, backlog, runs, stack) and routes. Consults end with an answer, no item |

**Three doors put a project into the framework**, and they differ by what you feed them:

| Command | In | Out |
|---------|----|-----|
| `/aidlc:bootstrap <doc \| brief>` | a requirements document | a whole populated backlog + inferred architecture (greenfield) |
| `/aidlc:adopt` | the existing code | an evidence-backed profile of the workspace, **read-only** (brownfield); on a re-scan, a drift report |
| `/aidlc:adopt-apply` | an approved profile | config, `CLAUDE.md`, the project's real gate + git conventions + monorepo `packages[]` + runtime constraints — behind a shown diff |
| `/aidlc:adopt-adr` | an approved profile | retroactive ADRs for decisions already in the code, rationale left for a human |
| `/aidlc:adopt-backlog` | an approved profile | the debt the scan found, as items on your board — capped, deduped, each shown first |
| `/aidlc:intake <text>` | one requirement, in plain language | well-formed backlog items, deduped against the board |

**Then the pipeline:**

| Command | Purpose |
|---------|---------|
| `/aidlc:run <ID \| text>` | Run one work item end-to-end (resumable); free text = intake + run |
| `/aidlc:next` | Pick the highest-priority ready item and run it. On a shared project, scoped to what's assigned to you — it never silently starts a colleague's item |
| `/aidlc:review-feedback <ID>` | A reviewer left comments: pull the unresolved PR threads, fix them through the normal cycle, push, and reply on each. A comment you disagree with gets answered on the thread, not argued down in a run file — and nothing you didn't fix gets resolved |
| `/aidlc:status` | Dashboard: active runs + backlog snapshot |
| `/aidlc:groom` | Backlog refinement: fix AC, size, flag blockers, propose splits |
| `/aidlc:replan [how you want it re-planned]` | Priorities changed? Say so in your own words — `checkout before search`, or `complete all BE first and then start with UI`. Re-sequences the not-yet-started work into **waves** of items that can run at once (a grouping directive becomes a hard barrier); `next`/`sprint` follow it. In-flight work is never touched, and nothing is written to the tracker |
| `/aidlc:release` | Cut a release: semver from commits, changelog, tag, notes (publish is approval-gated) |
| `/aidlc:sprint N` | Run N independent items in parallel (mono: worktrees · poly: per-repo) with a live board |
| `/aidlc:repo add <name>` | Declare + bootstrap a repo in a poly workspace (config entry + `git init` + base commit) |
| `/aidlc:promote` | PR a proven project-local skill/agent into the shared plugin |
| `/aidlc:sync` | Reconcile local extensions after plugin updates (kill drift) |
| `/aidlc:remove` | Remove AIDLC from the project: deletes its own files, reverts only the sections it merged, keeps everything you authored |

## Design principles

- **Orchestrator is a skill, not an agent** — the main session routes; specialist subagents do the work.
- **Run files** (`.aidlc/runs/<ID>.md`) are durable, resumable pipeline state, committed to the branch.
- **Adapter contract** — the pipeline speaks one WorkItem schema; Jira/ADO/markdown are pluggable adapters.
- **Solo by default, team when you say so** — `team.mode: shared` scopes picks to your assigned items,
  makes grooming propose rather than overwrite, floors ceremony at `tracked`, and checks the shared
  control plane is current. The pipeline **reads** the assignee and never writes it: who does the work is
  a staffing decision, like `priority`. Everything is gated on the flag, so a solo project is unchanged.
- **Skills over agents** — expertise (docker, postgres, standards…) is procedural knowledge loaded on demand.
- **One home per rule** — a rule lives in exactly one skill and everything else points at it. An agent
  carries its brief and its verdict; the discipline stays in the skill it follows.
- **Core is stack-agnostic** — anything assuming a package manager, a toolchain or a browser lives in a
  pack. Core `ci-cd` holds host mechanics and diagnosis; `aidlc-stack-web:ci-web` holds the npm gate; the
  Playwright MCP ships with `aidlc-ux`, the only plugin that renders.
- **High autonomy, hard guardrails** — everything on the story→PR path is allowed; destructive or
  production-touching operations are denied or gated (see `docs/permissions-rationale.md`).

## Self-extension

When the pipeline hits a capability gap it can't cover, it scaffolds a project-local skill (or
agent, behind a justification bar) in `.claude/`, tracks its reuse in `.aidlc/extensions.json`,
and — once proven — `/aidlc:promote` PRs it into this repo for platform-team review
(`docs/promotion-policy.md`). `/aidlc:sync` closes the loop after merge. The framework grows
itself, curated.

## Contributing

Issues and pull requests are welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

Anything under `plugins/**` ships to everyone who installs the marketplace, so it is reviewed
against the acceptance bar in [`docs/promotion-policy.md`](docs/promotion-policy.md): reusable to
≥2 projects, generalized, no secrets, right kind, right home, and safe. Read that before building a
skill you intend to contribute — it is cheaper than finding out afterwards.

## Status

All five design phases are implemented, plus **polyrepo (multi-repo) support** (`aidlc` v0.8.0):
core pipeline + quality gates, Jira/ADO/markdown trackers, GitHub + Azure Repos, mono **and**
multi-repo workspaces, 9 specialist agents, the web stack pack, the `aidlc-ux` design pod, parallel
sprints and the self-extension/promotion workflow.

Concurrency runs at three levels (`aidlc` v0.35.0): independent **items** in parallel headless runs
(`/aidlc:sprint`), a single item's **plan tasks** fanned out across provably disjoint files (the agents
edit, the orchestrator commits — one writer to git, still one branch and one PR), and a feature's
**frontend and backend** built simultaneously against a contract that lands first, with an integration
join proving the seam. Full design: `docs/architecture.md`.

When the client's priorities move mid-project (`aidlc` v0.38.0), `/aidlc:replan` re-sequences what has
not started into ordered **waves** — so a reprioritization keeps the concurrency the decomposition was
designed for instead of quietly serializing it. You say how you want it re-planned in your own words,
and there are two kinds of answer: an **ordering** (*"checkout before search"*) moves items up a list,
while a **grouping** (*"all BE first, then UI"*) means all of one set before any of another — which no
re-ranking can deliver, so it becomes a barrier the packer enforces. Work already in flight always
finishes as-is, and the plan is an execution overlay: the board stays exactly as the product owner
left it.

Delivery is tracked on the tier your team counts it in (`aidlc` v0.39.0). A Story owns the branch and
the PR — that is a fact about git, not a claim that a Story is the unit of work — while the **Tasks**
beneath it are what actually has to be done. The run file's plan and your board's Tasks were always the
same commit-sized breakdown, so the plan now **binds** to them instead of keeping a private copy:
AIDLC adopts your Tasks as the plan in your board's order, each commit names both IDs
(`Refs: PROJ-123, PROJ-145`), and closing a plan step closes its Task. Still one branch and one PR —
and it never writes an estimate, because points and hours are your record of what you asked for, not
a number for the pipeline to invent.

When the screens already exist in Figma (`aidlc-ux` v0.5.0), the pod stops designing. It ships the
Figma MCP, extracts the file once into a written spec plus variables and reference shots, maps those
variables onto the project's tokens instead of inventing a palette, builds to the spec, and gates on
**fidelity** — every difference from the design classified blocking, minor, or a deliberate
adaptation. The jury is *offered* rather than imposed there: the design was already approved by
someone who isn't in the session, so scoring it out of 10 and iterating toward a 9 would overwrite
their decision. Say yes and it runs advisory — build-missed-the-design findings get fixed, critique of
the design itself goes to you and your designer. `/aidlc-ux:figma sync` re-reads after the designer
moves and tells you which built routes now disagree.

Screens and the design *system* are separate questions (`aidlc-ux` v0.6.0), and the enterprise
handover is usually the second one: a brand's UI kit in Figma and no mockups. Link it as a system and
the pod keeps designing the screens — jury and all, because taste is still open — but its variables
become your whole token layer and its components get used instead of re-invented, so an off-system
colour is a defect the jury names rather than a matter of opinion. Which pages of the kit are
canonical is a decision you make once (a real file also holds a cover, explorations and deprecated
sets, and building against a deprecated component is worse than ignoring the system), and a
workspace-wide system is declared once for every frontend, so changing it makes all of them stale at
once and `sync` lists them.
