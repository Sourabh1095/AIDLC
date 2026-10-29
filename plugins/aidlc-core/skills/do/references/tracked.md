# do — tracked

Part of the `aidlc:do` skill, kept apart so the prompts that do not need it do not load it. Read when §5
picks tier 2 (`aidlc:ceremony`): real work that warrants a branch and a trail, with no ticket.

`aidlc:run` is the full pipeline, and it starts by creating a tracker item, which is exactly what this
tier skips. So a tracked change is done here, in this session, the way a direct one is, with a branch and
a run file added. When the prompt asked for the work, announce the tier and go. When the work came out of
a consult or a diagnosis, wait for the user's go-ahead, as the full pipeline does.

1. **Name it** `local-<slug>`: the change in five words or fewer, lowercased, hyphenated
   (`local-booking-enum-casing`). It is the run file's name, its `item:`, and what you resume it by.
   Never a `{KEY}-{n}`, which would read as a tracker item.
2. **Branch** per `aidlc:git-workflow`, with the name as the ID and no second slug:
   `bugfix/local-booking-enum-casing`.
3. **Run file** `.aidlc/runs/<name>.md` from `${CLAUDE_PLUGIN_ROOT}/templates/run-file.md`, written with
   Write, never the shell: `item: <name>`, `source: none`, `type: task` or `bug`, `branch:`,
   `phase: implement`. `## Item snapshot` is the request in a sentence or two, and `## Plan` is two to six
   lines. Leave the rest of the template as it is.
4. **Do it**: edit, run the project's gate (`aidlc:run` §7 → *The gate*), commit with conventional
   commits, and tick the plan as you go. If it turns out bigger than the plan once you are in the code, or
   an escalation trigger fires (`aidlc:ceremony`), say so and move up to the full pipeline.
5. **Finish**: open a PR only if the repo's convention wants one (`aidlc:git-workflow`). Then `pr:` is its
   link and `phase: review-pending`. Otherwise `phase: done`, and the branch waits for the user to merge
   it. Archive per `aidlc:run-state` → *Archive*.
6. **Journal it**, kind `tracked`: the name, the branch and what it did (`aidlc:journal`).
7. **Keep what it taught**: `aidlc:do` §5 → *After the commit*. The brain and the facts grow here or
   nowhere: most work on a project arrives through this tier, not through a full run.

With no item, every tracker step elsewhere (status cleanup, review feedback) is skipped for this run.
Report in five lines or fewer: the name, the branch, the commits, the gate, and the PR or "not pushed".

**Resuming.** A prompt naming `local-<slug>` is RESUME for a tracked change: read its run file, check out
its branch, and continue from the first unticked plan line, here.
