# SDLC Plugin — Dogfood Findings

**LIVING DOCUMENT.** Log plugin findings here as dogfooding proceeds, then design + implement them
together as a batch through the normal branch → version → merge flow. When a cycle's batch ships,
archive this file into `dogfood-findings-archive.md` (append a new `# … ARCHIVE — Cycle N` section)
and reset this file fresh for the next cycle.

**Severity:** 🔴 blocks/confuses a core flow · 🟠 friction/manual workaround · 🟡 polish.

> **Prior cycles (full record in `dogfood-findings-archive.md`; per-finding change lists in the
> CHANGELOG):**
> - Cycle 1 — **F1–F16** (Epic-1 poly scaffolding) → shipped in marketplace **0.14.0**.
> - Cycle 2 — **F17–F33** (remote/PR + CI + poly shared-config) → shipped in marketplace **0.15.0**.

---

## Open findings (to implement at the end)

_Numbering continues across cycles — the next finding is **F42**._

### Implemented — batch F34–F40 (shipped in marketplace **0.18.0**, merged `--no-ff` d6a1eef)

Drained from the Authentication inbox (`.sdlc/plugin-feedback.md`) on 2026-07-17. Per-finding change
lists are in the CHANGELOG under **[0.18.0]**.

- **F34 — 🟠 groom sweep silently capped below the real backlog.**
  - *area:* `groom` (sweep protocol) · `work-items` (`query` contract) · `wi-ado`/`wi-jira`/`wi-markdown`.
  - *symptom:* sweep opened at `query({status:"todo", limit:25})`; a ~120-item backlog was ~20% refined and reported "groomed."
  - *fix:* new *Full-backlog sweeps* contract — `limit` is a page size, not a silent cap; count-first, then page to completion or state the cap out loud; adapters page rather than hard-cap.
- **F35 — 🟠 human-approval gate couldn't be delivered to the analyst subagent.**
  - *area:* `groom` (Autonomy boundaries / Report).
  - *symptom:* a fresh analyst subagent refused to act on the coordinator's *claim* of user consent (correctly — a peer's claim of consent isn't consent), leaving no path for approval to reach it.
  - *fix:* gated actions are applied by the **coordinator** post-approval; the analyst sweep is propose-only for them. No subagent re-dispatch as executor.
- **F36 — 🟠 remote run merged un-archived had no clean archival path (F23 guard-blocked).**
  - *area:* `run` §10 · `run-state` (Archive) · `git-workflow`.
  - *symptom:* a blocked→resolved-via-follow-up-PR run rode into `main` still `phase: blocked`; archiving needed a forbidden direct-to-`main` commit, so it lingered as a blocked active run.
  - *fix:* fold the archive into the resolving PR (already-archived at merge); remote post-merge fallback is a `chore(sdlc): archive` branch → PR — never a direct push to a protected branch (guard stays strict).
- **F37 — 🟠 implementer returned an incomplete non-verdict and left uncommitted state.** *(root cause of F40)*
  - *area:* all agents + agent-template (finish contract) · `run` orchestrator invariants.
  - *symptom:* implementer returned "waiting for a background CI check" instead of a verdict, leaving a regenerated lockfile + run-file edits uncommitted for the orchestrator to finish.
  - *fix:* shared `## Finish contract` on all agents — block on the background task or return an explicit `BLOCKED`/`INCOMPLETE` verdict enumerating pending state; verify → commit → report, synchronously.
- **F38 — 🟡 no encoded recipe to ground-truth CI parity of a `file:`-sibling consumer.**
  - *area:* `ci-cd` · `run` §7.
  - *symptom:* reconstructing the CI gate for a `file:../` consumer needs a two-step sibling install; a first attempt gave a FALSE GREEN via an `&& echo OK` tail masking a non-zero exit under `set -e`.
  - *fix:* shipped *Local CI-parity for a `file:`-sibling consumer* — sibling `npm ci` first, then consumer; run in the CI image; each gate step's exit code stands on its own (no masking tail).
- **F39 — 🟠 batch post-merge archival in poly+remote = one branch+PR per repo AND blocked by husky.**
  - *area:* `status` (post-merge cleanup) · `git-workflow`.
  - *symptom:* cleanup of merged-but-un-archived runs cost one PR per repo, each archive commit blocked by the repo's husky `lint-staged` hook (no `node_modules`), and a hook-aborted commit still left an empty pushed branch.
  - *fix:* `status` warns of the per-repo PR cost upfront; `.sdlc/**`-only bookkeeping commits use `--no-verify`; `git-workflow` requires verifying a commit landed before pushing.
- **F40 — 🟠 RECURRENCE (devops): same non-verdict-on-background-task pattern as F37.**
  - *area:* `sdlc-devops` + the shared finish contract (F37).
  - *symptom:* devops (CI-gate implement) repeatedly returned a bare "still running" instead of a verdict — confirming F37 is a cross-agent contract gap, not one agent's prompt.
  - *fix:* covered by the shared finish contract; devops additionally must poll a CI/pipeline run to a terminal state itself.

### Implemented — F41 (shipped in marketplace **0.18.1**)

- **F41 — 🟡 dogfood inbox grows unbounded; shipped entries get re-read every run.**
  - *area:* `dogfood` (maintainer drain section + inbox header template).
  - *symptom:* drained `pulled:F<n>` entries stayed in a consuming project's inbox after their batch shipped, so every future run there re-read an ever-growing log — a recurring token cost. Raised directly (not via the inbox) while cleaning the Authentication inbox after F34–F40 shipped.
  - *fix:* the maintainer prunes shipped `pulled` entries once their batch merges; the inbox is a short live queue and the permanent record is `docs/dogfood-findings.md` + CHANGELOG. Documented as the second maintainer exception to "append only"; inbox header template updated. Authentication inbox pruned (F34–F40).

## Validated — working as designed (no change needed)

_None yet this cycle._

## Append log

- 2026-07-14 — Cycle 3 opened. Cycle 2 (F17–F33) shipped at marketplace **0.15.0** and its full record
  was archived to `dogfood-findings-archive.md`; this file reset fresh. Log new findings below as
  dogfooding continues (next id **F34**).
- 2026-07-17 — Batch **F34–F40** drained from the Authentication inbox and implemented (reliability
  hardening: subagent finish-contract, sweep pagination, groom approval path, remote/poly archival,
  CI-parity recipe). Shipped at marketplace **0.18.0** (`sdlc` 0.17.0 → 0.18.0). Inbox entries marked
  `pulled:F<n>`. Next id **F41**. Archive this file to `dogfood-findings-archive.md` once the batch
  merges and Cycle 3 closes.
- 2026-07-17 — Batch F34–F40 **merged to main** (`--no-ff` d6a1eef, marketplace 0.18.0). Then **F41**
  (dogfood inbox pruning lifecycle) implemented + shipped at marketplace **0.18.1**, and the
  Authentication inbox was pruned of its shipped F34–F40 entries (record preserved here + CHANGELOG).
  Next id **F42**.
