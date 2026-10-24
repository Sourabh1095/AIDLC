# /aidlc:adopt — 5 · SaaS runtime constraints — the facts that change how code must be written

Part of the adopt skill: this step, moved out so the skill fits in one read. Read it in full when the scan
reaches this step; every rule in `SKILL.md` (the five rules, the safety contract) still applies here.

For a live product, the facts that most constrain an implementation are **not in the stack list**.
"TypeScript + Postgres" says almost nothing about what a safe change looks like; "shared-schema
multi-tenant on `tenant_id`, migrations run against live customer data, releases ride LaunchDarkly
flags, and `openapi/public-v1.yaml` is a published contract" says nearly everything. Those are the
facts that turn a plausible diff into a cross-tenant data leak or a breaking change for every
integrator — and on a brownfield project nobody writes them down, because everyone already knows them.

Record them per root as `saas`. This is mostly a **`--depth deep`** section: tenancy and isolation are
evidenced in source and schema, not in a manifest. At `quick` or `standard`, record what the manifests
and config do show and leave the rest `unknown` **with the reason "not sampled at this depth"** — never
`absent`, and never a default.

| Constraint | Where the evidence is |
|---|---|
| `tenancy` | The schema, not the README. **shared-schema**: a `tenant_id`/`org_id`/`account_id`/`workspace_id` column across many tables (ORM models, migrations, `schema.prisma`, `models.py`, entity classes), a request-scoped scoping middleware/interceptor, Postgres row-level-security (`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`), or an ORM global scope (Rails `default_scope`, Django manager, a Prisma client extension). **schema-per-tenant**: a per-request `SET search_path` / `USE <schema>`, a schema resolver, `django-tenants`, the `apartment` gem. **database-per-tenant**: a connection resolver keyed by tenant, or a tenants registry holding per-tenant connection targets (record that it exists; **never read the connection values**). **single-tenant**: no tenant key anywhere plus per-customer deploy config. **not-multi-tenant**: a library, CLI or internal tool with no tenants at all |
| `tenantKey` | The column or claim name itself (`tenant_id`, `org_id`) — a reviewer checks a new query against it, so the name matters more than the model label |
| `tenantIsolationPaths` | The files implementing the mechanism: the scoping middleware, the RLS policy directory, the connection resolver |
| `authPaths` | Authentication, authorization, SSO, RBAC, session handling — guards, strategies, policy modules, `@Roles`-style decorators |
| `billingPaths` | Billing, subscription, entitlement, metering, quota enforcement |
| `featureFlags` | A flag SDK in the manifests (LaunchDarkly, Unleash, Flagsmith, OpenFeature, Split, ConfigCat, PostHog) or a homegrown flag table/module. Set `required: true` **only** where the project's own convention says every user-visible change ships behind one (a CONTRIBUTING rule, a flag wrapper every route goes through) — otherwise record the provider and leave `required` unset |
| `migrations` | Tool + directory, the same detection as `migrationTools[]`; repeated here because the constraint attaches to it |
| `liveDataConstraint` | `expand-contract` where migrations run against data real tenants already have. Direct evidence: paired migrations (add nullable column → backfill → later drop), a documented migration policy, a CI check that rejects destructive DDL. **Not optional to answer:** if tenancy is multi-tenant *and* a migration tool exists, this must come back `known` — leaving it silent means the reviewer brief carries no migration constraint and a dropped column reads as an ordinary refactor. `not-required` needs its own evidence (pre-launch, or migrated on customer upgrade), not merely an absence of proof |
| `apiContracts` | `openapi*.y?ml`/`swagger*`, `*.graphql`/`*.gql`/SDL, `*.proto`, `asyncapi*`, published JSON Schemas, `*.wsdl`. `public: true` when external consumers depend on it — a versioned filename or route (`/v1/`), a published docs site, a client SDK generated from it |
| `environments`, `deployStrategy` | CI/CD config only: GitHub `environment:` keys, ADO stages, k8s overlays/Helm values-per-env, Terraform workspaces, `argo-rollouts`/`flagger`/`canary`/`blue-green` manifests. Never a guess about what a team probably has |
| `freezeWindows` | A schedule guard in the deploy workflow, or a documented change-freeze calendar. **Name the source** — an unsourced freeze would block an integration on a rumour |
| `compliance` | A **named signal**: a BAA reference, a PCI SAQ, a DPA, a SOC 2 control document with evidence owners, an audit-log table, GDPR/DSAR code paths. Never the word "secure" in a README, and never the industry the product serves. A regime raises the review cost of every future change, so an inferred one is an expensive wrong answer |
| `messaging` | Queues, brokers, streams, schedulers, webhook handlers (BullMQ, Celery, Sidekiq, Kafka, SQS/SNS, RabbitMQ, Pub/Sub, cron configs). Their message shapes are contracts with consumers that **no contract file records** |
| `observability` | Sentry, Datadog, OpenTelemetry, New Relic, Prometheus — recorded because incidents are a legitimate intake source, and because a diff that drops instrumentation is a regression no test catches |
| `integrations` | Third-party SDKs and webhook endpoints, by name and path. Sandbox-vs-production credential handling is recorded as a *shape* only; production credentials stay barred by `rules/safety.md` regardless |
| `experimentation` | An A/B or analytics-rollout library, where evidenced |

