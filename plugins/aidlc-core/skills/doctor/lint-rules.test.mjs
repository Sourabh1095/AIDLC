// Tests for lint-rules.mjs — the permission-rule shape lint shared by the
// marketplace's CI (which lints the shipped templates) and /aidlc:doctor (which lints
// the user's real settings). Run: `node lint-rules.test.mjs`.
//
// Every case here is a spelling that ALREADY SHIPPED broken at least once. The suite
// exists so the answer to "did we fix that?" is a command rather than a memory.
import { lintPermissionRules, lintSettingsText, parseRule } from "./lint-rules.mjs";

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
const codes = (perms) => lintPermissionRules(perms).map((f) => f.code);
const has = (perms, code) => codes(perms).includes(code);

// --- parseRule ----------------------------------------------------------------------
check("parseRule splits tool and body", parseRule("Bash(git status:*)").tool === "Bash");
check("parseRule keeps a mid-pattern glob in the body", parseRule("Bash(git -C * add*)").body === "git -C * add*");
check("parseRule on a bare tool name yields a null body", parseRule("Read").body === null);

// --- F44 / F48: Write(<path>) matches nothing ----------------------------------------
check("Write(path) in deny is an error", has({ deny: ["Write(.claude/settings.json)"] }, "write-rule-never-matched"));
check("Write(path) in ask is an error", has({ ask: ["Write(**/.env)"] }, "write-rule-never-matched"));
check("Write(path) in allow is an error", has({ allow: ["Write(src/**)"] }, "write-rule-never-matched"));
check("the equivalent Edit(path) rule is fine", !has({ deny: ["Edit(.claude/settings.json)"] }, "write-rule-never-matched"));
check(
  "a bare Write tool rule (no path) is fine",
  !has({ allow: ["Write"] }, "write-rule-never-matched"),
);
check(
  "the Write finding names the Edit replacement",
  lintPermissionRules({ ask: ["Write(**/.env)"] })[0].message.includes("Edit(**/.env)"),
);

// --- F45 (1): `:*` does not compose with a mid-pattern `*` ----------------------------
check("`:*` after a mid-pattern glob is an error", has({ allow: ["Bash(git -C * add:*)"] }, "colon-star-after-glob"));
check("the corrected `*` form is fine", !has({ allow: ["Bash(git -C * add*)"] }, "colon-star-after-glob"));
check("a plain prefix rule with `:*` is fine", !has({ allow: ["Bash(git status:*)"] }, "colon-star-after-glob"));
check("`Bash(git -C:*)` is fine — the `*` is part of the suffix", !has({ allow: ["Bash(git -C:*)"] }, "colon-star-after-glob"));
check(
  "on a deny list the message says the failure is silent",
  lintPermissionRules({ deny: ["Bash(git -C * push --force:*)"] })[0].message.includes("silently"),
);

// --- F45 (2): trailing ` *` does not match end-of-string ------------------------------
const spaceStarDeny = { deny: ["Bash(git push --force *)"] };
check("trailing ` *` on deny with no exact sibling is an error", has(spaceStarDeny, "space-star-no-exact-sibling"));
check(
  "trailing ` *` WITH an exact sibling is fine",
  !has({ deny: ["Bash(git push --force *)", "Bash(git push --force)"] }, "space-star-no-exact-sibling"),
);
check(
  "on allow it is a warning, not an error — a dead allow blocks loudly",
  lintPermissionRules({ allow: ["Bash(npm run *)"] }).find((f) => f.code === "space-star-no-exact-sibling")?.severity ===
    "warning",
);
check(
  "on deny it is an error — a dead deny is silent",
  lintPermissionRules(spaceStarDeny).find((f) => f.code === "space-star-no-exact-sibling")?.severity === "error",
);
check("no-space `*` needs no sibling", !has({ deny: ["Bash(git push * --force*)"] }, "space-star-no-exact-sibling"));

// --- Stale pre-0.28 env hard denies ---------------------------------------------------
check("Read(./.env) hard deny is an error", has({ deny: ["Read(./.env)"] }, "stale-env-hard-deny"));
check("Read(./.env.*) hard deny is an error", has({ deny: ["Read(./.env.*)"] }, "stale-env-hard-deny"));
check("the modern ask-floor rule is fine", !has({ ask: ["Read(**/.env)"] }, "stale-env-hard-deny"));
check(
  "the finding explains that the switch becomes inert",
  lintPermissionRules({ deny: ["Read(./.env)"] })[0].message.includes("envFileAccess"),
);

// --- Duplicates ------------------------------------------------------------------------
check("a duplicated rule is reported", has({ deny: ["Bash(a)", "Bash(a)"] }, "duplicate-rule"));
check("distinct rules are not", !has({ deny: ["Bash(a)", "Bash(b)"] }, "duplicate-rule"));

// --- Shape tolerance --------------------------------------------------------------------
check("an absent permissions object yields nothing", lintPermissionRules().length === 0);
check("a non-array list is ignored rather than throwing", lintPermissionRules({ allow: "nope" }).length === 0);
check("an empty list yields nothing", lintPermissionRules({ allow: [] }).length === 0);
check(
  "the real shipped template shape is clean",
  lintPermissionRules({
    allow: ["Bash(git status:*)", "Bash(git -C * status*)", "Read", "Edit"],
    deny: ["Bash(git push --force *)", "Bash(git push --force)", "Edit(.claude/settings.json)"],
    ask: ["Read(**/.env)", "Edit(**/.env)"],
  }).length === 0,
);

// --- F49: raw-text checks ----------------------------------------------------------------
check("a // comment is caught", lintSettingsText('{\n  // "a": 1\n  "b": 2\n}').some((f) => f.code === "json-comment"));
check("a /* */ comment is caught", lintSettingsText('{\n /* x */ "b": 2\n}').some((f) => f.code === "json-comment"));
check("valid JSON is clean", lintSettingsText('{"permissions":{"allow":[]}}').length === 0);
check(
  "a // INSIDE a string value is not a comment",
  lintSettingsText('{"url": "https://example.com/x"}').length === 0,
);
check("broken JSON is reported as a parse failure", lintSettingsText("{nope}").some((f) => f.code === "json-parse"));
check(
  "the comment message names the enabledPlugins blast radius",
  lintSettingsText("{\n// x\n}")[0].message.includes("enabledPlugins"),
);

console.log(`\n${n - fails}/${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
