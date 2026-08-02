// Plan a settings.json permission migration — the half that people demonstrably cannot
// do by hand.
//
// F49 is the reason this is code. A migration instruction that said "remove
// `Read(./.env)` and `Read(./.env.*)`" was followed by commenting the two rules out with
// `//`. settings.json is strict JSON, so Claude Code skipped the entire file — including
// `enabledPlugins` — and every /aidlc:* command vanished while /plugin still listed the
// plugins as installed. The symptom pointed nowhere near the cause, and a session was
// lost to an unrelated stale marketplace error before the real one surfaced. That
// finding's own lesson was: *prefer pointing users at the programmatic merge over
// hand-editing*. This is that merge, for a project that is already initialized.
//
// Three rules govern every decision below:
//
//  1. **Additions are safe; removals are enumerated.** New template rules are unioned in.
//     A rule is only ever REMOVED if it belongs to one of the documented dead classes —
//     it enforces nothing, or it permanently overrides a switch that is supposed to be
//     live. A rule the user wrote that merely looks unusual is theirs and stays.
//  2. **Nothing outside `permissions` is touched.** enabledPlugins, extraKnownMarketplaces,
//     env, hooks, statusLine — all preserved byte-for-byte. This function edits three
//     arrays and nothing else.
//  3. **The result is data, not a file.** Applying it is the caller's problem, and for
//     settings.json the caller cannot apply it either — protect-paths.mjs blocks the
//     pipeline from editing its own guardrails, correctly. It gets staged for a human.
import { lintPermissionRules, parseRule } from "../doctor/lint-rules.mjs";

/** The pre-0.28 hard denies. They can never be relaxed by pipeline.envFileAccess, so
 *  leaving them in place makes that switch permanently inert — reads of .env stay denied
 *  even at `"envFileAccess": "ask"`. Enforcement moved to the env-guard hook. */
const STALE_ENV_DENIES = ["Read(./.env)", "Read(./.env.*)"];

const LISTS = ["allow", "deny", "ask"];

/**
 * @param current  the project's parsed settings.json (any shape; may lack `permissions`)
 * @param template the shipped template's parsed settings.json
 * @returns { settings, changes, warnings, changed }
 *   changes:  [{ action: "add"|"remove", list, rule, why }]
 *   warnings: [{ list, rule, why }] — broken shapes with no template replacement, kept
 */
export function planSettings(current = {}, template = {}) {
  const next = JSON.parse(JSON.stringify(current));
  next.permissions = next.permissions ?? {};
  const changes = [];
  const warnings = [];

  const tmpl = template.permissions ?? {};
  // Every rule the template ships, in any list — used to decide whether a broken rule in
  // the user's file has a corrected equivalent arriving.
  const templateRules = new Set(LISTS.flatMap((l) => tmpl[l] ?? []));

  for (const list of LISTS) {
    const existing = Array.isArray(next.permissions[list]) ? [...next.permissions[list]] : [];
    const templateList = Array.isArray(tmpl[list]) ? tmpl[list] : [];

    // --- Removals, from the enumerated dead classes only -------------------------------
    const lint = lintPermissionRules({ [list]: existing });
    const keep = [];
    for (const rule of existing) {
      if (list === "deny" && STALE_ENV_DENIES.includes(rule)) {
        changes.push({
          action: "remove",
          list,
          rule,
          why:
            "pre-0.28 hard deny — it overrides `pipeline.envFileAccess` permanently, so the switch does nothing. " +
            "Enforcement moved to the env-guard hook; settings now carries only the `ask` floor.",
        });
        continue;
      }

      const broken = lint.find((f) => f.rule === rule && f.severity === "error");
      if (broken) {
        // A no-op `Write(<path>)` rule: `Edit(<path>)` already covers the Write tool, so
        // dropping it changes no enforcement — it only stops the startup warning.
        if (broken.code === "write-rule-never-matched") {
          const { body } = parseRule(rule);
          const covered = existing.includes(`Edit(${body})`) || templateRules.has(`Edit(${body})`);
          if (covered) {
            changes.push({
              action: "remove",
              list,
              rule,
              why: `never matched by file permission checks; \`Edit(${body})\` already covers the Write tool. Enforcement unchanged — this only stops the session-start warning.`,
            });
            continue;
          }
          warnings.push({
            list,
            rule,
            why: `enforces nothing (Write(<path>) is never matched), and no \`Edit(${body})\` exists to replace it. Add that rule, then remove this one.`,
          });
          keep.push(rule);
          continue;
        }

        // A rule that matches nothing AND whose corrected spelling the template ships:
        // the union below re-adds the working form, so dropping this one is safe.
        const corrected = correctedSpelling(rule, broken.code);
        if (corrected && templateRules.has(corrected)) {
          changes.push({
            action: "remove",
            list,
            rule,
            why: `matches nothing (${broken.code}); the template's \`${corrected}\` replaces it and is being added below.`,
          });
          continue;
        }
        warnings.push({ list, rule, why: `${broken.message} Kept — correcting it changes what it matches, which is your call.` });
        keep.push(rule);
        continue;
      }
      keep.push(rule);
    }

    // --- Additions: union in what the template ships and this file lacks ----------------
    const present = new Set(keep);
    for (const rule of templateList) {
      if (present.has(rule)) continue;
      keep.push(rule);
      present.add(rule);
      changes.push({ action: "add", list, rule, why: "shipped by the current template and absent here" });
    }

    if (keep.length || Array.isArray(next.permissions[list])) next.permissions[list] = keep;
  }

  return { settings: next, changes, warnings, changed: changes.length > 0 };
}

/** The working spelling of a rule that matches nothing, or null when it is not mechanical. */
function correctedSpelling(rule, code) {
  const { tool, body } = parseRule(rule);
  if (tool !== "Bash" || body === null) return null;
  if (code === "colon-star-after-glob") return `Bash(${body.slice(0, -2)}*)`; // `…add:*` → `…add*`
  if (code === "space-star-no-exact-sibling") return `Bash(${body.slice(0, -2)})`; // the exact-match sibling
  return null;
}
