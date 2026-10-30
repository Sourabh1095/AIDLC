#!/usr/bin/env node
// The board as a tree: each epic with everything under it, bugs included, and where each item stands.
// Read-only. The aidlc-cockpit board draws it; anything else may print it.
//
//   node tree.mjs <workspace> [--json]
//
// Where the items come from:
//   markdown  backlog/epics/ and backlog/items/, read live
//   ado       the board itself, signed in as the az CLI is: one WIQL query and batch reads over the REST
//             API, so titles keep every character (`az boards query` drops what the Windows console
//             code page cannot print, and is the fallback when no token can be had)
//   any       .aidlc/logs/board.json, the snapshot /aidlc:status writes, when the board cannot be read
//             from here (Jira, or az not signed in)
//
// Statuses are the canonical five (`aidlc:work-items`): todo, in_progress, in_review, done, blocked.
// Never throws: a board that cannot be read comes back as `{ error }`, not as an empty board.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isMain, tryJson } from "../../hooks/scripts/lib/cli.mjs";
import { frontmatter, readRuns, TERMINAL } from "../../hooks/scripts/lib/run-files.mjs";

const CANON = ["todo", "in_progress", "in_review", "done", "blocked"];
// Shown first: what needs a person, then what is moving, then what has not started, then what is over.
const STATUS_RANK = { blocked: 0, in_review: 1, in_progress: 2, todo: 3, done: 4 };
const TYPE_RANK = { epic: 0, feature: 1, story: 2, spike: 3, task: 4, bug: 5, other: 6 };
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"; // Azure DevOps, for `az account get-access-token`
const ADO_FIELDS = ["System.Id", "System.WorkItemType", "System.Title", "System.State", "System.Parent", "System.Tags"];
const MAX_ITEMS = 3000;

// A tracker's type name as one of the tree's kinds.
export function kindOf(raw) {
  const t = String(raw ?? "").toLowerCase();
  if (t === "epic") return "epic";
  if (t === "feature") return "feature";
  if (/bug|defect/.test(t)) return "bug";
  if (/spike/.test(t)) return "spike";
  if (/task/.test(t)) return "task";
  if (/story|backlog item|requirement|issue/.test(t)) return "story";
  return "other";
}

// A tracker's state as a canonical status: the project's own statusMap first (flat or per type), then
// the names trackers commonly use. A `blocked` tag wins, the way the adapters mark it.
export function canonicalStatus(type, state, { tags = "", statusMap = null } = {}) {
  if (/(^|[;,]\s*)blocked(\s*[;,]|\s*$)/i.test(String(tags))) return "blocked";
  const s = String(state ?? "").trim().toLowerCase();
  if (CANON.includes(s)) return s;
  for (const m of [statusMap?.[type], statusMap]) {
    if (!m || typeof m !== "object") continue;
    for (const [canon, name] of Object.entries(m)) if (CANON.includes(canon) && typeof name === "string" && name.toLowerCase() === s) return canon;
  }
  if (/^(closed|done|completed|complete|finished|released)$/.test(s)) return "done";
  if (/block|on hold|impeded/.test(s)) return "blocked";
  if (/review|resolved|testing|test|qa|verif|validat/.test(s)) return "in_review";
  if (/^(new|to ?do|proposed|approved|open|backlog|ready|not started|selected for development)$/.test(s)) return "todo";
  return "in_progress";
}

// --- Sources -------------------------------------------------------------------------------------------

// Is an item assigned to the person at this machine? `me` is `team.me` (an email or a name); an
// assignee reads `Name <email>`, an email or a name. null: there is no telling.
export function isMine(assignee, me) {
  const a = String(assignee ?? "").trim().toLowerCase();
  const m = String(me ?? "").trim().toLowerCase();
  if (!a || a === "null" || !m) return null;
  const email = /<([^>]+)>/.exec(a)?.[1] ?? (a.includes("@") ? a : null);
  return email ? email === m || a.includes(m) : a === m || a.startsWith(`${m} <`);
}

