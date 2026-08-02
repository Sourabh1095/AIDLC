// Shell command parsing, shared by the two PreToolUse[Bash] hooks (guard.mjs and
// dep-vet.mjs). Both decide what a command *is* before deciding whether to act on
// it, and both must reach the same answer — they previously held byte-identical
// copies of `tokenize`/`commandArgv`, which is how one gets a fix and the other
// doesn't (the same argument that put run-files.mjs here).
//
// The principle every function below serves: PARSE the command being executed,
// never regex-match free text. A quoted argument is one opaque token, so a commit
// message that merely mentions `push`, `DROP TABLE` or `npm i evil-pkg` can never
// be read as a command.

// Split a command line into the segments that are individually EXECUTED, honouring
// quotes. Separators: `;` `&` `|` (so `&&` and `||` collapse) and an unquoted
// NEWLINE.
//
// The newline is why this function exists. Both hooks used `cmd.split(/[|;&]+/)`,
// which does not treat a newline as a separator, so a multi-line command collapsed
// into ONE segment. Segment identity is read from argv[0], so any command whose
// FIRST line was `git …` was classified as a git segment — and guard.mjs skips
// every content check on a git segment (git executes no SQL, cluster, filesystem or
// credential operations), while dep-vet.mjs finds no package manager and returns.
// Both then failed OPEN, and silently:
//
//     git status\ncat ~/.ssh/id_rsa       → allowed  (credential read)
//     git status\ncat .env                → allowed  (env-file backstop)
//     git log\npsql -h prod.example.com   → allowed  (production target)
//     git status\nnpm install left-pad    → ungated  (supply-chain gate)
//
// Multi-line Bash is ordinary — heredocs, multi-step sequences, and the very git
// flows this framework's own skills instruct — so this was reachable on the normal
// path, not a contrived one.
//
// Splitting has to be QUOTE-AWARE rather than a wider regex, because a quoted
// argument legitimately contains newlines: `git commit -m "line one\nline two"` is
// ONE command, and splitting it would hand the message body to the content checks
// as if it were a command to execute. Quote-awareness makes that case correct for
// free — the newline is inside the quote, so no split happens.
//
// Two things are deliberately NOT modelled, both failing in the loud direction:
// backslash escaping (`\;` splits early → a false-positive block, never a silent
// pass; the tokenizer below does not model it either, and keeping the two consistent
// matters more than the edge case), and unquoted heredoc bodies (`<<EOF … EOF`),
// whose content is split like ordinary lines.
export function splitSegments(command) {
  const segments = [];
  let cur = "";
  let quote = null;
  for (const c of String(command)) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "|" || c === ";" || c === "&" || c === "\n" || c === "\r") {
      if (cur.trim()) segments.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) segments.push(cur);
  return segments;
}

// Shell wrappers whose `-c` payload is *another command line*, and the flags that
// introduce it. `env` is here for the same reason with a different shape: everything
// after its assignments is the real command.
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "busybox", "powershell", "pwsh", "cmd"]);
const PAYLOAD_FLAGS = new Set(["-c", "-Command", "-command", "-EncodedCommand", "/c", "/C", "/k", "/K"]);

// Every segment a command line will actually execute, INCLUDING the ones hidden inside
// a shell wrapper. `bash -c "rm -rf /etc"` is one segment whose argv[0] is `bash`, so
// every argv-based check reads it as a benign call to bash and the real command is
// never inspected. Probed against the hooks: `bash -c "npm install evil-pkg"` slipped
// dep-vet's gate, `sh -c "cat .env"` slipped the env backstop, and
// `bash -c "git push --force"` slipped the push guard entirely — the argv-based checks
// all had this hole, while the raw-segment regex checks (production targets, DB
// operations) caught it incidentally.
//
// The wrapper segment is kept as well as its payload, so the regex checks still see the
// text they always saw and nothing narrows. Depth-limited because a payload can wrap
// again, and a hostile or merely convoluted command should not be able to spin this.
export function expandSegments(command, depth = 0) {
  const out = [];
  for (const seg of splitSegments(command)) {
    out.push(seg);
    if (depth >= 3) continue;
    const argv = commandArgv(seg);
    const name = commandName(argv);
    if (SHELL_WRAPPERS.has(name)) {
      const i = argv.findIndex((a) => PAYLOAD_FLAGS.has(a));
      // tokenize already stripped the payload's outer quotes, so it is a command line.
      if (i >= 0 && i + 1 < argv.length) out.push(...expandSegments(argv[i + 1], depth + 1));
    } else if (name === "env") {
      // Skip env's own assignments and flags, then take the REST verbatim — filtering
      // flags out here would reconstruct `env FOO=1 rm -rf /x` as `rm /x`, losing the
      // very flag the delete check keys on.
      const rest = argv.slice(1);
      let k = 0;
      while (k < rest.length && (/^\w+=/.test(rest[k]) || rest[k].startsWith("-"))) k++;
      if (k < rest.length) out.push(rest.slice(k).join(" "));
    }
  }
  return out;
}

// Split a shell segment into argv, honouring quotes. A quoted argument stays ONE
// token, so its contents can never be mistaken for a flag or a subcommand. Parsing
// (rather than regex-matching quote-blanked text) is what makes the callers'
// checks fail closed: a path containing a space used to defeat guard's old
// `-C\s+\S+` pattern and silently skip every push check (F46).
export function tokenize(seg) {
  const out = [];
  let cur = "";
  let quote = null;
  let quoted = false;
  for (const c of seg) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      quoted = true;
    } else if (/\s/.test(c)) {
      if (cur || quoted) out.push(cur);
      cur = "";
      quoted = false;
    } else cur += c;
  }
  if (cur || quoted) out.push(cur);
  return out;
}

// argv with leading env assignments and sudo removed.
export function commandArgv(seg) {
  const argv = tokenize(seg);
  while (argv.length && /^\w+=/.test(argv[0])) argv.shift();
  if (argv.length && argv[0].split(/[\\/]/).pop() === "sudo") {
    argv.shift();
    while (argv.length && argv[0].startsWith("-")) argv.shift();
  }
  return argv;
}

// The executable name of a segment, path- and sudo-stripped: `/usr/bin/git` → `git`.
// "" when the segment is empty.
export function commandName(argv) {
  return argv.length ? argv[0].split(/[\\/]/).pop() : "";
}
