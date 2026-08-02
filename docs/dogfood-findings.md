# AIDLC Plugin — Dogfood Findings

**LIVING DOCUMENT.** Log plugin findings here as dogfooding proceeds, then design + implement them
together as a batch through the normal branch → version → merge flow. When a cycle's batch ships,
archive this file into `dogfood-findings-archive.md` (append a new `# … ARCHIVE — Cycle N` section)
and reset this file fresh for the next cycle.

**Severity:** 🔴 blocks/confuses a core flow · 🟠 friction/manual workaround · 🟡 polish.

> **Prior cycles (full record in `dogfood-findings-archive.md`; per-finding change lists in the
> CHANGELOG):**
> - Cycle 1 — **F1–F16** (Epic-1 poly scaffolding) → shipped in marketplace **0.14.0**.
> - Cycle 2 — **F17–F33** (remote/PR + CI + poly shared-config) → shipped in marketplace **0.15.0**.
> - Cycle 3 — **F34–F41** (pipeline reliability + dogfood inbox pruning) → shipped in marketplace
>   **0.18.0** (F34–F40) + **0.18.1** (F41).

---

## Open findings (to implement at the end)

_Numbering continues across cycles — the next finding is **F56**._

### F54 🟠 — Nothing commits control-plane state in solo mode, so a 34-wave plan lived on one machine
**Symptom.** (RTO Tool, aidlc@0.50.0, poly, ADO, solo.) `.aidlc/plan.md` — an authoritative 34-wave
delivery schedule with a paragraph-long `driver:` recording the client's own words — was **untracked**.
Not ignored; `git check-ignore` says nothing matches. Simply never added. Same for
`.aidlc/plan-archive/` and `.aidlc/plugin-feedback.md`.
**Root cause.** `replan` §6 commits the plan **only in shared mode**, on the argument that a plan is a
*team* decision. True, and it left solo with no committer at all — and the control plane's files are
exactly the ones that do not ride into a feature branch the way run files do. So the most expensive
artifact in the workspace (the one thing a re-cut cannot reproduce, because it encodes a conversation)
was one `rm -rf` from gone. **0.48/0.50 made it worse**, adding `journal.md` and `facts.md` — two more
control-plane files with the same non-existent commit path.
**Resolution.** `/aidlc:doctor` gains a **control-plane state** check: `.aidlc/{plan,journal,facts}.md`
+ `extensions.json`, warned when uncommitted, naming which. Reporting rather than committing is
deliberate — what belongs in a commit is the user's call, and a doctor that mutates cannot be re-run to
confirm a fix. A committer for solo mode is the real fix and is **not** done here; it needs to decide
which command owns the commit, and that is a design question, not a check.
**Lesson worth keeping:** "durable state stays TRACKED on purpose" was written in the template's
`.gitignore` and believed. Nothing verified it. **A file being un-ignored is not the same as a file
being committed**, and the gap between those two is invisible until the machine dies.

### F55 🟡 — The upgrade's config write reformatted 147 lines to change 2
**Symptom.** (RTO Tool.) `plan-upgrade.mjs --write` stamped `configVersion` + `aidlcVersion` — a
two-key change — and produced a **147-insertion / 24-deletion** diff, because it re-serializes with
`JSON.stringify(cfg, null, 2)` and the project's config used compact one-line objects
(`"stack": { "frontend": null, … }`).
**Root cause.** Writing JSON by re-serializing discards the author's formatting. Harmless
semantically, and corrosive to the one property the whole command depends on: **`/aidlc:upgrade` is
built around "show the diff, then apply"**, and a diff where 145 of 147 lines are whitespace is a diff
nobody reads — which converts an approval gate into a rubber stamp.
**Resolution.** Not fixed in code yet; the config keys were applied by hand for that workspace instead.
The honest options are a format-preserving edit (append the keys textually rather than re-serializing)
or detecting the file's existing style. Recorded here rather than papered over, because the failure is
in the *reviewability* of a safety-critical command, not in its output.
**Lesson worth keeping:** a command whose safety rests on a human reading a diff has to treat diff size
as a correctness property, not cosmetics.

