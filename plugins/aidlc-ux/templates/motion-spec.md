# Motion Spec — {{ID}} {{TITLE}}

> Motion is meaning, not decoration. Every animation here must serve a narrative beat and respect
> the performance + accessibility budget. Owned by `aidlc-motion`. Realizes the narrative's
> "signature moment".

## Motion principles for this surface

- Easing vocabulary: name the 2–3 curves used (e.g. `ease-out-quint` for entrances,
  `ease-in-out-cubic` for state changes) — as tokens, reused everywhere. No random per-element easings.
- Duration scale: `fast` / `base` / `slow` (e.g. 150 / 300 / 600ms) — tie durations to distance/scale.
- Choreography: stagger/sequence rules; what leads, what follows.

## Inventory (per interaction)

| Interaction | Trigger | Property | Duration / easing | Purpose (narrative link) |
|---|---|---|---|---|
| Hero reveal | load | opacity + translateY | | |
| Scroll reveal | scroll into view | | | |
| Hover state | pointer | transform/scale/color | | |
| Route/state transition | navigation | | | |
| Micro-interaction (button/toggle) | interaction | | | |

## Techniques in play

Note which are used and why (only if they serve the narrative): scroll-linked / motion-to-scroll,
parallax, GSAP timelines, sequencing, scale/transform, gradient fade, typography reveals, WebGL.
Prefer transform/opacity (GPU-friendly) over layout-triggering properties.

## Budget & guardrails (hard constraints — jury will check)

- **Performance:** animate `transform`/`opacity` only for anything continuous; no layout thrash;
  target 60fps; no long tasks on the main thread during the hero sequence.
- **Accessibility:** honor `prefers-reduced-motion` — provide a calm, non-animated fallback for
  every non-essential animation.
- **Restraint:** motion must not delay usability; nothing critical hidden behind a slow reveal.
  Over-animation is an award-killer — flag anything that animates for its own sake.

## Implementation notes

Libraries chosen (GSAP / Framer Motion / CSS) and why; where the code lives.
