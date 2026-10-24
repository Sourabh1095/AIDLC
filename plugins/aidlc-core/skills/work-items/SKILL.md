---
name: work-items
description: The canonical WorkItem schema, adapter operation contract, and source routing for the AIDLC pipeline. Load whenever you need to read or update epics, stories, tasks, bugs or spikes from any tracker (Jira, Azure DevOps, or the local markdown backlog).
user-invocable: false
---

# Work Items — schema, contract, routing

The AIDLC pipeline never talks to a tracker directly. It speaks ONE schema and ONE operation
contract; a per-source adapter skill implements them. This is what makes trackers pluggable.

## Routing

1. Read `.claude/aidlc.config.json` → `workItems.source`.
2. Load exactly one adapter skill:
   - `markdown` → `aidlc:wi-markdown` (no server, no setup)
   - `jira` → `aidlc:wi-jira` — **needs the `aidlc-tracker-jira` plugin** for the Atlassian MCP (OAuth on
     first use). There is no CLI fallback; without it the adapter cannot work.
   - `ado` → `aidlc:wi-ado` — the `aidlc-tracker-ado` plugin is **optional**; the `az boards`/`az rest`
     tier covers every operation without it.

   **The adapters live in core; only their MCP servers are packaged separately.** Core ships no tracker
   server at all, so a markdown workspace starts none and adding a fourth tracker is still one `wi-*`
   skill (D4). What moved out is the per-session cost, not the contract.
3. Perform all operations through that adapter for the rest of the session.

## Canonical WorkItem schema

Every adapter normalizes to and from this shape:

```json
{
  "id": "PROJ-123",
  "source": "jira | ado | markdown",
  "type": "epic | story | task | bug | spike",
  "title": "string",
  "description": "markdown string",
  "acceptanceCriteria": ["string (checkbox state noted as [x]/[ ] prefix)"],
  "status": "todo | in_progress | in_review | done | blocked",
  "priority": "P1 | P2 | P3 | P4",
  "estimate": "S | M | L | XL | null",
  "parent": "PROJ-100 | null",
  "repo": "string | null",
  "package": "string | null",
  "dependsOn": ["PROJ-101"],
  "labels": ["string"],
  "assignee": "string | null",   // read-only to the pipeline — see *Ownership*
  "links": { "url": "source URL or file path", "branch": "string | null", "pr": "string | null" },
  "sourceRaw": { "note": "adapter-private fields (e.g. ADO numeric id, Jira issue key)" }
}
```

- `repo` — the git repo (by `repos[].name`) this item is delivered in. `null` for epics (they span
  repos via their children) and for unrouted items (the orchestrator resolves it — see below). In
  **mono** it is always the single repo and can be left `null`.
- `package` — the package (by `packages[].name`) inside that repo, when the repo is a monorepo. `null`
  everywhere else, including a monorepo item that genuinely spans packages before decomposition. It
  narrows the gate, the stack and the PR label; it does **not** add a branch — the leaf is still one
  repo, one branch, one PR. Most trackers have no field for it, so it usually lives on the run file and
  in a label rather than round-tripping through the adapter (see *Item → package resolution*).
- `dependsOn` — other item IDs that must land first. Used to sequence a cross-repo epic's children
  (e.g. the frontend story `dependsOn` the backend story). Empty by default.
- `links.branch` / `links.pr` stay **singular** — one run = one repo = one branch = one PR. An epic's
  PRs live on its children; the epic aggregates them.

## Adapter operation contract (all eight, always)

