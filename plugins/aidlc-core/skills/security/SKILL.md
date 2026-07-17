---
name: security
description: The AIDLC security review procedure — OWASP-oriented diff review, dependency audit steps, secret patterns and authz reasoning. Load when performing a security pass on a work item's changes or auditing dependencies.
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

## 4 · Dependency policy (vet BEFORE you install)

A new dependency is a supply-chain, freshness and compatibility decision — vet it *at the moment you
reach for it*, before any code is built on top of it. Rejecting a bad choice here is cheap;
discovering it in verify, after code depends on it, is rework. The `dep-vet` PreToolUse hook gates
`npm i <pkg>` / `pnpm|yarn|bun add …` to force this pause. This is not an allow-list — any package is
fine if it passes all three tests. Verify real facts via Context7/registry, never memory:

1. **Safe** — maintained (recent publish + real repo activity), exact name (typosquat check vs the
   popular package), sane license, no suspicious `pre/postinstall` scripts, clean of open CVEs
   (`npm audit --omit=dev --json` — evaluate NEW findings vs the default branch). Critical CVE in a
   newly added direct dep = BLOCKER; new advisory in a transitive dep = MAJOR with the upgrade path named.
2. **Latest stable** — take the current stable release (not a stale major, not an alpha/beta/rc/next
   tag). If you must hold an older version, record why. A direct dep already >1 major behind is tech debt.
3. **Compatible** — the chosen version satisfies the `peerDependencies` and `engines` of the project's
   stack (framework major, Node version) and of the packages it interoperates with. Resolve peer
   conflicts properly — NEVER `--legacy-peer-deps`/`--force` to silence one; `npm ci` failing on peers
   is the signal to fix the graph, not override it.

Same three tests apply when *bumping* a dependency — ongoing freshness/compat over time is
`aidlc:maintenance` (`npm outdated`, risk-tiered).

## 5 · Config regressions

CORS origins widened · security headers/CSP removed · cookies losing `httpOnly/secure/sameSite` ·
debug/verbose flags on · TLS verification disabled · uploads: type/size limits and storage path traversal.

## Severity & reporting

Use the `aidlc:code-review` taxonomy; findings prefixed `security:` with an attack sketch and a
fix. Reachability required: name the entry point an attacker uses. If a mitigating control
exists elsewhere, verify it and cite it instead of reporting the ghost.
