# Brownfield Adoption — spec

**Status:** Phase 1 shipped in `aidlc` **0.30.0**; Phase 2 in **0.31.0** (+ **0.31.1** fixes); Phase 3 in
**0.32.0** — see *Implementation status* below. Phase 4 remains a proposal. **Authored:** 2026-07-29.

AIDLC lands cleanly on an existing repo — `/aidlc:init` merges rather than clobbers
(`plugins/aidlc-core/skills/init/SKILL.md:44-61`), the web tooling and enterprise skeleton are
merge-aware (`init:205-209`, `aidlc-stack-web/skills/project-structure/SKILL.md:14`), `/aidlc:repo add`
never rewrites an existing repo's history (`skills/repo/SKILL.md:80`), and the pipeline grounds each
item in the code that is already there (`skills/intake/SKILL.md:23-26`,
`agents/aidlc-implementer.md:14`).

What is missing is the layer above that: **nothing derives project knowledge *from* an existing
codebase.** `/aidlc:bootstrap` infers architecture from a *requirements document* and only when the
config is `pending` (`skills/bootstrap/SKILL.md:92-99`). For a brownfield project the user must answer
mono/poly, stack, and commands by hand at init — from memory, on a codebase the framework has never
read — and then feed it one requirement at a time. Every wrong answer is written into `CLAUDE.md` and
`aidlc.config.json` and silently steers every subsequent run.

This epic adds the counterpart front door: **read the code, derive the facts, prove each one, propose
before writing.**

## Design principles (apply to every story below)

1. **Evidence or silence.** Every derived fact carries a `path:line` (or command output) as evidence
   and a confidence level. A fact that cannot be evidenced is recorded as `unknown`, never guessed.
   `CLAUDE.md` is a permanent artifact — an inferred value written there as ground truth is worse than
   an empty placeholder.
2. **Read-only by default.** The scan writes nothing outside `.aidlc/adoption/`. Config, `CLAUDE.md`,
   ADRs and backlog items are separate, approved steps.
3. **Propose before write, always** — adoption touches files the team already owns.
4. **Adopt, don't impose.** Where the project already has a convention (structure, lint, branch names,
   commit style, gates), the project wins; AIDLC records it. Our defaults apply only to a vacuum.
5. **Honest degradation.** An unsupported stack, tracker or VCS is reported as unsupported and
   recorded as a capability gap. Never silently pretend coverage exists.
6. **Idempotent.** Running adopt twice on an unchanged repo produces no diff. Running it after drift
   produces a diff of the drift, not a rewrite.
7. **Bounded.** Scan cost is capped and the cap is stated, along with what was *not* looked at.
8. **The workspace is the unit, not the repo.** Users open an IDE workspace that may hold several
   repos; adoption profiles and configures **all** of them from one control plane. A repo is a
   routing target, never the scope of adoption.

## Decisions taken

- **Control plane placement:** the folder holding the `.code-workspace` file, when one exists;
  otherwise the opened folder. Never a product repo by default.
- **Workspace shape:** support both the nested case (one folder, repos as subfolders) and true
  multi-root `.code-workspace` (folders anywhere, including different drives) as equals.

## Implementation status

**Phase 1 landed in `aidlc` 0.30.0** — the read-only scan. Where each story lives:

| Story | Landed as |
|---|---|
| ADOPT-2 · read-only scan → profile | `plugins/aidlc-core/skills/adopt/SKILL.md` §1–4 · `docs/adoption-profile.schema.json` (`profileVersion: 1`) · `skills/adopt/validate-profile.mjs` + `.test.mjs` (71 cases then; 156 today) |
| ADOPT-14 · the workspace is the unit | `adopt` §1–2 (dual discovery, root classification, control-plane placement, reachability, trust/enablement) · `docs/aidlc.config.schema.json` (`workspace.root`, `repo.path`) · `init` Steps 3.4 / 4.1 / 4.4 (gitlink protection skipped as *inapplicable* off-nest) · `work-items` → *Repos & routing* · `run` (quoting, cross-drive, UNC) |
| ADOPT-7 · adoption-time safety contract | `adopt` §0 · profile `safety` block · `scan.network` / `scan.writes` |
| ADOPT-6 · honest degradation | `adopt` §5 · profile `surfaces[]` + `gaps[]` |
| Discoverability | README (the three doors) · `docs/adoption-guide.md` §3 · `docs/user-guide.md` cheat-sheet · `init` Step 3.0 offers adopt as one of three setup paths |
| Enabling change | read-only git introspection allowlisted in the project template; `git config` deliberately **not** (write verb + it echoes PATs from remote URLs) — `docs/permissions-rationale.md` |

**Phase 2 landed in `aidlc` 0.31.0** — config, gates and conventions:

| Story | Landed as |
|---|---|
| ADOPT-3 · profile → config + `CLAUDE.md` | `plugins/aidlc-core/skills/adopt-apply/SKILL.md` · `docs/aidlc.config.schema.json` (`adoption` block, `architecture.resolvedBy: "codebase-scan"`) · `init` Step 3.0 third path |
| ADOPT-4 · derive the gate instead of assuming npm | config `pipeline.gates.verify` + `definitions.gateSteps` · profile `gates[]` + `definitions.gate` · `adopt` §3 (gate derivation) · `run` §7 *The gate* (ordered execution, absent gates as coverage holes, environment-dependent diagnosis, affected/changed-path scoping) |
| ADOPT-5 · adopt the project's git and review conventions | config `definitions.gitConventions` on the mono `git` block and every `repos[]` entry · profile `conventions` · `adopt` §3 (convention derivation) · `git-workflow` (`<base>` resolution, commit style, merge strategy, long-lived branches, hotfix route, fork → upstream PR) · the template rule file now labels itself as defaults |

**What Phase 2 deliberately did not do.** The `guard` hook still matches protected branches **by name**
(`main`, `master`, `develop`, `release/*`), so a project whose integration branch is called something else
(`trunk`, `dev`) is routed correctly by the pipeline but is **not** hook-protected. That exposure predates
this phase rather than being created by it, and changing a security hook with a 74-case suite was out of
scope here — so `adopt-apply` is required to *say so* and recommend host-side branch protection instead of
leaving it silent. Making the guard config-aware is the obvious follow-up.

### What is verified, and what is not

A validation pass ran on 2026-07-30. It split cleanly in two, and so does the confidence:

**Mechanically enforced — `node skills/adopt/validate-profile.test.mjs`, 71 cases, green** (the suite has
since grown to **156** — see *Phase 3 — what is verified, and what is not* below)**.** The
contract is no longer a document the skill is trusted to honour; it is a check the skill must pass, and
the skill now runs it before reporting a scan complete. Enforced: the three legal fact forms and the rule
that an `unknown` fact carries **no value**; evidence on every `known`/`absent` fact and the payload each
evidence kind owes; `writes[]` never leaving `.aidlc/adoption/`; an unreachable root naming its remedy; an
unsupported surface naming its gap; redaction invariants on secret, env and PII findings; the required
report sections; and a backstop that fails on any credential-shaped string anywhere in either artifact.
The suite's reference fixture is itself the proof that the awkward shapes are **representable**: a
multi-root workspace spanning two drives, a monorepo root beside single-app roots, a UNC path with spaces
that is unreachable, a zip drop with no VCS, a Mercurial checkout, a polyglot monorepo, an absent test
gate. Fourteen enums are duplicated in the validator so it can run offline inside an installed plugin;
the suite cross-checks every one against this schema, so that duplication cannot drift silently.

