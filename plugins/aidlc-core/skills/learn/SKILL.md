---
name: learn
description: Build or refresh the project brain (.aidlc/brain/) — map the product's modules from the code, read one module deeply into its page (purpose, user types, business rules, data, connections, flows, entry points, gaps), or refresh every page the code has moved past. Use when taking over a module, when starting with AIDLC on an existing project, or when the session says brain pages are behind the code.
argument-hint: "[module | path | --stale | --map]"
---

# /aidlc:learn $ARGUMENTS — grow the project brain

Load `aidlc:brain` first: the page format, the source tags and the writing rules are there, and this
command follows them. `B` below is `node "${CLAUDE_PLUGIN_ROOT}/skills/brain/brain.mjs"`, and
`<ws>` is the workspace root.

## 0 · Make sure it exists

`B init <ws>` — idempotent. It creates `.aidlc/brain/` and the `.gitignore` that keeps it out of git.

## 1 · Route

| Argument | Do |
|---|---|
| none, and no module pages yet | §2, then offer §3 for the modules the user names, or the few with the most code |
| none, pages exist | `B status <ws>`: say how many pages there are and which are behind, then offer `--stale` and any modules not mapped yet |
| `--map` | §2 again. Add pages for new candidates; never delete a page |
| a module name, or a path | §3. A path no page covers gets a new page |
| `--stale` | §4 |

## 2 · Map the modules

`B modules <ws> --json` gives candidates from the code's layout: name, repos, paths (relative to the
workspace, ready for a page) and file count. It is a first cut. Merge what is one product module
across layers and repos (the orders screen, the orders API and the orders service are one module), and
split a merge that is wrong (several unrelated `health` endpoints are not one module). Set aside shared libraries and infrastructure: the reuse
catalog covers shared code, and a library worth knowing about gets one line in `overview.md`. If
`.aidlc/adoption/` holds a scan report or profile, use what it already found rather than finding it again.

**Show the list to the user and adjust it.** It is their product, and they know what the team calls
each part. Then:
- write a stub page per module from `${CLAUDE_PLUGIN_ROOT}/templates/brain-module.md`, with `module`
  and `paths` filled and `checked` left empty;
- write stubs for `overview.md`, `actors.md` and `glossary.md` if they are missing;
- run `B index <ws>`.

Say what learning costs before doing it: one module is a focused read, and the whole product at once
is a lot of tokens. Recommend learning each module when work first touches it, and learning now only
the ones the user is about to work on or take over.

## 3 · Learn one module

Read with purpose — entry points first, then follow what they call. Do not read every file.

1. **Entry points:** routes, controllers, pages, screens, jobs and event handlers under its paths.
   They show what users and other systems can do here.
2. **Business rules:** validations, guards, permission checks, state transitions and calculations.
   Write each as the business would state it, with `[code: file]`.
3. **Data:** the entities, schemas and migrations it owns, and which other modules read them.
4. **Connections:** imports from other modules' paths, and outbound calls (HTTP, queues, SDKs) to
   external services.
5. **User types:** role and permission checks show who reaches each capability. Update `actors.md`.
6. **Intent:** work items that mention the module (`aidlc:work-items` → *query*; with the markdown
   backlog, search `backlog/`) and ADRs that touch it. Add their intent as `[req: ID]`, and put every
   place where intent and code disagree under **Gaps & questions**.
7. **History:** `git log --since="6 months ago" --format="%ad %an %s" --date=short -- <paths>`. Write
   two or three **Recent changes** lines, and name who has worked on it lately: that is who a person
   taking the module over should ask.
8. **Flows:** if the module is a step in a journey (signup, checkout, refund), add or update
   `flows/<name>.md`: numbered steps, each naming its module and tagged like any other line.
9. **Vocabulary:** domain words the code uses go in `glossary.md`.

Then `B stamp <ws> <module>` and `B index <ws>`.

**Report** in a few lines: what the module is for, its main flows, and the `[assumed]` lines. Ask the
user to confirm or correct those — they own the domain. A confirmed line becomes `[told: <date>]`.

## 4 · Refresh what is behind

`B status <ws>` lists pages that are `behind`, `off-branch` or `unknown-commit`. For each: `B changes
<ws> <page>`, read the diff it prints, update the lines it affects, then `B stamp`. Finish with
`B index <ws>`. With more than five stale pages, start with the ones the user is about to work on,
and ask before doing the rest.

## Rules

- **Write only inside `.aidlc/brain/`.** Never commit it, and never delete its `.gitignore`. Deleting
  that file is how the user opts to share the brain, and that is their call.
- **No secrets, credentials, personal or customer data,** and nothing read from an env file.
- **`[assumed]` never turns into a fact on its own.** Only a person, or the code, can confirm it.