### F52 🟠 — The guard's content checks were narrower than the sets sitting next to them
**Symptom.** Four verified gaps, all found by audit rather than by a run, all silent. (1) The
credential check named `cat|type|Get-Content` while `ENV_READERS` **one line above it** already listed
thirteen readers — so `head ~/.ssh/id_rsa` and `base64 ~/.aws/credentials` were allowed by a check that
blocked `cat` on the same file. (2) The recursive-delete check required **combined** flags (`-rf`/`-fr`)
and only tested absolute or `~` paths, so `rm -r -f /etc/passwd`, `rm --recursive --force …` and every
relative escape (`rm -rf ../../..`) went through. (3) Exfiltration covered `.env` only, so
`cat ~/.ssh/id_rsa | curl -d @- …` was not exfiltration. (4) The sensitive-path set was three patterns;
`.kube/config`, `.netrc`, `.pgpass`, `.gnupg/`, `.docker/config.json` and keystores were not secrets.
**Root cause.** Each check was written for the example that prompted it and never generalized to its own
neighbours. The credential one is the clearest: the correct reader set was already in the file, and the
check simply did not use it.
**Resolution.** Both checks are argv-based against shared sets; delete targets resolve against cwd
(covering absolute and relative with one rule, and catching `rm -rf .`); exfil spans the full secret set.
`.pem`/`.key` are **deliberately excluded** — overwhelmingly public certs and fixtures in real repos, and
F46 already recorded what a guard firing on the correct case costs.
**Lesson worth keeping:** when a check enumerates tools or paths, **look for the set already in the file**.
Two lists of the same kind of thing, in one file, with different members is a bug the reader will not see.

### F53 🔴 — A nested shell bypassed every argv-based check in both hooks
**Symptom.** `bash -c "rm -rf /etc"` is one segment whose `argv[0]` is `bash`. Every argv-based check
therefore read it as a benign call to bash: `bash -c "git push --force"` slipped the push guard,
`sh -c "cat .env"` slipped the env backstop, `bash -c "npm install evil-pkg"` slipped dep-vet's
supply-chain gate, and `env FOO=1 rm -rf /x` slipped the delete check. The raw-segment *regex* checks
(production targets, DB operations) caught the same shape incidentally — which is why this survived: the
hook looked like it handled nested shells, because half of it did.
**Root cause.** The same root as F50, one level further in. F50 fixed *where segments end*; this is
*what a segment contains*. A wrapper's `-c` argument is another command line, and nothing treated it as
one. The pre-existing raw-regex checks masked it, so no single test would have caught it — only asking
"which checks are argv-based, and what is argv[0] here?" does.
**Resolution.** `expandSegments` in `lib/shell-parse.mjs` expands a wrapper's payload into segments of
its own (depth-limited; the wrapper segment is retained so the regex checks still see what they always
saw), and both hooks use it. One fix for all four holes, which is the argument for putting it in the
shared parser rather than per-check.
**Also recorded, because it was nearly a silent regression:** rewriting the delete check from a raw-segment
regex to argv parsing **narrowed** it — the old regex incidentally caught `bash -c "rm -rf …"` and the
argv version did not. The suite was green either way; it was caught by running the new hook and the
committed one against the same 20 commands and diffing. **A security check being rewritten gets a
before/after behavioural diff, not just a passing suite** — precision and coverage are different axes,
and making a check more precise can quietly cost coverage somewhere nobody is looking.
**Known limitation, pinned by a test:** the tokenizer does not model backslash escaping, so
`bash -c "bash -c \"…\""` still hides its payload. Mixed-quote nesting is covered. Adding escape handling
would put F46's Windows path handling at risk (`D:\RTO Tool`), so it is a recorded decision, not an
oversight.