**Two real defects the pass caught, both now fixed** — worth recording because both would have produced
a *confidently wrong* profile rather than a visible failure:

1. **`git rev-parse --is-inside-work-tree` is the wrong probe for "is this root a repo".** Git searches
   ancestor directories, so it answers `true` for any folder beneath any repo — and a home directory
   under git (the machine this ran on has one) makes that every folder. Every follow-up question then
   answered about the **ancestor**: its branch, remotes, history and size, recorded against the root
   *with a citation*. The fix is a marker test plus requiring `rev-parse --show-toplevel` to equal the
   root itself; a root that sits inside another repo is now recorded as `enclosingRepo` and reported as
   the hazard it is, and the validator rejects a root that claims both.
2. **A `.code-workspace` file is JSONC, not JSON.** VS Code accepts `//` comments and trailing commas
   and hand-edited files contain them, so a bare `JSON.parse` throws — under the original instructions
   discovery would then fall back to the folder scan alone and **silently collapse a multi-root
   workspace into a single repo**, which is the precise failure ADOPT-14 exists to prevent. Comments and
   trailing commas are now stripped first, and an unparseable file stops the run loudly instead of
   degrading.

Also verified by fixture, from a `D:` cwd against a `C:` workspace: cross-drive `git -C`, paths with
spaces, `folders[]` entries resolving outside the workspace folder, `name` overrides, a declared-but-
absent root classified `not-cloned`, manifest detection across TS/Python/Java/Go/Ruby/Rust, monorepo
package enumeration, and the CRLF-without-`.gitattributes` churn signal via `git ls-files --eol`.

**Not verified — the checkboxes below stay open.** Everything that needs a live `/aidlc:adopt` run
rather than a fixture: that a real scan writes only those two files, that classifications are genuinely
*proposed* rather than assumed, control-plane resolution in an actual multi-root VS Code session, the
per-root trust and plugin-enablement probes (which the skill is instructed to record `unknown` when the
harness will not tell it), a genuine UNC share, a genuinely offline run, and a read-only workspace. Those
need a real adoption on a real project, which is the next honest step.

### Phase 2 — the live adoption run (2026-07-30)

Phase 2 shipped specified-but-unexercised. A live run has now closed that: a fixture workspace built as a
**GitFlow Python service with no `package.json`** (merge commits, `PAY-nn-slug` branches, CODEOWNERS,
compose-backed tests, no typecheck), a **squash-only TypeScript app** with husky and no CI, a
**fork-based polyglot monorepo** (pnpm + Turbo, a TS package and a Python package, `origin` = fork +
`upstream`), a non-repo docs folder, and a **JSONC** `.code-workspace` — against a control plane
pre-seeded with a **hand-authored** `CLAUDE.md` and config so merge-awareness had something to protect.
`/aidlc:adopt` then `/aidlc:adopt-apply` were executed end to end, and the consumption paths driven off
the config they produced.

**Confirmed working.** Python gates derived from `tox.ini` with no `package.json` anywhere (the headline
ADOPT-4 claim); `typecheck`/`format` recorded `absent` and surfacing as coverage-hole lines; the
compose-backed `test` flagged environment-dependent; Turbo tasks as `affected` scope plus a per-package
`pytest`; GitFlow detected (`integrationBranch: develop`, `mergeStrategy: merge`) and `id-prefixed`
commits for one repo while the other read `conventional` + `squash`; `fork-only` push access; the docs
folder excluded with a reason; **`pipeline.gates.ambiguousRequirements: "ask-human"` preserved untouched**
(the payoff for nesting the new block under `verify`); the hand-authored `make test-all` surfaced as a
conflict and **kept**; every hand-written `CLAUDE.md` line intact; `rules/git-workflow.md` rendered with
GitFlow/squash/fork per repo and AIDLC defaults *labelled as defaults*; and a real branch-and-integrate
proving `<base>` = `develop` left `main` untouched while the squash repo produced zero merge commits.

**Four defects found and fixed.** Every one produced a *plausible* result rather than an error, which is
why only execution surfaced them:

1. **`defaultBranch` came back `unknown` for every repo.** `rev-parse --abbrev-ref origin/HEAD` exits 128
   whenever `origin/HEAD` was never set locally — the normal state of a repo whose remote was *added*
   rather than cloned from. The most load-bearing fact in the profile (it is what `<base>` falls back to)
   was therefore unknown everywhere, stranding the pipeline with nowhere to branch. Now a fallback chain:
   remote refs, then a single trunk-ish local branch confirmed by ancestry, each at `medium`, then
   `unknown`. Fixed 3 of 3 repos in the fixture.
2. **`branchPattern` came back `unknown` for every repo** because merged branches are deleted — normal
   hygiene. Names are now recovered from merge-commit subjects (`Merge branch 'PAY-31-ledger-export' into
   develop`) before giving up. Recovered the GitFlow repo's convention; the squash-only repos stay
   honestly `unknown`, since squashing erases the evidence entirely.
3. **The "re-applying produces no diff" guarantee was false.** `adoption.appliedAt` is a timestamp, so
   every re-apply rewrote one line. `adopt-apply` now compares the proposal with `appliedAt` excluded and,
   when nothing else differs, **writes nothing at all** — so the guarantee is now literal: two consecutive
   re-applies leave a byte-identical file and a clean `git status`.
4. **Gate resolution silently dropped inherited gates.** "Most-specific-wins" meant *replace*, so the
   Python package inside the monorepo resolved to `pytest` alone — the repo-wide `lint` vanished, and a
   vanished gate is indistinguishable from a passing one. Resolution now **layers narrowest → broadest**,
   each layer claiming only gate names no narrower layer took, so a package inherits the repo's other
   gates while its own ordering still wins. Because this is easy to get wrong silently, it is now
   **code, not prose**: `skills/run/resolve-gate.mjs` + a 24-case suite (30 today), which `run` §7 invokes.

**Still unexercised**, and honestly so: a fork PR actually opened against an upstream (needs a real host
and auth — the local push-to-fork mechanics work, the `gh pr create --repo … --head owner:branch` call is
untested), branch-protection and required-reviewer reads (`gh api` is deliberately not allowlisted, so
they prompt and were recorded `unknown` throughout), a genuinely offline/air-gapped run, a read-only
workspace, and a full `/aidlc:run` with agents dispatched over the derived gate.

**Phase 3 landed in `aidlc` 0.32.0** — the project's own reality, beyond its shape:

| Story | Landed as |
|---|---|
| ADOPT-9 · SaaS runtime profile | profile `definitions.saasProfile` + `root.saas` · `adopt` §5 (detection table + the four section rules) · config `definitions.saas` on the mono block and every `repos[]` entry · `adopt-apply` §3.3 (write + union-seed `securityReviewPaths` + cadence *recommendation*) · `run` §6 (constraints in the implementer brief) · `run` §7 *Risk triggers that outrank the cadence* · `run` §8 (freeze window, contract-affecting PR label) · `aidlc-implementer` / `aidlc-reviewer` / `aidlc-security` / `aidlc-architect` · `do` §1/§3 |
| ADOPT-10 · retroactive ADRs | profile `definitions.adrCandidate` + `adrCandidates[]` · `adopt` §6 · **new `skills/adopt-adr/SKILL.md`** · `templates/adr-template.md` (`## Rationale` + `accepted (retroactive)`) · config `adoption.adrs[]` (the re-run dedup key) · `architecture` (*Retroactive ADRs*) · `do` §1 |
| ADOPT-8 · monorepo packages as a topology | profile `root.packages[]` (+ `stack`, `dependsOn`, `releasable`) + `root.releaseTooling` · config `definitions.packages` on the mono block and every `repos[]` entry · `pipeline.gates.verify.packages` (the mono package layer) + `resolve-gate.mjs` · `work-items` (*Item → package resolution*, `package` on the WorkItem) · `run` §2.5/§7/§8 · `status` (grouped by package) · `release` §0 (per-package, only where the tooling supports it) · `templates/run-file.md` |

