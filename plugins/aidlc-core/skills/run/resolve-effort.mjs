#!/usr/bin/env node
// Reasoning effort for one agent dispatch — the second dial beside the model tier.
//
//   node resolve-effort.mjs <aidlc.config.json> <agent> [--size S|M|L|XL] [--type story|bug|task|spike|epic]
//                           [--risk auth,tenant,contract,migration,security] [--phase <phase>] [--fix-cycle N]
//   node resolve-effort.mjs <aidlc.config.json> --table [--size …] [--type …] [--risk …]
//
// Prints the level and why. The orchestrator passes the level as the Agent tool's `effort` for that
// dispatch (it overrides the agent's own `effort:` frontmatter) and records it on the run file's Log.
//
// WHY. Each agent's model tier is fixed by its role, and that was the only cost control: a typo-sized
// implementer task and a cross-tenant schema change got the same thinking budget, and so did a
// docwriter touching a README and a security review of an auth path. Effort is the knob that scales
// thinking — and its tokens — to the work in front of the agent. Most dispatches should spend LESS than
// the model default; the few that touch what cannot be fixed by noticing later should spend more.
//
// WHY A SCRIPT. The rule has five inputs and a config, and an orchestrator choosing "about right" per
// dispatch will drift run to run. Deterministic, logged, and the same answer for the same item.
//
// Order of application: role baseline → size → risk → retry → budget shift → per-agent override → cap.
// Claude Code then applies its own: a level above the model's maximum is clamped, a `maxEffortLevel`
// setting caps it again, and CLAUDE_CODE_EFFORT_LEVEL overrides everything (doctor warns when set).
import { readFileSync } from "node:fs";
import { isMain as isEntry } from "../../hooks/scripts/lib/cli.mjs";

export const LEVELS = ["low", "medium", "high", "xhigh", "max"];
const idx = (l) => LEVELS.indexOf(l);
const at = (i) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];

// The role baseline — what a typical, medium-sized, low-risk dispatch of each agent needs. These are
// also each agent's `effort:` frontmatter, so a dispatch from outside /aidlc:run (groom → analyst, the
// design pod → its agents) gets the same answer without this script.
export const BASELINE = {
  "aidlc-analyst": "medium",
  "aidlc-architect": "high",
  "aidlc-implementer": "medium",
  "aidlc-reviewer": "medium",
  "aidlc-qa": "medium",
  "aidlc-security": "high",
  "aidlc-devops": "medium",
  "aidlc-docwriter": "low",
  "aidlc-researcher": "high",
  "aidlc-ux-writer": "medium",
  "aidlc-ux-researcher": "medium",
  "aidlc-design-system": "medium",
  "aidlc-motion": "medium",
  "aidlc-figma": "low",
  "aidlc-fidelity": "high",
  "aidlc-ux-jury": "high",
};

// Agents whose judgement is the safety net on risky diffs, and so think harder when the diff is risky.
const RISK_SENSITIVE = new Set(["aidlc-architect", "aidlc-implementer", "aidlc-reviewer", "aidlc-security", "aidlc-qa"]);
// Agents whose work grows with the size of the item (the rest do a fixed-shape job).
const SIZE_SENSITIVE = new Set(["aidlc-architect", "aidlc-implementer", "aidlc-reviewer", "aidlc-analyst"]);

const BUDGET_SHIFT = { economy: -1, balanced: 0, quality: 1 };

export function effortSettings(config) {
  const e = config?.pipeline?.effort ?? {};
  return {
    budget: Object.prototype.hasOwnProperty.call(BUDGET_SHIFT, e.budget) ? e.budget : "balanced",
    max: LEVELS.includes(e.max) ? e.max : "xhigh",
    overrides: e.overrides && typeof e.overrides === "object" ? e.overrides : {},
    escalateOnRetry: e.escalateOnRetry !== false,
    headless: LEVELS.includes(e.headless) ? e.headless : "medium",
  };
}

/**
 * @param {{agent: string, size?: string, type?: string, risks?: string[], phase?: string, fixCycle?: number}} ctx
 * @returns {{level: string, reasons: string[]}}
 */