### F50 🔴 — A newline in a Bash command disabled every guard check (fail-open, silent)
**Symptom.** Found by audit, not by a run — which is itself the finding: nothing would have surfaced
it, because it produces no error and no log line. `guard.mjs` and `dep-vet.mjs` both segmented with
`cmd.split(/[|;&]+/)`. **Newline is not in that character class**, so a multi-line command collapsed
into ONE segment. Segment identity comes from `argv[0]`, so a command whose *first line* was `git …`
was classified as a git segment — and git segments deliberately `continue` past every content check
(git executes no SQL, cluster, filesystem or credential operations). Verified by probing the real
hooks: `git status`⏎`cat ~/.ssh/id_rsa`, `git status`⏎`cat .env`,
`git log`⏎`psql -h prod.example.com`, `git status`⏎`rm -rf /etc/passwd` and
`git status`⏎`npm install left-pad` all returned **rc=0**. Only the exfil check survived, because it
evaluates the whole command string outside the loop.
**Root cause.** The separator set was written for `;`/`&&`/`||` pipelines and never revisited when
multi-line Bash became ordinary. This is the **F46 shape one layer out**: F46 fixed command *identity*
(a quote-aware tokenizer, so a spaced `-C` path can't silently skip the push checks) but left command
*segmentation* as a regex — so the same "parse, don't regex" argument had been accepted for tokens and
not for segments. The reachable path is not exotic: heredocs, multi-step sequences, and the git flows
this framework's own skills instruct.
**Resolution.** New `hooks/scripts/lib/shell-parse.mjs` owning `splitSegments` + `tokenize` +
`commandArgv` + `commandName`, imported by both hooks. The splitter is **quote-aware**, which is what
makes the fix correct rather than merely wider: a newline inside quotes is not a separator, so
`git commit -m "line one⏎line two"` stays one command and its message body is never parsed as commands
to execute. `tokenize`/`commandArgv` were byte-identical copies in both hooks before this — the exact
drift `lib/` was created to prevent. 30 regression tests added (guard 74→94, dep-vet 39→49).
**Lesson worth keeping:** F46's fix was applied to one layer of the same parse. When a "parse, don't
regex" fix lands, **ask which other layer of the same command still uses a regex** — here it was the
step immediately before the one that got fixed.

### F51 🔴 — The plugin repo had no CI: 672 assertions, nothing ran them
**Symptom.** `.github/` carried issue templates and a PR template and no `workflows/`. There was no
`package.json` and no runner, so exercising the suites meant invoking 11 files by hand. Meanwhile
`/aidlc:status` §1.6 warns *users* when their repo is `mode: remote` with no required-check policy —
the framework failed its own check.
**Root cause.** The suites were each written alongside the defect they pinned (F42–F49) and were run
at the moment of writing. Nothing made them a **gate**, so their value decayed to whoever remembered.
For the hooks specifically this is the F45 asymmetry: a broken *allow* rule blocks a run loudly, a
broken *deny* rule is silent — so the half that protects anyone is the half no human notices.
**Resolution.** `.github/workflows/ci.yml` (Linux + Windows × Node 20/22) running `npm test`
(discovered, not listed) plus four static checks — manifests, permission-rule shapes, templates vs
schema, cross-references. Dependency-free, so there is no `npm ci` and no supply chain added to the
repo that argues hardest against unvetted dependencies. Each check was negative-tested against broken
fixtures before being called done. `check:permissions` finally implements the lint **F48 asked for**
("Consider a template lint that rejects any `Write(<path>)` rule outright") and extends it to the F45
and F49 shapes; `check:templates` immediately found the missing `team` block in
`aidlc.config.schema.json`.
**Lesson worth keeping:** a finding's regression test is only worth what runs it. F48's own lesson was
*"a fixed finding is only fixed where it was applied… nothing mechanical enforces it"* — the mechanical
enforcement is the deliverable, not the test file.

### F48 🟡 — Reintroduced F44's no-op `Write(path)` rules in the env `ask` floor
**Symptom.** (RTO Tool, aidlc@0.28.0.) Every session start prints: *"Permission ask rule
(.claude\settings.json): `Write(**/.env)` is not matched by file permission checks — only `Edit(path)`
rules are. Use `Edit(**/.env)` instead."* — twice, once per `Write(...)` rule.
**Root cause.** 0.28's env fail-safe floor was authored as `Read/Edit/Write(**/.env)`, assuming
`Write(path)` is separately enforceable. **This is exactly F44**, found and fixed one cycle earlier in
the *deny* list; the same wrong assumption was reapplied to the *ask* list by someone (me) who had the
finding in the repo and didn't check it. File permission checks match only `Read(path)` and
`Edit(path)`; `Edit` already covers every file-editing tool including Write.
**Resolution.** Dropped both `Write(...)` rules from the template's `ask` list. Enforcement is
unchanged — the `Edit(**/.env)` rules already covered the Write tool — so this was noise, not a hole.
**Lesson worth keeping:** a fixed finding is only fixed where it was applied. When adding permission
rules, grep `dogfood-findings*.md` for the rule *shape* first — the archive is the regression suite for
config, and nothing mechanical enforces it. Consider a template lint that rejects any `Write(<path>)`
rule outright.

### F49 🔴 — Hand-migrating `settings.json` with `//` comments silently disabled every plugin
**Symptom.** (RTO Tool.) After the 0.28 migration instruction *"remove `Read(./.env)` and
`Read(./.env.*)`"*, the two rules were **commented out with `//`** rather than deleted. Claude Code then
reported *"Invalid or malformed JSON — files with errors are skipped entirely"* at startup, and **all
`/aidlc:*` commands disappeared** while `/plugin` still listed the plugins as installed. Time was lost
chasing a stale, unrelated marketplace error (`Marketplace file not found … \D:\SDLC`, leftover from
pre-rebrand `sdlc` installs) before the real cause surfaced.
**Root cause.** Two compounding gaps: (1) the migration guidance said "remove" without stating that
`settings.json` is **strict JSON with no comment support**; (2) the blast radius is invisible — that
file also carries `enabledPlugins`, so one malformed line disables every plugin for the project, and
the symptom (missing commands) points nowhere near the cause.
**Resolution.** Init's migration step now says delete outright, never comment out, and requires a
`JSON.parse` re-read after any settings edit to prove it still parses. The CHANGELOG migration note
carries the same warning.
**Lesson worth keeping:** any user-facing instruction to edit a settings file must name the format
constraint and the failure mode. Prefer pointing users at the programmatic `/aidlc:init` merge (which
cannot introduce comments) over hand-editing.

### F42 🔴 — Poly: `/aidlc:sprint` worktree launches are dead on arrival (`Unknown command: /aidlc:run`), silently at rc=0
**Symptom.** (RTO Tool, poly, 5 repos, ADO, `git.mode: remote`.) Sprint selected 5 independent items
across 5 repos, created a worktree per item exactly per §2, added `hasTrustDialogAccepted` for each
worktree path in `~/.claude.json` (both slash styles), and launched
`claude -p "/aidlc:run <ID>" --permission-mode acceptEdits` in each. All 5 exited within seconds at
**rc=0**, producing a 28-byte log containing only `Unknown command: /aidlc:run`. No run files, no
commits, no board writes — and because the runs exit 0, the failure reads as success to any caller
checking only the exit code.
**Root cause.** §2 assumed a worktree is a self-contained AIDLC workspace. That holds in mono (the
repo *is* the AIDLC workspace, so `.claude/` + `backlog/` are tracked and ride into the worktree) but
never in poly: AIDLC lives entirely at the control plane — `.claude/settings.json` carries
`enabledPlugins` + the permission allowlist, `.claude/aidlc.config.json` carries tracker + `repos[]`,
plus `backlog/` and `CLAUDE.md` — while the product repos have no `.claude/` at all. A worktree of one
is a bare project: no plugin, no permissions, no config, no backlog, and `repos[].path` values that are
workspace-relative and meaningless inside a single-repo checkout. **Trust does not fix it:** plugin
enablement is a `settings.json` concern; `hasTrustDialogAccepted` in `~/.claude.json` only clears the
trust prompt. Two independent defects: the wrong launch cwd, and a launch step that trusts rc=0.
**Proposed modification.**
- **Poly launches from the control plane with cwd unchanged; no worktree.** This costs nothing —
  `/aidlc:run` already routes every git step to `workspace.root/<repo.path>` (`aidlc:run` §2.5), and
  items in different repos are isolated by construction, so per-repo worktrees add contention risk
  without adding isolation. Seeding a worktree instead was rejected: a product-repo worktree can never
  be a complete AIDLC workspace (no backlog for the markdown adapter, workspace-relative `repos[]`),
  so seeding would mean maintaining a second, degraded workspace shape.
- **Mono keeps worktrees** (the worktree genuinely is the workspace) plus the existing trust step, with
  a note that `.claude/settings.local.json` is gitignored and therefore does *not* ride into a worktree.
- **New §1.3 invariant — one in-flight item per working tree.** Without per-item worktrees, two poly
  items resolving to the same repo (or two `control-plane` items) must serialize; the second queues.
- **New §2b preflight** — deterministic file checks on the launch cwd (config present, `aidlc` enabled
  for that cwd at project or user scope, marketplace known, mono worktree trusted) *before* launching.
- **New §2c launch verification** — a run counts as started only on a run file / real pipeline output,
  never on rc=0. First item launches as a **canary**; dead-on-arrival aborts the sprint instead of
  burning the remaining slots on an identical environment fault.

### F43 🔴 — Poly: F42's control-plane launch makes every git call `git -C <path> …`, which matches no allow rule — first run blocks on permissions
**Symptom.** (RTO Tool, poly, ADO, `git.mode: remote`, run RTO-9118.) With F42 applied the canary
launched correctly, resolved `/aidlc:run`, fetched the item and routed to `core-api` — then stopped
dead before any write: *"every `git -C "D:/RTO Tool/core-api" ..." call and `az rest` is returning
'requires approval'."* Nothing written, board never touched. Corroborating: `az boards` worked while
`az rest` did not — exactly matching which patterns are and aren't in the allowlist.
**Root cause.** The template allowlist was entirely **bare-verb prefixes** (`Bash(git status:*)`, …).
`aidlc:run` §2.5 said poly steps run "with cwd = `<repo.path>`", which would keep git calls bare and
matching — but F42 pins the launch cwd at the control plane and the session cwd can't be changed, so
the natural implementation is `git -C <repo.path> <verb>`, matching **no** rule. F42 didn't introduce
the defect, it moved the wall one step later: pre-F42 the run couldn't start; post-F42 it starts and
then can't touch git. Every poly item hits this identically on its first git call. Separately,
`wi-ado`'s work-item-type states API needs `az rest`, which was absent from the template entirely.
**Resolution — `git -C` (allowlist widened, denies mirrored), not `cd &&`.** The reporter proposed
mandating `cd <repo.path> && git …` to keep bare-verb rules matching, calling it the safer option. It
does not work: Claude Code prompts for *any* compound command that `cd`s into a **different**
directory and then runs `git`, regardless of the allowlist, because git in a new directory can execute
that directory's hooks. That fix would have reproduced the same wall. So:
- **Template allows the poly verbs in `-C` form** (`Bash(git -C * status:*)` …) alongside the bare
  forms mono still uses. A bare `Bash(git -C:*)` was rejected as the reporter's security concern is
  correct — but the concern does **not** block the fix, because Bash rules support **mid-pattern
  wildcards**, so the denies mirror exactly: `Bash(git -C * push --force:*)`, `… -f`, `… reset --hard
  origin`, plus `Bash(git -C * rebase:*)` in `ask`.
- **Pre-existing deny gap closed while here:** `Bash(git push --force:*)` never matched
  `git push origin --force` (flag after the remote). Added `Bash(git push * --force:*)` / `-f` and the
  `-C` equivalents, in both forms.
- **Added `Bash(az rest:*)`.**
- **`aidlc:run` §2.5 now states the mechanism per command family** instead of the ambiguous "cwd =
  `<repo.path>`" that caused this: git → `git -C`; npm/docker/test/lint → `cd "<path>" && <cmd>` (a
  `cd` under the workspace root is read-only and each half matches independently, so bare rules keep
  applying — and note `npm --prefix` would miss the allowlist the same way `git -C` did); `gh`/`az
  repos` → pass the repo explicitly. Mono is unaffected: its cwd already is the repo.

