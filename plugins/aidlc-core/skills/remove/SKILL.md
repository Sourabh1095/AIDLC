---
name: remove
description: Remove AIDLC from this project cleanly — delete the framework's own files, revert only the sections it merged into files the project already owned (CLAUDE.md, .claude/settings.json, .gitignore), and keep everything the team authored, including their ADRs, backlog items and run history. Shows the complete plan and deletes nothing without approval; verifies afterwards that the project's own files are byte-identical to before adoption. Use when an evaluation ends, when a pilot repo is being handed back, or before re-adopting from scratch. This removes AIDLC from the PROJECT; the plugin itself is removed with /plugin uninstall.
argument-hint: "[--dry-run] [--keep <docs|backlog|runs|adoption>]"
disable-model-invocation: true
---

# /aidlc:remove — leave the project as you found it

An evaluation that cannot be undone is not an evaluation. A team trying AIDLC on one repo needs to know
that removing it is a documented step and not an archaeology exercise — and the honest version of that
promise is stronger than "delete `.claude/`", because AIDLC **merged** into files the project already
owned and **created** directories that the team then filled with their own work.

> **The rule everything else serves: deleting a container AIDLC created is not the same as deleting our
> content.** `/aidlc:init` created `docs/adr/`, `backlog/` and `.aidlc/runs/`. What is *inside* them is
> the team's: decision records they will cite for years, work items that are their plan of record, an
> audit trail of what shipped and why. Removing the framework must not remove those, and the reflex that
> would — "AIDLC made this folder, so AIDLC deletes it" — destroys the most valuable thing adoption
> produced. Default to keeping every one of them, and ask.

`--dry-run` prints the whole plan and touches nothing. Offer it first: on a real project this command
should almost always be run twice, once to read and once to act.

## 1 · Establish what AIDLC actually did here

Read, in this order:

1. **`.claude/aidlc.config.json` → `adoption.writes[]`** — the manifest `/aidlc:adopt-apply` wrote:
   one entry per file it touched, with `ownership` (`created` · `merged` · `rendered`) and, for a merged
   file, the **`sections[]`** it added. This is the authoritative answer and makes the rest of this
   command mechanical.
2. **`adoption.commit`** — the commit the scan ran against, which is the closest thing to a
   pre-adoption baseline and what §5 verifies against.
3. **`.aidlc/extensions.json`** — project-local skills and agents. Some were scaffolded by the pipeline;
   some the team wrote themselves, and some were **promoted** upstream and are now duplicated by the
   plugin. They are not interchangeable (§3).
4. **`git log --diff-filter=A`** for each candidate path, where the manifest is silent — the commit that
   added a file usually says plainly whether it arrived with the scaffold or later, by hand.

**No manifest is a supported case, not a blocker.** A project scaffolded by `/aidlc:init` before the
manifest existed, or a greenfield project that never ran adopt, has no `adoption.writes[]`. Then classify
by the table in §2 **and say that you are doing so** — the difference matters, because without a manifest
"which `CLAUDE.md` sections were ours" is an inference rather than a record. Show every merged-file edit
as a diff and let the user confirm each one.

**Check the working tree first.** `git status --porcelain` at the control plane and at every repo. If
there are uncommitted changes, stop and say so: removal deletes files, and an uncommitted edit inside one
of them is unrecoverable. A clean tree also makes §5's verification meaningful.

## 2 · Classify every path into one of three tiers, and treat them differently

| Tier | Paths | Default |
|---|---|---|
| **A · Framework machinery** — ours, no human content | `.claude/aidlc.config.json`, `.claude/rules/git-workflow.md`, `.claude/rules/safety.md`, AIDLC hook scripts, `.claude/aidlc.config.*.example.json`, `.aidlc/adoption/profile.json` | **Delete** |
| **B · Containers the team filled** — ours by creation, theirs by content | `docs/adr/`, `backlog/`, `.aidlc/runs/`, `.aidlc/extensions.json` + the skills it registers, `.aidlc/adoption/report.md` | **Keep**, and ask per directory |
| **C · Merged into files the project owned** | `CLAUDE.md`, `.claude/settings.json`, `.gitignore`, and any stack tooling config `init` merged into (`tsconfig.base.json`, `eslint.config.mjs`, …) | **Revert our sections only** |

Tier B is where judgement is required, so make the consequence explicit rather than offering a bare
choice:

- **`docs/adr/`** — keep. These are the project's architecture decisions and they are true whether or not
  AIDLC is installed. A retroactive ADR from `/aidlc:adopt-adr` is *especially* worth keeping: it records
  a decision that had no record before. Offer deletion only if the user asks, and say what they lose.
- **`backlog/`** — keep when `workItems.source` is `markdown`: it **is** the tracker, and deleting it
  deletes the team's work items. (With Jira or ADO the directory is usually near-empty and deletion is
  harmless — check before assuming.)
- **`.aidlc/runs/`** — keep. It is the audit trail of what was built and why, and on a regulated project
  it may be evidence somebody is required to retain.
