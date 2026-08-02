#!/usr/bin/env node
// The shipped project template must be valid on its own terms.
//
// `/aidlc:init` copies templates/project/ into a user's repo verbatim, and init's own
// Step 1 forbids reconstructing it from memory precisely because these files ARE the
// reviewed originals. So a template that does not parse, or whose values contradict
// the schema the README calls "the full schema", ships a broken project to every new
// adopter — and the symptom appears in their repo, not here.
//
// This is a targeted validator, not a JSON Schema implementation: it walks the schema
// for `enum`, `type` and `required` and checks the template against those. Keeping it
// dependency-free is deliberate — the plugins ship executable hooks, and a check that
// pulls a validator off npm adds a supply chain to the one repo that argues hardest
// against unvetted dependencies.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport } from "./lib/report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = createReport("templates");
const rel = (p) => p.slice(resolve(ROOT).length + 1).replace(/\\/g, "/");

// --- 1. Every shipped JSON parses -------------------------------------------------
function walkJson(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkJson(p, out);
    else if (entry.endsWith(".json")) out.push(p);
  }
  return out;
}

const jsonFiles = [...walkJson(join(ROOT, "plugins")), ...walkJson(join(ROOT, "docs"))];
r.assert(jsonFiles.length > 0, "plugins/", "found no JSON to validate — discovery is broken");
for (const f of jsonFiles) {
  try {
    JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    r.error(rel(f), `does not parse: ${e.message}`);
  }
}

// --- 2. The config templates agree with the config schema -------------------------
const schemaPath = join(ROOT, "docs/aidlc.config.schema.json");
let schema = null;
try {
  schema = JSON.parse(readFileSync(schemaPath, "utf8"));
} catch (e) {
  r.error("docs/aidlc.config.schema.json", `does not parse: ${e.message}`);
}

const configs = [
  "plugins/aidlc-core/templates/project/.claude/aidlc.config.json",
  "plugins/aidlc-core/templates/project/.claude/aidlc.config.poly.example.json",
].filter((p) => existsSync(join(ROOT, p)));
r.assert(configs.length > 0, "templates/project/.claude/", "no aidlc.config template found");

const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
const typeOk = (v, t) => {
  const types = Array.isArray(t) ? t : [t];
  const actual = typeOf(v);
  return types.some((x) => x === actual || (x === "integer" && Number.isInteger(v)) || (x === "number" && actual === "number"));
};

// Walk value against schema node, reporting enum/type/required violations by path.
function validate(value, node, path, where) {
  if (!node || typeof node !== "object") return;
  // Placeholders ("{{PROJECT_KEY}}") are filled at scaffold time — never validated.
  if (typeof value === "string" && /\{\{.*\}\}/.test(value)) return;

  if (node.enum) {
    r.assert(
      node.enum.includes(value),
      where,
      `${path || "<root>"} = ${JSON.stringify(value)} is not one of the schema's values [${node.enum.map((x) => JSON.stringify(x)).join(", ")}]`,
    );
    return;
  }
  if (node.type && !typeOk(value, node.type)) {
    r.assert(false, where, `${path || "<root>"} is ${typeOf(value)}, schema says ${JSON.stringify(node.type)}`);
    return;
  }
  if (node.type === "object" || node.properties) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;
    for (const req of node.required ?? []) {
      r.assert(req in value, where, `${path ? path + "." : ""}${req} is required by the schema but absent`);
    }
    for (const [k, v] of Object.entries(value)) {
      const child = node.properties?.[k];
      if (child) validate(v, child, path ? `${path}.${k}` : k, where);
    }
  }
  if ((node.type === "array" || node.items) && Array.isArray(value) && node.items) {
    value.forEach((v, i) => validate(v, node.items, `${path}[${i}]`, where));
  }
}

for (const c of configs) {
  const where = c;
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(join(ROOT, c), "utf8"));
  } catch {
    continue; // already reported above
  }
  if (schema) validate(cfg, schema, "", where);

  // The template must point at the schema it is validated against, or an editor
  // gives the user completions for a different contract than the one that binds.
  r.assert(
    cfg.$schema === schema?.$id,
    where,
    `$schema is ${JSON.stringify(cfg.$schema)} but the schema's own $id is ${JSON.stringify(schema?.$id)}`,
  );

  // Every key the template ships should be DESCRIBED by the schema. additionalProperties
  // is true by design (additive keys must not bump configVersion), so an undeclared key
  // validates silently — which is how a whole feature's config can ship with no
  // completion, no enum checking and no documentation.
  for (const k of Object.keys(cfg)) {
    if (k.startsWith("$")) continue;
    if (!schema?.properties?.[k]) r.warn(where, `top-level key \`${k}\` is not described in aidlc.config.schema.json`);
  }
}

// --- 3. The run-file template and run-state skill declare the same fields ---------
// run-state's Format block says so itself: "If you add a field to one, add it to the
// other — a field that exists in only one place is a field something reads and
// nothing writes."
const runTemplate = join(ROOT, "plugins/aidlc-core/templates/run-file.md");
const runState = join(ROOT, "plugins/aidlc-core/skills/run-state/SKILL.md");
if (existsSync(runTemplate) && existsSync(runState)) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(runTemplate, "utf8"));
  if (r.assert(fm, "templates/run-file.md", "has no frontmatter block")) {
    const fields = [...fm[1].matchAll(/^(\w[\w-]*):/gm)].map((m) => m[1]);
    const doc = readFileSync(runState, "utf8");
    for (const f of fields) {
      r.assert(
        new RegExp(`^${f}:`, "m").test(doc),
        "skills/run-state/SKILL.md",
        `run-file.md declares \`${f}:\` but run-state's Format block never documents it`,
      );
    }
  }
}

r.finish();
