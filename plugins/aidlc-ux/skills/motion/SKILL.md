---
name: motion
description: Discipline for motion and interaction design — animation, micro-interactions, scroll-based/motion-to-scroll, parallax, hover, transitions, sequencing, WebGL — that serves meaning within a performance and accessibility budget. Load when specifying, building or reviewing motion.
user-invocable: false
---

# Motion — meaning in movement

Motion guides attention, communicates state, and creates the signature moment. It is never
decoration added at the end. Award juries reward *restraint and craft*; they punish jank and
animation-for-its-own-sake.

## Design the system, not one-off tweens

- **Easing vocabulary:** 2–3 named curves as tokens (e.g. entrance `ease-out-quint`, state-change
  `ease-in-out-cubic`), reused everywhere. Random per-element easings read as chaos.
- **Duration scale:** `fast / base / slow` (e.g. 150 / 300 / 600ms). Tie duration to distance/scale —
  bigger moves take longer; small feedback is quick.
- **Choreography:** stagger and sequence so a group entrance is one composition. Decide what leads.

## Techniques (use only when they serve a beat)

Scroll-linked / motion-to-scroll, parallax, GSAP timelines, sequencing, scale/transform, gradient
fade, typographic reveals, hover states, WebGL. Pick the lightest tool that does the job — CSS for
simple state, Framer Motion for component transitions, GSAP for timelines and scroll. Use Context7
for current library APIs.

## Budget — hard constraints (the jury checks these)

- **Performance:** animate `transform`/`opacity` for anything continuous; never animate
  layout-triggering properties in a loop; target 60fps; no main-thread long tasks during the hero
  sequence.
- **Accessibility:** honor `prefers-reduced-motion` — a calm, non-animated fallback for every
  non-essential animation. Never hide a critical action behind a slow reveal.
- **Restraint:** if an effect doesn't serve a narrative beat, cut it. Flag requested effects that
  hurt usability rather than shipping them silently.

## Output

`design/motion-spec.md` (easing/duration tokens + interaction inventory tied to narrative beats) and
the implemented motion in code, consuming design-system tokens for any visual values.
