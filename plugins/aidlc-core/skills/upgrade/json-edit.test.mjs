// Tests for json-edit.mjs — patching a JSON file's text so only what changed changes. Run:
// `node json-edit.test.mjs`. Pins F55: a two-key config migration must be a two-line diff.
import { patchJsonText } from "./json-edit.mjs";
import { check, done } from "../../hooks/scripts/lib/testkit.mjs";

// Lines that differ between two texts (a crude line diff — enough to measure "how big is the diff").
const changedLines = (a, b) => {
  const A = a.split(/\r?\n/), B = b.split(/\r?\n/);
  const setA = new Map(), setB = new Map();
  for (const l of A) setA.set(l, (setA.get(l) || 0) + 1);
  for (const l of B) setB.set(l, (setB.get(l) || 0) + 1);
  let d = 0;
  for (const [l, c] of setA) d += Math.max(0, c - (setB.get(l) || 0));
  for (const [l, c] of setB) d += Math.max(0, c - (setA.get(l) || 0));
  return d;
};
const patch = (text, mutate) => {
  const next = JSON.parse(text);
  mutate(next);
  const out = patchJsonText(text, next);
  return { out, next, ok: JSON.stringify(JSON.parse(out)) === JSON.stringify(next) };
};

const config = `{
  "project": { "key": "PROJ", "name": "web" },
  "workItems": { "source": "markdown" },
  "git": {
    "defaultBranch": "main",
    "branchPattern": "{type}/{id}-{slug}"
  },
  "pipeline": {
    "ceremony": "direct",
    "securityReviewPaths": ["**/auth/**", "package.json"],
    "verification": { "mode": "auto", "reviewer": "on-demand" }
  },
  "ux": {
    "uiPaths": ["app/**", "src/app/**", "components/**"],
    "juryThreshold": 9
  }
}
`;

{
  const r = patch(config, (c) => (c.git.defaultBranch = "develop"));
  check("scalar change: result is the new value", r.ok, true);
  check("scalar change: one line changes", changedLines(config, r.out), 2);
}
{
  const r = patch(config, (c) => {
    c.pipeline.planApproval = "large";
    c.configVersion = 3;
  });
  check("added keys: result is the new value", r.ok, true);
  check("added keys: inline arrays elsewhere are untouched", r.out.includes('"securityReviewPaths": ["**/auth/**", "package.json"]'), true);
  check("added keys: only the new lines (plus the commas they need) change", changedLines(config, r.out) <= 6, true);
  check("added key lands indented like its siblings", r.out.includes('\n    "planApproval": "large"'), true);
}
{
  const r = patch(config, (c) => delete c.pipeline.ceremony);
  check("remove first key of an object", [r.ok, r.out.includes("ceremony")], [true, false]);
}
{
  const r = patch(config, (c) => delete c.ux.juryThreshold);
  check("remove last key of an object", [r.ok, r.out.includes("juryThreshold")], [true, false]);
}
{
  const r = patch(config, (c) => {
    delete c.pipeline.ceremony;
    delete c.pipeline.securityReviewPaths;
  });
  check("remove two neighbouring keys", r.ok, true);
}
{
  const r = patch(config, (c) => {
    delete c.git.defaultBranch;
    delete c.git.branchPattern;
  });
  check("remove every key of an object", [r.ok, /"git": \{\s*\}/.test(r.out)], [true, true]);
}
{
  const r = patch(config, (c) => c.pipeline.securityReviewPaths.push("**/billing/**"));
  check("a changed one-line array stays on one line", r.out.includes('"securityReviewPaths": ["**/auth/**", "package.json", "**/billing/**"]'), true);
  check("…and nothing else moves", changedLines(config, r.out), 2);
}
{
  const r = patch(config, (c) => (c.workItems = { source: "jira", jira: { site: "x" } }));
  check("replaced nested object", r.ok, true);
}
{
  const crlf = config.replace(/\n/g, "\r\n");
  const r = patch(crlf, (c) => (c.pipeline.planApproval = "ask"));
  check("CRLF files stay CRLF", [r.ok, !/[^\r]\n/.test(r.out)], [true, true]);
}
{
  const r = patch(config, (c) => {
    c.ux = undefined;
    delete c.ux;
    c.reuse = { duplication: "warn" };
  });
  check("remove a top-level key and add another", r.ok, true);
}
check("unparseable input falls back to a full serialization", patchJsonText("{ not json", { a: 1 }).trim(), '{\n  "a": 1\n}');
check("no change is no change", patchJsonText(config, JSON.parse(config)), config);

done();
