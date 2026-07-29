---
name: adopt
description: Scan an existing workspace — one repo or several, in one folder or a multi-root VS Code workspace — and derive an evidence-backed profile of its topology, languages, package managers, frameworks, gates, CI, VCS state and capability gaps. Read-only: writes only .aidlc/adoption/profile.json and report.md. The brownfield counterpart to /aidlc:bootstrap, which infers a project's shape from a requirements document — adopt infers it from the code that is already there. Use when adopting AIDLC on a project that already has code, before answering /aidlc:init's topology and stack questions from memory, or to re-scan an adopted workspace.
argument-hint: "[--depth quick|standard|deep]"
disable-model-invocation: true
---

# /aidlc:adopt — read the code, derive the facts, prove each one

`/aidlc:bootstrap` derives a project's shape from a **requirements document**. This door derives it
from **the code that is already there** — so a brownfield team stops answering mono-vs-poly, stack and
commands from memory, on a codebase the framework has never read.

**This command writes exactly two files and nothing else:** `.aidlc/adoption/profile.json` (the
machine-readable contract) and `.aidlc/adoption/report.md`. No config, no `CLAUDE.md`, no rules, no work
items, no branch, no commit. Turning the profile into configuration is a separate, approved step (not yet
implemented — see *What adopt does not do*).

The profile's full contract is `adoption-profile.schema.json`, published at
`https://raw.githubusercontent.com/bee-logical/AIDLC/main/docs/adoption-profile.schema.json`. **Do not
fetch it** — this skill makes no network calls. Read it only if a local copy is at hand (an AIDLC clone
in the workspace); otherwise §6's skeleton is the contract you must satisfy, and it is sufficient.

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

`$ARGUMENTS` may carry `--depth quick|standard|deep` (default `standard`):
**quick** — manifests, IDE/VCS metadata, top-level config only; the ten-minute pass, useful on its
own. **standard** — adds config parsing, CI files, package/workspace enumeration, bounded git history.
**deep** — adds bounded source sampling for facts only source can evidence. Depth is a cost dial, not
a quality dial: a shallower scan records **more `unknown`**, never a weaker guess.

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
| `non-repo` | no VCS root — docs, scratch, notes | excluded from `repos[]`, and the report says why |
| `reference-only` | a clone we read but do not change (vendor SDK, tracked upstream) | **never** a routing target |
| `already-adopted` | carries its own `aidlc.config.json` | reconcile, do not re-derive |
| `not-cloned` | declared in the workspace file but absent on disk | recorded; **never fabricate a path** |

Every classification is **proposed for confirmation** — present the list once, compactly, and let the
user correct it. Only `product-repo` and `monorepo` may become `repos[]` entries later.

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
profile and back out. Store `absolutePath` verbatim, always quote paths in any command you run, and
never rebuild a path by string-joining a relative fragment onto the wrong base.

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
2. **Confirm the boundary.** `git -C "<root>" rev-parse --show-toplevel` and require the result to
   **equal the root** after normalising separators and case (git returns forward slashes; Windows paths
   compare case-insensitively). Equal ⇒ the root is its own repo. Different ⇒ the root is **not** a
   repo; it sits *inside* the returned one. Record that as `enclosingRepo` and report it as a hazard —
   files there are inside someone else's index, one `git add -A` from being committed to it — and
   record this root's own `vcs.system` from its markers (`none`, `mercurial`, …), never from the
   ancestor. The same rule governs the **control plane**: if it is not its own repo root, `scan.commit`
   is `unknown`, not the enclosing repo's HEAD.

Only once step 2 says the root *is* a git repo, ask the rest — all read-only, all allowlisted, always
`git -C "<root>"` so no `cd` is needed: `rev-parse --abbrev-ref HEAD` (current branch) ·
`rev-parse --abbrev-ref <remote>/HEAD` (default branch — **rc=128 when no remote or no local
`origin/HEAD`; that is `absent`/`unknown`, not an error to swallow**) · `rev-parse
--is-shallow-repository` · `remote -v` · `submodule status` · `worktree list` ·
`for-each-ref --sort=-committerdate refs/heads` (branch shape, bounded) · `lfs env` ·
`count-objects -vH` (size).
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
- A command needing services (compose, testcontainers, a live DB) is marked
  `environmentDependent: true`, so a later failure is diagnosed as *environment unavailable* rather
  than *code broken*.

**Never execute an entry point.** Detection reads; it does not run the suite.

**Cross-platform hazards**, when the workspace is mixed-OS (a Windows dev with Linux CI is the common
case). Note the presence or absence of `.gitattributes` and check line endings with
`git -C "<root>" ls-files --eol` — a repo with mixed CRLF/LF and no `.gitattributes` churns every diff.
Note too whether a committed lockfile was generated on a different OS than CI runs on (npm resolves
platform-specific optional deps, so a Windows-generated `package-lock.json` can be unsatisfiable under
`npm ci` on Linux), and whether two paths differ only by case (fine on Windows, two files on Linux).
Record these as findings, not fixes — `aidlc:init` Step 4.5 owns the remedy.

**Monorepo packages.** On a `monorepo` root, enumerate `packages[]` from the workspace manifest (name,
path, derived one-line role, languages, per-package entry points). Record `workspaceTooling` — and note
whether it is an **affected-graph runner** (Nx, Turbo), since that is what later lets a per-item gate
run affected targets only. This is what makes a monorepo root representable *beside* single-app roots
without inventing a new layout value.

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

