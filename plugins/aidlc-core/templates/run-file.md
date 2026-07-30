---
item: {{ID}}
source: {{SOURCE}}
type: {{TYPE}}
repo: {{REPO}}
package: null
branch: {{BRANCH}}
phase: start
fixCycles: 0
contractAffecting: false
fanout: null
ui: false
uxScope: null
uxMode: null
pr: null
started: {{NOW_UTC}}
updated: {{NOW_UTC}}
---

## Item snapshot

```json
{{WORKITEM_JSON}}
```

## Assumptions

(none yet)

## Plan

(pending)

<!-- Each task declares the paths it touches, so §6 can decide what runs concurrently:
     - [ ] Paginate the users screen  ·  paths: src/screens/users.tsx
     Add `foundation: true` to a task later tasks build on, or `dependsOn: <ids>` for a narrower
     edge — an import relationship two disjoint files cannot show. Undeclared paths ⇒ always serial. -->

## Findings

(none yet)

## Log

- {{NOW_UTC}} run created
