---
name: journal
description: The workspace journal (.aidlc/journal.md) — durable project memory, one line per event, read back at session start. Load when finishing a command that changed something, or when you need to know what has been happening in this workspace.
user-invocable: false
---

# Journal — what has been happening here

`.aidlc/journal.md` at the control plane. Append-only, one line per event, newest last,
**tracked in git**. It is the answer to the question every new session actually opens with, and the
one the framework could not previously answer at all.

## Why run files were not enough

Run files are excellent memory and the wrong shape for this. Each records **one item** in depth; they
are committed to **feature branches**, so a teammate's is invisible; and completed ones move to
`archive/`. Three properties that are all correct for an audit trail and all wrong for orientation.

So the framework knew, in detail, about the item you happened to be running — and nothing about the
project. A session could not see that a replan re-cut the schedule yesterday, that six direct fixes
landed on `main`, or that the last consult already concluded billing does **not** belong in the API
repo. The cost is not abstract: **the pipeline re-litigates settled questions**, because nothing
remembers they were settled.

The journal is the cheap fix — not a second source of truth. **On any conflict the run file, the
board and the ADR win.** A journal line is a *pointer*: the depth lives in the run file, the ADR or
git history. Duplicating that here would make the file expensive to read at exactly the moment
context is scarcest.

## Format

```
- 2026-08-02T14:02Z `run`     PROJ-124 done · 2 fix cycles · PR #88 · repo=core-api
- 2026-08-02T14:40Z `direct`  fix(header): typo · on main, not pushed
- 2026-08-02T16:15Z `consult` billing in the API repo? → no (ADR-0007), confidence medium
```

`<UTC to the minute>` · `<kind>` · one line. **Do not hand-write these** — the format is parsed by
the SessionStart hook, and an entry that does not parse is an entry nobody reads:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" append . <kind> "<summary>"
node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" tail   . 5
node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" latest . board
```

Always append at the **control plane** (the workspace root), never inside a product repo — the
journal spans repos, and a per-repo journal would fragment exactly the view it exists to provide.
Rotation is automatic at 500 entries into `.aidlc/journal-archive/`.

## Who writes what

The vocabulary is a **closed set** — an unknown kind is rejected rather than written, so the file
stays greppable and the SessionStart reader can prioritise.

| kind | written by | when |
|---|---|---|
| `run` | `aidlc:run` §10 | a run reaches `done` — item, fix cycles, PR or merge sha, repo |
| `blocked` | `aidlc:run` | a run stops needing a human — item, phase, the blocking finding |
| `direct` | `aidlc:do` §5 | a tier-1 change lands — the commit subject and the branch it landed on |
| `tracked` | `aidlc:do` §5 | a tier-2 change lands — branch, what it did |
| `consult` | `aidlc:do` §3 | a CONSULT concludes — **the question and the answer**, not the reasoning |
| `decision` | any | something settled that is real but too small for an ADR |
| `replan` | `aidlc:replan` | a new wave schedule is cut — wave count and the driver, verbatim |
| `board` | `aidlc:status` | after a successful board query — counts and the top ready item |
| `adopt` | `aidlc:adopt-apply` | a profile is applied — what changed |
| `upgrade` | `aidlc:upgrade` | the project catches up with a plugin version |
| `release` | `aidlc:release` | a version is cut — repo, version, tag |

**`board` is how a snapshot reaches a Jira or ADO session at all.** SessionStart cannot query a
tracker — it is a hook, with no tools and no network budget — so before this, everything except the
markdown adapter opened with no sense of the backlog. The `board` line is the tracker-agnostic
substitute, and it carries its own timestamp so staleness is visible rather than assumed.

## Rules

- **One line, and it is a pointer.** If the entry needs a paragraph, the paragraph belongs in the run
  file, an ADR or the commit message, and the journal gets the pointer to it.
- **Write on completion, never on intent.** "Starting PROJ-124" is noise; the run file already tracks
  in-flight state and the hook already surfaces it. Journal what *happened*.
- **A consult entry records the conclusion, not the argument.** *"billing in the API repo? → no
  (ADR-0007)"* is the useful shape. The next session needs to know the question was settled and where
  to read why — re-deriving the reasoning from a summary is worse than re-deriving it from the ADR.
- **Never let a journal failure affect the command.** Every function returns null on failure rather
  than throwing. If the append fails, carry on and say nothing — losing a line of history is not
  worth losing the work.
- **It is not a lock, and not a source of truth.** It is local until committed, like every other
  tracked file, so in shared mode it says what *this clone* has seen. The board remains the
  cross-machine signal (`aidlc:work-items` → *Ownership*).
- **Never edit or delete past entries.** Append-only is what makes it trustworthy. A wrong entry gets
  a corrected one after it.
