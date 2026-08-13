---
name: bootstrap
description: Plan a BATCH of requirements into the tracker in one reviewed pass — either a whole greenfield backlog from a client requirements document (Word/PDF) or brief, or a batch of new features for a project that already has code and a populated board. Ingest → ground (greenfield infers architecture from the requirements; brownfield reads the existing code, adoption profile and ADRs and honors what is there) → work-breakdown (Epic→Feature→Story→Task with acceptance criteria, attached under existing epics where one fits) → contribution-aware team assignment → capacity-planned sprints → create it all through the work-items adapter. Use for greenfield project setup, "turn these requirements into a populated board / push these requirements to DevOps", AND "here is a document of new features for our existing product" — as distinct from /aidlc:intake, which adds ONE requirement at a time. Pairs with /aidlc:init's deferred path (greenfield) and /aidlc:adopt (brownfield). Tracker-agnostic — ado, jira or markdown via the same adapter (ADO writes go MCP → az → PAT last-resort; never a browser HTML file with an embedded token).
argument-hint: "[path to a requirements doc, or the brief in plain language]"
disable-model-invocation: true
---

# /aidlc:bootstrap $ARGUMENTS — a requirements document in, a planned backlog out

**The bulk door**: take a batch of requirements (an uploaded Word/PDF, a brief pasted into
chat, or both), decompose it into a full work-breakdown, plan sprints against a team's real
capacity, and create every item in the active tracker — in one reviewed pass.

**It runs in two modes, and it decides which one for itself (§0).**

| Mode | When | What differs |
|---|---|---|
| **Greenfield** | Empty or near-empty project — no product code yet | The architecture is **inferred from the requirements** (§2.0). The whole backlog is new. |
| **Brownfield** | The project already has code, and usually a populated board | The architecture is **read from the code, never inferred from the document**. New work is grounded in what exists, attached under existing epics where one fits, and setup work that is already done is never re-proposed (§2.1). |

Brownfield is the ordinary case for a live product: a client sends a document of *new features* for a
system that has been shipping for a year. That document must not be read as if it described a project
from scratch — that is what produces "set up CI", "create the user table" and a second parallel Epic
tree beside the one already on the board.

Where this sits (there is one general front door, `/aidlc:do`; these are the specific ones):
- **`/aidlc:init`** scaffolds the framework (config, backlog, run-state). **Run it first** — bootstrap
  needs `.claude/aidlc.config.json` to know the tracker and project. Its **deferred path** stops there
  and leaves topology/stack/architecture **pending**; bootstrap then infers them from the requirements
  (§2.0), so you never answer mono/poly or stack blind before the requirements are read. That path is
  **greenfield-only** — on existing code, init routes to adopt instead, and so does §0 here.
- **`/aidlc:adopt`** derives the project's real shape from the code it already has, into
  `.aidlc/adoption/profile.json`. **It is bootstrap's brownfield counterpart, and brownfield mode reads
  its profile when one exists** (§2.1) — evidence-backed topology, per-repo stack, packages, gates and
  runtime constraints, for a fraction of what re-reading the tree costs.
- **`/aidlc:intake`** turns ONE requirement into items, grounded in the codebase. Bootstrap is intake at
  batch scale, plus a team-capacity plan. Everything bootstrap creates goes through the same adapter and
  the same propose-before-create discipline — it is not a second, parallel path to the board.

**Tracker-agnostic by construction.** Bootstrap never talks to Azure DevOps (or Jira) directly. It
routes every write through `aidlc:work-items` → the source adapter, so the same command populates an
ADO board, a Jira project, or the markdown backlog. For ADO the adapter tries the **`azure-devops`
MCP first, `az boards` CLI next, and a PAT+REST path only as a last resort** (`aidlc:wi-ado`). **Never
generate a self-contained HTML file with an embedded PAT** to push items — that pattern exists only
for sandboxes with no network and no CLI; here the adapter writes directly and read-back-verifies.

## Preconditions

1. **Initialized project** — `.claude/aidlc.config.json` exists. If not, stop and run `/aidlc:init`.
   init's **deferred path** writes a config with `architecture.status: "pending"` (no topology/stack) —
   **on a greenfield project** bootstrap resolves it in Phase 2.0 from the requirements. A config with a
   human-authored architecture (`status: resolved`/absent, real `workspace.layout` + `repos[]`/`stack`)
   is honored, not overwritten. `pending` on a project that **has code** is a mis-route, not an
   instruction to infer — see §0.
