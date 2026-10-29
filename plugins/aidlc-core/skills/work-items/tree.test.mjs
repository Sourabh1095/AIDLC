// Tests for tree.mjs — the board as epics and their children, from each source.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";
import { buildTree, canonicalStatus, kindOf, tree } from "./tree.mjs";

const tmps = [];
const ws = (files) => {
  const root = mkdtempSync(join(tmpdir(), "tree-"));
  tmps.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof text === "string" ? text : JSON.stringify(text));
  }
  return root;
};
const item = (fm) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;

// ---- kinds and statuses
check("tracker types become the tree's kinds", ["Epic", "Feature", "User Story", "Product Backlog Item", "Task", "Bug", "Spike"].map(kindOf), ["epic", "feature", "story", "story", "task", "bug", "spike"]);
const map = { "User Story": { in_progress: "In Development", in_review: "Code Review", done: "Closed" }, Bug: { in_progress: "In Progress (fix)" } };
check(
  "a per-type statusMap is read backwards",
  ["In Development", "Code Review", "Closed"].map((s) => canonicalStatus("User Story", s, { statusMap: map })),
  ["in_progress", "in_review", "done"],
);
check("…for each type", canonicalStatus("Bug", "In Progress (fix)", { statusMap: map }), "in_progress");
check("common names without a map", ["New", "Active", "Resolved", "Done", "To Do"].map((s) => canonicalStatus("Task", s)), ["todo", "in_progress", "in_review", "done", "todo"]);
check("a blocked tag wins", canonicalStatus("Task", "Active", { tags: "phase-0; blocked" }), "blocked");

// ---- the tree
{
  const t = buildTree(
    [
      { id: "E1", type: "epic", title: "Bookings", status: "in_progress", parent: null },
      { id: "S1", type: "story", title: "Approve", status: "done", parent: "E1" },
      { id: "S2", type: "story", title: "Reject", status: "in_progress", parent: "E1" },
      { id: "T1", type: "task", title: "API", status: "done", parent: "S2" },
      { id: "B1", type: "bug", title: "Reason lost", status: "todo", parent: "S2" },
      { id: "E2", type: "epic", title: "Old", status: "done", parent: null },
      { id: "S3", type: "story", title: "Old story", status: "done", parent: "E2" },
      { id: "B2", type: "bug", title: "Login loop", status: "todo", parent: null },
      { id: "B3", type: "bug", title: "Fixed long ago", status: "done", parent: null },
      { id: "S9", type: "story", title: "Lost child", status: "todo", parent: "GONE" },
    ],
    { S2: "implement" },
  );
  const e1 = t.roots.find((r) => r.id === "E1");
  check("an epic carries its children (moving work first), tasks and bugs under their story", e1.children.map((c) => [c.id, c.children.map((k) => k.id)]), [["S2", ["T1", "B1"]], ["S1", []]]);
  check("…counts what is done below it, and its open bugs", e1.counts, { total: 4, done: 2, openBugs: 1 });
  check("…and shows the run working on an item", e1.children.find((c) => c.id === "S2").run, "implement");
  check("a finished epic is left out and counted", [t.roots.some((r) => r.id === "E2"), t.hiddenDone], [false, 1]);
  check("open items under no epic are listed apart; finished ones are not", t.loose.map((l) => l.id), ["S9", "B2"]);
}

// ---- sources
{
  const root = ws({
    ".claude/aidlc.config.json": { workItems: { source: "markdown" } },
    "backlog/epics/P-1-bookings.md": item({ id: "P-1", type: "epic", title: "Bookings", status: "in_progress", parent: "null" }),
    "backlog/items/P-2-approve.md": item({ id: "P-2", type: "story", title: "Approve", status: "todo", parent: "P-1" }),
    "backlog/items/P-3-bug.md": item({ id: "P-3", type: "bug", title: "Double submit", status: "in_progress", parent: "P-2" }),
  });
  const t = await tree(root);
  check("markdown: read live", [t.source, t.roots[0].id, t.roots[0].children[0].children[0].id], ["markdown", "P-1", "P-3"]);
}
{
  const root = ws({ ".claude/aidlc.config.json": { workItems: { source: "ado", ado: { org: "acme", project: "Web App", statusMap: { Task: { done: "Closed" } } } } } });
  const calls = [];
  const run = (argv) => {
    calls.push(argv.join(" "));
    return argv[1] === "account" ? { status: 0, stdout: "SECRET-TOKEN-123\n", stderr: "" } : { status: 1, stdout: "", stderr: "x" };
  };
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (url.includes("/wiql")) return { ok: true, json: async () => ({ workItems: [{ id: 10 }, { id: 11 }] }) };
    return {
      ok: true,
      json: async () => ({
        value: [
          { id: 10, fields: { "System.WorkItemType": "Epic", "System.Title": "Checkout → payments", "System.State": "Active" } },
          { id: 11, fields: { "System.WorkItemType": "Task", "System.Title": "Wire it", "System.State": "Closed", "System.Parent": 10 } },
        ],
      }),
    };
  };
  const t = await tree(root, { run, fetchImpl });
  check("ado: through the REST API with the az sign-in", [t.source, bodies[0].auth, bodies[0].url], ["ado", "Bearer SECRET-TOKEN-123", "https://dev.azure.com/acme/Web%20App/_apis/wit/wiql?api-version=7.1"]);
  check("…filtered to the project by name, not @project", /\[System\.TeamProject\] = 'Web App'/.test(bodies[0].body.query), true);
  check("…titles keep every character, statuses mapped", [t.roots[0].title, t.roots[0].status, t.roots[0].children[0].status], ["Checkout → payments", "in_progress", "done"]);
  check("…and the token is never written anywhere", calls.some((c) => c.includes("SECRET-TOKEN-123")), false);

  const signedOut = () => ({ status: 1, stdout: "", stderr: "Please run 'az login' to setup account." });
  const none = await tree(root, { run: signedOut, fetchImpl: null });
  check("az signed out and no snapshot: says why", none.error, "az not signed in (az login)");

  mkdirSync(join(root, ".aidlc", "logs"), { recursive: true });
  writeFileSync(join(root, ".aidlc", "logs", "board.json"), JSON.stringify({ at: "2026-10-30T09:00:00Z", items: [{ id: 10, type: "Epic", title: "Saved", status: "todo" }] }));
  const snap = await tree(root, { run: signedOut, fetchImpl: null });
  check("…with a snapshot: the snapshot, dated, and why", [snap.source, snap.at, snap.roots[0].title, snap.note], ["snapshot", "2026-10-30T09:00:00Z", "Saved", "az not signed in (az login)"]);
}
{
  const root = ws({ ".claude/aidlc.config.json": { workItems: { source: "jira" } } });
  check("jira with no snapshot says where one comes from", /\/aidlc:status writes/.test((await tree(root)).error), true);
}

for (const t of tmps) rmSync(t, { recursive: true, force: true });
done();
