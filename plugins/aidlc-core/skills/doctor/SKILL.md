---
name: doctor
description: Diagnose an AIDLC workspace before it wastes a run — config, settings, plugin enablement, permission rules, repo paths, hook scripts, run files, tracker reachability, host CLI auth and CI gating. Read-only; reports problems with the exact remediation. Use when /aidlc:* commands are missing or misbehaving, when a run blocks on permissions, after installing or updating the plugins, or when onboarding a machine.
argument-hint: "[--quick — deterministic file checks only, no network]"
---

# /aidlc:doctor — is this workspace actually able to run?

**Read-only. This command writes nothing** — not config, not settings, not the tracker. It reports
problems and the exact fix; applying it is the user's call, and for `settings.json` it has to be
(`protect-paths.mjs` blocks the pipeline from editing its own guardrails, correctly).

**Why this exists.** Five of the framework's eight most recent 🔴 findings were *environment* faults,
not pipeline faults — and each announced itself as something else:

| Finding | What the user saw | What was actually wrong |
|---|---|---|
| F42 | `Unknown command: /aidlc:run`, **at rc=0** | the plugin was not enabled for that cwd |
| F43 | every git call "requires approval" | poly runs use `git -C`, which no allow rule matched |
| F45 | rules verified present, still nothing ran | the rules matched nothing — allow *and* deny |
| F49 | all `/aidlc:*` commands vanished | a `//` comment made `settings.json` unparseable |
| F6 | branches that didn't line up | control plane on `master`, config said `main` |

Every one is visible in a file, before a run starts. The pattern worth naming: **an environment fault
looks like a pipeline bug**, so it gets debugged in the wrong place — F49 cost a session chasing an
unrelated stale marketplace error. Run this first.

## 1 · Deterministic checks — run the script, don't hand-derive it

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/doctor/diagnose.mjs" . --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

It reads files only — no network, no subprocesses, never throws — and covers: Node version · config
presence/parse/required keys · config provenance vs the installed plugin · whether a verify gate is
declared · the `envFileAccess` value · `team.mode: shared` on the markdown adapter · the tracker
`statusMap`/`fieldMap` shapes (an entry the adapter cannot match is silently ignored, so a typo reads as
a config that was honoured) · every settings file parsing as **strict JSON** (F49) · **plugin enablement** at project and user scope with the
marketplace known (F42) · **permission-rule shapes** (F44/F45/F48, via the same `lint-rules.mjs` the
marketplace's own CI uses) · **`git -C` coverage in poly** (F43) · each declared repo path resolving to
a real git repo · the control-plane `.gitignore` ignoring every product repo by path (the gitlink trap)
· every hook script the plugin registers existing on disk · every run file parsing with a valid phase.

Report its output as-is. `--json` gives the same result machine-readably if you need to reason over it.

**A `[FAIL]` on plugin enablement or settings parse makes everything below meaningless** — say so and
stop there. A session that cannot load the plugin cannot be diagnosed further, and the remaining checks
would describe a workspace nobody is running.

## 2 · Live checks — what a file read cannot answer

Skip this whole section on `--quick`. Each item names its home rather than restating the recipe.

1. **Tracker reachable and authenticated** — follow `aidlc:status` → *Tracker doctor*. A registered MCP
   showing `connected` does **not** prove reachability: ADO authenticates on the first call and fails
   opaquely when the launch environment is wrong. Do the cheap probe, and on failure print the root
   cause (`ADO_MCP_ORG` set **and** `az login` accessible **in the shell that launched Claude Code** —
   relaunch if `az` was installed mid-session), not the raw error.
2. **Host CLI authenticated** — `gh auth status` for `host: github`, `az account show` for
   `azure-repos`, once per distinct host in the repo registry. This is where a run discovers it cannot
   open a PR, and it discovers it *after* branching, implementing and verifying.
3. **MCP tool names** (F47) — list the actual `mcp__*` tool ids available this session. A headless run
   with no `mcp__*` allow entry falls back to the `az`/`gh` CLI tier **by design**, so report that as
   working, not gated. Never guess a prefix: a bare `mcp__*` allow rule is skipped with a warning and
   grants nothing, and guessing permission patterns unverified is exactly what caused F43 and F45.
4. **CI actually gates the PRs** — follow `aidlc:status` → *Remote-repo gate check* per `mode: remote`
   repo. A remote repo with no required check merges ungated, which silently voids remote mode's whole
   promise (the human PR gate is the one gate D6 keeps).
5. **Git identity and branch sanity** — `user.email` set (commits are unattributable without it), and
   the **control plane's own branch matches `git.defaultBranch`** (F6: a `master` control plane under a
   config that says `main` misroutes every `control-plane` item). In poly, confirm the control plane is
   a git repo at all — without one, rule-0 routing has nowhere to commit and the backlog carries no
   history.
