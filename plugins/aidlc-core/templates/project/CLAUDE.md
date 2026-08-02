# {{PROJECT_NAME}}

<!-- Keep this file under ~40 lines. Procedural knowledge belongs in skills, not here. -->

## Project facts
- Work-item key prefix: `{{PROJECT_KEY}}` (e.g. {{PROJECT_KEY}}-123)
- Stack: {{STACK_SUMMARY}}
- Default branch: `{{DEFAULT_BRANCH}}` — never commit to any repo's default branch directly.
{{WORKSPACE_FACT}}

## Commands
- Install deps: `{{INSTALL_CMD}}`
- Run dev: `{{DEV_CMD}}`
- Test: `{{TEST_CMD}}`
- Lint: `{{LINT_CMD}}`

## AIDLC workflow
- **Process is proportional to consequence.** A small obvious change is made directly — edited, gated,
  committed, no ticket. Work worth a trail gets a branch and a run file. Stories and anything a team
  coordinates around get the full pipeline. `/aidlc:do` picks and says which; "just do it" / "no ticket"
  / "no PR" are honored as instructions.
- **Tracked** work items (epics, stories, tasks, bugs) are managed through the `/aidlc:*` commands.
  Never edit a tracked item's status by hand — use the pipeline, it keeps tracker + run state in sync.
- `/aidlc:run <ID>` — take one work item end-to-end (branch → implement → verify → PR). Verification
  cadence is configurable (`pipeline.verification`); by default reviewer/QA are on-demand and security
  runs per-epic, with the CI gate (lint/type/tests/boundaries) as the per-item floor.
- `/aidlc:next` — pick the highest-priority ready item and run it. On a shared project this is scoped to
  the items assigned to you (`team.me`), then unassigned ones — it never silently starts a colleague's work.
- `/aidlc:review-feedback <ID>` — a reviewer left comments on the PR: pull the unresolved threads, fix
  them through the normal cycle, push, and reply on each. A run reaching `done` means the pipeline
  finished, not that the change was accepted.
- `/aidlc:status` — dashboard of active runs and backlog. Active runs are **this machine's**; run files
  live on feature branches, so the board's counts are the cross-machine truth.
- `/aidlc:do <anything>` — the general front door: an opinion or fit question ("would this sit right
  here?"), an investigation, a small direct fix, or work described in plain language. It grounds in this
  project's ADRs, backlog, runs and stack before deciding. Prefer it over answering a project question
  cold — a question answered without the ADRs is a worse answer. Consults create no items; small fixes
  create no items either.
- Pipeline state lives in `.aidlc/runs/<ID>.md` — treat those files as the source of truth for in-flight work.
- Architecture decisions go in `docs/adr/` as ADRs.

## Configuration
- Per-project AIDLC settings: `.claude/aidlc.config.json` (work-item source, git host, autonomy gates,
  `team.mode` solo/shared).
- Rules in `.claude/rules/` are always loaded — keep them tiny.
