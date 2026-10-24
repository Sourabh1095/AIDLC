# /aidlc:run — dispatching a parallel window

Read from `aidlc:run` §6 when `resolve-fanout.mjs` returns at least one parallel window. Part of the run
skill, kept apart because most items resolve all-serial.

A **parallel window** means several plan tasks whose declared paths are provably disjoint and which
depend on nothing inside the window. Six screens getting the same treatment is the shape this exists
for. Dispatch them like this:

1. **One batch, N implementers** (`pipeline.implementFanout.maxAgents`, default 3, hard cap 5), each in
   **fan-out mode** (`aidlc-implementer` → *Fan-out mode*): its brief carries **only its own task and its
   own path allowlist**, and says plainly that it must not touch a path outside that list and must
   **not commit**.
2. **You commit, they don't.** This is the whole reason the fan-out is safe: the files are disjoint but
   git is not, and two agents racing `git add`/`commit` in one checkout is the collision D7 is really
   about. As each returns, `git add` **its declared paths** and commit in plan order with the task's own
   message (`aidlc:git-workflow` → *Commits*), then tick its checkbox. A window's bound Tasks sync at its
   closing checkpoint (*Mirror progress to the bound Tasks*, below) — the board write is yours too.
3. **Account for everything before moving on.** Each agent reports the paths it changed *and created*.
   After the window's commits, `git status` must be clean. Anything left over is a path an agent touched
   without declaring — commit it in a clearly-named reconciliation commit and **write it to `## Findings`
   as a fan-out contract violation**, because an undeclared write is exactly what the disjointness proof
   assumed away. Never leave it dirty for the next window to absorb.
4. **The gate runs ONCE, at the end of the window** — not per agent. A window is a partial change by
   construction (screen 2 done, screen 5 not started), so a mid-window gate failure says nothing useful,
   and running the full suite N times is the most expensive way to learn that. Individual agents may run
   narrow checks over their own files; the resolved gate (§7) is the authority.
5. **A `BLOCKED` verdict from any member ends the window.** Commit the clean members, leave the blocked
   task's checkbox unticked with its reason, and treat it as the ordinary blocker path below — do not
   dispatch the next window on top of a half-applied one.
