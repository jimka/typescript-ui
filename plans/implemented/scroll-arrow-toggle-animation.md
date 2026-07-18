# Scroll-Arrow Enabled↔Disabled Fade — Implementation Plan

## Overview

The custom `Scrollbar`'s end-cap arrow buttons (`ScrollArrowButton`, file-local in
[`src/typescript/lib/component/container/Scrollbar.ts:113`](src/typescript/lib/component/container/Scrollbar.ts#L113))
currently switch their glyph colour **instantly** between the enabled token and
`--ts-ui-scrollbar-arrow-disabled-color` when scroll reaches an extreme. The swap
happens in `ScrollArrowButton.setDisabledState` at
[`Scrollbar.ts:225`](src/typescript/lib/component/container/Scrollbar.ts#L225) via
`setForegroundColor` (enabled at line 234/236 branches). The owning `Scrollbar`
calls it from `setMetrics`
([`Scrollbar.ts:592-593`](src/typescript/lib/component/container/Scrollbar.ts#L592))
whenever the position reaches/leaves an edge.

This change makes that colour change **fade** over a quick 120 ms crossfade
instead of hard-flipping. It is **purely visual**: the `_disabled` boolean still
flips instantly, so mousedown and the auto-repeat tick are gated at the exact
moment the extreme is reached; only the painted colour catches up via a CSS
transition. The entire change lives inside `ScrollArrowButton` — one import, one
constant, and one construction-time `setTransition` call. `setDisabledState`
itself is **not modified**.

---

## Architecture Decisions

### Mirror `Checkbox`'s construction-time colour crossfade

The precedent for "fade a colour/opacity change on a small control state toggle"
is [`Checkbox`](src/typescript/lib/component/input/Checkbox.ts). Its constructor
sets `setTransition("background-color 120ms ease-out, border-color 120ms ease-out")`
and `"opacity 120ms ease-out"` on its inner parts at
[`Checkbox.ts:104-108`](src/typescript/lib/component/input/Checkbox.ts#L104),
gated on `!Animation.isReducedMotion()`, and the actual state writes
(`setBackgroundColor` / `setOpacity`) are what fire the crossfade. `Toggle`
([`Toggle.ts:78-79`](src/typescript/lib/component/input/Toggle.ts#L78)) and
`RadioButton`
([`RadioButton.ts:94-95`](src/typescript/lib/component/input/RadioButton.ts#L94))
follow the identical `"…120ms ease-out"` cadence. We mirror this exactly: a
static, construction-time `setTransition("color 120ms ease-out")` on each
`ScrollArrowButton`, and the existing `setForegroundColor` in `setDisabledState`
becomes the crossfade trigger unchanged. 120 ms `ease-out` is chosen to match
those three sibling controls' fade cadence (task's "~120–150 ms" range), not
invented.

### The transition is static — never toggled at runtime

Only the **colour** changes at runtime (via `setForegroundColor`); the transition
string is declared once and never re-set. This sidesteps any construction-vs-runtime
`setTransition` interaction entirely — there is no runtime `setTransition` call to
be shadowed.

### The construction-vs-runtime `setTransition` trap no longer applies (verify)

A project memory (`feedback_settransition_rule_vs_inline_shadow`) warns that a
construction-time transition is replayed **inline** by `init` and shadows later
runtime `setTransition` calls (which historically wrote the `#id` rule). **That
memory is stale.** Current `Component.setTransition`
([`Component.ts:3616-3625`](src/typescript/lib/core/Component.ts#L3616)) writes
the value **inline** (`setElementStyle("transition", value)`, line 3622), and its
JSDoc explicitly documents this was done "to keep the setter and the replay on
the same seam" so runtime changes are no longer shadowed. The implementer must
**not** re-introduce a runtime `setTransition` on the strength of that memory —
our design needs none. (`setForegroundColor` writes `color` to the `#id` rule at
[`Component.ts:1802`](src/typescript/lib/core/Component.ts#L1802); the inline
`transition` shorthand applies to that `color` change regardless of which seam the
colour came from.)

### Startup-flash prevention: establish colour + transition before first paint

Both the initial colour and the transition are written during construction, before
the arrow's element is ever rendered. CSS only animates a property change against a
**previously committed** value; on the very first paint there is no prior value, so
the initial colour paints instantly with no fade — exactly how `Checkbox` avoids a
flash (it sets `opacity 0` and the transition at construction, then `applySelected`
runs, all pre-render). Concretely:

- The **start arrow** is forced disabled at construction via `buildArrows`'
  `setDisabledState(true)`
  ([`Scrollbar.ts:411`](src/typescript/lib/component/container/Scrollbar.ts#L411)),
  which runs before any render — so it paints dim instantly, no fade-in from the
  enabled colour.
- The **end arrow** paints its enabled colour instantly. Its first disabled/enabled
  refresh comes from `setMetrics`, which `VirtualScroller` (the sole consumer) calls
  from `layoutScrollbars`
  ([`VirtualScroller.ts:402-406`](src/typescript/lib/component/container/VirtualScroller.ts#L402))
  **during the layout pass, before paint** — so an already-at-bottom start position
  also coalesces into the first paint rather than fading in.

Only edge transitions that happen **after** the first paint (the user scrolls to or
away from an extreme) fade. This is pinned in `## Expected Behaviour`.

### The glyph inherits the animating colour

`setForegroundColor` sets `color` on the `ScrollArrowButton` element; the arrow's
child `Glyph` renders a Unicode triangle whose text colour inherits from the button
(the glyph sets no own foreground colour). A `color` transition on the button
therefore visually fades the triangle — no transition on the glyph child is needed.

---

## Ordered Implementation Steps

1. **Add the `Animation` import.** In
   [`Scrollbar.ts`](src/typescript/lib/component/container/Scrollbar.ts) top import
   block (near line 9), add:
   `import { Animation } from "~/core/Animation.js";`
   — Verify: `grep -n 'import { Animation }' src/typescript/lib/component/container/Scrollbar.ts` → one match.

2. **Add the fade-duration constant.** In the file-local constant block
   ([`Scrollbar.ts:27-53`](src/typescript/lib/component/container/Scrollbar.ts#L27)),
   next to the other arrow constants, add:
   ```typescript
   // Crossfade duration for the arrow's enabled↔disabled colour swap. Matches the
   // 120 ms ease-out cadence Checkbox / Toggle / RadioButton use for their state
   // crossfades so the scrollbar's arrows read as the same UI vocabulary; short
   // enough to feel instant while softening the hard colour flip at each edge.
   const ARROW_FADE_DURATION_MS = 120;
   ```

3. **Declare the transition at construction.** In the `ScrollArrowButton`
   constructor, immediately after the enabled-colour `setForegroundColor(...)` call
   ([`Scrollbar.ts:133`](src/typescript/lib/component/container/Scrollbar.ts#L133)),
   add:
   ```typescript
   // Fade the enabled↔disabled colour swap in setDisabledState instead of a hard
   // switch. Declared at construction (mirrors Checkbox's crossfade) so the initial
   // colour — the start arrow's dim state set by Scrollbar.buildArrows before first
   // paint — appears instantly, and only later at-edge toggles fade. Honours
   // prefers-reduced-motion.
   if (!Animation.isReducedMotion()) {
       this.setTransition("color " + ARROW_FADE_DURATION_MS + "ms ease-out");
   }
   ```
   — Do **not** modify `setDisabledState`, the glyph, or the hover handlers.

4. **Type-check.** `npx tsc --noEmit` → no new errors.

5. **Add/extend tests** per `## Verification` (test-first: write them, watch T1–T3
   fail against the unmodified file if practical, then land steps 1–3).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `tests/component/container/ScrollbarArrow.test.ts` (add fade/colour assertions) |

---

## Expected Behaviour

**Unit-testable (offline harness):**

1. **Disabled colour still applied at the start extreme.** `new Scrollbar('vertical', { arrowsEnabled: true })`,
   `setHeight(400)`, `setMetrics(200, 1000, 0)` (scrolled to top): the start arrow's
   `getForegroundColor()` returns the disabled token
   (`"var(--ts-ui-scrollbar-arrow-disabled-color, rgba(0, 0, 0, 0.18))"`) and the end
   arrow's returns the enabled token
   (`"var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))"`).
2. **Colour flips at the opposite extreme.** After `setMetrics(200, 1000, 800)`
   (scrolled to bottom, `maxScroll = 600`): start arrow → enabled token, end arrow →
   disabled token. Confirms `setDisabledState` still toggles `_disabled` and swaps
   the colour.
3. **Fade transition is declared on both arrows.** Each arrow's `getTransition()`
   returns `"color 120ms ease-out"` (the crossfade CSS is present). Under the test
   harness `Animation.isReducedMotion()` is `false`, so the transition is set.
4. **No-op metrics are idempotent.** A second `setMetrics(200, 1000, 0)` after the
   first leaves both arrows' `getForegroundColor()` unchanged and emits no `"scroll"`
   — the `setDisabledState` early-return at
   [`Scrollbar.ts:226`](src/typescript/lib/component/container/Scrollbar.ts#L226)
   still fires (no redundant colour write).
5. **Behavioural gating unchanged (existing regression, keep passing).** A disabled
   (at-edge) arrow ignores mousedown (emits no `"scroll"`); an enabled arrow steps by
   `arrowStep`. This is the existing `ScrollbarArrow.test.ts` case — the `_disabled`
   flag must still gate `_onMouseDown` and the repeat tick **instantly**, unaffected
   by the fade.

**Manual-verify (the offline harness cannot paint CSS transitions):**

6. **The fade renders.** At `localhost:8015`, scroll a `Scrollbar`-backed view (the
   `VirtualScroller` / slow table in `MiscPanel`) to its top or bottom extreme and
   watch the corresponding arrow's triangle fade to/from dim over ~120 ms rather than
   snap.
7. **No startup flash.** On first load, the start arrow appears dim **instantly** (no
   fade-in from the enabled colour), and if the view starts already scrolled to the
   bottom the end arrow appears dim instantly too.
8. **Reduced-motion.** With `prefers-reduced-motion: reduce`, the colour switches
   instantly (no transition declared).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — clean.
- **Unit tests:** `npx vitest run tests/component/container/ScrollbarArrow.test.ts tests/component/container/Scrollbar.test.ts` — extend `ScrollbarArrow.test.ts` with Expected Behaviour 1–4 (assert via `bar.getComponents()` → `[thumb, arrowStart, arrowEnd]`, then `getForegroundColor()` / `getTransition()`); keep case 5 green.
- **Grep invariant:** `grep -n 'setTransition' src/typescript/lib/component/container/Scrollbar.ts` → exactly one match (construction only; no runtime toggle).
- **Manual smoke:** Expected Behaviour 6–8 at `localhost:8015` (scroll a virtualized view to each extreme; reload to check no startup fade; optionally toggle OS reduced-motion).

---

## Potential Challenges

- **First `setMetrics` after paint (theoretical).** The flash-prevention argument
  relies on the initial `setMetrics` landing in the same pre-paint layout pass, which
  is how the only consumer (`VirtualScroller.layoutScrollbars`) drives it. A future
  consumer that first pushes metrics in a later frame could see a one-time end-arrow
  fade-in when starting already at an extreme. Out of scope here; note it if a second
  consumer is added.
- **Don't re-add a runtime `setTransition`.** The stale memory may tempt a "toggle
  the transition off for the initial state" approach; it is unnecessary and would
  reintroduce complexity — construction-time-only is correct (see Architecture
  Decisions).

---

## Critical Files

- [`src/typescript/lib/component/container/Scrollbar.ts`](src/typescript/lib/component/container/Scrollbar.ts)
  — `ScrollArrowButton` (class 113, constructor 126, `setForegroundColor` seed 133,
  `setDisabledState` 225), `Scrollbar.buildArrows` (403, start-arrow
  `setDisabledState(true)` 411), `setMetrics` edge refresh (592-593).
- [`src/typescript/lib/component/input/Checkbox.ts`](src/typescript/lib/component/input/Checkbox.ts)
  — **the precedent**: construction-time crossfade `setTransition` (104-108), reduced-motion gate.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts)
  — `setTransition` writes inline (3616-3625); `setForegroundColor` writes `color` to the `#id` rule (1796-1804).
- [`src/typescript/lib/core/Animation.ts`](src/typescript/lib/core/Animation.ts)
  — `Animation.isReducedMotion()` (73-75).
- [`src/typescript/lib/component/container/VirtualScroller.ts`](src/typescript/lib/component/container/VirtualScroller.ts)
  — sole `Scrollbar` consumer; `setMetrics` driven from `layoutScrollbars` (402-406) in the layout pass.
- [`tests/component/container/ScrollbarArrow.test.ts`](tests/component/container/ScrollbarArrow.test.ts)
  — existing behavioural-gating test to preserve and extend.

---

## Non-Goals

- **No change to scroll/repeat/acceleration behaviour.** `AutoRepeat`, `onArrowTick`,
  mousedown/tick gating stay exactly as-is; the fade is colour-only.
- **No new colour tokens.** The `--ts-ui-scrollbar-arrow-*` tokens are unchanged.
- **No hover-fade.** The hover background swap (`_onMouseOver` / `_onMouseOut`) stays
  instant; the transition lists `color` only, not `background-color`.
- **No runtime transition toggle / `setAnimated`-style API.** Scrollbars are not
  virtualized/re-bound per frame (the reason `Checkbox` needs `setAnimated`), so no
  runtime suppression surface is added.

---

## Implementation Notes

- **Manual-verify (Expected Behaviour 6–7) done against a dedicated dev server, not
  `localhost:8015`.** Port 8015 was already bound by another process (a different
  worktree's dev server / prior session), so this worktree's own `vite` was started on
  `--port 8017 --strictPort` instead, and torn down after verification. Confirmed live
  via Chrome DevTools: `.ScrollArrowButton` computed style shows
  `transition: color 0.12s ease-out` on both arrows; a fresh load of the "table (slow)"
  window's `VirtualScroller` shows the start arrow already at the disabled colour
  (`rgba(0, 0, 0, 0.18)`) with no fade-in on first paint; driving a real arrow's
  `mousedown`/`mouseup` at the opposite extreme flipped both arrows' colours correctly
  (`0.18` ↔ `0.55`).
- **Manual-verify item 8 (reduced-motion) verified by code inspection, not live OS
  toggle.** The Chrome DevTools MCP tooling available in this session has no
  `prefers-reduced-motion` emulation control. The gate added
  (`if (!Animation.isReducedMotion())`) is the identical, already-proven pattern
  `Checkbox` / `Toggle` / `RadioButton` use in production — no new logic was
  introduced for this case.
- **`npm run docs:build`'s `vitepress build` step was OOM-killed in this environment**
  (`Killed`, no vitepress error output), consistent with the pre-existing
  memory-starved-WSL2 issue already on file for this project (`docs:build` needs
  ~5 GB+ heap and this box's available RAM was ~5.9 GB with swap already exhausted by
  concurrent processes). This reproduces with `NODE_OPTIONS` already set as high as
  the script requires; it is an environment resource ceiling, not a defect introduced
  by this change. `npm run docs:api` (the `typedoc` markdown-generation step that
  actually validates JSDoc links and content) completed cleanly — 0 errors, and the
  163 warnings present are pre-existing (`Accordion` link-resolution warnings in
  unrelated table/tree/diagram files), none touching `Scrollbar.ts` or
  `docs/components/Scrollbar.md`.
