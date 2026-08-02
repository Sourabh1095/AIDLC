#!/usr/bin/env node
// Manifest consistency across the marketplace.
//
// Everything here is a fact that is duplicated in two places and drifts silently.
// A version mismatch between marketplace.json and a plugin.json is invisible until
// a user installs the wrong one; a hooks.json pointing at a script that was renamed
// disables that hook with no error at all — which, for the guard hooks, is the
// failure mode this whole repo is most careful about elsewhere.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReport } from "./lib/report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = createReport("manifests");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

// The repo's declared license, taken from LICENSE itself so there is one source.
const licenseId = /^([A-Za-z0-9.\-+]+) License/.exec(read("LICENSE").trim())?.[1] ?? null;
r.assert(licenseId, "LICENSE", "could not read an SPDX-ish id from the first line");

let marketplace;
try {
  marketplace = readJson(".claude-plugin/marketplace.json");
} catch (e) {
  r.error(".claude-plugin/marketplace.json", `does not parse: ${e.message}`);
  r.finish();
}

r.assert(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0, "marketplace.json", "plugins[] is empty");

for (const entry of marketplace.plugins ?? []) {
  const where = `marketplace.json → ${entry.name}`;
  const src = entry.source?.replace(/^\.\//, "");
  if (!r.assert(src && existsSync(join(ROOT, src)), where, `source '${entry.source}' does not exist`)) continue;

  const manifestPath = `${src}/.claude-plugin/plugin.json`;
  if (!r.assert(existsSync(join(ROOT, manifestPath)), where, `missing ${manifestPath}`)) continue;

  let plugin;
  try {
    plugin = readJson(manifestPath);
  } catch (e) {
    r.error(manifestPath, `does not parse: ${e.message}`);
    continue;
  }

  r.assert(plugin.name === entry.name, manifestPath, `name '${plugin.name}' !== marketplace entry '${entry.name}'`);
  r.assert(
    plugin.version === entry.version,
    manifestPath,
    `version '${plugin.version}' !== marketplace entry '${entry.version}' — bump both or neither`,
  );
  r.assert(
    /^\d+\.\d+\.\d+/.test(plugin.version ?? ""),
    manifestPath,
    `version '${plugin.version}' is not semver`,
  );
  r.assert(
    plugin.license === licenseId,
    manifestPath,
    `license '${plugin.license}' !== the repo's LICENSE ('${licenseId}'). The manifest is what install tooling reads.`,
  );

  // Declared MCP server file must exist and parse.
  if (plugin.mcpServers) {
    const mcp = join(src, plugin.mcpServers.replace(/^\.\//, ""));
    if (r.assert(existsSync(join(ROOT, mcp)), manifestPath, `mcpServers points at missing ${mcp}`)) {
      try {
        readJson(mcp);
      } catch (e) {
        r.error(mcp, `does not parse: ${e.message}`);
      }
    }
  }

  // Every hook command must reference a script that exists. A renamed script leaves
  // the hook registered and silently inert — no error, no enforcement.
  const hooksPath = `${src}/hooks/hooks.json`;
  if (existsSync(join(ROOT, hooksPath))) {
    let hooks;
    try {
      hooks = readJson(hooksPath);
    } catch (e) {
      r.error(hooksPath, `does not parse: ${e.message}`);
      continue;
    }
    const events = Object.entries(hooks.hooks ?? {});
    r.assert(events.length > 0, hooksPath, "declares no hook events");
    for (const [event, matchers] of events) {
      for (const m of matchers ?? []) {
        for (const h of m.hooks ?? []) {
          const refs = [...String(h.command ?? "").matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g)].map((x) => x[1]);
          r.assert(refs.length > 0, hooksPath, `${event} hook command references no \${CLAUDE_PLUGIN_ROOT} script`);
          for (const ref of refs) {
            const abs = join(ROOT, src, ref);
            r.assert(
              existsSync(abs) && statSync(abs).isFile(),
              hooksPath,
              `${event} references '${ref}', which does not exist — the hook is registered but inert`,
            );
          }
        }
      }
    }
  }

  // Skills and agents shipped by this plugin must carry the frontmatter that makes
  // them loadable at all. A SKILL.md with no `name:` is a skill Claude Code will not
  // register, and nothing else in the repo would say so.
  const agentDir = join(ROOT, src, "agents");
  const skillDir = join(ROOT, src, "skills");
  const docs = [
    ...(existsSync(agentDir)
      ? readdirSync(agentDir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => join(agentDir, f))
      : []),
    ...(existsSync(skillDir)
      ? readdirSync(skillDir)
          .map((d) => join(skillDir, d, "SKILL.md"))
          .filter(existsSync)
      : []),
  ];
  for (const f of docs) {
    const rel = f.slice(resolve(ROOT).length + 1).replace(/\\/g, "/");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(f, "utf8"));
    if (!r.assert(fm, rel, "has no YAML frontmatter block")) continue;
    r.assert(/^name:\s*\S/m.test(fm[1]), rel, "frontmatter has no `name:`");
    r.assert(/^description:\s*\S/m.test(fm[1]), rel, "frontmatter has no `description:`");
  }
}

r.finish();