export function resolveEffort(ctx, config) {
  const s = effortSettings(config);
  const agent = String(ctx.agent || "");
  const reasons = [];
  // A project-local agent (aidlc:scaffold-agent) is not in the shipped roster: its own frontmatter is
  // its baseline, and this script cannot see it — so it answers "no level", the orchestrator omits
  // `effort`, and the agent's declared value applies. An explicit override still wins, capped.
  if (!BASELINE[agent]) {
    const o = s.overrides[agent];
    if (!LEVELS.includes(o)) return { level: null, reasons: [`${agent} is not a shipped agent — its own effort: frontmatter applies`] };
    return { level: at(Math.min(idx(o), idx(s.max))), reasons: [`override ${o}`, ...(idx(o) > idx(s.max) ? [`capped at ${s.max}`] : [])] };
  }
  let i = idx(BASELINE[agent]);
  reasons.push(`${agent} baseline ${at(i)}`);

  const size = String(ctx.size || "").toUpperCase();
  if (SIZE_SENSITIVE.has(agent)) {
    if (size === "S" && i > 0) {
      i--;
      reasons.push("small item −1");
    } else if (size === "L" || size === "XL") {
      i++;
      reasons.push(`size ${size} +1`);
    }
  }

  const risks = (ctx.risks ?? []).filter(Boolean);
  if (risks.length && RISK_SENSITIVE.has(agent)) {
    i++;
    reasons.push(`risk (${risks.join(", ")}) +1`);
  }
  if (agent === "aidlc-analyst" && ctx.type === "epic") {
    i++;
    reasons.push("epic decomposition +1");
  }
  if (agent === "aidlc-qa" && ctx.type === "bug" && ctx.phase === "implement") {
    reasons.push("bug repro test (no change)");
  }

  // A second fix cycle means the first attempt at this finding did not hold: the problem is harder than
  // it looked. One step up, once — this is not a retry loop, and it never touches the model tier (the
  // orchestrator's invariant against escalating a model to work around a failure still stands).
  if (s.escalateOnRetry && agent === "aidlc-implementer" && Number(ctx.fixCycle) >= 2) {
    i++;
    reasons.push(`fix cycle ${ctx.fixCycle} +1`);
  }

  if (BUDGET_SHIFT[s.budget]) {
    i += BUDGET_SHIFT[s.budget];
    reasons.push(`budget ${s.budget} ${BUDGET_SHIFT[s.budget] > 0 ? "+1" : "−1"}`);
  }

  if (LEVELS.includes(s.overrides[agent])) {
    i = idx(s.overrides[agent]);
    reasons.push(`override ${s.overrides[agent]}`);
  }

  if (i > idx(s.max)) {
    i = idx(s.max);
    reasons.push(`capped at ${s.max}`);
  }
  return { level: at(i), reasons };
}

// The whole roster for one item — what the plan checkpoint shows.
export function effortTable(ctx, config, agents = Object.keys(BASELINE).filter((a) => !a.startsWith("aidlc-ux") && !["aidlc-design-system", "aidlc-motion", "aidlc-figma", "aidlc-fidelity"].includes(a))) {
  return agents.map((agent) => ({ agent, ...resolveEffort({ ...ctx, agent }, config) }));
}

function parse(argv) {
  const out = { flags: {}, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out.flags[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else out.pos.push(argv[i]);
  }
  return out;
}

if (isEntry(import.meta.url)) {
  const { flags, pos } = parse(process.argv.slice(2));
  const [cfgPath, agent] = pos;
  if (!cfgPath || (!agent && !flags.table)) {
    console.error("usage: node resolve-effort.mjs <aidlc.config.json> <agent> [--size S|M|L|XL] [--type …] [--risk a,b] [--phase …] [--fix-cycle N]\n       node resolve-effort.mjs <aidlc.config.json> --table [--size …] [--type …] [--risk …]");
    process.exit(2);
  }
  let config = {};
  try {
    config = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {
    /* no config → defaults */
  }
  const ctx = {
    size: flags.size,
    type: flags.type,
    risks: typeof flags.risk === "string" ? flags.risk.split(",") : [],
    phase: flags.phase,
    fixCycle: Number(flags["fix-cycle"]) || 0,
  };
  if (flags.table) {
    for (const r of effortTable(ctx, config)) console.log(`${r.agent.padEnd(20)} ${r.level.padEnd(7)} ${r.reasons.slice(1).join(" · ") || "baseline"}`);
  } else {
    const r = resolveEffort({ ...ctx, agent }, config);
    console.log(`effort: ${r.level ?? "(omit — the agent's own default)"}   (${r.reasons.join(" · ")})`);
  }
}