### F44 🟡 — Template's `Write(...)` deny rules are no-ops and warn on every headless run
**Symptom.** Every headless run prints at startup: *"Permission deny rule (.claude\settings.json):
`Write(.claude/settings.local.json)` is not matched by file permission checks — only `Edit(path)` rules
are."* The adjacent `Edit(...)` deny is correct; the `Write(...)` one enforces nothing.
**Root cause.** Template authored assuming `Write(path)` is separately enforceable. Documented
behavior: file permission checks match only `Edit(path)` and `Read(path)`; a `Write(path)` rule is
accepted but never matched, and `Edit` already covers all file-editing tools including `Write`.
**Resolution.** Dropped both `Write(...)` denies — the reporter flagged
`Write(.claude/settings.local.json)`, but the identical no-op existed one line above at
`Write(.claude/settings.json)` and would warn the same way. The two `Edit(...)` denies already cover
both files, so enforcement is unchanged. Noise, not a functional hole.

### F45 🔴 — F43's `Bash(git -C * <verb>:*)` rules matched nothing; shipped without ever being executed
**Symptom.** (RTO Tool, poly, ADO, aidlc@0.24.0, run RTO-9118.) All 14 F43 allow rules verified present
in the live `.claude/settings.json`, yet no git command ran. Reporter probed five forms: every
`git -C …` spelling DENIED (quoted, unquoted, spaced path — ruling out the path and its space), while
bare `git status` ALLOWED (proving the allowlist loads). With F42 pinning cwd to the control plane and
F43 forbidding `cd`, a poly run had **no permitted route to git at all**.
**Root cause — narrower than reported, and the reporter's guess was wrong.** They concluded
`Bash(<prefix>:*)` is "a prefix match, not a glob," so mid-pattern `*` can never work. Mid-pattern
globs *do* work. Two undocumented matcher constraints, both established here by running headless
probes against a scratch workspace (CC 2.1.215) rather than by reading:
1. **`:*` does not compose with a mid-pattern `*`.** Probed identically: `Bash(git -C * add:*)` →
   DENIED, `Bash(git -C * add *)` → ALLOWED, `Bash(git * add *)` → ALLOWED, `Bash(git -C:*)` →
   ALLOWED, `Bash(git add:*)` → DENIED for a `-C` command. So F43's whole rule set was one wrong
   suffix away from working — every rule, allow and deny alike.
