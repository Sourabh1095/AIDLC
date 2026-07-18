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

_Numbering continues across cycles — the next finding is **F45**._

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

### F43 🔴 — Poly: F42's control-plane launch makes every git call `git -C <path> …`, which matches no allow rule — first run blocks on permissions
**Symptom.** (RTO Tool, poly, ADO, `git.mode: remote`, run RTO-9118.) With F42 applied the canary
launched correctly, resolved `/aidlc:run`, fetched the item and routed to `core-api` — then stopped
dead before any write: *"every `git -C "D:/RTO Tool/core-api" ..." call and `az rest` is returning
'requires approval'."* Nothing written, board never touched. Corroborating: `az boards` worked while
`az rest` did not — exactly matching which patterns are and aren't in the allowlist.
**Root cause.** The template allowlist was entirely **bare-verb prefixes** (`Bash(git status:*)`, …).
`aidlc:run` §2.5 said poly steps run "with cwd = `<repo.path>`", which would keep git calls bare and
matching — but F42 pins the launch cwd at the control plane and the session cwd can't be changed, so
the natural implementation is `git -C <repo.path> <verb>`, matching **no** rule. F42 didn't introduce
the defect, it moved the wall one step later: pre-F42 the run couldn't start; post-F42 it starts and
then can't touch git. Every poly item hits this identically on its first git call. Separately,
`wi-ado`'s work-item-type states API needs `az rest`, which was absent from the template entirely.
**Resolution — `git -C` (allowlist widened, denies mirrored), not `cd &&`.** The reporter proposed
mandating `cd <repo.path> && git …` to keep bare-verb rules matching, calling it the safer option. It
does not work: Claude Code prompts for *any* compound command that `cd`s into a **different**
directory and then runs `git`, regardless of the allowlist, because git in a new directory can execute
that directory's hooks. That fix would have reproduced the same wall. So:
- **Template allows the poly verbs in `-C` form** (`Bash(git -C * status:*)` …) alongside the bare
  forms mono still uses. A bare `Bash(git -C:*)` was rejected as the reporter's security concern is
  correct — but the concern does **not** block the fix, because Bash rules support **mid-pattern
  wildcards**, so the denies mirror exactly: `Bash(git -C * push --force:*)`, `… -f`, `… reset --hard
  origin`, plus `Bash(git -C * rebase:*)` in `ask`.
- **Pre-existing deny gap closed while here:** `Bash(git push --force:*)` never matched
  `git push origin --force` (flag after the remote). Added `Bash(git push * --force:*)` / `-f` and the
  `-C` equivalents, in both forms.
- **Added `Bash(az rest:*)`.**
- **`aidlc:run` §2.5 now states the mechanism per command family** instead of the ambiguous "cwd =
  `<repo.path>`" that caused this: git → `git -C`; npm/docker/test/lint → `cd "<path>" && <cmd>` (a
  `cd` under the workspace root is read-only and each half matches independently, so bare rules keep
  applying — and note `npm --prefix` would miss the allowlist the same way `git -C` did); `gh`/`az
  repos` → pass the repo explicitly. Mono is unaffected: its cwd already is the repo.

### F44 🟡 — Template's `Write(...)` deny rules are no-ops and warn on every headless run
**Symptom.** Every headless run prints at startup: *"Permission deny rule (.claude\settings.json):
`Write(.claude/settings.local.json)` is not matched by file permission checks — only `Edit(path)` rules
are."* The adjacent `Edit(...)` deny is correct; the `Write(...)` one enforces nothing.
**Root cause.** Template authored assuming `Write(path)` is separately enforceable. Documented
behavior: file permission checks match only `Edit(path)` and `Read(path)`; a `Write(path)` rule is
accepted but never matched, and `Edit` already covers all file-editing tools including `Write`.
**Resolution.** Dropped both `Write(...)` denies — the reporter flagged
`Write(.claude/settings.local.json)`, but the identical no-op existed one line above at
`Write(.claude/settings.json)` and would warn the same way. The two `Edit(...)` denies already cover
both files, so enforcement is unchanged. Noise, not a functional hole.

_Add further findings here as they surface during dogfooding._

## Validated — working as designed (no change needed)

_None yet this cycle._

## Append log

- 2026-07-19 — **F42** logged and shipped on its own (🔴, `/aidlc:sprint` dead on arrival in poly —
  a core flow blocked with a silent rc=0 failure, so it did not wait for the cycle batch).
- 2026-07-17 — Cycle 4 opened. Cycle 3 (**F34–F41**) shipped at marketplace **0.18.0** (F34–F40) +
  **0.18.1** (F41) and its full record was archived to `dogfood-findings-archive.md`; this file reset
  fresh. Log new findings below as dogfooding continues (next id **F42**).
