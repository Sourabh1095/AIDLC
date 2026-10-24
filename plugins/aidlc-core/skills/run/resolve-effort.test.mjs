// Tests for resolve-effort.mjs. Run: `node resolve-effort.test.mjs`.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEffort, effortTable, effortSettings, BASELINE, LEVELS } from "./resolve-effort.mjs";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";

const lvl = (ctx, cfg = {}) => resolveEffort(ctx, cfg).level;

// ---- role baselines
check("docwriter is cheap", lvl({ agent: "aidlc-docwriter" }), "low");
check("security thinks hard by default", lvl({ agent: "aidlc-security" }), "high");
check("a project-local agent gets no level — its own frontmatter applies", lvl({ agent: "x-billing-expert" }), null);
check("…unless the config overrides it", lvl({ agent: "x-billing-expert" }, { pipeline: { effort: { overrides: { "x-billing-expert": "high" } } } }), "high");

// ---- size
check("implementer on a small item drops a level", lvl({ agent: "aidlc-implementer", size: "S" }), "low");
check("implementer on a medium item stays", lvl({ agent: "aidlc-implementer", size: "M" }), "medium");
check("implementer on a large item rises", lvl({ agent: "aidlc-implementer", size: "L" }), "high");
check("size does not move a fixed-shape job", lvl({ agent: "aidlc-docwriter", size: "L" }), "low");

// ---- risk
check("reviewer on an auth diff rises", lvl({ agent: "aidlc-reviewer", risks: ["auth"] }), "high");
check("security on a tenant diff rises to xhigh", lvl({ agent: "aidlc-security", risks: ["tenant"] }), "xhigh");
check("risk does not move the docwriter", lvl({ agent: "aidlc-docwriter", risks: ["auth"] }), "low");
check("architect on a large risky item: high +1 +1 → capped at xhigh", lvl({ agent: "aidlc-architect", size: "L", risks: ["migration"] }), "xhigh");

// ---- type and retry
check("analyst decomposing an epic rises", lvl({ agent: "aidlc-analyst", type: "epic" }), "high");
check("a second fix cycle raises the implementer once", lvl({ agent: "aidlc-implementer", size: "M", fixCycle: 2 }), "high");
check("the first fix cycle does not", lvl({ agent: "aidlc-implementer", size: "M", fixCycle: 1 }), "medium");
check("escalateOnRetry: false turns that off", lvl({ agent: "aidlc-implementer", size: "M", fixCycle: 3 }, { pipeline: { effort: { escalateOnRetry: false } } }), "medium");

// ---- budget, overrides, cap
const economy = { pipeline: { effort: { budget: "economy" } } };
check("economy budget lowers everything a step", lvl({ agent: "aidlc-security" }, economy), "medium");
check("economy never goes below low", lvl({ agent: "aidlc-docwriter" }, economy), "low");
check("quality budget raises a step", lvl({ agent: "aidlc-reviewer" }, { pipeline: { effort: { budget: "quality" } } }), "high");
check("a per-agent override wins over the policy", lvl({ agent: "aidlc-security", risks: ["auth"] }, { pipeline: { effort: { overrides: { "aidlc-security": "medium" } } } }), "medium");
check("max caps even an override", lvl({ agent: "aidlc-security" }, { pipeline: { effort: { max: "medium", overrides: { "aidlc-security": "max" } } } }), "medium");
check("default cap is xhigh — max is opt-in only", effortSettings({}).max, "xhigh");
check("bad config values fall back to defaults", effortSettings({ pipeline: { effort: { budget: "lavish", max: "ludicrous" } } }), { budget: "balanced", max: "xhigh", overrides: {}, escalateOnRetry: true, headless: "medium" });
check("reasons explain the answer", resolveEffort({ agent: "aidlc-implementer", size: "L", risks: ["auth"] }, {}).reasons, ["aidlc-implementer baseline medium", "size L +1", "risk (auth) +1"]);

// ---- the table the plan checkpoint shows
check("table covers the core roster", effortTable({ size: "M" }, {}).map((r) => r.agent).length, 9);

// ---- every shipped agent declares the baseline as its frontmatter default
const pluginsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
for (const plugin of ["aidlc-core", "aidlc-ux"]) {
  const dir = join(pluginsDir, plugin, "agents");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const name = f.replace(/\.md$/, "");
    const fm = readFileSync(join(dir, f), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
    const declared = fm.match(/^effort:\s*(\S+)/m)?.[1] ?? null;
    check(`${name}: frontmatter effort matches the baseline`, declared, BASELINE[name] ?? null);
    if (declared) check(`${name}: effort is a real level`, LEVELS.includes(declared), true);
  }
}

done();
