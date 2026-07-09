# Example Walkthrough — From an Empty Folder to a Working Todo App

A complete, copy-paste-ready example of using the Bee-Logical Claude SDLC on a brand-new
project. Scenario: **no tracker, no tasks anywhere** — you type the requirement, the pipeline
plans it, creates the work items, and builds it. Target app: a simple todo app with a
**Next.js frontend, NestJS backend, and Postgres** database.

Share this file with anyone onboarding onto the framework.

---

## 0. Prerequisites (one-time, per machine)

| Need | Check |
|---|---|
| Claude Code installed & logged in | `claude --version` |
| Node.js ≥ 18 | `node --version` |
| git | `git --version` |
| Postgres running locally (you have pgAdmin) | can connect in pgAdmin |
| GitHub CLI — only if the repo will live on GitHub | `gh auth status` |

In **pgAdmin**, create an empty database for the project now (e.g. `todo_app`), and note your
username/password. The pipeline never reads your real credentials — you'll put them in a local
`.env` later (which the pipeline is deliberately *denied* from reading).

---

## 1. Create the project folder and repo

```powershell
mkdir D:\todo-app
cd D:\todo-app
git init -b main
claude
```

When Claude Code opens in the new folder, **accept the workspace-trust dialog**. (Skipping it
silently disables the project's permission allowlist later — every git/npm command would ask.)

## 2. Install the SDLC plugins (one-time, per developer)

Inside the Claude Code session:

```
/plugin marketplace add D:\SDLC
/plugin install sdlc@bee-logical
/plugin install sdlc-stack-web@bee-logical
```

> When the marketplace repo is pushed to your org, this becomes
> `/plugin marketplace add bee-logical/claude-sdlc` (or the HTTPS URL) — everything else is identical.

The second plugin is the web stack pack — since this project is Next.js/NestJS/Postgres, you
want its conventions active. Verify: type `/sdlc:` and you should see `init`, `intake`, `run`,
`next`, `status`, `groom`, `sprint`, `release`…

The **UI/UX design pod** (`sdlc-ux`) is **enabled by default** — no install step needed. It stays
dormant on backend/infra work and wakes up only on UI items, so you'll see it in action at step 6.
Type `/sdlc-ux:` to confirm the `design` command is present.

## 3. Scaffold the SDLC into the project

```
/sdlc:init
```

Answer the Q&A. For this example:

| Question | Answer |
|---|---|
| Project key | `TODO` |
| Project name | `Todo App` |
| Work-item source | `markdown` (no Jira/ADO — the backlog lives in the repo) |
| Git host | `github` (or `azure-repos`) |
| Default branch | `main` |
| Stack | frontend `nextjs`, backend `nestjs`, databases `postgres` |
| Commands | accept the proposals (they'll be refined once the app skeleton exists) |
| Verification cadence | pick one: **auto/per-item** (review + QA every item, default), **auto/per-epic** (once per feature), **manual** (you review the PRs), or **ask each time** — you can change it anytime in `pipeline.verification` |

**Approve the `.claude/settings.json` write when prompted** — that one file always asks, by
design. Then review and commit:

```
git status          # see the scaffold: CLAUDE.md, .claude/, backlog/, .sdlc/
git add -A && git commit -m "chore: adopt Bee-Logical SDLC"
```

## 4. Type your requirement — the pipeline plans it

No items exist anywhere. Just describe what you want:

```
/sdlc:intake I want a simple todo app. Users can create a todo with a title,
see the list of todos, mark one as done / not done, and delete one. Frontend
is a Next.js page; backend is a NestJS REST API; todos persist in the local
Postgres database (todo_app). Keep it single-user for now — no login.
```

What happens (this is the thinking-before-doing you asked for):

1. The **analyst agent** reads the (empty) codebase and the (empty) backlog, then shapes the
   requirement into a plan of work — for something this size, expect an **epic + 4–6 stories**,
   roughly: project skeleton (Nest + Next + Postgres wiring, migrations setup), todos API
   (CRUD), todos UI (list/create/toggle/delete), and end-to-end wiring — each with testable
   acceptance criteria, priority, and size.
2. You get the **proposal first** — nothing is created until you approve. Adjust freely
   ("merge those two", "make delete P3", "drop the epic").
3. On approval the items land in `backlog/items/` (TODO-1, TODO-2, …), committed to main.

> Mixed situations work the same way: if some items already existed (from Jira, a teammate,
> an earlier intake), the sweep skips what's covered, creates only the delta, and links
> relations. And `/sdlc:run <free text>` does intake **and** starts building in one step.

## 5. Give the app its database credentials

The pipeline will scaffold the code to read `DATABASE_URL` from the environment. Create the
local `.env` yourself (the pipeline can't read or write it — that's a guardrail):

```powershell
# D:\todo-app\.env  (gitignored)
DATABASE_URL=postgresql://postgres:YOURPASSWORD@localhost:5432/todo_app
```

The pipeline maintains `.env.example` with the required variable *names* only.

## 6. Build — one item at a time, hands-off

```
/sdlc:next
```

That picks the highest-priority ready item (the skeleton story first) and runs the full
pipeline: **requirements check → plan → implement → review + QA in parallel → fix cycles →
push branch → open PR → docs**. Progress is written to `.sdlc/runs/TODO-n.md` and commented
on the backlog item as it goes.

Your job per item: **review and merge the PR** (`gh pr view --web`, or the printed URL).
That's the only human gate. After merging:

```
/sdlc:status        # offers cleanup: item → done, run file archived
/sdlc:next          # take the next story
```

Repeat until the epic's children are done. Prefer parallel? Once the skeleton story is merged,
`/sdlc:sprint 2` runs independent stories in separate worktrees simultaneously.

### 6a. The UI story goes through the design pod automatically

When `/sdlc:next` reaches the **todos UI** story, the orchestrator detects it's a UI item and — after
the screens are built — routes it through the design pod before the PR. You'll see extra phases:
narrative → inspiration research → design system → motion → **jury**. The jury starts the dev
server, screenshots the actual rendered UI, and scores it /10 against an Awwwards-style rubric; if
it's below 9 it hands specific fixes back and the design-system/motion agents iterate (up to 3
rounds by default), then it re-judges. All of it lands in `design/` and is visible in the PR:

```
design/narrative.md          # the experience story
design/inspiration.md        # cited award-winning references
design/design-system.md      # the tokens every component uses (+ tokens in code)
design/motion-spec.md        # animation/interaction spec
design/jury-report-r1.md …   # each round's score + evidence
```

The design system it establishes here becomes the project standard — every later UI story adopts it,
so the app stays uniform instead of drifting page to page.

### 6b. Polish or rebrand a specific screen on demand

Beyond the automatic pass, you can point the pod at any screen yourself — new or already built:

```
# elevate one existing page to award-grade (audits it, keeps it consistent with the rest)
/sdlc-ux:design app/todos/page.tsx

# redesign it, anchored to your brand — drop assets in design/brand/ first
#   design/brand/logo.svg, design/brand/brand-colors.txt, a screenshot of your typeface
/sdlc-ux:design "redesign the todos page, match design/brand/logo.svg and our brand colors"
```

It extracts a palette from the logo, matches your fonts, honors those as hard constraints, and the
jury checks brand adherence and that the page still fits alongside your other screens. Tune the bar
in `.claude/sdlc.config.json` → `ux` (`juryThreshold`, `maxJuryRounds`, `juryPanelSize`, `brand`).

## 7. Stopping, resuming, changing your mind

- **End of day**: just close the terminal. Nothing to save — state lives in the run files.
- **Next morning**: open Claude Code in the project; it prints where everything stands.
  `/sdlc:run TODO-3` resumes exactly where it stopped.
- **Scope change mid-story** (e.g. "todos also need a due date"): either edit the item's AC in
  `backlog/items/` — the next resume reconciles the plan without redoing finished work — or
  `/sdlc:intake add due dates to todos` to make it a new story. Ambiguous cases stop and ask you.
- **A run gets BLOCKED**: read `## Findings` in its run file; fix the cause (or amend the
  item); `/sdlc:run <ID>` to resume.

## 8. What you end up with

```
D:\todo-app\
├── CLAUDE.md               # project facts the AI always knows
├── .claude/                # SDLC config, permissions, rules
├── backlog/                # your items: epic + stories, statuses, activity logs
├── .sdlc/runs/             # one auditable run file per item (archived when done)
├── docs/adr/               # architecture decisions (e.g. "Prisma vs TypeORM")
├── design/                 # one design system + UX narrative, motion spec, jury reports (brand/ if used)
├── apps or src/…           # the actual Next.js + NestJS + Postgres app, built story by story
└── (a PR per story, each with AC checklist, assumptions, test evidence)
```

Every line of product code arrived through: a tracked item → a plan → implementation →
independent review + QA → tests executed → a PR **you** merged. The audit trail of who
assumed what, and why, is in the run files and PRs — not in anyone's memory.

## Quick troubleshooting

| Symptom | Fix |
|---|---|
| Commands ask permission for everything | Workspace not trusted — reopen the folder interactively, accept the dialog |
| `gh pr create` fails | `gh auth login`, then `/sdlc:run <ID>` (resumes at the PR step) |
| DB connection refused during tests | Postgres not running / wrong `DATABASE_URL` in `.env` |
| Marketplace add fails with SSH error | The org repo isn't pushed/accessible yet — use the local path `D:\SDLC` |

Full day-to-day reference: `docs/user-guide.md` · Setup detail: `docs/adoption-guide.md`
