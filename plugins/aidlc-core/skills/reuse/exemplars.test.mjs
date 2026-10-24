// Tests for exemplars.mjs — golden-path recipes from git history. Run: `node exemplars.test.mjs`.
// Requires git on PATH.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { findExemplars, renderExemplars } from "./exemplars.mjs";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";


const repo = mkdtempSync(join(tmpdir(), "exemplars-"));
const w = (p, s = "x\n") => {
  mkdirSync(dirname(join(repo, p)), { recursive: true });
  writeFileSync(join(repo, p), s);
};
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] });
const commit = (msg) => {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
};
git("init", "-q");
git("config", "user.email", "t@t.co");
git("config", "user.name", "test");

// 1. A bulk initial import — 30 files including a controller. Not a usable recipe.
for (let i = 0; i < 28; i++) w(`src/legacy/file${i}.ts`);
w("src/health/health.controller.ts", "export class HealthController {}\n");
w("src/app.module.ts", "export class AppModule {}\n");
commit("chore: initial import");

// 2. How an endpoint is really added here: controller, service, DTO, test, module registration.
w("src/users/users.controller.ts", "export class UsersController {}\n");
w("src/users/users.service.ts");
w("src/users/dto/create-user.dto.ts");
w("src/users/users.controller.spec.ts");
w("src/app.module.ts", "export class AppModule { /* + UsersModule */ }\n");
commit("feat(users): add the users endpoint");

// 3. A page, with its loading state, and a migration with the schema change.
w("app/dashboard/page.tsx");
w("app/dashboard/loading.tsx");
commit("feat(web): dashboard page");
w("prisma/migrations/20261001_add_avatar/migration.sql");
w("prisma/schema.prisma");
commit("feat(db): avatar column");

const ex = findExemplars(repo);
check("endpoint: the focused recent example, not the bulk-imported one", ex.endpoint?.[0].file, "src/users/users.controller.ts");
check(
  "endpoint recipe: every file that change touched",
  ex.endpoint?.[0].recipe.files.map((f) => `${f.status} ${f.path}`).sort(),
  ["A src/users/dto/create-user.dto.ts", "A src/users/users.controller.spec.ts", "A src/users/users.controller.ts", "A src/users/users.service.ts", "M src/app.module.ts"],
);
check("page recipe includes its loading state", ex.page?.[0].recipe.files.map((f) => f.path).sort(), ["app/dashboard/loading.tsx", "app/dashboard/page.tsx"]);
check("migration recipe includes the schema edit", ex.migration?.[0].recipe.files.map((f) => f.path).sort(), ["prisma/migrations/20261001_add_avatar/migration.sql", "prisma/schema.prisma"]);
check("test kind found", ex.test?.[0].file, "src/users/users.controller.spec.ts");
check("a kind the project lacks is absent", "job" in ex, false);
const md = renderExemplars("api", ex);
check("rendered recipe names the commit and marks added vs edited", [md.includes("feat(users): add the users endpoint"), md.includes("- edited `src/app.module.ts`")], [true, true]);

// Only a bulk commit has the kind: the example is still offered, marked as too broad to copy.
const bulk = mkdtempSync(join(tmpdir(), "exemplars-bulk-"));
const gb = (...a) => execFileSync("git", a, { cwd: bulk, stdio: ["ignore", "pipe", "ignore"] });
gb("init", "-q");
gb("config", "user.email", "t@t.co");
gb("config", "user.name", "test");
for (let i = 0; i < 30; i++) {
  mkdirSync(join(bulk, "src"), { recursive: true });
  writeFileSync(join(bulk, "src", `f${i}.ts`), "x\n");
}
mkdirSync(join(bulk, "src", "orders"), { recursive: true });
writeFileSync(join(bulk, "src", "orders", "orders.controller.ts"), "x\n");
gb("add", "-A");
gb("commit", "-q", "-m", "init");
const exb = findExemplars(bulk, { kinds: ["endpoint"] });
check("bulk-only history: example offered, recipe marked too broad", [exb.endpoint?.[0].file, exb.endpoint?.[0].recipe.tooBroad], ["src/orders/orders.controller.ts", true]);

rmSync(repo, { recursive: true, force: true });
rmSync(bulk, { recursive: true, force: true });
done();
