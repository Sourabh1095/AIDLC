---
name: ux-narrative
description: Discipline for writing a UX narrative — the experience story (vision, tone, journey, signature moment) that anchors every downstream design and motion decision. Load when writing or reviewing design/narrative.md.
user-invocable: false
---

# UX narrative — writing the experience story

The narrative is decided before any pixel. It is the north star: if a token, layout or animation
can't be traced to a line in here, it's unjustified. Keep it short enough to hold in one read.

## What a good narrative fixes

- **A feeling, on a clock.** What the user should feel in the first ~3 seconds, then across the
  journey. Feelings, not features.
- **Tone as 3–5 defensible adjectives.** Each must later become concrete design/motion choices.
  Banned because they decide nothing: *modern, clean, sleek, beautiful, intuitive, seamless.*
  Prefer specific registers: *editorial, precise, playful, restrained, tactile, confident.*
- **The journey, including the unhappy path.** Landing/first-paint, the primary action and its
  reward, transitions/feedback, and — non-negotiable — empty / loading / error. Award-tier work is
  judged partly on how gracefully the "boring" states are handled.
- **Exactly one signature moment.** The single interaction that makes the surface memorable.
  Describe it vividly in words (motion will realize it). More than one "signature" = none.
- **Anti-goals.** Name the clichés and over-animation traps to avoid, so downstream agents don't
  reach for them.

## Quality bar

- Every beat maps to an acceptance criterion — no invented scope dressed up as experience.
- Actionable, not poetic: a designer must be able to derive a color mood, a type register and an
  easing feel from what you wrote. If they can't, rewrite it.
- Grounded: don't contradict established brand/patterns unless the item is a redesign.

## Output

`design/narrative.md` from `${CLAUDE_PLUGIN_ROOT}/templates/narrative.md`. One-line vision at
the top; signature moment called out explicitly.
