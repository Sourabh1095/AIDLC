# Changelog

All notable changes to the Bee-Logical Claude AIDLC marketplace.

> **Rebrand note:** this project was formerly named **SDLC** (marketplace + `sdlc` plugin, `/sdlc:`
> commands, `.sdlc/` state, `sdlc.config.json`). It was renamed to **AIDLC** (AI Development Life Cycle)
> in **0.19.0** — see that entry. CHANGELOG entries below 0.19.0 describe releases made under the old
> SDLC name; the version numbers are unchanged, only the name differs.

## [0.48.0] — 2026-08-02

### The workspace journal — sessions now start knowing what happened (`aidlc` 0.48.0)

**Run files are excellent memory and the wrong shape for orientation.** Each records *one item* in
depth, they are committed to *feature branches*, and completed ones move to `archive/`. Three
properties that are all correct for an audit trail and all wrong for the question a new session
actually opens with. So the framework knew a great deal about the item you happened to be running and
nothing about the project: it could not see that a replan re-cut the schedule yesterday, that six
direct fixes landed on `main`, or that the last consult already concluded billing does **not** belong
in the API repo. The cost is not abstract — **settled questions get re-litigated**, because nothing
remembered they were settled.

`.aidlc/journal.md` at the control plane: one line per event, a **closed** kind vocabulary
(`run` · `blocked` · `direct` · `tracked` · `consult` · `decision` · `replan` · `board` · `adopt` ·
`upgrade` · `release`), tracked in git, rotated at 500 entries. Eight commands write it at the moment
they finish something, and it survives `/aidlc:remove` — it is the project's own record of what
happened, and none of that stops being true because the framework is leaving.

Three constraints stop it becoming a second source of truth: an entry is a **pointer** (depth stays in
the run file, the ADR or git history), it is written **on completion, never on intent**, and **on any
conflict the run file, the board and the ADR win**.

### SessionStart went from six lines to something worth reading

It used to inject active runs plus the top three *markdown* backlog items — so a Jira or ADO project,
which is most team projects, got run frontmatter and nothing else. It now leads with what needs a
human, in priority order and under a hard 14-line budget:

```
⛔ Blocked — needs you (1):
- PROJ-131 [blocked] branch=feature/PROJ-131-y
Active AIDLC runs (1):
- PROJ-124 [verify] repo=core-api branch=feature/PROJ-124-x
Execution plan: 4 waves, cut 2026-07-31 by priya@acme.com — /aidlc:status
Board (as of 2026-08-02T17:04Z): 12 todo · 3 in progress · next PROJ-125 (P1, story) avatar upload
Recently:
- 2026-08-02T17:04Z replan: 4 waves — client wants checkout before search
- 2026-08-02T17:04Z consult: billing in the API repo? → no (ADR-0007), confidence medium
```

**The `board` line is how a snapshot reaches a Jira or ADO session at all.** A SessionStart hook has no
tools and no network budget, so it cannot query a tracker; `/aidlc:status` records the snapshot after a
*successful* query and the hook reads that instead. It carries its own timestamp, so staleness is
visible rather than assumed — and it is deliberately not written when the tracker was unreachable,
because a snapshot that looks current and isn't is worse than none.

Every section is independently guarded, so one unreadable file cannot cost the others, and the whole
thing stays silent outside an AIDLC project.

### Deliberately not done: a `SessionEnd` hook

The obvious way to journal a session summary. Rejected: an unrecognised event name in `hooks.json`
risks the file being rejected wholesale, which is the F49 blast radius applied to the guard hooks —
and the commands know what happened semantically better than a hook does anyway.

46 tests, weighted toward the two properties that matter for something read at session start: it never
throws (garbage in the file, an unwritable path, a missing directory all degrade to empty rather than
breaking the session), and the tail stays cheap forever via rotation. One real bug found by them:
`tail(root, 0)` returned the **entire file**, because `slice(-0)` is `slice(0)`.

## [0.47.0] — 2026-08-02

### `/aidlc:upgrade` — catch a project up with the plugin (`aidlc` 0.47.0)

`/plugin marketplace update` updates the **plugin**. It does not touch the **project** — the config,
the permission rules and the rules files `/aidlc:init` wrote at scaffold time. Until now the only thing
that reconciled those was `/aidlc:adopt-apply` §2.1, which is a *brownfield* command: **a greenfield
project scaffolded at 0.20 and running on 0.46 had no upgrade path at all.**

**Why a command rather than a release note.** F49 is the entire argument. A note said *"remove
`Read(./.env)` and `Read(./.env.*)`"*; the two rules were commented out with `//`; `settings.json`
stopped parsing; Claude Code skipped the whole file including `enabledPlugins`; **every `/aidlc:*`
command vanished** while `/plugin` still listed the plugins as installed. That finding's own lesson was
*prefer pointing users at the programmatic merge over hand-editing*. This is that merge.

Two files, two treatments, for a reason that is not symmetry:

- **`aidlc.config.json` is written in place** (after approval, and re-parsed before it lands).
- **`settings.json` is staged, never written.** `protect-paths.mjs` blocks the pipeline from editing
  its own guardrails and that is correct — a pipeline that can rewrite its permissions has none. The
  plan goes to `.aidlc/staged-claude/settings.json` and a human applies it.

**The migration set is deliberately short, and that is the system working.** `configVersion` is still 1
because it is bumped only when a key changes meaning or is removed — additive keys never bump it. So
the config half is the pre-0.31 `pipeline.gates.{steps,repos}` → `.verify.…` relocation plus the
stamps, and nothing was invented to pad it out. The governing rule is **relocate, never rewrite**: gate
commands come out verbatim, and `pipeline.gates.ambiguousRequirements` stays exactly where it is, since
`run` §4 reads that path and moving it would silently disable the requirements gate.

The settings half is where the value is: the stale pre-0.28 env hard denies (which permanently override
`pipeline.envFileAccess`, making the switch inert), no-op `Write(<path>)` rules, and rule spellings that
match nothing — each removed **only** when removing it provably changes no enforcement, and otherwise
kept with a warning. Additions are unioned from the template and summarized rather than listed, because
118 lines all reading "shipped by the current template" bury the three removals that matter.

`/aidlc:adopt-apply` §2.1 now **calls the same module** instead of restating the rules. Two commands
that answer "what does this legacy config become" must not be able to drift into two answers.

**Details that only showed up by running it:**

- A **`newer` config** — written by a plugin ahead of the installed one — is a *conflict*, not a
  migration. Migrating downward would silently drop keys this version cannot see, so it stops.
- **The plan legitimately repeats until the human applies the staged settings**, because the pipeline
  cannot apply them. The first build re-reported the identical plan every run and read as broken; it now
  detects a staged file matching the plan and says so — and stops saying it once the file is applied.
- Additions **can restore rules a project deliberately removed**. Nothing can distinguish that from a
  rule that predates the project, so the report says so rather than pretending, and the staged file is
  the user's to edit.

74 tests across the two new modules, weighted toward what must **not** happen: gate commands survive
verbatim, the input object is never mutated, `ambiguousRequirements` never moves, an uncovered
`Write(<path>)` rule is kept rather than dropped, nothing outside `permissions` is touched, and running
twice is byte-identical.

## [0.46.0] — 2026-08-02

### `/aidlc:doctor` — diagnose the workspace before it wastes a run (`aidlc` 0.46.0)

**Five of the framework's eight most recent 🔴 findings were environment faults, not pipeline faults**,
and each presented as something else:

| Finding | What the user saw | What was wrong |
|---|---|---|
| F42 | `Unknown command: /aidlc:run`, **at rc=0** | the plugin was not enabled for that cwd |
| F43 | every git call "requires approval" | poly uses `git -C`, which no allow rule matched |
| F45 | rules verified present, nothing ran | the rules matched nothing — allow *and* deny |
| F49 | all `/aidlc:*` commands vanished | a `//` comment made `settings.json` unparseable |
| F6 | branches that didn't line up | control plane on `master`, config said `main` |

Every one is visible in a file before a run starts. The pattern worth naming is why they were expensive:
**an environment fault looks like a pipeline bug**, so it gets debugged in the wrong place — F49 cost a
session chasing an unrelated stale marketplace error before the real cause surfaced.

`/aidlc:doctor` is read-only and writes nothing. `skills/doctor/diagnose.mjs` does the deterministic
half — Node version, config parse and required keys, config provenance vs the installed plugin, whether
a verify gate is declared, the `envFileAccess` value, `shared` mode on the markdown adapter, every
settings file parsing as strict JSON, plugin enablement at project **and** user scope with the
marketplace known, permission-rule shapes, `git -C` coverage in poly, each declared repo resolving to a
real git repo, the control-plane `.gitignore` covering every product repo by path, every registered hook
script existing, and every run file parsing with a valid phase. The live half — tracker auth, `gh`/`az`
auth, MCP tool ids, required-check policy, git identity, gate-runner presence — is in `SKILL.md`, and
references `status` §1.5/§1.6 as their home rather than restating them.

