# git-workflow — fork

Part of the `aidlc:git-workflow` skill, kept apart so the runs that do not need it do not load it. Read when the resolved repo has `contribution: "fork"`.

## Fork-based contribution (`contribution: "fork"`)

The user cannot push to the upstream repo, so pushing to `<remote>` would fail — this is detected at
adoption time precisely so a run does not discover it at push time. Instead:

1. Push the branch to the **fork** (the repo's own `remote`, conventionally `origin`, which points at the
   fork): `git push -u <remote> <branch>`.
2. Open the PR **against the upstream**, from the fork's branch:
   `gh pr create --repo <upstream owner/repo> --head <fork owner>:<branch> --base <base> …`
   (`<upstream owner/repo>` from `upstreamRemote`'s URL). On Azure Repos, fork PRs need the fork as the
   source repository — if `az` cannot express it, stop and print the exact manual PR step rather than
   opening a PR against the wrong repo.
3. If the fork does not exist yet, **do not create it silently** — creating a repo under the user's account
   is their call. Report what is needed (`gh repo fork <upstream> --remote=false`) and stop.

Everything else — branching, commits, the gate — is unchanged.
