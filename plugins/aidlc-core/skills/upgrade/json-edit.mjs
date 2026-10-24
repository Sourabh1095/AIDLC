// Write a changed JSON value back into the text it came from, touching only what changed.
//
//   patchJsonText(originalText, nextValue) → text
//
// `JSON.stringify(next, null, 2)` is correct and unreviewable: it re-flows the whole file, so every
// array a human kept on one line comes back one element per line, and a two-key migration shows up
// as a 147-line diff (F55). A diff nobody can read gets approved without being read — the opposite of
// what showing the user a diff is for.
//
// So the original text is parsed with the offsets of every value, the old and new values are
// compared, and only the differing spans are rewritten:
//   - a changed scalar is replaced in place;
//   - a removed key is cut with its comma;
//   - an added key is inserted at the end of its object, indented like its siblings;
//   - a changed array or a newly-typed value is re-serialized on its own, on one line when the
//     original was on one line and it still fits, else indented to where it sits.
// Untouched keys keep their exact text, order, spacing and line endings. The result is re-parsed and
// compared with `nextValue`; on any mismatch the function falls back to a full re-serialization,
// because a wrong file is worse than a large diff.

// ---- parse with spans ------------------------------------------------------------------------

function parseWithSpans(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const fail = (m) => {
    throw new SyntaxError(`${m} at ${i}`);
  };
  function value() {
    ws();
    const start = i;
    const c = text[i];
    if (c === "{") {
      i++;
      const members = [];
      ws();
      if (text[i] === "}") {
        i++;
        return { type: "object", start, end: i, members };
      }
      for (;;) {
        ws();
        const keyStart = i;
        const key = string();
        ws();
        if (text[i++] !== ":") fail("expected :");
        const v = value();
        members.push({ key, keyStart, value: v });
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return { type: "object", start, end: i, members };
        }
        fail("expected , or }");
      }
    }
    if (c === "[") {
      i++;
      const items = [];
      ws();
      if (text[i] === "]") {
        i++;
        return { type: "array", start, end: i, items };
      }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return { type: "array", start, end: i, items };
        }
        fail("expected , or ]");
      }
    }
    if (c === '"') {
      string();
      return { type: "scalar", start, end: i };
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) fail("unexpected token");
    i += m[0].length;
    return { type: "scalar", start, end: i };
  }
  function string() {
    if (text[i] !== '"') fail("expected string");
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i));
  }
  const root = value();
  return root;
}

// ---- formatting helpers ----------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function lineStartOf(text, pos) {
  const n = text.lastIndexOf("\n", pos - 1);
  return n + 1;
}
const indentAt = (text, pos) => /^[ \t]*/.exec(text.slice(lineStartOf(text, pos)))[0];

// The file's indent unit, from the first indented line; two spaces when the file has none.
function indentUnit(text) {
  const m = /\n([ \t]+)\S/.exec(text);
  return m ? m[1] : "  ";
}

// Serialize `value` to sit at a position whose line is indented by `baseIndent`. A value whose
// original was single-line stays single-line when it fits.
function compact(v) {
  if (Array.isArray(v)) return `[${v.map(compact).join(", ")}]`;
  if (isObj(v)) {
    const ks = Object.keys(v);
    return ks.length ? `{ ${ks.map((k) => `${JSON.stringify(k)}: ${compact(v[k])}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}

function serialize(value, baseIndent, unit, eol, preferInline) {
  if (preferInline) {
    const inline = compact(value);
    if (baseIndent.length + inline.length <= 100) return inline;
  }
  return JSON.stringify(value, null, unit).split("\n").join(eol + baseIndent);
}

// ---- diff and patch --------------------------------------------------------------------------

function collectEdits(text, node, before, after, edits, unit, eol) {
  if (same(before, after)) return;
  if (node.type === "object" && isObj(before) && isObj(after)) {
    const memberIndent = node.members.length ? indentAt(text, node.members[0].keyStart) : indentAt(text, node.start) + unit;
    const inlineObject = !text.slice(node.start, node.end).includes("\n");
    // Removed keys, as runs of consecutive members, so two neighbours never produce overlapping cuts.
    // A run after a kept member is cut from that member's end (taking the separating commas with it);
    // a run at the start is cut up to the next kept member's key (keeping its indentation); a run that
    // is the whole object empties it.
    const gone = node.members.map((m) => !Object.prototype.hasOwnProperty.call(after, m.key));
    for (let a = 0; a < gone.length; a++) {
      if (!gone[a]) continue;
      let b = a;
      while (b + 1 < gone.length && gone[b + 1]) b++;
      const ms = node.members;
      if (a > 0) edits.push({ from: ms[a - 1].value.end, to: ms[b].value.end, text: "" });
      else if (b < ms.length - 1) edits.push({ from: ms[0].keyStart, to: ms[b + 1].keyStart, text: "" });
      else edits.push({ from: node.start + 1, to: node.end - 1, text: "" });
      a = b;
    }
    // changed keys
    for (const m of node.members)
      if (Object.prototype.hasOwnProperty.call(after, m.key)) collectEdits(text, m.value, before[m.key], after[m.key], edits, unit, eol);
    // added keys, appended in `after`'s order after the last surviving member
    const added = Object.keys(after).filter((k) => !Object.prototype.hasOwnProperty.call(before, k));
    if (added.length) {
      const surviving = node.members.filter((m) => Object.prototype.hasOwnProperty.call(after, m.key));
      const anchor = surviving.length ? surviving[surviving.length - 1].value.end : node.start + 1;
      const sep = inlineObject ? " " : eol + memberIndent;
      const parts = added.map((k) => `${JSON.stringify(k)}: ${serialize(after[k], memberIndent, unit, eol, inlineObject)}`);
      const lead = surviving.length ? "," : "";
      const closingNeedsBreak = !surviving.length && !inlineObject;
      edits.push({
        from: anchor,
        to: anchor,
        text: lead + parts.map((p) => sep + p).join(",") + (closingNeedsBreak ? eol + indentAt(text, node.start) : ""),
      });
    }
    return;
  }
  // arrays, scalars, and type changes: replace the value's own span
  const singleLine = !text.slice(node.start, node.end).includes("\n");
  edits.push({ from: node.start, to: node.end, text: serialize(after, indentAt(text, node.start), unit, eol, singleLine) });
}

export function patchJsonText(originalText, nextValue) {
  const eol = originalText.includes("\r\n") ? "\r\n" : "\n";
  const full = JSON.stringify(nextValue, null, 2).split("\n").join(eol) + eol;
  let before;
  let root;
  try {
    before = JSON.parse(originalText);
    root = parseWithSpans(originalText);
  } catch {
    return full;
  }
  const edits = [];
  collectEdits(originalText, root, before, nextValue, edits, indentUnit(originalText), eol);
  edits.sort((a, b) => b.from - a.from || b.to - a.to);
  let out = originalText;
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  try {
    if (same(JSON.parse(out), nextValue)) return out;
  } catch {
    /* fall through */
  }
  return full;
}
