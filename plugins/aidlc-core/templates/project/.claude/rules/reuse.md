# Reuse first (always applies)

- Before writing any new component, hook, helper, API client, type, validator or test fixture, find
  what this project already has: load `aidlc:reuse` and query its catalog (or read
  `.aidlc/catalog/`, or search the shared folders — `components/ui`, `hooks`, `lib`, `utils`, …).
- Use it as is; extend it (a prop, a parameter, a variant) when it almost fits; write new code only when
  nothing fits — in the shared folder it belongs in, with a one-line doc comment, never inline in a screen.
- Never copy a block from a sibling file and edit it. Say what you reused when you report.