2. **Brownfield: readable code** — in brownfield mode the plan is only as good as what §2.1 could read.
   An adoption profile is the cheap path; absent one, the repos must at least be present on disk. A
   batch planned against a codebase nothing opened is a greenfield plan wearing the project's name.
3. **Reachable tracker** — the adapter can read/write (for ADO, see `aidlc:wi-ado` → *Connectivity*;
   a quick `adapter.query({limit:1})` confirms it before you propose creating dozens of items).
4. **Resolved tracker schema** — bootstrap is the framework's largest single burst of `create` calls, so
   it is where an unprobed schema costs the most: a mandatory custom field or a renamed AC field is
   discovered on item 7 of 40, leaving a half-built backlog. Resolve the schema **before** the §4 gate
   (`aidlc:work-items` → *Schema discovery*) and name any required field you cannot fill from the
   requirements **in the approval gate itself** — that is the moment the user can answer it, and asking
   forty times mid-creation is not.

---

## 0 · DETERMINE THE MODE — before reading a single requirement

The mode changes what the requirements are allowed to decide, so settle it first. **Do not ask the
user which mode to run**; the project answers it. Check, cheapest signal first:

| Signal | Where | Reads as |
|---|---|---|
| `.aidlc/adoption/profile.json` exists | control plane | **brownfield** (and §2.1 will read it) |
| `architecture.resolvedBy: "codebase-scan"` | `aidlc.config.json` | **brownfield** — the config came from a scan |
| A declared repo path holds a manifest (`package.json`, `pom.xml`, `*.csproj`, `pyproject.toml`, `go.mod`, …) or a `.git` with commits beyond the AIDLC scaffold | each `repos[].path`, or the project root in mono | **brownfield** |
| The board has items in a done/in-progress status, or any item not labelled `bootstrap` | `adapter.query` | **brownfield** — someone has been delivering here |
| None of the above | — | **greenfield** |

**Say which mode you are in, in one line, before Phase 1** — it is the single assumption everything
downstream rests on, and the user is the one who can correct it in a word. Something like:
*"Brownfield mode — `frontend/` and `api/` have code, and the board has 34 items. I'll ground the
breakdown in what's there and attach new work to the existing epics where one fits."*

**The architecture rule, and it is the one that matters:**

> **In brownfield mode the requirements document never decides the project's shape.** Topology, stack,
> and monolith-vs-microservices are facts about code that already exists. Phase 2.0's inference is
> **greenfield-only** — skip it entirely and honor the config.

If the config says `architecture.status: "pending"` **and** §0 found code, that combination is a
mistake, not an instruction: init's deferred path was taken on a project that should have gone to
adopt. **Stop and route** — *"This project has code but its architecture is still `pending`. Run
`/aidlc:adopt` (read-only) → `/aidlc:adopt-apply` first so the shape comes from the code, then re-run
me."* If the user declines and wants to proceed anyway, ground per §2.1 and derive the shape **from
what you read in the repo**, record `rationale` naming the `path:line` evidence you used — and surface
it in the Phase 4 gate as a derived-not-scanned value. Never write `resolvedBy: "codebase-scan"`
for this; that value means adopt produced it, and a bounded read is not a scan.

---

## 1 · COLLECT INPUTS

Gather what's needed; **don't re-ask for anything the config already answers.** If the user supplied
some of this in `$ARGUMENTS`, acknowledge it and ask only for the gaps.

### 1.1 Requirements source
Accept any combination — do not insist on an uploaded document if the project is described in chat.

- **Chat brief** — the user describes the project directly. Treat it as the source of truth; ask
  targeted follow-ups only to fill real gaps; confirm your understanding back before analysis.
- **Uploaded document(s)** — extract text before analysis:
  ```bash
  # PDF
  pdftotext "<path>.pdf" - | head -200          # if empty/garbled, fall back:
  python3 -c "import fitz; [print(p.get_text()) for p in fitz.open('<path>.pdf')]"
  # Word
  pandoc -f docx -t markdown "<path>.docx"
  ```
  Read and consolidate ALL documents.
