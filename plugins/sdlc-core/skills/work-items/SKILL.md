---
name: work-items
description: The canonical WorkItem schema, adapter operation contract, and source routing for the SDLC pipeline. Load whenever you need to read or update epics, stories, tasks, bugs or spikes from any tracker (Jira, Azure DevOps, or the local markdown backlog).
user-invocable: false
---

# Work Items — schema, contract, routing

The SDLC pipeline never talks to a tracker directly. It speaks ONE schema and ONE operation
contract; a per-source adapter skill implements them. This is what makes trackers pluggable.

## Routing

1. Read `.claude/sdlc.config.json` → `workItems.source`.
2. Load exactly one adapter skill:
   - `markdown` → `sdlc:wi-markdown`
   - `jira` → `sdlc:wi-jira` (Atlassian MCP; OAuth on first use)
   - `ado` → `sdlc:wi-ado` (ADO MCP or `az boards` CLI)
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
  "dependsOn": ["PROJ-101"],
  "labels": ["string"],
  "assignee": "string | null",
  "links": { "url": "source URL or file path", "branch": "string | null", "pr": "string | null" },
  "sourceRaw": { "note": "adapter-private fields (e.g. ADO numeric id, Jira issue key)" }
}
```

- `repo` — the git repo (by `repos[].name`) this item is delivered in. `null` for epics (they span
  repos via their children) and for unrouted items (the orchestrator resolves it — see below). In
  **mono** it is always the single repo and can be left `null`.
- `dependsOn` — other item IDs that must land first. Used to sequence a cross-repo epic's children
  (e.g. the frontend story `dependsOn` the backend story). Empty by default.
- `links.branch` / `links.pr` stay **singular** — one run = one repo = one branch = one PR. An epic's
  PRs live on its children; the epic aggregates them.

## Adapter operation contract (all seven, always)

| Operation | Semantics |
|---|---|
| `fetch(id)` | One item → WorkItem. Error clearly if not found. |
| `query(filter)` | Ready items by priority. filter = `{status?, type?, label?, limit?}`. "Ready" = status `todo`, has ≥1 AC (except task/spike), parent not blocked. |
| `create(item)` | Create a new item (epic decomposition, spike creation). Returns assigned id. |
| `transition(id, status)` | Map canonical status → source workflow state. Each adapter documents its state map; project overrides live in config `statusMap`. |
| `comment(id, markdown)` | Append a progress milestone comment (external progress signal for humans). |
| `link(id, {branch?, pr?})` | Attach branch/PR references to the item. |
| `updateAC(id, criteria[])` | Write refined acceptance criteria back to the item. |

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
`az.cmd`) just make it more likely. It is the *prevention* half; `/sdlc:status` ground-truth
reconciliation (below) is the *detection* safety net.

## Repos & routing (mono and poly)

The pipeline operates on **repo entries**, never on a hardcoded "the repo". Build the registry from
`.claude/sdlc.config.json` once at the start of any command that touches git:

- **`repos[]` is non-empty → poly.** Each entry is a repo (`name`, `path`, `host`, `remote`,
  `defaultBranch`, `branchPattern`, `stack`, `labels`, optional `ux`, optional `default`). The config
  itself lives at the **workspace root** (the control plane: `.claude/`, `backlog/`, `.sdlc/`); repo
  paths are resolved under `workspace.root` (default `.`).
- **`repos[]` empty/absent → mono.** Synthesize ONE repo entry from the top-level `git` + `stack` +
  `ux` blocks: `{ name: project.key-lowercased, path: ".", default: true, host: git.host,
  remote: git.remote, defaultBranch: git.defaultBranch, branchPattern: git.branchPattern, stack, ux }`.
  Mono is just a one-entry registry, so everything downstream shares one code path.

**Item → repo resolution chain** (stop at the first that resolves; record the result on the run file's
`repo:` and, when writeable, on the item via `link`):
0. **Control-plane** — workspace-level work that belongs to no product repo (the workspace README,
   cross-repo/architecture docs, the `sdlc.config.json`/`.sdlc/` control plane itself) routes to the
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
   see `/sdlc:repo add`), then route to the new entry. Declining → treat as Ask.
6. **Ask** — still ambiguous → ask the user, listing the declared repos (and the `control-plane` option).

Epics are never routed to a single repo; they **fan out** to one child per affected repo (each child
routed by this chain), with `dependsOn` sequencing. See `sdlc:run` §2.

## Re-decomposition & supersession (don't drop requirements or orphan originals)

When work is **re-decomposed** — an epic/feature/story split into new children that REPLACE existing
items (the cross-repo split in `sdlc:run` §2.5 / `sdlc:intake`, or any restructure) — the pipeline must
not leak requirements or leave the board diverged from what was built:

1. **AC coverage map (old → new).** Before creating children, map every acceptance criterion (and each
   discrete deliverable) of the originals onto the child that will carry it. **Flag any original AC not
   covered by a child** and route it explicitly — into a child, or a new follow-up item — never let it
   vanish. (The live miss this catches: a husky-hooks AC silently dropped in a re-decomposition and
   delivered in zero repos, found only by a manual audit.)
2. **Reconcile the originals you supersede.** Link each superseded original to its delivering
   child(ren) and transition it to a **terminal** state — never leave it `todo`/`New`, or `query()`
   resurfaces delivered work as "ready" and risks re-running it. Prefer a **superseded** terminal
   (throughput-neutral) over a plain "done" so N replaced items don't count as N delivered. The exact
   state available is **per-work-item-type, not global** — probe the item's type for its terminal
   states and adapt (see `wi-ado`: `Removed` may exist for a Story but not a Task); never hard-code a
   state name. If a carved-out AC moved to a new follow-up, link that too.
3. **No silent retype.** Some trackers can't change an item's *type* in place (see `wi-ado`) —
   restructure by **create-new + link + supersede**, or an umbrella parent, never by pretending an item
   changed tier. Note the tier of the AC field too (in ADO it is Story-tier, not Task-tier).

Detection backstop: `/sdlc:status` runs a **ground-truth reconciliation** (tracker status vs run files
+ git + disk) at epic/story close — see that skill. Prevention (this section + write-verification
above) and detection (status) together close the loop the manual audit had to do by hand.

## Parent rollup (keep parents honest — both ends of a child's life)

A parent (Epic/Feature) should reflect its children's state at both transitions:

- **Start (proactive, F19):** when the **first** child enters in_progress, the parent should move
  todo→in_progress. `sdlc:run` §3 does this on story-start. **Guards:** only todo→in_progress; never
  pull a parent back or touch one already in a later state; one tier per run; respect a tracker's own
  rollup automation rather than fighting it. This is prevention.
- **Close (reconciliation, F15):** at epic/story close, `/sdlc:status` ground-truth reconciliation
  rolls a finished parent up to done **only when all children are terminal**, and correctly **leaves a
  parent open** when siblings remain (never force-closes). This is detection/backstop.

Both respect `statusMap` and are **type-aware** (see `wi-ado`: a parent Epic's working/terminal state
name differs from a Story's). A `transition` here is a normal adapter write — read-back-verified like
any other (below). Prevention (start) + detection (close) together keep the board from drifting.

## Rules

- The **run file** (see `sdlc:run-state`) is the internal machine state; adapter comments are the
  external human-visible signal. Write both at phase milestones; on conflict the run file wins.
- Comment style: short, factual, timestamped by the tracker itself. E.g.
  `SDLC: implementation complete on feature/PROJ-123-avatar-upload (4 commits). Entering verify.`
- Never invent status values — if a source workflow lacks a state (e.g. no `in_review`), use the
  adapter's documented closest mapping.
