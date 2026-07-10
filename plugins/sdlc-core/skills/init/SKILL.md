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

1. Confirm cwd is a git repository (`git rev-parse --is-inside-work-tree`). If not, ask the user whether to
   `git init`. (In **poly** the workspace-root control plane may or may not be its own git repo — that's
   fine; what matters is that each declared repo path in Step 3 is a git repo. Verify each after Step 3 and
   flag any that need cloning.)
2. Check for collisions: `CLAUDE.md`, `.claude/settings.json`, `.claude/sdlc.config.json`, `backlog/`, `.sdlc/`.
   - If `CLAUDE.md` exists: do NOT overwrite. Merge — append the template's "SDLC workflow" and "Configuration" sections to the existing file.
   - If `.claude/settings.json` exists: do NOT overwrite. Show the user the template's permission posture and ask whether to merge `allow`/`deny`/`ask` arrays (union, dedupe) or skip.
   - Anything else existing: ask before overwriting.

## Step 3 — Ask the user (use AskUserQuestion where available)

Collect:
1. **Project key** (e.g. `PROJ`) — uppercase, used as work-item ID prefix.
2. **Project name** (human-readable).
3. **Work-item source**: `markdown` (default) | `jira` | `ado`. If jira/ado, also collect site/org + project.
4. **Workspace layout**: `mono` (default — one repo for everything) | `poly` (several git repos in this
   workspace, e.g. backend/frontend/website/mobile). Auto-detect a likely poly setup by scanning the cwd
   for multiple subfolders that are each git repos (`<sub>/.git`), and propose it.
   - **mono** → collect **Git host** (`github` default | `azure-repos`), **default branch** (`main`),
     the **git mode**, and the **stack** (defaults: frontend `nextjs`, backend `nestjs`, databases
     `postgres, mongodb`; accept "none"). **Git mode:** default `remote` (push + PR). Check
     `git remote` — if no remote is configured, propose **`local`** (`git.mode: "local"`): no push, no
     PR; the pipeline integrates each item via a user-confirmed local `--no-ff` merge after verify.
     Tell the user they can flip to `remote` later once they add an origin.
   - **poly** → for EACH repo collect: `name`, `path` (relative to the workspace root), `host`, `mode`
     (`remote` default | `local` — detect per repo: no remote configured → propose `local`), `remote`
     (`origin`), `defaultBranch`, `role` (one-line description), `labels` (routing hints), and per-repo
     `stack`. Frontend repos also get a `ux.renderBaseUrl` + `uiPaths`. Mark one repo `default: true`.
     Write these to `repos[]` and set `workspace.layout: "poly"`; the top-level `git`/`stack` blocks are
     unused in poly (leave them or drop them).
   - **Frontend structure flavor (any repo with a `stack.frontend`):** ask which enterprise structure
     it follows — `next-app` (App-Router-first: server components own data, RTK for client state) or
     `rtk-spa` (client SPA: RTK Query is the primary data layer). See `sdlc-stack-web:project-structure`.
     Record it (mono: note it; poly: `structure: "next-app"|"rtk-spa"` on the repo entry). Drives the
     skeleton scaffolded in Step 4.
5. **Commands**: install / dev / test / lint commands (detect from package.json scripts first and propose
   them). In poly these are per-repo — record them in each repo's `CLAUDE.md`, or note them per repo.
