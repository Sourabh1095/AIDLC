# Work items — schema discovery

Read by the Jira and ADO adapters (and anyone mapping fields or states) from `aidlc:work-items` → *Schema
discovery*. Part of the work-items skill, kept apart because most tracker operations never need it.

## Schema discovery — probe the board, never assume its fields and states

**Every field mapping and status map an adapter documents is a default to verify, not a constant to
trust.** Jira and Azure Boards both let a project add custom fields, rename or remove built-in ones,
make a field required on create, restrict it to a picklist, and define its own workflow states — and
both scope all of that **per issue/work-item type**. A pipeline that hard-codes the vendor defaults
works on a fresh trial board and quietly misbehaves on every real one. That has already cost this
framework twice: **F7** was a customized ADO board whose states were nothing like Agile's defaults,
**F20** the same board scoping those states *per type*. Custom **fields** are the identical class of
divergence and had no rule at all — only a scattering of "detect the convention from an existing item"
asides, which is the weakest possible probe (see *Sampling an item is not a schema probe* below).

**`source: markdown` has nothing to discover** — its schema is the file format this framework defines
(`aidlc:wi-markdown`), so everything below is a no-op there and binds the tracker adapters only.

So the **first tracker operation of a session resolves the schema before it maps anything**, and the
resolution — not the vendor default — is what every later op uses:

1. **Probe** the real schema for the types this session touches: the field list keyed by **stable id**
   (never display name), and the state/status set with each state's **category**. Each adapter documents
   the exact call — `wi-ado` → *Field discovery* + *Status map*, `wi-jira` → *Schema discovery*.
2. **Reconcile** against `workItems.<source>.fieldMap` / `.statusMap` in config. A configured value the
   probe **confirms** wins — it is a human's deliberate override and outranks any heuristic. A
   configured value naming something that does not exist on that type is **wrong, not authoritative**:
   use the probe and report the divergence in one line.
3. **Self-heal** — write the resolved map back to config when it diverges, showing what changed. This is
   F7's self-heal generalized to fields: it is what stops the same board being re-probed forever, and
   what stops a stale map from steering a run for weeks.
4. **Adapt, don't extend.** A canonical field with no home on that type falls back to the adapter's
   documented alternative (a label, a description section, the run file) — **never** create a custom
   field, a state, a workflow, or an issue type. The board is the client's system of record and the
   pipeline is a guest in it; the same argument that keeps `priority` out of the contract (*What the
   contract deliberately cannot do*) forbids inventing schema. `package` is the worked example: most
   trackers have no field for it, so it rides a label rather than a field the pipeline created.

### The three classes of canonical field

Which class a field is in decides what "adapt" means, so classify before probing:

| Class | Canonical fields | Rule |
|---|---|---|
| **Universal** | `id`, `type`, `title`, `description`, `status`, `labels`, `assignee`, `parent` | The tracker cannot not have these. Still per-type-scoped for `status`, and `parent` may be a *different field* on a legacy site (Jira's "Epic Link"). |
| **Conventional** | `acceptanceCriteria`, `estimate`, `priority`, `repo`, `dependsOn` | Present under whatever id **this site** chose, or absent entirely. Resolve per type; on absence use the documented fallback. This is where custom fields live and where assuming a default is wrong. |
| **Unrepresented** | `package`, run-file state | No field, by design. Carried as a label plus the run file. Do not go looking for one, and do not make one. |

### `fieldMap` — where a resolution is recorded

`workItems.<source>.fieldMap`, alongside `statusMap` and with the same two shapes:

```json
"fieldMap": {
  "User Story": { "acceptanceCriteria": "Microsoft.VSTS.Common.AcceptanceCriteria", "estimate": "Microsoft.VSTS.Scheduling.StoryPoints" },
  "Task":       { "acceptanceCriteria": null, "estimate": null }
}
```

- **Keys** are the tracker's own type names (preferred), or — where one id genuinely covers every type —
  the canonical field names directly (the flat shape `statusMap` also allows). Prefer per-type; treat a
  flat map as a hint.
- **Values** are the field's **stable id**: an ADO reference name (`Microsoft.VSTS.*`, `Custom.*`), a Jira
  field id (`customfield_10101`, `parent`). **Never a display name** — display names are localized,
  renameable, and non-unique, and in ADO a renamed field keeps its reference name, so the id is the only
  thing that survives the rename that would otherwise break every read.
- **`null` means "this type has no such field — use the documented fallback"**, and it is a *resolution*,
  not a gap. `acceptanceCriteria: null` on a Task is precisely why that Task's criteria live in its
  description. A missing key means *not yet probed*; `null` means *probed and absent*. Keep them distinct.

### Sampling an item is not a schema probe

Reading a representative item and inferring the convention from it is the fallback tier, not the method,
because **a field that exists but is empty is indistinguishable from a field that does not exist.** Infer
from a sample and an unfilled AC field reads as "this project keeps AC in the description" — after which
the pipeline writes ACs into descriptions on a board that has a perfectly good field, and nobody notices
because nothing errors. Ask the tracker for the **type's field list** (ADO) or **createmeta** (Jira),
which enumerate fields whether or not they hold a value. Sample an item only to break a genuine tie
(which of two AC-ish fields the team actually uses), and say that is what you did.

### Required-on-create is discovered before the create, not after it fails

A site can make any field mandatory on create — `Team`, `Severity`, `Value Area`, a custom picklist — and
the failure arrives as a rejected `create` in the middle of an epic decomposition, halfway through
creating children. Read the required set from the same probe, **before** the first `create`, and:

- fill it from canonical data where the mapping allows;
- else use the value **the process itself supplies** (a field default, or a single allowed value);
- else **ask the user, and never invent one.** A guessed `Severity` or a made-up `Team` is worse than a
  blocked create: it is silently wrong data in the client's system of record, and nobody reviews it.

Picklist-restricted fields follow the same rule — write a value from the probed allowed set or ask;
free text into a restricted field is a rejection at best and a wrong value at worst.

### Probe lazily, once, and loudly on failure

- **Narrowly.** Resolve the types and fields this session's operations actually need — a `fetch` of one
  Story does not need the Bug type's picklists.
- **Once.** Memoize for the session; do not re-probe per op. The config write-back is the cross-session
  half, which is why step 3 exists.
- **Not cached beyond that.** A board changes — someone adds a state on Tuesday. A schema treated as
  permanent is confidently wrong in exactly the way a stale fact is (`aidlc:facts` → *Staleness*), so
  the probe re-runs each session and reconciles.
- **On probe failure, say so and degrade to the documented defaults** — one line naming what could not
  be resolved and what was assumed instead. Never let an unresolvable schema look like a resolved one:
  the whole cost of F7 and F20 was a map that *looked* authoritative. A tracker fact learned the hard way
  here is worth a `tracker`-area entry in `aidlc:facts`.
