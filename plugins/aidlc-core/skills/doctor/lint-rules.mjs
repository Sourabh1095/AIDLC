// Permission-rule shape lint — the known-broken spellings, in one place.
//
// Two callers, deliberately: the marketplace's CI lints the SHIPPED templates, and
// `/aidlc:doctor` lints the USER'S real `.claude/settings.json`. Those are different
// files with the same failure modes, and the failure modes are the ones that keep
// recurring because nothing mechanical checks them:
//
//   F44/F48  `Write(<path>)` rules are never matched by file permission checks (only
//            Read/Edit are). Accepted silently, warned at every session start, enforce
//            nothing. Found twice — the second time by reapplying the first fix's own
//            mistake to a different list.
//   F45      `:*` does not compose with a mid-pattern `*`, and a trailing ` *` does not
//            match end-of-string. Every rule in F43's set was one suffix from working.
//   F49      `//` in settings.json makes the whole file unparseable, and Claude Code
//            then skips it entirely — including `enabledPlugins`, which silently
//            disables every plugin with a symptom nowhere near the cause.
//
// What this is NOT: a matcher. It cannot prove a rule matches the command you meant —
// F45 established the documentation is wrong on both points, so only a live probe can.
// What it guarantees is that a spelling already known to match nothing is never
// mistaken for protection. That asymmetry is the whole reason it exists: a dead ALLOW
// rule blocks a run loudly, a dead DENY rule is silent.

/** `Bash(git -C * status*)` → { tool: "Bash", body: "git -C * status*" }. */
export function parseRule(rule) {
  const m = /^([A-Za-z]+)\((.*)\)$/s.exec(String(rule));
  return m ? { tool: m[1], body: m[2] } : { tool: String(rule), body: null };
}

/**
 * Lint a `permissions` object. Returns findings:
 *   { list, rule, severity: "error"|"warning", code, message }
 * `error` = this rule enforces nothing, or a protection is silently absent.
 */
export function lintPermissionRules(permissions = {}) {
  const out = [];
  for (const list of ["allow", "deny", "ask"]) {
    const rules = permissions[list];
    if (!Array.isArray(rules)) continue;
    const present = new Set(rules);

    for (const rule of rules) {
      const { tool, body } = parseRule(rule);
      const add = (severity, code, message) => out.push({ list, rule, severity, code, message });

      // F44 / F48 — Edit already covers every file-editing tool, including Write.
      if (tool === "Write" && body !== null) {
        add(
          "error",
          "write-rule-never-matched",
          `\`${rule}\` is never matched by file permission checks — only Read(path) and Edit(path) are. ` +
            `Use \`Edit(${body})\`, which already covers the Write tool. This rule also prints a warning at every session start.`,
        );
        continue;
      }
      if (tool !== "Bash" || body === null) continue;

      // F45 (1) — a trailing `:*` after a mid-pattern `*` matches nothing at all.
      if (body.endsWith(":*") && body.slice(0, -2).includes("*")) {
        add(
          "error",
          "colon-star-after-glob",
          `\`${rule}\` matches NOTHING: a trailing \`:*\` does not compose with a mid-pattern \`*\`. ` +
            `Write the trailing wildcard as \`*\`, not \`:*\`.` +
            (list === "deny" ? " On a deny list this fails silently — there is no protection here." : ""),
        );
        continue;
      }

      // F45 (2) — a trailing ` *` does not match end-of-string, so the argument-less
      // spelling slips past. Silent on deny/ask; merely obstructive on allow.
      if (body.endsWith(" *")) {
        const exact = `Bash(${body.slice(0, -2)})`;
        if (!present.has(exact)) {
          add(
            list === "allow" ? "warning" : "error",
            "space-star-no-exact-sibling",
            `\`${rule}\` does not match the argument-less spelling: a trailing \` *\` does not match ` +
              `end-of-string. Add \`${exact}\` alongside it.`,
          );
        }
      }
    }

    const dupes = [...new Set(rules.filter((x, i) => rules.indexOf(x) !== i))];
    if (dupes.length)
      out.push({
        list,
        rule: dupes.join(", "),
        severity: "warning",
        code: "duplicate-rule",
        message: `duplicate rule(s) in ${list}: ${dupes.join(", ")}. Usually means two edits to one list without reading it.`,
      });
  }

  // The pre-0.28 hard env denies can never be relaxed by `pipeline.envFileAccess`, so
  // leaving them in place makes that switch silently inert.
  for (const stale of ["Read(./.env)", "Read(./.env.*)"]) {
    if ((permissions.deny ?? []).includes(stale))
      out.push({
        list: "deny",
        rule: stale,
        severity: "error",
        code: "stale-env-hard-deny",
        message:
          `\`${stale}\` is the pre-0.28 hard deny. It overrides \`pipeline.envFileAccess\` permanently, so the ` +
          `switch does nothing. Enforcement moved to the env-guard hook; settings should carry only the \`ask\` floor.`,
      });
  }

  return out;
}

/**
 * Lint the raw TEXT of a settings file, before parsing. Comments have to be caught
 * here: `//` inside a string value is legal JSON, so JSON.parse alone cannot tell
 * "someone commented a rule out" from "this file is broken some other way" — and that
 * distinction is the entire remediation.
 */
export function lintSettingsText(text) {
  const out = [];
  const withoutStrings = String(text).replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (/(^|\s)\/\/|\/\*/.test(withoutStrings))
    out.push({
      severity: "error",
      code: "json-comment",
      message:
        "contains a `//` or `/* */` comment. settings.json is STRICT JSON — Claude Code skips the entire file when it " +
        "fails to parse, including `enabledPlugins`, so every plugin silently disappears while `/plugin` still lists " +
        "them as installed (F49). Delete the line outright; never comment it out.",
    });
  try {
    JSON.parse(text);
  } catch (e) {
    out.push({
      severity: "error",
      code: "json-parse",
      message: `does not parse as strict JSON: ${e.message}. Claude Code skips the whole file, disabling every plugin configured in it.`,
    });
  }
  return out;
}
