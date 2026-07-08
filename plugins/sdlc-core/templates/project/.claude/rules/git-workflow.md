# Git workflow (always enforced)

- Branch names: `{type}/{work-item-id}-{short-slug}` — types: `feature`, `bugfix`, `task`, `spike`.
  Example: `feature/PROJ-123-user-avatar-upload`.
- Conventional commits: `feat|fix|chore|refactor|test|docs(scope): message`.
  Reference the work-item ID in the commit body (e.g. `Refs: PROJ-123`).
- Never commit directly to the default branch. All changes go through a PR — even one-liners.
- One logical change per commit. Keep the build green at every commit.
- PR titles: `[PROJ-123] <imperative summary>`. PR bodies follow the SDLC pr-body template.