| Operation | Semantics |
|---|---|
| `fetch(id)` | One item → WorkItem. Error clearly if not found. |
| `query(filter)` | Ready items by priority. filter = `{status?, type?, label?, assignee?, limit?}`. "Ready" = status `todo`, has ≥1 AC (except task/spike), parent not blocked. `assignee` narrows to one person (`"me"` resolves via `team.me`) or to `null` for unassigned — see *Ownership* below. `limit` bounds **one page**, not the whole set — a full sweep pages to completion (see *Full-backlog sweeps* below). |
| `children(id, filter?)` | **Direct** children of `id` → WorkItem[] **in the board's own order**, one tier down only (no recursion). filter = `{type?, status?}`. Returns `[]` when there are none — an empty result is a fact, never an error. Unlike `query` it applies **no "ready" rule and no priority sort**: a child that is done, blocked or AC-less still comes back, because the callers are asking *"what is under this item"*, not *"what can I run"*. |
| `create(item)` | Create a new item (epic decomposition, spike creation). Returns assigned id. |
| `transition(id, status)` | Map canonical status → source workflow state. Each adapter documents its state map; project overrides live in config `statusMap`. |
| `comment(id, markdown)` | Append a progress milestone comment (external progress signal for humans). |
| `link(id, {branch?, pr?})` | Attach branch/PR references to the item. |
| `updateAC(id, criteria[])` | Write refined acceptance criteria back to the item. |

### What the contract deliberately cannot do: re-order the board

There is no op here for **priority**, for adding or removing a **`dependsOn`** edge on an existing item,
or for **sprint/iteration** assignment — and `sprint`/`iteration` is not even a field on the canonical
schema. That is not an oversight to route around with a bespoke adapter call. Those three fields are
where a **human product owner's intent** lives: they are set when an item is authored
(`create`) or by a person on the board, and a pipeline that rewrites them is overwriting the client's
own record of what they asked for.

So when the delivery order changes mid-project, AIDLC re-orders **its own execution**, not the board:
`/aidlc:replan` computes a wave schedule and persists it at the control plane as `.aidlc/plan.md`, an
**execution overlay** that `/aidlc:next` and `/aidlc:sprint` follow. The board stays as the client left
it; the plan lists the priority edits that *would* make the two agree, for a human to apply. Anything
that needs the tracker to actually change — a new contract child, a split — goes through `create` and the
approval gate like any other write.

## Ownership — read the board, never write it

A tracker gives an item **one** assignee. Jira and Azure Boards both enforce that, so "two people
assigned the same task" is not a state the pipeline has to arbitrate — the board already decided, at
planning time, by a human. What the pipeline has to do is **consult that decision**, and until 0.42 it
never did: `query` had no `assignee` filter, so `/aidlc:next` took the top-priority `todo` regardless of
whose name was on it. On a solo project that is invisible. With three developers it means three people's
tools independently select the same correctly-assigned item, and the first to reach `run` §3 wins while
the other two have already branched.

So `assignee` joins `priority`, `dependsOn`, `estimate` and sprint/iteration in the read-only set — for
the same reason and with the same asymmetry:

- **Read it everywhere a pick is made.** `/aidlc:next`, `/aidlc:sprint` and `/aidlc:groom` scope by it.
- **There is no `assign` op, deliberately.** Who does the work is the plan of record, set by a person at
  planning time. A pipeline that reassigns work is overwriting a staffing decision it cannot see the
  reasons for — the same argument that keeps `priority` out of the contract. If an item is on the wrong
  person, a human moves it; AIDLC will follow on the next pick.
- **`create` carrying an assignee is not an exception to that.** `/aidlc:bootstrap` plans capacity
  against a roster and creates the backlog with owners already on it — but that is a *human's* decision,
  approved at bootstrap's §4 gate before a single item exists, arriving through the same `create` that
  carries `priority` and `parent`. The distinction the contract draws is **authoring vs. re-writing**:
  a person may state ownership when the item is born; nothing may change it afterwards.

**Resolving "me".** `team.me` in `.claude/aidlc.config.json`, else `git config user.email`. The value has
to match what the tracker stores, and that differs per source (Jira: `accountId`, resolvable from an
email; ADO: a UPN or display name; markdown: whatever the `assignee:` field holds). Each adapter
documents its own resolution. **If `me` cannot be resolved, do not silently fall back to "any item"** —
say so once and treat every assigned item as someone else's, which fails toward asking rather than
toward two people on one branch.

**`team.mode: "solo"` (the default) disables all of it.** One operator cannot collide with themselves,
the filter would just hide their own board, and nothing about an existing project changes.

### Control-plane freshness (shared mode)

