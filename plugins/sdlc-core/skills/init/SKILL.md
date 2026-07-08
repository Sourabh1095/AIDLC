---
name: init
description: Scaffold the Bee-Logical SDLC project template into the current repository — CLAUDE.md, permissions, sdlc.config.json, rules, backlog structure, run-state folders. Use when adopting the SDLC framework in a new or existing project.
disable-model-invocation: true
---

# /sdlc:init — Adopt the SDLC framework in this project

Scaffold the project template into the current working directory, then configure it interactively.

## Step 1 — Locate the template

The template ships inside this plugin at `${CLAUDE_PLUGIN_ROOT}/templates/project/`.
If `$CLAUDE_PLUGIN_ROOT` is not set in your shell context, resolve the plugin install
directory (e.g. `~/.claude/plugins/` or the `--plugin-dir` path) and find `templates/project/` under the `sdlc` plugin.

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
