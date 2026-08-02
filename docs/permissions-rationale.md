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
| `git rev-parse/ls-files/check-ignore/for-each-ref/ls-tree/rev-list/count-objects`, `git submodule status`, `git worktree list`, `git lfs env` | Read-only git **introspection**, in both the bare and `git -C <path>` forms. `ls-tree` and `rev-list` join the set for two per-run checks that would otherwise prompt constantly: the **base-drift** read at every verify (`rev-list --count HEAD..<remote>/<base>`) and **ADR number reservation** off the integration branch (`ls-tree <remote>/<base> docs/adr/`). Both are strictly reads — the mutating cousin of a drift check is `git merge`, which stays in the prompt path. These are what `/aidlc:adopt` profiles a workspace with (is this a work tree? shallow? submodules? existing worktrees? LFS? how big?) and what `/aidlc:init` verifies its `.gitignore` block with. Each is strictly a read; the mutating siblings are scoped out by naming the subcommand (`submodule status`, not `submodule`; `worktree list`, not `worktree`, in the `-C` form). Without them a single read-only scan fires a dozen prompts, which trains people to click through prompts — the worse security outcome. |
| **Not** `git config` — deliberately absent | It is a *write* verb as often as a read one (`git config user.name x`), and its read form is a credential path: `git config --get remote.origin.url` / `--list` can echo a PAT embedded in a remote URL. Reads of git config therefore stay in the prompt path. Facts the pipeline actually needs come from safer routes (`git rev-parse --abbrev-ref <remote>/HEAD` for the default branch), and anything that does surface a remote URL must have its credentials stripped before it is recorded or printed. |
| `git checkout/switch/branch/add/commit/stash/worktree` | Branch-and-commit flow. Guard hook prevents work on protected branches. |
| `git push` | Required for hands-off PR creation. Force variants denied; protected branches blocked by the guard hook. |
| `gh pr create/view/comment/checks/list` | The pipeline's PR flow and CI feedback. Deliberately NOT `gh pr merge` — merging is the human gate. |
| `az repos pr *`, `az boards *` | Same flow on Azure DevOps (PRs + work items). Not `az` wholesale — deploy/keyvault subcommands stay out. |
| `npm/pnpm/yarn/npx/node` | Build, test, lint, run. Install included: the pipeline must add dependencies — but **adding a new package is gated by the `dep-vet` hook** (an `ask`, across every supported ecosystem: npm/pnpm/yarn/bun, pip/uv/poetry, cargo, go, gem, composer, dotnet), so a supply-chain check happens before install rather than after code depends on the choice. Lockfile installs (`npm ci`, `pip install -r`) are not gated. `npm publish` is in ask. |
| **Your stack's commands are not here — add them** | The shipped allow-list is Node-shaped because that is the stack pack this repo ships. **Core itself is stack-agnostic**, so a Python, Go or .NET project should add its own gate commands (`Bash(pytest:*)`, `Bash(go test:*)`, `Bash(dotnet test:*)`) to `allow` — otherwise its own verification prompts on every run, which is the pattern that trains people to click through prompts. `/aidlc:adopt-apply` records the real gate commands in config; widening the allow-list to match them is a deliberate, human edit. |
| `docker build/compose/run/ps/logs/exec/stop/images` | Local dev environments and integration tests. `docker push` (registry mutation) is in ask; prune in ask. |
| `WebSearch` | Research during runs (library issues, error messages). |

## DENY — irreversible, production, secrets, self-modification

| Rule(s) | Why |
|---------|-----|
| `git push --force / -f`, `git reset --hard origin` | History destruction. No pipeline scenario needs it; `--force-with-lease` exists in ask as the human-approved escape hatch. |
| `gh repo delete` | Obvious. |
| `Read(**/secrets/**, ~/.ssh, ~/.aws)` | The pipeline never needs the VALUES in secret stores. Removes the exfiltration surface. |
| `.env` files — enforced by the `env-guard.mjs` + `guard.mjs` hooks (see the env-file note below), NOT a static deny | Env files can carry secrets, so by default the pipeline may neither read nor change them. This is a hook, not a `Read(.env*)` deny, because it must be a **switch** — and a static `deny` can never be relaxed by anything (that is the whole discovery this design corrects). |
| `gh secret *`, `az keyvault *` | Secret stores are human-managed. |
| `kubectl apply/delete`, `terraform apply/destroy`, `az webapp deploy`, `az deployment` | Deployments and infra mutation are release-process actions, not pipeline actions. The devops agent owns CI config and local containers, never a deploy; a project whose process genuinely deploys from the repo adds a narrowly-scoped allow rule (see *Per-project tuning*). |
| `Edit/Write(.claude/settings*.json)` | The agent must not be able to widen its own permissions. Also enforced by `protect-paths.mjs` (which additionally covers hook scripts). |

