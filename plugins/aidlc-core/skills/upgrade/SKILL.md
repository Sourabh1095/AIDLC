---
name: upgrade
description: Bring a project's AIDLC files up to the installed plugin version — config shape migrations, permission-rule migrations, rules and CLAUDE.md drift. Shows every change before applying, never overwrites anything a human authored, and stages settings.json rather than editing it. Use after /plugin marketplace update, when /aidlc:doctor reports the config was written by an older plugin, or when a project has been on an old version for a while.
argument-hint: "[--check — report only, change nothing]"
disable-model-invocation: true
---

# /aidlc:upgrade — catch a project up with the plugin

`/plugin marketplace update` updates the **plugin**. It does not touch the **project** — the config,
the permission rules and the rules files that `/aidlc:init` wrote at scaffold time. Those drift, and
until now the only thing that reconciled them was `/aidlc:adopt-apply` §2.1, which is a *brownfield*
command: a greenfield project scaffolded at 0.20 and running on 0.46 had no path at all.

**Why this is a command and not an instruction.** F49 is the whole argument. A release note said
*"remove `Read(./.env)` and `Read(./.env.*)`"*, the two rules were commented out with `//`,
`settings.json` stopped parsing, and Claude Code skipped the entire file — including `enabledPlugins`,
so **every `/aidlc:*` command vanished** while `/plugin` still listed the plugins as installed. The
symptom pointed nowhere near the cause. That finding's own lesson was *prefer pointing users at the
programmatic merge over hand-editing*; this is that merge.

## What it will and will not touch

| File | Treatment |
|---|---|
| `.claude/aidlc.config.json` | **written in place** (after approval) — the pipeline owns this file |
| `.claude/settings.json` | **staged only**, never written. `protect-paths.mjs` blocks the pipeline from editing its own guardrails, and that is correct: a pipeline that can rewrite its permissions has none |
| `.claude/rules/*.md`, `CLAUDE.md` | reported as drift; **a line you authored is never overwritten** |
| `.aidlc/extensions.json` | not this command's business — `/aidlc:sync` reconciles local extensions against the plugin |

## 1 · Plan

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/upgrade/plan-upgrade.mjs" . --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Dry run by default. It reports:

- **Config shape** — `current`, `legacy` (unstamped, classified **by shape**, naming the signal it
  used), `older`, or `newer`. A `newer` config was written by a plugin ahead of the one installed:
  that is a **conflict, not a migration** — migrating downward would silently drop keys this plugin
  does not know about. Update the plugin instead.
- **Config changes**, one line per key that moves. The migration rule is **relocate, never rewrite**:
  a gate command comes out the other side verbatim. `pipeline.gates.ambiguousRequirements` stays
  exactly where it is — it is a requirements-phase policy that `run` §4 reads at that path, and moving
  it under `verify` would silently disable the requirements gate.
- **Permission changes** — removals and warnings itemized (they are what change enforcement),
  additions summarized with a count. `--verbose` lists every one.

Stop here on `--check`. That is a complete, useful outcome: knowing you are three shapes behind is worth
something on its own.

## 2 · Show it and get approval

Present the plan as-is. Two things to say out loud rather than let the user discover:

- **Additions can restore rules the project removed on purpose.** The plan cannot tell "this rule
  predates you" from "I deleted this deliberately", and it does not pretend to. Say so, and say the
  staged file is theirs to edit before applying.
- **The removals are the consequential half.** Each one is either a rule that enforces nothing
  (`Write(<path>)` — file permission checks only ever match `Read(path)` and `Edit(path)`) or the
  pre-0.28 env hard deny, which permanently overrides `pipeline.envFileAccess` and makes that switch
  inert. Neither changes enforcement when removed; the plan says which is which per rule.

Approval is per half. Approving the config and declining the settings is a normal outcome.

## 3 · Apply

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/upgrade/plan-upgrade.mjs" . --plugin-root "${CLAUDE_PLUGIN_ROOT}" --write
```

The config is written and re-parsed before it lands. The settings go to
`.aidlc/staged-claude/settings.json` — **the user applies that themselves.** Tell them plainly:

> Replace `.claude/settings.json` with the staged file. It is **strict JSON**: delete rules outright,
> never comment them out. After the edit, re-read the file and `JSON.parse` it to prove it still
> parses — an unparseable settings file disables every plugin for this project with no error near the
> cause.

Then commit the config change on a branch through the normal gate (`aidlc:git-workflow`); this is
control-plane state, so in poly it commits at the control plane.

## 4 · Drift that is not a migration

Report these; **never apply them silently.**

- **`.claude/rules/*.md`** — diff each against `templates/project/.claude/rules/`. `git-workflow.md`
  says on its face that a line you author is never overwritten by a scan, and the same holds here.
  Where the shipped version gained a rule the project's copy lacks, show that paragraph and offer to
  append it. Where the project's copy diverges because someone edited it, **leave it and say so.**
- **`CLAUDE.md`** — only the AIDLC-authored sections ("AIDLC workflow", "Configuration") are in scope,
  and only to *add* a command the project's copy never heard of. Everything else in that file belongs
  to the project.
- **New commands** the project has never seen. Worth one line — a team on 0.20 has no idea
  `/aidlc:do`, `/aidlc:replan`, `/aidlc:review-feedback` or `/aidlc:doctor` exist, and no amount of
  config migration tells them.

## 5 · Report

```
Upgrade — PROJ (aidlc 0.20.0 → 0.46.0)

config    legacy (pipeline.gates holds steps directly; no configVersion stamp)
          3 keys relocated · gate commands unchanged · written
settings   3 dead rules removed · 118 template rules proposed · staged
          → apply .aidlc/staged-claude/settings.json yourself
rules      git-workflow.md diverged (you edited it) — left alone
           safety.md is 1 paragraph behind — shown above, append? 
new        /aidlc:do · /aidlc:replan · /aidlc:review-feedback · /aidlc:doctor

Next: apply the staged settings, then /aidlc:doctor to confirm.
```

## 6 · Journal it

`node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" append <workspace-root> upgrade "aidlc <from> → <to> · <n> config keys · settings <staged|current>"`
(`aidlc:journal`, kind `upgrade`). An upgrade changes how every later run reads the project, and the
only other record is a `configVersion` bump nobody looks at.

## Rules

- **Never rewrite a value a human authored.** An upgrade relocates keys. If a real value change looks
  unavoidable, that is a conflict to surface, not a migration to perform — the script reports it and
  changes nothing.
- **Never edit `.claude/settings*.json`**, even when the user asks and the fix is obvious. Stage it.
  The path guard blocks it, the guard is right, and the staging path is the supported route.
- **Idempotent.** Running twice changes nothing the second time. If the plan keeps reappearing, the
  staged settings have not been applied — the script says so explicitly rather than re-proposing.
- **`--check` writes nothing at all**, including the config. It is safe on someone else's machine.
- **Run `/aidlc:doctor` afterwards.** It is the independent confirmation that the upgrade landed, and
  it reads the same files from the other direction.
