---
name: bootstrap
description: Bootstrap a whole project's backlog in ONE pass from a client requirements document (Word/PDF) or a described brief — ingest → work-breakdown (Epic→Feature→Story→Task with acceptance criteria) → contribution-aware team assignment → capacity-planned sprints → create it all in the active tracker through the work-items adapter. Use for greenfield project setup or "turn these requirements into a populated board / push these requirements to DevOps", as distinct from /aidlc:intake, which adds ONE requirement at a time. Tracker-agnostic — works for ado, jira or markdown via the same adapter (ADO writes go MCP → az → PAT last-resort; never a browser HTML file with an embedded token).
argument-hint: "[path to a requirements doc, or the brief in plain language]"
disable-model-invocation: true
---

# /aidlc:bootstrap $ARGUMENTS — a requirements document in, a whole backlog out

The **bulk front door**: take a client's requirements (an uploaded Word/PDF, a brief pasted into
chat, or both), decompose it into a full work-breakdown, plan sprints against a team's real
capacity, and create every item in the active tracker — in one reviewed pass.

Relationship to the other front doors:
- **`/aidlc:init`** scaffolds the framework (config, backlog, run-state). **Run it first** — bootstrap
  needs `.claude/aidlc.config.json` to know the tracker, project and repo topology.
- **`/aidlc:intake`** turns ONE requirement into items. Bootstrap is intake at project scale, plus a
  team-capacity plan. Everything bootstrap creates goes through the same adapter and the same
  propose-before-create discipline — it is not a second, parallel path to the board.

**Tracker-agnostic by construction.** Bootstrap never talks to Azure DevOps (or Jira) directly. It
routes every write through `aidlc:work-items` → the source adapter, so the same command populates an
ADO board, a Jira project, or the markdown backlog. For ADO the adapter tries the **`azure-devops`
MCP first, `az boards` CLI next, and a PAT+REST path only as a last resort** (`aidlc:wi-ado`). **Never
generate a self-contained HTML file with an embedded PAT** to push items — that pattern exists only
for sandboxes with no network and no CLI; here the adapter writes directly and read-back-verifies.

## Preconditions

1. **Initialized project** — `.claude/aidlc.config.json` exists. If not, stop and run `/aidlc:init`.
2. **Reachable tracker** — the adapter can read/write (for ADO, see `aidlc:wi-ado` → *Connectivity*;
   a quick `adapter.query({limit:1})` confirms it before you propose creating dozens of items).

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

### 1.5 Repo topology — **read it from config, don't re-ask**
The single-vs-poly question the original skill asks is already answered by
`.claude/aidlc.config.json` (`workspace.layout`, `repos[]`, `workspace.crossRepoSplit`). Use it:
- **mono** → ignore repo boundaries; everything is the one repo.
- **poly** → shape the breakdown per `workspace.crossRepoSplit` (default `story`) in §2 — the
  runnable leaf is single-repo, the tier is the configured one (`aidlc:work-items` → *Cross-repo
  split tier*). Don't ask for repo names/counts; the config's `repos[]` carries them (and greenfield
  repos may not exist yet — that's fine, split along the natural component seams).

> The original claude.ai skill also collects an **ADO URL, a PAT, and a process template** here.
> **We collect none of them** — org/project live in config, the adapter authenticates itself
> (MCP/az), and `aidlc:wi-ado` auto-detects the process (Agile/Scrum) and owns the type/field
> mapping. That is the core mould: inputs the adapter already owns are not re-collected.

---

## 2 · ANALYZE & DECOMPOSE  (dispatch Agent → aidlc-analyst)

Brief the analyst with the consolidated requirements + the selected work streams + (in poly) the
repo registry. It performs, per `aidlc:requirements` and `aidlc:planning`:

1. **Extract** functional / non-functional requirements, constraints, and assumptions.
2. **Filter by work stream** (§1.3) — generate items only for selected disciplines.
3. **Sweep the existing backlog** — `adapter.query` over open items and **dedup**, exactly like
   `/aidlc:intake`: fully-covered requirement → skip and report; partially covered → propose only the
   delta, linked; overlaps an in-flight run → flag. Bootstrapping onto a populated board must not
   create near-duplicates.
4. **Build the work-breakdown** — Epic → Feature → Story → Task:
   - **Every item gets a meaningful description**; every **story/PBI gets ≥3 testable acceptance
     criteria** (the `aidlc:requirements` bar — happy path + failure + edge). A title-only item is a
     defect, not a plan.
   - Stories are **INVEST** and ≤ size L; an XL item is decomposed, never shipped whole.
   - **Poly:** author cross-repo work at `workspace.crossRepoSplit`'s tier — a Feature fans out to
     per-repo child Stories (`story` mode) or a Story fans out to per-repo child Tasks (`task` mode);
     the runnable leaf is single-repo either way. Sequence cross-repo children with `dependsOn`. When
     a split re-homes ACs, apply the **AC coverage map** — every original AC lands on a child, none
     dropped (`aidlc:work-items` → *Re-decomposition*).
5. **Assign priorities** — P1 (Critical) … P4 (Low).

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

---

## 4 · PRESENT THE PLAN FOR REVIEW  (propose before create — always)

Creating a whole backlog is externally visible; **never create before the user approves.** Show:
- the **Epic → Feature → Story → Task** tree with each item's description (and stories' AC);
- **sprint, priority, assignee** per item — and for each assignee their **involvement + contribution %**
  so the user can verify part-time/advisory people aren't on the critical path;
