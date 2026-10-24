# do — consult

Part of the `aidlc:do` skill, kept apart so the runs that do not need it do not load it. Read when §2 routes the prompt to CONSULT — an opinion, fit or should-we question.

## 3 · CONSULT — the route that had no home before this door

This is the prompt you would otherwise answer cold, and the whole value is the grounding.

1. **Frame it**: restate what is being judged in one sentence, and name the criteria you will judge
   against — drawn from *this project* (its ADRs, stack, declared repo roles, backlog direction),
   not generic best practice.
2. **Ground it** against the floor from §1, plus targeted reads:
   - **Architecture** — which repo would own it, does that repo's `role` cover it, does an ADR
     already settle or contradict it?
   - **Backlog** — is it already there, adjacent to something, a duplicate, or a dependency of an
     open item? Does it collide with an in-flight run's branch?
   - **Stack** — supportable as-is, or does it need a new dependency (which the dep-vet hook gates,
     so treat "needs a new package" as a real cost, not a footnote)?
   - **Runtime constraints** (`saas`) — the cost multiplier a stack answer misses. Would it need a
     schema change against live tenant data (expand/contract, plus a backfill)? Touch a public API
     contract (a breaking change for every integrator)? Need a feature flag because that is how this
     project ships? Land in an auth or tenant-isolation path (mandatory security review)? Fall inside a
     compliance regime? A feature that is trivial in the abstract is often an L here, and saying so is
     the most useful thing this door does.
   - **Cost** — rough size (S/M/L) and what it would touch.
3. **Escalate only if the answer needs it** — `aidlc-analyst` when real codebase grounding is
   required beyond a targeted read; `aidlc-architect` only when the decision is genuinely hard to
   reverse (a new service, a data model, a cross-repo contract, a dependency you would live with).
   One agent, not a panel. Most consults need neither.
4. **Answer**: one **recommendation with a confidence level**, the strongest argument against it,
   and what would change your mind. Say *"it doesn't fit, and here is why"* when that is the answer —
   a consult that always agrees is worthless.
5. **Journal the conclusion** (`aidlc:journal`) — one line, the question and the answer, not the
   reasoning:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/journal/journal.mjs" append <workspace-root> consult \
     "<the question>? → <the answer> (<the ADR or evidence>), confidence <level>"
   ```

   This is the entry that earns the journal its keep. A consult ends with **no artifact** by design
   (§Rules), which is right for ceremony and wrong for memory: without this line the next session has
   no idea the question was ever asked, and will happily re-derive a different answer. The pointer is
   what matters — where to read why, not a summary of why.

6. **Offer at most one next action**, then stop:
   - worth building → `/aidlc:run <requirement>` (or `/aidlc:intake` to just file it)
   - a real architectural decision → offer to record an ADR in `docs/adr/`
   - the answer needs evidence you do not have → offer a **spike item** (`aidlc:research` runs it,
     and it needs an item to run against)
   - not worth doing → say so and stop. No artifact.