Then compute **`securityReviewPathSeeds`**: the union of `tenantIsolationPaths`, `authPaths`,
`billingPaths`, and any path a named compliance regime governs. This is the array the apply step
proposes into `pipeline.securityReviewPaths`, and it is the whole mechanism behind "a change to tenant
isolation is security-reviewed regardless of cadence". A path recorded as sensitive above and missing
from the seeds is a path that will be reviewed on the ordinary cadence — recorded as dangerous, treated
as routine. The validator rejects that, because it is invisible in a report that otherwise looks complete.

Five rules specific to this section:

1. **Tenancy describes the system the root takes part in, not only the schema it owns.** A gateway, a
   proxy, a worker, a frontend — a real workspace has several roots with no schema at all, and every
   signal in the table above assumes one. Follow the table literally on a stateless root and you land on
   `not-multi-tenant`, which is the **worst** answer available: it tells every later reviewer that
   cross-tenant leaks are impossible there, and it empties `securityReviewPathSeeds` for that root. The
   fixture case that makes this concrete is an 18-line Go handler that reads a tenant slug off the `Host`
   header and injects it downstream — it owns nothing and *decides everything*, and a bug in it is a
   cross-tenant read with no database involved. So: a root with no schema **inherits** the workspace's
   tenancy at `medium` confidence, with an `absence` note recording that it owns no schema and where the
   value came from — and any file that **determines, forwards or trusts** the tenant is a
   `tenantIsolationPaths` entry, so it reaches the seeds. Reserve `not-multi-tenant` for something with
   no tenants anywhere in its call path (a build tool, a standalone library), and evidence *that*, rather
   than inferring it from an absence of columns. Note why this one is self-sealing: the validator's
   tenancy invariants are all conditioned on the root being multi-tenant, so a wrong
   `not-multi-tenant` switches every downstream check off and the profile still passes.
2. **`unknown` is emphatically not `not-multi-tenant`.** Finding no tenant column because you sampled
   30 files of 4,000 is not evidence of single tenancy — and getting this backwards is the worst
   available outcome, since it tells every later reviewer that cross-tenant leaks are impossible here.
3. **Still no runtime access.** No database connection, no query, no deploy API, no health endpoint.
   Tenancy is read from the schema and the code that uses it (`rules/safety.md`).
4. **Env files stay closed.** Environment *names* come from CI/CD config, never from reading a `.env`.
   §0's contract is unchanged by this section needing environment names.
5. **This block informs; it does not gate.** It feeds the implementer, reviewer and security briefs.
   Exactly two things become conditional gates downstream, and both hang on an evidenced fact: a
   destructive migration where `liveDataConstraint` is `expand-contract` is a review **blocker**, and a
   diff touching an `apiContracts`, `authPaths` or `tenantIsolationPaths` entry is reviewed regardless
   of the configured cadence. Nothing else here blocks anything, and the report says so.