function markdownItems(root, me) {
  const out = [];
  for (const dir of ["epics", "items"]) {
    let names = [];
    try {
      names = readdirSync(join(root, "backlog", dir)).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of names) {
      const fm = frontmatter(join(root, "backlog", dir, f));
      if (!fm?.id) continue;
      out.push({
        id: fm.id,
        type: kindOf(fm.type || (dir === "epics" ? "epic" : "story")),
        title: fm.title || f.replace(/\.md$/, ""),
        status: canonicalStatus(fm.type, fm.status),
        parent: fm.parent && fm.parent !== "null" ? fm.parent : null,
        // A solo backlog (no team.me) is all yours; in a shared one, what is assigned to you.
        mine: me ? isMine(fm.assignee, me) === true : true,
      });
    }
  }
  return out;
}

// The copy of the board /aidlc:status or the cockpit saved. Each item may say `mine`; else its
// assignee is compared with team.me.
function snapshotItems(root, { me = null, statusMap = null } = {}) {
  const snap = tryJson(join(root, ".aidlc", "logs", "board.json"));
  if (!Array.isArray(snap?.items)) return null;
  const items = snap.items
    .filter((i) => i && i.id != null)
    .map((i) => ({
      id: String(i.id),
      type: kindOf(i.type),
      title: String(i.title ?? i.id),
      status: canonicalStatus(i.type, i.status, { tags: i.tags ?? "", statusMap }),
      parent: i.parent != null && i.parent !== "null" ? String(i.parent) : null,
      mine: typeof i.mine === "boolean" ? i.mine : isMine(i.assignee, me),
    }));
  return { items, at: typeof snap.at === "string" ? snap.at : null, from: typeof snap.source === "string" ? snap.source : null };
}

// Where the Azure CLI lands on macOS and Linux. A process started from an editor or an app often has a
// shorter PATH than a login shell, so `az` installed by Homebrew can be missing from it.
const AZ_PATHS = ["/opt/homebrew/bin/az", "/usr/local/bin/az", "/usr/bin/az", "/home/linuxbrew/.linuxbrew/bin/az"];

