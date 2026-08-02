# Safety (always enforced)

- Never hardcode, print, or commit secrets, tokens, or connection strings.
- Never run commands against production systems or databases.
- Log every assumption you make to the active run file (`.aidlc/runs/<ID>.md`) — and mirror it to the work item.
- If blocked after the configured max fix cycles, STOP and report — do not thrash.
- Do not modify `.claude/settings*.json`, hook scripts, or permission rules. These are enforced by a
  hook, not just by this rule: a change that genuinely belongs there is staged for a human to apply.
