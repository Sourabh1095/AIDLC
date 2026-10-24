---
item: {{ID}}
source: {{SOURCE}}
type: {{TYPE}}
repo: {{REPO}}
package: null
branch: {{BRANCH}}
phase: start
fixCycles: 0
reviewRounds: 0
contractAffecting: false
fanout: null
ui: false
uxScope: null
uxMode: null
designSource: null
systemSource: null
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

<!-- The plan opens with a `### Reuse` block (aidlc:reuse → Planning): what it uses, extends and newly
     shares, from a catalog query — or `none found (queried: …)`.

     Each task declares the paths it touches, so §6 can decide what runs concurrently:
     - [ ] Paginate the users screen  ·  paths: src/screens/users.tsx  ·  wi: PROJ-145
     Add `foundation: true` to a task later tasks build on, or `dependsOn: <ids>` for a narrower
     edge — an import relationship two disjoint files cannot show. Undeclared paths ⇒ always serial.
     `wi:` binds the line to the board's Task tier (the unit of effort): its commit trailer names both
     IDs and ticking the box transitions that Task. Omit it for a plan-only step.
     `reuses: <path:symbol>` names what a task consumes from the Reuse block. -->

## Findings

(none yet)

## Log

- {{NOW_UTC}} run created
