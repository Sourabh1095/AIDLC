---
name: insights
description: Outcome metrics for the AIDLC pipeline in this workspace — runs done/blocked/awaiting review, time to done and per phase, fix cycles, findings by source (reuse/duplication, agent review, human review, QA, security, design, gate holes), month by month, plus the few readings worth acting on. Read-only. Use when asked how the pipeline is doing, whether a change to it helped, where time goes, or what keeps coming back in review.
argument-hint: "[--since YYYY-MM-DD] [--themes]"
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

**`--themes`** lists what human reviewers keep asking for — words that recur in review comments across
several runs, with the comments. Each is a convention worth writing down once (a rule, a lint rule or a
fact — `aidlc:review-feedback` → *Teach it once*) so the next run does not need a person to repeat it.

Compare two windows with `--since` when the question is "did the change help": run it once for the
period before the change and once after, and report the difference in one line. With fewer than ~5
runs in a window, say the numbers are too few to mean much rather than reading trends into them.
