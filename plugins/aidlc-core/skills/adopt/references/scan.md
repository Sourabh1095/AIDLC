# /aidlc:adopt — 3 · Per-root scan — manifests first, source last

Part of the adopt skill: this step, moved out so the skill fits in one read. Read it in full when the scan
reaches this step; every rule in `SKILL.md` (the five rules, the safety contract) still applies here.

Prefer manifest and config parsing over reading source: cheaper, deterministic, and it avoids pulling
proprietary code into context. Skip, and record in `scan.skipped`: `node_modules/`, `vendor/`,
`.venv/`, `target/`, `dist/`, `build/`, `out/`, `bin/`, `obj/`, `.next/`, `.nuxt/`, `__pycache__/`,
`.gradle/`, `Pods/`, `coverage/`, minified and generated files, LFS pointer files (reading one
profiles the pointer, not the content), and anything `.gitignore`d.

**VCS state.** Establish *whether the root is a repo* before asking anything else about it, and
**never use `rev-parse --is-inside-work-tree` for that** — git searches ancestor directories, so it
answers `true` for any folder that merely *sits inside* some other repo. A home directory under git
(common) makes every folder beneath it report `true`, and every follow-up question then silently
answers about the **ancestor**: its branch, its remotes, its history, its size, recorded against your
root with a citation. That is a confidently wrong profile, which is the one outcome this skill exists
to prevent. The correct probe is two steps:

1. **Marker test.** Is there a `<root>/.git`? A **directory** ⇒ a normal repo root. A **file** ⇒ a
   linked worktree or a submodule (it holds a `gitdir:` pointer) — resolve and label it as such, never
   as a plain repo. Also check `<root>/.hg`, `<root>/.svn`, `<root>/.p4config`, `<root>/$tf`.
2. **Confirm the boundary.** `git -C "<root>" rev-parse --show-toplevel`, and require the result to
   **equal the root**. Ask even when step 1 found no marker: a root with no `.git` of its own is
   precisely the enclosing-repo case. Equal ⇒ the root is its own repo. Different ⇒ the root is
   **not** a repo; it sits *inside* the returned one. Record that as `enclosingRepo` and report it as
   a hazard — files there are inside someone else's index, one `git add -A` from being committed to
   it — and record this root's own `vcs.system` from its markers (`none`, `mercurial`, …), never from
   the ancestor. The same rule governs the **control plane**: if it is not its own repo root,
   `scan.commit` is `unknown`, not the enclosing repo's HEAD.

**Do both steps with the helper, not by eye:**

```
node "<this skill's directory>/resolve-root.mjs" "<root>" ["<root>" …]
```

"Equal" is the whole check, and it has now produced a confidently wrong profile **twice** — which is
why it is code with a test suite rather than a comparison you make in your head. Phase 1 used
`rev-parse --is-inside-work-tree`, which answers `true` for any folder beneath any repo. The
replacement compared paths in **different forms**: `rev-parse --show-toplevel` always answers in drive
form (`C:/Users/…`), while the folder scan in §1.2 hands you MSYS form (`/c/Users/…`) on Windows,
because Claude Code's Bash tool is Git Bash. They never compare equal, so **every** repo came back
"not a repo, enclosed by itself" — and the control plane doing so drops `scan.commit` to `unknown`,
which is what the staleness check and `/aidlc:remove`'s verification baseline both read.

Both failures look like a working check, because the negative case still comes out right.

