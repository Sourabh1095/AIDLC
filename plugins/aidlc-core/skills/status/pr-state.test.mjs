// Tests for pr-state.mjs. Run: `node pr-state.test.mjs`.
//
// The host CLIs are replaced by a function that answers like them, so nothing here touches the network.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksOf, nextStep, parsePr, prStates } from "./pr-state.mjs";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";

// ---- links
check("a GitHub PR link", parsePr("https://github.com/acme/web/pull/42"), { host: "github", owner: "acme", repo: "web", number: 42, url: "https://github.com/acme/web/pull/42" });
check(
  "an Azure Repos PR link",
  parsePr("https://dev.azure.com/acme/Shop%20App/_git/api/pullrequest/7"),
  { host: "azure-repos", org: "https://dev.azure.com/acme", project: "Shop App", repo: "api", number: 7, url: "https://dev.azure.com/acme/Shop%20App/_git/api/pullrequest/7" },
);
check("an old visualstudio.com link maps to dev.azure.com", parsePr("https://acme.visualstudio.com/Shop/_git/api/pullrequest/9")?.org, "https://dev.azure.com/acme");
check("a local merge is not a PR", [parsePr("local-merge:abc1234"), parsePr("null")], [null, null]);

// ---- checks and the next step
check("any failure fails", checksOf([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }]), "failing");
check("anything still running is pending", checksOf([{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }]), "pending");
check("all green passes", checksOf([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }]), "passing");
check("no checks at all", checksOf([]), "none");
check("unresolved threads → review-feedback", nextStep("P-1", { state: "open", review: "review_required", unresolved: 3, checks: "passing" }), "3 unresolved review threads → /aidlc:review-feedback P-1");
check("changes requested with no thread still goes to review-feedback", nextStep("P-1", { state: "open", review: "changes_requested", unresolved: 0, checks: "none" }), "changes requested → /aidlc:review-feedback P-1");
check("a red check → run (devops diagnoses)", nextStep("P-1", { state: "open", review: "approved", unresolved: 0, checks: "failing" }), "checks failing → /aidlc:run P-1");
check("merged → clean up", nextStep("P-1", { state: "merged" }), "merged → /aidlc:status to clean up");
check("waiting on reviewers → nothing to do", nextStep("P-1", { state: "open", review: "review_required", unresolved: 0, checks: "passing" }), null);
check("a CLI error is not a state", nextStep("P-1", { error: "gh not signed in" }), null);

// ---- a workspace, with the host CLIs answering from a table
const ws = mkdtempSync(join(tmpdir(), "prstate-"));
try {
  const runs = join(ws, ".aidlc", "runs");
  mkdirSync(join(runs, "archive"), { recursive: true });
  const run = (dir, item, phase, pr) => writeFileSync(join(dir, `${item}.md`), `---\nitem: ${item}\nphase: ${phase}\npr: ${pr}\n---\n`);
  run(runs, "P-1", "done", "https://github.com/acme/web/pull/1");
  run(join(runs, "archive"), "P-2", "done", "https://github.com/acme/web/pull/2");
  run(runs, "P-3", "implement", "null");
  run(runs, "P-4", "review-pending", "local-merge:abc1234");
  run(runs, "P-5", "review-pending", "https://github.com/acme/web/pull/5");

  const calls = [];
  const gh = {
    1: { view: { state: "OPEN", reviewDecision: "CHANGES_REQUESTED", statusCheckRollup: [{ conclusion: "SUCCESS" }], isDraft: false }, threads: [{ isResolved: false }, { isResolved: false }, { isResolved: true }] },
    2: { view: { state: "MERGED", reviewDecision: "APPROVED", statusCheckRollup: [], isDraft: false }, threads: [] },
    5: { view: { state: "CLOSED", reviewDecision: "", statusCheckRollup: [], isDraft: false }, threads: [] },
  };
  const fake = (argv) => {
    calls.push(argv.join(" "));
    if (argv[1] === "pr") {
      const n = /\/pull\/(\d+)/.exec(argv[3])[1];
      return { status: 0, stdout: JSON.stringify(gh[n].view), stderr: "" };
    }
    const n = /pr=(\d+)/.exec(argv.join(" "))[1];
    return { status: 0, stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: gh[n].threads } } } } }), stderr: "" };
  };

  const first = prStates(ws, fake);
  check("only runs with a remote PR are asked about", first.map((s) => s.item).sort(), ["P-1", "P-2", "P-5"]);
  check("a PR closed without merging says how to close the run", first.find((s) => s.item === "P-5").next, "closed without merging → /aidlc:status to close the run");
  const p1 = first.find((s) => s.item === "P-1");
  check("an open PR with changes requested", [p1.state, p1.review, p1.unresolved, p1.checks, p1.next], ["open", "changes_requested", 2, "passing", "2 unresolved review threads → /aidlc:review-feedback P-1"]);
  check("an archived run's merged PR is reported once", first.find((s) => s.item === "P-2").next, "merged → /aidlc:status to clean up");
  check("…and remembered", existsSync(join(ws, ".aidlc", "logs", "pr-state.json")), true);

  calls.length = 0;
  const second = prStates(ws, fake);
  check("a settled PR is never asked about again", calls.some((c) => /\/pull\/[25]\b|pr=[25]\b/.test(c)), false);
  check("…nor reported again once its run is archived, but still while the run is live", second.map((s) => s.item).sort(), ["P-1", "P-5"]);

  const signedOut = () => ({ status: 1, stdout: "", stderr: "To get started with GitHub CLI, please run: gh auth login" });
  check("a signed-out CLI is an error, not a state", prStates(ws, signedOut, { cache: false })[0].error, "gh not signed in");
} finally {
  rmSync(ws, { recursive: true, force: true });
}

done();
