---
name: release
description: Release mechanics — semver decision from conventional commits, changelog generation, tagging and release notes for GitHub or Azure DevOps. Use for release work items or when asked to cut, prepare or tag a release.
argument-hint: "[repo — required in poly, implied in mono] [package — monorepo only]"
---

# /aidlc:release — cut a release

Releases are prepared autonomously but EXECUTED behind approval: `gh release create` /
`az pipelines run` sit in the `ask` permission list by design.

**Releases are per-repo.** Each repo versions, tags and publishes on its own cadence from its own
history. `$ARGUMENTS` names the target repo (`/aidlc:release <repo>`); with a single repo (mono)
it's implied. A coordinated workspace release = run the steps below **once per repo** (sequentially,
respecting `dependsOn`: a consuming repo releases after the API it depends on), each with its own
tag and notes — there is no shared cross-repo version. Every git/gh/az command runs with cwd =
`workspace.root`/`<repo.path>` and that repo's `host`/`remote`/`defaultBranch`.

## 0 · Per-package release — only where the tooling supports it

A monorepo (`packages[]` on the repo entry, or top level in mono) is one git repo with many packages, and
whether they can release **separately** is a property of the project's tooling, not a choice we make.
Check `releaseTooling` and the package's `releasable` flag first, and say plainly which case you are in:

- **Independent versioning supported** — changesets (`.changeset/`), `lerna.json` with
  `"version": "independent"`, `nx release`, or per-package `semantic-release`. Cut a **per-package**
  release: run the project's own tool (`pnpm changeset version` + `changeset publish`,
  `npx lerna version`, `nx release <pkg>`) rather than hand-editing versions — it owns the version
  graph, updates dependent packages' ranges, and generates the per-package changelog. Scope §1's
  semver decision and §2's changelog to commits **touching that package's path**. Tag as the tooling
  does (`@acme/web@1.4.0`), never `v1.4.0` — a bare version tag in a monorepo is ambiguous.
- **Fixed/locked versioning** (lerna fixed mode, a single root version) — every package moves together.
  Release the **repo**, and say so: a per-package cut is not available here.
- **No release tooling, or the package is not `releasable`** — **say it plainly and stop**: "`<pkg>`
  releases with the repo; this project has no independent-versioning tooling, so there is no per-package
  release to cut." Do not hand-roll one by bumping a `package.json` and tagging: a package published
  outside the tool that owns the version graph leaves its dependents pointing at a version that does not
  exist, and that breaks consumers rather than the repo.
- **Release order follows the package `dependsOn` graph** — a shared package publishes before the
  packages that depend on it, exactly as a consuming repo releases after the API it depends on.

Everything below then applies to the resolved scope (repo, or package).

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

`chore(release): v{X.Y.Z}` → tag `v{X.Y.Z}` annotated with the changelog section. **Per-package:**
`chore(release): {pkg}@{X.Y.Z}` → tag `{pkg}@{X.Y.Z}`, or whatever the project's tool already produces —
match the existing tags in the repo rather than introducing a second scheme beside them.

**Freeze windows.** If the repo's `saas.freezeWindows` declares one and now falls inside it, say so with
its source and ask before publishing (§4 is approval-gated anyway) — a release is the deploy this exists
to govern.

## 4 · Publish (requires human approval)

- GitHub: `gh release create v{X.Y.Z} --title "v{X.Y.Z}" --notes-file <section>` (add `--generate-notes` only if the repo has no changelog discipline).
- Azure: push the tag; if a release pipeline exists, `az pipelines run` (approval-gated).
- **Local mode** (`git.mode: local`, no remote): there is nothing to publish to. Create the
  annotated tag locally (`git tag -a v{X.Y.Z} -m "<changelog section>"`) and STOP there — report the
  tag and note that a hosted release/`gh release create` will run once a remote is configured. Never
  push or invent a remote.
- Never `npm publish` / `docker push` without explicit instruction — they're separate approvals.

## Release notes style

Lead with the 1–3 changes users care about, in their words. Then the grouped list with work-item
links. Call out breaking changes FIRST with a migration line each. No commit hashes in the prose.