**The rule lint is now shared, not copied.** `skills/doctor/lint-rules.mjs` holds the F44/F45/F48/F49
shapes, and both callers use it: the marketplace's CI lints the shipped templates, `/aidlc:doctor` lints
the user's real settings. A lint that means something different in CI than on a user's machine is not a
lint — and copy-pasted rule sets are how F48 happened (F44's fix applied to `deny` and not to `ask`).

Two bugs found by the doctor's own tests, both worth stating because neither would have surfaced in use:

- **`f.startsWith(homedir())` mislabels any project living under the user's home directory** — `~/dev/x`,
  which is most of them — as the user-scope settings file. A project-scope problem would have been
  reported against `~/.claude/settings.json`, pointing the remediation at the wrong file. Now compared by
  resolved path.
- The suite was reading the **developer's real `~/.claude/settings.json`**, so a check passed locally for
  reasons unrelated to the fixture. `--home` makes it hermetic. User-scope settings genuinely participate
  in the diagnosis (F42), so the fix is to control them, not to ignore them.

72 tests across the two new suites, every one asserting a check **fires** — a diagnostic that quietly
returns "all ok" is indistinguishable from a healthy workspace, which is the same silent-pass problem the
rest of this repo keeps fixing. `npm test` discovered both without being told about them.

## [0.45.3] — 2026-08-02

### Fix: the rest of the guard's blast-radius gaps (`aidlc` 0.45.2)

0.45.2 fixed how commands are *segmented*. This fixes what the checks then *look at* — four verified
gaps left open by that release, plus one bypass found while closing them.

**Credential reads named three tools while the env check named thirteen.** §5 matched
`cat|type|Get-Content`, one line below an `ENV_READERS` set already listing `head`, `tail`, `less`,
`xxd`, `od` and more. So `head ~/.ssh/id_rsa` and `base64 ~/.aws/credentials` walked through a check
that blocked `cat` on the same file. The check is now argv-based against a shared reader set, extended
with `strings`/`openssl`/`certutil` and with `cp`/`mv`/`scp`/`rsync` — the pipeline never needs to copy
a private key, and doing so is a read with extra steps. The path set grew from `.ssh/`/`id_rsa`/
`.aws/credentials` to include the other private-key types, `.kube/config`, `.netrc`, `.pgpass`,
`.gnupg/`, `.docker/config.json`, gcloud ADC and `.p12`/`.pfx`/`.jks` keystores.

`.pem` and `.key` are **deliberately excluded**: both are overwhelmingly public certificates and test
fixtures inside real repos, so blocking them would fire on the correct case constantly — and F46
already recorded what that costs (*"it fires on the correct case, which trains users to bypass a safety
hook"*). A guard that cries wolf is worse than the gap.

**Recursive delete only understood combined flags and absolute paths.** The check required `-rf`/`-fr`
as one token and tested `^/` or `^~`, so `rm -r -f /etc/passwd`, `rm --recursive --force …`, `rm -R -f …`
and every relative escape (`rm -rf ../../..`, `rm -rf ../sibling-repo`) went through. Flags are now read
from argv, and the target is resolved against cwd — which covers absolute and relative with one rule and
additionally catches `rm -rf .`, deleting the project root itself. PowerShell `Remove-Item -Recurse` gets
the same treatment.

**Exfiltration covered `.env` and nothing else**, so `cat ~/.ssh/id_rsa | curl -d @- …` was not
exfiltration as far as the check was concerned. It now spans the full secret set, and `--data-binary`/
`--data-raw`/`-T` join the upload flags.

### Nested shells bypassed every argv-based check

Found while fixing the above, and it is the more interesting half. `bash -c "rm -rf /etc"` is one
segment whose `argv[0]` is `bash`, so **every argv-based check read it as a benign call to bash** while
the raw-segment regex checks caught it incidentally. Probed:

| | before | after |
|---|---|---|
| `bash -c "git push --force"` | allowed | blocked |
| `sh -c "cat .env"` | allowed | blocked |
| `bash -c "npm install evil-pkg"` | ungated | gated |
| `env FOO=1 rm -rf /etc/passwd` | allowed | blocked |

`expandSegments` now expands a wrapper's `-c` payload into segments of its own (depth-limited, wrapper
segment retained so the regex checks still see what they always saw). One fix, and it closes the hole
for the delete check, the env backstop, the git push guard and dep-vet's supply-chain gate together —
which is the argument for fixing it in the shared parser rather than per-check.

**Known limitation, pinned by a test rather than left to be rediscovered:** the tokenizer does not model
backslash escaping, so `bash -c "bash -c \"…\""` hides its payload. Mixed-quote nesting — the realistic
spelling — is covered. Adding escape handling is not free: F46's Windows path work depends on the
current behaviour, and `D:\RTO Tool` must not become `D:RTO Tool`.

### On not narrowing a guard while widening it

Rewriting §5 and §6 from raw-segment regexes to argv parsing made them precise, and precision is a
*narrowing*: the old §6 regex incidentally caught `bash -c "rm -rf /etc/passwd"` because it matched
anywhere in the segment, and the argv version did not. That regression was caught by diffing the new
hook against the committed one across every case rather than by the suite, which is why the practice is
worth naming: **a security check being rewritten gets a before/after behavioural diff, not just a green
suite.** The §5 raw-segment form is retained alongside the argv one for the same reason. Final diff over
20 representative commands: 11 widened, 9 unchanged, **0 narrowed**.

Guard tests 94 → 151, dep-vet 49 → 55. Logged as F52/F53.

## [0.45.2] — 2026-08-02

### Fix: a newline disabled every Bash guard check (`aidlc` 0.45.1)

**`guard.mjs` and `dep-vet.mjs` segmented commands with `cmd.split(/[|;&]+/)`, which does not treat a
newline as a separator.** A multi-line command therefore collapsed into ONE segment, and segment
identity is read from `argv[0]` — so any command whose *first line* was `git …` was classified as a
git segment. Git segments deliberately skip every content check (git executes no SQL, cluster,
filesystem or credential operations), and `dep-vet` found no package manager and returned. Both failed
**open**, and silently:

| Command | Before | After |
|---|---|---|
| `git status`⏎`cat ~/.ssh/id_rsa` | allowed | blocked |
| `git log --oneline`⏎`psql -h prod.example.com` | allowed | blocked |
| `git status`⏎`cat .env` | allowed | blocked |
| `git diff`⏎`kubectl --context production delete pod` | allowed | blocked |
| `git status`⏎`rm -rf /etc/passwd` | allowed | blocked |
| `git status`⏎`npm install left-pad` | ungated | gated |

Multi-line Bash is ordinary — heredocs, multi-step sequences, and the very git flows this framework's
own skills instruct — so this sat on the normal path, not a contrived one. Only the exfil check
survived, because it evaluates the whole command string outside the segment loop.

**Fix: a quote-aware splitter, shared.** `hooks/scripts/lib/shell-parse.mjs` now owns `splitSegments`,
`tokenize`, `commandArgv` and `commandName`, and both hooks import them. Quote-awareness is what makes
the fix correct rather than merely wider: a newline *inside quotes* is not a separator, so
`git commit -m "line one⏎line two"` stays one command and its message body is never parsed as commands
to execute — the same parse-don't-regex rule F46 established. `tokenize`/`commandArgv` were previously
byte-identical copies in both hooks, which is exactly the drift `lib/` exists to prevent.

Not modelled, both failing loudly rather than silently: backslash escaping (`\;` splits early → a
false-positive block) and unquoted heredoc bodies.

**30 regression tests added** (guard 74 → 94, dep-vet 39 → 49), one per row above plus the
quoted-message false-positive cases.

### The repo now gates itself

**There was no CI.** 672 test assertions existed and nothing ran them — while `/aidlc:status` §1.6
warns users when *their* repo is `mode: remote` with no required-check policy. F45's lesson is the
reason this matters most for the hooks: a broken **allow** rule blocks a run loudly, a broken **deny**
rule is completely silent, so "verified by watching a run succeed" proves nothing about the half that
protects anyone.

`.github/workflows/ci.yml` runs on every push and PR, on **Linux and Windows** × Node 20/22 (the hooks
handle drive letters, UNC paths and CRLF; a Linux-only gate would let a Windows-only assumption ship):

- **`npm test`** — discovers and runs every `*.test.mjs` under `plugins/`. Discovery rather than a
  hardcoded list, because a test file that is written but never wired up is the same as no test file.
- **`check:manifests`** — marketplace ↔ plugin.json name/version/license agreement, and every
  `hooks.json` command target exists. *A renamed hook script leaves the hook registered and inert, with
  no error anywhere.*
- **`check:permissions`** — a static lint for the four permission-rule shapes that already shipped
  broken: `Write(<path>)` rules that match nothing (**F44**, then **F48** — the same mistake reapplied
  one cycle later, whose own write-up asked for this lint), `:*` composed with a mid-pattern `*` and
  trailing ` *` without an exact-match sibling (**F45**), `//` comments in strict JSON (**F49**), plus
  the stale pre-0.28 env denies that permanently override `pipeline.envFileAccess`. It is a lint of
  known-bad *shapes*, not a matcher — F45 established the documentation is wrong on both points, so
  only a live probe can prove a rule matches. What it guarantees is that a shape already known to match
  nothing never ships again.
- **`check:templates`** — every shipped JSON parses; the config templates agree with
  `aidlc.config.schema.json`'s enums, types and required keys; the run-file template's frontmatter and
  `aidlc:run-state`'s Format block declare the same fields.
- **`check:xrefs`** — every `aidlc:<skill>` pointer, dispatched agent name, `${CLAUDE_PLUGIN_ROOT}/…`
  path and relative doc link resolves (1,274 references). A stale pointer is the worst failure
  available: the model reads an instruction to load something absent and improvises, with no error.

Each check was **negative-tested against deliberately broken fixtures** before being called done —
F45's process criticism ("authored against documentation and shipped unexecuted") applied to the
tooling built in response to it.

### The `team` block was missing from the config schema

Found by `check:templates` on its first run. **`team.mode`, `me`, `pickScope` and `groomAutoApply` were
described nowhere in `aidlc.config.schema.json`** — despite `team.mode` appearing in the README's
config table, shipping in the project template, and being read by `next`, `sprint`, `groom`, `status`,
`ceremony` and `work-items`. Because `additionalProperties` is `true` by design (additive keys must not
bump `configVersion`), an undeclared block validates silently: `"mode": "share"` passed cleanly and
**every team behaviour turned off**, which is precisely the class of failure D12 exists to prevent —
and it would present as "the pipeline ignored my team settings", with nothing anywhere to say why.

The block is now declared with its enums, defaults and the reasoning behind each field, so an editor
completes it and a typo fails loudly. `check:templates` proves the enum bites (`"share"` → error).

Worth stating as a general rule, since `additionalProperties: true` is deliberate and stays: **a key
the schema does not describe is a key with no completion, no validation and no documentation.** The
new check warns on every undeclared top-level key for exactly that reason.

### Also

- **Plugin manifests said `"license": "UNLICENSED"`** while `LICENSE` and the README say MIT. The
  manifest is what install tooling reads. Corrected in all three; `check:manifests` now derives the
  expected id from `LICENSE` itself so there is one source. No version bump for `aidlc-stack-web` or
  `aidlc-ux` — a metadata correction is not a reason to tell users to update.
- **`CONTRIBUTING.md`** documents `npm test` / `npm run check` / `npm run verify`.

## [0.45.1] — 2026-08-02

### Docs: the same audit, on what we tell people

Docs-only — no plugin behaviour changes, so plugin versions are unchanged.

**The README is now written for someone who has never seen this.** It had drifted into
release-notes-by-version prose: six paragraphs each opening *"(`aidlc` v0.3x.0)"*, which reads as a
changelog and answers none of a newcomer's questions. It now leads with what the thing is, an
explicit **"is this for you?"** (including when it is *not* — you want an agent that merges its own
work, or a hosted service), a **use-case table** mapping a goal to the command that serves it, and a
per-plugin install table saying which to skip and why. Release history lives in this file, which is
the one place it is maintained.

**It was also incomplete: 5 of the 25 commands were missing** — `/aidlc:dogfood`,
`/aidlc:scaffold-skill`, `/aidlc:scaffold-agent`, and both `aidlc-ux` commands. `/aidlc-ux:design` is
an entire plugin's front door and appeared nowhere in the command reference.

**Stale facts, fixed:**

- **`adoption-guide.md` documented a `github` MCP server that does not exist** — it was deleted in
  `72b98a7` ("drop unused github MCP server that errored without a token"), but the guide still told
  every new developer to set `GITHUB_PERSONAL_ACCESS_TOKEN` for it. GitHub goes through the `gh` CLI;
  the table now says so, and lists which plugin ships each server (Playwright moved to `aidlc-ux` in
  0.43.0 and was still filed under core).
- **`architecture.md`** carried `core v0.42.x` in its status line and three "Phase N ✅ (v0.x.0)"
  sections — release history in a rationale document, already stale (*"8 stack skills"* when there are
  10). The phase sections collapse into the three structural choices actually worth stating; history
  points here. Its agent table listed 9 and now lists all 16, with the design pod's 7 no longer
  re-described in prose further down.
- **The adapter contract was called "7-op" in one place and "8-operation" in two others.** It is eight.
- **`permissions-rationale.md` contradicted itself** on env migration: *"`/aidlc:init`'s settings merge
  does this"* immediately followed by *"The agent cannot: `settings.json` is protected"*. Both halves
  were half-true before 0.44.0 made the staging path explicit; now it states plainly that you apply
  that edit and why a hook cannot make an exception for the setup command. Two "Phase 4 will…" future
  tenses about shipped work were also removed.
- **The Node-shaped allow-list is now called out as something a non-Node project must extend.** Core
  went stack-agnostic in 0.43.0, but the shipped `settings.json` still allows only npm/node — so a
  Python project's own `pytest` gate prompts on every run, which is exactly the pattern that trains
  people to click through prompts.

**Duplication.** `adoption-guide.md` had grown a *Daily workflow* and a *Working several items at
once* section — both `user-guide.md`'s job, and the adoption guide's own header already said so. The
adoption guide now stops at setup and points onward. The sprint-isolation content that was only in the
adoption guide (mono worktrees vs poly control-plane launch, one-item-per-repo, why to keep N small on
a team) moved into `user-guide.md` rather than being dropped.

*Checked and clean:* every `/aidlc:*` and `/aidlc-ux:*` command referenced anywhere in the docs
resolves to a real skill; every inter-doc link resolves; all 45 `F<n>` finding citations in the
plugins are findable in the findings docs; no verbatim paragraph is duplicated across docs.

*Known inconsistency, left for a decision:* `LICENSE` is MIT while all three `plugin.json` manifests
declare `"license": "UNLICENSED"`. The README now matches the LICENSE file, since that is what a
public repo's readers rely on, but the manifests are a legal statement and were not changed silently.

## [0.45.0] — 2026-08-02

### `format.mjs` moves to the web pack — and starts working in poly

Prettier is a JavaScript tool, so the hook that runs it now ships with **`aidlc-stack-web`**
(`hooks/hooks.json` + `hooks/scripts/format.mjs`) rather than core. It was the last thing in core
assuming a JavaScript toolchain. A workspace with only `aidlc` installed now has **no formatting
hook**, which is the correct posture: whatever formatter the project actually declares still runs as
part of its resolved gate (`pipeline.gates.verify`), and core stops implying every repo is a Node repo.

**Moving it surfaced that it had been silently inert in every poly workspace.** The hook looked for a
Prettier config in the **session cwd** — which in poly is the control plane, while the config lives in
the product repo. It found nothing, exited 0, and formatted precisely never. This is the same
cwd-anchoring mistake F50 fixed in `env-guard`, in a hook nobody had re-checked: the fix landed once
and was not carried across. Config resolution now walks **up from the edited file's directory**, so
mono, poly and monorepo-package layouts all resolve, and the nearest config wins over a root one.
Prettier is invoked from the directory that owns the config, so its ignore files and relative settings
mean what the repo intends. The config-name list also picked up the forms it was missing
(`.prettierrc.cjs/.mjs/.json5/.toml`, `prettier.config.cjs`).

The hook had **no tests**; it has 7 now, covering poly, mono, monorepo precedence, the `package.json`
`prettier` key, a `package.json` without it, a malformed one, and no-Prettier-anywhere. They assert
the resolver's decision rather than shelling out to a real Prettier install, and they import the
resolver out of the shipped file so the test cannot drift from the implementation.

## [0.44.0] — 2026-08-02

### The same audit, on the hooks and templates

0.43.0 swept the skills and agents for rules stated twice. This is the other half: the hook scripts,
the project template, and the artifact templates. Two of the findings are gates that were not gating.

**`dep-vet` could be walked straight past.** The hook regex was anchored on
`(npm|pnpm|yarn|bun)\s+(install|add|i)`, so **any global option before the subcommand defeated it**:
`npm --prefix ./api install lodash` and `npm --loglevel=silly i evil-pkg` both installed with no
prompt at all. This is the exact shape `guard.mjs` fixed in F46 and wrote down as the reason it
tokenizes rather than regex-matches — the lesson had been learned in one hook and not carried to its
neighbour. `dep-vet` now tokenizes into argv and steps over global options (and their separate values)
to reach the subcommand.

While there: it gated **only the JavaScript ecosystem**, so a Python, Rust, Go, Ruby, PHP or .NET repo
got no dependency gate whatsoever — and its prompt still recited `peerDependencies`, `engines` and
`npm audit` after 0.43.0 made `aidlc:security` ecosystem-neutral. It now covers pip/pip3/uv/poetry/
pipenv, cargo, go, gem, composer and `dotnet add package`, distinguishes an **add** from a
**lockfile/manifest install** per ecosystem (`pip install -r requirements.txt` and `poetry install`
are correctly silent), and its three tests are worded the way the skill words them. The suite went
17 → 39 cases, covering both bypasses and every new ecosystem.

**`/aidlc:init` and `/aidlc:remove` documented a flow their own guardrail forbids.**
`protect-paths.mjs` hard-blocks Edit/Write on an *existing* `.claude/settings.json`, and the project
template's `deny` list carries `Edit(.claude/settings.json)` on top of it. Yet init documented merging
into an existing settings file and remove documented reverting one, claiming *"Claude Code guards this
file at the harness level, so the write will prompt regardless"* — it does not prompt, it blocks, from
two independent mechanisms. The guardrail is right (a hook cannot distinguish "the removal command"
from "an agent rewriting its own permissions"), so both skills now **stage** the new content to
`.aidlc/staged-claude/settings.json` and have the user apply it — the same staging path init already
used for headless sessions. `remove`'s §5 verification says so explicitly rather than letting the
file's absence from `git status` read as "already reverted", and `protect-paths.mjs` carries a note so
nobody special-cases the hook later.

**The run-file template had drifted from the skill that specifies it.** `aidlc:run-state`'s format
block documented 11 frontmatter fields; the template ships 19. The 8 undocumented ones — `repo`,
`package`, `contractAffecting`, `ui`, `uxScope`, `uxMode`, `designSource`, `systemSource` — are read
by `/aidlc:status`, `/aidlc:run`, the design pod and both run-file hooks, so they were fields
something read and nothing documented. Now documented with what each means, plus a line naming the
template as the source of truth for the field set.

**Hook code deduped.** `frontmatter()` and `runDirs()` existed verbatim in both `session-context.mjs`
and `checkpoint.mjs`; the env-access resolver and its `.env` matcher existed twice more, in
`guard.mjs` and `env-guard.mjs`, with the F50 walk-up fix copy-pasted into both. Extracted to
`hooks/scripts/lib/run-files.mjs` and `lib/env-access.mjs`. The two enforcement points for env access
are still two — they sit on different tool events — but there is now one definition of what the switch
means. The behavioural difference between the run-file readers is preserved and now stated:
`session-context` surfaces blocked runs (opening a session on one is when you want to know),
`checkpoint` does not (nagging at every Stop is noise).

**Also:** the tooling README pointed at `ci-cd` for a gate that moved to `aidlc-stack-web:ci-web` in
0.43.0, and `.mcp.json.example` explained that Figma ships with `aidlc-ux` without mentioning that
Playwright now does too.

## [0.43.0] — 2026-08-02

### One home per rule — an audit of what the three plugins were saying twice

Nothing here changes what the pipeline does. It changes **where each rule lives**, because the same
sentence written in four files is four things to keep in sync and, in two cases below, they had already
drifted apart. The audit swept every skill, agent, hook and manifest in the three plugins.

**Three things were outright wrong, not merely duplicated.**

- **The UX agents never had a finish contract, and `run` asserted they did.** All nine core agents
  carried an identical *"never return on a pending background task"* block; none of the seven `aidlc-ux`
  agents did — yet `aidlc:run`'s orchestrator invariants read *"every agent's finish contract forbids…"*
  and its F37/F40 recovery is built on that promise. The pod is exactly where it matters: the motion
  agent runs the project's lint/build and the design pod starts dev servers. The rule is now a skill —
  **`aidlc:agent-contract`** — carrying the contract, its three role variants (CI waits, fan-out,
  read-only), the report-back shape and the tool-restriction policy. All sixteen agents reference it and
  keep a four-line binding version inline, so it still binds if the skill never loads.
- **Four "read-only" agents were told to append to the run file with no tool that can write.**
  `aidlc-reviewer`, `aidlc-security` and `aidlc-architect` allowlisted `Read/Grep/Glob/Bash` and were then
  instructed to append `## Findings`, write `## Plan`, and author an ADR file. The only way through that
  is a `cat >>` through Bash, which is strictly worse than granting the tool. They now get `Edit` (and
  `Write` where the role creates a file) with the boundary stated in *Hard rules* where it belongs.
- **`/aidlc:status` declared itself read-only and then wrote.** Line one said *"never mutate state
  here"*; *Post-merge cleanup* transitions items, rolls parents up and archives run files. The claim is
  now scoped to the reporting steps, with the two approval-gated write sections named.

**Core was carrying web-stack knowledge.** `aidlc:ci-cd` lived in core and assumed npm throughout —
`npm ci`, `npm audit`, `package-lock.json`, `dependency-cruiser@^17`, `node:22`, eslint and prettier by
name — while core's own gate resolver warns *"do not assume npm scripts exist"*. Split:
**`aidlc-stack-web:ci-web`** (new) takes the shipped workflow templates, the typecheck/lint/format/
boundaries gate and its non-empty-graph assertion, cross-repo package resolution under isolated
single-repo checkout (F28), cross-platform lockfiles (F29) and the local CI-parity recipe (F38); core's
`ci-cd` keeps what is true of any pipeline — host resolution, pinning, caching, secrets, artifacts, the
red-check diagnosis protocol, and the Azure org-level traps (F25). `security` → *Dependency policy*,
`maintenance` and `debugging` are ecosystem-neutral for the same reason: the three dependency tests
(safe · latest-stable · compatible) are unchanged, the commands are now named per ecosystem.

**The `docker` skill had one inbound reference in the whole marketplace** — the devops agent — while its
subject matter, reproducing a red run in the CI image, had been copied inline into both `ci-cd` and
`debugging`. It is now referenced from `ci-web`, the architect and implementer stack lists, and carries
the CI-image debugging section itself; the two copies became pointers.

**Playwright moved to the plugin that uses it.** The MCP was declared in `aidlc-core/.mcp.json` and
driven exclusively by the UX jury and fidelity checker, so a backend-only workspace installed a browser
automation server for nothing and `aidlc-ux` alone couldn't render at all. It now ships in
`aidlc-ux/.mcp.json` beside Figma.

**Deduped, with the canonical home named in each case** — a rule that says where it lives is what keeps
the copies from coming back:

- the **render protocol** (derive the port from the repo's `dev` script, fail loud on a non-UI
  response) was stated five times across the jury skill, the jury agent, the fidelity agent, the design
  pod and `run`; it is now one shared section in `aidlc-ux:design-jury`, explicitly not jury-only;
- **run-file archival** (F23/F36/F39) was stated four times → `aidlc:run-state` → *Archive*;
- the **`dependency-cruiser@^17` floor** was stated in four skills → `aidlc-stack-web:project-structure`
  → *Repo-scaffold checklist* item 2;
- the **Figma read order, call budget and page-scope contract** was stated three times → 
  `aidlc-ux:figma-handoff`;
- **`aidlc-ux-writer`, `aidlc-ux-researcher`, `aidlc-design-system` and `aidlc-fidelity`** were each
  restating their own discipline skill nearly line for line; they now carry brief, modes, boundaries and
  verdict, and the discipline stays in the skill. `design-system` gained the *sourced from Figma*
  section the agent had been holding privately.

**Cross-plugin staleness.** `/aidlc:promote` routed only to core or the web stack pack (UX had no
destination), `/aidlc:sync` inventoried "core + stack packs", `scaffold-agent` said *"check the 9 core
agents"* and claimed `aidlc-` marks core agents, and `/aidlc:remove` never classified `design/` — so a
removal either stranded the narrative, design system, jury reports and Figma extractions or tripped its
own verification on them. All four now enumerate what is installed rather than working from a
remembered set, and `design/` is tier B (**keep** — it is the record of what the client approved).

**Also:** `/aidlc:do` is now the only skill calling itself the front door (`intake` is the tracking door,
`bootstrap` the bulk door), and `aidlc-researcher` / `aidlc-ux-researcher` each say in their description
what the other one is for.

## [0.42.0] — 2026-08-02

### Team mode — the pipeline stops assuming there is one of you

Every isolation mechanism in AIDLC was **filesystem-scoped**: worktrees, one-item-per-tree, disjoint-path
fan-out, the run file recording what is in flight. Each answers *"can these two units share my disk?"*
and each is silent about the question a team asks — *"is somebody else already doing this?"* There was
exactly one cross-machine primitive and it was accidental: `/aidlc:next` queries `status: todo`, `run` §3
writes `in_progress`, so a started item leaves everyone's query. That coarse lock is why the framework
did not fall over with a team. This release covers what it does not.

**`team.mode`** (`solo` default · `shared`) gates all of it. A solo project is unchanged — not
"compatible", identical.

- **`/aidlc:next` and `/aidlc:sprint` read the assignee.** A board gives an item one owner and both
  trackers enforce it, so "two people assigned one task" was never the bug. The bug was that **no command
  consulted the field**: `query`'s filter had no `assignee`, so three developers running `/aidlc:next`
  all got the same correctly-assigned item and the first to reach `run` §3 won while the other two had
  branched. Now `query({assignee})` exists — `currentUser()` in JQL, `@Me` in WIQL, both server-side —
  and `team.pickScope` (`mine-then-unassigned` default) decides the queue. **There is deliberately no
  `assign` op:** who does the work is a staffing decision set by a person, the same class as `priority`
  and `dependsOn`, and D4's argument for keeping those out of the contract applies unchanged.
- **`/aidlc:review-feedback <ID>` — the phase that was missing.** `run` §10 stamped the run `done` and
  `run-state`'s resume answered a `done` run with *"nothing to do"*, so the most frequent event on a
  team — a reviewer leaving comments — dead-ended in the place the pipeline called complete. The new
  command pulls unresolved threads (GitHub `reviewThreads` via GraphQL, since `--json comments` misses
  every inline comment; ADO's threads API minus its system entries), records them as **attributed**
  findings, and runs the ordinary fix cycle. Two rules separate a person's comment from an agent's: a
  **disputed** one is answered on the thread rather than argued down in the run file, and **no thread is
  resolved that was not fixed**. It never merges — closing its own review loop would remove the one gate
  D6 promises to keep. Resume and `/aidlc:status` both route to it.
- **Verify checks base drift first.** Branching pinned `<base>` and never looked again, so a
  long-running branch ran lint, typecheck, the full suite and the reviewer's read against a tree that no
  longer existed. The failures that produces are *semantic* conflicts — git merges them without
  complaint. The check decides on **path overlap, not commit count** (*isolation, not similarity*, one
  grain further out than D7): base moved somewhere this branch never opened → note it; base moved into
  files this branch edits → merge it in and **re-run the gate**, because a result from before the merge
  describes a tree that is gone. The PR body now says what the gate was green against.
- **Grooming proposes instead of overwriting.** AC refinement and sizing were applied inline, which is
  right when you are the product owner and an overwrite of somebody's words when you are not — with both
  concurrent writes read-back-verifying cleanly. `team.groomAutoApply` derives from the mode (`["ac",
  "size"]` solo, `[]` shared). Plus `--mine`/`--unassigned` scopes and a **concurrent-groom guard** that
  skips items a colleague groomed in the last few hours, read from the comment the adapter already writes.
- **`.aidlc/plan.md` is shared state and is now shared.** `next` and `sprint` obey it, and nothing pulled
  or pushed it — so every developer silently followed a different schedule, undetectably, because the
  freshness check diffs the plan against the *board* and the board had not changed. `replan` commits and
  pushes it with a new **`cutBy:`**; readers report ahead/behind and **never auto-pull** (conflicting
  someone's backlog underneath them mid-command is worse than a stale read).
- **ADR numbers no longer collide.** `NNNN = next number` read the working tree, so two branches cut from
  one base both produced `0012`, both PRs passed review (neither diff shows the other), both merged, and
  `superseded-by-0012` became permanently ambiguous **with no error anywhere**. Numbers now come from the
  integration branch plus open PRs; `adopt-adr` reserves its whole batch once, up front.
- **`ceremony` was solo-shaped in two places.** Tier 1's safety argument — *a local commit is `git reset`
  away* — quietly assumes one tree, so the floor is `tracked` in shared mode unless explicitly set. And
  trigger 4 ("work an in-flight run already owns") could only read **local** run files, leaving it blind
  to the *more* likely collision; it now consults the board and open PRs before a direct change.
- **Honest about what is local.** A run file is committed to its feature branch, so a teammate's
  in-flight run is invisible by construction. Rather than invent a lock file, `next`, `sprint`, `status`
  and `ceremony` each state which evidence is local and which is the board's — a guard documented as
  local is usable; one that reads as global is a trap. `/aidlc:status` says its run table is this
  machine's, splits ready counts by owner, and shows the plan's `cutBy`.
- **`source: markdown` is a solo adapter**, warned once at `init`/`adopt` and never blocked: in shared
  mode the backlog *is* the git tree, so concurrent grooms conflict in the plan of record and `query`
  returns whatever branch the caller stands on.
- `/aidlc:init` asks *"just you, or a team?"* — plainly, because inferring it from contributors is wrong
  in both directions. `/aidlc:adopt` records a `conventions.activeAuthors` count as a **signal**, and
  `/aidlc:adopt-apply` puts it in front of the user rather than deciding.

New design decision **D12** in `docs/architecture.md`.

## [0.41.0] — 2026-08-02

### `aidlc-ux` — a design system is not mockups, and it needed its own axis

0.40.0 read Figma as one question: *are the screens drawn?* That misses the more common enterprise
handover, where a brand gives you a **design system** — a UI kit of variables and components — and no
mockups at all. Under a single axis that file had nowhere to go: too structured to be "inspiration",
not screens, so the pod would have invented a palette beside a palette the brand had already shipped.

So the sources split into two independent axes, resolved before the pipeline:

| | `designSource` — the screens | `systemSource` — the values |
|---|---|---|
| `figma` | build to them, gate on **fidelity** | tokens + components from a Figma UI kit |
| `generated` / `project` | the pod designs them, gate on the **jury** | the pod invents or audits the system |

All four combinations occur. The new one — **system given, screens not** — keeps everything that made
the pod useful: narrative, inspiration, motion, and **the jury still gates**, because taste is still
open. What changes is that the vocabulary is fixed. Every value resolves to a system token, every
component the system defines is used rather than re-invented, and off-system stops being a preference:
the jury scores it as a Consistency **defect**, naming the token that should have been used. That is
what a design system is for — the creative work becomes composition.

- **`aidlc-figma` gains library mode**, in two waves, because a sixty-component system pulled whole
  would eat a month's call budget and most of it would go unread. Wave 1 up front: `get_variable_defs`
  once (the entire token set) plus `get_metadata` over the canonical pages for the component
  **inventory** — names, node ids, variant axes. Wave 2 on demand: a component's full detail the first
  time a screen needs it, cached into `design/figma-system.md` and never fetched again. The inventory
  is recorded even for components not yet detailed, because a component that exists in the system and
  gets re-invented in code is the failure this whole role exists to prevent.
- **`aidlc-design-system` gains figma-library mode**: emit the **full** token layer from the variable
  table (a half-mapped system means the next screen invents the rest), write `design/design-system.md`
  from the extraction, wire up components that have code counterparts instead of rebuilding them, and
  list conflicts with existing tokens for a human rather than silently picking a winner.

**Pages are the unit of scope, and the list is a declared contract.** A real UI-kit file is not
uniformly canonical — there is a cover page, explorations, WIP, deprecated sets, an archive. Building
against a deprecated component is *worse* than ignoring the system: it looks compliant and isn't. So
linking asks which pages count, one human confirmation, stored in
`ux.figma.designSystem.pages`; anything outside it does not exist, and the pipeline never widens the
list on its own. Linking asks about the **exclusions** too — "is `Components v2` the live set or the
draft?" is the question that stops an app being built on a draft.

**One brand has one system, so it is declared once.** `designSystem` with `scope: "workspace"` lives in
the **top-level** `ux.figma` even in poly — the single deliberate exception to "in poly, every ux
setting is per repo". Each frontend emits tokens in its own idiom from the same extraction, and a
change to the system is therefore a workspace event: `/aidlc-ux:figma sync` names **every** stale
frontend, the tokens each changed variable maps to, and the call sites of every changed component —
not just the repo you happen to be standing in.

`/aidlc-ux:figma <url>` now resolves what a file *is* before extracting anything (file name, page
names, component sets vs page-sized artboards, published-library status), states its read, and takes
`--system` / `--screens` to settle it. A URL pointing at one component inside a UI kit means "here is
the system", not "build this component". Share tokens (`t=`) are stripped before anything is written
to config.

### `aidlc` — both sources on the run file

- `run` §2 records **`systemSource: figma|project`** beside `designSource`, resolving the design
  system repo-entry-first then top-level, and passes both to the pod. §6 spells out that a given
  system changes what the system *is*, not what the gate is.
- `init` asks frontend repos **two** questions instead of one — screens in Figma? a design system in
  Figma? — and writes a workspace-scoped system to the top-level block.
- Config: `ux.figma.designSystem` (`url`, `fileKey`, `pages`, `components`, `scope`), schema'd
  everywhere `ux` appears; the poly example now shows a workspace-wide system.

## [0.40.0] — 2026-08-02

### `aidlc-ux` — when the design already exists, stop designing

The pod could only do one thing: invent a design. Narrative, then inspiration research, then a system
built from scratch, then a jury scoring it out of 10 and iterating until it hit 9. That is the right
pipeline for a project with no designer. It is the wrong one — actively wrong — for the common case
where a client hands over a signed-off Figma file and asks for it to be built.

Run the old pipeline against an existing design and three things go wrong at once. The pod invents a
palette the designer already chose. The narrative phase manufactures justification for decisions that
were made weeks ago by someone else. And the jury, doing exactly its job, scores the client's approved
design and starts *improving* it — which is the one outcome nobody asked for.

So the pod now resolves a **design source** before it does anything, and forks:

| | `generated` | `figma` |
|---|---|---|
| Design from | narrative → inspiration → system | the Figma file |
| Tokens | invented | **extracted** from Figma variables |
| Gate | jury composite ≥ threshold | **zero blocking deviations** |
| Jury | mandatory | **offered** |

- **The plugin ships the Figma MCP** (`plugins/aidlc-ux/.mcp.json`, remote, OAuth via `/mcp` →
  `figma`). It's inert on projects that never link a file.
- **`/aidlc-ux:figma`** links a file, inventories its frames, and maps them to the app's **real
  routes** — read from the router, not guessed from frame names. `sync` re-extracts after the designer
  moves and reports **drift**: what changed in the design and which built routes now disagree.
  No-argument `status` says what's linked, authenticated and stale.
- **`aidlc-figma`** (new agent) extracts once — `get_metadata` → `get_design_context` →
  `get_screenshot` → `get_variable_defs` — into `design/figma-spec.md` plus reference shots. Once,
  because Figma reads are seat-rate-limited: a Starter plan or View/Collab seat gets a handful of tool
  calls *per month*. Everything downstream reads the spec, not the MCP.
- **`aidlc-design-system` gained a figma mode**: the file's variables *are* the tokens, mapped onto
  the project's layer. Conflicts with existing tokens are surfaced for a human, never silently
  resolved; gaps Figma leaves (focus rings, disabled/empty/loading, undrawn breakpoints) are derived,
  labelled `derived:`, and listed for the designer.
- **`aidlc-fidelity`** (new agent, opus) replaces the jury as the gate: renders at the design's own
  artboard width and classifies every difference `[BLOCKING]` / `[MINOR]` / `[ADAPTATION]`, each
  finding citing both screenshots and the node id. Pass is zero blocking — never a percentage, which
  would be false precision. Capped at `ux.figma.maxFidelityRounds` (default 2); leftovers become
  `[MAJOR][open]` findings for a human.

**The jury is offered, not imposed** (`ux.figma.jury`, default `suggest`). After fidelity passes, an
interactive run asks whether you also want it to look; a headless or `/aidlc:sprint` run skips it and
records that the offer stands. When it does run it is **advisory**: findings that mean *the build
missed the design* get routed and fixed; findings that mean *the design could be better* go to you and
your designer as suggestions and are never built. `advisory` always runs it, `off` never does, and
`gate` restores the full jury loop for teams who treat Figma as a starting point.

**Two failure modes are closed deliberately.** An unreachable or unauthenticated Figma MCP **blocks
the run** — falling back to inventing a design is the one failure that looks like success and ships
something the client never approved; the honest fallbacks are authenticating, or exported PNGs in
`design/figma/` with the limitation stated. And a fidelity defect is never closed by editing the spec
to match what was built. The single exception to "implement, don't improve" is contrast that fails
WCAG AA: corrected, and always reported to the designer.

### `aidlc` — the orchestrator knows which source it's routing to

- `run` §2 records **`designSource: figma|generated`** beside the existing `ui:` flag, from
  `ux.figma.enabled`, a `figma.com/design/…` URL on the item, or an existing spec — and passes it to
  the pod. Partial coverage is normal: a mapped route runs the Figma track, an unmapped one the
  generated track, under one design system.
- `run` §6 documents the fidelity gate and that jury findings don't gate a Figma-sourced PR.
- `init` asks frontend repos/packages one question — *designed in Figma, or should the pod design
  it?* — and seeds `ux.figma` per repo/package, because different frontends have different files.
- Config: `ux.figma` (`enabled`, `url`, `fileKey`, `screens`, `jury`, `maxFidelityRounds`,
  `assetDir`), schema'd at the top level and on `repos[]` / `packages[]`. Figma was dropped from
  `.mcp.json.example` — declaring it locally would only shadow the server the plugin now ships.

## [0.39.0] — 2026-08-02

### `aidlc` — the commits land on the tier the effort is counted in

The leaf is a Story by default, and every commit, branch and PR referenced it. The reason was always
about **git**: a branch and a PR are one per repo, and a Story is the smallest thing that is
independently reviewable and revertable. Somewhere that got read as a claim about **effort**, which it
never was. On most boards — and on ADO natively, where StoryPoints sit on the Story and RemainingWork
hours sit on the Task — the Story says *something* and the Tasks beneath it are the work. As the report
that opened this put it: *till user story, it just says something; the tasks beneath it are what is
required to be done.*

The pipeline had no view of that tier at all. Nothing read, created or transitioned a child Task in the
default `crossRepoSplit: story` mode — the parent rollup (F19) walked *up* and nothing walked down. So a
board could show a Story go New → Active → Done with every Task under it still New, no hours burning
down, and no commit that named a task.

**The duplication was the actual bug.** `aidlc:planning` has always required plan tasks to be
commit-sized and path-declaring; a board's Tasks are that same list, authored by a human, one tier up in
durability. AIDLC was modelling the breakdown twice and only ever writing to its own private markdown
copy — on a feature branch, where nobody's burndown could see it.

So the plan now **binds** to the board instead of shadowing it:

```
## Plan
- [x] Add the profile DTOs   ·  paths: src/dto/profile.ts        ·  wi: PROJ-145
- [ ] Wire the settings form ·  paths: src/screens/settings.tsx   ·  wi: PROJ-147
```

- **`run` §5 adopts.** Where the leaf has child Tasks they *are* the plan — seeded in the **board's own
  order**, then enriched with the `paths`/`foundation`/`dependsOn` a board cannot carry (which is what
  §6's fan-out resolver reads). A Task is never silently dropped or re-ordered; a step the Tasks don't
  cover is a plan-only line that says so. The 3–8 bound explicitly does not apply to an adopted list —
  but ~15+ Tasks on one leaf is reported as a sizing signal rather than truncated, because a plan that
  quietly covers 8 of 15 reports green over work nobody did.
- **`run` §6 mirrors.** A bound task's commit trailer names both IDs (`Refs: PROJ-123, PROJ-145`), and
  ticking its checkbox transitions the Task. The sync is driven off the **checkboxes**, not off agent
  reports, which is what makes it idempotent and resume-safe. The orchestrator owns the board write —
  the implementer never calls the adapter, for the same reason it never commits in a parallel window.
- **Four guards**, three mirroring the parent rollup: never reopen a terminal Task, never move one
  already ahead of you, never fight a tracker that rejects the transition (a `## Log` note, not a
  blocker), and **blocked stays on the leaf** — a Task flipped to blocked that no later phase reliably
  flips back is board litter.

**It never writes an estimate.** Not StoryPoints, not RemainingWork, not CompletedWork, not priority —
in any mode. Those are the same class of field as `priority` and `dependsOn`, which the adapter contract
has had no op for by design since it was written: they are a human's record of what they asked for and
what they think it costs. The pipeline moves Tasks through their **states** so the burndown is honest
about what is *done*; an invented estimate would make velocity a measurement of the pipeline's guesswork.
(ADO does not zero `RemainingWork` on close unless the process says to — that stays the team's rule.)

**And it does not shrink the PR.** Binding commits to Tasks does not make a Task the leaf: one Story is
still one branch and one PR, because "add the DTO" is not independently shippable. A branch per Task is
`workspace.crossRepoSplit: "task"`, which already existed and is a different trade.

**New adapter op — `children(id, filter?)`**, the contract's eighth. Direct children, one tier, in the
**board's** order, with **no** ready rule and **no** priority sort — the callers are asking *what is
under this item*, not *what can I run*, so a done or AC-less child still comes back. Implemented on all
three adapters: ADO reads the `Hierarchy-Forward` relations already on the item and orders by
`BacklogPriority` (**not** `Priority`, the P1–P4 field, which would silently reshuffle a hand-ordered
task list); Jira uses `parent = {id} ORDER BY rank ASC` with a documented fallback to the legacy
`"Epic Link"` field; markdown globs on `parent:`. This also closes a hole that predates the feature —
`run` §2's epic-consolidation check said "query the adapter" for children that are *already implemented*,
which `query` would have filtered out as not-ready.

**`pipeline.taskSync.mode` defaults to `adopt`, and needs no migration.** Where a leaf has no Tasks it
behaves exactly as before and **creates nothing**, so a board that does not use the Task tier is
unaffected by the default being on; the only new writes are state transitions on Tasks a human already
authored under the item being run. `author` additionally *proposes* one Task per plan step where a leaf
has none — creation is externally visible, so it takes the same propose-then-create gate as
`/aidlc:intake`, never a silent write. `off` restores 0.38.0 behaviour exactly.

On-by-default is the deliberate call, and it is the narrower one: this writes a *state* to a Task a
human already parented to the item being run, where the parent rollup (F19) has written to a
**different** item by default since it shipped. Off-by-default would have shipped the fix dormant on
exactly the boards that need it. What on-by-default owes in return is visibility, so `run` §10 now names
the count in its closing report — `PROJ-123 · 5 board Tasks closed` — rather than burying it in `## Log`.
A board write nobody asked for on this particular run should be *stated*, not merely quiet.

## [0.38.0] — 2026-07-31

### `aidlc` — `/aidlc:replan` takes a phasing directive, not just a ranking

0.37.0 shipped `/aidlc:replan` with an argument, and it worked for the driver it was designed around:
*"checkout before search"* becomes an `order` per item and the packer sorts by it. But the argument was
only ever a **re-ranking**, and the most common thing a client actually says is not one:

```
/aidlc:replan complete all BE first and then start with UI
```

That is a **grouping** — *all* of one set before *any* of another — and `order` cannot express it.
Ranking the backend 1–3 and the UI 4–5 was the obvious workaround, and it silently did not work:

```
POLY:  w1[BE-1|UI-1] -> w2[BE-2|UI-2] -> w3[BE-3]      <- UI starts in wave 1
MONO:  w1[BE-1|BE-2|BE-3] -> w2[UI-1|UI-2]             <- correct only by luck of greedy fill
```

The packer takes the highest-ranked *ready* items each wave, so a low rank only loses a slot to
something better — it never loses one to *nothing*. In poly it is worse than a coin flip: the
one-item-per-repo rule means the backend fills one slot and the free frontend slot has nothing to put in
it *but* a UI item, so the directive fails **every time**, in exactly the layout that most needs it. And
in mono it appeared to work, which is the worse failure — it holds until one backend item is blocked,
then the UI slides forward and nothing says so.

**Stages.** When the driver groups, the analyst now emits `stage: <int>` and `stageLabel: <str>` per
item, and `resolve-waves.mjs` gates on them: no later stage enters a wave while any schedulable item of
an earlier one remains. It is a **band, not a queue** — inside a stage the packing stays as wide as
`dependsOn`, one-per-repo and `maxWave` allow, so *"all BE first"* runs the backend wide and holds the
UI back rather than putting the backend in single file. That is the same *reset the order, keep the
parallelism* promise 0.37.0 opened with, one grain coarser.

It yields in exactly two places, and reports both rather than absorbing them:

- **It gates on schedulable work, not on held work.** One blocked ticket in stage 1 must not freeze the
  whole UI half of the board, so the next stage opens and the report says the grouping was not fully
  met.
- **`dependsOn` overrides it.** If everything left in a stage depends on later-stage work, the grouping
  contradicts the graph. A dependency is correctness; a phase is a preference. The stage relaxes, once,
  out loud.

**A stage is plan state and stays there.** The tempting shortcut — write `UI-1 dependsOn BE-1` to
simulate the barrier — is now explicitly forbidden: it puts a phasing preference into the tracker as
though it were a technical dependency, where it outlives the replan that wanted it and re-serializes the
board permanently. Stages live and die with `.aidlc/plan.md`, like everything else the overlay knows.
They are also **deliberately absent from the freshness fingerprint**: `order` and `stage` are the plan's
own judgment, not board state, so fingerprinting them would make every plan look stale against a board
that never moved.

**Stages are opt-in.** Absent a grouping in the driver, no item is staged, there is no barrier, and the
packing is byte-identical to 0.37.0 — pinned by a test. Inventing a phasing the user did not ask for
would serialize a backlog designed to run wide, under their own words. An item the analyst leaves
unstaged runs *after* every declared stage (too late costs wall-clock and is visible; too early breaks
the directive and is not) and is named in the report as a question.

**Bare `/aidlc:replan` now asks instead of guessing.** It used to silently re-derive the waves from the
board, which is indistinguishable from a replan that honoured a directive — the user gets a schedule
they never asked for and no signal that their intent went unread. It now asks how they want it
re-planned, with *"nothing changed — just re-derive from the board"* as one of the answers rather than
the default.

`resolve-waves.test.mjs`: 74 → 98 cases. The new ones pin the reproduction above in both layouts, the
two yields, the opt-in guarantee, and that the unstaged bucket serializes as a deliberate `null` rather
than an `Infinity` that `JSON.stringify` quietly turns into one on its way into the plan file.

### `aidlc:run` — a plan-position notice, so the barrier has no third door

`/aidlc:next` and `/aidlc:sprint` read `.aidlc/plan.md` and follow it. `/aidlc:run <ID>` never has, and
should not: a named ID is an explicit instruction, and a schedule does not get to override one — the
same reasoning that makes this skill `disable-model-invocation` in the first place.

But *silently* out of order and *deliberately* out of order are different things, and stages made the
difference matter. A user who types "all BE first, then UI", approves the plan, and then hand-starts a UI
item has stepped over the barrier they just asked for — and the only signal used to be a frontend
landing against a backend that does not exist yet. A barrier two of three entry points know about is a
barrier with a hole in it.

New `run` §1a: locate the ID in the plan, emit **at most one line**, continue.

```
PROJ-104 is plan wave 3 (stage `ui`); wave 1 has 2 open items (PROJ-102, PROJ-120). Running it anyway.
```

Silent when the item is in the current wave (a notice on every well-behaved run is noise), and silent on
a **resume** — a live run file means replan pinned the item to wave 0 and never re-planned it, so it is
in order by definition. It does not refuse, prompt, or write anything, and it deliberately skips the
`--freshness` sweep that `next`/`sprint` pay for: they are *obeying* the plan, this is only reporting a
position, so it quotes the plan's own date and lets the reader judge. Held and not-in-the-plan get their
own line. Callers that already named the wave (`next` §4, `sprint` §1.4) are not repeated.

## [0.37.0] — 2026-07-31

### `aidlc` — priorities change mid-project: `/aidlc:replan`

Every planning feature so far assumed the order was settled once. `/aidlc:bootstrap` capacity-plans
sprints **at project start**; `/aidlc:groom` refines items one at a time and is explicitly forbidden from
touching priority; `/aidlc:sprint` derives a concurrent set **at launch** and forgets it. Nothing owned
the question a client actually asks halfway through: *"we need checkout before search now."*

**Why grooming was the wrong home for it, despite being the obvious one.** Grooming operates on **one
item** — its AC, its size, its routing. A reprioritization operates on **the graph**. Putting it in groom
would also have meant rewriting groom's own rule that priorities are the product owner's call, and it
would have missed the harder half of the problem:

> **Re-ordering without re-packing silently costs the concurrency.** Move one item to the top and a
> contract-first pair (0.35.0) that used to build side by side ends up in two separate steps, for no
> reason anyone can state afterwards.

So order and parallelism are one operation. `/aidlc:replan` takes a priority signal — a prompt
(*"security items first for the audit"*), a revised requirements doc, or nothing at all to re-derive from
the board — and returns an ordered set of **waves**, each wave the items that can genuinely run at once.
`/aidlc:sprint` launches a wave; `/aidlc:next` picks from the current one.

**It writes nothing to the tracker, and that is the design (D11).** `priority`, `dependsOn` and
sprint/iteration are where a human product owner's intent lives — and, not coincidentally, the 7-op
adapter contract (D4) has an op for none of them: they are authoring-time fields. So a replan re-orders
**AIDLC's execution**, not the board. `.aidlc/plan.md` at the control plane is an **execution overlay**
that `next`/`sprint`/`status` follow; the board stays as the client left it, and the plan lists the
priority edits that *would* make the two agree, for a human to apply or ignore.

**In-flight work always finishes, and freezing is leaf-only.** A leaf with a live run file is pinned to
wave 0 exactly as it is — no pause, no reorder, no retarget, no killed process. Unwinding a change
half-applied across many files and (in poly) many repos costs far more than the wall-clock a stop would
save. The subtlety that makes this correct rather than merely cautious: `/aidlc:run` §3a rolls a **parent**
to `in_progress` the moment its *first* child starts (F19), so freezing everything marked `in_progress`
would freeze whole **epics** and make the board unplannable the instant any child moved. Containers —
epics, features, and `crossRepoSplit: task` umbrella stories with open children — are never frozen and
never scheduled; their children are the work.

**The packing is computed, not judged** — `skills/replan/resolve-waves.mjs`, 74 test cases. The *order*
is human judgment (an analyst reading the changed intent); which items may share a wave is decided by
three constraints that each fail **silently**: a violated `dependsOn` (the dependent runs against a
contract that isn't there, and the red build lands far from its cause), two poly items in one repo
(`/aidlc:sprint` branches and commits both in one working tree — a constraint that does **not** bind in
mono, where every item gets its own worktree), and the width cap. Same argument `resolve-fanout.mjs`
makes one grain finer: this is D7's coarsest level — fan-out packs one item's *tasks* into windows,
replan packs *items* into waves.

Four things it refuses to guess, each surfacing as a **held** item with its reason rather than a silent
omission: an **unrouted** item in poly (tree isolation unprovable), a **blocked** item, an **unknown or
self-referential** dependency, and a **cycle** (reported, never broken by dropping an edge).

**A stale plan falls back loudly rather than steering quietly.** The plan records the item fields the
packing depended on; `next`/`sprint`/`status` diff them against the live board before obeying it. Items
merely progressing is the plan *working*; new items or a changed board priority are **additive** (follow
the plan, say what's unscheduled — a board priority change is precisely the signal to re-plan); a planned
item that vanished, was re-typed, re-routed or re-wired is **breaking** — announce it, ignore the plan,
revert to priority order. Never silently obeyed, and never a blocker on getting work done.

**Wired into the commands that were already there:** `groom` gained a read-only **flow check** that ends
its sweep by asking whether the *order* is still right — grooming is the most likely cause of breaking
drift, since a split or a routing fix changes exactly the fields the packing reads — and hands off rather
than re-sequencing itself. `next` and `sprint` honor the plan behind the freshness gate (sprint still
runs the two checks the packer cannot make: the analyst's file/subsystem overlap read, and a
re-assertion of one-item-per-tree). `status` shows the plan, the current wave and its drift class. `do`
gained a **REPLAN** route, because *"build X"* is intake but *"build X **before** Y"* is not — routing the
second into BUILD mints a duplicate item for work already on the board.

New config: `pipeline.replan.maxWave` (default 3, hard cap 5, mirroring sprint's own cap — a wave wider
than sprint will launch is a plan that cannot be executed as written).

## [0.36.0] — 2026-07-31

### `aidlc` — ceremony is proportional to consequence (the adoption fix)

Every release up to here made the pipeline *better*. This one makes it **usable**, which turned out to be
a different problem.

**The gap, in the framework's own words.** `do/SKILL.md` said:

> *"Small changes are not an exception: one item → one branch → one PR still applies (per
> `rules/git-workflow.md`, "even one-liners"). If that feels heavy for a typo, that is a real finding
> about the pipeline — **raise it via `aidlc:dogfood`, don't route around it**."*

That instructed the user to **file a complaint instead of getting their typo fixed**. Nobody files the
complaint. They stop using the tool — and the real cost is not the typo: a pipeline that is unpleasant for
small work loses the audit trail on the **large** work too, because people route around it for everything
or uninstall it. The rigidity wasn't one line, either: `intake` said *"NEVER start implementing from a raw
requirement — items first, always"* and *"never code directly"*; `rules/git-workflow.md` said *"Even
one-liners"*; and `templates/project/CLAUDE.md` carried the heading **`## AIDLC workflow (mandatory)`** —
which lands in **always-loaded context**, so every session opened by telling the model the ceremony was
compulsory.

**The fix — four tiers, picked and announced, never argued** (new `aidlc:ceremony`, D10). It mirrors how
Claude Code itself works: answer → edit → commit → PR, with the user choosing where to stop.

| Tier | Produces | For |
|---|---|---|
| **answer** | nothing | questions, opinions, diagnoses |
| **direct** | a gated commit on the current branch | typos, renames, a log line, an obvious one-liner |
| **tracked** | branch + run file + commits, PR optional | real work nobody needs a ticket for |
| **full** | the pipeline, unchanged | stories, features, team-coordinated work |

- **`/aidlc:do` gained a DIRECT route** and does that work itself — edit, run the project's resolved gate,
  commit, report in four lines. It is now the only place in the framework where `do` writes product code,
  and deliberately so.
- **Committing on the default branch is allowed at tier 1**, because the risk being managed is
  *irreversibility*, not ceremony: a local commit is `git reset` away, and the branch-aware push guard
  still stands between it and anyone else. D6 is restated accordingly — the invariant that survives every
  tier is **"nothing reaches the default branch unattended"**, which is narrower and sharper than "one PR
  per change".
- **`pipeline.ceremony` sets the floor** — `direct` (default) · `tracked` · `full`. It only ever *raises*
  the tier. Absent config resolves to `direct`, so no project needs migrating; `full` reproduces
  pre-0.36.0 behaviour exactly for a team that wants it.
- **De-escalation is first-class, which is the actual behavioural change.** *"just do it"*, *"no ticket"*,
  *"no PR"* are **instructions, not objections to argue with**: drop to the tier named, confirm in one
  line, proceed. Explicitly prohibited — selling the user the tier they just declined, asking twice, and
  quietly re-adding the ceremony later in the same run.
- **Promotion keeps starting light safe.** *"track this"* creates the item and links the commits already
  made, so a tier-1 change that turns out to matter is never trapped at its tier.

**What deliberately did NOT scale down** — the two properties that make this lenient rather than sloppy:

1. **The project's gate runs at every tier**, `direct` included, resolved from the project's own commands
   (`resolve-gate.mjs`). Ceremony is what was cut; verification wasn't.
2. **Five escalation triggers override the floor *and* the user's stated preference**, because each names
   something **not recoverable by noticing it later**: auth/tenant-isolation paths, a destructive migration
   under `expand-contract`, a declared `apiContracts` path, code an in-flight run already owns, and an
   explicit pipeline request. None fire on an absent config field — the pipeline still never invents a
   constraint it has no evidence for. Choosing `direct` is not choosing to be careless; it is choosing not
   to file a ticket for a typo.

**Rewritten at the source, not patched over:** `do` (DIRECT route, tier announcement, the dogfood line
deleted), `intake` (both absolutist rules, now scoped to *this door* rather than to every change),
`rules/git-workflow.md` ("even one-liners" → tier-aware, push-focused), `git-workflow` (scoped to tracked
work up front, so the branch/PR machinery isn't applied to a typo), `run` (states it *is* tier 3 — an
explicit pipeline request is honored, never optimized down), and the project `CLAUDE.md` template (the
`(mandatory)` heading is gone; the always-loaded lines now lead with proportionality). `/aidlc:init` asks
about it at step 5b and is told **not** to present `full` as the "serious" option, because it isn't.

**Unchanged by design:** 0.35.0's fan-out is internal (it never asked the user for ceremony), and
contract-first only applies when a feature is already being decomposed — under the tier model it simply
does not fire below tier 3.

## [0.35.0] — 2026-07-31

### `aidlc` — concurrency inside a single feature: fan-out across files, and frontend beside backend

Until now AIDLC parallelized exactly one thing: independent backlog **items**, via `/aidlc:sprint`.
Inside a feature everything was serial — one implementer per item, and a frontend child chained behind
its backend sibling. Both were defensible, and both were serializing more than the underlying risk
required. This release adds concurrency at two finer grains, each with the safety property it actually
needs rather than the one it inherited.

**1 · The implement phase fans out across provably disjoint files** (`pipeline.implementFanout`).

Ask for *"pagination on every table"* and the plan is a shared component plus one task per screen. Those
screens never touch each other, and D7 was serializing them anyway. Reading D7 again shows why: it
serializes what *mutates a shared tree*, and **the shared thing is git, not the code**. Two agents
racing `git add`/`commit` in one checkout collide; two agents editing `users.tsx` and `orders.tsx` do
not. So the fix removes the racing committer, not the parallelism.

- **The agents edit and report; the orchestrator commits.** Each fan-out implementer gets one plan task
  and a **path allowlist**, must not touch anything outside it, and must not commit or stage. The
  orchestrator commits each task's declared paths in plan order. **One writer to git, always** — and
  still one item, one branch, one PR, so the review unit is unchanged.
- **The gate runs once, after the window lands** — not per agent. A window is a partial change by
  construction, so a mid-window gate failure says nothing, and running the full suite N times is the
  most expensive way to learn that.
- **`skills/run/resolve-fanout.mjs` computes the schedule** (55 test cases pin it), for the same reason
  `resolve-gate.mjs` exists: the failure mode is silent. Two agents handed overlapping paths do not
  error — they interleave edits and the loser's work vanishes mid-file, with the tests passing against
  whatever survived. It refuses to guess three things, each chosen against the asymmetry that
  over-serializing costs wall-clock and *says so*, while under-serializing loses code and says nothing:
  a task with **no declared paths** is never parallelized; **two globs** that can't be compared cheaply
  are assumed to overlap; and **disjoint paths do not imply independence** — a task whose output a later
  task imports must declare `foundation`/`dependsOn`, because no path analysis can see an import edge.
- **Aggregators stay single-writer** by default: manifests and lockfiles, barrel modules (`index.ts`,
  `__init__.py`, `mod.rs`), route tables, i18n catalogs, global styles, tool config, snapshots,
  migrations, and every path in `saas.apiContracts`. `implementFanout.sharedPaths` is where a project
  names **its own** aggregator (a central theme file, a generated registry) — the one setting a stranger
  to the codebase cannot infer.
- **Order is never rearranged.** The resolver only collapses *contiguous* plan tasks into a window, so a
  plan read top to bottom still describes what happens. The run file records the schedule
  (`fanout: 1 -> [2|3|4] -> 5`), and every serialized task carries a stated reason.
- Plans now declare `paths:` per task (`aidlc:planning`, `aidlc:run` §5). `planning` already asked for
  the files a task touches — *"a plan that never names a file is a guess"* — this makes that answer
  load-bearing instead of advisory.
- **Undeclared writes are a finding, not a shrug.** After a window, `git status` must be clean; anything
  left over is a path an agent touched without declaring, and it goes into `## Findings` as a fan-out
  contract violation — an undeclared write is precisely what the disjointness proof assumed away.
- Defaults: **enabled**, `maxAgents: 3` (hard cap 5, mirroring `sprint` — one item must not spawn a
  fleet), `minGroup: 2`. Absent config resolves to those, so **no existing project needs migrating**;
  `enabled: false` restores pre-0.35.0 behaviour exactly.

**2 · Frontend and backend are built at the same time, against a contract that lands first** (D9).

`intake`/`planning` authored `frontend dependsOn backend` reflexively. That edge is right about the
dependency and wrong about its price: it serializes a whole feature to protect one unknown — the
response shape. The tempting alternative, *start both and reconcile at the end*, is worse: two agents
that each wrote code against a shape they guessed don't "sync", one of them gets rewritten, and which
one is decided by whose work is cheaper to discard. **Coordination after the code is the expensive place
to put it.**

- **Decomposition emits three children, not two:** a small **contract child** (OpenAPI path, GraphQL SDL
  type, `.proto` message, JSON Schema, or an exported type in a declared shared package) as a normal
  single-repo leaf, then backend and frontend each `dependsOn` **the contract** and **not each other**.
  That is the edge that makes them concurrent — `sprint`'s independence check reads `dependsOn`, and in
  poly they were already in separate repos.
- **The frontend never idles on a running backend:** its AC are satisfiable against generated types and
  contract-derived fixtures. Without that, the serialization returns through the back door.
- **A ready wave runs as a wave.** `run` §2.5 no longer walks ready children one at a time: once a wave's
  dependencies are terminal, its children are independent *by construction* — that is what the graph
  asserts — so the wave goes to `/aidlc:sprint`. Walking it serially isn't safer, just slower.
- **The join, which is the cost this design pays.** Neither child's own green run proves the feature
  works — each was verified against the contract, never against the other. So the epic/feature
  consolidation pass (§2) now runs an **integration join**: the project's contract tests, or the e2e path
  exercising the real call, resolved from the repos' own gates (**no test framework is invented** for a
  project that has none). A project with neither gets a **`MAJOR` finding, not a pass** — with both sides
  built in parallel the contract is the only thing holding them together, and a team that can't test the
  seam should know that is what it chose. A red join is a feature-level blocker; the parent never closes
  over one.
- **The corollary saves the most time and is the easiest to miss:** where the interface **already exists
  and the feature doesn't change it**, there is **no contract child and no edge at all** — both sides
  start immediately. `sprint` is told explicitly not to re-derive a frontend-waits-for-backend edge from
  item titles or from the fact that one calls the other's API; the contract is the artifact that removed
  that edge, and re-adding it there silently undoes the decomposition.

**Also:** `docs/aidlc.config.schema.json` documents `implementFanout`; the run-file template and
`aidlc:run-state` carry `fanout:` and the per-task `paths:` shape; `aidlc:init` asks about fan-out (step
8); `aidlc-implementer` gains *Fan-out mode* with the allowlist/no-commit contract and a matching
carve-out in its Finish contract, which otherwise mandates the commit it must not make; D7 is narrowed
rather than repealed, and D9 is new. Total suite: **549 test cases**, all passing.

**Not included, deliberately:** `/aidlc:adopt` does not yet *derive* `sharedPaths` from a codebase scan.
It could — aggregators are visible to a scan — but that is its own feature, and the built-in list plus a
documented knob is safe without it. Adoption also needs no migration: absent config resolves to defaults.

## [0.34.5] — 2026-07-31

### `aidlc` — the pipeline can no longer start itself, and QA stops moving the diff under the reviewer

Two defects found by reading the orchestrator against its own D7, rather than by a run. Neither would
ever have failed loudly: one hands the framework a door it did not mean to open, the other produces
review findings that are merely *wrong*.

**1 · `/aidlc:run` was model-invocable.** Every other writing command — `init`, `adopt*`, `sprint`,
`sync`, `repo`, `promote`, `remove`, `bootstrap` — carries `disable-model-invocation: true`. The one
command that branches, commits, pushes and opens a PR did not, so the model could enter the full
pipeline on its own because a prompt *sounded* like work. The blast radius is the largest in the
framework and the trigger was a description match.

- **`run` now carries the flag**, and a new *Entry is deliberate* section names its three doors, all of
  them a human choosing the pipeline: a typed `/aidlc:run`, `sprint`'s headless
  `claude -p "/aidlc:run {ID}"` (a typed prompt in a fresh session, so the flag doesn't bind), or an
  explicit handoff from a sibling skill the user invoked.
- **The flag blocks the Skill tool, which would have broken those handoffs** — `aidlc:next` §5,
  `aidlc:do` §5 (BUILD *and* RESUME) and `aidlc:intake` §4 all continue into the pipeline in-session.
  All three now hand off by **reading `${CLAUDE_PLUGIN_ROOT}/skills/run/SKILL.md` and following it
  verbatim**. This is the better mechanism regardless of the flag: the instruction to enter the pipeline
  is *written down* instead of left to the model's discretion. Fixing the flag without this would have
  silently dead-ended `/aidlc:next`.
- `/aidlc:do` stays deliberately open — it grounds before it routes and creates nothing on its own,
  which is exactly what a front door should be, and it is now where a misinferred `run` gets redirected.

**2 · QA was batched in parallel with the reviewer, and QA commits.** §7 said *"dispatch the due agents
in ONE parallel batch"*; `docs/architecture.md` justified it with *"they only read the diff, so there's
nothing to collide on"*. That is true of the reviewer and security and **false of QA**, whose verify mode
authors tests and commits them (`aidlc-qa` → *Verify mode*, steps 2 and 4). So new commits moved `HEAD`
while the reviewer was mid-review: findings written against a diff that no longer existed, two agents
committing to one branch, and no failure — just a review of the wrong thing.

- **§7 now dispatches in two steps:** reviewer + security in one parallel batch, then **QA after it
  returns**. Fix cycles re-dispatch in the same order. One agent due → no batch; QA alone → run it alone,
  since the ordering exists to protect the reviewer.
- The reviewer's subject is restored to what it should be: **the diff the implementer produced**. QA's
  tests are not part of it.
- `aidlc-qa`'s own contract said *"parallel with the reviewer"* — corrected at the source, with the
  reason, so the agent knows the branch is its alone while it works.
- `docs/architecture.md` D7 carried the false premise and now states the rule it was already claiming to
  follow: **isolation, not similarity**. All three agents look alike (they are all "verification"), which
  is why batching them read as obvious — but only one mutates the tree, and that is the sole deciding
  property. D1 gained the entry-contract half of defect 1, plus the point that the main session is where
  the interactive gates (`ask` mode, security confirm, local-merge confirm, cross-repo split) can exist
  at all: as a subagent each would silently take a default.

Both fixes are prompt-and-contract changes, so the 8 script test suites (all passing) cover neither —
the guard is that each claim is now stated in the one place the actor reads.

## [0.34.4] — 2026-07-31

### `aidlc` — the orchestrator now knows the brownfield door exists

0.34.0–0.34.3 made brownfield adoption work and proved it. This makes the framework *reach for it*, and
corrects the docs those four releases made stale.

**The gap.** `/aidlc:do` — the general front door, which grounds before it routes — handled a missing
config with one line: *"tell the user to run `/aidlc:init`, stop."* No distinction between an empty folder
and an existing codebase. So a user who opened a workspace holding four repos and asked for a change was
pointed at the greenfield setup path, and the brownfield door existed without anything routing to it —
which is exactly the failure the epic was written to prevent: topology, stack, gate commands and git
conventions answered from memory about a codebase nothing has read, then written into `CLAUDE.md` as
ground truth. `/aidlc:next` had the same gap, and neither `sprint`, `status`, `intake`, `groom`,
`planning` nor `requirements` mentioned adoption at all.

- **`do` §1 now looks at the folder before it answers.** Existing code (a manifest, or a `.git` with
  history, here or one level down) ⇒ say *`/aidlc:init` choosing "there's existing code — scan it"*, which
  routes to `/aidlc:adopt` — and say that **one scan covers every repo in the workspace**, so nobody is
  told to adopt them one at a time. An empty folder ⇒ `init` then `bootstrap`. It also gained a grounding
  step for a config that **came from a scan**: `architecture.resolvedBy: "codebase-scan"` means `repos[]`,
  `packages[]`, `pipeline.gates.verify` and `saas` are evidenced and should be trusted over a fresh read
  of the tree — and a staleness note that compares `adoption.commit` to HEAD **excluding
  `.aidlc/adoption/`**, since committing the profile is itself what moves HEAD.
- **`next` gained a step 0** with the same discriminator: picking "the next item" from a project that was
  never set up is not a useful answer.

**Docs corrected, including two lines these releases made wrong.**

- `docs/user-guide.md` said *"a gate you don't have is recorded `absent` and reported per run as a coverage
  hole"* — true but now incomplete, since `not-applicable` exists and is deliberately **never** a finding.
- It also described `/aidlc:remove` verifying with `git diff` that your files are untouched, which is the
  behaviour 0.34.2 replaced: the check is now `git status` ⊆ the approved plan, plus a per-file comparison
  against `git show <adoption.commit>:<file>` where any remainder is **your own edits**, shown to confirm.
- The `saas` row now notes that a security-review path you delete on purpose stays deleted.

**Docs extended**, so the mechanics stop living only in the design spec:

- `docs/adoption-guide.md` gains a table of what adoption does with **each kind of root** it finds
  (product repo · monorepo → `packages[]` · control plane, excluded from routing by name · non-repo ·
  not-cloned · outside the control plane → absolute path), a note that discovery reads the JSONC
  `.code-workspace` **and** scans for nested repos because using one alone collapses a six-root workspace
  into one, the `--add-dir` reachability point, and a new *Reading the profile and the config it produces*
  section covering the five values that mean something narrower than they look: the three gate statuses,
  the four support values, `adoption.writes[]`, `adoption.seeded` and `repos[].adoptedFromRoot`.
- Its **Polyrepo** section now tells a brownfield reader not to hand-fill `repos[]` at all — adopt derives
  every field with evidence, including the ones easiest to get wrong from memory.
- `README.md` states the claim directly (brownfield and multi-repo are the same door; the unit is the
  workspace) with an honest **verification status**: every command run end to end against a purpose-built
  multi-root fixture, 14 defects found and fixed, 373 guarding test cases — and no adoption of a real
  third-party repository yet.
- `docs/brownfield-walkthrough.md` shows all three gate statuses where a reader first meets them, since a
  Django service really does have `build: not-applicable`.

## [0.34.3] — 2026-07-31

### `aidlc` — brownfield: the last two adoption commands, and two more defects

0.34.0–0.34.2 ran the scan, the apply, and the drift/upgrade/removal legs against a live fixture. This
closes the set: **`/aidlc:adopt-adr`** and **`/aidlc:adopt-backlog`**. Two more defects, both about routing
and naming rather than about the artifacts themselves — and both invisible. **Every command in the adoption
set has now been run end to end.** Spec: `docs/brownfield-adoption.md`.

**`/aidlc:adopt-adr` came through clean — the only command in the set that did.** Numbering continued from
the fixture's existing `0007` without restarting; all five ADRs carry `accepted (retroactive)`; `## Rationale`
and `## Alternatives considered` are the verbatim *"not recorded — confirm with the team."* in every one,
checked mechanically; the two already-recorded candidates were listed rather than dropped; the external RFC
and Confluence page were linked from the index and never copied; and one candidate was skipped with a
stated reason, after which a re-run proposed only that one.

**`/aidlc:adopt-backlog`'s board sweep produced the most useful output of any adoption command so far**, and
it was not a finding: **`PLAT-40` is closed** with every criterion ticked including *"no credential literal
remains in any script"* — and the credential is still there, still in history. The new item references
PLAT-40 so a reviewer sees the history rather than re-litigating it. Meanwhile **`PLAT-14` is open** for a
typecheck gate that has since shipped, so it was not proposed and closing it was recommended. Neither is
derivable from the code.

- **All three staleness checks compared raw commit hashes**, so `adopt-apply`, `adopt-adr` and
  `adopt-backlog` each announced *"the code has moved since these facts were true"* on every
  correctly-followed adoption — because the one commit between `scan.commit` and HEAD was the commit that
  **recorded the profile**, which §10 requires be tracked. Nothing outside `.aidlc/adoption/` had moved. It
  never errors and each warning is individually plausible; the damage is cumulative, because a check that
  cries wolf on the happy path teaches the user to dismiss the one that matters. This is the same
  self-referential trap 0.34.0 fixed in the convergence rule, in a second mechanism the fix did not reach.
  All three now use the `onlyAdoptionArtifactsMoved()` predicate that already existed.
- **Profile root names and config repo names are different namespaces, so adoption-born items routed to
  nothing.** `adopt` §1 honours the `.code-workspace` `name` override (root `billing-api`), while
  `adopt-apply` derives `repos[].name` (`api`). Findings and candidates carry the **root** name, and
  `adopt-backlog` §3 said to use it as the repo — so `resolve-gate` returned **`(nothing runnable)`**. The
  item is created successfully and looks perfect on the board; it fails only when someone runs it, and it
  fails **silently green**, because an empty gate has nothing to execute and nothing to fail. The feature
  that causes it is the `name` override, which exists to make the profile readable — so the more carefully
  a team names their folders, the more certainly their adoption-born work is misrouted. Fixed with an
  explicit mapping (**`repos[].adoptedFromRoot`**), resolution rules in both downstream commands, and a
  cross-check in `adopt-apply` that every finding and candidate root resolves to a real entry — an error,
  not a footnote.

**Open questions 4 and 5 are now answered from experience** rather than guessed, and both answers argue
*against* tightening the caps. The full reasoning is in the spec; briefly: a retroactive ADR's value is its
evidence and observed consequences, not its blank rationale, and the discriminator for whether a finding
becomes an item is **"can you name what goes wrong if nobody does this?"** — not severity. Two `low`
findings were proposed and a `medium` was skipped on exactly that test.

**Suites:** 373 cases across five files.

## [0.34.2] — 2026-07-31

### `aidlc` — brownfield: the drift, upgrade and removal legs, and two more defects

0.34.0 fixed the adoption scan against a live run and 0.34.1 the write half. This closes ADOPT-12: the
**drift**, **in-place upgrade** and **clean removal** legs, including the one the spec had singled out as
least testable by fixture — `human-edit` drift, which *"needs a config that was really applied, really
hand-edited afterwards, and re-scanned."* **Two more defects, both invisible, and both about a human's
deliberate decision being quietly undone.** Spec: `docs/brownfield-adoption.md`.

**What the run confirmed.** A re-scan after four committed changes on distinct surfaces produced a `drift`
block with **7 changes across 3 sources and 5 kinds**, attributed correctly in every case: two hand edits
as `human-edit`/`leave-alone`, a renamed gate and a new package as `code`/`propose`, a retired non-repo root
as `report-only`. The validator caught a stale `absent-gate` finding unprompted — the code had closed the
typecheck hole, and `/aidlc:adopt-backlog` would otherwise have re-filed shipped work. The **upgrade** leg
ran against a pre-0.31 unstamped config: shape-based classification named all four signals, 5 commands
relocated **byte-identical**, `pipeline.gates.ambiguousRequirements` left exactly where `run` §4 reads it,
every other key untouched, and the result resolved correctly through `resolve-gate.mjs`. The **removal**
leg stopped on a dirty tree as §1 requires, then deleted the tier-A paths, reverted `CLAUDE.md` section by
section, and kept `docs/adr/`, all three `backlog/` items and the secret-finding report — with `git status`
containing **nothing outside the approved plan** and `CLAUDE.md` **byte-identical** to its pre-adoption
state, checked against both the scan commit and an independent pre-adoption snapshot.

- **A union-seeded array cannot express a human deletion.** §3.3 seeds `pipeline.securityReviewPaths` by
  union, never replacement — which protects a path a human *added* and destroys one a human *removed*,
  because union only ever adds. The team had narrowed the array on purpose, with the reason in the commit
  message; the next apply put the entry straight back. **`/aidlc:adopt` §9 names this exact case** — *"a
  deliberately narrowed `securityReviewPaths` … produces a diff that looks exactly like routine convergence
  and reverts a decision nobody will notice in review"* — and the drift machinery could not catch it either,
  because for a set "differs from the baseline" does not say which *direction*, and nothing recorded that a
  seed had ever been applied. Fixed with a manifest rather than a heuristic: **`adoption.seeded`** records
  what adoption contributed, making the union three-way, and a withheld seed stays listed so it does not
  return next run. With no manifest the resolver falls back to plain union and says so — the conservative
  direction for a security array. New `skills/adopt-apply/seed-paths.mjs` + 27 cases.
- **`/aidlc:remove`'s verification compared against the scan commit**, so the team's own commits between
  adopting and removing came back as a list indistinguishable from files removal had touched by mistake. It
  does not error, it just prints — so it gets ignored, retiring the only mechanical check of removal's
  central promise, and it fails hardest on the long-lived projects where it matters most. §5 now separates
  the two questions it had conflated: *"did removal touch anything outside the plan?"* is a working-tree
  question `git status` answers exactly, and *"is each merged file back to its pre-adoption content?"* is a
  per-file history question — compare against `git show <adoption.commit>:<file>`, report *restored* when
  identical, and where it differs, show the remaining hunks as the team's own edits and confirm.

**Suites:** validate-profile 238, resolve-gate 38, resolve-root 38, converged 32, seed-paths 27 — 373 cases.

**Still unexercised.** `/aidlc:adopt-adr` and `/aidlc:adopt-backlog`; `--only` partial adoption; feeding
the derived drift deltas back through `adopt-apply`'s routing table; and removal with no manifest, which §1
declares a supported case and which needs its own fixture.

## [0.34.1] — 2026-07-31

### `aidlc` — brownfield: the first live run of `/aidlc:adopt-apply`, and three more defects

0.34.0 fixed the adoption **scan** against a live run. This does the same for the **write half**.
`/aidlc:adopt-apply` was run end to end against the same fixture — load, validate, read the merge
baseline, build the proposal, write, verify — and found **three more defects, none of which raised an
error**. Two were in code 0.34.0 had just added, which is its own lesson: a fix that is not exercised
downstream is a fix on probation. Spec: `docs/brownfield-adoption.md` (*the live apply run*).

**What the run confirmed.** `repos[]` built from the product and monorepo roots with the `control-plane`,
`non-repo` and `not-cloned` roots each excluded and the reason stated; the non-nested repo carrying an
absolute path while the others stay relative; `packages[]` with manifest names and the full dependency
chain, `releasable` false only for the private changeset-ignored package; every `unknown` **omitted rather
than defaulted** from the `saas` block; `securityReviewPaths` union-seeded with a cross-check proving no
auth, tenant-isolation or billing path was left out; compliance producing a **recommendation** not a
silent cadence change; `rules/git-workflow.md` rendered per repo with AIDLC defaults labelled as defaults;
and `CLAUDE.md` merged additively — checked mechanically, all 16 hand-written lines byte-identical and in
their original order, 38 added below. Gate resolution off the written config puts `@acme/web` on
*typecheck → test → build* and reports its missing `lint` as that package's own coverage hole — Phase 2's
gate-layering defect confirmed fixed at the package layer, on a real config.

- **`/aidlc:adopt-apply` could not produce a schema-valid config.** The schema's `required` is
  `["project", "workItems"]` and §3 never mentioned either, so a config built exactly as documented fails
  the schema check §4.5 tells you to run. Worse than a validation error: `project.key` is the work-item ID
  prefix, so an agent that cannot find it infers one — and the fixture's board is keyed `PLAT` while every
  loud signal in the workspace says `ACME` (package name, commit prefix, CODEOWNERS). Guess wrong and every
  item `/aidlc:adopt-backlog` creates is misfiled, silently, because nothing cross-checks a new item's
  prefix against the board. New **§3.0** writes both keys first, takes `workItems.source` from the tracker
  surface, and derives `project.key` from **the IDs the board already uses** — never a repo name, and asked
  outright when there is no board to read. `adopt` §7 now records that prefix as tracker evidence.
- **`not-applicable` gates were handed to the runner as `undefined`.** 0.34.0 added the third gate status
  and taught `coverageHoles()` to skip it, but *what actually executes* was an inline predicate in the
  CLI — `status !== "absent"` — which let `not-applicable` through. The Django service's resolved order
  read `… → build` with the command printed as `undefined`. The rule also lived in two places with only one
  tested, so `runnableSteps(steps)` is now exported, used by the CLI, referenced by `run` §7, and pinned by
  tests including *"no runnable step is ever missing its command"*. A sweep of the written config: **20
  runnable steps, 0 without a command.**
- **Re-applying was never idempotent, because the manifest carries its own timestamps.** §3.5 excluded
  `adoption.appliedAt` — but `adoption.writes[]` has an `at` per entry and this command **rebuilds the
  manifest every run**, so every re-apply differed, wrote, advanced `appliedAt`, and repeated. That is the
  fourth time this codebase has lost the same rule by omitting a field from an ignore list, so the rule
  stopped being prose in two places: **`converged.mjs` now answers "should I write?" for the config too**
  (`--config`), ignoring `appliedAt` and every `writes[].at` while still comparing `scannedAt` (it moves
  only when the profile moved) and `upgrades[].at` (history, appended not rebuilt).

Caught before it could bite: the gate status enum had been extended in the **profile** schema and not the
**config** schema, so carrying the status through would have written a config violating its own schema.
There is now a **cross-schema agreement check** over every enum `adopt-apply` copies between the two.

**Suites:** `validate-profile` 238, `resolve-gate` 38, `resolve-root` 38, `converged` 32 — 346 cases.

**Still unexercised.** Inside `adopt-apply`: the in-place upgrade (§2.1), `--only` partial adoption, and
applying drift deltas — the fixture's `changes[]` was legitimately empty, so the
`propose`/`report-only`/`leave-alone` table has still never been driven. Beyond it: `/aidlc:adopt-adr`,
`/aidlc:adopt-backlog`, the `human-edit` drift attribution, and `/aidlc:remove`.

## [0.34.0] — 2026-07-31

### `aidlc` — brownfield: the first live run of the Phase 3/4 scan, and the seven defects it found

Phases 3 and 4 shipped specified-but-unexercised, with the lesson from Phase 2's run written down at the
time: *each of those would fail by producing a plausible result rather than an error.* It held exactly.
`/aidlc:adopt` was run end to end against a purpose-built multi-root workspace — once at `--depth standard`
and again at `--depth deep` — and found **seven defects, not one of which raised an error**. Every one
produced a well-formed, fully-cited profile that passed validation and was wrong. Spec:
`docs/brownfield-adoption.md` (*Phase 3/4 — the live scan run*).

**What the run confirmed.** JSONC workspace parsing (a strict `JSON.parse` genuinely throws on a
hand-edited file, and the documented fallback would have collapsed six roots into three); the two-file
write guarantee, *verified* with `git status --porcelain` at every root rather than asserted; `--depth
standard` leaving all six source-evidenced runtime constraints honestly `unknown` with *"not sampled at
this depth"*, then `--depth deep` resolving tenancy to `shared-schema` on `tenant_id` with the two
alternative models explicitly excluded as counter-evidence; `expand-contract` derived from **paired
migration bodies** rather than from the policy document that also states it; per-package `dependsOn`
resolving to siblings while an external dependency in the same block is excluded; and a re-scan producing
`changes: []` with `depthChanged: true`, so eleven newly-known facts did not masquerade as movement.

**Two defects were structural, and both are now code with test suites rather than prose.**

- **Every git repo was classified "not a repo, enclosed by itself."** `git rev-parse --show-toplevel`
  always answers in Windows drive form (`C:/Users/…`), while the folder scan hands you MSYS form
  (`/c/Users/…`) — because Claude Code's Bash tool on Windows *is* Git Bash. The skill named exactly two
  normalisations, separators and case, and drive form is neither. The control plane failing this check
  drops `scan.commit` to `unknown`, which is the value both `adopt-apply`'s staleness check and
  `/aidlc:remove`'s verification baseline read. A second face: MSYS paths are invalid to non-MSYS tools, so
  `fs.existsSync("/c/…")` is false for a directory that exists — and because `not-cloned` is a legitimate
  classification, a root that is right there reads as *"declared but never cloned."* Both look like a
  working check, because the negative case still comes out right. New **`skills/adopt/resolve-root.mjs`**
  (+38 cases) canonicalises once at discovery and owns the boundary verdict. It is code because this is the
  *second* defect in this one probe, and because a mid-run attempt at the same normalisation in shell
  silently answered "equal" for every root including the genuine non-repo.
- **The profile could never converge, because tracking it is what moves HEAD.** §10 requires the profile be
  git-tracked and promises a second run at an unchanged commit writes nothing — but `scan.commit` was not
  among the fields excluded from that comparison. Scan at `A`, commit the profile as instructed, HEAD is
  `B`; the next scan records `B` and rewrites; commit that, and so on forever on a project that never
  changed — each rewrite also moving the baseline the next scan compares against, which is verbatim the
  failure Phase 4 said the rule existed to prevent. New **`skills/adopt/converged.mjs`** (+21 cases) makes
  the exclusion **evidence-based rather than blanket**: `scan.commit` is ignored only when
  `git diff --name-only <recorded>..HEAD -- . ':(exclude).aidlc/adoption/'` is empty, so a project that
  really moved still records the commit it was read at.

**Five more, each fixed where it was wrong.**

- **`defaultBranch` came back `unknown` on the least ambiguous repo possible** — one local branch, checked
  out — because it was named `trunk` and the chain's local-branch step tested for `main`/`master` while the
  step above it already counted `trunk` as trunk-ish. The chain now asks **cardinality before naming**.
- **A gate the stack cannot have had to be recorded `absent`, which is defined as a coverage hole.** A
  Django service has no `build` step; Go type-checks during `go build`. So every run would print permanent
  unfillable findings, and `/aidlc:adopt-backlog` would propose *"add a build gate"* as the first item a
  brownfield team reads. New third status **`not-applicable`**, which must carry evidence saying *why*, and
  which `resolve-gate.mjs` keeps out of `coverageHoles()`. It is a **gate** status, not a fourth fact form:
  `entryPoints` stays `known`/`absent`/`unknown`, because that map records which commands exist.
- **The control plane had no classification.** It is normally its own git repo, so `non-repo` was factually
  false and `product-repo` made it a **routing target** — work dispatched to a repo with no code. New
  **`control-plane`** classification, excluded from `repos[]` by name rather than by omission.
- **§10's skeleton, which the skill declares *sufficient* for offline use, had drifted from the contract the
  validator enforces.** The expensive instance: `gaps[].kind` omitted **`project-action`**, the value that
  exists precisely for a gap only the project can close. Since the validator demands every `unsupported`
  surface name a gap and its error does not suggest a kind, the cheapest repair was to invent a `skill` gap
  for a repo that simply has no CI — pointing `/aidlc:scaffold-skill` at work with no subject. Fixed by
  naming it in §7, adding a **`not-present`** support value for "the project does not have this surface",
  and syncing the skeleton. Both are now pinned by a **SKILL-agreement check**: every enum value a scan must
  write has to appear literally in `SKILL.md`. It caught a third instance on its first run — all 14
  `DRIFT_CHANGE_KINDS` were missing from the skill.
- **§5 had no rule for a root that serves tenants but owns no schema, and the naive answer is the dangerous
  one.** An 18-line untested Go handler that reads a tenant slug off the `Host` header decides which tenant
  every request is treated as; following the tenancy table literally lands on `not-multi-tenant`, which
  tells every later reviewer that cross-tenant leaks are impossible in the one file where they would
  originate — and empties that root's `securityReviewPathSeeds`. The failure is self-sealing, because the
  validator's tenancy invariants are all conditioned on the root being multi-tenant. Tenancy now describes
  the **system the root participates in**, a schema-less root inherits it at `medium` with an `absence`
  note, and `not-multi-tenant` needs positive evidence.

**Suites:** `validate-profile` **234** (from 197), `resolve-gate` **35** (from 30), plus `resolve-root`
**38** and `converged` **21** — 328 cases.

**What this release does not claim.** The run covered the **scan**. `/aidlc:adopt-apply`, `/aidlc:adopt-adr`,
`/aidlc:adopt-backlog` and every Phase 4 lifecycle leg but idempotency are still unrun — including the
`human-edit` drift attribution, the in-place config upgrade, `--only` partial adoption, and
`/aidlc:remove`. The spec lists each one. On Phase 2's precedent, that is where the next defects are.

## [0.33.0] — 2026-07-30

### `aidlc` — brownfield Phase 4: keeping an adoption true after the first day

Phases 1–3 taught AIDLC to read a brownfield project: its shape, its gate, its conventions, its runtime
constraints and the decisions its code already embodies. All of it assumed adoption happens **once**. It
does not. Codebases drift from their recorded profile, teams pilot on one repo before rolling out, configs
outlive the plugin version that wrote them, findings sit in a report nobody re-reads, and some evaluations
end in removal. This phase makes all five first-class. Spec: `docs/brownfield-adoption.md` (ADOPT-12,
ADOPT-11, ADOPT-13).

**ADOPT-12 — drift, partial adoption, in-place upgrade, clean removal.** `/aidlc:adopt` on an
already-adopted workspace now reads the previous profile **before overwriting it** and reports a `drift`
block. The comparison is deliberately three-way, because two of the three legs must be handled in
opposite directions:

- **Code that moved** and **config that no longer matches the code** are drift to propose.
- **Config that differs from what the last apply wrote** is a human's deliberate edit — intent no scan can
  see. It is reported as *"left as you set it"* and **never proposed for overwrite**. That is the failure
  the block exists to prevent: a hand-tuned gate command reverted under a diff that reads like routine
  convergence is the one drift outcome nobody catches in review. `source: "human-edit"` is pinned to
  `action: "leave-alone"` by the validator, not by the skill's good intentions.
- A **depth change is not drift.** A `quick` baseline re-scanned at `deep` turns dozens of `unknown`s into
  facts — new knowledge, not new movement — so `depthChanged` must be set when the depths differ, or forty
  non-changes bury the two real ones.
- **No baseline, no drift.** On first contact `changes[]` is empty and the profile says so: reporting a
  whole project as "new drift" is noise that teaches people to skip the section.

Three more lifecycle pieces land with it. **Partial adoption** — `--only <repo|package>` on both commands,
with the config recording the scope (`adoption.only`) *and* the exclusions (`adoption.unmanaged`), so later
scans report the rest as unmanaged-by-choice rather than re-proposing it; a re-proposal of an unmanaged
surface is a validation error. **In-place upgrade** — a config from an older plugin version is detected by
its new `configVersion` stamp, or by *shape* where it predates the stamp (files already in the wild cannot
be stamped retroactively), and upgraded as its own small approved diff in which keys are **relocated,
never rewritten**: every command a human authored stays verbatim, `pipeline.gates.ambiguousRequirements`
stays exactly where `run` §4 reads it, and the moves are recorded in `adoption.upgrades[]`. **Clean
removal** — the new `/aidlc:remove`.

- `/aidlc:adopt-apply` now records `adoption.writes[]`: per file, whether adoption **created** it, **merged
  into** it (with the sections added), or **rendered** it. That manifest is what makes removal possible
  rather than merely careful — without it, "which `CLAUDE.md` lines were ours" is a guess, and the
  safe-looking guess destroys the team's own content.
- `/aidlc:remove` classifies every path into three tiers and treats them differently. The rule it is built
  around: **deleting a container AIDLC created is not the same as deleting AIDLC's content.** `init` made
  `docs/adr/`, `backlog/` and `.aidlc/runs/`; what is *inside* them is the team's — decision records they
  will cite for years, work items that are their plan of record, an audit trail a regulated project may be
  required to retain. Those are kept by default and asked about individually. Stack tooling
  (`tsconfig.base.json`, the enterprise skeleton) is kept too, because by now their code depends on it.
  Afterwards it verifies with `git diff` against the pre-adoption commit that the project's own files are
  untouched, and says plainly when verification was not possible.

**ADOPT-11 — a debt backlog seeded from the findings, opt-in.** The scan gains `debtFindings[]` (§8):
absent gates, an auth or tenant-isolation path with no test or no review history, an end-of-life declared
runtime, TODO clusters, docs the code contradicts, cross-platform hazards, a repo whose PRs merge ungated,
and the safety findings promoted to work. The new `/aidlc:adopt-backlog` turns approved ones into items —
deduped against the board with the bounded-sweep discipline and its scope stated, each with ≥3 testable
acceptance criteria and a size, each carrying the `adopted` label and a provenance note naming the scan
commit. Three rules earn their keep:

- **A finding states the debt; it never ships the change.** `fix`, `remedy`, `patch`, `diff` and `solution`
  are rejected outright. The scan sampled the code; it did not design the change, and a finding carrying
  its own patch invites the item to be closed by applying it unread — routing around the plan → implement
  → review → verify path that is the point of the pipeline.
- **A tracker item may be a public GitHub issue.** So a finding whose *location* is itself the disclosure
  is `sensitive`: it carries a `trackerSafeTitle`, **no paths**, and points at the adoption report, which
  stays in the repo. `committed-secret` and `pii-in-fixtures` are forced sensitive by the validator.
  Publishing "AWS key at `scripts/deploy.sh:14` in commit 9ac31be" to the internet under an adoption
  banner turns a helpful scan into an incident.
- **An EOL judgement is not evidence.** The declared version is evidence; "that version is end-of-life"
  goes in `note` as something to confirm, because this scan makes no network calls and cannot read a
  release calendar. And an `absent-gate` finding must name a gate the root really lacks — a backlog whose
  first item is provably wrong is one nobody reads twice.

**ADOPT-13 — documentation.** New `docs/brownfield-walkthrough.md`: a four-year-old GitFlow Django service
beside a squash-only Next.js app in a multi-root workspace, from first scan through apply, retroactive
ADRs and a debt backlog to a run that branches from `develop` and verifies with `tox`, then a drift report
six weeks later and a clean removal. `docs/adoption-guide.md` gains the lifecycle section; the README and
the user-guide cheat-sheet gain the two new doors.

**Also in this release**

- **`/aidlc:adopt` now converges instead of churning.** Because the profile is a tracked drift baseline,
  rewriting it every scan would both spam the team with timestamp-only commits and move the baseline the
  *next* scan compares against. A re-scan at the same commit and depth now **writes neither file** and
  leaves `git status` clean — the same rule `adopt-apply` §3.5 already applied to `appliedAt`, and it makes
  the idempotency promise literal rather than nearly-true.
- Config gains `configVersion` and `aidlcVersion` at the top level, written by `init` and `adopt-apply`.
- `validate-profile.test.mjs` is at **197 cases** (up from 156), including the eight new enums
  cross-checked against the published schema and a check that the drift baseline's depth enum still
  matches the scan's — the whole `depthChanged` rule compares the two.

## [0.32.0] — 2026-07-30

### `aidlc` — brownfield Phase 3: what the project actually is, beyond its shape

Phases 1–2 taught AIDLC a brownfield project's *shape* (topology, stack, gates, git conventions). This
phase adds the three things that shape leaves out — and each one closes a gap where the framework was
previously confident and wrong rather than merely ignorant. Spec: `docs/brownfield-adoption.md`
(ADOPT-9, ADOPT-10, ADOPT-8).

**ADOPT-9 — the runtime constraints that change how code must be written.** For a live SaaS,
"TypeScript + Postgres" says almost nothing about what a *safe* change looks like; "shared-schema
multi-tenant on `tenant_id`, migrations run against live customer data, releases ride LaunchDarkly flags,
and `openapi/public-v1.yaml` is a published contract" says nearly everything. Nobody writes those down,
because everyone on the team already knows them — so an agent is the one participant who doesn't.
`/aidlc:adopt` now derives them per repo into a `saas` block: tenancy model and tenant key, isolation /
auth / billing paths, feature-flag system, migration tool plus whether expand/contract applies, public API
contracts, environments and deploy strategy, freeze windows, compliance regimes **with the signal that
evidenced each**, messaging, observability, integrations. `/aidlc:adopt-apply` writes it and **union-seeds**
`pipeline.securityReviewPaths` — never replacing what a human put there.

- The constraints reach the implementer, reviewer, security and architect briefs as *constraints*, with the
  consequence spelled out ("every query filters by `tenant_id`; a miss is a cross-tenant read, and nothing
  in the gate will catch it") rather than as background to acknowledge.
- **It informs; it does not gate — with exactly two exceptions**, both conditional on an evidenced fact and
  both earning it on the same grounds (silent failure, invisible to the gate, customer-visible when
  missed): a **destructive migration** where migrations run against live tenant data is a review
  **blocker**, and a diff touching an **API contract, auth path or tenant-isolation path** is reviewed
  **regardless of the configured cadence**. A detected compliance regime *recommends* raising the security
  cadence and names the signal; it never raises it silently. An absent field asserts nothing — the pipeline
  never invents a constraint the scan did not evidence.
- Mostly a `--depth deep` section, and honest about it: at shallower depths the report says *"not sampled
  at this depth"* rather than letting silence read as "this project has no runtime constraints". Getting
  that backwards would be the worst available outcome — it tells every later reviewer that cross-tenant
  leaks are impossible here.

**ADOPT-10 — retroactive ADRs, with the rationale deliberately left blank.** On a brownfield project
`docs/adr/` is empty while the decisions are everywhere in the code, which starves `/aidlc:do` and the
architect of the one thing they cannot re-derive. `/aidlc:adopt` §6 now derives ranked, capped
`adrCandidates[]` (tenancy model, data store, auth model, API style, deployment topology, messaging,
build tooling…), and a **new `/aidlc:adopt-adr`** writes the approved ones into `docs/adr/` — one at a
time, each behind its own approval.

- Each ADR is `accepted (retroactive)` — accepted because the code already runs on it, retroactive because
  nobody approved the document at the time — dated `unknown` where a squashed or shallow history cannot
  establish a date, and citing `path:line` evidence.
- **`## Rationale` and `## Alternatives considered` read "not recorded — confirm with the team", and stay
  that way.** A scan sees *what* was decided and never *why*; one plausible invented sentence in a document
  marked `accepted` becomes history nobody authored and everybody cites in reviews for years. The validator
  rejects a candidate carrying a rationale in any of five spellings, so this is a check rather than an
  intention. The report frames the blank as a task with a deadline of sorts: fill it while the people who
  remember are still on the team.
- Existing decision records elsewhere (Confluence, Notion, `RFCs/`) are **linked** from the ADR index,
  never copied or relocated. Re-running proposes nothing for a decision already recorded — `adoption.adrs[]`
  is the dedup key — and lists it as *already covered* rather than dropping it, so a quiet second run is
  legible as "checked" rather than "never looked".
- `templates/adr-template.md` gained the `## Rationale` section (useful greenfield too) and
  `accepted (retroactive)`; `aidlc:architecture` and `aidlc:do` now tell readers that a retroactive ADR's
  decision is binding while its reasoning is genuinely unknown — never to be filled in by inference.

**ADOPT-8 — a monorepo's packages are a first-class routing dimension.** `mono` meant one repo delivering
one app and `poly` many repos; a pnpm/Nx/Turbo/Lerna/Maven-modules repo was neither. It stays
`layout: mono` (or one poly repo entry) with a new `packages[]` — because `repos[]` means a **git**
boundary and a monorepo has exactly one, while `packages[]` means an **ownership** boundary inside it. A
third layout value would have conflated the two and left the hybrid workspace (a monorepo root beside
single-app repos) with no spelling at all.

- `packages[]` carries name (as the package's *own manifest* declares it), path, role, labels, per-package
  `stack` and `ux`, `dependsOn`, and `releasable`. An item resolves to a package (explicit → label → path →
  default → grounding → ask), and its gate, stack, standards, design pod and PR label scope to it —
  resolving stack per *repo* is how a Python worker gets handed the web coding standards.
- **One item is still one repo, one branch, one PR.** The package narrows scope inside the leaf; it is
  never a new leaf, and sharing a repo never justifies two packages' work on one branch. Cross-package work
  decomposes like cross-repo work, sequenced by the packages' own `dependsOn` graph.
- New `pipeline.gates.verify.packages` layer for a monorepo adopted as mono (which has no `repos[]` entry
  to key packages under); `resolve-gate.mjs` layers it narrowest → broadest like the rest, and a repo-scoped
  package block outranks it. `/aidlc:status` groups in-flight work by package and flags contract-affecting
  runs. `/aidlc:release` cuts a **per-package** release where the tooling supports one (changesets,
  independent Lerna, `nx release`) — driving the project's own tool rather than hand-bumping versions — and
  **says plainly that it cannot** where the repo releases as one unit, rather than tagging something the
  project has no way to publish.

**Verification.** `skills/adopt/validate-profile.test.mjs` is at **156 cases** (from 93) and
`skills/run/resolve-gate.test.mjs` at **30** (from 24), both green. The reference fixture now carries a
shared-schema multi-tenant root with its full runtime profile, a three-package monorepo with a dependency
edge and changesets tooling, and a ranked candidate list including an already-recorded entry — proving the
shapes representable, not merely described. Ten new enums are cross-checked against
`docs/adoption-profile.schema.json` so the validator's offline copies cannot drift. The invariants that are
now checks rather than intentions, each because its violation is **invisible in a profile that otherwise
looks complete**: no invented ADR rationale; every auth/tenant-isolation/billing path reaches the
security-review seeds (otherwise: recorded as dangerous, reviewed as routine); a multi-tenant root with a
migration tool must *answer* the expand/contract question (silence leaves the reviewer with no constraint);
candidates ranked and capped (an unranked list plus a cap drops exactly the decisions worth recording); a
package's `dependsOn` resolves to siblings with no cycle; and `releasable` requires release tooling that
could actually cut one.

**Ships specified-but-unexercised, and says so.** Phase 2 shipped the same way and a live run found four
defects in it — every one producing a *plausible* result rather than an error. The same exposure applies
here: real tenancy detection off a real ORM (the `--depth deep` path is the least exercised code in the
scan), whether the risk triggers fire without false positives, whether a retroactive ADR is useful to the
team that lived through the decision, the per-package release path against real tooling, and whether the
seeded review paths produce a workable volume. `docs/brownfield-adoption.md` → *Phase 3 — what is verified,
and what is not* keeps the list honest.

## [0.31.1] — 2026-07-30

### `aidlc` — four defects the first live brownfield adoption found

0.31.0 shipped Phase 2 specified but unexercised. A live run closed that gap: a fixture workspace built as
a GitFlow Python service with **no `package.json`**, a squash-only TypeScript app, a fork-based polyglot
monorepo (pnpm + Turbo, a TS package beside a Python one), a non-repo docs folder and a **JSONC**
`.code-workspace` — against a control plane pre-seeded with a hand-authored `CLAUDE.md` and config, so
merge-awareness had something real to protect. `/aidlc:adopt` → `/aidlc:adopt-apply` ran end to end and the
consumption paths were driven off the config they produced.

Most of it worked as designed, including the things Phase 2 existed for: Python gates derived from
`tox.ini` with no `package.json` anywhere, `absent` gates surfacing as coverage holes, the compose-backed
suite flagged environment-dependent, GitFlow's `develop` honoured with `main` left untouched, a squash repo
producing zero merge commits, `ambiguousRequirements` preserved untouched, and every hand-written
`CLAUDE.md` line intact with the conflicting command **kept**. Four things were wrong, and each produced a
*plausible* result rather than an error — which is why only execution found them:

- **`defaultBranch` was `unknown` for every repo.** `rev-parse --abbrev-ref origin/HEAD` exits 128 whenever
  `origin/HEAD` was never set locally — the normal state of any repo whose remote was *added* rather than
  cloned from. That left the profile's most load-bearing fact blank everywhere (it is what `<base>` falls
  back to), stranding the pipeline with nowhere to branch. `aidlc:adopt` now works a fallback chain —
  remote refs, then a single trunk-ish local branch confirmed by `merge-base --is-ancestor`, each at
  `medium` confidence — before recording `unknown`. Resolved 3 of 3 fixture repos.
- **`branchPattern` was `unknown` for every repo**, because deleting merged branches is normal hygiene and
  the scan only read live refs. It now recovers names from merge-commit subjects
  (`Merge branch 'PAY-31-ledger-export' into develop`) before giving up. A squash-only repo still reports
  `unknown` — squashing genuinely erases the evidence, and saying so is the correct answer.
- **The "re-applying the same profile changes nothing" guarantee was false.** `adoption.appliedAt` is a
  timestamp, so every re-apply rewrote a line. `adopt-apply` now compares its proposal with `appliedAt`
  excluded and, when nothing else differs, **writes nothing at all**. The guarantee is now literal: two
  consecutive re-applies leave a byte-identical file and a clean `git status`.
- **Gate resolution silently dropped inherited gates.** "Most-specific-wins" meant *replace*, so a Python
  package inside the TypeScript monorepo resolved to `pytest` alone and the repo-wide `lint` **vanished** —
  and a gate that vanished is indistinguishable from one that passed, the same failure class as deleting an
  `absent` entry. Resolution now **layers narrowest → broadest**: each layer contributes its steps in its
  own order but only for gate names no narrower layer claimed, so a package inherits the repo's other gates
  while its own ordering still wins. A package that should genuinely skip a repo gate declares it
  `status: absent` at package level — explicit, and still reported as a coverage hole.
  - Because this is exactly the kind of rule that fails silently when re-derived per run, it is now **code
    rather than prose**: new `skills/run/resolve-gate.mjs` (CLI + importable, offline, no deps) with a
    24-case `resolve-gate.test.mjs` pinning the semantics, and `run` §7 invokes it instead of describing it.

`docs/brownfield-adoption.md` records the full run, what it confirmed, and what remains unexercised (a real
fork PR against an upstream, branch-protection reads, an offline run, a read-only workspace, and a full
`/aidlc:run` with agents over the derived gate).

- Versions: `aidlc` 0.31.0 → **0.31.1**, marketplace → **0.31.1**.

## [0.31.0] — 2026-07-30

### `aidlc` — brownfield Phase 2: the project's own gate and conventions, applied behind a diff

Phase 1 could *describe* an existing project; nothing could act on the description. A brownfield team still
ran a pipeline that assumed npm scripts and imposed AIDLC's git conventions on a repo that already had its
own. This is ADOPT-3, ADOPT-4 and ADOPT-5 — where a brownfield project becomes genuinely runnable rather
than merely scaffolded.

- **New skill `aidlc:adopt-apply`.** The write half of adoption, deliberately a **separate command** so
  `/aidlc:adopt` keeps its read-only guarantee and stays safe to run on first contact. It validates the
  profile with the scan's own validator before believing it, refuses a profile whose `scan.commit` no longer
  matches HEAD without saying so, then works one way only: **propose, then write.** The complete diff, each
  value's evidence beside it. A `low`-confidence fact becomes a **question**, never a pre-filled proposal.
  A disagreement with a value a human authored is surfaced as `detected X · configured Y — keep / replace`
  and **defaults to keep**. Partial approval is normal.
- **`pipeline.gates` — the project's real gate replaces the npm assumption (ADOPT-4).** An ordered step
  list, resolved most-specific-first (package → repo → workspace), executed top to bottom by `aidlc:run`'s
  verify phase. A repo with no `package.json` now completes a full run on its own gate — `ruff` + `pytest`,
  `mvn -B verify`, `cargo test`, `go test ./...`. Four things carry the weight:
  - **`status: absent` is a first-class entry, kept on purpose.** A gate the project does not have stays
    visible in config, and every run writes it into `## Findings` as a coverage hole. It is never
    `required`, never counted green, and never substituted with an AIDLC default. Deleting the entry to
    tidy the config is exactly how a missing gate becomes invisible.
  - **`environmentDependent` + `services`** make a failure diagnosable as *environment unavailable*
    instead of *code broken* — the difference between a useful run report and one that blames the diff for
    a missing database.
  - **`scope`** (`repo` · `package` · `affected` · `changed-paths`) with `maxItemMinutes`: a monorepo with
    Nx/Turbo runs **affected targets only** and the run file **names the affected set**, because a green
    subset is not a green suite.
  - **`providedByHook`** records that husky / pre-commit / lefthook already runs a gate, so the AIDLC
    pre-commit layer is never installed on top of a layer the project already has.
- **The project's git conventions win (ADOPT-5).** New `gitConventions` on the mono `git` block and on every
  `repos[]` entry: `integrationBranch`, `commitStyle`, `mergeStrategy`, `longLivedBranches`, `hotfixRoute`,
  `contribution` + `upstreamRemote`, and `conventionsSource`. `aidlc:git-workflow` now resolves a single
  **`<base>` = `integrationBranch` if set, else `defaultBranch`** and uses it for every branch-from, PR base
  and local merge — so a GitFlow project branches from and integrates into `develop` and never touches
  `main`. It follows the project's commit style rather than imposing conventional commits, honours
  `mergeStrategy` on the local-merge path (a squash-only repo no longer receives a `--no-ff` merge commit),
  refuses to delete or branch off a long-lived branch, follows `hotfixRoute` for a production incident, and
  gains a **fork-based contribution path** (push to the fork, PR to the upstream) so a repo the user cannot
  push to is handled at adoption time instead of failing at first push. `conventionsSource` distinguishes
  detected from **default** from **human** — a default presented as a detected fact is the specific
  dishonesty that field prevents, and a `human` block is never touched by a scan.
- **Provenance and idempotency.** New `adoption` block (`scannedAt`, `commit`, `profileVersion`,
  `profilePath`, `depth`, `appliedAt`, `unmanaged[]`) and `architecture.resolvedBy: "codebase-scan"`.
  Applying the same profile at the same commit produces **no diff at all**; at a later commit it proposes
  the deltas only. `--only <repo|package>` scopes a pilot and records what was left unmanaged, so a later
  run neither re-proposes it nor mistakes it for missed.
- **Detection to match, in the scan.** `gates[]` (the ordered proposal, mirroring CI's order where CI
  declares one, else cheapest-first) and `conventions` (branch/commit/merge/integration/long-lived/hotfix/
  CODEOWNERS/push-access) derived from **bounded** history — the bound is stated in the evidence, a shallow
  clone lowers confidence on everything history-derived, and an unreadable branch-protection API is
  `unknown`, **never** `absent`. Only an API that *answers* "no protection" earns `absent`, and that means
  the repo's PRs merge ungated, which is named explicitly.
- **`/aidlc:init` now offers three setup paths** (ADOPT-3's last criterion): requirements-doc → bootstrap,
  **existing code → adopt**, or "I know my setup" → the full Q&A. The adopt path collects only key/name/
  tracker/cadence, scaffolds the control plane, and skips tooling/structure/CI scaffolding entirely — an
  existing project already has its own, and overwriting it was never the intent.
- The scaffolded `rules/git-workflow.md` now says up front that its rules are **AIDLC's defaults for a
  project with no convention of its own**, and that adoption re-renders it from the project's real ones.

Enforcement kept pace with the contract: `validate-profile.mjs` gained gate and convention rules and the
suite went 71 → 93 cases. Two invariants worth naming, because both catch a *plausible* profile rather than
a malformed one: an `absent` gate may not be `required: true` (a hole that claims to block reads as green),
and `integrationBranch` may not equal `defaultBranch` (it exists to name a target that is *not* the default,
so equality means one of the two was mis-derived). A `fork-only` `pushAccess` with no `vcs.upstream` is also
rejected — a fork path with no upstream has nowhere to open its PR.

- Versions: `aidlc` 0.30.0 → **0.31.0**, marketplace → **0.31.0**.

## [0.30.0] — 2026-07-29

### `aidlc` — `/aidlc:adopt`, the brownfield front door: read the code, derive the facts, prove each one

AIDLC already *landed* cleanly on an existing repo — `init` merges rather than clobbers, the web tooling
and enterprise skeleton are merge-aware, `/aidlc:repo add` never rewrites history. What was missing was
the layer above: **nothing derived project knowledge *from* an existing codebase.** `/aidlc:bootstrap`
infers architecture from a *requirements document*, which a brownfield project does not have. So the
brownfield path was: answer mono-vs-poly, stack and commands **by hand at init, from memory, about a
codebase the framework had never read** — and every wrong answer was written into `CLAUDE.md` and
`aidlc.config.json` as ground truth, silently steering every later run.

This is Phase 1 of the epic in `docs/brownfield-adoption.md` (ADOPT-2, ADOPT-14, ADOPT-7, ADOPT-6): the
read-only scan. It ships alone, is useful alone, and has nothing to roll back.

- **New skill `aidlc:adopt`** (`/aidlc:adopt [--depth quick|standard|deep]`). Scans the workspace and
  emits `.aidlc/adoption/profile.json` + `.aidlc/adoption/report.md` — **and nothing else.** No config,
  no `CLAUDE.md`, no rules, no items, no branch, no commit; the skill verifies that claim with
  `git status --porcelain` rather than asserting it. Depth is a cost dial, not a quality dial: a
  shallower scan records **more `unknown`**, never a weaker guess.
- **Evidence or silence.** New contract at `docs/adoption-profile.schema.json` (`profileVersion: 1`),
  built on a `fact` primitive with three deliberately distinct statuses — `known` (value + `path:line`
  or command output + confidence), **`absent`** (the thing provably is not there, with `absence`
  evidence), and `unknown` (with the reason). Collapsing `absent` into `unknown` loses a coverage hole;
  collapsing `unknown` into a default is exactly how a wrong inference reaches a permanent file. A
  `known` fact with no evidence fails schema validation — the guess is not expressible.
- **The workspace is the unit of adoption, not the repo (ADOPT-14).** Users open an IDE workspace that
  may hold several repos, and AIDLC's poly *model* was already right while its *mechanics* assumed
  every repo was nested under the control plane. Discovery now runs **both** signals — a
  `*.code-workspace` `folders[]` list (honouring `name` overrides and paths outside the opened folder,
  on any drive) **and** the `<sub>/.git` folder scan; using only the latter collapses a multi-root
  workspace into a single repo. Every root is classified — product repo · monorepo · non-repo folder ·
  reference-only clone · already-adopted · not-cloned — and **proposed for confirmation, never assumed.**
  The control plane resolves to the folder holding the `.code-workspace` file (else the opened folder)
  and is **never silently a product repo**.
- **Two failure modes are now caught at adoption time instead of at the first `/aidlc:sprint`.** A root
  the session cannot read is reported with its exact `--add-dir` remedy, and adopt never reports a repo
  as profiled when it could not read it. Per-root trust and plugin-enablement state is checked and named
  with its fix — the F42 silent failure, caught early.
- **The nesting assumption is gone from the schema and the skills.** `repo.path` accepts an absolute
  path or a path outside `workspace.root`; `workspace.root` is documented as a base for *relative*
  resolution rather than an assertion that repos are subfolders. Where a repo is **not** nested, the
  control plane's `.gitignore`/gitlink protection is **inapplicable, not missing** — `init` now says so
  rather than leaving the next reader to record a phantom gap. `aidlc:work-items` and `aidlc:run` were
  updated to resolve, quote and `cd` into paths that may hold spaces, sit on another drive, or be UNC.
- **Adoption-time safety contract (ADOPT-7).** `.env` files are never read or printed — recorded by
  path only, with variable *names* possible solely when `pipeline.envFileAccess` permits and the
  `env-guard` hook allows the read; a git-*tracked* env file is itself reported as a finding. Suspected
  secrets are recorded by location and type with the value redacted and never written into the profile,
  the report, an item or a commit. PII-suspect fixtures are flagged and excluded from every quoted
  excerpt. The scan makes **no network calls and sends no source anywhere**; offline it completes and
  marks the affected checks `unknown`. Large repos are sampled with the strategy and honest coverage
  percent stated, and a workspace with no write permission gets its report printed to the session.
- **Honest degradation (ADOPT-6).** The report carries a supported / partial / unsupported table for
  every detected surface — stack, tracker, VCS, CI, migration tool, containers, hooks — with a one-line
  consequence each, judged against **the plugins actually installed**, not what AIDLC could support in
  principle. A Django + Terraform + Flutter shop is told plainly that it gets the language-agnostic
  core. An unsupported tracker is never a blocker: the markdown backlog is offered with its trade-off
  stated, and each gap becomes a `gaps[]` proposal for `.aidlc/extensions.json`.
- **Read-only git introspection is now allowlisted** in the project template —
  `rev-parse`/`ls-files`/`check-ignore`/`for-each-ref`/`count-objects`, `submodule status`,
  `worktree list`, `git lfs env`, in both the bare and `git -C` forms. A read-only scan that fires a
  dozen permission prompts trains people to click through prompts, which is the worse security outcome.
  **`git config` is deliberately excluded**: it is a write verb as often as a read one, and its read
  form can echo a PAT embedded in a remote URL. The skill is required to strip credentials from any
  remote URL before recording or printing it, and to record a config-only fact as `unknown`.
- **`/aidlc:init` points at it.** On the full path, when there *is* existing code, init suggests running
  `/aidlc:adopt` first so the topology/stack/command answers come from the report instead of from
  memory. A suggestion, not a gate.
- **The contract is enforced, not trusted.** New `skills/adopt/validate-profile.mjs` — dependency-free,
  offline, both a CLI and an importable API — which the skill runs on its own output before reporting a
  scan complete. It rejects a `known` fact with no evidence, an `unknown` fact that smuggles a value, a
  `writes[]` entry outside `.aidlc/adoption/`, an unreachable root with no stated remedy, an unsupported
  surface with no recorded gap, an env/secret/PII finding that carries content — and, as a backstop, any
  credential-shaped string **anywhere** in the profile or the report. `validate-profile.test.mjs` covers
  it in 71 cases, including a reference fixture that doubles as proof the awkward shapes are
  representable (multi-root across two drives · monorepo beside single-app roots · UNC path with spaces,
  unreachable · zip drop with no VCS · Mercurial checkout · polyglot monorepo · absent test gate). The
  validator duplicates 14 schema enums so it can run inside an installed plugin with no schema file; the
  suite cross-checks every one against `docs/adoption-profile.schema.json`, so the duplication cannot
  drift silently.

**Two defects a fixture pass caught before release**, both of which would have produced a *confidently
wrong* profile rather than a visible failure:

- **`git rev-parse --is-inside-work-tree` is the wrong probe for "is this root a repo."** Git searches
  ancestor directories, so it returns `true` for any folder beneath any repo — and a home directory under
  git makes that *every* folder. Every follow-up question then described the **ancestor**: its branch,
  remotes, history and size, recorded against the root with a citation. Detection is now a marker test
  plus requiring `rev-parse --show-toplevel` to equal the root itself; a root inside another repo is
  recorded as the new `enclosingRepo` fact and reported as the gitlink hazard it is, and the validator
  rejects any root that claims both. The same rule governs the control plane — not its own repo root
  means `scan.commit` is `unknown`, not the enclosing repo's HEAD.
- **A `.code-workspace` file is JSONC, not JSON.** VS Code accepts `//` comments and trailing commas, and
  hand-edited workspace files contain them, so a bare `JSON.parse` throws — and the original instructions
  would then have fallen back to the folder scan alone, **silently collapsing a multi-root workspace into
  a single repo**, the precise failure ADOPT-14 exists to prevent. Comments and trailing commas are now
  stripped before parsing, and a file that still will not parse stops the run loudly instead of degrading.

Adopt does **not** write config, `CLAUDE.md`, `pipeline.gates`, rules, ADRs or backlog items, and does
not remediate anything it finds — those are Phases 2–4 of the epic, each a separate propose-then-approve
step. No change to `run`, `intake`, `next`, `bootstrap`, any agent, or any hook.

- Versions: `aidlc` 0.29.0 → **0.30.0**, marketplace → **0.30.0**.

## [0.29.0] — 2026-07-29

### `aidlc` — `/aidlc:do`, a general front door that grounds before it routes

Until now every entry point required you to already know the shape of your request: `/aidlc:run <ID>`
for a tracked item, `/aidlc:intake <text>` for a requirement, `/aidlc:next` for whatever is top of the
backlog. A prompt that was **not** work had no door at all. Asking *"would this feature sit right in our
project?"* or *"should we use X here?"* fell straight through to the bare agent, which answered without
the one thing that makes the answer worth having — the project's ADRs, backlog, repo roles and stack.
The closest existing capability, `aidlc:research`, is `user-invocable: false`, runs only against a spike
**item**, and commits a formal dated decision report to `docs/research/`; there was no way to get a
grounded opinion without first minting a work item for it.

- **New skill `aidlc:do`** (`/aidlc:do <anything>`). The orchestrator grounds itself first, then routes.
  Six routes, each announced in one line **before** acting so a misroute costs nothing to correct:
  **consult** (opinion / fit / "should we") · **explain** (how or why something works) ·
  **diagnose** (a defect) · **build** (hands off to `aidlc:run`, which already accepts free text) ·
  **resume** (the prompt names a `{KEY}-{n}`) · **meta** (`/aidlc:status`, `/aidlc:next`).
- **A no-artifact answer is a first-class outcome.** Consults and explanations normally end with no
  item, no branch and no commit — stated explicitly in the skill, because the natural failure mode of a
  pipeline plugin is manufacturing a work item to look productive. A consult also never silently becomes
  an implementation: a mixed prompt ("is this a good idea, and if so build it") runs the consult, presents
  the recommendation, and waits for a go-ahead.
- **The grounding floor is deliberately cheap** — config → in-flight runs (control plane **and** each
  declared repo's `.aidlc/runs`, the poly-aware scan `/aidlc:status` uses) → backlog **titles only** →
  ADR **titles only**. Full ADRs are read only when the prompt touches that decision; agents escalate one
  at a time and only when the answer genuinely depends on it (`aidlc-architect` reserved for
  hard-to-reverse calls). Most prompts are answered from the floor plus one targeted read.
- **ADRs are cited, not re-litigated.** The skill forbids quietly contradicting a recorded decision —
  cite it, or explicitly propose superseding it. Answering an architecture question without reading the
  relevant ADR is the specific failure this door exists to prevent.
- **Discoverability** — added to the README command table, the user-guide cheat-sheet (including the
  "an opinion, not a task" row), and the scaffolded project `CLAUDE.md`, which now tells a project to
  prefer this door over answering a project question cold.

Existing behaviour is untouched: no change to `run`, `intake`, `next`, any agent, or any hook. `do` is a
router that hands off to the pipeline for delivery and writes no product code itself.

- Versions: `aidlc` 0.28.2 → **0.29.0**, marketplace → **0.29.0**.

## [0.28.2] — 2026-07-24

### `aidlc` — env switch: resolve `envFileAccess` from the env file up to the control plane (F50)

Found in a live poly workspace. 0.28.x's env-file switch read `pipeline.envFileAccess` from a single
fixed path — `<cwd>/.claude/aidlc.config.json`. That is correct only when the session cwd is the
workspace root. In a **poly workspace** the switch lives once at the control plane while each product
repo is a subfolder with its own env files, so a tool call whose cwd was a product subrepo found no
config there and **fell back to `deny`** — hard-blocking env reads/writes in a workspace that had
explicitly opted into `"ask"`. The block message then told the user to *"set `envFileAccess: \"ask\"`"*
— which was already set — so the pipeline, seeing no valid path forward, invented a non-existent
`"allow"` value. (There is no `"allow"`: the enum is `["deny","ask"]` and both hooks fail closed on
anything else, so setting it would have blocked *harder*, not opened the gate.)

- **Both hooks now resolve the switch by walking UP from the ENV FILE'S OWN directory** to the nearest
  `.claude/aidlc.config.json` — `env-guard.mjs` for the Read/Edit/Write tools, `guard.mjs` for the Bash
  path (each detected env target). Layout-independent: mono finds it at the repo root; poly finds it at
  the control plane from a product subrepo of any depth. **The session cwd no longer matters, and each
  repo may carry its own env files under one control-plane switch.**
- **Still fails closed** — no config anywhere up the tree, an unreadable/malformed one, or any value
  other than the exact string `"ask"` ⇒ `"deny"`. The nearest config on the path governs (opted-in or
  not), so an unrelated ancestor can't silently override a workspace.
- **The deny message no longer misleads.** If the switch is *already* `"ask"`, it now says the config
  could not be found by searching up from the env file's location — pointing at a misplaced config
  rather than implying a stronger setting exists.
- **Regression suites extended** — `env-guard.test.mjs` (20 → 26 cases) and `guard.test.mjs`
  (+4 cases, 74 total) now cover subrepo-cwd / control-plane-config resolution and its fail-closed
  edges. The gap was previously untested: every case anchored cwd on the config's own directory.

- Versions: `aidlc` 0.28.1 → **0.28.2**, marketplace → **0.28.2**.

## [0.28.1] — 2026-07-23

### `aidlc` — drop the re-introduced no-op `Write(path)` rules (F48) + strict-JSON migration warning (F49)

Two follow-ups from 0.28 landing in a live poly workspace.

- **F48 — `Write(**/.env)` / `Write(**/.env.*)` removed from the template's `ask` list.** They warned
  at every session start (*"not matched by file permission checks — only `Edit(path)` rules are"*).
  File permission checks match only `Read(path)` and `Edit(path)`; `Edit` already covers every
  file-editing tool including Write, so **enforcement is unchanged** — this was noise, not a hole.
  Notably this is **a regression of F44**, which fixed the identical no-op in the `deny` list one cycle
  earlier: the same wrong assumption was reapplied to the `ask` list. Logged as its own finding so the
  pattern is visible; the archive is effectively the regression suite for config rules, and nothing
  mechanical enforces it yet.
- **F49 — migration guidance now names the format constraint.** Following 0.28's *"remove
  `Read(./.env)` and `Read(./.env.*)`"*, the rules were commented out with `//`. `settings.json` is
  **strict JSON**, so the file became unparseable and Claude Code **skipped it entirely** — including
  its `enabledPlugins` block, which silently disabled every AIDLC plugin for that project: all
  `/aidlc:*` commands vanished while `/plugin` still showed them installed. `/aidlc:init`'s migration
  step now says **delete outright, never comment out**, and requires a `JSON.parse` re-read after any
  settings edit. Prefer the programmatic init merge (which cannot introduce comments) over hand-editing.

**If you hand-migrated to 0.28 and lost the `/aidlc:*` commands:** your `.claude/settings.json` is
almost certainly malformed. Validate it (`node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"`),
delete any `//` lines, and drop any `Write(<path>)` rules.

- Versions: `aidlc` 0.28.0 → **0.28.1**, marketplace → **0.28.1**.

## [0.28.0] — 2026-07-23

### `aidlc` — env switch: reconcile it with the harness permission gate (fixes the switch)

0.27's `envFileAccess` switch didn't actually work in the field. A plugin user set
`envFileAccess: "ask"` and the harness still denied the read: *"denied by your permission settings."*
Root cause — **two permission layers that disagreed**:

- `.claude/settings*.json` is the harness's **hard gate**; a `deny` there always wins and a hook can
  never relax it (precedence is `deny → ask → allow`, and a PreToolUse hook can only *tighten*).
- The `envFileAccess` hook is **subordinate** to that gate.

So a hard `Read(.env*)` deny and an opt-in switch are mutually exclusive — and every project scaffolded
before 0.28 still carries that deny in its own `settings.json` (updating the plugin never rewrites a
project's already-copied settings). The switch was inert there. 0.27 had also removed the static deny
from the *template* without a replacement, leaving the default-deny resting entirely on the hook
(fail-open if the hook wasn't running) and the **Bash path** (`> .env`, `cat .env`) ungoverned.

The fix makes the layers agree, with the hook authoritative:

- **Settings template now lists env paths in `ask`, not `deny`** (`Read(**/.env)`, `Read(**/.env.*)`,
  `Edit(**/.env)`, `Edit(**/.env.*)` — corrected in 0.28.1, see F48).
  This is a fail-safe *floor*: even if the hook isn't running, touching an env file
  prompts — never silently readable, never hard-denied.
- **`env-guard.mjs` enforces the real default** — `"deny"` → **exit 2** (a hard block that bypasses
  the settings `ask`); `"ask"` → a prompt showing the exact diff. Unchanged from 0.27, now correct
  because no static deny sits above it.
- **`guard.mjs` mirrors the switch on the Bash path (new).** Reading or writing an env file from a
  shell command — `>`/`>>` redirects, `tee`/`cp`/`mv`/`install`/`dd`/`truncate`/`sed -i` writes, and
  `cat`/`type`/`Get-Content`/`head`/… reads — is blocked under `"deny"` and stepped past under `"ask"`
  (quote-aware, so a quoted `">.env"` in an echo string isn't mistaken for a redirect; git segments
  and `--env-file` passthrough are not caught). Fails closed. **+18 guard regression tests (52 → 70).**
- **`/aidlc:init` now migrates** an existing `settings.json` instead of blind-unioning: it drops the
  deprecated `Read(./.env)` / `Read(./.env.*)` denies and adds the `ask` rules, flagging the
  deny-list edit to the user for approval.

**Migration for existing projects:** update + reload the plugin, then either re-run `/aidlc:init`
(accept the settings merge) or manually remove `Read(./.env)` and `Read(./.env.*)` from that project's
`.claude/settings.json` `deny` array. The agent can't do it — `settings.json` is protected by
`protect-paths.mjs`. Until then the switch stays inert in that project.

- Versions: `aidlc` 0.27.0 → **0.28.0**, marketplace → **0.28.0**.

## [0.27.0] — 2026-07-23

### `aidlc` — env-file access is now an opt-in switch, not a hard wall

Previously the only `.env` rule was a static `Read(./.env)` / `Read(./.env.*)` **deny** — it blocked
reads (including `.env.example`) but, surprisingly, never blocked *writes*, and a static deny can
never be relaxed, so there was no way to let the pipeline maintain env files even when a user wanted
it to. This adds a real switch: **`pipeline.envFileAccess`** in `.claude/aidlc.config.json`.

- **New hook `hooks/scripts/env-guard.mjs`** (PreToolUse on `Read|Edit|Write`) owns all env-file
  access — `.env`, `.env.example`, `.env.local`, `.env.production.local`, … matched by basename
  anywhere in the tree (so poly product subfolders and monorepo `apps/*` are covered too, which the
  old root-only `./.env*` rule missed). `.envrc` and `.env-sample` are deliberately *not* env files.
- **`"deny"` (the default) hard-blocks** every read and every change to an env file (exit 2, with a
  reason telling the model to ask the user rather than edit the config itself).
- **`"ask"` opts in with the human in the loop** — the pipeline may touch env files, but *every*
  individual read/edit/write is surfaced for the user to approve or reject, and for an Edit/Write the
  confirmation prompt shows the exact diff/content. Flip it back to `"deny"` to lock env files again.
- **Fails closed.** A missing, unreadable, or malformed config — or any value other than the literal
  `"ask"` — is treated as `"deny"`.
- **Why a hook, not a static rule:** a static `deny` always wins and can't be conditionally relaxed
  (verified against the permission-precedence docs), so the two `Read(./.env*)` deny rules were
  **removed** from the project `settings.json` template and their protection folded into the hook.
  Non-env secret paths (`**/secrets/**`, `~/.ssh`, `~/.aws`) stay statically denied.
- Config schema (`envFileAccess`), both config templates (default `"deny"`), and the docs that stated
  the old behavior (`permissions-rationale.md`, `example-walkthrough.md`, the implementer agent's hard
  rules, the docs-writing skill) were all updated. **New regression suite `env-guard.test.mjs`** — 20
  cases covering deny/ask/allow, poly + monorepo paths, the `.envrc`/`.env-sample`/`foo.env`
  non-matches, and all three fail-closed config states.
- Versions: `aidlc` 0.26.0 → **0.27.0**, marketplace → **0.27.0**.

## [0.26.0] — 2026-07-19

### `aidlc` — guard resolves repo state from the `-C` target, and fails closed on a parse miss (F46)

With F45's `git -C` permissions working, poly runs reached the push step and were blocked by the
pipeline's own guard: *"push while on protected branch 'main'"* — while the target repo was on its
feature branch. `guard.mjs` resolved every repo-state check against the session cwd, which F42 pins
at the control plane, and the control plane sits on `main` permanently. Harmless in mono, where cwd
*is* the repo; in poly it blocked the one verb the pipeline needs, twice per item, on the *correct*
and safe case.

- **`-C` is now parsed and every repo-state check resolves against that repo** — `branchInfo()` and
  `stagedGitlinks()` alike. The latter is a third instance of the same bug: `git -C <repo> commit`
  was inspecting the control plane's index instead of the target's.
- **Fixed a fail-OPEN bypass found while reproducing.** Command identity was matched by regex over
  quote-blanked text, so an **unquoted** `-C` path containing a space split into two tokens, the
  pattern missed, and **every push check was skipped**: force-push, `push origin HEAD:main` and
  `filter-branch` all returned rc=0. The workspace root in the report is literally `D:\RTO Tool`, so
  this shape is reachable. Command identity now comes from a quote-aware tokenizer plus a real
  `git [global-opts] <subcommand> [args]` parse, and a subcommand slot landing on a path fragment
  triggers a fail-closed rescan rather than an allow.
- **Refspec checks parse actual refspecs** (`HEAD:main`, `:main`, `+main`, `--delete main`) instead of
  matching a protected name anywhere in the line. Quoted arguments are single opaque tokens, so a
  commit message mentioning `push` or `DROP TABLE` can never read as a command — the previous
  `stripQuotes` workaround is gone.
- **Blocking all pushes from a protected HEAD was kept deliberately.** The report suggested checking
  the refspec instead of the checked-out branch; refspec checking already existed and passes tests,
  and the HEAD rule is defence-in-depth that becomes correct — not over-broad — once HEAD is read
  from the right repo.
- **12 poly regression tests added** against a control-plane fixture whose path contains a space:
  legitimate `-C` feature push/status/commit allowed; `-C` push targeting `main`, `HEAD:main`,
  force-push and `filter-branch` blocked; bare push from the control plane still blocked; both
  unquoted-spaced-path bypasses blocked. **52/52 pass** (40 pre-existing, unchanged).

### `aidlc` — `wi-ado`: headless ADO runs land on the `az` CLI tier by design (F47)

The template allowlists no `mcp__*` tools, so a headless run can't call the ADO MCP server and falls
to `az boards`/`az rest` — which carried every tracker and PR operation successfully. The defect was
that this *read* as breakage: one run reported ADO as "gated". Tier 2 now states this is expected,
that ADO should be reported as working, and that a tier-1 denial alone must not escalate to the PAT
tier. **No allow rule was added** — an MCP allow rule needs the literal `mcp__<server>__` prefix as it
appears in that session, a plugin-provided server's exact prefix could not be confirmed here, and a
bare `mcp__*` allow rule is skipped with a warning. The skill tells the user how to read the real
name (`/mcp`, `--verbose`) instead.

- Versions: `aidlc` 0.25.0 → **0.26.0**, marketplace → **0.26.0**.

## [0.25.0] — 2026-07-19

### `aidlc` — make F43's `git -C` rules actually match (F45)

**0.24.0's fix did not work.** Every `Bash(git -C * <verb>:*)` rule shipped in F43 matched nothing, so
a poly run still could not execute a single git command — and because F42 pins cwd to the control
plane and F43 rules out `cd`, there was no permitted route to git at all. The rules were authored
against the permission docs and shipped without ever being executed; the docs are wrong on the two
points that mattered. Both constraints below were established by running headless probes against a
scratch workspace on CC 2.1.215, and the final rule set was verified by a 15-command battery against
the real template file:

- **`:*` does not compose with a mid-pattern `*`.** `Bash(git -C * add:*)` → denied;
  `Bash(git -C * add *)` → allowed. Every mid-glob rule now uses the `*` form. This single wrong
  suffix disabled all 14 allow rules *and* all 5 mirrored denies in 0.24.0.
- **A trailing ` *` does not match end-of-string**, contrary to the documented "space or
  end-of-string". This silently broke two things: bare `git -C <path> status` was blocked, and the
  deny for `git -C <path> push origin --force` **did not fire**. Mid-glob rules now use no-space `*`,
  and the bare-verb force-push denies gained exact-match spellings so the argument-less form is
  covered without swallowing `--force-with-lease`, which stays in `ask`.
- **Deny coverage is now verified directly, not inferred.** The failure modes are asymmetric: a dead
  allow rule blocks the run loudly, a dead deny rule is silent. Confirmed blocked in both bare and
  `-C` form: `push --force` (with args, and bare), `push origin --force`, `reset --hard origin/main`.
  Confirmed still allowed: `status`/`fetch`/`add`/`commit`/`branch` with and without trailing args,
  benign `push origin main`, and every mono bare-verb form.
- **A pre-existing deny gap is closed:** `Bash(git reset --hard origin:*)` never matched
  `git reset --hard origin/main` — the boundary after `origin` fails on `/`. Now `origin*`.
- `aidlc:run` §2.5 records both matcher constraints inline, so the next editor of those rules doesn't
  rediscover them, along with the asymmetry that makes the deny half untestable by watching a run
  succeed.
- Versions: `aidlc` 0.24.0 → **0.25.0**, marketplace → **0.25.0**.

## [0.24.0] — 2026-07-19

### `aidlc` — unblock poly runs at the first git call (F43) + drop no-op `Write(...)` denies (F44)

F42 fixed `/aidlc:sprint` launching in a poly workspace and, in doing so, moved the wall one step
later. Pre-F42 the run couldn't start; post-F42 it starts, resolves the item, routes to the repo —
and then blocks on **every** git call. The launch cwd is now the control plane and a session can't
change its cwd, so poly git calls are necessarily `git -C "<repo path>" <verb>`, whose permission
prefix matches **none** of the template's bare-verb rules (`Bash(git status:*)`, …). Every poly item
hit this identically, before any write.

- **Template allows the poly git verbs in `-C` form**, alongside the bare forms mono still uses.
- **The denies are mirrored in `-C` form, not left behind.** Widening allow without widening deny would
  have let `git -C <path> push --force` bypass `Bash(git push --force:*)`. Bash rules support
  mid-pattern wildcards, so the mirror is exact: `Bash(git -C * push --force:*)`, `… -f`,
  `… reset --hard origin`, plus `Bash(git -C * rebase:*)` in `ask`. A bare `Bash(git -C:*)` was
  rejected for precisely the bypass it would open.
- **A pre-existing deny gap is closed while here:** `Bash(git push --force:*)` never matched
  `git push origin --force`, where the flag follows the remote. Added `Bash(git push * --force:*)`
  and `-f`, in both bare and `-C` form.
- **Added `Bash(az rest:*)`** — `wi-ado` needs it for the work-item-type states API and it was absent
  from the template entirely. (Observed symptom: `az boards` worked, `az rest` didn't.)
- **`aidlc:run` §2.5 now states the routing mechanism per command family** rather than the ambiguous
  "cwd = `<repo.path>`" that produced the mismatch: git → `git -C`; npm/docker/test/lint →
  `cd "<path>" && <cmd>`; `gh`/`az repos` → pass the repo explicitly. **`cd … && git …` is explicitly
  ruled out for git**: Claude Code prompts for any compound command that `cd`s into a different
  directory and then runs git — regardless of the allowlist — since git can execute that directory's
  hooks. Mono is unaffected; its cwd already is the repo.
- **Dropped the template's two `Write(...)` denies (F44).** File permission checks match only
  `Edit(path)`/`Read(path)`; a `Write(path)` rule is accepted but never matched, so each one printed a
  startup warning on every headless run while enforcing nothing. The adjacent `Edit(...)` denies
  already cover both settings files, so enforcement is unchanged.
- Versions: `aidlc` 0.23.0 → **0.24.0**, marketplace → **0.24.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.23.0] — 2026-07-19

### `aidlc` — own the control plane's git story in a polyrepo workspace

A poly workspace is a control-plane git repo with other git repos nested inside it as subfolders.
That arrangement has one sharp edge, and nothing in the framework addressed it: if a product repo
isn't ignored, a single `git add -A` at the control plane stages it as a **mode-160000 gitlink** — a
submodule reference with no `.gitmodules` entry. Git reports no error, the commit succeeds, and the
repo clones with an empty directory where the product code should be. `/aidlc:run` reaches this path
in normal operation, because `control-plane` is a first-class routing target that branches and commits
at the workspace root.

- **The project template now ships a `.gitignore`** (it previously shipped none). It ignores product
  repo checkouts via a managed `# AIDLC:REPOS` block, plus machine-local state — `settings.local.json`,
  `.aidlc/sprint-*.json` (pids and absolute paths), `staged-claude/`, logs. Durable state stays
  tracked: `backlog/`, `.aidlc/runs/`, `extensions.json`, `aidlc.config.json`.
- **`/aidlc:init` Step 4.4 now specifies the whole posture** instead of one ambiguous sentence: the
  control plane **should** be its own git repo (rule-0 routing has nowhere to commit otherwise, and the
  backlog carries no history), repos are ignored by **explicit path, never a blanket `*/`** (a
  root-level `docs/` or `scripts/` must stay tracked), and the result is **verified** with
  `check-ignore` + `status --porcelain` rather than assumed. Step 2.1 no longer says the control plane
  being a repo is optional.
- **`/aidlc:repo add` writes the ignore line before creating the folder** (new §3b), so a new repo is
  never visible to the control-plane index even briefly.
- **Ignored, not submodules** — stated explicitly in `docs/architecture.md` D8, because it's the
  obvious alternative and it's wrong here: a submodule pins each repo to a commit recorded in the
  control plane, destroying the independent release cadence D8 requires.
- **`guard` hook backstop.** A `git commit` that would write an unregistered gitlink is now blocked
  (exit 2), with the remedy in the message. Paths registered in `.gitmodules` are real submodules and
  pass untouched; the check runs only for actual `git commit` invocations, reads the index that git
  has already written, and returns "allow" on any uncertainty. 8 regression tests added (40/40 pass),
  including one asserting the prescribed remedy actually clears the block.

## [0.22.0] — 2026-07-19

### `aidlc` — fix `/aidlc:sprint` being dead on arrival in a polyrepo workspace (F42)

In a poly workspace every `/aidlc:sprint` launch failed instantly and **silently**: each item's
worktree run exited within seconds at **rc=0** with a 28-byte log reading only
`Unknown command: /aidlc:run` — no run files, no commits, no board writes, and nothing an
exit-code check would catch.

- **Root cause: the launch cwd, not trust.** Sprint §2 assumed a git worktree is a self-contained
  AIDLC workspace. That holds in mono (the repo *is* the workspace, so `.claude/` and `backlog/` are
  tracked and ride into the worktree) but never in poly, where AIDLC lives entirely at the control
  plane — `.claude/settings.json` (plugin enablement + permissions), `.claude/aidlc.config.json`
  (tracker + `repos[]`), `backlog/`, `CLAUDE.md` — and the product repos have no `.claude/` at all.
  A worktree of one is a bare project with no `/aidlc:*` commands. The existing trust step was
  necessary but not sufficient: **plugin enablement is a `settings.json` concern**, while
  `hasTrustDialogAccepted` in `~/.claude.json` only clears the trust prompt.
- **Poly now launches from the control plane with the cwd unchanged — no worktree.** This costs
  nothing, because `/aidlc:run` already routes every git/branch/commit/push/PR step into
  `workspace.root/<repo.path>` (`aidlc:run` §2.5). Items in different repos are isolated by
  construction, so per-repo worktrees were adding contention risk without adding isolation. Seeding
  the worktree instead was rejected: a product-repo worktree can never be a complete AIDLC workspace
  (no `backlog/` for the markdown adapter, and `repos[]` paths are workspace-relative), so seeding
  would mean maintaining a second, degraded workspace shape.
- **Mono keeps worktrees** — there the worktree genuinely is the workspace — along with the trust
  step, plus a new note that `.claude/settings.local.json` is gitignored and therefore does *not*
  ride into a worktree (seed a copy if enablement/permissions live only there).
- **New invariant (§1.3): one in-flight item per working tree.** Without per-item worktrees, two poly
  items resolving to the same repo — or two `control-plane` items — must serialize; the second queues.
- **New §2b preflight** — before launching anything, verify the launch cwd deterministically by file
  read: `aidlc.config.json` present, `aidlc` enabled for that cwd (project or user scope), marketplace
  known, and (mono) the worktree trusted. A failure names the missing piece instead of launching.
- **New §2c launch verification — rc=0 is no longer accepted as "started."** A launch counts only on a
  run file appearing or real pipeline output. The first item runs as a **canary**: if it is dead on
  arrival, the sprint **aborts** and prints the log verbatim rather than burning the remaining slots
  on an identical environment fault.
- Docs updated to stop describing worktree-per-item as universal: `docs/architecture.md` (D7),
  `docs/adoption-guide.md` §7, `docs/user-guide.md` (interrupted sprint), `docs/example-walkthrough.md`,
  README command table.
- Versions: `aidlc` 0.21.0 → **0.22.0**, marketplace → **0.22.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.21.0] — 2026-07-18

### `aidlc` — requirements drive the architecture: init-lite + bootstrap infers topology/stack

Reworks the `init` ↔ `bootstrap` boundary so a greenfield project's **repo topology, stack, and
monolith-vs-microservices are derived from the requirements**, not answered blind before them. Previously
`/aidlc:init` interrogated the user for workspace layout, per-repo stack, split tier and CI **up front** —
which both blocked getting to `/aidlc:bootstrap` and asked the *wrong actor* (the user, with no
requirements read yet) what the requirements should decide.

- **`/aidlc:init` gains a deferred (lite) path.** A new first question — "how will this project be
  populated?" — offers **"from a requirements document/brief."** Choosing it collects only the essentials
  (project key/name, tracker + connection, verification cadence), writes a config with the architecture
  left **pending** (`architecture.status: "pending"`, no `workspace.layout`, `repos: []`, blank `stack`),
  and **skips the topology/stack questions and the tooling/structure/CI scaffolding** (Step 4.5–4.7).
  The "I know my setup / existing code" path keeps the full flow unchanged.
- **`/aidlc:bootstrap` gains a Phase 2.0 architecture-determination step.** After extracting the
  requirements, when the config is pending/unset it **infers the architecture** — style (monolith /
  modular-monolith / microservices), topology (mono/poly + repos with roles), stack, and crossRepoSplit —
  **biased to the simplest that fits (YAGNI):** it defaults to a single-repo modular monolith and escalates
  to microservices/poly only on real signals (independent scaling/deploy, distinct bounded contexts,
  multiple client surfaces, separate teams, a component needing a different runtime). It then **writes the
  resolved shape to `.claude/aidlc.config.json`** and shapes the work-breakdown to match. A human-authored
  architecture is honored, never overwritten.
- **Decision mode: silent auto-decide.** Per the chosen mode, bootstrap resolves and writes the
  architecture **without a dedicated confirmation gate** — but the derived topology/stack/style is
  **surfaced in the Phase 4 plan review** (with its rationale) before any tracker item is created, so a
  wrong mono/poly or over-eager microservices call is still catchable at the one gate that already exists.
- **Schema:** added an optional top-level `architecture` block (`status` pending|resolved, `style`,
  `resolvedBy`, `rationale`) to `docs/aidlc.config.schema.json` — the pending→resolved signal between
  init and bootstrap, and a home for the recorded architecture style (which the config didn't capture
  before).
- Versions: `aidlc` 0.20.1 → **0.21.0**, marketplace → **0.21.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.20.1] — 2026-07-18

### `aidlc` — drop the unused, always-erroring `github` MCP server from the bundle

- **Removed the bundled `github` MCP server** (`@modelcontextprotocol/server-github`) from
  `plugins/aidlc-core/.mcp.json`. Its config referenced `${GITHUB_PERSONAL_ACCESS_TOKEN}`, so **every
  project that didn't set that token got a plugin load error** — *"Invalid MCP server config for
  'github': Missing environment variables"* — even ADO-only or markdown-only projects that never
  touch GitHub. The plugin **never called the github MCP**: all GitHub operations already go through
  the **`gh` CLI** (`gh pr create` / `gh pr checks` / `gh release create` / `gh api` in
  `git-workflow`, `status`, `ci-cd`, `release`, and the devops agent). So the server was pure
  liability — bundled but unused, and forcing a token requirement on everyone. Removing it loses zero
  capability and clears the error for all token-less projects.
- **Opt back in per project** if you want the github MCP's tools available for ad-hoc use: add the
  server to your project's own `.mcp.json` with the token set (`"env": { "GITHUB_PERSONAL_ACCESS_TOKEN":
  "${GITHUB_PERSONAL_ACCESS_TOKEN}" }`). The plugin's own flows don't need it.
- The remaining bundled MCP servers are all ones the pipeline actually uses: `context7` (docs),
  `playwright` (UX rendering), `atlassian` (Jira via `wi-jira`), `azure-devops` (ADO via `wi-ado`).
- Versions: `aidlc` 0.20.0 → **0.20.1**, marketplace → **0.20.1** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.20.0] — 2026-07-17

### `aidlc` — new `/aidlc:bootstrap`: whole-backlog setup from a requirements document

- **New skill `aidlc:bootstrap`** — a **bulk front door** that turns a client's requirements (an
  uploaded Word/PDF, a chat brief, or both) into a complete, populated backlog in one reviewed pass:
  ingest → work-breakdown (Epic→Feature→Story→Task, every item described, every story ≥3 testable
  AC) → contribution-aware team assignment → capacity-planned sprints → create it all in the active
  tracker. It sits alongside `/aidlc:intake` (one requirement at a time) and `/aidlc:init` (which
  must run first to seed the config). Adapted from the standalone `azure-devops-planner` skill built
  for the claude.ai web app, but **moulded to the AIDLC architecture** rather than copied:
  - **Tracker-agnostic via the adapter.** The original was ADO-only and pushed via a self-contained
    HTML file with an **embedded PAT** (a workaround for the web sandbox, where `dev.azure.com` is
    unreachable and users may lack a CLI). Bootstrap instead routes every write through
    `aidlc:work-items` → the source adapter, so the same command populates **ADO, Jira, or the
    markdown backlog**, with full **write-verification**, dedup against the existing board, and
    provenance stamping (`bootstrap` label + dated note). **No HTML file, no token in a file.**
  - **Inputs the platform already owns are not re-collected** — no ADO URL, no process template, no
    PAT prompt: org/project come from `aidlc.config.json`, the adapter authenticates itself, and
    `aidlc:wi-ado` auto-detects the process and owns type/field mapping. Repo topology (mono/poly +
    `crossRepoSplit`) is read from config, not re-asked.
  - **Net-new capability kept** — document ingestion (PDF/DOCX via `pdftotext`/`pandoc`), a
    **contribution-aware team model** (Primary/Secondary/Guidance + %, with assignment rules that
    keep critical-path work off part-time contributors), FTE **capacity-based sprint planning**, and
    work-stream filtering. The team roster is **per-run only** — used to plan and assign this pass,
    not persisted to config. Ships `scripts/parse_team_file.py` (CSV/Excel roster importer) and
    `references/work_item_types.md` (per-template hierarchy/field reference for planning).
- **`aidlc:wi-ado` — added a PAT+REST last-resort tier.** The ADO write path is now an explicit
  three tiers: **`azure-devops` MCP → `az boards` CLI → PAT+REST (off by default)**. The PAT tier
  fires only when neither MCP nor `az` is reachable **and** the user supplied a token; it reads the
  PAT from the environment (never writes it to a file, never bakes it into a generated HTML pusher)
  and is bound by the identical write-verification and per-type status-category rules as the other
  tiers. This gives the standalone skill's PAT approach a home as a genuine escape hatch without
  regressing the MCP-first posture.
- Versions: `aidlc` 0.19.0 → **0.20.0**, marketplace → **0.20.0** (`aidlc-stack-web` 0.10.0 /
  `aidlc-ux` 0.4.0 unchanged).

## [0.19.0] — 2026-07-17

### Marketplace-wide rename: **SDLC → AIDLC**

- **The framework is now AIDLC (AI Development Life Cycle).** A full, mechanical rebrand ahead of the
  first public/remote release. Nothing about the behavior changed — only the name:
  - **Commands:** `/sdlc:*` → **`/aidlc:*`** (e.g. `/aidlc:run`, `/aidlc:next`, `/aidlc:status`,
    `/aidlc:init`). Plugin/command identifiers are lowercase per Claude Code's rules; **AIDLC** is the
    brand used in display names, titles and docs.
  - **Plugins:** `sdlc` → **`aidlc`**, `sdlc-stack-web` → **`aidlc-stack-web`**, `sdlc-ux` →
    **`aidlc-ux`** (directories `plugins/aidlc-*`). Skill cross-references `sdlc:*` → **`aidlc:*`**;
    agents `sdlc-*` → **`aidlc-*`**; bundled MCP tool prefix becomes `plugin_aidlc_*`.
  - **Per-project state:** the state dir `.sdlc/` → **`.aidlc/`** and config `sdlc.config.json` →
    **`aidlc.config.json`** (+ `aidlc.config.poly.example.json`, `docs/aidlc.config.schema.json`). This
    is a **breaking change for existing projects** — an `.sdlc/`/`sdlc.config.json` project must rename
    those two paths (the D:\Authentication dogfood workspace was migrated as part of this release).
  - The marketplace `name` stays **`bee-logical`** (the company marketplace); the repository is
    published as **`AIDLC`**. Install: `/plugin marketplace add <owner>/AIDLC` → `/plugin install
    aidlc@bee-logical`.
- Versions: `aidlc` 0.18.1 → **0.19.0**, `aidlc-stack-web` 0.9.0 → **0.10.0**, `aidlc-ux` 0.3.0 →
  **0.4.0**, marketplace → **0.19.0**.

## [0.18.1] — 2026-07-17

### `aidlc` — dogfood inbox stays a short live queue (F41)

- **F41 — the maintainer now prunes shipped (`pulled:F<n>`) entries from a consuming project's dogfood
  inbox once their batch merges.** The inbox is a *queue*; the plugin's `docs/dogfood-findings.md` +
  CHANGELOG are the permanent *record*. Leaving drained entries in the inbox made every future run in
  that project re-read an ever-growing log for no benefit — a recurring token cost. `aidlc:dogfood` now
  documents the prune step (a second maintainer exception to "append only") and the inbox header
  template states the queue is cleared after shipping. Applied to the Authentication inbox (its
  F34–F40 entries pruned; record preserved here). Versions: `aidlc` 0.18.0 → **0.18.1**, marketplace →
  **0.18.1** (`aidlc-stack-web` 0.9.0 / `aidlc-ux` 0.3.0 unchanged).

## [0.18.0] — 2026-07-17

### Dogfood batch F34–F40 (Authentication / Identity Platform, Cycle 3) — reliability hardening

Seven findings drained from the Authentication dogfood inbox, all in `aidlc` (core orchestration, agent
contracts, adapters). This batch is about the *reliability of the pipeline itself*: trustworthy
subagent hand-offs, no silently-truncated backlog sweeps, a clean approval path, a coherent run-file
archival story in remote/poly, and an encoded CI-parity recipe. Designed and implemented together.
Versions: `aidlc` 0.17.0 → **0.18.0**, marketplace → **0.18.0** (`aidlc-stack-web` 0.9.0 / `aidlc-ux`
0.3.0 unchanged). Full record: `docs/dogfood-findings.md`.

#### `aidlc` — subagent finish-contract (F37, F40 — a cross-agent recurrence)

- **F37 / F40 — a subagent must never return on a pending self-launched background task.** The
  implementer (F37), then the devops agent (F40), each returned a bare "still running — I'll wait for
  the background-task notification" instead of a `COMPLETE`/`BLOCKED` verdict, leaving uncommitted state
  (a half-regenerated lockfile, un-ticked plan, un-archived run file) for the orchestrator to discover
  and finish. A shared **`## Finish contract`** now sits on **all nine agents + the agent template**:
  block on the background task to a terminal state and act on the result, or return an explicit
  `BLOCKED`/`INCOMPLETE` verdict enumerating every pending task and uncommitted path — order is always
  **verify → commit → report**, synchronously. devops additionally must **poll a CI/pipeline run to a
  terminal state itself**. Orchestrator side (`run` invariants): a non-verdict is **not** a phase result
  — ground-truth the working tree, drive the remaining deterministic steps, and never blindly re-resume
  a yielding agent.

#### `aidlc` — backlog sweeps no longer silently truncate (F34)

- **F34 — full-backlog operations count-first and page to completion.** `groom` opened its sweep at
  `query({status:"todo", limit:25})`; on a ~120-item backlog that refined ~20% and reported "groomed."
  New **_Full-backlog sweeps_** contract in `work-items`: `limit` is a **page size, not a silent cap** —
  a full sweep counts the total first, then pages to completion or **states the cap out loud**. All
  three adapters updated (`wi-ado` batch-fetches the full WIQL id list; `wi-jira` pages
  `startAt`/`maxResults` and reads `total`; `wi-markdown` returns all matches when no `limit`), and
  `groom`'s sweep protocol now counts-then-covers.

#### `aidlc` — grooming approval path (F35)

- **F35 — gated actions are applied by the coordinator, not a re-dispatched subagent.** A fresh analyst
  subagent correctly refused to act on the coordinator's *claim* that the user had approved — a peer's
  assertion of consent is not consent. `groom` now states it: the approval gate lives in the coordinator
  turn, the analyst sweep is **propose-only** for gated actions, and the **coordinator itself** applies
  the approved decompositions / splits / priority / routing writes (each read-back-verified).

#### `aidlc` — run-file archival in remote/poly (F36, F39)

- **F36 — blocked→resolved runs get a real archival path.** A run resolved via a follow-up PR could
  ride into `main` still stamped `phase: blocked` and then linger as a blocked *active* run forever,
  because archiving it needed a forbidden direct-to-`main` commit. `run` §10 now folds the archive into
  the **resolving PR** so it merges in already archived; `run-state` documents the remote post-merge
  fallback (a `chore(aidlc): archive` **branch → PR**, never a direct push to the protected branch — the
  guard blocks that correctly and stays untouched).
- **F39 — batch archival: cost warned, husky unblocked, empty-branch trap closed.** `status` post-merge
  cleanup now **warns of the per-repo PR cost** ("N run files across M repos → M PRs") before starting;
  the framework's own `.aidlc/**`-only bookkeeping commits use **`git commit --no-verify`** so a
  repo-local husky/lint-staged hook (which assumes `node_modules`) can't block them; and `git-workflow`
  now requires **verifying a commit actually landed before pushing** (a hook-aborted commit otherwise
  leaves an empty pushed branch).

#### `aidlc` — CI-parity recipe (F38)

- **F38 — encoded local CI-parity recipe for a `file:`-sibling consumer.** When the orchestrator must
  ground-truth a consumer's CI gate (e.g. after a non-verdict), a `file:../sibling` consumer needs a
  **two-step install** — `npm ci` in the sibling first (so its exported eslint/tsconfig/depcruise
  configs resolve their own deps), then the consumer — run in the CI image, with **each gate step's exit
  code standing on its own** (no `&& echo OK` tail that fakes a green). Shipped in `aidlc:ci-cd`
  (_Local CI-parity for a `file:`-sibling consumer_), referenced from `run` §7.

## [0.17.0] — 2026-07-14

### `aidlc` — poly cross-repo split tier (`story` default, `task` supported)

- **New `workspace.crossRepoSplit` config (`"story"` default | `"task"`)** — makes explicit *which
  work-item tier is the single-repo runnable leaf* in poly. Epics/Features always span repos; the leaf
  (one repo = one branch = one PR) is either a **Story** (`story`: a Feature fans out to per-repo
  Stories, each Story one repo, Tasks its breakdown — the recommended default, native to ADO's
  Epic→Feature→Story→Task and forbidden Story→Story) or a **Task** (`task`: a User Story is a cross-repo
  **umbrella** of user value, its child Tasks the per-repo leaves, rolled up on completion). Both are
  first-class — pick the one your board is authored for. Canonical definition in `aidlc:work-items` →
  *Cross-repo split tier*; a worked "Profile page" example (both tiers) in the user-guide §1a.
- **The pipeline honors the knob end-to-end.** `run` §2 treats an umbrella Story (task mode) as a
  coordination parent — runs its per-repo Task children, rolls the Story up, and recognizes existing
  children instead of re-decomposing; `run` §2.5 no longer flags a cross-repo Story as an error in
  `task` mode (it's the expected umbrella) while keeping the *fix-it* path in `story` mode.
  `intake`/`groom`/`planning` propose the shape matching the configured tier. The "non-idiomatic
  umbrella" language is gone — task-tier is a supported convention, not a grudging fallback.
- Versions: `aidlc` 0.16.0 → **0.17.0**, marketplace → **0.17.0** (`aidlc-stack-web` 0.9.0 / `aidlc-ux`
  0.3.0 unchanged).

## [0.16.0] — 2026-07-14

### `aidlc` — plugin self-feedback (dogfood) channel

- **New `aidlc:dogfood` skill + `pluginFeedback` config.** A portable way for the pipeline to record
  friction with **the plugin itself** — gaps, wrong/missing guidance, steps it had to work around, a
  per-run step it had to save to memory, a broken shipped template (all distinct from *project* bugs) —
  as structured, append-only entries in a local inbox (`pluginFeedback.inbox`, default
  `.aidlc/plugin-feedback.md`). Gated behind `pluginFeedback.enabled` (default **false**, so normal
  projects stay quiet); a project used to dogfood the plugin turns it on. The `run` orchestrator
  captures friction (its own + friction surfaced in agent reports) via the skill and continues — it
  never blocks delivery. The maintainer drains the inbox into `docs/dogfood-findings.md` by reading it
  directly from disk and marks each entry's `status:` (`pulled:F<n>` / `dismissed`), so findings flow
  from a test project to the plugin without a human relaying responses by hand. Versions: `aidlc`
  0.15.0 → **0.16.0**, marketplace → **0.16.0** (`aidlc-stack-web` 0.9.0 / `aidlc-ux` 0.3.0 unchanged).

## [0.15.0] — 2026-07-14

### Dogfood batch F17–F33 (Authentication / Identity Platform, Cycle 2)

Seventeen findings from continued dogfooding on the same polyrepo + Azure DevOps build, now first
exercising the **remote/PR** integration path (the six `bee-auth-*` repos flipped to `git.mode:
remote`) plus real CI, a shared-config poly pattern, and the first security-critical design phase.
Designed and implemented together. Versions: `aidlc` 0.14.0 → **0.15.0**, `aidlc-stack-web` 0.8.0 →
**0.9.0**, `aidlc-ux` unchanged (**0.3.0**), marketplace → **0.15.0**. Full record:
`docs/dogfood-findings.md`.

#### `aidlc-stack-web` — tooling baseline & templates

- **F17 — the tooling baseline now ships a `.gitattributes`** (`* text=auto eol=lf` + binary rules).
  Stops CRLF/LF churn on Windows checkouts and keeps a Windows dev byte-identical to a Linux CI runner,
  so Prettier's `endOfLine: lf` no longer misreports CRLF as a diff (the false "files are CRLF" finding
  that cost a correction cycle). Added to the tooling README, `init` Step 4.5, and the
  `project-structure` repo-scaffold checklist (sibling of F14). The plugin repo itself also gains a
  root `.gitattributes`. Agent note added (`debugging`, checklist): confirm with `git ls-files --eol`
  before ever logging a line-ending finding.
- **F18 — shipped templates are now Prettier-clean, and scaffolds start format-clean.** Reformatted the
  template code files that genuinely failed `prettier --check` (long comments/calls prettier wraps);
  `init` and the repo-scaffold checklist now run `prettier --write .` **repo-wide** at scaffold so a
  fresh repo passes its own `format` gate at first merge; the enforced gate is stated as
  `prettier --check .` (repo-wide, not just `src/`), and must include the format step, not only eslint.
- **F21 — optional husky v9 + lint-staged pre-commit layer.** New `templates/tooling/husky/pre-commit`
  + `lint-staged.config.mjs` (eslint `--fix` + prettier `--write` on staged files). Gated behind an
  `init` prompt (opinionated-but-optional). `prepare` documented **CI-safe** (`husky || true`) because
  bare `husky` exits **127** on `npm ci` in a CI container or a `file:../` sibling checkout that lacks
  it. Poly pattern documented: the shared-config repo owns the preset, the others re-export it.
- **F26 — the three dependency-cruiser profiles set `enhancedResolveOptions`** (`exportsFields` +
  `conditionNames: [import, require]` + `mainFields`) so ESM `exports`-map subpaths (the poly
  shared-config pattern, `@beelogical/dev-config/lint-staged`) resolve deterministically across
  versions/conditions. *Verified:* dependency-cruiser 17.4.3's defaults already resolve the common
  case, so this is a robustness/explicitness fix (requires the `>= 17` floor, F30), not a change that
  flips a reproducible failure on current versions — framed accordingly in the profile comments.
- **F27 — the eslint baseline can now lint `.cjs` in an ESM package.** Split the config-files override:
  `**/*.cjs` gets `sourceType: "commonjs"` + Node globals and the require-style rules off, so
  `module`/`require`/`__dirname` no longer trip `no-undef`/`no-require-imports`. *Verified* end-to-end:
  the plugin's own shipped `.dependency-cruiser.*.cjs` now pass the baseline (the old config errored
  `'module' is not defined`).
- **F28 (design-time) — `project-structure` documents cross-repo dependency consumption.** In
  poly+remote a shared package must be **published** (required for transitive/built deps) or resolved
  via **multi-repo checkout** (leaf config deps only); an unpublished `file:../sibling` link is
  local-only and fails isolated single-repo CI.
- **F30 (floor) — `dependency-cruiser` is pinned `@^17`** everywhere the plugin adds it
  (`project-structure`, `nestjs`, `init`), with the why: `< 17` silently no-ops on `.ts` and passes the
  gate green while enforcing nothing.
- **F33 — `nestjs` testing guidance covers ESM-only deps consumed via `import()`.** A CJS repo needs
  `NODE_OPTIONS=--experimental-vm-modules` (cross-platform via `cross-env`) for jest to execute the
  dynamic ESM import, plus the `testRegex`-match gotcha for new e2e files.

#### `aidlc-stack-web` — CI templates (new)

- **F24 (templates) — new `templates/ci/`**: `azure-pipelines.yml` + `github-actions-ci.yml` (+ README)
  running the **same** deterministic gate as the local run (typecheck → lint → format → boundaries →
  build → test). Parameterized for a **self-hosted pool** (F25), **cross-platform lockfile** guidance
  (F29), a **non-empty-graph assertion** (F30), and a commented **multi-repo-checkout** block (F28).

#### `aidlc` — board fidelity (ADO)

- **F19 — parents roll up to in_progress at first-child-start.** `run` §3 transitions a still-`todo`
  parent Feature/Epic → in_progress when its first child starts (guards: only todo→in_progress, never
  pull back a later state, one tier per run, respect tracker rollup automation). Documented in
  `work-items` → *Parent rollup*; the proactive complement to F15 close-time reconciliation.
- **F20 — ADO transitions are type-aware via state category.** `wi-ado` resolves a canonical status to
  the target state through the item type's ADO **state category** (Proposed/InProgress/Resolved/
  Completed/Removed) rather than a flat global name, fixing the Epic ("In Progress") vs Story/Feature
  ("Development in Progress") divergence; the F7/F15 self-heal now keys on `(type → category → real
  state name)`; `init` populates a **per-type** `statusMap` from the work-item-type states API.
- **F22 — remote-mode ADO gets an encoded post-merge close.** ADO does **not** auto-close a linked item
  on PR merge — so `status` post-merge cleanup transitions the item → done + type-aware parent rollup,
  the ground-truth reconciliation flags "**PR merged but item still open**", and `run` §10 + `wi-ado`
  document that the DONE transition is a required post-merge step, not rediscovered per run.
- **F23 — poly+remote per-repo run files archive on the branch pre-merge.** `run` §10 `git mv`s the
  completed per-repo run file into `runs/archive/` as the final branch commit so it rides into `main`
  **already archived** — avoiding the forbidden post-merge direct-to-`main` commit that left run files
  lingering as "active." `run-state` documents the mode/layout matrix; `status` surfaces
  done-but-awaiting-merge archived runs.

#### `aidlc` — remote mode, CI & shared-package poly

- **F24 (warn) — remote mode is never silently ungated.** `init` (Step 4.7) and `status` (Step 1.6)
  warn when a `mode: remote` repo has no detectable CI / required-check policy, and `init` offers to
  scaffold the matching CI template per remote repo — remote mode's promise (CI enforces the gate
  before merge) is otherwise silently unmet.
- **F25 — `ci-cd` documents the fresh-org Azure gotchas.** Hosted parallelism can be unavailable on a
  new org (`resourceLimit: null` → `vmImage` pipelines can't run) with the request link and a
  self-hosted `pool:` fallback; `Checkpoint.Authorization` may be a missing `pipelinePermissions` grant
  at the **queue** id (distinct from pool/repo) — not always a benign wait.
- **F28 (CI + pilot) — `ci-cd` documents cross-repo package resolution under isolated CI** (publish vs
  multi-repo-checkout; `file:` siblings are local-only) and `run` (poly pilot) requires validating **at
  least one true consumer's** CI before fanning a shared-dependency pattern out — the dependency repo's
  own green never exercises the consumers' resolution path (the false-green pilot).
- **F29 — cross-platform lockfile.** `ci-cd` diagnosis + `init` prescribe generating/refreshing the
  committed `package-lock.json` in the **Linux context CI uses** (a `node:22` container), since a
  Windows/macOS-generated lock can be unsatisfiable by Linux `npm ci` (platform-specific optional deps).
- **F30 (assertion) — the CI gate asserts a non-empty module graph** (fails if depcruise analyzed 0
  `.ts` files), so a future silent no-op can't pass green. Carried by both CI templates and documented
  in `ci-cd`.
- **F31 — reproduce CI failures in the CI image before iterating.** `ci-cd` + `debugging` prescribe
  `docker run`-ing the CI runtime with the isolated single-repo checkout + `npm ci` layout to validate
  a fix green **before** slow serial remote cycles — essential for poly `file:`-sibling (F28) and
  cross-platform-lock (F29) failures that never reproduce in the local workspace.
- **F32 — doc-verifying subagents get the bundled Context7 MCP.** `aidlc-architect`, `aidlc-researcher`
  and `aidlc-security` now list the plugin-scoped Context7 tools (`resolve-library-id`, `query-docs`) —
  and `WebFetch` — in their tool grants, with an explicit sanctioned fallback documented if the harness
  can't pass the MCP through to a subagent at runtime, so version/API checks stop degrading to
  registry-only.

## [0.14.0] — 2026-07-12

### Dogfood batch F1–F16 (Authentication / Identity Platform, Epic 1)

Sixteen findings from a real end-to-end dogfood on a polyrepo + Azure DevOps + local-git-mode build,
designed and implemented together. Versions: `aidlc` 0.13.1 → **0.14.0**, `aidlc-stack-web` 0.7.1 →
**0.8.0**, `aidlc-ux` 0.2.1 → **0.3.0**, marketplace → **0.14.0**. Full design record:
`docs/dogfood-findings-archive.md`.

#### `aidlc` — poly workspace modeling

- **F1 — cross-repo work is modeled at authoring time, not improvised at run time.** `intake`, `groom`
  and `planning` now enforce the poly invariant *1 story = 1 repo*: a story/task spanning repos is
  authored as a **Feature → per-repo child Stories** (Feature-tier preferred because ADO forbids
  Story→Story parenting). `run` §2.5 formalizes the run-time safety net (decompose-and-run /
  decompose-defer / single-repo-subset) with the ADO hierarchy constraint spelled out.
- **F2 — undeclared repos get declared, not mis-routed.** New **`/aidlc:repo add <name>`** command
  declares a repo in `repos[]` **and** bootstraps the folder (`git init` + base commit + optional
  tooling/structure baseline). `work-items` routing and `run` §2.5 now offer to declare an undeclared
  repo instead of silently folding the work into another one.
- **F3 — `init` asks mono-vs-poly explicitly.** Auto-detect is a *proposal* only; a greenfield poly
  workspace (no sub-repos yet) no longer silently collapses to mono.
- **F4 — `init` bootstraps greenfield repos.** Poly `init` offers to `git init -b <default>` + base-
  commit each declared repo so the pipeline can branch into it immediately (the "first story creates
  the repos" chicken-and-egg), or documents the exact commands if skipped. Shared with `/aidlc:repo`.
- **F8 — `control-plane` is a first-class routing target.** Workspace-level items (README, cross-repo
  docs, control-plane config) resolve deterministically to the workspace root instead of ad-hoc.

#### `aidlc` — tracker robustness

- **F5 — ADO "connected" ≠ "authenticated".** `wi-ado` documents the launch-env root cause
  (`ADO_MCP_ORG` + `az login` must be present in the shell that *launches* Claude Code; mid-session
  installs need a relaunch); `status` adds a **tracker doctor** that distinguishes "MCP process up" from
  "ADO reachable + authenticated" and prints the remediation; the adoption guide gains a callout.
- **F7 — `init` populates ADO `statusMap` from the board's real states** (customized boards like
  *Development in Progress / Ready for QA*), instead of assuming Agile defaults or leaving it empty.
- **F15 — re-decomposition no longer drops requirements or orphans originals.** `work-items` gains a
  **Re-decomposition & supersession** contract: an **AC coverage map (old→new)** flags any uncovered
  criterion; superseded originals are linked + moved to a **type-appropriate terminal state** (probe
  per work-item type — `Removed` may exist for a Story but not a Task — never hard-code); no silent
  retype (create-new + link, or umbrella parent); AC field is Story-tier in ADO. `status` adds a
  **ground-truth reconciliation** step (board vs run files vs disk/git) run at epic/story close.
- **F16 — adapter writes are read-back-verified.** Every mutation (`transition`/`create`/`comment`/
  `link`/`updateAC`) must fetch the item back and assert the change landed before recording success,
  **tolerating eventual consistency** (retry/backoff, not hard-fail on first mismatch) and raising a
  hard error on persistent divergence. Stated in the `work-items` contract so it binds all trackers;
  `wi-ado` calls out the flaky `az.cmd` write that caused the live board/run-file divergence.

#### `aidlc` — gating & render defaults

- **F6 — `init` normalizes the control-plane branch** to the configured default (no `master` control
  plane while every repo says `main`).
- **F11 — the design-pod scaffold gate is deterministic in headless/sprint mode.** `run` §2 defines a
  scaffold-vs-real-UI classifier (scaffold/skeleton scope → `ui:false`, jury skipped, even in a UI
  repo; ambiguity errs to `ui:true`); `sprint` applies it with no prompt so a batched sprint never
  burns a full design run on an empty shell.
- **F13 — the render URL is resolved from the repo, not a stale config default** (see `aidlc-ux`);
  `run` §6 has the scaffold write its chosen dev-server port back to `ux.renderBaseUrl` and flag
  cross-repo port collisions; `init` derives/asks the UX dev port instead of defaulting every repo to
  :3000.

#### `aidlc-stack-web` — scaffold-template completeness

- **F9 — the dependency-cruiser boundary gate ships with every scaffold.** `project-structure` replaces
  the init-only note with a mandatory **repo-scaffold checklist** (applies to `/aidlc:init` *and* any
  `/aidlc:run` scaffold task) so `.dependency-cruiser.cjs` + `depcruise` are never silently omitted.
- **F10 — the shared/base tsconfig is documented as strictness-only** in `coding-standards-ts`
  (`moduleResolution`/`baseUrl`/`target` belong in each repo's own tsconfig) — the template was already
  clean; the principle was unstated. Enforced by the F9 checklist.
- **F12 — a pre-composed Next.js ESLint overlay** (`templates/tooling/next/`) ships the four
  ESLint-10 / Turbopack / `file:../`-monorepo reconciliations pre-solved (dedupe the `@typescript-
  eslint` plugin registration, pin `react.version`, map `.js/.cjs/.mjs` to `disableTypeChecked`,
  `turbopack.root` snippet) so every Next repo stops re-deriving them. Pins verified against the
  registry + Context7 (2026-07-12): `eslint-config-next@16.2.10` (peerDep `eslint >=9`, accepts
  ESLint 10), `react@19.2.7`; `eslint-plugin-react` rides transitively at `7.37.5` — the `react.version`
  pin (workaround #2) is required precisely because no stable `eslint-plugin-react` yet declares native
  ESLint-10 support (documented, with a "drop the pin when it does" note). Overlay README instructs
  adopters to confirm with `eslint --print-config` per repo.
- **F14 — a hardened `.gitignore`** (`templates/tooling/.gitignore`) ignores `.env*` with a
  `!.env.example` allow-exception — secret hygiene by default, a real concern for auth/identity repos.

#### `aidlc-ux` — jury render resolution & scope gate

- **F11 — pod-scope gate** in `design` mirrors the core scaffold-vs-UI classifier so the pod
  self-applies skeleton-only when invoked standalone on a scaffold scope.
- **F13 — the jury resolves the render URL from the repo's actual `dev`/`start` port** at render time
  (parsed from `package.json`), using `ux.renderBaseUrl` only as a fallback, preferring the derived
  port on mismatch, and **failing loud on a non-UI response** (JSON/404) so a wrong-server render can
  never silently score. Mirrored across `design`, `design-jury` and the `aidlc-ux-jury` agent.

## [0.13.1] — 2026-07-11

### Added

- **ADO Feature handling in `wi-ado` (`aidlc`).** Azure DevOps nests Epic → Feature → User Story →
  Task/Bug, but the canonical schema has no `feature` tier. The adapter now maps **both Epic and
  Feature → canonical `epic`** (decomposable parents), preserving the real ADO type in
  `sourceRaw.adoType` so writes never convert one into the other. `query` excludes Features as well
  as Epics from ready work; decomposition creates User Story children parented under the Feature
  (or under an Epic per the project's convention). Previously a Feature could surface in ready-work
  queries and fail to classify. Version: `aidlc` 0.13.0 → **0.13.1**, marketplace → **0.13.1**.

## [0.13.0] — 2026-07-11

### Changed — per-agent verification cadence; economical defaults (`aidlc`)

- `pipeline.verification` moves from a global `mode`/`scope` + on/off toggles to **per-agent
  cadence**: `reviewer`, `qa` and `security` each take `off | on-demand | per-item | per-epic`
  (security also `risk-based`), plus `securityConfirm`. The old global `scope` field is removed
  (folded into per-agent cadence).
- **New defaults are economical** — `reviewer: on-demand`, `qa: on-demand`, `security: per-epic`
  (`securityConfirm: true`). A typical item now runs **no LLM verification agent**: you invoke
  reviewer/QA on demand (re-run and ask), and security runs once per epic **after you confirm**. The
  deterministic CI gate (lint/format/typecheck/boundaries/tests) + the implementer's own test run are
  the per-item floor, and the bug failing-repro-test still runs at implement. (Previous default:
  reviewer + QA on every item + risk-based security — thorough, but the biggest recurring token/time cost.)
- Wired through `run` §7 (verify) and §2 (epic consolidation runs the per-epic agents; security
  confirmed), the config schema, both scaffolded configs, `init` (Economical / Balanced / Thorough /
  Manual profiles) and the user guide. Teams wanting the old behavior set all three to `per-item`.
- Version: `aidlc` 0.12.2 → **0.13.0**, marketplace → **0.13.0**.

## [0.12.2] — 2026-07-11

### Added

- `aidlc:intake` now stamps **provenance** on every item it creates — an `unplanned` label plus a
  `Provenance: created via /aidlc:intake on <date> — "<ask>"` note in the description — so
  request-born work (asked for directly, outside the planned backlog) stays queryable later. It's
  tracker-agnostic via the adapter contract: the label maps to markdown frontmatter, Jira labels or
  ADO `System.Tags` identically, and the note goes in `description` everywhere. Filter on `unplanned`
  to see everything that entered outside planning. Version: `aidlc` 0.12.1 → **0.12.2**, marketplace → **0.12.2**.

## [0.12.1] — 2026-07-11

### Changed

- `aidlc-researcher` agent runs on **Opus** (was Sonnet). Spikes are high-stakes technology-selection
  decisions that downstream stories build on; the deeper tier is worth it. Behavior/protocol
  unchanged — it still blends codebase + Context7 + WebSearch + a scratchpad PoC and delivers a cited,
  date-stamped decision report. Version: `aidlc` 0.12.0 → **0.12.1**, marketplace → **0.12.1**.

## [0.12.0] — 2026-07-11

### Added — dependency policy, vetted at install time (`aidlc`)

- New `dep-vet` PreToolUse hook gates package-ADD commands (`npm i <pkg>`, `npm install <pkg>`,
  `pnpm|yarn|bun add …`) and asks the operator to vet the package **before** it's installed and coded
  against — so a bad/stale/incompatible choice is caught early, not reworked in verify. Bare lockfile
  installs (`npm ci`, `npm install`, `pnpm i`) and `npm run` scripts are untouched. Ships
  `dep-vet.test.mjs` (21-case detection matrix).
- `aidlc:security` §4 is now the canonical **Dependency policy** — deliberately *not* an allow-list
  (that would handcuff projects): any package is fine if it clears three tests — **safe** (maintained,
  no typosquat, clean license/scripts, no open CVEs), **latest stable** (current stable version,
  verified via Context7/registry, no prereleases), and **compatible** (satisfies peerDependencies +
  `engines`; never `--legacy-peer-deps`/`--force` to silence a peer conflict). `coding-standards-ts`
  (add-time) and `maintenance` (bump-time) cross-link it.
- Version bumps: `aidlc` 0.11.0 → **0.12.0**, marketplace → **0.12.0**, `aidlc-stack-web` 0.7.0 →
  **0.7.1** (coding-standards pointer). `aidlc-ux` (0.2.1) unchanged.

## [0.11.0] — 2026-07-11

### Added — enterprise project structure, scaffolded + boundary-gated (`aidlc-stack-web`, `aidlc`)

- New `aidlc-stack-web:project-structure` skill — the canonical enterprise folder trees: NestJS
  backend (`modules/<feature>` + `common/{filters,guards,interceptors,pipes,decorators,constants}`,
  thin controller → service → repository) and **two frontend flavors** — `next-app` (App-Router-first,
  server components own data, RTK for client state) and `rtk-spa` (RTK Query as the primary data
  layer) — with layering rules, RTK/RTK Query conventions, `components/{ui,features}` + custom-hooks
  taxonomy, and a centralized `common/constants/{http-status,messages}` module (no inline strings).
- Ships `templates/structure/`: three `dependency-cruiser` boundary configs (backend / next-app /
  rtk-spa) and canonical reference files (NestJS exception filter mapping to the api-design error
  shape + constants; RTK `store/{index,hooks,api/base-api}`).
- `/aidlc:init` asks the frontend flavor and scaffolds the matching skeleton per TS repo (per-repo in
  poly, merge-aware, skips non-TS); `aidlc:ci-cd` runs `depcruise` in the PR gate so layering
  violations (feature→feature internals, controller→repository, `ui`→`store`) fail the build
  regardless of `verification.mode`. `nestjs`/`nextjs` skills cross-link the structure; Next adopts
  the RTK/RTK Query state stance.
- Version bumps: `aidlc-stack-web` 0.6.0 → **0.7.0**, `aidlc` 0.10.0 → **0.11.0**, marketplace → **0.11.0**.

## [0.10.0] — 2026-07-11

### Added — strict web-stack tooling baseline (`aidlc-stack-web`, `aidlc`)

- `aidlc-stack-web` now ships a **deterministic quality baseline** in `templates/tooling/`:
  `tsconfig.base.json` (strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, unused
  locals/params, …), `eslint.config.mjs` (flat, type-aware: `typescript-eslint` strict-type-checked
  + stylistic, `no-explicit-any`, `consistent-type-imports`, Prettier last), `.prettierrc.json`,
  `.editorconfig`, `.npmrc` (`engine-strict` + `save-exact`), and a README with the exact devDeps +
  scripts.
- `/aidlc:init` scaffolds the baseline into every TypeScript repo (per-repo in poly; **merge-aware** —
  never clobbers configs you already have; skips non-TS repos); `aidlc:ci-cd` runs
  `typecheck → lint → format → build → test` as a **hard PR gate that holds even when the reviewer is
  toggled off**. `coding-standards-ts` now states the division of labour: tools own the mechanical
  rules, the reviewer owns judgment (validate-at-edge, state modelling, dependency choice).
- Rationale: the coding standards were previously enforced mainly by the LLM reviewer and assumed a
  strict project config existed. This shifts the mechanical half to tooling that runs on every commit
  and in CI — "the code can't just work however it's written."
- Version bumps: `aidlc-stack-web` 0.5.0 → **0.6.0**, `aidlc` 0.9.1 → **0.10.0**, marketplace → **0.10.0**.

## [0.9.1] — 2026-07-11

### Fixed

- **Bash guard hook false-tripped on tokens inside commit messages (`aidlc`).** The push guard
  flagged any command that merely contained the words `git` … `push`, so a legitimate
  `git commit -m "…push…"` on `main` was blocked; the same class hit commit messages mentioning
  `TRUNCATE TABLE`, `git filter-branch`, `prod`/`psql`, `id_rsa` or `rm -rf /`. The guard now
  inspects the command being executed, not free text: quoted argument text is stripped before
  command-identity detection, `git push` is matched as an actual subcommand, and the DB/prod/
  credential/rm content checks are skipped for `git` segments (git runs none of those) while
  cross-pipe `.env` exfil still scans the whole command. Adds `guard.test.mjs`, a 33-case
  block/allow regression matrix. Version: `aidlc` 0.9.0 → **0.9.1**, marketplace → **0.9.1**.

## [0.9.0] — 2026-07-11

### Added — local git mode (no remote required) (`aidlc`)

- New `git.mode` (`remote` default | `local`) — per-repo in poly, top-level in mono. Lets a project
  run the full pipeline **before it has a git remote**: no push, no PR. After green verify the
  pipeline shows the commits + diffstat and integrates via a **user-confirmed local `--no-ff` merge**
  into the default branch — the framework's one mandatory human gate is relocated (PR review →
  merge approval), never removed. Non-interactive/declined → parks at `review-pending` with
  instructions, never merges unattended. Default `remote` = existing push+PR behavior, unchanged.
- Repo-aware across `git-workflow` (new *Local mode* section), `run` §8 (integrate = PR or local
  merge), `init` (detects a missing remote and proposes `local`), `status` (PR column shows
  `local-merge:<sha>`), `release` (tags locally, skips publish), the always-on git-workflow rule,
  the config schema + scaffolded template. Flip `git.mode: remote` once an origin exists.
- Version bumps: `aidlc` 0.8.0 → **0.9.0** (minor — new feature), marketplace 0.8.0 → **0.9.0**.
  `aidlc-ux` (0.2.1) and `aidlc-stack-web` (0.5.0) unchanged.

## [0.8.0] — 2026-07-11

### Added — polyrepo (multi-repo) support (`aidlc`)

- A workspace can now hold **many git repos** (e.g. `backend/`, `frontend/`, `website/`, `mobile/`),
  not just one. **Mono is unchanged and remains the default** — an empty `repos[]` behaves exactly as
  before, so existing projects need zero migration.
- New config: `workspace.layout` (`mono` | `poly`) + `repos[]` (per-repo `name`, `path`, `host`,
  `remote`, `defaultBranch`, `branchPattern`, `stack`, `labels`, optional per-repo `ux`, `default`).
  The control plane (`.claude/`, `backlog/`, `.aidlc/`) lives at the workspace root; product repos are
  subfolders. Ships `.claude/aidlc.config.poly.example.json` and the previously-missing
  `docs/aidlc.config.schema.json` (validates both shapes).
- **Orchestrator-driven routing.** You describe a requirement in plain language; the orchestrator
  grounds it against the actual repos and routes each item to one repo (explicit `repo` → label →
  default → ground → ask). Cross-repo features become an **epic** whose child stories each target one
  repo, sequenced by a new `dependsOn` field; a control-plane coordination file rolls them up.
- **Invariant: 1 run = 1 item = 1 repo = 1 branch = 1 PR** — every PR stays small and independently
  reviewable, and each child run is atomic and resumable.
- Repo-aware across the pipeline: `run`, `git-workflow`, `ci-cd` (host from the resolved repo),
  `work-items` schema + all three adapters (markdown/Jira/ADO map `repo` + `dependsOn`), `intake`,
  `groom`, `next` + `status` (multi-location run-file scan; unified board + Repo column + epic
  rollup), `sprint` (worktrees per target repo), `release` (per-repo), `init` (poly setup), the
  `aidlc-ux:design` pod (operates in the resolved frontend repo and reads its own `ux`), and the
  `session-context` / `checkpoint` hooks (scan every repo's run dir).
- Version bumps: `aidlc` 0.7.4 → **0.8.0** (minor — new feature), `aidlc-ux` 0.2.0 → **0.2.1**
  (poly-aware design handoff), marketplace 0.7.4 → **0.8.0**. `aidlc-stack-web` unchanged (0.5.0).

## [0.7.4] — 2026-07-09

### Fixed

- **Duplicate hooks-file load error (`aidlc` → 0.7.3).** Current Claude Code auto-loads a plugin's
  standard `hooks/hooks.json`, so the manifest must not also point at it. Removed
  `"hooks": "./hooks/hooks.json"` from `plugins/aidlc-core/.claude-plugin/plugin.json`; the hooks
  still load automatically from the standard path. Fixes: *"Failed to load hooks … Duplicate hooks
  file detected … manifest.hooks should only reference additional hook files."*

## [0.7.3] — 2026-07-09

### Added — user-controlled verification cadence (`aidlc` → 0.7.2)

- New `pipeline.verification` config block puts the review/QA cost — the pipeline's biggest
  recurring spend — in the user's hands:
  - `mode`: `auto` (AIDLC runs reviewer + QA, current behavior), `manual` (AIDLC skips the agents and
    opens the PR for the human to review; run ends at a new `review-pending` phase; issues fed back
    by rerunning `/aidlc:run <ID>`), or `ask` (pipeline prompts per item).
  - `scope`: `per-item` (verify every item, default) or `per-epic` (children skip per-item review;
    one consolidated pass when the epic's children are all implemented).
  - `reviewer` / `qa` / `security` toggles for fine control (e.g. keep the fast code review, drop
    the heavier QA test-authoring).
- `/aidlc:init` now asks for the verification cadence up front.
- Safety preserved: in every mode the implementer still runs lint + tests to green before a PR, and
  the human merge of the PR remains the final gate — `manual` just skips the *extra* bot pre-review
  (and flags the PR as un-reviewed by bots). `security: off` on a risky diff leaves a visible note.
- Default is unchanged (`auto` / `per-item`) so existing projects behave exactly as before until
  they opt into a cheaper cadence.
- Docs: user guide §3b (cadence table + manual feedback loop), example walkthrough (init option),
  architecture (extension point).

## [0.7.2] — 2026-07-09

### Changed

- **`aidlc-ux` enabled by default.** The design pod now ships `defaultEnabled: true` in the
  marketplace — no manual install/enable step. It stays dormant on backend/infra items, so
  non-UI projects are unaffected; turn it off per project with `ux.enabled: false`.
- **Hardened UI detection in the orchestrator (`aidlc` → 0.7.1).** The decision to invoke the
  design pod moved from a soft path-glob check during implement to an explicit determination at
  the **classify** step, recorded as `ui:` on the run file. Signals: a `ui`/`ux`/`design`/`frontend`
  label, OR the title/description/AC mentioning a screen/page/component/layout/visual/motion/
  redesign, OR a frontend stack with an item that clearly renders something. When unsure on a
  frontend item it defaults `ui: true` (an over-invoked jury is cheap; a missed one ships un-judged
  UI). The auto-invocation now also passes the resolved **scope, mode and brand** through, so the
  autopilot behaves the same as running `/aidlc-ux:design` by hand. Run-file template gains
  `ui` / `uxScope` / `uxMode`.
- Docs updated: user guide (§3a design-pod section + cheat-sheet + troubleshooting), example
  walkthrough (§6a/§6b showing the pod on the todo UI + a brand-anchored redesign), adoption guide
  and architecture.

## [0.7.1] — 2026-07-09

### Added — `aidlc-ux` plugin (v0.2.0): existing projects, scope targeting & brand references

- **Works on existing projects, not just greenfield.** `/aidlc-ux:design` now resolves a **scope**
  (a page/route/screen, a path/glob, or the whole app) and a **mode**:
  - `greenfield` — establish the design system; it becomes the project standard every later UI item
    adopts (implemented and followed throughout).
  - `retrofit` — redesign a specific page/screen while **adopting the project's established system**
    first, so the target stays uniform with the rest of the app.
  - `redesign` — whole-app redesign that may replace and re-propagate the system.
- **UI audit step** for existing surfaces: renders the current UI (Playwright) + sibling screens,
  and `aidlc-design-system` (new **audit mode**) extracts the current design language, flags
  inconsistencies, and recommends conform / elevate-in-place / replace → `design/audit.md`.
- **Brand references** (new + existing): pass a logo, colors, fonts, or reference screenshots (in
  `$ARGUMENTS`, in `ux.brand.referenceDir` = `design/brand/`, or via the `ux.brand` config). They're
  treated as **hard constraints** — the design-system extracts a palette from the logo, matches
  fonts (best-effort, flags ambiguous screenshot matches for confirmation), and honors supplied
  values exactly. Catalogued in `design/brand.md`.
- Jury now scores **cross-page consistency + brand adherence** on scoped redesigns (target must not
  be a lone island in a different style), using sibling-page shots.
- New `ux.brand` config block; new `audit.md` and `brand.md` templates.

## [0.7.0] — 2026-07-09

### Added — `aidlc-ux` plugin (new, opt-in): the UI/UX design pod

- A five-role pod for award-tier, uniform desktop-web UI:
  - `aidlc-ux-writer` (sonnet) — writes `design/narrative.md`: the experience story (vision, tone,
    journey, one signature moment) that every downstream decision must trace back to.
  - `aidlc-ux-researcher` (sonnet) — mines Awwwards/FWA and current best-in-class work (WebSearch/
    WebFetch) for cited, transferable techniques → `design/inspiration.md`.
  - `aidlc-design-system` (sonnet) — the **uniformity anchor**: color/type/spacing/radius/elevation
    tokens emitted to code as the single source of truth, WCAG-AA contrast verified.
  - `aidlc-motion` (sonnet) — animation, micro-interactions, scroll/parallax, GSAP, sequencing —
    within a 60fps + `prefers-reduced-motion` budget; realizes the signature moment.
  - `aidlc-ux-jury` (opus) — strict, **unbiased** Awwwards-style judge. Renders the built UI with
    Playwright, screenshots it, scores a weighted rubric /10 with mandatory visual evidence, blind
    to the makers' reasoning. A 9 is rare and must be earned.
- `/aidlc-ux:design <item|path|description>` — the pod pipeline: narrative → research → design system
  → build + motion → **jury loop until composite ≥ `ux.juryThreshold` (default 9)**, capped at
  `ux.maxJuryRounds` (default 3). At the cap it ships the best-scoring round, attaches the jury's
  remaining critique, and flags for human — never loops forever, never escalates models.
- Skills: `design` (orchestration), `ux-narrative`, `design-research`, `design-system`, `motion`,
  `design-jury` (rubric + anti-bias + render protocol). Templates for all five `design/*` artifacts.

### Changed — `aidlc` plugin

- Orchestrator (`/aidlc:run`): UI-touching items now route the frontend through `aidlc-ux:design`
  (jury gate included) when `aidlc-ux` is installed and `ux.enabled` — no hard dependency; core still
  runs standalone.
- Project `aidlc.config.json` gains a `ux` block (`enabled`, `target: desktop-web`, `juryThreshold`,
  `maxJuryRounds`, `juryPanelSize`, `renderBaseUrl`, `uiPaths`).

## [0.6.1] — 2026-07-09

### Fixed

- **Agent model identifiers**: all agents pinned invalid model ids (`claude-sonnet`,
  `claude-opus`, `claude-haiku`) which Claude Code could not resolve — subagents died with an
  API error and the orchestrator fell back to the session's (larger) model. Corrected to the
  valid tier aliases (`sonnet` / `opus` / `haiku`), so each agent runs on its intended tier.
- Orchestrator invariant added: a subagent model/API failure must be reported, never worked
  around by escalating to a larger model.

## [0.6.0] — 2026-07-09

### Added — `aidlc` plugin (requirement intake)

- `/aidlc:intake <text>`: the pipeline's front door for requirements that exist only in the
  user's head — analyst grounds the requirement in the codebase, sweeps the existing backlog
  (skip covered / delta-only for partial overlap / flag in-flight conflicts), proposes the
  item set (epic+stories or single story/bug/task) with AC, creates on approval in the active
  tracker (Jira/ADO/markdown).
- `/aidlc:run <free text>`: non-ID arguments route through intake, then the pipeline runs the
  first created item — "describe it and it gets built".
- Analyst agent: intake mode (propose-only; the orchestrator creates after approval).

## [0.5.0] — 2026-07-08

### Added — `aidlc` plugin (Phase 5: self-extension & scale)

- `scaffold-skill` / `scaffold-agent`: create project-local capabilities from the templates,
  with mandatory `x-aidlc` metadata and the agent-test justification; registered in
  `.aidlc/extensions.json` with reuse tracking.
- Capability-gap protocol in the orchestrator: search plugins → local → registry before
  creating; reuseCount bumped on every reuse; `/aidlc:status` surfaces promotion candidates.
- `/aidlc:promote`: validate (secret scan, lint) → generalize (project specifics → config
  references, with a shown diff) → package into the right plugin on a `promote/<name>` branch
  → PR with the reviewer checklist. PR opening is user-confirmed.
- `/aidlc:sync`: post-merge reconciliation — deletes local forks shadowed by promoted plugin
  versions, resolves shadowing conflicts, reports promotion-ready candidates.
- `/aidlc:sprint N`: parallel independent items — analyst independence check, one git worktree
  + headless pipeline run per item, live board from run-file polling, queued conflicts,
  worktree cleanup on completion.
- Governance: `docs/promotion-policy.md` (acceptance bar + reviewer checklist), CODEOWNERS
  making `plugins/**` platform-team owned.

## [0.4.0] — 2026-07-08

### Added — `aidlc` plugin (Phase 4: depth agents)

- `aidlc-architect` (opus): explores the codebase, plans items ≥ `architectThreshold`, writes ADRs.
- `aidlc-security` (opus): deep security pass — input→sink tracing, authz, dependency audit —
  auto-triggered by `securityReviewPaths` overlap, manifest changes, or `security` label.
- `aidlc-devops`: docker/CI/release items and red-PR-check diagnosis.
- `aidlc-docwriter` (haiku): docs phase; amends the PR with `docs(...)` commits.
- `aidlc-researcher`: spike items → cited decision reports in `docs/research/`.
- Skills: `architecture` (ADR discipline), `security`, `ci-cd`, `release` (`/aidlc:release`),
  `docs-writing`, `research`, `maintenance`; ADR template.
- Orchestrator wiring: security agent joins the verify batch conditionally; spikes route to the
  researcher; infra-only plans route to devops; red CI checks get a diagnosis pass.

### Added — `aidlc-stack-web` plugin (new)

- Stack expertise skills: `coding-standards-ts`, `nextjs` (App Router), `nestjs`, `postgres`,
  `mongodb`, `db-migrations` (expand-contract), `docker`, `api-design`.

## [0.3.0] — 2026-07-08

### Added — `aidlc` plugin (Phase 3: real trackers + Azure)

- `wi-jira` adapter: Jira via Atlassian MCP — JQL queries, transition-by-target-status,
  AC field/section detection, dev-panel linking, per-project `statusMap`.
- `wi-ado` adapter: Azure Boards via ADO MCP with `az boards` CLI fallback — WIQL queries,
  Agile/Scrum process detection, state-stepping with tag fallbacks, HTML field mapping.
- Azure Repos PR path in `git-workflow` (`az repos pr create` + work-item linking).
- `/aidlc:groom` — analyst-driven backlog refinement with autonomy boundaries
  (AC/sizing applied; decompositions and priority changes proposed only).
- Bundled MCP: `atlassian` (remote, OAuth) and `azure-devops` servers.
- Project template: `.mcp.json.example` with optional read-only Postgres/MongoDB, Sentry,
  Notion, Figma servers.

## [0.2.0] — 2026-07-08

### Added — `aidlc` plugin (Phases 0–2)

- Marketplace + plugin manifests; installable via `/plugin marketplace add`.
- Project template (`templates/project/`) scaffolded by `/aidlc:init`: CLAUDE.md, permissions
  posture, `aidlc.config.json` switchboard, always-on rules, markdown backlog spec, run-state folders.
- Orchestrator pipeline `/aidlc:run`: fetch → classify → requirements → plan → implement →
  verify (review + QA parallel, fix cycles) → PR → wrap; resumable via run files.
- `/aidlc:next`, `/aidlc:status` commands.
- Work-item adapter layer: canonical WorkItem schema + 7-operation contract; `wi-markdown` adapter.
- Agents: `aidlc-analyst`, `aidlc-implementer`, `aidlc-reviewer`, `aidlc-qa`.
- Phase skills: requirements, planning, git-workflow, code-review, testing, debugging, run-state.
- Hooks (Node, cross-platform): bash guard, protected paths, format-on-save, session context
  snapshot, run-state checkpoint/notify.
- Bundled MCP config: context7, github, playwright (auth per user).
- Docs: adoption guide, architecture (incl. phases 3–5 roadmap), permissions rationale.