2. **Trailing ` *` does not match end-of-string** (the docs claim "space or end-of-string"). Caught
   only because the first corrected battery still failed two rows: bare `git -C <p> status` blocked,
   and — far worse — `git -C <p> push origin --force` **ran**, i.e. a deny that looked right and
   wasn't. Fixed with no-space `*`, plus exact-match rules for the bare-verb denies so
   `--force-with-lease` stays in `ask`.
**Security note.** The reporter's warning was correct and is why the allow side was not simply patched
with `Bash(git -C:*)`: that spelling works, so it would have produced a *working* allow beside a
*dead* deny — unguarded force-push. Failure modes are asymmetric: a dead allow rule blocks the run
loudly; a dead deny rule is silent. Deny coverage must be probed directly, never inferred from a
green run.
**Resolution.** All mid-glob rules moved to the `*` form and **verified by a 15-command battery
against the real template file**: legitimate poly calls (`status`/`fetch`/`add`/`commit`/`branch`,
with and without trailing args) RAN; every force-push and hard-reset variant BLOCKED in both bare and
`-C` form — including `push origin --force` and `reset --hard origin/main`; benign push and the mono
bare form unaffected. `aidlc:run` §2.5 now records both constraints inline so the next editor of
those rules doesn't rediscover them.
**Process.** The reporter's core criticism is accepted: F43 was authored against documentation and
shipped unexecuted, and the documentation is wrong on both points above. The architectural change they
proposed (per-repo `.claude/`, launch with cwd = repo) was **not** taken — it is a large change aimed
at a defect that turned out to be a one-suffix bug — but it is the right fallback if these rules prove
fragile again.