`.aidlc/plan.md`, the control-plane run files, `.aidlc/extensions.json` and — for `source: markdown` —
the whole backlog are **tracked git state at the control plane** that several people read and write.
Nothing in the pipeline pulls or pushes it on a cadence: `aidlc:git-workflow` operates on the resolved
*product* repo, and control-plane routing (rule 0) branches there only for `control-plane`-routed items.
So in shared mode every command that **reads** shared control-plane state checks it is current first:

```bash
git -C <workspace.root> fetch --quiet && git -C <workspace.root> status -sb --porcelain=v2 --branch
```

Report ahead/behind in one line and continue — never block, never auto-pull (a pull can conflict, and
conflicting someone's backlog underneath them mid-command is worse than a stale read):

```
control plane is 4 behind origin/main — `git pull` before trusting the plan
```

`/aidlc:next`, `/aidlc:sprint`, `/aidlc:status`, `/aidlc:groom` and `/aidlc:replan` all do this — they
are the commands that **obey** shared state. `/aidlc:run` deliberately does not: it was handed an
explicit ID, it does not follow the plan (`aidlc:run` §1a), and a fetch before every run buys nothing an
explicit instruction did not already settle. In solo mode, skip it everywhere — there is no second
writer.

**`source: markdown` is a solo-project adapter.** In shared mode the backlog *is* the git tree, so two
people grooming produce merge conflicts in the plan of record, and `query` reads whatever branch the
caller happens to be on (see *Branch visibility* in `aidlc:wi-markdown`). `/aidlc:init` and
`/aidlc:adopt` warn when `team.mode: shared` meets `source: markdown`; it is a real configuration, not a
blocked one, but a team should be on Jira or ADO.

### Full-backlog sweeps — never silently truncate (F34)

`query`'s `limit` is a **page size**, not a licence to drop the rest of the backlog. A caller doing a
**full sweep** — grooming, a backlog count, anything that must "operate on every ready item" — has to
cover the whole set, not just the first page:

1. **Count first.** Get the total number of matching items (a cheap count — `COUNT(*)` in WIQL/JQL, a
   file tally for markdown) *before* iterating, so the caller knows the real size.
2. **Page to completion, or cap out loud.** Either page through all matches (`limit`/offset, or the
   source's continuation token) until exhausted, or — if the caller deliberately caps a session — **say
   so explicitly**: "N items match, sweeping the first K." Never let the tail vanish unremarked.
3. **Adapters must not hard-cap.** `query` with **no `limit`** returns *all* matches (paging internally
   as the API requires). A `limit` bounds one page, and the adapter must let the caller tell more remain
   (a returned/logged total count, or a next-page marker). The live trap this fixes: a groom sweep at
   `limit:25` over a ~120-item backlog silently refined ~20% of it and reported "groomed."

### Write verification (every mutation) — reported success ≠ persisted

A tracker write can report success yet **not persist** — a flaky CLI/API call that returns cleanly
without landing the change, or an eventual-consistency lag. So a reported success is not proof, and the
run file (the durable record every downstream decision trusts) must never silently diverge from the
board. Every write op — `transition`, `create`, `comment`, `link`, `updateAC` — MUST **read the item
back and assert the change landed** before recording success:

1. **Assert.** Re-`fetch(id)` (or an authoritative batch re-fetch) and check the expected effect:
   `transition` → `status` equals the target; `updateAC` → the AC field carries the new criteria;
   `create` → the item exists with the given fields; `link`/`comment` → the reference/comment is present.
2. **Tolerate eventual consistency.** An immediate read-after-write may transiently show stale/`None`
   (observed live: a freshly-set `parent` read back as `None`, then an authoritative re-fetch showed it
   correct and stable). Retry with a short backoff (2–3 attempts, a few hundred ms apart) / re-fetch
   authoritatively before concluding failure — **never hard-fail on the first mismatch** (that trades
   silent-success for false-failure).
3. **On persistent mismatch, surface a hard error** — do NOT stamp success in the run file. Report the
   op, the target, and what the board actually shows.

This binds ALL adapters, not just one — any tracker write can fail; some fallbacks (e.g. ADO's
`az` CLI) just make it more likely. It is the *prevention* half; `/aidlc:status` ground-truth
reconciliation (below) is the *detection* safety net.

## Schema discovery — probe the board, never assume its fields and states

Before mapping anything on Jira or ADO, probe the board's real fields and its **per-type** states
once per session (lazily, loudly on failure) and record each resolution in `fieldMap`. Never infer a
field from one sampled item, never assume vendor defaults, never create a field, state or type, and
discover required-on-create fields **before** the first create. Markdown needs none of this. The full
procedure — the three classes of canonical field, `fieldMap`, sampling, required fields, probing — is
`${CLAUDE_PLUGIN_ROOT}/skills/work-items/references/schema-discovery.md`; `wi-jira` and `wi-ado` implement it.

## Repos & routing (mono and poly)

The pipeline operates on **repo entries**, never on a hardcoded "the repo". Build the registry from
`.claude/aidlc.config.json` once at the start of any command that touches git:

- **`repos[]` is non-empty → poly.** Each entry is a repo (`name`, `path`, `host`, `remote`,
  `defaultBranch`, `branchPattern`, `stack`, `labels`, optional `ux`, optional `default`). The config
  itself lives at the **workspace root** (the control plane: `.claude/`, `backlog/`, `.aidlc/`). A
  **relative** `path` resolves under `workspace.root` (default `.`); an **absolute** `path` is used as
  given and does not consult it. Both are first-class: a multi-root IDE workspace can hold a repo under a
  different parent, on another drive, or on a UNC share, so **never assume a repo lives inside the control
  plane** — resolve each entry to an absolute path once, keep it quoted everywhere (paths contain spaces),
  and if a declared repo cannot be read, report it with the `/add-dir "<abs path>"` remedy rather than
  treating it as configured.
- **`repos[]` empty/absent → mono.** Synthesize ONE repo entry from the top-level `git` + `stack` +
  `ux` blocks: `{ name: project.key-lowercased, path: ".", default: true, host: git.host,
  remote: git.remote, defaultBranch: git.defaultBranch, branchPattern: git.branchPattern, stack, ux }`,
  carrying the top-level `packages` and `saas` blocks onto it too. Mono is just a one-entry registry, so
  everything downstream shares one code path.
- **A repo entry may carry `packages[]`** — one git repo, many independently-owned packages (a monorepo).
  That is a second dimension, not a second layout: `repos[]` is the git boundary, `packages[]` is the
  ownership boundary inside one. A workspace can hold a monorepo *beside* single-app repos, and both
  shapes flow through the same registry. See *Item → package resolution* below.
- **A repo entry may carry `saas`** — the runtime constraints (tenancy, feature flags, migration
  constraints, public API contracts, compliance) that decide what a safe change to that repo looks like.
  Resolve it **per repo**, never workspace-wide: a Node API serving tenants and a static marketing site
  in the same workspace have nothing in common here.

**Item → repo resolution chain** (stop at the first that resolves; record the result on the run file's
`repo:` and, when writeable, on the item via `link`):
0. **Control-plane** — workspace-level work that belongs to no product repo (the workspace README,
   cross-repo/architecture docs, the `aidlc.config.json`/`.aidlc/` control plane itself) routes to the
   **control plane** — the workspace root (`workspace.root`) — and branches/merges there under the
   control plane's own git repo + default branch, through the same gate. This is a **first-class
   routing target `control-plane`**, not an ad-hoc special case. Signals: the item names the
   workspace/README/all-repos, or its scope is config/docs spanning no single product repo.
1. **Explicit** — the item's `repo` field is set to a known `repos[].name` (or the literal
   `control-plane`).
2. **Label** — any of the item's `labels` matches a repo's `labels`. If several repos match, don't
   guess — fall through to grounding/ask.
3. **Single default** — exactly one repo is plausible (only one repo declared, or exactly one has
   `default: true`).
4. **Ground** — the orchestrator/analyst reads the candidate repos (their `role`, stack and the code
   the item describes) and picks the repo the change belongs in; log the reasoning as an assumption.
5. **Undeclared repo** — grounding concludes the work belongs in a repo **not in `repos[]`** (a shared
   library like a `dev-config` package, or a future product that doesn't exist yet). Do NOT silently
   fold it into another repo — **offer to declare it** (append a `repos[]` entry + bootstrap the folder;
   see `/aidlc:repo add`), then route to the new entry. Declining → treat as Ask.
6. **Ask** — still ambiguous → ask the user, listing the declared repos (and the `control-plane` option).

Epics are never routed to a single repo; they **fan out** to one child per affected repo (each child
routed by this chain), with `dependsOn` sequencing. See `aidlc:run` §2.

### Item → package resolution (monorepo only; a no-op everywhere else)

Monorepo only. Resolve explicit `package` → label → path → single default → analyst grounding →
ask, and record `package:` on the run file; it scopes the plan, the standards and the gate inside the
one repo/branch/PR. Full rule: `${CLAUDE_PLUGIN_ROOT}/skills/work-items/references/structure.md` → *Item → package resolution*.

## Cross-repo split tier (poly) — where a feature's work meets the repos

`workspace.crossRepoSplit`: **`story`** (default) — cross-repo work is a Feature with one Story per
repo; **`task`** — a Story is the cross-repo umbrella and its Tasks are the single-repo leaves. Either way
the runnable leaf is one repo = one branch = one PR. Full rule: `${CLAUDE_PLUGIN_ROOT}/skills/work-items/references/structure.md` → *Cross-repo split tier*.

## The Task tier — the unit of effort, bound to the commits that spend it

A plan line and a board Task are the same unit: lines bind to Tasks with `wi:`, a ticked box
transitions the Task, commit trailers name both ids. The pipeline moves Task **states** only — never an
estimate, priority or `dependsOn`. Full rule: `${CLAUDE_PLUGIN_ROOT}/skills/work-items/references/structure.md` → *The Task tier*.

## Contract-first siblings (how frontend and backend run at the same time)

Where a feature splits across an interface that is new or changing, a small **contract child** lands
first and the frontend and backend children both `dependsOn` it — **never each other** — so they run
concurrently; the epic's consolidation pass runs the integration join. Where the interface exists
unchanged: no contract child, no edge. Full rule: `${CLAUDE_PLUGIN_ROOT}/skills/work-items/references/structure.md` → *Contract-first siblings*.

## Re-decomposition & supersession (don't drop requirements or orphan originals)

Splitting or restructuring existing items: carry **every** original AC onto a child via an **AC
coverage map (old → new)**, flag any AC no child covers, and **link + supersede** the originals — never
drop a requirement, never orphan the replaced item. Full rule: `${CLAUDE_PLUGIN_ROOT}/skills/work-items/references/structure.md` → *Re-decomposition &
supersession*.

## Parent rollup (keep parents honest — both ends of a child's life)

A parent (Epic/Feature) should reflect its children's state at both transitions:

- **Start (proactive, F19):** when the **first** child enters in_progress, the parent should move
  todo→in_progress. `aidlc:run` §3 does this on story-start. **Guards:** only todo→in_progress; never
  pull a parent back or touch one already in a later state; one tier per run; respect a tracker's own
  rollup automation rather than fighting it. This is prevention.
- **Close (reconciliation, F15):** at epic/story close, `/aidlc:status` ground-truth reconciliation
  rolls a finished parent up to done **only when all children are terminal**, and correctly **leaves a
  parent open** when siblings remain (never force-closes). This is detection/backstop.

Both respect `statusMap` and are **type-aware** (see `wi-ado`: a parent Epic's working/terminal state
name differs from a Story's). A `transition` here is a normal adapter write — read-back-verified like
any other (below). Prevention (start) + detection (close) together keep the board from drifting.

## Rules

- The **run file** (see `aidlc:run-state`) is the internal machine state; adapter comments are the
  external human-visible signal. Write both at phase milestones; on conflict the run file wins.
- Comment style: short, factual, timestamped by the tracker itself. E.g.
  `AIDLC: implementation complete on feature/PROJ-123-avatar-upload (4 commits). Entering verify.`
- Never invent status values — if a source workflow lacks a state (e.g. no `in_review`), use the
  adapter's documented closest mapping.
