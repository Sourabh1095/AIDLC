---
name: review-feedback
description: Pull a human reviewer's comments off an open PR and work them like pipeline findings — fetch the unresolved threads (GitHub or Azure Repos), record each against the run file with its author, fix them through the normal fix cycle, push, and reply on each thread. Use when a PR has review comments to address, when asked to handle review feedback, or when resuming a run whose PR came back with changes requested.
argument-hint: "<work-item ID, or a PR URL/number>"
disable-model-invocation: true
---

# /aidlc:review-feedback $ARGUMENTS — work the reviewer's comments

The pipeline's own verification (`aidlc:run` §7) is adversarial but internal: the reviewer agent, QA and
security all read the diff before anyone else sees it. Then the PR opens and **a person reads it** — and
on a team that person's comments are the single most frequent input the pipeline receives. Until this
command existed there was nowhere for them to go: `run` §10 stamps the run `done`, and
`aidlc:run-state`'s resume protocol answers a `done` run with *"nothing to do."* So the most common
daily interaction on a team dead-ended in the one place the framework claimed to be complete.

Review comments are **findings with a name on them**. Everything the fix cycle already does applies —
severity, `[open]`/`[resolved]`, `maxFixCycles`, the implementer working from a finding list. What is
different is that a human wrote them, so two rules bind that do not bind a pipeline finding:

> **Never resolve a thread the reviewer did not agree was resolved, and never silently decline one.**
> A pipeline finding you disagree with can be argued down in the run file. A person's comment gets an
> answer *on the thread*, in their words' context — including "no, and here's why", which is a
> legitimate outcome and must be visible to them rather than buried in a run file they will never open.

## 0 · RESOLVE THE RUN

1. `$ARGUMENTS` is a work-item ID → find its run file; a PR URL/number → read the item ID from the PR
   (branch name, or the run file committed on the branch). Neither resolvable → list the open PRs this
   pipeline opened (run files with a `pr:` and a non-merged PR) and ask.
2. **Check out the PR's branch** in the resolved repo (`aidlc:work-items` → *Repos & routing*;
   cwd = `workspace.root`/`<repo.path>`). Everything below happens on that branch.
3. `mode: local` has no PR and therefore no threads — this command does not apply. Say so and point at
   `/aidlc:run <ID>`, which is where a local-mode review lands (`aidlc:git-workflow` → *Local mode*).

### Un-archive the run file (F23's counterpart)

`run` §10 archives the run file **on the branch** as its final commit so it merges in already archived.
That is correct for a run that ends at merge — and it means an open PR's run file is usually sitting in
`runs/archive/`. Working it in place would leave `/aidlc:status` showing an archived, finished run while
you are actively changing code, which is exactly the invisibility this framework spends its effort
avoiding. So:

```bash
git mv <repo.path>/.aidlc/runs/archive/{ID}.md <repo.path>/.aidlc/runs/{ID}.md
```

Set `phase: verify`, bump `updated:`, add a `## Log` line. It re-archives at §5 the same way it did the
first time. If the file is already in `runs/` (a run parked at `review-pending`, or a second feedback
round), there is nothing to move.

## 1 · FETCH THE THREADS

Only **unresolved** threads, and only ones written by a person — bot comments (CI, coverage,
dependabot) are not review feedback and drown the real ones.

### GitHub (`host: github`)

```bash
gh pr view <pr> --json reviews,reviewDecision,state,mergeable
gh api graphql -f query='
  query($owner:String!,$repo:String!,$pr:Int!){
    repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
      reviewThreads(first:100){ nodes{
        id isResolved isOutdated path line
        comments(first:20){ nodes{ author{login} body createdAt } } } } } } }' \
  -F owner=<owner> -F repo=<repo> -F pr=<n>
```

`reviewThreads` is the one that matters — `--json comments` returns only top-level PR conversation and
misses every inline code comment, which is where review feedback actually lives. Keep each thread's `id`
(needed to reply and resolve), `path`, `line`, and `isOutdated` (the code moved under the comment — still
address it, but read it against the current file).

`gh api graphql` is on the project's **ask** list, not the allowlist — the same endpoint that reads
threads also mutates them, and no permission rule can tell the two apart (`docs/permissions-rationale.md`).
So expect a prompt here and at §4's resolve step. That is the design, not a misconfiguration: don't
route around it, and don't ask the user to allowlist it.

### Azure Repos (`host: azure-repos`)

```bash
az repos pr show --id <pr> --query "{status:status,votes:reviewers[].vote}" -o json
az rest --method GET --resource 499b84ac-1321-427f-aa17-267ca6975798 \
  --url "https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullRequests/{pr}/threads?api-version=7.1"
```

Keep threads whose `status` is `active` or `pending`; skip `closed`/`fixed`/`wontFix` and every thread
carrying a `CodeReviewThreadType` system property (ADO logs pushes, votes and policy events as threads —
they are not comments). A reviewer vote of **-10 (rejected)** or **-5 (waiting for author)** is itself a
finding even when no thread explains it; record it and ask what they wanted rather than guessing.

## 2 · RECORD THEM AS FINDINGS

Append to the run file's `## Findings`, one line per thread, **attributed and addressable**:

```
- [MAJOR][open] review(@priya) src/api/avatar.ts:42 — validate content-type before trusting the extension · thread:PRRT_kwDO
- [MINOR][open] review(@rahul) src/api/avatar.ts:88 — prefer the shared `assertOwner` helper · thread:PRRT_kwEP
```