### F46 🔴 — Guard read HEAD from the session cwd, so every poly feature-branch push was blocked (and an unquoted spaced `-C` path silently disabled the guard)
**Symptom.** (RTO Tool, poly, ADO, aidlc@0.25.0, run RTO-9118.) With F45's `git -C` permissions
working, the run reached the push step and was blocked: *"push while on protected branch 'main'"* —
while `core-api` was verifiably on `feature/RTO-9118-seed-governance-files`. The only repo on `main`
was the control plane, i.e. the session cwd. Fires twice per item (feature push, then run-archive
push), and it fires on the *correct* case, which trains users to bypass a safety hook.
**Root cause.** `guard.mjs` resolved every repo-state check against `data.cwd`: `branchInfo()` ran
`git symbolic-ref --short HEAD` there, and `stagedGitlinks()` inspected that index. Harmless in mono,
where cwd *is* the repo; always wrong in poly, where F42 pins cwd at the control plane (permanently on
`main`) and F43 mandates `git -C`. Reproduced exactly against a fixture before any edit.
**Second defect, found while reproducing — a fail-OPEN bypass the report didn't reach.** Command
identity was matched by regex over quote-blanked text (`git(?:\s+(?:-C\s+\S+|…))*\s+push`). An
**unquoted** `-C` path containing a space splits into two tokens, the pattern fails, and **every push
check is skipped**: `git -C <spaced path> push --force origin main`, `… push origin HEAD:main`, and
`git -C <spaced path> filter-branch` all returned rc=0. The workspace root is literally `D:\RTO Tool`,
so this shape is reachable. A guard must fail closed on a parse miss.
**Resolution.** Replaced the regex identity layer with a quote-aware tokenizer plus a real
`git [global-opts] <subcommand> [args]` parse:
- `-C` is extracted and every repo-state check resolves against **that** repo (`resolve(cwd, dashC)`),
  including `stagedGitlinks()` — a third instance of the same bug, which had `git -C <repo> commit`
  inspecting the control plane's index instead of the target's.
