---
name: adopt
description: Scan an existing workspace — one repo or several, in one folder or a multi-root VS Code workspace — and derive an evidence-backed profile of its topology, languages, package managers, frameworks, monorepo packages, gates, CI, VCS state, SaaS runtime constraints (tenancy, feature flags, migrations, API contracts, compliance), undocumented architecture decisions, debt worth tracking and capability gaps. On an already-adopted workspace it also reports drift against the last scan. Read-only: writes only .aidlc/adoption/profile.json and report.md. The brownfield counterpart to /aidlc:bootstrap, which infers a project's shape from a requirements document — adopt infers it from the code that is already there. Use when adopting AIDLC on a project that already has code, before answering /aidlc:init's topology and stack questions from memory, or to re-scan an adopted workspace for drift.
argument-hint: "[--depth quick|standard|deep] [--max-adrs <n>] [--max-debt <n>] [--only <root|package>]"
disable-model-invocation: true
---

# /aidlc:adopt — read the code, derive the facts, prove each one

On a **greenfield** project `/aidlc:bootstrap` derives the shape from a **requirements document**. This
door derives it from **the code that is already there** — so a brownfield team stops answering
mono-vs-poly, stack and commands from memory, on a codebase the framework has never read.

**The profile this writes is also what makes bootstrap safe to run on a live project.** In brownfield
mode bootstrap reads `.aidlc/adoption/profile.json` to ground a batch of new requirements in the system
that already exists — the stack it must honor, the packages and seams new work fits into, the gates
that are already there — instead of planning as though the document described a fresh project. Running
this door first is what turns a features document into a plan the team recognizes.

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

**Do this step from `${CLAUDE_PLUGIN_ROOT}/skills/adopt/references/scan.md` — read it in full now.** It is this step, moved out only so the
skill fits in one read. Per root, manifests first and source last: VCS state (marker test, never
`--is-inside-work-tree`), languages and package managers, frameworks, monorepo packages, CI, hook
managers, migration tooling, entry points, the real gate commands, git conventions and release tooling —
each fact `known` with `path:line` evidence, `absent` with evidence of absence, or `unknown`.

**Then inventory the reusable code** (`aidlc:reuse`): `node "${CLAUDE_PLUGIN_ROOT}/skills/reuse/catalog.mjs"
build <root> --name <root name> --out .aidlc/adoption/catalog`. Record on the root, as `reuse`, the shared
areas it found and how many exported symbols each holds. A root with substantial source and a near-empty
catalog keeps its shared code under folder names the catalog does not know — find them (where do two
features import the same helper from?) and record them as `reuse.proposedSharedPaths`; `/aidlc:adopt-apply`
offers them as `reuse.sharedPaths`. Every plan and implementer brief after adoption is grounded in this
inventory, so a gap here is code the pipeline will re-write.

## 4 · Topology — one classification, with the deciding signal named

Classify the **workspace**: `single-app` (one repo, one deliverable) · `monorepo` (one git repo, many
packages) · `poly` (many git repos) · `unknown`. Name the deciding signal in `evidence` — "three roots
each with their own `.git`", "one `.git` plus `pnpm-workspace.yaml` listing 6 packages". A topology
with no named signal is a guess wearing a label. A workspace that mixes a monorepo root with
single-app roots is `poly` at the workspace level, with `packages[]` on that one root's entry.

## 5 · SaaS runtime constraints — the facts that change how code must be written

**Do this step from `${CLAUDE_PLUGIN_ROOT}/skills/adopt/references/saas.md` — read it in full now.** Tenancy model and tenant key, feature
flags as the release mechanism, migrations against live data (expand/contract), public API contracts,
message shapes, compliance regimes, freeze windows, and the auth / tenant-isolation paths they seed into
security review. Each only with evidence: an unevidenced constraint is never written as a fact, because
the pipeline enforces every one it is given.

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

**Only on a re-adoption** (an approved profile already exists): read `${CLAUDE_PLUGIN_ROOT}/skills/adopt/references/drift.md` and follow it —
compare the new scan with the approved profile and the applied config three ways, so a change the team
made by hand is told apart from drift in the code. A first adoption skips this step.

## 10 · Write the profile

**Do this step from `${CLAUDE_PLUGIN_ROOT}/skills/adopt/references/profile.md` — read it in full now.** Write the profile to
`.aidlc/adoption/profile.json` in the exact shape `docs/adoption-profile.schema.json` defines, validate it
with `validate-profile.mjs` until it passes, and write nothing outside `.aidlc/adoption/` — adopt is
read-only for everything else.

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
