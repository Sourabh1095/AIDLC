#!/usr/bin/env node
// Where each pull request the pipeline opened stands, and what to run next.
//
//   node pr-state.mjs <workspace-root> [--json]
//
// A run file says `done` the moment its PR opens, and nothing in it changes when a reviewer asks for
// changes, a check fails or the PR merges. So the most actionable fact about finished work, "it is
// waiting on you", was invisible until someone went and looked. This asks the host, read-only:
//   GitHub        `gh pr view` (state, review decision, checks) + one GraphQL read of review threads
//   Azure Repos   `az repos pr show` (status, votes) + the threads REST read
// and says the next command for each: /aidlc:review-feedback, /aidlc:run (devops diagnoses a red check),
// or /aidlc:status to clean up after a merge.
//
// The queries are the ones aidlc:review-feedback uses. It never writes to a PR. A host CLI that is
// missing or signed out is reported per PR as `error`, never as a state it did not read.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { frontmatter, runDirs } from "../../hooks/scripts/lib/run-files.mjs";
import { isMain } from "../../hooks/scripts/lib/cli.mjs";

const THREADS_QUERY =
  "query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){totalCount nodes{isResolved}}}}}";

// What a PR link points at, or null for anything that is not a remote PR (a local merge, a blank).
export function parsePr(url) {
  const s = String(url ?? "");
  let m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(s);
  if (m) return { host: "github", owner: m[1], repo: m[2], number: Number(m[3]), url: s };
  m = /^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i.exec(s);
  if (m) return { host: "azure-repos", org: `https://dev.azure.com/${m[1]}`, project: decodeURIComponent(m[2]), repo: decodeURIComponent(m[3]), number: Number(m[4]), url: s };
  m = /^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/i.exec(s);
  if (m) return { host: "azure-repos", org: `https://dev.azure.com/${m[1]}`, project: decodeURIComponent(m[2]), repo: decodeURIComponent(m[3]), number: Number(m[4]), url: s };
  return null;
}

// Every run that has a remote PR and whose work is finished from the pipeline's side: those are the
// ones a reviewer, a check or a merge moves next. Live and archived run files alike.
export function prRuns(root) {
  const out = new Map();
  for (const dir of runDirs(resolve(root)))
    for (const d of [dir, join(dir, "archive")]) {
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".md"))) {
        const fm = frontmatter(join(d, f));
        const pr = fm && parsePr(fm.pr);
        if (!fm?.item || !pr || fm.phase === "abandoned") continue;
        out.set(fm.item, { item: fm.item, phase: fm.phase, repo: fm.repo && fm.repo !== "null" ? fm.repo : null, pr, live: d === dir });
      }
    }
  return [...out.values()];
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const RUNNING = new Set(["IN_PROGRESS", "QUEUED", "PENDING", "EXPECTED", "WAITING", "REQUESTED"]);

// gh's statusCheckRollup → "failing" | "pending" | "passing" | "none".
export function checksOf(rollup) {
  const list = Array.isArray(rollup) ? rollup : [];
  if (!list.length) return "none";
  const states = list.map((c) => String(c.conclusion || c.state || c.status || "").toUpperCase());
  if (states.some((s) => FAILED.has(s))) return "failing";
  if (states.some((s) => RUNNING.has(s) || s === "")) return "pending";
  return "passing";
}

// What to run next, from what the host said. null: it is waiting on someone else.
export function nextStep(item, s) {
  if (s.error) return null;
  if (s.state === "merged") return `merged → /aidlc:status to clean up`;
  if (s.state === "closed") return `closed without merging → /aidlc:status to close the run`;
  if (s.review === "changes_requested" || s.review === "waiting_for_author" || s.unresolved > 0)
    return `${s.unresolved > 0 ? `${s.unresolved} unresolved review thread${s.unresolved === 1 ? "" : "s"}` : "changes requested"} → /aidlc:review-feedback ${item}`;
  if (s.checks === "failing") return `checks failing → /aidlc:run ${item}`;
  return null;
}

