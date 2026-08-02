# Bee-Logical Claude AIDLC

An **AI Development Life Cycle** for [Claude Code](https://claude.com/claude-code): you point it at a
work item — or just describe what you want — and it takes the change from requirements to an open pull
request, verifying against *your* project's real gate along the way. A human still reviews and merges.

It is built entirely from Claude Code primitives (agents, skills, hooks, permissions, MCP servers) and
ships as three installable plugins, so there is nothing to run and no service to host.

```
describe it, or name a work item
   ↓
fetch → validate requirements → plan → implement (fanned out across disjoint files)
      → review + security (in parallel) → QA → fix cycles → push → open PR → update the tracker
   ↓
you review and merge
```

**Not everything gets that.** Ask for a typo fix and you get a typo fix — edited, gated, committed, no
ticket and no PR. AIDLC picks the lightest process tier that fits the consequence of getting it wrong,
says which one it picked, and honors *"just do it"* as an instruction rather than arguing.

---

## Is this for you?

**It fits when:**

- You work in Claude Code and want it to follow a repeatable process instead of improvising per task.
- Your work lives in **Jira, Azure Boards, or markdown files** in the repo — all three are first-class.
- You want the boring parts automated (branching, conventional commits, run state, PR bodies, tracker
  transitions) but you still want to review and merge.
- Your project has **its own** conventions — a `pytest` gate, a GitFlow `develop` branch, squash merges,
  a `PROJ-123-thing` branch pattern — and you want those honored, not replaced.
- You have **several repos** in one workspace, or a monorepo with independently-owned packages.

**It does not fit when:**

- You want an autonomous agent that merges its own work. AIDLC deliberately stops at the PR.
- You want a hosted service or a CI bot. This runs in your Claude Code session, on your machine.
- You want it to invent process for a codebase nobody has read. On existing code it *scans first*.

**Common use cases**

| You want to… | Do this |
|---|---|
| Turn a plain-language request into a shipped PR | `/aidlc:run "add avatar upload, 5 MB max"` |
| Ask whether an idea fits your architecture | `/aidlc:do "should billing live in the API repo?"` — grounds in your ADRs, backlog and stack, then answers. No item created |
| Fix something small right now | `/aidlc:do "fix the typo in the header"` — edited, gated, committed, no ticket |
| Adopt AIDLC on a codebase that already exists | `/aidlc:init` → `/aidlc:adopt` → `/aidlc:adopt-apply` |
| Turn a client's requirements document into a populated board | `/aidlc:bootstrap ./requirements.docx` |
| Work the top of your backlog | `/aidlc:next` |
| Work several items at once | `/aidlc:sprint 3` |
| Handle PR review comments | `/aidlc:review-feedback PROJ-123` |
| Re-order work after priorities move | `/aidlc:replan "checkout before search"` |
| Build a UI to a high visual bar | `/aidlc-ux:design /dashboard` |
| Build screens that already exist in Figma | `/aidlc-ux:figma <url>` → `/aidlc-ux:design` |
| Record why the code is the way it is | ADRs, written by the architect or `/aidlc:adopt-adr` |
| Cut a release | `/aidlc:release` |
| Leave cleanly | `/aidlc:remove` |

---

## Install

Per developer, once:

```
/plugin marketplace add bee-logical/AIDLC     # or a local path / Azure Repos URL

/plugin install aidlc@bee-logical             # required — the pipeline itself
/plugin install aidlc-stack-web@bee-logical   # optional — TypeScript/Next.js/NestJS/Postgres/Mongo
/plugin install aidlc-ux@bee-logical          # optional — the design pod (only fires on UI items)
```

| Plugin | What it adds | Install it when |
|---|---|---|
| **`aidlc`** | The orchestrator, 9 pipeline agents, the tracker adapters, run state, the guard hooks. **Stack-agnostic** — it never assumes a language or package manager. | Always |
| **`aidlc-stack-web`** | TypeScript standards, enterprise project structure, Next.js/NestJS/Postgres/Mongo conventions, migrations, Docker, API design, the Node CI half, the Prettier format hook. | Your project is TypeScript/Node |
| **`aidlc-ux`** | 7 design agents, the Figma and Playwright MCP servers, and a design pipeline that gates on either a jury score or fidelity to a Figma design. | Your project has a UI worth judging |

Developing this repo itself: `claude --plugin-dir <your-clone>/plugins/aidlc-core`

---

## Quick start

### A brand-new project

```
/aidlc:init                          # short Q&A → CLAUDE.md, config, permissions, rules, backlog/
/aidlc:run "users can upload an avatar, 5 MB max, png or jpeg"
```

`run` takes free text: it files the work item first, then builds it. Or start from a requirements
document with `/aidlc:bootstrap ./spec.docx`, which infers the architecture from the requirements and
populates the whole board in one reviewed pass.

**Full walkthrough:** [`docs/example-walkthrough.md`](docs/example-walkthrough.md) — empty folder to a
working full-stack app, every command included.

### A codebase that already exists

```
/aidlc:init            # choose "there's existing code — scan it"; leaves stack/topology pending
/aidlc:adopt           # READ-ONLY: derives topology, stack, real gate commands, git conventions
/aidlc:adopt-apply     # shows the full diff, writes config only once you approve
```

The scan reads the code rather than asking you to recall it, and every fact it derives carries
`path:line` evidence. Then optionally `/aidlc:adopt-adr` (records decisions your code already embodies,
rationale left blank for a human — a scan proves *what* was decided, never *why*) and
`/aidlc:adopt-backlog` (files the debt it found as real items).

**The unit of adoption is the workspace, not the repo.** One folder with repos inside it, or a
multi-root VS Code `.code-workspace` whose folders live on different drives — one scan classifies every
root and profiles each on its own terms. A Django service, a Go proxy and a pnpm monorepo in one
workspace end up with three different gates, three commit conventions and three default branches.

**Full walkthrough:** [`docs/brownfield-walkthrough.md`](docs/brownfield-walkthrough.md) — a four-year-old
GitFlow service, from first scan through a merged PR to a drift report six weeks later.

### Day to day

```
/aidlc:next            # pick the top ready item and run it
/aidlc:status          # what's in flight, what's blocked, what's next
```

**Full playbook:** [`docs/user-guide.md`](docs/user-guide.md).

---

## Commands

### Start here

| Command | Purpose |
|---|---|
| `/aidlc:do <anything>` | **The general front door.** An opinion question, an investigation, a small fix, or work described in plain language — it grounds itself in your project (config, ADRs, backlog, in-flight runs) and routes to the lightest thing that fits. Consults end with an answer and no item |
| `/aidlc:init` | Scaffold AIDLC into a project |

### Getting work onto the board

| Command | In | Out |
|---|---|---|
| `/aidlc:bootstrap <doc \| brief>` | a requirements document | a whole populated backlog + inferred architecture |
| `/aidlc:intake <text>` | one requirement, in plain language | well-formed items, deduped against the board |
| `/aidlc:adopt` | the existing code | an evidence-backed profile, **read-only**; a drift report on a re-scan |
| `/aidlc:adopt-apply` | an approved profile | config, `CLAUDE.md`, your real gate + git conventions + runtime constraints — behind a shown diff |
| `/aidlc:adopt-adr` | an approved profile | retroactive ADRs, rationale left for a human |
| `/aidlc:adopt-backlog` | an approved profile | the debt the scan found, as items — capped, deduped, each shown first |

### Running the pipeline

| Command | Purpose |
|---|---|
| `/aidlc:run <ID \| text>` | Run one work item end to end. Resumable. Free text files it first |
| `/aidlc:next` | Pick the highest-priority ready item and run it. On a team, scoped to what's assigned to you |
| `/aidlc:sprint N` | Run N independent items in parallel with a live board (mono: worktrees · poly: per-repo) |
| `/aidlc:review-feedback <ID>` | Pull unresolved PR threads, fix them through the normal cycle, push, reply on each. A comment you disagree with gets answered on the thread — and nothing you didn't fix gets resolved |
| `/aidlc:status` | Dashboard: active runs, blockers, backlog snapshot, drift |

### Shaping the work

| Command | Purpose |
|---|---|
| `/aidlc:groom` | Backlog refinement: fix acceptance criteria, size, flag blockers, propose splits |
| `/aidlc:replan [how]` | Priorities moved? Say it in your own words — `checkout before search`, or `all backend first, then UI`. Re-sequences not-yet-started work into **waves**; in-flight work is never touched and nothing is written to the tracker |
| `/aidlc:repo add <name>` | Declare + bootstrap a repo in a multi-repo workspace |
| `/aidlc:release` | Semver from commits, changelog, tag, notes. Publishing is approval-gated |

### Design (needs `aidlc-ux`)

| Command | Purpose |
|---|---|
| `/aidlc-ux:design <route \| path \| "redesign X">` | Run the design pod on a screen or the whole app. No designs → narrative → inspiration → design system → build + motion → a strict jury loop until the rendered UI scores ≥9/10. Screens already in Figma → build to them and gate on fidelity instead |
| `/aidlc-ux:figma <url> \| sync \| status` | Link a Figma file (screens, or a design system), map frames to routes, extract the spec and variables, and re-sync later to find what drifted |

### Extending and maintaining

| Command | Purpose |
|---|---|
| `/aidlc:scaffold-skill <name>` | Create a project-local skill when a capability is genuinely missing |
| `/aidlc:scaffold-agent <name>` | Same, for an agent — behind a higher justification bar |
| `/aidlc:promote <name>` | PR a proven project-local extension into the shared plugin |
| `/aidlc:sync` | Reconcile local extensions after plugin updates |
| `/aidlc:dogfood` | Log friction with the plugin itself to a local feedback inbox |
| `/aidlc:remove` | Remove AIDLC from the project: deletes its own files, reverts only what it merged, keeps everything you authored |

---

## How it works

**Run files are the memory.** Every item being worked has `.aidlc/runs/<ID>.md` holding its phase,
plan, assumptions, findings and log. It is committed to the item's branch, so the PR carries the full
audit trail and any session can resume mid-pipeline — close your laptop at `implement`, reopen
tomorrow, `/aidlc:run PROJ-123` continues from there.

**Process is proportional to consequence.** Four tiers — *answer*, *direct* (a gated commit, no
ticket), *tracked* (branch + run file), *full* (the pipeline) — with a project-wide floor you set. Five
escalation triggers override it, each naming something you cannot fix by noticing later: auth or
tenant-isolation paths, a destructive migration, a declared API contract, code an in-flight run owns,
and an explicit pipeline request.

**Your gate, not an assumed one.** Verification runs the commands your project actually declares —
`pytest`, `mvn -B verify`, `cargo test`, npm scripts — resolved per repo and per package. A gate your
project doesn't have is reported as a coverage hole, never silently replaced with a default.

**One repo or many.** The runnable leaf is always one repo → one branch → one PR. A cross-repo feature
becomes a parent whose children each target one repo, and a frontend/backend pair is built
*concurrently* against a contract that lands first, with an integration join proving the seam.

**Solo by default, team when you say so.** `team.mode: shared` scopes picks to your assigned items,
makes grooming propose rather than overwrite a colleague's acceptance criteria, floors ceremony at
*tracked*, and checks the shared control plane is current. The pipeline **reads** the assignee and
never writes it — who does the work is a staffing decision. Everything is gated on that one flag, so a
solo project is untouched.

**Guardrails are hooks, not hope.** A pre-flight hook blocks force-pushes and pushes from protected
branches, destructive database commands, production-targeted cluster commands, credential reads and
`.env` exfiltration. Env-file access is default-deny with a per-workspace opt-in. New dependencies are
gated for a supply-chain check before install, across every supported ecosystem. The pipeline cannot
edit its own permissions or hook scripts.

Design rationale: [`docs/architecture.md`](docs/architecture.md).
Why each permission rule exists: [`docs/permissions-rationale.md`](docs/permissions-rationale.md).

---

## Configuration

Everything lives in `.claude/aidlc.config.json`, written by `/aidlc:init` or `/aidlc:adopt-apply`.
The settings worth knowing on day one:

| Key | What it decides |
|---|---|
| `workItems.source` | `markdown` (default) · `jira` · `ado` |
| `workspace.layout` | `mono` (default) · `poly` — several repos under one control plane |
| `git.mode` | `remote` (default: push + PR) · `local` (no remote yet: a confirmed local merge instead) |
| `pipeline.ceremony` | The process floor: `direct` (default) · `tracked` · `full` |
| `pipeline.verification` | How often reviewer/QA/security run — per item, per epic, on demand, or off. The default is economical; your CI gate is the per-item floor |
| `pipeline.gates.verify` | Your project's real gate commands, per repo and package |
| `team.mode` | `solo` (default) · `shared` |
| `ux.*` | Jury threshold, render URL, Figma links |

Full schema: [`docs/aidlc.config.schema.json`](docs/aidlc.config.schema.json).

---

## Repository layout

| Path | What it is |
|---|---|
| `.claude-plugin/marketplace.json` | The marketplace manifest |
| `plugins/aidlc-core/` | The `aidlc` plugin: orchestrator skills, 9 agents, hooks, tracker adapters, MCP config |
| `plugins/aidlc-stack-web/` | Web stack pack: skills, the tooling/structure/CI templates, the format hook |
| `plugins/aidlc-ux/` | UX pod: 7 design agents, design skills, artifact templates, Figma + Playwright MCP |
| `plugins/aidlc-core/templates/project/` | The project template `/aidlc:init` scaffolds |
| `docs/` | Guides, walkthroughs, architecture, schemas, rationale |

### Documentation map

| Doc | Read it when |
|---|---|
| [`docs/adoption-guide.md`](docs/adoption-guide.md) | Installing and setting up — prerequisites, MCP auth, per-project config |
| [`docs/user-guide.md`](docs/user-guide.md) | Day to day — which command when, the item lifecycle, resuming, troubleshooting |
| [`docs/example-walkthrough.md`](docs/example-walkthrough.md) | You want to see a full greenfield run end to end |
| [`docs/brownfield-walkthrough.md`](docs/brownfield-walkthrough.md) | You want to see an existing codebase adopted end to end |
| [`docs/architecture.md`](docs/architecture.md) | Why the framework is shaped this way |
| [`docs/permissions-rationale.md`](docs/permissions-rationale.md) | Security review, or tuning your project's posture |
| [`docs/promotion-policy.md`](docs/promotion-policy.md) | Contributing a skill upstream |
| [`docs/brownfield-adoption.md`](docs/brownfield-adoption.md) | The adoption spec — what is proven and what is still open |

---

## Status

All planned phases are implemented: the core pipeline and quality gates, Jira/Azure Boards/markdown
trackers, GitHub and Azure Repos, mono **and** multi-repo workspaces, 9 pipeline agents plus the 7-agent
design pod, the web stack pack, parallel sprints, wave re-planning, team mode, brownfield adoption, and
the self-extension/promotion workflow.

*Verification.* Every command in the adoption set — `adopt`, `adopt-apply`, `adopt-adr`,
`adopt-backlog`, `remove` — has been run end to end against a purpose-built multi-root fixture (a
multi-tenant Django service, a three-package pnpm/Turbo monorepo, a Go proxy on a `trunk` branch outside
the control plane, a non-repo docs folder and a not-yet-cloned repo), including the drift, in-place
upgrade and clean-removal paths. That surfaced **14 defects, none of which raised an error** — all
fixed, with test suites now guarding the parts that fail silently. What has *not* happened yet is an
adoption of a real third-party repository; [`docs/brownfield-adoption.md`](docs/brownfield-adoption.md)
states exactly what is proven and what is open.

Release history is in [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

Anything under `plugins/**` ships to everyone who installs the marketplace, so it is reviewed against
the acceptance bar in [`docs/promotion-policy.md`](docs/promotion-policy.md): reusable to ≥2 projects,
generalized, no secrets, right kind, right home, and safe. Read that before building a skill you intend
to contribute — it is cheaper than finding out afterwards. Security policy: [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) — © 2026 Bee-Logical.