**Canonicalise every root path once, at discovery, before it is compared, probed or recorded.** §1
requires running both discovery paths, and they disagree on form: the workspace file resolved through
node gives `C:\…`, the folder scan gives `/c/…`. Mixing them has a second bite — MSYS paths are not
valid to non-MSYS tools, so `fs.existsSync("/c/…")` is **false** for a directory that exists, and
`not-cloned` is a legitimate classification. An uncanonicalised root therefore reads as *"declared but
never cloned"* while sitting on disk. `resolve-root.mjs` exports `canonicalPath` (what to store) and
`normaliseRootPath` (what to compare) for exactly this; if it is missing, canonicalise by hand —
backslashes to forward slashes, `/c/x` and `/mnt/c/x` and `/cygdrive/c/x` to `C:/x`, strip `\\?\`,
drop trailing slashes, and compare case-insensitively — and say in the report that you did it by hand.

Only once step 2 says the root *is* a git repo, ask the rest — all read-only, all allowlisted, always
`git -C "<root>"` so no `cd` is needed: `rev-parse --abbrev-ref HEAD` (current branch) ·
`rev-parse --is-shallow-repository` · `remote -v` · `submodule status` · `worktree list` ·
`for-each-ref --sort=-committerdate refs/heads` (branch shape, bounded) · `lfs env` ·
`count-objects -vH` (size).

**The default branch needs a fallback chain, not one probe.** `rev-parse --abbrev-ref <remote>/HEAD` is
the high-confidence answer, but it exits **rc=128 with a `fatal:` on stderr whenever `origin/HEAD` was
never set locally** — which is the normal state of any repo whose remote was *added* rather than cloned
from. Do not stop there and do not guess `main` because it is common. Work down:

1. `rev-parse --abbrev-ref <remote>/HEAD` ⇒ **high**.
2. `for-each-ref --format=%(refname:short) refs/remotes/<remote>` — if exactly one of
   `main`/`master`/`trunk`/`develop` exists remotely ⇒ **medium**.
3. **Cardinality before naming.** `for-each-ref --format=%(refname:short) refs/heads` — if the repo
   has **exactly one local branch**, that branch is the default: there is nothing for a name
   heuristic to disambiguate ⇒ **medium**, citing the count. A repo whose only branch is `trunk`,
   `dev` or `mainline` is answered here, and it is the commonest shape a name test gets wrong.
4. Otherwise, among several local branches — if exactly one of `main`/`master`/`trunk`/`develop`
   exists **and** every other local branch is reachable from it or reaches it
   (`merge-base --is-ancestor`, either direction) ⇒ **medium**, citing both.
5. Otherwise `unknown`, and the apply step asks.

Keep the trunk-ish set the same at every step. An earlier version counted `trunk` at step 2 and not
at step 3, which left a single-branch `trunk` repo — one branch, checked out, nothing ambiguous about
it — recorded `unknown`.

This matters more than most facts: `defaultBranch` is what `<base>` falls back to, so leaving it unknown
when the repo's own refs answer it strands the pipeline with nowhere to branch from.
**Strip credentials from every remote URL before recording or printing it** — an Azure/GitHub remote
commonly embeds a PAT (`https://user:token@…`), which makes an unredacted `remote -v` a secret leak
into a file you are about to write. Do **not** reach for `git config` to fill a gap here: it is a write
verb as well as a read one, its read form dumps that same credential, and it is deliberately not
allowlisted (`docs/permissions-rationale.md`). A fact you can only get from git config is `unknown`.
**A non-git root still gets profiled**: `.hg` → mercurial, `.svn` → svn, `.p4config`/`P4CONFIG`
→ perforce, `$tf/` → tfvc, nothing → `none`. Record the system, mark `support: unsupported`, profile
the code anyway, and offer `git init` as a *suggestion* — never run it.

**Languages and package managers**, from manifests, with the **paths that carry each**. A polyglot
repo lists **all** of them — an API in Go beside a web app in TS beside Terraform is three entries,
not one dominant guess:

| Manifest | Language | Package manager from |
|---|---|---|
| `package.json` | TS/JS | `package-lock.json`→npm · `pnpm-lock.yaml`→pnpm · `yarn.lock`→yarn · `bun.lockb`→bun |
| `pyproject.toml` · `requirements*.txt` · `setup.py` · `Pipfile` | Python | `[tool.poetry]`/`[tool.uv]`/`[tool.pdm]` · pip · pipenv |
| `pom.xml` · `build.gradle(.kts)` · `settings.gradle*` | Java/Kotlin | Maven · Gradle |
| `*.csproj` · `*.fsproj` · `*.sln` · `Directory.Build.props` | C#/.NET | dotnet/NuGet |
| `go.mod` | Go | go modules |
| `Gemfile` · `*.gemspec` | Ruby | bundler |
| `composer.json` | PHP | composer |
| `Cargo.toml` | Rust | cargo |
| `mix.exs` · `Package.swift` · `pubspec.yaml` | Elixir · Swift · Dart/Flutter | mix · SwiftPM · pub |

