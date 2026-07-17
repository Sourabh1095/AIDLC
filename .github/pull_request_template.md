<!--
  Anything under plugins/** ships to every consumer on their next `/plugin marketplace update`.
  The acceptance bar below is not ceremony — it is what this PR is reviewed against.
  Source of truth: docs/promotion-policy.md
-->

## Summary

<!-- What changes, and why. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] Documentation
- [ ] New skill
- [ ] New agent
- [ ] Change to an existing skill / agent
- [ ] Hook or permission change
- [ ] Other:

## Target

- [ ] `aidlc` (core)
- [ ] `aidlc-stack-web`
- [ ] `aidlc-ux`
- [ ] Docs / repo tooling only

## Verification

<!--
  How did you exercise this? Reading the diff is not verification.
  For plugin changes: which /aidlc:* command did you run, against what kind of work item,
  in mono or poly, and what happened?
-->

---

## Acceptance bar

<!-- Required for anything under plugins/**. Delete this section for docs-only PRs. -->

- [ ] **Reusable**: plausibly useful to ≥2 projects (reuseCount evidence counts, but judgment rules
      — a project-quirk used 5× is still a quirk).
- [ ] **Generalized**: no project names/keys/URLs/hostnames; project specifics reference
      `.claude/aidlc.config.json` or are marked `{{placeholders}}`; no absolute/personal paths.
- [ ] **No secrets**: tokens, credentials, connection strings, internal endpoints — automatic reject.
- [ ] **Right kind**: skills carry procedural knowledge; an agent PR states which agent-test
      criterion it meets (isolated context / tool surface / independent judgment).
- [ ] **Right home**: stack-specific → the matching stack pack; universal → core.
      Doesn't duplicate an existing skill (extend that skill instead — smaller PR).
- [ ] **Trigger-worthy description**: the `description:` would actually fire on the tasks it serves;
      body ≤ ~100 lines, concrete over abstract.
- [ ] **Safe**: nothing that widens permissions, weakens hooks, or instructs agents to bypass
      guardrails.

## CHANGELOG

- [ ] CHANGELOG entry added — promotions bump the target plugin's **minor** version and credit the
      source project and originating work item.

## Promotion metadata

<!-- /aidlc:promote PRs only — delete otherwise. -->

- Source project:
- Originating work item:
- reuseCount:
