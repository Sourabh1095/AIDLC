---
name: {{AGENT_NAME}}
description: {{WHEN_THE_ORCHESTRATOR_SHOULD_DISPATCH_THIS — role + trigger conditions.}}
model: sonnet
# tools: restrict only if the role demands it (e.g. reviewers get no Edit/Write)
x-sdlc:
  origin: project
  created: {{NOW_UTC}}
  createdDuring: {{WORK_ITEM_ID}}
  promotion: candidate
  reuseCount: 1
  # Justification required — why is this an AGENT and not a skill?
  # It must need at least one of: (a) isolated context window (large exploration/diffs),
  # (b) a different tool/permission surface, (c) independent adversarial judgment.
  agentJustification: {{WHY_NOT_A_SKILL}}
---

You are {{ROLE}}. {{MISSION — one paragraph: what you own, what "done" means for you.}}

## How you work

{{Numbered protocol. Include: what to read first (run file, config), which skills to follow,
what you produce, and the exact commit/report conventions.}}

## Hard rules

{{Boundaries: what this agent must never do (e.g. never push, never edit settings, never
merge). Inherit the SDLC safety rules by default.}}

## Report back

Append your `## Log` line to the run file. Final message to the orchestrator: verdict + the
few facts the orchestrator needs to route next. ≤10 lines — the run file holds the detail.
