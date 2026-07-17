---
name: scaffold-skill
description: Create a new reusable project-local skill from the AIDLC template and register it in the extensions registry. Use when a needed capability (a procedure, convention or integration pattern) does not exist in any installed plugin or local skill and will plausibly be reused.
argument-hint: "<skill-name> [one-line purpose]"
---

# scaffold-skill — create a project-local skill (the self-extension path)

New capabilities start life in the PROJECT (`.claude/skills/`), prove themselves through
reuse, and only then get promoted to the shared plugin (`/aidlc:promote`). Never write directly
into an installed plugin.

## 0 · Creation is the LAST resort — search first

1. Installed plugin skills (core + stack packs) — would loading an existing skill cover it?
2. Project-local `.claude/skills/` and the `.aidlc/extensions.json` registry.
3. Could 5 lines in an existing skill's project override (or CLAUDE.md) do the job? A skill
   that will be loaded once is overhead, not capability.

Proceed only if the capability is missing AND plausibly reused (a second work item would want it).

## 1 · Scaffold

1. Name: kebab-case, capability-shaped (`stripe-integration`, `pdf-generation`) — not
   task-shaped (`fix-PROJ-123`).
2. Instantiate `${CLAUDE_PLUGIN_ROOT}/templates/skill-template/SKILL.md` →
   `.claude/skills/<name>/SKILL.md`. Fill every `{{...}}`; the `x-aidlc` block is mandatory:
   `origin: project`, `created: <UTC now>`, `createdDuring: <current work-item ID or "manual">`,
   `promotion: candidate` (or `local-only` if it hardcodes project internals by nature),
   `reuseCount: 1`.
3. Write the body per the template's rules: procedural, concrete, ≤80 lines, project-specific
   values referenced from config rather than hardcoded (hardcoding blocks promotion later).
4. The `description:` line decides whether the skill ever fires — write it with the trigger
   vocabulary of real tasks ("Load when integrating Stripe payments, webhooks or refunds...").

## 2 · Register

Append to `.aidlc/extensions.json → extensions[]`:

```json
{ "name": "<name>", "kind": "skill", "path": ".claude/skills/<name>",
  "created": "<UTC>", "createdDuring": "<ID>", "promotion": "candidate", "reuseCount": 1 }
```

## 3 · Reuse tracking (everyone's job, enforced by the orchestrator)

Whenever a later run loads a registered local skill, increment its `reuseCount` in
`extensions.json`. `/aidlc:status` surfaces candidates with `reuseCount >= 2` as
promotion-ready. Commit the new skill + registry change with the work item's branch
(`chore(aidlc): scaffold <name> skill`).