function defaultRun(argv) {
  // az is a .cmd on Windows, which only a shell starts; gh is a real executable everywhere.
  const viaShell = process.platform === "win32" && argv[0] === "az";
  const args = viaShell ? argv.slice(1).map((a) => (/[\s"&|<>^(){}]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : argv.slice(1);
  const r = spawnSync(argv[0], args, { encoding: "utf8", shell: viaShell, timeout: 30000, windowsHide: true });
  return { status: r.error ? -1 : r.status, stdout: r.stdout ?? "", stderr: `${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
}

const json = (r) => {
  try {
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  } catch {
    return null;
  }
};
const why = (r, cli) => (/not found|ENOENT|is not recognized/i.test(r.stderr) ? `${cli} not installed` : /auth|login|logged in|credential/i.test(r.stderr) ? `${cli} not signed in` : `${cli} failed`);

export function githubState(pr, run = defaultRun) {
  const view = run(["gh", "pr", "view", pr.url, "--json", "state,reviewDecision,statusCheckRollup,isDraft"]);
  const v = json(view);
  if (!v) return { error: why(view, "gh") };
  const threads = json(run(["gh", "api", "graphql", "-f", `query=${THREADS_QUERY}`, "-F", `owner=${pr.owner}`, "-F", `repo=${pr.repo}`, "-F", `pr=${pr.number}`]));
  const nodes = threads?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  return {
    state: String(v.state ?? "").toLowerCase() || "unknown",
    draft: !!v.isDraft,
    review: v.reviewDecision ? String(v.reviewDecision).toLowerCase() : "none",
    unresolved: Array.isArray(nodes) ? nodes.filter((n) => n && n.isResolved === false).length : 0,
    checks: checksOf(v.statusCheckRollup),
  };
}

export function azureState(pr, run = defaultRun) {
  const show = run(["az", "repos", "pr", "show", "--id", String(pr.number), "--org", pr.org, "-o", "json"]);
  const v = json(show);
  if (!v) return { error: why(show, "az") };
  const votes = (v.reviewers ?? []).map((r) => r.vote);
  const threads = json(
    run(["az", "rest", "--method", "GET", "--resource", "499b84ac-1321-427f-aa17-267ca6975798", "--url", `${pr.org}/${encodeURIComponent(pr.project)}/_apis/git/repositories/${encodeURIComponent(pr.repo)}/pullRequests/${pr.number}/threads?api-version=7.1`]),
  );
  // Active human threads only: ADO logs pushes, votes and policy events as threads too.
  const unresolved = (threads?.value ?? []).filter((t) => (t.status === "active" || t.status === "pending") && !t.properties?.CodeReviewThreadType).length;
  return {
    state: v.status === "completed" ? "merged" : v.status === "abandoned" ? "closed" : v.status === "active" ? "open" : "unknown",
    draft: !!v.isDraft,
    review: votes.includes(-10) ? "changes_requested" : votes.includes(-5) ? "waiting_for_author" : votes.some((x) => x >= 5) ? "approved" : "review_required",
    unresolved,
    checks: "none", // branch policies are read by /aidlc:status; a PR page shows them
  };
}

// A merged or closed PR cannot change again, so it is asked about once and remembered in a git-ignored
// cache. Without it, every PR the project ever opened (archived run files keep their link) would be
// asked about on every look, forever.
const cachePath = (root) => join(resolve(root), ".aidlc", "logs", "pr-state.json");
function readCache(root) {
  try {
    return JSON.parse(readFileSync(cachePath(root), "utf8"));
  } catch {
    return {};
  }
}

export function prStates(root, run = defaultRun, { cache = true } = {}) {
  const known = cache ? readCache(root) : {};
  let learned = false;
  const states = prRuns(root).map((r) => {
    const seen = known[r.pr.url];
    const s = seen ? { state: seen.state, draft: false, review: "none", unresolved: 0, checks: "none" } : r.pr.host === "github" ? githubState(r.pr, run) : azureState(r.pr, run);
    if (!seen && (s.state === "merged" || s.state === "closed")) {
      known[r.pr.url] = { state: s.state, item: r.item };
      learned = true;
    }
    // A settled PR whose run file is still live (not archived) has cleanup waiting: keep saying so until it is done.
    return { item: r.item, repo: r.repo, phase: r.phase, pr: r.pr.url, number: r.pr.number, host: r.pr.host, ...s, next: seen && !r.live ? null : nextStep(r.item, s) };
  });
  if (cache && learned) {
    try {
      mkdirSync(join(resolve(root), ".aidlc", "logs"), { recursive: true });
      writeFileSync(cachePath(root), `${JSON.stringify(known, null, 2)}\n`);
    } catch {
      // a cache that cannot be written costs a re-ask next time, nothing more
    }
  }
  // Settled PRs are history once their run is archived: reported on the look that learned it, then left out.
  return states.filter((s) => !known[s.pr] || s.next);
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const root = argv.find((a) => !a.startsWith("--")) ?? process.cwd();
  const states = prStates(root);
  if (argv.includes("--json")) console.log(JSON.stringify(states));
  else if (!states.length) console.log("No open pull requests from the pipeline.");
  else for (const s of states) console.log(`${s.item} PR #${s.number}: ${s.error ?? `${s.state}${s.draft ? " (draft)" : ""} · review ${s.review} · ${s.unresolved} unresolved · checks ${s.checks}`}${s.next ? ` → ${s.next.split(" → ")[1] ?? s.next}` : ""}`);
}
