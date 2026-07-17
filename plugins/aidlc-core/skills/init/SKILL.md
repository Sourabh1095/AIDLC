---
name: init
description: Scaffold the Bee-Logical AIDLC project template into the current repository — CLAUDE.md, permissions, aidlc.config.json, rules, backlog structure, run-state folders. Use when adopting the AIDLC framework in a new or existing project.
disable-model-invocation: true
---

# /aidlc:init — Adopt the AIDLC framework in this project

Scaffold the project template into the current working directory, then configure it interactively.

> Run this in an INTERACTIVE session: Claude Code gates writes to `.claude/settings.json` at
> the harness level, so scaffolding it needs the user's approval prompt. In a headless session
> that write is auto-denied — stage the `.claude/` files elsewhere (e.g. `.aidlc/staged-claude/`)
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
   `git init`. **When you `git init` (or on an existing repo), normalize the control-plane branch to the
   configured default** (`git init -b <defaultBranch>`, or `git branch -m master <defaultBranch>` /
   `git symbolic-ref HEAD refs/heads/<defaultBranch>` on an empty repo) so it matches
   `git.defaultBranch` — don't leave a `master` control plane while every repo config says `main` (F6).
   If they diverge and it's not empty, flag the mismatch rather than renaming silently. (In **poly** the
   workspace-root control plane may or may not be its own git repo — that's fine; what matters is that
   each declared repo path in Step 3 is a git repo. Verify each after Step 3 and flag/bootstrap any that
   need it — see Step 4.)
2. Check for collisions: `CLAUDE.md`, `.claude/settings.json`, `.claude/aidlc.config.json`, `backlog/`, `.aidlc/`.
   - If `CLAUDE.md` exists: do NOT overwrite. Merge — append the template's "AIDLC workflow" and "Configuration" sections to the existing file.
   - If `.claude/settings.json` exists: do NOT overwrite. Show the user the template's permission posture and ask whether to merge `allow`/`deny`/`ask` arrays (union, dedupe) or skip.
   - Anything else existing: ask before overwriting.

## Step 3 — Ask the user (use AskUserQuestion where available)