- A quoted argument is one opaque token, so a commit message mentioning `push`/`DROP TABLE` can never
  be read as a command — the old `stripQuotes` hack is gone.
- Refspec checks now parse actual refspecs (`HEAD:main`, `:main`, `+main`, `--delete main`) instead of
  matching a protected name anywhere in the line.
- **Fail-closed rescan:** if the subcommand slot lands on a path fragment (the unquoted-spaced-`-C`
  anomaly), the guard rescans for a guarded subcommand and checks it with the repo target treated as
  unknown, rather than allowing.
**On the reporter's suggested fix (2)** — "check the pushed refspec, not the checked-out branch":
refspec checking already existed (`targetsProtected`, covering `HEAD:main`/`:main`/`--delete`, with
passing tests). Blocking *all* pushes from a protected HEAD is deliberate defence-in-depth, and it
becomes correct — not over-broad — once HEAD is read from the right repo, so it was kept. Fix (1) was
the whole bug.
**Verification.** 12 poly regression tests added to `guard.test.mjs` against a control-plane fixture
whose path contains a space: legitimate `-C` feature push / status / commit allowed; `-C` pushes
targeting `main`, `HEAD:main`, force-push and `filter-branch` blocked; bare push from the control
plane on `main` still blocked; both unquoted-spaced-path bypasses now blocked. **52/52 pass** (40
pre-existing, unchanged).

### F47 🟢 — Headless ADO runs use the `az` CLI tier because no `mcp__*` tools are allowlisted
**Symptom.** The template carries no `mcp__*` allow entries, so a headless run cannot call
`mcp__…azure-devops__wit_get_work_item`; one run reported ADO as "gated" despite everything working.
**Assessment — documentation, not a defect.** `az boards`/`az rest` are allowlisted and carried every
tracker and PR operation for the whole run; that is exactly the tier-2 fallback `wi-ado` documents.
The real problem was that a tier-1 denial *reads* as breakage.
**Resolution.** `wi-ado` tier 2 now states that headless runs land there **by design**, that ADO should
be reported as working rather than gated, and that a tier-1 denial alone must not escalate to the PAT
tier. **No allow rule was added:** an MCP allow rule needs the literal `mcp__<server>__` prefix as it
appears in that session, and a plugin-provided server's exact prefix could not be confirmed here — a
bare `mcp__*` allow rule is skipped with a warning and grants nothing. Guessing a permission pattern
unverified is precisely what caused F43 and F45, so the skill instead tells the user how to read the
real name (`/mcp`, `--verbose`) and add it themselves.

_Add further findings here as they surface during dogfooding._

## Validated — working as designed (no change needed)

_None yet this cycle._

## Append log

- 2026-07-19 — **F42** logged and shipped on its own (🔴, `/aidlc:sprint` dead on arrival in poly —
  a core flow blocked with a silent rc=0 failure, so it did not wait for the cycle batch).
- 2026-07-17 — Cycle 4 opened. Cycle 3 (**F34–F41**) shipped at marketplace **0.18.0** (F34–F40) +
  **0.18.1** (F41) and its full record was archived to `dogfood-findings-archive.md`; this file reset
  fresh. Log new findings below as dogfooding continues (next id **F42**).
