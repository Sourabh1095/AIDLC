# wi-ado — connectivity

Part of the `aidlc:wi-ado` skill, kept apart so the runs that do not need it do not load it. Read when the board cannot be reached, and before ever using the token fallback.

## Connectivity — "connected" ≠ "authenticated"

`/mcp` showing `azure-devops · connected · N tools` means the MCP **process started and registered
tools** — it does NOT mean ADO is reachable. It authenticates on the first real call; a common failure
is the opaque *"Failed to find api location for area."* Root cause is almost always the **launch
environment**: `ADO_MCP_ORG` must be set **and** `az login` must be accessible **in the shell that
launched Claude Code**. Installing `az` mid-session doesn't help — it isn't on the launching shell's
PATH; a full relaunch from a shell with both is required. If board reads fail this way, verify (and
tell the user): `echo $ADO_MCP_ORG` is set, `az account show` succeeds, `az devops configure --defaults
organization=… project=…` ran — all in the launching shell — then relaunch. (`/aidlc:status` surfaces
this as a doctor check.)

## PAT + REST last-resort (tier 3 — off by default)

When **neither** the MCP nor `az` can reach the board and the user has explicitly provided a
Personal Access Token, the same eight operations can run over the ADO REST API directly. This is a
deliberate escape hatch, not a normal path — prefer fixing MCP/`az` first.

- **Gate it.** Use this tier only when (a) tiers 1–2 are confirmed unavailable, and (b) a PAT is
  present. A PAT needs **Work Items: Read & Write** + **Project & Team: Read** at minimum. Never
  invent or persist one.
- **Secret handling — never write the token to a file.** Read it from the environment
  (`AZURE_DEVOPS_EXT_PAT`, the same var `az` honors) or accept it for in-session use only. **Do not
  echo it, commit it, or embed it in any generated artifact.** In particular, **never generate a
  self-contained HTML file with the PAT baked in** — that browser-pusher pattern (from the standalone
  claude.ai planner skill) is for sandboxes with no network and no CLI; here the write path is a
  direct, verified REST call, and a token-in-a-file is an avoidable leak.
- **Transport.** Basic auth header `Authorization: Basic base64(":" + PAT)`; create via
  `POST {org}/{project}/_apis/wit/workitems/${type}?api-version=7.1` with a
  `application/json-patch+json` body of `{op:add, path:/fields/<field>, value}` ops; iterations via
  `POST .../_apis/wit/classificationnodes/iterations`; parent/child via a `PATCH` adding a
  `System.LinkTypes.Hierarchy-Forward` relation. Field/type names per process are in the bootstrap
  skill's `references/work_item_types.md`.
- **Same contract still applies.** REST writes are subject to the identical **write-verification**
  (read back, assert, retry, hard-error on mismatch) and per-type **status-category** resolution as
  the MCP/`az` tiers — the transport changes, the guarantees do not.