## ASK — legitimate but blast-radius-ambiguous

| Rule(s) | Why a human clicks |
|---------|--------------------|
| `git push --force-with-lease` | Occasionally legitimate on feature branches (post-rebase); guard hook still blocks it on protected branches. |
| `git rebase` | History rewriting; fine locally, but human judgment on shared branches. |
| `npm publish`, `docker push`, `gh release create`, `az pipelines run` | Registry/release mutations — visible outside the repo. |
| `gh api graphql` | The only way to read a GitHub PR's **inline review threads** (`gh pr view --json comments` returns just the top-level conversation), so `/aidlc:review-feedback` needs it — but the same endpoint runs mutations, including the `resolveReviewThread` that command uses. One endpoint, both directions, no flag to tell them apart from a permission rule: that is precisely what `ask` is for. Bare `gh api` stays out of the allowlist entirely for the same reason `/aidlc:adopt` leaves it out — `--method POST` is one flag away. |
| `docker system prune` | Deletes shared local state beyond the project. |
| `psql`, `mongosh` | Raw DB shells can mutate anything they can reach. Guard hook blocks prod-looking targets outright; localhost usage just needs a click. Prefer a read-only database MCP server for queries (`.mcp.json.example` ships both wired read-only). |
| `Read(**/.env)`, `Read(**/.env.*)`, `Edit(**/.env)`, `Edit(**/.env.*)` | The **fail-safe floor** for env files (see the note below). Never a `deny` and never a silent `allow` — so even if the `env-guard` hook is not running (plugin disabled), touching an env file prompts rather than being silently readable. **`Edit` only, never `Write(path)`** — file permission checks match only `Read(path)` and `Edit(path)`; a `Write(path)` rule is accepted but never matched and warns at startup, and `Edit` already covers every file-editing tool including Write (F44, re-broken and re-fixed as F48). |

## Env-file access — two layers that must agree

Env-file access exposed a subtlety worth stating plainly, because it governs the whole design:

- **`.claude/settings*.json` is the harness's hard gate.** A `deny` here always wins — no hook and
  no config can relax it. The permission precedence is `deny → ask → allow`, and a PreToolUse hook
  can only *tighten* (add a block or a prompt), never open what settings denies.
- **`pipeline.envFileAccess` (in `aidlc.config.json`) is a switch the hooks read at runtime.** It is
  therefore *subordinate* to the harness gate — it can only take effect within what settings permits.

So a hard `Read(.env*)` **deny** and an opt-in switch are mutually exclusive: the deny would make the
switch inert. The resolution:

1. Settings carries env paths in **`ask`**, not `deny` — the fail-safe floor above.
2. `env-guard.mjs` (PreToolUse `Read|Edit|Write`) enforces the real default: `envFileAccess: "deny"`
   → **exit 2 hard block** (which bypasses the settings `ask`); `"ask"` → a `permissionDecision: "ask"`
   prompt that shows the exact diff/content. Fails closed (missing/malformed config ⇒ `deny`).
3. `guard.mjs` (PreToolUse `Bash`) mirrors the switch on the **shell path** — a `> .env` redirect,
   `tee`/`cp`/`sed -i` write, or `cat .env` read is blocked under `deny` and stepped past under `ask`.
   Without this, a shell command would bypass the tool-level hook.

Net: the default is a hard deny (via the hook), opting in is a single edit to `aidlc.config.json`, and
the two layers agree. **Migration:** projects scaffolded before 0.28 still have the old
`Read(./.env)` / `Read(./.env.*)` **deny** in their `settings.json`; that hard deny overrides the
switch, so it must be removed and the `ask` rules added.

**You apply that edit, not the agent.** `protect-paths.mjs` blocks writes to an existing
`settings.json`, so `/aidlc:init` computes the migrated file, writes it to
`.aidlc/staged-claude/settings.json`, and shows you the diff — applying it is one copy, by hand. This
is not an oversight to route around: a hook cannot distinguish the setup command from an agent widening
its own permissions, and that is exactly the distinction this deny exists to make. `/aidlc:remove`
reverts the same way.

## Per-project tuning

- Lower-trust project: move `git push` and `gh pr create` to ask; set `pipeline.gates.ambiguousRequirements = "ask-human"`.
- A project that legitimately deploys from the repo: add narrowly-scoped allow rules (e.g. `Bash(az webapp deploy --name myapp-staging:*)`) — never blanket-allow the deploy command.
- Never edit the deny list downward in a project without security sign-off; it exists precisely for the cases nobody plans for.
