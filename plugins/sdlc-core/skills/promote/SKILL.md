---
name: promote
description: Promote a project-local skill or agent into the shared SDLC marketplace plugin — validate, generalize, package and open a PR against the marketplace repo. Use when a local extension has proven reusable (reuseCount >= 2) and should become available to all projects.
argument-hint: "<extension-name>"
disable-model-invocation: true
---

# /sdlc:promote $ARGUMENTS — send a local capability upstream

Round-trips a project-born skill/agent into the marketplace repo via PR. The platform team
reviews against `docs/promotion-policy.md`; nothing lands in the shared plugin without that
review.

## 1 · VALIDATE

1. Find `$ARGUMENTS` in `.sdlc/extensions.json` (must exist, `promotion: candidate`).
   `local-only` entries are refused with the reason from their metadata.
2. Lint the artifact: frontmatter parses; `description` is trigger-worthy; body ≤ ~100 lines.
3. **Secret scan**: no tokens/URLs-with-credentials/internal hostnames/connection strings —
   grep for `password|secret|token|key|@.*\.internal|https?://[^ ]*:[^ ]*@`. Any hit = fix before proceeding.
4. No absolute paths, no personal paths, no machine-specific assumptions.

## 2 · GENERALIZE

Rewrite project-specifics into portable form:
- Project names/keys/URLs → config references (`.claude/sdlc.config.json`) or `{{placeholders}}` with a note.
- Stack-version assumptions → "check package.json / use Context7".
- Anything non-generalizable → move into a clearly marked "Project overrides" note at the
  bottom, or conclude the extension is `local-only` and stop (update the registry to say so).
Show the user a before/after diff of the generalization before packaging.

## 3 · PACKAGE

1. Clone the marketplace repo (config `marketplace.repo`) into the scratchpad; branch
   `{promotionBranchPrefix}{name}` (default `promote/<name>`).
2. Destination: stack-specific expertise → the matching stack pack (`plugins/sdlc-stack-web/skills/`);
   everything else → `plugins/sdlc-core/skills/` (agents → `agents/`). Keep the `x-sdlc` block,
   set `origin: core` and drop `reuseCount`.
3. Bump the target plugin's `plugin.json` version (minor) and the marketplace.json entry;
   add a CHANGELOG entry crediting the source project + originating item.

## 4 · PR

Push the branch; open a PR against the marketplace repo (gh/az per its host) titled
`promote: <name>` with body: what it does · origin project + `createdDuring` item ·
`reuseCount` evidence · the generalization diff · the reviewer checklist copied from
`docs/promotion-policy.md`. **Opening this PR needs user confirmation** — it publishes
project-derived content to the shared repo; show the final diff and ask.

## 5 · MARK

`.sdlc/extensions.json` entry → `"promotion": "pr-open"`, record the PR URL. After the PR
merges, the next `/sdlc:sync` in any consuming project completes the loop.
