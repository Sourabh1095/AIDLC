---
name: study
description: Write the business study of the product from the project brain — what the product is and for whom, every user type and what each can do, every module (purpose, capabilities, rules, data, connections), the end-to-end flows, the data, integrations, key decisions, delivery history, intended versus built, and the open questions. Every claim traces to the code, a requirement or a person; assumptions are kept apart as questions. Use when a project ends, for a handover, or when asked for a document that explains the whole product.
argument-hint: "[--out <path>] [--refresh]"
---

# /aidlc:study $ARGUMENTS — the business study

Load `aidlc:brain` first. `B` below is `node "${CLAUDE_PLUGIN_ROOT}/skills/brain/brain.mjs"`, and
`<ws>` is the workspace root.

The study is **assembled from the brain**, not from a fresh read of the code. The brain is that read,
done over the life of the project and kept checked against the code. A product of any real size does
not fit in one context, and a study written from a cold read would be the shallow version of what the
brain already holds.

## 1 · What the brain knows, and what it does not

`B digest <ws> --json`, then say in one line: pages, how many are behind, how many were never learned,
open assumptions, and code modules with no page.

- **No module pages** → a study needs the brain first. Offer `/aidlc:learn` (it maps the modules) and stop.
- **Pages behind the code** → offer to refresh them first (`/aidlc:learn --stale`); `--refresh` does it
  without asking. Otherwise each section built on a behind page will say so.
- **Modules never learned, or with no page** → offer `/aidlc:learn <module>` for the ones that matter,
  with the cost said out loud. Otherwise they are listed as not covered.

Ask once, then go ahead with what the user chose. **A study says what it does not cover.** Implying
it is complete when it is not is the one failure this document cannot afford.

## 2 · Gather what the brain does not hold

Read summaries, not code:
- **The pages:** `overview.md`, `actors.md`, `glossary.md`, `flows/*`, and each module page (the
  digest already carries their sections).
- **Intended scope:** epics and features with their state (`aidlc:work-items` → *query*), and the
  titles of the requirement IDs the digest lists.
- **Decisions:** `docs/adr/`, the decision and its why. For a retroactive ADR whose rationale was
  never recorded, say that rather than inventing one.
- **Design:** `design/` when `aidlc-ux` was used — the design system and the narrative.
- **Operations:** `.aidlc/facts.md`, and the `saas` runtime constraints in config.
- **History:** `.aidlc/journal.md` and its archive — what was delivered when, releases, re-plans.

## 3 · Write it

Write to `--out`, default `.aidlc/brain/study/business-study-<YYYY-MM-DD>.md`. That keeps it as
private as the brain until the user decides to share it. Write it **section by section, appending to
the file**: one giant message is where long documents get truncated.

1. **Executive summary** — half a page: what the product does and for whom; its shape (modules, user
   types, main flows); what is built against what was intended; the three most important open questions.
2. **The product** — the problem, the users and the value (`overview.md`, the epics).
3. **User types** — each type and what it can do, plus a matrix of user type × module built from every
   page's *Who uses it*.
4. **Modules** — one subsection each: purpose, capabilities, business rules, data it owns, what it
   connects to, entry points. Business language; code paths only as a closing *Sources* line.
5. **End-to-end flows** — numbered steps, each naming its module. Add a Mermaid sequence diagram for
   any flow longer than six steps.
6. **Data** — entities by the module that owns them, and who reads them.
7. **Integrations** — the external services, and what each is used for.
8. **Key decisions** — one line per ADR: the decision and why.
9. **Operations** — the facts and runtime constraints that shape running the product.
10. **Delivery history** — a timeline from the journal: what was delivered, when, and the major re-plans.
11. **Intended versus built** — from `[req]` lines against the code: delivered, partly delivered, not
    built, built without a requirement.
12. **Open questions and assumptions** — every `[assumed]` line from the digest, grouped by module and
    phrased as a question to confirm, plus each page's *Gaps & questions*.
13. **Glossary**.

- **Appendix A — Coverage and freshness:** each module, the commit its page was checked against, and
  its state when the study was written; the modules not covered.
- **Appendix B — Sources:** the requirement IDs, ADRs and pages the study rests on.

## 4 · Rules of truth

- `[code]`, `[req]` and `[told]` lines may be stated as fact. Keep *intended* and *built* apart wherever
  they differ: that difference is §11's whole subject.
- **`[assumed]` never appears as fact.** It lives in §12, as a question.
- A section built on a page that is behind opens with one line saying so, and naming the commit.
- Invent nothing: no user type, flow, figure or integration that is not in the brain or the sources.
  A missing section says what is missing.
- No secrets, credentials, personal or customer data, and no code listings.

## 5 · Finish

Report the file path, its length, the coverage line from §1 and the number of open questions. Offer
two follow-ups: walk the user through §12 to turn assumptions into `[told]` lines in the brain, and
share the study (copy it into `docs/`, or convert it to a Word document if they want one).