**What Phase 3 deliberately did not do.** `/aidlc:adopt-adr` is a **third command** rather than part of
`adopt-apply`. Folding it in was tempting — one fewer door — but the two have incompatible approval
shapes: `adopt-apply` proposes one diff over configuration and guarantees a byte-identical no-op on
re-run, while ADRs are numbered files approved *one at a time*, where skipping one is a normal outcome.
Sharing a command would have meant either weakening the no-diff guarantee or burying per-ADR approval
inside a bulk one.

### Phase 3 — what is verified, and what is not

**Mechanically enforced — `node skills/adopt/validate-profile.test.mjs`, 156 cases, green** (up from 93).
The reference fixture now also carries a shared-schema multi-tenant root with its full runtime profile, a
three-package monorepo with a dependency edge and changesets release tooling, and a ranked ADR candidate
list including one already-recorded entry — so the awkward shapes are proven *representable*, not just
described. Ten new enums are cross-checked against this schema, so the validator's offline copies cannot
drift. Three invariants are enforced because each fails **invisibly**:

1. **No ADR candidate carries a rationale** — in any of five spellings (`rationale`, `why`, `because`,
   `alternatives`, `alternativesConsidered`). This is the story's whole point: an ADR marked `accepted`
   reads as settled history, so one plausible invented sentence becomes a decision record nobody authored
   and everybody cites. Also enforced: candidates are ranked by reversibility cost (an unranked list plus
   a cap drops exactly the decisions worth recording) and capped against `scan.budget.caps.maxAdrCandidates`.
2. **Every auth / tenant-isolation / billing path reaches `securityReviewPathSeeds`.** A path recorded as
   sensitive but missing from the seeds never reaches `pipeline.securityReviewPaths` — recorded as
   dangerous, reviewed as routine, in a profile that otherwise looks complete.
3. **A multi-tenant root with a migration tool must answer the expand/contract question.** Silence there
   leaves the reviewer brief with no migration constraint, so a dropped column reads as an ordinary
   refactor — and the gate cannot catch it, because the migration runs clean against an empty test
   database. `not-required` under multi-tenancy is allowed but warns: it is what switches the
   destructive-migration blocker off, so its evidence has to justify it.

Plus, for ADOPT-8: a package's `dependsOn` must resolve to siblings (a dependency resolving to nothing
sequences nothing), the graph must be acyclic (a cycle leaves "which lands first" unanswerable), and a
package marked `releasable` requires `releaseTooling` — otherwise `/aidlc:release` promises a cadence the
repo cannot cut. `resolve-gate.test.mjs` is at **30 cases** covering the new mono `verify.packages` layer,
including that a repo-scoped package block outranks it.

**Not verified — no live run yet.** Phase 3 ships specified-but-unexercised, exactly as Phase 2 did before
the run that found four defects in it. Everything below needs a real brownfield project rather than a
fixture: whether tenancy detection actually reads correctly off a real ORM (the `--depth deep` sampling
path is the least exercised code in the scan); whether the risk triggers fire on real diffs without false
positives; whether a rendered retroactive ADR is genuinely useful to a team that lived through the
decision, or reads as a restatement of their own code; whether the per-package release path works against
real changesets/Lerna tooling; and whether `securityReviewPaths` seeding produces a workable review volume
rather than flagging every second diff. The Phase 2 lesson applies unchanged: **each of those would fail
by producing a plausible result rather than an error**, which is why only execution will surface them.

**Phase 4 is unstarted.** Nothing yet seeds a debt backlog from the findings, produces a drift report on
re-scan, supports scoped/partial adoption beyond `--only`, upgrades an older config in place, or documents
clean removal. `/aidlc:adopt` reports and proposes; `/aidlc:adopt-apply` writes config behind a diff;
`/aidlc:adopt-adr` writes ADRs behind per-ADR approval; none of them remediates anything, and all three
say so.

### Deviations from this spec, and why

