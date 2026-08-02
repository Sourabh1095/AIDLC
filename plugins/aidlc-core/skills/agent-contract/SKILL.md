---
name: agent-contract
description: The contract every AIDLC subagent owes its orchestrator — the finish contract (never return on a pending background task), the report-back shape, and the tool-restriction policy that decides which agents get a `tools:` allowlist. Load when writing, reviewing or scaffolding an agent, or when an agent returned something the orchestrator could not act on.
user-invocable: false
---

# Agent contract — what every subagent owes the orchestrator

Every AIDLC agent runs in its own context and returns one message. The orchestrator routes the whole
pipeline off that message, so the message is the interface, not a courtesy. This skill is the single
home for the parts of that interface every agent shares; each agent's own file carries only the
binding one-liner plus whatever its role adds.

**This applies to every agent in every AIDLC plugin** — core, UX, and any project-local agent
scaffolded by `aidlc:scaffold-agent`. `aidlc:run`'s orchestrator invariants (*"a subagent's non-verdict
is NOT a phase result"*) are written assuming it, so an agent that doesn't carry it breaks a promise the
orchestrator has already made.

## 1 · The finish contract

**Never return on a pending background task.** If you launched anything long-running in the background
— a build, a test suite, a dependency install, a container start, a dev server, a CI/pipeline run —
then before returning you MUST either:

- **(a) block until it reaches a terminal state** and act on the result; or
- **(b) return an explicit `BLOCKED` / `INCOMPLETE` verdict** that names every still-pending task and
  every uncommitted path you are leaving behind.

*"Still running — I'll wait for the notification"* is **not** a verdict. The orchestrator cannot trust
it and is forced to re-derive your work, which costs more than doing it synchronously would have.

The order is always **verify → commit → report**, synchronously. Never leave the working tree dirty
behind an optimistic return: a regenerated lockfile, an un-ticked plan checkbox, an un-committed
run-file edit are all dirty state — commit them or enumerate them in the verdict, never leave them
hanging.

### The three role variants

- **Waiting on CI or a pipeline** (devops) — poll the run to a terminal state yourself (`gh run watch`
  / `az pipelines runs show` in a loop, or block on the container command). Never hand a still-running
  build back to the orchestrator as a result.
- **Fan-out mode** (implementer, parallel window) — the commit step is the orchestrator's, so leaving
  your files uncommitted is correct there. The *enumerate* half gets stricter, not looser: the order
  becomes **verify → enumerate → report**, and every path you changed **or created** must be named. An
  unnamed file is an uncommitted file. Uncommitted-and-listed is the contract;
  uncommitted-and-unmentioned is lost work.
- **Read-only agents** (reviewer, security, jury, fidelity) — there is nothing to commit, so the order
  is **verify → report**. You still owe a terminal verdict rather than a pending one.

### Why this is a contract and not advice

It has failed in production more than once (F37/F40) across different agents, which is what makes it a
shared rule rather than one agent's prompt problem. `aidlc:run` → *Orchestrator invariants* describes
the recovery: on a non-verdict the orchestrator ground-truths the tree itself, re-runs the phase's
gate, and takes over. That recovery is expensive and it is the reason this rule exists.

## 2 · Report back

- **Append a `## Log` line to the run file** (`- <UTC> <agent>: <one-line summary>`), plus whatever
  section your role owns (`## Plan`, `## Findings`, `## Assumptions`). Agents **append**; they never
  rewrite another agent's section.
- **Your final message is a verdict plus routing facts, not a transcript.** The orchestrator reads
  verdicts; the run file holds the detail. ≤10 lines unless your role's file says otherwise.
- **Verdicts are from your role's fixed set** (`COMPLETE` / `BLOCKED` / `PASS` / `APPROVE` /
  `FINDINGS: …` / `ITERATE` / …). A prose summary with no verdict token is the non-verdict this
  contract exists to prevent.
- **Never claim a result you did not observe.** "Tests pass" requires the runner's summary line pasted
  in. An honest `NO-DOCS-NEEDED` or a clean `APPROVE` with two sentences of evidence is a good outcome;
  invented findings to look thorough are not.

## 3 · Tool restriction policy — when an agent gets a `tools:` allowlist

`tools:` in agent frontmatter is an **allowlist**: naming it grants exactly those tools and nothing
else. That makes it the right instrument in some cases and the wrong one in others, so the rule is
explicit rather than per-agent taste:

| Agent shape | `tools:` | Why |
|---|---|---|
| Reads and judges, no MCP beyond a server this plugin declares (reviewer, security, architect, researcher, ux-writer, ux-researcher) | **restricted** | The prohibition *is* the role, and the tool ids are verifiable here, so the list closes it mechanically. |
| Writes product code (implementer, devops, motion, design-system) | **unrestricted or write-inclusive** | It needs the write tools; the real boundary is which *paths*, which `tools:` cannot express. |
| Calls the tracker adapter (analyst, and anything running `adapter.*`) | **unrestricted** | Adapter ops resolve to Jira/ADO MCP tool ids that vary per server and per session (`aidlc:wi-ado` → the literal `mcp__<server>__` prefix problem). An allowlist here would silently strip the adapter. |
| Drives a third-party MCP whose scoped tool ids this plugin cannot state portably (jury, fidelity → Playwright; figma → the Figma MCP) | **unrestricted, deliberately** | Playwright exposes ~70 capability-gated tools and is tracked unpinned; the Figma server's plugin-scoped prefix is resolved by the harness, not by us. A wrong or stale id doesn't warn — it removes the capability, and a jury that cannot render is a worse failure than one that could theoretically edit. |

Two rules follow, and both have bitten:

- **An agent that appends to the run file needs `Edit`.** Every agent owes a `## Log` line and most
  owe a section (`## Findings`, `## Plan`). A `tools:` list that grants `Read, Grep, Glob, Bash` and
  calls itself read-only cannot do that at all — it forces a `cat >>` workaround through Bash, which
  is strictly worse than granting `Edit` and stating the boundary. Grant `Edit` (and `Write` where the
  role creates a file, e.g. the architect's ADR) and keep "never product code" in *Hard rules*.
- **Never guess an MCP tool id to tighten a list.** If a restriction is genuinely wanted there, pin
  the MCP server version first and enumerate against the pinned version, in that order.

**Where `tools:` cannot express the boundary, the agent's *Hard rules* carry it** — and the
orchestrator never routes a fix to a judging agent, so the read-only guarantee for the jury and the
fidelity checker is structural as well as stated.

## 4 · Writing a new agent

`aidlc:scaffold-agent` owns the agent-vs-skill test. Once an agent is justified, it inherits this file:
reference it, add the one-line finish rule inline (so it binds even if this skill never loads), and
spend the agent's own body on what only that role knows — its brief, its modes, its verdict set.
