---
name: docs-writing
description: Documentation style and scope rules — what to update per change type (README, CHANGELOG, API docs), docstring policy and writing conventions. Load when updating project documentation for a work item.
user-invocable: false
---

# Docs writing — style & scope

## What to update, per change type

| Change | Update |
|--------|--------|
| New user-facing feature | CHANGELOG entry · README feature list if one exists · API docs if it adds endpoints |
| Behavior change | CHANGELOG (call out if breaking) · every doc that stated the old behavior (grep for it) |
| New endpoint | The project's API doc mechanism (OpenAPI spec, route JSDoc, docs/api/*) — match what exists |
| New env var / config | README setup section + `.env.example` (name and shape only, never values) |
| New command/script | README commands section |
| Internal refactor | Usually nothing — CHANGELOG only if perf/compat visible |

## Style

- Write for the reader's task, not the code's structure: "To upload an avatar…" not "The AvatarService…".
- Present tense, active voice, second person for instructions.
- Every command shown must have been run — paste real output shapes, not imagined ones.
- Keep README sections short; link to deeper docs rather than inlining essays.
- CHANGELOG lines: user language + work-item ID. "Avatar upload (max 5 MB) — PROJ-123".

## Docstring policy

Public API surface (exported functions/classes, HTTP handlers): document WHAT and the
contract (params, return, errors thrown) — in the project's existing convention (JSDoc/TSDoc).
Internal code: comments only for non-obvious WHY (constraints, workarounds with issue links).
Never narrate the obvious; never leave stale docstrings — wrong docs are worse than none.

## Anti-goals

No new documentation systems or folder structures. No reformatting/renaming sweeps outside
the diff's scope. No aspirational docs for unbuilt features. No AI-sounding filler
("comprehensive", "seamlessly", "robust").
