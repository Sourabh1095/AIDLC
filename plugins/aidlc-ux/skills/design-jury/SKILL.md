---
name: design-jury
description: The Awwwards-style scoring rubric and anti-bias rules used to judge a rendered UI out of 10 and gate the design pipeline — plus the shared render & evidence protocol (resolve the dev-server URL from the repo, fail loud on a non-UI response, capture states) that BOTH the jury and the fidelity checker follow. Load when acting as the jury, when rendering a built UI to check it, or when reviewing a jury report.
user-invocable: false
---

# Design jury — rubric, evidence, and independence

You judge the **rendered** UI as an Awwwards jury would: honestly, exactingly, on what you can see.
The score is only worth something if it's unbiased and evidence-backed.

## Independence & anti-bias (non-negotiable)

- Judge the pixels, not intentions. You are not given — and must not seek — the makers' reasoning,
  self-assessment, or who built what.
- No directional bias: don't inflate to be kind; don't deflate to seem rigorous. Start skeptical,
  then let evidence move each score. **A 9 is genuinely rare and must be earned.**
- Every dimension score REQUIRES concrete visual evidence (what in a screenshot earns/costs it). A
  score you can't ground in a shot is invalid — recapture and re-judge.
- Consistency check across rounds: don't reward a fix that regressed a previous strength.

## Render & evidence protocol — shared, not jury-only

**Steps 1–4 are the canonical render protocol for every agent that renders the built UI** — the jury
here, and `aidlc-fidelity` on a Figma-sourced surface. They are stated once, in this file, so a
change to how the URL is resolved cannot land in one renderer and not the other. Steps 5–6 are the
jury's evidence rules; the fidelity checker's equivalent is in `aidlc-ux:figma-handoff` → *Fidelity*.

1. **Resolve the render URL from the repo, not the static config.** Before rendering, derive the real
   dev-server URL/port from the repo itself — parse the `dev` (or `start`) script in the repo's
   `package.json` for the port (e.g. `next dev -p 3100`, `vite --port 3001`, a `PORT=` prefix), or the
   framework default the scaffold chose (Next 3000, Vite 5173, …). Use `ux.renderBaseUrl` **only** when
   the port can't be derived. If the derived port and the configured `renderBaseUrl` disagree, **prefer
   the derived one** and record a `renderBaseUrl mismatch: config <X> vs actual <Y>` line in the report
   (so the config gets corrected) — never trust a stale config port over the repo's actual `dev` script.
2. Confirm the app is live at the resolved URL. If it isn't reachable, do NOT guess — report
   `BLOCKED: app not rendering at <url>`. You cannot judge what you can't see.
3. **Fail loud on a non-UI response — never score the wrong server.** Verify the response is the
   actual rendered HTML UI. If you get JSON, a bare API payload, a 404/500, or anything that isn't the
   app (e.g. the port is shared with an API), do NOT score it — report `BLOCKED: non-UI response at
   <url> (expected HTML UI, got <JSON/404/…>)`. A wrong-server render must fail loud, never pass
   silently with a fabricated score.
4. Drive it with the Playwright MCP (bundled with this plugin — `aidlc-ux/.mcp.json`; it is not a
   core dependency, so a backend-only workspace never installs it). **Viewport is the renderer's own
   call:** the jury uses the
   configured desktop viewport (`target: desktop-web`); the fidelity checker uses the **artboard width
   the frame was drawn at**, because comparing a 1440px design against a 1280px viewport manufactures
   defects that aren't real.
5. Capture the key screens AND states: default, hover, focus-visible, empty, loading, error where
   they exist — plus the narrative's **signature moment** (scroll/interact to trigger it, then shoot).
   On a scoped redesign, also review the supplied sibling-page shots so you can judge whether the
   target stays consistent with the rest of the app.
6. Save screenshots; list their paths as the evidence set in the report.

## Rubric (score each /10; composite = weighted sum, one decimal)

| Dimension | Weight | What earns a high score |
|---|---|---|
| **Design / aesthetics** | 25% | Clear visual hierarchy; confident typography; deliberate color & gradient; spacing/whitespace that breathes; a distinct point of view. |
| **Usability / UX** | 20% | Obvious primary action; legible; predictable; graceful empty/loading/error; nothing sacrificed to style. |
| **Creativity / originality** | 15% | A memorable idea executed with restraint; not a template; the signature moment lands. |
| **Motion & interaction craft** | 20% | Purposeful, smooth (60fps, no jank); coherent easing; tasteful sequencing; `prefers-reduced-motion` respected; no over-animation. |
| **Consistency / uniformity** | 12% | One-system feel; tokens honored across all screens; no off-system color/spacing; repeated components identical. **When brand anchors were supplied, they're honored exactly. On a scoped redesign, the target is consistent with the sibling screens — not a lone island in a different style. When a design system was *given* (`systemSource: figma`), this dimension is judged against it — see below.** |
| **Polish & states** | 8% | Pixel precision; every interactive state designed; AA contrast; no visual bugs at the edges. |

Composite is out of 10. Gate = `juryThreshold` (default 9).

## A given design system — Consistency stops being a matter of taste

When the brief says `systemSource: figma`, the brand's design system was handed over and the pod
designed the screens *within* it. You still gate, and you still score everything — the screens are the
pod's work, so composition, hierarchy, usability, motion and polish are all fair game. What changes is
**Consistency**: you are given `design/figma-system.md` and the component reference shots, and you
judge against them, not against your sense of what's tidy.

- A raw hex, an off-scale space, a font size outside the system's type scale → a **defect**, named
  with the token it should have used. The system already decided; the build didn't get a vote.
- A hand-rolled component beside one the system defines → a defect, even when it looks fine, and
  especially when it looks fine.
- Variant and state spellings that diverge from the system's → a defect.
- What the system genuinely doesn't cover — page composition, layout, motion, a component it lacks —
  is the pod's to design, and you judge it on the usual merits. Don't invent system rules that aren't
  in the file.

Do not dock the design for the *system's* limitations: a restrained corporate kit will never win
Creativity, and the builders can't fix that. Note it once, score the composition honestly, and move
on.

## Figma-sourced UI — advisory, and a different reading of the rubric

When the run file says `designSource: figma`, the design was decided and approved outside this
session, and the gate is `aidlc-fidelity`'s (zero blocking deviations), not yours. Three things
change:

- **You do not gate.** Your composite is information. It never blocks a PR and never triggers an
  automatic redesign round — a jury score cannot be allowed to overwrite the client's approved
  design. You run at all only because `ux.figma.jury` said `advisory`/`gate`, or a human accepted the
  offer.
- **Score the build, then say what belongs to whom.** Split every finding into *implementation* (the
  build fails to deliver what the design specifies — that's also a fidelity defect, route it to an
  owner) and *design* (the approved design itself is the weak part — that goes to the human and the
  designer as a suggestion, never into the build). A finding that doesn't say which it is, is
  unusable.
- **Creativity/originality is not the builders'.** Score it honestly, but attribute it to the source
  design; don't dock the implementation for a conservative mockup, and don't credit it for a bold one.

Everything else — independence, evidence, no directional bias — holds exactly as above.

## Verdict & required fixes

- `PASS` when composite ≥ threshold.
- `ITERATE` otherwise: an ordered list of **specific, actionable** fixes, each addressed to an owner
  (`design-system` / `motion` / `implementer`), naming the exact defect and what "fixed" looks like.
  Vague notes waste a whole round. Also record what's working, so the next round protects it.

## Output

`design/jury-report-r{{round}}.md` from the template. You never edit product code — you only judge.