6. **The gate commands exist** — for each resolved gate step, check the runner is installed (the
   binary/script resolves), **without running the suite**. Do not execute the gate here: doctor is fast
   and read-only, and a 12-minute test run is neither.
7. **The tracker schema maps still match the board** (jira/ado only) — the script already lints the
   *shape* of `statusMap`/`fieldMap`; only a live probe can tell whether they name states and fields the
   board actually has. Probe the types in the config's maps (`aidlc:work-items` → *Schema discovery*) and
   report any entry the board does not have, plus any canonical field the maps have never resolved.
   **Report it, do not fix it** — a self-heal is a config write and this command writes nothing; the
   adapter reconciles on its next run. Both faults are silent at runtime: a stale entry is ignored and
   re-probed, so the config looks honoured while the board is being driven by something else. Skip
   entirely when the tracker is unreachable (item 1 already said so) — a probe that cannot run is not a
   finding about the maps.

## 3 · Report

One board, failures first, each with its remedy. End with the single most useful next action.

```
AIDLC doctor — <workspace>            2 failing · 3 warnings · 14 ok

FAIL  plugin enablement    no `aidlc@…` in enabledPlugins (project or user scope)
      → /plugin install aidlc@bee-logical. Until then this workspace has no /aidlc:*
        commands, and a headless run exits rc=0 — the failure reads as success.
FAIL  poly git permissions  repos[] declared, no `Bash(git -C …)` allow rule
      → re-run /aidlc:init to stage the current template's rules (F43).
warn  verification gate     no pipeline.gates.verify — will fall back to CLAUDE.md
      → /aidlc:adopt then /aidlc:adopt-apply records the project's real gate.
warn  tracker               ADO reachable but ADO_MCP_ORG unset in the launch shell
      → set it and relaunch Claude Code; `az boards` works meanwhile.

Next: fix plugin enablement — nothing else can be trusted until it loads.
```

## Rules

- **Read-only, always.** No config writes, no settings writes, no tracker writes, no `git` mutations.
  A diagnosis that changes the thing it is diagnosing cannot be re-run to confirm the fix.
- **Never edit `.claude/settings*.json` to "fix" a finding**, even when the fix is obvious and the user
  asks. The path guard blocks it and that is correct — permission posture is human-managed. Print the
  exact edit and let them apply it. Say plainly that `settings.json` is **strict JSON**: delete a rule
  outright, never comment it out (F49), and re-read the file afterwards to prove it still parses.
- **Report a not-a-problem as ok, not as a gap.** A headless ADO run on the `az` CLI tier is working as
  designed (F47); flagging it teaches people to ignore this command. The value of a doctor is entirely
  in its signal-to-noise.
- **Name the file and the line to change.** "Permissions look wrong" is not a diagnosis. Every finding
  the script emits already carries a remedy — pass it through rather than paraphrasing it away.
- **Do not run the project's test suite.** Checking a gate step's runner exists is in scope; executing
  the gate is `/aidlc:run` §7's job.
