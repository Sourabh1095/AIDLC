# Security Policy

## Reporting a vulnerability

**Do not open a public issue.** Report privately through
[Security Advisories](https://github.com/bee-logical/AIDLC/security/advisories/new).

This is a solo-maintained project. Expect a first response within a few days, and please allow
reasonable time to ship a fix before public disclosure.

## Why this repo needs the care

AIDLC is not a library you call — it is a plugin Claude Code loads into a developer's session and
runs against their codebase. Several hooks execute **automatically**, with no user action:

| Hook | Trigger | When it runs |
|------|---------|--------------|
| `session-context.mjs` | `SessionStart` | Every session start — no command, no approval |
| `guard.mjs`, `dep-vet.mjs` | `PreToolUse` (Bash) | Before every Bash command |
| `protect-paths.mjs` | `PreToolUse` (Edit/Write) | Before every file write |
| `format.mjs` | `PostToolUse` (Edit/Write) | After every file write |
| `checkpoint.mjs` | `Stop`, `PreCompact` | Automatically |

Anything merged here reaches every consumer on their next `/plugin marketplace update`. There is no
per-user review step between a merge and execution on someone else's machine.

## In scope

- **`plugins/*/hooks/**`** — these execute automatically and are the highest-value target here.
- Skills or agents that instruct the model to exfiltrate data, weaken guardrails, bypass hooks, or
  widen permissions beyond what [`docs/permissions-rationale.md`](docs/permissions-rationale.md)
  establishes.
- Permission changes that broaden what the pipeline may do without confirmation.
- Secrets, tokens, or internal endpoints committed to this repo.
- Anything that causes the pipeline to touch production systems or push to a default branch
  directly — both are guardrails the framework promises to hold.

## Out of scope

- Vulnerabilities in Claude Code itself — report those to Anthropic.
- Issues in a consuming project's own code or CI.
- The framework's deliberate high-autonomy design. Everything on the story → PR path is *intended*
  to be allowed; see [`docs/permissions-rationale.md`](docs/permissions-rationale.md) for why the
  boundaries sit where they do. If you think a specific boundary is wrong, open an issue — that is a
  design discussion, not a vulnerability report.

## Supported versions

Fixes land on `main` and ship as the next version of the affected plugin. There are no maintained
backport branches; consumers should track the latest via `/plugin marketplace update`.
