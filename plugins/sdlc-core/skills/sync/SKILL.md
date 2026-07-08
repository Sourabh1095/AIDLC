---
name: sync
description: Reconcile project-local SDLC extensions against the installed plugin versions — detect promoted skills now shadowed by the plugin, remove the local fork, and report drift. Use after plugin updates or when local and plugin skills may overlap.
disable-model-invocation: true
---

# /sdlc:sync — close the promotion loop, kill drift

Local forks that stay alive after promotion silently diverge from the shared version — this
command prevents that. Run it after `/plugin marketplace update` or when `/sdlc:status` flags
drift.

## 1 · Inventory

- Local: `.sdlc/extensions.json` entries + actual files in `.claude/skills/` and
  `.claude/agents/` (report registry/filesystem mismatches — unregistered locals get
  registered now with `promotion: local-only` pending review).
- Plugin: skill/agent names available from installed SDLC plugins (core + stack packs).

## 2 · Reconcile, per local extension

| Situation | Action |
|---|---|
| `promotion: pr-open` and a plugin skill with the same name now exists | The promotion landed: **delete the local copy**, set registry entry `promotion: promoted`, `promotedIn: <plugin>@<version>`. Local overrides noted during promotion move to CLAUDE.md if still needed. |
| Same name in plugin but never promoted from here | **Shadowing conflict**: compare contents; if the plugin version covers it, delete local (registry → `superseded-by-plugin`); if local has real additions, rename local to `<name>-local` and file a promotion candidate for the delta. Ask the user when the diff is substantive. |
| `promotion: pr-open` but PR was closed/rejected | Registry → `candidate` with a `rejected: <PR url>` note; keep local. |
| `candidate` with `reuseCount >= 2` | List as promotion-ready (pointer to `/sdlc:promote`). |
| Plugin skill the project overrides via CLAUDE.md notes that no longer apply | Report as stale guidance to clean up. |

Deletions are shown as a plan first; execute after user confirmation (this touches files the
team may know by name). Commit as `chore(sdlc): sync extensions with plugin vX.Y.Z`.

## 3 · Report

```
Sync vs sdlc@0.5.0 / sdlc-stack-web@0.5.0:
- promoted & cleaned: stripe-integration (local copy removed)
- shadowing conflict: pdf-generation — plugin version differs, kept as pdf-generation-local (review)
- promotion-ready: webhook-testing (reuseCount 3) → /sdlc:promote webhook-testing
- registry fixed: 1 unregistered local skill added as local-only
```
