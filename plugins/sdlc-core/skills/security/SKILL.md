---
name: security
description: The SDLC security review procedure — OWASP-oriented diff review, dependency audit steps, secret patterns and authz reasoning. Load when performing a security pass on a work item's changes or auditing dependencies.
user-invocable: false
---

# Security — review procedure

Scope discipline: review what the DIFF makes reachable, in blast-radius order. Pre-existing
issues get reported separately, never block the current run.

## 1 · Input → sink tracing

For each new/changed input (route/query/body/header/cookie/file/env/webhook):
list its sinks — SQL/NoSQL query, shell/exec, HTML render, file path, redirect URL, header
value, eval/deserialize — and verify sanitization/parameterization ON THE PATH (not just
"a validator exists somewhere"). Parameterized queries and ORM binding pass; string
concatenation into any sink is a BLOCKER with the trace written out.

## 2 · AuthN/AuthZ

- Every new route/page/resolver: which guard/middleware covers it? Prove it (file:line), don't assume the framework default.
- IDOR: every ID from the request that reaches a query — is ownership/tenancy checked?
- Privilege boundaries: role checks server-side (client-side checks are UX, not security).

## 3 · Secrets & data exposure

Patterns to grep the diff for: `password|secret|token|apikey|api_key|BEGIN.*PRIVATE`,
base64 blobs in config, connection strings. Also: PII in new log lines; stack traces/internal
errors returned to clients; overly informative auth failures ("no such user").

## 4 · Dependency audit (manifests/lockfiles changed)

1. `npm audit --omit=dev --json` (or pnpm/yarn equivalent) — evaluate NEW findings vs the default branch, not the whole backlog of known ones.
2. New packages: weekly downloads + last publish + repo activity (typosquat check: exact name vs the popular one), `preinstall/postinstall` scripts, license.
3. Critical CVE in a newly added direct dependency = BLOCKER; new advisory in a transitive dep = MAJOR with the upgrade path named.

## 5 · Config regressions

CORS origins widened · security headers/CSP removed · cookies losing `httpOnly/secure/sameSite` ·
debug/verbose flags on · TLS verification disabled · uploads: type/size limits and storage path traversal.

## Severity & reporting

Use the `sdlc:code-review` taxonomy; findings prefixed `security:` with an attack sketch and a
fix. Reachability required: name the entry point an attacker uses. If a mitigating control
exists elsewhere, verify it and cite it instead of reporting the ghost.
