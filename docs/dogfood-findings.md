# SDLC Plugin — Dogfood Findings

**LIVING DOCUMENT.** Log plugin findings here as dogfooding proceeds, then design + implement them
together as a batch through the normal branch → version → merge flow. When a cycle's batch ships,
archive this file (e.g. `dogfood-findings-archive.md`) and reset it fresh for the next cycle.

**Severity:** 🔴 blocks/confuses a core flow · 🟠 friction/manual workaround · 🟡 polish.

> **Prior cycles:** Cycle 1 (**F1–F16**, Epic-1 scaffolding) shipped in marketplace **0.14.0** —
> full record in `dogfood-findings-archive.md`, per-finding change list in the CHANGELOG.

---

## Open findings (to implement at the end)

_(Numbering continues from Cycle 1's F1–F16 — see `dogfood-findings-archive.md`.)_

### F17 🟡 — Scaffold ships no `.gitattributes` (eol=lf) → Windows CRLF/LF churn + agents mis-diagnose line endings
**Symptom.** On AUTH-8420 the implementer logged a **CRLF finding that was wrong** — the files are LF —
costing a correction cycle. Separately, git emits `LF will be replaced by CRLF` on nearly every file
touch across these repos (and the plugin repo). There is no line-ending normalization anywhere.
**Root cause.** The stack-web tooling scaffold ships a hardened `.gitignore` (F14) but **no
`.gitattributes`**. On Windows, without `* text=auto eol=lf`, working-tree endings churn and agents
misattribute genuine-or-phantom format differences to line endings.
**Proposed modification.** Ship a `.gitattributes` (`* text=auto eol=lf` + sensible `-text` binary
rules) in `sdlc-stack-web/templates/tooling/` and add it to the repo-scaffold checklist (sibling of
F14). Optionally, a one-line agent note: verify LF vs CRLF via `git ls-files --eol` before ever logging
a line-ending finding.

### F18 🟡 — Scaffolded repos merged with a failing `prettier --check` (format not enforced repo-wide at scaffold)
**Symptom.** ~17 files from the AUTH-8416 scaffold fail `prettier --check` (genuinely unformatted — not
line-endings) yet were merged; the dirt surfaced only when a later story (AUTH-8420) ran format
repo-wide. The scaffold "merged never-clean."
**Root cause.** The scaffold didn't leave the repos format-clean, and/or the deterministic gate's
**format** step wasn't enforced **repo-wide** during scaffolding, so format-dirty files passed the
merge gate (no CI in local mode to catch it either).
**Proposed modification.** (a) Scaffold should run `prettier --write .` (or the gate should run
`prettier --check .` and block) so a freshly scaffolded repo is format-clean at first merge; (b) confirm
`init`/scaffold wires a `format:check` (prettier) into the enforced gate, not just eslint. **Verify at
implementation time** whether the shipped template files themselves are prettier-clean under the shipped
`.prettierrc.json`. (Project-side: the ~17 dirty files are a `prettier --write .` maintenance item, not
a plugin change.)

## Validated — working as designed (no change needed)

- ✅ **Economical cadence held on a real feature story (AUTH-8420, size L):** the per-epic **security**
  pass was correctly **deferred** (owed at Feature 8415 / Epic 8414 close), not skipped — cadence
  working as designed; the deterministic gate independently re-verified green (type-check/lint/test
  9/9) and 7 assumptions were logged. First non-scaffold story delivered through the pipeline.

## Append log

- 2026-07-12 — Cycle 2 opened. From AUTH-8420 (identity schema, first non-scaffold story): logged
  **F17** (missing `.gitattributes`/eol → CRLF mis-diagnosis) and **F18** (scaffold merged
  prettier-dirty). Deferred per-epic security = working-as-designed (not a finding). Separately: the six
  `bee-auth-*` repos were pushed to Azure Repos and the workspace flipped to `git.mode: remote` — the
  remote/PR integration path is now first under test (watch the next `/sdlc:run` for remote-mode
  findings).
