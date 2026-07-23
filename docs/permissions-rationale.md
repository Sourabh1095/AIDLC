# Permissions Rationale

Why each rule in the project template's `.claude/settings.json` exists. Audience: security
review + anyone tuning a project's posture. The posture implements **high autonomy with hard
guardrails**: everything on the story→PR path is allowed; anything destructive,
production-touching, or guardrail-modifying is denied; ambiguous blast radius asks.

Defense in depth: static rules here are layer 1; the `guard.mjs` / `protect-paths.mjs` /
`env-guard.mjs` hooks are layer 2 (they understand context — current branch, targets, exfil
patterns, and per-workspace switches — that static patterns cannot express).

## ALLOW — the autonomous story→PR path

| Rule(s) | Why |
|---------|-----|
| `Read`, `Grep`, `Glob`, `Edit`, `Write` | Core work: exploring and writing code. Secret paths are carved out by deny rules below. |
| `git status/log/diff/show/fetch/pull` | Read-only git — needed constantly. |
| `git checkout/switch/branch/add/commit/stash/worktree` | Branch-and-commit flow. Guard hook prevents work on protected branches. |
| `git push` | Required for hands-off PR creation. Force variants denied; protected branches blocked by the guard hook. |
| `gh pr create/view/comment/checks/list` | The pipeline's PR flow and CI feedback. Deliberately NOT `gh pr merge` — merging is the human gate. |
| `az repos pr *`, `az boards *` | Same flow on Azure DevOps (PRs + work items). Not `az` wholesale — deploy/keyvault subcommands stay out. |
| `npm/pnpm/yarn/npx/node` | Build, test, lint, run. Install included: the pipeline must add dependencies. `npm publish` is in ask. |
| `docker build/compose/run/ps/logs/exec/stop/images` | Local dev environments and integration tests. `docker push` (registry mutation) is in ask; prune in ask. |
| `WebSearch` | Research during runs (library issues, error messages). |

## DENY — irreversible, production, secrets, self-modification

| Rule(s) | Why |
|---------|-----|
| `git push --force / -f`, `git reset --hard origin` | History destruction. No pipeline scenario needs it; `--force-with-lease` exists in ask as the human-approved escape hatch. |
| `gh repo delete` | Obvious. |
| `Read(**/secrets/**, ~/.ssh, ~/.aws)` | The pipeline never needs the VALUES in secret stores. Removes the exfiltration surface. |
| `.env` files — handled by the `env-guard.mjs` hook, not a static rule | Env files (`.env`, `.env.example`, `.env.local`, …) can carry secrets, so by default the pipeline may neither read nor change them. This is a hook rather than a `Read(.env*)` deny because it's a **switch**: a static deny can never be relaxed, but `pipeline.envFileAccess` in `.claude/aidlc.config.json` lets a workspace opt in. `"deny"` (default) hard-blocks; `"ask"` lets the pipeline touch env files with the user approving every individual read/change (the prompt shows the exact diff). The hook fails closed — a missing or malformed config is treated as `"deny"`. See [`env-guard.mjs`](../plugins/aidlc-core/hooks/scripts/env-guard.mjs). |
| `gh secret *`, `az keyvault *` | Secret stores are human-managed. |
| `kubectl apply/delete`, `terraform apply/destroy`, `az webapp deploy`, `az deployment` | Deployments and infra mutation are release-process actions, not pipeline actions. Phase 4's devops agent will get scoped, per-project exceptions if a project's process allows it. |
| `Edit/Write(.claude/settings*.json)` | The agent must not be able to widen its own permissions. Also enforced by `protect-paths.mjs` (which additionally covers hook scripts). |

## ASK — legitimate but blast-radius-ambiguous

| Rule(s) | Why a human clicks |
|---------|--------------------|
| `git push --force-with-lease` | Occasionally legitimate on feature branches (post-rebase); guard hook still blocks it on protected branches. |
| `git rebase` | History rewriting; fine locally, but human judgment on shared branches. |
| `npm publish`, `docker push`, `gh release create`, `az pipelines run` | Registry/release mutations — visible outside the repo. |
| `docker system prune` | Deletes shared local state beyond the project. |
| `psql`, `mongosh` | Raw DB shells can mutate anything they can reach. Guard hook blocks prod-looking targets outright; localhost usage just needs a click. Prefer read-only MCP servers (Phase 3/4) for queries. |

## Per-project tuning

- Lower-trust project: move `git push` and `gh pr create` to ask; set `pipeline.gates.ambiguousRequirements = "ask-human"`.
- A project that legitimately deploys from the repo: add narrowly-scoped allow rules (e.g. `Bash(az webapp deploy --name myapp-staging:*)`) — never blanket-allow the deploy command.
- Never edit the deny list downward in a project without security sign-off; it exists precisely for the cases nobody plans for.
