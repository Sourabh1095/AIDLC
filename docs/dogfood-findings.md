# AIDLC Plugin — Dogfood Findings

**LIVING DOCUMENT.** Log plugin findings here as dogfooding proceeds, then design + implement them
together as a batch through the normal branch → version → merge flow. When a cycle's batch ships,
archive this file into `dogfood-findings-archive.md` (append a new `# … ARCHIVE — Cycle N` section)
and reset this file fresh for the next cycle.

**Severity:** 🔴 blocks/confuses a core flow · 🟠 friction/manual workaround · 🟡 polish.

> **Prior cycles (full record in `dogfood-findings-archive.md`; per-finding change lists in the
> CHANGELOG):**
> - Cycle 1 — **F1–F16** (Epic-1 poly scaffolding) → shipped in marketplace **0.14.0**.
> - Cycle 2 — **F17–F33** (remote/PR + CI + poly shared-config) → shipped in marketplace **0.15.0**.
> - Cycle 3 — **F34–F41** (pipeline reliability + dogfood inbox pruning) → shipped in marketplace
>   **0.18.0** (F34–F40) + **0.18.1** (F41).

---

## Open findings (to implement at the end)

_Numbering continues across cycles — the next finding is **F43**._

### F42 🔴 — Poly: `/aidlc:sprint` worktree launches are dead on arrival (`Unknown command: /aidlc:run`), silently at rc=0
**Symptom.** (RTO Tool, poly, 5 repos, ADO, `git.mode: remote`.) Sprint selected 5 independent items
across 5 repos, created a worktree per item exactly per §2, added `hasTrustDialogAccepted` for each
worktree path in `~/.claude.json` (both slash styles), and launched
`claude -p "/aidlc:run <ID>" --permission-mode acceptEdits` in each. All 5 exited within seconds at
**rc=0**, producing a 28-byte log containing only `Unknown command: /aidlc:run`. No run files, no
commits, no board writes — and because the runs exit 0, the failure reads as success to any caller
checking only the exit code.
**Root cause.** §2 assumed a worktree is a self-contained AIDLC workspace. That holds in mono (the
repo *is* the AIDLC workspace, so `.claude/` + `backlog/` are tracked and ride into the worktree) but
never in poly: AIDLC lives entirely at the control plane — `.claude/settings.json` carries
`enabledPlugins` + the permission allowlist, `.claude/aidlc.config.json` carries tracker + `repos[]`,
plus `backlog/` and `CLAUDE.md` — while the product repos have no `.claude/` at all. A worktree of one
is a bare project: no plugin, no permissions, no config, no backlog, and `repos[].path` values that are
workspace-relative and meaningless inside a single-repo checkout. **Trust does not fix it:** plugin
enablement is a `settings.json` concern; `hasTrustDialogAccepted` in `~/.claude.json` only clears the
trust prompt. Two independent defects: the wrong launch cwd, and a launch step that trusts rc=0.
**Proposed modification.**
- **Poly launches from the control plane with cwd unchanged; no worktree.** This costs nothing —
  `/aidlc:run` already routes every git step to `workspace.root/<repo.path>` (`aidlc:run` §2.5), and
  items in different repos are isolated by construction, so per-repo worktrees add contention risk
  without adding isolation. Seeding a worktree instead was rejected: a product-repo worktree can never
  be a complete AIDLC workspace (no backlog for the markdown adapter, workspace-relative `repos[]`),
  so seeding would mean maintaining a second, degraded workspace shape.
- **Mono keeps worktrees** (the worktree genuinely is the workspace) plus the existing trust step, with
  a note that `.claude/settings.local.json` is gitignored and therefore does *not* ride into a worktree.
- **New §1.3 invariant — one in-flight item per working tree.** Without per-item worktrees, two poly
  items resolving to the same repo (or two `control-plane` items) must serialize; the second queues.
- **New §2b preflight** — deterministic file checks on the launch cwd (config present, `aidlc` enabled
  for that cwd at project or user scope, marketplace known, mono worktree trusted) *before* launching.
- **New §2c launch verification** — a run counts as started only on a run file / real pipeline output,
  never on rc=0. First item launches as a **canary**; dead-on-arrival aborts the sprint instead of
  burning the remaining slots on an identical environment fault.

_Add further findings here as they surface during dogfooding._

## Validated — working as designed (no change needed)

_None yet this cycle._

## Append log

- 2026-07-19 — **F42** logged and shipped on its own (🔴, `/aidlc:sprint` dead on arrival in poly —
  a core flow blocked with a silent rc=0 failure, so it did not wait for the cycle batch).
- 2026-07-17 — Cycle 4 opened. Cycle 3 (**F34–F41**) shipped at marketplace **0.18.0** (F34–F40) +
  **0.18.1** (F41) and its full record was archived to `dogfood-findings-archive.md`; this file reset
  fresh. Log new findings below as dogfooding continues (next id **F42**).
