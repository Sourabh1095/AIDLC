---
name: debugging
description: The SDLC bug protocol — reproduce first, failing test, isolate root cause, minimal fix, regression sweep. Load when working on any bug-type work item or diagnosing a failure during a run.
user-invocable: false
---

# Debugging — the bug pipeline protocol

Order is the protocol. Skipping step 1 is how "fixes" ship that fix a different bug.

## 1 · Reproduce (QA agent, before any fix)

- Turn the report into a minimal failing test. Real repro > described repro: follow the item's
  steps against the actual code path.
- Confirm the failure MESSAGE matches the report. Wrong failure = wrong bug — go back to the item.
- Can't reproduce? Do not guess-fix. Report what you tried, ask for environment details via the
  work item; verdict BLOCKED.
- **Environment-specific failure (CI red but local green)? Reproduce in the CI _image_ before
  iterating (F31).** Don't loop push→wait→read-log against remote CI — brutal when a single
  self-hosted agent serializes runs. `docker run` the CI runtime (e.g. `node:22`) and replicate the CI
  layout — an **isolated single-repo checkout** + `npm ci` + the failing step — and get it green in the
  container first. This is the only way to reproduce poly isolated-checkout + `file:` sibling failures
  (F28) and cross-platform lockfile failures (F29). See `sdlc:ci-cd` → *Diagnosis protocol*.
- **Suspected line-ending bug? Confirm before you claim it (F17).** CRLF-vs-LF is easy to
  misdiagnose (a wrong "the files are CRLF" finding costs a correction cycle). Check the truth with
  `git ls-files --eol <path>` (`i/`=index, `w/`=working tree, `attr/`=applied `.gitattributes` rule)
  before logging any line-ending finding. A repo with `* text=auto eol=lf` and `i/lf` is LF — a CRLF
  working tree is just an un-normalized local checkout, not a real diff.

## 2 · Isolate root cause (implementer)

- Read the failing path; trace data, not vibes. `git log -p` / `git bisect` when the bug is a regression.
- Distinguish root cause from symptom site: where the bad value is *produced*, not where it *explodes*.
- State the root cause in one sentence in the run file before fixing. If you can't, you haven't found it.

## 3 · Fix minimally

- Fix the cause, not the symptom. No drive-by refactors in a bugfix branch.
- If the true fix is large/architectural: apply the safe minimal fix now, and create a follow-up
  work item (via the adapter) for the real one — link them.

## 4 · Regression sweep

- The repro test passes; the FULL suite passes.
- Ask: where else does this same pattern live? Grep for siblings of the bug (same misuse of an
  API, same missing guard) — fix trivial siblings, file items for non-trivial ones.
- Add boundary tests around the fixed behavior beyond the single repro.

## Run-file notes

`## Log` records: repro test path → root cause (one sentence) → fix commits → sweep result.
The PR body's summary states the root cause — reviewers approve causes, not diffs.
