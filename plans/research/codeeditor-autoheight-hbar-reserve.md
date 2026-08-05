# CodeEditor auto-height: horizontal-scrollbar reserve, deferred

A record of a live-diagnosed root cause in `CodeEditor`'s `autoHeightMaxRows`
machinery that was **deliberately reverted** rather than shipped, after the
fix chain caused three successive new regressions in the same session. This
is a research/history document, not an implementation plan — it deliberately
lives outside `plans/` proper so `/implement` does not pick it up.

Written against `master` at commit `bee64dcd` ("Reject CodeEditor
auto-height growth against an unchanged shape").

All file references are relative to `packages/lib/src/typescript/lib/`
unless noted.

## Current shipped state

[`component/editor/CodeEditor.ts`](../../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts)'s
`syncAutoHeight()`:

- Rejects any height GROWTH against an unchanged `[lines, docLength,
  clientWidth]` shape — fixes the original production bug: unbounded
  runaway growth from CodeMirror's own `geometryChanged` echo (a committed
  height changes `.cm-scroller`'s real `clientHeight`, which CodeMirror's
  own `ViewState.measure()` then reports back as a fresh geometry change).
- Rejects growth flagged as a pure selection change outright (a cursor move
  alone can never legitimately need more vertical space).
- Measures the horizontal-scrollbar reserve directly via `offsetHeight` vs
  `clientHeight` (not predicted from `scrollWidth`/`clientWidth`, which
  `scrollbar-gutter: stable` makes an unreliable predictor), **re-measured
  on every call**, not just shape changes — a language grammar can load
  asynchronously and resolve a real scrollbar with no shape change.
- Reserves the hbar space unconditionally after clamping content to the row
  cap (previously `Math.min` silently discarded the reserve when the cap was
  binding).
- Corrects a sub-pixel content shortfall via a `_contentElement`
  (`.cm-content`) `getBoundingClientRect` rect, once per shape change
  (integer `scrollHeight`/`clientHeight` can round away a genuine shortfall
  entirely).
- Rejects a same-shape shrink smaller than 1px (integer-rounding noise from
  that fractional correction, otherwise silently reverted on the very next
  `geometryChanged` event).

**Known remaining cosmetic bug, accepted for now:** roughly 4 of dozens of
live docs code blocks (seen on: `CodeEditor#registering-a-language`,
`Border#usage`, `Model#associations`, `Store#sort-and-filter`) show one
extra blank line of dead vertical space. Harmless — not growing, not
flickering, not overlapping content.

## The deeper root cause (real, precisely diagnosed, not shipped)

`.cm-content`'s `min-height: 100%` floors **every** height-reading DOM
property — `scrollHeight`, even `getBoundingClientRect` — at whatever
`.cm-scroller`'s own committed height currently is. Once a box is sized
taller than truly needed, nothing can read back a smaller true need
afterward, even once the reason for the extra height (e.g. a real
horizontal scrollbar) resolves on its own. Live-confirmed on
`Store#sort-and-filter`: clicking to a different line made a real
horizontal scrollbar vanish, but the space reserved for it never came back.

## What was tried, and why it was reverted

Each fix below was live-tested and shipped, then caused a new regression
the *next* round of live testing found — the loop never converged in one
session:

1. **Floor-breaking collapse.** Temporarily `setHeight(0)` when the reserve
   shrinks against an unchanged shape, forcing an honest re-measurement,
   then recommit. Shipped with a bug: the fractional-undershoot correction
   and the reserve re-measurement weren't applied to this new path, so the
   reserve ended up measured against the still-collapsed, height-0 box —
   reproduced live as both a spurious vertical scrollbar *and* a real
   horizontal scrollbar overlapping content on the same 5-line block.
2. Fixed both gaps. Live-testing then found the collapse itself flickers:
   reading scrollbar geometry synchronously, immediately after the
   collapse's own back-to-back writes (`0`, then the recovered height) in
   the same tick, can catch the browser mid-decision on whether to actually
   paint a scrollbar. A live trace caught the box oscillating between an
   honest 107px reading (with a "real" 15px reserve measured at that exact
   instant) and a later, genuinely-settled 122px reading of the very same
   committed state (with zero reserve) — forever, with the visible height
   never actually moving.
3. Fixed by reusing the pre-collapse, already-settled reserve reading
   instead of re-measuring immediately after the collapse's writes. This
   surfaced a third bug: the always-free *first* measurement for a shape is
   subject to the identical "read scrollbar geometry too soon" problem, so
   a real scrollbar can be silently under-measured as zero on mount — and
   the pre-existing anti-growth-echo guard then locks that wrong zero in
   forever, since it can't distinguish a genuine reserve correction from
   CodeMirror's own geometry echo. Live-confirmed as a real, rendered
   scrollbar permanently overlapping the block's last content row.
4. Fixed by exempting reserve-driven growth (content itself unchanged, only
   the reserve portion grew) from the anti-echo growth guard, since a
   scrollbar's thickness doesn't depend on this element's own height and so
   isn't subject to the echo that guard exists to block.

After step 4 shipped and was believed complete, the decision was made to
**stop and revert to the state before step 1** — the "4 blocks have one
extra line" state — rather than keep iterating. This was a deliberate
product decision (diminishing returns, rising regression risk), not a bug
left unfixed by oversight.

## How to resume, if ever

- The reverted-away code (floor-breaking collapse + reserve-growth-trust +
  their ~15 regression tests) is **not** on `master` — it was fully
  stripped back out, not merely disabled. It may still be recoverable from
  git reflog within its expiry window; do not assume it is.
- The root cause above is real and precisely diagnosed — don't re-derive it
  from scratch.
- The failure signature every time was **trusting a synchronous DOM read
  taken immediately after a write the same call just made** — especially
  two back-to-back writes (`0`, then a recovered height), or the very
  first write ever made for a shape. Any future attempt should treat *all*
  such immediately-post-write scrollbar-visibility reads as unreliable
  until proven otherwise via a fresh live trace on the actual block being
  fixed, not assume a technique validated on one block generalizes.
- Live-testing this file requires the docs dev server (`packages/docs`,
  typically `localhost:5174`) plus `npm run build:lib` after every source
  change — the dev server resolves `@jimka/typescript-ui` to source via
  Vite's own transform, but a stale `dist/` can still shadow it depending
  on how the app was started.
