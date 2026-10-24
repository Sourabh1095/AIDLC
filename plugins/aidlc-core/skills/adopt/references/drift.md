# /aidlc:adopt — 9 · Drift — when this is a re-adoption

Part of the adopt skill: this step, moved out so the skill fits in one read. Read it in full when the scan
reaches this step; every rule in `SKILL.md` (the five rules, the safety contract) still applies here.

If §1 found an existing `aidlc.config.json` (`alreadyAdopted: true`) or a previous
`.aidlc/adoption/profile.json`, this run is not a first contact and a fresh full profile is not the
answer: nobody diffs two thousand-line JSON files by eye. **Read the previous profile before you
overwrite it**, and record the comparison in `drift`.

**The comparison is three-way, and two of the three legs must be handled in opposite directions:**

| Leg | `source` | What it means | `action` |
|---|---|---|---|
| Baseline vs. the code now | `code` | The project moved. The ordinary case | `propose` |
| The code now vs. the config | `config` | Configuration no longer matches reality — a renamed gate command, a package deleted but still registered | `propose` |
| The config vs. **what the last apply wrote** | `human-edit` | Somebody changed it deliberately after adoption. This is **intent the scan cannot see** | **`leave-alone`, always** |

That third row is the one that matters. A hand-tuned gate command, a deliberately narrowed
`securityReviewPaths`, a `mergeStrategy` the team changed on purpose — proposing to "correct" any of
them produces a diff that looks exactly like routine convergence and reverts a decision nobody will
notice in review. Compare against `adoption.appliedAt`: a config value that differs from the baseline
profile's derived value, in a file last applied before it changed, was changed by a person. The
validator pins `source: "human-edit"` to `action: "leave-alone"`.

Three more rules:

- **No baseline, no drift.** `baseline.kind: "none"` means `changes[]` is **empty**. Reporting an
  entire project as "new drift" on first contact is noise that teaches people to skip the section, and
  then the one real change next quarter goes unread. On a first adoption this section says so in one
  line: *this profile is the baseline for next time* — which is why both artifacts are meant to be
  **git-tracked**. An untracked profile leaves a re-scan with nothing to compare against, and that
  degradation must be stated (`baseline.kind: "config-only"`, or `"none"`).
- **A depth change is not drift.** A `quick` baseline re-scanned at `deep` turns dozens of `unknown`s
  into facts — new *knowledge*, not new movement. Set `depthChanged: true` whenever the depths differ
  and say so at the top of the section, or the two changes that really are drift drown in forty that
  are not.
- **An unmanaged surface is reported once, not re-proposed.** Echo the config's `adoption.unmanaged`
  into `drift.unmanaged` and give those surfaces `action: "report-only"`. A pilot on one repo of six
  must stay quiet about the other five, or "not adopted" becomes indistinguishable from "missed".

**`--only <root|package>`** scopes this run: profile the named surface, and record every other root at
its classification with a `scan.skipped` entry (`reason: "out-of-scope"`) so silence about it reads as
*not looked at* rather than *nothing there*. `/aidlc:adopt-apply --only` then records the scope in
`adoption.only` and the exclusions in `adoption.unmanaged`.

**Idempotency is observable here.** A re-scan at the same commit and the same depth must produce
`changes: []`. That empty array is the proof, and it is why the block is present even when nothing
moved — its absence would be indistinguishable from a scan that never looked.
