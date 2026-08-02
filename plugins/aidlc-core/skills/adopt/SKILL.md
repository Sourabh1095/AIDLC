---
name: adopt
description: Scan an existing workspace — one repo or several, in one folder or a multi-root VS Code workspace — and derive an evidence-backed profile of its topology, languages, package managers, frameworks, monorepo packages, gates, CI, VCS state, SaaS runtime constraints (tenancy, feature flags, migrations, API contracts, compliance), undocumented architecture decisions, debt worth tracking and capability gaps. On an already-adopted workspace it also reports drift against the last scan. Read-only: writes only .aidlc/adoption/profile.json and report.md. The brownfield counterpart to /aidlc:bootstrap, which infers a project's shape from a requirements document — adopt infers it from the code that is already there. Use when adopting AIDLC on a project that already has code, before answering /aidlc:init's topology and stack questions from memory, or to re-scan an adopted workspace for drift.
argument-hint: "[--depth quick|standard|deep] [--max-adrs <n>] [--max-debt <n>] [--only <root|package>]"
disable-model-invocation: true
---

# /aidlc:adopt — read the code, derive the facts, prove each one

`/aidlc:bootstrap` derives a project's shape from a **requirements document**. This door derives it
from **the code that is already there** — so a brownfield team stops answering mono-vs-poly, stack and
commands from memory, on a codebase the framework has never read.

**This command writes exactly two files and nothing else:** `.aidlc/adoption/profile.json` (the
machine-readable contract) and `.aidlc/adoption/report.md`. No config, no `CLAUDE.md`, no rules, no work
items, no branch, no commit. Turning the profile into configuration is a **separate command**,
`/aidlc:adopt-apply`, which shows the full diff and writes nothing without approval. That separation is
deliberate: it makes this command safe to run on first contact, with nothing to undo.

The profile's full contract is `adoption-profile.schema.json`, published at
`https://raw.githubusercontent.com/bee-logical/AIDLC/main/docs/adoption-profile.schema.json`. **Do not
fetch it** — this skill makes no network calls. Read it only if a local copy is at hand (an AIDLC clone
in the workspace); otherwise §10's skeleton is the contract you must satisfy, and it is sufficient.

## The five rules — they outrank any instinct to be helpful

1. **Evidence or silence.** Every fact carries a `path:line` (or a command and its output) and a
   confidence. A fact you cannot evidence is recorded `unknown` **with the reason** — never guessed,
   never defaulted. This is the whole point: an inferred value that reaches `CLAUDE.md` as ground
   truth silently steers every later run, and is worse than an empty placeholder.
2. **Read-only.** Nothing outside `.aidlc/adoption/`. No `git init`, no `git add`, no branch, no
   `npm install`, no running of the project's build or test suite.
3. **Adopt, don't impose.** Where the project has a convention — structure, lint config, branch
   names, commit style, gates — the project wins and you record it. AIDLC's defaults are for a vacuum
   and are labelled as defaults.
4. **Honest degradation.** An unsupported stack, tracker or VCS is *reported as unsupported* and
   recorded as a capability gap. Never imply coverage that the installed plugins do not provide.
5. **Bounded, and say where the bound was.** Cost is capped; the report states the cap, what it cost,
   and what was **not** looked at. "Clean" and "not read" must never be indistinguishable.

`$ARGUMENTS` may carry `--depth quick|standard|deep` (default `standard`), `--max-adrs <n>` (default
8, §6), `--max-debt <n>` (default 20, §8) and `--only <root|package>` (§9):
**quick** — manifests, IDE/VCS metadata, top-level config only; the ten-minute pass, useful on its
own. **standard** — adds config parsing, CI files, package/workspace enumeration, bounded git history.
**deep** — adds bounded source sampling for facts only source can evidence: the SaaS runtime
constraints of §5 and most of §6's decision evidence live here. Depth is a cost dial, not
a quality dial: a shallower scan records **more `unknown`**, never a weaker guess. So a `quick` scan
is *expected* to leave §5 and §6 nearly empty, and that emptiness must read as "not looked at" in the
report, never as "this project has no runtime constraints".

## 0 · Safety contract — settle this before the first read

State these to the user in two or three lines, then proceed. Do not ask permission to be careful.

- **Env files.** Never read and never print `.env` / `.env.*`. Record **paths only**. Variable *names*
  may be recorded only if `pipeline.envFileAccess` is `ask` **and** the user approves that specific
  read — the `env-guard` hook is the enforcement and you do not work around it. Values: never.
  A **git-tracked** env file is itself a finding worth reporting.
- **Secrets.** If a credential pattern surfaces (working tree or history), record **location + type,
  redacted** (`safety.secretFindings`). Never the value — not in the profile, not in the report, not
  in an item, not in a commit message, not in your own chat output.
- **PII.** Fixture/seed files whose columns look personal (email, phone, dob, national id) are flagged
  by path + signal and **excluded from every excerpt** the report quotes.
- **No network for analysis, and no exfiltration ever.** Every derived fact comes from local static
  evidence. **No source, path listing, manifest or excerpt is sent to any external service** — not to a
  model endpoint you reach for on purpose, not to an MCP server, not to a package registry, not to fetch
  this skill's own schema. The single exception is an **optional, read-only host-metadata lookup** (a
  repo's branch protection or required checks via `gh`/`az`), which sends no code, is skippable, and is
  recorded in `scan.network.hostApiCalls`. Offline, air-gapped, or behind a proxy that blocks it: mark
  the dependent checks `unknown`, set `scan.network.offline: true`, and **complete the scan** — an
  unreachable host is never a failed scan.
- **No runtime access.** Static evidence only — never a running service, never a production system,
  never a live database (`rules/safety.md`).
- **Read-only permissions are a supported mode.** If `.aidlc/` cannot be written, do **not** attempt
  it twice: print the whole report to the session, set `scan.writes.sessionOnly: true`, and say
  plainly that nothing was persisted.

## 1 · Discover the workspace — the unit of adoption is the workspace, not the repo

A repo is a routing target. The thing being adopted is the **workspace** the user opened, which is
either one folder with repos as subfolders, or a multi-root `.code-workspace` whose folders may live
anywhere — different parents, different drives, a UNC share. **Run both discovery paths; they are
additive, and using only one is how a multi-root workspace collapses into a single repo:**

1. **IDE artifacts.** Glob `*.code-workspace` in cwd and one level up. **It is JSONC, not JSON** — VS
   Code accepts `//` and `/* */` comments and trailing commas, and real hand-edited workspace files
   contain them, so a bare `JSON.parse` throws. Strip comments and trailing commas first (or parse
   tolerantly). If it *still* will not parse, **say so loudly and stop** — do not fall through to the
   folder scan alone, because that is exactly how a multi-root workspace silently collapses into a
   single repo. Then resolve `folders[]`: each `path` is relative to the **workspace file's own
   directory** (not to cwd) and may escape it (`../platform`) or be absolute on any drive; honour the
   optional `name` override, else use the folder's basename. A `folders[]` entry whose resolved path
   does not exist is a **`not-cloned`** root — record it, never fabricate a path for it. Read
   `settings`/`extensions` only as signals, never for behaviour.
