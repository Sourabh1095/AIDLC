# Contributing to AIDLC

Thanks for helping improve the Bee-Logical AIDLC marketplace.

Read this first, because one thing here is unusual: **this repo is not an application — it is a
plugin other people install and point at their own codebases.** A merged change reaches every
consumer on their next `/plugin marketplace update`, where it runs against repos none of us can see.
That is why the bar under `plugins/**` is deliberately high, and why "it works for me" is not
evidence.

## Ways to contribute

| You want to… | Path |
|---|---|
| Report something broken | [Open a bug report](../../issues/new?template=bug_report.yml) |
| Propose a capability | [Open a feature request](../../issues/new?template=feature_request.yml) |
| Fix docs, or a contained bug | Fork → branch → PR |
| Contribute a skill or agent | Read **[docs/promotion-policy.md](docs/promotion-policy.md)** first, then PR |

**Open an issue before a large PR.** A skill that misses the acceptance bar is rejected on
reusability or scope grounds, not code quality — and that is much cheaper to find out in an issue
than after you have written it.

## Governance

Only the maintainer has write access. Every change — including the maintainer's own promotions —
lands through a PR they merge; contributors work from forks and cannot merge into the shared plugins
directly.

The full rules live in **[docs/promotion-policy.md](docs/promotion-policy.md)**: the acceptance bar,
what happens to rejected promotions (`candidate` vs `local-only`), and the deprecation path for
removing a promoted skill. This file does not restate them — that document is the source of truth.

## Repo layout

| Path | What it is |
|------|-----------|
| `.claude-plugin/marketplace.json` | The marketplace manifest — plugin list and versions |
| `plugins/aidlc-core/` | The `aidlc` plugin: orchestrator, agents, skills, hooks, project template |
| `plugins/aidlc-stack-web/` | Stack pack: TS standards, Next.js, NestJS, Postgres, Mongo, Docker |
| `plugins/aidlc-ux/` | The design pod: UX narrative, design system, motion, jury |
| `docs/` | Architecture, adoption guide, promotion policy, permissions rationale |

## Contributing a skill or agent

Most skills reach this repo through `/aidlc:promote` — a project builds a local extension in
`.claude/`, it proves itself across real work items, and the command packages it onto a
`promote/<name>` branch and opens the PR with the reviewer checklist already filled in. If you are
working that way, let the command do the work.

If you are proposing one by hand, match what the command would have produced:

- **Skills carry procedural knowledge.** Reach for an agent only if you can state which agent-test
  criterion it meets — isolated context, a distinct tool surface, or independent judgment.
- **Stack-specific goes in the matching stack pack; universal goes in core.** If an existing skill
  is close, extend it instead of adding a neighbour — a smaller PR is a better PR.
- **Generalize it.** No project names, keys, URLs, hostnames, or absolute/personal paths. Project
  specifics read from `.claude/aidlc.config.json` or are marked `{{placeholders}}`.
- **Promotions bump the target plugin's minor version** and carry a CHANGELOG entry crediting the
  source project and originating work item.

## Local development

Point Claude Code at a plugin directory from your clone:

```
claude --plugin-dir <your-clone>/plugins/aidlc-core
```

Then exercise the real path — scaffold a throwaway project with `/aidlc:init` and run an actual work
item through `/aidlc:run`. Reading the diff is not verification; the pipeline's behaviour is
emergent, and skills fail in ways that only show up when a real item routes through them.

## Reporting bugs

The pipeline's state lives in `.aidlc/runs/<ID>.md`. That run file is usually the single most useful
thing in a bug report — it records what the orchestrator decided and where it stopped.

**Redact before you paste.** Run files and logs quote your work items, branch names, and
repo paths. Strip secrets, tokens, connection strings, internal endpoints, and anything
project-identifying. The no-secrets rule is an automatic reject on PRs; the same courtesy applies to
issues, which are public and permanent.

## Security

Anything touching `plugins/**`, `hooks/`, or permissions is a supply-chain surface: it executes on
other people's machines against their code. Changes that widen permissions, weaken hooks, or
instruct agents to bypass guardrails are rejected on sight — see
[docs/permissions-rationale.md](docs/permissions-rationale.md) for why the current boundaries sit
where they do.

Found a vulnerability? **Do not open a public issue.** Report it privately via
[Security Advisories](../../security/advisories/new).