- **Severity is the reviewer's, inferred conservatively.** "This will break for tenant X" is a BLOCKER
  whether or not they said so; "nit:" and "optional:" are MINOR. When a comment's weight is genuinely
  unclear, treat it as MAJOR — a person took the trouble to write it. Never downgrade a comment because
  fixing it is inconvenient.
- **Keep the thread id.** It is how §4 replies and resolves; a finding with no thread id can be fixed but
  never answered, which is the half that matters to the reviewer.
- **A question is a finding too.** "Why not use the existing helper?" needs an answer on the thread; it
  may or may not need a code change. Do not close it by making the change silently — they asked *why*.
- Existing `[open]` findings from §7 stay open. A human reviewer looking at unfixed pipeline findings is
  a separate problem and this command must not hide it.

Checkpoint the run file, then `adapter.comment(ID, "AIDLC: <n> review comments picked up from <PR url>")`.

## 3 · FIX

Dispatch **aidlc-implementer** with **only the open review findings**, exactly as `run` §7's fix cycle
does — same brief shape, same run-file contract.

**Its budget is its own: `reviewRounds`, capped at `pipeline.maxFixCycles`, counted separately from
`fixCycles`.** Sharing one counter would mean a run that spent three internal cycles arguing with its own
reviewer arrives at a human's first comment already blocked — the pipeline's difficulty with itself is
not evidence about whether a reviewer's point can be addressed. Separate counters, same ceiling: a PR on
its fourth round of human feedback needs a conversation, not a fourth automated attempt, and at that
point phase → `blocked` with the open threads named.

Then re-run the **project's gate** (`resolve-gate.mjs`, `run` §7) — the reviewer's change is a change like
any other and can break the suite. Also re-run `aidlc:git-workflow` → *Base drift*: a PR that has been in
review for two days is exactly the branch whose base has moved.

**Re-dispatching the reviewer agent is not the default.** It reviewed this diff already and its findings
are resolved; the open question is whether the *human's* comment was addressed, which the human answers
at §4. Re-dispatch it only when the fix is substantial enough to be new code rather than a correction —
a rewritten function, a new code path — and say why in the run file.

**A comment you disagree with is not a fix cycle.** Skip it in the implementer brief, mark it
`[open][disputed]`, and answer it on the thread at §4 with the reasoning. Then stop and tell the user
there is a disagreement outstanding — do **not** merge over it and do **not** keep arguing in the run
file. It is the reviewer's call whether their comment stands.

## 4 · PUSH AND ANSWER

1. Commit per the project's `commitStyle` — `fix(avatar): validate content-type before trusting extension`
   with `Refs: <ID>` (plus the bound Task id where the plan line carries one). One commit per logical
   fix, not one per thread.
2. Push to the PR branch. **Never force-push a branch under review** — it detaches every inline comment
   from its line and destroys the reviewer's place in the diff. If history genuinely must be rewritten,
   that is the user's call to make explicitly.
3. **Reply on every thread**, one line each, naming the commit: `Fixed in <sha> — content-type is now
   checked against the sniffed type.` / `Answered: the shared helper assumes a single-tenant caller, see
   <sha> for the comment explaining it.` / for a disputed one, the reasoning and nothing else.
4. **Resolve only what you fixed, and only where the host lets the author resolve.** GitHub:
   `gh api graphql` `resolveReviewThread` on threads whose fix landed. ADO: set the thread status to
   `fixed`. **Never resolve a `[disputed]` thread and never resolve a question you merely answered** —
   the reviewer resolves those, and pre-resolving them is how a comment gets lost.
   Some teams configure the reviewer as the only one who may resolve; if the call fails that way, leave
   the reply and say so.
5. Update each finding to `[resolved]` (or leave `[open][disputed]`), checkpoint, and
   `adapter.comment(ID, "AIDLC: <n> review comments addressed in <sha>; <m> disputed")`.

## 5 · WRAP

Re-archive the run file on the branch as the final commit, exactly as `run` §10 does
(`git mv` → `runs/archive/`, `chore(aidlc): archive run {ID}`, `--no-verify`, verify it landed before
pushing) so it merges in already archived. Then report in ≤6 lines:

```
PROJ-124 · 6 review comments from @priya, @rahul
  fixed      5 (2 commits, gate green, base merged)
  disputed   1 — @rahul's `assertOwner` suggestion; replied on thread, needs their call
  pushed     feature/PROJ-124-user-avatar-upload → PR #42
  next       @priya to re-review; item stays in_review
```

The item stays `in_review` and the run stays awaiting merge — **this command never merges and never
transitions to done.** The human gate (D6) is the point of the PR, and a pipeline that closed its own
review loop would have removed the one gate the framework promises to keep.

## Rules

- **Attribution is not decoration.** Every finding carries who wrote it, because the answer goes back to
  a person and because a disputed comment needs a name attached when it reaches the user.
- **Never resolve a thread you did not fix.** The single most damaging thing this command could do is
  make a reviewer's unaddressed comment disappear from their queue.
- **Bot comments are not review feedback.** Filter them at §1; a coverage bot's 40 line comments would
  otherwise become 40 findings.
- **Outdated threads still count.** `isOutdated` means the code moved, not that the point was answered.
- `reviewRounds` is capped at `pipeline.maxFixCycles` and counted **separately** from `fixCycles`.
  Exhausted → phase `blocked`, name the unresolved threads and their authors, report, stop.
