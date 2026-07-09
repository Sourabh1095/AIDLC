---
name: init
description: Scaffold the Bee-Logical SDLC project template into the current repository — CLAUDE.md, permissions, sdlc.config.json, rules, backlog structure, run-state folders. Use when adopting the SDLC framework in a new or existing project.
disable-model-invocation: true
---

# /sdlc:init — Adopt the SDLC framework in this project

Scaffold the project template into the current working directory, then configure it interactively.

> Run this in an INTERACTIVE session: Claude Code gates writes to `.claude/settings.json` at
> the harness level, so scaffolding it needs the user's approval prompt. In a headless session
> that write is auto-denied — stage the `.claude/` files elsewhere (e.g. `.sdlc/staged-claude/`)
> and leave a small finisher script + clear instructions instead of skipping them.

## Step 1 — Locate the template (do NOT reconstruct it from memory)

The template ships inside this plugin at `<plugin-root>/templates/project/`. Resolve
`<plugin-root>` in this order:
1. This SKILL.md's own path (visible where the skill was loaded): the plugin root is two
   levels up from the `skills/init/` directory.
2. The `$CLAUDE_PLUGIN_ROOT` environment variable, if set in your shell.
3. Glob the standard install locations for `**/templates/project/CLAUDE.md` under
   `~/.claude/plugins/` and any `--plugin-dir` path.
Verify the directory contains `CLAUDE.md`, `.claude/settings.json` and `backlog/README.md`
before copying. If you cannot find it, STOP and ask the user for the plugin path — never
improvise replacement files: the permission posture and rules must be the reviewed originals.

## Step 2 — Pre-flight checks

1. Confirm cwd is a git repository (`git rev-parse --is-inside-work-tree`). If not, ask the user whether to `git init`.
2. Check for collisions: `CLAUDE.md`, `.claude/settings.json`, `.claude/sdlc.config.json`, `backlog/`, `.sdlc/`.
   - If `CLAUDE.md` exists: do NOT overwrite. Merge — append the template's "SDLC workflow" and "Configuration" sections to the existing file.
   - If `.claude/settings.json` exists: do NOT overwrite. Show the user the template's permission posture and ask whether to merge `allow`/`deny`/`ask` arrays (union, dedupe) or skip.
   - Anything else existing: ask before overwriting.

## Step 3 — Ask the user (use AskUserQuestion where available)

Collect:
1. **Project key** (e.g. `PROJ`) — uppercase, used as work-item ID prefix.
2. **Project name** (human-readable).
3. **Work-item source**: `markdown` (default) | `jira` | `ado`. If jira/ado, also collect site/org + project.
4. **Git host**: `github` (default) | `azure-repos`. Default branch name (default `main`).
5. **Stack** (defaults: frontend `nextjs`, backend `nestjs`, databases `postgres, mongodb`) — accept "none" for any.
6. **Commands**: install / dev / test / lint commands (detect from package.json scripts first and propose them).
7. **Verification cadence** — who runs code review + QA, and how often (this is the pipeline's
   biggest recurring cost, so make it a conscious choice). Present these options and write the
   answer to `pipeline.verification`:
   - **Auto, every item** (`mode: auto`, `scope: per-item`) — thorough; reviewer + QA run before
     every PR. Default, highest quality, highest cost.
   - **Auto, once per epic** (`mode: auto`, `scope: per-epic`) — child items skip per-item review;
     one consolidated pass when the epic's children are all done. Cheaper for large features.
   - **Manual — I review the PRs** (`mode: manual`) — SDLC skips the review/QA agents and opens the
     PR for you to review yourself; you feed back any issues by rerunning `/sdlc:run <ID>`. Cheapest.
   - **Ask me each time** (`mode: ask`) — the pipeline prompts per item.
   Also mention they can fine-tune `reviewer` / `qa` / `security` booleans in the config later
   (e.g. keep the fast code review but drop the full QA test pass).

## Step 4 — Scaffold

1. Copy the template tree into cwd (respecting the collision decisions from Step 2).
2. Replace placeholders in `CLAUDE.md` and `.claude/sdlc.config.json`:
   `{{PROJECT_KEY}}`, `{{PROJECT_NAME}}`, `{{STACK_SUMMARY}}`, `{{DEFAULT_BRANCH}}`,
   `{{INSTALL_CMD}}`, `{{DEV_CMD}}`, `{{TEST_CMD}}`, `{{LINT_CMD}}` — with collected values.
3. If source is not markdown, you may delete `backlog/` (or keep it — it is harmless; ask the user).
4. Ensure `.gitignore` contains `.claude/settings.local.json` (append if missing).

## Step 5 — Report

Print a summary: files created, config chosen, and next steps:
- "Create your first item in `backlog/items/` (see `backlog/README.md`) or connect your tracker."
- "Run `/sdlc:next` to pick up the first item, or `/sdlc:run <ID>` for a specific one."
- "Auth for MCP servers (GitHub token, Jira/ADO) is per-user — see the adoption guide."

Do NOT commit automatically — show `git status` and let the user commit the scaffold.
