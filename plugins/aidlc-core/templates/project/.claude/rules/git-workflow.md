# Git workflow (always enforced)

- Branch names: `{type}/{work-item-id}-{short-slug}` — types: `feature`, `bugfix`, `task`, `spike`.
  Example: `feature/PROJ-123-user-avatar-upload`.
- Conventional commits: `feat|fix|chore|refactor|test|docs(scope): message`.
  Reference the work-item ID in the commit body (e.g. `Refs: PROJ-123`).
- Never commit directly to any repo's default branch. All changes are integrated through a PR
  (`git.mode: remote`, the default) or, for a repo with no remote (`git.mode: local`), a
  user-confirmed `--no-ff` merge after green verify — never ad-hoc commits or blind merges onto the
  default branch. Even one-liners.
- One work item is delivered in exactly one repo → one branch → one PR. Cross-repo features are epics
  whose children each target one repo; the orchestrator routes and sequences them.
- One logical change per commit. Keep the build green at every commit.
- PR titles: `[PROJ-123] <imperative summary>`. PR bodies follow the AIDLC pr-body template.
