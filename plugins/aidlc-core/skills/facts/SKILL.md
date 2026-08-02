---
name: facts
description: Project facts (.aidlc/facts.md) — the operational truths this pipeline keeps relearning, each with the date it was last verified. Load before diagnosing an environment failure, before briefing an implementer, or when grounding an answer about how this project actually behaves; write to it whenever a run learns something the hard way.
user-invocable: false
---

# Facts — what this project keeps making us relearn

`.aidlc/facts.md` at the control plane. Tracked in git.

## The gap, precisely

The framework already had four kinds of memory before this, and a fifth needs a reason:

| | holds | answers |
|---|---|---|
| `aidlc.config.json` | machine-readable settings | what the project **is** |
| `docs/adr/` | decisions | **why** the code is like this |
| `.aidlc/journal.md` | events | **what happened**, when |
| `.aidlc/runs/` | per-item pipeline state | one item, in depth |
| `CLAUDE.md` | always-loaded facts, capped ~40 lines | the handful worth spending every token on |

None of them holds *"the integration suite hangs unless `docker compose up db` ran first."* That is
not a decision, not an event, not a setting, and nowhere near important enough to spend always-loaded
context on — and it costs twenty minutes every time somebody rediscovers it.

`aidlc:run` → *Plugin self-feedback* already names the symptom exactly: **"a per-run step you had to
save to memory because the plugin didn't encode it."** That routes *plugin* gaps to the dogfood inbox
and leaves *project* gaps with nowhere to go. This is where they go.

## Reading

**Facts are situational, so they are loaded on demand — never always-on.** D5 caps always-loaded
context, and most facts are irrelevant to most tasks. Load the area you need:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/facts/facts.mjs" list <workspace-root> [area]
```

Areas: `environment` (what must be running/installed/exported) · `gates` (verification quirks: what
is slow, flaky, or lies about success) · `tracker` (board behaviour the adapter cannot infer) ·
`codebase` (non-obvious truths one file will not reveal) · `process` (real team conventions that live
in nobody's config).

Who reads what, and why that specific point:

- **`aidlc:run` §7, before diagnosing a gate failure** — `environment` + `gates`. §7 already
  distinguishes "environment unavailable" from "a regression", and getting that wrong sends a fix
  cycle chasing a missing database. A recorded fact turns that judgment into a lookup.
- **`aidlc:run` §6, in the implementer brief** — `codebase` + `environment`, where relevant to the
  plan's paths. Cheaper than the implementer rediscovering it mid-task.
- **`aidlc:do` §1, grounding** — the whole file is small; read it. It is the difference between
  answering *"can we add this?"* from the code and answering it from how the project actually behaves.
- **`aidlc:debugging`** — before theorizing. A known environmental cause beats a fresh hypothesis.

**Always show a fact's age when you rely on one.** `verified 2026-01-10` next to a claim is what lets
a reader discount it.

## Writing

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/facts/facts.mjs" add <workspace-root> <area> "<fact>" --ref <ID>
```

Write one **when the pipeline learns something the hard way** — a gate that failed for an
environmental reason, a tracker that rejected a transition, a build slow enough to change how work is
scheduled, a code truth that cost real time to find. Not every observation: a fact is something the
*next* run would otherwise pay for again.

**`list` the area before you add to it.** One command, an area is a handful of lines, and it is the
only reliable defence against the duplicate the machine cannot see: the similarity check compares
words, so it catches *"the e2e suite is flaky under parallelism"* restated, but **not** *"the build is
~11 min"* versus *"builds take about eleven minutes"* — same fact, no shared words. Reading five lines
costs nothing; a file of synonym-duplicates stops being read.

Two mechanics worth knowing, because they are the reason this is a script and not a convention:

- **Re-learning a fact refreshes it.** An exact restatement moves the `verified` date instead of
  appending a second copy. That matters more than it sounds: re-learning is *evidence the fact is
  still true*, which is the most valuable thing that can happen to this file, and appending would
  turn that evidence into clutter.
- **A near-duplicate is added but flagged.** The command returns the similar fact; say so and offer to
  merge. It does not merge automatically — two facts that merely look alike are not the same fact, and
  losing one silently is worse than keeping both.

## Staleness

Every fact carries the date it was last verified, and `list`/`stale` compute the age (default
threshold 90 days). **A fact without provenance is a rumour; a stale fact is worse than none, because
it is confidently wrong.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/facts/facts.mjs" stale <workspace-root>
```

`/aidlc:doctor` reports the count. When you rely on a stale fact and it turns out to still be true,
**re-add it** — that is the refresh path, and it is how the file stays trustworthy without anybody
auditing it. When it turns out to be false, delete the line; a correction is not an append here.

## Rules

- **One fact per line, and it must be actionable.** "The build is slow" is not a fact; "the `core-api`
  build is ~11 min, so scope fan-out windows" is.
- **Never record a secret, a credential, a token or an internal hostname.** This file is tracked and
  is one of the first things a new contributor reads.
- **Never record a decision here.** If it has a rationale and alternatives, it is an ADR. Facts are
  observations about how the project behaves, not choices about how it should.
- **Delete freely.** A fact that has stopped being true should leave, not accumulate a caveat. Unlike
  the journal, this file is *not* append-only — it describes the present, and the journal already
  holds the history.
- **A failed write never affects the work.** Every function returns a rejection rather than throwing.
