---
name: scaffold-agent
description: Create a new project-local subagent from the AIDLC template and register it in the extensions registry. Use only when a needed role passes the agent test — it requires an isolated context window, a different tool/permission surface, or independent adversarial judgment — and no existing agent or skill covers it.
argument-hint: "<agent-name> [one-line mission]"
---

# scaffold-agent — create a project-local agent (higher bar than a skill)

## 0 · The agent test — justify or scaffold a skill instead

An agent is justified ONLY if the role needs at least one of:
- **(a) isolated context** — large exploration/diffs that would drown the caller's context;
- **(b) different tool/permission surface** — e.g. read-only enforcement, scoped MCP access;
- **(c) independent judgment** — its value comes from NOT sharing the requester's reasoning
  (reviewer-shaped roles).

Knowledge alone is a SKILL (`scaffold-skill`) loaded by an existing agent. When in doubt: skill.
**Check the agents already installed first** — every AIDLC plugin ships some (core the pipeline roles,
`aidlc-ux` the design pod), and most "new agent" needs are really "existing agent + new skill". List
what is actually installed rather than working from a remembered count.

## 1 · Scaffold

1. Name: kebab-case role (`load-tester`, `contract-checker`); don't prefix with `aidlc-`
   (that namespace is reserved for plugin-shipped agents in any AIDLC plugin, not just core).
2. Instantiate `${CLAUDE_PLUGIN_ROOT}/templates/agent-template.md` → `.claude/agents/<name>.md`.
   Fill everything, including `x-aidlc.agentJustification` — state WHICH of (a)/(b)/(c) applies
   and why. An agent whose justification you can't write crisply should be a skill.
3. Restrict `tools:` per `aidlc:agent-contract` → *Tool restriction policy*. Two rules from there that
   are easy to get wrong: an agent that appends to the run file **needs `Edit`** (a `Read/Grep/Glob/
   Bash` "read-only" list cannot write its own findings), and you never guess an MCP tool id to
   tighten a list. Choose `model:` by judgment depth: haiku mechanical · sonnet default · opus
   deep/adversarial.
4. Follow `aidlc:agent-contract` for the finish contract and the report-back shape — the template
   carries the four-line inline version; keep it verbatim.

## 2 · Register & commit

Append to `.aidlc/extensions.json → extensions[]` (same shape as skills, `"kind": "agent"`,
plus `"agentJustification": "..."`). Commit with the current branch:
`chore(aidlc): scaffold <name> agent`.

## 3 · Wiring into the pipeline

The orchestrator dispatches local agents exactly like core ones. If the new agent should run
at a standard phase (e.g. an extra verify-batch member), note that in the agent's
`description:` — the orchestrator reads descriptions when routing. Reuse tracking as for
skills: bump `reuseCount` on each dispatch; `>= 2` makes it a promotion candidate.