6. **Verification cadence** — who runs code review + QA, and how often (this is the pipeline's
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

1. Copy the template tree into cwd (the **workspace control plane**), respecting the collision decisions
   from Step 2. In poly the control plane is the workspace root; the product repos are its subfolders.
2. Replace placeholders in `CLAUDE.md` and `.claude/sdlc.config.json`:
   `{{PROJECT_KEY}}`, `{{PROJECT_NAME}}`, `{{STACK_SUMMARY}}`, `{{DEFAULT_BRANCH}}`,
   `{{INSTALL_CMD}}`, `{{DEV_CMD}}`, `{{TEST_CMD}}`, `{{LINT_CMD}}` — with collected values.
   - **poly**: fill `{{WORKSPACE_FACT}}` in `CLAUDE.md` with a short repos list (name → path + role) and
     populate `repos[]` in `sdlc.config.json` from Step 3 (the `sdlc.config.poly.example.json` shipped in
     the template is a filled reference). **mono**: set `{{WORKSPACE_FACT}}` to empty and leave `repos: []`.
3. If source is not markdown, you may delete `backlog/` (or keep it — it is harmless; ask the user).
4. Ensure `.gitignore` contains `.claude/settings.local.json` (append if missing). In poly, also ignore the
   product-repo checkouts if the control plane is its own git repo, or leave each repo self-managed.
5. **Tooling baseline (TypeScript repos only).** If the `sdlc-stack-web` plugin is installed AND a
   repo's stack is TypeScript-based (`stack.frontend`/`stack.backend` is `nextjs`/`nestjs`/another TS
   framework), scaffold its strict baseline so quality is machine-enforced from day one, not left to
   the reviewer. Locate it like the project template — glob `**/sdlc-stack-web/templates/tooling/`
   under the install locations. Per repo (per-repo in poly; **skip non-TS repos**, e.g. a Postgres-only
   or mobile repo):
   - Copy `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig`, `.npmrc`
     into the repo root — **merge-aware**: if the repo already has an ESLint / tsconfig / Prettier
     config, do NOT overwrite; show the delta and ask whether to adopt the baseline, merge, or skip
     (a repo already linting strictly needs nothing). Point its `tsconfig.json` at the baseline via
     `"extends": "./tsconfig.base.json"`.
   - Add the devDependencies and `lint`/`typecheck`/`format` scripts from the tooling `README.md` to
     `package.json` (or, if you can't edit it safely, print the exact `npm i -D …` + scripts for the
     user to run).
   - Framework layer (don't replace): Next.js repos also install `eslint-config-next` and keep their
     own tsconfig `module` settings, layering the baseline's strictness on top.
   If `sdlc-stack-web` is absent or the repo isn't TS, skip silently — the baseline is stack-specific.
6. **Enterprise project structure (TypeScript repos, when `sdlc-stack-web` is present).** After the
   tooling baseline, scaffold the canonical skeleton per `sdlc-stack-web:project-structure` for each
   repo's role — `backend-nestjs` for a Nest backend, or the frontend flavor chosen in Step 3
   (`next-app` / `rtk-spa`). Locate the templates by glob (`**/sdlc-stack-web/templates/structure/`).
   Per repo:
   - Create the directory tree from the skill (backend: `common/{filters,interceptors,guards,pipes,
     decorators,constants}` + `modules/<example>` + `config/`; frontend: `components/{ui,features}`,
     `hooks/`, `store/{slices,api}`, `lib/`, `types/`, `constants/`).
   - Copy the canonical reference files from `templates/structure/reference/{backend,frontend}/`
     (backend exception filter + `common/constants/{http-status,messages}`; frontend
     `store/{index,hooks,api/base-api}`) into place, and generate ONE example feature/module as a
     copy-me pattern.
   - Drop the matching `templates/structure/dependency-cruiser/.dependency-cruiser.<flavor>.cjs` as
     `.dependency-cruiser.cjs`; add `dependency-cruiser` to devDeps and a `depcruise` script
     (`"depcruise": "depcruise src"`). RTK flavors also need `@reduxjs/toolkit` + `react-redux`.
   - **Merge-aware:** never overwrite an existing structure — if the repo already has a layout, adopt
     it, skip the skeleton, and note the difference. Skip non-TS repos entirely.

## Step 5 — Report

Print a summary: files created, config chosen, and next steps:
- "Create your first item in `backlog/items/` (see `backlog/README.md`) or connect your tracker."
- "Run `/sdlc:next` to pick up the first item, or `/sdlc:run <ID>` for a specific one."
- "Auth for MCP servers (GitHub token, Jira/ADO) is per-user — see the adoption guide."
- If a tooling baseline / structure was scaffolded: "Installed the strict web-stack tooling baseline
  + enterprise skeleton (`<flavor>`) in `<repo(s)>` — run the printed `npm i -D …` to pull the
  devDeps, then `npm run lint && npm run typecheck && npm run depcruise` to confirm a clean start."

Do NOT commit automatically — show `git status` and let the user commit the scaffold.
