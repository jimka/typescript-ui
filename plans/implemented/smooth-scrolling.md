# Smooth Eased Wheel Scrolling — Implementation Plan

## Overview

Add smooth, eased mouse-wheel scrolling to both scroll models in the framework, driven by a single shared RAF easing helper. Today the two models jump instantly on wheel: the JS-owned [`VirtualScroller.onWheel`](../src/typescript/lib/component/container/VirtualScroller.ts#L337) calls `setScrollX/Y` directly, and native-overflow components (`setOverflow("auto")` / Panel `autoScroll`) let the browser scroll instantly because CSS `scroll-behavior: smooth` does **not** affect wheel input.

The work introduces one new helper — `SmoothScroller` in [`src/typescript/lib/core/SmoothScroller.ts`](../src/typescript/lib/core/SmoothScroller.ts) — a re-targetable RAF loop that eases a current value toward an accumulated target via exponential decay. It is parameterised by a tiny read/write/clamp callback interface so it can drive either a `translate3d` transform (VirtualScroller) or `element.scrollTop/scrollLeft` (native). VirtualScroller's wheel handler routes through it; native overflow components gain a lazily-attached wheel controller that `preventDefault`s and eases the element offset while keeping [`Component`](../src/typescript/lib/core/Component.ts#L214)'s `_scrollTop`/`_scrollLeft` cache in sync each frame.

Programmatic scroll changes — `setScrollTop`/`setScrollLeft` (native), `setScrollX`/`setScrollY` (VirtualScroller), `scrollToRecord`, scroll-into-view — keep jumping instantly, and additionally cancel any in-flight wheel easing and re-sync its target so the animation never snaps the user back.

---

## Architecture Decisions

### A new `SmoothScroller` helper, not `Animation.tween`

[`Animation.tween`](../src/typescript/lib/core/Animation.ts#L292) is a fixed `from→to` duration tween — wrong shape here. Wheel scrolling needs a **re-targetable accumulator**: each wheel tick extends a moving target while the loop is mid-flight, and the loop must converge on whatever the target currently is. The proven model for this is the exponential-decay-toward-target pattern already living in [`VirtualScroller.attachTouchHandlers`](../src/typescript/lib/component/container/VirtualScroller.ts#L357) (`Math.pow(FRICTION, frame / 16.667)`). `SmoothScroller` generalises that into a per-frame *position lerp toward a target* rather than a *velocity decay*, so it serves both a transform writer and an element writer through one callback interface. It lives beside `Animation` in `~/core/` and is exported from the core barrel.

### Easing model — frame-rate-independent exponential approach

Per frame: `current += (target - current) * (1 - SMOOTH_FACTOR ^ (frameMs / 16.667))`, then write the rounded value. This is the same frame-normalised `Math.pow` decay the touch loop uses, so behaviour is consistent across the codebase and independent of refresh rate. Stop when `|target - current| < 0.5px` (sub-pixel — snap to target and end the loop). Rationale over a fixed-duration tween: rapid wheel ticks accumulate into `target` and the single in-flight loop simply chases it — no tween restart, no easing discontinuity. One tunable (`SMOOTH_FACTOR`) plus a stop threshold; no per-gesture duration to manage.

### Target accumulation and bounds clamping live in the helper

The helper owns `_target` (per axis). A wheel tick calls `scrollBy(deltaX, deltaY)` which adds to `_target`, re-clamps `_target` against `[0, max]` via the consumer's `clamp` callback (so over-scrolling a rapid burst can't fling past the end and rubber-band back), and starts the loop if idle. Clamping at accumulation time — not only at write time — keeps `_target` honest so the loop converges exactly on the boundary.

### Native interception attaches lazily, per scrollable component, refreshed by overflow state

Attaching a wheel listener on every Component is wasteful and wrong (most never scroll). Instead, [`Component.setOverflowX`](../src/typescript/lib/core/Component.ts#L3057)/[`setOverflowY`](../src/typescript/lib/core/Component.ts#L3100) call a private `refreshWheelScrolling()` that lazily constructs the controller when **either** axis becomes scrollable (`overflow` value of `auto` or `scroll`) and tears it down when neither is. Because Panel `autoScroll` already routes entirely through `setOverflowX/Y` ([`Panel.setAutoScroll`](../src/typescript/lib/core/Panel.ts#L217)), this single hook covers `autoScroll` panels and any direct `setOverflow("auto")` user with no Panel-specific code. The controller reads per-axis scrollability live on each wheel event, so independent per-axis overflow is honoured (e.g. `overflowX:auto`, `overflowY:hidden` only eases X).

### `passive: false` is mandatory and must be consistent

`wheel` is in [`Event.PASSIVE_TYPES`](../src/typescript/lib/core/Event.ts#L40), so its default window base listener is `passive: true`. A non-passive listener is required to `preventDefault` the native page scroll. [`VirtualScroller`](../src/typescript/lib/component/container/VirtualScroller.ts#L109) already registers wheel with explicit `{ passive: false }`; the native controller **must** register with `{ passive: false }` too, or the first-registration-wins guard in [`installBaseListener`](../src/typescript/lib/core/Event.ts#L48) throws on conflicting options. The plan standardises every framework wheel registration on `{ passive: false }`. (No code currently registers passive wheel, so there is no migration.)

### New-gesture re-sync from the actual position

When a wheel gesture begins (`scrollBy` while the loop is idle), the helper seeds `_target` and `_current` from a fresh `read()` of the live position — not from stale internal state. This is the anti-fight rule: between gestures the position may have moved via scrollbar drag, keyboard (PageDown/arrows), `scrollToRecord`, or a layout clamp, none of which go through the wheel loop. Re-reading on gesture start means the eased animation always starts from where the content actually is.

### Reduced motion → instant

If [`Animation.isReducedMotion()`](../src/typescript/lib/core/Animation.ts#L71) is true, `scrollBy` writes the clamped target immediately via `write()` and never starts a loop. Honoured live (read per gesture, not cached), matching how [`Glyph`](../src/typescript/lib/component/display/Glyph.ts#L103) tracks the media query.

### Touch momentum stays separate

The touch loop in [`attachTouchHandlers`](../src/typescript/lib/component/container/VirtualScroller.ts#L357) is a **velocity-fling** model (decaying velocity after finger release), not a **chase-a-target** model. Forcing it through `SmoothScroller` would mean re-expressing fling as a moving target every frame — more code, not less, and it would muddy both abstractions. It already works and is proven. Leave it; `SmoothScroller` and the touch loop share the same `FRICTION`-style decay *constant family* and frame normalisation, but stay distinct loops. This is the recommended split.

### Inner scroll container traps the wheel (`consumeWheel`)

Added during implementation, outside the original plan. The framework dispatches
subtree events descendant-first ([`Event` walks `target → parentElement`](../src/typescript/lib/core/Event.ts#L119)),
so a wheel over an inner scroll container fires that container's handler **and**
every scrollable ancestor's handler. Before this work only `VirtualScroller`
processed wheel in JS, and its single `preventDefault` cancelled the native
scroll for the whole event — so an inner table inside an `autoScroll` column did
not also scroll the column. Now that native components also process wheel in JS,
without coordination the inner container *and* its scrollable ancestors would all
scroll at once (visible on the "Misc." demo, where tables live inside
`autoScroll` columns). A small exported helper `consumeWheel(e)` in
`SmoothScroller.ts` marks the event on first claim and reports whether the claim
succeeded; because dispatch is descendant-first, the innermost container claims
it and ancestors skip — restoring the native trap behaviour. The native handler
claims **only** when it will actually move (non-zero delta on a scrollable axis),
so a non-scrolling-direction wheel still chains to an ancestor. `consumeWheel` is
an internal cross-module helper and is intentionally **not** barrel-exported.

### No global config / no theme involvement

Smooth wheel scrolling is universal best-practice UX with a `prefers-reduced-motion` escape hatch; an opt-out flag is speculative configurability (CLAUDE.md §2) and is **not** added. No CSS custom properties are involved — `SMOOTH_FACTOR` is a tuning constant in `SmoothScroller.ts`, not a theme token. Flagged here per the plan-skill requirement: theme involvement is **none**.

---

## Public API (TypeScript Signatures)

No consumer-facing setters/options change. `SmoothScroller` is a new exported core utility (parallel to `Animation`); the wheel behaviour is internal to existing components. Signatures:

```typescript
// src/typescript/lib/core/SmoothScroller.ts

/**
 * Per-axis read/write/clamp seam the SmoothScroller drives. One implementation
 * writes a transform (VirtualScroller); another writes element.scrollTop/Left.
 */
export interface SmoothScrollTarget {
    /** Current live position for `axis` ("x" | "y"), in pixels. */
    read(axis: ScrollAxis): number;
    /** Write `value` px to `axis` immediately (no easing). */
    write(axis: ScrollAxis, value: number): void;
    /** Clamp a requested position for `axis` to its valid `[0, max]` range. */
    clamp(axis: ScrollAxis, value: number): number;
}

export type ScrollAxis = "x" | "y";

export class SmoothScroller {
    constructor(target: SmoothScrollTarget);

    /** Accumulate a wheel delta into the target and ease toward it (or jump, under reduced motion). */
    scrollBy(deltaX: number, deltaY: number): void;

    /** Abort the in-flight loop and re-seed internal target/current from a fresh read(). Call from every programmatic jump. */
    reset(): void;

    /** True while the RAF loop is running. */
    isAnimating(): boolean;
}
```

Internal additions (no public surface):

- `Component`: private `_wheelScroller: ComponentWheelScroller | null` (cached backing field, `null` until a scrollable axis is set), private `refreshWheelScrolling(): void`.
- `ComponentWheelScroller` (private class, co-located in `Component.ts` or its own module under `~/core/`): wraps a `SmoothScroller` whose `SmoothScrollTarget` reads/writes `element.scrollLeft/scrollTop`, keeps `Component._scrollLeft/_scrollTop` in sync each `write`, and `preventDefault`s wheel only on an axis that is actually scrollable.

---

## Internal Structure

### `SmoothScroller` loop (core of the helper)

```
scrollBy(dx, dy):
    reducedMotion = Animation.isReducedMotion()
    if not animating:
        _curX = _tgtX = target.read("x"); _curY = _tgtY = target.read("y")   // re-sync on new gesture
    _tgtX = target.clamp("x", _tgtX + dx)
    _tgtY = target.clamp("y", _tgtY + dy)
    if reducedMotion:
        target.write("x", _tgtX); target.write("y", _tgtY); return          // instant
    if not animating: start RAF

step(now):
    frame = now - _lastT; _lastT = now
    k = 1 - SMOOTH_FACTOR ^ (frame / 16.667)        // frame-rate-independent approach factor
    _curX += (_tgtX - _curX) * k
    _curY += (_tgtY - _curY) * k
    if |_tgtX - _curX| < STOP_PX: _curX = _tgtX
    if |_tgtY - _curY| < STOP_PX: _curY = _tgtY
    target.write("x", _curX); target.write("y", _curY)
    if both settled: stop; else requestAnimationFrame(step)

reset():
    cancel RAF; _curX = _tgtX = read("x"); _curY = _tgtY = read("y")
```

`16.667` = one 60 fps frame in ms (already the touch loop's normaliser); `STOP_PX = 0.5` (sub-pixel — no visible difference, ends the loop). `SMOOTH_FACTOR` ≈ `0.75` per 60 fps frame — start there, tune empirically against the touch loop's feel (documented "why" per CODE_CONVENTIONS).

### VirtualScroller integration

`SmoothScrollTarget` for VirtualScroller:
- `read("y") → this._scrollY`, `read("x") → this._scrollX`
- `write("y", v) → this.setScrollY(v)`, `write("x", v) → this.setScrollX(v)` (existing setters clamp, update the transform, and fire `onScroll` — so the virtual window re-renders every frame, requirement satisfied with no new code)
- `clamp("y", v) → Math.max(0, Math.min(maxScrollY, v))` using the existing `effectiveViewportH/W` bounds

`onWheel` becomes: `e.preventDefault()`; map shift+deltaY→deltaX as today; then `this._smooth.scrollBy(dx, dy)` instead of direct `setScrollX/Y`. Touch `touchstart` and the scrollbar `on("scroll", …)` paths call `this._smooth.reset()` before driving the position so a finger-drag or thumb-drag mid-ease re-seeds cleanly.

### Native `ComponentWheelScroller`

- Constructed by `Component.refreshWheelScrolling()` when a scrollable axis appears; subtree wheel listener `{ passive: false }` on the component (subtree because the pointer is over a descendant, mirroring VirtualScroller's reasoning).
- On wheel: compute per-axis scrollability from `_overflowX/_overflowY` (`auto`/`scroll`); `preventDefault` only if at least one relevant axis is scrollable and has room to move; resolve shift+deltaY→deltaX; `scrollBy`.
- `SmoothScrollTarget`: `read` → `element.scrollLeft/Top`; `write(axis, v)` → set `element.scrollLeft/Top = v` **and** mirror into `Component._scrollLeft/_scrollTop` (the cache invariant — same as [`setScrollLeft`](../src/typescript/lib/core/Component.ts#L2801)); `clamp` → `[0, getMaxScrollLeft()/getMaxScrollTop()]`.
- Torn down (listener removed, RAF cancelled) when neither axis is scrollable.

### Component programmatic-jump hooks

[`setScrollLeft`](../src/typescript/lib/core/Component.ts#L2801) / [`setScrollTop`](../src/typescript/lib/core/Component.ts#L2822) call `this._wheelScroller?.reset()` after writing, so a programmatic jump cancels and re-seeds the ease. [`syncScrollOffsets`](../src/typescript/lib/core/Component.ts#L2846) likewise calls `reset()` (a layout clamp moved the offset out-of-band). VirtualScroller's `setScrollX/Y` are already the easing's own `write` channel, so they must **not** unconditionally `reset()` (that would abort mid-ease every frame); instead `scrollToRecord`/`scrollRecordIntoView`/`_scrollIntoView`/Body+Tree `setScrollX/Y` call `this._scroller`'s new `reset()` before the jump. (See Step 5 for the exact guard.)

---

## Ordered Implementation Steps

1. **Create `SmoothScroller`** in `src/typescript/lib/core/SmoothScroller.ts`: `SmoothScrollTarget` interface, `ScrollAxis` type, `SmoothScroller` class with the loop above. Export from [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) beside `Animation`. → verify: `npm run typecheck` clean.

2. **VirtualScroller: route wheel through `SmoothScroller`.** Add `_smooth: SmoothScroller` built in the constructor against an inline `SmoothScrollTarget` delegating to `setScrollX/Y` + `getScrollX/Y` + the effective-viewport clamp. Rewrite [`onWheel`](../src/typescript/lib/component/container/VirtualScroller.ts#L337) to `scrollBy`. Call `_smooth.reset()` at the top of `touchstart` (replacing/with `cancelMomentum`) and inside the two `Scrollbar` `on("scroll", …)` handlers. → verify: wheel over a table body eases; scrollbar drag and touch still work.

3. **VirtualScroller: stop the touch loop and the ease from fighting.** Confirm `cancelMomentum` + `_smooth.reset()` both run on `touchstart`; leave the fling loop otherwise untouched. → verify: fling, then immediately wheel — no snap-back.

4. **Component: native wheel controller.** Add `ComponentWheelScroller` (a `SmoothScrollTarget` over `element.scrollLeft/Top` that mirrors into `_scrollLeft/_scrollTop`). Add private `_wheelScroller` field and `refreshWheelScrolling()`. Call `refreshWheelScrolling()` at the end of `setOverflowX`, `setOverflowY`, `clearOverflowX`, `clearOverflowY`. Construct lazily when a scrollable axis appears (requires `getElement()`); tear down when neither axis scrolls. → verify: an `autoScroll:'auto'` Panel eases on wheel; a `'none'` Panel has no listener.

5. **Component + VirtualScroller: programmatic jumps reset the ease.** In `setScrollLeft`/`setScrollTop`/`syncScrollOffsets` add `this._wheelScroller?.reset()`. In Body [`setScrollX/Y`](../src/typescript/lib/component/table/Body.ts#L537), [`scrollToRecord`](../src/typescript/lib/component/table/Body.ts#L1066), [`scrollRecordIntoView`](../src/typescript/lib/component/table/Body.ts#L1398), and Tree [`setScrollX/Y`](../src/typescript/lib/component/tree/Tree.ts#L398) / [`_scrollIntoView`](../src/typescript/lib/component/tree/Tree.ts#L375), reset the VirtualScroller's ease before the jump (add a `VirtualScroller.resetWheelEase()` passthrough to `_smooth.reset()` and call it from the jump sites — **not** from VirtualScroller's own `setScrollX/Y`, which are the ease's write channel). → verify: `scrollToRecord` jumps instantly with no animation and no later snap-back.

6. **Reduced-motion.** Confirmed via `Animation.isReducedMotion()` inside `scrollBy` (Step 1). → verify: with `prefers-reduced-motion: reduce` emulated in DevTools, wheel jumps instantly in both models.

7. **Regression sweep.** `grep -rn '"wheel"' src/typescript/lib` — expect exactly two registration sites (VirtualScroller + ComponentWheelScroller), both `{ passive: false }`. Confirm no other code path writes `element.scrollTop/Left` for these components outside the documented setters.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/SmoothScroller.ts` |
| Modify | `src/typescript/lib/core/index.ts` (export `SmoothScroller`) |
| Modify | `src/typescript/lib/core/Component.ts` (`_wheelScroller`, `refreshWheelScrolling`, `ComponentWheelScroller`, overflow hooks, jump resets) |
| Modify | `src/typescript/lib/component/container/VirtualScroller.ts` (`_smooth`, `onWheel`, touch/scrollbar reset, `resetWheelEase`) |
| Modify | `src/typescript/lib/component/table/Body.ts` (reset ease in jump paths) |
| Modify | `src/typescript/lib/component/tree/Tree.ts` (reset ease in jump paths) |

---

## Verification

- **Typecheck:** `npm run typecheck` clean.
- **Wheel grep:** `grep -rn '"wheel"' src/typescript/lib` → exactly two sites, both `{ passive: false }`.
- **Manual smoke (demo screen: "Misc."):** [`MiscPanel`](../src/typescript/MiscPanel.ts) hosts BOTH models on one screen — two `autoScroll:'auto'` VBox columns ([lines 161–162](../src/typescript/MiscPanel.ts#L161)) for the native path and a `Table`/`Tree` for the VirtualScroller path. Run `npm run dev` (http://localhost:8015), open "Misc.":
  - Wheel over a native column → content eases smoothly, decelerating to rest.
  - Wheel over the table/tree body → rows ease; horizontal shift+wheel eases X.
  - Rapid multi-tick wheel → accumulates, no overshoot/rubber-band at the end.
  - Scrollbar drag, keyboard PageDown/Home/End/arrows on a native column → still instant and correct (cache stays in sync; verify `getScrollTop()` matches `element.scrollTop` after keyboard scroll).
  - `scrollToRecord` / select-then-arrow into an off-screen row → jumps instantly, no snap-back from a lingering ease.
- **Reduced motion:** DevTools → Rendering → emulate `prefers-reduced-motion: reduce` → both models jump instantly.
- **Docs:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

`SmoothScroller` is a new exported core symbol, so it needs doc coverage per [docs-conventions](../.claude/skills/_shared/docs-conventions.md):

- Exported from the core subpath barrel `src/typescript/lib/core/index.ts` (alongside `Animation`).
- Add a short entry to the core docs catalog under `docs/core/` (mirror the `Animation` page treatment — utility, not a Component) and the sidebar in `docs/.vitepress/config.mts`.
- Full JSDoc on `SmoothScroller`, `SmoothScrollTarget`, `ScrollAxis`, and each method (`@category Core`), per CODE_CONVENTIONS.
- No JSDoc on existing public setters changes meaning, so no cross-bucket `{@link}` churn beyond the new symbol.

---

## Potential Challenges

- **Passive-listener conflict throw:** if any future code registers passive wheel first, `installBaseListener` throws — mitigation: standardise both registrations on `{ passive: false }` and assert in Step 7's grep.
- **Cache drift from browser clamp:** when content shrinks, the browser clamps `element.scrollTop` out-of-band — mitigation: `syncScrollOffsets()` already exists and now also `reset()`s the ease; the native `write` re-reads back the clamped value into the cache.
- **Ease vs. layout-driven clamp in VirtualScroller:** `renderWindow` clamps `_scrollX/Y` without firing `onScroll`; an in-flight ease could then chase a now-invalid target — mitigation: the helper's `clamp` callback uses the live effective-viewport bounds every `scrollBy`, and the loop writes through `setScrollX/Y` which re-clamp every frame, so the target self-corrects.
- **Per-axis overflow asymmetry:** `overflowX:auto, overflowY:hidden` must only ease X — mitigation: the controller checks each axis's overflow value live per event and zeroes the other delta.
- **Lazy attach timing:** `setOverflowX/Y` can run during the super-cascade before the element exists — mitigation: `refreshWheelScrolling()` no-ops without `getElement()`, and the controller is (re)constructed on the next overflow write after `init()`, matching the existing deferred-DOM-work pattern.
- **Trackpad inertial deltas:** trackpads already emit smoothed sub-pixel `deltaY` streams; layering the ease on top could feel laggy — mitigation: `SMOOTH_FACTOR` tuned so small deltas settle within ~2 frames; the stop threshold ends the loop promptly so trackpad use stays crisp.

---

## Critical Files

- [`src/typescript/lib/core/Animation.ts`](../src/typescript/lib/core/Animation.ts) — sibling utility, `isReducedMotion`, the tween/decay idioms `SmoothScroller` parallels.
- [`src/typescript/lib/component/container/VirtualScroller.ts`](../src/typescript/lib/component/container/VirtualScroller.ts) — the transform model, existing wheel/touch/scrollbar handlers, the `FRICTION` decay to mirror.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — scroll cache + setters (≈2778–2879), overflow setters (≈3046–3125), backing fields (≈214–228).
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — `setAutoScroll` routes through `setOverflowX/Y` (confirms the single hook covers `autoScroll`).
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `PASSIVE_TYPES`, `installBaseListener` conflict guard, `addSubtreeListener`.
- [`src/typescript/lib/component/table/Body.ts`](../src/typescript/lib/component/table/Body.ts) / [`tree/Tree.ts`](../src/typescript/lib/component/tree/Tree.ts) — the programmatic jump call sites.

---

## Non-Goals

- **Touch fling rewrite** — the velocity-decay loop stays separate (different model; already proven).
- **Smooth scrolling for keyboard / scrollbar / `scrollToRecord`** — these jump by spec; only wheel eases.
- **A global opt-out flag or per-component tuning option** — speculative configurability; `prefers-reduced-motion` is the only escape hatch.
- **Theme tokens** — `SMOOTH_FACTOR` is a code constant, not a CSS custom property.
