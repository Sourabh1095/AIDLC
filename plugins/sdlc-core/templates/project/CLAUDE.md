# {{PROJECT_NAME}}

<!-- Keep this file under ~40 lines. Procedural knowledge belongs in skills, not here. -->

## Project facts
- Work-item key prefix: `{{PROJECT_KEY}}` (e.g. {{PROJECT_KEY}}-123)
- Stack: {{STACK_SUMMARY}}
- Default branch: `{{DEFAULT_BRANCH}}` — never commit to it directly.

## Commands
- Install deps: `{{INSTALL_CMD}}`
- Run dev: `{{DEV_CMD}}`
- Test: `{{TEST_CMD}}`
- Lint: `{{LINT_CMD}}`

## SDLC workflow (mandatory)
- All work items (epics, stories, tasks, bugs) are managed through the `/sdlc:*` commands.
  Never edit backlog item status by hand — use the pipeline, it keeps tracker + run state in sync.
- `/sdlc:run <ID>` — take one work item end-to-end (branch → implement → review → QA → PR).
- `/sdlc:next` — pick the highest-priority ready item and run it.
- `/sdlc:status` — dashboard of active runs and backlog.
- Pipeline state lives in `.sdlc/runs/<ID>.md` — treat those files as the source of truth for in-flight work.
- Architecture decisions go in `docs/adr/` as ADRs.

## Configuration
- Per-project SDLC settings: `.claude/sdlc.config.json` (work-item source, git host, autonomy gates).
- Rules in `.claude/rules/` are always loaded — keep them tiny.
