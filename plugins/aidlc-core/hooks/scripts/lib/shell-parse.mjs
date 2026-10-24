// Shell command parsing, shared by the two PreToolUse[Bash|PowerShell] hooks (guard.mjs and
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

// Shell wrappers whose payload is *another command line*. `env` is handled below for the
// same reason with a different shape: everything after its assignments is the real command.
//
// The payload flag is spelled differently per family, and matching one fixed list let
// each family's other spellings walk past every argv-based check:
//   - POSIX shells combine flags: `bash -lc "…"` is as common as `bash -c "…"`.
//   - PowerShell accepts any unambiguous prefix in any case (`-c`, `-Com`, `-COMMAND`),
//     and `-EncodedCommand` (`-e`, `-ec`, `-enc`, …) carries the command as base64
//     UTF-16LE — the classic way to hide one from a text check. It is decoded here.
//   - cmd uses `/c` and `/k`.
const POSIX_SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "busybox"]);
const POWERSHELLS = new Set(["powershell", "pwsh"]);

// The command line a wrapper will execute, or "" when `argv` is not a wrapper with one.
function wrapperPayload(name, argv) {
  for (let i = 1; i < argv.length - 1; i++) {
    const a = argv[i];
    if (POSIX_SHELLS.has(name) && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) return argv[i + 1];
    if (name === "cmd" && /^\/[ck]$/i.test(a)) return argv.slice(i + 1).join(" ");
    if (POWERSHELLS.has(name)) {
      if (/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(a)) return argv.slice(i + 1).join(" ");
      if (/^-e(c|n(c(o(d(e(d(c(o(m(m(a(n(d)?)?)?)?)?)?)?)?)?)?)?)?)?$/i.test(a)) {
        try {
          return Buffer.from(argv[i + 1], "base64").toString("utf16le");
        } catch {
          return "";
        }
      }
    }
  }
  return "";
}

// Re-join argv into a command line, quoting tokens that tokenize() would otherwise split.
const joinArgv = (argv) => argv.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" ");

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
//
// Command substitutions run too: `echo $(git push --force)`, `` x=`cat .env` `` and
// `diff <(cat .env) b` each execute a command that is nowhere near argv[0]. Their bodies
// are expanded as command lines of their own (lib: substitutions()).
export function expandSegments(command, depth = 0) {
  const out = [];
  if (depth < 3) for (const inner of substitutions(command)) out.push(...expandSegments(inner, depth + 1));
  for (const seg of splitSegments(command)) {
    out.push(seg);
    if (depth >= 3) continue;
    const argv = commandArgv(seg);
    const name = commandName(argv);
    const payload = wrapperPayload(name, argv);
    if (payload) {
      // tokenize already stripped the payload's outer quotes, so it is a command line.
      out.push(...expandSegments(payload, depth + 1));
    } else if (name === "env") {
      // Skip env's own assignments and flags, then take the REST verbatim — filtering
      // flags out here would reconstruct `env FOO=1 rm -rf /x` as `rm /x`, losing the
      // very flag the delete check keys on.
      const rest = argv.slice(1);
      let k = 0;
      while (k < rest.length && (/^\w+=/.test(rest[k]) || rest[k].startsWith("-"))) k++;
      if (k < rest.length) out.push(...expandSegments(joinArgv(rest.slice(k)), depth + 1));
    }
  }
  return out;
}

// Bodies of command substitutions — `$(…)`, `<(…)`, `>(…)` and backticks — that the
// shell will execute. Single-quoted text is skipped (nothing in it runs); double-quoted
// text is not (`"$(cmd)"` still runs `cmd`). PowerShell's `$(…)` subexpression runs its
// body the same way.
export function substitutions(command) {
  const s = String(command);
  const out = [];
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    if (c === "'" && quote !== '"') {
      quote = "'";
      continue;
    }
    if (c === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (c === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i) {
        out.push(s.slice(i + 1, j));
        i = j;
      }
      continue;
    }
    if ((c === "$" || c === "<" || c === ">") && s[i + 1] === "(") {
      let nest = 0;
      let j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === "(") nest++;
        else if (s[j] === ")" && --nest === 0) break;
      }
      if (j < s.length) {
        out.push(s.slice(i + 2, j));
        i = j;
      }
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

