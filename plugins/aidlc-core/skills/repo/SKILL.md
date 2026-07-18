---
name: repo
description: Declare and bootstrap a repo in a poly (multi-repo) AIDLC workspace — append it to repos[] in aidlc.config.json, git-init the folder with the configured default branch, and make a base commit so the pipeline can branch into it immediately. Use when work references a repo that isn't declared yet (a shared lib, a new product), or to add a repo to a poly workspace.
argument-hint: "add <name> | list"
disable-model-invocation: true
---

# /aidlc:repo $ARGUMENTS — manage repos in a poly workspace

The chicken-and-egg fix for poly workspaces (F2/F4): real work references repos that don't exist in
`repos[]` yet (a shared `dev-config` lib, a future product), and local-mode branching needs each repo
to already be a git repo with a base commit. This command **declares a repo in config AND bootstraps
the folder** in one step, so `/aidlc:run` can route to it and branch into it right away.

Run it in an INTERACTIVE session (it edits `aidlc.config.json` and creates commits). Sub-commands:

## `list`

Read `.claude/aidlc.config.json` → `repos[]` and print each repo: `name`, `path`, `role`, `host`,
`mode`, `defaultBranch`, `stack`, and whether its folder exists + is a git repo with a commit
(bootstrapped) or still needs bootstrapping. In **mono** (`repos[]` empty), say so — this command is a
poly helper.

## `add <name>`

### 1 · Preconditions
- Read `.claude/aidlc.config.json`. If `workspace.layout` isn't `poly` (or `repos[]` is empty/absent),
  this is a mono workspace — explain that adding a repo means converting to poly, and confirm before
  proceeding (set `workspace.layout: "poly"`, and migrate the top-level `git`/`stack`/`ux` into the
  existing single repo as the first `repos[]` entry so nothing is lost).
- If a repo named `<name>` already exists in `repos[]`, stop and show it (offer `list`).

### 2 · Collect the repo entry (AskUserQuestion where available)
Same fields as `/aidlc:init` Step 3 (poly): `name`, `path` (relative to `workspace.root`, default
`<name>`), `role` (one-line), `host` (`github` | `azure-repos`), `mode` (`remote` | `local` — if no
remote will be configured, `local`), `remote` (`origin`), `defaultBranch` (default from a sibling repo
or `main`), `labels` (routing hints), and per-repo `stack`. For a **frontend** repo also collect
`ux.renderBaseUrl` + `uiPaths` — **derive or ask the real dev-server port; don't default to :3000, and
flag any collision** with another repo's port (F13). Mark `default: true` only if the workspace has no
default yet.

### 3 · Write config
Append the assembled entry to `repos[]`. Re-read the file after writing and confirm the entry is
present and valid JSON (write-verification discipline — a silent bad write here breaks routing).

### 3b · Ignore the checkout at the control plane — BEFORE creating the folder
Append `/<path>/` to the control-plane `.gitignore`, inside its managed `# AIDLC:REPOS` block (create
the block if the workspace predates it; see `/aidlc:init` Step 4.4). Do this **before** Step 4 creates
the folder, so the new repo is never visible to the control-plane index even briefly. Verify with
`git -C <workspace.root> check-ignore -q <path>`. Without it, the next `git add -A` at the control
plane commits the repo as a mode-160000 gitlink — a submodule with no `.gitmodules`, which clones as
an empty directory and reports no error. The `guard` hook blocks that commit, but this is the fix that
stops it from arising.

### 4 · Bootstrap the folder (so the pipeline can branch into it — F4)
If `<path>` is missing or not a git repo:
1. Create the folder.
2. `git init -b <defaultBranch>` (normalize the branch to the configured default — never leave
   `master` while config says `main`, cf. F6).
3. Lay down an initial payload and **base-commit** it (the pipeline needs at least one commit to branch
   from in local mode):
   - a stub `README.md` (repo name + role), and
   - **if `aidlc-stack-web` is installed and the repo is TypeScript-based**, the strict tooling baseline
     + enterprise structure skeleton + `.dependency-cruiser.<flavor>.cjs` + hardened `.gitignore`,
     exactly as `/aidlc:init` Steps 4.4–4.6 do (glob `**/aidlc-stack-web/templates/`). Skip for non-TS
     repos.
4. `git add -A && git commit -m "chore: bootstrap <name> repo"` on `<defaultBranch>`.
If the folder already exists and is a non-empty git repo, skip bootstrapping and just record it.

### 5 · Report
Print: the new `repos[]` entry, whether the folder was bootstrapped (and the base-commit sha) or
already existed, and the next action — e.g. "route work here by setting an item's `repo: <name>`, or
run `/aidlc:run <ID>` for an item that resolves to it." Do NOT commit `aidlc.config.json` automatically —
show `git status` at the control plane and let the user commit the config change.

## Notes
- This is the helper referenced by `aidlc:run` §2.5 (undeclared-repo routing) and `aidlc:init` Step 4
  (greenfield bootstrap) — same mechanism, invocable on demand.
- Declaring a repo never touches the other repos. Bootstrapping only ever creates a new folder + its
  first commit; it never rewrites an existing repo's history.