// az is a .cmd on Windows, which only a shell starts.
function defaultRun(argv) {
  const once = (cmd) => {
    const viaShell = process.platform === "win32" && cmd === "az";
    const args = viaShell ? argv.slice(1).map((a) => (/[\s"&|<>^(){}'@]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : argv.slice(1);
    const r = spawnSync(cmd, args, { encoding: "utf8", shell: viaShell, timeout: 60000, windowsHide: true });
    return { status: r.error ? -1 : r.status, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
  };
  const r = once(argv[0]);
  if (argv[0] !== "az" || process.platform === "win32" || !/ENOENT|not found/i.test(r.stderr)) return r;
  const found = AZ_PATHS.find((p) => existsSync(p));
  return found ? once(found) : r;
}

const FIX = "Connect the Azure DevOps MCP server (the cockpit reads the board through it), install the Azure CLI and run `az login`, set AZURE_DEVOPS_EXT_PAT to a personal access token, or run /aidlc:status once to save a copy of the board here.";

const orgUrl = (org) => (/^https?:\/\//.test(org) ? org.replace(/\/+$/, "") : `https://dev.azure.com/${org}`);
// `@project` resolves to nothing through az, and without a project filter WIQL reads the whole org.
// `mine` adds `@Me`: what is assigned to whoever the token or the az sign-in belongs to.
const wiql = (project, { mine = false } = {}) =>
  `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${String(project).replace(/'/g, "''")}' AND [System.State] <> 'Removed'${mine ? " AND [System.AssignedTo] = @Me" : ""} ORDER BY [System.ChangedDate] DESC`;
// Marks each item as the signed-in person's or not, from the ids an `@Me` query returned; null when that
// query could not run, which leaves the board unfiltered rather than empty.
const markMine = (items, mineIds) => items.map((i) => ({ ...i, mine: mineIds ? mineIds.has(i.id) : null }));

const adoItem = (fields, statusMap) => {
  const type = fields["System.WorkItemType"];
  return {
    id: String(fields["System.Id"]),
    type: kindOf(type),
    title: String(fields["System.Title"] ?? fields["System.Id"]),
    status: canonicalStatus(type, fields["System.State"], { tags: fields["System.Tags"], statusMap }),
    parent: fields["System.Parent"] != null ? String(fields["System.Parent"]) : null,
  };
};

async function adoItems(ado, { run = defaultRun, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (!ado?.org || !ado?.project) return { error: "workItems.ado needs org and project" };
  const base = `${orgUrl(ado.org)}/${encodeURIComponent(ado.project)}/_apis/wit`;
  const rest = async (authorization) => {
    const post = async (url, body) => {
      const r = await fetchImpl(url, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    };
    const found = await post(`${base}/wiql?api-version=7.1`, { query: wiql(ado.project) });
    const ids = (found.workItems ?? []).map((w) => w.id).slice(0, MAX_ITEMS);
    const items = [];
    for (let i = 0; i < ids.length; i += 200) {
      const page = await post(`${base}/workitemsbatch?api-version=7.1`, { ids: ids.slice(i, i + 200), fields: ADO_FIELDS });
      for (const w of page.value ?? []) items.push(adoItem({ "System.Id": w.id, ...w.fields }, ado.statusMap));
    }
    let mineIds = null;
    try {
      mineIds = new Set(((await post(`${base}/wiql?api-version=7.1`, { query: wiql(ado.project, { mine: true }) })).workItems ?? []).map((w) => String(w.id)));
    } catch {
      // no telling whose is whose: the board is shown whole
    }
    return { items: markMine(items, mineIds), truncated: (found.workItems ?? []).length > MAX_ITEMS };
  };
  // A personal access token in AZURE_DEVOPS_EXT_PAT (the variable `az devops` itself reads) needs no CLI.
  const pat = String(env?.AZURE_DEVOPS_EXT_PAT ?? "").trim();
  if (pat && fetchImpl) {
    try {
      return await rest(`Basic ${Buffer.from(`:${pat}`).toString("base64")}`);
    } catch {
      // a token that is wrong or expired: try the az sign-in below
    }
  }
  const token = run(["az", "account", "get-access-token", "--resource", ADO_RESOURCE, "--query", "accessToken", "-o", "tsv"]);
  const bearer = token.status === 0 ? token.stdout.trim() : "";
  if (bearer && fetchImpl) {
    try {
      return await rest(`Bearer ${bearer}`);
    } catch {
      // the token or the REST call failed: try the CLI's own query below
    }
  }
  const q = run([
    "az", "boards", "query", "--org", orgUrl(ado.org), "--project", ado.project,
    "--wiql", wiql(ado.project).replace("SELECT [System.Id]", `SELECT ${ADO_FIELDS.map((f) => `[${f}]`).join(",")}`), "-o", "json",
  ]);
  if (q.status !== 0) {
    const why = /not found|ENOENT|is not recognized/i.test(q.stderr)
      ? "the Azure CLI (az) is not installed here"
      : /login|logged in|credential|auth/i.test(q.stderr)
        ? "az is not signed in"
        : /extension|boards/i.test(q.stderr)
          ? "az has no azure-devops extension (az extension add --name azure-devops)"
          : "az boards query failed";
    return { error: `Can't read the Azure DevOps board: ${why}. ${FIX}`, reason: why };
  }
  let rows;
  try {
    rows = JSON.parse(q.stdout);
  } catch {
    return { error: "az boards query printed something that is not JSON" };
  }
  const me = run(["az", "boards", "query", "--org", orgUrl(ado.org), "--project", ado.project, "--wiql", wiql(ado.project, { mine: true }), "-o", "json"]);
  let mineIds = null;
  try {
    if (me.status === 0) mineIds = new Set(JSON.parse(me.stdout).map((r) => String(r.id ?? r.fields?.["System.Id"])));
  } catch {
    // shown whole
  }
  return { items: markMine(rows.slice(0, MAX_ITEMS).map((r) => adoItem(r.fields ?? {}, ado.statusMap)), mineIds), truncated: rows.length > MAX_ITEMS };
}

// --- The tree ------------------------------------------------------------------------------------------

const byRank = (a, b) =>
  (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9) ||
  (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
  String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

// Items with parents → roots (an epic, or anything with children and no parent) and loose items (no
// parent, nothing under them: a bug nobody filed under an epic). A root whose whole subtree is done is
// left out and counted; so is a loose item that is done. `runs` maps an item to its run's phase.
export function buildTree(items, runs = {}) {
  const nodes = new Map();
  for (const i of items) nodes.set(String(i.id), { ...i, id: String(i.id), run: runs[i.id] ?? null, children: [] });
  const tops = [];
  for (const n of nodes.values()) {
    const p = n.parent && nodes.get(n.parent);
    if (p && p !== n) p.children.push(n);
    else tops.push(n);
  }
  const count = (n) => {
    n.children.sort(byRank);
    const c = { total: 0, done: 0, openBugs: 0 };
    for (const k of n.children) {
      const sub = count(k);
      c.total += 1 + sub.total;
      c.done += (k.status === "done" ? 1 : 0) + sub.done;
      c.openBugs += (k.type === "bug" && k.status !== "done" ? 1 : 0) + sub.openBugs;
    }
    n.counts = c;
    return c;
  };
  for (const t of tops) count(t);
  const allDone = (n) => n.status === "done" && n.counts.done === n.counts.total;
  const roots = tops.filter((n) => n.type === "epic" || n.children.length);
  const loose = tops.filter((n) => !(n.type === "epic" || n.children.length));
  return {
    roots: roots.filter((n) => !allDone(n)).sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || byRank(a, b)),
    loose: loose.filter((n) => n.status !== "done").sort(byRank),
    hiddenDone: roots.filter(allDone).length,
  };
}

export async function tree(ws, opts = {}) {
  const root = resolve(ws);
  const cfg = tryJson(join(root, ".claude", "aidlc.config.json"));
  if (!cfg) return { error: "no .claude/aidlc.config.json" };
  const source = cfg.workItems?.source ?? "markdown";
  const me = cfg.team?.me ?? null;
  const statusMap = cfg.workItems?.[source]?.statusMap ?? null;
  const runs = {};
  for (const r of readRuns(root, (x) => x.phase && !TERMINAL.has(x.phase))) runs[r.item] = r.phase;
  let got = null;
  let from = source;
  let at = null;
  let savedBy = null;
  if (source === "markdown") got = { items: markdownItems(root, me) };
  else if (source === "ado") got = await adoItems(cfg.workItems?.ado, opts);
  if (!got || got.error) {
    const snap = snapshotItems(root, { me, statusMap });
    if (snap) {
      const reason = got?.reason ?? got?.error ?? null;
      got = { items: snap.items, note: reason };
      from = "snapshot";
      at = snap.at;
      savedBy = snap.from;
    }
  }
  if (!got || got.error)
    return { source, error: got?.error ?? `A ${source} board is shown from a copy /aidlc:status saves (.aidlc/logs/board.json), and there is none yet: run /aidlc:status once.` };
  // Whether each item says whose it is: when none does, the board cannot be narrowed to yours.
  const mineKnown = got.items.some((i) => typeof i.mine === "boolean");
  return { source: from, tracker: source, at, savedBy, note: got.note ?? null, truncated: !!got.truncated, mineKnown, ...buildTree(got.items, runs) };
}

// --- CLI -----------------------------------------------------------------------------------------------

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const ws = argv.find((a) => !a.startsWith("--")) ?? ".";
  const t = await tree(ws);
  if (argv.includes("--json")) process.stdout.write(JSON.stringify(t) + "\n");
  else if (t.error) process.stdout.write(`board: ${t.error}\n`);
  else {
    const line = (n, pad) => {
      const c = n.counts.total ? ` · ${n.counts.done}/${n.counts.total} done${n.counts.openBugs ? ` · ${n.counts.openBugs} open bug(s)` : ""}` : "";
      process.stdout.write(`${pad}${n.id} ${n.type} · ${n.title} · ${n.status.replace("_", " ")}${n.run ? ` · run ${n.run}` : ""}${c}\n`);
      for (const k of n.children) line(k, pad + "  ");
    };
    for (const r of t.roots) line(r, "");
    if (t.loose.length) process.stdout.write("\nNot under an epic:\n");
    for (const l of t.loose) line(l, "  ");
    if (t.hiddenDone) process.stdout.write(`\n${t.hiddenDone} finished epic(s) not shown\n`);
  }
}
