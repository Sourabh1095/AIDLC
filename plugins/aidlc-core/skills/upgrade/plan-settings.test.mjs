// Tests for plan-settings.mjs. Run: `node plan-settings.test.mjs`.
//
// The dangerous direction here is removal. A settings migration that drops a rule the
// user meant to keep silently widens or narrows their permission posture, and nothing
// downstream would say so — the run just behaves differently. Most of this suite asserts
// what is NOT removed.
import { planSettings } from "./plan-settings.mjs";

let fails = 0;
let n = 0;
function check(label, cond) {
  n++;
  if (cond) console.log(`ok    ${label}`);
  else {
    fails++;
    console.log(`FAIL  ${label}`);
  }
}
const perms = (p) => ({ permissions: p });
const rules = (r, list) => r.settings.permissions[list] ?? [];
const removed = (r, rule) => r.changes.some((c) => c.action === "remove" && c.rule === rule);
const added = (r, rule) => r.changes.some((c) => c.action === "add" && c.rule === rule);

const TEMPLATE = perms({
  allow: ["Bash(git status:*)", "Bash(git -C * status*)", "Read", "Edit"],
  deny: ["Bash(git push --force *)", "Bash(git push --force)", "Edit(.claude/settings.json)"],
  ask: ["Read(**/.env)", "Read(**/.env.*)", "Edit(**/.env)", "Edit(**/.env.*)"],
});

// --- Additions -------------------------------------------------------------------------
{
  const r = planSettings(perms({ allow: ["Bash(git status:*)"] }), TEMPLATE);
  check("a missing template rule is added", added(r, "Bash(git -C * status*)"));
  check("an already-present rule is not re-added", !added(r, "Bash(git status:*)"));
  check("no duplicates are produced", new Set(rules(r, "allow")).size === rules(r, "allow").length);
  check("the user's existing rule is kept", rules(r, "allow").includes("Bash(git status:*)"));
  check("the user's order is preserved, additions appended", rules(r, "allow")[0] === "Bash(git status:*)");
  check("the env ask floor arrives", rules(r, "ask").includes("Edit(**/.env)"));
}

// --- The F49 migration: stale env hard denies -----------------------------------------------
{
  const r = planSettings(perms({ deny: ["Read(./.env)", "Read(./.env.*)", "Bash(gh repo delete:*)"] }), TEMPLATE);
  check("Read(./.env) hard deny is removed", removed(r, "Read(./.env)"));
  check("Read(./.env.*) hard deny is removed", removed(r, "Read(./.env.*)"));
  check("neither survives into the result", !rules(r, "deny").some((x) => x.startsWith("Read(./.env")));
  check("an unrelated user deny is untouched", rules(r, "deny").includes("Bash(gh repo delete:*)"));
  check(
    "the removal explains that the switch was inert",
    r.changes.find((c) => c.rule === "Read(./.env)").why.includes("envFileAccess"),
  );
  check("the ask floor replaces it", rules(r, "ask").includes("Read(**/.env)"));
}

// --- F44/F48: no-op Write(<path>) rules --------------------------------------------------------
{
  const r = planSettings(perms({ deny: ["Write(.claude/settings.json)", "Edit(.claude/settings.json)"] }), TEMPLATE);
  check("a Write rule covered by a sibling Edit rule is removed", removed(r, "Write(.claude/settings.json)"));
  check("the covering Edit rule stays", rules(r, "deny").includes("Edit(.claude/settings.json)"));
  check(
    "the removal states enforcement is unchanged",
    r.changes.find((c) => c.rule === "Write(.claude/settings.json)").why.includes("Enforcement unchanged"),
  );
}
{
  // No Edit equivalent anywhere: removing it WOULD change enforcement, so it is kept and
  // reported instead. This is the conservative half of the rule.
  const r = planSettings(perms({ deny: ["Write(secrets/**)"] }), perms({ allow: [], deny: [], ask: [] }));
  check("an uncovered Write rule is NOT removed", !removed(r, "Write(secrets/**)"));
  check("it is kept in the output", rules(r, "deny").includes("Write(secrets/**)"));
  check("it is warned about instead", r.warnings.some((w) => w.rule === "Write(secrets/**)"));
  check("the warning names the fix", r.warnings[0].why.includes("Edit(secrets/**)"));
}

// --- F45 shapes: only removed when the template ships the corrected spelling ---------------------
{
  const r = planSettings(perms({ allow: ["Bash(git -C * status:*)"] }), TEMPLATE);
  check("a `:*`-after-glob rule is removed when the template replaces it", removed(r, "Bash(git -C * status:*)"));
  check("the corrected form is present", rules(r, "allow").includes("Bash(git -C * status*)"));
}
{
  const r = planSettings(perms({ allow: ["Bash(mytool -C * run:*)"] }), TEMPLATE);
  check("a broken rule with NO template replacement is kept", rules(r, "allow").includes("Bash(mytool -C * run:*)"));
  check("it is warned about, not silently dropped", r.warnings.some((w) => w.rule === "Bash(mytool -C * run:*)"));
  check("the warning says correcting it is the user's call", r.warnings[0].why.includes("your call"));
}

// --- Nothing outside `permissions` is touched -------------------------------------------------------
{
  const current = {
    enabledPlugins: { "aidlc@bee-logical": true },
    extraKnownMarketplaces: { "bee-logical": { source: "x" } },
    env: { FOO: "bar" },
    statusLine: { type: "command", command: "x" },
    permissions: { allow: [] },
  };
  const r = planSettings(current, TEMPLATE);
  check("enabledPlugins is preserved", r.settings.enabledPlugins["aidlc@bee-logical"] === true);
  check("extraKnownMarketplaces is preserved", r.settings.extraKnownMarketplaces["bee-logical"].source === "x");
  check("env is preserved", r.settings.env.FOO === "bar");
  check("statusLine is preserved", r.settings.statusLine.command === "x");
  check("the input object is not mutated", current.permissions.allow.length === 0);
}

// --- Idempotence -------------------------------------------------------------------------------------
{
  const once = planSettings(perms({ deny: ["Read(./.env)"] }), TEMPLATE);
  const twice = planSettings(once.settings, TEMPLATE);
  check("re-running reports no changes", twice.changed === false);
  check("re-running is byte-identical", JSON.stringify(twice.settings) === JSON.stringify(once.settings));
}
{
  const r = planSettings(TEMPLATE, TEMPLATE);
  check("a settings file already matching the template is unchanged", r.changed === false && r.warnings.length === 0);
}

// --- Shape tolerance -----------------------------------------------------------------------------------
check("an empty settings object gains the template's rules", planSettings({}, TEMPLATE).settings.permissions.allow.length > 0);
check("no arguments does not throw", planSettings().changed === false);
check(
  "a non-array list is replaced rather than crashing",
  Array.isArray(planSettings(perms({ allow: "nope" }), TEMPLATE).settings.permissions.allow),
);
check("an empty template proposes no additions", planSettings(perms({ allow: ["Bash(x)"] }), {}).changed === false);

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