Versions come from what the **project declares** (`requires-python`, `engines`, `<java.version>`,
`go 1.x`), never from what happens to be installed on this machine.

**Frameworks** from dependency names + config files (Next/Nest/Django/FastAPI/Flask/Spring/Rails/
Laravel/.NET/Gin…). **CI** from `.github/workflows/*`, `azure-pipelines.yml`, `.gitlab-ci.yml`,
`Jenkinsfile`, `.circleci/config.yml`, `bitbucket-pipelines.yml`. **Hooks** from `.husky/`,
`.pre-commit-config.yaml`, `lefthook.yml` — recorded so the AIDLC pre-commit layer never duplicates a
layer the project already has. **Migration tooling** and its directory (Prisma, TypeORM, Alembic,
Flyway, Liquibase, EF Core, Rails, Django, golang-migrate). **Containers** from `Dockerfile`,
`compose*.y*ml`, `.devcontainer/` — the difference between a gate that needs services and one that
does not. **Other agent configs** (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`,
`.github/copilot-instructions.md`) — detected so they are *referenced*, never duplicated or clobbered.
**Existing architecture docs** (`docs/adr/`, `RFCs/`, a Confluence/Notion link in the README) — noted
by location so they can be linked later, never copied or relocated.

**Entry points** — the commands the project *already has*, read from `package.json` scripts, `Makefile`
/ `Taskfile.yml` / `justfile` targets, `tox.ini` / `noxfile.py` / `pytest.ini` / `setup.cfg`, Maven and
Gradle goals, `*.sln`, `go test ./...`, `cargo`, `bundle exec`, `composer.json` scripts,
`.pre-commit-config.yaml`, and Nx/Turbo/Lerna targets. Record the command **verbatim, as the project
runs it** plus its `source`. Two distinctions carry all the weight:

- A command that **provably does not exist** is `status: absent` with `absence` evidence naming what
  you searched. It is a **coverage hole**, and downstream it must never be counted green. It is *not*
  `unknown`, and it is *never* replaced by an AIDLC default.
- A step **the stack cannot have** is `status: not-applicable`, not `absent`. A Django service is
  deployed from source and has no `build`; Go type-checks during `go build`, so a separate `typecheck`
  cannot exist; a repo with no schema has no `migrate`. The difference is whether the team could ever
  close it: `absent` is a hole they could fill, `not-applicable` is a step that does not exist for this
  stack. Recording the second as the first makes every future run report holes nobody can fill, and
  makes `/aidlc:adopt-backlog` propose *"add a build gate"* as the first item a brownfield team reads —
  and §8's own rule is that a backlog whose first item is provably wrong is one nobody reads twice.
  **`not-applicable` must carry evidence saying why**, because it suppresses a coverage hole, and an
  unexplained suppression silently excuses a gate the project really is missing.
- **`not-applicable` is a `gates[]` status, not a fact form.** In `entryPoints` the answer stays
  `absent`: that map records *which commands exist*, and "no build command exists" is simply true. The
  three fact forms (`known` / `absent` / `unknown`) stay exhaustive — there is no fourth, anywhere. The
  gate is where the coverage-hole meaning lives, so the gate is where the distinction belongs. Put the
  *why* in the entry point's `absence` note as well, so the two records agree.
- A command needing services (compose, testcontainers, a live DB) is marked
  `environmentDependent: true`, so a later failure is diagnosed as *environment unavailable* rather
  than *code broken*.

**Never execute an entry point.** Detection reads; it does not run the suite.

**The gate (`gates[]`) — an ordered sequence, derived, never assumed.** Entry points say what commands
exist; the gate says what the pipeline will *run per item*, in what order. Build it from the entry
points, the pre-existing hooks and the CI config:

- **Order.** If CI declares an order, **mirror CI's** — that is the project's own answer and adopting it
  keeps local and remote verdicts comparable. Absent that, cheapest-first: `format` → `lint` →
  `typecheck` → `boundaries` → `build` → `test`, so a run fails in seconds rather than minutes.
- **`required`.** A `present` gate is required unless the project itself treats it as advisory — CI
  `continue-on-error`, a script ending `|| true`, a hook stage marked manual. Cite that evidence when you
  set it false. An `absent` or `not-applicable` gate is **never** required: it cannot block, and marking
  it required is how a coverage hole comes to read as green.
- **`scope`.** `affected` where an affected-graph runner exists (Nx, Turbo) — the cheap correct default,
  and the run must name the affected set. `package` for a gate defined inside one package of a monorepo.
  `changed-paths` only for a suite too slow to run whole. Otherwise `repo`.
- **`timeoutMinutes`** only when the **project** states one (a CI job timeout). You have not run the
  suite, so you do not know how long it takes — **do not estimate**. Where duration matters and is
  unknown, say so and let the apply step ask; an invented number would silently decide how much of the
  suite ever runs again.
- **`environmentDependent` + `services`.** True when the command or its config reaches for services — a
  compose file, testcontainers, a `DATABASE_URL`, a broker fixture. This is the difference between a run
  report that says *environment unavailable* and one that blames the diff.
- **`providedByHook`.** When husky / pre-commit / lefthook already runs a gate at commit time, record
  which — so the AIDLC pre-commit layer is never installed on top of a layer the project already has.
- **`alsoInCi`.** Whether CI runs the same gate. A gate local-only or CI-only is a **parity gap** worth
  naming in the report; do not silently reconcile it.
- **Never execute a gate to find out.** Detection reads configuration. Running the suite would be slow,
  could mutate a database, and is not this command's job.

**Conventions (`conventions`) — the project wins.** Derive from **bounded** history plus, optionally,
read-only host settings. State the bound (e.g. "last 50 commits, 30 most recent branches") in the
evidence — an unbounded history walk on a large repo is its own cost problem. All of these are
`git -C "<root>"`:

| Convention | Signal |
|---|---|
| `branchPattern` | `for-each-ref --format=%(refname:short) refs/heads refs/remotes` (bounded, most recent first) — infer the shape, e.g. `{type}/{id}-{slug}` vs `JIRA-123-description`. **A healthy repo deletes merged branches**, so refs alone often show only long-lived ones; that is not "no convention". Recover names from history before giving up: merge-commit subjects (`log --merges -20 --format=%s` yields `Merge branch 'PAY-31-ledger-export' into develop`), squash subjects carrying a PR number, and `reflog` where it survives. Name the source you used — a pattern read from merge subjects is `medium` at best |
| `commitStyle` | `log -50 --format=%s` — classify as conventional · id-prefixed · imperative-freeform · **mixed** · none |
| `mergeStrategy` | `log --merges -20 <default>`: merge commits present ⇒ `merge`; none on a linear default branch ⇒ squash **or** rebase, which history alone cannot separate — record `medium` confidence and say which two, or read the host's allowed-merge settings |
| `integrationBranch` | a long-lived **non-default** branch that feature work merges into (`develop`) — needs *both* the branch and recent merges into it, not just the name |
| `longLivedBranches` | `develop`, `release/*`, `hotfix/*`, or any branch with an old root and recent commits |
| `hotfixRoute` | `hotfix/*` branches, and where they merge back to |
| `codeowners` | `CODEOWNERS` at the repo root, `.github/` or `docs/` — record path + rule count, not the owner names |
| `requiredReviewers`, `protectedBranches` | host API, **read-only GET only** (`gh api repos/{owner}/{repo}/branches/{b}/protection`, `az repos policy list`). Optional and skippable — `gh api` is deliberately *not* allowlisted (it can `--method POST`), so it will prompt; a user who declines is a normal outcome recorded `unknown` |
| `pushAccess` | `gh api repos/{owner}/{repo} --jq .permissions.push` ⇒ `false` means `fork-only`; an `upstream` remote alongside a personal `origin` says the same |
| `activeAuthors` | `shortlog -sne --since="90 days ago"` on the default branch — distinct authors with recent commits. This is the **`team.mode` signal**, and it is a *proposal only*: a repo with twelve historical contributors and one active maintainer is solo, and a brand-new team repo shows one author. Record the count and the window; `/aidlc:adopt-apply` asks, never decides (`aidlc:work-items` → *Ownership*). Normalize obvious duplicates (same person, two emails) before counting, or every rebase-happy repo looks like a crowd |

Three rules that decide whether this is worth anything:

1. **`unknown` is not "none".** An unreadable branch-protection API means `unknown`, **never** `absent`.
   Recording "no protection" because you could not look is how a repo gets reported as safely gated, or
   as ungated, on no evidence. Only an API that *answers* "no protection" earns `absent` — and that
   answer must be named loudly, since it means this repo's PRs merge **ungated**.
2. **A shallow clone bounds every history-derived convention.** If `vcs.shallow` is true, say so in the
   evidence for each and drop confidence — you are reading a truncated history.
3. **Where the project has no convention, record nothing here.** Do not write AIDLC's defaults into
   `conventions` as though they were detected. The apply step marks defaults as defaults
   (`conventionsSource: "default"`); the profile records only what the code actually shows.

**Cross-platform hazards**, when the workspace is mixed-OS (a Windows dev with Linux CI is the common
case). Note the presence or absence of `.gitattributes` and check line endings with
`git -C "<root>" ls-files --eol` — a repo with mixed CRLF/LF and no `.gitattributes` churns every diff.
Note too whether a committed lockfile was generated on a different OS than CI runs on (npm resolves
platform-specific optional deps, so a Windows-generated `package-lock.json` can be unsatisfiable under
`npm ci` on Linux), and whether two paths differ only by case (fine on Windows, two files on Linux).
Record these as findings, not fixes — `aidlc:init` Step 4.5 owns the remedy.

**Monorepo packages — the routing dimension, not a folder listing.** On a `monorepo` root, enumerate
`packages[]` from the workspace manifest. A monorepo is *one git repo with many independently-owned
packages*, so the package is what work actually routes to; a `repos[]` entry cannot express it, because
`repos[]` means a git boundary and there is exactly one. Record per package:

- **`name`** as the package's **own manifest declares it** (`@acme/web`, `acme-worker`, the Maven
  `artifactId`) — never the folder name if they differ. It keys the per-package gate overrides and
  labels the PR, so a name invented here silently fails to match anything.
- **`path`**, relative to the root, and a derived one-line **`role`** plus **`labels`** — the same
  routing hints a repo entry carries, because routing works the same way.
- **`stack`** per package. A Next.js app beside a Python worker in one repo is the ordinary case, and
  resolving stack per *repo* would hand the worker the web coding standards.
- **`languages`** and per-package **`entryPoints`** (a package's own `test`/`lint`, which become its
  gate layer).
- **`dependsOn`** — sibling packages this one depends on, read from the manifests (a `workspace:`
  protocol dependency, a Maven module dependency, a Cargo `path` dependency). This is what lets
  cross-package work sequence exactly as cross-repo work does: the shared package lands before its
  consumers. Names must resolve to siblings, and the graph must be **acyclic** — a cycle leaves "which
  lands first" with no answer, so record it as a finding rather than emitting an arbitrary order.
- **`releasable`** — whether the repo's tooling versions and publishes *this package* on its own
  cadence. Only claim it where the evidence does: a `.changeset/config.json` listing it, `lerna.json`
  with `"version": "independent"`, an `nx release` config, its own publishable manifest.

Record `workspaceTooling` — and note whether it is an **affected-graph runner** (Nx, Turbo), since that
is what later lets a per-item gate run affected targets only. Together these make a monorepo root
representable *beside* single-app roots without inventing a new layout value.

**Release tooling (`releaseTooling`).** Per root: `changesets` (`.changeset/`) · `lerna`
(`lerna.json`, noting `version: independent`) · `nx-release` · `semantic-release` · `maven-versions` ·
`cargo-release` · `manual`, plus whether packages version **independently**. This is the fact that
decides whether a per-package release is even possible — `/aidlc:release` must cut one where the tooling
supports it and **say plainly that it cannot** where it does not, rather than tagging something the
project has no way to publish. No release tooling at all is `status: absent` — an answer, not a gap in
the scan. Do **not** mark any package `releasable` on a root whose `releaseTooling` you could not
establish: that combination promises a cadence the repo cannot deliver, and the validator rejects it.

**Size and sampling.** Before reading a large root, size it (`git count-objects -vH`, or a file count).
Above the depth's cap, **sample instead of reading fully**: all manifests, all config, all entry
points, then breadth-first across source directories. Record `sampling.strategy` and the honest
`coveragePercent` — never round it up, and never let a sampled root's silence read as a clean bill.
