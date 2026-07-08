---
name: release
description: Release mechanics — semver decision from conventional commits, changelog generation, tagging and release notes for GitHub or Azure DevOps. Use for release work items or when asked to cut, prepare or tag a release.
---

# /sdlc:release — cut a release

Releases are prepared autonomously but EXECUTED behind approval: `gh release create` /
`az pipelines run` sit in the `ask` permission list by design.

## 1 · Version decision (semver from conventional commits)

`git log <last-tag>..HEAD --pretty=%s` →
any `feat!:`/`BREAKING CHANGE` → **major** · any `feat:` → **minor** · else `fix:`/`chore:`/... → **patch**.
Pre-1.0: breaking → minor, everything else → patch. State the decision and the commits that drove it.

## 2 · Changelog

Group commits under Added (`feat`) / Fixed (`fix`) / Changed (`refactor`, `perf`) — user
language, not commit-speak; fold multiple commits per work item into one line with the item ID.
Skip `chore/test/docs` unless user-visible. Update `CHANGELOG.md` under the new version +
date; bump `package.json` version (and lockfile via `npm install --package-lock-only`).

## 3 · Release commit + tag (needs a normal run/PR unless on a release branch flow)

`chore(release): v{X.Y.Z}` → tag `v{X.Y.Z}` annotated with the changelog section.

## 4 · Publish (requires human approval)

- GitHub: `gh release create v{X.Y.Z} --title "v{X.Y.Z}" --notes-file <section>` (add `--generate-notes` only if the repo has no changelog discipline).
- Azure: push the tag; if a release pipeline exists, `az pipelines run` (approval-gated).
- Never `npm publish` / `docker push` without explicit instruction — they're separate approvals.

## Release notes style

Lead with the 1–3 changes users care about, in their words. Then the grouped list with work-item
links. Call out breaking changes FIRST with a migration line each. No commit hashes in the prose.
