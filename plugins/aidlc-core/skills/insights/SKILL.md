---
name: insights
description: Read-only outcome metrics for this workspace's pipeline — time to done, fix cycles, findings by source, month by month. Use when asked how the pipeline is doing, whether a change helped, where time goes, or what keeps coming back in review.
argument-hint: "[--since YYYY-MM-DD] [--themes] [--publish]"
---

# /aidlc:insights $ARGUMENTS — is the pipeline getting better?

Every run file records its type, fix cycles, human review rounds, each finding with a severity and a
source, and a timestamped log; finished runs are kept in `runs/archive/`. This command aggregates them.
It writes nothing.

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/insights/insights.mjs" <workspace-root> $ARGUMENTS
```

It reads the control plane, every repo in `repos[]`, their worktrees, and each one's archive. In poly,
a repo that is not checked out on this machine is simply absent — say so if the counts look low. Run
files live on feature branches until they merge, so **another developer's in-flight work is not here**;
the board is the cross-machine truth for that (`/aidlc:status`).

## Reading it

Print the script's output as it is, then add **at most three lines** of interpretation, from these:

| Reading | What it usually means | What to suggest |
|---|---|---|
| reuse findings in many runs | the plans are not finding what exists, or it lives somewhere the catalog does not scan | check `reuse.sharedPaths`; run `catalog.mjs query` for the symbols being re-written |
| human review finds more than the agents | the agents are not looking where people look | `pipeline.verification.reviewer: per-item`; turn a comment that keeps coming back into a rule or a fact |
| fix cycles ≥ 1.5 per run | plans too coarse, or the gate catches what planning should have | `pipeline.planApproval: large`; smaller items at grooming |
| a phase dominating time | that phase is the bottleneck | name it; `verify` dominating usually means a slow gate (`scope: affected`) |
| blocked runs share a cause | an environment or permission problem, not the code | `/aidlc:doctor` |
| gate holes recurring | the project cannot verify something on every run | name the missing gate; adding it is a small item worth filing |

**Cost** appears when the `aidlc-cockpit` mod is installed: what the items in the window cost, the
median per done item, the share by phase and the costliest items. It is Claude Code's own `/cost`
figure, an API-equivalent estimate. On a Claude plan it is not a bill, but it is the best measure of how
much of the plan an item used. It is per machine, from the cockpit's ledger in `.aidlc/logs/costs/`
(`node "${CLAUDE_PLUGIN_ROOT}/skills/insights/costs.mjs" <root>` lists it by item). Without the
cockpit there is no cost line. Say that it was not measured, never that it was free. A phase taking
most of the cost is the place to look first: `pipeline.effort` and `pipeline.verification` are the
dials.

**`--themes`** lists what human reviewers keep asking for — words that recur in review comments across
several runs, with the comments. Each is a convention worth writing down once (a rule, a lint rule or a
fact — `aidlc:review-feedback` → *Teach it once*) so the next run does not need a person to repeat it.

Compare two windows with `--since` when the question is "did the change help": run it once for the
period before the change and once after, and report the difference in one line. With fewer than ~5
runs in a window, say the numbers are too few to mean much rather than reading trends into them.

## `--publish` — the metrics as a page

For someone who does not use Claude Code, publish the readings as a page on claude.ai, exactly as
`aidlc:status` → *Step 5* describes. That means the Artifact tool's `quickstart` with intent `other`,
a privacy note before the first publish, a `share` journal line, and the link kept in
`.aidlc/logs/published.json` under `"insights"` so the next publish updates the same page. The data is
`insights.mjs <root> --json` (plus `--themes --json`), shown as it is: the counts, time to done and by
phase, findings by source, the months, the cost lines when measured, and the readings worth acting on.
Keep the small-sample warning on the page too.
