---
name: dogfood
description: Capture AIDLC-plugin friction hit during a run — gaps, wrong/missing guidance, steps worked around, skill/agent/template bugs (distinct from project bugs) — as a structured entry in a local feedback inbox for the plugin maintainer to triage. Use when you notice the plugin itself (not the project) is the problem, or when the user runs /aidlc:dogfood.
argument-hint: ["<what the plugin should do better>"]
---

# /aidlc:dogfood — plugin self-feedback (dogfood) capture

The AIDLC plugin is meant to work on *any* project. The fastest way to perfect it is to record the
rough edges the moment a real run hits them — instead of relying on a human to notice and relay them.
This skill is that channel: it appends a structured **plugin-friction** entry to a local inbox that
the plugin maintainer drains into the plugin's dogfood-findings log.

## When this runs

- **Automatically (when `pluginFeedback.enabled` is true in `aidlc.config.json`):** whenever you — the
  orchestrator or a dispatched agent — notice the **plugin itself** is the friction during a run,
  capture it. Don't stop the run for it; log and continue.
- **On demand:** the user types `/aidlc:dogfood "<note>"` (works regardless of the flag).

If `pluginFeedback.enabled` is absent/false and this wasn't user-invoked, do **nothing** — normal
projects stay quiet.

## What counts as plugin friction (vs a project bug — get this right, it's the whole value)

**Capture** (the plugin is the problem):
- A step you had to **rediscover or work around** that the plugin should encode (e.g. "ADO PR-merge
  doesn't auto-close the item, had to do it by hand" before that was documented).
- **Wrong, missing, or misleading guidance** in a skill/agent for this tracker/stack/mode.
- A shipped **template/config that's broken or incomplete** (a gate that passes while enforcing
  nothing, a config that fails its own repo's checks).
- The plugin made you **save a per-run step to memory** because it didn't tell you — that's the plugin
  failing to encode something.
- A tool/permission/grant gap that forced a degraded fallback.

**Do NOT capture** (normal work — this is noise):
- A failing test, a real bug, or a missing dependency **in the project's own code**.
- A design/product decision the pipeline correctly surfaced for the user.
- A one-off environment quirk with no plugin implication.

When unsure, capture it with `severity: 🟡` and a one-line "unsure if plugin or project" note — the
maintainer triages; a false positive is cheap, a missed rough edge is not.

## How to capture

1. Resolve the inbox: `pluginFeedback.inbox` (default `.aidlc/plugin-feedback.md`), relative to the
   **control plane** (the workspace root that holds `.claude/`/`.aidlc/`). Create it from the header
   below if absent. **Append only** — never rewrite or reorder existing entries.
2. Timestamp from the system clock (`date -u` / `Get-Date` — never invented).
3. Append one entry in this format:

```markdown
### [<UTC timestamp>] <🔴|🟠|🟡> — <one-line symptom>
- **plugin-area:** <best-guess skill/agent/template + section, or "unknown"> — e.g. `skills/wi-ado/SKILL.md` (status map)
- **context:** <project> · run <ID or "-"> · phase <phase or "-"> · repo <name or "-"> · git.mode <remote|local> · tracker <ado|jira|markdown>
- **symptom:** what happened that the plugin should have handled, or what you had to work around
- **root-cause (guess):** optional one line
- **suggested-fix:** optional one line
- **status:** new
```

The inbox file's header (create once if the file doesn't exist):

```markdown
# AIDLC plugin — feedback inbox (dogfood)

Append-only queue. The pipeline writes plugin-friction entries here when `pluginFeedback.enabled`.
The plugin maintainer drains genuine ones into the plugin's `docs/dogfood-findings.md`, marks each
entry's `status:` (`pulled:F<n>` or `dismissed: <why>`), and **prunes shipped (`pulled`) entries once
their batch merges** so this file stays a short live queue (the permanent record is the
dogfood-findings log). Do not hand-edit others' entries.
```

4. `## Log` a one-liner in the current run file if one is open (`plugin-feedback logged: <symptom>`),
   so the audit trail shows it. Then continue the run — feedback capture never blocks delivery.

## Maintainer side — draining the inbox (runs in the plugin repo, not the consuming project)

The plugin maintainer (working in the plugin repo) collects entries **by reading the consuming
project's inbox file directly from disk** — no copy-paste, no relay. For each `status: new` entry:
1. Decide real-plugin-issue vs not. Genuine ones become a numbered finding in the plugin's
   `docs/dogfood-findings.md` (continue the F-series), matched to the finding format there.
2. Edit the inbox entry's `status:` in place → `pulled:F<n>` (logged) or `dismissed: <one-line why>`.
   This is a maintainer exception to "append only" — the maintainer marks triage state so entries
   aren't re-triaged.
3. Never let a genuine rough edge sit only in the inbox — the inbox is a queue, the dogfood-findings
   file is the record that gets designed + shipped as a batch.
4. **Prune after shipping — keep the inbox a short live queue (F41).** Once the batch containing a
   `pulled:F<n>` entry actually **ships** (versioned + merged), **delete that entry from the consuming
   project's inbox**. The permanent record is the plugin's `docs/dogfood-findings.md` + CHANGELOG, so a
   shipped entry left in the inbox adds nothing — it just makes every future run re-read an
   ever-growing log (a real, recurring token cost). Keep only what's still actionable: `new` (awaiting
   triage) and not-yet-recorded `dismissed` entries. Optionally leave a one-line `<!-- … -->` breadcrumb
   naming the shipped batch + version. This is the second maintainer exception to "append only".
