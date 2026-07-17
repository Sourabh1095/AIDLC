# Azure DevOps Work Item Types by Process Template

This reference maps each ADO process template to its exact work item type names, hierarchy, and
field names. Using the wrong type name causes a 400 from the API.

**Role in AIDLC.** When source is `ado`, the **`aidlc:wi-ado` adapter owns the actual create/update
mapping** (canonical epic/story/task ↔ the process's real types, per-type status categories,
write-verification) — it, not this file, is what performs writes via the MCP or `az`. This reference
is for **planning**: `/aidlc:bootstrap` and the analyst consult it to shape the work-breakdown
correctly (e.g. Basic has no Feature/Story tier — Issues sit between Epic and Task, which changes
decomposition), and it documents the process differences (`wi-ado` details Agile/Scrum inline;
CMMI/Basic live here). The REST/API section at the end applies **only** to the adapter's **PAT
last-resort** path — the MCP and `az` paths do not use raw REST.

---

## Agile Process

### Hierarchy (top → bottom)
```
Epic → Feature → User Story → Task
                             → Bug
```

### Work Item Types (exact API names)
| Level | Type Name (exact) | Use for |
|---|---|---|
| Portfolio | `Epic` | Large business initiatives, themes |
| Portfolio | `Feature` | Specific capabilities within an epic |
| Requirement | `User Story` | Deliverable unit of user value |
| Task | `Task` | Implementation step under a story |
| Bug | `Bug` | Defect tracking |

### Key Fields
| Field Path | Description | Values |
|---|---|---|
| `System.Title` | Work item title | String (required) |
| `System.Description` | HTML description | String |
| `System.AssignedTo` | Person assigned | Email or display name |
| `System.IterationPath` | Sprint path | `ProjectName\\Sprint 1` |
| `System.AreaPath` | Team area | `ProjectName\\TeamArea` |
| `System.State` | Current state | New, Active, Resolved, Closed |
| `Microsoft.VSTS.Common.Priority` | Priority | 1 (Critical), 2 (High), 3 (Medium), 4 (Low) |
| `Microsoft.VSTS.Common.ValueArea` | Value area | Business, Architectural |
| `System.Tags` | Tags | Semicolon-separated string |

### Agile-specific Fields
| Field Path | Applies To | Description |
|---|---|---|
| `Microsoft.VSTS.Common.StoryPoints` | User Story | Numeric effort estimate |
| `Microsoft.VSTS.Scheduling.RemainingWork` | Task | Hours remaining |
| `Microsoft.VSTS.Common.AcceptanceCriteria` | User Story | HTML acceptance criteria |

---

## Scrum Process

### Hierarchy (top → bottom)
```
Epic → Feature → Product Backlog Item → Task
                                       → Bug
```

### Work Item Types (exact API names)
| Level | Type Name (exact) | Use for |
|---|---|---|
| Portfolio | `Epic` | Large business initiatives |
| Portfolio | `Feature` | Capabilities within an epic |
| Requirement | `Product Backlog Item` | Deliverable unit of value |
| Task | `Task` | Implementation step |
| Bug | `Bug` | Defect tracking |

### Scrum-specific Fields
| Field Path | Applies To | Description |
|---|---|---|
| `Microsoft.VSTS.Scheduling.Effort` | Product Backlog Item | Numeric effort |
| `Microsoft.VSTS.Scheduling.RemainingWork` | Task | Hours remaining |
| `Microsoft.VSTS.Common.AcceptanceCriteria` | Product Backlog Item | HTML acceptance criteria |
| `Microsoft.VSTS.Common.BacklogPriority` | Product Backlog Item | Stack rank (decimal) |

### States
| State | Meaning |
|---|---|
| New | Not started |
| Approved | Reviewed and accepted into backlog |
| Committed | Assigned to a sprint |
| Done | Completed |

---

## CMMI Process

### Hierarchy (top → bottom)
```
Epic → Feature → Requirement → Task
                              → Bug
```

### Work Item Types (exact API names)
| Level | Type Name (exact) | Use for |
|---|---|---|
| Portfolio | `Epic` | Large business initiatives |
| Portfolio | `Feature` | Capabilities within an epic |
| Requirement | `Requirement` | Formal requirement specification |
| Task | `Task` | Implementation step |
| Bug | `Bug` | Defect tracking |

### CMMI-specific Fields
| Field Path | Applies To | Description |
|---|---|---|
| `Microsoft.VSTS.Common.RequirementType` | Requirement | Functional, Quality of Service, Safety, etc. |
| `Microsoft.VSTS.CMMI.RequiredAttendee1` | Various | Meeting attendee |
| `Microsoft.VSTS.Scheduling.Size` | Requirement | Estimated size |
| `Microsoft.VSTS.Scheduling.RemainingWork` | Task | Hours remaining |

### States
| State | Meaning |
|---|---|
| Proposed | Initial state |
| Active | In progress |
| Resolved | Completed, awaiting validation |
| Closed | Validated and closed |

---

## Basic Process

### Hierarchy (top → bottom)
```
Epic → Issue → Task
```

Note: Basic process has NO Feature level and NO User Story level. Issues serve as the mid-level work item.

### Work Item Types (exact API names)
| Level | Type Name (exact) | Use for |
|---|---|---|
| Portfolio | `Epic` | Large initiatives |
| Requirement | `Issue` | Work items (replaces both Feature and Story) |
| Task | `Task` | Implementation step |

### States
| State | Meaning |
|---|---|
| To Do | Not started |
| Doing | In progress |
| Done | Completed |

---

## Repository Boundaries (Poly-repo Projects)

Azure DevOps does not tightly couple work items to repositories — there is no built-in "Repository" field on a work item, and the boards process does not enforce any repo rule. The relationship is a planning convention layered on top, plus the actual code links (branches/commits/PRs) that get attached to a work item once development starts.

The recommended convention for a project with multiple repositories:

| Level | Repository scope |
|---|---|
| `Epic` | May span multiple repositories |
| `Feature` | May span multiple repositories (its repos = the union of its child stories' repos) |
| `User Story` / `Product Backlog Item` / `Requirement` | **Exactly one repository** |
| `Task` | Inherits its parent story's repository (a task is a step within the story's single-repo deliverable) |
| `Bug` | Inherits the repository of the story/PBI it relates to |

Rationale: a story is the unit a developer delivers through a branch and pull request, and a PR targets one repository. Keeping a story within a single repo keeps it independently buildable, reviewable, and testable. When a requirement needs work in more than one repo, split it into one story per repo under the same feature — do not create a single cross-repo story. The feature then legitimately spans repos through its children.

The single-repo-per-story rule is enforced by how the backlog is *split*, not by any stored field — repos are frequently not named or even created at planning time, so the split must hold up without them. Where a repo or component label is known, it can be recorded as a **Tag** on the story in the form `repo:<label>` (semicolon-separated in `System.Tags`), which is filterable and queryable so a team can slice the backlog by repo later. This tag is optional; when no label exists, the story simply carries none. This is a soft convention throughout: an occasional "umbrella" story deliberately spanning repos is allowed as an exception, but the single-repo-per-story split should be the default.

---

## API Details for Work Item Creation

### Create Work Item
```
POST https://dev.azure.com/{org}/{project}/_apis/wit/workitems/${type}?api-v