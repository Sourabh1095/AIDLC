---
name: {{SKILL_NAME}}
description: {{WHEN_CLAUDE_SHOULD_LOAD_THIS — start with what it is, then the triggers. This line decides whether the skill ever gets used; make the trigger words match how tasks are actually phrased.}}
user-invocable: false
x-aidlc:
  origin: project
  created: {{NOW_UTC}}
  createdDuring: {{WORK_ITEM_ID}}
  promotion: candidate   # candidate | promoted | local-only
  reuseCount: 1
---

# {{SKILL_NAME}} — {{one-line purpose}}

{{BODY — procedural knowledge only. Rules of thumb:
- Write instructions to a competent engineer, not documentation for a reader.
- Concrete over abstract: exact commands, file patterns, code idioms — not principles.
- If it depends on project specifics (URLs, service names), reference .claude/aidlc.config.json
  or CLAUDE.md instead of hardcoding — hardcoded specifics block promotion.
- Keep it under ~80 lines; split large procedures into supporting files loaded on demand.}}

## When NOT to use this

{{Anti-triggers — the cheapest way to prevent misfires.}}