2. **Folder scan.** Look for `<sub>/.git` (and `<sub>/.hg`, `<sub>/.svn`) one and two levels down,
   plus a VCS marker in cwd itself.

Then place the control plane, deterministically:

- The folder **holding the `.code-workspace` file** when one exists; otherwise the **opened folder**.
  Anchoring to the workspace file rather than to cwd is deliberate — which folder the IDE hands the
  session as cwd in a multi-root workspace is not something to rely on.
- **Never silently a product repo.** If the resolved folder is a product repo, say so and ask.
- If the control-plane folder is not itself a workspace root, note that it must be added as one (the
  session cannot write there otherwise) and record `controlPlane.isWorkspaceRoot: false`.
- An existing `aidlc.config.json` at the control plane makes this a **re-adoption**: record
  `alreadyAdopted: true` and treat the recorded profile as the drift baseline.

**No IDE is not a degraded case.** JetBrains, a plain terminal and headless CI have no
`.code-workspace`; the folder scan is then the only signal and everything below is unchanged. Nothing
here requires an IDE to be present.

## 2 · Classify every root — propose, never assume

For each discovered root produce a `root` entry (`definitions.root` in the profile schema):

| Classification | Signal | Consequence |
|---|---|---|
| `product-repo` | own VCS root, our code, one deliverable | candidate `repos[]` entry |
| `monorepo` | own VCS root + a workspace manifest (pnpm/npm/yarn workspaces, `nx.json`, `turbo.json`, `lerna.json`, Maven modules, Gradle composite, `Cargo.toml [workspace]`, Bazel) | candidate `repos[]` entry **with `packages[]`** |
| `control-plane` | the folder holding `.code-workspace`, the board, `docs/adr/`, `aidlc.config.json` and the tracked profile — **usually its own git repo**, and no product code | excluded from `repos[]` **by name**, never a routing target |
| `non-repo` | **no VCS root** — docs, scratch, notes | excluded from `repos[]`, and the report says why |
| `reference-only` | a clone we read but do not change (vendor SDK, tracked upstream) | **never** a routing target |
| `already-adopted` | carries its own `aidlc.config.json` | reconcile, do not re-derive |
| `not-cloned` | declared in the workspace file but absent on disk | recorded; **never fabricate a path** |

Every classification is **proposed for confirmation** — present the list once, compactly, and let the
user correct it. Only `product-repo` and `monorepo` may become `repos[]` entries later.

