# AIDLC behavioural evals

The unit suites (`*.test.mjs`) pin the scripts. These pin the **prompts**: they start a real Claude
session with the plugin loaded, give it a task in a small sample repo, and grade what it did — next to a
**baseline arm with no plugin**, so every score is also a measurement of what AIDLC changes.

## The fixture

`fixtures/web-app` is a small React + TypeScript app that already has the things a model tends to
re-write: a `usePagination` hook, a `Pagination` control, a `Button` and a `formatDate` helper.
`fixtures/aidlc` makes it an AIDLC project (mono, markdown backlog, direct ceremony). Each case's
`scaffold.sh` sources `fixtures/setup.sh`, which copies both into the run's workspace, commits them, and
builds the reuse catalog (`.aidlc/catalog/web.md`) — so the cases need no shell tool to see it.

## The cases

| Case | Task | Passes when |
|---|---|---|
| `reuse-plan` | plan pagination for two screens, write `PLAN.md` | the plan uses the existing hook and control and writes no new pagination code |
| `reuse-implement` | add pagination to the orders screen | `orders.tsx` calls `usePagination` and renders `<Pagination>`, no new pagination file, no hand-rolled paging |
| `ceremony-direct` | `/aidlc:do fix the typo "Dashbaord" in the header` | fixed, with no work item and no run file — a typo stays a direct change |

**An eval session does not load the project's `CLAUDE.md` or `.claude/rules/`** (verified with a probe:
instructions in both were ignored). The plugin's hooks, skills and agents do load. So anything the
plugin wants every session to know must reach it through the plugin itself — the SessionStart hook
(`session-context.mjs`) — not only through a scaffolded file. That is also true of a real project
initialised before a rule file shipped, which is why the reuse instruction lives in both places.

None of them grant a shell tool. That is deliberate: Claude Code only runs a shell-granting eval inside
an OS sandbox, which Windows does not have, and these cases should run on the machine the plugin is
developed on. Cases that need the full pipeline (git, the gate, `/aidlc:run`) need `Bash`, so they run
on a machine with a sandbox — macOS, Linux or WSL — the same way, on the same login.

**They run on your Claude login, not an API key.** `claude plugin eval` copies your own credentials into
each run (`claude auth status` shows `authMethod: claude.ai` on a plan), so a run draws on your plan's
usage like any session. The `costUsd` it reports is a cost-equivalent estimate, not a charge. Nothing in
AIDLC needs `ANTHROPIC_API_KEY`, and there is deliberately no CI workflow that would.

## Running

From `plugins/aidlc-core`:

```bash
claude plugin eval . --trust-plugin --scaffold --no-publish \
  --allow-tools Write Edit --disallow-tools Agent TaskStop \
  --model sonnet --runs 3 --threshold 0.67
```

- `--scaffold` runs the cases' `scaffold.sh` (it is ours; it only copies the fixture and runs git/node).
- `--allow-tools Write Edit` is required: without it nothing can write `PLAN.md` or edit a screen, and
  every file grader fails.
- `--disallow-tools Agent TaskStop` keeps a run to the main session — cheaper, and the cases test the
  skills, not subagent dispatch.
- `--case reuse-plan --runs 1` for a quick check. One full pass is 3 cases × 3 runs × 2 arms = 18 Sonnet
  sessions of a few turns each; the report lands in `evals/results/<timestamp>/report.html` (gitignored).
- `--ablation none` skips the baseline arm when you only want the plugin's score.

Read the **delta** column, not only the score: a case the baseline also passes is not evidence that the
plugin helped. The reuse cases are the ones to watch when changing `aidlc:reuse`, `aidlc:planning` or
the implementer prompt — run them before and after.
