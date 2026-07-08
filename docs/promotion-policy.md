# Promotion Policy

How project-born skills and agents enter the shared plugins. Audience: the platform team
(who review promotion PRs) and anyone running `/sdlc:promote`.

## Governance

- The platform team owns `plugins/**` (enforced via CODEOWNERS) — every promotion PR needs
  one platform-team approval. Project teams cannot merge into the shared plugins directly.
- Promotions bump the target plugin's **minor** version and carry a CHANGELOG entry crediting
  the source project and originating work item.
- Rejected promotions get a reason on the PR; the source project keeps the extension as
  `candidate` (with the rejection noted) or reclassifies it `local-only`.

## Acceptance bar (reviewer checklist — copy into the PR)

- [ ] **Reusable**: plausibly useful to ≥2 projects (reuseCount evidence in the PR body counts,
      but judgment rules — a project-quirk used 5× is still a quirk).
- [ ] **Generalized**: no project names/keys/URLs/hostnames; project specifics reference
      `.claude/sdlc.config.json` or are marked `{{placeholders}}`; no absolute/personal paths.
- [ ] **No secrets**: tokens, credentials, connection strings, internal endpoints — automatic reject.
- [ ] **Right kind**: skills carry procedural knowledge; an agent PR must state which of the
      agent-test criteria (isolated context / tool surface / independent judgment) it meets.
- [ ] **Right home**: stack-specific → the matching stack pack; universal → core.
      Doesn't duplicate an existing skill (extend that skill instead — smaller PR).
- [ ] **Trigger-worthy description**: the `description:` would actually fire on the tasks it
      serves; body ≤ ~100 lines, concrete over abstract.
- [ ] **Safe**: nothing that widens permissions, weakens hooks, or instructs agents to bypass
      guardrails.

## After merge

Consuming projects pick the change up via `/plugin marketplace update`, then run `/sdlc:sync`
— it deletes the now-shadowed local copy and marks the registry entry `promoted`. Source
projects should do this promptly; long-lived local forks of promoted skills are drift bugs.

## Deprecating a promoted skill

Removal is a breaking change for every project: mark the skill's description `DEPRECATED —
use <replacement>` for one minor version, then remove in the next; CHANGELOG both steps.