- **Both** — merge them; chat additions are as valid as the document ("the doc, plus we've added a
  mobile module not in it yet").

### 1.2 Team roster (optional, contribution-aware) — **per-run only, not persisted**
If the user wants assignments and capacity planning, collect a roster. Two ways:

- **Typed in chat** — name, role, email/display name, **contribution %**, and **involvement**
  (Primary / Secondary / Guidance). If they give people without contribution/involvement, ask for it
  once — it's what keeps critical-path work off part-time contributors.
- **Uploaded CSV/Excel** — `python3 <skill_dir>/scripts/parse_team_file.py "<path>"` → normalized
  JSON roster. Column names are case-insensitive; the script handles common variants.

This roster lives **only for this run** — it is not written to `aidlc.config.json`. If no roster is
given, skip assignment (leave `assignee` null); capacity planning then sequences purely by priority
and dependencies.

| Involvement | Contribution % | Assignment rule |
|---|---|---|
| **Primary** | 70–100% | Any work, including critical-path / blocking / collaborative. The backbone. |
| **Secondary** | 20–60% | **Self-contained, non-blocking tasks only** — never work others wait on. |
| **Guidance** | 5–20% | **Review / approval / consultation only** — never hands-on implementation. |

### 1.3 Active work streams
Ask which disciplines contribute: BA · UI/UX · Frontend · Backend · QA · DevOps · Data/Analytics ·
Project Management. **Only generate work for the selected streams** (BA off → no doc/process-mapping
tasks; QA off → no test-plan/automation tasks; etc.). Note cross-stream dependencies in descriptions
even when the dependent stream is out of scope.

### 1.4 Sprint duration
"How long is each sprint?" (1–4 weeks). Store as days — it drives the capacity math in §3.

### 1.5 Repo topology & stack — **never asked; derived from the requirements or read from the code**
Do **not** ask the user for mono-vs-poly, repo names, stack, or monolith-vs-microservices. Which
source answers it is what §0's mode decided:

- **Brownfield (any mode-0 signal)** — the **code** is the answer. Honor `workspace.layout`,
  `repos[]`, per-repo `stack` and `packages[]` as they stand; §2.1 grounds in them. **Phase 2.0 does
  not run.** A requirements document describing new features has no standing to restate the topology of
  a system that is already deployed — and if the document *does* propose a structural change ("split
  billing into its own service"), that is a **work item with an ADR**, not a config edit bootstrap
  makes on its own authority. Propose it in Phase 4; never write it silently.
- **Greenfield + resolved** — a human authored `workspace.layout` + `repos[]`/`stack` (or
  `architecture.status: resolved`). **Honor it**; shape the breakdown per `workspace.crossRepoSplit`
  (default `story`) in §2.
- **Greenfield + pending** — init deferred the architecture (`architecture.status: "pending"`, blank
  stack, empty `repos[]`). **Phase 2.0 infers topology + stack + monolith-vs-microservices from the
  requirements** and writes it to config, then §2 shapes the WBS to match.

That last case is the core greenfield mould: with no code to read, the requirements decide the
project's shape, so the shape is **derived downstream**, never demanded blind up front. The moment
there *is* code, the code outranks the document — see §0.

> The original claude.ai skill also collects an **ADO URL, a PAT, and a process template** here.
> **We collect none of them** — org/project live in config, the adapter authenticates itself
> (MCP/az), and `aidlc:wi-ado` auto-detects the process (Agile/Scrum) and owns the type/field
> mapping. Inputs the adapter or the requirements already answer are not re-collected.

---

## 2 · ANALYZE & DECOMPOSE  (dispatch Agent → aidlc-analyst)

Brief the analyst with the consolidated requirements + **the mode from §0** + the selected work streams
+ the current config (`architecture`, `workspace`, `repos[]`, `stack`, `packages[]`). It performs, per
`aidlc:requirements` and `aidlc:planning`:

1. **Extract** functional / non-functional requirements, constraints, and assumptions.

2. **Determine & persist the architecture (Phase 2.0) — GREENFIELD ONLY.** Skip this entire step in
   brownfield mode (§0): the shape is already a fact about the code, and a features document does not
   get to restate it. Run it **only when the config is `pending` or its
   topology/stack are unset** (init deferred them, or a bare greenfield config). If a human already
   authored `workspace.layout` + `repos[]`/`stack` (`status: resolved`/absent), **honor it — never
   overwrite.** When determining, infer **from the requirements**, biased to the **simplest architecture
   that fits (YAGNI)**:
   - **Style** — `monolith` / `modular-monolith` / `microservices`. Default to a single-repo
     **modular monolith**. Escalate to **microservices/poly only on clear signals**: independently
     deployable or separately-scaled components, distinct bounded contexts owning separate data,
     multiple client surfaces (web + mobile + admin console), separate team ownership, or a component
     needing a different runtime/stack (e.g. a Python ML service beside a Node API). Vague ambition
     ("enterprise-grade", "must scale") is **not** a signal — a modular monolith scales far and is
     cheaper to run. If the requirements explicitly dictate an architecture/stack, that **wins** over
     inference.
   - **Topology** — monolith / modular-monolith ⇒ **mono** (one repo, modules internal); microservices
     ⇒ **poly** (a repo per service + a repo per distinct client surface). Give each poly repo a `name`,
     one-line `role`, and `stack`.
   - **Stack** — per repo (poly) or top-level (mono). Honor a stack the requirements state; else the
     plugin's web-stack defaults (frontend `nextjs`, backend `nestjs`, db `postgres`/`mongodb`), or
     "none" for a discipline out of scope (§1.3).
   - **Write it to `.claude/aidlc.config.json` silently** (no confirm gate — per the chosen decision
     mode): set `workspace.layout`, `workspace.crossRepoSplit` (poly; default `story`), `repos[]` (poly)
     or top-level `stack` (mono), and `architecture = { status: "resolved", style, resolvedBy:
     "/aidlc:bootstrap", rationale: "<the split/no-split signal>" }`. Config is a local, reversible file
     and the resolved shape is **surfaced in the Phase 4 plan review** before any tracker item is
     created, so a wrong mono/poly or over-eager microservices call is catchable there. Poly repos that
     don't exist yet are fine — record them; declaring/bootstrapping the folders follows init's
     greenfield-poly rules (or `/aidlc:repo add`).

3. **GROUND IN THE EXISTING PROJECT (Phase 2.1) — BROWNFIELD ONLY.** This is the step that makes a
   batch of new features land *in line with* the system instead of beside it. Skip it in greenfield
   (there is nothing to read). Read, cheapest first — stop when the requirements are grounded:

   - **`.aidlc/adoption/profile.json`** when it exists — topology, per-root stack, `packages[]`, the
     real gate commands, git conventions and `saas` runtime constraints, each already carrying
     `path:line` evidence and a confidence. **Prefer it over re-reading the tree**; it is why
     `/aidlc:adopt` exists and it costs a file read. Note its `scan.scannedAt`/`scan.commit` — if HEAD
     has moved a long way since (excluding `.aidlc/adoption/`), say so once and treat the stale areas
     as needing a look, rather than trusting or discarding the whole profile.
   - **No profile → offer one.** *"`/aidlc:adopt` would give me an evidence-backed picture of this
     codebase before I plan 40 items against it — worth the pass?"* Offer once. If declined, do a
     **bounded** read yourself (below) and say in Phase 4 that the grounding was bounded, not scanned.
   - **The codebase, per requirement** — exactly `/aidlc:intake` §2.1, at batch scale: which modules
     each requirement touches, **what already exists**, and feasibility signals. **In poly, ground
     across ALL declared repos** — one feature routinely spans an API change in `backend`, its UI in
     `frontend`, and a migration in `db`. Determine which repo each piece belongs in.
   - **`docs/adr/*.md`** — titles always; the full ADR when a requirement touches its decision. A
     decision already accepted **constrains the plan**: a requirement that contradicts one is not
     silently planned around it. Raise it in Phase 4 as *"this needs ADR-014 superseded"* and propose
     the ADR as an item. **An ADR at `accepted (retroactive)`** came from `/aidlc:adopt-adr`: its
     *what* is binding, its Rationale may read "not recorded" — never quote that blank as agreement.
   - **`.aidlc/facts.md`** (`aidlc:facts`) — the operational truths the project keeps relearning.

   **What grounding is for — the conventions that bind the breakdown:**
   - **Honor the stack that is there.** Never propose a technology the project does not use because the
     document's phrasing suggests one. If a requirement genuinely needs a new dependency or service,
     that is an explicit item **plus an ADR**, called out in Phase 4 — not an assumption buried in a
     task description. Proposing Postgres work to a Mongo project is the signature failure of an
     ungrounded batch.
   - **Follow the project's existing seams.** New modules go where the codebase already puts that kind
     of thing; new endpoints follow the existing API conventions (`aidlc-stack-web:api-design` where
     that pack is installed). The point of reading first is that the plan reads as though the team
     wrote it.
   - **Existing contracts are existing.** A frontend/backend pair whose interface already exists gets
     **no contract child and no `dependsOn` edge** (`/aidlc:intake` §2.3) — read the contract and say so
     on both items. Chaining looks prudent and costs the whole feature's parallelism.

4. **Filter by work stream** (§1.3) — generate items only for selected disciplines.
5. **Sweep the existing backlog — dedup AND placement (Phase 2.2).** `adapter.query` over open items.
   Two distinct jobs, and brownfield needs both:
   - **Dedup**, exactly like `/aidlc:intake`: fully-covered requirement → skip and report; partially
     covered → propose only the delta, linked; overlaps an in-flight run → flag it (the new work may
     conflict with an open branch; recommend sequencing after that item lands). Planning onto a
     populated board must not create near-duplicates.
   - **Placement** — query the **epic/feature tier specifically** and, for each new requirement, decide
     where it hangs: **under an existing epic/feature** when one covers the capability, or a **new
     epic** when it is genuinely a new capability. Default to attaching. A batch of new features that
     mints a parallel Epic tree beside the one the team already uses is the most visible way an
     automated plan announces that nothing read the board — and it is the thing a PM has to unpick by
     hand afterwards. Record the chosen parent per item; Phase 4 shows it.
6. **Build the work-breakdown** (shaped by the architecture — resolved in Phase 2.0 for greenfield,
   read from the code in Phase 2.1 for brownfield) — Epic → Feature → Story → Task:
   - **Every item gets a meaningful description**; every **story/PBI gets ≥3 testable acceptance
     criteria** (the `aidlc:requirements` bar — happy path + failure + edge). A title-only item is a
     defect, not a plan.
   - Stories are **INVEST** and ≤ size L; an XL item is decomposed, never shipped whole.
   - **Brownfield — classify every requirement before shaping it.** The classification decides the
     item's shape, its parent, and whether it exists at all:

     | Class | Shape |
     |---|---|
     | **Already built** | **No item.** Report it as covered, naming the module (`api/src/auth/`) or the item (`PROJ-87`) that covers it. |
     | **Extension of an existing capability** | Story (or Feature → stories) **under the existing epic/feature** from placement (§2.2). Name the modules it extends in the description. |
     | **Change to existing behavior** | Story that **names the modules it touches**, plus at least one AC covering **what must keep working** — a migration/back-compat/regression criterion. Changing a live system without that AC is how a "small" feature takes a release down. |
     | **Genuinely new capability** | New epic → features → stories, shaped like greenfield but sited per the project's existing seams. |

   - **Brownfield — do not re-propose work the project has already done.** A greenfield WBS emits
     scaffolding ("set up CI", "create the database schema", "implement authentication", "initialize
     the repo") because in greenfield those are real. On a running system they are noise at best and a
     destructive instruction at worst. **The work-stream filter (§1.3) does not catch this** — it
     filters by discipline, and "set up the CI pipeline" is legitimately DevOps. Grounding (§2.1) is
     what catches it: if the gate commands are in `pipeline.gates.verify`, CI exists. Emit setup work
     **only** where §2.1 evidenced its absence, and say what was missing.
   - **Poly:** author cross-repo work at `workspace.crossRepoSplit`'s tier — a Feature fans out to
     per-repo child Stories (`story` mode) or a Story fans out to per-repo child Tasks (`task` mode);
     the runnable leaf is single-repo either way. Sequence cross-repo children with `dependsOn`. When
     a split re-homes ACs, apply the **AC coverage map** — every original AC lands on a child, none
     dropped (`aidlc:work-items` → *Re-decomposition*).
7. **Assign priorities** — P1 (Critical) … P4 (Low). **Brownfield:** priority is relative to the board
   that already exists, not to this batch alone. A batch whose every item is P1 has said nothing —
   check what the open P1s are before minting more.

---

## 3 · CAPACITY-PLAN SPRINTS & ASSIGN  (contribution-aware — the net-new step)

With the roster from §1.2 (skip this section's assignment half if none was given):

- **Effective capacity** per person per sprint = `contribution% × sprint_days`. A team of two 100%
  devs + one 20% dev is ~2.2 FTE/sprint, not 3 — plan to that, don't overload.
- **Assign by involvement** (§1.2 rules): Primary → any work incl. critical path; Secondary →
  self-contained non-blocking tasks only, noted "not on critical path"; Guidance → explicit
  review/approval tasks only, tagged on the parent for visibility, never implementation.
- **Load-balance:** don't assign more than ~80% of a person's available days; keep secondary members
  well under theirs (context-switching overhead).
- **Schedule** each story into a sprint respecting dependencies, priority, and the capacity above.
  Sprints become tracker iterations in §5.
- **Brownfield — plan into the calendar that exists, not a fresh one.** Query the tracker's iterations
  first. Schedule into the **current and upcoming** ones by their real names/dates; only create new
  iterations past the end of the defined set, continuing the project's own numbering and cadence
  (§5.1). A plan that opens with "Sprint 1" on a team currently in Sprint 23 is unusable on sight.
- **Brownfield — the team is not idle.** Their capacity this sprint is already partly committed to the
  open items on the board. Subtract that before assigning: sum each person's in-flight and
  current-iteration work (`adapter.query` by assignee + iteration) and plan against what is **left**.
  Treating a working team as fully available is the fastest way to produce a plan that is wrong by the
  end of its first sprint. Where the tracker has no reliable estimates to sum, say so and plan against
  a stated assumption rather than inventing precision.

---

## 4 · PRESENT THE PLAN FOR REVIEW  (propose before create — always)

Creating a batch of items is externally visible; **never create before the user approves.** Show:
- **the mode** (§0) and the signal that decided it — one line, first, because everything below is
  conditioned on it.
- **the architecture bootstrap derived** (greenfield, when it resolved a pending config): layout
  (mono/poly), the repos + roles, the **style** (monolith / modular-monolith / microservices), the stack,
  and the one-line rationale. It was written to config silently in Phase 2.0 — showing it *here*, before
  any tracker item exists, is the catch-point for a wrong mono/poly or over-eager microservices call.
  (Omit when the architecture was human-authored and merely honored, or when brownfield read it from
  the code.)
- **(brownfield) what grounding found** — the profile used and its scan date (or that grounding was
  **bounded**, when the user declined a scan); the requirements classed **already built**, with what
  covers them; any requirement that **contradicts an accepted ADR**; any **new dependency or service**
  the batch would introduce, flagged as needing an ADR; and any **structural change** the document
  proposed, as a proposal — never as something already written to config.
- the **Epic → Feature → Story → Task** tree with each item's description (and stories' AC), marking
  each top-level item **NEW EPIC** or **→ under `PROJ-42`** so the shape of the attachment is legible
  at a glance;
- **sprint, priority, assignee** per item — and for each assignee their **involvement + contribution %**
  so the user can verify part-time/advisory people aren't on the critical path;
- a **capacity summary per sprint** (member · contribution % · task count · estimated load);
- **explicit call-outs:** secondary members on any task (confirm non-blocking); guidance members
  (confirm review-only); overloaded sprints; **(poly)** any umbrella story that intentionally spans
  repos (the exception — confirm rather than split); **(brownfield)** every item classed *change to
  existing behavior*, since those carry the regression risk, and any item overlapping an in-flight run.

Ask: **"Create this in <tracker>? [all / pick / adjust]"** Revise and re-present on changes. Wait for
explicit approval.

---

## 5 · CREATE — through the adapter, verified  (never HTML/PAT)

On approval, load `aidlc:work-items` and route through the source adapter (`aidlc:wi-ado` for ADO —
**MCP → az → PAT last-resort**; `aidlc:wi-jira`; `aidlc:wi-markdown`). Do **not** emit a browser HTML
pusher or write a PAT into any file.

1. **Sprints → iterations.** **Reuse before you create:** resolve each planned sprint against the
   tracker's existing iterations and use the existing node whenever one matches. Create a new iteration
   classification node (ADO: via the adapter/`az`) **only** for sprints past the end of the defined set,
   following the project's own naming and cadence. Record each path for the stories' iteration field.
   Creating a duplicate iteration beside a live one splits the team's board in half.
2. **Work items, parents first.** `adapter.create(...)` epics → features → stories → tasks, setting
   `parent` as you go — **for brownfield, `parent` is the existing epic/feature resolved in placement
   (§2.2) wherever one was chosen** — then add `dependsOn` links once sibling children exist. The adapter owns the
   type mapping (canonical epic/story/task → the process's real types — Agile/Scrum/CMMI/Basic; see
   `references/work_item_types.md` for the per-template hierarchy and field names).
3. **Write-verification on every create** — re-fetch and assert the item landed before recording
   success; tolerate eventual consistency, retry with backoff, hard-error on persistent mismatch
   (`aidlc:work-items` → *Write verification*). A reported success is not a persisted success.
4. **Stamp provenance** on every created item — label **`bootstrap`** + a one-line description note:
   `> Provenance: created via /aidlc:bootstrap on <UTC date> from <doc name / "chat brief">.` Use the
   real system clock (`date -u` / `Get-Date`). Later, filtering on `bootstrap` surfaces planned batches
   vs. everything added afterward.
   **Brownfield adds the label `increment`** — without it, a feature batch planned in month nine is
   indistinguishable from the initial backlog, and "what was this project originally scoped to do?"
   stops being answerable. `bootstrap` = this door created it; `bootstrap` + `increment` = it arrived
   after the project was already running.
5. **Comment on the existing items you touched** — `adapter.comment` on each existing epic/feature that
   gained children, and on each open item a new one was linked to or sequenced behind. Someone watching
   that epic should learn from the tracker that it grew, not from a chat log they were not in. Never
   relabel or edit the existing items themselves — a comment is the whole of the write.

---

## 6 · HAND OFF

Report created IDs and counts (epics / features / stories / tasks / sprints), any skipped duplicates,
and any items left unassigned. **Brownfield also reports** what was classed already-built (and what
covers it), which existing epics gained children, and anything raised for an ADR. Then offer one next
action:
- "Start the highest-priority ready item? `/aidlc:next`" — or `/aidlc:run <ID>` for a specific one.
- "Work several at once? `/aidlc:sprint N`."
- **(brownfield, when an ADR was raised)** "Record the decision first? `/aidlc:adopt-adr`" — a new
  service or dependency the batch introduces is a decision, and it is cheapest to write down now.

## Rules

- **`/aidlc:init` first** — bootstrap needs the config; never improvise tracker/project/repo values.
- **Decide the mode before reading the requirements (§0), and say which one** — everything below it is
  conditioned on that one call, and it is the one the user can correct in a word.
- **Existing code outranks the document.** In brownfield mode the requirements never decide topology,
  stack, or architecture style — those are facts about code, read from the config/profile (§1.5, §2.1).
  Phase 2.0's inference is greenfield-only. A structural change the document proposes is a work item
  plus an ADR, never a silent config edit.
- **Architecture is derived, not asked (greenfield)** — when the config is `pending` *and there is no
  code*, bootstrap infers topology, stack and monolith-vs-microservices from the requirements (biased to
  the *simplest that fits*), writes it to config silently, and surfaces it in the Phase 4 review; it
  never re-asks mono/poly/stack. A human-authored (resolved) architecture is honored, never overwritten
  (§2.0). `pending` + existing code is a mis-route: send it to `/aidlc:adopt` (§0).
- **Ground before you plan (brownfield)** — read the adoption profile, the code, the ADRs and the facts
  file *before* decomposing (§2.1). An ungrounded batch proposes the stack the document's phrasing
  implied, re-proposes setup the project finished a year ago, and mints a parallel epic tree beside the
  live one. All three are visible to the client on the board.
- **Attach before you create (brownfield)** — new work hangs under the existing epic/feature when one
  covers the capability; a new epic is for a genuinely new capability (§2.2).
- **Propose before create** — a batch of items is high-blast-radius; approval is mandatory (§4).
- **Dedup honestly** — planning onto a populated board proposes deltas, not near-duplicates (§2.2).
- **The adapter owns auth, process detection, and field mapping** — don't collect a PAT, an ADO URL,
  or a process template up front, and never push via an embedded-token HTML file. MCP → az → PAT
  (last resort) is the write path (`aidlc:wi-ado`).
- **Team roster is per-run** — used to plan and assign this pass; not written to config.
- **Every item is described; every story has ≥3 testable AC** — the `aidlc:requirements` bar holds at
  bulk scale, not just for single intake. A brownfield *change to existing behavior* additionally
  carries an AC for what must keep working.
- **Stamp provenance** (`bootstrap` label + dated note, `+ increment` on brownfield) so both the
  original scope and every later batch stay queryable.