**The control plane needs its own row for a specific reason.** In a poly workspace it is normally a git
repo — it holds the board, the ADRs, the config and the profile that §10 requires be *tracked*. Neither
of the two labels it would otherwise get is harmless: `non-repo` is factually false and loses the fact
that what you write there has history (which §9's drift baseline depends on), while `product-repo` makes
it a **routing target**, so `/aidlc:run` dispatches work to a repo with no code. If it holds product
code *as well* as the board, it is a `product-repo` that happens to hold the board — say so and treat it
as one.

Then, per root, establish the three things that otherwise fail silently much later:

- **Reachable?** Prove you can actually read it (a directory listing or one file read). If the session
  cannot — a root outside cwd in a multi-root workspace — record `reachable.value: false` with the
  **exact remedy** (`/add-dir "<abs path>"` in-session, or restart with `--add-dir "<abs path>"`).
  **Never report a repo as configured, profiled or adopted when you could not read it.**
- **Trusted, and is AIDLC enabled at that scope?** An untrusted root, or one where the plugin is not
  enabled, fails at the first `/aidlc:sprint` launch with no useful message (the F42 failure mode).
  Catch it here: check for a `.claude/settings.json` at the root and whether it enables the aidlc
  plugins. If harness trust state cannot be established from inside the session, record it `unknown`
  with the reason **and state the symptom plus the fix** — do not report it as fine.
- **Nested under the control plane?** Set `nestedUnderControlPlane`. This is load-bearing twice:
  a non-nested root needs an **absolute** `repo.path` in config, and the `.gitignore` / gitlink
  protection (`aidlc:init` Step 4.4) is **inapplicable** to it — there is no control-plane git index
  it could be staged into. Say that in the report rather than reporting the protection as missing.
  For a nested root the protection applies unchanged.

**Nested git repos are classified, never flattened.** A root that contains further git repos (a
`services/` folder holding four of them, or a non-repo root that is really a container) yields **one
entry per repo**, plus the container classified on its own. Report the nesting as a hazard — a repo
sitting untracked inside another repo's work tree is one `git add -A` away from being committed as a
mode-160000 gitlink — and never silently collapse the set into the outermost folder.
**Submodules and subtrees are detected and reported, but are never AIDLC repos**: a submodule is pinned
to a commit recorded by its parent, which is incompatible with the per-repo release cadence a `repos[]`
entry implies. Record them under `vcs.submodules` and say so.

**Paths are hostile.** Spaces, UNC (`\\server\share\...`), and cross-drive paths must survive into the
profile and back out. Always quote paths in any command you run, and never rebuild a path by
string-joining a relative fragment onto the wrong base. Store `absolutePath` **canonicalised**, not
verbatim (`resolve-root.mjs`'s `canonicalPath` — forward slashes, drive-letter form, original case
kept): "verbatim" preserves whichever form discovery happened to produce, and §3 shows what mixing
forms costs. One root, one spelling, everywhere in the profile.

## 3 · Per-root scan — manifests first, source last

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

## 4 · Topology — one classification, with the deciding signal named

Classify the **workspace**: `single-app` (one repo, one deliverable) · `monorepo` (one git repo, many
packages) · `poly` (many git repos) · `unknown`. Name the deciding signal in `evidence` — "three roots
each with their own `.git`", "one `.git` plus `pnpm-workspace.yaml` listing 6 packages". A topology
with no named signal is a guess wearing a label. A workspace that mixes a monorepo root with
single-app roots is `poly` at the workspace level, with `packages[]` on that one root's entry.

## 5 · SaaS runtime constraints — the facts that change how code must be written

For a live product, the facts that most constrain an implementation are **not in the stack list**.
"TypeScript + Postgres" says almost nothing about what a safe change looks like; "shared-schema
multi-tenant on `tenant_id`, migrations run against live customer data, releases ride LaunchDarkly
flags, and `openapi/public-v1.yaml` is a published contract" says nearly everything. Those are the
facts that turn a plausible diff into a cross-tenant data leak or a breaking change for every
integrator — and on a brownfield project nobody writes them down, because everyone already knows them.

Record them per root as `saas`. This is mostly a **`--depth deep`** section: tenancy and isolation are
evidenced in source and schema, not in a manifest. At `quick` or `standard`, record what the manifests
and config do show and leave the rest `unknown` **with the reason "not sampled at this depth"** — never
`absent`, and never a default.

| Constraint | Where the evidence is |
|---|---|
| `tenancy` | The schema, not the README. **shared-schema**: a `tenant_id`/`org_id`/`account_id`/`workspace_id` column across many tables (ORM models, migrations, `schema.prisma`, `models.py`, entity classes), a request-scoped scoping middleware/interceptor, Postgres row-level-security (`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`), or an ORM global scope (Rails `default_scope`, Django manager, a Prisma client extension). **schema-per-tenant**: a per-request `SET search_path` / `USE <schema>`, a schema resolver, `django-tenants`, the `apartment` gem. **database-per-tenant**: a connection resolver keyed by tenant, or a tenants registry holding per-tenant connection targets (record that it exists; **never read the connection values**). **single-tenant**: no tenant key anywhere plus per-customer deploy config. **not-multi-tenant**: a library, CLI or internal tool with no tenants at all |
| `tenantKey` | The column or claim name itself (`tenant_id`, `org_id`) — a reviewer checks a new query against it, so the name matters more than the model label |
| `tenantIsolationPaths` | The files implementing the mechanism: the scoping middleware, the RLS policy directory, the connection resolver |
| `authPaths` | Authentication, authorization, SSO, RBAC, session handling — guards, strategies, policy modules, `@Roles`-style decorators |
| `billingPaths` | Billing, subscription, entitlement, metering, quota enforcement |
| `featureFlags` | A flag SDK in the manifests (LaunchDarkly, Unleash, Flagsmith, OpenFeature, Split, ConfigCat, PostHog) or a homegrown flag table/module. Set `required: true` **only** where the project's own convention says every user-visible change ships behind one (a CONTRIBUTING rule, a flag wrapper every route goes through) — otherwise record the provider and leave `required` unset |
| `migrations` | Tool + directory, the same detection as `migrationTools[]`; repeated here because the constraint attaches to it |
| `liveDataConstraint` | `expand-contract` where migrations run against data real tenants already have. Direct evidence: paired migrations (add nullable column → backfill → later drop), a documented migration policy, a CI check that rejects destructive DDL. **Not optional to answer:** if tenancy is multi-tenant *and* a migration tool exists, this must come back `known` — leaving it silent means the reviewer brief carries no migration constraint and a dropped column reads as an ordinary refactor. `not-required` needs its own evidence (pre-launch, or migrated on customer upgrade), not merely an absence of proof |
| `apiContracts` | `openapi*.y?ml`/`swagger*`, `*.graphql`/`*.gql`/SDL, `*.proto`, `asyncapi*`, published JSON Schemas, `*.wsdl`. `public: true` when external consumers depend on it — a versioned filename or route (`/v1/`), a published docs site, a client SDK generated from it |
| `environments`, `deployStrategy` | CI/CD config only: GitHub `environment:` keys, ADO stages, k8s overlays/Helm values-per-env, Terraform workspaces, `argo-rollouts`/`flagger`/`canary`/`blue-green` manifests. Never a guess about what a team probably has |
| `freezeWindows` | A schedule guard in the deploy workflow, or a documented change-freeze calendar. **Name the source** — an unsourced freeze would block an integration on a rumour |
| `compliance` | A **named signal**: a BAA reference, a PCI SAQ, a DPA, a SOC 2 control document with evidence owners, an audit-log table, GDPR/DSAR code paths. Never the word "secure" in a README, and never the industry the product serves. A regime raises the review cost of every future change, so an inferred one is an expensive wrong answer |
| `messaging` | Queues, brokers, streams, schedulers, webhook handlers (BullMQ, Celery, Sidekiq, Kafka, SQS/SNS, RabbitMQ, Pub/Sub, cron configs). Their message shapes are contracts with consumers that **no contract file records** |
| `observability` | Sentry, Datadog, OpenTelemetry, New Relic, Prometheus — recorded because incidents are a legitimate intake source, and because a diff that drops instrumentation is a regression no test catches |
| `integrations` | Third-party SDKs and webhook endpoints, by name and path. Sandbox-vs-production credential handling is recorded as a *shape* only; production credentials stay barred by `rules/safety.md` regardless |
| `experimentation` | An A/B or analytics-rollout library, where evidenced |

Then compute **`securityReviewPathSeeds`**: the union of `tenantIsolationPaths`, `authPaths`,
`billingPaths`, and any path a named compliance regime governs. This is the array the apply step
proposes into `pipeline.securityReviewPaths`, and it is the whole mechanism behind "a change to tenant
isolation is security-reviewed regardless of cadence". A path recorded as sensitive above and missing
from the seeds is a path that will be reviewed on the ordinary cadence — recorded as dangerous, treated
as routine. The validator rejects that, because it is invisible in a report that otherwise looks complete.

Five rules specific to this section:

1. **Tenancy describes the system the root takes part in, not only the schema it owns.** A gateway, a
   proxy, a worker, a frontend — a real workspace has several roots with no schema at all, and every
   signal in the table above assumes one. Follow the table literally on a stateless root and you land on
   `not-multi-tenant`, which is the **worst** answer available: it tells every later reviewer that
   cross-tenant leaks are impossible there, and it empties `securityReviewPathSeeds` for that root. The
   fixture case that makes this concrete is an 18-line Go handler that reads a tenant slug off the `Host`
   header and injects it downstream — it owns nothing and *decides everything*, and a bug in it is a
   cross-tenant read with no database involved. So: a root with no schema **inherits** the workspace's
   tenancy at `medium` confidence, with an `absence` note recording that it owns no schema and where the
   value came from — and any file that **determines, forwards or trusts** the tenant is a
   `tenantIsolationPaths` entry, so it reaches the seeds. Reserve `not-multi-tenant` for something with
   no tenants anywhere in its call path (a build tool, a standalone library), and evidence *that*, rather
   than inferring it from an absence of columns. Note why this one is self-sealing: the validator's
   tenancy invariants are all conditioned on the root being multi-tenant, so a wrong
   `not-multi-tenant` switches every downstream check off and the profile still passes.
2. **`unknown` is emphatically not `not-multi-tenant`.** Finding no tenant column because you sampled
   30 files of 4,000 is not evidence of single tenancy — and getting this backwards is the worst
   available outcome, since it tells every later reviewer that cross-tenant leaks are impossible here.
3. **Still no runtime access.** No database connection, no query, no deploy API, no health endpoint.
   Tenancy is read from the schema and the code that uses it (`rules/safety.md`).
4. **Env files stay closed.** Environment *names* come from CI/CD config, never from reading a `.env`.
   §0's contract is unchanged by this section needing environment names.
5. **This block informs; it does not gate.** It feeds the implementer, reviewer and security briefs.
   Exactly two things become conditional gates downstream, and both hang on an evidenced fact: a
   destructive migration where `liveDataConstraint` is `expand-contract` is a review **blocker**, and a
   diff touching an `apiContracts`, `authPaths` or `tenantIsolationPaths` entry is reviewed regardless
   of the configured cadence. Nothing else here blocks anything, and the report says so.

## 6 · Decisions the code embeds with no ADR

`/aidlc:do` and the architect are only as good as `docs/adr/` — and on a brownfield project that
directory is empty while the decisions themselves are everywhere in the code. The scan can close half
of that gap: it can see **what** was decided and prove it. It can never see **why**, and that asymmetry
is the whole design of this section.

Propose candidates in `adrCandidates[]`, one per decision, across these kinds: `framework` ·
`data-store` · `auth-model` · `tenancy-model` · `api-style` · `deployment-topology` · `messaging` ·
`migration-strategy` · `frontend-architecture` · `build-tooling` · `observability` · `other`. Most are
already evidenced by §3 and §5 — this section names them as decisions rather than as detected tools.

- **`title` states the decision, not its topic.** *"Isolate tenants in one shared Postgres schema keyed
  by `tenant_id`"*, not *"Tenancy"*. It becomes the ADR's H1, and a topic makes a useless ADR.
- **Rank by `reversibilityCost`, highest first, and cap the list** (`--max-adrs`, default 8, recorded
  in `scan.budget.caps.maxAdrCandidates`). An ADR earns its page by being expensive to undo: a tenancy
  model or a public contract is `high`, a framework or deployment shape `medium`, a formatter `low`.
  The cap truncates the tail, so an unranked list drops exactly the decisions worth recording.
- **`decidedAt` where history establishes it** — `git -C "<root>" log -1 --diff-filter=A --format=%ad -- <path>`
  for the file that introduced the pattern. On a squashed or shallow history this is genuinely
  `unknown`, and the rendered ADR then dates itself `unknown`. That is the correct output.
- **`consequencesObserved` is observation, not judgement.** *"Every repository filters by `tenantId`;
  3 of 11 do it by hand rather than through the base repository"* is an observation. *"This was the
  right trade-off for their scale"* is an opinion the scan has no standing to hold.
- **De-duplicate against what is already recorded.** Read `docs/adr/*`, the `docs[]` entries from §3
  (an `RFCs/` directory, a Confluence or Notion link in the README) and, on a re-adoption, the config's
  `adoption.adrs[]`. A decision already recorded is listed with `status: "already-recorded"` and its
  `existingAdr` — **listed, not dropped**, so a second run's silence reads as *checked and covered*
  rather than *never looked*. An existing doc in another format or location is **linked, never copied
  or relocated**: it is the team's file, in the place they keep it.
- **Never invent a rationale — in any spelling.** A candidate carries no `rationale`, `why`, `because`,
  `alternatives` or `alternativesConsidered`, and the validator rejects all five. The reason is
  specific: an ADR marked `accepted` is read as settled history, so one plausible invented sentence
  becomes a decision record nobody authored and everybody trusts. `/aidlc:adopt-adr` renders those
  sections as *"not recorded — confirm with the team"*, which is the honest artifact.

**Nothing is written to `docs/adr/` here.** This section proposes; `/aidlc:adopt-adr` writes, one ADR
at a time, each behind its own approval.

## 7 · Support matrix and capability gaps

For **every** detected surface — stack, tracker, VCS, CI system, migration tool, container, hooks,
release channel — emit a `surfaces[]` entry with `support` and a **one-line consequence**. Judge
support against the **plugins actually installed in this session**, not against what AIDLC could
support in principle: today that is `aidlc-stack-web` for TS/JS, and markdown/Jira/ADO for trackers.

- A Django + Terraform + Flutter shop gets the language-agnostic core and nothing else. That is a fine
  outcome **stated plainly**: `partial — the pipeline runs, but no Python stack skill exists, so
  coding standards and structure guidance fall back to the core.`
- An unsupported tracker (GitHub Issues, Linear, Shortcut, a spreadsheet, none at all) is **never a
  blocker**: offer the markdown backlog as the adapter and state the trade-off (local, no team
  visibility outside the repo).
- **For the tracker surface specifically, cite the ID prefix the board actually uses** — an item path or
  an `id:` line, e.g. `backlog/PLAT-14-….md:2` → `id: PLAT-14`. `/aidlc:adopt-apply` §3.0 writes that
  prefix into `project.key`, and it is the one value in the config that cannot be inferred from the code:
  a workspace whose package names and commit subjects all say `ACME` can have a board keyed `PLAT`, and an
  item filed under the wrong prefix matches nothing on the existing board.
- Each `partial`/`unsupported` surface becomes a `gaps[]` proposal — the entry that a later approved
  step writes into `.aidlc/extensions.json` so `/aidlc:scaffold-skill` and `/aidlc:promote` can act on
  it. The scan itself writes nothing there.

**Separate "AIDLC cannot" from "the project has not".** Two different facts with two different next
steps, and collapsing them into one `support` value puts non-work in front of `/aidlc:scaffold-skill`:

| `support` | Means | Where it goes |
|---|---|---|
| `unsupported` | **AIDLC** does not cover this surface (a Go stack, a Linear tracker) | a `gaps[]` entry — something AIDLC could build |
| `not-present` | **the project** does not have this surface (no CI, no release tooling, no VCS) | the support matrix, plus `debtFindings[]` where it is genuinely work — and **no `gaps[]` entry** |

A `detected` value of `"none"` is the tell: nothing is *unsupported* about a CI system that does not
exist. A repo with no CI is a fact about the repo, and AIDLC supports GitHub Actions perfectly well —
filing it as a capability gap aims `/aidlc:scaffold-skill` at a skill with no subject, while the real
finding (its PRs merge unverified) already belongs in `debtFindings[]` as `ungated-integration`.

- **`gaps[].kind` is `skill` · `agent` · `plugin` · `adapter` · `project-action`.** The first four are
  things AIDLC would build. **`project-action`** is a gap only the project can close — `git init` on a
  zip drop, adopting a tracker, upgrading an EOL runtime — recorded so an unsupported surface is never
  left with no named next step, and **never proposed to `/aidlc:scaffold-skill`**. Reach for it instead
  of inventing a `skill` entry for work AIDLC has no part in.

## 8 · Debt worth tracking — the findings that are work, not facts

Everything above records what the project **is**. This records what the scan noticed is **missing or
wrong** and would be a work item if someone decided to fix it: `debtFindings[]`. Nothing is created
here — `/aidlc:adopt-backlog` dedupes these against the tracker and proposes each one before anything
is written to a board. Cap with `--max-debt <n>` (default 20, recorded in
`scan.budget.caps.maxDebtFindings`).

| Kind | What evidences it |
|---|---|
| `absent-gate` | A gate from §3 recorded `status: "absent"`. Name it in `gate` — and only where the root really lacks it, because a backlog whose first item is provably wrong is one nobody reads twice. **Never for a `not-applicable` gate**: "add a build gate to the Django service" is work nobody can do |
| `untested-critical-path` | An `authPaths` / `billingPaths` / `tenantIsolationPaths` entry (§5) with no test file beside it and no matching name under the test directory |
| `unreviewed-sensitive-path` | The same kind of path whose history shows no review: a single commit, or merges with no PR reference where every other path has one |
| `eol-dependency` | The **declared** runtime or dependency version (`.nvmrc`, `engines`, `requires-python`, `<java.version>`, `go 1.x`, a Gemfile ruby line). The evidence is the declaration; the end-of-life judgement is **not evidence** — put it in `note` as something to confirm, because this scan makes no network calls and cannot read a release calendar. Confidence `medium` at best |
| `todo-cluster` | A concentration of `TODO`/`FIXME`/`HACK`/`XXX` dense enough to be a backlog item rather than a comment — a count per directory, not a list of every marker in the repo |
| `docs-drift` | Documentation contradicted by the code it describes: a README command that no longer exists in any manifest, a documented env var absent from every config, an ADR whose decision the code no longer follows |
| `cross-platform-hazard` | The §3 findings — mixed CRLF/LF with no `.gitattributes`, two paths differing only by case, a lockfile generated on a different OS than CI runs |
| `ungated-integration` | `conventions.protectedBranches` came back **`absent`** — the host API answered and there is no protection, so PRs merge ungated. `unknown` is *not* this finding |
| `committed-secret`, `pii-in-fixtures` | The `safety` findings, promoted to work because rotating a leaked credential is a task somebody has to own |

Four rules:

1. **A finding states the debt; it never ships the change.** No `fix`, `remedy`, `patch`, `diff` or
   `solution` — the validator rejects all five. You sampled this code; you did not design the change,
   and a finding carrying its own patch invites the item to be closed by applying it unread, routing
   around the plan → implement → review → verify path that is the point of the pipeline.
2. **`sensitive` is not a formality.** A tracker item may be a **public GitHub issue**. A finding that
   names where an unfixed credential lives, or which fixture holds real customer data, would publish
   an exploit to the internet under an adoption banner. So `committed-secret` and `pii-in-fixtures`
   are **always** `sensitive: true`, carry a `trackerSafeTitle` that discloses nothing, and carry
   **no `paths`** — the specifics stay in the report, which stays in the repo. Evidence may cite the
   location, because the profile is a local file and never travels to the board.
3. **Rank by severity, highest first,** then cap. `high` is what can cause customer-visible or
   security-relevant harm; `medium` degrades the pipeline's ability to verify; `low` is hygiene. The
   cap truncates the tail, so an unranked list drops an unreviewed auth path to keep a formatting nit.
4. **Every finding gets `suggestedType` and `suggestedSize`.** A finding whose remedy is genuinely
   unclear is a **spike**, not a story with invented acceptance criteria. `XL` means it must be
   decomposed before it is created.

**Do not manufacture volume.** Twenty findings on a healthy repo means the bar was set at "anything I
would have done differently". The useful output is the handful a team would thank you for.

## 9 · Drift — when this is a re-adoption

If §1 found an existing `aidlc.config.json` (`alreadyAdopted: true`) or a previous
`.aidlc/adoption/profile.json`, this run is not a first contact and a fresh full profile is not the
answer: nobody diffs two thousand-line JSON files by eye. **Read the previous profile before you
overwrite it**, and record the comparison in `drift`.

**The comparison is three-way, and two of the three legs must be handled in opposite directions:**

| Leg | `source` | What it means | `action` |
|---|---|---|---|
| Baseline vs. the code now | `code` | The project moved. The ordinary case | `propose` |
| The code now vs. the config | `config` | Configuration no longer matches reality — a renamed gate command, a package deleted but still registered | `propose` |
| The config vs. **what the last apply wrote** | `human-edit` | Somebody changed it deliberately after adoption. This is **intent the scan cannot see** | **`leave-alone`, always** |

That third row is the one that matters. A hand-tuned gate command, a deliberately narrowed
`securityReviewPaths`, a `mergeStrategy` the team changed on purpose — proposing to "correct" any of
them produces a diff that looks exactly like routine convergence and reverts a decision nobody will
notice in review. Compare against `adoption.appliedAt`: a config value that differs from the baseline
profile's derived value, in a file last applied before it changed, was changed by a person. The
validator pins `source: "human-edit"` to `action: "leave-alone"`.

Three more rules:

- **No baseline, no drift.** `baseline.kind: "none"` means `changes[]` is **empty**. Reporting an
  entire project as "new drift" on first contact is noise that teaches people to skip the section, and
  then the one real change next quarter goes unread. On a first adoption this section says so in one
  line: *this profile is the baseline for next time* — which is why both artifacts are meant to be
  **git-tracked**. An untracked profile leaves a re-scan with nothing to compare against, and that
  degradation must be stated (`baseline.kind: "config-only"`, or `"none"`).
- **A depth change is not drift.** A `quick` baseline re-scanned at `deep` turns dozens of `unknown`s
  into facts — new *knowledge*, not new movement. Set `depthChanged: true` whenever the depths differ
  and say so at the top of the section, or the two changes that really are drift drown in forty that
  are not.
- **An unmanaged surface is reported once, not re-proposed.** Echo the config's `adoption.unmanaged`
  into `drift.unmanaged` and give those surfaces `action: "report-only"`. A pilot on one repo of six
  must stay quiet about the other five, or "not adopted" becomes indistinguishable from "missed".

**`--only <root|package>`** scopes this run: profile the named surface, and record every other root at
its classification with a `scan.skipped` entry (`reason: "out-of-scope"`) so silence about it reads as
*not looked at* rather than *nothing there*. `/aidlc:adopt-apply --only` then records the scope in
`adoption.only` and the exclusions in `adoption.unmanaged`.

**Idempotency is observable here.** A re-scan at the same commit and the same depth must produce
`changes: []`. That empty array is the proof, and it is why the block is present even when nothing
moved — its absence would be indistinguishable from a scan that never looked.

## 10 · Write the profile

Write `.aidlc/adoption/profile.json` with `profileVersion: 1` and `$schema` set to the published URL
above. This is the shape — every leaf fact is one of the three `fact` forms, and there is no fourth:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/bee-logical/AIDLC/main/docs/adoption-profile.schema.json",
  "profileVersion": 1,
  "scan": {
    "scannedAt": "<UTC ISO-8601>", "aidlcVersion": "<plugin version>", "depth": "standard",
    "commit": { /* fact */ },
    "controlPlane": { "path": "<abs>", "resolvedFrom": "code-workspace-file|opened-folder|user",
                      "evidence": [ /* … */ ], "isWorkspaceRoot": true, "alreadyAdopted": false },
    "budget": { "filesInspected": 0, "directoriesInspected": 0, "durationSeconds": 0,
                "caps": { "maxFiles": 0, "maxFileBytes": 0, "maxDepth": 0, "hitCap": false } },
    "skipped": [ { "path": "…", "reason": "vendored|generated|build-output|gitignored|lfs-pointer|over-size|binary|unreadable|env-file|pii-suspect|out-of-scope|cap-reached", "note": "…" } ],
    "sampling": { "applied": false, "strategy": "…", "coveragePercent": 100 },
    "writes": { "paths": [".aidlc/adoption/profile.json", ".aidlc/adoption/report.md"], "sessionOnly": false },
    "network": { "sourceTransmitted": false, "hostApiCalls": [], "offline": false }
  },
  "workspace": {
    "shape":    { /* fact → "single-root" | "nested-multi-repo" | "multi-root" */ },
    "codeWorkspaceFile": { /* fact → abs path, or status "absent" */ },
    "topology": { /* fact → "single-app" | "monorepo" | "poly" | "unknown" — evidence NAMES the deciding signal */ },
    "roots": [ {
      "name": "…", "path": "<as declared>", "absolutePath": "<abs>",
      "nestedUnderControlPlane": true, "declaredBy": "code-workspace|folder-scan|config|user",
      "classification": { /* fact → product-repo|monorepo|control-plane|non-repo|reference-only|already-adopted|not-cloned|unknown */ },
      "reachable": { "value": true, "remedy": "…" },
      "trust": { "trusted": { /* fact */ }, "pluginEnabled": { /* fact */ }, "remedy": "…" },
      "vcs": { "system": { /* fact */ }, "support": "supported|partial|unsupported|unknown",
               "defaultBranch": {}, "currentBranch": {}, "remotes": {}, "upstream": {},
               "shallow": {}, "submodules": {}, "worktrees": {}, "lfs": {}, "sizeBytes": {} },
      "languages": [ /* detected */ ], "packageManagers": [], "frameworks": [],
      "ci": [], "hooks": [], "migrationTools": [], "containers": [],
      "entryPoints": { "install": {}, "build": {}, "dev": {}, "test": {}, "lint": {},
                       "typecheck": {}, "format": {}, "migrate": {} },
      "packages": [ { "name": "<as the package's own manifest declares it>", "path": "…", "role": "…",
                      "labels": [], "languages": [], "stack": { "frontend": null, "backend": null, "databases": [] },
                      "dependsOn": ["<sibling package name>"], "releasable": false,
                      "entryPoints": {}, "evidence": [] } ],
      "workspaceTooling": { /* fact — note if it is an affected-graph runner */ },
      "releaseTooling":   { /* fact → {tool, independentVersioning} — or absent */ },
      /* Every entry below is a `fact`. These are the VALUE shapes, which the skeleton has to spell
         out because this skill may not fetch the published schema — the enums especially, since a
         plausible spelling like "SOC 2" is a violation where `soc2` is the legal value. */
      "saas": {
        "tenancy":     { /* fact → "shared-schema" | "schema-per-tenant" | "database-per-tenant" | "single-tenant" | "not-multi-tenant" */ },
        "tenantKey":   { /* fact → "tenant_id" — the column or claim name itself */ },
        "tenantIsolationPaths": { /* fact → ["acme/tenancy/"] */ },
        "authPaths":   { /* fact → ["acme/accounts/"] */ },
        "billingPaths":{ /* fact → ["acme/billing/"] */ },
        "featureFlags":{ /* fact → {provider, paths[], required?} */ },
        "migrations":  { /* fact → {tool, directories[]} */ },
        "liveDataConstraint": { /* fact → "expand-contract" | "not-required" */ },
        "apiContracts":{ /* fact → [{path, kind: "openapi"|"graphql"|"proto"|"grpc"|"asyncapi"|"json-schema"|"wsdl", public}] */ },
        "environments":{ /* fact → [{name, kind?: "dev"|"test"|"staging"|"production"|"preview"|"other"}] */ },
        "deployStrategy": { /* fact → "rolling" | "blue-green" | "canary" | "recreate" | "release-train" | "manual" | "continuous" */ },
        "freezeWindows":  { /* fact → [{when, source}] — `source` because an unsourced freeze blocks an integration on a rumour */ },
        "compliance":  { /* fact → [{regime: "soc2"|"hipaa"|"gdpr"|"pci"|"iso27001"|"fedramp"|"other", signal}] — LOWERCASE slugs, not "SOC 2" */ },
        "messaging":   { /* fact → [{name, kind: "queue"|"broker"|"stream"|"scheduler"|"webhook", paths[]}] */ },
        "observability": { /* fact → [{name, paths[]}] */ },
        "integrations":  { /* fact → [{name, paths[], credentialShape?}] */ },
        "experimentation": { /* fact → [{name, paths[]}] */ },
        "securityReviewPathSeeds": [ /* union of the isolation/auth/billing/compliance paths above */ ]
      },
      "gates": [ { "name": "test", "status": "present|absent|not-applicable", "cmd": "<verbatim; forbidden unless present>",
                   "cwd": "…", "source": "package.json scripts.test", "required": true,
                   "scope": "repo|package|affected|changed-paths", "package": "…",
                   "timeoutMinutes": 20, "environmentDependent": true, "services": ["postgres"],
                   "providedByHook": "husky", "alsoInCi": true, "evidence": [], "confidence": "high" } ],
      "conventions": { "branchPattern": {}, "commitStyle": {}, "mergeStrategy": {},
                       "integrationBranch": {}, "longLivedBranches": {}, "hotfixRoute": {},
                       "codeowners": {}, "requiredReviewers": {}, "protectedBranches": {},
                       "pushAccess": {} },
      "agentConfigs": [ { "path": "…", "tool": "…", "humanAuthored": true } ],
      "docs": [ { "location": "…", "kind": "adr|rfc|design-doc|wiki|readme|other", "external": false } ],
      "coverage": { "filesInspected": 0, "sampled": false, "coveragePercent": 100 }
    } ]
  },
  "surfaces": [ { "kind": "stack|tracker|vcs|ci|migration-tool|container|hooks|ide|release-channel|other",
                  "detected": "…", "root": "…",
                  "support": "supported|partial|unsupported|unknown|not-present", "providedBy": "…",
                  "consequence": "<one line — required>", "evidence": [] } ],
  "gaps":     [ { "name": "…", "kind": "skill|agent|plugin|adapter|project-action", "surface": "…", "why": "…", "workaround": "…" } ],
  "debtFindings": [ { "kind": "absent-gate|untested-critical-path|eol-dependency|todo-cluster|unreviewed-sensitive-path|docs-drift|committed-secret|pii-in-fixtures|cross-platform-hazard|ungated-integration|other",
                      "title": "<the work as an OUTCOME>", "severity": "high|medium|low",
                      "root": "…", "package": "…", "gate": "<required iff kind=absent-gate>",
                      "paths": ["…"], "suggestedType": "story|task|bug|spike", "suggestedSize": "S|M|L|XL",
                      "sensitive": false, "trackerSafeTitle": "<required iff sensitive>",
                      "evidence": [], "confidence": "…", "note": "<what still needs confirming>"
                      /* NO fix/remedy/patch/diff/solution — state the debt, not the change */ } ],
  "drift": { /* re-adoption only */
    "baseline": { "kind": "previous-profile|config-only|none", "path": "…", "scannedAt": "…",
                  "commit": "…", "profileVersion": 1, "depth": "standard", "appliedAt": "…" },
    "depthChanged": false, "comparedAgainstConfig": true, "unmanaged": ["…"],
    "changes": [ { "kind": "root-added|root-removed|classification-changed|package-added|package-removed|gate-added|gate-removed|gate-changed|stack-changed|convention-changed|saas-changed|topology-changed|release-tooling-changed|surface-support-changed|adr-superseded|other",
                   "surface": "repos[].api…verify.steps.test", "root": "…",
                   "package": "…", "was": "…", "now": "…",
                   "source": "code|config|human-edit|scan-depth|unknown",
                   "action": "propose|report-only|leave-alone", "evidence": [], "note": "…" } ]
  },
  "adrCandidates": [ { "decisionKind": "framework|data-store|auth-model|tenancy-model|api-style|deployment-topology|messaging|migration-strategy|frontend-architecture|build-tooling|observability|other",
                       "title": "<the decision as a statement>",
                       "status": "propose|already-recorded", "existingAdr": "<required iff already-recorded>",
                       "reversibilityCost": "high|medium|low", "root": "…", "decidedAt": { /* fact */ },
                       "consequencesObserved": ["<observation, never judgement>"], "evidence": []
                       /* NO rationale/why/because/alternatives — the scan never saw the why */ } ],
  "safety": {
    "envFiles":       [ { "path": "…", "contentsRead": false, "gitTracked": false } ],
    "secretFindings": [ { "location": "path:line | history: <commit> <path>", "type": "…", "inHistory": false, "redacted": true } ],
    "piiSuspects":    [ { "path": "…", "signal": "<why — never a sample row>", "quotedInReport": false } ]
  }
}
```

The three `fact` forms, and nothing else:

```jsonc
{ "status": "known",   "value": <any>, "evidence": [ … ], "confidence": "high|medium|low" }
{ "status": "absent",  "evidence": [ { "kind": "absence", "note": "<what you searched, came back empty>" } ] }
{ "status": "unknown", "reason": "<why it could not be established>" }
```

`evidence[]` entries are `{kind: "path", path, line?, excerpt?}` · `{kind: "command", command, output}` ·
`{kind: "absence", note}` · `{kind: "user", note}`. A `commandFact`'s `value` is
`{cmd, cwd?, source, environmentDependent?}`. A `detected` entry (language, framework, CI, hook,
migration tool, container) is `{name, version?, paths[], evidence[], confidence, support?}`.

Then **prove the profile conforms — do not eyeball it.** This skill ships a validator beside it:

```
node "<this skill's directory>/validate-profile.mjs" .aidlc/adoption/profile.json .aidlc/adoption/report.md
```

It runs offline with no dependencies and exits non-zero with one line per violation. It enforces exactly
the rules that matter: the three legal fact forms (and that an `unknown` fact carries **no value** — the
guess this whole design exists to prevent), evidence on every `known` and `absent` fact, the payload each
evidence kind requires, `writes[]` never leaving `.aidlc/adoption/`, an unreachable root naming its
remedy, an unsupported surface naming its gap, redaction invariants on secret/PII findings, the required
report sections — and, as a backstop, that **no credential-shaped string appears anywhere in either
file**. It also enforces the rules that would otherwise fail invisibly: **no ADR candidate carries a
rationale** in any spelling, **every auth / tenant-isolation / billing path reaches
`securityReviewPathSeeds`**, a **multi-tenant root with migrations answers the expand/contract
question**, a **`sensitive` debt finding never carries the location** that a public tracker item would
publish, and **drift attributed to a human's edit is never proposed for overwrite** — plus that
candidates and findings are ranked and capped, and that a package's `dependsOn` resolves to siblings
with no cycle. A profile that does not pass is not a profile: fix it and re-run, and never
report a scan as complete over a failing validation. (If the validator is missing — an unusual install —
say so, and fall back to re-reading and `JSON.parse`ing the file, the F49 floor.)

Populate `scan.writes.paths` with the two files you wrote — and then verify the read-only claim instead
of asserting it: `git status --porcelain` at the control plane **and at every reachable root** (nested or
not) must show nothing but those two paths. If it shows anything else, say so in the report; do not
quietly move on.

Both files are meant to be **tracked**, and §9 depends on it: the profile is the baseline every later
drift scan compares against, so it needs history. Say so when you write it — an untracked profile
silently degrades the next re-adoption from a diff to a guess.

**Converge; do not churn.** Because the profile is a tracked baseline, rewriting it on every scan would
put a timestamp-only commit in front of the team each time and, worse, move the baseline the *next* scan
compares against. So compare what you are about to write against what is already there, **excluding the
inherently variable fields** (`scan.scannedAt`, `scan.budget.durationSeconds`, and `drift`, which merely
echoes this comparison) — **and excluding `scan.commit` when, and only when, the commits differ by
adoption artifacts alone:**

```
node "<this skill's directory>/converged.mjs" <existing profile.json> <candidate profile.json> [changed-paths-file]
```

where the changed-paths file is

```
git -C "<control plane>" diff --name-only <recorded scan.commit>..HEAD -- . ':(exclude).aidlc/adoption/'
```

That `scan.commit` carve-out is not a nicety — without it the profile can **never** converge, because
this section requires the profile be *tracked* and committing it is what moves HEAD. Scan at `A`, commit
the profile, HEAD is `B`; the next scan records `B`, so it rewrites; you commit that, HEAD is `C`; and so
on forever on a project that never changed. Each rewrite also moves the baseline the next scan compares
against, which is the precise failure this rule exists to prevent.

The carve-out is deliberately **evidence-based rather than blanket**. A project that really moved must
record the commit it was actually read at, so `scan.commit` is ignored only when the diff between the
recorded commit and HEAD touches nothing outside `.aidlc/adoption/`. When it is ignored, say so in one
line — *"the recorded commit is 3 behind HEAD, all of them adoption artifacts"* — so a reader is never
left wondering whether the profile is stale. When the paths are unknown, keep `scan.commit` in the
comparison: the conservative answer is to write.

Then, on the comparison itself:

- **Nothing else differs ⇒ write neither file.** Report *"no drift — this profile already describes the
  workspace at `<commit>`"*, and leave `git status` clean. The artifacts describe **state**, not events;
  a scan that found nothing new has nothing to record. This is the same rule `/aidlc:adopt-apply` §3.5
  applies to `appliedAt`, and it is what makes two consecutive runs produce a literally empty diff
  rather than an almost-empty one.
- **Something differs ⇒ write both**, with the drift section naming what moved.

## 11 · The report

`.aidlc/adoption/report.md`, written for a human seeing AIDLC for the first time, in this order:

1. **What this is and what it changed** — the profile, the report, and the two-file guarantee.
2. **The workspace** — shape, control plane and how it resolved, and the root table: name, absolute
   path, classification, reachable, nested. Any root needing `--add-dir`, trust, or plugin enablement
   appears here **with its exact fix**.
3. **Per root** — VCS, languages/frameworks with paths, entry points (marking every `absent` one),
   CI, hooks, migrations, containers, and the **packages** table for a monorepo root: name, path, role,
   stack, what it depends on, and whether it releases on its own cadence. That table is what routing,
   gate scoping and release all key off, so it earns its space.
4. **The gate, per root** — the ordered sequence as it would run, each step with its command, scope and
   whether CI runs it too. **Name every `absent` step as a coverage hole in its own line**, and name every
   local/CI parity gap. This table is the single most useful thing in the report for a brownfield team:
   it is what the pipeline will actually do to their code.
5. **Conventions, per root** — branch and commit style, merge strategy, integration branch, long-lived
   branches, CODEOWNERS, push access. Where the project has no convention, say *"none detected — AIDLC's
   default would apply"* rather than presenting the default as a finding.
6. **Runtime constraints, per root** (§5) — a table of *constraint → what it means for a change*, not a
   list of detected tools. `shared-schema tenancy on tenant_id` → *every query filters by tenant; a miss
   is a cross-tenant read*. `migrations against live data` → *expand/contract + backfill; a destructive
   migration blocks review*. `LaunchDarkly` → *user-visible changes ship behind a flag*. Then name the
   paths that will be security-reviewed regardless of cadence, and any freeze window. Where the depth did
   not reach a constraint, say **"not sampled at this depth"** — the one thing this section must never do
   is let silence read as "no constraint".
7. **Decisions with no ADR** (§6) — the ranked candidate list: decision, reversibility cost, evidence,
   and the count already recorded elsewhere. State plainly that each proposed ADR will leave its rationale
   blank for a human, because the scan read code and not the conversation. Point at `/aidlc:adopt-adr`.
8. **Debt the scan found** (§8) — the ranked findings: severity, what it is, where, and the suggested
   type and size. The two `sensitive` kinds appear here **in full** (this file stays in the repo) and are
   marked as withheld from any tracker item. Say that nothing has been created and point at
   `/aidlc:adopt-backlog`. On a healthy repo a short list is the honest answer, not a weak one.
9. **Drift since the last scan** (§9) — *only on a re-adoption*, and near the top of what a returning
   reader cares about: the baseline (when, which commit, which depth), whether the depth changed, and the
   change table with `source` and `action` per row. Group it so the three kinds do not blur: *the project
   moved* · *config no longer matches* · *you changed this by hand, and we left it alone* · *unmanaged by
   choice*. **When nothing moved, say that in one line** — "no drift: same commit, same depth" is the
   result the reader came for.
10. **Supported / partial / unsupported** — the matrix from §7, one consequence per row.
11. **Not determined** — every `unknown` fact with its reason, counted. A short list here is a quality
    claim; a long one is honest and fine. Never pad it away by guessing.
12. **Safety** — env files by path, redacted secret findings, PII-suspect fixtures.
13. **Scan budget and coverage** — files and directories inspected, elapsed time, the caps that
    applied and whether one was hit (including the ADR and debt caps), the sampling strategy and coverage
    percent, and the explicit list of what was skipped and why — including anything `--only` put out of
    scope.
14. **Next step** — `/aidlc:adopt-apply`, which turns this profile into configuration behind a shown
    diff and an explicit approval, then `/aidlc:adopt-adr` for the decisions above and
    `/aidlc:adopt-backlog` for the debt. List here the facts whose confidence is `low` and the `unknown`s
    that matter, since those become the questions apply will ask rather than values it will propose.

## 12 · What adopt does not do

Say this at the end, so nobody waits for a write that is not coming:

- It does **not** write `aidlc.config.json`, `CLAUDE.md`, `pipeline.gates.verify`, `packages[]`, the
  `saas` block or `rules/git-workflow.md`. **`/aidlc:adopt-apply` does that**, from this profile, behind a
  shown diff and an explicit approval. Keeping the two apart is what makes the scan safe to run on first
  contact: this command cannot change a file the team owns, so there is nothing to undo.
- It does **not** write ADRs. §6 *proposes* them; **`/aidlc:adopt-adr`** writes the approved ones into
  `docs/adr/`, one at a time, each with its rationale left for a human.
- It does **not** create work items. §8 *proposes* debt findings; **`/aidlc:adopt-backlog`** dedupes them
  against the board and creates only what you approve. Nothing here touches a tracker.
- It does **not** remediate anything it finds. Missing tests, absent gates and stale dependencies are
  reported; fixing them is normal pipeline work through the normal doors.
- It does **not** *fix* drift. §9 reports it; `/aidlc:adopt-apply` proposes the deltas that are
  configuration, and leaves anything a human authored alone.
- It does **not** replace `/aidlc:init`. Init owns the permission posture and the scaffold; adopt owns
  the derived facts. On a brownfield project, running adopt **first** means init's topology, stack and
  command questions get answered from evidence instead of from memory.

Idempotency is a promise, and since §10 it is a literal one: on an unchanged commit at the same depth, a
second run **writes nothing at all** and leaves `git status` clean. If it produces a diff, that is a bug
in the scan, not drift in the project — and the drift section will have mislabelled it, which makes the
bug worse than the churn.