Collect:
1. **Project key** (e.g. `PROJ`) — uppercase, used as work-item ID prefix.
2. **Project name** (human-readable).
3. **Work-item source**: `markdown` (default) | `jira` | `ado`. If jira/ado, also collect site/org + project.
   - **ADO — populate `statusMap` from the board's REAL states, PER TYPE, don't assume defaults
     (F7 + F20).** Many boards are customized (e.g. *Development in Progress / Ready for QA / Closed*,
     not Agile's Active/Resolved), and **state names are scoped per work-item-type** — an Epic's
     working state ("In Progress") commonly differs from a Story/Feature's ("Development in Progress"),
     so a single flat name per canonical status is wrong. If the ADO MCP / `az` is reachable now (see
     the doctor note in `wi-ado` → *Connectivity*), for **each** work-item type in play (Epic, Feature,
     User Story/PBI, Task, Bug) query the type's states + categories
     (`_apis/wit/workitemtypes/{type}/states` — each carries a `stateCategory` of
     Proposed/InProgress/Resolved/Completed/Removed) and build a **per-type**
     `workItems.ado.statusMap` (`{ "<Type>": { "<canonical>": "<state name>" } }`) by mapping canonical
     → the state whose category matches (todo=Proposed, in_progress=InProgress, in_review=Resolved,
     done=Completed). This captures the Epic/Story divergence up front. If it's not reachable at init
     time, leave `statusMap` empty and note that `wi-ado` self-heals per-type on first run — but prefer
     getting it right up front. Never write the assumed flat `in_progress→Active`/`in_review→Resolved`
     defaults blindly.
4. **Workspace layout**: `mono` (one repo for everything) | `poly` (several git repos in this workspace,
   e.g. backend/frontend/website/mobile). **Ask this as a real question — never silently default from
   auto-detect (F3).** Auto-detect is only a *proposal*: scan the cwd for multiple subfolders that are
   each git repos (`<sub>/.git`) and, if found, propose poly. **Crucially, a greenfield poly workspace
   has no sub-repos yet** (the repos are what the first story will create), so "no sub-repos detected"
   must NOT collapse to mono — present mono-vs-poly explicitly and let the user choose, seeding the
   proposal from any signal (existing subfolders, the described project shape) but deciding by the
   answer, not the scan.
   - **mono** → collect **Git host** (`github` default | `azure-repos`), **default branch** (`main`),
     the **git mode**, and the **stack** (defaults: frontend `nextjs`, backend `nestjs`, databases
     `postgres, mongodb`; accept "none"). **Git mode:** default `remote` (push + PR). Check
     `git remote` — if no remote is configured, propose **`local`** (`git.mode: "local"`): no push, no
     PR; the pipeline integrates each item via a user-confirmed local `--no-ff` merge after verify.
     Tell the user they can flip to `remote` later once they add an origin.
   - **poly** → for EACH repo collect: `name`, `path` (relative to the workspace root), `host`, `mode`
     (`remote` default | `local` — detect per repo: no remote configured → propose `local`), `remote`
     (`origin`), `defaultBranch`, `role` (one-line description), `labels` (routing hints), and per-repo
     `stack`. Frontend repos also get `ux.renderBaseUrl` + `uiPaths`. **For `renderBaseUrl`, derive or
     ASK the repo's real dev-server port — don't blindly default every UX repo to :3000 (F13)**: read
     its `package.json` `dev`/`start` script if the repo exists, else ask. **Flag port collisions across
     repos** (two repos both on :3000, or a UX repo's `renderBaseUrl` pointing at another repo's port —
     e.g. the API's :3000 — which would make the jury render the wrong server). The scaffold ultimately
     owns the port and writes it back (`aidlc:run` §6), but init should not seed a value it knows collides.
     Mark one repo `default: true`. Write these to `repos[]` and set `workspace.layout: "poly"`; the
     top-level `git`/`stack` blocks are unused in poly (leave them or drop them).
   - **Frontend structure flavor (any repo with a `stack.frontend`):** ask which enterprise structure
     it follows — `next-app` (App-Router-first: server components own data, RTK for client state) or
     `rtk-spa` (client SPA: RTK Query is the primary data layer). See `aidlc-stack-web:project-structure`.
     Record it (mono: note it; poly: `structure: "next-app"|"rtk-spa"` on the repo entry). Drives the
     skeleton scaffolded in Step 4.
5. **Commands**: install / dev / test / lint commands (detect from package.json scripts first and propose
   them). In poly these are per-repo — record them in each repo's `CLAUDE.md`, or note them per repo.
6. **Verification cadence** — the pipeline's biggest recurring cost, so make it a conscious choice.
   Each agent (reviewer, QA, security) gets its own cadence in `pipeline.verification`. Note that the
   deterministic CI gate (lint/format/typecheck/boundaries/tests) always runs regardless, so per-item
   quality has a floor either way. Offer these profiles:
   - **Economical (default)** — `reviewer: on-demand`, `qa: on-demand`, `security: per-epic`,
     `securityConfirm: true`. No LLM agent runs per item; you invoke reviewer/QA when you want them,
     security runs once per epic after you confirm. Lowest cost; leans on the CI gate + your PR review.
   - **Balanced** — `reviewer: per-item`, `qa: on-demand`, `security: risk-based`. Every PR gets an
     AC/standards review; QA on demand; security auto-runs only on risky diffs.
   - **Thorough** — `reviewer`/`qa`/`security` all `per-item`. Every item fully reviewed before PR.
     Highest quality, highest cost.
   - **Manual** — `mode: manual`. Skip all agents; review the PR yourself, feed issues back via `/aidlc:run <ID>`.
   Cadence values per agent: `off | on-demand | per-item | per-epic` (security also `risk-based`);
   they can hand-tune any agent later.
7. **Pre-commit hooks (TypeScript repos; opinionated-but-optional).** Ask whether to install the
   husky + lint-staged pre-commit layer (eslint `--fix` + prettier `--write` on staged files at commit
   time — the local complement to the CI/merge gate). Default **yes** for a fresh repo; some teams
   decline git hooks, so it's a real question, not automatic. Record the choice; it drives Step 4.5.

## Step 4 — Scaffold

1. Copy the template tree into cwd (the **workspace control plane**), respecting the collision decisions
   from Step 2. In poly the control plane is the workspace root; the product repos are its subfolders.

   **Poly — bootstrap declared repos so the pipeline can run into them (F4).** Local mode branches from
   / merges into each repo's default branch, so every declared repo must already be a git repo with at
   least one commit — but a greenfield poly workspace's first story is often *"create the repos,"* a
   chicken-and-egg. For each `repos[]` entry whose folder is missing or not a git repo, **offer to
   bootstrap it**: create the folder, `git init -b <defaultBranch>`, and make an initial commit (a
   stub `README.md`, or the tooling/structure baseline from Steps 4.5–4.6). Do it here or via a
   dedicated `/aidlc:repo add <name>` per repo (same mechanism — see that command). Skip repos that
   already exist and are non-empty. If you skip bootstrapping, **document the exact commands** the user
   must run before the first `/aidlc:run`, so they don't hit the branch-into-empty-folder failure.
2. Replace placeholders in `CLAUDE.md` and `.claude/aidlc.config.json`:
   `{{PROJECT_KEY}}`, `{{PROJECT_NAME}}`, `{{STACK_SUMMARY}}`, `{{DEFAULT_BRANCH}}`,
   `{{INSTALL_CMD}}`, `{{DEV_CMD}}`, `{{TEST_CMD}}`, `{{LINT_CMD}}` — with collected values.
   - **poly**: fill `{{WORKSPACE_FACT}}` in `CLAUDE.md` with a short repos list (name → path + role) and
     populate `repos[]` in `aidlc.config.json` from Step 3 (the `aidlc.config.poly.example.json` shipped in
     the template is a filled reference). **mono**: set `{{WORKSPACE_FACT}}` to empty and leave `repos: []`.
3. If source is not markdown, you may delete `backlog/` (or keep it — it is harmless; ask the user).
4. Ensure `.gitignore` contains `.claude/settings.local.json` (append if missing). In poly, also ignore the
   product-repo checkouts if the control plane is its own git repo, or leave each repo self-managed.
5. **Tooling baseline (TypeScript repos only).** If the `aidlc-stack-web` plugin is installed AND a
   repo's stack is TypeScript-based (`stack.frontend`/`stack.backend` is `nextjs`/`nestjs`/another TS
   framework), scaffold its strict baseline so quality is machine-enforced from day one, not left to
   the reviewer. Locate it like the project template — glob `**/aidlc-stack-web/templates/tooling/`
   under the install locations. Per repo (per-repo in poly; **skip non-TS repos**, e.g. a Postgres-only
   or mobile repo):
   - Copy `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.editorconfig`,
     `.gitattributes`, `.npmrc` into the repo root — **merge-aware**: if the repo already has an
     ESLint / tsconfig / Prettier / gitattributes config, do NOT overwrite; show the delta and ask
     whether to adopt the baseline, merge, or skip (a repo already linting strictly needs nothing).
     Point its `tsconfig.json` at the baseline via `"extends": "./tsconfig.base.json"`. The
     `.gitattributes` (`* text=auto eol=lf`) is what stops CRLF/LF churn on Windows and keeps the repo
     byte-identical between a Windows dev and a Linux CI runner (F17) — copy it even into a non-Next
     repo; the binary rules are harmless where they don't match.
   - Add the devDependencies and `lint`/`typecheck`/`format`/`format:write` scripts from the tooling
     `README.md` to `package.json` (or, if you can't edit it safely, print the exact `npm i -D …` +
     scripts for the user to run).
   - **Cross-platform lockfile for Linux CI (F29).** `npm ci` is exact-lock — and npm resolves
     platform-specific optional deps (`@emnapi/*`, esbuild/swc/rollup natives) per OS/arch, so a
     `package-lock.json` **generated on Windows/macOS can be unsatisfiable on Linux CI**. If this repo
     has (or will have) Linux CI, generate/refresh the committed lockfile in the **Linux context CI
     uses** (e.g. `docker run --rm -v "$PWD":/w -w /w node:22 npm install`) rather than committing the
     Windows-generated one — or document it as a required step for the user. Recurs on every repo when
     dev is Windows and CI is Linux.
   - **Leave the repo format-clean (F18).** After the baseline is in place, run `prettier --write .`
     **repo-wide** so the freshly scaffolded repo passes its own `format` (`prettier --check .`) gate
     at the first merge — a scaffold that "merged never-clean" (unformatted files slipping past because
     format was never enforced repo-wide at scaffold time) is the failure this prevents. Confirm the
     enforced gate runs `format:check`/`prettier --check .` (not just eslint) — see `ci-cd`.
   - **Pre-commit hooks (F21) — only if the user opted in at Step 3.7.** Add `husky` + `lint-staged`
     to devDeps, `npx husky init`, copy `templates/tooling/husky/pre-commit` → `.husky/pre-commit`
     and `templates/tooling/lint-staged.config.mjs` → repo root. **Make `prepare` CI-safe**:
     `"prepare": "husky || true"` (not the bare `"husky"` husky writes) — bare `husky` exits **127** on
     every `npm ci` in a CI container or a `file:../` sibling checkout that lacks husky. In **poly**,
     prefer letting the shared-config repo own the lint-staged preset and having the others re-export
     it (`export { default } from "@beelogical/dev-config/lint-staged"`). If the user declined, skip
     silently — the CI/merge gate still enforces the same standards.
   - Framework layer (don't replace): Next.js repos also install `eslint-config-next` and keep their
     own tsconfig `module` settings, layering the baseline's strictness on top.
   If `aidlc-stack-web` is absent or the repo isn't TS, skip silently — the baseline is stack-specific.
6. **Enterprise project structure (TypeScript repos, when `aidlc-stack-web` is present).** After the
   tooling baseline, scaffold the canonical skeleton per `aidlc-stack-web:project-structure` for each
   repo's role — `backend-nestjs` for a Nest backend, or the frontend flavor chosen in Step 3
   (`next-app` / `rtk-spa`). Locate the templates by glob (`**/aidlc-stack-web/templates/structure/`).
   Per repo:
   - Create the directory tree from the skill (backend: `common/{filters,interceptors,guards,pipes,
     decorators,constants}` + `modules/<example>` + `config/`; frontend: `components/{ui,features}`,
     `hooks/`, `store/{slices,api}`, `lib/`, `types/`, `constants/`).
   - Copy the canonical reference files from `templates/structure/reference/{backend,frontend}/`
     (backend exception filter + `common/constants/{http-status,messages}`; frontend
     `store/{index,hooks,api/base-api}`) into place, and generate ONE example feature/module as a
     copy-me pattern.
   - Drop the matching `templates/structure/dependency-cruiser/.dependency-cruiser.<flavor>.cjs` as
     `.dependency-cruiser.cjs`; add **`dependency-cruiser@^17`** to devDeps (pin the `^17` floor — a
     `< 17` install silently no-ops on `.ts` and the gate passes green enforcing nothing, F30; the
     profiles' `enhancedResolveOptions` also need `>= 17`) and a `depcruise` script
     (`"depcruise": "depcruise src"`). RTK flavors also need `@reduxjs/toolkit` + `react-redux`.
   - **Merge-aware:** never overwrite an existing structure — if the repo already has a layout, adopt
     it, skip the skeleton, and note the difference. Skip non-TS repos entirely.
7. **CI gate for `mode: remote` repos (F24) — remote mode implies a PR-gated merge, so a gate must
   exist.** For each repo whose `mode` is `remote`, check whether it already has CI wired
   (`.github/workflows/*.yml` for github, `azure-pipelines.yml` for azure-repos) **and** a
   required/blocking PR-check policy. If not:
   - If `aidlc-stack-web` is present, **offer to scaffold the matching CI template** (glob
     `**/aidlc-stack-web/templates/ci/`): `azure-pipelines.yml` (azure-repos) or `.github/workflows/ci.yml`
     (github). It runs the SAME deterministic gate as the local run (typecheck/lint/format/boundaries/
     build/test) — so remote PRs are actually enforced, not merged ungated.
   - **Always warn, even if you don't scaffold:** "`<repo>` is `mode: remote` but has no detectable CI /
     required-check policy — its PRs will merge **ungated** until a CI gate + branch policy land." Never
     leave this silent (a repo can otherwise run for weeks with the gate running only locally per run).
   - Setting the actual branch policy / build-validation (and, on Azure, the service connection, agent
     pool, hosted-parallelism grant) needs org permissions — it may stay a tracked devops task. Say so;
     don't pretend it's done. See `aidlc:ci-cd` for the pool/parallelism/queue-auth specifics.

## Step 5 — Report

Print a summary: files created, config chosen, and next steps:
- "Create your first item in `backlog/items/` (see `backlog/README.md`) or connect your tracker."
- "Run `/aidlc:next` to pick up the first item, or `/aidlc:run <ID>` for a specific one."
- "Auth for MCP servers (GitHub token, Jira/ADO) is per-user — see the adoption guide."
- If a tooling baseline / structure was scaffolded: "Installed the strict web-stack tooling baseline
  + enterprise skeleton (`<flavor>`) in `<repo(s)>` — run the printed `npm i -D …` to pull the
  devDeps, then `npm run lint && npm run typecheck && npm run depcruise` to confirm a clean start."
- For any `mode: remote` repo: whether CI was scaffolded, and — for each — the explicit reminder to
  add the **blocking build-validation / required-check policy** on the default branch (needs org
  permissions), or the PR gate is advisory. Name any repo left **ungated**.

Do NOT commit automatically — show `git status` and let the user commit the scaffold.