// Commands that run the REST of their argv as the real command. Each one put a harmless
// name in argv[0], so `nohup cat .env`, `timeout 5 git push --force` and
// `nice -n 5 rm -rf ~/x` were read as calls to nohup, timeout and nice. Only sudo was
// stripped before. Value-taking options are stepped over so the real command name is
// what lands in argv[0]; `timeout` additionally takes a duration operand.
const PREFIX_COMMANDS = new Set(["sudo", "doas", "command", "exec", "nohup", "time", "nice", "timeout", "stdbuf", "ionice", "chronic", "unbuffer"]);
const PREFIX_VALUE_OPTS = new Set(["-n", "-u", "-g", "-s", "-k", "-c", "-p", "--signal", "--kill-after", "--adjustment", "--user", "--group"]);

// Shell grammar that can stand in front of a command inside one segment. Segments are cut
// at `;`, `|`, `&` and newlines, so `if true; then git push --force; fi` yields the
// segment `then git push --force` — argv[0] `then`, and the push check never ran. The
// same for `{ …; }`, `( … )`, `! cmd`, loop bodies (`do …`) and a function body
// (`f() { git push --force; }`, the usual shape of a shell git alias).
const SHELL_GRAMMAR = new Set(["{", "}", "(", ")", "!", "if", "then", "else", "elif", "do", "while", "until"]);

// A token with more closing than opening parentheses carries the end of a subshell or
// substitution: `(cd x && git push --force)` leaves `--force)`, which no flag check
// recognised. Balanced ones (`$(pwd)`) are left alone.
function stripUnbalancedClose(t) {
  let s = t;
  const count = (ch) => s.split(ch).length - 1;
  while (s.endsWith(")") && count(")") > count("(")) s = s.slice(0, -1);
  return s;
}

// argv with leading env assignments, shell grammar and prefix commands (sudo, nohup,
// timeout, …) removed.
export function commandArgv(seg) {
  const argv = [];
  for (const t of tokenize(seg)) {
    const s = stripUnbalancedClose(t);
    if (s !== "" || t === "") argv.push(s); // drop a bare `)`, keep a quoted empty argument
  }
  for (;;) {
    while (argv.length && /^\w+=/.test(argv[0])) argv.shift();
    if (!argv.length) break;
    if (SHELL_GRAMMAR.has(argv[0])) {
      argv.shift();
      continue;
    }
    if (argv[0] === "function") {
      argv.splice(0, 2);
      continue;
    }
    if (/^\(+./.test(argv[0])) {
      argv[0] = argv[0].replace(/^\(+/, "");
      continue;
    }
    if (/^[\w.-]+\(\)$/.test(argv[0])) {
      argv.shift();
      continue;
    }
    const name = argv[0].split(/[\\/]/).pop().toLowerCase();
    if (!PREFIX_COMMANDS.has(name)) break;
    argv.shift();
    while (argv.length && argv[0].startsWith("-")) {
      const opt = argv.shift();
      if (PREFIX_VALUE_OPTS.has(opt) && argv.length) argv.shift();
    }
    if (name === "timeout" && argv.length && /^\d/.test(argv[0])) argv.shift();
  }
  return argv;
}

// The executable name of a segment, path- and sudo-stripped, lower-cased, with a Windows
// executable extension removed: `/usr/bin/git` → `git`, `C:\Git\bin\Bash.EXE` → `bash`.
// "" when the segment is empty.
//
// Lower-cased because the shells this runs under resolve names that way: PowerShell
// cmdlets and aliases are case-insensitive (`GET-CONTENT .env` is `Get-Content .env`),
// and Windows finds `CAT.exe` for `cat`. A case-sensitive name was a spelling that walked
// past every name-based check. Every caller compares against lower-case names.
export function commandName(argv) {
  return argv.length
    ? argv[0]
        .split(/[\\/]/)
        .pop()
        .toLowerCase()
        .replace(/\.(exe|cmd|bat|com)$/, "")
    : "";
}