- **`.aidlc/adoption/report.md`** — keep. It documents facts about *their* code — the coverage holes, the
  runtime constraints, the redacted secret findings — and every one of those outlives the framework. If
  it records a `committed-secret` finding, **say so out loud here**: deleting the report does not rotate
  the credential, and it is the only place the location is written down.
- **`.claude/skills/` and `.claude/agents/`** — split them. A skill the pipeline scaffolded is ours; a
  skill the team wrote is theirs; a skill that was **promoted** upstream now also lives in the plugin, so
  deleting the local copy is what `/aidlc:sync` would have done anyway. Read `.aidlc/extensions.json`,
  list each with its origin, and default to keeping anything you cannot attribute.

## 3 · Revert the merged files — sections, not files

For each tier-C file, produce the reverted content and **show it as a diff**:

- **`CLAUDE.md`** — remove the sections `adoption.writes[].sections` names (the AIDLC workflow pointers,
  the `## Commands` block, the project-facts bullets adoption filled). **Every other line stays**,
  including a line a human edited *inside* one of our sections — if a section is not byte-identical to
  what adoption wrote, do not delete it silently: show it and ask, because the difference is somebody's
  edit. If removing our sections would leave the file empty and the file did not exist before adoption,
  it is tier A after all — say so, and delete it.
- **`.claude/settings.json`** — remove the `enabledPlugins` entry for the aidlc plugins, the AIDLC hook
  registrations, and the `permissions.allow`/`deny` entries adoption added. **Union-added arrays are
  reverted by subtraction, never by replacement:** remove exactly the entries in `sections[]` and keep
  every entry the team added themselves. If the file did not exist before, delete it — but say plainly
  that this drops the project's permission posture for **every** tool, not just ours, and let the user
  choose. Claude Code guards this file at the harness level, so the write will prompt regardless.
- **`.gitignore`** — remove the AIDLC block and nothing else.
- **Stack tooling** (`tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig`,
  `.dependency-cruiser.cjs`, the enterprise skeleton) — these are the **most dangerous** to remove,
  because by now the project's own code depends on them: deleting a tsconfig breaks the build, and the
  skeleton is where their source lives. **Default to keeping all of it**, list what came from
  `aidlc-stack-web`, and let the user decide. Never delete a directory containing source files.
- **`rules/git-workflow.md`** is `rendered` — delete it, but if it differs from what was last rendered,
  somebody edited it: show the diff first.

## 4 · Show the plan, get approval per tier, then act

1. **Print the complete plan**, grouped by tier, with a count and a one-line consequence per group.
   Tier B entries show what would be lost, not just what would be deleted.
2. **Approve per tier**, not once for everything. "Delete the machinery, keep the ADRs and the backlog"
   is the common answer and must be easy to give. `--keep <docs|backlog|runs|adoption>` pre-answers it.
3. **Never `git clean`, never `rm -rf` a path you have not listed, and never delete anything outside the
   printed plan.** If you discover something mid-run that was not in the plan, stop and re-propose.
4. **Do not commit and do not branch.** Delete the files, then leave the change in the working tree:
   removing a framework is a change the team reviews like any other, and `git checkout .` is their undo
   if they change their mind.
5. **`.aidlc/` and `.claude/` themselves** — remove the directories only when they are empty afterwards.
   A leftover empty folder is untidy; a deleted folder holding one file somebody wanted is not.

## 5 · Verify, then report

Verification is the point of the manifest, so do it rather than asserting it:

1. **`git status --porcelain`** — show the user the real change set. Every path in it must appear in the
   approved plan. Anything else is a bug in this command; say so instead of moving on.
2. **`git diff <adoption.commit> -- <every path NOT in the plan>`** must be empty for the project's own
   files. That is the actual promise this command makes — *the project's files are as they were* — and it
   is checkable in one command rather than asserted. Where `adoption.commit` is unavailable (no manifest,
   or a shallow history), say that verification was not possible rather than implying it passed.
3. **Confirm the plugin is still installed.** This command removed AIDLC from the *project*; the plugin
   remains at user scope. `/plugin uninstall aidlc@bee-logical` is the separate step, and `/aidlc:` will
   keep answering until it runs — which is a feature if the user is removing in order to re-adopt.

Then report, in this order: what was deleted · what was reverted, by section · **what was kept and why**
(the most useful line, because it is what the team keeps) · what could not be verified · and, if the
adoption report recorded a secret finding, that rotating it is still outstanding.

## 6 · What this command does not do

- It does **not** uninstall the plugin, remove the marketplace, or touch `~/.claude/`. Project scope only.
- It does **not** delete work items from Jira or ADO. Items adoption created are labelled `adopted`;
  closing or deleting them is the team's call in their own tracker, and doing it from here would be an
  irreversible write to a system this command has no mandate over. Say how to find them.
- It does **not** revert commits. Files adoption wrote are already in the project's history; removing
  them now is a new change, not a rewrite of the old one.
- It does **not** remove a repo from a poly workspace — that is a config edit, not a removal.
