---
name: design-jury
description: The Awwwards-style scoring rubric, anti-bias rules and render/evidence protocol used to judge a rendered UI out of 10 and gate the design pipeline. Load when acting as the jury or reviewing a jury report.
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

## Render & evidence protocol

1. Confirm the app is live at `renderBaseUrl`. If it isn't reachable, do NOT guess — report
   `BLOCKED: app not rendering`. You cannot judge what you can't see.
2. Drive it with the Playwright MCP at the configured desktop viewport (`target: desktop-web`).
3. Capture the key screens AND states: default, hover, focus-visible, empty, loading, error where
   they exist — plus the narrative's **signature moment** (scroll/interact to trigger it, then shoot).
   On a scoped redesign, also review the supplied sibling-page shots so you can judge whether the
   target stays consistent with the rest of the app.
4. Save screenshots; list their paths as the evidence set in the report.

## Rubric (score each /10; composite = weighted sum, one decimal)

| Dimension | Weight | What earns a high score |
|---|---|---|
| **Design / aesthetics** | 25% | Clear visual hierarchy; confident typography; deliberate color & gradient; spacing/whitespace that breathes; a distinct point of view. |
| **Usability / UX** | 20% | Obvious primary action; legible; predictable; graceful empty/loading/error; nothing sacrificed to style. |
| **Creativity / originality** | 15% | A memorable idea executed with restraint; not a template; the signature moment lands. |
| **Motion & interaction craft** | 20% | Purposeful, smooth (60fps, no jank); coherent easing; tasteful sequencing; `prefers-reduced-motion` respected; no over-animation. |
| **Consistency / uniformity** | 12% | One-system feel; tokens honored across all screens; no off-system color/spacing; repeated components identical. **When brand anchors were supplied, they're honored exactly. On a scoped redesign, the target is consistent with the sibling screens — not a lone island in a different style.** |
| **Polish & states** | 8% | Pixel precision; every interactive state designed; AA contrast; no visual bugs at the edges. |

Composite is out of 10. Gate = `juryThreshold` (default 9).

## Verdict & required fixes

- `PASS` when composite ≥ threshold.
- `ITERATE` otherwise: an ordered list of **specific, actionable** fixes, each addressed to an owner
  (`design-system` / `motion` / `implementer`), naming the exact defect and what "fixed" looks like.
  Vague notes waste a whole round. Also record what's working, so the next round protects it.

## Output

`design/jury-report-r{{round}}.md` from the template. You never edit product code — you only judge.
