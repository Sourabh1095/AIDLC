// Tests for pr-guide.mjs — the "How to review this PR" skeleton. Run: `node pr-guide.test.mjs`.
import { guide, renderGuide } from "./pr-guide.mjs";

let n = 0, fails = 0;
function check(label, actual, expected) {
  n++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`ok    ${label}`); return; }
  fails++;
  console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
}
const paths = (rows) => rows.map((r) => r.path);

const files = [
  { path: "package-lock.json", added: 900, deleted: 20 },
  { path: "src/api/avatar.controller.ts", added: 40, deleted: 2 },
  { path: "src/api/avatar.service.ts", added: 120, deleted: 10 },
  { path: "src/lib/image.ts", added: 30, deleted: 0 },
  { path: "src/auth/guard.ts", added: 5, deleted: 1 },
  { path: "src/ui/avatar.tsx", added: 2, deleted: 1 },
  { path: "src/api/avatar.service.spec.ts", added: 80, deleted: 0 },
  { path: "db/migrations/0042_avatar.sql", added: 12, deleted: 0 },
  { path: "openapi.yaml", added: 20, deleted: 0 },
  { path: "README.md", added: 4, deleted: 0 },
  { path: ".aidlc/runs/PROJ-1.md", added: 50, deleted: 0 },
];
const config = { saas: { authPaths: ["src/auth/**"], apiContracts: [{ path: "openapi.yaml", public: true }] } };
const g = guide(files, { config });

check("start here = the largest logic files, not the lockfile", paths(g.start), ["src/api/avatar.service.ts", "src/api/avatar.controller.ts", "src/lib/image.ts"]);
check("the rest of the logic follows", paths(g.rest), ["src/auth/guard.ts", "src/ui/avatar.tsx"]);
check("tests are grouped", paths(g.tests), ["src/api/avatar.service.spec.ts"]);
check("migrations are grouped", paths(g.migrations), ["db/migrations/0042_avatar.sql"]);
check("lockfile and contract file land in config", paths(g.config).sort(), ["openapi.yaml", "package-lock.json"]);
check("run state is bookkeeping", paths(g.bookkeeping), [".aidlc/runs/PROJ-1.md"]);
check(
  "risky: auth path, API contract, migration, dependency change",
  g.risky.map((r) => [r.path, r.flags]).sort(),
  [
    ["db/migrations/0042_avatar.sql", ["migration"]],
    ["openapi.yaml", ["API contract"]],
    ["package-lock.json", ["dependency change"]],
    ["src/auth/guard.ts", ["auth"]],
  ],
);
const md = renderGuide(g);
check("rendered guide leads with Start here", md.split("\n")[2], "**Start here** — where the change lives:");
check("rendered guide asks for the why and the try-it steps", [md.includes("{{WHY}}"), md.includes("**Try it:**")], [true, true]);
check("rendered guide skips bookkeeping in one line", md.includes("*Skip:* 1 AIDLC run-state file(s)"), true);
check("no config still orders the files", paths(guide(files, {}).start).length, 3);

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