## 5 · Support matrix and capability gaps

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
- Each `partial`/`unsupported` surface becomes a `gaps[]` proposal — the entry that a later approved
  step writes into `.aidlc/extensions.json` so `/aidlc:scaffold-skill` and `/aidlc:promote` can act on
  it. The scan itself writes nothing there.

## 6 · Write the profile

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
      "classification": { /* fact → product-repo|monorepo|non-repo|reference-only|already-adopted|not-cloned|unknown */ },
      "reachable": { "value": true, "remedy": "…" },
      "trust": { "trusted": { /* fact */ }, "pluginEnabled": { /* fact */ }, "remedy": "…" },
      "vcs": { "system": { /* fact */ }, "support": "supported|partial|unsupported|unknown",
               "defaultBranch": {}, "currentBranch": {}, "remotes": {}, "upstream": {},
               "shallow": {}, "submodules": {}, "worktrees": {}, "lfs": {}, "sizeBytes": {} },
      "languages": [ /* detected */ ], "packageManagers": [], "frameworks": [],
      "ci": [], "hooks": [], "migrationTools": [], "containers": [],
      "entryPoints": { "install": {}, "build": {}, "dev": {}, "test": {}, "lint": {},
                       "typecheck": {}, "format": {}, "migrate": {} },
      "packages": [ { "name": "…", "path": "…", "role": "…", "labels": [], "languages": [],
                      "entryPoints": {}, "evidence": [] } ],
      "workspaceTooling": { /* fact — note if it is an affected-graph runner */ },
      "agentConfigs": [ { "path": "…", "tool": "…", "humanAuthored": true } ],
      "docs": [ { "location": "…", "kind": "adr|rfc|design-doc|wiki|readme|other", "external": false } ],
      "coverage": { "filesInspected": 0, "sampled": false, "coveragePercent": 100 }
    } ]
  },
  "surfaces": [ { "kind": "stack|tracker|vcs|ci|migration-tool|container|hooks|ide|release-channel|other",
                  "detected": "…", "root": "…", "support": "…", "providedBy": "…",
                  "consequence": "<one line — required>", "evidence": [] } ],
  "gaps":     [ { "name": "…", "kind": "skill|agent|plugin|adapter", "surface": "…", "why": "…", "workaround": "…" } ],
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
file**. A profile that does not pass is not a profile: fix it and re-run, and never report a scan as
complete over a failing validation. (If the validator is missing — an unusual install — say so, and fall
back to re-reading and `JSON.parse`ing the file, the F49 floor.)

Populate `scan.writes.paths` with the two files you wrote — and then verify the read-only claim instead
of asserting it: `git status --porcelain` at the control plane **and at every reachable root** (nested or
not) must show nothing but those two paths. If it shows anything else, say so in the report; do not
quietly move on.

Both files are meant to be **tracked**: the profile is the baseline every later drift scan compares
against, so it needs history.

## 7 · The report

`.aidlc/adoption/report.md`, written for a human seeing AIDLC for the first time, in this order:

1. **What this is and what it changed** — the profile, the report, and the two-file guarantee.
2. **The workspace** — shape, control plane and how it resolved, and the root table: name, absolute
   path, classification, reachable, nested. Any root needing `--add-dir`, trust, or plugin enablement
   appears here **with its exact fix**.
3. **Per root** — VCS, languages/frameworks with paths, entry points (marking every `absent` one),
   CI, hooks, migrations, containers, packages.
4. **Supported / partial / unsupported** — the matrix from §5, one consequence per row.
5. **Not determined** — every `unknown` fact with its reason, counted. A short list here is a quality
   claim; a long one is honest and fine. Never pad it away by guessing.
6. **Safety** — env files by path, redacted secret findings, PII-suspect fixtures.
7. **Scan budget and coverage** — files and directories inspected, elapsed time, the caps that
   applied and whether one was hit, the sampling strategy and coverage percent, and the explicit list
   of what was skipped and why.
8. **Suggested next steps** — as *suggestions*, since nothing downstream is wired yet: the facts the
   user would otherwise have typed into `/aidlc:init` from memory, and the questions where confidence
   is `low` and a human must decide.

## 8 · What adopt does not do

Say this at the end, so nobody waits for a write that is not coming:

- It does **not** write `aidlc.config.json`, `CLAUDE.md`, `pipeline.gates`, `rules/git-workflow.md`,
  ADRs, or backlog items. Those are separate propose-then-approve steps
  (`docs/brownfield-adoption.md`, ADOPT-3/4/5/9/10/11).
- It does **not** remediate anything it finds. Missing tests, absent gates and stale dependencies are
  reported; fixing them is normal pipeline work through the normal doors.
- It does **not** replace `/aidlc:init`. Init owns the permission posture and the scaffold; adopt owns
  the derived facts. On a brownfield project, running adopt **first** means init's topology, stack and
  command questions get answered from evidence instead of from memory.

Idempotency is a promise: on an unchanged commit at the same depth, a second run produces an identical
profile apart from the inherently variable fields (`scan.scannedAt`, `scan.budget.durationSeconds`) and
an identical report. If anything else differs, that is a bug in the scan, not drift in the project.