- a **capacity summary per sprint** (member · contribution % · task count · estimated load);
- **explicit call-outs:** secondary members on any task (confirm non-blocking); guidance members
  (confirm review-only); overloaded sprints; **(poly)** any umbrella story that intentionally spans
  repos (the exception — confirm rather than split).

Ask: **"Create this in <tracker>? [all / pick / adjust]"** Revise and re-present on changes. Wait for
explicit approval.

---

## 5 · CREATE — through the adapter, verified  (never HTML/PAT)

On approval, load `aidlc:work-items` and route through the source adapter (`aidlc:wi-ado` for ADO —
**MCP → az → PAT last-resort**; `aidlc:wi-jira`; `aidlc:wi-markdown`). Do **not** emit a browser HTML
pusher or write a PAT into any file.

1. **Sprints → iterations.** Create each planned sprint as a tracker iteration (ADO: an iteration
   classification node, via the adapter/`az`); record its path for the stories' iteration field.
2. **Work items, parents first.** `adapter.create(...)` epics → features → stories → tasks, setting
   `parent` as you go, then add `dependsOn` links once sibling children exist. The adapter owns the
   type mapping (canonical epic/story/task → the process's real types — Agile/Scrum/CMMI/Basic; see
   `references/work_item_types.md` for the per-template hierarchy and field names).
3. **Write-verification on every create** — re-fetch and assert the item landed before recording
   success; tolerate eventual consistency, retry with backoff, hard-error on persistent mismatch
   (`aidlc:work-items` → *Write verification*). A reported success is not a persisted success.
4. **Stamp provenance** on every created item — label **`bootstrap`** + a one-line description note:
   `> Provenance: created via /aidlc:bootstrap on <UTC date> from <doc name / "chat brief">.` Use the
   real system clock (`date -u` / `Get-Date`). Later, filtering on `bootstrap` surfaces the initial
   backlog vs. everything added afterward.

---

## 6 · HAND OFF

Report created IDs and counts (epics / features / stories / tasks / sprints), any skipped duplicates,
and any items left unassigned. Then offer one next action:
- "Start the highest-priority ready item? `/aidlc:next`" — or `/aidlc:run <ID>` for a specific one.
- "Work several at once? `/aidlc:sprint N`."

## Rules

- **`/aidlc:init` first** — bootstrap needs the config; never improvise tracker/project/repo values.
- **Propose before create** — a whole backlog is high-blast-radius; approval is mandatory (§4).
- **Dedup honestly** — bootstrapping onto a populated board proposes deltas, not near-duplicates (§2.3).
- **The adapter owns auth, process detection, and field mapping** — don't collect a PAT, an ADO URL,
  or a process template up front, and never push via an embedded-token HTML file. MCP → az → PAT
  (last resort) is the write path (`aidlc:wi-ado`).
- **Team roster is per-run** — used to plan and assign this pass; not written to config.
- **Every item is described; every story has ≥3 testable AC** — the `aidlc:requirements` bar holds at
  bulk scale, not just for single intake.
- **Stamp provenance** (`bootstrap` label + dated note) so the initial backlog stays queryable.