**Phase 3 · the ADR template gained a `## Rationale` section.** ADOPT-10 requires a retroactive ADR to
use `templates/adr-template.md` *and* to leave `## Rationale` marked *"not recorded"* — but that template
had no such section: its "why" lived in Context and Alternatives. Rather than fork a second ADR format
(which would have meant retroactive ADRs looking structurally different from the ones the architect
writes, for no reader's benefit), the shared template gained `## Rationale` after `## Decision`. It is
useful in the greenfield case too — "why this over the alternatives" is the line a reader wants most in a
year — and it is the section a retroactive ADR must visibly leave blank. Two smaller notes: the field is
spelled `**Date:**` (the template's existing key) rather than the story's `Decided:`, and
`accepted (retroactive)` was added to the status line's enumeration.

**Phase 3 · `--max-adrs` rather than a config key.** ADOPT-10 says the cap is "configurable". It is an
argument on the scan (recorded in `scan.budget.caps.maxAdrCandidates`), not a config field: the `adoption`
block is scan-written provenance the schema tells users never to hand-edit, and a knob that belongs to one
invocation does not belong in permanent configuration.

### One deviation from Phase 2's spec, and why

ADOPT-4 names the config block **`pipeline.gates`**. That key was **already taken**:
`pipeline.gates.ambiguousRequirements` is live (read by `run` §4's requirements gate), documented in
`docs/adoption-guide.md`, and shipped in both config templates — it decides what happens when a
requirement is ambiguous, which has nothing to do with verification. Putting an ordered command sequence
beside it would have overloaded one key with two unrelated meanings.

The verification gate therefore lives at **`pipeline.gates.verify`** (`.steps`, `.repos.<repo>.steps`,
`.repos.<repo>.packages.<pkg>.steps`, `.maxItemMinutes`). The block name from the spec is kept, the
existing key is untouched and now *documented in the schema for the first time*, and nothing breaks. Read
every `pipeline.gates` in the ADOPT-4 story below as `pipeline.gates.verify`.

---

## Epic

```yaml
id: ADOPT-1
type: epic
title: Brownfield adoption — derive an AIDLC project profile from an existing codebase
status: todo
priority: P1
labels: [aidlc-core, adoption, brownfield]
```

**Description.** Add `/aidlc:adopt`, the brownfield counterpart to `/aidlc:bootstrap`: scan an
existing **workspace** — which in practice is a VS Code workspace holding one repo or several
(`backend/`, `frontend/`, `website/`, …) — derive an evidence-backed profile of its topology, stack,
gates, conventions and SaaS runtime constraints **per repo**, and — after review — write that profile
into one workspace-level `aidlc.config.json` + `CLAUDE.md`, propose retroactive ADRs for decisions
already embedded in the code, and optionally seed a debt backlog. The pipeline then runs across the
whole workspace against *this project's* reality rather than the framework's defaults.

**Out of scope for this epic** (tracked separately): new stack plugins (`aidlc-stack-python` etc.),
new tracker adapters (GitHub Issues, Linear), and any automatic remediation of what the scan finds —
adopt reports and proposes; fixing is normal pipeline work.

---

## Stories

### ADOPT-2 — `/aidlc:adopt`: read-only codebase scan → evidence-backed profile

```yaml
type: story  priority: P1  estimate: L  parent: ADOPT-1  dependsOn: []
labels: [skill, scan]
```

**Description.** A new user-invocable skill that inspects the working tree and git metadata and emits
a machine-readable profile plus a human-readable report. Detection layers: VCS state (git? shallow?
submodules? LFS? worktrees? non-git?), workspace topology (single app · single repo with workspaces ·
several git repos · a multi-root IDE workspace, per ADOPT-14 · not-yet-cloned repos), languages and
package managers (manifest-driven:
`package.json`, `pyproject.toml`/`requirements.txt`, `pom.xml`/`build.gradle*`, `*.csproj`/`*.sln`,
`go.mod`, `Gemfile`, `composer.json`, `Cargo.toml`, `mix.exs`, `Package.swift`, `pubspec.yaml`),
frameworks, test/lint/build entry points, CI systems, migration tooling, and container/dev-env
requirements. Writes only `.aidlc/adoption/profile.json` + `.aidlc/adoption/report.md`.

**Acceptance criteria**
- [ ] Running `/aidlc:adopt` on a repo with no AIDLC config produces `.aidlc/adoption/profile.json`
      and a report, and **modifies no other file** (`git status` shows only those paths).
- [ ] Every fact in the profile carries `evidence` (a `path:line` or the command + its output) and
      `confidence` (`high|medium|low`); facts that could not be established appear as `unknown` with
      the reason, and are counted in the report's "not determined" section.
- [ ] Topology is classified as one of `single-app` · `monorepo` (one git repo, many packages) ·
      `poly` (many git repos) · `unknown`, with the deciding signal named.
- [ ] Languages/frameworks/package managers are detected from manifests for at least: TS/JS, Python,
      Java/Kotlin, C#/.NET, Go, Ruby, PHP, Rust; a polyglot repo lists **all** of them with the paths
      that carry each, not just the dominant one.
- [ ] The report ends with a stated scan budget (files/dirs inspected, time taken) and an explicit
      list of what was skipped (vendored, generated, `node_modules`, LFS pointers, ignored paths).
- [ ] On a non-git directory, or a Mercurial/SVN/Perforce checkout, the scan still profiles the code
      and reports the VCS as unsupported rather than failing.

**Notes.** The profile schema is the contract every later story reads; version it
(`profileVersion`) from day one. Prefer manifest and config parsing over source reading — it is
cheaper, more deterministic, and avoids pulling proprietary source into context.

---

### ADOPT-14 — The IDE workspace, not the repo, is the unit of adoption

```yaml
type: story  priority: P1  estimate: L  parent: ADOPT-1  dependsOn: [ADOPT-2]
labels: [workspace, vscode, schema]
```

*(Phase 1 despite the ID — IDs are stable, not ordered.)*

**Description.** Users run Claude Code from a VS Code workspace, which is either **one folder with
the repos as subfolders** or a **multi-root `.code-workspace`** whose `folders[]` may live anywhere,
including different drives. AIDLC's poly layout is already the right *model* for this — one control
plane, `repos[]`, one unified board — but its *mechanics* assume every repo is nested under the
control plane: `workspace.root` is "the directory under which the declared repo paths live",
`repo.path` is "relative to workspace.root", `init:165` states "the product repos are its
subfolders", and the gitlink protection (`init:184-192`) is built on repos sitting inside the control
plane's git index. Nothing anywhere references VS Code, `.code-workspace`, or added working
directories. This story makes the workspace the unit: discover its shape from IDE artifacts, classify
every root, place the control plane deterministically, drop the nesting assumption from the schema,
and verify each repo is actually reachable and trusted before claiming it is configured.

**Acceptance criteria**
- [ ] Discovery reads any `*.code-workspace` file's `folders[]` (including `name` overrides and paths
      outside the opened folder) **in addition to** scanning for `<sub>/.git`, so the multi-root case
      is detected rather than collapsing to a single repo.
- [ ] Every discovered root is classified — product repo · monorepo (many packages) · non-repo folder
      (docs, scratch) · reference-only clone · already-adopted — and the classification is proposed
      for confirmation, never assumed. Only product repos and monorepos become `repos[]` entries.
- [ ] The control plane resolves to the folder holding the `.code-workspace` file when one exists,
      else the opened folder; if that folder is not itself a workspace root, adopt offers to add it as
      one. A product repo is **never** silently chosen as the control plane.
- [ ] `repo.path` accepts an absolute path or a path outside `workspace.root`, and `workspace.root`
      may be absent; the schema descriptions stop asserting that repos are subfolders.
- [ ] When a repo is not nested under the control plane, the `.gitignore` / gitlink protection
      (`init:184-192`) is skipped as inapplicable and the report says why; when it *is* nested, that
      protection applies unchanged.
- [ ] Every declared repo is verified reachable from the running session; an unreachable root is
      reported with the exact `--add-dir` / `/add-dir` remedy, and adopt never reports a repo as
      configured when it could not read it.
- [ ] Per-root trust and plugin-enablement state is checked, and any root that would fail silently
      (untrusted, or AIDLC not enabled at that scope) is named at adoption time with its fix — the
      F42 failure mode caught here instead of at the first `/aidlc:sprint` launch.
- [ ] Paths with spaces, UNC paths and cross-drive paths round-trip through config and through the
      run skill's `cd "<abs repo path>"` invocation (`run:141`) without quoting or resolution errors.
- [ ] A workspace mixing a monorepo root with single-app roots is representable — poly at the
      workspace level, `packages[]` inside the monorepo's `repos[]` entry (see ADOPT-8).
- [ ] Discovery degrades cleanly outside VS Code (JetBrains, a plain terminal, CI): no `.code-workspace`
      simply means the folder scan is the only signal — nothing depends on an IDE being present.

**Notes.** Which folder Claude Code receives as cwd in a multi-root workspace must be established
empirically across VS Code and extension versions rather than assumed — the design deliberately
anchors the control plane to the `.code-workspace` file rather than to cwd so it holds regardless.

---

### ADOPT-3 — Profile → `aidlc.config.json` + `CLAUDE.md`, proposed and merge-aware

```yaml
type: story  priority: P1  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-2, ADOPT-14]
labels: [config, schema]
```

**Description.** Turn an approved profile into configuration: `architecture` (`status: resolved`,
`style`, `resolvedBy: "codebase-scan"`, `rationale` + evidence), `workspace.layout`, `repos[]` for a
detected poly workspace, per-repo `stack`, and the `Commands` block in `CLAUDE.md`. Extend
`docs/aidlc.config.schema.json` with `architecture.resolvedBy: "codebase-scan"` and an
`adoption` block recording when the profile was taken and against which commit.

**Acceptance criteria**
- [ ] The full diff (config + `CLAUDE.md`) is shown before any write, with each changed value's
      evidence beside it; nothing is written without explicit approval.
- [ ] Facts a human already authored (existing `CLAUDE.md` lines, existing config values) are
      **never overwritten** — a conflict is surfaced as `detected X, configured Y — keep / replace`.
- [ ] Any fact with `confidence: low` is presented as a question, not a proposed value.
- [ ] `architecture.resolvedBy` is `"codebase-scan"` and `adoption.scannedAt` + `adoption.commit`
      record provenance; re-running against the same commit proposes no changes.
- [ ] The written config validates against `docs/aidlc.config.schema.json`, and the file is re-read +
      `JSON.parse`d after writing (per the F49 discipline).
- [ ] `/aidlc:init` offers `/aidlc:adopt` as a third setup path ("there's existing code — scan it")
      alongside the deferred and full paths (`init:66-81`).

---

### ADOPT-4 — Derive the verification gate from the project instead of assuming npm

```yaml
type: story  priority: P1  estimate: L  parent: ADOPT-1  dependsOn: [ADOPT-2]
labels: [pipeline, gates]
```

**Description.** Today the per-item floor is described as "lint + typecheck + tests"
(`skills/run/SKILL.md:289`) with commands the user typed into `CLAUDE.md` at init. Introduce a
`pipeline.gates` config block — per repo/package, an ordered list of `{name, cmd, required,
timeoutMinutes, scope}` — populated by detection (npm/pnpm/yarn/bun scripts, Nx/Turbo/Lerna targets,
Make/Task/just targets, Gradle/Maven goals, tox/nox/poetry/uv, `go test`, `cargo`, `dotnet`,
`bundle exec`, `pre-commit`) and read by the run skill's verify phase.

**Acceptance criteria**
- [ ] `pipeline.gates` is in the schema, supports per-repo and per-package overrides, and the run
      skill executes it in order instead of assuming npm scripts; a repo with no `package.json`
      completes a full run with its real gate (e.g. `pytest` + `ruff`).
- [ ] A gate that does not exist in the project (e.g. no typecheck, no tests) is recorded as
      `absent` and reported in the run's `## Findings` as an explicit coverage hole — never counted
      as green.
- [ ] A suite exceeding a configurable duration is scoped per item (affected package / changed-path
      subset) with the full suite deferred to CI, and the run file records which subset ran.
- [ ] In a monorepo with an affected-graph runner (Nx/Turbo), the per-item gate runs affected targets
      only, and the report names the affected set.
- [ ] Detected pre-existing hooks (husky, pre-commit.com, lefthook) are recorded and **not**
      duplicated by the AIDLC pre-commit layer.
- [ ] Gates requiring services (Docker Compose, testcontainers, a live DB) are flagged as
      environment-dependent so a failure is diagnosed as "environment unavailable", not "code broken".

---

### ADOPT-5 — Adopt the project's existing git and review conventions

```yaml
type: story  priority: P1  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-2]
labels: [git, rules]
```

**Description.** `templates/project/.claude/rules/git-workflow.md` hard-codes conventional commits,
`{type}/{id}-{slug}` branches, `[KEY-123]` PR titles and one-item-one-PR. A team with GitFlow, a
`JIRA-123-description` branch style, squash-only merges or a fork-based contribution model must
hand-edit a rule file after scaffolding, and nothing at init asks. Detect the conventions from recent
history and repo settings, confirm them, and render the rule file from the answers.

**Acceptance criteria**
- [ ] Branch convention, commit-message convention, merge strategy (merge/squash/rebase), default and
      long-lived branches (`develop`, `release/*`), and required reviewers/CODEOWNERS are derived from
      the last N commits/branches + host settings, each with evidence.
- [ ] The scaffolded `rules/git-workflow.md` reflects the detected conventions; where the project has
      none, AIDLC's defaults are used and marked as defaults.
- [ ] A GitFlow project targets its integration branch (not `main`) for feature work, and the run
      skill branches from and integrates into that branch.
- [ ] A repo where the user cannot push (fork-based contribution) is detected and the integration
      path proposes fork + upstream PR rather than failing at push.
- [ ] Protected-branch / required-check policy is read where the host API allows, and any repo whose
      PRs would merge ungated is named explicitly (extending `init:267-269` to brownfield repos).

---

### ADOPT-6 — Honest degradation and capability-gap recording

```yaml
type: story  priority: P1  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-2]
labels: [degradation, extensions]
```

**Description.** The only stack plugin is `aidlc-stack-web`; the only tracker sources are markdown,
Jira and ADO. A Django + Terraform + Flutter shop gets the language-agnostic core and nothing else —
which is fine, provided the framework says so plainly and records the gap rather than implying
coverage.

**Acceptance criteria**
- [ ] The report contains a "supported / partial / unsupported" table for every detected surface
      (stack, tracker, VCS, CI system, migration tool) with the consequence of each gap stated in one
      line.
- [ ] Each unsupported surface is written to `.aidlc/extensions.json` as a capability gap so
      `/aidlc:scaffold-skill` and `/aidlc:promote` can act on it later.
- [ ] A project whose tracker is unsupported (GitHub Issues, Linear, spreadsheet, none) is offered the
      markdown backlog as the adapter, with the trade-off stated — not blocked.
- [ ] No report or config claims a gate, standard or review capability that the installed plugins do
      not actually provide.

---

### ADOPT-7 — Adoption-time safety contract

```yaml
type: story  priority: P1  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-2]
labels: [security, safety]
```

**Description.** A scan runs across code the team may be contractually bound to protect, in
environments that may be offline, restricted or air-gapped, on repos that may contain secrets in the
working tree and in history.

**Acceptance criteria**
- [ ] `.env` and `.env.*` are never read or printed by the scan; their *presence and variable names*
      may be recorded only where `pipeline.envFileAccess` permits, and the `env-guard` hook path is
      respected unchanged.
- [ ] Detected secrets (working tree or history) are reported by location and type, with the value
      redacted, and are never written into the profile, the report, an item or a commit.
- [ ] The scan makes no network calls and sends no source to any external service; with MCP servers
      unreachable or the machine offline, it completes and marks the affected checks `unknown`.
- [ ] Repos above a size threshold are sampled rather than fully read, and the report states the
      sampling strategy and its coverage percentage.
- [ ] Fixture/seed files that look like they carry PII are flagged for human review and excluded from
      any content quoted into the report.
- [ ] A read-only run is possible with zero write permissions (no `.aidlc/` write): the report is
      printed to the session instead, and the skill says so.

---

### ADOPT-8 — Monorepo (one repo, many packages) as a first-class topology

```yaml
type: story  priority: P2  estimate: L  parent: ADOPT-1  dependsOn: [ADOPT-2, ADOPT-4]
labels: [topology, routing]
```

**Description.** `mono` today means one repo delivering one app; `poly` means many git repos. A
pnpm-workspaces / Nx / Turborepo / Maven-multi-module repo is neither: one git repo, many
independently-owned packages with their own gates and release cadence. Routing, gate scoping and
release all need the package dimension.

**Acceptance criteria**
- [ ] A `packages[]` registry (name, path, role, stack, labels) is supported for `layout: mono`, with
      the same routing hints `repos[]` uses.
- [ ] `packages[]` is equally valid **on a `repos[]` entry**, so a workspace holding one monorepo
      alongside single-app repos is representable without a second layout value (the hybrid case from
      ADOPT-14).
- [ ] `/aidlc:run` resolves an item to a package and scopes implementation, gate and PR labels to it;
      one item still equals one branch and one PR.
- [ ] Cross-package work decomposes the same way cross-repo work does, with `dependsOn` sequencing.
- [ ] `/aidlc:release` cuts a per-package release where the repo's tooling supports it (changesets,
      Lerna, independent versioning), and says so plainly where it does not.
- [ ] `/aidlc:status` groups in-flight work by package.

---

### ADOPT-9 — SaaS runtime profile: the constraints that change how code must be written

```yaml
type: story  priority: P2  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-2, ADOPT-3]
labels: [saas, pipeline]
```

**Description.** For a live SaaS, the facts that most constrain an implementation are not in the
stack list: how tenants are isolated, whether releases ride feature flags, whether migrations must be
expand/contract against live data, what the public API contract promises, and which compliance regime
governs change. Detect them, record them in a `saas` config block, and feed them to the
implementer/reviewer/security agents as hard constraints.

**Acceptance criteria**
- [ ] Multi-tenancy model is detected where evidenced (shared-schema `tenant_id` columns ·
      schema-per-tenant · database-per-tenant · single-tenant) with the evidence cited, or recorded
      `unknown`.
- [ ] A feature-flag system in use (LaunchDarkly, Unleash, homegrown) is recorded, and when present
      the implementer brief states that user-visible changes ship behind a flag.
- [ ] The migration tool (Prisma, TypeORM, Alembic, Flyway, Liquibase, EF Core, Rails, Django,
      golang-migrate) and its directory are recorded; when the tenancy model is live-shared, the
      reviewer brief carries the expand/contract + backfill requirement and destructive migrations
      become a review blocker.
- [ ] Public API contracts (OpenAPI/GraphQL SDL/protos) are located, and a diff touching them marks
      the item as contract-affecting so breaking-change review is triggered.
- [ ] Environments and deploy strategy (staging/prod, preview envs, blue-green/canary, release
      trains, freeze windows) are recorded where evidenced from CI/CD config.
- [ ] A detected compliance regime (SOC 2 / HIPAA / GDPR / PCI signals) sets `securityReviewPaths`
      seeds and raises the security cadence recommendation, with the signal named.
- [ ] Auth/tenant-isolation paths are added to `securityReviewPaths` so changes there trigger review
      regardless of the configured cadence.

---

### ADOPT-10 — Retroactive ADRs for decisions already embedded in the code

```yaml
type: story  priority: P2  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-2]
labels: [adr, docs]
```

**Description.** `/aidlc:do` and the architect are only as good as `docs/adr/`
(`skills/do/SKILL.md:83-85`), which on a brownfield project is empty while the decisions themselves
are everywhere in the code. Propose ADRs for the top irreversible decisions found — framework, data
store, auth model, tenancy model, API style, deployment topology, messaging — each with evidence and
an explicitly empty rationale for a human to fill.

**Acceptance criteria**
- [ ] Proposed ADRs use the existing `templates/adr-template.md` with status
      `accepted (retroactive)` and a `Decided: unknown` date where history cannot establish one.
- [ ] Every ADR cites the code evidence for the decision and leaves `## Rationale` marked
      *"not recorded — confirm with the team"*; **no rationale is invented**.
- [ ] The set is capped (default 8, configurable), ranked by reversibility cost, and proposed for
      per-ADR approval — nothing is written unapproved.
- [ ] Existing architecture docs in other formats/locations (Confluence, Notion, `RFCs/`, `docs/`)
      are detected and **linked** from the ADR index rather than copied or relocated.
- [ ] Re-running adopt does not propose an ADR for a decision already recorded.

---

### ADOPT-11 — Seed a debt/gap backlog from the codebase (opt-in)

```yaml
type: story  priority: P3  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-2, ADOPT-6]
labels: [backlog, intake]
```

**Description.** Optionally convert what the scan found into tracked work: absent gates, untested
critical paths, deprecated/EOL dependencies, TODO/FIXME clusters, security-sensitive paths with no
review history, docs drift. Routed through the same adapter and the same propose-before-create
discipline as `/aidlc:intake`, deduped against the existing board.

**Acceptance criteria**
- [ ] Item creation is opt-in, capped (default 20, user-adjustable), and every proposed item is shown
      before creation with its evidence.
- [ ] Proposals are deduped against open tracker items exactly as `intake:27-32` does — fully covered
      → skip and report; partially → propose the delta.
- [ ] Every created item carries the `adopted` label plus a dated provenance note naming the scan
      commit, so adoption-born work stays queryable against planned work.
- [ ] Each item has ≥3 testable acceptance criteria and a size; none is a bare title.
- [ ] On a board with thousands of existing items, the dedup sweep is bounded and states its scope.

---

### ADOPT-12 — Re-adoption, drift, partial adoption, upgrade and clean removal

```yaml
type: story  priority: P2  estimate: M  parent: ADOPT-1  dependsOn: [ADOPT-3]
labels: [lifecycle, idempotency]
```

**Description.** Adoption is not a one-shot event: codebases drift from their recorded profile, teams
pilot on one repo before rolling out, older AIDLC configs need upgrading, and some evaluations end in
removal. All four must be first-class.

**Acceptance criteria**
- [ ] `/aidlc:adopt` on an already-adopted project produces a **drift report** (recorded profile vs.
      current reality: new packages, changed gates, new services, stack changes) and proposes only the
      deltas.
- [ ] Adoption can be scoped to a subset (`--only <repo|package>`), leaving the rest unmanaged, and
      the config records which surfaces are AIDLC-managed.
- [ ] A config written by an older plugin version is upgraded in place, with the changes shown, and
      the schema version recorded.
- [ ] A documented removal path deletes AIDLC-owned files and reverts the merged `CLAUDE.md` /
      settings sections, leaving the project's own files untouched — verified by a clean `git diff`
      against the pre-adoption commit on a test repo.
- [ ] Two consecutive adopt runs on an unchanged commit produce an empty diff.

---

### ADOPT-13 — Documentation and a real-world walkthrough

```yaml
type: story  priority: P2  estimate: S  parent: ADOPT-1  dependsOn: [ADOPT-3, ADOPT-4, ADOPT-5]
labels: [docs]
```

**Acceptance criteria**
- [ ] `docs/adoption-guide.md` gains a *Brownfield: adopting an existing project* section covering
      the scan → review → write → first-run sequence and the read-only guarantee.
- [ ] `docs/example-walkthrough.md` (or a sibling) walks a genuinely existing repo — not a
      scaffolded one — from `/aidlc:adopt` to a merged PR.
- [ ] The README's front-door list distinguishes the three doors: `bootstrap` (requirements in),
      `adopt` (code in), `intake` (one requirement in).
- [ ] CHANGELOG entry + schema documentation for `pipeline.gates`, `packages[]`, `saas`, `adoption`.

---

## Scenario coverage matrix

Every scenario this spec was written against, and where it lands. `—` means deliberately out of scope
for this epic, with the reason.

### A · Repository and version-control topology

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| A1 | Single repo, single app | Classic mono; profile confirms rather than asks | ADOPT-2/3 |
| A2 | One repo, many packages (pnpm/Nx/Turbo/Lerna/Maven/Gradle/Bazel) | New `monorepo` topology + package routing | ADOPT-8 |
| A3 | Many git repos already on disk | Detect as poly, populate `repos[]` with roles from evidence | ADOPT-2/3 |
| A4 | Repos declared but not yet cloned | Record; do not fabricate paths; offer clone step | ADOPT-3 |
| A5 | Git submodules / subtrees | Detect and report; never treat as AIDLC repos; avoid gitlink hazard | ADOPT-2 |
| A6 | Existing worktrees | Detect so `/aidlc:sprint` does not collide | ADOPT-2 |
| A7 | Not a git repo (zip drop) | Profile the code, report VCS unsupported, offer `git init` | ADOPT-2 |
| A8 | SVN / Mercurial / Perforce / TFVC | Profile code; declare VCS unsupported; no silent git assumptions | ADOPT-2/6 |
| A9 | Shallow clone / LFS / very large repo | Sampled scan with stated coverage; LFS pointers not read as source | ADOPT-2/7 |
| A10 | Vendored, generated or committed build output | Excluded from analysis and from any debt items | ADOPT-2 |
| A11 | Fork of an upstream project | Detect upstream; contribution path is fork→upstream PR | ADOPT-5 |
| A12 | GitFlow / long-lived branches / release branches | Branch from and integrate into the real integration branch | ADOPT-5 |
| A13 | Squash-only or rebase-only merge policy | Recorded; integration step honours it | ADOPT-5 |

### B · Language and stack

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| B1 | TypeScript/JavaScript | Full support (existing `aidlc-stack-web`), merge-aware | existing + ADOPT-3 |
| B2 | Python (Django/Flask/FastAPI) | Core pipeline + real gates; stack plugin gap recorded | ADOPT-4/6 |
| B3 | Java/Kotlin (Maven/Gradle/Spring) | As B2; multi-module maps to packages | ADOPT-4/6/8 |
| B4 | C#/.NET (sln/csproj) | As B2; solution projects map to packages | ADOPT-4/6/8 |
| B5 | Go, Ruby, PHP, Rust, Elixir | As B2 | ADOPT-4/6 |
| B6 | Polyglot repo (API + web + IaC + scripts) | All languages listed with paths; per-path gates | ADOPT-2/4 |
| B7 | Mobile (Swift/Kotlin/RN/Flutter) | Detected; store-release cadence flagged as unsupported gate | ADOPT-6 |
| B8 | Data/ML (notebooks, dbt, Airflow) | Detected; non-standard test story reported honestly | ADOPT-6 |
| B9 | IaC (Terraform/Pulumi/CDK/Helm) | Detected; plan/apply gates flagged as environment-dependent | ADOPT-4/6 |
| B10 | Legacy (no tests, no lint, old runtime) | Gates recorded `absent`; coverage hole surfaced per run | ADOPT-4 |
| B11 | Vendor/low-code platforms (Salesforce, ServiceNow, Power Platform) | Partial file-based profile; unsupported stated | ADOPT-6 |

### C · Build, test and quality gates

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| C1 | Existing eslint/tsconfig/prettier differing from ours | Adopt the project's; never overwrite | existing (`init:206-209`) |
| C2 | Non-npm test runners (pytest/JUnit/go test/rspec/xunit) | Gate detection covers them | ADOPT-4 |
| C3 | Make / Taskfile / just as the entry point | Detected as the gate command source | ADOPT-4 |
| C4 | Affected-graph runners (Nx, Turbo) | Per-item gate runs affected targets only | ADOPT-4/8 |
| C5 | No tests at all | Gate recorded `absent`, reported per run, never green-by-omission | ADOPT-4 |
| C6 | Very slow suite (30 min+) | Scoped subset per item; full suite deferred to CI; recorded | ADOPT-4 |
| C7 | Flaky suite | Flakiness flagged so a failure is not misread as the item's regression | ADOPT-4 |
| C8 | Tests need services (DB/Redis/Kafka/testcontainers/compose) | Environment-dependent flag; distinct failure diagnosis | ADOPT-4 |
| C9 | Existing CI (Actions/Azure/GitLab/Jenkins/Circle/Bitbucket) | Gate steps reconciled with the local gate; parity gaps named | ADOPT-4/5 |
| C10 | Merge queues / required checks | Detected; integration respects them | ADOPT-5 |
| C11 | Existing hooks (husky/pre-commit/lefthook) | Recorded, not duplicated | ADOPT-4 |
| C12 | Windows dev + Linux CI | Existing findings F17/F29 carry over; lockfile/EOL caveats surfaced | existing + ADOPT-4 |

### D · Tracker and team process

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| D1 | Populated Jira/ADO board (thousands of items) | Bounded dedup sweep with stated scope | ADOPT-11 |
| D2 | Custom workflow states, per type | Existing per-type `statusMap` discipline (F7/F20) | existing |
| D3 | Multiple boards/projects/teams on one repo | Record which board governs; do not merge boards | ADOPT-3 |
| D4 | Unsupported tracker (GitHub Issues, Linear, Shortcut, Trello) | Report unsupported; offer markdown; record capability gap | ADOPT-6 |
| D5 | No tracker at all | Markdown backlog proposed as the adapter | ADOPT-6 |
| D6 | Existing epics/labels/components/sprints | Map to canonical types; never duplicate | ADOPT-11 |
| D7 | CODEOWNERS / required reviewers / approval counts | Detected and honoured at PR time | ADOPT-5 |
| D8 | Regulated change control (traceability evidence) | Compliance signal raises review cadence; run file is the audit trail | ADOPT-9 |
| D9 | Hotfix path (prod incident bypassing normal flow) | Recorded as a distinct branch/integration route | ADOPT-5 |

### E · SaaS runtime reality

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| E1 | Multi-tenancy: shared schema / schema-per-tenant / DB-per-tenant | Detected with evidence; drives migration + security constraints | ADOPT-9 |
| E2 | Feature flags as the release mechanism | Recorded; implementer briefed to ship behind a flag | ADOPT-9 |
| E3 | Migrations against live data | Expand/contract + backfill requirement; destructive migration blocks review | ADOPT-9 |
| E4 | Public API contract (OpenAPI/GraphQL/proto) | Contract-touching diffs trigger breaking-change review | ADOPT-9 |
| E5 | Environments + preview envs + blue-green/canary | Recorded from CI/CD config | ADOPT-9 |
| E6 | Release trains / deploy freeze windows | Recorded; surfaced when integration would violate one | ADOPT-9 |
| E7 | Billing/subscription/entitlement paths | Added to security-review paths (revenue-critical) | ADOPT-9 |
| E8 | AuthN/AuthZ, SSO, RBAC, tenant isolation | Always security-review paths regardless of cadence | ADOPT-9 |
| E9 | Compliance regime (SOC 2 / HIPAA / GDPR / PCI) | Signal named; cadence recommendation raised | ADOPT-9 |
| E10 | Background jobs, queues, event contracts | Detected; consumer-contract changes flagged | ADOPT-9 |
| E11 | Observability (Sentry/Datadog/OTel), SLOs | Recorded; incidents usable as an intake source | ADOPT-9 |
| E12 | Third-party integrations, webhooks, sandbox vs prod creds | Recorded; prod credential use stays barred by `rules/safety.md` | existing + ADOPT-9 |
| E13 | Experimentation/analytics (A/B) | Recorded where evidenced | ADOPT-9 |

### F · Security, compliance and environment

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| F1 | `.env` files with real secrets present | Never read or printed; `envFileAccess` + `env-guard` respected | ADOPT-7 |
| F2 | Secrets committed in history | Reported redacted by location/type; never echoed or committed | ADOPT-7 |
| F3 | PII in fixtures/seed data | Flagged; excluded from quoted report content | ADOPT-7 |
| F4 | Proprietary/licensed code | No external transmission; local-only analysis | ADOPT-7 |
| F5 | Offline / air-gapped / corporate proxy / no MCP | Scan completes; affected checks marked `unknown` | ADOPT-7 |
| F6 | Read-only permissions (no repo write, read-only tracker) | Report printed to session; no writes attempted | ADOPT-7 |
| F7 | Cannot set branch policy (no org permissions) | Named as a tracked devops task, not silently skipped | ADOPT-5 |

### G · Framework-adoption mechanics

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| G1 | Existing `CLAUDE.md` | Merge, never overwrite | existing (`init:45`) |
| G2 | Existing `.claude/settings.json` | Shown-then-approved union merge | existing (`init:46-61`) |
| G3 | Other agent configs (Cursor rules, AGENTS.md, Copilot instructions) | Detected and referenced rather than duplicated or clobbered | ADOPT-3 |
| G4 | Older AIDLC version already installed | Config upgraded in place, changes shown | ADOPT-12 |
| G5 | Partial adoption (one repo/team/pilot) | Scoped adoption; unmanaged surfaces recorded | ADOPT-12 |
| G6 | Existing docs/ADRs in another format | Linked, not relocated | ADOPT-10 |
| G7 | Conventions conflicting with AIDLC rules | Project wins; rule file rendered from detection | ADOPT-5 |
| G8 | Evaluation ends — remove AIDLC | Documented, verified clean removal | ADOPT-12 |
| G9 | Mixed OS team, WSL paths, case sensitivity, CRLF | Detected; existing `.gitattributes` guidance applies | ADOPT-2 |

### H · Scale, trust and cost

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| H1 | Codebase too large to read fully | Bounded sampling with stated coverage | ADOPT-2/7 |
| H2 | "Show me value in 10 minutes" vs. full audit | Depth is a parameter; the cheap pass is useful alone | ADOPT-2 |
| H3 | Low trust on first contact | Read-only default; every write proposed | ADOPT-2/3/7 |
| H4 | Codebase drifts after adoption | Drift report on re-run | ADOPT-12 |
| H5 | Wrong inference written into permanent files | Evidence + confidence on every fact; low confidence asks | ADOPT-2/3 |

### I · IDE workspace (the VS Code reality)

| # | Scenario | Required behaviour | Story |
|---|---|---|---|
| I1 | One folder opened, repos as subfolders (`backend/`, `frontend/`) | Detected as poly; control plane is the opened folder | ADOPT-14 |
| I2 | Multi-root `.code-workspace`, roots share a parent | `folders[]` read; control plane beside the `.code-workspace` file | ADOPT-14 |
| I3 | Multi-root, no common parent / different drives | Absolute repo paths; nesting + gitignore assumptions dropped | ADOPT-14 |
| I4 | A root that is not a git repo (docs, scratch, notes) | Classified non-repo; excluded from `repos[]` | ADOPT-14 |
| I5 | A root that is a reference clone (read-only, not ours) | Classified reference-only; never a routing target | ADOPT-14 |
| I6 | A root containing several nested git repos | Each classified; nesting hazard reported, not silently flattened | ADOPT-14 · ADOPT-2 |
| I7 | Root outside cwd is unreachable to the session | `--add-dir` / `/add-dir` remedy named; no repo claimed as configured | ADOPT-14 |
| I8 | Root untrusted, or plugin not enabled at that scope | Named at adoption time with the fix (the F42 failure, caught early) | ADOPT-14 |
| I9 | Mixed shapes: a monorepo root beside single-app roots | Poly at workspace level + `packages[]` on that repo entry | ADOPT-14 · ADOPT-8 |
| I10 | Paths with spaces, UNC paths, cross-drive paths | Round-trip through config and the run skill's `cd "<abs path>"` | ADOPT-14 |
| I11 | User adds/removes a root in VS Code after adoption | Drift report proposes the delta | ADOPT-12 |
| I12 | Not VS Code (JetBrains, plain terminal, headless CI) | Folder scan is the only signal; nothing requires an IDE | ADOPT-14 |
| I13 | Repos declared in the workspace but not yet cloned | Recorded; clone offered; no fabricated paths | ADOPT-14 · ADOPT-3 |
| I14 | Per-repo stacks differ (Node API + Python worker + React web) | Stack, gates and standards resolved **per repo**, not workspace-wide | ADOPT-2 · ADOPT-4 |

### Explicitly out of scope

| Scenario | Why |
|---|---|
| New stack plugins (`aidlc-stack-python`, `-java`, `-dotnet`, `-mobile`) | Separate epics; this one only records the gap honestly |
| New tracker adapters (GitHub Issues, Linear, Shortcut) | Separate epic per adapter, following `wi-jira`/`wi-ado` |
| Automatic remediation of findings (adding tests, fixing debt) | Adopt reports and proposes; fixing is normal pipeline work |
| Repository migration (SVN→git, monorepo splits/merges) | A project in its own right, not an adoption concern |
| Runtime/production access of any kind | Barred by `rules/safety.md`; detection is static-evidence only |

---

## Delivery sequencing

- **Phase 1 — see the workspace (MVP, ships alone and is useful):** ADOPT-2, ADOPT-14, ADOPT-7,
  ADOPT-6. A read-only scan of every root + honest report. No writes, no config, nothing to roll back.
- **Phase 2 — run correctly against it:** ADOPT-3, ADOPT-4, ADOPT-5. This is where a brownfield
  project becomes genuinely runnable rather than merely scaffolded.
- **Phase 3 — know what it is:** ADOPT-9, ADOPT-10, ADOPT-8. *(Shipped 0.32.0. Note ADOPT-8 turned out to
  be the load-bearing one for the other two: `packages[]` is where per-package gates, stacks and releases
  hang, and it is what the `saas` block resolves against in a monorepo.)*
- **Phase 4 — keep it true:** ADOPT-12, ADOPT-11, ADOPT-13. *(ADOPT-13's walkthrough now also owes a
  worked monorepo + SaaS example, and ADOPT-12's drift report has three more blocks to diff.)*

Phase 1 is independently valuable and low-risk; each later phase depends only on the profile contract
from ADOPT-2, so the phases can be re-ordered if a real adoption forces the issue.

## Open questions

1. ~~**Is `monorepo` a third `workspace.layout` value, or `mono` + `packages[]`?**~~ **Answered in 0.32.0:
   `mono` + `packages[]`**, with `packages[]` attachable to a `repos[]` entry. The deciding argument was
   not the avoided schema break but what the two keys *mean*: `repos[]` is a **git** boundary and
   `packages[]` is an **ownership** boundary inside one. A third layout value would have conflated them,
   and the hybrid workspace (a monorepo root beside single-app roots) would then have had no spelling at
   all. The cost paid is a second resolution tier (`aidlc:work-items` → *Item → package resolution*) and a
   fourth gate layer (`verify.packages`, for a monorepo adopted as mono, which has no `repos[]` entry to
   key packages under).
2. **Does `/aidlc:adopt` subsume `/aidlc:init` for brownfield**, or run after it? This spec assumes
   after (init owns the permission/scaffold posture; adopt owns the derived facts), with init
   offering adopt as a third path. *Still open, and still assumed-after — no live run has argued otherwise.*
3. ~~**Should the SaaS profile (ADOPT-9) gate anything by default**, or only inform agent briefs?~~
   **Answered in 0.32.0: inform by default; gate in exactly two places, both conditional on an evidenced
   fact.** The block feeds the implementer/reviewer/security/architect briefs and nothing else. The two
   exceptions are a **destructive migration** where `liveDataConstraint` is `expand-contract` (a review
   blocker) and a **diff touching an `apiContracts` / `authPaths` / `tenantIsolationPaths` entry** (review
   runs regardless of cadence). Both earn the exception on the same grounds: the failure is silent, the
   gate cannot catch it (a destructive migration passes against an empty test database), and the cost of a
   miss is a customer-visible incident rather than a defect. Everything else — compliance regimes
   especially — *recommends* and lets the user decide, because a scan silently making every item more
   expensive is how a team stops trusting the tool. An absent field asserts nothing.
4. **Is a retroactive ADR with a blank rationale actually useful to the team that lived through the
   decision?** *Open, and only a live run can answer it.* The pessimistic case is that it reads as a
   restatement of the team's own code with the one interesting line missing. The optimistic case is that
   the blank is the artifact's value — it makes the undocumented reasoning visible as a gap while the
   people who remember it are still around. If the pessimistic reading wins in practice, the fix is
   probably to propose fewer (cap 3, not 8) and only at `reversibilityCost: high`.
