# wi-ado — discovery

Part of the `aidlc:wi-ado` skill, kept apart so the runs that do not need it do not load it. Read by the ADO adapter the first time it touches a work-item type (field discovery), and when superseding or restructuring items (re-decomposition).

## Re-decomposition & supersession (ADO specifics)

Implements `aidlc:work-items` → *Re-decomposition & supersession* on Azure Boards. Three ADO
constraints shape it:

- **Terminal state is per-work-item-type, not per-process.** When superseding an original that was
  re-tracked under new children (throughput-neutral), prefer the **`Removed`** state — but `Removed`
  exists for **User Story**, while a **Task** on the same board may have only **`Closed`** as terminal.
  So **probe the available states for THAT item's type** (`az boards work-item show` the type / inspect
  the process, or attempt `Removed` and catch the rejection) and adapt: prefer `Removed`, else fall
  back to `Closed` **plus a `superseded; delivered under <child ids>` comment**. Never hard-code
  `Removed`. Never leave the original `New` (`query` would resurface it as ready).
- **No REST retype.** ADO cannot change a work item's *type* via the API — you cannot "convert" a Task
  into a Story. Restructure by **create-new + link + supersede**, or by making the original an
  **umbrella** parent with new correctly-typed children under it (e.g. a carved-out AC becomes a new
  Task under a new umbrella Story, not a converted Task). Preserve the parent's real type via
  `sourceRaw.adoType`.
- **AC field is Story-tier.** `Microsoft.VSTS.Common.AcceptanceCriteria` lives on Stories/PBIs/Bugs,
  not Tasks. `updateAC` must write ACs to the **Story**; a Task only carries them in its
  `System.Description`. When re-decomposing, ensure carried ACs land on a Story-tier item.

## Field discovery — by **reference name, per work-item-type**

Implements `aidlc:work-items` → *Schema discovery* on Azure Boards. **One probe per type answers both
halves** (its fields and its states), so do them together the first time a type is touched:

```bash
az rest --method get --url "https://dev.azure.com/{org}/{project}/_apis/wit/workitemtypes/{type}/fields?api-version=7.1"
az rest --method get --url "https://dev.azure.com/{org}/{project}/_apis/wit/workitemtypes/{type}/states?api-version=7.1"
```

(or the MCP equivalents — ToolSearch for `work item type`). The fields response is the authoritative
list for that type: each entry carries `referenceName`, the display `name`, `alwaysRequired`,
`allowedValues` and `defaultValue`. `_apis/wit/fields` lists the *organization's* fields, which is a
superset of any one type's — useful to find a custom field's reference name from its display name, never
sufficient on its own to conclude a type has it.

**Key everything on `referenceName`.** Renaming a field in ADO changes only its display name; the
reference name is immutable, so a map built on reference names survives the rename that would otherwise
break every read and write. Custom fields added by an inherited process are `Custom.<Name>`.

Resolution per canonical field (record the result in `workItems.ado.fieldMap`, `null` where absent):

| Canonical | Resolve as |
|---|---|
| `acceptanceCriteria` | `Microsoft.VSTS.Common.AcceptanceCriteria` when the type has it; else a `Custom.*` field whose display name reads as acceptance criteria; else **`null` → the `## Acceptance Criteria` section of `System.Description`**. Story-tier either way (see *Re-decomposition*) |
| `estimate` | whichever of `Microsoft.VSTS.Scheduling.StoryPoints` (Agile) / `.Effort` (Scrum) / `.Size` (CMMI) the type actually has — read-only, the pipeline never writes it |
| `priority` | `Microsoft.VSTS.Common.Priority` when present. **Absent → order by `Microsoft.VSTS.Common.BacklogPriority` (the board's own rank) and report every item as P3**, rather than inventing a priority the board does not hold. A Bug-only `Microsoft.VSTS.Common.Severity` is *not* a priority field — do not substitute it |
| `repo` | a `repo:<name>` tag by default; `System.AreaPath` where the project maps repos to area paths; a `Custom.*` repository field where one exists. Record which — `null` means the tag convention |
| `labels` / `assignee` / `parent` | `System.Tags` / `System.AssignedTo` / the Hierarchy-Reverse link — universal, no probe needed |

**Required-on-create, before the first create.** Filter the type's field list for `alwaysRequired` and
resolve every one *before* decomposing an epic — a rejected create halfway through creating children
leaves a half-built hierarchy. Common culprits on customized processes:
`Microsoft.VSTS.Common.ValueArea`, a mandatory `Custom.Team`, a restricted `System.AreaPath`. Fill from
canonical data, else the field's own `defaultValue` / its single `allowedValues` entry, else **ask** —
never invent (`aidlc:work-items` → `references/schema-discovery.md` → *Required-on-create*).

**Respect each field's type when writing.** `allowedValues` means a picklist: write a legal value or ask,
because free text is rejected. An `HTML` field takes HTML (as `System.Description` and the AC field
already do), a `treePath` field takes a real classification node, and an identity field takes a resolvable
identity — a plain string in any of them fails in a way the `az` CLI tier can report as success, which is
exactly what *Write verification* below exists to catch.
